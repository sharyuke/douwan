<script setup>
/* =========================================================================
   用户活跃监控（后台需求 §4 的「经营」维度补充）
   活跃四维度：使用频率 / 地区 / 功能使用 / 来源渠道；另有「访问量」（PV / UV）
   与留存、用户明细。接口见 douwan-api/docs/api.md「用户活跃数据监控」，
   设计与口径见 douwan-api/docs/activity.md。

   写这个页面时反复提醒自己的几件事（都是口径问题，不是样式问题）：
   - 活跃数据是**异步落库**的（内存缓冲 + 定时 flush），所以页面上永远显示「采集状态」，
     不假装数据是实时的；`freshness.dropped_hits` 不为 0 就说明采样被丢过。
   - `trend` 里逐日的 active_users **不能相加**当窗口活跃数，窗口去重值只在 cards.active_users。
   - 留存队列没过完第 N 天时后端给 `*_eligible=false`，这里显示「—」而不是 0 —— 0 会被读成结论。
   - 功能使用按来源拆成 api / client 两行，口径不同，**不做合并**。
   - 地区百分比的分母是窗口活跃用户数，所以「各省之和 + 未知占比 = 100%」，未知要单独显示。
   - IP 全部由后端脱敏（203.0.113.*），前端不做二次加工也不请求完整 IP。
   - 「访问量」是**另一套口径**：包含未登录访客、按浏览器访客标识去重（不是人数），
     与「用户活跃」的数字不能互相加减；页面上必须把这句话摆在数字旁边。
   ========================================================================= */

import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import PixelIcon from '../../components/ui/PixelIcon.vue'

import { activityApi } from '../../lib/adminApi.js'
import { ApiError, datetime, fromNow, money, syncQuery } from '../../lib/api.js'
import { toastErr } from '../../composables/useToast.js'

const route = useRoute()
const router = useRouter()

/* ------------------------------------------------------------------ 标签页 */

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'traffic', label: '访问量' },
  { key: 'retention', label: '留存' },
  { key: 'frequency', label: '使用频率' },
  { key: 'regions', label: '地区' },
  { key: 'features', label: '功能使用' },
  { key: 'channels', label: '来源渠道' },
  { key: 'users', label: '用户明细' }
]

const activeTab = ref('overview')
const days = ref(30)

const DAY_OPTIONS = [
  { value: 7, label: '最近 7 天' },
  { value: 14, label: '最近 14 天' },
  { value: 30, label: '最近 30 天' },
  { value: 90, label: '最近 90 天' }
]

/* ------------------------------------------------------------------ 数据 */

const overview = ref(null)
const overviewLoading = ref(false)
const overviewError = ref('')

/** 除总览与用户明细之外的标签页数据（留存 / 频率 / 地区 / 功能 / 渠道） */
const tab = ref(null)
const tabLoading = ref(false)
const tabError = ref('')

/** 用户明细（单独一套分页与筛选） */
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const usersLoading = ref(false)
const usersError = ref('')

const userFilters = reactive({
  keyword: '',
  channel: '',
  province: '',
  min_active_days: '',
  sort: 'active_days'
})

/** 渠道下拉选项：来自 /channels 的真实渠道值，拿不到就只给「直访 / 未知」 */
const channelOptions = ref([])

/** 访问量标签页（PV / UV / 页面排行 / 落地页 / 来源） */
const traffic = ref(null)
const trafficLoading = ref(false)
const trafficError = ref('')

/** 访客明细：单独一套分页与筛选（与用户明细互不影响） */
const visitorRows = ref([])
const visitorTotal = ref(0)
const visitorPage = ref(1)
const visitorPageSize = ref(20)
const visitorLoading = ref(false)
const visitorError = ref('')

const visitorFilters = reactive({
  channel: '',
  path: '',
  sort: 'page_views'
})

/** 访客详情弹窗 */
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detail = ref(null)

const loading = computed(() =>
  overviewLoading.value || tabLoading.value || usersLoading.value || trafficLoading.value || visitorLoading.value)

/* ------------------------------------------------------------------ 地址栏同步 */

function syncFilters() {
  const onUsers = activeTab.value === 'users'
  const onTraffic = activeTab.value === 'traffic'
  syncQuery(router, route, {
    tab: activeTab.value === 'overview' ? '' : activeTab.value,
    days: days.value === 30 ? '' : String(days.value),
    page: onUsers && page.value > 1 ? String(page.value) : '',
    keyword: onUsers ? userFilters.keyword : '',
    channel: onUsers ? userFilters.channel : '',
    province: onUsers ? userFilters.province : '',
    min_days: onUsers ? userFilters.min_active_days : '',
    sort: onUsers && userFilters.sort !== 'active_days' ? userFilters.sort : '',
    vpage: onTraffic && visitorPage.value > 1 ? String(visitorPage.value) : '',
    vchannel: onTraffic ? visitorFilters.channel : '',
    vpath: onTraffic ? visitorFilters.path : '',
    vsort: onTraffic && visitorFilters.sort !== 'page_views' ? visitorFilters.sort : ''
  })
}

function restoreFilters() {
  const q = key => {
    const v = route.query[key]
    return Array.isArray(v) ? v[0] : (v || '')
  }
  const tabKey = q('tab')
  if (TABS.some(t => t.key === tabKey)) activeTab.value = tabKey

  const d = parseInt(q('days'), 10)
  if (DAY_OPTIONS.some(o => o.value === d)) days.value = d

  userFilters.keyword = q('keyword')
  userFilters.channel = q('channel')
  userFilters.province = q('province')
  userFilters.min_active_days = q('min_days')
  userFilters.sort = q('sort') || 'active_days'

  visitorFilters.channel = q('vchannel')
  visitorFilters.path = q('vpath')
  visitorFilters.sort = q('vsort') || 'page_views'

  const p = parseInt(q('page'), 10)
  if (!Number.isNaN(p) && p > 0) page.value = p

  const vp = parseInt(q('vpage'), 10)
  if (!Number.isNaN(vp) && vp > 0) visitorPage.value = vp
}

/* ------------------------------------------------------------------ 加载 */

async function loadOverview() {
  overviewLoading.value = true
  overviewError.value = ''
  try {
    overview.value = await activityApi.overview({ days: days.value })
  } catch (e) {
    overviewError.value = e instanceof ApiError ? e.message : '概览加载失败，请重试'
    overview.value = null
  } finally {
    overviewLoading.value = false
  }
}

/** 加载当前标签页的内容（总览 / 访问量 / 用户明细另有入口） */
async function loadTab() {
  if (activeTab.value === 'overview') return loadOverview()
  if (activeTab.value === 'users') return reloadUsers(page.value)
  if (activeTab.value === 'traffic') return loadTraffic()

  tabLoading.value = true
  tabError.value = ''
  try {
    const q = { days: days.value }
    if (activeTab.value === 'retention') tab.value = await activityApi.retention(q)
    else if (activeTab.value === 'frequency') tab.value = await activityApi.frequency(q)
    else if (activeTab.value === 'regions') tab.value = await activityApi.regions({ ...q, limit: 20 })
    else if (activeTab.value === 'features') tab.value = await activityApi.features({ ...q, limit: 30 })
    else if (activeTab.value === 'channels') tab.value = await activityApi.channels(q)
    else tab.value = null
  } catch (e) {
    tabError.value = e instanceof ApiError ? e.message : '加载失败，请重试'
    tab.value = null
  } finally {
    tabLoading.value = false
  }
}

async function reloadUsers(toPage = page.value) {
  syncFilters()
  page.value = Math.max(1, toPage || 1)
  usersLoading.value = true
  usersError.value = ''
  try {
    const data = await activityApi.users({
      days: days.value,
      page: page.value,
      page_size: pageSize.value,
      keyword: userFilters.keyword,
      channel: userFilters.channel,
      province: userFilters.province,
      min_active_days: userFilters.min_active_days,
      sort: userFilters.sort
    })
    rows.value = (data && data.list) || []
    total.value = (data && data.total) || 0
  } catch (e) {
    usersError.value = e instanceof ApiError ? e.message : '加载失败，请重试'
    rows.value = []
    total.value = 0
  } finally {
    usersLoading.value = false
  }
}

/** 渠道选项：只在下拉里给出真实存在的渠道，拿不到时保底给「直访 / 未知」 */
async function loadChannelOptions() {  try {
    const data = await activityApi.channels({ days: days.value })
    channelOptions.value = ((data && data.items) || []).map(i => i.channel)
  } catch {
    channelOptions.value = []
  }
}

/** 访问量：指标卡 + 趋势 + 页面排行 + 落地页 + 来源 */
async function loadTraffic() {
  trafficLoading.value = true
  trafficError.value = ''
  try {
    traffic.value = await activityApi.traffic({ days: days.value, limit: 15 })
    // 访客明细与访问量同屏，一次切页把两张表都刷新，避免看到对不上的数字
    await reloadVisitors(visitorPage.value)
  } catch (e) {
    trafficError.value = e instanceof ApiError ? e.message : '访问量加载失败，请重试'
    traffic.value = null
  } finally {
    trafficLoading.value = false
  }
}

async function reloadVisitors(toPage = visitorPage.value) {
  syncFilters()
  visitorPage.value = Math.max(1, toPage || 1)
  visitorLoading.value = true
  visitorError.value = ''
  try {
    const data = await activityApi.trafficVisitors({
      days: days.value,
      page: visitorPage.value,
      page_size: visitorPageSize.value,
      channel: visitorFilters.channel,
      path: visitorFilters.path,
      sort: visitorFilters.sort
    })
    visitorRows.value = (data && data.list) || []
    visitorTotal.value = (data && data.total) || 0
  } catch (e) {
    visitorError.value = e instanceof ApiError ? e.message : '访客列表加载失败，请重试'
    visitorRows.value = []
    visitorTotal.value = 0
  } finally {
    visitorLoading.value = false
  }
}

function searchVisitors() {
  reloadVisitors(1)
}

function resetVisitorFilters() {
  visitorFilters.channel = ''
  visitorFilters.path = ''
  visitorFilters.sort = 'page_views'
  reloadVisitors(1)
}

/** 从页面排行点进「访问过这个页面的访客」 */
function filterVisitorsByPath(path) {
  visitorFilters.path = path
  visitorFilters.channel = ''
  reloadVisitors(1)
}

async function openUser(id) {
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  detail.value = null
  try {
    detail.value = await activityApi.userDetail(id, { days: days.value })
  } catch (e) {
    detailError.value = e instanceof ApiError ? e.message : '用户明细加载失败'
  } finally {
    detailLoading.value = false
  }
}

/* ------------------------------------------------------------------ 交互 */

function switchTab(key) {
  if (activeTab.value === key) return
  activeTab.value = key
  page.value = 1
  visitorPage.value = 1
  tab.value = null
  tabError.value = ''
  syncFilters()
  if (key === 'overview') loadOverview()
  else loadTab()
}

function changeDays() {
  page.value = 1
  visitorPage.value = 1
  syncFilters()
  loadOverview()
  loadTab()
  loadChannelOptions()
}

function refresh() {
  loadOverview()
  loadTab()
  loadChannelOptions()
}

function resetUserFilters() {
  userFilters.keyword = ''
  userFilters.channel = ''
  userFilters.province = ''
  userFilters.min_active_days = ''
  userFilters.sort = 'active_days'
  reloadUsers(1)
}

function searchUsers() {
  reloadUsers(1)
}

/* ------------------------------------------------------------------ 展示工具 */

function num(v) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN')
}

/** 百分比：后端已经是 0~100 的两位小数，这里只保证「不是数字就显示 —」 */
function pct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return (Math.round(Number(v) * 100) / 100) + '%'
}

function signedPct(v) {
  const n = Number(v || 0)
  const s = Math.round(n * 100) / 100
  return (s > 0 ? '+' : '') + s + '%'
}

/** 地区名称：境外数据要带上国家，否则「CA / 加利福尼亚」会被误读成国内省份 */
function regionLabel(r) {
  const place = r.province || r.city || ''
  if (r.country && r.country !== '中国') return r.country + (place ? ' · ' + place : '')
  return place || r.isp || '未知'
}

/** 渠道选择框的选项：直访 / 未知 + 实际出现过的渠道 */
const channelChoices = computed(() => {
  const set = new Set(channelOptions.value.filter(Boolean))
  set.delete('direct')
  return [...set]
})

const maxTrend = computed(() => {
  const list = (overview.value && overview.value.trend) || []
  return list.reduce((m, p) => Math.max(m, Number(p.active_users || 0), Number(p.new_users || 0)), 0) || 1
})

/** 柱高：把「0」也画成一个可见的细线，避免整天没有数据的日期被看成缺格 */
function barHeight(v) {
  const ratio = Number(v || 0) / maxTrend.value
  return ratio <= 0 ? '2px' : Math.max(3, Math.round(ratio * 100)) + '%'
}

/** 趋势横轴：天数多时隔几个标一个，避免文字糊在一起 */
const axisStep = computed(() => {
  const n = ((overview.value && overview.value.trend) || []).length
  return n <= 12 ? 1 : Math.ceil(n / 10)
})

/* ------------------------------------------------------------- 访问量页工具 */

/** 路由模板 → 人话。表里仍然显示原始路径（它才是口径），这里只做标题。 */
const PATH_LABELS = {
  '/': '首页',
  '/editor': '创作工作台',
  '/library': '素材中心',
  '/library/:slug': '素材详情',
  '/projects': '我的作品',
  '/projects/:id': '作品详情',
  '/materials/:projectId?': '材料清单',
  '/materials/:projectId': '材料清单',
  '/build/:projectId?': '拼制与完成',
  '/inventory': '我的库存',
  '/pricing': '会员与定价',
  '/account': '我的账户',
  '/settings': '设置',
  '/help': '帮助与教程',
  '/tools/:slug': '工具/落地页',
  '/other': '其他（非法路径）'
}

function pathLabel(path) {
  if (PATH_LABELS[path]) return PATH_LABELS[path]
  return path || '未知'
}

const trafficCards = computed(() => (traffic.value && traffic.value.cards) || {})
const trafficTrend = computed(() => (traffic.value && traffic.value.trend) || [])
const trafficWindow = computed(() => (traffic.value && traffic.value.window) || window_.value)
const trafficFreshness = computed(() => (traffic.value && traffic.value.freshness) || freshness.value)

/** PV / UV 同轴：取两者最大值当 100%，两张柱同一标尺才能互相比较 */
const maxTraffic = computed(() => {
  return trafficTrend.value.reduce((m, p) => Math.max(m, Number(p.pv || 0), Number(p.uv || 0)), 0) || 1
})

function trafficBarHeight(v) {
  const ratio = Number(v || 0) / maxTraffic.value
  return ratio <= 0 ? '2px' : Math.max(3, Math.round(ratio * 100)) + '%'
}

/** 采集状态：访问量那一套缓冲单独报，和活跃的缓冲不是一回事 */
const trafficFreshnessText = computed(() => {
  if (!traffic.value) return ''
  const f = trafficFreshness.value
  const parts = [
    `统计窗口 ${trafficWindow.value.from} ~ ${trafficWindow.value.to}（${trafficWindow.value.days} 天）`,
    `落库周期 ${f.flush_interval_seconds || '—'} 秒`,
    `访问缓冲 ${num(f.buffered_visits)} 次 / ${num(f.buffered_visitors)} 个访客`,
    f.last_flush_at ? `最近落库 ${datetime(f.last_flush_at)}` : '还没有落库过'
  ]
  return parts.join(' · ')
})

const trafficWarn = computed(() => {
  const f = trafficFreshness.value
  return Number(f.dropped_visits || 0) > 0 || !!f.last_error
})

const cards = computed(() => (overview.value && overview.value.cards) || {})
const window_ = computed(() => (overview.value && overview.value.window) || {})
const freshness = computed(() => (overview.value && overview.value.freshness) || {})

/** 采集状态是否「不健康」：丢弃过采样或最近一次落库失败，都要显眼提示 */
const freshnessWarn = computed(() => {
  const f = freshness.value
  return Number(f.dropped_hits || 0) > 0 || !!f.last_error
})

const freshnessText = computed(() => {
  const f = freshness.value
  if (!overview.value) return ''
  const parts = [
    `统计窗口 ${window_.value.from} ~ ${window_.value.to}（${window_.value.days} 天）`,
    `采集周期 ${f.flush_interval_seconds || '—'} 秒`,
    `内存缓冲 ${num(f.buffered_buckets)} 桶 / ${num(f.buffered_hits)} 次`,
    f.last_flush_at ? `最近落库 ${datetime(f.last_flush_at)}` : '还没有落库过',
    `地区解析${f.geo_enabled ? '可用' : '不可用'}`
  ]
  return parts.join(' · ')
})

const trendCount = computed(() => ((overview.value && overview.value.trend) || []).length)

/* 留存：概览卡片 + 队列表 */
const retentionSummary = computed(() => (tab.value && tab.value.summary) || {})

/* 频率 */
const frequencyTop = computed(() => (tab.value && tab.value.top_users) || [])

/* ------------------------------------------------------------------ 表格行
   AdminTable 用 row[rowKey] 当 v-for 的 key，聚合结果里同一功能会有 api / client 两行、
   城市按省分组也会重名，所以统一补一个组合唯一 key，避免 dev 下重复 key 告警。 */

function withKey(list, keyer) {
  return (list || []).map(r => ({ ...r, _key: keyer(r) }))
}

const cohortRows = computed(() => withKey(tab.value && tab.value.cohorts, r => r.day))
const bucketRows = computed(() => withKey(tab.value && tab.value.buckets, r => r.label))
const provinceRows = computed(() => withKey(tab.value && tab.value.provinces, r => `${r.country}|${r.province}`))
const cityRows = computed(() => withKey(tab.value && tab.value.cities, r => `${r.country}|${r.province}|${r.city}`))
const ispRows = computed(() => withKey(tab.value && tab.value.isps, r => r.isp))
const featureRows = computed(() => withKey(tab.value && tab.value.items, r => `${r.feature}|${r.source}`))
const detailFeatureRows = computed(() => withKey(detail.value && detail.value.features, r => `${r.feature}|${r.source}`))
const detailRegionRows = computed(() => withKey(detail.value && detail.value.regions, r => `${r.country}|${r.province}|${r.city}|${r.isp}`))

/* 访问量：路径可能重复出现（同一路径在不同聚合里），统一补唯一 key */
const pageRows = computed(() => withKey(traffic.value && traffic.value.pages, r => r.path))
const landingRows = computed(() => withKey(traffic.value && traffic.value.landings, r => r.path))
const trafficSourceRows = computed(() => withKey(traffic.value && traffic.value.sources, r => r.channel || 'unknown'))
const visitorRowsKeyed = computed(() => withKey(visitorRows.value, r => r.visitor))

/* ------------------------------------------------------------------ 列定义 */

const cohortColumns = [
  { key: 'day', label: '注册日', nowrap: true },
  { key: 'new_users', label: '新增用户', align: 'right' },
  { key: 'd1', label: '次日留存', align: 'right' },
  { key: 'd3', label: '3 日留存', align: 'right' },
  { key: 'd7', label: '7 日留存', align: 'right' }
]

const bucketColumns = [
  { key: 'label', label: '活跃天数区间' },
  { key: 'users', label: '用户数', align: 'right' },
  { key: 'percent', label: '占比', align: 'right' }
]

const topUserColumns = [
  { key: 'username', label: '用户' },
  { key: 'active_days', label: '活跃天数', align: 'right' },
  { key: 'requests', label: '请求次数', align: 'right' },
  { key: 'features', label: '功能次数', align: 'right' },
  { key: 'actions', label: '操作' }
]

const provinceColumns = [
  { key: 'region', label: '省份 / 直辖市' },
  { key: 'users', label: '活跃用户', align: 'right' },
  { key: 'requests', label: '请求次数', align: 'right' },
  { key: 'percent', label: '占比', align: 'right' }
]

const cityColumns = [
  { key: 'region', label: '省份' },
  { key: 'city', label: '城市' },
  { key: 'users', label: '活跃用户', align: 'right' },
  { key: 'requests', label: '请求次数', align: 'right' },
  { key: 'percent', label: '占比', align: 'right' }
]

const ispColumns = [
  { key: 'isp', label: '运营商 / 网络' },
  { key: 'users', label: '活跃用户', align: 'right' },
  { key: 'requests', label: '请求次数', align: 'right' },
  { key: 'percent', label: '占比', align: 'right' }
]

const featureColumns = [
  { key: 'feature', label: '功能' },
  { key: 'source', label: '来源' },
  { key: 'users', label: '使用人数', align: 'right' },
  { key: 'count', label: '次数', align: 'right' },
  { key: 'percent', label: '占比', align: 'right' }
]

const channelColumns = [
  { key: 'channel', label: '渠道' },
  { key: 'new_users', label: '窗口内新增', align: 'right' },
  { key: 'total_users', label: '累计用户', align: 'right' },
  { key: 'active_users', label: '窗口内活跃', align: 'right' },
  { key: 'active_rate', label: '活跃率', align: 'right' },
  { key: 'paid_users', label: '付费人数', align: 'right' },
  { key: 'paid_amount', label: '付费金额', align: 'right' },
  { key: 'actions', label: '操作' }
]

const userColumns = [
  { key: 'username', label: '用户' },
  { key: 'channel', label: '渠道' },
  { key: 'region', label: '地区' },
  { key: 'active_days', label: '活跃天数', align: 'right' },
  { key: 'requests', label: '请求次数', align: 'right' },
  { key: 'features', label: '功能次数', align: 'right' },
  { key: 'last_active_at', label: '最近活跃', nowrap: true },
  { key: 'created_at', label: '注册时间', nowrap: true },
  { key: 'actions', label: '操作' }
]

const dailyColumns = [
  { key: 'day', label: '日期', nowrap: true },
  { key: 'requests', label: '请求', align: 'right' },
  { key: 'features', label: '功能', align: 'right' },
  { key: 'first_active_at', label: '首次活跃', nowrap: true },
  { key: 'last_active_at', label: '最后活跃', nowrap: true },
  { key: 'region', label: '地区' },
  { key: 'isp', label: '运营商' },
  { key: 'ip', label: 'IP（脱敏）' }
]

const detailFeatureColumns = [
  { key: 'feature', label: '功能' },
  { key: 'source', label: '来源' },
  { key: 'count', label: '次数', align: 'right' },
  { key: 'percent', label: '占比', align: 'right' }
]

const detailRegionColumns = [
  { key: 'region', label: '国家 / 地区' },
  { key: 'city', label: '城市' },
  { key: 'isp', label: '运营商' },
  { key: 'users', label: '天数', align: 'right' },
  { key: 'requests', label: '请求', align: 'right' }
]

/* 访问量页的四个表：页面排行 / 落地页 / 来源 / 访客明细 */

const pageColumns = [
  { key: 'path', label: '页面' },
  { key: 'pv', label: '访问量（PV）', align: 'right' },
  { key: 'visitors', label: '访客数（UV）', align: 'right' },
  { key: 'pv_per_visitor', label: '人均访问', align: 'right' },
  { key: 'percent', label: 'PV 占比', align: 'right' },
  { key: 'actions', label: '操作' }
]

const landingColumns = [
  { key: 'path', label: '落地页' },
  { key: 'visitors', label: '新访客数', align: 'right' },
  { key: 'percent', label: '占新访客', align: 'right' }
]

const trafficSourceColumns = [
  { key: 'channel', label: '来源渠道' },
  { key: 'visitors', label: '访客数', align: 'right' },
  { key: 'pv', label: '访问量', align: 'right' },
  { key: 'percent', label: '访客占比', align: 'right' }
]

const visitorColumns = [
  { key: 'visitor', label: '访客' },
  { key: 'channel', label: '首触来源' },
  { key: 'region', label: '地区' },
  { key: 'page_views', label: '累计访问', align: 'right' },
  { key: 'first_day', label: '首次访问', nowrap: true },
  { key: 'last_path', label: '最近页面' },
  { key: 'last_seen_at', label: '最近访问', nowrap: true }
]

/* ------------------------------------------------------------------ 启动 */

onMounted(() => {
  restoreFilters()
  loadOverview()
  if (activeTab.value === 'users') reloadUsers(page.value)
  else loadTab()
  loadChannelOptions()
})
</script>

<template>
  <div class="adm-page">
    <!-- ① 页头 -->
    <div class="adm-pagehead">
      <div>
        <h1>用户活跃监控</h1>
        <p>
          从「使用频率、地区、功能使用、来源渠道」四个维度看用户到底在用不用，
          「访问量」看站点被打开了多少次、多少人来过（含未登录访客）。
          活跃数据走内存缓冲异步落库，页面顶部始终显示采集状态；
          留存的「—」表示这个队列还没过完对应天数，不是 0。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <select v-model.number="days" class="adm-select" style="width:auto" @change="changeDays">
          <option v-for="o in DAY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="adm-btn" type="button" :disabled="loading" @click="refresh">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <!-- ② 必须让运营知道的事实：采集关掉了 / 采样被丢过 -->
    <div v-if="overview && overview.enabled === false" class="adm-note adm-note--warn">
      服务端已经关闭活跃采集（<code>activity.enabled=false</code>），新数据不再写入；
      下面的历史数据仍然照常统计。要恢复采集请改服务端配置并重启服务。
    </div>

    <div v-if="overviewError" class="adm-note adm-note--danger">{{ overviewError }}</div>

    <div v-if="overview" class="adm-note" :class="freshnessWarn ? 'adm-note--warn' : 'adm-note--muted'">
      {{ freshnessText }}
      <template v-if="freshness.last_error">
        · <b>最近一次落库失败：{{ freshness.last_error }}</b>
      </template>
      <template v-if="Number(freshness.dropped_hits || 0) > 0">
        · 已丢弃 {{ num(freshness.dropped_hits) }} 次采样（缓冲溢出，说明写入跟不上请求）
      </template>
      <template v-if="freshness.geo_note"> · {{ freshness.geo_note }}</template>
    </div>

    <!-- ③ 标签页 -->
    <div class="adm-chips">
      <button
        v-for="t in TABS" :key="t.key"
        class="adm-chip" :class="{ on: activeTab === t.key }"
        type="button" @click="switchTab(t.key)"
      >{{ t.label }}</button>
    </div>

    <!-- ============================================================ 总览 -->
    <template v-if="activeTab === 'overview'">
      <div class="adm-kpis">
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">今日活跃用户（DAU）</span>
          <span v-if="overviewLoading && !overview" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(cards.dau) }}</span>
          <span class="adm-kpi__hint">
            {{ cards.day }} · 昨天 {{ num(cards.dau_yesterday) }}（{{ signedPct(cards.dau_change_percent) }}）
          </span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">周活（WAU）</span>
          <span class="adm-kpi__value">{{ num(cards.wau) }}</span>
          <span class="adm-kpi__hint">最近 7 天去重活跃</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">月活（MAU）</span>
          <span class="adm-kpi__value">{{ num(cards.mau) }}</span>
          <span class="adm-kpi__hint">最近 30 天去重活跃</span>
        </div>
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">粘性（DAU / MAU）</span>
          <span class="adm-kpi__value">{{ pct(cards.stickiness) }}</span>
          <span class="adm-kpi__hint">月活里有多少天天来</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内活跃（去重）</span>
          <span class="adm-kpi__value">{{ num(cards.active_users) }}</span>
          <span class="adm-kpi__hint">趋势里逐日数字不能相加，去重值看这里</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内新增</span>
          <span class="adm-kpi__value">{{ num(cards.new_users) }}</span>
          <span class="adm-kpi__hint">{{ window_.from }} ~ {{ window_.to }} 注册</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内请求</span>
          <span class="adm-kpi__value">{{ num(cards.requests) }}</span>
          <span class="adm-kpi__hint">服务端接口调用次数</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内功能使用</span>
          <span class="adm-kpi__value">{{ num(cards.features) }}</span>
          <span class="adm-kpi__hint">接口统计 + 客户端上报，口径见「功能使用」页</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">累计用户</span>
          <span class="adm-kpi__value">{{ num(cards.total_users) }}</span>
          <span class="adm-kpi__hint">活跃率 {{ pct(cards.active_rate) }}（MAU / 累计用户）</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">平均日活</span>
          <span class="adm-kpi__value">{{ cards.avg_dau ?? 0 }}</span>
          <span class="adm-kpi__hint">
            峰值 {{ num(cards.peak_dau) }}<template v-if="cards.peak_dau_day">（{{ cards.peak_dau_day }}）</template>
          </span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">今日新增</span>
          <span class="adm-kpi__value">{{ num(cards.today_new_users) }}</span>
          <span class="adm-kpi__hint">今天注册的用户数</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">今日请求 / 功能</span>
          <span class="adm-kpi__value">{{ num(cards.today_requests) }} / {{ num(cards.today_features) }}</span>
          <span class="adm-kpi__hint">今天累计（活跃 {{ num(cards.today_active_users) }} 人）</span>
        </div>
      </div>

      <!-- 趋势：没有数据的天后端已经补 0，这里直接画 -->
      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>活跃与新增趋势</h2>
          <span class="adm-muted">
            {{ window_.from }} ~ {{ window_.to }}，共 {{ trendCount }} 天（没有数据的天补 0）
          </span>
        </div>

        <div v-if="overviewLoading && !overview" class="adm-skeleton" style="height:150px" />
        <template v-else-if="trendCount">
          <div class="adm-trend">
            <div
              v-for="p in overview.trend" :key="p.day"
              class="adm-trend__col"
              :title="`${p.day}：活跃 ${p.active_users} 人 · 新增 ${p.new_users} 人 · 请求 ${p.requests} · 功能 ${p.features}`"
            >
              <i class="adm-trend__bar" :style="{ height: barHeight(p.active_users) }" />
              <i class="adm-trend__bar adm-trend__bar--new" :style="{ height: barHeight(p.new_users) }" />
            </div>
          </div>
          <div class="adm-trend__axis">
            <span v-for="(p, i) in overview.trend" :key="p.day">
              {{ i % axisStep === 0 ? p.day.slice(5) : '' }}
            </span>
          </div>
          <div class="adm-trend__legend">
            <span><i class="adm-trend__dot" />活跃用户</span>
            <span><i class="adm-trend__dot adm-trend__dot--new" />新增用户</span>
          </div>
        </template>
        <div v-else class="adm-empty">
          <div class="adm-empty__icon"><PixelIcon name="chart" :size="26" /></div>
          <strong>窗口内还没有活跃数据</strong>
          <p>有人在窗口期内调用过需要登录的接口、或前端上报过功能事件之后，这里才会有柱子。</p>
        </div>
      </section>

      <div v-if="overview && (overview.notes || []).length" class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>口径说明</h2></div>
        <ul class="adm-notes">
          <li v-for="(n, i) in overview.notes" :key="i">{{ n }}</li>
        </ul>
      </div>

      <p v-if="overview" class="adm-2xs adm-muted">
        数据生成时间：{{ datetime(overview.generated_at) }}
      </p>
    </template>

    <!-- ========================================================== 访问量 -->
    <template v-else-if="activeTab === 'traffic'">
      <div v-if="trafficError" class="adm-note adm-note--danger">{{ trafficError }}</div>

      <div v-if="traffic && traffic.enabled === false" class="adm-note adm-note--warn">
        服务端已经关闭活跃采集（<code>activity.enabled=false</code>），页面访问上报不会再被记下来；
        下面的历史数据仍然照常统计。
      </div>

      <div v-if="traffic" class="adm-note adm-note--muted">
        访问量（PV）看的是「页面被打开多少次」，访客数（UV）是「多少个浏览器来过」——
        访客标识是浏览器本地随机生成的串，清空浏览器数据 / 换设备 / 无痕窗口都会算成新访客，
        所以 <b>UV 不是人数</b>；这里<b>包含未登录访客</b>，与上面「用户活跃」的口径不同，两边数字不能互相加减。
      </div>

      <div v-if="traffic" class="adm-note" :class="trafficWarn ? 'adm-note--warn' : 'adm-note--muted'">
        {{ trafficFreshnessText }}
        <template v-if="trafficFreshness.last_error">
          · <b>最近一次落库失败：{{ trafficFreshness.last_error }}</b>
        </template>
        <template v-if="Number(trafficFreshness.dropped_visits || 0) > 0">
          · 已丢弃 {{ num(trafficFreshness.dropped_visits) }} 次访问上报（缓冲溢出，说明写入跟不上上报）
        </template>
      </div>

      <div class="adm-kpis">
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">今日访问量（PV）</span>
          <span v-if="trafficLoading && !traffic" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(trafficCards.today_pv) }}</span>
          <span class="adm-kpi__hint">
            {{ trafficCards.day }} · 昨天 {{ num(trafficCards.yesterday_pv) }}（{{ signedPct(trafficCards.pv_change_percent) }}）
          </span>
        </div>
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">今日访客（UV）</span>
          <span class="adm-kpi__value">{{ num(trafficCards.today_uv) }}</span>
          <span class="adm-kpi__hint">其中新访客 {{ num(trafficCards.today_new_visitors) }}</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内访问量（PV）</span>
          <span class="adm-kpi__value">{{ num(trafficCards.pv) }}</span>
          <span class="adm-kpi__hint">趋势里逐日 PV 可以相加（同一个数字就是它）</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内访客（UV）</span>
          <span class="adm-kpi__value">{{ num(trafficCards.uv) }}</span>
          <span class="adm-kpi__hint">去重值，逐日 UV 相加会重复计算回访的人</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">人均访问次数</span>
          <span class="adm-kpi__value">{{ trafficCards.pv_per_uv ?? 0 }}</span>
          <span class="adm-kpi__hint">PV / UV，越大说明来的这批人看得越深</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">新访客 / 回访访客</span>
          <span class="adm-kpi__value">
            {{ num(trafficCards.new_visitors) }} / {{ num(trafficCards.returning_visitors) }}
          </span>
          <span class="adm-kpi__hint">首次出现走的是「第一次访问」的时间</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">登录访客 / 匿名访客</span>
          <span class="adm-kpi__value">
            {{ num(trafficCards.logged_visitors) }} / {{ num(trafficCards.anonymous_visitors) }}
          </span>
          <span class="adm-kpi__hint">按窗口内有没有带登录态访问过划分，两者相加 = UV</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">日均 PV / 日均 UV</span>
          <span class="adm-kpi__value">{{ trafficCards.avg_daily_pv ?? 0 }} / {{ trafficCards.avg_daily_uv ?? 0 }}</span>
          <span class="adm-kpi__hint">窗口内逐日平均，不是去重值</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">峰值 UV</span>
          <span class="adm-kpi__value">{{ num(trafficCards.peak_uv) }}</span>
          <span class="adm-kpi__hint">
            出现在 {{ trafficCards.peak_uv_day || '—' }}
          </span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">累计访客 / 累计访问</span>
          <span class="adm-kpi__value">{{ num(trafficCards.total_visitors) }} / {{ num(trafficCards.total_pv) }}</span>
          <span class="adm-kpi__hint">全时段口径，不受上面的窗口影响</span>
        </div>
      </div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>访问量与访客趋势</h2>
          <span class="adm-muted">
            {{ trafficWindow.from }} ~ {{ trafficWindow.to }}，共 {{ trafficTrend.length }} 天（没有数据的天补 0）
          </span>
        </div>

        <div v-if="trafficLoading && !traffic" class="adm-skeleton" style="height:150px" />
        <template v-else-if="trafficTrend.length">
          <div class="adm-trend">
            <div
              v-for="p in trafficTrend" :key="p.day"
              class="adm-trend__col"
              :title="`${p.day}：访问量 ${p.pv} 次 · 访客 ${p.uv} 人 · 新访客 ${p.new_visitors} 人`"
            >
              <i class="adm-trend__bar" :style="{ height: trafficBarHeight(p.pv) }" />
              <i class="adm-trend__bar adm-trend__bar--new" :style="{ height: trafficBarHeight(p.uv) }" />
            </div>
          </div>
          <div class="adm-trend__axis">
            <span v-for="(p, i) in trafficTrend" :key="p.day">
              {{ i % axisStep === 0 ? p.day.slice(5) : '' }}
            </span>
          </div>
          <div class="adm-trend__legend">
            <span><i class="adm-trend__dot" />访问量（PV）</span>
            <span><i class="adm-trend__dot adm-trend__dot--new" />访客数（UV）</span>
          </div>
        </template>
        <div v-else class="adm-empty">
          <div class="adm-empty__icon"><PixelIcon name="user" :size="26" /></div>
          <strong>窗口内还没有访问记录</strong>
          <p>前台打开任意页面（含未登录访客）都会上报一条，最长一个落库周期后出现在这里。</p>
        </div>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>页面访问排行</h2>
          <span class="adm-muted">按路由模板聚合：/library/:slug 这类详情页会合成一行</span>
        </div>
        <AdminTable
          :columns="pageColumns" :rows="pageRows" :loading="trafficLoading && !traffic"
          row-key="_key" min-width="820px"
          empty-title="窗口内还没有页面访问"
          empty-hint="前台路由切换时会上报页面，落库之后这里才会出现排行。"
        >
          <template #cell-path="{ row }">
            <b>{{ pathLabel(row.path) }}</b>
            <div class="adm-2xs adm-mono adm-muted">{{ row.path }}</div>
          </template>
          <template #cell-pv="{ row }">{{ num(row.pv) }}</template>
          <template #cell-visitors="{ row }">{{ num(row.visitors) }}</template>
          <template #cell-pv_per_visitor="{ row }">{{ row.pv_per_visitor ?? '—' }}</template>
          <template #cell-percent="{ row }">
            {{ pct(row.percent) }}
            <div class="adm-bucketbar"><i :style="{ width: Math.min(100, Number(row.percent || 0)) + '%' }" /></div>
          </template>
          <template #cell-actions="{ row }">
            <button class="adm-btn adm-btn--sm" type="button" @click="filterVisitorsByPath(row.path)">
              看来过的人
            </button>
          </template>
        </AdminTable>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>新访客落地页</h2>
          <span class="adm-muted">窗口内第一次来的访客，最先打开的是哪个页面</span>
        </div>
        <AdminTable
          :columns="landingColumns" :rows="landingRows" :loading="trafficLoading && !traffic"
          row-key="_key" min-width="620px"
          empty-title="窗口内还没有新访客"
          empty-hint="有新的浏览器访问站点之后才会出现落地页分布。"
        >
          <template #cell-path="{ row }">
            <b>{{ pathLabel(row.path) }}</b>
            <div class="adm-2xs adm-mono adm-muted">{{ row.path }}</div>
          </template>
          <template #cell-visitors="{ row }">{{ num(row.visitors) }}</template>
          <template #cell-percent="{ row }">{{ pct(row.percent) }}</template>
        </AdminTable>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>访客来源</h2>
          <span class="adm-muted">按访客的首触渠道（第一次来时的来源），份额按访客数算</span>
        </div>
        <AdminTable
          :columns="trafficSourceColumns" :rows="trafficSourceRows" :loading="trafficLoading && !traffic"
          row-key="_key" min-width="620px"
          empty-title="还没有来源数据"
          empty-hint="落地页带 ?from= / ?utm_source=，或从外部链接进来时才会有渠道。"
        >
          <template #cell-channel="{ row }">
            <b>{{ row.channel_label || '未知来源' }}</b>
            <div v-if="row.channel" class="adm-2xs adm-mono adm-muted">{{ row.channel }}</div>
          </template>
          <template #cell-visitors="{ row }">{{ num(row.visitors) }}</template>
          <template #cell-pv="{ row }">{{ num(row.pv) }}</template>
          <template #cell-percent="{ row }">{{ pct(row.percent) }}</template>
        </AdminTable>
      </section>

      <div class="adm-toolbar">
        <input
          v-model="visitorFilters.path" class="adm-input" style="max-width:220px"
          placeholder="只看访问过某页面的访客（如 /editor）" @keyup.enter="searchVisitors"
        >
        <select v-model="visitorFilters.channel" class="adm-select" @change="searchVisitors">
          <option value="">全部来源</option>
          <option value="direct">直访</option>
          <option value="unknown">未知来源</option>
          <option v-for="c in channelChoices" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-model="visitorFilters.sort" class="adm-select" @change="searchVisitors">
          <option value="page_views">按累计访问量</option>
          <option value="last_seen">按最近访问</option>
          <option value="first_seen">按首次访问</option>
        </select>
        <div class="adm-toolbar__right">
          <button class="adm-btn adm-btn--sm" type="button" :disabled="visitorLoading" @click="searchVisitors">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" :disabled="visitorLoading" @click="resetVisitorFilters">重置</button>
        </div>
      </div>

      <div v-if="visitorError" class="adm-note adm-note--danger">{{ visitorError }}</div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>访客明细</h2>
          <span class="adm-muted">
            访客标识与 IP 都由服务端脱敏后返回；「累计访问」是全时段口径，不受窗口影响
          </span>
        </div>
        <AdminTable
          :columns="visitorColumns" :rows="visitorRowsKeyed" :loading="visitorLoading"
          row-key="_key" min-width="980px"
          empty-title="窗口内没有访客"
          empty-hint="换一个来源筛选，或等前台有人打开页面之后再来看。"
        >
          <template #cell-visitor="{ row }">
            <b v-if="!row.anonymous">{{ row.username }}</b>
            <b v-else>匿名访客</b>
            <div class="adm-2xs adm-mono adm-muted">{{ row.visitor }}</div>
          </template>
          <template #cell-channel="{ row }">{{ row.channel_label || '未知来源' }}</template>
          <template #cell-region="{ row }">
            {{ row.region || '未知' }}
            <div v-if="row.ip" class="adm-2xs adm-muted adm-mono">{{ row.ip }}</div>
          </template>
          <template #cell-page_views="{ row }">{{ num(row.page_views) }}</template>
          <template #cell-last_path="{ row }">
            <span :title="row.last_path">{{ pathLabel(row.last_path) }}</span>
            <div class="adm-2xs adm-muted">首次落在 {{ pathLabel(row.first_path) }}</div>
          </template>
          <template #cell-last_seen_at="{ row }">
            <span :title="datetime(row.last_seen_at)">{{ fromNow(row.last_seen_at) }}</span>
          </template>
        </AdminTable>

        <AdminPager
          v-model:page="visitorPage" v-model:page-size="visitorPageSize" :total="visitorTotal"
          @update:page="reloadVisitors" @update:page-size="reloadVisitors(1)"
        />
      </section>

      <div v-if="traffic && (traffic.notes || []).length" class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>口径说明</h2></div>
        <ul class="adm-notes">
          <li v-for="(n, i) in traffic.notes" :key="i">{{ n }}</li>
        </ul>
      </div>

      <p v-if="traffic" class="adm-2xs adm-muted">
        数据生成时间：{{ datetime(traffic.generated_at) }}
      </p>
    </template>

    <!-- ============================================================ 留存 -->
    <template v-else-if="activeTab === 'retention'">
      <div v-if="tabError" class="adm-note adm-note--danger">{{ tabError }}</div>

      <div class="adm-kpis">
        <div class="adm-kpi">
          <span class="adm-kpi__label">队列用户数</span>
          <span v-if="tabLoading && !tab" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(retentionSummary.cohort_users) }}</span>
          <span class="adm-kpi__hint">{{ num(retentionSummary.cohort_count) }} 个注册日队列</span>
        </div>
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">次日留存</span>
          <span class="adm-kpi__value">{{ pct(retentionSummary.d1_rate) }}</span>
          <span class="adm-kpi__hint">
            {{ num(retentionSummary.d1_users) }} 人 · {{ num(retentionSummary.eligible_d1) }} 个队列已过完第 1 天
          </span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">3 日留存</span>
          <span class="adm-kpi__value">{{ pct(retentionSummary.d3_rate) }}</span>
          <span class="adm-kpi__hint">
            {{ num(retentionSummary.d3_users) }} 人 · {{ num(retentionSummary.eligible_d3) }} 个队列已过完第 3 天
          </span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">7 日留存</span>
          <span class="adm-kpi__value">{{ pct(retentionSummary.d7_rate) }}</span>
          <span class="adm-kpi__hint">
            {{ num(retentionSummary.d7_users) }} 人 · {{ num(retentionSummary.eligible_d7) }} 个队列已过完第 7 天
          </span>
        </div>
      </div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>按注册日队列的留存</h2>
          <span class="adm-muted">第 0 天 = 注册当天；比率只统计已过完对应天数的队列</span>
        </div>
        <AdminTable
          :columns="cohortColumns"
          :rows="cohortRows"
          :loading="tabLoading && !tab"
          row-key="_key"
          min-width="720px"
          empty-title="窗口内还没有新注册用户"
          empty-hint="有用户在这个统计窗口里注册之后，才会出现留存队列。"
        >
          <template #cell-d1="{ row }">
            <span v-if="row.d1_eligible">{{ num(row.d1_users) }}（{{ pct(row.d1_rate) }}）</span>
            <span v-else class="adm-muted" title="队列还没过完第 1 天，显示 — 而不是 0">—</span>
          </template>
          <template #cell-d3="{ row }">
            <span v-if="row.d3_eligible">{{ num(row.d3_users) }}（{{ pct(row.d3_rate) }}）</span>
            <span v-else class="adm-muted" title="队列还没过完第 3 天，显示 — 而不是 0">—</span>
          </template>
          <template #cell-d7="{ row }">
            <span v-if="row.d7_eligible">{{ num(row.d7_users) }}（{{ pct(row.d7_rate) }}）</span>
            <span v-else class="adm-muted" title="队列还没过完第 7 天，显示 — 而不是 0">—</span>
          </template>
        </AdminTable>
      </section>

      <div v-if="tab && (tab.notes || []).length" class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>口径说明</h2></div>
        <ul class="adm-notes"><li v-for="(n, i) in tab.notes" :key="i">{{ n }}</li></ul>
      </div>
    </template>

    <!-- ======================================================== 使用频率 -->
    <template v-else-if="activeTab === 'frequency'">
      <div v-if="tabError" class="adm-note adm-note--danger">{{ tabError }}</div>

      <div class="adm-kpis">
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内活跃用户</span>
          <span v-if="tabLoading && !tab" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(tab && tab.active_users) }}</span>
          <span class="adm-kpi__hint">{{ window_.from }} ~ {{ window_.to }} 去重</span>
        </div>
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">平均活跃天数</span>
          <span class="adm-kpi__value">{{ (tab && tab.avg_active_days) ?? 0 }}</span>
          <span class="adm-kpi__hint">活跃用户的平均值</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">中位活跃天数</span>
          <span class="adm-kpi__value">{{ (tab && tab.median_active_days) ?? 0 }}</span>
          <span class="adm-kpi__hint">分桶的左边界，桶内没有更细的分布</span>
        </div>
      </div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>活跃天数分布</h2>
          <span class="adm-muted">「仅 1 天」这一档最需要关注：拉新没留住</span>
        </div>
        <AdminTable
          :columns="bucketColumns"
          :rows="bucketRows"
          :loading="tabLoading && !tab"
          row-key="_key"
          min-width="560px"
          empty-title="窗口内还没有活跃用户"
          empty-hint="统计窗口内没有任何用户产生活跃记录。"
        >
          <template #cell-label="{ row }">
            <span class="adm-strong">{{ row.label }}</span>
            <div class="adm-bucketbar"><i :style="{ width: Math.min(100, Number(row.percent || 0)) + '%' }" /></div>
          </template>
        </AdminTable>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>最活跃的用户</h2>
          <span class="adm-muted">按窗口内活跃天数排序</span>
        </div>
        <AdminTable
          :columns="topUserColumns"
          :rows="frequencyTop"
          :loading="tabLoading && !tab"
          row-key="user_id"
          min-width="720px"
          empty-title="还没有活跃用户"
          empty-hint="窗口内没有用户产生活跃记录。"
        >
          <template #cell-username="{ row }">
            <b>{{ row.nickname || row.username }}</b>
            <span class="adm-muted"> {{ row.username }}</span>
          </template>
          <template #cell-actions="{ row }">
            <button class="adm-btn adm-btn--sm" type="button" @click="openUser(row.user_id)">查看明细</button>
          </template>
        </AdminTable>
      </section>

      <div v-if="tab && (tab.notes || []).length" class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>口径说明</h2></div>
        <ul class="adm-notes"><li v-for="(n, i) in tab.notes" :key="i">{{ n }}</li></ul>
      </div>
    </template>

    <!-- ============================================================ 地区 -->
    <template v-else-if="activeTab === 'regions'">
      <div v-if="tabError" class="adm-note adm-note--danger">{{ tabError }}</div>

      <div class="adm-kpis">
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内活跃用户</span>
          <span v-if="tabLoading && !tab" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(tab && tab.active_users) }}</span>
          <span class="adm-kpi__hint">百分比的分母</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">地区未知</span>
          <span class="adm-kpi__value">{{ num(tab && tab.unknown_users) }}</span>
          <span class="adm-kpi__hint">IP 未收录 / 境外 / 内网地址</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">地区解析</span>
          <span class="adm-kpi__value">{{ tab && tab.geo_enabled ? '可用' : '不可用' }}</span>
          <span class="adm-kpi__hint">本地 ip2region 数据文件是否加载成功</span>
        </div>
      </div>

      <div v-if="tab && !tab.geo_enabled" class="adm-note adm-note--warn">
        地区解析不可用（数据文件缺失或路径不对），所以下面所有用户都会落到「未知」。
        修复方法见服务端 <code>docs/activity.md</code> §4。
      </div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>省份 / 直辖市</h2>
          <span class="adm-muted">按活跃用户数排序；「未知」占比 = 100% − 各省之和</span>
        </div>
        <AdminTable
          :columns="provinceColumns" :rows="provinceRows"
          :loading="tabLoading && !tab" row-key="_key" min-width="640px"
          empty-title="窗口内没有可解析的地区数据"
          empty-hint="IP 全部落在未收录网段、或地区解析不可用时，这里会是空的。"
        >
          <template #cell-region="{ row }">{{ regionLabel(row) }}</template>
        </AdminTable>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>城市</h2><span class="adm-muted">境外数据会带国家名</span></div>
        <AdminTable
          :columns="cityColumns" :rows="cityRows"
          :loading="tabLoading && !tab" row-key="_key" min-width="720px"
          empty-title="还没有到城市一级的数据" empty-hint=""
        >
          <template #cell-region="{ row }">{{ regionLabel(row) }}</template>
          <template #cell-city="{ row }">{{ row.city || '—' }}</template>
        </AdminTable>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>运营商 / 网络</h2>
          <span class="adm-muted">用来判断网络环境，不是业务指标</span>
        </div>
        <AdminTable
          :columns="ispColumns" :rows="ispRows"
          :loading="tabLoading && !tab" row-key="_key" min-width="560px"
          empty-title="还没有运营商数据" empty-hint=""
        >
          <template #cell-isp="{ row }">{{ row.isp || '未知' }}</template>
        </AdminTable>
      </section>

      <div v-if="tab && (tab.notes || []).length" class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>口径说明</h2></div>
        <ul class="adm-notes"><li v-for="(n, i) in tab.notes" :key="i">{{ n }}</li></ul>
      </div>
    </template>

    <!-- ======================================================== 功能使用 -->
    <template v-else-if="activeTab === 'features'">
      <div v-if="tabError" class="adm-note adm-note--danger">{{ tabError }}</div>

      <div class="adm-note adm-note--muted">
        同一个功能点会按来源拆成两行：<b>接口统计</b>是服务端按接口调用自动记的，
        <b>客户端上报</b>是前端调 <code>POST /api/v1/events</code> 报上来的浏览器内行为
        （生成图纸、导出、抠图等）。两者口径不同，<b>不做合并</b>。
      </div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>功能使用排行</h2>
          <span class="adm-muted">按使用人数排序，最多 30 条</span>
        </div>
        <AdminTable
          :columns="featureColumns" :rows="featureRows"
          :loading="tabLoading && !tab" row-key="_key" min-width="720px"
          empty-title="窗口内还没有功能使用记录"
          empty-hint="用户调用需要登录的接口、或前端接入埋点上报后，这里才会有数据。"
        >
          <template #cell-feature="{ row }">
            <b>{{ row.feature_label || row.feature }}</b>
            <div class="adm-2xs adm-mono adm-muted">{{ row.feature }}</div>
          </template>
          <template #cell-source="{ row }">
            <AdminTag
              :text="row.source_label || row.source"
              :kind="row.source === 'client' ? 'info' : 'primary'"
            />
          </template>
          <template #cell-count="{ row }">{{ num(row.count) }}</template>
        </AdminTable>
      </section>

      <div v-if="tab && (tab.notes || []).length" class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>口径说明</h2></div>
        <ul class="adm-notes"><li v-for="(n, i) in tab.notes" :key="i">{{ n }}</li></ul>
      </div>
    </template>

    <!-- ======================================================== 来源渠道 -->
    <template v-else-if="activeTab === 'channels'">
      <div v-if="tabError" class="adm-note adm-note--danger">{{ tabError }}</div>

      <div class="adm-kpis">
        <div class="adm-kpi">
          <span class="adm-kpi__label">窗口内新增用户</span>
          <span v-if="tabLoading && !tab" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(tab && tab.total_new_users) }}</span>
          <span class="adm-kpi__hint">各渠道之和</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">有归因的渠道数</span>
          <span class="adm-kpi__value">{{ ((tab && tab.items) || []).filter(i => i.channel).length }}</span>
          <span class="adm-kpi__hint">另有「未知来源」= 首触归因之前的历史用户</span>
        </div>
      </div>

      <div class="adm-note adm-note--muted">
        渠道 = 注册时的<b>首次来源</b>（首触归因），注册之后不再改写。
        <b>窗口内新增</b>是本窗口的数字；<b>累计用户 / 活跃率</b>是全时段口径，
        用来判断某个渠道带来的量有没有留下来用。
      </div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>渠道质量</h2><span class="adm-muted">按窗口内新增排序</span></div>
        <AdminTable
          :columns="channelColumns" :rows="(tab && tab.items) || []"
          :loading="tabLoading && !tab" row-key="channel" min-width="880px"
          empty-title="还没有渠道数据"
          empty-hint="用户从前台注册时会带来源（utm / referrer / 站点），之后这里才会分组。"
        >
          <template #cell-channel="{ row }">
            <b>{{ row.channel_label || row.channel || '未知来源' }}</b>
            <div v-if="row.channel" class="adm-2xs adm-mono adm-muted">{{ row.channel }}</div>
          </template>
          <template #cell-active_rate="{ row }">{{ pct(row.active_rate) }}</template>
          <template #cell-paid_amount="{ row }">{{ money(row.paid_amount) }}</template>
          <template #cell-actions="{ row }">
            <button
              v-if="row.channel"
              class="adm-btn adm-btn--sm" type="button"
              @click="userFilters.channel = row.channel; switchTab('users')"
            >看这个渠道的用户</button>
            <span v-else class="adm-muted adm-2xs">—</span>
          </template>
        </AdminTable>
      </section>

      <div v-if="tab && (tab.notes || []).length" class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>口径说明</h2></div>
        <ul class="adm-notes"><li v-for="(n, i) in tab.notes" :key="i">{{ n }}</li></ul>
      </div>
    </template>

    <!-- ======================================================== 用户明细 -->
    <template v-else>
      <div class="adm-toolbar">
        <input
          v-model="userFilters.keyword" class="adm-input" placeholder="搜索用户名 / 昵称"
          @keyup.enter="searchUsers"
        >
        <select v-model="userFilters.channel" class="adm-select" @change="searchUsers">
          <option value="">全部渠道</option>
          <option value="direct">直访</option>
          <option value="unknown">未知来源</option>
          <option v-for="c in channelChoices" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-model="userFilters.min_active_days" class="adm-select" @change="searchUsers">
          <option value="">不限活跃天数（含沉默用户）</option>
          <option value="1">只看活跃用户（≥1 天）</option>
          <option value="3">≥ 3 天</option>
          <option value="7">≥ 7 天</option>
          <option value="15">≥ 15 天</option>
        </select>
        <input
          v-model="userFilters.province" class="adm-input" style="max-width:150px"
          placeholder="省份（如 重庆市）" @keyup.enter="searchUsers"
        >
        <select v-model="userFilters.sort" class="adm-select" @change="searchUsers">
          <option value="active_days">按活跃天数</option>
          <option value="requests">按请求次数</option>
          <option value="features">按功能次数</option>
          <option value="last_active">按最近活跃</option>
          <option value="newest">按注册时间</option>
        </select>
        <div class="adm-toolbar__right">
          <button class="adm-btn adm-btn--sm" type="button" :disabled="usersLoading" @click="searchUsers">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" :disabled="usersLoading" @click="resetUserFilters">重置</button>
        </div>
      </div>

      <div v-if="usersError" class="adm-note adm-note--danger">{{ usersError }}</div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>活跃用户</h2>
          <span class="adm-muted">
            默认会带出窗口内<b>零活跃的沉默用户</b>（活跃天数为 0），用来排查「注册了但一次没用」
          </span>
        </div>
        <AdminTable
          :columns="userColumns" :rows="rows" :loading="usersLoading" row-key="user_id"
          min-width="980px"
          empty-title="没有符合条件的用户"
          empty-hint="换个渠道 / 省份筛选，或把「不限活跃天数（含沉默用户）」恢复成默认再看看。"
        >
          <template #cell-username="{ row }">
            <b>{{ row.nickname || row.username }}</b>
            <div class="adm-2xs adm-muted adm-mono">{{ row.username }} · #{{ row.user_id }}</div>
          </template>
          <template #cell-channel="{ row }">{{ row.channel_label || row.channel || '未知来源' }}</template>
          <template #cell-region="{ row }">
            {{ row.region || '未知' }}
            <div v-if="row.last_ip" class="adm-2xs adm-muted adm-mono">{{ row.last_ip }}</div>
          </template>
          <template #cell-active_days="{ row }">
            <span :class="{ 'adm-muted': !row.active_days }">{{ num(row.active_days) }}</span>
          </template>
          <template #cell-last_active_at="{ row }">
            <span v-if="row.last_active_at" :title="datetime(row.last_active_at)">{{ fromNow(row.last_active_at) }}</span>
            <span v-else class="adm-muted">从未活跃</span>
          </template>
          <template #cell-created_at="{ row }">
            <span :title="datetime(row.created_at)">{{ datetime(row.created_at, { withTime: false }) }}</span>
          </template>
          <template #cell-actions="{ row }">
            <button class="adm-btn adm-btn--sm" type="button" @click="openUser(row.user_id)">明细</button>
          </template>
        </AdminTable>

        <AdminPager
          v-model:page="page" v-model:page-size="pageSize" :total="total"
          @update:page="reloadUsers" @update:page-size="reloadUsers(1)"
        />
      </section>
    </template>

    <!-- ⑤ 用户详情弹窗 -->
    <AdminModal v-model="detailOpen" title="用户活跃明细" size="lg">
      <div v-if="detailLoading" class="adm-skeleton" style="height:220px" />
      <div v-else-if="detailError" class="adm-note adm-note--danger">{{ detailError }}</div>

      <template v-else-if="detail">
        <div class="adm-kpis">
          <div class="adm-kpi">
            <span class="adm-kpi__label">用户</span>
            <span class="adm-kpi__value" style="font-size:15px">
              {{ detail.user.nickname || detail.user.username }}
            </span>
            <span class="adm-kpi__hint adm-mono">{{ detail.user.username }} · #{{ detail.user.user_id }}</span>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi__label">渠道</span>
            <span class="adm-kpi__value" style="font-size:15px">
              {{ detail.user.channel_label || detail.user.channel || '未知来源' }}
            </span>
            <span class="adm-kpi__hint" :title="detail.channel_detail || ''">
              {{ detail.channel_detail || '没有留下来源原始值' }}
            </span>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi__label">窗口内活跃天数</span>
            <span class="adm-kpi__value">{{ num(detail.user.active_days) }}</span>
            <span class="adm-kpi__hint">{{ detail.window.from }} ~ {{ detail.window.to }}</span>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi__label">全时段累计</span>
            <span class="adm-kpi__value" style="font-size:15px">
              {{ num(detail.total_active_days) }} 天 · {{ num(detail.total_requests) }} 请求
            </span>
            <span class="adm-kpi__hint">
              功能 {{ num(detail.total_features) }} 次 · 首次活跃 {{ detail.first_active_day || '—' }}
            </span>
          </div>
        </div>

        <h2 style="margin-top:14px">逐日活跃</h2>
        <AdminTable
          :columns="dailyColumns" :rows="detail.daily || []" row-key="day" min-width="880px"
          empty-title="窗口内没有活跃记录"
          empty-hint="用户存在，但统计窗口里没有产生需要登录的活跃行为。"
        >
          <template #cell-requests="{ row }">{{ num(row.requests) }}</template>
          <template #cell-features="{ row }">{{ num(row.features) }}</template>
          <template #cell-first_active_at="{ row }">{{ datetime(row.first_active_at) }}</template>
          <template #cell-last_active_at="{ row }">{{ datetime(row.last_active_at) }}</template>
          <template #cell-region="{ row }">
            {{ [row.province, row.city].filter(Boolean).join(' ') || '未知' }}
          </template>
          <template #cell-isp="{ row }">{{ row.isp || '—' }}</template>
          <template #cell-ip="{ row }"><span class="adm-mono">{{ row.ip || '—' }}</span></template>
        </AdminTable>

        <h2 style="margin-top:14px">功能明细（窗口内）</h2>
        <AdminTable
          :columns="detailFeatureColumns" :rows="detailFeatureRows"
          row-key="_key" min-width="620px"
          empty-title="窗口内没有功能使用记录" empty-hint=""
        >
          <template #cell-feature="{ row }">
            <b>{{ row.feature_label || row.feature }}</b>
            <div class="adm-2xs adm-mono adm-muted">{{ row.feature }}</div>
          </template>
          <template #cell-source="{ row }">
            <AdminTag :text="row.source_label || row.source" :kind="row.source === 'client' ? 'info' : 'primary'" />
          </template>
          <template #cell-count="{ row }">{{ num(row.count) }}</template>
        </AdminTable>

        <h2 style="margin-top:14px">地区明细（窗口内）</h2>
        <AdminTable
          :columns="detailRegionColumns" :rows="detailRegionRows"
          row-key="_key" min-width="620px"
          empty-title="窗口内没有地区记录" empty-hint=""
        >
          <template #cell-region="{ row }">{{ regionLabel(row) }}</template>
          <template #cell-city="{ row }">{{ row.city || '—' }}</template>
          <template #cell-isp="{ row }">{{ row.isp || '—' }}</template>
          <template #cell-users="{ row }">{{ num(row.users) }}</template>
          <template #cell-requests="{ row }">{{ num(row.requests) }}</template>
        </AdminTable>

        <ul v-if="(detail.notes || []).length" class="adm-notes" style="margin-top:12px">
          <li v-for="(n, i) in detail.notes" :key="i">{{ n }}</li>
        </ul>

        <p class="adm-2xs adm-muted" style="margin-top:10px">
          IP 由服务端脱敏后返回（完整 IP 只存在数据库里用于地区统计）；「全时段累计」不受窗口限制。
        </p>
      </template>
    </AdminModal>
  </div>
</template>

<style scoped>
/* 趋势柱状图：纯 CSS，不引第三方图表库（项目只有 vue + vue-router）。
   活跃用户用品牌渐变，新增用户用品牌黄，两者同轴不同色，避免被读成同一个量。 */
.adm-trend {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 150px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.adm-trend__col {
  flex: 1 0 12px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  height: 100%;
}

.adm-trend__bar {
  width: 6px;
  border-radius: 3px 3px 0 0;
  background: var(--grad);
  min-height: 2px;
}

.adm-trend__bar--new {
  width: 5px;
  background: var(--yellow);
}

.adm-trend__axis {
  display: flex;
  gap: 3px;
  margin-top: 6px;
  overflow-x: auto;
}

.adm-trend__axis span {
  flex: 1 0 12px;
  font-size:var(--fs-2xs);
  color: var(--muted);
  text-align: center;
  white-space: nowrap;
}

.adm-trend__legend {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  font-size: var(--fs-2xs);
  color: var(--muted);
}

.adm-trend__dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 5px;
  border-radius: 2px;
  background: var(--grad);
}

.adm-trend__dot--new {
  background: var(--yellow);
}

/* 分桶进度条：用同一套品牌主色，和表格里的数字互相印证 */
.adm-bucketbar {
  margin-top: 5px;
  height: 4px;
  border-radius: 99px;
  background: var(--surface-2);
  overflow: hidden;
}

.adm-bucketbar i {
  display: block;
  height: 100%;
  background: var(--primary);
}

.adm-notes {
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: var(--fs-2xs);
}

.adm-notes li {
  margin: 4px 0;
}

.adm-modal__body h2 {
  font-size: var(--fs-sm);
}
</style>
