package middleware

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// 后台鉴权在 gin.Context 里的键。
const (
	CtxAdmin     = "admin"
	CtxAdminID   = "admin_id"
	CtxAdminRole = "admin_role"
)

// AdminAuth 校验后台访问令牌。
//
// 与前台 Auth 的关键区别：这里**每个请求都查一次库**。
// 原因是管理员的停用、降权必须立即生效 —— 一个被撤销权限的运营
// 不能靠手上还没过期的令牌继续改套餐（需求 §3.3）。
func AdminAuth(tokens *auth.Manager, repos *repository.Repositories) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			response.Fail(c, response.ErrUnauthorized.WithMessage("请先登录后台"))
			return
		}
		claims, err := tokens.ParseAdminAccessToken(token)
		if err != nil {
			response.Fail(c, err)
			return
		}

		admin, err := repos.Admin.FindByID(c.Request.Context(), claims.AdminID)
		if err != nil || admin == nil {
			response.Fail(c, response.ErrTokenInvalid.WithMessage("管理员账号不存在，请重新登录"))
			return
		}
		if !admin.IsActive() {
			response.Fail(c, response.ErrAdminDisabled)
			return
		}

		c.Set(CtxAdmin, admin)
		c.Set(CtxAdminID, admin.ID)
		c.Set(CtxAdminRole, admin.Role)
		c.Next()
	}
}

// RequirePermission 要求当前管理员拥有某个权限点。
//
// 必须挂在 AdminAuth 之后。所有写操作接口都要挂上它：
// 前端隐藏按钮只是体验，服务端拦截才是权限（需求 §3.3）。
func RequirePermission(perm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		admin := CurrentAdmin(c)
		if admin == nil {
			response.Fail(c, response.ErrUnauthorized)
			return
		}
		if !admin.Can(perm) {
			response.Fail(c, response.ErrForbidden.WithMessage("当前角色没有该操作权限："+permLabel(perm)))
			return
		}
		c.Next()
	}
}

// RequireSuper 要求超级管理员。
func RequireSuper() gin.HandlerFunc {
	return func(c *gin.Context) {
		admin := CurrentAdmin(c)
		if admin == nil {
			response.Fail(c, response.ErrUnauthorized)
			return
		}
		if !admin.IsSuper() {
			response.Fail(c, response.ErrForbidden.WithMessage("该操作仅超级管理员可以执行"))
			return
		}
		c.Next()
	}
}

// CurrentAdmin 读取当前管理员。未登录返回 nil。
func CurrentAdmin(c *gin.Context) *model.Admin {
	if v, ok := c.Get(CtxAdmin); ok {
		if a, ok := v.(*model.Admin); ok {
			return a
		}
	}
	return nil
}

// CurrentAdminID 读取当前管理员 ID。未登录返回 0。
func CurrentAdminID(c *gin.Context) uint64 {
	if v, ok := c.Get(CtxAdminID); ok {
		if id, ok := v.(uint64); ok {
			return id
		}
	}
	return 0
}

// permLabel 把权限点转成中文，用于拒绝时的提示文案。
func permLabel(perm string) string {
	switch perm {
	case model.PermPlanManage:
		return "套餐管理"
	case model.PermCardView:
		return "查看卡密"
	case model.PermCardReveal:
		return "查看卡密明文"
	case model.PermCardGenerate:
		return "生成卡密"
	case model.PermCardExport:
		return "导出卡密"
	case model.PermCardRevoke:
		return "作废卡密"
	case model.PermOrderView:
		return "查看订单"
	case model.PermOrderSettle:
		return "确认收款与发卡"
	case model.PermOrderRefund:
		return "退款处理"
	case model.PermAssetView:
		return "查看素材"
	case model.PermAssetManage:
		return "素材管理"
	case model.PermUserView:
		return "查看用户"
	case model.PermEntitlementView:
		return "查看兑换记录"
	case model.PermEntitlementGive:
		return "发放权益"
	case model.PermSettingView:
		return "查看系统设置"
	case model.PermSettingManage:
		return "修改系统设置"
	case model.PermAdminManage:
		return "管理员管理"
	case model.PermLogView:
		return "查看操作日志"
	case model.PermOverviewView:
		return "查看数据概览"
	case model.PermActivityView:
		return "查看用户活跃监控"
	case model.PermLocalAIView:
		return "查看本地 AI 状态与任务"
	case model.PermLocalAIManage:
		return "操作本地 AI 任务"
	default:
		return perm
	}
}
