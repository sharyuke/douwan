package seo

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// PushResult 一次推送的结果。
//
// 注意语义：**成功只代表「已经把通知交给引擎」**，
// 不代表页面被抓取，更不代表被收录。这三件事在后台里必须分开显示。
type PushResult struct {
	// OK 请求成功送达引擎
	OK bool
	// Skipped 主动跳过（配额用尽、引擎未配置、内容没变化……）
	Skipped bool
	// Message 失败原因或跳过原因（后台「查看失败原因」直接显示它）
	Message string
	// Response 引擎返回的原文（截断保存）
	Response string
	// QuotaRemain 百度当日剩余配额；其它引擎为 -1
	QuotaRemain int
}

// Pusher 一个推送通道。
type Pusher interface {
	// Name 引擎标识
	Name() string
	// Configured 是否配置齐了凭据。没配置的通道在后台显示「未配置」，
	// 不会去发请求。
	Configured() bool
	// Push 提交一批 URL。
	Push(ctx context.Context, urls []string) (PushResult, error)
}

/* ------------------------------------------------------------------ 百度 */

// BaiduPusher 百度搜索资源平台「普通收录」API。
//
// 接口：POST https://data.zz.baidu.com/urls?site=<站点>&token=<推送 token>
// 请求体：{"urls": ["https://...","https://..."]}
// 返回：  {"error":0,"remain":99,"success":99,"message":""}
//
// remain 是当天剩余配额；为 0 时必须停手，否则会被限流。
type BaiduPusher struct {
	Token   string
	Site    string
	Client  *http.Client
	MaxSize int
}

// NewBaiduPusher 构造百度推送器。site 是站点标识（与百度平台里一致，例如 dw.sharyuke.com）。
func NewBaiduPusher(token, site string, timeout time.Duration, maxSize int) *BaiduPusher {
	if maxSize <= 0 {
		maxSize = 20
	}
	return &BaiduPusher{
		Token:   strings.TrimSpace(token),
		Site:    strings.TrimSpace(site),
		Client:  &http.Client{Timeout: timeout},
		MaxSize: maxSize,
	}
}

// Name 实现 Pusher。
func (p *BaiduPusher) Name() string { return "baidu" }

// Configured 实现 Pusher。
func (p *BaiduPusher) Configured() bool { return p.Token != "" && p.Site != "" }

// baiduResponse 百度接口返回体。
type baiduResponse struct {
	Error   int    `json:"error"`
	Remain  int    `json:"remain"`
	Success int    `json:"success"`
	Message string `json:"message"`
}

// Push 实现 Pusher。
func (p *BaiduPusher) Push(ctx context.Context, urls []string) (PushResult, error) {
	if !p.Configured() {
		return PushResult{Skipped: true, Message: "未配置百度推送 token", QuotaRemain: -1}, nil
	}
	if len(urls) == 0 {
		return PushResult{Skipped: true, Message: "没有需要提交的 URL", QuotaRemain: -1}, nil
	}
	if len(urls) > p.MaxSize {
		urls = urls[:p.MaxSize]
	}
	body, _ := json.Marshal(map[string]any{"urls": urls})
	endpoint := fmt.Sprintf("https://data.zz.baidu.com/urls?site=%s&token=%s",
		url.QueryEscape(p.Site), url.QueryEscape(p.Token))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return PushResult{QuotaRemain: -1}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.Client.Do(req)
	if err != nil {
		return PushResult{QuotaRemain: -1}, fmt.Errorf("请求百度接口失败：%w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	text := string(raw)

	var parsed baiduResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return PushResult{
			Message:    fmt.Sprintf("百度接口返回了无法解析的内容（HTTP %d）", resp.StatusCode),
			Response:   text,
			QuotaRemain: -1,
		}, nil
	}
	if parsed.Error != 0 {
		return PushResult{
			Message:    fmt.Sprintf("百度接口报错（error=%d）：%s", parsed.Error, parsed.Message),
			Response:   text,
			QuotaRemain: parsed.Remain,
		}, nil
	}
	if parsed.Remain <= 0 {
		return PushResult{
			Skipped:    true,
			Message:    "百度当日推送配额已用完，本轮不再提交",
			Response:   text,
			QuotaRemain: parsed.Remain,
		}, nil
	}
	return PushResult{
		OK:          true,
		Message:     fmt.Sprintf("已提交 %d 条，剩余配额 %d", parsed.Success, parsed.Remain),
		Response:    text,
		QuotaRemain: parsed.Remain,
	}, nil
}

/* ------------------------------------------------------------------ IndexNow */

// IndexNowPusher IndexNow 协议推送。
//
// 接口：POST https://api.indexnow.org/indexnow
// 请求体：{"host":"...","key":"...","keyLocation":"https://.../{key}.txt","urlList":[...]}
//
// 删除页面时也走同一个接口：把已经 404 的地址再提交一次，
// 引擎重新抓取时看到 404 就会把它从索引里摘掉。协议里没有单独的删除接口。
type IndexNowPusher struct {
	Key         string
	Host        string
	KeyLocation string
	Client      *http.Client
	MaxSize     int
}

// NewIndexNowPusher 构造 IndexNow 推送器。
func NewIndexNowPusher(key, siteURL string, timeout time.Duration, maxSize int) *IndexNowPusher {
	if maxSize <= 0 {
		maxSize = 100
	}
	key = strings.TrimSpace(key)
	host := hostOf(siteURL)
	keyLoc := ""
	if key != "" && siteURL != "" {
		keyLoc = strings.TrimRight(siteURL, "/") + "/" + key + ".txt"
	}
	return &IndexNowPusher{
		Key:         key,
		Host:        host,
		KeyLocation: keyLoc,
		Client:      &http.Client{Timeout: timeout},
		MaxSize:     maxSize,
	}
}

// Name 实现 Pusher。
func (p *IndexNowPusher) Name() string { return "indexnow" }

// Configured 实现 Pusher。
func (p *IndexNowPusher) Configured() bool { return p.Key != "" && p.Host != "" }

// Push 实现 Pusher。
func (p *IndexNowPusher) Push(ctx context.Context, urls []string) (PushResult, error) {
	if !p.Configured() {
		return PushResult{Skipped: true, Message: "未配置 IndexNow key", QuotaRemain: -1}, nil
	}
	if len(urls) == 0 {
		return PushResult{Skipped: true, Message: "没有需要提交的 URL", QuotaRemain: -1}, nil
	}
	if len(urls) > p.MaxSize {
		urls = urls[:p.MaxSize]
	}
	payload := map[string]any{
		"host":    p.Host,
		"key":     p.Key,
		"urlList": urls,
	}
	if p.KeyLocation != "" {
		payload["keyLocation"] = p.KeyLocation
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.indexnow.org/indexnow", bytes.NewReader(body))
	if err != nil {
		return PushResult{QuotaRemain: -1}, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := p.Client.Do(req)
	if err != nil {
		return PushResult{QuotaRemain: -1}, fmt.Errorf("请求 IndexNow 接口失败：%w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	text := string(raw)

	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusAccepted:
		return PushResult{
			OK:          true,
			Message:     fmt.Sprintf("已通知 %d 条 URL", len(urls)),
			Response:    text,
			QuotaRemain: -1,
		}, nil
	default:
		return PushResult{
			Message:    fmt.Sprintf("IndexNow 接口返回 HTTP %d：%s", resp.StatusCode, strings.TrimSpace(text)),
			Response:   text,
			QuotaRemain: -1,
		}, nil
	}
}

/* ------------------------------------------------------------------ Google */

// GooglePusher Google Search Console 的 Sitemap 提交接口。
//
// ⚠️ 这里**不会**用 Google 的 Indexing API 推普通网页：
// 那个接口只接受 Job / BroadcastEvent 这类官方索引页面，对普通网页是禁止使用的。
// 普通网页在 Google 侧只有两条路：Sitemap + 内链自然抓取。
// 本类只做第一件：把 sitemap 提交给 Search Console。
type GooglePusher struct {
	Site       string
	SitemapURL string
	Email      string
	PrivateKey string
	Client     *http.Client
}

// NewGooglePusher 构造 Google 推送器。
func NewGooglePusher(site, sitemapURL, email, privateKey string, timeout time.Duration) *GooglePusher {
	return &GooglePusher{
		Site:       strings.TrimSpace(site),
		SitemapURL: strings.TrimSpace(sitemapURL),
		Email:      strings.TrimSpace(email),
		PrivateKey: strings.TrimSpace(privateKey),
		Client:     &http.Client{Timeout: timeout},
	}
}

// Name 实现 Pusher。
func (p *GooglePusher) Name() string { return "google" }

// Configured 实现 Pusher。
func (p *GooglePusher) Configured() bool {
	return p.Site != "" && p.SitemapURL != "" && p.Email != "" && p.PrivateKey != ""
}

// Push 实现 Pusher：忽略 url 列表，只提交 sitemap 一次。
func (p *GooglePusher) Push(ctx context.Context, urls []string) (PushResult, error) {
	if !p.Configured() {
		return PushResult{Skipped: true, Message: "未配置 Google Search Console 服务账号", QuotaRemain: -1}, nil
	}
	token, err := p.accessToken(ctx)
	if err != nil {
		return PushResult{QuotaRemain: -1}, err
	}
	endpoint := fmt.Sprintf("https://www.googleapis.com/webmasters/v3/sites/%s/sitemaps/%s",
		url.PathEscape(p.Site), url.PathEscape(p.SitemapURL))
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, nil)
	if err != nil {
		return PushResult{QuotaRemain: -1}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := p.Client.Do(req)
	if err != nil {
		return PushResult{QuotaRemain: -1}, fmt.Errorf("请求 Search Console 接口失败：%w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	text := strings.TrimSpace(string(raw))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return PushResult{
			OK:          true,
			Message:     "Sitemap 已提交到 Search Console",
			Response:    text,
			QuotaRemain: -1,
		}, nil
	}
	return PushResult{
		Message:    fmt.Sprintf("Search Console 接口返回 HTTP %d：%s", resp.StatusCode, text),
		Response:   text,
		QuotaRemain: -1,
	}, nil
}

// accessToken 用服务账号换访问令牌（JWT bearer 流程，不引第三方依赖）。
func (p *GooglePusher) accessToken(ctx context.Context) (string, error) {
	key, err := parseRSAPrivateKey(p.PrivateKey)
	if err != nil {
		return "", err
	}
	now := time.Now()
	header := map[string]any{"alg": "RS256", "typ": "JWT"}
	claims := map[string]any{
		"iss":   p.Email,
		"scope": "https://www.googleapis.com/auth/webmasters.readwrite",
		"aud":   "https://oauth2.googleapis.com/token",
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
	assertion, err := signJWT(header, claims, key)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := p.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("换取 Google 访问令牌失败：%w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("换取 Google 访问令牌失败（HTTP %d）：%s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var payload struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", fmt.Errorf("解析 Google 令牌响应失败：%w", err)
	}
	if payload.AccessToken == "" {
		return "", fmt.Errorf("Google 令牌响应里没有 access_token")
	}
	return payload.AccessToken, nil
}

// parseRSAPrivateKey 解析 PEM 私钥。配置里允许写成 base64（部署时贴多行 PEM 容易出错）。
func parseRSAPrivateKey(raw string) (*rsa.PrivateKey, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("未配置 Google 服务账号私钥")
	}
	if !strings.Contains(raw, "-----BEGIN") {
		decoded, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, fmt.Errorf("Google 私钥既不是 PEM 也不是 base64：%w", err)
		}
		raw = string(decoded)
	}
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, fmt.Errorf("Google 私钥不是合法的 PEM")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("解析 Google 私钥失败：%w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("Google 私钥不是 RSA 私钥")
	}
	return key, nil
}

// signJWT 用 RS256 签一个 JWT。
func signJWT(header, claims map[string]any, key *rsa.PrivateKey) (string, error) {
	enc := func(v any) (string, error) {
		raw, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return base64.RawURLEncoding.EncodeToString(raw), nil
	}
	h, err := enc(header)
	if err != nil {
		return "", err
	}
	c, err := enc(claims)
	if err != nil {
		return "", err
	}
	signing := h + "." + c
	sum := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		return "", fmt.Errorf("签名失败：%w", err)
	}
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

/* ------------------------------------------------------------------ 工具 */

// hostOf 从站点地址里取出主机名（IndexNow 的 host 字段）。
func hostOf(siteURL string) string {
	siteURL = strings.TrimSpace(siteURL)
	if siteURL == "" {
		return ""
	}
	if !strings.Contains(siteURL, "://") {
		siteURL = "https://" + siteURL
	}
	u, err := url.Parse(siteURL)
	if err != nil {
		return ""
	}
	return u.Host
}
