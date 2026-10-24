package localai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

/* =========================================================================
   FileWorkflowStore 的测试

   重点是**深拷贝**：Load 返回的对象会被调用方就地打补丁（写提示词、写尺寸）。
   如果返回的是共享对象，上一个任务的提示词会泄漏到下一个任务里 ——
   这类 bug 在真机上表现为「偶尔生成了别人的提示词」，极难复现与定位。
   ========================================================================= */

func writeWorkflow(t *testing.T, dir, name string, body map[string]any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("序列化模板: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".json"), raw, 0o644); err != nil {
		t.Fatalf("写模板: %v", err)
	}
}

func TestWorkflowStore_LoadStripsMeta(t *testing.T) {
	dir := t.TempDir()
	writeWorkflow(t, dir, "txt2img", map[string]any{
		"__douwan": map[string]any{"name": "txt2img", "model": "sd15"},
		"3":        map[string]any{"class_type": "KSampler", "inputs": map[string]any{"steps": 24}},
	})

	store := NewFileWorkflowStore(dir)
	wf, err := store.Load("txt2img")
	if err != nil {
		t.Fatalf("Load 失败: %v", err)
	}
	// __douwan 必须被去掉：ComfyUI 会把未知键当成节点而报错
	if _, ok := wf["__douwan"]; ok {
		t.Error("__douwan 元数据段不应出现在提交给推理服务的工作流里")
	}
	if _, ok := wf["3"]; !ok {
		t.Error("节点 3 应该还在")
	}
}

// TestWorkflowStore_LoadReturnsIndependentCopies 是这一组里最重要的一条：
// 两次 Load 必须互不影响，改动第一次的结果不能影响第二次。
func TestWorkflowStore_LoadReturnsIndependentCopies(t *testing.T) {
	dir := t.TempDir()
	writeWorkflow(t, dir, "cartoonize", map[string]any{
		"6": map[string]any{"class_type": "CLIPTextEncode", "inputs": map[string]any{"text": "默认提示词"}},
		"3": map[string]any{"class_type": "KSampler", "inputs": map[string]any{"denoise": 0.6}},
	})
	store := NewFileWorkflowStore(dir)

	first, err := store.Load("cartoonize")
	if err != nil {
		t.Fatalf("第一次 Load: %v", err)
	}
	// 模拟调用方打补丁（applyParams 就是这么做）
	node := first["6"].(map[string]any)
	node["inputs"].(map[string]any)["text"] = "用户 A 的提示词"
	first["3"].(map[string]any)["inputs"].(map[string]any)["denoise"] = 0.95

	second, err := store.Load("cartoonize")
	if err != nil {
		t.Fatalf("第二次 Load: %v", err)
	}
	gotText := second["6"].(map[string]any)["inputs"].(map[string]any)["text"]
	if gotText != "默认提示词" {
		t.Errorf("提示词泄漏到下一个任务：期望 %q，得到 %q", "默认提示词", gotText)
	}
	gotDenoise := second["3"].(map[string]any)["inputs"].(map[string]any)["denoise"]
	if gotDenoise != 0.6 {
		t.Errorf("参数泄漏到下一个任务：期望 0.6，得到 %v", gotDenoise)
	}
}

// TestWorkflowStore_RejectsPathTraversal 挡住「模板名来自外部输入」的情况。
func TestWorkflowStore_RejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	writeWorkflow(t, dir, "ok", map[string]any{"3": map[string]any{"class_type": "X"}})
	store := NewFileWorkflowStore(dir)

	for _, bad := range []string{"../../etc/passwd", "a/b", "..", "", "x\x00y", "sub/../ok"} {
		if _, err := store.Load(bad); err == nil {
			t.Errorf("模板名 %q 应该被拒绝", bad)
		}
	}
}

func TestWorkflowStore_LoadMissingFileSetsLastError(t *testing.T) {
	store := NewFileWorkflowStore(t.TempDir())
	if _, err := store.Load("nope"); err == nil {
		t.Fatal("不存在的模板应该报错")
	}
	if store.LastError() == "" {
		t.Error("加载失败后 LastError 应该有内容（后台状态页靠它展示原因）")
	}
}

/* =========================================================================
   Queue 的测试

   队列是并发代码，测试重点：
     1. Notify 永不阻塞（提交任务的 HTTP 请求不能被队列拖慢）；
     2. run 抛错后队列还能继续处理后面的任务（一条业务失败不能卡死队列）；
     3. Stop 可重复调用，且 Start 是幂等的。
   ========================================================================= */

func testQueueConfig() Config {
	return Config{
		PollInterval: time.Hour, // 关掉兜底轮询，让测试完全由 Notify 驱动
		JobTimeout:   time.Minute,
	}
}

// TestQueue_NotifyNeverBlocks 验证 Notify 是「发不进去就丢」的语义。
func TestQueue_NotifyNeverBlocks(t *testing.T) {
	q := NewQueue(testQueueConfig(), func(context.Context) (bool, error) { return false, nil })
	done := make(chan struct{})
	go func() {
		defer close(done)
		// 通道容量只有 1，连续塞 100 次也必须立刻返回
		for i := 0; i < 100; i++ {
			q.Notify()
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Notify 阻塞了 —— 提交任务的请求会被队列拖住")
	}
}

// TestQueue_RunContinuesAfterError 一条任务失败不能让队列停摆。
func TestQueue_RunContinuesAfterError(t *testing.T) {
	var calls int32
	var claimed int32
	q := NewQueue(testQueueConfig(), func(context.Context) (bool, error) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			return true, context.DeadlineExceeded // 第一条失败
		}
		if atomic.AddInt32(&claimed, 1) <= 2 {
			return true, nil // 后面还有两条要跑
		}
		return false, nil // 队列空
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	q.Start(ctx)
	q.Notify()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&claimed) >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	q.Stop()

	if got := atomic.LoadInt32(&claimed); got < 2 {
		t.Errorf("第一条失败后队列没有继续处理后续任务：claimed=%d", got)
	}
	if _, failed, _ := q.Stats(); failed == 0 {
		t.Error("失败计数没有增加")
	}
}

// TestQueue_StopIsIdempotentAndSafe 与 activity.Recorder 的纪律一致：
// server.Run 的 defer 与 server.Close 都会调 Stop，必须可重复调用。
func TestQueue_StopIsIdempotentAndSafe(t *testing.T) {
	q := NewQueue(testQueueConfig(), func(context.Context) (bool, error) { return false, nil })
	ctx, cancel := context.WithCancel(context.Background())
	q.Start(ctx)
	q.Start(ctx) // 第二次 Start 不应起第二个协程

	done := make(chan struct{})
	go func() {
		defer close(done)
		q.Stop()
		q.Stop()
		q.Stop()
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Stop 重复调用时卡住了")
	}
	cancel()
}

// TestQueue_NilRunnerIsInert 队列未装配（nil runner）时所有方法都应是空操作，
// 这样 handler 测试里可以不装配队列也不会 panic。
func TestQueue_NilRunnerIsInert(t *testing.T) {
	q := NewQueue(testQueueConfig(), nil)
	q.Notify()
	q.Start(context.Background())
	q.Stop()
}

// TestQueue_StartDrainsLeftoverJobs 启动时先扫一次队列，
// 处理「上次进程退出时遗留的任务」（它们的 Notify 已随进程消失）。
func TestQueue_StartDrainsLeftoverJobs(t *testing.T) {
	var mu sync.Mutex
	var ran int
	q := NewQueue(testQueueConfig(), func(context.Context) (bool, error) {
		mu.Lock()
		defer mu.Unlock()
		ran++
		return ran <= 1, nil // 只有一条遗留任务
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	q.Start(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := ran
		mu.Unlock()
		if n >= 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	q.Stop()
	mu.Lock()
	defer mu.Unlock()
	if ran == 0 {
		t.Error("启动时没有扫遗留任务：进程重启后队列里的任务会永远卡住")
	}
}

/* =========================================================================
   PNGSize / truncate 等纯函数
   ========================================================================= */

func TestPNGSize(t *testing.T) {
	// 构造一个最小的 PNG 头（签名 + IHDR 长度/类型 + 宽高）
	head := []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // 签名
		0, 0, 0, 13, 'I', 'H', 'D', 'R',
		0, 0, 0x02, 0x00, // 宽 = 512
		0, 0, 0x01, 0x00, // 高 = 256
		8, 6, 0, 0, 0,
	}
	w, h := PNGSize(head)
	if w != 512 || h != 256 {
		t.Errorf("PNGSize = (%d,%d)，期望 (512,256)", w, h)
	}
	if w, h := PNGSize([]byte("not a png")); w != 0 || h != 0 {
		t.Error("非 PNG 应返回 (0,0)")
	}
}

func TestTruncate(t *testing.T) {
	if got := truncate([]byte("  hi  "), 10); got != "hi" {
		t.Errorf("truncate 应去掉首尾空白，得到 %q", got)
	}
	long := make([]byte, 100)
	for i := range long {
		long[i] = 'a'
	}
	got := truncate(long, 10)
	// 截断后会补一个省略号（3 字节的 UTF-8 省略号），所以放宽到 10+3
	if len(got) > 13 {
		t.Errorf("超长文本没有被截断：len=%d", len(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("截断后应带省略号，实际 %q", got)
	}
}
