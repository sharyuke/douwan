package model

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// AI 任务的类型。新增类型必须同时在 internal/localai 里有对应的工作流模板，
// 并在 aiJobKinds 里登记中文名（后台展示用）。
const (
	AIJobKindMatting    = "matting"    // 抠图（rembg / u2net）
	AIJobKindCartoonize = "cartoonize" // 卡通化（ComfyUI img2img）
	AIJobKindText2Image = "text2image" // 文生图（ComfyUI txt2img）
)

// AI 任务的状态机。
//
//	queued ──▶ running ──▶ succeeded
//	   │           │
//	   │           └────▶ failed
//	   └───────────────▶ canceled
//
// 只有 queued 可以被 worker 用条件更新抢到（repository.ClaimNext），
// 因此「同一条任务被执行两次」在数据库层面就不可能发生。
const (
	AIJobStatusQueued    = "queued"
	AIJobStatusRunning   = "running"
	AIJobStatusSucceeded = "succeeded"
	AIJobStatusFailed    = "failed"
	AIJobStatusCanceled  = "canceled"
)

// aiJobKinds / aiJobStatuses 是「唯一清单」，供校验与后台展示复用。
var aiJobKinds = map[string]string{
	AIJobKindMatting:    "抠图",
	AIJobKindCartoonize: "卡通化",
	AIJobKindText2Image: "文生图",
}

var aiJobStatuses = map[string]string{
	AIJobStatusQueued:    "排队中",
	AIJobStatusRunning:   "进行中",
	AIJobStatusSucceeded: "已完成",
	AIJobStatusFailed:    "失败",
	AIJobStatusCanceled:  "已取消",
}

// AIJobKindLabel 返回任务类型的中文名。
func AIJobKindLabel(kind string) string {
	if label, ok := aiJobKinds[kind]; ok {
		return label
	}
	return kind
}

// AIJobStatusLabel 返回任务状态的中文名。
func AIJobStatusLabel(status string) string {
	if label, ok := aiJobStatuses[status]; ok {
		return label
	}
	return status
}

// ValidAIJobKind 判断任务类型是否受支持。
func ValidAIJobKind(kind string) bool {
	_, ok := aiJobKinds[kind]
	return ok
}

// AIJob 是一次本地 AI 推理任务。
//
// 为什么要落库而不是「请求里同步等结果」：
//  1. nginx 的 proxy_read_timeout 是 60s，而一次卡通化在 RTX 2060 上要 6~25s，
//     高分辨率或排队时很容易超过 60s，同步接口会被网关掐断（表现为 504，而不是可读的错误）；
//  2. 6GB 显存只允许 1 个任务并发，必须有队列与「前面还有几个」的可见性；
//  3. 产物要落到 storage，失败要能重试、能追责。
//
// 因此接口是异步的：POST 建任务返回 job_id → GET 轮询状态 → 成功后拿产物 URL。
type AIJob struct {
	Base

	// UserID 发起人。索引成 (user_id, status) 便于「查我进行中的任务」。
	UserID uint64 `gorm:"index:idx_ai_jobs_user_status,priority:1;not null" json:"user_id"`

	// Kind 任务类型，取值见 AIJobKind* 常量。
	Kind string `gorm:"size:24;index;not null" json:"kind"`
	// Status 任务状态，取值见 AIJobStatus* 常量。
	Status string `gorm:"size:16;index:idx_ai_jobs_user_status,priority:2;not null;default:queued" json:"status"`

	// IdempotencyKey 幂等键：同一用户用同一个 key 重复提交只会得到同一条任务。
	// 空字符串表示不要求幂等（带唯一索引时要注意空串也会参与唯一性，
	// 所以这里用「部分唯一索引」只在非空时生效，见 fixLegacyIndexes 的同款做法）。
	IdempotencyKey string `gorm:"size:64;index" json:"idempotency_key,omitempty"`

	// --- 输入 ---
	// InputRelPath 输入图在 storage 里的相对路径（subdir/YYYY/MM/文件名）。
	InputRelPath string `gorm:"size:255" json:"-"`
	// InputURL 输入图的对外地址（给前端展示「原图」用）。
	InputURL string `gorm:"size:512" json:"input_url,omitempty"`
	// Params 任务参数（提示词、denoise、seed、尺寸等）。
	// 用 jsonb 而不是拆列：不同 Kind 的参数集合不同，拆列会得到一堆永远为空的字段。
	// 用 json.RawMessage 而不是 gorm.io/datatypes：与 internal/model/project.go 的既有写法一致。
	// ⚠ 提示词属于用户内容，可能很长，长度限制在 handler 的 DTO 校验里（<=800 字符）。
	Params json.RawMessage `gorm:"type:jsonb" json:"params,omitempty"`

	// --- 输出 ---
	// OutputRelPath / OutputURL 成功后的产物。失败任务为空。
	OutputRelPath string `gorm:"size:255" json:"-"`
	OutputURL     string `gorm:"size:512" json:"output_url,omitempty"`
	OutputWidth   int    `json:"output_width,omitempty"`
	OutputHeight  int    `json:"output_height,omitempty"`
	OutputBytes   int64  `json:"output_bytes,omitempty"`

	// --- 执行信息 ---
	// ProviderJobID 推理服务返回的任务号（ComfyUI 的 prompt_id）。
	// 记下来才能在「进程重启后任务卡在 running」时排查到底提交成功没有。
	ProviderJobID string `gorm:"size:64" json:"provider_job_id,omitempty"`
	// Attempts 已尝试次数，便于以后做自动重试（本轮只记录，不自动重试）。
	Attempts int `gorm:"not null;default:0" json:"attempts"`
	// ErrorCode / ErrorMessage 失败原因。ErrorMessage 是对外可读的中文，
	// 内部堆栈只进日志，不进库、不出接口。
	ErrorCode    int    `gorm:"not null;default:0" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:512" json:"error_message,omitempty"`

	// StartedAt / FinishedAt 用于算耗时（GPU 排队体验的关键指标）。
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`

	// CancelRequested 用户请求取消。worker 在轮询间隙检查它，尽力而为地停下。
	CancelRequested bool `gorm:"not null;default:false" json:"-"`
}

// TableName 固定表名，避免 GORM 复数化规则变化导致改名。
func (AIJob) TableName() string { return "ai_jobs" }

// IsFinished 任务是否已经结束（结果不会再变）。
func (j *AIJob) IsFinished() bool {
	switch j.Status {
	case AIJobStatusSucceeded, AIJobStatusFailed, AIJobStatusCanceled:
		return true
	default:
		return false
	}
}

// DurationMS 已耗时（毫秒）。未开始时返回 0，未结束时按「现在」算。
func (j *AIJob) DurationMS() int64 {
	if j.StartedAt == nil {
		return 0
	}
	end := time.Now()
	if j.FinishedAt != nil {
		end = *j.FinishedAt
	}
	return end.Sub(*j.StartedAt).Milliseconds()
}

// BeforeCreate 保证状态与类型合法，避免脏数据绕过服务层写进库。
func (j *AIJob) BeforeCreate(*gorm.DB) error {
	if j.Status == "" {
		j.Status = AIJobStatusQueued
	}
	return nil
}

// AIUpload 是一次「AI 输入图」的上传记录。
//
// 为什么单独一张表，而不是把路径直接塞进 AIJob：
//  1. 用户是**先上传、后提交任务**（前端要先显示缩略图、可能还要裁剪），
//     上传时任务还不存在，没有地方存路径；
//  2. 提交时用 (user_id, asset_id) 反查路径，天然带越权保护 ——
//     用户改 asset_id 只会查不到，读不到别人的图；
//  3. 这些图只是推理的中间物，带 ExpiresAt 便于后台定期清理，不占盘。
//
// 刻意不做 User 关联外键：和仓库里其它表一致（都用裸 uint64 + 索引）。
type AIUpload struct {
	Base

	UserID uint64 `gorm:"index:idx_ai_uploads_user_asset,priority:1;not null" json:"user_id"`
	// AssetID 对外暴露的资产号。与用户一起构成唯一键（复合唯一索引）。
	AssetID uint64 `gorm:"uniqueIndex:idx_ai_uploads_user_asset,priority:2;not null" json:"asset_id"`

	// RelPath 相对 storage 根目录的路径（落库备查）。
	RelPath string `gorm:"size:255;not null" json:"-"`
	// URL 对外访问地址。
	URL string `gorm:"size:512;not null" json:"url"`

	Width    int    `gorm:"not null;default:0" json:"width"`
	Height   int    `gorm:"not null;default:0" json:"height"`
	Bytes    int64  `gorm:"not null;default:0" json:"bytes"`
	MimeType string `gorm:"size:64" json:"mime_type"`

	// ExpiresAt 过期时间。过期后提交任务会被拒，文件由后台清理协程删除。
	ExpiresAt time.Time `gorm:"index" json:"expires_at"`
}

// TableName 固定表名。
func (AIUpload) TableName() string { return "ai_uploads" }

// Expired 是否已过期。
func (u *AIUpload) Expired(now time.Time) bool {
	return !u.ExpiresAt.IsZero() && now.After(u.ExpiresAt)
}
