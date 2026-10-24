<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  pattern, hasPattern, width, height, zoom, setZoom, tool, brushColorId,
  brushSize, BRUSH_MAX, beadKey,
  options, currentView, canvasEl, paintAt, fillAt, pickAt, undo, redo,
  canUndo, canRedo, undoDepth, redoDepth, beginEdit, endEdit, cancelEdit, revertEdit,
  mirrorPattern,
  stats, sourceUrl, sourceImg, generating, genMs, fitNotice,
  selectedBoard, layout, materials
} from '../../composables/useStudio.js'
import { drawChart, drawPixels, drawBoard, hitTest, chartGeometry, chartCellCap, updateChartLayer, markChartLayer, canvasDpr } from '../../lib/render.js'
import { boardBeadCounts } from '../../lib/pattern.js'
import { beadOf, boardOf, BOARD_SPEC_LIST_TEXT } from '../../lib/boardSpec.js'
import { EDIT_TOOLS, EDIT_HISTORY, EDIT_ACTIONS } from '../../data/icons.js'
import PixelIcon from '../ui/PixelIcon.vue'
import BaseDialog from '../ui/BaseDialog.vue'
import PatternPreview from '../ui/PatternPreview.vue'
import EditorEmptyGuide from './EditorEmptyGuide.vue'

/* 手机端：上传命令直接放在画布空状态里（桌面端仍指向左栏的 ① 创建） */
const emit = defineEmits(['upload', 'browse', 'resize', 'delivery'])

/** 当前画笔颜色（用于底部提示条） */
const brush = computed(() => {
  const p = pattern.value
  if (!p) return null
  return p.palette.find(c => c.id === brushColorId.value) || p.palette[p.palette.length - 1] || null
})

/** 画笔 / 橡皮的笔刷大小（格）。滑块和 −/＋ 都走这里，保证范围一致 */
function setBrushSize(value) {
  const n = Math.round(Number(value) || 1)
  brushSize.value = Math.min(BRUSH_MAX, Math.max(1, n))
}
function stepBrush(delta) {
  setBrushSize(brushSize.value + delta)
}

/** 每块板真正要放的豆数（空格不算） */
const boardBeads = computed(() => (pattern.value && layout.value ? boardBeadCounts(pattern.value, layout.value) : []))
function beadsOfBoard(b) {
  return boardBeads.value[b.no - 1] != null ? boardBeads.value[b.no - 1] : b.cells
}

const cv = ref(null)
const stageEl = ref(null)
const cardEl = ref(null)
const compareCv = ref(null)
const boardPreviewEls = ref([])
const boardGridEl = ref(null)
const boardJumpInput = ref(null)

/* ---------------------------------------------------------------- 手机上的浮动图纸
   手机版把画布排到「① 创建」正下方，可 ③④ 那些参数还在更下面 ——
   往下调参数的时候图纸就滑出屏幕了，改一次颜色要滚上去看一眼再滚回来。
   这块小缩略图在图纸离开视口时浮在右下角，点一下就滚回图纸，
   等于把桌面端「画布锁一屏」的体验在手机上还回来。
   只在 ≤780px 显示（见下面 scoped 样式），桌面端画布本来就在旁边。 */
const stageOffscreen = ref(false)
let stageIo = null

function scrollToStage() {
  const el = cardEl.value
  if (!el) return
  // 顶栏是 sticky 的，滚到最上面得给它让出 58px，否则作品名那一条会被压在顶栏下面
  const top = el.getBoundingClientRect().top + window.scrollY - 66
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

/* 底部编辑工具：图标 + 文字，数据都在 data/icons.js（同一套线性规范） */
const tools = EDIT_TOOLS
const history = EDIT_HISTORY
const actions = EDIT_ACTIONS

/** 整图动作的 tooltip：没有图纸时按钮是灰的，要说清楚原因 */
function actionTitle(a) {
  return hasPattern.value ? a.title : `${a.label}：先生成图纸后才能翻转`
}

/**
 * 撤销/重做的 tooltip。除了快捷键，还把「能不能点 / 攒了几步」写进去：
 * 按钮变灰的时候用户最想知道的就是「为什么不能点」。
 */
function historyTitle(h) {
  const isUndo = h.key === 'undo'
  const n = isUndo ? undoDepth.value : redoDepth.value
  if (!n) {
    return isUndo
      ? `${h.title} · 现在没有可撤销的操作：在图纸上点几格、拖一笔试试`
      : `${h.title} · 现在没有可重做的操作：撤销之后才有`
  }
  return `${h.title} · 可${isUndo ? '撤销' : '重做'} ${n} 步`
}

const views = [
  { key: 'pattern', icon: 'fn-pattern', label: '拼豆图纸', short: '图纸' },
  { key: 'original', icon: 'fn-original', label: '原图', short: '原图' },
  { key: 'compare', icon: 'fn-compare', label: '对照', short: '对照' },
  { key: 'split', icon: 'fn-split', label: '分板', short: '分板' },
  { key: 'materials', icon: 'fn-materials', label: '材料', short: '材料' }
]

/** 基准格子尺寸：zoom=1 时整张图纸大致铺满舞台（契合约「铺满一屏」，不是「一格 20px」） */
const baseCell = computed(() => {
  const m = Math.max(width.value, height.value)
  return Math.max(0.5, Math.min(20, 640 / m))
})

/* 图案层走的是「1 格 1 像素的位图 drawImage 缩放铺开」，每格几个像素都行，
   所以允许分数格并下限 0.5（1000 格图案要能整体缩进一屏）；
   不走图案层的小画布保持整数格 —— 那是逐格 fillRect 精绘，
   分数格会让相邻格子的边落在半像素上，接缝处透出一条底色细线。
   两者都再用 chartCellCap 夹住：超过预算时画布会静默变空白，宁可牺牲放大倍率。 */
const MAX_LAYER_CELLS = 20000
const layerCellPx = computed(() => Math.max(0.5, baseCell.value * zoom.value))

const useLayer = computed(() => {
  const p = pattern.value
  if (!p || !p.cells || !p.cells.length) return false
  /* 大画布走位图层。小画布缩到 3px 以下时也切到位图层：
     逐格精绘的下限是 3px（见下面的 wantedCellPx），卡在那里会让「适应窗口」
     永远缩不小 —— 156 × 104 格的图纸在手机上就顶出舞台，只看到左上角。 */
  return p.cells.length > MAX_LAYER_CELLS || baseCell.value * zoom.value < 3
})

/* 标尺宽度与 cell 有关，cap 也得跟着算（cell ≥ 7 时 ruler ≈ 26，纯整数，不用迭代）。
   实测 cap（口径见 render.js 的 chartCellCap：只接受 dpr ≥ 1 的级别）：
   1000×1000 → 4（桌面 24 Mpx）/ 2（窄屏 8 Mpx），464 → 9，116 → 29。
   大画布很容易碰到这个上限 —— 那时必须提示用户「再放大也只会变糊、去哪儿看细节」。 */
const cellCap = computed(() => chartCellCap(width.value, height.value, 26))

/* 当前缩放「想要」的格子尺寸（还没被预算夹过） */
const wantedCellPx = computed(() => (
  useLayer.value ? layerCellPx.value : Math.max(3, Math.round(baseCell.value * zoom.value))
))

const cellPx = computed(() => Math.min(wantedCellPx.value, cellCap.value))

/* 缩放撞到像素上限：倍数再大画布也画不出来了，必须让用户知道去哪儿看细节 */
const zoomCapped = computed(() => wantedCellPx.value > cellCap.value)

/* ---------------------------------------------------------------- 成品实际大小
   用户选了成品尺寸（成品区域几格）和豆径，就能算出实物多大；
   这里把「1 格 = 1 颗豆」按 CSS 的 96dpi 换算成屏幕像素，整张图纸按实物尺寸铺开。
   默认 1cm = 96/2.54 px 是 CSS 的规定值；显示器 / 手机的真实 PPI 各不相同，
   所以给一个可校准的屏幕比例（存在本机），校准一次后按真实尺子走。 */
const CSS_PX_PER_CM = 96 / 2.54
const SCREEN_SCALE_KEY = 'douwan.editor.screenScale'
function readScreenScale() {
  try {
    const n = Number(localStorage.getItem(SCREEN_SCALE_KEY))
    return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : 1
  } catch {
    return 1
  }
}
const screenScale = ref(readScreenScale())
const calibOpen = ref(false)
function saveScreenScale(v) {
  const n = Math.max(0.7, Math.min(1.3, Math.round((Number(v) || 1) * 100) / 100))
  screenScale.value = n
  try { localStorage.setItem(SCREEN_SCALE_KEY, String(n)) } catch { /* 无痕模式：本次生效 */ }
}
function resetScreenScale() { saveScreenScale(1) }

const actualMode = ref(false)
/* 进入实际大小之前的缩放 / 自动适配：退出时原样还回去，方便前后对比 */
let zoomBeforeActual = null
let fitBeforeActual = true

/* 豆径口径必须和 stats 用同一个（含 29 格老规格自动切 5mm 的兜底） */
const beadCm = computed(() => beadOf(beadKey.value).cm)
const finishCmText = computed(() => {
  const s = stats.value
  if (!s) return ''
  return `${(s.artW * beadCm.value).toFixed(1)} × ${(s.artH * beadCm.value).toFixed(1)} cm`
})
/* 分板视图那句说明要写清「哪种板、单板多大」：规格跟着当前图纸走
   （52 / 78 / 104 / 120 钉画线板）。老存档的方板只报实物尺寸，不再写格数。 */
const splitBoard = computed(() => (layout.value ? boardOf(layout.value.boardSize.x) : null))
const splitBoardNote = computed(() => {
  const b = splitBoard.value
  if (!b) return ''
  return b.legacy ? b.note : `${b.note}，每块 ${b.pegs} × ${b.pegs} 格`
})

/* 一颗豆在屏幕上应该占多少 CSS px（再乘校准比例） */
const actualCellPx = computed(() => beadCm.value * CSS_PX_PER_CM * screenScale.value)
/* 浏览器单张画布有像素上限：成品特别大时只能按实际大小的百分之多少显示 */
const actualShownPct = computed(() => {
  if (!actualMode.value || !actualCellPx.value) return 100
  return Math.max(1, Math.min(100, Math.round((cellPx.value / actualCellPx.value) * 100)))
})
const actualCapped = computed(() => actualMode.value && actualShownPct.value < 99)
/* 校准尺：5cm，够对齐、又放得进手机弹窗 */
const CALIB_CM = 5
const calibRulerPx = computed(() => CALIB_CM * CSS_PX_PER_CM * screenScale.value)

/** 把视野对准成品区域中心：实际大小常常比舞台大，先让用户看到成品本身 */
function centerOnArtwork() {
  const stage = stageEl.value
  const el = cv.value
  const p = pattern.value
  const s = stats.value
  if (!stage || !el || !p || !s) return
  const geo = chartGeometry(p, redrawOpts.value)
  const ox = Math.max(0, Math.floor((p.width - s.artW) / 2))
  const oy = Math.max(0, Math.floor((p.height - s.artH) / 2))
  const rect = el.getBoundingClientRect()
  const sr = stage.getBoundingClientRect()
  const left = rect.left - sr.left + stage.scrollLeft
  const top = rect.top - sr.top + stage.scrollTop
  const cx = left + geo.originX + (ox + s.artW / 2) * geo.cell
  const cy = top + geo.originY + (oy + s.artH / 2) * geo.cell
  stage.scrollLeft = Math.max(0, cx - stage.clientWidth / 2)
  stage.scrollTop = Math.max(0, cy - stage.clientHeight / 2)
}

/** 按实际尺寸铺开：一格 = 一颗豆的实物大小；尺寸变了（换豆径 / 改成品）也跟着重算 */
function applyActualSize() {
  if (!pattern.value) return
  autoFit = false
  setZoom(actualCellPx.value / baseCell.value)
  actualMode.value = true
  nextTick(() => setTimeout(centerOnArtwork, 40))
}

/** 退出实际大小；restore=true 时回到进入前的缩放（按钮再点一次 / 点「适应」用） */
function exitActualSize({ restore = true } = {}) {
  if (!actualMode.value) return
  actualMode.value = false
  if (!restore) {
    zoomBeforeActual = null
    return
  }
  if (fitBeforeActual) {
    autoFit = true
    fitToStage()
  } else {
    autoFit = false
    if (zoomBeforeActual != null) setZoom(zoomBeforeActual)
  }
  zoomBeforeActual = null
}

function toggleActualSize() {
  if (!hasPattern.value) return
  if (actualMode.value) {
    exitActualSize()
    return
  }
  fitBeforeActual = autoFit
  zoomBeforeActual = zoom.value
  applyActualSize()
}

/* 换豆径 / 重新校准后，实际大小要立刻按新口径重铺 */
watch([actualCellPx, baseCell], () => {
  if (actualMode.value) applyActualSize()
})

const showEmpty = computed(() => {
  if (!hasPattern.value) return true
  if (currentView.value === 'original') return !sourceImg.value
  return false
})

/* 空状态两套：桌面 / 平板是交付包的三步引导，手机沿用原来的紧凑提示。
   按视口宽度切换，跨过 780px 时跟着换，不靠 CSS 藏一块还会响应点击的 DOM。 */
const wideQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(min-width:781px)')
  : null
const wide = ref(wideQuery ? wideQuery.matches : true)
function onWideChange(e) { wide.value = e.matches }

/* ---------------------------------------------------------------- 手机端工具
   ≤780px：工具改成画布下方常驻的一行（由 EditorView 渲染），
   画布上只留右侧轻量浮控（实际大小 / 放大 / 缩小 / 居中）。
   桌面端这套浮控 display:none，画布下方原来的两行工具条一行没动。 */
function pickTool(key) {
  tool.value = key
}
/* 适应：重新按舞台量一次，并恢复「跟随容器」的自动适配。
   实际大小是另一种缩放口径，点「适应」就退出它，回到整张图纸放得下的视图。 */
function fitStage() {
  exitActualSize({ restore: false })
  autoFit = true
  fitToStage()
}
/* 居中：把图纸的滚动位置放回正中间（放大后迷路时一键回位） */
function centerStage() {
  const stage = stageEl.value
  if (!stage) return
  stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2)
  stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
}
/* ---------------------------------------------------------------- 手机端上传结果
   长 toast 换成一张紧凑卡：显示真实当前尺寸，来源像素等细节收进「详情」。
   12 秒后自动收起；用户展开详情时不再自动关。 */
const noticeClosed = ref(false)
const noticeDetail = ref(false)
let noticeTimer = null
const noticeSuggested = computed(() => {
  const n = fitNotice.value
  if (!n) return null
  return (n.suggestedW !== width.value || n.suggestedH !== height.value) ? n : null
})
function dismissNotice() {
  fitNotice.value = null
  noticeClosed.value = true
}
function openNoticeDetails() {
  noticeDetail.value = !noticeDetail.value
  clearTimeout(noticeTimer)
}
watch(fitNotice, v => {
  noticeClosed.value = false
  noticeDetail.value = false
  clearTimeout(noticeTimer)
  if (!v) return
  noticeTimer = setTimeout(() => {
    if (!noticeDetail.value) fitNotice.value = null
  }, 12000)
})

const chartOpts = computed(() => ({
  cell: cellPx.value,
  ruler: true,
  grid: options.showGrid,
  codes: options.numbering,
  bold: true,
  boardLines: options.boardLines,
  boardLabels: true
}))

/* 图案层缓存：1 格 1 像素的离屏位图 + 主画布一次 drawImage。
   大画布上「改一格」就只刷脏矩形，不再把整张图纸重画一遍（详见 render.js）。
   小画布（2 万格以内）继续走原来的逐格精绘：那点量本来就快，
   不必为了它去承担 drawImage 缩放的取整差。 */

/* 图案层是整块 drawImage 铺出来的，格子尺寸就是 cellPx 本身；
   命中判定必须和绘制取同一个值（同一个 cap，同一份分数格规则），
   否则点哪儿画哪儿会错开一点 —— 放大到 cap 附近时错开得最明显 */
const hitCell = computed(() => cellPx.value)
const hitOpts = computed(() => ({ ...chartOpts.value, cell: hitCell.value }))

const chartLayerOpts = computed(() => ({ ...chartOpts.value, cell: hitCell.value, useLayer: true }))

/* ------------------------------------------------------- 大画布的色号 LOD

   cell >= 11 时逐格 fillText 在 20 万格下是几秒级的阻塞，而且那个缩放级别
   一屏最多看到几百格 —— 索性不印，指路到分板视图与导出图纸。
   规则放在组件这一侧（而不是写进 drawChart）：导出图纸要的就是完整色号，
   drawChart 的契约必须是「参数说了印就印」。 */
const CODES_CELL_LIMIT = 40000

const cellsCount = computed(() => {
  const p = pattern.value
  return p ? p.width * p.height : 0
})
const codesSuppressed = computed(() => !!options.numbering && cellsCount.value > CODES_CELL_LIMIT)

const redrawOpts = computed(() => (codesSuppressed.value ? { ...chartLayerOpts.value, codes: false } : chartLayerOpts.value))

/* 上一次完整绘制时的几何与缓冲倍率。zoom / 尺寸一变这两样就变，
   而缓存层的脏矩形坐标是相对上一次绘制的，这种情况必须退回完整重绘 */
let lastGeo = null
let lastDpr = 0
function invalidateLayer() {
  lastGeo = null
  lastDpr = 0
}

/* ---------------------------------------------------------------- 绘制 */

/** 完整重绘：图案层重建 + 装饰层全画一遍（换缩放 / 换开关 / 重新生成走这里） */
function draw() {
  if (!cv.value) return
  if (!hasPattern.value) return
  canvasEl.value = cv.value
  const o = redrawOpts.value
  const g = chartGeometry(pattern.value, o)
  drawChart(cv.value, pattern.value, o, g)
  if (o.useLayer) {
    markChartLayer(cv.value, g)
    lastGeo = g
    lastDpr = canvasDpr(cv.value, g.width, g.height)
  } else {
    invalidateLayer()
  }
}

/**
 * 编辑时的增量重绘：只有豆子变了。
 * 走通脏矩形就只刷那一小块；缓存还没建立（首次绘制 / 刚换过缩放）就退回完整重绘。
 */
function redrawCells() {
  const el = cv.value
  const p = pattern.value
  if (!el || !p) return
  const o = redrawOpts.value
  const g = chartGeometry(p, o)
  if (!o.useLayer) { invalidateLayer(); draw(); return }
  /* 几何与倍率必须和上次完整绘制完全一致，脏矩形才换算出正确的像素位置 */
  const dpr = canvasDpr(el, g.width, g.height)
  const sameFrame = lastGeo && lastDpr === dpr &&
    lastGeo.width === g.width && lastGeo.height === g.height && lastGeo.cell === g.cell
  if (!sameFrame || !updateChartLayer(el, p, o, g)) {
    draw()
    return
  }
  lastGeo = g
}

function drawCompare() {
  if (!compareCv.value || !hasPattern.value) return
  drawPixels(compareCv.value, pattern.value, { maxSize: 420 })
}

function drawBoardPreviews() {
  const els = boardPreviewEls.value
  if (!els || !layout.value) return
  /* 只画真实挂载的那些 canvas。分板列表在超过上限时只渲染前 N 块，
     这里如果照旧遍历 layout.boards，没挂载的板会拿到 undefined（白跑一遍）。 */
  layout.value.boards.forEach((b, i) => {
    if (!showBoardTile(i)) return
    const el = els[i]
    if (el) drawBoard(el, pattern.value, b, { cell: 6, codes: false, ruler: false })
  })
}

function redrawAll() {
  invalidateLayer()
  nextTick(() => {
    draw()
    if (currentView.value === 'compare') drawCompare()
    if (currentView.value === 'split') {
      drawBoardPreviews()
      drawSelectedBoard()
    }
  })
}

/* 只有豆子变了：走脏矩形，别把整张图纸再画一遍 */
watch(pattern, () => nextTick(redrawCells))
/* 缩放只换格子尺寸：图案层还能用，重铺一遍装饰层即可。
   cellPx 是四舍五入过的，这里盯的是真正参与绘制的 hitCell ——
   顺手作废脏矩形的基准几何，免得落笔时拿旧尺寸的换算去刷新的画布 */
watch(hitCell, () => { invalidateLayer(); nextTick(draw) })
/* 网格 / 色号 / 底板虚线也只影响装饰层 */
watch([() => options.numbering, () => options.showGrid, () => options.boardLines], () => nextTick(draw))
watch([width, height], () => {
  resetPan()
  redrawAll()
  /* 上传 / 换图会把画布换成新的宽高比：不重新适配的话，
     沿用上一张图的缩放倍数，新图纸会顶出舞台（手机上表现为只看到一角）。 */
  if (autoFit) nextTick(() => setTimeout(fitToStage, 60))
})
/* 只换画布（底板）时成品区域不变、width/height 也不变，但图纸本身从 52 变成 104 格：
   沿用旧缩放会让新底板顶出舞台，看不到四周留空，所以同样重新适配一次。 */
watch(() => [pattern.value && pattern.value.width, pattern.value && pattern.value.height], () => {
  if (autoFit) nextTick(() => setTimeout(fitToStage, 60))
})
/* 画布尺寸没变、只是从空状态变成有图纸（素材默认就是 52×52 这类情况）时，
   width/height 不会触发，图纸会停在 100% 被裁掉一半。第一次出现图纸也适配一次。 */
watch(hasPattern, v => {
  if (!v) return
  nextTick(() => setTimeout(() => { if (autoFit) fitToStage() }, 80))
})
watch(currentView, () => redrawAll())
watch(generating, v => { if (!v) redrawAll() })

/* ---------------------------------------------------------------- 缩放平移 */

const dragging = ref(false)
let moved = false
let startX = 0
let startY = 0
let startLeft = 0
let startTop = 0
let painting = false

/* 触屏上的分工：单指 / 笔只编辑，画布固定；要缩放 / 平移用两根手指。
   浏览器默认会把单指拖动解释成滚动（画布跟着手指跑），
   所以舞台在图纸视图下关掉了原生手势（见 global.css 的 .stage--edit），
   双指手势由这里自己算：中点位移换滚动量，两指距离换缩放比例。 */
const touchPoints = new Map()
let twoFingerPan = false
let panOrigin = null
/** 捏合缩放：记下手势开始时的两指距离与缩放级别，移动时按比例换算 */
let pinch = null
/* 两根手指的 pointermove 是分开到达的：如果每来一根就按当前距离算缩放，
   平移时两指一前一后会先算成「捏小」再算成「捏大」，画布跟着抖。
   等两根都动过再结算一次缩放，平移本身仍然每个事件都跟手。 */
let pinchMoved = new Set()

function trackTouch(e) {
  if (e.pointerType !== 'touch') return
  touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
}

/** 两指的距离与中点（不足两指返回 null） */
function pinchInfo() {
  const pts = [...touchPoints.values()]
  if (pts.length < 2) return null
  return {
    dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
    mx: (pts[0].x + pts[1].x) / 2,
    my: (pts[0].y + pts[1].y) / 2
  }
}

function startTwoFingerPan(stage) {
  const info = pinchInfo()
  if (!info) return
  /* 第二根手指落下说明用户想挪画布 / 缩放：把刚落下的那一笔退回去，
     免得「双指手势」顺手在图纸上留一格颜色。 */
  if (painting) revertEdit()
  painting = false
  dragging.value = false
  /* 双指手势结束后浏览器还可能补一个 click；标记成「拖动过」，
     免得吸色 / 填充工具把它当成一次点击。 */
  moved = true
  twoFingerPan = true
  panOrigin = {
    x: info.mx,
    y: info.my,
    left: stage.scrollLeft,
    top: stage.scrollTop
  }
  pinch = { dist: info.dist, zoom: zoom.value }
  pinchMoved = new Set()
}

/* 指针捕获只是「拖出画布也别丢事件」的加分项：浏览器在指针已经失效时会抛
   NotFoundError（笔/触控抬起、系统抢走指针，或脚本合成的 PointerEvent）。
   以前这里裸调用，一抛就中断整个 pointerdown —— 落笔那一格没画上，
   而且后面每个 pointermove 都各自变成一步历史，撤销要按很多次才退回原位。 */
function capturePointer(el, id) {
  try { el.setPointerCapture?.(id) } catch { /* 指针已失效：这一笔照样画，只是不捕获 */ }
}
function releasePointer(el, id) {
  try { el.releasePointerCapture?.(id) } catch { /* ignore */ }
}

function onPointerDown(e) {
  const stage = stageEl.value
  if (!stage) return

  /* 空画布引导（示例格 / 「使用示例图片体验」/ 手机端的上传按钮）就在 stage 里。
     这里一旦往下走就会 setPointerCapture(stage)，浏览器把随后的 click 派发给
     stage 而不是按钮，按钮的 @click 永远收不到 —— 表现是「真实鼠标点没反应」，
     而自检里的 el.click() 能过（脚本点击不经过命中测试与捕获）。 */
  if (showEmpty.value) return

  trackTouch(e)
  /* 顶栏浮层开着时，EditorView 会在捕获阶段拦下这一下（只关浮层、不落笔），
     所以走到这里就按当前工具正常编辑。 */
  if (touchPoints.size >= 2) {
    startTwoFingerPan(stage)
    capturePointer(stage, e.pointerId)
    return
  }

  // 编辑工具下，直接点格子改色（PRD §12 画布）
  if (currentView.value === 'pattern' && e.button === 0 && (tool.value === 'paint' || tool.value === 'erase')) {
    painting = true
    capturePointer(stage, e.pointerId)
    /* 一整笔（按下 → 拖动 → 松开）算一步撤销：applyPaint 会随 pointermove
       反复调用，靠 beginEdit 的嵌套计数把这一笔合成一条历史 */
    beginEdit()
    applyPaint(e)
    return
  }
  if (e.button !== 0) return
  /* 触屏单指只编辑：填充 / 吸色这类工具也不能顺手把画布拖走。
     要平移画布请用「移动」工具，或双指手势。 */
  if (e.pointerType === 'touch' && tool.value !== 'pan') return
  dragging.value = true
  moved = false
  startX = e.clientX
  startY = e.clientY
  startLeft = stage.scrollLeft
  startTop = stage.scrollTop
}

function applyPaint(e) {
  if (!cv.value || !pattern.value) return
  if (tool.value === 'pick') return
  const hit = hitTest(cv.value, pattern.value, e, hitOpts.value)
  if (!hit) return
  if (tool.value === 'fill') {
    fillAt(hit.x, hit.y)
    return
  }
  paintAt(hit.x, hit.y)
}

function onPointerMove(e) {
  const stage = stageEl.value
  if (e.pointerType === 'touch' && touchPoints.has(e.pointerId)) {
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  if (twoFingerPan) {
    if (e.pointerType === 'touch') pinchMoved.add(e.pointerId)
    const info = pinchInfo()
    if (stage && panOrigin && info) {
      const rect = stage.getBoundingClientRect()
      const px = info.mx - rect.left
      const py = info.my - rect.top
      /* 两指距离变化 = 缩放；中点移动 = 平移。缩放时以手势开始时的
         两指中点为锚，把同一块图纸留在手指下面。
         等两根手指都动过再结算缩放：分开到达的 pointermove 会把
         「平行拖动」误算成一捏一放。 */
      let ratio = 1
      if (pinch && pinchMoved.size >= 2 && pinch.dist > 8 && info.dist > 8) {
        exitActualSize({ restore: false })
        autoFit = false
        const target = Math.max(0.1, Math.min(8, pinch.zoom * (info.dist / pinch.dist)))
        setZoom(target)
        ratio = zoom.value / pinch.zoom
        pinchMoved.clear()
      }
      const left = (panOrigin.left + (panOrigin.x - rect.left)) * ratio - px
      const top = (panOrigin.top + (panOrigin.y - rect.top)) * ratio - py
      stage.scrollLeft = left
      stage.scrollTop = top
      /* 画布尺寸在下一帧才更新，滚动上限也跟着变；再落一次保证不被夹回去 */
      if (ratio !== 1) nextTick(() => { stage.scrollLeft = left; stage.scrollTop = top })
    }
    return
  }
  if (painting) {
    applyPaint(e)
    return
  }
  if (!dragging.value || !stage) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
  stage.scrollLeft = startLeft - dx
  stage.scrollTop = startTop - dy
}

function onPointerUp(e) {
  if (e && e.pointerType === 'touch') touchPoints.delete(e.pointerId)
  // 松手才提交这一笔：中途每一格共用同一个「操作前快照」
  if (painting) endEdit()
  painting = false
  dragging.value = false
  const stage = stageEl.value
  if (stage && e && e.pointerId != null) releasePointer(stage, e.pointerId)
  /* 双指平移时先抬起一根手指：停止平移，剩下的那根不要接着画，
     等它自己抬起（下一次单指按下才是新的一笔）。 */
  if (twoFingerPan && touchPoints.size < 2) {
    twoFingerPan = false
    panOrigin = null
    pinch = null
    pinchMoved.clear()
  }
  setTimeout(() => { moved = false }, 0)
}

/** 指针被系统抢走（来电、通知中心）：这一笔不要留在历史里，免得撤销时画面跳变 */
function onPointerCancel(e) {
  if (e && e.pointerType === 'touch') touchPoints.delete(e.pointerId)
  if (painting) cancelEdit()
  painting = false
  dragging.value = false
  if (touchPoints.size < 2) {
    twoFingerPan = false
    panOrigin = null
    pinch = null
    pinchMoved.clear()
  }
}

function onClick(e) {
  if (moved) return
  if (!cv.value || !pattern.value) return
  if (tool.value === 'pick') {
    const hit = hitTest(cv.value, pattern.value, e, hitOpts.value)
    if (hit) {
      const c = pickAt(hit.x, hit.y)
      if (c) tool.value = 'paint'
    }
    return
  }
  if (tool.value === 'fill') {
    const hit = hitTest(cv.value, pattern.value, e, hitOpts.value)
    if (hit) fillAt(hit.x, hit.y)
  }
}

function onWheel(e) {
  e.preventDefault()
  exitActualSize({ restore: false })
  const dir = e.deltaY < 0 ? 1 : -1
  setZoom(zoom.value + dir * (zoom.value < 2 ? 0.2 : 0.4))
}

/* 舞台内边距直接读计算样式：手机上右侧要给工具窄栏留出位置，
   内边距不再是左右相同的 12px；按公式猜会把图纸算宽，顶出横向滚动。 */
function stagePad(el) {
  const cs = getComputedStyle(el)
  return {
    x: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    y: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
  }
}
/**
 * 适配窗口：把图纸缩放到舞台里放得下。
 *
 * 不按几何公式猜，而是量**真实渲染出来的画布尺寸**再按比例校正 ——
 * 图纸外围还有四边标尺、底板编号、格内色号，这些都随图纸尺寸和开关变化，
 * 用公式估总会差几个像素（实测估出来的尺寸顶出舞台 37px，舞台里冒出滚动条）。
 * 量真实值就与这些细节无关。
 *
 * 需要两轮：第一轮先给个初值把画布画出来，量到尺寸后第二轮校正到位。
 *
 * 下限必须是 0.1 而不是 0.4：1000×1000 格按每格 14px 画是 14000px 宽，
 * 要在 700px 的舞台里放得下，zoom 得退到 0.05 —— 夹在 0.4 上「适应」就永远失效，
 * 用户只能看到图纸左上角一块。useStudio 的 setZoom 已经放宽到 0.1，
 * 这里再夹一次 0.4 就等于白改。
 */
/* 适配过程中会连续改缩放；期间忽略 ResizeObserver，避免自己触发自己。 */
let fitting = false
const clampZoom = v => Math.max(0.1, Math.min(8, v))
/** 按画布真实尺寸算「还能放大 / 需要缩小多少」；没有画布时返回 null。 */
function fitRatio(stage) {
  const el = cv.value
  if (!el) return null
  /* 量外层 .board：画布外面还有内边距与边框，只量 canvas 会少算十几像素，
     结果图纸右边正好压在工具窄栏下面。 */
  const box = el.closest('.board') || el
  const rect = box.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  // 内边距按实际计算值留出来（手机上右侧还多一条工具窄栏）
  const p = stagePad(stage)
  const availW = stage.clientWidth - p.x
  const availH = stage.clientHeight - p.y
  if (availW <= 0 || availH <= 0) return null
  const fit = Math.min(availW / rect.width, availH / rect.height)
  return Number.isFinite(fit) ? fit : null
}
function fitToStage() {
  /* 自动适配只在 autoFit 打开时生效。
     换画布 / 换图时排队的 setTimeout(fitToStage) 可能晚于「实际大小」到达，
     没有这道闸就会把刚设好的 1:1 缩放抢回「适应窗口」。 */
  if (!autoFit) return
  const stage = stageEl.value
  if (!stage || !pattern.value) return
  const pad = stagePad(stage)
  const availW = stage.clientWidth - pad.x
  const availH = stage.clientHeight - pad.y
  if (availW <= 0 || availH <= 0) return

  /* 画布已经画出来：直接量真实尺寸，允许放大也允许缩小。
     只「缩小不放大」会让 320 宽下的初始 10% 一直卡着（明明还有一倍空间），
     所以这里按实测比例走两轮；标尺是固定宽度，第二轮把这点误差收掉。 */
  const first = fitRatio(stage)
  if (first) {
    fitting = true
    const before = cv.value.getBoundingClientRect().width
    if (Math.abs(first - 1) > 0.01) setZoom(clampZoom(zoom.value * first * 0.99))
    /* 第二轮只在画布真的重画过之后量：同一帧里重复套用同一个比例会连乘，
       实测把 320 宽的初始 10% 一路放大到 30%，右边压到工具窄栏下面。 */
    nextTick(() => setTimeout(() => {
      if (autoFit && cv.value && cv.value.getBoundingClientRect().width !== before) {
        const second = fitRatio(stage)
        /* 第二轮只收不放：格子尺寸是整数像素，放大时会在 4px → 5px 处跳一档，
           再放大一次就正好顶进右侧工具窄栏。 */
        if (second && second < 0.995) setZoom(clampZoom(zoom.value * second))
      }
      setTimeout(() => { fitting = false }, 60)
    }, 80))
    return
  }

  // 还没有画布（空状态）：先按几何估算给一个能画出来的缩放级别
  const probe = chartGeometry(pattern.value, hitOpts.value)
  const need = Math.max(probe.width / zoom.value, probe.height / zoom.value)
  setZoom(clampZoom((Math.min(availW, availH) / need) * 0.9))
}

function resetPan() {
  const stage = stageEl.value
  if (!stage) return
  stage.scrollLeft = 0
  stage.scrollTop = 0
}

/* 舞台尺寸一变就重新适配。
   工作台是「画布锁一屏、两边各自滚」的版面，舞台的高度由窗口和卡片剩余
   空间算出来，会随窗口大小改变；只在挂载后 60ms 适配一次的话，
   窗口一变、或者排版稍晚稳定下来，图纸就会比舞台高出一截 ——
   表现为画布内部出现滚动条、底栏看着要掉出去。
   只在「刚打开 / 换过图」时自动适配：用户手动缩放过就不抢他的缩放级别。 */
let autoFit = true
let ro = null
function onUserZoom(v) {
  /* 手动缩放就从实际大小模式里退出来：再按一次「实际大小」可以回去 */
  exitActualSize({ restore: false })
  autoFit = false
  setZoom(v)
}

onMounted(() => {
  redrawAll()
  if (wideQuery) wideQuery.addEventListener('change', onWideChange)
  setTimeout(fitToStage, 60)
  /* 第一次适配按「当前缩放」反推图纸尺寸，缩放很低时标尺/留白的固定开销
     会被放大，结果偏保守（手机上 33% 明明还能到 42%）。布局稳定后再适配
     一次，用已经放大过的尺寸反推就准了；只在没被用户手动缩放过时执行。 */
  setTimeout(() => { if (autoFit) fitToStage() }, 420)
  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    ro = new ResizeObserver(() => {
      if (!autoFit || fitting) return
      // 防抖：resize 期间会连续触发，逐帧重算没有意义
      clearTimeout(ro._t)
      ro._t = setTimeout(fitToStage, 60)
    })
    ro.observe(stageEl.value)
  }
  /* 图纸进没进视口：只在离开时浮出那块缩略图 */
  if (typeof IntersectionObserver !== 'undefined' && stageEl.value) {
    stageIo = new IntersectionObserver(([entry]) => {
      stageOffscreen.value = !entry.isIntersecting
    })
    stageIo.observe(stageEl.value)
  }
})
onBeforeUnmount(() => {
  clearTimeout(noticeTimer)
  if (wideQuery) wideQuery.removeEventListener('change', onWideChange)
  if (ro) { clearTimeout(ro._t); ro.disconnect(); ro = null }
  if (stageIo) { stageIo.disconnect(); stageIo = null }
  if (painting) cancelEdit()
  painting = false
  dragging.value = false
})

/* ---------------------------------------------------------------- 分板

   1000×1000 格 = 35×35 = 1225 块板。每块板的缩略图是一张 174² 的 canvas
   （≈ 121 KB 后备缓冲）并且要整板重绘一遍，1225 块就是 148 MB + 几秒同步阻塞 ——
   而列表里同时看得见的本来就只有十几块。所以超过 SPLIT_MAX_TILES 之后
   只渲染「前 60 块 + 当前选中的那块」，其余用输入框按板号跳。
   选中的板另有放大预览，材料色号、豆数统计都按选中的那块单独算，不受列表截断影响。 */
const SPLIT_TILE_HEAD = 60
const SPLIT_MAX_TILES = 120

const splitTilesCapped = computed(() => {
  const l = layout.value
  return !!l && l.boards.length > SPLIT_MAX_TILES
})

/** 这一块板要不要真的建 canvas：截断时只留前 60 块 + 当前选中的那块 */
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
      const c = p.palette[p.cells[y * p.width + x]]
      if (!c) continue
      counts.set(c.id, { c, n: (counts.get(c.id)?.n || 0) + 1 })
    }
  }
  return [...counts.values()].map(({ c, n }) => ({ code: c.code, hex: c.hex, n })).sort((a, b2) => b2.n - a.n)
})

function drawSelectedBoard() {
  const b = selectedBoardData.value
  const el = document.getElementById('boardFocus')
  if (b && el) drawBoard(el, pattern.value, b, { cell: Math.max(6, cellPx.value), codes: options.numbering, ruler: true })
}

watch([selectedBoard, cellPx, () => options.numbering], () => nextTick(drawSelectedBoard))
watch(currentView, () => nextTick(() => {
  if (currentView.value === 'split') { drawBoardPreviews(); drawSelectedBoard() }
}))

function setBoardPreviewRef(el, i) {
  if (el) boardPreviewEls.value[i] = el
}

/* 「跳到第 __ 板」：范围外的输入不报错也不跳，直接回填成真正生效的板号 ——
   1225 块板的列表里滚到第 900 块要滑很久，输错一位却什么都不发生才是最恼人的 */
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
    /* 截断时选中的那块会新挂上一个 canvas（showBoardTile），得把它也画出来 */
    if (splitTilesCapped.value) drawBoardPreviews()
    boardGridEl.value?.querySelector('.boardTile.on')?.scrollIntoView({ block: 'nearest' })
  })
}
</script>

<template>
  <section ref="cardEl" class="canvasCard">
    <!-- 作品名这一行由 EditorView 从外面传进来（参考版的画布块只有
         「页签 + 缩放」一条顶栏，作品名属于卡片上方的信息条） -->
    <slot name="above" />

    <div class="canvasCard__toolbar">
      <div class="viewtabs" role="tablist">
        <button
          v-for="v in views" :key="v.key"
          :class="{ on: currentView === v.key }"
          role="tab"
          :aria-selected="currentView === v.key"
          @click="currentView = v.key"
        ><PixelIcon :name="v.icon" :size="18" /><span class="tabLong">{{ v.label }}</span><span class="tabShort">{{ v.short }}</span></button>
      </div>

      <!-- 平移模式要有可见状态：工具按钮高亮之外，顶栏再给一条明确提示，
           避免用户以为单指拖动会改图 -->
      <span v-if="currentView === 'pattern' && !showEmpty && tool === 'pan'" class="panState"><PixelIcon name="pan" :size="12" />移动画布模式</span>

      <!-- 缩放：参考版是「− 100% ＋」一组。本站多一个「适应」，
           因为大画布（最多 1000×1000 格 = 100 万格）不一键回中很容易在画布外找不到图 -->
      <div class="zoomBar">
        <template v-if="currentView === 'pattern'">
          <button class="btn btn-secondary icon sm" title="缩小" aria-label="缩小" @click="onUserZoom(zoom - 0.25)"><PixelIcon name="zoomOut" :size="14" /></button>
          <span class="zoomPill"><PixelIcon class="zoomIco" name="zoomIn" :size="12" /><span class="zoomText">{{ Math.round(zoom * 100) }}%</span></span>
          <button class="btn btn-secondary icon sm" title="放大" aria-label="放大" @click="onUserZoom(zoom + 0.25)"><PixelIcon name="zoomIn" :size="14" /></button>
          <button class="btn btn-secondary sm" title="适应窗口" @click="fitStage">适应</button>
          <!-- 成品实际大小：一格 = 一颗豆的实物尺寸，按屏幕像素铺开；
               不用再自己想象 13.5cm 到底多大。 -->
          <button
            class="btn btn-secondary sm actualBtn" :class="{ on: actualMode }"
            data-actual-btn
            :disabled="!hasPattern"
            :title="hasPattern ? `按实际大小预览（成品 ${finishCmText}）` : '先生成图纸后才能按实际大小预览'"
            :aria-pressed="actualMode"
            @click="toggleActualSize"
          >实际大小</button>
        </template>
        <span v-else-if="genMs" class="muted">{{ genMs }}ms</span>
      </div>

      <!-- 手机端：顶栏最右一颗「适应窗口」。缩放的加减在画布右侧浮控上，
           这样顶栏只占一行，画布能多留一条高度。 -->
      <button type="button" class="fitTop" title="适应窗口" aria-label="适应窗口" @click="fitStage">
        <PixelIcon name="fit" :size="16" />
      </button>
    </div>

    <!-- 手机端快捷入口（画布 / 色板 / 用量 / 导出 / 更多）由 EditorView 传进来，
         紧贴顶栏下方；桌面端不渲染 -->
    <slot name="quick" />

    <!-- 手机端上传结果：非阻塞的紧凑卡，放在画布上方（不压画布中心、不吃触摸）。
         当前尺寸读实时 width/height，用户改过画布后这里跟着变。 -->
    <div
      v-if="fitNotice && !noticeClosed && !showEmpty"
      class="genNotice no-print" role="status"
    >
      <div class="genNotice__head">
        <span class="genNotice__badge"><PixelIcon name="check" :size="10" /></span>
        <b>已生成图纸</b>
        <button class="genNotice__close" type="button" aria-label="关闭提示" @click="dismissNotice"><PixelIcon name="close" :size="11" /></button>
      </div>
      <div class="genNotice__body">
        <img v-if="sourceUrl" class="genNotice__thumb" :src="sourceUrl" alt="">
        <div class="genNotice__meta">
          <p><span>当前图纸</span><b>{{ width }} × {{ height }} 格</b></p>
          <p v-if="noticeSuggested" class="genNotice__suggest">
            <span>建议尺寸</span><b>{{ noticeSuggested.suggestedW }} × {{ noticeSuggested.suggestedH }} 格</b>
          </p>
          <div class="genNotice__actions">
            <button type="button" class="genNotice__link" @click="emit('resize')">调整尺寸</button>
            <button type="button" class="genNotice__link" :aria-expanded="noticeDetail" @click="openNoticeDetails">
              详情{{ noticeDetail ? '▴' : '▾' }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="noticeDetail" class="genNotice__detail">
        来源 {{ fitNotice.sourceW }} × {{ fitNotice.sourceH }} 像素
        · 一格约 {{ fitNotice.perCell.toFixed(1) }} 个源像素
        · {{ fitNotice.colors }} 色
        <template v-if="fitNotice.raisedColors">（颜色数从 {{ fitNotice.raisedColors }} 提到 {{ fitNotice.colors }}）</template>
        · 共 {{ fitNotice.cells.toLocaleString() }} 格
      </p>
    </div>

    <!-- 手机端画布框：右侧工具窄栏 + 更多抽屉；桌面端仍是画布下方的两行工具条。 -->
    <div class="stageWrap">
      <!-- 实际大小的状态条：贴在画布左上角，直接写成品厘米；
           屏幕像素预算不够时如实说「只能显示到实际的百分之多少」。 -->
      <div v-if="actualMode && !showEmpty && currentView === 'pattern'" class="actualBadge no-print" role="status" data-actual-badge>
        <span class="actualBadge__dot" aria-hidden="true"></span>
        <b>{{ actualCapped ? `约实际大小 ${actualShownPct}%` : '实际大小' }}</b>
        <span class="actualBadge__cm" data-actual-cm>成品 {{ finishCmText }}</span>
        <button type="button" class="actualBadge__link" data-actual-calib @click="calibOpen = true">校准屏幕</button>
      </div>

      <div
        ref="stageEl" class="stage"
        :class="{ 'stage--edit': currentView === 'pattern' && !showEmpty, pannable: currentView === 'pattern' && !showEmpty && (dragging || tool === 'pan'), panning: dragging, 'stage--empty': showEmpty }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
        @pointercancel="onPointerCancel"
        @wheel="onWheel"
      >
        <!-- 空状态：桌面 / 平板走交付包里的三步引导；手机保持原来的紧凑提示，
             上传入口仍然只在左栏 ① 创建里（手机上就是画布上方那张卡）。 -->
        <div v-if="showEmpty" class="empty empty--guide">
          <EditorEmptyGuide v-if="wide" />
          <div v-else class="emptyLegacy">
            <div class="empty__icon"><PixelIcon name="layout" :size="24" /></div>
            <strong>先选一张图，这里就出图纸</strong>
            <p>
              先<b>上传照片</b>，或者直接从 <b>免费素材库</b> 挑一个；<b>AI 生成素材</b> 正在对接中，接入后可以用一句话出图。
            </p>
            <p class="only-lg">
              画布按真实画线板拼装：{{ BOARD_SPEC_LIST_TEXT }} 钉，一钉 = 一格，
              当前 {{ options.boardCols }} × {{ options.boardRows }} 块 = {{ width }} × {{ height }} 格。
            </p>
            <div class="emptyActions only-sm">
              <button type="button" class="btn primary" @click="emit('upload')"><PixelIcon name="fn-upload" :size="16" />上传图片</button>
              <button type="button" class="btn btn-secondary" @click="emit('browse')"><PixelIcon name="fn-library" :size="16" />免费素材库</button>
            </div>
          </div>
        </div>

        <!-- 拼豆图纸 -->
        <div
          v-if="!showEmpty && currentView === 'pattern'"
          class="board editing" v-show="!showEmpty"
        >
          <canvas ref="cv" @click="onClick" />
        </div>

        <!-- 原图 -->
        <div v-if="!showEmpty && currentView === 'original'" class="compareWrap">
          <figure class="compareBox">
            <img :src="sourceUrl" alt="原图">
            <figcaption>原图（{{ sourceImg ? '已载入' : '无源图' }}）</figcaption>
          </figure>
        </div>

        <!-- 对照 -->
        <div v-if="!showEmpty && currentView === 'compare'" class="compareWrap">
          <figure class="compareBox">
            <img :src="sourceUrl" alt="原图">
            <figcaption>原图</figcaption>
          </figure>
          <figure class="compareBox">
            <canvas ref="compareCv" />
            <figcaption>拼豆图（{{ stats ? stats.colors : 0 }} 色）</figcaption>
          </figure>
        </div>

        <!-- 分板 -->
        <div v-if="!showEmpty && currentView === 'split'" class="splitWrap">
          <div class="splitHead">
            <div>
              <b>自动分板</b>
              <p class="muted" style="margin-top:4px">
                共 {{ layout ? layout.count : 0 }} 块 {{ splitBoard ? splitBoard.label : '拼板' }}（{{ splitBoardNote }}）。
                图纸上珊瑚色虚线就是拼板边界，角标数字是板号。
              </p>
            </div>
          </div>

          <!-- 板数太多时不把 1225 张缩略图全建出来（每张 174² 的 canvas 约 121 KB，
               合起来 148 MB + 几秒同步绘制）。改成前 60 块 + 当前选中那块，
               并给一个按板号跳的入口 —— 用户要的是「第 812 板长什么样」，
               不是把 1225 张图从头滚到尾。 -->
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
            <div class="boardFocus"><canvas id="boardFocus" /></div>
            <div class="swatchRow" style="margin-top:10px">
              <span v-for="m in boardMaterialsList" :key="m.code" class="swatchPill">
                <i :style="{ background: m.hex }"></i>{{ m.code }} × {{ m.n }}
              </span>
            </div>
          </div>
        </div>

        <!-- 材料（图例） -->
        <div v-if="!showEmpty && currentView === 'materials'" class="materialsWrap">
          <div class="row row--between" style="margin-bottom:10px">
            <b>材料清单（图例）</b>
            <span class="muted">{{ stats ? stats.colors : 0 }} 色 · {{ stats ? stats.total.toLocaleString() : 0 }} 颗</span>
          </div>
          <div class="tableWrap">
            <table class="table">
              <thead>
                <tr><th>色块</th><th>色号</th><th>颜色</th><th class="num">数量</th><th class="num">占比</th></tr>
              </thead>
              <tbody>
                <tr v-for="m in (materials ? materials.rows : [])" :key="m.id">
                  <td><span class="swatch" :style="{ background: m.hex }"></span></td>
                  <td>{{ m.code }}</td>
                  <td>{{ m.name || '—' }}</td>
                  <td class="num">{{ m.count.toLocaleString() }}</td>
                  <td class="num">{{ stats && stats.total ? ((m.count / stats.total) * 100).toFixed(1) : 0 }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div v-if="!showEmpty && currentView === 'pattern'" class="chartNote">
        <span class="hintWheel">滚轮缩放 · 按住空白处拖拽平移</span>
        <span class="hintTouch">双指捏合缩放 / 拖动平移 · 单指编辑</span>
        <span v-if="tool !== 'pan'" class="only-lg">· 直接点格子改色（当前工具：
          {{ tool === 'paint' ? '画笔' : tool === 'erase' ? '橡皮' : tool === 'pick' ? '吸色' : '填充' }}）</span>
      </div>

      <!-- 画布太大就不逐格印色号了（见 CODES_CELL_LIMIT）。必须说清楚去哪儿看：
           用户只会发现「色号开关明明开着，图上却没有」，不给指路就等于坏了 -->
      <!-- 实际大小已经因为像素上限放不下时，这条「不印色号」提示让位给下面那条：
           两条都说「去看分板 / 导出图纸」，同时出现只会把画布挤得更小。 -->
      <p v-if="!showEmpty && currentView === 'pattern' && codesSuppressed && !actualCapped" class="codesHint">
        <span class="hintLong">
          图纸太大（{{ (cellsCount / 10000).toFixed(1) }} 万格），编辑区不再逐格印色号：
          色号请到分板视图或导出的图纸里看。
        </span>
        <span class="hintShort">
          图纸太大，编辑区不再印色号。
          <button type="button" class="hintLink" @click="currentView = 'split'">看分板</button>
          <button type="button" class="hintLink" @click="emit('delivery')">导出图纸</button>
        </span>
      </p>

      <!-- 实际大小放不下：成品实物尺寸超过了浏览器单张画布的像素预算。
           不能假装是 1:1，直接把「现在只有实际的百分之多少」写出来。 -->
      <p v-if="!showEmpty && currentView === 'pattern' && actualCapped" class="codesHint">
        <span class="hintLong">
          成品 {{ finishCmText }}，按 1:1 铺开需要约 {{ Math.round(width * actualCellPx) }} px 宽，
          超过浏览器单张画布的像素上限；现在按实际的 {{ actualShownPct }}% 显示。
          要看细节请用分板视图逐块放大，或导出图纸对着拼。
        </span>
        <span class="hintShort">
          成品太大，屏幕只能显示到实际的 {{ actualShownPct }}%。
          <button type="button" class="hintLink" @click="currentView = 'split'">看分板</button>
          <button type="button" class="hintLink" @click="emit('delivery')">导出图纸</button>
        </span>
      </p>

      <!-- 缩放已经顶到像素上限：再按「＋」画面也不会变大（画布本身就这么大）。
           必须解释「不是你按坏了」并给出去哪儿看细节，否则用户只会以为缩放卡住了 -->
      <p v-if="!showEmpty && currentView === 'pattern' && zoomCapped && !actualMode" class="codesHint">
        <span class="hintLong">
          缩放已到上限：{{ width }}×{{ height }} 格的图纸整张铺开已经用满浏览器单张画布的像素上限
          （每格约 {{ cellPx.toFixed(1) }} px），再放大也只会变糊。
          要把每颗豆看得更清，请用分板视图逐块放大看，或者导出图纸对着拼。
        </span>
        <span class="hintShort">已到缩放上限，看细节请用分板视图或导出图纸。</span>
      </p>

      <!-- 手机端：画布右侧六颗轻量浮控（撤销 / 重做 + 视图控制），不占编辑区宽度，
           也不常驻工具条。浮控挂在 .stageWrap 上（不是 .stage 里），滚动图纸时位置不动。 -->
      <div
        v-if="!showEmpty && currentView === 'pattern'"
        class="stageTools no-print" role="toolbar" aria-label="画布视图控制"
      >
        <button
          type="button" class="stageTools__btn" title="撤销" aria-label="撤销"
          :disabled="!canUndo" @click="undo()"
        >
          <PixelIcon name="undo" :size="16" />
        </button>
        <button
          type="button" class="stageTools__btn" title="重做" aria-label="重做"
          :disabled="!canRedo" @click="redo()"
        >
          <PixelIcon name="redo" :size="16" />
        </button>
        <button
          type="button" class="stageTools__btn" :class="{ on: actualMode }"
          data-actual-btn-mobile
          :disabled="!hasPattern"
          :title="hasPattern ? `实际大小（成品 ${finishCmText}）` : '先生成图纸'"
          :aria-label="`实际大小${hasPattern ? `（成品 ${finishCmText}）` : ''}`"
          :aria-pressed="actualMode"
          @click="toggleActualSize"
        ><span class="stageTools__ratio">1:1</span></button>
        <button type="button" class="stageTools__btn" title="放大" aria-label="放大" @click="onUserZoom(zoom + 0.25)">
          <PixelIcon name="plus" :size="16" />
        </button>
        <button type="button" class="stageTools__btn" title="缩小" aria-label="缩小" @click="onUserZoom(zoom - 0.25)">
          <PixelIcon name="minus" :size="16" />
        </button>
        <button type="button" class="stageTools__btn" title="定位到图纸中心" aria-label="定位到图纸中心" @click="centerStage">
          <PixelIcon name="target" :size="16" />
        </button>
      </div>

      <!-- 桌面 / 平板：画布下方原来的两行工具条（手机上整块隐藏） -->
      <div class="editPanel">
        <div class="canvasCard__foot">
          <div class="toolgroup" role="toolbar" aria-label="编辑工具">
            <button
              v-for="t in tools" :key="t.key"
              class="tool" :class="{ on: tool === t.key }"
              :title="t.title" :aria-label="t.title" :aria-pressed="tool === t.key"
              @click="pickTool(t.key)"
            >
              <PixelIcon :name="t.icon" :size="15" />
              <span class="toolLabel">{{ t.label }}</span>
            </button>
            <span class="toolSep" aria-hidden="true"></span>
            <!-- 撤销/重做：外面套一层 span 专门放 title —— 原生 disabled 按钮在
                 Chrome 里不弹 tooltip，用户只能看到按钮变灰、不知道为什么变灰 -->
            <span
              v-for="h in history" :key="h.key"
              class="toolSlot" :title="historyTitle(h)"
            >
              <button
                class="tool" :aria-label="historyTitle(h)"
                :disabled="h.key === 'undo' ? !canUndo : !canRedo"
                @click="h.key === 'undo' ? undo() : redo()"
              >
                <PixelIcon :name="h.icon" :size="15" />
                <span class="toolLabel">{{ h.label }}</span>
              </button>
            </span>
            <!-- 镜像是一次性动作，不是「点了以后一直生效」的工具，所以不参与 tool 高亮。
                 外面套一层 .toolgroup__act：窄屏换行时整组一起走，不会单独把镜像甩到第二行。
                 同样套一层 .toolSlot：按钮禁用时 Chrome 不弹 disabled 按钮的 tooltip。 -->
            <div class="toolgroup__act">
              <span
                v-for="a in actions" :key="a.key"
                class="toolSlot" :title="actionTitle(a)"
              >
                <button
                  class="tool" :aria-label="actionTitle(a)"
                  :disabled="!hasPattern"
                  @click="mirrorPattern('h')"
                >
                  <PixelIcon :name="a.icon" :size="15" />
                  <span class="toolLabel">
                    <span class="actLong">{{ a.label }}</span><span class="actShort">{{ a.short }}</span>
                  </span>
                </button>
              </span>
            </div>
          </div>
          <div class="exportgroup">
            <slot name="export" />
          </div>
        </div>

        <div v-if="brush" class="brushBar">
          <span class="muted">当前画笔</span>
          <span class="swatchPill"><i :style="{ background: brush.hex }"></i>{{ brush.code }}</span>
          <template v-if="tool === 'paint' || tool === 'erase'">
            <span class="brushDivider" aria-hidden="true"></span>
            <div class="brushSize">
              <span class="muted">笔刷</span>
              <button
                class="brushStep" type="button" aria-label="缩小笔刷"
                :disabled="brushSize <= 1" @click="stepBrush(-1)"
              ><PixelIcon name="minus" :size="12" /></button>
              <input
                class="brushRange" type="range" min="1" :max="BRUSH_MAX" step="1"
                :value="brushSize" aria-label="笔刷大小（格）"
                @input="setBrushSize($event.target.value)"
              >
              <button
                class="brushStep" type="button" aria-label="放大笔刷"
                :disabled="brushSize >= BRUSH_MAX" @click="stepBrush(1)"
              ><PixelIcon name="plus" :size="12" /></button>
              <b class="brushSizeVal">{{ brushSize }} 格</b>
            </div>
          </template>
        </div>
      </div>
    </div><!-- /.stageWrap -->

    <!-- 手机专属：图纸滑出屏幕后浮在右下角（底部标签栏之上），点一下滚回图纸 -->
    <button
      v-if="hasPattern && stageOffscreen"
      class="miniPreview no-print" type="button"
      aria-label="回到图纸" title="回到图纸"
      @click="scrollToStage"
    >
      <PatternPreview :pattern="pattern" :max-size="128" />
      <span>回到图纸</span>
    </button>

    <!-- 屏幕校准：CSS 的 96dpi 只是名义值，真实 PPI 因设备而异。
         拿尺子对一次 5cm，本机记住比例，「实际大小」才真的接近实物。 -->
    <BaseDialog v-model="calibOpen" title="校准屏幕实际大小" size="sm">
      <div class="calib">
        <p class="calib__hint">
          拿一把尺子贴住屏幕，拖动下面的滑杆，让这段标尺正好是 <b>5 cm</b>。
          校准只影响「实际大小」预览，不改图纸数据。
        </p>
        <div class="calib__rulerBox">
          <div class="calib__ruler" :style="{ width: calibRulerPx + 'px' }" aria-hidden="true">
            <span
              v-for="i in 51" :key="i" class="calib__tick"
              :class="{ major: (i - 1) % 10 === 0, mid: (i - 1) % 5 === 0 && (i - 1) % 10 !== 0 }"
              :style="{ left: ((i - 1) / 50 * 100) + '%' }"
            ></span>
            <span
              v-for="cm in 6" :key="'n' + cm" class="calib__num"
              :style="{ left: ((cm - 1) / 5 * 100) + '%' }"
            >{{ cm - 1 }}</span>
          </div>
        </div>
        <label class="calib__range">
          <span>屏幕比例</span>
          <input
            type="range" min="0.7" max="1.3" step="0.01" :value="screenScale"
            data-calib-range aria-label="屏幕比例校准"
            @input="saveScreenScale($event.target.value)"
          >
          <b>{{ Math.round(screenScale * 100) }}%</b>
        </label>
        <p class="calib__note">
          默认按 CSS 的 96 dpi 换算。浏览器缩放、系统显示缩放或换显示器都会改变屏幕上的实际大小；
          校准一次后本机会记住，换设备再校准即可。
        </p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" type="button" @click="resetScreenScale">恢复默认</button>
        <button class="btn primary" type="button" @click="calibOpen = false">完成</button>
      </template>
    </BaseDialog>
  </section>
</template>

<style scoped>
.splitWrap,.materialsWrap,.compareWrap{width:min(940px,100%)}
.compareWrap{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.compareBox{margin:0;background:#fff;border:1px solid var(--line);border-radius:var(--r-md);padding:10px}
.compareBox img,.compareBox canvas{width:100%;display:block;border-radius:var(--r-xs);image-rendering:pixelated}
.compareBox figcaption{font-size:var(--fs-2xs);color:var(--muted);margin-top:7px;font-weight:700}
.splitHead{margin-bottom:12px}
/* 分板列表被截断时的说明 + 跳板输入：用和 .codesHint 同一套珊瑚色语义
   （都是「这里不完整，告诉你完整的去哪儿看」），但它是列表的一部分，
   所以宽度跟着列表走、能换行。 */
.boardListNote{
  display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;
  margin:0 0 10px;font-size:var(--fs-2xs);font-weight:700;color:#625800;
  background:rgba(255,218,53,.20);border:1px solid rgba(23,23,23,.22);
  border-radius:var(--r-sm);padding:7px 10px;
}
.boardListNote p{margin:0;line-height:1.5}
.boardJump{display:flex;align-items:center;gap:6px;white-space:nowrap}
.boardJump input{
  width:74px;padding:4px 6px;font:inherit;font-weight:800;color:var(--ink);
  border:1px solid transparent;border-radius:var(--r-xs);background:var(--surface-3);
}
.boardJump input:focus{background:var(--surface);border-color:var(--pink);box-shadow:0 0 0 3px rgba(255,142,199,.18);outline:0}
.boardFocusWrap{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.boardFocus{margin-top:10px;background:#fff;border:1px solid var(--line);border-radius:var(--r-md);padding:10px;display:grid;place-items:center;overflow:auto}
.boardFocus canvas{display:block;image-rendering:pixelated}
.materialsWrap .tableWrap{background:#fff}
/* 色号 LOD 提示：珊瑚色跟底板虚线同一套语义（图纸上的界限/说明），别用报错红 */
.codesHint{
  margin:8px 0 0;font-size:var(--fs-2xs);font-weight:700;color:#625800;
  background:rgba(255,218,53,.20);border:1px solid rgba(23,23,23,.22);
  border-radius:var(--r-sm);padding:7px 10px;
}
/* 舞台和它下面的说明 / 工具条 / 笔刷条同属一块，舞台 flex:1 吃掉剩余高度。
   右侧工具窄栏与抽屉都相对这块定位，所以它必须是定位上下文。 */
.stageWrap{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.editPanel{display:block}
/* 手机端才出现的部件：画布浮控 / 上传提示。桌面端全部不占位。
   顶栏浮层（.cmdPop）的显隐在 global.css：功能浮层由 EditorView 渲染。 */
.stageTools,.genNotice{display:none}
/* 手机端顶栏的适应按钮与缩放胶囊；桌面端仍是原来的缩放组 */
.fitTop,.zoomIco{display:none}
.zoomPill{display:contents}
/* 实际大小：工具条按钮的选中态 + 画布左上角的状态条。
   状态条是 overlay，不参与舞台排版，所以放大后图纸也不会被它挤窄。 */
/* 1320 这一档工具栏放不下时会折成两行：第二行的缩放组靠右，
   和上一行的页签右端对齐，看起来才像一组控制而不是掉下来的一截。 */
.canvasCard__toolbar .zoomBar{margin-left:auto}
.zoomBar .actualBtn.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary-ink)}
.actualBadge{
  position:absolute;left:8px;top:8px;z-index:20;
  display:flex;align-items:center;gap:7px;flex-wrap:wrap;
  padding:6px 9px;border-radius:999px;border:1px solid var(--line);
  background:rgba(255,255,255,.97);box-shadow:0 4px 14px rgba(24,24,28,.12);
  font-size:var(--fs-2xs);font-weight:800;color:var(--ink-2);
}
.actualBadge__dot{width:7px;height:7px;border-radius:50%;background:var(--green-deep);flex:0 0 auto}
.actualBadge b{color:var(--ink);font-weight:900;white-space:nowrap}
.actualBadge__cm{white-space:nowrap;font-variant-numeric:tabular-nums}
.actualBadge__link{
  padding:0;border:0;background:transparent;color:var(--coral-deep);
  font:inherit;font-weight:850;text-decoration:underline;white-space:nowrap;
}
.stageTools__ratio{font-size:11px;font-weight:900;line-height:1;letter-spacing:-.03em}
.stageTools__btn.on{background:var(--primary-soft);color:var(--primary-ink);border-color:var(--primary)}
.stageTools__btn:disabled{opacity:.4}
/* 校准弹窗：尺子按 CSS 像素画，滑杆改比例，标签跟着尺子走 */
.calib__hint{margin:0 0 12px;font-size:var(--fs-2xs);line-height:1.7;color:var(--ink-2)}
.calib__rulerBox{
  overflow-x:auto;padding:16px 12px 6px;background:var(--surface-2);
  border:1px solid var(--line);border-radius:var(--r-sm);
}
.calib__ruler{position:relative;height:44px;margin:0 auto;border-bottom:2px solid var(--ink)}
.calib__tick{position:absolute;bottom:0;width:1px;height:7px;background:var(--ink-2)}
.calib__tick.mid{height:11px}
.calib__tick.major{height:16px;width:1.5px;background:var(--ink)}
.calib__num{
  position:absolute;bottom:19px;transform:translateX(-50%);
  font-size:10px;font-weight:800;color:var(--ink-2);
}
.calib__range{
  display:flex;align-items:center;gap:8px;margin-top:14px;
  font-size:var(--fs-2xs);font-weight:800;color:var(--ink-2);
}
.calib__range input{flex:1;accent-color:var(--primary)}
.calib__range b{min-width:42px;text-align:right;font-variant-numeric:tabular-nums}
.calib__note{margin:12px 0 0;font-size:10px;line-height:1.6;color:var(--muted)}
.hintLink{
  margin-left:6px;padding:0;border:0;background:transparent;color:var(--coral-deep);
  font:inherit;font-weight:850;text-decoration:underline;
}
/* 分隔线不跟着按钮拉伸：手机上工具组会换成两行，拉满高度会变成一条很长的竖线 */
.toolSep{width:1px;height:26px;align-self:center;background:var(--line-strong);margin:0 3px}
/* 8 颗按钮在 1440 三栏的中栏里正好卡满一行：间距从 6 收到 4，
   否则总宽和容器一样宽，四舍五入就会把最后一颗挤到第二行 */
/* 这一排整体比原来低 2px（视觉微调）。用 transform 不用 padding：
   行高不变、画布高度不变，只是整排下移。 */
.toolgroup{gap:4px;transform:translateY(2px)}
/* 镜像绑成一组：窄屏换行时整组一起下去。手机端改成 display:contents，
   让镜像按钮直接成为网格的格子。 */
.toolgroup__act{display:flex;gap:4px;flex:0 0 auto;align-items:stretch}
/* 撤销/重做外面那层：只为了在按钮 disabled（Chrome 不给 disabled 按钮弹
   tooltip）时还能显示「为什么不能点」。桌面端宽度跟着按钮走，手机上跟着工具组一起伸缩 */
.toolSlot{display:flex;min-width:0}
.toolSlot .tool{flex:1 1 auto}
/* 宽屏用全名「拼豆图纸」，手机上在媒体查询里换成短名 */
.tabShort{display:none}
/* 镜像按钮同理：宽屏「左右镜像」，手机上换成「左右」才塞得进 9 格 */
.actShort{display:none}
@media(max-width:780px){
  .toolSlot{flex:1 1 auto}
  /* 手机工作台把工具收成一行（5 个工具 + 撤销 / 重做 + 镜像 = 8 格），
     省下纵向空间。它是 .canvasCard__foot 的 flex 子项，必须 flex:1 才会撑满；
     否则按内容宽缩在左边，每格只剩 24px，标签会折成竖排。
     exportgroup 在手机上会被全局的 width:100% 撑开、把工具组挤扁，
     这里收回 auto（工作台的导出入口已经移进命令栏的「交付」）。 */
  .toolgroup{
    display:grid;grid-template-columns:repeat(8,minmax(0,1fr));
    flex:1 1 auto;gap:3px;justify-content:stretch;
  }
  .exportgroup{width:auto;flex:0 0 auto}
  /* 8 格之后每格只剩 30 多像素，图标 + 文字横排会互相挤：
     改成图标在上、文字在下，标签仍留在按钮里。 */
  .toolgroup .tool{
    width:100%;flex-direction:column;gap:2px;padding:3px 2px;
  }
  .toolSep{display:none}
  .toolSlot{display:block}
  /* 手机上是网格：拆掉镜像那层包裹，按钮直接占一格 */
  .toolgroup__act{display:contents}
  .actLong{display:none}
  .actShort{display:inline}
}
.stage--empty .empty__icon{
  width:58px;height:58px;border-radius:18px;background:var(--primary-soft);color:var(--primary-ink);
}
/* 桌面 / 平板空状态：引导直接铺在奶油色舞台上，不要虚线框和内边距 */
@media(min-width:781px){
  .empty--guide{
    width:100%;padding:0;border:0;border-radius:0;background:transparent;color:var(--ink);
  }
  .stage--empty{background:#FDFAF2;padding:clamp(12px,2vw,26px)}
}
/* 手机空状态保持原样：原来直接摊在 .empty 里的元素现在收进这层 */
.emptyLegacy{display:flex;flex-direction:column;align-items:center;gap:11px;width:100%}
.emptyActions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}
.brushBar{display:flex;align-items:center;gap:9px;padding-top:9px;justify-content:center;flex-wrap:wrap}
.brushDivider{width:1px;height:18px;background:var(--line-strong)}
.brushSize{display:flex;align-items:center;gap:6px}
.brushStep{
  width:30px;height:30px;flex:0 0 auto;border:1px solid var(--line);border-radius:8px;
  background:var(--surface);color:var(--ink-2);font-size:15px;font-weight:900;line-height:1;
  display:grid;place-items:center;
}
.brushStep:hover:not(:disabled){background:var(--surface-3)}
.brushStep:disabled{opacity:.4;cursor:not-allowed}
.brushRange{width:104px;accent-color:var(--primary);cursor:pointer}
.brushSizeVal{min-width:38px;text-align:center;font-size:var(--fs-2xs);color:var(--ink-2);white-space:nowrap}
/* 手机专属的浮动图纸缩略图：桌面端画布一直看得见，直接不显示 */
.miniPreview{
  display:none;position:fixed;right:10px;bottom:78px;z-index:45;
  flex-direction:column;align-items:center;gap:1px;
  padding:5px 5px 3px;border-radius:var(--r-md);border:1px solid var(--line);
  background:rgba(255,255,255,.97);box-shadow:0 10px 28px rgba(24,24,28,.2);
}
.miniPreview canvas{display:block;width:auto;height:auto;max-width:62px;max-height:62px;image-rendering:pixelated}
.miniPreview span{font-size:var(--fs-2xs);font-weight:800;color:var(--muted);white-space:nowrap}
canvas{display:block}
@media(max-width:780px){
  .compareWrap{grid-template-columns:1fr}
  /* 手机工作台改成「一屏」：画布卡片吃掉命令栏上方的全部高度，
     舞台 flex:1，缩放交给双指捏合，所以顶栏只留「适应」一个按钮。 */
  .canvasCard{height:100%;padding:8px}
  /* 工具条 + 笔刷条在手机上整块隐藏：工具进顶栏「编辑 ▾」浮层，
     省下的两行高度全部给 .stage。 */
  .editPanel{display:none}

  /* 上传结果：紧凑卡放在画布上方，不覆盖画布中心、不吞触摸 */
  .genNotice{
    display:block;flex:0 0 auto;margin-top:6px;padding:8px 9px;
    border:1px solid var(--line);border-radius:12px;background:var(--surface);
    box-shadow:var(--sh-1);
  }
  .genNotice__head{display:flex;align-items:center;gap:6px;font-size:var(--fs-2xs)}
  .genNotice__head b{font-size:var(--fs-xs);font-weight:850;color:var(--ink)}
  .genNotice__badge{
    width:16px;height:16px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;
    background:var(--green-soft);color:var(--green-deep);
  }
  .genNotice__close{
    margin-left:auto;width:28px;height:28px;flex:0 0 auto;border:0;border-radius:8px;
    display:grid;place-items:center;background:transparent;color:var(--muted);
  }
  .genNotice__close:active{background:var(--surface-3)}
  .genNotice__body{display:flex;align-items:flex-start;gap:8px;margin-top:5px}
  .genNotice__thumb{
    width:42px;height:42px;flex:0 0 auto;object-fit:contain;border-radius:8px;
    background:var(--surface-2);border:1px solid var(--line);
  }
  .genNotice__meta{min-width:0;flex:1}
  .genNotice__meta p{display:flex;align-items:baseline;gap:6px;margin:0;font-size:var(--fs-2xs);color:var(--muted)}
  .genNotice__meta p b{font-size:var(--fs-2xs);font-weight:850;color:var(--ink)}
  .genNotice__suggest b{color:var(--primary-ink)}
  .genNotice__actions{display:flex;align-items:center;gap:12px;margin-top:4px}
  .genNotice__link{
    padding:0;border:0;background:transparent;color:var(--coral-deep);
    font:inherit;font-size:var(--fs-2xs);font-weight:850;text-decoration:underline;
  }
  .genNotice__detail{
    margin:6px 0 0;padding-top:6px;border-top:1px dashed var(--line);
    font-size:9px;line-height:1.5;color:var(--muted);
  }

  /* 画布右侧浮控：四颗方形按钮贴在画布右上角，不随图纸滚动。
     它们是 overlay，不参与 .stage 排版；stage 只留一条窄内边距。 */
  .stageTools{
    display:flex;position:absolute;top:50%;right:8px;z-index:18;
    transform:translateY(-50%);flex-direction:column;gap:5px;
  }
  .stageTools__btn{
    width:38px;height:38px;flex:0 0 auto;border:1px solid var(--line);
    border-radius:10px;display:grid;place-items:center;
    background:rgba(255,255,255,.97);color:var(--ink);
    box-shadow:0 4px 12px rgba(24,24,28,.10);
  }
  .stageTools__btn:active{background:var(--primary-soft);color:var(--primary-ink)}
  .fitTop{
    width:34px;height:34px;flex:0 0 auto;display:grid;place-items:center;
    border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);
    box-shadow:var(--sh-1);
  }
  .fitTop:active{background:var(--primary-soft);color:var(--primary-ink)}
  .zoomPill{
    display:flex;align-items:center;gap:3px;height:34px;padding:0 7px;
    border:1px solid var(--line);border-radius:10px;background:var(--surface);
  }
  .zoomIco{display:block;color:var(--muted)}
  .canvasCard__toolbar{position:relative;flex-direction:row;align-items:center;gap:5px;padding-bottom:6px;flex-wrap:nowrap}
  .viewtabs{flex:1;min-width:0;border-bottom:0}
  .viewtabs button{flex:1;padding:6px 2px;font-size:var(--fs-2xs)}
  .viewtabs button .icon{display:none}
  /* 手机顶栏只留 图纸 / 原图 / 对照：分板与材料从「编辑 ▾ → 分板视图」、
     分析/用量卡片进入，顶栏不再挤五个页签。 */
  .viewtabs button:nth-child(n+4){display:none}
  .tabLong{display:none}
  .tabShort{display:inline}
  /* 缩放只留实时百分比：加减 / 适应移到画布右侧浮控上 */
  .zoomBar{gap:0;flex:0 0 auto}
  .zoomBar .btn{display:none}
  .zoomBar .zoomText{min-width:34px;font-size:var(--fs-2xs);text-align:right}
  @media (max-width:360px){
    .canvasCard__toolbar{gap:3px}
    .viewtabs button{padding:6px 1px;font-size:10px}
    /* 320 宽：三个页签 + 实时缩放 + 两颗命令按钮会挤掉「对照」，
       这一档去掉页签图标，文字完整可点。 */
    .viewtabs button .pixelIcon{display:none}
    .zoomBar .zoomText{min-width:30px;font-size:10px}
  }
  .panState{display:none}
  .stage{flex:1;height:auto;min-height:0;padding:8px}
  /* 图纸视图左右等距：浮控是 overlay，贴在画布右上/右中，
     不靠内边距给它们让位（否则图纸会偏左、白白少掉一条宽度）。 */
  .stage--edit{padding-right:8px}
  /* 手机上不再留那行手势说明：右侧浮控已经给了缩放入口，
     省下的约 20px 全部给画布。 */
  .chartNote{display:none}
  .canvasCard__foot{flex-direction:row;align-items:center;padding-top:6px;flex-wrap:nowrap;gap:4px}
  .tool{padding:4px 2px;min-height:38px;gap:2px}
  .toolLabel{font-size:9px}
  .brushBar{padding-top:4px;font-size:var(--fs-2xs);gap:6px}
  .brushRange{width:78px}
  .brushSize{gap:4px}
  .brushSizeVal{min-width:34px;font-size:9px}
  .miniPreview{display:flex}
}
/* 小屏手机（360×640 之类）：命令栏和标签栏的高度不变，
   画布只能靠压掉说明文字来保住可操作面积。工具名保留 ——
   只留图标时用户认不出移动 / 填充 / 吸色的区别。 */
@media(max-width:780px) and (max-height:700px){
  .chartNote{display:none}
  .tool{min-height:32px;gap:2px}
  .toolLabel{font-size:9px}
  .brushBar{padding-top:2px;font-size:9px}
}
/* 320px 级窄屏：笔刷条一行放不下会折行，把画布压到出现内部滚动。
   去掉「当前画笔」四个字（色块还在），滑块和按钮各收一点。 */
@media(max-width:360px){
  .brushBar > .muted:first-child{display:none}
  .brushRange{width:64px}
  .brushStep{width:28px;height:28px}
  .brushSizeVal{min-width:30px}
}
</style>
