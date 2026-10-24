package localai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// WorkflowStore 提供工作流模板（由调用方从磁盘或嵌入资源提供）。
//
// 模板是 ComfyUI 的「API 格式」图，放在 douwan-ai-node/workflows/local-ai/。
// 本包不认识磁盘布局，只按名字取。
type WorkflowStore interface {
	// Load 返回指定工作流的深拷贝（调用方会被就地打补丁，不能返回共享对象）。
	Load(name string) (map[string]any, error)
}

// JobSpec 是执行一条任务所需的全部输入（由 service 从数据库装载）。
type JobSpec struct {
	JobID uint64
	Kind  string
	// Input 输入图字节。仅 img2img（cartoonize）与抠图需要。
	Input []byte
	// InputFilename 上传给 ComfyUI 时用的文件名（带扩展名即可，路径由节点生成）。
	InputFilename string
	// Params 任务参数（已由 service 规范化过）。
	Params json.RawMessage
}

// JobParams 是 task params 的强类型视图（与 service.aiKindParams 对应）。
type JobParams struct {
	Prompt         string  `json:"prompt"`
	NegativePrompt string  `json:"negative_prompt"`
	Steps          int     `json:"steps"`
	CFG            float64 `json:"cfg"`
	Seed           int64   `json:"seed"`
	Denoise        float64 `json:"denoise"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	AlphaMatting   bool    `json:"alpha_matting"`
}

// ExecuteResult 是一次推理的产物。
type ExecuteResult struct {
	// Image 产物图片字节（PNG）。
	Image []byte
	// ProviderJobID 推理节点侧的任务号（ComfyUI 的 prompt_id）；抠图为空。
	ProviderJobID string
	// Width / Height 从产物 PNG 头解析出的尺寸（0 表示解析失败，由调用方再解码）。
	Width  int
	Height int
}

// ErrCanceled 表示任务被用户取消（不是失败）。
var ErrCanceled = errors.New("任务已取消")

// CancelCheck 由调用方提供「这条任务是否已被请求取消」的判断。
// 队列在轮询间隙调用它，尽力而为地停止。
type CancelCheck func(jobID uint64) bool

// Executor 把 JobSpec 翻译成对推理节点的调用。
//
// 它只做「翻译 + 调用 + 取回」；产物落盘与状态落库由 service 层负责，
// 这样 Executor 可以脱离数据库单测（喂一个 httptest 服务器即可）。
type Executor struct {
	client    *Client
	workflows WorkflowStore
	cfg       Config
}

// NewExecutor 构造执行器。
func NewExecutor(cfg Config, client *Client, workflows WorkflowStore) *Executor {
	return &Executor{cfg: cfg, client: client, workflows: workflows}
}

// Execute 执行一条任务。
//
// 三种任务的分支刻意写在同一个方法里：它们的「提交 → 轮询 → 取回」骨架完全一样，
// 只有中间那一步不同，拆成三个方法会复制三遍轮询与取消逻辑。
func (e *Executor) Execute(ctx context.Context, spec JobSpec, canceled CancelCheck) (*ExecuteResult, error) {
	var params JobParams
	if len(spec.Params) > 0 {
		if err := json.Unmarshal(spec.Params, &params); err != nil {
			return nil, fmt.Errorf("解析任务参数失败: %w", err)
		}
	}

	switch spec.Kind {
	case KindMatting:
		return e.runMatting(ctx, spec, params)
	case KindCartoonize, KindText2Image:
		return e.runComfy(ctx, spec, params, canceled)
	default:
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedKind, spec.Kind)
	}
}

// runMatting 调 rembg 抠图。同步返回，不需要轮询（实测 CPU 单张 0.2~0.6s）。
func (e *Executor) runMatting(ctx context.Context, spec JobSpec, params JobParams) (*ExecuteResult, error) {
	if len(spec.Input) == 0 {
		return nil, errors.New("抠图任务缺少输入图")
	}
	// ⚠ 模型名来自配置且已在 config.Validate 里卡过白名单；
	// 这里再挡一次是因为「回落到 rembg 默认的 bria-rmbg（商业授权）」是不可接受的，
	// 客户端会在 model 为空时直接报错。
	out, err := e.client.RemoveBackground(ctx, spec.InputFilename, strings.NewReader(string(spec.Input)), params.AlphaMatting)
	if err != nil {
		return nil, err
	}
	w, h := PNGSize(out)
	return &ExecuteResult{Image: out, Width: w, Height: h}, nil
}

// runComfy 走 ComfyUI：传图 → 提交 → 轮询 → 取回。
func (e *Executor) runComfy(ctx context.Context, spec JobSpec, params JobParams, canceled CancelCheck) (*ExecuteResult, error) {
	if e.workflows == nil {
		return nil, errors.New("没有可用的工作流模板")
	}
	name := "cartoonize"
	if spec.Kind == KindText2Image {
		name = "txt2img"
	}
	workflow, err := e.workflows.Load(name)
	if err != nil {
		return nil, fmt.Errorf("加载工作流 %s 失败: %w", name, err)
	}

	// img2img 需要先把图传到节点的 input 目录，并把返回的 subfolder/name 写进 LoadImage
	if spec.Kind == KindCartoonize {
		if len(spec.Input) == 0 {
			return nil, errors.New("卡通化任务缺少输入图")
		}
		node, ok := workflow["11"].(map[string]any)
		if !ok {
			return nil, errors.New("工作流结构与预期不符：缺少 LoadImage 节点 11")
		}
		imageName, err := e.client.UploadImage(ctx, spec.InputFilename, strings.NewReader(string(spec.Input)), "douwan")
		if err != nil {
			return nil, fmt.Errorf("上传输入图失败: %w", err)
		}
		inputs, _ := node["inputs"].(map[string]any)
		if inputs == nil {
			return nil, errors.New("工作流结构与预期不符：LoadImage 节点没有 inputs")
		}
		inputs["image"] = imageName
	}

	// 把参数写进模板。提示词为空时保留模板默认值（模板里已经调好了一组）。
	applyParams(workflow, params)

	providerID, err := e.client.SubmitComfy(ctx, workflow, "douwan-api")
	if err != nil {
		return nil, err
	}

	// 轮询。每轮之间检查取消与 ctx；取回产物后立刻返回。
	ticker := time.NewTicker(e.client.PollInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return &ExecuteResult{ProviderJobID: providerID}, fmt.Errorf("%w: 等待推理结果超时", ErrUnavailable)
		case <-ticker.C:
		}
		if canceled != nil && canceled(spec.JobID) {
			// 尽力而为：已经提交给节点的任务无法撤回（ComfyUI 没有取消接口），
			// 但我们可以立刻停止等待，把状态落成 canceled，不再占用队列额度。
			return &ExecuteResult{ProviderJobID: providerID}, ErrCanceled
		}
		res, err := e.client.PollComfy(ctx, providerID)
		if err != nil {
			// 单次轮询失败不致命（节点可能正在忙），继续等下一轮；
			// 真正的超时由外层 ctx 控制。
			slog.DebugContext(ctx, "本地 AI：轮询失败，稍后重试", "prompt_id", providerID, "err", err)
			continue
		}
		if !res.Finished {
			continue
		}
		if res.Failed {
			return &ExecuteResult{ProviderJobID: providerID}, fmt.Errorf("%w: %s", ErrRejected, res.Message)
		}
		if len(res.Images) == 0 {
			return &ExecuteResult{ProviderJobID: providerID}, fmt.Errorf("%w: 推理成功但没有产物", ErrUnavailable)
		}
		// 取第一张：模板里只有一个 SaveImage，多张的情况必然是模板被改过
		img, err := e.client.FetchImage(ctx, res.Images[0])
		if err != nil {
			return &ExecuteResult{ProviderJobID: providerID}, err
		}
		w, h := PNGSize(img)
		return &ExecuteResult{Image: img, ProviderJobID: providerID, Width: w, Height: h}, nil
	}
}

// applyParams 把规范化后的参数写进工作流模板。
//
// 节点 id 与字段名来自模板自带的 __douwan.params 段（见 douwan-ai-node/workflows/local-ai/）。
// 这里用显式判断而不是读元数据表：模板只有两个，元数据解析的复杂度不划算，
// 但字段名改动时必须同步改这里（模板文件头有说明）。
func applyParams(wf map[string]any, p JobParams) {
	setInput := func(nodeID, field string, value any) {
		node, ok := wf[nodeID].(map[string]any)
		if !ok {
			return
		}
		inputs, ok := node["inputs"].(map[string]any)
		if !ok {
			return
		}
		inputs[field] = value
	}

	if p.Prompt != "" {
		setInput("6", "text", p.Prompt)
	}
	if p.NegativePrompt != "" {
		setInput("7", "text", p.NegativePrompt)
	}
	if p.Steps > 0 {
		setInput("3", "steps", p.Steps)
	}
	if p.CFG > 0 {
		setInput("3", "cfg", p.CFG)
	}
	if p.Seed > 0 {
		setInput("3", "seed", p.Seed)
	}
	if p.Denoise > 0 {
		setInput("3", "denoise", p.Denoise)
	}
	// 只有文生图需要改尺寸（img2img 的尺寸由输入图决定）
	if p.Width > 0 {
		setInput("5", "width", p.Width)
	}
	if p.Height > 0 {
		setInput("5", "height", p.Height)
	}
}
