package model

import "time"

// 设置分组（需求 §10）。
const (
	SettingGroupBasic   = "basic"   // 网站名称、客服入口
	SettingGroupUpload  = "upload"  // 上传限制
	SettingGroupCard    = "card"    // 卡密兑换规则说明
	SettingGroupPayment = "payment" // 支付渠道配置
	SettingGroupAI      = "ai"      // AI 用量与成本告警
)

// 素材状态（需求 §8.2）。只有 published 会出现在前台素材库。
const (
	AssetStatusDraft     = "draft"
	AssetStatusPublished = "published"
	AssetStatusArchived  = "archived"
)

// 分类状态。
const (
	CategoryStatusDisabled int8 = 0
	CategoryStatusEnabled  int8 = 1
)

// LibraryAsset 是「后台自己上传维护的素材库」条目。
//
// 与已有 model.Asset 的区别（两个都保留，互不影响）：
//   - model.Asset 是前端 src/data/assets.js 那批内置矢量素材（字段是 svg / cols / tier），
//     由脚本导入，未来给 cmd/seed 用；
//   - LibraryAsset 是管理员上传的真实图片素材（原图 + 缩略图 + 分类 + 标签），
//     对应需求 §8「素材库管理操作台」。
//
// 之所以不改造 model.Asset：它的 svg 字段是 not null 的，而上传的位图素材
// 没有 SVG，硬塞进去要么改列约束（影响已有数据），要么写一个假的 SVG 占位，
// 两条路都比新建一张表更容易出问题。
type LibraryAsset struct {
	Base
	// Slug 稳定标识，前台详情页 /library/:slug 用它。上传时按标题生成，可手改。
	Slug  string `gorm:"size:64;uniqueIndex;not null" json:"slug"`
	Title string `gorm:"size:128;not null;index" json:"title"`

	// ImageURL 原图；ThumbnailURL 缩略图（上传时自动生成，失败则回落原图）
	ImageURL     string `gorm:"size:512;not null" json:"image_url"`
	ThumbnailURL string `gorm:"size:512" json:"thumbnail_url"`
	// 原图与缩略图的可追踪信息，便于排查「前台为什么显示不出来」
	ImageWidth  int    `gorm:"not null;default:0" json:"image_width"`
	ImageHeight int    `gorm:"not null;default:0" json:"image_height"`
	FileSize    int64  `gorm:"not null;default:0" json:"file_size"`
	MimeType    string `gorm:"size:64" json:"mime_type"`
	StoredName  string `gorm:"size:128" json:"stored_name"` // 服务端重命名后的文件名

	CategoryID   uint64 `gorm:"index" json:"category_id"`
	CategoryName string `gorm:"size:64" json:"category_name"` // 冗余，列表直接展示

	Tags []string `gorm:"serializer:json;type:jsonb" json:"tags"`

	Description string `gorm:"size:1000" json:"description"`

	IsFeatured bool `gorm:"not null;default:false;index" json:"is_featured"`
	// SortOrder 排序值，数值越大越靠前（前后台统一按这个规则）
	SortOrder int `gorm:"not null;default:0;index" json:"sort_order"`

	Status string `gorm:"size:16;not null;default:'draft';index" json:"status"`

	// 版权与来源记录（需求 §8.7），全部可选
	SourceNote string `gorm:"size:255" json:"source_note"`
	RightsNote string `gorm:"size:255" json:"rights_note"`
	InnerNote  string `gorm:"size:255" json:"inner_note"`

	// 会员分层：free 全部用户可用，pro 需要对应权益
	Tier string `gorm:"size:16;not null;default:'free';index" json:"tier"`

	CreatedBy      uint64     `gorm:"index" json:"created_by"`
	UpdatedBy      uint64     `gorm:"index" json:"updated_by"`
	PublishedAt    *time.Time `json:"published_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	ArchivedReason string     `gorm:"size:255" json:"archived_reason"`
	// DeletedNote 归档 / 删除原因
	DeletedNote string `gorm:"size:255" json:"deleted_note"`
}

// IsPublished 是否已发布。
func (a *LibraryAsset) IsPublished() bool { return a.Status == AssetStatusPublished }

// AssetStatusLabel 素材状态中文名。
func AssetStatusLabel(s string) string {
	switch s {
	case AssetStatusDraft:
		return "草稿"
	case AssetStatusPublished:
		return "已发布"
	case AssetStatusArchived:
		return "已下架"
	default:
		return s
	}
}

// LibraryCategory 素材分类（需求 §8.5）。
type LibraryCategory struct {
	Base
	Slug        string `gorm:"size:64;uniqueIndex;not null" json:"slug"`
	Name        string `gorm:"size:64;not null" json:"name"`
	Description string `gorm:"size:512" json:"description"`
	CoverURL    string `gorm:"size:512" json:"cover_url"`
	SortOrder   int    `gorm:"not null;default:0;index" json:"sort_order"`
	Status      int8   `gorm:"not null;default:1;index" json:"status"`
	CreatedBy   uint64 `gorm:"index" json:"created_by"`
	UpdatedBy   uint64 `gorm:"index" json:"updated_by"`
}

// IsEnabled 分类是否启用。
func (c *LibraryCategory) IsEnabled() bool { return c.Status == CategoryStatusEnabled }

// CategoryStatusLabel 分类状态中文名。
func CategoryStatusLabel(s int8) string {
	if s == CategoryStatusEnabled {
		return "已启用"
	}
	return "已停用"
}

// OperationLog 后台关键操作日志（需求 §11）。
//
// 明确不记录：明文密码、API Key、支付密钥、完整卡密。
// 卡密相关操作只记脱敏串。
type OperationLog struct {
	Base
	AdminID   uint64 `gorm:"index" json:"admin_id"`
	AdminName string `gorm:"size:64;index" json:"admin_name"`
	AdminRole string `gorm:"size:32" json:"admin_role"`

	Action     string `gorm:"size:64;index;not null" json:"action"`
	ActionText string `gorm:"size:64" json:"action_text"`
	TargetType string `gorm:"size:32;index" json:"target_type"`
	TargetID   string `gorm:"size:64;index" json:"target_id"`
	TargetName string `gorm:"size:128" json:"target_name"`

	// Result: success / fail
	Result  string `gorm:"size:16;index;not null;default:'success'" json:"result"`
	Details string `gorm:"size:1000" json:"details"`

	IP        string `gorm:"size:64" json:"ip"`
	UserAgent string `gorm:"size:255" json:"user_agent"`
	RequestID string `gorm:"size:64" json:"request_id"`
}

// 日志结果。
const (
	LogResultSuccess = "success"
	LogResultFail    = "fail"
)

// LogResultLabel 结果中文名。
func LogResultLabel(s string) string {
	if s == LogResultFail {
		return "失败"
	}
	return "成功"
}

// Setting 系统设置（需求 §10）。
//
// 用键值表而不是固定列表：需求 §10 明确说套餐定价、AI 成本这些还没定，
// 键值表让「先预留、后配置」不需要改表结构。
type Setting struct {
	Base
	Key   string `gorm:"size:64;uniqueIndex;not null" json:"key"`
	Value string `gorm:"type:text" json:"value"`
	Group string `gorm:"size:32;index" json:"group"`
	// Label 后台界面显示名；Type 控件类型：text / number / switch / textarea / secret
	Label string `gorm:"size:64" json:"label"`
	Type  string `gorm:"size:16" json:"type"`
	// Public 为 true 时该键可以出现在前台公开接口里（密钥类必须为 false）
	Public bool `gorm:"not null;default:false;index" json:"public"`
	// Secret 为 true 时接口只返回脱敏值，永不返回明文
	Secret      bool   `gorm:"not null;default:false" json:"secret"`
	Description string `gorm:"size:255" json:"description"`
	UpdatedBy   uint64 `gorm:"index" json:"updated_by"`
}

// SettingGroupLabel 设置分组中文名。
func SettingGroupLabel(g string) string {
	switch g {
	case SettingGroupBasic:
		return "基础信息"
	case SettingGroupUpload:
		return "上传与存储"
	case SettingGroupCard:
		return "卡密与兑换"
	case SettingGroupPayment:
		return "支付配置"
	case SettingGroupAI:
		return "AI 与成本"
	default:
		return g
	}
}
