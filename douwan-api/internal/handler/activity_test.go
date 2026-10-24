package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// activityEnv 是活跃监控的测试环境：真路由 + 内存库 + 真采集器。
//
// 采集器的 flush 周期设成 1 小时并且不启动后台协程，
// 这样「什么时候落库」完全由测试调用 Flush 决定，断言才是确定的。
type activityEnv struct {
	engine     *gin.Engine
	db         *gorm.DB
	repos      *repository.Repositories
	recorder   *activity.Recorder
	adminToken string
}

func newActivityEnv(t *testing.T, enabled bool) *activityEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db := testsupport.NewDB(t)
	repos := repository.New(db)

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

	recorder := activity.NewRecorder(config.Activity{
		Enabled:              enabled,
		FlushInterval:        time.Hour,
		BufferLimit:          1000,
		RetainDays:           30,
		CleanupInterval:      time.Hour,
		EventReportPerMinute: 1000,
	}, repos, nil)

	tokens := testsupport.NewTokens()
	engine := router.New(router.Deps{
		Config: &config.Config{
			App:    config.App{Name: "douwan-api", Env: "test", Debug: false},
			Server: config.Server{Port: 8080},
			CORS:   config.CORS{AllowOrigins: []string{"http://localhost:5173"}},
			Activity: config.Activity{
				Enabled: enabled, FlushInterval: time.Hour, BufferLimit: 1000,
				RetainDays: 30, CleanupInterval: time.Hour, EventReportPerMinute: 1000,
			},
		},
		DB:         db,
		Tokens:     tokens,
		TokenStore: testsupport.NewTokenStore(t),
		Activity:   recorder,
	})

	env := &activityEnv{engine: engine, db: db, repos: repos, recorder: recorder}
	env.adminToken = env.loginAdmin(t)
	return env
}

func (e *activityEnv) loginAdmin(t *testing.T) string {
	t.Helper()
	rec := e.do(t, http.MethodPost, "/api/v1/admin/auth/login",
		map[string]any{"account": testAdminUser, "password": testAdminPassword}, "")
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
	return payload.Tokens.AccessToken
}

// do 发一个 JSON 请求。
func (e *activityEnv) do(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
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

func TestActivityMonitoringFlow(t *testing.T) {
	env := newActivityEnv(t, true)
	ctx := t.Context()

	// 1) 未登录不能看后台活跃数据
	if rec := env.do(t, http.MethodGet, "/api/v1/admin/activity/overview", nil, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("未登录状态码 = %d，期望 401", rec.Code)
	}

	// 2) 注册一个带渠道的用户（注册请求本身也是一次活跃行为）
	reg := env.do(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"username": "activityuser", "password": "secret-pass-1", "channel": "gitee",
	}, "")
	if reg.Code != http.StatusCreated {
		t.Fatalf("注册失败: %d %s", reg.Code, reg.Body.String())
	}
	var auth struct {
		User struct {
			ID uint64 `json:"id"`
		} `json:"user"`
		Tokens struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(decode(t, reg).Data, &auth); err != nil {
		t.Fatalf("解析注册返回: %v", err)
	}

	// 3) 模拟前端调用两次「我的账户」+ 一次客户端埋点上报
	for i := 0; i < 2; i++ {
		if rec := env.do(t, http.MethodGet, "/api/v1/users/me", nil, auth.Tokens.AccessToken); rec.Code != http.StatusOK {
			t.Fatalf("查询我的账户失败: %d %s", rec.Code, rec.Body.String())
		}
	}
	report := env.do(t, http.MethodPost, "/api/v1/events", map[string]any{
		"events": []map[string]any{{"feature": model.FeaturePatternMake, "count": 2}},
	}, auth.Tokens.AccessToken)
	if report.Code != http.StatusOK {
		t.Fatalf("埋点上报失败: %d %s", report.Code, report.Body.String())
	}
	if payload := decode(t, report); payload.Code != response.CodeOK {
		t.Fatalf("埋点上报业务码 = %d", payload.Code)
	}

	// 4) 手动落库（线上由后台协程按周期做）
	if err := env.recorder.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}

	// 5) 日活跃汇总：3 次请求（注册 + 两次 me），5 次功能（注册 + 两次 me + 两次生成图纸）
	var daily model.UserDailyActivity
	if err := env.db.Where("user_id = ?", auth.User.ID).First(&daily).Error; err != nil {
		t.Fatalf("读回日活跃失败: %v", err)
	}
	if daily.RequestCount != 3 {
		t.Fatalf("请求次数 = %d，期望 3", daily.RequestCount)
	}
	if daily.FeatureCount != 5 {
		t.Fatalf("功能次数 = %d，期望 5", daily.FeatureCount)
	}

	// 6) 来源渠道写进了用户表（首触归因）
	user, err := env.repos.User.FindByID(ctx, auth.User.ID)
	if err != nil {
		t.Fatalf("读回用户失败: %v", err)
	}
	if user.Channel != "gitee" {
		t.Fatalf("渠道 = %q，期望 gitee", user.Channel)
	}

	// 7) 概览
	overview := env.do(t, http.MethodGet, "/api/v1/admin/activity/overview?days=7", nil, env.adminToken)
	if overview.Code != http.StatusOK {
		t.Fatalf("概览失败: %d %s", overview.Code, overview.Body.String())
	}
	var ov struct {
		Enabled bool `json:"enabled"`
		Cards   struct {
			DAU        int64 `json:"dau"`
			TodayNew   int64 `json:"today_new_users"`
			ActiveUser int64 `json:"active_users"`
			NewUsers   int64 `json:"new_users"`
			Requests   int64 `json:"requests"`
		} `json:"cards"`
		Trend []struct {
			Day         string `json:"day"`
			ActiveUsers int64  `json:"active_users"`
		} `json:"trend"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(decode(t, overview).Data, &ov); err != nil {
		t.Fatalf("解析概览: %v", err)
	}
	if !ov.Enabled || ov.Cards.DAU != 1 || ov.Cards.TodayNew != 1 {
		t.Fatalf("概览卡片不对: %+v", ov.Cards)
	}
	if ov.Cards.ActiveUser != 1 || ov.Cards.NewUsers != 1 || ov.Cards.Requests != 3 {
		t.Fatalf("窗口统计不对: %+v", ov.Cards)
	}
	if len(ov.Trend) != 7 || ov.Trend[6].ActiveUsers != 1 {
		t.Fatalf("趋势不对: %+v", ov.Trend)
	}
	if len(ov.Notes) == 0 {
		t.Fatal("概览必须返回统计口径说明")
	}

	// 8) 功能排行：接口统计与客户端上报要分开出现
	features := env.do(t, http.MethodGet, "/api/v1/admin/activity/features?days=7", nil, env.adminToken)
	if features.Code != http.StatusOK {
		t.Fatalf("功能排行失败: %d", features.Code)
	}
	var fv struct {
		Items []struct {
			Feature string `json:"feature"`
			Source  string `json:"source"`
			Users   int64  `json:"users"`
			Count   int64  `json:"count"`
		} `json:"items"`
	}
	if err := json.Unmarshal(decode(t, features).Data, &fv); err != nil {
		t.Fatalf("解析功能排行: %v", err)
	}
	got := map[string]int64{}
	for _, item := range fv.Items {
		got[item.Feature+"/"+item.Source] = item.Count
	}
	if got[model.FeatureAccountProfile+"/"+model.ActivitySourceAPI] != 2 {
		t.Fatalf("查看账户次数不对: %+v", got)
	}
	if got[model.FeaturePatternMake+"/"+model.ActivitySourceClient] != 2 {
		t.Fatalf("客户端上报的生成图纸次数不对: %+v", got)
	}
	if got[model.FeatureAccountRegister+"/"+model.ActivitySourceAPI] != 1 {
		t.Fatalf("注册次数不对: %+v", got)
	}

	// 9) 渠道分布
	channels := env.do(t, http.MethodGet, "/api/v1/admin/activity/channels?days=7", nil, env.adminToken)
	if channels.Code != http.StatusOK {
		t.Fatalf("渠道分布失败: %d", channels.Code)
	}
	var cv struct {
		Items []struct {
			Channel     string  `json:"channel"`
			Label       string  `json:"channel_label"`
			NewUsers    int64   `json:"new_users"`
			ActiveUsers int64   `json:"active_users"`
			ActiveRate  float64 `json:"active_rate"`
		} `json:"items"`
	}
	if err := json.Unmarshal(decode(t, channels).Data, &cv); err != nil {
		t.Fatalf("解析渠道分布: %v", err)
	}
	if len(cv.Items) != 1 || cv.Items[0].Channel != "gitee" {
		t.Fatalf("渠道分布不对: %+v", cv.Items)
	}
	if cv.Items[0].NewUsers != 1 || cv.Items[0].ActiveUsers != 1 || cv.Items[0].ActiveRate != 100 {
		t.Fatalf("gitee 渠道指标不对: %+v", cv.Items[0])
	}

	// 10) 活跃用户列表与详情
	users := env.do(t, http.MethodGet, "/api/v1/admin/activity/users?days=7&min_active_days=1", nil, env.adminToken)
	if users.Code != http.StatusOK {
		t.Fatalf("活跃用户列表失败: %d", users.Code)
	}
	var uv struct {
		Total int64 `json:"total"`
		List  []struct {
			UserID     uint64 `json:"user_id"`
			Username   string `json:"username"`
			Channel    string `json:"channel"`
			ActiveDays int64  `json:"active_days"`
			LastIP     string `json:"last_ip"`
		} `json:"list"`
	}
	if err := json.Unmarshal(decode(t, users).Data, &uv); err != nil {
		t.Fatalf("解析活跃用户列表: %v", err)
	}
	if uv.Total != 1 || len(uv.List) != 1 || uv.List[0].Username != "activityuser" {
		t.Fatalf("活跃用户列表不对: %+v", uv)
	}
	if uv.List[0].ActiveDays != 1 || uv.List[0].Channel != "gitee" {
		t.Fatalf("活跃用户指标不对: %+v", uv.List[0])
	}
	if uv.List[0].LastIP != "192.0.2.*" {
		t.Fatalf("IP 必须脱敏: %q", uv.List[0].LastIP)
	}

	detail := env.do(t, http.MethodGet, "/api/v1/admin/activity/users/"+strconv.FormatUint(uv.List[0].UserID, 10)+"?days=7", nil, env.adminToken)
	if detail.Code != http.StatusOK {
		t.Fatalf("用户活跃详情失败: %d %s", detail.Code, detail.Body.String())
	}
	var dv struct {
		TotalActiveDay int64 `json:"total_active_days"`
		TotalRequests  int64 `json:"total_requests"`
		Daily          []struct {
			Day      string `json:"day"`
			Requests int64  `json:"requests"`
			IP       string `json:"ip"`
		} `json:"daily"`
		Features []struct {
			Feature string `json:"feature"`
		} `json:"features"`
	}
	if err := json.Unmarshal(decode(t, detail).Data, &dv); err != nil {
		t.Fatalf("解析用户活跃详情: %v", err)
	}
	if dv.TotalActiveDay != 1 || dv.TotalRequests != 3 || len(dv.Daily) != 1 {
		t.Fatalf("用户活跃详情不对: %+v", dv)
	}
	if dv.Daily[0].IP != "192.0.2.*" {
		t.Fatalf("明细里的 IP 也要脱敏: %q", dv.Daily[0].IP)
	}
	if len(dv.Features) != 3 {
		t.Fatalf("功能明细 = %d 条，期望 3（注册 / 查看账户 / 生成图纸）", len(dv.Features))
	}
}

func TestActivityEventReportValidation(t *testing.T) {
	env := newActivityEnv(t, true)

	reg := env.do(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"username": "reporter01", "password": "secret-pass-1",
	}, "")
	if reg.Code != http.StatusCreated {
		t.Fatalf("注册失败: %d %s", reg.Code, reg.Body.String())
	}
	var auth struct {
		Tokens struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(decode(t, reg).Data, &auth); err != nil {
		t.Fatalf("解析注册返回: %v", err)
	}

	// 未登录不能上报
	if rec := env.do(t, http.MethodPost, "/api/v1/events", map[string]any{
		"events": []map[string]any{{"feature": model.FeaturePatternMake}},
	}, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("未登录上报状态码 = %d，期望 401", rec.Code)
	}

	// 全部被拒：给出专门的功能点错误码，前端联调时能立刻发现
	bad := env.do(t, http.MethodPost, "/api/v1/events", map[string]any{
		"events": []map[string]any{{"feature": "not.a.feature"}},
	}, auth.Tokens.AccessToken)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("未知功能点状态码 = %d，期望 400", bad.Code)
	}
	if payload := decode(t, bad); payload.Code != response.CodeEventFeatureUnknown {
		t.Fatalf("未知功能点业务码 = %d，期望 %d", payload.Code, response.CodeEventFeatureUnknown)
	}

	// 服务端自己统计的功能点也不接受上报
	server := env.do(t, http.MethodPost, "/api/v1/events", map[string]any{
		"events": []map[string]any{{"feature": model.FeatureAccountLogin}},
	}, auth.Tokens.AccessToken)
	if payload := decode(t, server); payload.Code != response.CodeEventFeatureUnknown {
		t.Fatalf("服务端功能点业务码 = %d，期望 %d", payload.Code, response.CodeEventFeatureUnknown)
	}

	// 空数组：参数校验就该拦住
	empty := env.do(t, http.MethodPost, "/api/v1/events", map[string]any{"events": []map[string]any{}},
		auth.Tokens.AccessToken)
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("空事件数组状态码 = %d，期望 400", empty.Code)
	}
}

func TestActivityDisabledReturnsEmptyWithNotes(t *testing.T) {
	env := newActivityEnv(t, false)

	overview := env.do(t, http.MethodGet, "/api/v1/admin/activity/overview", nil, env.adminToken)
	if overview.Code != http.StatusOK {
		t.Fatalf("采集关闭时概览仍应可访问: %d %s", overview.Code, overview.Body.String())
	}
	var ov struct {
		Enabled bool `json:"enabled"`
		Cards   struct {
			DAU int64 `json:"dau"`
		} `json:"cards"`
	}
	if err := json.Unmarshal(decode(t, overview).Data, &ov); err != nil {
		t.Fatalf("解析概览: %v", err)
	}
	if ov.Enabled {
		t.Fatal("采集关闭时 enabled 应为 false")
	}
	if ov.Cards.DAU != 0 {
		t.Fatalf("采集关闭时不该有活跃数据: %+v", ov.Cards)
	}

	// 上报接口在采集关闭时不报错，但要明确告知调用方数据被忽略了
	reg := env.do(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"username": "disabled01", "password": "secret-pass-1",
	}, "")
	if reg.Code != http.StatusCreated {
		t.Fatalf("注册失败: %d %s", reg.Code, reg.Body.String())
	}
	var auth struct {
		Tokens struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(decode(t, reg).Data, &auth); err != nil {
		t.Fatalf("解析注册返回: %v", err)
	}
	report := env.do(t, http.MethodPost, "/api/v1/events", map[string]any{
		"events": []map[string]any{{"feature": model.FeaturePatternMake}},
	}, auth.Tokens.AccessToken)
	if report.Code != http.StatusOK {
		t.Fatalf("采集关闭时上报不该报错: %d %s", report.Code, report.Body.String())
	}
	var rv struct {
		Enabled  bool   `json:"enabled"`
		Accepted int    `json:"accepted"`
		Message  string `json:"message"`
	}
	if err := json.Unmarshal(decode(t, report).Data, &rv); err != nil {
		t.Fatalf("解析上报结果: %v", err)
	}
	if rv.Enabled || rv.Accepted != 0 || rv.Message == "" {
		t.Fatalf("采集关闭时应明确告知: %+v", rv)
	}

	// 采集关闭时不该产生任何活跃数据
	var count int64
	if err := env.db.Model(&model.UserDailyActivity{}).Count(&count).Error; err != nil {
		t.Fatalf("统计日活跃行数失败: %v", err)
	}
	if count != 0 {
		t.Fatalf("采集关闭时不该落库，实际 %d 行", count)
	}
}
