// Package testsupport 提供测试用的公共装置。
package testsupport

import (
	"fmt"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"gitee.com/maryuke/douwan-api/internal/database"
)

// NewDB 建一个 SQLite 内存库并跑完迁移。
//
// 用 SQLite 而不是 PostgreSQL，是为了让 `go test ./...` 不需要先起数据库；
// 建表语句由 GORM 从同一份模型生成，所以表结构仍然来自同一个定义。
// 每个测试用独立的库名，避免并行执行时互相干扰。
func NewDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatalf("打开测试数据库: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("获取连接池: %v", err)
	}
	// 内存库在连接之间不共享，限制成单连接避免读到空库
	sqlDB.SetMaxOpenConns(1)

	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("迁移测试数据库: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}
