import { ref } from 'vue'

/* ---------------------------------------------------------------- 快捷键浮动标签
   鼠标停在工具按钮上时，在旁边浮出一张小标签：工具名 + 一句说明 + 快捷键标注。
   只在电脑端出现（手机没有鼠标，也没有物理键盘）。

   停住约 2.5 秒后渐隐，鼠标还停在同一颗按钮上也不会再弹出来；
   移开再回来，或换到另一颗按钮，才重新显示。

   画笔 / 橡皮 / 换色的下拉菜单贴在工具轨右缘外侧，和按钮垂直居中。
   这三颗的标签改到菜单上沿或下沿，跟菜单同一列上下分开，不再横着推到菜单右边。

   标签用 fixed 定位：工具轨是 overflow:auto 的滚动容器，
   绝对定位的标签跑到轨外会被裁掉（选色面板踩过一次同样的坑）。
   状态放在模块级：全屏工作台的工具轨（EditorView）与旧版面的工具行
   （EditorCanvas）共用同一份，谁悬停都写到同一个标签上。 */
const tip = ref({ on: false, fading: false, stack: false, title: '', desc: '', key: '', left: 0, top: 0 })

/* 标签最大宽度（与 ShortcutTip.vue 里的 max-width 一致），用来把它夹在视口里 */
const TIP_MAX_W = 248
const SHOW_MS = 2500
const FADE_MS = 450
/* 菜单还没打开时按这个高度让位。画笔卡含「直线」那一行，换色菜单三行。 */
const MENU_H = { paint: 124, erase: 81, swap: 140 }
const TIP_GAP = 8

let dwellEl = null
let showTimer = 0
let fadeTimer = 0
let placeToken = 0

function clearTimers() {
  if (showTimer) { clearTimeout(showTimer); showTimer = 0 }
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = 0 }
}

export function useShortcutTip() {
  /** 这颗工具的下拉菜单占的竖条。开着就用真实盒子，没开就按预留高度。 */
  function menuBand(wrap) {
    const toolBtn = wrap.querySelector('.csTool') || wrap
    const key = toolBtn.getAttribute('data-tool-key') || ''
    const open = document.querySelector(key === 'swap' ? '[data-swap-menu]' : '[data-brush-size]')
    if (open) {
      const or = open.getBoundingClientRect()
      if (or.height > 20 && or.width > 20) return { top: or.top, bottom: or.bottom }
    }
    const br = toolBtn.getBoundingClientRect()
    const menuH = MENU_H[key] || 120
    const center = br.top + br.height / 2
    return { top: center - menuH / 2, bottom: center + menuH / 2 }
  }

  function stackTop(band, tipH) {
    const spaceBelow = window.innerHeight - 12 - band.bottom
    const spaceAbove = band.top - 12
    let visualTop
    if (spaceBelow >= tipH + TIP_GAP || spaceBelow >= spaceAbove) visualTop = band.bottom + TIP_GAP
    else visualTop = band.top - TIP_GAP - tipH
    return Math.max(12, Math.min(visualTop, window.innerHeight - 12 - tipH))
  }

  function placeTip(el) {
    const r = el.getBoundingClientRect()
    /* 贴在这一栏的右边：工具轨是竖排的一整栏，标签跟着这一栏走，
       不会每换一个按钮就横跳一截。 */
    const host = el.closest('.csRail') || el.parentElement || el
    const hr = host.getBoundingClientRect()
    const left = Math.max(12, Math.min(hr.right + 12, window.innerWidth - TIP_MAX_W - 12))
    const wrap = el.closest && el.closest('.csToolWrap.has-size')
    if (!wrap) {
      const top = Math.max(60, Math.min(window.innerHeight - 60, r.top + r.height / 2))
      return { left, top, stack: false }
    }
    return { left, top: stackTop(menuBand(wrap), 72), stack: true }
  }

  /** 标签实际高度出来之后，再贴一次，避免估算矮了又压回菜单上。 */
  function refineTip(el) {
    const wrap = el.closest && el.closest('.csToolWrap.has-size')
    const node = document.querySelector('[data-shortcut-tip]')
    if (!wrap || !node || !tip.value.on || !tip.value.stack) return
    const tr = node.getBoundingClientRect()
    const band = menuBand(wrap)
    const overlaps = tr.top < band.bottom + TIP_GAP - 1 && tr.bottom > band.top - TIP_GAP + 1
    const clipped = tr.top < 12 || tr.bottom > window.innerHeight - 12
    if (!overlaps && !clipped) return
    tip.value = { ...tip.value, top: stackTop(band, tr.height) }
  }

  function showTip(el, data) {
    if (!el) return
    clearTimers()
    const pos = placeTip(el)
    const token = ++placeToken
    tip.value = {
      on: true,
      fading: false,
      stack: pos.stack,
      title: (data && data.title) || '',
      desc: (data && data.desc) || '',
      key: (data && data.key) || '',
      left: pos.left,
      top: pos.top
    }
    requestAnimationFrame(() => {
      if (token !== placeToken || !tip.value.on) return
      refineTip(el)
    })
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
