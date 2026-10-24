package activity

import (
	"context"
	"sort"
	"strings"
	"time"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
)

/* ---------------------------------------------------------------- 访问量 */

// 站点访问量（PV / UV）的采集。
//
// 与「用户活跃」共用同一个 Recorder（同一套缓冲、同一个 flush 周期、同一份
// 失败重试语义），但**口径完全不同**，所以另开一组缓冲与两张表：
//
//   - 活跃：登录用户在自然日内有没有动过 → 按 user_id 去重，匿名访问不计；
//   - 访问量：页面被打开了多少次、多少人来过 → 按访客标识去重，**匿名也算**。
//
// 为什么必须有客户端上报：pindoudou 是 hash 路由的 SPA，一个 HTML 入口之后的
// 所有页面切换（#/editor、#/library/xxx）都不会产生 HTTP 请求，
// 服务端在接口层看不见「用户翻到了哪一页」。所以由前端在路由切换时上报，
// 服务端只做校验、去抖与聚合。

// visitDedupeWindow 是同一个访客在同一个页面上的去抖窗口。
//
// 存在的意义：SPA 里一次导航可能触发两次上报（重定向 / 组件重复挂载），
// 手动刷新页面也会在几百毫秒内产生第二次上报。都算成两次 PV 会让
// 「访问量」变成「上报次数」。窗口取 2 秒——短到不会吞掉真实回访。
const visitDedupeWindow = 2 * time.Second

// visitKey 是一个「访客 × 天 × 页面」缓冲桶。
type visitKey struct {
	visitor string
	day     string
	path    string
}

// visitBucket 是内存里正在累加的一个页面访问桶。
type visitBucket struct {
	pv      int64
	userID  uint64
	firstAt time.Time
	lastAt  time.Time
}

// visitorBucket 是内存里正在累加的一个访客档案。
type visitorBucket struct {
	userID        uint64
	firstSeenAt   time.Time
	lastSeenAt    time.Time
	firstDay      string
	lastDay       string
	pageViews     int64
	firstPath     string
	lastPath      string
	channel       string
	channelDetail string
	ip            string
	region        model.GeoRegion
}

// VisitRecord 是一次页面访问上报（已由服务层校验与归一化）。
type VisitRecord struct {
	Visitor string
	// UserID 为 0 表示匿名访问。
	UserID uint64
	// Path 已经是路由模板（/library/:slug），不是完整 URL。
	Path string
	At   time.Time
	IP   string
	// Channel / ChannelDetail 是首触来源（服务层解析好的）。
	Channel       string
	ChannelDetail string
}

// RecordPageView 记一次页面访问。
//
// 返回值表示这次上报是否被计入（去抖命中、缓冲已满、采集关闭都返回 false），
// 便于接口把「收了但没算」如实告诉调用方。
func (r *Recorder) RecordPageView(rec VisitRecord) bool {
	if !r.Enabled() {
		return false
	}
	visitor := strings.TrimSpace(rec.Visitor)
	if !model.IsVisitorID(visitor) {
		return false
	}
	at := rec.At
	if at.IsZero() {
		at = r.now()
	}
	day := model.ActivityDay(at)
	path := model.NormalizeVisitPath(rec.Path)
	key := visitKey{visitor: visitor, day: day, path: path}

	if !r.addVisit(key, visitor, at, rec.UserID, rec.IP, rec.Channel, rec.ChannelDetail) {
		return false
	}
	// 登录用户的一次页面访问同样说明「他今天来过」：只标记活跃，
	// 不加请求次数——访问上报本身不是业务接口调用（与 /api/v1/events 同一处理）。
	if rec.UserID != 0 {
		r.add(rec.UserID, at, rec.IP, 0, 0)
	}
	return true
}

// addVisit 在锁内累加缓冲，返回是否真的记下了这一次。
func (r *Recorder) addVisit(key visitKey, visitor string, at time.Time, userID uint64, ip, channel, channelDetail string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if last, ok := r.visitSeen[key]; ok && !at.Before(last) && at.Sub(last) < visitDedupeWindow {
		return false
	}
	// 缓冲上限是防线：数据库长时间不可用时也必须有个头，
	// 否则内存可能把 1.6G 的小机器压垮。超限丢弃并计数（freshness 里如实报出来）。
	if len(r.visits)+len(r.visitors) >= r.cfg.BufferLimit {
		r.visitDropped++
		return false
	}
	if len(r.visitSeen) >= r.cfg.BufferLimit {
		// 去抖表只是优化，满了就清空重来（最坏情况是多算几次刷新）
		r.visitSeen = map[visitKey]time.Time{}
	}
	r.visitSeen[key] = at

	bucket, ok := r.visits[key]
	if !ok {
		bucket = &visitBucket{firstAt: at, lastAt: at, userID: userID}
		r.visits[key] = bucket
	}
	if at.Before(bucket.firstAt) {
		bucket.firstAt = at
	}
	if at.After(bucket.lastAt) {
		bucket.lastAt = at
	}
	bucket.pv++
	if userID != 0 {
		bucket.userID = userID
	}

	v, ok := r.visitors[visitor]
	if !ok {
		region := model.GeoRegion{}
		if r.geo != nil {
			region = r.geo.Resolve(ip)
		}
		v = &visitorBucket{
			userID:        userID,
			firstSeenAt:   at,
			lastSeenAt:    at,
			firstDay:      key.day,
			lastDay:       key.day,
			pageViews:     1,
			firstPath:     key.path,
			lastPath:      key.path,
			channel:       channel,
			channelDetail: channelDetail,
			ip:            ip,
			region:        region,
		}
		r.visitors[visitor] = v
		return true
	}
	if at.Before(v.firstSeenAt) {
		v.firstSeenAt = at
		v.firstDay = key.day
		v.firstPath = key.path
	}
	if at.After(v.lastSeenAt) || v.lastSeenAt.IsZero() {
		v.lastSeenAt = at
		v.lastDay = key.day
		v.lastPath = key.path
	}
	v.pageViews++
	if userID != 0 {
		v.userID = userID
	}
	if v.channel == "" && channel != "" {
		v.channel = channel
		v.channelDetail = channelDetail
	}
	if ip != "" {
		v.ip = ip
		if r.geo != nil {
			if region := r.geo.Resolve(ip); !region.IsEmpty() {
				v.region = region
			}
		}
	}
	return true
}

// flushVisits 把访问缓冲落库。失败时把增量放回缓冲等下一轮重试。
func (r *Recorder) flushVisits(ctx context.Context) error {
	r.mu.Lock()
	if len(r.visits) == 0 && len(r.visitors) == 0 {
		r.mu.Unlock()
		return nil
	}
	visits := r.visits
	visitors := r.visitors
	r.visits = map[visitKey]*visitBucket{}
	r.visitors = map[string]*visitorBucket{}
	r.visitSeen = map[visitKey]time.Time{}
	r.mu.Unlock()

	pageDeltas := make([]repository.VisitPageDelta, 0, len(visits))
	for key, bucket := range visits {
		pageDeltas = append(pageDeltas, repository.VisitPageDelta{
			Visitor: key.visitor,
			Day:     key.day,
			Path:    key.path,
			PV:      bucket.pv,
			UserID:  bucket.userID,
			FirstAt: bucket.firstAt,
			LastAt:  bucket.lastAt,
		})
	}
	visitorDeltas := make([]repository.VisitVisitorDelta, 0, len(visitors))
	for visitor, v := range visitors {
		visitorDeltas = append(visitorDeltas, repository.VisitVisitorDelta{
			Visitor:       visitor,
			UserID:        v.userID,
			FirstSeenAt:   v.firstSeenAt,
			LastSeenAt:    v.lastSeenAt,
			FirstDay:      v.firstDay,
			LastDay:       v.lastDay,
			PageViews:     v.pageViews,
			FirstPath:     v.firstPath,
			LastPath:      v.lastPath,
			Channel:       v.channel,
			ChannelDetail: v.channelDetail,
			IP:            v.ip,
			Region:        v.region,
		})
	}

	// 先写明细（PV / UV 都来自它），再写访客档案（渠道、落地页、累计量）。
	if err := r.repos.Visit.UpsertVisitorPages(ctx, pageDeltas); err != nil {
		r.mergeBackVisits(visits, visitors)
		return err
	}
	if err := r.repos.Visit.UpsertVisitors(ctx, visitorDeltas); err != nil {
		// 明细已经写进去了，只回填档案，避免 PV 被重复累加
		r.mergeBackVisits(nil, visitors)
		return err
	}
	return nil
}

// mergeBackVisits 把落库失败的访问增量放回缓冲。
func (r *Recorder) mergeBackVisits(visits map[visitKey]*visitBucket, visitors map[string]*visitorBucket) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, bucket := range visits {
		current, ok := r.visits[key]
		if !ok {
			if len(r.visits)+len(r.visitors) >= r.cfg.BufferLimit {
				r.visitDropped += bucket.pv
				continue
			}
			clone := *bucket
			r.visits[key] = &clone
			continue
		}
		if bucket.firstAt.Before(current.firstAt) {
			current.firstAt = bucket.firstAt
		}
		if bucket.lastAt.After(current.lastAt) {
			current.lastAt = bucket.lastAt
		}
		current.pv += bucket.pv
		if current.userID == 0 {
			current.userID = bucket.userID
		}
	}
	for visitor, v := range visitors {
		current, ok := r.visitors[visitor]
		if !ok {
			if len(r.visits)+len(r.visitors) >= r.cfg.BufferLimit {
				r.visitDropped += v.pageViews
				continue
			}
			clone := *v
			r.visitors[visitor] = &clone
			continue
		}
		if v.firstSeenAt.Before(current.firstSeenAt) {
			current.firstSeenAt = v.firstSeenAt
			current.firstDay = v.firstDay
			current.firstPath = v.firstPath
		}
		if v.lastSeenAt.After(current.lastSeenAt) {
			current.lastSeenAt = v.lastSeenAt
			current.lastDay = v.lastDay
			current.lastPath = v.lastPath
		}
		current.pageViews += v.pageViews
		if current.userID == 0 {
			current.userID = v.userID
		}
		if current.channel == "" && v.channel != "" {
			current.channel = v.channel
			current.channelDetail = v.channelDetail
		}
		if current.ip == "" {
			current.ip = v.ip
		}
		if current.region.IsEmpty() && !v.region.IsEmpty() {
			current.region = v.region
		}
	}
}

// PendingVisits 返回内存里还没落库的访问量与访客数（仅测试与调试用）。
func (r *Recorder) PendingVisits() (int64, int) {
	if r == nil {
		return 0, 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var pv int64
	for _, bucket := range r.visits {
		pv += bucket.pv
	}
	return pv, len(r.visitors)
}

// PendingVisitorIDs 返回内存里还没落库的访客标识（升序，仅测试用）。
func (r *Recorder) PendingVisitorIDs() []string {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.visitors))
	for visitor := range r.visitors {
		out = append(out, visitor)
	}
	sort.Strings(out)
	return out
}
