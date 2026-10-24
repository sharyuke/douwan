// Package service 是业务层：编排仓储、鉴权与事务，返回业务错误。
package service

import (
	"context"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// SignupCreditGift 是新用户注册时赠送的 AI Credits。
// 当前为 0（不赠送）；要开活动就改这里，流水会自动记一条。
const SignupCreditGift = 0

// UserService 账号与鉴权相关业务。
type UserService struct {
	db     *gorm.DB
	repos  *repository.Repositories
	tokens *auth.Manager
	store  auth.TokenStore
}

// NewUserService 构造用户服务。
func NewUserService(db *gorm.DB, tokens *auth.Manager, store auth.TokenStore) *UserService {
	return &UserService{db: db, repos: repository.New(db), tokens: tokens, store: store}
}

// Register 注册并直接登录。用户、订阅、Credits 账户、统计在同一事务里建，
// 避免出现「账号建好了但权益数据缺失」的半成品。
func (s *UserService) Register(ctx context.Context, req dto.RegisterRequest) (*dto.AuthResult, error) {
	if err := s.ensureUnique(ctx, req); err != nil {
		return nil, err
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}

	nickname := req.Nickname
	if nickname == "" {
		nickname = req.Username
	}
	acq := resolveAcquisition(req.Channel, req.UTMSource, req.Referrer, req.SiteHost)
	user := &model.User{
		Username:     req.Username,
		Email:        req.Email,
		Phone:        req.Phone,
		PasswordHash: hash,
		Nickname:     nickname,
		Status:       model.UserStatusActive,
		// 来源渠道在注册这一刻定下来（首触归因），之后不再改写
		Channel:       acq.Channel,
		ChannelDetail: acq.Detail,
	}

	err = database.WithTx(ctx, s.db, func(tx *gorm.DB) error {
		repos := s.repos.WithTx(tx)
		if err := repos.User.Create(ctx, user); err != nil {
			return err
		}
		if err := repos.Membership.Upsert(ctx, &model.Membership{
			UserID: user.ID,
			Plan:   model.PlanFree,
			Source: "signup",
		}); err != nil {
			return err
		}
		if err := repos.Credit.EnsureAccount(ctx, user.ID); err != nil {
			return err
		}
		if SignupCreditGift > 0 {
			if err := repos.Credit.CreateTransaction(ctx, &model.CreditTransaction{
				UserID:       user.ID,
				Delta:        SignupCreditGift,
				BalanceAfter: SignupCreditGift,
				Reason:       "signup_gift",
				Note:         "新用户注册赠送",
			}); err != nil {
				return err
			}
		}
		return repos.Usage.Ensure(ctx, user.ID)
	})
	if err != nil {
		return nil, err
	}

	tokens, err := s.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return &dto.AuthResult{User: dto.NewUserProfile(user), Tokens: *tokens}, nil
}

// Login 校验账号密码并签发令牌。
func (s *UserService) Login(ctx context.Context, req dto.LoginRequest) (*dto.AuthResult, error) {
	user, err := s.repos.User.FindByAccount(ctx, req.Account)
	if err != nil {
		return nil, err
	}
	if err := auth.VerifyPassword(user.PasswordHash, req.Password); err != nil {
		return nil, err
	}
	if !user.IsActive() {
		return nil, response.ErrAccountDisabled
	}

	now := time.Now()
	if err := s.repos.User.TouchLastLogin(ctx, user.ID, now); err != nil {
		// 登录时间只是辅助信息，写失败不该拦住登录
		user.LastLoginAt = nil
	} else {
		user.LastLoginAt = &now
	}
	s.fillChannelOnce(ctx, user, req.Channel, req.UTMSource, req.Referrer, req.SiteHost)

	tokens, err := s.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return &dto.AuthResult{User: dto.NewUserProfile(user), Tokens: *tokens}, nil
}

// fillChannelOnce 给「还没有渠道记录」的老用户补一次首触渠道。
//
// 背景：渠道字段是活跃监控上线时新增的，此前注册的用户都是空的。
// 与其让他们永远落在「未知来源」，不如在他们下次带着来源信息登录时补上——
// 只补一次，之后绝不改写（否则渠道报表会随活动漂移）。
func (s *UserService) fillChannelOnce(ctx context.Context, user *model.User, channel, utm, referrer, siteHost string) {
	if user == nil || user.Channel != "" {
		return
	}
	acq := resolveAcquisition(channel, utm, referrer, siteHost)
	if acq.Channel == "" {
		return
	}
	err := s.repos.User.UpdateFields(ctx, user.ID, map[string]any{
		"channel":        acq.Channel,
		"channel_detail": acq.Detail,
	})
	if err != nil {
		// 渠道只是统计维度，写失败不该影响登录
		return
	}
	user.Channel = acq.Channel
	user.ChannelDetail = acq.Detail
}

/* -------------------------------------------------------------- 来源渠道 */

// acquisition 是一次注册 / 登录请求解析出来的来源渠道。
type acquisition struct {
	// Channel 归一化后的短标识（direct / gitee / weibo ...），空表示未知
	Channel string
	// Detail 原始值（完整 utm 串或 referrer），便于事后核对
	Detail string
}

// resolveAcquisition 按「channel → utm_source → referrer」的优先级解析首触渠道。
//
// referrer 属于自己站点时记为「直接访问」：用户在站内点来点去不该被算成
// 外部渠道，否则几乎每个自然用户都会把自己的域名带上，渠道报表就废了。
func resolveAcquisition(channel, utm, referrer, siteHost string) acquisition {
	if raw := firstNonEmpty(channel, utm); strings.TrimSpace(raw) != "" {
		return acquisition{Channel: model.NormalizeChannel(raw), Detail: truncateUTF8(raw, 255)}
	}
	referrer = strings.TrimSpace(referrer)
	if referrer == "" {
		return acquisition{}
	}
	host := referrerHost(referrer)
	if host != "" && sameHost(host, siteHost) {
		return acquisition{Channel: model.ChannelDirect, Detail: truncateUTF8(referrer, 255)}
	}
	label := host
	if label == "" {
		label = referrer
	}
	return acquisition{Channel: model.NormalizeChannel(label), Detail: truncateUTF8(referrer, 255)}
}

// referrerHost 从来源地址里取主机名。允许只传域名（没有协议头）。
func referrerHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		if i := strings.IndexAny(raw, "/?#"); i >= 0 {
			raw = raw[:i]
		}
		return strings.ToLower(strings.Trim(raw, " "))
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// sameHost 比较两个主机名，忽略端口。
func sameHost(host, siteHost string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	siteHost = strings.ToLower(strings.TrimSpace(siteHost))
	if host == "" || siteHost == "" {
		return false
	}
	if i := strings.Index(siteHost, ":"); i >= 0 {
		siteHost = siteHost[:i]
	}
	return host == siteHost
}

// truncateUTF8 按字节上限截断，并保证不切断多字节字符。
func truncateUTF8(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}

// Refresh 用刷新令牌换新令牌对，并轮换刷新令牌（旧的立即作废）。
func (s *UserService) Refresh(ctx context.Context, refreshToken string) (*dto.AuthResult, error) {
	subject, err := s.store.Subject(ctx, refreshToken)
	if err != nil {
		return nil, err
	}
	// 管理员令牌不能用来刷前台令牌
	if subject.Kind == auth.KindAdmin {
		return nil, response.ErrTokenInvalid.WithMessage("登录凭证无效，请重新登录")
	}
	user, err := s.repos.User.FindByID(ctx, subject.ID)
	if err != nil {
		return nil, err
	}
	if !user.IsActive() {
		return nil, response.ErrAccountDisabled
	}

	tokens, err := s.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	// 先签发新的再删旧的：删除失败时用户手上至少还有一个能用的令牌
	if err := s.store.Delete(ctx, refreshToken); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &dto.AuthResult{User: dto.NewUserProfile(user), Tokens: *tokens}, nil
}

// Logout 撤销刷新令牌。令牌不存在时也返回成功，保证接口幂等。
func (s *UserService) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	if err := s.store.Delete(ctx, refreshToken); err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// Profile 返回「我的账户」需要的聚合信息。
func (s *UserService) Profile(ctx context.Context, userID uint64) (*dto.MeResult, error) {
	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	membership, err := s.repos.Membership.FindByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	account, err := s.repos.Credit.FindAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	usage, err := s.repos.Usage.Find(ctx, userID)
	if err != nil {
		return nil, err
	}

	result := &dto.MeResult{
		User:       dto.NewUserProfile(user),
		Membership: dto.NewMembershipInfo(membership, time.Now()),
	}
	if account != nil {
		result.Credits.Balance = account.Balance
	}
	if usage != nil {
		result.Usage = dto.UsageInfo{
			Generated: usage.Generated,
			Exported:  usage.Exported,
			AICalls:   usage.AICalls,
		}
	}
	return result, nil
}

// UpdateProfile 修改昵称与头像。
func (s *UserService) UpdateProfile(ctx context.Context, userID uint64, req dto.UpdateProfileRequest) (*dto.UserProfile, error) {
	fields := make(map[string]any, 2)
	if req.Nickname != nil {
		fields["nickname"] = *req.Nickname
	}
	if req.AvatarURL != nil {
		fields["avatar_url"] = *req.AvatarURL
	}
	if err := s.repos.User.UpdateFields(ctx, userID, fields); err != nil {
		return nil, err
	}
	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	profile := dto.NewUserProfile(user)
	return &profile, nil
}

// ensureUnique 检查用户名 / 邮箱 / 手机号是否已被占用。
// 数据库唯一索引是最终保证，这里只是把错误提前，给出更准确的提示。
func (s *UserService) ensureUnique(ctx context.Context, req dto.RegisterRequest) error {
	checks := []struct {
		field string
		value string
	}{
		{"username", req.Username},
		{"email", req.Email},
		{"phone", req.Phone},
	}
	for _, c := range checks {
		exists, err := s.repos.User.ExistsByField(ctx, c.field, c.value)
		if err != nil {
			return err
		}
		if exists {
			return response.ErrUserExists.WithMessage("该" + fieldLabel(c.field) + "已被注册")
		}
	}
	return nil
}

func fieldLabel(field string) string {
	switch field {
	case "username":
		return "用户名"
	case "email":
		return "邮箱"
	case "phone":
		return "手机号"
	default:
		return field
	}
}

// issueTokens 签发令牌对，并把刷新令牌写入存储。
func (s *UserService) issueTokens(ctx context.Context, userID uint64) (*dto.TokenPair, error) {
	accessToken, expiresAt, err := s.tokens.GenerateAccessToken(userID)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	refreshToken, err := s.tokens.GenerateRefreshToken()
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	if err := s.store.Save(ctx, refreshToken, auth.Subject{Kind: auth.KindUser, ID: userID}, s.tokens.RefreshTTL()); err != nil {
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
