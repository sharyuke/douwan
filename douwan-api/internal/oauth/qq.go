// Package oauth 封装第三方登录提供方的 HTTP 细节。
//
// 这里只做「换令牌 / 取 openid / 取昵称头像」三件事，不碰数据库与业务规则。
// 密钥只从配置读取，任何日志与错误文案都不带 app_key / access_token。
package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
)

const (
	qqAuthorizeURL = "https://graph.qq.com/oauth2.0/authorize"
	qqTokenURL     = "https://graph.qq.com/oauth2.0/token"
	qqMeURL        = "https://graph.qq.com/oauth2.0/me"
	qqUserInfoURL  = "https://graph.qq.com/user/get_user_info"
)

// QQClient 是 QQ互联的最小客户端。
type QQClient struct {
	cfg  config.QQOAuth
	http *http.Client
}

// NewQQClient 构造客户端。调用方应先检查 cfg.Enabled()。
func NewQQClient(cfg config.QQOAuth) *QQClient {
	return &QQClient{cfg: cfg, http: &http.Client{Timeout: 10 * time.Second}}
}

// Profile 是第三方返回的登录资料。
type Profile struct {
	OpenID    string
	UnionID   string
	Nickname  string
	AvatarURL string
}

// AuthorizeURL 生成 QQ 授权页地址。state 由服务端签发。
func (c *QQClient) AuthorizeURL(state string) string {
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", c.cfg.AppID)
	q.Set("redirect_uri", c.cfg.RedirectURI)
	q.Set("state", state)
	q.Set("scope", "get_user_info")
	return qqAuthorizeURL + "?" + q.Encode()
}

// qqErrorCodeRE 匹配 QQ 授权页里的错误码变量。
// 应用未开通网站 QQ 登录时，页面会内联 `var errcode = '100008';`。
var qqErrorCodeRE = regexp.MustCompile(`errcode\s*=\s*'([0-9]{5,6})'`)

// Availability 是授权页预检结果。QQ 在应用未开通 / 回调地址不合法时
// 仍返回 HTTP 200，只在页面里写错误码，所以必须看页面内容。
type Availability struct {
	Enabled bool
	Code    string
}

// CheckAvailability 预检授权页，判断当前应用是否已经开通网站 QQ 登录。
//
// 这里只做一次 GET，不携带任何用户凭据；state 用固定值，不会被回调消费。
// 网络错误原样返回，调用方应把「查不到」当成「可以尝试」，避免预检故障
// 把正常登录一起挡掉。
func (c *QQClient) CheckAvailability(ctx context.Context) (Availability, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.AuthorizeURL("douwan-preflight"), nil)
	if err != nil {
		return Availability{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return Availability{}, fmt.Errorf("请求 QQ 授权页失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	if err != nil {
		return Availability{}, fmt.Errorf("读取 QQ 授权页失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Availability{}, fmt.Errorf("QQ 授权页返回 HTTP %d", resp.StatusCode)
	}
	if code := qqErrorCode(body); code != "" {
		return Availability{Enabled: false, Code: code}, nil
	}
	return Availability{Enabled: true}, nil
}

func qqErrorCode(body []byte) string {
	if m := qqErrorCodeRE.FindSubmatch(body); len(m) == 2 {
		return string(m[1])
	}
	return ""
}

// Exchange 用授权码换 access_token，再取 openid 与用户资料。
func (c *QQClient) Exchange(ctx context.Context, code string) (*Profile, error) {
	token, err := c.exchangeToken(ctx, code)
	if err != nil {
		return nil, err
	}
	openID, unionID, err := c.openID(ctx, token)
	if err != nil {
		return nil, err
	}
	nickname, avatar := c.userInfo(ctx, token, openID)
	return &Profile{OpenID: openID, UnionID: unionID, Nickname: nickname, AvatarURL: avatar}, nil
}

func (c *QQClient) exchangeToken(ctx context.Context, code string) (string, error) {
	q := url.Values{}
	q.Set("grant_type", "authorization_code")
	q.Set("client_id", c.cfg.AppID)
	q.Set("client_secret", c.cfg.AppKey)
	q.Set("code", code)
	q.Set("redirect_uri", c.cfg.RedirectURI)
	q.Set("fmt", "json")

	body, err := c.get(ctx, qqTokenURL+"?"+q.Encode())
	if err != nil {
		return "", err
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		Error       int    `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		// 兼容少数返回 querystring 的情况：access_token=...&expires_in=...
		values, qerr := url.ParseQuery(string(body))
		if qerr == nil && values.Get("access_token") != "" {
			return values.Get("access_token"), nil
		}
		return "", fmt.Errorf("解析 QQ token 响应失败: %w", err)
	}
	if payload.Error != 0 || payload.AccessToken == "" {
		return "", fmt.Errorf("QQ 换取 token 失败: %s", payload.ErrorDesc)
	}
	return payload.AccessToken, nil
}

func (c *QQClient) openID(ctx context.Context, token string) (string, string, error) {
	q := url.Values{}
	q.Set("access_token", token)
	q.Set("fmt", "json")
	body, err := c.get(ctx, qqMeURL+"?"+q.Encode())
	if err != nil {
		return "", "", err
	}
	// QQ 的 me 接口即使 fmt=json 也可能返回 callback( {...} );
	raw := strings.TrimSpace(string(body))
	if i, j := strings.Index(raw, "{"), strings.LastIndex(raw, "}"); i >= 0 && j > i {
		raw = raw[i : j+1]
	}
	var payload struct {
		OpenID  string `json:"openid"`
		UnionID string `json:"unionid"`
		Error   int    `json:"error"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return "", "", fmt.Errorf("解析 QQ openid 响应失败: %w", err)
	}
	if payload.OpenID == "" {
		return "", "", fmt.Errorf("QQ 没有返回 openid")
	}
	return payload.OpenID, payload.UnionID, nil
}

func (c *QQClient) userInfo(ctx context.Context, token, openID string) (string, string) {
	q := url.Values{}
	q.Set("access_token", token)
	q.Set("oauth_consumer_key", c.cfg.AppID)
	q.Set("openid", openID)
	body, err := c.get(ctx, qqUserInfoURL+"?"+q.Encode())
	if err != nil {
		return "", ""
	}
	var payload struct {
		Ret       int    `json:"ret"`
		Nickname  string `json:"nickname"`
		AvatarURL string `json:"figureurl_qq_2"`
		Avatar1   string `json:"figureurl_qq_1"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Ret != 0 {
		return "", ""
	}
	avatar := payload.AvatarURL
	if avatar == "" {
		avatar = payload.Avatar1
	}
	return payload.Nickname, avatar
}

func (c *QQClient) get(ctx context.Context, endpoint string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 QQ 接口失败: %w", err)
	}
	defer resp.Body.Close()
	// 1 MB 足够放下 token / openid / 昵称头像，避免异常响应把内存打满
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取 QQ 响应失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("QQ 接口返回 HTTP %d", resp.StatusCode)
	}
	return body, nil
}
