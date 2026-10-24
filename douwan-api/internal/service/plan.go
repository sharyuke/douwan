package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// PlanService 套餐管理。
//
// 设计要点：价格、有效期、权益全部落在数据库里，前台与接口都读数据库，
// 不在前端写死。下面的 SeedCatalog 只在首次初始化时写入需求文档 §3.2 的
// 三档测试套餐；已经存在同 code 的套餐不会被覆盖，管理员在后台改过的值始终有效。
type PlanService struct {
	repos *repository.Repositories
	audit *AuditLog
}

// NewPlanService 构造套餐服务。
func NewPlanService(repos *repository.Repositories, audit *AuditLog) *PlanService {
	return &PlanService{repos: repos, audit: audit}
}

// 草稿占位套餐。名称只是「先占个位」，不含任何定价或权益决定（需求 §5.1）。
var draftPlanSeeds = []repository.DraftSeed{
	{Code: "draft_single", Name: "套餐方案 A（草稿）", ShortDesc: "单张图纸权益", Tagline: "先占位，待定价", FrontDesc: "这是初始化生成的草稿占位套餐，名称、价格与权益都可以在后台修改。", SortOrder: 40},
	{Code: "draft_day", Name: "套餐方案 B（草稿）", ShortDesc: "按天畅玩", Tagline: "先占位，待定价", FrontDesc: "这是初始化生成的草稿占位套餐，尚未确定最终权益组合。", SortOrder: 30},
	{Code: "draft_week", Name: "套餐方案 C（草稿）", ShortDesc: "按周畅玩", Tagline: "先占位，待定价", FrontDesc: "这是初始化生成的草稿占位套餐，尚未确定最终权益组合。", SortOrder: 20},
	{Code: "draft_other", Name: "其他方案（草稿）", ShortDesc: "待补充", Tagline: "先占位，待定价", FrontDesc: "这是初始化生成的草稿占位套餐，供后续扩展使用。", SortOrder: 10},
}

// SeedDrafts 初始化草稿套餐。幂等：已存在的 code 不会重复创建。
func (s *PlanService) SeedDrafts(ctx context.Context, audit Audit) (int, error) {
	created, err := s.repos.Plan.EnsureDrafts(ctx, draftPlanSeeds)
	if err != nil {
		return created, err
	}
	if created > 0 {
		s.audit.Write(ctx, s.repos, audit, ActionPlanSeed, "plan", "", "",
			fmt.Sprintf("初始化草稿套餐 %d 个", created))
	}
	return created, nil
}

// proPlanPermissions 是时间套餐默认解锁的权益。
//
// 键与 pindoudou/src/composables/useMembership.js 的 ENTITLEMENTS 一致；
// 后台仍可逐项修改，这里只是首次初始化时的默认值。
var proPlanPermissions = model.BenefitPermissions{
	"generate.basic":        true,
	"generate.normal":       true,
	"generate.variants":     3,
	"canvas.cells":          1000,
	"optimize.buildability": true,
	"palette.full":          true,
	"inventory.use":         true,
	"export.png":            true,
	"export.svg":            true,
	"export.csv":            true,
	"export.pdf":            true,
	"export.json":           true,
	"export.share":          true,
	"build.mode":            true,
	"projects.limit":        40,
	"assets.pro":            true,
	"batch.export":          false,
	"license.commercial":    false,
}

var proPlanFeatureText = []string{
	"基础转换、编辑与 PNG / JPG 导出",
	"三方案自动搜索 + 可拼性优化",
	"最大单边 1000 格画布",
	"全部品牌色板（1823 个色号）",
	"库存约束配色（只用我的豆）",
	"PDF 分板图纸 / 1:1 打印",
	"材料清单 CSV / 采购清单",
	"Build Mode 逐颗 / 整板拼制进度",
	"分享卡导出",
	"40 件作品存档",
}

// catalogPlanSeed 是需求 §3.2 的三档测试套餐。
type catalogPlanSeed struct {
	Code          string
	Name          string
	Tagline       string
	Tag           string
	Price         float64
	ValidityType  string
	ValidityValue int
	SortOrder     int
}

var catalogPlanSeeds = []catalogPlanSeed{
	{Code: "day_pass", Name: "一天畅玩", Tagline: "先试一天，拼完一张小图", Tag: "轻量", Price: 2.9, ValidityType: model.ValidityHour, ValidityValue: 24, SortOrder: 10},
	{Code: "week_pass", Name: "一周畅玩", Tagline: "一周内把想做的图都做完", Tag: "推荐", Price: 6.9, ValidityType: model.ValidityDay, ValidityValue: 7, SortOrder: 20},
	{Code: "month_pass", Name: "一个月畅玩", Tagline: "长期创作，随时回来继续", Tag: "最划算", Price: 9.9, ValidityType: model.ValidityMonth, ValidityValue: 1, SortOrder: 30},
}

// SeedCatalog 初始化需求 §3.2 的三档正式套餐。
//
// 幂等：只创建尚不存在的 code，不覆盖管理员已经改过的价格、有效期与权益。
// 这样部署脚本可以每次发布都跑一遍，不会把线上配置重置回默认值。
func (s *PlanService) SeedCatalog(ctx context.Context, audit Audit) (int, error) {
	created := 0
	now := time.Now()
	for _, seed := range catalogPlanSeeds {
		exists, err := s.repos.Plan.ExistsByCode(ctx, seed.Code, 0)
		if err != nil {
			return created, err
		}
		if exists {
			continue
		}
		cfg := model.BenefitConfig{
			Kind:          model.BenefitUnlimited,
			Permissions:   proPlanPermissions,
			ValidityType:  seed.ValidityType,
			ValidityValue: seed.ValidityValue,
			StartOn:       model.StartOnRedeem,
			Stackable:     false,
		}
		plan := &model.Plan{
			Code:               seed.Code,
			Name:               seed.Name,
			ShortDesc:          seed.Tagline,
			FrontDesc:          "卡密兑换成功后开始计时，到期自动恢复免费权限；作品与草稿不会被删除。",
			Tagline:            seed.Tagline,
			Tag:                seed.Tag,
			Price:              seed.Price,
			BenefitType:        model.BenefitUnlimited,
			BenefitConfig:      cfg,
			ValidityType:       seed.ValidityType,
			ValidityValue:      seed.ValidityValue,
			FeaturePermissions: proPlanPermissions,
			FeatureText:        proPlanFeatureText,
			CardQuantity:       1,
			BatchSize:          10,
			SortOrder:          seed.SortOrder,
			Status:             model.PlanStatusPublished,
			PublishedAt:        &now,
		}
		if err := s.repos.Plan.Create(ctx, plan); err != nil {
			return created, err
		}
		created++
	}
	if created > 0 {
		s.audit.Write(ctx, s.repos, audit, ActionPlanSeed, "plan", "", "",
			fmt.Sprintf("初始化正式套餐 %d 个", created))
	}
	return created, nil
}

// List 套餐列表（带引用统计，便于判断能否删除）。
func (s *PlanService) List(ctx context.Context, q dto.PlanListQuery) (dto.PageResult[dto.PlanItem], error) {
	q.PageQuery.Normalize()
	plans, total, err := s.repos.Plan.List(ctx, q)
	if err != nil {
		return dto.PageResult[dto.PlanItem]{}, err
	}

	items := make([]dto.PlanItem, 0, len(plans))
	for i := range plans {
		item, err := s.toItem(ctx, &plans[i], true)
		if err != nil {
			return dto.PageResult[dto.PlanItem]{}, err
		}
		items = append(items, item)
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// Detail 套餐详情。
func (s *PlanService) Detail(ctx context.Context, id uint64) (*dto.PlanItem, error) {
	plan, err := s.repos.Plan.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	item, err := s.toItem(ctx, plan, true)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// Preview 前台预览（需求 §5.3「提供预览入口，查看套餐在前台的大致展示效果」）。
func (s *PlanService) Preview(ctx context.Context, id uint64) (*dto.PlanPreviewResult, error) {
	plan, err := s.repos.Plan.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	result := &dto.PlanPreviewResult{
		Plan:    toPublicPlan(plan),
		Visible: plan.IsPublished(),
	}
	if result.Visible {
		result.VisibleNote = "该套餐已上架，前台购买页会按下面的内容展示。"
	} else {
		result.VisibleNote = fmt.Sprintf("该套餐当前是「%s」，不会出现在前台购买页，也不能创建正常购买订单。",
			model.PlanStatusLabel(plan.Status))
	}
	return result, nil
}

// Create 新建套餐（默认存成草稿，避免误上架）。
func (s *PlanService) Create(ctx context.Context, req dto.PlanRequest, audit Audit) (*dto.PlanItem, error) {
	req.Name = dto.Trim(req.Name)
	if req.Name == "" {
		return nil, response.ErrInvalidParam.WithMessage("套餐名称不能为空")
	}
	code, err := s.resolveCode(ctx, req, 0)
	if err != nil {
		return nil, err
	}

	plan := &model.Plan{
		Code:                code,
		Name:                req.Name,
		ShortDesc:           dto.Trim(req.ShortDesc),
		FrontDesc:           dto.Trim(req.FrontDesc),
		Tagline:             dto.Trim(req.Tagline),
		Tag:                 dto.Trim(req.Tag),
		Price:               req.Price,
		OriginalPrice:       req.OriginalPrice,
		Status:              model.PlanStatusDraft,
		AllowRepeatPurchase: req.AllowRepeatPurchase,
		CardQuantity:        defaultInt(req.CardQuantity, 1),
		BatchSize:           defaultInt(req.BatchSize, 10),
		SortOrder:           req.SortOrder,
		CreatedBy:           audit.AdminID,
		UpdatedBy:           audit.AdminID,
	}
	if err := applyPlanBenefit(plan, req); err != nil {
		return nil, err
	}

	if err := s.repos.Plan.Create(ctx, plan); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionPlanCreate, "plan", fmt.Sprint(plan.ID), plan.Name,
		fmt.Sprintf("新建套餐 %s，初始状态：草稿", plan.Name))

	item, err := s.toItem(ctx, plan, false)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// Update 编辑套餐。
func (s *PlanService) Update(ctx context.Context, id uint64, req dto.PlanRequest, audit Audit) (*dto.PlanItem, error) {
	plan, err := s.repos.Plan.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	req.Name = dto.Trim(req.Name)
	if req.Name == "" {
		return nil, response.ErrInvalidParam.WithMessage("套餐名称不能为空")
	}
	code, err := s.resolveCode(ctx, req, id)
	if err != nil {
		return nil, err
	}

	plan.Code = code
	plan.Name = req.Name
	plan.ShortDesc = dto.Trim(req.ShortDesc)
	plan.FrontDesc = dto.Trim(req.FrontDesc)
	plan.Tagline = dto.Trim(req.Tagline)
	plan.Tag = dto.Trim(req.Tag)
	plan.Price = req.Price
	plan.OriginalPrice = req.OriginalPrice
	plan.AllowRepeatPurchase = req.AllowRepeatPurchase
	plan.CardQuantity = defaultInt(req.CardQuantity, 1)
	plan.BatchSize = defaultInt(req.BatchSize, 10)
	plan.SortOrder = req.SortOrder
	plan.UpdatedBy = audit.AdminID
	if err := applyPlanBenefit(plan, req); err != nil {
		return nil, err
	}

	fields := map[string]any{
		"code":                  plan.Code,
		"name":                  plan.Name,
		"short_desc":            plan.ShortDesc,
		"front_desc":            plan.FrontDesc,
		"tagline":               plan.Tagline,
		"tag":                   plan.Tag,
		"price":                 plan.Price,
		"original_price":        plan.OriginalPrice,
		"benefit_type":          plan.BenefitType,
		"benefit_config":        jsonValue(plan.BenefitConfig),
		"validity_type":         plan.ValidityType,
		"validity_value":        plan.ValidityValue,
		"feature_permissions":   jsonValue(plan.FeaturePermissions),
		"feature_text":          jsonValue(plan.FeatureText),
		"allow_repeat_purchase": plan.AllowRepeatPurchase,
		"card_quantity":         plan.CardQuantity,
		"batch_size":            plan.BatchSize,
		"sort_order":            plan.SortOrder,
		"updated_by":            audit.AdminID,
	}
	if err := s.repos.Plan.UpdateFields(ctx, id, fields); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionPlanUpdate, "plan", fmt.Sprint(id), plan.Name,
		fmt.Sprintf("编辑套餐 %s（价格 ¥%.2f / 权益类型 %s）", plan.Name, plan.Price, plan.BenefitType))

	item, err := s.toItem(ctx, plan, true)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// ChangeStatus 上架 / 下架 / 转草稿。
func (s *PlanService) ChangeStatus(ctx context.Context, id uint64, req dto.PlanStatusRequest, audit Audit) (*dto.PlanItem, error) {
	plan, err := s.repos.Plan.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	fields := map[string]any{"status": req.Status, "updated_by": audit.AdminID}
	switch req.Status {
	case model.PlanStatusPublished:
		// 上架前必须服务端校验必填字段（需求 §5.3 / §13.9）
		if err := validatePublishable(plan); err != nil {
			s.audit.WriteFail(ctx, s.repos, audit, ActionPlanStatus, "plan", fmt.Sprint(id), plan.Name,
				"上架校验失败："+err.Error())
			return nil, err
		}
		fields["published_at"] = now
		fields["archived_at"] = nil
	case model.PlanStatusArchived:
		fields["archived_at"] = now
		if req.Reason != "" {
			fields["delete_note"] = dto.Trim(req.Reason)
		}
	case model.PlanStatusDraft:
		fields["published_at"] = nil
	default:
		return nil, response.ErrInvalidParam.WithMessage("套餐状态不合法")
	}

	if err := s.repos.Plan.UpdateFields(ctx, id, fields); err != nil {
		return nil, err
	}
	plan.Status = req.Status
	s.audit.Write(ctx, s.repos, audit, ActionPlanStatus, "plan", fmt.Sprint(id), plan.Name,
		fmt.Sprintf("套餐状态 %s → %s", model.PlanStatusLabel(plan.Status), model.PlanStatusLabel(req.Status)))

	item, err := s.toItem(ctx, plan, true)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// Duplicate 复制套餐：新套餐恒为草稿，名称加「副本」后缀。
func (s *PlanService) Duplicate(ctx context.Context, id uint64, audit Audit) (*dto.PlanItem, error) {
	src, err := s.repos.Plan.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	code, err := s.resolveCode(ctx, dto.PlanRequest{Code: src.Code + "_copy"}, 0)
	if err != nil {
		return nil, err
	}

	copyPlan := &model.Plan{Code: code,
		Name:                src.Name + "（副本）",
		ShortDesc:           src.ShortDesc,
		FrontDesc:           src.FrontDesc,
		Tagline:             src.Tagline,
		Tag:                 src.Tag,
		Price:               src.Price,
		OriginalPrice:       src.OriginalPrice,
		BenefitType:         src.BenefitType,
		BenefitConfig:       src.BenefitConfig,
		ValidityType:        src.ValidityType,
		ValidityValue:       src.ValidityValue,
		FeaturePermissions:  src.FeaturePermissions,
		FeatureText:         src.FeatureText,
		AllowRepeatPurchase: src.AllowRepeatPurchase,
		CardQuantity:        src.CardQuantity,
		BatchSize:           src.BatchSize,
		SortOrder:           src.SortOrder,
		Status:              model.PlanStatusDraft,
		CreatedBy:           audit.AdminID,
		UpdatedBy:           audit.AdminID,
	}
	if err := s.repos.Plan.Create(ctx, copyPlan); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionPlanDuplicate, "plan", fmt.Sprint(copyPlan.ID), copyPlan.Name,
		fmt.Sprintf("从套餐 #%d（%s）复制，新套餐为草稿", src.ID, src.Name))

	item, err := s.toItem(ctx, copyPlan, false)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// Delete 删除套餐。
//
// 已产生订单或卡密的套餐不允许物理删除，只能下架归档（需求 §5.3 / §13）。
func (s *PlanService) Delete(ctx context.Context, id uint64, reason string, audit Audit) error {
	plan, err := s.repos.Plan.FindByID(ctx, id)
	if err != nil {
		return err
	}
	usage, err := s.repos.Plan.Usage(ctx, id)
	if err != nil {
		return err
	}
	if usage.OrderCount > 0 || usage.CardKeyCount > 0 {
		s.audit.WriteFail(ctx, s.repos, audit, ActionPlanDelete, "plan", fmt.Sprint(id), plan.Name,
			fmt.Sprintf("拒绝删除：已有 %d 个订单、%d 张卡密", usage.OrderCount, usage.CardKeyCount))
		return response.ErrPlanInUse.WithMessage(fmt.Sprintf(
			"该套餐已产生 %d 个订单、%d 张卡密，不能删除。请改为下架，历史记录会保留。",
			usage.OrderCount, usage.CardKeyCount))
	}
	if plan.Status == model.PlanStatusPublished {
		return response.ErrInvalidParam.WithMessage("请先下架该套餐，再执行删除")
	}

	fields := map[string]any{"deleted_by": audit.AdminID}
	if strings.TrimSpace(reason) != "" {
		fields["delete_note"] = dto.Trim(reason)
	}
	if err := s.repos.Plan.UpdateFields(ctx, id, fields); err != nil {
		return err
	}
	if err := s.repos.Plan.Delete(ctx, id); err != nil {
		return err
	}
	s.audit.Write(ctx, s.repos, audit, ActionPlanDelete, "plan", fmt.Sprint(id), plan.Name,
		"删除套餐（无订单与卡密引用）")
	return nil
}

// Options 下拉选项。
func (s *PlanService) Options(ctx context.Context) ([]dto.PlanOption, error) {
	plans, err := s.repos.Plan.ListOptions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]dto.PlanOption, 0, len(plans))
	for i := range plans {
		p := &plans[i]
		out = append(out, dto.PlanOption{
			ID:              p.ID,
			Code:            p.Code,
			Name:            p.Name,
			Status:          p.Status,
			Price:           p.Price,
			ValidityText:    model.ValidityLabel(p.ValidityType, p.ValidityValue),
			PermissionCount: len(p.FeaturePermissions),
		})
	}
	return out, nil
}

// PublicList 前台可购买套餐（只要已上架）。
func (s *PlanService) PublicList(ctx context.Context) ([]dto.PublicPlanItem, error) {
	plans, err := s.repos.Plan.ListPublished(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]dto.PublicPlanItem, 0, len(plans))
	for i := range plans {
		out = append(out, toPublicPlan(&plans[i]))
	}
	return out, nil
}

/* ------------------------------------------------------------------ 内部 */

// resolveCode 决定套餐标识：没填就自动生成，填了要查重。
func (s *PlanService) resolveCode(ctx context.Context, req dto.PlanRequest, excludeID uint64) (string, error) {
	code := strings.TrimSpace(req.Code)
	if code == "" {
		code = slugify(req.Name)
		if code == "" {
			code = "plan"
		}
		// 自动生成的标识仍然可能撞车，加序号直到不冲突
		base := code
		for i := 1; i <= 50; i++ {
			exists, err := s.repos.Plan.ExistsByCode(ctx, code, excludeID)
			if err != nil {
				return "", err
			}
			if !exists {
				return code, nil
			}
			code = fmt.Sprintf("%s_%d", base, i)
		}
		return "", response.ErrPlanInvalid.WithMessage("无法生成唯一的套餐标识，请手动填写")
	}
	if !validCode(code) {
		return "", response.ErrInvalidParam.WithMessage("套餐标识只能包含小写字母、数字与下划线（2~32 位）")
	}
	exists, err := s.repos.Plan.ExistsByCode(ctx, code, excludeID)
	if err != nil {
		return "", err
	}
	if exists {
		return "", response.ErrPlanInvalid.WithMessage("套餐标识已被占用，请换一个")
	}
	return code, nil
}

// toItem 组装返回结构。withUsage 为 true 时额外统计订单与卡密数量。
func (s *PlanService) toItem(ctx context.Context, p *model.Plan, withUsage bool) (dto.PlanItem, error) {
	item := dto.PlanItem{
		ID:                  p.ID,
		Code:                p.Code,
		Name:                p.Name,
		ShortDesc:           p.ShortDesc,
		FrontDesc:           p.FrontDesc,
		Tagline:             p.Tagline,
		Tag:                 p.Tag,
		Price:               p.Price,
		OriginalPrice:       p.OriginalPrice,
		BenefitType:         p.BenefitType,
		BenefitConfig:       p.BenefitConfig,
		ValidityType:        p.ValidityType,
		ValidityValue:       p.ValidityValue,
		ValidityText:        model.ValidityLabel(p.ValidityType, p.ValidityValue),
		FeaturePermissions:  p.FeaturePermissions,
		FeatureText:         p.FeatureText,
		AllowRepeatPurchase: p.AllowRepeatPurchase,
		CardQuantity:        p.CardQuantity,
		BatchSize:           p.BatchSize,
		SortOrder:           p.SortOrder,
		Status:              p.Status,
		StatusText:          model.PlanStatusLabel(p.Status),
		CreatedBy:           p.CreatedBy,
		CreatedAt:           p.CreatedAt,
		UpdatedAt:           p.UpdatedAt,
		PublishedAt:         p.PublishedAt,
		ArchivedAt:          p.ArchivedAt,
		DeleteNote:          p.DeleteNote,
	}
	if item.FeatureText == nil {
		item.FeatureText = []string{}
	}
	if item.FeaturePermissions == nil {
		item.FeaturePermissions = model.BenefitPermissions{}
	}
	if withUsage {
		usage, err := s.repos.Plan.Usage(ctx, p.ID)
		if err != nil {
			return item, err
		}
		item.OrderCount = usage.OrderCount
		item.CardKeyCount = usage.CardKeyCount
		item.IssuedCardCount = usage.IssuedCards
	}
	return item, nil
}

// applyPlanBenefit 把请求里的权益配置写进实体，并做交叉校验。
func applyPlanBenefit(plan *model.Plan, req dto.PlanRequest) error {
	cfg := model.BenefitConfig{
		Kind:          req.BenefitConfig.Kind,
		UsageLimit:    req.BenefitConfig.UsageLimit,
		Permissions:   model.BenefitPermissions(req.BenefitConfig.Permissions),
		ValidityType:  req.BenefitConfig.ValidityType,
		ValidityValue: req.BenefitConfig.ValidityValue,
		StartOn:       req.BenefitConfig.StartOn,
		Stackable:     req.BenefitConfig.Stackable,
	}
	if cfg.Kind == "" {
		cfg.Kind = req.BenefitType
	}
	if cfg.Kind == "" {
		cfg.Kind = model.BenefitUnlimited
	}
	if cfg.ValidityType == "" {
		cfg.ValidityType = model.ValidityNone
	}
	if cfg.StartOn == "" {
		// 需求 §5.4 建议卡密兑换后开始计时，这里作为默认值但仍然落库保存
		cfg.StartOn = model.StartOnRedeem
	}

	switch cfg.Kind {
	case model.BenefitUnlimited:
		cfg.UsageLimit = 0
	case model.BenefitQuota, model.BenefitCount:
		if cfg.UsageLimit <= 0 {
			return response.ErrInvalidParam.WithMessage("权益类型是次数/额度时，必须填写大于 0 的额度")
		}
	default:
		return response.ErrInvalidParam.WithMessage("权益类型不合法")
	}

	switch cfg.ValidityType {
	case model.ValidityNone:
		cfg.ValidityValue = 0
	case model.ValidityHour, model.ValidityDay, model.ValidityMonth:
		if cfg.ValidityValue <= 0 {
			return response.ErrInvalidParam.WithMessage("设置了有效期类型，就必须填写大于 0 的有效期数值")
		}
	default:
		return response.ErrInvalidParam.WithMessage("有效期类型不合法")
	}

	if cfg.Permissions == nil {
		cfg.Permissions = model.BenefitPermissions{}
	}
	// 请求里单独传的 feature_permissions 优先（后台「功能权限」多选框走这个字段）
	if req.FeaturePermissions != nil {
		perms := model.BenefitPermissions{}
		for k, v := range req.FeaturePermissions {
			perms[k] = v
		}
		cfg.Permissions = perms
	}

	plan.BenefitType = cfg.Kind
	plan.BenefitConfig = cfg
	plan.ValidityType = cfg.ValidityType
	plan.ValidityValue = cfg.ValidityValue
	plan.FeaturePermissions = cfg.Permissions
	if req.FeatureText == nil {
		plan.FeatureText = []string{}
	} else {
		texts := make([]string, 0, len(req.FeatureText))
		for _, t := range req.FeatureText {
			if s := dto.Trim(t); s != "" {
				texts = append(texts, truncate(s, 128))
			}
		}
		plan.FeatureText = texts
	}
	return nil
}

// validatePublishable 上架前的服务端校验（需求 §5.3）。
func validatePublishable(p *model.Plan) error {
	if strings.TrimSpace(p.Name) == "" {
		return response.ErrPlanInvalid.WithMessage("套餐名称不能为空，无法上架")
	}
	if p.Price < 0 {
		return response.ErrPlanInvalid.WithMessage("售价不能为负数")
	}
	if p.OriginalPrice != nil && *p.OriginalPrice < p.Price {
		return response.ErrPlanInvalid.WithMessage("划线价不能低于实际售价")
	}
	if p.BenefitType == model.BenefitQuota || p.BenefitType == model.BenefitCount {
		if p.BenefitConfig.UsageLimit <= 0 {
			return response.ErrPlanInvalid.WithMessage("次数/额度类套餐必须填写大于 0 的额度")
		}
	}
	if p.BenefitConfig.ValidityType != model.ValidityNone && p.BenefitConfig.ValidityValue <= 0 {
		return response.ErrPlanInvalid.WithMessage("设置了有效期，就必须填写大于 0 的有效期数值")
	}
	if p.CardQuantity <= 0 {
		return response.ErrPlanInvalid.WithMessage("每单发放卡密数量必须大于 0")
	}
	return nil
}

func toPublicPlan(p *model.Plan) dto.PublicPlanItem {
	texts := p.FeatureText
	if texts == nil {
		texts = []string{}
	}
	perms := p.FeaturePermissions
	if perms == nil {
		perms = model.BenefitPermissions{}
	}
	return dto.PublicPlanItem{
		ID:                  p.ID,
		Code:                p.Code,
		Name:                p.Name,
		ShortDesc:           p.ShortDesc,
		FrontDesc:           p.FrontDesc,
		Tagline:             p.Tagline,
		Tag:                 p.Tag,
		Price:               p.Price,
		OriginalPrice:       p.OriginalPrice,
		ValidityType:        p.ValidityType,
		ValidityValue:       p.ValidityValue,
		ValidityText:        model.ValidityLabel(p.ValidityType, p.ValidityValue),
		FeatureText:         texts,
		FeaturePermissions:  perms,
		BenefitType:         p.BenefitType,
		UsageLimit:          p.BenefitConfig.UsageLimit,
		AllowRepeatPurchase: p.AllowRepeatPurchase,
		SortOrder:           p.SortOrder,
	}
}

// slugify 从中文名生成标识：中文无法转拼音，这里只保留 ASCII 字母数字，
// 生成不出内容时由调用方兜底成 plan / plan_1 这种。
func slugify(name string) string {
	var b strings.Builder
	lastUnderscore := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		default:
			if !lastUnderscore && b.Len() > 0 {
				b.WriteByte('_')
				lastUnderscore = true
			}
		}
	}
	out := strings.Trim(b.String(), "_")
	if len(out) > 32 {
		out = out[:32]
	}
	return out
}

func validCode(code string) bool {
	if len(code) < 2 || len(code) > 32 {
		return false
	}
	for _, r := range code {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

func defaultInt(v, fallback int) int {
	if v <= 0 {
		return fallback
	}
	return v
}
