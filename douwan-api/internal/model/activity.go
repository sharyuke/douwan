package model

import (
	"strings"
	"time"
)

/* ---------------------------------------------------------------- 活跃明细 */

// 活跃数据的来源。同一个功能点可能既有接口侧自动统计，也有客户端主动上报，
// 两边的口径不同（接口次数 vs 业务次数），所以分开存、分开展示，
// 不合并成一个「看起来更大」的数字。
const (
	ActivitySourceAPI    = "api"    // 服务端按接口请求自动统计
	ActivitySourceClient = "client" // 前端通过 POST /api/v1/events 上报
)

// ActivitySourceLabel 来源中文名。
func ActivitySourceLabel(s string) string {
	switch s {
	case ActivitySourceAPI:
		return "接口统计"
	case ActivitySourceClient:
		return "客户端上报"
	default:
		return s
	}
}

// ActivityLocation 是活跃数据里「天」的口径时区。
//
// 刻意用固定 +8 时区而不是 time.LoadLocation("Asia/Shanghai")：
// 后者的前提是运行环境装了 tzdata（精简镜像里常常没有），
// 一旦加载失败就会退化成 UTC，跨零点的统计会整体错一天。
// 中国大陆不实行夏令时，固定偏移是安全的。
var ActivityLocation = time.FixedZone("CST", 8*60*60)

// ActivityDay 把一个时刻换算成活跃数据的日期串（YYYY-MM-DD，东八区）。
// 库里 day 字段就是它，字符串在这里排序与比较都等同于日期。
func ActivityDay(t time.Time) string { return t.In(ActivityLocation).Format(ActivityDayLayout) }

// ActivityDayLayout 活跃日期串的格式。
const ActivityDayLayout = "2006-01-02"

// ParseActivityDay 解析活跃日期串，用于服务层算「最近 N 天」的窗口边界。
func ParseActivityDay(s string) (time.Time, bool) {
	t, err := time.ParseInLocation(ActivityDayLayout, strings.TrimSpace(s), ActivityLocation)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// UserDailyActivity 用户日活跃汇总：一个用户一天一行。
//
// 之所以按天汇总而不是存原始事件流水：这个模块要回答的是
// 「多少人、多频繁、在哪儿、用了什么」，日粒度足够，
// 而表体积只有流水表的几十分之一（qq 只有 2C/1.6G 的配置）。
// 需要按次追溯时应该另建事件表，而不是把这张表撑成流水表。
type UserDailyActivity struct {
	Base
	UserID uint64 `gorm:"uniqueIndex:uk_activity_daily_user_day;not null" json:"user_id"`
	// Day 是东八区的日期串（YYYY-MM-DD）。用字符串而不是 date 类型，
	// 是为了让 PostgreSQL 与测试用的 SQLite 行为一致（可直接比较、分组、排序）。
	Day string `gorm:"size:10;uniqueIndex:uk_activity_daily_user_day;index:idx_activity_daily_day;not null" json:"day"`

	FirstActiveAt time.Time `json:"first_active_at"`
	LastActiveAt  time.Time `json:"last_active_at"`

	// RequestCount 当天命中的前台接口次数（不含后台接口）。
	RequestCount int64 `gorm:"not null;default:0" json:"request_count"`
	// FeatureCount 当天产生的「功能使用」次数，含接口统计与客户端上报。
	FeatureCount int64 `gorm:"not null;default:0" json:"feature_count"`

	// 当天最后一次请求的 IP 与归属地。IP 只用于地区统计，接口对外一律脱敏。
	IP        string `gorm:"size:64" json:"ip"`
	Country   string `gorm:"size:64" json:"country"`
	Province  string `gorm:"size:64" json:"province"`
	City      string `gorm:"size:64" json:"city"`
	ISP       string `gorm:"size:64" json:"isp"`
	RegionRaw string `gorm:"size:128" json:"region_raw"`
}

// TableName 固定表名。GORM 默认会把 UserDailyActivity 复数化成
// user_daily_activities（正确），但 UserFeatureDaily 会变成 user_feature_dailies
// （dailies 这种复数很别扭），所以两张表都显式声明，避免依赖词形变化规则。
func (UserDailyActivity) TableName() string { return "user_daily_activities" }

// UserFeatureDaily 用户功能使用日汇总：一个用户一天一个功能一行。
//
// 单独一张表（而不是塞进 UserDailyActivity 的 JSON 列）是为了能用
// GROUP BY feature 直接算功能热度排行，也不用在数据库里解析 JSON。
type UserFeatureDaily struct {
	Base
	UserID  uint64 `gorm:"uniqueIndex:uk_activity_feature_user_day;not null" json:"user_id"`
	Day     string `gorm:"size:10;uniqueIndex:uk_activity_feature_user_day;index:idx_activity_feature_day;not null" json:"day"`
	Feature string `gorm:"size:48;uniqueIndex:uk_activity_feature_user_day;not null" json:"feature"`
	Source  string `gorm:"size:16;uniqueIndex:uk_activity_feature_user_day;not null" json:"source"`
	// Hits 是当天该功能的使用次数。列名刻意不叫 count：
	// 累计是通过 `hits = hits + EXCLUDED.hits` 这种原生表达式做的，
	// count 在部分数据库里是函数名，少一层引号的心智负担。
	Hits int64 `gorm:"column:hits;not null;default:0" json:"count"`
}

// TableName 固定表名，见 UserDailyActivity.TableName 的说明。
func (UserFeatureDaily) TableName() string { return "user_feature_daily" }

// GeoRegion 一次 IP 归属地解析的结果。
type GeoRegion struct {
	Country  string `json:"country"`
	Province string `json:"province"`
	City     string `json:"city"`
	ISP      string `json:"isp"`
	// Raw 是 ip2region 的原始串，保留下来便于核对。
	// 注意 v4 数据文件的布局是「国家|省份|城市|ISP|国家代码」，
	// 与 v2 的「国家|区域|省份|城市|ISP」不同，解析见 internal/activity/geo.go。
	Raw string `json:"raw"`
}

// IsEmpty 判断是否没解析出任何信息。
func (g GeoRegion) IsEmpty() bool {
	return g.Country == "" && g.Province == "" && g.City == "" && g.ISP == ""
}

// Label 地区展示名：优先「省 市」，其次国家，都没有则「未知」。
// 境外 IP 会带上国家前缀（「美国 · California」），否则一堆英文州名看不出是哪儿。
func (g GeoRegion) Label() string {
	place := g.place()
	if g.Country != "" && g.Country != "中国" {
		if place == "" {
			return g.Country
		}
		return g.Country + " · " + place
	}
	if place == "" {
		return "未知"
	}
	return place
}

func (g GeoRegion) place() string {
	switch {
	case g.Province != "" && g.City != "" && g.Province != g.City:
		return g.Province + " " + g.City
	case g.Province != "":
		return g.Province
	case g.City != "":
		return g.City
	default:
		return ""
	}
}

/* ------------------------------------------------------------------ 功能点 */

// 功能点标识。前半段是服务端能直接观测到的接口行为，
// 后半段（pattern.* / ai.*）只能由客户端上报——图纸生成、导出、抠图
// 都发生在浏览器里，服务端看不见。
const (
	FeatureAccountRegister    = "account.register"
	FeatureAccountLogin       = "account.login"
	FeatureAccountLogout      = "account.logout"
	FeatureAccountProfile     = "account.profile"
	FeatureAccountProfileEdit = "account.profile.update"

	FeatureAppOpen       = "app.open"
	FeatureAppSettings   = "app.settings"
	FeatureMembership    = "membership.permissions"
	FeaturePlanBrowse    = "plan.browse"
	FeatureAssetBrowse   = "asset.browse"
	FeatureAssetView     = "asset.view"
	FeatureCardRedeem    = "card.redeem"
	FeatureOrderCreate   = "order.create"
	FeatureOrderList     = "order.list"
	FeatureOrderDetail   = "order.detail"
	FeatureEntitlement   = "entitlement.view"
	FeatureEditorOpen    = "editor.open"
	FeaturePatternMake   = "pattern.generate"
	FeaturePatternExport = "pattern.export"
	FeaturePatternMatte  = "pattern.matte"
	FeaturePatternSave   = "pattern.save"
	FeatureInventory     = "inventory.manage"
	FeatureAIText        = "ai.text"
	FeatureAIVariants    = "ai.variants"
	FeatureAIBatch       = "ai.batch"
)

// FeatureInfo 一个功能点的定义。
type FeatureInfo struct {
	Key   string
	Label string
	// Client 表示允许客户端通过 POST /api/v1/events 上报。
	// 服务端自动统计的功能点不允许客户端上报，否则可以刷数据。
	Client bool
}

// activityFeatureCatalog 是功能点的唯一出处：接口映射、客户端上报白名单、
// 后台中文名都读这里，避免三处各写一份对不上。
var activityFeatureCatalog = []FeatureInfo{
	{Key: FeatureAppOpen, Label: "打开应用"},
	{Key: FeatureAccountRegister, Label: "注册账号"},
	{Key: FeatureAccountLogin, Label: "登录"},
	{Key: FeatureAccountLogout, Label: "退出登录"},
	{Key: FeatureAccountProfile, Label: "查看我的账户"},
	{Key: FeatureAccountProfileEdit, Label: "修改资料"},
	{Key: FeatureAppSettings, Label: "读取站点设置"},
	{Key: FeatureMembership, Label: "查看会员权益"},
	{Key: FeaturePlanBrowse, Label: "浏览套餐"},
	{Key: FeatureCardRedeem, Label: "卡密兑换"},
	{Key: FeatureOrderCreate, Label: "下单购买"},
	{Key: FeatureOrderList, Label: "查看订单列表"},
	{Key: FeatureOrderDetail, Label: "查看订单详情"},
	{Key: FeatureEntitlement, Label: "查看我的权益"},
	{Key: FeatureAssetBrowse, Label: "浏览素材库"},
	{Key: FeatureAssetView, Label: "查看素材详情"},
	// 以下只能由客户端上报（浏览器里发生的行为）
	{Key: FeatureEditorOpen, Label: "打开编辑器", Client: true},
	{Key: FeaturePatternMake, Label: "生成图纸", Client: true},
	{Key: FeaturePatternExport, Label: "导出图纸", Client: true},
	{Key: FeaturePatternMatte, Label: "自动抠图", Client: true},
	{Key: FeaturePatternSave, Label: "保存作品", Client: true},
	{Key: FeatureInventory, Label: "库存管理", Client: true},
	{Key: FeatureAIText, Label: "AI 文本出图", Client: true},
	{Key: FeatureAIVariants, Label: "AI 配色变体", Client: true},
	{Key: FeatureAIBatch, Label: "AI 批量出图", Client: true},
}

var (
	featureLabels = func() map[string]string {
		m := make(map[string]string, len(activityFeatureCatalog))
		for _, f := range activityFeatureCatalog {
			m[f.Key] = f.Label
		}
		return m
	}()
	clientFeatures = func() map[string]bool {
		m := make(map[string]bool)
		for _, f := range activityFeatureCatalog {
			if f.Client {
				m[f.Key] = true
			}
		}
		return m
	}()
)

// ActivityFeatureCatalog 返回功能点清单（只读用途，调用方不要修改切片元素）。
func ActivityFeatureCatalog() []FeatureInfo { return activityFeatureCatalog }

// FeatureLabel 功能点中文名。未收录的键原样返回，避免后台出现空白。
func FeatureLabel(key string) string {
	if label, ok := featureLabels[key]; ok {
		return label
	}
	return key
}

// IsActivityFeature 判断键是否在功能点清单里。
func IsActivityFeature(key string) bool {
	_, ok := featureLabels[key]
	return ok
}

// IsClientActivityFeature 判断键是否允许客户端上报。
func IsClientActivityFeature(key string) bool { return clientFeatures[key] }

/* -------------------------------------------------------------------- 渠道 */

// 来源渠道的保留值。
const (
	// ChannelUnknown 未知来源：历史用户，或者注册时没带任何来源信息。
	ChannelUnknown = ""
	// ChannelDirect 站内直接访问：从自己的域名进来的自然流量。
	ChannelDirect = "direct"
)

// NormalizeChannel 归一化来源渠道标识。
//
// 渠道是运营自己起的名字（gitee、weibo、friend、douyin ...），
// 所以只做「安全字符 + 长度」的收敛，不做白名单，否则新渠道会被静默丢弃。
func NormalizeChannel(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return ChannelUnknown
	}
	// 传成完整 URL 时取主机名，避免把整条链接塞进 32 字节的列里
	if i := strings.Index(raw, "//"); i >= 0 {
		raw = raw[i+2:]
	}
	if i := strings.IndexAny(raw, "/?#"); i >= 0 {
		raw = raw[:i]
	}
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		}
		if b.Len() >= 32 {
			break
		}
	}
	return strings.Trim(b.String(), ".-_")
}

// ChannelLabel 渠道中文名。
func ChannelLabel(ch string) string {
	switch ch {
	case ChannelUnknown:
		return "未知来源"
	case ChannelDirect:
		return "直接访问"
	default:
		return ch
	}
}
