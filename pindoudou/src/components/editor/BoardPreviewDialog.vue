<script setup>
/* 分板大图：缩略图在窄栏里看不全，点开这一层才按窗口把整块板放进来。
   默认「适应」能看见整块；放大之后格子里的色号才出现，多出来的部分自己滚。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import Icon from '../ui/Icon.vue'
import { pattern as studioPattern, options } from '../../composables/useStudio.js'
import { drawBoard } from '../../lib/render.js'
import { boardMaterials } from '../../lib/pattern.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  boards: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
  /* null = 跟工作台的色号开关；交付弹窗可以单独传自己的勾选 */
  showCodes: { default: null },
  /* 导出「成品区域」时格子不是工作台那份整图，调用方把裁好的图案传进来 */
  patternSource: { default: null }
})
const emit = defineEmits(['update:modelValue', 'update:index'])

const ZOOMS = [1, 1.5, 2, 3, 4, 6]
const stageEl = ref(null)
const canvasEl = ref(null)
const zoom = ref(1)
const drawnCell = ref(0)

const pat = computed(() => props.patternSource || studioPattern.value)
const board = computed(() => props.boards[props.index] || null)
const total = computed(() => props.boards.length)
const codesOn = computed(() => (props.showCodes == null ? !!options.numbering : !!props.showCodes))
const title = computed(() => (board.value ? `第 ${board.value.no} 板` : '分板预览'))

const mats = computed(() => {
  const p = pat.value
  const b = board.value
  if (!p || !b) return []
  return boardMaterials(p, b).map(m => ({ code: m.code, hex: m.hex, n: m.count }))
})
const beads = computed(() => mats.value.reduce((sum, m) => sum + m.n, 0))

const canPrev = computed(() => props.index > 0)
const canNext = computed(() => props.index < total.value - 1)

function close() {
  emit('update:modelValue', false)
}

function step(delta) {
  const next = props.index + delta
  if (next < 0 || next >= props.boards.length) return
  zoom.value = 1
  emit('update:index', next)
}

/* 整块板（含四周坐标带）放进预览区时，一格最多能画多少像素 */
function cellThatFits(b, maxW, maxH) {
  let best = 2
  let lo = 2
  let hi = 64
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const ruler = Math.max(14, Math.round(mid * 1.7))
    const w = ruler * 2 + b.w * mid
    const h = ruler * 2 + b.h * mid
    if (w <= maxW && h <= maxH) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best
}

function draw() {
  const b = board.value
  const el = canvasEl.value
  const stage = stageEl.value
  const p = pat.value
  if (!props.modelValue || !b || !el || !stage || !p) return
  /* 留出内边距，避免「刚好塞满」时冒出滚动条，再把可用宽度挤小、来回抖 */
  const maxW = stage.clientWidth - 20
  const maxH = stage.clientHeight - 20
  if (maxW < 40 || maxH < 40) return
  const fit = cellThatFits(b, maxW, maxH)
  const cell = Math.max(2, Math.min(48, Math.round(fit * zoom.value)))
  drawnCell.value = cell
  drawBoard(el, p, b, {
    cell,
    codes: codesOn.value && cell >= 11,
    ruler: true,
    grid: true
  })
}

function scheduleDraw() {
  nextTick(() => {
    draw()
    requestAnimationFrame(draw)
  })
}

function zoomBy(dir) {
  if (dir > 0) {
    const next = ZOOMS.find(z => z > zoom.value + 0.01)
    if (next) zoom.value = next
    return
  }
  let next = 1
  for (const z of ZOOMS) if (z < zoom.value - 0.01) next = z
  zoom.value = next
}

function onWheel(e) {
  if (!props.modelValue) return
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1 : -1)
}

/* 这一层经常叠在「图纸交付」上面。Escape 若冒泡，底下那个弹窗会一起关掉。 */
function onKey(e) {
  if (!props.modelValue) return
  if (e.key === 'Escape') {
    e.stopImmediatePropagation()
    close()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    step(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    step(1)
  }
}

let ro = null
watch(stageEl, (el, prev) => {
  if (prev) prev.removeEventListener('wheel', onWheel)
  if (ro) {
    ro.disconnect()
    ro = null
  }
  if (!el) return
  el.addEventListener('wheel', onWheel, { passive: false })
  if (typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => draw())
  ro.observe(el)
})

watch(() => props.modelValue, open => {
  if (open) {
    zoom.value = 1
    scheduleDraw()
  }
})
watch(() => props.index, () => {
  if (zoom.value !== 1) zoom.value = 1
})
watch([() => props.index, () => props.boards, () => props.patternSource, zoom, codesOn], () => {
  if (props.modelValue) scheduleDraw()
})
watch(() => props.boards.length, n => {
  if (!props.modelValue || n <= 0) return
  if (props.index >= n) emit('update:index', n - 1)
})

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  if (ro) ro.disconnect()
  stageEl.value?.removeEventListener('wheel', onWheel)
})
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="title"
    size="lg"
    :layer="260"
    head-icon="layout-grid"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <template v-if="board" #headExtra>
      <span class="bpRange">{{ board.w }}×{{ board.h }} · {{ beads.toLocaleString() }} 颗</span>
    </template>

    <div v-if="board" class="bp" data-board-preview>
      <div class="bpBar">
        <button class="btn btn-secondary sm" type="button" :disabled="!canPrev" @click="step(-1)">
          <Icon name="chevron-left" :size="16" />上一块
        </button>
        <span class="bpBar__where">第 {{ board.no }} / {{ total }} 板 · 全图 {{ board.x0 + 1 }}–{{ board.x0 + board.w }} 列 · {{ board.y0 + 1 }}–{{ board.y0 + board.h }} 行</span>
        <button class="btn btn-secondary sm" type="button" :disabled="!canNext" @click="step(1)">
          下一块<Icon name="chevron-right" :size="16" />
        </button>
        <span class="bpBar__gap"></span>
        <button class="btn btn-secondary icon sm" type="button" title="缩小" aria-label="缩小" :disabled="zoom <= 1" @click="zoomBy(-1)">
          <Icon name="zoom-out" :size="16" />
        </button>
        <button class="btn btn-secondary sm" type="button" :disabled="zoom === 1" @click="zoom = 1">适应</button>
        <button class="btn btn-secondary icon sm" type="button" title="放大" aria-label="放大" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]" @click="zoomBy(1)">
          <Icon name="zoom-in" :size="16" />
        </button>
      </div>

      <div ref="stageEl" class="bpStage">
        <div class="bpStage__inner">
          <canvas ref="canvasEl" data-board-preview-canvas :aria-label="`第 ${board.no} 板大图`" />
        </div>
      </div>

      <p class="bpHint">
        <template v-if="codesOn && drawnCell > 0 && drawnCell < 11">再放大一点就能看清每格色号。</template>
        <template v-else>滚轮或按钮放大，放大后拖动查看。</template>
      </p>

      <div v-if="mats.length" class="swatchRow bpLegend">
        <span v-for="m in mats" :key="m.code" class="swatchPill">
          <i :style="{ background: m.hex }"></i>{{ m.code }} × {{ m.n }}
        </span>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.bpRange{font-size:var(--fs-2xs);font-weight:700;color:var(--muted);white-space:nowrap;line-height:var(--ty-caption-lh)}
.bp{display:flex;flex-direction:column;gap:10px;height:min(68vh,640px);min-height:280px}
.bpBar{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap}
.bpBar__where{
  font-size:var(--fs-2xs);font-weight:700;color:var(--ink);line-height:var(--ty-caption-lh);
  min-width:0
}
.bpBar__gap{flex:1}
.bpStage{
  flex:1;min-height:0;overflow:auto;
  background:#fff;border:1px solid var(--line);border-radius:var(--r-md)
}
/* 内层至少铺满视口：图比窗口小就居中，比窗口大就从左上角开始滚，不会滚不到边 */
.bpStage__inner{min-width:100%;min-height:100%;display:flex;align-items:center;justify-content:center;padding:8px}
.bpStage canvas{display:block;image-rendering:pixelated;background:#fff}
.bpHint{margin:0;flex:none;font-size:var(--fs-2xs);color:var(--muted);line-height:var(--ty-caption-lh)}
.bpLegend{flex:none;max-height:84px;overflow:auto}
@media(max-width:780px){
  .bp{height:min(62vh,640px);min-height:220px}
  .bpBar__gap{display:none}
}
</style>
