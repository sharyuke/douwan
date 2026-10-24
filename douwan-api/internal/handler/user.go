// Package handler 是 HTTP 层：解析请求、调用 Service、写统一响应。
// 业务规则不写在这里。
package handler

import (
	"strings"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// UserHandler 账号与鉴权接口。
type UserHandler struct {
	svc *service.UserService
}

// NewUserHandler 构造处理函数集合。
func NewUserHandler(svc *service.UserService) *UserHandler {
	return &UserHandler{svc: svc}
}

// Register POST /api/v1/auth/register
func (h *UserHandler) Register(c *gin.Context) {
	var req dto.RegisterRequest
	if err := response.BindJSON(c, &req); err != nil {
		response.Fail(c, err)
		return
	}
	fillAcquisition(c, &req.Referrer, &req.SiteHost)
	result, err := h.svc.Register(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	// 注册接口没有令牌（此时用户还没有登录态），要主动告诉活跃采集器
	// 这次请求属于谁，否则「注册」这个活跃行为会漏掉。
	activity.Mark(c, result.User.ID)
	response.Created(c, result)
}

// Login POST /api/v1/auth/login
func (h *UserHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if err := response.BindJSON(c, &req); err != nil {
		response.Fail(c, err)
		return
	}
	fillAcquisition(c, &req.Referrer, &req.SiteHost)
	result, err := h.svc.Login(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	activity.Mark(c, result.User.ID)
	response.Success(c, result)
}

// fillAcquisition 补全来源渠道信息。
//
// 前端就算一个字都不传，浏览器也会带上 Referer 头，所以这里把请求头
// 作为兜底来源——总比整片「未知来源」有用。SiteHost 用来识别站内跳转。
func fillAcquisition(c *gin.Context, referrer, siteHost *string) {
	if siteHost != nil {
		*siteHost = c.Request.Host
	}
	if referrer != nil && strings.TrimSpace(*referrer) == "" {
		*referrer = c.Request.Referer()
	}
}

// Refresh POST /api/v1/auth/refresh
func (h *UserHandler) Refresh(c *gin.Context) {
	var req dto.RefreshRequest
	if err := response.BindJSON(c, &req); err != nil {
		response.Fail(c, err)
		return
	}
	result, err := h.svc.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Logout POST /api/v1/auth/logout
func (h *UserHandler) Logout(c *gin.Context) {
	var req dto.LogoutRequest
	if err := response.BindJSON(c, &req); err != nil {
		// 登出允许不带 body，解析失败就当作没有刷新令牌处理
		req = dto.LogoutRequest{}
	}
	if err := h.svc.Logout(c.Request.Context(), req.RefreshToken); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, nil)
}

// Me GET /api/v1/users/me
func (h *UserHandler) Me(c *gin.Context) {
	result, err := h.svc.Profile(c.Request.Context(), middleware.CurrentUserID(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// UpdateProfile PATCH /api/v1/users/me
func (h *UserHandler) UpdateProfile(c *gin.Context) {
	var req dto.UpdateProfileRequest
	if err := response.BindJSON(c, &req); err != nil {
		response.Fail(c, err)
		return
	}
	profile, err := h.svc.UpdateProfile(c.Request.Context(), middleware.CurrentUserID(c), req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, profile)
}
