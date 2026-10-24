package handler

import (
	"time"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// MeHandler 前台「我的」相关接口：权益与有效权限矩阵。
//
// 单独一个 handler 而不是塞进 UserHandler：这几个接口的数据来自权益模块，
// 放在一起会让「账号」与「权益」两件事的边界糊掉。
type MeHandler struct {
	ent *service.EntitlementService
}

// NewMeHandler 构造处理函数集合。
func NewMeHandler(ent *service.EntitlementService) *MeHandler {
	return &MeHandler{ent: ent}
}

// Entitlements GET /api/v1/my/entitlements
//
// 返回当前用户**有效**的权益（已过期与已撤销的不返回），
// 前台「我的账户」用它展示「我的权益」区块。
func (h *MeHandler) Entitlements(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	_, items, err := h.ent.EffectivePermissions(c.Request.Context(), userID, time.Now())
	if err != nil {
		response.Fail(c, err)
		return
	}
	if items == nil {
		items = []dto.EntitlementItem{}
	}
	response.Success(c, items)
}

// Permissions GET /api/v1/permissions
//
// 返回当前用户可用的功能权限矩阵。
//
// 这是给前台做「按钮提示与升级引导」用的；真正的权限判定在服务端
// （需求 §13.12：不能依赖前端按钮是否显示）。未登录时返回免费版矩阵。
func (h *MeHandler) Permissions(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	matrix, items, err := h.ent.EffectivePermissions(c.Request.Context(), userID, time.Now())
	if err != nil {
		response.Fail(c, err)
		return
	}
	if items == nil {
		items = []dto.EntitlementItem{}
	}
	response.Success(c, gin.H{
		"permissions":  matrix,
		"entitlements": items,
		"logged_in":    userID > 0,
		"deny_reasons": service.DenyReasons(),
	})
}
