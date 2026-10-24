package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// AdminRepository 管理员表访问。
type AdminRepository struct {
	db *gorm.DB
}

// Create 新建管理员。唯一索引冲突转成 ErrAdminExists。
func (r *AdminRepository) Create(ctx context.Context, a *model.Admin) error {
	err := r.db.WithContext(ctx).Create(a).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return response.ErrAdminExists
	}
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByID 按主键查管理员。
func (r *AdminRepository) FindByID(ctx context.Context, id uint64) (*model.Admin, error) {
	var a model.Admin
	if err := r.db.WithContext(ctx).First(&a, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrAdminNotFound)
	}
	return &a, nil
}

// FindByUsername 按用户名查管理员，供登录使用。
func (r *AdminRepository) FindByUsername(ctx context.Context, username string) (*model.Admin, error) {
	var a model.Admin
	err := r.db.WithContext(ctx).Where("username = ?", strings.TrimSpace(username)).First(&a).Error
	if err != nil {
		// 与前台登录一致：账号不存在与密码错误返回同一个错误，避免枚举账号
		return nil, wrapNotFound(err, response.ErrPasswordWrong)
	}
	return &a, nil
}

// ExistsByUsername 判断用户名是否已被占用。
func (r *AdminRepository) ExistsByUsername(ctx context.Context, username string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Admin{}).
		Where("username = ?", strings.TrimSpace(username)).Count(&count).Error
	if err != nil {
		return false, response.ErrInternal.WithCause(err)
	}
	return count > 0, nil
}

// UpdateFields 局部更新。调用方保证 fields 里没有密码哈希之外的敏感字段。
func (r *AdminRepository) UpdateFields(ctx context.Context, id uint64, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	err := r.db.WithContext(ctx).Model(&model.Admin{}).Where("id = ?", id).Updates(fields).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// UpdatePassword 改密码。
func (r *AdminRepository) UpdatePassword(ctx context.Context, id uint64, hash string) error {
	return r.UpdateFields(ctx, id, map[string]any{"password_hash": hash})
}

// TouchLogin 记录登录时间与 IP。失败不该拦住登录，调用方可以忽略错误。
func (r *AdminRepository) TouchLogin(ctx context.Context, id uint64, at time.Time, ip string) error {
	return r.db.WithContext(ctx).Model(&model.Admin{}).
		Where("id = ?", id).
		Updates(map[string]any{"last_login_at": at, "last_login_ip": ip}).Error
}

// Delete 软删除管理员。
func (r *AdminRepository) Delete(ctx context.Context, id uint64) error {
	err := r.db.WithContext(ctx).Delete(&model.Admin{}, id).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// CountActiveSuper 统计还有几个可用的超级管理员。
// 用于阻止「把最后一个超管停用/降权」，否则就没人能进后台了。
func (r *AdminRepository) CountActiveSuper(ctx context.Context, excludeID uint64) (int64, error) {
	q := r.db.WithContext(ctx).Model(&model.Admin{}).
		Where("role = ? AND status = ?", model.AdminRoleSuper, model.AdminStatusActive)
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// List 管理员列表。
func (r *AdminRepository) List(ctx context.Context, q dto.AdminListQuery) ([]model.Admin, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.Admin{})
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("username LIKE ? OR nickname LIKE ?", like, like)
	}
	if q.Role != "" {
		query = query.Where("role = ?", q.Role)
	}
	if q.Status != nil {
		query = query.Where("status = ?", *q.Status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var list []model.Admin
	err := query.Order("id ASC").Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}
