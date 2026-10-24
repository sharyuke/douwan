#!/usr/bin/env python3
"""把后台前端的改动精确地重新应用到「较新的 master 版本」之上。

背景：后台前端最初是在一个较旧的检出版本上开发的，而远程 master 之后又合并了
一批前台改动（百万格画布、卡通化、材料单价…）。直接覆盖会把这些新功能删掉，
所以这里只做**外科式**的增量修改：保留 master 的现有内容，只插入后台需要的那几处。

脚本是幂等的：重复执行不会重复插入（会先检测标记）。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path.home() / 'Documents/work/dw/pindoudou'


def patch(path: str, edits: list[tuple[str, str]], required: bool = True) -> None:
    p = ROOT / path
    src = p.read_text(encoding='utf-8')
    for old, new in edits:
        if new in src and old not in src:
            continue  # 已经打过了
        if old not in src:
            if required:
                print(f'!! {path}: 找不到锚点，跳过: {old[:60]!r}')
            continue
        src = src.replace(old, new, 1)
    p.write_text(src, encoding='utf-8')
    print(f'✓ {path}')


# ---------------------------------------------------------------- main.js
patch('src/main.js', [(
    "import './styles/global.css'",
    "import './styles/global.css'\nimport './styles/admin.css'"
)])

# ---------------------------------------------------------------- App.vue
patch('src/App.vue', [(
    'const showFooter = computed(() => !route.meta.studio)',
    '''const showFooter = computed(() => !route.meta.studio && !route.meta.admin)

/* 后台有独立的顶栏、侧边导航与移动端抽屉，前台这些都不该出现 */
const showSiteChrome = computed(() => !route.meta.admin)'''
), (
    '    <AppHeader />',
    '    <AppHeader v-if="showSiteChrome" />'
), (
    '    <MobileTabbar />',
    '    <MobileTabbar v-if="showSiteChrome" />'
)])

# ---------------------------------------------------------------- vite.config.js
patch('vite.config.js', [(
    """  plugins: [vue()],
  base: './',""",
    """  plugins: [vue()],
  base: './',
  server: {
    // 本地开发时把接口与上传文件代理到后端，线上由 nginx 承担同样的角色
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8080', changeOrigin: true }
    }
  },"""
)])

# ---------------------------------------------------------------- router/index.js
ADMIN_IMPORTS = """
/* 后台：布局与登录页同步加载（都很小），各功能页按需加载 */
const AdminLayout = () => import('../components/admin/AdminLayout.vue')
const AdminLogin = () => import('../views/admin/AdminLoginView.vue')
const AdminOverview = () => import('../views/admin/AdminOverviewView.vue')
const AdminPlans = () => import('../views/admin/AdminPlansView.vue')
const AdminCards = () => import('../views/admin/AdminCardsView.vue')
const AdminOrders = () => import('../views/admin/AdminOrdersView.vue')
const AdminAssets = () => import('../views/admin/AdminAssetsView.vue')
const AdminUsers = () => import('../views/admin/AdminUsersView.vue')
const AdminSettings = () => import('../views/admin/AdminSettingsView.vue')
const AdminLogs = () => import('../views/admin/AdminLogsView.vue')
const AdminAdmins = () => import('../views/admin/AdminAdminsView.vue')
const AdminForbidden = () => import('../views/admin/AdminForbiddenView.vue')
"""

ADMIN_ROUTES = """  /* ---------------------------------------------------------------- 后台 */
  /* 后台挂在同一套 SPA 上（/#/admin），但有独立布局与独立的令牌体系：
     前台是 localStorage 演示账号，后台是真的服务端账号，两者互不干扰。
     未登录访问后台会被下面的守卫送到 /#/admin/login。 */
  {
    path: '/admin/login',
    name: 'admin-login',
    component: AdminLogin,
    meta: { title: '后台登录', admin: true, adminPublic: true }
  },
  {
    path: '/admin',
    component: AdminLayout,
    meta: { admin: true },
    children: [
      { path: '', name: 'admin-overview', component: AdminOverview, meta: { title: '数据概览', perm: 'overview.view' } },
      { path: 'plans', name: 'admin-plans', component: AdminPlans, meta: { title: '套餐管理', perm: 'plan.manage' } },
      { path: 'cards', name: 'admin-cards', component: AdminCards, meta: { title: '卡密管理', perm: 'card.view' } },
      { path: 'orders', name: 'admin-orders', component: AdminOrders, meta: { title: '订单管理', perm: 'order.view' } },
      { path: 'assets', name: 'admin-assets', component: AdminAssets, meta: { title: '素材库', perm: 'asset.view' } },
      { path: 'users', name: 'admin-users', component: AdminUsers, meta: { title: '用户与兑换记录', perm: 'user.view' } },
      { path: 'settings', name: 'admin-settings', component: AdminSettings, meta: { title: '系统设置', perm: 'setting.view' } },
      { path: 'logs', name: 'admin-logs', component: AdminLogs, meta: { title: '操作日志', perm: 'log.view' } },
      { path: 'admins', name: 'admin-admins', component: AdminAdmins, meta: { title: '管理员', perm: 'admin.manage' } },
      { path: 'forbidden', name: 'admin-forbidden', component: AdminForbidden, meta: { title: '没有访问权限' } }
    ]
  },
"""

ADMIN_GUARD = """/* ------------------------------------------------------------------ 后台路由守卫 */

/**
 * 未登录访问后台 → 跳后台登录页（后台需求 §3.1 / §16）。
 *
 * 这里只做「有没有登录 + 有没有该页面的查看权限」，
 * 真正的写操作权限由服务端判定，前端拦一层只是为了体验。
 */
router.beforeEach(async to => {
  if (!to.meta.admin || to.meta.adminPublic) return true

  // 动态引入，避免把后台代码打进首屏
  const { bootstrap, admin, can } = await import('../composables/useAdminAuth.js')

  if (!admin.value) {
    await bootstrap()
  }
  if (!admin.value) {
    return { path: '/admin/login', query: { redirect: to.fullPath } }
  }
  const perm = to.meta.perm
  if (perm && !can(perm)) {
    return { path: '/admin/forbidden', query: { perm, from: to.fullPath } }
  }
  return true
})

"""

patch('src/router/index.js', [
    ("const NotFound = () => import('../views/NotFoundView.vue')\n",
     "const NotFound = () => import('../views/NotFoundView.vue')\n" + ADMIN_IMPORTS),
    ("  { path: '/:pathMatch(.*)*', name: 'notfound', component: NotFound, meta: { title: '页面不存在' } }\n]",
     ADMIN_ROUTES + "  { path: '/:pathMatch(.*)*', name: 'notfound', component: NotFound, meta: { title: '页面不存在' } }\n]"),
    ("/* 路由级加载失败默认是**静默**的，必须在这里兜住。",
     ADMIN_GUARD + "/* 路由级加载失败默认是**静默**的，必须在这里兜住。"),
    ("router.afterEach(to => {\n  const base = '豆玩 DOUWAN'",
     "router.afterEach(to => {\n  const base = to.meta.admin ? '豆玩后台' : '豆玩 DOUWAN'"),
])

# ---------------------------------------------------------------- useMembership.js
MEMBERSHIP_ADDITIONS = '''
/* ------------------------------------------------------------------ 服务端权益同步 */

/**
 * 把服务端返回的会员状态写进前台状态。
 *
 * 为什么需要它：权益的真正来源是服务端的 entitlements 表（卡密兑换 / 订单发卡），
 * 前台这份 localStorage 只是离线兜底。登录后必须用服务端状态覆盖本地，
 * 否则会出现「后台已经发了权益，前台还显示免费版」这种前后不一致。
 *
 * @param {{plan?:string, is_pro?:boolean, expire_at?:string|null}} membership
 */
export function applyServerMembership(membership) {
  if (!membership) return
  const next = {
    plan: membership.is_pro ? (membership.plan || PLAN_PRO) : PLAN_FREE,
    expireAt: membership.expire_at || null,
    startedAt: null,
    fromServer: true
  }
  plan.value = next
  writeJSON(KEY, next)
}

/**
 * 用服务端返回的权限矩阵覆盖本地矩阵（登录后调用，保证按钮口径一致）。
 *
 * 服务端返回的是「已经按该用户套餐合并过」的单份矩阵，所以这里同时写进
 * free / pro 两档：当前用户的套餐已经决定了最终结果。
 * 只覆盖键**已存在**的项，避免服务端新增了前台还不认识的功能键时污染矩阵。
 */
export function applyServerPermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') return
  for (const [key, value] of Object.entries(permissions)) {
    if (!ENTITLEMENTS[key]) continue
    ENTITLEMENTS[key] = { free: value, pro: value }
  }
}

/** 用服务端返回的额度覆盖本地 Credits */
export function applyServerCredits(balance) {
  if (typeof balance !== 'number') return
  credits.value = { ...credits.value, balance }
}
'''

p = ROOT / 'src/composables/useMembership.js'
src = p.read_text(encoding='utf-8')
if 'applyServerMembership' not in src:
    src = src.rstrip('\n') + '\n' + MEMBERSHIP_ADDITIONS
    p.write_text(src, encoding='utf-8')
    print('✓ src/composables/useMembership.js')
else:
    print('✓ src/composables/useMembership.js（已打过）')

print('\n全部补丁完成')
