// Package response 定义统一的 HTTP 响应格式与业务错误码。
//
// 约定：HTTP 状态码表达「传输/协议层」结果，body 里的 code 表达「业务层」结果。
// 前端只需判断 code：0 表示成功，其余按错误码表处理。
package response

import (
	"errors"
	"fmt"
	"net/http"
)

// Code 业务错误码。
type Code int

const (
	CodeOK Code = 0

	// 通用 10xxx
	CodeInvalidParam    Code = 10001
	CodeMissingParam    Code = 10002
	CodeNotFound        Code = 10404
	CodeTooManyRequests Code = 10429
	CodeInternal        Code = 10500

	// 认证与授权 20xxx
	CodeUnauthorized    Code = 20001
	CodeTokenExpired    Code = 20002
	CodeTokenInvalid    Code = 20003
	CodePasswordWrong   Code = 20004
	CodeAccountDisabled Code = 20005
	CodeForbidden       Code = 20403

	// 用户 30xxx
	CodeUserNotFound Code = 30001
	CodeUserExists   Code = 30002

	// 后台管理 40xxx
	CodeAdminNotFound       Code = 40001
	CodeAdminDisabled       Code = 40002
	CodeAdminExists         Code = 40003
	CodePlanNotFound        Code = 40004
	CodePlanInvalid         Code = 40005
	CodePlanInUse           Code = 40006
	CodePlanNotSellable     Code = 40007
	CodeCardNotFound        Code = 40008
	CodeCardUsed            Code = 40009
	CodeCardExpired         Code = 40010
	CodeCardVoided          Code = 40011
	CodeCardNotVoidable     Code = 40012
	CodeOrderNotFound       Code = 40013
	CodeOrderNotPayable     Code = 40014
	CodeOrderNotPaid        Code = 40015
	CodeOrderClosed         Code = 40016
	CodeAlreadyIssued       Code = 40017
	CodeAssetNotFound       Code = 40018
	CodeAssetInUse          Code = 40019
	CodeCategoryNotFound    Code = 40020
	CodeCategoryInUse       Code = 40021
	CodeUploadRejected      Code = 40022
	CodeSettingNotFound     Code = 40023
	CodeEntitlementNotFound Code = 40024
	CodeNoCardStock         Code = 40025
	CodePaymentDisabled     Code = 40026
	CodeEventFeatureUnknown Code = 40027

	// 本地 AI 40xxx（承接 40027 继续编号）
	CodeAINotEnabled       Code = 40028 // 本地 AI 功能未开启（配置开关关闭）
	CodeAIQueueFull        Code = 40029 // 队列已满，请稍后再试
	CodeAIUnavailable      Code = 40030 // 推理节点不可达
	CodeAIJobNotFound      Code = 40031 // 任务不存在或不属于当前用户
	CodeAIJobNotCancelable Code = 40032 // 任务已结束，不能取消
	CodeAIRejected         Code = 40033 // 推理服务拒绝了这次请求（参数/模型问题）
)

// Error 业务错误。它同时携带对外文案、业务码与 HTTP 状态码，
// 内部原因放在 Err 里，只进日志、不出接口。
type Error struct {
	Code       Code
	HTTPStatus int
	Message    string
	Err        error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%d] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.Err }

// WithMessage 返回改了对外文案的副本。返回副本是为了不污染全局定义，
// 那几个包级变量是并发共享的。
func (e *Error) WithMessage(msg string) *Error {
	cp := *e
	cp.Message = msg
	return &cp
}

// WithCause 返回带内部原因的副本，原因只写日志。
func (e *Error) WithCause(err error) *Error {
	cp := *e
	cp.Err = err
	return &cp
}

// 预定义错误。业务代码直接返回这些变量，或在其上 WithMessage / WithCause。
var (
	ErrInvalidParam    = &Error{Code: CodeInvalidParam, HTTPStatus: http.StatusBadRequest, Message: "请求参数有误"}
	ErrMissingParam    = &Error{Code: CodeMissingParam, HTTPStatus: http.StatusBadRequest, Message: "缺少必要参数"}
	ErrNotFound        = &Error{Code: CodeNotFound, HTTPStatus: http.StatusNotFound, Message: "资源不存在"}
	ErrTooManyRequests = &Error{Code: CodeTooManyRequests, HTTPStatus: http.StatusTooManyRequests, Message: "请求过于频繁，请稍后再试"}
	ErrInternal        = &Error{Code: CodeInternal, HTTPStatus: http.StatusInternalServerError, Message: "服务器内部错误"}

	ErrUnauthorized    = &Error{Code: CodeUnauthorized, HTTPStatus: http.StatusUnauthorized, Message: "请先登录"}
	ErrTokenExpired    = &Error{Code: CodeTokenExpired, HTTPStatus: http.StatusUnauthorized, Message: "登录已过期，请重新登录"}
	ErrTokenInvalid    = &Error{Code: CodeTokenInvalid, HTTPStatus: http.StatusUnauthorized, Message: "登录凭证无效"}
	ErrPasswordWrong   = &Error{Code: CodePasswordWrong, HTTPStatus: http.StatusUnauthorized, Message: "账号或密码不正确"}
	ErrAccountDisabled = &Error{Code: CodeAccountDisabled, HTTPStatus: http.StatusForbidden, Message: "账号已被禁用"}
	ErrForbidden       = &Error{Code: CodeForbidden, HTTPStatus: http.StatusForbidden, Message: "没有操作权限"}

	ErrUserNotFound = &Error{Code: CodeUserNotFound, HTTPStatus: http.StatusNotFound, Message: "用户不存在"}
	ErrUserExists   = &Error{Code: CodeUserExists, HTTPStatus: http.StatusConflict, Message: "该账号已被注册"}

	// 后台管理
	ErrAdminNotFound       = &Error{Code: CodeAdminNotFound, HTTPStatus: http.StatusNotFound, Message: "管理员不存在"}
	ErrAdminDisabled       = &Error{Code: CodeAdminDisabled, HTTPStatus: http.StatusForbidden, Message: "该管理员账号已停用"}
	ErrAdminExists         = &Error{Code: CodeAdminExists, HTTPStatus: http.StatusConflict, Message: "该管理员账号已存在"}
	ErrPlanNotFound        = &Error{Code: CodePlanNotFound, HTTPStatus: http.StatusNotFound, Message: "套餐不存在"}
	ErrPlanInvalid         = &Error{Code: CodePlanInvalid, HTTPStatus: http.StatusBadRequest, Message: "套餐配置不完整"}
	ErrPlanInUse           = &Error{Code: CodePlanInUse, HTTPStatus: http.StatusConflict, Message: "该套餐已产生订单或卡密，不能直接删除，请改为下架"}
	ErrPlanNotSellable     = &Error{Code: CodePlanNotSellable, HTTPStatus: http.StatusConflict, Message: "该套餐尚未上架，不能下单"}
	ErrCardNotFound        = &Error{Code: CodeCardNotFound, HTTPStatus: http.StatusNotFound, Message: "卡密不存在，请核对后重试"}
	ErrCardUsed            = &Error{Code: CodeCardUsed, HTTPStatus: http.StatusConflict, Message: "这张卡密已经被兑换过了"}
	ErrCardExpired         = &Error{Code: CodeCardExpired, HTTPStatus: http.StatusConflict, Message: "这张卡密已超过兑换截止日期"}
	ErrCardVoided          = &Error{Code: CodeCardVoided, HTTPStatus: http.StatusConflict, Message: "这张卡密已作废，请联系客服"}
	ErrCardNotVoidable     = &Error{Code: CodeCardNotVoidable, HTTPStatus: http.StatusConflict, Message: "该卡密当前状态不允许作废"}
	ErrOrderNotFound       = &Error{Code: CodeOrderNotFound, HTTPStatus: http.StatusNotFound, Message: "订单不存在"}
	ErrOrderNotPayable     = &Error{Code: CodeOrderNotPayable, HTTPStatus: http.StatusConflict, Message: "订单当前状态不允许该操作"}
	ErrOrderNotPaid        = &Error{Code: CodeOrderNotPaid, HTTPStatus: http.StatusConflict, Message: "订单尚未支付，不能发放卡密或权益"}
	ErrOrderClosed         = &Error{Code: CodeOrderClosed, HTTPStatus: http.StatusConflict, Message: "订单已关闭，不能继续操作"}
	ErrAlreadyIssued       = &Error{Code: CodeAlreadyIssued, HTTPStatus: http.StatusConflict, Message: "该订单已经发放过卡密，不能重复发放"}
	ErrAssetNotFound       = &Error{Code: CodeAssetNotFound, HTTPStatus: http.StatusNotFound, Message: "素材不存在"}
	ErrAssetInUse          = &Error{Code: CodeAssetInUse, HTTPStatus: http.StatusConflict, Message: "素材已被引用，请改为下架而不是删除"}
	ErrCategoryNotFound    = &Error{Code: CodeCategoryNotFound, HTTPStatus: http.StatusNotFound, Message: "素材分类不存在"}
	ErrCategoryInUse       = &Error{Code: CodeCategoryInUse, HTTPStatus: http.StatusConflict, Message: "该分类下还有素材，请先迁移素材或停用分类"}
	ErrUploadRejected      = &Error{Code: CodeUploadRejected, HTTPStatus: http.StatusBadRequest, Message: "上传的文件不符合要求"}
	ErrSettingNotFound     = &Error{Code: CodeSettingNotFound, HTTPStatus: http.StatusNotFound, Message: "设置项不存在"}
	ErrEntitlementNotFound = &Error{Code: CodeEntitlementNotFound, HTTPStatus: http.StatusNotFound, Message: "权益记录不存在"}
	ErrNoCardStock         = &Error{Code: CodeNoCardStock, HTTPStatus: http.StatusConflict, Message: "该订单所需的卡密库存不足，请先生成卡密"}
	ErrPaymentDisabled     = &Error{Code: CodePaymentDisabled, HTTPStatus: http.StatusConflict, Message: "支付渠道尚未配置"}
	ErrEventFeatureUnknown = &Error{Code: CodeEventFeatureUnknown, HTTPStatus: http.StatusBadRequest, Message: "埋点事件里的功能标识不被支持"}

	// 本地 AI。对外文案一律「可读、可行动」，不暴露内部地址与实现细节。
	ErrAINotEnabled  = &Error{Code: CodeAINotEnabled, HTTPStatus: http.StatusServiceUnavailable, Message: "本地 AI 功能当前未开启"}
	ErrAIQueueFull   = &Error{Code: CodeAIQueueFull, HTTPStatus: http.StatusTooManyRequests, Message: "AI 任务排队已满，请稍后再试"}
	ErrAIUnavailable = &Error{Code: CodeAIUnavailable, HTTPStatus: http.StatusServiceUnavailable, Message: "本地 AI 服务暂时不可用，请稍后再试"}
	ErrAIJobNotFound = &Error{Code: CodeAIJobNotFound, HTTPStatus: http.StatusNotFound, Message: "AI 任务不存在"}
	ErrAIJobFinished = &Error{Code: CodeAIJobNotCancelable, HTTPStatus: http.StatusConflict, Message: "任务已结束，不能取消"}
	ErrAIRejected    = &Error{Code: CodeAIRejected, HTTPStatus: http.StatusBadRequest, Message: "本次 AI 任务无法完成"}
)

// From 把任意 error 归一成 *Error。
// 非业务错误一律折叠成「服务器内部错误」，避免把数据库报错之类的细节泄露给前端。
func From(err error) *Error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return ErrInternal.WithCause(err)
}
