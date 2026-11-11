// Package sms 封装短信验证码的发送通道。
//
// Sender 是业务层依赖的唯一抽象：单测里用假发送器，
// 线上换 Aliyun 实现，业务代码不感知渠道。
package sms

import "context"

// Sender 短信发送器。code 是 6 位数字验证码明文，由调用方生成并另行持久化。
type Sender interface {
	// SendCode 把验证码发到手机号。失败返回错误，原因只进日志。
	SendCode(ctx context.Context, phone, code string) error
}
