// Package dto 存放 HTTP 层的请求与响应结构，是接口契约的唯一出处。
package dto

import (
	"strings"
	"time"
)

/* ------------------------------------------------------------------ 分页 */

// 分页默认值与上限。上限存在的意义是防止 page_size=100000 这种查询把库拖垮。
const (
	DefaultPage     = 1
	DefaultPageSize = 20
	MaxPageSize     = 200
)

// PageQuery 是所有列表接口共用的分页参数。
type PageQuery struct {
	Page     int `form:"page" json:"page"`
	PageSize int `form:"page_size" json:"page_size"`
}

// Normalize 修正非法分页参数，返回可直接用于 offset/limit 的值。
func (q *PageQuery) Normalize() {
	if q.Page <= 0 {
		q.Page = DefaultPage
	}
	if q.PageSize <= 0 {
		q.PageSize = DefaultPageSize
	}
	if q.PageSize > MaxPageSize {
		q.PageSize = MaxPageSize
	}
}

// Offset 计算 SQL OFFSET。
func (q PageQuery) Offset() int { return (q.Page - 1) * q.PageSize }

// Limit 计算 SQL LIMIT。
func (q PageQuery) Limit() int { return q.PageSize }

// PageResult 是列表接口统一返回结构。
type PageResult[T any] struct {
	List     []T   `json:"list"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}

// NewPageResult 组装分页返回。list 为 nil 时返回空数组而不是 null，
// 免得前端每次都要判空（需求 §4「没有数据时显示友好空状态，不报错」）。
func NewPageResult[T any](list []T, total int64, q PageQuery) PageResult[T] {
	if list == nil {
		list = []T{}
	}
	return PageResult[T]{List: list, Total: total, Page: q.Page, PageSize: q.PageSize}
}

// Trim 去掉字符串首尾空白，避免「名称带空格」这种脏数据进库。
func Trim(s string) string { return strings.TrimSpace(s) }

/* ------------------------------------------------------------------ 后台鉴权 */

// AdminLoginRequest 后台登录。account 可以是用户名。
type AdminLoginRequest struct {
	Account  string `json:"account" binding:"required,max=64"`
	Password string `json:"password" binding:"required,max=64"`
}

// AdminRefreshRequest 刷新后台令牌。
type AdminRefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// AdminLogoutRequest 退出登录。
type AdminLogoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// AdminChangePasswordRequest 修改自己的密码。
type AdminChangePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=10,max=64"`
}

// AdminCreateRequest 新建管理员（只有超级管理员可用）。
type AdminCreateRequest struct {
	Username string `json:"username" binding:"required,min=3,max=32,alphanum"`
	Password string `json:"password" binding:"required,min=10,max=64"`
	Nickname string `json:"nickname" binding:"omitempty,max=32"`
	Role     string `json:"role" binding:"required,oneof=super_admin operator viewer"`
	Remark   string `json:"remark" binding:"omitempty,max=255"`
}

// AdminUpdateRequest 修改管理员。指针字段用于区分「不改」与「改成空」。
type AdminUpdateRequest struct {
	Nickname *string `json:"nickname" binding:"omitempty,max=32"`
	Remark   *string `json:"remark" binding:"omitempty,max=255"`
	Role     *string `json:"role" binding:"omitempty,oneof=super_admin operator viewer"`
}

// AdminResetPasswordRequest 重置某个管理员的密码。
type AdminResetPasswordRequest struct {
	NewPassword string `json:"new_password" binding:"required,min=10,max=64"`
}

// AdminStatusRequest 启用 / 停用管理员。
type AdminStatusRequest struct {
	Status int8   `json:"status" binding:"oneof=0 1"`
	Reason string `json:"reason" binding:"omitempty,max=255"`
}

// AdminProfile 后台管理员资料。密码哈希永远不出现在响应里。
//
// 时间字段统一用 time.Time：与既有 dto.UserProfile 保持一致，
// 前端拿到的是带时区的 RFC3339 串，由前端按约定时区渲染（需求 §13.11）。
type AdminProfile struct {
	ID          uint64     `json:"id"`
	Username    string     `json:"username"`
	Nickname    string     `json:"nickname"`
	Role        string     `json:"role"`
	RoleLabel   string     `json:"role_label"`
	Status      int8       `json:"status"`
	Remark      string     `json:"remark"`
	LastLoginAt *time.Time `json:"last_login_at"`
	LastLoginIP string     `json:"last_login_ip"`
	Permissions []string   `json:"permissions"`
	CreatedAt   time.Time  `json:"created_at"`
	IsSuper     bool       `json:"is_super"`
}

// AdminAuthResult 后台登录 / 刷新的统一返回。
type AdminAuthResult struct {
	Admin  AdminProfile `json:"admin"`
	Tokens TokenPair    `json:"tokens"`
}

// AdminListQuery 管理员列表查询。
type AdminListQuery struct {
	PageQuery
	Keyword string `form:"keyword"`
	Role    string `form:"role"`
	Status  *int8  `form:"status"`
}

/* ------------------------------------------------------------------ 系统设置 */

// SettingItem 单个设置项。secret 类型的值只返回脱敏串。
type SettingItem struct {
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	HasValue    bool      `json:"has_value"`
	Group       string    `json:"group"`
	GroupLabel  string    `json:"group_label"`
	Label       string    `json:"label"`
	Type        string    `json:"type"`
	Public      bool      `json:"public"`
	Secret      bool      `json:"secret"`
	Description string    `json:"description"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// SettingUpdateRequest 批量修改设置。
type SettingUpdateRequest struct {
	Items []SettingItemInput `json:"items" binding:"required,min=1,dive"`
}

// SettingItemInput 单个设置项的写入值。
type SettingItemInput struct {
	Key   string `json:"key" binding:"required,max=64"`
	Value string `json:"value" binding:"max=2000"`
}

/* ------------------------------------------------------------------ 操作日志 */

// OperationLogQuery 日志列表查询。
type OperationLogQuery struct {
	PageQuery
	Keyword    string `form:"keyword"`
	Action     string `form:"action"`
	Result     string `form:"result"`
	AdminID    uint64 `form:"admin_id"`
	TargetType string `form:"target_type"`
}

// OperationLogItem 日志返回项。
type OperationLogItem struct {
	ID         uint64    `json:"id"`
	AdminID    uint64    `json:"admin_id"`
	AdminName  string    `json:"admin_name"`
	AdminRole  string    `json:"admin_role"`
	Action     string    `json:"action"`
	ActionText string    `json:"action_text"`
	TargetType string    `json:"target_type"`
	TargetID   string    `json:"target_id"`
	TargetName string    `json:"target_name"`
	Result     string    `json:"result"`
	ResultText string    `json:"result_text"`
	Details    string    `json:"details"`
	IP         string    `json:"ip"`
	CreatedAt  time.Time `json:"created_at"`
}
