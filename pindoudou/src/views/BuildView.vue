<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import BaseDialog from '../components/ui/BaseDialog.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import {
  pattern, hasPattern, projectName, stats, layout, options, materials,
  buildProgress, buildBoard, buildStats, buildBoards, toggleBuildCell, markBuildCell,
  markBoard, markColor, clearBuild, persistBuildProgress, currentProjectId,
  openProject, ensureProjectLoaded, projects, saveProject, sourceImg, brand,
  finishProject, unfinishProject, finishPlan, isFinished, finishedAt, finishPhoto, finishStale,
  currentProject, photoToStoredUrl, loadImageFromUrl, attachFinishPhoto
} from '../composables/useStudio.js'
import { inventory, shortageOf } from '../composables/useInventory.js'
import { check } from '../composables/useMembership.js'
import { toastOk, toastWarn, toastResult } from '../composables/useToast.js'
import { drawBoard, drawPixels } from '../lib/render.js'
import { boardMaterials } from '../lib/pattern.js'
import { formatDuration, num, timeAgo } from '../lib/forge.js'
import { exportShareCard, exportPatternPNG } from '../lib/exporters.js'
import logoDouwan from '../assets/logo-douwan.webp'

const route = useRoute()
const router = useRouter()

const cv = ref(null)
const stageEl = ref(null)
const proOpen = ref(false)
const shareOpen = ref(false)
const dragMode = ref(true)   // true = 标记完成，false = 取消标记
const painting = ref(false)

/* 完成作品的弹窗：确认前先说清「要扣多少库存 / 还缺多少」，
   并且允许顺手传一张成品照片（分享卡第三格会用它）。 */
const finishOpen = ref(false)
const photoInput = ref(null)
const photoUrl = ref('')
const photoBusy = ref(false)
const photoErr = ref('')
const finishing = ref(false)

/**
 * 「逐颗 / 整板标记进度」是 Pro 权益；**完成作品**不是。
 * 免费版也能打开 Build Mode 看图纸、并直接把整件作品标记为完成 ——
 * 否则顶栏第三步「完成」对免费用户是个永远到不了的死步骤。
 */
const gate = computed(() => check('build.mode'))
/** 已经是完成状态时，逐颗进度就没有意义了（进度本来就是满的） */
const progressLocked = computed(() => !gate.value.ok || isFinished.value)
/** 完成弹窗在「已完成后补照片」时的形态：只换照片，不再重复结算库存 */
const photoOnly = computed(() => isFinished.value)

/* ---------------------------------------------------------------- 板列表 / 进度快照

   画布上限 1000 格 = 35×35 = 1225 块板，这里有两件事必须处理，否则拖动标记会卡到没法用：

   ① 板列表不能一次渲染 1225 行。每标记一格 buildProgress 就换一次引用，1250 行的列表
      每次都要 patch 一遍。这里只画当前板附近的 BOARD_LIST_WINDOW 块，配「上/下一组」和
      板号跳转 —— 选板能力一分不少，DOM 数量固定。

   ② 进度数字也不该每一格都重算一遍：useStudio 的 buildStats / buildBoards 已经改成
      「只遍历进度集合 + 每块板的豆数按 pattern 缓存」（O(已标记数)，不是 O(100 万格)）。
      这一层「快照 + 节流」保的是**列表 patch** 的成本（buildProgress 每标记一格换一次引用）。
      拖动期间最多每 PROGRESS_SYNC_MS 对齐一次，松手 / 点按钮立刻对齐；快照就是那两个
      computed 的真实值，只是刷新得晚一点 —— 最多滞后 200ms，不会算错。 */
const BOARD_LIST_WINDOW = 60
const PROGRESS_SYNC_MS = 200

const boardCount = computed(() => (layout.value ? layout.value.count : 0))
const boardListStart = ref(0)
const boardNoInput = ref('1')

const viewStats = ref({ total: 0, done: 0, percent: 0, remaining: 0, complete: false })
const viewBoards = shallowRef([])
let syncTimer = 0

function syncProgressNow() {
  viewStats.value = buildStats.value
  viewBoards.value = buildBoards.value
  keepBoardInWindow()
}

/** now=true 立刻对齐（松手、点按钮、换作品）；否则节流对齐（拖动中） */
function syncProgress(now = false) {
  if (now) {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = 0 }
    syncProgressNow()
    return
  }
  if (syncTimer) return
  syncTimer = setTimeout(() => { syncTimer = 0; syncProgressNow() }, PROGRESS_SYNC_MS)
}

/** 视图里的「板」一律来自快照：它和 buildBoards 的元素结构完全一样，只有进度数字会滞后 */
const currentBoard = computed(() => viewBoards.value[buildBoard.value] || viewBoards.value[0] || null)

/** 当前窗口里的板（板少时就是全部，行为和以前一样） */
const boardRows = computed(() => {
  const all = viewBoards.value
  if (all.length <= BOARD_LIST_WINDOW) return all.map((b, i) => ({ b, i }))
  const start = boardListStart.value
  const end = Math.min(all.length, start + BOARD_LIST_WINDOW)
  const rows = []
  for (let i = start; i < end; i++) rows.push({ b: all[i], i })
  return rows
})

/** 让当前板落在窗口里：换板、跳转、列表刷新之后都要对一次 */
function keepBoardInWindow() {
  const count = viewBoards.value.length
  if (count <= BOARD_LIST_WINDOW) {
    boardListStart.value = 0
    return
  }
  const i = buildBoard.value
  if (i < boardListStart.value || i >= boardListStart.value + BOARD_LIST_WINDOW) {
    boardListStart.value = Math.max(0, Math.min(count - BOARD_LIST_WINDOW, i - Math.floor(BOARD_LIST_WINDOW / 2)))
  }
}

/** 上/下一组：只挪窗口，不换当前板，所以不会触发任何重绘 */
function stepBoardWindow(dir) {
  const count = boardCount.value
  const maxStart = Math.max(0, count - BOARD_LIST_WINDOW)
  boardListStart.value = Math.max(0, Math.min(maxStart, boardListStart.value + dir * BOARD_LIST_WINDOW))
}

function jumpToBoard() {
  const n = parseInt(String(boardNoInput.value).replace(/\D/g, ''), 10)
  if (!n) {
    boardNoInput.value = String(buildBoard.value + 1)
    return
  }
  goBoard(Math.max(0, Math.min(Math.max(0, boardCount.value - 1), n - 1)))
}

/** 视图里只显示当前板的格子，缩放跟随 options */
const cellPx = ref(16)
const zoom = ref(1)

const drawOpts = computed(() => ({
  cell: Math.max(6, Math.round(cellPx.value * zoom.value)),
  codes: options.numbering,
  ruler: true,
  doneSet: buildProgress.value
  /* 这里不需要分板规格：drawBoard 只画**一块板**（board.w/h 已经是从 layout 切好的实际格数），
     板边线是整图视图的事（render.js 的 drawChart 按 pattern.boardSize 画）。 */
}))

function draw() {
  if (!cv.value || !currentBoard.value || !pattern.value) return
  drawBoard(cv.value, pattern.value, currentBoard.value, drawOpts.value)
}

function redraw() {
  nextTick(draw)
}

/* 重绘只看「换板 / 标记 / 缩放 / 色号开关」这四件事。
   不能盯 currentBoard：它是节流快照里的对象，每 200ms 对齐一次就会换一次引用，
   盯它等于每 200ms 白重绘一次当前板。 */
watch([() => buildBoard.value, buildProgress, zoom, () => options.numbering], redraw)
/* 换作品 / 换画布尺寸：立刻对齐一次快照（总数、每板进度、板号都要跟着换）。
   buildBoard 是模块级的：从 1000×1000（1225 块）切到 116×116（16 块）时它会越界，
   越界后「本板完成」会拿不到板（markBoard 里 boards[idx] 是 undefined），所以这里夹回第一块。 */
watch([pattern, layout], () => {
  if (buildBoard.value >= boardCount.value) buildBoard.value = 0
  syncProgress(true)
  boardNoInput.value = String(buildBoard.value + 1)
})

onMounted(async () => {
  const id = route.params.projectId
  if (id) ensureProjectLoaded(id)
  await nextTick()
  syncProgress(true)
  boardNoInput.value = String(buildBoard.value + 1)
  fitCell()
  draw()
  /* ?finish=1：从工作台 / 作品详情页的「我已经拼完了」直接进来，
     打开完成弹窗，不用先在页面上找按钮。
     这里不再默认弹 Pro 对话框 —— 免费用户本来就到不了第三步之外的东西，
     一进来就是一堵墙，等于告诉用户「这一步跟你没关系」。 */
  if (route.query.finish != null && hasPattern.value) openFinish()
})

/** Pro 拦截：只有「逐颗 / 整板进度」这一个功能需要升级 */
function needBuildPro() {
  if (gate.value.ok) return false
  proOpen.value = true
  return true
}

/* ---------------------------------------------------------------- 完成作品 */

function openFinish() {
  if (!hasPattern.value) return
  photoUrl.value = finishPhoto.value || ''
  photoErr.value = ''
  photoBusy.value = false
  finishOpen.value = true
}

async function onPhotoPick(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  photoBusy.value = true
  photoErr.value = ''
  try {
    photoUrl.value = await photoToStoredUrl(f)
  } catch (err) {
    photoErr.value = (err && err.message) || '照片读取失败'
  } finally {
    photoBusy.value = false
    if (photoInput.value) photoInput.value.value = ''
  }
}

function clearPhoto() {
  photoUrl.value = ''
  photoErr.value = ''
}

/** 已完成后只是补 / 换照片：不动库存，也不改完成时间 */
function savePhotoOnly() {
  if (photoBusy.value) return
  if (attachFinishPhoto(photoUrl.value)) {
    toastOk(photoUrl.value ? '成品照片已更新，分享卡第三格会用它' : '已移除成品照片')
    finishOpen.value = false
  }
}

function doFinish() {
  if (photoOnly.value) { savePhotoOnly(); return }
  if (photoBusy.value || finishing.value) return
  finishing.value = true
  try {
    const res = finishProject({ photo: photoUrl.value })
    if (res && res.ok) finishOpen.value = false
  } finally {
    finishing.value = false
  }
}

function doUnfinish() {
  unfinishProject()
}

onBeforeUnmount(() => persistBuildProgress())

/** 让当前板刚好铺满舞台 */
function fitCell() {
  const stage = stageEl.value
  const b = currentBoard.value
  if (!stage || !b) return
  const availW = stage.clientWidth - 60
  const availH = stage.clientHeight - 60
  const want = Math.min(availW / (b.w + 3.4), availH / (b.h + 3.4))
  cellPx.value = Math.max(6, Math.min(30, want))
}

/* ---------------------------------------------------------------- 交互 */

function hit(e, el, board, opts) {
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const R = opts.ruler ? Math.max(14, Math.round(opts.cell * 1.7)) : 0
  // canvas 的 CSS 尺寸里含标尺，用 CSS 尺寸与屏幕尺寸的比例换算点击位置
  const cssW = parseFloat(el.style.width) || rect.width
  const cssH = parseFloat(el.style.height) || rect.height
  const sx = cssW / rect.width
  const sy = cssH / rect.height
  const x = Math.floor(((e.clientX - rect.left) * sx - R) / opts.cell)
  const y = Math.floor(((e.clientY - rect.top) * sy - R) / opts.cell)
  if (x < 0 || y < 0 || x >= board.w || y >= board.h) return null
  const index = (board.y0 + y) * pattern.value.width + (board.x0 + x)
  // 空格不用拼，点它没有任何意义（否则进度里会多出"不需要拼的已完成格"）
  if (pattern.value.cells[index] < 0) return null
  return { x, y, index }
}

function apply(e) {
  if (progressLocked.value) return
  const el = cv.value
  const b = currentBoard.value
  if (!el || !b) return
  const h = hit(e, el, b, drawOpts.value)
  if (!h) return
  markBuildCell(h.index, dragMode.value)
}

function onPointerDown(e) {
  if (progressLocked.value) {
    // 已完成的作品再点画布不该弹「升级 Pro」——它只是没有可标的进度了
    if (!isFinished.value) needBuildPro()
    return
  }
  e.preventDefault()
  painting.value = true
  const el = cv.value
  const b = currentBoard.value
  if (!el || !b) return
  const h = hit(e, el, b, drawOpts.value)
  if (h) {
    // 按点击后是否已完成为准决定本次拖动的方向，手感更自然
    dragMode.value = !buildProgress.value.has(h.index)
    markBuildCell(h.index, dragMode.value)
  }
  try {
    el.setPointerCapture?.(e.pointerId)
  } catch {
    /* 合成事件 / 指针已经抬起时没有活动指针；拖动本身不依赖捕获 */
  }
}

function onPointerMove(e) {
  if (!painting.value) return
  apply(e)
}

function onPointerUp(e) {
  painting.value = false
  const el = cv.value
  if (el && e && e.pointerId != null) {
    try {
      el.releasePointerCapture?.(e.pointerId)
    } catch {
      /* 没有捕获成功时释放会抛错，忽略即可 */
    }
  }
  persistBuildProgress()
  // 松手是一次拖动批次结束：立刻把进度快照对齐，别让进度条停在 200ms 前
  syncProgress(true)
}

/* ---------------------------------------------------------------- 操作 */

function doMarkBoard(done) {
  if (needBuildPro()) return
  markBoard(buildBoard.value, done)
  persistBuildProgress()
  syncProgress(true)
  toastOk(done ? `第 ${currentBoard.value.no} 板已标记完成` : `第 ${currentBoard.value.no} 板已清空`)
}

/* 点一个色号是「把这个颜色在整张图纸上的豆子全部标记 / 取消」——
   useStudio 的 markColor 会扫完全部 cells（1000×1000 = 100 万格），
   1000 格下一个色号可能有十几万颗、跨 1225 块板。这种「一次全标完」的动作
   不能点下去就闷头跑：先报出颗数与代价让用户确认，跑的时候给出「处理中」状态。 */
const MARK_COLOR_CONFIRM_BEADS = 20000
const colorConfirm = ref(false)
const colorPending = ref(null) // { id, code, count, done }
const markBusy = ref(false)

/** 这个色号在**整张图纸**上有多少颗（materials 是 useStudio 里的全图统计，是缓存的） */
function colorGlobalCount(colorId) {
  const rows = materials.value ? materials.value.rows : null
  const r = rows && rows.find(x => x.id === colorId)
  return r ? r.count : 0
}

function doMarkColor(colorId, done) {
  if (needBuildPro() || markBusy.value) return
  const count = colorGlobalCount(colorId)
  if (count >= MARK_COLOR_CONFIRM_BEADS) {
    const color = pattern.value ? pattern.value.palette.find(c => c.id === colorId) : null
    colorPending.value = { id: colorId, code: color ? color.code : '', count, done }
    colorConfirm.value = true
    return
  }
  runMarkColor(colorId, done)
}

/** 先让浏览器把「处理中…」画出来，再进那个会扫 100 万格的同步循环 */
function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else nextTick(resolve)
  })
}

async function runMarkColor(colorId, done) {
  if (!colorId) return
  colorConfirm.value = false
  markBusy.value = true
  await nextFrame()
  try {
    markColor(colorId, done)
    persistBuildProgress()
    toastOk(done ? '这个色号已全部标记完成' : '这个色号已取消标记')
  } finally {
    markBusy.value = false
    syncProgress(true)
  }
}

function doClearAll() {
  if (needBuildPro()) return
  clearBuild()
  persistBuildProgress()
  syncProgress(true)
  toastOk('已清空全部拼制进度')
}

function prevBoard() {
  goBoard(Math.max(0, buildBoard.value - 1))
}
function nextBoard() {
  goBoard(Math.min(Math.max(0, boardCount.value - 1), buildBoard.value + 1))
}

/** 换板：只重画当前板那一张 canvas（841 格），不碰板列表以外的东西 */
function goBoard(i) {
  const count = boardCount.value
  buildBoard.value = Math.max(0, Math.min(Math.max(0, count - 1), i))
  boardNoInput.value = String(buildBoard.value + 1)
  keepBoardInWindow()
  nextTick(() => { fitCell(); draw() })
}

/* ---------------------------------------------------------------- 剩余颜色 */

const boardNeed = computed(() => {
  const p = pattern.value
  const b = currentBoard.value
  if (!p || !b) return []
  const map = new Map()
  for (let y = b.y0; y < b.y0 + b.h; y++) {
    for (let x = b.x0; x < b.x0 + b.w; x++) {
      const gi = y * p.width + x
      const c = p.palette[p.cells[gi]]
      if (!c) continue
      const e = map.get(c.id) || { color: c, total: 0, done: 0 }
      e.total++
      if (buildProgress.value.has(gi)) e.done++
      map.set(c.id, e)
    }
  }
  return [...map.values()]
    .map(e => ({ ...e, remain: e.total - e.done }))
    .sort((a, b2) => b2.remain - a.remain)
})

const short = computed(() => (hasPattern.value ? shortageOf(pattern.value) : null))

/** 完成时实际从库存扣掉的颗数（取消完成会原样退回） */
const deductedBeads = computed(() => {
  const d = finishDeducted.value
  if (!d) return 0
  return Object.values(d).reduce((s, n) => s + (Number(n) || 0), 0)
})

/* ---------------------------------------------------------------- 分享 */

const shareData = computed(() => ({
  projectName: projectName.value,
  sourceImage: sourceImg.value,
  stats: pattern.value ? pattern.value.stats : null,
  brandName: brand.value.name,
  buildPercent: isFinished.value ? 100 : viewStats.value.percent,
  finishedAt: finishedAt.value || 0
}))

/** 打开分享卡弹窗时把预览画出来（弹窗里的 canvas 只有挂载后才存在） */
watch(shareOpen, open => {
  if (!open) return
  nextTick(() => {
    const el = document.getElementById('sharePreview')
    if (el && pattern.value) drawPixels(el, pattern.value, { maxSize: 200 })
  })
})

async function onShare() {
  if (!pattern.value) return
  const g = check('export.share')
  if (!g.ok) { toastWarn(g.reason); return }
  /* 有成品照片就把它画进分享卡的「成品」那一格 ——
     分享卡第三格本来就是留给实物照片的，用户传了照片还显示占位块说不过去。 */
  let finishImage = null
  if (finishPhoto.value) {
    try { finishImage = await loadImageFromUrl(finishPhoto.value) } catch { finishImage = null }
  }
  exportShareCard(pattern.value, { ...shareData.value, finishImage })
  toastOk('分享卡已生成')
}

function onExportPNG() {
  if (!pattern.value) return
  const g = check('export.png')
  if (!g.ok) { toastWarn(g.reason); return }
  /* 精细档下 PNG 会自动降每格像素，实际像素尺寸必须让用户知道（1:1 打印要看它） */
  toastResult(exportPatternPNG(pattern.value, { projectName: projectName.value, cell: 24, codes: options.numbering }))
}

function resetProgress() {
  if (needBuildPro()) return
  clearBuild()
  persistBuildProgress()
  syncProgress(true)
  toastOk('进度已重置')
}

onBeforeUnmount(() => {
  if (syncTimer) clearTimeout(syncTimer)
})
</script>

<template>
  <div class="wrap main--pad">
    <div v-if="!hasPattern" class="empty">
      <div class="empty__icon"><PixelIcon name="sparkles" :size="24" /></div>
      <strong>还没有可以开始拼的作品</strong>
      <p>先生成一张图纸，或者在「我的作品」里打开一件已保存的作品。</p>
      <div class="row" style="gap:9px">
        <RouterLink to="/editor" class="btn primary">去创作</RouterLink>
        <RouterLink v-if="projects.length" to="/projects" class="btn btn-secondary">打开已有作品</RouterLink>
      </div>
    </div>

    <template v-else>
      <!-- 顶部进度 -->
      <div class="buildBar">
        <div class="buildBar__main">
          <div class="buildBar__title">
            <b>{{ projectName }}</b>
            <span class="tag new" v-if="currentBoard && !isFinished">第 {{ currentBoard.no }} / {{ boardCount }} 板</span>
            <span class="tag">{{ stats.size }} · {{ stats.colors }} 色</span>
            <span v-if="isFinished" class="tag free"><PixelIcon name="check" :size="12" /> 已完成</span>
            <span class="tag warn" v-else-if="!gate.ok">逐颗进度需 Pro</span>
          </div>
          <div class="bar"><i :style="{ width: viewStats.percent + '%' }"></i></div>
          <div class="row row--between row--wrap">
            <span class="muted">
              总进度 <b class="buildBig" style="font-size:18px">{{ viewStats.percent }}%</b> ·
              已完成 {{ num(viewStats.done) }} / {{ num(viewStats.total) }} 颗 ·
              剩 {{ num(viewStats.remaining) }} 颗
            </span>
            <span v-if="currentBoard && !isFinished" class="muted">
              本板剩 {{ num(currentBoard.remaining) }} 颗（{{ currentBoard.percent }}%）
            </span>
            <span v-else-if="isFinished" class="muted">
              完成于 {{ timeAgo(finishedAt) }} · 用豆 {{ num(stats.total) }} 颗
            </span>
          </div>
        </div>
        <div class="col" style="gap:8px">
          <button v-if="!isFinished" class="btn primary lg" @click="openFinish">
            <PixelIcon name="check" :size="16" /> 我拼完了 · 完成作品
          </button>
          <template v-else>
            <button class="btn green lg" @click="shareOpen = true">生成分享卡</button>
            <button class="btn btn-secondary sm" @click="openFinish">{{ finishPhoto ? '换成品照片' : '上传成品照片' }}</button>
          </template>
          <button class="btn btn-secondary" :disabled="progressLocked" @click="doMarkBoard(true)">
            <PixelIcon :name="gate.ok ? 'check' : 'lock'" :size="14" />
            {{ gate.ok ? '本板完成' : '本板完成（Pro）' }}
          </button>
          <div class="row" style="gap:6px">
            <button class="btn btn-secondary sm" :disabled="buildBoard <= 0" @click="prevBoard">← 上板</button>
            <button class="btn btn-secondary sm" :disabled="buildBoard >= boardCount - 1" @click="nextBoard">下板 →</button>
          </div>
          <!-- 板号跳转：1225 块板时「下一板」点一千次不现实，直接输板号 -->
          <label class="boardJump">
            跳到第
            <input
              v-model="boardNoInput" class="boardJump__input" inputmode="numeric" aria-label="跳到第几板"
              @keyup.enter="jumpToBoard" @blur="jumpToBoard"
            >
            / {{ boardCount }} 板
          </label>
        </div>
      </div>

      <!-- 免费版说明：逐颗进度要 Pro，但「完成作品」不用升级 -->
      <div v-if="!gate.ok && !isFinished" class="proNote">
        <div>
          <b>逐颗 / 整板标记进度是 Pro 功能</b>
          <p>
            免费版看图纸、挑颜色、导出 PNG 都不受影响；拼完之后点「我拼完了 · 完成作品」，
            一样可以记录完成时间、扣减库存并进入成长记录。
          </p>
        </div>
        <div class="row row--wrap">
          <button class="btn btn-secondary sm" @click="openFinish">直接标记完成</button>
        </div>
      </div>

      <!-- 已完成：完成记录 + 成品照片 + 分享卡 -->
      <div v-if="isFinished" class="celebrate" style="margin-top:16px">
        <h2>完成啦！</h2>
        <p>
          这件作品已完成：共 <b>{{ num(stats.total) }}</b> 颗豆、{{ stats.colors }} 种颜色、{{ stats.size }} 格，
          完成于 {{ timeAgo(finishedAt) }}。
        </p>
        <p v-if="finishDeducted" class="hint">
          已按材料表扣减库存 {{ num(deductedBeads) }} 颗；
          点「取消完成」会把它们原样加回去。
        </p>
        <p v-if="finishStale" class="hint staleHint">
          <PixelIcon name="alert" :size="16" />
          <span>
            完成之后这套图纸又改过（完成时 {{ num(currentProject ? currentProject.completedBeads || 0 : 0) }} 颗，
            现在 {{ num(stats.total) }} 颗）。完成记录不会自动清掉 —— 拼豆是真的用掉了；
            想让记录对上现在的图纸，可以「取消完成」再完成一次。
          </span>
        </p>
        <div class="finishArt">
          <figure>
            <div class="box">
              <img v-if="finishPhoto" :src="finishPhoto" alt="成品照片">
              <span v-else class="muted">还没有成品照片</span>
            </div>
            <figcaption>成品</figcaption>
          </figure>
          <div class="col" style="gap:8px;align-items:flex-start">
            <button class="btn primary" @click="shareOpen = true">生成分享卡</button>
            <button class="btn btn-secondary" @click="openFinish">{{ finishPhoto ? '换一张成品照片' : '上传成品照片' }}</button>
            <RouterLink to="/projects" class="btn btn-secondary">保存到我的作品</RouterLink>
          </div>
        </div>
        <div class="row row--wrap" style="justify-content:center;gap:9px;margin-top:16px">
          <button class="btn btn-secondary sm" @click="doUnfinish">取消完成（库存退回）</button>
          <RouterLink :to="currentProjectId ? `/projects/${currentProjectId}` : '/projects'" class="btn btn-secondary sm">查看作品档案</RouterLink>
        </div>
      </div>

      <!-- 进度满但还没按「完成作品」：Pro 用户逐颗点满会走到这里 -->
      <div v-else-if="viewStats.complete" class="celebrate" style="margin-top:16px">
        <h2>进度 100%</h2>
        <p>最后一颗也标记完了。点下面的按钮把它记成「完成」：会记下完成时间、按材料表扣减库存，并进入成长记录。</p>
        <div class="row" style="justify-content:center;gap:9px;margin-top:16px">
          <button class="btn primary lg" @click="openFinish"><PixelIcon name="check" :size="16" /> 完成作品</button>
        </div>
      </div>

      <div class="buildGrid" style="margin-top:16px">
        <!-- 画布 -->
        <section class="card">
          <div class="card__head">
            <h3 v-if="currentBoard">第 {{ currentBoard.no }} 板 · {{ currentBoard.coord }}</h3>
            <div class="row">
              <button class="btn btn-secondary sm" @click="zoom = Math.max(0.4, zoom - 0.2)">−</button>
              <span class="muted" style="min-width:44px;text-align:center">{{ Math.round(zoom * 100) }}%</span>
              <button class="btn btn-secondary sm" @click="zoom = Math.min(3, zoom + 0.2)">＋</button>
              <button class="btn btn-secondary sm" @click="fitCell(); draw()">适应</button>
            </div>
          </div>
          <div class="card__body">
            <div
              ref="stageEl" class="buildStage"
              @pointerdown="onPointerDown" @pointermove="onPointerMove"
              @pointerup="onPointerUp" @pointercancel="onPointerUp" @pointerleave="onPointerUp"
            >
              <div class="board">
                <canvas ref="cv" />
              </div>
            </div>
            <p class="hint" style="text-align:center;margin-top:10px">
              点击一颗豆 = 标记完成 · 按住拖动可以连续标记 · 已经标记的再点一次可以取消
            </p>
            <p v-if="boardCount > 60" class="hint" style="text-align:center;margin-top:4px">
              共 {{ boardCount }} 块板：用上面的「上板 / 下板」或板号跳转换板，换板只重画当前这一块。
            </p>
            <div class="row row--wrap" style="justify-content:center;margin-top:10px">
              <button class="btn btn-secondary sm" @click="doMarkBoard(false)">清空本板</button>
              <RouterLink class="btn btn-secondary sm" to="/materials">看分板图纸</RouterLink>
              <button class="btn btn-secondary sm" @click="onExportPNG">导出图纸 PNG</button>
            </div>
          </div>
        </section>

        <!-- 侧栏 -->
        <div class="col">
          <section class="card">
            <div class="card__head"><h3>本板剩余颜色</h3><span class="muted">{{ boardNeed.length }} 色</span></div>
            <div class="card__body">
              <div class="buildNeed" :class="{ busy: markBusy }" style="margin-bottom:12px">
                <span
                  v-for="n in boardNeed" :key="n.color.id"
                  class="needPill" :class="{ done: n.remain <= 0 }"
                  :title="`已拼 ${n.done} / ${n.total}，点一下把整张图纸上这个色标记完成`"
                  @click="doMarkColor(n.color.id, n.remain > 0)"
                >
                  <i :style="{ background: n.color.hex }"></i>
                  {{ n.color.code }} × {{ n.remain }}
                  <small v-if="n.remain <= 0"><PixelIcon name="check" :size="10" /></small>
                </span>
              </div>
              <p class="hint">
                点某个色号可以一次标记/取消这个颜色在<b>整张图纸</b>上的全部豆子（跨所有板）。
                <template v-if="markBusy">正在处理，页面会短暂无响应…</template>
                <template v-else-if="boardCount > 200">大画布上有些色号有十几万颗，点之前会先让你确认。</template>
              </p>
              <div class="divider"></div>
              <div class="row row--between">
                <span class="muted">材料是否够用</span>
                <span v-if="short && short.needRestock" class="tag danger">缺 {{ num(short.totalLack) }} 颗</span>
                <span v-else class="tag free">库存充足</span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <h3>全部板进度</h3>
              <span class="muted">{{ boardCount }} 块</span>
            </div>
            <div class="card__body">
              <!-- 1225 块板时列表只画当前附近的 60 行：整列渲染 1225 行、每次标记都 patch 一遍，
                   拖动会明显发涩；这里用「上/下一组 + 板号跳转」保留选板能力 -->
              <div v-if="boardCount > BOARD_LIST_WINDOW" class="boardWindow">
                <button class="btn btn-secondary sm" :disabled="boardListStart <= 0" @click="stepBoardWindow(-1)">← 上一组</button>
                <span class="muted">第 {{ boardListStart + 1 }}–{{ Math.min(boardCount, boardListStart + BOARD_LIST_WINDOW) }} 块</span>
                <button class="btn btn-secondary sm" :disabled="boardListStart + BOARD_LIST_WINDOW >= boardCount" @click="stepBoardWindow(1)">下一组 →</button>
              </div>
              <div class="boardProgressList">
                <button
                  v-for="row in boardRows" :key="row.b.no"
                  class="boardProgressItem" :class="{ on: buildBoard === row.i, full: row.b.percent >= 100 }"
                  @click="goBoard(row.i)"
                >
                  <span class="bpNo">第 {{ row.b.no }} 板</span>
                  <span class="bpBar"><i :style="{ width: row.b.percent + '%' }"></i></span>
                  <span class="bpPct">{{ row.b.percent }}%</span>
                </button>
              </div>
              <p v-if="boardCount > BOARD_LIST_WINDOW" class="hint" style="margin-top:8px">
                列表一次只显示 {{ BOARD_LIST_WINDOW }} 块（共 {{ boardCount }} 块），上面的板号输入框可以直接跳到任意一块。
                进度统计最多滞后 0.2 秒 —— 100 万格每次标记都全量重算的话，拖动会卡到没法用。
              </p>
            </div>
          </section>

          <section class="card">
            <div class="card__body stack stack--sm">
              <button v-if="!isFinished" class="btn primary block" @click="openFinish"><PixelIcon name="check" :size="16" /> 完成作品</button>
              <button class="btn btn-secondary block" :class="{ primary: isFinished }" @click="shareOpen = true">生成分享卡</button>
              <button class="btn btn-secondary block" @click="saveProject()">保存作品与进度</button>
              <button class="btn soft block" :disabled="progressLocked" @click="resetProgress">重置全部进度</button>
              <p class="hint">
                进度会自动跟着作品一起保存在本机浏览器，下次打开接着拼。
                <template v-if="isFinished">
                  这件作品已完成，可以在上方撤销完成或更新成品照片。
                </template>
              </p>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- 分享卡 -->
    <BaseDialog v-model="shareOpen" title="生成分享卡" size="sm">
      <div class="shareCard">
        <div class="shareCard__head">
          <img class="shareCard__logo" :src="logoDouwan" alt="豆玩 DOUWAN" width="102" height="34">
          <span class="spacer"></span>
          <span class="tag new">{{ viewStats.percent }}%</span>
        </div>
        <div class="shareCard__art">
          <figure>
            <div class="box">
              <img v-if="sourceImg" :src="sourceImg.src" alt="原图">
              <span v-else class="muted">无原图</span>
            </div>
            <figcaption>原图</figcaption>
          </figure>
          <figure>
            <div class="box">
              <canvas id="sharePreview" />
            </div>
            <figcaption>拼豆图</figcaption>
          </figure>
          <figure>
            <div class="box" style="flex-direction:column;gap:4px">
              <img v-if="finishPhoto" :src="finishPhoto" alt="成品照片">
              <template v-else>
                <div><PixelIcon name="sparkles" :size="28" /></div>
                <div style="font-size:var(--fs-2xs);color:var(--muted)">放你的成品照片</div>
              </template>
            </div>
            <figcaption>成品</figcaption>
          </figure>
        </div>
        <div class="shareCard__stats">
          <div><b>{{ stats.size }}</b><span>尺寸</span></div>
          <div><b>{{ stats.colors }} 色</b><span>颜色</span></div>
          <div><b>{{ num(stats.total) }} 颗</b><span>豆子</span></div>
          <div><b>{{ stats.similarityPct }}%</b><span>还原度</span></div>
          <div><b>{{ stats.buildability }}</b><span>可拼性</span></div>
          <div><b>{{ formatDuration(stats.minutes) }}</b><span>预计用时</span></div>
        </div>
        <div class="shareCard__foot">
          <span>把喜欢的东西，拼成自己的作品</span>
          <span>douzao.ai</span>
        </div>
      </div>
      <p class="hint" style="margin-top:12px;text-align:center">
        会导出 1080×1350 的竖版 PNG，成品那一格留给你放实物照片。
        <template v-if="!finishPhoto">在「完成作品」时上传一张成品照片，这里就会用上它。</template>
      </p>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">关闭</button>
        <button class="btn primary" @click="onShare">下载分享卡</button>
      </template>
    </BaseDialog>

    <!-- 完成作品：先说清会扣多少库存，再动手 -->
    <BaseDialog v-model="finishOpen" :title="photoOnly ? '成品照片' : '完成这件作品'" size="sm">
      <div class="stack stack--sm">
        <template v-if="!photoOnly">
          <p style="font-size:var(--fs-sm);line-height:1.85;color:var(--ink-2)">
            完成后会记下完成时间、按材料表扣减「我的库存」，并把拼制进度补满。
            点错了可以「取消完成」，库存和进度都会退回原样。
          </p>
          <!-- 「补满进度」= 把整张图纸的豆子全部写进进度再压进存档。1000×1000 是 100 万颗，
               这一步在浏览器里是同步跑的（约 1～2 秒），先说清楚，别让用户以为页面死了 -->
          <p v-if="stats.capacity > 200000" class="hint" style="color:var(--orange-deep);font-weight:700">
            这套图纸有 {{ num(stats.capacity) }} 格：完成后要把全部豆子逐颗记进进度并压缩写入本机存档，
            浏览器会卡 1～2 秒（按钮会显示「记录中…」），期间请不要关闭页面。
          </p>
          <div class="stats">
            <div class="stat tone-1"><b>{{ num(stats.total) }}</b><span>要拼的豆</span></div>
            <div class="stat tone-2"><b>{{ stats.colors }} 色</b><span>颜色</span></div>
            <div class="stat tone-3"><b>{{ stats.size }}</b><span>格子</span></div>
            <div class="stat tone-4"><b>{{ formatDuration(stats.minutes) }}</b><span>预计用时</span></div>
          </div>
          <div v-if="finishPlan" class="costBox">
            <div class="costLine"><span>这件作品需要</span><b>{{ num(finishPlan.need) }} 颗</b></div>
            <div class="costLine">
              <span>从我的库存扣</span>
              <b>{{ num(finishPlan.fromStock) }} 颗（{{ finishPlan.colorsFromStock }} 色）</b>
            </div>
            <div v-if="finishPlan.lack > 0" class="costLine">
              <span>库存不足、需要补购</span>
              <b style="color:var(--danger)">{{ num(finishPlan.lack) }} 颗</b>
            </div>
            <div class="costLine total"><span>完成后</span><b>进入「已完成」与成长记录</b></div>
          </div>
          <p v-if="finishPlan && finishPlan.colorsFromStock === 0" class="hint">
            你还没在「我的库存」里登记色号，所以这次不会扣任何库存（完成记录照常）。
          </p>
        </template>
        <p v-else style="font-size:var(--fs-sm);line-height:1.85;color:var(--ink-2)">
          这件作品已经完成。成品照片只存进本机作品档案，分享卡的「成品」那一格会用它。
        </p>

        <div class="divider"></div>

        <div class="field">
          <label>成品照片 <span>可选 · 存在本机，最长边压到 900px</span></label>
          <div class="photoRow">
            <div class="photoBox">
              <img v-if="photoUrl" :src="photoUrl" alt="成品照片预览">
              <span v-else class="muted">还没有照片</span>
            </div>
            <div class="col" style="gap:6px">
              <button class="btn btn-secondary sm" :disabled="photoBusy" @click="photoInput && photoInput.click()">
                {{ photoBusy ? '处理中…' : (photoUrl ? '换一张' : '选择照片') }}
              </button>
              <button v-if="photoUrl" class="btn sm ghost" @click="clearPhoto">移除</button>
            </div>
          </div>
          <input ref="photoInput" type="file" accept="image/*" style="display:none" @change="onPhotoPick">
          <p v-if="photoErr" class="hint" style="color:var(--danger)">{{ photoErr }}</p>
        </div>
      </div>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">先不完成</button>
        <button v-if="photoOnly" class="btn primary" :disabled="photoBusy" @click="doFinish">
          保存照片
        </button>
        <button v-else class="btn primary" :disabled="photoBusy || finishing" @click="doFinish">
          {{ finishing ? '记录中…' : '确认完成' }}
        </button>
      </template>
    </BaseDialog>

    <!-- Pro 引导：只拦「逐颗 / 整板进度」，不拦完成作品 -->
    <BaseDialog v-model="proOpen" title="逐颗标记进度是 Pro 功能" size="sm">
      <p style="font-size:var(--fs-sm);line-height:1.85;color:var(--ink-2)">
        {{ check('build.mode').reason || '逐颗 / 整板标记拼制进度需要 Pro 套餐。' }}
        它的作用是把「一张图纸」变成「真的拼完」：逐颗标记、每块板单独记录、知道这一板还差多少颗。
      </p>
      <p class="hint" style="margin-top:10px">
        不想升级也没关系：这页可以随便看，「我拼完了 · 完成作品」免费就能用 ——
        完成时间、库存扣减、成长记录都会照常记下来。
      </p>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">先看看</button>
      </template>
    </BaseDialog>

    <!-- 整色标记的确认：1000×1000 下一个色号可能有十几万颗、跨 1225 块板，
         而且 markColor 会扫完全部 100 万格 —— 点之前先说清颗数和代价 -->
    <BaseDialog v-model="colorConfirm" title="整色标记" size="sm">
      <div v-if="colorPending" class="stack stack--sm">
        <p style="font-size:var(--fs-sm);line-height:1.85;color:var(--ink-2)">
          色号 <b>{{ colorPending.code }}</b> 在整张图纸上有 <b>{{ num(colorPending.count) }}</b> 颗豆，
          分布在 {{ boardCount }} 块板上。
        </p>
        <p class="hint">
          这一步会把它们<b>全部</b>{{ colorPending.done ? '标记为已完成' : '取消完成' }}：
          要扫一遍整张画布（{{ stats.size }} = {{ num(stats.capacity) }} 格）并重算进度，
          页面会短暂无响应（约 0.2～1 秒），这期间的点击不会生效。
        </p>
        <p class="hint">
          只想处理当前板的话，取消这里，用「本板完成」或者在画布上逐颗点/拖。
        </p>
      </div>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button class="btn primary" :disabled="markBusy" @click="runMarkColor(colorPending.id, colorPending.done)">
          确认标记全部
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.buildGrid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,.9fr);gap:16px;align-items:start}
.buildStage{
  display:grid;place-items:center;overflow:auto;min-height:420px;max-height:64vh;padding:14px;
  border-radius:var(--r-md);background:var(--surface-3);
}
.boardProgressList{display:flex;flex-direction:column;gap:5px;max-height:340px;overflow:auto}
.boardProgressItem{
  display:grid;grid-template-columns:64px minmax(0,1fr) 46px;gap:9px;align-items:center;
  padding:7px 9px;border-radius:var(--r-xs);border:1px solid var(--line);background:var(--surface);
  font-size:var(--fs-2xs);transition:var(--t);
}
.boardProgressItem:hover{border-color:var(--line-strong)}
.boardProgressItem.on{border-color:var(--green);background:var(--green-soft)}
.boardProgressItem.full{opacity:.75}
.bpNo{font-weight:800;white-space:nowrap}
.bpBar{height:7px;border-radius:99px;background:var(--surface-3);overflow:hidden;display:block}
.bpBar i{display:block;height:100%;background:var(--green);border-radius:99px}
.bpPct{text-align:right;font-weight:800;color:var(--muted)}
.needPill{cursor:pointer;transition:var(--t)}
.needPill:hover{background:var(--yellow-soft)}
.needPill small{font-size:var(--fs-2xs);color:var(--green-deep)}
/* 整色标记进行中：这一块会同步扫 100 万格，先把点击挡住，别让用户以为点了没反应 */
.buildNeed.busy{opacity:.55;pointer-events:none}
/* 板号跳转：1225 块板时「下一板」点一千次不现实 */
.boardJump{font-size:var(--fs-2xs);color:var(--muted);font-weight:700;display:inline-flex;align-items:center;gap:5px}
.boardJump__input{
  width:76px;padding:5px 8px;border-radius:var(--r-xs);border:1px solid transparent;
  background:var(--surface-3);font:inherit;font-size:var(--fs-2xs);font-weight:800;text-align:center;color:var(--ink);
}
.boardJump__input:focus{outline:none;border-color:var(--pink);background:var(--surface);box-shadow:0 0 0 3px rgba(255,142,199,.18)}
/* 板列表开窗的翻页条 */
.boardWindow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:var(--fs-2xs)}
/* 免费版说明条：逐颗进度要 Pro，但完成作品不用升级 —— 说清楚，别做成一堵墙 */
.proNote{
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  margin-top:14px;padding:13px 16px;border-radius:var(--r-md);
  background:var(--yellow-soft);border:1px solid #F3E2C8;
}
.proNote b{font-size:var(--fs-xs)}
.proNote p{margin-top:4px;font-size:var(--fs-2xs);color:var(--ink-2);line-height:1.7;max-width:640px}
/* 完成后那块：成品照片 + 后续操作 */
.finishArt{display:flex;align-items:flex-start;justify-content:center;gap:18px;flex-wrap:wrap;margin-top:16px}
.finishArt figure{margin:0;text-align:center}
.finishArt .box{
  width:170px;height:170px;border-radius:var(--r-md);overflow:hidden;background:#fff;
  border:1px solid var(--line);display:grid;place-items:center;box-shadow:var(--sh-1);
}
.finishArt .box img{width:100%;height:100%;object-fit:cover;display:block}
.finishArt figcaption{font-size:var(--fs-2xs);color:var(--muted);margin-top:5px;font-weight:700}
/* 完成弹窗里的照片选择 */
.photoRow{display:flex;align-items:center;gap:12px}
.photoBox{
  width:104px;height:104px;flex:0 0 auto;border-radius:var(--r-sm);overflow:hidden;
  background:var(--surface-2);border:1px dashed var(--line-strong);display:grid;place-items:center;
  font-size:var(--fs-2xs);color:var(--muted);
}
.photoBox img{width:100%;height:100%;object-fit:cover;display:block}
.photoBox .muted{font-size:var(--fs-2xs)}
@media(max-width:1000px){.buildGrid{grid-template-columns:1fr}}
</style>
