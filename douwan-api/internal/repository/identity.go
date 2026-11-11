package repository

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// IdentityRepository 第三方登录身份表访问。
type IdentityRepository struct {
	db *gorm.DB
}

// FindByProvider 按 provider + openid 查身份。查不到返回 (nil, nil)：
// OAuth 首次登录是正常路径，不该当成「资源不存在」错误。
func (r *IdentityRepository) FindByProvider(ctx context.Context, provider, openID string) (*model.UserIdentity, error) {
	var row model.UserIdentity
	err := r.db.WithContext(ctx).
		Where("provider = ? AND provider_open_id = ?", provider, openID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &row, nil
}

// ListByUser 一个账号绑定的全部登录方式。
func (r *IdentityRepository) ListByUser(ctx context.Context, userID uint64) ([]model.UserIdentity, error) {
	var rows []model.UserIdentity
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("id ASC").Find(&rows).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// ListByUserIDs 后台批量拼装「登录方式」列。
func (r *IdentityRepository) ListByUserIDs(ctx context.Context, userIDs []uint64) ([]model.UserIdentity, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	var rows []model.UserIdentity
	if err := r.db.WithContext(ctx).
		Where("user_id IN ?", userIDs).
		Order("user_id ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// Create 新建绑定。唯一索引冲突说明这个第三方身份已经绑过账号。
func (r *IdentityRepository) Create(ctx context.Context, row *model.UserIdentity) error {
	err := r.db.WithContext(ctx).Create(row).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return response.ErrIdentityBound
	}
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// TouchLogin 更新第三方资料的展示值与最近登录时间。
func (r *IdentityRepository) TouchLogin(ctx context.Context, id uint64, nickname, avatar string, at time.Time) error {
	fields := map[string]any{"last_login_at": at}
	if nickname != "" {
		fields["nickname"] = nickname
	}
	if avatar != "" {
		fields["avatar_url"] = avatar
	}
	if err := r.db.WithContext(ctx).Model(&model.UserIdentity{}).
		Where("id = ?", id).Updates(fields).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// Delete 解绑。带 user_id 条件，避免越权删别人的身份。
//
// 这里必须硬删除：唯一索引 (provider, provider_open_id) 不区分软删除，
// 软删除会让解绑过的 QQ 永远无法再次绑定（插入时撞唯一键，查询又看不到旧行）。
func (r *IdentityRepository) Delete(ctx context.Context, id, userID uint64) error {
	res := r.db.WithContext(ctx).
		Unscoped().
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&model.UserIdentity{})
	if res.Error != nil {
		return response.ErrInternal.WithCause(res.Error)
	}
	if res.RowsAffected == 0 {
		return response.ErrIdentityNotFound
	}
	return nil
}

// CountByUser 账号当前有几种登录方式（密码 + 第三方）。
func (r *IdentityRepository) CountByUser(ctx context.Context, userID uint64) (int64, error) {
	var n int64
	if err := r.db.WithContext(ctx).Model(&model.UserIdentity{}).
		Where("user_id = ?", userID).Count(&n).Error; err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return n, nil
}
