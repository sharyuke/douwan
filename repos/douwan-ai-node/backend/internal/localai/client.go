// Package localai 封装「本地 AI 推理节点」的 HTTP 调用。
//
// 节点形态：一台内网的 Windows 机器（RTX 2060 6GB）跑着
//
//	ComfyUI  127.0.0.1:8188   —— 文生图 / 卡通化（SD 1.5）
//	rembg    127.0.0.1:7000   —— 抠图（u2net，CPU）
//
// 后端通过 SSH 反向隧道访问它们，所以配置里的地址永远是**本机回环**。
// 推理服务端口的暴露与否由隧道保证（隧道只绑 127.0.0.1），本包不做任何监听。
//
// 设计约定：
//   - 本包只做「提交 / 轮询 / 取回」三件事，不认识数据库，也不认识业务任务表；
//   - 所有对外错误都是 error，由上层翻译成业务错误码（本包不 import response，避免反向依赖）；
//   - 每个方法都接受 ctx，超时由调用方（config.LocalAI.*Timeout）决定；
//   - 不做重试：一次推理可能几十秒，静默重试会让用户等更久且难以排查。
package localai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

// 常见的、调用方需要区分对待的错误。
var (
	// ErrUnavailable 推理服务不可达（连接被拒 / 超时 / 非预期状态码）。
	// 上层通常翻译成「本地 AI 服务暂时不可用」，属于可重试。
	ErrUnavailable = errors.New("本地 AI 服务不可用")
	// ErrRejected 推理服务明确拒绝了这次请求（参数非法、模型不存在等），
	// 属于「重试也没用」，应把原因告诉用户。
	ErrRejected = errors.New("本地 AI 服务拒绝了该请求")
	// ErrUnsupportedKind 本包不认识的任务类型，属于编程错误。
	ErrUnsupportedKind = errors.New("不支持的任务类型")
)

// 任务类型。与 model.AIJobKind* 保持一致，但本包不 import model（避免循环依赖），
// 由上层在调用处做映射，并用 ErrUnsupportedKind 兜底。
const (
	KindMatting    = "matting"
	KindCartoonize = "cartoonize"
	KindText2Image = "text2image"
)

// Config 本包需要的配置。
//
// 刻意不复用 config.LocalAI：本包不 import config，这样它可以脱离配置包单测。
// 字段名与 config.LocalAI 一一对应，由 server 装配处负责转换。
type Config struct {
	ComfyURL      string
	RembgURL      string
	HealthTimeout time.Duration
	SubmitTimeout time.Duration
	PollInterval  time.Duration
	// JobTimeout 单条任务的**总**超时（含排队 + 推理 + 取回产物）。
	// 超时后任务被标记失败并释放队列额度，避免一条卡死的任务把队列占满。
	JobTimeout   time.Duration
	Checkpoint   string
	MattingModel string
}

// Client 推理服务客户端。并发安全（内部只持有 http.Client 与不可变配置）。
type Client struct {
	cfg  Config
	http *http.Client
}

// New 构造客户端。cfg.ComfyURL / cfg.RembgURL 会在调用时再去掉尾部斜杠。
func New(cfg Config) *Client {
	return &Client{
		cfg: cfg,
		// 不用 http.DefaultClient：它的超时是 0（永不超时），
		// 一旦推理节点僵死，会把这个进程的 goroutine 永久挂住。
		http: &http.Client{
			Transport: &http.Transport{
				MaxIdleConns:        10,
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

// ---------------------------------------------------------------- 探活

// ComfyStatus 是 /system_stats 里我们关心的部分。
type ComfyStatus struct {
	Version   string `json:"comfyui_version"`
	OS        string `json:"os"`
	VRAMTotal int64  `json:"vram_total"`
	VRAMFree  int64  `json:"vram_free"`
	Device    string `json:"device"`
}

// Stats 探活 ComfyUI。用于后台「AI 节点状态」与提交前的快速失败。
func (c *Client) Stats(ctx context.Context) (*ComfyStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, c.cfg.HealthTimeout)
	defer cancel()

	body, err := c.get(ctx, c.comfyBase()+"/system_stats")
	if err != nil {
		return nil, err
	}
	var raw struct {
		System struct {
			Version string `json:"comfyui_version"`
			OS      string `json:"os"`
		} `json:"system"`
		Devices []struct {
			Name      string `json:"name"`
			VRAMTotal int64  `json:"vram_total"`
			VRAMFree  int64  `json:"vram_free"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("%w: 解析 /system_stats 失败: %v", ErrUnavailable, err)
	}
	st := &ComfyStatus{Version: raw.System.Version, OS: raw.System.OS}
	if len(raw.Devices) > 0 {
		st.Device = raw.Devices[0].Name
		st.VRAMTotal = raw.Devices[0].VRAMTotal
		st.VRAMFree = raw.Devices[0].VRAMFree
	}
	return st, nil
}

// RembgStatus 探活 rembg（读 OpenAPI 文档即可，说明服务活着且依赖链正常）。
// 返回真实路由列表，便于运维核对契约没有被升级改掉。
func (c *Client) RembgStatus(ctx context.Context) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, c.cfg.HealthTimeout)
	defer cancel()

	body, err := c.get(ctx, c.rembgBase()+"/openapi.json")
	if err != nil {
		return nil, err
	}
	var spec struct {
		Paths map[string]map[string]any `json:"paths"`
	}
	if err := json.Unmarshal(body, &spec); err != nil {
		return nil, fmt.Errorf("%w: 解析 /openapi.json 失败: %v", ErrUnavailable, err)
	}
	routes := make([]string, 0, len(spec.Paths))
	for p, methods := range spec.Paths {
		for m := range methods {
			routes = append(routes, strings.ToUpper(m)+" "+p)
		}
	}
	if len(routes) == 0 {
		return nil, fmt.Errorf("%w: rembg /openapi.json 里没有任何路由", ErrUnavailable)
	}
	return routes, nil
}

// ---------------------------------------------------------------- 提交

// SubmitComfy 提交一个 API 格式的 ComfyUI 工作流，返回 prompt_id。
//
// workflow 必须是 ComfyUI「API 格式」的图（节点 id → {class_type, inputs}），
// 不是界面导出的 UI 格式。模板放在 douwan-ai-node/workflows/local-ai/。
func (c *Client) SubmitComfy(ctx context.Context, workflow map[string]any, clientID string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, c.cfg.SubmitTimeout)
	defer cancel()

	payload, err := json.Marshal(map[string]any{"prompt": workflow, "client_id": clientID})
	if err != nil {
		return "", fmt.Errorf("序列化工作流失败: %w", err)
	}
	body, status, err := c.do(ctx, http.MethodPost, c.comfyBase()+"/prompt", "application/json", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("%w: POST /prompt 返回 %d：%s", ErrRejected, status, truncate(body, 400))
	}
	var resp struct {
		PromptID string `json:"prompt_id"`
		Error    any    `json:"error"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("%w: 解析 /prompt 响应失败: %v", ErrUnavailable, err)
	}
	if resp.PromptID == "" {
		return "", fmt.Errorf("%w: /prompt 未返回 prompt_id：%s", ErrRejected, truncate(body, 400))
	}
	return resp.PromptID, nil
}

// UploadImage 把一张图上传到 ComfyUI 的 input 目录，返回可被 LoadImage 使用的名字。
// 返回值形如 "douwan/xxx.png"（带 subfolder），**必须**这样传给 LoadImage，
// 只传文件名 ComfyUI 会找不到（实测）。
func (c *Client) UploadImage(ctx context.Context, filename string, content io.Reader, subfolder string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, c.cfg.SubmitTimeout)
	defer cancel()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("image", filename)
	if err != nil {
		return "", fmt.Errorf("构造上传表单失败: %w", err)
	}
	if _, err := io.Copy(fw, content); err != nil {
		return "", fmt.Errorf("读取上传内容失败: %w", err)
	}
	_ = mw.WriteField("type", "input")
	_ = mw.WriteField("overwrite", "true")
	if subfolder != "" {
		_ = mw.WriteField("subfolder", subfolder)
	}
	if err := mw.Close(); err != nil {
		return "", fmt.Errorf("结束上传表单失败: %w", err)
	}

	body, status, err := c.do(ctx, http.MethodPost, c.comfyBase()+"/upload/image", mw.FormDataContentType(), &buf)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("%w: POST /upload/image 返回 %d：%s", ErrRejected, status, truncate(body, 300))
	}
	var resp struct {
		Name      string `json:"name"`
		Subfolder string `json:"subfolder"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("%w: 解析 /upload/image 响应失败: %v", ErrUnavailable, err)
	}
	if resp.Name == "" {
		return "", fmt.Errorf("%w: /upload/image 未返回文件名", ErrRejected)
	}
	if resp.Subfolder != "" {
		return path.Join(resp.Subfolder, resp.Name), nil
	}
	return resp.Name, nil
}

// ComfyResult 一个 ComfyUI 任务的执行结果。
type ComfyResult struct {
	Finished bool
	Failed   bool
	Message  string
	Images   []ComfyImage
}

// ComfyImage 是 /history 里的一个产物引用。
type ComfyImage struct {
	Filename  string
	Subfolder string
	Type      string
}

// PollComfy 查询一次任务状态。finished=false 表示仍在跑。
func (c *Client) PollComfy(ctx context.Context, promptID string) (*ComfyResult, error) {
	body, err := c.get(ctx, c.comfyBase()+"/history/"+url.PathEscape(promptID))
	if err != nil {
		return nil, err
	}
	var hist map[string]struct {
		Status struct {
			StatusStr string `json:"status_str"`
			Completed bool   `json:"completed"`
			Messages  []any  `json:"messages"`
		} `json:"status"`
		Outputs map[string]struct {
			Images []struct {
				Filename  string `json:"filename"`
				Subfolder string `json:"subfolder"`
				Type      string `json:"type"`
			} `json:"images"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal(body, &hist); err != nil {
		return nil, fmt.Errorf("%w: 解析 /history 失败: %v", ErrUnavailable, err)
	}
	entry, ok := hist[promptID]
	if !ok {
		// 还没进 history，说明队列里没轮到或正在跑
		return &ComfyResult{Finished: false}, nil
	}
	res := &ComfyResult{Finished: entry.Status.Completed}
	switch entry.Status.StatusStr {
	case "success":
		res.Finished = true
	case "error":
		res.Finished = true
		res.Failed = true
		res.Message = extractExecutionError(entry.Status.Messages)
	}
	for _, out := range entry.Outputs {
		for _, img := range out.Images {
			res.Images = append(res.Images, ComfyImage{Filename: img.Filename, Subfolder: img.Subfolder, Type: img.Type})
		}
	}
	return res, nil
}

// FetchImage 取回 ComfyUI 产物（/view）。
func (c *Client) FetchImage(ctx context.Context, img ComfyImage) ([]byte, error) {
	q := url.Values{}
	q.Set("filename", img.Filename)
	q.Set("subfolder", img.Subfolder)
	typ := img.Type
	if typ == "" {
		typ = "output"
	}
	q.Set("type", typ)
	return c.get(ctx, c.comfyBase()+"/view?"+q.Encode())
}

// RemoveBackground 调用 rembg 抠图，返回 PNG（RGBA）字节。
//
// ⚠ 必须显式传 model：rembg 2.0.85 的 /api/remove **默认模型是 bria-rmbg**，
// 那是商业授权模型。本方法在 model 为空时直接报错，**绝不**让它回落到默认值。
//
// alphaMatting 为 true 时额外传 a/af/ab/ae 做边缘细化（人像/毛发效果更好，稍慢）。
func (c *Client) RemoveBackground(ctx context.Context, filename string, content io.Reader, alphaMatting bool) ([]byte, error) {
	model := strings.TrimSpace(c.cfg.MattingModel)
	if model == "" {
		return nil, fmt.Errorf("%w: 抠图模型未配置；rembg 默认模型 bria-rmbg 为商业授权，禁止使用", ErrRejected)
	}
	ctx, cancel := context.WithTimeout(ctx, c.cfg.SubmitTimeout)
	defer cancel()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	// 字段名固定 file（rembg 服务端的参数名），不是 image/upload。
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return nil, fmt.Errorf("构造抠图表单失败: %w", err)
	}
	if _, err := io.Copy(fw, content); err != nil {
		return nil, fmt.Errorf("读取待抠图内容失败: %w", err)
	}
	_ = mw.WriteField("model", model)
	if alphaMatting {
		_ = mw.WriteField("a", "true")
		_ = mw.WriteField("af", "240")
		_ = mw.WriteField("ab", "10")
		_ = mw.WriteField("ae", "10")
	}
	if err := mw.Close(); err != nil {
		return nil, fmt.Errorf("结束抠图表单失败: %w", err)
	}

	body, status, err := c.do(ctx, http.MethodPost, c.rembgBase()+"/api/remove", mw.FormDataContentType(), &buf)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%w: POST /api/remove 返回 %d：%s", ErrRejected, status, truncate(body, 300))
	}
	if !looksLikePNG(body) {
		return nil, fmt.Errorf("%w: /api/remove 返回的不是 PNG", ErrUnavailable)
	}
	return body, nil
}

// ---------------------------------------------------------------- 内部工具

func (c *Client) comfyBase() string { return strings.TrimRight(c.cfg.ComfyURL, "/") }
func (c *Client) rembgBase() string { return strings.TrimRight(c.cfg.RembgURL, "/") }

// PollInterval 返回配置的轮询间隔（调用方做 sleep 时用，带一个安全下限）。
func (c *Client) PollInterval() time.Duration {
	if c.cfg.PollInterval < 200*time.Millisecond {
		return 200 * time.Millisecond
	}
	return c.cfg.PollInterval
}

func (c *Client) get(ctx context.Context, rawURL string) ([]byte, error) {
	body, status, err := c.do(ctx, http.MethodGet, rawURL, "", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%w: GET %s 返回 %d", ErrUnavailable, rawURL, status)
	}
	return body, nil
}

// do 发一次请求。所有网络层错误统一包成 ErrUnavailable，
// 让上层只需区分「不可用」与「被拒绝」两类。
func (c *Client) do(ctx context.Context, method, rawURL, contentType string, body io.Reader) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return nil, 0, fmt.Errorf("构造请求失败: %w", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, 0, fmt.Errorf("%w: %s %s 超时或被取消: %v", ErrUnavailable, method, rawURL, ctx.Err())
		}
		return nil, 0, fmt.Errorf("%w: %s %s 连接失败: %v", ErrUnavailable, method, rawURL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	// 产物一般几百 KB，限读 32MB 防呆（推理服务被换掉时不会把内存吃光）
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("%w: 读取 %s 响应失败: %v", ErrUnavailable, rawURL, err)
	}
	return data, resp.StatusCode, nil
}

// extractExecutionError 从 ComfyUI 的 status.messages 里挖出人类可读的报错。
// messages 是 [[type, payload], ...] 的数组，只有 execution_error 里才有 exception_message。
func extractExecutionError(messages []any) string {
	for _, raw := range messages {
		pair, ok := raw.([]any)
		if !ok || len(pair) < 2 {
			continue
		}
		if kind, _ := pair[0].(string); kind != "execution_error" {
			continue
		}
		payload, ok := pair[1].(map[string]any)
		if !ok {
			continue
		}
		if msg, ok := payload["exception_message"].(string); ok && msg != "" {
			return truncate([]byte(msg), 300)
		}
	}
	return "推理节点返回了未知错误"
}

func looksLikePNG(b []byte) bool {
	return len(b) >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
}

// truncate 截断错误文本。错误信息会进日志，不应把整个响应体塞进去。
func truncate(b []byte, n int) string {
	s := strings.TrimSpace(string(b))
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// PNGSize 从 PNG 头读出宽高（我们不引入图像库，只解析固定偏移）。
// 返回 (0,0) 表示不是 PNG 或长度不足。
func PNGSize(b []byte) (int, int) {
	if !looksLikePNG(b) || len(b) < 24 {
		return 0, 0
	}
	w := int(b[16])<<24 | int(b[17])<<16 | int(b[18])<<8 | int(b[19])
	h := int(b[20])<<24 | int(b[21])<<16 | int(b[22])<<8 | int(b[23])
	if w < 0 || h < 0 {
		return 0, 0
	}
	return w, h
}

// HumanBytes 给后台展示用的可读体积。
func HumanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return strconv.FormatInt(n, 10) + " B"
	}
	div, exp := int64(unit), 0
	for x := n / unit; x >= unit; x /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}
