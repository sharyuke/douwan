package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html/template"
	"log/slog"
	"os"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/seo"
)

// SEO 相关路径常量。
//
// 站点的公开可索引页面只有这几种：
//
//	/                                  首页
//	/materials/                        素材中心
//	/materials/category/{slug}/        素材分类页
//	/materials/{slug}/                 素材详情页
//	/tools/{slug}/                     SEO 工具页
//	/help/                             教程页
//
// 其它路径（工作台、账户、后台……）照常能用，但一律 noindex，不进 Sitemap。
const (
	SeoPathHome         = "/"
	SeoPathMaterials    = "/materials/"
	SeoPathCategoryBase = "/materials/category/"
	SeoPathMaterialBase = "/materials/"
	SeoPathToolsBase    = "/tools/"
	SeoPathHelp         = "/help/"
)

// sitemapShardSize 单个 sitemap 分片的最大 URL 数。
// 规范上限是 5 万条 / 50MB，这里用 1000 条一片，
// 页面变多时自动分片，搜索引擎一次拉一片不会超时。
const sitemapShardSize = 1000

// SeoService 搜索引擎优化服务。
//
// 职责边界：
//   - 生成 robots.txt / sitemap.xml（永远按当前真实数据生成，不落库，不会过期）；
//   - 把公开页面渲染成「爬虫能读到的 HTML」（注入 SPA 外壳）；
//   - 管理推送队列（百度主动推送、IndexNow、Google Sitemap 提交）。
type SeoService struct {
	repos    *repository.Repositories
	cfg      config.SEO
	content  *seo.ContentStore
	shell    *seo.ShellStore
	renderer *seo.Renderer
	pushers  []seo.Pusher
	siteURL  string
	log      *slog.Logger
}

// NewSeoService 构造 SEO 服务。
func NewSeoService(repos *repository.Repositories, cfg config.SEO) *SeoService {
	siteURL := strings.TrimRight(strings.TrimSpace(cfg.SiteURL), "/")
	if siteURL == "" {
		siteURL = "https://dw.sharyuke.com"
	}
	svc := &SeoService{
		repos:    repos,
		cfg:      cfg,
		content:  seo.NewContentStore(cfg.ContentFile),
		shell:    seo.NewShellStore(cfg.SpaRoot),
		renderer: seo.NewRenderer(),
		siteURL:  siteURL,
		log:      slog.Default().With("module", "seo"),
	}
	// 百度推送的 site 参数用主机名（与百度站长平台里登记的一致）。
	host := siteURL
	if i := strings.Index(host, "://"); i >= 0 {
		host = host[i+3:]
	}
	host = strings.TrimRight(host, "/")
	batch := cfg.PushBatchSize
	if batch <= 0 {
		batch = 20
	}
	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	svc.pushers = []seo.Pusher{
		seo.NewBaiduPusher(cfg.BaiduToken, host, timeout, batch),
		seo.NewIndexNowPusher(cfg.IndexNowKey, siteURL, timeout, 100),
		seo.NewGooglePusher(cfg.GoogleSite, siteURL+"/sitemap.xml", cfg.GoogleClientEmail, cfg.GooglePrivateKey, timeout),
	}
	return svc
}

// SiteURL 返回站点根地址（不带结尾斜杠）。
func (s *SeoService) SiteURL() string { return s.siteURL }

// AbsURL 把站内路径拼成完整地址。
func (s *SeoService) AbsURL(path string) string {
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return s.siteURL + path
}

// Enabled 是否启用了 SEO。
func (s *SeoService) Enabled() bool { return s.cfg.Enabled }

/* ------------------------------------------------------------------ 页面清单 */

// SeoPageMeta 一个可索引页面的元信息。
type SeoPageMeta struct {
	Path        string    `json:"path"`
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	LastMod     time.Time `json:"lastmod"`
	NoIndex     bool      `json:"noindex"`
	SourceType  string    `json:"source_type"`
	SourceID    uint64    `json:"source_id"`
	SourceName  string    `json:"source_name"`
	URL         string    `json:"url"`
}

// Pages 返回当前所有可索引页面（静态页 + 分类页 + 素材详情页）。
//
// 每次都按真实数据现算：素材刚发布就立刻出现在 Sitemap 里，
// 素材下架就立刻消失，不存在「缓存了旧列表」的问题。
func (s *SeoService) Pages(ctx context.Context) ([]SeoPageMeta, error) {
	out := make([]SeoPageMeta, 0, 128)
	content, _ := s.content.Get()

	for i := range content.Pages {
		p := content.Pages[i]
		if p.NoIndex {
			continue
		}
		out = append(out, SeoPageMeta{
			Path:        p.Path,
			Kind:        p.Kind,
			Title:       p.Title,
			Description: p.Description,
			LastMod:     s.staticLastMod(),
			SourceType:  "static",
			SourceName:  p.H1,
			URL:         s.AbsURL(p.Path),
		})
	}

	cats, err := s.repos.Category.ListAll(ctx, true)
	if err != nil {
		return nil, err
	}
	for i := range cats {
		c := cats[i]
		if c.SeoNoIndex {
			continue
		}
		path := SeoPathCategoryBase + c.Slug + "/"
		out = append(out, SeoPageMeta{
			Path:        path,
			Kind:        "material_category",
			Title:       s.categoryTitle(&c),
			Description: s.categoryDescription(&c),
			LastMod:     c.UpdatedAt,
			SourceType:  "category",
			SourceID:    c.ID,
			SourceName:  c.Name,
			URL:         s.AbsURL(path),
		})
	}

	assets, err := s.publishedAssets(ctx, 0, "")
	if err != nil {
		return nil, err
	}
	for i := range assets {
		a := assets[i]
		if a.SeoNoIndex {
			continue
		}
		path := SeoPathMaterialBase + a.Slug + "/"
		out = append(out, SeoPageMeta{
			Path:        path,
			Kind:        "material",
			Title:       s.assetTitle(&a),
			Description: s.assetDescription(&a),
			LastMod:     assetLastMod(&a),
			SourceType:  "material",
			SourceID:    a.ID,
			SourceName:  a.Title,
			URL:         s.AbsURL(path),
		})
	}
	return out, nil
}

// publishedAssets 取已发布素材。categorySlug 为空表示全部。
func (s *SeoService) publishedAssets(ctx context.Context, limit int, categorySlug string) ([]model.LibraryAsset, error) {
	q := dto.PublicAssetQuery{PageQuery: dto.PageQuery{Page: 1, PageSize: limit}}
	if limit <= 0 {
		q.PageSize = 5000
	}
	if categorySlug != "" {
		q.CategorySlug = categorySlug
	}
	list, _, err := s.repos.Asset.ListPublished(ctx, q)
	if err != nil {
		return nil, err
	}
	return list, nil
}

// assetLastMod 取素材的最后修改时间。
func assetLastMod(a *model.LibraryAsset) time.Time {
	t := a.UpdatedAt
	if a.PublishedAt != nil && a.PublishedAt.After(t) {
		t = *a.PublishedAt
	}
	return t
}

// staticLastMod 静态页的更新时间：取内容文件的修改时间。
func (s *SeoService) staticLastMod() time.Time {
	if p := s.content.Path(); p != "" {
		if st, err := os.Stat(p); err == nil {
			return st.ModTime()
		}
	}
	return time.Now().Truncate(time.Hour)
}

/* ------------------------------------------------------------------ robots / sitemap */

// RobotsTXT 生成 robots.txt。
//
// 原则：
//   - 放行 Baiduspider / Googlebot / Bingbot 等主流爬虫；
//   - 不屏蔽 JS / CSS / 图片（那些是页面渲染与图片收录需要的）；
//   - 声明 Sitemap 地址；
//   - 后台等私有路径不靠 robots 屏蔽（robots 不是访问控制手段），
//     但仍然禁止抓取，避免把后台地址收进索引。
func (s *SeoService) RobotsTXT() string {
	var b strings.Builder
	b.WriteString("# 豆玩 DOUWAN · robots.txt\n")
	b.WriteString("# 公开内容全部开放抓取；私有内容由登录与权限控制，必要时配合 noindex。\n\n")
	b.WriteString("User-agent: *\n")
	b.WriteString("Allow: /\n")
	b.WriteString("Disallow: /admin\n")
	b.WriteString("Disallow: /account\n")
	b.WriteString("Disallow: /settings\n")
	b.WriteString("Disallow: /projects\n")
	b.WriteString("Disallow: /inventory\n")
	b.WriteString("Disallow: /editor\n")
	b.WriteString("Disallow: /build\n")
	b.WriteString("Disallow: /auth\n")
	b.WriteString("Disallow: /api/\n")
	b.WriteString("\n")
	for _, agent := range []string{"Baiduspider", "Googlebot", "Bingbot"} {
		b.WriteString("User-agent: " + agent + "\n")
		b.WriteString("Allow: /\n")
		b.WriteString("\n")
	}
	b.WriteString("Sitemap: " + s.AbsURL("/sitemap.xml") + "\n")
	return b.String()
}

// SitemapXML 生成 /sitemap.xml。
//
// 页面数量不多时直接输出 urlset；超过分片阈值时输出 sitemapindex，
// 由 /sitemap-{n}.xml 提供分片。
func (s *SeoService) SitemapXML(ctx context.Context) (string, error) {
	pages, err := s.Pages(ctx)
	if err != nil {
		return "", err
	}
	if len(pages) <= sitemapShardSize {
		return s.urlset(pages), nil
	}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	shards := (len(pages) + sitemapShardSize - 1) / sitemapShardSize
	for i := 0; i < shards; i++ {
		b.WriteString(fmt.Sprintf("  <sitemap><loc>%s</loc><lastmod>%s</lastmod></sitemap>\n",
			s.AbsURL(fmt.Sprintf("/sitemap-%d.xml", i+1)),
			s.staticLastMod().UTC().Format("2006-01-02T15:04:05+00:00")))
	}
	b.WriteString("</sitemapindex>\n")
	return b.String(), nil
}

// SitemapShardXML 生成第 n 个分片（n 从 1 开始）。
func (s *SeoService) SitemapShardXML(ctx context.Context, n int) (string, error) {
	pages, err := s.Pages(ctx)
	if err != nil {
		return "", err
	}
	if n < 1 {
		n = 1
	}
	start := (n - 1) * sitemapShardSize
	if start >= len(pages) {
		return "", nil
	}
	end := start + sitemapShardSize
	if end > len(pages) {
		end = len(pages)
	}
	return s.urlset(pages[start:end]), nil
}

// urlset 把页面清单渲染成 sitemap urlset。
func (s *SeoService) urlset(pages []SeoPageMeta) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for _, p := range pages {
		b.WriteString("  <url>\n")
		b.WriteString("    <loc>" + xmlEscape(p.URL) + "</loc>\n")
		if !p.LastMod.IsZero() {
			b.WriteString("    <lastmod>" + p.LastMod.UTC().Format("2006-01-02T15:04:05+00:00") + "</lastmod>\n")
		}
		b.WriteString("    <changefreq>" + changefreqOf(p.Kind) + "</changefreq>\n")
		b.WriteString("    <priority>" + priorityOf(p.Kind) + "</priority>\n")
		b.WriteString("  </url>\n")
	}
	b.WriteString("</urlset>\n")
	return b.String()
}

// changefreqOf 按页面类型给出更新频率建议。
func changefreqOf(kind string) string {
	switch kind {
	case "material":
		return "weekly"
	case "material_category", "materials":
		return "daily"
	default:
		return "weekly"
	}
}

// priorityOf 按页面类型给出优先级建议。
func priorityOf(kind string) string {
	switch kind {
	case "home":
		return "1.0"
	case "materials":
		return "0.9"
	case "material_category":
		return "0.8"
	case "tool":
		return "0.8"
	case "material":
		return "0.7"
	default:
		return "0.5"
	}
}

// xmlEscape 转义 XML 里的特殊字符。
func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")
	return r.Replace(s)
}

/* ------------------------------------------------------------------ 页面渲染 */

// RenderResult 一次页面渲染的结果。
type RenderResult struct {
	HTML   string
	Status int
	// Kind 页面类型（home / material / material_category / tools / help / app / notfound）
	Kind string
	// Note 渲染说明（例如「内容文件缺失，已降级」），后台可查
	Note string
}

// RenderPath 渲染一个站内路径对应的 HTML。
//
// 公开可索引页面返回带完整 meta 与正文的 HTML；
// 应用内页面返回带 noindex 的外壳；不存在的路径返回 404 外壳。
func (s *SeoService) RenderPath(ctx context.Context, path string) (RenderResult, error) {
	shell, note := s.shell.Get()
	content, contentNote := s.content.Get()
	if contentNote != "" {
		if note != "" {
			note += "；" + contentNote
		} else {
			note = contentNote
		}
	}

	view, status, kind, err := s.buildView(ctx, path, content)
	if err != nil {
		return RenderResult{}, err
	}
	view.GoogleVerify = s.cfg.GoogleVerify
	view.BingVerify = s.cfg.BingVerify

	head, err := s.renderer.Head(*view)
	if err != nil {
		return RenderResult{}, err
	}
	body, err := s.renderer.Body(*view)
	if err != nil {
		return RenderResult{}, err
	}
	return RenderResult{
		HTML:   seo.Inject(shell, head, body),
		Status: status,
		Kind:   kind,
		Note:   note,
	}, nil
}

// buildView 按路径构造渲染数据。
func (s *SeoService) buildView(ctx context.Context, path string, content *seo.ContentFile) (*seo.PageView, int, string, error) {
	p := normalizePath(path)
	site := content.Site
	if site.Name == "" {
		site.Name = "豆玩 DOUWAN"
	}
	if site.Slogan == "" {
		site.Slogan = "所爱皆可拼，万物皆可造"
	}
	base := seo.PageView{
		Site:      site,
		Path:      p,
		Canonical: s.AbsURL(p),
	}

	switch {
	case p == SeoPathHome:
		sp := content.Page(SeoPathHome)
		if sp == nil {
			return s.fallbackView(&base, "首页"), 200, "home", nil
		}
		s.applyStatic(&base, sp)
		base.JSONLD = s.homeJSONLD(&base)
		return &base, 200, "home", nil

	case p == SeoPathMaterials:
		return s.materialsView(ctx, &base)

	case strings.HasPrefix(p, SeoPathCategoryBase):
		slug := strings.TrimSuffix(strings.TrimPrefix(p, SeoPathCategoryBase), "/")
		return s.categoryView(ctx, &base, slug)

	case strings.HasPrefix(p, SeoPathToolsBase):
		sp := content.Page(p)
		if sp == nil {
			return s.notFoundView(&base), 404, "notfound", nil
		}
		s.applyStatic(&base, sp)
		base.JSONLD = s.toolJSONLD(&base)
		return &base, 200, "tool", nil

	case p == SeoPathHelp:
		sp := content.Page(SeoPathHelp)
		if sp == nil {
			return s.fallbackView(&base, "教程"), 200, "help", nil
		}
		s.applyStatic(&base, sp)
		base.JSONLD = s.webPageJSONLD(&base)
		return &base, 200, "help", nil

	case strings.HasPrefix(p, SeoPathMaterialBase):
		slug := strings.TrimSuffix(strings.TrimPrefix(p, SeoPathMaterialBase), "/")
		return s.materialView(ctx, &base, slug)
	}

	// 应用内页面：照常给外壳，但明确 noindex。
	if content.IsAppRoute(p) {
		base.NoIndex = true
		base.Title = site.Name + " · " + appRouteTitle(p)
		base.Description = site.Description
		base.H1 = appRouteTitle(p)
		base.Canonical = s.AbsURL(p)
		return &base, 200, "app", nil
	}
	return s.notFoundView(&base), 404, "notfound", nil
}

// applyStatic 把静态页配置套到渲染数据上。
func (s *SeoService) applyStatic(v *seo.PageView, sp *seo.StaticPage) {
	v.Title = sp.Title
	v.Description = sp.Description
	v.H1 = sp.H1
	v.Lead = sp.Lead
	v.Intro = sp.Intro
	v.Features = sp.Features
	v.Steps = sp.Steps
	v.Sections = sp.Sections
	v.Links = sp.Links
	v.Keywords = strings.Join(sp.Keywords, ",")
	v.OGImage = s.absAsset(v.Site.OgImage)
	if v.OGImage == "" {
		v.OGImage = s.absAsset(v.Site.Logo)
	}
	if sp.Badge != "" {
		v.Lead = strings.TrimSpace(sp.Badge + " · " + sp.Lead)
	}
}

// absAsset 把站内资源路径拼成绝对地址。
func (s *SeoService) absAsset(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	if strings.HasPrefix(p, "http://") || strings.HasPrefix(p, "https://") {
		return p
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return s.siteURL + p
}

// fallbackView 内容文件缺失时的兜底页面。
func (s *SeoService) fallbackView(v *seo.PageView, what string) *seo.PageView {
	v.Title = v.Site.Name + " · 免费拼豆图纸生成器"
	v.Description = v.Site.Description
	v.H1 = "免费拼豆图纸生成器"
	v.Lead = "上传图片，在浏览器里本地生成拼豆图纸：" + what + "。"
	v.Links = []seo.Link{
		{Href: "/materials/", Text: "免费拼豆素材库"},
		{Href: "/help/", Text: "拼豆教程与常见问题"},
	}
	return v
}

// notFoundView 404 页面。
func (s *SeoService) notFoundView(v *seo.PageView) *seo.PageView {
	v.NoIndex = true
	v.Title = "页面不存在 · " + v.Site.Name
	v.Description = "这个页面不存在或已经下线。"
	v.H1 = "页面不存在"
	v.Lead = "你访问的地址可能已经失效。回到首页，或者去素材中心看看。"
	v.Links = []seo.Link{
		{Href: "/", Text: "回到首页"},
		{Href: "/materials/", Text: "免费拼豆素材库"},
	}
	return v
}

/* ------------------------------------------------------------------ 素材相关页面 */

// materialsView 素材中心页。
func (s *SeoService) materialsView(ctx context.Context, v *seo.PageView) (*seo.PageView, int, string, error) {
	cats, err := s.repos.Category.ListAll(ctx, true)
	if err != nil {
		return nil, 0, "", err
	}
	counts, err := s.repos.Asset.CountByCategory(ctx)
	if err != nil {
		return nil, 0, "", err
	}
	assets, err := s.publishedAssets(ctx, 24, "")
	if err != nil {
		return nil, 0, "", err
	}

	v.Title = "免费拼豆素材库 · 拼豆图纸素材大全 - 豆玩"
	v.Description = "豆玩素材库提供免费拼豆素材与拼豆图纸，覆盖萌宠、二次元、美食水果、植物花卉等分类，支持在线转拼豆图纸、匹配色号并导出打印。"
	v.H1 = "免费拼豆素材库"
	v.Lead = "所有素材免费使用，选中一张就能在浏览器里直接生成拼豆图纸。"
	v.Keywords = "拼豆素材,免费拼豆图纸,拼豆图纸下载,拼豆图案,豆玩素材库"

	// 分类链接渲染成正文里的链接列表（可被抓取的内链）
	for i := range cats {
		c := cats[i]
		if c.SeoNoIndex {
			continue
		}
		v.Links = append(v.Links, seo.Link{
			Href: s.AbsURL(SeoPathCategoryBase + c.Slug + "/"),
			Text: fmt.Sprintf("%s拼豆素材（%d 个）", c.Name, counts[c.ID]),
		})
	}
	v.Assets = s.assetViews(assets, 0)
	v.Count = len(assets)

	v.Breadcrumb = []seo.Crumb{
		{Name: "首页", Href: s.AbsURL("/")},
		{Name: "素材中心", Href: s.AbsURL(SeoPathMaterials)},
	}
	v.JSONLD = s.collectionJSONLD(v, "拼豆素材中心", assets)
	return v, 200, "materials", nil
}

// categoryView 分类页。
func (s *SeoService) categoryView(ctx context.Context, v *seo.PageView, slug string) (*seo.PageView, int, string, error) {
	if slug == "" {
		return s.notFoundView(v), 404, "notfound", nil
	}
	cat, err := s.repos.Category.FindBySlug(ctx, slug)
	if err != nil {
		return s.notFoundView(v), 404, "notfound", nil
	}
	if !cat.IsEnabled() {
		return s.notFoundView(v), 404, "notfound", nil
	}
	assets, err := s.publishedAssets(ctx, 48, cat.Slug)
	if err != nil {
		return nil, 0, "", err
	}

	v.Title = s.categoryTitle(cat)
	v.Description = s.categoryDescription(cat)
	v.H1 = cat.Name + "拼豆素材"
	v.Lead = cat.Description
	if v.Lead == "" {
		v.Lead = fmt.Sprintf("共 %d 个%s拼豆素材，全部免费，选中即可在线生成拼豆图纸。", len(assets), cat.Name)
	}
	v.Keywords = cat.Name + "拼豆,拼豆素材,免费拼豆图纸," + cat.Name + "拼豆图纸"
	v.Category = &seo.CategoryView{
		Name:        cat.Name,
		Slug:        cat.Slug,
		URL:         s.AbsURL(SeoPathCategoryBase + cat.Slug + "/"),
		Description: cat.Description,
		Cover:       s.absAsset(cat.CoverURL),
		Count:       len(assets),
	}
	v.Assets = s.assetViews(assets, 0)
	v.Count = len(assets)
	v.Breadcrumb = []seo.Crumb{
		{Name: "首页", Href: s.AbsURL("/")},
		{Name: "素材中心", Href: s.AbsURL(SeoPathMaterials)},
		{Name: cat.Name, Href: v.Category.URL},
	}
	v.JSONLD = s.collectionJSONLD(v, cat.Name+"拼豆素材", assets)
	return v, 200, "material_category", nil
}

// materialView 素材详情页。
func (s *SeoService) materialView(ctx context.Context, v *seo.PageView, slug string) (*seo.PageView, int, string, error) {
	if slug == "" {
		return s.notFoundView(v), 404, "notfound", nil
	}
	asset, err := s.repos.Asset.FindBySlug(ctx, slug)
	if err != nil {
		return s.notFoundView(v), 404, "notfound", nil
	}
	if !asset.IsPublished() {
		return s.notFoundView(v), 404, "notfound", nil
	}

	catName := asset.CategoryName
	catURL := ""
	if asset.CategoryID > 0 {
		if cat, err := s.repos.Category.FindByID(ctx, asset.CategoryID); err == nil {
			catName = cat.Name
			catURL = s.AbsURL(SeoPathCategoryBase + cat.Slug + "/")
		}
	}

	all, err := s.publishedAssets(ctx, 0, "")
	if err != nil {
		return nil, 0, "", err
	}
	sameCat := make([]model.LibraryAsset, 0, 6)
	for i := range all {
		if all[i].ID == asset.ID {
			continue
		}
		if asset.CategoryID > 0 && all[i].CategoryID == asset.CategoryID {
			sameCat = append(sameCat, all[i])
		}
		if len(sameCat) >= 6 {
			break
		}
	}

	v.Title = s.assetTitle(asset)
	v.Description = s.assetDescription(asset)
	v.H1 = asset.Title + "拼豆图纸素材"
	v.Lead = asset.Description
	if v.Lead == "" {
		v.Lead = fmt.Sprintf("%s拼豆素材，在线生成拼豆图纸、自动匹配色号并导出打印。", asset.Title)
	}
	v.Keywords = strings.Join(append([]string{asset.Title, "拼豆素材", "免费拼豆图纸"}, asset.Tags...), ",")
	v.OGImage = s.absAsset(asset.ImageURL)
	if v.OGImage == "" {
		v.OGImage = s.absAsset(asset.ThumbnailURL)
	}
	if v.OGImage == "" {
		v.OGImage = s.absAsset(v.Site.OgImage)
	}
	v.Assets = []seo.AssetView{s.assetView(asset, catName, catURL)}
	v.Related = s.assetViews(sameCat, 0)
	v.Count = 1

	v.Breadcrumb = []seo.Crumb{
		{Name: "首页", Href: s.AbsURL("/")},
		{Name: "素材中心", Href: s.AbsURL(SeoPathMaterials)},
	}
	if catURL != "" {
		v.Breadcrumb = append(v.Breadcrumb, seo.Crumb{Name: catName, Href: catURL})
	}
	v.Breadcrumb = append(v.Breadcrumb, seo.Crumb{Name: asset.Title, Href: s.AbsURL(SeoPathMaterialBase + asset.Slug + "/")})

	v.Links = []seo.Link{
		{Href: "/editor/", Text: "上传自己的图片生成拼豆图纸"},
		{Href: s.AbsURL(SeoPathMaterials), Text: "浏览全部免费拼豆素材"},
	}
	if catURL != "" {
		v.Links = append(v.Links, seo.Link{Href: catURL, Text: "更多" + catName + "拼豆素材"})
	}

	v.JSONLD = s.materialJSONLD(v, asset, catName, catURL, sameCat)
	return v, 200, "material", nil
}

// assetViews 把素材列表转成渲染用的摘要。
func (s *SeoService) assetViews(list []model.LibraryAsset, limit int) []seo.AssetView {
	out := make([]seo.AssetView, 0, len(list))
	for i := range list {
		out = append(out, s.assetView(&list[i], list[i].CategoryName, ""))
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// assetView 单个素材的渲染摘要。
func (s *SeoService) assetView(a *model.LibraryAsset, catName, catURL string) seo.AssetView {
	if catURL == "" && a.CategoryID > 0 {
		if cat, err := s.repos.Category.FindByID(context.Background(), a.CategoryID); err == nil {
			catURL = s.AbsURL(SeoPathCategoryBase + cat.Slug + "/")
		}
	}
	img := s.absAsset(a.ThumbnailURL)
	if img == "" {
		img = s.absAsset(a.ImageURL)
	}
	desc := strings.TrimSpace(a.Description)
	if runes := []rune(desc); len(runes) > 70 {
		desc = string(runes[:70]) + "…"
	}
	return seo.AssetView{
		Title:       a.Title,
		URL:         s.AbsURL(SeoPathMaterialBase + a.Slug + "/"),
		Image:       img,
		Alt:         a.Title + "拼豆图纸素材预览",
		Category:    catName,
		CategoryURL: catURL,
		Description: desc,
		Tags:        a.Tags,
		PublishedAt: a.PublishedAt.Format("2006-01-02"),
	}
}

/* ------------------------------------------------------------------ SEO 文案生成 */

// assetTitle 素材详情页的标题。
//
// 优先级：后台手填的 seo_title > 自动生成。
func (s *SeoService) assetTitle(a *model.LibraryAsset) string {
	if t := strings.TrimSpace(a.SeoTitle); t != "" {
		return t
	}
	return fmt.Sprintf("%s拼豆图纸素材免费下载 - 豆玩", a.Title)
}

// assetDescription 素材详情页的描述。
func (s *SeoService) assetDescription(a *model.LibraryAsset) string {
	if d := strings.TrimSpace(a.SeoDescription); d != "" {
		return d
	}
	cat := strings.TrimSpace(a.CategoryName)
	base := strings.TrimSpace(a.Description)
	if runes := []rune(base); len(runes) > 40 {
		base = string(runes[:40]) + "…"
	}
	if base != "" {
		return fmt.Sprintf("%s。可在豆玩在线转换成拼豆图纸，自动匹配色号、统计材料用量并导出打印。", base)
	}
	if cat != "" {
		return fmt.Sprintf("免费获取%s拼豆素材（%s），支持在线转换拼豆图纸、匹配色号、统计材料用量并导出打印，手机电脑都能用。", a.Title, cat)
	}
	return fmt.Sprintf("免费获取%s拼豆素材，支持在线转换拼豆图纸、匹配色号、统计材料用量并导出打印，手机电脑都能用。", a.Title)
}

// categoryTitle 分类页标题。
func (s *SeoService) categoryTitle(c *model.LibraryCategory) string {
	if t := strings.TrimSpace(c.SeoTitle); t != "" {
		return t
	}
	return fmt.Sprintf("%s拼豆图纸素材大全 - 免费下载制作 - 豆玩", c.Name)
}

// categoryDescription 分类页描述。
func (s *SeoService) categoryDescription(c *model.LibraryCategory) string {
	if d := strings.TrimSpace(c.SeoDescription); d != "" {
		return d
	}
	desc := strings.TrimSpace(c.Description)
	if desc != "" {
		return fmt.Sprintf("%s%s。全部素材免费，支持在线转拼豆图纸、匹配色号并导出打印。", c.Name, desc)
	}
	return fmt.Sprintf("%s拼豆素材，全部免费开放，支持在线转拼豆图纸、匹配色号、统计材料用量并导出打印。", c.Name)
}

/* ------------------------------------------------------------------ 结构化数据 */

// homeJSONLD 首页的结构化数据：WebSite + Organization + SoftwareApplication。
func (s *SeoService) homeJSONLD(v *seo.PageView) []template.JS {
	website := map[string]any{
		"@context":      "https://schema.org",
		"@type":         "WebSite",
		"name":          v.Site.Name,
		"alternateName": v.Site.Slogan,
		"url":           s.AbsURL("/"),
		"inLanguage":    "zh-CN",
	}
	org := map[string]any{
		"@context":    "https://schema.org",
		"@type":       "Organization",
		"name":        v.Site.Name,
		"url":         s.AbsURL("/"),
		"slogan":      v.Site.Slogan,
		"description": v.Site.Description,
	}
	app := map[string]any{
		"@context":            "https://schema.org",
		"@type":               "SoftwareApplication",
		"name":                "豆玩 DOUWAN 拼豆图纸生成器",
		"applicationCategory": "DesignApplication",
		"operatingSystem":     "Web",
		"url":                 s.AbsURL("/"),
		"description":         "免费拼豆图纸生成器：上传图片一键生成拼豆图纸，匹配色号、统计材料用量并导出打印。",
		"offers": map[string]any{
			"@type":         "Offer",
			"price":         "0",
			"priceCurrency": "CNY",
		},
	}
	return jsonLD(website, org, app)
}

// toolJSONLD 工具页的结构化数据：SoftwareApplication + WebPage。
func (s *SeoService) toolJSONLD(v *seo.PageView) []template.JS {
	app := map[string]any{
		"@context":            "https://schema.org",
		"@type":               "SoftwareApplication",
		"name":                v.H1,
		"applicationCategory": "DesignApplication",
		"operatingSystem":     "Web",
		"url":                 v.Canonical,
		"description":         v.Description,
		"offers": map[string]any{
			"@type":         "Offer",
			"price":         "0",
			"priceCurrency": "CNY",
		},
	}
	out := jsonLD(app)
	return append(out, s.webPageJSONLD(v)...)
}

// webPageJSONLD 通用网页结构化数据。
func (s *SeoService) webPageJSONLD(v *seo.PageView) []template.JS {
	page := map[string]any{
		"@context":    "https://schema.org",
		"@type":       "WebPage",
		"name":        v.Title,
		"description": v.Description,
		"url":         v.Canonical,
		"inLanguage":  "zh-CN",
		"isPartOf": map[string]any{
			"@type": "WebSite",
			"name":  v.Site.Name,
			"url":   s.AbsURL("/"),
		},
	}
	return jsonLD(page)
}

// collectionJSONLD 列表页（素材中心 / 分类页）的结构化数据。
func (s *SeoService) collectionJSONLD(v *seo.PageView, name string, assets []model.LibraryAsset) []template.JS {
	items := make([]map[string]any, 0, len(assets))
	for i := range assets {
		a := assets[i]
		items = append(items, map[string]any{
			"@type":    "ListItem",
			"position": i + 1,
			"url":      s.AbsURL(SeoPathMaterialBase + a.Slug + "/"),
			"name":     a.Title,
		})
	}
	list := map[string]any{
		"@context":    "https://schema.org",
		"@type":       "CollectionPage",
		"name":        name,
		"description": v.Description,
		"url":         v.Canonical,
		"inLanguage":  "zh-CN",
		"mainEntity": map[string]any{
			"@type":           "ItemList",
			"numberOfItems":   len(items),
			"itemListElement": items,
		},
		"isPartOf": map[string]any{
			"@type": "WebSite",
			"name":  v.Site.Name,
			"url":   s.AbsURL("/"),
		},
	}
	out := jsonLD(list)
	if len(v.Breadcrumb) > 0 {
		out = append(out, s.breadcrumbJSONLD(v))
	}
	return out
}

// materialJSONLD 素材详情页的结构化数据：ImageObject + ItemList + BreadcrumbList。
func (s *SeoService) materialJSONLD(v *seo.PageView, a *model.LibraryAsset, catName, catURL string, related []model.LibraryAsset) []template.JS {
	img := s.absAsset(a.ImageURL)
	if img == "" {
		img = s.absAsset(a.ThumbnailURL)
	}
	obj := map[string]any{
		"@context":    "https://schema.org",
		"@type":       "ImageObject",
		"name":        a.Title,
		"description": v.Description,
		"contentUrl":  img,
		"url":         v.Canonical,
		"inLanguage":  "zh-CN",
	}
	if a.ImageWidth > 0 && a.ImageHeight > 0 {
		obj["width"] = a.ImageWidth
		obj["height"] = a.ImageHeight
	}
	if a.PublishedAt != nil {
		obj["datePublished"] = a.PublishedAt.Format("2006-01-02")
	}
	if img != "" {
		obj["thumbnailUrl"] = img
	}
	out := jsonLD(obj)
	items := make([]map[string]any, 0, len(related))
	for i := range related {
		items = append(items, map[string]any{
			"@type":    "ListItem",
			"position": i + 1,
			"url":      s.AbsURL(SeoPathMaterialBase + related[i].Slug + "/"),
			"name":     related[i].Title,
		})
	}
	if len(items) > 0 {
		out = append(out, jsonLD(map[string]any{
			"@context":        "https://schema.org",
			"@type":           "ItemList",
			"itemListElement": items,
		})...)
	}
	out = append(out, s.breadcrumbJSONLD(v))
	return out
}

// breadcrumbJSONLD 面包屑结构化数据。
func (s *SeoService) breadcrumbJSONLD(v *seo.PageView) template.JS {
	elements := make([]map[string]any, 0, len(v.Breadcrumb))
	for i, c := range v.Breadcrumb {
		elements = append(elements, map[string]any{
			"@type":    "ListItem",
			"position": i + 1,
			"name":     c.Name,
			"item":     c.Href,
		})
	}
	return jsonLD(map[string]any{
		"@context":        "https://schema.org",
		"@type":           "BreadcrumbList",
		"itemListElement": elements,
	})[0]
}

// jsonLD 把结构化数据对象序列化成可放进 <script type="application/ld+json"> 的字符串。
func jsonLD(items ...map[string]any) []template.JS {
	out := make([]template.JS, 0, len(items))
	for _, it := range items {
		raw, err := seo.JSONLDString(it)
		if err != nil {
			continue
		}
		out = append(out, raw)
	}
	return out
}

/* ------------------------------------------------------------------ 推送队列 */

// EnqueueResult 入队结果。
type EnqueueResult struct {
	Created  int      `json:"created"`
	Skipped  int      `json:"skipped"`
	SkippedR []string `json:"skipped_reasons"`
}

// Enqueue 把若干页面加入推送队列。
//
// 只对「可索引 + 内容有变化」的页面入队：
// 同一页面内容指纹没变时跳过，避免白白消耗百度的每日配额。
func (s *SeoService) Enqueue(ctx context.Context, paths []string, action, trigger string) (EnqueueResult, error) {
	res := EnqueueResult{}
	if len(paths) == 0 {
		return res, nil
	}
	pages, err := s.Pages(ctx)
	if err != nil {
		return res, err
	}
	byPath := make(map[string]SeoPageMeta, len(pages))
	for _, p := range pages {
		byPath[p.Path] = p
	}

	now := time.Now()
	tasks := make([]model.SeoPushTask, 0, len(paths)*2)
	for _, path := range paths {
		path = normalizePath(path)
		meta, ok := byPath[path]
		if !ok && action == model.SeoActionSubmit {
			res.Skipped++
			res.SkippedR = append(res.SkippedR, path+"：不是可索引页面")
			continue
		}
		hash := contentHash(path, meta.Title, meta.Description)
		for _, engine := range s.pushers {
			if engine.Name() == model.SeoEngineGoogle {
				// Google 通道只提交 Sitemap，不推单个 URL
				continue
			}
			if !engine.Configured() {
				continue
			}
			if action == model.SeoActionSubmit {
				last, found, err := s.repos.SeoTask.LastSuccessHash(ctx, engine.Name(), path)
				if err == nil && found && last == hash {
					res.Skipped++
					res.SkippedR = append(res.SkippedR, path+"：内容未变化，跳过重复推送")
					continue
				}
			}
			tasks = append(tasks, model.SeoPushTask{
				URL:         s.AbsURL(path),
				Path:        path,
				Engine:      engine.Name(),
				Action:      action,
				Status:      model.SeoTaskPending,
				Trigger:     trigger,
				ContentHash: hash,
				QueuedAt:    now,
				NextRunAt:   &now,
			})
		}
	}
	if len(tasks) > 0 {
		if err := s.repos.SeoTask.BulkCreate(ctx, tasks); err != nil {
			return res, err
		}
		res.Created = len(tasks)
	}
	return res, nil
}

// contentHash 内容指纹：路径 + 标题 + 描述。
func contentHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:])[:32]
}

// RunQueue 处理队列里到期的任务。
//
// 返回处理条数与成功条数。失败的任务会按退避策略安排下一次重试，
// 超过 max_attempts 就停在 failed，不再无限重试。
func (s *SeoService) RunQueue(ctx context.Context) (int, int, error) {
	now := time.Now()
	total := 0
	success := 0
	for _, pusher := range s.pushers {
		if !pusher.Configured() {
			continue
		}
		tasks, err := s.repos.SeoTask.DueTasks(ctx, pusher.Name(), now, 50)
		if err != nil {
			return total, success, err
		}
		if len(tasks) == 0 {
			continue
		}
		// 按引擎批量提交：百度一次最多 push_batch_size 条，IndexNow 一次最多 100 条。
		batchSize := 1
		if pusher.Name() == model.SeoEngineBaidu {
			batchSize = s.cfg.PushBatchSize
		} else if pusher.Name() == model.SeoEngineIndexNow {
			batchSize = 100
		}
		if batchSize < 1 {
			batchSize = 1
		}
		var chunk []model.SeoPushTask
		flush := func() {
			if len(chunk) == 0 {
				return
			}
			urls := make([]string, 0, len(chunk))
			for _, t := range chunk {
				urls = append(urls, t.URL)
			}
			result, err := pusher.Push(ctx, urls)
			total += len(chunk)
			s.applyResult(ctx, chunk, result, err)
			if result.OK {
				success += len(chunk)
			}
			chunk = chunk[:0]
		}
		for _, t := range tasks {
			chunk = append(chunk, t)
			if len(chunk) >= batchSize {
				flush()
			}
		}
		flush()
	}
	return total, success, nil
}

// applyResult 把推送结果写回任务记录。
func (s *SeoService) applyResult(ctx context.Context, tasks []model.SeoPushTask, result seo.PushResult, err error) {
	now := time.Now()
	for _, t := range tasks {
		fields := map[string]any{
			"attempts":   t.Attempts + 1,
			"response":   truncateText(result.Response, 4000),
			"status":     model.SeoTaskSuccess,
			"last_error": "",
		}
		switch {
		case err != nil:
			fields["status"] = model.SeoTaskFailed
			fields["last_error"] = truncateText(err.Error(), 900)
		case result.Skipped:
			fields["status"] = model.SeoTaskSkipped
			fields["last_error"] = truncateText(result.Message, 900)
		case !result.OK:
			fields["status"] = model.SeoTaskFailed
			fields["last_error"] = truncateText(result.Message, 900)
		}
		if fields["status"] == model.SeoTaskFailed {
			attempts := t.Attempts + 1
			if attempts >= s.maxAttempts() {
				fields["next_run_at"] = nil
			} else {
				// 指数退避：1 分钟、5 分钟、15 分钟、1 小时……
				delay := time.Duration(1<<uint(attempts)) * time.Minute
				if delay > time.Hour {
					delay = time.Hour
				}
				next := now.Add(delay)
				fields["next_run_at"] = &next
			}
		} else {
			fields["next_run_at"] = nil
			fields["finished_at"] = &now
		}
		_ = s.repos.SeoTask.UpdateFields(ctx, t.ID, fields)
	}
}

// maxAttempts 最大重试次数。
func (s *SeoService) maxAttempts() int {
	if s.cfg.MaxAttempts > 0 {
		return s.cfg.MaxAttempts
	}
	return 5
}

// CronReport 巡检结果。
type CronReport struct {
	CheckedAt   time.Time `json:"checked_at"`
	Pages       int       `json:"pages"`
	Queued      int       `json:"queued"`
	Retried     int       `json:"retried"`
	Submitted   int       `json:"submitted"`
	Failed      int       `json:"failed"`
	RobotsOK    bool      `json:"robots_ok"`
	SitemapOK   bool      `json:"sitemap_ok"`
	SEOFilled   int       `json:"seo_filled"`
	Issues      []string  `json:"issues"`
	PushEnabled bool      `json:"push_enabled"`
}

// CronCheck 每日巡检。
//
// 做四件事：
//  1. 检查 Sitemap / robots 是否能正常生成；
//  2. 对比「公开页面」与「已推送记录」，把没推送过的补进队列；
//  3. 重试可恢复的失败任务；
//  4. 记录异常。
func (s *SeoService) CronCheck(ctx context.Context) (CronReport, error) {
	report := CronReport{
		CheckedAt:   time.Now(),
		PushEnabled: s.cfg.PushEnabled,
	}
	pages, err := s.Pages(ctx)
	if err != nil {
		return report, err
	}
	report.Pages = len(pages)

	// 0. 补齐自动生成的 SEO 文案（后台手填过的不动）
	if filled := s.BackfillSEO(ctx); filled > 0 {
		report.SEOFilled = filled
	}

	// 1. robots / sitemap 自检
	if strings.Contains(s.RobotsTXT(), "Sitemap: "+s.AbsURL("/sitemap.xml")) {
		report.RobotsOK = true
	} else {
		report.Issues = append(report.Issues, "robots.txt 里没有声明 Sitemap 地址")
	}
	if xml, err := s.SitemapXML(ctx); err == nil && strings.Contains(xml, "<urlset") {
		report.SitemapOK = true
	} else if err != nil {
		report.Issues = append(report.Issues, "sitemap 生成失败："+err.Error())
	} else {
		report.Issues = append(report.Issues, "sitemap 内容异常")
	}

	// 2. 补推没有推送记录、或者内容变了的页面
	pending := make([]string, 0, len(pages))
	for _, p := range pages {
		pending = append(pending, p.Path)
	}
	if len(pending) > 0 {
		res, err := s.Enqueue(ctx, pending, model.SeoActionSubmit, model.SeoTriggerCron)
		if err != nil {
			report.Issues = append(report.Issues, "补推入队失败："+err.Error())
		} else {
			report.Queued = res.Created
		}
	}

	// 3. 重试 + 执行
	if s.cfg.PushEnabled {
		total, success, err := s.RunQueue(ctx)
		if err != nil {
			report.Issues = append(report.Issues, "推送队列执行失败："+err.Error())
		}
		report.Retried = total
		report.Submitted = success
		report.Failed = total - success
	}
	return report, nil
}

// Cleanup 清理过期的推送记录。
func (s *SeoService) Cleanup(ctx context.Context) (int64, error) {
	days := s.cfg.RetainDays
	if days <= 0 {
		days = 90
	}
	return s.repos.SeoTask.DeleteBefore(ctx, time.Now().AddDate(0, 0, -days))
}

// BackfillSEO 为「还没填 SEO 文案」的素材 / 分类补上系统自动生成的文案。
//
// 为什么要落库：前台详情页与后台展示的标题必须和爬虫看到的完全一致，
// 如果标题只在渲染时现算，前端就拿不到同一份文案，两边会对不上。
// 只填空值，后台手工改过的永远不会被覆盖。返回补写的条数。
func (s *SeoService) BackfillSEO(ctx context.Context) int {
	filled := 0
	assets, err := s.publishedAssets(ctx, 0, "")
	if err == nil {
		for i := range assets {
			a := assets[i]
			fields := map[string]any{}
			if strings.TrimSpace(a.SeoTitle) == "" {
				fields["seo_title"] = s.assetTitle(&a)
			}
			if strings.TrimSpace(a.SeoDescription) == "" {
				fields["seo_description"] = s.assetDescription(&a)
			}
			if len(fields) == 0 {
				continue
			}
			if err := s.repos.Asset.UpdateFields(ctx, a.ID, fields); err == nil {
				filled++
			}
		}
	}
	cats, err := s.repos.Category.ListAll(ctx, true)
	if err == nil {
		for i := range cats {
			c := cats[i]
			fields := map[string]any{}
			if strings.TrimSpace(c.SeoTitle) == "" {
				fields["seo_title"] = s.categoryTitle(&c)
			}
			if strings.TrimSpace(c.SeoDescription) == "" {
				fields["seo_description"] = s.categoryDescription(&c)
			}
			if len(fields) == 0 {
				continue
			}
			if err := s.repos.Category.UpdateFields(ctx, c.ID, fields); err == nil {
				filled++
			}
		}
	}
	return filled
}

/* ------------------------------------------------------------------ 工具 */

// normalizePath 规范化站内路径：补前导斜杠、去掉重复斜杠、去掉结尾斜杠（首页除外）。
func normalizePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	for strings.Contains(p, "//") {
		p = strings.ReplaceAll(p, "//", "/")
	}
	if len(p) > 1 {
		p = strings.TrimSuffix(p, "/")
	}
	if p == "" {
		p = "/"
	}
	return p
}

// CanonicalPath 返回路径的规范形式。
//
// 公开页面统一用「目录式」带结尾斜杠的地址（/materials/xxx/），
// 这样同一个页面只有一个地址，不会出现 /materials/xxx 与 /materials/xxx/ 两个版本。
func (s *SeoService) CanonicalPath(path string) string {
	p := normalizePath(path)
	if p == "/" {
		return "/"
	}
	switch {
	case p == "/materials" || strings.HasPrefix(p, "/materials/"):
		return p + "/"
	case strings.HasPrefix(p, "/tools/"):
		return p + "/"
	case p == "/help":
		return p + "/"
	}
	return p
}

// appRouteTitle 应用内路由的标题。
func appRouteTitle(p string) string {
	switch {
	case strings.HasPrefix(p, "/editor"):
		return "创作工作台"
	case strings.HasPrefix(p, "/account"):
		return "我的账户"
	case strings.HasPrefix(p, "/settings"):
		return "设置"
	case strings.HasPrefix(p, "/projects"):
		return "我的作品"
	case strings.HasPrefix(p, "/inventory"):
		return "我的库存"
	case strings.HasPrefix(p, "/build"):
		return "拼制与完成"
	case strings.HasPrefix(p, "/materials"):
		return "材料清单"
	case strings.HasPrefix(p, "/admin"):
		return "后台管理"
	case strings.HasPrefix(p, "/auth"):
		return "登录回调"
	default:
		return "豆玩 DOUWAN"
	}
}

// truncateText 按字符数截断字符串。
func truncateText(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
