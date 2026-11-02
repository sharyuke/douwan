<script setup>
/* =========================================================================
   SEO · 关键词管理（后台）
   - 对应后端 douwan-api/internal/handler/seo_keyword.go 的 /api/v1/admin/seo/keywords/*
   - 口径红线：
     1. 曝光 / 点击 / 点击率 / 平均排名**只来自官方站长平台接口或人工导入的 CSV**；
        没接入数据源时接口返回 null，这里一律显示「暂无数据」，不用 0 冒充「没有曝光」。
     2. 每个数字都要能说清「哪个搜索引擎、什么时间范围、数据来源」，
        所以表格里带统计周期与数据来源两列。
     3. 一个关键词只对应一个目标页面；两个页面抢同一个核心意图会被明确提示，
        但系统不替运营做决定。
   ========================================================================= */
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiError, datetime } from '../../lib/api.js'
import { seoKeywordApi } from '../../lib/adminApi.js'
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import { can } from '../../composables/useAdminAuth.js'
import { toastErr, toastOk } from '../../composables/useToast.js'
import { run } from '../../composables/useAdminKit.js'

/* ------------------------------------------------------------------ 常量 */

const GROUP_OPTIONS = [
  { value: 'tool', label: '工具转换词', desc: '有明确制作需求，想立刻把图片变成图纸' },
  { value: 'material', label: '免费素材词', desc: '想找现成的拼豆图案与素材' },
  { value: 'tutorial', label: '教程与专业功能词', desc: '查做法、查色号、查规格' }
]

const INTENT_OPTIONS = [
  { value: 'tool', label: '工具使用' },
  { value: 'material', label: '找素材' },
  { value: 'info', label: '查资料' }
]

const STATUS_OPTIONS = [
  { value: 'planned', label: '待建设' },
  { value: 'active', label: '已上线' },
  { value: 'paused', label: '已暂停' }
]

const ENGINE_OPTIONS = [
  { value: 'manual', label: '人工整理' },
  { value: 'google', label: 'Google Search Console' },
  { value: 'baidu', label: '百度搜索资源平台' },
  { value: 'bing', label: 'Bing Webmaster Tools' }
]

const PRIORITY_OPTIONS = [
  { value: 1, label: '高（主搜索意图）' },
  { value: 2, label: '中' },
  { value: 3, label: '低' }
]

const SORT_OPTIONS = [
  { value: '', label: '默认（优先级）' },
  { value: 'clicks', label: '点击量（多→少）' },
  { value: 'impressions', label: '曝光量（多→少）' },
  { value: 'ctr', label: '点击率（高→低）' },
  { value: 'position', label: '平均排名（靠前→后）' },
  { value: 'priority', label: '优先级' }
]

/** CSV 导入的示例（列名与后端认识的表头一致） */
const CSV_SAMPLE = [
  '关键词,关键词分组,优先级,搜索意图,目标页面,当前状态,搜索引擎来源,曝光量,点击量,点击率,平均排名,统计周期,数据来源',
  '拼豆图纸生成器,工具转换词,1,工具使用,/,已上线,人工整理,,,,,',
  '免费拼豆图纸,免费素材词,1,找素材,/materials/,已上线,人工整理,,,,,'
].join('\n')

/* ------------------------------------------------------------------ 状态 */

const canManage = computed(() => can('seo.manage'))

const meta = ref(null)
const metaLoading = ref(false)

const list = ref([])
const total = ref(0)
const listLoading = ref(false)
const listError = ref('')
const page = ref(1)
const pageSize = ref(20)

const filter = reactive({
  group: '',
  intent: '',
  status: '',
  engine: '',
  targetPath: '',
  keyword: '',
  sort: '',
  hasData: '',
  minClicks: '',
  minImpressions: '',
  maxCtr: ''
})

const conflicts = ref([])
const checks = ref([])
const candidates = ref([])
const insightLoading = ref(false)
/* 各分组 / 各状态的条数：列表接口一起带回来（meta 接口只有分组的定义，没有条数） */
const groupTotals = ref({})
const statusTotals = ref({})

/* ------------------------------------------------------------------ 加载 */

async function loadMeta() {
  metaLoading.value = true
  try {
    meta.value = await seoKeywordApi.meta()
  } catch (e) {
    meta.value = null
  } finally {
    metaLoading.value = false
  }
}

async function loadList(toPage = page.value) {
  page.value = Math.max(1, toPage || 1)
  listLoading.value = true
  listError.value = ''
  try {
    const query = {
      group: filter.group,
      intent: filter.intent,
      status: filter.status,
      engine: filter.engine,
      target_path: filter.targetPath,
      keyword: filter.keyword.trim(),
      sort: filter.sort,
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value
    }
    if (filter.hasData === 'yes') query.has_data = 'true'
    else if (filter.hasData === 'no') query.has_data = 'false'
    if (filter.minClicks !== '') query.min_clicks = filter.minClicks
    if (filter.minImpressions !== '') query.min_impressions = filter.minImpressions
    if (filter.maxCtr !== '') query.max_ctr = String(Number(filter.maxCtr) / 100)

    const data = await seoKeywordApi.list(query)
    list.value = (data && data.list) || []
    total.value = (data && data.total) || 0
    groupTotals.value = (data && data.groups) || {}
    statusTotals.value = (data && data.statuses) || {}
  } catch (e) {
    listError.value = e instanceof ApiError ? e.message : '关键词列表加载失败，请重试'
    list.value = []
    total.value = 0
  } finally {
    listLoading.value = false
  }
}

async function loadInsights() {
  insightLoading.value = true
  try {
    const [c, k, cand] = await Promise.all([
      seoKeywordApi.conflicts(),
      seoKeywordApi.checks(),
      seoKeywordApi.candidates({ limit: 50 })
    ])
    conflicts.value = (c && c.list) || []
    checks.value = (k && k.list) || []
    candidates.value = (cand && cand.list) || []
  } catch (e) {
    conflicts.value = []
    checks.value = []
    candidates.value = []
  } finally {
    insightLoading.value = false
  }
}

function refresh() {
  loadList(page.value)
  loadInsights()
}

function search() {
  page.value = 1
  loadList(1)
}

function resetFilter() {
  Object.assign(filter, {
    group: '',
    intent: '',
    status: '',
    engine: '',
    targetPath: '',
    keyword: '',
    sort: '',
    hasData: '',
    minClicks: '',
    minImpressions: '',
    maxCtr: ''
  })
  page.value = 1
  loadList(1)
}

function changePage(p) {
  loadList(p)
}

function changePageSize(size) {
  pageSize.value = size
  page.value = 1
  loadList(1)
}

/* ------------------------------------------------------------------ 统计口径 */

const notice = computed(() => (meta.value && meta.value.notice) || '')

const groupCounts = computed(() => {
  const g = groupTotals.value || {}
  return GROUP_OPTIONS.map(o => ({ ...o, total: g[o.value] || 0 }))
})

const statusCounts = computed(() => {
  const s = statusTotals.value || {}
  return STATUS_OPTIONS.map(o => ({ ...o, total: s[o.value] || 0 }))
})

const withDataCount = computed(() => {
  const list_ = list.value || []
  return list_.filter(k => k.has_data).length
})

/** 关键词 ↔ 页面布局总览（需求 §2 的对应表） */
const layoutRows = computed(() => (meta.value && meta.value.targets) || [])

/** 可选的目标页面：站点上真实存在的可索引页面 */
const targetPages = computed(() => (meta.value && meta.value.pages) || [])

/* ------------------------------------------------------------------ 展示辅助 */

function num(v) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN')
}

function ctrText(v) {
  if (v === null || v === undefined) return '—'
  return (Number(v) * 100).toFixed(2) + '%'
}

function posText(v) {
  if (v === null || v === undefined) return '—'
  return Number(v).toFixed(1)
}

function groupKind(g) {
  return { tool: 'primary', material: 'info', tutorial: 'muted' }[g] || 'muted'
}

function statusKind(s) {
  return { planned: 'warn', active: 'ok', paused: 'muted' }[s] || 'muted'
}

function intentKind(i) {
  return { tool: 'primary', material: 'info', info: 'muted' }[i] || 'muted'
}

function engineKind(e) {
  return { manual: 'muted', google: 'ok', baidu: 'info', bing: 'info' }[e] || 'muted'
}

function missingLabel(missing) {
  return (missing || []).map(m => ({ title: '标题', description: '描述', h1: 'H1' }[m] || m)).join('、')
}

/* ------------------------------------------------------------------ 新增 / 编辑 */

const formOpen = ref(false)
const formSaving = ref(false)
const formTarget = ref(null)
const form = reactive({
  keyword: '',
  group: 'tool',
  priority: 2,
  intent: 'tool',
  target_path: '',
  status: 'planned',
  engine: 'manual',
  is_primary: false,
  note: ''
})

function openCreate() {
  formTarget.value = null
  form.keyword = ''
  form.group = 'tool'
  form.priority = 2
  form.intent = 'tool'
  form.target_path = ''
  form.status = 'planned'
  form.engine = 'manual'
  form.is_primary = false
  form.note = ''
  formOpen.value = true
}

function openEdit(row) {
  formTarget.value = row
  form.keyword = row.keyword || ''
  form.group = row.group || 'tool'
  form.priority = row.priority || 3
  form.intent = row.intent || 'tool'
  form.target_path = row.target_path || ''
  form.status = row.status || 'planned'
  form.engine = row.engine || 'manual'
  form.is_primary = !!row.is_primary
  form.note = row.note || ''
  formOpen.value = true
}

async function saveForm() {
  if (!form.keyword.trim()) {
    toastErr('请填写搜索关键词')
    return
  }
  if (!form.target_path.trim()) {
    toastErr('请选择目标页面')
    return
  }
  formSaving.value = true
  const body = {
    keyword: form.keyword.trim(),
    group: form.group,
    priority: Number(form.priority) || 3,
    intent: form.intent,
    target_path: form.target_path.trim(),
    status: form.status,
    engine: form.engine,
    is_primary: !!form.is_primary,
    note: form.note.trim()
  }
  const ok = formTarget.value
    ? await run(() => seoKeywordApi.update(formTarget.value.id, body), { ok: '关键词已保存' })
    : await run(() => seoKeywordApi.create(body), { ok: '关键词已添加' })
  formSaving.value = false
  if (!ok) return
  formOpen.value = false
  refresh()
}

/* ------------------------------------------------------------------ 删除 */

const delOpen = ref(false)
const delBusy = ref(false)
const delTarget = ref(null)

function openDelete(row) {
  delTarget.value = row
  delOpen.value = true
}

async function confirmDelete() {
  if (!delTarget.value) return
  delBusy.value = true
  const ok = await run(() => seoKeywordApi.remove(delTarget.value.id), { ok: '关键词已删除' })
  delBusy.value = false
  if (!ok) return
  delOpen.value = false
  delTarget.value = null
  refresh()
}

/* ------------------------------------------------------------------ CSV 导入 */

const importOpen = ref(false)
const importBusy = ref(false)
const importForm = reactive({ csv: '', engine: 'manual', updateStats: false })

function openImport() {
  importForm.csv = ''
  importForm.engine = 'manual'
  importForm.updateStats = false
  importOpen.value = true
}

function fillSample() {
  importForm.csv = CSV_SAMPLE
}

async function doImport() {
  if (!importForm.csv.trim()) {
    toastErr('请把 CSV 内容粘贴进来')
    return
  }
  importBusy.value = true
  const res = await run(
    () => seoKeywordApi.import({
      csv: importForm.csv,
      engine: importForm.engine,
      update_stats: !!importForm.updateStats
    }),
    { ok: '导入完成' }
  )
  importBusy.value = false
  if (!res) return
  const parts = [`新增 ${res.created || 0} 条`, `更新 ${res.updated || 0} 条`]
  if (res.stats) parts.push(`写入搜索表现 ${res.stats} 条`)
  if (res.skipped) parts.push(`跳过 ${res.skipped} 条`)
  toastOk(parts.join(' · '))
  importOpen.value = false
  refresh()
}

/* ------------------------------------------------------------------ 同步初始关键词库 */

const syncBusy = ref(false)

async function doSync() {
  syncBusy.value = true
  const res = await run(() => seoKeywordApi.sync(), { ok: '已同步初始关键词库' })
  syncBusy.value = false
  if (!res) return
  toastOk(`新增 ${res.created || 0} 条（已存在的不会重复添加）`)
  refresh()
}

/* ------------------------------------------------------------------ Search Console */

const scOpen = ref(false)
const scBusy = ref(false)
const scForm = reactive({ start_date: '', end_date: '' })

function openSearchConsole() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 28)
  const fmt = d => {
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  scForm.start_date = fmt(start)
  scForm.end_date = fmt(end)
  scOpen.value = true
}

async function doSearchConsole() {
  if (!scForm.start_date || !scForm.end_date) {
    toastErr('请填写开始与结束日期')
    return
  }
  scBusy.value = true
  const res = await run(
    () => seoKeywordApi.searchConsole({
      start_date: scForm.start_date,
      end_date: scForm.end_date
    }),
    { ok: '搜索表现已拉取' }
  )
  scBusy.value = false
  if (!res) return
  toastOk(`写入 ${res.stats || 0} 条搜索表现`)
  scOpen.value = false
  refresh()
}

/* ------------------------------------------------------------------ 列定义 */

const columns = [
  { key: 'keyword', label: '搜索关键词', width: '190px' },
  { key: 'group', label: '分组', width: '116px' },
  { key: 'priority', label: '优先级', width: '72px' },
  { key: 'intent', label: '搜索意图', width: '92px' },
  { key: 'target', label: '对应目标页面', width: '230px' },
  { key: 'status', label: '状态', width: '86px' },
  { key: 'engine', label: '数据来源', width: '128px' },
  { key: 'impressions', label: '曝光', width: '80px', align: 'right' },
  { key: 'clicks', label: '点击', width: '70px', align: 'right' },
  { key: 'ctr', label: '点击率', width: '82px', align: 'right' },
  { key: 'position', label: '平均排名', width: '92px', align: 'right' },
  { key: 'analyzed', label: '最近分析', width: '132px', nowrap: true },
  { key: 'actions', label: '操作', width: '104px', align: 'right' }
]

const layoutColumns = [
  { key: 'path', label: '目标页面', width: '260px' },
  { key: 'primary', label: '主要搜索意图' },
  { key: 'related', label: '自然相关词' },
  { key: 'status', label: '页面状态', width: '110px' }
]

const conflictColumns = [
  { key: 'keyword', label: '关键词', width: '180px' },
  { key: 'paths', label: '被多个页面认领' },
  { key: 'advice', label: '建议' }
]

const checkColumns = [
  { key: 'path', label: '页面路径', width: '260px' },
  { key: 'missing', label: '缺少的字段', width: '140px' },
  { key: 'title', label: '当前标题' }
]

const candidateColumns = [
  { key: 'keyword', label: '关键词', width: '170px' },
  { key: 'target', label: '目标页面', width: '220px' },
  { key: 'impressions', label: '曝光', width: '78px', align: 'right' },
  { key: 'clicks', label: '点击', width: '70px', align: 'right' },
  { key: 'ctr', label: '点击率', width: '80px', align: 'right' },
  { key: 'position', label: '平均排名', width: '92px', align: 'right' },
  { key: 'advice', label: '优化建议' }
]

/* ------------------------------------------------------------------ 生命周期 */

onMounted(() => {
  loadMeta()
  loadList(1)
  loadInsights()
})
</script>

<template>
  <div class="kw">
    <!-- 口径说明 -->
    <div class="adm-note adm-note--muted">
      {{ notice || '曝光、点击、点击率与平均排名只来自官方站长平台接口或人工导入的 CSV；没有接入数据源的关键词显示「暂无数据」。' }}
    </div>

    <!-- KPI -->
    <div class="adm-kpis">
      <div class="adm-kpi adm-kpi--accent">
        <span class="adm-kpi__label">关键词总数</span>
        <span class="adm-kpi__value">{{ num(total) }}</span>
        <span class="adm-kpi__hint">当前筛选条件下的关键词条数</span>
      </div>
      <div class="adm-kpi">
        <span class="adm-kpi__label">已有搜索表现</span>
        <span class="adm-kpi__value">{{ num(withDataCount) }}</span>
        <span class="adm-kpi__hint">本页 {{ num(list.length) }} 条里有数据的</span>
      </div>
      <div class="adm-kpi">
        <span class="adm-kpi__label">意图冲突</span>
        <span class="adm-kpi__value">{{ num(conflicts.length) }}</span>
        <span class="adm-kpi__hint">多个页面抢同一个核心词</span>
      </div>
      <div class="adm-kpi">
        <span class="adm-kpi__label">缺字段页面</span>
        <span class="adm-kpi__value">{{ num(checks.length) }}</span>
        <span class="adm-kpi__hint">缺 Title / Description / H1</span>
      </div>
    </div>

    <!-- 分组 / 状态分布 -->
    <div class="adm-grid-2">
      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>关键词分组（三层策略）</h2>
        </div>
        <div class="adm-stack">
          <div v-for="g in groupCounts" :key="g.value" class="kwLine">
            <div>
              <b>{{ g.label }}</b>
              <div class="adm-2xs adm-muted">{{ g.desc }}</div>
            </div>
            <AdminTag :text="String(g.total)" kind="muted" />
          </div>
        </div>
      </section>

      <section class="adm-card adm-card--flat">
        <div class="adm-card__head">
          <h2>当前状态</h2>
        </div>
        <div class="adm-stack">
          <div v-for="s in statusCounts" :key="s.value" class="kwLine">
            <div>
              <b>{{ s.label }}</b>
              <div class="adm-2xs adm-muted">
                {{ s.value === 'active' ? '目标页已上线且可被索引' : s.value === 'planned' ? '目标页还没有对应内容' : '暂停优化' }}
              </div>
            </div>
            <AdminTag :text="String(s.total)" kind="muted" />
          </div>
        </div>
      </section>
    </div>

    <!-- 关键词 ↔ 页面 布局总览 -->
    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>关键词与页面对应表</h2>
        <span class="adm-muted adm-2xs">每个页面只认领一个主要搜索意图，其余是自然相关词</span>
      </div>
      <AdminTable
        :columns="layoutColumns"
        :rows="layoutRows"
        :loading="metaLoading && !meta"
        row-key="path"
        min-width="900px"
        data-audit="seo-keywords-layout"
        empty-title="还没有关键词布局"
        empty-hint="点「同步初始关键词库」把内置的关键词与页面对应关系写进来。"
      >
        <template #cell-path="{ row }">
          <span class="adm-mono adm-2xs">{{ row.path }}</span>
          <div v-if="row.title" class="adm-2xs adm-muted" :title="row.title">{{ row.title }}</div>
        </template>
        <template #cell-primary="{ row }">
          <b>{{ row.primary || '—' }}</b>
        </template>
        <template #cell-related="{ row }">
          <span v-if="row.related && row.related.length" class="adm-2xs">
            {{ row.related.join('、') }}
          </span>
          <span v-else class="adm-muted adm-2xs">—</span>
        </template>
        <template #cell-status="{ row }">
          <AdminTag
            :text="row.indexed ? '已上线' : row.status === 'planned' ? '待建设' : '未上线'"
            :kind="row.indexed ? 'ok' : 'warn'"
          />
        </template>
      </AdminTable>
    </section>

    <!-- 工具条 -->
    <div class="adm-toolbar">
      <input
        v-model="filter.keyword"
        class="adm-input"
        type="search"
        placeholder="搜索关键词"
        @keyup.enter="search"
      >
      <select v-model="filter.group" class="adm-select" @change="search">
        <option value="">全部分组</option>
        <option v-for="g in GROUP_OPTIONS" :key="g.value" :value="g.value">{{ g.label }}</option>
      </select>
      <select v-model="filter.intent" class="adm-select" @change="search">
        <option value="">全部意图</option>
        <option v-for="i in INTENT_OPTIONS" :key="i.value" :value="i.value">{{ i.label }}</option>
      </select>
      <select v-model="filter.status" class="adm-select" @change="search">
        <option value="">全部状态</option>
        <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <select v-model="filter.engine" class="adm-select" @change="search">
        <option value="">全部来源</option>
        <option v-for="e in ENGINE_OPTIONS" :key="e.value" :value="e.value">{{ e.label }}</option>
      </select>
      <select v-model="filter.targetPath" class="adm-select" @change="search">
        <option value="">全部目标页</option>
        <option v-for="p in targetPages" :key="p.path" :value="p.path">{{ p.path }}</option>
      </select>
      <select v-model="filter.sort" class="adm-select" @change="search">
        <option v-for="s in SORT_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <div class="adm-toolbar__right">
        <button class="adm-btn adm-btn--sm" type="button" @click="search">查询</button>
        <button class="adm-btn adm-btn--sm" type="button" @click="resetFilter">重置</button>
      </div>
    </div>

    <!-- 搜索表现筛选 -->
    <div class="adm-toolbar">
      <span class="adm-muted adm-2xs">搜索表现筛选</span>
      <select v-model="filter.hasData" class="adm-select" @change="search">
        <option value="">有无数据不限</option>
        <option value="yes">只看有数据</option>
        <option value="no">只看暂无数据</option>
      </select>
      <input
        v-model="filter.minClicks"
        class="adm-input adm-input--sm"
        type="number"
        min="0"
        placeholder="最小点击量"
        @change="search"
      >
      <input
        v-model="filter.minImpressions"
        class="adm-input adm-input--sm"
        type="number"
        min="0"
        placeholder="最小曝光量"
        @change="search"
      >
      <input
        v-model="filter.maxCtr"
        class="adm-input adm-input--sm"
        type="number"
        min="0"
        max="100"
        step="0.1"
        placeholder="最高点击率 %"
        @change="search"
      >
      <div class="adm-toolbar__right">
        <button v-if="canManage" class="adm-btn adm-btn--sm" type="button" @click="openCreate">新增关键词</button>
        <button v-if="canManage" class="adm-btn adm-btn--sm" type="button" @click="openImport">导入 CSV</button>
        <button v-if="canManage" class="adm-btn adm-btn--sm" type="button" :disabled="syncBusy" @click="doSync">
          {{ syncBusy ? '同步中…' : '同步初始关键词库' }}
        </button>
        <button v-if="canManage" class="adm-btn adm-btn--sm" type="button" @click="openSearchConsole">拉取 Google 搜索表现</button>
      </div>
    </div>

    <div v-if="listError" class="adm-note adm-note--danger">{{ listError }}</div>

    <!-- 关键词列表 -->
    <AdminTable
      :columns="columns"
      :rows="list"
      :loading="listLoading && !list.length"
      row-key="id"
      min-width="1460px"
      data-audit="seo-keywords-table"
      empty-title="没有符合条件的关键词"
      empty-hint="先点「同步初始关键词库」，或用「导入 CSV」批量导入。"
    >
      <template #cell-keyword="{ row }">
        <div>
          <b>{{ row.keyword }}</b>
          <span v-if="row.is_primary" class="adm-2xs" style="color:var(--brand,#F03D2E)">主</span>
        </div>
        <div v-if="row.note" class="adm-2xs adm-muted" :title="row.note">{{ row.note }}</div>
      </template>
      <template #cell-group="{ row }">
        <AdminTag :text="row.group_name || row.group" :kind="groupKind(row.group)" />
      </template>
      <template #cell-priority="{ row }">
        <span :title="`优先级 ${row.priority}`">{{ row.priority_name || row.priority }}</span>
      </template>
      <template #cell-intent="{ row }">
        <AdminTag :text="row.intent_name || row.intent" :kind="intentKind(row.intent)" />
      </template>
      <template #cell-target="{ row }">
        <span class="adm-mono adm-2xs" :title="row.target_path">{{ row.target_path }}</span>
        <div v-if="row.target_title" class="adm-2xs adm-muted" :title="row.target_title">{{ row.target_title }}</div>
        <div v-else class="adm-2xs" style="color:var(--danger,#e5484d)">目标页没有内容，暂不可索引</div>
      </template>
      <template #cell-status="{ row }">
        <AdminTag :text="row.status_name || row.status" :kind="statusKind(row.status)" />
      </template>
      <template #cell-engine="{ row }">
        <div><AdminTag :text="row.engine_name || row.engine" :kind="engineKind(row.engine)" /></div>
        <div v-if="row.stat_source" class="adm-2xs adm-muted" :title="row.stat_source">{{ row.stat_source }}</div>
      </template>
      <template #cell-impressions="{ row }">
        <span v-if="row.impressions === null || row.impressions === undefined" class="adm-muted">暂无数据</span>
        <span v-else>{{ num(row.impressions) }}</span>
      </template>
      <template #cell-clicks="{ row }">
        <span v-if="row.clicks === null || row.clicks === undefined" class="adm-muted">暂无数据</span>
        <span v-else>{{ num(row.clicks) }}</span>
      </template>
      <template #cell-ctr="{ row }">
        <span v-if="row.ctr === null || row.ctr === undefined" class="adm-muted">暂无数据</span>
        <span v-else>{{ ctrText(row.ctr) }}</span>
      </template>
      <template #cell-position="{ row }">
        <span v-if="row.position === null || row.position === undefined" class="adm-muted">暂无数据</span>
        <span v-else>{{ posText(row.position) }}</span>
      </template>
      <template #cell-analyzed="{ row }">
        <span class="adm-nowrap adm-2xs">{{ datetime(row.analyzed_at) }}</span>
        <div v-if="row.stat_period" class="adm-2xs adm-muted">{{ row.stat_period }}</div>
      </template>
      <template #cell-actions="{ row }">
        <button v-if="canManage" class="adm-link" type="button" @click="openEdit(row)">编辑</button>
        <button v-if="canManage" class="adm-link" type="button" @click="openDelete(row)">删除</button>
        <span v-if="!canManage" class="adm-muted adm-2xs">—</span>
      </template>
      <template #empty-action>
        <button v-if="canManage" class="adm-btn" type="button" @click="doSync">同步初始关键词库</button>
      </template>
    </AdminTable>

    <AdminPager
      :total="total"
      :page="page"
      :page-size="pageSize"
      @update:page="changePage"
      @update:page-size="changePageSize"
    />

    <!-- 意图冲突 -->
    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>核心搜索意图冲突</h2>
        <span class="adm-muted adm-2xs">同一个词被多个页面认领时，搜索引擎只能挑一个</span>
      </div>
      <AdminTable
        :columns="conflictColumns"
        :rows="conflicts"
        :loading="insightLoading && !conflicts.length"
        row-key="keyword"
        min-width="900px"
        empty-title="没有冲突"
        empty-hint="每个核心搜索意图目前只对应一个页面。"
      >
        <template #cell-keyword="{ row }"><b>{{ row.keyword }}</b></template>
        <template #cell-paths="{ row }">
          <span v-for="p in row.paths" :key="p" class="adm-mono adm-2xs" style="display:block">{{ p }}</span>
        </template>
        <template #cell-advice="{ row }">
          <span class="adm-2xs">{{ row.advice }}</span>
        </template>
      </AdminTable>
    </section>

    <!-- 页面字段自检 -->
    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>页面字段自检</h2>
        <span class="adm-muted adm-2xs">缺 Title / Description / H1 的页面不会被正常收录</span>
      </div>
      <AdminTable
        :columns="checkColumns"
        :rows="checks"
        :loading="insightLoading && !checks.length"
        row-key="path"
        min-width="900px"
        empty-title="字段都齐了"
        empty-hint="每个可索引页面都有独立的标题、描述与 H1。"
      >
        <template #cell-path="{ row }">
          <span class="adm-mono adm-2xs">{{ row.path }}</span>
        </template>
        <template #cell-missing="{ row }">
          <AdminTag :text="missingLabel(row.missing)" kind="warn" />
        </template>
        <template #cell-title="{ row }">
          <span class="adm-2xs">{{ row.title || '—' }}</span>
        </template>
      </AdminTable>
    </section>

    <!-- 优化候选 -->
    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>优化候选（有曝光但点击率低）</h2>
        <span class="adm-muted adm-2xs">只统计已接入搜索表现数据的关键词</span>
      </div>
      <AdminTable
        :columns="candidateColumns"
        :rows="candidates"
        :loading="insightLoading && !candidates.length"
        row-key="keyword"
        min-width="1100px"
        empty-title="暂无优化候选"
        empty-hint="还没有接入搜索表现数据；接入后这里会自动给出候选。"
      >
        <template #cell-keyword="{ row }"><b>{{ row.keyword }}</b></template>
        <template #cell-target="{ row }">
          <span class="adm-mono adm-2xs">{{ row.target_path }}</span>
          <div v-if="row.target_title" class="adm-2xs adm-muted" :title="row.target_title">{{ row.target_title }}</div>
        </template>
        <template #cell-impressions="{ row }">{{ num(row.impressions) }}</template>
        <template #cell-clicks="{ row }">{{ num(row.clicks) }}</template>
        <template #cell-ctr="{ row }">{{ ctrText(row.ctr) }}</template>
        <template #cell-position="{ row }">{{ posText(row.position) }}</template>
        <template #cell-advice="{ row }">
          <div class="adm-2xs">{{ row.advice }}</div>
          <div class="adm-2xs adm-muted">
            {{ row.engine_name }} · {{ row.stat_period || '未标注周期' }} · {{ row.stat_source || '未标注来源' }}
          </div>
        </template>
      </AdminTable>
    </section>

    <!-- ============================================================ 弹窗：新增 / 编辑 -->
    <AdminModal v-model="formOpen" :title="formTarget ? '编辑关键词' : '新增关键词'" size="lg">
      <div class="adm-stack">
        <div class="adm-grid-2">
          <div class="adm-field">
            <label>搜索关键词</label>
            <input v-model="form.keyword" class="adm-input" maxlength="120" placeholder="例如：拼豆图纸生成器">
          </div>
          <div class="adm-field">
            <label>对应目标页面</label>
            <select v-model="form.target_path" class="adm-select">
              <option value="">请选择页面</option>
              <option v-for="p in targetPages" :key="p.path" :value="p.path">
                {{ p.path }} —— {{ p.title }}
              </option>
            </select>
          </div>
          <div class="adm-field">
            <label>关键词分组</label>
            <select v-model="form.group" class="adm-select">
              <option v-for="g in GROUP_OPTIONS" :key="g.value" :value="g.value">{{ g.label }}</option>
            </select>
          </div>
          <div class="adm-field">
            <label>搜索意图</label>
            <select v-model="form.intent" class="adm-select">
              <option v-for="i in INTENT_OPTIONS" :key="i.value" :value="i.value">{{ i.label }}</option>
            </select>
          </div>
          <div class="adm-field">
            <label>优先级</label>
            <select v-model.number="form.priority" class="adm-select">
              <option v-for="p in PRIORITY_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div class="adm-field">
            <label>当前状态</label>
            <select v-model="form.status" class="adm-select">
              <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </div>
          <div class="adm-field">
            <label>搜索引擎来源</label>
            <select v-model="form.engine" class="adm-select">
              <option v-for="e in ENGINE_OPTIONS" :key="e.value" :value="e.value">{{ e.label }}</option>
            </select>
          </div>
          <div class="adm-field">
            <label>备注</label>
            <input v-model="form.note" class="adm-input" maxlength="200" placeholder="例如：主要搜索意图">
          </div>
        </div>
        <label class="adm-check">
          <input v-model="form.is_primary" type="checkbox">
          <span>这是该页面的主要搜索意图（同一页面只能有一个）</span>
        </label>
        <p class="adm-hint" style="margin:0">
          同一个词挂到第二个页面上时，系统会在「核心搜索意图冲突」里提示，但不会自动替你决定。
        </p>
      </div>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="formSaving" @click="saveForm">
          {{ formSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AdminModal>

    <!-- ============================================================ 弹窗：删除 -->
    <AdminModal v-model="delOpen" title="删除关键词" size="sm">
      <p v-if="delTarget" class="adm-hint" style="margin:0">
        确定删除关键词「<b>{{ delTarget.keyword }}</b>」吗？它绑定的目标页面
        <span class="adm-mono">{{ delTarget.target_path }}</span> 不受影响。
      </p>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--danger" type="button" :disabled="delBusy" @click="confirmDelete">
          {{ delBusy ? '删除中…' : '删除' }}
        </button>
      </template>
    </AdminModal>

    <!-- ============================================================ 弹窗：CSV 导入 -->
    <AdminModal v-model="importOpen" title="导入关键词 CSV" size="lg">
      <div class="adm-stack">
        <div class="adm-note adm-note--muted">
          必填列：<b>关键词</b>、<b>目标页面</b>。可选列：分组、优先级、意图、状态、来源、备注。
          带 <b>曝光量 / 点击量 / 点击率 / 平均排名 / 统计周期 / 数据来源</b> 列时，
          勾选「同时写入搜索表现」就会把数据一起写进去（来源标成你选的引擎）。
        </div>
        <div class="adm-field adm-field--full">
          <label>CSV 内容</label>
          <textarea v-model="importForm.csv" class="adm-textarea" rows="10" placeholder="关键词,目标页面&#10;拼豆图纸生成器,/"></textarea>
        </div>
        <div class="adm-grid-2">
          <div class="adm-field">
            <label>数据来源</label>
            <select v-model="importForm.engine" class="adm-select">
              <option v-for="e in ENGINE_OPTIONS" :key="e.value" :value="e.value">{{ e.label }}</option>
            </select>
          </div>
          <div class="adm-field">
            <label>搜索表现</label>
            <label class="adm-check">
              <input v-model="importForm.updateStats" type="checkbox">
              <span>同时写入 CSV 里的曝光 / 点击 / 点击率 / 排名</span>
            </label>
          </div>
        </div>
        <div class="adm-kpi-row">
          <button class="adm-btn adm-btn--sm" type="button" @click="fillSample">填入示例</button>
          <span class="adm-2xs adm-muted">示例只演示列格式，导入的是真实关键词示例</span>
        </div>
      </div>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="importBusy" @click="doImport">
          {{ importBusy ? '导入中…' : '开始导入' }}
        </button>
      </template>
    </AdminModal>

    <!-- ============================================================ 弹窗：Search Console -->
    <AdminModal v-model="scOpen" title="拉取 Google 搜索表现" size="sm">
      <div class="adm-stack">
        <div class="adm-note adm-note--muted">
          从 Google Search Console 的 Search Analytics 接口按「查询词」维度拉取，
          只写进关键词库里**已经存在**的词 —— 不会因为某个词有曝光就凭空建页面。
          未配置服务账号时这里会直接报错，不会生成任何假数据。
        </div>
        <div class="adm-field">
          <label>开始日期</label>
          <input v-model="scForm.start_date" class="adm-input" type="date">
        </div>
        <div class="adm-field">
          <label>结束日期</label>
          <input v-model="scForm.end_date" class="adm-input" type="date">
        </div>
      </div>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="scBusy" @click="doSearchConsole">
          {{ scBusy ? '拉取中…' : '拉取' }}
        </button>
      </template>
    </AdminModal>
  </div>
</template>

<style scoped>
.kwLine {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}

.kwLine:last-child {
  border-bottom: none;
}

.adm-hint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--muted);
}

.adm-kpi-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.adm-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text);
  cursor: pointer;
}

@media (max-width: 980px) {
  .adm-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
