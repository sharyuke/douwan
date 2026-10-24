// Package auth 负责访问令牌的签发与校验，以及刷新令牌的存储。
package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// 令牌主体类型。用户令牌与管理员令牌必须能区分开：
// 只验签名的话，普通用户的令牌就能拿去调后台接口（需求 §3.3「服务端验证权限」）。
const (
	KindUser  = "user"
	KindAdmin = "admin"
)

// Claims 访问令牌载荷。UserID 放在自定义字段里，
// 同时复用 RegisteredClaims 的过期时间与签发者。
//
// Kind 标识这是用户令牌还是管理员令牌；AdminID / Role 只在管理员令牌里有值，
// 让后台鉴权中间件不必每个请求都查库（需求 §3.3：也不能只靠前端）。
type Claims struct {
	UserID  uint64 `json:"uid"`
	Kind    string `json:"knd"`
	AdminID uint64 `json:"aid,omitempty"`
	Role    string `json:"rol,omitempty"`
	jwt.RegisteredClaims
}

// Manager 令牌管理器。
//
// 访问令牌是无状态 JWT，短期有效；刷新令牌是不透明随机串，
// 存在 TokenStore 里，因此可以撤销（登出即失效）。
type Manager struct {
	secret     []byte
	issuer     string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// NewManager 构造令牌管理器。
func NewManager(cfg config.JWT) *Manager {
	return &Manager{
		secret:     []byte(cfg.Secret),
		issuer:     cfg.Issuer,
		accessTTL:  cfg.AccessTTL,
		refreshTTL: cfg.RefreshTTL,
	}
}

// AccessTTL 访问令牌有效期，返回给前端用于计算刷新时机。
func (m *Manager) AccessTTL() time.Duration { return m.accessTTL }

// RefreshTTL 刷新令牌有效期。
func (m *Manager) RefreshTTL() time.Duration { return m.refreshTTL }

// GenerateAccessToken 签发用户访问令牌，同时返回过期时间。
func (m *Manager) GenerateAccessToken(userID uint64) (string, time.Time, error) {
	return m.sign(Claims{UserID: userID, Kind: KindUser})
}

// GenerateAdminAccessToken 签发管理员访问令牌。
func (m *Manager) GenerateAdminAccessToken(adminID uint64, role string) (string, time.Time, error) {
	return m.sign(Claims{AdminID: adminID, Role: role, Kind: KindAdmin})
}

// sign 用给定载荷签发令牌。
func (m *Manager) sign(claims Claims) (string, time.Time, error) {
	now := time.Now()
	expiresAt := now.Add(m.accessTTL)
	claims.RegisteredClaims = jwt.RegisteredClaims{
		Subject:   subjectOf(claims),
		Issuer:    m.issuer,
		IssuedAt:  jwt.NewNumericDate(now),
		NotBefore: jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expiresAt),
		ID:        mustRandomString(16),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("签发访问令牌: %w", err)
	}
	return signed, expiresAt, nil
}

func subjectOf(claims Claims) string {
	if claims.Kind == KindAdmin {
		return "admin:" + strconv.FormatUint(claims.AdminID, 10)
	}
	return strconv.FormatUint(claims.UserID, 10)
}

// ParseAccessToken 校验并解析访问令牌。
// 过期与非法分别返回 ErrTokenExpired / ErrTokenInvalid，前端据此决定是否去刷新。
func (m *Manager) ParseAccessToken(token string) (*Claims, error) {
	claims, err := m.parse(token)
	if err != nil {
		return nil, err
	}
	// 老令牌没有 Kind 字段，按用户令牌处理，避免升级后所有人被登出
	if claims.Kind == KindAdmin {
		return nil, response.ErrTokenInvalid.WithMessage("这是管理员令牌，不能用于前台接口")
	}
	if claims.UserID == 0 {
		return nil, response.ErrTokenInvalid.WithMessage("令牌缺少用户标识")
	}
	return claims, nil
}

// ParseAdminAccessToken 校验并解析管理员访问令牌。
func (m *Manager) ParseAdminAccessToken(token string) (*Claims, error) {
	claims, err := m.parse(token)
	if err != nil {
		return nil, err
	}
	if claims.Kind != KindAdmin || claims.AdminID == 0 {
		return nil, response.ErrTokenInvalid.WithMessage("登录凭证无效，请重新登录后台")
	}
	return claims, nil
}

// parse 只做签名与时间校验，不判断令牌用途。
func (m *Manager) parse(token string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名算法: %v", t.Header["alg"])
		}
		return m.secret, nil
	}, jwt.WithIssuer(m.issuer), jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, response.ErrTokenExpired
		}
		return nil, response.ErrTokenInvalid.WithCause(err)
	}
	return claims, nil
}

// GenerateRefreshToken 生成不透明刷新令牌。
func (m *Manager) GenerateRefreshToken() (string, error) {
	return randomString(32)
}

func randomString(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成随机串: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// mustRandomString 用于令牌 ID 这类非安全关键字段，
// 随机源出错时退回空串而不是让签发整体失败。
func mustRandomString(n int) string {
	s, err := randomString(n)
	if err != nil {
		return ""
	}
	return s
}
