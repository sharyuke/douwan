<script setup>
/* 图纸调整（设计稿「豆玩 · 图纸调整展开」）
   桌面面板只有「成品尺寸 → 智能抠图」两块；手机端顺序是
   「图纸设置（钉板 / 品牌色系）→ 成品尺寸 → 智能抠图」。
   图纸尺寸、品牌色板、用色上限按 2026-11-05 的要求先后去掉（命令行有钉板 / 色号下拉，
   用色上限在左栏「色板选择」里）；「应用 / 取消」按钮同日去掉，设置选中即落到画布。
   左栏卡片版面与这里共用同一份 options，在哪儿改都一样。
   原图调整（亮度 / 对比度 / 饱和度）已按 2026-11-05 的要求去掉；
   智能抠图原先在命令行有一颗独立按钮，2026-11-05 也并进这块面板。
   手机端没有命令行那两行，钉板与品牌色系在这里补回来（mobile 时才渲染）。 */
import { computed, ref } from 'vue'
import SizeQuickCard from './SizeQuickCard.vue'
import { BOARD_SPECS, boardOf } from '../../lib/boardSpec.js'
import { PALETTE_BRANDS } from '../../lib/palettes.js'
import {
  options, setRemoveBg, setMatteLevel, matteLevels, matteInfo, stats,
  canvasCapW, canvasCapH, maxCells, sourceRecommend, setCanvasCapacity, setBrand,
  availableColors, paletteLimited
} from '../../composables/useStudio.js'

defineProps({
  /* 手机端底部抽屉：补上钉板与品牌色系（桌面命令行已有这两项） */
  mobile: { type: Boolean, default: false }
})
const emit = defineEmits(['need-pro'])

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

/* ---------------------------------------------------------------- 手机端图纸设置 */
const boardSquare = computed(() => canvasCapW.value === canvasCapH.value)
const boardCapText = computed(() => (boardSquare.value
  ? `${canvasCapW.value} × ${canvasCapW.value}`
  : `${canvasCapW.value} × ${canvasCapH.value}`))
const boardCustom = computed(() => !(boardSquare.value && BOARD_SPECS.includes(canvasCapW.value)))
const boardOptions = computed(() => BOARD_SPECS.map(n => ({
  n,
  locked: n > maxCells.value,
  current: boardSquare.value && n === canvasCapW.value,
  rec: !!sourceRecommend.value && sourceRecommend.value.spec === n,
  note: (boardOf(n)?.note || '').replace(/^单板\s*/, '')
})))

const customOpen = ref(false)
const customW = ref(options.canvasW)
const customH = ref(options.canvasH)

function pickSize(o) {
  if (o.locked) {
    emit('need-pro', `这块底板（${o.n} × ${o.n} 格）是 Pro 功能：免费版单边上限 ${maxCells.value} 格。`)
    return
  }
  customOpen.value = false
  if (o.current) return
  setCanvasCapacity(o.n, o.n)
}
function openCustom() {
  customOpen.value = true
  customW.value = canvasCapW.value
  customH.value = canvasCapH.value
}
function applyCustom() {
  const w = Math.round(Number(customW.value) || 0)
  const h = Math.round(Number(customH.value) || 0)
  if (!w || !h) return
  if (w > maxCells.value || h > maxCells.value) {
    emit('need-pro', `自定义尺寸单边最多 ${maxCells.value} 格：升级 Pro 可到更大。`)
    return
  }
  customOpen.value = false
  setCanvasCapacity(w, h)
}

const brandName = computed(() => {
  const b = PALETTE_BRANDS.find(x => x.id === options.brandId) || PALETTE_BRANDS[0]
  return b ? b.name.replace(/\s*套装$/, '') : ''
})
function pickBrand(e) {
  setBrand(e.target.value)
}
</script>

<template>
  <div class="iap">
    <!-- 手机端补上命令行里的两项：钉板（画布上限）与品牌色系，放在成品尺寸上面 -->
    <section v-if="mobile" class="iap__sec" data-adjust-board-brand>
      <header class="iap__secHead">
        <b>图纸设置</b>
        <span>钉板与品牌色系</span>
      </header>

      <div class="iap__field">
        <div class="iap__label">
          <span>钉板</span>
          <span>{{ boardCapText }}</span>
        </div>
        <div class="iap__boards">
          <button
            v-for="o in boardOptions" :key="o.n" type="button"
            class="iap__board" :class="{ on: o.current, locked: o.locked }"
            :aria-pressed="o.current"
            @click="pickSize(o)"
          >
            <b>{{ o.n }}</b>
            <span>{{ o.note }}</span>
            <em v-if="o.rec">推荐</em>
          </button>
          <button
            type="button" class="iap__board" :class="{ on: boardCustom }"
            :aria-pressed="boardCustom" @click="openCustom"
          >
            <b>自定义</b>
            <span>宽 × 高</span>
          </button>
        </div>
        <p class="iap__hint" data-board-multiple-hint>按钉板规格的倍数填，等于多拼几块板。</p>
        <div v-if="customOpen" class="iap__custom">
          <input v-model="customW" type="number" min="8" :max="maxCells" aria-label="钉板宽（格）">
          <span>×</span>
          <input v-model="customH" type="number" min="8" :max="maxCells" aria-label="钉板高（格）">
          <button type="button" class="btn sm" @click="applyCustom">确定</button>
        </div>
        <p class="iap__hint">钉板是画布上限，成品尺寸在下面调。</p>
      </div>

      <div class="iap__field">
        <div class="iap__label">
          <span>品牌色系</span>
          <span>{{ brandName }}</span>
        </div>
        <select :value="options.brandId" aria-label="品牌色系" @change="pickBrand">
          <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">
            {{ b.name }}（{{ b.colorCount }} 色）
          </option>
        </select>
        <p v-if="paletteLimited" class="iap__hint">
          本套可用 {{ availableColors.length }} 色（免费版精简）
        </p>
      </div>
    </section>

    <!-- 成品尺寸沿用右侧那张滑杆卡的内容 -->
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
.iap__label{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-size:12px;font-weight:700;color:var(--ink-2);line-height:var(--ty-caption-lh);
}
.iap__label > span:last-child{font-weight:500;color:var(--muted-2)}
.iap__boards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.iap__board{
  position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:1px;height:54px;padding:0 2px;border:1px solid var(--line);border-radius:var(--r-md);
  background:var(--surface);color:var(--ink-2);transition:var(--t);
}
.iap__board b{font-size:13px;font-weight:700;line-height:var(--ty-label-lh)}
.iap__board span{font-size:11px;font-weight:400;color:var(--muted-2);line-height:var(--ty-caption-lh)}
.iap__board:hover{border-color:var(--line-strong)}
.iap__board.on{background:var(--primary);border-color:var(--primary);color:var(--ink)}
.iap__board.on span{color:var(--ink-2)}
.iap__board.locked{opacity:.45}
.iap__board em{
  position:absolute;top:-6px;right:-2px;font-style:normal;
  padding:1px 5px;border-radius:99px;background:var(--primary);color:var(--ink);
  font-size:10px;font-weight:700;line-height:var(--ty-caption-lh);white-space:nowrap;
}
.iap__custom{display:flex;align-items:center;gap:6px}
.iap__custom input{width:72px;min-height:34px;padding:4px 8px;font-size:12px;line-height:var(--ty-caption-lh)}
.iap__custom span{color:var(--muted)}
.iap__hint{margin:0;font-size:12px;line-height:var(--ty-caption-lh);color:var(--muted-2)}
.iap__levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.iap__size{
  height:38px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);
  font-size:13px;font-weight:700;color:var(--ink-2);transition:var(--t);line-height:var(--ty-label-lh)
}
.iap__size:hover{border-color:var(--line-strong)}
.iap__size.on{background:var(--primary);border-color:var(--primary);color:var(--ink)}
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
