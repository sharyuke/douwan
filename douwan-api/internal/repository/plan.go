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

// PlanRepository 套餐表访问。
type PlanRepository struct {
	db *gorm.DB
}

// Create 新建套餐。
func (r *PlanRepository) Create(ctx context.Context, p *model.Plan) error {
	if err := r.db.WithContext(ctx).Create(p).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return response.ErrPlanInvalid.WithMessage("套餐标识已被占用，请换一个")
		}
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByID 按主键查套餐（不含已软删除的）。
func (r *PlanRepository) FindByID(ctx context.Context, id uint64) (*model.Plan, error) {
	var p model.Plan
	if err := r.db.WithContext(ctx).First(&p, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrPlanNotFound)
	}
	return &p, nil
}

// FindByCode 按标识查套餐。
func (r *PlanRepository) FindByCode(ctx context.Context, code string) (*model.Plan, error) {
	var p model.Plan
	if err := r.db.WithContext(ctx).Where("code = ?", strings.TrimSpace(code)).First(&p).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrPlanNotFound)
	}
	return &p, nil
}

// ExistsByCode 判断标识是否被占用。excludeID 用于编辑时排除自己。
func (r *PlanRepository) ExistsByCode(ctx context.Context, code string, excludeID uint64) (bool, error) {
	if strings.TrimSpace(code) == "" {
		return false, nil
	}
	q := r.db.WithContext(ctx).Model(&model.Plan{}).Where("code = ?", strings.TrimSpace(code))
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return false, response.ErrInternal.WithCause(err)
	}
	return count > 0, nil
}

// UpdateFields 局部更新。
func (r *PlanRepository) UpdateFields(ctx context.Context, id uint64, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	err := r.db.WithContext(ctx).Model(&model.Plan{}).Where("id = ?", id).Updates(fields).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// Delete 软删除。只有从未产生订单与卡密的套餐才允许走到这里，
// 判定在 Service 层做，仓储只负责执行。
func (r *PlanRepository) Delete(ctx context.Context, id uint64) error {
	err := r.db.WithContext(ctx).Delete(&model.Plan{}, id).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// List 套餐列表。
func (r *PlanRepository) List(ctx context.Context, q dto.PlanListQuery) ([]model.Plan, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.Plan{})
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("name LIKE ? OR code LIKE ?", like, like)
	}
	if q.Status != "" {
		query = query.Where("status = ?", q.Status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var list []model.Plan
	// 排序值大的排前面（前台的展示顺序就是这个），同序按 id
	err := query.Order("sort_order DESC, id DESC").
		Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// ListPublished 前台可购买的套餐（只要已上架）。
func (r *PlanRepository) ListPublished(ctx context.Context) ([]model.Plan, error) {
	var list []model.Plan
	err := r.db.WithContext(ctx).
		Where("status = ?", model.PlanStatusPublished).
		Order("sort_order DESC, id ASC").Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// ListOptions 供下拉选择用的全部套餐（含草稿与下架，卡密生成时可能要选）。
func (r *PlanRepository) ListOptions(ctx context.Context) ([]model.Plan, error) {
	var list []model.Plan
	err := r.db.WithContext(ctx).Order("sort_order DESC, id ASC").Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// PlanUsage 统计某个套餐已被多少订单 / 卡密引用。
// 服务层用它决定「能不能物理删除」（需求 §5.3 / §13：已产生订单的套餐不能删）。
type PlanUsage struct {
	OrderCount   int64
	CardKeyCount int64
	IssuedCards  int64
}

// Usage 统计套餐引用情况。
func (r *PlanRepository) Usage(ctx context.Context, planID uint64) (PlanUsage, error) {
	var usage PlanUsage
	err := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("plan_id = ?", planID).Count(&usage.OrderCount).Error
	if err != nil {
		return usage, response.ErrInternal.WithCause(err)
	}
	err = r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("plan_id = ?", planID).Count(&usage.CardKeyCount).Error
	if err != nil {
		return usage, response.ErrInternal.WithCause(err)
	}
	err = r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("plan_id = ? AND status <> ?", planID, model.CardStatusUnused).
		Count(&usage.IssuedCards).Error
	if err != nil {
		return usage, response.ErrInternal.WithCause(err)
	}
	return usage, nil
}

// CountPublished 已上架套餐数量，供概览页使用。
func (r *PlanRepository) CountPublished(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Plan{}).
		Where("status = ?", model.PlanStatusPublished).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// DraftSeed 是「初始化草稿套餐」用的最小描述。
// 名称与价格都只是占位，避免代码里出现任何写死的商业规则。
type DraftSeed struct {
	Code      string
	Name      string
	ShortDesc string
	Tagline   string
	FrontDesc string
	SortOrder int
}

// EnsureDrafts 幂等地创建占位草稿套餐：只创建 code 尚不存在的。
// 返回本次实际新建的数量。
func (r *PlanRepository) EnsureDrafts(ctx context.Context, seeds []DraftSeed) (int, error) {
	created := 0
	for _, s := range seeds {
		exists, err := r.ExistsByCode(ctx, s.Code, 0)
		if err != nil {
			return created, err
		}
		if exists {
			continue
		}
		p := &model.Plan{
			Code:        s.Code,
			Name:        s.Name,
			ShortDesc:   s.ShortDesc,
			Tagline:     s.Tagline,
			FrontDesc:   s.FrontDesc,
			Status:      model.PlanStatusDraft,
			BenefitType: model.BenefitUnlimited,
			BenefitConfig: model.BenefitConfig{
				Kind:          model.BenefitUnlimited,
				Permissions:   model.BenefitPermissions{},
				ValidityType:  model.ValidityNone,
				ValidityValue: 0,
				StartOn:       model.StartOnRedeem,
			},
			ValidityType:       model.ValidityNone,
			FeaturePermissions: model.BenefitPermissions{},
			FeatureText:        []string{},
			CardQuantity:       1,
			BatchSize:          10,
			SortOrder:          s.SortOrder,
		}
		if err := r.Create(ctx, p); err != nil {
			return created, err
		}
		created++
	}
	return created, nil
}

// TouchUpdated 更新 updated_at。批量导入后调用，保证列表顺序正常。
func (r *PlanRepository) TouchUpdated(ctx context.Context, id uint64, at time.Time) error {
	return r.db.WithContext(ctx).Model(&model.Plan{}).Where("id = ?", id).
		Update("updated_at", at).Error
}
