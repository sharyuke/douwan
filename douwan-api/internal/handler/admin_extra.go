package handler

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// OverviewHandler 数据概览（需求 §4）。
type OverviewHandler struct {
	svc *service.OverviewService
}

// NewOverviewHandler 构造处理函数集合。
func NewOverviewHandler(svc *service.OverviewService) *OverviewHandler {
	return &OverviewHandler{svc: svc}
}

// Load GET /api/v1/admin/overview
func (h *OverviewHandler) Load(c *gin.Context) {
	result, err := h.svc.Load(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// UserHandler（后台）用户与兑换记录。
type AdminUserHandler struct {
	users *service.AdminUserService
	ents  *service.EntitlementService
}

// NewAdminUserHandler 构造处理函数集合。
func NewAdminUserHandler(users *service.AdminUserService, ents *service.EntitlementService) *AdminUserHandler {
	return &AdminUserHandler{users: users, ents: ents}
}

// List GET /api/v1/admin/users
func (h *AdminUserHandler) List(c *gin.Context) {
	q := dto.AdminUserListQuery{
		PageQuery: queryPage(c),
		Keyword:   c.Query("keyword"),
		Status:    queryInt8Ptr(c, "status"),
		HasPro:    queryBoolPtr(c, "has_pro"),
		From:      c.Query("from"),
		To:        c.Query("to"),
	}
	result, err := h.users.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Detail GET /api/v1/admin/users/:id
func (h *AdminUserHandler) Detail(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.users.Detail(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Entitlements GET /api/v1/admin/entitlements
func (h *AdminUserHandler) Entitlements(c *gin.Context) {
	q := dto.EntitlementListQuery{
		PageQuery:  queryPage(c),
		UserID:     queryUint(c, "user_id"),
		PlanID:     queryUint(c, "plan_id"),
		PlanCode:   c.Query("plan_code"),
		SourceType: c.Query("source_type"),
		Status:     c.Query("status"),
		Keyword:    c.Query("keyword"),
		From:       c.Query("from"),
		To:         c.Query("to"),
	}
	result, err := h.ents.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Grant POST /api/v1/admin/entitlements
func (h *AdminUserHandler) Grant(c *gin.Context) {
	var req dto.EntitlementGrantRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.ents.GrantManually(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// Revoke POST /api/v1/admin/entitlements/:id/revoke
func (h *AdminUserHandler) Revoke(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.EntitlementRevokeRequest
	if !bind(c, &req) {
		return
	}
	if err := h.ents.Revoke(c.Request.Context(), id, req, auditOf(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "权益已撤销"})
}

// SettingHandler 系统设置（需求 §10）。
type SettingHandler struct {
	svc *service.SettingsService
}

// NewSettingHandler 构造处理函数集合。
func NewSettingHandler(svc *service.SettingsService) *SettingHandler {
	return &SettingHandler{svc: svc}
}

// List GET /api/v1/admin/settings
func (h *SettingHandler) List(c *gin.Context) {
	items, err := h.svc.List(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, items)
}

// Update PUT /api/v1/admin/settings
func (h *SettingHandler) Update(c *gin.Context) {
	var req dto.SettingUpdateRequest
	if !bind(c, &req) {
		return
	}
	admin := currentAdmin(c)
	items, err := h.svc.Update(c.Request.Context(), req, auditOf(c), admin != nil && admin.IsSuper())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, items)
}

// Public GET /api/v1/settings/public
//
// 前台可读的公开设置：网站名、客服入口、卡密规则、上传上限、支付状态。
// 不包含任何密钥类配置。
func (h *SettingHandler) Public(c *gin.Context) {
	result, err := h.svc.Public(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// LogHandler 操作日志（需求 §11）。
type LogHandler struct {
	svc *service.AdminLogService
}

// NewLogHandler 构造处理函数集合。
func NewLogHandler(svc *service.AdminLogService) *LogHandler {
	return &LogHandler{svc: svc}
}

// List GET /api/v1/admin/logs
func (h *LogHandler) List(c *gin.Context) {
	q := dto.OperationLogQuery{
		PageQuery:  queryPage(c),
		Keyword:    c.Query("keyword"),
		Action:     c.Query("action"),
		Result:     c.Query("result"),
		AdminID:    queryUint(c, "admin_id"),
		TargetType: c.Query("target_type"),
	}
	result, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}
