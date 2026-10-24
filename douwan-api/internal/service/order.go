package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/admin"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// OrderService 订单管理（需求 §7）。
//
// 支付渠道尚未确定（需求 §18），所以这里刻意不绑定任何服务商：
// 订单只有通用的支付状态字段，人工确认收款是当前唯一的「已支付」来源。
// 将来接入真实渠道时，回调处理只需要调用 MarkPaid + IssueCards，
// 业务逻辑不用重写（需求 §7.4「先抽象订单支付接口/服务层」）。
type OrderService struct {
	db    *gorm.DB
	repos *repository.Repositories
	grant *GrantService
	audit *AuditLog
	// paymentMu 保护 paymentChannel：启动时由设置注入，运行期只读。
	paymentMu      sync.RWMutex
	paymentChannel string
}

// NewOrderService 构造订单服务。
func NewOrderService(db *gorm.DB, repos *repository.Repositories, grant *GrantService, audit *AuditLog, channel string) *OrderService {
	return &OrderService{db: db, repos: repos, grant: grant, audit: audit, paymentChannel: channel}
}

// SetPaymentChannel 设置当前生效的支付渠道标识（空表示尚未配置）。
//
// 由启动流程根据「系统设置」调用。管理员在后台改了支付配置后，
// 需要重启服务或触发一次运行时刷新，这一点在交付说明里写清楚了。
func (s *OrderService) SetPaymentChannel(channel string) {
	s.paymentMu.Lock()
	s.paymentChannel = channel
	s.paymentMu.Unlock()
}

// PaymentChannel 当前支付渠道。
func (s *OrderService) PaymentChannel() string {
	s.paymentMu.RLock()
	defer s.paymentMu.RUnlock()
	return s.paymentChannel
}

/* ------------------------------------------------------------------ 下单 */

// Create 创建订单（前台）。
//
// 快照是这段代码的重点：把套餐名、售价、权益全部拍照存进订单，
// 之后管理员改价或下架都不会影响这张历史订单（需求 §13.2）。
func (s *OrderService) Create(ctx context.Context, userID uint64, req dto.OrderCreateRequest) (*dto.OrderDetail, error) {
	order, err := s.buildOrder(ctx, userID, req)
	if err != nil {
		return nil, err
	}
	// 订单号理论上不会撞（秒级时间 + 8 位随机），但唯一索引是真的会拒绝，
	// 所以这里做一次重试：撞了就换一个订单号重来，而不是把错误抛给用户。
	const maxAttempts = 5
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			order.OrderNo = admin.NewOrderNo(time.Now())
			slog.WarnContext(ctx, "订单号冲突，重试", "attempt", attempt, "order_no", order.OrderNo)
		}
		err = database.WithTx(ctx, s.db, func(tx *gorm.DB) error {
			repos := s.repos.WithTx(tx)
			if err := repos.Order.Create(ctx, order); err != nil {
				return err
			}
			return repos.Order.AppendEvent(ctx, &model.OrderEvent{
				OrderID:   order.ID,
				OrderNo:   order.OrderNo,
				Action:    "create",
				ToState:   model.PaymentStatusPending,
				Note:      fmt.Sprintf("用户下单套餐「%s」，应付 ¥%.2f", order.PlanName, order.AmountDue),
				AdminID:   0,
				AdminName: order.UserAccount,
			})
		})
		if err == nil {
			return s.Detail(ctx, order.ID)
		}
		lastErr = err
		if !isDuplicateKey(err) {
			return nil, err
		}
		// 主键是自增的，重试前必须清掉上一次尝试残留的 ID，
		// 否则 GORM 会拿旧 ID 去 INSERT（主键冲突而不是订单号冲突）。
		order.ID = 0
	}
	slog.ErrorContext(ctx, "订单号连续冲突，放弃", "err", lastErr)
	return nil, response.ErrInternal.WithMessage("生成订单号失败，请稍后重试")
}

// isDuplicateKey 判断错误是否是唯一索引冲突。
//
// 两个来源都要认：GORM 在 TranslateError 打开时会给 ErrDuplicatedKey，
// 但 SQLite 内存库那条路径不一定翻译，所以再按错误文案兜一层。
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "订单号重复") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "UNIQUE constraint failed")
}

// buildOrder 组装订单实体（校验套餐、价格快照、重复购买限制）。
func (s *OrderService) buildOrder(ctx context.Context, userID uint64, req dto.OrderCreateRequest) (*model.Order, error) {
	if userID == 0 {
		return nil, response.ErrUnauthorized.WithMessage("请先登录后再下单")
	}
	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !user.IsActive() {
		return nil, response.ErrAccountDisabled
	}

	plan, err := s.repos.Plan.FindByID(ctx, req.PlanID)
	if err != nil {
		return nil, err
	}
	// 草稿 / 下架套餐不能下单（需求 §13.9）
	if !plan.IsPublished() {
		return nil, response.ErrPlanNotSellable.WithMessage(fmt.Sprintf(
			"套餐「%s」当前是「%s」状态，不能下单。", plan.Name, model.PlanStatusLabel(plan.Status)))
	}

	quantity := req.Quantity
	if quantity <= 0 {
		quantity = 1
	}

	// 不允许重复购买时，校验该用户是否已有进行中或已支付的同套餐订单
	if !plan.AllowRepeatPurchase {
		existing, err := s.findActiveOrderForPlan(ctx, userID, plan.ID)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return nil, response.ErrOrderNotPayable.WithMessage(fmt.Sprintf(
				"该套餐不允许重复购买，你已有一笔订单「%s」（%s）",
				existing.OrderNo, model.PaymentStatusLabel(existing.PaymentStatus)))
		}
	}

	now := time.Now()
	return &model.Order{
		OrderNo:           admin.NewOrderNo(now),
		UserID:            userID,
		UserAccount:       user.Username,
		PlanID:            plan.ID,
		PlanSnapshot:      plan.Snapshot(),
		PlanName:          plan.Name,
		Quantity:          quantity,
		AmountDue:         round2(plan.Price * float64(quantity)),
		AmountPaid:        0,
		PaymentMethod:     model.PaymentMethodUnset,
		PaymentStatus:     model.PaymentStatusPending,
		FulfillmentStatus: model.FulfillmentPending,
		Note:              dto.Trim(req.Note),
	}, nil
}

func (s *OrderService) findActiveOrderForPlan(ctx context.Context, userID, planID uint64) (*model.Order, error) {
	var list []model.Order
	err := s.db.WithContext(ctx).Where("user_id = ? AND plan_id = ?", userID, planID).
		Where("payment_status IN ?", []string{model.PaymentStatusPending, model.PaymentStatusPaid}).
		Order("id DESC").Limit(1).Find(&list).Error
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	if len(list) == 0 {
		return nil, nil
	}
	return &list[0], nil
}

/* ------------------------------------------------------------------ 查询 */

// List 订单列表。
func (s *OrderService) List(ctx context.Context, q dto.OrderListQuery) (dto.PageResult[dto.OrderItem], error) {
	q.PageQuery.Normalize()
	list, total, err := s.repos.Order.List(ctx, q)
	if err != nil {
		return dto.PageResult[dto.OrderItem]{}, err
	}
	names := s.loadAdminNames(ctx, list)
	items := make([]dto.OrderItem, 0, len(list))
	for i := range list {
		items = append(items, toOrderItem(&list[i], names))
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// Detail 订单详情，含状态变化记录与关联卡密。
func (s *OrderService) Detail(ctx context.Context, id uint64) (*dto.OrderDetail, error) {
	order, err := s.repos.Order.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	events, err := s.repos.Order.ListEvents(ctx, id)
	if err != nil {
		return nil, err
	}
	cards, err := s.repos.CardKey.ListByOrder(ctx, id)
	if err != nil {
		return nil, err
	}

	names := s.loadAdminNames(ctx, []model.Order{*order})
	detail := &dto.OrderDetail{
		OrderItem: toOrderItem(order, names),
		Events:    make([]dto.OrderEventItem, 0, len(events)),
		Cards:     make([]dto.CardKeyItem, 0, len(cards)),
	}
	for _, e := range events {
		detail.Events = append(detail.Events, dto.OrderEventItem{
			ID:         e.ID,
			Action:     e.Action,
			ActionText: eventActionText(e.Action),
			FromState:  e.FromState,
			ToState:    e.ToState,
			Note:       e.Note,
			AdminID:    e.AdminID,
			AdminName:  e.AdminName,
			CreatedAt:  e.CreatedAt,
		})
	}
	// 卡密一律脱敏：订单详情页不提供明文导出，需要明文请到卡密管理页操作
	for i := range cards {
		detail.Cards = append(detail.Cards, dto.CardKeyItem{
			ID:                   cards[i].ID,
			CodeMasked:           cards[i].CodeMasked,
			PlanID:               cards[i].PlanID,
			PlanName:             cards[i].PlanName,
			BatchID:              cards[i].BatchID,
			BatchName:            cards[i].BatchName,
			Status:               cards[i].Status,
			StatusText:           model.CardStatusLabel(cards[i].Status),
			RedeemExpiresAt:      cards[i].RedeemExpiresAt,
			IssuedAt:             cards[i].IssuedAt,
			OrderID:              cards[i].OrderID,
			OrderNo:              cards[i].OrderNo,
			RedeemedBy:           cards[i].RedeemedBy,
			RedeemedAt:           cards[i].RedeemedAt,
			EntitlementID:        cards[i].EntitlementID,
			EntitlementExpiresAt: cards[i].EntitlementExpiresAt,
			CreatedAt:            cards[i].CreatedAt,
		})
	}
	return detail, nil
}

/* ------------------------------------------------------------------ 人工确认收款 */

// Settle 人工确认收款，并可选立刻发卡（需求 §6.6 / §7.3）。
//
// 这是「还没接支付渠道」时唯一的收款入口，所以要求：
//   - 二次确认（前端负责，后端要求必填备注）；
//   - 记录管理员 ID 与时间；
//   - 幂等：重复点击第二次不会重复改金额、也不会重复发卡。
func (s *OrderService) Settle(ctx context.Context, id uint64, req dto.OrderSettleRequest, audit Audit) (*dto.OrderDetail, error) {
	order, err := s.repos.Order.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if order.PaymentStatus == model.PaymentStatusPaid {
		return nil, response.ErrOrderNotPayable.WithMessage("该订单已经确认过收款，无需重复操作")
	}
	if order.PaymentStatus == model.PaymentStatusClosed {
		return nil, response.ErrOrderClosed
	}

	amount := order.AmountDue
	if req.AmountPaid != nil {
		amount = round2(*req.AmountPaid)
	}
	if amount < 0 {
		return nil, response.ErrInvalidParam.WithMessage("实付金额不能为负数")
	}
	method := req.PaymentMethod
	if method == "" {
		method = model.PaymentMethodManual
	}
	if method != model.PaymentMethodManual && s.PaymentChannel() == "" {
		return nil, response.ErrPaymentDisabled.WithMessage(
			"尚未配置真实支付渠道，只能使用「人工确认」方式标注收款")
	}

	now := time.Now()
	fields := map[string]any{
		"amount_paid":            amount,
		"payment_method":         method,
		"payment_transaction_id": dto.Trim(req.TransactionID),
		"paid_confirmed_by":      audit.AdminID,
		"paid_confirmed_at":      now,
	}
	ok, err := s.repos.Order.MarkPaid(ctx, id, fields, now)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, response.ErrOrderNotPayable.WithMessage("订单状态已变化，请刷新后再试")
	}

	s.audit.Write(ctx, s.repos, audit, ActionOrderSettle, "order", order.OrderNo, order.PlanName,
		fmt.Sprintf("人工确认收款 ¥%.2f（%s），备注：%s", amount, model.PaymentMethodLabel(method), req.Note))
	_ = s.repos.Order.AppendEvent(ctx, &model.OrderEvent{
		OrderID:   order.ID,
		OrderNo:   order.OrderNo,
		Action:    "settle",
		FromState: model.PaymentStatusPending,
		ToState:   model.PaymentStatusPaid,
		Note:      fmt.Sprintf("管理员人工确认收款 ¥%.2f：%s", amount, req.Note),
		AdminID:   audit.AdminID,
		AdminName: audit.AdminName,
	})

	if req.IssueCards {
		if _, err := s.IssueCards(ctx, id, dto.OrderIssueRequest{Note: req.Note}, audit); err != nil {
			// 收款已确认成功，发卡失败不应该让整个请求报错（否则管理员会以为钱也没收到）
			return s.DetailWithWarning(ctx, id, "收款已确认，但发卡失败："+errMessage(err))
		}
	}
	return s.Detail(ctx, id)
}

// DetailWithWarning 在详情上附一条提示（发卡失败但仍要返回收款结果时用）。
func (s *OrderService) DetailWithWarning(ctx context.Context, id uint64, warning string) (*dto.OrderDetail, error) {
	detail, err := s.Detail(ctx, id)
	if err != nil {
		return nil, err
	}
	detail.Note = strings.TrimSpace(detail.Note + " | " + warning)
	return detail, nil
}

/* ------------------------------------------------------------------ 发卡 */

// IssueCards 给已支付订单发放卡密（需求 §6.6）。
//
// 幂等与原子性的做法：
//  1. 在一个事务里先执行条件更新 ClaimFulfillment（只有 pending → issued 能成功），
//     影响行数为 0 说明已经发过了，直接返回「请勿重复发放」；
//  2. 挑出该套餐下未使用的卡密并挂到订单上；
//  3. 为订单直接发放一份权益（用户不必自己去兑换自己买的卡）；
//  4. 回填发放数量。
//
// 任何一步失败都回滚，状态回到 pending，管理员可以安全重试。
func (s *OrderService) IssueCards(ctx context.Context, id uint64, req dto.OrderIssueRequest, audit Audit) (*dto.OrderDetail, error) {
	order, err := s.repos.Order.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// 未支付订单不能发卡（需求 §13.6）
	if !order.CanIssueCards() {
		return nil, response.ErrOrderNotPaid.WithMessage(fmt.Sprintf(
			"订单当前支付状态是「%s」，不能发放卡密", model.PaymentStatusLabel(order.PaymentStatus)))
	}
	if order.PaymentStatus == model.PaymentStatusRefunded {
		return nil, response.ErrOrderNotPayable.WithMessage("该订单已退款，不能发放卡密")
	}
	if order.FulfillmentStatus == model.FulfillmentIssued {
		return nil, response.ErrAlreadyIssued
	}

	need := order.Quantity * s.cardQuantityForOrder(ctx, order)
	if need <= 0 {
		need = 1
	}

	now := time.Now()
	var issuedCount int
	err = database.WithTx(ctx, s.db, func(tx *gorm.DB) error {
		repos := s.repos.WithTx(tx)

		claimed, err := repos.Order.ClaimFulfillment(ctx, order.ID, audit.AdminID, now)
		if err != nil {
			return err
		}
		if !claimed {
			return response.ErrAlreadyIssued
		}

		ids, err := repos.CardKey.PendingCardIDs(ctx, order.PlanID, need)
		if err != nil {
			return err
		}
		if len(ids) < need {
			return response.ErrNoCardStock.WithMessage(fmt.Sprintf(
				"库存不足：该订单需要 %d 张「%s」的卡密，当前可发放 %d 张，请先生成卡密",
				need, order.PlanName, len(ids)))
		}

		attached, err := repos.CardKey.AttachOrder(ctx, ids, order, now)
		if err != nil {
			return err
		}
		if int(attached) != need {
			// 并发下别的订单抢走了同一批卡密，整笔回滚，让管理员重试
			return response.ErrNoCardStock.WithMessage("卡密库存刚刚被其他订单占用，请稍后重试")
		}
		issuedCount = int(attached)

		// 订单直接发放权益：用户买了就该拿到权益，不必再自己去兑换卡密。
		// 卡密仍然挂在订单上可查看（线下交付或转赠场景）。
		grantSvc := NewGrantService(repos, s.audit)
		if _, err := grantSvc.Grant(ctx, repos, GrantInput{
			UserID:   order.UserID,
			Account:  order.UserAccount,
			PlanID:   order.PlanID,
			Snapshot: order.PlanSnapshot,
			Source:   model.EntitlementSourceOrder,
			SourceID: order.ID,
			SourceNo: order.OrderNo,
			OrderID:  order.ID,
			Note:     fmt.Sprintf("订单 %s 发放", order.OrderNo),
			AdminID:  audit.AdminID,
			Now:      now,
		}); err != nil {
			return err
		}

		return repos.Order.CompleteFulfillment(ctx, order.ID, map[string]any{
			"card_issued_count": issuedCount,
			"updated_at":        now,
		})
	})
	if err != nil {
		return nil, err
	}

	s.audit.Write(ctx, s.repos, audit, ActionOrderIssue, "order", order.OrderNo, order.PlanName,
		fmt.Sprintf("发放 %d 张卡密并开通权益，备注：%s", issuedCount, req.Note))
	_ = s.repos.Order.AppendEvent(ctx, &model.OrderEvent{
		OrderID:   order.ID,
		OrderNo:   order.OrderNo,
		Action:    "issue_cards",
		FromState: model.FulfillmentPending,
		ToState:   model.FulfillmentIssued,
		Note:      fmt.Sprintf("发放 %d 张卡密并开通权益：%s", issuedCount, req.Note),
		AdminID:   audit.AdminID,
		AdminName: audit.AdminName,
	})

	return s.Detail(ctx, id)
}

// cardQuantityForOrder 取「一份订单发几张卡密」。
//
// 优先用套餐当前的配置（管理员可能刚把发卡数量从 1 改成 2），
// 套餐已被删除时兜底成 1 张——发卡不能因为配置查不到就失败。
func (s *OrderService) cardQuantityForOrder(ctx context.Context, order *model.Order) int {
	plan, err := s.repos.Plan.FindByID(ctx, order.PlanID)
	if err != nil || plan == nil {
		return 1
	}
	return defaultInt(plan.CardQuantity, 1)
}

/* ------------------------------------------------------------------ 关闭 / 退款 */

// Close 关闭 / 取消订单。
func (s *OrderService) Close(ctx context.Context, id uint64, req dto.OrderCloseRequest, audit Audit) (*dto.OrderDetail, error) {
	order, err := s.repos.Order.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	ok, err := s.repos.Order.Close(ctx, id, dto.Trim(req.Reason), now)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, response.ErrOrderNotPayable.WithMessage(fmt.Sprintf(
			"只有「待支付」的订单可以关闭，当前状态是「%s」", model.PaymentStatusLabel(order.PaymentStatus)))
	}

	s.audit.Write(ctx, s.repos, audit, ActionOrderClose, "order", order.OrderNo, order.PlanName,
		"关闭订单，原因："+dto.Trim(req.Reason))
	_ = s.repos.Order.AppendEvent(ctx, &model.OrderEvent{
		OrderID:   order.ID,
		OrderNo:   order.OrderNo,
		Action:    "close",
		FromState: model.PaymentStatusPending,
		ToState:   model.PaymentStatusClosed,
		Note:      dto.Trim(req.Reason),
		AdminID:   audit.AdminID,
		AdminName: audit.AdminName,
	})

	// 已发卡的订单被关闭时，作废其未使用的卡密，避免流出
	if err := s.voidUnusedCardsOfOrder(ctx, order, audit, "订单关闭，卡密随之作废"); err != nil {
		return nil, err
	}
	return s.Detail(ctx, id)
}

// MarkRefunded 标记已退款。
//
// 这里刻意只做状态标记，不做「假装退款成功」：真实退款必须由支付渠道完成，
// 未接入渠道时管理员线下退款后来这里记账（需求 §7.3 允许这种人工受控流程）。
func (s *OrderService) MarkRefunded(ctx context.Context, id uint64, note string, audit Audit) (*dto.OrderDetail, error) {
	order, err := s.repos.Order.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	ok, err := s.repos.Order.MarkRefunded(ctx, id, dto.Trim(note), now)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, response.ErrOrderNotPayable.WithMessage("只有「已支付」的订单可以标记退款")
	}
	s.audit.Write(ctx, s.repos, audit, ActionOrderRefund, "order", order.OrderNo, order.PlanName,
		"标记退款，备注："+dto.Trim(note))
	_ = s.repos.Order.AppendEvent(ctx, &model.OrderEvent{
		OrderID:   order.ID,
		OrderNo:   order.OrderNo,
		Action:    "refund",
		FromState: model.PaymentStatusPaid,
		ToState:   model.PaymentStatusRefunded,
		Note:      dto.Trim(note),
		AdminID:   audit.AdminID,
		AdminName: audit.AdminName,
	})
	return s.Detail(ctx, id)
}

func (s *OrderService) voidUnusedCardsOfOrder(ctx context.Context, order *model.Order, audit Audit, reason string) error {
	cards, err := s.repos.CardKey.ListByOrder(ctx, order.ID)
	if err != nil {
		return err
	}
	ids := make([]uint64, 0, len(cards))
	for i := range cards {
		if cards[i].Status == model.CardStatusUnused {
			ids = append(ids, cards[i].ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	count, err := s.repos.CardKey.Void(ctx, ids, audit.AdminID, reason, time.Now())
	if err != nil {
		return err
	}
	if count > 0 {
		s.audit.Write(ctx, s.repos, audit, ActionCardVoid, "order", order.OrderNo, order.PlanName,
			fmt.Sprintf("订单关闭，作废 %d 张未使用卡密", count))
	}
	return nil
}

/* ------------------------------------------------------------------ 内部 */

// loadAdminNames 批量取管理员昵称，供订单里「谁确认的收款」展示。
func (s *OrderService) loadAdminNames(ctx context.Context, orders []model.Order) map[uint64]string {
	out := make(map[uint64]string, len(orders))
	ids := make([]uint64, 0, len(orders))
	seen := make(map[uint64]bool, len(orders))
	for _, o := range orders {
		for _, id := range []uint64{o.PaidConfirmedBy, o.FulfilledBy} {
			if id > 0 && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	if len(ids) == 0 {
		return out
	}
	var admins []model.Admin
	if err := s.db.WithContext(ctx).Where("id IN ?", ids).Find(&admins).Error; err != nil {
		return out
	}
	for _, a := range admins {
		name := a.Nickname
		if name == "" {
			name = a.Username
		}
		out[a.ID] = name
	}
	return out
}

func toOrderItem(o *model.Order, adminNames map[uint64]string) dto.OrderItem {
	return dto.OrderItem{
		ID:                   o.ID,
		OrderNo:              o.OrderNo,
		UserID:               o.UserID,
		UserAccount:          o.UserAccount,
		PlanID:               o.PlanID,
		PlanName:             o.PlanName,
		PlanSnapshot:         o.PlanSnapshot,
		Quantity:             o.Quantity,
		AmountDue:            o.AmountDue,
		AmountPaid:           o.AmountPaid,
		PaymentMethod:        o.PaymentMethod,
		PaymentMethodText:    model.PaymentMethodLabel(o.PaymentMethod),
		PaymentStatus:        o.PaymentStatus,
		PaymentStatusText:    model.PaymentStatusLabel(o.PaymentStatus),
		FulfillmentStatus:    o.FulfillmentStatus,
		FulfillmentText:      model.FulfillmentStatusLabel(o.FulfillmentStatus),
		PaymentTransactionID: o.PaymentTransactionID,
		PaidAt:               o.PaidAt,
		ClosedAt:             o.ClosedAt,
		RefundedAt:           o.RefundedAt,
		FulfilledAt:          o.FulfilledAt,
		PaidConfirmedBy:      o.PaidConfirmedBy,
		PaidConfirmName:      adminNames[o.PaidConfirmedBy],
		PaidConfirmedAt:      o.PaidConfirmedAt,
		FulfilledBy:          o.FulfilledBy,
		FulfilledByName:      adminNames[o.FulfilledBy],
		CardIssuedCount:      o.CardIssuedCount,
		Note:                 o.Note,
		CreatedAt:            o.CreatedAt,
		UpdatedAt:            o.UpdatedAt,
	}
}

func eventActionText(action string) string {
	switch action {
	case "create":
		return "创建订单"
	case "settle":
		return "人工确认收款"
	case "issue_cards":
		return "发放卡密"
	case "close":
		return "关闭订单"
	case "refund":
		return "标记退款"
	default:
		return action
	}
}

// round2 把金额四舍五入到两位小数，避免浮点误差写出 19.900000000000002。
func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func errMessage(err error) string {
	if err == nil {
		return ""
	}
	return response.From(err).Message
}
