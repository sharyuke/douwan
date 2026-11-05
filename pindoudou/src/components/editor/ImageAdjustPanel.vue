<script setup>
/* 图纸调整（设计稿「豆玩 · 图纸调整展开」）
   把「成品尺寸 → 智能抠图 → 用色上限」收在一块面板里。
   图纸尺寸与品牌色板按 2026-11-05 的要求从这里去掉（命令行有钉板与色号下拉）。
   面板没有「应用 / 取消」按钮（同日去掉）：成品尺寸、抠图各自的 setter 即时落到画布，
   色数在松手（change）时重算。左栏卡片版面与这里共用同一份 options，在哪儿改都一样。
   原图调整（亮度 / 对比度 / 饱和度）已按 2026-11-05 的要求去掉；
   智能抠图原先在命令行有一颗独立按钮，2026-11-05 也并进这块面板。 */
import { computed } from 'vue'
import SizeQuickCard from './SizeQuickCard.vue'
import {
  options, sourceUrl, availableColors, regenerate, yieldForBusyPaint,
  setRemoveBg, setMatteLevel, matteLevels, matteInfo, stats
} from '../../composables/useStudio.js'

/** 抠图那一行的状态文案（与左栏「图片处理 → 智能抠图」同一套口径） */
const matteNote = computed(() => {
  const m = matteInfo.value
  if (!m) return ''
  const beads = stats.value ? ` · 保留 ${stats.value.total.toLocaleString()} 颗豆` : ''
  if (m.status === 'applied') return `已生效 · ${m.text}${beads}`
  if (m.status === 'failed') return `未生效 · ${m.text}`
  return m.text
})
const matteNoteClass = computed(() => ({
  warn: matteInfo.value?.status === 'failed',
  weak: !!matteInfo.value?.weak
}))

const colorMax = computed(() => Math.max(4, availableColors.value.length))

/* 色数：拖动时只改读数，松手（change）才重算 —— 每拖一格都重跑一次生成会卡住滑杆 */
function onColors(e) {
  const v = Math.round(Number(e.target.value) || 4)
  options.targetColors = Math.max(4, Math.min(colorMax.value, v))
}
async function onColorsCommit() {
  if (!sourceUrl.value) return
  await yieldForBusyPaint()
  regenerate()
}
</script>

<template>
  <div class="iap">
    <!-- 成品尺寸与图纸设置合并成一块面板：成品尺寸沿用右侧那张滑杆卡的内容 -->
    <SizeQuickCard embedded />

    <!-- 智能抠图：原命令行那颗独立按钮并到这里，开关 + 三档力度 + 生效说明 -->
    <section class="iap__sec" data-adjust-matte>
      <header class="iap__secHead iap__secHead--switch">
        <div>
          <b>智能抠图</b>
          <span>自动去掉背景与投影，只保留主体</span>
        </div>
        <button
          type="button" class="iap__switch" :class="{ on: options.removeBg }"
          role="switch" :aria-checked="options.removeBg" aria-label="智能抠图"
          @click="setRemoveBg(!options.removeBg)"
        ><i></i></button>
      </header>

      <div v-if="options.removeBg" class="iap__field">
        <div class="iap__levels" role="group" aria-label="抠图力度">
          <button
            v-for="l in matteLevels" :key="l.key"
            type="button" class="iap__size" :class="{ on: options.matteLevel === l.key }"
            :title="l.hint"
            @click="setMatteLevel(l.key)"
          >{{ l.label }}</button>
        </div>
        <p v-if="matteNote" class="iap__note" :class="matteNoteClass">{{ matteNote }}</p>
      </div>
    </section>

    <section class="iap__sec">
      <header class="iap__secHead">
        <b>图纸设置</b>
        <span>生成拼豆图纸，不修改原图</span>
      </header>

      <div class="iap__field">
        <div class="iap__label">
          <span>用色上限 · 减色</span>
          <span>最多 {{ colorMax }} 色</span>
        </div>
        <input
          type="range" min="4" :max="colorMax" step="1" :value="options.targetColors"
          aria-label="用色上限" @input="onColors" @change="onColorsCommit"
        >
        <div class="iap__scale">
          <span>4 色</span>
          <b>{{ options.targetColors }} 色</b>
          <span>{{ colorMax }} 色</span>
        </div>
        <p class="iap__hint">上限越低所选颜色越少，当前最多 {{ colorMax }} 色</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.iap{display:flex;flex-direction:column;gap:14px}
.iap__sec{display:flex;flex-direction:column;gap:16px}
.iap__secHead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.iap__secHead--switch{align-items:center}
.iap__secHead--switch > div{display:flex;flex-direction:column;gap:2px;min-width:0}
.iap__secHead b{font-size:13px;font-weight:700;line-height:var(--ty-label-lh)}
.iap__secHead span{font-size:12px;color:var(--muted-2);line-height:var(--ty-caption-lh)}
.iap__field{display:flex;flex-direction:column;gap:8px}
.iap__label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:700;color:var(--ink-2);line-height:var(--ty-caption-lh)}
.iap__label > span:last-child{font-weight:500;color:var(--muted-2)}
.iap__levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.iap__size{
  height:38px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);
  font-size:13px;font-weight:700;color:var(--ink-2);transition:var(--t);line-height:var(--ty-label-lh)
}
.iap__size:hover{border-color:var(--line-strong)}
.iap__size.on{background:var(--primary);border-color:var(--primary);color:var(--ink)}
.iap__scale{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted-2);line-height:var(--ty-caption-lh)}
.iap__scale b{color:var(--ink);font-weight:700}
.iap__hint{margin:0;font-size:12px;line-height:var(--ty-caption-lh);color:var(--muted-2)}
.iap__note{margin:0;font-size:12px;line-height:var(--ty-caption-lh);color:var(--ink-2)}
.iap__note.warn{color:var(--coral-deep)}
.iap__note.weak{color:#B7791F}
.iap__switch{
  width:44px;height:26px;flex:0 0 auto;border-radius:99px;border:1px solid var(--line-strong);
  background:var(--surface-3);padding:2px;transition:var(--t);
}
.iap__switch i{display:block;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(31,31,29,.2);transition:transform var(--t)}
.iap__switch.on{background:var(--primary);border-color:var(--primary-deep)}
.iap__switch.on i{transform:translateX(18px)}
</style>
