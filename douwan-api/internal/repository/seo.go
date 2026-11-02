package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/model"
)

// SeoTaskRepository 搜索引擎推送任务表访问。
type SeoTaskRepository struct {
	db *gorm.DB
}

// Create 新建一条推送任务。
func (r *SeoTaskRepository) Create(ctx context.Context, t *model.SeoPushTask) error {
	return r.db.WithContext(ctx).Create(t).Error
}

// BulkCreate 批量建任务。
func (r *SeoTaskRepository) BulkCreate(ctx context.Context, list []model.SeoPushTask) error {
	if len(list) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).CreateInBatches(list, 50).Error
}

// UpdateFields 局部更新。
func (r *SeoTaskRepository) UpdateFields(ctx context.Context, id uint64, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Model(&model.SeoPushTask{}).Where("id = ?", id).Updates(fields).Error
}

// FindByID 按主键查任务。
func (r *SeoTaskRepository) FindByID(ctx context.Context, id uint64) (*model.SeoPushTask, error) {
	var t model.SeoPushTask
	if err := r.db.WithContext(ctx).First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// List 查询任务历史。
func (r *SeoTaskRepository) List(ctx context.Context, engine, status, keyword string, limit int) ([]model.SeoPushTask, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.SeoPushTask{})
	if engine != "" {
		query = query.Where("engine = ?", engine)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("url LIKE ? OR path LIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var list []model.SeoPushTask
	if err := query.Order("id DESC").Limit(limit).Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

// DueTasks 取到期的待执行任务。
func (r *SeoTaskRepository) DueTasks(ctx context.Context, engine string, now time.Time, limit int) ([]model.SeoPushTask, error) {
	if limit <= 0 {
		limit = 50
	}
	query := r.db.WithContext(ctx).Model(&model.SeoPushTask{}).
		Where("status = ?", model.SeoTaskPending).
		Where("next_run_at IS NULL OR next_run_at <= ?", now)
	if engine != "" {
		query = query.Where("engine = ?", engine)
	}
	var list []model.SeoPushTask
	if err := query.Order("id ASC").Limit(limit).Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// LastSuccessHash 查某个 URL 在某个引擎上最近一次成功推送的内容指纹。
//
// 用途：内容没变就不重复提交（百度配额有限，重复提交没有意义）。
func (r *SeoTaskRepository) LastSuccessHash(ctx context.Context, engine, path string) (string, bool, error) {
	var t model.SeoPushTask
	err := r.db.WithContext(ctx).Model(&model.SeoPushTask{}).
		Where("engine = ? AND path = ? AND status = ?", engine, path, model.SeoTaskSuccess).
		Order("id DESC").First(&t).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", false, nil
		}
		return "", false, err
	}
	return t.ContentHash, true, nil
}

// CountByStatus 统计各状态的任务数。
func (r *SeoTaskRepository) CountByStatus(ctx context.Context) (map[string]int64, error) {
	type row struct {
		Status string
		Total  int64
	}
	var rows []row
	if err := r.db.WithContext(ctx).Model(&model.SeoPushTask{}).
		Select("status, COUNT(*) AS total").Group("status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Status] = r.Total
	}
	return out, nil
}

// DeleteBefore 清理过期记录。
func (r *SeoTaskRepository) DeleteBefore(ctx context.Context, before time.Time) (int64, error) {
	res := r.db.WithContext(ctx).Unscoped().
		Where("created_at < ?", before).Delete(&model.SeoPushTask{})
	return res.RowsAffected, res.Error
}

// LatestPerPath 取每个路径最近的一条任务记录（用于「这个页面推送过没有」）。
func (r *SeoTaskRepository) LatestPerPath(ctx context.Context, engine string) (map[string]model.SeoPushTask, error) {
	var list []model.SeoPushTask
	query := r.db.WithContext(ctx).Model(&model.SeoPushTask{})
	if engine != "" {
		query = query.Where("engine = ?", engine)
	}
	if err := query.Order("id DESC").Limit(2000).Find(&list).Error; err != nil {
		return nil, err
	}
	out := make(map[string]model.SeoPushTask, len(list))
	for _, t := range list {
		if _, ok := out[t.Path]; !ok {
			out[t.Path] = t
		}
	}
	return out, nil
}
