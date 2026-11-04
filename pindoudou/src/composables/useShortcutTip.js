import { ref } from 'vue'

/* ---------------------------------------------------------------- 快捷键浮动标签
   鼠标停在工具按钮上时，在旁边浮出一张小标签：工具名 + 一句说明 + 快捷键标注。
   只在电脑端出现（手机没有鼠标，也没有物理键盘）。

   标签用 fixed 定位：工具轨是 overflow:auto 的滚动容器，
   绝对定位的标签跑到轨外会被裁掉（选色面板踩过一次同样的坑）。
   状态放在模块级：全屏工作台的工具轨（EditorView）与旧版面的工具行
   （EditorCanvas）共用同一份，谁悬停都写到同一个标签上。 */
const tip = ref({ on: false, title: '', desc: '', key: '', left: 0, top: 0 })

/* 标签最大宽度（与 ShortcutTip.vue 里的 max-width 一致），用来把它夹在视口里 */
const TIP_MAX_W = 248

export function useShortcutTip() {
  function showTip(el, data) {
    if (!el) return
    const r = el.getBoundingClientRect()
    /* 贴在这一栏的右边：工具轨是竖排的一整栏，标签跟着这一栏走，
       不会每换一个按钮就横跳一截。 */
    const host = el.closest('.csRail') || el.parentElement || el
    const hr = host.getBoundingClientRect()
    const left = Math.max(12, Math.min(hr.right + 12, window.innerWidth - TIP_MAX_W - 12))
    /* 竖直方向跟着被悬停的按钮走，并夹在视口里（顶部那条命令栏下面） */
    const top = Math.max(60, Math.min(window.innerHeight - 60, r.top + r.height / 2))
    tip.value = {
      on: true,
      title: (data && data.title) || '',
      desc: (data && data.desc) || '',
      key: (data && data.key) || '',
      left,
      top
    }
  }

  function hideTip() {
    tip.value.on = false
  }

  /** 事件委托：按钮之间来回移动时不必逐个绑 mouseenter */
  function onTipOver(e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-tip]') : null
    if (!btn) { hideTip(); return }
    showTip(btn, {
      title: btn.getAttribute('data-tip') || '',
      desc: btn.getAttribute('data-tip-desc') || '',
      key: btn.getAttribute('data-tip-key') || ''
    })
  }

  return { tip, showTip, hideTip, onTipOver }
}
