<script setup>
/* =========================================================================
   用户与兑换记录（后台需求 §9）
   - 两个标签页：「用户」与「兑换记录」，各自的筛选与分页互不影响
   - 用户详情弹窗：账号资料 / 会员状态 / 订单 / 当前有效权益
   - 兑换记录：卡密（脱敏）、套餐、来源、时间、剩余额度、状态、撤销
   - 手动发放权益走 confirmAction（danger + 必填原因），会写操作日志
   - 隐私：后端只返回脱敏邮箱与手机号，不返回密码；前端也不额外请求敏感字段
   ========================================================================= */

import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'

import { planApi, userApi } from '../../lib/adminApi.js'
import { ApiError, datetime, money, moneyPlain, syncQuery } from '../../lib/api.js'
import { can, denyReason } from '../../composables/useAdminAuth.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import {
  run,
  entitlementStatus,
  entitlementSource,
  toInt
} from '../../composables/useAdminKit.js'
import { toastWarn, toastErr } from '../../composables/useToast.js'

const route = useRoute()
const router = useRouter()

/* ------------------------------------------------------------------ 标签页 */
const activeTab = ref('users') // users | redemptions

function switchTab(tab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  syncFilters()
  reload(1)
}

/* ------------------------------------------------------------------ 筛选条件 */
const userFilters = reactive({
  keyword: '',
  status: '',
  has_pro: '',
  from: '',
  to: ''
})

const entFilters = reactive({
  user_id: '',
  plan_id: '',
  source_type: '',
  status: '',
  keyword: '',
  from: '',
  to: ''
})

/* ------------------------------------------------------------------ 列表与分页 */
const rows = ref([])
const total = ref(0)
const page = ref(1)
/** 两个标签页共用页大小，页码各自独立（切换时回到第 1 页） */
const pageSize = ref(20)
const loading = ref(false)

/* ------------------------------------------------------------------ 套餐下拉（发放权益 / 兑换记录筛选） */
const planOptions = ref([])
const plansLoading = ref(false)
/** 只有「已上架」套餐能用于发放，草稿套餐后端会以 40005 拒绝 */
const grantablePlans = computed(() => planOptions.value.filter(p => p.status === 'published'))

async function loadPlans() {
  if (planOptions.value.length) return
  plansLoading.value = true
  try {
    const data = await planApi.options()
    planOptions.value = (data && data.list) || []
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '套餐列表加载失败')
    planOptions.value = []
  } finally {
    plansLoading.value = false
  }
}

/* ------------------------------------------------------------------ 地址栏同步 */
function syncFilters() {
  const query = { tab: activeTab.value === 'users' ? '' : 'redemptions' }
  // 两个标签页各自一段前缀，互不覆盖；非当前标签页的键传空串由 syncQuery 删除
  if (activeTab.value === 'users') {
    Object.assign(query, {
      keyword: userFilters.keyword,
      status: userFilters.status,
      has_pro: userFilters.has_pro,
      reg_from: userFilters.from,
      reg_to: userFilters.to,
      ent_user_id: '', ent_plan_id: '', ent_source: '', ent_status: '', ent_keyword: '', ent_from: '', ent_to: ''
    })
  } else {
    Object.assign(query, {
      keyword: '',
      status: '',
      has_pro: '',
      reg_from: '',
      reg_to: '',
      ent_user_id: entFilters.user_id,
      ent_plan_id: entFilters.plan_id,
      ent_source: entFilters.source_type,
      ent_status: entFilters.status,
      ent_keyword: entFilters.keyword,
      ent_from: entFilters.from,
      ent_to: entFilters.to
    })
    delete query.keyword
    delete query.status
    delete query.has_pro
    delete query.reg_from
    delete query.reg_to
  }
  syncQuery(router, route, query)
}

/** 读回查询参数（刷新 / 直接打开链接后筛选不丢） */
function restoreFilters() {
  const q = key => {
    const v = route.query[key]
    return Array.isArray(v) ? v[0] : (v || '')
  }
  const tab = q('tab')
  activeTab.value = tab === 'redemptions' ? 'redemptions' : 'users'

  userFilters.keyword = q('keyword')
  userFilters.status = q('status')
  userFilters.has_pro = q('has_pro')
  userFilters.from = q('reg_from')
  userFilters.to = q('reg_to')

  entFilters.user_id = q('ent_user_id')
  entFilters.plan_id = q('ent_plan_id')
  entFilters.source_type = q('ent_source')
  entFilters.status = q('ent_status')
  entFilters.keyword = q('ent_keyword')
  entFilters.from = q('ent_from')
  entFilters.to = q('ent_to')

  const p = parseInt(q('page'), 10)
  if (!Number.isNaN(p) && p > 0) page.value = p
}

/* ------------------------------------------------------------------ 加载列表 */
async function reload(toPage = page.value) {
  syncFilters()
  page.value = toPage || 1
  loading.value = true
  try {
    if (activeTab.value === 'users') {
      const data = await userApi.list({
        keyword: userFilters.keyword,
        status: userFilters.status,
        has_pro: userFilters.has_pro,
        from: userFilters.from,
        to: userFilters.to,
        page: page.value,
        page_size: pageSize.value
      })
      rows.value = (data && data.list) || []
      total.value = (data && data.total) || 0
    } else {
      const data = await userApi.entitlements({
        user_id: entFilters.user_id ? toInt(entFilters.user_id, 0) : '',
        plan_id: entFilters.plan_id,
        source_type: entFilters.source_type,
        status: entFilters.status,
        keyword: entFilters.keyword,
        from: entFilters.from,
        to: entFilters.to,
        page: page.value,
        page_size: pageSize.value
      })
      rows.value = (data && data.list) || []
      total.value = (data && data.total) || 0
    }
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载失败，请重试')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  if (activeTab.value === 'users') {
    userFilters.keyword = ''
    userFilters.status = ''
    userFilters.has_pro = ''
    userFilters.from = ''
    userFilters.to = ''
  } else {
    entFilters.user_id = ''
    entFilters.plan_id = ''
    entFilters.source_type = ''
    entFilters.status = ''
    entFilters.keyword = ''
    entFilters.from = ''
    entFilters.to = ''
  }
  reload(1)
}

watch(pageSize, () => reload(1))

/* ------------------------------------------------------------------ 列定义 */
const userColumns = [
  { key: 'id', label: '用户 ID', width: '84px' },
  { key: 'username', label: '账号', width: '140px' },
  { key: 'nickname', label: '昵称', width: '120px' },
  { key: 'email', label: '邮箱', width: '160px' },
  { key: 'created_at', label: '注册时间', width: '140px', nowrap: true },
  { key: 'order_count', label: '订单数', width: '76px', align: 'right' },
  { key: 'paid_amount', label: '已支付', width: '96px', align: 'right', nowrap: true },
  { key: 'redeemed_count', label: '已兑换卡密', width: '92px', align: 'right' },
  { key: 'credit_balance', label: '剩余 Credits', width: '96px', align: 'right' },
  { key: 'membership', label: '当前有效权益', width: '190px' },
  { key: 'last_login_at', label: '最近登录', width: '140px', nowrap: true },
  { key: 'actions', label: '操作', width: '120px', nowrap: true }
]

const entColumns = [
  { key: 'source_no', label: '卡密', width: '150px', nowrap: true },
  { key: 'plan_name', label: '套餐 / 权益', width: '150px' },
  { key: 'user_account', label: '兑换用户', width: '140px' },
  { key: 'source_type', label: '来源', width: '96px', nowrap: true },
  { key: 'created_at', label: '兑换时间', width: '140px', nowrap: true },
  { key: 'starts_at', label: '权益生效', width: '140px', nowrap: true },
  { key: 'expires_at', label: '到期时间', width: '140px', nowrap: true },
  { key: 'remaining', label: '剩余额度', width: '96px', align: 'right' },
  { key: 'status', label: '状态', width: '92px', nowrap: true },
  { key: 'actions', label: '操作', width: '96px', nowrap: true }
]

/* ------------------------------------------------------------------ 小工具 */
/** 列表里的账号状态：正常 / 已禁用 */
function userStatusText(status) {
  return String(status) === '1' ? '正常' : '已禁用'
}

function userStatusKind(status) {
  return String(status) === '1' ? 'ok' : 'muted'
}

/** 卡密脱敏：只保留前 4 位与后 4 位 */
function maskSourceNo(value) {
  const s = String(value || '')
  if (!s) return ''
  if (s.length <= 8) return '****'
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

/** 第三方 openid 脱敏：后台只看绑定关系，不需要完整标识 */
function maskOpenId(value) {
  const s = String(value || '')
  if (!s) return '—'
  if (s.length <= 8) return s
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

/** 权益剩余额度：-1 表示不限量，0 表示已用完 */
function remainingText(value) {
  const n = Number(value)
  if (n === -1) return '不限量'
  if (Number.isNaN(n)) return '—'
  if (n <= 0) return '已用完'
  return String(n)
}

/** 权益来源（有后端中文文案就用后端的） */
function sourceText(item) {
  return item.source_type_text || entitlementSource(item.source_type)
}

/** 权益状态按「生效状态」展示：生效中用 ok，已过期 muted，已撤销 danger */
function entStatus(item) {
  return entitlementStatus(item.effective_status || item.status)
}

/* ------------------------------------------------------------------ 用户详情弹窗 */
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detail = ref(null)
const detailUserId = ref(0)

async function openDetail(row) {
  detailUserId.value = row.id
  detail.value = null
  detailError.value = ''
  detailOpen.value = true
  detailLoading.value = true
  try {
    const data = await userApi.detail(row.id)
    detail.value = data || null
  } catch (e) {
    detailError.value = e instanceof ApiError ? e.message : '用户详情加载失败'
  } finally {
    detailLoading.value = false
  }
}

/** 订单展示条数：后端详情只返回最近若干条，这里再限一次并标出「仅显示最近」 */
const recentOrderLimit = 10
const detailOrders = computed(() => {
  const list = (detail.value && detail.value.orders) || []
  return list.slice(0, recentOrderLimit)
})
const detailOrdersHidden = computed(() => {
  const list = (detail.value && detail.value.orders) || []
  return Math.max(0, list.length - recentOrderLimit)
})

/* ------------------------------------------------------------------ 手动发放权益 */
const grantOpen = ref(false)
const granting = ref(false)
const grantForm = reactive({
  userId: '',
  planId: '',
  note: '',
  overrideValidDays: 0
})

function openGrant() {
  grantForm.userId = entFilters.user_id || ''
  grantForm.planId = ''
  grantForm.note = ''
  grantForm.overrideValidDays = 0
  grantOpen.value = true
  loadPlans()
}

function validateGrant() {
  if (!grantForm.userId || toInt(grantForm.userId, 0) <= 0) return '请填写目标用户 ID（用户 ID 可在「用户」标签页里查到）'
  const planId = toInt(grantForm.planId, 0)
  if (!planId) return '请选择要发放的套餐'
  const plan = planOptions.value.find(p => p.id === planId)
  if (plan && plan.status !== 'published') {
    return `套餐「${plan.name}」当前是${plan.status === 'draft' ? '草稿' : '已下架'}状态，不能发放，请先上架`
  }
  if (!grantForm.note || grantForm.note.trim().length < 2) return '备注（发放原因）至少填写 2 个字'
  const days = toInt(grantForm.overrideValidDays, 0)
  if (days < 0 || days > 3650) return '覆盖有效天数需在 0 ~ 3650 之间'
  return ''
}

async function submitGrant() {
  const message = validateGrant()
  if (message) {
    toastWarn(message)
    return
  }
  const planId = toInt(grantForm.planId, 0)
  const plan = planOptions.value.find(p => p.id === planId)
  const days = toInt(grantForm.overrideValidDays, 0)

  const result = await confirmAction({
    title: '手动发放权益',
    message: `确认给用户 ID ${toInt(grantForm.userId, 0)} 发放「${plan ? plan.name : planId}」？`,
    detail: '这会给用户直接开通权益，不需要卡密；操作会记录到日志。'
      + (plan && plan.validity_text ? `该套餐有效期：${plan.validity_text}。` : '')
      + (days > 0 ? `本次将以 ${days} 天覆盖套餐默认时长。` : '本次按套餐默认时长计算到期时间。'),
    confirmText: '确认发放',
    danger: true,
    reasonRequired: true,
    reasonLabel: '发放原因',
    reasonHint: '会记录到操作日志，方便事后追溯是谁、为什么发放。'
  })
  if (!result) return

  const note = String(result.reason || '').trim() || grantForm.note.trim()
  granting.value = true
  const created = await run(
    () => userApi.grant({
      user_id: toInt(grantForm.userId, 0),
      plan_id: planId,
      note,
      override_valid_days: days
    }),
    { ok: '权益已发放，用户会员状态已更新' }
  )
  granting.value = false
  if (created === null) return

  grantOpen.value = false
  if (activeTab.value === 'redemptions') reload(1)
}

/* ------------------------------------------------------------------ 撤销权益 */
const revokingId = ref(0)

async function revokeEntitlement(item) {
  const ok = await confirmAction({
    title: '撤销权益',
    message: `确认撤销「${item.user_account || '该用户'}」的「${item.plan_name || '该套餐'}」权益？`,
    detail: '撤销后该权益立即失效，用户的会员状态会按剩余有效权益重新计算。'
      + '如果这条权益是通过卡密兑换或订单发放的，撤销不会退还卡密或订单金额，请先与用户确认。',
    confirmText: '确认撤销',
    danger: true,
    reasonRequired: true,
    reasonLabel: '撤销原因'
  })
  if (!ok) return

  revokingId.value = item.id
  const result = await run(() => userApi.revoke(item.id, ok.reason), { ok: '权益已撤销' })
  revokingId.value = 0
  if (result === null) return

  if (detailOpen.value && detail.value) reopenDetail()
  reload(page.value)
}

/** 撤销后刷新已打开的用户详情（会员状态可能已经变了） */
async function reopenDetail() {
  const id = detailUserId.value
  if (!id) return
  try {
    const data = await userApi.detail(id)
    if (detailOpen.value && detailUserId.value === id) detail.value = data || null
  } catch {
    // 详情刷新失败不影响撤销结果，列表已经是最新的
  }
}

/* ------------------------------------------------------------------ 初始化 */
onMounted(() => {
  restoreFilters()
  loadPlans()
  reload(page.value)
})
</script>

<template>
  <div class="adm-page">
    <!-- ① 页头：标题 + 业务规则 + 主操作 -->
    <div class="adm-pagehead">
      <div>
        <h1>用户与兑换记录</h1>
        <p>
          上半部分查用户、看他当前的权益与订单；下半部分查每一笔兑换记录，必要时可以手动发放或撤销权益。
          撤销权益会立刻影响用户的会员状态，发放权益不需要卡密，两者都会写进操作日志。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button
          v-if="activeTab === 'redemptions'"
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="!can('entitlement.grant')"
          :title="can('entitlement.grant') ? '' : denyReason('entitlement.grant')"
          @click="openGrant"
        >手动发放权益</button>
      </div>
    </div>

    <!-- ② 隐私说明 -->
    <div class="adm-note">
      后台只展示脱敏后的邮箱与手机号，也不会展示用户密码；这里不提供查看用户明文联系方式或密码的入口。
      需要联系用户时请通过用户主动留下的客服渠道，不要索取不必要的敏感信息。
    </div>

    <!-- ③ 标签页 -->
    <div class="adm-chips">
      <button
        class="adm-chip" :class="{ on: activeTab === 'users' }"
        type="button" @click="switchTab('users')"
      >用户</button>
      <button
        class="adm-chip" :class="{ on: activeTab === 'redemptions' }"
        type="button" @click="switchTab('redemptions')"
      >兑换记录</button>
    </div>

    <!-- ④-A 用户标签页 -->
    <template v-if="activeTab === 'users'">
      <div class="adm-toolbar">
        <input
          v-model="userFilters.keyword"
          class="adm-input"
          placeholder="搜索账号 / 昵称 / 邮箱 / 手机号"
          @keyup.enter="reload(1)"
        >
        <select v-model="userFilters.status" class="adm-select" @change="reload(1)">
          <option value="">全部状态</option>
          <option value="1">正常</option>
          <option value="0">已禁用</option>
        </select>
        <select v-model="userFilters.has_pro" class="adm-select" @change="reload(1)">
          <option value="">付费权益：不限</option>
          <option value="true">只看有付费权益</option>
          <option value="false">只看无付费权益</option>
        </select>
        <input v-model="userFilters.from" class="adm-input" type="date" title="注册开始日期">
        <input v-model="userFilters.to" class="adm-input" type="date" title="注册结束日期">
        <div class="adm-toolbar__right">
          <button class="adm-btn adm-btn--sm" type="button" @click="reload(1)">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
        </div>
      </div>

      <AdminTable
        :columns="userColumns"
        :rows="rows"
        :loading="loading"
        min-width="1240px"
        empty-title="没有符合条件的用户"
        empty-hint="换个关键字，或把状态、注册日期区间放宽再看一次"
      >
        <template #cell-id="{ row }">
          <span class="adm-mono">#{{ row.id }}</span>
        </template>

        <template #cell-username="{ row }">
          <span class="adm-strong">{{ row.username || '—' }}</span>
        </template>

        <template #cell-nickname="{ row }">
          {{ row.nickname || '—' }}
        </template>

        <template #cell-email="{ row }">
          <span class="adm-2xs adm-muted">{{ row.email || '未填写' }}</span>
        </template>

        <template #cell-created_at="{ row }">
          {{ datetime(row.created_at) }}
        </template>

        <template #cell-order_count="{ row }">
          {{ row.order_count ?? 0 }}
        </template>

        <template #cell-paid_amount="{ row }">
          ¥{{ moneyPlain(row.paid_amount) }}
        </template>

        <template #cell-redeemed_count="{ row }">
          {{ row.redeemed_count ?? 0 }}
        </template>

        <template #cell-credit_balance="{ row }">
          {{ row.credit_balance || '—' }}
        </template>

        <template #cell-membership="{ row }">
          <AdminTag
            :text="row.is_pro ? '会员' : '免费'"
            :kind="row.is_pro ? 'primary' : 'muted'"
          />
          <span class="adm-2xs">{{ row.plan_name || (row.is_pro ? '—' : '免费版') }}</span>
          <span v-if="row.is_pro" class="adm-2xs adm-muted">
            {{ row.expire_at ? '到期 ' + datetime(row.expire_at) : '不限时长' }}
          </span>
        </template>

        <template #cell-last_login_at="{ row }">
          {{ datetime(row.last_login_at) }}
        </template>

        <template #cell-actions="{ row }">
          <button
            class="adm-link"
            type="button"
            :disabled="!can('user.view')"
            :title="can('user.view') ? '' : denyReason('user.view')"
            @click="openDetail(row)"
          >查看详情</button>
        </template>

        <template #empty-action>
          <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">清空筛选条件</button>
        </template>
      </AdminTable>
    </template>

    <!-- ④-B 兑换记录标签页 -->
    <template v-else>
      <div class="adm-toolbar">
        <input
          v-model="entFilters.keyword"
          class="adm-input"
          placeholder="搜索卡密 / 用户账号 / 套餐名"
          @keyup.enter="reload(1)"
        >
        <input v-model="entFilters.user_id" class="adm-input" type="number" min="1" step="1" placeholder="用户 ID">
        <select v-model="entFilters.plan_id" class="adm-select" @change="reload(1)">
          <option value="">全部套餐</option>
          <option v-for="p in planOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-model="entFilters.source_type" class="adm-select" @change="reload(1)">
          <option value="">全部来源</option>
          <option value="card_key">卡密兑换</option>
          <option value="order">订单发放</option>
          <option value="admin_grant">管理员发放</option>
        </select>
        <select v-model="entFilters.status" class="adm-select" @change="reload(1)">
          <option value="">全部状态</option>
          <option value="active">生效中</option>
          <option value="expired">已过期</option>
          <option value="revoked">已撤销</option>
          <option value="used_up">额度已用完</option>
        </select>
        <input v-model="entFilters.from" class="adm-input" type="date" title="兑换开始日期">
        <input v-model="entFilters.to" class="adm-input" type="date" title="兑换结束日期">
        <div class="adm-toolbar__right">
          <button class="adm-btn adm-btn--sm" type="button" @click="reload(1)">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
        </div>
      </div>

      <AdminTable
        :columns="entColumns"
        :rows="rows"
        :loading="loading"
        min-width="1200px"
        empty-title="没有符合条件的兑换记录"
        empty-hint="兑换记录来自卡密兑换、订单发放与管理员手动发放；换个关键字或把日期放宽再看一次"
      >
        <template #cell-source_no="{ row }">
          <span v-if="row.source_no" class="adm-mono" :title="'卡密已脱敏：' + maskSourceNo(row.source_no)">
            {{ maskSourceNo(row.source_no) }}
          </span>
          <span v-else class="adm-muted adm-2xs">{{ row.source_type === 'admin_grant' ? '无卡密（手动发放）' : '—' }}</span>
        </template>

        <template #cell-plan_name="{ row }">
          <span class="adm-strong">{{ row.plan_name || '—' }}</span>
          <span v-if="row.plan_code" class="adm-2xs adm-muted">{{ row.plan_code }}</span>
        </template>

        <template #cell-user_account="{ row }">
          {{ row.user_account || '—' }}
          <span class="adm-2xs adm-muted">#{{ row.user_id }}</span>
        </template>

        <template #cell-source_type="{ row }">
          {{ sourceText(row) }}
        </template>

        <template #cell-created_at="{ row }">
          {{ datetime(row.created_at) }}
        </template>

        <template #cell-starts_at="{ row }">
          {{ datetime(row.starts_at) }}
        </template>

        <template #cell-expires_at="{ row }">
          {{ row.expires_at ? datetime(row.expires_at) : '不限时长' }}
        </template>

        <template #cell-remaining="{ row }">
          {{ remainingText(row.remaining) }}
        </template>

        <template #cell-status="{ row }">
          <AdminTag :text="entStatus(row).text" :kind="entStatus(row).kind" />
        </template>

        <template #cell-actions="{ row }">
          <button
            class="adm-link"
            type="button"
            :disabled="!can('entitlement.grant') || revokingId === row.id"
            :title="can('entitlement.grant') ? '' : denyReason('entitlement.grant')"
            @click="revokeEntitlement(row)"
          >{{ revokingId === row.id ? '撤销中…' : '撤销' }}</button>
        </template>

        <template #empty-action>
          <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">清空筛选条件</button>
        </template>
      </AdminTable>
    </template>

    <!-- ⑤ 分页：两个标签页共用分页控件，切换时回到第 1 页 -->
    <AdminPager
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
    />

    <!-- ⑥ 用户详情 -->
    <AdminModal v-model="detailOpen" title="用户详情" size="lg">
      <div v-if="detailLoading" class="adm-note adm-note--muted">正在加载用户详情…</div>

      <div v-else-if="detailError" class="adm-stack">
        <div class="adm-note adm-note--danger">{{ detailError }}</div>
        <div class="adm-row">
          <button class="adm-btn adm-btn--sm" type="button" @click="openDetail({ id: detailUserId })">重新加载</button>
        </div>
      </div>

      <div v-else-if="detail" class="adm-stack">
        <!-- 账号资料 -->
        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>账号资料</h2>
            <div class="adm-card__head__actions">
              <AdminTag
                :text="userStatusText(detail.user.status)"
                :kind="userStatusKind(detail.user.status)"
              />
            </div>
          </div>
          <div class="adm-card" style="border:0">
            <div class="adm-grid-3">
              <div>
                <div class="adm-2xs adm-muted">用户 ID</div>
                <div class="adm-mono">#{{ detail.user.id }}</div>
              </div>
              <div>
                <div class="adm-2xs adm-muted">账号</div>
                <div class="adm-strong">{{ detail.user.username || '—' }}</div>
              </div>
              <div>
                <div class="adm-2xs adm-muted">昵称</div>
                <div>{{ detail.user.nickname || '—' }}</div>
              </div>
              <div>
                <div class="adm-2xs adm-muted">邮箱（已脱敏）</div>
                <div>{{ detail.user.email || '未填写' }}</div>
              </div>
              <div>
                <div class="adm-2xs adm-muted">手机号（已脱敏）</div>
                <div>{{ detail.user.phone || '未填写' }}</div>
              </div>
              <div>
                <div class="adm-2xs adm-muted">注册时间</div>
                <div>{{ datetime(detail.user.created_at) }}</div>
              </div>
              <div>
                <div class="adm-2xs adm-muted">最近登录</div>
                <div>{{ datetime(detail.user.last_login_at) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 第三方身份绑定（需求 §4.2 / §6「管理员能查询身份绑定」） -->
        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>登录方式</h2>
            <div class="adm-card__head__actions">
              <span class="adm-muted">{{ (detail.identities || []).length }} 个第三方身份</span>
            </div>
          </div>
          <div v-if="(detail.identities || []).length" class="adm-stack">
            <div
              v-for="id in detail.identities"
              :key="id.id"
              class="adm-row"
              style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"
            >
              <div>
                <div class="adm-strong">{{ id.provider_label || id.provider }}</div>
                <div class="adm-2xs adm-muted">
                  {{ id.nickname || '未返回昵称' }} · openid {{ id.provider_open_id_masked || maskOpenId(id.provider_open_id) }}
                </div>
              </div>
              <div class="adm-2xs adm-muted">
                绑定于 {{ datetime(id.bound_at) }}
                <template v-if="id.last_login_at"> · 最近登录 {{ datetime(id.last_login_at) }}</template>
              </div>
            </div>
          </div>
          <div v-else class="adm-note adm-note--muted">
            没有第三方登录绑定（可能是账号密码或本机匿名身份）。
          </div>
        </div>

        <!-- 会员状态 -->
        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>会员状态</h2>
          </div>
          <div class="adm-card" style="border:0">
            <div class="adm-kpis">
              <div class="adm-kpi">
                <div class="adm-kpi__label">当前会员</div>
                <div class="adm-kpi__value">
                  <AdminTag
                    :text="detail.membership.is_pro ? '会员' : '免费'"
                    :kind="detail.membership.is_pro ? 'primary' : 'muted'"
                  />
                </div>
                <div class="adm-kpi__hint">{{ detail.membership.plan_code || '—' }}</div>
              </div>
              <div class="adm-kpi">
                <div class="adm-kpi__label">到期时间</div>
                <div class="adm-kpi__value" style="font-size:16px">
                  {{ detail.membership.expire_at ? datetime(detail.membership.expire_at) : (detail.membership.is_pro ? '不限时长' : '—') }}
                </div>
                <div class="adm-kpi__hint">按当前有效权益里最优的一条计算</div>
              </div>
              <div class="adm-kpi">
                <div class="adm-kpi__label">剩余 Credits</div>
                <div class="adm-kpi__value">{{ detail.credits ? detail.credits.balance : '—' }}</div>
              </div>
              <div class="adm-kpi">
                <div class="adm-kpi__label">订单 / 已支付</div>
                <div class="adm-kpi__value">{{ detail.order_count || 0 }}</div>
                <div class="adm-kpi__hint">已支付 {{ money(detail.paid_amount) }}</div>
              </div>
              <div class="adm-kpi">
                <div class="adm-kpi__label">累计权益</div>
                <div class="adm-kpi__value">{{ detail.entitlement_count || 0 }}</div>
                <div class="adm-kpi__hint">含已过期与已撤销</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 当前有效权益 -->
        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>当前有效权益</h2>
            <div class="adm-card__head__actions">
              <span class="adm-muted">{{ (detail.active_entitlements || []).length }} 条</span>
            </div>
          </div>
          <AdminTable
            v-if="(detail.active_entitlements || []).length"
            :columns="entColumns"
            :rows="detail.active_entitlements"
            min-width="1100px"
          >
            <template #cell-source_no="{ row }">
              <span v-if="row.source_no" class="adm-mono">{{ maskSourceNo(row.source_no) }}</span>
              <span v-else class="adm-muted adm-2xs">无卡密</span>
            </template>
            <template #cell-plan_name="{ row }">
              <span class="adm-strong">{{ row.plan_name || '—' }}</span>
            </template>
            <template #cell-user_account="{ row }">
              {{ row.user_account || '—' }}
            </template>
            <template #cell-source_type="{ row }">
              {{ sourceText(row) }}
            </template>
            <template #cell-created_at="{ row }">
              {{ datetime(row.created_at) }}
            </template>
            <template #cell-starts_at="{ row }">
              {{ datetime(row.starts_at) }}
            </template>
            <template #cell-expires_at="{ row }">
              {{ row.expires_at ? datetime(row.expires_at) : '不限时长' }}
            </template>
            <template #cell-remaining="{ row }">
              {{ remainingText(row.remaining) }}
            </template>
            <template #cell-status="{ row }">
              <AdminTag :text="entStatus(row).text" :kind="entStatus(row).kind" />
            </template>
            <template #cell-actions="{ row }">
              <button
                class="adm-link"
                type="button"
                :disabled="!can('entitlement.grant') || revokingId === row.id"
                :title="can('entitlement.grant') ? '' : denyReason('entitlement.grant')"
                @click="revokeEntitlement(row)"
              >{{ revokingId === row.id ? '撤销中…' : '撤销' }}</button>
            </template>
          </AdminTable>
          <div v-else class="adm-note adm-note--muted">该用户当前没有生效中的付费权益，会员状态按免费版计算。</div>
        </div>

        <!-- 订单 -->
        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>订单</h2>
            <div class="adm-card__head__actions">
              <span class="adm-muted">共 {{ detail.order_count || 0 }} 笔</span>
            </div>
          </div>
          <AdminTable
            v-if="detailOrders.length"
            :columns="[
              { key: 'order_no', label: '订单号', width: '180px', nowrap: true },
              { key: 'plan_name', label: '套餐', width: '150px' },
              { key: 'amount_paid', label: '实付', width: '100px', align: 'right', nowrap: true },
              { key: 'payment_status', label: '支付状态', width: '100px', nowrap: true },
              { key: 'created_at', label: '下单时间', width: '140px', nowrap: true }
            ]"
            :rows="detailOrders"
            min-width="720px"
          >
            <template #cell-order_no="{ row }">
              <span class="adm-mono">{{ row.order_no || '—' }}</span>
            </template>
            <template #cell-plan_name="{ row }">
              <span class="adm-strong">{{ row.plan_name || '—' }}</span>
            </template>
            <template #cell-amount_paid="{ row }">
              {{ money(row.amount_paid) }}
            </template>
            <template #cell-payment_status="{ row }">
              <AdminTag
                :text="row.payment_status_text || row.payment_status || '—'"
                :kind="row.payment_status === 'paid' ? 'ok' : (row.payment_status === 'pending' ? 'warn' : 'muted')"
              />
            </template>
            <template #cell-created_at="{ row }">
              {{ datetime(row.created_at) }}
            </template>
          </AdminTable>
          <div v-else class="adm-note adm-note--muted">该用户还没有订单。用户的权益也可能来自卡密兑换或管理员手动发放。</div>
          <div v-if="detailOrdersHidden > 0" class="adm-hint">
            接口只返回最近 {{ detailOrders.length }} 笔订单，还有 {{ detailOrdersHidden }} 笔未在此展示，完整列表请到「订单管理」按用户筛选。
          </div>
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">关闭</button>
      </template>
    </AdminModal>

    <!-- ⑦ 手动发放权益 -->
    <AdminModal v-model="grantOpen" title="手动发放权益" size="lg" :mask-closable="false">
      <div class="adm-note adm-note--warn">
        这会给用户直接开通权益，不需要卡密；操作会记录到日志。
        请先确认用户 ID 与套餐无误——发错用户只能再走一次「撤销权益」补救。
      </div>

      <div class="adm-form adm-form--2">
        <div class="adm-field">
          <label>目标用户 ID <em>*</em></label>
          <input
            v-model="grantForm.userId"
            class="adm-input"
            type="number"
            min="1"
            step="1"
            placeholder="例如 1024"
          >
          <span class="adm-hint">可在「用户」标签页按账号搜索后复制用户 ID。</span>
        </div>

        <div class="adm-field">
          <label>套餐 <em>*</em></label>
          <select v-model="grantForm.planId" class="adm-select" :disabled="plansLoading || !grantablePlans.length">
            <option value="">{{ plansLoading ? '套餐加载中…' : '请选择要发放的套餐' }}</option>
            <option v-for="p in grantablePlans" :key="p.id" :value="p.id">
              {{ p.name }}（{{ p.validity_text || '不限时长' }}）
            </option>
          </select>
          <span class="adm-hint">只能选已上架套餐；草稿与已下架套餐会被后端拒绝。</span>
        </div>

        <div class="adm-field">
          <label>覆盖有效天数</label>
          <input
            v-model="grantForm.overrideValidDays"
            class="adm-input"
            type="number"
            min="0"
            max="3650"
            step="1"
          >
          <span class="adm-hint">填 0 表示按套餐配置的时长计算到期时间。</span>
        </div>

        <div class="adm-field adm-field--full">
          <label>备注（发放原因） <em>*</em></label>
          <textarea
            v-model="grantForm.note"
            class="adm-textarea"
            placeholder="至少 2 个字，例如：客服补偿 3 天会员"
          />
          <span class="adm-hint">提交时还会再让你确认一次并填写发放原因，两处都会记录。</span>
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" :disabled="granting" @click="close">取消</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="granting || !can('entitlement.grant')"
          :title="can('entitlement.grant') ? '' : denyReason('entitlement.grant')"
          @click="submitGrant"
        >{{ granting ? '发放中…' : '确认发放' }}</button>
      </template>
    </AdminModal>
  </div>
</template>
