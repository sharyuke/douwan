package handler

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// ActivityHandler 后台「用户活跃数据监控」。
type ActivityHandler struct {
	svc *service.ActivityService
}

// NewActivityHandler 构造处理函数集合。
func NewActivityHandler(svc *service.ActivityService) *ActivityHandler {
	return &ActivityHandler{svc: svc}
}

// Overview GET /api/v1/admin/activity/overview?days=30
func (h *ActivityHandler) Overview(c *gin.Context) {
	result, err := h.svc.Overview(c.Request.Context(), queryInt(c, "days"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Retention GET /api/v1/admin/activity/retention?days=30
func (h *ActivityHandler) Retention(c *gin.Context) {
	result, err := h.svc.Retention(c.Request.Context(), queryInt(c, "days"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Frequency GET /api/v1/admin/activity/frequency?days=30
func (h *ActivityHandler) Frequency(c *gin.Context) {
	result, err := h.svc.Frequency(c.Request.Context(), queryInt(c, "days"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Regions GET /api/v1/admin/activity/regions?days=30&limit=20
func (h *ActivityHandler) Regions(c *gin.Context) {
	result, err := h.svc.Regions(c.Request.Context(), queryInt(c, "days"), queryInt(c, "limit"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Features GET /api/v1/admin/activity/features?days=30&limit=30
func (h *ActivityHandler) Features(c *gin.Context) {
	result, err := h.svc.Features(c.Request.Context(), queryInt(c, "days"), queryInt(c, "limit"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Channels GET /api/v1/admin/activity/channels?days=30
func (h *ActivityHandler) Channels(c *gin.Context) {
	result, err := h.svc.Channels(c.Request.Context(), queryInt(c, "days"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Users GET /api/v1/admin/activity/users
//
// 想只看活跃用户传 min_active_days=1；不传会把窗口内零活跃的沉默用户
// 也带出来（活跃天数为 0），方便排查「注册了但一次都没用过」的账号。
func (h *ActivityHandler) Users(c *gin.Context) {
	q := dto.ActivityUserListQuery{
		PageQuery:     queryPage(c),
		Days:          queryInt(c, "days"),
		Keyword:       c.Query("keyword"),
		Province:      c.Query("province"),
		MinActiveDays: queryInt(c, "min_active_days"),
		Sort:          c.Query("sort"),
	}
	// channel 用 GetQuery 而不是 Query：要区分「没传」和「传了空值」。
	// 没传 = 不筛选渠道；传了空值 / unknown = 只看未知来源。
	if raw, ok := c.GetQuery("channel"); ok {
		q.HasChannel = true
		q.Channel = raw
	}
	result, err := h.svc.Users(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// UserDetail GET /api/v1/admin/activity/users/:id
func (h *ActivityHandler) UserDetail(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.svc.UserDetail(c.Request.Context(), id, queryInt(c, "days"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Traffic GET /api/v1/admin/activity/traffic?days=30&limit=15
//
// 「访问量」标签页：PV / UV、页面排行、新访客落地页、来源渠道。
// 与上面几个接口共用 activity.view 权限——它是同一个页面的一个标签页，
// 再拆一个权限点只会让「看得到活跃却看不到访问量」这种半截状态出现。
func (h *ActivityHandler) Traffic(c *gin.Context) {
	result, err := h.svc.Traffic(c.Request.Context(), queryInt(c, "days"), queryInt(c, "limit"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// TrafficVisitors GET /api/v1/admin/activity/traffic/visitors?days=30&page=1
func (h *ActivityHandler) TrafficVisitors(c *gin.Context) {
	q := dto.ActivityVisitorListQuery{
		PageQuery: queryPage(c),
		Days:      queryInt(c, "days"),
		Path:      c.Query("path"),
		Sort:      c.Query("sort"),
	}
	// channel 用 GetQuery 而不是 Query：要区分「没传」和「传了空值」。
	// 没传 = 不筛选渠道；传了空值 / unknown = 只看未知来源。
	if raw, ok := c.GetQuery("channel"); ok {
		q.HasChannel = true
		q.Channel = raw
	}
	result, err := h.svc.TrafficVisitors(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// EventHandler 客户端埋点上报（前台接口，需要登录）。
type EventHandler struct {
	svc *service.ActivityService
}

// NewEventHandler 构造处理函数集合。
func NewEventHandler(svc *service.ActivityService) *EventHandler {
	return &EventHandler{svc: svc}
}

// Report POST /api/v1/events
//
// 只接受「浏览器里发生、服务端看不见」的功能点（图纸生成 / 导出 / 抠图 / AI 出图等）。
// 服务端能自己统计的接口行为不接受上报，避免同一个数字被两边重复计算。
func (h *EventHandler) Report(c *gin.Context) {
	var req dto.EventBatchRequest
	if !bind(c, &req) {
		return
	}
	userID := currentUserID(c)
	if userID == 0 {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	result, err := h.svc.IngestEvents(c.Request.Context(), userID, req, c.ClientIP())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// VisitHandler 页面访问上报（前台接口，**允许匿名**）。
//
// 与 EventHandler 的区别是核心口径：
//   - 埋点事件是「登录用户用了什么功能」，必须登录；
//   - 页面访问是「站点被打开了多少次」，未登录的访客也要算，
//     否则「有多少人打开过首页」这个问题永远答不出来。
type VisitHandler struct {
	svc *service.ActivityService
}

// NewVisitHandler 构造处理函数集合。
func NewVisitHandler(svc *service.ActivityService) *VisitHandler {
	return &VisitHandler{svc: svc}
}

// Report POST /api/v1/visits
//
// 请求体里的 visitor 缺省时服务端会生成一个并在响应里返回，
// 前端应当把它存进 localStorage 并一直带上（否则每次访问都会算作新访客）。
func (h *VisitHandler) Report(c *gin.Context) {
	var req dto.VisitReportRequest
	if !bind(c, &req) {
		return
	}
	// 站点主机名用来识别「站内跳转」：自己域名来的 Referer 记为直接访问，
	// 否则每个站内点来点去的访客都会带上自己的域名，来源报表就废了。
	result, err := h.svc.IngestVisit(
		c.Request.Context(), req, currentUserID(c), c.ClientIP(), c.Request.Referer(), c.Request.Host)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}
