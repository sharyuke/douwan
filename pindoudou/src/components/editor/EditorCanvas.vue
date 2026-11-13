<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  pattern, hasPattern, width, height, zoom, setZoom, tool, brushColorId,
  BRUSH_MAX, toolSizeOf, setToolSize, beadKey,
  options, currentView, canvasEl, paintAt, paintLine, fillAt, pickAt, shiftPattern, restorePendingPattern, undo, redo,
  canUndo, canRedo, undoDepth, redoDepth, beginEdit, endEdit, cancelEdit, revertEdit,
  mirrorPattern, replaceColorEverywhere, clearColorEverywhere, nearestSwapColor, swapMode, brushStroke,
  stats, sourceUrl, sourceImg, sourceCssFilter, generating, genMs,
  selectedBoard, layout, materials
} from '../../composables/useStudio.js'
import { toastOk, toastWarn } from '../../composables/useToast.js'
import { useShortcutTip } from '../../composables/useShortcutTip.js'
import { drawChart, drawPixels, drawBoard, hitTest, chartGeometry, chartCellCap, updateChartLayer, markChartLayer, canvasDpr, renderOffscreen } from '../../lib/render.js'
import { boardBeadCounts } from '../../lib/pattern.js'
import { beadOf, boardOf, BOARD_SPEC_LIST_TEXT } from '../../lib/boardSpec.js'
import { getColorById } from '../../lib/palettes.js'
import { EDIT_TOOLS, EDIT_HISTORY, EDIT_ACTIONS } from '../../data/icons.js'
import Icon from '../ui/Icon.vue'
import BaseDialog from '../ui/BaseDialog.vue'
import BoardPreviewDialog from './BoardPreviewDialog.vue'
import PatternPreview from '../ui/PatternPreview.vue'
import EditorEmptyGuide from './EditorEmptyGuide.vue'
import CanvasRuler from './CanvasRuler.vue'

/* 手机端：上传命令直接放在画布空状态里（桌面端仍指向左栏的 ① 创建） */
const emit = defineEmits(['upload', 'browse', 'delivery', 'split'])

/* chrome:
   'default' —— 卡片自带「页签 + 缩放」顶栏与底部两行工具条（手机 / 平板版面）
   'console' —— 全屏工作台：这两块都由 EditorView 的新命令栏 / 工具栏接管，
                卡片本身只剩画布，四周描边与底色也交给外层（见 .canvasCard--console） */
const props = defineProps({
  chrome: { type: String, default: 'default' },
  /* 平板档锁画布：整张图纸固定在「适应窗口」，不提供缩放与平移入口。
     画笔 / 橡皮 / 填充 / 吸色 / 撤回这些编辑能力不受影响。 */
  locked: { type: Boolean, default: false }
})
const consoleChrome = computed(() => props.chrome === 'console')

/* 图纸转换空状态里的上传卡可以被关掉（设计稿那张卡右上角有个 ×）。
   关掉后画布留白，命令栏的「更换图片」照常能上传，这里再给一个小的入口。 */
const uploadDismissed = ref(false)

/** 当前画笔颜色（用于底部提示条） */
const brush = computed(() => {
  const p = pattern.value
  if (!p) return null
  return p.palette.find(c => c.id === brushColorId.value) || p.palette[p.palette.length - 1] || null
})

/** 画笔 / 橡皮各自的笔刷大小（格）。滑块和 −/＋ 都走这里，保证范围一致 */
const activeToolSize = computed(() => toolSizeOf())
function setBrushSize(value) { setToolSize(value) }
function stepBrush(delta) { setBrushSize(activeToolSize.value + delta) }

/** 每块板真正要放的豆数（空格不算） */
const boardBeads = computed(() => (pattern.value && layout.value ? boardBeadCounts(pattern.value, layout.value) : []))
function beadsOfBoard(b) {
  return boardBeads.value[b.no - 1] != null ? boardBeads.value[b.no - 1] : b.cells
}

const cv = ref(null)
const stageEl = ref(null)
const wrapEl = ref(null)
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

/* 底部编辑工具：图标 + 文字，数据都在 data/icons.js（同一套线性规范）。
   平板锁画布时去掉「移动」：画布固定，留着它只会让人以为还能拖。 */
const tools = computed(() => props.locked ? EDIT_TOOLS.filter(t => t.key !== 'pan') : EDIT_TOOLS)
const history = EDIT_HISTORY
const actions = EDIT_ACTIONS

/** 整图动作的 tooltip：没有图纸时按钮是灰的，要说清楚原因 */
function actionTitle(a) {
  return hasPattern.value ? a.title : `${a.label}：先生成图纸后才能翻转`
}

/* 快捷键浮动标签（悬停工具时浮出来的那张小标签，与全屏工作台共用一份状态） */
const { onTipOver, hideTip } = useShortcutTip()

/**
 * 撤销/重做的 tooltip。除了快捷键，还把「能不能点 / 攒了几步」写进去：
 * 按钮变灰的时候用户最想知道的就是「为什么不能点」。
 */
function historyTitle(h) {
  const isUndo = h.key === 'undo'
  const n = isUndo ? undoDepth.value : redoDepth.value
  /* 平板上撤销 / 重做按钮不写 Ctrl+Z / Ctrl+Y */
  const base = desk.value ? h.title : h.title.replace(/\s*\([^)]*\)\s*$/, '')
  if (!n) {
    return isUndo
      ? `${base} · 现在没有可撤销的操作：画一笔，或改一下尺寸、色板、参数`
      : `${base} · 现在没有可重做的操作：撤销之后才有`
  }
  return `${base} · 可${isUndo ? '撤销' : '重做'} ${n} 步`
}

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
const cellCap = computed(() => chartCellCap(width.value, height.value, rulerInChart.value ? 26 : 0))

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
  if (props.locked || !hasPattern.value) return
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

/* 全屏工作台（≥1100）的标尺是贴在视口上的覆盖层，条宽与 CanvasRuler 一致。
   图纸的左上角贴在这两条的内沿上，舞台其余部分也是画布，不再缩进一块小卡片。 */
const RULER_L = 32
const RULER_T = 28
const deskQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(min-width:1100px)')
  : null
const desk = ref(deskQuery ? deskQuery.matches : true)
function onDeskChange(e) { desk.value = e.matches }
/** 工具的原生 tooltip。电脑端带上快捷键（B / E / G / I…），
    悬停时另有浮动标签写同一份信息。平板 / 手机没有这套键，标题里不写键名。 */
function toolTitle(t) {
  /* 竖屏平板没有 Shift，标题里不写「按住 Shift 拖左键画直线」。 */
  if (!desk.value && t.key === 'paint') return '画笔：点一下格子就改成当前颜色'
  if (!desk.value) return t.title
  return t.shortcut ? `${t.title}（${t.shortcut}）` : t.title
}
/* 只有电脑端全屏工作台走「贴标尺的整幅画布」。手机全屏工作台仍用原来的内边距。 */
const consoleViewport = computed(() =>
  consoleChrome.value && desk.value && currentView.value === 'pattern' && !showEmpty.value
)

/* ---------------------------------------------------------------- 手机端工具
   ≤780px：工具改成画布下方常驻的一行（由 EditorView 渲染），
   画布上只留右侧轻量浮控（实际大小 / 放大 / 缩小 / 居中）。
   桌面端这套浮控 display:none，画布下方原来的两行工具条一行没动。 */
function pickTool(key) {
  tool.value = key
}
/** 竖屏平板的画笔条。和电脑、手机菜单同一根斜线图标，再点一次回到涂抹。 */
function toggleBrushLine() {
  brushStroke.value = brushStroke.value === 'line' ? 'free' : 'line'
  tool.value = 'paint'
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
  if (props.locked) return
  const stage = stageEl.value
  if (!stage) return
  if (consoleViewport.value) {
    ensureGutter(true)
    const board = boardBox()
    if (!board) return
    const br = board.getBoundingClientRect()
    const visW = stage.clientWidth - RULER_L
    const visH = stage.clientHeight - RULER_T
    scrollBoardTo(RULER_L + (visW - br.width) / 2, RULER_T + (visH - br.height) / 2)
    scheduleRuler()
    return
  }
  stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2)
  stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
}
/* 标尺画在哪儿：默认版面（手机 / 平板）仍旧画进图纸位图；
   全屏工作台改成贴边覆盖层（见下面的 CanvasRuler），位图里不再带标尺 ——
   否则同一张图上会有两条标尺，而且位图里那条会跟着图纸一起缩放、被裁掉。 */
const rulerInChart = computed(() => !consoleChrome.value)

const chartOpts = computed(() => ({
  cell: cellPx.value,
  ruler: rulerInChart.value,
  grid: options.showGrid,
  codes: options.numbering,
  bold: true,
  boardLines: options.boardLines,
  boardLabels: true,
  /* 手机全屏工作台（chrome='console'）没有四边留白，边缘中心三角会压在
     标尺数字上；缩放栏已经给了定位入口，这里不画。 */
  centerMarks: !(consoleChrome.value && !wide.value)
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
  syncHeldOverlay()
  /* 画布尺寸刚变过：贴边标尺的格子像素、成品标注都要跟着重算 */
  scheduleRuler()
  /* 换钉板 / 换图后画布有了新尺寸：手动缩放过（autoFit 关着，没有「适应」
     那一轮收尾）就把视野摆回标尺内侧正中，别停在左上角。
     自动适配那条路由 settleAfterFit 在适配结束后处理，这里不抢。 */
  if (recenterPending && !autoFit) {
    recenterPending = false
    centerStage()
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
  /* 格子没变、只是画布外的豆子又挪了一格时，脏矩形不会重画，覆盖层仍要跟上。 */
  syncHeldOverlay()
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
    if (currentView.value === 'split') drawBoardPreviews()
  })
}

/* 只有豆子变了：走脏矩形，别把整张图纸再画一遍 */
watch(pattern, () => nextTick(redrawCells))
/* 换图或改画布尺寸后，旧选区对不上新格子。
   不能盯着 pattern 本身：套索松手时 endEdit 也会换一份图案，
   那个更新是异步刷出来的，到那时拖动标记已经放下，选区会被误清。 */
watch(sourceUrl, () => clearLasso())
watch([width, height], () => { if (!lassoDrag.value) clearLasso() })
/* 撤销 / 重做会把格子退回拖之前，选框必须一起回去。
   拖动过程中历史深度不变，这里不会误清正在拖的那一框。 */
watch([undoDepth, redoDepth], () => {
  if (lassoDrag.value || !lasso.value) return
  const target = undoDepth.value
  while (lassoShiftAt > target && lassoShiftAt > 0) {
    const step = lassoShifts[lassoShiftAt - 1]
    lasso.value = shiftSelection(lasso.value, -step.dx, -step.dy, width.value, height.value) || lasso.value
    lassoShiftAt--
  }
  while (lassoShiftAt < target && lassoShiftAt < lassoShifts.length) {
    const step = lassoShifts[lassoShiftAt]
    lasso.value = shiftSelection(lasso.value, step.dx, step.dy, width.value, height.value) || lasso.value
    lassoShiftAt++
  }
})
/* 缩放只换格子尺寸：图案层还能用，重铺一遍装饰层即可。
   cellPx 是四舍五入过的，这里盯的是真正参与绘制的 hitCell ——
   顺手作废脏矩形的基准几何，免得落笔时拿旧尺寸的换算去刷新的画布 */
watch(hitCell, () => {
  invalidateLayer()
  nextTick(() => {
    draw()
    /* 格子变大之后补够四周空白，移动工具才能继续把图纸拖出视口。
       适应窗口那一轮自己会贴回标尺，这里不要抢滚动位置。 */
    if (consoleViewport.value && !fitting) ensureGutter(true)
  })
})
/* 网格 / 色号 / 底板虚线也只影响装饰层 */
watch([() => options.numbering, () => options.showGrid, () => options.boardLines], () => nextTick(draw))
watch([width, height], () => {
  if (pattern.value) recenterPending = true
  resetPan()
  redrawAll()
  /* 上传 / 换图会把画布换成新的宽高比：不重新适配的话，
     沿用上一张图的缩放倍数，新图纸会顶出舞台（手机上表现为只看到一角）。 */
  if (autoFit) nextTick(() => setTimeout(fitToStage, 60))
})
/* 换到仍装得下的小板时，成品区域不变、width/height 也不变，但图纸格子从 104 变成 52：
   沿用旧缩放会让新底板顶出舞台，看不到四周留空，所以同样重新适配一次。
   换到大板时成品尺寸会填到新板的最大值，width/height 那一路已经会适配。
   必须分开盯两个数：getter 返回新数组时每次落笔都算「变过」，
   会把刚挪好的视野在画完一笔后拽回正中。 */
watch([() => pattern.value && pattern.value.width, () => pattern.value && pattern.value.height], () => {
  recenterPending = true
  if (autoFit) nextTick(() => setTimeout(fitToStage, 60))
})
/* 画布尺寸没变、只是从空状态变成有图纸（素材默认就是 52×52 这类情况）时，
   width/height 不会触发，图纸会停在 100% 被裁掉一半。第一次出现图纸也适配一次。 */
watch(hasPattern, v => {
  if (!v) return
  recenterPending = true
  nextTick(() => setTimeout(() => { if (autoFit) fitToStage() }, 80))
})
/* 平板档锁画布：切到这一档时退回编辑工具、退出实际大小，
   把整张图纸重新按舞台适配一次，舞台的滚动位置也归零。 */
function lockCanvasView() {
  if (tool.value === 'pan') tool.value = 'paint'
  exitActualSize({ restore: false })
  autoFit = true
  nextTick(() => {
    fitToStage()
    const stage = stageEl.value
    if (stage) {
      stage.scrollLeft = 0
      stage.scrollTop = 0
    }
  })
}
watch(() => props.locked, locked => { if (locked) lockCanvasView() })
watch(currentView, () => redrawAll())
watch(generating, v => { if (!v) redrawAll() })
/* 从原图 / 对照回到拼豆图纸，或从窄屏跨进全屏工作台：
   舞台的内边距与可用区变了，画布直接摆回标尺内侧正中，别停在旧位置。 */
watch(consoleViewport, v => {
  if (!v) return
  nextTick(() => setTimeout(centerStage, 40))
})

/* ---------------------------------------------------------------- 缩放平移 */

const dragging = ref(false)
/* 中键拖动中：光标要变成「抓取」，否则画布上的 crosshair 会盖住舞台的 grab */
const midPan = ref(false)
let moved = false
let startX = 0
let startY = 0
let startLeft = 0
let startTop = 0
let painting = false
/** 这一笔走直线时的起点格子。画笔菜单选了「直线」，或按住 Shift 按下左键，都会记下它。 */
let lineStroke = null
const paintNote = computed(() => (brushStroke.value === 'line'
  ? '从按下的格子拉一条直线（当前工具：画笔）'
  : '点格子改色（当前工具：画笔）'))

/* 触屏上的分工：单指 / 笔只编辑，画布固定。
   浏览器默认会把单指拖动解释成滚动（画布跟着手指跑），
   所以舞台在图纸视图下关掉了原生手势（见 global.css 的 .stage--edit）。
   两指手势先不结算：两指一起轻点 = 撤回，捏合 = 缩放画布。
   不看窗口宽度：iPad 横过来往往 ≥1100。
   手指设备上全屏工作台不启用「overflow + 滚动平移」（见本文件末尾的媒体查询），
   手指移动时再 preventDefault 一次，挡住浏览器自己改 scrollLeft。
   鼠标滚轮缩放、中键拖动平移不受影响。 */
const touchPoints = new Map()
/** 双指手势进行中；松手时按 mode 决定是撤回还是什么都不做 */
let twoFingerGesture = null
/* 两指刚落下时先不判断：距离变化超过这个像素才算捏合，
   中点 / 单指移动超过这个像素就算「动过」，松手时不再当轻点。 */
const TWO_FINGER_PINCH_SLOP = 10
const TWO_FINGER_TAP_SLOP = 12
/* 两指按住超过这个时长还没动，就不当成轻点撤回（避免长按误撤） */
const TWO_FINGER_TAP_MS = 500


/* 手指按住一格约半秒就吸色，不限当前工具，然后切回画笔。
   吸色时手指上方放一面放大镜，跟着格子走，方便对准。
   不看窗口宽度：iPad 横过来往往 ≥1100，按宽度会把平板当成电脑、长按完全不生效。
   只认 touch。鼠标、触控笔长按仍按当前工具画，免得和拖动画笔打架。
   手指按住时会有十几像素的抖动，小于一颗豆的移动不算「开始拖」。
   放大镜已经打开之后，再移动是在选格子，不再取消。 */
const LONG_PRESS_MS = 420
const FINGER_PICK_SLOP = 28
const LOUPE_ZOOM = 3
const fingerLoupe = ref(false)
const fingerLoupeCode = ref('')
const fingerPickX = ref(0)
const fingerPickY = ref(0)
const loupeCv = ref(null)
let fingerPickTimer = 0
let fingerPickPointer = null
let fingerPickDownX = 0
let fingerPickDownY = 0
let lassoBeforeFinger = null
let loupeCell = -1
let loupeGotColor = false
/** 这次长按已经吸过色：松手时不要再当成单击（否则会用刚吸到的颜色盖住那一格） */
let fingerPicked = false

function stopFingerPickTimer() {
  if (fingerPickTimer) {
    clearTimeout(fingerPickTimer)
    fingerPickTimer = 0
  }
  fingerPickPointer = null
}

function clearFingerPick() {
  stopFingerPickTimer()
  fingerLoupe.value = false
  fingerLoupeCode.value = ''
  loupeCell = -1
  loupeGotColor = false
}

/** 手指按下：任何工具都开始计时长按吸色。宽度不参与，横屏平板也算。 */
function armFingerPick(e) {
  clearFingerPick()
  if (e.pointerType !== 'touch' || e.button !== 0) return
  if (currentView.value !== 'pattern' || showEmpty.value) return
  lassoBeforeFinger = lasso.value
  fingerPickPointer = e.pointerId
  fingerPickDownX = e.clientX
  fingerPickDownY = e.clientY
  fingerPickX.value = e.clientX
  fingerPickY.value = e.clientY
  fingerPickTimer = window.setTimeout(() => {
    fingerPickTimer = 0
    if (fingerPickPointer !== e.pointerId) return
    if (twoFingerGesture || touchPoints.size >= 2) return
    /* 用按下时的位置，不跟手指抖动走，避免吸到旁边那一格 */
    runFingerPick(fingerPickDownX, fingerPickDownY)
  }, LONG_PRESS_MS)
}

/** 这一笔已经开始的画笔 / 橡皮 / 套索先退回，再吸按下前的颜色。 */
function cancelToolGestureForPick() {
  if (painting) {
    revertEdit()
    painting = false
    lineStroke = null
  }
  if (lassoDrag.value) revertEdit()
  lassoDrag.value = false
  lassoTrace.value = null
  lassoAnchor = null
  lassoMoveBase = null
  dragging.value = false
  midPan.value = false
  lasso.value = lassoBeforeFinger
}

function paintLoupe(clientX, clientY) {
  const src = cv.value
  const dest = loupeCv.value
  if (!src || !dest || !fingerLoupe.value) return
  const rect = src.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const css = 120
  const bw = Math.round(css * dpr)
  const bh = bw
  if (dest.width !== bw) dest.width = bw
  if (dest.height !== bh) dest.height = bh
  const scaleX = src.width / rect.width
  const scaleY = src.height / rect.height
  const cx = (clientX - rect.left) * scaleX
  const cy = (clientY - rect.top) * scaleY
  const sw = bw / LOUPE_ZOOM
  const sh = bh / LOUPE_ZOOM
  const ctx = dest.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, bw, bh)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, bw, bh)
}

/** 放大镜中心对准这一格。有颜色就吸下来；空格先留着，等手指挪到有豆的格子。 */
function sampleLoupe(clientX, clientY) {
  fingerPickX.value = clientX
  fingerPickY.value = clientY
  const hit = cv.value && pattern.value
    ? hitTest(cv.value, pattern.value, { clientX, clientY }, hitOpts.value)
    : null
  if (!hit) {
    loupeCell = -1
    fingerLoupeCode.value = ''
    return
  }
  if (hit.index === loupeCell && fingerLoupe.value) return
  loupeCell = hit.index
  const c = pickAt(hit.x, hit.y)
  fingerLoupeCode.value = c ? c.code : ''
  if (!c || loupeGotColor) return
  loupeGotColor = true
  fingerPicked = true
  moved = true
  tool.value = 'paint'
  toastOk(`已吸取 ${c.code}，松手后用画笔继续`)
}

/** 长按成立：打开放大镜，并吸按下的那一格。 */
function runFingerPick(clientX, clientY) {
  if (!cv.value || !pattern.value) return
  cancelToolGestureForPick()
  const hit = hitTest(cv.value, pattern.value, { clientX, clientY }, hitOpts.value)
  if (!hit) { clearFingerPick(); return }
  fingerLoupe.value = true
  loupeCell = -1
  sampleLoupe(clientX, clientY)
  nextTick(() => paintLoupe(clientX, clientY))
}

function moveFingerLoupe(clientX, clientY) {
  sampleLoupe(clientX, clientY)
  paintLoupe(clientX, clientY)
}

function finishFingerLoupe() {
  const missed = fingerLoupe.value && !loupeGotColor
  clearFingerPick()
  if (missed) toastWarn('这一格是空的，没有颜色可吸')
}

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

/** 两指轻点成立：撤回上一步。不看窗口宽度：iPad 横过来往往超过 1100。
    鼠标没有双指，电脑端不受影响。 */
function twoFingerUndoNow() {
  clearFingerPick()
  /* 第一根手指落下时画笔已经改了一格，而且这一笔还没入历史。
     先退回这一笔，再撤上一步已提交的编辑，才是用户要的「撤回」。 */
  if (painting) revertEdit()
  painting = false
  lineStroke = null
  /* 套索拖到一半来了第二根手指：这一下是撤回，半次平移退回按下前。
     还在拉选框时格子没改过，把框丢掉就行。 */
  if (lassoDrag.value) revertEdit()
  lassoDrag.value = false
  lassoTrace.value = null
  lassoAnchor = null
  lassoMoveBase = null
  dragging.value = false
  moved = true
  fingerPicked = true
  if (undo()) toastOk('已撤回上一步')
  else toastWarn('现在没有可撤回的操作')
}

/** 第二根手指落下：先只记下起点，等移动方向决定是捏合还是轻点。
    第一根手指已经落下的那一笔先退回，别把缩放 / 撤回带进画布。 */
function startTwoFingerGesture(stage) {
  const info = pinchInfo()
  if (!info) return
  clearFingerPick()
  if (painting) revertEdit()
  painting = false
  lineStroke = null
  if (lassoDrag.value) revertEdit()
  lassoDrag.value = false
  lassoTrace.value = null
  lassoAnchor = null
  lassoMoveBase = null
  dragging.value = false
  midPan.value = false
  moved = true
  const rect = stage.getBoundingClientRect()
  const board = boardBox()
  const br = board ? board.getBoundingClientRect() : null
  twoFingerGesture = {
    mode: 'pending',
    startedAt: Date.now(),
    startDist: info.dist,
    startMx: info.mx,
    startMy: info.my,
    startZoom: zoom.value,
    startLeft: stage.scrollLeft,
    startTop: stage.scrollTop,
    startVx: info.mx - rect.left,
    startVy: info.my - rect.top,
    /* 每根手指自己的起点：pointermove 是一根一根到的，
       只看两指距离会把「一根先动」误判成捏合。 */
    startPts: new Map([...touchPoints.entries()].slice(0, 2)),
    /* 中点挪过：松手时不能再算轻点撤回 */
    touched: false,
    /* 全屏工作台以图纸上的同一点为锚；卡片版面按滚动比例换算 */
    anchor: br ? { ox: info.mx - br.left, oy: info.my - br.top, w0: br.width, h0: br.height } : null
  }
}

/** 双指移动：两指同向 = 平移，两指分开 / 靠拢 = 缩放。
    一根手指先动时先不下结论，等另一根也动了再比两者各自的位移。 */
function moveTwoFingerGesture(stage) {
  const g = twoFingerGesture
  const info = pinchInfo()
  if (!g || !stage || !info) return

  if (g.mode === 'pending') {
    const distDelta = Math.abs(info.dist - g.startDist)
    const midDelta = Math.hypot(info.mx - g.startMx, info.my - g.startMy)
    if (midDelta >= TWO_FINGER_TAP_SLOP) g.touched = true
    const moves = [...g.startPts.entries()].map(([id, s]) => {
      const p = touchPoints.get(id) || s
      return { x: p.x - s.x, y: p.y - s.y, len: Math.hypot(p.x - s.x, p.y - s.y) }
    })
    if (moves.length < 2) return
    const movedBoth = moves.every(m => m.len >= 4)
    if (!movedBoth) {
      /* 只有一根动：距离变化已经很大才算捏合，否则再等等 */
      if (distDelta >= TWO_FINGER_PINCH_SLOP * 2 && g.startDist > 8) {
        g.mode = 'pinch'
        exitActualSize({ restore: false })
        autoFit = false
      } else {
        return
      }
    } else {
      const spread = Math.hypot(moves[0].x - moves[1].x, moves[0].y - moves[1].y)
      const longest = Math.max(moves[0].len, moves[1].len)
      if (spread <= Math.max(12, longest * 0.6)) {
        g.mode = 'move'
      } else if (distDelta >= TWO_FINGER_PINCH_SLOP && g.startDist > 8) {
        g.mode = 'pinch'
        exitActualSize({ restore: false })
        autoFit = false
      } else {
        return
      }
    }
  }

  if (g.mode === 'move') {
    /* 两指一起挪 = 平移画布。锁画布也允许：这是明确的两指手势，
       单指 / 鼠标 / 滚轮仍然不动画布。 */
    stage.scrollLeft = g.startLeft - (info.mx - g.startMx)
    stage.scrollTop = g.startTop - (info.my - g.startMy)
    return
  }
  if (g.mode !== 'pinch' || g.startDist <= 8) return
  const target = clampZoom(g.startZoom * (info.dist / g.startDist))
  if (target === zoom.value) return
  setZoom(target)
  const rect = stage.getBoundingClientRect()
  const vx = info.mx - rect.left
  const vy = info.my - rect.top
  const ratio = zoom.value / g.startZoom
  if (consoleViewport.value && g.anchor) {
    nextTick(() => {
      draw()
      anchorBoardPoint(g.anchor.ox, g.anchor.oy, g.anchor.w0, g.anchor.h0, vx, vy)
    })
    return
  }
  /* 卡片版面：把手指开始按住的滚动位置按缩放比例留在手指下面。
     画布尺寸要下一帧才更新，先落一次、再补一次，免得被旧的滚动上限夹回去。 */
  const left = (g.startLeft + g.startVx) * ratio - vx
  const top = (g.startTop + g.startVy) * ratio - vy
  stage.scrollLeft = left
  stage.scrollTop = top
  nextTick(() => {
    stage.scrollLeft = left
    stage.scrollTop = top
  })
}

/* 指针捕获只是「拖出画布也别丢事件」的加分项：浏览器在指针已经失效时会抛
   NotFoundError（笔/触控抬起、系统抢走指针，或脚本合成的 PointerEvent）。
   以前这里裸调用，一抛就中断整个 pointerdown —— 落笔那一格没画上，
   而且后面每个 pointermove 都各自变成一步历史，撤销要按很多次才退回原位。 */
/* ---------------------------------------------------------------- 套索
   点在豆子上：选中整张图案，按住就能直接拖走。
   从空格拉出手绘轨迹：松手后轨迹收口，只选轨迹围住的豆子。
   点在已有局部选区的豆子上：拖动这一块。点在选区外：重新画一圈。
   一次拖动是一步撤销。 */
const lasso = ref(null) // { kind: 'all' } | { kind: 'part', mask, outline }
const lassoDrag = ref(false) // 正在拖动选中的豆子
const lassoTrace = ref(null) // 正在画的轨迹，屏幕坐标 [[x, y], ...]
let lassoAnchor = null // { cellX, cellY, mode: 'move' | 'draw', sx, sy }
/* 按下时的局部选区。拖动中每次都从这份掩码加重置后的总位移重算，
   不要跟着上一步的结果改掩码再挪一格。整张拖动时是 null。 */
let lassoMoveBase = null
/* 每次真正挪动选区时记下相对按下时挪了几格。撤销 / 重做按这个把选区退回去。 */
const lassoShifts = []
let lassoShiftAt = 0

/** 图纸上有没有豆子。画布外暂存的也算，拖出去的图案还能再拖回来。 */
function patternHasBeads(p) {
  if (!p) return false
  if (p.offscreen && p.offscreen.length) return true
  if (!p.cells) return false
  for (let i = 0; i < p.cells.length; i++) if (p.cells[i] >= 0) return true
  return false
}

function clampCell(n, max) {
  return Math.max(0, Math.min(max - 1, n))
}

/** 指针下的格子。拖动中可以落到画布外，越界的豆子才拖得回来。
    拉轨迹时仍夹在画布边上，手绘选区本身不伸出画布。 */
function lassoHit(e, p, { clamp = true } = {}) {
  const el = cv.value
  if (!el) return null
  const g = chartGeometry(p, hitOpts.value)
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const scaleX = g.width / rect.width
  const scaleY = g.height / rect.height
  let x = Math.floor(((e.clientX - rect.left) * scaleX - g.originX) / g.cell)
  let y = Math.floor(((e.clientY - rect.top) * scaleY - g.originY) / g.cell)
  if (!clamp) return { x, y }
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) {
    return { x: clampCell(x, p.width), y: clampCell(y, p.height) }
  }
  return { x, y }
}

/** 这一格在不在当前选区里。全选时画布外也算。
    局部选区：画布里看掩码，画布外看 outside 里记下的格子。 */
function cellSelected(x, y, sel, p) {
  if (!sel || !p) return false
  if (sel.kind === 'all') return true
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) {
    const list = sel.outside
    if (!list) return false
    for (let i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return true
    return false
  }
  return !!(sel.mask && sel.mask[y * p.width + x])
}

/** 射线法：点在不在这条手绘轨迹围成的多边形里。边上的点算在里面。 */
function pointInPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    if (yi === yj && yi === y) {
      const lo = Math.min(xi, xj)
      const hi = Math.max(xi, xj)
      if (x >= lo && x <= hi) return true
    }
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** 屏幕坐标落到哪一格。点在图纸外时夹到边上。 */
function clientToCell(clientX, clientY, p) {
  const el = cv.value
  if (!el) return null
  const hit = hitTest(el, p, { clientX, clientY }, hitOpts.value)
  if (hit) return hit
  const g = chartGeometry(p, hitOpts.value)
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const scaleX = g.width / rect.width
  const scaleY = g.height / rect.height
  const x = Math.floor(((clientX - rect.left) * scaleX - g.originX) / g.cell)
  const y = Math.floor(((clientY - rect.top) * scaleY - g.originY) / g.cell)
  return { x: clampCell(x, p.width), y: clampCell(y, p.height) }
}

/**
 * 手绘轨迹收成选区：轨迹围住的格子标进掩码。
 * 轨迹太短、围不住一格时，改成轨迹扫过的那一串格子。
 */
function selectionFromTrace(points, p) {
  if (!points || points.length < 2) return null
  const cells = []
  for (const [sx, sy] of points) {
    const hit = clientToCell(sx, sy, p)
    if (!hit) continue
    const last = cells[cells.length - 1]
    if (!last || last.x !== hit.x || last.y !== hit.y) cells.push(hit)
  }
  if (!cells.length) return null
  const g = chartGeometry(p, hitOpts.value)
  const rect = cv.value.getBoundingClientRect()
  const scaleX = g.width / rect.width
  const scaleY = g.height / rect.height
  const poly = points.map(([sx, sy]) => [
    ((sx - rect.left) * scaleX - g.originX) / g.cell,
    ((sy - rect.top) * scaleY - g.originY) / g.cell
  ])
  let x0 = p.width
  let y0 = p.height
  let x1 = 0
  let y1 = 0
  for (const [x, y] of poly) {
    x0 = Math.min(x0, Math.floor(x))
    y0 = Math.min(y0, Math.floor(y))
    x1 = Math.max(x1, Math.ceil(x))
    y1 = Math.max(y1, Math.ceil(y))
  }
  x0 = clampCell(x0, p.width)
  y0 = clampCell(y0, p.height)
  x1 = clampCell(x1, p.width)
  y1 = clampCell(y1, p.height)
  const mask = new Uint8Array(p.width * p.height)
  let n = 0
  const span = Math.max(x1 - x0, y1 - y0)
  if (span >= 1 && poly.length >= 3) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!pointInPolygon(x + 0.5, y + 0.5, poly)) continue
        mask[y * p.width + x] = 1
        n++
      }
    }
  }
  if (!n) {
    for (const c of cells) {
      mask[c.y * p.width + c.x] = 1
      n++
    }
  }
  let beads = 0
  for (let i = 0; i < mask.length; i++) if (mask[i] && p.cells[i] >= 0) beads++
  if (!beads) return null
  return { kind: 'part', mask, outline: poly.map(q => [q[0], q[1]]) }
}

/** 选区轮廓换成舞台里的 SVG 坐标。全选没有轮廓。 */
function lassoOutline(sel) {
  const el = cv.value
  const p = pattern.value
  const wrap = wrapEl.value
  if (!el || !p || !wrap || !sel || sel.kind !== 'part' || !sel.outline) return ''
  const g = chartGeometry(p, hitOpts.value)
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return ''
  const wr = wrap.getBoundingClientRect()
  const sx = rect.width / g.width
  const sy = rect.height / g.height
  return sel.outline.map(([cx, cy]) => {
    const x = rect.left - wr.left + (g.originX + cx * g.cell) * sx
    const y = rect.top - wr.top + (g.originY + cy * g.cell) * sy
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

/** 正在画的轨迹：屏幕坐标换成舞台坐标，不收口。 */
function tracePoints(points) {
  const wrap = wrapEl.value
  if (!wrap || !points || points.length < 2) return ''
  const wr = wrap.getBoundingClientRect()
  return points.map(([x, y]) => `${(x - wr.left).toFixed(1)},${(y - wr.top).toFixed(1)}`).join(' ')
}

const lassoScroll = ref(0)
function bumpLassoScroll() {
  if (lasso.value || lassoTrace.value) lassoScroll.value++
  const held = pattern.value && pattern.value.offscreen
  if (held && held.length) syncHeldOverlay()
}

/* 拖出画布的豆子：叠在图纸外面，不写进图纸位图，格子坐标保持原样。 */
const heldCanvas = ref(null)
const heldStyle = ref(null)
function syncHeldOverlay() {
  const p = pattern.value
  const el = cv.value
  const wrap = wrapEl.value
  const stage = stageEl.value
  const held = p && p.offscreen
  if (!el || !wrap || !stage || !p || !held || !held.length || currentView.value !== 'pattern') {
    heldCanvas.value = null
    heldStyle.value = null
    return
  }
  const g = chartGeometry(p, hitOpts.value)
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height || !g.cell) return
  const wr = wrap.getBoundingClientRect()
  const sr = stage.getBoundingClientRect()
  const sx = rect.width / g.width
  const sy = rect.height / g.height
  const cell = g.cell
  /* 只画视口盖住的那一圈（含画布外）。图纸滚到哪儿，这一圈跟着重算。 */
  const gridLeft = rect.left + g.originX * sx
  const gridTop = rect.top + g.originY * sy
  const view = {
    x0: Math.floor((sr.left - gridLeft) / (cell * sx)) - 1,
    y0: Math.floor((sr.top - gridTop) / (cell * sy)) - 1,
    x1: Math.ceil((sr.right - gridLeft) / (cell * sx)) + 1,
    y1: Math.ceil((sr.bottom - gridTop) / (cell * sy)) + 1
  }
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  const drawn = renderOffscreen(p.palette, held, cell * dpr, view)
  if (!drawn) {
    heldCanvas.value = null
    heldStyle.value = null
    return
  }
  heldCanvas.value = drawn.canvas
  heldStyle.value = {
    left: `${gridLeft - wr.left + drawn.x0 * cell * sx}px`,
    top: `${gridTop - wr.top + drawn.y0 * cell * sy}px`,
    width: `${(drawn.canvas.width / dpr) * sx}px`,
    height: `${(drawn.canvas.height / dpr) * sy}px`
  }
}
const heldEl = ref(null)
watch(heldCanvas, () => nextTick(paintHeldNow))
/** 覆盖层每次都是一张新位图。元素还在时也要重贴，否则拖动中画面不跟着走。 */
function paintHeldNow() {
  const el = heldEl.value
  const src = heldCanvas.value
  if (!el || !src) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, el.width, el.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, 0, 0)
}
const lassoShape = computed(() => {
  void lassoScroll.value
  return lassoOutline(lasso.value)
})
const lassoTraceShape = computed(() => {
  void lassoScroll.value
  return tracePoints(lassoTrace.value)
})

function clearLasso() {
  lasso.value = null
  lassoDrag.value = false
  lassoTrace.value = null
  lassoAnchor = null
  lassoMoveBase = null
  lassoShifts.length = 0
  lassoShiftAt = 0
}

/** 按下时的局部选区复制一份。拖动过程里会换成新掩码，底稿不能跟着变。 */
function clonePart(sel) {
  if (!sel || sel.kind !== 'part' || !sel.mask) return null
  return {
    kind: 'part',
    mask: sel.mask.slice(),
    outline: (sel.outline || []).map(([x, y]) => [x, y]),
    outside: sel.outside ? sel.outside.map(b => ({ x: b.x, y: b.y })) : null
  }
}

/** 套索按下：点在豆子上就准备拖整张（或已选中的那一块）；从空格开始则画轨迹。 */
function startLasso(e, stage) {
  const p = pattern.value
  if (!p || !p.cells) return
  if (!patternHasBeads(p)) {
    toastWarn('画布上还没有图案')
    return
  }
  /* 点在画布外的豆子上时用真实格子，不能夹到边上，否则拖不回来。 */
  const raw = lassoHit(e, p, { clamp: false })
  if (!raw) return
  const hit = offscreenBeadAt(p, raw.x, raw.y) ? raw : lassoHit(e, p)
  if (!hit) return
  const hasBead = boardBeadAt(p, hit.x, hit.y) || offscreenBeadAt(p, hit.x, hit.y)
  /* 点在已有局部选区里的豆子上：拖这一块。
     点在其它豆子上：选中整张，按住直接拖。
     点在空格上：从这里画一圈手绘轨迹。 */
  const inPart = hasBead && lasso.value && lasso.value.kind === 'part' && cellSelected(hit.x, hit.y, lasso.value, p)
  if (hasBead) {
    if (!inPart) lasso.value = { kind: 'all' }
    lassoDrag.value = true
    lassoTrace.value = null
    lassoMoveBase = lasso.value && lasso.value.kind === 'part' ? clonePart(lasso.value) : null
    lassoAnchor = { cellX: hit.x, cellY: hit.y, mode: 'move', sx: e.clientX, sy: e.clientY }
    /* 一整次拖动共用一份「按下前」的快照，松手才入历史 */
    beginEdit({ progress: true })
  } else {
    lasso.value = null
    lassoMoveBase = null
    lassoTrace.value = [[e.clientX, e.clientY]]
    lassoAnchor = { cellX: hit.x, cellY: hit.y, mode: 'draw', sx: e.clientX, sy: e.clientY }
  }
  capturePointer(stage, e.pointerId)
}

/** 拖动中：轨迹跟着指针长出来，或者按格子把选中的豆子平移。 */
function moveLasso(e) {
  const a = lassoAnchor
  const p = pattern.value
  if (!a || !p) return
  if (a.mode === 'draw') {
    const pts = lassoTrace.value || []
    const last = pts[pts.length - 1]
    if (!last || Math.hypot(e.clientX - last[0], e.clientY - last[1]) >= 2) {
      lassoTrace.value = pts.concat([[e.clientX, e.clientY]])
    }
    return
  }
  const hit = lassoHit(e, p, { clamp: false })
  if (!hit) return
  /* dx / dy 相对按下的那一格，不是相对上一格。选区掩码也用按下时的那份。 */
  const dx = hit.x - a.cellX
  const dy = hit.y - a.cellY
  if (!dx && !dy) {
    const last = lassoShifts[lassoShiftAt - 1]
    if (last && last.open) {
      restorePendingPattern()
      lassoShifts.pop()
      lassoShiftAt = lassoShifts.length
      const cur = pattern.value
      if (!cur) return
      lasso.value = lassoMoveBase
        ? (shiftSelection(lassoMoveBase, 0, 0, cur.width, cur.height) || lassoMoveBase)
        : (patternHasBeads(cur) ? { kind: 'all' } : null)
    }
    return
  }
  const region = lassoMoveBase
  if (!shiftPattern(dx, dy, region)) return
  noteLassoShift(dx, dy)
  const cur = pattern.value
  if (!cur) return
  if (!region) {
    lasso.value = patternHasBeads(cur) ? { kind: 'all' } : null
    if (!lasso.value) clearLasso()
    return
  }
  const shifted = shiftSelection(region, dx, dy, cur.width, cur.height)
  lasso.value = shifted || (patternHasBeads(cur) ? { kind: 'all' } : null)
  if (!lasso.value) clearLasso()
}

/** 这一格在画布内，并且上面有豆子。 */
function boardBeadAt(p, x, y) {
  if (!p || !p.cells || x < 0 || y < 0 || x >= p.width || y >= p.height) return false
  return p.cells[y * p.width + x] >= 0
}

/** 画布外暂存里，这一格上有没有正在拖的豆子。 */
function offscreenBeadAt(p, x, y) {
  const held = p && p.offscreen
  if (!held) return false
  for (let i = 0; i < held.length; i++) {
    if (held[i].x === x && held[i].y === y) return true
  }
  return false
}

/** 记下这一次拖动相对按下时挪了几格。同一笔里后来的跨格覆盖这个数，不累加。 */
function noteLassoShift(dx, dy) {
  const last = lassoShifts[lassoShiftAt - 1]
  if (last && last.open) {
    last.dx = dx
    last.dy = dy
    return
  }
  lassoShifts.length = lassoShiftAt
  lassoShifts.push({ dx, dy, open: true })
  lassoShiftAt = lassoShifts.length
}

/** 局部选区的掩码和轮廓跟着这一步平移。
    伸出画布的格子记在 outside 里，整块都在画布外时掩码可以是空的，选区还在。 */
function shiftSelection(sel, dx, dy, w, h) {
  if (!sel || sel.kind !== 'part' || !sel.mask) return null
  const next = new Uint8Array(w * h)
  const outside = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!sel.mask[y * w + x]) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) outside.push({ x: nx, y: ny })
      else next[ny * w + nx] = 1
    }
  }
  const prev = sel.outside || []
  for (let i = 0; i < prev.length; i++) {
    outside.push({ x: prev[i].x + dx, y: prev[i].y + dy })
  }
  const outline = (sel.outline || []).map(([x, y]) => [x + dx, y + dy])
  let onCanvas = 0
  for (let i = 0; i < next.length; i++) if (next[i]) onCanvas++
  if (!onCanvas && !outside.length && !outline.length) return null
  return { kind: 'part', mask: next, outline, outside }
}

/** 松手：手绘轨迹收口，围住的豆子成为局部选区。 */
function finishLassoTrace() {
  const trace = lassoTrace.value
  lassoTrace.value = null
  lassoAnchor = null
  lassoMoveBase = null
  if (!trace) return
  const p = pattern.value
  if (!p) { lasso.value = null; return }
  const sel = selectionFromTrace(trace, p)
  if (!sel) {
    lasso.value = null
    toastWarn('这一圈里没有豆子')
    return
  }
  lasso.value = sel
}


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
    startTwoFingerGesture(stage)
    capturePointer(stage, e.pointerId)
    return
  }

  armFingerPick(e)

  /* 套索：按下就选中整张图案，拖动时按格子整体平移。触屏单指也走这里，
     不落到下面「非画笔工具 = 拖视野」那条路上。 */
  if (currentView.value === 'pattern' && e.button === 0 && tool.value === 'lasso') {
    startLasso(e, stage)
    return
  }

  // 编辑工具下，直接点格子改色（PRD §12 画布）
  if (currentView.value === 'pattern' && e.button === 0 && (tool.value === 'paint' || tool.value === 'erase')) {
    painting = true
    capturePointer(stage, e.pointerId)
    /* 一整笔（按下 → 拖动 → 松开）算一步撤销：applyPaint 会随 pointermove
       反复调用，靠 beginEdit 的嵌套计数把这一笔合成一条历史。
       画笔按住 Shift 时这一笔改成直线：起点是按下的格子，终点跟着指针走。 */
    beginEdit()
    /* 直线：菜单里选了「直线」之后每一笔都是直线，触屏也一样。
       没选时仍是按住 Shift 拖左键（触屏没有 Shift，不走这条）。 */
    const straight = tool.value === 'paint' && (brushStroke.value === 'line' || (e.shiftKey && e.pointerType !== 'touch'))
    if (straight) {
      const hit = cv.value && pattern.value ? hitTest(cv.value, pattern.value, e, hitOpts.value) : null
      lineStroke = hit ? { x: hit.x, y: hit.y } : null
      if (hit) paintLine(hit.x, hit.y, hit.x, hit.y)
      return
    }
    lineStroke = null
    applyPaint(e)
    return
  }
  /* 中键拖动 = 直接平移画布：与当前工具无关，画笔状态下也能拖走视野。
     浏览器默认把中键当「自动滚动」（按下后光标变滚动十字、页面自己滚），
     pointerdown 与 mousedown 上都要 preventDefault 掉。 */
  if (e.button === 1) {
    e.preventDefault()
    if (props.locked) return
    midPan.value = true
    startPanDrag(e, stage)
    capturePointer(stage, e.pointerId)
    return
  }
  if (e.button !== 0) return
  /* 触屏单指只编辑：填充 / 吸色 / 移动都不能在第一根手指按下时就把画布拖走。
     第二根手指可能紧跟着落下，那一下是撤回；先拖再撤，画面会先跳一下。 */
  if (e.pointerType === 'touch') return
  /* 笔只在「移动」工具下拖画布：选了画笔 / 填充 / 吸色 / 套索时，笔落下就是编辑，
     不能顺手把视野拖走（之前笔走的是鼠标那条路，非画笔工具一拖就平移）。 */
  if (e.pointerType === 'pen' && tool.value !== 'pan') return
  /* 套索已经在上面接住了。这里再挡一次，免得触屏以外的指针漏下去把视野拖走。 */
  if (tool.value === 'lasso') return
  if (props.locked) return
  startPanDrag(e, stage)
}

/** 开始拖动平移：记下鼠标起点与这一刻的滚动量 */
function startPanDrag(e, stage) {
  dragging.value = true
  moved = false
  startX = e.clientX
  startY = e.clientY
  startLeft = stage.scrollLeft
  startTop = stage.scrollTop
}

/** 中键按下：拦掉浏览器默认的自动滚动 */
function onStageMouseDown(e) {
  if (e.button === 1) e.preventDefault()
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

/** 直线笔：整条线始终从按下的格子连到当前格子，不把鼠标走过的弯路画进去。 */
function applyLine(e) {
  if (!lineStroke || !cv.value || !pattern.value) return
  const hit = hitTest(cv.value, pattern.value, e, hitOpts.value)
  if (!hit) return
  paintLine(lineStroke.x, lineStroke.y, hit.x, hit.y)
}

function onPointerMove(e) {
  const stage = stageEl.value
  if (e.pointerType === 'touch' && touchPoints.has(e.pointerId)) {
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  /* 放大镜开着：手指移动是在选格子，原工具停住。 */
  if (fingerLoupe.value && e.pointerId === fingerPickPointer) {
    moveFingerLoupe(e.clientX, e.clientY)
    return
  }
  /* 按住期间的小抖动不当成拖动：不取消吸色，也不要把笔跟着抖出去。
     手指明显挪开（超过约一颗豆）才取消长按，这一笔按原工具继续画。 */
  if (fingerPickTimer && e.pointerId === fingerPickPointer) {
    const dist = Math.hypot(e.clientX - fingerPickDownX, e.clientY - fingerPickDownY)
    if (dist <= FINGER_PICK_SLOP) return
    stopFingerPickTimer()
  }
  /* 双指手势交给状态机；手指还按着时不要再平移、也不要继续画。
     第二根手指的按下和移动可能挤在同一帧，按 touchPoints 兜底拦住。 */
  if (twoFingerGesture) {
    if (e.pointerType === 'touch' && touchPoints.size >= 2) moveTwoFingerGesture(stage)
    return
  }
  if (e.pointerType === 'touch' && touchPoints.size >= 2) return
  if (painting) {
    if (lineStroke) applyLine(e)
    else applyPaint(e)
    return
  }
  if (lassoDrag.value || (lassoAnchor && lassoAnchor.mode === 'draw')) {
    moveLasso(e)
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
  if (e && e.pointerId === fingerPickPointer) {
    if (fingerLoupe.value) finishFingerLoupe()
    else clearFingerPick()
  }
  // 松手才提交这一笔：中途每一格共用同一个「操作前快照」
  if (painting) endEdit()
  painting = false
  lineStroke = null
  /* 拖豆子：松手才入历史。没挪动时 endEdit 发现格子没变，不会入栈，
     这次记下的平移也要丢掉。拉选框：格子没改，只把框收成选区。 */
  if (lassoDrag.value) {
    const changed = endEdit()
    const last = lassoShifts[lassoShiftAt - 1]
    if (last && last.open) {
      last.open = false
      if (!changed) {
        lassoShifts.pop()
        lassoShiftAt = lassoShifts.length
      }
    }
  } else if (lassoAnchor && lassoAnchor.mode === 'draw') finishLassoTrace()
  lassoDrag.value = false
  lassoAnchor = null
  lassoMoveBase = null
  dragging.value = false
  midPan.value = false
  const stage = stageEl.value
  if (stage && e && e.pointerId != null) releasePointer(stage, e.pointerId)
  /* 双指手势收尾：第一根手指抬起就结算。两指都没动、而且按得不久，
     才算一次轻点撤回；捏合 / 拖动过的手势什么都不做。
     剩下的那根手指不要接着画，等它自己抬起。 */
  if (twoFingerGesture && e && e.pointerType === 'touch' && touchPoints.size < 2) {
    const g = twoFingerGesture
    twoFingerGesture = null
    if (g.mode === 'pending' && !g.touched && Date.now() - g.startedAt <= TWO_FINGER_TAP_MS) {
      twoFingerUndoNow()
    }
  }
  setTimeout(() => { moved = false }, 0)
}

/** 系统长按菜单会把指针抢走。手指还按在原处时，直接吸色，不要当成取消。 */
function onStageContextMenu(e) {
  if (currentView.value !== 'pattern') return
  e.preventDefault()
  if (!fingerPickTimer) return
  const x = fingerPickDownX
  const y = fingerPickDownY
  stopFingerPickTimer()
  runFingerPick(x, y)
}

/** 指针被系统抢走（来电、通知中心）：这一笔不要留在历史里，免得撤销时画面跳变 */
function onPointerCancel(e) {
  if (e && e.pointerType === 'touch') touchPoints.delete(e.pointerId)
  /* 放大镜已经打开时颜色已经吸过，取消只收起镜子。 */
  if (fingerLoupe.value && (!e || e.pointerId === fingerPickPointer)) {
    clearFingerPick()
  } else if (fingerPickTimer && (!e || e.pointerId === fingerPickPointer)) {
    const x = fingerPickDownX
    const y = fingerPickDownY
    stopFingerPickTimer()
    if (!twoFingerGesture && touchPoints.size < 2) runFingerPick(x, y)
    /* 指针已经没了，放大镜留在屏幕上对不准，颜色则保留。 */
    clearFingerPick()
  } else {
    clearFingerPick()
  }
  if (painting) cancelEdit()
  painting = false
  lineStroke = null
  /* 指针被抢走时保留已经挪过的格子（和画笔同一口径），只是不再继续拖。
     轨迹还没松手就丢掉，不当成一次选区。 */
  if (lassoDrag.value) endEdit()
  lassoDrag.value = false
  lassoTrace.value = null
  lassoAnchor = null
  lassoMoveBase = null
  dragging.value = false
  midPan.value = false
  /* 系统抢走指针时手势不结算，也不撤回 */
  if (touchPoints.size < 2) twoFingerGesture = null
}

function onClick(e) {
  /* 长按吸色成功后浏览器还会补一个 click：那一格已经被吸过了，不能再画上去 */
  if (fingerPicked) { fingerPicked = false; return }
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
    return
  }
  /* 换色：点一格，把整张图里和它同色的豆全部换掉。
     默认换成当前画笔色；箭头菜单可以改成「最接近的色号」或「空豆」。
     按色号 id 换（不是调色板下标）—— 换色过程中色板可能重排。 */
  if (tool.value === 'swap') {
    const hit = hitTest(cv.value, pattern.value, e, hitOpts.value)
    if (!hit) return
    const p = pattern.value
    const from = p.palette[p.cells[hit.y * p.width + hit.x]]
    if (!from) return
    if (swapMode.value === 'empty') {
      const n = clearColorEverywhere(from.id)
      if (n) toastOk(`已把 ${from.code} 全部换成空豆，共 ${n} 颗`)
      else toastWarn('没找到可以替换的豆')
      return
    }
    if (swapMode.value === 'nearest') {
      const to = nearestSwapColor(from)
      if (!to) { toastWarn('这一色没有可替换的相近色'); return }
      const n = replaceColorEverywhere(from.id, to)
      if (n) toastOk(`已把 ${from.code} 全部换成相近色 ${to.code}，共 ${n} 颗`)
      else toastWarn('没找到可以替换的豆')
      return
    }
    /* 画笔色按 id 从品牌色板取。图纸色板里还没有这一色时，不能退回「最后一颗豆」，
       否则点换色会换成画布上已有的颜色，和工具轨上的当前色对不上。 */
    const to = (brushColorId.value && getColorById(brushColorId.value)) || brush.value
    if (!to) return
    if (to.id === from.id) { toastWarn('这一格已经是当前画笔色了'); return }
    const n = replaceColorEverywhere(from.id, to)
    if (n) toastOk(`已把 ${from.code} 全部换成 ${to.code}，共 ${n} 颗`)
    else toastWarn('没找到可以替换的豆')
  }
}

function onWheel(e) {
  /* 平板锁画布：滚轮不再缩放。Ctrl+滚轮仍要拦掉，
     否则浏览器会把整页放大（viewport 的 user-scalable=no 管不到桌面浏览器的快捷键缩放）。 */
  if (props.locked) {
    if (e.ctrlKey) e.preventDefault()
    return
  }
  e.preventDefault()
  /* 滚轮同样属于「用户手动缩放」，必须走 onUserZoom 把 autoFit 关掉。
     只调 setZoom 的话 autoFit 仍是 true —— 画布一放大就撑出滚动条，
     舞台的内容盒跟着变窄（实测 680 → 670），ResizeObserver 以为容器变了、
     60ms 后再适配一次，刚放大的画布被打回「适应窗口」
     （实测 0.82 → 1.02 → 0.78，看着就是「放大又跳回」）。
     真实浏览器有滚动条才复现；无头自检带 --hide-scrollbars 时滚动条不占位，
     所以老的自检一直没抓到这个。 */
  const dir = e.deltaY < 0 ? 1 : -1
  const next = clampZoom(zoom.value + dir * (zoom.value < 2 ? 0.2 : 0.4))
  /* 全屏工作台以光标下的那一格为锚缩放，图纸可以放大到超出视口再拖回来。 */
  if (consoleViewport.value && stageEl.value && boardBox()) {
    const stage = stageEl.value
    const board = boardBox()
    const sr = stage.getBoundingClientRect()
    const br = board.getBoundingClientRect()
    const ox = e.clientX - br.left
    const oy = e.clientY - br.top
    const vx = e.clientX - sr.left
    const vy = e.clientY - sr.top
    const w0 = br.width
    const h0 = br.height
    onUserZoom(next)
    /* draw 在 hitCell 的 nextTick 里，和这里的回调谁先跑不一定。
       先把位图画到新尺寸，再按光标锚滚动，后到的 ensureGutter 发现边距没变就不动滚动。 */
    nextTick(() => {
      draw()
      anchorBoardPoint(ox, oy, w0, h0, vx, vy)
    })
    return
  }
  onUserZoom(next)
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
/** 适应窗口时要躲开的固定边：全屏工作台只让开标尺，浮动工具压在画布上。 */
function viewAvail(stage) {
  const p = stagePad(stage)
  const inset = consoleViewport.value ? { x: RULER_L, y: RULER_T } : { x: 0, y: 0 }
  return {
    w: stage.clientWidth - p.x - inset.x,
    h: stage.clientHeight - p.y - inset.y
  }
}
function boardBox() {
  const el = cv.value
  return el ? (el.closest('.board') || el) : null
}
/* 图纸比视口小的时候，原生滚动范围是 0，移动工具拖不动。
   四周留出至少一屏的空白，scrollLeft 才能把图纸拖到视口里的任意位置。
   舞台是 overflow:hidden，这条滚动不出现滚动条，也不会把适应窗口打回去。 */
function ensureGutter(preserve = true) {
  if (!consoleViewport.value) return
  const stage = stageEl.value
  const board = boardBox()
  if (!stage || !board) return
  const need = Math.ceil(Math.max(
    stage.clientWidth, stage.clientHeight, board.offsetWidth, board.offsetHeight
  ))
  const cur = parseFloat(board.style.marginTop) || 0
  if (Math.abs(cur - need) < 2) return
  const sr = stage.getBoundingClientRect()
  const br = board.getBoundingClientRect()
  const visX = br.left - sr.left
  const visY = br.top - sr.top
  board.style.margin = need + 'px'
  if (!preserve) return
  const br2 = board.getBoundingClientRect()
  stage.scrollLeft = br2.left - sr.left + stage.scrollLeft - visX
  stage.scrollTop = br2.top - sr.top + stage.scrollTop - visY
}
/**
 * 缩放后把图纸上的同一点留在视口里。
 * ox/oy、w0/h0 是缩放前「点在图纸上的偏移」和图纸尺寸；vx/vy 是视口坐标（相对舞台左上角）。
 */
function anchorBoardPoint(ox, oy, w0, h0, vx, vy) {
  const stage = stageEl.value
  const board = boardBox()
  if (!stage || !board) return
  ensureGutter(true)
  const sr = stage.getBoundingClientRect()
  const br2 = board.getBoundingClientRect()
  const sx = w0 ? br2.width / w0 : 1
  const sy = h0 ? br2.height / h0 : 1
  const contentX = br2.left - sr.left + stage.scrollLeft
  const contentY = br2.top - sr.top + stage.scrollTop
  stage.scrollLeft = contentX + ox * sx - vx
  stage.scrollTop = contentY + oy * sy - vy
  scheduleRuler()
}
/** 把图纸上的某一点挪到视口坐标 (viewX, viewY)。 */
function scrollBoardTo(viewX, viewY) {
  const stage = stageEl.value
  const board = boardBox()
  if (!stage || !board) return
  const sr = stage.getBoundingClientRect()
  const br = board.getBoundingClientRect()
  stage.scrollLeft = br.left - sr.left + stage.scrollLeft - viewX
  stage.scrollTop = br.top - sr.top + stage.scrollTop - viewY
}
/* 适应 / 换钉板 / 换图 / 改尺寸之后，图纸一律落在标尺内侧的正中央：
   贴左上角会让方图纸在宽屏上缩在左边、右边空一大条，看着像「跳走了」。
   画布永久居中，缩放只改大小不改位置。 */
let recenterPending = false
function settleAfterFit() {
  recenterPending = false
  if (consoleViewport.value) centerStage()
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
  // 内边距按实际计算值留出来（手机上右侧还多一条工具窄栏）。
  // 全屏工作台再减掉标尺条，图纸贴着标尺内沿铺，不再为浮动面板缩进。
  const avail = viewAvail(stage)
  if (avail.w <= 0 || avail.h <= 0) return null
  const fit = Math.min(avail.w / rect.width, avail.h / rect.height)
  return Number.isFinite(fit) ? fit : null
}
function fitToStage() {
  /* 自动适配只在 autoFit 打开时生效。
     换画布 / 换图时排队的 setTimeout(fitToStage) 可能晚于「实际大小」到达，
     没有这道闸就会把刚设好的 1:1 缩放抢回「适应窗口」。 */
  if (!autoFit) return
  const stage = stageEl.value
  if (!stage || !pattern.value) return
  const avail = viewAvail(stage)
  const availW = avail.w
  const availH = avail.h
  if (availW <= 0 || availH <= 0) return

  /* 画布已经画出来：直接量真实尺寸，允许放大也允许缩小。
     只「缩小不放大」会让 320 宽下的初始 10% 一直卡着（明明还有一倍空间），
     所以这里按实测比例走两轮；标尺是固定宽度，第二轮把这点误差收掉。 */
  const first = fitRatio(stage)
  if (first) {
    fitting = true
    const before = cv.value.getBoundingClientRect().width
    /* 全屏工作台按标尺内侧的真实空位铺满，不再留 1% 的缝（那条缝就是图纸离标尺的空隙）。 */
    const slack = consoleViewport.value ? 1 : 0.99
    if (Math.abs(first - 1) > 0.01) setZoom(clampZoom(zoom.value * first * slack))
    /* 第二轮只在画布真的重画过之后量：同一帧里重复套用同一个比例会连乘，
       实测把 320 宽的初始 10% 一路放大到 30%，右边压到工具窄栏下面。 */
    nextTick(() => setTimeout(() => {
      if (autoFit && cv.value && cv.value.getBoundingClientRect().width !== before) {
        const second = fitRatio(stage)
        /* 第二轮只收不放：格子尺寸是整数像素，放大时会在 4px → 5px 处跳一档，
           再放大一次就正好顶进右侧工具窄栏。 */
        if (second && second < 0.995) setZoom(clampZoom(zoom.value * second))
      }
      setTimeout(() => {
        fitting = false
        if (autoFit) settleAfterFit()
      }, 60)
    }, 80))
    return
  }

  // 还没有画布（空状态）：先按几何估算给一个能画出来的缩放级别
  const probe = chartGeometry(pattern.value, hitOpts.value)
  const need = Math.max(probe.width / zoom.value, probe.height / zoom.value)
  setZoom(clampZoom((Math.min(availW, availH) / need) * 0.9))
  nextTick(() => setTimeout(() => { if (autoFit) settleAfterFit() }, 80))
}

function resetPan() {
  const stage = stageEl.value
  if (!stage) return
  if (consoleViewport.value) {
    /* 全屏工作台不贴回左上角：等这一轮重画完由 draw() 摆回标尺内侧正中
       （画布的新尺寸要画完才量得准），这里什么都不用做。 */
    return
  }
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
  if (props.locked) return
  /* 手动缩放就从实际大小模式里退出来：再按一次「实际大小」可以回去 */
  exitActualSize({ restore: false })
  autoFit = false
  setZoom(v)
}
/** 缩放按钮：全屏工作台以标尺内侧可见区的中心为锚，放大缩小都不把图纸甩到一边。
    滚轮仍按光标锚（那是用户点着哪里看哪里），按钮没有光标位置，用中心最稳。 */
function zoomStep(delta) {
  if (props.locked) return
  const next = clampZoom(zoom.value + delta)
  if (!consoleViewport.value || !stageEl.value || !boardBox()) { onUserZoom(next); return }
  const stage = stageEl.value
  const board = boardBox()
  const sr = stage.getBoundingClientRect()
  const br = board.getBoundingClientRect()
  const vx = RULER_L + (stage.clientWidth - RULER_L) / 2
  const vy = RULER_T + (stage.clientHeight - RULER_T) / 2
  const ox = sr.left + vx - br.left
  const oy = sr.top + vy - br.top
  const w0 = br.width
  const h0 = br.height
  onUserZoom(next)
  nextTick(() => {
    draw()
    anchorBoardPoint(ox, oy, w0, h0, vx, vy)
  })
}

/* ---------------------------------------------------------------- 标尺（永久贴边）

   全屏工作台的标尺是贴在画布视口顶边 / 左边的覆盖层（CanvasRuler）：
   位置固定，读数按「当前一格多少屏幕像素 + 图纸滚到哪儿」实时重算。
   所以要量的就是画布位图相对视口的矩形 —— 滚动、缩放、换成品尺寸都会变。

   量的是 .stageWrap（覆盖层就挂在它上面、inset:0），
   不是 .stage：后者带 20/274/112/144 的内边距，跟覆盖层的坐标原点差一层。 */
const rulerOn = computed(() => consoleChrome.value && wide.value &&
  currentView.value === 'pattern' && !showEmpty.value)
const rulerGeom = ref(null)
let rulerRaf = 0
let rulerRo = null

function measureRuler() {
  const wrap = wrapEl.value
  const el = cv.value
  const p = pattern.value
  if (!rulerOn.value || !wrap || !el || !p || !(p.width > 0)) { rulerGeom.value = null; return }
  const wr = wrap.getBoundingClientRect()
  const cr = el.getBoundingClientRect()
  if (!(wr.width > 1) || !(wr.height > 1) || !(cr.width > 1)) { rulerGeom.value = null; return }
  const cell = cr.width / p.width
  if (!(cell > 0)) { rulerGeom.value = null; return }
  /* 尺寸线贴着有豆子的那一块，不贴整张画布，也不把抠图空边算进去。
     一颗豆都没有时退回成品区域，开关打开仍有一条可对的线。 */
  const s = stats.value
  const ink = s && s.ink && s.ink.w > 0 && s.ink.h > 0 ? s.ink : null
  let ax
  let ay
  let aw
  let ah
  if (ink) {
    ax = ink.x
    ay = ink.y
    aw = ink.w
    ah = ink.h
  } else {
    aw = Math.max(1, Math.min(p.width, s && s.artW ? s.artW : p.width))
    ah = Math.max(1, Math.min(p.height, s && s.artH ? s.artH : p.height))
    ax = Math.max(0, Math.floor((p.width - aw) / 2))
    ay = Math.max(0, Math.floor((p.height - ah) / 2))
  }
  const left = cr.left - wr.left
  const top = cr.top - wr.top
  rulerGeom.value = {
    viewW: wr.width,
    viewH: wr.height,
    left,
    top,
    cell,
    cols: p.width,
    rows: p.height,
    artLeft: left + ax * cell,
    artTop: top + ay * cell,
    artW: aw * cell,
    artH: ah * cell,
    cmW: aw * beadCm.value,
    cmH: ah * beadCm.value
  }
}
/* 滚动 / 缩放 / 换尺寸都往这一帧里并：一次 requestAnimationFrame 只量一次 */
function scheduleRuler() {
  if (!rulerOn.value || rulerRaf) return
  rulerRaf = requestAnimationFrame(() => {
    rulerRaf = 0
    measureRuler()
  })
}
watch([
  rulerOn, cellPx, width, height, actualMode,
  /* 画完一笔、换图之后包围盒变了，刻度不用动，尺寸线要重画 */
  () => {
    const ink = stats.value && stats.value.ink
    return ink ? `${ink.x},${ink.y},${ink.w},${ink.h}` : ''
  }
], scheduleRuler, { flush: 'post' })

/** 手指还按在图纸上时，浏览器会自己改舞台的 scrollLeft（全屏工作台
    overflow:hidden 也挡不住）。监听必须 non-passive，才能 preventDefault。 */
function onStageTouchMove(e) {
  if (e.touches.length >= 1) e.preventDefault()
}

/** Esc 取消套索选区，方便接着框另一块。别的浮层仍由工作台自己的 Esc 收。 */
function onLassoKey(e) {
  if (e.key !== 'Escape' || tool.value !== 'lasso') return
  if (!lasso.value && !lassoTrace.value && !lassoDrag.value) return
  if (lassoDrag.value) {
    revertEdit()
    lassoDrag.value = false
  }
  clearLasso()
}

onMounted(() => {
  /* 进入工作台时就已经是平板档：把上一次留下的移动工具 / 实际大小收掉 */
  if (props.locked) lockCanvasView()
  redrawAll()
  if (wideQuery) wideQuery.addEventListener('change', onWideChange)
  if (deskQuery) deskQuery.addEventListener('change', onDeskChange)
  if (stageEl.value) stageEl.value.addEventListener('touchmove', onStageTouchMove, { passive: false })
  setTimeout(fitToStage, 60)
  /* 第一次适配按「当前缩放」反推图纸尺寸，缩放很低时标尺/留白的固定开销
     会被放大，结果偏保守（手机上 33% 明明还能到 42%）。布局稳定后再适配
     一次，用已经放大过的尺寸反推就准了；只在没被用户手动缩放过时执行。 */
  setTimeout(() => { if (autoFit) fitToStage() }, 420)
  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    ro = new ResizeObserver(() => {
      if (consoleViewport.value && !fitting) ensureGutter(true)
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
  /* 贴边标尺：滚动（图纸在视口里挪）与视口尺寸变化都要重算读数 */
  if (stageEl.value) stageEl.value.addEventListener('scroll', scheduleRuler, { passive: true })
  if (stageEl.value) stageEl.value.addEventListener('scroll', bumpLassoScroll, { passive: true })
  window.addEventListener('keydown', onLassoKey)
  if (typeof ResizeObserver !== 'undefined' && wrapEl.value) {
    rulerRo = new ResizeObserver(scheduleRuler)
    rulerRo.observe(wrapEl.value)
  }
})
onBeforeUnmount(() => {
  clearFingerPick()
  clearTimeout(noticeTimer)
  if (wideQuery) wideQuery.removeEventListener('change', onWideChange)
  if (deskQuery) deskQuery.removeEventListener('change', onDeskChange)
  if (ro) { clearTimeout(ro._t); ro.disconnect(); ro = null }
  if (stageIo) { stageIo.disconnect(); stageIo = null }
  if (rulerRo) { rulerRo.disconnect(); rulerRo = null }
  if (rulerRaf) { cancelAnimationFrame(rulerRaf); rulerRaf = 0 }
  if (stageEl.value) stageEl.value.removeEventListener('scroll', scheduleRuler)
  if (stageEl.value) stageEl.value.removeEventListener('scroll', bumpLassoScroll)
  window.removeEventListener('keydown', onLassoKey)
  if (stageEl.value) stageEl.value.removeEventListener('touchmove', onStageTouchMove)
  if (painting) cancelEdit()
  painting = false
  lineStroke = null
  if (lassoDrag.value) endEdit()
  lassoDrag.value = false
  lassoTrace.value = null
  lassoAnchor = null
  lassoMoveBase = null
  dragging.value = false
})

/* ---------------------------------------------------------------- 分板

   1000×1000 格 = 35×35 = 1225 块板。每块板的缩略图是一张 174² 的 canvas
   （≈ 121 KB 后备缓冲）并且要整板重绘一遍，1225 块就是 148 MB + 几秒同步阻塞 ——
   而列表里同时看得见的本来就只有十几块。所以超过 SPLIT_MAX_TILES 之后
   只渲染「前 60 块 + 当前选中的那块」，其余用输入框按板号跳。
   点一块板弹出大图，整块放进窗口；材料色号在弹窗里按那一块单独算。 */
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

const previewOpen = ref(false)

watch(currentView, () => nextTick(() => {
  if (currentView.value === 'split') drawBoardPreviews()
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
  previewOpen.value = true
  nextTick(() => {
    /* 截断时选中的那块会新挂上一个 canvas（showBoardTile），得把它也画出来 */
    if (splitTilesCapped.value) drawBoardPreviews()
    boardGridEl.value?.querySelector('.boardTile.on')?.scrollIntoView({ block: 'nearest' })
  })
}

/* 全屏工作台的画布状态栏要驱动缩放 / 适应 / 实际大小：这几个入口原本都在
   卡片自带的顶栏里（chrome='console' 时被隐藏），所以显式暴露给 EditorView。 */
defineExpose({
  fitStage, centerStage, toggleActualSize, onUserZoom, zoomStep,
  actualMode, actualCapped, finishCmText, zoomCapped
})
</script>

<template>
  <section ref="cardEl" class="canvasCard" :class="{ 'canvasCard--console': consoleChrome }">
    <!-- 作品名这一行由 EditorView 从外面传进来（参考版的画布块只有
         「页签 + 缩放」一条顶栏，作品名属于卡片上方的信息条） -->
    <slot name="above" />

    <div v-if="!consoleChrome" class="canvasCard__toolbar">
      <!-- 视图页签已去掉：画布固定停在拼豆图纸，分板收进右栏「颜色用量」下面 -->

      <!-- 平移模式要有可见状态：工具按钮高亮之外，顶栏再给一条明确提示，
           避免用户以为单指拖动会改图 -->
      <span v-if="currentView === 'pattern' && !showEmpty && tool === 'pan'" class="panState"><Icon name="hand" :size="16" />移动画布模式</span>

      <!-- 缩放：参考版是「− 100% ＋」一组。本站多一个「适应」，
           因为大画布（最多 1000×1000 格 = 100 万格）不一键回中很容易在画布外找不到图 -->
      <div class="zoomBar">
        <template v-if="currentView === 'pattern'">
          <template v-if="!locked">
            <button class="btn btn-secondary icon sm" title="缩小" aria-label="缩小" @click="zoomStep(-0.25)"><Icon name="zoom-out" :size="16" /></button>
            <span class="zoomPill"><Icon class="zoomIco" name="zoom-in" :size="16" /><span class="zoomText">{{ Math.round(zoom * 100) }}%</span></span>
            <button class="btn btn-secondary icon sm" title="放大" aria-label="放大" @click="zoomStep(0.25)"><Icon name="zoom-in" :size="16" /></button>
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
          <!-- 平板锁画布：只保留实时比例，作为「整张已放进窗口」的反馈 -->
          <span v-else class="zoomPill"><Icon class="zoomIco" name="zoom-in" :size="16" /><span class="zoomText">{{ Math.round(zoom * 100) }}%</span></span>
        </template>
        <span v-else-if="genMs" class="muted">{{ genMs }}ms</span>
      </div>

      <!-- 手机端：顶栏最右一颗「适应窗口」。缩放的加减在画布右侧浮控上，
           这样顶栏只占一行，画布能多留一条高度。 -->
      <button v-if="!locked" type="button" class="fitTop" title="适应窗口" aria-label="适应窗口" @click="fitStage">
        <Icon name="scan" :size="16" />
      </button>
    </div>

    <!-- 手机端快捷入口（画布 / 色板 / 用量 / 导出 / 更多）由 EditorView 传进来，
         紧贴顶栏下方；桌面端不渲染 -->
    <slot name="quick" />

    <!-- 手机端画布框：右侧工具窄栏 + 更多抽屉；桌面端仍是画布下方的两行工具条。 -->
    <div ref="wrapEl" class="stageWrap">
      <!-- 实际大小的状态条：贴在画布左上角，直接写成品厘米；
           屏幕像素预算不够时如实说「只能显示到实际的百分之多少」。 -->
      <div v-if="actualMode && !showEmpty && currentView === 'pattern'" class="actualBadge no-print" :class="{ 'actualBadge--console': consoleChrome }" role="status" data-actual-badge>
        <span class="actualBadge__dot" aria-hidden="true"></span>
        <b>{{ actualCapped ? `约实际大小 ${actualShownPct}%` : '实际大小' }}</b>
        <span class="actualBadge__cm" data-actual-cm>成品 {{ finishCmText }}</span>
        <button type="button" class="actualBadge__link" data-actual-calib @click="calibOpen = true">校准屏幕</button>
      </div>

      <!-- 套索：局部选区是手绘轨迹收口后的形状，正在画的那一笔不收口。
           挂在舞台外面，图纸滚动时留在视口里。全选不画轮廓。 -->
      <svg v-if="lassoShape || lassoTraceShape" class="lassoSvg" aria-hidden="true">
        <polygon v-if="lassoShape" class="lassoShape" :class="{ 'is-drag': lassoDrag }" :points="lassoShape" />
        <polyline v-if="lassoTraceShape" class="lassoTrace" :points="lassoTraceShape" />
      </svg>

      <canvas
        v-if="heldCanvas && heldStyle" ref="heldEl" class="heldBeads"
        :width="heldCanvas.width" :height="heldCanvas.height"
        :style="heldStyle" aria-hidden="true"
      ></canvas>

      <div
        ref="stageEl" class="stage"
        :class="{ 'stage--edit': currentView === 'pattern' && !showEmpty, pannable: currentView === 'pattern' && !showEmpty && (dragging || tool === 'pan'), panning: dragging, 'mid-pan': midPan, 'stage--lasso': tool === 'lasso', 'stage--empty': showEmpty, 'stage--locked': locked }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
        @pointercancel="onPointerCancel"
        @contextmenu="onStageContextMenu"
        @mousedown="onStageMouseDown"
        @wheel="onWheel"
      >
        <!-- 空状态：
             · 全屏工作台（console）：画布中央一张上传卡（拖拽区 + 选择本地图片）。
             · 手机 / 平板：沿用原来的紧凑提示与三步引导。 -->
        <div v-if="showEmpty" class="empty empty--guide">
          <template v-if="consoleChrome">
            <!-- 图纸转换：画布中央的上传卡（设计稿 1:593） -->
            <div v-if="!uploadDismissed && !sourceUrl" class="upCard" data-empty-upload>
              <header class="upCard__head">
                <b>上传图片</b>
                <button
                  type="button" class="upCard__x" aria-label="暂不上传"
                  data-empty-upload-close @click="uploadDismissed = true"
                ><Icon name="x" :size="16" /></button>
              </header>
              <div class="upCard__drop">
                <span class="upCard__icon"><Icon name="image-up" :size="20" /></span>
                <b class="upCard__title">点击或拖拽图片至此处上传</b>
                <span class="upCard__hint">支持 JPG、PNG、WEBP，也可以按 Ctrl+V 粘贴。</span>
              </div>
              <button type="button" class="upCard__btn" data-empty-upload-btn @click="emit('upload')">
                选择本地图片
              </button>
            </div>
            <div v-else class="upCard upCard--min" data-empty-upload-min>
              <button type="button" class="upCard__btn" @click="uploadDismissed = false">
                <Icon name="image-up" :size="16" />上传图片
              </button>
            </div>
          </template>
          <EditorEmptyGuide v-else-if="wide" />
          <div v-else class="emptyLegacy">
            <div class="empty__icon"><Icon name="layout-grid" :size="24" /></div>
            <strong>先选一张图，这里就出图纸</strong>
            <p>
              先<b>上传照片</b>，或者直接从 <b>素材库</b> 挑一个；<b>AI 生成素材</b> 正在对接中，接入后可以用一句话出图。
            </p>
            <p class="only-lg">
              画布按真实画线板拼装：{{ BOARD_SPEC_LIST_TEXT }} 钉，一钉 = 一格，
              当前 {{ options.boardCols }} × {{ options.boardRows }} 块 = {{ width }} × {{ height }} 格。
            </p>
            <div class="emptyActions only-sm">
              <button type="button" class="btn primary" @click="emit('upload')"><Icon name="image-up" :size="16" />上传图片</button>
              <button type="button" class="btn btn-secondary" @click="emit('browse')"><Icon name="images" :size="16" />素材库</button>
            </div>
          </div>
        </div>

        <!-- 拼豆图纸 -->
        <div
          v-if="!showEmpty && currentView === 'pattern'"
          class="board editing" v-show="!showEmpty"
        >
          <canvas ref="cv" @click="onClick" />
          <div
            v-if="fingerLoupe" class="fingerLoupe" :class="{ 'fingerLoupe--below': fingerPickY < 190 }" aria-hidden="true"
            :style="{ left: fingerPickX + 'px', top: fingerPickY + 'px' }"
          >
            <div class="fingerLoupe__lens">
              <canvas ref="loupeCv"></canvas>
              <span class="fingerLoupe__cross"></span>
            </div>
            <b v-if="fingerLoupeCode">{{ fingerLoupeCode }}</b>
          </div>
        </div>

        <!-- 原图 -->
        <div v-if="!showEmpty && currentView === 'original'" class="compareWrap compareWrap--single">
          <figure class="compareBox">
            <img :src="sourceUrl" :style="{ filter: sourceCssFilter }" alt="原图">
            <figcaption>原图（{{ sourceImg ? '已载入' : '无源图' }}）</figcaption>
          </figure>
        </div>

        <!-- 对照 -->
        <div v-if="!showEmpty && currentView === 'compare'" class="compareWrap">
          <figure class="compareBox">
            <img :src="sourceUrl" :style="{ filter: sourceCssFilter }" alt="原图">
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
                点一块板可以预览大图。
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
        <span class="hintWheel">滚轮缩放 · 按住鼠标中键拖动平移</span>
        <span class="hintTouch">双指同时点一下撤回 · 单指编辑 · 长按一格吸色</span>
        <span v-if="tool !== 'pan'" class="only-lg">· {{ tool === 'lasso' ? '点住豆子拖动整张图案，从空格画出一圈只选圈里的豆子，Esc 取消选区（当前工具：套索）' : tool === 'paint' ? paintNote : '直接点格子改色（当前工具：' + (tool === 'erase' ? '橡皮' : tool === 'pick' ? '吸色' : '填充') + '）' }}</span>
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
          <button type="button" class="hintLink" @click="emit('split')">看分板</button>
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
          <button type="button" class="hintLink" @click="emit('split')">看分板</button>
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
          <Icon name="undo-2" :size="16" />
        </button>
        <button
          type="button" class="stageTools__btn" title="重做" aria-label="重做"
          :disabled="!canRedo" @click="redo()"
        >
          <Icon name="redo-2" :size="16" />
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
        <button type="button" class="stageTools__btn" title="放大" aria-label="放大" @click="zoomStep(0.25)">
          <Icon name="plus" :size="16" />
        </button>
        <button type="button" class="stageTools__btn" title="缩小" aria-label="缩小" @click="zoomStep(-0.25)">
          <Icon name="minus" :size="16" />
        </button>
        <button type="button" class="stageTools__btn" title="定位到图纸中心" aria-label="定位到图纸中心" @click="centerStage">
          <Icon name="maximize" :size="16" />
        </button>
      </div>

      <!-- 桌面 / 平板：画布下方原来的两行工具条（手机上整块隐藏；
           全屏工作台由 EditorView 左侧浮动工具栏接管） -->
      <div v-if="!consoleChrome" class="editPanel">
        <div class="canvasCard__foot">
          <div
            class="toolgroup" role="toolbar" aria-label="编辑工具"
            @mouseover="onTipOver($event)" @mouseleave="hideTip()"
          >
            <button
              v-for="t in tools" :key="t.key"
              class="tool" :class="{ on: tool === t.key }"
              :title="toolTitle(t)" :aria-label="desk ? t.title : toolTitle(t)" :aria-pressed="tool === t.key"
              :data-tip="desk ? t.label : (t.key === 'pick' ? '吸色' : null)"
              :data-tip-desc="desk ? (t.desc || '') : (t.key === 'pick' ? '任何工具下，长按一格都能吸色' : null)"
              :data-tip-key="desk ? (t.shortcut || '') : null"
              @click="pickTool(t.key)"
            >
              <Icon :name="t.icon" :size="16" />
              <span class="toolLabel">{{ t.label }}</span>
            </button>
            <span class="toolSep" aria-hidden="true"></span>
            <!-- 撤销/重做：外面套一层 span 专门放 title —— 原生 disabled 按钮在
                 Chrome 里不弹 tooltip，用户只能看到按钮变灰、不知道为什么变灰 -->
            <span
              v-for="h in history" :key="h.key"
              class="toolSlot" :title="historyTitle(h)"
              :data-tip="!desk && h.key === 'undo' ? '撤销' : null"
              :data-tip-desc="!desk && h.key === 'undo' ? '两根手指同时点一下，撤回上一步' : null"
            >
              <button
                class="tool" :aria-label="historyTitle(h)"
                :disabled="h.key === 'undo' ? !canUndo : !canRedo"
                @click="h.key === 'undo' ? undo() : redo()"
              >
                <Icon :name="h.icon" :size="16" />
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
                  :data-tip="desk ? a.label : null"
                  :data-tip-desc="desk ? (a.desc || '') : null"
                  :data-tip-key="desk ? (a.shortcut || '') : null"
                  @click="mirrorPattern('h')"
                >
                  <Icon :name="a.icon" :size="16" />
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
              <span class="muted">{{ tool === 'erase' ? '橡皮' : '画笔' }}</span>
              <button
                class="brushStep" type="button" aria-label="缩小笔刷"
                :disabled="activeToolSize <= 1" @click="stepBrush(-1)"
              ><Icon name="minus" :size="16" /></button>
              <input
                class="brushRange" type="range" min="1" :max="BRUSH_MAX" step="1"
                :value="activeToolSize" aria-label="笔刷大小（格）"
                @input="setBrushSize($event.target.value)"
              >
              <button
                class="brushStep" type="button" aria-label="放大笔刷"
                :disabled="activeToolSize >= BRUSH_MAX" @click="stepBrush(1)"
              ><Icon name="plus" :size="16" /></button>
              <b class="brushSizeVal">{{ activeToolSize }} 格</b>
            </div>
            <button
              v-if="tool === 'paint'"
              type="button" class="brushLine" data-brush-line
              :aria-pressed="brushStroke === 'line'"
              @click="toggleBrushLine"
            >
              <Icon name="line" :size="16" /><span>直线</span>
              <Icon v-if="brushStroke === 'line'" name="check" :size="16" />
            </button>
          </template>
        </div>
      </div>

      <!-- 贴边标尺：贴在画布视口顶边 / 左边的覆盖层，不跟图纸缩放平移 -->
      <CanvasRuler v-if="rulerOn" :geom="rulerGeom" :show-size="options.sizeMarks !== false" />
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
/* 原图只有一张卡：不分两列，否则它只占左半栏、看着像偏到一边 */
.compareWrap--single{grid-template-columns:minmax(0,1fr);max-width:720px}
.compareBox{margin:0;background:#fff;border:1px solid var(--line);border-radius:var(--r-md);padding:10px}
.compareBox img,.compareBox canvas{width:100%;display:block;border-radius:var(--r-xs);image-rendering:pixelated}
.compareBox figcaption{font-size:var(--fs-2xs);color:var(--muted);margin-top:7px;font-weight:700;line-height:var(--ty-caption-lh)}
.splitHead{margin-bottom:12px}
/* 分板列表被截断时的说明 + 跳板输入：用和 .codesHint 同一套珊瑚色语义
   （都是「这里不完整，告诉你完整的去哪儿看」），但它是列表的一部分，
   所以宽度跟着列表走、能换行。 */
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
.boardTile__pic{position:relative;display:block}
.boardTile__zoom{
  position:absolute;right:6px;bottom:6px;width:22px;height:22px;border-radius:50%;
  display:grid;place-items:center;background:rgba(27,27,31,.72);color:#fff;pointer-events:none
}
.materialsWrap .tableWrap{background:#fff}
/* 色号 LOD 提示：珊瑚色跟底板虚线同一套语义（图纸上的界限/说明），别用报错红 */
.codesHint{
  margin:8px 0 0;font-size:var(--fs-2xs);font-weight:700;color:#625800;
  background:rgba(255,218,53,.20);border:1px solid rgba(23,23,23,.22);
  border-radius:var(--r-sm);padding:7px 10px;line-height:var(--ty-caption-lh)
}
/* 舞台和它下面的说明 / 工具条 / 笔刷条同属一块，舞台 flex:1 吃掉剩余高度。
   右侧工具窄栏与抽屉都相对这块定位，所以它必须是定位上下文。 */
.stageWrap{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
/* 平板锁画布：整张图纸固定在「适应窗口」，舞台自身不再滚动 */
.stage--locked{overflow:hidden}
.editPanel{display:block}
/* 手机端才出现的部件：画布浮控。桌面端不占位。
   顶栏浮层（.cmdPop）的显隐在 global.css：功能浮层由 EditorView 渲染。 */
.stageTools{display:none}
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
  font-size:var(--fs-2xs);font-weight:700;color:var(--ink-2);line-height:var(--ty-caption-lh)
}
.actualBadge__dot{width:7px;height:7px;border-radius:50%;background:var(--green-deep);flex:0 0 auto}
/* 全屏工作台左上角是贴边标尺，状态条往下让开一格，不压刻度 */
.actualBadge--console{left:40px;top:36px}
.actualBadge b{color:var(--ink);font-weight:700;white-space:nowrap}
.actualBadge__cm{white-space:nowrap;font-variant-numeric:tabular-nums}
.actualBadge__link{
  padding:0;border:0;background:transparent;color:var(--coral-deep);
  font:inherit;font-weight:700;text-decoration:underline;white-space:nowrap;
}
.stageTools__ratio{font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0}
.stageTools__btn.on{background:var(--primary-soft);color:var(--primary-ink);border-color:var(--primary)}
.stageTools__btn:disabled{opacity:.4}
/* 校准弹窗：尺子按 CSS 像素画，滑杆改比例，标签跟着尺子走 */
.calib__hint{margin:0 0 12px;font-size:var(--fs-2xs);line-height:var(--ty-caption-lh);color:var(--ink-2)}
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
  font-size:12px;font-weight:700;color:var(--ink-2);line-height:var(--ty-caption-lh)
}
.calib__range{
  display:flex;align-items:center;gap:8px;margin-top:14px;
  font-size:var(--fs-2xs);font-weight:700;color:var(--ink-2);line-height:var(--ty-caption-lh)
}
.calib__range input{flex:1;accent-color:var(--primary)}
.calib__range b{min-width:42px;text-align:right;font-variant-numeric:tabular-nums}
.calib__note{margin:12px 0 0;font-size:12px;line-height:var(--ty-caption-lh);color:var(--muted)}
.hintLink{
  margin-left:6px;padding:0;border:0;background:transparent;color:var(--coral-deep);
  font:inherit;font-weight:700;text-decoration:underline;
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
/* 平板 / 手机长按吸色：手指上方的放大镜，中心就是正在吸的那一格。
   坐标是视口坐标（fixed），不跟画布的缩放平移走。 */
.fingerLoupe{
  position:fixed;z-index:40;pointer-events:none;
  width:128px;margin:-168px 0 0 -64px;
  display:flex;flex-direction:column;align-items:center;gap:4px;
}
.fingerLoupe--below{margin-top:28px}
.fingerLoupe__lens{
  width:120px;height:120px;border-radius:50%;overflow:hidden;position:relative;
  border:3px solid #1A2D22;background:#fff;
  box-shadow:0 8px 24px rgba(26,45,34,.28);
}
.fingerLoupe__lens canvas{width:100%;height:100%;display:block}
.fingerLoupe__cross{
  position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;
  border:2px solid #1A2D22;border-radius:2px;box-shadow:0 0 0 1px #fff;
}
.fingerLoupe b{
  font-family:var(--font-numeric);font-size:12px;font-weight:700;line-height:16px;
  color:#1A2D22;background:#fff;border-radius:999px;padding:1px 8px;
  box-shadow:0 2px 8px rgba(26,45,34,.16);
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
  background:var(--surface);color:var(--ink-2);font-size:15px;font-weight:700;line-height:var(--ty-card-lh);
  display:grid;place-items:center;
}
.brushStep:hover:not(:disabled){background:var(--surface-3)}
.brushStep:disabled{opacity:.4;cursor:not-allowed}
.brushRange{width:104px;accent-color:var(--primary);cursor:pointer}
.brushSizeVal{min-width:38px;text-align:center;font-size:var(--fs-2xs);color:var(--ink-2);white-space:nowrap;line-height:var(--ty-caption-lh)}
.brushLine{
  display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 8px;flex:0 0 auto;
  border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink-2);
  font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);white-space:nowrap;
}
.brushLine[aria-pressed="true"]{background:#C8E63C;border-color:#C8E63C;color:#1A2D22}
/* 手机专属的浮动图纸缩略图：桌面端画布一直看得见，直接不显示 */
.miniPreview{
  display:none;position:fixed;right:10px;bottom:78px;z-index:45;
  flex-direction:column;align-items:center;gap:1px;
  padding:5px 5px 3px;border-radius:var(--r-md);border:1px solid var(--line);
  background:rgba(255,255,255,.97);box-shadow:0 10px 28px rgba(24,24,28,.2);
}
.miniPreview canvas{display:block;width:auto;height:auto;max-width:62px;max-height:62px;image-rendering:pixelated}
.miniPreview span{font-size:var(--fs-2xs);font-weight:700;color:var(--muted);white-space:nowrap;line-height:var(--ty-caption-lh)}
canvas{display:block}
@media(max-width:780px){
  .compareWrap{grid-template-columns:1fr}
  /* 手机工作台改成「一屏」：画布卡片吃掉命令栏上方的全部高度，
     舞台 flex:1，缩放交给双指捏合，所以顶栏只留「适应」一个按钮。 */
  .canvasCard{height:100%;padding:8px}
  /* 工具条 + 笔刷条在手机上整块隐藏：工具进顶栏「编辑 ▾」浮层，
     省下的两行高度全部给 .stage。 */
  .editPanel{display:none}

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
  .viewtabs button{flex:1;padding:6px 2px;font-size:var(--fs-2xs);line-height:var(--ty-caption-lh)}
  .viewtabs button .icon{display:none}
  /* 手机顶栏只留 图纸 / 原图 / 对照：分板与材料从「编辑 ▾ → 分板视图」、
     分析/用量卡片进入，顶栏不再挤五个页签。 */
  .viewtabs button:nth-child(n+4){display:none}
  /* 缩放只留实时百分比：加减 / 适应移到画布右侧浮控上 */
  .zoomBar{gap:0;flex:0 0 auto}
  .zoomBar .btn{display:none}
  .zoomBar .zoomText{min-width:34px;font-size:var(--fs-2xs);text-align:right;line-height:var(--ty-caption-lh)}
  @media (max-width:360px){
    .canvasCard__toolbar{gap:3px}
    .viewtabs button{padding:6px 1px;font-size:12px;line-height:var(--ty-caption-lh)}
    /* 320 宽：三个页签 + 实时缩放 + 两颗命令按钮会挤掉「对照」，
       这一档去掉页签图标，文字完整可点。 */
    .viewtabs button .pixelIcon{display:none}
    .zoomBar .zoomText{min-width:30px;font-size:11px}
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
  .toolLabel{font-size:12px;line-height:var(--ty-caption-lh)}
  .brushBar{padding-top:4px;font-size:var(--fs-2xs);gap:6px;line-height:var(--ty-caption-lh)}
  .brushRange{width:78px}
  .brushSize{gap:4px}
  .brushSizeVal{min-width:34px;font-size:12px;line-height:var(--ty-caption-lh)}
  .miniPreview{display:flex}
}
/* 小屏手机（360×640 之类）：命令栏和标签栏的高度不变，
   画布只能靠压掉说明文字来保住可操作面积。工具名保留 ——
   只留图标时用户认不出移动 / 填充 / 吸色的区别。 */
@media(max-width:780px) and (max-height:700px){
  .chartNote{display:none}
  .tool{min-height:32px;gap:2px}
  .toolLabel{font-size:12px;line-height:var(--ty-caption-lh)}
  .brushBar{padding-top:2px;font-size:12px;line-height:var(--ty-caption-lh)}
}
/* 320px 级窄屏：笔刷条一行放不下会折行，把画布压到出现内部滚动。
   去掉「当前画笔」四个字（色块还在），滑块和按钮各收一点。 */
@media(max-width:360px){
  .brushBar > .muted:first-child{display:none}
  .brushRange{width:64px}
  .brushStep{width:28px;height:28px}
  .brushSizeVal{min-width:30px}
}

/* ============================ 全屏工作台（chrome='console'） ============================
   卡片不再是一个「白底圆角盒子」，而是铺满中间那块画布区的透明容器：
   底色 / 网格 / 标尺由外层 .consoleBody 与画布自己负责，卡片只留画布与浮层。 */
.canvasCard--console{
  background:transparent;border:0;border-radius:0;box-shadow:none;padding:0;
  height:100%;min-height:0;
}
.canvasCard--console .stageWrap{flex:1 1 auto;min-height:0}
.canvasCard--console .stage{
  min-height:0;padding:0;background:transparent;border:0;border-radius:0;
}
/* 电脑端：标尺内侧整块都是画布。图纸左上角贴住标尺内沿，
   浮动工具、色板、右侧面板压在画布上，不再把图纸缩成中间一块。
   平移靠四周空白 + scroll（舞台 overflow:hidden，不出现滚动条）。
   手指设备即使宽度 ≥1100（横屏 iPad）也不走这条滚动：
   overflow:hidden 挡不住浏览器自己改 scrollLeft，两指一点画布就跟着跑。
   手指只编辑、两指撤回；鼠标中键平移不受影响。 */
@media(min-width:1100px) and (pointer:fine) and (hover:hover){
  .canvasCard--console .stage--edit{
    overflow:hidden;padding:0;display:block;background:#fff;
    touch-action:none;-webkit-touch-callout:none;
  }
  .canvasCard--console .stage--edit > .board{
    margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;
    width:max-content;justify-self:start;align-self:start;
  }
}
/* 手势说明与「当前工具」提示都收进底部状态栏（那里有固定的位置），
   画布中间只留图纸本身 */
.canvasCard--console .chartNote{display:none}

/* ---------------- 全屏工作台的空状态（设计稿 1:593） ----------------
   画布中央一张上传卡（拖拽区 + 选择本地图片）。
   字号字重按 Figma「豆玩 · 文字与字体规范」1:2：
   卡片标题 15/700/24 · 正文 14/400/22 · 辅助 12/400/18。 */
.upCard{
  width:min(340px,86%);padding:16px;border-radius:16px;background:#fff;
  border:1px solid #DDE5D8;box-shadow:0 6px 20px rgba(26,45,34,.08);
  display:flex;flex-direction:column;gap:12px;color:#2A3C30;
}
.upCard--min{width:auto;padding:0;border:0;background:none;box-shadow:none}
.upCard__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.upCard__head b{
  font-family:var(--font-sans);font-size:15px;font-weight:700;line-height:var(--ty-card-lh);letter-spacing:0;color:#1A2D22;
}
.upCard__x{
  width:28px;height:28px;border:0;border-radius:8px;background:#F0F5EC;color:#52685A;
  display:grid;place-items:center;cursor:pointer;
}
.upCard__x:hover{background:#E6EDE1}
.upCard__drop{
  border:1.5px dashed #C8E63C;border-radius:12px;background:#FBFDF6;
  padding:22px 14px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;
}
.upCard__icon{
  width:36px;height:36px;border-radius:50%;display:grid;place-items:center;
  background:#F2F8D9;color:#6F8117;
}
.upCard__title{
  font-family:var(--font-sans);font-size:14px;font-weight:700;line-height:var(--ty-body-lh);letter-spacing:0;color:#1A2D22;
}
.upCard__hint{
  font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:#7A9080;
}
.upCard__btn{
  height:42px;border:0;border-radius:999px;background:#1A2D22;color:#fff;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font-family:var(--font-sans);font-size:15px;font-weight:700;line-height:var(--ty-card-lh);letter-spacing:0;
}
.upCard__btn:hover{background:#25402F}

/* 空状态在画布正中间：全屏工作台的画布就是一整块方格纸，
   提示与上传卡都要落在正中间（不是顶部对齐）。 */
.canvasCard--console .stage--empty .empty--guide{
  height:100%;min-height:100%;justify-content:center;gap:0;
}
</style>
