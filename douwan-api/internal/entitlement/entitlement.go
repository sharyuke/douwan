// Package entitlement 定义豆玩的功能权益矩阵。
//
// 这里的内容必须与前台 pindoudou/src/composables/useMembership.js 的
// ENTITLEMENTS / DENY_REASON 保持一致：
//   - 后台给套餐配置功能权限时，可选项来自 BuiltinPermissions；
//   - 兑换 / 发卡后返回给前台的权限矩阵，也是这份默认值叠加套餐配置的结果。
//
// 为什么放在服务端而不是只留前端：需求 §13.12 要求「后端负责验证套餐权限与
// AI 功能权限，不能依赖前端按钮是否显示」。所以权威定义在这里，前端那份
// 只作为离线兜底（没有登录时也能给出合理的免费版权限）。
package entitlement

// 功能权益键。取值与前端 ENTITLEMENTS 的键完全一致，改名要先改前台。
const (
	FeatureGenerateBasic     = "generate.basic"
	FeatureGenerateNormal    = "generate.normal"
	FeatureGenerateVariants  = "generate.variants"
	FeatureCanvasCells       = "canvas.cells"
	FeatureOptimize          = "optimize.buildability"
	FeaturePaletteFull       = "palette.full"
	FeatureInventoryUse      = "inventory.use"
	FeatureExportPNG         = "export.png"
	FeatureExportSVG         = "export.svg"
	FeatureExportCSV         = "export.csv"
	FeatureExportPDF         = "export.pdf"
	FeatureExportJSON        = "export.json"
	FeatureExportShare       = "export.share"
	FeatureBuildMode         = "build.mode"
	FeatureProjectsLimit     = "projects.limit"
	FeatureAssetsPro         = "assets.pro"
	FeatureBatchExport       = "batch.export"
	FeatureLicenseCommercial = "license.commercial"
)

// Feature 描述一个可配置的功能权限点，供后台渲染多选项。
type Feature struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Hint  string `json:"hint"`
	// ValueType 告诉后台该填什么：boolean 是开关，number 是上限值
	ValueType string `json:"value_type"`
}

// Features 是后台可以给套餐勾选的全部功能权限点。
func Features() []Feature {
	return []Feature{
		{FeatureGenerateBasic, "基础图片生成", "上传图片生成本地图纸", "boolean"},
		{FeatureGenerateNormal, "标准生成", "常规尺寸图纸生成", "boolean"},
		{FeatureGenerateVariants, "多方案自动搜索", "填数字表示一次给几个方案", "number"},
		{FeatureCanvasCells, "最大画布（格）", "单边最大格数，填数字（52 格 = 一块 52 钉板）", "number"},
		{FeatureOptimize, "可拼性优化", "去孤立豆 / 抖动 / 换色合并", "boolean"},
		{FeaturePaletteFull, "全部品牌色板", "全部品牌色号（当前 1823 个色号）", "boolean"},
		{FeatureInventoryUse, "库存约束配色", "只用用户手里已有的豆", "boolean"},
		{FeatureExportPNG, "PNG 导出", "", "boolean"},
		{FeatureExportSVG, "SVG 矢量导出", "", "boolean"},
		{FeatureExportCSV, "材料清单 CSV", "", "boolean"},
		{FeatureExportPDF, "PDF 分板图纸 / 1:1 打印", "", "boolean"},
		{FeatureExportJSON, "JSON 导出", "", "boolean"},
		{FeatureExportShare, "分享卡导出", "", "boolean"},
		{FeatureBuildMode, "Build Mode 拼制进度", "", "boolean"},
		{FeatureProjectsLimit, "作品存档上限", "填数字，0 表示不限", "number"},
		{FeatureAssetsPro, "会员专属素材", "可用 tier=pro 的素材", "boolean"},
		{FeatureBatchExport, "批量生成 / 导出", "", "boolean"},
		{FeatureLicenseCommercial, "商用授权", "", "boolean"},
	}
}

// DenyReasons 是「为什么不能用」的中文说明。
// 前台权限不足时要给出原因与升级路径，而不是让按钮凭空消失（需求 §14）。
var DenyReasons = map[string]string{
	FeatureGenerateVariants:  "自动搜索并对比多个方案是会员功能。",
	FeatureCanvasCells:       "超过当前套餐允许的画布格数是会员功能。",
	FeatureOptimize:          "可拼性优化（去孤立豆 / 抖动 / 换色合并）是会员功能。",
	FeaturePaletteFull:       "全部品牌色板是会员功能。",
	FeatureInventoryUse:      "「只用我的豆」库存约束配色是会员功能。",
	FeatureExportSVG:         "SVG 矢量导出是会员功能。",
	FeatureExportCSV:         "材料清单 CSV 是会员功能。",
	FeatureExportPDF:         "PDF 分板图纸与 1:1 打印是会员功能。",
	FeatureExportShare:       "分享卡导出是会员功能。",
	FeatureBuildMode:         "Build Mode 拼制进度是会员功能。",
	FeatureAssetsPro:         "这是会员专属素材，升级后可直接使用。",
	FeatureBatchExport:       "批量生成 / 导出属于更高级的套餐，当前尚未开放。",
	FeatureLicenseCommercial: "商用授权属于更高级的套餐，当前尚未开放。",
}

// FreeMatrix 是免费套餐的功能矩阵。
//
// 与前端保持一致的取值：多方案数量 1、最大画布 52 格（一块 52 钉板）、
// 色板不裁剪（免费版可用漫德 MARD 每个套装的全部色号，详见前台 useMembership 的注释）。
var FreeMatrix = map[string]any{
	FeatureGenerateBasic:     true,
	FeatureGenerateNormal:    true,
	FeatureGenerateVariants:  1,
	FeatureCanvasCells:       52,
	FeatureOptimize:          false,
	FeaturePaletteFull:       false,
	FeatureInventoryUse:      false,
	FeatureExportPNG:         true,
	FeatureExportSVG:         false,
	FeatureExportCSV:         false,
	FeatureExportPDF:         false,
	FeatureExportJSON:        true,
	FeatureExportShare:       false,
	FeatureBuildMode:         false,
	FeatureProjectsLimit:     3,
	FeatureAssetsPro:         false,
	FeatureBatchExport:       false,
	FeatureLicenseCommercial: false,
}

// Merge 用套餐配置覆盖免费矩阵，得到最终的权限表。
//
// 注意语义：**只有配置里显式出现的键才会被覆盖**。
// 这样管理员不必把十几个功能全部勾一遍，没配置的功能沿用免费版口径。
func Merge(overrides map[string]any) map[string]any {
	out := make(map[string]any, len(FreeMatrix)+len(overrides))
	for k, v := range FreeMatrix {
		out[k] = v
	}
	for k, v := range overrides {
		if v == nil {
			continue
		}
		out[k] = v
	}
	return out
}

// Allow 判断某个功能在给定权限矩阵下是否可用（布尔类）。
// 缺失的键按 freeMatrix 处理；非布尔值表示「有额度」，也视为可用。
func Allow(matrix map[string]any, feature string) bool {
	merged := matrix
	if merged == nil {
		merged = FreeMatrix
	}
	v, ok := merged[feature]
	if !ok {
		v = FreeMatrix[feature]
	}
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t > 0
	case int:
		return t > 0
	case int64:
		return t > 0
	case nil:
		return false
	default:
		return true
	}
}

// Label 返回功能点的中文名。
func Label(key string) string {
	for _, f := range Features() {
		if f.Key == key {
			return f.Label
		}
	}
	return key
}
