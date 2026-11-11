package auth

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/response"
)

func testManager() *Manager {
	return NewManager(config.JWT{
		Secret: "test-secret", Issuer: "douwan-api-test",
		AccessTTL: time.Minute, RefreshTTL: time.Hour,
	})
}

func TestOAuthStateRoundTrip(t *testing.T) {
	m := testManager()
	raw, err := m.SignOAuthState(42, OAuthModeBind, time.Minute)
	if err != nil {
		t.Fatalf("签发 state: %v", err)
	}
	got, err := m.ParseOAuthState(raw)
	if err != nil {
		t.Fatalf("校验 state: %v", err)
	}
	if got.UserID != 42 || got.Mode != OAuthModeBind || got.Nonce == "" {
		t.Fatalf("state 载荷不对: %+v", got)
	}
	if got.Provider != "qq" {
		t.Fatalf("旧签名默认应按 QQ 处理，实际 %q", got.Provider)
	}
}

func TestOAuthStateCarriesProvider(t *testing.T) {
	m := testManager()
	raw, err := m.SignOAuthStateFor("wechat", 0, OAuthModeLogin, time.Minute)
	if err != nil {
		t.Fatalf("签发微信 state: %v", err)
	}
	got, err := m.ParseOAuthState(raw)
	if err != nil {
		t.Fatalf("校验微信 state: %v", err)
	}
	if got.Provider != "wechat" {
		t.Fatalf("state 应保留登录方式，实际 %q", got.Provider)
	}
}

func TestOAuthStateFitsProviderLimit(t *testing.T) {
	m := testManager()
	cases := []struct {
		provider string
		userID   uint64
		mode     string
	}{
		{"qq", 0, OAuthModeLogin},
		{"wechat", 0, OAuthModeLogin},
		{"wechat", 123456, OAuthModeBind},
		{"qq", ^uint64(0), OAuthModeBind},
	}
	for _, tc := range cases {
		raw, err := m.SignOAuthStateFor(tc.provider, tc.userID, tc.mode, time.Minute)
		if err != nil {
			t.Fatalf("签发 state: %v", err)
		}
		// 微信要求 state 不超过 128 字节；QQ 也按同一上限约束。
		if len(raw) > 128 {
			t.Fatalf("%s/%d/%s 的 state 长 %d 字节，超过 128：%s",
				tc.provider, tc.userID, tc.mode, len(raw), raw)
		}
	}
}

func TestOAuthStateRejectsTamper(t *testing.T) {
	m := testManager()
	raw, err := m.SignOAuthState(0, OAuthModeLogin, time.Minute)
	if err != nil {
		t.Fatalf("签发 state: %v", err)
	}
	// 翻转签名里的一个字节：必须被 HMAC 校验挡住。
	// 不能只改最后一个 base64 字符 —— 尾部填充位不参与解码，可能改出同一串字节。
	parts := strings.Split(raw, ".")
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("解码签名: %v", err)
	}
	sig[0] ^= 0xFF
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString(sig)
	if _, err := m.ParseOAuthState(tampered); err == nil {
		t.Fatal("篡改后的 state 不应通过")
	}
	if _, err := m.ParseOAuthState("not-a-state"); err == nil {
		t.Fatal("格式错误的 state 不应通过")
	}
}

func TestOAuthStateExpires(t *testing.T) {
	m := testManager()
	raw, err := m.SignOAuthState(0, OAuthModeLogin, time.Millisecond)
	if err != nil {
		t.Fatalf("签发 state: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, err := m.ParseOAuthState(raw); err == nil {
		t.Fatal("过期的 state 不应通过")
	} else if err != response.ErrOAuthStateInvalid {
		t.Fatalf("过期 state 应返回 ErrOAuthStateInvalid，实际 %v", err)
	}
}
