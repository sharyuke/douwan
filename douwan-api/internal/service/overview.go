package service

import (
	"context"
	"sync"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
)

// OverviewService 数据概览（需求 §4）。
// 原则：**不伪造数据**。没有真实支付渠道时，概览页明确显示「支付暂未接入」，
// 金额一律来自 payment_status = paid 的订单，退款单独列出、不混进净收入。
type OverviewService struct {
	db    *gorm.DB
	repos *repository.Repositories
	// paymentMu 保护 paymentChannel，与 OrderService 同样的用法
	paymentMu      sync.RWMutex
	paymentChannel string
}

// NewOverviewService 构造概览服务。
func NewOverviewService(db *gorm.DB, repos *repository.Repositories, paymentChannel string) *OverviewService {
	return &OverviewService{db: db, repos: repos, paymentChannel: paymentChannel}
}

// SetPaymentChannel 注入当前生效的支付渠道（空表示尚未接入）。
func (s *OverviewService) SetPaymentChannel(channel string) {
	s.paymentMu.Lock()
	s.paymentChannel = channel
	s.paymentMu.Unlock()
}

func (s *OverviewService) channel() string {
	s.paymentMu.RLock()
	defer s.paymentMu.RUnlock()
	return s.paymentChannel
}

// Load 组装概览数据。
func (s *OverviewService) Load(ctx context.Context) (*dto.OverviewResult, error) {
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	tomorrow := todayStart.AddDate(0, 0, 1)

	cards := dto.OverviewCards{}
	var err error

	if cards.TodayOrderCount, err = s.repos.Order.CountCreatedBetween(ctx, todayStart, tomorrow); err != nil {
		return nil, err
	}
	if cards.TodayPaidAmount, err = s.repos.Order.SumPaidBetween(ctx, todayStart, tomorrow); err != nil {
		return nil, err
	}
	if cards.TotalPaidAmount, err = s.repos.Order.SumPaidTotal(ctx); err != nil {
		return nil, err
	}

	cards.CardGenerated, err = s.repos.CardKey.CountByStatus(ctx, "")
	if err != nil {
		return nil, err
	}
	if cards.CardUnused, err = s.repos.CardKey.CountByStatus(ctx, model.CardStatusUnused); err != nil {
		return nil, err
	}
	if cards.CardRedeemed, err = s.repos.CardKey.CountByStatus(ctx, model.CardStatusRedeemed); err != nil {
		return nil, err
	}
	if cards.CardVoided, err = s.repos.CardKey.CountByStatus(ctx, model.CardStatusVoided); err != nil {
		return nil, err
	}
	if cards.AssetPublished, err = s.repos.Asset.CountByStatus(ctx, model.AssetStatusPublished); err != nil {
		return nil, err
	}
	if cards.AssetDraft, err = s.repos.Asset.CountByStatus(ctx, model.AssetStatusDraft); err != nil {
		return nil, err
	}
	if cards.UserTotal, err = s.repos.User.CountUsers(ctx); err != nil {
		return nil, err
	}
	if cards.PlanPublished, err = s.repos.Plan.CountPublished(ctx); err != nil {
		return nil, err
	}
	if cards.TodayRedeemCount, err = s.repos.Entitlement.CountRedeemedSince(ctx, todayStart); err != nil {
		return nil, err
	}
	if cards.TodayNewUserCount, err = s.repos.User.CountCreatedSince(ctx, todayStart); err != nil {
		return nil, err
	}

	refundTotal, err := s.repos.Order.SumRefundedTotal(ctx)
	if err != nil {
		return nil, err
	}

	featured, err := s.repos.Asset.CountFeatured(ctx)
	if err != nil {
		return nil, err
	}
	categories, err := s.repos.Category.ListAll(ctx, false)
	if err != nil {
		return nil, err
	}

	// 最近记录
	recentOrders, err := s.repos.Order.ListRecent(ctx, 5)
	if err != nil {
		return nil, err
	}
	orderItems := make([]dto.OrderItem, 0, len(recentOrders))
	for i := range recentOrders {
		orderItems = append(orderItems, toOrderItem(&recentOrders[i], nil))
	}

	recentEnts, err := s.repos.Entitlement.ListRecent(ctx, 5)
	if err != nil {
		return nil, err
	}
	nowTime := time.Now()
	entItems := make([]dto.EntitlementItem, 0, len(recentEnts))
	for i := range recentEnts {
		entItems = append(entItems, ToEntitlementItem(&recentEnts[i], nowTime, "", ""))
	}

	recentAssets, err := s.repos.Asset.ListRecent(ctx, 5)
	if err != nil {
		return nil, err
	}
	assetItems := make([]dto.AssetItem, 0, len(recentAssets))
	for i := range recentAssets {
		assetItems = append(assetItems, toAssetItem(&recentAssets[i]))
	}

	payment := dto.OverviewPayment{
		ChannelConfigured: s.channel() != "",
		ChannelName:       model.PaymentMethodLabel(s.channel()),
		ManualOnly:        s.channel() == "",
	}
	if payment.ChannelConfigured {
		payment.Notice = "已配置支付渠道：" + payment.ChannelName + "。金额统计只包含已支付订单，退款单独列出。"
	} else {
		payment.ChannelName = "待配置"
		payment.Notice = "支付暂未接入：当前订单需要管理员在「订单管理」里人工确认收款后才发放卡密。金额统计以人工确认的已支付订单为准。"
	}
	// 净收入 = 已支付 − 已退款。两个数字都单独展示，避免被误读成真实营收。
	payment.NetPaidAmount = round2(cards.TotalPaidAmount - refundTotal)

	return &dto.OverviewResult{
		Cards: cards,
		Recent: dto.OverviewRecent{
			Orders:      orderItems,
			Redemptions: entItems,
			Assets:      assetItems,
		},
		Payment: payment,
		Assets: dto.OverviewAssets{
			CategoryTotal: int64(len(categories)),
			FeaturedTotal: featured,
		},
		GeneratedAt: now,
	}, nil
}

// AdminUserService 后台用户列表（需求 §9）。
type AdminUserService struct {
	repos *repository.Repositories
}

// NewAdminUserService 构造后台用户服务。
func NewAdminUserService(repos *repository.Repositories) *AdminUserService {
	return &AdminUserService{repos: repos}
}

// List 用户列表。
func (s *AdminUserService) List(ctx context.Context, q dto.AdminUserListQuery) (dto.PageResult[dto.AdminUserItem], error) {
	q.PageQuery.Normalize()
	rows, total, err := s.repos.User.ListAdmin(ctx, q)
	if err != nil {
		return dto.PageResult[dto.AdminUserItem]{}, err
	}
	now := time.Now()
	items := make([]dto.AdminUserItem, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		isPro := r.PlanCode != "" && r.PlanCode != model.PlanFree &&
			(r.ExpireAt == nil || r.ExpireAt.After(now))
		planName := "免费版"
		if isPro {
			planName = r.PlanCode
		}
		items = append(items, dto.AdminUserItem{
			ID:            r.ID,
			Username:      r.Username,
			Nickname:      r.Nickname,
			Email:         maskEmail(r.Email),
			Phone:         maskPhone(r.Phone),
			Status:        r.Status,
			CreatedAt:     r.CreatedAt,
			LastLoginAt:   r.LastLoginAt,
			OrderCount:    r.OrderCount,
			PaidAmount:    round2(r.PaidAmount),
			RedeemedCount: r.RedeemedCount,
			PlanCode:      r.PlanCode,
			PlanName:      planName,
			IsPro:         isPro,
			ExpireAt:      r.ExpireAt,
			CreditBalance: r.CreditBalance,
		})
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// Detail 单个用户的资料与权益（供「用户与兑换记录」页展开查看）。
func (s *AdminUserService) Detail(ctx context.Context, userID uint64) (map[string]any, error) {
	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	membership, err := s.repos.Membership.FindByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	account, err := s.repos.Credit.FindAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	orderCount, paid, err := s.repos.Order.CountByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	entCount, err := s.repos.Entitlement.CountByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	if _, err := s.repos.Entitlement.ExpireOverdue(ctx, now); err != nil {
		return nil, err
	}
	active, err := s.repos.Entitlement.FindActiveByUser(ctx, userID, now)
	if err != nil {
		return nil, err
	}
	ents := make([]dto.EntitlementItem, 0, len(active))
	for i := range active {
		ents = append(ents, ToEntitlementItem(&active[i], now, user.Username, user.Nickname))
	}

	orders, err := s.repos.Order.ListByUser(ctx, userID, 20)
	if err != nil {
		return nil, err
	}
	orderItems := make([]dto.OrderItem, 0, len(orders))
	for i := range orders {
		orderItems = append(orderItems, toOrderItem(&orders[i], nil))
	}

	planCode := model.PlanFree
	var expireAt *time.Time
	if membership != nil {
		planCode = membership.Plan
		expireAt = membership.ExpireAt
	}
	balance := 0
	if account != nil {
		balance = account.Balance
	}

	return map[string]any{
		"user": map[string]any{
			"id":            user.ID,
			"username":      user.Username,
			"nickname":      user.Nickname,
			"email":         maskEmail(user.Email),
			"phone":         maskPhone(user.Phone),
			"status":        user.Status,
			"created_at":    user.CreatedAt,
			"last_login_at": user.LastLoginAt,
		},
		"membership": map[string]any{
			"plan_code": planCode,
			"expire_at": expireAt,
			"is_pro":    planCode != model.PlanFree && (expireAt == nil || expireAt.After(now)),
		},
		"credits":             map[string]any{"balance": balance},
		"order_count":         orderCount,
		"paid_amount":         round2(paid),
		"entitlement_count":   entCount,
		"active_entitlements": ents,
		"orders":              orderItems,
	}, nil
}

// AdminLogService 操作日志查询（需求 §11）。
type AdminLogService struct {
	repos *repository.Repositories
}

// NewAdminLogService 构造日志服务。
func NewAdminLogService(repos *repository.Repositories) *AdminLogService {
	return &AdminLogService{repos: repos}
}

// List 日志列表。
func (s *AdminLogService) List(ctx context.Context, q dto.OperationLogQuery) (dto.PageResult[dto.OperationLogItem], error) {
	q.PageQuery.Normalize()
	list, total, err := s.repos.Log.List(ctx, q)
	if err != nil {
		return dto.PageResult[dto.OperationLogItem]{}, err
	}
	items := make([]dto.OperationLogItem, 0, len(list))
	for i := range list {
		l := &list[i]
		items = append(items, dto.OperationLogItem{
			ID:         l.ID,
			AdminID:    l.AdminID,
			AdminName:  l.AdminName,
			AdminRole:  l.AdminRole,
			Action:     l.Action,
			ActionText: firstNonEmpty(l.ActionText, ActionText(l.Action)),
			TargetType: l.TargetType,
			TargetID:   l.TargetID,
			TargetName: l.TargetName,
			Result:     l.Result,
			ResultText: model.LogResultLabel(l.Result),
			Details:    l.Details,
			IP:         l.IP,
			CreatedAt:  l.CreatedAt,
		})
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

/* ------------------------------------------------------------------ 小工具 */

func maskEmail(s string) string {
	s = dto.Trim(s)
	if s == "" {
		return ""
	}
	at := -1
	for i, r := range s {
		if r == '@' {
			at = i
			break
		}
	}
	if at <= 0 {
		return "***"
	}
	local := s[:at]
	if len(local) <= 2 {
		return "**" + s[at:]
	}
	return local[:1] + "***" + local[len(local)-1:] + s[at:]
}

func maskPhone(s string) string {
	s = dto.Trim(s)
	if len(s) < 7 {
		if s == "" {
			return ""
		}
		return "***"
	}
	return s[:3] + "****" + s[len(s)-4:]
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if dto.Trim(v) != "" {
			return v
		}
	}
	return ""
}
