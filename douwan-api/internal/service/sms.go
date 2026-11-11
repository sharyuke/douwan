// 手机短信验证码：发码（频控 + 防刷）与验证码登录 / 注册。
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/sms"
)

// phoneRE 中国大陆手机号。
var phoneRE = regexp.MustCompile(`^1[3-9]\d{9}$`)

// smsCleanupOlderThan 发码时顺手清理多老的验证码记录。
const smsCleanupOlderThan = 48 * time.Hour

// SmsService 短信验证码登录服务。
type SmsService struct {
	db      *gorm.DB
	repos   *repository.Repositories
	tokens  *auth.Manager
	store   auth.TokenStore
	sender  sms.Sender
	cfg     config.SMS
	hashKey string
}

// NewSmsService 构造服务。sender 为 nil 时功能不可用（返回 configured=false）。
// hashKey 用于验证码哈希（复用 JWT 密钥即可，不新增一份要保管的密钥）。
func NewSmsService(db *gorm.DB, repos *repository.Repositories, tokens *auth.Manager,
	store auth.TokenStore, sender sms.Sender, cfg config.SMS, hashKey string) *SmsService {
	if cfg.CodeTTL <= 0 {
		cfg.CodeTTL = 5 * time.Minute
	}
	if cfg.SendInterval <= 0 {
		cfg.SendInterval = time.Minute
	}
	if cfg.MaxPerPhonePerDay <= 0 {
		cfg.MaxPerPhonePerDay = 10
	}
	if cfg.MaxPerIPPerDay <= 0 {
		cfg.MaxPerIPPerDay = 30
	}
	if cfg.MaxVerifyAttempts <= 0 {
		cfg.MaxVerifyAttempts = 5
	}
	return &SmsService{
		db: db, repos: repos, tokens: tokens, store: store,
		sender: sender, cfg: cfg, hashKey: hashKey,
	}
}

// Configured 判断手机号登录是否可用。
func (s *SmsService) Configured() bool {
	return s != nil && s.sender != nil
}

// normalizePhone 校验并归一手机号。非法返回空串。
func normalizePhone(raw string) string {
	return strings.TrimSpace(raw)
}

// Status 返回手机号登录可用性。
func (s *SmsService) Status() dto.SmsStatusResult {
	return dto.SmsStatusResult{Configured: s.Configured()}
}

// SendCode 给手机号发验证码。频控三层：同号间隔 / 同号日限 / 同 IP 日限。
func (s *SmsService) SendCode(ctx context.Context, rawPhone, ip string) error {
	if !s.Configured() {
		return response.ErrSmsDisabled
	}
	phone := normalizePhone(rawPhone)
	if !phoneRE.MatchString(phone) {
		return response.ErrInvalidParam.WithMessage("请输入正确的手机号")
	}
	now := time.Now()

	// 同一手机号 60 秒一条
	last, err := s.repos.SmsCode.CountRecentByPhone(ctx, phone, now.Add(-s.cfg.SendInterval))
	if err != nil {
		return err
	}
	if last > 0 {
		return response.ErrSmsTooFrequent
	}
	// 同一手机号每天上限
	dayStart := now.Add(-24 * time.Hour)
	phoneToday, err := s.repos.SmsCode.CountRecentByPhone(ctx, phone, dayStart)
	if err != nil {
		return err
	}
	if phoneToday >= int64(s.cfg.MaxPerPhonePerDay) {
		return response.ErrSmsDailyLimited
	}
	// 同一 IP 每天上限（匿名接口，必须给脚本上锁）
	if ip != "" {
		ipToday, err := s.repos.SmsCode.CountRecentByIP(ctx, ip, dayStart)
		if err != nil {
			return err
		}
		if ipToday >= int64(s.cfg.MaxPerIPPerDay) {
			return response.ErrSmsDailyLimited
		}
	}

	code, err := randomCode()
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	// 先发再落库：发送失败就不留记录，用户重试不会被频控卡住
	if err := s.sender.SendCode(ctx, phone, code); err != nil {
		return response.ErrSmsSendFailed.WithCause(err)
	}
	if err := s.repos.SmsCode.Create(ctx, &model.SmsCode{
		Phone:     phone,
		CodeHash:  s.hash(phone, code),
		IP:        ip,
		ExpiresAt: now.Add(s.cfg.CodeTTL),
	}); err != nil {
		return err
	}
	// 顺手清旧记录，失败不影响发码
	_ = s.repos.SmsCode.DeleteBefore(ctx, now.Add(-smsCleanupOlderThan))
	return nil
}

// Login 用手机验证码登录；手机号未注册时自动创建账号并登录。
func (s *SmsService) Login(ctx context.Context, req dto.SmsLoginRequest) (*dto.AuthResult, error) {
	if !s.Configured() {
		return nil, response.ErrSmsDisabled
	}
	phone := normalizePhone(req.Phone)
	if !phoneRE.MatchString(phone) {
		return nil, response.ErrInvalidParam.WithMessage("请输入正确的手机号")
	}
	code := strings.TrimSpace(req.Code)
	if code == "" {
		return nil, response.ErrInvalidParam.WithMessage("请输入验证码")
	}
	now := time.Now()

	record, err := s.repos.SmsCode.FindLatestActive(ctx, phone, now)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, response.ErrSmsCodeWrong
	}
	if record.Attempts >= s.cfg.MaxVerifyAttempts {
		return nil, response.ErrSmsCodeWrong
	}
	if record.CodeHash != s.hash(phone, code) {
		// 记一次错误尝试；写失败也照样拒绝，安全侧优先
		_ = s.repos.SmsCode.IncrementAttempts(ctx, record.ID)
		return nil, response.ErrSmsCodeWrong
	}
	if err := s.repos.SmsCode.MarkUsed(ctx, record.ID, now); err != nil {
		return nil, err
	}

	user, err := s.repos.User.FindByPhone(ctx, phone)
	if err != nil {
		return nil, err
	}
	if user == nil {
		user, err = s.createUser(ctx, phone, req)
		if err != nil {
			return nil, err
		}
	}
	if !user.IsActive() {
		return nil, response.ErrAccountDisabled
	}

	if err := s.repos.User.TouchLastLogin(ctx, user.ID, now); err == nil {
		user.LastLoginAt = &now
	}
	// 首触渠道：与密码登录同一口径，只补一次（fillChannelOnce 挂在 UserService 上，
	// 这里按同样规则直接写）。写失败不影响登录。
	if user.Channel == "" {
		if acq := resolveAcquisition(req.Channel, req.UTMSource, req.Referrer, req.SiteHost); acq.Channel != "" {
			if err := s.repos.User.UpdateFields(ctx, user.ID, map[string]any{
				"channel":        acq.Channel,
				"channel_detail": acq.Detail,
			}); err == nil {
				user.Channel = acq.Channel
				user.ChannelDetail = acq.Detail
			}
		}
	}

	tokens, err := s.issueTokens(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return &dto.AuthResult{User: dto.NewUserProfile(user), Tokens: *tokens}, nil
}

// createUser 给新手机号建账号：随机不可用密码（用户走验证码登录），
// 用户名 = sj + 手机号（撞车时加随机后缀），权益数据与 Register 同一套事务。
func (s *SmsService) createUser(ctx context.Context, phone string, req dto.SmsLoginRequest) (*model.User, error) {
	// 随机 32 位密码：没人知道它，密码登录自然进不来这个账号
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	hash, err := auth.HashPassword(hex.EncodeToString(buf))
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}

	acq := resolveAcquisition(req.Channel, req.UTMSource, req.Referrer, req.SiteHost)
	user := &model.User{
		Username:      "sj" + phone,
		Phone:         phone,
		PasswordHash:  hash,
		Nickname:      "手机用户" + phone[len(phone)-4:],
		Status:        model.UserStatusActive,
		Channel:       acq.Channel,
		ChannelDetail: acq.Detail,
	}
	err = database.WithTx(ctx, s.db, func(tx *gorm.DB) error {
		repos := s.repos.WithTx(tx)
		if err := repos.User.Create(ctx, user); err != nil {
			// 用户名理论上一手机号一个，撞了就换随机后缀重试（并发的自己）
			if response.From(err) != nil && response.From(err).Code == response.CodeUserExists && strings.HasSuffix(user.Username, phone) {
				user.Username = "sj" + phone + randomSuffix()
				return repos.User.Create(ctx, user)
			}
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
		return repos.Usage.Ensure(ctx, user.ID)
	})
	if err != nil {
		return nil, err
	}
	return user, nil
}

// hash 验证码哈希：HMAC 更合适，但这里密钥本就是高熵随机串，
// sha256(密钥 || phone || code) 已足够（数据库泄露也还原不出验证码）。
func (s *SmsService) hash(phone, code string) string {
	sum := sha256.Sum256([]byte(s.hashKey + "|" + phone + "|" + code))
	return hex.EncodeToString(sum[:])
}

// issueTokens 与 UserService 相同口径：访问令牌 + 轮换的刷新令牌。
func (s *SmsService) issueTokens(ctx context.Context, userID uint64) (*dto.TokenPair, error) {
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

// randomCode 生成 6 位数字验证码（crypto/rand，前导零保留）。
func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", fmt.Errorf("生成验证码: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// randomSuffix 4 位小写字母数字后缀，给撞名的用户名兜底。
func randomSuffix() string {
	buf := make([]byte, 4)
	if _, err := rand.Read(buf); err != nil {
		return "0000"
	}
	const chars = "abcdefghijkmnpqrstuvwxyz23456789"
	out := make([]byte, 4)
	for i, b := range buf {
		out[i] = chars[int(b)%len(chars)]
	}
	return string(out)
}
