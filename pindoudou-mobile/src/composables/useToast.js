/* =========================================================================
   Toast 轻提示：统一反馈通道，避免到处用 alert 打断操作
   ========================================================================= */

import { ref } from 'vue'

export const toasts = ref([])
let seq = 0

export function toast(text, kind = '', ms = 2600) {
  const id = ++seq
  toasts.value = [...toasts.value, { id, text, kind }]
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, ms)
  return id
}

export function toastOk(text) { return toast(text, 'ok') }
export function toastWarn(text) { return toast(text, 'warn') }
export function toastErr(text) { return toast(text, 'err', 3800) }

/**
 * 把导出函数回传的 `{ ok, message }` 直接变成一句提示。
 *
 * 为什么要有这个统一入口：精细档画布下导出会降规格、丢色号、甚至拒绝
 * （PNG 受边长/像素上限、SVG 受体积线、PDF 受页数上限，见 lib/exporters.js），
 * 这些理由都写在回传的 message 里。而导出入口散在四个页面（工作台、作品列表、
 * 材料页、拼制页），每处各写一遍「ok=false → 报错、有 message → 长提示」，
 * 迟早漏一处 —— 漏掉的那处就是「点了没反应，界面还说成功」。
 */
export function toastResult(res, fallback = '已开始导出') {
  if (res && res.ok === false) return toastErr(res.message || '这次导出没有完成')
  if (res && res.message) return toast(res.message, 'ok', 6000)
  return toastOk(fallback)
}
