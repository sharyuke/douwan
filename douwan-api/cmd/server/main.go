// 豆玩 DOUWAN 后端服务入口。
//
// 用法：
//
//	go run ./cmd/server                       # 读 configs/config.yaml
//	go run ./cmd/server -config /etc/douwan/config.yaml
//	DOUWAN_DATABASE_HOST=db go run ./cmd/server
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/logger"
	"gitee.com/maryuke/douwan-api/internal/server"
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

	// 收到 SIGINT / SIGTERM 时取消 ctx，交给 server 优雅关闭
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv, err := server.New(ctx, cfg)
	if err != nil {
		slog.Error("启动失败", "err", err)
		os.Exit(1)
	}
	if err := srv.Run(ctx); err != nil {
		slog.Error("服务退出", "err", err)
		os.Exit(1)
	}
	slog.Info("服务已退出")
}
