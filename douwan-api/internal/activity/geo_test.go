package activity

import (
	"errors"
	"testing"

	ip2region "github.com/lionsoul2014/ip2region/binding/golang/service"

	"gitee.com/maryuke/douwan-api/internal/model"
)

// fakeSearcher 是 regionSearcher 的测试替身。
type fakeSearcher struct {
	regions map[string]string
	err     error
	calls   int
}

func (f *fakeSearcher) Search(ip any) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	s, _ := ip.(string)
	return f.regions[s], nil
}

func TestParseRegion(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want model.GeoRegion
	}{
		// 下面是仓库里实际使用的 ip2region v4 数据文件的真实返回串
		// （v4 布局：国家|省份|城市|ISP|国家代码），字段顺序是从线上数据里核对过的
		{
			name: "v4 国内省市不同",
			raw:  "中国|江苏省|南京市|0|CN",
			want: model.GeoRegion{Country: "中国", Province: "江苏省", City: "南京市", Raw: "中国|江苏省|南京市|0|CN"},
		},
		{
			name: "v4 国内带运营商",
			raw:  "中国|重庆市|重庆市|电信|CN",
			want: model.GeoRegion{Country: "中国", Province: "重庆市", ISP: "电信", Raw: "中国|重庆市|重庆市|电信|CN"},
		},
		{
			name: "v4 境外：州是省份、城市可能缺失",
			raw:  "United States|California|0|Google LLC|US",
			want: model.GeoRegion{Country: "United States", Province: "California", ISP: "Google LLC", Raw: "United States|California|0|Google LLC|US"},
		},
		{
			name: "v4 直辖市省市同名时只保留省",
			raw:  "中国|北京市|北京市|联通|CN",
			want: model.GeoRegion{Country: "中国", Province: "北京市", ISP: "联通", Raw: "中国|北京市|北京市|联通|CN"},
		},
		// v2 布局多一个数字「区域」字段，自动识别后不能错位
		{
			name: "v2 布局（第二个字段是数字区域）",
			raw:  "中国|0|广东省|深圳市|电信",
			want: model.GeoRegion{Country: "中国", Province: "广东省", City: "深圳市", ISP: "电信", Raw: "中国|0|广东省|深圳市|电信"},
		},
		{
			name: "v2 境外占位全为 0",
			raw:  "美国|0|0|0|0",
			want: model.GeoRegion{Country: "美国", Raw: "美国|0|0|0|0"},
		},
		{
			name: "空串",
			raw:  "",
			want: model.GeoRegion{},
		},
		{
			name: "字段不足时不越界",
			raw:  "中国|0",
			want: model.GeoRegion{Country: "中国", Raw: "中国|0"},
		},
		{
			name: "只有一个国家名",
			raw:  "新加坡",
			want: model.GeoRegion{Country: "新加坡", Raw: "新加坡"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseRegion(tc.raw)
			if got != tc.want {
				t.Fatalf("parseRegion(%q) = %+v，期望 %+v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestGeoRegionLabel(t *testing.T) {
	cases := []struct {
		name   string
		region model.GeoRegion
		want   string
	}{
		{name: "省市都有", region: model.GeoRegion{Country: "中国", Province: "广东省", City: "深圳市"}, want: "广东省 深圳市"},
		{name: "只有省", region: model.GeoRegion{Country: "中国", Province: "重庆市"}, want: "重庆市"},
		{name: "境外带国家前缀", region: model.GeoRegion{Country: "United States", Province: "California"}, want: "United States · California"},
		{name: "境外只有国家", region: model.GeoRegion{Country: "United States"}, want: "United States"},
		{name: "什么都没有", region: model.GeoRegion{}, want: "未知"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.region.Label(); got != tc.want {
				t.Fatalf("Label() = %q，期望 %q", got, tc.want)
			}
		})
	}
}

func TestGeoResolverResolve(t *testing.T) {
	searcher := &fakeSearcher{regions: map[string]string{"203.0.113.7": "中国|0|浙江省|杭州市|移动"}}
	resolver := newGeoResolverWithSearcher(searcher, 8)

	got := resolver.Resolve("203.0.113.7")
	if got.Province != "浙江省" || got.City != "杭州市" {
		t.Fatalf("解析结果不对: %+v", got)
	}
	// 第二次应该命中缓存，不再查库
	if again := resolver.Resolve("203.0.113.7"); again != got {
		t.Fatalf("缓存命中结果不一致: %+v", again)
	}
	if searcher.calls != 1 {
		t.Fatalf("同一个 IP 查了 %d 次，期望 1 次（进程内缓存未生效）", searcher.calls)
	}

	// 内网 / 回环地址不查库，直接标成内网
	if private := resolver.Resolve("192.168.1.20"); private.ISP != "内网" {
		t.Fatalf("内网地址应标为内网: %+v", private)
	}
	if loopback := resolver.Resolve("127.0.0.1"); loopback.ISP != "内网" {
		t.Fatalf("回环地址应标为内网: %+v", loopback)
	}
	if searcher.calls != 1 {
		t.Fatalf("内网地址不该触发查询，实际查询 %d 次", searcher.calls)
	}
}

func TestGeoResolverHandlesBadInput(t *testing.T) {
	searcher := &fakeSearcher{err: errors.New("boom")}
	resolver := newGeoResolverWithSearcher(searcher, 2)

	if region := resolver.Resolve("not-an-ip"); !region.IsEmpty() {
		t.Fatalf("非法 IP 应该返回空地区: %+v", region)
	}
	if region := resolver.Resolve(""); !region.IsEmpty() {
		t.Fatalf("空 IP 应该返回空地区: %+v", region)
	}
	// 查询器报错时也不能 panic，只返回空地区
	if region := resolver.Resolve("203.0.113.8"); !region.IsEmpty() {
		t.Fatalf("查询失败应该返回空地区: %+v", region)
	}
}

func TestGeoResolverCacheBounded(t *testing.T) {
	searcher := &fakeSearcher{regions: map[string]string{
		"203.0.113.1": "中国|0|江苏省|南京市|电信",
		"203.0.113.2": "中国|0|江苏省|苏州市|电信",
		"203.0.113.3": "中国|0|江苏省|无锡市|电信",
	}}
	resolver := newGeoResolverWithSearcher(searcher, 2)
	for _, ip := range []string{"203.0.113.1", "203.0.113.2", "203.0.113.3"} {
		if region := resolver.Resolve(ip); region.IsEmpty() {
			t.Fatalf("%s 没解析出地区", ip)
		}
	}
	if len(resolver.cache) > 2 {
		t.Fatalf("缓存条数 %d 超过上限 2", len(resolver.cache))
	}
}

func TestGeoResolverDisabledReturnsEmpty(t *testing.T) {
	var resolver *GeoResolver
	if !resolver.Resolve("203.0.113.7").IsEmpty() {
		t.Fatal("未初始化的解析器应返回空地区")
	}
	if resolver.Enabled() {
		t.Fatal("nil 解析器不应报告可用")
	}
}

func TestResolveCachePolicy(t *testing.T) {
	cases := map[string]int{
		"":            ip2region.BufferCache,
		"buffer":      ip2region.BufferCache,
		"BufferCache": ip2region.BufferCache,
		"content":     ip2region.BufferCache,
		"vector":      ip2region.VIndexCache,
		"vindex":      ip2region.VIndexCache,
		"vectorindex": ip2region.VIndexCache,
		"none":        ip2region.NoCache,
		"file":        ip2region.NoCache,
		"nocache":     ip2region.NoCache,
		"  VECTOR  ":  ip2region.VIndexCache,
	}
	for name, want := range cases {
		got, ok := resolveCachePolicy(name)
		if !ok {
			t.Fatalf("resolveCachePolicy(%q) 应该被识别", name)
		}
		if got != want {
			t.Fatalf("resolveCachePolicy(%q) = %d，期望 %d", name, got, want)
		}
	}
	// 不认识的取值回落到全量内存，并告诉调用方「没识别」以便打日志
	got, ok := resolveCachePolicy("whatever")
	if ok || got != ip2region.BufferCache {
		t.Fatalf("未知策略应回落到 BufferCache 且返回 ok=false，实际 (%d, %v)", got, ok)
	}
}

func TestFeatureForRoute(t *testing.T) {
	cases := []struct {
		method, path, want string
	}{
		{"POST", "/api/v1/auth/login", model.FeatureAccountLogin},
		{"POST", "/api/v1/auth/register", model.FeatureAccountRegister},
		{"GET", "/api/v1/users/me", model.FeatureAccountProfile},
		{"PATCH", "/api/v1/users/me", model.FeatureAccountProfileEdit},
		{"GET", "/api/v1/assets/:slug", model.FeatureAssetView},
		{"POST", "/api/v1/card-keys/redeem", model.FeatureCardRedeem},
		// 方法不匹配就不算功能使用
		{"GET", "/api/v1/auth/login", ""},
		// 没收录的路由（例如后台接口）返回空串
		{"GET", "/api/v1/admin/activity/overview", ""},
		{"GET", "", ""},
	}
	for _, tc := range cases {
		if got := FeatureForRoute(tc.method, tc.path); got != tc.want {
			t.Fatalf("FeatureForRoute(%s, %s) = %q，期望 %q", tc.method, tc.path, got, tc.want)
		}
	}
}

func TestShouldTrack(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/api/v1/users/me", true},
		{"/api/v1/auth/login", true},
		{"/api/v1/orders/:id", true},
		// 后台接口不是用户活跃
		{"/api/v1/admin/activity/overview", false},
		{"/api/v1/admin", false},
		// 上报入口本身不计入（它上报的事件会单独累加，见 RecordClientFeature）
		{"/api/v1/events", false},
		{"/uploads/ab/cd.png", false},
		{"/healthz", false},
		{"/readyz", false},
		// 没匹配到路由（404）不统计
		{"", false},
	}
	for _, tc := range cases {
		if got := shouldTrack("GET", tc.path); got != tc.want {
			t.Fatalf("shouldTrack(%q) = %v，期望 %v", tc.path, got, tc.want)
		}
	}
}

func TestMaskIP(t *testing.T) {
	cases := map[string]string{
		"203.0.113.9":           "203.0.113.*",
		"240e:3b7:3272:d8d0::1": "240e:3b7:3272:d8d0::*",
		"":                      "",
	}
	for in, want := range cases {
		if got := MaskIP(in); got != want {
			t.Fatalf("MaskIP(%q) = %q，期望 %q", in, got, want)
		}
	}
}
