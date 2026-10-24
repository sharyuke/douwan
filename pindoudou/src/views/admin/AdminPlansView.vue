<script setup>
/* =========================================================================
   套餐管理（后台需求 §5）
   - 核心：价格与权益全部由运营在后台配置，代码里不写死任何定价（§0.5 / §5.4）
   - 新建的套餐默认是草稿；上架前先在服务端校验，前端也会先给出具体缺哪个字段
   - 功能权限（feature_permissions）只写「运营显式打开 / 填数」的键，
     没写的键在服务端会沿用免费版口径（entitlement.Merge 的语义）
   ========================================================================= */

import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'

import { authApi, planApi } from '../../lib/adminApi.js'
import { ApiError, datetime, money, syncQuery } from '../../lib/api.js'
import { can, denyReason } from '../../composables/useAdminAuth.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import { benefitKind, planStatus, priceValue, run, toInt, validityType } from '../../composables/useAdminKit.js'
import { toastErr, toastOk, toastWarn } from '../../composables/useToast.js'

const route = useRoute()
const router = useRouter()

/** 本页所有写操作都要这个权限；没有权限时按钮保留但禁用（需求 §3.3） */
const PERM = 'plan.manage'
const noPermTitle = () => (can(PERM) ? '' : denyReason(PERM))

/* ------------------------------------------------------------------ 列表 */

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

const filters = reactive({ keyword: '', status: '' })

const columns = [
  { key: 'name', label: '套餐名称', width: '230px' },
  { key: 'code', label: '标识', width: '140px', nowrap: true },
  { key: 'price', label: '售价', width: '110px', align: 'right', nowrap: true },
  { key: 'original_price', label: '划线价', width: '110px', align: 'right', nowrap: true },
  { key: 'benefit_type', label: '权益类型', width: '110px', nowrap: true },
  { key: 'validity_text', label: '有效期', width: '120px', nowrap: true },
  { key: 'status', label: '状态', width: '110px', nowrap: true },
  { key: 'sort_order', label: '排序值', width: '80px', align: 'right', nowrap: true },
  { key: 'order_count', label: '已产生订单数', width: '110px', align: 'right', nowrap: true },
  { key: 'card_key_count', label: '卡密数', width: '90px', align: 'right', nowrap: true },
  { key: 'updated_at', label: '更新时间', width: '150px', nowrap: true },
  { key: 'actions', label: '操作', width: '300px', nowrap: true }
]

function readFiltersFromQuery() {
  const q = route.query
  filters.keyword = typeof q.keyword === 'string' ? q.keyword : ''
  filters.status = typeof q.status === 'string' ? q.status : ''
  page.value = Math.max(1, toInt(q.page, 1) || 1)
}

async function reload(toPage = page.value) {
  page.value = toPage
  loading.value = true
  try {
    const data = await planApi.list({
      keyword: filters.keyword,
      status: filters.status,
      page: page.value,
      page_size: pageSize.value
    })
    rows.value = (data && data.list) || []
    total.value = (data && data.total) || 0
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载失败，请重试')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  syncQuery(router, route, { keyword: filters.keyword, status: filters.status })
  reload(1)
}

function resetFilters() {
  filters.keyword = ''
  filters.status = ''
  syncQuery(router, route, { keyword: '', status: '' })
  reload(1)
}

onMounted(async () => {
  readFiltersFromQuery()
  reload(page.value)
  loadFeatures()
})

/* ------------------------------------------------------------------ 功能权限可选项 */

const features = ref([])
const featuresError = ref('')

async function loadFeatures() {
  try {
    const data = await authApi.permissions()
    features.value = (data && data.features) || []
    featuresError.value = ''
  } catch (e) {
    features.value = []
    featuresError.value = e instanceof ApiError ? e.message : '功能权限清单加载失败'
  }
}

/* ------------------------------------------------------------------ 表单 */

/** 表单里的布尔开关（本地 UI 状态，不直接发给服务端） */
const boolOn = reactive({})
/** 表单里的数字权限（本地 UI 状态） */
const numVal = reactive({})

const editOpen = ref(false)
const editId = ref(0)
const saving = ref(false)
/** 定稿时发现「已保存的权限键」在当前权限清单里不存在 */
const stalePermKeys = ref([])

function defaultForm() {
  return {
    code: '',
    name: '',
    short_desc: '',
    front_desc: '',
    tagline: '',
    tag: '',
    price: '0',
    original_price: '',
    benefit_kind: 'unlimited',
    usage_limit: '',
    validity_type: 'none',
    validity_value: '',
    start_on: 'redeem',
    card_quantity: 1,
    batch_size: 10,
    feature_text: [],
    allow_repeat_purchase: false,
    sort_order: 0
  }
}

const form = reactive(defaultForm())

function resetFeatureState(permissions) {
  for (const k of Object.keys(boolOn)) delete boolOn[k]
  for (const k of Object.keys(numVal)) delete numVal[k]

  const perms = permissions && typeof permissions === 'object' && !Array.isArray(permissions) ? permissions : {}
  const known = new Set(features.value.map(f => f.key))
  const stale = []

  for (const [key, value] of Object.entries(perms)) {
    if (!known.has(key)) {
      stale.push(key)
      continue
    }
    if (typeof value === 'boolean' || value === true || value === false) {
      boolOn[key] = value === true
    } else if (value === null || value === undefined || value === '') {
      /* 空值视为没配置，保持「沿用免费版」 */
    } else {
      numVal[key] = String(value)
    }
  }
  stalePermKeys.value = stale
}

function openCreate() {
  Object.assign(form, defaultForm())
  form.feature_text = ['']
  resetFeatureState({})
  editId.value = 0
  editOpen.value = true
}

async function openEdit(row) {
  Object.assign(form, defaultForm())
  fillFormFrom(row)
  resetFeatureState(row.feature_permissions)
  editId.value = row.id
  editOpen.value = true

  // 列表项已经带了权限与清单，但描述类字段仍以详情为准，保证编辑时不会丢内容
  const detail = await run(() => planApi.detail(row.id))
  if (!detail) return
  fillFormFrom(detail)
  resetFeatureState(detail.feature_permissions)
  const texts = Array.isArray(detail.feature_text) ? detail.feature_text.slice() : []
  form.feature_text = texts.length ? texts : ['']
}

function fillFormFrom(p) {
  const cfg = (p && p.benefit_config) || {}
  form.code = p.code || ''
  form.name = p.name || ''
  form.short_desc = p.short_desc || ''
  form.front_desc = p.front_desc || ''
  form.tagline = p.tagline || ''
  form.tag = p.tag || ''
  form.price = p.price === undefined || p.price === null ? '0' : String(p.price)
  form.original_price = p.original_price === undefined || p.original_price === null ? '' : String(p.original_price)
  form.benefit_kind = cfg.kind || p.benefit_type || 'unlimited'
  form.usage_limit = cfg.usage_limit ? String(cfg.usage_limit) : ''
  form.validity_type = cfg.validity_type || p.validity_type || 'none'
  form.validity_value = cfg.validity_value ? String(cfg.validity_value) : ''
  form.start_on = cfg.start_on || 'redeem'
  form.card_quantity = p.card_quantity || 1
  form.batch_size = p.batch_size || 10
  form.feature_text = Array.isArray(p.feature_text) ? p.feature_text.slice() : ['']
  form.allow_repeat_purchase = !!p.allow_repeat_purchase
  form.sort_order = p.sort_order || 0
}

function addFeatureText() {
  if (!Array.isArray(form.feature_text)) form.feature_text = []
  form.feature_text.push('')
}

function removeFeatureText(index) {
  form.feature_text.splice(index, 1)
  if (!form.feature_text.length) form.feature_text.push('')
}

function onKindChange() {
  if (form.benefit_kind === 'unlimited') form.usage_limit = ''
}

function onValidityTypeChange() {
  if (form.validity_type === 'none') form.validity_value = ''
}

/* ----------------------------------------------- 功能权限：只写显式配置的键 */

function isFeatureOn(feature) {
  return boolOn[feature.key] === true
}

function onFeatureToggle(feature, event) {
  if (event.target.checked) boolOn[feature.key] = true
  else delete boolOn[feature.key]
}

function onFeatureNumber(feature, event) {
  const raw = event.target.value
  if (raw === '' || raw === null) delete numVal[feature.key]
  else numVal[feature.key] = String(raw)
}

/**
 * 组装 feature_permissions。
 * 重要：布尔功能只在「显式打开」时写 true，不写 false —— 不写这个键就表示沿用免费版口径。
 */
function buildFeaturePermissions() {
  const out = {}
  if (features.value.length) {
    for (const f of features.value) {
      if (f.value_type === 'number') {
        const raw = numVal[f.key]
        if (raw === undefined || raw === '' || raw === null) continue
        const n = Number(raw)
        if (!Number.isNaN(n) && n >= 0) out[f.key] = n
      } else if (boolOn[f.key] === true) {
        out[f.key] = true
      }
    }
  } else {
    // 权限清单没拉到（网络问题）时，也不要丢掉运营已经填好的内容
    for (const [key, on] of Object.entries(boolOn)) if (on === true) out[key] = true
    for (const [key, raw] of Object.entries(numVal)) {
      const n = Number(raw)
      if (!Number.isNaN(n) && n >= 0) out[key] = n
    }
  }
  for (const key of stalePermKeys.value) {
    if (out[key] === undefined) out[key] = true
  }
  return out
}

function buildPayload() {
  const unlimited = form.benefit_kind === 'unlimited'
  const usageLimit = unlimited ? 0 : toInt(form.usage_limit, 0)
  const noValidity = form.validity_type === 'none'
  const validityValue = noValidity ? 0 : toInt(form.validity_value, 0)
  const price = Number(form.price)
  const hasOriginal = String(form.original_price).trim() !== ''

  return {
    code: String(form.code || '').trim(),
    name: String(form.name || '').trim(),
    short_desc: String(form.short_desc || '').trim(),
    front_desc: String(form.front_desc || '').trim(),
    tagline: String(form.tagline || '').trim(),
    tag: String(form.tag || '').trim(),
    price: Number.isNaN(price) ? 0 : price,
    original_price: hasOriginal ? Number(form.original_price) : null,
    benefit_type: form.benefit_kind,
    benefit_config: {
      kind: form.benefit_kind,
      usage_limit: usageLimit,
      validity_type: form.validity_type,
      validity_value: validityValue,
      start_on: form.start_on
    },
    // 一定是对象，不是数组；只含运营显式配置的键
    feature_permissions: buildFeaturePermissions(),
    feature_text: (Array.isArray(form.feature_text) ? form.feature_text : [])
      .map(t => String(t || '').trim())
      .filter(Boolean),
    allow_repeat_purchase: !!form.allow_repeat_purchase,
    card_quantity: toInt(form.card_quantity, 1),
    batch_size: toInt(form.batch_size, 10),
    sort_order: toInt(form.sort_order, 0)
  }
}

/* ------------------------------------------------------------------ 校验 */

/** 基础字段校验，返回第一条错误的中文说明（null 表示通过） */
function fieldError() {
  const name = String(form.name || '').trim()
  if (!name) return '请先填写「套餐名称」'
  if (name.length > 64) return '套餐名称最多 64 个字符'

  const code = String(form.code || '').trim()
  if (code && !/^[a-z0-9_]{2,32}$/.test(code)) {
    return '「套餐标识」只能是 2~32 位小写字母、数字、下划线；不想手填就留空，服务端会自动生成'
  }

  const price = Number(form.price)
  if (form.price === '' || form.price === null || Number.isNaN(price)) return '「售价」必须是数字，不能留空'
  if (price < 0) return '「售价」不能为负数'
  const priceErr = priceValue(form.price, '售价')
  if (priceErr) return priceErr

  if (String(form.original_price).trim() !== '') {
    const original = Number(form.original_price)
    if (Number.isNaN(original)) return '「原价 / 划线价」必须是数字，不想展示就留空'
    if (original < 0) return '「原价 / 划线价」不能为负数'
    const originalErr = priceValue(form.original_price, '原价 / 划线价')
    if (originalErr) return originalErr
    if (original < price) return '「原价 / 划线价」不能低于售价，否则前台会显示成负数折扣'
  }

  if (form.benefit_kind !== 'unlimited') {
    const limit = toInt(form.usage_limit, 0)
    if (!String(form.usage_limit).trim()) return '权益类型不是「不限量」时，必须填写「额度」'
    if (limit <= 0) return '「额度」必须大于 0；如果确实不限量，请把权益类型改成「不限量」'
  }

  if (form.validity_type !== 'none' && toInt(form.validity_value, 0) <= 0) {
    return '设置了有效期类型，就必须填写大于 0 的「有效期数值」；不设时长请选「不设时长」'
  }

  if (toInt(form.card_quantity, 0) < 1) return '「每单发放卡密数量」必须是大于 0 的整数'
  if (toInt(form.batch_size, 0) < 1) return '「默认批量生成张数」必须是大于 0 的整数'
  return null
}

/** 上架前的必填项校验（与后端 validatePublishable 一一对应） */
function publishError(row) {
  const cfg = (row && row.benefit_config) || {}
  if (!String(row.name || '').trim()) return '「套餐名称」是空的，先补齐再上架'
  if (Number(row.price) < 0) return '「售价」是负数，先改成正数再上架'
  if (row.original_price !== null && row.original_price !== undefined && Number(row.original_price) < Number(row.price)) {
    return '「原价 / 划线价」低于售价，先调整再上架'
  }
  if (row.benefit_type === 'quota' || row.benefit_type === 'count') {
    if (toInt(cfg.usage_limit, 0) <= 0) return '权益类型是次数 / 额度，但「额度」没填，先补齐再上架'
  }
  if (cfg.validity_type && cfg.validity_type !== 'none' && toInt(cfg.validity_value, 0) <= 0) {
    return '设置了有效期类型，但「有效期数值」是 0，先补齐再上架'
  }
  if (toInt(row.card_quantity, 0) <= 0) return '「每单发放卡密数量」必须大于 0，先补齐再上架'
  return null
}

function ensureFeaturesLoaded() {
  if (!features.value.length && featuresError.value) {
    toastWarn('功能权限清单没加载出来，本次提交不会改动已有的功能权限，可以稍后刷新重试')
  }
}

/* ------------------------------------------------------------------ 保存 */

async function submitForm() {
  const err = fieldError()
  if (err) {
    toastWarn(err)
    return
  }
  ensureFeaturesLoaded()
  const body = buildPayload()
  const isCreate = !editId.value

  saving.value = true
  const result = await run(
    () => (isCreate ? planApi.create(body) : planApi.update(editId.value, body)),
    { ok: isCreate ? '套餐已创建（默认是草稿，不会出现在前台）' : '套餐已保存' }
  )
  saving.value = false
  if (result === null) return

  editOpen.value = false
  if (isCreate) {
    toastOk(`新套餐已创建：${result.name || body.name}（ID ${result.id}，标识 ${result.code}）接下来可以去「卡密管理」为它生成卡密`)
  }
  reload(isCreate ? 1 : page.value)
}

/* ------------------------------------------------------------------ 复制 / 状态 / 删除 / 初始化 */

async function duplicatePlan(row) {
  const result = await run(() => planApi.duplicate(row.id), { ok: '已复制成新套餐（草稿）' })
  if (result === null) return
  toastOk(`新套餐：${result.name || ''}（ID ${result.id}，标识 ${result.code}）默认是草稿`)
  reload(1)
}

async function previewPlan(row) {
  const data = await run(() => planApi.preview(row.id))
  if (data === null) return
  preview.value = data
  previewOpen.value = true
}

async function publishPlan(row) {
  const err = publishError(row)
  if (err) {
    toastWarn(err)
    return
  }
  const ok = await confirmAction({
    title: '上架套餐',
    message: `确认把「${row.name}」上架到前台？`,
    detail: '上架后前台购买页会展示它，并且可以创建购买订单。价格与权益建议先用「前台预览」确认一遍。',
    confirmText: '确认上架',
    reasonLabel: '上架备注',
    reasonPlaceholder: '可填写本次上架备注，会记录到操作日志'
  })
  if (!ok) return
  const result = await run(() => planApi.setStatus(row.id, 'published', ok.reason), { ok: '套餐已上架' })
  if (result === null) return
  reload(page.value)
}

async function archivePlan(row) {
  const ok = await confirmAction({
    title: '下架套餐',
    message: `确认把「${row.name}」下架？`,
    detail: '下架后前台不再展示、也不能再下单，但已经产生的订单与已兑换的权益不受影响。',
    confirmText: '确认下架',
    danger: true,
    reasonRequired: true,
    reasonLabel: '下架原因'
  })
  if (!ok) return
  const result = await run(() => planApi.setStatus(row.id, 'archived', ok.reason), { ok: '套餐已下架' })
  if (result === null) return
  reload(page.value)
}

async function toDraft(row) {
  const ok = await confirmAction({
    title: '转为草稿',
    message: `确认把「${row.name}」转回草稿？`,
    detail: '转回草稿后前台不再展示、不能再下单；历史订单与已经发出去的卡密不受影响。',
    confirmText: '转为草稿',
    danger: true,
    reasonLabel: '转草稿原因'
  })
  if (!ok) return
  const result = await run(() => planApi.setStatus(row.id, 'draft', ok.reason), { ok: '已转为草稿' })
  if (result === null) return
  reload(page.value)
}

async function removePlan(row) {
  const refs = []
  if (toInt(row.order_count, 0) > 0) refs.push(`${row.order_count} 个订单`)
  if (toInt(row.card_key_count, 0) > 0) refs.push(`${row.card_key_count} 张卡密`)

  const ok = await confirmAction({
    title: '删除套餐',
    message: `确认删除「${row.name}」？`,
    detail: refs.length
      ? `这个套餐已经关联了 ${refs.join('、')}，服务端会拒绝删除并说明原因；如果只是想停卖，请改用「下架」。`
      : '删除后不能恢复。前台不会再展示它。如果你只是想停卖，请改用「下架」而不是删除。',
    confirmText: '确认删除',
    danger: true,
    reasonRequired: true,
    reasonLabel: '删除原因'
  })
  if (!ok) return

  // 后端对已有订单 / 卡密的套餐会返回 40006 并带上中文原因，run 会直接把它 toast 出来
  const result = await run(() => planApi.remove(row.id, ok.reason), { ok: '套餐已删除' })
  if (result === null) return

  // 删除后条数变少，留在第 5 页可能直接空掉，回到第一页更稳妥（筛选条件保留）
  syncQuery(router, route, { keyword: filters.keyword, status: filters.status })
  reload(1)
}

async function seedDrafts() {
  const ok = await confirmAction({
    title: '初始化占位草稿套餐',
    message: '会在后台创建几个草稿占位套餐，名称与价格都可以改，默认不在前台展示。要继续吗？',
    detail: '这个操作是幂等的：已经存在的占位套餐不会重复创建，可以放心点击。',
    confirmText: '创建占位草稿'
  })
  if (!ok) return

  const result = await run(() => planApi.seedDrafts())
  if (result === null) return
  const created = toInt(result.created, 0)
  if (created > 0) toastOk(`已创建 ${created} 个占位草稿套餐，接着把它们改成真正的套餐即可`)
  else toastOk('占位草稿套餐都已经存在了，没有重复创建')
  reload(1)
}

/* ------------------------------------------------------------------ 前台预览弹窗 */

const previewOpen = ref(false)
const preview = ref(null)

function validityTextOf(plan) {
  if (!plan) return '—'
  if (plan.validity_text) return plan.validity_text
  if (plan.validity_type && plan.validity_type !== 'none') {
    return `${validityType(plan.validity_type)} ${plan.validity_value || 0}`
  }
  return '不设时长'
}

function benefitTextOf(plan) {
  if (!plan) return '—'
  const label = benefitKind(plan.benefit_type)
  return plan.benefit_type && plan.benefit_type !== 'unlimited'
    ? `${label}（额度 ${plan.usage_limit || 0}）`
    : label
}

function onPageSizeChange() {
  reload(1)
}
</script>

<template>
  <div class="adm-page">
    <!-- ① 页头 -->
    <div class="adm-pagehead">
      <div>
        <h1>套餐管理</h1>
        <p>
          价格、权益、有效期全部在这里配置，代码里不写死任何定价。新建的套餐默认是<strong>草稿</strong>，
          确认好价格与权益后再上架；已经产生订单或卡密的套餐不能删除，只能下架。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button
          class="adm-btn"
          type="button"
          :disabled="!can(PERM)"
          :title="noPermTitle()"
          @click="seedDrafts"
        >初始化占位草稿</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="!can(PERM)"
          :title="noPermTitle()"
          @click="openCreate"
        >新建套餐</button>
      </div>
    </div>

    <!-- ② 业务提示 -->
    <div class="adm-note">
      前台只会看到<strong>已上架</strong>的套餐，价格与权益都来自这里填写的配置。
      点任意套餐的「前台预览」可以先看一遍大概效果再决定是否上架。
    </div>

    <!-- ③ 工具条 -->
    <div class="adm-toolbar">
      <input
        v-model="filters.keyword"
        class="adm-input"
        placeholder="搜索套餐名称 / 标识"
        @keyup.enter="applyFilters"
      >
      <select v-model="filters.status" class="adm-select" @change="applyFilters">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="published">已上架</option>
        <option value="archived">已下架</option>
      </select>
      <div class="adm-toolbar__right">
        <button class="adm-btn adm-btn--sm" type="button" @click="applyFilters">查询</button>
        <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
      </div>
    </div>

    <!-- ④ 列表 -->
    <AdminTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      min-width="1560px"
      empty-title="还没有任何套餐"
      empty-hint="套餐是价格与权益的载体，卡密和订单都挂在套餐下面。可以先点「初始化占位草稿」生成几个占位套餐，再按需要改名称与价格。"
    >
      <template #cell-name="{ row }">
        <div class="adm-strong">{{ row.name || '—' }}</div>
        <div v-if="row.tagline" class="adm-muted adm-2xs">{{ row.tagline }}</div>
        <div v-if="row.tag" class="adm-2xs"><span class="adm-tag adm-tag--info">{{ row.tag }}</span></div>
      </template>

      <template #cell-code="{ row }">
        <span class="adm-mono">{{ row.code || '—' }}</span>
      </template>

      <template #cell-price="{ row }">
        <span class="adm-strong">{{ money(row.price) }}</span>
      </template>

      <template #cell-original_price="{ row }">
        <span v-if="row.original_price === null || row.original_price === undefined" class="adm-muted">—</span>
        <span v-else class="adm-muted">{{ money(row.original_price) }}</span>
      </template>

      <template #cell-benefit_type="{ row }">
        {{ benefitKind(row.benefit_type) || '—' }}
      </template>

      <template #cell-validity_text="{ row }">
        {{ row.validity_text || validityTextOf(row) }}
      </template>

      <template #cell-status="{ row }">
        <AdminTag :text="planStatus(row.status).text" :kind="planStatus(row.status).kind" />
        <div v-if="planStatus(row.status).hint" class="adm-muted adm-2xs">{{ planStatus(row.status).hint }}</div>
      </template>

      <template #cell-sort_order="{ row }">
        {{ row.sort_order ?? 0 }}
      </template>

      <template #cell-order_count="{ row }">
        {{ row.order_count ?? 0 }}
      </template>

      <template #cell-card_key_count="{ row }">
        {{ row.card_key_count ?? 0 }}
      </template>

      <template #cell-updated_at="{ row }">
        <span class="adm-muted">{{ datetime(row.updated_at) }}</span>
      </template>

      <template #cell-actions="{ row }">
        <div class="adm-row">
          <button
            class="adm-btn adm-btn--sm adm-btn--ghost"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="previewPlan(row)"
          >前台预览</button>
          <button
            class="adm-btn adm-btn--sm"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="openEdit(row)"
          >编辑</button>
          <button
            class="adm-btn adm-btn--sm"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="duplicatePlan(row)"
          >复制</button>
          <button
            v-if="row.status !== 'published'"
            class="adm-btn adm-btn--sm adm-btn--primary"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="publishPlan(row)"
          >上架</button>
          <button
            v-else
            class="adm-btn adm-btn--sm"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="archivePlan(row)"
          >下架</button>
          <button
            v-if="row.status !== 'draft'"
            class="adm-btn adm-btn--sm adm-btn--ghost"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="toDraft(row)"
          >转草稿</button>
          <button
            class="adm-btn adm-btn--sm adm-btn--danger"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="removePlan(row)"
          >删除</button>
        </div>
      </template>

      <template #empty-action>
        <div class="adm-row">
          <button
            class="adm-btn adm-btn--primary"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="openCreate"
          >新建套餐</button>
          <button
            class="adm-btn"
            type="button"
            :disabled="!can(PERM)"
            :title="noPermTitle()"
            @click="seedDrafts"
          >初始化占位草稿</button>
        </div>
      </template>
    </AdminTable>

    <AdminPager
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
      @update:page="reload"
      @update:page-size="onPageSizeChange"
    />

    <!-- ⑤ 新建 / 编辑表单 -->
    <AdminModal
      v-model="editOpen"
      :title="editId ? '编辑套餐' : '新建套餐'"
      size="lg"
    >
      <div class="adm-stack">
        <div v-if="!can(PERM)" class="adm-note adm-note--warn">{{ denyReason(PERM) }}</div>

        <div class="adm-note adm-note--muted">
          套餐保存后默认是<strong>草稿</strong>，不会出现在前台。价格、权益、有效期都由你填写，
          系统不提供任何默认定价。
        </div>

        <!-- 基础信息 -->
        <div class="adm-card__head"><h2>基础信息</h2></div>
        <div class="adm-grid-3">
          <div class="adm-field">
            <label>套餐名称 <em>*</em></label>
            <input v-model="form.name" class="adm-input" maxlength="64" placeholder="例如：单张图纸权益包">
            <div class="adm-hint">必填，前台购买页显示的名字，最多 64 个字。</div>
          </div>

          <div class="adm-field">
            <label>套餐标识 code</label>
            <input v-model="form.code" class="adm-input adm-mono" maxlength="32" placeholder="留空自动生成">
            <div class="adm-hint">
              留空时服务端按名称自动生成（中文会转成 plan 之类，可能带序号）。
              只能填 2~32 位小写字母、数字、下划线。卡密和订单会记录这个标识，
              <strong>改标识不会影响已有订单与卡密的快照</strong>。
            </div>
          </div>

          <div class="adm-field">
            <label>前台标语 tagline</label>
            <input v-model="form.tagline" class="adm-input" maxlength="128" placeholder="例如：一张图纸，随时开拼">
            <div class="adm-hint">留空则不显示。展示在套餐名下方的小字。</div>
          </div>

          <div class="adm-field">
            <label>角标 tag</label>
            <input v-model="form.tag" class="adm-input" maxlength="32" placeholder="例如：最划算">
            <div class="adm-hint">留空则不显示角标。显示在套餐卡片右上角。</div>
          </div>

          <div class="adm-field">
            <label>前台排序值 sort_order</label>
            <input
              v-model.number="form.sort_order"
              class="adm-input"
              type="number"
              step="1"
              min="-100000"
              max="100000"
            >
            <div class="adm-hint">数字越大越靠前；留空按 0 处理。这是前台展示顺序，不影响价格。</div>
          </div>

          <div class="adm-field">
            <label>是否允许重复购买</label>
            <label class="adm-switch">
              <input v-model="form.allow_repeat_purchase" type="checkbox">
              <span>{{ form.allow_repeat_purchase ? '允许重复购买' : '每人限购一次' }}</span>
            </label>
            <div class="adm-hint">打开后同一个用户可以重复下单购买这个套餐。</div>
          </div>

          <div class="adm-field adm-field--full">
            <label>套餐短描述</label>
            <input
              v-model="form.short_desc"
              class="adm-input"
              maxlength="128"
              placeholder="一句话说明这个套餐给什么，例如：解锁 1 张图纸的完整导出"
            >
            <div class="adm-hint">留空则不显示。用在套餐卡片标题附近，建议不超过 30 个字。</div>
          </div>

          <div class="adm-field adm-field--full">
            <label>前台展示说明</label>
            <textarea
              v-model="form.front_desc"
              class="adm-textarea"
              maxlength="512"
              placeholder="详细介绍这个套餐适合谁、包含什么、注意事项。留空则前台不显示这段说明。"
            />
            <div class="adm-hint">留空则不显示。最多 512 个字。</div>
          </div>
        </div>

        <!-- 价格 -->
        <div class="adm-card__head"><h2>价格</h2></div>
        <div class="adm-note adm-note--muted">
          价格完全由你填写，系统不提供任何默认价。填 0 表示免费发放（例如作为活动赠品）。
        </div>
        <div class="adm-grid-2">
          <div class="adm-field">
            <label>售价（元） <em>*</em></label>
            <input v-model="form.price" class="adm-input" type="number" step="0.01" min="0" placeholder="0.00">
            <div class="adm-hint">必填，不能为负数，最多两位小数，上限 1000000。</div>
          </div>

          <div class="adm-field">
            <label>原价 / 划线价（元）</label>
            <input v-model="form.original_price" class="adm-input" type="number" step="0.01" min="0" placeholder="留空则不显示划线价">
            <div class="adm-hint">
              留空则前台不显示划线价。填了就不能低于售价，否则前台会出现负数折扣。
            </div>
          </div>
        </div>

        <!-- 权益 -->
        <div class="adm-card__head"><h2>权益配置</h2></div>
        <div class="adm-grid-3">
          <div class="adm-field">
            <label>权益类型 <em>*</em></label>
            <select v-model="form.benefit_kind" class="adm-select" @change="onKindChange">
              <option value="unlimited">不限量</option>
              <option value="quota">次数额度</option>
              <option value="count">图纸张数</option>
            </select>
            <div class="adm-hint">
              unlimited = 不限量使用；quota = 限制使用次数；count = 限制可解锁的图纸张数。
            </div>
          </div>

          <div class="adm-field">
            <label>额度 usage_limit <em v-if="form.benefit_kind !== 'unlimited'">*</em></label>
            <input
              v-model="form.usage_limit"
              class="adm-input"
              type="number"
              step="1"
              min="1"
              :disabled="form.benefit_kind === 'unlimited'"
              placeholder="例如：50"
            >
            <div class="adm-hint">
              选「不限量」时这一项不生效（会按 0 提交）。选次数 / 张数时必填且必须大于 0。
            </div>
          </div>

          <div class="adm-field">
            <label>起算方式 start_on</label>
            <select v-model="form.start_on" class="adm-select">
              <option value="redeem">兑换时开始（推荐）</option>
              <option value="paid">支付时开始</option>
              <option value="grant">发放时开始</option>
            </select>
            <div class="adm-hint">
              卡密兑换的套餐一般用「兑换时」——用户什么时候兑换，什么时候开始计算有效期。
            </div>
          </div>

          <div class="adm-field">
            <label>有效期类型 validity_type</label>
            <select v-model="form.validity_type" class="adm-select" @change="onValidityTypeChange">
              <option value="none">不设时长</option>
              <option value="hour">按小时</option>
              <option value="day">按天</option>
              <option value="month">按月</option>
            </select>
            <div class="adm-hint">选「不设时长」表示永久有效，下面的有效期数值会被忽略并按 0 提交。</div>
          </div>

          <div class="adm-field">
            <label>有效期数值 validity_value <em v-if="form.validity_type !== 'none'">*</em></label>
            <input
              v-model="form.validity_value"
              class="adm-input"
              type="number"
              step="1"
              min="1"
              :disabled="form.validity_type === 'none'"
              placeholder="例如：30"
            >
            <div class="adm-hint">
              配合上面的有效期类型使用，必须大于 0。留空的后果：无法保存，也无法上架。
            </div>
          </div>
        </div>

        <!-- 发卡 -->
        <div class="adm-card__head"><h2>发卡设置</h2></div>
        <div class="adm-grid-2">
          <div class="adm-field">
            <label>每单发放卡密数量 card_quantity <em>*</em></label>
            <input v-model.number="form.card_quantity" class="adm-input" type="number" step="1" min="1" max="100">
            <div class="adm-hint">默认 1。用户拍一单要自动发几张卡密，必须大于 0。</div>
          </div>

          <div class="adm-field">
            <label>默认批量生成张数 batch_size <em>*</em></label>
            <input v-model.number="form.batch_size" class="adm-input" type="number" step="1" min="1" max="10000">
            <div class="adm-hint">默认 10。只影响「卡密管理」里批量生成时的默认张数，不会自动发卡。</div>
          </div>
        </div>

        <!-- 功能权限 -->
        <div class="adm-card__head">
          <h2>功能权限 feature_permissions</h2>
          <div class="adm-card__head__actions">
            <button class="adm-btn adm-btn--sm adm-btn--ghost" type="button" @click="loadFeatures">重新加载清单</button>
          </div>
        </div>
        <div class="adm-note adm-note--warn">
          只有你<strong>显式打开</strong>或<strong>填了数字</strong>的功能才会写进这个套餐。
          没打开的功能<strong>不会</strong>被写成 false，而是沿用免费版口径（这样可以少勾十几个开关）。
          如果某个功能免费版本来就是关的，想给这个套餐开，就必须显式打开。
        </div>

        <div v-if="featuresError" class="adm-note adm-note--danger">
          功能权限清单加载失败：{{ featuresError }}。可以先保存其他字段，稍后点「重新加载清单」再配置权限；
          本次提交不会改动已有的功能权限。
        </div>
        <div v-else-if="!features.length" class="adm-note adm-note--muted">正在加载功能权限清单…</div>

        <div v-if="features.length" class="adm-checks">
          <div v-for="feature in features" :key="feature.key" class="adm-field">
            <label>{{ feature.label }}</label>
            <label v-if="feature.value_type === 'number'" class="adm-row">
              <input
                class="adm-input adm-input--sm"
                type="number"
                step="1"
                min="0"
                style="width: 130px"
                :value="numVal[feature.key] ?? ''"
                placeholder="留空 = 沿用免费版"
                @input="onFeatureNumber(feature, $event)"
              >
            </label>
            <label v-else class="adm-switch">
              <input type="checkbox" :checked="isFeatureOn(feature)" @change="onFeatureToggle(feature, $event)">
              <span>{{ isFeatureOn(feature) ? '已开启' : '沿用免费版' }}</span>
            </label>
            <div class="adm-hint">
              <span class="adm-mono">{{ feature.key }}</span>
              <template v-if="feature.hint"> · {{ feature.hint }}</template>
              <template v-if="feature.value_type === 'number'"> · 留空表示不覆盖免费版上限</template>
            </div>
          </div>
        </div>

        <div v-if="stalePermKeys.length" class="adm-note adm-note--muted">
          这个套餐里还有当前清单已不存在的权限键（{{ stalePermKeys.join('、') }}），
          原样保留不会被清掉；如果确认不再需要，可以在下面手动清空后另存。
        </div>

        <!-- 前台权益清单 -->
        <div class="adm-card__head">
          <h2>前台权益清单 feature_text</h2>
          <div class="adm-card__head__actions">
            <button class="adm-btn adm-btn--sm" type="button" @click="addFeatureText">添加一行</button>
          </div>
        </div>
        <div class="adm-field adm-field--full">
          <div class="adm-repeat">
            <div v-for="(item, index) in form.feature_text" :key="index" class="adm-repeat__row">
              <input
                v-model="form.feature_text[index]"
                class="adm-input"
                maxlength="128"
                :placeholder="`第 ${index + 1} 条权益说明，例如：可导出 PNG 图纸`"
              >
              <button class="adm-btn adm-btn--sm adm-btn--danger" type="button" @click="removeFeatureText(index)">删除</button>
            </div>
          </div>
          <div class="adm-hint">
            每行一条，前台的权益清单会按这里的顺序逐条展示。留空的行会直接被忽略，不会显示成空行。
          </div>
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="saving || !can(PERM)"
          :title="noPermTitle()"
          @click="submitForm"
        >{{ saving ? '保存中…' : (editId ? '保存修改' : '创建套餐') }}</button>
      </template>
    </AdminModal>

    <!-- ⑥ 前台预览 -->
    <AdminModal v-model="previewOpen" title="前台大概长这样" size="sm">
      <div v-if="preview" class="adm-stack">
        <div class="adm-note" :class="preview.visible ? '' : 'adm-note--warn'">
          {{ preview.visible_note || '—' }}
        </div>

        <div class="adm-card">
          <div v-if="preview.plan.tag" class="adm-2xs">
            <span class="adm-tag adm-tag--info">{{ preview.plan.tag }}</span>
          </div>
          <h2>{{ preview.plan.name || '（未填套餐名）' }}</h2>
          <p v-if="preview.plan.tagline" class="adm-muted">{{ preview.plan.tagline }}</p>

          <div class="adm-row">
            <span class="adm-strong" style="font-size: 24px">{{ money(preview.plan.price) }}</span>
            <span
              v-if="preview.plan.original_price !== null && preview.plan.original_price !== undefined"
              class="adm-muted"
            ><s>{{ money(preview.plan.original_price) }}</s></span>
          </div>

          <p v-if="preview.plan.short_desc">{{ preview.plan.short_desc }}</p>

          <div class="adm-stack">
            <div class="adm-row"><span class="adm-muted">有效期</span><span>{{ validityTextOf(preview.plan) }}</span></div>
            <div class="adm-row"><span class="adm-muted">权益</span><span>{{ benefitTextOf(preview.plan) }}</span></div>
            <div class="adm-row">
              <span class="adm-muted">重复购买</span>
              <span>{{ preview.plan.allow_repeat_purchase ? '允许' : '每人限购一次' }}</span>
            </div>
            <div class="adm-row"><span class="adm-muted">前台排序值</span><span>{{ preview.plan.sort_order ?? 0 }}</span></div>
          </div>

          <div v-if="preview.plan.front_desc" class="adm-note adm-note--muted">{{ preview.plan.front_desc }}</div>

          <div>
            <div class="adm-muted adm-2xs">权益清单</div>
            <ul v-if="preview.plan.feature_text && preview.plan.feature_text.length">
              <li v-for="(line, index) in preview.plan.feature_text" :key="index">{{ line }}</li>
            </ul>
            <div v-else class="adm-muted">还没有填写权益清单，前台不会显示这一块。</div>
          </div>
        </div>

        <div class="adm-note adm-note--muted">
          这只是后台看到的预览，实际前台样式与文案以后台设置为准；预览里不显示购买按钮。
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">关闭</button>
      </template>
    </AdminModal>
  </div>
</template>
