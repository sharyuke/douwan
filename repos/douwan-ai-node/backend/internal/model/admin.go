package model

import "time"

// 管理员角色。MVP 只需要两类，但结构上留出扩展位：
// 新增角色时只加常量与 permissions 判定，不用改表结构。
const (
	AdminRoleSuper   = "super_admin" // 超级管理员：全部权限
	AdminRoleSupport = "operator"    // 运营管理员：素材 / 订单 / 兑换记录，不能改安全设置
	AdminRoleViewer  = "viewer"      // 只读账号（预留，接口已按角色校验）
)

// 管理员账号状态，与 model.User 保持一致。
const (
	AdminStatusDisabled int8 = 0
	AdminStatusActive   int8 = 1
)

// Admin 后台管理员。
//
// 与 model.User 分开建表，原因有两条：
//  1. 后台不允许公开注册，首个管理员必须由命令行初始化；
//  2. 管理员与前台用户是两套完全不同的信任级别，混在一张表里一旦判错
//     就是「普通用户直接进后台」，分开管理更容易审计。
type Admin struct {
	Base
	Username     string     `gorm:"size:64;uniqueIndex;not null" json:"username"`
	PasswordHash string     `gorm:"size:128;not null" json:"-"`
	Nickname     string     `gorm:"size:64" json:"nickname"`
	Role         string     `gorm:"size:32;not null;default:'super_admin';index" json:"role"`
	Status       int8       `gorm:"not null;default:1" json:"status"`
	Remark       string     `gorm:"size:255" json:"remark"`
	LastLoginAt  *time.Time `json:"last_login_at"`
	LastLoginIP  string     `gorm:"size:64" json:"last_login_ip"`
}

// IsActive 判断管理员是否可用。
func (a *Admin) IsActive() bool { return a.Status == AdminStatusActive }

// IsSuper 是否超级管理员。
func (a *Admin) IsSuper() bool { return a.Role == AdminRoleSuper }

/* ------------------------------------------------------------------ 权限点 */

// 权限点常量。服务端按角色判定，前端只用它决定按钮是否可点，
// 绝不能只靠前端隐藏按钮来保护接口（需求 §3.3 / §13.12）。
const (
	PermPlanManage      = "plan.manage"       // 套餐增删改与上下架
	PermCardView        = "card.view"         // 查看卡密列表
	PermCardReveal      = "card.reveal"       // 查看 / 复制卡密明文
	PermCardGenerate    = "card.generate"     // 生成卡密
	PermCardExport      = "card.export"       // 导出卡密 CSV
	PermCardRevoke      = "card.revoke"       // 作废卡密
	PermOrderView       = "order.view"        // 查看订单
	PermOrderSettle     = "order.settle"      // 人工确认收款并发卡
	PermOrderRefund     = "order.refund"      // 退款处理（真实支付接入后才可用）
	PermAssetView       = "asset.view"        // 查看素材
	PermAssetManage     = "asset.manage"      // 上传 / 编辑 / 上下架素材与分类
	PermUserView        = "user.view"         // 查看用户
	PermEntitlementView = "entitlement.view"  // 查看兑换记录与权益
	PermEntitlementGive = "entitlement.grant" // 手动发放 / 撤销权益
	PermSettingView     = "setting.view"      // 查看系统设置
	PermSettingManage   = "setting.manage"    // 修改系统设置（含支付、密钥类配置）
	PermAdminManage     = "admin.manage"      // 管理管理员账号
	PermLogView         = "log.view"          // 查看操作日志
	PermOverviewView    = "overview.view"     // 查看数据概览
	PermActivityView    = "activity.view"     // 查看用户活跃数据监控
	PermLocalAIView     = "localai.view"      // 查看本地 AI 节点状态与任务列表
	PermLocalAIManage   = "localai.manage"    // 操作本地 AI（取消任务、清理产物）
)

// permissionOrder 是「全部权限点」的唯一清单，同时决定后台展示顺序。
//
// 它必须是各角色权限矩阵的**并集**：service.PermissionList 返回给前端的
// permissions = 「本清单 ∩ 该角色权限」。漏一个的后果是「接口能用、页面进不去」——
// 前端路由守卫看不到这个权限点，会直接跳 /admin/forbidden（activity.view 踩过）。
// TestPermissionOrderMatchesRoleMatrix 会盯着这件事。
var permissionOrder = []string{
	PermPlanManage, PermCardView, PermCardReveal, PermCardGenerate,
	PermCardExport, PermCardRevoke, PermOrderView, PermOrderSettle,
	PermOrderRefund, PermAssetView, PermAssetManage, PermUserView,
	PermEntitlementView, PermEntitlementGive, PermSettingView,
	PermSettingManage, PermAdminManage, PermLogView, PermOverviewView,
	PermActivityView,
	PermLocalAIView, PermLocalAIManage,
}

// PermissionOrder 返回全部权限点（拷贝，调用方改不动内部清单）。
func PermissionOrder() []string {
	out := make([]string, len(permissionOrder))
	copy(out, permissionOrder)
	return out
}

// rolePermissions 是角色 → 权限点矩阵。运营管理员不能碰支付密钥、
// 系统安全设置，也不能管理管理员账号。
var rolePermissions = map[string]map[string]bool{
	AdminRoleSuper: nil, // nil 表示全部权限
	AdminRoleSupport: {
		PermPlanManage:      true,
		PermCardView:        true,
		PermOrderView:       true,
		PermOrderSettle:     true,
		PermAssetView:       true,
		PermAssetManage:     true,
		PermUserView:        true,
		PermEntitlementView: true,
		PermSettingView:     true,
		PermLogView:         true,
		PermOverviewView:    true,
		PermActivityView:    true,
		PermLocalAIView:     true,
		PermLocalAIManage:   true,
	},
	AdminRoleViewer: {
		PermCardView:        true,
		PermOrderView:       true,
		PermAssetView:       true,
		PermUserView:        true,
		PermEntitlementView: true,
		PermSettingView:     true,
		PermLogView:         true,
		PermOverviewView:    true,
		PermActivityView:    true,
		PermLocalAIView:     true,
	},
}

// Can 判断管理员是否拥有某个权限点。
func (a *Admin) Can(perm string) bool {
	if a == nil || !a.IsActive() {
		return false
	}
	perms, ok := rolePermissions[a.Role]
	if !ok {
		return false
	}
	if perms == nil {
		return true // 超级管理员
	}
	return perms[perm]
}

// CanRole 判断某个角色名是否拥有权限，供不需要加载实体时使用。
func CanRole(role, perm string) bool {
	perms, ok := rolePermissions[role]
	if !ok {
		return false
	}
	if perms == nil {
		return true
	}
	return perms[perm]
}

// RoleLabel 把角色转成后台界面用的中文名。
func RoleLabel(role string) string {
	switch role {
	case AdminRoleSuper:
		return "超级管理员"
	case AdminRoleSupport:
		return "运营管理员"
	case AdminRoleViewer:
		return "只读账号"
	default:
		return role
	}
}

// ValidAdminRole 校验角色是否受支持。
func ValidAdminRole(role string) bool {
	_, ok := rolePermissions[role]
	return ok
}
