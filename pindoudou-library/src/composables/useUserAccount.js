/* =========================================================================
   前台用户账号（与服务端 douwan-api 的账号体系对接）
   - 需求 §3.4：前台不要求注册登录。首次兑换卡密 / 下单时自动创建一个
     「本机匿名身份」，用户不需要填用户名密码。
   - 匿名身份保存在这台浏览器里；清理浏览器数据或换设备后可能无法自动恢复，
     所以界面上必须写清恢复边界（保留卡密 / 联系客服核验）。
   - 也保留手动登录：老用户或想换设备的用户仍然可以登录已有账号。
   - 登录态与后台完全隔离：这里用 userTokens，后台用 adminTokens
   ========================================================================= */

import { computed, ref } from 'vue'
import { ApiError, api, userTokens } from '../lib/api.js'
import { resetEntitlements } from './useMembership.js'

/** 当前登录用户（null = 未登录） */
export const currentUser = ref(null)
export const authLoading = ref(false)
export const authError = ref('')

export const isLoggedIn = computed(() => !!currentUser.value)

export const displayName = computed(() => {
  if (!currentUser.value) return ''
  return currentUser.value.nickname || currentUser.value.username
})

let bootstrapPromise = null

/** 页面加载时用本地令牌换回用户资料 */
export function bootstrapUser(force = false) {
  if (!force && bootstrapPromise) return bootstrapPromise
  if (!userTokens.access && !userTokens.refresh) {
    currentUser.value = null
    return Promise.resolve(null)
  }
  authLoading.value = true
  bootstrapPromise = (async () => {
    try {
      const me = await api.get('/users/me')
      /* `/users/me` 同时返回第三方身份与「是否设置过密码」。
         合并进 currentUser，账号页不必再发一次同样的请求；
         身份列表是账号与安全区块的数据来源。 */
      currentUser.value = {
        ...me.user,
        identities: Array.isArray(me.identities) ? me.identities : [],
        has_password: !!me.has_password
      }
      authError.value = ''
      return currentUser.value
    } catch (e) {
      if (e instanceof ApiError && e.needLogin) {
        userTokens.clear()
        currentUser.value = null
        resetEntitlements()
      } else {
        authError.value = e instanceof ApiError ? e.message : '无法连接服务端'
      }
      return null
    } finally {
      authLoading.value = false
    }
  })()
  return bootstrapPromise
}

/* ------------------------------------------------------------------ 本机匿名身份 */

const DEVICE_KEY = 'douzao-device-account'

function randomAlnum(n) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  const buf = new Uint8Array(n)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf)
  else for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256)
  return Array.from(buf, b => chars[b % chars.length]).join('')
}

function readDeviceCredential() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    return v && v.username && v.password ? v : null
  } catch {
    return null
  }
}

function writeDeviceCredential(value) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(value))
  } catch {
    /* 隐私模式忽略：下次仍需重新创建身份 */
  }
}

function clearDeviceCredential() {
  try {
    localStorage.removeItem(DEVICE_KEY)
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 当前账号是否是自动创建的本机匿名身份 */
export const isAnonymousDevice = computed(() => {
  const u = currentUser.value
  return !!u && String(u.nickname || '') === '本机访客'
})

/**
 * 确保当前浏览器有一个可用的服务端身份。
 *
 * - 已经登录：直接返回；
 * - 本地存过匿名身份：先尝试登录；
 * - 都没有：自动注册一个随机用户名 + 随机密码的匿名账号，昵称「本机访客」。
 *
 * 用户名只用字母数字，满足服务端 3~32 位 alphanum 的约束；密码 24 位随机串。
 * 账号密码只存在这台浏览器的 localStorage 里，用来在刷新后恢复同一个身份。
 */
export async function ensureDeviceAccount() {
  if (isLoggedIn.value) return { ok: true, user: currentUser.value, created: false }

  const saved = readDeviceCredential()
  if (saved) {
    const res = await login({ account: saved.username, password: saved.password })
    if (res.ok) return { ok: true, user: currentUser.value, created: false }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const username = 'dw' + randomAlnum(10)
    const password = randomAlnum(24)
    const res = await register({ username, password, nickname: '本机访客' })
    if (res.ok) {
      writeDeviceCredential({ username, password })
      return { ok: true, user: currentUser.value, created: true }
    }
  }
  return { ok: false, message: '创建本机身份失败，请稍后重试或联系客服' }
}

/**
 * 页面加载时恢复身份：先看令牌，再看本地匿名身份。
 * 不主动创建新账号 —— 只是浏览免费功能的访客不应该被写入用户表。
 */
export async function bootstrapDevice() {
  const user = await bootstrapUser()
  if (user) return user
  const saved = readDeviceCredential()
  if (!saved) return null
  const res = await login({ account: saved.username, password: saved.password })
  return res.ok ? currentUser.value : null
}

/** 注册并直接登录 */
export async function register({ username, password, nickname }) {
  authLoading.value = true
  authError.value = ''
  try {
    const result = await api.post('/auth/register', { username, password, nickname }, { auth: false })
    userTokens.write(result.tokens)
    currentUser.value = result.user
    /* 登录到真实账号后，不要再让本机匿名身份在下次刷新时自动顶回来。 */
    if (String(result.user.nickname || '') !== '本机访客') clearDeviceCredential()
    return { ok: true }
  } catch (e) {
    authError.value = e instanceof ApiError ? e.message : '注册失败，请稍后重试'
    return { ok: false, message: authError.value }
  } finally {
    authLoading.value = false
  }
}

/** 登录 */
export async function login({ account, password }) {
  authLoading.value = true
  authError.value = ''
  try {
    const result = await api.post('/auth/login', { account, password }, { auth: false })
    userTokens.write(result.tokens)
    currentUser.value = result.user
    /* 登录到真实账号后，不要再让本机匿名身份在下次刷新时自动顶回来。 */
    if (String(result.user.nickname || '') !== '本机访客') clearDeviceCredential()
    return { ok: true }
  } catch (e) {
    authError.value = e instanceof ApiError ? e.message : '登录失败，请稍后重试'
    return { ok: false, message: authError.value }
  } finally {
    authLoading.value = false
  }
}

/** 退出登录 */
export async function logout() {
  const wasAnonymous = isAnonymousDevice.value
  const refresh = userTokens.refresh
  try {
    if (refresh) await api.post('/auth/logout', { refresh_token: refresh }, { auth: false })
  } catch {
    // 接口失败也要清本地状态，避免点退出没反应
  }
  userTokens.clear()
  currentUser.value = null
  bootstrapPromise = null
  /* 从真实账号退出时清掉遗留的本机匿名凭据，否则下次刷新会自动登录回匿名账号。
     匿名身份本身不提供退出入口（见 CardRedeemPanel），这里只兜住切换账号的场景。 */
  if (!wasAnonymous) clearDeviceCredential()
  resetEntitlements()
}

/**
 * 确保已登录：未登录时抛出带 needLogin 标记的错误，
 * 调用方据此弹出登录引导而不是静默失败。
 */
export function requireLogin() {
  if (!isLoggedIn.value) {
    return { ok: false, needLogin: true, message: '请先登录后在操作（权益需要绑定到账号）' }
  }
  return { ok: true }
}

/** 更新昵称 / 头像 */
export async function updateProfile(patch) {
  try {
    const profile = await api.patch('/users/me', patch)
    currentUser.value = profile
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : '保存失败' }
  }
}
