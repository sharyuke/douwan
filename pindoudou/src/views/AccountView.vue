<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import CardRedeemPanel from '../components/ui/CardRedeemPanel.vue'
import LoginDialog from '../components/ui/LoginDialog.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import {
  isLoggedIn, bootstrapDevice, bootstrapUser, isAnonymousDevice, displayName,
  currentUser, logout
} from '../composables/useUserAccount.js'
import { api, ApiError } from '../lib/api.js'
import { toastOk, toastErr } from '../composables/useToast.js'
import { myOrders, loadMyOrders, ensureBackend, syncServerEntitlements } from '../composables/useBackend.js'
import {
  ALL_FREE, isPro, planLabel, plan, credits, creditsBalance, usage
} from '../composables/useMembership.js'
import { projects, projectLimit } from '../composables/useStudio.js'
import { favorites, ASSET_COUNT } from '../composables/useAssets.js'
import { inventorySummary } from '../composables/useInventory.js'
import { num, timeAgo } from '../lib/forge.js'
import { packedBeadCount } from '../lib/archive.js'

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

/* 登录统一先弹框：手机端的扫码路径在弹窗里说明 */
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
  if (!activeEntitlements.value.length) return null
  if (activeEntitlements.value.some(e => !e.expires_at)) return null
  const list = activeEntitlements.value.map(e => e.expires_at).filter(Boolean).sort()
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
  const beadsDone = all.reduce((s, p) => s + (p.finishedAt ? (p.completedBeads || 0) : 0), 0)
  return { count: all.length, beads, maxColors: colors, done, beadsDone }
})

/** 成长体系（PRD §53）：按完成作品数 */
const badges = computed(() => {
  const n = myStats.value.done
  return [
    { name: '新手', need: 1, icon: 'smile', got: n >= 1 || myStats.value.count >= 1 },
    { name: '入门', need: 5, icon: 'layers', got: n >= 5 },
    { name: '爱好者', need: 20, icon: 'palette', got: n >= 20 },
    { name: '拼豆达人', need: 50, icon: 'star', got: n >= 50 },
    { name: '设计师', need: 10, icon: 'sparkles', got: false, desc: '发布 10 个原创作品' }
  ]
})

const nextBadge = computed(() => badges.value.find(b => !b.got) || null)

/* 会员开通 / 退订 / Credits 购买都走服务端。
   这里不再提供任何本地演示入口，避免改前端状态就能解锁收费功能。 */
</script>

<template>
  <div class="wrap main--pad">
    <div class="pagehead">
      <div>
        <h1>我的账户</h1>
        <p>
          当前身份：<b>{{ isLoggedIn ? (displayName || '本机访客') : '尚未创建' }}</b>
          <span v-if="isAnonymousDevice" class="tag">本机匿名身份</span>
          · <template v-if="ALL_FREE">全部功能免费开放，</template><template v-else>会员权益由服务端记录，</template>作品与库存保存在本机浏览器。
        </p>
      </div>
      <div class="pagehead__actions">
        <button
          v-if="!isLoggedIn || isAnonymousDevice"
          type="button"
          class="btn primary"
          data-audit="account-login"
          @click="openLogin"
        >登录</button>
      </div>
    </div>

    <!-- 账号与登录方式（需求 §3.2「账号与安全」） -->
    <section class="authCard" data-audit="account-auth">
      <div class="authCard__head">
        <div class="authWho">
          <img
            v-if="currentUser && currentUser.avatar_url"
            class="authAvatar"
            :src="currentUser.avatar_url"
            alt=""
            referrerpolicy="no-referrer"
          >
          <div v-else class="authAvatar authAvatar--fallback">{{ isLoggedIn ? '豆' : '?' }}</div>
          <div>
            <h2>{{ isLoggedIn ? (displayName || '本机访客') : '还没有登录' }}</h2>
            <p class="hint">
              <template v-if="isLoggedIn">
                {{ currentUser && currentUser.username ? '@' + currentUser.username : '' }}
                <span v-if="isAnonymousDevice" class="tag warn">本机匿名身份</span>
                <template v-else>
                  <span v-if="wechatIdentity" class="tag free">微信账号</span>
                  <span v-else-if="currentUser && currentUser.email" class="tag free">邮箱账号</span>
                </template>
              </template>
              <template v-else>登录后可绑定微信或使用邮箱账号，换设备也能恢复身份。</template>
            </p>
          </div>
        </div>
        <div class="authCard__actions">
          <button v-if="!isLoggedIn || isAnonymousDevice" class="btn primary sm" @click="openLogin">
            {{ isLoggedIn ? '登录其他账号' : '登录' }}
          </button>
          <button v-if="isLoggedIn" class="btn btn-secondary sm" @click="doLogout">退出登录</button>
        </div>
      </div>

      <div class="authMethods">
        <div class="authMethod">
          <div class="authMethod__icon authMethod__icon--wechat">微</div>
          <div class="authMethod__body">
            <b>微信登录</b>
            <span v-if="wechatIdentity" class="hint">
              已绑定 {{ identityName(wechatIdentity) }}
              <template v-if="wechatIdentity.last_login_at"> · 最近登录 {{ fmtDateTime(wechatIdentity.last_login_at) }}</template>
            </span>
            <span v-else class="hint">未绑定。绑定后可以直接用微信登录这个账号。</span>
            <span v-if="wechatNotConfigured || wechatBlocked" class="hint warn" data-audit="account-wechat-status">
              {{ wechatUnavailableReason }}
            </span>
          </div>
          <div class="authMethod__action">
            <button
              v-if="isLoggedIn && wechatIdentity"
              class="btn btn-secondary sm"
              :disabled="identities.length <= 1"
              :title="identities.length <= 1 ? '账号至少要保留一种登录方式' : '解绑微信'"
              @click="unbindIdentity(wechatIdentity)"
            >解绑</button>
            <button
              v-else-if="isLoggedIn"
              class="btn primary sm"
              data-audit="account-bind-wechat"
              :disabled="wechatBlocked || wechatNotConfigured"
              :title="wechatBlocked || wechatNotConfigured ? wechatUnavailableReason : '绑定微信'"
              @click="bindWeChat"
            >绑定微信</button>
            <button v-else class="btn btn-secondary sm" @click="openLogin">去登录</button>
          </div>
        </div>
      </div>

      <p class="authNote">
        账号与安全：解绑前必须保留至少一种可用的登录方式。
        微信身份按 openid 唯一，不会按昵称或头像自动合并；如需合并账号请联系客服人工核验。
      </p>
    </section>

    <!-- 权益状态（服务端时间）：临时免费期间不展示会员与卡密相关模块 -->
    <section v-if="!ALL_FREE" class="entCard" data-audit="account-entitlement" :data-state="entitlementState.key">
      <div class="entCard__head">
        <div>
          <h2>我的权益</h2>
          <p class="hint">状态与时间由服务端判定，前端只负责展示。</p>
        </div>
        <div class="entCard__actions">
          <button class="btn primary sm" @click="scrollToRedeem">兑换卡密</button>
        </div>
      </div>
      <div class="entGrid">
        <div class="entItem">
          <span class="muted">权益状态</span>
          <b class="entState" :class="entitlementState.key">{{ entitlementState.label }}</b>
        </div>
        <div class="entItem">
          <span class="muted">当前套餐</span>
          <b>{{ currentPlanNames }}</b>
        </div>
        <div class="entItem">
          <span class="muted">激活时间</span>
          <b>{{ entitlementStartsAt ? fmtDateTime(entitlementStartsAt) : '—' }}</b>
        </div>
        <div class="entItem">
          <span class="muted">到期时间</span>
          <b>{{ isLifetime ? '不限时长' : (entitlementExpiresAt ? fmtDateTime(entitlementExpiresAt) : '—') }}</b>
        </div>
      </div>
      <p v-if="entitlementState.key === 'expired'" class="entHint warn">
        权益已到期，免费功能仍可继续使用；兑换新卡密即可恢复付费功能。
      </p>
      <p v-else-if="entitlementState.key === 'disabled'" class="entHint warn">
        账号已被停用，请联系客服处理。
      </p>
      <p v-else-if="entitlementState.key === 'inactive'" class="entHint">
        还没有兑换过卡密。基础图纸生成与编辑一直免费。
      </p>
      <p v-if="accountLoading" class="hint">正在刷新账号与权益…</p>
    </section>

    <!-- 账号与卡密兑换 + 我的订单：临时免费期间整块停用 -->
    <section v-if="!ALL_FREE" id="redeem" class="accountBox">
      <div class="accountBox__col">
        <h2 class="accountBox__title">账号与卡密兑换</h2>
        <CardRedeemPanel />
      </div>
      <div class="accountBox__col">
        <h2 class="accountBox__title">我的订单</h2>
        <template v-if="isLoggedIn">
          <div v-if="myOrders.length" class="orderList">
            <div v-for="o in myOrders" :key="o.id" class="orderRow">
              <div>
                <b>{{ o.plan_name }}</b>
                <div class="muted orderRow__no">{{ o.order_no }}</div>
              </div>
              <div class="orderRow__right">
                <span class="tag" :class="o.payment_status === 'paid' ? 'free' : 'warn'">{{ o.payment_status_text }}</span>
                <span class="muted">¥{{ Number(o.amount_due).toFixed(2) }}</span>
                <span class="tag" :class="o.fulfillment_status === 'issued' ? 'free' : ''">{{ o.fulfillment_status_text }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty" style="padding:22px 10px">
            <strong>还没有订单</strong>
            <p>在「会员与定价」里下单后，未接入在线支付时需要管理员确认到账才会发放卡密。</p>
          </div>
          <button class="btn btn-secondary sm" @click="refreshOrders">刷新订单</button>
        </template>
        <div v-else class="empty" style="padding:22px 10px">
          <strong>还没有本机身份</strong>
          <p>第一次兑换卡密或下单时会自动创建，不需要注册。订单与权益记录在服务端。</p>
        </div>
      </div>
    </section>

    <!-- 会员卡：临时免费期间换成免费开放说明 -->
    <section v-if="ALL_FREE" class="memberCard pro" data-audit="account-free">
      <div class="memberCard__left">
        <div class="memberCard__icon"><PixelIcon name="sparkles" :size="28" /></div>
        <div>
          <h2>全部功能免费开放</h2>
          <p class="muted" style="margin-top:5px">
            卡密与会员制暂时停用，所有已上线功能直接可用，不需要兑换或开通。
          </p>
        </div>
      </div>
      <div class="memberCard__right">
        <RouterLink to="/editor" class="btn primary">继续创作</RouterLink>
      </div>
    </section>

    <section v-else class="memberCard" :class="{ pro: isPro }">
      <div class="memberCard__left">
        <div class="memberCard__icon"><PixelIcon :name="isPro ? 'star' : 'palette'" :size="28" /></div>
        <div>
          <h2>{{ planLabel }}</h2>
          <p class="muted" style="margin-top:5px">
            <template v-if="isPro">
              <template v-if="expireAt">有效期至 {{ expireAt.toLocaleDateString() }}（还剩 {{ daysLeft }} 天）</template>
              <template v-else>永久有效（Founder / Early Bird）</template>
            </template>
            <template v-else>基础图片转换、基础编辑、免费素材、PNG 导出一直免费且不限次数</template>
          </p>
          <p v-if="startedAt" class="hint" style="margin-top:4px">开通于 {{ startedAt.toLocaleDateString() }}</p>
        </div>
      </div>
      <div class="memberCard__right">
        <RouterLink v-if="isPro" to="/editor" class="btn primary">继续创作</RouterLink>
      </div>
    </section>

    <!-- 数据 -->
    <div class="statRow">
      <div class="summaryCard">
        <span class="muted">我的作品</span>
        <b>{{ myStats.count }} / {{ projectLimit() }}</b>
        <span class="hint">其中已完成 {{ myStats.done }} 件 · {{ num(myStats.beadsDone) }} 颗豆</span>
      </div>
      <div class="summaryCard">
        <span class="muted">累计设计豆数</span>
        <b>{{ num(myStats.beads) }}</b>
        <span class="hint">最多一作用到 {{ myStats.maxColors }} 色</span>
      </div>
      <RouterLink to="/library?col=fav" class="summaryCard summaryCard--link" data-audit="account-favorites">
        <span class="muted">收藏素材</span>
        <b>{{ favorites.length }}</b>
        <span class="hint">素材库{{ ASSET_COUNT ? `共 ${ASSET_COUNT} 个` : '上新中' }} · 查看收藏 →</span>
      </RouterLink>
      <div class="summaryCard">
        <span class="muted">库存</span>
        <b>{{ inventorySummary.colors }} 色</b>
        <span class="hint">{{ num(inventorySummary.beads) }} 颗</span>
      </div>
    </div>

    <!-- 成长体系 -->
    <section class="secHead">
      <div>
        <h2>成长记录</h2>
        <p>完成的每一件作品都会累积，这些徽章会出现在分享卡上</p>
      </div>
    </section>
    <div class="card">
      <div class="card__body">
        <div class="badgeRow">
          <div v-for="b in badges" :key="b.name" class="badgeItem" :class="{ got: b.got }">
            <div class="badgeIcon"><PixelIcon :name="b.got ? b.icon : 'lock'" :size="26" /></div>
            <b>{{ b.name }}</b>
            <span class="hint">{{ b.desc || `完成 ${b.need} 个作品` }}</span>
          </div>
        </div>
        <p v-if="nextBadge" class="hint" style="margin-top:14px">
          下一个徽章：<b>{{ nextBadge.name }}</b> ——
          {{ nextBadge.desc || `再完成 ${Math.max(0, nextBadge.need - myStats.done)} 个作品` }}。
          去 <RouterLink to="/build" style="color:var(--coral-deep);font-weight:800">完成页</RouterLink>
          点「我拼完了 · 完成作品」就会记上一件（免费版也能用）。
        </p>
      </div>
    </div>

    <!-- Credits -->
    <section class="secHead">
      <div>
        <h2>AI Credits（未开放）</h2>
        <p>基础图片转换不消耗 Credits；只有服务端 AI 功能才计费</p>
      </div>
    </section>
    <div class="creditBox">
      <div>
        <b style="font-size:22px;letter-spacing:-.02em">{{ creditsBalance }} credits</b>
        <p class="hint" style="margin-top:5px">
          已使用 {{ usage.aiCalls || 0 }} 次 AI 调用 ·
          累计生成 {{ usage.generated || 0 }} 次图案 · 导出 {{ usage.exported || 0 }} 次
        </p>
      </div>
      <div class="row row--wrap">
        <span class="tag warn">AI 生图尚未接入，暂不售卖 Credits</span>
      </div>
    </div>
    <p class="hint" style="margin-top:8px">
      基础图片转拼豆完全在浏览器本地完成，不消耗 Credits。
      服务端 AI 功能接入并通过测试后，才会开放购买与计费。
    </p>

    <div v-if="credits.log && credits.log.length" class="tableWrap" style="margin-top:14px">
      <table class="table">
        <thead><tr><th>时间</th><th>说明</th><th class="num">Credits</th></tr></thead>
        <tbody>
          <tr v-for="(l, i) in credits.log.slice(0, 12)" :key="i">
            <td>{{ timeAgo(l.at) }}</td>
            <td>{{ l.note || 'AI 调用' }}</td>
            <td class="num" :style="l.cost > 0 ? 'color:var(--danger)' : 'color:var(--green)'">
              {{ l.cost > 0 ? '-' + l.cost : '+' + (-l.cost) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 入口 -->
    <section class="secHead">
      <div><h2>快捷入口</h2><p>你常用的几个地方</p></div>
    </section>
    <div class="quickGrid">
      <RouterLink to="/projects" class="quickItem">
        <b>我的作品</b><span class="hint">草稿、进度、导出</span>
      </RouterLink>
      <RouterLink to="/inventory" class="quickItem">
        <b>我的库存</b><span class="hint">只用我的豆</span>
      </RouterLink>
      <RouterLink to="/library" class="quickItem">
        <b>素材中心</b><span class="hint">{{ ASSET_COUNT ? `${ASSET_COUNT} 个原创素材` : '素材持续上新' }}</span>
      </RouterLink>
      <RouterLink to="/settings" class="quickItem">
        <b>设置</b><span class="hint">数据与隐私</span>
      </RouterLink>
    </div>

    <p v-if="ALL_FREE" class="hint" style="margin-top:26px">
      说明：作品、库存、收藏存在本机浏览器里。当前全部功能免费开放，不需要卡密或套餐；
      登录只用于绑定账号与恢复身份。
    </p>
    <p v-else class="hint" style="margin-top:26px">
      说明：作品、库存、收藏存在本机浏览器里。会员权益记录在服务端：
      第一次兑换卡密或下单时会自动创建本机匿名身份，清理浏览器数据或换设备后可能无法自动恢复，
      请保留卡密；权益丢失可以联系客服核验兑换记录。
    </p>
    <p class="hint" style="margin-top:8px">
      账号删除与数据导出：当前版本尚未提供自助入口，可联系客服人工处理（待办）。
    </p>

    <LoginDialog v-model="loginOpen" @success="loadAccountData" />
  </div>
</template>

<style scoped>
.pagehead__actions{display:flex;gap:9px;flex-wrap:wrap}
.authCard,.entCard{
  padding:20px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--line);
  box-shadow:var(--sh-1);margin-bottom:18px;
}
.authCard__head{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center}
.authWho{display:flex;align-items:center;gap:13px;min-width:0}
.authAvatar{width:46px;height:46px;border-radius:50%;object-fit:cover;border:1px solid var(--line);flex:0 0 auto}
.authAvatar--fallback{
  display:grid;place-items:center;background:var(--primary-soft);color:var(--primary-deep);
  font-weight:900;font-size:20px;
}
.authCard__head h2{font-size:var(--fs-h3)}
.authCard__actions{display:flex;gap:8px;flex-wrap:wrap}
.authMethods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}
.authMethod{
  display:flex;align-items:center;gap:11px;padding:12px;border-radius:var(--r-md);
  background:var(--surface-2);border:1px solid var(--line);
}
.authMethod__icon{
  width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;
  font-size:12px;font-weight:900;background:var(--surface-3);color:var(--ink-2);
}
.authMethod__icon--wechat{background:#07C160;color:#fff}
.authMethod__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.authMethod__body b{font-size:var(--fs-xs)}
.authMethod__body .hint{font-size:var(--fs-2xs)}
.authMethod__action{flex:0 0 auto}
.authNote{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8;margin-top:12px}
.entCard__head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start}
.entCard__actions{display:flex;gap:8px;flex-wrap:wrap}
.entGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}
.entItem{
  display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:var(--r-md);
  background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-xs);
}
.entItem b{font-size:var(--fs-sm)}
.entState.active{color:var(--green-deep)}
.entState.expired,.entState.disabled{color:var(--primary-deep)}
.entState.inactive{color:var(--muted)}
.entHint{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8;margin-top:10px}
.entHint.warn{color:var(--orange-deep)}
@media(max-width:900px){
  .authMethods{grid-template-columns:1fr}
  .entGrid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.accountBox{
  display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:22px;
}
.accountBox__col{
  padding:20px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--line);
  box-shadow:var(--sh-1);display:flex;flex-direction:column;gap:12px;
}
.accountBox__title{font-size:var(--fs-h3)}
.orderList{display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto}
.orderRow{
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);
  font-size:var(--fs-xs);
}
.orderRow__no{font-size:var(--fs-2xs);font-family:ui-monospace,Menlo,Consolas,monospace;margin-top:2px}
.orderRow__right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
@media(max-width:900px){.accountBox{grid-template-columns:1fr}}

.memberCard{
  display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;
  padding:22px;border-radius:var(--r-xl);background:var(--surface);border:1px solid var(--line);
  box-shadow:var(--sh-1);
}
.memberCard.pro{background:linear-gradient(140deg,var(--yellow-soft),var(--surface-warm),var(--primary-soft));border-color:#F0E3B4}
.memberCard__left{display:flex;align-items:center;gap:16px}
.memberCard__icon{
  width:56px;height:56px;border-radius:var(--r-lg);display:grid;place-items:center;font-size:26px;
  background:rgba(255,255,255,.7);border:1px solid var(--line);
}
.memberCard__left h2{font-size:var(--fs-h2)}
.memberCard__right{display:flex;gap:9px;flex-wrap:wrap}
.statRow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-top:18px}
.summaryCard{
  padding:15px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line);
  display:flex;flex-direction:column;gap:4px;box-shadow:var(--sh-1);
}
.summaryCard b{font-size:20px;font-weight:850;letter-spacing:-.02em}
.summaryCard--link{transition:var(--t);cursor:pointer}
.summaryCard--link:hover{border-color:var(--primary-deep);transform:translateY(-2px);box-shadow:var(--sh-2)}
.summaryCard--link .hint{color:var(--yellow-deep);font-weight:700}
.badgeRow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.badgeItem{
  text-align:center;padding:16px 10px;border-radius:var(--r-md);border:1px dashed var(--line-strong);
  background:var(--surface-2);opacity:.72;transition:var(--t);
}
.badgeItem.got{border-style:solid;border-color:#F0E3B4;background:linear-gradient(160deg,var(--yellow-soft),var(--surface));opacity:1}
.badgeIcon{font-size:26px;margin-bottom:8px}
.badgeItem b{display:block;font-size:var(--fs-xs);margin-bottom:3px}
.creditBox{
  display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding:17px;border-radius:var(--r-lg);background:var(--surface-2);border:1.5px dashed var(--line-strong);
}
.quickGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}
.quickItem{
  display:flex;flex-direction:column;gap:4px;padding:17px;border-radius:var(--r-md);
  background:var(--surface);border:1px solid var(--line);transition:var(--t);
}
.quickItem:hover{border-color:var(--primary);transform:translateY(-2px);box-shadow:var(--sh-1)}
.quickItem b{font-size:var(--fs-sm)}
@media(max-width:900px){
  .statRow,.badgeRow,.quickGrid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
</style>
