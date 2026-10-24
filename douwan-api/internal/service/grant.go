package service

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/entitlement"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// GrantService 负责「把权益真正发给用户」这件事。
//
// 卡密兑换、订单发卡、管理员手动发放最终都走这里，
// 保证三条路径产生同一种权益记录、同一套会员状态同步逻辑，
// 不会出现「卡密兑换的权益前台认不出来」这种两套权限系统的问题（需求 §12.4）。
type GrantService struct {
	repos *repository.Repositories
	audit *AuditLog
}

// NewGrantService 构造权益发放服务。
func NewGrantService(repos *repository.Repositories, audit *AuditLog) *GrantService {
	return &GrantService{repos: repos, audit: audit}
}

// GrantInput 是一次权益发放的输入。
type GrantInput struct {
	UserID   uint64
	Account  string
	PlanID   uint64
	Snapshot model.PlanSnapshot
	Source   string
	SourceID uint64
	SourceNo string
	OrderID  uint64
	Note     string
	AdminID  uint64
	// OverrideValidDays 覆盖套餐时长（天），0 表示用套餐配置
	OverrideValidDays int
	Now               time.Time
}

// Grant 在一个已有事务里创建权益并同步会员状态。
//
// 调用方必须传事务句柄（repos 由 WithTx 得到）：卡密状态变更与权益创建
// 必须在同一个事务里，否则会出现「卡密显示已兑换但用户没有权益」（需求 §13.4）。
func (s *GrantService) Grant(ctx context.Context, repos *repository.Repositories, in GrantInput) (*model.Entitlement, error) {
	if in.UserID == 0 {
		return nil, response.ErrInvalidParam.WithMessage("无法确定权益归属用户")
	}
	if in.Now.IsZero() {
		in.Now = time.Now()
	}
	now := in.Now

	startsAt := now
	switch in.Snapshot.Benefit.StartOn {
	case model.StartOnPaid, model.StartOnGrant, model.StartOnRedeem, "":
		// 本期三种起算方式在实际执行时点上是同一个动作（兑换/发卡/发放），
		// 但字段落库保存，将来把「付款时起算」做成真正不同时点也不用改表。
		startsAt = now
	}

	var expiresAt *time.Time
	duration := in.Snapshot.Benefit.Duration()
	if in.OverrideValidDays > 0 {
		duration = time.Duration(in.OverrideValidDays) * 24 * time.Hour
	}
	if duration > 0 {
		end := startsAt.Add(duration)
		expiresAt = &end
	}

	var usageLimit *int
	if in.Snapshot.Benefit.Kind == model.BenefitQuota || in.Snapshot.Benefit.Kind == model.BenefitCount {
		limit := in.Snapshot.Benefit.UsageLimit
		if limit > 0 {
			usageLimit = &limit
		}
	}

	ent := &model.Entitlement{
		UserID:       in.UserID,
		UserAccount:  in.Account,
		SourceType:   in.Source,
		SourceID:     in.SourceID,
		SourceNo:     in.SourceNo,
		OrderID:      in.OrderID,
		PlanID:       in.PlanID,
		PlanSnapshot: in.Snapshot,
		PlanName:     in.Snapshot.Name,
		PlanCode:     in.Snapshot.Code,
		StartsAt:     startsAt,
		ExpiresAt:    expiresAt,
		UsageLimit:   usageLimit,
		UsageUsed:    0,
		Status:       model.EntitlementStatusActive,
		Note:         in.Note,
		GrantedBy:    in.AdminID,
	}
	if err := repos.Entitlement.Create(ctx, ent); err != nil {
		return nil, err
	}
	if err := s.syncMembership(ctx, repos, in.UserID, now); err != nil {
		return nil, err
	}
	return ent, nil
}

// syncMembership 把用户的会员状态重算成「当前有效权益里最好的那一个」。
//
// 为什么重算而不是直接写 plan：多次兑换、叠加购买、部分过期的情况下，
// 直接写会把已经生效的更长期权益覆盖掉（例如先兑换 7 天再兑换 1 天，
// 不能把到期时间改短）。重算永远是幂等的，也便于管理员事后撤销权益。
func (s *GrantService) syncMembership(ctx context.Context, repos *repository.Repositories, userID uint64, now time.Time) error {
	active, err := repos.Entitlement.FindActiveByUser(ctx, userID, now)
	if err != nil {
		return err
	}

	// 先顺手把到期的权益状态刷新一下，保证查询口径一致
	if _, err := repos.Entitlement.ExpireOverdue(ctx, now); err != nil {
		return err
	}

	plan := model.PlanFree
	var expireAt *time.Time
	var startedAt *time.Time
	source := ""

	for i := range active {
		e := &active[i]
		if e.PlanCode == "" || e.PlanCode == model.PlanFree {
			continue
		}
		// 不限时长优先；否则取到期时间最晚的
		if expireAt == nil && plan == model.PlanFree {
			plan = e.PlanCode
			expireAt = e.ExpiresAt
			st := e.StartsAt
			startedAt = &st
			source = e.SourceType
			continue
		}
		if e.ExpiresAt == nil {
			// 新的这个不限时长，直接胜出
			plan = e.PlanCode
			expireAt = nil
			st := e.StartsAt
			startedAt = &st
			source = e.SourceType
			continue
		}
		if expireAt != nil && e.ExpiresAt.After(*expireAt) {
			plan = e.PlanCode
			expireAt = e.ExpiresAt
			st := e.StartsAt
			startedAt = &st
			source = e.SourceType
		}
	}

	return repos.Membership.Upsert(ctx, &model.Membership{
		UserID:    userID,
		Plan:      plan,
		ExpireAt:  expireAt,
		StartedAt: startedAt,
		Source:    source,
	})
}

// Revoke 撤销一条权益，并同步会员状态。
func (s *GrantService) Revoke(ctx context.Context, db *gorm.DB, entID uint64, reason string, audit Audit) error {
	var userID uint64
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		repos := s.repos.WithTx(tx)
		ent, err := repos.Entitlement.FindByID(ctx, entID)
		if err != nil {
			return err
		}
		ok, err := repos.Entitlement.Revoke(ctx, entID, audit.AdminID, reason, time.Now())
		if err != nil {
			return err
		}
		if !ok {
			return response.ErrInvalidParam.WithMessage("该权益当前状态不允许撤销（可能已经过期或已被撤销）")
		}
		userID = ent.UserID
		return s.syncMembership(ctx, repos, ent.UserID, time.Now())
	})
	if err != nil {
		return err
	}
	s.audit.Write(ctx, s.repos, audit, ActionEntitlementRevoke, "entitlement", fmt.Sprint(entID), "",
		"撤销权益，原因："+reason)
	_ = userID
	return nil
}

// EffectivePermissions 返回某个用户当前可用的功能权限矩阵。
//
// 这是服务端唯一的权限判定入口：前台拿到它只是为了显示与引导，
// 真正的校验在服务端做（需求 §13.12）。
func (s *GrantService) EffectivePermissions(ctx context.Context, userID uint64, now time.Time) (map[string]any, []dto.EntitlementItem, error) {
	if userID == 0 {
		return entitlement.Merge(nil), nil, nil
	}
	if _, err := s.repos.Entitlement.ExpireOverdue(ctx, now); err != nil {
		return nil, nil, err
	}
	active, err := s.repos.Entitlement.FindActiveByUser(ctx, userID, now)
	if err != nil {
		return nil, nil, err
	}

	merged := entitlement.Merge(nil)
	items := make([]dto.EntitlementItem, 0, len(active))
	for i := range active {
		e := &active[i]
		merged = entitlement.Merge(mergePerms(merged, e.PlanSnapshot.Permissions))
		items = append(items, ToEntitlementItem(e, now, "", ""))
	}
	return merged, items, nil
}

// mergePerms 把套餐权限叠加到已有矩阵上（后者优先级更高）。
func mergePerms(base map[string]any, override map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(override))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		if v == nil {
			continue
		}
		out[k] = v
	}
	return out
}

// ToEntitlementItem 把权益实体转成返回结构。
func ToEntitlementItem(e *model.Entitlement, now time.Time, userAccount, userNickname string) dto.EntitlementItem {
	account := e.UserAccount
	if userAccount != "" {
		account = userAccount
	}
	effective := model.EntitlementStatusExpired
	if e.IsActiveAt(now) {
		effective = model.EntitlementStatusActive
	} else if e.Status == model.EntitlementStatusActive && e.ExpiresAt != nil && !now.Before(*e.ExpiresAt) {
		effective = model.EntitlementStatusExpired
	} else {
		effective = e.Status
	}
	return dto.EntitlementItem{
		ID:              e.ID,
		UserID:          e.UserID,
		UserAccount:     account,
		UserNickname:    userNickname,
		SourceType:      e.SourceType,
		SourceTypeText:  model.EntitlementSourceLabel(e.SourceType),
		SourceID:        e.SourceID,
		SourceNo:        e.SourceNo,
		PlanID:          e.PlanID,
		PlanName:        e.PlanName,
		PlanCode:        e.PlanCode,
		PlanSnapshot:    e.PlanSnapshot,
		StartsAt:        e.StartsAt,
		ExpiresAt:       e.ExpiresAt,
		UsageLimit:      e.UsageLimit,
		UsageUsed:       e.UsageUsed,
		Remaining:       e.Remaining(),
		Status:          e.Status,
		StatusText:      model.EntitlementStatusLabel(e.Status),
		EffectiveStatus: effective,
		Note:            e.Note,
		GrantedBy:       e.GrantedBy,
		CreatedAt:       e.CreatedAt,
		RevokedAt:       e.RevokedAt,
		RevokeNote:      e.RevokeNote,
	}
}

// EntitlementService 是后台/前台的权益查询与手动发放接口。
type EntitlementService struct {
	db    *gorm.DB
	repos *repository.Repositories
	grant *GrantService
	audit *AuditLog
}

// NewEntitlementService 构造权益服务。
func NewEntitlementService(db *gorm.DB, repos *repository.Repositories, grant *GrantService, audit *AuditLog) *EntitlementService {
	return &EntitlementService{db: db, repos: repos, grant: grant, audit: audit}
}

// List 权益 / 兑换记录列表（需求 §9）。
func (s *EntitlementService) List(ctx context.Context, q dto.EntitlementListQuery) (dto.PageResult[dto.EntitlementItem], error) {
	q.PageQuery.Normalize()

	// 先把到期权益刷成过期，保证列表里的状态列与事实一致
	if _, err := s.repos.Entitlement.ExpireOverdue(ctx, time.Now()); err != nil {
		return dto.PageResult[dto.EntitlementItem]{}, err
	}

	list, total, err := s.repos.Entitlement.List(ctx, q)
	if err != nil {
		return dto.PageResult[dto.EntitlementItem]{}, err
	}

	accounts, nicknames := s.loadUsers(ctx, list)
	now := time.Now()
	items := make([]dto.EntitlementItem, 0, len(list))
	for i := range list {
		items = append(items, ToEntitlementItem(&list[i], now, accounts[list[i].UserID], nicknames[list[i].UserID]))
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// GrantManually 管理员手动发放权益（需求 §12.4 的 admin_grant 来源）。
func (s *EntitlementService) GrantManually(ctx context.Context, req dto.EntitlementGrantRequest, audit Audit) (*dto.EntitlementItem, error) {
	user, err := s.repos.User.FindByID(ctx, req.UserID)
	if err != nil {
		return nil, err
	}
	plan, err := s.repos.Plan.FindByID(ctx, req.PlanID)
	if err != nil {
		return nil, err
	}
	if plan.Status == model.PlanStatusDraft {
		return nil, response.ErrPlanInvalid.WithMessage("草稿套餐不能用于发放权益，请先上架或补全配置")
	}

	var ent *model.Entitlement
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		repos := s.repos.WithTx(tx)
		created, err := s.grant.Grant(ctx, repos, GrantInput{
			UserID:            user.ID,
			Account:           user.Username,
			PlanID:            plan.ID,
			Snapshot:          plan.Snapshot(),
			Source:            model.EntitlementSourceAdmin,
			Note:              req.Note,
			AdminID:           audit.AdminID,
			OverrideValidDays: req.OverrideValidDays,
		})
		if err != nil {
			return err
		}
		ent = created
		return nil
	})
	if err != nil {
		return nil, err
	}

	s.audit.Write(ctx, s.repos, audit, ActionEntitlementGrant, "entitlement", fmt.Sprint(ent.ID),
		user.Username, fmt.Sprintf("手动发放套餐「%s」给用户 %s，备注：%s", plan.Name, user.Username, req.Note))

	item := ToEntitlementItem(ent, time.Now(), user.Username, user.Nickname)
	return &item, nil
}

// Revoke 撤销权益。
func (s *EntitlementService) Revoke(ctx context.Context, id uint64, req dto.EntitlementRevokeRequest, audit Audit) error {
	return s.grant.Revoke(ctx, s.db, id, req.Reason, audit)
}

// EffectivePermissions 返回某个用户当前可用的功能权限矩阵与有效权益。
//
// 这是服务端唯一的权限判定入口（需求 §13.12）：前台拿到它只是为了显示与引导，
// 真正的校验在写接口里做。userID 为 0（未登录）时返回免费版矩阵。
func (s *EntitlementService) EffectivePermissions(ctx context.Context, userID uint64, now time.Time) (map[string]any, []dto.EntitlementItem, error) {
	if s.grant == nil {
		return entitlement.Merge(nil), []dto.EntitlementItem{}, nil
	}
	matrix, items, err := s.grant.EffectivePermissions(ctx, userID, now)
	if items == nil {
		items = []dto.EntitlementItem{}
	}
	return matrix, items, err
}

// Options 返回可配置的功能权限点，供后台渲染套餐表单。
func (s *EntitlementService) Options() []entitlement.Feature {
	return entitlement.Features()
}

// DenyReasons 返回「为什么不能用某个功能」的中文说明，供前台展示拒绝原因。
func DenyReasons() map[string]string {
	out := make(map[string]string, len(entitlement.DenyReasons))
	for k, v := range entitlement.DenyReasons {
		out[k] = v
	}
	return out
}

// loadUsers 批量取账号与昵称，避免列表里 N+1 查询。
func (s *EntitlementService) loadUsers(ctx context.Context, list []model.Entitlement) (map[uint64]string, map[uint64]string) {
	accounts := make(map[uint64]string, len(list))
	nicknames := make(map[uint64]string, len(list))
	if len(list) == 0 {
		return accounts, nicknames
	}
	ids := make([]uint64, 0, len(list))
	seen := make(map[uint64]bool, len(list))
	for _, e := range list {
		if !seen[e.UserID] {
			seen[e.UserID] = true
			ids = append(ids, e.UserID)
		}
	}
	users, err := s.repos.User.FindByIDs(ctx, ids)
	if err != nil {
		return accounts, nicknames
	}
	for _, u := range users {
		accounts[u.ID] = u.Username
		nicknames[u.ID] = u.Nickname
	}
	return accounts, nicknames
}
