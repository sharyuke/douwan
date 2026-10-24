package model

import (
	"strconv"
	"time"
)

// 套餐状态。
const (
	PlanStatusDraft     = "draft"     // 草稿：前台不可见，不能下单
	PlanStatusPublished = "published" // 已上架：前台可见可购买
	PlanStatusArchived  = "archived"  // 已下架：前台不可见，历史订单/卡密不受影响
)

// 权益类型。需求 §5.2 要求权益类型可配置，这里先给出当前系统真实支持的几种。
const (
	BenefitUnlimited = "unlimited" // 不限量：到期前该套餐包含的功能全开
	BenefitQuota     = "quota"     // 次数 / 额度：usage_limit 次功能调用
	BenefitCount     = "count"     // 图纸张数：可解锁 usage_limit 张图纸
)

// 权益时长类型。需求 §5.2：不设置 / 按小时 / 按天。
// 单张图纸这类「按数量」权益可以留空，不设时长。
const (
	ValidityNone  = "none"
	ValidityHour  = "hour"
	ValidityDay   = "day"
	ValidityMonth = "month"
)

// 生效起算方式（需求 §5.4）。本期固定为兑换时起算，但落库保存，
// 将来要支持「付款时起算」不用改表结构。
const (
	StartOnRedeem = "redeem"
	StartOnPaid   = "paid"
	StartOnGrant  = "grant"
)

// BenefitPermissions 是套餐包含的功能权限矩阵。
//
// 键必须是当前前台真实存在的权益点（对齐 pindoudou/src/composables/useMembership.js
// 的 ENTITLEMENTS）。值可以是 bool，也可以是数字（次数 / 上限），
// 例如 "generate.variants": 3、"canvas.cells": 1000。
type BenefitPermissions map[string]any

// BenefitConfig 是套餐的权益配置，整体以 JSON 存在一个字段里。
//
// 之所以不做成十张关联表：权益形态还没定（需求 §18），
// 拆表会把「还没想清楚的业务」固化成结构，改一次就要写迁移。
type BenefitConfig struct {
	// Kind 权益类型：unlimited / quota / count
	Kind string `json:"kind"`
	// UsageLimit 额度：quota / count 时必填，unlimited 时忽略
	UsageLimit int `json:"usage_limit"`
	// Permissions 功能权限矩阵
	Permissions BenefitPermissions `json:"permissions"`
	// ValidityType / ValidityValue 权益有效期，none 表示不设时长
	ValidityType  string `json:"validity_type"`
	ValidityValue int    `json:"validity_value"`
	// StartOn 起算方式：兑换 / 付款 / 发放
	StartOn string `json:"start_on"`
	// 额度是否允许叠加（重复购买时累加而不是覆盖）
	Stackable bool `json:"stackable"`
}

// PlanSnapshot 是写进订单与卡密的权益快照。
// 订单创建 / 卡密生成那一刻拍照，之后改套餐不影响历史记录（需求 §13.2）。
type PlanSnapshot struct {
	PlanID      uint64             `json:"plan_id"`
	Code        string             `json:"code"`
	Name        string             `json:"name"`
	Amount      float64            `json:"amount"`
	Benefit     BenefitConfig      `json:"benefit"`
	FeatureText []string           `json:"feature_text"`
	Permissions BenefitPermissions `json:"permissions"`
	ValidDays   int                `json:"valid_days"`
}

// Snapshot 从套餐生成快照。
func (p *Plan) Snapshot() PlanSnapshot {
	return PlanSnapshot{
		PlanID:      p.ID,
		Code:        p.Code,
		Name:        p.Name,
		Amount:      p.Price,
		Benefit:     p.BenefitConfig,
		FeatureText: p.FeatureText,
		Permissions: p.FeaturePermissions,
		ValidDays:   p.validDays(),
	}
}

// ValidDuration 按权益配置算出有效期时长。none 返回 0 表示不设时长。
func (p *Plan) ValidDuration() time.Duration { return p.BenefitConfig.Duration() }

func (p *Plan) validDays() int {
	d := p.BenefitConfig.Duration()
	if d <= 0 {
		return 0
	}
	return int(d.Hours() / 24)
}

// Duration 把权益有效期换算成 time.Duration，none / 非法值返回 0。
func (b BenefitConfig) Duration() time.Duration {
	switch b.ValidityType {
	case ValidityHour:
		return time.Duration(b.ValidityValue) * time.Hour
	case ValidityDay:
		return time.Duration(b.ValidityValue) * 24 * time.Hour
	case ValidityMonth:
		return time.Duration(b.ValidityValue) * 30 * 24 * time.Hour
	default:
		return 0
	}
}

// Plan 套餐 / 权益方案。
//
// 价格与权益全部存在数据库里，代码里没有任何写死的定价（需求 §0.5 / §13.1）。
type Plan struct {
	Base
	// Code 是稳定标识（英文短名），卡密与前台兑换靠它绑定权益判定，
	// 改名不会影响已发出的卡密。
	Code string `gorm:"size:32;uniqueIndex;not null" json:"code"`
	Name string `gorm:"size:64;not null" json:"name"`
	// ShortDesc 套餐短描述；FrontDesc 前台展示说明
	ShortDesc string `gorm:"size:128" json:"short_desc"`
	FrontDesc string `gorm:"size:512" json:"front_desc"`
	// Tagline 前台卡片上的一句话
	Tagline string `gorm:"size:128" json:"tagline"`
	// Tag 前台角标，例如「最受欢迎」
	Tag string `gorm:"size:32" json:"tag"`

	Price         float64  `gorm:"type:numeric(10,2);not null;default:0" json:"price"`
	OriginalPrice *float64 `gorm:"type:numeric(10,2)" json:"original_price"`

	BenefitType   string        `gorm:"size:32;not null;default:'unlimited'" json:"benefit_type"`
	BenefitConfig BenefitConfig `gorm:"serializer:json;type:jsonb" json:"benefit_config"`

	// ValidityType / ValidityValue 冗余存一份，方便列表直接筛选与展示
	ValidityType  string `gorm:"size:16;not null;default:'none'" json:"validity_type"`
	ValidityValue int    `gorm:"not null;default:0" json:"validity_value"`

	FeaturePermissions BenefitPermissions `gorm:"serializer:json;type:jsonb" json:"feature_permissions"`
	// FeatureText 前台权益清单文案（逐行展示，管理员自己写）
	FeatureText []string `gorm:"serializer:json;type:jsonb" json:"feature_text"`

	AllowRepeatPurchase bool `gorm:"not null;default:false" json:"allow_repeat_purchase"`
	// CardQuantity 一份订单发放多少张卡密
	CardQuantity int `gorm:"not null;default:1" json:"card_quantity"`
	// BatchSize 默认生成卡密的批量张数（仅作默认值）
	BatchSize int `gorm:"not null;default:1" json:"batch_size"`

	SortOrder int    `gorm:"not null;default:0;index" json:"sort_order"`
	Status    string `gorm:"size:16;not null;default:'draft';index" json:"status"`

	CreatedBy   uint64     `gorm:"index" json:"created_by"`
	UpdatedBy   uint64     `json:"updated_by"`
	DeletedBy   uint64     `json:"-"`
	PublishedAt *time.Time `json:"published_at"`
	ArchivedAt  *time.Time `json:"archived_at"`
	// DeleteNote 删除原因（软删除时必填，便于追溯）
	DeleteNote string `gorm:"size:255" json:"delete_note"`
}

// IsPublished 是否已上架。上架是前台可购买的唯一条件。
func (p *Plan) IsPublished() bool { return p.Status == PlanStatusPublished }

// StatusLabel 套餐状态中文名。
func PlanStatusLabel(status string) string {
	switch status {
	case PlanStatusDraft:
		return "草稿"
	case PlanStatusPublished:
		return "已上架"
	case PlanStatusArchived:
		return "已下架"
	default:
		return status
	}
}

// ValidityLabel 权益有效期文案。
func ValidityLabel(t string, v int) string {
	switch t {
	case ValidityHour:
		return strconv.Itoa(v) + " 小时"
	case ValidityDay:
		return strconv.Itoa(v) + " 天"
	case ValidityMonth:
		return strconv.Itoa(v) + " 个月"
	default:
		return "不限时长"
	}
}
