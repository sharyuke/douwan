package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"gitee.com/maryuke/douwan-api/internal/admin"
	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/storage"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// TestPostgres_Smoke 在真实 PostgreSQL 上跑一遍关键链路。
//
// 为什么需要它：单元测试用的是 SQLite 内存库，而线上是 PostgreSQL 16。
// 有些问题只在真库上暴露，例如：
//   - jsonb 字段在 Updates(map) 里必须传 JSON 文本（结构体参数会报 unsupported type）
//   - 部分唯一索引（where 排除空串）的建表语法
//   - 聚合查询里的 SUM(CASE WHEN ...) / GROUP BY 写法
//
// 平时不跑（没有数据库时自动跳过），要跑就先起一个：
//
//	docker run -d --name dw-pgtest -e POSTGRES_USER=douwan -e POSTGRES_PASSWORD=douwan \
//	  -e POSTGRES_DB=douwan_pgtest -p 55432:5432 postgres:16-alpine
//	DOUWAN_TEST_POSTGRES_DSN='host=127.0.0.1 port=55432 user=douwan password=douwan dbname=douwan_pgtest sslmode=disable' go test ./internal/handler/ -run Postgres -v
func TestPostgres_Smoke(t *testing.T) {
	dsn := os.Getenv("DOUWAN_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("未设置 DOUWAN_TEST_POSTGRES_DSN，跳过后端 PostgreSQL 冒烟测试")
	}

	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatalf("连接 PostgreSQL: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("获取连接池: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })

	// 每次从干净库开始：删掉所有业务表再重建
	if err := dropAllTables(db); err != nil {
		t.Fatalf("清理测试库: %v", err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("在 PostgreSQL 上迁移: %v", err)
	}

	repos := repository.New(db)
	hash, err := auth.HashPassword(testAdminPassword)
	if err != nil {
		t.Fatalf("生成密码哈希: %v", err)
	}
	adminRow := &model.Admin{
		Username: testAdminUser, PasswordHash: hash, Nickname: "PG 超管",
		Role: model.AdminRoleSuper, Status: model.AdminStatusActive,
	}
	if err := repos.Admin.Create(t.Context(), adminRow); err != nil {
		t.Fatalf("创建管理员: %v", err)
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
				CardCodeLength: 16, CardRedeemPerMinute: 1000,
			},
		},
		DB:         db,
		Tokens:     testsupport.NewTokens(),
		TokenStore: testsupport.NewTokenStore(t),
		Storage:    store,
	})

	env := &adminEnv{engine: engine, db: db, repos: repos, adminID: adminRow.ID}
	env.adminToken = env.login(t, testAdminUser, testAdminPassword)

	// 1) 套餐：新建 → 上架 → 前台可见
	planID, _ := env.createPlan(t, "PG 冒烟套餐", nil)
	env.publishPlan(t, planID)

	rec := env.do(t, http.MethodGet, "/api/v1/plans", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("前台套餐列表: %d %s", rec.Code, rec.Body.String())
	}
	var plans []map[string]any
	if err := json.Unmarshal(decode(t, rec).Data, &plans); err != nil {
		t.Fatalf("解析前台套餐: %v", err)
	}
	if len(plans) != 1 {
		t.Fatalf("前台应有 1 个已上架套餐，实际 %d", len(plans))
	}
	if plans[0]["price"].(float64) != 19.9 {
		t.Fatalf("价格应来自数据库，实际 %v", plans[0]["price"])
	}

	// 2) 编辑套餐：覆盖 jsonb 字段（benefit_config / feature_permissions / feature_text）
	rec = env.do(t, http.MethodPut, fmt.Sprintf("/api/v1/admin/plans/%d", planID), map[string]any{
		"name":  "PG 冒烟套餐（改）",
		"price": 29.5,
		"benefit_config": map[string]any{
			"kind": "quota", "usage_limit": 12,
			"validity_type": "month", "validity_value": 1, "start_on": "redeem",
		},
		"feature_permissions": map[string]any{"export.pdf": true, "generate.variants": 3},
		"feature_text":        []string{"PG 权益一", "PG 权益二"},
	}, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("编辑套餐（jsonb 写入）失败: %d %s", rec.Code, rec.Body.String())
	}

	// 3) 卡密：生成 → 兑换
	_, codes := env.generateCards(t, planID, 2, nil)
	userToken, userID := env.registerUser(t, "pguser001")
	rec = env.redeem(t, userToken, codes[0])
	if rec.Code != http.StatusOK {
		t.Fatalf("兑换失败: %d %s", rec.Code, rec.Body.String())
	}
	// 重复兑换必须失败（条件更新在真库上的行为）
	rec = env.redeem(t, userToken, codes[1])
	if rec.Code != http.StatusOK {
		t.Fatalf("第二张卡密兑换应成功: %d %s", rec.Code, rec.Body.String())
	}
	rec = env.redeem(t, userToken, codes[0])
	if rec.Code != http.StatusConflict {
		t.Fatalf("重复兑换应 409，实际 %d", rec.Code)
	}

	// 前面两张卡密已经被兑换掉了，订单发卡还需要库存，所以再生成一批。
	// （这同时覆盖了「同一套餐多次生成、批次汇总能看到多个批次」的情况）
	env.generateCards(t, planID, 3, nil)

	// 4) 卡密列表 / 明文 / 导出 / 作废（覆盖 jsonb 快照回读与 LIKE 查询）
	rec = env.do(t, http.MethodGet, "/api/v1/admin/card-keys?page=1&page_size=10&keyword="+
		admin.NormalizeCode(codes[0])[:6], nil, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("卡密列表: %d %s", rec.Code, rec.Body.String())
	}
	page := jsonMap(t, rec)
	if int(page["total"].(float64)) < 1 {
		t.Fatalf("按卡密关键字应能搜到，实际 total=%v", page["total"])
	}
	list := page["list"].([]any)
	first := list[0].(map[string]any)
	if first["plan_snapshot"] == nil {
		t.Fatal("卡密应带套餐快照（jsonb 回读失败）")
	}

	ids := make([]uint64, 0, len(list))
	for _, raw := range list {
		ids = append(ids, uint64(raw.(map[string]any)["id"].(float64)))
	}
	rec = env.do(t, http.MethodPost, "/api/v1/admin/card-keys/reveal", map[string]any{"ids": ids}, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("查看明文: %d %s", rec.Code, rec.Body.String())
	}

	rec = env.do(t, http.MethodPost, "/api/v1/admin/card-keys/export",
		map[string]any{"plan_id": planID, "reveal": true}, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("导出 CSV: %d %s", rec.Code, rec.Body.String())
	}
	if len(rec.Body.Bytes()) < 10 {
		t.Fatal("导出的 CSV 内容为空")
	}

	// 5) 订单：下单 → 人工确认收款 → 发卡（覆盖订单快照与条件更新）
	rec = env.do(t, http.MethodPost, "/api/v1/orders", map[string]any{"plan_id": planID}, userToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("下单: %d %s", rec.Code, rec.Body.String())
	}
	orderID := uint64(jsonMap(t, rec)["id"].(float64))

	rec = env.markPaid(t, orderID, true, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("人工确认收款并发卡: %d %s", rec.Code, rec.Body.String())
	}
	// 确认收款后如果发卡失败，接口仍然返回成功（收款已确认），
	// 但会把原因拼在订单备注里 —— 这里必须把它暴露出来，否则等于放过了发卡失败。
	settled := jsonMap(t, rec)
	if note, _ := settled["note"].(string); note != "" && strings.Contains(note, "发卡失败") {
		t.Fatalf("确认收款后的发卡失败：%s", note)
	}
	if fs, _ := settled["fulfillment_status"].(string); fs != "issued" {
		t.Fatalf("确认收款后应已发卡，实际 fulfillment_status=%v（note=%v）", settled["fulfillment_status"], settled["note"])
	}
	rec = env.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/issue", orderID),
		map[string]any{"note": "重复发卡应被拒绝"}, env.adminToken)
	if rec.Code != http.StatusConflict {
		t.Fatalf("重复发卡应 409，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 6) 素材：分类 → 上传（jsonb tags）→ 发布 → 前台可见
	rec = env.do(t, http.MethodPost, "/api/v1/admin/asset-categories",
		map[string]any{"name": "PG 分类", "slug": "pg-cat"}, env.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("新建分类: %d %s", rec.Code, rec.Body.String())
	}
	categoryID := uint64(jsonMap(t, rec)["id"].(float64))

	rec = env.upload(t, "/api/v1/admin/assets/upload", map[string]string{
		"title": "PG 素材", "category_id": fmt.Sprint(categoryID),
		"tags": `["pg","test"]`, "status": "published",
	}, map[string][]byte{"pg.png": makePNG(t)}, env.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("上传素材: %d %s", rec.Code, rec.Body.String())
	}
	rec = env.do(t, http.MethodGet, "/api/v1/assets?tag=pg", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("前台素材（按标签筛选）: %d %s", rec.Code, rec.Body.String())
	}
	if got := int(jsonMap(t, rec)["total"].(float64)); got != 1 {
		t.Fatalf("按标签应筛出 1 条素材（jsonb 标签查询失败），实际 %d", got)
	}

	// 7) 概览：覆盖多张表的聚合统计
	rec = env.do(t, http.MethodGet, "/api/v1/admin/overview", nil, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("概览: %d %s", rec.Code, rec.Body.String())
	}
	cards := jsonMap(t, rec)["cards"].(map[string]any)
	// 前面把套餐价格从 19.9 改成了 29.5，订单是改价之后创建的，
	// 所以实付金额应当是 29.5（同时也验证了订单快照取的是下单时的价格）。
	if cards["total_paid_amount"].(float64) != 29.5 {
		t.Fatalf("累计已支付金额应为 29.5，实际 %v", cards["total_paid_amount"])
	}

	// 8) 用户列表（覆盖跨表聚合与子查询）
	rec = env.do(t, http.MethodGet, "/api/v1/admin/users?page=1&page_size=10", nil, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("用户列表: %d %s", rec.Code, rec.Body.String())
	}
	usersPage := jsonMap(t, rec)
	if got := int(usersPage["total"].(float64)); got != 1 {
		t.Fatalf("用户数应为 1，实际 %d", got)
	}
	row := usersPage["list"].([]any)[0].(map[string]any)
	if row["redeemed_count"].(float64) != 2 {
		t.Fatalf("该用户兑换数应为 2，实际 %v", row["redeemed_count"])
	}

	// 9) 操作日志（覆盖 Distinct + Pluck）
	rec = env.do(t, http.MethodGet, "/api/v1/admin/logs?page=1&page_size=10", nil, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("日志列表: %d %s", rec.Code, rec.Body.String())
	}

	// 10) 系统设置（覆盖 Upsert 与脱敏）
	rec = env.do(t, http.MethodPut, "/api/v1/admin/settings", map[string]any{
		"items": []map[string]string{
			{"key": "site_name", "value": "PG 豆玩"},
			{"key": "payment_secret", "value": "pg-secret-9876"},
		},
	}, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("修改设置: %d %s", rec.Code, rec.Body.String())
	}
	rec = env.do(t, http.MethodGet, "/api/v1/settings/public", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("公开设置: %d %s", rec.Code, rec.Body.String())
	}
	if got := jsonMap(t, rec)["site_name"]; got != "PG 豆玩" {
		t.Fatalf("公开设置应反映修改，实际 %v", got)
	}

	// 11) 批次汇总（覆盖 GROUP BY + SUM(CASE WHEN ...)）
	rec = env.do(t, http.MethodGet, "/api/v1/admin/card-keys/batches", nil, env.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("批次汇总: %d %s", rec.Code, rec.Body.String())
	}
	var batchList []map[string]any
	if err := json.Unmarshal(decode(t, rec).Data, &batchList); err != nil {
		t.Fatalf("解析批次: %v", err)
	}
	if len(batchList) != 2 {
		t.Fatalf("应有 2 个批次（前两张 + 后三张），实际 %d", len(batchList))
	}
	var redeemedTotal float64
	for _, b := range batchList {
		redeemedTotal += b["redeemed"].(float64)
	}
	if redeemedTotal != 2 {
		t.Fatalf("两个批次里已兑换总数应为 2，实际 %v", redeemedTotal)
	}

	// 12) 权益有效性与会员状态（覆盖 entitlements → memberships 同步）
	rec = env.do(t, http.MethodGet, "/api/v1/my/entitlements", nil, userToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("我的权益: %d %s", rec.Code, rec.Body.String())
	}
	var ents []map[string]any
	if err := json.Unmarshal(decode(t, rec).Data, &ents); err != nil {
		t.Fatalf("解析权益: %v", err)
	}
	if len(ents) != 3 {
		var all []model.Entitlement
		_ = db.Where("user_id = ?", userID).Find(&all).Error
		detail := make([]string, 0, len(all))
		for i := range all {
			detail = append(detail, fmt.Sprintf("id=%d source=%s status=%s starts=%s expires=%v",
				all[i].ID, all[i].SourceType, all[i].Status, all[i].StartsAt.Format(time.RFC3339), all[i].ExpiresAt))
		}
		t.Fatalf("该用户应有 3 条权益（2 张卡密 + 1 笔订单），实际 %d；库里的记录：%v", len(ents), detail)
	}

	membership, err := repos.Membership.FindByUserID(t.Context(), userID)
	if err != nil {
		t.Fatalf("查询会员: %v", err)
	}
	if membership == nil || membership.ExpireAt == nil {
		t.Fatalf("兑换后应同步出有到期时间的会员状态，实际 %+v", membership)
	}
	if !membership.ExpireAt.After(time.Now()) {
		t.Fatalf("会员到期时间应晚于当前时间，实际 %v", membership.ExpireAt)
	}

	// 13) 用户活跃数据：冲突更新 + 聚合查询
	//
	// 这里踩过一个只在真 PG 上出现的坑：ON CONFLICT DO UPDATE 的表达式里
	// 不限定表名时，PostgreSQL 会因为 excluded 同名而报
	// `column reference "city" is ambiguous`（SQLite 会自己挑目标表的列，
	// 所以单测全绿、线上一落库就报错）。这个用例专门盯着它。
	activeUser := &model.User{Username: "pgactive", PasswordHash: "x", Status: model.UserStatusActive}
	if err := repos.User.Create(t.Context(), activeUser); err != nil {
		t.Fatalf("建活跃用户: %v", err)
	}
	day := model.ActivityDay(time.Now())
	firstActive := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	lastActive := time.Now().Add(-time.Hour).Truncate(time.Second)
	if err := repos.Activity.UpsertDaily(t.Context(), []repository.ActivityDailyDelta{{
		UserID: activeUser.ID, Day: day, FirstActiveAt: firstActive, LastActiveAt: lastActive,
		RequestCount: 3, FeatureCount: 1, IP: "203.0.113.77",
		Region: model.GeoRegion{
			Country: "中国", Province: "广东省", City: "深圳市", ISP: "电信",
			Raw: "中国|0|广东省|深圳市|电信",
		},
	}}); err != nil {
		t.Fatalf("首次写日活跃: %v", err)
	}
	later := lastActive.Add(30 * time.Minute)
	if err := repos.Activity.UpsertDaily(t.Context(), []repository.ActivityDailyDelta{{
		UserID: activeUser.ID, Day: day, FirstActiveAt: later, LastActiveAt: later,
		RequestCount: 2, FeatureCount: 4, IP: "203.0.113.78",
		// 地区留空：冲突更新时必须保留上一次的值，不能被空串覆盖
	}}); err != nil {
		t.Fatalf("冲突更新日活跃: %v", err)
	}
	dailyRows, err := repos.Activity.UserDailyList(t.Context(), activeUser.ID, day, day)
	if err != nil {
		t.Fatalf("读回日活跃: %v", err)
	}
	if len(dailyRows) != 1 {
		t.Fatalf("日活跃应只有一行，实际 %d", len(dailyRows))
	}
	daily := dailyRows[0]
	if daily.RequestCount != 5 || daily.FeatureCount != 5 {
		t.Fatalf("计数应累加为 5/5，实际 %d/%d", daily.RequestCount, daily.FeatureCount)
	}
	if !daily.FirstActiveAt.Equal(firstActive) {
		t.Fatalf("首次活跃时间应取更早的那个：期望 %s，实际 %s", firstActive, daily.FirstActiveAt)
	}
	if !daily.LastActiveAt.Equal(later) {
		t.Fatalf("最后活跃时间应取更晚的那个：期望 %s，实际 %s", later, daily.LastActiveAt)
	}
	if daily.IP != "203.0.113.78" {
		t.Fatalf("IP 应取新值，实际 %s", daily.IP)
	}
	if daily.Province != "广东省" || daily.City != "深圳市" {
		t.Fatalf("地区不该被空值覆盖，实际 %s/%s", daily.Province, daily.City)
	}

	if err := repos.Activity.UpsertFeatures(t.Context(), []repository.ActivityFeatureDelta{
		{UserID: activeUser.ID, Day: day, Feature: model.FeaturePatternMake, Source: model.ActivitySourceClient, Count: 2},
	}); err != nil {
		t.Fatalf("首次写功能统计: %v", err)
	}
	if err := repos.Activity.UpsertFeatures(t.Context(), []repository.ActivityFeatureDelta{
		{UserID: activeUser.ID, Day: day, Feature: model.FeaturePatternMake, Source: model.ActivitySourceClient, Count: 3},
	}); err != nil {
		t.Fatalf("冲突更新功能统计: %v", err)
	}
	featureRows, err := repos.Activity.UserFeatureStats(t.Context(), activeUser.ID, day, day)
	if err != nil {
		t.Fatalf("读回功能统计: %v", err)
	}
	if len(featureRows) != 1 || featureRows[0].Count != 5 {
		t.Fatalf("功能次数应累加为 5，实际 %+v", featureRows)
	}

	// 聚合查询（GROUP BY / COUNT(DISTINCT CASE WHEN ...) / SUM(CASE WHEN ...)）
	trend, err := repos.Activity.DailyTrend(t.Context(), day, day)
	if err != nil {
		t.Fatalf("趋势查询: %v", err)
	}
	if len(trend) != 1 || trend[0].ActiveUsers != 1 || trend[0].Requests != 5 {
		t.Fatalf("趋势结果不对: %+v", trend)
	}
	wau, mau, err := repos.Activity.WindowActiveCounts(t.Context(), day, day, day)
	if err != nil {
		t.Fatalf("窗口活跃查询: %v", err)
	}
	if wau != 1 || mau != 1 {
		t.Fatalf("WAU/MAU 应为 1/1，实际 %d/%d", wau, mau)
	}
	regionStats, err := repos.Activity.RegionStats(t.Context(), day, day, 10)
	if err != nil {
		t.Fatalf("地区统计: %v", err)
	}
	if len(regionStats.Provinces) != 1 || regionStats.Provinces[0].Province != "广东省" {
		t.Fatalf("地区统计结果不对: %+v", regionStats.Provinces)
	}
	featureStats, err := repos.Activity.FeatureStats(t.Context(), day, day, 10)
	if err != nil {
		t.Fatalf("功能排行: %v", err)
	}
	if len(featureStats) != 1 || featureStats[0].Count != 5 {
		t.Fatalf("功能排行结果不对: %+v", featureStats)
	}
	listRows, total, err := repos.Activity.ListUserActivity(t.Context(), repository.ActivityUserFilter{
		From: day, To: day, MinActiveDays: 1,
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10},
	})
	if err != nil {
		t.Fatalf("活跃用户列表: %v", err)
	}
	if total != 1 || len(listRows) != 1 || listRows[0].ActiveDays != 1 || listRows[0].LastDay != day {
		t.Fatalf("活跃用户列表结果不对: total=%d rows=%+v", total, listRows)
	}
	cohorts, err := repos.Activity.CohortActivity(t.Context(),
		time.Now().AddDate(0, 0, -1), time.Now().AddDate(0, 0, 1), day, day)
	if err != nil {
		t.Fatalf("留存队列查询: %v", err)
	}
	if len(cohorts) == 0 {
		t.Fatal("留存队列查询应有数据")
	}

	// 站点访问量（PV / UV）：两条 upsert 同样有 ON CONFLICT DO UPDATE 的
	// 列名歧义风险，而且读取侧是多表 join + COUNT(DISTINCT CASE WHEN ...)，
	// 都是「只在真 PG 上才暴露」的写法，必须在这里跑一遍。
	visitor := strings.Repeat("a", 32)
	later2 := later.Add(time.Hour)
	if err := repos.Visit.UpsertVisitorPages(t.Context(), []repository.VisitPageDelta{
		{Visitor: visitor, Day: day, Path: "/", PV: 2, UserID: activeUser.ID, FirstAt: firstActive, LastAt: later},
	}); err != nil {
		t.Fatalf("首次写访问明细: %v", err)
	}
	if err := repos.Visit.UpsertVisitorPages(t.Context(), []repository.VisitPageDelta{
		{Visitor: visitor, Day: day, Path: "/", PV: 3, UserID: activeUser.ID, FirstAt: later2, LastAt: later2},
	}); err != nil {
		t.Fatalf("冲突更新访问明细: %v", err)
	}
	if err := repos.Visit.UpsertVisitors(t.Context(), []repository.VisitVisitorDelta{{
		Visitor: visitor, UserID: activeUser.ID,
		FirstSeenAt: firstActive, LastSeenAt: later,
		FirstDay: day, LastDay: day, PageViews: 2,
		FirstPath: "/", LastPath: "/", Channel: model.ChannelDirect,
		IP: "203.0.113.78", Region: model.GeoRegion{Country: "中国", Province: "广东省", City: "深圳市"},
	}}); err != nil {
		t.Fatalf("首次写访客档案: %v", err)
	}
	if err := repos.Visit.UpsertVisitors(t.Context(), []repository.VisitVisitorDelta{{
		Visitor: visitor, UserID: activeUser.ID,
		FirstSeenAt: later2, LastSeenAt: later2,
		FirstDay: day, LastDay: day, PageViews: 3,
		FirstPath: "/editor", LastPath: "/editor",
		// 渠道为空表示「Unknown」：冲突时不该覆盖已经记下的首触渠道
		Channel: "", Region: model.GeoRegion{},
	}}); err != nil {
		t.Fatalf("冲突更新访客档案: %v", err)
	}
	visitTrend, err := repos.Visit.DailyTraffic(t.Context(), day, day)
	if err != nil {
		t.Fatalf("访问趋势查询: %v", err)
	}
	if len(visitTrend) != 1 || visitTrend[0].PV != 5 || visitTrend[0].Visitors != 1 {
		t.Fatalf("访问趋势结果不对: %+v", visitTrend)
	}
	visitStats, err := repos.Visit.WindowStats(t.Context(), day, day)
	if err != nil {
		t.Fatalf("访问窗口统计: %v", err)
	}
	if visitStats.PV != 5 || visitStats.Visitors != 1 || visitStats.Logged != 1 {
		t.Fatalf("访问窗口统计不对: %+v", visitStats)
	}
	visitPages, err := repos.Visit.PageStats(t.Context(), day, day, 10)
	if err != nil {
		t.Fatalf("页面排行: %v", err)
	}
	if len(visitPages) != 1 || visitPages[0].Path != "/" || visitPages[0].PV != 5 {
		t.Fatalf("页面排行结果不对: %+v", visitPages)
	}
	visitSources, err := repos.Visit.SourceStats(t.Context(), day, day, 10)
	if err != nil {
		t.Fatalf("访问来源统计: %v", err)
	}
	if len(visitSources) != 1 || visitSources[0].Channel != model.ChannelDirect || visitSources[0].Visitors != 1 {
		t.Fatalf("访问来源统计不对: %+v", visitSources)
	}
	visitRows, visitTotal, err := repos.Visit.ListVisitors(t.Context(), repository.VisitVisitorFilter{
		From: day, To: day, PageQuery: dto.PageQuery{Page: 1, PageSize: 10},
	})
	if err != nil {
		t.Fatalf("访客列表: %v", err)
	}
	if visitTotal != 1 || len(visitRows) != 1 || visitRows[0].PageViews != 5 {
		t.Fatalf("访客列表结果不对: total=%d rows=%+v", visitTotal, visitRows)
	}
	if visitRows[0].FirstPath != "/" || visitRows[0].LastPath != "/editor" {
		t.Fatalf("首触落地页不该被覆盖、最近页面应更新: %+v", visitRows[0])
	}
	if visitRows[0].Province != "广东省" || visitRows[0].City != "深圳市" {
		t.Fatalf("访客地区不该被空值覆盖: %+v", visitRows[0])
	}
	visitTotals, err := repos.Visit.Totals(t.Context())
	if err != nil {
		t.Fatalf("访问累计: %v", err)
	}
	if visitTotals.Visitors != 1 || visitTotals.PageViews != 5 {
		t.Fatalf("访问累计不对: %+v", visitTotals)
	}
	if purged, err := repos.Visit.PurgeVisitsBefore(t.Context(), day); err != nil || purged != 0 {
		t.Fatalf("清理当天不该删任何行: purged=%d err=%v", purged, err)
	}

	t.Log("PostgreSQL 冒烟测试全部通过")
}

// dropAllTables 删掉 public 下的所有表，让每次冒烟都从干净库开始。
func dropAllTables(db *gorm.DB) error {
	return db.Exec(`DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;`).Error
}
