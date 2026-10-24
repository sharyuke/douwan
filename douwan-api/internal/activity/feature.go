// Package activity 负责用户活跃数据的采集：把前台请求归到「用户 × 天」，
// 累加到内存缓冲，再由后台协程批量落库，并顺带解析 IP 归属地。
//
// 三条设计约束：
//  1. **不能拖慢请求**。采样只做几次 map 累加，写库全部在后台协程里批量做；
//  2. **数据库故障不能拖垮服务**。落库失败就把增量放回缓冲，并且缓冲有上限，
//     超限丢弃并计数（宁可少算几个数，也不能把进程或数据库压死）；
//  3. **不伪造数据**。统计口径写进接口返回的 notes，做不到的维度（例如地区
//     数据文件缺失、IPv6 未收录）如实显示为「未知」，不猜。
package activity

import (
	"strings"

	"gitee.com/maryuke/douwan-api/internal/model"
)

// 路由 → 功能点的映射。
//
// 键是「方法 + 路由模板」（gin 的 FullPath()，形如 /api/v1/assets/:slug），
// 而不是真实 URL：真实 URL 里带主键，会让映射表退化成无穷多个键。
//
// 只有列在这里的路由才会被算作「功能使用」；没列的路由仍然计入请求次数。
// 后台接口（/api/v1/admin/**）与健康检查在 shouldTrack 里就被排除了，
// 不参与任何用户活跃统计。
//
// 注意：/api/v1/events 是客户端上报入口本身，不映射成功能点——它上报的
// 那些功能（pattern.generate 等）由 model.Feature* 常量定义，避免把
// 「上报动作」和「被上报的功能」混成一栏。
var routeFeatures = map[string]string{
	"POST /api/v1/auth/register":    model.FeatureAccountRegister,
	"POST /api/v1/auth/login":       model.FeatureAccountLogin,
	"POST /api/v1/auth/logout":      model.FeatureAccountLogout,
	"GET /api/v1/users/me":          model.FeatureAccountProfile,
	"PATCH /api/v1/users/me":        model.FeatureAccountProfileEdit,
	"GET /api/v1/permissions":       model.FeatureMembership,
	"GET /api/v1/plans":             model.FeaturePlanBrowse,
	"GET /api/v1/settings/public":   model.FeatureAppSettings,
	"GET /api/v1/assets":            model.FeatureAssetBrowse,
	"GET /api/v1/assets/categories": model.FeatureAssetBrowse,
	"GET /api/v1/assets/:slug":      model.FeatureAssetView,
	"POST /api/v1/card-keys/redeem": model.FeatureCardRedeem,
	"POST /api/v1/orders":           model.FeatureOrderCreate,
	"GET /api/v1/orders":            model.FeatureOrderList,
	"GET /api/v1/orders/:id":        model.FeatureOrderDetail,
	"GET /api/v1/my/entitlements":   model.FeatureEntitlement,
}

// FeatureForRoute 返回路由对应的功能点，空串表示该路由不计入功能统计。
func FeatureForRoute(method, fullPath string) string {
	if fullPath == "" {
		return ""
	}
	return routeFeatures[method+" "+fullPath]
}

// 不计入活跃统计的路径前缀。
var untrackedPrefixes = []string{
	"/api/v1/admin", // 后台自己的操作，不是用户活跃
	// 上报入口本身不计入请求次数与功能：它上报的那些事件会被单独累加
	//（而且同样会让该用户当天算作活跃），把「上报动作」再算一次就是重复计数。
	"/api/v1/events",
	// 页面访问上报同理：它自己就是「访问量」的来源，
	// 再算进用户活跃的请求次数会让「请求次数 ≈ 活跃用户翻页次数」。
	"/api/v1/visits",
	"/uploads", // 静态文件
	"/healthz",
	"/readyz",
	"/favicon.ico",
}

// shouldTrack 判断这次请求是否计入用户活跃。
//
// fullPath 为空说明没匹配到路由（404），直接跳过：
// 扫描器打过来的垃圾请求不该污染活跃数据。
func shouldTrack(_ string, fullPath string) bool {
	if fullPath == "" {
		return false
	}
	for _, prefix := range untrackedPrefixes {
		if fullPath == prefix || strings.HasPrefix(fullPath, prefix+"/") {
			return false
		}
	}
	return true
}
