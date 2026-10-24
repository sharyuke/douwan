package repository

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// VisitRepository 是站点访问量（PV / UV）的读写入口。
//
// 写入侧只被访问采集器在后台协程里调用（一次一批）；
// 读取侧只被后台「用户活跃监控 → 访问量」接口调用，全部是只读聚合。
//
// 读取侧刻意用 Table("...") 直接写表名并**全列限定**（site_visitor_page_daily.xxx）：
// 访问量表只有硬删除（PurgeBefore 用 Unscoped），没有软删行，
// 不需要 GORM 帮忙加 deleted_at 条件，反而要避免多表 join 时的列名歧义。
type VisitRepository struct {
	db *gorm.DB
}

/* ------------------------------------------------------------------ 写入侧 */

// VisitVisitorDelta 是一次落库里的单个访客增量。
type VisitVisitorDelta struct {
	Visitor       string
	UserID        uint64
	FirstSeenAt   time.Time
	LastSeenAt    time.Time
	FirstDay      string
	LastDay       string
	PageViews     int64
	FirstPath     string
	LastPath      string
	Channel       string
	ChannelDetail string
	IP            string
	Region        model.GeoRegion
}

// VisitPageDelta 是一次落库里的单个「访客 × 天 × 页面」增量。
type VisitPageDelta struct {
	Visitor string
	Day     string
	Path    string
	PV      int64
	UserID  uint64
	FirstAt time.Time
	LastAt  time.Time
}

// UpsertVisitors 批量累加访客档案。
//
// 冲突时：时间取更早/更晚的那个、累计访问量相加、user_id 取新的非零值、
// 渠道**只在原来为空时**才写入（首触归因，与 users.channel 同一套规则）。
//
// 表达式里的列名一律带表名限定（`site_visitors.channel`）：
// PostgreSQL 的 ON CONFLICT DO UPDATE 里 `EXCLUDED` 也在同一作用域，
// 不限定会被判成 column reference is ambiguous（SQLSTATE 42702）——
// 这个坑只在真 PG 上出现，internal/handler/postgres_test.go 里专门覆盖了这条路径。
func (r *VisitRepository) UpsertVisitors(ctx context.Context, deltas []VisitVisitorDelta) error {
	if len(deltas) == 0 {
		return nil
	}
	rows := make([]model.SiteVisitor, 0, len(deltas))
	for _, d := range deltas {
		rows = append(rows, model.SiteVisitor{
			Visitor:       d.Visitor,
			UserID:        d.UserID,
			FirstSeenAt:   d.FirstSeenAt,
			LastSeenAt:    d.LastSeenAt,
			FirstDay:      d.FirstDay,
			LastDay:       d.LastDay,
			PageViews:     d.PageViews,
			FirstPath:     d.FirstPath,
			LastPath:      d.LastPath,
			Channel:       d.Channel,
			ChannelDetail: d.ChannelDetail,
			IP:            d.IP,
			Country:       d.Region.Country,
			Province:      d.Region.Province,
			City:          d.Region.City,
			ISP:           d.Region.ISP,
			RegionRaw:     d.Region.Raw,
		})
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "visitor"}},
		DoUpdates: clause.Assignments(map[string]any{
			"first_seen_at": gorm.Expr("CASE WHEN EXCLUDED.first_seen_at < site_visitors.first_seen_at" +
				" THEN EXCLUDED.first_seen_at ELSE site_visitors.first_seen_at END"),
			"last_seen_at": gorm.Expr("CASE WHEN EXCLUDED.last_seen_at > site_visitors.last_seen_at" +
				" THEN EXCLUDED.last_seen_at ELSE site_visitors.last_seen_at END"),
			"first_day": gorm.Expr("CASE WHEN EXCLUDED.first_day < site_visitors.first_day" +
				" THEN EXCLUDED.first_day ELSE site_visitors.first_day END"),
			"last_day": gorm.Expr("CASE WHEN EXCLUDED.last_day > site_visitors.last_day" +
				" THEN EXCLUDED.last_day ELSE site_visitors.last_day END"),
			"page_views": gorm.Expr("site_visitors.page_views + EXCLUDED.page_views"),
			// first_path 是首触落地页，冲突时**不覆盖**（保留第一次的值）；
			// last_path 跟着最近一次访问走，所以和 last_seen_at 用同一个判断。
			"last_path": gorm.Expr("CASE WHEN EXCLUDED.last_seen_at >= site_visitors.last_seen_at" +
				" THEN EXCLUDED.last_path ELSE site_visitors.last_path END"),
			"channel": gorm.Expr("CASE WHEN site_visitors.channel = '' THEN EXCLUDED.channel" +
				" ELSE site_visitors.channel END"),
			"channel_detail": gorm.Expr("CASE WHEN site_visitors.channel_detail = '' THEN EXCLUDED.channel_detail" +
				" ELSE site_visitors.channel_detail END"),
			"user_id": gorm.Expr("CASE WHEN EXCLUDED.user_id <> 0 THEN EXCLUDED.user_id" +
				" ELSE site_visitors.user_id END"),
			"ip":         visitNonEmptyExpr("ip"),
			"country":    visitNonEmptyExpr("country"),
			"province":   visitNonEmptyExpr("province"),
			"city":       visitNonEmptyExpr("city"),
			"isp":        visitNonEmptyExpr("isp"),
			"region_raw": visitNonEmptyExpr("region_raw"),
			"updated_at": gorm.Expr("EXCLUDED.updated_at"),
		}),
	}).CreateInBatches(rows, activityBatchSize).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// visitNonEmptyExpr 生成「新值非空才覆盖，否则保留旧值」的冲突更新表达式。
func visitNonEmptyExpr(column string) clause.Expr {
	return gorm.Expr("CASE WHEN EXCLUDED." + column + " <> '' THEN EXCLUDED." + column +
		" ELSE site_visitors." + column + " END")
}

// UpsertVisitorPages 批量累加「访客 × 天 × 页面」明细。
//
// 第一次写入这一行时就等于记下了一个 UV（唯一索引 visitor+day+path），
// 之后再访问同一个页面只加 pv，UV 不会重复计算。
func (r *VisitRepository) UpsertVisitorPages(ctx context.Context, deltas []VisitPageDelta) error {
	if len(deltas) == 0 {
		return nil
	}
	rows := make([]model.SiteVisitorPageDaily, 0, len(deltas))
	for _, d := range deltas {
		rows = append(rows, model.SiteVisitorPageDaily{
			Visitor: d.Visitor,
			Day:     d.Day,
			Path:    d.Path,
			PV:      d.PV,
			UserID:  d.UserID,
			FirstAt: d.FirstAt,
			LastAt:  d.LastAt,
		})
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "visitor"}, {Name: "day"}, {Name: "path"}},
		DoUpdates: clause.Assignments(map[string]any{
			// 同样要限定表名，否则 PostgreSQL 会报 pv / first_at 引用有歧义
			"pv": gorm.Expr("site_visitor_page_daily.pv + EXCLUDED.pv"),
			"first_at": gorm.Expr("CASE WHEN EXCLUDED.first_at < site_visitor_page_daily.first_at" +
				" THEN EXCLUDED.first_at ELSE site_visitor_page_daily.first_at END"),
			"last_at": gorm.Expr("CASE WHEN EXCLUDED.last_at > site_visitor_page_daily.last_at" +
				" THEN EXCLUDED.last_at ELSE site_visitor_page_daily.last_at END"),
			"user_id": gorm.Expr("CASE WHEN EXCLUDED.user_id <> 0 THEN EXCLUDED.user_id" +
				" ELSE site_visitor_page_daily.user_id END"),
			"updated_at": gorm.Expr("EXCLUDED.updated_at"),
		}),
	}).CreateInBatches(rows, activityBatchSize).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// PurgeVisitsBefore 硬删除早于某一天的访问明细。
//
// 只删明细、**不删 site_visitors 档案**：档案里的 first_day 是新老访客的依据，
// 删掉会让回归的老访客被重新算成新访客（数字会突然变好看，但是假的）。
// 档案每人一行，体积可控。
func (r *VisitRepository) PurgeVisitsBefore(ctx context.Context, day string) (int64, error) {
	res := r.db.WithContext(ctx).Unscoped().
		Where("day < ?", day).Delete(&model.SiteVisitorPageDaily{})
	if res.Error != nil {
		return 0, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected, nil
}

/* ------------------------------------------------------------------ 读取侧 */

// VisitDayRow 趋势图上的一天。
type VisitDayRow struct {
	Day      string `gorm:"column:day"`
	PV       int64  `gorm:"column:pv"`
	Visitors int64  `gorm:"column:visitors"`
}

// DailyTraffic 按天汇总 PV 与去重访客数。
func (r *VisitRepository) DailyTraffic(ctx context.Context, from, to string) ([]VisitDayRow, error) {
	var rows []VisitDayRow
	err := r.db.WithContext(ctx).Table("site_visitor_page_daily").
		Select("day AS day, SUM(pv) AS pv, COUNT(DISTINCT visitor) AS visitors").
		Where("day >= ? AND day <= ?", from, to).
		Group("day").Order("day").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// NewVisitorDays 按天汇总「首次出现的访客数」。
func (r *VisitRepository) NewVisitorDays(ctx context.Context, from, to string) ([]VisitDayRow, error) {
	var rows []VisitDayRow
	err := r.db.WithContext(ctx).Table("site_visitors").
		Select("first_day AS day, COUNT(*) AS visitors").
		Where("first_day >= ? AND first_day <= ?", from, to).
		Group("first_day").Order("first_day").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// VisitWindowStats 是窗口内的总量指标。
type VisitWindowStats struct {
	PV       int64 `gorm:"column:pv"`
	Visitors int64 `gorm:"column:visitors"`
	// Logged 是窗口内**带过登录态**的访客数（同一访客匿名访问过也算登录访客）。
	// 匿名访客数由服务层用 Visitors - Logged 得到，两边互斥、加起来正好是 UV。
	Logged int64 `gorm:"column:logged"`
}

// WindowStats 汇总窗口内的 PV / UV / 登录访客数。
func (r *VisitRepository) WindowStats(ctx context.Context, from, to string) (VisitWindowStats, error) {
	var out VisitWindowStats
	err := r.db.WithContext(ctx).Table("site_visitor_page_daily").
		Select("COALESCE(SUM(pv), 0) AS pv, COUNT(DISTINCT visitor) AS visitors, "+
			"COUNT(DISTINCT CASE WHEN user_id <> 0 THEN visitor END) AS logged").
		Where("day >= ? AND day <= ?", from, to).Scan(&out).Error
	if err != nil {
		return out, response.ErrInternal.WithCause(err)
	}
	return out, nil
}

// VisitTotals 是全时段累计。
type VisitTotals struct {
	Visitors  int64 `gorm:"column:visitors"`
	PageViews int64 `gorm:"column:page_views"`
}

// Totals 返回累计访客数与累计访问量。
func (r *VisitRepository) Totals(ctx context.Context) (VisitTotals, error) {
	var out VisitTotals
	err := r.db.WithContext(ctx).Table("site_visitors").
		Select("COUNT(*) AS visitors, COALESCE(SUM(page_views), 0) AS page_views").
		Scan(&out).Error
	if err != nil {
		return out, response.ErrInternal.WithCause(err)
	}
	return out, nil
}

// VisitPageRow 一个页面（路由模板）在窗口内的访问量。
type VisitPageRow struct {
	Path     string `gorm:"column:path"`
	PV       int64  `gorm:"column:pv"`
	Visitors int64  `gorm:"column:visitors"`
}

// PageStats 页面访问量排行。
func (r *VisitRepository) PageStats(ctx context.Context, from, to string, limit int) ([]VisitPageRow, error) {
	if limit <= 0 {
		limit = 15
	}
	var rows []VisitPageRow
	err := r.db.WithContext(ctx).Table("site_visitor_page_daily").
		Select("path AS path, SUM(pv) AS pv, COUNT(DISTINCT visitor) AS visitors").
		Where("day >= ? AND day <= ?", from, to).
		Group("path").Order("pv DESC, path ASC").Limit(limit).Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// VisitLandingRow 新访客的落地页分布。
type VisitLandingRow struct {
	Path     string `gorm:"column:path"`
	Visitors int64  `gorm:"column:visitors"`
}

// LandingStats 新访客第一次打开的是哪个页面。
//
// 只看窗口内**首次出现的访客**（site_visitors.first_day），
// 用 first_path 而不是当天的第一条明细：落地页的定义就是「第一次落在哪」。
func (r *VisitRepository) LandingStats(ctx context.Context, from, to string, limit int) ([]VisitLandingRow, error) {
	if limit <= 0 {
		limit = 15
	}
	var rows []VisitLandingRow
	err := r.db.WithContext(ctx).Table("site_visitors").
		Select("first_path AS path, COUNT(*) AS visitors").
		Where("first_day >= ? AND first_day <= ?", from, to).
		Group("first_path").Order("visitors DESC, path ASC").Limit(limit).Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// VisitSourceRow 一个首触渠道在窗口内的访客与访问量。
type VisitSourceRow struct {
	Channel  string `gorm:"column:channel"`
	Visitors int64  `gorm:"column:visitors"`
	PV       int64  `gorm:"column:pv"`
}

// SourceStats 按访客的首触渠道汇总窗口内的访问。
func (r *VisitRepository) SourceStats(ctx context.Context, from, to string, limit int) ([]VisitSourceRow, error) {
	if limit <= 0 {
		limit = 15
	}
	var rows []VisitSourceRow
	err := r.db.WithContext(ctx).Table("site_visitor_page_daily AS p").
		Select("v.channel AS channel, COUNT(DISTINCT p.visitor) AS visitors, SUM(p.pv) AS pv").
		Joins("JOIN site_visitors AS v ON v.visitor = p.visitor").
		Where("p.day >= ? AND p.day <= ?", from, to).
		Group("v.channel").Order("visitors DESC, pv DESC").Limit(limit).Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// VisitVisitorFilter 访客列表的筛选条件。
type VisitVisitorFilter struct {
	From string
	To   string
	// Channel 为空表示不筛选；model.ChannelUnknown（空串）的筛选用 ChannelSet 表达。
	Channel    string
	ChannelSet bool
	// Path 只看访问过某个页面的访客（用于「点开某个页面的人是谁」）。
	Path string
	// Sort 支持 page_views（默认）/ last_seen / first_seen
	Sort string
	dto.PageQuery
}

// VisitVisitorRow 访客列表的一行。
type VisitVisitorRow struct {
	Visitor    string    `gorm:"column:visitor"`
	UserID     uint64    `gorm:"column:user_id"`
	Username   string    `gorm:"column:username"`
	FirstDay   string    `gorm:"column:first_day"`
	LastDay    string    `gorm:"column:last_day"`
	LastSeenAt time.Time `gorm:"column:last_seen_at"`
	PageViews  int64     `gorm:"column:page_views"`
	FirstPath  string    `gorm:"column:first_path"`
	LastPath   string    `gorm:"column:last_path"`
	Channel    string    `gorm:"column:channel"`
	IP         string    `gorm:"column:ip"`
	Province   string    `gorm:"column:province"`
	City       string    `gorm:"column:city"`
	ISP        string    `gorm:"column:isp"`
}

// visitVisitorQuery 组装访客列表的公共条件。
//
// 窗口用 `last_day BETWEEN from AND to` 表达「窗口内来过」：
// 窗口右端就是今天，所以「最后来过的日子落在窗口内」与「窗口内来过」等价，
// 一条索引条件就能筛，不必对明细表做 EXISTS 之外的额外聚合。
func (r *VisitRepository) visitVisitorQuery(f VisitVisitorFilter) *gorm.DB {
	q := r.db.Table("site_visitors AS v").
		Joins("LEFT JOIN users AS u ON u.id = v.user_id").
		Where("v.last_day >= ? AND v.last_day <= ?", f.From, f.To)
	if f.ChannelSet {
		q = q.Where("v.channel = ?", f.Channel)
	}
	if f.Path != "" {
		q = q.Where("EXISTS (SELECT 1 FROM site_visitor_page_daily p"+
			" WHERE p.visitor = v.visitor AND p.day >= ? AND p.day <= ? AND p.path = ?)",
			f.From, f.To, f.Path)
	}
	return q
}

// ListVisitors 分页返回窗口内来过的访客。
func (r *VisitRepository) ListVisitors(ctx context.Context, f VisitVisitorFilter) ([]VisitVisitorRow, int64, error) {
	base := r.visitVisitorQuery(f)
	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	var rows []VisitVisitorRow
	err := base.Session(&gorm.Session{}).
		Select("v.visitor AS visitor, v.user_id AS user_id, u.username AS username," +
			" v.first_day AS first_day, v.last_day AS last_day, v.last_seen_at AS last_seen_at," +
			" v.page_views AS page_views, v.first_path AS first_path, v.last_path AS last_path," +
			" v.channel AS channel, v.ip AS ip, v.province AS province, v.city AS city, v.isp AS isp").
		Order(visitVisitorOrder(f.Sort)).
		Limit(f.Limit()).Offset(f.Offset()).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return rows, total, nil
}

// visitVisitorOrder 把排序键映射成 SQL，未知值一律回落到累计访问量。
func visitVisitorOrder(sort string) string {
	switch sort {
	case "last_seen":
		return "v.last_seen_at DESC, v.visitor ASC"
	case "first_seen":
		return "v.first_seen_at DESC, v.visitor ASC"
	case "page_views":
		return "v.page_views DESC, v.last_seen_at DESC"
	default:
		return "v.page_views DESC, v.last_seen_at DESC"
	}
}
