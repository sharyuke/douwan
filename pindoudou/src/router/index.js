/* =========================================================================
   路由（PRD §38）
   用 hash 模式：静态托管下不需要服务器 rewrite，
   `base: './'` 的相对路径部署方式保持不变。
   SEO 页面（/tools/*）先给出独立可索引的内容页，等接入 SSR 再迁移。
   ========================================================================= */

import { createRouter, createWebHashHistory } from 'vue-router'
import { toastErr } from '../composables/useToast.js'
import { trackPageView } from '../lib/telemetry.js'

const Home = () => import('../views/HomeView.vue')
const Editor = () => import('../views/EditorView.vue')
const Library = () => import('../views/LibraryView.vue')
const AssetDetail = () => import('../views/AssetDetailView.vue')
const Projects = () => import('../views/ProjectsView.vue')
const Materials = () => import('../views/MaterialsView.vue')
const Build = () => import('../views/BuildView.vue')
const Inventory = () => import('../views/InventoryView.vue')
const Account = () => import('../views/AccountView.vue')
const AuthCallback = () => import('../views/AuthCallbackView.vue')
const Settings = () => import('../views/SettingsView.vue')
const Help = () => import('../views/HelpView.vue')
const Tool = () => import('../views/ToolView.vue')
const NotFound = () => import('../views/NotFoundView.vue')

/* 后台：布局与登录页同步加载（都很小），各功能页按需加载 */
const AdminLayout = () => import('../components/admin/AdminLayout.vue')
const AdminLogin = () => import('../views/admin/AdminLoginView.vue')
const AdminOverview = () => import('../views/admin/AdminOverviewView.vue')
const AdminActivity = () => import('../views/admin/AdminActivityView.vue')
const AdminFeedback = () => import('../views/admin/AdminFeedbackView.vue')
const AdminPlans = () => import('../views/admin/AdminPlansView.vue')
const AdminCards = () => import('../views/admin/AdminCardsView.vue')
const AdminOrders = () => import('../views/admin/AdminOrdersView.vue')
const AdminAssets = () => import('../views/admin/AdminAssetsView.vue')
const AdminUsers = () => import('../views/admin/AdminUsersView.vue')
const AdminSettings = () => import('../views/admin/AdminSettingsView.vue')
const AdminLogs = () => import('../views/admin/AdminLogsView.vue')
const AdminAdmins = () => import('../views/admin/AdminAdminsView.vue')
const AdminForbidden = () => import('../views/admin/AdminForbiddenView.vue')

export const routes = [
  { path: '/', name: 'home', component: Home, meta: { title: '把喜欢的东西，拼成自己的作品' } },
  { path: '/home', redirect: '/' },
  /* 「开始创作」不再是独立页面：它就是工作台没有图纸时的样子。
     老链接（站内 CTA、收藏夹、外面的推广位）都会落到工作台的创建步骤上，
     连 ?tab=ai / ?tab=library 也一起带过去。 */
  { path: '/create', name: 'create', redirect: to => ({ path: '/editor', query: to.query }) },
  { path: '/editor/:projectId?', name: 'editor', component: Editor, meta: { title: '创作工作台', studio: true } },
  { path: '/library', name: 'library', component: Library, meta: { title: '素材中心' } },
  { path: '/library/:slug', name: 'asset', component: AssetDetail, meta: { title: '素材详情' } },
  { path: '/projects', name: 'projects', component: Projects, meta: { title: '我的作品' } },
  { path: '/projects/:id', name: 'project', component: Projects, meta: { title: '作品详情' } },
  { path: '/materials/:projectId?', name: 'materials', component: Materials, meta: { title: '材料清单' } },
  /* 第三步「完成」= 拼制 + 标记完成。
     /build 同时承担「拼制中」和「已完成」两种状态（finishedAt 在作品存档上），
     不再是一条只有 Pro 能进的死路。 */
  { path: '/build/:projectId?', name: 'build', component: Build, meta: { title: '拼制与完成' } },
  { path: '/inventory', name: 'inventory', component: Inventory, meta: { title: '我的库存' } },
  { path: '/account', name: 'account', component: Account, meta: { title: '我的账户' } },
  /* 微信登录 / 绑定的前端回调页：令牌放在 hash query 里，读完立刻抹掉 */
  { path: '/auth/callback', name: 'auth-callback', component: AuthCallback, meta: { title: '登录回调' } },
  { path: '/settings', name: 'settings', component: Settings, meta: { title: '设置' } },
  { path: '/help', name: 'help', component: Help, meta: { title: '帮助与教程' } },
  { path: '/about', redirect: '/help' },
  { path: '/blog', redirect: '/help' },
  { path: '/tools/:slug', name: 'tool', component: Tool, meta: { title: '拼豆图纸生成器' } },
  /* ---------------------------------------------------------------- 后台 */
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
      { path: 'activity', name: 'admin-activity', component: AdminActivity, meta: { title: '用户活跃监控', perm: 'activity.view' } },
      { path: 'feedback', name: 'admin-feedback', component: AdminFeedback, meta: { title: '意见反馈', perm: 'feedback.view' } },
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
  { path: '/:pathMatch(.*)*', name: 'notfound', component: NotFound, meta: { title: '页面不存在' } }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  }
})

/* ------------------------------------------------------------------ 后台路由守卫 */

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

/* 路由级加载失败默认是**静默**的，必须在这里兜住。
   每个视图都是 `() => import(...)` 懒加载：拿不到那份代码时（本地 dev/preview
   服务已经停了但页面还开着、部署后 hashed chunk 404…），vue-router 会直接中止
   这次跳转 —— 地址不变、界面不变，用户看到的就是「点了没反应」。
   工作台右栏的「开始拼这一块」就是典型：它要新加载 Build Mode 那份 chunk，
   服务不在时正好表现为按钮点不动。 */
router.onError(error => {
  // 注册了 onError 之后 vue-router 不再自己 console.error，这里补回去，否则排查时看不到原始错误
  console.error('[router] 导航失败', error)
  const raw = (error && error.message) || String(error || '')
  const isChunkError = /dynamically imported module|Importing a module script failed|MIME type|Failed to fetch|ERR_CONNECTION|Loading chunk/i.test(raw)
  toastErr(isChunkError
    ? '页面代码没加载到，请刷新重试；本地预览请确认 dev / preview 服务还在运行。'
    : `页面打开失败：${raw}`.slice(0, 140))
})

router.afterEach(to => {
  const base = to.meta.admin ? '豆玩后台' : '豆玩 DOUWAN'
  document.title = to.meta && to.meta.title ? `${to.meta.title} · ${base}` : `${base} · AI 拼豆设计工作台`
  // 访问量埋点（后台页面不报）。hash 路由的页面切换不产生 HTTP 请求，
  // 服务端看不见「翻到了哪一页」，只能在这里上报；失败会被静默忽略。
  trackPageView(to)
})

export default router
