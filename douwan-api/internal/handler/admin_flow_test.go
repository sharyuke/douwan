package handler_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"gitee.com/maryuke/douwan-api/internal/auth"
	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/model"
	"gitee.com/maryuke/douwan-api/internal/repository"
	"gitee.com/maryuke/douwan-api/internal/response"
	"gitee.com/maryuke/douwan-api/internal/router"
	"gitee.com/maryuke/douwan-api/internal/testsupport"
)

// TestStorageNotConfigured 覆盖「存储没配好」时的行为。
//
// 这条用例来自一次真实的线上事故：server.New 组装路由时忘了传 Storage，
// 结果素材相关的接口**根本没注册**，后台点上传得到的是 404「接口不存在」。
// 所以这里把两种情况都钉住：
//  1. Storage 正常 → 素材接口必须可用（不是 404）；
//  2. Storage 初始化失败 → 素材接口返回 500 且说明原因（也不是 404）。
func TestStorageNotConfigured(t *testing.T) {
	t.Run("存储正常时素材接口必须注册", func(t *testing.T) {
		e := newAdminEnv(t)
		for _, path := range []string{
			"/api/v1/admin/assets",
			"/api/v1/admin/asset-categories",
			"/api/v1/admin/assets/tags",
		} {
			rec := e.do(t, http.MethodGet, path, nil, e.adminToken)
			if rec.Code == http.StatusNotFound {
				t.Fatalf("%s 返回 404：素材路由没有注册（检查 router.Deps 是否传了 Storage）", path)
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("%s 应返回 200，实际 %d：%s", path, rec.Code, rec.Body.String())
			}
		}
	})

	t.Run("存储初始化失败时返回明确原因而不是 404", func(t *testing.T) {
		db := testsupport.NewDB(t)
		repos := repository.New(db)
		hash, err := auth.HashPassword(testAdminPassword)
		if err != nil {
			t.Fatalf("生成密码哈希: %v", err)
		}
		adminRow := &model.Admin{
			Username: testAdminUser, PasswordHash: hash,
			Role: model.AdminRoleSuper, Status: model.AdminStatusActive,
		}
		if err := repos.Admin.Create(t.Context(), adminRow); err != nil {
			t.Fatalf("创建管理员: %v", err)
		}

		engine := router.New(router.Deps{
			Config: &config.Config{
				App:    config.App{Name: "douwan-api", Env: "test"},
				Server: config.Server{Port: 8080},
				Admin:  config.Admin{CardCipherKey: testCardSecret, CardCodeLength: 16, MaxGeneratePerRequest: 100},
			},
			DB:         db,
			Tokens:     testsupport.NewTokens(),
			TokenStore: testsupport.NewTokenStore(t),
			Storage:    nil,
			StorageErr: errors.New("创建上传目录 /nope: permission denied"),
		})
		env := &adminEnv{engine: engine, db: db, repos: repos, adminID: adminRow.ID}
		env.adminToken = env.login(t, testAdminUser, testAdminPassword)

		rec := env.do(t, http.MethodGet, "/api/v1/admin/assets", nil, env.adminToken)
		if rec.Code == http.StatusNotFound {
			t.Fatal("存储初始化失败时素材接口不应返回 404（会让人误以为功能没做）")
		}
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("应返回 500，实际 %d：%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(decode(t, rec).Message, "文件存储未就绪") {
			t.Fatalf("错误提示应说明存储未就绪，实际 %q", decode(t, rec).Message)
		}
	})
}

// TestAssetUploadAndPublish 覆盖「上传素材 → 草稿不公开 → 发布后公开」这条闭环。
func TestAssetUploadAndPublish(t *testing.T) {
	e := newAdminEnv(t)

	// 先建一个分类
	rec := e.do(t, http.MethodPost, "/api/v1/admin/asset-categories", map[string]any{
		"name": "动物", "slug": "animal", "sort_order": 10,
	}, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("新建分类失败: %d %s", rec.Code, rec.Body.String())
	}
	categoryID := uint64(jsonMap(t, rec)["id"].(float64))

	// 上传一张 PNG，先存草稿
	rec = e.upload(t, "/api/v1/admin/assets/upload", map[string]string{
		"title":       "橘猫头像",
		"category_id": fmt.Sprint(categoryID),
		"tags":        `["cat","avatar"]`,
		"description": "测试素材",
		"status":      "draft",
		"sort_order":  "50",
	}, map[string][]byte{"cat.png": makePNG(t)}, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("上传素材失败: %d %s", rec.Code, rec.Body.String())
	}
	result := jsonMap(t, rec)
	if result["success"].(float64) != 1 {
		t.Fatalf("应成功 1 张，实际 %v（errors=%v）", result["success"], result["errors"])
	}
	items := result["items"].([]any)
	asset := items[0].(map[string]any)
	if asset["image_url"] == "" || asset["thumbnail_url"] == "" {
		t.Fatalf("上传后应返回原图与缩略图地址: %+v", asset)
	}
	if asset["status"] != "draft" {
		t.Fatalf("上传时应能指定草稿状态，实际 %v", asset["status"])
	}
	assetID := uint64(asset["id"].(float64))

	// 草稿不出现在前台素材库
	rec = e.do(t, http.MethodGet, "/api/v1/assets", nil, "")
	if got := int(jsonMap(t, rec)["total"].(float64)); got != 0 {
		t.Fatalf("草稿素材不应出现在前台，实际 %d 条", got)
	}

	// 发布
	rec = e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/assets/%d/status", assetID),
		map[string]any{"status": "published"}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("发布素材失败: %d %s", rec.Code, rec.Body.String())
	}

	rec = e.do(t, http.MethodGet, "/api/v1/assets", nil, "")
	if got := int(jsonMap(t, rec)["total"].(float64)); got != 1 {
		t.Fatalf("发布后前台应有 1 条素材，实际 %d 条", got)
	}

	// 前台详情按 slug 能取到
	slug := asset["slug"].(string)
	rec = e.do(t, http.MethodGet, "/api/v1/assets/"+slug, nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("素材详情应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 已发布的素材不能直接删除
	rec = e.do(t, http.MethodDelete, fmt.Sprintf("/api/v1/admin/assets/%d?reason=测试", assetID), nil, e.adminToken)
	if rec.Code != http.StatusConflict {
		t.Fatalf("已发布素材删除应返回 409，实际 %d：%s", rec.Code, rec.Body.String())
	}
	assertCode(t, rec, response.CodeAssetInUse)

	// 下架后可以删除，且文件保留（历史作品不受影响）
	rec = e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/assets/%d/status", assetID),
		map[string]any{"status": "archived"}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("下架失败: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.do(t, http.MethodDelete, fmt.Sprintf("/api/v1/admin/assets/%d?reason=不再维护", assetID), nil, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("下架后删除应成功，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 删除后前台就查不到了
	rec = e.do(t, http.MethodGet, "/api/v1/assets/"+slug, nil, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("已删除素材的详情应 404，实际 %d", rec.Code)
	}
}

// TestAssetUploadRejects 覆盖文件类型与大小的服务端校验（需求 §8.4）。
func TestAssetUploadRejects(t *testing.T) {
	e := newAdminEnv(t)
	rec := e.do(t, http.MethodPost, "/api/v1/admin/asset-categories", map[string]any{"name": "测试分类"}, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("新建分类失败: %d %s", rec.Code, rec.Body.String())
	}
	categoryID := jsonMap(t, rec)["id"].(float64)

	// 伪装成 png 的文本文件：必须按内容嗅探拦下来，而不是信扩展名
	rec = e.upload(t, "/api/v1/admin/assets/upload", map[string]string{
		"title": "假图片", "category_id": fmt.Sprint(int(categoryID)),
	}, map[string][]byte{"fake.png": []byte("this is definitely not a png")}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("非图片文件应被拒绝，实际 %d：%s", rec.Code, rec.Body.String())
	}
	assertCode(t, rec, response.CodeUploadRejected)
	if !strings.Contains(decode(t, rec).Message, "JPG") {
		t.Fatalf("拒绝提示应说明支持的格式，实际 %q", decode(t, rec).Message)
	}

	// SVG 要单独挡掉（可以内嵌脚本）
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`)
	rec = e.upload(t, "/api/v1/admin/assets/upload", map[string]string{
		"title": "svg", "category_id": fmt.Sprint(int(categoryID)),
	}, map[string][]byte{"x.svg": svg}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("SVG 应被拒绝，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 超过大小上限：构造一个 11MB 的假 PNG 头
	big := make([]byte, 11<<20)
	copy(big, makePNG(t))
	rec = e.upload(t, "/api/v1/admin/assets/upload", map[string]string{
		"title": "超大图", "category_id": fmt.Sprint(int(categoryID)),
	}, map[string][]byte{"big.png": big}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("超过大小上限应被拒绝，实际 %d：%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(decode(t, rec).Message, "上限") {
		t.Fatalf("拒绝提示应说明大小上限，实际 %q", decode(t, rec).Message)
	}

	// 没有选分类
	rec = e.upload(t, "/api/v1/admin/assets/upload", map[string]string{"title": "没分类"},
		map[string][]byte{"a.png": makePNG(t)}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("未选分类应被拒绝，实际 %d：%s", rec.Code, rec.Body.String())
	}
}

// TestCategoryInUseCannotDelete 覆盖「有素材引用的分类不允许删除」（需求 §8.5）。
func TestCategoryInUseCannotDelete(t *testing.T) {
	e := newAdminEnv(t)
	rec := e.do(t, http.MethodPost, "/api/v1/admin/asset-categories", map[string]any{"name": "甜品"}, e.adminToken)
	categoryID := uint64(jsonMap(t, rec)["id"].(float64))

	rec = e.upload(t, "/api/v1/admin/assets/upload", map[string]string{
		"title": "蛋糕", "category_id": fmt.Sprint(categoryID), "status": "published",
	}, map[string][]byte{"cake.png": makePNG(t)}, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("上传失败: %d %s", rec.Code, rec.Body.String())
	}

	rec = e.do(t, http.MethodDelete, fmt.Sprintf("/api/v1/admin/asset-categories/%d", categoryID), nil, e.adminToken)
	if rec.Code != http.StatusConflict {
		t.Fatalf("分类有素材时应拒绝删除，实际 %d：%s", rec.Code, rec.Body.String())
	}
	assertCode(t, rec, response.CodeCategoryInUse)
}

// TestOperatorPermissions 覆盖角色权限：运营管理员不能看卡密明文、不能看导出、不能管管理员。
func TestOperatorPermissions(t *testing.T) {
	e := newAdminEnv(t)

	hash, err := auth.HashPassword("operator-pass-1234")
	if err != nil {
		t.Fatalf("生成密码哈希: %v", err)
	}
	operator := &model.Admin{
		Username: "opuser", PasswordHash: hash, Nickname: "运营",
		Role: model.AdminRoleSupport, Status: model.AdminStatusActive,
	}
	if err := e.repos.Admin.Create(t.Context(), operator); err != nil {
		t.Fatalf("创建运营管理员: %v", err)
	}
	opToken := e.login(t, "opuser", "operator-pass-1234")

	// 可以看卡密列表（脱敏）
	rec := e.do(t, http.MethodGet, "/api/v1/admin/card-keys", nil, opToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("运营应能查看卡密列表，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 不能查看明文
	rec = e.do(t, http.MethodPost, "/api/v1/admin/card-keys/reveal", map[string]any{"ids": []uint64{1}}, opToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("运营查看明文应返回 403，实际 %d：%s", rec.Code, rec.Body.String())
	}
	assertCode(t, rec, response.CodeForbidden)

	// 不能导出卡密
	rec = e.do(t, http.MethodPost, "/api/v1/admin/card-keys/export", map[string]any{"reveal": false}, opToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("运营导出卡密应返回 403，实际 %d", rec.Code)
	}

	// 不能管理管理员
	rec = e.do(t, http.MethodGet, "/api/v1/admin/admins", nil, opToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("运营访问管理员列表应返回 403，实际 %d", rec.Code)
	}

	// 不能改系统设置
	rec = e.do(t, http.MethodPut, "/api/v1/admin/settings", map[string]any{
		"items": []map[string]string{{"key": "site_name", "value": "豆玩"}},
	}, opToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("运营修改设置应返回 403，实际 %d", rec.Code)
	}

	// 但可以人工确认收款（这是运营的日常操作）
	planID, _ := e.createPlan(t, "运营测试套餐", nil)
	e.publishPlan(t, planID)
	token, _ := e.registerUser(t, "frank001")
	orderID := e.createOrder(t, token, planID)
	rec = e.do(t, http.MethodPost, fmt.Sprintf("/api/v1/admin/orders/%d/settle", orderID),
		map[string]any{"note": "运营确认到账"}, opToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("运营应能确认收款，实际 %d：%s", rec.Code, rec.Body.String())
	}
}

// TestSettingsUpdateAndPublic 覆盖系统设置：修改、脱敏、公开读取。
func TestSettingsUpdateAndPublic(t *testing.T) {
	e := newAdminEnv(t)

	// 默认设置项已经被 router 初始化过了
	rec := e.do(t, http.MethodGet, "/api/v1/admin/settings", nil, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("读取设置失败: %d %s", rec.Code, rec.Body.String())
	}
	var items []map[string]any
	if err := json.Unmarshal(decode(t, rec).Data, &items); err != nil {
		t.Fatalf("解析设置: %v", err)
	}
	if len(items) < 5 {
		t.Fatalf("默认设置项应有若干条，实际 %d", len(items))
	}

	// 写入支付密钥：返回的必须是脱敏值
	rec = e.do(t, http.MethodPut, "/api/v1/admin/settings", map[string]any{
		"items": []map[string]string{
			{"key": "site_name", "value": "豆玩 DOUWAN"},
			{"key": "payment_secret", "value": "super-secret-key-1234"},
		},
	}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("修改设置失败: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(decode(t, rec).Data, &items); err != nil {
		t.Fatalf("解析设置: %v", err)
	}
	var secretValue string
	for _, item := range items {
		if item["key"] == "payment_secret" {
			secretValue = item["value"].(string)
		}
	}
	if secretValue == "super-secret-key-1234" {
		t.Fatal("接口不能回传密钥明文")
	}
	if !strings.Contains(secretValue, "1234") || !strings.Contains(secretValue, "*") {
		t.Fatalf("密钥应只保留末 4 位并脱敏，实际 %q", secretValue)
	}

	// 公开设置接口不应包含任何密钥
	rec = e.do(t, http.MethodGet, "/api/v1/settings/public", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("公开设置应返回 200，实际 %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "secret") || strings.Contains(body, "1234") {
		t.Fatalf("公开设置不能泄露密钥：%s", body)
	}
	public := jsonMap(t, rec)
	if public["site_name"] != "豆玩 DOUWAN" {
		t.Fatalf("公开设置应反映修改后的站点名，实际 %v", public["site_name"])
	}
	if public["payment_ready"] != false {
		t.Fatalf("未配置支付渠道时 payment_ready 应为 false，实际 %v", public["payment_ready"])
	}

	// 上传上限必须被范围校验拦下
	rec = e.do(t, http.MethodPut, "/api/v1/admin/settings", map[string]any{
		"items": []map[string]string{{"key": "upload_max_mb", "value": "9999"}},
	}, e.adminToken)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("上传上限超出范围应返回 400，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 修改设置要留日志
	if got := e.countTable(t, &model.OperationLog{}, "action = ?", "setting.update"); got == 0 {
		t.Fatal("修改系统设置应写操作日志")
	}
}

// TestOverviewEmptyAndWithData 覆盖概览页：空数据不报错，有数据时统计正确。
func TestOverviewEmptyAndWithData(t *testing.T) {
	e := newAdminEnv(t)

	// 空数据
	rec := e.do(t, http.MethodGet, "/api/v1/admin/overview", nil, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("空数据概览应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
	}
	data := jsonMap(t, rec)
	payment := data["payment"].(map[string]any)
	if payment["channel_configured"] != false {
		t.Fatal("未接入支付时应明确标记为未配置")
	}
	if !strings.Contains(payment["notice"].(string), "支付暂未接入") {
		t.Fatalf("应明确提示支付暂未接入，实际 %q", payment["notice"])
	}
	if data["cards"].(map[string]any)["total_paid_amount"].(float64) != 0 {
		t.Fatal("没有已支付订单时金额应为 0")
	}

	// 造一笔已支付订单
	planID, _ := e.createPlan(t, "概览测试套餐", nil)
	e.publishPlan(t, planID)
	token, _ := e.registerUser(t, "grace001")
	orderID := e.createOrder(t, token, planID)
	if rec := e.markPaid(t, orderID, true, nil); rec.Code != http.StatusOK {
		t.Fatalf("确认收款失败: %d %s", rec.Code, rec.Body.String())
	}

	rec = e.do(t, http.MethodGet, "/api/v1/admin/overview", nil, e.adminToken)
	data = jsonMap(t, rec)
	cards := data["cards"].(map[string]any)
	if cards["total_paid_amount"].(float64) != 19.9 {
		t.Fatalf("累计已支付金额应为 19.9，实际 %v", cards["total_paid_amount"])
	}
	if cards["today_order_count"].(float64) != 1 {
		t.Fatalf("今日订单数应为 1，实际 %v", cards["today_order_count"])
	}
	if cards["card_unused"].(float64) != 0 {
		t.Fatalf("卡密已发出，未使用数应为 0，实际 %v", cards["card_unused"])
	}
	if cards["user_total"].(float64) != 1 {
		t.Fatalf("用户数应为 1，实际 %v", cards["user_total"])
	}
	if len(data["recent"].(map[string]any)["orders"].([]any)) != 1 {
		t.Fatalf("最近订单应有 1 条")
	}
}

// TestAdminManagementGuards 覆盖管理员管理的保护规则。
func TestAdminManagementGuards(t *testing.T) {
	e := newAdminEnv(t)

	// 不能停用自己
	rec := e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/admins/%d/status", e.adminID),
		map[string]any{"status": 0, "reason": "测试"}, e.adminToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("停用自己应返回 403，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 不能删除自己
	rec = e.do(t, http.MethodDelete, fmt.Sprintf("/api/v1/admin/admins/%d", e.adminID), nil, e.adminToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("删除自己应返回 403，实际 %d", rec.Code)
	}

	// 不能把最后一个超管降权
	rec = e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/admins/%d", e.adminID),
		map[string]any{"role": "viewer"}, e.adminToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("最后一个超管降权应返回 403，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 新建管理员 + 重置密码 + 停用
	rec = e.do(t, http.MethodPost, "/api/v1/admin/admins", map[string]any{
		"username": "secondadmin", "password": "second-pass-1234",
		"nickname": "第二个管理员", "role": "operator",
	}, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("新建管理员失败: %d %s", rec.Code, rec.Body.String())
	}
	secondID := uint64(jsonMap(t, rec)["id"].(float64))

	// 重复用户名
	rec = e.do(t, http.MethodPost, "/api/v1/admin/admins", map[string]any{
		"username": "secondadmin", "password": "second-pass-1234", "role": "operator",
	}, e.adminToken)
	if rec.Code != http.StatusConflict {
		t.Fatalf("重复用户名应返回 409，实际 %d", rec.Code)
	}

	// 停用后不能登录
	rec = e.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/admins/%d/status", secondID),
		map[string]any{"status": 0, "reason": "离职"}, e.adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("停用管理员失败: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.do(t, http.MethodPost, "/api/v1/admin/auth/login",
		map[string]any{"account": "secondadmin", "password": "second-pass-1234"}, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("已停用账号登录应返回 403，实际 %d：%s", rec.Code, rec.Body.String())
	}

	// 管理操作都要留日志
	for _, action := range []string{"admin.create", "admin.status"} {
		if got := e.countTable(t, &model.OperationLog{}, "action = ?", action); got == 0 {
			t.Fatalf("动作 %s 应写操作日志", action)
		}
	}
}

// TestPermissionsMatrix_ReflectsEntitlements 覆盖前台权限矩阵。
//
// 这条用例来自一次真实的线上问题：/permissions 一开始没挂 OptionalAuth，
// 于是**登录用户拿到的永远是免费版矩阵**，前台按钮一直不解锁。
// 这里钉住三种情况：未登录给免费版、登录给免费版、兑换后按套餐放开。
func TestPermissionsMatrix_ReflectsEntitlements(t *testing.T) {
	e := newAdminEnv(t)
	planID, _ := e.createPlan(t, "权限矩阵套餐", map[string]any{
		"benefit_config": map[string]any{
			"kind": "unlimited", "validity_type": "day", "validity_value": 7,
		},
		"feature_permissions": map[string]any{"export.pdf": true, "generate.variants": 3},
	})
	e.publishPlan(t, planID)
	e.generateCards(t, planID, 1, nil)
	token, _ := e.registerUser(t, "matrix001")

	permOf := func(token string) map[string]any {
		rec := e.do(t, http.MethodGet, "/api/v1/permissions", nil, token)
		if rec.Code != http.StatusOK {
			t.Fatalf("权限矩阵应返回 200，实际 %d：%s", rec.Code, rec.Body.String())
		}
		data := jsonMap(t, rec)
		perms, _ := data["permissions"].(map[string]any)
		if perms == nil {
			t.Fatalf("返回里没有 permissions：%v", data)
		}
		return data
	}

	// 未登录：免费版矩阵，PDF 导出不可用
	anon := permOf("")
	if anon["logged_in"] != false {
		t.Fatal("未登录时 logged_in 应为 false")
	}
	if anon["permissions"].(map[string]any)["export.pdf"] != false {
		t.Fatal("免费版不应开放 PDF 导出")
	}

	// 已登录但还没兑换：仍然是免费版，但 logged_in 必须为 true
	before := permOf(token)
	if before["logged_in"] != true {
		t.Fatal("带令牌请求时 logged_in 应为 true（/permissions 需要 OptionalAuth）")
	}
	if before["permissions"].(map[string]any)["export.pdf"] != false {
		t.Fatal("未兑换时不应开放 PDF 导出")
	}

	// 兑换后：按套餐放开
	_, codes := e.generateCards(t, planID, 1, nil)
	if rec := e.redeem(t, token, codes[0]); rec.Code != http.StatusOK {
		t.Fatalf("兑换失败：%d %s", rec.Code, rec.Body.String())
	}
	after := permOf(token)
	perms := after["permissions"].(map[string]any)
	if perms["export.pdf"] != true {
		t.Fatalf("兑换后应开放 PDF 导出，实际 %v", perms["export.pdf"])
	}
	if perms["generate.variants"] != float64(3) {
		t.Fatalf("兑换后方案数应为 3，实际 %v", perms["generate.variants"])
	}
	if items, _ := after["entitlements"].([]any); len(items) != 1 {
		t.Fatalf("应返回 1 条有效权益，实际 %d", len(items))
	}
}

// TestUploadSameTitleTwice 覆盖「同名标题连续上传」。
//
// 线上事故：中文标题 "E2E 素材" 经过只保留 ASCII 的 slug 生成后变成 "e2e"，
// 第二次同名上传就撞 slug 唯一索引报 500。运营的实际用法就是「同一批图
// 起同一个名字反复传」，所以这条必须稳。
func TestUploadSameTitleTwice(t *testing.T) {
	e := newAdminEnv(t)

	rec := e.do(t, http.MethodPost, "/api/v1/admin/asset-categories",
		map[string]any{"name": "同名上传"}, e.adminToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("新建分类失败: %d %s", rec.Code, rec.Body.String())
	}
	categoryID := uint64(jsonMap(t, rec)["id"].(float64))

	slugs := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		rec = e.upload(t, "/api/v1/admin/assets/upload", map[string]string{
			"title": "E2E 素材", "category_id": fmt.Sprint(categoryID),
		}, map[string][]byte{fmt.Sprintf("same-%d.png", i): makePNG(t)}, e.adminToken)
		if rec.Code != http.StatusCreated {
			t.Fatalf("第 %d 次同名上传应成功，实际 %d：%s", i+1, rec.Code, rec.Body.String())
		}
		slug, _ := jsonMap(t, rec)["items"].([]any)[0].(map[string]any)["slug"].(string)
		if slug == "" {
			t.Fatalf("第 %d 次上传没有返回 slug", i+1)
		}
		for _, prev := range slugs {
			if prev == slug {
				t.Fatalf("slug 重复：%s", slug)
			}
		}
		slugs = append(slugs, slug)
	}
	if got := e.countTable(t, &model.LibraryAsset{}, "1 = 1"); got != 3 {
		t.Fatalf("应有 3 个素材，实际 %d", got)
	}
}

// TestAdminLoginWritesLog 覆盖登录成功/失败都写日志（需求 §11），且不记录密码。
func TestAdminLoginWritesLog(t *testing.T) {
	e := newAdminEnv(t)

	rec := e.do(t, http.MethodPost, "/api/v1/admin/auth/login",
		map[string]any{"account": testAdminUser, "password": "definitely-wrong-1234"}, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码应 401，实际 %d", rec.Code)
	}

	if got := e.countTable(t, &model.OperationLog{}, "action = ? AND result = ?", "admin.login_fail", "fail"); got == 0 {
		t.Fatal("登录失败应写一条失败日志")
	}

	// 日志里不能出现密码
	var entries []model.OperationLog
	if err := e.db.Model(&model.OperationLog{}).Find(&entries).Error; err != nil {
		t.Fatalf("查询日志: %v", err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Details, "definitely-wrong-1234") ||
			strings.Contains(entry.Details, testAdminPassword) {
			t.Fatalf("日志不能包含明文密码：%+v", entry)
		}
	}
}
