package model

import "time"

// 第三方登录提供方。provider + provider_open_id 是唯一键：
// 同一个 QQ 号重复登录必须落到同一个 DOUWAN 账号。
const (
	ProviderQQ     = "qq"
	ProviderWeChat = "wechat"
)

// UserIdentity 第三方登录身份。
//
// 刻意不把 openid 写进 User 表：一个账号可以绑定多个登录方式，
// 以后接入微信 / 手机号时不需要再改用户表结构。
// 也刻意不做「昵称 / 头像相同就自动合并」——第三方昵称随时可改，
// 用它合并账号等于把两个真实用户并成一个，属于不可逆的数据事故。
type UserIdentity struct {
	Base
	UserID         uint64 `gorm:"index;not null" json:"user_id"`
	Provider       string `gorm:"size:32;not null;uniqueIndex:uk_user_identity_provider_openid,priority:1" json:"provider"`
	ProviderOpenID string `gorm:"size:128;not null;uniqueIndex:uk_user_identity_provider_openid,priority:2" json:"provider_open_id"`
	// UnionID 微信开放平台跨应用唯一标识；QQ 没有这个字段，留空。
	UnionID string `gorm:"size:128;index" json:"union_id"`
	// 第三方返回的昵称 / 头像只作为「首次创建账号时的默认资料」和展示，
	// 用户在豆玩里改过的昵称不会被后续登录覆盖。
	Nickname    string     `gorm:"size:64" json:"nickname"`
	AvatarURL   string     `gorm:"size:512" json:"avatar_url"`
	LastLoginAt *time.Time `json:"last_login_at"`
}

// ProviderLabel 给后台和用户中心看的可读名称。
func ProviderLabel(provider string) string {
	switch provider {
	case ProviderQQ:
		return "QQ"
	case ProviderWeChat:
		return "微信"
	default:
		return provider
	}
}
