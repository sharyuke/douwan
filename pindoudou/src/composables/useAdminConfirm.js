/* =========================================================================
   全局二次确认弹窗
   高风险操作（删除、作废、确认收款、发卡、导出）统一走这里，
   保证每一个都有明确的「确认动作名 + 影响说明」，危险操作还要求填原因。
   用法：
     const ok = await confirmAction({ title, message, danger: true, reasonRequired: true })
     if (!ok) return
     // ok.reason 里有填写的备注
   ========================================================================= */

import { reactive } from 'vue'

export const confirmState = reactive({
  open: false,
  title: '请确认',
  message: '',
  detail: '',        // 补充说明（例如影响范围）
  confirmText: '确认',
  cancelText: '取消',
  danger: false,
  /** 是否需要填写原因 / 备注 */
  reasonRequired: false,
  reasonLabel: '操作原因',
  reasonHint: '',
  reasonPlaceholder: '请填写原因，会记录到操作日志里',
  /** 需要用户手动勾选才能真正确认的情况（极危险操作） */
  ackText: '',
  ack: false,
  loading: false
})

let resolver = null

/**
 * 打开确认弹窗，返回 Promise。
 * @returns {Promise<false|{reason:string}>} 取消返回 false，确认返回 { reason }
 */
export function confirmAction(options = {}) {
  Object.assign(confirmState, {
    open: true,
    title: options.title || '请确认',
    message: options.message || '',
    detail: options.detail || '',
    confirmText: options.confirmText || '确认',
    cancelText: options.cancelText || '取消',
    danger: !!options.danger,
    reasonRequired: !!options.reasonRequired,
    reasonLabel: options.reasonLabel || '操作原因',
    reasonHint: options.reasonHint || '',
    reasonPlaceholder: options.reasonPlaceholder || '请填写原因，会记录到操作日志里',
    ackText: options.ackText || '',
    ack: false,
    loading: false
  })
  return new Promise(resolve => {
    resolver = resolve
  })
}

/** 由 ConfirmHost 调用 */
export function resolveConfirm(result) {
  const fn = resolver
  resolver = null
  confirmState.open = false
  if (fn) fn(result)
}

/** 关闭并返回取消 */
export function cancelConfirm() {
  resolveConfirm(false)
}
