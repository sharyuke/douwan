package service

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// ActivityService 是后台「用户活跃数据监控」的查询入口，也负责客户端埋点上报。
//
// 它只读不写（写由 internal/activity 的采集器异步完成），
// 每个返回值里都会带上 notes 说明统计口径——活跃类指标最容易被误读，
// 「这个数字是怎么算出来的」必须跟着数字一起返回。
type ActivityService struct {
	repos    *repository.Repositories
	recorder *activity.Recorder
	// now 便于测试固定时间
	now func() time.Time
}

// NewActivityService 构造活跃监控服务。recorder 允许为 nil（采集关闭时）。
func NewActivityService(repos *repository.Repositories, recorder *activity.Recorder) *ActivityService {
	return &ActivityService{repos: repos, recorder: recorder, now: time.Now}
}

/* ------------------------------------------------------------------ 概览 */

// Overview 首屏指标卡 + 趋势。
func (s *ActivityService) Overview(ctx context.Context, days int) (dto.ActivityOverview, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityOverview{
		Enabled:     s.enabled(),
		Window:      window,
		Trend:       []dto.ActivityTrend{},
		GeneratedAt: now,
		Freshness:   s.freshness(),
		Notes:       s.notes(window, false),
	}

	trend, err := s.repos.Activity.DailyTrend(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	// 窗口内去重活跃：趋势里逐日数字相加会重复计算「连着来好几天的人」
	windowActive, err := s.repos.Activity.DistinctActive(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	wauFrom := model.ActivityDay(now.AddDate(0, 0, -6))
	mauFrom := model.ActivityDay(now.AddDate(0, 0, -29))
	wau, mau, err := s.repos.Activity.WindowActiveCounts(ctx, wauFrom, mauFrom, window.To)
	if err != nil {
		return out, err
	}
	totalUsers, err := s.repos.User.CountUsers(ctx)
	if err != nil {
		return out, err
	}
	newByDay, newInWindow, err := s.newUsersByDay(ctx, window)
	if err != nil {
		return out, err
	}

	byDay := make(map[string]dto.ActivityTrend, len(trend))
	for _, row := range trend {
		byDay[row.Day] = dto.ActivityTrend{
			Day:         row.Day,
			ActiveUsers: row.ActiveUsers,
			Requests:    row.Requests,
			Features:    row.Features,
		}
	}
	cards := dto.ActivityCards{Day: window.To, TotalUsers: totalUsers, MAU: mau, WAU: wau}
	days_ := window.DayList()
	var (
		sumActive int64
		sumReq    int64
		sumFeat   int64
	)
	for i, day := range days_ {
		point := byDay[day]
		point.Day = day
		point.NewUsers = newByDay[day]
		out.Trend = append(out.Trend, point)

		sumActive += point.ActiveUsers
		sumReq += point.Requests
		sumFeat += point.Features
		if point.ActiveUsers > cards.PeakDAU {
			cards.PeakDAU = point.ActiveUsers
			cards.PeakDAUDay = day
		}
		if i == len(days_)-1 {
			// 最后一个点就是今天
			cards.TodayUsers = point.ActiveUsers
			cards.TodayNew = point.NewUsers
			cards.TodayReq = point.Requests
			cards.TodayFeat = point.Features
			cards.DAU = point.ActiveUsers
		}
		if i == len(days_)-2 {
			cards.DAUYesterday = point.ActiveUsers
		}
	}
	cards.ActiveUsers = windowActive
	cards.NewUsers = newInWindow
	cards.Requests = sumReq
	cards.Features = sumFeat
	if window.Days > 0 {
		cards.AvgDAU = round2(float64(sumActive) / float64(window.Days))
	}
	cards.DAUChangePercent = changePercent(cards.DAU, cards.DAUYesterday)
	cards.ActiveRate = percent(mau, totalUsers)
	cards.Stickiness = percent(cards.DAU, mau)
	out.Cards = cards
	return out, nil
}

/* ------------------------------------------------------------------ 留存 */

// Retention 新用户留存（按注册日分组队列）。
//
// 口径说明：分母是该日注册的全部新用户；分子是其中在第 N 天
// （注册当天为第 0 天）有活跃记录的人。注册当天没活跃也算在分母里——
// 留存率的定义就是这样，把注册当天活跃过的人排掉会让数字好看但失真。
func (s *ActivityService) Retention(ctx context.Context, days int) (dto.ActivityRetention, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityRetention{
		Enabled: s.enabled(),
		Window:  window,
		Cohorts: []dto.ActivityRetentionRow{},
		Notes:   s.retentionNotes(),
	}

	newByDay, _, err := s.newUsersByDay(ctx, window)
	if err != nil {
		return out, err
	}
	cohortFrom, okFrom := model.ParseActivityDay(window.From)
	cohortTo, okTo := model.ParseActivityDay(window.To)
	if !okFrom || !okTo {
		return out, nil
	}
	rows, err := s.repos.Activity.CohortActivity(ctx, cohortFrom, cohortTo.AddDate(0, 0, 1), window.From, window.To)
	if err != nil {
		return out, err
	}

	today := model.ActivityDay(now)
	cohorts := map[string]*dto.ActivityRetentionRow{}
	for day, users := range newByDay {
		cohorts[day] = &dto.ActivityRetentionRow{Day: day, NewUsers: users}
	}
	for _, row := range rows {
		day := model.ActivityDay(row.CreatedAt)
		cohort, ok := cohorts[day]
		if !ok {
			continue
		}
		offset := dayDiff(day, row.Day)
		switch offset {
		case 1:
			cohort.D1Users++
		case 3:
			cohort.D3Users++
		case 7:
			cohort.D7Users++
		}
	}

	out.Cohorts = make([]dto.ActivityRetentionRow, 0, len(cohorts))
	summary := dto.ActivityRetentionSummary{}
	for _, cohort := range cohorts {
		cohort.D1Eligible = dayDiff(cohort.Day, today) >= 1
		cohort.D3Eligible = dayDiff(cohort.Day, today) >= 3
		cohort.D7Eligible = dayDiff(cohort.Day, today) >= 7
		if cohort.D1Eligible {
			cohort.D1Rate = percent(cohort.D1Users, cohort.NewUsers)
			summary.EligibleD1++
			summary.CohortUsers += cohort.NewUsers
			summary.D1Users += cohort.D1Users
		}
		if cohort.D3Eligible {
			cohort.D3Rate = percent(cohort.D3Users, cohort.NewUsers)
			summary.EligibleD3++
		}
		if cohort.D7Eligible {
			cohort.D7Rate = percent(cohort.D7Users, cohort.NewUsers)
			summary.EligibleD7++
		}
		out.Cohorts = append(out.Cohorts, *cohort)
	}
	sort.Slice(out.Cohorts, func(i, j int) bool { return out.Cohorts[i].Day < out.Cohorts[j].Day })

	summary.CohortCount = len(out.Cohorts)
	summary.D1Rate = percent(summary.D1Users, summary.CohortUsers)
	// 3 日 / 7 日留存的加权分母与 1 日不同（队列集合不同），要各自累加
	summary.D3Rate = percent(summary.D3Users, eligibleUsers(out.Cohorts, 3))
	summary.D7Rate = percent(summary.D7Users, eligibleUsers(out.Cohorts, 7))
	out.Summary = summary
	return out, nil
}

// eligibleUsers 汇总「已经过完第 N 天」的队列人数，作为留存率的分母。
func eligibleUsers(cohorts []dto.ActivityRetentionRow, day int) int64 {
	var total int64
	for _, c := range cohorts {
		eligible := c.D1Eligible
		if day == 3 {
			eligible = c.D3Eligible
		} else if day == 7 {
			eligible = c.D7Eligible
		}
		if eligible {
			total += c.NewUsers
		}
	}
	return total
}

/* ------------------------------------------------------------ 使用频率 */

// Frequency 使用频率分布 + 最活跃用户。
func (s *ActivityService) Frequency(ctx context.Context, days int) (dto.ActivityFrequency, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityFrequency{
		Window:   window,
		Buckets:  []dto.ActivityFrequencyBucket{},
		TopUsers: []dto.ActivityUserItem{},
		Notes:    s.notes(window, false),
	}

	rows, err := s.repos.Activity.FrequencyHistogram(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	// 活跃天数直方图 → 分桶。分桶边界按运营习惯定：
	// 「只来过一天」是最需要关注的一档（拉新没留住），所以单独一桶。
	type bucketDef struct {
		label    string
		min, max int
	}
	defs := []bucketDef{
		{"仅 1 天", 1, 1},
		{"2~3 天", 2, 3},
		{"4~7 天", 4, 7},
		{"8~14 天", 8, 14},
		{"15 天以上", 15, 0},
	}
	totals := make([]int64, len(defs))
	var (
		allUsers  int64
		sumDays   int64
		medianCut int64
	)
	for _, row := range rows {
		allUsers += row.Users
		sumDays += row.ActiveDays * row.Users
		for i, def := range defs {
			if row.ActiveDays >= int64(def.min) && (def.max == 0 || row.ActiveDays <= int64(def.max)) {
				totals[i] += row.Users
				break
			}
		}
	}
	// 中位数：累计到一半用户所在的那一档的左边界（桶内没有更细的分布）
	half := allUsers / 2
	var running int64
	for i, def := range defs {
		running += totals[i]
		if running > half {
			medianCut = int64(def.min)
			break
		}
	}
	for i, def := range defs {
		out.Buckets = append(out.Buckets, dto.ActivityFrequencyBucket{
			Label:   def.label,
			MinDays: def.min,
			MaxDays: def.max,
			Users:   totals[i],
			Percent: percent(totals[i], allUsers),
		})
	}
	out.ActiveUsers = allUsers
	if allUsers > 0 {
		out.AvgActiveDays = round2(float64(sumDays) / float64(allUsers))
	}
	out.MedianActiveDays = float64(medianCut)

	top, _, err := s.repos.Activity.ListUserActivity(ctx, repository.ActivityUserFilter{
		From:          window.From,
		To:            window.To,
		MinActiveDays: 1,
		Sort:          "active_days",
		PageQuery:     dto.PageQuery{Page: 1, PageSize: 20},
	})
	if err != nil {
		return out, err
	}
	out.TopUsers = s.toUserItems(top)
	return out, nil
}

/* ---------------------------------------------------------------- 地区 */

// Regions 地区与运营商分布。
func (s *ActivityService) Regions(ctx context.Context, days, limit int) (dto.ActivityRegions, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityRegions{
		Window:    window,
		Provinces: []dto.ActivityRegionItem{},
		Cities:    []dto.ActivityRegionItem{},
		ISPs:      []dto.ActivityRegionItem{},
	}
	stats, err := s.repos.Activity.RegionStats(ctx, window.From, window.To, limit)
	if err != nil {
		return out, err
	}
	active, err := s.repos.Activity.DistinctActive(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	out.ActiveUsers = active
	out.UnknownUsers = stats.UnknownUsers
	out.GeoEnabled = s.geoEnabled()
	out.Notes = s.notes(window, true)
	out.Provinces = toRegionItems(stats.Provinces, active)
	out.Cities = toRegionItems(stats.Cities, active)
	out.ISPs = toRegionItems(stats.ISPs, active)
	return out, nil
}

func toRegionItems(rows []repository.ActivityRegionRow, total int64) []dto.ActivityRegionItem {
	out := make([]dto.ActivityRegionItem, 0, len(rows))
	for _, row := range rows {
		out = append(out, dto.ActivityRegionItem{
			Country:  row.Country,
			Province: row.Province,
			City:     row.City,
			ISP:      row.ISP,
			Users:    row.Users,
			Requests: row.Requests,
			Percent:  percent(row.Users, total),
		})
	}
	return out
}

/* ---------------------------------------------------------------- 功能 */

// Features 功能使用排行。
func (s *ActivityService) Features(ctx context.Context, days, limit int) (dto.ActivityFeatures, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityFeatures{Window: window, Items: []dto.ActivityFeatureItem{}, Notes: s.notes(window, false)}
	rows, err := s.repos.Activity.FeatureStats(ctx, window.From, window.To, limit)
	if err != nil {
		return out, err
	}
	var total int64
	for _, row := range rows {
		total += row.Count
	}
	for _, row := range rows {
		out.Items = append(out.Items, toFeatureItem(row, total))
	}
	return out, nil
}

func toFeatureItem(row repository.ActivityFeatureRow, total int64) dto.ActivityFeatureItem {
	return dto.ActivityFeatureItem{
		Feature:      row.Feature,
		FeatureLabel: model.FeatureLabel(row.Feature),
		Source:       row.Source,
		SourceLabel:  model.ActivitySourceLabel(row.Source),
		Users:        row.Users,
		Count:        row.Count,
		Percent:      percent(row.Count, total),
	}
}

/* ---------------------------------------------------------------- 渠道 */

// Channels 来源渠道分布与质量。
func (s *ActivityService) Channels(ctx context.Context, days int) (dto.ActivityChannels, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityChannels{Window: window, Items: []dto.ActivityChannelItem{}, Notes: s.channelNotes()}

	from, okFrom := model.ParseActivityDay(window.From)
	to, okTo := model.ParseActivityDay(window.To)
	if !okFrom || !okTo {
		return out, nil
	}
	to = to.AddDate(0, 0, 1) // 左闭右开

	newRows, err := s.repos.Activity.ChannelNewUsers(ctx, from, to)
	if err != nil {
		return out, err
	}
	totalRows, err := s.repos.Activity.ChannelTotalUsers(ctx)
	if err != nil {
		return out, err
	}
	activeRows, err := s.repos.Activity.ChannelActiveUsers(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}
	paidRows, err := s.repos.Activity.ChannelPaidUsers(ctx, from, to)
	if err != nil {
		return out, err
	}

	merged := map[string]*dto.ActivityChannelItem{}
	// 先铺开全量渠道（累计注册数），否则「这个渠道这几天没活跃」
	// 会从报表里整行消失，看起来像渠道不存在。
	for _, row := range totalRows {
		item := s.channelItem(merged, row.Channel)
		item.TotalUsers += row.Users
	}
	for _, row := range newRows {
		item := s.channelItem(merged, row.Channel)
		item.NewUsers += row.Users
		out.TotalNewUsers += row.Users
	}
	for _, row := range activeRows {
		item := s.channelItem(merged, row.Channel)
		item.ActiveUsers += row.Users
	}
	for _, row := range paidRows {
		item := s.channelItem(merged, row.Channel)
		item.PaidUsers += row.Users
		item.PaidAmount = round2(item.PaidAmount + row.Amount)
	}
	for _, item := range merged {
		item.ActiveRate = percent(item.ActiveUsers, item.TotalUsers)
		out.Items = append(out.Items, *item)
	}
	sort.Slice(out.Items, func(i, j int) bool {
		if out.Items[i].ActiveUsers != out.Items[j].ActiveUsers {
			return out.Items[i].ActiveUsers > out.Items[j].ActiveUsers
		}
		if out.Items[i].NewUsers != out.Items[j].NewUsers {
			return out.Items[i].NewUsers > out.Items[j].NewUsers
		}
		return out.Items[i].Channel < out.Items[j].Channel
	})
	return out, nil
}

func (s *ActivityService) channelItem(merged map[string]*dto.ActivityChannelItem, channel string) *dto.ActivityChannelItem {
	channel = strings.TrimSpace(channel)
	if item, ok := merged[channel]; ok {
		return item
	}
	item := &dto.ActivityChannelItem{Channel: channel, ChannelLabel: model.ChannelLabel(channel)}
	merged[channel] = item
	return item
}

/* ------------------------------------------------------------ 用户列表 */

// Users 活跃用户列表（含窗口内零活跃的沉默用户，用 min_active_days 区分）。
func (s *ActivityService) Users(ctx context.Context, q dto.ActivityUserListQuery) (dto.PageResult[dto.ActivityUserItem], error) {
	q.PageQuery.Normalize()
	window := dto.NewActivityWindow(q.Days, dto.DefaultActivityDays, dto.MaxActivityDays, s.now())
	filter := repository.ActivityUserFilter{
		From:          window.From,
		To:            window.To,
		Keyword:       q.Keyword,
		Province:      q.Province,
		MinActiveDays: int64(q.MinActiveDays),
		Sort:          q.Sort,
		PageQuery:     q.PageQuery,
	}
	if q.HasChannel {
		filter.ChannelSet = true
		filter.Channel = normalizeChannelFilter(q.Channel)
	}
	rows, total, err := s.repos.Activity.ListUserActivity(ctx, filter)
	if err != nil {
		return dto.PageResult[dto.ActivityUserItem]{}, err
	}
	return dto.NewPageResult(s.toUserItems(rows), total, q.PageQuery), nil
}

// UserDetail 单个用户的活跃详情。
func (s *ActivityService) UserDetail(ctx context.Context, userID uint64, days int) (dto.ActivityUserDetail, error) {
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, s.now())
	out := dto.ActivityUserDetail{Window: window, Daily: []dto.ActivityUserDay{}, Features: []dto.ActivityFeatureItem{}, Regions: []dto.ActivityRegionItem{}}

	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return out, err
	}
	rows, _, err := s.repos.Activity.ListUserActivity(ctx, repository.ActivityUserFilter{
		From: window.From, To: window.To, UserID: userID,
		PageQuery: dto.PageQuery{Page: 1, PageSize: 1},
	})
	if err != nil {
		return out, err
	}
	if len(rows) > 0 {
		out.User = s.toUserItems(rows)[0]
	} else {
		// 窗口内没有任何活跃记录，也要能把用户本身返回（不然详情页打不开）
		out.User = dto.ActivityUserItem{
			UserID:       user.ID,
			Username:     user.Username,
			Nickname:     user.Nickname,
			Channel:      user.Channel,
			ChannelLabel: model.ChannelLabel(user.Channel),
			CreatedAt:    user.CreatedAt,
			LastActiveAt: user.LastActiveAt,
		}
	}
	out.ChannelDetail = user.ChannelDetail

	totals, err := s.repos.Activity.UserTotals(ctx, userID)
	if err != nil {
		return out, err
	}
	out.TotalActiveDay = totals.ActiveDays
	out.TotalRequests = totals.Requests
	out.TotalFeatures = totals.Features
	out.FirstActiveDay = totals.FirstDay
	out.LastActiveDay = totals.LastDay

	daily, err := s.repos.Activity.UserDailyList(ctx, userID, window.From, window.To)
	if err != nil {
		return out, err
	}
	for i := range daily {
		row := &daily[i]
		out.Daily = append(out.Daily, dto.ActivityUserDay{
			Day:           row.Day,
			Requests:      row.RequestCount,
			Features:      row.FeatureCount,
			FirstActiveAt: row.FirstActiveAt,
			LastActiveAt:  row.LastActiveAt,
			Province:      row.Province,
			City:          row.City,
			ISP:           row.ISP,
			IP:            activity.MaskIP(row.IP),
		})
	}

	featureRows, err := s.repos.Activity.UserFeatureStats(ctx, userID, window.From, window.To)
	if err != nil {
		return out, err
	}
	var featureTotal int64
	for _, row := range featureRows {
		featureTotal += row.Count
	}
	for _, row := range featureRows {
		out.Features = append(out.Features, toFeatureItem(row, featureTotal))
	}

	regionRows, err := s.repos.Activity.UserRegionStats(ctx, userID, window.From, window.To)
	if err != nil {
		return out, err
	}
	out.Regions = toRegionItems(regionRows, int64(len(daily)))
	out.Notes = s.notes(window, true)
	return out, nil
}

/* ------------------------------------------------------------ 事件上报 */

// IngestEvents 接收客户端埋点上报。
//
// 服务端只接受「自己在浏览器里发生、服务端看不见」的功能点
// （图纸生成、导出、抠图、AI 出图等），白名单见 model.ActivityFeatureCatalog。
// 全部事件都被拒时返回业务错误，让前端在联调阶段立刻发现问题；
// 部分被拒时按成功返回，并在 rejected 里列出来。
func (s *ActivityService) IngestEvents(ctx context.Context, userID uint64, req dto.EventBatchRequest, ip string) (dto.EventBatchResult, error) {
	now := s.now()
	out := dto.EventBatchResult{Enabled: s.enabled(), Rejected: []string{}}
	if !s.enabled() {
		out.Message = "服务端未开启活跃数据采集（activity.enabled=false），本次上报已忽略"
		return out, nil
	}
	earliest := now.AddDate(0, 0, -dto.EventBackfillDays)
	for _, event := range req.Events {
		feature := strings.TrimSpace(event.Feature)
		if !model.IsClientActivityFeature(feature) {
			if model.IsActivityFeature(feature) {
				out.Rejected = append(out.Rejected, feature+"（服务端自动统计，不接受上报）")
			} else {
				out.Rejected = append(out.Rejected, feature+"（未知功能点）")
			}
			continue
		}
		count := event.Count
		if count <= 0 {
			count = 1
		}
		at := now
		if event.At != nil {
			at = *event.At
			// 时钟偏差与离线回补都往回收敛：超前的按当前时间算，
			// 太旧的也按当前时间算（否则客户端一个坏时间戳能污染历史数据）
			if at.After(now) || at.Before(earliest) {
				at = now
			}
		}
		s.recorder.RecordClientFeature(userID, at, ip, feature, count)
		out.Accepted++
		out.Hits += count
	}
	if out.Accepted == 0 {
		return out, response.ErrEventFeatureUnknown.WithMessage(
			"没有任何事件被接受，允许上报的功能点见接口文档（被拒：" + strings.Join(out.Rejected, "; ") + "）")
	}
	return out, nil
}

/* ------------------------------------------------------------ 内部工具 */

func (s *ActivityService) enabled() bool { return s.recorder.Enabled() }

func (s *ActivityService) geoEnabled() bool {
	return s.recorder.Stats().GeoEnabled
}

// freshness 把采集器的运行状态转成接口字段。
func (s *ActivityService) freshness() dto.ActivityFreshness {
	stats := s.recorder.Stats()
	return dto.ActivityFreshness{
		FlushIntervalSeconds: int(s.recorder.FlushInterval().Seconds()),
		BufferedBuckets:      stats.BufferedBuckets,
		BufferedHits:         stats.BufferedHits,
		DroppedHits:          stats.DroppedHits,
		LastFlushAt:          stats.LastFlushAt,
		LastError:            stats.LastError,
		GeoEnabled:           stats.GeoEnabled,
		GeoNote:              stats.GeoDisabledNote,
		BufferedVisits:       stats.BufferedVisits,
		BufferedVisitors:     stats.BufferedVisitors,
		DroppedVisits:        stats.DroppedVisits,
	}
}

// newUsersByDay 返回窗口内按天（东八区）切分的注册数与总数。
func (s *ActivityService) newUsersByDay(ctx context.Context, window dto.ActivityWindow) (map[string]int64, int64, error) {
	from, okFrom := model.ParseActivityDay(window.From)
	to, okTo := model.ParseActivityDay(window.To)
	if !okFrom || !okTo {
		return map[string]int64{}, 0, nil
	}
	stamps, err := s.repos.Activity.NewUserTimestamps(ctx, from, to.AddDate(0, 0, 1))
	if err != nil {
		return nil, 0, err
	}
	byDay := make(map[string]int64, window.Days)
	for _, at := range stamps {
		byDay[model.ActivityDay(at)]++
	}
	return byDay, int64(len(stamps)), nil
}

// toUserItems 把仓储行转成接口项。
func (s *ActivityService) toUserItems(rows []repository.ActivityUserStatRow) []dto.ActivityUserItem {
	out := make([]dto.ActivityUserItem, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		item := dto.ActivityUserItem{
			UserID:       row.UserID,
			Username:     row.Username,
			Nickname:     row.Nickname,
			Channel:      row.Channel,
			ChannelLabel: model.ChannelLabel(row.Channel),
			Province:     row.Province,
			City:         row.City,
			CreatedAt:    row.CreatedAt,
			ActiveDays:   row.ActiveDays,
			Requests:     row.Requests,
			Features:     row.Features,
			LastIP:       activity.MaskIP(row.LastIP),
		}
		item.Region = model.GeoRegion{Province: row.Province, City: row.City}.Label()
		// 列表按天展示最近活跃：窗口内有数据就用窗口内最后一天，
		// 没有活跃（沉默用户）才回落到 users 表上的最近活跃时间。
		if at, ok := model.ParseActivityDay(row.LastDay); ok {
			item.LastActiveAt = &at
		} else if row.UserLastActiveAt != nil {
			at := *row.UserLastActiveAt
			item.LastActiveAt = &at
		}
		out = append(out, item)
	}
	return out
}

// normalizeChannelFilter 把渠道筛选值的几个别名归一化。
func normalizeChannelFilter(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "all":
		return model.ChannelUnknown
	case "unknown", "none":
		return model.ChannelUnknown
	case "direct", "self":
		return model.ChannelDirect
	default:
		return model.NormalizeChannel(raw)
	}
}

// notes 生成统计口径说明。地区相关的说明只在需要时追加。
func (s *ActivityService) notes(window dto.ActivityWindow, withRegion bool) []string {
	stats := s.recorder.Stats()
	flushSeconds := int(s.recorder.FlushInterval().Seconds())
	notes := []string{
		"活跃口径：登录用户在自然日内至少产生一次前台接口请求，或通过 POST /api/v1/events 上报过事件；匿名访问不计入。",
		"日期口径：东八区（UTC+8）自然日，窗口为最近 " + itoa(window.Days) + " 天（" + window.From + " ~ " + window.To + "，含首尾）。",
		"数据新鲜度：采集是异步批量落库的，最多滞后一个 flush 周期（当前 " + itoa(flushSeconds) + " 秒），最近一次落库时间见 freshness.last_flush_at。",
		"请求次数只统计前台接口，后台管理接口与健康检查不计入。",
	}
	if stats.DroppedHits > 0 {
		notes = append(notes, "注意：采集缓冲曾达到上限，已丢弃 "+itoa64(stats.DroppedHits)+
			" 次采样（通常意味着数据库写入异常，请查看 freshness.last_error）。")
	}
	if withRegion {
		if stats.GeoEnabled {
			notes = append(notes, "地区口径：IP 归属地由本地 ip2region 数据文件解析，取当天最后一次请求的 IP；未收录或解析不出的记为「未知」。")
		} else {
			note := "地区口径：当前无法解析 IP 归属地（" + stats.GeoDisabledNote + "），所有用户都会落在「未知」。"
			notes = append(notes, note)
		}
	}
	return notes
}

func (s *ActivityService) retentionNotes() []string {
	return []string{
		"留存口径：按注册日分组（注册当天为第 0 天），分母是该日全部新用户，分子是第 N 天有活跃记录的用户。",
		"只统计窗口内注册的队列；队列还没过完第 N 天时该列返回 eligible=false，前端应显示「—」而不是 0。",
		"加权平均留存按各队列人数加权，分母只包含已经过完第 N 天的队列。",
	}
}

func (s *ActivityService) channelNotes() []string {
	return []string{
		"渠道口径：用户注册时的首次来源（首触归因），之后不再改写；注册时没有带来源信息的历史用户记为「未知来源」。",
		"来源取值优先级：注册请求里的 channel → utm_source → 外部 Referer 域名；自己域名的 Referer 记为「直接访问」。",
		"活跃率 = 窗口内该渠道的活跃用户 / 该渠道累计注册用户，用来判断渠道带来的量是否真的留下来用了。",
		"付费人数与金额只包含 payment_status=paid 的订单，退款不在其中扣除（概览页有单独的退款口径）。",
	}
}

func percent(part, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return round2(float64(part) * 100 / float64(total))
}

func changePercent(current, previous int64) float64 {
	if previous == 0 {
		// 昨天没有活跃用户时环比没有意义：返回 0 而不是 +∞ 或 +100%，
		// 避免后台出现一个吓人的假增长。
		return 0
	}
	return round2(float64(current-previous) * 100 / float64(previous))
}

func dayDiff(from, to string) int {
	start, okStart := model.ParseActivityDay(from)
	end, okEnd := model.ParseActivityDay(to)
	if !okStart || !okEnd {
		return -1
	}
	return int(end.Sub(start).Hours() / 24)
}

func itoa(v int) string { return strconv.Itoa(v) }

func itoa64(v int64) string { return strconv.FormatInt(v, 10) }
