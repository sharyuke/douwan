package dto

import "time"

/* ================================================================== 提交任务 */

// AISubmitRequest 是 POST /api/v1/ai/jobs 的请求体。
//
// 之所以把三种任务合成一个接口：它们的前端交互完全一样（选图/填词 → 等 → 拿结果），
// 拆成三个接口只会让前端多写两遍轮询逻辑。真正不同的参数放在 Kind 决定的分支里校验。
type AISubmitRequest struct {
	// Kind 任务类型：matting / cartoonize / text2image
	Kind string `json:"kind" binding:"required,oneof=matting cartoonize text2image"`

	// IdempotencyKey 幂等键。网络抖动导致前端重试时，带同一个 key 只会产生一条任务。
	// 前端建议用「页面会话 id + 时间戳」之类稳定串；留空表示不要求幂等。
	IdempotencyKey string `json:"idempotency_key" binding:"omitempty,max=64"`

	// --- img2img（matting / cartoonize）---
	// InputAssetID 已上传的输入图 id。前端先调 POST /api/v1/ai/uploads 拿到它。
	InputAssetID uint64 `json:"input_asset_id"`

	// --- 生成参数（cartoonize / text2image）---
	// Prompt 提示词。长度上限 800：SD 1.5 的 CLIP 只吃 77 token，
	// 再长会被静默截断，但截断位置对用户是黑盒，所以宁可提前拒绝。
	Prompt string `json:"prompt" binding:"omitempty,max=800"`
	// NegativePrompt 负向提示词。留空时服务端用模板默认值。
	NegativePrompt string `json:"negative_prompt" binding:"omitempty,max=800"`
	// Steps / CFG / Seed 采样参数。0 表示用模板默认值。
	Steps int    `json:"steps" binding:"omitempty,min=1,max=60"`
	CFG   float64 `json:"cfg" binding:"omitempty,min=1,max=20"`
	Seed  int64  `json:"seed" binding:"omitempty,min=0"`

	// Denoise 卡通化的重绘强度（0.1~1.0）。
	// 实测结论（RTX 2060 + SD 1.5 官方权重，见 docs/local-ai/test/阶段B-测试报告.md）：
	// ≤0.65 保形但风格化弱，≥0.75 风格强但主体会被改写。默认 0.6。
	Denoise float64 `json:"denoise" binding:"omitempty,min=0.1,max=1"`

	// Width / Height 文生图尺寸。必须是 8 的倍数（SD 的 VAE 下采样要求）。
	// 上限由 config.LocalAI 与工作流模板共同约束（6GB 显存建议 512）。
	Width  int `json:"width" binding:"omitempty,min=256,max=1024"`
	Height int `json:"height" binding:"omitempty,min=256,max=1024"`

	// AlphaMatting 抠图是否开启 alpha matting 边缘细化（人像/毛发更干净，稍慢）。
	AlphaMatting bool `json:"alpha_matting"`
}

/* ================================================================== 任务视图 */

// AIJobItem 是任务的对外视图。
//
// 刻意**不**返回 InputRelPath / OutputRelPath 这类服务端路径：
// 前端只需要 URL，暴露磁盘布局没有好处（也更容易被拿去拼路径）。
type AIJobItem struct {
	ID     uint64 `json:"id"`
	Kind   string `json:"kind"`
	KindCn string `json:"kind_cn"`
	Status string `json:"status"`
	// StatusCn 中文状态，避免前端各写一份映射。
	StatusCn string `json:"status_cn"`

	InputURL  string `json:"input_url,omitempty"`
	OutputURL string `json:"output_url,omitempty"`

	OutputWidth  int   `json:"output_width,omitempty"`
	OutputHeight int   `json:"output_height,omitempty"`
	OutputBytes  int64 `json:"output_bytes,omitempty"`

	Params map[string]any `json:"params,omitempty"`

	// QueuePosition 前面还有几个排队中的同类任务（仅 queued 时有值）。
	// 6GB 显存只跑 1 个任务，用户最想知道的就是「还要等几个」。
	QueuePosition int `json:"queue_position,omitempty"`

	ErrorCode    int    `json:"error_code,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`

	CreatedAt  time.Time  `json:"created_at"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	// DurationMS 已耗时（毫秒）。未开始为 0。
	DurationMS int64 `json:"duration_ms"`

	// CancelRequested 用户已请求取消，但 worker 还没收尾。
	CancelRequested bool `json:"cancel_requested,omitempty"`
}

// AIJobSubmitResult 是提交后的返回。前端拿 job_id 去轮询。
type AIJobSubmitResult struct {
	Job *AIJobItem `json:"job"`
	// Deduplicated 为 true 表示命中了幂等键，返回的是已存在的任务。
	Deduplicated bool `json:"deduplicated"`
}

/* ================================================================== 上传 */

// AIUploadResult 是上传输入图的结果。
type AIUploadResult struct {
	// AssetID 后续提交任务时用这个 id 引用输入图。
	AssetID uint64 `json:"asset_id"`
	URL     string `json:"url"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Bytes   int64  `json:"bytes"`
}

/* ================================================================== 列表 */

// AIJobListQuery 任务列表查询（前台 / 后台共用）。
type AIJobListQuery struct {
	PageQuery
	// Status 为空表示不过滤。取值见 model.AIJobStatus*。
	Status string `form:"status"`
	// Kind 为空表示不过滤。取值见 model.AIJobKind*。
	Kind string `form:"kind"`
	// UserID 仅后台使用：只看某个用户的任务。
	UserID uint64 `form:"user_id"`
}

/* ================================================================== 节点状态 */

// AINodeStatus 是本地 AI 节点的运行状态（后台状态页 / 前台可用性探测）。
type AINodeStatus struct {
	// Enabled 配置开关。false 时其它字段无意义。
	Enabled bool `json:"enabled"`
	// Reachable 推理服务是否可达（隧道是否通）。
	Reachable bool `json:"reachable"`
	// ComfyVersion / Device / VRAM 来自 /system_stats。
	ComfyVersion string `json:"comfy_version,omitempty"`
	Device       string `json:"device,omitempty"`
	VRAMTotalMB  int64  `json:"vram_total_mb,omitempty"`
	VRAMFreeMB   int64  `json:"vram_free_mb,omitempty"`
	// RembgRoutes 抠图服务暴露的路由（证明依赖链正常，也便于核对契约没被升级改掉）。
	RembgRoutes []string `json:"rembg_routes,omitempty"`

	// Queue 队列实时情况。
	Queue *AIQueueStats `json:"queue,omitempty"`

	// Limits 当前生效的上限，后台展示用（运营据此判断要不要调配置）。
	Limits AILimits `json:"limits"`

	// Message 不可用时的中文原因（直接展示给运营）。
	Message string `json:"message,omitempty"`
	// CheckedAt 探测时刻。
	CheckedAt time.Time `json:"checked_at"`
}

// AIQueueStats 各状态任务数。
//
// 刻意在 dto 里单独定义一份，而不是直接复用 repository.QueueSnapshot：
// repository 包已经 import dto（列表查询类型），dto 再反向 import 会形成循环依赖。
type AIQueueStats struct {
	Queued    int64 `json:"queued"`
	Running   int64 `json:"running"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Canceled  int64 `json:"canceled"`
}

// AILimits 当前生效的 AI 配额与限制。
type AILimits struct {
	QueueSize         int    `json:"queue_size"`
	MaxRunning        int    `json:"max_running"`
	MaxRunningPerUser int    `json:"max_running_per_user"`
	MaxQueuedPerUser  int    `json:"max_queued_per_user"`
	MaxUploadMB       int    `json:"max_upload_mb"`
	MaxPixels         int    `json:"max_pixels"`
	Checkpoint        string `json:"checkpoint"`
	MattingModel      string `json:"matting_model"`
	JobTimeoutSeconds int    `json:"job_timeout_seconds"`
}
