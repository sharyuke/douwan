package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/storage"
)

// 设置项的键。集中在这里，避免各处手写字符串拼错。
const (
	SettingSiteName         = "site_name"
	SettingSupportURL       = "support_url"
	SettingSupportText      = "support_text"
	SettingUploadMaxMB      = "upload_max_mb"
	SettingCardNotice       = "card_redeem_notice"
	SettingPaymentEnabled   = "payment_enabled"
	SettingPaymentChannel   = "payment_channel"
	SettingPaymentNotice    = "payment_notice"
	SettingPaymentSecret    = "payment_secret"
	SettingAIAlertEnabled   = "ai_cost_alert_enabled"
	SettingAIAlertThreshold = "ai_cost_alert_threshold"
)

// DefaultSettings 返回内置的默认设置项。
//
// 这些都是「确实需要的设置」（需求 §10），不含任何虚构的数据：
//   - 支付相关默认是「未配置」，并给出明确说明，不假装能收款；
//   - AI 成本告警只预留开关与阈值，因为现在还没有调用成本数据。
func DefaultSettings() []model.Setting {
	return []model.Setting{
		{
			Key: SettingSiteName, Value: "豆玩", Group: model.SettingGroupBasic,
			Label: "网站名称", Type: "text", Public: true,
			Description: "前台标题、分享文案里使用的站点名",
		},
		{
			Key: SettingSupportURL, Value: "", Group: model.SettingGroupBasic,
			Label: "客服 / 反馈入口", Type: "text", Public: true,
			Description: "填写后前台显示「联系我们」入口，留空则不显示",
		},
		{
			Key: SettingSupportText, Value: "遇到问题可以在这里联系我们", Group: model.SettingGroupBasic,
			Label: "客服入口文案", Type: "text", Public: true,
			Description: "客服入口旁边显示的一句话",
		},
		{
			Key: SettingUploadMaxMB, Value: "10", Group: model.SettingGroupUpload,
			Label: "素材上传大小上限（MB）", Type: "number", Public: true,
			Description: "1~100。前台与后台上传都会按这个值校验",
		},
		{
			Key: SettingCardNotice, Value: "卡密仅能兑换一次，请在有效期内使用；已兑换或已作废的卡密无法再次使用。",
			Group: model.SettingGroupCard, Label: "卡密兑换规则说明", Type: "textarea", Public: true,
			Description: "前台兑换页展示给用户的规则文案",
		},
		{
			Key: SettingPaymentEnabled, Value: "false", Group: model.SettingGroupPayment,
			Label: "启用在线支付", Type: "switch", Public: true,
			Description: "未接入支付渠道时保持关闭，订单只能由管理员人工确认收款",
		},
		{
			Key: SettingPaymentChannel, Value: "", Group: model.SettingGroupPayment,
			Label: "支付渠道标识", Type: "text", Public: false,
			Description: "例如 wechat / alipay；留空表示尚未配置",
		},
		{
			Key: SettingPaymentNotice, Value: "支付渠道尚未配置，当前订单需要管理员人工确认收款后发放卡密。",
			Group: model.SettingGroupPayment, Label: "支付状态说明", Type: "text", Public: true,
			Description: "前台下单页展示的支付状态说明，必须如实反映当前能力",
		},
		{
			Key: SettingPaymentSecret, Value: "", Group: model.SettingGroupPayment,
			Label: "支付密钥", Type: "secret", Secret: true, Public: false,
			Description: "仅超级管理员可修改，接口只返回脱敏值，永远不回传明文",
		},
		{
			Key: SettingAIAlertEnabled, Value: "false", Group: model.SettingGroupAI,
			Label: "启用 AI 成本告警", Type: "switch", Public: false,
			Description: "当前系统还没有 AI 调用成本数据，开启后仅预留告警位",
		},
		{
			Key: SettingAIAlertThreshold, Value: "0", Group: model.SettingGroupAI,
			Label: "AI 成本告警阈值（元/天）", Type: "number", Public: false,
			Description: "预留配置项；接入真实成本统计后生效",
		},
	}
}

// SettingsService 系统设置。
type SettingsService struct {
	repos *repository.Repositories
	audit *AuditLog
	store *storage.Store
}

// NewSettingsService 构造设置服务。
func NewSettingsService(repos *repository.Repositories, audit *AuditLog, store *storage.Store) *SettingsService {
	return &SettingsService{repos: repos, audit: audit, store: store}
}

// EnsureDefaults 补齐默认设置项，服务启动时调用一次。幂等。
func (s *SettingsService) EnsureDefaults(ctx context.Context) (int, error) {
	created, err := s.repos.Setting.EnsureDefaults(ctx, DefaultSettings())
	if err != nil {
		return created, err
	}
	return created, nil
}

// ApplyRuntimeSettings 把数据库里的设置应用到运行期组件。
//
// 目前只有一项会影响运行期行为：上传大小上限。配置文件的默认值仍然兜底，
// 数据库里的值优先级更高，这样运营改完不需要重启服务。
func (s *SettingsService) ApplyRuntimeSettings(ctx context.Context) {
	if s.store == nil {
		return
	}
	item, err := s.repos.Setting.Get(ctx, SettingUploadMaxMB)
	if err != nil || item == nil {
		return
	}
	if mb, err := strconv.Atoi(strings.TrimSpace(item.Value)); err == nil && mb > 0 && mb <= 100 {
		s.store.SetMaxUploadMB(mb)
	}
}

// List 后台设置列表。secret 类型只返回脱敏值（需求 §10）。
func (s *SettingsService) List(ctx context.Context) ([]dto.SettingItem, error) {
	settings, err := s.repos.Setting.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]dto.SettingItem, 0, len(settings))
	for i := range settings {
		items = append(items, toSettingItem(&settings[i]))
	}
	return items, nil
}

// Update 批量修改设置。
//
// 权限规则：修改 secret 类型（支付密钥）只允许超级管理员，
// 且接口永远不回传明文（需求 §10「密钥类配置只能由有权限的管理员修改，
// 界面默认脱敏显示，不应返回完整密钥给前端」）。
func (s *SettingsService) Update(ctx context.Context, req dto.SettingUpdateRequest, audit Audit, isSuper bool) ([]dto.SettingItem, error) {
	changed := make([]string, 0, len(req.Items))
	for _, item := range req.Items {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			return nil, response.ErrInvalidParam.WithMessage("设置项的键不能为空")
		}
		existing, err := s.repos.Setting.Get(ctx, key)
		if err != nil {
			return nil, err
		}
		if existing.Secret && !isSuper {
			return nil, response.ErrForbidden.WithMessage("「" + existing.Label + "」属于密钥类配置，只有超级管理员可以修改")
		}
		value, err := validateSettingValue(existing, item.Value)
		if err != nil {
			return nil, err
		}
		// secret 且传空值时视为「不修改」，避免管理员只是打开页面点保存就把密钥清空
		if existing.Secret && strings.TrimSpace(item.Value) == "" {
			continue
		}
		if existing.Value == value {
			continue
		}
		if err := s.repos.Setting.UpdateValue(ctx, existing.ID, value, audit.AdminID); err != nil {
			return nil, err
		}
		changed = append(changed, fmt.Sprintf("%s：%s", existing.Label, displayValue(existing, value)))
	}

	if len(changed) > 0 {
		s.audit.Write(ctx, s.repos, audit, ActionSettingUpdate, "setting", "", "",
			"修改系统设置 —— "+strings.Join(changed, "；"))
		// 立即生效，不要求重启
		s.ApplyRuntimeSettings(ctx)
	}
	return s.List(ctx)
}

// Public 前台可读的公开设置（需求 §10：前台要拿到网站名、客服入口、卡密规则、支付状态）。
func (s *SettingsService) Public(ctx context.Context) (*dto.PublicSettings, error) {
	settings, err := s.repos.Setting.ListPublic(ctx)
	if err != nil {
		return nil, err
	}
	kv := make(map[string]string, len(settings))
	for _, item := range settings {
		kv[item.Key] = item.Value
	}

	out := &dto.PublicSettings{
		SiteName:         valueOr(kv, SettingSiteName, "豆玩"),
		SupportURL:       kv[SettingSupportURL],
		SupportText:      kv[SettingSupportText],
		CardRedeemNotice: kv[SettingCardNotice],
		PaymentReady:     strings.EqualFold(kv[SettingPaymentEnabled], "true"),
		PaymentNotice:    kv[SettingPaymentNotice],
	}
	if mb, err := strconv.Atoi(kv[SettingUploadMaxMB]); err == nil && mb > 0 {
		out.MaxUploadMB = mb
	}
	if out.MaxUploadMB == 0 {
		out.MaxUploadMB = 10
	}
	if out.PaymentNotice == "" && !out.PaymentReady {
		out.PaymentNotice = "支付渠道尚未配置"
	}
	return out, nil
}

// PaymentReady 当前是否已启用真实支付渠道。订单服务用它决定能否走渠道支付。
func (s *SettingsService) PaymentReady(ctx context.Context) (bool, string) {
	enabled, err := s.repos.Setting.Get(ctx, SettingPaymentEnabled)
	if err != nil || enabled == nil || !strings.EqualFold(enabled.Value, "true") {
		return false, ""
	}
	channel, err := s.repos.Setting.Get(ctx, SettingPaymentChannel)
	if err != nil || channel == nil {
		return false, ""
	}
	return strings.TrimSpace(channel.Value) != "", strings.TrimSpace(channel.Value)
}

/* ------------------------------------------------------------------ 内部 */

func toSettingItem(s *model.Setting) dto.SettingItem {
	item := dto.SettingItem{
		Key:         s.Key,
		Value:       s.Value,
		HasValue:    strings.TrimSpace(s.Value) != "",
		Group:       s.Group,
		GroupLabel:  model.SettingGroupLabel(s.Group),
		Label:       s.Label,
		Type:        s.Type,
		Public:      s.Public,
		Secret:      s.Secret,
		Description: s.Description,
		UpdatedAt:   s.UpdatedAt,
	}
	if s.Secret {
		item.Value = maskSecret(s.Value)
	}
	return item
}

// maskSecret 只保留末 4 位，其余用 * 代替。空值返回空串。
func maskSecret(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if len(v) <= 4 {
		return strings.Repeat("*", len(v))
	}
	return strings.Repeat("*", len(v)-4) + v[len(v)-4:]
}

func validateSettingValue(s *model.Setting, value string) (string, error) {
	value = dto.Trim(value)
	switch s.Type {
	case "number":
		if value == "" {
			value = "0"
		}
		n, err := strconv.Atoi(value)
		if err != nil {
			return "", response.ErrInvalidParam.WithMessage("「" + s.Label + "」必须是整数")
		}
		switch s.Key {
		case SettingUploadMaxMB:
			if n < 1 || n > 100 {
				return "", response.ErrInvalidParam.WithMessage("上传大小上限必须在 1~100 MB 之间")
			}
		case SettingAIAlertThreshold:
			if n < 0 || n > 1000000 {
				return "", response.ErrInvalidParam.WithMessage("告警阈值必须在 0~1000000 之间")
			}
		}
		return strconv.Itoa(n), nil
	case "switch":
		b := strings.EqualFold(value, "true") || value == "1" || strings.EqualFold(value, "on")
		if b {
			return "true", nil
		}
		return "false", nil
	default:
		if len(value) > 2000 {
			return "", response.ErrInvalidParam.WithMessage("「" + s.Label + "」内容过长")
		}
		return value, nil
	}
}

// displayValue 决定日志里怎么写这个值：secret 类型只记脱敏串。
func displayValue(s *model.Setting, value string) string {
	if s.Secret {
		return "已更新（脱敏：" + maskSecret(value) + "）"
	}
	if value == "" {
		return "（空）"
	}
	if s.Type == "textarea" || len([]rune(value)) > 60 {
		return truncate(value, 30) + "…"
	}
	return value
}

func valueOr(kv map[string]string, key, fallback string) string {
	if v, ok := kv[key]; ok && strings.TrimSpace(v) != "" {
		return v
	}
	return fallback
}
