// Package service 是业务层：编排仓储、鉴权与事务，返回业务错误。
package service

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// 操作日志的动作常量。写成常量是为了让日志筛选下拉里的值是稳定的，
// 不会因为某处手写字符串拼错而统计不到（需求 §11）。
const (
	ActionAdminLogin     = "admin.login"
	ActionAdminLogout    = "admin.logout"
	ActionAdminLoginFail = "admin.login_fail"
	ActionAdminCreate    = "admin.create"
	ActionAdminUpdate    = "admin.update"
	ActionAdminResetPwd  = "admin.reset_password"
	ActionAdminStatus    = "admin.status"
	ActionAdminChangePwd = "admin.change_password"
	ActionAdminDelete    = "admin.delete"

	ActionPlanCreate    = "plan.create"
	ActionPlanUpdate    = "plan.update"
	ActionPlanStatus    = "plan.status"
	ActionPlanDelete    = "plan.delete"
	ActionPlanDuplicate = "plan.duplicate"
	ActionPlanSeed      = "plan.seed_draft"

	ActionCardGenerate   = "card.generate"
	ActionCardExport     = "card.export"
	ActionCardReveal     = "card.reveal"
	ActionCardVoid       = "card.void"
	ActionCardRedeem     = "card.redeem"
	ActionCardRedeemFail = "card.redeem_fail"

	ActionOrderCreate = "order.create"
	ActionOrderSettle = "order.settle"
	ActionOrderIssue  = "order.issue_cards"
	ActionOrderClose  = "order.close"
	ActionOrderRefund = "order.refund"

	ActionAssetUpload    = "asset.upload"
	ActionAssetUpdate    = "asset.update"
	ActionAssetStatus    = "asset.status"
	ActionAssetDelete    = "asset.delete"
	ActionAssetSort      = "asset.sort"
	ActionCategoryCreate = "category.create"
	ActionCategoryUpdate = "category.update"
	ActionCategoryDelete = "category.delete"

	ActionEntitlementGrant  = "entitlement.grant"
	ActionEntitlementRevoke = "entitlement.revoke"

	ActionSettingUpdate = "setting.update"
)

// 日志动作的中文名。缺省时直接显示原始动作字符串。
var actionTexts = map[string]string{
	ActionAdminLogin:     "管理员登录成功",
	ActionAdminLogout:    "管理员退出登录",
	ActionAdminLoginFail: "管理员登录失败",
	ActionAdminCreate:    "新建管理员",
	ActionAdminUpdate:    "修改管理员",
	ActionAdminResetPwd:  "重置管理员密码",
	ActionAdminStatus:    "启用/停用管理员",
	ActionAdminChangePwd: "修改自己的密码",
	ActionAdminDelete:    "删除管理员",

	ActionPlanCreate:    "新建套餐",
	ActionPlanUpdate:    "编辑套餐",
	ActionPlanStatus:    "套餐上下架",
	ActionPlanDelete:    "删除套餐",
	ActionPlanDuplicate: "复制套餐",
	ActionPlanSeed:      "初始化草稿套餐",

	ActionCardGenerate:   "生成卡密",
	ActionCardExport:     "导出卡密",
	ActionCardReveal:     "查看卡密明文",
	ActionCardVoid:       "作废卡密",
	ActionCardRedeem:     "卡密兑换成功",
	ActionCardRedeemFail: "卡密兑换失败",

	ActionOrderCreate: "创建订单",
	ActionOrderSettle: "人工确认收款",
	ActionOrderIssue:  "发放卡密",
	ActionOrderClose:  "关闭订单",
	ActionOrderRefund: "标记退款",

	ActionAssetUpload:    "上传素材",
	ActionAssetUpdate:    "编辑素材",
	ActionAssetStatus:    "素材上下架",
	ActionAssetDelete:    "删除/归档素材",
	ActionAssetSort:      "调整素材排序",
	ActionCategoryCreate: "新建素材分类",
	ActionCategoryUpdate: "编辑素材分类",
	ActionCategoryDelete: "删除素材分类",

	ActionEntitlementGrant:  "发放用户权益",
	ActionEntitlementRevoke: "撤销用户权益",

	ActionSettingUpdate: "修改系统设置",
}

// ActionText 返回动作的中文名。
func ActionText(action string) string {
	if text, ok := actionTexts[action]; ok {
		return text
	}
	return action
}

// ActionOptions 返回全部动作选项，供后台筛选下拉使用。
func ActionOptions() []map[string]string {
	out := make([]map[string]string, 0, len(actionTexts))
	for _, action := range sortedActions() {
		out = append(out, map[string]string{"value": action, "label": actionTexts[action]})
	}
	return out
}

func sortedActions() []string {
	order := []string{
		ActionAdminLogin, ActionAdminLoginFail, ActionAdminLogout, ActionAdminCreate,
		ActionAdminUpdate, ActionAdminResetPwd, ActionAdminStatus, ActionAdminChangePwd, ActionAdminDelete,
		ActionPlanCreate, ActionPlanUpdate, ActionPlanStatus, ActionPlanDelete,
		ActionPlanDuplicate, ActionPlanSeed,
		ActionCardGenerate, ActionCardExport, ActionCardReveal, ActionCardVoid,
		ActionCardRedeem, ActionCardRedeemFail,
		ActionOrderCreate, ActionOrderSettle, ActionOrderIssue, ActionOrderClose, ActionOrderRefund,
		ActionAssetUpload, ActionAssetUpdate, ActionAssetStatus, ActionAssetDelete, ActionAssetSort,
		ActionCategoryCreate, ActionCategoryUpdate, ActionCategoryDelete,
		ActionEntitlementGrant, ActionEntitlementRevoke, ActionSettingUpdate,
	}
	return order
}

// Audit 描述「谁做了什么」。由 handler 从请求上下文里组装后传给 Service。
//
// 放在 service 包而不是 handler 包里，是为了让 Service 在事务内写日志时
// 不依赖 gin.Context，便于单元测试直接构造。
type Audit struct {
	AdminID   uint64
	AdminName string
	AdminRole string
	IP        string
	UserAgent string
	RequestID string
}

// AuditFromContext 从 gin 上下文里取出审计信息。
func AuditFromContext(c *gin.Context) Audit {
	admin := middleware.CurrentAdmin(c)
	a := Audit{
		IP:        middleware.ClientIP(c),
		UserAgent: c.GetHeader("User-Agent"),
		RequestID: response.RequestID(c),
	}
	if admin != nil {
		a.AdminID = admin.ID
		a.AdminName = admin.Username
		if admin.Nickname != "" {
			a.AdminName = admin.Nickname
		}
		a.AdminRole = admin.Role
	}
	return a
}

// AuditLog 是写日志的入口。
//
// 日志写失败只打 warn，不影响业务结果：素材已经传上去了，
// 因为日志表写不进去就报错回滚，对运营来说更难接受（需求 §11 要求记录，
// 但没要求「日志必须成功才能继续」）。
type AuditLog struct{}

// NewAuditLog 构造日志记录器。
func NewAuditLog() *AuditLog { return &AuditLog{} }

// Write 写一条操作日志。
func (l *AuditLog) Write(ctx context.Context, repos *repository.Repositories, a Audit, action, targetType, targetID, targetName, details string) {
	if repos == nil {
		return
	}
	entry := &model.OperationLog{
		AdminID:    a.AdminID,
		AdminName:  a.AdminName,
		AdminRole:  a.AdminRole,
		Action:     action,
		ActionText: ActionText(action),
		TargetType: targetType,
		TargetID:   targetID,
		TargetName: targetName,
		Result:     model.LogResultSuccess,
		Details:    truncate(details, 1000),
		IP:         a.IP,
		UserAgent:  truncate(a.UserAgent, 255),
		RequestID:  a.RequestID,
	}
	if err := repos.Log.Create(ctx, entry); err != nil {
		slog.WarnContext(ctx, "写操作日志失败", "action", action, "err", err)
	}
}

// WriteFail 写一条失败日志。
func (l *AuditLog) WriteFail(ctx context.Context, repos *repository.Repositories, a Audit, action, targetType, targetID, targetName, details string) {
	if repos == nil {
		return
	}
	entry := &model.OperationLog{
		AdminID:    a.AdminID,
		AdminName:  a.AdminName,
		AdminRole:  a.AdminRole,
		Action:     action,
		ActionText: ActionText(action),
		TargetType: targetType,
		TargetID:   targetID,
		TargetName: targetName,
		Result:     model.LogResultFail,
		Details:    truncate(details, 1000),
		IP:         a.IP,
		UserAgent:  truncate(a.UserAgent, 255),
		RequestID:  a.RequestID,
	}
	if err := repos.Log.Create(ctx, entry); err != nil {
		slog.WarnContext(ctx, "写操作日志失败", "action", action, "err", err)
	}
}

// truncate 按字符数截断，避免把超长文本写进日志表。
func truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}

// jsonValue 把带 serializer:json 的字段转成 JSON 文本，供 Updates(map) 使用。
//
// 为什么必须这样写：GORM 的序列化器只在 Create / Updates(结构体) 路径生效，
// 走 map[string]any 时会被当成普通参数直接丢给 database/sql，
// 结果是 "unsupported type model.BenefitConfig, a struct" 这种运行期错误。
// 集中成一个函数是为了不把这个坑散落到每个 Update 里。
func jsonValue(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(raw)
}
