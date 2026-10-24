package handler

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// HealthHandler 健康检查。liveness 只看进程活着，
// readiness 额外探一次数据库，供负载均衡摘流使用。
type HealthHandler struct {
	db *gorm.DB
}

// NewHealthHandler 构造健康检查处理函数。
func NewHealthHandler(db *gorm.DB) *HealthHandler {
	return &HealthHandler{db: db}
}

// Live GET /healthz
func (h *HealthHandler) Live(c *gin.Context) {
	response.Success(c, gin.H{"status": "ok"})
}

// Ready GET /readyz
func (h *HealthHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	sqlDB, err := h.db.DB()
	if err != nil {
		response.Fail(c, response.ErrInternal.WithCause(err))
		return
	}
	if err := sqlDB.PingContext(ctx); err != nil {
		response.Fail(c, response.ErrInternal.WithCause(err))
		return
	}
	response.Success(c, gin.H{"status": "ok", "database": "up"})
}
