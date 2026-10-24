<script setup>
/* =========================================================================
   卡密管理（需求 §6，核心模块）
   安全口径：
   - 列表默认只显示脱敏卡密；查看明文需要 card.reveal 权限，且每次都要二次确认
     （服务端也会再校验一次并写操作日志）
   - 导出属于敏感操作，导出前必须确认；默认导出脱敏，明文导出需要显式勾选
   - 作废只对「未使用」的卡密生效，且必须填原因
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import { cardApi, planApi } from '../../lib/adminApi.js'
import { ApiError, datetime, fromNow, syncQuery } from '../../lib/api.js'
import { toastOk, toastWarn, toastErr } from '../../composables/useToast.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import { can, denyReason } from '../../composables/useAdminAuth.js'
import { run, cardStatus, copyWithToast, toInt, dayBefore } from '../../composables/useAdminKit.js'

const route = useRoute()
const router = useRouter()

/* ------------------------------------------------------------------ 状态 */

const tab = ref(route.query.tab === 'batches' ? 'batches' : 'list')

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

const batches = ref([])
const batchLoading = ref(false)

const plans = ref([])
const tags = ref([]) // 当前页出现过的批次名，仅用于提示

const meta = ref({ cipher_enabled: false, cipher_hint: '' })

const filters = ref({
  keyword: '',
  status: '',
  plan_id: '',
  batch_id: '',
  batch_name: '',
  expiring_in_days: '',
  created_from: '',
  created_to: '',
  redeemed_from: '',
  redeemed_to: ''
})

/** 已查看过明文的卡密：id → 明文。只存在内存里，刷新页面即清空。 */
const revealed = ref({})
const selected = ref([])

const columns = computed(() => {
  const cols = [
    { key: 'code_masked', label: '卡密', nowrap: true },
    { key: 'plan_name', label: '对应套餐' },
    { key: 'status', label: '状态' },
    { key: 'batch_name', label: '批次' },
    { key: 'created_at', label: '生成时间', nowrap: true },
    { key: 'redeem_expires_at', label: '兑换截止', nowrap: true },
    { key: 'redeemed', label: '兑换情况' },
    { key: 'order_no', label: '关联订单', nowrap: true },
    { key: 'actions', label: '操作', align: 'right', nowrap: true }
  ]
  return cols
})

/* ------------------------------------------------------------------ 加载 */

function initFiltersFromQuery() {
  const q = route.query
  for (const key of Object.keys(filters.value)) {
    if (typeof q[key] === 'string') filters.value[key] = q[key]
  }
  if (typeof q.page_size === 'string') pageSize.value = toInt(q.page_size, 20)
}

async function loadPlans() {
  const data = await run(() => planApi.options())
  if (data) plans.value = data
}

async function loadMeta() {
  const data = await run(() => cardApi.meta())
  if (data) meta.value = data
}

async function load(toPage = page.value) {
  page.value = toPage
  loading.value = true
  try {
    const data = await cardApi.list({
      ...filters.value,
      page: page.value,
      page_size: pageSize.value
    })
    rows.value = data.list || []
    total.value = data.total || 0
    selected.value = []
    // 给筛选下拉补上当前结果的批次名（服务端没有单独的批次列表接口时足够用）
    tags.value = [...new Set(rows.value.map(r => r.batch_name).filter(Boolean))]
    syncQuery(router, route, { ...filters.value, page: page.value, page_size: pageSize.value, tab: tab.value })
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载卡密列表失败')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadBatches() {
  batchLoading.value = true
  try {
    const data = await cardApi.batches({
      limit: 100,
      plan_id: filters.value.plan_id || undefined
    })
    batches.value = data || []
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载批次失败')
    batches.value = []
  } finally {
    batchLoading.value = false
  }
}

function switchTab(next) {
  tab.value = next
  syncQuery(router, route, { tab: next })
  if (next === 'batches') loadBatches()
  else load(1)
}

function resetFilters() {
  filters.value = {
    keyword: '', status: '', plan_id: '', batch_id: '', batch_name: '',
    expiring_in_days: '', created_from: '', created_to: '', redeemed_from: '', redeemed_to: ''
  }
  load(1)
}

function filterByBatch(batch) {
  filters.value.batch_id = batch.batch_id
  tab.value = 'list'
  load(1)
}

onMounted(async () => {
  initFiltersFromQuery()
  await Promise.all([loadPlans(), loadMeta()])
  if (tab.value === 'batches') await loadBatches()
  else await load(1)
})

/* ------------------------------------------------------------------ 生成卡密 */

const genOpen = ref(false)
const genForm = ref({
  plan_id: '',
  count: 10,
  batch_name: '',
  note: '',
  redeemExpiresDate: ''
})
const genResult = ref(null)
const genBusy = ref(false)

function openGenerate() {
  genForm.value = {
    plan_id: filters.value.plan_id || (plans.value[0] ? String(plans.value[0].id) : ''),
    count: 10,
    batch_name: '',
    note: '',
    redeemExpiresDate: ''
  }
  genResult.value = null
  genOpen.value = true
}

/** 当前选中的套餐（用于提示有效期与状态） */
const genPlan = computed(() =>
  plans.value.find(p => String(p.id) === String(genForm.value.plan_id)) || null
)

async function submitGenerate() {
  const f = genForm.value
  if (!f.plan_id) { toastWarn('请选择套餐'); return }
  const count = toInt(f.count, 0)
  if (count < 1) { toastWarn('生成数量至少为 1'); return }
  if (count > 1000) { toastWarn('单次最多生成 1000 张，请分批生成'); return }
  if (genPlan.value && genPlan.value.status === 'archived') {
    toastWarn('已下架的套餐不能生成新卡密，请先重新上架或另建套餐')
    return
  }
  if (genPlan.value && !genPlan.value.permission_count) {
    toastWarn('这个套餐没有配置任何权益，兑换后不会解锁任何功能；请先到「套餐管理」配置权益')
    return
  }

  const ok = await confirmAction({
    title: '确认生成卡密',
    message: `将为套餐「${genPlan.value ? genPlan.value.name : ''}」生成 ${count} 张卡密。`,
    detail: '生成后状态为「未使用」。明文卡密只在生成结果里显示一次，请立刻导出或复制保存；之后列表默认只显示脱敏卡密。',
    confirmText: `生成 ${count} 张`
  })
  if (!ok) return

  genBusy.value = true
  try {
    const body = {
      plan_id: Number(f.plan_id),
      count,
      batch_name: f.batch_name || undefined,
      note: f.note || undefined,
      redeem_expires_at: f.redeemExpiresDate ? new Date(f.redeemExpiresDate + 'T23:59:59').toISOString() : undefined
    }
    genResult.value = await cardApi.generate(body)
    toastOk(`已生成 ${genResult.value.count} 张卡密（批次 ${genResult.value.batch_id}）`)
    if (tab.value === 'batches') await loadBatches()
    await load(1)
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '生成卡密失败')
  } finally {
    genBusy.value = false
  }
}

/** 生成结果里的明文一键复制 */
async function copyAllGenerated() {
  if (!genResult.value) return
  await copyWithToast(genResult.value.codes.join('\n'), `已复制 ${genResult.value.codes.length} 张卡密`)
}

/** 生成结果直接下载成 txt（比 CSV 更适合直接发给客户） */
function downloadGenerated() {
  if (!genResult.value) return
  const text = genResult.value.codes.join('\n')
  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `卡密_${genResult.value.batch_id}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/* ------------------------------------------------------------------ 查看明文 */

const revealBusy = ref(false)

/** 明文是否已经在本地缓存里 */
function codeOf(row) {
  return revealed.value[row.id] || ''
}

async function revealRows(ids, label) {
  if (!meta.value.cipher_enabled) {
    toastWarn(meta.value.cipher_hint || '服务端未配置卡密加密密钥，无法查看明文')
    return
  }
  if (!ids.length) { toastWarn('请先选择要查看的卡密'); return }

  const ok = await confirmAction({
    title: '查看卡密明文',
    message: `确认查看 ${ids.length} 张卡密的明文（${label}）？`,
    detail: '明文属于敏感信息：每次查看都会写入操作日志（记录操作人、时间与卡密脱敏串）。请勿截图或转发到公开渠道。',
    confirmText: '确认查看',
    danger: true
  })
  if (!ok) return

  revealBusy.value = true
  try {
    const data = await cardApi.reveal(ids)
    const codes = data.codes || {}
    let found = 0
    for (const [id, code] of Object.entries(codes)) {
      if (code) {
        revealed.value = { ...revealed.value, [id]: code }
        found++
      }
    }
    if (!found) {
      toastWarn('这些卡密没有可解密的明文（很可能是配置加密密钥之前生成的）')
    } else {
      toastOk(`已显示 ${found} 张卡密明文`)
    }
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '查看明文失败')
  } finally {
    revealBusy.value = false
  }
}

async function copyCode(row) {
  const code = codeOf(row)
  if (code) {
    await copyWithToast(code, '卡密已复制')
    return
  }
  if (!can('card.reveal')) {
    toastWarn(denyReason('card.reveal'))
    return
  }
  await revealRows([row.id], row.code_masked)
}

/* ------------------------------------------------------------------ 导出 */

const exportOpen = ref(false)
const exportForm = ref({ reveal: false, status: '', plan_id: '', batch_id: '', keyword: '' })
const exportBusy = ref(false)

function openExport() {
  exportForm.value = {
    reveal: false,
    status: filters.value.status || '',
    plan_id: filters.value.plan_id || '',
    batch_id: filters.value.batch_id || '',
    keyword: filters.value.keyword || ''
  }
  exportOpen.value = true
}

async function submitExport() {
  const f = exportForm.value
  if (f.reveal && !can('card.reveal')) {
    toastWarn(denyReason('card.reveal'))
    return
  }
  const ok = await confirmAction({
    title: f.reveal ? '导出明文卡密' : '导出卡密（脱敏）',
    message: f.reveal
      ? '即将导出一份包含完整卡密明文的 CSV 文件。'
      : '即将导出一份卡密脱敏后的 CSV 文件。',
    detail: f.reveal
      ? '明文 CSV 一旦外泄，任何人都可以拿去兑换。请确认存放位置安全，导出行为已记录到操作日志。'
      : '脱敏导出可以安全用于对账与统计；如果需要交付卡密，请选择明文导出或直接复制。',
    confirmText: '确认导出',
    danger: f.reveal
  })
  if (!ok) return

  exportBusy.value = true
  try {
    const filename = await cardApi.export({
      reveal: f.reveal,
      status: f.status || undefined,
      plan_id: f.plan_id ? Number(f.plan_id) : undefined,
      batch_id: f.batch_id || undefined,
      keyword: f.keyword || undefined,
      limit: 50000
    })
    toastOk(`已开始下载：${filename}`)
    exportOpen.value = false
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '导出失败')
  } finally {
    exportBusy.value = false
  }
}

/* ------------------------------------------------------------------ 作废 */

const voidBusy = ref(false)

async function voidRows(ids, extraWarning) {
  if (!ids.length) { toastWarn('请先选择要作废的卡密'); return }

  // 提示里要明确「其中有已经发给客户的卡密」这种风险
  const issued = ids
    .map(id => rows.value.find(r => r.id === id))
    .filter(r => r && r.order_no)
  const detailParts = ['作废后这张卡密不能兑换。']
  if (issued.length) {
    detailParts.push(`选中的卡密里有 ${issued.length} 张已经关联订单（可能已经交付给客户），作废会影响已付款用户，请务必先与客户确认。`)
  }
  if (extraWarning) detailParts.push(extraWarning)

  const ok = await confirmAction({
    title: '作废卡密',
    message: `确认作废选中的 ${ids.length} 张卡密？`,
    detail: detailParts.join(' '),
    confirmText: '确认作废',
    danger: true,
    reasonRequired: true,
    reasonLabel: '作废原因',
    reasonHint: '至少 2 个字，会记录到操作日志。例如「测试批次清理」「客户退款后回收」。'
  })
  if (!ok) return

  voidBusy.value = true
  try {
    const result = await cardApi.void(ids, ok.reason)
    toastOk(result.message || `已作废 ${result.voided} 张`)
    if (result.skipped) {
      toastWarn(`有 ${result.skipped} 张卡密不是「未使用」状态，已自动跳过`)
    }
    await load(page.value)
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '作废失败')
  } finally {
    voidBusy.value = false
  }
}

/* ------------------------------------------------------------------ 选择 */

function toggleAll(checked) {
  selected.value = checked ? rows.value.filter(r => r.status === 'unused').map(r => r.id) : []
}

function toggleOne(id) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter(x => x !== id)
    : [...selected.value, id]
}

const allUnusedSelected = computed(() => {
  const unused = rows.value.filter(r => r.status === 'unused')
  return unused.length > 0 && unused.every(r => selected.value.includes(r.id))
})

/** 选中项里已经关联订单的数量，用于在操作栏提前提醒风险 */
const selectedIssuedCount = computed(() =>
  rows.value.filter(r => selected.value.includes(r.id) && r.order_no).length
)

const listColumns = computed(() => [
  { key: 'check', label: '', width: '42px' },
  ...columns.value
])
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>卡密管理</h1>
        <p>
          卡密与套餐解耦：生成时会保存当时的权益快照，之后修改或下架套餐都不会影响已发行的卡密。
          列表默认只显示脱敏卡密，查看明文与导出都会记录操作日志。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button
          class="adm-btn"
          type="button"
          :disabled="!can('card.export')"
          :title="can('card.export') ? '' : denyReason('card.export')"
          @click="openExport"
        >导出 CSV</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="!can('card.generate')"
          :title="can('card.generate') ? '' : denyReason('card.generate')"
          @click="openGenerate"
        >生成卡密</button>
      </div>
    </div>

    <!-- 没有配置加密密钥时，明文能力不可用，必须让运营提前知道 -->
    <div v-if="!meta.cipher_enabled" class="adm-note adm-note--warn">
      {{ meta.cipher_hint }}
    </div>

    <!-- 标签页：卡密列表 / 批次汇总 -->
    <div class="adm-chips">
      <button class="adm-chip" :class="{ on: tab === 'list' }" type="button" @click="switchTab('list')">卡密列表</button>
      <button class="adm-chip" :class="{ on: tab === 'batches' }" type="button" @click="switchTab('batches')">批次汇总</button>
    </div>

    <!-- ============================================ 卡密列表 -->
    <template v-if="tab === 'list'">
      <div class="adm-toolbar">
        <input
          v-model="filters.keyword"
          class="adm-input"
          placeholder="卡密 / 批次名 / 批次号 / 订单号"
          style="min-width:230px"
          @keyup.enter="load(1)"
        >
        <select v-model="filters.status" class="adm-select" @change="load(1)">
          <option value="">全部状态</option>
          <option value="unused">未使用</option>
          <option value="redeemed">已兑换</option>
          <option value="expired">已过期</option>
          <option value="voided">已作废</option>
        </select>
        <select v-model="filters.plan_id" class="adm-select" @change="load(1)">
          <option value="">全部套餐</option>
          <option v-for="p in plans" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
        </select>
        <input
          v-model="filters.batch_name"
          class="adm-input"
          placeholder="批次名称"
          @keyup.enter="load(1)"
        >
        <div class="adm-toolbar__right">
          <button class="adm-btn adm-btn--sm" type="button" @click="load(1)">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
        </div>
      </div>

      <div class="adm-toolbar">
        <label class="adm-2xs adm-muted">生成日期</label>
        <input v-model="filters.created_from" class="adm-input adm-input--sm" type="date" style="width:auto" @change="load(1)">
        <span class="adm-muted">~</span>
        <input v-model="filters.created_to" class="adm-input adm-input--sm" type="date" style="width:auto" @change="load(1)">
        <label class="adm-2xs adm-muted">兑换日期</label>
        <input v-model="filters.redeemed_from" class="adm-input adm-input--sm" type="date" style="width:auto" @change="load(1)">
        <span class="adm-muted">~</span>
        <input v-model="filters.redeemed_to" class="adm-input adm-input--sm" type="date" style="width:auto" @change="load(1)">
        <button
          class="adm-btn adm-btn--sm"
          type="button"
          :title="'只看 N 天内即将过期的未使用卡密'"
          @click="filters.expiring_in_days = filters.expiring_in_days ? '' : '7'; load(1)"
        >{{ filters.expiring_in_days ? '取消「即将过期」筛选' : '只看 7 天内即将过期' }}</button>
      </div>

      <!-- 批量操作栏：只有选中时才出现 -->
      <div v-if="selected.length" class="adm-note">
        已选 <b>{{ selected.length }}</b> 张卡密（其中 {{ selectedIssuedCount }} 张已关联订单）。
        <div class="adm-row" style="margin-top:8px">
          <button
            class="adm-btn adm-btn--sm"
            type="button"
            :disabled="!can('card.reveal')"
            :title="can('card.reveal') ? '' : denyReason('card.reveal')"
            @click="revealRows(selected, '批量查看')"
          >查看明文</button>
          <button
            class="adm-btn adm-btn--sm adm-btn--danger"
            type="button"
            :disabled="!can('card.revoke')"
            :title="can('card.revoke') ? '' : denyReason('card.revoke')"
            @click="voidRows(selected)"
          >批量作废</button>
          <button class="adm-btn adm-btn--sm adm-btn--ghost" type="button" @click="selected = []">取消选择</button>
        </div>
      </div>

      <AdminTable
        :columns="listColumns"
        :rows="rows"
        :loading="loading"
        min-width="1180px"
        empty-title="还没有卡密"
        empty-hint="先到「套餐管理」把套餐配置好并上架，再回到这里按套餐批量生成卡密。"
      >
        <template #cell-check="{ row }">
          <input
            type="checkbox"
            :checked="selected.includes(row.id)"
            :disabled="row.status !== 'unused'"
            :title="row.status === 'unused' ? '' : '只有「未使用」的卡密可以批量操作'"
            @change="toggleOne(row.id)"
          >
        </template>

        <template #cell-code_masked="{ row }">
          <div class="adm-row" style="gap:6px">
            <span class="adm-mono adm-strong">{{ codeOf(row) || row.code_masked }}</span>
            <button
              v-if="!codeOf(row)"
              class="adm-link"
              type="button"
              :disabled="!can('card.reveal') || revealBusy"
              :title="can('card.reveal') ? '查看明文（会记入操作日志）' : denyReason('card.reveal')"
              @click="revealRows([row.id], row.code_masked)"
            >明文</button>
            <button
              v-else
              class="adm-link"
              type="button"
              @click="copyCode(row)"
            >复制</button>
          </div>
        </template>

        <template #cell-plan_name="{ row }">
          {{ row.plan_name || '—' }}
        </template>

        <template #cell-status="{ row }">
          <AdminTag :text="cardStatus(row.status).text" :kind="cardStatus(row.status).kind" :title="cardStatus(row.status).hint" />
        </template>

        <template #cell-batch_name="{ row }">
          <div>{{ row.batch_name || '—' }}</div>
          <div class="adm-2xs adm-muted adm-mono">{{ row.batch_id }}</div>
        </template>

        <template #cell-created_at="{ row }">
          <span :title="datetime(row.created_at)">{{ fromNow(row.created_at) }}</span>
        </template>

        <template #cell-redeem_expires_at="{ row }">
          <span v-if="row.redeem_expires_at">{{ datetime(row.redeem_expires_at) }}</span>
          <span v-else class="adm-muted">不过期</span>
        </template>

        <template #cell-redeemed="{ row }">
          <template v-if="row.status === 'redeemed'">
            <div>{{ row.redeemed_account || ('用户 #' + row.redeemed_by) }}</div>
            <div class="adm-2xs adm-muted">{{ datetime(row.redeemed_at) }}</div>
            <div v-if="row.entitlement_expires_at" class="adm-2xs adm-muted">
              权益至 {{ datetime(row.entitlement_expires_at) }}
            </div>
            <div v-else-if="row.entitlement_id" class="adm-2xs adm-muted">权益不限时长</div>
          </template>
          <span v-else class="adm-muted">—</span>
        </template>

        <template #cell-order_no="{ row }">
          <span v-if="row.order_no" class="adm-mono">{{ row.order_no }}</span>
          <span v-else class="adm-muted">—</span>
        </template>

        <template #cell-actions="{ row }">
          <div class="adm-row" style="justify-content:flex-end;gap:6px">
            <button
              class="adm-link"
              type="button"
              :disabled="!can('card.reveal')"
              :title="can('card.reveal') ? '复制卡密明文' : denyReason('card.reveal')"
              @click="copyCode(row)"
            >复制</button>
            <button
              class="adm-link"
              type="button"
              :disabled="row.status !== 'unused' || !can('card.revoke')"
              :title="row.status !== 'unused'
                ? '只有「未使用」的卡密可以作废；已兑换的卡密需要走权益撤销'
                : (can('card.revoke') ? '' : denyReason('card.revoke'))"
              @click="voidRows([row.id])"
            >作废</button>
          </div>
        </template>
      </AdminTable>

      <AdminPager
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
        @update:page="load"
        @update:page-size="load(1)"
      />
    </template>

    <!-- ============================================ 批次汇总 -->
    <template v-else>
      <div class="adm-toolbar">
        <select v-model="filters.plan_id" class="adm-select" @change="loadBatches">
          <option value="">全部套餐</option>
          <option v-for="p in plans" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
        </select>
        <div class="adm-toolbar__right">
          <button class="adm-btn adm-btn--sm" type="button" @click="loadBatches">刷新</button>
        </div>
      </div>

      <AdminTable
        :columns="[
          { key: 'batch_id', label: '批次号', nowrap: true },
          { key: 'batch_name', label: '批次名称' },
          { key: 'plan_name', label: '套餐' },
          { key: 'total', label: '总数', align: 'right' },
          { key: 'unused', label: '未使用', align: 'right' },
          { key: 'redeemed', label: '已兑换', align: 'right' },
          { key: 'voided', label: '已作废', align: 'right' },
          { key: 'created_at', label: '生成时间', nowrap: true },
          { key: 'actions', label: '操作', align: 'right', nowrap: true }
        ]"
        :rows="batches"
        :loading="batchLoading"
        row-key="batch_id"
        min-width="980px"
        empty-title="还没有批次"
        empty-hint="生成卡密时会自动创建一个批次，用于按批次查询与导出。"
      >
        <template #cell-batch_id="{ row }">
          <span class="adm-mono">{{ row.batch_id }}</span>
        </template>
        <template #cell-created_at="{ row }">
          {{ datetime(row.created_at) }}
        </template>
        <template #cell-actions="{ row }">
          <button class="adm-link" type="button" @click="filterByBatch(row)">查看该批卡密</button>
        </template>
      </AdminTable>
    </template>

    <!-- ============================================ 生成弹窗 -->
    <AdminModal v-model="genOpen" title="生成卡密" :mask-closable="!genResult">
      <div v-if="!genResult" class="adm-stack">
        <div class="adm-form adm-form--2">
          <div class="adm-field adm-field--full">
            <label>选择套餐 <em>*</em></label>
            <select v-model="genForm.plan_id" class="adm-select">
              <option value="">请选择套餐</option>
              <option v-for="p in plans" :key="p.id" :value="String(p.id)"
                      :disabled="!p.permission_count">
                {{ p.name }}（{{ p.status === 'published' ? '已上架' : p.status === 'draft' ? '草稿' : '已下架' }} · {{ p.validity_text }}{{ !p.permission_count ? ' · 未配置权益' : '' }}）
              </option>
            </select>
            <span class="adm-hint">
              卡密会保存该套餐当前的权益快照；之后改套餐不会影响这批卡密。
            </span>
          </div>

          <div class="adm-field">
            <label>生成数量 <em>*</em></label>
            <input v-model="genForm.count" class="adm-input" type="number" min="1" max="1000" step="1">
            <span class="adm-hint">1 ~ 1000 张，单次上限由服务端配置决定。</span>
          </div>

          <div class="adm-field">
            <label>批次名称</label>
            <input v-model="genForm.batch_name" class="adm-input" placeholder="例如：首发测试批次">
            <span class="adm-hint">留空会自动用「套餐名 + 批次」命名。</span>
          </div>

          <div class="adm-field">
            <label>卡密兑换截止日期</label>
            <input v-model="genForm.redeemExpiresDate" class="adm-input" type="date">
            <span class="adm-hint">
              留空表示卡密不过期。注意：这是「卡密本身」的兑换截止时间，
              和用户兑换后拿到的权益有效期是两回事。
            </span>
          </div>

          <div class="adm-field">
            <label>备注</label>
            <input v-model="genForm.note" class="adm-input" placeholder="例如：线下渠道 / 某平台订单">
          </div>
        </div>

        <div v-if="genPlan && (!genPlan.permission_count || genPlan.status !== 'published')" class="adm-note adm-note--warn">
          <template v-if="!genPlan.permission_count">
            选中的套餐<strong>没有配置任何权益</strong>，生成的卡密兑换后不会解锁任何功能。
            请先到「套餐管理」把权益配好，再回来生成卡密。
          </template>
          <template v-else>
            选中的套餐当前是「{{ genPlan.status === 'draft' ? '草稿' : '已下架' }}」状态：
            卡密可以先生成，但前台购买页不会展示该套餐。
          </template>
        </div>
      </div>

      <!-- 生成结果：明文只在这里出现一次 -->
      <div v-else class="adm-stack">
        <div class="adm-note adm-note--warn">
          <b>明文卡密只在这里显示一次</b>，关闭后列表只会显示脱敏卡密。
          请立刻复制或下载保存，避免后续无法交付。
        </div>
        <div class="adm-row">
          <span>批次 <b class="adm-mono">{{ genResult.batch_id }}</b></span>
          <span class="adm-muted">·</span>
          <span>{{ genResult.plan_name }}</span>
          <span class="adm-muted">·</span>
          <span>共 <b>{{ genResult.count }}</b> 张</span>
        </div>
        <textarea class="adm-textarea adm-mono" style="min-height:210px" readonly :value="genResult.codes.join('\n')" />
      </div>

      <template #footer="{ close }">
        <template v-if="!genResult">
          <button class="adm-btn" type="button" :disabled="genBusy" @click="close">取消</button>
          <button class="adm-btn adm-btn--primary" type="button" :disabled="genBusy" @click="submitGenerate">
            {{ genBusy ? '生成中…' : '确认生成' }}
          </button>
        </template>
        <template v-else>
          <button class="adm-btn" type="button" @click="downloadGenerated">下载 TXT</button>
          <button class="adm-btn" type="button" @click="copyAllGenerated">复制全部</button>
          <button class="adm-btn adm-btn--primary" type="button" @click="close">我已保存，关闭</button>
        </template>
      </template>
    </AdminModal>

    <!-- ============================================ 导出弹窗 -->
    <AdminModal v-model="exportOpen" title="导出卡密 CSV" size="sm" :mask-closable="false">
      <div class="adm-stack">
        <div class="adm-field">
          <label>导出范围</label>
          <span class="adm-hint">
            导出条件与当前列表筛选一致：可以在这里再调整一次。
          </span>
        </div>
        <div class="adm-field">
          <label>状态</label>
          <select v-model="exportForm.status" class="adm-select">
            <option value="">全部状态</option>
            <option value="unused">未使用</option>
            <option value="redeemed">已兑换</option>
            <option value="expired">已过期</option>
            <option value="voided">已作废</option>
          </select>
        </div>
        <div class="adm-field">
          <label>套餐</label>
          <select v-model="exportForm.plan_id" class="adm-select">
            <option value="">全部套餐</option>
            <option v-for="p in plans" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
          </select>
        </div>
        <div class="adm-field">
          <label>关键字</label>
          <input v-model="exportForm.keyword" class="adm-input" placeholder="卡密 / 批次 / 订单号">
        </div>
        <label class="adm-check">
          <input v-model="exportForm.reveal" type="checkbox" :disabled="!can('card.reveal')">
          <span>导出明文卡密（用于实际交付）</span>
        </label>
        <div class="adm-note" :class="exportForm.reveal ? 'adm-note--danger' : 'adm-note--muted'">
          <template v-if="exportForm.reveal">
            明文导出属于敏感操作：文件里每一行都是可以直接兑换的卡密，
            请确认存放位置安全。导出行为会记录到操作日志。
          </template>
          <template v-else>
            脱敏导出只包含卡密的脱敏串，可以安全用于对账与统计，但**不能**直接交付给用户。
          </template>
        </div>
      </div>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="exportBusy" @click="submitExport">
          {{ exportBusy ? '导出中…' : '确认导出' }}
        </button>
      </template>
    </AdminModal>
  </div>
</template>
