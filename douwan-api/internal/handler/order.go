package handler

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// OrderHandler 订单管理接口（需求 §7）。
type OrderHandler struct {
	svc *service.OrderService
}

// NewOrderHandler 构造处理函数集合。
func NewOrderHandler(svc *service.OrderService) *OrderHandler {
	return &OrderHandler{svc: svc}
}

// List GET /api/v1/admin/orders
func (h *OrderHandler) List(c *gin.Context) {
	q := dto.OrderListQuery{
		PageQuery:     queryPage(c),
		OrderNo:       c.Query("order_no"),
		Keyword:       c.Query("keyword"),
		UserID:        queryUint(c, "user_id"),
		PlanID:        queryUint(c, "plan_id"),
		PaymentStatus: c.Query("payment_status"),
		FulfillStatus: c.Query("fulfillment_status"),
		PaymentMethod: c.Query("payment_method"),
		CreatedFrom:   c.Query("created_from"),
		CreatedTo:     c.Query("created_to"),
	}
	result, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Detail GET /api/v1/admin/orders/:id
func (h *OrderHandler) Detail(c *gin.Context) {
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

// Settle POST /api/v1/admin/orders/:id/settle
//
// 人工确认收款。备注必填（用于二次确认留痕），可选顺带发卡。
func (h *OrderHandler) Settle(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.OrderSettleRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Settle(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Issue POST /api/v1/admin/orders/:id/issue
func (h *OrderHandler) Issue(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.OrderIssueRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.IssueCards(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Close POST /api/v1/admin/orders/:id/close
func (h *OrderHandler) Close(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.OrderCloseRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Close(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Refund POST /api/v1/admin/orders/:id/refund
func (h *OrderHandler) Refund(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req struct {
		Note string `json:"note" binding:"required,min=2,max=255"`
	}
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.MarkRefunded(c.Request.Context(), id, req.Note, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

/* ------------------------------------------------------------------ 前台下单 */

// Create POST /api/v1/orders
func (h *OrderHandler) Create(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	var req dto.OrderCreateRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Create(c.Request.Context(), userID, req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// MyOrders GET /api/v1/orders
//
// 前台「我的订单」：只返回自己的订单（需求 §6.6：用户能在支付成功页/
// 个人订单页重新查看卡密）。
func (h *OrderHandler) MyOrders(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	q := dto.OrderListQuery{
		PageQuery:     queryPage(c),
		UserID:        userID,
		PaymentStatus: c.Query("payment_status"),
	}
	result, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// MyOrderDetail GET /api/v1/orders/:id
func (h *OrderHandler) MyOrderDetail(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	result, err := h.svc.Detail(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	// 越权检查：只能看自己的订单
	if result.UserID != userID {
		response.Fail(c, response.ErrForbidden.WithMessage("只能查看自己的订单"))
		return
	}
	response.Success(c, result)
}
