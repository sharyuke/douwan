package repository

import (
	"context"
	"sort"
	"strings"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// OperationLogRepository 后台操作日志表访问。
type OperationLogRepository struct {
	db *gorm.DB
}

// Create 写一条日志。
//
// 日志写失败不应该让业务失败（素材已经上传成功了，日志没写不该报错回滚），
// 所以调用方通常忽略这里的错误，只打一条 warn。
func (r *OperationLogRepository) Create(ctx context.Context, log *model.OperationLog) error {
	if err := r.db.WithContext(ctx).Create(log).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// List 分页查询日志。
func (r *OperationLogRepository) List(ctx context.Context, q dto.OperationLogQuery) ([]model.OperationLog, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.OperationLog{})
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("admin_name LIKE ? OR target_name LIKE ? OR details LIKE ?", like, like, like)
	}
	if q.Action != "" {
		query = query.Where("action = ?", q.Action)
	}
	if q.Result != "" {
		query = query.Where("result = ?", q.Result)
	}
	if q.AdminID > 0 {
		query = query.Where("admin_id = ?", q.AdminID)
	}
	if q.TargetType != "" {
		query = query.Where("target_type = ?", q.TargetType)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var list []model.OperationLog
	err := query.Order("id DESC").Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// ActionOptions 列出日志里出现过的动作类型，供筛选下拉使用。
func (r *OperationLogRepository) ActionOptions(ctx context.Context) ([]string, error) {
	var actions []string
	err := r.db.WithContext(ctx).Model(&model.OperationLog{}).
		Distinct().Order("action ASC").Pluck("action", &actions).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return actions, nil
}

// SettingRepository 系统设置表访问。
type SettingRepository struct {
	db *gorm.DB
}

// EnsureDefaults 幂等地补齐设置项：只插入数据库里还不存在的键。
// 这样新增设置项时不用写迁移，重启即生效，也不会覆盖管理员改过的值。
func (r *SettingRepository) EnsureDefaults(ctx context.Context, items []model.Setting) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	keys := make([]string, 0, len(items))
	for _, it := range items {
		keys = append(keys, it.Key)
	}
	var existing []string
	if err := r.db.WithContext(ctx).Model(&model.Setting{}).
		Where("key IN ?", keys).Pluck("key", &existing).Error; err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	have := make(map[string]bool, len(existing))
	for _, k := range existing {
		have[k] = true
	}

	created := 0
	for _, it := range items {
		if have[it.Key] {
			continue
		}
		if err := r.db.WithContext(ctx).Create(&it).Error; err != nil {
			return created, response.ErrInternal.WithCause(err)
		}
		created++
	}
	return created, nil
}

// ListAll 全部设置项（后台用）。
//
// 排序不要用 group 字段名：group 是 SQL 保留字，反引号只在 MySQL/SQLite 上有效，
// PostgreSQL 会直接报 syntax error at or near "group"。
// 这里改成按 (group, id) 在 Go 里排，SQL 只做最简单的排序，跨库都安全。
func (r *SettingRepository) ListAll(ctx context.Context) ([]model.Setting, error) {
	var list []model.Setting
	err := r.db.WithContext(ctx).Order("id ASC").Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Group != list[j].Group {
			return list[i].Group < list[j].Group
		}
		return list[i].ID < list[j].ID
	})
	return list, nil
}

// ListPublic 前台可读的公开设置。
func (r *SettingRepository) ListPublic(ctx context.Context) ([]model.Setting, error) {
	var list []model.Setting
	err := r.db.WithContext(ctx).Where("public = ?", true).Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// Get 取单个设置项。
func (r *SettingRepository) Get(ctx context.Context, key string) (*model.Setting, error) {
	var s model.Setting
	if err := r.db.WithContext(ctx).Where("key = ?", strings.TrimSpace(key)).First(&s).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrSettingNotFound)
	}
	return &s, nil
}

// Upsert 写入设置项（不存在则按通用元数据创建一条）。
func (r *SettingRepository) Upsert(ctx context.Context, key, value string, adminID uint64) error {
	key = strings.TrimSpace(key)
	var s model.Setting
	err := r.db.WithContext(ctx).Where("key = ?", key).First(&s).Error
	if err == nil {
		return r.UpdateValue(ctx, s.ID, value, adminID)
	}
	if err != gorm.ErrRecordNotFound {
		return response.ErrInternal.WithCause(err)
	}
	// 未知的键也允许保存：需求 §10 明确要求「还没定的东西先留出配置能力」，
	// 所以不把键写死在白名单里，而是让后台能先存下来。
	return r.db.WithContext(ctx).Create(&model.Setting{
		Key: key, Value: value, Group: model.SettingGroupBasic,
		Label: key, Type: "text", UpdatedBy: adminID,
	}).Error
}

// UpdateValue 更新已有设置项的值。
func (r *SettingRepository) UpdateValue(ctx context.Context, id uint64, value string, adminID uint64) error {
	err := r.db.WithContext(ctx).Model(&model.Setting{}).Where("id = ?", id).
		Updates(map[string]any{"value": value, "updated_by": adminID}).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}
