package model

// InventoryItem 用户库存的一行：某个色号有多少颗。
// 对应前端 useInventory.js 的 { [colorId]: quantity }，这里一行一个色号，
// 便于按色号查询、按品牌统计，也避免整份 JSON 反复读写。
type InventoryItem struct {
	Base
	UserID uint64 `gorm:"uniqueIndex:uk_inventory_user_color;not null" json:"user_id"`
	// ColorID 形如 "mard221:A1"，与前端 palette.js 的 id 规则一致
	ColorID  string `gorm:"size:64;uniqueIndex:uk_inventory_user_color;not null" json:"color_id"`
	BrandID  string `gorm:"size:32;index;not null" json:"brand_id"`
	Quantity int    `gorm:"not null;default:0" json:"quantity"`
}
