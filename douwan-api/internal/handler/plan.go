package handler

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// PlanHandler 套餐管理接口。
type PlanHandler struct {
	svc *service.PlanService
}

// NewPlanHandler 构造处理函数集合。
func NewPlanHandler(svc *service.PlanService) *PlanHandler {
	return &PlanHandler{svc: svc}
}

// List GET /api/v1/admin/plans
func (h *PlanHandler) List(c *gin.Context) {
	q := dto.PlanListQuery{
		PageQuery: queryPage(c),
		Keyword:   c.Query("keyword"),
		Status:    c.Query("status"),
	}
	result, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Options GET /api/v1/admin/plans/options
func (h *PlanHandler) Options(c *gin.Context) {
	result, err := h.svc.Options(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Detail GET /api/v1/admin/plans/:id
func (h *PlanHandler) Detail(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.svc.Detail(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Preview GET /api/v1/admin/plans/:id/preview
func (h *PlanHandler) Preview(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.svc.Preview(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Create POST /api/v1/admin/plans
func (h *PlanHandler) Create(c *gin.Context) {
	var req dto.PlanRequest
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

// Update PUT /api/v1/admin/plans/:id
func (h *PlanHandler) Update(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.PlanRequest
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

// ChangeStatus PATCH /api/v1/admin/plans/:id/status
func (h *PlanHandler) ChangeStatus(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.PlanStatusRequest
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

// Duplicate POST /api/v1/admin/plans/:id/duplicate
func (h *PlanHandler) Duplicate(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.svc.Duplicate(c.Request.Context(), id, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// Delete DELETE /api/v1/admin/plans/:id
func (h *PlanHandler) Delete(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	// 删除原因通过查询参数传（DELETE 带 body 在部分客户端上不被支持）
	reason := c.Query("reason")
	if err := h.svc.Delete(c.Request.Context(), id, reason, auditOf(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "套餐已删除"})
}

// SeedDrafts POST /api/v1/admin/plans/drafts
//
// 初始化占位草稿套餐。幂等，可以重复点。
func (h *PlanHandler) SeedDrafts(c *gin.Context) {
	created, err := h.svc.SeedDrafts(c.Request.Context(), auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{
		"created": created,
		"message": "已初始化占位草稿套餐（名称与价格都可以改，默认不在前台展示）",
	})
}
