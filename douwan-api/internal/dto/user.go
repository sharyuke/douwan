// Package dto 存放 HTTP 层的请求与响应结构，是接口契约的唯一出处。
package dto

import (
	"time"

	"gitee.com/maryuke/douwan-api/internal/model"
)

/* ------------------------------------------------------------------ 请求 */

// RegisterRequest 注册。
//
// Channel / UTMSource / Referrer 用于来源渠道归因（可选，不传不影响注册）。
// 这三个字段刻意不加长度校验：一个超长的 referrer 不该让用户注册失败，
// 服务层会归一化并截断后再落库。
type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=32,alphanum"`
	Password string `json:"password" binding:"required,min=8,max=64"`
	Nickname string `json:"nickname" binding:"omitempty,max=32"`
	Email    string `json:"email" binding:"omitempty,email,max=128"`
	Phone    string `json:"phone" binding:"omitempty,max=32"`
	// Channel 是运营给渠道起的短名（gitee / weibo / friend ...），优先级最高
	Channel string `json:"channel"`
	// UTMSource 兼容标准的 utm_source，前端把落地页参数透传过来即可
	UTMSource string `json:"utm_source"`
	// Referrer 是来源页地址；留空时服务端会尝试用请求头的 Referer
	Referrer string `json:"referrer"`
	// SiteHost 由处理函数填入当前站点域名（不出现在 JSON 里），
	// 用来把「站内跳转」识别成「直接访问」而不是当成外部渠道
	SiteHost string `json:"-"`
}

// LoginRequest 登录。account 可以是用户名、邮箱或手机号。
//
// 来源字段含义与注册一致，但只在用户还没有渠道记录时才会写入：
// 首触归因，老用户第一次带来源信息登录时补上，之后不再改写。
type LoginRequest struct {
	Account  string `json:"account" binding:"required"`
	Password string `json:"password" binding:"required"`

	Channel   string `json:"channel"`
	UTMSource string `json:"utm_source"`
	Referrer  string `json:"referrer"`
	SiteHost  string `json:"-"`
}

// RefreshRequest 用刷新令牌换新的令牌对。
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// LogoutRequest 登出。带上刷新令牌才会让它立即失效。
type LogoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// UpdateProfileRequest 修改资料。用指针区分「没传」与「传了空值」。
type UpdateProfileRequest struct {
	Nickname  *string `json:"nickname" binding:"omitempty,max=32"`
	AvatarURL *string `json:"avatar_url" binding:"omitempty,url,max=512"`
}

/* ------------------------------------------------------------------ 响应 */

// TokenPair 令牌对。
type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresIn    int64     `json:"expires_in"` // 访问令牌剩余秒数
	ExpiresAt    time.Time `json:"expires_at"`
}

// UserProfile 用户资料。密码哈希等敏感字段不出现在这里。
type UserProfile struct {
	ID          uint64     `json:"id"`
	Username    string     `json:"username"`
	Email       string     `json:"email"`
	Phone       string     `json:"phone"`
	Nickname    string     `json:"nickname"`
	AvatarURL   string     `json:"avatar_url"`
	Status      int8       `json:"status"`
	LastLoginAt *time.Time `json:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// MembershipInfo 会员状态。字段名与前端 useMembership.js 的 plan / expireAt 对齐。
type MembershipInfo struct {
	Plan      string     `json:"plan"`
	IsPro     bool       `json:"is_pro"`
	ExpireAt  *time.Time `json:"expire_at"`
	AutoRenew bool       `json:"auto_renew"`
}

// CreditInfo AI Credits 余额。
type CreditInfo struct {
	Balance int `json:"balance"`
}

// UsageInfo 使用统计。
type UsageInfo struct {
	Generated int `json:"generated"`
	Exported  int `json:"exported"`
	AICalls   int `json:"ai_calls"`
}

// AuthResult 注册 / 登录 / 刷新的统一返回：用户资料 + 令牌对。
type AuthResult struct {
	User   UserProfile `json:"user"`
	Tokens TokenPair   `json:"tokens"`
}

// MeResult 「我的账户」聚合返回，对应前端账户页要展示的几块信息。
type MeResult struct {
	User       UserProfile    `json:"user"`
	Membership MembershipInfo `json:"membership"`
	Credits    CreditInfo     `json:"credits"`
	Usage      UsageInfo      `json:"usage"`
}

/* ------------------------------------------------------------------ 转换 */

// NewUserProfile 把实体转成对外资料。
func NewUserProfile(u *model.User) UserProfile {
	return UserProfile{
		ID:          u.ID,
		Username:    u.Username,
		Email:       u.Email,
		Phone:       u.Phone,
		Nickname:    u.Nickname,
		AvatarURL:   u.AvatarURL,
		Status:      u.Status,
		LastLoginAt: u.LastLoginAt,
		CreatedAt:   u.CreatedAt,
	}
}

// NewMembershipInfo 把订阅实体转成对外信息。m 为 nil 时按免费套餐返回。
func NewMembershipInfo(m *model.Membership, now time.Time) MembershipInfo {
	if m == nil {
		return MembershipInfo{Plan: model.PlanFree}
	}
	return MembershipInfo{
		Plan:      m.Plan,
		IsPro:     m.IsPro(now),
		ExpireAt:  m.ExpireAt,
		AutoRenew: m.AutoRenew,
	}
}
