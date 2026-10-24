package service

import (
	"strings"
	"testing"
	"time"

	"gitee.com/maryuke/douwan-api/internal/activity"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// 四个固定访客标识（E 只在「新访客上报」用例里用）。
var (
	visitA = strings.Repeat("a", 32)
	visitB = strings.Repeat("b", 32)
	visitC = strings.Repeat("c", 32)
	visitD = strings.Repeat("d", 32)
	visitE = strings.Repeat("e", 32)
)

// visitSeed 是一套固定的访问量样本（窗口固定为 2026-10-09 ~ 2026-10-15）：
//
//	访客A 登录用户 userA(未知来源)      10-13 首页 3 次、10-14 编辑器 2 次
//	访客B 匿名(渠道 gitee)            10-13 素材详情 5 次、10-15 首页 1 次
//	访客C 匿名(渠道 direct)           10-15 首页 2 次
//	访客D 匿名(渠道 gitee)            09-20 首页 9 次（窗口外，只计入累计）
type visitSeed struct {
	repos    *repository.Repositories
	svc      *ActivityService
	rec      *activity.Recorder
	userA    uint64
	visitors map[string]string
}

func newVisitSeed(t *testing.T) *visitSeed {
	t.Helper()
	db := testsupport.NewDB(t)
	repos := repository.New(db)
	rec := activity.NewRecorder(config.Activity{Enabled: true, BufferLimit: 100}, repos, nil)
	svc := NewActivityService(repos, rec)
	svc.now = func() time.Time { return activityNow }

	user := &model.User{
		Username: "visitUserA", PasswordHash: "x", Nickname: "visitUserA",
		Status: model.UserStatusActive, Channel: model.NormalizeChannel("gitee"),
	}
	if err := repos.User.Create(t.Context(), user); err != nil {
		t.Fatalf("建用户失败: %v", err)
	}

	seed := &visitSeed{
		repos: repos, svc: svc, rec: rec, userA: user.ID,
		visitors: map[string]string{"A": visitA, "B": visitB, "C": visitC, "D": visitD},
	}
	seed.page(t, visitA, "2026-10-13", "/", 3, user.ID, "", "广东省", "深圳市")
	seed.page(t, visitA, "2026-10-14", "/editor", 2, user.ID, "", "广东省", "深圳市")
	seed.page(t, visitB, "2026-10-13", "/library/:slug", 5, 0, "gitee", "浙江省", "杭州市")
	seed.page(t, visitB, "2026-10-15", "/", 1, 0, "gitee", "浙江省", "杭州市")
	seed.page(t, visitC, "2026-10-15", "/", 2, 0, "direct", "北京市", "北京市")
	seed.page(t, visitD, "2026-09-20", "/", 9, 0, "gitee", "广东省", "广州市")
	return seed
}

// page 走真实的仓储 upsert 路径写入一条访问记录。
func (s *visitSeed) page(t *testing.T, visitor, day, path string, pv int64, userID uint64, channel, province, city string) {
	t.Helper()
	at, ok := model.ParseActivityDay(day)
	if !ok {
		t.Fatalf("解析日期: %s", day)
	}
	first := at.Add(10 * time.Hour)
	err := s.repos.Visit.UpsertVisitorPages(t.Context(), []repository.VisitPageDelta{{
		Visitor: visitor, Day: day, Path: path, PV: pv, UserID: userID,
		FirstAt: first, LastAt: first.Add(time.Hour),
	}})
	if err != nil {
		t.Fatalf("写访问明细失败: %v", err)
	}
	err = s.repos.Visit.UpsertVisitors(t.Context(), []repository.VisitVisitorDelta{{
		Visitor: visitor, UserID: userID,
		FirstSeenAt: first, LastSeenAt: first.Add(time.Hour),
		FirstDay: day, LastDay: day,
		PageViews: pv, FirstPath: path, LastPath: path,
		Channel: channel, IP: "203.0.113.9",
		Region: model.GeoRegion{Country: "中国", Province: province, City: city, ISP: "电信", Raw: "中国|0|" + province + "|" + city + "|电信"},
	}})
	if err != nil {
		t.Fatalf("写访客档案失败: %v", err)
	}
}

// keepFirstDay 把访客的首次访问日改到窗口之前（模拟「老访客又回来了」）。
func (s *visitSeed) keepFirstDay(t *testing.T, visitor, firstDay string) {
	t.Helper()
	at, ok := model.ParseActivityDay(firstDay)
	if !ok {
		t.Fatalf("解析日期: %s", firstDay)
	}
	if err := s.repos.Visit.UpsertVisitors(t.Context(), []repository.VisitVisitorDelta{{
		Visitor: visitor, FirstDay: firstDay, LastDay: firstDay,
		FirstSeenAt: at, LastSeenAt: at,
		Channel: "gitee", FirstPath: "/", LastPath: "/",
	}}); err != nil {
		t.Fatalf("修正访客首末日期失败: %v", err)
	}
}

func TestTrafficCardsAndTrend(t *testing.T) {
	seed := newVisitSeed(t)

	out, err := seed.svc.Traffic(t.Context(), 7, 15)
	if err != nil {
		t.Fatalf("访问量加载失败: %v", err)
	}
	if out.Window.From != "2026-10-09" || out.Window.To != "2026-10-15" {
		t.Fatalf("窗口不对: %+v", out.Window)
	}
	if len(out.Trend) != 7 {
		t.Fatalf("趋势必须有连续 7 天，实际 %d 天", len(out.Trend))
	}
	// 逐日：10-13 两个访客 8 次；10-14 一个访客 2 次；10-15 两个访客 3 次
	byDay := map[string]dto.ActivityTrafficTrend{}
	for _, point := range out.Trend {
		byDay[point.Day] = point
	}
	if got := byDay["2026-10-13"]; got.PV != 8 || got.UV != 2 || got.NewVisitors != 2 {
		t.Fatalf("10-13 趋势不对: %+v", got)
	}
	if got := byDay["2026-10-14"]; got.PV != 2 || got.UV != 1 || got.NewVisitors != 0 {
		t.Fatalf("10-14 趋势不对: %+v", got)
	}
	if got := byDay["2026-10-15"]; got.PV != 3 || got.UV != 2 || got.NewVisitors != 1 {
		t.Fatalf("10-15 趋势不对: %+v", got)
	}
	if got := byDay["2026-10-10"]; got.PV != 0 || got.UV != 0 {
		t.Fatalf("没有数据的天应该补 0: %+v", got)
	}

	cards := out.Cards
	if cards.PV != 13 || cards.UV != 3 {
		t.Fatalf("窗口 PV/UV = %d/%d，期望 13/3", cards.PV, cards.UV)
	}
	if cards.NewVisitors != 3 || cards.ReturningVisitors != 0 {
		t.Fatalf("新老访客 = %d/%d，期望 3/0", cards.NewVisitors, cards.ReturningVisitors)
	}
	if cards.LoggedVisitors != 1 || cards.AnonymousVisitors != 2 {
		t.Fatalf("登录/匿名访客 = %d/%d，期望 1/2", cards.LoggedVisitors, cards.AnonymousVisitors)
	}
	if cards.TodayPV != 3 || cards.TodayUV != 2 || cards.TodayNew != 1 {
		t.Fatalf("今日指标不对: %+v", cards)
	}
	if cards.YesterdayPV != 2 {
		t.Fatalf("昨日 PV = %d，期望 2", cards.YesterdayPV)
	}
	approx(t, cards.PVChangePercent, 50, "今日 PV 环比")
	approx(t, cards.PVPerUV, 13.0/3, "人均访问量")
	approx(t, cards.AvgDailyPV, 13.0/7, "日均 PV")
	approx(t, cards.AvgDailyUV, 5.0/7, "日均 UV")
	if cards.PeakUV != 2 || cards.PeakUVDay != "2026-10-13" {
		t.Fatalf("峰值 UV 不对: %+v", cards)
	}
	// 累计包含窗口外的历史访客 D
	if cards.TotalVisitors != 4 || cards.TotalPV != 22 {
		t.Fatalf("累计访客/访问量 = %d/%d，期望 4/22", cards.TotalVisitors, cards.TotalPV)
	}
}

func TestTrafficPagesLandingsSources(t *testing.T) {
	seed := newVisitSeed(t)

	out, err := seed.svc.Traffic(t.Context(), 7, 15)
	if err != nil {
		t.Fatalf("访问量加载失败: %v", err)
	}
	if len(out.Pages) != 3 {
		t.Fatalf("页面排行应有 3 行，实际 %d: %+v", len(out.Pages), out.Pages)
	}
	// 按 PV 降序：/ 6 次、/library/:slug 5 次、/editor 2 次
	home := out.Pages[0]
	if home.Path != "/" || home.PV != 6 || home.Visitors != 3 {
		t.Fatalf("首页排行不对: %+v", home)
	}
	approx(t, home.PVPerVisitor, 2, "首页人均访问")
	approx(t, home.Percent, 6*100.0/13, "首页 PV 占比")
	if out.Pages[1].Path != "/library/:slug" || out.Pages[1].PV != 5 {
		t.Fatalf("素材详情排行不对: %+v", out.Pages[1])
	}
	if out.Pages[2].Path != "/editor" || out.Pages[2].PV != 2 {
		t.Fatalf("编辑器排行不对: %+v", out.Pages[2])
	}

	// 落地页：三个新访客分别落在 / 两次、/library/:slug 一次
	if len(out.Landings) != 2 {
		t.Fatalf("落地页应有 2 行，实际 %d: %+v", len(out.Landings), out.Landings)
	}
	landing := map[string]int64{}
	for _, item := range out.Landings {
		landing[item.Path] = item.Visitors
	}
	if landing["/"] != 2 || landing["/library/:slug"] != 1 {
		t.Fatalf("落地页分布不对: %+v", landing)
	}

	// 来源：按访客数降序，并列时按 PV 降序 → gitee (6) / 未知 (5) / direct (2)
	if len(out.Sources) != 3 {
		t.Fatalf("来源应有 3 行，实际 %d: %+v", len(out.Sources), out.Sources)
	}
	gitee := out.Sources[0]
	if gitee.Channel != "gitee" || gitee.Visitors != 1 || gitee.PV != 6 || gitee.ChannelLabel != "gitee" {
		t.Fatalf("gitee 来源不对: %+v", gitee)
	}
	if out.Sources[1].Channel != model.ChannelUnknown || out.Sources[1].ChannelLabel != "未知来源" {
		t.Fatalf("未知来源应单独成行: %+v", out.Sources[1])
	}
	if out.Sources[2].Channel != model.ChannelDirect || out.Sources[2].ChannelLabel != "直接访问" {
		t.Fatalf("直接访问应单独成行: %+v", out.Sources[2])
	}
	// 来源份额按访客算：每个渠道各 1 个访客，占窗口 UV 的 1/3
	approx(t, gitee.Percent, 100.0/3, "gitee 访客占比")
}

func TestTrafficPagesLimit(t *testing.T) {
	seed := newVisitSeed(t)
	out, err := seed.svc.Traffic(t.Context(), 7, 1)
	if err != nil {
		t.Fatalf("访问量加载失败: %v", err)
	}
	if len(out.Pages) != 1 || out.Pages[0].Path != "/" {
		t.Fatalf("limit=1 应只返回访问量最高的页面: %+v", out.Pages)
	}
}

func TestTrafficReturnsVisitors(t *testing.T) {
	seed := newVisitSeed(t)
	// 让访客 A 的首次访问落在窗口之前，验证「回访访客」的口径
	seed.keepFirstDay(t, visitA, "2026-10-01")

	out, err := seed.svc.Traffic(t.Context(), 7, 15)
	if err != nil {
		t.Fatalf("访问量加载失败: %v", err)
	}
	if out.Cards.NewVisitors != 2 || out.Cards.ReturningVisitors != 1 {
		t.Fatalf("新老访客口径不对: %+v", out.Cards)
	}
	// 新访客只剩 B、C 两个：落地页里不该再出现 A（A 落在 / 且已在窗口前首访）
	landingTotal := int64(0)
	for _, item := range out.Landings {
		landingTotal += item.Visitors
	}
	if landingTotal != 2 {
		t.Fatalf("落地页总数 = %d，期望 2", landingTotal)
	}
}

func TestTrafficVisitorList(t *testing.T) {
	seed := newVisitSeed(t)

	res, err := seed.svc.TrafficVisitors(t.Context(), dto.ActivityVisitorListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10},
		Days:      7,
	})
	if err != nil {
		t.Fatalf("访客列表失败: %v", err)
	}
	if res.Total != 3 {
		t.Fatalf("窗口内访客数 = %d，期望 3（窗口外的 D 不算）", res.Total)
	}
	if len(res.List) != 3 {
		t.Fatalf("列表行数 = %d，期望 3", len(res.List))
	}
	// 默认按累计访问量降序：B(6) > A(5) > C(2)
	if first := res.List[0]; first.Visitor != model.MaskVisitor(visitB) || first.PageViews != 6 || !first.Anonymous {
		t.Fatalf("列表首行不对: %+v", first)
	}
	if got := res.List[1]; got.Username != "visitUserA" || got.Anonymous || got.Channel != model.ChannelUnknown {
		t.Fatalf("登录访客行不对: %+v", got)
	}
	if got := res.List[1]; got.Region != "广东省 深圳市" || got.IP == "" {
		t.Fatalf("访客地区/脱敏 IP 不对: %+v", got)
	}

	// 只看访问过首页的访客：A、B、C 都访问过首页
	byPage, err := seed.svc.TrafficVisitors(t.Context(), dto.ActivityVisitorListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10},
		Days:      7,
		Path:      "/",
	})
	if err != nil {
		t.Fatalf("按页面筛选访客失败: %v", err)
	}
	if byPage.Total != 3 {
		t.Fatalf("访问过首页的访客 = %d，期望 3", byPage.Total)
	}

	// 只看访问过编辑器的访客：只有 A
	byEditor, err := seed.svc.TrafficVisitors(t.Context(), dto.ActivityVisitorListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 10},
		Days:      7,
		Path:      "/editor",
	})
	if err != nil {
		t.Fatalf("按页面筛选访客失败: %v", err)
	}
	if byEditor.Total != 1 || byEditor.List[0].Visitor != model.MaskVisitor(visitA) {
		t.Fatalf("编辑器访客筛选不对: %+v", byEditor)
	}

	// 按渠道筛选：direct 只有 C
	byChannel, err := seed.svc.TrafficVisitors(t.Context(), dto.ActivityVisitorListQuery{
		PageQuery:  dto.PageQuery{Page: 1, PageSize: 10},
		Days:       7,
		Channel:    model.ChannelDirect,
		HasChannel: true,
	})
	if err != nil {
		t.Fatalf("按渠道筛选访客失败: %v", err)
	}
	if byChannel.Total != 1 || byChannel.List[0].Visitor != model.MaskVisitor(visitC) {
		t.Fatalf("渠道筛选不对: %+v", byChannel)
	}

	// 分页：每页 2 条，第二页只剩 1 条
	paged, err := seed.svc.TrafficVisitors(t.Context(), dto.ActivityVisitorListQuery{
		PageQuery: dto.PageQuery{Page: 2, PageSize: 2},
		Days:      7,
	})
	if err != nil {
		t.Fatalf("分页失败: %v", err)
	}
	if paged.Total != 3 || len(paged.List) != 1 || paged.Page != 2 {
		t.Fatalf("分页结果不对: %+v", paged)
	}
}

func TestIngestVisitGeneratesVisitorAndClampsTime(t *testing.T) {
	seed := newVisitSeed(t)

	// 客户端没带 visitor：服务端生成一个并回传，否则每次访问都会被算成新访客
	res, err := seed.svc.IngestVisit(t.Context(), dto.VisitReportRequest{Path: "/editor?tab=ai#x"},
		0, "203.0.113.20", "https://tieba.baidu.com/p/1", "dw.sharyuke.com")
	if err != nil {
		t.Fatalf("上报失败: %v", err)
	}
	if !res.Accepted || !model.IsVisitorID(res.Visitor) {
		t.Fatalf("上报结果不对: %+v", res)
	}
	if res.Path != "/editor" {
		t.Fatalf("路径应该被归一化: %+v", res)
	}

	pv, visitors := seed.rec.PendingVisits()
	if pv != 1 || visitors != 1 {
		t.Fatalf("缓冲 = %d/%d，期望 1/1", pv, visitors)
	}

	// 同一个访客在同一个页面反复上报：只算一次
	again, err := seed.svc.IngestVisit(t.Context(), dto.VisitReportRequest{Visitor: res.Visitor, Path: "/editor"},
		0, "203.0.113.20", "", "dw.sharyuke.com")
	if err != nil {
		t.Fatalf("上报失败: %v", err)
	}
	if again.Accepted {
		t.Fatal("2 秒内的重复上报不该被计入")
	}
	if again.Message == "" {
		t.Fatal("没计入时必须给出原因，不能静默丢弃")
	}

	// 客户端标识被写坏（旧版本 / localStorage 脏数据）：换一个新标识继续算，
	// 而不是把这次上报整条丢掉
	broken, err := seed.svc.IngestVisit(t.Context(), dto.VisitReportRequest{Visitor: "ZZZ", Path: "/pricing"},
		0, "203.0.113.22", "", "dw.sharyuke.com")
	if err != nil {
		t.Fatalf("上报失败: %v", err)
	}
	if !broken.Accepted || broken.Visitor == "ZZZ" || !model.IsVisitorID(broken.Visitor) {
		t.Fatalf("坏标识应该被换成新的合法标识: %+v", broken)
	}

	// 太旧的时间戳按当前时间算（不许污染历史趋势）
	old := activityNow.AddDate(0, 0, -3)
	stale, err := seed.svc.IngestVisit(t.Context(), dto.VisitReportRequest{
		Visitor: visitA, Path: "/", At: &old,
	}, 0, "203.0.113.21", "", "dw.sharyuke.com")
	if err != nil {
		t.Fatalf("上报失败: %v", err)
	}
	if !stale.Accepted {
		t.Fatalf("过期时间戳不该让上报失败（应收敛到当前时间）: %+v", stale)
	}
	if err := seed.rec.Flush(t.Context()); err != nil {
		t.Fatalf("落库失败: %v", err)
	}
	trend, err := seed.repos.Visit.DailyTraffic(t.Context(), "2026-10-15", "2026-10-15")
	if err != nil {
		t.Fatalf("读趋势失败: %v", err)
	}
	if len(trend) != 1 {
		t.Fatalf("今天应该有访问明细: %+v", trend)
	}
	// 三天前的旧时间戳不许在历史日期上凭空造出一行
	past, err := seed.repos.Visit.DailyTraffic(t.Context(), "2026-10-12", "2026-10-12")
	if err != nil {
		t.Fatalf("读历史趋势失败: %v", err)
	}
	if len(past) != 0 {
		t.Fatalf("过期时间戳不该落到历史日期: %+v", past)
	}
}

func TestIngestVisitAnonymousChannelAndDisabled(t *testing.T) {
	seed := newVisitSeed(t)

	// 全新访客：站内 Referer 会被记为直接访问，但显式 channel 优先级更高
	res, err := seed.svc.IngestVisit(t.Context(), dto.VisitReportRequest{
		Visitor: visitE, Path: "/pricing", Channel: "WeChat-Group",
	}, 0, "203.0.113.30", "https://dw.sharyuke.com/#/", "dw.sharyuke.com")
	if err != nil || !res.Accepted {
		t.Fatalf("上报失败: %+v %v", res, err)
	}
	if err := seed.rec.Flush(t.Context()); err != nil {
		t.Fatalf("落库失败: %v", err)
	}
	list, err := seed.svc.TrafficVisitors(t.Context(), dto.ActivityVisitorListQuery{
		PageQuery: dto.PageQuery{Page: 1, PageSize: 20}, Days: 7,
	})
	if err != nil {
		t.Fatalf("访客列表失败: %v", err)
	}
	found := false
	for _, item := range list.List {
		if item.Visitor == model.MaskVisitor(visitE) {
			found = true
			if item.Channel != "wechat-group" {
				t.Fatalf("显式 channel 应该优先于 Referer: %+v", item)
			}
			if !item.Anonymous || item.Username != "" {
				t.Fatalf("匿名访客不该有用户名: %+v", item)
			}
		}
	}
	if !found {
		t.Fatalf("上报的访客没进列表: %+v", list.List)
	}

	// 采集关闭：明确告知没计入，而不是假装成功。
	// 注意不能在这里再 newVisitSeed：测试库是按 t.Name() 命名的，
	// 第二次调用拿到的是同一个库（重复建用户会直接报唯一键冲突）。
	offRec := activity.NewRecorder(config.Activity{Enabled: false, BufferLimit: 10}, seed.repos, nil)
	offSvc := NewActivityService(seed.repos, offRec)
	offSvc.now = func() time.Time { return activityNow }
	res, err = offSvc.IngestVisit(t.Context(), dto.VisitReportRequest{Visitor: visitB, Path: "/"},
		0, "203.0.113.31", "", "dw.sharyuke.com")
	if err != nil {
		t.Fatalf("采集关闭时上报不该报错: %v", err)
	}
	if res.Enabled || res.Accepted || res.Message == "" {
		t.Fatalf("采集关闭时应明确说明: %+v", res)
	}
}
