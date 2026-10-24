package dto

import "time"

/* ------------------------------------------------------------ 访问量上报 */

// VisitReportRequest 是一次页面访问上报（前台接口，未登录也允许）。
//
// 为什么是客户端上报：pindoudou 是 hash 路由的 SPA，首页之后的所有页面切换
// 都不产生 HTTP 请求，服务端看不见「翻到了哪一页」。所以路径由前端给出，
// 但**只作为弱信任输入**：服务层会重新归一化（砍查询串、收敛字符集、
// 非法值归到 /other），并且路径只能是路由模板而不是完整 URL。
type VisitReportRequest struct {
	// Visitor 是浏览器本地生成并持久化的 32 位十六进制访客标识。
	//
	// 这里**只限长度、不校验格式**：客户端可能是旧版本，标识也可能被写坏。
	// 格式不对时由服务层换成一个新标识并回传，而不是让整次上报失败——
	// 宁可多算一个新访客，也不要因为一个坏字段把访问量整段丢掉。
	Visitor string `json:"visitor" binding:"omitempty,max=64"`
	// Path 是路由模板（/library/:slug）；不合法会被归一化成 /other。
	Path string `json:"path" binding:"required,max=128"`
	// Referrer 是来源页地址，留空时服务端会退回请求头的 Referer。
	Referrer string `json:"referrer" binding:"omitempty,max=512"`
	// Channel 是落地页上带过来的渠道标识（?from= / ?utm_source=），优先级最高。
	Channel string `json:"channel" binding:"omitempty,max=64"`
	// At 是页面打开时间，缺省为服务端当前时间；允许小幅回补（离线补报）。
	At *time.Time `json:"at"`
}

// VisitReportResult 上报结果。message 用来如实说明「收了但没算」的原因。
type VisitReportResult struct {
	Enabled bool `json:"enabled"`
	// Accepted 为 false 表示这次上报没有被计入（去抖命中 / 缓冲已满 / 采集关闭）。
	Accepted bool   `json:"accepted"`
	Visitor  string `json:"visitor"`
	Path     string `json:"path"`
	Message  string `json:"message"`
}

/* -------------------------------------------------------------- 访问量页 */

// ActivityTraffic 「访问量」标签页：PV / UV 指标卡 + 趋势 + 页面排行 + 来源。
type ActivityTraffic struct {
	Enabled     bool                    `json:"enabled"`
	Window      ActivityWindow          `json:"window"`
	Cards       ActivityTrafficCards    `json:"cards"`
	Trend       []ActivityTrafficTrend  `json:"trend"`
	Pages       []ActivityPageItem      `json:"pages"`
	Landings    []ActivityLandingItem   `json:"landings"`
	Sources     []ActivityTrafficSource `json:"sources"`
	Freshness   ActivityFreshness       `json:"freshness"`
	Notes       []string                `json:"notes"`
	GeneratedAt time.Time               `json:"generated_at"`
}

// ActivityTrafficCards 访问量指标卡。
type ActivityTrafficCards struct {
	// Day 是「今天」的口径日期（东八区）
	Day string `json:"day"`
	// PV / UV 是窗口内的访问量与去重访客数
	PV         int64   `json:"pv"`
	UV         int64   `json:"uv"`
	PVPerUV    float64 `json:"pv_per_uv"`
	AvgDailyPV float64 `json:"avg_daily_pv"`
	// AvgDailyUV 是「逐日 UV 的平均值」，不等于窗口 UV（同一人可能来好几天）
	AvgDailyUV float64 `json:"avg_daily_uv"`
	PeakUV     int64   `json:"peak_uv"`
	PeakUVDay  string  `json:"peak_uv_day"`

	NewVisitors       int64 `json:"new_visitors"`
	ReturningVisitors int64 `json:"returning_visitors"`
	// Logged/AnonymousVisitors 按「窗口内有没有带登录态访问过」划分，两者相加等于 UV
	LoggedVisitors    int64 `json:"logged_visitors"`
	AnonymousVisitors int64 `json:"anonymous_visitors"`

	TodayPV     int64 `json:"today_pv"`
	TodayUV     int64 `json:"today_uv"`
	TodayNew    int64 `json:"today_new_visitors"`
	YesterdayPV int64 `json:"yesterday_pv"`
	// PVChangePercent 是今天对昨天的环比；昨天为 0 时返回 0（不制造假增长）
	PVChangePercent float64 `json:"pv_change_percent"`

	// TotalVisitors / TotalPV 是全时段累计（不受窗口影响），放在卡片里便于看增长曲线
	TotalVisitors int64 `json:"total_visitors"`
	TotalPV       int64 `json:"total_pv"`
}

// ActivityTrafficTrend 趋势图上的一天。
type ActivityTrafficTrend struct {
	Day         string `json:"day"`
	PV          int64  `json:"pv"`
	UV          int64  `json:"uv"`
	NewVisitors int64  `json:"new_visitors"`
}

// ActivityPageItem 一个页面（路由模板）的访问量。
type ActivityPageItem struct {
	Path string `json:"path"`
	PV   int64  `json:"pv"`
	// Visitors 是该页面在窗口内的去重访客数
	Visitors int64 `json:"visitors"`
	// PVPerVisitor 人均访问次数 = PV / Visitors，用来区分「很多人各看一眼」与「少数人反复用」
	PVPerVisitor float64 `json:"pv_per_visitor"`
	// Percent 是 PV 占比（分母是窗口内全部 PV）
	Percent float64 `json:"percent"`
}

// ActivityLandingItem 新访客的落地页。
//
// 只有访客数没有 PV：落地页的定义是「第一次落在哪」，
// 一个访客只有一个落地页，给 PV 反而会让人以为落地页也能被访问多次。
type ActivityLandingItem struct {
	Path     string  `json:"path"`
	Visitors int64   `json:"visitors"`
	Percent  float64 `json:"percent"`
}

// ActivityTrafficSource 一个首触渠道在窗口内的访问情况。
type ActivityTrafficSource struct {
	Channel      string  `json:"channel"`
	ChannelLabel string  `json:"channel_label"`
	Visitors     int64   `json:"visitors"`
	PV           int64   `json:"pv"`
	Percent      float64 `json:"percent"`
}

/* ------------------------------------------------------------ 访客列表 */

// ActivityVisitorListQuery 访客列表查询。
type ActivityVisitorListQuery struct {
	PageQuery
	Days int `form:"days"`
	// Channel 为空串时不筛选；想筛「未知来源」传 channel=unknown
	Channel string `form:"channel"`
	// HasChannel 由处理函数根据「有没有传 channel 参数」设置
	HasChannel bool `form:"-"`
	// Path 只看访问过某个页面的访客
	Path string `form:"path"`
	// Sort 支持 page_views（默认）/ last_seen / first_seen
	Sort string `form:"sort"`
}

// ActivityVisitorItem 访客列表项。
type ActivityVisitorItem struct {
	// Visitor 是脱敏后的访客标识（前 8 位），完整值不出接口
	Visitor string `json:"visitor"`
	// UserID 为 0 表示这个访客在窗口内一直是匿名的
	UserID   uint64 `json:"user_id"`
	Username string `json:"username"`
	// Anonymous 让前端不必自己判断 user_id 是否为 0
	Anonymous bool `json:"anonymous"`

	FirstDay string `json:"first_day"`
	LastDay  string `json:"last_day"`
	// PageViews 是累计访问量（全时段，不是窗口内的），列名上要写清
	PageViews  int64     `json:"page_views"`
	LastSeenAt time.Time `json:"last_seen_at"`

	FirstPath string `json:"first_path"`
	LastPath  string `json:"last_path"`

	Channel      string `json:"channel"`
	ChannelLabel string `json:"channel_label"`

	Province string `json:"province"`
	City     string `json:"city"`
	Region   string `json:"region"`
	ISP      string `json:"isp"`
	// IP 是脱敏后的最近 IP
	IP string `json:"ip"`
}
