// 手机短信验证码接口：状态查询、发码、验证码登录。
package handler

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// SmsHandler 短信验证码接口。
type SmsHandler struct {
	svc *service.SmsService
}

// NewSmsHandler 构造处理函数集合。
func NewSmsHandler(svc *service.SmsService) *SmsHandler {
	return &SmsHandler{svc: svc}
}

// Status GET /api/v1/auth/sms/status
// 前端据此决定要不要展示「手机号登录」入口。
func (h *SmsHandler) Status(c *gin.Context) {
	response.Success(c, h.svc.Status())
}

// Send POST /api/v1/auth/sms/send
func (h *SmsHandler) Send(c *gin.Context) {
	var req dto.SmsSendRequest
	if err := response.BindJSON(c, &req); err != nil {
		response.Fail(c, err)
		return
	}
	if err := h.svc.SendCode(c.Request.Context(), req.Phone, c.ClientIP()); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"sent": true})
}

// Login POST /api/v1/auth/sms/login
func (h *SmsHandler) Login(c *gin.Context) {
	var req dto.SmsLoginRequest
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
