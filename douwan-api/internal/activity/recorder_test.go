package activity

import (
	"testing"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// fixedNow 是测试用的「现在」，固定在东八区下午，方便断言日期分桶。
var fixedNow = time.Date(2026, 10, 15, 14, 30, 0, 0, model.ActivityLocation)

// recorderFixture 把采集器、仓储与底层连接放在一起，
// 测试里既要用仓储方法，也要直接查表断言。
type recorderFixture struct {
	rec   *Recorder
	repos *repository.Repositories
	db    *gorm.DB
}

func newTestRecorder(t *testing.T, limit int) *recorderFixture {
	t.Helper()
	db := testsupport.NewDB(t)
	rec := NewRecorder(config.Activity{
		Enabled:         true,
		FlushInterval:   time.Second,
		BufferLimit:     limit,
		RetainDays:      30,
		CleanupInterval: time.Hour,
	}, repository.New(db), nil)
	rec.now = func() time.Time { return fixedNow }
	return &recorderFixture{rec: rec, repos: repository.New(db), db: db}
}

// dailyRows 读回某个用户在某天的日活跃行（不存在返回 nil, false）。
func (f *recorderFixture) dailyRows(t *testing.T, userID uint64) []model.UserDailyActivity {
	t.Helper()
	rows, err := f.repos.Activity.UserDailyList(t.Context(), userID, "2000-01-01", "2999-12-31")
	if err != nil {
		t.Fatalf("读回日活跃失败: %v", err)
	}
	return rows
}

func TestRecorderTouchAggregates(t *testing.T) {
	f := newTestRecorder(t, 100)

	f.rec.Touch(7, fixedNow, "203.0.113.5", model.FeatureAccountLogin)
	f.rec.Touch(7, fixedNow.Add(2*time.Hour), "203.0.113.5", "")
	f.rec.Touch(7, fixedNow.Add(3*time.Hour), "", "") // 没有功能点，只算请求

	pending := f.rec.PendingUsers()
	if len(pending) != 1 || pending[0] != 7 {
		t.Fatalf("缓冲里的用户不对: %v", pending)
	}
	features := f.rec.PendingFeatures()
	if features[model.FeatureAccountLogin+"/"+model.ActivitySourceAPI] != 1 {
		t.Fatalf("登录功能计数不对: %v", features)
	}
	if stats := f.rec.Stats(); stats.BufferedBuckets != 1 {
		t.Fatalf("缓冲桶数不对: %+v", stats)
	}
}

func TestRecorderFlushWritesAndAccumulates(t *testing.T) {
	f := newTestRecorder(t, 100)
	ctx := t.Context()

	// 先建好用户：采集器会把 users.last_active_at 一起更新
	user := &model.User{Username: "tester", PasswordHash: "x", Status: model.UserStatusActive}
	if err := f.repos.User.Create(ctx, user); err != nil {
		t.Fatalf("建用户失败: %v", err)
	}

	f.rec.Touch(user.ID, fixedNow, "203.0.113.9", model.FeatureAccountLogin)
	f.rec.Touch(user.ID, fixedNow.Add(time.Hour), "203.0.113.9", "")
	f.rec.RecordClientFeature(user.ID, fixedNow, "203.0.113.9", model.FeaturePatternMake, 3)

	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}
	if stats := f.rec.Stats(); stats.BufferedBuckets != 0 || stats.BufferedHits != 0 {
		t.Fatalf("落库后缓冲没清空: %+v", stats)
	}

	rows := f.dailyRows(t, user.ID)
	if len(rows) != 1 {
		t.Fatalf("日活跃行数 = %d，期望 1", len(rows))
	}
	daily := rows[0]
	if daily.Day != "2026-10-15" {
		t.Fatalf("日期 = %s，期望 2026-10-15", daily.Day)
	}
	if daily.RequestCount != 2 {
		t.Fatalf("请求次数 = %d，期望 2", daily.RequestCount)
	}
	if daily.FeatureCount != 4 { // 1 次登录 + 3 次客户端上报
		t.Fatalf("功能次数 = %d，期望 4", daily.FeatureCount)
	}
	if !daily.FirstActiveAt.Equal(fixedNow) {
		t.Fatalf("首次活跃时间 = %s，期望 %s", daily.FirstActiveAt, fixedNow)
	}
	if !daily.LastActiveAt.Equal(fixedNow.Add(time.Hour)) {
		t.Fatalf("最后活跃时间 = %s，期望 %s", daily.LastActiveAt, fixedNow.Add(time.Hour))
	}

	stored, err := f.repos.User.FindByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("读回用户失败: %v", err)
	}
	if stored.LastActiveAt == nil || !stored.LastActiveAt.Equal(fixedNow.Add(time.Hour)) {
		t.Fatalf("users.last_active_at 没更新: %+v", stored.LastActiveAt)
	}

	// 再来一轮：同一天的数据必须累加而不是覆盖
	f.rec.Touch(user.ID, fixedNow.Add(2*time.Hour), "", "")
	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("第二次落库失败: %v", err)
	}
	rows = f.dailyRows(t, user.ID)
	if len(rows) != 1 {
		t.Fatalf("累加后不该出现新行: %+v", rows)
	}
	if rows[0].RequestCount != 3 {
		t.Fatalf("累加后的请求次数 = %d，期望 3", rows[0].RequestCount)
	}
	if !rows[0].FirstActiveAt.Equal(fixedNow) {
		t.Fatalf("累加不该改写首次活跃时间: %s", rows[0].FirstActiveAt)
	}

	var features []model.UserFeatureDaily
	if err := f.db.Where("user_id = ?", user.ID).Find(&features).Error; err != nil {
		t.Fatalf("读回功能统计失败: %v", err)
	}
	if len(features) != 2 {
		t.Fatalf("功能统计行数 = %d，期望 2（api 登录 + client 生成图纸）", len(features))
	}
	for _, row := range features {
		switch row.Feature + "/" + row.Source {
		case model.FeatureAccountLogin + "/" + model.ActivitySourceAPI:
			if row.Hits != 1 {
				t.Fatalf("登录次数 = %d，期望 1", row.Hits)
			}
		case model.FeaturePatternMake + "/" + model.ActivitySourceClient:
			if row.Hits != 3 {
				t.Fatalf("生成图纸次数 = %d，期望 3", row.Hits)
			}
		default:
			t.Fatalf("出现意外的功能行: %+v", row)
		}
	}
}

func TestRecorderBufferLimitDropsNewKeys(t *testing.T) {
	f := newTestRecorder(t, 2)

	f.rec.Touch(1, fixedNow, "", "")
	f.rec.Touch(2, fixedNow, "", "")
	f.rec.Touch(3, fixedNow, "", "") // 超限，应被丢弃

	stats := f.rec.Stats()
	if stats.BufferedBuckets != 2 {
		t.Fatalf("缓冲桶数 = %d，期望 2（超限后不再新增）", stats.BufferedBuckets)
	}
	if stats.DroppedHits != 1 {
		t.Fatalf("丢弃计数 = %d，期望 1", stats.DroppedHits)
	}
	// 已经在缓冲里的用户继续累加不受影响
	f.rec.Touch(1, fixedNow, "", "")
	if stats := f.rec.Stats(); stats.BufferedBuckets != 2 {
		t.Fatalf("已有桶应该继续累加: %+v", stats)
	}
}

func TestRecorderDisabledDoesNothing(t *testing.T) {
	db := testsupport.NewDB(t)
	rec := NewRecorder(config.Activity{Enabled: false, BufferLimit: 10}, repository.New(db), nil)
	rec.Touch(1, fixedNow, "203.0.113.1", model.FeatureAccountLogin)
	rec.RecordClientFeature(1, fixedNow, "", model.FeaturePatternMake, 5)

	if stats := rec.Stats(); stats.BufferedBuckets != 0 || stats.BufferedHits != 0 {
		t.Fatalf("采集关闭时不该有任何缓冲: %+v", stats)
	}
	if err := rec.Flush(t.Context()); err != nil {
		t.Fatalf("采集关闭时 Flush 不该报错: %v", err)
	}
	if rec.Enabled() {
		t.Fatal("Enabled 应为 false")
	}
}

func TestRecorderDayBucketsByEastEight(t *testing.T) {
	f := newTestRecorder(t, 100)
	ctx := t.Context()

	// 东八区 00:30 与 23:30 是同一天（UTC 分别是前一天 16:30 与当天 15:30）
	early := time.Date(2026, 10, 15, 0, 30, 0, 0, model.ActivityLocation)
	late := time.Date(2026, 10, 15, 23, 30, 0, 0, model.ActivityLocation)
	f.rec.Touch(21, early, "", "")
	f.rec.Touch(21, late, "", "")
	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}

	rows := f.dailyRows(t, 21)
	if len(rows) != 1 || rows[0].Day != "2026-10-15" {
		t.Fatalf("东八区同一天应该合并成一行: %+v", rows)
	}

	// UTC 当天 16:30 = 东八区次日 00:30，应该落到第二天
	nextDay := time.Date(2026, 10, 15, 16, 30, 0, 0, time.UTC)
	f.rec.Touch(21, nextDay, "", "")
	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}
	rows = f.dailyRows(t, 21)
	if len(rows) != 2 || rows[1].Day != "2026-10-16" {
		t.Fatalf("跨零点的请求应该落到次日: %+v", rows)
	}
}

func TestRecorderPurgeRemovesOldRows(t *testing.T) {
	f := newTestRecorder(t, 100)
	ctx := t.Context()

	f.rec.Touch(31, fixedNow.AddDate(0, 0, -40), "", "") // 40 天前，超出保留期
	f.rec.Touch(31, fixedNow, "", "")
	if err := f.rec.Flush(ctx); err != nil {
		t.Fatalf("落库失败: %v", err)
	}
	daily, features, visits := f.rec.Purge(ctx)
	if daily != 1 || features != 0 || visits != 0 {
		t.Fatalf("清理行数 = (%d, %d, %d)，期望 (1, 0, 0)", daily, features, visits)
	}
	rows := f.dailyRows(t, 31)
	if len(rows) != 1 || rows[0].Day != "2026-10-15" {
		t.Fatalf("应该只剩保留期内的那一行: %+v", rows)
	}
}
