package auth_test

import (
	"testing"
	"time"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/response"
)

func newManager(accessTTL time.Duration) *auth.Manager {
	return auth.NewManager(config.JWT{
		Secret:     "test-secret",
		Issuer:     "douwan-api-test",
		AccessTTL:  accessTTL,
		RefreshTTL: time.Hour,
	})
}

func TestAccessToken_RoundTrip(t *testing.T) {
	m := newManager(time.Minute)

	token, expiresAt, err := m.GenerateAccessToken(42)
	if err != nil {
		t.Fatalf("签发失败: %v", err)
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("过期时间应在未来，实际 %s", expiresAt)
	}

	claims, err := m.ParseAccessToken(token)
	if err != nil {
		t.Fatalf("校验失败: %v", err)
	}
	if claims.UserID != 42 {
		t.Fatalf("用户 ID 期望 42，实际 %d", claims.UserID)
	}
	if claims.Issuer != "douwan-api-test" {
		t.Fatalf("签发者不对: %q", claims.Issuer)
	}
}

func TestAccessToken_Expired(t *testing.T) {
	// 有效期设为负数，签出来的令牌即刻过期
	m := newManager(-time.Minute)

	token, _, err := m.GenerateAccessToken(1)
	if err != nil {
		t.Fatalf("签发失败: %v", err)
	}

	_, err = m.ParseAccessToken(token)
	if err == nil {
		t.Fatal("过期令牌应当校验失败")
	}
	if code := response.From(err).Code; code != response.CodeTokenExpired {
		t.Fatalf("期望错误码 %d，实际 %d", response.CodeTokenExpired, code)
	}
}

func TestAccessToken_RejectsTamperedAndForeignTokens(t *testing.T) {
	m := newManager(time.Minute)
	token, _, err := m.GenerateAccessToken(7)
	if err != nil {
		t.Fatalf("签发失败: %v", err)
	}

	cases := map[string]string{
		"篡改签名": token[:len(token)-2] + "xx",
		"不是令牌": "abc.def.ghi",
		"空字符串": "",
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := m.ParseAccessToken(value); err == nil {
				t.Fatal("应当校验失败")
			} else if code := response.From(err).Code; code != response.CodeTokenInvalid {
				t.Fatalf("期望错误码 %d，实际 %d", response.CodeTokenInvalid, code)
			}
		})
	}

	// 换一个密钥签发（相当于别的服务签的令牌）必须被拒绝
	other := auth.NewManager(config.JWT{
		Secret: "another-secret", Issuer: "douwan-api-test",
		AccessTTL: time.Minute, RefreshTTL: time.Hour,
	})
	foreign, _, err := other.GenerateAccessToken(7)
	if err != nil {
		t.Fatalf("签发失败: %v", err)
	}
	if _, err := m.ParseAccessToken(foreign); err == nil {
		t.Fatal("其它密钥签发的令牌应当被拒绝")
	}

	// 签发者不匹配也要拒绝
	otherIssuer := auth.NewManager(config.JWT{
		Secret: "test-secret", Issuer: "somewhere-else",
		AccessTTL: time.Minute, RefreshTTL: time.Hour,
	})
	foreignIssuer, _, err := otherIssuer.GenerateAccessToken(7)
	if err != nil {
		t.Fatalf("签发失败: %v", err)
	}
	if _, err := m.ParseAccessToken(foreignIssuer); err == nil {
		t.Fatal("签发者不匹配的令牌应当被拒绝")
	}
}

func TestRefreshToken_IsRandomAndOpaque(t *testing.T) {
	m := newManager(time.Minute)

	seen := make(map[string]struct{}, 20)
	for i := 0; i < 20; i++ {
		token, err := m.GenerateRefreshToken()
		if err != nil {
			t.Fatalf("生成刷新令牌失败: %v", err)
		}
		if len(token) < 32 {
			t.Fatalf("刷新令牌长度不足: %q", token)
		}
		if _, dup := seen[token]; dup {
			t.Fatalf("刷新令牌重复: %q", token)
		}
		seen[token] = struct{}{}
	}
}

func TestPassword_HashAndVerify(t *testing.T) {
	hash, err := auth.HashPassword("secret-pass-1")
	if err != nil {
		t.Fatalf("生成哈希失败: %v", err)
	}
	if hash == "secret-pass-1" {
		t.Fatal("不能明文存储密码")
	}
	if err := auth.VerifyPassword(hash, "secret-pass-1"); err != nil {
		t.Fatalf("正确密码应当通过: %v", err)
	}

	err = auth.VerifyPassword(hash, "wrong-password")
	if err == nil {
		t.Fatal("错误密码应当失败")
	}
	if code := response.From(err).Code; code != response.CodePasswordWrong {
		t.Fatalf("期望错误码 %d，实际 %d", response.CodePasswordWrong, code)
	}
}

func TestMemoryTokenStore_Lifecycle(t *testing.T) {
	store := auth.NewMemoryTokenStore()
	defer func() { _ = store.Close() }()
	ctx := t.Context()

	if err := store.Save(ctx, "token-a", auth.Subject{Kind: auth.KindUser, ID: 9}, time.Hour); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	subject, err := store.Subject(ctx, "token-a")
	if err != nil {
		t.Fatalf("读取失败: %v", err)
	}
	if subject.ID != 9 || subject.Kind != auth.KindUser {
		t.Fatalf("主体期望 user/9，实际 %s/%d", subject.Kind, subject.ID)
	}

	if err := store.Delete(ctx, "token-a"); err != nil {
		t.Fatalf("删除失败: %v", err)
	}
	if _, err := store.Subject(ctx, "token-a"); err == nil {
		t.Fatal("删除后应当查不到")
	} else if code := response.From(err).Code; code != response.CodeTokenInvalid {
		t.Fatalf("期望错误码 %d，实际 %d", response.CodeTokenInvalid, code)
	}

	// 已过期的令牌读不到
	if err := store.Save(ctx, "token-b", auth.Subject{Kind: auth.KindUser, ID: 1}, -time.Minute); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	if _, err := store.Subject(ctx, "token-b"); err == nil {
		t.Fatal("过期令牌应当查不到")
	}

	// 管理员令牌要能区分出来（需求 §3.3：普通用户的令牌不能调后台接口）
	if err := store.Save(ctx, "token-admin", auth.Subject{Kind: auth.KindAdmin, ID: 1, Role: "super_admin"}, time.Hour); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	adminSubject, err := store.Subject(ctx, "token-admin")
	if err != nil {
		t.Fatalf("读取失败: %v", err)
	}
	if adminSubject.Kind != auth.KindAdmin || adminSubject.Role != "super_admin" {
		t.Fatalf("管理员主体解析错误: %+v", adminSubject)
	}
}

// TestAccessToken_KindIsolation 覆盖「用户令牌与管理员令牌不能混用」。
func TestAccessToken_KindIsolation(t *testing.T) {
	m := auth.NewManager(config.JWT{
		Secret: "test-secret", Issuer: "douwan-api-test",
		AccessTTL: time.Minute, RefreshTTL: time.Hour,
	})

	adminToken, _, err := m.GenerateAdminAccessToken(7, "operator")
	if err != nil {
		t.Fatalf("签发管理员令牌失败: %v", err)
	}
	if _, err := m.ParseAccessToken(adminToken); err == nil {
		t.Fatal("管理员令牌不能通过前台用户令牌校验")
	}
	claims, err := m.ParseAdminAccessToken(adminToken)
	if err != nil {
		t.Fatalf("管理员令牌应当通过后台校验: %v", err)
	}
	if claims.AdminID != 7 || claims.Role != "operator" {
		t.Fatalf("管理员载荷不对: %+v", claims)
	}

	userToken, _, err := m.GenerateAccessToken(42)
	if err != nil {
		t.Fatalf("签发用户令牌失败: %v", err)
	}
	if _, err := m.ParseAdminAccessToken(userToken); err == nil {
		t.Fatal("普通用户令牌不能通过后台校验")
	}
	userClaims, err := m.ParseAccessToken(userToken)
	if err != nil {
		t.Fatalf("用户令牌应当通过前台校验: %v", err)
	}
	if userClaims.UserID != 42 {
		t.Fatalf("用户载荷不对: %+v", userClaims)
	}
}
