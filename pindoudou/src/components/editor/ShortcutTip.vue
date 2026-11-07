<script setup>
/* 快捷键浮动标签：鼠标停在工具按钮上时，浮出「工具名 + 说明 + 快捷键」。
   只在电脑端出现。状态与定位都在 useShortcutTip.js 里，
   全站只挂这一个实例（挂在工作台视图里，工具轨与旧版面工具行共用）。 */
import { useShortcutTip } from '../../composables/useShortcutTip.js'

const { tip } = useShortcutTip()
</script>

<template>
  <div
    v-if="tip.on"
    class="stip no-print" :class="{ 'is-out': tip.fading, 'is-stack': tip.stack }"
    :style="{ left: tip.left + 'px', top: tip.top + 'px' }"
    role="tooltip"
    data-shortcut-tip
  >
    <div class="stip__row">
      <b class="stip__title">{{ tip.title }}</b>
      <kbd v-if="tip.key" class="stip__key">{{ tip.key }}</kbd>
    </div>
    <span v-if="tip.desc" class="stip__desc">{{ tip.desc }}</span>
  </div>
</template>

<style scoped>
/* 深色底 + 青柠键帽：工作台本身是浅色（--cs-bg #EFF2EC），深色标签压得住画面，
   键帽用品牌青柠，一眼能认出那是「按键」而不是又一行说明。 */
.stip{
  position:fixed;z-index:60;pointer-events:none;
  transform:translateY(-50%);
  max-width:248px;padding:8px 10px;border-radius:10px;
  background:var(--cs-ink,#1A2D22);color:#fff;
  box-shadow:0 8px 22px rgba(26,45,34,.24);
  display:flex;flex-direction:column;gap:4px;
  font-family:var(--font-sans);text-align:left;
  opacity:1;transition:opacity .45s ease;
}
.stip.is-out{opacity:0}
/* 上下错开时 top 是标签顶边，不再按中线平移 */
.stip.is-stack{transform:none}
.stip__row{display:flex;align-items:center;justify-content:space-between;gap:14px}
.stip__title{font-size:13px;font-weight:700;line-height:18px;color:#fff;white-space:nowrap}
.stip__desc{font-size:12px;font-weight:500;line-height:16px;color:rgba(255,255,255,.72)}
.stip__key{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;font-weight:700;line-height:16px;padding:2px 7px;border-radius:5px;
  background:var(--cs-accent,#C8E63C);color:var(--cs-ink,#1A2D22);white-space:nowrap;
}
</style>
