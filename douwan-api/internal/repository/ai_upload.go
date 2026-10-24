package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// AIUploadRepository 是 AI 输入图的登记表访问。
type AIUploadRepository struct {
	db *gorm.DB
}

// Create 登记一次上传。
func (r *AIUploadRepository) Create(ctx context.Context, up *model.AIUpload) error {
	if err := r.db.WithContext(ctx).Create(up).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByAsset 按 (用户, 资产号) 查。
//
// 必须带 user_id 条件：否则换个 asset_id 就能拿到别人的输入图路径（越权读取）。
func (r *AIUploadRepository) FindByAsset(ctx context.Context, userID, assetID uint64) (*model.AIUpload, error) {
	var up model.AIUpload
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND asset_id = ?", userID, assetID).
		First(&up).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, response.ErrNotFound.WithMessage("输入图片不存在或已过期")
		}
		return nil, response.ErrInternal.WithCause(err)
	}
	return &up, nil
}

// ListExpired 取已过期的登记（后台清理协程用）。limit 限制单批大小。
func (r *AIUploadRepository) ListExpired(ctx context.Context, now time.Time, limit int) ([]model.AIUpload, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var items []model.AIUpload
	if err := r.db.WithContext(ctx).
		Where("expires_at <> ? AND expires_at < ?", time.Time{}, now).
		Order("id asc").Limit(limit).Find(&items).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return items, nil
}

// DeleteByIDs 删除登记行（文件由 service 层删）。
func (r *AIUploadRepository) DeleteByIDs(ctx context.Context, ids []uint64) error {
	if len(ids) == 0 {
		return nil
	}
	// 显式硬删除：这些是中间物，不需要软删除留痕（软删会一直占着唯一索引）
	if err := r.db.WithContext(ctx).Unscoped().
		Where("id IN ?", ids).Delete(&model.AIUpload{}).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}
