package model

import "testing"

/* =========================================================================
   权限清单的一致性测试

   背景（真踩过的坑）：接口按角色 `Can()` 判权限是对的，但登录返回给前端的
   `permissions` 来自 service.PermissionList 里那份手写清单。activity.view 当初
   只加进了权限矩阵、没加进清单，于是「接口 200、页面跳 /admin/forbidden」。
   这几条测试就是为了让下一次加权限点时不会重演。
   ========================================================================= */

// 清单必须是各角色权限矩阵的并集，且不能有重复项。
func TestPermissionOrderMatchesRoleMatrix(t *testing.T) {
	inOrder := make(map[string]bool, len(permissionOrder))
	for _, p := range permissionOrder {
		if inOrder[p] {
			t.Fatalf("权限清单里有重复项：%s", p)
		}
		inOrder[p] = true
	}

	for role, perms := range rolePermissions {
		if perms == nil {
			continue // 超级管理员是 nil = 全部权限，不参与并集
		}
		for p := range perms {
			if !inOrder[p] {
				t.Errorf("角色 %s 拥有权限 %s，但它不在 permissionOrder 里：登录返回的 permissions 会漏掉它", role, p)
			}
		}
	}
}

// 超级管理员必须拥有清单里的每一个权限点。
func TestSuperAdminHasEveryPermission(t *testing.T) {
	super := &Admin{Role: AdminRoleSuper, Status: AdminStatusActive}
	for _, p := range permissionOrder {
		if !super.Can(p) {
			t.Errorf("超级管理员缺少权限 %s", p)
		}
	}
}

// 活跃监控权限点对三个角色都应可用（需求：运营与只读都要能看）。
func TestActivityViewGrantedToAllRoles(t *testing.T) {
	for _, role := range []string{AdminRoleSuper, AdminRoleSupport, AdminRoleViewer} {
		if !CanRole(role, PermActivityView) {
			t.Errorf("角色 %s 应该拥有 %s", role, PermActivityView)
		}
	}
}

// 只读账号不能有写权限；停用账号一个权限都不能有。
func TestViewerReadOnlyAndDisabledHasNothing(t *testing.T) {
	viewer := &Admin{Role: AdminRoleViewer, Status: AdminStatusActive}
	for _, p := range []string{PermPlanManage, PermSettingManage, PermAdminManage, PermCardReveal, PermEntitlementGive} {
		if viewer.Can(p) {
			t.Errorf("只读账号不应拥有 %s", p)
		}
	}
	if !viewer.Can(PermOverviewView) || !viewer.Can(PermActivityView) {
		t.Error("只读账号应该能看数据概览与活跃监控")
	}

	disabled := &Admin{Role: AdminRoleSuper, Status: AdminStatusDisabled}
	if disabled.Can(PermActivityView) {
		t.Error("停用账号不应拥有任何权限")
	}
}

// PermissionOrder 返回的是拷贝，外部改不动内部清单。
func TestPermissionOrderReturnsCopy(t *testing.T) {
	got := PermissionOrder()
	if len(got) != len(permissionOrder) {
		t.Fatalf("长度不一致：%d vs %d", len(got), len(permissionOrder))
	}
	got[0] = "tampered"
	if permissionOrder[0] == "tampered" {
		t.Error("PermissionOrder 返回的切片被外部修改后影响到了内部清单")
	}
}
