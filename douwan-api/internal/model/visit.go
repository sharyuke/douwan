package model

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"
)

/* ---------------------------------------------------------------- 访问量 */

// 站点访问量（PV / UV）与「用户活跃」是两件事，刻意分成两组表：
//
//   - 活跃统计的是**登录用户**（匿名访问混进来会让 DAU 失去意义，见 activity.go）；
//   - 访问量回答的是「站点被打开了多少次、多少人来过」，**未登录访客也算**，
//     否则「今天有多少人打开过首页」这个问题永远答不出来。
//
// 两个模块的数字不能互相加减：同一批人既是活跃用户也是访客，
// 但口径完全不同（一个按登录账号去重，一个按浏览器访客标识去重）。

// VisitorIDBytes 访客标识的随机字节数（16 字节 → 32 位十六进制）。
const VisitorIDBytes = 16

// VisitorPathMaxLength 页面路径的最大长度（与 SiteVisitorPageDaily.Path 的列宽一致）。
const VisitorPathMaxLength = 64

// VisitorUnknownPath 路径归一化失败时的兜底值。
// 不用空串：空串在后台会显示成一片空白，看不出「这些是被丢掉的异常上报」。
const VisitorUnknownPath = "/other"

// NewVisitorID 生成一个访客标识。
//
// 由服务端在客户端没带（或带得不像样）时兜底生成：纯随机、无语义、
// 不含任何设备信息。它的用途只有一个——在一段时间内把同一个浏览器的
// 多次页面访问串起来算一次 UV，**不是身份**（身份是登录后的 user_id）。
func NewVisitorID() string {
	buf := make([]byte, VisitorIDBytes)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand 失败的概率极低。这里宁可返回空串让调用方报错，
		// 也不用时间戳之类的弱随机兜底：那会把不同访客悄悄合并成同一个，
		// 属于「把统计口径改掉了却不告诉任何人」。
		return ""
	}
	return hex.EncodeToString(buf)
}

// IsVisitorID 判断是不是合法的访客标识（32 位小写十六进制）。
func IsVisitorID(s string) bool {
	if len(s) != VisitorIDBytes*2 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			continue
		}
		return false
	}
	return true
}

// MaskVisitor 脱敏访客标识：只留前 8 位。
//
// 后台不需要完整标识——它是用来串页面的，不是用来认人的。
// 与用户列表里的 IP 一样，接口只返回够排查用的那一截。
func MaskVisitor(v string) string {
	v = strings.TrimSpace(v)
	if len(v) <= 8 {
		return v
	}
	return v[:8] + "…"
}

// NormalizeVisitPath 归一化客户端上报的页面路径。
//
// 前端上报的是**路由模板**（`/library/:slug`）而不是真实 URL，
// 否则每个素材详情都会变成一行，页面排行会退化成「素材列表」。
// 即便这样也只信任一半：查询串 / 哈希一律砍掉，字符集收敛到
// `a-zA-Z0-9 - _ / : . ~ @`，长度截到 64，不合规的整条记到 `/other`——
// 让非法路径聚成一格，而不是把表撑成无穷多个键。
func NormalizeVisitPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	if raw == "" || raw[0] != '/' {
		return VisitorUnknownPath
	}
	var b strings.Builder
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '/', c == ':', c == '.', c == '~', c == '@':
			b.WriteByte(c)
		default:
			return VisitorUnknownPath
		}
		if b.Len() >= VisitorPathMaxLength {
			break
		}
	}
	out := b.String()
	for strings.Contains(out, "//") {
		out = strings.ReplaceAll(out, "//", "/")
	}
	if len(out) > 1 {
		// /editor/ 与 /editor 是同一个页面，去掉结尾多余的斜杠
		out = strings.TrimRight(out, "/")
	}
	if out == "" {
		return VisitorUnknownPath
	}
	return out
}

/* ------------------------------------------------------------------ 表 */

// SiteVisitor 一个访客一行：身份、首末次访问与累计量。
//
// 「访客」= 浏览器里生成、localStorage 持久化的一个随机 ID，
// 不是账号，也不是浏览器指纹：清空存储、换浏览器、无痕窗口都会算成新访客。
// 这个口径必须显式写在后台页面上，否则 UV 很容易被当成「人数」来读。
type SiteVisitor struct {
	Base
	Visitor string `gorm:"size:32;uniqueIndex:uk_site_visitor;not null" json:"visitor"`
	// UserID 是最近一次带登录态访问时的用户 ID；0 表示一直是匿名访客。
	UserID uint64 `gorm:"index:idx_site_visitor_user" json:"user_id"`

	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	// FirstDay / LastDay 是东八区日期串，口径与 user_daily_activities.day 一致。
	FirstDay string `gorm:"size:10;index:idx_site_visitor_first_day;not null" json:"first_day"`
	LastDay  string `gorm:"size:10;index:idx_site_visitor_last_day;not null" json:"last_day"`

	// PageViews 是该访客的累计访问量（全时段），落库时累加。
	PageViews int64 `gorm:"not null;default:0" json:"page_views"`

	// FirstPath 是首次访问落在哪个页面（只在插入时写入，之后不改），
	// 用来回答「新访客是从哪个页面进来的」；LastPath 跟着最近一次访问走。
	FirstPath string `gorm:"size:64" json:"first_path"`
	LastPath  string `gorm:"size:64" json:"last_path"`

	// 首触来源：第一次访问时的渠道，之后不再改写（与 users.channel 同一套规则）。
	Channel       string `gorm:"size:32;index:idx_site_visitor_channel" json:"channel"`
	ChannelDetail string `gorm:"size:128" json:"channel_detail"`

	// 最近一次访问的 IP 与归属地。IP 对外一律脱敏。
	IP        string `gorm:"size:64" json:"ip"`
	Country   string `gorm:"size:64" json:"country"`
	Province  string `gorm:"size:64" json:"province"`
	City      string `gorm:"size:64" json:"city"`
	ISP       string `gorm:"size:64" json:"isp"`
	RegionRaw string `gorm:"size:128" json:"region_raw"`
}

// TableName 固定表名（GORM 默认会给 SiteVisitor 单数化，显式声明更稳）。
func (SiteVisitor) TableName() string { return "site_visitors" }

// SiteVisitorPageDaily 访客 × 天 × 页面 一行。
//
// 这一张表同时承担两件事，也是「不偷偷多算」的关键：
//
//  1. PV：`pv` 累加，按天 / 按页面求和；
//  2. UV：行本身就是「这个访客这天访问过这个页面」的唯一记录，
//     `COUNT(DISTINCT visitor)` 就是去重访客数。去重交给唯一索引来做，
//     而不是在进程内存里记「我见过谁」——重启进程不会把老访客算成新访客。
//
// 表体积 ≈ 访客数 × 每人每天的页面数，是访问明细的最省形态（不是事件流水）。
type SiteVisitorPageDaily struct {
	Base
	Visitor string `gorm:"size:32;uniqueIndex:uk_site_visit_page;not null" json:"visitor"`
	Day     string `gorm:"size:10;uniqueIndex:uk_site_visit_page;index:idx_site_visit_page_day;not null" json:"day"`
	Path    string `gorm:"size:64;uniqueIndex:uk_site_visit_page;not null" json:"path"`

	// PV 是这天这个页面被该访客打开的次数。
	PV int64 `gorm:"column:pv;not null;default:0" json:"pv"`
	// UserID 记录这次访问有没有登录态；0 表示匿名。
	UserID uint64 `gorm:"index:idx_site_visit_page_user" json:"user_id"`

	// FirstAt / LastAt 是该访客这天在这个页面的首末次访问，
	// 用来把「当天落地页」还原出来（最早的 FirstAt 那一条）。
	FirstAt time.Time `json:"first_at"`
	LastAt  time.Time `json:"last_at"`
}

// TableName 固定表名。
func (SiteVisitorPageDaily) TableName() string { return "site_visitor_page_daily" }
