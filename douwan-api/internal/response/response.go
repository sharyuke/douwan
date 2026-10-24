package response

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	// HeaderRequestID 请求链路 ID 的响应头。
	HeaderRequestID = "X-Request-ID"
	// CtxRequestID 请求链路 ID 在 gin.Context 中的键，由 middleware.RequestID 写入。
	CtxRequestID = "request_id"
)

// Body 是所有接口的统一响应体。
type Body struct {
	Code      Code   `json:"code"`
	Message   string `json:"message"`
	Data      any    `json:"data,omitempty"`
	RequestID string `json:"request_id,omitempty"`
}

// Success 返回成功响应（HTTP 200）。
func Success(c *gin.Context, data any) {
	write(c, http.StatusOK, Body{Code: CodeOK, Message: "ok", Data: data})
}

// Created 返回创建成功响应（HTTP 201）。
func Created(c *gin.Context, data any) {
	write(c, http.StatusCreated, Body{Code: CodeOK, Message: "ok", Data: data})
}

// Fail 返回失败响应。状态码与业务码由 *Error 决定；
// 带内部原因的错误会打一条 error 日志，接口里只回对外文案。
func Fail(c *gin.Context, err error) {
	e := From(err)
	if e == nil {
		Success(c, nil)
		return
	}
	if e.Err != nil {
		slog.ErrorContext(c.Request.Context(), "请求处理失败",
			"code", e.Code,
			"message", e.Message,
			"path", c.FullPath(),
			"err", e.Err,
			"request_id", RequestID(c),
		)
	}
	write(c, e.HTTPStatus, Body{Code: e.Code, Message: e.Message})
	c.Abort()
}

// RequestID 读取当前请求的链路 ID，没有则返回空串。
func RequestID(c *gin.Context) string {
	if v, ok := c.Get(CtxRequestID); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func write(c *gin.Context, status int, body Body) {
	if body.RequestID == "" {
		body.RequestID = RequestID(c)
	}
	c.JSON(status, body)
}
