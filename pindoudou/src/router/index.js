/* =========================================================================
   路由（PRD §38）
   -------------------------------------------------------------------------
   2026-10-25 起从 hash 模式改成 history 模式：
   搜索引擎只能抓取真实路径（/materials/xxx/），hash 路由（/#/materials/xxx）
   在爬虫眼里全都是同一个首页，改了等于没改。

   兼容三件事，一个都不能少：
   1. 老链接（https://dw.sharyuke.com/#/library）仍然能用：
      启动时把 hash 里的路径搬回 pathname（见 migrateLegacyHash）；
   2. 旧路径（/library、/library/xxx）重定向到新路径（/materials/、/materials/xxx/），
      nginx 上再补一层 301，把收录与权重一次性转过去；
   3. 登录回调的令牌仍然留在 hash 里，绝不进 query ——
      query 会随请求发给服务器，会进 nginx access log。

   公开可索引的页面只有：首页、素材中心、素材分类页、素材详情页、工具页、教程页。
   其余（工作台、账户、后台）照常能用，但一律 noindex。
   ========================================================================= */

import { createRouter, createWebHistory } from 'vue-router'
import { toastErr } from '../composables/useToast.js'
import { trackPageView } from '../lib/telemetry.js'
import { applyRouteMeta } from '../lib/seo.js'

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
const Colors = () => import('../views/ColorsView.vue')
const Tool = () => import('../views/ToolView.vue')
const NotFound = () => import('../views/NotFoundView.vue')

/* 后台：布局与登录页同步加载（都很小），各功能页按需加载 */
const AdminLayout = () => import('../components/admin/AdminLayout.vue')
const AdminLogin = () => import('../views/admin/AdminLoginView.vue')
const AdminOverview = () => import('../views/admin/AdminOverviewView.vue')
const AdminActivity = () => import('../views/admin/AdminActivityView.vue')
const AdminFeedback = () => import('../views/admin/AdminFeedbackView.vue')
const AdminSeo = () => import('../views/admin/AdminSeoView.vue')
const AdminPlans = () => import('../views/admin/AdminPlansView.vue')
const AdminCards = () => import('../views/admin/AdminCardsView.vue')
const AdminOrders = () => import('../views/admin/AdminOrdersView.vue')
const AdminAssets = () => import('../views/admin/AdminAssetsView.vue')
const AdminUsers = () => import('../views/admin/AdminUsersView.vue')
const AdminSettings = () => import('../views/admin/AdminSettingsView.vue')
const AdminLogs = () => import('../views/admin/AdminLogsView.vue')
const AdminAdmins = () => import('../views/admin/AdminAdminsView.vue')
const AdminForbidden = () => import('../views/admin/AdminForbiddenView.vue')

/* ------------------------------------------------------------------ 旧 hash 地址迁移 */

/**
 * 把老式的 hash 路由地址搬回 pathname。
 *
 * 例：https://dw.sharyuke.com/#/library?col=fav
 *   → pathname 变成 /library，query 变成 ?col=fav
 * 例：https://dw.sharyuke.com/#/auth/callback?access_token=xxx
 *   → pathname 变成 /auth/callback，**hash 原样保留**（令牌不能进 query）
 *
 * 必须在创建 router 之前调用。
 */
function migrateLegacyHash() {
  if (typeof window === 'undefined') return
  const raw = window.location.hash || ''
  if (!raw.startsWith('#/')) return
  const rest = raw.slice(1) // '/library?col=fav'
  const qIndex = rest.indexOf('?')
  const path = qIndex >= 0 ? rest.slice(0, qIndex) : rest
  const query = qIndex >= 0 ? rest.slice(qIndex) : ''
  const isCallback = path === '/auth/callback'
  try {
    const target = (path || '/') + (isCallback ? '' : query) + window.location.search
    window.history.replaceState(null, '', target + (isCallback ? window.location.hash : ''))
  } catch {
    /* 隐私模式 / 老浏览器忽略：路由会落到 404，但不会白屏 */
  }
}

migrateLegacyHash()

/* ------------------------------------------------------------------ 旧 hash 地址兼容（运行期） */

/**
 * 把 hash 片段贴回地址栏。
 *
 * fragment 不会发给服务器，对 SEO 没有影响；留着它是为了让老书签
 * 还能认出自己，也让自检脚本（scripts/*.js 里用 location.hash 判断当前页）
 * 在改成 history 路由之后不用全部重写。
 */
function restoreFragment(raw) {
  if (!raw || window.location.hash === raw) return
  const { pathname, search } = window.location
  try {
    window.history.replaceState(window.history.state, '', pathname + search + raw)
  } catch {
    /* 隐私模式下可能失败：不影响路由，只是 fragment 丢了 */
  }
}

/**
 * 运行期遇到 #/xxx 时，把路径交给路由。
 *
 * 启动那一次由 migrateLegacyHash() 处理；但页面开着的时候，
 * 老链接、书签、以及自检脚本（大量 `location.hash = '#/xxx'`）仍会改 hash。
 * history 模式下 vue-router 只认 pathname，不接住的话这些跳转就静默失效 ——
 * 界面不动，看起来像「点了没反应」。
 */
function watchLegacyHash() {
  if (typeof window === 'undefined') return
  window.addEventListener('hashchange', () => {
    const raw = window.location.hash || ''
    if (!raw.startsWith('#/')) return
    const rest = raw.slice(1) // '/library?col=fav'
    const qIndex = rest.indexOf('?')
    const path = qIndex >= 0 ? rest.slice(0, qIndex) : rest
    const query = qIndex >= 0 ? rest.slice(qIndex) : ''

    /* 登录回调的令牌必须留在 hash 里，绝不能搬进 query
       （query 会随请求发给服务器，会进 nginx access log）。
       把整个 hash 交给路由：路由会把 fragment 一起写回地址栏，
       回调页读参数时才拿得到令牌。 */
    if (path === '/auth/callback') {
      router.replace({ path: '/auth/callback', hash: raw }).catch(() => {})
      return
    }

    const target = (path || '/') + query
    if (target === router.currentRoute.value.fullPath) {
      restoreFragment(raw)
      return
    }
    router.replace(target).then(
      () => restoreFragment(raw),
      () => {}
    )
  })
}

export const routes = [
  /* 首页 = 之前那版带插画的主视觉（2026-10-26 恢复）。
     手机 / 平板 / 电脑三端都是它：主视觉标题图 + 上传卡 + 三条真实能力
     + 首屏以下的可抓取正文（SEO V3.0 的内容区）。
     「创作」等入口都直接进全屏工作台（/editor）。 */
  { path: '/', name: 'home', component: Home, meta: { title: '豆玩拼豆图纸生成器' } },
  /* 老链接：以前首页挪去 /home 放过一天，现在首页回到 /，这里直接跳回去。 */
  { path: '/home', redirect: '/' },
  /* 「创作」直接进全屏工作台：新手三步向导（操作台）2026-11-01 下线，
     /create 只作为老链接保留，跳回 /editor（带上原来的 query，比如 ?tab=library）。 */
  { path: '/create', redirect: to => ({ path: '/editor', query: to.query }) },
  { path: '/editor/:projectId?', name: 'editor', component: Editor, meta: { title: '创作工作台', studio: true, noindex: true } },

  /* ---- 公开可索引的素材页面 ----
     /materials/                素材中心
     /materials/category/{slug}/ 素材分类页
     /materials/{slug}/         素材详情页
     静态段（category）排在动态段前面：vue-router 会自动按分��得分排序，
     /materials/category/pets 一定命中分类页，不会被 /materials/:slug 抢走。 */
  { path: '/materials', name: 'materials-center', component: Library, meta: { title: '免费拼豆素材库' } },
  { path: '/materials/category/:slug', name: 'material-category', component: Library, meta: { title: '素材分类', ownMeta: true } },
  { path: '/materials/:slug', name: 'asset', component: AssetDetail, meta: { title: '素材详情', ownMeta: true } },

  /* 旧地址：
     /library          → 素材中心（301 到 /materials/）
     /library/{id}     → 内置矢量素材详情（这些素材不在后台库里，没有独立可索引页面，
                        所以留在旧地址并标 noindex；后台素材的旧链接由服务端 301 到 /materials/{slug}/） */
  { path: '/library', name: 'library-old', redirect: to => ({ path: '/materials/', query: to.query }) },
  { path: '/library/:slug', name: 'asset-old', component: AssetDetail, meta: { title: '素材详情', noindex: true } },

  { path: '/projects', name: 'projects', component: Projects, meta: { title: '我的作品', noindex: true, account: true } },
  { path: '/projects/:id', name: 'project', component: Projects, meta: { title: '作品详情', noindex: true, account: true } },
  /* 「材料清单」是这个作品的采购清单，属于应用内页面。
     它原来占用 /materials/:projectId，与新的公开素材地址撞车，
     所以挪到 /project-materials/。站内链接都已同步。 */
  { path: '/project-materials/:projectId?', name: 'materials', component: Materials, meta: { title: '材料清单', noindex: true } },
  /* 第三步「完成」= 拼制 + 标记完成。
     /build 同时承担「拼制中」和「已完成」两种状态（finishedAt 在作品存档上），
     不再是一条只有 Pro 能进的死路。 */
  { path: '/build/:projectId?', name: 'build', component: Build, meta: { title: '拼制与完成', noindex: true } },
  { path: '/inventory', name: 'inventory', component: Inventory, meta: { title: '我的库存', noindex: true, account: true } },
  { path: '/account', name: 'account', component: Account, meta: { title: '我的账户', noindex: true, account: true } },
  /* 微信登录 / 绑定的前端回调页：令牌放在 hash query 里，读完立刻抹掉 */
  { path: '/auth/callback', name: 'auth-callback', component: AuthCallback, meta: { title: '登录回调', noindex: true } },
  { path: '/settings', name: 'settings', component: Settings, meta: { title: '设置', noindex: true, account: true } },
  { path: '/help', name: 'help', component: Help, meta: { title: '拼豆教程与常见问题' } },
  { path: '/colors', name: 'colors', component: Colors, meta: { title: '拼豆色号与色卡对照' } },
  { path: '/about', redirect: '/help/' },
  { path: '/blog', redirect: '/help/' },
  { path: '/tools/:slug', name: 'tool', component: Tool, meta: { title: '拼豆图纸生成器' } },
  /* ---------------------------------------------------------------- 后台 */
  /* 后台挂在同一套 SPA 上（/admin），但有独立布局与独立的令牌体系：
     前台是 localStorage 演示账号，后台是真的服务端账号，两者互不干扰。
     未登录访问后台会被下面的守卫送到 /admin/login。 */
  {
    path: '/admin/login',
    name: 'admin-login',
    component: AdminLogin,
    meta: { title: '后台登录', admin: true, adminPublic: true, noindex: true }
  },
  {
    path: '/admin',
    component: AdminLayout,
    meta: { admin: true, noindex: true },
    children: [
      { path: '', name: 'admin-overview', component: AdminOverview, meta: { title: '数据概览', perm: 'overview.view' } },
      { path: 'activity', name: 'admin-activity', component: AdminActivity, meta: { title: '用户数据', perm: 'activity.view' } },
      { path: 'feedback', name: 'admin-feedback', component: AdminFeedback, meta: { title: '意见反馈', perm: 'feedback.view' } },
      { path: 'seo', name: 'admin-seo', component: AdminSeo, meta: { title: 'SEO 管理', perm: 'seo.view' } },
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
  { path: '/:pathMatch(.*)*', name: 'notfound', component: NotFound, meta: { title: '页面不存在', noindex: true } }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    // 带 hash 的地址（登录回调的 #/auth/callback?token=…）没有对应锚点元素，
    // 直接跳顶即可，否则会因为找不到元素而报错。
    if (to.hash) {
      // to.hash 可能是 '#/auth/callback?access_token=…' 这种「路径 + 参数」，
      // 拿去做 querySelector 会抛异常（不是合法选择器），必须兜住。
      let el = null
      try {
        el = document.querySelector(to.hash)
      } catch {
        el = null
      }
      if (el) return { el: to.hash, behavior: 'smooth' }
      return { top: 0 }
    }
    return { top: 0 }
  }
})

// 路由建好之后再接住运行期的 #/xxx 跳转（handler 里要用到 router）
watchLegacyHash()

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
  // 标题 / 描述 / canonical：服务端已经给爬虫渲染过一份，
  // 这里保证用户点着站内链接跳转后也跟着变（应用内页面加 noindex）。
  applyRouteMeta(to)
  // 访问量埋点（后台页面不报）。hash 路由的页面切换不产生 HTTP 请求，
  // 服务端看不见「翻到了哪一页」，只能在这里上报；失败会被静默忽略。
  trackPageView(to)
})

export default router
