/* =========================================================================
   后台登录状态与权限（PRD 后台需求 §3）
   - 登录态存 localStorage（页面刷新不掉），令牌过期由 api.js 自动刷新
   - 权限判定：前端只用它决定按钮是否可点，服务端才是真正的权限边界。
     所以这里不做「隐藏按钮」式的权限控制，而是给出「为什么不能点」。
   ========================================================================= */

import { computed, ref } from 'vue'
import { adminTokens, ApiError } from '../lib/api.js'
import { authApi } from '../lib/adminApi.js'

/** 当前管理员资料（null 表示未登录） */
export const admin = ref(null)
/** 权限点清单 */
export const permissions = ref([])
/** 是否正在做首次加载（用于路由守卫等待） */
export const bootstrapping = ref(false)
/** 上一次加载失败的原因（网络问题时提示用） */
export const loadError = ref('')

let bootstrapPromise = null

export const isLoggedIn = computed(() => !!admin.value)

export const isSuper = computed(() => !!admin.value && admin.value.role === 'super_admin')

export const roleLabel = computed(() => (admin.value ? admin.value.role_label : ''))

/** 是否拥有某个权限点 */
export function can(perm) {
  return permissions.value.includes(perm)
}

/**
 * 权限被拒时的中文原因。用于按钮 tooltip 与点击提示，
 * 而不是把按钮藏起来（后台需求 §3.3：服务端验证权限）。
 */
export function denyReason(perm) {
  const labels = {
    'plan.manage': '套餐管理',
    'card.view': '查看卡密',
    'card.reveal': '查看卡密明文',
    'card.generate': '生成卡密',
    'card.export': '导出卡密',
    'card.revoke': '作废卡密',
    'order.view': '查看订单',
    'order.settle': '确认收款与发卡',
    'order.refund': '退款处理',
    'asset.view': '查看素材',
    'asset.manage': '素材管理',
    'user.view': '查看用户',
    'entitlement.view': '查看兑换记录',
    'entitlement.grant': '发放权益',
    'setting.view': '查看系统设置',
    'setting.manage': '修改系统设置',
    'admin.manage': '管理员管理',
    'log.view': '查看操作日志',
    'overview.view': '查看数据概览',
    'activity.view': '查看用户活跃监控'
  }
  const name = labels[perm] || perm
  if (!isLoggedIn.value) return '请先登录后台'
  return `当前角色（${roleLabel.value}）没有「${name}」权限，请联系超级管理员调整`
}

/* ------------------------------------------------------------------ 登录 / 退出 */

export async function login(account, password) {
  const result = await authApi.login(account, password)
  adminTokens.write(result.tokens)
  admin.value = result.admin
  permissions.value = result.admin.permissions || []
  loadError.value = ''
  return result.admin
}

export async function logout() {
  const refresh = adminTokens.refresh
  try {
    if (refresh) await authApi.logout(refresh)
  } catch {
    // 退出接口失败也要清掉本地登录态，否则用户卡在「点退出没反应」
  }
  clearAuth()
}

/** 清掉本地登录态（令牌失效时也走这里） */
export function clearAuth() {
  adminTokens.clear()
  admin.value = null
  permissions.value = []
  bootstrapPromise = null
}

/* ------------------------------------------------------------------ 启动恢复 */

/**
 * 用本地令牌换回管理员资料。
 * 页面刷新后调用一次；失败则视为未登录（不弹错误，交给路由守卫跳登录页）。
 */
export function bootstrap(force = false) {
  if (!force && bootstrapPromise) return bootstrapPromise
  if (!adminTokens.access && !adminTokens.refresh) {
    admin.value = null
    permissions.value = []
    return Promise.resolve(null)
  }

  bootstrapping.value = true
  bootstrapPromise = (async () => {
    try {
      const me = await authApi.me()
      admin.value = me
      permissions.value = me.permissions || []
      loadError.value = ''
      return me
    } catch (e) {
      if (e instanceof ApiError && (e.needLogin || e.forbidden)) {
        // 令牌过期或账号被停用：清掉本地状态，让守卫去登录页
        clearAuth()
      } else {
        loadError.value = e && e.message ? e.message : '无法连接服务端'
      }
      return null
    } finally {
      bootstrapping.value = false
    }
  })()
  return bootstrapPromise
}

/** 改密码后建议重新登录：这里只清登录态，由调用方跳转 */
export function forgetAfterPasswordChange() {
  clearAuth()
}
