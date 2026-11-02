package service

import (
	"context"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/seo"
)

// 本文件是 SEO 服务的后台管理部分：
// 概览、页面清单、推送历史、手动补推、SEO 文案编辑、配置状态。
//
// 口径红线：后台只显示**我们自己发出的通知**（已提交 / 待推送 / 失败），
// 绝不把「推送成功」显示成「已收录」—— 没有接搜索引擎的官方数据接口之前，
// 收录数是拿不到的，编一个出来就是骗运营。

// SeoEngineStatus 一个推送通道的状态。
type SeoEngineStatus struct {
	Engine      string `json:"engine"`
	Label       string `json:"label"`
	Configured  bool   `json:"configured"`
	PushEnabled bool   `json:"push_enabled"`
	// QuotaRemain 百度当日剩余配额；其它引擎为 -1
	QuotaRemain int `json:"quota_remain"`
	// 说明文案（为什么没配置 / 配额情况）
	Message string `json:"message"`
	// 任务统计
	Pending int64 `json:"pending"`
	Success int64 `json:"success"`
	Failed  int64 `json:"failed"`
	Skipped int64 `json:"skipped"`
}

// SeoTaskItem 推送任务（后台列表用）。
type SeoTaskItem struct {
	ID         uint64     `json:"id"`
	URL        string     `json:"url"`
	Path       string     `json:"path"`
	Engine     string     `json:"engine"`
	EngineName string     `json:"engine_name"`
	Action     string     `json:"action"`
	Status     string     `json:"status"`
	StatusName string     `json:"status_name"`
	Attempts   int        `json:"attempts"`
	LastError  string     `json:"last_error"`
	Response   string     `json:"response"`
	Trigger    string     `json:"trigger"`
	QueuedAt   time.Time  `json:"queued_at"`
	NextRunAt  *time.Time `json:"next_run_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

// SeoAdminPage 后台页面清单里的一条。
type SeoAdminPage struct {
	Path        string    `json:"path"`
	Kind        string    `json:"kind"`
	KindName    string    `json:"kind_name"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	URL         string    `json:"url"`
	LastMod     time.Time `json:"lastmod"`
	NoIndex     bool      `json:"noindex"`
	SourceType  string    `json:"source_type"`
	SourceID    uint64    `json:"source_id"`
	SourceName  string    `json:"source_name"`
	// 已提交状态（来自推送记录）：none / success / failed / pending
	PushState string `json:"push_state"`
}

// SeoOverview 后台概览。
type SeoOverview struct {
	Enabled  bool   `json:"enabled"`
	SiteURL  string `json:"site_url"`
	Robots   string `json:"robots_url"`
	Sitemap  string `json:"sitemap_url"`
	IndexNow string `json:"indexnow_key_url"`

	// 可索引页面数
	Pages         int `json:"pages"`
	StaticPages   int `json:"static_pages"`
	CategoryPages int `json:"category_pages"`
	MaterialPages int `json:"material_pages"`

	RobotsOK  bool `json:"robots_ok"`
	SitemapOK bool `json:"sitemap_ok"`

	// 各引擎状态
	Engines []SeoEngineStatus `json:"engines"`

	// 任务总数（按状态）
	Tasks map[string]int64 `json:"tasks"`

	// 最近任务
	RecentTasks []SeoTaskItem `json:"recent_tasks"`

	// 最近一次巡检
	LastCheck *CronReport `json:"last_check"`

	// 口径说明，后台页面上原样展示，避免把「已提交」当成「已收录」
	Notice string `json:"notice"`
}

// lastCheck 记住最近一次巡检结果。
var _ = 0

// Overview 生成后台概览。
func (s *SeoService) Overview(ctx context.Context) (SeoOverview, error) {
	pages, err := s.Pages(ctx)
	if err != nil {
		return SeoOverview{}, err
	}
	ov := SeoOverview{
		Enabled:  s.cfg.Enabled,
		SiteURL:  s.siteURL,
		Robots:   s.AbsURL("/robots.txt"),
		Sitemap:  s.AbsURL("/sitemap.xml"),
		Pages:    len(pages),
		Tasks:    map[string]int64{},
		Notice:   "「已提交」只代表已经把通知交给了搜索引擎，不代表页面已被抓取或收录；收录与排名需要接官方数据接口后才能展示。",
	}
	if s.cfg.IndexNowKey != "" {
		ov.IndexNow = s.AbsURL("/" + s.cfg.IndexNowKey + ".txt")
	}
	for _, p := range pages {
		switch p.Kind {
		case "material":
			ov.MaterialPages++
		case "material_category":
			ov.CategoryPages++
		default:
			ov.StaticPages++
		}
	}

	counts, err := s.repos.SeoTask.CountByStatus(ctx)
	if err != nil {
		return ov, err
	}
	ov.Tasks = counts

	// robots / sitemap 自检
	ov.RobotsOK = strings.Contains(s.RobotsTXT(), "Sitemap: "+s.AbsURL("/sitemap.xml"))
	if xml, err := s.SitemapXML(ctx); err == nil {
		ov.SitemapOK = strings.Contains(xml, "<urlset") || strings.Contains(xml, "<sitemapindex")
	}

	// 各引擎状态
	for _, pusher := range s.pushers {
		st := SeoEngineStatus{
			Engine:      pusher.Name(),
			Label:       model.SeoEngineLabel(pusher.Name()),
			Configured:  pusher.Configured(),
			PushEnabled: s.cfg.PushEnabled,
			QuotaRemain: -1,
		}
		switch pusher.Name() {
		case model.SeoEngineBaidu:
			if !st.Configured {
				st.Message = "未配置百度推送 token（环境变量 DOUWAN_SEO_BAIDU_TOKEN）"
			} else {
				st.Message = "已配置普通收录 API"
			}
		case model.SeoEngineIndexNow:
			if !st.Configured {
				st.Message = "未配置 IndexNow 密钥（环境变量 DOUWAN_SEO_INDEXNOW_KEY）"
			} else {
				st.Message = "已配置，密钥文件在 " + ov.IndexNow
			}
		case model.SeoEngineGoogle:
			if !st.Configured {
				st.Message = "未配置 Search Console 服务账号：普通网页只通过 Sitemap 被发现，不使用 Indexing API"
			} else {
				st.Message = "已配置，提交 Sitemap 到 Search Console"
			}
		}
		for status, c := range counts {
			_ = c
			_ = status
		}
		ov.Engines = append(ov.Engines, st)
	}
	// 任务数按引擎细分
	for i := range ov.Engines {
		tasks, _, err := s.repos.SeoTask.List(ctx, ov.Engines[i].Engine, "", "", 500)
		if err != nil {
			continue
		}
		for _, t := range tasks {
			switch t.Status {
			case model.SeoTaskPending, model.SeoTaskRunning:
				ov.Engines[i].Pending++
			case model.SeoTaskSuccess:
				ov.Engines[i].Success++
			case model.SeoTaskFailed:
				ov.Engines[i].Failed++
			case model.SeoTaskSkipped:
				ov.Engines[i].Skipped++
			}
		}
	}

	// 最近任务
	recent, _, err := s.repos.SeoTask.List(ctx, "", "", "", 20)
	if err == nil {
		ov.RecentTasks = toTaskItems(recent)
	}
	return ov, nil
}

// AdminPages 返回后台页面清单（附推送状态）。
func (s *SeoService) AdminPages(ctx context.Context, limit int) ([]SeoAdminPage, error) {
	pages, err := s.Pages(ctx)
	if err != nil {
		return nil, err
	}
	latest, err := s.repos.SeoTask.LatestPerPath(ctx, "")
	if err != nil {
		latest = map[string]model.SeoPushTask{}
	}
	out := make([]SeoAdminPage, 0, len(pages))
	for _, p := range pages {
		item := SeoAdminPage{
			Path:        p.Path,
			Kind:        p.Kind,
			KindName:    seoKindLabel(p.Kind),
			Title:       p.Title,
			Description: p.Description,
			URL:         p.URL,
			LastMod:     p.LastMod,
			NoIndex:     p.NoIndex,
			SourceType:  p.SourceType,
			SourceID:    p.SourceID,
			SourceName:  p.SourceName,
			PushState:   "none",
		}
		if t, ok := latest[p.Path]; ok {
			item.PushState = t.Status
		}
		out = append(out, item)
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// TaskList 推送历史。
func (s *SeoService) TaskList(ctx context.Context, engine, status, keyword string, limit int) ([]SeoTaskItem, int64, error) {
	tasks, total, err := s.repos.SeoTask.List(ctx, engine, status, keyword, limit)
	if err != nil {
		return nil, 0, err
	}
	return toTaskItems(tasks), total, nil
}

// toTaskItems 把任务记录转成后台展示用的结构。
func toTaskItems(tasks []model.SeoPushTask) []SeoTaskItem {
	out := make([]SeoTaskItem, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, SeoTaskItem{
			ID:         t.ID,
			URL:        t.URL,
			Path:       t.Path,
			Engine:     t.Engine,
			EngineName: model.SeoEngineLabel(t.Engine),
			Action:     t.Action,
			Status:     t.Status,
			StatusName: model.SeoTaskStatusLabel(t.Status),
			Attempts:   t.Attempts,
			LastError:  t.LastError,
			Response:   t.Response,
			Trigger:    t.Trigger,
			QueuedAt:   t.QueuedAt,
			NextRunAt:  t.NextRunAt,
			FinishedAt: t.FinishedAt,
		})
	}
	return out
}

// AllPagePaths 返回全部可索引页面的路径（批量补推用）。
func (s *SeoService) AllPagePaths(ctx context.Context) ([]string, error) {
	pages, err := s.Pages(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(pages))
	for _, p := range pages {
		out = append(out, p.Path)
	}
	return out, nil
}

// EnqueueFiltered 只对指定引擎入队。engines 为空表示全部引擎。
func (s *SeoService) EnqueueFiltered(ctx context.Context, paths []string, action, trigger string, engines []string) (EnqueueResult, error) {
	if len(engines) == 0 {
		return s.Enqueue(ctx, paths, action, trigger)
	}
	allow := map[string]bool{}
	for _, e := range engines {
		allow[strings.TrimSpace(e)] = true
	}
	res := EnqueueResult{}
	pages, err := s.Pages(ctx)
	if err != nil {
		return res, err
	}
	byPath := make(map[string]SeoPageMeta, len(pages))
	for _, p := range pages {
		byPath[p.Path] = p
	}
	now := time.Now()
	tasks := make([]model.SeoPushTask, 0, len(paths))
	for _, path := range paths {
		path = normalizePath(path)
		meta, ok := byPath[path]
		if !ok && action == model.SeoActionSubmit {
			res.Skipped++
			res.SkippedR = append(res.SkippedR, path+"：不是可索引页面")
			continue
		}
		hash := contentHash(path, meta.Title, meta.Description)
		for _, pusher := range s.pushers {
			if !allow[pusher.Name()] || !pusher.Configured() {
				continue
			}
			if pusher.Name() == model.SeoEngineGoogle {
				continue
			}
			tasks = append(tasks, model.SeoPushTask{
				URL:         s.AbsURL(path),
				Path:        path,
				Engine:      pusher.Name(),
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

// UpdatePageSEO 修改素材 / 分类的 SEO 文案。
//
// kind 取 material / material_category。改完立刻重新入队推送，
// 让搜索引擎尽快看到新文案。
func (s *SeoService) UpdatePageSEO(ctx context.Context, kind string, id uint64, title, description *string, noindex *bool) error {
	fields := map[string]any{}
	switch kind {
	case "material":
		if title != nil {
			fields["seo_title"] = strings.TrimSpace(*title)
		}
		if description != nil {
			fields["seo_description"] = strings.TrimSpace(*description)
		}
		if noindex != nil {
			fields["seo_noindex"] = *noindex
		}
		if len(fields) == 0 {
			return nil
		}
		asset, err := s.repos.Asset.FindByID(ctx, id)
		if err != nil {
			return err
		}
		if err := s.repos.Asset.UpdateFields(ctx, id, fields); err != nil {
			return err
		}
		path := SeoPathMaterialBase + asset.Slug + "/"
		if _, err := s.EnqueueFiltered(ctx, []string{path}, model.SeoActionSubmit, model.SeoTriggerManual, nil); err != nil {
			return err
		}
		return nil

	case "material_category":
		if title != nil {
			fields["seo_title"] = strings.TrimSpace(*title)
		}
		if description != nil {
			fields["seo_description"] = strings.TrimSpace(*description)
		}
		if noindex != nil {
			fields["seo_noindex"] = *noindex
		}
		if len(fields) == 0 {
			return nil
		}
		cat, err := s.repos.Category.FindByID(ctx, id)
		if err != nil {
			return err
		}
		if err := s.repos.Category.UpdateFields(ctx, id, fields); err != nil {
			return err
		}
		path := SeoPathCategoryBase + cat.Slug + "/"
		if _, err := s.EnqueueFiltered(ctx, []string{path}, model.SeoActionSubmit, model.SeoTriggerManual, nil); err != nil {
			return err
		}
		return nil
	}
	return errInvalidSeoKind
}

// errInvalidSeoKind 非法页面类型。
var errInvalidSeoKind = seoError("页面类型只能是 material 或 material_category")

// seoError 轻量错误类型（避免为了一句话引 response 包）。
type seoError string

// Error 实现 error。
func (e seoError) Error() string { return string(e) }

// VerificationContent 返回验证文件的内容。
//
// 只有配置里登记过的文件名才有内容：
//   - {IndexNowKey}.txt          IndexNow 密钥文件
//   - {BaiduVerifyFile}          百度站点验证文件
//   - {BaiduVerifyFile}.html     百度站点验证文件（HTML 版本）
func (s *SeoService) VerificationContent(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	if key := strings.TrimSpace(s.cfg.IndexNowKey); key != "" && name == key+".txt" {
		return key
	}
	if file := strings.TrimSpace(s.cfg.BaiduVerifyFile); file != "" {
		if name == file || name == file+".html" {
			return s.cfg.BaiduVerifyContent
		}
	}
	return ""
}

// ConfigStatus 返回各推送通道的配置状态。
//
// 只给「配没配」的布尔值与说明，**不返回任何密钥明文**。
func (s *SeoService) ConfigStatus() map[string]any {
	out := map[string]any{
		"enabled":       s.cfg.Enabled,
		"push_enabled":  s.cfg.PushEnabled,
		"site_url":      s.siteURL,
		"batch_size":    s.cfg.PushBatchSize,
		"cron_interval": s.cfg.CronInterval.String(),
		"retain_days":   s.cfg.RetainDays,
		"engines":       []map[string]any{},
	}
	engines := make([]map[string]any, 0, 3)
	for _, pusher := range s.pushers {
		engines = append(engines, map[string]any{
			"engine":     pusher.Name(),
			"label":      model.SeoEngineLabel(pusher.Name()),
			"configured": pusher.Configured(),
		})
	}
	out["engines"] = engines
	return out
}

// seoKindLabel 页面类型中文名。
func seoKindLabel(kind string) string {
	switch kind {
	case "home":
		return "首页"
	case "materials":
		return "素材中心"
	case "material_category":
		return "素材分类"
	case "material":
		return "素材详情"
	case "tool":
		return "工具页"
	case "help":
		return "教程页"
	default:
		return kind
	}
}

// 保证 repository 包被引用（TaskList 用到 repositories 的类型断言）。
var _ = repository.Repositories{}
var _ = seo.PushResult{}
