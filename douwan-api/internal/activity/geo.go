package activity

import (
	"log/slog"
	"net"
	"os"
	"strings"
	"sync"

	ip2region "github.com/lionsoul2014/ip2region/binding/golang/service"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/model"
)

// regionSearcher 是查询器的最小接口，方便测试替换。
// ip2region 的 Search 接受 string 或 []byte，这里只用到 string。
type regionSearcher interface {
	Search(ip any) (string, error)
}

// GeoResolver 把 IP 解析成省市与运营商。
//
// 用本地 ip2region 的 xdb 数据文件，不走任何在线接口：
// 一是省一次外部依赖与延迟，二是访客 IP 不该发给第三方。
//
// 它**永远不会让服务起不来**：数据文件缺失、格式不对、策略名写错，
// 都只是把地区维度降级成「未知」，采集与统计照常工作。
type GeoResolver struct {
	enabled  bool
	disabled string // 未启用的原因，供接口展示
	searcher regionSearcher
	closer   func()

	mu    sync.Mutex
	cache map[string]model.GeoRegion
	max   int
}

// NewGeoResolver 按配置构造解析器。任何失败都只降级，不返回错误。
func NewGeoResolver(cfg config.Activity) *GeoResolver {
	g := &GeoResolver{cache: map[string]model.GeoRegion{}, max: cfg.GeoCacheSize}
	if g.max <= 0 {
		g.max = 8192
	}
	if !cfg.GeoEnabled {
		g.disabled = "已关闭（activity.geo_enabled=false）"
		slog.Info("活跃监控：IP 归属地解析已关闭，地区维度将显示为未知")
		return g
	}

	policy, ok := resolveCachePolicy(cfg.GeoCachePolicy)
	if !ok {
		slog.Warn("活跃监控：geo_cache_policy 取值不受支持，回落到 content（全量内存）",
			"value", cfg.GeoCachePolicy, "supported", "buffer/content/buffercache、vector/vindex/vectorindex、none/file/nocache")
	}

	v4 := newXDBConfig(policy, cfg.GeoV4XDB, "v4")
	v6 := newXDBConfig(policy, cfg.GeoV6XDB, "v6")
	if v4 == nil && v6 == nil {
		g.disabled = "未找到 ip2region 数据文件"
		slog.Warn("活跃监控：没有可用的 ip2region 数据文件，地区维度将显示为未知",
			"geo_v4_xdb", cfg.GeoV4XDB, "geo_v6_xdb", cfg.GeoV6XDB)
		return g
	}

	svc, err := ip2region.NewIp2Region(v4, v6)
	if err != nil {
		g.disabled = "初始化失败：" + err.Error()
		slog.Error("活跃监控：IP 归属地查询器初始化失败，地区维度将显示为未知", "err", err)
		return g
	}
	g.enabled = true
	g.searcher = svc
	g.closer = svc.Close
	slog.Info("活跃监控：IP 归属地解析就绪", "v4", v4 != nil, "v6", v6 != nil, "policy", cfg.GeoCachePolicy)
	return g
}

// geoCachePolicyAlias 把我们对外文档里用的简写映射成 ip2region 认的策略名。
//
// ip2region 只认 file/nocache、vectorindex/vindex/vindexcache、content/buffercache，
// 而「buffer / vector / none」这套简写更好记，也更容易猜。两边都支持，
// 免得运营按文档写了 buffer，日志里天天报一条「取值不受支持」。
var geoCachePolicyAlias = map[string]string{
	"buffer": "buffercache",
	"vector": "vindex",
	"none":   "nocache",
}

// resolveCachePolicy 解析缓存策略，返回 (策略, 是否识别)。
// 空值按全量内存（buffer）处理：这是数据量（约 11MB）与查询延迟的最优解。
func resolveCachePolicy(name string) (int, bool) {
	key := strings.ToLower(strings.TrimSpace(name))
	if key == "" {
		return ip2region.BufferCache, true
	}
	if alias, ok := geoCachePolicyAlias[key]; ok {
		key = alias
	}
	policy, err := ip2region.CachePolicyFromName(key)
	if err != nil {
		return ip2region.BufferCache, false
	}
	return policy, true
}

// newGeoResolverWithSearcher 供测试注入假的查询器。
func newGeoResolverWithSearcher(s regionSearcher, max int) *GeoResolver {
	if max <= 0 {
		max = 16
	}
	return &GeoResolver{enabled: true, searcher: s, cache: map[string]model.GeoRegion{}, max: max}
}

// newXDBConfig 校验数据文件并构造查询配置。文件不存在时返回 nil（降级）。
func newXDBConfig(policy int, path, version string) *ip2region.Config {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	if _, err := os.Stat(path); err != nil {
		slog.Warn("活跃监控：ip2region 数据文件不可用，该协议族将不解析归属地",
			"version", version, "path", path, "err", err)
		return nil
	}
	cfg, err := func() (*ip2region.Config, error) {
		if version == "v6" {
			return ip2region.NewV6Config(policy, path, 1)
		}
		return ip2region.NewV4Config(policy, path, 1)
	}()
	if err != nil {
		slog.Error("活跃监控：加载 ip2region 数据文件失败", "version", version, "path", path, "err", err)
		return nil
	}
	return cfg
}

// Enabled 表示地区解析是否可用。
func (g *GeoResolver) Enabled() bool { return g != nil && g.enabled }

// DisabledReason 返回未启用的原因（启用了就是空串），供接口在 notes 里说明。
func (g *GeoResolver) DisabledReason() string {
	if g == nil {
		return "未配置"
	}
	return g.disabled
}

// Resolve 解析 IP。任何异常都返回零值（地区未知），不返回错误——
// 采集路径上不该因为一个 IP 解析不出来就丢掉整条活跃记录。
func (g *GeoResolver) Resolve(ipStr string) model.GeoRegion {
	if g == nil || !g.enabled {
		return model.GeoRegion{}
	}
	ipStr = strings.TrimSpace(ipStr)
	if ipStr == "" {
		return model.GeoRegion{}
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return model.GeoRegion{}
	}
	// 内网 / 回环地址：本地开发与服务器自检会走到这里。
	// 不把它算成某个省，但标出来，免得看到一片「未知」时无从判断。
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return model.GeoRegion{ISP: "内网"}
	}

	g.mu.Lock()
	if hit, ok := g.cache[ipStr]; ok {
		g.mu.Unlock()
		return hit
	}
	g.mu.Unlock()

	region := model.GeoRegion{}
	if raw, err := g.searcher.Search(ipStr); err == nil {
		region = parseRegion(raw)
	} else {
		slog.Debug("活跃监控：IP 归属地查询失败", "ip", MaskIP(ipStr), "err", err)
	}

	g.mu.Lock()
	// 缓存满了就整体丢弃重建：这是个纯加速用的缓存，
	// 不值得为它做 LRU（省下的复杂度换不来多少命中率）。
	if len(g.cache) >= g.max {
		g.cache = make(map[string]model.GeoRegion, g.max)
	}
	g.cache[ipStr] = region
	g.mu.Unlock()
	return region
}

// Close 释放查询器持有的文件句柄与内存。
func (g *GeoResolver) Close() {
	if g == nil || g.closer == nil {
		return
	}
	g.closer()
	g.closer = nil
}

// parseRegion 解析 ip2region 的返回串。
//
// 两种数据文件的字段布局不一样，混用会让整块地区统计错位（线上踩过）：
//
//	ip2region v2：国家|区域|省份|城市|ISP     区域是数字，国内为 0
//	              例：中国|0|广东省|深圳市|电信
//	ip2region v4：国家|省份|城市|ISP|国家代码
//	              例：中国|重庆市|重庆市|电信|CN ／ United States|California|0|Google LLC|US
//
// 仓库用的是 v4 文件，但这里仍然按「第 2 段是不是纯数字」自动识别：
// 万一换成旧文件，也不会把城市解析成运营商。
// 各级未知时库里写 "0"，统一转成空串，免得后台出现一堆 "0" 当地区名。
func parseRegion(raw string) model.GeoRegion {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return model.GeoRegion{}
	}
	parts := strings.Split(raw, "|")
	at := func(i int) string {
		if i < 0 || i >= len(parts) {
			return ""
		}
		v := strings.TrimSpace(parts[i])
		if v == "0" {
			return ""
		}
		return v
	}

	provinceIdx, cityIdx, ispIdx := 1, 2, 3 // v4 布局
	if len(parts) > 1 && isDigits(parts[1]) {
		provinceIdx, cityIdx, ispIdx = 2, 3, 4 // v2 布局（多一个「区域」字段）
	}
	region := model.GeoRegion{
		Country:  at(0),
		Province: at(provinceIdx),
		City:     at(cityIdx),
		ISP:      at(ispIdx),
		Raw:      raw,
	}
	// 省与市同名（直辖市）时只留一个，避免后台显示「北京市 北京市」
	if region.Province == region.City {
		region.City = ""
	}
	return region
}

// isDigits 判断整串是否都是数字。「区域」字段在老版数据里是 0~5 的数字。
func isDigits(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// MaskIP 把 IP 脱敏成「保留网段，隐藏主机位」的形式。
// 后台接口返回 IP 时一律走它，与用户列表里的邮箱 / 手机号同等对待。
func MaskIP(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return ""
	}
	if i := strings.LastIndex(ip, "."); i > 0 {
		return ip[:i] + ".*"
	}
	if i := strings.LastIndex(ip, ":"); i > 0 {
		return ip[:i] + ":*"
	}
	return "***"
}
