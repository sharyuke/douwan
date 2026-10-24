// Package router 负责把中间件、处理函数与路径装配成 HTTP 路由。
package router

import (
	"context"
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/admin"
	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/handler"
	"gitee.com/maryuke/douwan-api/internal/localai"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
	"gitee.com/maryuke/douwan-api/internal/storage"
)

// Deps 是装配路由需要的依赖。
type Deps struct {
	Config     *config.Config
	DB         *gorm.DB
	Tokens     *auth.Manager
	TokenStore auth.TokenStore
	// Storage 为 nil 时跳过上传相关路由（例如只跑单元测试的场景）
	Storage *storage.Store
	// StorageErr 非空表示「本来该有存储，但初始化失败了」。
	//
	// 这两种情况必须区分开：
	//   - Storage == nil && StorageErr == nil：调用方明确不需要上传能力（测试）；
	//     素材相关路由干脆不注册，访问会得到 404「接口不存在」。
	//   - StorageErr != nil：线上配置有问题（目录不可写等）。这时候直接注册一
	//     组返回 500 的路由，把原因写清楚，而不是让运营面对一个莫名其妙的 404。
	StorageErr error
	// Activity 是活跃数据采集器。为 nil 时不做任何采集，
	// 后台活跃接口会返回空数据并在 notes 里说明采集未开启。
	Activity *activity.Recorder
	// AI 是本地 AI 服务。为 nil 时 /api/v1/ai/* 整组不注册（单元测试场景）。
	//
	// 注意它和 Config.LocalAI.Enabled 是两件事：
	//   - AI == nil            → 路由不存在（404），用于测试或没装配队列；
	//   - AI != nil 但开关关闭 → 路由存在但全部返回 40028（可读的「功能没开」）。
	// 后者才是线上默认状态：让「功能做了但没开」与「接口不存在」可区分。
	AI *service.AIService
	// Workflows 是 ComfyUI 工作流模板来源，由 server 装配（可为 nil）。
	Workflows localai.WorkflowStore
}

// New 构造 gin 引擎。所有业务路由统一挂在 /api/v1 下，
// 健康检查放在根路径，方便负载均衡与探针直接访问。
func New(deps Deps) *gin.Engine {
	if deps.Config.App.Debug {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	engine := gin.New()
	engine.Use(
		middleware.RequestID(),
		middleware.AccessLog(),
		middleware.Recovery(),
		middleware.CORS(deps.Config.CORS),
	)

	// 只信任本机反向代理提供的 X-Forwarded-For / X-Real-IP。
	//
	// gin 默认信任所有代理，那样任何人都能伪造 XFF 冒充任意 IP，
	// 而活跃监控的地区统计正是读 ClientIP()。配置留空时回落到回环地址。
	trusted := deps.Config.Server.TrustedProxies
	if len(trusted) == 0 {
		trusted = []string{"127.0.0.1", "::1"}
	}
	if err := engine.SetTrustedProxies(trusted); err != nil {
		slog.Warn("设置可信代理失败，ClientIP 可能取到代理地址", "err", err, "trusted", trusted)
	}

	// 活跃采集中间件放在最外层：它靠 c.Next() 之后的代码回看这次请求，
	// 那时各业务分组的 Auth 中间件已经写好了用户 ID。
	if deps.Activity != nil {
		engine.Use(deps.Activity.Middleware())
	}

	health := handler.NewHealthHandler(deps.DB)
	engine.GET("/healthz", health.Live)
	engine.GET("/readyz", health.Ready)

	// 上传文件由本服务直接托管（本地磁盘存储）。
	// 线上也可以交给 nginx 直接读同一个目录，两者互不冲突。
	if deps.Storage != nil {
		prefix := deps.Storage.PublicPrefix()
		engine.Static(prefix, deps.Storage.Root())
	} else {
		engine.Static("/uploads", "./data/uploads")
	}

	repos := repository.New(deps.DB)
	audit := service.NewAuditLog()

	// ------------------------------------------------------------------ 服务
	userService := service.NewUserService(deps.DB, deps.Tokens, deps.TokenStore)
	userHandler := handler.NewUserHandler(userService)

	cipher, _ := admin.NewCipher(deps.Config.Admin.CardCipherKey)

	adminService := service.NewAdminService(repos, deps.Tokens, deps.TokenStore, audit)
	adminHandler := handler.NewAdminHandler(adminService)

	planService := service.NewPlanService(repos, audit)
	planHandler := handler.NewPlanHandler(planService)

	cardService := service.NewCardKeyService(deps.DB, repos, cipher, service.CardKeyConfig{
		CipherSecret:          deps.Config.Admin.CardCipherKey,
		MaxGeneratePerRequest: deps.Config.Admin.MaxGeneratePerRequest,
		CodeLength:            deps.Config.Admin.CardCodeLength,
	}, audit)
	cardHandler := handler.NewCardKeyHandler(cardService)

	grantService := service.NewGrantService(repos, audit)
	entService := service.NewEntitlementService(deps.DB, repos, grantService, audit)

	// 支付渠道是否已配置由「系统设置」决定，启动时由 server 调用
	// SettingsService.ApplyRuntimeSettings 填入；这里先用空值构造。
	orderService := service.NewOrderService(deps.DB, repos, grantService, audit, "")
	orderHandler := handler.NewOrderHandler(orderService)

	var libraryHandler *handler.LibraryHandler
	if deps.Storage != nil {
		libraryService := service.NewLibraryService(deps.DB, repos, deps.Storage, audit)
		libraryHandler = handler.NewLibraryHandler(libraryService)
	}

	settingsService := service.NewSettingsService(repos, audit, deps.Storage)
	settingHandler := handler.NewSettingHandler(settingsService)

	overviewService := service.NewOverviewService(deps.DB, repos, "")
	overviewHandler := handler.NewOverviewHandler(overviewService)

	// 启动时把「系统设置」里的默认项补齐，并把运行期参数（上传上限、支付渠道）
	// 注入到相关服务。这样运营改完设置不需要重启服务，也不需要手工改配置文件。
	bootCtx := context.Background()
	if _, err := settingsService.EnsureDefaults(bootCtx); err != nil {
		slog.WarnContext(bootCtx, "初始化系统设置失败", "err", err)
	}
	settingsService.ApplyRuntimeSettings(bootCtx)
	if ready, channel := settingsService.PaymentReady(bootCtx); ready {
		orderService.SetPaymentChannel(channel)
		overviewService.SetPaymentChannel(channel)
	}

	adminUserService := service.NewAdminUserService(repos)
	adminUserHandler := handler.NewAdminUserHandler(adminUserService, entService)

	logService := service.NewAdminLogService(repos)
	logHandler := handler.NewLogHandler(logService)

	activityService := service.NewActivityService(repos, deps.Activity)
	activityHandler := handler.NewActivityHandler(activityService)
	eventHandler := handler.NewEventHandler(activityService)

	meHandler := handler.NewMeHandler(entService)

	// 本地 AI。deps.AI 由 server 装配（含队列与执行器）；
	// 为 nil 时整组不注册，避免在未装配的环境里出现半死不活的接口。
	var aiHandler *handler.AIHandler
	var aiAdminHandler *handler.AIAdminHandler
	if deps.AI != nil {
		aiHandler = handler.NewAIHandler(deps.AI)
		aiAdminHandler = handler.NewAIAdminHandler(deps.AI)
	}

	v1 := engine.Group("/api/v1")
	{
		/* ---------------------------------------------------------- 前台鉴权 */
		authGroup := v1.Group("/auth")
		{
			authGroup.POST("/register", userHandler.Register)
			authGroup.POST("/login", userHandler.Login)
			authGroup.POST("/refresh", userHandler.Refresh)
			// 登出只依赖刷新令牌本身，不需要带上有效的访问令牌
			authGroup.POST("/logout", userHandler.Logout)
		}

		me := v1.Group("/users", middleware.Auth(deps.Tokens))
		{
			me.GET("/me", userHandler.Me)
			me.PATCH("/me", userHandler.UpdateProfile)
		}

		/* ------------------------------------------------------ 前台公开接口 */
		// 套餐：只返回已上架，价格与权益都来自数据库
		v1.GET("/plans", func(c *gin.Context) {
			items, err := planService.PublicList(c.Request.Context())
			if err != nil {
				response.Fail(c, err)
				return
			}
			response.Success(c, items)
		})
		// 公开设置：网站名、客服入口、卡密规则、支付状态
		v1.GET("/settings/public", settingHandler.Public)

		// 素材库：只返回已发布素材
		if libraryHandler != nil {
			v1.GET("/assets", libraryHandler.PublicAssets)
			v1.GET("/assets/categories", libraryHandler.PublicCategories)
			v1.GET("/assets/:slug", libraryHandler.PublicAssetDetail)
		}

		/* ------------------------------------------------------ 前台需登录接口 */
		authed := v1.Group("", middleware.Auth(deps.Tokens))
		{
			// 卡密兑换：加限流，防止被用来暴力试探卡密（需求 §3.3）
			redeemLimit := deps.Config.Admin.CardRedeemPerMinute
			if redeemLimit <= 0 {
				redeemLimit = 10
			}
			authed.POST("/card-keys/redeem",
				middleware.RateLimit(redeemLimit, time.Minute),
				cardHandler.Redeem)

			// 前台订单：只能看自己的
			authed.GET("/orders", orderHandler.MyOrders)
			authed.GET("/orders/:id", orderHandler.MyOrderDetail)
			authed.POST("/orders", orderHandler.Create)

			// 我的有效权益（前台「我的账户」用）
			authed.GET("/my/entitlements", meHandler.Entitlements)

			// 客户端埋点上报：图纸生成 / 导出 / 抠图 / AI 出图这类
			// 只发生在浏览器里的功能，服务端看不见，只能由前端上报。
			// 单独限流：埋点是批量上报，正常客户端每分钟几次，
			// 但被刷的话会直接污染后台的功能热度统计。
			reportLimit := deps.Config.Activity.EventReportPerMinute
			if reportLimit <= 0 {
				reportLimit = 120
			}
			authed.POST("/events",
				middleware.RateLimit(reportLimit, time.Minute),
				eventHandler.Report)
		}

		// 有效权限矩阵：未登录也能拿到免费版，前台据此给出升级引导。
		//
		// 必须挂 OptionalAuth：带了令牌就要按该用户的权益算，
		// 否则登录用户拿到的永远是免费版矩阵（前台按钮一直不解锁）。
		// 路径不带 /users 前缀是刻意的：v1 的 /users 组整体要求登录。
		v1.GET("/permissions", middleware.OptionalAuth(deps.Tokens), meHandler.Permissions)

		/* ---------------------------------------------------------- 本地 AI */
		//
		// 全部需要登录：AI 任务与用户绑定，未登录用户先走登录引导即可。
		// 接口是**异步**的（提交拿 job_id → 轮询状态 → 取产物），
		// 因为一次卡通化在 6GB 显存上要 6~25s，同步接口会被 nginx 的
		// proxy_read_timeout=60s 掐断，用户看到的是 504 而不是可读的进度。
		if aiHandler != nil {
			ai := v1.Group("/ai", middleware.Auth(deps.Tokens))
			{
				// 可用性探测不限流：前端可能频繁检查，且它本身很便宜
				// （只是读一次 /system_stats 与 /openapi.json，带 5s 超时）。
				ai.GET("/status", aiHandler.NodeStatus)
				// 上传与提交限流：并发推理上限是 1，限流是为了别让用户
				// 把队列塞满后长时间等待（超了会收到 40029 与明确文案）。
				ai.POST("/uploads",
					middleware.RateLimit(20, time.Minute),
					aiHandler.UploadInput)
				ai.POST("/jobs",
					middleware.RateLimit(10, time.Minute),
					aiHandler.Submit)
				ai.GET("/jobs", aiHandler.List)
				ai.GET("/jobs/:id", aiHandler.Get)
				ai.POST("/jobs/:id/cancel", aiHandler.Cancel)
			}
		}

		/* ---------------------------------------------------------- 后台鉴权 */
		adminAuth := v1.Group("/admin/auth")
		{
			// 登录接口单独限流：防密码爆破
			adminAuth.POST("/login", middleware.RateLimit(10, time.Minute), adminHandler.Login)
			adminAuth.POST("/refresh", adminHandler.Refresh)
			adminAuth.POST("/logout", middleware.AdminAuth(deps.Tokens, repos), adminHandler.Logout)
		}

		/* ---------------------------------------------------------- 后台接口 */
		adm := v1.Group("/admin", middleware.AdminAuth(deps.Tokens, repos))
		{
			adm.GET("/auth/me", adminHandler.Me)
			adm.POST("/auth/password", adminHandler.ChangePassword)
			adm.GET("/permissions", adminHandler.Permissions)

			// 数据概览
			adm.GET("/overview",
				middleware.RequirePermission(model.PermOverviewView), overviewHandler.Load)

			// 用户活跃数据监控（使用频率 / 地区 / 功能 / 渠道）
			activity := adm.Group("/activity",
				middleware.RequirePermission(model.PermActivityView))
			{
				activity.GET("/overview", activityHandler.Overview)
				activity.GET("/retention", activityHandler.Retention)
				activity.GET("/frequency", activityHandler.Frequency)
				activity.GET("/regions", activityHandler.Regions)
				activity.GET("/features", activityHandler.Features)
				activity.GET("/channels", activityHandler.Channels)
				activity.GET("/users", activityHandler.Users)
				activity.GET("/users/:id", activityHandler.UserDetail)
			}

			// 本地 AI 运维：节点状态与任务列表。
			//
			// 状态接口在**功能关闭时也返回 200**（只是 Enabled=false），
			// 运营据此判断要不要去开开关，而不是看到一个错误弹窗。
			if aiAdminHandler != nil {
				localaiGroup := adm.Group("/localai",
					middleware.RequirePermission(model.PermLocalAIView))
				{
					localaiGroup.GET("/status", aiAdminHandler.Status)
					localaiGroup.GET("/jobs", aiAdminHandler.Jobs)
				}
			}

			// 套餐
			plans := adm.Group("/plans")
			{
				plans.GET("", middleware.RequirePermission(model.PermPlanManage), planHandler.List)
				plans.GET("/options", middleware.RequirePermission(model.PermPlanManage), planHandler.Options)
				plans.GET("/:id", middleware.RequirePermission(model.PermPlanManage), planHandler.Detail)
				plans.GET("/:id/preview", middleware.RequirePermission(model.PermPlanManage), planHandler.Preview)
				plans.POST("", middleware.RequirePermission(model.PermPlanManage), planHandler.Create)
				plans.PUT("/:id", middleware.RequirePermission(model.PermPlanManage), planHandler.Update)
				plans.PATCH("/:id/status", middleware.RequirePermission(model.PermPlanManage), planHandler.ChangeStatus)
				plans.POST("/:id/duplicate", middleware.RequirePermission(model.PermPlanManage), planHandler.Duplicate)
				plans.DELETE("/:id", middleware.RequirePermission(model.PermPlanManage), planHandler.Delete)
				plans.POST("/drafts", middleware.RequirePermission(model.PermPlanManage), planHandler.SeedDrafts)
			}

			// 卡密
			cards := adm.Group("/card-keys")
			{
				cards.GET("", middleware.RequirePermission(model.PermCardView), cardHandler.List)
				cards.GET("/meta", middleware.RequirePermission(model.PermCardView), cardHandler.Meta)
				cards.GET("/batches", middleware.RequirePermission(model.PermCardView), cardHandler.Batches)
				cards.POST("/generate", middleware.RequirePermission(model.PermCardGenerate), cardHandler.Generate)
				cards.POST("/reveal", middleware.RequirePermission(model.PermCardReveal), cardHandler.Reveal)
				cards.POST("/void", middleware.RequirePermission(model.PermCardRevoke), cardHandler.Void)
				cards.POST("/export", middleware.RequirePermission(model.PermCardExport), cardHandler.Export)
			}

			// 订单
			orders := adm.Group("/orders")
			{
				orders.GET("", middleware.RequirePermission(model.PermOrderView), orderHandler.List)
				orders.GET("/:id", middleware.RequirePermission(model.PermOrderView), orderHandler.Detail)
				orders.POST("/:id/settle", middleware.RequirePermission(model.PermOrderSettle), orderHandler.Settle)
				orders.POST("/:id/issue", middleware.RequirePermission(model.PermOrderSettle), orderHandler.Issue)
				orders.POST("/:id/close", middleware.RequirePermission(model.PermOrderSettle), orderHandler.Close)
				orders.POST("/:id/refund", middleware.RequirePermission(model.PermOrderRefund), orderHandler.Refund)
			}

			// 素材与分类
			if libraryHandler != nil {
				assets := adm.Group("/assets")
				{
					assets.GET("", middleware.RequirePermission(model.PermAssetView), libraryHandler.List)
					assets.GET("/tags", middleware.RequirePermission(model.PermAssetView), libraryHandler.Tags)
					assets.GET("/:id", middleware.RequirePermission(model.PermAssetView), libraryHandler.Detail)
					assets.POST("/upload", middleware.RequirePermission(model.PermAssetManage), libraryHandler.Upload)
					assets.PATCH("/:id", middleware.RequirePermission(model.PermAssetManage), libraryHandler.Update)
					assets.PATCH("/:id/status", middleware.RequirePermission(model.PermAssetManage), libraryHandler.ChangeStatus)
					assets.POST("/sort", middleware.RequirePermission(model.PermAssetManage), libraryHandler.BatchSort)
					assets.DELETE("/:id", middleware.RequirePermission(model.PermAssetManage), libraryHandler.Delete)
				}
				cats := adm.Group("/asset-categories")
				{
					cats.GET("", middleware.RequirePermission(model.PermAssetView), libraryHandler.CategoryList)
					cats.GET("/options", middleware.RequirePermission(model.PermAssetView), libraryHandler.CategoryOptions)
					cats.POST("", middleware.RequirePermission(model.PermAssetManage), libraryHandler.CategoryCreate)
					cats.PUT("/:id", middleware.RequirePermission(model.PermAssetManage), libraryHandler.CategoryUpdate)
					cats.DELETE("/:id", middleware.RequirePermission(model.PermAssetManage), libraryHandler.CategoryDelete)
				}
			} else if deps.StorageErr != nil {
				// 存储初始化失败：占住这些路径并说明原因，
				// 免得运营看到「接口不存在」还以为功能没做。
				broken := storageNotReady(deps.StorageErr)
				assets := adm.Group("/assets")
				{
					assets.GET("", middleware.RequirePermission(model.PermAssetView), broken)
					assets.GET("/*rest", middleware.RequirePermission(model.PermAssetView), broken)
					assets.POST("/*rest", middleware.RequirePermission(model.PermAssetManage), broken)
					assets.PATCH("/*rest", middleware.RequirePermission(model.PermAssetManage), broken)
					assets.DELETE("/*rest", middleware.RequirePermission(model.PermAssetManage), broken)
				}
				cats := adm.Group("/asset-categories")
				{
					cats.GET("", middleware.RequirePermission(model.PermAssetView), broken)
					cats.GET("/*rest", middleware.RequirePermission(model.PermAssetView), broken)
					cats.POST("/*rest", middleware.RequirePermission(model.PermAssetManage), broken)
					cats.PUT("/*rest", middleware.RequirePermission(model.PermAssetManage), broken)
					cats.DELETE("/*rest", middleware.RequirePermission(model.PermAssetManage), broken)
				}
			}

			// 用户与兑换记录
			adm.GET("/users", middleware.RequirePermission(model.PermUserView), adminUserHandler.List)
			adm.GET("/users/:id", middleware.RequirePermission(model.PermUserView), adminUserHandler.Detail)
			adm.GET("/entitlements", middleware.RequirePermission(model.PermEntitlementView), adminUserHandler.Entitlements)
			adm.POST("/entitlements", middleware.RequirePermission(model.PermEntitlementGive), adminUserHandler.Grant)
			adm.POST("/entitlements/:id/revoke", middleware.RequirePermission(model.PermEntitlementGive), adminUserHandler.Revoke)

			// 系统设置
			adm.GET("/settings", middleware.RequirePermission(model.PermSettingView), settingHandler.List)
			adm.PUT("/settings", middleware.RequirePermission(model.PermSettingManage), settingHandler.Update)

			// 操作日志
			adm.GET("/logs", middleware.RequirePermission(model.PermLogView), logHandler.List)

			// 管理员管理（仅超级管理员）
			admins := adm.Group("/admins", middleware.RequireSuper())
			{
				admins.GET("", adminHandler.List)
				admins.POST("", adminHandler.Create)
				admins.PATCH("/:id", adminHandler.Update)
				admins.POST("/:id/password", adminHandler.ResetPassword)
				admins.PATCH("/:id/status", adminHandler.ChangeStatus)
				admins.DELETE("/:id", adminHandler.Delete)
			}
		}
	}

	engine.NoRoute(func(c *gin.Context) {
		response.Fail(c, response.ErrNotFound.WithMessage("接口不存在"))
	})
	return engine
}

// storageNotReady 生成一个「存储没配好」的处理函数。
func storageNotReady(cause error) gin.HandlerFunc {
	detail := "未配置"
	if cause != nil {
		detail = cause.Error()
	}
	return func(c *gin.Context) {
		response.Fail(c, response.ErrInternal.WithMessage(
			"文件存储未就绪，素材管理暂不可用。请在服务端检查 storage.upload_dir 是否存在且可写（原因："+detail+"）"))
	}
}
