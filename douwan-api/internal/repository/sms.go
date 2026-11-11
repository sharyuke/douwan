package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// SmsCodeRepository 短信验证码表访问。
type SmsCodeRepository struct {
	db *gorm.DB
}

// Create 落一条新验证码。
func (r *SmsCodeRepository) Create(ctx context.Context, code *model.SmsCode) error {
	if err := r.db.WithContext(ctx).Create(code).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindLatestActive 取手机号最新一条未使用、未过期的验证码。
// 没有返回 (nil, nil)：调用方把它当作「验证码不存在或已过期」。
func (r *SmsCodeRepository) FindLatestActive(ctx context.Context, phone string, now time.Time) (*model.SmsCode, error) {
	var code model.SmsCode
	err := r.db.WithContext(ctx).
		Where("phone = ? AND used_at IS NULL AND expires_at > ?", phone, now).
		Order("id DESC").First(&code).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, response.ErrInternal.WithCause(err)
	}
	return &code, nil
}

// CountRecentByPhone 统计手机号在某时刻之后的发码次数（频控与日限额）。
func (r *SmsCodeRepository) CountRecentByPhone(ctx context.Context, phone string, since time.Time) (int64, error) {
	return r.countSince(ctx, "phone = ?", phone, since)
}

// CountRecentByIP 统计来源 IP 在某时刻之后的发码次数（防单 IP 刷量）。
func (r *SmsCodeRepository) CountRecentByIP(ctx context.Context, ip string, since time.Time) (int64, error) {
	return r.countSince(ctx, "ip = ?", ip, since)
}

func (r *SmsCodeRepository) countSince(ctx context.Context, cond, value string, since time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.SmsCode{}).
		Where(cond+" AND created_at >= ?", value, since).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// MarkUsed 把验证码标记为已使用。
func (r *SmsCodeRepository) MarkUsed(ctx context.Context, id uint64, at time.Time) error {
	err := r.db.WithContext(ctx).Model(&model.SmsCode{}).
		Where("id = ?", id).Update("used_at", at).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// IncrementAttempts 记一次错误尝试，达到上限后该条验证码作废。
func (r *SmsCodeRepository) IncrementAttempts(ctx context.Context, id uint64) error {
	err := r.db.WithContext(ctx).Model(&model.SmsCode{}).
		Where("id = ?", id).UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// DeleteBefore 硬删某时刻之前的旧验证码（发码时顺手清理，表不会越长越大）。
func (r *SmsCodeRepository) DeleteBefore(ctx context.Context, before time.Time) error {
	err := r.db.WithContext(ctx).
		Where("created_at < ?", before).Delete(&model.SmsCode{}).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}
