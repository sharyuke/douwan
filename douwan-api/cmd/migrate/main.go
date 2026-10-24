// 显式执行数据库迁移。
//
// 生产环境建议把 configs/config.yaml 里的 database.auto_migrate 设为 false，
// 由这个命令在发布流程里单独跑一次，避免多实例同时启动时并发建表。
//
//	go run ./cmd/migrate
//	go run ./cmd/migrate -config /etc/douwan/config.yaml
package main

import (
	"flag"
	"log/slog"
	"os"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/logger"
)

func main() {
	configPath := flag.String("config", "", "配置文件路径，留空则依次尝试 ./configs/config.yaml 与 ./config.yaml")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("加载配置失败", "err", err)
		os.Exit(1)
	}
	slog.SetDefault(logger.New(cfg.Log))

	db, err := database.Open(cfg.Database, cfg.App.Debug)
	if err != nil {
		slog.Error("连接数据库失败", "err", err)
		os.Exit(1)
	}
	defer func() { _ = database.Close(db) }()

	if err := database.AutoMigrate(db); err != nil {
		slog.Error("迁移失败", "err", err)
		os.Exit(1)
	}
	slog.Info("迁移完成")
}
