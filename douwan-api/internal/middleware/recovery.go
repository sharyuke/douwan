package middleware

import (
	"log/slog"
	"runtime/debug"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// Recovery 兜住 panic：打日志 + 堆栈，对外只回统一的内部错误，
// 不把堆栈或内部细节暴露给前端。
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				slog.ErrorContext(c.Request.Context(), "请求 panic",
					"err", err,
					"path", c.Request.URL.Path,
					"request_id", response.RequestID(c),
					"stack", string(debug.Stack()),
				)
				response.Fail(c, response.ErrInternal)
			}
		}()
		c.Next()
	}
}
