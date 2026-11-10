package service

import (
	"context"
	"strconv"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// Pulse 是后台「用户数据」一页：注册 / 登录的人数与次数、访问量，以及其中标成自己的部分。
func (s *ActivityService) Pulse(ctx context.Context, days int) (dto.ActivityPulse, error) {
	now := s.now()
	window := dto.NewActivityWindow(days, dto.DefaultActivityDays, dto.MaxActivityDays, now)
	out := dto.ActivityPulse{
		Window:      window,
		Marks:       []dto.ActivitySelfMarkItem{},
		Accounts:    []dto.ActivityPulseAccount{},
		Visitors:    []dto.ActivityPulseVisitor{},
		GeneratedAt: now,
	}
	start, end, todayStart, todayEnd, ok := pulseBounds(window)
	if !ok {
		return out, nil
	}

	marks, err := s.repos.Activity.ListSelfMarks(ctx)
	if err != nil {
		return out, err
	}
	scope, err := s.resolveSelf(ctx, marks)
	if err != nil {
		return out, err
	}

	total, err := s.repos.User.CountUsers(ctx)
	if err != nil {
		return out, err
	}
	registeredToday, err := s.repos.Activity.CountUsersCreated(ctx, todayStart, todayEnd)
	if err != nil {
		return out, err
	}
	registeredWindow, err := s.repos.Activity.CountUsersCreated(ctx, start, end)
	if err != nil {
		return out, err
	}
	loginToday, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountLogin, window.To, window.To, nil, false)
	if err != nil {
		return out, err
	}
	loginWindow, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountLogin, window.From, window.To, nil, false)
	if err != nil {
		return out, err
	}
	registerToday, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountRegister, window.To, window.To, nil, false)
	if err != nil {
		return out, err
	}
	registerWindow, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountRegister, window.From, window.To, nil, false)
	if err != nil {
		return out, err
	}
	trafficToday, err := s.repos.Visit.WindowStats(ctx, window.To, window.To)
	if err != nil {
		return out, err
	}
	trafficWindow, err := s.repos.Visit.WindowStats(ctx, window.From, window.To)
	if err != nil {
		return out, err
	}

	out.People = dto.ActivityPulsePeople{
		RegisteredTotal:  total,
		RegisteredToday:  registeredToday,
		RegisteredWindow: registeredWindow,
		LoggedInToday:    loginToday.Users,
		LoggedInWindow:   loginWindow.Users,
	}
	out.Events = dto.ActivityPulseEvents{
		RegistersToday:  registerToday.Hits,
		RegistersWindow: registerWindow.Hits,
		LoginsToday:     loginToday.Hits,
		LoginsWindow:    loginWindow.Hits,
	}
	out.Traffic = dto.ActivityPulseTraffic{
		PVToday:  trafficToday.PV,
		UVToday:  trafficToday.Visitors,
		PVWindow: trafficWindow.PV,
		UVWindow: trafficWindow.Visitors,
	}

	selfLoginToday, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountLogin, window.To, window.To, scope.userIDs, true)
	if err != nil {
		return out, err
	}
	selfLoginWindow, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountLogin, window.From, window.To, scope.userIDs, true)
	if err != nil {
		return out, err
	}
	selfRegisterToday, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountRegister, window.To, window.To, scope.userIDs, true)
	if err != nil {
		return out, err
	}
	selfRegisterWindow, err := s.repos.Activity.FeatureHitTotals(ctx, model.FeatureAccountRegister, window.From, window.To, scope.userIDs, true)
	if err != nil {
		return out, err
	}
	selfRegisteredTotal, err := s.repos.Activity.CountUsersIn(ctx, scope.userIDs)
	if err != nil {
		return out, err
	}
	selfRegisteredToday, err := s.repos.Activity.CountUsersCreatedIn(ctx, todayStart, todayEnd, scope.userIDs, true)
	if err != nil {
		return out, err
	}
	selfRegisteredWindow, err := s.repos.Activity.CountUsersCreatedIn(ctx, start, end, scope.userIDs, true)
	if err != nil {
		return out, err
	}
	selfTrafficToday, err := s.repos.Visit.ScopedWindowStats(ctx, window.To, window.To, scope.visit)
	if err != nil {
		return out, err
	}
	selfTrafficWindow, err := s.repos.Visit.ScopedWindowStats(ctx, window.From, window.To, scope.visit)
	if err != nil {
		return out, err
	}
	out.Self = dto.ActivityPulseShare{
		People: dto.ActivityPulsePeople{
			RegisteredTotal:  selfRegisteredTotal,
			RegisteredToday:  selfRegisteredToday,
			RegisteredWindow: selfRegisteredWindow,
			LoggedInToday:    selfLoginToday.Users,
			LoggedInWindow:   selfLoginWindow.Users,
		},
		Events: dto.ActivityPulseEvents{
			RegistersToday:  selfRegisterToday.Hits,
			RegistersWindow: selfRegisterWindow.Hits,
			LoginsToday:     selfLoginToday.Hits,
			LoginsWindow:    selfLoginWindow.Hits,
		},
		Traffic: dto.ActivityPulseTraffic{
			PVToday:  selfTrafficToday.PV,
			UVToday:  selfTrafficToday.Visitors,
			PVWindow: selfTrafficWindow.PV,
			UVWindow: selfTrafficWindow.Visitors,
		},
	}

	if err := s.fillPulseLists(ctx, &out, window, marks, scope); err != nil {
		return out, err
	}
	return out, nil
}

// AddSelf 把一个账号或浏览器标成自己。已经标过的再标一次只更新备注。
func (s *ActivityService) AddSelf(ctx context.Context, req dto.ActivitySelfMarkRequest) (model.ActivitySelfMark, error) {
	kind := strings.TrimSpace(req.Kind)
	value, err := normalizeSelfValue(kind, req.Value)
	if err != nil {
		return model.ActivitySelfMark{}, err
	}
	if kind == model.SelfKindUser {
		id, _ := strconv.ParseUint(value, 10, 64)
		if _, err := s.repos.User.FindByID(ctx, id); err != nil {
			return model.ActivitySelfMark{}, err
		}
	}
	return s.repos.Activity.SaveSelfMark(ctx, kind, value, strings.TrimSpace(req.Label))
}

// DeleteSelf 取消一条「自己」标注。
func (s *ActivityService) DeleteSelf(ctx context.Context, id uint64) error {
	return s.repos.Activity.DeleteSelfMark(ctx, id)
}

func (s *ActivityService) fillPulseLists(
	ctx context.Context,
	out *dto.ActivityPulse,
	window dto.ActivityWindow,
	marks []model.ActivitySelfMark,
	scope selfScope,
) error {
	nameOf := map[uint64]string{}
	var markUserIDs []uint64
	for _, mark := range marks {
		if mark.Kind != model.SelfKindUser {
			continue
		}
		id, err := strconv.ParseUint(mark.Value, 10, 64)
		if err != nil || id == 0 {
			continue
		}
		markUserIDs = append(markUserIDs, id)
	}
	users, err := s.repos.User.FindByIDs(ctx, markUserIDs)
	if err != nil {
		return err
	}
	for _, user := range users {
		nameOf[user.ID] = user.Username
	}
	for _, mark := range marks {
		item := dto.ActivitySelfMarkItem{
			ID:        mark.ID,
			Kind:      mark.Kind,
			Value:     mark.Value,
			Label:     mark.Label,
			CreatedAt: mark.CreatedAt,
		}
		switch mark.Kind {
		case model.SelfKindUser:
			item.KindLabel = "账号"
			if id, err := strconv.ParseUint(mark.Value, 10, 64); err == nil {
				item.Username = nameOf[id]
			}
		case model.SelfKindVisitor:
			item.KindLabel = "浏览器"
			item.Value = model.MaskVisitor(mark.Value)
		default:
			item.KindLabel = mark.Kind
		}
		out.Marks = append(out.Marks, item)
	}

	recent, err := s.repos.Activity.RecentAccounts(ctx, window.From, window.To, 40)
	if err != nil {
		return err
	}
	seen := map[uint64]bool{}
	for _, row := range recent {
		seen[row.UserID] = true
	}
	var extra []uint64
	for _, id := range scope.userIDs {
		if !seen[id] {
			extra = append(extra, id)
		}
	}
	missing, err := s.repos.Activity.AccountsByIDs(ctx, window.From, window.To, extra)
	if err != nil {
		return err
	}
	rows := append(missing, recent...)
	for _, row := range rows {
		out.Accounts = append(out.Accounts, dto.ActivityPulseAccount{
			UserID:      row.UserID,
			Username:    row.Username,
			Nickname:    row.Nickname,
			CreatedAt:   row.CreatedAt,
			LastLoginAt: row.LastLoginAt,
			Logins:      row.Logins,
			Self:        scope.isUser(row.UserID),
			MarkID:      scope.userMark[row.UserID],
		})
	}

	filter := repository.VisitVisitorFilter{From: window.From, To: window.To, Sort: "last_seen"}
	filter.Page = 1
	filter.PageSize = 30
	filter.Normalize()
	visitors, _, err := s.repos.Visit.ListVisitors(ctx, filter)
	if err != nil {
		return err
	}
	for _, row := range visitors {
		token := row.Visitor
		if len(token) > 8 {
			token = token[:8]
		}
		out.Visitors = append(out.Visitors, dto.ActivityPulseVisitor{
			Visitor:    model.MaskVisitor(row.Visitor),
			Token:      token,
			UserID:     row.UserID,
			Username:   row.Username,
			PageViews:  row.PageViews,
			LastSeenAt: row.LastSeenAt,
			LastPath:   row.LastPath,
			Self:       scope.isUser(row.UserID) || scope.visitorMarkID(row.Visitor) != 0,
			MarkID:     scope.visitorMarkID(row.Visitor),
		})
	}
	return nil
}

// selfScope 是一次查询里「自己」展开后的账号与浏览器。
type selfScope struct {
	userIDs  []uint64
	userSet  map[uint64]struct{}
	userMark map[uint64]uint64
	exact    map[string]uint64
	prefix   map[string]uint64
	visit    repository.SelfVisitScope
}

func (s selfScope) isUser(id uint64) bool {
	if id == 0 {
		return false
	}
	_, ok := s.userSet[id]
	return ok
}

func (s selfScope) visitorMarkID(visitor string) uint64 {
	if id, ok := s.exact[visitor]; ok {
		return id
	}
	if len(visitor) >= 8 {
		if id, ok := s.prefix[visitor[:8]]; ok {
			return id
		}
	}
	return 0
}

func (s *ActivityService) resolveSelf(ctx context.Context, marks []model.ActivitySelfMark) (selfScope, error) {
	scope := selfScope{
		userSet:  map[uint64]struct{}{},
		userMark: map[uint64]uint64{},
		exact:    map[string]uint64{},
		prefix:   map[string]uint64{},
	}
	var exact, prefixes []string
	for _, mark := range marks {
		switch mark.Kind {
		case model.SelfKindUser:
			id, err := strconv.ParseUint(mark.Value, 10, 64)
			if err != nil || id == 0 {
				continue
			}
			scope.userSet[id] = struct{}{}
			scope.userMark[id] = mark.ID
		case model.SelfKindVisitor:
			switch len(mark.Value) {
			case 32:
				scope.exact[mark.Value] = mark.ID
				exact = append(exact, mark.Value)
			case 8:
				scope.prefix[mark.Value] = mark.ID
				prefixes = append(prefixes, mark.Value)
			}
		}
	}
	linked, err := s.repos.Visit.UserIDsMatchingVisitors(ctx, exact, prefixes)
	if err != nil {
		return scope, err
	}
	for _, id := range linked {
		scope.userSet[id] = struct{}{}
	}
	scope.userIDs = make([]uint64, 0, len(scope.userSet))
	for id := range scope.userSet {
		scope.userIDs = append(scope.userIDs, id)
	}
	scope.visit = repository.SelfVisitScope{UserIDs: scope.userIDs, Exact: exact, Prefixes: prefixes}
	return scope, nil
}

func normalizeSelfValue(kind, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimRight(raw, ".…")
	switch kind {
	case model.SelfKindUser:
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || id == 0 {
			return "", response.ErrInvalidParam.WithMessage("账号要填用户 ID（数字）")
		}
		return strconv.FormatUint(id, 10), nil
	case model.SelfKindVisitor:
		raw = strings.ToLower(raw)
		if !isVisitorToken(raw) {
			return "", response.ErrInvalidParam.WithMessage("访客标识要填 8 位或 32 位十六进制")
		}
		return raw, nil
	default:
		return "", response.ErrInvalidParam.WithMessage("标注方式只能是账号或浏览器")
	}
}

func isVisitorToken(s string) bool {
	if len(s) != 8 && len(s) != 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			continue
		}
		return false
	}
	return true
}

func pulseBounds(window dto.ActivityWindow) (start, end, todayStart, todayEnd time.Time, ok bool) {
	start, okStart := model.ParseActivityDay(window.From)
	todayStart, okToday := model.ParseActivityDay(window.To)
	if !okStart || !okToday {
		return time.Time{}, time.Time{}, time.Time{}, time.Time{}, false
	}
	end = todayStart.AddDate(0, 0, 1)
	todayEnd = end
	return start, end, todayStart, todayEnd, true
}
