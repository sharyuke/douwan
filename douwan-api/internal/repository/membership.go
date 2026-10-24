package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// MembershipRepository 会员订阅表访问。
type MembershipRepository struct {
	db *gorm.DB
}

// Upsert 写入或更新订阅，注册时用来给新用户建免费套餐。
func (r *MembershipRepository) Upsert(ctx context.Context, m *model.Membership) error {
	err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"plan", "expire_at", "started_at", "auto_renew", "source", "updated_at"}),
		}).
		Create(m).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByUserID 查订阅。没有记录时返回 (nil, nil)：调用方按免费套餐处理。
func (r *MembershipRepository) FindByUserID(ctx context.Context, userID uint64) (*model.Membership, error) {
	var m model.Membership
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &m, nil
}

// CreditRepository AI Credits 账户表访问。
type CreditRepository struct {
	db *gorm.DB
}

// EnsureAccount 保证账户存在，已存在则不动余额。
func (r *CreditRepository) EnsureAccount(ctx context.Context, userID uint64) error {
	acc := model.CreditAccount{UserID: userID}
	err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&acc).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindAccount 查 Credits 账户，不存在返回 (nil, nil)。
func (r *CreditRepository) FindAccount(ctx context.Context, userID uint64) (*model.CreditAccount, error) {
	var acc model.CreditAccount
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&acc).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &acc, nil
}

// CreateTransaction 写一条 Credits 流水。
func (r *CreditRepository) CreateTransaction(ctx context.Context, tx *model.CreditTransaction) error {
	if err := r.db.WithContext(ctx).Create(tx).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// UsageRepository 使用统计表访问。
type UsageRepository struct {
	db *gorm.DB
}

// Ensure 保证统计行存在。
func (r *UsageRepository) Ensure(ctx context.Context, userID uint64) error {
	stat := model.UsageStat{UserID: userID}
	err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&stat).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// Find 查统计，不存在返回 (nil, nil)。
func (r *UsageRepository) Find(ctx context.Context, userID uint64) (*model.UsageStat, error) {
	var stat model.UsageStat
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&stat).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &stat, nil
}
