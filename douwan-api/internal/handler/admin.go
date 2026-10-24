package handler

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// AdminHandler 后台管理员账号与鉴权接口。
type AdminHandler struct {
	svc *service.AdminService
}

// NewAdminHandler 构造处理函数集合。
func NewAdminHandler(svc *service.AdminService) *AdminHandler {
	return &AdminHandler{svc: svc}
}

// Login POST /api/v1/admin/auth/login
func (h *AdminHandler) Login(c *gin.Context) {
	var req dto.AdminLoginRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Login(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Refresh POST /api/v1/admin/auth/refresh
func (h *AdminHandler) Refresh(c *gin.Context) {
	var req dto.AdminRefreshRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Logout POST /api/v1/admin/auth/logout
func (h *AdminHandler) Logout(c *gin.Context) {
	var req dto.AdminLogoutRequest
	if err := response.BindJSON(c, &req); err != nil {
		// 登出允许不带 body
		req = dto.AdminLogoutRequest{}
	}
	audit := auditOf(c)
	if err := h.svc.Logout(c.Request.Context(), req.RefreshToken, audit); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, nil)
}

// Me GET /api/v1/admin/auth/me
func (h *AdminHandler) Me(c *gin.Context) {
	admin := currentAdmin(c)
	if admin == nil {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	response.Success(c, h.svc.Profile(admin))
}

// ChangePassword POST /api/v1/admin/auth/password
func (h *AdminHandler) ChangePassword(c *gin.Context) {
	var req dto.AdminChangePasswordRequest
	if !bind(c, &req) {
		return
	}
	if err := h.svc.ChangePassword(c.Request.Context(), currentAdmin(c), req, auditOf(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "密码已修改"})
}

/* ------------------------------------------------------------------ 管理员管理 */

// List GET /api/v1/admin/admins
func (h *AdminHandler) List(c *gin.Context) {
	q := dto.AdminListQuery{
		PageQuery: queryPage(c),
		Keyword:   c.Query("keyword"),
		Role:      c.Query("role"),
		Status:    queryInt8Ptr(c, "status"),
	}
	result, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Create POST /api/v1/admin/admins
func (h *AdminHandler) Create(c *gin.Context) {
	var req dto.AdminCreateRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Create(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// Update PATCH /api/v1/admin/admins/:id
func (h *AdminHandler) Update(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.AdminUpdateRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Update(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// ResetPassword POST /api/v1/admin/admins/:id/password
func (h *AdminHandler) ResetPassword(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.AdminResetPasswordRequest
	if !bind(c, &req) {
		return
	}
	if err := h.svc.ResetPassword(c.Request.Context(), id, req, auditOf(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "密码已重置"})
}

// ChangeStatus PATCH /api/v1/admin/admins/:id/status
func (h *AdminHandler) ChangeStatus(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.AdminStatusRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.ChangeStatus(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Delete DELETE /api/v1/admin/admins/:id
func (h *AdminHandler) Delete(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id, auditOf(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "管理员已删除"})
}

// Permissions GET /api/v1/admin/permissions
//
// 返回角色与功能权限点，供后台渲染「新建套餐」的多选项与权限说明。
func (h *AdminHandler) Permissions(c *gin.Context) {
	response.Success(c, gin.H{
		"roles":    h.svc.RoleOptions(),
		"features": h.svc.FeatureOptions(),
		"current":  h.svc.PermissionList(currentAdmin(c)),
		"actions":  service.ActionOptions(),
		"is_super": currentAdmin(c) != nil && currentAdmin(c).IsSuper(),
		"admin_id": middleware.CurrentAdminID(c),
	})
}
