<script setup>
/* =========================================================================
   SEO 管理（后台）
   - 对应后端 douwan-api/internal/handler/seo.go 的 /api/v1/admin/seo/*
   - 口径红线：这里的「已提交 / 失败 / 待推送」全部是**我们发出的通知**。
     没有接搜索引擎官方数据接口之前，收录数与排名是拿不到的，
     所以页面上一律不出现「收录数」这种词。
   - 写操作（手动推送 / 改文案）需要 seo.manage；只读账号看得到、点不动，
     并给出原因（见 useAdminAuth.can / denyReason）。
   ========================================================================= */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, datetime, syncQuery } from '../../lib/api.js'
import { seoApi } from '../../lib/adminApi.js'
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import AdminSeoKeywords from './AdminSeoKeywords.vue'
import { can } from '../../composables/useAdminAuth.js'
import { toastErr, toastOk } from '../../composables/useToast.js'
import { copyWithToast, run } from '../../composables/useAdminKit.js'

const route = useRoute()
const router = useRouter()

/* ------------------------------------------------------------------ 标签页 */

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'pages', label: '页面清单' },
  { key: 'keywords', label: '关键词管理' },
  { key: 'tasks', label: '推送历史' },
  { key: 'config', label: '配置与推送' }
]

const activeTab = ref('overview')

/* ------------------------------------------------------------------ 数据 */

const overview = ref(null)
const overviewLoading = ref(false)
const overviewError = ref('')

const pages = ref([])
const pagesLoading = ref(false)
const pagesError = ref('')
const pageFilter = reactive({ kind: '', keyword: '' })

const tasks = ref([])
const taskTotal = ref(0)
const taskPage = ref(1)
const taskPageSize = ref(20)
const tasksLoading = ref(false)
const tasksError = ref('')
const taskFilter = reactive({ engine: '', status: '', keyword: '' })

const config = ref(null)
const configLoading = ref(false)

const canManage = computed(() => can('seo.manage'))

const loading = computed(() =>
  overviewLoading.value || pagesLoading.value || tasksLoading.value || configLoading.value)

/* ------------------------------------------------------------------ 概览计算 */

const engines = computed(() => (overview.value && overview.value.engines) || [])

function engineBy(name) {
  return engines.value.find(e => e && e.engine === name) || null
}

const baidu = computed(() => engineBy('baidu'))
const indexNow = computed(() => engineBy('indexnow'))
const google = computed(() => engineBy('google'))

const taskStats = computed(() => (overview.value && overview.value.tasks) || {})

const lastCheck = computed(() => (overview.value && overview.value.last_check) || null)
const checkIssues = computed(() => (lastCheck.value && lastCheck.value.issues) || [])

/** 页面清单里被标成 noindex 的数量（这些页面不会被搜索引擎收录） */
const noIndexCount = computed(() => pages.value.filter(p => p.noindex).length)

/** 还没推过的页面数 */
const notPushedCount = computed(() => pages.value.filter(p => p.push_state === 'none').length)

/* ------------------------------------------------------------------ 地址栏同步 */

function syncFilters(extra = {}) {
  syncQuery(router, route, {
    tab: activeTab.value === 'overview' ? '' : activeTab.value,
    kind: pageFilter.kind,
    pkeyword: pageFilter.keyword.trim(),
    engine: taskFilter.engine,
    status: taskFilter.status,
    keyword: taskFilter.keyword.trim(),
    page: taskPage.value > 1 ? String(taskPage.value) : '',
    page_size: taskPage.value > 1 || taskPageSize.value !== 20 ? String(taskPageSize.value) : '',
    ...extra
  })
}

function readQuery() {
  const q = key => {
    const v = route.query[key]
    return Array.isArray(v) ? v[0] : (v || '')
  }
  const tabKey = q('tab')
  if (TABS.some(t => t.key === tabKey)) activeTab.value = tabKey

  pageFilter.kind = q('kind')
  pageFilter.keyword = q('pkeyword')

  taskFilter.engine = q('engine')
  taskFilter.status = q('status')
  taskFilter.keyword = q('keyword')

  const p = parseInt(q('page'), 10)
  if (!Number.isNaN(p) && p > 0) taskPage.value = p
  const size = parseInt(q('page_size'), 10)
  if ([10, 20, 50, 100].includes(size)) taskPageSize.value = size
}

/* ------------------------------------------------------------------ 加载 */

async function loadOverview() {
  overviewLoading.value = true
  overviewError.value = ''
  try {
    overview.value = await seoApi.overview()
  } catch (e) {
    overviewError.value = e instanceof ApiError ? e.message : '概览加载失败，请重试'
    overview.value = null
  } finally {
    overviewLoading.value = false
  }
}

async function loadPages() {
  pagesLoading.value = true
  pagesError.value = ''
  try {
    const list = await seoApi.pages({ limit: 2000 })
    pages.value = Array.isArray(list) ? list : []
  } catch (e) {
    pagesError.value = e instanceof ApiError ? e.message : '页面清单加载失败，请重试'
    pages.value = []
  } finally {
    pagesLoading.value = false
  }
}

async function loadTasks(toPage = taskPage.value) {
  taskPage.value = Math.max(1, toPage || 1)
  tasksLoading.value = true
  tasksError.value = ''
  try {
    const data = await seoApi.tasks({
      engine: taskFilter.engine,
      status: taskFilter.status,
      keyword: taskFilter.keyword.trim(),
      limit: taskPageSize.value
    })
    tasks.value = (data && data.list) || []
    taskTotal.value = (data && data.total) || 0
  } catch (e) {
    tasksError.value = e instanceof ApiError ? e.message : '推送历史加载失败，请重试'
    tasks.value = []
    taskTotal.value = 0
  } finally {
    tasksLoading.value = false
  }
}

async function loadConfig() {
  configLoading.value = true
  try {
    config.value = await seoApi.config()
  } catch (e) {
    config.value = null
  } finally {
    configLoading.value = false
  }
}

function switchTab(key) {
  activeTab.value = key
  taskPage.value = 1
  syncFilters()
  if (key === 'overview') loadOverview()
  else if (key === 'pages') loadPages()
  else if (key === 'tasks') loadTasks(1)
  else if (key === 'config') loadConfig()
}

function refresh() {
  loadOverview()
  loadPages()
  loadTasks(taskPage.value)
  loadConfig()
}

/* ------------------------------------------------------------------ 推送历史筛选 */

function searchTasks() {
  syncFilters({ page: 1 })
  loadTasks(1)
}

function resetTasks() {
  taskFilter.engine = ''
  taskFilter.status = ''
  taskFilter.keyword = ''
  syncFilters({ page: 1 })
  loadTasks(1)
}

function changeTaskPage(p) {
  syncFilters({ page: p })
  loadTasks(p)
}

function changeTaskPageSize(size) {
  taskPageSize.value = size
  syncFilters({ page: 1, page_size: size })
  loadTasks(1)
}

/* ------------------------------------------------------------------ 页面清单筛选（前端过滤，列表已经全量拉回来） */

const filteredPages = computed(() => {
  const kw = pageFilter.keyword.trim().toLowerCase()
  return pages.value.filter(p => {
    if (pageFilter.kind && p.kind !== pageFilter.kind) return false
    if (!kw) return true
    return (
      String(p.path || '').toLowerCase().includes(kw) ||
      String(p.title || '').toLowerCase().includes(kw) ||
      String(p.source_name || '').toLowerCase().includes(kw)
    )
  })
})

const KIND_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'home', label: '首页' },
  { value: 'materials', label: '素材中心' },
  { value: 'material_category', label: '素材分类' },
  { value: 'material', label: '素材详情' },
  { value: 'tool', label: '工具页' },
  { value: 'help', label: '教程页' }
]

/* ------------------------------------------------------------------ 编辑 SEO 文案 */

const editOpen = ref(false)
const editSaving = ref(false)
const editTarget = ref(null)
const editForm = reactive({ seo_title: '', seo_description: '', seo_noindex: false })

/** 只能改素材 / 分类（静态页的文案在代码里，改了会被覆盖） */
function canEdit(row) {
  return row && (row.kind === 'material' || row.kind === 'material_category')
}

function openEdit(row) {
  if (!canEdit(row)) return
  editTarget.value = row
  editForm.seo_title = row.title || ''
  editForm.seo_description = row.description || ''
  editForm.seo_noindex = !!row.noindex
  editOpen.value = true
}

async function saveEdit() {
  if (!editTarget.value) return
  editSaving.value = true
  try {
    await seoApi.updatePage(editTarget.value.kind, editTarget.value.source_id, {
      seo_title: editForm.seo_title.trim(),
      seo_description: editForm.seo_description.trim(),
      seo_noindex: editForm.seo_noindex
    })
    toastOk('已保存，页面会立即更新并进入推送队列')
    editOpen.value = false
    await Promise.all([loadPages(), loadOverview()])
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '保存失败，请重试')
  } finally {
    editSaving.value = false
  }
}

/* ------------------------------------------------------------------ 手动推送 */

const pushOpen = ref(false)
const pushSaving = ref(false)
const pushForm = reactive({
  paths: '',
  all: false,
  engines: [],
  action: 'submit',
  force: false
})

const pushEngines = [
  { value: 'baidu', label: '百度（普通收录 API）' },
  { value: 'indexnow', label: 'IndexNow（Bing 等）' }
]

function openPush(row) {
  pushForm.paths = row ? row.path : ''
  pushForm.all = false
  pushForm.engines = []
  pushForm.action = 'submit'
  // 单页手动补推 = 运营明确要求再推一次，不受「内容未变化就跳过」限制；
  // 批量补推历史页面 = 只补没推过的，保持默认的跳过策略。
  pushForm.force = !!row
  pushOpen.value = true
}

function toggleEngine(value) {
  const i = pushForm.engines.indexOf(value)
  if (i >= 0) pushForm.engines.splice(i, 1)
  else pushForm.engines.push(value)
}

async function doPush() {
  const paths = pushForm.paths
    .split(/[\s,，]+/)
    .map(s => s.trim())
    .filter(Boolean)

  if (!pushForm.all && !paths.length) {
    toastErr('请填写要推送的页面路径，或勾选「全部页面」')
    return
  }
  if (paths.some(p => !p.startsWith('/'))) {
    toastErr('路径要以 / 开头，例如 /materials/xxx/')
    return
  }

  pushSaving.value = true
  const res = await run(
    () => seoApi.push({
      paths,
      all: pushForm.all,
      engines: pushForm.engines,
      action: pushForm.action,
      force: pushForm.force
    }),
    { ok: '已入队并执行推送' }
  )
  pushSaving.value = false
  if (!res) return

  const queued = res.queued || {}
  const skipped = queued.skipped_reasons || []
  if (skipped.length) {
    toastOk(`已提交 ${queued.created || 0} 条，跳过 ${queued.skipped || 0} 条`)
  }
  pushOpen.value = false
  await Promise.all([loadOverview(), loadTasks(1)])
}

/* ------------------------------------------------------------------ 立即巡检 */

const checkBusy = ref(false)

async function doCheck() {
  checkBusy.value = true
  const res = await run(() => seoApi.check(), { ok: '巡检完成' })
  checkBusy.value = false
  if (!res) return
  await loadOverview()
}

/* ------------------------------------------------------------------ 重算自动文案 */

const regenBusy = ref(false)

/**
 * 按模板重算素材 / 分类的自动 SEO 文案。
 * 人工写过的文案不会被覆盖（后端按 seo_auto 标记判断）。
 */
async function doRegenerate() {
  regenBusy.value = true
  const res = await run(() => seoApi.regenerate(), { ok: '自动文案已重算' })
  regenBusy.value = false
  if (!res) return
  toastOk(
    `重写素材 ${res.materials || 0} 个、分类 ${res.categories || 0} 个；人工文案保留 ${res.manual_kept || 0} 个`
  )
  await Promise.all([loadPages(), loadOverview()])
}

/* ------------------------------------------------------------------ 复制地址 */

function copy(text, label) {
  copyWithToast(text, `${label}已复制`)
}

/* ------------------------------------------------------------------ 展示辅助 */

function num(v) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN')
}

/** 推送状态 → 标签颜色 */
function pushStateKind(state) {
  return {
    success: 'ok',
    failed: 'danger',
    pending: 'warn',
    running: 'info',
    skipped: 'muted'
  }[state] || 'muted'
}

function pushStateText(state) {
  return {
    success: '已提交',
    failed: '失败',
    pending: '待推送',
    running: '推送中',
    skipped: '已跳过'
  }[state] || '未推送'
}

function taskStatusKind(status) {
  return {
    success: 'ok',
    failed: 'danger',
    pending: 'warn',
    running: 'info',
    skipped: 'muted'
  }[status] || 'muted'
}

/** 引擎卡片：配置没配好的时候给一句人话 */
function engineHint(e) {
  if (!e) return ''
  if (!e.configured) return e.message || '未配置'
  return e.message || '已配置'
}

/* ------------------------------------------------------------------ 列定义 */

const pageColumns = [
  { key: 'path', label: '页面路径', width: '260px' },
  { key: 'kind_name', label: '类型', width: '92px' },
  { key: 'title', label: 'SEO 标题' },
  { key: 'push_state', label: '推送状态', width: '92px' },
  { key: 'lastmod', label: '更新时间', width: '140px', nowrap: true },
  { key: 'actions', label: '操作', width: '150px', align: 'right' }
]

const taskColumns = [
  { key: 'queued_at', label: '入队时间', width: '140px', nowrap: true },
  { key: 'url', label: '页面' },
  { key: 'engine_name', label: '引擎', width: '92px' },
  { key: 'status_name', label: '状态', width: '92px' },
  { key: 'attempts', label: '尝试', width: '60px', align: 'right' },
  { key: 'last_error', label: '失败原因 / 返回' },
  { key: 'actions', label: '操作', width: '80px', align: 'right' }
]

const recentColumns = [
  { key: 'queued_at', label: '入队时间', width: '140px', nowrap: true },
  { key: 'url', label: '页面' },
  { key: 'engine_name', label: '引擎', width: '92px' },
  { key: 'status_name', label: '状态', width: '92px' }
]

/* ------------------------------------------------------------------ 生命周期 */

onMounted(() => {
  readQuery()
  loadOverview()
  loadPages()
  loadConfig()
  if (activeTab.value === 'tasks') loadTasks(taskPage.value)
})
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>SEO 管理</h1>
        <p>
          管的是「让搜索引擎找得到豆玩」这件事：可索引页面清单、Sitemap 状态、
          以及发给百度 / IndexNow 的通知记录。发布素材后系统会自动入队推送。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="refresh">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button
          v-if="canManage"
          class="adm-btn adm-btn--sm adm-btn--primary"
          type="button"
          :disabled="checkBusy"
          @click="doCheck"
        >
          {{ checkBusy ? '巡检中…' : '立即巡检' }}
        </button>
        <button
          v-if="canManage"
          class="adm-btn adm-btn--sm adm-btn--primary"
          type="button"
          @click="openPush(null)"
        >手动推送</button>
      </div>
    </div>

    <!-- 口径说明：放在最上面，避免把「已提交」当成「已收录」 -->
    <div class="adm-note adm-note--muted">
      <b>「已提交」只代表我们把通知发给了搜索引擎</b>，不代表页面已被抓取、被收录，更不代表有排名。
      收录与排名需要接入站长平台官方数据接口后才能展示，本页不提供这两个数字。
    </div>

    <div class="adm-chips">
      <button
        v-for="t in TABS" :key="t.key"
        class="adm-chip" :class="{ on: activeTab === t.key }"
        type="button" @click="switchTab(t.key)"
      >{{ t.label }}</button>
    </div>

    <!-- ============================================================ 总览 -->
    <template v-if="activeTab === 'overview'">
      <div v-if="overviewError" class="adm-note adm-note--danger">{{ overviewError }}</div>

      <div class="adm-kpis">
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">可索引页面</span>
          <span v-if="overviewLoading && !overview" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(overview && overview.pages) }}</span>
          <span class="adm-kpi__hint">
            素材 {{ num(overview && overview.material_pages) }} · 分类 {{ num(overview && overview.category_pages) }}
            · 固定页 {{ num(overview && overview.static_pages) }}
          </span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">Sitemap</span>
          <span v-if="overviewLoading && !overview" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ overview && overview.sitemap_ok ? '正常' : '异常' }}</span>
          <span class="adm-kpi__hint">每次请求实时生成，超过 1000 条自动分片</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">robots.txt</span>
          <span v-if="overviewLoading && !overview" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ overview && overview.robots_ok ? '正常' : '异常' }}</span>
          <span class="adm-kpi__hint">已声明 Sitemap 地址</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">待推送任务</span>
          <span v-if="overviewLoading && !overview" class="adm-skeleton" style="height:26px;width:70%" />
          <span v-else class="adm-kpi__value">{{ num(taskStats.pending) }}</span>
          <span class="adm-kpi__hint">失败 {{ num(taskStats.failed) }} · 已提交 {{ num(taskStats.success) }}</span>
        </div>
      </div>

      <!-- 三个引擎通道 -->
      <div class="adm-grid-3">
        <section class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>百度 · 普通收录 API</h2>
            <AdminTag
              :text="baidu && baidu.configured ? '已配置' : '未配置'"
              :kind="baidu && baidu.configured ? 'ok' : 'warn'"
            />
          </div>
          <p class="adm-muted adm-2xs">{{ engineHint(baidu) }}</p>
          <div v-if="baidu && baidu.configured && baidu.quota_remain >= 0" class="adm-metric">
            <span>今日剩余配额</span>
            <b>{{ num(baidu.quota_remain) }}</b>
          </div>
          <div class="adm-kpi-row">
            <span class="adm-chip adm-chip--mini">待推送 {{ num(baidu && baidu.pending) }}</span>
            <span class="adm-chip adm-chip--mini">已提交 {{ num(baidu && baidu.success) }}</span>
            <span class="adm-chip adm-chip--mini">失败 {{ num(baidu && baidu.failed) }}</span>
          </div>
        </section>

        <section class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>Bing · IndexNow</h2>
            <AdminTag
              :text="indexNow && indexNow.configured ? '已配置' : '未配置'"
              :kind="indexNow && indexNow.configured ? 'ok' : 'warn'"
            />
          </div>
          <p class="adm-muted adm-2xs">{{ engineHint(indexNow) }}</p>
          <div class="adm-kpi-row">
            <span class="adm-chip adm-chip--mini">待推送 {{ num(indexNow && indexNow.pending) }}</span>
            <span class="adm-chip adm-chip--mini">已提交 {{ num(indexNow && indexNow.success) }}</span>
            <span class="adm-chip adm-chip--mini">失败 {{ num(indexNow && indexNow.failed) }}</span>
          </div>
          <button
            v-if="overview && overview.indexnow"
            class="adm-link adm-2xs"
            type="button"
            @click="copy(overview.indexnow, '密钥文件地址')"
          >{{ overview.indexnow }}</button>
        </section>

        <section class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>Google · Search Console</h2>
            <AdminTag
              :text="google && google.configured ? '已配置' : '未配置'"
              :kind="google && google.configured ? 'ok' : 'warn'"
            />
          </div>
          <p class="adm-muted adm-2xs">{{ engineHint(google) }}</p>
          <p class="adm-2xs adm-muted" style="margin:0">
            普通网页只通过 Sitemap 被发现，<b>不使用</b> Google Indexing API 批量推普通素材页。
          </p>
          <button
            v-if="overview && overview.sitemap"
            class="adm-link adm-2xs"
            type="button"
            @click="copy(overview.sitemap, 'Sitemap 地址')"
          >{{ overview.sitemap }}</button>
        </section>
      </div>

      <!-- 最近巡检 -->
      <section v-if="lastCheck" class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>最近一次巡检</h2>
          <span class="adm-muted">{{ datetime(lastCheck.checked_at) }}</span>
        </div>
        <div class="adm-kpis adm-kpis--tight">
          <div class="adm-kpi">
            <span class="adm-kpi__label">页面数</span>
            <span class="adm-kpi__value">{{ num(lastCheck.pages) }}</span>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi__label">补入队</span>
            <span class="adm-kpi__value">{{ num(lastCheck.queued) }}</span>
            <span class="adm-kpi__hint">对比公开页面与推送记录</span>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi__label">重试</span>
            <span class="adm-kpi__value">{{ num(lastCheck.retried) }}</span>
            <span class="adm-kpi__hint">上次失败的任务</span>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi__label">提交成功</span>
            <span class="adm-kpi__value">{{ num(lastCheck.submitted) }}</span>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi__label">异常</span>
            <span class="adm-kpi__value">{{ checkIssues.length }}</span>
            <span class="adm-kpi__hint">robots / noindex / HTTP 状态</span>
          </div>
        </div>
        <ul v-if="checkIssues.length" class="adm-notes">
          <li v-for="(issue, i) in checkIssues" :key="i">{{ issue }}</li>
        </ul>
      </section>

      <!-- 最近任务 -->
      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>最近推送任务</h2>
          <button class="adm-link" type="button" @click="switchTab('tasks')">查看全部</button>
        </div>
        <AdminTable
          :columns="recentColumns"
          :rows="(overview && overview.recent_tasks) || []"
          :loading="overviewLoading && !overview"
          row-key="id"
          min-width="680px"
          empty-title="还没有推送记录"
          empty-hint="发布一个素材并配置好百度 / IndexNow 后，这里就会有记录。"
        >
          <template #cell-queued_at="{ row }">
            <span class="adm-nowrap adm-2xs">{{ datetime(row.queued_at) }}</span>
          </template>
          <template #cell-url="{ row }">
            <span class="adm-mono adm-2xs" :title="row.url">{{ row.path || row.url }}</span>
          </template>
          <template #cell-engine_name="{ row }">
            <AdminTag :text="row.engine_name || row.engine" kind="info" />
          </template>
          <template #cell-status_name="{ row }">
            <AdminTag :text="row.status_name || row.status" :kind="taskStatusKind(row.status)" />
          </template>
        </AdminTable>
      </section>
    </template>

    <!-- ======================================================== 页面清单 -->
    <template v-else-if="activeTab === 'pages'">
      <div v-if="pagesError" class="adm-note adm-note--danger">{{ pagesError }}</div>

      <div class="adm-kpis">
        <div class="adm-kpi adm-kpi--accent">
          <span class="adm-kpi__label">可索引页面</span>
          <span class="adm-kpi__value">{{ num(pages.length) }}</span>
          <span class="adm-kpi__hint">sitemap.xml 里就是这些</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">未推送过</span>
          <span class="adm-kpi__value">{{ num(notPushedCount) }}</span>
          <span class="adm-kpi__hint">还没有发过通知</span>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi__label">标了 noindex</span>
          <span class="adm-kpi__value">{{ num(noIndexCount) }}</span>
          <span class="adm-kpi__hint">这些页面不进 sitemap</span>
        </div>
      </div>

      <div class="adm-toolbar">
        <input
          v-model="pageFilter.keyword"
          class="adm-input"
          type="search"
          placeholder="搜索路径 / 标题 / 素材名"
        >
        <select v-model="pageFilter.kind" class="adm-select">
          <option v-for="k in KIND_OPTIONS" :key="k.value" :value="k.value">{{ k.label }}</option>
        </select>
        <div class="adm-toolbar__right">
          <span class="adm-muted adm-2xs">共 {{ num(filteredPages.length) }} 条</span>
          <button
            v-if="canManage"
            class="adm-btn adm-btn--sm"
            type="button"
            :disabled="regenBusy"
            @click="doRegenerate"
          >{{ regenBusy ? '重算中…' : '按模板重算自动文案' }}</button>
        </div>
      </div>

      <p class="adm-hint">
        素材与分类的标题、描述可以直接在这里改，改完立即生效并自动补推。
        固定页（首页 / 教程 / 工具 / 色卡）的文案在代码里统一维护，这里只读。
        标记为「自动生成」的文案会跟随模板变化，手工改过的文案会被保留。
      </p>

      <AdminTable
        :columns="pageColumns"
        :rows="filteredPages"
        :loading="pagesLoading && !pages.length"
        row-key="path"
        min-width="1080px"
        empty-title="没有符合条件的页面"
        empty-hint="换个筛选条件看看。"
      >
        <template #cell-path="{ row }">
          <span class="adm-mono adm-2xs" :title="row.url">{{ row.path }}</span>
          <div v-if="row.noindex" class="adm-2xs" style="color:var(--danger,#e5484d)">noindex</div>
        </template>
        <template #cell-kind_name="{ row }">
          <AdminTag :text="row.kind_name || row.kind" kind="muted" />
        </template>
        <template #cell-title="{ row }">
          <div>{{ row.title || '—' }}</div>
          <div class="adm-2xs adm-muted" :title="row.description">{{ row.description || '—' }}</div>
        </template>
        <template #cell-push_state="{ row }">
          <AdminTag :text="pushStateText(row.push_state)" :kind="pushStateKind(row.push_state)" />
        </template>
        <template #cell-lastmod="{ row }">
          <span class="adm-nowrap adm-2xs">{{ datetime(row.lastmod) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <button
            v-if="canEdit(row)"
            class="adm-link"
            type="button"
            @click="openEdit(row)"
          >改文案</button>
          <button
            v-if="canManage"
            class="adm-link"
            type="button"
            @click="openPush(row)"
          >推送</button>
          <span v-if="!canEdit(row) && !canManage" class="adm-muted adm-2xs">—</span>
        </template>
        <template #empty-action>
          <button v-if="canManage" class="adm-btn" type="button" @click="openPush(null)">
            批量推送全部页面
          </button>
        </template>
      </AdminTable>
    </template>

    <!-- ======================================================== 推送历史 -->
    <template v-else-if="activeTab === 'tasks'">
      <div v-if="tasksError" class="adm-note adm-note--danger">{{ tasksError }}</div>

      <div class="adm-toolbar">
        <input
          v-model="taskFilter.keyword"
          class="adm-input"
          type="search"
          placeholder="搜索路径 / URL"
          @keyup.enter="searchTasks"
        >
        <select v-model="taskFilter.engine" class="adm-select" @change="searchTasks">
          <option value="">全部引擎</option>
          <option value="baidu">百度</option>
          <option value="indexnow">IndexNow</option>
          <option value="google">Google</option>
        </select>
        <select v-model="taskFilter.status" class="adm-select" @change="searchTasks">
          <option value="">全部状态</option>
          <option value="pending">待推送</option>
          <option value="running">推送中</option>
          <option value="success">已提交</option>
          <option value="failed">失败</option>
          <option value="skipped">已跳过</option>
        </select>
        <div class="adm-toolbar__right">
          <button class="adm-btn adm-btn--sm" type="button" @click="searchTasks">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" @click="resetTasks">重置</button>
        </div>
      </div>

      <p class="adm-hint">
        这张表同时是<b>队列</b>和<b>历史</b>。同一个页面内容指纹没变时不会重复推送，
        所以这里看到「已跳过」通常是正常去重，不是出错。
      </p>

      <AdminTable
        :columns="taskColumns"
        :rows="tasks"
        :loading="tasksLoading && !tasks.length"
        row-key="id"
        min-width="1080px"
        empty-title="没有符合条件的推送记录"
        empty-hint="发布素材或点「手动推送」后，这里会出现记录。"
      >
        <template #cell-queued_at="{ row }">
          <span class="adm-nowrap adm-2xs">{{ datetime(row.queued_at) }}</span>
        </template>
        <template #cell-url="{ row }">
          <span class="adm-mono adm-2xs" :title="row.url">{{ row.path || row.url }}</span>
          <div class="adm-2xs adm-muted">{{ row.trigger }} · {{ row.action === 'delete' ? '删除通知' : '提交' }}</div>
        </template>
        <template #cell-engine_name="{ row }">
          <AdminTag :text="row.engine_name || row.engine" kind="info" />
        </template>
        <template #cell-status_name="{ row }">
          <AdminTag :text="row.status_name || row.status" :kind="taskStatusKind(row.status)" />
        </template>
        <template #cell-attempts="{ row }">{{ row.attempts }}</template>
        <template #cell-last_error="{ row }">
          <div v-if="row.last_error" class="adm-2xs" style="color:var(--danger,#e5484d)">{{ row.last_error }}</div>
          <div v-else-if="row.response" class="adm-2xs adm-mono adm-muted" :title="row.response">
            {{ String(row.response).slice(0, 120) }}
          </div>
          <span v-else class="adm-muted adm-2xs">—</span>
        </template>
        <template #cell-actions="{ row }">
          <button
            v-if="canManage"
            class="adm-link"
            type="button"
            @click="openPush(row)"
          >重推</button>
          <span v-else class="adm-muted adm-2xs">—</span>
        </template>
      </AdminTable>

      <AdminPager
        :total="taskTotal"
        :page="taskPage"
        :page-size="taskPageSize"
        @update:page="changeTaskPage"
        @update:page-size="changeTaskPageSize"
      />
    </template>

    <!-- ======================================================== 关键词管理 -->
    <AdminSeoKeywords v-else-if="activeTab === 'keywords'" />

    <!-- ======================================================== 配置与推送 -->
    <template v-else-if="activeTab === 'config'">
      <div class="adm-grid-2">
        <section class="adm-card adm-card--flat">
          <div class="adm-card__head"><h2>公开地址</h2></div>
          <div class="adm-stack">
            <div class="adm-field">
              <label>robots.txt</label>
              <div class="adm-mono adm-2xs">{{ (overview && overview.robots) || '—' }}</div>
            </div>
            <div class="adm-field">
              <label>Sitemap</label>
              <div class="adm-mono adm-2xs">{{ (overview && overview.sitemap) || '—' }}</div>
            </div>
            <div class="adm-field">
              <label>IndexNow 密钥文件</label>
              <div class="adm-mono adm-2xs">{{ (overview && overview.indexnow) || '未配置' }}</div>
            </div>
            <div class="adm-field">
              <label>站点根地址</label>
              <div class="adm-mono adm-2xs">{{ (config && config.site_url) || '—' }}</div>
            </div>
          </div>
          <div class="adm-kpi-row">
            <button
              class="adm-btn adm-btn--sm"
              type="button"
              @click="copy((overview && overview.robots) || '', 'robots.txt 地址')"
            >复制 robots 地址</button>
            <button
              class="adm-btn adm-btn--sm"
              type="button"
              @click="copy((overview && overview.sitemap) || '', 'Sitemap 地址')"
            >复制 Sitemap 地址</button>
          </div>
        </section>

        <section class="adm-card adm-card--flat">
          <div class="adm-card__head"><h2>运行状态</h2></div>
          <div class="adm-stack">
            <div class="adm-field">
              <label>SEO 总开关</label>
              <div>{{ config && config.enabled ? '已开启' : '已关闭' }}</div>
            </div>
            <div class="adm-field">
              <label>自动推送</label>
              <div>{{ config && config.push_enabled ? '开启（发布素材后自动入队）' : '关闭（只记录不外发）' }}</div>
            </div>
            <div class="adm-field">
              <label>巡检周期</label>
              <div>{{ (config && config.cron_interval) || '—' }}</div>
            </div>
            <div class="adm-field">
              <label>单批推送条数</label>
              <div>{{ num(config && config.batch_size) }}</div>
            </div>
            <div class="adm-field">
              <label>记录保留天数</label>
              <div>{{ num(config && config.retain_days) }} 天</div>
            </div>
          </div>
        </section>
      </div>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>推送通道</h2>
          <span class="adm-muted">密钥只存在服务器环境变量里，后台只看得到「配没配」</span>
        </div>
        <AdminTable
          :columns="[
            { key: 'label', label: '引擎', width: '160px' },
            { key: 'configured', label: '状态', width: '110px' },
            { key: 'note', label: '说明' }
          ]"
          :rows="(config && config.engines) || []"
          :loading="configLoading && !config"
          row-key="engine"
          min-width="620px"
          empty-title="没有推送通道"
          empty-hint=""
        >
          <template #cell-label="{ row }">{{ row.label || row.engine }}</template>
          <template #cell-configured="{ row }">
            <AdminTag :text="row.configured ? '已配置' : '未配置'" :kind="row.configured ? 'ok' : 'warn'" />
          </template>
          <template #cell-note="{ row }">
            <span class="adm-2xs adm-muted">
              {{ engineHint(engineBy(row.engine)) }}
            </span>
          </template>
        </AdminTable>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>手动推送</h2></div>
        <div class="adm-note adm-note--muted">
          首次上线可以把全部公开页面批量提交一次；之后内容有变化时系统会自动推送，
          日常不需要手动操作。Google 通道只提交 Sitemap，不在这里推单个页面。
        </div>
        <div class="adm-grid-2">
          <div class="adm-field adm-field--full">
            <label>页面路径（每行一个，或用空格 / 逗号分隔）</label>
            <textarea
              v-model="pushForm.paths"
              class="adm-textarea"
              rows="4"
              placeholder="/materials/xxx/&#10;/materials/category/animals/"
            />
          </div>
          <div class="adm-field">
            <label>推送目标</label>
            <label class="adm-check">
              <input v-model="pushForm.all" type="checkbox">
              <span>全部可索引页面（首次批量提交用这个）</span>
            </label>
          </div>
          <div class="adm-field">
            <label>引擎（不选＝全部已配置的通道）</label>
            <div class="adm-kpi-row">
              <label v-for="e in pushEngines" :key="e.value" class="adm-check">
                <input
                  type="checkbox"
                  :checked="pushForm.engines.includes(e.value)"
                  @change="toggleEngine(e.value)"
                >
                <span>{{ e.label }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="adm-kpi-row">
          <button
            class="adm-btn adm-btn--primary"
            type="button"
            :disabled="pushSaving || !canManage"
            @click="doPush"
          >{{ pushSaving ? '推送中…' : '立即推送' }}</button>
          <span v-if="!canManage" class="adm-2xs adm-muted">当前账号只有查看权限</span>
        </div>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head"><h2>三家站长平台验证</h2></div>
        <ol class="adm-notes">
          <li>
            <b>百度</b>：到 ziyuan.baidu.com 添加并验证站点（推荐用「文件验证」，
            验证文件放到站点根目录，服务器会用配置里的文件名返回它），
            然后在「普通收录」页拿到推送 token，填到服务端环境变量
            <code>DOUWAN_SEO_BAIDU_TOKEN</code>。
          </li>
          <li>
            <b>Google</b>：到 search.google.com/search-console 添加站点并用 DNS TXT 验证，
            然后在「站点地图」里提交 <code>{{ (overview && overview.sitemap) || '/sitemap.xml' }}</code>。
            Google 不提供普通网页的即时收录 API，所以这里不做单页推送。
          </li>
          <li>
            <b>Bing</b>：到 bing.com/webmasters 添加站点并验证，
            在「IndexNow」里生成密钥，把密钥填到服务端环境变量
            <code>DOUWAN_SEO_INDEXNOW_KEY</code>，
            密钥文件会自动在 <code>{{ (overview && overview.indexnow) || '/{key}.txt' }}</code> 提供。
          </li>
          <li>三个平台都验证完之后，回到本页把通道状态刷新一下确认变成「已配置」。</li>
        </ol>
      </section>
    </template>

    <!-- ======================================================== 弹窗：编辑文案 -->
    <AdminModal v-model="editOpen" title="修改 SEO 文案" size="lg">
      <div v-if="editTarget" class="adm-stack">
        <div class="adm-field">
          <label>页面</label>
          <div class="adm-mono adm-2xs">{{ editTarget.path }}</div>
        </div>
        <div class="adm-field adm-field--full">
          <label>SEO 标题（建议 30 字以内）</label>
          <input
            v-model="editForm.seo_title"
            class="adm-input"
            maxlength="120"
            placeholder="留空则用自动生成的标题"
          >
          <div class="adm-2xs adm-muted">当前 {{ editForm.seo_title.length }} 字</div>
        </div>
        <div class="adm-field adm-field--full">
          <label>SEO 描述（建议 80 字以内）</label>
          <textarea
            v-model="editForm.seo_description"
            class="adm-textarea"
            rows="3"
            maxlength="200"
            placeholder="留空则用素材简介自动生成"
          />
          <div class="adm-2xs adm-muted">当前 {{ editForm.seo_description.length }} 字</div>
        </div>
        <label class="adm-check">
          <input v-model="editForm.seo_noindex" type="checkbox">
          <span>不在搜索引擎里展示这个页面（noindex）</span>
        </label>
        <p class="adm-hint" style="margin:0">
          保存后页面立即更新，并自动把这条链接补推到已配置的搜索通道。
        </p>
      </div>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="editSaving"
          @click="saveEdit"
        >{{ editSaving ? '保存中…' : '保存并推送' }}</button>
      </template>
    </AdminModal>

    <!-- ======================================================== 弹窗：手动推送 -->
    <AdminModal v-model="pushOpen" title="手动推送页面" size="lg">
      <div class="adm-stack">
        <div class="adm-field adm-field--full">
          <label>页面路径（每行一个，或用空格 / 逗号分隔）</label>
          <textarea
            v-model="pushForm.paths"
            class="adm-textarea"
            rows="4"
            placeholder="/materials/xxx/&#10;/materials/category/animals/"
          />
        </div>
        <label class="adm-check">
          <input v-model="pushForm.all" type="checkbox">
          <span>改为推送全部可索引页面</span>
        </label>
        <label class="adm-check">
          <input v-model="pushForm.force" type="checkbox">
          <span>强制补推（忽略「内容未变化就跳过」）</span>
        </label>
        <div class="adm-field">
          <label>引擎（不选＝全部已配置的通道）</label>
          <div class="adm-kpi-row">
            <label v-for="e in pushEngines" :key="e.value" class="adm-check">
              <input
                type="checkbox"
                :checked="pushForm.engines.includes(e.value)"
                @change="toggleEngine(e.value)"
              >
              <span>{{ e.label }}</span>
            </label>
          </div>
        </div>
        <div class="adm-field">
          <label>动作</label>
          <select v-model="pushForm.action" class="adm-select">
            <option value="submit">提交 / 更新</option>
            <option value="delete">删除通知（页面已下线时用）</option>
          </select>
        </div>
        <p class="adm-hint" style="margin:0">
          默认会跳过「内容没变就不重复推」的页面；勾选「强制补推」才会把选中的页面重新推一遍。
        </p>
      </div>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="pushSaving"
          @click="doPush"
        >{{ pushSaving ? '推送中…' : '推送' }}</button>
      </template>
    </AdminModal>
  </div>
</template>

<style scoped>
.adm-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.adm-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.adm-kpis--tight .adm-kpi {
  padding: 10px 12px;
}

.adm-metric {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 6px 0 10px;
  font-size: var(--fs-xs);
  color: var(--muted);
}

.adm-metric b {
  font-size: 18px;
  color: var(--text);
}

.adm-kpi-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.adm-chip--mini {
  font-size: 11px;
  padding: 2px 8px;
}

.adm-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text);
  cursor: pointer;
}

.adm-notes {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: var(--fs-xs);
  line-height: 1.9;
  color: var(--muted);
}

.adm-notes li + li {
  margin-top: 4px;
}

.adm-hint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--muted);
}

@media (max-width: 980px) {
  .adm-grid-3,
  .adm-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
