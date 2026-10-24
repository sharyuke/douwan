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

// UserRepository 用户表访问。
type UserRepository struct {
	db *gorm.DB
}

// Create 新建用户。唯一索引冲突会转成 ErrUserExists。
func (r *UserRepository) Create(ctx context.Context, u *model.User) error {
	err := r.db.WithContext(ctx).Create(u).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return response.ErrUserExists
	}
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByID 按主键查用户。
func (r *UserRepository) FindByID(ctx context.Context, id uint64) (*model.User, error) {
	var u model.User
	if err := r.db.WithContext(ctx).First(&u, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrUserNotFound)
	}
	return &u, nil
}

// FindByAccount 按用户名 / 邮箱 / 手机号查用户，供登录使用。
// 三个字段都有唯一索引，命中即可。
func (r *UserRepository) FindByAccount(ctx context.Context, account string) (*model.User, error) {
	var u model.User
	err := r.db.WithContext(ctx).
		Where("username = ? OR email = ? OR phone = ?", account, account, account).
		First(&u).Error
	if err != nil {
		return nil, wrapNotFound(err, response.ErrPasswordWrong)
	}
	return &u, nil
}

// FindByIDs 批量按主键查用户，供列表页拼装用户名。
func (r *UserRepository) FindByIDs(ctx context.Context, ids []uint64) ([]model.User, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var users []model.User
	if err := r.db.WithContext(ctx).Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return users, nil
}

// ExistsByField 判断某个唯一字段是否已被占用。
func (r *UserRepository) ExistsByField(ctx context.Context, field, value string) (bool, error) {
	if value == "" {
		return false, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where(field+" = ?", value).Count(&count).Error
	if err != nil {
		return false, response.ErrInternal.WithCause(err)
	}
	return count > 0, nil
}

// UpdateFields 局部更新用户字段。
func (r *UserRepository) UpdateFields(ctx context.Context, id uint64, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	err := r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Updates(fields).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// TouchLastLogin 记录登录时间。失败不影响登录流程，由调用方决定是否忽略。
func (r *UserRepository) TouchLastLogin(ctx context.Context, id uint64, at time.Time) error {
	return r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", id).Update("last_login_at", at).Error
}

// AdminUserRow 是用户列表需要的一行聚合数据。
// 不含密码哈希等敏感字段（需求 §9：不要求管理员看到不必要的敏感信息）。
type AdminUserRow struct {
	model.User
	PlanCode      string
	ExpireAt      *time.Time
	AutoRenew     bool
	CreditBalance int
	OrderCount    int64
	PaidAmount    float64
	RedeemedCount int64
}

// ListAdmin 后台用户列表（带筛选与分页）。
func (r *UserRepository) ListAdmin(ctx context.Context, q dto.AdminUserListQuery) ([]AdminUserRow, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.User{})
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("username LIKE ? OR nickname LIKE ? OR email LIKE ? OR phone LIKE ?",
			like, like, like, like)
	}
	if q.Status != nil {
		query = query.Where("status = ?", *q.Status)
	}
	if from, ok := parseDayStart(q.From); ok {
		query = query.Where("created_at >= ?", from)
	}
	if to, ok := parseDayEnd(q.To); ok {
		query = query.Where("created_at <= ?", to)
	}
	if q.HasPro != nil {
		// 会员信息在另一张表，用子查询表达「有没有有效付费套餐」
		sub := r.db.WithContext(ctx).Model(&model.Membership{}).
			Select("user_id").
			Where("plan <> ? AND plan <> ''", model.PlanFree).
			Where("expire_at IS NULL OR expire_at > ?", time.Now())
		if *q.HasPro {
			query = query.Where("id IN (?)", sub)
		} else {
			query = query.Where("id NOT IN (?)", sub)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var users []model.User
	err := query.Order("id DESC").Offset(q.Offset()).Limit(q.Limit()).Find(&users).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	if len(users) == 0 {
		return nil, total, nil
	}

	ids := make([]uint64, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}

	rows := make([]AdminUserRow, 0, len(users))
	index := make(map[uint64]int, len(users))
	for _, u := range users {
		index[u.ID] = len(rows)
		rows = append(rows, AdminUserRow{User: u})
	}

	// 会员
	var memberships []model.Membership
	if err := r.db.WithContext(ctx).Where("user_id IN ?", ids).Find(&memberships).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	for _, m := range memberships {
		if i, ok := index[m.UserID]; ok {
			rows[i].PlanCode = m.Plan
			rows[i].ExpireAt = m.ExpireAt
			rows[i].AutoRenew = m.AutoRenew
		}
	}

	// Credits
	var accounts []model.CreditAccount
	if err := r.db.WithContext(ctx).Where("user_id IN ?", ids).Find(&accounts).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	for _, a := range accounts {
		if i, ok := index[a.UserID]; ok {
			rows[i].CreditBalance = a.Balance
		}
	}

	// 订单数 / 已支付金额
	type orderAgg struct {
		UserID     uint64
		Total      int64
		PaidAmount float64
	}
	var orderRows []orderAgg
	err = r.db.WithContext(ctx).Model(&model.Order{}).
		Select(`user_id, COUNT(*) AS total,
		        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN amount_paid ELSE 0 END), 0) AS paid_amount`).
		Where("user_id IN ?", ids).Group("user_id").Scan(&orderRows).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	for _, o := range orderRows {
		if i, ok := index[o.UserID]; ok {
			rows[i].OrderCount = o.Total
			rows[i].PaidAmount = o.PaidAmount
		}
	}

	// 兑换次数（卡密来源的权益条数）
	type entAgg struct {
		UserID uint64
		Total  int64
	}
	var entRows []entAgg
	err = r.db.WithContext(ctx).Model(&model.Entitlement{}).
		Select("user_id, COUNT(*) AS total").
		Where("user_id IN ? AND source_type = ?", ids, model.EntitlementSourceCard).
		Group("user_id").Scan(&entRows).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	for _, e := range entRows {
		if i, ok := index[e.UserID]; ok {
			rows[i].RedeemedCount = e.Total
		}
	}

	return rows, total, nil
}

// CountUsers 用户总数，供概览页使用。
func (r *UserRepository) CountUsers(ctx context.Context) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&model.User{}).Count(&count).Error; err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// CountCreatedSince 统计某时刻之后注册的用户数（今日新增）。
func (r *UserRepository) CountCreatedSince(ctx context.Context, since time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where("created_at >= ?", since).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}
