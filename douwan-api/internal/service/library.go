package service

import (
	"context"
	"fmt"
	"mime/multipart"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/admin"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/storage"
)

// LibraryService 素材库与分类管理（需求 §8）。
type LibraryService struct {
	db    *gorm.DB
	repos *repository.Repositories
	store *storage.Store
	audit *AuditLog
}

// NewLibraryService 构造素材库服务。
func NewLibraryService(db *gorm.DB, repos *repository.Repositories, store *storage.Store, audit *AuditLog) *LibraryService {
	return &LibraryService{db: db, repos: repos, store: store, audit: audit}
}

/* ------------------------------------------------------------------ 上传 */

// UploadResult 单张上传的内部结果，批量上传时汇总。
type UploadResult struct {
	Items  []dto.AssetItem
	Errors []dto.AssetUploadError
}

// Upload 上传素材（需求 §8.3）。
//
// 单张与批量走同一条路径：批量就是循环调用，某一张失败不影响其它张，
// 失败的会带上原因返回给前端，让运营可以只重试失败的那几张。
func (s *LibraryService) Upload(ctx context.Context, files []*multipart.FileHeader, form dto.AssetUploadForm, audit Audit) (*dto.AssetUploadResult, error) {
	result := &dto.AssetUploadResult{
		Items:  []dto.AssetItem{},
		Errors: []dto.AssetUploadError{},
	}
	if len(files) == 0 {
		return nil, response.ErrUploadRejected.WithMessage("请选择要上传的图片")
	}
	if form.CategoryID == 0 {
		return nil, response.ErrInvalidParam.WithMessage("请选择素材分类")
	}
	category, err := s.repos.Category.FindByID(ctx, form.CategoryID)
	if err != nil {
		return nil, err
	}

	status := form.Status
	if status == "" {
		status = model.AssetStatusDraft
	}
	if status != model.AssetStatusDraft && status != model.AssetStatusPublished {
		return nil, response.ErrInvalidParam.WithMessage("上传时状态只能是草稿或已发布")
	}
	tier := form.Tier
	if tier != "pro" {
		tier = "free"
	}

	result.Total = len(files)
	for idx, fh := range files {
		item, err := s.uploadOne(ctx, fh, form, category, status, tier, idx, audit)
		if err != nil {
			result.Failed++
			result.Errors = append(result.Errors, dto.AssetUploadError{
				Filename: filenameOf(fh),
				Reason:   errMessage(err),
			})
			continue
		}
		result.Success++
		result.Items = append(result.Items, *item)
	}

	if result.Success > 0 {
		s.audit.Write(ctx, s.repos, audit, ActionAssetUpload, "asset", "", "",
			fmt.Sprintf("上传素材 %d 张（成功 %d，失败 %d），分类：%s",
				result.Total, result.Success, result.Failed, category.Name))
	}
	if result.Success == 0 && result.Failed > 0 {
		return nil, response.ErrUploadRejected.WithMessage("全部图片上传失败：" + result.Errors[0].Reason)
	}
	return result, nil
}

func (s *LibraryService) uploadOne(ctx context.Context, fh *multipart.FileHeader, form dto.AssetUploadForm,
	category *model.LibraryCategory, status, tier string, idx int, audit Audit) (*dto.AssetItem, error) {

	saved, err := s.store.SaveUploaded(fh, "assets")
	if err != nil {
		return nil, err
	}
	thumbURL := saved.URL
	if thumb, err := s.store.SaveThumbnail(saved, "thumbnails"); err == nil {
		thumbURL = thumb.URL
	}
	// 缩略图生成失败不阻断上传：前台仍然能用原图展示，只是慢一点。

	title := dto.Trim(form.Title)
	if title == "" {
		title = strings.TrimSuffix(filenameOf(fh), fileExtOf(filenameOf(fh)))
	}
	// 批量上传时给同名文件加序号，避免标题与 slug 都完全一样
	if idx > 0 {
		title = fmt.Sprintf("%s-%d", title, idx+1)
	}
	if len([]rune(title)) > 128 {
		title = string([]rune(title)[:128])
	}

	slug, err := s.resolveAssetSlug(ctx, form.Slug, title, 0)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	asset := &model.LibraryAsset{
		Slug:         slug,
		Title:        title,
		ImageURL:     saved.URL,
		ThumbnailURL: thumbURL,
		ImageWidth:   saved.Width,
		ImageHeight:  saved.Height,
		FileSize:     saved.Size,
		MimeType:     saved.MimeType,
		StoredName:   saved.StoredName,
		CategoryID:   category.ID,
		CategoryName: category.Name,
		Tags:         normalizeTags(form.Tags),
		Description:  dto.Trim(form.Description),
		IsFeatured:   form.IsFeatured,
		SortOrder:    form.SortOrder,
		Status:       status,
		Tier:         tier,
		SourceNote:   dto.Trim(form.SourceNote),
		RightsNote:   dto.Trim(form.RightsNote),
		InnerNote:    dto.Trim(form.InnerNote),
		CreatedBy:    audit.AdminID,
		UpdatedBy:    audit.AdminID,
	}
	if status == model.AssetStatusPublished {
		asset.PublishedAt = &now
	}

	// slug 唯一索引是最终保证：ExistsBySlug 的查询与这里插入之间存在竞态，
	// 连续上传同名素材必然撞上。撞了就换一个后缀重试，而不是把错误抛给运营。
	const maxAttempts = 5
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			asset.Slug = fmt.Sprintf("%s-%s", slug, admin.RandomToken(6))
			asset.ID = 0
		}
		lastErr = s.repos.Asset.Create(ctx, asset)
		if lastErr == nil {
			item := toAssetItem(asset)
			return &item, nil
		}
		if !repository.IsDuplicateSlugErr(lastErr) {
			break
		}
	}
	// 入库失败就把刚落盘的文件删掉，别留孤儿文件
	s.store.Remove(saved.RelPath)
	s.store.Remove(strings.TrimPrefix(thumbURL, s.store.PublicPrefix()+"/"))
	if lastErr == nil {
		lastErr = response.ErrInternal.WithMessage("素材保存失败")
	}
	return nil, lastErr
}

/* ------------------------------------------------------------------ 列表与编辑 */

// List 后台素材列表。
func (s *LibraryService) List(ctx context.Context, q dto.AssetListQuery) (dto.PageResult[dto.AssetItem], error) {
	q.PageQuery.Normalize()
	list, total, err := s.repos.Asset.List(ctx, q)
	if err != nil {
		return dto.PageResult[dto.AssetItem]{}, err
	}
	items := make([]dto.AssetItem, 0, len(list))
	for i := range list {
		items = append(items, toAssetItem(&list[i]))
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// Detail 素材详情。
func (s *LibraryService) Detail(ctx context.Context, id uint64) (*dto.AssetItem, error) {
	asset, err := s.repos.Asset.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	item := toAssetItem(asset)
	return &item, nil
}

// Update 编辑素材（需求 §8.3）。
func (s *LibraryService) Update(ctx context.Context, id uint64, req dto.AssetUpdateRequest, audit Audit) (*dto.AssetItem, error) {
	asset, err := s.repos.Asset.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}

	fields := map[string]any{"updated_by": audit.AdminID}
	changes := make([]string, 0, 8)

	if req.Title != nil {
		title := dto.Trim(*req.Title)
		if title == "" {
			return nil, response.ErrInvalidParam.WithMessage("素材名称不能为空")
		}
		fields["title"] = title
		changes = append(changes, "名称")
	}
	if req.Slug != nil {
		slug := strings.TrimSpace(*req.Slug)
		if slug != "" {
			resolved, err := s.resolveAssetSlug(ctx, slug, asset.Title, asset.ID)
			if err != nil {
				return nil, err
			}
			fields["slug"] = resolved
			changes = append(changes, "标识")
		}
	}
	if req.CategoryID != nil {
		category, err := s.repos.Category.FindByID(ctx, *req.CategoryID)
		if err != nil {
			return nil, err
		}
		fields["category_id"] = category.ID
		fields["category_name"] = category.Name
		changes = append(changes, "分类")
	}
	if req.Tags != nil {
		fields["tags"] = jsonValue(normalizeTags(*req.Tags))
		changes = append(changes, "标签")
	}
	if req.Description != nil {
		fields["description"] = dto.Trim(*req.Description)
		changes = append(changes, "描述")
	}
	if req.ThumbnailURL != nil {
		thumb := dto.Trim(*req.ThumbnailURL)
		if thumb == "" {
			thumb = asset.ImageURL
		}
		fields["thumbnail_url"] = thumb
		changes = append(changes, "封面图")
	}
	if req.IsFeatured != nil {
		fields["is_featured"] = *req.IsFeatured
		changes = append(changes, "推荐状态")
	}
	if req.SortOrder != nil {
		fields["sort_order"] = *req.SortOrder
		changes = append(changes, "排序值")
	}
	if req.Tier != nil {
		fields["tier"] = *req.Tier
		changes = append(changes, "会员分层")
	}
	if req.SourceNote != nil {
		fields["source_note"] = dto.Trim(*req.SourceNote)
	}
	if req.RightsNote != nil {
		fields["rights_note"] = dto.Trim(*req.RightsNote)
	}
	if req.InnerNote != nil {
		fields["inner_note"] = dto.Trim(*req.InnerNote)
	}
	if req.Status != nil {
		if err := applyAssetStatus(fields, *req.Status, asset, changes); err != nil {
			return nil, err
		}
	}

	if err := s.repos.Asset.UpdateFields(ctx, id, fields); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionAssetUpdate, "asset", fmt.Sprint(id), asset.Title,
		"编辑素材："+strings.Join(changes, "、"))

	updated, err := s.repos.Asset.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	item := toAssetItem(updated)
	return &item, nil
}

// ChangeStatus 发布 / 下架 / 转草稿（需求 §8.3 上下架）。
func (s *LibraryService) ChangeStatus(ctx context.Context, id uint64, req dto.AssetStatusRequest, audit Audit) (*dto.AssetItem, error) {
	asset, err := s.repos.Asset.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{"updated_by": audit.AdminID}
	changes := make([]string, 0, 1)
	if err := applyAssetStatus(fields, req.Status, asset, changes); err != nil {
		return nil, err
	}
	if req.Reason != "" {
		fields["archived_reason"] = dto.Trim(req.Reason)
	}
	if err := s.repos.Asset.UpdateFields(ctx, id, fields); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionAssetStatus, "asset", fmt.Sprint(id), asset.Title,
		fmt.Sprintf("素材状态 %s → %s%s", model.AssetStatusLabel(asset.Status), model.AssetStatusLabel(req.Status),
			reasonSuffix(req.Reason)))

	updated, err := s.repos.Asset.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	item := toAssetItem(updated)
	return &item, nil
}

// BatchSort 批量调整排序与推荐（需求 §8.2 支持排序）。
func (s *LibraryService) BatchSort(ctx context.Context, req dto.AssetSortRequest, audit Audit) (int, error) {
	updated := 0
	for _, item := range req.Items {
		fields := map[string]any{"updated_by": audit.AdminID}
		if item.SortOrder != nil {
			fields["sort_order"] = *item.SortOrder
		}
		if item.IsFeatured != nil {
			fields["is_featured"] = *item.IsFeatured
		}
		if len(fields) == 1 {
			continue
		}
		if err := s.repos.Asset.UpdateFields(ctx, item.ID, fields); err != nil {
			return updated, err
		}
		updated++
	}
	if updated > 0 {
		s.audit.Write(ctx, s.repos, audit, ActionAssetSort, "asset", "", "",
			fmt.Sprintf("批量调整 %d 个素材的排序/推荐", updated))
	}
	return updated, nil
}

// Delete 删除素材。
//
// 已发布的素材必须先下架才能删除：直接删掉仓库里正在用的图片会让前台列表
// 出现坏图（需求 §8.3「已被用户作品引用的素材，优先采用下架/归档」）。
func (s *LibraryService) Delete(ctx context.Context, id uint64, reason string, audit Audit) error {
	asset, err := s.repos.Asset.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if asset.Status == model.AssetStatusPublished {
		return response.ErrAssetInUse.WithMessage("该素材还在前台展示中，请先下架（归档）再删除")
	}
	if err := s.repos.Asset.UpdateFields(ctx, id, map[string]any{
		"deleted_note": truncate(dto.Trim(reason), 255),
		"updated_by":   audit.AdminID,
	}); err != nil {
		return err
	}
	if err := s.repos.Asset.SoftDelete(ctx, id); err != nil {
		return err
	}
	// 注意：不删除磁盘上的原图与缩略图。历史作品可能还引用了这些地址，
	// 物理删除会造成「老作品打不开」。真要清理磁盘属于运维动作。
	s.audit.Write(ctx, s.repos, audit, ActionAssetDelete, "asset", fmt.Sprint(id), asset.Title,
		"删除素材（软删除，文件保留）"+reasonSuffix(reason))
	return nil
}

// Tags 汇总所有在用标签，供后台筛选与前端补全。
func (s *LibraryService) Tags(ctx context.Context, onlyPublished bool) ([]string, error) {
	if onlyPublished {
		return s.repos.Asset.ListTagsForPublished(ctx)
	}
	return s.repos.Asset.ListAllTags(ctx)
}

/* ------------------------------------------------------------------ 分类 */

// CategoryList 分类列表（带素材数量）。
func (s *LibraryService) CategoryList(ctx context.Context, q dto.CategoryListQuery) (dto.PageResult[dto.CategoryItem], error) {
	q.PageQuery.Normalize()
	list, total, err := s.repos.Category.List(ctx, q)
	if err != nil {
		return dto.PageResult[dto.CategoryItem]{}, err
	}
	counts, err := s.repos.Asset.CountByCategory(ctx)
	if err != nil {
		return dto.PageResult[dto.CategoryItem]{}, err
	}
	items := make([]dto.CategoryItem, 0, len(list))
	for i := range list {
		items = append(items, toCategoryItem(&list[i], counts[list[i].ID]))
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// CategoryOptions 全部分类（供上传表单的选择器使用，含已停用的）。
func (s *LibraryService) CategoryOptions(ctx context.Context, onlyEnabled bool) ([]dto.CategoryItem, error) {
	list, err := s.repos.Category.ListAll(ctx, onlyEnabled)
	if err != nil {
		return nil, err
	}
	counts, err := s.repos.Asset.CountByCategory(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]dto.CategoryItem, 0, len(list))
	for i := range list {
		items = append(items, toCategoryItem(&list[i], counts[list[i].ID]))
	}
	return items, nil
}

// CategoryCreate 新建分类。
func (s *LibraryService) CategoryCreate(ctx context.Context, req dto.CategoryRequest, audit Audit) (*dto.CategoryItem, error) {
	name := dto.Trim(req.Name)
	if name == "" {
		return nil, response.ErrInvalidParam.WithMessage("分类名称不能为空")
	}
	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = slugifyASCII(name)
		if slug == "" {
			slug = "cat"
		}
		base := slug
		for i := 1; i <= 50; i++ {
			exists, err := s.repos.Category.ExistsBySlug(ctx, slug, 0)
			if err != nil {
				return nil, err
			}
			if !exists {
				break
			}
			slug = fmt.Sprintf("%s_%d", base, i)
		}
	} else {
		exists, err := s.repos.Category.ExistsBySlug(ctx, slug, 0)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, response.ErrInvalidParam.WithMessage("分类标识已被占用")
		}
	}

	status := int8(model.CategoryStatusEnabled)
	if req.Status != nil {
		status = *req.Status
	}
	category := &model.LibraryCategory{
		Slug:        slug,
		Name:        name,
		Description: dto.Trim(req.Description),
		CoverURL:    dto.Trim(req.CoverURL),
		SortOrder:   req.SortOrder,
		Status:      status,
		CreatedBy:   audit.AdminID,
		UpdatedBy:   audit.AdminID,
	}
	if err := s.repos.Category.Create(ctx, category); err != nil {
		return nil, err
	}
	s.audit.Write(ctx, s.repos, audit, ActionCategoryCreate, "asset_category", fmt.Sprint(category.ID),
		category.Name, "新建素材分类")
	item := toCategoryItem(category, 0)
	return &item, nil
}

// CategoryUpdate 编辑分类。
func (s *LibraryService) CategoryUpdate(ctx context.Context, id uint64, req dto.CategoryRequest, audit Audit) (*dto.CategoryItem, error) {
	category, err := s.repos.Category.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	name := dto.Trim(req.Name)
	if name == "" {
		return nil, response.ErrInvalidParam.WithMessage("分类名称不能为空")
	}
	fields := map[string]any{
		"name":        name,
		"description": dto.Trim(req.Description),
		"cover_url":   dto.Trim(req.CoverURL),
		"sort_order":  req.SortOrder,
		"updated_by":  audit.AdminID,
	}
	if req.Status != nil {
		fields["status"] = *req.Status
	}
	if slug := strings.TrimSpace(req.Slug); slug != "" && slug != category.Slug {
		exists, err := s.repos.Category.ExistsBySlug(ctx, slug, id)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, response.ErrInvalidParam.WithMessage("分类标识已被占用")
		}
		fields["slug"] = slug
	}
	if err := s.repos.Category.UpdateFields(ctx, id, fields); err != nil {
		return nil, err
	}
	// 分类改名后同步素材上的冗余名称，避免列表显示旧分类名
	if name != category.Name {
		if err := s.db.WithContext(ctx).Model(&model.LibraryAsset{}).
			Where("category_id = ?", id).Update("category_name", name).Error; err != nil {
			return nil, response.ErrInternal.WithCause(err)
		}
	}
	s.audit.Write(ctx, s.repos, audit, ActionCategoryUpdate, "asset_category", fmt.Sprint(id), name,
		"编辑素材分类")

	updated, err := s.repos.Category.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	count, _ := s.repos.Category.CountAssets(ctx, id)
	item := toCategoryItem(updated, count)
	return &item, nil
}

// CategoryDelete 删除分类。有素材引用时拒绝（需求 §8.5）。
func (s *LibraryService) CategoryDelete(ctx context.Context, id uint64, audit Audit) error {
	category, err := s.repos.Category.FindByID(ctx, id)
	if err != nil {
		return err
	}
	count, err := s.repos.Category.CountAssets(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		s.audit.WriteFail(ctx, s.repos, audit, ActionCategoryDelete, "asset_category", fmt.Sprint(id),
			category.Name, fmt.Sprintf("拒绝删除：分类下还有 %d 个素材", count))
		return response.ErrCategoryInUse.WithMessage(fmt.Sprintf(
			"该分类下还有 %d 个素材，请先把素材迁移到其它分类，或者直接停用该分类。", count))
	}
	if err := s.repos.Category.Delete(ctx, id); err != nil {
		return err
	}
	s.audit.Write(ctx, s.repos, audit, ActionCategoryDelete, "asset_category", fmt.Sprint(id), category.Name,
		"删除素材分类")
	return nil
}

/* ------------------------------------------------------------------ 前台 */

// PublicAssets 前台素材列表（只要已发布，需求 §8.6）。
func (s *LibraryService) PublicAssets(ctx context.Context, q dto.PublicAssetQuery) (dto.PageResult[dto.PublicAssetItem], error) {
	q.PageQuery.Normalize()
	list, total, err := s.repos.Asset.ListPublished(ctx, q)
	if err != nil {
		return dto.PageResult[dto.PublicAssetItem]{}, err
	}
	items := make([]dto.PublicAssetItem, 0, len(list))
	for i := range list {
		items = append(items, toPublicAsset(&list[i]))
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// PublicAssetDetail 前台素材详情（按 slug）。
func (s *LibraryService) PublicAssetDetail(ctx context.Context, slug string) (*dto.PublicAssetItem, error) {
	asset, err := s.repos.Asset.FindBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	// 未发布的素材对外一律当作不存在，避免通过猜 slug 看到草稿
	if !asset.IsPublished() {
		return nil, response.ErrAssetNotFound
	}
	item := toPublicAsset(asset)
	return &item, nil
}

// PublicCategories 前台分类（只返回启用的）。
func (s *LibraryService) PublicCategories(ctx context.Context) ([]dto.PublicCategoryItem, error) {
	list, err := s.repos.Category.ListAll(ctx, true)
	if err != nil {
		return nil, err
	}
	counts, err := s.repos.Asset.CountByCategory(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]dto.PublicCategoryItem, 0, len(list))
	for i := range list {
		c := &list[i]
		out = append(out, dto.PublicCategoryItem{
			ID:         c.ID,
			Slug:       c.Slug,
			Name:       c.Name,
			CoverURL:   c.CoverURL,
			SortOrder:  c.SortOrder,
			AssetCount: counts[c.ID],
		})
	}
	return out, nil
}

/* ------------------------------------------------------------------ 内部 */

func applyAssetStatus(fields map[string]any, status string, asset *model.LibraryAsset, changes []string) error {
	now := time.Now()
	switch status {
	case model.AssetStatusDraft:
		fields["status"] = status
		fields["published_at"] = nil
		if asset.Status == model.AssetStatusPublished {
			fields["archived_at"] = now
		}
	case model.AssetStatusPublished:
		fields["status"] = status
		fields["archived_at"] = nil
		fields["archived_reason"] = ""
		if asset.PublishedAt == nil {
			fields["published_at"] = now
		}
	case model.AssetStatusArchived:
		fields["status"] = status
		fields["archived_at"] = now
	default:
		return response.ErrInvalidParam.WithMessage("素材状态不合法")
	}
	_ = changes
	return nil
}

func (s *LibraryService) resolveAssetSlug(ctx context.Context, want, title string, excludeID uint64) (string, error) {
	slug := strings.TrimSpace(want)
	if slug == "" {
		slug = slugifyASCII(title)
	}
	if slug == "" {
		// 中文标题生成不出 ASCII 时退回随机串（例如「E2E 素材」→ "e2e"，
		// 第二次同名上传就会撞唯一索引），随机串保证不撞车
		slug = "asset-" + admin.RandomToken(10)
	}
	base := slug
	for i := 1; i <= 50; i++ {
		exists, err := s.repos.Asset.ExistsBySlug(ctx, slug, excludeID)
		if err != nil {
			return "", err
		}
		if !exists {
			return slug, nil
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	return "asset-" + admin.RandomToken(12), nil
}

func toAssetItem(a *model.LibraryAsset) dto.AssetItem {
	tags := a.Tags
	if tags == nil {
		tags = []string{}
	}
	return dto.AssetItem{
		ID:             a.ID,
		Slug:           a.Slug,
		Title:          a.Title,
		ImageURL:       a.ImageURL,
		ThumbnailURL:   a.ThumbnailURL,
		ImageWidth:     a.ImageWidth,
		ImageHeight:    a.ImageHeight,
		FileSize:       a.FileSize,
		FileSizeText:   storage.HumanSize(a.FileSize),
		MimeType:       a.MimeType,
		StoredName:     a.StoredName,
		CategoryID:     a.CategoryID,
		CategoryName:   a.CategoryName,
		Tags:           tags,
		Description:    a.Description,
		IsFeatured:     a.IsFeatured,
		SortOrder:      a.SortOrder,
		Status:         a.Status,
		StatusText:     model.AssetStatusLabel(a.Status),
		Tier:           a.Tier,
		SourceNote:     a.SourceNote,
		RightsNote:     a.RightsNote,
		InnerNote:      a.InnerNote,
		CreatedBy:      a.CreatedBy,
		CreatedAt:      a.CreatedAt,
		UpdatedAt:      a.UpdatedAt,
		PublishedAt:    a.PublishedAt,
		ArchivedAt:     a.ArchivedAt,
		ArchivedReason: a.ArchivedReason,
	}
}

func toPublicAsset(a *model.LibraryAsset) dto.PublicAssetItem {
	tags := a.Tags
	if tags == nil {
		tags = []string{}
	}
	return dto.PublicAssetItem{
		ID:           a.ID,
		Slug:         a.Slug,
		Title:        a.Title,
		ImageURL:     a.ImageURL,
		ThumbnailURL: a.ThumbnailURL,
		CategoryID:   a.CategoryID,
		CategoryName: a.CategoryName,
		Tags:         tags,
		Description:  a.Description,
		IsFeatured:   a.IsFeatured,
		SortOrder:    a.SortOrder,
		Tier:         a.Tier,
		ImageWidth:   a.ImageWidth,
		ImageHeight:  a.ImageHeight,
		PublishedAt:  a.PublishedAt,
	}
}

func toCategoryItem(c *model.LibraryCategory, count int64) dto.CategoryItem {
	cover := c.CoverURL
	return dto.CategoryItem{
		ID:           c.ID,
		Slug:         c.Slug,
		Name:         c.Name,
		Description:  c.Description,
		CoverURL:     c.CoverURL,
		CoverPreview: cover,
		SortOrder:    c.SortOrder,
		Status:       c.Status,
		StatusText:   model.CategoryStatusLabel(c.Status),
		AssetCount:   count,
		CreatedAt:    c.CreatedAt,
		UpdatedAt:    c.UpdatedAt,
	}
}

func normalizeTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := map[string]bool{}
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		if len([]rune(t)) > 32 {
			t = string([]rune(t)[:32])
		}
		seen[t] = true
		if len(out) >= 20 {
			break
		}
		out = append(out, t)
	}
	return out
}

func filenameOf(fh *multipart.FileHeader) string {
	if fh == nil {
		return ""
	}
	return fh.Filename
}

func fileExtOf(name string) string {
	idx := strings.LastIndex(name, ".")
	if idx < 0 {
		return ""
	}
	return name[idx:]
}

// slugifyASCII 与套餐标识用的是同一套规则（只保留 ASCII 字母数字）。
func slugifyASCII(s string) string { return slugify(s) }

func reasonSuffix(reason string) string {
	if strings.TrimSpace(reason) == "" {
		return ""
	}
	return "，原因：" + dto.Trim(reason)
}
