// Package seo 负责「搜索引擎能读懂的部分」：站点内容清单、页面渲染、推送通道。
//
// 这里刻意不碰业务数据（素材、分类仍然归 library 模块管），
// 只提供三件东西：
//   1. ContentStore：读前端构建产物里的 pages.json，拿静态页的文案与结构；
//   2. Render：把页面数据渲染成可被爬虫读取的 HTML 片段，注入 SPA 外壳；
//   3. Pusher：把新 URL 通知给百度 / IndexNow / Google。
package seo

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SiteInfo 站点基础信息（品牌、slogan、默认分享图）。
type SiteInfo struct {
	Name        string   `json:"name"`
	Slogan      string   `json:"slogan"`
	URL         string   `json:"url"`
	Logo        string   `json:"logo"`
	OgImage     string   `json:"og_image"`
	Description string   `json:"description"`
	Keywords    []string `json:"keywords"`
}

// Feature 一个能力块（首页与工具页共用）。
type Feature struct {
	Icon  string `json:"icon"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Step 一个操作步骤。
type Step struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Section 一个长文小节（工具页的正文段落）。
type Section struct {
	H string   `json:"h"`
	P []string `json:"p"`
}

// Link 一个站内链接（用于渲染可被抓取的 <a href>）。
type Link struct {
	Href string `json:"href"`
	Text string `json:"text"`
}

// StaticPage 一个静态 SEO 页面（首页 / 工具页 / 教程页）。
//
// 内容由前端 src/data/seo.js 与 src/data/tools.js 生成，
// 服务端与前端共用同一份文案，不会出现「爬虫看到的和用户看到的不一样」。
type StaticPage struct {
	Path        string    `json:"path"`
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	H1          string    `json:"h1"`
	Badge       string    `json:"badge"`
	Lead        string    `json:"lead"`
	Intro       []string  `json:"intro"`
	Features    []Feature `json:"features"`
	Steps       []Step    `json:"steps"`
	Sections    []Section `json:"sections"`
	Links       []Link    `json:"links"`
	Keywords    []string  `json:"keywords"`
	OgImage     string    `json:"og_image"`
	NoIndex     bool      `json:"noindex"`
}

// ContentFile 是 pages.json 的完整结构。
type ContentFile struct {
	Site SiteInfo `json:"site"`
	// Pages 静态页面（首页、工具页、教程页）
	Pages []StaticPage `json:"pages"`
	// Routes 是「应用内路由」清单（编辑器、账户、后台……）。
	// 这些页面照常能用，但不允许被索引。
	Routes []string `json:"routes"`
}

// ContentStore 读取并缓存 pages.json。
//
// 文件在构建前端时生成，发布时随前端产物一起覆盖过去。
// 这里按 mtime 判断是否需要重新读：文件变了立刻生效，不用重启服务。
type ContentStore struct {
	path string

	mu      sync.RWMutex
	content *ContentFile
	modTime time.Time
	loaded  bool
}

// NewContentStore 构造内容仓库。path 为空时不做任何事（返回空内容）。
func NewContentStore(path string) *ContentStore {
	return &ContentStore{path: strings.TrimSpace(path)}
}

// Path 返回内容文件路径。
func (s *ContentStore) Path() string { return s.path }

// Get 返回当前内容。文件缺失或解析失败时返回空内容与错误说明，
// 调用方据此降级（例如首页只渲染标题与简介）。
func (s *ContentStore) Get() (*ContentFile, string) {
	s.mu.RLock()
	if s.loaded && s.content != nil {
		c := s.content
		s.mu.RUnlock()
		return c, ""
	}
	s.mu.RUnlock()

	if s.path == "" {
		return &ContentFile{}, "未配置 seo.content_file"
	}
	st, err := os.Stat(s.path)
	if err != nil {
		return &ContentFile{}, fmt.Sprintf("读取 SEO 内容文件失败：%v", err)
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return &ContentFile{}, fmt.Sprintf("读取 SEO 内容文件失败：%v", err)
	}
	var content ContentFile
	if err := json.Unmarshal(raw, &content); err != nil {
		return &ContentFile{}, fmt.Sprintf("解析 SEO 内容文件失败：%v", err)
	}

	s.mu.Lock()
	s.content = &content
	s.modTime = st.ModTime()
	s.loaded = true
	s.mu.Unlock()
	return &content, ""
}

// Page 按路径查静态页面。
func (c *ContentFile) Page(path string) *StaticPage {
	if c == nil {
		return nil
	}
	for i := range c.Pages {
		if c.Pages[i].Path == path {
			return &c.Pages[i]
		}
	}
	return nil
}

// IsAppRoute 判断路径是不是「应用内路由」（应该 noindex）。
func (c *ContentFile) IsAppRoute(path string) bool {
	if c == nil {
		return false
	}
	p := strings.TrimSuffix(path, "/")
	if p == "" {
		p = "/"
	}
	for _, r := range c.Routes {
		r = strings.TrimSuffix(r, "/")
		if r == "" {
			r = "/"
		}
		if r == p {
			return true
		}
	}
	return false
}

// AppRoutePrefixes 返回所有应用内路由的前缀（用于判断未匹配路径该 404 还是该给外壳）。
func (c *ContentFile) AppRoutePrefixes() []string {
	if c == nil {
		return nil
	}
	return c.Routes
}

// SiteURLFromFile 猜站点根地址（pages.json 里没写就用配置里的）。
func (c *ContentFile) SiteURLFromFile(fallback string) string {
	if c != nil && strings.TrimSpace(c.Site.URL) != "" {
		return strings.TrimRight(strings.TrimSpace(c.Site.URL), "/")
	}
	return strings.TrimRight(fallback, "/")
}

// ShellStore 读取并缓存前端 index.html 外壳。
//
// 服务端把渲染好的 SEO 内容注入这个外壳里，浏览器拿到的就是一个
// 「带完整可抓取内容 + 带 SPA 脚本」的页面。
type ShellStore struct {
	root string

	mu      sync.RWMutex
	content string
	modTime time.Time
	loaded  bool
}

// NewShellStore 构造外壳仓库。
func NewShellStore(root string) *ShellStore {
	return &ShellStore{root: strings.TrimSpace(root)}
}

// fallbackShell 是读不到 index.html 时的兜底外壳。
// 它保证 SEO 页面仍然返回「有内容、有 meta」的 HTML，而不是 500。
const fallbackShell = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!--seo-head-->
</head>
<body>
<div id="app"><!--seo-body--></div>
</body>
</html>
`

// Get 返回外壳 HTML。第二个返回值是说明（读不到时说明原因）。
func (s *ShellStore) Get() (string, string) {
	if s.root == "" {
		return fallbackShell, "未配置 seo.spa_root"
	}
	path := filepath.Join(s.root, "index.html")
	st, err := os.Stat(path)
	if err != nil {
		return fallbackShell, fmt.Sprintf("读取前端外壳失败：%v", err)
	}

	s.mu.RLock()
	if s.loaded && s.content != "" && st.ModTime().Equal(s.modTime) {
		c := s.content
		s.mu.RUnlock()
		return c, ""
	}
	s.mu.RUnlock()

	raw, err := os.ReadFile(path)
	if err != nil {
		return fallbackShell, fmt.Sprintf("读取前端外壳失败：%v", err)
	}
	html := string(raw)
	// 外壳里必须有这两个占位符，否则注入无从下手。
	if !strings.Contains(html, "<!--seo-head-->") || !strings.Contains(html, "<!--seo-body-->") {
		html = strings.Replace(html, "</head>", "<!--seo-head-->\n</head>", 1)
		html = strings.Replace(html, `<div id="app"></div>`, `<div id="app"><!--seo-body--></div>`, 1)
	}
	s.mu.Lock()
	s.content = html
	s.modTime = st.ModTime()
	s.loaded = true
	s.mu.Unlock()
	return html, ""
}
