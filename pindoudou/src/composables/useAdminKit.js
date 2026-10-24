/* =========================================================================
   后台通用小工具：状态标签映射、校验、剪贴板等
   - 状态码的中文与颜色集中在这里，避免每个页面各写一套、说法不一致
   ========================================================================= */

import { toastOk, toastErr } from './useToast.js'
import { ApiError } from '../lib/api.js'

/** 套餐状态 → 展示信息 */
export function planStatus(status) {
  return {
    draft: { text: '草稿', kind: 'muted', hint: '前台不可见，也不能下单' },
    published: { text: '已上架', kind: 'ok', hint: '前台可见可购买' },
    archived: { text: '已下架', kind: 'warn', hint: '前台不可见，历史订单不受影响' }
  }[status] || { text: status || '—', kind: 'muted', hint: '' }
}

/** 卡密状态 → 展示信息 */
export function cardStatus(status) {
  return {
    unused: { text: '未使用', kind: 'ok', hint: '可供发放或兑换' },
    redeemed: { text: '已兑换', kind: 'info', hint: '已被用户兑换，不能再次兑换' },
    expired: { text: '已过期', kind: 'warn', hint: '超过兑换截止时间' },
    voided: { text: '已作废', kind: 'danger', hint: '管理员手动作废' }
  }[status] || { text: status || '—', kind: 'muted', hint: '' }
}

/** 支付状态 → 展示信息 */
export function paymentStatus(status) {
  return {
    pending: { text: '待支付', kind: 'warn' },
    paid: { text: '已支付', kind: 'ok' },
    closed: { text: '已关闭', kind: 'muted' },
    refunding: { text: '退款处理中', kind: 'warn' },
    refunded: { text: '已退款', kind: 'danger' }
  }[status] || { text: status || '—', kind: 'muted' }
}

/** 发卡状态 → 展示信息 */
export function fulfillmentStatus(status) {
  return {
    pending: { text: '未发放', kind: 'warn' },
    issued: { text: '已发放', kind: 'ok' },
    failed: { text: '发放失败待处理', kind: 'danger' },
    canceled: { text: '无需发放', kind: 'muted' }
  }[status] || { text: status || '—', kind: 'muted' }
}

/** 素材状态 */
export function assetStatus(status) {
  return {
    draft: { text: '草稿', kind: 'muted' },
    published: { text: '已发布', kind: 'ok' },
    archived: { text: '已下架', kind: 'warn' }
  }[status] || { text: status || '—', kind: 'muted' }
}

/** 权益状态 */
export function entitlementStatus(status) {
  return {
    active: { text: '生效中', kind: 'ok' },
    expired: { text: '已过期', kind: 'muted' },
    revoked: { text: '已撤销', kind: 'danger' },
    used_up: { text: '额度已用完', kind: 'warn' }
  }[status] || { text: status || '—', kind: 'muted' }
}

/** 权益来源 */
export function entitlementSource(source) {
  return {
    card_key: '卡密兑换',
    order: '订单发放',
    admin_grant: '管理员发放'
  }[source] || source
}

/** 权益类型 */
export function benefitKind(kind) {
  return {
    unlimited: '不限量',
    quota: '次数 / 额度',
    count: '图纸张数'
  }[kind] || kind
}

/** 有效期类型 */
export function validityType(type) {
  return {
    none: '不设时长',
    hour: '按小时',
    day: '按天',
    month: '按月'
  }[type] || type
}

/** 角色 */
export function roleKind(role) {
  return {
    super_admin: 'primary',
    operator: 'info',
    viewer: 'muted'
  }[role] || 'muted'
}

/** 日志结果 */
export function logResultKind(result) {
  return result === 'fail' ? 'danger' : 'ok'
}

/* ------------------------------------------------------------------ 通用动作 */

/**
 * 统一的「执行 → 提示 → 回调」包装。
 * 所有后台动作都走它，保证错误提示与成功提示的口径一致。
 *
 * @param {Function} fn 返回 Promise 的动作
 * @param {object} [opts]
 * @param {string} [opts.ok]   成功提示
 * @param {Function} [opts.onError] 额外错误处理（例如权限不足时给升级提示）
 * @param {Function} [opts.finally] 无论成败都执行（关弹窗、刷新列表）
 * @returns {Promise<any|null>} 成功返回结果，失败返回 null
 */
export async function run(fn, opts = {}) {
  const { ok, onError, finally: done } = opts
  try {
    const result = await fn()
    if (ok) toastOk(ok)
    return result
  } catch (e) {
    const message = e instanceof ApiError ? e.message : (e && e.message) || '操作失败'
    toastErr(message)
    if (onError) onError(e)
    return null
  } finally {
    if (done) done()
  }
}

/** 复制文本到剪贴板。返回是否成功。 */
export async function copyText(text) {
  const value = String(text ?? '')
  if (!value) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
    // 非 HTTPS 环境的兜底实现
    const el = document.createElement('textarea')
    el.value = value
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

/** 复制并提示。 */
export async function copyWithToast(text, okText = '已复制') {
  const ok = await copyText(text)
  if (ok) toastOk(okText)
  else toastErr('复制失败，请手动选择文本复制')
  return ok
}

/* ------------------------------------------------------------------ 表单校验 */

/** 简单必填校验，返回错误信息数组（空数组表示通过） */
export function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return [`${label}不能为空`]
  }
  return []
}

/** 正整数校验 */
export function positiveInt(value, label, { min = 1, max = 0 } = {}) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) return [`${label}必须是不小于 ${min} 的整数`]
  if (max > 0 && n > max) return [`${label}不能大于 ${max}`]
  return []
}

/** 金额校验（允许两位小数） */
export function priceValue(value, label, { allowZero = true } = {}) {
  const n = Number(value)
  if (Number.isNaN(n)) return [`${label}必须是数字`]
  if (n < 0) return [`${label}不能为负数`]
  if (!allowZero && n === 0) return [`${label}必须大于 0`]
  if (Math.round(n * 100) !== Number((n * 100).toFixed(0))) {
    return [`${label}最多保留两位小数`]
  }
  return []
}

/* ------------------------------------------------------------------ 其它 */

/** 把日期字符串（YYYY-MM-DD）转成当天开始的 RFC3339（本地时区） */
export function dayStart(value) {
  if (!value) return ''
  const d = new Date(value + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** 今天 / N 天前的 YYYY-MM-DD，用于筛选默认值 */
export function dayBefore(days = 0) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 把「一份订单要发几张卡密」等数字字段安全转成整数 */
export function toInt(value, fallback = 0) {
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? fallback : n
}

/** 深拷贝（表单编辑时避免直接改列表里的对象） */
export function clone(value) {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value))
}

/** 拼接查询参数字符串，用于「查看全部」这类跳转 */
export function withQuery(path, query) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue
    params.set(k, v)
  }
  const s = params.toString()
  return s ? `${path}?${s}` : path
}
