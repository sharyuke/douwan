// Package middleware 存放 HTTP 中间件。
package middleware

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// RequestID 为每个请求生成链路 ID：优先沿用上游传入的 X-Request-ID，
// 否则新生成一个，并写回响应头，方便按 ID 串起日志。
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(response.HeaderRequestID)
		if id == "" {
			id = newID()
		}
		c.Set(response.CtxRequestID, id)
		c.Header(response.HeaderRequestID, id)
		c.Next()
	}
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(buf)
}
