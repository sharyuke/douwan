package auth

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// Subject 是刷新令牌指向的主体：前台用户或后台管理员。
type Subject struct {
	Kind string // KindUser / KindAdmin
	ID   uint64
	// Role 只在管理员令牌里有值。存进来是为了让后台能展示在线信息，
	// 权限判定不依赖它（每次请求都会按 AdminID 重新判断）。
	Role string
}

// TokenStore 保存刷新令牌 → 主体的映射。
// 抽成接口是为了让 Redis 可选：单机部署用内存实现，多实例部署开 Redis。
type TokenStore interface {
	Save(ctx context.Context, token string, subject Subject, ttl time.Duration) error
	// Subject 查不到或已过期时返回 response.ErrTokenInvalid
	Subject(ctx context.Context, token string) (Subject, error)
	Delete(ctx context.Context, token string) error
	Close() error
}

/* ------------------------------------------------------------------ 内存实现 */

// MemoryTokenStore 进程内实现。进程重启后所有刷新令牌失效，用户需重新登录。
type MemoryTokenStore struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
	stop    chan struct{}
	once    sync.Once
}

type memoryEntry struct {
	subject   Subject
	expiresAt time.Time
}

// NewMemoryTokenStore 启动一个带清理协程的内存存储。
func NewMemoryTokenStore() *MemoryTokenStore {
	s := &MemoryTokenStore{
		entries: make(map[string]memoryEntry),
		stop:    make(chan struct{}),
	}
	go s.janitor(10 * time.Minute)
	return s
}

func (s *MemoryTokenStore) Save(_ context.Context, token string, subject Subject, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[token] = memoryEntry{subject: subject, expiresAt: time.Now().Add(ttl)}
	return nil
}

func (s *MemoryTokenStore) Subject(_ context.Context, token string) (Subject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[token]
	if !ok || time.Now().After(e.expiresAt) {
		return Subject{}, response.ErrTokenInvalid
	}
	return e.subject, nil
}

func (s *MemoryTokenStore) Delete(_ context.Context, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, token)
	return nil
}

// Close 停掉清理协程。
func (s *MemoryTokenStore) Close() error {
	s.once.Do(func() { close(s.stop) })
	return nil
}

func (s *MemoryTokenStore) janitor(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			now := time.Now()
			s.mu.Lock()
			for k, v := range s.entries {
				if now.After(v.expiresAt) {
					delete(s.entries, k)
				}
			}
			s.mu.Unlock()
		}
	}
}

/* ------------------------------------------------------------------ Redis 实现 */

// RedisTokenStore 用 Redis 保存刷新令牌，多实例部署时各节点共享。
// 值格式为 "kind:id:role"，比 JSON 省事，也便于 redis-cli 直接看。
type RedisTokenStore struct {
	client *redis.Client
	prefix string
}

// NewRedisTokenStore 构造 Redis 存储。
func NewRedisTokenStore(client *redis.Client) *RedisTokenStore {
	return &RedisTokenStore{client: client, prefix: "douwan:refresh:"}
}

func (s *RedisTokenStore) Save(ctx context.Context, token string, subject Subject, ttl time.Duration) error {
	return s.client.Set(ctx, s.prefix+token, encodeSubject(subject), ttl).Err()
}

func (s *RedisTokenStore) Subject(ctx context.Context, token string) (Subject, error) {
	raw, err := s.client.Get(ctx, s.prefix+token).Result()
	if err != nil {
		if err == redis.Nil {
			return Subject{}, response.ErrTokenInvalid
		}
		return Subject{}, response.ErrTokenInvalid.WithCause(err)
	}
	subject, ok := decodeSubject(raw)
	if !ok {
		return Subject{}, response.ErrTokenInvalid
	}
	return subject, nil
}

func (s *RedisTokenStore) Delete(ctx context.Context, token string) error {
	return s.client.Del(ctx, s.prefix+token).Err()
}

// Close 不关闭客户端：连接池由调用方统一管理。
func (s *RedisTokenStore) Close() error { return nil }

/* ------------------------------------------------------------------ 序列化 */

func encodeSubject(s Subject) string {
	kind := s.Kind
	if kind == "" {
		kind = KindUser
	}
	return kind + ":" + strconv.FormatUint(s.ID, 10) + ":" + s.Role
}

func decodeSubject(raw string) (Subject, bool) {
	parts := strings.SplitN(raw, ":", 3)
	if len(parts) < 2 {
		return Subject{}, false
	}
	id, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil || id == 0 {
		return Subject{}, false
	}
	s := Subject{Kind: parts[0], ID: id}
	if len(parts) == 3 {
		s.Role = parts[2]
	}
	if s.Kind == "" {
		s.Kind = KindUser
	}
	return s, true
}
