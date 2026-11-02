package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// SeoHandler SEO 相关接口。
//
// 公开接口（不需要登录）：
//   GET /robots.txt          爬虫规则
//   GET /sitemap.xml         动态站点地图
//   GET /sitemap-{n}.xml     站点地图分片
//   GET /{key}.txt           IndexNow 密钥文件 / 站长平台验证文件
//   （页面本身由 nginx 交给 SSR 处理器渲染，见 SeoPage）
type SeoHandler struct {
	svc *service.SeoService
}

// NewSeoHandler 构造 SEO 处理函数集合。
func NewSeoHandler(svc *service.SeoService) *SeoHandler {
	return &SeoHandler{svc: svc}
}

/* ------------------------------------------------------------------ 公开接口 */

// Robots GET /robots.txt
func (h *SeoHandler) Robots(c *gin.Context) {
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=3600")
	c.String(http.StatusOK, h.svc.RobotsTXT())
}

// Sitemap GET /sitemap.xml
func (h *SeoHandler) Sitemap(c *gin.Context) {
	xml, err := h.svc.SitemapXML(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.Header("Content-Type", "application/xml; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=1800")
	c.String(http.StatusOK, xml)
}

// SitemapShard GET /sitemap-{n}.xml
func (h *SeoHandler) SitemapShard(c *gin.Context) {
	n, err := strconv.Atoi(strings.TrimSpace(c.Param("n")))
	if err != nil || n < 1 {
		response.Fail(c, response.ErrInvalidParam.WithMessage("分片编号不合法"))
		return
	}
	xml, err := h.svc.SitemapShardXML(c.Request.Context(), n)
	if err != nil {
		response.Fail(c, err)
		return
	}
	if strings.TrimSpace(xml) == "" {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Content-Type", "application/xml; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=1800")
	c.String(http.StatusOK, xml)
}

// Verification GET /{key}.txt —— IndexNow 密钥文件与站长平台验证文件。
//
// 只对配置里登记过的文件名返回内容，其它一律 404，
// 避免这个入口变成一个「任意文件读取」的后门。
func (h *SeoHandler) Verification(c *gin.Context) {
	name := strings.TrimSpace(c.Param("file"))
	if name == "" || strings.ContainsAny(name, "/\\.") {
		c.Status(http.StatusNotFound)
		return
	}
	content := h.svc.VerificationContent(name)
	if content == "" {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=86400")
	c.String(http.StatusOK, content)
}

// ServeVerification 尝试把请求当作「站长平台 / IndexNow 验证文件」处理。
//
// 走 NoRoute 分发（根路径下的单个文件没法用 gin 的静态路由占位，
// 会和 /healthz 这类固定路由冲突）。命中返回 true。
func (h *SeoHandler) ServeVerification(c *gin.Context) bool {
	path := c.Request.URL.Path
	if path == "/" || strings.Contains(path, "/") {
		return false
	}
	name := strings.TrimPrefix(path, "/")
	if !strings.HasSuffix(name, ".txt") && !strings.HasSuffix(name, ".html") {
		return false
	}
	content := h.svc.VerificationContent(name)
	if content == "" {
		return false
	}
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=86400")
	c.String(http.StatusOK, content)
	return true
}

// Page GET /... —— 渲染可抓取的页面 HTML。
//
// 这个接口由 nginx 在「路径既不是静态文件、也不是 API」时调用：
// 公开页面渲染成带正文与 meta 的 HTML，应用内页面加 noindex，
// 不存在的路径返回 404。
func (h *SeoHandler) Page(c *gin.Context) {
	path := c.Request.URL.Path
	// 规范地址统一带结尾斜杠，其余形式 301 过去，避免同一页面出现多个 URL。
	if target := h.svc.CanonicalPath(path); target != path {
		c.Redirect(http.StatusMovedPermanently, target)
		return
	}
	result, err := h.svc.RenderPath(c.Request.Context(), path)
	if err != nil {
		response.Fail(c, err)
		return
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	// 页面 HTML 每次都可能因为素材更新而变化，用短缓存 + ETag 由 nginx 决定是否回 304。
	c.Header("Cache-Control", "public, max-age=0, must-revalidate")
	if result.Status == http.StatusNotFound {
		c.Status(http.StatusNotFound)
	}
	c.String(result.Status, result.HTML)
}

/* ------------------------------------------------------------------ 后台接口 */

// Overview GET /api/v1/admin/seo/overview
//
// 关键口径：**「已推送」不等于「已收录」**。
// 这里只统计我们自己发出的通知与队列状态，不伪装成收录数据。
func (h *SeoHandler) Overview(c *gin.Context) {
	data, err := h.svc.Overview(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, data)
}

// Pages GET /api/v1/admin/seo/pages
func (h *SeoHandler) Pages(c *gin.Context) {
	limit := queryInt(c, "limit")
	pages, err := h.svc.AdminPages(c.Request.Context(), limit)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, pages)
}

// Tasks GET /api/v1/admin/seo/tasks
func (h *SeoHandler) Tasks(c *gin.Context) {
	limit := queryInt(c, "limit")
	tasks, total, err := h.svc.TaskList(c.Request.Context(),
		strings.TrimSpace(c.Query("engine")),
		strings.TrimSpace(c.Query("status")),
		strings.TrimSpace(c.Query("keyword")),
		limit)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{
		"list":  tasks,
		"total": total,
	})
}

// Push POST /api/v1/admin/seo/push
//
// 手动补推：可以推单个页面，也可以批量推「还没推过的历史页面」。
func (h *SeoHandler) Push(c *gin.Context) {
	var req struct {
		Paths  []string `json:"paths"`
		All    bool     `json:"all"`
		Engine []string `json:"engines"`
		Action string   `json:"action"`
	}
	if !bind(c, &req) {
		return
	}
	action := strings.TrimSpace(req.Action)
	if action == "" {
		action = model.SeoActionSubmit
	}
	if action != model.SeoActionSubmit && action != model.SeoActionDelete {
		response.Fail(c, response.ErrInvalidParam.WithMessage("action 只能是 submit 或 delete"))
		return
	}
	paths := req.Paths
	if req.All {
		all, err := h.svc.AllPagePaths(c.Request.Context())
		if err != nil {
			response.Fail(c, err)
			return
		}
		paths = all
	}
	if len(paths) == 0 {
		response.Fail(c, response.ErrInvalidParam.WithMessage("请指定要推送的页面，或勾选「全部页面」"))
		return
	}
	res, err := h.svc.EnqueueFiltered(c.Request.Context(), paths, action, model.SeoTriggerManual, req.Engine)
	if err != nil {
		response.Fail(c, err)
		return
	}
	// 手动补推立刻跑一次队列，让后台马上看到结果
	processed, submitted, runErr := h.svc.RunQueue(c.Request.Context())
	if runErr != nil {
		response.Success(c, gin.H{
			"queued":    res,
			"processed": processed,
			"submitted": submitted,
			"warning":   "入队成功，但执行推送时出错：" + runErr.Error(),
		})
		return
	}
	response.Success(c, gin.H{
		"queued":    res,
		"processed": processed,
		"submitted": submitted,
	})
}

// UpdatePage PATCH /api/v1/admin/seo/pages/:kind/:id
//
// 修改素材 / 分类的 SEO 标题与描述。
func (h *SeoHandler) UpdatePage(c *gin.Context) {
	kind := strings.TrimSpace(c.Param("kind"))
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req struct {
		SeoTitle       *string `json:"seo_title"`
		SeoDescription *string `json:"seo_description"`
		SeoNoIndex     *bool   `json:"seo_noindex"`
	}
	if !bind(c, &req) {
		return
	}
	if err := h.svc.UpdatePageSEO(c.Request.Context(), kind, id, req.SeoTitle, req.SeoDescription, req.SeoNoIndex); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已保存，页面会立即更新并进入推送队列"})
}

// Check POST /api/v1/admin/seo/check —— 立刻跑一次巡检。
func (h *SeoHandler) Check(c *gin.Context) {
	report, err := h.svc.CronCheck(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, report)
}

// Config GET /api/v1/admin/seo/config
//
// 只返回「配没配」的布尔值，不返回任何密钥明文。
func (h *SeoHandler) Config(c *gin.Context) {
	response.Success(c, h.svc.ConfigStatus())
}
