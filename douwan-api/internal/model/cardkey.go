package model

import "time"

// 卡密状态（需求 §6.2）。
const (
	CardStatusUnused   = "unused"   // 未使用：可发放 / 可兑换
	CardStatusRedeemed = "redeemed" // 已兑换：不可再次兑换
	CardStatusExpired  = "expired"  // 已过期：超过兑换截止时间
	CardStatusVoided   = "voided"   // 已作废：管理员手动作废
)

// 卡密明文存储的密文用途标识，便于将来换算法时平滑迁移。
const CardCipherAlgo = "aes-256-gcm:v1"

// CardKey 卡密。
//
// 存储策略（需求 §12.2 要求权衡「不可逆存储」与「必须能再次交付」）：
//   - CodeHash：SHA-256 摘要，唯一索引，兑换与查询都走它，不可逆；
//   - CodeCiphertext：AES-256-GCM 密文，只有带 card.reveal 权限的管理员
//     才能解密查看，且每次查看/导出都会写操作日志；
//   - CodeMasked：脱敏串，列表默认只返回它。
//
// 只存哈希的话管理员无法导出交付，只存明文的话数据库泄露即全部失效，
// 所以两者都存，用权限与日志把明文的口子收紧。
type CardKey struct {
	Base
	CodeHash       string `gorm:"size:64;uniqueIndex;not null" json:"-"`
	CodeCiphertext string `gorm:"size:255;not null" json:"-"`
	CodeMasked     string `gorm:"size:32;not null" json:"code_masked"`
	// CodePrefix 是去掉连字符后的卡密**前 8 位**，只用于后台按卡密搜索。
	//
	// 为什么不直接用 CodeMasked 搜索：脱敏串里插了连字符（ABCD-****-…），
	// 运营复制粘贴前几位时往往不带连字符，直接用 LIKE 匹配会搜不到。
	// 为什么只存 8 位：卡密随机部分有 16 位，8 位前缀（30^8 ≈ 6.6e11 种）
	// 既足够定位到某一张，又不会因为数据库泄露而让人反推出完整卡密。
	CodePrefix string `gorm:"size:8;index" json:"code_prefix,omitempty"`

	PlanID uint64 `gorm:"index;not null" json:"plan_id"`
	// PlanSnapshot 生成卡密那一刻的权益快照：套餐之后被改名、改价、下架，
	// 已发行卡密的权益都不受影响（需求 §6.1 / §13.2）。
	PlanSnapshot PlanSnapshot `gorm:"serializer:json;type:jsonb" json:"plan_snapshot"`
	PlanName     string       `gorm:"size:64" json:"plan_name"` // 冗余，列表直接展示

	BatchID   string `gorm:"size:40;index" json:"batch_id"`
	BatchName string `gorm:"size:64;index" json:"batch_name"`

	Status string `gorm:"size:16;not null;default:'unused';index" json:"status"`

	// RedeemExpiresAt 卡密本身的兑换截止时间（与用户兑换后拿到的权益有效期是两回事）
	RedeemExpiresAt *time.Time `gorm:"index" json:"redeem_expires_at"`

	RedeemedBy uint64     `gorm:"index" json:"redeemed_by"`
	RedeemedAt *time.Time `json:"redeemed_at"`

	// 兑换后发放的权益时间窗（快照，便于列表直接看）
	EntitlementID        uint64     `gorm:"index" json:"entitlement_id"`
	EntitlementStartedAt *time.Time `json:"entitlement_started_at"`
	EntitlementExpiresAt *time.Time `json:"entitlement_expires_at"`

	OrderID  uint64     `gorm:"index" json:"order_id"`
	OrderNo  string     `gorm:"size:32;index" json:"order_no"`
	IssuedAt *time.Time `json:"issued_at"`
	// IntendedUserID 发卡时绑定的收货用户。
	// 用于提示「这张卡密是给自己订单发的，请勿重复兑换」——订单发卡已经
	// 直接把权益发给了下单用户，同一张卡密再兑换一次等于双倍发放。
	IntendedUserID uint64 `gorm:"index" json:"intended_user_id"`

	Note      string `gorm:"size:255" json:"note"`
	CreatedBy uint64 `gorm:"index" json:"created_by"`

	VoidedBy   uint64     `gorm:"index" json:"voided_by"`
	VoidedAt   *time.Time `json:"voided_at"`
	VoidReason string     `gorm:"size:255" json:"void_reason"`
}

// IsRedeemable 判断卡密当前是否可兑换。now 由调用方传入，便于测试与统一时钟。
// 注意：真正的并发安全靠数据库的条件更新（见 CardKeyRepository.Redeem），
// 这里只是把状态判断集中到一处，避免各调用点各写一套。
func (c *CardKey) IsRedeemable(now time.Time) (bool, string) {
	switch c.Status {
	case CardStatusRedeemed:
		return false, "这张卡密已经被兑换过了"
	case CardStatusVoided:
		return false, "这张卡密已作废，请联系客服"
	case CardStatusExpired:
		return false, "这张卡密已超过兑换截止日期"
	}
	if c.RedeemExpiresAt != nil && !now.Before(*c.RedeemExpiresAt) {
		return false, "这张卡密已超过兑换截止日期"
	}
	return true, ""
}

// CardStatusLabel 卡密状态中文名。
func CardStatusLabel(status string) string {
	switch status {
	case CardStatusUnused:
		return "未使用"
	case CardStatusRedeemed:
		return "已兑换"
	case CardStatusExpired:
		return "已过期"
	case CardStatusVoided:
		return "已作废"
	default:
		return status
	}
}
