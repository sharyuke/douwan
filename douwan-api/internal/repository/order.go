package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// OrderRepository 订单表访问。
type OrderRepository struct {
	db *gorm.DB
}

// Create 新建订单。
func (r *OrderRepository) Create(ctx context.Context, o *model.Order) error {
	if err := r.db.WithContext(ctx).Create(o).Error; err != nil {
		if isDuplicateKeyErr(err) {
			return response.ErrInvalidParam.WithMessage("订单号重复，请重试")
		}
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// isDuplicateKeyErr 判断是否是唯一索引冲突（跨 PostgreSQL 与 SQLite 都要认）。
func isDuplicateKeyErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "UNIQUE constraint failed")
}

// FindByID 按主键查订单。
func (r *OrderRepository) FindByID(ctx context.Context, id uint64) (*model.Order, error) {
	var o model.Order
	if err := r.db.WithContext(ctx).First(&o, id).Error; err != nil {
		return nil, wrapNotFound(err, response.ErrOrderNotFound)
	}
	return &o, nil
}

// FindByOrderNo 按订单号查订单。
func (r *OrderRepository) FindByOrderNo(ctx context.Context, orderNo string) (*model.Order, error) {
	var o model.Order
	err := r.db.WithContext(ctx).Where("order_no = ?", strings.TrimSpace(orderNo)).First(&o).Error
	if err != nil {
		return nil, wrapNotFound(err, response.ErrOrderNotFound)
	}
	return &o, nil
}

// List 分页查询订单。
func (r *OrderRepository) List(ctx context.Context, q dto.OrderListQuery) ([]model.Order, int64, error) {
	query := r.applyFilter(r.db.WithContext(ctx).Model(&model.Order{}), q)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}

	var list []model.Order
	err := query.Order("id DESC").Offset(q.Offset()).Limit(q.Limit()).Find(&list).Error
	if err != nil {
		return nil, 0, response.ErrInternal.WithCause(err)
	}
	return list, total, nil
}

// ListRecent 最近若干订单，供概览页与用户详情使用。
func (r *OrderRepository) ListRecent(ctx context.Context, limit int) ([]model.Order, error) {
	if limit <= 0 {
		limit = 5
	}
	var list []model.Order
	if err := r.db.WithContext(ctx).Order("id DESC").Limit(limit).Find(&list).Error; err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

// ListByUser 某个用户的订单。
func (r *OrderRepository) ListByUser(ctx context.Context, userID uint64, limit int) ([]model.Order, error) {
	if limit <= 0 {
		limit = 50
	}
	var list []model.Order
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).
		Order("id DESC").Limit(limit).Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}

func (r *OrderRepository) applyFilter(query *gorm.DB, q dto.OrderListQuery) *gorm.DB {
	if q.OrderNo != "" {
		query = query.Where("order_no = ?", strings.TrimSpace(q.OrderNo))
	}
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("order_no LIKE ? OR user_account LIKE ? OR plan_name LIKE ?", like, like, like)
	}
	if q.UserID > 0 {
		query = query.Where("user_id = ?", q.UserID)
	}
	if q.PlanID > 0 {
		query = query.Where("plan_id = ?", q.PlanID)
	}
	if q.PaymentStatus != "" {
		query = query.Where("payment_status = ?", q.PaymentStatus)
	}
	if q.FulfillStatus != "" {
		query = query.Where("fulfillment_status = ?", q.FulfillStatus)
	}
	if q.PaymentMethod != "" {
		query = query.Where("payment_method = ?", q.PaymentMethod)
	}
	if from, ok := parseDayStart(q.CreatedFrom); ok {
		query = query.Where("created_at >= ?", from)
	}
	if to, ok := parseDayEnd(q.CreatedTo); ok {
		query = query.Where("created_at <= ?", to)
	}
	return query
}

/* ------------------------------------------------------------------ 状态流转 */

// MarkPaid 标记已支付（人工确认收款）。
//
// 条件里保留 payment_status = pending：重复点击「确认收款」时第二次影响行数为 0，
// 调用方据此告诉管理员「这笔已经确认过了」，而不是又写一遍流水（需求 §13.5）。
func (r *OrderRepository) MarkPaid(ctx context.Context, id uint64, fields map[string]any, now time.Time) (bool, error) {
	fields["payment_status"] = model.PaymentStatusPaid
	fields["paid_at"] = now
	fields["updated_at"] = now
	res := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("id = ?", id).
		Where("payment_status = ?", model.PaymentStatusPending).
		Updates(fields)
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

// ClaimFulfillment 认领发卡权：把 fulfillment_status 从 pending 改成 issued。
//
// 这是「同一订单只发一次卡」的关键（需求 §13.5）。用条件更新而不是
// 先查后改，保证并发或重复回调下只有一个请求能认领成功。
// 真正的卡密关联在认领之后做，失败时把状态改回 failed 以便重试。
func (r *OrderRepository) ClaimFulfillment(ctx context.Context, id uint64, adminID uint64, now time.Time) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("id = ?", id).
		Where("payment_status = ?", model.PaymentStatusPaid).
		Where("fulfillment_status = ?", model.FulfillmentPending).
		Updates(map[string]any{
			"fulfillment_status": model.FulfillmentIssued,
			"fulfilled_at":       now,
			"fulfilled_by":       adminID,
			"updated_at":         now,
		})
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

// CompleteFulfillment 发卡成功后回填实际发了几张卡。
func (r *OrderRepository) CompleteFulfillment(ctx context.Context, id uint64, fields map[string]any) error {
	err := r.db.WithContext(ctx).Model(&model.Order{}).Where("id = ?", id).Updates(fields).Error
	if err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// MarkFulfillmentFailed 发卡失败：状态改成待处理，方便人工重试。
func (r *OrderRepository) MarkFulfillmentFailed(ctx context.Context, id uint64, note string, now time.Time) error {
	return r.CompleteFulfillment(ctx, id, map[string]any{
		"fulfillment_status": model.FulfillmentFailed,
		"fulfilled_at":       nil,
		"note":               note,
		"updated_at":         now,
	})
}

// Close 关闭 / 取消订单。只有待支付的订单能被关闭。
func (r *OrderRepository) Close(ctx context.Context, id uint64, reason string, now time.Time) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("id = ?", id).
		Where("payment_status = ?", model.PaymentStatusPending).
		Updates(map[string]any{
			"payment_status":     model.PaymentStatusClosed,
			"fulfillment_status": model.FulfillmentCanceled,
			"closed_at":          now,
			"note":               reason,
			"updated_at":         now,
		})
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

// MarkRefunded 标记已退款。只在真实支付渠道支持退款时调用，
// 未接入支付时走人工流程（需求 §7.3：不得假装退款成功）。
func (r *OrderRepository) MarkRefunded(ctx context.Context, id uint64, note string, now time.Time) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("id = ?", id).
		Where("payment_status = ?", model.PaymentStatusPaid).
		Updates(map[string]any{
			"payment_status": model.PaymentStatusRefunded,
			"refunded_at":    now,
			"note":           note,
			"updated_at":     now,
		})
	if res.Error != nil {
		return false, response.ErrInternal.WithCause(res.Error)
	}
	return res.RowsAffected == 1, nil
}

/* ------------------------------------------------------------------ 统计 */

// CountCreatedBetween 统计区间内创建的订单数。
func (r *OrderRepository) CountCreatedBetween(ctx context.Context, from, to time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("created_at >= ? AND created_at < ?", from, to).Count(&count).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	return count, nil
}

// SumPaidBetween 统计区间内已支付订单的实付金额。
//
// 只统计 payment_status = paid：退款订单不算进收入（需求 §4
// 「金额统计只统计已支付订单；退款订单应单独标识，不得混入净收入统计」）。
func (r *OrderRepository) SumPaidBetween(ctx context.Context, from, to time.Time) (float64, error) {
	var sum *float64
	err := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("payment_status = ?", model.PaymentStatusPaid).
		Where("paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?", from, to).
		Select("COALESCE(SUM(amount_paid), 0)").Scan(&sum).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	if sum == nil {
		return 0, nil
	}
	return *sum, nil
}

// SumPaidTotal 累计已支付金额（不限时间）。
func (r *OrderRepository) SumPaidTotal(ctx context.Context) (float64, error) {
	var sum *float64
	err := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("payment_status = ?", model.PaymentStatusPaid).
		Select("COALESCE(SUM(amount_paid), 0)").Scan(&sum).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	if sum == nil {
		return 0, nil
	}
	return *sum, nil
}

// SumRefundedTotal 累计已退款金额，单独展示，不混入收入。
func (r *OrderRepository) SumRefundedTotal(ctx context.Context) (float64, error) {
	var sum *float64
	err := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("payment_status = ?", model.PaymentStatusRefunded).
		Select("COALESCE(SUM(amount_paid), 0)").Scan(&sum).Error
	if err != nil {
		return 0, response.ErrInternal.WithCause(err)
	}
	if sum == nil {
		return 0, nil
	}
	return *sum, nil
}

// CountByUser 统计某个用户的订单总数与已支付金额。
func (r *OrderRepository) CountByUser(ctx context.Context, userID uint64) (int64, float64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Order{}).
		Where("user_id = ?", userID).Count(&count).Error
	if err != nil {
		return 0, 0, response.ErrInternal.WithCause(err)
	}
	var sum *float64
	err = r.db.WithContext(ctx).Model(&model.Order{}).
		Where("user_id = ? AND payment_status = ?", userID, model.PaymentStatusPaid).
		Select("COALESCE(SUM(amount_paid), 0)").Scan(&sum).Error
	if err != nil {
		return 0, 0, response.ErrInternal.WithCause(err)
	}
	if sum == nil {
		return count, 0, nil
	}
	return count, *sum, nil
}

/* ------------------------------------------------------------------ 状态变化记录 */

// AppendEvent 写一条订单状态变化记录。
func (r *OrderRepository) AppendEvent(ctx context.Context, e *model.OrderEvent) error {
	if err := r.db.WithContext(ctx).Create(e).Error; err != nil {
		return response.ErrInternal.WithCause(err)
	}
	return nil
}

// ListEvents 取某个订单的状态变化记录（时间正序）。
func (r *OrderRepository) ListEvents(ctx context.Context, orderID uint64) ([]model.OrderEvent, error) {
	var list []model.OrderEvent
	err := r.db.WithContext(ctx).Where("order_id = ?", orderID).
		Order("id ASC").Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	return list, nil
}
