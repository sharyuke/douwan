<script setup>
/* =========================================================================
   意见反馈（后台）
   - 数据来自前台右侧悬浮入口的提交（匿名也可提交）
   - 只读账号能看，处理 / 删除需要 feedback.manage
   - 状态只有「待处理 / 已处理」，重新打开会清空处理人与时间
   ========================================================================= */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, datetime, syncQuery } from '../../lib/api.js'
import { feedbackApi } from '../../lib/adminApi.js'
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import { can } from '../../composables/useAdminAuth.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import { toastErr, toastOk } from '../../composables/useToast.js'

const route = useRoute()
const router = useRouter()

const TYPE_OPTIONS = [
  { value: 'suggestion', label: '功能建议' },
  { value: 'bug', label: '使用问题' },
  { value: 'content', label: '内容错误' },
  { value: 'other', label: '其他' }
]

const columns = [
  { key: 'created_at', label: '时间', width: '132px', nowrap: true },
  { key: 'type_label', label: '类型', width: '92px' },
  { key: 'content', label: '反馈内容' },
  { key: 'user', label: '提交人 / 联系方式', width: '190px' },
  { key: 'page', label: '页面', width: '128px' },
  { key: 'status_label', label: '状态', width: '88px' },
  { key: 'actions', label: '操作', width: '80px', align: 'right' }
]

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const counts = reactive({ total: 0, new: 0, handled: 0 })

const filters = reactive({ status: '', type: '', keyword: '' })

const detailOpen = ref(false)
const detail = ref(null)
const note = ref('')
const saving = ref(false)

const canManage = computed(() => can('feedback.manage'))
const hasFilter = computed(() => !!(filters.status || filters.type || filters.keyword.trim()))
const emptyTitle = computed(() => (hasFilter.value ? '没有符合条件的反馈' : '还没有收到反馈'))
const emptyHint = computed(() => (hasFilter.value
  ? '换个筛选条件，或点下面的按钮清空筛选。'
  : '前台右侧的「反馈」小标签提交后会出现在这里；也可以先点「刷新」看看。'))

const kpis = computed(() => [
  { key: '', label: '全部反馈', value: counts.total, hint: '含已处理与待处理' },
  { key: 'new', label: '待处理', value: counts.new, hint: '点这里只看待处理', accent: counts.new > 0 },
  { key: 'handled', label: '已处理', value: counts.handled, hint: '已标记处理完的反馈' }
])

function pickText(value) {
  return typeof value === 'string' ? value : ''
}

/** 从地址栏读回筛选（刷新 / 分享链接后不丢） */
function readQuery() {
  filters.status = pickText(route.query.status)
  filters.type = pickText(route.query.type)
  filters.keyword = pickText(route.query.keyword)
  const p = Number(route.query.page)
  page.value = Number.isInteger(p) && p > 0 ? p : 1
  const size = Number(route.query.page_size)
  pageSize.value = [10, 20, 50, 100].includes(size) ? size : 20
}

async function reload(toPage = page.value) {
  page.value = toPage
  loading.value = true
  try {
    const data = await feedbackApi.list({
      status: filters.status,
      type: filters.type,
      keyword: filters.keyword.trim(),
      page: page.value,
      page_size: pageSize.value
    })
    rows.value = (data && data.list) || []
    total.value = (data && data.total) || 0
    const c = (data && data.counts) || {}
    counts.total = c.total || 0
    counts.new = c.new || 0
    counts.handled = c.handled || 0
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '反馈列表加载失败，请重试')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function syncFilters(extra = {}) {
  syncQuery(router, route, {
    status: filters.status,
    type: filters.type,
    keyword: filters.keyword.trim(),
    ...extra
  })
}

function search() {
  syncFilters({ page: 1 })
  reload(1)
}

function resetFilters() {
  filters.status = ''
  filters.type = ''
  filters.keyword = ''
  syncFilters({ page: 1, page_size: pageSize.value })
  reload(1)
}

function pickStatus(status) {
  filters.status = status
  search()
}

function changePage(p) {
  syncFilters({ page: p, page_size: pageSize.value })
  reload(p)
}

function changePageSize(size) {
  pageSize.value = size
  syncFilters({ page: 1, page_size: size })
  reload(1)
}

/** 内容摘要：列表里只显示前 70 个字，完整内容进弹窗 */
function preview(row) {
  const text = String(row.content || '')
  return text.length > 70 ? text.slice(0, 70) + '…' : text
}

function openDetail(row) {
  detail.value = row
  note.value = row.admin_note || ''
  detailOpen.value = true
}

function userText(row) {
  if (row.username) return row.username
  if (row.user_id) return `用户 #${row.user_id}`
  return '匿名访客'
}

async function setStatus(next) {
  if (!detail.value) return
  saving.value = true
  try {
    const updated = await feedbackApi.handle(detail.value.id, {
      status: next,
      admin_note: note.value.trim()
    })
    detail.value = updated
    note.value = updated.admin_note || ''
    toastOk(next === 'handled' ? '已标记为已处理' : '已重新打开')
    await reload(page.value)
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '保存失败，请重试')
  } finally {
    saving.value = false
  }
}

async function removeFeedback() {
  if (!detail.value) return
  const ok = await confirmAction({
    title: '删除这条反馈？',
    message: `将删除 ${userText(detail.value)} 提交的反馈。`,
    detail: '删除后前台与后台列表都不再显示；数据库保留软删除记录，必要时可由技术同学找回。',
    danger: true,
    confirmText: '删除反馈'
  })
  if (!ok) return

  saving.value = true
  try {
    await feedbackApi.remove(detail.value.id)
    toastOk('反馈已删除')
    detailOpen.value = false
    await reload(page.value)
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '删除失败，请重试')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  readQuery()
  reload(page.value)
})
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>意见反馈</h1>
        <p>
          前台右侧悬浮入口收到的反馈都在这里。匿名访客也能提交；
          处理完点「标记已处理」，需要跟进时重新打开即可。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="reload(page)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="adm-kpis">
      <button
        v-for="kpi in kpis" :key="kpi.label"
        class="adm-kpi adm-kpi--click"
        :class="{ 'adm-kpi--accent': kpi.accent, 'is-on': filters.status === kpi.key }"
        type="button"
        @click="pickStatus(kpi.key)"
      >
        <span class="adm-kpi__label">{{ kpi.label }}</span>
        <span class="adm-kpi__value">{{ kpi.value }}</span>
        <span class="adm-kpi__hint">{{ kpi.hint }}</span>
      </button>
    </div>

    <div class="adm-toolbar">
      <input
        v-model="filters.keyword"
        class="adm-input"
        type="search"
        placeholder="搜索反馈内容 / 联系方式 / 页面"
        @keyup.enter="search"
      >
      <select v-model="filters.type" class="adm-select" @change="search">
        <option value="">全部类型</option>
        <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
      <div class="adm-toolbar__right">
        <button class="adm-btn adm-btn--sm" type="button" @click="search">查询</button>
        <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
      </div>
    </div>

    <p class="adm-hint">
      反馈只用于改进产品，不会自动回复用户；要回复的话用用户留下的联系方式。
      删除是不可逆的软删除，只建议用于广告或垃圾内容。
    </p>

    <AdminTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      min-width="1020px"
      :empty-title="emptyTitle"
      :empty-hint="emptyHint"
    >
      <template #cell-created_at="{ row }">
        <span class="adm-nowrap" :title="row.created_at">{{ datetime(row.created_at) }}</span>
      </template>

      <template #cell-type_label="{ row }">
        <AdminTag :text="row.type_label || '其他'" kind="info" />
      </template>

      <template #cell-content="{ row }">
        <span :title="row.content">{{ preview(row) }}</span>
      </template>

      <template #cell-user="{ row }">
        <div class="adm-strong">{{ userText(row) }}</div>
        <div v-if="row.contact" class="adm-2xs adm-muted">{{ row.contact }}</div>
        <div v-else class="adm-2xs adm-muted">未留联系方式</div>
      </template>

      <template #cell-page="{ row }">
        <span class="adm-mono adm-2xs">{{ row.page || '—' }}</span>
      </template>

      <template #cell-status_label="{ row }">
        <AdminTag
          :text="row.status_label || '待处理'"
          :kind="row.status === 'handled' ? 'ok' : 'warn'"
        />
      </template>

      <template #cell-actions="{ row }">
        <button class="adm-link" type="button" @click="openDetail(row)">查看</button>
      </template>

      <template #empty-action>
        <button v-if="hasFilter" class="adm-btn" type="button" @click="resetFilters">清空筛选条件</button>
      </template>
    </AdminTable>

    <AdminPager
      :total="total"
      :page="page"
      :page-size="pageSize"
      @update:page="changePage"
      @update:page-size="changePageSize"
    />

    <AdminModal v-model="detailOpen" title="反馈详情" size="lg">
      <div v-if="detail" class="adm-stack">
        <div class="adm-grid-2">
          <div class="adm-field">
            <label>提交时间</label>
            <div>{{ datetime(detail.created_at) }}</div>
          </div>
          <div class="adm-field">
            <label>类型</label>
            <div>{{ detail.type_label || '其他' }}</div>
          </div>
          <div class="adm-field">
            <label>提交人</label>
            <div>
              {{ userText(detail) }}
              <span v-if="detail.user_id" class="adm-muted adm-mono">（ID {{ detail.user_id }}）</span>
            </div>
          </div>
          <div class="adm-field">
            <label>联系方式</label>
            <div>{{ detail.contact || '未留联系方式' }}</div>
          </div>
          <div class="adm-field">
            <label>所在页面</label>
            <div class="adm-mono">{{ detail.page || '—' }}</div>
          </div>
          <div class="adm-field">
            <label>状态</label>
            <div>
              <AdminTag
                :text="detail.status_label || '待处理'"
                :kind="detail.status === 'handled' ? 'ok' : 'warn'"
              />
              <span v-if="detail.handled_at" class="adm-muted adm-2xs" style="margin-left:6px">
                {{ detail.handled_by_name || '管理员' }} · {{ datetime(detail.handled_at) }}
              </span>
            </div>
          </div>
          <div class="adm-field">
            <label>IP</label>
            <div class="adm-mono adm-2xs">{{ detail.ip || '—' }}</div>
          </div>
          <div class="adm-field">
            <label>反馈 ID</label>
            <div class="adm-mono">{{ detail.id }}</div>
          </div>
        </div>

        <div class="adm-field adm-field--full">
          <label>反馈内容</label>
          <div class="adm-card adm-card--flat">
            <p class="fbContent">{{ detail.content }}</p>
          </div>
        </div>

        <div v-if="canManage" class="adm-field adm-field--full">
          <label>处理备注（仅后台可见）</label>
          <textarea
            v-model="note"
            class="adm-textarea"
            rows="3"
            maxlength="300"
            placeholder="例如：已复现，排进下个版本；或已通过邮箱回复"
          />
        </div>
        <div v-else class="adm-note adm-note--muted">
          当前账号只有查看权限，不能修改处理状态或删除反馈。
        </div>

        <div v-if="detail.admin_note && !canManage" class="adm-note adm-note--muted">
          处理备注：{{ detail.admin_note }}
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">关闭</button>
        <button
          v-if="canManage"
          class="adm-btn adm-btn--danger"
          type="button"
          :disabled="saving"
          @click="removeFeedback"
        >删除</button>
        <button
          v-if="canManage"
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="saving"
          @click="setStatus(detail && detail.status === 'handled' ? 'new' : 'handled')"
        >
          {{ detail && detail.status === 'handled' ? '重新打开' : '标记已处理' }}
        </button>
      </template>
    </AdminModal>
  </div>
</template>

<style scoped>
/* 指标卡可点击筛选：沿用后台 KPI 视觉，只补交互态 */
.adm-kpi--click {
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.adm-kpi--click.is-on {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(255, 214, 46, .18);
}

.fbContent {
  margin: 0;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
  font-size: var(--fs-sm);
}
</style>
