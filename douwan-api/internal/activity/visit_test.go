package activity

import (
	"strings"
	"testing"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// visitorA / visitorB 是两个固定的合法访客标识（32 位小写十六进制）。
var (
	visitorA = strings.Repeat("a", 32)
	visitorB = strings.Repeat("b", 32)
)

// pageRows 读回全部访问明细（按路径排序，便于断言）。
func (f *recorderFixture) pageRows(t *testing.T) []model.SiteVisitorPageDaily {
	t.Helper()
	var rows []model.SiteVisitorPageDaily
	if err := f.db.Order("visitor, day, path").Find(&rows).Error; err != nil {
		t.Fatalf("读回访问明细失败: %v", err)
	}
	return rows
}

// visitorRow 读回某个访客的档案。
func (f *recorderFixture) visitorRow(t *testing.T, visitor string) model.SiteVisitor {
	t.Helper()
	var row model.SiteVisitor
	if err := f.db.Where("visitor = ?", visitor).Take(&row).Error; err != nil {
		t.Fatalf("读回访客档案失败: %v", err)
	}
	return row
}

func TestRecorderPageViewAggregatesAndDedupes(t *testing.T) {
	f := newTestRecorder(t, 100)
	ctx := t.Context()

	if !f.rec.RecordPageView(VisitRecord{Visitor: visitorA, Path: "/", At: fixedNow, IP: "203.0.113.5"}) {
		t.Fatal("第一次访问应该被计入")
	}
	// 同一次导航里的重复上报（重定向 / 组件双挂载）不该算成两次 PV
	if f.rec.RecordPageView(VisitRecord{Visitor: visitorA, Path: "/", At: fixedNow.Add(300 * time.Millisecond)}) {
		t.Fatal("2 秒内的同一页面重复上报应该被去抖")
	}
	// 去抖窗口之外的再次访问是真实回访，必须计入
	if !f.rec.RecordPageView(VisitRecord{Visitor: visitorA, Path: "/", At: fixedNow.Add(5 * time.Second)}) {
		t.Fatal("超出去抖窗口的再次访问应该被计入")
	}
	if !f.rec.RecordPageView(VisitRecord{Visitor: visitorA, Path: "/editor", At: fixedNow.Add(time.Minute)}) {
		t.Fatal("另一个页面应该被计入")
	}
	// 非法访客标识直接拒绝（服务层会兜底生成，采集器不接受脏数据）
	if f.rec.RecordPageView(VisitRecord{Visitor: "NOT-A-VISITOR", Path: "/", At: fixedNow}) {
		t.Fatal("非法访客标识不该被计入")
	}

	pv, visitors := f.rec.PendingVisits()
	if pv != 3 || visitors != 1 {
		t.Fatalf("缓冲里 pv=%d visitors=%d，期望 3 / 1", pv, visitors)
	}

	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}
	if stats := f.rec.Stats(); stats.BufferedVisits != 0 || stats.BufferedVisitors != 0 || stats.DroppedVisits != 0 {
		t.Fatalf("落库后访问缓冲没清空: %+v", stats)
	}

	rows := f.pageRows(t)
	if len(rows) != 2 {
		t.Fatalf("应有 2 条明细（/ 与 /editor），实际 %d 条: %+v", len(rows), rows)
	}
	byPath := map[string]model.SiteVisitorPageDaily{}
	for _, row := range rows {
		byPath[row.Path] = row
	}
	if got := byPath["/"].PV; got != 2 {
		t.Fatalf("首页 PV = %d，期望 2（去抖掉一次）", got)
	}
	if got := byPath["/editor"].PV; got != 1 {
		t.Fatalf("编辑器 PV = %d，期望 1", got)
	}
	if byPath["/"].Day != "2026-10-15" {
		t.Fatalf("日期分桶不对: %+v", byPath["/"])
	}

	visitor := f.visitorRow(t, visitorA)
	if visitor.PageViews != 3 {
		t.Fatalf("访客累计访问量 = %d，期望 3", visitor.PageViews)
	}
	if visitor.FirstPath != "/" || visitor.LastPath != "/editor" {
		t.Fatalf("落地页/最近页面不对: first=%q last=%q", visitor.FirstPath, visitor.LastPath)
	}
	if visitor.FirstDay != "2026-10-15" || visitor.LastDay != "2026-10-15" {
		t.Fatalf("访客首末日期不对: %+v", visitor)
	}

	// 落库后再来一次：明细累加、访客累计量继续加，而不是重开一行
	if !f.rec.RecordPageView(VisitRecord{Visitor: visitorA, Path: "/", At: fixedNow.Add(2 * time.Minute)}) {
		t.Fatal("落库后的新访问应该被计入（去抖状态随落库重置）")
	}
	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("二次落库失败: %v", err)
	}
	rows = f.pageRows(t)
	if len(rows) != 2 {
		t.Fatalf("二次落库不该新增明细行: %+v", rows)
	}
	for _, row := range rows {
		if row.Path == "/" && row.PV != 3 {
			t.Fatalf("首页 PV 应该累加到 3，实际 %d", row.PV)
		}
	}
	if got := f.visitorRow(t, visitorA).PageViews; got != 4 {
		t.Fatalf("访客累计访问量应该累加到 4，实际 %d", got)
	}
}

func TestRecorderPageViewNormalizesPath(t *testing.T) {
	f := newTestRecorder(t, 100)
	ctx := t.Context()

	f.rec.RecordPageView(VisitRecord{Visitor: visitorA, Path: "/library/:slug?x=1", At: fixedNow})
	f.rec.RecordPageView(VisitRecord{Visitor: visitorB, Path: "not-a-path", At: fixedNow})
	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}

	paths := map[string]int64{}
	for _, row := range f.pageRows(t) {
		paths[row.Path] = row.PV
	}
	if paths["/library/:slug"] != 1 {
		t.Fatalf("查询串应该被砍掉: %+v", paths)
	}
	if paths[model.VisitorUnknownPath] != 1 {
		t.Fatalf("非法路径应该归到 %s: %+v", model.VisitorUnknownPath, paths)
	}
}

func TestRecorderPageViewBufferLimitDrops(t *testing.T) {
	// BufferLimit=2：第二个访客就会撑到上限，后续访问被丢弃并计数
	f := newTestRecorder(t, 2)

	accepted := 0
	for i := 0; i < 5; i++ {
		visitor := strings.Repeat(string(rune('a'+i)), 32)
		if f.rec.RecordPageView(VisitRecord{Visitor: visitor, Path: "/", At: fixedNow}) {
			accepted++
		}
	}
	if accepted >= 5 {
		t.Fatalf("缓冲上限没有生效，接受了 %d 次", accepted)
	}
	stats := f.rec.Stats()
	if stats.DroppedVisits == 0 {
		t.Fatalf("丢弃次数应该被如实计数: %+v", stats)
	}
	if stats.BufferedVisits != int64(accepted) {
		t.Fatalf("缓冲里的 PV = %d，期望 %d", stats.BufferedVisits, accepted)
	}
}

func TestRecorderPageViewMarksLoggedInUserActive(t *testing.T) {
	f := newTestRecorder(t, 100)
	ctx := t.Context()

	user := &model.User{Username: "visitorUser", PasswordHash: "x", Status: model.UserStatusActive}
	if err := f.repos.User.Create(ctx, user); err != nil {
		t.Fatalf("建用户失败: %v", err)
	}
	f.rec.RecordPageView(VisitRecord{Visitor: visitorA, UserID: user.ID, Path: "/", At: fixedNow, IP: "203.0.113.7"})
	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}

	rows := f.dailyRows(t, user.ID)
	if len(rows) != 1 {
		t.Fatalf("登录用户的一次页面访问应该让他当天算活跃: %+v", rows)
	}
	// 访问上报本身不是业务接口调用，所以只标记活跃、不加请求次数
	if rows[0].RequestCount != 0 || rows[0].FeatureCount != 0 {
		t.Fatalf("页面访问不该增加请求/功能次数: %+v", rows[0])
	}
	if got := f.visitorRow(t, visitorA); got.UserID != user.ID {
		t.Fatalf("访客档案应该记下登录用户: %+v", got)
	}
}

func TestRecorderPageViewDisabled(t *testing.T) {
	db := testsupport.NewDB(t)
	rec := NewRecorder(config.Activity{Enabled: false, BufferLimit: 10}, repository.New(db), nil)
	if rec.RecordPageView(VisitRecord{Visitor: visitorA, Path: "/"}) {
		t.Fatal("采集关闭时不该计入任何访问")
	}
}
