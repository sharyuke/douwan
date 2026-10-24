package activity

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/middleware"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
)

// markedUserIDKey 是「处理函数主动告知本次请求属于哪个用户」的上下文键。
//
// 为什么需要它：登录 / 注册接口是没有令牌的（那时用户还没登录态），
// Auth 中间件拿不到用户 ID，但这两件事本身是重要的活跃行为。
// 处理函数在成功之后调用 Mark(c, user.ID) 补上。
const markedUserIDKey = "douwan_activity_user_id"

// Mark 把当前请求标记为「属于某个用户」。
// 必须在处理函数里、写响应之前调用。
func Mark(c *gin.Context, userID uint64) {
	if c == nil || userID == 0 {
		return
	}
	c.Set(markedUserIDKey, userID)
}

func markedUserID(c *gin.Context) uint64 {
	if c == nil {
		return 0
	}
	if v, ok := c.Get(markedUserIDKey); ok {
		if id, ok := v.(uint64); ok {
			return id
		}
	}
	return 0
}

// dailyKey 是内存缓冲的键：一个用户一天一个桶。
type dailyKey struct {
	userID uint64
	day    string
}

// featureKey 是功能计数的键：用户 × 天 × 功能 × 来源。
type featureKey struct {
	userID  uint64
	day     string
	feature string
	source  string
}

// dailyBucket 是内存里正在累加的一天。
type dailyBucket struct {
	firstAt  time.Time
	lastAt   time.Time
	requests int64
	features int64
	ip       string
	region   model.GeoRegion
}

// Stats 是采集器的运行状态，供后台接口展示「数据有多新」。
//
// 活跃与访问量是两套缓冲（口径不同），所以计数也分开报：
// 混在一起会让「缓冲里还有多少没落库」这个问题没法回答。
type Stats struct {
	Enabled         bool       `json:"enabled"`
	BufferedBuckets int        `json:"buffered_buckets"`
	BufferedHits    int64      `json:"buffered_hits"`
	DroppedHits     int64      `json:"dropped_hits"`
	FlushedBuckets  int64      `json:"flushed_buckets"`
	LastFlushAt     *time.Time `json:"last_flush_at"`
	LastError       string     `json:"last_error"`
	GeoEnabled      bool       `json:"geo_enabled"`
	GeoDisabledNote string     `json:"geo_disabled_note"`
	// 访问量（PV / UV）缓冲：buffered_visits 是还没落库的访问次数，
	// buffered_visitors 是其中的去重访客数，dropped_visits 是缓冲溢出丢弃的上报数。
	BufferedVisits   int64 `json:"buffered_visits"`
	BufferedVisitors int   `json:"buffered_visitors"`
	DroppedVisits    int64 `json:"dropped_visits"`
}

// Recorder 是活跃数据采集器。
//
// 它在请求路径上只做内存累加（几纳秒量级），真正的写库交给
// flushLoop 每 FlushInterval 批量做一次；进程退出前会做最后一次 flush，
// 所以正常重启不会丢数据。进程被 kill -9 时最多丢一个周期的增量——
// 这是刻意接受的取舍，日活这种统计不需要事务级精确。
type Recorder struct {
	cfg   config.Activity
	repos *repository.Repositories
	geo   *GeoResolver

	// now 便于测试注入固定时间
	now func() time.Time

	mu       sync.Mutex
	daily    map[dailyKey]*dailyBucket
	features map[featureKey]int64
	dropped  int64

	// 访问量（PV / UV）缓冲。与活跃分开累加，但共用同一个 flush 周期与缓冲上限。
	visits       map[visitKey]*visitBucket
	visitors     map[string]*visitorBucket
	visitSeen    map[visitKey]time.Time
	visitDropped int64

	statMu         sync.Mutex
	flushedBuckets int64
	lastFlushAt    *time.Time
	lastError      string

	cancelOnce sync.Once
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

// NewRecorder 构造采集器。repos 为 nil 时退化成「只统计不落库」（测试用）。
//
// 这里对零值配置做兜底：配置校验只在服务启动时跑，而单元测试会直接用
// config.Activity{} 构造采集器，零值会让「缓冲上限」变成 0（等于全丢）。
func NewRecorder(cfg config.Activity, repos *repository.Repositories, geo *GeoResolver) *Recorder {
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 10 * time.Second
	}
	if cfg.BufferLimit <= 0 {
		cfg.BufferLimit = 20000
	}
	if cfg.RetainDays <= 0 {
		cfg.RetainDays = 400
	}
	if cfg.CleanupInterval <= 0 {
		cfg.CleanupInterval = 12 * time.Hour
	}
	return &Recorder{
		cfg:       cfg,
		repos:     repos,
		geo:       geo,
		now:       time.Now,
		daily:     map[dailyKey]*dailyBucket{},
		features:  map[featureKey]int64{},
		visits:    map[visitKey]*visitBucket{},
		visitors:  map[string]*visitorBucket{},
		visitSeen: map[visitKey]time.Time{},
	}
}

// Enabled 判断采集是否开启。
func (r *Recorder) Enabled() bool { return r != nil && r.cfg.Enabled }

// FlushInterval 返回落库周期，供接口说明数据新鲜度。
func (r *Recorder) FlushInterval() time.Duration {
	if r == nil || r.cfg.FlushInterval <= 0 {
		return 10 * time.Second
	}
	return r.cfg.FlushInterval
}

// Start 启动落库与清理两个后台协程。ctx 结束时它们会自行退出。
func (r *Recorder) Start(ctx context.Context) {
	if !r.Enabled() {
		slog.Info("活跃监控：采集已关闭（activity.enabled=false）")
		return
	}
	loopCtx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.wg.Add(2)
	go r.flushLoop(loopCtx)
	go r.cleanupLoop(loopCtx)
	slog.Info("活跃监控：采集已启动",
		"flush_interval", r.cfg.FlushInterval, "buffer_limit", r.cfg.BufferLimit, "retain_days", r.cfg.RetainDays)
}

// Stop 停止后台协程并做最后一次落库。可重复调用。
//
// 最后一次落库刻意不复用调用方的 ctx：收到退出信号时那个 ctx 已经取消了，
// 沿用它会导致「一退出就把缓冲里的增量全丢掉」。这里另起一个带超时的
// 后台 ctx，最多多等 30 秒，换取数据不丢。
func (r *Recorder) Stop() {
	if !r.Enabled() {
		return
	}
	r.cancelOnce.Do(func() {
		if r.cancel != nil {
			r.cancel()
		}
	})
	r.wg.Wait()
	flushCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := r.Flush(flushCtx); err != nil {
		slog.Error("活跃监控：退出前的最后一次落库失败，本批增量将丢失", "err", err)
	}
	if r.geo != nil {
		r.geo.Close()
	}
}

// Middleware 返回采集中间件。
//
// 它注册在引擎的最前面，靠 c.Next() 之后的代码「回看」这次请求：
// 那时 Auth 中间件已经把用户 ID 放进上下文、处理函数也已经跑完，
// 所以不用关心各业务分组是怎么挂中间件的。
func (r *Recorder) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if !r.Enabled() {
			return
		}
		userID := middleware.CurrentUserID(c)
		if userID == 0 {
			userID = markedUserID(c)
		}
		if userID == 0 {
			return // 匿名访问不计入用户活跃
		}
		path := c.FullPath()
		if !shouldTrack(c.Request.Method, path) {
			return
		}
		r.Touch(userID, r.now(), c.ClientIP(), FeatureForRoute(c.Request.Method, path))
	}
}

// Touch 记一次接口请求（有对应功能点时同时记一次功能使用）。
//
// 功能次数与请求次数是两个口径：请求次数统计「来过多少次」，
// 功能次数统计「用了几次功能」。所以命中功能点时两个计数都 +1，
// 没命中（例如刷新令牌、读取公开设置）只加请求次数。
func (r *Recorder) Touch(userID uint64, at time.Time, ip, feature string) {
	if !r.Enabled() || userID == 0 {
		return
	}
	featureHits := int64(0)
	if feature != "" {
		featureHits = 1
	}
	r.add(userID, at, ip, 1, featureHits)
	if feature != "" {
		r.addFeature(userID, at, feature, model.ActivitySourceAPI, 1)
	}
}

// RecordClientFeature 记客户端上报的功能使用次数。
//
// count 是这次上报里该功能的次数；at 允许回补（前端离线批量上报），
// 但不能超过 maxBackfillDays，由服务层校验。
func (r *Recorder) RecordClientFeature(userID uint64, at time.Time, ip, feature string, count int64) {
	if !r.Enabled() || userID == 0 || feature == "" || count <= 0 {
		return
	}
	r.add(userID, at, ip, 0, count)
	r.addFeature(userID, at, feature, model.ActivitySourceClient, count)
}

// add 累加「用户 × 天」。
func (r *Recorder) add(userID uint64, at time.Time, ip string, requests, features int64) {
	day := model.ActivityDay(at)
	key := dailyKey{userID: userID, day: day}

	r.mu.Lock()
	defer r.mu.Unlock()
	bucket, ok := r.daily[key]
	if !ok {
		// 缓冲上限是防线：数据库长时间不可用时也必须有个头，
		// 否则内存可能把 1.6G 的小机器压垮。
		if len(r.daily) >= r.cfg.BufferLimit {
			r.dropped++
			return
		}
		bucket = &dailyBucket{firstAt: at, lastAt: at, ip: ip}
		if r.geo != nil {
			bucket.region = r.geo.Resolve(ip)
		}
		r.daily[key] = bucket
	}
	if at.Before(bucket.firstAt) {
		bucket.firstAt = at
	}
	if at.After(bucket.lastAt) {
		bucket.lastAt = at
	}
	bucket.requests += requests
	bucket.features += features
	if ip != "" {
		bucket.ip = ip
		// 地区跟着最后一个 IP 走：用户换了网络（例如从公司到 4G），
		// 当天的归属地取最近一次，与 IP 字段保持一致。
		if r.geo != nil {
			if region := r.geo.Resolve(ip); !region.IsEmpty() {
				bucket.region = region
			}
		}
	}
}

// addFeature 累加功能计数。
func (r *Recorder) addFeature(userID uint64, at time.Time, feature, source string, count int64) {
	key := featureKey{userID: userID, day: model.ActivityDay(at), feature: feature, source: source}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.features[key]; !ok && len(r.features) >= r.cfg.BufferLimit {
		r.dropped++
		return
	}
	r.features[key] += count
}

// Flush 把当前缓冲落库。失败时把增量放回缓冲等下一轮重试。
func (r *Recorder) Flush(ctx context.Context) error {
	if !r.Enabled() || r.repos == nil {
		return nil
	}
	r.mu.Lock()
	if len(r.daily) == 0 && len(r.features) == 0 && len(r.visits) == 0 && len(r.visitors) == 0 {
		r.mu.Unlock()
		return nil
	}
	daily := r.daily
	features := r.features
	r.daily = map[dailyKey]*dailyBucket{}
	r.features = map[featureKey]int64{}
	r.mu.Unlock()

	dailyDeltas := make([]repository.ActivityDailyDelta, 0, len(daily))
	userIDs := make([]uint64, 0, len(daily))
	maxAt := time.Time{}
	for key, bucket := range daily {
		dailyDeltas = append(dailyDeltas, repository.ActivityDailyDelta{
			UserID:        key.userID,
			Day:           key.day,
			FirstActiveAt: bucket.firstAt,
			LastActiveAt:  bucket.lastAt,
			RequestCount:  bucket.requests,
			FeatureCount:  bucket.features,
			IP:            bucket.ip,
			Region:        bucket.region,
		})
		userIDs = append(userIDs, key.userID)
		if bucket.lastAt.After(maxAt) {
			maxAt = bucket.lastAt
		}
	}
	featureDeltas := make([]repository.ActivityFeatureDelta, 0, len(features))
	for key, hits := range features {
		featureDeltas = append(featureDeltas, repository.ActivityFeatureDelta{
			UserID:  key.userID,
			Day:     key.day,
			Feature: key.feature,
			Source:  key.source,
			Count:   hits,
		})
	}

	if err := r.repos.Activity.UpsertDaily(ctx, dailyDeltas); err != nil {
		r.mergeBack(daily, features)
		r.recordError(err)
		return err
	}
	if err := r.repos.Activity.UpsertFeatures(ctx, featureDeltas); err != nil {
		// 日汇总已经写进去了，只回填功能计数，避免重复累加请求次数
		r.mergeBack(nil, features)
		r.recordError(err)
		return err
	}
	if err := r.repos.Activity.TouchLastActive(ctx, userIDs, maxAt); err != nil {
		// last_active_at 是冗余字段，丢了不影响统计，下个周期会再写
		slog.Warn("活跃监控：更新最近活跃时间失败（不影响统计）", "err", err)
	}
	// 访问量（PV / UV）与活跃共用这次落库周期：它失败时同样把增量放回缓冲，
	// 但**不回滚已经写好的活跃数据**——两者是独立的统计，一个写失败不该牵连另一个。
	if err := r.flushVisits(ctx); err != nil {
		r.recordError(err)
		return err
	}

	r.mu.Lock()
	r.flushedBuckets += int64(len(daily))
	r.mu.Unlock()
	r.statMu.Lock()
	at := r.now()
	r.lastFlushAt = &at
	r.lastError = ""
	r.statMu.Unlock()
	return nil
}

// mergeBack 把落库失败的增量放回缓冲。
func (r *Recorder) mergeBack(daily map[dailyKey]*dailyBucket, features map[featureKey]int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, bucket := range daily {
		current, ok := r.daily[key]
		if !ok {
			if len(r.daily) >= r.cfg.BufferLimit {
				r.dropped += bucket.requests + bucket.features
				continue
			}
			clone := *bucket
			r.daily[key] = &clone
			continue
		}
		if bucket.firstAt.Before(current.firstAt) {
			current.firstAt = bucket.firstAt
		}
		if bucket.lastAt.After(current.lastAt) {
			current.lastAt = bucket.lastAt
		}
		current.requests += bucket.requests
		current.features += bucket.features
		if current.ip == "" {
			current.ip = bucket.ip
		}
		if current.region.IsEmpty() && !bucket.region.IsEmpty() {
			current.region = bucket.region
		}
	}
	for key, hits := range features {
		if _, ok := r.features[key]; !ok && len(r.features) >= r.cfg.BufferLimit {
			r.dropped += hits
			continue
		}
		r.features[key] += hits
	}
}

func (r *Recorder) recordError(err error) {
	r.statMu.Lock()
	r.lastError = err.Error()
	r.statMu.Unlock()
	slog.Error("活跃监控：落库失败，本批增量已放回缓冲等待重试", "err", err)
}

// flushLoop 周期性落库。
func (r *Recorder) flushLoop(ctx context.Context) {
	defer r.wg.Done()
	interval := r.cfg.FlushInterval
	if interval <= 0 {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 单次落库最多等 30s：卡住的话下个周期继续，不阻塞退出
			flushCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			err := r.Flush(flushCtx)
			cancel()
			if err != nil && r.bufferHighWater() {
				slog.Warn("活跃监控：缓冲积压，若持续出现请检查数据库",
					"buffered", r.Stats().BufferedBuckets, "limit", r.cfg.BufferLimit)
			}
		}
	}
}

// cleanupLoop 周期清理超期的活跃明细。
func (r *Recorder) cleanupLoop(ctx context.Context) {
	defer r.wg.Done()
	interval := r.cfg.CleanupInterval
	if interval <= 0 {
		interval = 12 * time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.Purge(ctx)
		}
	}
}

// Purge 删除超过保留期的活跃明细与访问明细，返回删除行数。
//
// 返回值依次是：活跃日汇总 / 功能明细 / 访问明细 / 访客档案（档案不清理，恒为 0）。
func (r *Recorder) Purge(ctx context.Context) (int64, int64, int64) {
	if !r.Enabled() || r.repos == nil {
		return 0, 0, 0
	}
	cutoff := model.ActivityDay(r.now().AddDate(0, 0, -r.cfg.RetainDays))
	daily, features, err := r.repos.Activity.PurgeBefore(ctx, cutoff)
	if err != nil {
		slog.Error("活跃监控：清理超期明细失败", "err", err)
		return 0, 0, 0
	}
	visits, err := r.repos.Visit.PurgeVisitsBefore(ctx, cutoff)
	if err != nil {
		slog.Error("活跃监控：清理超期访问明细失败", "err", err)
		return daily, features, 0
	}
	if daily+features+visits > 0 {
		slog.Info("活跃监控：已清理超期明细",
			"before_day", cutoff, "daily", daily, "feature", features, "visits", visits)
	}
	return daily, features, visits
}

// bufferHighWater 判断缓冲是否已经用掉一半以上。
func (r *Recorder) bufferHighWater() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.daily)+len(r.features)+len(r.visits)+len(r.visitors) >= r.cfg.BufferLimit/2
}

// Stats 返回采集器状态。
func (r *Recorder) Stats() Stats {
	if r == nil {
		return Stats{Enabled: false, GeoDisabledNote: "采集器未初始化"}
	}
	stats := Stats{Enabled: r.cfg.Enabled, GeoEnabled: r.geo.Enabled()}
	if !stats.GeoEnabled {
		stats.GeoDisabledNote = r.geo.DisabledReason()
	}
	r.mu.Lock()
	stats.BufferedBuckets = len(r.daily)
	stats.DroppedHits = r.dropped
	stats.DroppedVisits = r.visitDropped
	stats.BufferedVisitors = len(r.visitors)
	for _, hits := range r.features {
		stats.BufferedHits += hits
	}
	for _, bucket := range r.daily {
		stats.BufferedHits += bucket.requests + bucket.features
	}
	for _, bucket := range r.visits {
		stats.BufferedVisits += bucket.pv
	}
	r.mu.Unlock()

	r.statMu.Lock()
	stats.FlushedBuckets = r.flushedBuckets
	stats.LastError = r.lastError
	if r.lastFlushAt != nil {
		at := *r.lastFlushAt
		stats.LastFlushAt = &at
	}
	r.statMu.Unlock()
	// 注意：LastFlushAt 为 nil 就是「还没落过库」，
	// 不要用当前时间兜底——那会让界面显示一个不存在的落库时间。
	return stats
}

// PendingFeatures 返回内存里还没落库的功能计数键（按功能聚合），仅供调试与测试。
func (r *Recorder) PendingFeatures() map[string]int64 {
	out := map[string]int64{}
	if r == nil {
		return out
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, hits := range r.features {
		out[key.feature+"/"+key.source] += hits
	}
	return out
}

// PendingUsers 返回内存里还没落库的用户 ID（升序），仅供测试。
func (r *Recorder) PendingUsers() []uint64 {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	seen := map[uint64]bool{}
	for key := range r.daily {
		seen[key.userID] = true
	}
	out := make([]uint64, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
