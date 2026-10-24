package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/admin"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// CardKeyService 卡密管理（需求 §6）。
type CardKeyService struct {
	db     *gorm.DB
	repos  *repository.Repositories
	cipher *admin.Cipher
	cfg    CardKeyConfig
	audit  *AuditLog
}

// CardKeyConfig 是卡密服务需要的配置。
type CardKeyConfig struct {
	// CipherSecret 同时用作哈希 pepper 与明文加密密钥。
	// 更换它会让已发出的卡密无法再解密展示（哈希校验也会失效）。
	CipherSecret          string
	MaxGeneratePerRequest int
	CodeLength            int
}

// NewCardKeyService 构造卡密服务。
func NewCardKeyService(db *gorm.DB, repos *repository.Repositories, cipher *admin.Cipher, cfg CardKeyConfig, audit *AuditLog) *CardKeyService {
	if cfg.MaxGeneratePerRequest <= 0 {
		cfg.MaxGeneratePerRequest = 1000
	}
	if cfg.CodeLength < 12 {
		cfg.CodeLength = admin.DefaultCodeLength
	}
	return &CardKeyService{db: db, repos: repos, cipher: cipher, cfg: cfg, audit: audit}
}

// CipherEnabled 报告明文查看 / 导出能力是否可用（未配置密钥时为 false）。
func (s *CardKeyService) CipherEnabled() bool { return s.cipher.Enabled() }

/* ------------------------------------------------------------------ 生成 */

// Generate 批量生成卡密（需求 §6.3）。
//
// 明文只在这里返回一次：列表默认给脱敏串，要看明文必须走带权限的 Reveal 接口
// 并留日志。生成返回明文是为了让管理员能立刻导出交付，不然这批卡密就废了。
func (s *CardKeyService) Generate(ctx context.Context, req dto.CardKeyGenerateRequest, audit Audit) (*dto.CardKeyBatchResult, error) {
	if req.Count < 1 {
		return nil, response.ErrInvalidParam.WithMessage("生成数量至少为 1")
	}
	if req.Count > s.cfg.MaxGeneratePerRequest {
		return nil, response.ErrInvalidParam.WithMessage(fmt.Sprintf(
			"单次最多生成 %d 张，请分批生成", s.cfg.MaxGeneratePerRequest))
	}
	plan, err := s.repos.Plan.FindByID(ctx, req.PlanID)
	if err != nil {
		return nil, err
	}
	if plan.Status == model.PlanStatusArchived {
		return nil, response.ErrPlanInvalid.WithMessage("已下架的套餐不能生成新卡密，请先重新上架或另建套餐")
	}
	/* 没配权益的套餐（典型是还没配置就拿来试的草稿）生成的卡密，
	   兑换时会「成功」但一个功能都解锁不了。这种卡必须在生成时就拦住，
	   否则用户拿到的是一张看起来有效、实际没用的卡。 */
	if len(plan.FeaturePermissions) == 0 {
		return nil, response.ErrPlanInvalid.WithMessage("这个套餐没有配置任何权益，兑换后不会解锁任何功能；请先在「套餐管理」里配置权益再生成卡密")
	}
	if req.RedeemExpiresAt != nil && !req.RedeemExpiresAt.After(time.Now()) {
		return nil, response.ErrInvalidParam.WithMessage("兑换截止日期必须晚于当前时间")
	}

	snapshot := plan.Snapshot()
	now := time.Now()
	batchID := admin.NewBatchID(now)
	batchName := dto.Trim(req.BatchName)
	if batchName == "" {
		batchName = plan.Name + " 批次"
	}

	codes := make([]string, 0, req.Count)
	cards := make([]*model.CardKey, 0, req.Count)
	seen := make(map[string]bool, req.Count)
	for i := 0; i < req.Count; i++ {
		// 理论碰撞概率极低，但「不生成重复卡密」是验收项，
		// 所以这里额外做一次批内去重 + 生成时的唯一索引兜底。
		var code string
		for attempt := 0; attempt < 5; attempt++ {
			generated, err := admin.GenerateCode(s.cfg.CodeLength)
			if err != nil {
				return nil, response.ErrInternal.WithCause(err)
			}
			if !seen[admin.NormalizeCode(generated)] {
				code = generated
				break
			}
		}
		if code == "" {
			return nil, response.ErrInternal.WithCause(fmt.Errorf("生成唯一卡密失败"))
		}
		normalized := admin.NormalizeCode(code)
		seen[normalized] = true

		ciphertext, err := s.cipher.Encrypt(code)
		if err != nil {
			// 没有配置加密密钥时降级：只存哈希与脱敏串，明文仅在本次返回，
			// 之后无法再查看（这是「没配密钥」的可见代价，比阻塞业务好）。
			ciphertext = ""
		}
		codes = append(codes, admin.FormatCode(code))
		cards = append(cards, &model.CardKey{
			CodeHash:        admin.HashCode(normalized, s.cfg.CipherSecret),
			CodeCiphertext:  ciphertext,
			CodeMasked:      admin.MaskCode(normalized),
			CodePrefix:      admin.SearchPrefix(normalized),
			PlanID:          plan.ID,
			PlanSnapshot:    snapshot,
			PlanName:        plan.Name,
			BatchID:         batchID,
			BatchName:       batchName,
			Status:          model.CardStatusUnused,
			RedeemExpiresAt: req.RedeemExpiresAt,
			Note:            dto.Trim(req.Note),
			CreatedBy:       audit.AdminID,
		})
	}

	if err := s.repos.CardKey.CreateBatch(ctx, cards); err != nil {
		return nil, err
	}

	s.audit.Write(ctx, s.repos, audit, ActionCardGenerate, "card_batch", batchID, batchName,
		fmt.Sprintf("为套餐「%s」生成 %d 张卡密（批次 %s）", plan.Name, req.Count, batchID))

	return &dto.CardKeyBatchResult{
		BatchID:   batchID,
		BatchName: batchName,
		PlanID:    plan.ID,
		PlanName:  plan.Name,
		Count:     len(cards),
		CreatedAt: now,
		Codes:     codes,
	}, nil
}

/* ------------------------------------------------------------------ 查询 */

// List 卡密列表。includeCode 为 true 时（调用方已校验 card.reveal 权限）
// 才返回明文，否则只给脱敏串。
func (s *CardKeyService) List(ctx context.Context, q dto.CardKeyListQuery, includeCode bool) (dto.PageResult[dto.CardKeyItem], error) {
	q.PageQuery.Normalize()
	if _, err := s.repos.CardKey.MarkExpired(ctx, time.Now()); err != nil {
		return dto.PageResult[dto.CardKeyItem]{}, err
	}

	list, total, err := s.repos.CardKey.List(ctx, q, time.Now())
	if err != nil {
		return dto.PageResult[dto.CardKeyItem]{}, err
	}
	accounts := s.loadAccounts(ctx, list)

	items := make([]dto.CardKeyItem, 0, len(list))
	for i := range list {
		items = append(items, s.toItem(ctx, &list[i], accounts[list[i].RedeemedBy], includeCode))
	}
	return dto.NewPageResult(items, total, q.PageQuery), nil
}

// Reveal 查看 / 复制明文。调用方必须已校验 card.reveal 权限。
// 每次查看都会写一条日志（需求 §6.7「限制明文卡密的访问范围并记录查看行为」）。
func (s *CardKeyService) Reveal(ctx context.Context, ids []uint64, audit Audit) (map[uint64]string, error) {
	if !s.cipher.Enabled() {
		return nil, response.ErrInvalidParam.WithMessage(
			"服务端未配置卡密加密密钥，无法查看历史卡密明文。请在配置中设置 admin.card_cipher_key 后新生成的卡密才可查看。")
	}
	cards, err := s.repos.CardKey.FindByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	if len(cards) == 0 {
		return nil, response.ErrCardNotFound
	}

	out := make(map[uint64]string, len(cards))
	for i := range cards {
		c := &cards[i]
		if c.CodeCiphertext == "" {
			out[c.ID] = ""
			continue
		}
		plain, err := s.cipher.Decrypt(c.CodeCiphertext)
		if err != nil {
			out[c.ID] = ""
			continue
		}
		out[c.ID] = plain
	}

	masked := make([]string, 0, len(cards))
	for i := range cards {
		masked = append(masked, cards[i].CodeMasked)
	}
	s.audit.Write(ctx, s.repos, audit, ActionCardReveal, "card_key", "", "",
		fmt.Sprintf("查看 %d 张卡密明文，脱敏串：%s", len(cards), strings.Join(masked, "、")))

	return out, nil
}

// Batches 批次汇总。
func (s *CardKeyService) Batches(ctx context.Context, limit int, planID uint64) ([]dto.CardKeyBatch, error) {
	if _, err := s.repos.CardKey.MarkExpired(ctx, time.Now()); err != nil {
		return nil, err
	}
	return s.repos.CardKey.BatchSummary(ctx, limit, planID)
}

/* ------------------------------------------------------------------ 作废 */

// Void 作废卡密（需求 §6.4）。
//
// 只允许作废「未使用」的卡密。已兑换的卡密不能作废——那等于收回用户
// 已经获得的权益，属于另一种操作（撤销权益），需要单独处理并留痕。
func (s *CardKeyService) Void(ctx context.Context, req dto.CardKeyVoidRequest, audit Audit) (map[string]any, error) {
	cards, err := s.repos.CardKey.FindByIDs(ctx, req.IDs)
	if err != nil {
		return nil, err
	}
	if len(cards) == 0 {
		return nil, response.ErrCardNotFound
	}

	affected := 0
	for i := range cards {
		if cards[i].OrderID > 0 && cards[i].Status == model.CardStatusUnused {
			// 已发放给某个订单但用户还没兑换：允许作废，但要提示风险
			affected++
		}
	}

	ok, err := s.repos.CardKey.Void(ctx, req.IDs, audit.AdminID, dto.Trim(req.Reason), time.Now())
	if err != nil {
		return nil, err
	}
	if ok == 0 {
		return nil, response.ErrCardNotVoidable.WithMessage("选中的卡密都不是「未使用」状态，无法作废")
	}

	s.audit.Write(ctx, s.repos, audit, ActionCardVoid, "card_key", "", "",
		fmt.Sprintf("作废 %d 张卡密，原因：%s", ok, dto.Trim(req.Reason)))

	return map[string]any{
		"requested":       len(req.IDs),
		"voided":          ok,
		"skipped":         int64(len(req.IDs)) - ok,
		"issued_affected": affected,
		"message": fmt.Sprintf("已作废 %d 张，跳过 %d 张（非未使用状态）",
			ok, int64(len(req.IDs))-ok),
	}, nil
}

/* ------------------------------------------------------------------ 导出 */

// Export 导出 CSV（需求 §6.7）。
//
// 导出属于敏感操作，无论脱敏还是明文都会写日志。
// 只导出业务需要的字段：卡密、套餐、有效期、批次编号、状态。
func (s *CardKeyService) Export(ctx context.Context, req dto.CardKeyExportRequest, audit Audit) ([]byte, string, error) {
	if req.Reveal && !s.cipher.Enabled() {
		return nil, "", response.ErrInvalidParam.WithMessage("服务端未配置卡密加密密钥，无法导出明文，请改用脱敏导出")
	}

	q := dto.CardKeyListQuery{
		PlanID:  req.PlanID,
		BatchID: req.BatchID,
		Status:  req.Status,
		Keyword: req.Keyword,
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 50000
	}
	cards, err := s.repos.CardKey.ListForExport(ctx, q, limit)
	if err != nil {
		return nil, "", err
	}
	if len(cards) == 0 {
		return nil, "", response.ErrNotFound.WithMessage("当前筛选条件下没有可导出的卡密")
	}

	buf := &bytes.Buffer{}
	// 写 UTF-8 BOM：Excel 直接双击打开 CSV 时不会把中文显示成乱码
	buf.WriteString("\xEF\xBB\xBF")
	w := csv.NewWriter(buf)
	header := []string{"卡密", "对应套餐", "卡密状态", "兑换截止日期", "权益有效期", "批次编号", "批次名称", "生成时间", "兑换用户", "兑换时间", "关联订单", "备注"}
	if err := w.Write(header); err != nil {
		return nil, "", response.ErrInternal.WithCause(err)
	}

	accounts := s.loadAccounts(ctx, cards)
	for i := range cards {
		c := &cards[i]
		code := c.CodeMasked
		if req.Reveal {
			if plain, err := s.cipher.Decrypt(c.CodeCiphertext); err == nil && plain != "" {
				code = plain
			}
		}
		validity := "不限时长"
		if c.PlanSnapshot.ValidDays > 0 {
			validity = fmt.Sprintf("%d 天", c.PlanSnapshot.ValidDays)
		}
		row := []string{
			code,
			c.PlanName,
			model.CardStatusLabel(c.Status),
			formatTimePtr(c.RedeemExpiresAt),
			validity,
			c.BatchID,
			c.BatchName,
			c.CreatedAt.Format("2006-01-02 15:04:05"),
			accounts[c.RedeemedBy],
			formatTimePtr(c.RedeemedAt),
			c.OrderNo,
			c.Note,
		}
		if err := w.Write(row); err != nil {
			return nil, "", response.ErrInternal.WithCause(err)
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return nil, "", response.ErrInternal.WithCause(err)
	}

	mode := "脱敏"
	if req.Reveal {
		mode = "明文"
	}
	s.audit.Write(ctx, s.repos, audit, ActionCardExport, "card_key", "", "",
		fmt.Sprintf("导出 %d 张卡密（%s模式）", len(cards), mode))

	filename := fmt.Sprintf("卡密导出_%s.csv", time.Now().Format("20060102_150405"))
	return buf.Bytes(), filename, nil
}

/* ------------------------------------------------------------------ 前台兑换 */

// Redeem 前台卡密兑换（需求 §6.5）。
//
// 整个流程在一个事务里完成，顺序刻意设计成：
//  1. 归一化 + 哈希查卡密；
//  2. 状态与截止时间的快速判断（给出准确的中文提示）；
//  3. 原子占位：条件更新把状态改成已兑换，影响行数为 0 说明被别人抢先；
//  4. 创建权益记录；
//  5. 回填兑换人、权益 ID 与权益时间窗。
//
// 3~5 在同一事务中，任何一步失败整体回滚。这样既不会出现
// 「卡密显示已兑换但用户没有权益」，也不会出现「同一张卡密兑换两次」。
func (s *CardKeyService) Redeem(ctx context.Context, userID uint64, req dto.CardKeyRedeemRequest, audit Audit) (*dto.CardKeyRedeemResult, error) {
	if userID == 0 {
		return nil, response.ErrUnauthorized.WithMessage("请先登录后再兑换卡密")
	}
	normalized := admin.NormalizeCode(req.Code)
	if normalized == "" {
		return nil, response.ErrInvalidParam.WithMessage("请输入卡密")
	}

	user, err := s.repos.User.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !user.IsActive() {
		return nil, response.ErrAccountDisabled
	}

	card, err := s.repos.CardKey.FindByCodeHash(ctx, admin.HashCode(normalized, s.cfg.CipherSecret))
	if err != nil {
		// 不区分「不存在」与「格式不对」，避免被用来批量试探卡密是否存在
		return nil, response.ErrCardNotFound
	}
	if ok, reason := card.IsRedeemable(time.Now()); !ok {
		s.audit.WriteFail(ctx, s.repos, audit, ActionCardRedeemFail, "card_key", fmt.Sprint(card.ID), card.CodeMasked, reason)
		switch card.Status {
		case model.CardStatusRedeemed:
			return nil, response.ErrCardUsed
		case model.CardStatusVoided:
			return nil, response.ErrCardVoided
		case model.CardStatusExpired:
			return nil, response.ErrCardExpired
		default:
			if card.RedeemExpiresAt != nil && !time.Now().Before(*card.RedeemExpiresAt) {
				return nil, response.ErrCardExpired
			}
			return nil, response.ErrCardNotFound
		}
	}

	// 订单发卡时已经把权益直接发给了下单用户，同一张卡密再由本人兑换
	// 会造成双倍发放。这里明确拦掉，并提示他可以转赠给其他人使用。
	if card.IntendedUserID == user.ID && card.OrderID > 0 {
		return nil, response.ErrCardUsed.WithMessage(
			"这张卡密是你自己订单的交付卡密，权益已经发放到你的账户，无需重复兑换；可以把它转赠给其他人使用。")
	}

	var ent *model.Entitlement
	err = database.WithTx(ctx, s.db, func(tx *gorm.DB) error {
		repos := s.repos.WithTx(tx)
		now := time.Now()

		claimed, err := repos.CardKey.RedeemClaim(ctx, card.ID, now)
		if err != nil {
			return err
		}
		if !claimed {
			// 并发下被别的请求抢先，或者期间被作废 / 过期。
			// 回查一次状态，给出准确的中文原因，而不是一律说「刚被兑换」。
			latest, findErr := repos.CardKey.FindByID(ctx, card.ID)
			if findErr == nil {
				switch latest.Status {
				case model.CardStatusVoided:
					return response.ErrCardVoided
				case model.CardStatusExpired:
					return response.ErrCardExpired
				case model.CardStatusRedeemed:
					if latest.RedeemedBy == user.ID {
						return response.ErrCardUsed.WithMessage("这张卡密你已经兑换过了，权益已发放到你的账户")
					}
					return response.ErrCardUsed.WithMessage("这张卡密刚刚已被兑换，请确认卡密是否已被使用")
				}
			}
			return response.ErrCardUsed.WithMessage("这张卡密刚刚已被兑换，请确认卡密是否已被使用")
		}

		grantSvc := NewGrantService(repos, s.audit)
		created, err := grantSvc.Grant(ctx, repos, GrantInput{
			UserID:   user.ID,
			Account:  user.Username,
			PlanID:   card.PlanID,
			Snapshot: card.PlanSnapshot,
			Source:   model.EntitlementSourceCard,
			SourceID: card.ID,
			SourceNo: card.CodeMasked,
			Note:     fmt.Sprintf("卡密兑换：%s", card.BatchName),
			Now:      now,
		})
		if err != nil {
			return err
		}
		ent = created

		return repos.CardKey.AttachRedeemResult(ctx, card.ID, map[string]any{
			"redeemed_by":            user.ID,
			"entitlement_id":         created.ID,
			"entitlement_started_at": created.StartsAt,
			"entitlement_expires_at": created.ExpiresAt,
			"updated_at":             now,
		})
	})
	if err != nil {
		return nil, err
	}

	s.audit.Write(ctx, s.repos, audit, ActionCardRedeem, "card_key", fmt.Sprint(card.ID), card.CodeMasked,
		fmt.Sprintf("用户 %s 兑换卡密成功，套餐「%s」", user.Username, card.PlanName))

	return &dto.CardKeyRedeemResult{
		PlanID:        card.PlanID,
		PlanName:      card.PlanName,
		PlanCode:      card.PlanSnapshot.Code,
		EntitlementID: ent.ID,
		StartsAt:      ent.StartsAt,
		ExpiresAt:     ent.ExpiresAt,
		UsageLimit:    ent.UsageLimit,
		Permissions:   card.PlanSnapshot.Permissions,
		FeatureText:   card.PlanSnapshot.FeatureText,
		Message:       buildRedeemMessage(card, ent),
	}, nil
}

// buildRedeemMessage 组装兑换成功的中文提示，明确告诉用户拿到了什么、有效期多久。
func buildRedeemMessage(card *model.CardKey, ent *model.Entitlement) string {
	if ent.ExpiresAt == nil {
		return fmt.Sprintf("兑换成功！已开通「%s」，不限时长。", card.PlanName)
	}
	return fmt.Sprintf("兑换成功！已开通「%s」，有效期至 %s。",
		card.PlanName, ent.ExpiresAt.Local().Format("2006-01-02 15:04"))
}

/* ------------------------------------------------------------------ 内部 */

// toItem 组装返回项。includeCode 为 true 时解密明文。
func (s *CardKeyService) toItem(ctx context.Context, c *model.CardKey, account string, includeCode bool) dto.CardKeyItem {
	item := dto.CardKeyItem{
		ID:                   c.ID,
		CodeMasked:           c.CodeMasked,
		PlanID:               c.PlanID,
		PlanName:             c.PlanName,
		BatchID:              c.BatchID,
		BatchName:            c.BatchName,
		Status:               c.Status,
		StatusText:           model.CardStatusLabel(c.Status),
		RedeemExpiresAt:      c.RedeemExpiresAt,
		IssuedAt:             c.IssuedAt,
		OrderID:              c.OrderID,
		OrderNo:              c.OrderNo,
		RedeemedBy:           c.RedeemedBy,
		RedeemedAccount:      account,
		RedeemedAt:           c.RedeemedAt,
		EntitlementID:        c.EntitlementID,
		EntitlementStartedAt: c.EntitlementStartedAt,
		EntitlementExpiresAt: c.EntitlementExpiresAt,
		Note:                 c.Note,
		CreatedBy:            c.CreatedBy,
		CreatedAt:            c.CreatedAt,
		VoidedAt:             c.VoidedAt,
		VoidReason:           c.VoidReason,
		PlanSnapshot:         c.PlanSnapshot,
	}
	if includeCode && s.cipher.Enabled() && c.CodeCiphertext != "" {
		if plain, err := s.cipher.Decrypt(c.CodeCiphertext); err == nil {
			item.Code = plain
		}
	}
	return item
}

// loadAccounts 批量取用户名。
func (s *CardKeyService) loadAccounts(ctx context.Context, cards []model.CardKey) map[uint64]string {
	out := make(map[uint64]string, len(cards))
	ids := make([]uint64, 0, len(cards))
	seen := make(map[uint64]bool, len(cards))
	for _, c := range cards {
		if c.RedeemedBy > 0 && !seen[c.RedeemedBy] {
			seen[c.RedeemedBy] = true
			ids = append(ids, c.RedeemedBy)
		}
	}
	if len(ids) == 0 {
		return out
	}
	users, err := s.repos.User.FindByIDs(ctx, ids)
	if err != nil {
		return out
	}
	for _, u := range users {
		out[u.ID] = u.Username
	}
	return out
}

func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Local().Format("2006-01-02 15:04:05")
}
