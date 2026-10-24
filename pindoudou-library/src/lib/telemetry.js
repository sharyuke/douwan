/* =========================================================================
   前台访问量埋点：把「翻到了哪一页」上报给服务端（POST /api/v1/visits）
   -------------------------------------------------------------------------
   为什么必须在客户端上报：pindoudou 是 hash 路由的 SPA，首页之后的每一次页面
   切换（#/editor、#/library/xxx）都不会产生 HTTP 请求，服务端在接口层看不见。
   所以路由切换时由前端报一条，服务端只做校验、去抖与聚合。

   三条自我约束：
   1. **不影响用户**：fire-and-forget，失败就算了，绝不弹错、绝不阻塞导航；
   2. **口径诚实**：上报的是**路由模板**（/library/:slug）而不是真实 URL，
      否则每个素材详情都会变成一行，页面排行会退化成「素材列表」；
      后台页面（/#/admin/**）不报——内部人员操作会把站点访问量搅混；
   3. **不含隐私**：只上报一个随机访客标识（localStorage 持久化）+ 路由 + 来源，
      不采集设备信息、不采集输入内容，也不做任何跨站标识。
   ========================================================================= */

import { userTokens } from './api.js'

const VISITOR_KEY = 'douwan-visitor'
const ENDPOINT = '/api/v1/visits'
/** 客户端侧去抖：SPA 里一次导航可能触发两次（重定向 / 组件重复挂载） */
const DEDUPE_MS = 2000
/** 落地页渠道参数：与服务端 resolveAcquisition 的优先级一致（channel → utm_source → referrer） */
const CHANNEL_KEYS = ['from', 'utm_source', 'ref', 'channel']
const VISITOR_RE = /^[0-9a-f]{32}$/

let lastPath = ''
let lastAt = 0

/** 生成 32 位十六进制随机串（优先用 crypto，取不到时退回 Math.random）。 */
function randomHex(bytes) {
  const buf = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 访客标识：浏览器本地随机生成并持久化。
 *
 * 它不是账号，也不是浏览器指纹：清空浏览器数据 / 换浏览器 / 无痕窗口
 * 都会算成新访客——后台页面上把这条口径写在了明处，UV 不能被当成「人数」。
 */
export function visitorId() {
  try {
    const saved = localStorage.getItem(VISITOR_KEY)
    if (saved && VISITOR_RE.test(saved)) return saved
    const id = randomHex(16)
    localStorage.setItem(VISITOR_KEY, id)
    return id
  } catch {
    // 隐私模式 / 禁用存储：每次都算新访客，但至少这次访问能被记下来
    return randomHex(16)
  }
}

/** 从落地页的查询串里取渠道参数（?from=gitee / ?utm_source=weibo）。 */
function landingChannel() {
  try {
    const query = new URLSearchParams(window.location.search)
    for (const key of CHANNEL_KEYS) {
      const value = query.get(key)
      if (value) return value.slice(0, 64)
    }
  } catch {
    /* 拿不到就当没带 */
  }
  return ''
}

/** 上报路径：优先用路由模板（动态段归一），拿不到才退回真实路径。 */
function routePath(to) {
  const matched = to.matched && to.matched.length ? to.matched[to.matched.length - 1] : null
  return (matched && matched.path) || to.path || '/'
}

function send(body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = userTokens.access
  // 带着登录令牌：服务端就能把这次访问关联到账号（后台据此区分登录 / 匿名访客）
  if (token) headers.Authorization = 'Bearer ' + token
  try {
    // keepalive：页面正在关闭时也能把请求发出去
    fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true })
      .then(res => res.json())
      .then(envelope => {
        // 服务端没收到合法标识时会回一个新的：存下来，否则每次访问都会被算成新访客
        const id = envelope && envelope.data && envelope.data.visitor
        if (id && VISITOR_RE.test(id)) {
          try {
            localStorage.setItem(VISITOR_KEY, id)
          } catch {
            /* 存不下就算了 */
          }
        }
      })
      .catch(() => {})
  } catch {
    /* 埋点失败不影响任何功能 */
  }
}

/**
 * 记一次页面访问。由 router.afterEach 调用（首次进入也会触发）。
 * @param {import('vue-router').RouteLocationNormalized} to
 */
export function trackPageView(to) {
  if (typeof window === 'undefined' || !to) return
  if (window.location.protocol === 'file:') return
  // 后台页面不计入站点访问量；404 也不计（大多是被爬虫/老链接打中的垃圾路径）
  if (to.meta && to.meta.admin) return
  if (to.name === 'notfound') return

  const path = routePath(to)
  const now = Date.now()
  if (path === lastPath && now - lastAt < DEDUPE_MS) return
  lastPath = path
  lastAt = now

  send({
    visitor: visitorId(),
    path,
    referrer: (document && document.referrer) || '',
    channel: landingChannel()
  })
}

/* ------------------------------------------------------------------ 功能埋点
   POST /api/v1/events（需要登录令牌）。白名单与中文名在服务端
   internal/model/activity.go，前端只能上报那几项浏览器内行为。
   批量 + 3 秒合并，避免「生成一次、导出一次」就发一串请求。 */

const EVENTS_ENDPOINT = '/api/v1/events'
const EVENT_BATCH = 20
const EVENT_FLUSH_MS = 3000

let eventQueue = []
let eventTimer = null

function flushEvents() {
  eventTimer = null
  if (!eventQueue.length) return
  const events = eventQueue
  eventQueue = []
  const token = userTokens.access
  // 没有登录令牌时服务端会 401；匿名访客的页面访问仍由 /visits 统计
  if (!token) return
  try {
    fetch(EVENTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ events }),
      keepalive: true
    }).catch(() => {})
  } catch {
    /* 埋点失败不影响功能 */
  }
}

/**
 * 上报一次浏览器内功能行为。
 * @param {string} feature 服务端白名单里的键，例如 pattern.generate / pattern.export
 * @param {number} count   次数，默认 1
 */
export function trackEvent(feature, count = 1) {
  if (typeof window === 'undefined' || !feature) return
  if (!userTokens.access) return
  const n = Math.max(1, Math.min(100, Number(count) || 1))
  const found = eventQueue.find(e => e.feature === feature)
  if (found) found.count += n
  else eventQueue.push({ feature, count: n })
  if (eventQueue.length >= EVENT_BATCH) {
    if (eventTimer) clearTimeout(eventTimer)
    flushEvents()
    return
  }
  if (!eventTimer) eventTimer = setTimeout(flushEvents, EVENT_FLUSH_MS)
}
