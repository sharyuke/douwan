// Package localai 封装「本地 AI 推理节点」的 HTTP 调用与后台任务队列。
//
// 节点形态：一台内网的 Windows 机器（RTX 2060 6GB）跑着
//
//	ComfyUI  127.0.0.1:8188   —— 文生图 / 卡通化（SD 1.5）
//	rembg    127.0.0.1:7000   —— 抠图（u2net，CPU）
//
// 后端通过 SSH 反向隧道访问它们，所以配置里的地址永远是**本机回环**。
// 端口是否暴露由隧道保证（隧道只绑 127.0.0.1），本包不做任何监听。
//
// 依赖方向：本包**不** import model / repository / service。
// 队列只认「执行一条任务」的回调，取任务与落库都由调用方注入的回调完成。
// 这样既避免了 model → localai → model 的循环依赖，也让队列本身能脱离数据库单测。
package localai

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// JobRunner 是队列执行任务的方式，由 service 层实现。
//
// RunNext 的语义是「原子地抢一条任务并执行它」：
//   - claimed=true  表示抢到了并已执行完（无论成功失败，状态已由实现方落库）；
//   - claimed=false 表示当前没有待执行的任务，队列应当停下来等下一次唤醒；
//   - err != nil    表示这一条执行失败（实现方应当已经把它标记为 failed）。
//
// 为什么把「抢任务」放进这个回调而不是队列里：
// 队列不 import repository，拿不到数据库；而抢任务必须是**条件更新**
// （WHERE status='queued' → 'running'）才安全，这个 SQL 只有仓储层知道怎么写。
// 队列因此保持成一个纯粹的「什么时候该去抢」的调度器。
type JobRunner func(ctx context.Context) (claimed bool, err error)

// Queue 是本地 AI 任务的执行队列。
//
// 设计要点（都是被 6GB 显存与单节点逼出来的）：
//   - **串行执行**：RTX 2060 上两个 512×512 任务并发会互相挤显存，
//     比串行更慢，还可能直接 OOM。所以一次只跑一条，跑完再抢下一条；
//   - **准入在 service 层**：队列不做配额判断，只负责「有任务就按顺序执行」，
//     否则配额逻辑会散在两个地方；
//   - **通知非阻塞**：Notify 满了就丢弃，由兜底轮询保证不丢任务。
//     提交任务的 HTTP 请求绝不能因为队列拥塞被拖慢；
//   - **生命周期照 internal/activity/recorder.go 的纪律**：
//     Start(ctx) 派生 WithCancel，loop 用 select 等 ctx.Done()/ticker/stop，
//     单条任务用独立的 WithTimeout(Background)，Stop() 用 sync.Once + wg.Wait()。
type Queue struct {
	cfg  Config
	run  JobRunner
	wake chan struct{}
	stop chan struct{}
	// idleInterval 兜底轮询间隔：即使一次 Notify 都没收到，也定期去看看有没有任务。
	// 这是必需的 —— 进程重启后队列里可能已有 queued 任务，而它们的 Notify
	// 随上一个进程一起消失了。
	idleInterval time.Duration

	startOnce sync.Once
	stopOnce  sync.Once
	cancel    context.CancelFunc
	wg        sync.WaitGroup

	// 运行期统计（后台状态页展示）。
	mu        sync.Mutex
	completed int64
	failed    int64
	lastError string
}

// NewQueue 构造队列。run 为 nil 时 Start/Notify 都是空操作（单元测试场景）。
func NewQueue(cfg Config, run JobRunner) *Queue {
	interval := cfg.PollInterval
	if interval < time.Second {
		interval = time.Second
	}
	return &Queue{
		cfg:          cfg,
		run:          run,
		wake:         make(chan struct{}, 1),
		stop:         make(chan struct{}),
		idleInterval: interval,
	}
}

// Notify 通知队列「可能有新任务」。**非阻塞**。
//
// 写满说明已经有一次待处理的唤醒，再塞一次没有意义 —— 直接丢弃。
// 这是刻意的取舍：提交任务的 HTTP 请求不因为队列拥塞而被拖慢。
func (q *Queue) Notify() {
	if q.run == nil {
		return
	}
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// Start 启动工作协程。ctx 结束时它自行退出。可重复调用（只生效一次）。
func (q *Queue) Start(ctx context.Context) {
	if q.run == nil {
		return
	}
	q.startOnce.Do(func() {
		loopCtx, cancel := context.WithCancel(ctx)
		q.cancel = cancel
		q.wg.Add(1)
		go q.runLoop(loopCtx)
		slog.Info("本地 AI：任务队列已启动", "job_timeout", q.jobTimeout())
	})
}

// Stop 停止队列并等待当前任务收尾。可重复调用（server.Run 的 defer 与 Close 都会调）。
func (q *Queue) Stop() {
	if q.run == nil {
		return
	}
	q.stopOnce.Do(func() {
		close(q.stop)
		if q.cancel != nil {
			q.cancel()
		}
	})
	q.wg.Wait()
}

// Stats 运行期统计，供后台状态页。
func (q *Queue) Stats() (completed, failed int64, lastError string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.completed, q.failed, q.lastError
}

/* ------------------------------------------------------------------ 内部 */

// runLoop 是唯一的工作协程。
func (q *Queue) runLoop(ctx context.Context) {
	defer q.wg.Done()
	ticker := time.NewTicker(q.idleInterval)
	defer ticker.Stop()

	// 启动时先扫一次：处理「上一个进程退出时遗留在队列里的任务」
	q.drain(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-q.stop:
			return
		case <-q.wake:
			q.drain(ctx)
		case <-ticker.C:
			q.drain(ctx)
		}
	}
}

// drain 反复抢任务执行，直到「没有待执行任务」或「队列被要求停止」。
//
// 串行执行：跑完一条再抢下一条。这样「同时跑几个」严格等于 1，
// 不需要信号量，也不会出现两条任务同时抢显存。
func (q *Queue) drain(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-q.stop:
			return
		default:
		}

		// 单条任务用**独立**的 context：不能挂在 loopCtx 上，
		// 否则进程收到退出信号会立刻掐断正在推理的任务，留下一条永远 running 的记录
		// （更麻烦的是推理节点侧的模型状态没人清理）。
		jobCtx, cancel := context.WithTimeout(context.Background(), q.jobTimeout())
		claimed, err := q.run(jobCtx)
		cancel()

		q.mu.Lock()
		if err != nil {
			q.failed++
			q.lastError = err.Error()
		} else if claimed {
			q.completed++
		}
		q.mu.Unlock()

		if err != nil {
			slog.WarnContext(ctx, "本地 AI：任务执行失败", "err", err)
			// 失败不 return：后面可能还有排队任务，继续处理。
			// 这条任务的状态已由实现方落库为 failed，不会再次被抢到。
			continue
		}
		if !claimed {
			return // 没有排队任务了
		}
	}
}

func (q *Queue) jobTimeout() time.Duration {
	if q.cfg.JobTimeout < 10*time.Second {
		// 兜底：配置漏填时也必须有个有限值，否则任务会永久挂着
		return 10 * time.Minute
	}
	return q.cfg.JobTimeout
}
