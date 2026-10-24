package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/entitlement"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// AdminService 后台管理员账号与鉴权。
//
// 与前台 UserService 完全独立：两套令牌、两张表、两条登录路径。
// 这样即使前台鉴权出问题，也不会顺带把后台权限漏出去（需求 §3.1）。
type AdminService struct {
	repos  *repository.Repositories
	tokens *auth.Manager
	store  auth.TokenStore
	audit  *AuditLog
}

// NewAdminService 构造管理员服务。
func NewAdminService(repos *repository.Repositories, tokens *auth.Manager, store auth.TokenStore, audit *AuditLog) *AdminService {
	return &AdminService{repos: repos, tokens: tokens, store: store, audit: audit}
}

// Login 后台登录。登录成功与失败都会写日志（需求 §11），但不记密码。
func (s *AdminService) Login(ctx context.Context, req dto.AdminLoginRequest, audit Audit) (*dto.AdminAuthResult, error) {
	admin, err := s.repos.Admin.FindByUsername(ctx, req.Account)
	if err != nil {
		// 账号不存在与密码错误返回同一个错误码，避免被用来枚举后台账号
		s.audit.WriteFail(ctx, s.repos, audit, ActionAdminLoginFail, "admin", "", req.Account,
			"账号不存在或密码错误")
		return nil, err
	}
	if err := auth.VerifyPassword(admin.PasswordHash, req.Password); err != nil {
		s.audit.WriteFail(ctx, s.repos, audit, ActionAdminLoginFail, "admin",
			fmt.Sprint(admin.ID), admin.Username, "密码错误")
		return nil, err
	}
	if !admin.IsActive() {
		s.audit.WriteFail(ctx, s.repos, audit, ActionAdminLoginFail, "admin",
			fmt.Sprint(admin.ID), admin.Username, "账号已停用")
		return nil, response.ErrAdminDisabled
	}

	tokens, err := s.issueTokens(ctx, admin)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	if err := s.repos.Admin.TouchLogin(ctx, admin.ID, now, audit.IP); err != nil {
		// 登录时间只是辅助信息，写失败不拦登录
		admin.LastLoginAt = nil
	} else {
		admin.LastLoginAt = &now
		admin.LastLoginIP = audit.IP
	}

	loginAudit := audit
	loginAudit.AdminID = admin.ID
	loginAudit.AdminName = displayName(admin)
	loginAudit.AdminRole = admin.Role
	s.audit.Write(ctx, s.repos, loginAudit, ActionAdminLogin, "admin", fmt.Sprint(admin.ID), admin.Username,
		"登录成功，角色："+model.RoleLabel(admin.Role))

	return &dto.AdminAuthResult{Admin: s.Profile(admin), Tokens: *tokens}, nil
}

// Refresh 刷新后台令牌并轮换刷新令牌。
func (s *AdminService) Refresh(ctx context.Context, refreshToken string) (*dto.AdminAuthResult, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, response.ErrTokenInvalid
	}
	subject, err := s.store.Subject(ctx, refreshToken)
	if err != nil {
		return nil, err
	}
	if subject.Kind != auth.KindAdmin {
		return nil, response.ErrTokenInvalid.WithMessage("登录凭证无效，请重新登录后台")
	}
	admin, err := s.repos.Admin.FindByID(ctx, subject.ID)
	if err != nil {
		return nil, err
	}
	if !admin.IsActive() {
		return nil, response.ErrAdminDisabled
	}

	tokens, err := s.issueTokens(ctx, admin)
	if err != nil {
		return nil, err
	}
	if err := s.store.Delete(ctx, refreshToken); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &dto.AdminAuthResult{Admin: s.Profile(admin), Tokens: *tokens}, nil
}

// Logout 撤销刷新令牌。幂等。
func (s *AdminService) Logout(ctx context.Context, refreshToken string, audit Audit) error {
	if strings.TrimSpace(refreshToken) == "" {
		return nil
	}
	if err := s.store.Delete(ctx, refreshToken); err != nil {
		return response.ErrInternal.WithCause(err)
	}
	s.audit.Write(ctx, s.repos, audit, ActionAdminLogout, "admin", fmt.Sprint(audit.AdminID), audit.AdminName,
		"退出登录")
	return nil
}

// Profile 组装管理员资料（含权限点清单）。
func (s *AdminService) Profile(admin *model.Admin) dto.AdminProfile {
	return dto.AdminProfile{
		ID:          admin.ID,
		Username:    admin.Username,
		Nickname:    admin.Nickname,
		Role:        admin.Role,
		RoleLabel:   model.RoleLabel(admin.Role),
		Status:      admin.Status,
		Remark:      admin.Remark,
		LastLoginAt: admin.LastLoginAt,
		LastLoginIP: admin.LastLoginIP,
		Permissions: s.PermissionList(admin),
		CreatedAt:   admin.CreatedAt,
		IsSuper:     admin.IsSuper(),
	}
}

// PermissionList 列出某个管理员的全部权限点。
//
// 清单来自 model.PermissionOrder()（全部权限点），再按角色过滤 ——
// 新增权限点时只需要改权限矩阵与那份清单，不要再在这里手写第二份列表。
func (s *AdminService) PermissionList(admin *model.Admin) []string {
	if admin == nil {
		return []string{}
	}
	perms := model.PermissionOrder()
	out := make([]string, 0, len(perms))
	for _, p := range perms {
		if admin.Can(p) {
			out = append(out, p)
		}
	}
	return out
}

// RoleOptions 角色下拉选项。
func (s *AdminService) RoleOptions() []map[string]string {
	return []map[string]string{
		{"value": model.AdminRoleSuper, "label": model.RoleLabel(model.AdminRoleSuper), "hint": "拥有全部权限，可以管理管理员账号与支付密钥"},
		{"value": model.AdminRoleSupport, "label": model.RoleLabel(model.AdminRoleSupport), "hint": "可以管理素材、查看订单与兑换记录、人工确认收款并发卡；不能改支付密钥与系统安全设置"},
		{"value": model.AdminRoleViewer, "label": model.RoleLabel(model.AdminRoleViewer), "hint": "只能查看，不能执行任何写操作"},
	}
}

// FeatureOptions 套餐可配置的功能权限点。
func (s *AdminService) FeatureOptions() []entitlement.Feature {
	return entitlement.Features()
}

/* ------------------------------------------------------------------ 管理员管理 */

// List 管理员列表。
func (s *AdminService) List(ctx context.Context, q dto.AdminListQuery) (dto.PageResult[dto.AdminProfile], error) {
	q.PageQuery.Normalize()
	admins, total, err := s.repos.Admin.List(ctx, q)
	if err != nil {
		return dto.PageResult[dto.AdminProfile]{}, err
	}
	items := make([]dto.AdminProfile, 0, len(admins))
	for i := range admins {
		items = append(items, s.Profile(&admins[i]))
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// Create 新建管理员。
func (s *AdminService) Create(ctx context.Context, req dto.AdminCreateRequest, audit Audit) (*dto.AdminProfile, error) {
	if !model.ValidAdminRole(req.Role) {
		return nil, response.ErrInvalidParam.WithMessage("角色不合法")
	}
	exists, err := s.repos.Admin.ExistsByUsername(ctx, req.Username)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, response.ErrAdminExists
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	nickname := dto.Trim(req.Nickname)
	if nickname == "" {
		nickname = req.Username
	}
	admin := &model.Admin{
		Username:     dto.Trim(req.Username),
		PasswordHash: hash,
		Nickname:     nickname,
		Role:         req.Role,
		Status:       model.AdminStatusActive,
		Remark:       dto.Trim(req.Remark),
	}
	if err := s.repos.Admin.Create(ctx, admin); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionAdminCreate, "admin", fmt.Sprint(admin.ID), admin.Username,
		"新建管理员，角色："+model.RoleLabel(admin.Role))
	profile := s.Profile(admin)
	return &profile, nil
}

// Update 修改管理员资料 / 角色。
func (s *AdminService) Update(ctx context.Context, id uint64, req dto.AdminUpdateRequest, audit Audit) (*dto.AdminProfile, error) {
	admin, err := s.repos.Admin.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}

	fields := map[string]any{}
	changes := make([]string, 0, 3)
	if req.Nickname != nil {
		fields["nickname"] = dto.Trim(*req.Nickname)
		changes = append(changes, "昵称")
	}
	if req.Remark != nil {
		fields["remark"] = dto.Trim(*req.Remark)
	}
	if req.Role != nil && *req.Role != admin.Role {
		if !model.ValidAdminRole(*req.Role) {
			return nil, response.ErrInvalidParam.WithMessage("角色不合法")
		}
		// 不允许把最后一个超级管理员降权，否则没人能进后台了
		if admin.IsSuper() && *req.Role != model.AdminRoleSuper {
			remaining, err := s.repos.Admin.CountActiveSuper(ctx, admin.ID)
			if err != nil {
				return nil, err
			}
			if remaining == 0 {
				return nil, response.ErrForbidden.WithMessage("这是最后一个可用的超级管理员，不能降权")
			}
		}
		fields["role"] = *req.Role
		changes = append(changes, "角色 "+model.RoleLabel(admin.Role)+" → "+model.RoleLabel(*req.Role))
	}
	if len(fields) == 0 {
		profile := s.Profile(admin)
		return &profile, nil
	}

	if err := s.repos.Admin.UpdateFields(ctx, id, fields); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionAdminUpdate, "admin", fmt.Sprint(id), admin.Username,
		"修改管理员："+strings.Join(changes, "，"))

	updated, err := s.repos.Admin.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	profile := s.Profile(updated)
	return &profile, nil
}

// ChangeStatus 启用 / 停用管理员。
func (s *AdminService) ChangeStatus(ctx context.Context, id uint64, req dto.AdminStatusRequest, audit Audit) (*dto.AdminProfile, error) {
	admin, err := s.repos.Admin.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if admin.ID == audit.AdminID && req.Status == model.AdminStatusDisabled {
		return nil, response.ErrForbidden.WithMessage("不能停用自己的账号")
	}
	if admin.IsSuper() && req.Status == model.AdminStatusDisabled {
		remaining, err := s.repos.Admin.CountActiveSuper(ctx, admin.ID)
		if err != nil {
			return nil, err
		}
		if remaining == 0 {
			return nil, response.ErrForbidden.WithMessage("这是最后一个可用的超级管理员，不能停用")
		}
	}

	if err := s.repos.Admin.UpdateFields(ctx, id, map[string]any{"status": req.Status}); err != nil {
		return nil, err
	}
	action := "启用"
	if req.Status == model.AdminStatusDisabled {
		action = "停用"
	}
	s.audit.Write(ctx, s.repos, audit, ActionAdminStatus, "admin", fmt.Sprint(id), admin.Username,
		action+"管理员账号，原因："+valueOrEmpty(req.Reason))

	updated, err := s.repos.Admin.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	profile := s.Profile(updated)
	return &profile, nil
}

// ResetPassword 重置某个管理员的密码。
func (s *AdminService) ResetPassword(ctx context.Context, id uint64, req dto.AdminResetPasswordRequest, audit Audit) error {
	admin, err := s.repos.Admin.FindByID(ctx, id)
	if err != nil {
		return err
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	if err := s.repos.Admin.UpdatePassword(ctx, id, hash); err != nil {
		return err
	}
	s.audit.Write(ctx, s.repos, audit, ActionAdminResetPwd, "admin", fmt.Sprint(id), admin.Username,
		"重置管理员密码")
	return nil
}

// ChangePassword 修改自己的密码。修改后要求重新登录（令牌仍然有效，
// 但前端会主动清掉本地令牌，这里只记录日志）。
func (s *AdminService) ChangePassword(ctx context.Context, admin *model.Admin, req dto.AdminChangePasswordRequest, audit Audit) error {
	if admin == nil {
		return response.ErrUnauthorized
	}
	fresh, err := s.repos.Admin.FindByID(ctx, admin.ID)
	if err != nil {
		return err
	}
	if err := auth.VerifyPassword(fresh.PasswordHash, req.OldPassword); err != nil {
		s.audit.WriteFail(ctx, s.repos, audit, ActionAdminChangePwd, "admin", fmt.Sprint(admin.ID), admin.Username,
			"原密码校验失败")
		return response.ErrPasswordWrong.WithMessage("原密码不正确")
	}
	if req.OldPassword == req.NewPassword {
		return response.ErrInvalidParam.WithMessage("新密码不能与原密码相同")
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	if err := s.repos.Admin.UpdatePassword(ctx, admin.ID, hash); err != nil {
		return err
	}
	s.audit.Write(ctx, s.repos, audit, ActionAdminChangePwd, "admin", fmt.Sprint(admin.ID), admin.Username,
		"修改自己的登录密码")
	return nil
}

// Delete 删除管理员。
func (s *AdminService) Delete(ctx context.Context, id uint64, audit Audit) error {
	if id == audit.AdminID {
		return response.ErrForbidden.WithMessage("不能删除自己的账号")
	}
	admin, err := s.repos.Admin.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if admin.IsSuper() {
		remaining, err := s.repos.Admin.CountActiveSuper(ctx, admin.ID)
		if err != nil {
			return err
		}
		if remaining == 0 {
			return response.ErrForbidden.WithMessage("这是最后一个超级管理员，不能删除")
		}
	}
	if err := s.repos.Admin.Delete(ctx, id); err != nil {
		return err
	}
	s.audit.Write(ctx, s.repos, audit, "admin.delete", "admin", fmt.Sprint(id), admin.Username,
		"删除管理员账号")
	return nil
}

/* ------------------------------------------------------------------ 内部 */

func (s *AdminService) issueTokens(ctx context.Context, admin *model.Admin) (*dto.TokenPair, error) {
	accessToken, expiresAt, err := s.tokens.GenerateAdminAccessToken(admin.ID, admin.Role)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	refreshToken, err := s.tokens.GenerateRefreshToken()
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	subject := auth.Subject{Kind: auth.KindAdmin, ID: admin.ID, Role: admin.Role}
	if err := s.store.Save(ctx, refreshToken, subject, s.tokens.RefreshTTL()); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &dto.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(time.Until(expiresAt).Seconds()),
		ExpiresAt:    expiresAt,
	}, nil
}

func displayName(admin *model.Admin) string {
	if admin.Nickname != "" {
		return admin.Nickname
	}
	return admin.Username
}

func valueOrEmpty(v string) string {
	if strings.TrimSpace(v) == "" {
		return "（未填写）"
	}
	return strings.TrimSpace(v)
}
