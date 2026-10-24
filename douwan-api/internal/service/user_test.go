package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

func newUserService(t *testing.T) (*service.UserService, *gorm.DB) {
	t.Helper()
	db := testsupport.NewDB(t)
	svc := service.NewUserService(db, testsupport.NewTokens(), testsupport.NewTokenStore(t))
	return svc, db
}

func registerReq() dto.RegisterRequest {
	return dto.RegisterRequest{
		Username: "douwaner",
		Password: "secret-pass-1",
		Nickname: "拼豆小工",
		Email:    "user@douwan.test",
	}
}

// assertCode 断言错误是对应的业务错误码。
func assertCode(t *testing.T, err error, want response.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("期望错误码 %d，实际没有错误", want)
	}
	if got := response.From(err).Code; got != want {
		t.Fatalf("期望错误码 %d，实际 %d（%v）", want, got, err)
	}
}

func TestRegister_CreatesAccountWithDefaults(t *testing.T) {
	svc, db := newUserService(t)
	ctx := context.Background()

	result, err := svc.Register(ctx, registerReq())
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}

	if result.User.ID == 0 {
		t.Fatal("注册后应返回用户 ID")
	}
	// 对外资料序列化后不能出现任何密码相关字段
	raw, err := json.Marshal(result.User)
	if err != nil {
		t.Fatalf("序列化用户资料: %v", err)
	}
	if strings.Contains(strings.ToLower(string(raw)), "password") {
		t.Fatalf("对外资料泄露了密码字段: %s", raw)
	}
	if result.Tokens.AccessToken == "" || result.Tokens.RefreshToken == "" {
		t.Fatal("注册后应同时返回访问令牌与刷新令牌")
	}
	if result.Tokens.ExpiresIn <= 0 {
		t.Fatalf("访问令牌有效期应为正数，实际 %d", result.Tokens.ExpiresIn)
	}
	if result.User.Nickname != "拼豆小工" {
		t.Fatalf("昵称未按请求写入: %q", result.User.Nickname)
	}

	// 注册应当在同一事务里把订阅、Credits 账户、统计都建好
	var membership model.Membership
	if err := db.Where("user_id = ?", result.User.ID).First(&membership).Error; err != nil {
		t.Fatalf("应创建订阅记录: %v", err)
	}
	if membership.Plan != model.PlanFree {
		t.Fatalf("新用户套餐应为 free，实际 %q", membership.Plan)
	}
	var account model.CreditAccount
	if err := db.Where("user_id = ?", result.User.ID).First(&account).Error; err != nil {
		t.Fatalf("应创建 Credits 账户: %v", err)
	}
	var usage model.UsageStat
	if err := db.Where("user_id = ?", result.User.ID).First(&usage).Error; err != nil {
		t.Fatalf("应创建使用统计: %v", err)
	}
}

func TestRegister_RejectsDuplicateUsername(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, registerReq()); err != nil {
		t.Fatalf("首次注册失败: %v", err)
	}

	dup := registerReq()
	dup.Email = "other@douwan.test"
	_, err := svc.Register(ctx, dup)
	assertCode(t, err, response.CodeUserExists)
}

func TestRegister_RejectsDuplicateEmail(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, registerReq()); err != nil {
		t.Fatalf("首次注册失败: %v", err)
	}

	dup := registerReq()
	dup.Username = "another"
	_, err := svc.Register(ctx, dup)
	assertCode(t, err, response.CodeUserExists)
}

// TestRegister_MultipleUsersWithoutOptionalFields 守住「邮箱与手机号是选填」这条：
// 两者都存空串，唯一索引必须排除空串，否则第二个不填的用户会被判成已注册。
func TestRegister_MultipleUsersWithoutOptionalFields(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	for _, username := range []string{"alpha", "bravo", "charlie"} {
		_, err := svc.Register(ctx, dto.RegisterRequest{Username: username, Password: "secret-pass-1"})
		if err != nil {
			t.Fatalf("%s 不填邮箱与手机号应当能注册: %v", username, err)
		}
	}
}

// TestRegister_StillRejectsDuplicateEmail 确认部分唯一索引没有把「真重复」也放过去。
func TestRegister_StillRejectsDuplicateEmail(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	first := registerReq()
	if _, err := svc.Register(ctx, first); err != nil {
		t.Fatalf("首次注册失败: %v", err)
	}

	second := dto.RegisterRequest{Username: "second", Password: "secret-pass-1", Email: first.Email}
	_, err := svc.Register(ctx, second)
	assertCode(t, err, response.CodeUserExists)
}

func TestLogin_ByUsernameAndEmail(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()
	req := registerReq()
	if _, err := svc.Register(ctx, req); err != nil {
		t.Fatalf("注册失败: %v", err)
	}

	for _, account := range []string{req.Username, req.Email} {
		result, err := svc.Login(ctx, dto.LoginRequest{Account: account, Password: req.Password})
		if err != nil {
			t.Fatalf("用 %s 登录失败: %v", account, err)
		}
		if result.User.Username != req.Username {
			t.Fatalf("登录返回的用户不对: %q", result.User.Username)
		}
		if result.User.LastLoginAt == nil {
			t.Fatal("登录后应记录登录时间")
		}
	}
}

func TestLogin_WrongPasswordAndUnknownAccount(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()
	req := registerReq()
	if _, err := svc.Register(ctx, req); err != nil {
		t.Fatalf("注册失败: %v", err)
	}

	_, err := svc.Login(ctx, dto.LoginRequest{Account: req.Username, Password: "wrong-password"})
	assertCode(t, err, response.CodePasswordWrong)

	// 账号不存在与密码错误返回同一个错误，避免被用来枚举账号
	_, err = svc.Login(ctx, dto.LoginRequest{Account: "nobody", Password: req.Password})
	assertCode(t, err, response.CodePasswordWrong)
}

func TestLogin_DisabledAccount(t *testing.T) {
	svc, db := newUserService(t)
	ctx := context.Background()
	req := registerReq()
	result, err := svc.Register(ctx, req)
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", result.User.ID).
		Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatalf("禁用账号失败: %v", err)
	}

	_, err = svc.Login(ctx, dto.LoginRequest{Account: req.Username, Password: req.Password})
	assertCode(t, err, response.CodeAccountDisabled)
}

func TestRefresh_RotatesToken(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	result, err := svc.Register(ctx, registerReq())
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}
	oldRefresh := result.Tokens.RefreshToken

	refreshed, err := svc.Refresh(ctx, oldRefresh)
	if err != nil {
		t.Fatalf("刷新失败: %v", err)
	}
	if refreshed.Tokens.RefreshToken == oldRefresh {
		t.Fatal("刷新后应轮换出新的刷新令牌")
	}

	// 旧的刷新令牌必须立即失效，否则被窃取后可以一直续期
	if _, err := svc.Refresh(ctx, oldRefresh); err == nil {
		t.Fatal("旧刷新令牌应当失效")
	} else {
		assertCode(t, err, response.CodeTokenInvalid)
	}
}

func TestLogout_RevokesRefreshToken(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	result, err := svc.Register(ctx, registerReq())
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}
	if err := svc.Logout(ctx, result.Tokens.RefreshToken); err != nil {
		t.Fatalf("登出失败: %v", err)
	}
	if _, err := svc.Refresh(ctx, result.Tokens.RefreshToken); err == nil {
		t.Fatal("登出后刷新令牌应当失效")
	}
	// 重复登出与空令牌都应视为成功，保证接口幂等
	if err := svc.Logout(ctx, result.Tokens.RefreshToken); err != nil {
		t.Fatalf("重复登出应成功: %v", err)
	}
	if err := svc.Logout(ctx, ""); err != nil {
		t.Fatalf("空令牌登出应成功: %v", err)
	}
}

func TestProfile_AggregatesMembershipCreditsUsage(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	result, err := svc.Register(ctx, registerReq())
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}

	me, err := svc.Profile(ctx, result.User.ID)
	if err != nil {
		t.Fatalf("查询资料失败: %v", err)
	}
	if me.User.Username != "douwaner" {
		t.Fatalf("用户名不对: %q", me.User.Username)
	}
	if me.Membership.Plan != model.PlanFree || me.Membership.IsPro {
		t.Fatalf("免费用户不应被判定为 Pro: %+v", me.Membership)
	}
	if me.Credits.Balance != service.SignupCreditGift {
		t.Fatalf("Credits 余额应为 %d，实际 %d", service.SignupCreditGift, me.Credits.Balance)
	}
}

func TestProfile_UnknownUser(t *testing.T) {
	svc, _ := newUserService(t)
	_, err := svc.Profile(context.Background(), 999)
	assertCode(t, err, response.CodeUserNotFound)
}

func TestUpdateProfile(t *testing.T) {
	svc, _ := newUserService(t)
	ctx := context.Background()

	result, err := svc.Register(ctx, registerReq())
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}

	nickname := "新昵称"
	avatar := "https://cdn.douwan.test/avatar.png"
	profile, err := svc.UpdateProfile(ctx, result.User.ID, dto.UpdateProfileRequest{
		Nickname:  &nickname,
		AvatarURL: &avatar,
	})
	if err != nil {
		t.Fatalf("修改资料失败: %v", err)
	}
	if profile.Nickname != nickname || profile.AvatarURL != avatar {
		t.Fatalf("资料未更新: %+v", profile)
	}

	// 只传昵称时，头像应保持原值
	onlyNickname := "只改昵称"
	profile, err = svc.UpdateProfile(ctx, result.User.ID, dto.UpdateProfileRequest{Nickname: &onlyNickname})
	if err != nil {
		t.Fatalf("修改昵称失败: %v", err)
	}
	if profile.Nickname != onlyNickname {
		t.Fatalf("昵称未更新: %q", profile.Nickname)
	}
	if profile.AvatarURL != avatar {
		t.Fatalf("未传的字段不应被清空: %q", profile.AvatarURL)
	}
}

// TestMembership_IsPro 覆盖订阅判定：无到期时间视为长期有效，过期即回落免费。
func TestMembership_IsPro(t *testing.T) {
	svc, db := newUserService(t)
	ctx := context.Background()

	result, err := svc.Register(ctx, registerReq())
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}

	past := mustTime(t, "2020-01-01T00:00:00Z")
	future := mustTime(t, "2099-01-01T00:00:00Z")

	cases := []struct {
		name string
		plan string
		exp  *time.Time
		want bool
	}{
		{"免费套餐", model.PlanFree, future, false},
		{"Pro 已过期", model.PlanPro, past, false},
		{"Pro 未到期", model.PlanPro, future, true},
		{"Pro 无到期时间", model.PlanPro, nil, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := db.Model(&model.Membership{}).Where("user_id = ?", result.User.ID).
				Updates(map[string]any{"plan": tc.plan, "expire_at": tc.exp}).Error; err != nil {
				t.Fatalf("更新订阅失败: %v", err)
			}
			me, err := svc.Profile(ctx, result.User.ID)
			if err != nil {
				t.Fatalf("查询资料失败: %v", err)
			}
			if me.Membership.IsPro != tc.want {
				t.Fatalf("IsPro 期望 %v，实际 %v", tc.want, me.Membership.IsPro)
			}
		})
	}
}

func mustTime(t *testing.T, value string) *time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("解析时间 %s: %v", value, err)
	}
	return &parsed
}
