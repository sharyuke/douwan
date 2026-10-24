package testsupport

import (
	"testing"
	"time"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
)

// TestJWTConfig 返回一份测试用的令牌配置。
func TestJWTConfig() config.JWT {
	return config.JWT{
		Secret:     "test-secret",
		Issuer:     "douwan-api-test",
		AccessTTL:  time.Minute,
		RefreshTTL: time.Hour,
	}
}

// NewTokens 构造测试用的令牌管理器。
func NewTokens() *auth.Manager { return auth.NewManager(TestJWTConfig()) }

// NewTokenStore 构造测试用的刷新令牌存储，测试结束自动关闭清理协程。
func NewTokenStore(t *testing.T) auth.TokenStore {
	t.Helper()
	store := auth.NewMemoryTokenStore()
	t.Cleanup(func() { _ = store.Close() })
	return store
}
