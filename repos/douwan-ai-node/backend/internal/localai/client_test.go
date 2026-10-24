package localai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

/* =========================================================================
   Client 与 Executor 的 HTTP 契约测试（喂假推理服务，不碰真节点）

   这一组补上「提交 → 轮询 → 取回」的端到端路径：前面的测试覆盖了队列与
   模板，但没有验证过我们发给 ComfyUI / rembg 的**请求长什么样**、
   以及**响应解析**是否正确。契约一旦写错，只有真机上才会暴露。

   重点是三条硬约束（都来自阶段 B 的实测）：
     1. rembg 必须显式带 model=u2net（不带就等于用了商业授权的 bria-rmbg）；
     2. LoadImage 需要 "subfolder/name" 形式，只给文件名会找不到图；
     3. ComfyUI 的成功/失败判定看 status.status_str，不看 HTTP 码。
   ========================================================================= */

func testClientConfig(comfyURL, rembgURL string) Config {
	return Config{
		ComfyURL:      comfyURL,
		RembgURL:      rembgURL,
		HealthTimeout: 3 * time.Second,
		SubmitTimeout: 5 * time.Second,
		PollInterval:  10 * time.Millisecond,
		JobTimeout:    time.Minute,
		Checkpoint:    "v1-5-pruned-emaonly.ckpt",
		MattingModel:  "u2net",
	}
}

// minimalPNG 造一个带正确 IHDR 的 PNG 头，够 PNGSize 解析尺寸。
func minimalPNG(w, h int) []byte {
	buf := &bytes.Buffer{}
	buf.Write([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})
	buf.Write([]byte{0, 0, 0, 13, 'I', 'H', 'D', 'R'})
	buf.Write([]byte{byte(w >> 24), byte(w >> 16), byte(w >> 8), byte(w)})
	buf.Write([]byte{byte(h >> 24), byte(h >> 16), byte(h >> 8), byte(h)})
	buf.Write([]byte{8, 6, 0, 0, 0})
	return buf.Bytes()
}

// TestClient_RemoveBackgroundAlwaysSendsModel 是**合规红线**的守卫测试。
// 漏掉 model 字段时 rembg 会用商业授权的 bria-rmbg 并返回 200（实测确认），
// 所以这里断言请求里一定有它。
func TestClient_RemoveBackgroundAlwaysSendsModel(t *testing.T) {
	var gotModel, gotField string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseMultipartForm(1 << 20)
		gotModel = r.FormValue("model")
		// 字段名必须是 file（rembg 服务端的参数名）
		if _, _, err := r.FormFile("file"); err == nil {
			gotField = "file"
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(minimalPNG(512, 512))
	}))
	defer srv.Close()

	c := New(testClientConfig(srv.URL, srv.URL))
	out, err := c.RemoveBackground(context.Background(), "x.png", strings.NewReader("fake"), true)
	if err != nil {
		t.Fatalf("RemoveBackground: %v", err)
	}
	if gotModel != "u2net" {
		t.Errorf("请求里的 model = %q，期望 u2net —— 不带 model 会回落到商业授权的 bria-rmbg", gotModel)
	}
	if gotField != "file" {
		t.Errorf("文件字段名不是 file（rembg 服务端只认这个）")
	}
	if len(out) == 0 {
		t.Error("没有返回图片内容")
	}
}

// TestClient_RemoveBackgroundRefusesEmptyModel 模型名为空时必须直接报错，
// 而不是把请求发出去让服务端用默认（商业授权）模型。
func TestClient_RemoveBackgroundRefusesEmptyModel(t *testing.T) {
	var called int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&called, 1)
		_, _ = w.Write(minimalPNG(8, 8))
	}))
	defer srv.Close()

	cfg := testClientConfig(srv.URL, srv.URL)
	cfg.MattingModel = ""
	c := New(cfg)
	if _, err := c.RemoveBackground(context.Background(), "x.png", strings.NewReader("fake"), false); err == nil {
		t.Fatal("模型名为空时应当报错")
	}
	if n := atomic.LoadInt32(&called); n != 0 {
		t.Errorf("模型名为空时不应该发出请求，实际发了 %d 次", n)
	}
}

// TestClient_UploadImageReturnsSubfolderPath LoadImage 需要 "subfolder/name"。
func TestClient_UploadImageReturnsSubfolderPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/upload/image" {
			t.Errorf("路径 = %s，期望 /upload/image", r.URL.Path)
		}
		_ = r.ParseMultipartForm(1 << 20)
		if r.FormValue("type") != "input" {
			t.Error("表单缺少 type=input")
		}
		if r.FormValue("subfolder") != "douwan" {
			t.Errorf("表单 subfolder = %q，期望 douwan", r.FormValue("subfolder"))
		}
		_, _ = w.Write([]byte(`{"name":"a.png","subfolder":"douwan","type":"input"}`))
	}))
	defer srv.Close()

	c := New(testClientConfig(srv.URL, srv.URL))
	name, err := c.UploadImage(context.Background(), "a.png", strings.NewReader("x"), "douwan")
	if err != nil {
		t.Fatalf("UploadImage: %v", err)
	}
	if name != "douwan/a.png" {
		t.Errorf("返回 %q，期望 douwan/a.png（只给文件名 ComfyUI 找不到图）", name)
	}
}

// TestClient_SubmitComfyReturnsPromptID
func TestClient_SubmitComfyReturnsPromptID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload struct {
			Prompt   map[string]any `json:"prompt"`
			ClientID string         `json:"client_id"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Errorf("请求体不是合法 JSON: %v", err)
		}
		if len(payload.Prompt) == 0 {
			t.Error("prompt 为空")
		}
		_, _ = w.Write([]byte(`{"prompt_id":"pid-123"}`))
	}))
	defer srv.Close()

	c := New(testClientConfig(srv.URL, srv.URL))
	id, err := c.SubmitComfy(context.Background(), map[string]any{"3": map[string]any{"class_type": "KSampler"}}, "cid")
	if err != nil {
		t.Fatalf("SubmitComfy: %v", err)
	}
	if id != "pid-123" {
		t.Errorf("prompt_id = %q，期望 pid-123", id)
	}
}

// TestClient_SubmitComfyRejectsMissingPromptID 服务端 200 但没有 prompt_id 也算失败。
func TestClient_SubmitComfyRejectsMissingPromptID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"error":"bad workflow"}`))
	}))
	defer srv.Close()

	c := New(testClientConfig(srv.URL, srv.URL))
	if _, err := c.SubmitComfy(context.Background(), map[string]any{"3": map[string]any{}}, "cid"); err == nil {
		t.Fatal("没有 prompt_id 时应当报错")
	}
}

// TestClient_PollComfyStates 覆盖三种状态判定（未完成 / 成功 / 失败）。
func TestClient_PollComfyStates(t *testing.T) {
	var mode atomic.Value
	mode.Store("pending")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch mode.Load().(string) {
		case "pending":
			_, _ = w.Write([]byte(`{}`)) // 还没进 history
		case "running":
			_, _ = w.Write([]byte(`{"pid-1":{"status":{"status_str":"","completed":false},"outputs":{}}}`))
		case "success":
			_, _ = w.Write([]byte(`{"pid-1":{"status":{"status_str":"success","completed":true},"outputs":{"9":{"images":[{"filename":"o.png","subfolder":"","type":"output"}]}}}}`))
		case "error":
			_, _ = w.Write([]byte(`{"pid-1":{"status":{"status_str":"error","completed":true,"messages":[["execution_error",{"exception_message":"CUDA out of memory"}]]},"outputs":{}}}`))
		}
	}))
	defer srv.Close()

	c := New(testClientConfig(srv.URL, srv.URL))
	ctx := context.Background()

	for _, want := range []struct {
		mode     string
		finished bool
		failed   bool
		images   int
	}{
		{"pending", false, false, 0},
		{"running", false, false, 0},
		{"success", true, false, 1},
		{"error", true, true, 0},
	} {
		mode.Store(want.mode)
		res, err := c.PollComfy(ctx, "pid-1")
		if err != nil {
			t.Fatalf("模式 %s：PollComfy 报错 %v", want.mode, err)
		}
		if res.Finished != want.finished {
			t.Errorf("模式 %s：Finished = %v，期望 %v", want.mode, res.Finished, want.finished)
		}
		if res.Failed != want.failed {
			t.Errorf("模式 %s：Failed = %v，期望 %v", want.mode, res.Failed, want.failed)
		}
		if len(res.Images) != want.images {
			t.Errorf("模式 %s：产物数 = %d，期望 %d", want.mode, len(res.Images), want.images)
		}
		if want.failed && !strings.Contains(res.Message, "out of memory") {
			t.Errorf("模式 %s：失败原因没有从 exception_message 里挖出来：%q", want.mode, res.Message)
		}
	}
}

// TestClient_UnavailableWhenServerDown 连不上时必须归类为 ErrUnavailable，而不是普通 error ——
// 上层据此决定对外文案是「服务不可用」还是「参数问题」。
func TestClient_UnavailableWhenServerDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close() // 关掉，制造连接失败

	c := New(testClientConfig(url, url))
	_, err := c.Stats(context.Background())
	if err == nil {
		t.Fatal("服务已关闭时 Stats 应当报错")
	}
	if !strings.Contains(err.Error(), "不可用") {
		t.Errorf("错误应归类为「不可用」，实际：%v", err)
	}
}

// TestClient_StatsParsesVRAM 显存字段是后台「节点状态」页的核心信息。
func TestClient_StatsParsesVRAM(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprint(w, `{"system":{"comfyui_version":"0.16.4","os":"win32"},
			"devices":[{"name":"cuda:0 NVIDIA GeForce RTX 2060","vram_total":6442123264,"vram_free":3082813440}]}`)
	}))
	defer srv.Close()

	c := New(testClientConfig(srv.URL, srv.URL))
	st, err := c.Stats(context.Background())
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if st.Version != "0.16.4" {
		t.Errorf("版本 = %q", st.Version)
	}
	if st.VRAMTotal != 6442123264 || st.VRAMFree != 3082813440 {
		t.Errorf("显存解析错误：total=%d free=%d", st.VRAMTotal, st.VRAMFree)
	}
	if !strings.Contains(st.Device, "RTX 2060") {
		t.Errorf("设备名 = %q", st.Device)
	}
}

// TestClient_RembgStatusReturnsRoutes 探活同时返回真实路由，便于核对契约没被升级改掉。
func TestClient_RembgStatusReturnsRoutes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"paths":{"/api/remove":{"post":{},"get":{}}}}`))
	}))
	defer srv.Close()

	c := New(testClientConfig(srv.URL, srv.URL))
	routes, err := c.RembgStatus(context.Background())
	if err != nil {
		t.Fatalf("RembgStatus: %v", err)
	}
	if len(routes) != 2 {
		t.Errorf("路由数 = %d，期望 2：%v", len(routes), routes)
	}
}

/* =========================================================================
   Executor：把 JobSpec 翻译成调用
   ========================================================================= */

type staticWorkflow struct{ wf map[string]any }

func (s *staticWorkflow) Load(string) (map[string]any, error) {
	// 深拷贝，模拟 FileWorkflowStore 的行为
	blob, _ := json.Marshal(s.wf)
	var out map[string]any
	_ = json.Unmarshal(blob, &out)
	return out, nil
}

// TestExecutor_Txt2ImageAppliesParams 参数要真的写进工作流模板。
func TestExecutor_Txt2ImageAppliesParams(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/prompt":
			body, _ := io.ReadAll(r.Body)
			var payload struct {
				Prompt map[string]any `json:"prompt"`
			}
			_ = json.Unmarshal(body, &payload)
			captured = payload.Prompt
			_, _ = w.Write([]byte(`{"prompt_id":"p1"}`))
		case "/history/p1":
			_, _ = w.Write([]byte(`{"p1":{"status":{"status_str":"success","completed":true},"outputs":{"9":{"images":[{"filename":"o.png","type":"output"}]}}}}`))
		case "/view":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(minimalPNG(512, 512))
		}
	}))
	defer srv.Close()

	wf := map[string]any{
		"3": map[string]any{"class_type": "KSampler", "inputs": map[string]any{"steps": 24.0, "cfg": 7.0, "denoise": 1.0}},
		"5": map[string]any{"class_type": "EmptyLatentImage", "inputs": map[string]any{"width": 512.0, "height": 512.0}},
		"6": map[string]any{"class_type": "CLIPTextEncode", "inputs": map[string]any{"text": "默认"}},
		"7": map[string]any{"class_type": "CLIPTextEncode", "inputs": map[string]any{"text": "负默认"}},
		"9": map[string]any{"class_type": "SaveImage", "inputs": map[string]any{}},
	}
	ex := NewExecutor(testClientConfig(srv.URL, srv.URL), New(testClientConfig(srv.URL, srv.URL)), &staticWorkflow{wf: wf})

	params, _ := json.Marshal(JobParams{Prompt: "一只熊猫", Steps: 30, CFG: 8.5, Width: 640, Height: 640})
	res, err := ex.Execute(context.Background(), JobSpec{JobID: 1, Kind: KindText2Image, Params: params}, nil)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(res.Image) == 0 {
		t.Error("没有取回产物")
	}

	assertInput := func(node, field string, want any) {
		t.Helper()
		n, ok := captured[node].(map[string]any)
		if !ok {
			t.Fatalf("工作流里没有节点 %s", node)
		}
		got := n["inputs"].(map[string]any)[field]
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("节点 %s.%s = %v，期望 %v", node, field, got, want)
		}
	}
	assertInput("6", "text", "一只熊猫")
	assertInput("3", "steps", 30)
	assertInput("3", "cfg", 8.5)
	assertInput("5", "width", 640)
	assertInput("5", "height", 640)
}

// TestExecutor_CartoonizeUploadsInputThenPatchesLoadImage img2img 必须
// 先把图传到节点，并把返回的 subfolder/name 写进 LoadImage。
func TestExecutor_CartoonizeUploadsInputThenPatchesLoadImage(t *testing.T) {
	var uploaded int32
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/upload/image":
			atomic.AddInt32(&uploaded, 1)
			_, _ = w.Write([]byte(`{"name":"in.png","subfolder":"douwan"}`))
		case "/prompt":
			body, _ := io.ReadAll(r.Body)
			var payload struct {
				Prompt map[string]any `json:"prompt"`
			}
			_ = json.Unmarshal(body, &payload)
			captured = payload.Prompt
			_, _ = w.Write([]byte(`{"prompt_id":"p2"}`))
		case "/history/p2":
			_, _ = w.Write([]byte(`{"p2":{"status":{"status_str":"success","completed":true},"outputs":{"9":{"images":[{"filename":"o.png","type":"output"}]}}}}`))
		case "/view":
			_, _ = w.Write(minimalPNG(384, 512))
		}
	}))
	defer srv.Close()

	wf := map[string]any{
		"3":  map[string]any{"class_type": "KSampler", "inputs": map[string]any{"denoise": 0.6}},
		"6":  map[string]any{"class_type": "CLIPTextEncode", "inputs": map[string]any{"text": "默认"}},
		"7":  map[string]any{"class_type": "CLIPTextEncode", "inputs": map[string]any{"text": "负默认"}},
		"9":  map[string]any{"class_type": "SaveImage", "inputs": map[string]any{}},
		"11": map[string]any{"class_type": "LoadImage", "inputs": map[string]any{"image": "PLACEHOLDER.png"}},
	}
	cfg := testClientConfig(srv.URL, srv.URL)
	ex := NewExecutor(cfg, New(cfg), &staticWorkflow{wf: wf})

	params, _ := json.Marshal(JobParams{Denoise: 0.75})
	res, err := ex.Execute(context.Background(), JobSpec{
		JobID: 2, Kind: KindCartoonize, Input: []byte("fake-image-bytes"), InputFilename: "douwan-2.png", Params: params,
	}, nil)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if atomic.LoadInt32(&uploaded) != 1 {
		t.Errorf("上传次数 = %d，期望 1", uploaded)
	}
	got := captured["11"].(map[string]any)["inputs"].(map[string]any)["image"]
	if got != "douwan/in.png" {
		t.Errorf("LoadImage.image = %v，期望 douwan/in.png（要带 subfolder）", got)
	}
	if got := captured["3"].(map[string]any)["inputs"].(map[string]any)["denoise"]; fmt.Sprint(got) != "0.75" {
		t.Errorf("denoise = %v，期望 0.75", got)
	}
	if res.Width != 384 || res.Height != 512 {
		t.Errorf("产物尺寸解析 = %dx%d，期望 384x512", res.Width, res.Height)
	}
}

// TestExecutor_CancelStopsWaiting 取消标记要在轮询间隙被发现。
func TestExecutor_CancelStopsWaiting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/prompt":
			_, _ = w.Write([]byte(`{"prompt_id":"p3"}`))
		case "/history/p3":
			_, _ = w.Write([]byte(`{}`)) // 永远没完成
		}
	}))
	defer srv.Close()

	wf := map[string]any{"3": map[string]any{"class_type": "KSampler", "inputs": map[string]any{}}}
	cfg := testClientConfig(srv.URL, srv.URL)
	ex := NewExecutor(cfg, New(cfg), &staticWorkflow{wf: wf})

	// 第一次轮询就报告「已取消」
	_, err := ex.Execute(context.Background(), JobSpec{JobID: 9, Kind: KindText2Image}, func(uint64) bool { return true })
	if err == nil {
		t.Fatal("取消后应当返回错误（ErrCanceled）")
	}
	if !strings.Contains(err.Error(), "取消") {
		t.Errorf("错误应是「已取消」，实际：%v", err)
	}
}

// TestExecutor_MattingNeedsInput 抠图没有输入图要直接失败，不要发出空请求。
func TestExecutor_MattingNeedsInput(t *testing.T) {
	cfg := testClientConfig("http://127.0.0.1:1", "http://127.0.0.1:1")
	ex := NewExecutor(cfg, New(cfg), &staticWorkflow{wf: map[string]any{"3": map[string]any{}}})
	if _, err := ex.Execute(context.Background(), JobSpec{JobID: 1, Kind: KindMatting}, nil); err == nil {
		t.Fatal("没有输入图时应当报错")
	}
}

// TestExecutor_UnsupportedKind
func TestExecutor_UnsupportedKind(t *testing.T) {
	cfg := testClientConfig("http://127.0.0.1:1", "http://127.0.0.1:1")
	ex := NewExecutor(cfg, New(cfg), &staticWorkflow{wf: map[string]any{}})
	_, err := ex.Execute(context.Background(), JobSpec{JobID: 1, Kind: "nope"}, nil)
	if err == nil || !strings.Contains(err.Error(), "不支持") {
		t.Fatalf("未知类型应报「不支持」，实际：%v", err)
	}
}
