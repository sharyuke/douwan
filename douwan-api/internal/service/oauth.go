package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/oauth"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// oauthProvider 抽象一个第三方登录方式的授权地址与资料交换，便于单测替换成假实现。
type oauthProvider interface {
	AuthorizeURL(state string) string
	Exchange(ctx context.Context, code string) (*oauth.Profile, error)
}

// availabilityProvider 在通用能力之外还支持授权页预检。
type availabilityProvider interface {
	oauthProvider
	CheckAvailability(ctx context.Context) (oauth.Availability, error)
}

type qqProvider = availabilityProvider
type wechatProvider = availabilityProvider

// qqProbe 缓存 QQ 授权页预检结果。QQ 互联的开通状态变化不频繁，
// 10 分钟一次足够，也能避免每次点登录都去请求腾讯。
type qqProbe struct {
	checked bool
	enabled bool
	code    string
}

const qqProbeTTL = 10 * time.Minute

// qqProbeMinRefresh 是「重新检查」的最小间隔。状态接口是公开的，
// 不能让任何人反复触发对 QQ 的请求。
const qqProbeMinRefresh = 15 * time.Second

// OAuthService 第三方登录。
//
// QQ 与微信都走真实 OAuth；微信没有可预检的授权页，状态只反映配置是否齐全。
type OAuthService struct {
	users  *UserService
	repos  *repository.Repositories
	cfg    config.OAuth
	tokens *auth.Manager
	qq     qqProvider
	wechat wechatProvider
	audit  *AuditLog

	probeMu sync.Mutex
	probeAt time.Time
	probe   qqProbe

	wechatProbeMu sync.Mutex
	wechatProbeAt time.Time
	wechatProbe   qqProbe
}

// NewOAuthService 构造第三方登录服务。
func NewOAuthService(users *UserService, cfg config.OAuth, tokens *auth.Manager, audit *AuditLog) *OAuthService {
	if audit == nil {
		audit = NewAuditLog()
	}
	return &OAuthService{
		users:  users,
		repos:  repository.New(users.db),
		cfg:    cfg,
		tokens: tokens,
		qq:     oauth.NewQQClient(cfg.QQ),
		wechat: oauth.NewWeChatClient(cfg.WeChat),
		audit:  audit,
	}
}

// providerMeta 是各登录方式在账号、审计与展示上的差异。
type providerMeta struct {
	prefix        string // 自动创建账号的用户名前缀
	label         string // 用户可读名称
	channelDetail string // 渠道明细
	signupSource  string // 会员来源标记
}

func metaOf(provider string) providerMeta {
	if provider == model.ProviderWeChat {
		return providerMeta{
			prefix:        "wx_",
			label:         "微信",
			channelDetail: "微信登录",
			signupSource:  "wechat_signup",
		}
	}
	return providerMeta{
		prefix:        "qq_",
		label:         "QQ",
		channelDetail: "QQ 登录",
		signupSource:  "qq_signup",
	}
}

// client 返回已配置好的登录方式；缺配置时返回明确的业务错误。
func (s *OAuthService) client(ctx context.Context, provider string) (oauthProvider, providerMeta, error) {
	meta := metaOf(provider)
	switch provider {
	case model.ProviderQQ:
		if !s.cfg.QQ.Enabled() {
			// 只写「缺哪些配置项」，绝不打印 app_key 的值
			slog.ErrorContext(ctx, "QQ 登录未配置，无法发起授权",
				"has_app_id", strings.TrimSpace(s.cfg.QQ.AppID) != "",
				"has_app_key", strings.TrimSpace(s.cfg.QQ.AppKey) != "",
				"has_redirect_uri", strings.TrimSpace(s.cfg.QQ.RedirectURI) != "")
			return nil, meta, response.ErrOAuthNotConfigured.WithMessage(
				"QQ 登录暂未配置，请联系管理员完成服务器配置。")
		}
		return s.qq, meta, nil
	case model.ProviderWeChat:
		if !s.cfg.WeChat.Enabled() {
			slog.ErrorContext(ctx, "微信登录未配置，无法发起授权",
				"has_app_id", strings.TrimSpace(s.cfg.WeChat.AppID) != "",
				"has_app_secret", strings.TrimSpace(s.cfg.WeChat.AppSecret) != "",
				"has_redirect_uri", strings.TrimSpace(s.cfg.WeChat.RedirectURI) != "")
			return nil, meta, response.ErrOAuthNotConfigured.WithMessage(
				"微信登录暂未配置，请联系管理员完成服务器配置。")
		}
		return s.wechat, meta, nil
	default:
		return nil, meta, response.ErrInvalidParam.WithMessage("不支持的登录方式")
	}
}

// Start 生成第三方授权地址。
//
// mode=bind 时必须已经登录（userID > 0），state 里带上要绑定的账号；
// mode=login 时 userID 必须为 0，回调按 openid 找账号或新建账号。
func (s *OAuthService) Start(ctx context.Context, provider, mode string, userID uint64) (*dto.OAuthStartResult, error) {
	client, _, err := s.client(ctx, provider)
	if err != nil {
		return nil, err
	}
	if mode == "" {
		mode = auth.OAuthModeLogin
	}
	if mode != auth.OAuthModeLogin && mode != auth.OAuthModeBind {
		return nil, response.ErrInvalidParam.WithMessage("不支持的登录模式")
	}
	if mode == auth.OAuthModeBind && userID == 0 {
		return nil, response.ErrUnauthorized.WithMessage("绑定第三方账号前请先登录")
	}
	if mode == auth.OAuthModeLogin && userID != 0 {
		return nil, response.ErrInvalidParam.WithMessage("已登录账号请使用绑定模式")
	}
	// 应用未开通 / AppID 类型不对时，授权页只会在页面里写错误。
	// 提前拦下来，不把用户送到平台的死胡同页面。
	if provider == model.ProviderQQ {
		if avail := s.qqAvailability(ctx); avail.checked && !avail.enabled {
			return nil, response.ErrOAuthAppNotEnabled.WithMessage(qqUnavailableMessage(avail.code))
		}
	}
	if provider == model.ProviderWeChat {
		if avail := s.wechatAvailability(ctx); avail.checked && !avail.enabled {
			return nil, response.ErrOAuthAppNotEnabled.WithMessage(wechatUnavailableMessage(avail.code))
		}
	}

	state, err := s.tokens.SignOAuthStateFor(provider, userID, mode, s.cfg.StateTTL)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return &dto.OAuthStartResult{
		URL:        client.AuthorizeURL(state),
		State:      state,
		Configured: true,
	}, nil
}

// Status 返回某个第三方登录方式的可用状态。
//
// QQ 会做一次授权页预检（10 分钟缓存），把「应用未开通」这类
// 只能在 QQ 页面上看到的错误提前告诉前端，避免用户被带到死胡同。
// 微信只反映服务端配置是否齐全。
func (s *OAuthService) Status(ctx context.Context, provider string, force bool) (*dto.OAuthProviderStatus, error) {
	if provider == model.ProviderWeChat {
		if !s.cfg.WeChat.Enabled() {
			return &dto.OAuthProviderStatus{
				Provider:   provider,
				Configured: false,
				Available:  false,
				Checked:    true,
				Reason:     "not_configured",
				Message:    "微信登录暂未配置，请联系管理员完成服务器配置。",
			}, nil
		}
		if force {
			s.wechatProbeMu.Lock()
			if time.Since(s.wechatProbeAt) >= qqProbeMinRefresh {
				s.wechatProbeAt = time.Time{}
			}
			s.wechatProbeMu.Unlock()
		}
		avail := s.wechatAvailability(ctx)
		status := &dto.OAuthProviderStatus{
			Provider:   provider,
			Configured: true,
			Available:  true,
			Checked:    avail.checked,
		}
		if avail.checked && !avail.enabled {
			status.Available = false
			status.Reason = "app_not_enabled"
			status.Message = wechatUnavailableMessage(avail.code)
		} else if !avail.checked {
			status.Reason = "unchecked"
			status.Message = "暂时无法确认微信登录状态，可以点击尝试。"
		}
		return status, nil
	}
	if provider != model.ProviderQQ {
		return nil, response.ErrInvalidParam.WithMessage("不支持的登录方式")
	}
	if !s.cfg.QQ.Enabled() {
		return &dto.OAuthProviderStatus{
			Provider:   provider,
			Configured: false,
			Available:  false,
			Checked:    true,
			Reason:     "not_configured",
			Message:    "QQ 登录暂未配置，请联系管理员完成服务器配置。",
		}, nil
	}
	if force {
		// 用户点「重新检查」时跳过缓存，方便 QQ 刚开通就立刻验证；
		// 但 15 秒内重复点击仍读缓存，避免公开接口被用来刷 QQ。
		s.probeMu.Lock()
		if time.Since(s.probeAt) >= qqProbeMinRefresh {
			s.probeAt = time.Time{}
		}
		s.probeMu.Unlock()
	}
	avail := s.qqAvailability(ctx)
	status := &dto.OAuthProviderStatus{
		Provider:   provider,
		Configured: true,
		Available:  true,
		Checked:    avail.checked,
	}
	if avail.checked && !avail.enabled {
		status.Available = false
		status.Reason = "provider_error"
		if avail.code == "100008" {
			status.Reason = "app_not_enabled"
		}
		status.Message = qqUnavailableMessage(avail.code)
	} else if !avail.checked {
		status.Reason = "unchecked"
		status.Message = "暂时无法确认 QQ 登录状态，可以点击尝试。"
	}
	return status, nil
}

func (s *OAuthService) qqAvailability(ctx context.Context) qqProbe {
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	if !s.probeAt.IsZero() && time.Since(s.probeAt) < qqProbeTTL {
		return s.probe
	}
	avail, err := s.qq.CheckAvailability(ctx)
	now := time.Now()
	if err != nil {
		// 预检失败不挡登录：QQ 偶发超时不应该让所有人登不进来。
		slog.WarnContext(ctx, "QQ 授权页预检失败，暂按可用处理", "err", err)
		s.probeAt = now
		s.probe = qqProbe{checked: false, enabled: true}
		return s.probe
	}
	s.probeAt = now
	s.probe = qqProbe{checked: true, enabled: avail.Enabled, code: avail.Code}
	return s.probe
}

func (s *OAuthService) wechatAvailability(ctx context.Context) qqProbe {
	s.wechatProbeMu.Lock()
	defer s.wechatProbeMu.Unlock()
	if !s.wechatProbeAt.IsZero() && time.Since(s.wechatProbeAt) < qqProbeTTL {
		return s.wechatProbe
	}
	avail, err := s.wechat.CheckAvailability(ctx)
	now := time.Now()
	if err != nil {
		// 预检失败不挡登录：微信偶发超时不应该让所有人登不进来。
		slog.WarnContext(ctx, "微信授权页预检失败，暂按可用处理", "err", err)
		s.wechatProbeAt = now
		s.wechatProbe = qqProbe{checked: false, enabled: true}
		return s.wechatProbe
	}
	s.wechatProbeAt = now
	s.wechatProbe = qqProbe{checked: true, enabled: avail.Enabled, code: avail.Code}
	return s.wechatProbe
}

func wechatUnavailableMessage(code string) string {
	if code == "appid_invalid" {
		return "微信登录暂不可用：当前 AppID 不是微信开放平台「网站应用」，无法使用扫码登录。请在微信开放平台创建网站应用并通过审核后更换 AppID。"
	}
	if code != "" {
		return "微信登录暂不可用（微信返回错误码 " + code + "），请稍后再试或使用 QQ 登录。"
	}
	return "微信登录暂不可用，请稍后再试或使用 QQ 登录。"
}

func qqUnavailableMessage(code string) string {
	if code == "100008" {
		return "QQ 登录正在等待 QQ 互联开通（错误码 100008）。审核通过后会自动恢复，期间可以先使用微信登录。"
	}
	if code != "" {
		return "QQ 登录暂不可用（QQ 返回错误码 " + code + "），请稍后再试或使用微信登录。"
	}
	return "QQ 登录暂不可用，请稍后再试或使用微信登录。"
}

// Callback 处理第三方回调：校验 state、换资料、找账号或建账号、签发令牌。
//
// provider 必须与 state 里签发的登录方式一致，避免跨平台复用授权码。
// 返回值里的 AuthResult 由 handler 写进前端 URL 的 hash；
// 本函数不负责跳转，方便单测直接断言。
func (s *OAuthService) Callback(ctx context.Context, provider, code, state string, audit Audit) (*dto.AuthResult, *dto.OAuthCallbackResult, error) {
	if strings.TrimSpace(code) == "" || strings.TrimSpace(state) == "" {
		return nil, nil, response.ErrOAuthStateInvalid
	}
	payload, err := s.tokens.ParseOAuthState(state)
	if err != nil {
		return nil, nil, err
	}
	if payload.Provider != provider {
		return nil, nil, response.ErrOAuthStateInvalid.WithMessage("登录状态与当前登录方式不匹配，请重新登录")
	}
	client, meta, err := s.client(ctx, provider)
	if err != nil {
		return nil, nil, err
	}

	profile, err := client.Exchange(ctx, code)
	if err != nil {
		slog.WarnContext(ctx, meta.label+"授权码换取资料失败", "err", err)
		return nil, nil, response.ErrOAuthFailed.WithMessage(meta.label + "登录失败，请稍后重试")
	}

	if payload.Mode == auth.OAuthModeBind {
		return s.bind(ctx, provider, payload.UserID, profile, audit)
	}
	return s.login(ctx, provider, profile, audit)
}

func (s *OAuthService) login(ctx context.Context, provider string, profile *oauth.Profile, audit Audit) (*dto.AuthResult, *dto.OAuthCallbackResult, error) {
	meta := metaOf(provider)
	identity, err := s.repos.Identity.FindByProvider(ctx, provider, profile.OpenID)
	if err != nil {
		return nil, nil, err
	}
	isNew := false
	var user *model.User
	if identity != nil {
		user, err = s.repos.User.FindByID(ctx, identity.UserID)
		if err != nil {
			return nil, nil, err
		}
		if !user.IsActive() {
			return nil, nil, response.ErrAccountDisabled
		}
		now := time.Now()
		if err := s.repos.Identity.TouchLogin(ctx, identity.ID, profile.Nickname, profile.AvatarURL, now); err != nil {
			slog.WarnContext(ctx, "更新"+meta.label+"身份资料失败", "err", err)
		}
		_ = s.repos.User.TouchLastLogin(ctx, user.ID, now)
	} else {
		user, err = s.createUser(ctx, provider, profile)
		if err != nil {
			return nil, nil, err
		}
		isNew = true
	}

	tokens, err := s.users.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, nil, err
	}
	action := meta.label + " 登录成功"
	if isNew {
		action = meta.label + " 首次登录，自动创建账号"
	}
	s.writeUserAudit(ctx, audit, user, ActionOAuthLogin, action)
	return &dto.AuthResult{User: dto.NewUserProfile(user), Tokens: *tokens},
		&dto.OAuthCallbackResult{Provider: provider, IsNew: isNew},
		nil
}

// writeUserAudit 记录前台账号动作。操作日志表没有「用户」角色，
// 这里用 AdminID=0 + AdminRole=user 区分后台管理员操作。
func (s *OAuthService) writeUserAudit(ctx context.Context, audit Audit, user *model.User, action, detail string) {
	if s.audit == nil || user == nil {
		return
	}
	a := audit
	a.AdminID = 0
	a.AdminName = user.Username
	a.AdminRole = "user"
	s.audit.Write(ctx, s.repos, a, action, "user", fmt.Sprint(user.ID), user.Username, detail)
}

// createUser 首次第三方登录时建账号。
//
// 用户名是随机的 qq_xxxx / wx_xxxx（不是昵称）：昵称可重复、可改，
// 拿它当唯一键迟早撞车。PasswordHash 刻意留空：这个账号只有一种第三方
// 登录方式。留空后密码登录会被拒绝，账号页也能正确判断「没有密码」，
// 从而拒绝解绑最后一种登录方式。
func (s *OAuthService) createUser(ctx context.Context, provider string, profile *oauth.Profile) (*model.User, error) {
	meta := metaOf(provider)
	nickname := strings.TrimSpace(profile.Nickname)
	if nickname == "" {
		nickname = meta.label + " 用户"
	}
	if len([]rune(nickname)) > 32 {
		nickname = string([]rune(nickname)[:32])
	}
	user := &model.User{
		Username:      meta.prefix + randomToken(6),
		Nickname:      nickname,
		AvatarURL:     profile.AvatarURL,
		Status:        model.UserStatusActive,
		Channel:       provider,
		ChannelDetail: meta.channelDetail,
	}
	err := database.WithTx(ctx, s.users.db, func(tx *gorm.DB) error {
		repos := s.repos.WithTx(tx)
		if err := repos.User.Create(ctx, user); err != nil {
			return err
		}
		if err := repos.Membership.Upsert(ctx, &model.Membership{
			UserID: user.ID,
			Plan:   model.PlanFree,
			Source: meta.signupSource,
		}); err != nil {
			return err
		}
		if err := repos.Credit.EnsureAccount(ctx, user.ID); err != nil {
			return err
		}
		if err := repos.Usage.Ensure(ctx, user.ID); err != nil {
			return err
		}
		now := time.Now()
		return repos.Identity.Create(ctx, &model.UserIdentity{
			UserID:         user.ID,
			Provider:       provider,
			ProviderOpenID: profile.OpenID,
			UnionID:        profile.UnionID,
			Nickname:       profile.Nickname,
			AvatarURL:      profile.AvatarURL,
			LastLoginAt:    &now,
		})
	})
	if err != nil {
		// 并发首次登录时唯一索引会挡住后到的那个：重新按 openid 找一次，
		// 找到就按「已有账号」继续，不让用户看到一条无意义的失败。
		if errors.Is(err, response.ErrIdentityBound) || errors.Is(err, response.ErrUserExists) {
			existing, findErr := s.repos.Identity.FindByProvider(ctx, provider, profile.OpenID)
			if findErr == nil && existing != nil {
				return s.repos.User.FindByID(ctx, existing.UserID)
			}
		}
		return nil, err
	}
	return user, nil
}

func (s *OAuthService) bind(ctx context.Context, provider string, userID uint64, profile *oauth.Profile, audit Audit) (*dto.AuthResult, *dto.OAuthCallbackResult, error) {
	meta := metaOf(provider)
	if userID == 0 {
		return nil, nil, response.ErrUnauthorized
	}
	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if !user.IsActive() {
		return nil, nil, response.ErrAccountDisabled
	}
	existing, err := s.repos.Identity.FindByProvider(ctx, provider, profile.OpenID)
	if err != nil {
		return nil, nil, err
	}
	if existing != nil {
		if existing.UserID != userID {
			return nil, nil, response.ErrIdentityBound
		}
		// 已经绑过同一个账号：幂等返回
		_ = s.repos.Identity.TouchLogin(ctx, existing.ID, profile.Nickname, profile.AvatarURL, time.Now())
	} else {
		now := time.Now()
		if err := s.repos.Identity.Create(ctx, &model.UserIdentity{
			UserID:         userID,
			Provider:       provider,
			ProviderOpenID: profile.OpenID,
			UnionID:        profile.UnionID,
			Nickname:       profile.Nickname,
			AvatarURL:      profile.AvatarURL,
			LastLoginAt:    &now,
		}); err != nil {
			return nil, nil, err
		}
	}

	tokens, err := s.users.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, nil, err
	}
	s.writeUserAudit(ctx, audit, user, ActionOAuthBind, "绑定 "+meta.label+" 登录")
	return &dto.AuthResult{User: dto.NewUserProfile(user), Tokens: *tokens},
		&dto.OAuthCallbackResult{Provider: provider, Bound: true},
		nil
}

// ListIdentities 账号已绑定的第三方登录方式。
func (s *OAuthService) ListIdentities(ctx context.Context, userID uint64) ([]dto.IdentityInfo, error) {
	rows, err := s.repos.Identity.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.IdentityInfo, 0, len(rows))
	for _, row := range rows {
		out = append(out, dto.NewIdentityInfo(row))
	}
	return out, nil
}

// Unbind 解绑。账号至少要保留一种登录方式：
// 有密码时随便解；没密码时最后一条第三方身份不能解。
func (s *OAuthService) Unbind(ctx context.Context, userID, identityID uint64, audit Audit) error {
	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	rows, err := s.repos.Identity.ListByUser(ctx, userID)
	if err != nil {
		return err
	}
	var target *model.UserIdentity
	for i := range rows {
		if rows[i].ID == identityID {
			target = &rows[i]
			break
		}
	}
	if target == nil {
		return response.ErrIdentityNotFound
	}
	if strings.TrimSpace(user.PasswordHash) == "" && len(rows) <= 1 {
		return response.ErrIdentityLast
	}
	if err := s.repos.Identity.Delete(ctx, identityID, userID); err != nil {
		return err
	}
	s.writeUserAudit(ctx, audit, user, ActionOAuthUnbind,
		"解绑 "+model.ProviderLabel(target.Provider)+" 登录")
	return nil
}

func randomToken(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "fallback" + time.Now().Format("150405")
	}
	return hex.EncodeToString(buf)[:n]
}
