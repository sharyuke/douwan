package handler

// 本文件是 handler 层的公共辅助：解析参数、拿审计信息、统一响应。
//
// 这些函数存在的意义是让每个 handler 保持 5~15 行：解析 → 调 Service → 写响应。
// 业务规则一律不写在这里。

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// auditOf 取出当前请求的审计信息（谁 / 从哪个 IP / 哪个 request-id）。
func auditOf(c *gin.Context) service.Audit {
	return service.AuditFromContext(c)
}

// bind 解析并校验请求体，失败时直接写响应并返回 false。
func bind(c *gin.Context, obj any) bool {
	if err := response.BindJSON(c, obj); err != nil {
		response.Fail(c, err)
		return false
	}
	return true
}

// pathID 解析路径里的 :id。
func pathID(c *gin.Context, name string) (uint64, bool) {
	raw := c.Param(name)
	id, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
	if err != nil || id == 0 {
		response.Fail(c, response.ErrInvalidParam.WithMessage("路径参数 "+name+" 不合法"))
		return 0, false
	}
	return id, true
}

// queryUint 解析查询参数里的无符号整数，缺省或非法时返回 0。
func queryUint(c *gin.Context, name string) uint64 {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return 0
	}
	v, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0
	}
	return v
}

// queryInt 解析查询参数里的整数，缺省或非法时返回 0。
// 调用方负责把 0 当成「没传，用默认值」处理：筛选条件写错不该让接口报错。
func queryInt(c *gin.Context, name string) int {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return 0
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return v
}

// queryBoolPtr 解析三态布尔查询参数：缺省返回 nil（表示不筛选）。
func queryBoolPtr(c *gin.Context, name string) *bool {
	raw := strings.ToLower(strings.TrimSpace(c.Query(name)))
	if raw == "" {
		return nil
	}
	v := raw == "true" || raw == "1" || raw == "yes"
	return &v
}

// queryInt8Ptr 解析三态 int8 查询参数。
func queryInt8Ptr(c *gin.Context, name string) *int8 {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseInt(raw, 10, 8)
	if err != nil {
		return nil
	}
	out := int8(v)
	return &out
}

// queryPage 解析分页参数。
func queryPage(c *gin.Context) dto.PageQuery {
	page, _ := strconv.Atoi(strings.TrimSpace(c.Query("page")))
	size, _ := strconv.Atoi(strings.TrimSpace(c.Query("page_size")))
	q := dto.PageQuery{Page: page, PageSize: size}
	q.Normalize()
	return q
}

// currentAdmin 取当前管理员（AdminAuth 中间件已保证非空）。
func currentAdmin(c *gin.Context) *model.Admin {
	return middleware.CurrentAdmin(c)
}

// currentUserID 取当前登录用户 ID（前台接口用）。
func currentUserID(c *gin.Context) uint64 {
	return middleware.CurrentUserID(c)
}

// csvHeaders 设置 CSV 下载响应头。
//
// filename 用 RFC 5987 的 filename* 形式，中文文件名在浏览器里才不会乱码。
func csvHeaders(c *gin.Context, filename string) {
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=\"export.csv\"; filename*=UTF-8''"+urlEncode(filename))
	// 让前端能读到文件名（跨域时需要显式暴露）
	c.Header("Access-Control-Expose-Headers", "Content-Disposition")
}

// urlEncode 是 percent-encoding 的最小实现，避免为了一处下载再引一个包。
func urlEncode(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') ||
			ch == '-' || ch == '_' || ch == '.' || ch == '~' {
			b.WriteByte(ch)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[ch>>4])
		b.WriteByte(hex[ch&0x0F])
	}
	return b.String()
}
