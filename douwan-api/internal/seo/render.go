package seo

import (
	"bytes"
	"encoding/json"
	"html/template"
	"strings"
)

// Crumb 面包屑的一节。
type Crumb struct {
	Name string `json:"name"`
	Href string `json:"href"`
}

// AssetView 渲染页面时用到的素材摘要。
type AssetView struct {
	Title       string   `json:"title"`
	URL         string   `json:"url"`
	Image       string   `json:"image"`
	Alt         string   `json:"alt"`
	Category    string   `json:"category"`
	CategoryURL string   `json:"category_url"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	PublishedAt string   `json:"published_at"`
}

// CategoryView 分类摘要。
type CategoryView struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	URL         string `json:"url"`
	Description string `json:"description"`
	Cover       string `json:"cover"`
	Count       int    `json:"count"`
}

// PageView 是渲染一个页面所需的全部数据。
type PageView struct {
	Site        SiteInfo
	Path        string
	Canonical   string
	Kind        string
	Title       string
	Description string
	H1          string
	Lead        string
	Intro       []string
	Features    []Feature
	Steps       []Step
	Sections    []Section
	Links       []Link
	Breadcrumb  []Crumb
	Keywords    string
	OGImage     string
	NoIndex     bool

	// GoogleVerify / BingVerify 是站长平台的站点所有权验证 meta 值
	GoogleVerify string
	BingVerify   string

	// JSONLD 结构化数据（已序列化成 JSON 字符串）
	JSONLD []template.JS

	// 素材 / 分类相关
	Category *CategoryView
	Assets   []AssetView
	Related  []AssetView
	Count    int
}

// Renderer 把 PageView 渲染成两段 HTML：head 片段与 body 片段。
type Renderer struct {
	head *template.Template
	body *template.Template
}

// NewRenderer 构造渲染器。
func NewRenderer() *Renderer {
	return &Renderer{
		head: template.Must(template.New("head").Parse(headTemplate)),
		body: template.Must(template.New("body").Parse(bodyTemplate)),
	}
}

// Head 渲染 <head> 里要插入的片段。
func (r *Renderer) Head(v PageView) (string, error) {
	var buf bytes.Buffer
	if err := r.head.Execute(&buf, v); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// Body 渲染 <div id="app"> 里要插入的内容片段。
func (r *Renderer) Body(v PageView) (string, error) {
	var buf bytes.Buffer
	if err := r.body.Execute(&buf, v); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// Inject 把两段内容注入 SPA 外壳。
//
// 外壳里的占位符由前端 index.html 提供：
//
//	<!--seo-head-->   → <head> 里
//	<!--seo-body-->   → <div id="app"> 里
func Inject(shell, head, body string) string {
	out := shell
	if strings.Contains(out, "<!--seo-head-->") {
		out = strings.Replace(out, "<!--seo-head-->", head, 1)
	} else {
		out = strings.Replace(out, "</head>", head+"\n</head>", 1)
	}
	if strings.Contains(out, "<!--seo-body-->") {
		out = strings.Replace(out, "<!--seo-body-->", body, 1)
	} else {
		out = strings.Replace(out, `<div id="app"></div>`, `<div id="app">`+body+`</div>`, 1)
	}
	return out
}

// JSONLDString 把结构化数据对象序列化成可以放进 <script> 的字符串。
//
// 会把 < > & 换成 JSON 的 \u 转义，防止内容里的尖括号提前结束 script 标签。
func JSONLDString(v any) (template.JS, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	s := string(raw)
	s = strings.ReplaceAll(s, "<", "\\u003c")
	s = strings.ReplaceAll(s, ">", "\\u003e")
	s = strings.ReplaceAll(s, "&", "\\u0026")
	return template.JS(s), nil
}

// headTemplate 是注入到 <head> 的片段。
const headTemplate = `
<title>{{.Title}}</title>
<meta name="description" content="{{.Description}}">
{{- if .NoIndex}}
<meta name="robots" content="noindex,follow">
{{- else}}
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
{{- end}}
<link rel="canonical" href="{{.Canonical}}">
{{- if .Keywords}}
<meta name="keywords" content="{{.Keywords}}">
{{- end}}
<meta property="og:type" content="website">
<meta property="og:site_name" content="{{.Site.Name}}">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.Canonical}}">
{{- if .OGImage}}
<meta property="og:image" content="{{.OGImage}}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{{.OGImage}}">
{{- else}}
<meta name="twitter:card" content="summary">
{{- end}}
<meta property="og:locale" content="zh_CN">
<meta name="twitter:title" content="{{.Title}}">
<meta name="twitter:description" content="{{.Description}}">
{{- if .GoogleVerify}}
<meta name="google-site-verification" content="{{.GoogleVerify}}">
{{- end}}
{{- if .BingVerify}}
<meta name="msvalidate.01" content="{{.BingVerify}}">
{{- end}}
{{- range .JSONLD}}
<script type="application/ld+json">{{.}}</script>
{{- end}}
`

// bodyTemplate 是注入到 <div id="app"> 的内容片段。
//
// 样式全部限定在 .seo-shell 下：这段内容会被 Vue 挂载时整体替换，
// 限定作用域可以避免与站点自身样式互相干扰。
const bodyTemplate = `
<div class="seo-shell">
{{- if .Breadcrumb}}
<nav class="seo-crumb" aria-label="面包屑">
{{- range $i, $c := .Breadcrumb}}{{if $i}}<span aria-hidden="true">/</span>{{end}}<a href="{{$c.Href}}">{{$c.Name}}</a>{{end}}
</nav>
{{- end}}
<h1 class="seo-h1">{{.H1}}</h1>
{{- if .Lead}}<p class="seo-lead">{{.Lead}}</p>{{end}}
{{- range .Intro}}<p class="seo-p">{{.}}</p>{{end}}
{{- if .Features}}
<div class="seo-grid">
{{- range .Features}}
<div class="seo-card"><b>{{.Title}}</b><p>{{.Body}}</p></div>
{{- end}}
</div>
{{- end}}
{{- if .Steps}}
<ol class="seo-steps">
{{- range .Steps}}<li><b>{{.Title}}</b><span>{{.Body}}</span></li>{{end}}
</ol>
{{- end}}
{{- if .Sections}}
{{- range .Sections}}
<h2 class="seo-h2">{{.H}}</h2>
{{- range .P}}<p class="seo-p">{{.}}</p>{{end}}
{{- end}}
{{- end}}
{{- if .Category}}
<div class="seo-meta">
<span>分类：<a href="{{.Category.URL}}">{{.Category.Name}}</a></span>
{{- if .Count}}<span>共 {{.Count}} 个素材</span>{{end}}
</div>
{{- end}}
{{- if .Assets}}
<div class="seo-assets">
{{- range .Assets}}
<article class="seo-asset">
{{- if .Image}}<img src="{{.Image}}" alt="{{.Alt}}" loading="lazy" decoding="async">{{end}}
<h3><a href="{{.URL}}">{{.Title}}</a></h3>
{{- if .Description}}<p class="seo-p">{{.Description}}</p>{{end}}
</article>
{{- end}}
</div>
{{- end}}
{{- if .Related}}
<h2 class="seo-h2">相关素材</h2>
<ul class="seo-links">
{{- range .Related}}<li><a href="{{.URL}}">{{.Title}}</a></li>{{end}}
</ul>
{{- end}}
{{- if .Links}}
<ul class="seo-links">
{{- range .Links}}<li><a href="{{.Href}}">{{.Text}}</a></li>{{end}}
</ul>
{{- end}}
</div>
<style>
.seo-shell{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#241f1c;background:#fffdf9;max-width:960px;margin:0 auto;padding:28px 20px 60px;line-height:1.9}
.seo-shell *{box-sizing:border-box}
.seo-crumb{font-size:13px;color:#8a807a;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap}
.seo-crumb a{color:#c1352a;text-decoration:none}
.seo-h1{font-size:30px;line-height:1.4;margin:0 0 12px;font-weight:800}
.seo-h2{font-size:20px;line-height:1.5;margin:26px 0 10px;font-weight:750}
.seo-lead{font-size:16px;color:#4b423c;margin:0 0 14px}
.seo-p{margin:0 0 12px;color:#4b423c;font-size:15px}
.seo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:18px 0}
.seo-card{border:1px solid #eee2d6;border-radius:14px;padding:14px 16px;background:#fff}
.seo-card b{display:block;font-size:16px;margin-bottom:6px}
.seo-card p{margin:0;font-size:14px;color:#6b615a}
.seo-steps{margin:16px 0;padding-left:20px;display:flex;flex-direction:column;gap:10px}
.seo-steps li{font-size:15px;color:#4b423c}
.seo-steps b{display:block;color:#241f1c}
.seo-steps span{font-size:14px;color:#6b615a}
.seo-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:14px;color:#6b615a;margin:12px 0}
.seo-meta a{color:#c1352a}
.seo-assets{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:18px 0}
.seo-asset{border:1px solid #eee2d6;border-radius:14px;padding:12px;background:#fff}
.seo-asset img{width:100%;height:auto;display:block;border-radius:10px;background:#fff6ef}
.seo-asset h3{font-size:16px;margin:10px 0 6px}
.seo-asset h3 a{color:#241f1c;text-decoration:none}
.seo-asset p{margin:0;font-size:13px;color:#6b615a}
.seo-links{padding-left:20px;margin:16px 0}
.seo-links li{margin:6px 0;font-size:15px}
.seo-links a{color:#c1352a}
@media(max-width:640px){.seo-shell{padding:20px 16px 48px}.seo-h1{font-size:24px}}
</style>
`
