package dto

import (
	"time"

	"gitee.com/maryuke/douwan-api/internal/model"
)

/* -------------------------------------------------------------- 时间窗口 */

// 活跃统计的默认与最大窗口天数。
const (
	DefaultActivityDays = 30
	MaxActivityDays     = 90
	// EventBackfillDays 客户端埋点最多允许回补几天。
	EventBackfillDays = 7
)

// ActivityWindow 是一次查询的时间窗口。
//
// 用「最近 N 天」而不是让前端传任意起止日期：活跃数据的口径就是
// 「最近一段时间」，开放任意区间只会带来对不齐的图表和越界的慢查询。
type ActivityWindow struct {
	Days int    `json:"days"`
	From string `json:"from"`
	To   string `json:"to"`
}

// NewActivityWindow 按「最近 N 天（含今天）」构造窗口，并把 N 收进 [1, max]。
func NewActivityWindow(days, def, max int, now time.Time) ActivityWindow {
	if max <= 0 {
		max = MaxActivityDays
	}
	if def <= 0 {
		def = DefaultActivityDays
	}
	if days <= 0 {
		days = def
	}
	if days > max {
		days = max
	}
	to := model.ActivityDay(now)
	from := model.ActivityDay(now.AddDate(0, 0, -(days - 1)))
	return ActivityWindow{Days: days, From: from, To: to}
}

// DayList 返回窗口里的每一天（含首尾），用于把稀疏的查询结果补成连续的折线。
// 名字不叫 Days 是因为结构体已经有一个 Days 字段（窗口长度）。
func (w ActivityWindow) DayList() []string {
	start, ok := model.ParseActivityDay(w.From)
	if !ok {
		return nil
	}
	out := make([]string, 0, w.Days)
	for i := 0; i < w.Days; i++ {
		out = append(out, model.ActivityDay(start.AddDate(0, 0, i)))
	}
	return out
}

/* ------------------------------------------------------------------ 概览 */

// ActivityOverview 「用户活跃监控」首屏：核心指标卡 + 活跃 / 新增趋势。
type ActivityOverview struct {
	Enabled     bool              `json:"enabled"`
	Window      ActivityWindow    `json:"window"`
	Cards       ActivityCards     `json:"cards"`
	Trend       []ActivityTrend   `json:"trend"`
	Freshness   ActivityFreshness `json:"freshness"`
	Notes       []string          `json:"notes"`
	GeneratedAt time.Time         `json:"generated_at"`
}

// ActivityCards 核心指标卡。
type ActivityCards struct {
	// Day 是「今天」的口径日期（东八区）
	Day              string  `json:"day"`
	DAU              int64   `json:"dau"`
	DAUYesterday     int64   `json:"dau_yesterday"`
	DAUChangePercent float64 `json:"dau_change_percent"`
	WAU              int64   `json:"wau"`
	MAU              int64   `json:"mau"`
	// Stickiness 粘性 = DAU / MAU，衡量「月活里有多少天天来」
	Stickiness float64 `json:"stickiness"`
	// AvgDAU / PeakDAU 是窗口内的日均与峰值活跃
	AvgDAU      float64 `json:"avg_dau"`
	PeakDAU     int64   `json:"peak_dau"`
	PeakDAUDay  string  `json:"peak_dau_day"`
	ActiveUsers int64   `json:"active_users"` // 窗口内去重活跃用户
	NewUsers    int64   `json:"new_users"`    // 窗口内注册用户
	Requests    int64   `json:"requests"`
	Features    int64   `json:"features"`
	// TotalUsers 是全站累计注册用户，用于算活跃率
	TotalUsers int64   `json:"total_users"`
	ActiveRate float64 `json:"active_rate"` // MAU / TotalUsers
	TodayUsers int64   `json:"today_active_users"`
	TodayNew   int64   `json:"today_new_users"`
	TodayReq   int64   `json:"today_requests"`
	TodayFeat  int64   `json:"today_features"`
}

// ActivityTrend 趋势图上的一天。
type ActivityTrend struct {
	Day         string `json:"day"`
	ActiveUsers int64  `json:"active_users"`
	NewUsers    int64  `json:"new_users"`
	Requests    int64  `json:"requests"`
	Features    int64  `json:"features"`
}

// ActivityFreshness 采集新鲜度。活跃数据是异步落库的，
// 后台必须能看到「这批数字是几点落库的、还有多少在内存里」，
// 否则很容易把「刚上线还没采集」误读成「没人用」。
type ActivityFreshness struct {
	FlushIntervalSeconds int        `json:"flush_interval_seconds"`
	BufferedBuckets      int        `json:"buffered_buckets"`
	BufferedHits         int64      `json:"buffered_hits"`
	DroppedHits          int64      `json:"dropped_hits"`
	LastFlushAt          *time.Time `json:"last_flush_at"`
	LastError            string     `json:"last_error"`
	GeoEnabled           bool       `json:"geo_enabled"`
	GeoNote              string     `json:"geo_note"`
	// BufferedVisits / BufferedVisitors / DroppedVisits 是「访问量」（PV / UV）
	// 那一套缓冲的状态：与活跃共用同一个 Recorder 与 flush 周期，但计数分开报，
	// 否则「缓冲里还有多少没落库」在不同口径下会互相污染。
	BufferedVisits   int64 `json:"buffered_visits"`
	BufferedVisitors int   `json:"buffered_visitors"`
	DroppedVisits    int64 `json:"dropped_visits"`
}

/* ------------------------------------------------------------------ 留存 */

// ActivityRetention 新用户留存（按注册日形成队列）。
type ActivityRetention struct {
	Enabled bool                     `json:"enabled"`
	Window  ActivityWindow           `json:"window"`
	Cohorts []ActivityRetentionRow   `json:"cohorts"`
	Summary ActivityRetentionSummary `json:"summary"`
	Notes   []string                 `json:"notes"`
}

// ActivityRetentionRow 一个注册日队列的留存。
type ActivityRetentionRow struct {
	Day      string `json:"day"`
	NewUsers int64  `json:"new_users"`

	D1Users int64   `json:"d1_users"`
	D1Rate  float64 `json:"d1_rate"`
	D3Users int64   `json:"d3_users"`
	D3Rate  float64 `json:"d3_rate"`
	D7Users int64   `json:"d7_users"`
	D7Rate  float64 `json:"d7_rate"`

	// Eligible* 表示这个队列是否已经过完对应的天数。
	// 没到第 7 天就不该有 7 日留存——返回 eligible=false 让前端显示「—」，
	// 而不是拿一个虚低的数字当结论。
	D1Eligible bool `json:"d1_eligible"`
	D3Eligible bool `json:"d3_eligible"`
	D7Eligible bool `json:"d7_eligible"`
}

// ActivityRetentionSummary 窗口内所有队列的加权平均留存。
type ActivityRetentionSummary struct {
	// CohortUsers 是参与「1 日留存」加权的人数（分母）。
	// 3 日 / 7 日的分母不同（只有过完对应天数的队列才算），所以只用 D1 这一个字段表示分母。
	CohortUsers int64   `json:"cohort_users"`
	D1Users     int64   `json:"d1_users"`
	D1Rate      float64 `json:"d1_rate"`
	D3Users     int64   `json:"d3_users"`
	D3Rate      float64 `json:"d3_rate"`
	D7Users     int64   `json:"d7_users"`
	D7Rate      float64 `json:"d7_rate"`
	CohortCount int     `json:"cohort_count"`
	EligibleD1  int     `json:"eligible_d1"`
	EligibleD3  int     `json:"eligible_d3"`
	EligibleD7  int     `json:"eligible_d7"`
}

/* ------------------------------------------------------------ 使用频率 */

// ActivityFrequency 使用频率分布。
type ActivityFrequency struct {
	Window           ActivityWindow            `json:"window"`
	Buckets          []ActivityFrequencyBucket `json:"buckets"`
	ActiveUsers      int64                     `json:"active_users"`
	AvgActiveDays    float64                   `json:"avg_active_days"`
	MedianActiveDays float64                   `json:"median_active_days"`
	TopUsers         []ActivityUserItem        `json:"top_users"`
	Notes            []string                  `json:"notes"`
}

// ActivityFrequencyBucket 一个活跃天数区间的用户数。
type ActivityFrequencyBucket struct {
	Label   string  `json:"label"`
	MinDays int     `json:"min_days"`
	MaxDays int     `json:"max_days"`
	Users   int64   `json:"users"`
	Percent float64 `json:"percent"`
}

/* ---------------------------------------------------------------- 地区 */

// ActivityRegions 地区与运营商分布。
type ActivityRegions struct {
	Window       ActivityWindow       `json:"window"`
	Provinces    []ActivityRegionItem `json:"provinces"`
	Cities       []ActivityRegionItem `json:"cities"`
	ISPs         []ActivityRegionItem `json:"isps"`
	ActiveUsers  int64                `json:"active_users"`
	UnknownUsers int64                `json:"unknown_users"`
	GeoEnabled   bool                 `json:"geo_enabled"`
	Notes        []string             `json:"notes"`
}

// ActivityRegionItem 一条地区 / 运营商统计。
type ActivityRegionItem struct {
	Country  string  `json:"country"`
	Province string  `json:"province"`
	City     string  `json:"city"`
	ISP      string  `json:"isp"`
	Users    int64   `json:"users"`
	Requests int64   `json:"requests"`
	Percent  float64 `json:"percent"`
}

/* ---------------------------------------------------------------- 功能 */

// ActivityFeatures 功能使用排行。
type ActivityFeatures struct {
	Window ActivityWindow        `json:"window"`
	Items  []ActivityFeatureItem `json:"items"`
	Notes  []string              `json:"notes"`
}

// ActivityFeatureItem 一个功能（按来源拆分）的使用统计。
type ActivityFeatureItem struct {
	Feature      string  `json:"feature"`
	FeatureLabel string  `json:"feature_label"`
	Source       string  `json:"source"`
	SourceLabel  string  `json:"source_label"`
	Users        int64   `json:"users"`
	Count        int64   `json:"count"`
	Percent      float64 `json:"percent"`
}

/* ---------------------------------------------------------------- 渠道 */

// ActivityChannels 来源渠道分布与质量。
type ActivityChannels struct {
	Window        ActivityWindow        `json:"window"`
	Items         []ActivityChannelItem `json:"items"`
	TotalNewUsers int64                 `json:"total_new_users"`
	Notes         []string              `json:"notes"`
}

// ActivityChannelItem 一个渠道的统计。
type ActivityChannelItem struct {
	Channel      string `json:"channel"`
	ChannelLabel string `json:"channel_label"`
	// NewUsers 窗口内该渠道的新注册用户
	NewUsers int64 `json:"new_users"`
	// TotalUsers 该渠道累计注册用户（全时段），活跃率的分母
	TotalUsers int64 `json:"total_users"`
	// ActiveUsers 窗口内该渠道的活跃用户
	ActiveUsers int64 `json:"active_users"`
	// ActiveRate = ActiveUsers / TotalUsers，衡量渠道带来的用户是否留下来用
	ActiveRate float64 `json:"active_rate"`
	// PaidUsers / PaidAmount 窗口内该渠道已支付订单的人数与金额
	PaidUsers  int64   `json:"paid_users"`
	PaidAmount float64 `json:"paid_amount"`
}

/* ------------------------------------------------------------ 用户列表 */

// ActivityUserListQuery 活跃用户列表查询。
type ActivityUserListQuery struct {
	PageQuery
	Days    int    `form:"days"`
	Keyword string `form:"keyword"`
	// Channel 为空串时不筛选；想筛「未知来源」传 channel=unknown
	Channel string `form:"channel"`
	// HasChannel 由处理函数根据「有没有传 channel 参数」设置
	HasChannel bool   `form:"-"`
	Province   string `form:"province"`
	// MinActiveDays 最少活跃天数：传 1 就是「只看活跃过的用户」，
	// 不传则连窗口内没活跃过的沉默用户一起返回（活跃天数为 0）
	MinActiveDays int    `form:"min_active_days"`
	Sort          string `form:"sort"`
}

// ActivityUserItem 活跃用户列表项。
type ActivityUserItem struct {
	UserID       uint64     `json:"user_id"`
	Username     string     `json:"username"`
	Nickname     string     `json:"nickname"`
	Channel      string     `json:"channel"`
	ChannelLabel string     `json:"channel_label"`
	Province     string     `json:"province"`
	City         string     `json:"city"`
	Region       string     `json:"region"`
	CreatedAt    time.Time  `json:"created_at"`
	LastActiveAt *time.Time `json:"last_active_at"`
	ActiveDays   int64      `json:"active_days"`
	Requests     int64      `json:"requests"`
	Features     int64      `json:"features"`
	// LastIP 脱敏后的最近 IP（保留网段），只用于客服排查，
	// 与用户列表里的邮箱 / 手机号一样不返回完整值。
	LastIP string `json:"last_ip"`
}

// ActivityUserDetail 单个用户的活跃详情。
type ActivityUserDetail struct {
	Window         ActivityWindow        `json:"window"`
	User           ActivityUserItem      `json:"user"`
	ChannelDetail  string                `json:"channel_detail"`
	FirstActiveDay string                `json:"first_active_day"`
	LastActiveDay  string                `json:"last_active_day"`
	TotalActiveDay int64                 `json:"total_active_days"`
	TotalRequests  int64                 `json:"total_requests"`
	TotalFeatures  int64                 `json:"total_features"`
	Daily          []ActivityUserDay     `json:"daily"`
	Features       []ActivityFeatureItem `json:"features"`
	Regions        []ActivityRegionItem  `json:"regions"`
	Notes          []string              `json:"notes"`
}

// ActivityUserDay 单个用户某一天的活跃明细。
type ActivityUserDay struct {
	Day           string    `json:"day"`
	Requests      int64     `json:"requests"`
	Features      int64     `json:"features"`
	FirstActiveAt time.Time `json:"first_active_at"`
	LastActiveAt  time.Time `json:"last_active_at"`
	Province      string    `json:"province"`
	City          string    `json:"city"`
	ISP           string    `json:"isp"`
	IP            string    `json:"ip"`
}

/* ------------------------------------------------------------ 事件上报 */

// EventBatchRequest 客户端埋点批量上报。
type EventBatchRequest struct {
	Events []EventItem `json:"events" binding:"required,min=1,max=50,dive"`
}

// EventItem 一条埋点事件。
type EventItem struct {
	// Feature 必须是 model.ActivityFeatureCatalog 里 Client=true 的功能点，
	// 服务端自动统计的功能点不接受客户端上报（否则可以刷数据）。
	Feature string `json:"feature" binding:"required,max=48"`
	// Count 本次事件的重复次数，缺省 1；上限 100，一条请求最多贡献 5000 次
	Count int64 `json:"count" binding:"omitempty,min=1,max=100"`
	// At 事件发生时间，缺省为服务端当前时间；允许回补，但不超过 EventBackfillDays 天
	At *time.Time `json:"at"`
}

// EventBatchResult 上报结果。
type EventBatchResult struct {
	Enabled  bool     `json:"enabled"`
	Accepted int      `json:"accepted"`
	Hits     int64    `json:"hits"`
	Dropped  int      `json:"dropped"`
	Rejected []string `json:"rejected"`
	Message  string   `json:"message"`
}
