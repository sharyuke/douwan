package model

import "time"

// 用户状态。
const (
	UserStatusDisabled int8 = 0
	UserStatusActive   int8 = 1
)

// User 账号。对应前端「我的账户」，目前前端只有 localStorage 里的演示状态。
//
// email / phone 用「部分唯一索引」（where 排除空串）：两者都是选填，
// 不填时存空串，而 PostgreSQL 的唯一索引把多个空串视为互相冲突 ——
// 不加这个条件，第二个不填邮箱的用户注册就会被判成「已注册」。
type User struct {
	Base
	Username     string     `gorm:"size:64;uniqueIndex;not null" json:"username"`
	Email        string     `gorm:"size:128;uniqueIndex:uk_users_email,where:email <> ''" json:"email"`
	Phone        string     `gorm:"size:32;uniqueIndex:uk_users_phone,where:phone <> ''" json:"phone"`
	PasswordHash string     `gorm:"size:128;not null" json:"-"`
	Nickname     string     `gorm:"size:64" json:"nickname"`
	AvatarURL    string     `gorm:"size:512" json:"avatar_url"`
	Status       int8       `gorm:"not null;default:1" json:"status"`
	LastLoginAt  *time.Time `json:"last_login_at"`

	// LastActiveAt 最近一次前台活跃时间。它是 UserDailyActivity 的冗余字段，
	// 存在的意义是让「最近活跃」「沉默用户」这类查询不用回表聚合，
	// 由活跃采集器按批次更新（最多滞后一个 flush 周期）。
	LastActiveAt *time.Time `gorm:"index" json:"last_active_at"`

	// 来源渠道（首触归因）。注册时记录一次，之后不再改写：
	// 一个用户的「从哪来」只有一个答案，改成末次归因会让渠道报表随活动漂移。
	// Channel 是归一化后的短标识（gitee / weibo / direct ...），
	// ChannelDetail 保留原始值（完整 utm 串或 referer），便于事后核对。
	Channel       string `gorm:"size:32;index;not null;default:''" json:"channel"`
	ChannelDetail string `gorm:"size:255;not null;default:''" json:"channel_detail"`
}

// IsActive 判断账号是否可用。
func (u *User) IsActive() bool { return u.Status == UserStatusActive }

// 套餐标识。与前端 useMembership.js 的 PLAN_FREE / PLAN_PRO 一致，
// creator 对应权益矩阵里尚未开放的 Creator 套餐。
const (
	PlanFree    = "free"
	PlanPro     = "pro"
	PlanCreator = "creator"
)

// Membership 会员订阅。一个用户一条记录。
// 前端 isPro 的判定逻辑是「套餐为 pro 且（无到期时间或未到期）」，这里保持一致。
type Membership struct {
	Base
	UserID    uint64     `gorm:"uniqueIndex;not null" json:"user_id"`
	Plan      string     `gorm:"size:32;not null;default:'free'" json:"plan"`
	ExpireAt  *time.Time `json:"expire_at"`
	StartedAt *time.Time `json:"started_at"`
	AutoRenew bool       `gorm:"not null;default:false" json:"auto_renew"`
	// 来源：purchase 购买 / gift 赠送 / trial 试用 / manual 后台调整
	Source string `gorm:"size:32" json:"source"`
}

// IsPro 判断当前订阅在 now 时刻是否属于付费套餐。
func (m *Membership) IsPro(now time.Time) bool {
	if m == nil || m.Plan == PlanFree || m.Plan == "" {
		return false
	}
	return m.ExpireAt == nil || m.ExpireAt.After(now)
}

// CreditAccount AI Credits 账户。对应前端 useMembership.js 的 credits.balance。
type CreditAccount struct {
	Base
	UserID        uint64 `gorm:"uniqueIndex;not null" json:"user_id"`
	Balance       int    `gorm:"not null;default:0" json:"balance"`
	TotalRecharge int    `gorm:"not null;default:0" json:"total_recharge"`
	TotalSpent    int    `gorm:"not null;default:0" json:"total_spent"`
}

// CreditTransaction Credits 流水。对应前端 credits.log。
// Delta 为正表示充值、为负表示消耗，BalanceAfter 记录当时的余额，便于对账。
type CreditTransaction struct {
	Base
	UserID       uint64 `gorm:"index;not null" json:"user_id"`
	Delta        int    `gorm:"not null" json:"delta"`
	BalanceAfter int    `gorm:"not null" json:"balance_after"`
	// Reason 取值与前端 CREDIT_COST 对齐：ai.text / ai.variants / ai.batch / recharge / refund / manual
	Reason string `gorm:"size:32;not null" json:"reason"`
	Note   string `gorm:"size:255" json:"note"`
	RefID  string `gorm:"size:64" json:"ref_id"`
}

// UsageStat 使用统计。对应前端 useMembership.js 的 usage。
type UsageStat struct {
	Base
	UserID    uint64 `gorm:"uniqueIndex;not null" json:"user_id"`
	Generated int    `gorm:"not null;default:0" json:"generated"`
	Exported  int    `gorm:"not null;default:0" json:"exported"`
	AICalls   int    `gorm:"not null;default:0" json:"ai_calls"`
}
