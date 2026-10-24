package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/storage"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// 测试用管理员的登录信息。密码长度满足服务端要求（≥10 位）。
const (
	testAdminUser     = "douwanadmin"
	testAdminPassword = "admin-pass-1234"
	testCardSecret    = "test-card-cipher-secret"
)

// adminEnv 是后台测试环境：真路由 + 内存库 + 内存令牌存储 + 临时上传目录。
type adminEnv struct {
	engine     *gin.Engine
	db         *gorm.DB
	repos      *repository.Repositories
	tokens     *auth.Manager
	adminToken string
	adminID    uint64
}

func newAdminEnv(t *testing.T) *adminEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db := testsupport.NewDB(t)
	repos := repository.New(db)

	// 建一个超级管理员，用于后台接口鉴权
	hash, err := auth.HashPassword(testAdminPassword)
	if err != nil {
		t.Fatalf("生成密码哈希: %v", err)
	}
	admin := &model.Admin{
		Username: testAdminUser, PasswordHash: hash, Nickname: "测试超管",
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

	tokens := testsupport.NewTokens()
	engine := router.New(router.Deps{
		Config: &config.Config{
			App:    config.App{Name: "douwan-api", Env: "test", Debug: false},
			Server: config.Server{Port: 8080},
			CORS:   config.CORS{AllowOrigins: []string{"http://localhost:5173"}},
			Admin: config.Admin{
				CardCipherKey: testCardSecret, MaxGeneratePerRequest: 500,
				CardCodeLength: 16, CardRedeemPerMinute: 1000,
			},
		},
		DB:         db,
		Tokens:     tokens,
		TokenStore: testsupport.NewTokenStore(t),
		Storage:    store,
	})

	env := &adminEnv{engine: engine, db: db, repos: repos, tokens: tokens, adminID: admin.ID}
	env.adminToken = env.login(t, testAdminUser, testAdminPassword)
	return env
}

// login 登录并返回访问令牌。
func (e *adminEnv) login(t *testing.T, account, password string) string {
	t.Helper()
	rec := e.do(t, http.MethodPost, "/api/v1/admin/auth/login",
		map[string]any{"account": account, "password": password}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("后台登录失败: %d %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Tokens struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(decode(t, rec).Data, &payload); err != nil {
		t.Fatalf("解析登录返回: %v", err)
	}
	if payload.Tokens.AccessToken == "" {
		t.Fatal("登录返回里没有访问令牌")
	}
	return payload.Tokens.AccessToken
}

// do 发一个 JSON 请求。
func (e *adminEnv) do(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("序列化请求体: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.engine.ServeHTTP(rec, req)
	return rec
}

// upload 发一个 multipart 上传请求。
func (e *adminEnv) upload(t *testing.T, path string, fields map[string]string, files map[string][]byte, token string) *httptest.ResponseRecorder {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	for name, content := range files {
		part, err := w.CreateFormFile("files", name)
		if err != nil {
			t.Fatalf("构造上传表单: %v", err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatalf("写入上传内容: %v", err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("关闭表单: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, path, buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.engine.ServeHTTP(rec, req)
	return rec
}

// registerUser 注册一个前台用户并返回令牌与用户 ID。
func (e *adminEnv) registerUser(t *testing.T, username string) (string, uint64) {
	t.Helper()
	rec := e.do(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"username": username, "password": "user-pass-1234",
	}, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("注册用户失败: %d %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		User struct {
			ID uint64 `json:"id"`
		} `json:"user"`
		Tokens struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(decode(t, rec).Data, &payload); err != nil {
		t.Fatalf("解析注册返回: %v", err)
	}
	return payload.Tokens.AccessToken, payload.User.ID
}

// createPlan 通过后台接口新建套餐，返回套餐 ID 与 code。
func (e *adminEnv) createPlan(t *testing.T, name string, extra map[string]any) (uint64, string) {
	t.Helper()
	body := map[string]any{
		"name":  name,
		"price": 19.9,
		"benefit_config": map[string]any{
			"kind": "unlimited", "validity_type": "day", "validity_value": 7, "start_on": "redeem",
		},
		"feature_permissions": map[string]any{"export.pdf": true},
		"feature_text":        []string{"测试权益一"},
		"card_quantity":       1,
	}
	for k, v := range extra {
		body[k] = v
	}
	rec := e.do(t, http.MethodPost, "/api/v1/admin/plans", body, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("新建套餐失败: %d %s", rec.Code, rec.Body.String())
	}
	var item struct {
		ID   uint64 `json:"id"`
		Code string `json:"code"`
	}
	if err := json.Unmarshal(decode(t, rec).Data, &item); err != nil {
		t.Fatalf("解析套餐返回: %v", err)
	}
	return item.ID, item.Code
}

// publishPlan 上架套餐。
func (e *adminEnv) publishPlan(t *testing.T, planID uint64) {
	t.Helper()
	rec := e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/plans/%d/status", planID),
		map[string]any{"status": "published"}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("上架套餐失败: %d %s", rec.Code, rec.Body.String())
	}
}

// generateCards 批量生成卡密，返回批次与明文卡密。
func (e *adminEnv) generateCards(t *testing.T, planID uint64, count int, extras map[string]any) (string, []string) {
	t.Helper()
	body := map[string]any{"plan_id": planID, "count": count, "batch_name": "测试批次"}
	for k, v := range extras {
		body[k] = v
	}
	rec := e.do(t, http.MethodPost, "/api/v1/admin/card-keys/generate", body, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("生成卡密失败: %d %s", rec.Code, rec.Body.String())
	}
	var result struct {
		BatchID string   `json:"batch_id"`
		Codes   []string `json:"codes"`
	}
	if err := json.Unmarshal(decode(t, rec).Data, &result); err != nil {
		t.Fatalf("解析生成结果: %v", err)
	}
	return result.BatchID, result.Codes
}

// redeem 用前台用户令牌兑换卡密。
func (e *adminEnv) redeem(t *testing.T, token, code string) *httptest.ResponseRecorder {
	t.Helper()
	return e.do(t, http.MethodPost, "/api/v1/card-keys/redeem", map[string]any{"code": code}, token)
}

// markPaid 通过后台接口人工确认收款。
func (e *adminEnv) markPaid(t *testing.T, orderID uint64, issueCards bool, amount *float64) *httptest.ResponseRecorder {
	t.Helper()
	body := map[string]any{"note": "线下微信收款，客服已核对", "issue_cards": issueCards}
	if amount != nil {
		body["amount_paid"] = *amount
	}
	return e.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/settle", orderID), body, e.adminToken)
}

// createOrder 用前台用户令牌下单。
func (e *adminEnv) createOrder(t *testing.T, token string, planID uint64) uint64 {
	t.Helper()
	rec := e.do(t, http.MethodPost, "/api/v1/orders", map[string]any{"plan_id": planID}, token)
	if rec.Code != http.StatusCreated {
		t.Fatalf("下单失败: %d %s", rec.Code, rec.Body.String())
	}
	var item struct {
		ID uint64 `json:"id"`
	}
	if err := json.Unmarshal(decode(t, rec).Data, &item); err != nil {
		t.Fatalf("解析订单返回: %v", err)
	}
	return item.ID
}

// countTable 统计某张表的行数（用于验证幂等：重复操作不会多写记录）。
func (e *adminEnv) countTable(t *testing.T, model any, where string, args ...any) int64 {
	t.Helper()
	q := e.db.Model(model)
	if where != "" {
		q = q.Where(where, args...)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		t.Fatalf("统计数量失败: %v", err)
	}
	return count
}

// assertCode 断言业务码。
func assertCode(t *testing.T, rec *httptest.ResponseRecorder, want response.Code) {
	t.Helper()
	env := decode(t, rec)
	if env.Code != want {
		t.Fatalf("业务码期望 %d，实际 %d（%s）", want, env.Code, rec.Body.String())
	}
}

// makePNG 生成一张 2×2 的合法 PNG，用于上传测试。
//
// 之前在测试里手写字节序列很容易写错（少一个字节就不是有效 PNG），
// 用标准库生成最省事，也保证测的是「真实图片能通过校验」。
func makePNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			img.Set(x, y, color.RGBA{R: 0xF4, G: 0xA1, B: 0x5B, A: 0xFF})
		}
	}
	buf := &bytes.Buffer{}
	if err := png.Encode(buf, img); err != nil {
		t.Fatalf("生成测试 PNG: %v", err)
	}
	return buf.Bytes()
}

// 一些断言小工具，避免每个用例重复写类型断言。
func jsonMap(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(decode(t, rec).Data, &out); err != nil {
		t.Fatalf("解析返回 data: %v（%s）", err, rec.Body.String())
	}
	return out
}

// TestSeed_FirstAdminLogin 覆盖「首个管理员可以登录，错误密码被拒绝」。
func TestSeed_FirstAdminLogin(t *testing.T) {
	e := newAdminEnv(t)

	rec := e.do(t, http.MethodPost, "/api/v1/admin/auth/login",
		map[string]any{"account": testAdminUser, "password": "wrong-password-1234"}, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码应返回 401，实际 %d", rec.Code)
	}

	rec = e.do(t, http.MethodGet, "/api/v1/admin/auth/me", nil, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("查询当前管理员应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}
	data := jsonMap(t, rec)
	if data["username"] != testAdminUser {
		t.Fatalf("管理员用户名不对: %v", data["username"])
	}
	perms, ok := data["permissions"].([]any)
	if !ok || len(perms) == 0 {
		t.Fatal("超级管理员应返回全部权限点")
	}
}

// TestAdminEndpoints_RequireAdminToken 覆盖「普通用户令牌不能调后台接口」。
func TestAdminEndpoints_RequireAdminToken(t *testing.T) {
	e := newAdminEnv(t)
	userToken, _ := e.registerUser(t, "normaluser")

	cases := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/v1/admin/overview", nil},
		{http.MethodGet, "/api/v1/admin/plans", nil},
		{http.MethodGet, "/api/v1/admin/card-keys", nil},
		{http.MethodGet, "/api/v1/admin/orders", nil},
		{http.MethodGet, "/api/v1/admin/assets", nil},
		{http.MethodGet, "/api/v1/admin/users", nil},
		{http.MethodGet, "/api/v1/admin/settings", nil},
		{http.MethodGet, "/api/v1/admin/logs", nil},
		{http.MethodGet, "/api/v1/admin/admins", nil},
	}

	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			// 不带令牌
			rec := e.do(t, tc.method, tc.path, tc.body, "")
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("未登录访问 %s 应返回 401，实际 %d", tc.path, rec.Code)
			}
			// 带普通用户令牌
			rec = e.do(t, tc.method, tc.path, tc.body, userToken)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("普通用户令牌访问 %s 应返回 401，实际 %d：%s", tc.path, rec.Code, rec.Body.String())
			}
		})
	}
}

// TestPlanLifecycle_PublishRequiresValidation 覆盖套餐从草稿到上架的校验与快照。
func TestPlanLifecycle_PublishRequiresValidation(t *testing.T) {
	e := newAdminEnv(t)

	// 草稿套餐：合法
	planID, code := e.createPlan(t, "七天畅玩（测试）", nil)
	if code == "" {
		t.Fatal("套餐标识不应为空")
	}

	// 草稿状态不在前台列表里
	rec := e.do(t, http.MethodGet, "/api/v1/plans", nil, "")
	var publicList []map[string]any
	if err := json.Unmarshal(decode(t, rec).Data, &publicList); err != nil {
		t.Fatalf("解析前台套餐: %v", err)
	}
	if len(publicList) != 0 {
		t.Fatalf("草稿套餐不应出现在前台，实际 %d 条", len(publicList))
	}

	// 直接往库里塞一个「设置了有效期但数值为 0」的坏配置，
	// 用来验证上架时的服务端校验确实拦得住（接口层的入参校验已经先拦了一道）。
	broken := &model.Plan{
		Code:        "broken_plan",
		Name:        "配置不全的套餐",
		Price:       9.9,
		Status:      model.PlanStatusDraft,
		BenefitType: model.BenefitUnlimited,
		BenefitConfig: model.BenefitConfig{
			Kind: model.BenefitUnlimited, ValidityType: model.ValidityDay, ValidityValue: 0,
			Permissions: model.BenefitPermissions{}, StartOn: model.StartOnRedeem,
		},
		ValidityType: model.ValidityDay, ValidityValue: 0,
		FeaturePermissions: model.BenefitPermissions{}, FeatureText: []string{},
		CardQuantity: 1,
	}
	if err := e.repos.Plan.Create(t.Context(), broken); err != nil {
		t.Fatalf("插入测试套餐: %v", err)
	}
	rec = e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/plans/%d/status", broken.ID),
		map[string]any{"status": "published"}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("配置不全的套餐上架应返回 400，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 接口层也要拦住：额度为 0 的 quota 套餐根本建不出来
	rec = e.do(t, http.MethodPost, "/api/v1/admin/plans", map[string]any{
		"name":  "非法额度套餐",
		"price": 9.9,
		"benefit_config": map[string]any{
			"kind": "quota", "usage_limit": 0, "validity_type": "day", "validity_value": 7,
		},
	}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("额度为 0 的 quota 套餐应被拒绝，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 上架合法套餐
	e.publishPlan(t, planID)

	rec = e.do(t, http.MethodGet, "/api/v1/plans", nil, "")
	if err := json.Unmarshal(decode(t, rec).Data, &publicList); err != nil {
		t.Fatalf("解析前台套餐: %v", err)
	}
	if len(publicList) != 1 {
		t.Fatalf("上架后前台应有 1 个套餐，实际 %d 条", len(publicList))
	}
	if publicList[0]["price"].(float64) != 19.9 {
		t.Fatalf("前台套餐价格应来自数据库，实际 %v", publicList[0]["price"])
	}

	// 下架后又不可见
	rec = e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/plans/%d/status", planID),
		map[string]any{"status": "archived"}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("下架应返回 200，实际 %d", rec.Code)
	}
	rec = e.do(t, http.MethodGet, "/api/v1/plans", nil, "")
	if err := json.Unmarshal(decode(t, rec).Data, &publicList); err != nil {
		t.Fatalf("解析前台套餐: %v", err)
	}
	if len(publicList) != 0 {
		t.Fatalf("下架后前台不应有套餐，实际 %d 条", len(publicList))
	}
}

// TestCardKey_RedeemOnce 覆盖「同一张卡密不能兑换两次」。
func TestCardKey_RedeemOnce(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "测试套餐", nil)
	e.publishPlan(t, planID)
	_, codes := e.generateCards(t, planID, 1, nil)

	tokenA, userA := e.registerUser(t, "alice001")
	tokenB, _ := e.registerUser(t, "bob0001")

	// 第一次兑换成功
	rec := e.redeem(t, tokenA, codes[0])
	if rec.Code != http.StatusOK {
		t.Fatalf("首次兑换应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}
	var result struct {
		PlanName      string `json:"plan_name"`
		EntitlementID uint64 `json:"entitlement_id"`
		ExpiresAt     string `json:"expires_at"`
		Message       string `json:"message"`
	}
	if err := json.Unmarshal(decode(t, rec).Data, &result); err != nil {
		t.Fatalf("解析兑换返回: %v", err)
	}
	if result.EntitlementID == 0 || result.ExpiresAt == "" {
		t.Fatalf("兑换应返回权益与到期时间: %+v", result)
	}

	// 同一用户重复兑换失败
	rec = e.redeem(t, tokenA, codes[0])
	if rec.Code != http.StatusConflict {
		t.Fatalf("重复兑换应返回 409，实际 %d：%s", rec.Code, rec.Body.String())
	}
	assertCode(t, rec, response.CodeCardUsed)

	// 另一个用户兑换同一张也失败
	rec = e.redeem(t, tokenB, codes[0])
	if rec.Code != http.StatusConflict {
		t.Fatalf("他人兑换已用卡密应返回 409，实际 %d", rec.Code)
	}

	// 权益只应该有一条
	if got := e.countTable(t, &model.Entitlement{}, "user_id = ?", userA); got != 1 {
		t.Fatalf("用户权益记录应为 1 条，实际 %d", got)
	}
	// 会员状态已同步
	membership, err := e.repos.Membership.FindByUserID(t.Context(), userA)
	if err != nil {
		t.Fatalf("查询会员: %v", err)
	}
	if membership == nil || membership.Plan != "draft_single" && membership.Plan == "" {
		t.Fatalf("兑换后应同步会员套餐，实际 %+v", membership)
	}
	if membership.ExpireAt == nil {
		t.Fatal("7 天套餐兑换后应有到期时间")
	}
}

// TestCardKey_RedeemRejectsInvalid 覆盖过期与作废卡密不能兑换。
func TestCardKey_RedeemRejectsInvalid(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "测试套餐", nil)
	e.publishPlan(t, planID)

	token, _ := e.registerUser(t, "carol001")

	// 已过期的卡密：先生成，再直接把截止时间改到过去。
	// 不通过生成接口传过去的时间，因为生成接口会校验「必须晚于当前时间」。
	_, expired := e.generateCards(t, planID, 1, nil)
	expiredCard, err := e.repos.CardKey.FindByCodeHash(t.Context(), hashCard(t, expired[0]))
	if err != nil {
		t.Fatalf("查询卡密: %v", err)
	}
	past := time.Now().Add(-time.Hour)
	if err := e.repos.CardKey.AttachRedeemResult(t.Context(), expiredCard.ID, map[string]any{
		"redeem_expires_at": past,
	}); err != nil {
		t.Fatalf("构造过期卡密: %v", err)
	}
	rec := e.redeem(t, token, expired[0])
	if rec.Code != http.StatusConflict {
		t.Fatalf("过期卡密应被拒绝，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 作废的卡密
	_, toVoid := e.generateCards(t, planID, 1, nil)
	rec = e.do(t, http.MethodGet, "/api/v1/admin/card-keys?page=1&page_size=50", nil, e.adminToken)
	page := jsonMap(t, rec)
	list, _ := page["list"].([]any)
	var targetID float64
	for _, raw := range list {
		item := raw.(map[string]any)
		if item["status"] == "unused" {
			targetID = item["id"].(float64)
			break
		}
	}
	if targetID == 0 {
		t.Fatal("没找到未使用的卡密")
	}
	rec = e.do(t, http.MethodPost, "/api/v1/admin/card-keys/void", map[string]any{
		"ids": []uint64{uint64(targetID)}, "reason": "测试作废",
	}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("作废卡密应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}

	rec = e.redeem(t, token, toVoid[0])
	if rec.Code != http.StatusConflict {
		t.Fatalf("作废卡密应被拒绝，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 不存在的卡密
	rec = e.redeem(t, token, "AAAA-BBBB-CCCC-DDDD")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("不存在的卡密应返回 404，实际 %d", rec.Code)
	}
}

// TestCardKey_RevealAndExport 覆盖明文查看与导出都要写日志。
func TestCardKey_RevealAndExport(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "测试套餐", nil)
	e.publishPlan(t, planID)
	_, codes := e.generateCards(t, planID, 3, nil)

	// 列表默认脱敏
	rec := e.do(t, http.MethodGet, "/api/v1/admin/card-keys?page=1&page_size=10", nil, e.adminToken)
	page := jsonMap(t, rec)
	list, _ := page["list"].([]any)
	if len(list) != 3 {
		t.Fatalf("卡密列表应有 3 条，实际 %d", len(list))
	}
	first := list[0].(map[string]any)
	masked := first["code_masked"].(string)
	if !strings.Contains(masked, "*") {
		t.Fatalf("列表默认应脱敏，实际 %q", masked)
	}

	ids := make([]uint64, 0, len(list))
	for _, raw := range list {
		ids = append(ids, uint64(raw.(map[string]any)["id"].(float64)))
	}

	// 查看明文
	rec = e.do(t, http.MethodPost, "/api/v1/admin/card-keys/reveal", map[string]any{"ids": ids}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("查看明文应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}
	data := jsonMap(t, rec)
	revealed, _ := data["codes"].(map[string]any)
	if len(revealed) != 3 {
		t.Fatalf("应返回 3 张明文，实际 %d", len(revealed))
	}
	// 明文必须与生成时返回的一致（去掉连字符比较）
	found := false
	for _, v := range revealed {
		if normalizeCode(v.(string)) == normalizeCode(codes[0]) {
			found = true
		}
	}
	if !found {
		t.Fatal("查看明文的结果与生成时不匹配")
	}

	// 导出明文 CSV
	rec = e.do(t, http.MethodPost, "/api/v1/admin/card-keys/export",
		map[string]any{"plan_id": planID, "reveal": true}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("导出应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "卡密") {
		t.Fatal("导出的 CSV 应包含表头")
	}
	if !strings.Contains(rec.Body.String(), normalizeCode(codes[0])[:4]) {
		t.Fatal("导出的 CSV 应包含明文卡密")
	}

	// 查看与导出都要有日志
	revealLogs := e.countTable(t, &model.OperationLog{}, "action = ?", "card.reveal")
	if revealLogs == 0 {
		t.Fatal("查看明文应写操作日志")
	}
	exportLogs := e.countTable(t, &model.OperationLog{}, "action = ?", "card.export")
	if exportLogs == 0 {
		t.Fatal("导出卡密应写操作日志")
	}
}

// TestOrder_ManualSettleAndIssueOnce 覆盖人工确认收款 + 幂等发卡。
func TestOrder_ManualSettleAndIssueOnce(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "测试套餐", nil)
	e.publishPlan(t, planID)
	e.generateCards(t, planID, 5, nil)

	token, userID := e.registerUser(t, "dave0001")
	orderID := e.createOrder(t, token, planID)

	// 未支付不能发卡
	rec := e.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/issue", orderID),
		map[string]any{"note": "尝试未支付发卡"}, e.adminToken)
	if rec.Code != http.StatusConflict {
		t.Fatalf("未支付订单发卡应失败，实际 %d：%s", rec.Code, rec.Body.String())
	}
	assertCode(t, rec, response.CodeOrderNotPaid)

	// 人工确认收款并发卡
	rec = e.markPaid(t, orderID, true, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("确认收款应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 重复确认收款应被拒绝
	rec = e.markPaid(t, orderID, false, nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("重复确认收款应返回 409，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 重复发卡应被拒绝
	rec = e.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/issue", orderID),
		map[string]any{"note": "重复发卡"}, e.adminToken)
	if rec.Code != http.StatusConflict {
		t.Fatalf("重复发卡应返回 409，实际 %d：%s", rec.Code, rec.Body.String())
	}
	assertCode(t, rec, response.CodeAlreadyIssued)

	// 权益只发了一次
	if got := e.countTable(t, &model.Entitlement{}, "user_id = ? AND source_type = ?", userID, model.EntitlementSourceOrder); got != 1 {
		t.Fatalf("订单权益应只有 1 条，实际 %d", got)
	}
	// 该订单只挂了 1 张卡密
	if got := e.countTable(t, &model.CardKey{}, "order_id = ?", orderID); got != 1 {
		t.Fatalf("订单应只关联 1 张卡密，实际 %d", got)
	}

	// 自己订单的卡密不能自己兑换（避免双倍发放）
	rec = e.do(t, http.MethodGet, "/api/v1/admin/card-keys?page=1&page_size=10", nil, e.adminToken)
	page := jsonMap(t, rec)
	var codeID uint64
	for _, raw := range page["list"].([]any) {
		item := raw.(map[string]any)
		if item["order_id"].(float64) == float64(orderID) {
			codeID = uint64(item["id"].(float64))
		}
	}
	rec = e.do(t, http.MethodPost, "/api/v1/admin/card-keys/reveal",
		map[string]any{"ids": []uint64{codeID}}, e.adminToken)
	plain := jsonMap(t, rec)["codes"].(map[string]any)
	var code string
	for _, v := range plain {
		code = v.(string)
	}
	rec = e.redeem(t, token, code)
	if rec.Code != http.StatusConflict {
		t.Fatalf("自己订单的卡密不应允许本人重复兑换，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 订单里的金额与快照
	order, err := e.repos.Order.FindByID(t.Context(), orderID)
	if err != nil {
		t.Fatalf("查询订单: %v", err)
	}
	if order.AmountPaid != 19.9 {
		t.Fatalf("实付金额应为 19.9，实际 %v", order.AmountPaid)
	}
	if order.PlanSnapshot.Amount != 19.9 || order.PlanSnapshot.Name != "测试套餐" {
		t.Fatalf("订单应保存套餐快照，实际 %+v", order.PlanSnapshot)
	}
	if order.FulfillmentStatus != model.FulfillmentIssued {
		t.Fatalf("发卡状态应为已发放，实际 %s", order.FulfillmentStatus)
	}

	// 改价后历史订单快照不受影响
	rec = e.do(t, http.MethodPut, fmt.Sprintf("/api/v1/admin/plans/%d", planID), map[string]any{
		"name": "测试套餐", "price": 99.0,
		"benefit_config": map[string]any{"kind": "unlimited", "validity_type": "day", "validity_value": 7},
	}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("改价应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}
	reloaded, err := e.repos.Order.FindByID(t.Context(), orderID)
	if err != nil {
		t.Fatalf("重新查询订单: %v", err)
	}
	if reloaded.PlanSnapshot.Amount != 19.9 {
		t.Fatalf("改价后历史订单快照不应变化，实际 %v", reloaded.PlanSnapshot.Amount)
	}
}

// TestOrder_ClosedOrderCannotIssue 覆盖未支付订单不能发卡、关闭后不可发卡。
func TestOrder_ClosedOrderCannotIssue(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "测试套餐", nil)
	e.publishPlan(t, planID)

	token, _ := e.registerUser(t, "erin0001")
	orderID := e.createOrder(t, token, planID)

	rec := e.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/close", orderID),
		map[string]any{"reason": "用户取消"}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("关闭订单应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}

	rec = e.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/settle", orderID),
		map[string]any{"note": "已关闭订单不该能确认收款"}, e.adminToken)
	if rec.Code != http.StatusConflict {
		t.Fatalf("已关闭订单确认收款应失败，实际 %d：%s", rec.Code, rec.Body.String())
	}
}

// TestCardKey_GenerateValidation 覆盖生成数量的服务端上限与重复卡密防护。
func TestCardKey_GenerateValidation(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "测试套餐", nil)

	rec := e.do(t, http.MethodPost, "/api/v1/admin/card-keys/generate",
		map[string]any{"plan_id": planID, "count": 99999}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("超出上限应返回 400，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 没配权益的套餐生成的卡密兑换后什么都解锁不了，必须在生成时就拒绝
	noPermID, _ := e.createPlan(t, "无权益套餐", map[string]any{
		"feature_permissions": map[string]any{},
		"feature_text":        []string{},
	})
	rec = e.do(t, http.MethodPost, "/api/v1/admin/card-keys/generate",
		map[string]any{"plan_id": noPermID, "count": 1}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("未配置权益的套餐不应生成卡密，实际 %d：%s", rec.Code, rec.Body.String())
	}

	_, codes := e.generateCards(t, planID, 20, nil)
	seen := map[string]bool{}
	for _, c := range codes {
		key := normalizeCode(c)
		if seen[key] {
			t.Fatalf("生成了重复卡密: %s", c)
		}
		seen[key] = true
	}
	if len(codes) != 20 {
		t.Fatalf("应生成 20 张，实际 %d", len(codes))
	}
	// 卡密不应包含容易混淆的字符
	for _, c := range codes {
		for _, bad := range []string{"O", "0", "I", "1", "L"} {
			if strings.Contains(normalizeCode(c), bad) {
				t.Fatalf("卡密 %s 包含易混淆字符 %s", c, bad)
			}
		}
	}
}

func normalizeCode(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if r == '-' || r == ' ' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// 保证 database 包被引用（并发测试里用同一个迁移入口）。
var _ = database.AutoMigrate
