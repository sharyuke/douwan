package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// CardKeyHandler 卡密管理接口（需求 §6）。
type CardKeyHandler struct {
	svc *service.CardKeyService
}

// NewCardKeyHandler 构造处理函数集合。
func NewCardKeyHandler(svc *service.CardKeyService) *CardKeyHandler {
	return &CardKeyHandler{svc: svc}
}

// List GET /api/v1/admin/card-keys
//
// 明文只在调用方拥有 card.reveal 权限时才返回；其余情况一律脱敏。
func (h *CardKeyHandler) List(c *gin.Context) {
	admin := currentAdmin(c)
	includeCode := admin != nil && admin.Can(model.PermCardReveal)

	q := dto.CardKeyListQuery{
		PageQuery:      queryPage(c),
		Keyword:        c.Query("keyword"),
		Status:         c.Query("status"),
		PlanID:         queryUint(c, "plan_id"),
		BatchID:        c.Query("batch_id"),
		BatchName:      c.Query("batch_name"),
		OrderNo:        c.Query("order_no"),
		UserID:         queryUint(c, "user_id"),
		CreatedFrom:    c.Query("created_from"),
		CreatedTo:      c.Query("created_to"),
		RedeemedFrom:   c.Query("redeemed_from"),
		RedeemedTo:     c.Query("redeemed_to"),
		ExpiringInDays: atoiDefault(c.Query("expiring_in_days"), 0),
	}
	result, err := h.svc.List(c.Request.Context(), q, includeCode)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Generate POST /api/v1/admin/card-keys/generate
func (h *CardKeyHandler) Generate(c *gin.Context) {
	var req dto.CardKeyGenerateRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Generate(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// Reveal POST /api/v1/admin/card-keys/reveal
//
// 查看明文属于敏感操作：需要 card.reveal 权限，且每次调用都会写日志。
func (h *CardKeyHandler) Reveal(c *gin.Context) {
	var req dto.CardKeyRevealRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Reveal(c.Request.Context(), req.IDs, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{
		"codes":   result,
		"message": "明文卡密仅供交付使用，查看行为已记录操作日志",
	})
}

// Void POST /api/v1/admin/card-keys/void
func (h *CardKeyHandler) Void(c *gin.Context) {
	req := dto.CardKeyVoidRequest{}
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Void(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Batches GET /api/v1/admin/card-keys/batches
func (h *CardKeyHandler) Batches(c *gin.Context) {
	limit := atoiDefault(c.Query("limit"), 100)
	result, err := h.svc.Batches(c.Request.Context(), limit, queryUint(c, "plan_id"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Export POST /api/v1/admin/card-keys/export
//
// 用 POST 而不是 GET：导出条件比较长，而且这是一次「会写日志的动作」，
// 不适合被浏览器预取或缓存。
func (h *CardKeyHandler) Export(c *gin.Context) {
	var req dto.CardKeyExportRequest
	if !bind(c, &req) {
		return
	}
	data, filename, err := h.svc.Export(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	csvHeaders(c, filename)
	c.Data(200, "text/csv; charset=utf-8", data)
}

// Meta GET /api/v1/admin/card-keys/meta
//
// 返回卡密模块的运行期能力，供后台界面提示。
func (h *CardKeyHandler) Meta(c *gin.Context) {
	hint := "未配置卡密加密密钥（admin.card_cipher_key）：列表只能显示脱敏卡密，历史卡密无法查看明文。请在服务端配置后重启。"
	if h.svc.CipherEnabled() {
		hint = "已配置卡密加密密钥，可以查看与导出明文卡密；每次查看与导出都会记录操作日志。"
	}
	response.Success(c, gin.H{
		"cipher_enabled": h.svc.CipherEnabled(),
		"cipher_hint":    hint,
	})
}

/* ------------------------------------------------------------------ 前台兑换 */

// Redeem POST /api/v1/card-keys/redeem
//
// 需要登录：权益必须发给一个能识别的用户，不能发给匿名会话（需求 §6.5）。
func (h *CardKeyHandler) Redeem(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	var req dto.CardKeyRedeemRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Redeem(c.Request.Context(), userID, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

func atoiDefault(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return v
}
