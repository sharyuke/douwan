package repository

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// AIJobRepository 是本地 AI 任务表的读写入口。
//
// 队列语义靠**条件更新**而不是内存锁实现：ClaimNext 只会把「当前仍是 queued」
// 的那一行改成 running，所以即使将来起了多个 worker（或多个进程），
// 同一条任务也不可能被抢到两次。这与订单发卡的 ClaimFulfillment 是同一个套路。
type AIJobRepository struct {
	db *gorm.DB
}

/* ------------------------------------------------------------------ 写入侧 */

// Create 建一条任务。
//
// 幂等：同一用户带同一个非空 idempotency_key 重复提交时，第二次会命中唯一索引，
// 这里捕获后返回已存在的那条，而不是报错。返回的 created=false 表示「命中已有任务」。
func (r *AIJobRepository) Create(ctx context.Context, job *model.AIJob) (created bool, err error) {
	res := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(job)
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	if res.RowsAffected == 1 {
		return true, nil
	}
	// 冲突：说明幂等键已存在，把已有那条读出来还给调用方
	existing, findErr := r.FindByIdempotencyKey(ctx, job.UserID, job.IdempotencyKey)
	if findErr != nil {
		return false, findErr
	}
	*job = *existing
	return false, nil
}

// ClaimNext 抢占下一条排队中的任务（FIFO）。
//
// 返回 (nil, nil) 表示当前没有可执行的任务（不是错误）。
// SQLite 不支持 SKIP LOCKED，用「先查 id 再带状态条件更新」两步实现：
// 第二步的 WHERE status='queued' 才是真正的并发保护。
func (r *AIJobRepository) ClaimNext(ctx context.Context) (*model.AIJob, error) {
	var candidate model.AIJob
	// 先挑一条 queued（按创建时间，先进先出）
	err := r.db.WithContext(ctx).
		Where("status = ?", model.AIJobStatusQueued).
		Order("id asc").
		First(&candidate).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, response.ErrInternal.WithCause(err)
	}

	now := time.Now()
	res := r.db.WithContext(ctx).Model(&model.AIJob{}).
		Where("id = ? AND status = ?", candidate.ID, model.AIJobStatusQueued).
		Updates(map[string]any{
			"status":     model.AIJobStatusRunning,
			"started_at": now,
			"attempts":   gorm.Expr("attempts + 1"),
			"updated_at": now,
		})
	if res.Error != nil {
		return nil, response.ErrInternal.WithCause(res.Error)
	}
	if res.RowsAffected != 1 {
		// 被别人抢走了：不是错误，下次循环再看
		return nil, nil
	}
	return r.FindByID(ctx, candidate.ID)
}

// MarkRunning 记录推理服务返回的任务号（ComfyUI 的 prompt_id）。
// 单独一个方法是因为「拿到 prompt_id」发生在任务已经 running 之后，
// 而排查线上问题时这个号是唯一能和推理节点日志对上的线索。
func (r *AIJobRepository) MarkRunning(ctx context.Context, id uint64, providerJobID string) error {
	updates := map[string]any{"updated_at": time.Now()}
	if providerJobID != "" {
		updates["provider_job_id"] = providerJobID
	}
	if err := r.db.WithContext(ctx).Model(&model.AIJob{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// MarkSucceeded 标记成功并写入产物信息。
func (r *AIJobRepository) MarkSucceeded(ctx context.Context, id uint64, out AIJobOutput) error {
	now := time.Now()
	updates := map[string]any{
		"status":          model.AIJobStatusSucceeded,
		"output_rel_path": out.RelPath,
		"output_url":      out.URL,
		"output_width":    out.Width,
		"output_height":   out.Height,
		"output_bytes":    out.Bytes,
		"error_code":      0,
		"error_message":   "",
		"finished_at":     now,
		"updated_at":      now,
	}
	// 只更新仍在 running 的行：任务若已被用户取消，成功结果也不该覆盖 canceled 状态。
	res := r.db.WithContext(ctx).Model(&model.AIJob{}).
		Where("id = ? AND status = ?", id, model.AIJobStatusRunning).
		Updates(updates)
	if res.Error != nil {
		return response.ErrInternal.WithCause(res.Error)
	}
	return nil
}

// AIJobOutput 产物信息（由 service 从 storage.SavedFile 转换而来）。
type AIJobOutput struct {
	RelPath string
	URL     string
	Width   int
	Height  int
	Bytes   int64
}

// MarkFailed 标记失败。errorMessage 必须是对外可读的中文，不含内部堆栈。
func (r *AIJobRepository) MarkFailed(ctx context.Context, id uint64, code int, errorMessage string) error {
	now := time.Now()
	if err := r.db.WithContext(ctx).Model(&model.AIJob{}).
		Where("id = ? AND status IN ?", id, []string{model.AIJobStatusQueued, model.AIJobStatusRunning}).
		Updates(map[string]any{
			"status":        model.AIJobStatusFailed,
			"error_code":    code,
			"error_message": errorMessage,
			"finished_at":   now,
			"updated_at":    now,
		}).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// RequestCancel 请求取消。只对未结束的任务生效。
// 返回 false 表示任务已结束（调用方应回 ErrAIJobFinished）。
func (r *AIJobRepository) RequestCancel(ctx context.Context, userID, id uint64) (bool, error) {
	now := time.Now()
	res := r.db.WithContext(ctx).Model(&model.AIJob{}).
		Where("id = ? AND user_id = ? AND status IN ?", id, userID,
			[]string{model.AIJobStatusQueued, model.AIJobStatusRunning}).
		Updates(map[string]any{
			// queued 的任务没有 worker 在跑，直接落到 canceled；
			// running 的只能打标记，由 worker 在轮询间隙看到后自己收尾。
			"status":           gorm.Expr("CASE WHEN status = ? THEN ? ELSE status END", model.AIJobStatusQueued, model.AIJobStatusCanceled),
			"cancel_requested": true,
			"finished_at":      gorm.Expr("CASE WHEN status = ? THEN ? ELSE finished_at END", model.AIJobStatusQueued, now),
			"updated_at":       now,
		})
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

// MarkCanceled 把一条 running 的任务收尾成 canceled（worker 发现取消标记后调用）。
func (r *AIJobRepository) MarkCanceled(ctx context.Context, id uint64) error {
	now := time.Now()
	if err := r.db.WithContext(ctx).Model(&model.AIJob{}).
		Where("id = ? AND status = ?", id, model.AIJobStatusRunning).
		Updates(map[string]any{
			"status":      model.AIJobStatusCanceled,
			"finished_at": now,
			"updated_at":  now,
		}).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FailStale 把「卡在 running 太久」的任务判失败。
//
// 场景：进程在推理途中被重启（发布、OOM），任务永远停在 running，
// 队列额度也不会释放。启动时与后台定时各跑一次，把它们清理掉。
func (r *AIJobRepository) FailStale(ctx context.Context, olderThan time.Time, code int, msg string) (int64, error) {
	now := time.Now()
	res := r.db.WithContext(ctx).Model(&model.AIJob{}).
		Where("status = ? AND started_at IS NOT NULL AND started_at < ?", model.AIJobStatusRunning, olderThan).
		Updates(map[string]any{
			"status":        model.AIJobStatusFailed,
			"error_code":    code,
			"error_message": msg,
			"finished_at":   now,
			"updated_at":    now,
		})
	if res.Error != nil {
		return 0, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected, nil
}

/* ------------------------------------------------------------------ 读取侧 */

// FindByID 按主键读一条。
func (r *AIJobRepository) FindByID(ctx context.Context, id uint64) (*model.AIJob, error) {
	var job model.AIJob
	if err := r.db.WithContext(ctx).First(&job, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, response.ErrNotFound.WithMessage("AI 任务不存在")
		}
		return nil, response.ErrInternal.WithCause(err)
	}
	return &job, nil
}

// FindByUserAndID 按「用户 + 主键」读一条。
//
// 前台查任务必须带 user_id 条件，否则换个 id 就能看到别人的任务
// （越权读取，比越权操作更容易被漏掉）。
func (r *AIJobRepository) FindByUserAndID(ctx context.Context, userID, id uint64) (*model.AIJob, error) {
	var job model.AIJob
	if err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&job).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// 刻意不区分「不存在」与「不属于你」：避免探测他人任务是否存在
			return nil, response.ErrNotFound.WithMessage("AI 任务不存在")
		}
		return nil, response.ErrInternal.WithCause(err)
	}
	return &job, nil
}

// FindByIdempotencyKey 按幂等键找已有任务。
func (r *AIJobRepository) FindByIdempotencyKey(ctx context.Context, userID uint64, key string) (*model.AIJob, error) {
	if key == "" {
		return nil, response.ErrNotFound.WithMessage("AI 任务不存在")
	}
	var job model.AIJob
	if err := r.db.WithContext(ctx).Where("user_id = ? AND idempotency_key = ?", userID, key).First(&job).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, response.ErrNotFound.WithMessage("AI 任务不存在")
		}
		return nil, response.ErrInternal.WithCause(err)
	}
	return &job, nil
}

// ListByUser 列出某个用户的任务。q.Status 为空表示不过滤状态。
func (r *AIJobRepository) ListByUser(ctx context.Context, userID uint64, q dto.AIJobListQuery) ([]model.AIJob, int64, error) {
	q.Normalize()
	base := r.db.WithContext(ctx).Model(&model.AIJob{}).Where("user_id = ?", userID)
	if q.Status != "" {
		base = base.Where("status = ?", q.Status)
	}
	if q.Kind != "" {
		base = base.Where("kind = ?", q.Kind)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	var items []model.AIJob
	if err := base.Order("id desc").Offset(q.Offset()).Limit(q.Limit()).Find(&items).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return items, total, nil
}

// ListAll 后台任务列表（跨用户）。q.Keyword 匹配用户名/任务号，交给 service 传条件。
func (r *AIJobRepository) ListAll(ctx context.Context, q dto.AIJobListQuery) ([]model.AIJob, int64, error) {
	q.Normalize()
	base := r.db.WithContext(ctx).Model(&model.AIJob{})
	if q.Status != "" {
		base = base.Where("status = ?", q.Status)
	}
	if q.Kind != "" {
		base = base.Where("kind = ?", q.Kind)
	}
	if q.UserID != 0 {
		base = base.Where("user_id = ?", q.UserID)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	var items []model.AIJob
	if err := base.Order("id desc").Offset(q.Offset()).Limit(q.Limit()).Find(&items).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return items, total, nil
}

// QueueSnapshot 队列实时快照（后台状态页用）。
type QueueSnapshot struct {
	Queued    int64 `json:"queued"`
	Running   int64 `json:"running"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Canceled  int64 `json:"canceled"`
}

// Snapshot 统计各状态的任务数。since 限制成功/失败只统计近期（当天）。
func (r *AIJobRepository) Snapshot(ctx context.Context, since time.Time) (*QueueSnapshot, error) {
	snap := &QueueSnapshot{}
	counts := []struct {
		status string
		target *int64
		recent bool
	}{
		{model.AIJobStatusQueued, &snap.Queued, false},
		{model.AIJobStatusRunning, &snap.Running, false},
		{model.AIJobStatusSucceeded, &snap.Succeeded, true},
		{model.AIJobStatusFailed, &snap.Failed, true},
		{model.AIJobStatusCanceled, &snap.Canceled, true},
	}
	for _, c := range counts {
		q := r.db.WithContext(ctx).Model(&model.AIJob{}).Where("status = ?", c.status)
		if c.recent && !since.IsZero() {
			q = q.Where("created_at >= ?", since)
		}
		if err := q.Count(c.target).Error; err != nil {
			return nil, response.ErrInternal.WithCause(err)
		}
	}
	return snap, nil
}

// CountActiveByUser 统计某用户「排队中 + 进行中」的任务数。
//
// 用于两件事：限制单用户并发（max_running_per_user）与排队数（max_queued_per_user）。
// 刻意返回两个数而不是一个总数：两者的上限不同，混在一起就没法分别判定。
func (r *AIJobRepository) CountActiveByUser(ctx context.Context, userID uint64) (queued int64, running int64, err error) {
	type row struct {
		Status string
		N      int64
	}
	var rows []row
	if err = r.db.WithContext(ctx).Model(&model.AIJob{}).
		Select("status, count(*) as n").
		Where("user_id = ? AND status IN ?", userID,
			[]string{model.AIJobStatusQueued, model.AIJobStatusRunning}).
		Group("status").Scan(&rows).Error; err != nil {
		return 0, 0, response.ErrInternal.WithCause(err)
	}
	for _, x := range rows {
		switch x.Status {
		case model.AIJobStatusQueued:
			queued = x.N
		case model.AIJobStatusRunning:
			running = x.N
		}
	}
	return queued, running, nil
}

// CountQueuedAhead 统计「排在指定任务前面的排队任务数」。
//
// 用于给用户展示「前面还有几个」：6GB 显存一次只跑 1 条任务，
// 用户盯着转圈时最想知道的就是这个数（比一个纯粹的 spinner 有用得多）。
func (r *AIJobRepository) CountQueuedAhead(ctx context.Context, jobID uint64) (int64, error) {
	var n int64
	if err := r.db.WithContext(ctx).Model(&model.AIJob{}).
		Where("status = ? AND id < ?", model.AIJobStatusQueued, jobID).
		Count(&n).Error; err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return n, nil
}

// ListRecentByKind 取某类任务最近 n 条（后台看「最近跑的几张图」）。
func (r *AIJobRepository) ListRecentByKind(ctx context.Context, kind string, limit int) ([]model.AIJob, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	var items []model.AIJob
	q := r.db.WithContext(ctx).Model(&model.AIJob{})
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	if err := q.Order("id desc").Limit(limit).Find(&items).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return items, nil
}
