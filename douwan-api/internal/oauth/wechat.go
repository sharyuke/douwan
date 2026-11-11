package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
)

// 微信开放平台「网站应用」扫码登录。变量而不是常量，便于单测替换成 httptest。
var (
	wechatAuthorizeURL = "https://open.weixin.qq.com/connect/qrconnect"
	wechatTokenURL     = "https://api.weixin.qq.com/sns/oauth2/access_token"
	wechatUserInfoURL  = "https://api.weixin.qq.com/sns/userinfo"
)

// WeChatClient 是微信开放平台网站扫码登录的最小客户端。
//
// 只做「拼授权地址 / 用 code 换 token / 取资料」三件事，不碰数据库。
// AppSecret 只在服务端发请求时使用，不会出现在授权地址或错误文案里。
type WeChatClient struct {
	cfg  config.WeChatOAuth
	http *http.Client
}

// NewWeChatClient 构造客户端。调用方应先检查 cfg.Enabled()。
func NewWeChatClient(cfg config.WeChatOAuth) *WeChatClient {
	return &WeChatClient{cfg: cfg, http: &http.Client{Timeout: 10 * time.Second}}
}

// AuthorizeURL 生成微信扫码授权页地址。state 由服务端签发。
//
// 必须用网站应用的 AppID（scope=snsapi_login）；公众号 AppID 在这里会报
// 「scope 参数错误或没有 scope 权限」。
func (c *WeChatClient) AuthorizeURL(state string) string {
	q := url.Values{}
	q.Set("appid", c.cfg.AppID)
	q.Set("redirect_uri", c.cfg.RedirectURI)
	q.Set("response_type", "code")
	q.Set("scope", "snsapi_login")
	q.Set("state", state)
	return wechatAuthorizeURL + "?" + q.Encode() + "#wechat_redirect"
}

// CheckAvailability 预检扫码页，判断当前 AppID 能否用于网站扫码登录。
//
// 微信对「不是网站应用」的 AppID 仍返回 HTTP 200，只在页面里显示
// 「AppID 参数错误」。这里只看页面特征，不携带任何用户凭据；
// 网络错误原样返回，调用方应把「查不到」当成「可以尝试」。
func (c *WeChatClient) CheckAvailability(ctx context.Context) (Availability, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.AuthorizeURL("douwan-preflight"), nil)
	if err != nil {
		return Availability{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return Availability{}, fmt.Errorf("请求微信授权页失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	if err != nil {
		return Availability{}, fmt.Errorf("读取微信授权页失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Availability{}, fmt.Errorf("微信授权页返回 HTTP %d", resp.StatusCode)
	}
	if wechatAppIDInvalid(body) {
		return Availability{Enabled: false, Code: "appid_invalid"}, nil
	}
	return Availability{Enabled: true}, nil
}

// wechatAppIDInvalid 识别微信的「AppID 参数错误」页。
// 页面是 GBK，但 "AppID" 与 "weui_msg_title" 都是 ASCII，直接按字节匹配。
func wechatAppIDInvalid(body []byte) bool {
	return strings.Contains(string(body), "weui_msg_title") &&
		strings.Contains(string(body), "AppID")
}

// Exchange 用授权码换 access_token，再取 openid / unionid 与用户资料。
func (c *WeChatClient) Exchange(ctx context.Context, code string) (*Profile, error) {
	token, openID, unionID, err := c.exchangeToken(ctx, code)
	if err != nil {
		return nil, err
	}
	nickname, avatar, userUnionID := c.userInfo(ctx, token, openID)
	if userUnionID != "" {
		unionID = userUnionID
	}
	return &Profile{OpenID: openID, UnionID: unionID, Nickname: nickname, AvatarURL: avatar}, nil
}

func (c *WeChatClient) exchangeToken(ctx context.Context, code string) (string, string, string, error) {
	q := url.Values{}
	q.Set("appid", c.cfg.AppID)
	q.Set("secret", c.cfg.AppSecret)
	q.Set("code", code)
	q.Set("grant_type", "authorization_code")

	body, err := c.get(ctx, wechatTokenURL+"?"+q.Encode())
	if err != nil {
		return "", "", "", err
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		OpenID      string `json:"openid"`
		UnionID     string `json:"unionid"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", "", "", fmt.Errorf("解析微信 token 响应失败: %w", err)
	}
	if payload.ErrCode != 0 || payload.AccessToken == "" || payload.OpenID == "" {
		return "", "", "", fmt.Errorf("微信换取 token 失败: errcode=%d errmsg=%s",
			payload.ErrCode, strings.TrimSpace(payload.ErrMsg))
	}
	return payload.AccessToken, payload.OpenID, payload.UnionID, nil
}

func (c *WeChatClient) userInfo(ctx context.Context, token, openID string) (string, string, string) {
	q := url.Values{}
	q.Set("access_token", token)
	q.Set("openid", openID)
	q.Set("lang", "zh_CN")
	body, err := c.get(ctx, wechatUserInfoURL+"?"+q.Encode())
	if err != nil {
		return "", "", ""
	}
	var payload struct {
		OpenID    string `json:"openid"`
		Nickname  string `json:"nickname"`
		AvatarURL string `json:"headimgurl"`
		UnionID   string `json:"unionid"`
		ErrCode   int    `json:"errcode"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.ErrCode != 0 {
		return "", "", ""
	}
	return payload.Nickname, payload.AvatarURL, payload.UnionID
}

func (c *WeChatClient) get(ctx context.Context, endpoint string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求微信接口失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取微信响应失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("微信接口返回 HTTP %d", resp.StatusCode)
	}
	return body, nil
}
