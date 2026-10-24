package middleware

import (
	"net"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// RateLimit 是按客户端标识做的固定窗口限流。
//
// 用在卡密兑换这类「可以被暴力尝试」的接口上（需求 §3.3「对卡密兑换、
// 订单发放等接口增加频率限制」）。默认走内存，够单机用；
// 多实例部署时每个实例各自计数，实际阈值等于 limit × 实例数，
// 需要严格限流时应改用 Redis 实现。
func RateLimit(limit int, window time.Duration) gin.HandlerFunc {
	if limit <= 0 {
		limit = 10
	}
	if window <= 0 {
		window = time.Minute
	}
	l := &fixedWindowLimiter{
		limit:  limit,
		window: window,
		hits:   make(map[string]*windowEntry),
	}
	go l.janitor(window)

	return func(c *gin.Context) {
		key := ClientIP(c)
		if !l.allow(key, time.Now()) {
			response.Fail(c, response.ErrTooManyRequests)
			return
		}
		c.Next()
	}
}

type windowEntry struct {
	count     int
	expiresAt time.Time
}

type fixedWindowLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]*windowEntry
}

func (l *fixedWindowLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	e, ok := l.hits[key]
	if !ok || now.After(e.expiresAt) {
		l.hits[key] = &windowEntry{count: 1, expiresAt: now.Add(l.window)}
		return true
	}
	if e.count >= l.limit {
		return false
	}
	e.count++
	return true
}

// janitor 定期清掉过期窗口，避免 key 无限增长（每个 IP 一个键）。
func (l *fixedWindowLimiter) janitor(window time.Duration) {
	interval := window
	if interval < time.Minute {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		l.mu.Lock()
		for k, v := range l.hits {
			if now.After(v.expiresAt) {
				delete(l.hits, k)
			}
		}
		l.mu.Unlock()
	}
}

// ClientIP 取客户端 IP。
//
// 线上 nginx 反代到 127.0.0.1，所以必须优先信任 X-Forwarded-For /
// X-Real-IP，否则所有请求都会算成同一个 IP，限流会把所有人一起拦掉。
// 注意：这两个头是客户端可伪造的，只有在「前面一定有自己的反代」的
// 部署形态下才可信（本项目线上正是这种形态）。
func ClientIP(c *gin.Context) string {
	if xff := c.GetHeader("X-Forwarded-For"); xff != "" {
		// 取第一个（最靠近客户端的一跳）
		if idx := strings.IndexByte(xff, ','); idx > 0 {
			xff = xff[:idx]
		}
		if ip := strings.TrimSpace(xff); ip != "" {
			return ip
		}
	}
	if real := strings.TrimSpace(c.GetHeader("X-Real-IP")); real != "" {
		return real
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}
