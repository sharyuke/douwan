package repository

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// AssetRepository 后台素材库表访问（LibraryAsset）。
type AssetRepository struct {
	db *gorm.DB
}

// Create 新建素材。
//
// slug 冲突会被翻译成 ErrInvalidParam（而不是内部错误），
// 让服务层能识别出来并换一个 slug 重试 —— 这是「同名标题反复上传」
// 唯一可靠的兜底：ExistsBySlug 的查询与插入之间有竞态，
// 自动化脚本连续上传同一标题就会撞上（线上实测踩到过）。
func (r *AssetRepository) Create(ctx context.Context, a *model.LibraryAsset) error {
	if err := r.db.WithContext(ctx).Create(a).Error; err != nil {
		if IsDuplicateSlugErr(err) {
			return response.ErrInvalidParam.WithMessage("素材标识已存在，请换一个")
		}
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// IsDuplicateSlugErr 判断某个错误是否表示「素材标识（slug）冲突」。
func IsDuplicateSlugErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "素材标识已存在") ||
		strings.Contains(msg, "idx_library_assets_slug") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "UNIQUE constraint failed")
}

// FindByID 按主键查素材。
func (r *AssetRepository) FindByID(ctx context.Context, id uint64) (*model.LibraryAsset, error) {
	var a model.LibraryAsset
	if err := r.db.WithContext(ctx).First(&a, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrAssetNotFound)
	}
	return &a, nil
}

// FindBySlug 按标识查素材（前台详情页用）。
func (r *AssetRepository) FindBySlug(ctx context.Context, slug string) (*model.LibraryAsset, error) {
	var a model.LibraryAsset
	err := r.db.WithContext(ctx).Where("slug = ?", strings.TrimSpace(slug)).First(&a).Error
	if err != nil {
		return nil, wrapNotFound(err, response.ErrAssetNotFound)
	}
	return &a, nil
}

// ExistsBySlug 判断 slug 是否被占用。
func (r *AssetRepository) ExistsBySlug(ctx context.Context, slug string, excludeID uint64) (bool, error) {
	if strings.TrimSpace(slug) == "" {
		return false, nil
	}
	q := r.db.WithContext(ctx).Model(&model.LibraryAsset{}).Where("slug = ?", strings.TrimSpace(slug))
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return false, response.ErrInternal.WithCause(err)
	}
	return count > 0, nil
}

// UpdateFields 局部更新。
func (r *AssetRepository) UpdateFields(ctx context.Context, id uint64, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	err := r.db.WithContext(ctx).Model(&model.LibraryAsset{}).Where("id = ?", id).Updates(fields).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// SoftDelete 软删除。已发布的素材应先下架再删除，判定在 Service 层。
func (r *AssetRepository) SoftDelete(ctx context.Context, id uint64) error {
	if err := r.db.WithContext(ctx).Delete(&model.LibraryAsset{}, id).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// List 后台素材列表。
func (r *AssetRepository) List(ctx context.Context, q dto.AssetListQuery) ([]model.LibraryAsset, int64, error) {
	query := r.applyFilter(r.db.WithContext(ctx).Model(&model.LibraryAsset{}), q)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	order := buildAssetOrder(q.Sort, q.Order)
	var list []model.LibraryAsset
	err := query.Order(order).Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// ListRecent 最近上传的素材，供概览页使用。
func (r *AssetRepository) ListRecent(ctx context.Context, limit int) ([]model.LibraryAsset, error) {
	if limit <= 0 {
		limit = 5
	}
	var list []model.LibraryAsset
	if err := r.db.WithContext(ctx).Order("id DESC").Limit(limit).Find(&list).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// ListPublished 前台素材列表（只返回已发布）。
func (r *AssetRepository) ListPublished(ctx context.Context, q dto.PublicAssetQuery) ([]model.LibraryAsset, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.LibraryAsset{}).
		Where("status = ?", model.AssetStatusPublished)

	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("title LIKE ? OR description LIKE ? OR category_name LIKE ?", like, like, like)
	}
	if q.CategoryID > 0 {
		query = query.Where("category_id = ?", q.CategoryID)
	}
	if q.CategorySlug != "" {
		var cat model.LibraryCategory
		if err := r.db.WithContext(ctx).Where("slug = ?", q.CategorySlug).First(&cat).Error; err == nil {
			query = query.Where("category_id = ?", cat.ID)
		} else {
			// 分类不存在时返回空列表，而不是退化成「全部素材」
			query = query.Where("1 = 0")
		}
	}
	if q.Tag != "" {
		// tags 是 jsonb（PostgreSQL）/ JSON 文本（SQLite），不能直接对 jsonb 用 LIKE
		// （PG 会报 operator does not exist: jsonb ~~ unknown）。
		// 先转成文本再匹配；带引号可以避免 「cat」误命中 「category」这类子串。
		query = query.Where("CAST(tags AS TEXT) LIKE ?", "%\""+q.Tag+"\"%")
	}
	if q.Featured != nil {
		query = query.Where("is_featured = ?", *q.Featured)
	}
	if q.Tier != "" {
		query = query.Where("tier = ?", q.Tier)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	order := "sort_order DESC, id DESC"
	switch q.Sort {
	case "new", "created_at":
		order = "published_at DESC, id DESC"
	case "sort_order":
		order = "sort_order DESC, id DESC"
	}

	var list []model.LibraryAsset
	err := query.Order(order).Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// CountByStatus 统计某状态的素材数。
func (r *AssetRepository) CountByStatus(ctx context.Context, status string) (int64, error) {
	q := r.db.WithContext(ctx).Model(&model.LibraryAsset{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// CountFeatured 统计推荐素材数。
func (r *AssetRepository) CountFeatured(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.LibraryAsset{}).
		Where("is_featured = ? AND status = ?", true, model.AssetStatusPublished).
		Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// CountByCategory 统计每个分类下的素材数，供分类列表展示。
func (r *AssetRepository) CountByCategory(ctx context.Context) (map[uint64]int64, error) {
	type row struct {
		CategoryID uint64
		Total      int64
	}
	var rows []row
	err := r.db.WithContext(ctx).Model(&model.LibraryAsset{}).
		Select("category_id, COUNT(*) AS total").
		Group("category_id").Scan(&rows).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	out := make(map[uint64]int64, len(rows))
	for _, r := range rows {
		out[r.CategoryID] = r.Total
	}
	return out, nil
}

// ListAllTags 汇总所有已用标签，供后台标签筛选与补全。
//
// 走完整模型查询而不是 Pluck("tags")：tags 带 serializer:json，
// 只有查整行时 GORM 才会把它反序列化成 []string；
// Pluck 拿到的会是数据库里的原始文本（jsonb 甚至可能扫不进 []string）。
func (r *AssetRepository) ListAllTags(ctx context.Context) ([]string, error) {
	var assets []model.LibraryAsset
	if err := r.db.WithContext(ctx).Select("id", "tags").Find(&assets).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return flattenTags(assets), nil
}

// ListTagsForPublished 汇总已发布素材的标签，供前台筛选用。
func (r *AssetRepository) ListTagsForPublished(ctx context.Context) ([]string, error) {
	var assets []model.LibraryAsset
	err := r.db.WithContext(ctx).Select("id", "tags").
		Where("status = ?", model.AssetStatusPublished).Find(&assets).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return flattenTags(assets), nil
}

// flattenTags 把多个素材的标签去重拍平。
func flattenTags(assets []model.LibraryAsset) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(assets))
	for i := range assets {
		for _, tag := range assets[i].Tags {
			tag = strings.TrimSpace(tag)
			if tag == "" || seen[tag] {
				continue
			}
			seen[tag] = true
			out = append(out, tag)
		}
	}
	return out
}

func (r *AssetRepository) applyFilter(query *gorm.DB, q dto.AssetListQuery) *gorm.DB {
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("title LIKE ? OR description LIKE ? OR slug LIKE ?", like, like, like)
	}
	if q.CategoryID > 0 {
		query = query.Where("category_id = ?", q.CategoryID)
	}
	if q.Tag != "" {
		// 同 ListPublished：jsonb 不能直接 LIKE，先转文本。
		query = query.Where("CAST(tags AS TEXT) LIKE ?", "%\""+q.Tag+"\"%")
	}
	if q.Status != "" {
		query = query.Where("status = ?", q.Status)
	}
	if q.Featured != nil {
		query = query.Where("is_featured = ?", *q.Featured)
	}
	if q.Tier != "" {
		query = query.Where("tier = ?", q.Tier)
	}
	if from, ok := parseDayStart(q.CreatedFrom); ok {
		query = query.Where("created_at >= ?", from)
	}
	if to, ok := parseDayEnd(q.CreatedTo); ok {
		query = query.Where("created_at <= ?", to)
	}
	return query
}

// buildAssetOrder 组装排序。只允许白名单字段，避免把用户输入直接拼进 SQL。
func buildAssetOrder(sort, order string) string {
	field := "sort_order"
	switch sort {
	case "created_at", "updated_at", "id", "title":
		field = sort
	default:
		field = "sort_order"
	}
	dir := "DESC"
	if strings.EqualFold(order, "asc") {
		dir = "ASC"
	}
	return field + " " + dir + ", id DESC"
}

/* ------------------------------------------------------------------ 分类 */

// CategoryRepository 素材分类表访问。
type CategoryRepository struct {
	db *gorm.DB
}

// Create 新建分类。
func (r *CategoryRepository) Create(ctx context.Context, c *model.LibraryCategory) error {
	if err := r.db.WithContext(ctx).Create(c).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByID 按主键查分类。
func (r *CategoryRepository) FindByID(ctx context.Context, id uint64) (*model.LibraryCategory, error) {
	var c model.LibraryCategory
	if err := r.db.WithContext(ctx).First(&c, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrCategoryNotFound)
	}
	return &c, nil
}

// ExistsBySlug 判断分类标识是否被占用。
func (r *CategoryRepository) ExistsBySlug(ctx context.Context, slug string, excludeID uint64) (bool, error) {
	if strings.TrimSpace(slug) == "" {
		return false, nil
	}
	q := r.db.WithContext(ctx).Model(&model.LibraryCategory{}).Where("slug = ?", strings.TrimSpace(slug))
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return false, response.ErrInternal.WithCause(err)
	}
	return count > 0, nil
}

// UpdateFields 局部更新。
func (r *CategoryRepository) UpdateFields(ctx context.Context, id uint64, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	err := r.db.WithContext(ctx).Model(&model.LibraryCategory{}).Where("id = ?", id).Updates(fields).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// Delete 软删除分类。有素材引用时不允许删除，判定在 Service 层。
func (r *CategoryRepository) Delete(ctx context.Context, id uint64) error {
	if err := r.db.WithContext(ctx).Delete(&model.LibraryCategory{}, id).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// List 分类列表。
func (r *CategoryRepository) List(ctx context.Context, q dto.CategoryListQuery) ([]model.LibraryCategory, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.LibraryCategory{})
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("name LIKE ? OR slug LIKE ?", like, like)
	}
	if q.Status != nil {
		query = query.Where("status = ?", *q.Status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var list []model.LibraryCategory
	err := query.Order("sort_order DESC, id ASC").
		Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// ListAll 全部分类（供下拉与前台）。
func (r *CategoryRepository) ListAll(ctx context.Context, onlyEnabled bool) ([]model.LibraryCategory, error) {
	q := r.db.WithContext(ctx).Model(&model.LibraryCategory{})
	if onlyEnabled {
		q = q.Where("status = ?", model.CategoryStatusEnabled)
	}
	var list []model.LibraryCategory
	if err := q.Order("sort_order DESC, id ASC").Find(&list).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// CountAssets 统计分类下的素材数（含各状态），用于「有素材引用不能删」的判定。
func (r *CategoryRepository) CountAssets(ctx context.Context, categoryID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.LibraryAsset{}).
		Where("category_id = ?", categoryID).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}
