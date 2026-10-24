package handler

import (
	"mime/multipart"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
)

// LibraryHandler 素材库与分类管理接口（需求 §8）。
type LibraryHandler struct {
	svc *service.LibraryService
}

// NewLibraryHandler 构造处理函数集合。
func NewLibraryHandler(svc *service.LibraryService) *LibraryHandler {
	return &LibraryHandler{svc: svc}
}

/* ------------------------------------------------------------------ 素材 */

// List GET /api/v1/admin/assets
func (h *LibraryHandler) List(c *gin.Context) {
	q := dto.AssetListQuery{
		PageQuery:   queryPage(c),
		Keyword:     c.Query("keyword"),
		CategoryID:  queryUint(c, "category_id"),
		Tag:         c.Query("tag"),
		Status:      c.Query("status"),
		Featured:    queryBoolPtr(c, "featured"),
		Tier:        c.Query("tier"),
		CreatedFrom: c.Query("created_from"),
		CreatedTo:   c.Query("created_to"),
		Sort:        c.Query("sort"),
		Order:       c.Query("order"),
	}
	result, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Detail GET /api/v1/admin/assets/:id
func (h *LibraryHandler) Detail(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	result, err := h.svc.Detail(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// Upload POST /api/v1/admin/assets/upload
//
// multipart/form-data：
//
//	files        多张图片（字段名 files 或 file，可重复）
//	title        素材名称
//	category_id  分类
//	tags         标签，JSON 数组字符串或逗号分隔
//	description / is_featured / sort_order / status / tier / 来源与版权备注
func (h *LibraryHandler) Upload(c *gin.Context) {
	files, err := collectUploadFiles(c)
	if err != nil {
		response.Fail(c, err)
		return
	}
	form := dto.AssetUploadForm{
		Title:       c.PostForm("title"),
		Slug:        c.PostForm("slug"),
		CategoryID:  parseUintForm(c.PostForm("category_id")),
		Tags:        parseTagsForm(c.PostForm("tags")),
		Description: c.PostForm("description"),
		IsFeatured:  parseBoolForm(c.PostForm("is_featured")),
		SortOrder:   atoiDefault(c.PostForm("sort_order"), 0),
		Status:      strings.TrimSpace(c.PostForm("status")),
		Tier:        strings.TrimSpace(c.PostForm("tier")),
		SourceNote:  c.PostForm("source_note"),
		RightsNote:  c.PostForm("rights_note"),
		InnerNote:   c.PostForm("inner_note"),
	}
	result, err := h.svc.Upload(c.Request.Context(), files, form, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// Update PATCH /api/v1/admin/assets/:id
func (h *LibraryHandler) Update(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.AssetUpdateRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.Update(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// ChangeStatus PATCH /api/v1/admin/assets/:id/status
func (h *LibraryHandler) ChangeStatus(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.AssetStatusRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.ChangeStatus(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// BatchSort POST /api/v1/admin/assets/sort
func (h *LibraryHandler) BatchSort(c *gin.Context) {
	var req dto.AssetSortRequest
	if !bind(c, &req) {
		return
	}
	updated, err := h.svc.BatchSort(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"updated": updated, "message": "排序已更新"})
}

// Delete DELETE /api/v1/admin/assets/:id
func (h *LibraryHandler) Delete(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id, c.Query("reason"), auditOf(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "素材已删除（磁盘文件保留，历史作品不受影响）"})
}

// Tags GET /api/v1/admin/assets/tags
func (h *LibraryHandler) Tags(c *gin.Context) {
	tags, err := h.svc.Tags(c.Request.Context(), false)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, tags)
}

/* ------------------------------------------------------------------ 分类 */

// CategoryList GET /api/v1/admin/asset-categories
func (h *LibraryHandler) CategoryList(c *gin.Context) {
	q := dto.CategoryListQuery{
		PageQuery: queryPage(c),
		Keyword:   c.Query("keyword"),
		Status:    queryInt8Ptr(c, "status"),
	}
	result, err := h.svc.CategoryList(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// CategoryOptions GET /api/v1/admin/asset-categories/options
func (h *LibraryHandler) CategoryOptions(c *gin.Context) {
	onlyEnabled := c.Query("only_enabled") == "true"
	items, err := h.svc.CategoryOptions(c.Request.Context(), onlyEnabled)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, items)
}

// CategoryCreate POST /api/v1/admin/asset-categories
func (h *LibraryHandler) CategoryCreate(c *gin.Context) {
	var req dto.CategoryRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.CategoryCreate(c.Request.Context(), req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Created(c, result)
}

// CategoryUpdate PUT /api/v1/admin/asset-categories/:id
func (h *LibraryHandler) CategoryUpdate(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	var req dto.CategoryRequest
	if !bind(c, &req) {
		return
	}
	result, err := h.svc.CategoryUpdate(c.Request.Context(), id, req, auditOf(c))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// CategoryDelete DELETE /api/v1/admin/asset-categories/:id
func (h *LibraryHandler) CategoryDelete(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.CategoryDelete(c.Request.Context(), id, auditOf(c)); err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, gin.H{"message": "分类已删除"})
}

/* ------------------------------------------------------------------ 前台 */

// PublicAssets GET /api/v1/assets
func (h *LibraryHandler) PublicAssets(c *gin.Context) {
	q := dto.PublicAssetQuery{
		PageQuery:    queryPage(c),
		Keyword:      c.Query("keyword"),
		CategoryID:   queryUint(c, "category_id"),
		CategorySlug: c.Query("category_slug"),
		Tag:          c.Query("tag"),
		Featured:     queryBoolPtr(c, "featured"),
		Tier:         c.Query("tier"),
		Sort:         c.Query("sort"),
	}
	result, err := h.svc.PublicAssets(c.Request.Context(), q)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// PublicAssetDetail GET /api/v1/assets/:slug
func (h *LibraryHandler) PublicAssetDetail(c *gin.Context) {
	result, err := h.svc.PublicAssetDetail(c.Request.Context(), c.Param("slug"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

// PublicCategories GET /api/v1/assets/categories
func (h *LibraryHandler) PublicCategories(c *gin.Context) {
	result, err := h.svc.PublicCategories(c.Request.Context())
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.Success(c, result)
}

/* ------------------------------------------------------------------ 表单解析 */

// collectUploadFiles 收集上传的图片。同时接受 files / file 两种字段名，
// 并且支持同一个字段名重复出现（多张批量上传）。
func collectUploadFiles(c *gin.Context) ([]*multipart.FileHeader, error) {
	form, err := c.MultipartForm()
	if err != nil {
		return nil, response.ErrUploadRejected.WithMessage("请通过表单上传图片文件")
	}
	out := make([]*multipart.FileHeader, 0, 4)
	for _, key := range []string{"files", "file", "images"} {
		for _, fh := range form.File[key] {
			out = append(out, fh)
		}
	}
	if len(out) == 0 {
		return nil, response.ErrUploadRejected.WithMessage("没有收到图片文件")
	}
	if len(out) > 50 {
		return nil, response.ErrUploadRejected.WithMessage("单次最多上传 50 张，请分批上传")
	}
	return out, nil
}

func parseUintForm(s string) uint64 {
	v, err := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return 0
	}
	return v
}

func parseBoolForm(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "true" || s == "1" || s == "on" || s == "yes"
}

// parseTagsForm 解析标签表单字段。同时接受 JSON 数组（"[\"a\",\"b\"]"）
// 与逗号/中文逗号分隔（"a,b"）两种写法，前端怎么传都不会解析失败。
func parseTagsForm(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if strings.HasPrefix(s, "[") {
		trimmed := strings.Trim(s, "[]")
		if trimmed == "" {
			return nil
		}
		parts := strings.Split(trimmed, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.Trim(strings.TrimSpace(p), "\"")
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	parts := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == '，' || r == '、' })
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
