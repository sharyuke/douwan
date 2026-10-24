package service

import (
	"context"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

/* -------------------------------------------------------------- 访问量上报 */

// VisitBackfillHours 页面访问上报最多允许回补多久。
//
// 比埋点事件（7 天）短得多：访问量回答的是「现在有多少人在看」，
// 一条迟到三天的访问补进来只会让趋势图失真。前端正常情况下是实时上报，
// 这个窗口只用来兜住时区/时钟偏差与短暂的离线补报。
const VisitBackfillHours = 6

// IngestVisit 处理一次页面访问上报（前台接口，允许匿名）。
//
// 未登录也计入——这正是「访问量」与「用户活跃」的区别所在。
// 匿名访客只留下一个随机访客标识，不写任何可反查个人的信息。
func (s *ActivityService) IngestVisit(
	ctx context.Context, req dto.VisitReportRequest, userID uint64, ip, referrer, siteHost string,
) (dto.VisitReportResult, error) {
	_ = ctx // 上报只进内存缓冲，不查库
	now := s.now()
	out := dto.VisitReportResult{Enabled: s.enabled(), Path: model.NormalizeVisitPath(req.Path)}

	visitor := strings.TrimSpace(req.Visitor)
	if !model.IsVisitorID(visitor) {
		// 前端没带（或带得不像样）就发一个：它自己存下来，
		// 下次带上同一个标识才能把多次访问串成一个访客。
		visitor = model.NewVisitorID()
		if visitor == "" {
			return out, response.ErrInternal.WithMessage("无法生成访客标识，本次访问未计入")
		}
	}
	out.Visitor = visitor

	if !out.Enabled {
		out.Message = "服务端未开启活跃数据采集（activity.enabled=false），本次访问未计入"
		return out, nil
	}

	at := now
	if req.At != nil {
		at = *req.At
		// 时钟偏差与离线补报都往回收敛：太新、太旧都按当前时间算，
		// 否则客户端一个坏时间戳就能污染历史趋势。
		if at.After(now) || at.Before(now.Add(-VisitBackfillHours*time.Hour)) {
			at = now
		}
	}
	acq := resolveAcquisition(req.Channel, "", firstNonEmpty(req.Referrer, referrer), siteHost)
	out.Accepted = s.recorder.RecordPageView(activity.VisitRecord{
		Visitor: visitor,
		UserID:  userID,
		Path:    out.Path,
		At:      at,
		IP:      ip,
		// 渠道列是 32 / 128 字节，原样截断（超长 referrer 不该让上报失败）
		Channel:       acq.Channel,
		ChannelDetail: truncateUTF8(acq.Detail, 128),
	})
	if !out.Accepted {
		out.Message = "这次上报没有计入：同一页面 2 秒内的重复上报会被去抖，缓冲满时也会丢弃（详见后台「访问量」页的采集状态）"
	}
	return out, nil
}

/* ---------------------------------------------------------------- 访问量页 */

// Traffic 「访问量」标签页：PV / UV 指标卡 + 趋势 + 页面排行 + 落地页 + 来源。
func (s *ActivityService) Traffic(ctx context.Context, days, pagesLimit int) (dto.ActivityTraffic, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityTraffic{
		Enabled:     s.enabled(),
		Window:      window,
		Trend:       []dto.ActivityTrafficTrend{},
		Pages:       []dto.ActivityPageItem{},
		Landings:    []dto.ActivityLandingItem{},
		Sources:     []dto.ActivityTrafficSource{},
		Freshness:   s.freshness(),
		Notes:       s.trafficNotes(window),
		GeneratedAt: now,
	}

	trendRows, err := s.repos.Visit.DailyTraffic(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	newRows, err := s.repos.Visit.NewVisitorDays(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	stats, err := s.repos.Visit.WindowStats(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	totals, err := s.repos.Visit.Totals(ctx)
	if err != nil {
		return out, err
	}
	pageRows, err := s.repos.Visit.PageStats(ctx, window.From, window.To, pagesLimit)
	if err != nil {
		return out, err
	}
	landingRows, err := s.repos.Visit.LandingStats(ctx, window.From, window.To, pagesLimit)
	if err != nil {
		return out, err
	}
	sourceRows, err := s.repos.Visit.SourceStats(ctx, window.From, window.To, 30)
	if err != nil {
		return out, err
	}

	// 趋势要连续：没有数据的天补 0，前端不用自己对齐日期
	byDay := make(map[string]dto.ActivityTrafficTrend, len(trendRows)+len(newRows))
	for _, row := range trendRows {
		byDay[row.Day] = dto.ActivityTrafficTrend{Day: row.Day, PV: row.PV, UV: row.Visitors}
	}
	for _, row := range newRows {
		point := byDay[row.Day]
		point.Day = row.Day
		point.NewVisitors = row.Visitors
		byDay[row.Day] = point
	}

	cards := dto.ActivityTrafficCards{
		Day:            window.To,
		PV:             stats.PV,
		UV:             stats.Visitors,
		LoggedVisitors: stats.Logged,
		TotalVisitors:  totals.Visitors,
		TotalPV:        totals.PageViews,
	}
	dayList := window.DayList()
	var sumPV, sumUV int64
	for i, day := range dayList {
		point := byDay[day]
		point.Day = day
		out.Trend = append(out.Trend, point)

		sumPV += point.PV
		sumUV += point.UV
		cards.NewVisitors += point.NewVisitors
		if point.UV > cards.PeakUV {
			cards.PeakUV = point.UV
			cards.PeakUVDay = day
		}
		if i == len(dayList)-1 {
			cards.TodayPV = point.PV
			cards.TodayUV = point.UV
			cards.TodayNew = point.NewVisitors
		}
		if i == len(dayList)-2 {
			cards.YesterdayPV = point.PV
		}
	}
	// 回访访客 = 窗口 UV - 窗口内首次出现的访客。理论上不会为负（首次出现即算活跃），
	// 但被清理过明细的历史窗口可能对不上，兜一下底别让页面出现负数。
	cards.ReturningVisitors = cards.UV - cards.NewVisitors
	if cards.ReturningVisitors < 0 {
		cards.ReturningVisitors = 0
	}
	// 匿名访客 = UV - 带过登录态的访客（两者互斥，相加正好是 UV）
	cards.AnonymousVisitors = cards.UV - cards.LoggedVisitors
	if cards.AnonymousVisitors < 0 {
		cards.AnonymousVisitors = 0
	}
	if cards.UV > 0 {
		cards.PVPerUV = round2(float64(cards.PV) / float64(cards.UV))
	}
	if window.Days > 0 {
		cards.AvgDailyPV = round2(float64(sumPV) / float64(window.Days))
		cards.AvgDailyUV = round2(float64(sumUV) / float64(window.Days))
	}
	cards.PVChangePercent = changePercent(cards.TodayPV, cards.YesterdayPV)
	out.Cards = cards

	for _, row := range pageRows {
		item := dto.ActivityPageItem{
			Path:     row.Path,
			PV:       row.PV,
			Visitors: row.Visitors,
			Percent:  percent(row.PV, stats.PV),
		}
		if row.Visitors > 0 {
			item.PVPerVisitor = round2(float64(row.PV) / float64(row.Visitors))
		}
		out.Pages = append(out.Pages, item)
	}
	for _, row := range landingRows {
		out.Landings = append(out.Landings, dto.ActivityLandingItem{
			Path:     row.Path,
			Visitors: row.Visitors,
			Percent:  percent(row.Visitors, cards.NewVisitors),
		})
	}
	for _, row := range sourceRows {
		out.Sources = append(out.Sources, dto.ActivityTrafficSource{
			Channel:      row.Channel,
			ChannelLabel: model.ChannelLabel(row.Channel),
			Visitors:     row.Visitors,
			PV:           row.PV,
			// 来源份额按**访客**算（不是 PV）：一个渠道带来的人反复刷新，
			// 不该让它在「从哪来的」这件事上显得更重要。
			Percent: percent(row.Visitors, stats.Visitors),
		})
	}
	return out, nil
}

// TrafficVisitors 访客明细（分页）。UserID 为 0 的行就是纯匿名访客。
func (s *ActivityService) TrafficVisitors(
	ctx context.Context, q dto.ActivityVisitorListQuery,
) (dto.PageResult[dto.ActivityVisitorItem], error) {
	q.PageQuery.Normalize()
	window := dto.NewActivityWindow(q.Days, dto.DefaultActivityDays, dto.MaxActivityDays, s.now())
	filter := repository.VisitVisitorFilter{
		From:      window.From,
		To:        window.To,
		Sort:      q.Sort,
		PageQuery: q.PageQuery,
	}
	if q.HasChannel {
		filter.ChannelSet = true
		filter.Channel = normalizeChannelFilter(q.Channel)
	}
	if strings.TrimSpace(q.Path) != "" {
		filter.Path = model.NormalizeVisitPath(q.Path)
	}
	rows, total, err := s.repos.Visit.ListVisitors(ctx, filter)
	if err != nil {
		return dto.PageResult[dto.ActivityVisitorItem]{}, err
	}
	items := make([]dto.ActivityVisitorItem, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		item := dto.ActivityVisitorItem{
			Visitor:      model.MaskVisitor(row.Visitor),
			UserID:       row.UserID,
			Username:     row.Username,
			Anonymous:    row.UserID == 0,
			FirstDay:     row.FirstDay,
			LastDay:      row.LastDay,
			PageViews:    row.PageViews,
			LastSeenAt:   row.LastSeenAt,
			FirstPath:    row.FirstPath,
			LastPath:     row.LastPath,
			Channel:      row.Channel,
			ChannelLabel: model.ChannelLabel(row.Channel),
			Province:     row.Province,
			City:         row.City,
			ISP:          row.ISP,
			IP:           activity.MaskIP(row.IP),
		}
		item.Region = model.GeoRegion{Province: row.Province, City: row.City}.Label()
		items = append(items, item)
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

/* ------------------------------------------------------------ 口径说明 */

// trafficNotes 生成「访问量」页的口径说明。
//
// 这个页面的数字最容易被误读（UV 当成人数、PV 当成用户数），
// 所以口径必须跟着数字一起返回，而不是只写在文档里。
func (s *ActivityService) trafficNotes(window dto.ActivityWindow) []string {
	stats := s.recorder.Stats()
	flushSeconds := int(s.recorder.FlushInterval().Seconds())
	notes := []string{
		"访问量（PV）= 页面被打开的次数；访客数（UV）= 去重后的访客标识数。" +
			"访客标识是浏览器本地生成并持久化的随机串，清空浏览器数据、换设备、无痕窗口都会算成新访客——所以 UV 不等于人数。",
		"这里**包含未登录访客**，与「用户活跃」的口径不同（活跃只统计登录用户）；两边的数字不能互相加减。",
		"路径由前端上报，是路由模板（例如 /library/:slug）而不是完整 URL：同一模板下的不同详情页合并成一行。" +
			"非法路径统一归到 " + model.VisitorUnknownPath + "。",
		"去抖：同一个访客在同一个页面 2 秒内的重复上报只算一次（页面重定向、强刷、组件重复挂载都会产生重复上报）。",
		"日期口径：东八区（UTC+8）自然日，窗口为最近 " + itoa(window.Days) + " 天（" + window.From + " ~ " + window.To + "，含首尾）。",
		"数据新鲜度：与活跃数据共用内存缓冲，最多滞后一个 flush 周期（当前 " + itoa(flushSeconds) + " 秒）。",
		"后台页面（/#/admin/**）不计入访问量；`/api/v1/visits` 上报接口本身也不计入用户活跃的请求次数。",
	}
	if stats.DroppedVisits > 0 {
		notes = append(notes, "注意：访问缓冲曾达到上限，已丢弃 "+itoa64(stats.DroppedVisits)+
			" 次访问上报（通常意味着数据库写入异常，请查看 freshness.last_error）。")
	}
	if stats.GeoEnabled {
		notes = append(notes, "地区口径：取访客最近一次访问的 IP，由本地 ip2region 数据文件解析；接口只返回脱敏后的 IP。")
	} else {
		notes = append(notes, "地区口径：当前无法解析 IP 归属地（"+stats.GeoDisabledNote+"），访客地区都会落在「未知」。")
	}
	return notes
}
