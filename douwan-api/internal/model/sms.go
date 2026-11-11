package model

import "time"

// SmsCode 手机短信验证码。
//
// 只存哈希不存明文：验证码带着「登录凭证」的性质，库被拖走也不该能直接登录。
// 同一手机号允许多条在途记录，校验时取最新一条；Attempts 防暴力试码。
type SmsCode struct {
	Base
	Phone     string     `gorm:"size:32;index;not null" json:"phone"`
	CodeHash  string     `gorm:"size:64;not null" json:"-"`
	IP        string     `gorm:"size:64;not null;default:''" json:"ip"`
	ExpiresAt time.Time  `gorm:"not null" json:"expires_at"`
	Attempts  int        `gorm:"not null;default:0" json:"attempts"`
	UsedAt    *time.Time `json:"used_at"`
}
