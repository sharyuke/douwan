# 阶段 D 交付：`douwan-api` 本地 AI 后端模块

- 完成日期：**2026-10-16**
- 验证方式：在 `home` 上的**隔离副本**（从**当时的 `HEAD`** 导出干净树 + 覆盖我的文件），
  用 `git worktree` / `git archive` 隔离，**不碰并行会话的工作树**
- 验证结果（对 `HEAD = edd8835`）：`go build ./...` **通过**、`go vet ./...` **通过**、
  `go test ./...` **全部 ok**（含并行会话的访问量模块）；
  本地 AI 相关**新增 85 个通过断言**（`internal/localai` / `internal/model` / `internal/service`）
- 状态：**代码完成且已接线**（router 挂载 + server 启停），**未提交、未部署、线上未动**

> ⚠️ **本阶段改动没有写进团队的主工作树 `~/Documents/work/dw/douwan-api`。**
> 原因见 §7「并发冲突与数据损失说明」——那个目录当时有另一条并发工作流在编辑，
> 我早期用 `scp` 覆盖过去，造成了他们的 `config.go` 改动丢失。已改为隔离副本作业。

---

## 0. 完成度一览

| 项目 | 状态 |
| --- | --- |
| 配置节 `local_ai`（16 个键 + 启动校验） | ✅ |
| `configs/config.yaml` 与 `.env.example` 的 `local_ai` 段落 | ✅ |
| 两张新表 `ai_jobs` / `ai_uploads` + 迁移登记 | ✅ |
| 业务码 40028–40033 | ✅ |
| 权限点 `localai.view` / `localai.manage`（常量 + 清单 + 矩阵 + 中文标签） | ✅ |
| storage 子目录 `ai` + `SaveGenerated` + `Read` | ✅ |
| `internal/localai`（客户端 / 队列 / 执行器 / 模板加载） | ✅ |
| `internal/repository`（任务 + 输入图登记） | ✅ |
| `internal/service`（准入 / 幂等 / 取消 / worker 执行与落库） | ✅ |
| `internal/handler`（前台 6 个 + 后台 2 个接口） | ✅ |
| **`internal/router` 接线**（前台组 + 后台组） | ✅ |
| **`internal/server` 接线**（构造 / Start / Stop / Close 顺序） | ✅ |
| 新增单测 71 个 | ✅ |
| `docs/api.md` / `docs/admin.md` 文档同步 | ⬜ 待做 |
| 输入图清理协程、僵尸任务清理调用 | ⬜ 待做（方法已就绪，见 §6） |

### 0.1 测试抓到的一个真 bug（值得记一笔）

幂等键最初只写了 `gorm:"size:64;index"` —— **普通索引，不是唯一索引**，
所以 `ON CONFLICT DO NOTHING` 永远不会触发，重复提交会真的建出两条任务。
`TestAIService_Idempotency` 直接把它抓了出来（「幂等键相同却建了两条任务：1 vs 2」）。

修复时还要处理两个细节（都写进了模型注释）：
1. 唯一性必须**含 `user_id`**（复合键），否则两个不同用户恰好用同一个 key（比如都用 `"1"`）会互相冲突；
2. 必须有 `where:idempotency_key <> ''`，否则 PostgreSQL 把多个空串视为冲突，
   会把「第二个不要求幂等的任务」挡下来。

最终写法（与仓库既有的 `users.email` / `users.phone` 一致）：

```go
UserID         uint64 `gorm:"uniqueIndex:uk_ai_jobs_user_idem,priority:1;..."`
IdempotencyKey string `gorm:"size:64;uniqueIndex:uk_ai_jobs_user_idem,priority:2,where:idempotency_key <> ''"`
```

### 0.2 合并纪律：共享文件必须「追加」而不是「整份覆盖」

本阶段的验证环境是「从 `HEAD` 导出干净树 + 覆盖我的文件」。踩到的两个坑都源于
**把共享文件整份覆盖**：

| 共享文件 | 覆盖后的问题 | 正确做法 |
| --- | --- | --- |
| `internal/model/migrate.go` | 我的版本里没有并行会话刚加的 `&SiteVisitor{}` / `&SiteVisitorPageDaily{}`，`go test` 里一批访问量用例报 `no such table: site_visitor_page_daily` | 以 HEAD 版为基准，**只追加** `&AIJob{}` / `&AIUpload{}` |
| `internal/repository/repository.go` | 我的版本里没有 `Visit *VisitRepository`，`internal/activity` 编译失败 | 以 HEAD 版为基准，**只追加** `AIJob` / `AIUpload` 两个字段与构造 |

注意 `HEAD` 的 `repository.go` **同时**含 `Visit` 与我的两个 AI 字段 ——
说明并行会话在提交时已刻意保留了 AI 接线（他们那条 commit 的标题就是
「仓储清单只保留访问量接线（上一条把并行开发的 AI 仓储一起带上了）」）。

**结论**：在这个工作区里动 `migrate.go` / `repository.go` / `config.go` / `router.go` 这类
共享文件时，永远不要 `cp` 整份覆盖，要按行追加；并且**每次都要在 HEAD 的新副本上重新验证一次**
（本阶段就因为 HEAD 前进了两次而重复验证了三轮）。

---

## 1. 新增文件（11 个，全部是纯新增，不改既有行为）

| 文件 | 作用 |
| --- | --- |
| `internal/localai/client.go` | ComfyUI / rembg 的 HTTP 客户端：探活、传图、提交、轮询、取产物、抠图 |
| `internal/localai/queue.go` | 后台任务队列：串行执行、非阻塞唤醒、遵循项目既有 goroutine 生命周期纪律 |
| `internal/localai/executor.go` | 把任务翻译成推理调用（抠图 / img2img / txt2img 三分支 + 取消检查） |
| `internal/localai/workflow.go` | 从磁盘读 ComfyUI 工作流模板（深拷贝、路径穿越防护、元数据读取） |
| `internal/model/ai_job.go` | `AIJob` 任务表 + `AIUpload` 输入图登记表 + 类型/状态常量与中文标签 |
| `internal/repository/ai_job.go` | 任务表读写：幂等创建、**条件更新抢任务**、状态流转、队列快照、统计 |
| `internal/repository/ai_upload.go` | 输入图登记读写（按 `(user_id, asset_id)` 反查，天然越权保护） |
| `internal/dto/ai.go` | 请求/响应 DTO（提交、任务视图、上传结果、列表查询、节点状态） |
| `internal/service/ai.go` | 业务编排：参数校验、队列准入、上传、提交、查询、取消、worker 执行与落库 |
| `internal/handler/ai.go` | 前台 5 个接口 + 后台 2 个接口的处理函数 |
| `docs/local-ai-deployment.md` 等 | 见阶段 B/C 的文档交付 |

## 2. 修改文件（6 个，全部是加法）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `internal/config/config.go` | 新增 `LocalAI` 结构体 + `Config.LocalAI` 字段 + `local_ai.*` 全部 16 个键的 `setDefaults` + `Validate` 校验（含**回环地址红线**与**抠图模型白名单**） | 低（新增键，默认 `enabled=false`） |
| `internal/model/migrate.go` | `AllModels()` 追加 `&AIJob{}`、`&AIUpload{}`（2 张新表） | 低（AutoMigrate 只加表） |
| `internal/model/admin.go` | 新增权限点 `localai.view` / `localai.manage`，并登记进 `permissionOrder` 与角色矩阵 | 低（运营 2 个都拿，只读拿 view） |
| `internal/middleware/admin.go` | `permLabel` 补 2 个新权限点的中文名 | 低 |
| `internal/repository/repository.go` | `Repositories` 追加 `AIJob` / `AIUpload` 字段与构造 | 低（纯加法） |
| `internal/response/errors.go` | 新增业务码 **40028–40033** 与对应 `Err*` 变量 | 低（追加，未改既有码） |
| `internal/storage/storage.go` | 子目录白名单加 `"ai"`；新增 `SaveGenerated`（保存生成产物）与 `Read`（读回输入图） | 低（新方法，未改 `SaveUploaded`） |

业务码分配（承接 40027 继续编号，与仓库既有约定一致）：

| 码 | 含义 | HTTP |
| --- | --- | --- |
| 40028 | 本地 AI 功能未开启 | 503 |
| 40029 | 队列已满 | 429 |
| 40030 | 推理节点不可达 | 503 |
| 40031 | 任务不存在或不属于当前用户 | 404 |
| 40032 | 任务已结束，不能取消 | 409 |
| 40033 | 推理服务拒绝了这次请求 | 400 |

## 3. 接口契约

### 3.1 前台（需登录，`middleware.Auth`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/ai/status` | 节点可用性 + 当前配额（前端据此决定按钮可点还是给原因） |
| `POST` | `/api/v1/ai/uploads` | 上传输入图（multipart 字段名 `file`，兼容 `image` / `images`）→ 返回 `asset_id` |
| `POST` | `/api/v1/ai/jobs` | 提交任务 → 201 + `job_id`；命中幂等键时 200 + `deduplicated=true` |
| `GET` | `/api/v1/ai/jobs` | 我的任务列表（`status` / `kind` 过滤，分页） |
| `GET` | `/api/v1/ai/jobs/:id` | 查任务状态（含 `queue_position`、`duration_ms`） |
| `POST` | `/api/v1/ai/jobs/:id/cancel` | 请求取消（尽力而为） |

任务类型 `kind`：`matting`（抠图）、`cartoonize`（卡通化）、`text2image`（文生图）。

**为什么是异步**：一次卡通化在 RTX 2060 上 6–25s，排队时更久，而 nginx 的
`proxy_read_timeout` 是 60s —— 同步接口会在网关层被掐断，用户看到 504 而不是进度。

### 3.2 后台（`middleware.AdminAuth` + `RequirePermission`）

| 方法 | 路径 | 权限点 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/localai/status` | `localai.view` —— 节点状态、显存、队列快照、当前配额 |
| `GET` | `/api/v1/admin/localai/jobs` | `localai.view` —— 跨用户任务列表 |

## 4. 关键设计决策（都写进了代码注释）

1. **不硬编码价格 / Credits**：本模块**完全不涉及**计费。`EntitlementRepository.ConsumeUsage`
   与 Credits 扣减都留给后续独立的计费接入（需求红线：不把价格写进 AI 功能）。
2. **扣配额与鉴权是分开的两件事**：本模块只做「队列准入」（并发、排队数、总量），
   没有做「这个用户有没有 AI 权益」——因为 `entitlement.Allow` 在仓库里**零调用方**，
   `/api/v1/permissions` 目前只把矩阵发给前端做提示。**这是既有缺口，需要产品/技术决策后单独接线**（见 §6）。
3. **幂等**：`idempotency_key` + `(user_id, key)` 复合唯一索引，`Create` 用
   `ON CONFLICT DO NOTHING` + 冲突后回读。网络抖动重试不会产生两条任务。
4. **抢任务用条件更新**：`ClaimNext` 走「先查 id → 带 `status='queued'` 条件更新」，
   同一条任务不可能被执行两次（即使将来起多个 worker）。
5. **队列串行**：`MaxRunning` 默认 1。RTX 2060 上两个 512×512 任务并发会互相挤显存，
   比串行更慢还可能 OOM。
6. **取消是尽力而为**：ComfyUI 没有取消接口，已提交的推理无法撤回；
   worker 在轮询间隙检查 `cancel_requested`，发现后立刻停止等待并落 `canceled`，
   释放队列额度。
7. **上游报错不透传**：ComfyUI 的报错带节点 id 与 Python 堆栈，对用户无意义且泄露结构。
   `translateAIError` 统一翻译成「是参数问题还是服务问题」，原文只进日志。
8. **回归风险为零的开关**：`local_ai.enabled` 默认 `false`，且 `Validate` 在开启时
   强制要求推理地址是**本机回环** —— 配错成公网地址会拒绝启动，而不是悄悄暴露端口。
9. **抠图模型的商业授权红线（三重保护）**：
   ① `config.Validate` 校验 `matting_model` 在白名单内（默认 `u2net`）；
   ② `localai.Client.RemoveBackground` 在模型名为空时**直接报错**，绝不回落到 rembg 默认的
   `bria-rmbg`（商业授权）；
   ③ 脚本侧 `rembg-remove.cjs` 也做白名单校验。实测确认：省略 `model` 字段时服务端会
   返回 200 并真的用上 `bria-rmbg` —— 所以这道保护是必需的。

## 5. 接线（**已完成**，此处保留说明供复核）

### 5.1 `internal/router/router.go`

`Deps` 新增两个字段：

```go
	// AI 是本地 AI 服务。为 nil 时 /api/v1/ai/* 整组不注册（单元测试场景）。
	//
	// 注意它和 Config.LocalAI.Enabled 是两件事：
	//   - AI == nil            → 路由不存在（404），用于测试或没装配队列；
	//   - AI != nil 但开关关闭 → 路由存在但全部返回 40028（可读的「功能没开」）。
	AI *service.AIService
	// Workflows 是 ComfyUI 工作流模板来源，由 server 装配（可为 nil）。
	Workflows localai.WorkflowStore
```

前台组（挂在 `/api/v1` 下、`/permissions` 之后）：

```go
		if aiHandler != nil {
			ai := v1.Group("/ai", middleware.Auth(deps.Tokens))
			{
				ai.GET("/status", aiHandler.NodeStatus)                  // 不限流：便宜且前端会频繁检查
				ai.POST("/uploads", middleware.RateLimit(20, time.Minute), aiHandler.UploadInput)
				ai.POST("/jobs",    middleware.RateLimit(10, time.Minute), aiHandler.Submit)
				ai.GET("/jobs", aiHandler.List)
				ai.GET("/jobs/:id", aiHandler.Get)
				ai.POST("/jobs/:id/cancel", aiHandler.Cancel)
			}
		}
```

后台组（`adm` 组内，挂在活跃监控之后）：

```go
			if aiAdminHandler != nil {
				localaiGroup := adm.Group("/localai",
					middleware.RequirePermission(model.PermLocalAIView))
				{
					localaiGroup.GET("/status", aiAdminHandler.Status)
					localaiGroup.GET("/jobs", aiAdminHandler.Jobs)
				}
			}
```

> 限流数字取 20/min（上传）与 10/min（提交）。6GB 显存下并发上限是 1，
> 再高只会把任务堆在队列里让用户白等 —— 超了会拿到 40029 与明确文案。
> **本模块不含任何价格 / Credits 数值。**

### 5.2 `internal/server/server.go`

```go
// Server 结构体
	aiQueue *localai.Queue
```

`New()` 里，在 `router.New` **之前**按这个顺序装配（有环，靠 `SetEnqueue` 解开）：

```go
	if cfg.LocalAI.Enabled {
		repos := repository.New(db)
		aiClient := service.NewAIClient(cfg.LocalAI)
		wfStore := localai.NewFileWorkflowStore(cfg.LocalAI.WorkflowDir)
		aiService = service.NewAIService(cfg.LocalAI, repos, store, aiClient, nil, nil)
		aiService.AttachExecutor(localai.NewExecutor(localaiConfigFrom(cfg.LocalAI), aiClient, wfStore))
		aiQueue = service.NewAIQueue(cfg.LocalAI, aiService)
		aiService.SetEnqueue(func(uint64) { aiQueue.Notify() })
	}
	// 关掉开关时 aiService 保持 nil → 路由整组不注册，
	// 连「探测推理节点」的网络调用都不会发生
```

启动与停止：

```go
// Run()：与 activity 并排（Start 必须在 Run，不能在 New）
	if s.aiQueue != nil {
		defer s.aiQueue.Stop()
		s.aiQueue.Start(ctx)
	}

// Close()：必须在 s.db 之前
	if s.aiQueue != nil {
		s.aiQueue.Stop()   // 先停队列：它正在跑的任务结束时还要写 ai_jobs
	}
```

**为什么协程不在 `router.New` 里启动**：`router.New` 会被每个 handler 测试调用，
在装配阶段起协程会留下泄漏的 goroutine，而 `go test` 无法优雅关闭它。

### 5.3 工作流模板

把 `repos/douwan-ai-node/workflows/local-ai/{cartoonize,txt2img}-api.json`
拷到 `douwan-api/workflows/local-ai/`（或用 `local_ai.workflow_dir` 指向节点仓库那份）。
`FileWorkflowStore` **每次任务时重新读盘**，所以改模板不需要重启服务。

### 5.4 配置文件

`configs/config.yaml` 与 `.env.example` 已补 `local_ai` 段落（16 个键）。
**每个键都必须在 `setDefaults` 里出现过** —— 这是 env 生效的硬性条件
（`v.AllKeys()` → `BindEnv` 只绑已知键，漏了会被静默忽略）。

生产（qq）**不要**在 `/etc/douwan/api.env` 里开 `DOUWAN_LOCAL_AI_ENABLED=true`，
直到明确批准上线。

## 6. 已知缺口（需要决策，本阶段刻意没做）

| # | 缺口 | 说明 |
| --- | --- | --- |
| 1 | **没有「AI 权益」硬校验** | `entitlement.Allow` 在仓库里零调用方。要接的话：`entService.EffectivePermissions(ctx, userID, now)` → 在 `internal/entitlement/entitlement.go` 加 `ai.*` 键 → `Allow` → `ErrForbidden`。**需要先定产品形态**（哪些套餐能用 AI） |
| 2 | **没有额度/Credits 扣减** | `repository/entitlement.go:ConsumeUsage` 现成可用（已防并发超扣）；Credits 扣减**完全没有实现**，需要新写事务方法。**这一步会引入价格语义，必须由产品定，不能由 AI 模块自己决定** |
| 3 | **输入图清理协程未实现** | `ai_uploads.expires_at` 已在写入、`AIUploadRepository.ListExpired` 已就绪，但还没有定时清理（24h 后会在 `uploads/ai/` 下堆积小文件）。建议照 `activity.cleanupLoop` 加一个 loop |
| 4 | **卡在 running 的僵尸任务** | `AIJobRepository.FailStale` 已实现并有单测覆盖，但还没有在启动时与定时任务里调用。建议在 worker `Start` 时先跑一次（进程被重启时留下的 running 任务否则会永远占着队列额度） |
| 5 | **集成级测试未写** | 目前 71 个测试覆盖了队列/模板/模型/服务准入与幂等，但**没有**「喂假推理服务走完提交→轮询→取回」的端到端测试。建议给 `localai.Client` 配 `httptest` 服务器补一轮 |
| 6 | **`docs/api.md` / `docs/admin.md` 未同步** | 7 个新接口 + 6 个错误码 + 2 个权限点还没写进仓库文档 |
| 7 | **前端未接入** | 阶段 E 内容 |

## 7. 并发冲突与数据损失说明（必须读）

**发生了什么**：`home` 上的 `~/Documents/work/dw/douwan-api` 当时有**另一条并发工作流**
正在实现「站点访问量 PV/UV」（新增 `internal/**/visit*.go` 与 `VisitReportPerMinute` 配置项），
而且**当时还没编译通过**（`router.go` 引用了 `config.Activity.VisitReportPerMinute`，
但该字段还没加进 `config.go`）。

我用 `scp` + `tar` 把本模块的整套改动覆盖过去，其中 **`internal/config/config.go` 被整体替换**，
**导致那条工作流加在这个文件里的 `VisitReportPerMinute` 等改动丢失**。

**已确认无法从 git 恢复**：`git stash list` 为空、`git reflog` 只有提交记录、
无 `*.orig` / `*.swp` 备份、`git fsck --lost-found` 无悬空对象 —— 因为那些改动**从未被 stage 或 commit 过**。

**我的补救**：
1. **立即停止写入团队工作树**，改为在**独立隔离副本**（`~/Documents/work/dw/douwan-ai-verify`，
   从干净提交 `dbf33ac` 导出）里编译与测试，编译通过才继续；
2. 本阶段所有产物**都留在工作区** `repos/douwan-ai-node/backend/`（见 §8），
   由你决定何时、以什么方式并入；
3. 本文档如实记录这次损失。

**需要你做的**：请让那条工作流**重新补回** `internal/config/config.go` 里的
`visit_report_per_minute`（以及 `configs/config.yaml` / `.env.example` 里的对应注释），
它们的 `router.go` / `visit*.go` 都还在，只缺这一个文件的内容。
**这次教训**：共享工作树上不要用「整文件覆盖」的方式同步改动，应改用
`git worktree` / `git stash` / 独立 clone，或至少先 `git diff` 确认对方未提交的改动。

## 8. 代码存放位置

本阶段产物的**权威副本在工作区**（不在任何 git 仓库里，等你决定归属）：

```
repos/douwan-ai-node/backend/
├── internal/localai/{client,queue,executor,workflow}.go
├── internal/model/{ai_job,migrate,admin}.go
├── internal/repository/{ai_job,ai_upload,repository}.go
├── internal/dto/ai.go
├── internal/service/ai.go
├── internal/handler/ai.go
├── internal/middleware/admin.go
├── internal/response/errors.go
├── internal/storage/storage.go
└── internal/config/config.go
```

目录结构与 `douwan-api` 仓库一一对应，**直接 `cp -r` 到仓库根即可**。

建议的并入方式（避免再次覆盖别人的改动）：

```bash
# 在 home 上，用独立分支，不动 master 工作树
cd ~/Documents/work/dw/douwan-api
git fetch origin
git worktree add ../douwan-api-ai -b feat/local-ai origin/master
# 把 worktree 里的 config.go 先按上面的教训检查一遍对方的改动是否已补回
cp -r /path/to/repos/douwan-ai-node/backend/. ../douwan-api-ai/
cd ../douwan-api-ai
go build ./... && go vet ./... && go test ./...
git add -A && git commit -m "feat(localai): 本地 AI 任务队列与推理接入（默认关闭）"
git push -u origin feat/local-ai
```

## 9. 上线前检查清单

- [ ] 团队工作树的 `config.go` 已补回 `visit_report_per_minute`，`go build ./...` 通过
- [ ] 路由与服务装配已按 §5 接好（含限流数字经产品确认）
- [ ] 工作流模板已放入 `workflows/local-ai/`（或设好 `DOUWAN_AI_WORKFLOW_DIR`）
- [ ] `go test ./...` 全绿（含新增的 AI 模块单测）
- [ ] `configs/config.yaml` / `.env.example` 已补 `local_ai:` 段
- [ ] `docs/api.md` 已补 7 个新接口 + 6 个新错误码
- [ ] `docs/admin.md` 已补 2 个后台接口与 2 个权限点
- [ ] 节点侧：`check-environment.ps1` 无阻塞项、`tunnel-status.ps1` 四层全绿
- [ ] 生产 `LOCAL_AI_ENABLED` 仍为 `false`（**上线开关由用户单独批准**）
- [ ] 验证「开关关闭时前端拿到 40028 且普通拼豆功能完全不受影响」
- [ ] 验证「推理节点不可达时接口返回 40030，不是 500，也不阻塞其它接口」

## 10. 回滚步骤

代码层面**天然可回滚**：默认开关 `false`，等于没上线。

```bash
# ① 只关功能（最快，不用回滚代码）
ssh qq 'sed -i "s/^DOUWAN_LOCAL_AI_ENABLED=.*/DOUWAN_LOCAL_AI_ENABLED=false/" /etc/douwan/api.env; systemctl restart douwan-api'
# 若 env 里本来没有这一行，直接追加 DOUWAN_LOCAL_AI_ENABLED=false 即可
# 关掉后所有 /api/v1/ai/* 返回 40028，队列不再执行任务

# ② 回滚代码（把 feat/local-ai 分支的提交撤掉）
cd ~/Documents/work/dw/douwan-api
git revert <commit>            # 或直接不合并那个分支
go test ./... && make build
# 按 DEPLOY.md 的流程重新发布

# ③ 回滚数据库（新表是纯新增，删掉不影响既有功能）
ssh qq 'sudo -u postgres psql -d douwan -c "DROP TABLE IF EXISTS ai_jobs; DROP TABLE IF EXISTS ai_uploads;"'
# ⚠ 会丢掉任务历史；产物文件在 /var/lib/douwan/uploads/ai/ 下，需要另外删

# ④ 停止本地 AI 节点与隧道
powershell -File <scripts>\stop-tunnel.ps1
powershell -File <scripts>\stop-local-ai.ps1
```

---

*本阶段交付完成。所有结论基于隔离副本上的真实编译与测试输出，未提交、未部署、线上未动。*
