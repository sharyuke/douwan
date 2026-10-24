package service

import (
	"math"
	"testing"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// activityNow 固定「现在」为东八区 2026-10-15 14:00，
// 让「最近 N 天」的窗口边界在测试里完全确定。
var activityNow = time.Date(2026, 10, 15, 14, 0, 0, 0, model.ActivityLocation)

// activitySeed 是一套固定的活跃样本数据：
//
//	userA 10-13 注册(gitee)  活跃 10-13(3 次请求) 10-14(2 次)   广东深圳
//	userB 10-13 注册(weibo)  活跃 10-13(1 次)                   广东广州
//	userC 10-15 注册(未知)   活跃 10-15(5 次请求, 2 个功能)      浙江杭州
//	userD 10-10 注册(gitee)  没有任何活跃记录
type activitySeed struct {
	db    *gorm.DB
	repos *repository.Repositories
	svc   *ActivityService
	rec   *activity.Recorder
	ids   map[string]uint64
}

func newActivitySeed(t *testing.T) *activitySeed {
	t.Helper()
	db := testsupport.NewDB(t)
	repos := repository.New(db)
	rec := activity.NewRecorder(config.Activity{Enabled: true, BufferLimit: 100}, repos, nil)
	svc := NewActivityService(repos, rec)
	svc.now = func() time.Time { return activityNow }

	seed := &activitySeed{db: db, repos: repos, svc: svc, rec: rec, ids: map[string]uint64{}}
	seed.ids["userA"] = seed.user(t, "userA", "2026-10-13 09:00", model.NormalizeChannel("gitee"))
	seed.ids["userB"] = seed.user(t, "userB", "2026-10-13 20:00", model.NormalizeChannel("weibo"))
	seed.ids["userC"] = seed.user(t, "userC", "2026-10-15 08:00", model.ChannelUnknown)
	seed.ids["userD"] = seed.user(t, "userD", "2026-10-10 10:00", model.NormalizeChannel("gitee"))

	seed.daily(t, "userA", "2026-10-13", 3, 1, "广东省", "深圳市")
	seed.daily(t, "userA", "2026-10-14", 2, 1, "广东省", "深圳市")
	seed.daily(t, "userB", "2026-10-13", 1, 0, "广东省", "广州市")
	seed.daily(t, "userC", "2026-10-15", 5, 2, "浙江省", "杭州市")

	seed.feature(t, "userA", "2026-10-13", model.FeatureAccountLogin, model.ActivitySourceAPI, 3)
	seed.feature(t, "userA", "2026-10-14", model.FeatureOrderCreate, model.ActivitySourceAPI, 1)
	seed.feature(t, "userC", "2026-10-15", model.FeaturePatternMake, model.ActivitySourceClient, 2)
	seed.feature(t, "userC", "2026-10-15", model.FeatureAppOpen, model.ActivitySourceAPI, 2)
	return seed
}

func (s *activitySeed) id(name string) uint64 { return s.ids[name] }

// user 建一个用户，注册时间按东八区解析。
func (s *activitySeed) user(t *testing.T, name, createdAt, channel string) uint64 {
	t.Helper()
	at, err := time.ParseInLocation("2006-01-02 15:04", createdAt, model.ActivityLocation)
	if err != nil {
		t.Fatalf("解析注册时间: %v", err)
	}
	user := &model.User{
		Base:     model.Base{CreatedAt: at},
		Username: name, PasswordHash: "x", Nickname: name,
		Status: model.UserStatusActive, Channel: channel,
	}
	if err := s.repos.User.Create(t.Context(), user); err != nil {
		t.Fatalf("建用户 %s: %v", name, err)
	}
	return user.ID
}

// daily 写一条日活跃记录（走真实的 upsert 路径）。
func (s *activitySeed) daily(t *testing.T, user string, day string, requests, features int64, province, city string) {
	t.Helper()
	at, ok := model.ParseActivityDay(day)
	if !ok {
		t.Fatalf("解析日期: %s", day)
	}
	first := at.Add(10 * time.Hour)
	err := s.repos.Activity.UpsertDaily(t.Context(), []repository.ActivityDailyDelta{{
		UserID:        s.id(user),
		Day:           day,
		FirstActiveAt: first,
		LastActiveAt:  first.Add(time.Hour),
		RequestCount:  requests,
		FeatureCount:  features,
		IP:            "203.0.113.9",
		Region: model.GeoRegion{
			Country: "中国", Province: province, City: city, ISP: "电信",
			Raw: "中国|0|" + province + "|" + city + "|电信",
		},
	}})
	if err != nil {
		t.Fatalf("写日活跃 %s %s: %v", user, day, err)
	}
}

func (s *activitySeed) feature(t *testing.T, user, day, feature, source string, hits int64) {
	t.Helper()
	err := s.repos.Activity.UpsertFeatures(t.Context(), []repository.ActivityFeatureDelta{{
		UserID: s.id(user), Day: day, Feature: feature, Source: source, Count: hits,
	}})
	if err != nil {
		t.Fatalf("写功能统计 %s %s: %v", user, feature, err)
	}
}

func approx(t *testing.T, got, want float64, what string) {
	t.Helper()
	if math.Abs(got-want) > 0.02 {
		t.Fatalf("%s = %v，期望 %v", what, got, want)
	}
}

func TestActivityOverview(t *testing.T) {
	seed := newActivitySeed(t)

	out, err := seed.svc.Overview(t.Context(), 7)
	if err != nil {
		t.Fatalf("概览失败: %v", err)
	}
	if out.Window.From != "2026-10-09" || out.Window.To != "2026-10-15" || out.Window.Days != 7 {
		t.Fatalf("窗口不对: %+v", out.Window)
	}
	cards := out.Cards
	if cards.Day != "2026-10-15" {
		t.Fatalf("今天 = %s", cards.Day)
	}
	if cards.DAU != 1 || cards.DAUYesterday != 1 {
		t.Fatalf("DAU = %d，昨日 = %d，期望 1 / 1", cards.DAU, cards.DAUYesterday)
	}
	approx(t, cards.DAUChangePercent, 0, "DAU 环比")
	if cards.ActiveUsers != 3 {
		t.Fatalf("窗口内活跃用户 = %d，期望 3（去重）", cards.ActiveUsers)
	}
	if cards.NewUsers != 4 {
		t.Fatalf("窗口内新增 = %d，期望 4", cards.NewUsers)
	}
	if cards.WAU != 3 || cards.MAU != 3 {
		t.Fatalf("WAU/MAU = %d/%d，期望 3/3", cards.WAU, cards.MAU)
	}
	if cards.Requests != 11 || cards.Features != 4 {
		t.Fatalf("请求/功能 = %d/%d，期望 11/4", cards.Requests, cards.Features)
	}
	if cards.TotalUsers != 4 {
		t.Fatalf("累计用户 = %d，期望 4", cards.TotalUsers)
	}
	approx(t, cards.ActiveRate, 75, "月活占比")
	approx(t, cards.Stickiness, 33.33, "粘性 DAU/MAU")
	if cards.PeakDAU != 2 || cards.PeakDAUDay != "2026-10-13" {
		t.Fatalf("峰值 = %d @ %s，期望 2 @ 2026-10-13", cards.PeakDAU, cards.PeakDAUDay)
	}

	if len(out.Trend) != 7 {
		t.Fatalf("趋势点数 = %d，期望 7（缺的天要补零）", len(out.Trend))
	}
	want := []dto.ActivityTrend{
		{Day: "2026-10-09"},
		{Day: "2026-10-10", NewUsers: 1},
		{Day: "2026-10-11"},
		{Day: "2026-10-12"},
		{Day: "2026-10-13", ActiveUsers: 2, NewUsers: 2, Requests: 4, Features: 1},
		{Day: "2026-10-14", ActiveUsers: 1, Requests: 2, Features: 1},
		{Day: "2026-10-15", ActiveUsers: 1, NewUsers: 1, Requests: 5, Features: 2},
	}
	for i := range want {
		if out.Trend[i] != want[i] {
			t.Fatalf("趋势第 %d 天 = %+v，期望 %+v", i, out.Trend[i], want[i])
		}
	}

	if len(out.Notes) == 0 {
		t.Fatal("概览必须带上统计口径说明")
	}
	if out.Enabled != true {
		t.Fatal("采集开启时 enabled 应为 true")
	}
}

func TestActivityRetention(t *testing.T) {
	seed := newActivitySeed(t)

	out, err := seed.svc.Retention(t.Context(), 7)
	if err != nil {
		t.Fatalf("留存失败: %v", err)
	}
	if len(out.Cohorts) != 3 {
		t.Fatalf("队列数 = %d，期望 3（10-10 / 10-13 / 10-15）", len(out.Cohorts))
	}
	byDay := map[string]dto.ActivityRetentionRow{}
	for _, c := range out.Cohorts {
		byDay[c.Day] = c
	}

	// 10-15 注册的 cohort 还没过完第 1 天，只能报 eligible=false
	if c := byDay["2026-10-15"]; c.D1Eligible || c.D3Eligible || c.D7Eligible {
		t.Fatalf("当天注册的队列不该有留存结论: %+v", c)
	}
	// 10-13 注册的两个人里只有 userA 在 10-14 活跃过
	c13 := byDay["2026-10-13"]
	if c13.NewUsers != 2 || c13.D1Users != 1 || !c13.D1Eligible {
		t.Fatalf("10-13 队列不对: %+v", c13)
	}
	approx(t, c13.D1Rate, 50, "10-13 次日留存")
	if c13.D3Eligible || c13.D7Eligible {
		t.Fatalf("只过了 2 天，3 日 / 7 日留存不该有结论: %+v", c13)
	}
	// 10-10 注册的 userD 从未活跃：1 日与 3 日留存都是 0，7 日还没到
	c10 := byDay["2026-10-10"]
	if c10.NewUsers != 1 || c10.D1Users != 0 || !c10.D1Eligible || !c10.D3Eligible || c10.D7Eligible {
		t.Fatalf("10-10 队列不对: %+v", c10)
	}

	// 加权平均只统计已过完对应天数的队列：
	// 1 日留存 = (1 + 0) / (2 + 1) = 33.33%
	if out.Summary.CohortUsers != 3 || out.Summary.D1Users != 1 {
		t.Fatalf("汇总分母/分子 = %d/%d，期望 3/1", out.Summary.CohortUsers, out.Summary.D1Users)
	}
	approx(t, out.Summary.D1Rate, 33.33, "加权次日留存")
	approx(t, out.Summary.D3Rate, 0, "加权 3 日留存")
	if out.Summary.EligibleD1 != 2 || out.Summary.EligibleD3 != 1 || out.Summary.EligibleD7 != 0 {
		t.Fatalf("可用队列数不对: %+v", out.Summary)
	}
}

func TestActivityFrequency(t *testing.T) {
	seed := newActivitySeed(t)

	out, err := seed.svc.Frequency(t.Context(), 7)
	if err != nil {
		t.Fatalf("频率失败: %v", err)
	}
	if out.ActiveUsers != 3 {
		t.Fatalf("活跃用户 = %d，期望 3", out.ActiveUsers)
	}
	wantBuckets := map[string]int64{"仅 1 天": 2, "2~3 天": 1, "4~7 天": 0, "8~14 天": 0, "15 天以上": 0}
	for _, bucket := range out.Buckets {
		if want, ok := wantBuckets[bucket.Label]; ok && bucket.Users != want {
			t.Fatalf("分桶 %s = %d，期望 %d", bucket.Label, bucket.Users, want)
		}
	}
	approx(t, out.AvgActiveDays, 1.33, "人均活跃天数")
	approx(t, out.MedianActiveDays, 1, "活跃天数中位数")

	if len(out.TopUsers) != 3 {
		t.Fatalf("活跃榜 = %d 人，期望 3", len(out.TopUsers))
	}
	if out.TopUsers[0].Username != "userA" || out.TopUsers[0].ActiveDays != 2 {
		t.Fatalf("活跃榜第一不对: %+v", out.TopUsers[0])
	}
	if out.TopUsers[0].Region != "广东省 深圳市" {
		t.Fatalf("地区展示名不对: %s", out.TopUsers[0].Region)
	}
}

func TestActivityRegions(t *testing.T) {
	seed := newActivitySeed(t)

	out, err := seed.svc.Regions(t.Context(), 7, 10)
	if err != nil {
		t.Fatalf("地区失败: %v", err)
	}
	if out.ActiveUsers != 3 || out.UnknownUsers != 0 {
		t.Fatalf("活跃/未知 = %d/%d，期望 3/0", out.ActiveUsers, out.UnknownUsers)
	}
	if len(out.Provinces) != 2 || out.Provinces[0].Province != "广东省" || out.Provinces[0].Users != 2 {
		t.Fatalf("省份分布不对: %+v", out.Provinces)
	}
	approx(t, out.Provinces[0].Percent, 66.67, "广东省占比")
	if len(out.Cities) != 3 {
		t.Fatalf("城市分布 = %d 条，期望 3", len(out.Cities))
	}
	if len(out.ISPs) != 1 || out.ISPs[0].ISP != "电信" || out.ISPs[0].Users != 3 {
		t.Fatalf("运营商分布不对: %+v", out.ISPs)
	}
}

func TestActivityFeatures(t *testing.T) {
	seed := newActivitySeed(t)

	out, err := seed.svc.Features(t.Context(), 7, 30)
	if err != nil {
		t.Fatalf("功能失败: %v", err)
	}
	if len(out.Items) != 4 {
		t.Fatalf("功能行数 = %d，期望 4", len(out.Items))
	}
	found := map[string]dto.ActivityFeatureItem{}
	for _, item := range out.Items {
		found[item.Feature+"/"+item.Source] = item
	}
	login, ok := found[model.FeatureAccountLogin+"/"+model.ActivitySourceAPI]
	if !ok || login.Count != 3 || login.Users != 1 {
		t.Fatalf("登录统计不对: %+v", login)
	}
	if login.FeatureLabel != "登录" || login.SourceLabel != "接口统计" {
		t.Fatalf("功能中文名不对: %+v", login)
	}
	make, ok := found[model.FeaturePatternMake+"/"+model.ActivitySourceClient]
	if !ok || make.Count != 2 || make.FeatureLabel != "生成图纸" || make.SourceLabel != "客户端上报" {
		t.Fatalf("客户端上报统计不对: %+v", make)
	}
	approx(t, make.Percent, 25, "生成图纸占比")
}

func TestActivityChannels(t *testing.T) {
	seed := newActivitySeed(t)

	out, err := seed.svc.Channels(t.Context(), 7)
	if err != nil {
		t.Fatalf("渠道失败: %v", err)
	}
	if out.TotalNewUsers != 4 {
		t.Fatalf("窗口内新增 = %d，期望 4", out.TotalNewUsers)
	}
	items := map[string]dto.ActivityChannelItem{}
	for _, item := range out.Items {
		items[item.Channel] = item
	}
	gitee := items[model.NormalizeChannel("gitee")]
	if gitee.TotalUsers != 2 || gitee.NewUsers != 2 || gitee.ActiveUsers != 1 {
		t.Fatalf("gitee 渠道统计不对: %+v", gitee)
	}
	approx(t, gitee.ActiveRate, 50, "gitee 活跃率")
	if gitee.ChannelLabel != "gitee" {
		t.Fatalf("渠道名不该被改写: %s", gitee.ChannelLabel)
	}
	weibo := items[model.NormalizeChannel("weibo")]
	if weibo.TotalUsers != 1 || weibo.ActiveUsers != 1 {
		t.Fatalf("weibo 渠道统计不对: %+v", weibo)
	}
	unknown := items[model.ChannelUnknown]
	if unknown.ChannelLabel != "未知来源" || unknown.ActiveUsers != 1 {
		t.Fatalf("未知来源统计不对: %+v", unknown)
	}
	// 没有任何渠道数据的渠道也要出现（total 为 0 的渠道不该凭空出现）
	for _, item := range out.Items {
		if item.TotalUsers == 0 && item.NewUsers == 0 {
			t.Fatalf("不该出现完全没有用户的渠道: %+v", item)
		}
	}
}

func TestActivityUsers(t *testing.T) {
	seed := newActivitySeed(t)
	ctx := t.Context()

	// 只看活跃用户
	page, err := seed.svc.Users(ctx, dto.ActivityUserListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10}, Days: 7, MinActiveDays: 1,
	})
	if err != nil {
		t.Fatalf("列表失败: %v", err)
	}
	if page.Total != 3 || len(page.List) != 3 {
		t.Fatalf("活跃用户数 = %d/%d，期望 3", page.Total, len(page.List))
	}
	first := page.List[0]
	if first.Username != "userA" || first.ActiveDays != 2 || first.Requests != 5 {
		t.Fatalf("排序或统计不对: %+v", first)
	}
	if first.LastIP != "203.0.113.*" {
		t.Fatalf("IP 必须脱敏: %s", first.LastIP)
	}
	if first.LastActiveAt == nil || model.ActivityDay(*first.LastActiveAt) != "2026-10-14" {
		t.Fatalf("最近活跃时间不对: %+v", first.LastActiveAt)
	}

	// 不筛 min_active_days 时，沉默用户也要能看到（活跃天数为 0）
	all, err := seed.svc.Users(ctx, dto.ActivityUserListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10}, Days: 7,
	})
	if err != nil {
		t.Fatalf("列表失败: %v", err)
	}
	if all.Total != 4 {
		t.Fatalf("含沉默用户的总数 = %d，期望 4", all.Total)
	}
	silent := all.List[len(all.List)-1]
	if silent.Username != "userD" || silent.ActiveDays != 0 {
		t.Fatalf("沉默用户不该被漏掉: %+v", silent)
	}

	// 渠道筛选（未知来源要用空串表达）
	byChannel, err := seed.svc.Users(ctx, dto.ActivityUserListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10}, Days: 7,
		HasChannel: true, Channel: model.ChannelUnknown,
	})
	if err != nil {
		t.Fatalf("渠道筛选失败: %v", err)
	}
	if byChannel.Total != 1 || byChannel.List[0].Username != "userC" {
		t.Fatalf("未知来源筛选不对: %+v", byChannel)
	}

	// 地区筛选
	byRegion, err := seed.svc.Users(ctx, dto.ActivityUserListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10}, Days: 7, Province: "广东省",
	})
	if err != nil {
		t.Fatalf("地区筛选失败: %v", err)
	}
	if byRegion.Total != 2 {
		t.Fatalf("广东省用户 = %d，期望 2（userA/userB）", byRegion.Total)
	}
}

func TestActivityUserDetail(t *testing.T) {
	seed := newActivitySeed(t)

	out, err := seed.svc.UserDetail(t.Context(), seed.id("userA"), 30)
	if err != nil {
		t.Fatalf("详情失败: %v", err)
	}
	if out.User.Username != "userA" || out.TotalActiveDay != 2 || out.TotalRequests != 5 {
		t.Fatalf("累计统计不对: %+v", out)
	}
	if out.FirstActiveDay != "2026-10-13" || out.LastActiveDay != "2026-10-14" {
		t.Fatalf("首末活跃日不对: %s ~ %s", out.FirstActiveDay, out.LastActiveDay)
	}
	if len(out.Daily) != 2 {
		t.Fatalf("逐日明细 = %d 条，期望 2", len(out.Daily))
	}
	if out.Daily[0].IP != "203.0.113.*" {
		t.Fatalf("明细里的 IP 也要脱敏: %s", out.Daily[0].IP)
	}
	if len(out.Features) != 2 {
		t.Fatalf("功能明细 = %d 条，期望 2（登录 + 下单）", len(out.Features))
	}
	if len(out.Regions) != 1 || out.Regions[0].Province != "广东省" {
		t.Fatalf("地区明细不对: %+v", out.Regions)
	}

	// 窗口内没有活跃记录的用户也要能打开详情
	silent, err := seed.svc.UserDetail(t.Context(), seed.id("userD"), 7)
	if err != nil {
		t.Fatalf("沉默用户详情失败: %v", err)
	}
	if silent.User.Username != "userD" || silent.User.ActiveDays != 0 || len(silent.Daily) != 0 {
		t.Fatalf("沉默用户详情不对: %+v", silent)
	}

	// 不存在的用户要报业务错误
	if _, err := seed.svc.UserDetail(t.Context(), 999999, 7); err == nil {
		t.Fatal("不存在的用户应该报错")
	}
}

func TestActivityIngestEvents(t *testing.T) {
	seed := newActivitySeed(t)
	ctx := t.Context()
	userID := seed.id("userA")

	// 客户端能上报的功能点
	out, err := seed.svc.IngestEvents(ctx, userID, dto.EventBatchRequest{Events: []dto.EventItem{
		{Feature: model.FeaturePatternExport, Count: 2},
		{Feature: model.FeaturePatternMatte},
	}}, "203.0.113.9")
	if err != nil {
		t.Fatalf("上报失败: %v", err)
	}
	if !out.Enabled || out.Accepted != 2 || out.Hits != 3 {
		t.Fatalf("上报结果不对: %+v", out)
	}
	pending := seed.rec.PendingFeatures()
	if pending[model.FeaturePatternExport+"/"+model.ActivitySourceClient] != 2 {
		t.Fatalf("导出次数没进缓冲: %v", pending)
	}
	if pending[model.FeaturePatternMatte+"/"+model.ActivitySourceClient] != 1 {
		t.Fatalf("缺省次数应为 1: %v", pending)
	}

	// 服务端自己统计的功能点不接受上报
	partial, err := seed.svc.IngestEvents(ctx, userID, dto.EventBatchRequest{Events: []dto.EventItem{
		{Feature: model.FeaturePatternSave},
		{Feature: model.FeatureAccountLogin},
	}}, "")
	if err != nil {
		t.Fatalf("部分被拒时不应整体失败: %v", err)
	}
	if partial.Accepted != 1 || len(partial.Rejected) != 1 {
		t.Fatalf("部分被拒的结果不对: %+v", partial)
	}

	// 全部被拒时报业务错误，方便前端在联调阶段立刻发现问题
	_, err = seed.svc.IngestEvents(ctx, userID, dto.EventBatchRequest{Events: []dto.EventItem{
		{Feature: "not.a.feature"},
	}}, "")
	if err == nil {
		t.Fatal("全部被拒时应该报错")
	}
	if apiErr, ok := err.(*response.Error); !ok || apiErr.Code != response.CodeEventFeatureUnknown {
		t.Fatalf("错误码不对: %v", err)
	}
}

func TestActivityIngestEventsClampsTimestamp(t *testing.T) {
	seed := newActivitySeed(t)
	ctx := t.Context()

	future := activityNow.Add(48 * time.Hour)
	if _, err := seed.svc.IngestEvents(ctx, seed.id("userA"), dto.EventBatchRequest{Events: []dto.EventItem{
		{Feature: model.FeaturePatternExport, At: &future},
	}}, ""); err != nil {
		t.Fatalf("上报失败: %v", err)
	}
	// 未来时间会被收敛到「今天」，不会污染明天的数据
	var rows []model.UserFeatureDaily
	if err := seed.db.Where("user_id = ? AND feature = ?", seed.id("userA"), model.FeaturePatternExport).
		Find(&rows).Error; err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("还没落库，不该有数据: %+v", rows)
	}
	if err := seed.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}
	if err := seed.db.Where("user_id = ? AND feature = ?", seed.id("userA"), model.FeaturePatternExport).
		Find(&rows).Error; err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if len(rows) != 1 || rows[0].Day != "2026-10-15" {
		t.Fatalf("未来时间戳应该被收敛到今天: %+v", rows)
	}
}

func TestActivityDisabledStillReturnsData(t *testing.T) {
	seed := newActivitySeed(t)
	seed.svc = NewActivityService(seed.repos, nil) // 采集关闭
	seed.svc.now = func() time.Time { return activityNow }

	out, err := seed.svc.Overview(t.Context(), 7)
	if err != nil {
		t.Fatalf("概览失败: %v", err)
	}
	if out.Enabled {
		t.Fatal("采集关闭时 enabled 应为 false")
	}
	// 已落库的数据仍然照常统计：关掉采集不等于把历史数据藏起来
	if out.Cards.ActiveUsers != 3 {
		t.Fatalf("历史数据仍应统计: %+v", out.Cards)
	}
	res, err := seed.svc.IngestEvents(t.Context(), seed.id("userA"), dto.EventBatchRequest{Events: []dto.EventItem{
		{Feature: model.FeaturePatternExport},
	}}, "")
	if err != nil {
		t.Fatalf("采集关闭时上报不该报错: %v", err)
	}
	if res.Enabled || res.Accepted != 0 || res.Message == "" {
		t.Fatalf("采集关闭时应明确告知: %+v", res)
	}
}

func TestActivityWindowClamped(t *testing.T) {
	if w := dto.NewActivityWindow(0, dto.DefaultActivityDays, dto.MaxActivityDays, activityNow); w.Days != dto.DefaultActivityDays {
		t.Fatalf("缺省窗口 = %d，期望 %d", w.Days, dto.DefaultActivityDays)
	}
	if w := dto.NewActivityWindow(999, dto.DefaultActivityDays, dto.MaxActivityDays, activityNow); w.Days != dto.MaxActivityDays {
		t.Fatalf("超限窗口应被收敛到 %d，实际 %d", dto.MaxActivityDays, w.Days)
	}
	w := dto.NewActivityWindow(1, dto.DefaultActivityDays, dto.MaxActivityDays, activityNow)
	if w.From != "2026-10-15" || w.To != "2026-10-15" {
		t.Fatalf("单日窗口不对: %+v", w)
	}
	if days := w.DayList(); len(days) != 1 || days[0] != "2026-10-15" {
		t.Fatalf("单日窗口的天列表不对: %v", days)
	}
}

func TestResolveAcquisition(t *testing.T) {
	cases := []struct {
		name                    string
		channel, utm, referrer  string
		siteHost                string
		wantChannel, wantDetail string
	}{
		{name: "channel 优先级最高", channel: "Gitee ", utm: "weibo", referrer: "https://x.com/a", wantChannel: "gitee", wantDetail: "Gitee"},
		{name: "没有 channel 时用 utm_source", utm: "weibo", wantChannel: "weibo", wantDetail: "weibo"},
		{name: "外部 referrer 取域名", referrer: "https://tieba.baidu.com/p/123", siteHost: "dw.sharyuke.com", wantChannel: "tieba.baidu.com", wantDetail: "https://tieba.baidu.com/p/123"},
		{name: "站内 referrer 记为直接访问", referrer: "https://dw.sharyuke.com/#/account", siteHost: "dw.sharyuke.com", wantChannel: model.ChannelDirect, wantDetail: "https://dw.sharyuke.com/#/account"},
		{name: "带了端口的站内 referrer 也算直接访问", referrer: "http://dw.sharyuke.com:8080/a", siteHost: "dw.sharyuke.com:8080", wantChannel: model.ChannelDirect, wantDetail: "http://dw.sharyuke.com:8080/a"},
		{name: "什么都没有就是未知来源", wantChannel: "", wantDetail: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveAcquisition(tc.channel, tc.utm, tc.referrer, tc.siteHost)
			if got.Channel != tc.wantChannel {
				t.Fatalf("渠道 = %q，期望 %q", got.Channel, tc.wantChannel)
			}
			if got.Detail != tc.wantDetail {
				t.Fatalf("原始值 = %q，期望 %q", got.Detail, tc.wantDetail)
			}
		})
	}
}

func TestNormalizeChannelKeepsCustomNames(t *testing.T) {
	if got := model.NormalizeChannel("WeChat-Group"); got != "wechat-group" {
		t.Fatalf("自定义渠道名不该被丢弃: %q", got)
	}
	if got := model.NormalizeChannel("https://gitee.com/maryuke/pindoudou"); got != "gitee.com" {
		t.Fatalf("URL 应取域名: %q", got)
	}
	if got := model.NormalizeChannel("  "); got != model.ChannelUnknown {
		t.Fatalf("空白应视为未知来源: %q", got)
	}
}
