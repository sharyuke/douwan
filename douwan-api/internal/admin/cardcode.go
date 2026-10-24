// Package admin 提供后台管理专用的底层能力：卡密的生成、哈希与加解密。
//
// 单独成包而不是塞进 service，是为了让「卡密怎么产生、怎么校验、怎么解出明文」
// 这三件事集中在一处：它们是整个系统最敏感的代码，改错一次就是资金损失。
package admin

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CodeAlphabet 是卡密使用的字符集：去掉了容易混淆的 0/O/1/I/L，共 30 个字符。
// 30^16 ≈ 4.3e23，暴力猜测不可行（需求 §6.3）。
const CodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// 卡密默认长度与分组。
const (
	DefaultCodeLength = 16
	CodeGroupSize     = 4
)

// ErrCipherUnavailable 表示没有配置加密密钥，明文交付能力不可用。
// 这时哈希校验与兑换仍然正常，只是管理员无法查看 / 导出明文。
var ErrCipherUnavailable = errors.New("未配置卡密加密密钥")

// ErrDecryptFailed 表示密文无法解密。最常见的原因是更换了加密密钥。
var ErrDecryptFailed = errors.New("卡密密文解密失败（可能更换过加密密钥）")

// GenerateCode 生成一张卡密。
//
// 用 crypto/rand 而不是 math/rand：可预测的随机数意味着别人能推算出
// 尚未售出的卡密，这是灾难性的（需求 §6.3「随机、不可预测」）。
func GenerateCode(length int) (string, error) {
	if length <= 0 {
		length = DefaultCodeLength
	}
	raw := make([]byte, length)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("生成卡密随机数: %w", err)
	}
	// 用取模会有极小的偏置，但对 30 取模、256 进制的偏差可以忽略；
	// 为了完全均匀，这里做一次拒绝采样。
	buf := make([]byte, 0, length)
	for i := 0; len(buf) < length; i++ {
		if i == len(raw) {
			// 需要更多随机字节
			extra := make([]byte, length)
			if _, err := rand.Read(extra); err != nil {
				return "", fmt.Errorf("生成卡密随机数: %w", err)
			}
			raw = append(raw, extra...)
		}
		// 240 = 30 * 8，落在 [0,240) 的字节可以无偏取模
		if raw[i] >= 240 {
			continue
		}
		buf = append(buf, CodeAlphabet[raw[i]%30])
	}
	return FormatCode(string(buf)), nil
}

// FormatCode 把连续字符按 4 位分组，便于人工录入：
// ABCDEFGHIJKLMNOP → ABCD-EFGH-JKLM-NOPQ
func FormatCode(s string) string {
	up := NormalizeCode(s)
	if up == "" {
		return ""
	}
	var b strings.Builder
	for i, r := range up {
		if i > 0 && i%CodeGroupSize == 0 {
			b.WriteByte('-')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// NormalizeCode 把用户输入的卡密归一化：去掉空格与连字符、统一大写。
// 兑换接口必须先用它处理，否则用户多打一个空格就兑换失败。
func NormalizeCode(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToUpper(strings.TrimSpace(s)) {
		if r == '-' || r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// HashCode 计算卡密的校验哈希。
//
// 用 HMAC-SHA256 而不是裸 SHA256：卡密字符集小、长度固定，裸哈希可以被
// 离线彩虹表针对；带上密钥（pepper）后，光拿到数据库也无法反查。
// pepper 为空时退化成 SHA256，此时哈希仍不可逆，只是少了这层保护。
func HashCode(code, pepper string) string {
	normalized := NormalizeCode(code)
	if pepper == "" {
		sum := sha256.Sum256([]byte(normalized))
		return hex.EncodeToString(sum[:])
	}
	mac := hmac.New(sha256.New, []byte(pepper))
	mac.Write([]byte(normalized))
	return hex.EncodeToString(mac.Sum(nil))
}

// MaskCode 生成脱敏串，用于列表展示与日志。
// ABCD-EFGH-JKLM-NOPQ → ABCD-****-****-NOPQ
func MaskCode(code string) string {
	normalized := NormalizeCode(code)
	if len(normalized) <= 8 {
		if len(normalized) <= 2 {
			return strings.Repeat("*", len(normalized))
		}
		return normalized[:2] + strings.Repeat("*", len(normalized)-2)
	}
	head := normalized[:4]
	tail := normalized[len(normalized)-4:]
	middle := strings.Repeat("*", len(normalized)-8)
	return FormatCode(head + middle + tail)
}

// SearchPrefixLen 是用于搜索的卡密前缀长度。
//
// 值取 8：卡密随机部分默认 16 位（30^16 ≈ 4.3e23），
// 8 位前缀（30^8 ≈ 6.6e11）足够把搜索定位到一张卡，
// 又在数据库泄露时无法据此还原完整卡密。
const SearchPrefixLen = 8

// SearchPrefix 返回去掉连字符后的卡密前缀，供后台按卡密搜索。
func SearchPrefix(code string) string {
	normalized := NormalizeCode(code)
	if len(normalized) <= SearchPrefixLen {
		return normalized
	}
	return normalized[:SearchPrefixLen]
}

/* ------------------------------------------------------------------ 加解密 */

// Cipher 负责卡密明文的对称加解密（AES-256-GCM）。
// 密钥由配置提供，缺失时 Enabled() 为 false，调用方应退化成「只能脱敏展示」。
type Cipher struct {
	aead cipher.AEAD
}

// NewCipher 用配置里的密钥构造加解密器。
// 密钥长度不限：先 SHA-256 派生固定 32 字节，避免运维纠结「必须 32 字节」。
func NewCipher(secret string) (*Cipher, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, ErrCipherUnavailable
	}
	key := sha256.Sum256([]byte("douwan-card-cipher:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("构造卡密加密器: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("构造卡密加密器: %w", err)
	}
	return &Cipher{aead: aead}, nil
}

// Enabled 是否可用。
func (c *Cipher) Enabled() bool { return c != nil && c.aead != nil }

// Encrypt 加密卡密明文，返回 base64 密文（含随机 nonce）。
func (c *Cipher) Encrypt(code string) (string, error) {
	if !c.Enabled() {
		return "", ErrCipherUnavailable
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("生成卡密加密随机数: %w", err)
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(NormalizeCode(code)), nil)
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

// Decrypt 解密卡密明文。
func (c *Cipher) Decrypt(ciphertext string) (string, error) {
	if !c.Enabled() {
		return "", ErrCipherUnavailable
	}
	raw, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", ErrDecryptFailed
	}
	ns := c.aead.NonceSize()
	if len(raw) < ns {
		return "", ErrDecryptFailed
	}
	plain, err := c.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", ErrDecryptFailed
	}
	return FormatCode(string(plain)), nil
}

/* ------------------------------------------------------------------ 编号 */

// NewBatchID 生成卡密批次号：时间可读 + 随机后缀，方便人工按批次找。
// 例如 B20261015T093012A1B2C3D4
func NewBatchID(now time.Time) string {
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		// 随机源异常时退回纳秒时间，仍然能保证批次唯一性足够高
		return "B" + now.Format("20060102T150405") + fmt.Sprintf("%09d", now.Nanosecond())
	}
	return "B" + now.Format("20060102T150405") + strings.ToUpper(hex.EncodeToString(suffix[:]))
}

// NewOrderNo 生成订单号。
//
// 格式：DW + 年月日时分秒 + 8 位随机十六进制。
//
// 随机部分**必须用满 4 个随机字节（8 个十六进制字符）**：
// 只取 2 个字节（4 个字符）时，同一秒内的碰撞概率是 1/65536，
// 自动化脚本连续下单就会撞上唯一索引报「订单号重复」（线上实测踩到过）。
// 8 个字符把同一秒内的碰撞概率压到 1/4.3e9，日常量级下不可能撞。
func NewOrderNo(now time.Time) string {
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return "DW" + now.Format("20060102150405") + fmt.Sprintf("%09d", now.Nanosecond())
	}
	return "DW" + now.Format("20060102150405") + strings.ToUpper(hex.EncodeToString(suffix[:]))
}

// RandomToken 生成随机串，用于 slug 后缀、文件名等非安全关键场景。
func RandomToken(n int) string {
	if n <= 0 {
		n = 8
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)[:n]
}
