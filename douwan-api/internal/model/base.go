// Package model 定义数据库实体。
//
// 表结构对齐前端已有的数据形态（pindoudou/src/composables 与 src/data），
// 字段名注释里标出对应的前端概念，便于前后端联调时对照。
package model

import (
	"time"

	"gorm.io/gorm"
)

// Base 是所有业务表的公共字段：自增主键、创建/更新时间、软删除时间。
type Base struct {
	ID        uint64         `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
