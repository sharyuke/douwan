package localai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// FileWorkflowStore 从磁盘读工作流模板。
//
// 模板放在 douwan-ai-node/workflows/local-ai/ 下（与推理节点共用同一份），
// 格式是 ComfyUI 的「API 格式」图，外加一段 __douwan 元数据（参数表 + 许可信息）。
//
// 为什么每次 Load 都重新读盘：
//   - 模板很小（几 KB），一次推理要几十秒，这点 IO 可以忽略；
//   - 运维可以直接改模板并生效，不需要重启服务（调参时非常有用）；
//   - 避免「服务启动时的模板」和「磁盘上的模板」不一致带来的排查困难。
//
// 代价是每张任务多一次读盘，用 dir 缓存做了轻微优化（只在目录不存在时报错）。
type FileWorkflowStore struct {
	dir string
	mu  sync.RWMutex
	// lastErr 记最近一次读取失败，供后台状态页展示
	lastErr string
}

// NewFileWorkflowStore 构造。dir 为空时用环境变量 DOUWAN_AI_WORKFLOW_DIR，
// 再不行就相对当前工作目录找 ./workflows/local-ai（方便本地开发）。
func NewFileWorkflowStore(dir string) *FileWorkflowStore {
	if strings.TrimSpace(dir) == "" {
		dir = os.Getenv("DOUWAN_AI_WORKFLOW_DIR")
	}
	if strings.TrimSpace(dir) == "" {
		dir = filepath.Join("workflows", "local-ai")
	}
	return &FileWorkflowStore{dir: dir}
}

// Dir 返回模板目录（后台状态页展示用，便于运维核对加载的是哪一份）。
func (s *FileWorkflowStore) Dir() string { return s.dir }

// LastError 最近一次加载失败的原因（空表示正常）。
func (s *FileWorkflowStore) LastError() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastErr
}

// Load 读取并解析一个模板，返回**深拷贝**。
//
// 必须深拷贝：调用方会就地往 inputs 里写参数，返回共享对象会导致
// 「上一个任务的提示词泄漏到下一个任务」（这类 bug 极难排查）。
// 这里走「序列化再反序列化」实现深拷贝 —— 模板只有几 KB，够快且绝不会漏字段。
func (s *FileWorkflowStore) Load(name string) (map[string]any, error) {
	if !validWorkflowName(name) {
		return nil, fmt.Errorf("非法的模板名: %q", name)
	}
	path := filepath.Join(s.dir, name+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		s.setErr(fmt.Sprintf("读取模板 %s 失败: %v", path, err))
		return nil, fmt.Errorf("读取工作流模板 %s: %w", path, err)
	}
	var wf map[string]any
	if err := json.Unmarshal(raw, &wf); err != nil {
		s.setErr(fmt.Sprintf("解析模板 %s 失败: %v", path, err))
		return nil, fmt.Errorf("解析工作流模板 %s: %w", path, err)
	}
	// 元数据段不参与提交：ComfyUI 会把未知键当成节点而报错
	delete(wf, "__douwan")
	if len(wf) == 0 {
		return nil, fmt.Errorf("工作流模板 %s 里没有任何节点", path)
	}

	// 深拷贝（见方法注释）
	blob, err := json.Marshal(wf)
	if err != nil {
		return nil, fmt.Errorf("拷贝工作流失败: %w", err)
	}
	var copyWF map[string]any
	if err := json.Unmarshal(blob, &copyWF); err != nil {
		return nil, fmt.Errorf("拷贝工作流失败: %w", err)
	}
	s.setErr("")
	return copyWF, nil
}

// Meta 读模板里的 __douwan 元数据段（后台展示「用的是哪个底模、许可是什么」）。
func (s *FileWorkflowStore) Meta(name string) (map[string]any, error) {
	if !validWorkflowName(name) {
		return nil, fmt.Errorf("非法的模板名: %q", name)
	}
	path := filepath.Join(s.dir, name+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取工作流模板 %s: %w", path, err)
	}
	var wf map[string]any
	if err := json.Unmarshal(raw, &wf); err != nil {
		return nil, fmt.Errorf("解析工作流模板 %s: %w", path, err)
	}
	meta, _ := wf["__douwan"].(map[string]any)
	if meta == nil {
		return map[string]any{}, nil
	}
	return meta, nil
}

func (s *FileWorkflowStore) setErr(msg string) {
	s.mu.Lock()
	s.lastErr = msg
	s.mu.Unlock()
}

// validWorkflowName 只允许模板名本身，挡住路径穿越：
// 模板名来自常量（cartoonize / txt2img），但开源后再被人从配置里传进来就危险了。
func validWorkflowName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}
