package model

import "encoding/json"

// Project 作品存档。对应前端 useStudio.js 的 projects（localStorage 的 douzao-projects-v2）。
//
// variants 拆成独立的 ProjectVariant 表：单个方案里的 pattern 数据很大
// （116×116 = 13456 格），列表页只取主表即可，不必把图纸全读出来。
type Project struct {
	Base
	UserID       uint64 `gorm:"index;not null" json:"user_id"`
	Name         string `gorm:"size:128;not null" json:"name"`
	BoardCols    int    `gorm:"not null;default:1" json:"board_cols"`
	BoardRows    int    `gorm:"not null;default:1" json:"board_rows"`
	BrandID      string `gorm:"size:32;not null" json:"brand_id"`
	TargetColors int    `gorm:"not null;default:0" json:"target_colors"`
	// ActiveVariantKey 当前选中的方案，对应前端 activeKey
	ActiveVariantKey string `gorm:"size:32" json:"active_variant_key"`
	// Thumbnail 缩略图（data URL 或对象存储地址）
	Thumbnail string `gorm:"type:text" json:"thumbnail"`
	// BuildProgress Build Mode 的拼制进度，结构由前端决定，用 jsonb 存
	BuildProgress json.RawMessage `gorm:"type:jsonb" json:"build_progress,omitempty"`

	Variants []ProjectVariant `gorm:"foreignKey:ProjectID" json:"variants,omitempty"`
}

// ProjectVariant 作品的单个生成方案（高还原 / 好拼版 / 艺术版）。
type ProjectVariant struct {
	Base
	ProjectID uint64 `gorm:"index;not null" json:"project_id"`
	// Key 方案标识：detail / buildable / artistic
	Key         string `gorm:"size:32;not null" json:"key"`
	Label       string `gorm:"size:64" json:"label"`
	Tagline     string `gorm:"size:255" json:"tagline"`
	Recommended bool   `gorm:"not null;default:false" json:"recommended"`
	// Stats 方案评分（还原度 / 可拼性 / 豆数 / 色数等）
	Stats json.RawMessage `gorm:"type:jsonb" json:"stats,omitempty"`
	// Pattern 图纸完整数据（前端 toPatternJSON 的输出）
	Pattern json.RawMessage `gorm:"type:jsonb" json:"pattern,omitempty"`
}
