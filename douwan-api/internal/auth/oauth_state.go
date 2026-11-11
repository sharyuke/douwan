package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// OAuthState 是 OAuth 的 state 载荷。
//
// state 由服务端签发并校验：签名用 JWT 同一把密钥，带过期时间与随机 nonce。
// 这样即使没有 Redis 也能防 CSRF —— 攻击者伪造不出合法签名。
// Mode 为 bind 时 UserID 表示「要绑定到哪个已登录账号」；
// Mode 为 login 时 UserID 为 0，回调按 openid 找账号或新建账号。
type OAuthState struct {
	Nonce     string `json:"n"`
	Provider  string `json:"p,omitempty"`
	UserID    uint64 `json:"u,omitempty"`
	Mode      string `json:"m"`
	ExpiresAt int64  `json:"e"`
}

const (
	OAuthModeLogin = "login"
	OAuthModeBind  = "bind"
)

// state 会原样出现在第三方授权地址的 query 里，微信限制 128 字节，
// 所以载荷用单字母缩写（q/w、l/b），签名截到 128 位。
// 解析时同时兼容旧格式（login/bind、qq/wechat、256 位签名）。
func compactProvider(provider string) string {
	switch provider {
	case "wechat":
		return "w"
	case "qq":
		return "q"
	default:
		return provider
	}
}

func expandProvider(provider string) string {
	switch provider {
	case "w":
		return "wechat"
	case "q":
		return "qq"
	default:
		return provider
	}
}

func compactMode(mode string) string {
	switch mode {
	case OAuthModeLogin:
		return "l"
	case OAuthModeBind:
		return "b"
	default:
		return mode
	}
}

func expandMode(mode string) string {
	switch mode {
	case "l":
		return OAuthModeLogin
	case "b":
		return OAuthModeBind
	default:
		return mode
	}
}

// SignOAuthState 生成 QQ 登录的 state，保留给旧调用方。
func (m *Manager) SignOAuthState(userID uint64, mode string, ttl time.Duration) (string, error) {
	return m.SignOAuthStateFor("qq", userID, mode, ttl)
}

// SignOAuthStateFor 生成指定登录方式的 state。
//
// provider 写进签名载荷：微信的回调不能消费一个为 QQ 签发的 state，
// 否则攻击者可以把一个平台的授权码塞进另一个平台的回调。
// nonce 只用于让每次 state 都不同，真正防篡改的是 HMAC 签名。
func (m *Manager) SignOAuthStateFor(provider string, userID uint64, mode string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成 OAuth state: %w", err)
	}
	payload := OAuthState{
		Nonce:     base64.RawURLEncoding.EncodeToString(buf),
		Provider:  compactProvider(provider),
		UserID:    userID,
		Mode:      compactMode(mode),
		ExpiresAt: time.Now().Add(ttl).Unix(),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("编码 OAuth state: %w", err)
	}
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write(body)
	// 截到 128 位：state 要压进 128 字节，128 位 HMAC 仍然足够防伪造。
	sum := mac.Sum(nil)[:16]
	return base64.RawURLEncoding.EncodeToString(body) + "." +
		base64.RawURLEncoding.EncodeToString(sum), nil
}

// ParseOAuthState 校验签名与过期时间，返回载荷。
func (m *Manager) ParseOAuthState(raw string) (*OAuthState, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return nil, response.ErrOAuthStateInvalid
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, response.ErrOAuthStateInvalid
	}
	gotMAC, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, response.ErrOAuthStateInvalid
	}
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write(body)
	full := mac.Sum(nil)
	// 新格式 16 字节，旧格式 32 字节；两种都接受，避免部署瞬间
	// 让用户手里还没回调的 state 全部失效。
	if len(gotMAC) == 16 {
		if subtle.ConstantTimeCompare(gotMAC, full[:16]) != 1 {
			return nil, response.ErrOAuthStateInvalid
		}
	} else if subtle.ConstantTimeCompare(gotMAC, full) != 1 {
		return nil, response.ErrOAuthStateInvalid
	}
	var payload OAuthState
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, response.ErrOAuthStateInvalid
	}
	payload.Provider = expandProvider(payload.Provider)
	payload.Mode = expandMode(payload.Mode)
	if payload.Nonce == "" || payload.ExpiresAt <= time.Now().Unix() {
		return nil, response.ErrOAuthStateInvalid
	}
	if payload.Mode != OAuthModeLogin && payload.Mode != OAuthModeBind {
		return nil, response.ErrOAuthStateInvalid
	}
	// 2026-10 之前签发的 state 没有 provider 字段，按 QQ 处理。
	if payload.Provider == "" {
		payload.Provider = "qq"
	}
	if payload.Provider != "qq" && payload.Provider != "wechat" {
		return nil, response.ErrOAuthStateInvalid
	}
	return &payload, nil
}
