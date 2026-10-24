package response

import (
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

// fieldLabels 把结构体字段名映射成中文，用于拼装可读的参数错误提示。
var fieldLabels = map[string]string{
	"Username":     "用户名",
	"Password":     "密码",
	"Email":        "邮箱",
	"Phone":        "手机号",
	"Nickname":     "昵称",
	"Account":      "账号",
	"RefreshToken": "刷新令牌",
	"AvatarURL":    "头像地址",

	// 后台管理
	"Code":            "套餐标识",
	"Name":            "名称",
	"ShortDesc":       "短描述",
	"FrontDesc":       "前台展示说明",
	"Price":           "售价",
	"PlanID":          "套餐",
	"Quantity":        "数量",
	"Count":           "生成数量",
	"BatchName":       "批次名称",
	"Note":            "备注",
	"Reason":          "原因",
	"CardKey":         "卡密",
	"CodeText":        "卡密",
	"OrderNo":         "订单号",
	"AmountPaid":      "实付金额",
	"PaymentMethod":   "支付方式",
	"Title":           "素材名称",
	"CategoryID":      "分类",
	"Tags":            "标签",
	"SortOrder":       "排序值",
	"Status":          "状态",
	"Slug":            "标识",
	"Key":             "设置项",
	"Value":           "设置值",
	"Role":            "角色",
	"AdminID":         "管理员",
	"UserID":          "用户",
	"TargetUserID":    "目标用户",
	"EntitlementID":   "权益记录",
	"RedeemExpiresAt": "兑换截止日期",
	"ValidityType":    "有效期类型",
	"ValidityValue":   "有效期数值",
	"BenefitType":     "权益类型",
	"Page":            "页码",
	"PageSize":        "每页条数",
}

// BindJSON 解析并校验请求体，失败时返回带中文提示的 ErrInvalidParam。
// 处理函数里直接 `if err := response.BindJSON(c, &req); err != nil { response.Fail(c, err); return }`。
func BindJSON(c *gin.Context, obj any) error {
	if err := c.ShouldBindJSON(obj); err != nil {
		return ErrInvalidParam.WithMessage(bindMessage(err))
	}
	return nil
}

func bindMessage(err error) string {
	var verrs validator.ValidationErrors
	if !errors.As(err, &verrs) || len(verrs) == 0 {
		// JSON 语法错误、类型不匹配等走这里
		return "请求参数有误，请检查后重试"
	}

	fe := verrs[0]
	label := labelOf(fe.Field())
	switch fe.Tag() {
	case "required":
		return fmt.Sprintf("%s不能为空", label)
	case "min":
		return fmt.Sprintf("%s长度不能小于 %s", label, fe.Param())
	case "max":
		return fmt.Sprintf("%s长度不能大于 %s", label, fe.Param())
	case "len":
		return fmt.Sprintf("%s长度必须为 %s", label, fe.Param())
	case "email":
		return fmt.Sprintf("%s格式不正确", label)
	case "url":
		return fmt.Sprintf("%s必须是合法的链接", label)
	case "alphanum":
		return fmt.Sprintf("%s只能包含字母和数字", label)
	case "numeric":
		return fmt.Sprintf("%s必须是数字", label)
	case "number":
		return fmt.Sprintf("%s必须是合法数字", label)
	case "gt":
		return fmt.Sprintf("%s必须大于 %s", label, fe.Param())
	case "gte":
		return fmt.Sprintf("%s不能小于 %s", label, fe.Param())
	case "lt":
		return fmt.Sprintf("%s必须小于 %s", label, fe.Param())
	case "lte":
		return fmt.Sprintf("%s不能大于 %s", label, fe.Param())
	case "oneof":
		return fmt.Sprintf("%s只能是 %s 之一", label, strings.ReplaceAll(fe.Param(), " ", " / "))
	case "required_if":
		return fmt.Sprintf("%s不能为空", label)
	case "required_without_all":
		return fmt.Sprintf("%s不能为空", label)
	default:
		return fmt.Sprintf("%s不合法", label)
	}
}

func labelOf(field string) string {
	if label, ok := fieldLabels[field]; ok {
		return label
	}
	return field
}
