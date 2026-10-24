package model

// AllModels 是参与自动迁移的全部实体。
// 新增实体后加到这里即可，cmd/migrate 与启动时的自动迁移都读这份清单。
func AllModels() []any {
	return []any{
		// 账号与权益
		&User{},
		&Membership{},
		&CreditAccount{},
		&CreditTransaction{},
		&UsageStat{},
		// 作品与库存
		&Project{},
		&ProjectVariant{},
		&InventoryItem{},
		// 素材与色板（内容侧，通常由后台导入）
		&Asset{},
		&AssetFavorite{},
		&PaletteBrand{},
		&PaletteColor{},
		// 后台管理（需求文档 MVP）
		&Admin{},
		&Plan{},
		&CardKey{},
		&Order{},
		&OrderEvent{},
		&Entitlement{},
		&LibraryAsset{},
		&LibraryCategory{},
		&OperationLog{},
		&Setting{},
		// 用户活跃数据监控（日汇总，非流水）
		&UserDailyActivity{},
		&UserFeatureDaily{},
		// 本地 AI 推理任务（异步队列，产物落 storage）
		&AIJob{},
		&AIUpload{},
		// 站点访问量（PV / UV，含未登录访客）
		&SiteVisitor{},
		&SiteVisitorPageDaily{},
	}
}
