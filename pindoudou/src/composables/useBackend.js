/* =========================================================================
   前台与后端的衔接（需求 §1.2 第 9 条 / §17 第 5~6 步）
   - 套餐与素材读服务端：价格、权益、素材内容都由后台配置，前台不写死
   - 未登录 / 接口不可用时回落到本地演示数据，保证前台不会被后台拖挂
   - 卡密兑换与订单走后端，权益落到服务端（不再只存在 localStorage）
   ========================================================================= */

import { computed, ref } from 'vue'
import { ApiError, api, userTokens } from '../lib/api.js'
import { publicApi } from '../lib/adminApi.js'
import {
  applyServerMembership, applyServerPermissions, applyServerCredits
} from './useMembership.js'
import { ensureDeviceAccount } from './useUserAccount.js'

/** 兼容旧引用：userTokens 从 api.js 导出 */
export { userTokens }

/** 服务端是否可用（第一次探测失败后不再反复重试，避免每个页面都卡一下） */
export const backendReady = ref(false)
export const backendChecked = ref(false)
export const backendError = ref('')

/** 服务端返回的套餐（已上架） */
export const serverPlans = ref([])
/** 服务端返回的公开设置 */
export const siteSettings = ref(null)

let probePromise = null

/**
 * 探测后端是否可用，并顺带取回套餐与公开设置。
 * 只用一次请求做探测，后续复用同一个 Promise。
 */
export function ensureBackend() {
  if (backendChecked.value) return probePromise || Promise.resolve(backendReady.value)
  if (probePromise) return probePromise

  probePromise = (async () => {
    try {
      const [plans, settings] = await Promise.all([
        publicApi.plans(),
        publicApi.settings()
      ])
      serverPlans.value = Array.isArray(plans) ? plans : []
      siteSettings.value = settings || null
      backendReady.value = true
      backendError.value = ''
    } catch (e) {
      backendReady.value = false
      backendError.value = e instanceof ApiError ? e.message : '无法连接服务端'
      serverPlans.value = []
      siteSettings.value = null
    } finally {
      backendChecked.value = true
    }
    return backendReady.value
  })()
  return probePromise
}

/** 强制重新探测（用户手动重试时用） */
export function recheckBackend() {
  backendChecked.value = false
  backendError.value = ''
  probePromise = null
  return ensureBackend()
}

/* ------------------------------------------------------------------ 服务端权益同步 */

/**
 * 把服务端的会员状态、权限矩阵与 Credits 同步到前台。
 *
 * 必须在应用启动、登录、兑换卡密、下单后调用。权益的权威来源是服务端；
 * 前台只在同步成功后才把收费功能标为可用（见 useMembership.isPro）。
 */
export async function syncServerEntitlements() {
  if (!userTokens.access) return null
  try {
    const [me, perms] = await Promise.all([
      api.get('/users/me'),
      api.get('/permissions', { auth: true }).catch(() => null)
    ])
    /* 权益的权威来源是 entitlements 表。`/users/me` 里的 membership 是旧的订阅字段，
       卡密发放不会写它，所以这里优先按「当前有效的权益记录」判断是否 Pro。
       注意：有权益记录不等于真的解锁 —— 草稿套餐可能一条权限都没配。
       以权益快照里的 permissions 为准；快照缺失时再看服务端返回的权限矩阵。 */
    const active = ((perms && perms.entitlements) || [])
      .filter(e => e && e.effective_status === 'active')
    /* 只有快照里真的配了权益的记录才算「已授权」。没配权益的草稿套餐
       既不能解锁功能，也不该影响到期时间的计算（否则一条永久草稿记录
       会把旁边的正式卡密也算成永久）。 */
    const granting = active.filter(e => {
      const p = e && e.plan_snapshot && e.plan_snapshot.permissions
      return p && typeof p === 'object' && Object.keys(p).length > 0
    })
    const grants = granting.length > 0
    const matrix = (perms && perms.permissions) || {}
    const matrixPro = matrix['export.pdf'] === true ||
      matrix['export.svg'] === true ||
      matrix['build.mode'] === true ||
      matrix['palette.full'] === true ||
      Number(matrix['canvas.cells']) > 52
    const isPro = grants || matrixPro || !!(me.membership && me.membership.is_pro)
    /* 只要有一条「真的授权」的权益没有到期时间，就按「不限时长」处理；
       否则取最晚的到期时间。没配权益的记录不参与，避免把免费草稿算成永久 Pro。 */
    const hasLifetime = granting.some(e => !e.expires_at)
    const expireAt = hasLifetime
      ? null
      : (granting.length
        ? granting.map(e => e.expires_at).filter(Boolean).sort().pop() || null
        : (me.membership && me.membership.expire_at) || null)
    applyServerMembership({
      plan: isPro ? 'pro' : 'free',
      is_pro: isPro,
      expire_at: expireAt
    })
    if (me.credits) applyServerCredits(me.credits.balance)
    if (perms && perms.permissions) applyServerPermissions(perms.permissions)
    return me
  } catch {
    /* 同步失败时保持未验证状态：收费功能按未解锁处理，免费功能不受影响 */
    return null
  }
}

/* ------------------------------------------------------------------ 卡密兑换 */

/** 兑换结果（成功后展示给用户看） */
export const redeemResult = ref(null)

export function canRedeem() {
  // 已登录，或服务端可用（此时可以自动创建本机匿名身份）
  return !!userTokens.access || backendReady.value
}

/**
 * 兑换卡密。返回 { ok, message, result }。
 *
 * 需求 §3.4：前台不要求注册登录。没有身份时先自动创建一个本机匿名身份，
 * 再把卡密绑定到它；权益记录仍然在服务端，不依赖 localStorage。
 * 错误用中文说明原因，不泄漏多余信息（服务端已经把文案写好了）。
 */
export async function redeemCard(code) {
  const trimmed = String(code || '').trim()
  if (!trimmed) return { ok: false, message: '请输入卡密' }
  if (!userTokens.access) {
    const identity = await ensureDeviceAccount()
    if (!identity.ok) return { ok: false, message: identity.message || '无法创建本机身份' }
  }
  try {
    const result = await api.post('/card-keys/redeem', { code: trimmed })
    redeemResult.value = result
    return { ok: true, message: result.message || '兑换成功', result }
  } catch (e) {
    if (e instanceof ApiError) {
      return { ok: false, message: e.message, needLogin: e.needLogin, code: e.code }
    }
    return { ok: false, message: '兑换失败，请稍后重试' }
  }
}

/* ------------------------------------------------------------------ 我的订单 */

export const myOrders = ref([])
export const myOrdersLoading = ref(false)

export async function loadMyOrders() {
  if (!userTokens.access) {
    myOrders.value = []
    return []
  }
  myOrdersLoading.value = true
  try {
    const data = await api.get('/orders', { query: { page_size: 50 } })
    myOrders.value = (data && data.list) || []
    return myOrders.value
  } catch (e) {
    myOrders.value = []
    return []
  } finally {
    myOrdersLoading.value = false
  }
}

/** 下单（未接入支付时订单会停留在「待支付」，由管理员人工确认收款） */
export async function createOrder(planId, quantity = 1) {
  return api.post('/orders', { plan_id: planId, quantity })
}

/* ------------------------------------------------------------------ 素材库衔接 */

/** 服务端已发布的素材（分页） */
export const serverAssets = ref([])
export const serverAssetTotal = ref(0)
export const serverAssetLoading = ref(false)
export const serverCategories = ref([])

/**
 * 拉取服务端素材。失败时返回空数组并标记 backendReady=false，
 * 由页面回落到内置素材，保证前台素材中心不会白屏。
 */
export async function loadServerAssets(query = {}) {
  serverAssetLoading.value = true
  try {
    const data = await publicApi.assets({ page_size: 60, ...query })
    serverAssets.value = (data && data.list) || []
    serverAssetTotal.value = (data && data.total) || 0
    backendReady.value = true
    return serverAssets.value
  } catch {
    serverAssets.value = []
    serverAssetTotal.value = 0
    return []
  } finally {
    serverAssetLoading.value = false
  }
}

export async function loadServerCategories() {
  try {
    const data = await publicApi.assetCategories()
    serverCategories.value = Array.isArray(data) ? data : []
    return serverCategories.value
  } catch {
    serverCategories.value = []
    return []
  }
}

/** 服务端素材 → 前台卡片需要的形状（尽量贴近内置 ASSETS 的字段名） */
export function toFrontAsset(a) {
  return {
    id: a.slug,
    serverId: a.id,
    name: a.title,
    cat: a.category_name || '未分类',
    tier: a.tier === 'pro' ? 'pro' : 'free',
    cols: a.tags || [],
    hot: a.is_featured ? 100 : 0,
    feat: !!a.is_featured,
    isNew: false,
    image: a.image_url,
    thumb: a.thumbnail_url || a.image_url,
    description: a.description || '',
    fromServer: true,
    slug: a.slug
  }
}

export const serverAssetCount = computed(() => serverAssetTotal.value)
