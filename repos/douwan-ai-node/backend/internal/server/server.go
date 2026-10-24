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
	"gitee.com/maryuke/douwan-api/internal/localai"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/service"
	"gitee.com/maryuke/douwan-api/internal/storage"
)

// Server 持有运行期需要的资源。
type Server struct {
	cfg        *config.Config
	db         *gorm.DB
	redis      *redis.Client
	tokenStore auth.TokenStore
	activity   *activity.Recorder
	// aiQueue 本地 AI 任务队列。为 nil 表示功能未启用。
	aiQueue *localai.Queue
	// aiService 本地 AI 服务。仅用于启停它的维护协程（过期输入图清理 + 卡死任务回收）。
	aiService *service.AIService
	http      *http.Server
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

	// 本地 AI：队列 + 客户端 + 执行器。
	//
	// 装配顺序（有环，靠 SetEnqueue 解开）：
	//   service → queue（queue 的回调是 service.RunNext）→ service.SetEnqueue(queue.Notify)
	//
	// 只在开关打开时才构造：关掉时 aiService 为 nil，路由整组不注册 ——
	// 这样线上默认状态下，连「探测推理节点」的网络调用都不会发生。
	// ⚠ 队列的协程**不在这里启动**：router.New 会被每个 handler 测试调用，
	//    在装配阶段起协程会留下泄漏的 goroutine。启动放在 Run 里。
	var (
		aiQueue   *localai.Queue
		aiService *service.AIService
	)
	if cfg.LocalAI.Enabled {
		repos := repository.New(db)
		aiClient := service.NewAIClient(cfg.LocalAI)
		wfStore := localai.NewFileWorkflowStore(cfg.LocalAI.WorkflowDir)
		aiService = service.NewAIService(cfg.LocalAI, repos, store, aiClient, nil, nil)
		aiService.AttachExecutor(localai.NewExecutor(
			localai.Config{
				ComfyURL:      cfg.LocalAI.ComfyURL,
				RembgURL:      cfg.LocalAI.RembgURL,
				HealthTimeout: cfg.LocalAI.HealthTimeout,
				SubmitTimeout: cfg.LocalAI.SubmitTimeout,
				PollInterval:  cfg.LocalAI.PollInterval,
				JobTimeout:    cfg.LocalAI.JobTimeout,
				Checkpoint:    cfg.LocalAI.Checkpoint,
				MattingModel:  cfg.LocalAI.MattingModel,
			},
			aiClient, wfStore,
		))
		aiQueue = service.NewAIQueue(cfg.LocalAI, aiService)
		aiService.SetEnqueue(func(uint64) { aiQueue.Notify() })
		slog.InfoContext(ctx, "本地 AI 已启用",
			"comfy", cfg.LocalAI.ComfyURL, "rembg", cfg.LocalAI.RembgURL,
			"max_running", cfg.LocalAI.MaxRunning, "queue_size", cfg.LocalAI.QueueSize,
			"workflow_dir", cfg.LocalAI.WorkflowDir)
	} else {
		slog.InfoContext(ctx, "本地 AI 未启用（local_ai.enabled=false），/api/v1/ai/* 返回 40028")
	}

	engine := router.New(router.Deps{
		Config:     cfg,
		DB:         db,
		Tokens:     tokens,
		TokenStore: tokenStore,
		Storage:    store,
		StorageErr: storeErr,
		Activity:   recorder,
		AI:         aiService,
	})

	return &Server{
		cfg:        cfg,
		db:         db,
		redis:      redisClient,
		tokenStore: tokenStore,
		activity:   recorder,
		aiQueue:    aiQueue,
		aiService:  aiService,
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
	// 本地 AI 队列：启动时会先扫一次队列，把上次进程退出时遗留的任务捞出来执行
	// （它们的 Notify 早已随进程消失，只能靠启动扫描 + 兜底轮询）。
	if s.aiQueue != nil {
		defer s.aiQueue.Stop()
		s.aiQueue.Start(ctx)
	}
	// 本地 AI 维护协程：启动时先扫一次（清理上次进程留下的过期输入图与卡死任务），
	// 之后每小时一次。顺序放在队列之后 —— 先把卡死任务回收掉，队列才拿得到额度。
	if s.aiService != nil {
		defer s.aiService.StopAIMaintenance()
		s.aiService.StartAIMaintenance(ctx)
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
// 顺序要紧：先把后台协程停下来（活跃采集器要冲刷缓冲），再关数据库。
func (s *Server) Close() error {
	var errs []error
	if s.activity != nil {
		s.activity.Stop()
	}
	// AI 队列必须在关库之前停：它正在跑的任务结束时还要写 ai_jobs 表，
	// 先关库会让状态永远停在 running（下次启动才被 FailStale 清掉）。
	// Stop 用 sync.Once，与 Run 里的 defer 重复调用是安全的。
	if s.aiQueue != nil {
		s.aiQueue.Stop()
	}
	// 维护协程也要在关库之前停：它还要写 ai_jobs / ai_uploads 两张表。
	if s.aiService != nil {
		s.aiService.StopAIMaintenance()
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
