package service

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime/multipart"
	"strings"
	"sync"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/localai"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/storage"
)

// aiUploadSubdir AI 任务的图片落在 uploads/ai/ 下。
// 必须在 storage 的子目录白名单里（已登记，见 internal/storage/storage.go）。
const aiUploadSubdir = "ai"

// aiUploadTTL 输入图的保留时长。用户从上传到点「开始生成」不会超过这个时间。
const aiUploadTTL = 24 * time.Hour

// AIService 本地 AI 任务的业务编排：校验 → 建任务 → 入队 → 查状态 → 取消。
//
// 它**不做推理**：推理由 localai.Worker 在后台协程里完成。
// 这样切分的理由：HTTP 请求只做「落库 + 通知」，最长几十毫秒，
// 不会被 nginx 的 60s proxy_read_timeout 掐断 —— 这是需求里的硬约束。
type AIService struct {
	cfg   config.LocalAI
	repos *repository.Repositories
	store *storage.Store
	// client 只用于探活与后台状态页；实际推理在 worker 里。
	client *localai.Client
	// enqueue 把任务号推进队列（由 localai.Worker 提供）。
	// 为 nil 表示没有启动队列（单元测试场景），此时任务只落库并保持 queued。
	enqueue func(jobID uint64)
	// audit 审计日志（可选）。
	audit *AuditLog
	// executor 执行推理（RunNext 用）。为 nil 表示队列未装配。
	executor *localai.Executor

	// 维护协程（过期输入图清理 + 卡死任务回收）的生命周期。
	// 与 activity.Recorder 用同一套纪律：WithCancel + WaitGroup + sync.Once。
	maintainCancel context.CancelFunc
	maintainWG     sync.WaitGroup
	maintainOnce   sync.Once
}

// NewAIService 构造服务。store 为 nil 时上传与产物落盘不可用（相关接口返回可读错误）。
func NewAIService(
	cfg config.LocalAI,
	repos *repository.Repositories,
	store *storage.Store,
	client *localai.Client,
	enqueue func(jobID uint64),
	audit *AuditLog,
) *AIService {
	return &AIService{cfg: cfg, repos: repos, store: store, client: client, enqueue: enqueue, audit: audit}
}

// SetEnqueue 回填「通知队列」的回调。
//
// 为什么要单独一个 setter：队列的构造依赖 service（RunNext 是它的方法），
// 而 service 又需要队列的 Notify 才能入队，形成环。
// 装配顺序是「先建 service → 再建 queue → 把 queue.Notify 回填给 service」，
// 这样两边都不需要拿到未初始化完的对象。
func (s *AIService) SetEnqueue(fn func(jobID uint64)) { s.enqueue = fn }

// Enabled 功能总开关。
func (s *AIService) Enabled() bool { return s.cfg.Enabled }

// ensureEnabled 所有对外入口的第一道闸。
// 关掉开关时返回 40028 而不是 404：让「功能做了但没开」与「接口不存在」可区分。
func (s *AIService) ensureEnabled() error {
	if !s.cfg.Enabled {
		return response.ErrAINotEnabled.WithMessage("本地 AI 功能尚未开启，如需使用请联系管理员")
	}
	return nil
}

/* ------------------------------------------------------------------ 参数 */

// aiKindParams 是规范化之后、真正写进 jsonb 的参数。
type aiKindParams struct {
	Prompt         string  `json:"prompt,omitempty"`
	NegativePrompt string  `json:"negative_prompt,omitempty"`
	Steps          int     `json:"steps,omitempty"`
	CFG            float64 `json:"cfg,omitempty"`
	Seed           int64   `json:"seed,omitempty"`
	Denoise        float64 `json:"denoise,omitempty"`
	Width          int     `json:"width,omitempty"`
	Height         int     `json:"height,omitempty"`
	AlphaMatting   bool    `json:"alpha_matting,omitempty"`
}

// normalizeParams 补默认值并做**跨字段**校验。
//
// 不放在 binding tag 里：有几条规则依赖其它字段（img2img 必须有输入图、
// 文生图必须给提示词、尺寸乘积受 max_pixels 限制），binding 表达不了。
func (s *AIService) normalizeParams(req *dto.AISubmitRequest) (*aiKindParams, error) {
	p := &aiKindParams{}
	switch req.Kind {
	case model.AIJobKindMatting:
		if req.InputAssetID == 0 {
			return nil, response.ErrInvalidParam.WithMessage("抠图需要先上传一张图片")
		}
		p.AlphaMatting = req.AlphaMatting
		return p, nil

	case model.AIJobKindCartoonize:
		if req.InputAssetID == 0 {
			return nil, response.ErrInvalidParam.WithMessage("卡通化需要先上传一张图片")
		}
		p.Prompt = strings.TrimSpace(req.Prompt)
		p.NegativePrompt = strings.TrimSpace(req.NegativePrompt)
		p.Steps = req.Steps
		p.CFG = req.CFG
		p.Seed = req.Seed
		p.Denoise = req.Denoise
		if p.Denoise == 0 {
			// 实测默认值：0.6 保形且能看出风格化（见阶段 B 测试报告 §4.1）
			p.Denoise = 0.6
		}
		return p, nil

	case model.AIJobKindText2Image:
		p.Prompt = strings.TrimSpace(req.Prompt)
		if p.Prompt == "" {
			return nil, response.ErrInvalidParam.WithMessage("请输入画面描述")
		}
		p.NegativePrompt = strings.TrimSpace(req.NegativePrompt)
		p.Steps = req.Steps
		p.CFG = req.CFG
		p.Seed = req.Seed
		p.Width = req.Width
		p.Height = req.Height
		if p.Width == 0 {
			p.Width = 512
		}
		if p.Height == 0 {
			p.Height = 512
		}
		// SD 的 VAE 下采样要求边长是 8 的倍数。向下取整而不是报错：
		// 对用户来说「648 变成 640」比「参数非法」友好得多。
		p.Width -= p.Width % 8
		p.Height -= p.Height % 8
		if p.Width < 256 || p.Height < 256 {
			return nil, response.ErrInvalidParam.WithMessage("图片尺寸最小 256×256")
		}
		if s.cfg.MaxPixels > 0 && p.Width*p.Height > s.cfg.MaxPixels {
			return nil, response.ErrInvalidParam.WithMessage(
				fmt.Sprintf("图片尺寸过大（%d×%d），当前上限约 %d 万像素", p.Width, p.Height, s.cfg.MaxPixels/10000))
		}
		return p, nil
	}
	return nil, response.ErrInvalidParam.WithMessage("不支持的任务类型")
}

/* ------------------------------------------------------------------ 上传 */

// UploadInput 保存用户上传的输入图，返回后续提交任务用的 asset id。
//
// 为什么单独一个「上传」接口而不是提交任务时一起带图：
// 提交接口要立刻返回 job_id（异步），同一请求里再塞几 MB 图片会拖长响应；
// 而且用户通常想先看到图再决定跑不跑。
//
// 隔离：文件由 storage 落到 uploads/ai/YYYY/MM/ 下（服务端生成文件名，丢弃原文件名），
// 真正的归属记录在 ai_uploads 表里；提交任务时按 (user_id, asset_id) 反查，
// 因此改 id 只会查不到，读不到别人的图。
func (s *AIService) UploadInput(ctx context.Context, userID uint64, fh *multipart.FileHeader) (*dto.AIUploadResult, error) {
	if err := s.ensureEnabled(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, response.ErrAIUnavailable.WithMessage("文件存储未就绪，暂时无法上传")
	}
	if userID == 0 {
		return nil, response.ErrUnauthorized
	}
	if fh == nil {
		return nil, response.ErrMissingParam.WithMessage("请选择要上传的图片")
	}
	saved, err := s.store.SaveUploaded(fh, aiUploadSubdir)
	if err != nil {
		return nil, err
	}
	// 输入图的像素上限比通用上传更严：推理节点的显存按像素数算，
	// 放进来一张 6000 万像素的图，节点会先 OOM 再告诉你失败。
	if s.cfg.MaxPixels > 0 && saved.Width*saved.Height > s.cfg.MaxPixels {
		s.store.Remove(saved.RelPath)
		return nil, response.ErrInvalidParam.WithMessage(
			fmt.Sprintf("图片分辨率过大（%d×%d），当前上限约 %d 万像素", saved.Width, saved.Height, s.cfg.MaxPixels/10000))
	}
	assetID, err := aiAssetID()
	if err != nil {
		s.store.Remove(saved.RelPath)
		return nil, response.ErrInternal.WithCause(err)
	}
	up := &model.AIUpload{
		UserID:    userID,
		AssetID:   assetID,
		RelPath:   saved.RelPath,
		URL:       saved.URL,
		Width:     saved.Width,
		Height:    saved.Height,
		Bytes:     saved.Size,
		MimeType:  saved.MimeType,
		ExpiresAt: time.Now().Add(aiUploadTTL),
	}
	if err := s.repos.AIUpload.Create(ctx, up); err != nil {
		// 落盘成功但登记失败：删掉文件，避免留下永远查不到的孤儿文件
		s.store.Remove(saved.RelPath)
		return nil, err
	}
	return &dto.AIUploadResult{
		AssetID: assetID,
		URL:     saved.URL,
		Width:   saved.Width,
		Height:  saved.Height,
		Bytes:   saved.Size,
	}, nil
}

/* ------------------------------------------------------------------ 提交 */

// Submit 校验并创建任务，然后通知 worker。
func (s *AIService) Submit(ctx context.Context, userID uint64, req dto.AISubmitRequest) (*dto.AIJobSubmitResult, error) {
	if err := s.ensureEnabled(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, response.ErrAIUnavailable.WithMessage("文件存储未就绪，暂时无法提交 AI 任务")
	}
	if userID == 0 {
		return nil, response.ErrUnauthorized
	}
	params, err := s.normalizeParams(&req)
	if err != nil {
		return nil, err
	}

	// ---------- 队列准入（都走便宜查询，不做磁盘/网络 IO）----------
	queued, running, err := s.repos.AIJob.CountActiveByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if int(running) >= s.cfg.MaxRunningPerUser {
		return nil, response.ErrAIQueueFull.WithMessage(
			fmt.Sprintf("你已有 %d 个任务正在执行，请等它完成后再提交", running))
	}
	if int(queued) >= s.cfg.MaxQueuedPerUser {
		return nil, response.ErrAIQueueFull.WithMessage(
			fmt.Sprintf("你最多同时排队 %d 个任务，请等前面的任务开始后再提交", s.cfg.MaxQueuedPerUser))
	}
	snap, err := s.repos.AIJob.Snapshot(ctx, time.Time{})
	if err != nil {
		return nil, err
	}
	if int(snap.Queued) >= s.cfg.QueueSize {
		return nil, response.ErrAIQueueFull.WithMessage("AI 任务排队已满，请稍后再试")
	}

	// ---------- 输入图 ----------
	var inputRelPath, inputURL string
	if req.InputAssetID != 0 {
		up, err := s.repos.AIUpload.FindByAsset(ctx, userID, req.InputAssetID)
		if err != nil {
			return nil, response.ErrInvalidParam.WithMessage("输入图片不存在或已过期，请重新上传")
		}
		if !up.ExpiresAt.IsZero() && time.Now().After(up.ExpiresAt) {
			return nil, response.ErrInvalidParam.WithMessage("输入图片已过期，请重新上传")
		}
		if _, err := s.store.Read(up.RelPath); err != nil {
			return nil, response.ErrInvalidParam.WithMessage("输入图片已被清理，请重新上传")
		}
		inputRelPath = up.RelPath
		inputURL = up.URL
	}

	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	job := &model.AIJob{
		UserID:         userID,
		Kind:           req.Kind,
		Status:         model.AIJobStatusQueued,
		IdempotencyKey: strings.TrimSpace(req.IdempotencyKey),
		InputRelPath:   inputRelPath,
		InputURL:       inputURL,
		Params:         paramsJSON,
	}
	created, err := s.repos.AIJob.Create(ctx, job)
	if err != nil {
		return nil, err
	}
	if created && s.enqueue != nil {
		s.enqueue(job.ID)
	}
	if created {
		slog.InfoContext(ctx, "本地 AI：任务已创建",
			"job_id", job.ID, "user_id", userID, "kind", job.Kind, "deduplicated", false)
	}
	item, err := s.toItem(ctx, job)
	if err != nil {
		return nil, err
	}
	return &dto.AIJobSubmitResult{Job: item, Deduplicated: !created}, nil
}

/* ------------------------------------------------------------------ 查询 */

// Get 查单个任务（前台，带越权保护）。
func (s *AIService) Get(ctx context.Context, userID, jobID uint64) (*dto.AIJobItem, error) {
	if err := s.ensureEnabled(); err != nil {
		return nil, err
	}
	job, err := s.repos.AIJob.FindByUserAndID(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	return s.toItem(ctx, job)
}

// List 列出当前用户的任务。
func (s *AIService) List(ctx context.Context, userID uint64, q dto.AIJobListQuery) (*dto.PageResult[dto.AIJobItem], error) {
	if err := s.ensureEnabled(); err != nil {
		return nil, err
	}
	q.Normalize()
	items, total, err := s.repos.AIJob.ListByUser(ctx, userID, q)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AIJobItem, 0, len(items))
	for i := range items {
		item, err := s.toItem(ctx, &items[i])
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return &dto.PageResult[dto.AIJobItem]{
		List: out, Total: total, Page: q.Page, PageSize: q.PageSize,
	}, nil
}

// Cancel 请求取消。
func (s *AIService) Cancel(ctx context.Context, userID, jobID uint64) (*dto.AIJobItem, error) {
	if err := s.ensureEnabled(); err != nil {
		return nil, err
	}
	// 先确认归属：否则 RequestCancel 的 RowsAffected=0 会被误判成「任务已结束」
	job, err := s.repos.AIJob.FindByUserAndID(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	if job.IsFinished() {
		return nil, response.ErrAIJobFinished
	}
	ok, err := s.repos.AIJob.RequestCancel(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, response.ErrAIJobFinished
	}
	updated, err := s.repos.AIJob.FindByUserAndID(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	return s.toItem(ctx, updated)
}

/* ------------------------------------------------------------------ 后台 */

// AdminList 后台任务列表（跨用户）。
func (s *AIService) AdminList(ctx context.Context, q dto.AIJobListQuery) (*dto.PageResult[dto.AIJobItem], error) {
	q.Normalize()
	items, total, err := s.repos.AIJob.ListAll(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AIJobItem, 0, len(items))
	for i := range items {
		item, err := s.toItem(ctx, &items[i])
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return &dto.PageResult[dto.AIJobItem]{
		List: out, Total: total, Page: q.Page, PageSize: q.PageSize,
	}, nil
}

// NodeStatus 探测推理节点状态。
//
// **即使开关关闭也会返回结构体**（只是 Enabled=false）：
// 后台页面需要能展示「功能没开」，而不是一个错误弹窗。
func (s *AIService) NodeStatus(ctx context.Context) *dto.AINodeStatus {
	st := &dto.AINodeStatus{
		Enabled:   s.cfg.Enabled,
		CheckedAt: time.Now(),
		Limits: dto.AILimits{
			QueueSize:         s.cfg.QueueSize,
			MaxRunning:        s.cfg.MaxRunning,
			MaxRunningPerUser: s.cfg.MaxRunningPerUser,
			MaxQueuedPerUser:  s.cfg.MaxQueuedPerUser,
			MaxUploadMB:       s.cfg.MaxUploadMB,
			MaxPixels:         s.cfg.MaxPixels,
			Checkpoint:        s.cfg.Checkpoint,
			MattingModel:      s.cfg.MattingModel,
			JobTimeoutSeconds: int(s.cfg.JobTimeout.Seconds()),
		},
	}
	if !s.cfg.Enabled {
		st.Message = "本地 AI 功能未开启（local_ai.enabled=false）"
		return st
	}
	if s.client == nil {
		st.Message = "推理客户端未初始化"
		return st
	}

	since := time.Now().Add(-24 * time.Hour)
	if snap, err := s.repos.AIJob.Snapshot(ctx, since); err == nil {
		st.Queue = &dto.AIQueueStats{
			Queued: snap.Queued, Running: snap.Running,
			Succeeded: snap.Succeeded, Failed: snap.Failed, Canceled: snap.Canceled,
		}
	}

	comfy, err := s.client.Stats(ctx)
	if err != nil {
		st.Message = "推理节点（ComfyUI）不可达，请检查 SSH 隧道与节点服务"
		slog.WarnContext(ctx, "本地 AI：ComfyUI 探活失败", "err", err)
		return st
	}
	st.ComfyVersion = comfy.Version
	st.Device = comfy.Device
	st.VRAMTotalMB = comfy.VRAMTotal / (1 << 20)
	st.VRAMFreeMB = comfy.VRAMFree / (1 << 20)

	routes, err := s.client.RembgStatus(ctx)
	if err != nil {
		st.Message = "抠图服务（rembg）不可达，请检查 SSH 隧道与节点服务"
		slog.WarnContext(ctx, "本地 AI：rembg 探活失败", "err", err)
		return st
	}
	st.RembgRoutes = routes
	st.Reachable = true
	if st.VRAMFreeMB > 0 && st.VRAMFreeMB < 2500 {
		st.Message = fmt.Sprintf(
			"显存紧张（空闲 %dMB）：高分辨率任务可能失败，建议关闭其它占用 GPU 的程序", st.VRAMFreeMB)
	}
	return st
}

/* ------------------------------------------------------------------ worker 回调 */

// InputBytes 读回输入图字节（worker 调用）。
func (s *AIService) InputBytes(relPath string) ([]byte, error) {
	if s.store == nil {
		return nil, response.ErrAIUnavailable.WithMessage("文件存储未就绪")
	}
	if relPath == "" {
		return nil, response.ErrInvalidParam.WithMessage("任务没有输入图")
	}
	return s.store.Read(relPath)
}

// SaveGeneratedImage 把推理产物落盘（worker 调用）。
func (s *AIService) SaveGeneratedImage(raw []byte) (*storage.SavedFile, error) {
	if s.store == nil {
		return nil, response.ErrAIUnavailable.WithMessage("文件存储未就绪")
	}
	// 产物上限比上传上限宽松一档（生成图常有几 MB），但要挡住异常大的响应体
	maxBytes := int64(s.cfg.MaxUploadMB) * 2 << 20
	return s.store.SaveGenerated(raw, aiUploadSubdir, maxBytes)
}

/* ------------------------------------------------------------------ 清理 */

// aiCleanupInterval 清理协程的运行间隔。过期输入图不急着删（24h TTL），
// 每小时扫一次足够；间隔太短只会白白查库。
const aiCleanupInterval = time.Hour

// aiStaleJobGrace 判定「卡死的 running 任务」的宽限期。
//
// 取 JobTimeout 的 2 倍再加 1 分钟：正常任务即使跑满超时也会被 jobCtx 收尾，
// 只有「进程在推理途中被重启/OOM」才会留下永远 running 的行。
// 留出足够宽限，避免误杀一个刚好在慢速边缘的正常任务。
func (s *AIService) aiStaleJobGrace() time.Duration {
	return 2*s.cfg.JobTimeout + time.Minute
}

// StartAIMaintenance 启动维护协程：启动时立刻跑一次，之后按间隔重复。
//
// 两件事，都是「不做就会慢慢坏掉」的：
//  1. **清回收过期的输入图**：AIUpload.ExpiresAt 是 24h，文件在 uploads/ai/ 下。
//     不清理就会一直堆积（每个用户每次 AI 调用都留一份）。
//  2. **把卡死的任务判失败**：进程在推理途中重启会留下永远 running 的记录，
//     它一直占着该用户的并发额度，用户会一直收到「你已有 1 个任务正在执行」却看不到任何进度。
//
// 生命周期照 activity.Recorder 的纪律：从进程 ctx 派生、select 等 ctx.Done()、
// 单次工作用独立 WithTimeout（不挂在 loopCtx 上，否则退出时会掐断清理写库）。
func (s *AIService) StartAIMaintenance(ctx context.Context) {
	if !s.cfg.Enabled {
		return
	}
	loopCtx, cancel := context.WithCancel(ctx)
	s.maintainCancel = cancel
	s.maintainWG.Add(1)
	go func() {
		defer s.maintainWG.Done()
		// 启动时先扫一次：进程重启后最需要立刻处理的就是这两类残留
		s.runMaintenance(loopCtx)
		ticker := time.NewTicker(aiCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-loopCtx.Done():
				return
			case <-ticker.C:
				s.runMaintenance(loopCtx)
			}
		}
	}()
	slog.Info("本地 AI：维护协程已启动（过期输入图清理 + 卡死任务回收）",
		"interval", aiCleanupInterval, "stale_grace", s.aiStaleJobGrace())
}

// StopAIMaintenance 停止维护协程。可重复调用（与 server 的 defer / Close 双调用对齐）。
func (s *AIService) StopAIMaintenance() {
	if s.maintainCancel == nil {
		return
	}
	s.maintainOnce.Do(func() { s.maintainCancel() })
	s.maintainWG.Wait()
}

// runMaintenance 跑一轮维护。任何一步失败都只记日志，不影响另一件（也不中断后续轮次）。
func (s *AIService) runMaintenance(ctx context.Context) {
	// 单次工作给一个独立的时间窗，避免一次慢查询拖住整个循环
	workCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	s.reapStaleJobs(workCtx)
	s.purgeExpiredUploads(workCtx)
}

// ReapForTest 暴露「回收卡死任务」给单测调用（生产路径是 StartAIMaintenance 的定时循环）。
func (s *AIService) ReapForTest(ctx context.Context) { s.reapStaleJobs(ctx) }

// PurgeForTest 暴露「清理过期输入图」给单测调用。
func (s *AIService) PurgeForTest(ctx context.Context) { s.purgeExpiredUploads(ctx) }

// reapStaleJobs 把卡在 running 超过宽限期的任务判失败，释放该用户的并发额度。
func (s *AIService) reapStaleJobs(ctx context.Context) {
	threshold := time.Now().Add(-s.aiStaleJobGrace())
	n, err := s.repos.AIJob.FailStale(ctx, threshold,
		int(response.CodeAIUnavailable),
		"任务在推理过程中被中断（服务重启或节点异常），请重新提交")
	if err != nil {
		slog.ErrorContext(ctx, "本地 AI：回收卡死任务失败", "err", err)
		return
	}
	if n > 0 {
		slog.WarnContext(ctx, "本地 AI：回收了卡在 running 的任务", "count", n)
	}
}

// purgeExpiredUploads 删除过期的输入图登记与磁盘文件。
//
// 先删库再删文件：库删成功而文件删失败只是留下一点垃圾（下次不会再被引用），
// 反过来「文件没了但记录还在」会让用户提交时拿到「图片已被清理」的困惑提示。
func (s *AIService) purgeExpiredUploads(ctx context.Context) {
	const batch = 200
	items, err := s.repos.AIUpload.ListExpired(ctx, time.Now(), batch)
	if err != nil {
		slog.ErrorContext(ctx, "本地 AI：查询过期输入图失败", "err", err)
		return
	}
	if len(items) == 0 {
		return
	}
	ids := make([]uint64, 0, len(items))
	for i := range items {
		ids = append(ids, items[i].ID)
	}
	if err := s.repos.AIUpload.DeleteByIDs(ctx, ids); err != nil {
		slog.ErrorContext(ctx, "本地 AI：删除过期输入图登记失败", "err", err)
		return
	}
	// 登记删掉了，文件再尽力删（Remove 本身「删不掉也不报错」）
	if s.store != nil {
		for i := range items {
			s.store.Remove(items[i].RelPath)
		}
	}
	slog.InfoContext(ctx, "本地 AI：已清理过期输入图", "count", len(items))
}

/* ------------------------------------------------------------------ worker */

// AttachExecutor 绑定执行器（由装配处调用，之后 RunNext 才可用）。
//
// 单独一个方法而不是构造参数：Executor 需要 localai.Client，而 Client 与
// AIService 是平级的依赖；让装配处按顺序 set 比在构造函数里塞六个参数更清楚。
func (s *AIService) AttachExecutor(exec *localai.Executor) { s.executor = exec }

// NewAIQueue 构造 AI 任务队列。
//
// 返回的 *localai.Queue 交给 server 在 Run 里 Start、在 Close 里 Stop；
// service 通过 RunNext 提供「抢一条并执行」的回调，再由装配处把
// queue.Notify 回填给 service.SetEnqueue（见 SetEnqueue 的说明）。
func NewAIQueue(cfg config.LocalAI, svc *AIService) *localai.Queue {
	return localai.NewQueue(localaiConfig(cfg), svc.RunNext)
}

// localaiConfig 把 config.LocalAI 映射成 localai.Config。
//
// 两个包各自独立（localai 不 import config，便于脱离配置单测），
// 这里是唯一的映射点：以后加字段只会在这一处编译报错，不会散落各处。
func localaiConfig(cfg config.LocalAI) localai.Config {
	return localai.Config{
		ComfyURL:      cfg.ComfyURL,
		RembgURL:      cfg.RembgURL,
		HealthTimeout: cfg.HealthTimeout,
		SubmitTimeout: cfg.SubmitTimeout,
		PollInterval:  cfg.PollInterval,
		JobTimeout:    cfg.JobTimeout,
		Checkpoint:    cfg.Checkpoint,
		MattingModel:  cfg.MattingModel,
	}
}

// NewAIClient 构造推理 HTTP 客户端（装配处用）。
func NewAIClient(cfg config.LocalAI) *localai.Client {
	return localai.New(localaiConfig(cfg))
}

// RunNext 抢一条排队任务并执行完（队列回调，由 localai.Queue 在后台协程调用）。
//
// 返回 claimed=false 表示当前没有可执行任务，队列会停下来等下一次唤醒。
func (s *AIService) RunNext(ctx context.Context) (bool, error) {
	if err := s.ensureEnabled(); err != nil {
		// 功能被关掉了：不要把队列里的任务捞出来执行，留着等开关打开
		return false, nil
	}
	if s.executor == nil {
		return false, errors.New("AI 执行器未初始化")
	}
	// 条件更新抢任务：只有仍处于 queued 的那一行会被改成 running，
	// 所以同一条任务不可能被执行两次（即使将来起了多个 worker）。
	job, err := s.repos.AIJob.ClaimNext(ctx)
	if err != nil {
		return false, err
	}
	if job == nil {
		return false, nil
	}
	return true, s.execute(ctx, job)
}

// execute 执行一条已抢到的任务，并把结果落库 + 落盘。
//
// 这里的错误处理有一条硬规矩：**任务失败绝不返回 error 给队列之外的人**。
// 具体地说，任何失败都会被翻译成「任务置 failed + 记可读原因」，
// 只有「连数据库都写不进去」这种基础设施级故障才往上抛。
// 原因是队列只认「claimed 与否」，一条业务失败不该影响后面的排队任务。
func (s *AIService) execute(ctx context.Context, job *model.AIJob) error {
	// 输入图（img2img / 抠图需要；文生图没有）
	var inputBytes []byte
	if job.InputRelPath != "" {
		raw, err := s.InputBytes(job.InputRelPath)
		if err != nil {
			return s.fail(ctx, job, err, "输入图片已不可用，请重新上传后再试")
		}
		inputBytes = raw
	}

	spec := localai.JobSpec{
		JobID:         job.ID,
		Kind:          job.Kind,
		Input:         inputBytes,
		InputFilename: inputFilenameFor(job),
		Params:        job.Params,
	}

	// 取消检查：队列在轮询间隙调它，让「用户点了取消」尽力而为地生效
	canceled := func(jobID uint64) bool {
		cur, err := s.repos.AIJob.FindByID(ctx, jobID)
		if err != nil {
			return false
		}
		return cur.CancelRequested
	}

	result, err := s.executor.Execute(ctx, spec, canceled)
	if err != nil {
		// 取消是「正常结束」而不是失败：落成 canceled，不占额度、不算错误率
		if errors.Is(err, localai.ErrCanceled) {
			if mErr := s.repos.AIJob.MarkCanceled(ctx, job.ID); mErr != nil {
				return mErr
			}
			slog.InfoContext(ctx, "本地 AI：任务已按用户请求取消", "job_id", job.ID)
			return nil
		}
		// 把上游错误翻译成用户能看懂的话。上游原文只进日志（response.Fail 的 WithCause 路径）。
		code, msg := translateAIError(err)
		slog.WarnContext(ctx, "本地 AI：任务失败",
			"job_id", job.ID, "kind", job.Kind, "provider_job_id", resultProviderID(result), "err", err)
		return s.failCode(ctx, job, code, msg)
	}

	if len(result.Image) == 0 {
		return s.failCode(ctx, job, int(response.CodeAIUnavailable), "推理没有返回图片，请稍后重试")
	}

	// 产物落盘（storage 会重新嗅探类型与尺寸，不信推理节点给的扩展名）
	saved, err := s.SaveGeneratedImage(result.Image)
	if err != nil {
		return s.fail(ctx, job, err, "生成结果保存失败，请稍后重试")
	}
	out := repository.AIJobOutput{
		RelPath: saved.RelPath,
		URL:     saved.URL,
		Width:   saved.Width,
		Height:  saved.Height,
		Bytes:   saved.Size,
	}
	if err := s.repos.AIJob.MarkSucceeded(ctx, job.ID, out); err != nil {
		return err
	}
	slog.InfoContext(ctx, "本地 AI：任务成功",
		"job_id", job.ID, "kind", job.Kind, "bytes", saved.Size,
		"width", saved.Width, "height", saved.Height)
	return nil
}

// fail 记一条「有内部原因」的失败：对外文案可读，内部原因进日志。
func (s *AIService) fail(ctx context.Context, job *model.AIJob, cause error, message string) error {
	slog.WarnContext(ctx, "本地 AI：任务失败", "job_id", job.ID, "kind", job.Kind, "err", cause)
	return s.failCode(ctx, job, int(response.CodeInternal), message)
}

// failCode 把任务置为 failed。写库失败才向上返回 error（基础设施故障）。
func (s *AIService) failCode(ctx context.Context, job *model.AIJob, code int, message string) error {
	if err := s.repos.AIJob.MarkFailed(ctx, job.ID, code, message); err != nil {
		return err
	}
	return nil
}

// translateAIError 把推理层的错误翻译成 (业务码, 用户可读文案)。
//
// 为什么不直接把上游报错透出去：ComfyUI 的报错里带节点 id 与 Python 堆栈，
// 对用户毫无意义，还泄露内部结构。用户只需要知道「是我的参数问题还是服务问题」。
func translateAIError(err error) (int, string) {
	switch {
	case errors.Is(err, localai.ErrUnavailable):
		return int(response.CodeAIUnavailable), "本地 AI 服务暂时不可用，请稍后重试"
	case errors.Is(err, localai.ErrRejected):
		return int(response.CodeAIRejected), "这次生成没能完成，可以换个描述或参数再试"
	case errors.Is(err, context.DeadlineExceeded):
		return int(response.CodeAIUnavailable), "任务超时，请稍后重试或降低图片尺寸"
	default:
		return int(response.CodeInternal), "生成失败，请稍后重试"
	}
}

func resultProviderID(r *localai.ExecuteResult) string {
	if r == nil {
		return ""
	}
	return r.ProviderJobID
}

// inputFilenameFor 给输入图编一个上传用的文件名。
//
// 名字只用于让 ComfyUI 认出扩展名，实际落盘名由节点生成（它会丢弃原名）。
// 这里按 PNG 交：storage 保存的输入图可能是 jpg，但推理节点只关心能否解码，
// 而 ComfyUI 的 LoadImage 会按内容识别；用 .png 是最保险的写法。
func inputFilenameFor(job *model.AIJob) string {
	return fmt.Sprintf("douwan-%d.png", job.ID)
}

/* ------------------------------------------------------------------ 内部 */

// toItem 把实体转成对外视图。
//
// queued 的任务顺带算「前面还有几个」：6GB 显存只跑 1 个任务，
// 用户盯着转圈时最想知道的就是这个数。
func (s *AIService) toItem(ctx context.Context, job *model.AIJob) (*dto.AIJobItem, error) {
	item := &dto.AIJobItem{
		ID:              job.ID,
		Kind:            job.Kind,
		KindCn:          model.AIJobKindLabel(job.Kind),
		Status:          job.Status,
		StatusCn:        model.AIJobStatusLabel(job.Status),
		InputURL:        job.InputURL,
		OutputURL:       job.OutputURL,
		OutputWidth:     job.OutputWidth,
		OutputHeight:    job.OutputHeight,
		OutputBytes:     job.OutputBytes,
		ErrorCode:       job.ErrorCode,
		ErrorMessage:    job.ErrorMessage,
		CreatedAt:       job.CreatedAt,
		StartedAt:       job.StartedAt,
		FinishedAt:      job.FinishedAt,
		DurationMS:      job.DurationMS(),
		CancelRequested: job.CancelRequested,
	}
	if len(job.Params) > 0 {
		var p map[string]any
		if err := json.Unmarshal(job.Params, &p); err == nil {
			item.Params = p
		}
	}
	if job.Status == model.AIJobStatusQueued {
		if ahead, err := s.repos.AIJob.CountQueuedAhead(ctx, job.ID); err == nil {
			item.QueuePosition = int(ahead) + 1
		}
	}
	return item, nil
}

// aiAssetID 生成一个不可猜测的资产号。
// 限制在 2^52 以内：前端 JS 的 Number 只有 53 位精度，超出会静默丢精度。
func aiAssetID() (uint64, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0, err
	}
	v := binary.BigEndian.Uint64(b[:])
	return v%(1<<52) + 1, nil
}
