package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// CtxUserID 是当前登录用户 ID 在 gin.Context 中的键。
const CtxUserID = "user_id"

// Auth 校验 Authorization: Bearer <token>，通过后把用户 ID 放进上下文。
//
// 这里只做令牌本身的校验（签名、有效期、主体类型），不查库确认账号状态：
// 免去每个请求一次数据库往返。账号被禁用时，已签发的令牌会自然过期，
// 需要立即生效的话在 Service 层按用户查询时判断 Status 即可。
func Auth(m *auth.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			response.Fail(c, response.ErrUnauthorized)
			return
		}
		claims, err := m.ParseAccessToken(token)
		if err != nil {
			response.Fail(c, err)
			return
		}
		c.Set(CtxUserID, claims.UserID)
		c.Next()
	}
}

// OptionalAuth 与 Auth 相同，但没有令牌时不报错，只是不设置用户 ID。
// 素材库这类「登录与否都能看，登录了能看到更多」的接口用它。
func OptionalAuth(m *auth.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			c.Next()
			return
		}
		claims, err := m.ParseAccessToken(token)
		if err != nil {
			// 令牌非法就当匿名访问，不阻断浏览
			c.Next()
			return
		}
		c.Set(CtxUserID, claims.UserID)
		c.Next()
	}
}

// CurrentUserID 读取当前登录用户 ID。未登录返回 0。
func CurrentUserID(c *gin.Context) uint64 {
	if v, ok := c.Get(CtxUserID); ok {
		if id, ok := v.(uint64); ok {
			return id
		}
	}
	return 0
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}
