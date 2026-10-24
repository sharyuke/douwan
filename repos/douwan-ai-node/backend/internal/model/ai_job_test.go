package model

import (
	"testing"
	"time"
)

/* =========================================================================
   AIJob 的类型与状态机

   这两组常量是「唯一清单」：后台下拉框、校验、中文标签都读它。
   测试的价值在于「加类型/状态时忘了同步标签」会立刻失败。
   ========================================================================= */

// TestAIJobKindLabelsComplete 每个类型都必须有中文名。
// 漏了的后果是后台任务列表里显示裸英文 "text2image"。
func TestAIJobKindLabelsComplete(t *testing.T) {
	for kind := range aiJobKinds {
		if !ValidAIJobKind(kind) {
			t.Errorf("类型 %s 在 aiJobKinds 里但 ValidAIJobKind 说非法", kind)
		}
		if label := AIJobKindLabel(kind); label == kind {
			t.Errorf("类型 %s 没有中文标签（会显示英文）", kind)
		}
	}
	if ValidAIJobKind("not-a-kind") {
		t.Error("未知类型不应通过校验")
	}
}

func TestAIJobStatusLabelsComplete(t *testing.T) {
	for status := range aiJobStatuses {
		if label := AIJobStatusLabel(status); label == status {
			t.Errorf("状态 %s 没有中文标签", status)
		}
	}
	if AIJobStatusLabel("weird") != "weird" {
		t.Error("未知状态应原样返回")
	}
}

// TestAIJobIsFinished 终态判定是整个取消/队列逻辑的基础：
// 判错的后果是「已结束的任务还能被取消」或「取消后队列永远等它」。
func TestAIJobIsFinished(t *testing.T) {
	cases := map[string]bool{
		AIJobStatusQueued:    false,
		AIJobStatusRunning:   false,
		AIJobStatusSucceeded: true,
		AIJobStatusFailed:    true,
		AIJobStatusCanceled:  true,
	}
	for status, want := range cases {
		job := &AIJob{Status: status}
		if got := job.IsFinished(); got != want {
			t.Errorf("状态 %s：IsFinished() = %v，期望 %v", status, got, want)
		}
	}
}

func TestAIJobDuration(t *testing.T) {
	// 未开始 → 0
	if got := (&AIJob{}).DurationMS(); got != 0 {
		t.Errorf("未开始的任务耗时应为 0，得到 %d", got)
	}
	// 已结束 → 按起止时间算
	start := time.Now().Add(-3 * time.Second)
	end := start.Add(2 * time.Second)
	job := &AIJob{StartedAt: &start, FinishedAt: &end}
	if got := job.DurationMS(); got != 2000 {
		t.Errorf("耗时应为 2000ms，得到 %d", got)
	}
	// 进行中 → 按「现在」算，应大于 0
	running := &AIJob{StartedAt: &start}
	if got := running.DurationMS(); got <= 0 {
		t.Errorf("进行中的任务耗时应大于 0，得到 %d", got)
	}
}

// TestAIJobTableNames 表名固定，避免 GORM 复数化规则变化导致改名。
func TestAIJobTableNames(t *testing.T) {
	if got := (AIJob{}).TableName(); got != "ai_jobs" {
		t.Errorf("AIJob 表名 = %q，期望 ai_jobs", got)
	}
	if got := (AIUpload{}).TableName(); got != "ai_uploads" {
		t.Errorf("AIUpload 表名 = %q，期望 ai_uploads", got)
	}
}

// TestAIUploadExpired 过期判定决定输入图还能不能被用来提交任务。
func TestAIUploadExpired(t *testing.T) {
	now := time.Now()
	if (&AIUpload{ExpiresAt: now.Add(time.Hour)}).Expired(now) {
		t.Error("还没到期却被判过期")
	}
	if !(&AIUpload{ExpiresAt: now.Add(-time.Hour)}).Expired(now) {
		t.Error("已到期却没有被判过期")
	}
	// 零值（没设过期时间）应视为永不过期，而不是「已过期」
	if (&AIUpload{}).Expired(now) {
		t.Error("未设置 ExpiresAt 时不应判为过期")
	}
}

// TestAllModelsIncludesAI 新表必须进迁移清单，否则线上起服不会建表。
func TestAllModelsIncludesAI(t *testing.T) {
	names := make(map[string]bool)
	for _, m := range AllModels() {
		switch m.(type) {
		case *AIJob:
			names["ai_jobs"] = true
		case *AIUpload:
			names["ai_uploads"] = true
		}
	}
	if !names["ai_jobs"] {
		t.Error("AIJob 不在 AllModels() 里：线上不会建 ai_jobs 表")
	}
	if !names["ai_uploads"] {
		t.Error("AIUpload 不在 AllModels() 里：线上不会建 ai_uploads 表")
	}
}

// TestLocalAIPermissionsDeclared 权限点必须同时进常量、清单与矩阵。
// 这是 activity.view 踩过的坑：只加矩阵不加清单 → 接口 200、后台页面进不去。
func TestLocalAIPermissionsDeclared(t *testing.T) {
	inOrder := make(map[string]bool)
	for _, p := range permissionOrder {
		inOrder[p] = true
	}
	for _, perm := range []string{PermLocalAIView, PermLocalAIManage} {
		if !inOrder[perm] {
			t.Errorf("权限点 %s 不在 permissionOrder 里：登录返回的 permissions 会漏掉它，后台页面进不去", perm)
		}
	}
	// 运营应该两个都有；只读只能看
	if !CanRole(AdminRoleSupport, PermLocalAIView) || !CanRole(AdminRoleSupport, PermLocalAIManage) {
		t.Error("运营管理员应同时具备 localai.view 与 localai.manage")
	}
	if !CanRole(AdminRoleViewer, PermLocalAIView) {
		t.Error("只读账号应能查看本地 AI 状态")
	}
	if CanRole(AdminRoleViewer, PermLocalAIManage) {
		t.Error("只读账号不应能操作本地 AI")
	}
}
