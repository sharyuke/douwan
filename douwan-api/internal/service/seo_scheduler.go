package service

import (
	"context"
	"time"
)

// StartScheduler 启动 SEO 后台协程。
//
// 做的事（对应需求「定期巡检」）：
//   - 启动后先跑一次巡检：把当前所有可索引页面补推进推送队列；
//   - 之后按 cron_interval 周期巡检：重试失败任务、补推新增页面、清理过期记录。
//
// 巡检本身不会阻塞主流程：任何一步出错只记日志，不影响服务。
//
// ⚠️ 推送只在 seo.push_enabled = true 时真正发出网络请求。
// 关掉它的时候，任务照样入队、照样记录，方便先观察再放开。
func (s *SeoService) StartScheduler(ctx context.Context) {
	if !s.cfg.Enabled {
		s.log.Info("SEO 已关闭，不启动巡检协程")
		return
	}
	interval := s.cfg.CronInterval
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	log := s.log

	// 启动后延迟一点再跑第一次：给数据库连接与前台页面发布留点时间，
	// 免得刚起来就把一堆任务打出去。
	go func() {
		delay := 60 * time.Second
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		s.runCheck(ctx, "启动")
	}()

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Info("SEO 巡检协程退出")
				return
			case <-ticker.C:
				s.runCheck(ctx, "定时")
			}
		}
	}()
}

// runCheck 执行一次巡检并记录结果。
func (s *SeoService) runCheck(ctx context.Context, trigger string) {
	report, err := s.CronCheck(ctx)
	if err != nil {
		s.log.Error("SEO 巡检失败", "trigger", trigger, "err", err)
		return
	}
	if n, err := s.Cleanup(ctx); err == nil && n > 0 {
		s.log.Info("清理过期推送记录", "deleted", n)
	}
	s.log.Info("SEO 巡检完成",
		"trigger", trigger,
		"pages", report.Pages,
		"queued", report.Queued,
		"submitted", report.Submitted,
		"failed", report.Failed,
		"robots_ok", report.RobotsOK,
		"sitemap_ok", report.SitemapOK,
		"issues", len(report.Issues),
	)
	for _, issue := range report.Issues {
		s.log.Warn("SEO 巡检发现异常", "issue", issue)
	}
}
