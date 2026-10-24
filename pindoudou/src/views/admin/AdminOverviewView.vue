<script setup>
/* =========================================================================
   数据概览（需求 §4）
   目标：登录后 3 秒内知道系统在发生什么，不做复杂 BI。
   原则：不伪造数据 —— 没有接入支付就明确写「支付暂未接入」，
   金额只统计已支付订单，退款单独列出，不混进净收入。
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import PixelIcon from '../../components/ui/PixelIcon.vue'
import { overviewApi } from '../../lib/adminApi.js'
import { ApiError, money, moneyPlain, datetime, fromNow } from '../../lib/api.js'
import { toastErr } from '../../composables/useToast.js'
import {
  paymentStatus, fulfillmentStatus, assetStatus,
  entitlementSource, entitlementStatus
} from '../../composables/useAdminKit.js'

const loading = ref(false)
const data = ref(null)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await overviewApi.load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败，请重试'
    toastErr(error.value)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const cards = computed(() => (data.value && data.value.cards) || {})
const payment = computed(() => (data.value && data.value.payment) || {})
const recent = computed(() => (data.value && data.value.recent) || { orders: [], redemptions: [], assets: [] })
const assetStats = computed(() => (data.value && data.value.assets) || {})

/** 数字卡片。hint 用来解释口径，避免运营误读（例如「不含退款」）。 */
const kpis = computed(() => [
  {
    label: '今日订单数',
    value: cards.value.today_order_count ?? 0,
    hint: '今天创建的订单，含未支付'
  },
  {
    label: '今日已支付金额',
    value: money(cards.value.today_paid_amount),
    hint: '只统计 admin 已确认收款的订单',
    accent: true
  },
  {
    label: '累计已支付金额',
    value: money(cards.value.total_paid_amount),
    hint: `已退款 ${money(cards.value.total_refund_amount)}（不计入净收入）`,
    accent: true
  },
  {
    label: '已生成卡密',
    value: cards.value.card_generated ?? 0,
    hint: '累计生成的卡密总数'
  },
  {
    label: '未使用卡密',
    value: cards.value.card_unused ?? 0,
    hint: '可用于发放或兑换'
  },
  {
    label: '已兑换卡密',
    value: cards.value.card_redeemed ?? 0,
    hint: `今日兑换 ${cards.value.today_redeem_count ?? 0} 张`
  },
  {
    label: '已上架素材',
    value: cards.value.asset_published ?? 0,
    hint: `草稿 ${cards.value.asset_draft ?? 0} 个`
  },
  {
    label: '累计用户数',
    value: cards.value.user_total ?? 0,
    hint: `今日新增 ${cards.value.today_new_user_count ?? 0} 人`
  }
])

const orderColumns = [
  { key: 'order_no', label: '订单号', nowrap: true },
  { key: 'user_account', label: '用户' },
  { key: 'plan_name', label: '套餐' },
  { key: 'amount_paid', label: '实付', align: 'right' },
  { key: 'payment_status', label: '支付状态' },
  { key: 'fulfillment_status', label: '发卡状态' },
  { key: 'created_at', label: '创建时间', nowrap: true }
]

const redemptionColumns = [
  { key: 'source_no', label: '卡密' },
  { key: 'plan_name', label: '套餐' },
  { key: 'user_account', label: '用户' },
  { key: 'source_type', label: '来源' },
  { key: 'expires_at', label: '权益到期', nowrap: true },
  { key: 'created_at', label: '时间', nowrap: true }
]

const assetColumns = [
  { key: 'thumbnail_url', label: '封面' },
  { key: 'title', label: '素材名称' },
  { key: 'category_name', label: '分类' },
  { key: 'status', label: '状态' },
  { key: 'created_at', label: '上传时间', nowrap: true }
]

const isEmpty = computed(() => {
  const c = cards.value
  return !loading.value && data.value &&
    !c.today_order_count && !c.card_generated && !c.asset_published && !c.user_total
})
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>数据概览</h1>
        <p>
          只展示真实存在的经营数据。金额一律来自「已支付」订单，退款单独列出、不计入净收入；
          没有接入支付渠道时不会显示任何虚构的收入。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn" type="button" :disabled="loading" @click="load">
          {{ loading ? '刷新中…' : '刷新数据' }}
        </button>
      </div>
    </div>

    <!-- 支付接入状态：这是概览页最需要说清楚的一件事 -->
    <div class="adm-note" :class="payment.channel_configured ? '' : 'adm-note--warn'">
      {{ payment.notice || '正在读取支付接入状态…' }}
      <template v-if="!payment.channel_configured">
        净收入口径：已支付 {{ money(cards.total_paid_amount) }} − 已退款
        {{ money(cards.total_refund_amount) }} =
        <b>{{ money(payment.net_paid_amount) }}</b>（含人工确认的收款）。
      </template>
    </div>

    <div v-if="error" class="adm-note adm-note--danger">{{ error }}</div>

    <!-- 数字卡片 -->
    <div class="adm-kpis">
      <div v-for="kpi in kpis" :key="kpi.label" class="adm-kpi" :class="{ 'adm-kpi--accent': kpi.accent }">
        <span class="adm-kpi__label">{{ kpi.label }}</span>
        <span v-if="loading && !data" class="adm-skeleton" style="height:26px;width:70%" />
        <span v-else class="adm-kpi__value">{{ kpi.value }}</span>
        <span class="adm-kpi__hint">{{ kpi.hint }}</span>
      </div>
    </div>

    <!-- 完全空库时的引导：给出下一步，而不是一堆 0 -->
    <div v-if="isEmpty" class="adm-card">
      <div class="adm-empty">
        <div class="adm-empty__icon"><PixelIcon name="sparkles" :size="26" /></div>
        <strong>系统里还没有任何数据</strong>
        <p>
          建议按这个顺序开始：先在「套餐管理」把套餐的价格与权益配置好并上架，
          再到「卡密管理」按套餐批量生成卡密，然后就能在「素材库」上传素材，
          最后把卡密发给用户兑换。
        </p>
        <div class="adm-row" style="justify-content:center">
          <RouterLink to="/admin/plans" class="adm-btn adm-btn--primary">去配置套餐</RouterLink>
          <RouterLink to="/admin/cards" class="adm-btn">生成卡密</RouterLink>
          <RouterLink to="/admin/assets" class="adm-btn">上传素材</RouterLink>
        </div>
      </div>
    </div>

    <!-- 最近订单 -->
    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>最近订单</h2>
        <span class="adm-muted">最新 5 条</span>
        <div class="adm-card__head__actions">
          <RouterLink to="/admin/orders" class="adm-btn adm-btn--sm">查看全部</RouterLink>
        </div>
      </div>
      <AdminTable
        :columns="orderColumns"
        :rows="recent.orders"
        :loading="loading && !data"
        min-width="820px"
        empty-title="还没有订单"
        empty-hint="订单会在用户于前台购买套餐时产生；未接入支付时，需要你在订单管理里人工确认收款。"
      >
        <template #cell-order_no="{ row }">
          <span class="adm-mono">{{ row.order_no }}</span>
        </template>
        <template #cell-user_account="{ row }">
          {{ row.user_account || ('用户 #' + row.user_id) }}
        </template>
        <template #cell-amount_paid="{ row }">
          <span class="adm-strong">{{ money(row.amount_paid) }}</span>
          <div v-if="row.amount_due !== row.amount_paid" class="adm-2xs adm-muted">
            应付 {{ money(row.amount_due) }}
          </div>
        </template>
        <template #cell-payment_status="{ row }">
          <AdminTag :text="paymentStatus(row.payment_status).text" :kind="paymentStatus(row.payment_status).kind" />
        </template>
        <template #cell-fulfillment_status="{ row }">
          <AdminTag :text="fulfillmentStatus(row.fulfillment_status).text" :kind="fulfillmentStatus(row.fulfillment_status).kind" />
        </template>
        <template #cell-created_at="{ row }">
          <span :title="datetime(row.created_at)">{{ fromNow(row.created_at) }}</span>
        </template>
      </AdminTable>
    </section>

    <!-- 最近兑换 -->
    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>最近兑换 / 权益发放</h2>
        <span class="adm-muted">卡密兑换、订单发卡与手动发放都记录在这里</span>
        <div class="adm-card__head__actions">
          <RouterLink :to="{ path: '/admin/users', query: { tab: 'entitlements' } }" class="adm-btn adm-btn--sm">查看全部</RouterLink>
        </div>
      </div>
      <AdminTable
        :columns="redemptionColumns"
        :rows="recent.redemptions"
        :loading="loading && !data"
        min-width="820px"
        empty-title="还没有兑换记录"
        empty-hint="用户在前台输入卡密兑换成功后，这里会出现记录。"
      >
        <template #cell-source_no="{ row }">
          <span class="adm-mono">{{ row.source_no || '—' }}</span>
        </template>
        <template #cell-source_type="{ row }">
          <AdminTag :text="entitlementSource(row.source_type)" kind="info" />
        </template>
        <template #cell-expires_at="{ row }">
          <span v-if="row.expires_at">{{ datetime(row.expires_at) }}</span>
          <span v-else class="adm-muted">不限时长</span>
        </template>
        <template #cell-created_at="{ row }">
          <span :title="datetime(row.created_at)">{{ fromNow(row.created_at) }}</span>
        </template>
      </AdminTable>
    </section>

    <!-- 最近素材 -->
    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>最近上传的素材</h2>
        <span class="adm-muted">
          已发布 {{ cards.asset_published ?? 0 }} 个 · 草稿 {{ cards.asset_draft ?? 0 }} 个 ·
          分类 {{ assetStats.category_total ?? 0 }} 个
        </span>
        <div class="adm-card__head__actions">
          <RouterLink to="/admin/assets" class="adm-btn adm-btn--sm">查看全部</RouterLink>
        </div>
      </div>
      <AdminTable
        :columns="assetColumns"
        :rows="recent.assets"
        :loading="loading && !data"
        min-width="700px"
        empty-title="还没有上传素材"
        empty-hint="在素材库里上传图片并发布后，前台素材中心就能看到。"
      >
        <template #cell-thumbnail_url="{ row }">
          <img class="adm-table__thumb" :src="row.thumbnail_url || row.image_url" :alt="row.title" loading="lazy">
        </template>
        <template #cell-status="{ row }">
          <AdminTag :text="assetStatus(row.status).text" :kind="assetStatus(row.status).kind" />
        </template>
        <template #cell-created_at="{ row }">
          <span :title="datetime(row.created_at)">{{ fromNow(row.created_at) }}</span>
        </template>
      </AdminTable>
    </section>

    <p v-if="data" class="adm-2xs adm-muted">
      数据生成时间：{{ datetime(data.generated_at) }}（刷新页面即可重新统计）
    </p>
  </div>
</template>
