package model

import "time"

// SEO 推送引擎。
//
// 只有这三家走「主动推送」通道：
//   - baidu    百度搜索资源平台的普通收录 API（POST /urls）
//   - indexnow IndexNow 协议（Bing / 微软系，以及其它参与协议的引擎）
//   - google   Google Search Console 的 Sitemap 提交接口（只提交 sitemap，不推单个 URL）
//
// Google 的 Indexing API **不能**用于普通网页，只适用于 Job / BroadcastEvent 之类的
// 官方索引页面，所以这里没有 google 单页推送通道。
const (
	SeoEngineBaidu    = "baidu"
	SeoEngineIndexNow = "indexnow"
	SeoEngineGoogle   = "google"
)

// SeoPushTaskStatus 推送任务状态。
const (
	SeoTaskPending = "pending" // 排队中
	SeoTaskRunning = "running" // 正在请求
	SeoTaskSuccess = "success" // 已提交（注意：只代表「已通知」，不代表被抓取或收录）
	SeoTaskFailed  = "failed"  // 失败，可重试
	SeoTaskSkipped = "skipped" // 主动跳过（配额用尽、内容没变、引擎未配置等）
)

// SeoPushAction 推送动作。
const (
	SeoActionSubmit = "submit" // 新增 / 更新
	SeoActionDelete = "delete" // 删除
)

// SeoPushTrigger 任务来源。
const (
	SeoTriggerAuto   = "auto"   // 素材发布 / 更新自动触发
	SeoTriggerManual = "manual" // 后台手动补推
	SeoTriggerCron   = "cron"   // 定时巡检重试
	SeoTriggerBatch  = "batch"  // 首次部署批量提交
)

// SeoPushTask 一条搜索引擎推送任务。
//
// 这张表同时是「队列」和「历史」：
//   - 队列语义：status = pending 且 next_run_at <= now 的任务会被后台协程取走执行；
//   - 历史语义：执行完的记录保留下来，后台「推送历史」页直接读它。
//
// content_hash 用来做「内容没变就不重复推送」：同一个 URL 的内容指纹不变时，
// 再次入队会被合并成一条跳过记录，不会白白消耗百度的配额。
type SeoPushTask struct {
	Base
	// URL 是提交给搜索引擎的完整地址（含 https 与域名）
	URL string `gorm:"size:512;not null;index" json:"url"`
	// Path 是站内路径（/materials/xxx/），用于聚合统计与排查
	Path string `gorm:"size:255;not null;index" json:"path"`
	// Engine 引擎：baidu / indexnow / google
	Engine string `gorm:"size:32;not null;index" json:"engine"`
	// Action submit / delete
	Action string `gorm:"size:16;not null;default:'submit'" json:"action"`
	// Status pending / running / success / failed / skipped
	Status string `gorm:"size:16;not null;default:'pending';index" json:"status"`
	// Attempts 已经尝试的次数
	Attempts int `gorm:"not null;default:0" json:"attempts"`
	// LastError 最近一次失败原因（接口返回的原文摘要）
	LastError string `gorm:"size:1000" json:"last_error"`
	// Response 引擎返回的原始内容（截断保存），用于排查配额与限流
	Response string `gorm:"type:text" json:"response"`
	// Trigger auto / manual / cron / batch
	Trigger string `gorm:"size:16;not null;default:'auto';index" json:"trigger"`
	// ContentHash 内容指纹，用于「内容未变化则不重复推送」
	ContentHash string `gorm:"size:64;index" json:"content_hash"`
	// Note 人工备注（例如「首次部署批量提交」）
	Note string `gorm:"size:255" json:"note"`

	QueuedAt   time.Time  `gorm:"index" json:"queued_at"`
	NextRunAt  *time.Time `gorm:"index" json:"next_run_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

// SeoTaskStatusLabel 状态中文名。
func SeoTaskStatusLabel(s string) string {
	switch s {
	case SeoTaskPending:
		return "待推送"
	case SeoTaskRunning:
		return "推送中"
	case SeoTaskSuccess:
		return "已提交"
	case SeoTaskFailed:
		return "失败"
	case SeoTaskSkipped:
		return "已跳过"
	default:
		return s
	}
}

// SeoEngineLabel 引擎中文名。
func SeoEngineLabel(e string) string {
	switch e {
	case SeoEngineBaidu:
		return "百度"
	case SeoEngineIndexNow:
		return "IndexNow"
	case SeoEngineGoogle:
		return "Google"
	default:
		return e
	}
}
