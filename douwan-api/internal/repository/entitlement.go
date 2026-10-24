package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// EntitlementRepository 用户权益表访问。
type EntitlementRepository struct {
	db *gorm.DB
}

// Create 新建权益记录。
func (r *EntitlementRepository) Create(ctx context.Context, e *model.Entitlement) error {
	if err := r.db.WithContext(ctx).Create(e).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByID 按主键查。
func (r *EntitlementRepository) FindByID(ctx context.Context, id uint64) (*model.Entitlement, error) {
	var e model.Entitlement
	if err := r.db.WithContext(ctx).First(&e, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrEntitlementNotFound)
	}
	return &e, nil
}

// FindActiveByUser 查某个用户当前有效的权益（按到期时间正序，不设时长的排最后）。
func (r *EntitlementRepository) FindActiveByUser(ctx context.Context, userID uint64, now time.Time) ([]model.Entitlement, error) {
	var list []model.Entitlement
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, model.EntitlementStatusActive).
		Where("starts_at <= ?", now).
		Where("expires_at IS NULL OR expires_at > ?", now).
		Order("expires_at IS NULL, expires_at DESC").Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// List 分页查询权益 / 兑换记录。
func (r *EntitlementRepository) List(ctx context.Context, q dto.EntitlementListQuery) ([]model.Entitlement, int64, error) {
	query := r.applyFilter(r.db.WithContext(ctx).Model(&model.Entitlement{}), q)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var list []model.Entitlement
	err := query.Order("id DESC").Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// ListRecent 最近若干条兑换 / 发放记录，供概览页使用。
func (r *EntitlementRepository) ListRecent(ctx context.Context, limit int) ([]model.Entitlement, error) {
	if limit <= 0 {
		limit = 5
	}
	var list []model.Entitlement
	err := r.db.WithContext(ctx).Order("id DESC").Limit(limit).Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// CountByUser 统计某个用户的权益条数（含历史）。
func (r *EntitlementRepository) CountByUser(ctx context.Context, userID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Entitlement{}).
		Where("user_id = ?", userID).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// CountRedeemedSince 统计某时刻之后由卡密兑换产生的权益数（今日兑换数）。
func (r *EntitlementRepository) CountRedeemedSince(ctx context.Context, since time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Entitlement{}).
		Where("source_type = ? AND created_at >= ?", model.EntitlementSourceCard, since).
		Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// Revoke 撤销一条权益。
func (r *EntitlementRepository) Revoke(ctx context.Context, id uint64, adminID uint64, reason string, now time.Time) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Entitlement{}).
		Where("id = ?", id).
		Where("status = ?", model.EntitlementStatusActive).
		Updates(map[string]any{
			"status":      model.EntitlementStatusRevoked,
			"revoked_by":  adminID,
			"revoked_at":  now,
			"revoke_note": reason,
			"updated_at":  now,
		})
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

// ConsumeUsage 扣一次额度。
//
// 条件里带 usage_limit，保证不会把不限量权益的 usage_used 乱加，
// 也不会超扣。返回是否扣成功。
func (r *EntitlementRepository) ConsumeUsage(ctx context.Context, id uint64, amount int) (bool, error) {
	if amount <= 0 {
		amount = 1
	}
	res := r.db.WithContext(ctx).Model(&model.Entitlement{}).
		Where("id = ?", id).
		Where("usage_limit IS NOT NULL AND usage_used + ? <= usage_limit", amount).
		Updates(map[string]any{
			"usage_used": gorm.Expr("usage_used + ?", amount),
			"updated_at": time.Now(),
		})
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

// ExpireOverdue 把到期的有效权益刷成已过期。
// 与卡密的 MarkExpired 一样，只是让后台列表的状态列与现实一致。
func (r *EntitlementRepository) ExpireOverdue(ctx context.Context, now time.Time) (int64, error) {
	res := r.db.WithContext(ctx).Model(&model.Entitlement{}).
		Where("status = ?", model.EntitlementStatusActive).
		Where("expires_at IS NOT NULL AND expires_at <= ?", now).
		Updates(map[string]any{"status": model.EntitlementStatusExpired, "updated_at": now})
	if res.Error != nil {
		return 0, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected, nil
}

// DeleteBySource 删除某条来源对应的权益。仅用于「发卡失败时回滚」这类场景，
// 正常业务不调用它。
func (r *EntitlementRepository) DeleteBySource(ctx context.Context, sourceType string, sourceID uint64) error {
	err := r.db.WithContext(ctx).
		Where("source_type = ? AND source_id = ?", sourceType, sourceID).
		Delete(&model.Entitlement{}).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

func (r *EntitlementRepository) applyFilter(query *gorm.DB, q dto.EntitlementListQuery) *gorm.DB {
	if q.UserID > 0 {
		query = query.Where("user_id = ?", q.UserID)
	}
	if q.PlanID > 0 {
		query = query.Where("plan_id = ?", q.PlanID)
	}
	if q.PlanCode != "" {
		query = query.Where("plan_code = ?", q.PlanCode)
	}
	if q.SourceType != "" {
		query = query.Where("source_type = ?", q.SourceType)
	}
	if q.Status != "" {
		query = query.Where("status = ?", q.Status)
	}
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("user_account LIKE ? OR plan_name LIKE ? OR source_no LIKE ?", like, like, like)
	}
	if from, ok := parseDayStart(q.From); ok {
		query = query.Where("created_at >= ?", from)
	}
	if to, ok := parseDayEnd(q.To); ok {
		query = query.Where("created_at <= ?", to)
	}
	return query
}
