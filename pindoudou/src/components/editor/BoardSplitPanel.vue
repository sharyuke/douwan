<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { pattern, layout, selectedBoard, options } from '../../composables/useStudio.js'
import { drawBoard } from '../../lib/render.js'
import { boardBeadCounts } from '../../lib/pattern.js'
import { boardOf } from '../../lib/boardSpec.js'
import Icon from '../ui/Icon.vue'

/* 分板卡片：右栏「颜色用量」下面那一块，也是右侧抽屉里的内容。
   和画布里的分板视图共用同一份 layout / selectedBoard，点哪块板都会同步。 */

const boardBeads = computed(() => (pattern.value && layout.value ? boardBeadCounts(pattern.value, layout.value) : []))
function beadsOfBoard(b) {
  return boardBeads.value[b.no - 1] != null ? boardBeads.value[b.no - 1] : b.cells
}

/* 分板说明要写清「哪种板、单板多大」：规格跟着当前图纸走
   （52 / 78 / 104 / 120 钉画线板）。老存档的方板只报实物尺寸，不再写格数。 */
const splitBoard = computed(() => (layout.value ? boardOf(layout.value.boardSize.x) : null))
const splitBoardNote = computed(() => {
  const b = splitBoard.value
  if (!b) return ''
  return b.legacy ? b.note : `${b.note}，每块 ${b.pegs} × ${b.pegs} 格`
})

/* 板数太多时不把上千张缩略图全建出来（每张 canvas 都会吃内存）。
   只列前 60 块 + 当前选中那块，再给一个按板号跳的入口。 */
const SPLIT_TILE_HEAD = 60
const SPLIT_MAX_TILES = 120
const splitTilesCapped = computed(() => {
  const l = layout.value
  return !!l && l.boards.length > SPLIT_MAX_TILES
})
function showBoardTile(i) {
  if (!splitTilesCapped.value) return true
  return i < SPLIT_TILE_HEAD || i === selectedBoard.value
}

const selectedBoardData = computed(() => {
  const l = layout.value
  if (!l) return null
  return l.boards[selectedBoard.value] || l.boards[0]
})

const boardMaterialsList = computed(() => {
  const p = pattern.value
  const b = selectedBoardData.value
  if (!p || !b) return []
  const counts = new Map()
  for (let y = b.y0; y < b.y0 + b.h; y++) {
    for (let x = b.x0; x < b.x0 + b.w; x++) {
      const k = p.cells[y * p.width + x]
      if (k < 0) continue
      const c = p.palette[k]
      if (!c) continue
      const prev = counts.get(c.code)
      if (prev) prev.n++
      else counts.set(c.code, { c, n: 1 })
    }
  }
  return [...counts.values()].map(({ c, n }) => ({ code: c.code, hex: c.hex, n })).sort((a, b2) => b2.n - a.n)
})

const boardPreviewEls = ref([])
const boardGridEl = ref(null)
const boardJumpInput = ref(null)
const focusEl = ref(null)

function drawBoardPreviews() {
  const els = boardPreviewEls.value
  if (!els || !layout.value) return
  layout.value.boards.forEach((b, i) => {
    if (!showBoardTile(i)) return
    const el = els[i]
    if (el) drawBoard(el, pattern.value, b, { cell: 6, codes: false, ruler: false })
  })
}

function drawSelectedBoard() {
  const b = selectedBoardData.value
  const el = focusEl.value
  if (!b || !el) return
  /* 抽屉只有 380px 宽：按板子边长反算一格多少像素，尽量整块放得下；
     太小的格子不印色号（看不清，反而糊成一片）。 */
  const cell = Math.max(4, Math.min(10, Math.floor(300 / Math.max(b.w, b.h))))
  drawBoard(el, pattern.value, b, { cell, codes: options.numbering && cell >= 8, ruler: true })
}

function redrawAll() {
  nextTick(() => {
    drawBoardPreviews()
    drawSelectedBoard()
  })
}

/* 打开卡片 / 换图纸 / 换选中的板 / 改色号开关都要重画 */
watch([layout, selectedBoard, () => options.numbering], redrawAll)
watch(layout, l => {
  if (l && selectedBoard.value >= l.boards.length) selectedBoard.value = 0
})
onMounted(redrawAll)

/* 「跳到第 __ 板」：范围外的输入不报错也不跳，直接回填成真正生效的板号 */
function jumpToBoardNo() {
  const l = layout.value
  const el = boardJumpInput.value
  if (!l || !el) return
  const n = Math.round(Number(el.value))
  const i = Number.isFinite(n) ? Math.min(l.boards.length, Math.max(1, n)) - 1 : selectedBoard.value
  el.value = String(i + 1)
  jumpToBoard(i)
}

function jumpToBoard(i) {
  selectedBoard.value = i
  nextTick(() => {
    drawSelectedBoard()
    /* 截断时选中的那块会新挂上一个 canvas，得把它也画出来 */
    if (splitTilesCapped.value) drawBoardPreviews()
    boardGridEl.value?.querySelector('.boardTile.on')?.scrollIntoView({ block: 'nearest' })
  })
}

function setBoardPreviewRef(el, i) {
  if (el) boardPreviewEls.value[i] = el
}
</script>

<template>
  <div class="splitPanel" data-split-panel>
    <p class="splitIntro">
      共 {{ layout ? layout.count : 0 }} 块 {{ splitBoard ? splitBoard.label : '拼板' }}（{{ splitBoardNote }}）。
      图纸上珊瑚色虚线就是拼板边界，角标数字是板号。
    </p>

    <div v-if="splitTilesCapped" class="boardListNote">
      <p>
        共 {{ layout.count }} 块，这里只列出前 {{ SPLIT_TILE_HEAD }} 块
        （其余 {{ layout.count - SPLIT_TILE_HEAD }} 块不重复铺在页面上，避免一次建上千张缩略图）。
        要直接看别的板，输入板号跳过去即可，放大预览与材料色号照常显示。
      </p>
      <label class="boardJump">
        <span>跳到第</span>
        <input
          ref="boardJumpInput" type="number" inputmode="numeric"
          min="1" :max="layout.count" :value="selectedBoard + 1"
          aria-label="跳到的板号"
          @keyup.enter="jumpToBoardNo"
          @change="jumpToBoardNo"
        >
        <span>板（共 {{ layout.count }} 块）</span>
      </label>
    </div>

    <div ref="boardGridEl" class="boardGrid">
      <template v-for="(b, i) in (layout ? layout.boards : [])" :key="b.no">
        <button
          v-if="showBoardTile(i)"
          class="boardTile" :class="{ on: selectedBoard === i }"
          type="button"
          @click="jumpToBoard(i)"
        >
          <div class="boardTile__no">
            <span>第 {{ b.no }} 板</span>
            <em>{{ b.coord }}</em>
          </div>
          <canvas :ref="el => setBoardPreviewRef(el, i)" />
          <div class="boardTile__meta">
            <span>{{ b.w }}×{{ b.h }}</span>
            <span>{{ beadsOfBoard(b) }} 颗</span>
          </div>
        </button>
      </template>
    </div>

    <div v-if="selectedBoardData" class="boardFocusWrap">
      <div class="row row--between">
        <b>第 {{ selectedBoardData.no }} 板 放大预览</b>
        <span class="muted">格子 {{ selectedBoardData.x0 + 1 }}–{{ selectedBoardData.x0 + selectedBoardData.w }} 列 · {{ selectedBoardData.y0 + 1 }}–{{ selectedBoardData.y0 + selectedBoardData.h }} 行</span>
      </div>
      <div class="boardFocus"><canvas ref="focusEl" /></div>
      <div class="swatchRow" style="margin-top:10px">
        <span v-for="m in boardMaterialsList" :key="m.code" class="swatchPill">
          <i :style="{ background: m.hex }"></i>{{ m.code }} × {{ m.n }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.splitIntro{
  margin:0 0 10px;font-size:var(--fs-2xs);line-height:var(--ty-caption-lh);color:var(--muted);
}
.boardListNote{
  display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;
  margin:0 0 10px;font-size:var(--fs-2xs);font-weight:700;color:#625800;
  background:rgba(255,218,53,.20);border:1px solid rgba(23,23,23,.22);
  border-radius:var(--r-sm);padding:7px 10px;line-height:var(--ty-caption-lh)
}
.boardListNote p{margin:0;line-height:var(--ty-caption-lh)}
.boardJump{display:flex;align-items:center;gap:6px;white-space:nowrap}
.boardJump input{
  width:74px;padding:4px 6px;font:inherit;font-weight:700;color:var(--ink);
  border:1px solid transparent;border-radius:var(--r-xs);background:var(--surface-3);
}
.boardJump input:focus{background:var(--surface);border-color:var(--pink);box-shadow:0 0 0 3px rgba(255,142,199,.18);outline:0}
.boardFocusWrap{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.boardFocus{margin-top:10px;background:#fff;border:1px solid var(--line);border-radius:var(--r-md);padding:10px;display:grid;place-items:center;overflow:auto}
.boardFocus canvas{display:block;image-rendering:pixelated}
/* 右栏 / 抽屉里放两列就够了，卡片本身比画布里的分板视图窄很多 */
.boardGrid{grid-template-columns:repeat(2,minmax(0,1fr))}
</style>
