package service_test

import (
	"context"
	"fmt"
	"testing"

	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/service"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// TestSeedCatalog_CreatesPublishedPlansAndKeepsAdminEdits 盯住需求 §3.2 / §5.4：
// 三档套餐由种子初始化，但价格、有效期与权益必须能在后台改，重跑种子不能把线上配置改回去。
func TestSeedCatalog_CreatesPublishedPlansAndKeepsAdminEdits(t *testing.T) {
	db := testsupport.NewDB(t)
	repos := repository.New(db)
	svc := service.NewPlanService(repos, service.NewAuditLog())
	ctx := context.Background()
	audit := service.Audit{AdminName: "seed", AdminRole: model.AdminRoleSuper}

	created, err := svc.SeedCatalog(ctx, audit)
	if err != nil {
		t.Fatalf("初始化正式套餐失败: %v", err)
	}
	if created != 3 {
		t.Fatalf("首次应创建 3 档套餐，实际 %d", created)
	}

	var plans []model.Plan
	if err := db.Where("status = ?", model.PlanStatusPublished).
		Order("sort_order DESC").Find(&plans).Error; err != nil {
		t.Fatalf("查询已上架套餐: %v", err)
	}
	if len(plans) != 3 {
		t.Fatalf("应有 3 个已上架套餐，实际 %d", len(plans))
	}

	want := map[string]struct {
		price    float64
		validity string
		value    int
	}{
		"day_pass":   {2.9, model.ValidityHour, 24},
		"week_pass":  {6.9, model.ValidityDay, 7},
		"month_pass": {9.9, model.ValidityMonth, 1},
	}
	for _, p := range plans {
		w, ok := want[p.Code]
		if !ok {
			t.Fatalf("出现未预期的套餐 code=%q", p.Code)
		}
		if p.Price != w.price {
			t.Fatalf("%s 价格应为 %.1f，实际 %.2f", p.Code, w.price, p.Price)
		}
		if p.ValidityType != w.validity || p.ValidityValue != w.value {
			t.Fatalf("%s 有效期应为 %s/%d，实际 %s/%d", p.Code, w.validity, w.value, p.ValidityType, p.ValidityValue)
		}
		if p.FeaturePermissions["export.pdf"] != true {
			t.Fatalf("%s 应默认包含 PDF 导出权益", p.Code)
		}
		// jsonb 读回来数字可能是 float64，用字符串比较避免类型差异造成假失败。
		if got := fmt.Sprint(p.FeaturePermissions["canvas.cells"]); got != "1000" {
			t.Fatalf("%s 的最大画布应为 1000 格，实际 %v", p.Code, p.FeaturePermissions["canvas.cells"])
		}
		if got := fmt.Sprint(p.FeaturePermissions["projects.limit"]); got != "40" {
			t.Fatalf("%s 的作品上限应为 40，实际 %v", p.Code, p.FeaturePermissions["projects.limit"])
		}
	}

	// 幂等：部署脚本每次发布都跑一遍，不能重复建套餐。
	created, err = svc.SeedCatalog(ctx, audit)
	if err != nil {
		t.Fatalf("第二次初始化失败: %v", err)
	}
	if created != 0 {
		t.Fatalf("第二次不应新建套餐，实际 %d", created)
	}

	// 后台改过的价格不能被种子覆盖。
	var day model.Plan
	if err := db.Where("code = ?", "day_pass").First(&day).Error; err != nil {
		t.Fatalf("查询 day_pass: %v", err)
	}
	day.Price = 3.9
	if err := db.Save(&day).Error; err != nil {
		t.Fatalf("修改 day_pass 价格: %v", err)
	}
	if _, err := svc.SeedCatalog(ctx, audit); err != nil {
		t.Fatalf("第三次初始化失败: %v", err)
	}
	if err := db.Where("code = ?", "day_pass").First(&day).Error; err != nil {
		t.Fatalf("重新查询 day_pass: %v", err)
	}
	if day.Price != 3.9 {
		t.Fatalf("种子不应覆盖后台价格，期望 3.9，实际 %.2f", day.Price)
	}
}
