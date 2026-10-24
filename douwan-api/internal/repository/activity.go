package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// ActivityRepository 是用户活跃数据的读写入口。
//
// 写入侧（Upsert*）只被活跃采集器在后台协程里调用，一次一批；
// 读取侧（List*/Stats）被后台「用户活跃监控」接口调用，全部是只读聚合。
//
// 这里刻意没有「原始事件流水表」：需求要的是频次、地区、功能、渠道四个维度的
// 分布与趋势，日粒度汇总足够，而体积只有流水表的几十分之一。
type ActivityRepository struct {
	db *gorm.DB
}

/* ------------------------------------------------------------------ 写入侧 */

// ActivityDailyDelta 是一次落库里的单个「用户 × 天」增量。
//
// 计数是增量（会和库里的值相加），时间与地区是终值（取更新的那个）。
type ActivityDailyDelta struct {
	UserID        uint64
	Day           string
	FirstActiveAt time.Time
	LastActiveAt  time.Time
	RequestCount  int64
	FeatureCount  int64
	IP            string
	Region        model.GeoRegion
}

// ActivityFeatureDelta 是一次落库里的单个「用户 × 天 × 功能 × 来源」增量。
type ActivityFeatureDelta struct {
	UserID  uint64
	Day     string
	Feature string
	Source  string
	Count   int64
}

// activityBatchSize 单条 SQL 的行数上限。批量太大反而会拖长事务、
// 撑高 WAL（qq 只有 40G 盘），切成小块更稳。
const activityBatchSize = 200

// UpsertDaily 批量累加日活跃汇总。
//
// 冲突时：计数相加、时间取更早/更晚的那个、地区取非空的新值。
// 全部用原生表达式而不是先查后写，避免并发下的读改写丢更新。
//
// 表达式里的列名一律**带表名限定**（`user_daily_activities.city`）：
// PostgreSQL 的 ON CONFLICT DO UPDATE 里 `excluded` 也在同一个作用域，
// 不限定表名会被判成 column reference "city" is ambiguous（SQLSTATE 42702）。
// 这个坑只在真 PG 上出现（SQLite 会自己挑目标表的列），所以
// internal/handler/postgres_test.go 里专门覆盖了这条冲突更新路径。
func (r *ActivityRepository) UpsertDaily(ctx context.Context, deltas []ActivityDailyDelta) error {
	if len(deltas) == 0 {
		return nil
	}
	rows := make([]model.UserDailyActivity, 0, len(deltas))
	for _, d := range deltas {
		rows = append(rows, model.UserDailyActivity{
			UserID:        d.UserID,
			Day:           d.Day,
			FirstActiveAt: d.FirstActiveAt,
			LastActiveAt:  d.LastActiveAt,
			RequestCount:  d.RequestCount,
			FeatureCount:  d.FeatureCount,
			IP:            d.IP,
			Country:       d.Region.Country,
			Province:      d.Region.Province,
			City:          d.Region.City,
			ISP:           d.Region.ISP,
			RegionRaw:     d.Region.Raw,
		})
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "day"}},
		DoUpdates: clause.Assignments(map[string]any{
			"first_active_at": gorm.Expr("CASE WHEN EXCLUDED.first_active_at < user_daily_activities.first_active_at" +
				" THEN EXCLUDED.first_active_at ELSE user_daily_activities.first_active_at END"),
			"last_active_at": gorm.Expr("CASE WHEN EXCLUDED.last_active_at > user_daily_activities.last_active_at" +
				" THEN EXCLUDED.last_active_at ELSE user_daily_activities.last_active_at END"),
			"request_count": gorm.Expr("user_daily_activities.request_count + EXCLUDED.request_count"),
			"feature_count": gorm.Expr("user_daily_activities.feature_count + EXCLUDED.feature_count"),
			"ip":            activityNonEmptyExpr("ip"),
			"country":       activityNonEmptyExpr("country"),
			"province":      activityNonEmptyExpr("province"),
			"city":          activityNonEmptyExpr("city"),
			"isp":           activityNonEmptyExpr("isp"),
			"region_raw":    activityNonEmptyExpr("region_raw"),
			"updated_at":    gorm.Expr("EXCLUDED.updated_at"),
		}),
	}).CreateInBatches(rows, activityBatchSize).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// activityNonEmptyExpr 生成「新值非空才覆盖，否则保留旧值」的冲突更新表达式。
func activityNonEmptyExpr(column string) clause.Expr {
	return gorm.Expr("CASE WHEN EXCLUDED." + column + " <> '' THEN EXCLUDED." + column +
		" ELSE user_daily_activities." + column + " END")
}

// UpsertFeatures 批量累加功能使用次数。
func (r *ActivityRepository) UpsertFeatures(ctx context.Context, deltas []ActivityFeatureDelta) error {
	if len(deltas) == 0 {
		return nil
	}
	rows := make([]model.UserFeatureDaily, 0, len(deltas))
	for _, d := range deltas {
		rows = append(rows, model.UserFeatureDaily{
			UserID:  d.UserID,
			Day:     d.Day,
			Feature: d.Feature,
			Source:  d.Source,
			Hits:    d.Count,
		})
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "day"}, {Name: "feature"}, {Name: "source"}},
		DoUpdates: clause.Assignments(map[string]any{
			// 同样要限定表名，否则 PostgreSQL 会报 hits 引用有歧义
			"hits":       gorm.Expr("user_feature_daily.hits + EXCLUDED.hits"),
			"updated_at": gorm.Expr("EXCLUDED.updated_at"),
		}),
	}).CreateInBatches(rows, activityBatchSize).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// TouchLastActive 更新用户的最近活跃时间。
//
// 只写「比库里更晚」的值：采集器可能因为重试而带着稍旧的时间回来，
// 不能让它把 last_active_at 往回拨。
func (r *ActivityRepository) TouchLastActive(ctx context.Context, userIDs []uint64, at time.Time) error {
	if len(userIDs) == 0 {
		return nil
	}
	// 单条 SQL 里避免超长 IN 列表：SQLite（测试库）对变量个数有上限
	for i := 0; i < len(userIDs); i += activityBatchSize {
		end := i + activityBatchSize
		if end > len(userIDs) {
			end = len(userIDs)
		}
		err := r.db.WithContext(ctx).Model(&model.User{}).
			Where("id IN ?", userIDs[i:end]).
			Where("last_active_at IS NULL OR last_active_at < ?", at).
			Update("last_active_at", at).Error
		if err != nil {
			return response.ErrInternal.WithCause(err)
		}
	}
	return nil
}

// PurgeBefore 硬删除早于某一天的活跃明细。
//
// 用 Unscoped 是刻意的：软删除只会让表继续长大，
// 而这些是可以随时重算的统计汇总，不需要留墓碑。
func (r *ActivityRepository) PurgeBefore(ctx context.Context, day string) (int64, int64, error) {
	daily := r.db.WithContext(ctx).Unscoped().
		Where("day < ?", day).Delete(&model.UserDailyActivity{})
	if daily.Error != nil {
		return 0, 0, response.ErrInternal.WithCause(daily.Error)
	}
	feature := r.db.WithContext(ctx).Unscoped().
		Where("day < ?", day).Delete(&model.UserFeatureDaily{})
	if feature.Error != nil {
		return daily.RowsAffected, 0, response.ErrInternal.WithCause(feature.Error)
	}
	return daily.RowsAffected, feature.RowsAffected, nil
}

/* ------------------------------------------------------------------ 读取侧 */

// ActivityTrendRow 趋势图上的一天。
type ActivityTrendRow struct {
	Day         string
	ActiveUsers int64
	Requests    int64
	Features    int64
}

// ActivityUserStatRow 单个用户在某个时间窗口内的活跃汇总。
//
// 全部统计值都是「窗口内」的口径；UserLastActiveAt 是冗余在 users 表上的全局值。
type ActivityUserStatRow struct {
	UserID           uint64
	Username         string
	Nickname         string
	Channel          string
	CreatedAt        time.Time
	UserLastActiveAt *time.Time
	ActiveDays       int64
	Requests         int64
	Features         int64
	// LastDay 是窗口内最后一次活跃的日期（YYYY-MM-DD）。
	//
	// 这里刻意取 MAX(day) 而不是 MAX(last_active_at)：日期是字符串列，
	// PostgreSQL 与测试用的 SQLite 行为完全一致；而聚合出来的时间戳
	// 在 SQLite 里会以文本返回，扫描进 time.Time 会直接报错。
	// 精确到秒的活跃时间在「用户活跃详情」里逐日给出。
	LastDay  string
	Province string
	City     string
	LastIP   string
}

// ActivityUserFilter 活跃用户列表的筛选条件。
type ActivityUserFilter struct {
	// From / To 是窗口边界（YYYY-MM-DD，含两端）
	From string
	To   string
	// UserID 非 0 时只统计这一个用户
	UserID uint64
	// Keyword 匹配用户名 / 昵称
	Keyword string
	// Channel 为空表示不筛选；"__all__" 之外的语义由调用方决定，
	// 想筛「未知来源」就传 model.ChannelUnknown
	Channel string
	// ChannelSet 为 true 时 Channel 即使是空串也参与筛选
	ChannelSet bool
	// Province 为空表示不筛选
	Province string
	// MinActiveDays 最少活跃天数；1 表示「只看活跃过的用户」
	MinActiveDays int64
	// Sort 取值：active_days（默认）/ requests / features / last_active
	Sort string

	PageQuery dto.PageQuery
}

// ActivityFrequencyRow 使用频率直方图的一行：窗口内活跃了 N 天的用户有多少个。
type ActivityFrequencyRow struct {
	ActiveDays int64
	Users      int64
}

// ActivityRegionRow 地区 / 运营商分布的一行。
//
// Country 一起返回：境外 IP 的「省份」是州 / 一级行政区（例如 California），
// 不带国家的话后台只看到一串英文地名，不知道是哪儿。
type ActivityRegionRow struct {
	Country  string
	Province string
	City     string
	ISP      string
	Users    int64
	Requests int64
}

// ActivityRegionStats 地区维度的完整结果。
type ActivityRegionStats struct {
	Provinces []ActivityRegionRow
	Cities    []ActivityRegionRow
	ISPs      []ActivityRegionRow
	// UnknownUsers 窗口内活跃、但归属地没能解析出来的用户数（含内网 / IPv6 未收录）
	UnknownUsers int64
}

// ActivityFeatureRow 功能使用的一行（按功能 + 来源分组）。
type ActivityFeatureRow struct {
	Feature string
	Source  string
	Users   int64
	Count   int64
}

// ActivityChannelRow 渠道统计的一行。
type ActivityChannelRow struct {
	Channel   string
	Users     int64
	Amount    float64
	ExtraDays int64
}

// ActivityCohortActivityRow 留存计算用的「用户 + 注册时间 + 活跃日」三元组。
type ActivityCohortActivityRow struct {
	UserID    uint64
	CreatedAt time.Time
	Day       string
}

// ActivityUserTotals 单个用户的全时段累计。
type ActivityUserTotals struct {
	ActiveDays int64
	Requests   int64
	Features   int64
	FirstDay   string
	LastDay    string
}

// DailyTrend 逐日活跃趋势（只返回有数据的天，缺的天由服务层补零）。
func (r *ActivityRepository) DailyTrend(ctx context.Context, from, to string) ([]ActivityTrendRow, error) {
	var rows []ActivityTrendRow
	err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("day, COUNT(DISTINCT user_id) AS active_users, COALESCE(SUM(request_count),0) AS requests, COALESCE(SUM(feature_count),0) AS features").
		Where("deleted_at IS NULL AND day >= ? AND day <= ?", from, to).
		Group("day").Order("day ASC").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// WindowActiveCounts 返回最近 7 天与最近 30 天的去重活跃用户数（WAU / MAU）。
func (r *ActivityRepository) WindowActiveCounts(ctx context.Context, wauFrom, mauFrom, to string) (int64, int64, error) {
	var row struct {
		WAU int64
		MAU int64
	}
	err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("COUNT(DISTINCT CASE WHEN day >= ? THEN user_id END) AS wau, COUNT(DISTINCT user_id) AS mau", wauFrom).
		Where("deleted_at IS NULL AND day >= ? AND day <= ?", mauFrom, to).
		Scan(&row).Error
	if err != nil {
		return 0, 0, response.ErrInternal.WithCause(err)
	}
	return row.WAU, row.MAU, nil
}

// DistinctActive 返回窗口内去重的活跃用户数。
func (r *ActivityRepository) DistinctActive(ctx context.Context, from, to string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("COUNT(DISTINCT user_id)").
		Where("deleted_at IS NULL AND day >= ? AND day <= ?", from, to).
		Scan(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// NewUserTimestamps 返回注册时间落在 [from, to) 内的用户注册时间。
//
// 之所以回传时间戳而不是在 SQL 里按天分组：created_at 是带时区的时间戳，
// 想按东八区切天就得写数据库方言相关的表达式（PostgreSQL 的
// timezone()/date_trunc 与测试用 SQLite 完全不同）。数据量很小
// （最多一个窗口的注册量），在 Go 里切天既准确又不依赖方言。
func (r *ActivityRepository) NewUserTimestamps(ctx context.Context, from, to time.Time) ([]time.Time, error) {
	var stamps []time.Time
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where("created_at >= ? AND created_at < ?", from, to).
		Pluck("created_at", &stamps).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return stamps, nil
}

// FrequencyHistogram 返回「窗口内活跃了 N 天的用户有多少个」。
func (r *ActivityRepository) FrequencyHistogram(ctx context.Context, from, to string) ([]ActivityFrequencyRow, error) {
	sub := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("user_id, COUNT(*) AS active_days").
		Where("deleted_at IS NULL AND day >= ? AND day <= ?", from, to).
		Group("user_id")

	var rows []ActivityFrequencyRow
	err := r.db.WithContext(ctx).Table("(?) AS t", sub).
		Select("active_days, COUNT(*) AS users").
		Group("active_days").Order("active_days ASC").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// activityUserAggregate 构造「用户 + 窗口内活跃汇总」的子查询。
//
// 每次调用都重新构造（而不是缓存 *gorm.DB）：GORM 的链式调用会修改
// 同一个 statement，复用同一个实例会让后续追加的条件互相污染。
func (r *ActivityRepository) activityUserAggregate(ctx context.Context, from, to, province string) *gorm.DB {
	return r.db.WithContext(ctx).Table("users AS u").
		Select(`u.id AS user_id, u.username, u.nickname, u.channel, u.created_at,
			u.last_active_at AS user_last_active_at,
			COUNT(a.id) AS active_days,
			COALESCE(SUM(a.request_count), 0) AS requests,
			COALESCE(SUM(a.feature_count), 0) AS features,
			COALESCE(MAX(a.day), '') AS last_day,
			COALESCE(MAX(NULLIF(a.province, '')), '') AS province,
			COALESCE(MAX(NULLIF(a.city, '')), '') AS city,
			COALESCE(MAX(NULLIF(a.ip, '')), '') AS last_ip,
			SUM(CASE WHEN a.province = ? THEN 1 ELSE 0 END) AS region_hits`, province).
		Joins("LEFT JOIN user_daily_activities a ON a.user_id = u.id AND a.deleted_at IS NULL AND a.day >= ? AND a.day <= ?", from, to).
		Where("u.deleted_at IS NULL").
		Group("u.id, u.username, u.nickname, u.channel, u.created_at, u.last_active_at")
}

// applyActivityUserFilters 给聚合结果套上筛选条件。count 与 list 两条查询
// 必须用完全一样的条件，否则总数和列表会对不上，所以抽成一个函数。
func applyActivityUserFilters(q *gorm.DB, f ActivityUserFilter) *gorm.DB {
	if f.UserID > 0 {
		q = q.Where("t.user_id = ?", f.UserID)
	}
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		like := "%" + kw + "%"
		q = q.Where("t.username LIKE ? OR t.nickname LIKE ?", like, like)
	}
	if f.ChannelSet {
		q = q.Where("t.channel = ?", f.Channel)
	}
	if p := strings.TrimSpace(f.Province); p != "" {
		q = q.Where("t.region_hits > 0")
	}
	if f.MinActiveDays > 0 {
		q = q.Where("t.active_days >= ?", f.MinActiveDays)
	}
	return q
}

// ListUserActivity 分页返回活跃用户列表（含窗口内没活跃过的用户，其计数为 0）。
func (r *ActivityRepository) ListUserActivity(ctx context.Context, f ActivityUserFilter) ([]ActivityUserStatRow, int64, error) {
	f.PageQuery.Normalize()

	countQ := applyActivityUserFilters(
		r.db.WithContext(ctx).Table("(?) AS t", r.activityUserAggregate(ctx, f.From, f.To, strings.TrimSpace(f.Province))), f)
	var total int64
	if err := countQ.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	if total == 0 {
		return nil, 0, nil
	}

	listQ := applyActivityUserFilters(
		r.db.WithContext(ctx).Table("(?) AS t", r.activityUserAggregate(ctx, f.From, f.To, strings.TrimSpace(f.Province))), f)
	var rows []ActivityUserStatRow
	err := listQ.Order(activityUserOrder(f.Sort)).
		Offset(f.PageQuery.Offset()).Limit(f.PageQuery.Limit()).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return rows, total, nil
}

// activityUserOrder 排序白名单。SQL 片段拼接一律走白名单，
// 绝不能让查询参数直接进 Order（那是注入面）。
func activityUserOrder(sort string) string {
	switch sort {
	case "requests":
		return "t.requests DESC, t.user_id ASC"
	case "features":
		return "t.features DESC, t.user_id ASC"
	case "last_active":
		return "t.last_day DESC, t.user_id ASC"
	case "newest":
		return "t.created_at DESC, t.user_id ASC"
	default:
		return "t.active_days DESC, t.requests DESC, t.user_id ASC"
	}
}

// RegionStats 地区（省 / 市）与运营商分布。
func (r *ActivityRepository) RegionStats(ctx context.Context, from, to string, limit int) (ActivityRegionStats, error) {
	out := ActivityRegionStats{
		Provinces: []ActivityRegionRow{},
		Cities:    []ActivityRegionRow{},
		ISPs:      []ActivityRegionRow{},
	}
	if limit <= 0 {
		limit = 20
	}

	if err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("country, province, '' AS city, '' AS isp, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(request_count),0) AS requests").
		Where("deleted_at IS NULL AND day >= ? AND day <= ? AND province <> ''", from, to).
		Group("country, province").Order("users DESC, province ASC").Limit(limit).
		Scan(&out.Provinces).Error; err != nil {
		return out, response.ErrInternal.WithCause(err)
	}

	if err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("country, province, city, '' AS isp, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(request_count),0) AS requests").
		Where("deleted_at IS NULL AND day >= ? AND day <= ? AND city <> ''", from, to).
		Group("country, province, city").Order("users DESC, province ASC, city ASC").Limit(limit).
		Scan(&out.Cities).Error; err != nil {
		return out, response.ErrInternal.WithCause(err)
	}

	if err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("'' AS country, '' AS province, '' AS city, isp, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(request_count),0) AS requests").
		Where("deleted_at IS NULL AND day >= ? AND day <= ? AND isp <> ''", from, to).
		Group("isp").Order("users DESC, isp ASC").Limit(limit).
		Scan(&out.ISPs).Error; err != nil {
		return out, response.ErrInternal.WithCause(err)
	}

	if err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("COUNT(DISTINCT user_id)").
		Where("deleted_at IS NULL AND day >= ? AND day <= ? AND province = ''", from, to).
		Scan(&out.UnknownUsers).Error; err != nil {
		return out, response.ErrInternal.WithCause(err)
	}
	return out, nil
}

// FeatureStats 功能使用排行（窗口内，按功能 + 来源分组）。
func (r *ActivityRepository) FeatureStats(ctx context.Context, from, to string, limit int) ([]ActivityFeatureRow, error) {
	if limit <= 0 {
		limit = 30
	}
	var rows []ActivityFeatureRow
	err := r.db.WithContext(ctx).Table("user_feature_daily").
		Select("feature, source, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(hits),0) AS count").
		Where("deleted_at IS NULL AND day >= ? AND day <= ?", from, to).
		Group("feature, source").Order("count DESC, feature ASC").Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// ChannelNewUsers 窗口内各渠道的注册用户数。
func (r *ActivityRepository) ChannelNewUsers(ctx context.Context, from, to time.Time) ([]ActivityChannelRow, error) {
	var rows []ActivityChannelRow
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Select("channel, COUNT(*) AS users").
		Where("created_at >= ? AND created_at < ?", from, to).
		Group("channel").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// ChannelTotalUsers 各渠道的累计注册用户数（全时段，用来算渠道活跃率）。
func (r *ActivityRepository) ChannelTotalUsers(ctx context.Context) ([]ActivityChannelRow, error) {
	var rows []ActivityChannelRow
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Select("channel, COUNT(*) AS users").
		Group("channel").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// ChannelActiveUsers 窗口内各渠道的活跃用户数。
func (r *ActivityRepository) ChannelActiveUsers(ctx context.Context, from, to string) ([]ActivityChannelRow, error) {
	var rows []ActivityChannelRow
	err := r.db.WithContext(ctx).Table("user_daily_activities AS a").
		Select("COALESCE(u.channel, '') AS channel, COUNT(DISTINCT a.user_id) AS users").
		Joins("JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL").
		Where("a.deleted_at IS NULL AND a.day >= ? AND a.day <= ?", from, to).
		Group("COALESCE(u.channel, '')").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// ChannelPaidUsers 窗口内各渠道的付费人数与金额（只算已支付订单）。
func (r *ActivityRepository) ChannelPaidUsers(ctx context.Context, from, to time.Time) ([]ActivityChannelRow, error) {
	var rows []ActivityChannelRow
	err := r.db.WithContext(ctx).Table("orders AS o").
		Select("COALESCE(u.channel, '') AS channel, COUNT(DISTINCT o.user_id) AS users, COALESCE(SUM(o.amount_paid), 0) AS amount").
		Joins("JOIN users u ON u.id = o.user_id AND u.deleted_at IS NULL").
		Where("o.deleted_at IS NULL AND o.payment_status = ? AND o.created_at >= ? AND o.created_at < ?",
			model.PaymentStatusPaid, from, to).
		Group("COALESCE(u.channel, '')").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// CohortActivity 返回窗口内注册的用户在窗口内的活跃日，用于算留存。
//
// 只取「注册在窗口内」的用户：留存的分母是新用户队列，
// 老用户没有队列归属，混进来会把留存率算虚高。
func (r *ActivityRepository) CohortActivity(ctx context.Context, cohortFrom, cohortTo time.Time, dayFrom, dayTo string) ([]ActivityCohortActivityRow, error) {
	var rows []ActivityCohortActivityRow
	err := r.db.WithContext(ctx).Table("user_daily_activities AS a").
		Select("a.user_id, u.created_at, a.day").
		Joins("JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL").
		Where("a.deleted_at IS NULL AND a.day >= ? AND a.day <= ?", dayFrom, dayTo).
		Where("u.created_at >= ? AND u.created_at < ?", cohortFrom, cohortTo).
		Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// UserDailyList 单个用户在窗口内的逐日明细。
func (r *ActivityRepository) UserDailyList(ctx context.Context, userID uint64, from, to string) ([]model.UserDailyActivity, error) {
	var rows []model.UserDailyActivity
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND day >= ? AND day <= ?", userID, from, to).
		Order("day ASC").Find(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// UserFeatureStats 单个用户在窗口内的功能使用明细。
func (r *ActivityRepository) UserFeatureStats(ctx context.Context, userID uint64, from, to string) ([]ActivityFeatureRow, error) {
	var rows []ActivityFeatureRow
	err := r.db.WithContext(ctx).Table("user_feature_daily").
		Select("feature, source, 1 AS users, COALESCE(SUM(hits),0) AS count").
		Where("deleted_at IS NULL AND user_id = ? AND day >= ? AND day <= ?", userID, from, to).
		Group("feature, source").Order("count DESC, feature ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// UserRegionStats 单个用户在窗口内出现过的地区。
func (r *ActivityRepository) UserRegionStats(ctx context.Context, userID uint64, from, to string) ([]ActivityRegionRow, error) {
	var rows []ActivityRegionRow
	err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("country, province, city, isp, COUNT(*) AS users, COALESCE(SUM(request_count),0) AS requests").
		Where("deleted_at IS NULL AND user_id = ? AND day >= ? AND day <= ? AND (province <> '' OR city <> '')", userID, from, to).
		Group("country, province, city, isp").Order("users DESC, province ASC, city ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return rows, nil
}

// UserTotals 单个用户的全时段累计（不限窗口）。
func (r *ActivityRepository) UserTotals(ctx context.Context, userID uint64) (ActivityUserTotals, error) {
	var row struct {
		ActiveDays int64
		Requests   int64
		Features   int64
		FirstDay   *string
		LastDay    *string
	}
	err := r.db.WithContext(ctx).Table("user_daily_activities").
		Select("COUNT(*) AS active_days, COALESCE(SUM(request_count),0) AS requests, COALESCE(SUM(feature_count),0) AS features, MIN(day) AS first_day, MAX(day) AS last_day").
		Where("deleted_at IS NULL AND user_id = ?", userID).
		Scan(&row).Error
	if err != nil {
		return ActivityUserTotals{}, response.ErrInternal.WithCause(err)
	}
	out := ActivityUserTotals{
		ActiveDays: row.ActiveDays,
		Requests:   row.Requests,
		Features:   row.Features,
	}
	if row.FirstDay != nil {
		out.FirstDay = *row.FirstDay
	}
	if row.LastDay != nil {
		out.LastDay = *row.LastDay
	}
	return out, nil
}

// CountUsersCreated 返回注册时间落在 [from, to) 内的用户数。
func (r *ActivityRepository) CountUsersCreated(ctx context.Context, from, to time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where("created_at >= ? AND created_at < ?", from, to).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}
