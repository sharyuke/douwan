package database

import (
	"context"

	"gorm.io/gorm"
)

// WithTx 在一个事务里执行 fn：fn 返回错误就回滚，否则提交。
// 注册这类要同时写多张表的操作走它，避免出现「用户建了但权益没建」的中间状态。
func WithTx(ctx context.Context, db *gorm.DB, fn func(tx *gorm.DB) error) error {
	return db.WithContext(ctx).Transaction(fn)
}
