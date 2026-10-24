package repository

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/response"
)

// wrapNotFound 把 GORM 的「记录不存在」换成业务错误，其余错误折叠成内部错误。
func wrapNotFound(err error, notFound *response.Error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFound
	}
	return response.ErrInternal.WithCause(err)
}

// dayLayout 是列表筛选里日期参数的格式（前端 <input type="date"> 的值）。
const dayLayout = "2006-01-02"

// parseDayStart 把 YYYY-MM-DD 解析成当天 00:00:00。空串或非法值返回 false，
// 调用方据此忽略这个条件（而不是报错——筛选条件写错不该让整个列表打不开）。
func parseDayStart(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.ParseInLocation(dayLayout, s, time.Local); err == nil {
		return t, true
	}
	// 也接受完整的 RFC3339（前端可能直接传时间戳串）
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	return time.Time{}, false
}

// parseDayEnd 把 YYYY-MM-DD 解析成当天 23:59:59.999999999，
// 这样「按日期区间筛选」的语义符合直觉：末尾那天是包含的。
func parseDayEnd(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.ParseInLocation(dayLayout, s, time.Local); err == nil {
		return t.Add(24*time.Hour - time.Nanosecond), true
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	return time.Time{}, false
}
