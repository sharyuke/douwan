package dto

import (
	"time"
)

/* ================================================================== 素材分类 */

// CategoryListQuery 分类列表查询。
type CategoryListQuery struct {
	PageQuery
	Keyword string `form:"keyword"`
	Status  *int8  `form:"status"`
}

// CategoryRequest 新建 / 编辑分类（需求 §8.5）。
type CategoryRequest struct {
	Name        string `json:"name" binding:"required,max=64"`
	Slug        string `json:"slug" binding:"omitempty,max=64"`
	Description string `json:"description" binding:"omitempty,max=512"`
	CoverURL    string `json:"cover_url" binding:"omitempty,max=512"`
	SortOrder   int    `json:"sort_order" binding:"gte=-100000,lte=100000"`
	Status      *int8  `json:"status" binding:"omitempty,oneof=0 1"`
}

// CategoryItem 分类返回项。
type CategoryItem struct {
	ID           uint64    `json:"id"`
	Slug         string    `json:"slug"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	CoverURL     string    `json:"cover_url"`
	SortOrder    int       `json:"sort_order"`
	Status       int8      `json:"status"`
	StatusText   string    `json:"status_text"`
	AssetCount   int64     `json:"asset_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	CoverPreview string    `json:"cover_preview"`
}

/* ================================================================== 素材 */

// AssetListQuery 素材列表查询（需求 §8.2）。
type AssetListQuery struct {
	PageQuery
	Keyword     string `form:"keyword"`
	CategoryID  uint64 `form:"category_id"`
	Tag         string `form:"tag"`
	Status      string `form:"status"`
	Featured    *bool  `form:"featured"`
	Tier        string `form:"tier"`
	CreatedFrom string `form:"created_from"`
	CreatedTo   string `form:"created_to"`
	// Sort 排序字段：sort_order / created_at / updated_at
	Sort  string `form:"sort"`
	Order string `form:"order"`
}

// AssetUpdateRequest 编辑素材。图片本身通过上传接口替换，
// 这里只改文本与状态字段（需求 §8.3「支持编辑素材名称、分类、标签、封面、描述、排序、推荐状态」）。
type AssetUpdateRequest struct {
	Title        *string   `json:"title" binding:"omitempty,max=128"`
	CategoryID   *uint64   `json:"category_id"`
	Tags         *[]string `json:"tags" binding:"omitempty,max=20,dive,max=32"`
	Description  *string   `json:"description" binding:"omitempty,max=1000"`
	ThumbnailURL *string   `json:"thumbnail_url" binding:"omitempty,max=512"`
	IsFeatured   *bool     `json:"is_featured"`
	SortOrder    *int      `json:"sort_order" binding:"omitempty,gte=-100000,lte=100000"`
	Status       *string   `json:"status" binding:"omitempty,oneof=draft published archived"`
	Tier         *string   `json:"tier" binding:"omitempty,oneof=free pro"`
	SourceNote   *string   `json:"source_note" binding:"omitempty,max=255"`
	RightsNote   *string   `json:"rights_note" binding:"omitempty,max=255"`
	InnerNote    *string   `json:"inner_note" binding:"omitempty,max=255"`
	Slug         *string   `json:"slug" binding:"omitempty,max=64"`
	SlugKeyword  *string   `json:"slug_keyword" binding:"omitempty,max=32"`
}

// AssetStatusRequest 上下架 / 归档。
type AssetStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=draft published archived"`
	Reason string `json:"reason" binding:"omitempty,max=255"`
}

// AssetSortRequest 批量调整排序与推荐（需求 §8.2 支持排序）。
type AssetSortRequest struct {
	Items []AssetSortItem `json:"items" binding:"required,min=1,max=200,dive"`
}

// AssetSortItem 单个素材的排序 / 推荐值。
type AssetSortItem struct {
	ID         uint64 `json:"id" binding:"required"`
	SortOrder  *int   `json:"sort_order" binding:"omitempty,gte=-100000,lte=100000"`
	IsFeatured *bool  `json:"is_featured"`
}

// AssetItem 素材列表 / 详情返回项。
type AssetItem struct {
	ID    uint64 `json:"id"`
	Slug  string `json:"slug"`
	Title string `json:"title"`

	ImageURL     string `json:"image_url"`
	ThumbnailURL string `json:"thumbnail_url"`
	ImageWidth   int    `json:"image_width"`
	ImageHeight  int    `json:"image_height"`
	FileSize     int64  `json:"file_size"`
	FileSizeText string `json:"file_size_text"`
	MimeType     string `json:"mime_type"`
	StoredName   string `json:"stored_name"`

	CategoryID   uint64 `json:"category_id"`
	CategoryName string `json:"category_name"`

	Tags        []string `json:"tags"`
	Description string   `json:"description"`

	IsFeatured bool   `json:"is_featured"`
	SortOrder  int    `json:"sort_order"`
	Status     string `json:"status"`
	StatusText string `json:"status_text"`
	Tier       string `json:"tier"`

	SourceNote string `json:"source_note"`
	RightsNote string `json:"rights_note"`
	InnerNote  string `json:"inner_note"`

	CreatedBy      uint64     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	PublishedAt    *time.Time `json:"published_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	ArchivedReason string     `json:"archived_reason"`
}

// AssetUploadForm 是上传素材时的表单字段（图片走 multipart 文件部分）。
//
// 单独定义一个结构体而不是复用 AssetUpdateRequest：上传接口用的是
// multipart/form-data，所有值都是字符串，绑定方式与 JSON 完全不同。
type AssetUploadForm struct {
	Title       string
	Slug        string
	CategoryID  uint64
	Tags        []string
	Description string
	IsFeatured  bool
	SortOrder   int
	Status      string
	Tier        string
	SourceNote  string
	RightsNote  string
	InnerNote   string
}

// AssetUploadResult 上传结果。批量上传时返回每张的结果，失败的带上原因，
// 前端据此保留已填文本方便重试（需求 §8.3）。
type AssetUploadResult struct {
	Total   int                `json:"total"`
	Success int                `json:"success"`
	Failed  int                `json:"failed"`
	Items   []AssetItem        `json:"items"`
	Errors  []AssetUploadError `json:"errors"`
}

// AssetUploadError 单张上传失败原因。
type AssetUploadError struct {
	Filename string `json:"filename"`
	Reason   string `json:"reason"`
}

/* ================================================================== 数据概览 */

// OverviewResult 数据概览（需求 §4）。
type OverviewResult struct {
	Cards       OverviewCards   `json:"cards"`
	Recent      OverviewRecent  `json:"recent"`
	Payment     OverviewPayment `json:"payment"`
	Assets      OverviewAssets  `json:"assets"`
	GeneratedAt time.Time       `json:"generated_at"`
}

// OverviewCards 概览数字卡片。
type OverviewCards struct {
	TodayOrderCount   int64   `json:"today_order_count"`
	TodayPaidAmount   float64 `json:"today_paid_amount"`
	TotalPaidAmount   float64 `json:"total_paid_amount"`
	TotalRefundAmount float64 `json:"total_refund_amount"`
	CardGenerated     int64   `json:"card_generated"`
	CardUnused        int64   `json:"card_unused"`
	CardRedeemed      int64   `json:"card_redeemed"`
	CardVoided        int64   `json:"card_voided"`
	AssetPublished    int64   `json:"asset_published"`
	AssetDraft        int64   `json:"asset_draft"`
	UserTotal         int64   `json:"user_total"`
	PlanPublished     int64   `json:"plan_published"`
	TodayRedeemCount  int64   `json:"today_redeem_count"`
	TodayNewUserCount int64   `json:"today_new_user_count"`
}

// OverviewPayment 支付接入状态。需求 §4 明确要求：
// 没有真实支付时不能伪造收入，要显式说明「支付暂未接入」。
type OverviewPayment struct {
	ChannelConfigured bool    `json:"channel_configured"`
	ChannelName       string  `json:"channel_name"`
	ManualOnly        bool    `json:"manual_only"`
	Notice            string  `json:"notice"`
	NetPaidAmount     float64 `json:"net_paid_amount"`
}

// OverviewAssets 素材统计。
type OverviewAssets struct {
	CategoryTotal int64 `json:"category_total"`
	FeaturedTotal int64 `json:"featured_total"`
}

// OverviewRecent 最近记录。
type OverviewRecent struct {
	Orders      []OrderItem       `json:"orders"`
	Redemptions []EntitlementItem `json:"redemptions"`
	Assets      []AssetItem       `json:"assets"`
}

/* ================================================================== 前台公开接口 */

// PublicPlanItem 前台可购买的套餐。只返回已上架套餐，
// 价格与权益来自数据库，前端不写死任何定价（需求 §5.3 / §13.9）。
type PublicPlanItem struct {
	ID        uint64 `json:"id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	ShortDesc string `json:"short_desc"`
	FrontDesc string `json:"front_desc"`
	Tagline   string `json:"tagline"`
	Tag       string `json:"tag"`

	Price         float64  `json:"price"`
	OriginalPrice *float64 `json:"original_price"`

	ValidityType  string `json:"validity_type"`
	ValidityValue int    `json:"validity_value"`
	ValidityText  string `json:"validity_text"`

	FeatureText         []string       `json:"feature_text"`
	FeaturePermissions  map[string]any `json:"feature_permissions"`
	BenefitType         string         `json:"benefit_type"`
	UsageLimit          int            `json:"usage_limit"`
	AllowRepeatPurchase bool           `json:"allow_repeat_purchase"`
	SortOrder           int            `json:"sort_order"`
}

// PublicAssetItem 前台素材库条目。只返回已发布素材（需求 §8.6）。
type PublicAssetItem struct {
	ID           uint64     `json:"id"`
	Slug         string     `json:"slug"`
	Title        string     `json:"title"`
	ImageURL     string     `json:"image_url"`
	ThumbnailURL string     `json:"thumbnail_url"`
	CategoryID   uint64     `json:"category_id"`
	CategoryName string     `json:"category_name"`
	Tags         []string   `json:"tags"`
	Description  string     `json:"description"`
	IsFeatured   bool       `json:"is_featured"`
	SortOrder    int        `json:"sort_order"`
	Tier         string     `json:"tier"`
	ImageWidth   int        `json:"image_width"`
	ImageHeight  int        `json:"image_height"`
	PublishedAt  *time.Time `json:"published_at"`
}

// PublicCategoryItem 前台分类条目。
type PublicCategoryItem struct {
	ID         uint64 `json:"id"`
	Slug       string `json:"slug"`
	Name       string `json:"name"`
	CoverURL   string `json:"cover_url"`
	SortOrder  int    `json:"sort_order"`
	AssetCount int64  `json:"asset_count"`
}

// PublicAssetQuery 前台素材查询。
type PublicAssetQuery struct {
	PageQuery
	Keyword      string `form:"keyword"`
	CategoryID   uint64 `form:"category_id"`
	CategorySlug string `form:"category_slug"`
	Tag          string `form:"tag"`
	Featured     *bool  `form:"featured"`
	Tier         string `form:"tier"`
	Sort         string `form:"sort"`
}

// PublicSettings 前台可以拿到的公开设置。
type PublicSettings struct {
	SiteName         string `json:"site_name"`
	SupportURL       string `json:"support_url"`
	SupportText      string `json:"support_text"`
	CardRedeemNotice string `json:"card_redeem_notice"`
	MaxUploadMB      int    `json:"max_upload_mb"`
	PaymentReady     bool   `json:"payment_ready"`
	PaymentNotice    string `json:"payment_notice"`
}

// PlanPreviewResult 套餐前台预览（需求 §5.3「提供预览入口」）。
type PlanPreviewResult struct {
	Plan        PublicPlanItem `json:"plan"`
	Visible     bool           `json:"visible"`
	VisibleNote string         `json:"visible_note"`
}
