import { ref } from 'vue'

/* ---------------------------------------------------------------- 快捷键浮动标签
   鼠标停在工具按钮上时，在旁边浮出一张小标签：工具名 + 一句说明 + 快捷键标注。
   只在电脑端出现（手机没有鼠标，也没有物理键盘）。

   停住约 2.5 秒后渐隐，鼠标还停在同一颗按钮上也不会再弹出来；
   移开再回来，或换到另一颗按钮，才重新显示。

   画笔 / 橡皮 / 换色的下拉菜单贴在工具轨右缘外侧。标签若也贴在那里，
   会盖住菜单，所以这三颗工具的标签再往右让出菜单的宽度。

   标签用 fixed 定位：工具轨是 overflow:auto 的滚动容器，
   绝对定位的标签跑到轨外会被裁掉（选色面板踩过一次同样的坑）。
   状态放在模块级：全屏工作台的工具轨（EditorView）与旧版面的工具行
   （EditorCanvas）共用同一份，谁悬停都写到同一个标签上。 */
const tip = ref({ on: false, fading: false, title: '', desc: '', key: '', left: 0, top: 0 })

/* 标签最大宽度（与 ShortcutTip.vue 里的 max-width 一致），用来把它夹在视口里 */
const TIP_MAX_W = 248
/* 下拉菜单贴在轨外 8px，换色菜单宽 176，是这几张菜单里最宽的 */
const MENU_RESERVE = 8 + 176
const SHOW_MS = 2500
const FADE_MS = 450

let dwellEl = null
let showTimer = 0
let fadeTimer = 0

function clearTimers() {
  if (showTimer) { clearTimeout(showTimer); showTimer = 0 }
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = 0 }
}

export function useShortcutTip() {
  function placeTip(el) {
    const r = el.getBoundingClientRect()
    /* 贴在这一栏的右边：工具轨是竖排的一整栏，标签跟着这一栏走，
       不会每换一个按钮就横跳一截。 */
    const host = el.closest('.csRail') || el.parentElement || el
    const hr = host.getBoundingClientRect()
    const opensMenu = !!(el.closest && el.closest('.csToolWrap.has-size'))
    let left = hr.right + (opensMenu ? MENU_RESERVE + 12 : 12)
    let top = r.top + r.height / 2
    /* 右边放不下整张标签时，不要把它夹回菜单上面，改放到菜单上方 */
    if (opensMenu && left + TIP_MAX_W > window.innerWidth - 12) {
      left = Math.max(12, Math.min(hr.right + 12, window.innerWidth - TIP_MAX_W - 12))
      top = Math.max(60, r.top + r.height / 2 - 110)
    } else {
      left = Math.max(12, Math.min(left, window.innerWidth - TIP_MAX_W - 12))
    }
    top = Math.max(60, Math.min(window.innerHeight - 60, top))
    return { left, top }
  }

  function showTip(el, data) {
    if (!el) return
    clearTimers()
    const pos = placeTip(el)
    tip.value = {
      on: true,
      fading: false,
      title: (data && data.title) || '',
      desc: (data && data.desc) || '',
      key: (data && data.key) || '',
      left: pos.left,
      top: pos.top
    }
    showTimer = setTimeout(() => {
      showTimer = 0
      if (!tip.value.on) return
      tip.value = { ...tip.value, fading: true }
      fadeTimer = setTimeout(() => {
        fadeTimer = 0
        tip.value = { ...tip.value, on: false, fading: false }
      }, FADE_MS)
    }, SHOW_MS)
  }

  function hideTip() {
    clearTimers()
    dwellEl = null
    if (!tip.value.on && !tip.value.fading) return
    tip.value = { ...tip.value, on: false, fading: false }
  }

  /** 事件委托：按钮之间来回移动时不必逐个绑 mouseenter。
      同一颗按钮上的后续 mouseover 不再把已经渐隐的标签叫回来。 */
  function onTipOver(e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-tip]') : null
    if (!btn) { hideTip(); return }
    if (btn === dwellEl) return
    dwellEl = btn
    showTip(btn, {
      title: btn.getAttribute('data-tip') || '',
      desc: btn.getAttribute('data-tip-desc') || '',
      key: btn.getAttribute('data-tip-key') || ''
    })
  }

  return { tip, showTip, hideTip, onTipOver }
}
