package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"gitee.com/maryuke/douwan-api/internal/admin"
	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/storage"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// newConcurrentEnv 构造一个「允许多连接」的测试环境。
//
// 为什么不用 testsupport.NewDB：那个库把连接数限制成 1，
// 并发请求会被串行化，就测不出「两个请求同时抢一张卡密」的场景。
// 这里用 cache=shared + busy_timeout，并放开连接数。
func newConcurrentEnv(t *testing.T) *adminEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)

	dsn := fmt.Sprintf("file:%s_conc?mode=memory&cache=shared&_pragma=busy_timeout(10000)", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatalf("打开并发测试数据库: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("获取连接池: %v", err)
	}
	sqlDB.SetMaxOpenConns(8)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("迁移并发测试数据库: %v", err)
	}

	repos := repository.New(db)
	hash, err := auth.HashPassword(testAdminPassword)
	if err != nil {
		t.Fatalf("生成密码哈希: %v", err)
	}
	admin := &model.Admin{
		Username: testAdminUser, PasswordHash: hash, Nickname: "并发超管",
		Role: model.AdminRoleSuper, Status: model.AdminStatusActive,
	}
	if err := repos.Admin.Create(t.Context(), admin); err != nil {
		t.Fatalf("创建测试管理员: %v", err)
	}

	store, err := storage.New(config.Storage{
		Driver: "local", UploadDir: t.TempDir(), PublicPrefix: "/uploads",
		MaxUploadMB: 10, MaxThumbSize: 128,
	})
	if err != nil {
		t.Fatalf("构造存储: %v", err)
	}

	engine := router.New(router.Deps{
		Config: &config.Config{
			App:    config.App{Name: "douwan-api", Env: "test", Debug: false},
			Server: config.Server{Port: 8080},
			Admin: config.Admin{
				CardCipherKey: testCardSecret, MaxGeneratePerRequest: 500,
				CardCodeLength: 16, CardRedeemPerMinute: 100000,
			},
		},
		DB:         db,
		Tokens:     testsupport.NewTokens(),
		TokenStore: testsupport.NewTokenStore(t),
		Storage:    store,
	})

	env := &adminEnv{engine: engine, db: db, repos: repos, adminID: admin.ID}
	env.adminToken = env.login(t, testAdminUser, testAdminPassword)
	return env
}

// TestConcurrentRedeem_OnlyOneWins 是卡密模块最关键的一个测试：
// 同一张卡密被 6 个请求同时兑换，必须只有 1 个成功（需求 §6.5 / §16）。
func TestConcurrentRedeem_OnlyOneWins(t *testing.T) {
	e := newConcurrentEnv(t)
	planID, _ := e.createPlan(t, "并发测试套餐", nil)
	e.publishPlan(t, planID)
	_, codes := e.generateCards(t, planID, 1, nil)
	if len(codes) != 1 {
		t.Fatalf("应生成 1 张卡密，实际 %d", len(codes))
	}

	// 注册 6 个用户，每人一个令牌
	const users = 6
	tokens := make([]string, 0, users)
	for i := 0; i < users; i++ {
		token, _ := e.registerUser(t, fmt.Sprintf("race%04d", i))
		tokens = append(tokens, token)
	}

	type outcome struct {
		status int
		code   int
	}
	results := make([]outcome, users)
	var wg sync.WaitGroup
	start := make(chan struct{})

	for i := 0; i < users; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start // 让所有 goroutine 尽量同时出发
			rec := e.do(t, http.MethodPost, "/api/v1/card-keys/redeem",
				map[string]any{"code": codes[0]}, tokens[idx])
			var env struct {
				Code int `json:"code"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &env)
			results[idx] = outcome{status: rec.Code, code: env.Code}
		}(i)
	}
	close(start)
	wg.Wait()

	success := 0
	for _, r := range results {
		if r.status == http.StatusOK && r.code == 0 {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("并发兑换必须只有 1 个成功，实际 %d 个：%+v", success, results)
	}

	// 数据库层面也要对得上：卡密已兑换，且只产生 1 条权益
	card, err := e.repos.CardKey.FindByCodeHash(t.Context(),
		hashCard(t, codes[0]))
	if err != nil {
		t.Fatalf("查询卡密: %v", err)
	}
	if card.Status != model.CardStatusRedeemed {
		t.Fatalf("卡密状态应为已兑换，实际 %s", card.Status)
	}
	if got := e.countTable(t, &model.Entitlement{}, "source_type = ?", model.EntitlementSourceCard); got != 1 {
		t.Fatalf("兑换产生的权益应只有 1 条，实际 %d", got)
	}
}

// TestConcurrentIssue_OnlyOneOrderIssues 覆盖「同一订单被两个请求同时发卡」。
func TestConcurrentIssue_OnlyOneOrderIssues(t *testing.T) {
	e := newConcurrentEnv(t)
	planID, _ := e.createPlan(t, "并发发卡套餐", nil)
	e.publishPlan(t, planID)
	e.generateCards(t, planID, 10, nil)

	token, _ := e.registerUser(t, "issueuser01")
	orderID := e.createOrder(t, token, planID)

	// 先确认收款
	rec := e.markPaid(t, orderID, false, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("确认收款失败: %d %s", rec.Code, rec.Body.String())
	}

	const workers = 4
	statuses := make([]int, workers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			rec := e.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/issue", orderID),
				map[string]any{"note": "并发发卡测试"}, e.adminToken)
			statuses[idx] = rec.Code
		}(i)
	}
	close(start)
	wg.Wait()

	success := 0
	for _, s := range statuses {
		if s == http.StatusOK {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("并发发卡必须只有 1 个成功，实际 %d 个：%v", success, statuses)
	}

	order, err := e.repos.Order.FindByID(t.Context(), orderID)
	if err != nil {
		t.Fatalf("查询订单: %v", err)
	}
	if order.CardIssuedCount != 1 {
		t.Fatalf("订单应只发出 1 张卡密，实际 %d", order.CardIssuedCount)
	}
	if got := e.countTable(t, &model.CardKey{}, "order_id = ?", orderID); got != 1 {
		t.Fatalf("关联卡密应为 1 张，实际 %d", got)
	}
	if got := e.countTable(t, &model.Entitlement{}, "order_id = ?", orderID); got != 1 {
		t.Fatalf("订单权益应为 1 条，实际 %d", got)
	}
}

// hashCard 用与服务端一致的方式算卡密哈希，供测试直接查库。
func hashCard(t *testing.T, code string) string {
	t.Helper()
	return admin.HashCode(admin.NormalizeCode(code), testCardSecret)
}

// TestSequentialOrders_SecondOrderSucceeds 是最重要的一条回归用例。
//
// 线上事故：orders.fulfillment_key 上是**全表唯一索引**，而新建订单这个字段
// 是空串，于是第一笔订单能建、**第二笔订单必然撞唯一索引**，
// 报出来的错误却是「订单号重复，请重试」（因为仓储把所有唯一键冲突
// 都当成订单号冲突折叠了）。结果就是「系统只能下一单」。
//
// 这里连续下三单，全部必须成功，并且订单号各不相同。
func TestSequentialOrders_SecondOrderSucceeds(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "连单套餐", map[string]any{"allow_repeat_purchase": true})
	e.publishPlan(t, planID)

	token, _ := e.registerUser(t, "seqorder01")

	orderNos := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		rec := e.do(t, http.MethodPost, "/api/v1/orders", map[string]any{"plan_id": planID}, token)
		if rec.Code != http.StatusCreated {
			t.Fatalf("第 %d 笔订单应创建成功，实际 %d：%s", i+1, rec.Code, rec.Body.String())
		}
		no, _ := jsonMap(t, rec)["order_no"].(string)
		if no == "" {
			t.Fatalf("第 %d 笔订单没有返回订单号", i+1)
		}
		for _, prev := range orderNos {
			if prev == no {
				t.Fatalf("订单号重复：%s", no)
			}
		}
		orderNos = append(orderNos, no)
	}

	// 空 fulfillment_key 不应该互相冲突（部分唯一索引 + 只存非空值）
	var withEmptyKey int64
	if err := e.db.Model(&model.Order{}).Where("fulfillment_key = ''").Count(&withEmptyKey).Error; err != nil {
		t.Fatalf("统计订单: %v", err)
	}
	if withEmptyKey != 0 {
		t.Fatalf("新建订单不应写入空串 fulfillment_key（会互相撞唯一索引），实际 %d 条", withEmptyKey)
	}
	if got := e.countTable(t, &model.Order{}, "1 = 1"); got != 3 {
		t.Fatalf("应有 3 笔订单，实际 %d", got)
	}
}

// TestOrderNo_UniqueWithinSameSecond 覆盖订单号与批次号的唯一性。//
// 这条用例来自线上实测：订单号原来只取 4 位十六进制随机（2 个字节），
// 同一秒内下单的碰撞概率是 1/65536，自动化脚本连续下单真的撞上了唯一索引，
// 报「订单号重复，请重试」。这里用同一时刻批量生成来钉住熵够不够。
func TestOrderNo_UniqueWithinSameSecond(t *testing.T) {
	now := time.Now()
	const rounds = 5000

	orderNos := make(map[string]bool, rounds)
	batchIDs := make(map[string]bool, rounds)
	for i := 0; i < rounds; i++ {
		no := admin.NewOrderNo(now)
		if orderNos[no] {
			t.Fatalf("第 %d 次生成了重复订单号：%s", i, no)
		}
		orderNos[no] = true

		batch := admin.NewBatchID(now)
		if batchIDs[batch] {
			t.Fatalf("第 %d 次生成了重复批次号：%s", i, batch)
		}
		batchIDs[batch] = true
	}
	if len(orderNos) != rounds || len(batchIDs) != rounds {
		t.Fatalf("同一时刻生成的编号应全部唯一，实际订单号 %d 个、批次号 %d 个", len(orderNos), len(batchIDs))
	}
	if !strings.HasPrefix(admin.NewOrderNo(now), "DW") {
		t.Fatal("订单号应以 DW 开头，便于人工识别")
	}
}

// TestConcurrentCreateOrder 覆盖同一用户并发下单都能拿到唯一订单号。
func TestConcurrentCreateOrder(t *testing.T) {
	e := newConcurrentEnv(t)
	planID, _ := e.createPlan(t, "并发下单套餐", map[string]any{
		"allow_repeat_purchase": true,
	})
	e.publishPlan(t, planID)

	token, _ := e.registerUser(t, "racer0001")

	const workers = 8
	statuses := make([]int, workers)
	orderNos := make([]string, workers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			rec := e.do(t, http.MethodPost, "/api/v1/orders", map[string]any{"plan_id": planID}, token)
			statuses[idx] = rec.Code
			var env struct {
				Data struct {
					OrderNo string `json:"order_no"`
				} `json:"data"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &env)
			orderNos[idx] = env.Data.OrderNo
		}(i)
	}
	close(start)
	wg.Wait()

	success := 0
	seen := map[string]bool{}
	for i, s := range statuses {
		if s != http.StatusCreated {
			continue
		}
		success++
		if orderNos[i] == "" {
			t.Fatalf("第 %d 个成功请求没有返回订单号", i)
		}
		if seen[orderNos[i]] {
			t.Fatalf("并发下单产生了重复订单号：%s", orderNos[i])
		}
		seen[orderNos[i]] = true
	}
	if success == 0 {
		t.Fatalf("并发下单至少应有 1 个成功，实际 0 个：%v", statuses)
	}
}
