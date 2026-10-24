// Package server 负责把配置、数据库、缓存与路由组装成一个可运行的服务，
// 并处理优雅关闭。
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/cache"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/storage"
)

// Server 持有运行期需要的资源。
type Server struct {
	cfg        *config.Config
	db         *gorm.DB
	redis      *redis.Client
	tokenStore auth.TokenStore
	activity   *activity.Recorder
	http       *http.Server
}

// New 组装服务：连数据库、按需连 Redis、准备令牌存储与路由。
func New(ctx context.Context, cfg *config.Config) (*Server, error) {
	db, err := database.Open(cfg.Database, cfg.App.Debug)
	if err != nil {
		return nil, err
	}
	if cfg.Database.AutoMigrate {
		if err := database.AutoMigrate(db); err != nil {
			_ = database.Close(db)
			return nil, err
		}
		slog.InfoContext(ctx, "数据库自动迁移完成")
	}

	var (
		redisClient *redis.Client
		tokenStore  auth.TokenStore
	)
	if cfg.Redis.Enabled {
		redisClient, err = cache.NewRedis(cfg.Redis)
		if err != nil {
			_ = database.Close(db)
			return nil, err
		}
		tokenStore = auth.NewRedisTokenStore(redisClient)
		slog.InfoContext(ctx, "刷新令牌存储使用 Redis", "addr", cfg.Redis.Addr())
	} else {
		tokenStore = auth.NewMemoryTokenStore()
		slog.WarnContext(ctx, "未启用 Redis，刷新令牌存在进程内存里，重启即失效")
	}

	tokens := auth.NewManager(cfg.JWT)

	// 上传目录必须在组装路由之前准备好：素材相关的路由只有 Storage 可用时才注册。
	// 初始化失败时**不直接拒绝启动**：收款、卡密、订单这些模块不应该因为
	// 一个目录权限问题就整体不可用。失败原因会传给路由，让素材相关接口
	// 明确返回「存储未就绪」而不是让运营面对 404（这是线上踩过的坑）。
	store, storeErr := storage.New(cfg.Storage)
	if storeErr != nil {
		slog.ErrorContext(ctx, "文件存储初始化失败：素材管理接口将不可用", "err", storeErr, "dir", cfg.Storage.UploadDir)
	} else {
		slog.InfoContext(ctx, "文件存储就绪", "dir", store.Root(), "public", store.PublicPrefix())
	}

	// 活跃数据采集器：IP 归属地解析失败只会降级成「地区未知」，不影响启动。
	// 它的落库协程在 Run 里启动、在 Close 里停止（停止前会做最后一次落库）。
	recorder := activity.NewRecorder(
		cfg.Activity,
		repository.New(db),
		activity.NewGeoResolver(cfg.Activity),
	)

	engine := router.New(router.Deps{
		Config:     cfg,
		DB:         db,
		Tokens:     tokens,
		TokenStore: tokenStore,
		Storage:    store,
		StorageErr: storeErr,
		Activity:   recorder,
	})

	return &Server{
		cfg:        cfg,
		db:         db,
		redis:      redisClient,
		tokenStore: tokenStore,
		activity:   recorder,
		http: &http.Server{
			Addr:              cfg.Server.Addr(),
			Handler:           engine,
			ReadHeaderTimeout: cfg.Server.ReadTimeout,
			WriteTimeout:      cfg.Server.WriteTimeout,
			IdleTimeout:       cfg.Server.IdleTimeout,
		},
	}, nil
}

// Run 启动 HTTP 服务并阻塞，直到 ctx 被取消（收到退出信号）后优雅关闭。
func (s *Server) Run(ctx context.Context) error {
	// 兜底：任何返回路径都要把内存里的活跃增量落库（Stop 可重复调用）
	if s.activity != nil {
		defer s.activity.Stop()
		s.activity.Start(ctx)
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("HTTP 服务启动", "addr", s.http.Addr, "env", s.cfg.App.Env)
		if err := s.http.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("监听 %s: %w", s.http.Addr, err)
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		slog.Info("收到退出信号，开始优雅关闭")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), s.cfg.Server.ShutdownTimeout)
	defer cancel()
	if err := s.http.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("优雅关闭: %w", err)
	}
	return s.Close()
}

// Close 释放数据库与缓存连接。
// 顺序要紧：先把活跃采集器的缓冲刷进库，再关数据库。
func (s *Server) Close() error {
	var errs []error
	if s.activity != nil {
		s.activity.Stop()
	}
	if s.tokenStore != nil {
		if err := s.tokenStore.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if s.redis != nil {
		if err := s.redis.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if s.db != nil {
		if err := database.Close(s.db); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
