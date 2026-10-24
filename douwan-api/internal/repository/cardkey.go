package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// CardKeyRepository 卡密表访问。
type CardKeyRepository struct {
	db *gorm.DB
}

// CreateBatch 批量插入卡密。整批放在一个事务里，
// 避免「生成 1000 张只成功 300 张」这种对不上账的状态。
func (r *CardKeyRepository) CreateBatch(ctx context.Context, cards []*model.CardKey) error {
	if len(cards) == 0 {
		return nil
	}
	err := r.db.WithContext(ctx).CreateInBatches(cards, 200).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// FindByCodeHash 按哈希查卡密。兑换流程的第一步。
func (r *CardKeyRepository) FindByCodeHash(ctx context.Context, hash string) (*model.CardKey, error) {
	var c model.CardKey
	if err := r.db.WithContext(ctx).Where("code_hash = ?", hash).First(&c).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrCardNotFound)
	}
	return &c, nil
}

// FindByID 按主键查卡密。
func (r *CardKeyRepository) FindByID(ctx context.Context, id uint64) (*model.CardKey, error) {
	var c model.CardKey
	if err := r.db.WithContext(ctx).First(&c, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrCardNotFound)
	}
	return &c, nil
}

// FindByIDs 批量查。
func (r *CardKeyRepository) FindByIDs(ctx context.Context, ids []uint64) ([]model.CardKey, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var list []model.CardKey
	if err := r.db.WithContext(ctx).Where("id IN ?", ids).Find(&list).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// RedeemClaim 原子地把一张卡密标记成已兑换。
//
// 这里用「条件更新 + 检查影响行数」而不是「先查再改」：
// 先查再改在两个并发请求下会双双通过判断，同一张卡密被兑换两次。
// 条件更新由数据库保证只有一行能被改到，影响行数为 0 就说明
// 别的请求已经抢到了（或者卡密在此期间被作废 / 过期）。
func (r *CardKeyRepository) RedeemClaim(ctx context.Context, id uint64, now time.Time) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("id = ?", id).
		Where("status = ?", model.CardStatusUnused).
		Where("redeem_expires_at IS NULL OR redeem_expires_at > ?", now).
		Updates(map[string]any{
			"status":      model.CardStatusRedeemed,
			"redeemed_at": now,
			"updated_at":  now,
		})
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

// AttachRedeemResult 在权益发放成功后回填兑换人、权益与订单信息。
//
// 兑换流程分两步（先占位再回填）是为了让「卡密状态」与「权益」在同一事务里
// 一致：占位与权益创建在同一个事务中，任何一步失败都整体回滚，
// 不会出现「卡密显示已兑换但用户没有权益」（需求 §6.5 / §13.4）。
func (r *CardKeyRepository) AttachRedeemResult(ctx context.Context, id uint64, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	err := r.db.WithContext(ctx).Model(&model.CardKey{}).Where("id = ?", id).Updates(fields).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// Void 作废卡密。只允许未使用的卡密被作废（已兑换的不能通过普通操作作废）。
func (r *CardKeyRepository) Void(ctx context.Context, ids []uint64, adminID uint64, reason string, now time.Time) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	res := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("id IN ?", ids).
		Where("status = ?", model.CardStatusUnused).
		Updates(map[string]any{
			"status":      model.CardStatusVoided,
			"voided_by":   adminID,
			"voided_at":   now,
			"void_reason": reason,
			"updated_at":  now,
		})
	if res.Error != nil {
		return 0, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected, nil
}

// CountVoidable 统计这批 id 里有多少张是可以作废的，用于执行前的二次确认提示。
func (r *CardKeyRepository) CountVoidable(ctx context.Context, ids []uint64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("id IN ?", ids).Where("status = ?", model.CardStatusUnused).
		Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// PendingCardIDs 取某个套餐下若干张可用于发卡的卡密 ID。
//
// 只取未使用、且尚未挂到任何订单上的卡密：已经挂给别的订单的卡密
// 不能再发给第二个人（那会造成一码多卖）。
func (r *CardKeyRepository) PendingCardIDs(ctx context.Context, planID uint64, limit int) ([]uint64, error) {
	if limit <= 0 {
		return nil, nil
	}
	var ids []uint64
	err := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("plan_id = ? AND status = ? AND (order_id = 0 OR order_id IS NULL)",
			planID, model.CardStatusUnused).
		Order("id ASC").Limit(limit).Pluck("id", &ids).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return ids, nil
}

// AttachOrder 把一批未使用的卡密挂到订单上（发卡）。
// 条件里限定 status = unused，保证不会把已兑换的卡密再发给别的订单。
func (r *CardKeyRepository) AttachOrder(ctx context.Context, ids []uint64, order *model.Order, now time.Time) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	res := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("id IN ?", ids).
		Where("status = ?", model.CardStatusUnused).
		Updates(map[string]any{
			"order_id":         order.ID,
			"order_no":         order.OrderNo,
			"issued_at":        now,
			"intended_user_id": order.UserID,
			"updated_at":       now,
		})
	if res.Error != nil {
		return 0, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected, nil
}

// ListByOrder 取某个订单关联的卡密。
func (r *CardKeyRepository) ListByOrder(ctx context.Context, orderID uint64) ([]model.CardKey, error) {
	var list []model.CardKey
	err := r.db.WithContext(ctx).Where("order_id = ?", orderID).Order("id ASC").Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// CountUnusedByPlan 统计某个套餐下还有多少张未使用的卡密（发卡时的库存检查）。
func (r *CardKeyRepository) CountUnusedByPlan(ctx context.Context, planID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("plan_id = ? AND status = ?", planID, model.CardStatusUnused).
		Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// List 分页查询卡密。
func (r *CardKeyRepository) List(ctx context.Context, q dto.CardKeyListQuery, now time.Time) ([]model.CardKey, int64, error) {
	query := r.applyFilter(r.db.WithContext(ctx).Model(&model.CardKey{}), q, now)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var list []model.CardKey
	err := query.Order("id DESC").Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// ListForExport 按同样条件取一批用于导出，最多 limit 条。
func (r *CardKeyRepository) ListForExport(ctx context.Context, q dto.CardKeyListQuery, limit int) ([]model.CardKey, error) {
	if limit <= 0 || limit > 50000 {
		limit = 50000
	}
	query := r.applyFilter(r.db.WithContext(ctx).Model(&model.CardKey{}), q, time.Now())
	var list []model.CardKey
	err := query.Order("id ASC").Limit(limit).Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// applyFilter 把查询条件翻译成 SQL。列表与导出共用，保证「看到什么就导出什么」。
func (r *CardKeyRepository) applyFilter(query *gorm.DB, q dto.CardKeyListQuery, now time.Time) *gorm.DB {
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		norm := normalizeKeyword(kw)
		// 卡密列存的是带连字符的脱敏串（ABCD-****-…），运营搜索时可能带连字符、
		// 也可能只复制了前几位而不带连字符，所以两种都匹配；
		// code_prefix 是去掉连字符的前 8 位，专门覆盖最常见的后者。
		query = query.Where(
			"code_masked LIKE ? OR code_prefix LIKE ? OR batch_name LIKE ? OR batch_id LIKE ? OR order_no LIKE ?",
			"%"+kw+"%", "%"+norm+"%", "%"+kw+"%", "%"+kw+"%", "%"+kw+"%")
	}
	if q.Status != "" {
		query = query.Where("status = ?", q.Status)
	}
	if q.PlanID > 0 {
		query = query.Where("plan_id = ?", q.PlanID)
	}
	if q.BatchID != "" {
		query = query.Where("batch_id = ?", q.BatchID)
	}
	if q.BatchName != "" {
		query = query.Where("batch_name LIKE ?", "%"+q.BatchName+"%")
	}
	if q.OrderNo != "" {
		query = query.Where("order_no = ?", q.OrderNo)
	}
	if q.UserID > 0 {
		query = query.Where("redeemed_by = ?", q.UserID)
	}
	if from, ok := parseDayStart(q.CreatedFrom); ok {
		query = query.Where("created_at >= ?", from)
	}
	if to, ok := parseDayEnd(q.CreatedTo); ok {
		query = query.Where("created_at <= ?", to)
	}
	if from, ok := parseDayStart(q.RedeemedFrom); ok {
		query = query.Where("redeemed_at >= ?", from)
	}
	if to, ok := parseDayEnd(q.RedeemedTo); ok {
		query = query.Where("redeemed_at <= ?", to)
	}
	if q.ExpiringInDays > 0 {
		deadline := now.AddDate(0, 0, q.ExpiringInDays)
		query = query.Where("status = ?", model.CardStatusUnused).
			Where("redeem_expires_at IS NOT NULL AND redeem_expires_at <= ?", deadline)
	}
	return query
}

// BatchSummary 按批次汇总卡密数量，供批次视图使用。
func (r *CardKeyRepository) BatchSummary(ctx context.Context, limit int, planID uint64) ([]dto.CardKeyBatch, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	type row struct {
		BatchID   string
		BatchName string
		PlanID    uint64
		PlanName  string
		Total     int64
		Unused    int64
		Redeemed  int64
		Voided    int64
		Expired   int64
		CreatedAt time.Time
	}
	var rows []row
	q := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Select(`batch_id,
		        MAX(batch_name) AS batch_name,
		        MAX(plan_id) AS plan_id,
		        MAX(plan_name) AS plan_name,
		        COUNT(*) AS total,
		        SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) AS unused,
		        SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed,
		        SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END) AS voided,
		        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
		        MIN(created_at) AS created_at`).
		Where("batch_id <> ''").
		Group("batch_id").
		Order("created_at DESC").
		Limit(limit)
	if planID > 0 {
		q = q.Where("plan_id = ?", planID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}

	out := make([]dto.CardKeyBatch, 0, len(rows))
	for _, row := range rows {
		out = append(out, dto.CardKeyBatch{
			BatchID:   row.BatchID,
			BatchName: row.BatchName,
			PlanID:    row.PlanID,
			PlanName:  row.PlanName,
			Total:     row.Total,
			Unused:    row.Unused,
			Redeemed:  row.Redeemed,
			Voided:    row.Voided,
			Expired:   row.Expired,
			CreatedAt: row.CreatedAt,
		})
	}
	return out, nil
}

// CountByStatus 统计某个状态的卡密数量。
func (r *CardKeyRepository) CountByStatus(ctx context.Context, status string) (int64, error) {
	q := r.db.WithContext(ctx).Model(&model.CardKey{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// CountCreatedSince 统计某时刻之后生成的卡密（今日生成数）。
func (r *CardKeyRepository) CountCreatedSince(ctx context.Context, since time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("created_at >= ?", since).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// MarkExpired 把已过兑换截止时间但仍标记为未使用的卡密刷成已过期。
//
// 这是一个「展示口径」修正：兑换时本来就按时间判断（见 RedeemClaim 的条件），
// 这里只是让后台列表的状态列不会一直显示「未使用」。
func (r *CardKeyRepository) MarkExpired(ctx context.Context, now time.Time) (int64, error) {
	res := r.db.WithContext(ctx).Model(&model.CardKey{}).
		Where("status = ?", model.CardStatusUnused).
		Where("redeem_expires_at IS NOT NULL AND redeem_expires_at <= ?", now).
		Updates(map[string]any{"status": model.CardStatusExpired, "updated_at": now})
	if res.Error != nil {
		return 0, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected, nil
}

// normalizeKeyword 把用户输入的卡密去掉连字符与空格，让「输入带连字符」
// 和「输入不带连字符」都能搜到同一张卡。
func normalizeKeyword(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(s)) {
		if r == '-' || r == ' ' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
