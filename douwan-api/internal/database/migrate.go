package database

import (
	"fmt"
	"log/slog"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/model"
)

// AutoMigrate 建表与补字段。它不会删除列、也不会改列类型，
// 生产环境的结构变更建议写显式 SQL 迁移（见 cmd/migrate）。
func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(model.AllModels()...); err != nil {
		return fmt.Errorf("自动迁移: %w", err)
	}
	if err := fixLegacyIndexes(db); err != nil {
		return err
	}
	return nil
}

// fixLegacyIndexes 修掉历史版本留下的、会误伤数据的索引。
//
// GORM 的 AutoMigrate 只会加索引、不会删索引，所以「把全表唯一索引改成
// 部分唯一索引」这种修正在已经建过表的老库上不会自动生效。
//
// 判定方式刻意做得保守：**先看数据里还有没有空串**。
//   - 老库（列 NOT NULL、索引全表唯一）里一定残留空串 → 清理 + 重建索引；
//   - 已经修过的库没有空串 → 什么都不做，避免每次跑 migrate 都删一遍索引
//     （高并发下那是个没必要的窗口期）。
func fixLegacyIndexes(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&model.Order{}, "fulfillment_key") {
		return nil
	}

	var emptyCount int64
	if err := db.Model(&model.Order{}).Where("fulfillment_key = ''").Count(&emptyCount).Error; err != nil {
		return fmt.Errorf("统计 orders.fulfillment_key 空串: %w", err)
	}
	hasLegacyFullIndex := db.Migrator().HasIndex(&model.Order{}, "idx_orders_fulfillment_key")
	if emptyCount == 0 && !hasLegacyFullIndex {
		return nil // 已经是修过的状态
	}
	slog.Info("检测到需要修复的 orders.fulfillment_key 状态", "empty_rows", emptyCount, "legacy_index", hasLegacyFullIndex)

	// 先删掉可能存在的旧索引（新旧名字都试一遍，不存在就跳过）
	for _, name := range []string{"idx_orders_fulfillment_key", "uk_orders_fulfillment_key"} {
		if db.Migrator().HasIndex(&model.Order{}, name) {
			if err := db.Migrator().DropIndex(&model.Order{}, name); err != nil {
				return fmt.Errorf("删除旧的 orders.fulfillment_key 索引 %s: %w", name, err)
			}
			slog.Info("已删除 orders 上会误伤空值的唯一索引", "index", name)
		}
	}

	// 列改成可空（老库上是 NOT NULL），并把历史空串清成 NULL
	if err := db.Exec("ALTER TABLE orders ALTER COLUMN fulfillment_key DROP NOT NULL").Error; err != nil {
		// SQLite 不支持这句；建表语句本来就是可空的，忽略即可
		slog.Debug("orders.fulfillment_key 改可空被跳过（SQLite 等不支持 ALTER COLUMN 的库属正常）", "err", err)
	}
	res := db.Exec("UPDATE orders SET fulfillment_key = NULL WHERE fulfillment_key = ''")
	if res.Error != nil {
		return fmt.Errorf("清理 orders.fulfillment_key 的历史空串: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		slog.Info("已把 orders.fulfillment_key 的历史空串清成 NULL", "rows", res.RowsAffected)
	}

	// 最后按新定义重建（部分唯一索引）
	if err := db.AutoMigrate(&model.Order{}); err != nil {
		return fmt.Errorf("重建 orders 索引: %w", err)
	}
	return nil
}
