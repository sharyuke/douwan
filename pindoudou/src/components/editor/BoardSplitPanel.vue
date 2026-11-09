<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { pattern, layout, selectedBoard } from '../../composables/useStudio.js'
import { drawBoard } from '../../lib/render.js'
import { boardBeadCounts } from '../../lib/pattern.js'
import { boardOf } from '../../lib/boardSpec.js'
import Icon from '../ui/Icon.vue'
import BoardPreviewDialog from './BoardPreviewDialog.vue'

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

const boardPreviewEls = ref([])
const boardGridEl = ref(null)
const boardJumpInput = ref(null)
const previewOpen = ref(false)

function drawBoardPreviews() {
  const els = boardPreviewEls.value
  if (!els || !layout.value) return
  layout.value.boards.forEach((b, i) => {
    if (!showBoardTile(i)) return
    const el = els[i]
    if (el) drawBoard(el, pattern.value, b, { cell: 6, codes: false, ruler: false })
  })
}

function redrawAll() {
  nextTick(drawBoardPreviews)
}

/* 换图纸才重画缩略图。点哪一块只打开大图，不必把整列缩略图再画一遍。 */
watch(layout, l => {
  if (l && selectedBoard.value >= l.boards.length) selectedBoard.value = 0
  redrawAll()
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
  previewOpen.value = true
  nextTick(() => {
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
      点一块板可以预览大图。
    </p>

    <div v-if="splitTilesCapped" class="boardListNote">
      <p>
        共 {{ layout.count }} 块，这里只列出前 {{ SPLIT_TILE_HEAD }} 块
        （其余 {{ layout.count - SPLIT_TILE_HEAD }} 块不重复铺在页面上，避免一次建上千张缩略图）。
        要直接看别的板，输入板号即可，大图预览会一起打开。
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
          :aria-label="`预览第 ${b.no} 板`"
          @click="jumpToBoard(i)"
        >
          <div class="boardTile__no">
            <span>第 {{ b.no }} 板</span>
            <em>{{ b.coord }}</em>
          </div>
          <span class="boardTile__pic">
            <canvas :ref="el => setBoardPreviewRef(el, i)" />
            <span class="boardTile__zoom" aria-hidden="true"><Icon name="zoom-in" :size="14" /></span>
          </span>
          <div class="boardTile__meta">
            <span>{{ b.w }}×{{ b.h }}</span>
            <span>{{ beadsOfBoard(b) }} 颗</span>
          </div>
        </button>
      </template>
    </div>

    <BoardPreviewDialog
      v-model="previewOpen"
      :boards="layout ? layout.boards : []"
      :index="selectedBoard"
      @update:index="jumpToBoard"
    />
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
/* 右栏 / 抽屉里放两列就够了，卡片本身比画布里的分板视图窄很多 */
.boardGrid{grid-template-columns:repeat(2,minmax(0,1fr))}
.boardTile__pic{position:relative;display:block}
.boardTile__zoom{
  position:absolute;right:6px;bottom:6px;width:22px;height:22px;border-radius:50%;
  display:grid;place-items:center;background:rgba(27,27,31,.72);color:#fff;pointer-events:none
}
</style>
