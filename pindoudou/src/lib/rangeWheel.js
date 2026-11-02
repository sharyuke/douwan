/**
 * 让 <input type="range"> 响应鼠标滚轮。
 *
 * 为什么需要：Chrome / Edge 默认**不**响应滑块上的滚轮（Firefox 会），
 * 电脑端用户在「画布与成品尺寸」那条滑杆上滚滚轮想改尺寸时数值纹丝不动，
 * 看起来像功能坏了 —— 滑杆两端还有 − / ＋ 按钮，滚轮却完全没反应。
 * 这里把滚轮补上，行为跟滑杆两端的小按钮一致。
 *
 * 口径：
 *   · 向上滚变大、向下滚变小；
 *   · 一格滚轮走「量程的 1/20」（下限是滑块自己的 step）：
 *     量程 8~52 走 2 格，8~1000 走 50 格 —— 一次滚到位，不用狂滚几百下；
 *   · 按住 Shift 走最小步长（要一格一格抠的时候用）；
 *   · 改完派发 input / change：滑块自己绑定的逻辑照常走
 *     （尺寸重算、提示文案、留白收敛都在那边，这里不重复实现一遍）。
 *
 * 页面不许跟着一起滚：滚轮落在滑块上就吃掉默认行为。
 */

/**
 * @param {WheelEvent} e 绑在滑块上的 wheel 事件
 * @param {{ coarse?: number }} [opts] coarse 指定一格滚轮走多少（默认按量程算）
 */
export function onRangeWheel(e, opts = {}) {
  const el = e.currentTarget
  if (!el || el.disabled || !e.deltaY) return
  /* 滑块自己不会吃掉滚轮，不拦的话整页会跟着滚 */
  e.preventDefault()
  const min = Number(el.min)
  const max = Number(el.max)
  const step = Number(el.step) || 1
  const span = Math.max(0, max - min)
  const coarse = opts.coarse ?? Math.max(step, Math.round(span / 20))
  const delta = e.shiftKey ? step : coarse
  const dir = e.deltaY < 0 ? 1 : -1
  const cur = Number(el.value)
  const next = Math.min(max, Math.max(min, cur + dir * delta))
  if (!Number.isFinite(next) || next === cur) return
  /* 浏览器会按 step 把值吸附到合法档位，读取时用的是吸附后的值 */
  el.value = String(next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
