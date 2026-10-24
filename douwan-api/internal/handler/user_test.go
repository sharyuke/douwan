package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// env 是测试用的路由环境：真路由 + 内存库 + 内存令牌存储。
type env struct {
	engine *gin.Engine
	tokens *auth.Manager
}

func newEnv(t *testing.T) *env {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db := testsupport.NewDB(t)
	tokens := testsupport.NewTokens()
	engine := router.New(router.Deps{
		Config: &config.Config{
			App:    config.App{Name: "douwan-api", Env: "test", Debug: false},
			Server: config.Server{Port: 8080},
			CORS:   config.CORS{AllowOrigins: []string{"http://localhost:5173"}},
		},
		DB:         db,
		Tokens:     tokens,
		TokenStore: testsupport.NewTokenStore(t),
	})
	return &env{engine: engine, tokens: tokens}
}

// do 发一个请求。body 为 nil 表示不带请求体，token 为空表示不带认证头。
func (e *env) do(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
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

// envelope 是响应体的通用结构，data 留成原始 JSON 由各用例自行解析。
type envelope struct {
	Code      response.Code   `json:"code"`
	Message   string          `json:"message"`
	Data      json.RawMessage `json:"data"`
	RequestID string          `json:"request_id"`
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("解析响应体失败: %v（原文 %s）", err, rec.Body.String())
	}
	return env
}

// authPayload 对应注册 / 登录返回的 data。
type authPayload struct {
	User struct {
		ID       uint64 `json:"id"`
		Username string `json:"username"`
		Nickname string `json:"nickname"`
	} `json:"user"`
	Tokens struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int64  `json:"expires_in"`
	} `json:"tokens"`
}

func registerBody() map[string]any {
	return map[string]any{
		"username": "douwaner",
		"password": "secret-pass-1",
		"nickname": "拼豆小工",
	}
}

func (e *env) register(t *testing.T) authPayload {
	t.Helper()
	rec := e.do(t, http.MethodPost, "/api/v1/auth/register", registerBody(), "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("注册应返回 201，实际 %d：%s", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	if env.Code != response.CodeOK {
		t.Fatalf("注册业务码应为 0，实际 %d：%s", env.Code, env.Message)
	}
	var payload authPayload
	if err := json.Unmarshal(env.Data, &payload); err != nil {
		t.Fatalf("解析注册返回: %v", err)
	}
	return payload
}

func TestRegisterThenMe(t *testing.T) {
	e := newEnv(t)
	payload := e.register(t)

	if payload.User.ID == 0 || payload.Tokens.AccessToken == "" {
		t.Fatalf("注册返回不完整: %+v", payload)
	}
	if payload.Tokens.TokenType != "Bearer" || payload.Tokens.ExpiresIn <= 0 {
		t.Fatalf("令牌信息不完整: %+v", payload.Tokens)
	}

	rec := e.do(t, http.MethodGet, "/api/v1/users/me", nil, payload.Tokens.AccessToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("查询资料应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	if env.RequestID == "" {
		t.Fatal("响应应带上 request_id，便于排查问题")
	}

	var me struct {
		User struct {
			Username string `json:"username"`
		} `json:"user"`
		Membership struct {
			Plan  string `json:"plan"`
			IsPro bool   `json:"is_pro"`
		} `json:"membership"`
	}
	if err := json.Unmarshal(env.Data, &me); err != nil {
		t.Fatalf("解析资料返回: %v", err)
	}
	if me.User.Username != "douwaner" {
		t.Fatalf("用户名不对: %q", me.User.Username)
	}
	if me.Membership.Plan != "free" || me.Membership.IsPro {
		t.Fatalf("新用户应为免费套餐: %+v", me.Membership)
	}
}

func TestRegister_ValidationErrors(t *testing.T) {
	cases := []struct {
		name    string
		body    map[string]any
		wantMsg string
	}{
		{"用户名过短", map[string]any{"username": "ab", "password": "secret-pass-1"}, "用户名长度不能小于 3"},
		{"缺少密码", map[string]any{"username": "douwaner"}, "密码不能为空"},
		{"密码过短", map[string]any{"username": "douwaner", "password": "short"}, "密码长度不能小于 8"},
		{"用户名含非法字符", map[string]any{"username": "豆玩_1", "password": "secret-pass-1"}, "用户名只能包含字母和数字"},
		{"邮箱格式错误", map[string]any{"username": "douwaner", "password": "secret-pass-1", "email": "not-an-email"}, "邮箱格式不正确"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			rec := e.do(t, http.MethodPost, "/api/v1/auth/register", tc.body, "")
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("应返回 400，实际 %d：%s", rec.Code, rec.Body.String())
			}
			env := decode(t, rec)
			if env.Code != response.CodeInvalidParam {
				t.Fatalf("业务码应为 %d，实际 %d", response.CodeInvalidParam, env.Code)
			}
			if !strings.Contains(env.Message, tc.wantMsg) {
				t.Fatalf("提示应包含 %q，实际 %q", tc.wantMsg, env.Message)
			}
		})
	}
}

// TestRegister_MultipleUsersWithoutOptionalFields 覆盖「邮箱与手机号是选填」：
// 空串在唯一索引里会互相冲突，不排除的话第二个用户就注册不了。
func TestRegister_MultipleUsersWithoutOptionalFields(t *testing.T) {
	e := newEnv(t)

	for _, username := range []string{"alpha", "bravo", "charlie"} {
		rec := e.do(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
			"username": username, "password": "secret-pass-1",
		}, "")
		if rec.Code != http.StatusCreated {
			t.Fatalf("%s 注册应返回 201，实际 %d：%s", username, rec.Code, rec.Body.String())
		}
	}
}

func TestRegister_DuplicateUsername(t *testing.T) {
	e := newEnv(t)
	e.register(t)

	rec := e.do(t, http.MethodPost, "/api/v1/auth/register", registerBody(), "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("重复注册应返回 409，实际 %d：%s", rec.Code, rec.Body.String())
	}
	if env := decode(t, rec); env.Code != response.CodeUserExists {
		t.Fatalf("业务码应为 %d，实际 %d", response.CodeUserExists, env.Code)
	}
}

func TestLogin_SuccessAndFailure(t *testing.T) {
	e := newEnv(t)
	e.register(t)

	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"account": "douwaner", "password": "secret-pass-1",
	}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("登录应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}

	rec = e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"account": "douwaner", "password": "wrong-password",
	}, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("密码错误应返回 401，实际 %d：%s", rec.Code, rec.Body.String())
	}
	if env := decode(t, rec); env.Code != response.CodePasswordWrong {
		t.Fatalf("业务码应为 %d，实际 %d", response.CodePasswordWrong, env.Code)
	}
}

func TestMe_RequiresValidToken(t *testing.T) {
	e := newEnv(t)

	rec := e.do(t, http.MethodGet, "/api/v1/users/me", nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("未带令牌应返回 401，实际 %d", rec.Code)
	}
	if env := decode(t, rec); env.Code != response.CodeUnauthorized {
		t.Fatalf("业务码应为 %d，实际 %d", response.CodeUnauthorized, env.Code)
	}

	rec = e.do(t, http.MethodGet, "/api/v1/users/me", nil, "not-a-real-token")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("非法令牌应返回 401，实际 %d", rec.Code)
	}
	if env := decode(t, rec); env.Code != response.CodeTokenInvalid {
		t.Fatalf("业务码应为 %d，实际 %d", response.CodeTokenInvalid, env.Code)
	}
}

func TestRefresh_RotatesAndRejectsReuse(t *testing.T) {
	e := newEnv(t)
	payload := e.register(t)

	rec := e.do(t, http.MethodPost, "/api/v1/auth/refresh", map[string]any{
		"refresh_token": payload.Tokens.RefreshToken,
	}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("刷新应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}
	var refreshed authPayload
	if err := json.Unmarshal(decode(t, rec).Data, &refreshed); err != nil {
		t.Fatalf("解析刷新返回: %v", err)
	}
	if refreshed.Tokens.RefreshToken == payload.Tokens.RefreshToken {
		t.Fatal("刷新应轮换出新的刷新令牌")
	}

	// 旧刷新令牌再次使用必须失败
	rec = e.do(t, http.MethodPost, "/api/v1/auth/refresh", map[string]any{
		"refresh_token": payload.Tokens.RefreshToken,
	}, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("复用旧刷新令牌应返回 401，实际 %d：%s", rec.Code, rec.Body.String())
	}
}

func TestLogout_InvalidatesRefreshToken(t *testing.T) {
	e := newEnv(t)
	payload := e.register(t)

	rec := e.do(t, http.MethodPost, "/api/v1/auth/logout", map[string]any{
		"refresh_token": payload.Tokens.RefreshToken,
	}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("登出应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}

	rec = e.do(t, http.MethodPost, "/api/v1/auth/refresh", map[string]any{
		"refresh_token": payload.Tokens.RefreshToken,
	}, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("登出后刷新应返回 401，实际 %d", rec.Code)
	}
}

func TestUpdateProfile(t *testing.T) {
	e := newEnv(t)
	payload := e.register(t)

	rec := e.do(t, http.MethodPatch, "/api/v1/users/me", map[string]any{
		"nickname":   "新昵称",
		"avatar_url": "https://cdn.douwan.test/a.png",
	}, payload.Tokens.AccessToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("修改资料应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}

	var profile struct {
		Nickname  string `json:"nickname"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := json.Unmarshal(decode(t, rec).Data, &profile); err != nil {
		t.Fatalf("解析资料返回: %v", err)
	}
	if profile.Nickname != "新昵称" || profile.AvatarURL != "https://cdn.douwan.test/a.png" {
		t.Fatalf("资料未更新: %+v", profile)
	}

	// 非法头像地址应被参数校验拦下
	rec = e.do(t, http.MethodPatch, "/api/v1/users/me", map[string]any{
		"avatar_url": "不是链接",
	}, payload.Tokens.AccessToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("非法头像地址应返回 400，实际 %d：%s", rec.Code, rec.Body.String())
	}
}

func TestHealthAndNoRoute(t *testing.T) {
	e := newEnv(t)

	rec := e.do(t, http.MethodGet, "/healthz", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("健康检查应返回 200，实际 %d", rec.Code)
	}

	rec = e.do(t, http.MethodGet, "/api/v1/not-exist", nil, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("未知路径应返回 404，实际 %d", rec.Code)
	}
	if env := decode(t, rec); env.Code != response.CodeNotFound {
		t.Fatalf("业务码应为 %d，实际 %d", response.CodeNotFound, env.Code)
	}
}

func TestCORS_AllowsWhitelistedOriginOnly(t *testing.T) {
	e := newEnv(t)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()
	e.engine.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("白名单来源应被放行，实际 %q", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "http://evil.test")
	rec = httptest.NewRecorder()
	e.engine.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("非白名单来源不应返回跨域头，实际 %q", got)
	}
}

func TestRequestID_EchoesIncomingHeader(t *testing.T) {
	e := newEnv(t)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set(response.HeaderRequestID, "trace-abc")
	rec := httptest.NewRecorder()
	e.engine.ServeHTTP(rec, req)

	if got := rec.Header().Get(response.HeaderRequestID); got != "trace-abc" {
		t.Fatalf("应沿用上游传入的请求 ID，实际 %q", got)
	}
}
