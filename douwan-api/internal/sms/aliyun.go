// 阿里云短信（Dysmsapi）发送器实现。
//
// 刻意不引 SDK：SendSms 是一个带签名的 GET 请求，自己按 POP RPC 签名 V1
// （HMAC-SHA1）实现只有几十行，省掉 alibabacloud-go 全家桶的一串依赖。
// 协议参考：https://help.aliyun.com/document_detail/101414.html
package sms

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// AliyunConfig 阿里云短信凭据。四项缺一不可，缺了就算未配置。
type AliyunConfig struct {
	AccessKeyID     string
	AccessKeySecret string
	// SignName 短信签名（如「豆玩」），在阿里云控制台申请并通过审核
	SignName string
	// TemplateCode 模板 CODE，例如 SMS_512502473（工单 20094849108）
	TemplateCode string
	// Endpoint 默认 dysmsapi.aliyuncs.com
	Endpoint string
}

// Aliyun 阿里云短信发送器。
type Aliyun struct {
	cfg  AliyunConfig
	http *http.Client
}

// NewAliyun 构造发送器。endpoint 留空用默认值。
func NewAliyun(cfg AliyunConfig) *Aliyun {
	if cfg.Endpoint == "" {
		cfg.Endpoint = "dysmsapi.aliyuncs.com"
	}
	return &Aliyun{cfg: cfg, http: &http.Client{Timeout: 5 * time.Second}}
}

// Configured 判断凭据是否齐全。
func (cfg AliyunConfig) Configured() bool {
	return cfg.AccessKeyID != "" && cfg.AccessKeySecret != "" &&
		cfg.SignName != "" && cfg.TemplateCode != ""
}

// aliyunResponse SendSms 的公共响应字段。Code == "OK" 才算成功。
type aliyunResponse struct {
	Code      string `json:"Code"`
	Message   string `json:"Message"`
	RequestID string `json:"RequestId"`
	BizID     string `json:"BizId"`
}

// SendCode 实现 Sender。
func (a *Aliyun) SendCode(ctx context.Context, phone, code string) error {
	param, err := json.Marshal(map[string]string{"code": code})
	if err != nil {
		return fmt.Errorf("序列化模板参数: %w", err)
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return fmt.Errorf("生成随机数: %w", err)
	}

	query := url.Values{}
	query.Set("AccessKeyId", a.cfg.AccessKeyID)
	query.Set("Action", "SendSms")
	query.Set("Format", "JSON")
	query.Set("PhoneNumbers", phone)
	query.Set("RegionId", "cn-hangzhou")
	query.Set("SignName", a.cfg.SignName)
	query.Set("SignatureMethod", "HMAC-SHA1")
	query.Set("SignatureNonce", fmt.Sprintf("%x", nonce))
	query.Set("SignatureVersion", "1.0")
	query.Set("TemplateCode", a.cfg.TemplateCode)
	query.Set("TemplateParam", string(param))
	query.Set("Timestamp", time.Now().UTC().Format("2006-01-02T15:04:05Z"))
	query.Set("Version", "2017-05-25")

	sign, err := a.sign(query)
	if err != nil {
		return err
	}
	query.Set("Signature", sign)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://"+a.cfg.Endpoint+"/?"+query.Encode(), nil)
	if err != nil {
		return fmt.Errorf("构造请求: %w", err)
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("请求短信网关: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return fmt.Errorf("读取响应: %w", err)
	}
	var result aliyunResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("解析响应 %s: %w", string(body), err)
	}
	if result.Code != "OK" {
		return fmt.Errorf("短信网关返回 %s: %s", result.Code, result.Message)
	}
	return nil
}

// sign 按POP RPC 签名 V1 计算签名：参数按名排序拼接，
// stringToSign = "GET&%2F&" + 编码后的查询串，HMAC-SHA1（密钥 = secret + "&"）。
func (a *Aliyun) sign(query url.Values) (string, error) {
	keys := make([]string, 0, len(query))
	for k := range query {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, popEncode(k)+"="+popEncode(query.Get(k)))
	}
	stringToSign := "GET&" + popEncode("/") + "&" + popEncode(strings.Join(pairs, "&"))
	mac := hmac.New(sha1.New, []byte(a.cfg.AccessKeySecret+"&"))
	mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

// popEncode 阿里云 POP 协议要求的百分号编码（比 RFC3986 多编码一个 `*`）。
func popEncode(s string) string {
	s = url.QueryEscape(s)
	s = strings.ReplaceAll(s, "+", "%20")
	s = strings.ReplaceAll(s, "*", "%2A")
	s = strings.ReplaceAll(s, "%7E", "~")
	return s
}
