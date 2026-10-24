// Command seed 初始化后台运行所需的最小数据：
//
//  1. 首个管理员账号（密码来自环境变量，绝不在代码里写死默认密码）；
//  2. 占位草稿套餐（可选，名称与价格都只是占位，默认不在前台展示）；
//  3. 系统设置默认键（网站名、上传上限、卡密规则、支付状态等）；
//  4. 素材分类（空库时补默认项，避免上传素材时没有分类可选）。
//
// 全部操作都是幂等的：重复执行不会覆盖已经改过的数据，
// 因此可以安全地放进部署脚本里每次发布都跑一遍。
//
// 用法：
//
//	# 只补齐设置与草稿套餐
//	go run ./cmd/seed -config configs/config.yaml
//
//	# 建一个管理员（密码从环境变量读，避免出现在命令历史里）
//	DOUWAN_SEED_ADMIN_PASSWORD='某个足够长的密码' \
//	  go run ./cmd/seed -admin douwan -role super_admin
//
// 环境变量：
//
//	DOUWAN_SEED_ADMIN_USERNAME  管理员用户名（默认 douwan）
//	DOUWAN_SEED_ADMIN_PASSWORD  管理员密码（必填才会创建管理员）
//	DOUWAN_SEED_ADMIN_NICKNAME  管理员昵称（默认取用户名）
//	DOUWAN_SEED_ADMIN_ROLE      角色：super_admin / operator / viewer（默认 super_admin）
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"gorm.io/gorm"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/database"
	"gitee.com/maryuke/douwan-api/internal/logger"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/service"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "初始化失败:", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		configPath  = flag.String("config", "", "配置文件路径，留空则使用默认查找规则")
		adminName   = flag.String("admin", "", "要创建的管理员用户名（留空则只初始化套餐与设置）")
		role        = flag.String("role", "", "管理员角色：super_admin / operator / viewer")
		withDrafts  = flag.Bool("drafts", true, "是否创建占位草稿套餐")
		withCatalog = flag.Bool("catalog", true, "是否初始化三档正式套餐（已存在的 code 不覆盖）")
	)
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	logger.SetDefault(logger.New(cfg.Log))
	ctx := context.Background()

	db, err := database.Open(cfg.Database, cfg.App.Debug)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close(db) }()

	if err := database.AutoMigrate(db); err != nil {
		return err
	}
	slog.InfoContext(ctx, "数据库结构已就绪")

	repos := repository.New(db)
	audit := service.NewAuditLog()

	// ---------------------------------------------------------------- 系统设置
	settingsService := service.NewSettingsService(repos, audit, nil)
	created, err := settingsService.EnsureDefaults(ctx)
	if err != nil {
		return err
	}
	slog.InfoContext(ctx, "系统设置已就绪", "新建项", created)

	// ---------------------------------------------------------------- 素材分类
	catCreated, err := ensureAssetCategories(ctx, repos)
	if err != nil {
		return err
	}
	slog.InfoContext(ctx, "默认素材分类已就绪", "新建数量", catCreated)

	// ---------------------------------------------------------------- 套餐
	planService := service.NewPlanService(repos, audit)
	seedAudit := service.Audit{
		AdminName: "seed",
		AdminRole: model.AdminRoleSuper,
	}
	if *withDrafts {
		createdPlans, err := planService.SeedDrafts(ctx, seedAudit)
		if err != nil {
			return err
		}
		slog.InfoContext(ctx, "占位草稿套餐已就绪", "新建数量", createdPlans)
	}
	if *withCatalog {
		createdCatalog, err := planService.SeedCatalog(ctx, seedAudit)
		if err != nil {
			return err
		}
		slog.InfoContext(ctx, "正式套餐已就绪", "新建数量", createdCatalog)
	}

	// ---------------------------------------------------------------- 管理员
	username := strings.TrimSpace(*adminName)
	if username == "" {
		username = strings.TrimSpace(os.Getenv("DOUWAN_SEED_ADMIN_USERNAME"))
	}
	password := os.Getenv("DOUWAN_SEED_ADMIN_PASSWORD")

	if username == "" && password == "" {
		slog.InfoContext(ctx, "未指定管理员，跳过创建（用 -admin 或 DOUWAN_SEED_ADMIN_USERNAME 指定）")
		return nil
	}
	if username == "" {
		return errors.New("指定了密码但没指定用户名")
	}
	if password == "" {
		return errors.New("创建管理员必须通过 DOUWAN_SEED_ADMIN_PASSWORD 提供密码（不要写在命令行参数里，会进 shell 历史）")
	}
	if len(password) < 10 {
		return fmt.Errorf("管理员密码至少 10 位，当前长度 %d", len(password))
	}
	roleName := strings.TrimSpace(*role)
	if roleName == "" {
		roleName = strings.TrimSpace(os.Getenv("DOUWAN_SEED_ADMIN_ROLE"))
	}
	if roleName == "" {
		roleName = model.AdminRoleSuper
	}
	if !model.ValidAdminRole(roleName) {
		return fmt.Errorf("角色不合法: %s", roleName)
	}
	nickname := strings.TrimSpace(os.Getenv("DOUWAN_SEED_ADMIN_NICKNAME"))
	if nickname == "" {
		nickname = username
	}

	if err := ensureAdmin(ctx, db, repos, username, password, nickname, roleName); err != nil {
		return err
	}
	return nil
}

// ensureAssetCategories 空库时补齐默认素材分类。
//
// 后台上传素材必须选分类；分类表为空时下拉只有「请选择分类」一项，
// 管理员会在上传这一步卡住。默认项与前台素材库的合集保持一致；
// 只在分类表为空时写入，避免把管理员删掉 / 改名的分类又补回来。
func ensureAssetCategories(ctx context.Context, repos *repository.Repositories) (int, error) {
	existing, err := repos.Category.ListAll(ctx, false)
	if err != nil {
		return 0, err
	}
	if len(existing) > 0 {
		return 0, nil
	}
	defaults := []struct {
		slug string
		name string
	}{
		{"anime", "二次元"},
		{"pets", "萌宠动物"},
		{"couples", "情侣情感"},
		{"food", "美食水果"},
		{"plants", "植物花卉"},
		{"lifestyle", "生活美学"},
		{"festivals", "节日祝福"},
		{"cute", "萌趣日常"},
		{"beginner", "新手专区"},
	}
	created := 0
	for i, d := range defaults {
		c := &model.LibraryCategory{
			Slug:      d.slug,
			Name:      d.name,
			SortOrder: (len(defaults) - i) * 10,
			Status:    model.CategoryStatusEnabled,
		}
		if err := repos.Category.Create(ctx, c); err != nil {
			return created, err
		}
		created++
	}
	return created, nil
}

// ensureAdmin 幂等地创建管理员：已存在就只报告，不改密码。
//
// 刻意不提供「重置已有管理员的密码」功能：那会让这个命令变成
// 「谁拿到服务器就能改后台密码」的后门。要重置请用后台的
// 「管理者管理 → 重置密码」，或直接删掉账号重新 seed。
func ensureAdmin(ctx context.Context, db *gorm.DB, repos *repository.Repositories,
	username, password, nickname, role string) error {

	exists, err := repos.Admin.ExistsByUsername(ctx, username)
	if err != nil {
		return err
	}
	if exists {
		slog.InfoContext(ctx, "管理员已存在，跳过创建（不会修改已有密码）", "username", username)
		return nil
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	admin := &model.Admin{
		Username:     username,
		PasswordHash: hash,
		Nickname:     nickname,
		Role:         role,
		Status:       model.AdminStatusActive,
		Remark:       "由 cmd/seed 初始化",
	}
	if err := repos.Admin.Create(ctx, admin); err != nil {
		return err
	}
	slog.InfoContext(ctx, "管理员创建成功",
		"username", admin.Username, "role", model.RoleLabel(admin.Role), "id", admin.ID)

	// 记一条日志，便于事后审计「这个账号是怎么来的」
	_ = repos.Log.Create(ctx, &model.OperationLog{
		AdminID: 0, AdminName: "seed", AdminRole: role,
		Action: service.ActionAdminCreate, ActionText: service.ActionText(service.ActionAdminCreate),
		TargetType: "admin", TargetID: fmt.Sprint(admin.ID), TargetName: admin.Username,
		Result: model.LogResultSuccess, Details: "由 cmd/seed 初始化首个管理员",
	})
	return nil
}
