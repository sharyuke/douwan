package dto

import (
	"time"

	"gitee.com/maryuke/douwan-api/internal/model"
)

/* ================================================================== 套餐 */

// PlanListQuery 套餐列表查询。
type PlanListQuery struct {
	PageQuery
	Keyword string `form:"keyword"`
	Status  string `form:"status"`
}

// PlanBenefitInput 套餐权益配置入参。
type PlanBenefitInput struct {
	Kind          string         `json:"kind" binding:"omitempty,oneof=unlimited quota count"`
	UsageLimit    int            `json:"usage_limit" binding:"omitempty,gte=0,lte=1000000"`
	Permissions   map[string]any `json:"permissions"`
	ValidityType  string         `json:"validity_type" binding:"omitempty,oneof=none hour day month"`
	ValidityValue int            `json:"validity_value" binding:"omitempty,gte=0,lte=100000"`
	StartOn       string         `json:"start_on" binding:"omitempty,oneof=redeem paid grant"`
	Stackable     bool           `json:"stackable"`
}

// PlanRequest 新建 / 编辑套餐。价格与权益全部由管理员填写，
// 代码里没有任何默认定价（需求 §0.5 / §5.4）。
type PlanRequest struct {
	Code      string `json:"code" binding:"omitempty,max=32"`
	Name      string `json:"name" binding:"required,max=64"`
	ShortDesc string `json:"short_desc" binding:"omitempty,max=128"`
	FrontDesc string `json:"front_desc" binding:"omitempty,max=512"`
	Tagline   string `json:"tagline" binding:"omitempty,max=128"`
	Tag       string `json:"tag" binding:"omitempty,max=32"`

	Price         float64  `json:"price" binding:"gte=0,lte=1000000"`
	OriginalPrice *float64 `json:"original_price" binding:"omitempty,gte=0,lte=1000000"`

	BenefitType        string           `json:"benefit_type" binding:"omitempty,oneof=unlimited quota count"`
	BenefitConfig      PlanBenefitInput `json:"benefit_config"`
	FeaturePermissions map[string]any   `json:"feature_permissions"`
	FeatureText        []string         `json:"feature_text"`

	AllowRepeatPurchase bool `json:"allow_repeat_purchase"`
	CardQuantity        int  `json:"card_quantity" binding:"omitempty,gte=1,lte=100"`
	BatchSize           int  `json:"batch_size" binding:"omitempty,gte=1,lte=10000"`
	SortOrder           int  `json:"sort_order" binding:"gte=-100000,lte=100000"`
}

// PlanStatusRequest 上下架 / 归档。
type PlanStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=draft published archived"`
	Reason string `json:"reason" binding:"omitempty,max=255"`
}

// PlanItem 套餐列表 / 详情返回。
type PlanItem struct {
	ID        uint64 `json:"id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	ShortDesc string `json:"short_desc"`
	FrontDesc string `json:"front_desc"`
	Tagline   string `json:"tagline"`
	Tag       string `json:"tag"`

	Price         float64  `json:"price"`
	OriginalPrice *float64 `json:"original_price"`

	BenefitType   string              `json:"benefit_type"`
	BenefitConfig model.BenefitConfig `json:"benefit_config"`
	ValidityType  string              `json:"validity_type"`
	ValidityValue int                 `json:"validity_value"`
	ValidityText  string              `json:"validity_text"`

	FeaturePermissions map[string]any `json:"feature_permissions"`
	FeatureText        []string       `json:"feature_text"`

	AllowRepeatPurchase bool   `json:"allow_repeat_purchase"`
	CardQuantity        int    `json:"card_quantity"`
	BatchSize           int    `json:"batch_size"`
	SortOrder           int    `json:"sort_order"`
	Status              string `json:"status"`
	StatusText          string `json:"status_text"`

	// 统计：已产生多少订单 / 卡密，用于判断能不能物理删除
	OrderCount      int64 `json:"order_count"`
	CardKeyCount    int64 `json:"card_key_count"`
	IssuedCardCount int64 `json:"issued_card_count"`

	CreatedBy   uint64     `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	PublishedAt *time.Time `json:"published_at"`
	ArchivedAt  *time.Time `json:"archived_at"`
	DeleteNote  string     `json:"delete_note"`
}

// PlanOption 下拉选项，供卡密生成 / 筛选用。
type PlanOption struct {
	ID           uint64  `json:"id"`
	Code         string  `json:"code"`
	Name         string  `json:"name"`
	Status       string  `json:"status"`
	Price        float64 `json:"price"`
	ValidityText string  `json:"validity_text"`
	// PermissionCount 权益项数量。0 表示该套餐还没配权益，
	// 生成的卡密兑换后什么都解锁不了，卡密生成页据此禁用该选项。
	PermissionCount int `json:"permission_count"`
}

/* ================================================================== 卡密 */

// CardKeyListQuery 卡密列表查询。
type CardKeyListQuery struct {
	PageQuery
	Keyword   string `form:"keyword"` // 卡密关键字（脱敏串前缀 / 完整串）
	Status    string `form:"status"`
	PlanID    uint64 `form:"plan_id"`
	BatchID   string `form:"batch_id"`
	BatchName string `form:"batch_name"`
	OrderNo   string `form:"order_no"`
	UserID    uint64 `form:"user_id"`
	// 生成时间区间，格式 YYYY-MM-DD
	CreatedFrom string `form:"created_from"`
	CreatedTo   string `form:"created_to"`
	// 兑换时间区间
	RedeemedFrom string `form:"redeemed_from"`
	RedeemedTo   string `form:"redeemed_to"`
	// 只看即将过期
	ExpiringInDays int `form:"expiring_in_days"`
}

// CardKeyGenerateRequest 批量生成卡密（需求 §6.3）。
type CardKeyGenerateRequest struct {
	PlanID    uint64 `json:"plan_id" binding:"required"`
	Count     int    `json:"count" binding:"required,gte=1,lte=1000"`
	BatchName string `json:"batch_name" binding:"omitempty,max=64"`
	Note      string `json:"note" binding:"omitempty,max=255"`
	// RedeemExpiresAt 卡密本身的兑换截止时间（可空 = 不过期）
	RedeemExpiresAt *time.Time `json:"redeem_expires_at"`
}

// CardKeyBatchResult 生成结果。
type CardKeyBatchResult struct {
	BatchID   string    `json:"batch_id"`
	BatchName string    `json:"batch_name"`
	PlanID    uint64    `json:"plan_id"`
	PlanName  string    `json:"plan_name"`
	Count     int       `json:"count"`
	CreatedAt time.Time `json:"created_at"`
	// Codes 明文卡密：仅在生成时返回一次，之后列表默认脱敏
	Codes []string `json:"codes"`
}

// CardKeyRevealRequest 查看明文（必须带权限并写日志）。
type CardKeyRevealRequest struct {
	IDs []uint64 `json:"ids" binding:"required,min=1,max=200,dive,gte=1"`
}

// CardKeyVoidRequest 作废卡密。
type CardKeyVoidRequest struct {
	IDs    []uint64 `json:"ids" binding:"required,min=1,max=500,dive,gte=1"`
	Reason string   `json:"reason" binding:"required,min=2,max=255"`
}

// CardKeyExportRequest 导出 CSV 的条件（与列表筛选一致）。
type CardKeyExportRequest struct {
	PlanID  uint64 `json:"plan_id"`
	BatchID string `json:"batch_id"`
	Status  string `json:"status"`
	Keyword string `json:"keyword"`
	Limit   int    `json:"limit" binding:"omitempty,gte=1,lte=50000"`
	// Reveal 是否导出明文。默认脱敏导出，导出明文需要 card.export 权限并留日志。
	Reveal bool `json:"reveal"`
}

// CardKeyItem 卡密列表项。Code 只在有 card.reveal 权限且显式请求时才填。
type CardKeyItem struct {
	ID         uint64 `json:"id"`
	CodeMasked string `json:"code_masked"`
	Code       string `json:"code,omitempty"`

	PlanID   uint64 `json:"plan_id"`
	PlanName string `json:"plan_name"`

	BatchID   string `json:"batch_id"`
	BatchName string `json:"batch_name"`

	Status     string `json:"status"`
	StatusText string `json:"status_text"`

	RedeemExpiresAt *time.Time `json:"redeem_expires_at"`
	IssuedAt        *time.Time `json:"issued_at"`

	OrderID uint64 `json:"order_id"`
	OrderNo string `json:"order_no"`

	RedeemedBy      uint64     `json:"redeemed_by"`
	RedeemedAccount string     `json:"redeemed_account"`
	RedeemedAt      *time.Time `json:"redeemed_at"`

	EntitlementID        uint64     `json:"entitlement_id"`
	EntitlementStartedAt *time.Time `json:"entitlement_started_at"`
	EntitlementExpiresAt *time.Time `json:"entitlement_expires_at"`

	Note      string    `json:"note"`
	CreatedBy uint64    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`

	VoidedAt   *time.Time `json:"voided_at"`
	VoidReason string     `json:"void_reason"`

	PlanSnapshot model.PlanSnapshot `json:"plan_snapshot"`
}

// CardKeyBatch 批次汇总。
type CardKeyBatch struct {
	BatchID   string     `json:"batch_id"`
	BatchName string     `json:"batch_name"`
	PlanID    uint64     `json:"plan_id"`
	PlanName  string     `json:"plan_name"`
	Total     int64      `json:"total"`
	Unused    int64      `json:"unused"`
	Redeemed  int64      `json:"redeemed"`
	Voided    int64      `json:"voided"`
	Expired   int64      `json:"expired"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at"`
}

// CardKeyRedeemRequest 前台兑换卡密（需求 §6.5）。
type CardKeyRedeemRequest struct {
	Code string `json:"code" binding:"required,min=8,max=64"`
}

// CardKeyRedeemResult 兑换结果。
type CardKeyRedeemResult struct {
	PlanID        uint64         `json:"plan_id"`
	PlanName      string         `json:"plan_name"`
	PlanCode      string         `json:"plan_code"`
	EntitlementID uint64         `json:"entitlement_id"`
	StartsAt      time.Time      `json:"starts_at"`
	ExpiresAt     *time.Time     `json:"expires_at"`
	UsageLimit    *int           `json:"usage_limit"`
	Permissions   map[string]any `json:"permissions"`
	FeatureText   []string       `json:"feature_text"`
	Message       string         `json:"message"`
}

/* ================================================================== 订单 */

// OrderListQuery 订单列表查询。
type OrderListQuery struct {
	PageQuery
	OrderNo       string `form:"order_no"`
	Keyword       string `form:"keyword"` // 订单号 / 用户账号
	UserID        uint64 `form:"user_id"`
	PlanID        uint64 `form:"plan_id"`
	PaymentStatus string `form:"payment_status"`
	FulfillStatus string `form:"fulfillment_status"`
	PaymentMethod string `form:"payment_method"`
	CreatedFrom   string `form:"created_from"`
	CreatedTo     string `form:"created_to"`
}

// OrderCreateRequest 创建订单（前台）。
type OrderCreateRequest struct {
	PlanID   uint64 `json:"plan_id" binding:"required"`
	Quantity int    `json:"quantity" binding:"omitempty,gte=1,lte=100"`
	Note     string `json:"note" binding:"omitempty,max=255"`
}

// OrderSettleRequest 人工确认收款（需求 §6.6 / §7.3：二次确认 + 备注 + 记录管理员）。
type OrderSettleRequest struct {
	// AmountPaid 实付金额；不传则按应付金额全额确认
	AmountPaid    *float64 `json:"amount_paid" binding:"omitempty,gte=0,lte=1000000"`
	PaymentMethod string   `json:"payment_method" binding:"omitempty,oneof=manual wechat alipay"`
	TransactionID string   `json:"transaction_id" binding:"omitempty,max=64"`
	Note          string   `json:"note" binding:"required,min=2,max=255"`
	// IssueCards 确认收款后是否立刻发卡
	IssueCards bool `json:"issue_cards"`
}

// OrderIssueRequest 发放卡密（只针对已支付订单）。
type OrderIssueRequest struct {
	Note string `json:"note" binding:"required,min=2,max=255"`
}

// OrderCloseRequest 关闭 / 取消订单。
type OrderCloseRequest struct {
	Reason string `json:"reason" binding:"required,min=2,max=255"`
}

// OrderItem 订单列表 / 详情。
type OrderItem struct {
	ID      uint64 `json:"id"`
	OrderNo string `json:"order_no"`

	UserID       uint64 `json:"user_id"`
	UserAccount  string `json:"user_account"`
	UserNickname string `json:"user_nickname"`

	PlanID       uint64             `json:"plan_id"`
	PlanName     string             `json:"plan_name"`
	PlanSnapshot model.PlanSnapshot `json:"plan_snapshot"`

	Quantity   int     `json:"quantity"`
	AmountDue  float64 `json:"amount_due"`
	AmountPaid float64 `json:"amount_paid"`

	PaymentMethod        string `json:"payment_method"`
	PaymentMethodText    string `json:"payment_method_text"`
	PaymentStatus        string `json:"payment_status"`
	PaymentStatusText    string `json:"payment_status_text"`
	FulfillmentStatus    string `json:"fulfillment_status"`
	FulfillmentText      string `json:"fulfillment_status_text"`
	PaymentTransactionID string `json:"payment_transaction_id"`

	PaidAt      *time.Time `json:"paid_at"`
	ClosedAt    *time.Time `json:"closed_at"`
	RefundedAt  *time.Time `json:"refunded_at"`
	FulfilledAt *time.Time `json:"fulfilled_at"`

	PaidConfirmedBy uint64     `json:"paid_confirmed_by"`
	PaidConfirmName string     `json:"paid_confirm_name"`
	PaidConfirmedAt *time.Time `json:"paid_confirmed_at"`
	FulfilledBy     uint64     `json:"fulfilled_by"`
	FulfilledByName string     `json:"fulfilled_by_name"`

	CardIssuedCount int    `json:"card_issued_count"`
	Note            string `json:"note"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// OrderDetail 订单详情，含状态变化记录与关联卡密。
type OrderDetail struct {
	OrderItem
	Events []OrderEventItem `json:"events"`
	Cards  []CardKeyItem    `json:"cards"`
}

// OrderEventItem 订单状态变化记录。
type OrderEventItem struct {
	ID         uint64    `json:"id"`
	Action     string    `json:"action"`
	ActionText string    `json:"action_text"`
	FromState  string    `json:"from_state"`
	ToState    string    `json:"to_state"`
	Note       string    `json:"note"`
	AdminID    uint64    `json:"admin_id"`
	AdminName  string    `json:"admin_name"`
	CreatedAt  time.Time `json:"created_at"`
}

/* ================================================================== 权益 */

// EntitlementListQuery 权益 / 兑换记录查询（需求 §9）。
type EntitlementListQuery struct {
	PageQuery
	UserID     uint64 `form:"user_id"`
	PlanID     uint64 `form:"plan_id"`
	PlanCode   string `form:"plan_code"`
	SourceType string `form:"source_type"`
	Status     string `form:"status"`
	Keyword    string `form:"keyword"`
	From       string `form:"from"`
	To         string `form:"to"`
}

// EntitlementGrantRequest 管理员手动发放权益（需要有该权限并写日志）。
type EntitlementGrantRequest struct {
	UserID uint64 `json:"user_id" binding:"required"`
	PlanID uint64 `json:"plan_id" binding:"required"`
	Note   string `json:"note" binding:"required,min=2,max=255"`
	// OverrideValidDays 覆盖套餐默认时长（天）。0 = 用套餐配置。
	OverrideValidDays int `json:"override_valid_days" binding:"omitempty,gte=0,lte=3650"`
}

// EntitlementRevokeRequest 撤销权益。
type EntitlementRevokeRequest struct {
	Reason string `json:"reason" binding:"required,min=2,max=255"`
}

// EntitlementItem 权益 / 兑换记录返回项。
type EntitlementItem struct {
	ID           uint64 `json:"id"`
	UserID       uint64 `json:"user_id"`
	UserAccount  string `json:"user_account"`
	UserNickname string `json:"user_nickname"`

	SourceType     string `json:"source_type"`
	SourceTypeText string `json:"source_type_text"`
	SourceID       uint64 `json:"source_id"`
	SourceNo       string `json:"source_no"`

	PlanID       uint64             `json:"plan_id"`
	PlanName     string             `json:"plan_name"`
	PlanCode     string             `json:"plan_code"`
	PlanSnapshot model.PlanSnapshot `json:"plan_snapshot"`

	StartsAt  time.Time  `json:"starts_at"`
	ExpiresAt *time.Time `json:"expires_at"`

	UsageLimit *int `json:"usage_limit"`
	UsageUsed  int  `json:"usage_used"`
	Remaining  int  `json:"remaining"`

	Status     string `json:"status"`
	StatusText string `json:"status_text"`
	// EffectiveStatus 按当前时间算出来的真实状态（active/expired）
	EffectiveStatus string `json:"effective_status"`

	Note      string    `json:"note"`
	GrantedBy uint64    `json:"granted_by"`
	CreatedAt time.Time `json:"created_at"`

	RevokedAt  *time.Time `json:"revoked_at"`
	RevokeNote string     `json:"revoke_note"`
}

/* ================================================================== 用户 */

// AdminUserListQuery 用户列表查询（需求 §9）。
type AdminUserListQuery struct {
	PageQuery
	Keyword string `form:"keyword"`
	Status  *int8  `form:"status"`
	HasPro  *bool  `form:"has_pro"`
	From    string `form:"from"`
	To      string `form:"to"`
}

// AdminUserItem 用户列表项。不返回密码哈希，也不返回不必要的敏感信息。
type AdminUserItem struct {
	ID          uint64     `json:"id"`
	Username    string     `json:"username"`
	Nickname    string     `json:"nickname"`
	Email       string     `json:"email"`
	Phone       string     `json:"phone"`
	Status      int8       `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	LastLoginAt *time.Time `json:"last_login_at"`

	OrderCount    int64   `json:"order_count"`
	PaidAmount    float64 `json:"paid_amount"`
	RedeemedCount int64   `json:"redeemed_count"`

	PlanCode      string     `json:"plan_code"`
	PlanName      string     `json:"plan_name"`
	IsPro         bool       `json:"is_pro"`
	ExpireAt      *time.Time `json:"expire_at"`
	CreditBalance int        `json:"credit_balance"`
}
