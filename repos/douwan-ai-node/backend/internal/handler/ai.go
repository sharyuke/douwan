package handler

import (
	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// AIHandler 本地 AI 接口（前台）。
//
// 交互模型是**异步**的：提交拿 job_id → 轮询状态 → 成功后取 output_url。
// 为什么不做成同步接口：一次卡通化在 RTX 2060 上要 6~25s，排队时更久，
// 而 nginx 的 proxy_read_timeout 是 60s —— 同步接口会在网关层被掐断，
// 用户看到的是 504 而不是可读的进度。
type AIHandler struct {
	svc *service.AIService
}

// NewAIHandler 构造处理函数集合。
func NewAIHandler(svc *service.AIService) *AIHandler {
	return &AIHandler{svc: svc}
}

// NodeStatus GET /api/v1/ai/status
//
// 前台用它判断「AI 功能现在能不能用」，据此决定按钮是可点还是给出原因。
// 需要登录：未登录用户先看到登录引导即可，没必要探测节点。
func (h *AIHandler) NodeStatus(c *gin.Context) {
	if currentUserID(c) == 0 {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	response.Success(c, h.svc.NodeStatus(c.Request.Context()))
}

// UploadInput POST /api/v1/ai/uploads  (multipart，字段名 file)
//
// 先上传再提交任务：用户能先看到自己的图，再决定跑不跑。
func (h *AIHandler) UploadInput(c *gin.Context) {
	userID := currentUserID(c)
	if userID == 0 {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		// 兼容前端常用的 images / image 字段名（与素材上传保持一致的宽容度）
		for _, alt := range []string{"image", "images"} {
			if f, e := c.FormFile(alt); e == nil {
				fh, err = f, nil
				break
			}
		}
	}
	if err != nil || fh == nil {
		response.Fail(c, response.ErrMissingParam.WithMessage("请选择要上传的图片（表单字段名 file）"))
		return
	}
	result, err := h.svc.UploadInput(c.Request.Context(), userID, fh)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// Submit POST /api/v1/ai/jobs
func (h *AIHandler) Submit(c *gin.Context) {
	userID := currentUserID(c)
	if userID == 0 {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	var req dto.AISubmitRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Submit(c.Request.Context(), userID, req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	// 幂等命中时返回 200 而不是 201：没有新建任何东西
	if result.Deduplicated {
		response.Success(c, result)
		return
	}
	response.Created(c, result)
}

// Get GET /api/v1/ai/jobs/:id
func (h *AIHandler) Get(c *gin.Context) {
	userID := currentUserID(c)
	if userID == 0 {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.svc.Get(c.Request.Context(), userID, id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// List GET /api/v1/ai/jobs
func (h *AIHandler) List(c *gin.Context) {
	userID := currentUserID(c)
	if userID == 0 {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	q := dto.AIJobListQuery{
		PageQuery: queryPage(c),
		Status:    c.Query("status"),
		Kind:      c.Query("kind"),
	}
	result, err := h.svc.List(c.Request.Context(), userID, q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Cancel POST /api/v1/ai/jobs/:id/cancel
//
// 尽力而为：排队中的任务直接落成 canceled；正在跑的只能打标记，
// 由 worker 在轮询间隙发现后收尾（ComfyUI 没有取消接口，无法真正中断推理）。
func (h *AIHandler) Cancel(c *gin.Context) {
	userID := currentUserID(c)
	if userID == 0 {
		response.Fail(c, response.ErrUnauthorized)
		return
	}
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.svc.Cancel(c.Request.Context(), userID, id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

/* ------------------------------------------------------------------ 后台 */

// AdminHandler 后台本地 AI 运维接口。
type AIAdminHandler struct {
	svc *service.AIService
}

// NewAIAdminHandler 构造处理函数集合。
func NewAIAdminHandler(svc *service.AIService) *AIAdminHandler {
	return &AIAdminHandler{svc: svc}
}

// Status GET /api/v1/admin/localai/status
//
// 即使开关关闭也会返回 200 + Enabled=false：后台页面需要能展示
// 「功能没开」，而不是一个错误弹窗（运营据此判断要不要去开开关）。
func (h *AIAdminHandler) Status(c *gin.Context) {
	response.Success(c, h.svc.NodeStatus(c.Request.Context()))
}

// Jobs GET /api/v1/admin/localai/jobs
func (h *AIAdminHandler) Jobs(c *gin.Context) {
	q := dto.AIJobListQuery{
		PageQuery: queryPage(c),
		Status:    c.Query("status"),
		Kind:      c.Query("kind"),
		UserID:    queryUint(c, "user_id"),
	}
	result, err := h.svc.AdminList(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}
