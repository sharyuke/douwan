package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// AccessLog 记录每个请求的方法、路径、状态码与耗时。
// 5xx 记为 error 级，4xx 记为 warn 级，便于按级别筛选告警。
func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		status := c.Writer.Status()
		attrs := []any{
			"method", c.Request.Method,
			"path", path,
			"status", status,
			"latency_ms", time.Since(start).Milliseconds(),
			"ip", c.ClientIP(),
			"request_id", response.RequestID(c),
		}
		if query != "" {
			attrs = append(attrs, "query", query)
		}
		if len(c.Errors) > 0 {
			attrs = append(attrs, "errors", c.Errors.String())
		}

		ctx := c.Request.Context()
		switch {
		case status >= 500:
			slog.ErrorContext(ctx, "请求结束", attrs...)
		case status >= 400:
			slog.WarnContext(ctx, "请求结束", attrs...)
		default:
			slog.InfoContext(ctx, "请求结束", attrs...)
		}
	}
}
