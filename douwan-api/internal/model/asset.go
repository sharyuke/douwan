package model

import "time"

// 素材分层。与前端 assets.js 的 tier 字段一致。
const (
	AssetTierFree = "free"
	AssetTierPro  = "pro"
)

// Asset 素材库条目。对应前端 src/data/assets.js 的 ASSETS。
type Asset struct {
	Base
	// Slug 稳定标识，沿用前端生成的 djb2 短 id，保证重新导入不会打乱收藏
	Slug string `gorm:"size:32;uniqueIndex;not null" json:"slug"`
	Name string `gorm:"size:64;not null" json:"name"`
	// Category 一级分类，对应前端 cat，如「动物」「食物」
	Category string `gorm:"size:32;index" json:"category"`
	// Cols 标签，对应前端 cols 数组
	Cols []string `gorm:"serializer:json;type:jsonb" json:"cols"`
	SVG  string   `gorm:"type:text;not null" json:"svg"`
	Tier string   `gorm:"size:16;index;not null;default:'free'" json:"tier"`
	// Featured / Hot 对应前端 feat 与 hot（0~100 热度分）
	Featured bool `gorm:"not null;default:false" json:"featured"`
	Hot      int  `gorm:"not null;default:0" json:"hot"`
	IsNew    bool `gorm:"not null;default:false" json:"is_new"`
	// 以下统计值由生成脚本按统一规则推导，这里只存结果
	Boards     int    `gorm:"not null;default:1" json:"boards"`
	Grid       int    `gorm:"not null;default:29" json:"grid"`
	Colors     int    `gorm:"not null;default:0" json:"colors"`
	Beads      int    `gorm:"not null;default:0" json:"beads"`
	Minutes    int    `gorm:"not null;default:0" json:"minutes"`
	Difficulty string `gorm:"size:16" json:"difficulty"`
	Duration   string `gorm:"size:32" json:"duration"`
	FeatBg     string `gorm:"size:255" json:"feat_bg"`

	PublishedAt *time.Time `json:"published_at"`
}

// AssetFavorite 素材收藏。对应前端 useAssets.js 的 favorites（收藏的素材 id 列表）。
type AssetFavorite struct {
	Base
	UserID  uint64 `gorm:"uniqueIndex:uk_fav_user_asset;not null" json:"user_id"`
	AssetID uint64 `gorm:"uniqueIndex:uk_fav_user_asset;not null" json:"asset_id"`
}

// PaletteBrand 色板品牌。对应前端 src/data/palette.js 的 PALETTES 条目。
type PaletteBrand struct {
	Base
	// BrandID 前端使用的品牌标识：mard221 / artkal-c197 / hama / perler
	BrandID    string `gorm:"size:32;uniqueIndex;not null" json:"brand_id"`
	Name       string `gorm:"size:64;not null" json:"name"`
	Desc       string `gorm:"size:128" json:"desc"`
	Note       string `gorm:"size:512" json:"note"`
	ColorCount int    `gorm:"not null;default:0" json:"color_count"`
	// DefaultBrand 是否为默认色板（前端 DEFAULT_BRAND_ID 指向漫德 MARD）
	DefaultBrand bool `gorm:"not null;default:false" json:"default_brand"`
	Sort         int  `gorm:"not null;default:0" json:"sort"`
}

// PaletteColor 色板里的一个色号。
//
// Lab 三个分量在生成时就落库：配色算法（CIEDE2000 找最近色号）要用，
// 存下来可以避免每次查询都重算一遍 sRGB→Lab 转换。
type PaletteColor struct {
	Base
	BrandID string  `gorm:"size:32;uniqueIndex:uk_palette_brand_code;not null" json:"brand_id"`
	Code    string  `gorm:"size:16;uniqueIndex:uk_palette_brand_code;not null" json:"code"`
	Name    string  `gorm:"size:64" json:"name"`
	Hex     string  `gorm:"size:9;not null" json:"hex"`
	R       int     `gorm:"not null;default:0" json:"r"`
	G       int     `gorm:"not null;default:0" json:"g"`
	B       int     `gorm:"not null;default:0" json:"b"`
	LabL    float64 `gorm:"not null;default:0" json:"lab_l"`
	LabA    float64 `gorm:"not null;default:0" json:"lab_a"`
	LabB    float64 `gorm:"not null;default:0" json:"lab_b"`
	Sort    int     `gorm:"not null;default:0" json:"sort"`
}
