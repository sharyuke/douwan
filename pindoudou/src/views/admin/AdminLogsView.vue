<script setup>
/* =========================================================================
   操作日志（后台需求 §11）
   - 只读：用于事后追溯「谁在什么时候做了什么、结果如何」
   - 动作下拉的选项来自 authApi.permissions() 的 actions 字段，不在前端硬编码
   - 日志本身不含明文密码 / API Key / 支付密钥 / 完整卡密
   ========================================================================= */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, datetime, syncQuery } from '../../lib/api.js'
import { authApi, logApi } from '../../lib/adminApi.js'
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import { roleLabel } from '../../composables/useAdminAuth.js'
import { logResultKind } from '../../composables/useAdminKit.js'
import { toastErr } from '../../composables/useToast.js'

const route = useRoute()
const router = useRouter()

/** 详情列在列表里最多显示这么多字，超出截断，完整内容进弹窗 */
const DETAIL_PREVIEW = 40

const columns = [
  { key: 'created_at', label: '时间', width: '132px', nowrap: true },
  { key: 'admin_name', label: '操作人', width: '140px' },
  { key: 'action_text', label: '动作', width: '150px' },
  { key: 'target', label: '目标', width: '170px' },
  { key: 'result_text', label: '结果', width: '78px' },
  { key: 'ip', label: 'IP', width: '128px', nowrap: true },
  { key: 'details', label: '详情' },
  { key: 'actions', label: '操作', width: '88px', align: 'right' }
]

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

const filters = reactive({
  keyword: '',
  action: '',
  result: '',
  from: '',
  to: ''
})

/** 动作下拉选项（含中文名），失败时退化成空下拉，不影响页面其它功能 */
const actionOptions = ref([])
const actionOptionsFailed = ref(false)

const detailOpen = ref(false)
const detailRow = ref(null)
const hasAnyFilter = computed(() => Object.values(filters).some(Boolean))

function pickText(value) {
  return typeof value === 'string' ? value : ''
}

/** 从地址栏读回筛选条件（刷新 / 分享链接后不丢）。
 *  日期用 log_from / log_to 前缀，避免和别的后台页的同名参数互相覆盖。 */
function readQuery() {
  filters.keyword = pickText(route.query.keyword)
  filters.action = pickText(route.query.action)
  filters.result = pickText(route.query.result)
  filters.from = pickText(route.query.log_from)
  filters.to = pickText(route.query.log_to)
  const p = Number(route.query.page)
  page.value = Number.isInteger(p) && p > 0 ? p : 1
  const size = Number(route.query.page_size)
  pageSize.value = [10, 20, 50, 100].includes(size) ? size : 20
}

/** 地址栏里保留「从地址栏读回」的部分，page / page_size 由 reload 统一写 */
function syncFilters() {
  syncQuery(router, route, {
    keyword: filters.keyword,
    action: filters.action,
    result: filters.result,
    log_from: filters.from,
    log_to: filters.to
  })
}

/**
 * 后端日志接口只支持 keyword / action / result / admin_id / target_type / page / page_size，
 * 没有日期参数。既然不支持，就不把 from / to 发给服务端，
 * 改成把日期拼进关键字里参与模糊匹配（后端会对操作人、目标、详情等多列做 LIKE）。
 */
function buildQuery() {
  const extra = [filters.from, filters.to].filter(Boolean).join(' ')
  const keyword = [filters.keyword.trim(), extra].filter(Boolean).join(' ')
  return {
    keyword,
    action: filters.action,
    result: filters.result
  }
}

async function reload(toPage = page.value) {
  page.value = toPage
  loading.value = true
  try {
    const data = await logApi.list({ ...buildQuery(), page: page.value, page_size: pageSize.value })
    rows.value = (data && data.list) || []
    total.value = (data && data.total) || 0
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '日志加载失败，请重试')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  syncQuery(router, route, {
    keyword: filters.keyword,
    action: filters.action,
    result: filters.result,
    log_from: filters.from,
    log_to: filters.to,
    page: 1
  })
  reload(1)
}

function resetFilters() {
  filters.keyword = ''
  filters.action = ''
  filters.result = ''
  filters.from = ''
  filters.to = ''
  syncQuery(router, route, {
    keyword: '', action: '', result: '', log_from: '', log_to: '', page: 1, page_size: pageSize.value
  })
  reload(1)
}

function changePageSize(size) {
  pageSize.value = size
  syncQuery(router, route, { page: 1, page_size: size })
  reload(1)
}

function changePage(p) {
  syncQuery(router, route, { page: p, page_size: pageSize.value })
  reload(p)
}

/** 目标：优先展示中文名，其次原始 ID，两者都没有就显示「—」 */
function targetText(row) {
  const name = row.target_name || ''
  const id = row.target_id || ''
  if (name && id && name !== id) return `${name}（${id}）`
  return name || id || '—'
}

function targetTypeText(row) {
  return row.target_type ? row.target_type : '—'
}

/** 详情截断显示（按字符数，不是字节数） */
function detailPreview(row) {
  const text = String(row.details || '')
  if (!text) return '—'
  return text.length > DETAIL_PREVIEW ? text.slice(0, DETAIL_PREVIEW) + '…' : text
}

function hasMoreDetail(row) {
  return String(row.details || '').length > DETAIL_PREVIEW
}

function openDetail(row) {
  detailRow.value = row
  detailOpen.value = true
}

async function loadActionOptions() {
  try {
    const data = await authApi.permissions()
    const list = (data && data.actions) || []
    actionOptions.value = Array.isArray(list) ? list : []
    actionOptionsFailed.value = !actionOptions.value.length
  } catch (e) {
    // 只是下拉少了中文选项，日志本身照常可看，所以不弹错误，只在页面提示
    actionOptions.value = []
    actionOptionsFailed.value = true
  }
}

onMounted(() => {
  readQuery()
  loadActionOptions()
  reload(page.value)
})
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>操作日志</h1>
        <p>
          记录后台每一次写操作：谁、什么时候、对什么对象、结果如何。
          日志是只读的，用于事后追溯，不能在后台修改或删除。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="reload(page)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="adm-note">
      日志不会记录明文密码、API Key、支付密钥与完整卡密；卡密相关操作只记录脱敏串
      （例如 <span class="adm-mono">****1234</span>）。请勿把日志内容复制到公开渠道。
    </div>
    <div class="adm-note adm-note--muted">
      日志是只读的，用于事后追溯：出现「订单没发卡」「卡密被作废」这类争议时，
      在这里按关键字或动作筛选，再用「查看详情」看完整记录。
      <template v-if="roleLabel">当前登录角色：{{ roleLabel }}。</template>
    </div>

    <div class="adm-toolbar">
      <input
        v-model="filters.keyword"
        class="adm-input"
        type="search"
        placeholder="搜索操作人 / 目标 / 详情"
        @keyup.enter="search"
      >
      <select v-model="filters.action" class="adm-select" @change="search">
        <option value="">全部动作</option>
        <option v-for="opt in actionOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <select v-model="filters.result" class="adm-select" @change="search">
        <option value="">全部结果</option>
        <option value="success">成功</option>
        <option value="fail">失败</option>
      </select>
      <input v-model="filters.from" class="adm-input" type="date" title="起始日期（按关键字匹配）" @change="search">
      <input v-model="filters.to" class="adm-input" type="date" title="结束日期（按关键字匹配）" @change="search">
      <div class="adm-toolbar__right">
        <button class="adm-btn adm-btn--sm" type="button" @click="search">查询</button>
        <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
      </div>
    </div>
    <p v-if="actionOptionsFailed" class="adm-hint">
      动作下拉的选项没能加载出来（权限接口失败），下拉里暂时没有可选动作；可以先用关键字搜索，或刷新页面重试。
    </p>
    <p class="adm-hint">
      日期按「起始日期 结束日期」拼进关键字里参与模糊匹配（例如 <span class="adm-mono">2026-10-01 2026-10-15</span>），
      因为日志接口目前没有独立的日期参数，所以日期是「按内容匹配」而不是严格的区间筛选。
    </p>

    <AdminTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      min-width="1080px"
      empty-title="没有符合条件的日志"
      empty-hint="换个关键字或清空筛选再看；后台还没有任何写操作时这里也是空的"
    >
      <template #cell-created_at="{ row }">
        <span class="adm-nowrap" :title="row.created_at">{{ datetime(row.created_at) }}</span>
      </template>

      <template #cell-admin_name="{ row }">
        <div class="adm-strong">{{ row.admin_name || '—' }}</div>
        <div v-if="row.admin_role" class="adm-2xs adm-muted">{{ row.admin_role }}</div>
      </template>

      <template #cell-action_text="{ row }">
        {{ row.action_text || row.action || '—' }}
      </template>

      <template #cell-target="{ row }">
        <div>{{ targetTypeText(row) }}</div>
        <div class="adm-2xs adm-muted">{{ targetText(row) }}</div>
      </template>

      <template #cell-result_text="{ row }">
        <AdminTag :text="row.result_text || '—'" :kind="logResultKind(row.result)" />
      </template>

      <template #cell-ip="{ row }">
        <span class="adm-mono adm-2xs">{{ row.ip || '—' }}</span>
      </template>

      <template #cell-details="{ row }">
        <span :title="row.details || ''">{{ detailPreview(row) }}</span>
      </template>

      <template #cell-actions="{ row }">
        <button class="adm-link" type="button" @click="openDetail(row)">
          {{ hasMoreDetail(row) ? '查看详情' : '查看' }}
        </button>
      </template>

      <template #empty-action>
        <button v-if="hasAnyFilter" class="adm-btn" type="button" @click="resetFilters">清空筛选条件</button>
      </template>
    </AdminTable>

    <AdminPager
      :total="total"
      :page="page"
      :page-size="pageSize"
      @update:page="changePage"
      @update:page-size="changePageSize"
    />

    <AdminModal v-model="detailOpen" title="日志详情" size="lg">
      <div v-if="detailRow" class="adm-stack">
        <div class="adm-grid-2">
          <div class="adm-field">
            <label>时间</label>
            <div>{{ datetime(detailRow.created_at) }}（{{ detailRow.created_at || '—' }}）</div>
          </div>
          <div class="adm-field">
            <label>操作人</label>
            <div>{{ detailRow.admin_name || '—' }}<span v-if="detailRow.admin_role" class="adm-muted">（{{ detailRow.admin_role }}）</span></div>
          </div>
          <div class="adm-field">
            <label>动作</label>
            <div>{{ detailRow.action_text || '—' }}<span class="adm-muted">（{{ detailRow.action || '—' }}）</span></div>
          </div>
          <div class="adm-field">
            <label>结果</label>
            <div><AdminTag :text="detailRow.result_text || '—'" :kind="logResultKind(detailRow.result)" /></div>
          </div>
          <div class="adm-field">
            <label>目标类型</label>
            <div>{{ targetTypeText(detailRow) }}</div>
          </div>
          <div class="adm-field">
            <label>目标对象</label>
            <div>{{ targetText(detailRow) }}</div>
          </div>
          <div class="adm-field">
            <label>target_id</label>
            <div class="adm-mono">{{ detailRow.target_id || '—' }}</div>
          </div>
          <div class="adm-field">
            <label>IP</label>
            <div class="adm-mono">{{ detailRow.ip || '—' }}</div>
          </div>
          <div class="adm-field">
            <label>request_id</label>
            <div class="adm-mono">
              {{ detailRow.request_id || '—' }}
              <span v-if="!detailRow.request_id" class="adm-muted">（当前日志接口未返回该字段，可用操作人 + 时间 + 动作去服务端日志里对照）</span>
            </div>
          </div>
          <div class="adm-field">
            <label>日志 ID</label>
            <div class="adm-mono">{{ detailRow.id ?? '—' }}</div>
          </div>
        </div>

        <div class="adm-field adm-field--full">
          <label>完整详情</label>
          <div class="adm-card adm-card--flat">
            <p class="adm-mono" style="padding:12px;white-space:pre-wrap;word-break:break-word;line-height:1.8">
              {{ detailRow.details || '这条日志没有详情内容' }}
            </p>
          </div>
        </div>

        <div class="adm-note adm-note--muted">
          日志内容由服务端写入，后台不能修改。如果详情里没有你要的信息，说明当时的操作没有记录该字段。
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">关闭</button>
      </template>
    </AdminModal>
  </div>
</template>
