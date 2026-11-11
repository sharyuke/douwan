package handler

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// OAuthHandler 第三方登录接口。
type OAuthHandler struct {
	svc *service.OAuthService
	cfg config.OAuth
}

// NewOAuthHandler 构造处理函数集合。
func NewOAuthHandler(svc *service.OAuthService, cfg config.OAuth) *OAuthHandler {
	return &OAuthHandler{svc: svc, cfg: cfg}
}

// QQStart GET /api/v1/auth/oauth/qq/start
//
// 未配置时返回业务错误（HTTP 503 + code 31001），前端据此显示「暂不可用」。
// 绝不返回一个假的跳转地址。
func (h *OAuthHandler) QQStart(c *gin.Context) {
	result, err := h.svc.Start(c.Request.Context(), "qq", "login", 0)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// QQStatus GET /api/v1/auth/oauth/qq/status
//
// 公开接口：登录对话框打开时先问一次。QQ 应用未开通（100008）时
// 前端直接禁用按钮并说明原因，不让用户跳到 QQ 的错误页。
func (h *OAuthHandler) QQStatus(c *gin.Context) {
	force := c.Query("refresh") == "1"
	status, err := h.svc.Status(c.Request.Context(), model.ProviderQQ, force)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, status)
}

// QQBind GET /api/v1/auth/oauth/qq/bind
func (h *OAuthHandler) QQBind(c *gin.Context) {
	result, err := h.svc.Start(c.Request.Context(), "qq", "bind", middleware.CurrentUserID(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// WeChatStart GET /api/v1/auth/oauth/wechat/start
func (h *OAuthHandler) WeChatStart(c *gin.Context) {
	result, err := h.svc.Start(c.Request.Context(), model.ProviderWeChat, "login", 0)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// WeChatStatus GET /api/v1/auth/oauth/wechat/status
func (h *OAuthHandler) WeChatStatus(c *gin.Context) {
	force := c.Query("refresh") == "1"
	status, err := h.svc.Status(c.Request.Context(), model.ProviderWeChat, force)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, status)
}

// WeChatBind GET /api/v1/auth/oauth/wechat/bind
func (h *OAuthHandler) WeChatBind(c *gin.Context) {
	result, err := h.svc.Start(c.Request.Context(), model.ProviderWeChat, "bind", middleware.CurrentUserID(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// QQCallback GET /api/v1/auth/oauth/qq/callback
func (h *OAuthHandler) QQCallback(c *gin.Context) {
	h.callback(c, model.ProviderQQ)
}

// WeChatCallback GET /api/v1/auth/oauth/wechat/callback
func (h *OAuthHandler) WeChatCallback(c *gin.Context) {
	h.callback(c, model.ProviderWeChat)
}

// callback 处理第三方回调。
//
// 成功后 302 回前端，令牌放在 hash 里（#/auth/callback?access_token=...）：
// hash 不会随请求发给服务端，不会进 nginx access log。
func (h *OAuthHandler) callback(c *gin.Context, provider string) {
	result, info, err := h.svc.Callback(
		c.Request.Context(), provider, c.Query("code"), c.Query("state"), service.AuditFromContext(c))
	if err != nil {
		h.redirectError(c, provider, err)
		return
	}
	params := url.Values{}
	params.Set("access_token", result.Tokens.AccessToken)
	params.Set("refresh_token", result.Tokens.RefreshToken)
	params.Set("expires_at", result.Tokens.ExpiresAt.Format("2006-01-02T15:04:05Z07:00"))
	params.Set("provider", info.Provider)
	if info.Bound {
		params.Set("bound", "1")
	}
	if info.IsNew {
		params.Set("is_new", "1")
	}
	c.Redirect(http.StatusFound, frontendCallbackURL(h.cfg.FrontendCallback, params))
}

// Identities GET /api/v1/users/me/identities
func (h *OAuthHandler) Identities(c *gin.Context) {
	rows, err := h.svc.ListIdentities(c.Request.Context(), middleware.CurrentUserID(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, rows)
}

// Unbind DELETE /api/v1/users/me/identities/:id
func (h *OAuthHandler) Unbind(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		response.Fail(c, response.ErrInvalidParam)
		return
	}
	if err := h.svc.Unbind(c.Request.Context(), middleware.CurrentUserID(c), id, service.AuditFromContext(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, nil)
}

// frontendCallbackURL 把参数拼到前端回调地址的 hash 里。
//
// 支持两种配置：
//   - https://dw.sharyuke.com/#/auth/callback  → 参数接在 # 后面
//   - https://dw.sharyuke.com/auth/callback    → 自动补 #/auth/callback
func frontendCallbackURL(base string, params url.Values) string {
	base = strings.TrimSpace(base)
	if base == "" {
		base = "/#/auth/callback"
	}
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	if i := strings.Index(base, "#"); i >= 0 {
		frag := base[i+1:]
		fragSep := "?"
		if strings.Contains(frag, "?") {
			fragSep = "&"
		}
		return base[:i+1] + frag + fragSep + params.Encode()
	}
	if !strings.Contains(base, "/auth/callback") {
		base += "/#/auth/callback"
		return base + "?" + params.Encode()
	}
	return base + sep + params.Encode()
}

func (h *OAuthHandler) redirectError(c *gin.Context, provider string, err error) {
	e := response.From(err)
	params := url.Values{}
	params.Set("oauth_error", strconv.Itoa(int(e.Code)))
	params.Set("message", e.Message)
	params.Set("provider", provider)
	c.Redirect(http.StatusFound, frontendCallbackURL(h.cfg.FrontendCallback, params))
}
