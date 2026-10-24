package auth

import (
	"fmt"

	"golang.org/x/crypto/bcrypt"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// HashPassword 用 bcrypt 生成密码哈希。
func HashPassword(plain string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("生成密码哈希: %w", err)
	}
	return string(hash), nil
}

// VerifyPassword 校验明文密码与哈希是否匹配。
// 不匹配时返回统一的 ErrPasswordWrong，不区分「用户不存在」与「密码错误」，
// 避免被用来枚举账号。
func VerifyPassword(hash, plain string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
		return response.ErrPasswordWrong
	}
	return nil
}
