package model

import "time"

/* ------------------------------------------------------------------ 订单 */

// 支付状态（需求 §7.2）。
const (
	PaymentStatusPending  = "pending"   // 待支付
	PaymentStatusPaid     = "paid"      // 已支付
	PaymentStatusClosed   = "closed"    // 已关闭 / 已取消
	PaymentStatusRefund   = "refunding" // 退款处理中
	PaymentStatusRefunded = "refunded"  // 已退款
)

// 发卡状态，与支付状态分开表达（需求 §7.2）。
const (
	FulfillmentPending  = "pending"  // 未发放
	FulfillmentIssued   = "issued"   // 已发放
	FulfillmentFailed   = "failed"   // 发放失败待处理
	FulfillmentCanceled = "canceled" // 订单关闭，无需发放
)

// 支付方式。未接入真实支付渠道时只能用人工确认（需求 §7.1 / §7.4）。
const (
	PaymentMethodUnset  = ""       // 尚未配置
	PaymentMethodManual = "manual" // 管理员人工确认收款
	// 以下为将来接入真实渠道预留的标识，本期不会产生
	PaymentMethodWechat = "wechat"
	PaymentMethodAlipay = "alipay"
)

// Order 订单。
//
// 支付渠道尚未确定（需求 §18），因此业务逻辑不绑定任何一家服务商：
// 表里只有通用字段，真实渠道接入时由 PaymentService 抽象承接。
type Order struct {
	Base
	OrderNo string `gorm:"size:32;uniqueIndex;not null" json:"order_no"`

	UserID      uint64 `gorm:"index;not null" json:"user_id"`
	UserAccount string `gorm:"size:64" json:"user_account"` // 冗余账号，列表直接展示

	PlanID uint64 `gorm:"index;not null" json:"plan_id"`
	// PlanSnapshot 下单时的套餐、价格、权益快照，之后改价不影响本单
	PlanSnapshot PlanSnapshot `gorm:"serializer:json;type:jsonb" json:"plan_snapshot"`
	PlanName     string       `gorm:"size:64" json:"plan_name"`

	Quantity int `gorm:"not null;default:1" json:"quantity"`
	// 金额单位：元，两位小数。落库精度由 numeric(10,2) 保证。
	AmountDue  float64 `gorm:"type:numeric(10,2);not null;default:0" json:"amount_due"`
	AmountPaid float64 `gorm:"type:numeric(10,2);not null;default:0" json:"amount_paid"`

	PaymentMethod     string `gorm:"size:32;index" json:"payment_method"`
	PaymentStatus     string `gorm:"size:16;not null;default:'pending';index" json:"payment_status"`
	FulfillmentStatus string `gorm:"size:16;not null;default:'pending';index" json:"fulfillment_status"`

	// PaymentTransactionID 支付平台流水号，人工确认时由管理员填写（可为空）
	PaymentTransactionID string `gorm:"size:64;index" json:"payment_transaction_id"`

	PaidAt      *time.Time `json:"paid_at"`
	ClosedAt    *time.Time `json:"closed_at"`
	RefundedAt  *time.Time `json:"refunded_at"`
	FulfilledAt *time.Time `json:"fulfilled_at"`

	// 人工操作痕迹：谁在什么时候确认了收款 / 发了卡（需求 §6.6）
	PaidConfirmedBy uint64     `gorm:"index" json:"paid_confirmed_by"`
	PaidConfirmedAt *time.Time `json:"paid_confirmed_at"`
	FulfilledBy     uint64     `gorm:"index" json:"fulfilled_by"`

	CardIssuedCount int    `gorm:"not null;default:0" json:"card_issued_count"`
	Note            string `gorm:"size:255" json:"note"`

	// FulfillmentKey 发卡幂等键。
	//
	// 这里踩过一个很难查的坑，写清楚免得后人再踩：
	// 原来它是 `uniqueIndex`（全表唯一），而新建订单时这个字段是空串，
	// 于是**第一笔订单能建、第二笔订单必然撞唯一索引**，
	// 报出来的错误却是「订单号重复，请重试」——因为 GORM 的
	// TranslateError 把唯一键冲突统一翻译成 ErrDuplicatedKey，
	// 仓储又把它当成订单号冲突。线上实测的结果是「系统只能下一单」。
	//
	// 现在的做法：
	//  1. 类型改成 *string，新建时保持 NULL（数据库里不会出现重复的空串）；
	//  2. 索引是 where 排除 NULL 与空串的部分唯一索引；
	//  3. 发卡时写入 `order:<订单号>`，既非空又天然唯一。
	FulfillmentKey *string `gorm:"size:64;uniqueIndex:uk_orders_fulfillment_key,where:fulfillment_key IS NOT NULL AND fulfillment_key <> ''" json:"-"`
}

// CanIssueCards 判断订单是否允许进入发卡流程（需求 §13.6：未支付订单不能发卡）。
func (o *Order) CanIssueCards() bool {
	return o.PaymentStatus == PaymentStatusPaid
}

// PaymentStatusLabel 支付状态中文名。
func PaymentStatusLabel(s string) string {
	switch s {
	case PaymentStatusPending:
		return "待支付"
	case PaymentStatusPaid:
		return "已支付"
	case PaymentStatusClosed:
		return "已关闭"
	case PaymentStatusRefund:
		return "退款处理中"
	case PaymentStatusRefunded:
		return "已退款"
	default:
		return s
	}
}

// FulfillmentStatusLabel 发卡状态中文名。
func FulfillmentStatusLabel(s string) string {
	switch s {
	case FulfillmentPending:
		return "未发放"
	case FulfillmentIssued:
		return "已发放"
	case FulfillmentFailed:
		return "发放失败待处理"
	case FulfillmentCanceled:
		return "无需发放"
	default:
		return s
	}
}

// PaymentMethodLabel 支付方式中文名。
func PaymentMethodLabel(m string) string {
	switch m {
	case PaymentMethodManual:
		return "人工确认"
	case PaymentMethodWechat:
		return "微信支付"
	case PaymentMethodAlipay:
		return "支付宝"
	case PaymentMethodUnset:
		return "待配置"
	default:
		return m
	}
}

// OrderEvent 订单状态变化记录（需求 §7.3「查看订单详情和状态变化记录」）。
type OrderEvent struct {
	Base
	OrderID   uint64 `gorm:"index;not null" json:"order_id"`
	OrderNo   string `gorm:"size:32;index" json:"order_no"`
	Action    string `gorm:"size:32;not null" json:"action"`
	FromState string `gorm:"size:32" json:"from_state"`
	ToState   string `gorm:"size:32" json:"to_state"`
	Note      string `gorm:"size:255" json:"note"`
	AdminID   uint64 `gorm:"index" json:"admin_id"`
	AdminName string `gorm:"size:64" json:"admin_name"`
}

/* ------------------------------------------------------------------ 权益 */

// 权益来源（需求 §12.4）。
const (
	EntitlementSourceCard  = "card_key"    // 卡密兑换
	EntitlementSourceOrder = "order"       // 订单发放
	EntitlementSourceAdmin = "admin_grant" // 管理员手动发放
)

// 权益状态。
const (
	EntitlementStatusActive  = "active"
	EntitlementStatusExpired = "expired"
	EntitlementStatusRevoked = "revoked"
	EntitlementStatusUsedUp  = "used_up"
)

// Entitlement 用户权益。卡密兑换与订单发卡最终都落到这里。
//
// 与现有 model.Membership 的关系：Membership 是「当前是不是 Pro」的
// 单一状态位，前台会员判定在用它。这里的 Entitlement 是发放流水 + 额度账本，
// 发放成功后会把 Membership 同步成对应套餐，避免出现两套互不相通的权限系统
// （需求 §12.4 的明确要求）。
type Entitlement struct {
	Base
	UserID      uint64 `gorm:"index;not null" json:"user_id"`
	UserAccount string `gorm:"size:64" json:"user_account"`

	SourceType string `gorm:"size:16;index;not null" json:"source_type"`
	SourceID   uint64 `gorm:"index" json:"source_id"`
	SourceNo   string `gorm:"size:64" json:"source_no"` // 卡密脱敏串或订单号
	// OrderID 关联订单（卡密兑换时是卡密所属订单，订单发卡时就是本单）
	OrderID uint64 `gorm:"index" json:"order_id"`

	PlanID uint64 `gorm:"index" json:"plan_id"`
	// PlanSnapshot 发放时的权益快照，后续改套餐不影响已发放的权益
	PlanSnapshot PlanSnapshot `gorm:"serializer:json;type:jsonb" json:"plan_snapshot"`
	PlanName     string       `gorm:"size:64" json:"plan_name"`
	// PlanCode 用于前台权益判定的套餐标识
	PlanCode string `gorm:"size:32;index" json:"plan_code"`

	StartsAt  time.Time  `gorm:"not null" json:"starts_at"`
	ExpiresAt *time.Time `gorm:"index" json:"expires_at"` // 为空表示不设时长

	// UsageLimit 为空表示不限量；UsageUsed 记录已用额度
	UsageLimit *int `json:"usage_limit"`
	UsageUsed  int  `gorm:"not null;default:0" json:"usage_used"`

	Status string `gorm:"size:16;not null;default:'active';index" json:"status"`
	Note   string `gorm:"size:255" json:"note"`

	GrantedBy uint64 `gorm:"index" json:"granted_by"`

	RevokedBy  uint64     `gorm:"index" json:"revoked_by"`
	RevokedAt  *time.Time `json:"revoked_at"`
	RevokeNote string     `gorm:"size:255" json:"revoke_note"`
}

// IsActiveAt 判断权益在某个时刻是否有效。
func (e *Entitlement) IsActiveAt(now time.Time) bool {
	if e.Status != EntitlementStatusActive {
		return false
	}
	if e.ExpiresAt != nil && !now.Before(*e.ExpiresAt) {
		return false
	}
	return !now.Before(e.StartsAt)
}

// Remaining 剩余额度；不限量返回 -1。
func (e *Entitlement) Remaining() int {
	if e.UsageLimit == nil {
		return -1
	}
	if *e.UsageLimit <= e.UsageUsed {
		return 0
	}
	return *e.UsageLimit - e.UsageUsed
}

// EntitlementSourceLabel 权益来源中文名。
func EntitlementSourceLabel(s string) string {
	switch s {
	case EntitlementSourceCard:
		return "卡密兑换"
	case EntitlementSourceOrder:
		return "订单发放"
	case EntitlementSourceAdmin:
		return "管理员发放"
	default:
		return s
	}
}

// EntitlementStatusLabel 权益状态中文名。
func EntitlementStatusLabel(s string) string {
	switch s {
	case EntitlementStatusActive:
		return "生效中"
	case EntitlementStatusExpired:
		return "已过期"
	case EntitlementStatusRevoked:
		return "已撤销"
	case EntitlementStatusUsedUp:
		return "额度已用完"
	default:
		return s
	}
}
