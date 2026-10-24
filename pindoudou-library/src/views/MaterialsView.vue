<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import BaseDialog from '../components/ui/BaseDialog.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import {
  pattern, hasPattern, projectName, materials, stats, options, layout,
  currentProjectId, openProject, ensureProjectLoaded, projects, saveProject, buildBoards, markBoard, buildProgress
} from '../composables/useStudio.js'
import { inventory, shortageOf, suggestRestock } from '../composables/useInventory.js'
import { check } from '../composables/useMembership.js'
import { toastOk, toastWarn, toastResult } from '../composables/useToast.js'
import { boardMaterials, boardBeadCounts } from '../lib/pattern.js'
import { boardsText } from '../lib/boardSpec.js'
import { drawBoard } from '../lib/render.js'
import { formatDuration, num } from '../lib/forge.js'
import {
  exportMaterialsCSV, printPattern, printPlan, copyShoppingList, exportPatternJSON, exportSVG, exportPatternPNG,
  PRINT_MAX_BOARDS
} from '../lib/exporters.js'
import { brand, bead } from '../composables/useStudio.js'

const route = useRoute()
const router = useRouter()

const short = computed(() => (hasPattern.value ? shortageOf(pattern.value) : null))
const restock = computed(() => (hasPattern.value ? suggestRestock(pattern.value) : null))

/** 第三步（拼制 / 完成）的入口：带上当前作品 id，否则 BuildView 打开是空页面 */
const buildLink = computed(() => (currentProjectId.value ? `/build/${currentProjectId.value}` : '/build'))

/** 每块板真正要放的豆数（空格不算），下标对应 layout.boards */
const boardBeads = computed(() => (pattern.value && layout.value ? boardBeadCounts(pattern.value, layout.value) : []))
function beadsOfBoard(b) {
  return boardBeads.value[b.no - 1] != null ? boardBeads.value[b.no - 1] : b.cells
}

const selectedBoards = ref(new Set())
const printDialog = ref(false)

/* 缩略图元素表：用普通 Map 而不是 ref({})。
   两个原因：① 它是「DOM 元素表」，不需要响应式（画图是主动调用 drawOne）；
   ② 1000×1000 时有 1225 块板，响应式对象上挂 1225 个键是白花的开销。 */
const previewEls = new Map()

function setPreviewRef(el, no) {
  if (!el) {
    /* 元素卸载 / 列表重渲染时 Vue 会用 null 回调一次。以前这里忽略 null，
       于是表里一直留着已经脱离文档的 canvas —— 1225 块板全滚一遍就是 1225 个
       永远不释放的画布引用。 */
    previewEls.delete(no)
    return
  }
  previewEls.set(no, el)
  boardIo?.observe(el)
}

/* 分板缩略图按「进入视口才画」处理。
   为什么：4×4 块（16 块板）时一次画完完全没关系，但精细档 300×300 是 121 块、
   450×450 是 256 块 —— 每块缩略图是一张 232×232 的 canvas，一次全画出来是
   200 多次 drawBoard（约 21 万次 fillRect）加 50 MB 以上的画布内存，
   打开页面就卡住。这里只在板子滚到眼前时才画它自己那一块。

   画布上限提到 1000 格之后还多一条：1225 块板，每块 cell=8 的缩略图是 260×260
   （270 KB 后备缓冲），**全部画过一遍就是 330 MB**，手机浏览器会直接把标签页杀掉。
   所以滚出屏幕的缩略图要主动把画布缩回 1×1 释放缓冲（见 releaseOne）。 */
let boardIo = null
const drawn = new Set()

function drawOne(no) {
  const el = previewEls.get(no)
  const b = layout.value && layout.value.boards[no - 1]
  if (!el || !b || !pattern.value) return
  drawBoard(el, pattern.value, b, { cell: 8, codes: false, ruler: true })
  drawn.add(no)
}

/**
 * 滚出屏幕就释放画布缓冲。
 * 为什么是 1×1 而不是 0×0：canvas 没有 CSS 高度，它的排版高度由宽高比决定，
 * 缩成 1×1 仍然是 1:1，格子宽度/.boardTile 的高度都不会跳；0 会把它压成一条线。
 * 滚回来时观察器还在盯着这个元素，会再画一次。
 */
function releaseOne(no) {
  const el = previewEls.get(no)
  if (!el || !drawn.has(no)) return
  el.width = 1
  el.height = 1
  drawn.delete(no)
}

function drawPreviews() {
  if (!layout.value || !hasPattern.value) return
  /* 布局或图案变了：已经画过（也就是还在屏幕里）的重画，其余等它自己进视口 */
  for (const no of [...drawn]) drawOne(no)
}

/* 每块板的材料明细：1225 块板 × 每块几十个色号标签 = 几万个 DOM 节点，
   一次性渲染会卡住整页，所以默认只画一块板，用板号导航切换（见模板）。 */
const BOARD_DETAIL_FULL_MAX = 200
const detailMode = ref('all')
const detailNo = ref(1)
const detailNoInput = ref('1')
const confirmExpand = ref(false)

/** 单块板的明细：色号列表在这里算一次，模板不再对同一块板调两遍 boardMaterials */
const detailRow = computed(() => {
  const p = pattern.value
  const lay = layout.value
  if (!p || !lay) return null
  const b = lay.boards[detailNo.value - 1]
  if (!b) return null
  return { b, beads: beadsOfBoard(b), mats: boardMaterials(p, b, inventory.value) }
})

/** 展开全部时才求值（computed 是惰性的：不渲染这一支就不会算 1225 次） */
const allBoardRows = computed(() => {
  const p = pattern.value
  const lay = layout.value
  if (!p || !lay) return []
  return lay.boards.map(b => ({ b, beads: beadsOfBoard(b), mats: boardMaterials(p, b, inventory.value) }))
})

function goDetailBoard(no) {
  const count = layout.value ? layout.value.count : 0
  detailNo.value = Math.max(1, Math.min(count, Number(no) || 1))
  detailNoInput.value = String(detailNo.value)
  confirmExpand.value = false
}

function jumpDetailBoard() {
  goDetailBoard(parseInt(String(detailNoInput.value).replace(/\D/g, ''), 10) || 1)
}

/** 展开全部是「明知会卡还是要点」的操作，先摆出代价再执行 */
function askExpandAll() {
  confirmExpand.value = true
}

function expandAllDetail() {
  detailMode.value = 'all'
  confirmExpand.value = false
}

function collapseDetail() {
  detailMode.value = 'single'
  confirmExpand.value = false
}

onMounted(async () => {
  boardIo = new IntersectionObserver(entries => {
    for (const e of entries) {
      const no = Number(e.target.dataset.boardNo)
      if (!no) continue
      /* 不再 unobserve：以前画完就取消观察，于是缩略图一旦画出来就永久占着内存，
         滚出屏幕也回收不掉。留着观察才能同时收到「进视口」和「出视口」。 */
      if (e.isIntersecting) drawOne(no)
      else releaseOne(no)
    }
  }, { rootMargin: '200px' })
  /* ref 回调在 onMounted 之前就会跑，所以这里补观察一遍已经拿到的元素 */
  for (const el of previewEls.values()) boardIo.observe(el)

  const id = route.params.projectId
  if (id) ensureProjectLoaded(id)
  await nextTick()
  drawPreviews()
  syncDetailMode()
  /* 默认选第一批（不超过打印页数上限的那一批），见 selectBatch 的说明 */
  selectBatch(1)
})

onUnmounted(() => boardIo?.disconnect())

/**
 * 板数跨过阈值就换默认呈现方式：≤ 200 块一次列完（和以前一样），
 * 再多就默认只展开一块 —— 1225 块板 × 每块几十个色号标签 = 几万个 DOM 节点，
 * 直接渲染会让页面卡住。
 * 板号只做夹取、不重置：用户可能只是改了一格图案，不该把他在看的板号弹回去。
 */
let lastBoardCount = -1
function syncDetailMode() {
  const count = layout.value ? layout.value.count : 0
  if (count === lastBoardCount) {
    if (detailNo.value > count) goDetailBoard(1)
    return
  }
  lastBoardCount = count
  detailMode.value = count > BOARD_DETAIL_FULL_MAX ? 'single' : 'all'
  confirmExpand.value = false
  if (detailNo.value > count || detailNo.value < 1) goDetailBoard(1)
  else detailNoInput.value = String(detailNo.value)
}

watch([pattern, layout], () => {
  /* 不清理 drawn：图案变了，已经画出来的缩略图必须跟着重画（否则停在旧图纸上）；
     还没画过的仍然留在观察器里，等滚到眼前再画。 */
  nextTick(() => {
    drawPreviews()
    syncDetailMode()
  })
})
watch(() => route.params.projectId, id => {
  if (id) ensureProjectLoaded(id)
})

function toggleBoard(no) {
  const next = new Set(selectedBoards.value)
  if (next.has(no)) next.delete(no)
  else next.add(no)
  selectedBoards.value = next
}

function selectAllBoards() {
  if (!layout.value) return
  selectedBoards.value = new Set(layout.value.boards.map(b => b.no))
}

/* ------------------------------------------------------- 分板打印的「批次」
   为什么需要：分板 PDF 一页一块板，而页数上限是内存算出来的 256 页（PRINT_MAX_BOARDS）。
   1000×1000 = 1225 块板 = 1225 页，全选必然被拒绝 —— 但**分批打完全可行**（5 批）。
   所以：默认只选第一批（而不是全选），并给一个批次切换器。
   为什么默认不干脆全选：全选会让打印预检一打开就是红的「会先被拒绝」，
   用户什么都没做就先收到一个错误；而"先打印第 1–256 块"是立刻可用的。
   为什么还留「全选」按钮：用户可能确实想一次看完 1225 块的材料清单（那不是打印）。 */
const batchSize = PRINT_MAX_BOARDS
const batchCount = computed(() => (layout.value ? Math.max(1, Math.ceil(layout.value.count / batchSize)) : 1))

/**
 * 1:1 打印的纸幅判断。
 *
 * 为什么必须算：板上图纸的每一页是「一块板的整图 + 四边标尺」，纸面宽度 = 格数 × 豆径 + 两边标尺。
 * 2.6mm 小豆下 52 格板只有约 14.4 cm（A4 竖版放得下），而 **104 格板是约 27.9 cm** —— 比 A4 竖版
 * 可打印的 19 cm 宽得多，连 A4 横版的 27.7 cm 也差一点。以前那句「每块板单独一页保证 1:1 可用」
 * 是 29 格 + 5mm 时代的经验（约 15.4 cm），现在必须按实际板宽如实报出来。
 * 标尺宽度取 render.js 的 R = max(14, round(cell × 1.7)) 两个（典型 cell 12~24 → 共 8~9 mm），
 * 取 9 mm 这个常见值；阈值按各纸型去掉 10 mm 页边距后的可打印宽度算。
 */
const printPaper = computed(() => {
  const lay = layout.value
  if (!lay || !stats.value) return { ok: true, boardCells: 0, pageMm: 0, paper: 'A4 竖版' }
  const boardCells = Math.max(lay.boardSize.x, lay.boardSize.y)
  const pageMm = boardCells * bead.value.mm + 9
  const paper = pageMm <= 190 ? 'A4 竖版' : pageMm <= 277 ? 'A4 横版' : pageMm <= 400 ? 'A3 横版' : ''
  return { ok: !!paper, boardCells, pageMm, paper }
})

const batchNo = ref(1)

/** 选中第 i 批（1 起）：只选这一批，避免"选了三批 = 768 页"这种必然被拒绝的组合 */
function selectBatch(i) {
  const lay = layout.value
  if (!lay) return
  const n = Math.max(1, Math.min(batchCount.value, Math.round(Number(i)) || 1))
  batchNo.value = n
  const from = (n - 1) * batchSize
  selectedBoards.value = new Set(lay.boards.slice(from, from + batchSize).map(b => b.no))
}
/** 用户点了「全选」之后批次号就不再代表选中的内容，这里只是别让输入框停在误导的位置 */
function onBatchInput(e) {
  selectBatch(e && e.target ? e.target.value : 1)
}

function clearBoards() {
  selectedBoards.value = new Set()
}

const selectedIndexes = computed(() => {
  if (!layout.value) return []
  return layout.value.boards.filter(b => selectedBoards.value.has(b.no)).map(b => b.index)
})

/**
 * 打印预检：调的是 exporters 的 printPlan —— 和真正点「打开打印窗口」时同一套判断，
 * 所以这里说的页数、上限、拒绝原因跟真点下去完全一致（1000×1000 是 1225 页 > 256 页）。
 * 一块也没选时不显示：那种情况下按钮本来就是禁用的，而 printPlan 会把空数组当成
 * 「没指定板号 = 全部板」，两句话自相矛盾。
 */
const printPrecheck = computed(() => {
  if (!hasPattern.value || !selectedBoards.value.size) return null
  return printPlan(pattern.value, { boardIndexes: selectedIndexes.value })
})

/** 只统计选中板的材料用量 */
const selectedMaterials = computed(() => {
  const p = pattern.value
  const lay = layout.value
  if (!p || !lay) return null
  /* 全选 = 整张图纸：「全部板逐格扫一遍」在这一档是 1225 × 841 ≈ 100 万次循环，
     而结果和 useStudio 缓存好的全图统计（materials）逐字相同 —— 直接复用，
     点缩略图切选时就不会每次都白扫 100 万格。
     只选了一部分时才逐格统计（选区不大时这点开销看不出来）。 */
  if (selectedBoards.value.size >= lay.count && materials.value) {
    const rows = materials.value.rows
    return {
      rows,
      beads: materials.value.totalBeads,
      lack: materials.value.totalLack,
      colors: rows.length
    }
  }
  const counts = new Map()
  for (const b of lay.boards) {
    if (!selectedBoards.value.has(b.no)) continue
    for (let y = b.y0; y < b.y0 + b.h; y++) {
      for (let x = b.x0; x < b.x0 + b.w; x++) {
        const c = p.palette[p.cells[y * p.width + x]]
        if (!c) continue
        const e = counts.get(c.id) || { color: c, count: 0 }
        e.count++
        counts.set(c.id, e)
      }
    }
  }
  const rows = [...counts.values()]
    .map(({ color, count }) => {
      const owned = Number(inventory.value[color.id] || 0)
      const lack = Math.max(0, count - owned)
      return {
        id: color.id, code: color.code, hex: color.hex,
        name: color.name !== color.code ? color.name : '',
        count, owned, lack
      }
    })
    .sort((a, b) => b.count - a.count)
  return {
    rows,
    beads: rows.reduce((s, r) => s + r.count, 0),
    lack: rows.reduce((s, r) => s + r.lack, 0),
    colors: rows.length
  }
})

function gate(feature, reason) {
  const g = check(feature)
  if (!g.ok) {
    toastWarn(g.reason || reason)
    return false
  }
  return true
}

function onCSV() {
  if (!hasPattern.value) return toastWarn('先生成一张图纸')
  if (!gate('export.csv')) return
  exportMaterialsCSV(pattern.value, inventory.value, projectName.value)
  toastOk('材料清单 CSV 已导出')
}

function onPrint() {
  if (!hasPattern.value) return toastWarn('先生成一张图纸')
  if (!gate('export.pdf')) return
  const res = printPattern(pattern.value, {
    projectName: projectName.value,
    boardIndexes: selectedIndexes.value,
    inventoryMap: inventory.value,
    stats: stats.value,
    brandName: brand.value.name,
    includeCover: true,
    includeMaterials: true
  })
  printDialog.value = false
  // printPattern 会回传「出几页 / 每板多少像素」，页数超上限时压根没生成 —— 必须说出来，
  // 不能让用户对着没打开的窗口干等（以前这里无条件报「已打开打印窗口」）
  toastResult(res, '已打开打印窗口，选择「保存为 PDF」即可')
}

async function onCopy() {
  if (!hasPattern.value) return
  const res = await copyShoppingList(pattern.value, inventory.value, projectName.value)
  toastOk(res.ok ? '采购清单已复制' : '复制失败，请改用 CSV')
}

function onSVG() {
  if (!hasPattern.value || !gate('export.svg')) return
  // 大画布的 SVG 可能被丢掉色号、甚至直接拒绝：结果里有确切体积和原因，照实说
  toastResult(exportSVG(pattern.value, { projectName: projectName.value, cell: 12 }))
}

function onJSON() {
  if (!hasPattern.value) return
  // JSON 在 1000 格下是 10 MB 量级的文本，体积必须报出来（不然用户以为按钮没反应）
  toastResult(exportPatternJSON(pattern.value, projectName.value))
}

function onPNG() {
  if (!hasPattern.value || !gate('export.png')) return
  // 大画布会降每格像素：实际导出多少像素必须让用户知道（1:1 打印要靠它做判断）
  toastResult(exportPatternPNG(pattern.value, { projectName: projectName.value, cell: 24, codes: options.numbering }))
}
</script>

<template>
  <div class="wrap main--pad">
    <div v-if="!hasPattern" class="empty">
      <div class="empty__icon"><PixelIcon name="list" :size="24" /></div>
      <strong>还没有可统计的图案</strong>
      <p>先上传照片或从素材中心挑一个图案，材料清单会自动按图纸逐格统计。</p>
      <div class="row" style="gap:9px">
        <RouterLink to="/editor" class="btn primary">去创作</RouterLink>
        <RouterLink v-if="projects.length" to="/projects" class="btn btn-secondary">打开已有作品</RouterLink>
      </div>
    </div>

    <template v-else>
      <div class="pagehead">
        <div>
          <h1>材料与分板</h1>
          <p>
            {{ projectName }} ·
            {{ stats.size }} 格 · {{ stats.colors }} 色 · {{ num(stats.total) }} 颗 ·
            成品 {{ stats.cm }} · 预计 {{ formatDuration(stats.minutes) }}
          </p>
        </div>
        <div class="row row--wrap">
          <button class="btn btn-secondary" @click="onCSV">材料 CSV</button>
          <button class="btn primary" @click="printDialog = true">打印 / 分板 PDF</button>
          <button class="btn soft" @click="onCopy">复制采购清单</button>
        </div>
      </div>

      <!-- 库存概览 -->
      <div class="summaryRow">
        <div class="summaryCard">
          <span class="muted">需要</span>
          <b>{{ num(short.totalBeads) }} 颗</b>
          <span class="hint">{{ short.colorCount }} 种颜色</span>
        </div>
        <div class="summaryCard">
          <span class="muted">已拥有</span>
          <b>{{ num(short.totalBeads - short.totalLack) }} 颗</b>
          <span class="hint">按你设置的库存</span>
        </div>
        <div class="summaryCard" :class="{ warn: short.totalLack > 0 }">
          <span class="muted">需补购</span>
          <b>{{ num(short.totalLack) }} 颗</b>
          <span class="hint">
            {{ short.missingCount }} 色完全没有 · {{ short.shortCount }} 色数量不足
          </span>
        </div>
      </div>

      <!-- 分板 -->
      <section class="card" style="margin-top:18px">
        <div class="card__head">
          <h3>自动分板</h3>
          <div class="row">
            <span class="muted">共 {{ layout.count }} 块 · {{ boardsText(pattern.width, pattern.height, layout.boardSize) }}</span>
            <button class="btn btn-secondary sm" @click="selectAllBoards">全选</button>
            <button class="btn btn-secondary sm" @click="clearBoards">清空</button>
          </div>
        </div>
        <div class="card__body">
          <!-- 板数超过打印页数上限时给「批次」入口：一页一块板、上限 256 页，
               1225 块必须分 5 批打完，而默认只选第一批（见 selectBatch 的说明）。
               没有这条，用户只能靠一块一块点，或者被预检的红字堵死。 -->
          <div v-if="batchCount > 1" class="batchBar">
            <span>分 {{ batchCount }} 批打印（一批最多 {{ batchSize }} 页）：</span>
            <button class="btn btn-secondary sm" :disabled="batchNo <= 1" @click="selectBatch(batchNo - 1)">← 上一批</button>
            <label>
              第
              <input
                type="number" inputmode="numeric" min="1" :max="batchCount" :value="batchNo"
                aria-label="第几批" @change="onBatchInput"
              >
              / {{ batchCount }} 批
            </label>
            <button class="btn btn-secondary sm" :disabled="batchNo >= batchCount" @click="selectBatch(batchNo + 1)">下一批 →</button>
            <span class="muted">本批 = 第 {{ (batchNo - 1) * batchSize + 1 }}–{{ Math.min(layout.count, batchNo * batchSize) }} 块</span>
          </div>
          <p class="hint" style="margin-bottom:14px">
            整图 {{ stats.size }} 格 = {{ layout.count }} 块拼板（{{ layout.cols }} 列 × {{ layout.rows }} 行），
            1 格 = {{ bead.mm }} mm（{{ bead.label }}），拼起来成品约 {{ stats.cm }}。
            {{ boardsText(pattern.width, pattern.height, layout.boardSize) }}，同一规格的板并排拼起来是连续的一张网格
            （板与板能不能卡扣以实物为准）；不同珠径的板不能混用。
            打印时每块板单独一页，并带该板的行列坐标与色号，照着拼就行。
            <template v-if="layout.boards.length > 60">共 {{ layout.boards.length }} 块板，缩略图会在你滚到那一块时才绘制、滚出屏幕后释放画布内存（滚动时看到空白格是正常的，稍等一下）。</template>
          </p>
          <div class="boardGrid">
            <button
              v-for="b in layout.boards" :key="b.no"
              class="boardTile" :class="{ on: selectedBoards.has(b.no) }"
              @click="toggleBoard(b.no)"
            >
              <div class="boardTile__no">
                <span>第 {{ b.no }} 板</span>
                <em>{{ b.coord }}</em>
              </div>
              <canvas :ref="el => setPreviewRef(el, b.no)" :data-board-no="b.no" />
              <div class="boardTile__meta">
                <span>{{ b.w }}×{{ b.h }}</span>
                <span>{{ beadsOfBoard(b) }} 颗</span>
              </div>
              <div class="boardTile__check">{{ selectedBoards.has(b.no) ? '已选' : '未选' }}</div>
            </button>
          </div>

          <div v-if="selectedMaterials" class="selectedInfo">
            已选 {{ selectedBoards.size }} 块板，共 {{ num(selectedMaterials.beads) }} 颗 ·
            {{ selectedMaterials.colors }} 色 · 需补 {{ num(selectedMaterials.lack) }} 颗
          </div>
        </div>
      </section>

      <!-- 材料清单 -->
      <section class="card" style="margin-top:18px">
        <div class="card__head">
          <h3>材料清单</h3>
          <div class="row">
            <button class="btn btn-secondary sm" @click="onCSV">导出 CSV</button>
            <button class="btn btn-secondary sm" @click="onCopy">复制清单</button>
          </div>
        </div>
        <div class="card__body">
          <div v-if="short.needRestock" class="alertBox" style="margin-bottom:14px">
            还缺 {{ num(short.totalLack) }} 颗豆。下面是按当前库存算出的补购明细。
          </div>
          <div v-else class="okBox" style="margin-bottom:14px">
            当前库存足够完成这件作品，不需要补购
          </div>

          <div class="tableWrap">
            <table class="table">
              <thead>
                <tr>
                  <th class="swatchCell">色块</th>
                  <th>色号</th>
                  <th>颜色</th>
                  <th class="num">需要</th>
                  <th class="num">已拥有</th>
                  <th class="num">缺少</th>
                  <th>建议规格</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in (restock ? restock.packages : [])" :key="r.id">
                  <td><span class="swatch" :style="{ background: r.hex }"></span></td>
                  <td><b>{{ r.code }}</b></td>
                  <td>{{ r.name || '—' }}</td>
                  <td class="num">{{ num(r.count) }}</td>
                  <td class="num">{{ r.owned ? num(r.owned) : '—' }}</td>
                  <td class="num" :style="r.lack ? 'color:var(--danger);font-weight:800' : ''">{{ r.lack ? num(r.lack) : '—' }}</td>
                  <td><span class="tag">{{ r.suggest }}</span></td>
                </tr>
                <tr v-if="!restock || !restock.packages.length">
                  <td colspan="7" class="muted" style="padding:18px">库存已满足全部颜色，没有需要补购的色号。</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="divider"></div>
          <div class="row row--between row--wrap">
            <div>
              <b style="font-size:var(--fs-xs)">全部颜色的用量</b>
              <p class="hint">不区分库存，按图纸实际用量排序</p>
            </div>
            <span class="muted">{{ materials.rows.length }} 色 · {{ num(materials.totalBeads) }} 颗</span>
          </div>
          <div class="tableWrap" style="margin-top:10px">
            <table class="table">
              <thead>
                <tr><th class="swatchCell">色块</th><th>色号</th><th>颜色</th><th class="num">数量</th><th class="num">占比</th></tr>
              </thead>
              <tbody>
                <tr v-for="m in materials.rows" :key="m.id">
                  <td><span class="swatch" :style="{ background: m.hex }"></span></td>
                  <td>{{ m.code }}</td>
                  <td>{{ m.name || '—' }}</td>
                  <td class="num">{{ num(m.count) }}</td>
                  <td class="num">{{ ((m.count / materials.totalBeads) * 100).toFixed(1) }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 每块板的用量 -->
      <section class="card" style="margin-top:18px">
        <div class="card__head">
          <h3>每块板需要哪些颜色</h3>
          <span class="muted">共 {{ layout.count }} 块 · {{ detailMode === 'all' ? '全部列出' : '按板号查看' }}</span>
        </div>
        <div class="card__body">
          <!-- 1000×1000 时是 1225 块板 × 每块几十个色号标签 ≈ 几万个 DOM 节点，
               一次全渲染会把页面卡死。所以板数超过 BOARD_DETAIL_FULL_MAX 时默认只画一块板，
               想看全部要点一次「展开全部」（会先摆出代价）。板少时行为和以前完全一样。 -->
          <template v-if="detailMode === 'single'">
            <div class="boardNav">
              <button class="btn btn-secondary sm" :disabled="detailNo <= 1" @click="goDetailBoard(detailNo - 1)">← 上一板</button>
              <label class="boardNav__jump">
                第
                <input
                  v-model="detailNoInput" class="boardNav__input" inputmode="numeric" aria-label="板号"
                  @keyup.enter="jumpDetailBoard" @blur="jumpDetailBoard"
                >
                / {{ layout.count }} 块
              </label>
              <button class="btn btn-secondary sm" :disabled="detailNo >= layout.count" @click="goDetailBoard(detailNo + 1)">下一板 →</button>
              <button class="btn sm soft" @click="askExpandAll">展开全部 {{ layout.count }} 块</button>
            </div>
            <p class="hint" style="margin-top:8px">
              共 {{ layout.count }} 块板，这里一次只画一块板的明细：{{ layout.count }} 块全展开会产生几万个色号标签，页面会卡住。
              上面输入板号可以直接跳过去。
            </p>
            <div v-if="confirmExpand" class="alertBox" style="margin-top:10px">
              展开全部 {{ layout.count }} 块板：要一次渲染 {{ layout.count }} 块板的色号标签（每块板几十个，合计几万个），
              浏览器会卡几秒、内存也会明显上涨。确定要展开吗？
              <div class="row" style="gap:8px;margin-top:9px">
                <button class="btn sm primary" @click="expandAllDetail">仍然展开</button>
                <button class="btn btn-secondary sm" @click="confirmExpand = false">取消</button>
              </div>
            </div>
            <div v-if="detailRow" class="boardMatBlock" style="margin-top:12px">
              <div class="row row--between row--wrap">
                <b>第 {{ detailRow.b.no }} 板 · {{ detailRow.b.coord }}</b>
                <span class="muted">{{ detailRow.beads }} 颗 · {{ detailRow.mats.length }} 色</span>
              </div>
              <div class="swatchRow" style="margin-top:8px">
                <span v-for="m in detailRow.mats" :key="m.id" class="swatchPill">
                  <i :style="{ background: m.hex }"></i>{{ m.code }} × {{ m.count }} 颗
                  <b v-if="m.lack > 0" style="color:var(--danger);margin-left:3px">缺 {{ m.lack }} 颗</b>
                </span>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="row row--between row--wrap" style="margin-bottom:4px">
              <p class="hint" style="margin:0">
                已展开全部 {{ layout.count }} 块板的明细（板多时页面会比较卡，看完可以收起来）。
              </p>
              <button v-if="layout.count > BOARD_DETAIL_FULL_MAX" class="btn btn-secondary sm" @click="collapseDetail">只看一块板</button>
            </div>
            <div v-for="row in allBoardRows" :key="row.b.no" class="boardMatBlock">
              <div class="row row--between row--wrap">
                <b>第 {{ row.b.no }} 板 · {{ row.b.coord }}</b>
                <span class="muted">{{ row.beads }} 颗 · {{ row.mats.length }} 色</span>
              </div>
              <div class="swatchRow" style="margin-top:8px">
                <span v-for="m in row.mats" :key="m.id" class="swatchPill">
                  <i :style="{ background: m.hex }"></i>{{ m.code }} × {{ m.count }} 颗
                  <b v-if="m.lack > 0" style="color:var(--danger);margin-left:3px">缺 {{ m.lack }} 颗</b>
                </span>
              </div>
            </div>
          </template>
        </div>
      </section>

      <!-- 其他导出 -->
      <section class="card" style="margin-top:18px">
        <div class="card__head"><h3>其他导出</h3><span class="muted">都与当前图纸数据一致</span></div>
        <div class="card__body">
          <div class="grid-4 keep">
            <button class="btn btn-secondary" @click="onPNG" title="大画布会自动降低每格像素（1000×1000 → 3 px/格），导出后提示实际尺寸">图纸 PNG</button>
            <button class="btn btn-secondary" @click="onSVG" title="可无损放大；估算超过约 16 MB 会先丢掉色号，仍超上限就拒绝（1000×1000 约 57 MB，会直接拒绝并说明该用哪个）">SVG 矢量</button>
            <button class="btn btn-secondary" @click="onJSON" title="结构化网格数据；1000×1000 是 10 MB 量级的文本，导出后会报出真实体积">Pattern JSON</button>
            <!-- 必须带上作品 id：BuildView 靠路由参数装载图案，光跳 /build 会是空页面 -->
            <RouterLink class="btn green" :to="buildLink">去拼制并完成 ›</RouterLink>
          </div>
        </div>
      </section>
    </template>

    <!-- 打印选项 -->
    <BaseDialog v-model="printDialog" title="打印 / 导出分板 PDF" size="sm">
      <div class="stack stack--sm">
        <p style="font-size:var(--fs-xs);line-height:1.8;color:var(--ink-2)">
          将要打印 <b>{{ selectedBoards.size }}</b> 块板，每块板单独一页，含行列坐标与格内色号，
          最后一页是材料清单。纸张请选 A4，「实际大小 / 100%」。
        </p>
        <div class="field">
          <label>包含内容</label>
          <div class="row row--wrap">
            <span class="tag free">封面页</span>
            <span class="tag free">每板一页</span>
            <span class="tag free">材料清单页</span>
          </div>
        </div>
        <div class="boardInfo">
          1 格 = 1 颗豆 = {{ bead.mm }} mm（{{ bead.label }}）。整张图纸实际尺寸 {{ stats.cm }}。
          <template v-if="printPaper.ok">
            一块 {{ printPaper.boardCells }} 格板在纸上约 {{ (printPaper.pageMm / 10).toFixed(1) }} cm 宽，按 100% 打印刚好放得进 <b>{{ printPaper.paper }}</b>（每格在纸上正好 {{ bead.mm }} mm）。
          </template>
          <template v-else>
            一块 {{ printPaper.boardCells }} 格板在纸上约 {{ (printPaper.pageMm / 10).toFixed(1) }} cm 宽，<b>比 A4 还宽</b>（A4 竖版可打印约 19 cm、横版约 27.7 cm）：1:1 请用 A3 或按纸幅分条打印，或者换小一档画布。
          </template>
          选中的板多（超过 64 页）时，每板图的分辨率会自动下调，格子和色号在纸上仍然按 {{ bead.mm }} mm 排布。
        </div>
        <!-- 预检用的是 exporters 的 printPlan（和真正点「打开打印窗口」时同一套判断），
             1000×1000 的 1225 块板在这里就会说清「多少页 > 256 页上限、为什么、怎么办」，
             不用等用户点了按钮才在 toast 里看到失败 -->
        <div v-if="printPrecheck" class="boardInfo" :class="{ bad: !printPrecheck.ok }">
          {{ printPrecheck.message }}
        </div>
      </div>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">取消</button>
        <!-- 预检不通过时按钮照样能点：点下去会拿到 exporters 原样的拒绝理由（toast），
             比默默禁用更能解释清楚为什么不能打 -->
        <button class="btn primary" :disabled="!selectedBoards.size" @click="onPrint">
          {{ printPrecheck && !printPrecheck.ok ? '打开打印窗口（会先被拒绝）' : '打开打印窗口' }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.summaryRow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
.summaryCard{
  padding:15px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line);
  display:flex;flex-direction:column;gap:4px;box-shadow:var(--sh-1);
}
.summaryCard b{font-size:22px;font-weight:850;letter-spacing:-.02em}
.summaryCard.warn{border-color:#F3C9C4;background:var(--danger-soft)}
.summaryCard.warn b{color:var(--danger)}
.boardTile{position:relative}
.boardTile__check{
  margin-top:6px;font-size:var(--fs-2xs);font-weight:800;color:var(--muted-2);text-align:center;
}
.boardTile.on .boardTile__check{color:var(--green-deep)}
.selectedInfo{
  margin-top:14px;padding:11px;border-radius:var(--r-sm);background:var(--green-soft);
  border:1px solid #D3E6CD;font-size:var(--fs-xs);color:var(--green-deep);font-weight:700;
}
.alertBox{padding:12px;border-radius:var(--r-sm);background:var(--danger-soft);color:var(--danger);font-size:var(--fs-xs);font-weight:700}
.okBox{padding:12px;border-radius:var(--r-sm);background:var(--green-soft);color:var(--green-deep);font-size:var(--fs-xs);font-weight:700}
.boardInfo{padding:11px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-2xs);color:var(--muted);line-height:1.75}
.boardInfo.bad{border-color:#F3C9C4;background:var(--danger-soft);color:var(--danger);font-weight:700}
/* 板号导航：1225 块板的明细一次只画一块，靠这四个控件换板 */
.boardNav{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.boardNav__jump{font-size:var(--fs-2xs);color:var(--muted);font-weight:700;display:inline-flex;align-items:center;gap:5px}
.boardNav__input{
  width:74px;padding:5px 8px;border-radius:var(--r-xs);border:1px solid transparent;
  background:var(--surface-3);font:inherit;font-size:var(--fs-2xs);font-weight:800;text-align:center;color:var(--ink);
}
.boardNav__input:focus{outline:none;border-color:var(--pink);background:var(--surface);box-shadow:0 0 0 3px rgba(255,142,199,.18)}
/* 分板打印的批次条：板数超过 256 页上限时才出现（1000×1000 = 1225 块 = 5 批）。
   和 .boardNav 同一套视觉，用中性底色表示「这是操作区而不是警告」。 */
.batchBar{
  display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 12px;
  padding:9px 11px;border-radius:var(--r-sm);background:var(--surface-2);
  border:1px solid var(--line);font-size:var(--fs-2xs);font-weight:700;color:var(--muted);
}
.batchBar label{display:inline-flex;align-items:center;gap:4px}
.batchBar input{
  width:58px;padding:4px 6px;border-radius:var(--r-xs);border:1px solid transparent;
  background:var(--surface-3);font:inherit;font-size:var(--fs-2xs);font-weight:800;text-align:center;color:var(--ink);
}
.batchBar input:focus{outline:none;border-color:var(--pink);background:var(--surface);box-shadow:0 0 0 3px rgba(255,142,199,.18)}
.boardMatBlock{padding:12px 0;border-bottom:1px solid var(--line)}
.boardMatBlock:last-child{border-bottom:0;padding-bottom:0}
@media(max-width:900px){.summaryRow{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
