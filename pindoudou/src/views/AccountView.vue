<script setup>
/* =========================================================================
   个人中心（设计稿：Figma「豆玩操作台优化」1:290「个人中心 · 已登录概览」）

   版面按设计稿重排：个人空间导航 → 欢迎行 → 四张概览卡 → 两列
   （我的作品 / 素材收藏 ‖ 个人信息 / 我的库存）。
   排版一律走 global.css 的语义类（.ty-page / .ty-section / .ty-card /
   .ty-body / .ty-label / .ty-caption / .ty-metric / .ty-num），
   页面里不再自己写字号字重 —— 规范见「豆玩 · 文字与字体规范」1:2。
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import CardRedeemPanel from '../components/ui/CardRedeemPanel.vue'
import LoginDialog from '../components/ui/LoginDialog.vue'
import Icon from '../components/ui/Icon.vue'
import {
  isLoggedIn, bootstrapDevice, bootstrapUser, isAnonymousDevice, displayName,
  currentUser, logout
} from '../composables/useUserAccount.js'
import { api, ApiError } from '../lib/api.js'
import { toastOk, toastErr } from '../composables/useToast.js'
import { myOrders, loadMyOrders, ensureBackend, syncServerEntitlements } from '../composables/useBackend.js'
import {
  ALL_FREE, isPro, planLabel, plan, creditsBalance, usage
} from '../composables/useMembership.js'
import { projects, projectLimit, options } from '../composables/useStudio.js'
import { favorites, favoriteAssets, ASSET_COUNT } from '../composables/useAssets.js'
import { inventorySummary, inventoryColors, stockOf, inventoryUpdatedAt } from '../composables/useInventory.js'
import { getBrand } from '../lib/palettes.js'
import { num, timeAgo } from '../lib/forge.js'
import { packedBeadCount } from '../lib/archive.js'

const router = useRouter()

/* ------------------------------------------------------------------ 账号与订单
   服务端权益（卡密兑换 / 订单发卡）在这里落地：登录后能兑换卡密、看订单与已开通权益。 */
onMounted(async () => {
  await bootstrapDevice()
  await ensureBackend()
  if (isLoggedIn.value) await syncServerEntitlements()
  await Promise.all([refreshOrders(), loadAccountData(), loadWeChatStatus()])
})

async function refreshOrders() {
  await loadMyOrders()
}

/* ------------------------------------------------------------------ 账号与登录方式
   服务端是权益的唯一可信来源。这里展示的身份、权益状态都来自接口，
   不做本地推断；微信绑定 / 解绑也走服务端校验。 */
const loginOpen = ref(false)
const identities = ref([])
const entitlements = ref([])
const accountLoading = ref(false)
const wechatStatus = ref(null)

/** 登录统一先弹框：手机端的扫码路径在弹窗里说明 */
function openLogin() {
  loginOpen.value = true
}

/** 微信登录状态只反映服务端配置是否齐全。 */
async function loadWeChatStatus() {
  try {
    wechatStatus.value = await api.get('/auth/oauth/wechat/status', { auth: false })
  } catch {
    wechatStatus.value = null
  }
}

async function loadAccountData() {
  if (!isLoggedIn.value) {
    identities.value = []
    entitlements.value = []
    return
  }
  accountLoading.value = true
  try {
    const [ids, ents] = await Promise.all([
      api.get('/users/me/identities').catch(() => []),
      api.get('/my/entitlements').catch(() => [])
    ])
    identities.value = Array.isArray(ids) ? ids : []
    entitlements.value = Array.isArray(ents) ? ents : []
  } finally {
    accountLoading.value = false
  }
}

const wechatIdentity = computed(() => identities.value.find(i => i.provider === 'wechat') || null)
const wechatNotConfigured = computed(() => !!(wechatStatus.value && !wechatStatus.value.configured))
const wechatBlocked = computed(() => !!(
  wechatStatus.value &&
  wechatStatus.value.configured &&
  wechatStatus.value.checked &&
  !wechatStatus.value.available
))
const wechatUnavailableReason = computed(() => {
  if (wechatNotConfigured.value) return '服务端尚未配置微信登录'
  if (wechatBlocked.value) return (wechatStatus.value && wechatStatus.value.message) || '微信登录暂不可用'
  return ''
})

const activeEntitlements = computed(() =>
  entitlements.value.filter(e => e.effective_status === 'active'))

/** 需求 §3.2 的四种权益状态。 */
const entitlementState = computed(() => {
  if (!isLoggedIn.value) return { key: 'none', label: '未登录' }
  if (currentUser.value && currentUser.value.status === 0) return { key: 'disabled', label: '已停用' }
  if (activeEntitlements.value.length) return { key: 'active', label: '生效中' }
  if (entitlements.value.length) return { key: 'expired', label: '已到期' }
  return { key: 'inactive', label: '未激活' }
})

const currentPlanNames = computed(() => {
  if (!activeEntitlements.value.length) return '免费版'
  return [...new Set(activeEntitlements.value.map(e => e.plan_name).filter(Boolean))].join(' / ') || '免费版'
})

const entitlementStartsAt = computed(() => {
  const list = activeEntitlements.value.map(e => e.starts_at).filter(Boolean).sort()
  return list[0] || null
})

const entitlementExpiresAt = computed(() => {
  const list = activeEntitlements.value.map(e => e.expires_at).filter(Boolean).sort()
  if (!list.length) return null
  if (activeEntitlements.value.some(e => !e.expires_at)) return null
  return list[list.length - 1] || null
})

const isLifetime = computed(() => activeEntitlements.value.length > 0 && entitlementExpiresAt.value === null)

function fmtDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

function identityName(row) {
  if (!row) return ''
  return row.nickname || row.provider_label || row.provider
}

async function bindWeChat() {
  if (wechatBlocked.value || wechatNotConfigured.value) {
    toastErr(wechatUnavailableReason.value || '微信登录暂不可用，请稍后再试')
    return
  }
  try {
    const result = await api.get('/users/me/oauth/wechat/bind')
    if (result && result.url) {
      window.location.assign(result.url)
      return
    }
    toastErr('无法发起微信绑定，请稍后重试')
  } catch (e) {
    if (e instanceof ApiError && e.code === 31001) {
      toastErr('微信登录暂未配置，请联系管理员')
    } else {
      toastErr(e instanceof ApiError ? e.message : '微信绑定发起失败')
    }
  }
}

async function unbindIdentity(row) {
  if (!row) return
  const label = row.provider_label || row.provider
  if (!window.confirm(`确定解绑 ${label}？解绑后不能再用它登录这个账号。`)) return
  try {
    await api.del(`/users/me/identities/${row.id}`)
    toastOk(`${label} 已解绑`)
    await Promise.all([bootstrapUser(true), loadAccountData()])
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '解绑失败，请稍后重试')
  }
}

async function doLogout() {
  await logout()
  identities.value = []
  entitlements.value = []
  toastOk('已退出登录')
}

function scrollToRedeem() {
  const el = document.getElementById('redeem')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const startedAt = computed(() => (plan.value.startedAt ? new Date(plan.value.startedAt) : null))
const expireAt = computed(() => (plan.value.expireAt ? new Date(plan.value.expireAt) : null))

const daysLeft = computed(() => {
  if (!expireAt.value) return null
  return Math.max(0, Math.ceil((expireAt.value.getTime() - Date.now()) / 86400000))
})

/* ------------------------------------------------------------------ 概览数据 */

/** 我做过多少作品、攒了多少豆子 */
const myStats = computed(() => {
  const all = projects.value
  let beads = 0
  let colors = 0
  for (const p of all) {
    const v = (p.variants || [])[0]
    if (v && v.stats) {
      beads += v.stats.beadCount || 0
      colors = Math.max(colors, v.stats.colorCount || 0)
    }
  }
  /* 「完成」以完成记录（finishedAt）为准：用户在 Build Mode 点过「完成作品」才算。
     逐格推算只是老存档的兜底 —— 否则「完成」这个动作本身没有任何意义。 */
  const isDone = p => {
    if (p.finishedAt) return true
    const v = p.variants && p.variants[0]
    const total = v && v.stats && v.stats.beadCount != null
      ? v.stats.beadCount
      : packedBeadCount(v && v.data)
    return total && Math.min((p.buildProgress || []).length, total) >= total
  }
  const done = all.filter(isDone).length
  const beadsDone = all.reduce((s, p) => (p.finishedAt ? (p.completedBeads || 0) : 0), 0)
  return { count: all.length, beads, maxColors: colors, done, beadsDone }
})

/** 最近 7 天里动过的作品（概览卡右侧那句「N 份最近编辑」） */
const recentCount = computed(() => {
  const week = Date.now() - 7 * 86400000
  return projects.value.filter(p => Number(p.updatedAt || p.createdAt || 0) >= week).length
})

/** 库存低于这条线的颜色算「待补充」 */
const STOCK_LOW = 100
const lowStock = computed(() => inventoryColors.value.filter(c => stockOf(c.id) < STOCK_LOW))
/** 库存表按数量升序：最缺的排前面 */
const stockRows = computed(() =>
  [...inventoryColors.value]
    .map(c => ({ color: c, qty: stockOf(c.id) }))
    .sort((a, b) => a.qty - b.qty)
)

/** 常用色板（工作台当前用的那一套） */
const brandLabel = computed(() => {
  const b = getBrand(options.brandId)
  return b ? b.name.replace(/\s*套装$/, '') : 'MARD'
})

/* ------------------------------------------------------------------ 我的作品 */

const workFilter = ref('recent')
const workQuery = ref('')

const sortedWorks = computed(() =>
  [...projects.value].sort((a, b) => (Number(b.updatedAt || 0) - Number(a.updatedAt || 0)))
)

const visibleWorks = computed(() => {
  const q = workQuery.value.trim()
  let list = sortedWorks.value
  if (workFilter.value === 'free') list = list.filter(p => p.createMode === 'free')
  else if (workFilter.value === 'edit') list = list.filter(p => p.createMode !== 'free')
  if (q) list = list.filter(p => String(p.name || '').includes(q))
  return list.slice(0, 3)
})

/** 作品卡片上的类型标签（设计稿：自由画布 / 图纸转换；老存档没有 createMode，按图纸转换算） */
function workModeLabel(p) {
  return p.createMode === 'free' ? '自由画布' : '图纸转换'
}

function workStats(p) {
  const v = (p.variants || [])[0]
  const s = (v && v.stats) || {}
  return {
    size: s.artW && s.artH ? `${s.artW} × ${s.artH} 格` : '尺寸未记录',
    colors: s.colorCount || 0,
    beads: s.beadCount || 0
  }
}

function openWork(p) {
  /* 装载交给工作台：它要先按作品的创作模式把当前那份文档收好，
     直接在这里 openProject 会把另一种模式正在编辑的图纸覆盖掉 */
  router.push(`/editor/${p.id}`)
}

/* ------------------------------------------------------------------ 素材收藏 */

const favAssets = computed(() => favoriteAssets.value.slice(0, 3))

function assetSize(a) {
  if (a.beadCols && a.beadRows) return `${a.beadCols} × ${a.beadRows} 格`
  return a.size || '—'
}

/* ------------------------------------------------------------------ 个人信息 */

const userName = computed(() => displayName.value || (isLoggedIn.value ? '本机访客' : '豆友'))
const userInitial = computed(() => (userName.value || '豆').slice(0, 1))
const userBio = computed(() => {
  if (!isLoggedIn.value) return '登录后可绑定微信或使用邮箱账号，换设备也能恢复身份。'
  if (isAnonymousDevice.value) return '本机匿名身份，也可以登录其他账号同步作品。'
  if (wechatIdentity.value) return '微信账号，也可以绑定邮箱。'
  if (currentUser.value && currentUser.value.email) return '邮箱账号，也可以绑定微信。'
  return '登录后可绑定微信或使用邮箱账号，换设备也能恢复身份。'
})

/** 手机号打码：138 **** 0628 */
function maskPhone(phone) {
  const s = String(phone || '')
  if (!s) return '未绑定'
  if (s.length < 7) return s.slice(0, 1) + ' **** ' + s.slice(-2)
  return `${s.slice(0, 3)} **** ${s.slice(-4)}`
}

/* ------------------------------------------------------------------ 库存时间 */

/** 库存最后一次更新的日期（设计稿：我的库存卡右下角「最近更新 11 月 1 日」） */
const inventoryUpdatedLabel = computed(() => {
  const ts = inventoryUpdatedAt.value
  if (!ts) return '还没有记录'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '还没有记录'
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const sameDay = sameYear &&
    d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return '今天'
  return sameYear
    ? `${d.getMonth() + 1} 月 ${d.getDate()} 日`
    : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
})
</script>

<template>
  <div class="ac">
    <div class="acInner">
      <!-- ============================ 欢迎行 ============================ -->
      <header class="acHero">
        <div class="acHero__text">
          <h1 class="ty-page">{{ userName }}，今天也来拼点喜欢的。</h1>
          <p class="ty-body is-muted">在这里收好你的图纸、灵感和每一颗拼豆。</p>
        </div>
        <RouterLink class="acBtn acBtn--lime" to="/editor">
          <Icon name="arrow-right" :size="16" />返回操作台
        </RouterLink>
      </header>

      <!-- ============================ 四张概览卡 ============================ -->
      <section class="acStats" aria-label="概览">
        <div class="acStat">
          <span class="ty-label acStat__name">
            保存的作品<Icon name="folder-open" :size="14" />
          </span>
          <div class="acStat__row">
            <p class="acStat__value">
              <b class="ty-metric">{{ myStats.count }}</b><span class="ty-caption">份</span>
            </p>
            <span class="ty-caption acStat__note">{{ recentCount }} 份最近编辑</span>
          </div>
        </div>

        <div class="acStat">
          <span class="ty-label acStat__name">
            素材收藏<Icon name="heart" :size="14" />
          </span>
          <div class="acStat__row">
            <p class="acStat__value">
              <b class="ty-metric">{{ favorites.length }}</b><span class="ty-caption">个</span>
            </p>
            <span class="ty-caption acStat__note">来自素材库</span>
          </div>
        </div>

        <div class="acStat">
          <span class="ty-label acStat__name">
            拼豆库存<Icon name="package" :size="14" />
          </span>
          <div class="acStat__row">
            <p class="acStat__value">
              <b class="ty-metric">{{ num(inventorySummary.beads) }}</b><span class="ty-caption">颗</span>
            </p>
            <span class="ty-caption acStat__note">{{ brandLabel }} · {{ inventorySummary.colors }} 色</span>
          </div>
        </div>

        <div class="acStat acStat--warn">
          <span class="ty-label acStat__name">
            待补充颜色<Icon name="info" :size="14" />
          </span>
          <div class="acStat__row">
            <p class="acStat__value">
              <b class="ty-metric">{{ lowStock.length }}</b><span class="ty-caption">色</span>
            </p>
            <span class="ty-caption acStat__note">低于 {{ STOCK_LOW }} 颗提醒线</span>
          </div>
        </div>
      </section>

      <!-- ============================ 两列主体 ============================ -->
      <div class="acGrid">
        <!-- ---------------------------- 左列 ---------------------------- -->
        <div class="acCol">
          <!-- 我的作品 -->
          <section class="acCard" data-audit="account-works">
            <header class="acCard__head">
              <h2 class="ty-section">我的作品 <span class="acCard__count ty-num">{{ myStats.count }}</span></h2>
              <RouterLink class="acLink" to="/projects">管理全部 <Icon name="chevron-right" :size="16" /></RouterLink>
            </header>

            <div class="acWorks__bar">
              <div class="acPills" role="tablist" aria-label="作品筛选">
                <button
                  v-for="f in [
                    { key: 'recent', label: '最近编辑' },
                    { key: 'free', label: '自由画布' },
                    { key: 'edit', label: '图纸转换' }
                  ]" :key="f.key" type="button" role="tab"
                  :aria-selected="workFilter === f.key"
                  class="acPill" :class="{ 'is-on': workFilter === f.key }"
                  @click="workFilter = f.key"
                >{{ f.label }}</button>
              </div>
              <label class="acSearch">
                <Icon name="search" :size="16" />
                <input v-model="workQuery" type="search" placeholder="搜索我的图纸" aria-label="搜索我的图纸">
              </label>
            </div>

            <div v-if="visibleWorks.length" class="acWorks">
              <article v-for="p in visibleWorks" :key="p.id" class="acWork">
                <div class="acWork__art">
                  <img v-if="p.thumbnail" :src="p.thumbnail" :alt="p.name">
                  <div v-else class="acWork__art--empty"><Icon name="image" :size="20" /></div>
                  <span class="acWork__tag ty-caption is-strong">{{ workModeLabel(p) }}</span>
                  <RouterLink class="acWork__more" :to="'/editor/' + p.id" :aria-label="`${p.name} 的更多操作`">
                    <Icon name="ellipsis" :size="16" />
                  </RouterLink>
                </div>
                <div class="acWork__body">
                  <h3 class="ty-card acWork__name">{{ p.name }}</h3>
                  <p class="ty-caption acWork__meta">
                    {{ workStats(p).size }} · {{ workStats(p).colors }} 色 · {{ num(workStats(p).beads) }} 颗
                  </p>
                  <div class="acWork__foot">
                    <span class="ty-caption">{{ timeAgo(p.updatedAt) }}编辑</span>
                    <button type="button" class="acLink acLink--strong" @click="openWork(p)">
                      继续创作 <Icon name="arrow-right" :size="16" />
                    </button>
                  </div>
                </div>
              </article>
            </div>
            <p v-else class="acEmpty ty-body is-muted">
              还没有作品。上传一张图，豆玩就能把它变成拼豆图纸。
              <RouterLink class="acLink acLink--strong" to="/editor">去创作</RouterLink>
            </p>
          </section>

          <!-- 素材收藏 -->
          <section class="acCard" data-audit="account-favorites">
            <header class="acCard__head">
              <h2 class="ty-section">素材收藏 <span class="acCard__count ty-num">{{ favorites.length }}</span></h2>
              <RouterLink class="acLink" to="/materials/?col=fav">查看全部 <Icon name="chevron-right" :size="16" /></RouterLink>
            </header>
            <p class="ty-caption acCard__desc">
              从素材库收集的灵感，使用后会另存为你的作品。
            </p>

            <div v-if="favAssets.length" class="acFavs">
              <article v-for="a in favAssets" :key="a.id" class="acFav">
                <div class="acFav__art">
                  <img v-if="a.image" :src="a.image" :alt="a.name">
                  <div v-else class="acFav__art--empty" v-html="a.svg"></div>
                  <span class="acFav__heart"><Icon name="heart" :size="16" /></span>
                </div>
                <div class="acFav__body">
                  <div class="acFav__row">
                    <h3 class="ty-card acFav__name">{{ a.name }}</h3>
                    <RouterLink class="acLink acLink--strong" :to="'/materials/' + a.slug">
                      使用素材 <Icon name="arrow-right" :size="16" />
                    </RouterLink>
                  </div>
                  <p class="ty-caption acFav__meta">{{ assetSize(a) }} · {{ a.difficulty || '图片素材' }}</p>
                </div>
              </article>
            </div>
            <p v-else class="acEmpty ty-body is-muted">
              还没有收藏素材。先去素材库逛逛，把喜欢的图案存起来。
            </p>

            <footer class="acFav__foot">
              <span class="ty-caption">下一个想拼的，也许就在这里。</span>
              <RouterLink class="acLink acLink--strong" to="/materials/">
                逛逛素材库 <Icon name="arrow-right" :size="16" />
              </RouterLink>
            </footer>
          </section>
        </div>

        <!-- ---------------------------- 右列 ---------------------------- -->
        <div class="acCol acCol--side">
          <!-- 个人信息 -->
          <section class="acCard" data-audit="account-info">
            <header class="acCard__head">
              <h2 class="ty-section">个人信息</h2>
              <RouterLink class="acLink" to="/settings">编辑资料 <Icon name="chevron-right" :size="16" /></RouterLink>
            </header>

            <div class="acInfo__who">
              <div class="acAvatar">
                <img v-if="currentUser && currentUser.avatar_url" :src="currentUser.avatar_url" alt="" referrerpolicy="no-referrer">
                <span v-else>{{ userInitial }}</span>
              </div>
              <div class="acInfo__id">
                <h3 class="ty-section">{{ userName }}</h3>
                <p class="ty-caption">{{ userBio }}</p>
              </div>
            </div>

            <dl class="acInfo__rows">
              <div class="acInfo__row">
                <dt class="ty-caption">豆玩 ID</dt>
                <dd class="ty-num">{{ (currentUser && currentUser.username) || '—' }}</dd>
              </div>
              <div class="acInfo__row">
                <dt class="ty-caption">绑定手机</dt>
                <dd class="ty-num">{{ maskPhone(currentUser && currentUser.phone) }}</dd>
              </div>
              <div class="acInfo__row">
                <dt class="ty-caption">加入豆玩</dt>
                <dd class="ty-body">{{ currentUser && currentUser.created_at ? fmtDate(currentUser.created_at) : '—' }}</dd>
              </div>
            </dl>

            <p class="acInfo__palette">
              <Icon name="palette" :size="16" />
              <span class="ty-label">常用色板 {{ brandLabel }} · 2.6 mm 拼豆</span>
            </p>

            <div class="acInfo__actions">
              <button
                v-if="!isLoggedIn || isAnonymousDevice"
                type="button" class="acBtn acBtn--lime" data-audit="account-login" @click="openLogin"
              >{{ isLoggedIn ? '登录其他账号' : '登录' }}</button>
              <button
                v-else-if="!wechatIdentity"
                type="button" class="acBtn acBtn--lime" data-audit="account-bind-wechat"
                :disabled="wechatBlocked || wechatNotConfigured"
                :title="wechatBlocked || wechatNotConfigured ? wechatUnavailableReason : '绑定微信'"
                @click="bindWeChat"
              >绑定微信</button>
              <button
                v-else type="button" class="acBtn acBtn--ghost"
                :disabled="identities.length <= 1"
                :title="identities.length <= 1 ? '账号至少要保留一种登录方式' : '解绑微信'"
                @click="unbindIdentity(wechatIdentity)"
              >解绑微信</button>
              <button v-if="isLoggedIn" type="button" class="acBtn acBtn--ghost" @click="doLogout">退出登录</button>
            </div>
            <p v-if="wechatNotConfigured || wechatBlocked" class="ty-caption acInfo__warn" data-audit="account-wechat-status">
              {{ wechatUnavailableReason }}
            </p>
            <p v-if="accountLoading" class="ty-caption">正在刷新账号与权益…</p>
          </section>

          <!-- 我的库存 -->
          <section class="acCard" data-audit="account-stock">
            <header class="acCard__head">
              <h2 class="ty-section">我的库存</h2>
              <RouterLink class="acLink" to="/inventory">管理库存 <Icon name="chevron-right" :size="16" /></RouterLink>
            </header>

            <div class="acStock__bar">
              <span class="ty-label">{{ brandLabel }} · 2.6 mm</span>
              <span class="ty-caption">已录入 {{ inventorySummary.colors }} 色</span>
            </div>

            <p v-if="lowStock.length" class="acStock__warn">
              <Icon name="info" :size="16" />
              <span class="ty-caption">{{ lowStock.length }} 色不足 {{ STOCK_LOW }} 颗，开拼前记得补充。</span>
            </p>

            <div v-if="stockRows.length" class="acStock">
              <div class="acStock__head">
                <span class="ty-caption">色号 / 颜色</span>
                <span class="ty-caption">剩余颗数</span>
                <span class="ty-caption">状态</span>
              </div>
              <div v-for="row in stockRows.slice(0, 4)" :key="row.color.id" class="acStock__row">
                <span class="acStock__name">
                  <i class="acStock__chip" :style="{ background: row.color.hex }"></i>
                  <b class="ty-label">{{ row.color.code }}</b>
                  <span class="ty-caption">{{ row.color.name }}</span>
                </span>
                <span class="ty-num acStock__qty">{{ num(row.qty) }}</span>
                <span class="ty-caption acStock__state" :class="{ 'is-low': row.qty < STOCK_LOW }">
                  {{ row.qty < STOCK_LOW ? '待补充' : '充足' }}
                </span>
              </div>
              <p v-if="stockRows.length > 4" class="ty-caption acStock__more">
                还有 {{ stockRows.length - 4 }} 色，<RouterLink class="acLink acLink--strong" to="/inventory">去库存页查看</RouterLink>
              </p>
            </div>
            <p v-else class="acEmpty ty-body is-muted">
              还没有录入库存。<RouterLink class="acLink acLink--strong" to="/inventory">记录第一颗豆子</RouterLink>
            </p>

            <footer class="acStock__foot">
              <span class="ty-caption">最近更新 {{ inventoryUpdatedLabel }}</span>
              <RouterLink class="acBtn acBtn--lime acBtn--sm" to="/inventory">
                <Icon name="plus" :size="16" />记录补豆
              </RouterLink>
            </footer>
          </section>
        </div>
      </div>

      <!-- ============================ 会员与账号（临时免费期间整块隐藏） ============================ -->
      <section v-if="!ALL_FREE" class="acCard acCard--wide" data-audit="account-entitlement" :data-state="entitlementState.key">
        <header class="acCard__head">
          <h2 class="ty-section">我的权益</h2>
          <button type="button" class="acBtn acBtn--lime acBtn--sm" @click="scrollToRedeem">兑换卡密</button>
        </header>
        <div class="acEnt">
          <div class="acEnt__item">
            <span class="ty-caption">权益状态</span>
            <b class="ty-label is-strong" :class="'is-' + entitlementState.key">{{ entitlementState.label }}</b>
          </div>
          <div class="acEnt__item">
            <span class="ty-caption">当前套餐</span>
            <b class="ty-label is-strong">{{ currentPlanNames }}</b>
          </div>
          <div class="acEnt__item">
            <span class="ty-caption">激活时间</span>
            <b class="ty-body">{{ entitlementStartsAt ? fmtDateTime(entitlementStartsAt) : '—' }}</b>
          </div>
          <div class="acEnt__item">
            <span class="ty-caption">到期时间</span>
            <b class="ty-body">{{ isLifetime ? '不限时长' : (entitlementExpiresAt ? fmtDateTime(entitlementExpiresAt) : '—') }}</b>
          </div>
        </div>
        <p v-if="entitlementState.key === 'expired'" class="ty-caption acCard__note">
          权益已到期，免费功能仍可继续使用；兑换新卡密即可恢复付费功能。
        </p>
        <p v-else-if="entitlementState.key === 'disabled'" class="ty-caption acCard__note">
          账号已被停用，请联系客服处理。
        </p>
        <p v-else-if="entitlementState.key === 'inactive'" class="ty-caption acCard__note">
          还没有兑换过卡密。基础图纸生成与编辑一直免费。
        </p>
      </section>

      <section v-if="!ALL_FREE" id="redeem" class="acGrid acGrid--pair">
        <div class="acCard">
          <header class="acCard__head"><h2 class="ty-section">账号与卡密兑换</h2></header>
          <CardRedeemPanel />
        </div>
        <div class="acCard">
          <header class="acCard__head">
            <h2 class="ty-section">我的订单</h2>
            <button type="button" class="acLink" @click="refreshOrders">刷新</button>
          </header>
          <template v-if="isLoggedIn">
            <div v-if="myOrders.length" class="acOrders">
              <div v-for="o in myOrders" :key="o.id" class="acOrder">
                <div>
                  <b class="ty-label is-strong">{{ o.plan_name }}</b>
                  <div class="ty-caption">{{ o.order_no }}</div>
                </div>
                <div class="acOrder__right">
                  <span class="ty-caption">{{ o.payment_status_text }}</span>
                  <span class="ty-num">¥{{ Number(o.amount_due).toFixed(2) }}</span>
                  <span class="ty-caption">{{ o.fulfillment_status_text }}</span>
                </div>
              </div>
            </div>
            <p v-else class="acEmpty ty-body is-muted">还没有订单。</p>
          </template>
          <p v-else class="acEmpty ty-body is-muted">第一次兑换卡密或下单时会自动创建账号。</p>
        </div>
      </section>

      <!-- ============================ 说明 ============================ -->
      <footer class="acFoot">
        <span class="ty-body">一颗一颗，把灵感变成作品。</span>
        <span class="ty-caption">
          作品云同步 · 库存与收藏按本机记录<template v-if="isPro">
            · {{ planLabel }} · 有效期至 {{ expireAt ? expireAt.toLocaleDateString() : '不限时长' }}</template>
        </span>
      </footer>
    </div>

    <LoginDialog v-model="loginOpen" @success="loadAccountData" />
  </div>
</template>

<style scoped>
/* =========================================================================
   个人中心版面（Figma 1:290）
   底色体系与排版令牌都取自 global.css 的 --ty-* 变量，
   这里只写布局与形状，不写字号字重。
   ========================================================================= */
.ac{
  font-family:var(--font-sans);
  letter-spacing:0;
  color:var(--ty-body-ink);
  background:var(--ty-bg);
  min-height:100%;
  padding-bottom:32px;
}

/* ---------------- 内容区 ---------------- */
.acInner{width:min(1440px,100%);margin:0 auto;padding:32px 64px 0}

/* ---------------- 欢迎行 ---------------- */
.acHero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:24px}
.acHero__text h1{margin:0}
.acHero__text p{margin:4px 0 0}

/* ---------------- 通用按钮与链接 ---------------- */
.acBtn{
  display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 16px;
  border:1px solid transparent;border-radius:99px;background:transparent;
  font-family:var(--font-sans);font-size:var(--ty-label);font-weight:500;
  line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ty-ink);
  text-decoration:none;cursor:pointer;white-space:nowrap;transition:var(--t);
}
.acBtn--lime{background:var(--ty-accent);color:var(--ty-ink);font-weight:700}
.acBtn--lime:hover{filter:brightness(.97)}
.acBtn--ghost{border-color:var(--ty-line);background:var(--ty-surface)}
.acBtn--ghost:hover{background:var(--ty-surface-soft)}
.acBtn--sm{height:30px;padding:0 12px;font-size:var(--ty-caption);line-height:var(--ty-caption-lh)}
.acBtn:disabled{opacity:.45;cursor:not-allowed}
.acLink{
  display:inline-flex;align-items:center;gap:2px;
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ty-muted);
  text-decoration:none;cursor:pointer;transition:var(--t);
}
.acLink:hover{color:var(--ty-ink)}
.acLink--strong{font-weight:700;color:var(--ty-ink)}
.acLink--strong:hover{text-decoration:underline;text-underline-offset:3px}

/* ---------------- 概览卡 ---------------- */
.acStats{
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px;
}
.acStat{
  display:flex;flex-direction:column;gap:2px;
  min-height:96px;padding:0 20px;justify-content:center;
  background:var(--ty-surface);border:1px solid var(--ty-line);border-radius:16px;
}
.acStat--warn{background:var(--ty-accent-soft);border-color:#E3EFC0}
.acStat__name{display:inline-flex;align-items:center;gap:6px;color:var(--ty-body-ink)}
.acStat__row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:2px}
.acStat__value{display:flex;align-items:baseline;gap:6px;margin:0}
.acStat__value b{font-size:var(--ty-metric);line-height:var(--ty-metric-lh)}
.acStat__value span{color:var(--ty-muted)}
.acStat__note{color:var(--ty-muted);text-align:right}

/* ---------------- 两列 ---------------- */
.acGrid{display:grid;grid-template-columns:minmax(0,1fr) 408px;gap:24px;align-items:start}
.acGrid--pair{grid-template-columns:1fr 1fr;margin-top:24px}
.acCol{display:flex;flex-direction:column;gap:24px;min-width:0}

/* ---------------- 卡片 ---------------- */
.acCard{
  background:var(--ty-surface);border:1px solid var(--ty-line);border-radius:16px;
  padding:24px;
}
.acCard--wide{margin-top:24px}
.acCard__head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.acCard__head h2{margin:0;display:inline-flex;align-items:baseline;gap:8px}
.acCard__count{color:var(--ty-muted);font-weight:400}
.acCard__desc{margin:6px 0 0}
.acCard__note{margin:12px 0 0;display:block}

/* ---------------- 我的作品 ---------------- */
.acWorks__bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 14px;flex-wrap:wrap}
.acPills{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.acPill{
  height:26px;padding:0 10px;border:1px solid transparent;border-radius:99px;background:transparent;
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ty-muted);cursor:pointer;
}
.acPill:hover{color:var(--ty-ink)}
.acPill.is-on{background:var(--ty-surface-soft);border-color:var(--ty-line);font-weight:700;color:var(--ty-ink)}
.acSearch{
  display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;
  border:1px solid var(--ty-line);border-radius:99px;background:var(--ty-surface-page);
  color:var(--ty-muted);
}
.acSearch input{
  width:140px;border:0;outline:0;background:transparent;
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ty-body-ink);
}
.acSearch input::placeholder{color:var(--ty-muted)}
.acWorks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.acWork{
  display:flex;flex-direction:column;border:1px solid var(--ty-line);border-radius:14px;overflow:hidden;
  background:var(--ty-surface);transition:var(--t);
}
.acWork:hover{border-color:#C9D8BE;box-shadow:0 2px 10px rgba(26,45,34,.06)}
.acWork__art{position:relative;aspect-ratio:16/11;background:var(--ty-surface-soft);display:grid;place-items:center}
.acWork__art img{width:100%;height:100%;object-fit:cover;display:block}
.acWork__art--empty{color:var(--ty-muted)}
.acWork__tag{
  position:absolute;left:8px;top:8px;padding:2px 8px;border-radius:99px;
  background:rgba(255,255,255,.92);color:var(--ty-ink);
}
.acWork__more{
  position:absolute;right:8px;top:8px;width:26px;height:26px;border-radius:50%;
  display:grid;place-items:center;background:rgba(255,255,255,.92);color:var(--ty-ink);
}
.acWork__more:hover{background:#fff}
.acWork__body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:2px}
.acWork__name{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acWork__meta{margin:0}
.acWork__foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}

/* ---------------- 素材收藏 ---------------- */
.acFavs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:14px}
.acFav{
  border:1px solid var(--ty-line);border-radius:14px;overflow:hidden;background:var(--ty-surface);transition:var(--t);
}
.acFav:hover{border-color:#C9D8BE;box-shadow:0 2px 10px rgba(26,45,34,.06)}
.acFav__art{position:relative;aspect-ratio:16/11;background:var(--ty-surface-soft);display:grid;place-items:center;overflow:hidden}
.acFav__art img{width:100%;height:100%;object-fit:cover;display:block}
.acFav__art--empty{line-height:0}
.acFav__art--empty :deep(svg){width:100%;height:100%;display:block}
.acFav__heart{
  position:absolute;right:8px;top:8px;width:26px;height:26px;border-radius:50%;
  display:grid;place-items:center;background:rgba(255,255,255,.92);color:var(--ty-ink);
}
.acFav__body{padding:10px 12px 12px}
.acFav__row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.acFav__name{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acFav__meta{margin:2px 0 0}
.acFav__foot{
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
  margin-top:16px;padding-top:14px;border-top:1px solid var(--ty-line);
}

/* ---------------- 成长记录 ---------------- */
/* ---------------- 个人信息 ---------------- */
.acInfo__who{display:flex;align-items:center;gap:14px;margin-top:16px}
.acAvatar{
  width:56px;height:56px;flex:0 0 auto;border-radius:16px;overflow:hidden;
  background:var(--ty-accent-soft);color:#548561;
  display:grid;place-items:center;
  font-family:var(--font-sans);font-size:18px;font-weight:700;line-height:var(--ty-section-lh);letter-spacing:0;
}
.acAvatar img{width:100%;height:100%;object-fit:cover}
.acInfo__id h3{margin:0}
.acInfo__id p{margin:2px 0 0}
.acInfo__rows{margin:16px 0 0;display:flex;flex-direction:column}
.acInfo__row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0}
.acInfo__row dt{margin:0;color:var(--ty-muted)}
.acInfo__row dd{margin:0;color:var(--ty-ink)}
.acInfo__palette{
  display:flex;align-items:center;gap:8px;margin:14px 0 0;padding:10px 12px;
  border-radius:10px;background:var(--ty-surface-soft);color:var(--ty-secondary);
}
.acInfo__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}
.acInfo__warn{margin:8px 0 0;display:block;color:var(--ty-warn)}

/* ---------------- 我的库存 ---------------- */
.acStock__bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}
.acStock__warn{
  display:flex;align-items:center;gap:8px;margin:12px 0 0;padding:9px 12px;
  border-radius:10px;background:var(--ty-warn-soft);color:var(--ty-warn);
}
.acStock{margin-top:14px}
.acStock__head,
.acStock__row{display:grid;grid-template-columns:minmax(0,1fr) 72px 56px;align-items:center;gap:8px}
.acStock__head{padding-bottom:6px;border-bottom:1px solid var(--ty-line)}
.acStock__head span:nth-child(2),
.acStock__head span:nth-child(3){text-align:right}
.acStock__row{padding:8px 0;border-bottom:1px solid var(--ty-line)}
.acStock__name{display:flex;align-items:center;gap:8px;min-width:0}
.acStock__chip{width:20px;height:20px;flex:0 0 auto;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
.acStock__name b{color:var(--ty-ink)}
.acStock__name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acStock__qty{text-align:right}
.acStock__state{text-align:right}
.acStock__state.is-low{color:var(--ty-warn)}
.acStock__more{margin:10px 0 0;display:block}
.acStock__foot{
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;
}

/* ---------------- 权益 / 订单 ---------------- */
.acEnt{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}
.acEnt__item{
  display:flex;flex-direction:column;gap:2px;padding:12px;border-radius:12px;
  background:var(--ty-surface-page);border:1px solid var(--ty-line);
}
.acEnt__item b{color:var(--ty-ink)}
.acEnt__item b.is-active{color:#2F7D4F}
.acEnt__item b.is-expired,.acEnt__item b.is-disabled{color:var(--ty-warn)}
.acOrders{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.acOrder{
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 12px;border-radius:12px;background:var(--ty-surface-page);border:1px solid var(--ty-line);
}
.acOrder__right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}

/* ---------------- 空态与页脚 ---------------- */
.acEmpty{margin:16px 0 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.acFoot{
  display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  margin-top:24px;padding:18px 0 0;border-top:1px solid var(--ty-line);
}

/* ---------------- 平板 / 手机 ---------------- */
@media(max-width:1180px){
  .acInner{padding-left:32px;padding-right:32px}
  .acGrid{grid-template-columns:minmax(0,1fr)}
  .acStats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:780px){
  .acInner{padding-left:16px;padding-right:16px}
  .acHero{flex-direction:column;align-items:flex-start;gap:14px}
  .acStats{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .acStat{padding:0 14px}
  .acWorks,.acFavs{grid-template-columns:repeat(2,minmax(0,1fr))}
  .acGrid--pair{grid-template-columns:1fr}
  .acEnt{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:520px){
  .acWorks,.acFavs{grid-template-columns:1fr}
}
</style>
