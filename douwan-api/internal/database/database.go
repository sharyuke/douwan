// Package database 负责建立数据库连接与执行迁移。
package database

import (
	"context"
	"fmt"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"gitee.com/maryuke/douwan-api/internal/config"
)

// Open 建立 PostgreSQL 连接并配置连接池。
func Open(cfg config.Database, debug bool) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{
		Logger: newGormLogger(cfg.LogSQL, debug),
		// 建表名默认复数化（User → users），与下面的模型注释一致
		TranslateError: true,
	})
	if err != nil {
		return nil, fmt.Errorf("连接数据库: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("获取底层连接池: %w", err)
	}
	sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("数据库连通性检查: %w", err)
	}
	return db, nil
}

// Close 关闭连接池。
func Close(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func newGormLogger(logSQL, debug bool) gormlogger.Interface {
	level := gormlogger.Warn
	switch {
	case logSQL:
		level = gormlogger.Info
	case debug:
		level = gormlogger.Warn
	default:
		level = gormlogger.Error
	}
	return gormlogger.Default.LogMode(level)
}
