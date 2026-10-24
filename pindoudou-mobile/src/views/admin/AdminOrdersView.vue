<script setup>
/* =========================================================================
   后台订单管理（需求 §7）

   业务背景：支付渠道尚未接入，「管理员人工确认收款 → 发卡」是当前唯一的收款路径。
   所以这一页的重点不是按钮多，而是：
     - 人工记账必须留痕（备注 + 勾选确认「我确认已实际收到这笔款项」）；
     - 发卡幂等（已发放的订单不允许重复发，对应后端 40017）；
     - 库存不足时告诉运营下一步该干什么（后端 40025）；
     - 退款只做记账，不假装退款成功。
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import PixelIcon from '../../components/ui/PixelIcon.vue'

import { orderApi, planApi } from '../../lib/adminApi.js'
import { ApiError, money, moneyPlain, datetime, syncQuery } from '../../lib/api.js'
import { can, denyReason } from '../../composables/useAdminAuth.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import {
  run, paymentStatus, fulfillmentStatus, cardStatus, planStatus, benefitKind, toInt
} from '../../composables/useAdminKit.js'
import { toastWarn, toastErr } from '../../composables/useToast.js'

const route = useRoute()
const router = useRouter()

/* ------------------------------------------------------------------ 状态 */

const EMPTY_FILTERS = {
  order_no: '',
  keyword: '',
  payment_status: '',
  fulfillment_status: '',
  plan_id: '',
  created_from: '',
  created_to: ''
}

const filters = ref({ ...EMPTY_FILTERS })
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

/** 套餐下拉：包含草稿与已下架，历史订单的套餐也要能筛得到 */
const plans = ref([])

/** 订单详情弹窗 */
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref(null)

/** 人工确认收款表单弹窗 */
const settleOpen = ref(false)
const settleSubmitting = ref(false)
const settleOrder = ref(null)
const settleForm = ref({
  amount_paid: '',
  payment_method: 'manual',
  transaction_id: '',
  note: '',
  issue_cards: true
})

const detailEvents = computed(() => detail.value?.events || [])
const detailCards = computed(() => detail.value?.cards || [])
const detailNote = computed(() => (detail.value?.note || '').trim())

/* ------------------------------------------------------------------ 列表 */

async function loadPlans() {
  const data = await run(() => planApi.options())
  if (data === null) return
  plans.value = Array.isArray(data) ? data : (data.list || data.items || [])
}

function syncUrl() {
  syncQuery(router, route, {
    ...filters.value,
    page: page.value > 1 ? String(page.value) : '',
    page_size: pageSize.value === 20 ? '' : String(pageSize.value)
  })
}

async function reload(toPage = page.value) {
  page.value = Number(toPage) || 1
  syncUrl()
  loading.value = true
  try {
    const data = await orderApi.list({
      ...filters.value,
      page: page.value,
      page_size: pageSize.value
    })
    rows.value = data.list || []
    total.value = data.total || 0
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载失败，请重试')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function queryString(key) {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}

onMounted(() => {
  filters.value = {
    order_no: queryString('order_no'),
    keyword: queryString('keyword'),
    payment_status: queryString('payment_status'),
    fulfillment_status: queryString('fulfillment_status'),
    plan_id: queryString('plan_id'),
    created_from: queryString('created_from'),
    created_to: queryString('created_to')
  }
  const qPage = toInt(queryString('page'), 1)
  const qSize = toInt(queryString('page_size'), 20)
  page.value = qPage > 0 ? qPage : 1
  pageSize.value = [10, 20, 50, 100].includes(qSize) ? qSize : 20
  loadPlans()
  reload(page.value)
})

async function changePage(p) {
  await reload(p)
}

async function changePageSize(size) {
  pageSize.value = toInt(size, 20)
  await reload(1)
}

async function resetFilters() {
  filters.value = { ...EMPTY_FILTERS }
  await reload(1)
}

/* ------------------------------------------------------------------ 显示 */

function amountPaidText(row) {
  // 未支付时 amount_paid 是 0，显示 ¥0.00 会让人误以为收到过钱
  return row.payment_status === 'pending' ? '—' : money(row.amount_paid)
}

function paymentMethodText(row) {
  if (row.payment_method_text) return row.payment_method_text
  return { manual: '人工确认', wechat: '微信支付', alipay: '支付宝' }[row.payment_method] || '待配置'
}

function stateText(state) {
  if (!state) return ''
  const p = paymentStatus(state)
  if (['pending', 'paid', 'closed', 'refunding', 'refunded'].includes(state)) return p.text
  return fulfillmentStatus(state).text
}

function transitionText(fromState, toState) {
  const from = stateText(fromState)
  const to = stateText(toState)
  if (from && to) return `${from} → ${to}`
  return to || from || '—'
}

/** 权益快照：权益类型（quota / count 带额度） */
function benefitKindText(snapshot) {
  const benefit = snapshot?.benefit
  if (!benefit || !benefit.kind) return '—'
  const text = benefitKind(benefit.kind)
  if (benefit.kind === 'unlimited') return text
  const limit = toInt(benefit.usage_limit, 0)
  return limit > 0 ? `${text}（${limit}）` : text
}

/** 权益快照：有效期 */
function validityText(snapshot) {
  const days = toInt(snapshot?.valid_days, 0)
  if (days > 0) return `${days} 天`
  return '不设时长'
}

const columns = [
  { key: 'order_no', label: '订单号', width: '180px', nowrap: true },
  { key: 'user_account', label: '用户账号', width: '150px', nowrap: true },
  { key: 'plan_name', label: '套餐（快照）', width: '180px' },
  { key: 'amount_due', label: '应付金额', width: '104px', align: 'right', nowrap: true },
  { key: 'amount_paid', label: '实付金额', width: '104px', align: 'right', nowrap: true },
  { key: 'payment_method', label: '支付方式', width: '110px', nowrap: true },
  { key: 'payment_status', label: '支付状态', width: '104px', nowrap: true },
  { key: 'fulfillment_status', label: '发卡状态', width: '124px', nowrap: true },
  { key: 'card_issued_count', label: '已发卡密', width: '92px', align: 'right', nowrap: true },
  { key: 'created_at', label: '创建时间', width: '140px', nowrap: true },
  { key: 'paid_at', label: '支付时间', width: '140px', nowrap: true },
  { key: 'actions', label: '操作', width: '220px', nowrap: true }
]

const eventColumns = [
  { key: 'created_at', label: '时间', width: '140px', nowrap: true },
  { key: 'action_text', label: '动作', width: '120px', nowrap: true },
  { key: 'transition', label: '状态变化', width: '170px', nowrap: true },
  { key: 'note', label: '备注' },
  { key: 'admin_name', label: '操作人', width: '110px', nowrap: true }
]

const cardColumns = [
  { key: 'code_masked', label: '卡密（脱敏）', width: '180px', nowrap: true },
  { key: 'status', label: '状态', width: '104px', nowrap: true },
  { key: 'redeemed_at', label: '兑换时间', width: '140px', nowrap: true }
]

const PAYMENT_STATUS_OPTIONS = [
  ['pending', '待支付'],
  ['paid', '已支付'],
  ['closed', '已关闭'],
  ['refunding', '退款处理中'],
  ['refunded', '已退款']
]

const FULFILLMENT_STATUS_OPTIONS = [
  ['pending', '未发放'],
  ['issued', '已发放'],
  ['failed', '发放失败待处理'],
  ['canceled', '无需发放']
]

/* ------------------------------------------------------------------ 操作可用性 */

/**
 * 返回「为什么不能点」的中文说明；返回空字符串表示可以点。
 * 权限被拒时用权限原因，业务不允许时说明业务条件。
 */
function actionHint(row, perm, businessReason) {
  if (!can(perm)) return denyReason(perm)
  return businessReason || ''
}

function settleHint(row) {
  if (row.payment_status === 'pending') return ''
  return `只有「待支付」的订单可以人工确认收款，当前支付状态是「${paymentStatus(row.payment_status).text}」`
}

function issueHint(row) {
  if (row.fulfillment_status === 'issued') return '该订单已发放过卡密，不能重复发放'
  if (row.payment_status === 'refunded') return '该订单已退款，不能发放卡密'
  if (row.payment_status !== 'paid') {
    return `只有「已支付」的订单可以发卡，当前支付状态是「${paymentStatus(row.payment_status).text}」`
  }
  return ''
}

function closeHint(row) {
  if (row.payment_status === 'pending') return ''
  return `只有「待支付」的订单可以关闭，当前支付状态是「${paymentStatus(row.payment_status).text}」`
}

function refundHint(row) {
  if (row.payment_status === 'paid') return ''
  return `只有「已支付」的订单可以标记退款，当前支付状态是「${paymentStatus(row.payment_status).text}」`
}

function canSettle(row) {
  return can('order.settle') && row.payment_status === 'pending'
}

function canIssue(row) {
  return can('order.settle') && row.payment_status === 'paid' && row.fulfillment_status !== 'issued'
}

function canClose(row) {
  return can('order.settle') && row.payment_status === 'pending'
}

function canRefund(row) {
  return can('order.refund') && row.payment_status === 'paid'
}

/* ------------------------------------------------------------------ 详情 */

async function openDetail(row) {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await orderApi.detail(row.id)
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载订单详情失败，请重试')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function refreshDetailIfOpen(id) {
  if (!detailOpen.value) return
  const data = await run(() => orderApi.detail(id))
  if (data) detail.value = data
}

/* ------------------------------------------------------------------ 人工确认收款 */

function openSettle(row) {
  settleOrder.value = row
  settleForm.value = {
    amount_paid: moneyPlain(row.amount_due),
    payment_method: 'manual',
    transaction_id: '',
    note: '',
    issue_cards: true
  }
  settleOpen.value = true
}

async function submitSettle() {
  const row = settleOrder.value
  if (!row) return

  const amount = Number(settleForm.value.amount_paid)
  if (settleForm.value.amount_paid === '' || Number.isNaN(amount) || amount < 0) {
    toastWarn('实付金额必须是不小于 0 的数字')
    return
  }
  const cents = Math.round(amount * 100)
  if (Math.abs(cents / 100 - amount) > 1e-9) {
    toastWarn('实付金额最多保留两位小数')
    return
  }

  const note = settleForm.value.note.trim()
  if (note.length < 2) {
    toastWarn('请填写人工收款备注（至少 2 个字），它会写进订单记录与操作日志')
    return
  }
  const transactionId = settleForm.value.transaction_id.trim()
  if (transactionId.length > 64) {
    toastWarn('支付流水号不能超过 64 个字符')
    return
  }
  const methodText = paymentMethodText({
    payment_method: settleForm.value.payment_method
  })

  const ok = await confirmAction({
    title: '人工确认收款',
    message: `订单 ${row.order_no}（用户 ${row.user_account}，套餐「${row.plan_name}」）应付 ${money(row.amount_due)}，本次记录实付 ${money(amount)}，支付方式「${methodText}」。`,
    detail: settleForm.value.issue_cards
      ? '确认后系统会把该订单标记为「已支付」，记录操作人与时间；因为勾选了「立即发卡」，随后会按套餐配置从卡密库存里扣减并发放卡密、同时为该用户开通权益。发卡与权益开通不可撤销，若用户已兑换，退款不会自动收回权益。'
      : '确认后系统会把该订单标记为「已支付」并记录操作人与时间，本次不发卡；之后你仍可在订单列表单独执行「发卡」。',
    confirmText: '确认收款并记账',
    danger: true,
    reasonRequired: true,
    reasonLabel: '人工收款备注',
    reasonHint: '至少 2 个字，会写进订单状态记录与后台操作日志（人工收款必须留下凭证说明）。',
    reasonPlaceholder: '例如：已收到微信转账，转账时间 10:12',
    ackText: '我确认已实际收到这笔款项'
  })
  if (!ok) return

  const confirmNote = (ok.reason || '').trim()
  const finalNote = (transactionId
    ? `${confirmNote}（流水号：${transactionId}）`
    : confirmNote).slice(0, 255)

  settleSubmitting.value = true
  const result = await run(
    () => orderApi.settle(row.id, {
      amount_paid: Math.round(amount * 100) / 100,
      payment_method: settleForm.value.payment_method,
      transaction_id: transactionId,
      note: finalNote,
      issue_cards: settleForm.value.issue_cards
    }),
    { ok: '已记录人工收款', onError: warnIssueFailure }
  )
  settleSubmitting.value = false

  if (result === null) return
  settleOpen.value = false
  await reload(page.value)
  await refreshDetailIfOpen(row.id)
}

/**
 * 确认收款 + 立即发卡时，后端即使发卡失败也会返回成功，
 * 把失败原因写进订单 note 里（钱已经确认了，不能让运营以为没收到）。
 */
function warnIssueFailure(e) {
  if (!(e instanceof ApiError)) return
  if (e.code === 40025) {
    toastWarn('卡密库存不足：请先到「卡密管理」按该套餐生成卡密，再回到本页发卡')
  }
}

/* ------------------------------------------------------------------ 发卡 */

async function issueCards(row) {
  const ok = await confirmAction({
    title: '发放卡密',
    message: `订单 ${row.order_no}（用户 ${row.user_account}，套餐「${row.plan_name}」）当前支付状态「${paymentStatus(row.payment_status).text}」，本次要按套餐配置发放卡密。`,
    detail: '发放后订单会变成「已发放」，同时为该用户开通这份套餐的权益。同一张订单只能发放一次，不能重复发放。如果卡密库存不足，系统会提示你先去「卡密管理」按该套餐生成卡密。',
    confirmText: '确认发放卡密',
    danger: true,
    reasonRequired: true,
    reasonLabel: '发卡备注',
    reasonHint: '至少 2 个字，会写进订单状态记录与后台操作日志。',
    reasonPlaceholder: '例如：已核对用户付款，按订单发放'
  })
  if (!ok) return

  const result = await run(
    () => orderApi.issue(row.id, ok.reason.trim()),
    { ok: '已完成发卡', onError: onIssueError }
  )
  if (result === null) return
  await reload(page.value)
  await refreshDetailIfOpen(row.id)
}

function onIssueError(e) {
  if (!(e instanceof ApiError)) return
  if (e.code === 40025) {
    // 后端返回的中文错误已经 toast 过了，这里补一句运营该做的下一步
    toastWarn('卡密库存不足：请先到「卡密管理」选中该套餐生成卡密，生成后回到本页重新发卡')
  } else if (e.code === 40017) {
    toastWarn('该订单已发放过卡密，请刷新列表查看最新发卡状态')
  }
}

/* ------------------------------------------------------------------ 关闭订单 */

async function closeOrder(row) {
  const ok = await confirmAction({
    title: '关闭订单',
    message: `确认关闭订单 ${row.order_no}（用户 ${row.user_account}，套餐「${row.plan_name}」，应付 ${money(row.amount_due)}）？`,
    detail: '关闭后该订单变成「已关闭」，用户不能再对这个订单付款，也无法再发卡。如果这张订单下已经挂过未使用的卡密，它们会同时被作废，不能再被兑换。',
    confirmText: '确认关闭订单',
    danger: true,
    reasonRequired: true,
    reasonLabel: '关闭原因',
    reasonHint: '至少 2 个字，会写进订单状态记录与后台操作日志。',
    reasonPlaceholder: '例如：用户超时未付款，超时自动关闭'
  })
  if (!ok) return

  const result = await run(
    () => orderApi.close(row.id, ok.reason.trim()),
    { ok: '订单已关闭' }
  )
  if (result === null) return
  await reload(page.value)
  await refreshDetailIfOpen(row.id)
}

/* ------------------------------------------------------------------ 标记退款（人工记账） */

async function markRefund(row) {
  const ok = await confirmAction({
    title: '标记退款（人工记账）',
    message: `确认把订单 ${row.order_no}（用户 ${row.user_account}，实付 ${money(row.amount_paid)}）标记为「已退款」？`,
    detail: '这里只是记账：真实退款需要在支付渠道侧（微信 / 支付宝 / 线下转账）自己完成，系统不会替你退款、也不会假装退款成功。标记后该订单不能再发卡，已经发放的卡密与已开通的权益不会被自动收回，需要的话请另行处理。',
    confirmText: '确认标记已退款',
    danger: true,
    reasonRequired: true,
    reasonLabel: '退款备注',
    reasonHint: '至少 2 个字，说明退款渠道与凭证，会写进订单状态记录与后台操作日志。',
    reasonPlaceholder: '例如：已通过微信原路退回，凭证号 4200xxxx',
    ackText: '我确认已在支付渠道侧完成真实退款，这里只是补记账'
  })
  if (!ok) return

  const result = await run(
    () => orderApi.refund(row.id, ok.reason.trim()),
    { ok: '已标记退款（仅记账）' }
  )
  if (result === null) return
  await reload(page.value)
  await refreshDetailIfOpen(row.id)
}
</script>

<template>
  <div class="adm-page">
    <!-- ① 页头 -->
    <div class="adm-pagehead">
      <div>
        <h1>订单管理</h1>
        <p>
          这里能看到全部下单记录，并完成「人工确认收款 → 发卡」这条当前唯一的收款路径。
          只有「待支付」能确认收款与关闭，只有「已支付」能发卡与标记退款，已发放的订单不能重复发卡。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn" type="button" :disabled="loading" @click="reload(page)">刷新列表</button>
      </div>
    </div>

    <!-- ② 必须让运营知道的事实 -->
    <div class="adm-note adm-note--warn">
      当前未接入在线支付，这里的确认是人工记账，请先核实实际到账。
      确认收款会记录操作人与时间并留痕，但系统不会去支付渠道核对这笔钱。
    </div>

    <!-- ③ 工具条 -->
    <div class="adm-toolbar">
      <input
        v-model="filters.order_no"
        class="adm-input adm-input--sm"
        type="text"
        placeholder="订单号（精确）"
        @keyup.enter="reload(1)"
      >
      <input
        v-model="filters.keyword"
        class="adm-input adm-input--sm"
        type="text"
        placeholder="关键字：订单号 / 用户账号 / 套餐名"
        @keyup.enter="reload(1)"
      >
      <select v-model="filters.plan_id" class="adm-select adm-input--sm" @change="reload(1)">
        <option value="">全部套餐</option>
        <option v-for="p in plans" :key="p.id" :value="String(p.id)">
          {{ p.name }}{{ planStatus(p.status).text ? '（' + planStatus(p.status).text + '）' : '' }}
        </option>
      </select>
      <select v-model="filters.payment_status" class="adm-select adm-input--sm" @change="reload(1)">
        <option value="">全部支付状态</option>
        <option v-for="opt in PAYMENT_STATUS_OPTIONS" :key="opt[0]" :value="opt[0]">{{ opt[1] }}</option>
      </select>
      <select v-model="filters.fulfillment_status" class="adm-select adm-input--sm" @change="reload(1)">
        <option value="">全部发卡状态</option>
        <option v-for="opt in FULFILLMENT_STATUS_OPTIONS" :key="opt[0]" :value="opt[0]">{{ opt[1] }}</option>
      </select>
      <input
        v-model="filters.created_from"
        class="adm-input adm-input--sm"
        type="date"
        title="下单开始日期"
        @change="reload(1)"
      >
      <span class="adm-muted adm-2xs">至</span>
      <input
        v-model="filters.created_to"
        class="adm-input adm-input--sm"
        type="date"
        title="下单结束日期"
        @change="reload(1)"
      >
      <div class="adm-toolbar__right">
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="reload(1)">查询</button>
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="resetFilters">重置</button>
      </div>
    </div>

    <!-- ④ 列表 -->
    <AdminTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      min-width="1560px"
      empty-title="还没有订单记录"
      empty-hint="订单由用户在套餐页下单产生。可以先确认「套餐管理」里已有上架套餐，再把套餐链接发给用户；这里不提供手工建单。"
    >
      <template #cell-order_no="{ row }">
        <span class="adm-mono">{{ row.order_no }}</span>
      </template>

      <template #cell-plan_name="{ row }">
        <span class="adm-strong">{{ row.plan_name || '—' }}</span>
        <span
          v-if="row.plan_snapshot && row.plan_snapshot.name && row.plan_snapshot.name !== row.plan_name"
          class="adm-2xs adm-muted"
        >快照：{{ row.plan_snapshot.name }}</span>
      </template>

      <template #cell-amount_due="{ row }">{{ money(row.amount_due) }}</template>
      <template #cell-amount_paid="{ row }">{{ amountPaidText(row) }}</template>
      <template #cell-payment_method="{ row }">{{ paymentMethodText(row) }}</template>

      <template #cell-payment_status="{ row }">
        <AdminTag :text="paymentStatus(row.payment_status).text" :kind="paymentStatus(row.payment_status).kind" />
      </template>

      <template #cell-fulfillment_status="{ row }">
        <AdminTag
          :text="fulfillmentStatus(row.fulfillment_status).text"
          :kind="fulfillmentStatus(row.fulfillment_status).kind"
        />
      </template>

      <template #cell-card_issued_count="{ row }">
        <span :class="row.card_issued_count > 0 ? 'adm-strong' : 'adm-muted'">{{ row.card_issued_count || 0 }}</span>
      </template>

      <template #cell-created_at="{ row }">{{ datetime(row.created_at) }}</template>
      <template #cell-paid_at="{ row }">{{ row.paid_at ? datetime(row.paid_at) : '—' }}</template>

      <template #cell-actions="{ row }">
        <div class="adm-row">
          <button
            class="adm-btn adm-btn--sm adm-btn--ghost"
            type="button"
            :disabled="!can('order.view')"
            :title="can('order.view') ? undefined : denyReason('order.view')"
            @click="openDetail(row)"
          >详情</button>
          <button
            class="adm-btn adm-btn--sm"
            :class="canSettle(row) ? 'adm-btn--primary' : 'adm-btn--ghost'"
            type="button"
            :disabled="!canSettle(row)"
            :title="actionHint(row, 'order.settle', settleHint(row)) || undefined"
            @click="openSettle(row)"
          >确认收款</button>
          <button
            class="adm-btn adm-btn--sm adm-btn--ghost"
            type="button"
            :disabled="!canIssue(row)"
            :title="actionHint(row, 'order.settle', issueHint(row)) || undefined"
            @click="issueCards(row)"
          >发卡</button>
          <button
            class="adm-btn adm-btn--sm adm-btn--ghost"
            type="button"
            :disabled="!canRefund(row)"
            :title="actionHint(row, 'order.refund', refundHint(row)) || undefined"
            @click="markRefund(row)"
          >标记退款</button>
          <button
            class="adm-btn adm-btn--sm adm-btn--ghost"
            type="button"
            :disabled="!canClose(row)"
            :title="actionHint(row, 'order.settle', closeHint(row)) || undefined"
            @click="closeOrder(row)"
          >关闭订单</button>
        </div>
      </template>

      <template #empty-action>
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="resetFilters">清空筛选条件</button>
      </template>
    </AdminTable>

    <AdminPager
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
      @update:page="changePage"
      @update:page-size="changePageSize"
    />

    <!-- ⑤ 订单详情 -->
    <AdminModal v-model="detailOpen" title="订单详情" size="lg">
      <div v-if="detailLoading" class="adm-stack">
        <div class="adm-skeleton" style="height:22px;width:46%" />
        <div class="adm-skeleton" style="height:22px;width:64%" />
        <div class="adm-skeleton" style="height:22px;width:38%" />
      </div>

      <div v-else-if="detail" class="adm-stack">
        <div class="adm-row">
          <span class="adm-mono adm-strong">{{ detail.order_no }}</span>
          <AdminTag :text="paymentStatus(detail.payment_status).text" :kind="paymentStatus(detail.payment_status).kind" />
          <AdminTag
            :text="fulfillmentStatus(detail.fulfillment_status).text"
            :kind="fulfillmentStatus(detail.fulfillment_status).kind"
          />
          <span class="adm-2xs adm-muted">下单于 {{ datetime(detail.created_at) }}</span>
        </div>

        <div v-if="detailNote" class="adm-note adm-note--warn">
          系统备注：{{ detailNote }}
        </div>

        <div class="adm-card adm-card--flat">
          <div class="adm-card__head"><h2>订单信息</h2></div>
          <div class="adm-grid-2">
            <div class="adm-field">
              <label>用户账号</label>
              <div>{{ detail.user_account || '—' }}</div>
            </div>
            <div class="adm-field">
              <label>套餐名（订单快照）</label>
              <div>{{ detail.plan_name || '—' }}</div>
            </div>
            <div class="adm-field">
              <label>数量</label>
              <div>{{ detail.quantity || 1 }}</div>
            </div>
            <div class="adm-field">
              <label>应付金额</label>
              <div class="adm-strong">{{ money(detail.amount_due) }}</div>
            </div>
            <div class="adm-field">
              <label>实付金额</label>
              <div>{{ detail.payment_status === 'pending' ? '—' : money(detail.amount_paid) }}</div>
            </div>
            <div class="adm-field">
              <label>支付方式</label>
              <div>{{ paymentMethodText(detail) }}</div>
            </div>
            <div class="adm-field">
              <label>支付流水号</label>
              <div class="adm-mono">{{ detail.payment_transaction_id || '—' }}</div>
            </div>
            <div class="adm-field">
              <label>已发卡密数</label>
              <div>{{ detail.card_issued_count || 0 }}</div>
            </div>
            <div class="adm-field">
              <label>支付时间</label>
              <div>{{ detail.paid_at ? datetime(detail.paid_at) : '—' }}</div>
            </div>
            <div class="adm-field">
              <label>收款确认人 / 时间</label>
              <div>
                {{ detail.paid_confirm_name || '—' }}
                <span class="adm-2xs adm-muted">（{{ detail.paid_confirmed_at ? datetime(detail.paid_confirmed_at) : '—' }}）</span>
              </div>
            </div>
            <div class="adm-field">
              <label>发卡人 / 时间</label>
              <div>
                {{ detail.fulfilled_by_name || '—' }}
                <span class="adm-2xs adm-muted">（{{ detail.fulfilled_at ? datetime(detail.fulfilled_at) : '—' }}）</span>
              </div>
            </div>
            <div class="adm-field">
              <label>关闭时间</label>
              <div>{{ detail.closed_at ? datetime(detail.closed_at) : '—' }}</div>
            </div>
            <div class="adm-field">
              <label>退款时间</label>
              <div>{{ detail.refunded_at ? datetime(detail.refunded_at) : '—' }}</div>
            </div>
          </div>
        </div>

        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>价格与权益快照</h2>
            <span class="adm-2xs">下单那一刻拍照存档</span>
          </div>
          <div class="adm-grid-2">
            <div class="adm-field">
              <label>套餐名称</label>
              <div>{{ detail.plan_snapshot?.name || detail.plan_name || '—' }}</div>
            </div>
            <div class="adm-field">
              <label>套餐金额</label>
              <div>{{ detail.plan_snapshot ? money(detail.plan_snapshot.amount) : '—' }}</div>
            </div>
            <div class="adm-field">
              <label>权益类型</label>
              <div>{{ benefitKindText(detail.plan_snapshot) }}</div>
            </div>
            <div class="adm-field">
              <label>有效期</label>
              <div>{{ validityText(detail.plan_snapshot) }}</div>
            </div>
            <div class="adm-field adm-field--full">
              <label>权益说明（feature_text）</label>
              <ul v-if="detail.plan_snapshot && detail.plan_snapshot.feature_text && detail.plan_snapshot.feature_text.length" class="adm-stack" style="margin:0;padding-left:18px">
                <li v-for="(line, i) in detail.plan_snapshot.feature_text" :key="i">{{ line }}</li>
              </ul>
              <div v-else class="adm-muted">—</div>
            </div>
          </div>
          <div class="adm-note adm-note--muted">
            订单保存的是下单时的套餐与价格快照，之后修改套餐不会影响这张订单。
          </div>
        </div>

        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>状态变化记录</h2>
            <span class="adm-2xs">共 {{ detailEvents.length }} 条</span>
          </div>
          <AdminTable
            :columns="eventColumns"
            :rows="detailEvents"
            min-width="720px"
            empty-title="暂无状态变化记录"
            empty-hint="创建订单、确认收款、发卡、关闭、退款都会在这里留下一条记录。"
          >
            <template #cell-created_at="{ row }">{{ datetime(row.created_at) }}</template>
            <template #cell-action_text="{ row }">{{ row.action_text || row.action || '—' }}</template>
            <template #cell-transition="{ row }">{{ transitionText(row.from_state, row.to_state) }}</template>
            <template #cell-note="{ row }"><span class="adm-muted">{{ row.note || '—' }}</span></template>
            <template #cell-admin_name="{ row }">{{ row.admin_name || '—' }}</template>
          </AdminTable>
        </div>

        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>关联卡密</h2>
            <span class="adm-2xs">共 {{ detailCards.length }} 张 · 仅显示脱敏卡密</span>
          </div>
          <AdminTable
            :columns="cardColumns"
            :rows="detailCards"
            min-width="460px"
            empty-title="这张订单还没有关联卡密"
            empty-hint="订单确认收款并执行「发卡」后，发放的卡密会显示在这里。"
          >
            <template #cell-code_masked="{ row }"><span class="adm-mono">{{ row.code_masked || '—' }}</span></template>
            <template #cell-status="{ row }">
              <AdminTag :text="row.status_text || cardStatus(row.status).text" :kind="cardStatus(row.status).kind" />
            </template>
            <template #cell-redeemed_at="{ row }">{{ row.redeemed_at ? datetime(row.redeemed_at) : '—' }}</template>
          </AdminTable>
          <div class="adm-note adm-note--muted">
            订单页只展示脱敏卡密，不提供明文查看。需要明文请到「卡密管理」，并按权限与确认流程操作。
          </div>
        </div>
      </div>

      <div v-else class="adm-empty">
        <div class="adm-empty__icon"><PixelIcon name="folder" :size="26" /></div>
        <strong>没有取到订单详情</strong>
        <p>可能是订单已被删除，或者刚才的请求失败了。关掉弹窗刷新列表后再试一次。</p>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">关闭</button>
      </template>
    </AdminModal>

    <!-- ⑥ 人工确认收款表单 -->
    <AdminModal
      v-model="settleOpen"
      title="人工确认收款"
      size="sm"
      :mask-closable="false"
      :esc-closable="!settleSubmitting"
    >
      <div v-if="settleOrder" class="adm-stack">
        <div class="adm-row">
          <span class="adm-mono adm-strong">{{ settleOrder.order_no }}</span>
          <span class="adm-2xs adm-muted">{{ settleOrder.user_account }}</span>
        </div>

        <div class="adm-note adm-note--warn">
          当前未接入在线支付，这里的确认是人工记账，请先核实实际到账。
        </div>

        <div class="adm-field">
          <label>应付金额</label>
          <div class="adm-strong">{{ money(settleOrder.amount_due) }}</div>
        </div>

        <div class="adm-field">
          <label>实付金额 <em>*</em></label>
          <input v-model="settleForm.amount_paid" class="adm-input" type="number" min="0" step="0.01">
          <span class="adm-hint">默认等于应付金额；实际到账不足或超出时按真实到账金额填写。</span>
        </div>

        <div class="adm-field">
          <label>支付方式 <em>*</em></label>
          <select v-model="settleForm.payment_method" class="adm-select">
            <option value="manual">人工确认（线下转账 / 现金 / 其他）</option>
            <option value="wechat">微信支付</option>
            <option value="alipay">支付宝</option>
          </select>
          <span class="adm-hint">尚未配置真实支付渠道时只能用「人工确认」；选微信 / 支付宝会被服务端拒绝。</span>
        </div>

        <div class="adm-field">
          <label>支付流水号</label>
          <input
            v-model="settleForm.transaction_id"
            class="adm-input"
            type="text"
            maxlength="64"
            placeholder="选填，线下转账凭证号 / 支付平台订单号"
          >
        </div>

        <div class="adm-field">
          <label>收款备注 <em>*</em></label>
          <textarea
            v-model="settleForm.note"
            class="adm-textarea"
            maxlength="200"
            placeholder="例如：已收到微信转账，转账时间 10:12"
          />
          <span class="adm-hint">至少 2 个字，会写进订单状态记录与后台操作日志。</span>
        </div>

        <label class="adm-check">
          <input v-model="settleForm.issue_cards" type="checkbox">
          <span>确认收款后立即发卡（按套餐配置从卡密库存发放，并为用户开通权益）</span>
        </label>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" :disabled="settleSubmitting" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="settleSubmitting" @click="submitSettle">
          {{ settleSubmitting ? '提交中…' : '下一步：二次确认' }}
        </button>
      </template>
    </AdminModal>
  </div>
</template>
