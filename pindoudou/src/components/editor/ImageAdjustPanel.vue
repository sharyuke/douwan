<script setup>
/* 图纸调整（设计稿「豆玩 · 图纸调整展开」）
   把「成品尺寸 → 智能抠图 → 图纸尺寸 → 色板 → 用色上限」收在一块面板里，
   底部「应用并生成图纸」一次落到画布。左栏卡片版面与这里共用同一份 options，
   在哪儿改都一样，这里只是把生成前要定的几件事按设计稿的顺序排好。
   原图调整（亮度 / 对比度 / 饱和度）已按 2026-11-05 的要求去掉；
   智能抠图原先在命令行有一颗独立按钮，2026-11-05 也并进这块面板。 */
import { computed, ref } from 'vue'
import Icon from '../ui/Icon.vue'
import SizeQuickCard from './SizeQuickCard.vue'
import { BOARD_SPECS } from '../../lib/boardSpec.js'
import { PALETTE_BRANDS } from '../../lib/palettes.js'
import {
  options, sourceUrl, availableColors, regenerate, setCanvasCapacity,
  setRemoveBg, setMatteLevel, matteLevels, matteInfo, stats
} from '../../composables/useStudio.js'
import { toastWarn } from '../../composables/useToast.js'

const emit = defineEmits(['cancel', 'applied'])

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
const boardSize = computed(() => {
  const w = options.canvasW
  const h = options.canvasH
  return w === h ? w : Math.max(w, h)
})

const customOpen = ref(false)
const customW = ref(options.canvasW)
const customH = ref(options.canvasH)

function pickSize(n) {
  customOpen.value = false
  if (options.canvasW === n && options.canvasH === n) return
  setCanvasCapacity(n, n)
}
function openCustom() {
  customOpen.value = true
  customW.value = options.canvasW
  customH.value = options.canvasH
}
function applyCustom() {
  const w = Math.round(Number(customW.value) || 0)
  const h = Math.round(Number(customH.value) || 0)
  if (!w || !h) return
  customOpen.value = false
  setCanvasCapacity(w, h)
}
function pickBrand(e) {
  options.brandId = e.target.value
}

function onColors(e) {
  const v = Math.round(Number(e.target.value) || 4)
  options.targetColors = Math.max(4, Math.min(colorMax.value, v))
}

function apply() {
  if (!sourceUrl.value) {
    toastWarn('先选一张图片')
    return
  }
  regenerate()
  emit('applied')
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
          <span>图纸尺寸</span>
          <span class="iap__lock"><Icon name="lock-keyhole" :size="16" />1:1 · 锁定比例</span>
        </div>
        <div class="iap__sizes">
          <button
            v-for="n in BOARD_SPECS" :key="n" type="button"
            class="iap__size" :class="{ on: boardSize === n && !customOpen }"
            @click="pickSize(n)"
          >{{ n }}</button>
          <button type="button" class="iap__size" :class="{ on: customOpen }" @click="openCustom">自定义</button>
        </div>
        <div v-if="customOpen" class="iap__custom">
          <input v-model="customW" type="number" min="8" :max="boardSize" aria-label="图纸宽（格）">
          <span>×</span>
          <input v-model="customH" type="number" min="8" :max="boardSize" aria-label="图纸高（格）">
          <button type="button" class="btn sm" @click="applyCustom">确定</button>
        </div>
      </div>

      <div class="iap__field">
        <div class="iap__label"><span>品牌色板</span></div>
        <select :value="options.brandId" aria-label="品牌色板" @change="pickBrand">
          <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </div>

      <div class="iap__field">
        <div class="iap__label">
          <span>用色上限 · 减色</span>
          <span>最多 {{ colorMax }} 色</span>
        </div>
        <input
          type="range" min="4" :max="colorMax" step="1" :value="options.targetColors"
          aria-label="用色上限" @input="onColors"
        >
        <div class="iap__scale">
          <span>4 色</span>
          <b>{{ options.targetColors }} 色</b>
          <span>{{ colorMax }} 色</span>
        </div>
        <p class="iap__hint">上限越低所选颜色越少，当前最多 {{ colorMax }} 色</p>
      </div>
    </section>

    <footer class="iap__foot">
      <button type="button" class="btn" @click="emit('cancel')">取消</button>
      <button type="button" class="btn primary" @click="apply">
        <Icon name="grid-3x3" :size="16" />应用并生成图纸
      </button>
    </footer>
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
.iap__lock{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);line-height:var(--ty-caption-lh)}
.iap__sizes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.iap__levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.iap__size{
  height:38px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);
  font-size:13px;font-weight:700;color:var(--ink-2);transition:var(--t);line-height:var(--ty-label-lh)
}
.iap__size:hover{border-color:var(--line-strong)}
.iap__size.on{background:var(--primary);border-color:var(--primary);color:var(--ink)}
.iap__custom{display:flex;align-items:center;gap:6px}
.iap__custom input{width:72px;min-height:34px;padding:4px 8px;font-size:12px;line-height:var(--ty-caption-lh)}
.iap__custom span{color:var(--muted)}
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
.iap__foot{display:flex;gap:8px;padding-top:4px}
.iap__foot .btn{flex:1}
</style>
