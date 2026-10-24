package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/dto"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/service"
	"gitee.com/maryuke/douwan-api/internal/storage"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

/* =========================================================================
   AIService 的准入与幂等

   这些断言对应「用户能直接看到的行为」：
     · 功能没开 → 40028（不是 404，也不是 500）
     · 排队满了 → 40029 且文案说明还差多少
     · 同一个幂等键重复提交 → 只产生一条任务
     · 别人的任务 id → 404（不泄露存在性）
   ========================================================================= */

func testLocalAIConfig() config.LocalAI {
	return config.LocalAI{
		Enabled:           true,
		ComfyURL:          "http://127.0.0.1:8188",
		RembgURL:          "http://127.0.0.1:7000",
		HealthTimeout:     5 * time.Second,
		SubmitTimeout:     30 * time.Second,
		JobTimeout:        10 * time.Minute,
		PollInterval:      time.Second,
		QueueSize:         3,
		MaxRunning:        1,
		MaxRunningPerUser: 1,
		MaxQueuedPerUser:  2,
		MaxUploadMB:       10,
		MaxPixels:         4194304,
		Checkpoint:        "v1-5-pruned-emaonly.ckpt",
		MattingModel:      "u2net",
	}
}

// newAIService 建一个「只落库、不入队」的服务：enqueue 为 nil，
// 任务会停在 queued，方便断言状态而不需要真的跑推理。
func newAIService(t *testing.T, cfg config.LocalAI) (*service.AIService, *repository.Repositories) {
	t.Helper()
	db := testsupport.NewDB(t)
	repos := repository.New(db)
	store, err := storage.New(config.Storage{
		Driver:      "local",
		UploadDir:   t.TempDir(),
		MaxUploadMB: 10,
		AllowedTypes: []string{
			"image/jpeg", "image/png", "image/webp", "image/gif",
		},
	})
	if err != nil {
		t.Fatalf("构造存储: %v", err)
	}
	svc := service.NewAIService(cfg, repos, store, nil, nil, nil)
	return svc, repos
}

// TestAIService_DisabledReturns40028 关掉开关时的行为必须是「可读的未开启」。
func TestAIService_DisabledReturns40028(t *testing.T) {
	cfg := testLocalAIConfig()
	cfg.Enabled = false
	svc, _ := newAIService(t, cfg)

	if svc.Enabled() {
		t.Fatal("Enabled() 应为 false")
	}
	_, err := svc.Submit(context.Background(), 1, dto.AISubmitRequest{
		Kind:  model.AIJobKindText2Image,
		Prompt: "一只熊猫",
	})
	assertBizCode(t, err, response.CodeAINotEnabled)

	// 查状态同样应被挡住（不只是提交）
	_, err = svc.Get(context.Background(), 1, 1)
	assertBizCode(t, err, response.CodeAINotEnabled)
}

// TestAIService_Text2ImageNeedsPrompt 文生图没有提示词必须拒绝，而不是生成一张随机图。
func TestAIService_Text2ImageNeedsPrompt(t *testing.T) {
	svc, _ := newAIService(t, testLocalAIConfig())
	_, err := svc.Submit(context.Background(), 1, dto.AISubmitRequest{
		Kind:   model.AIJobKindText2Image,
		Prompt: "   ", // 只有空白
	})
	assertBizCode(t, err, response.CodeInvalidParam)
}

// TestAIService_Img2ImgNeedsInput 卡通化/抠图缺输入图必须拒绝。
func TestAIService_Img2ImgNeedsInput(t *testing.T) {
	svc, _ := newAIService(t, testLocalAIConfig())
	for _, kind := range []string{model.AIJobKindMatting, model.AIJobKindCartoonize} {
		_, err := svc.Submit(context.Background(), 1, dto.AISubmitRequest{Kind: kind})
		assertBizCode(t, err, response.CodeInvalidParam)
	}
}

// TestAIService_QueueAdmission 单用户排队上限生效，且文案里带数字。
func TestAIService_QueueAdmission(t *testing.T) {
	cfg := testLocalAIConfig()
	cfg.MaxQueuedPerUser = 2
	svc, _ := newAIService(t, cfg)
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		if _, err := svc.Submit(ctx, 7, dto.AISubmitRequest{
			Kind:   model.AIJobKindText2Image,
			Prompt: "一只熊猫",
		}); err != nil {
			t.Fatalf("第 %d 次提交不该失败: %v", i+1, err)
		}
	}
	// 第 3 条应被拒
	_, err := svc.Submit(ctx, 7, dto.AISubmitRequest{
		Kind:   model.AIJobKindText2Image,
		Prompt: "一只熊猫",
	})
	assertBizCode(t, err, response.CodeAIQueueFull)
	if err != nil && !strings.Contains(err.Error(), "2") {
		t.Errorf("排队已满的文案里应说明上限数字，实际：%s", err.Error())
	}

	// 换个用户不受影响（上限是按用户的）
	if _, err := svc.Submit(ctx, 8, dto.AISubmitRequest{
		Kind:   model.AIJobKindText2Image,
		Prompt: "一只熊猫",
	}); err != nil {
		t.Errorf("另一个用户不该被第一个用户的排队影响: %v", err)
	}
}

// TestAIService_Idempotency 同一用户同一幂等键只产生一条任务。
func TestAIService_Idempotency(t *testing.T) {
	svc, repos := newAIService(t, testLocalAIConfig())
	ctx := context.Background()
	req := dto.AISubmitRequest{
		Kind:           model.AIJobKindText2Image,
		Prompt:         "一只熊猫",
		IdempotencyKey: "session-abc-1",
	}

	first, err := svc.Submit(ctx, 1, req)
	if err != nil {
		t.Fatalf("首次提交: %v", err)
	}
	if first.Deduplicated {
		t.Error("首次提交不应标记为去重")
	}

	second, err := svc.Submit(ctx, 1, req)
	if err != nil {
		t.Fatalf("重复提交: %v", err)
	}
	if !second.Deduplicated {
		t.Error("重复提交应标记 Deduplicated=true")
	}
	if first.Job.ID != second.Job.ID {
		t.Errorf("幂等键相同却建了两条任务：%d vs %d", first.Job.ID, second.Job.ID)
	}

	// 库里应该只有一条
	_, total, err := repos.AIJob.ListByUser(ctx, 1, dto.AIJobListQuery{})
	if err != nil {
		t.Fatalf("列任务: %v", err)
	}
	if total != 1 {
		t.Errorf("库里应有 1 条任务，实际 %d 条", total)
	}
}

// TestAIService_GetIsScopedToUser 换个 job id 不能看到别人的任务。
func TestAIService_GetIsScopedToUser(t *testing.T) {
	svc, _ := newAIService(t, testLocalAIConfig())
	ctx := context.Background()

	created, err := svc.Submit(ctx, 1, dto.AISubmitRequest{
		Kind:   model.AIJobKindText2Image,
		Prompt: "一只熊猫",
	})
	if err != nil {
		t.Fatalf("提交: %v", err)
	}

	// 本人可以查
	if _, err := svc.Get(ctx, 1, created.Job.ID); err != nil {
		t.Errorf("本人应该能查到自己的任务: %v", err)
	}
	// 别人查不到，而且错误码是「不存在」（不泄露存在性）
	_, err = svc.Get(ctx, 2, created.Job.ID)
	assertBizCode(t, err, response.CodeNotFound)
}

// TestAIService_CancelQueued 排队中的任务可以直接取消。
func TestAIService_CancelQueued(t *testing.T) {
	svc, _ := newAIService(t, testLocalAIConfig())
	ctx := context.Background()

	created, err := svc.Submit(ctx, 1, dto.AISubmitRequest{
		Kind:   model.AIJobKindText2Image,
		Prompt: "一只熊猫",
	})
	if err != nil {
		t.Fatalf("提交: %v", err)
	}
	got, err := svc.Cancel(ctx, 1, created.Job.ID)
	if err != nil {
		t.Fatalf("取消: %v", err)
	}
	if got.Status != model.AIJobStatusCanceled {
		t.Errorf("排队中的任务取消后状态应为 canceled，实际 %s", got.Status)
	}
	// 再取消一次应报「已结束」
	_, err = svc.Cancel(ctx, 1, created.Job.ID)
	assertBizCode(t, err, response.CodeAIJobNotCancelable)
}

// TestAIService_NodeStatusWorksWhenDisabled 后台状态页在功能关闭时
// 也必须拿到结构体（Enabled=false），而不是一个错误 —— 运营据此决定要不要开开关。
func TestAIService_NodeStatusWorksWhenDisabled(t *testing.T) {
	cfg := testLocalAIConfig()
	cfg.Enabled = false
	svc, _ := newAIService(t, cfg)

	st := svc.NodeStatus(context.Background())
	if st == nil {
		t.Fatal("NodeStatus 不应返回 nil")
	}
	if st.Enabled {
		t.Error("关闭状态下 Enabled 应为 false")
	}
	if st.Message == "" {
		t.Error("关闭状态下应给出可读原因")
	}
	// 配额信息仍然要返回，便于运营看到「开起来会是什么限制」
	if st.Limits.QueueSize != cfg.QueueSize || st.Limits.MattingModel != cfg.MattingModel {
		t.Errorf("配额信息不完整: %+v", st.Limits)
	}
}

// TestAIService_ParamsNormalized 尺寸取整与默认值。
func TestAIService_ParamsNormalized(t *testing.T) {
	svc, repos := newAIService(t, testLocalAIConfig())
	ctx := context.Background()

	created, err := svc.Submit(ctx, 1, dto.AISubmitRequest{
		Kind:   model.AIJobKindText2Image,
		Prompt: "一只熊猫",
		Width:  644, // 不是 8 的倍数
		Height: 640,
	})
	if err != nil {
		t.Fatalf("提交: %v", err)
	}
	job, err := repos.AIJob.FindByID(ctx, created.Job.ID)
	if err != nil {
		t.Fatalf("读任务: %v", err)
	}
	var params map[string]any
	if err := json.Unmarshal(job.Params, &params); err != nil {
		t.Fatalf("解析参数: %v", err)
	}
	if got := params["width"]; got != float64(640) {
		t.Errorf("宽度应向下取整到 640，实际 %v", got)
	}
	if got := params["height"]; got != float64(640) {
		t.Errorf("高度应为 640，实际 %v", got)
	}
}

// TestAIService_PurgeExpiredUploads 过期的输入图登记与磁盘文件都要被清掉。
//
// 不做这件事的后果是 uploads/ai/ 一直堆积（每个用户每次 AI 调用都留一份），
// 而 24h TTL 只是写进了库、没有任何人去执行。
func TestAIService_PurgeExpiredUploads(t *testing.T) {
	cfg := testLocalAIConfig()
	svc, repos := newAIService(t, cfg)
	ctx := context.Background()

	expired := &model.AIUpload{
		UserID: 1, AssetID: 1001, RelPath: "ai/2026/01/expired.png",
		URL: "/uploads/ai/2026/01/expired.png", ExpiresAt: time.Now().Add(-time.Hour),
	}
	alive := &model.AIUpload{
		UserID: 1, AssetID: 1002, RelPath: "ai/2026/01/alive.png",
		URL: "/uploads/ai/2026/01/alive.png", ExpiresAt: time.Now().Add(time.Hour),
	}
	for _, up := range []*model.AIUpload{expired, alive} {
		if err := repos.AIUpload.Create(ctx, up); err != nil {
			t.Fatalf("造登记: %v", err)
		}
	}

	svc.PurgeForTest(ctx)

	if _, err := repos.AIUpload.FindByAsset(ctx, 1, 1001); err == nil {
		t.Error("过期的输入图登记应当已被删除")
	}
	if _, err := repos.AIUpload.FindByAsset(ctx, 1, 1002); err != nil {
		t.Errorf("未过期的输入图不该被删：%v", err)
	}
}

// TestAIService_ReapStaleJobs 卡在 running 超时的任务要被判失败，
// 否则它会一直占着该用户的并发额度（用户看到「你已有 1 个任务正在执行」却毫无进度）。
func TestAIService_ReapStaleJobs(t *testing.T) {
	cfg := testLocalAIConfig()
	svc, repos := newAIService(t, cfg)
	ctx := context.Background()

	old := time.Now().Add(-3 * cfg.JobTimeout)
	stale := &model.AIJob{
		UserID: 1, Kind: model.AIJobKindText2Image,
		Status: model.AIJobStatusRunning, StartedAt: &old,
	}
	if _, err := repos.AIJob.Create(ctx, stale); err != nil {
		t.Fatalf("造任务: %v", err)
	}
	fresh := time.Now()
	running := &model.AIJob{
		UserID: 2, Kind: model.AIJobKindText2Image,
		Status: model.AIJobStatusRunning, StartedAt: &fresh,
	}
	if _, err := repos.AIJob.Create(ctx, running); err != nil {
		t.Fatalf("造任务: %v", err)
	}

	svc.ReapForTest(ctx)

	got, err := repos.AIJob.FindByID(ctx, stale.ID)
	if err != nil {
		t.Fatalf("读任务: %v", err)
	}
	if got.Status != model.AIJobStatusFailed {
		t.Errorf("卡死的任务状态 = %s，期望 failed", got.Status)
	}
	if got.ErrorMessage == "" {
		t.Error("被判失败的任务应当带上可读原因")
	}

	still, err := repos.AIJob.FindByID(ctx, running.ID)
	if err != nil {
		t.Fatalf("读任务: %v", err)
	}
	if still.Status != model.AIJobStatusRunning {
		t.Errorf("刚开跑的任务不该被回收，状态 = %s", still.Status)
	}
}

// assertCode 断言错误是预期的业务码。
func assertBizCode(t *testing.T, err error, want response.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("期望错误码 %d，但没有报错", want)
	}
	e := response.From(err)
	if e.Code != want {
		t.Fatalf("错误码 = %d（%s），期望 %d", e.Code, e.Message, want)
	}
}
