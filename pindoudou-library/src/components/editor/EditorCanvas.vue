<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  pattern, hasPattern, width, height, zoom, setZoom, tool, brushColorId,
  brushSize, BRUSH_MAX,
  options, currentView, canvasEl, paintAt, fillAt, pickAt, undo, redo,
  canUndo, canRedo, undoDepth, redoDepth, beginEdit, endEdit, cancelEdit, revertEdit,
  mirrorPattern,
  stats, sourceUrl, sourceImg, generating, genMs, fitNotice,
  selectedBoard, layout, materials
} from '../../composables/useStudio.js'
import { drawChart, drawPixels, drawBoard, hitTest, chartGeometry, chartCellCap, updateChartLayer, markChartLayer, canvasDpr } from '../../lib/render.js'
import { boardBeadCounts } from '../../lib/pattern.js'
import { EDIT_TOOLS, EDIT_HISTORY, EDIT_ACTIONS } from '../../data/icons.js'
import PixelIcon from '../ui/PixelIcon.vue'
import PatternPreview from '../ui/PatternPreview.vue'

/* 手机端：上传命令直接放在画布空状态里（桌面端仍指向左栏的 ① 创建） */
const props = defineProps({
  /* 手机端只能同时开一个面板：'none' | 'tools' | 'functions'。
     functions 的底部八功能由 EditorView 管，这里只负责右侧工具抽屉。 */
  panel: { type: String, default: 'none' }
})
const emit = defineEmits(['upload', 'browse', 'panel', 'resize', 'tutorial', 'delivery'])

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
  { key: 'pattern', icon: 'grid', label: '拼豆图纸', short: '图纸' },
  { key: 'original', icon: 'photo', label: '原图', short: '原图' },
  { key: 'compare', icon: 'swap', label: '对照', short: '对照' },
  { key: 'split', icon: 'layout', label: '分板', short: '分板' },
  { key: 'materials', icon: 'layers', label: '材料', short: '材料' }
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

const showEmpty = computed(() => {
  if (!hasPattern.value) return true
  if (currentView.value === 'original') return !sourceImg.value
  return false
})

/* ---------------------------------------------------------------- 手机端右侧工具窄栏
   ≤780px：画布右侧固定 5 项（编辑 / 取色 / 橡皮 / 填充 / 更多），
   「更多」从右侧展开次级面板。桌面端这套按钮整体 display:none，
   画布下方原来的两行工具条一行没动。 */
const railTools = [
  { key: 'paint', icon: 'brush', label: '编辑', title: '编辑：点一下格子改成当前颜色' },
  { key: 'pick', icon: 'pick', label: '取色', title: '取色：取格子上的颜色当画笔色' },
  { key: 'erase', icon: 'eraser', label: '橡皮', title: '橡皮：擦掉这一格（不放豆）' },
  { key: 'fill', icon: 'fill', label: '填充', title: '填充：整块同色区域一次性替换' }
]
const moreOpen = computed(() => props.panel === 'tools')
function closePanel() { emit('panel', 'none') }
function toggleMore() { emit('panel', moreOpen.value ? 'none' : 'tools') }
/* 选完工具就收起：下一步通常就是去画布上画 */
function pickTool(key) {
  tool.value = key
  closePanel()
}
function toggleGrid() { options.showGrid = !options.showGrid }
function openSplit() {
  currentView.value = 'split'
  closePanel()
}
/* 手机顶栏只留三个视图页签；材料清单是原有视图，收进「更多」保留入口 */
function openMaterials() {
  currentView.value = 'materials'
  closePanel()
}
function goTutorial() {
  closePanel()
  emit('tutorial')
}
function goDelivery() {
  closePanel()
  emit('delivery')
}
watch([currentView, showEmpty], () => {
  if (moreOpen.value) closePanel()
})

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

  trackTouch(e)
  /* 右侧工具抽屉开着时由抽屉自己的遮罩接管点击（见 .toolScrim），
     不会走到这里；画布上任何落笔都按当前工具执行。 */
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
  autoFit = false
  setZoom(v)
}

onMounted(() => {
  redrawAll()
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
        ><PixelIcon :name="v.icon" :size="13" /><span class="tabLong">{{ v.label }}</span><span class="tabShort">{{ v.short }}</span></button>
      </div>

      <!-- 平移模式要有可见状态：工具按钮高亮之外，顶栏再给一条明确提示，
           避免用户以为单指拖动会改图 -->
      <span v-if="currentView === 'pattern' && !showEmpty && tool === 'pan'" class="panState"><PixelIcon name="pan" :size="12" />移动画布模式</span>

      <!-- 缩放：参考版是「− 100% ＋」一组。本站多一个「适应」，
           因为大画布（最多 1000×1000 格 = 100 万格）不一键回中很容易在画布外找不到图 -->
      <div class="zoomBar">
        <template v-if="currentView === 'pattern'">
          <button class="btn btn-secondary icon sm" title="缩小" aria-label="缩小" @click="onUserZoom(zoom - 0.25)"><PixelIcon name="zoomOut" :size="14" /></button>
          <span class="zoomText">{{ Math.round(zoom * 100) }}%</span>
          <button class="btn btn-secondary icon sm" title="放大" aria-label="放大" @click="onUserZoom(zoom + 0.25)"><PixelIcon name="zoomIn" :size="14" /></button>
          <button class="btn btn-secondary sm" title="适应窗口" @click="autoFit = true; fitToStage()">适应</button>
        </template>
        <span v-else-if="genMs" class="muted">{{ genMs }}ms</span>
      </div>

      <!-- 手机端：保存放进这条顶栏。工作台顶部的作品名与「作品」切换在
           手机上整行不显示，把高度让给画布；作品列表走底部标签栏的「作品」。 -->
      <slot name="toolbar" />
    </div>

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
        <!-- 空状态：左栏「① 创建」里就是三个入口（上传照片 / AI生成素材 /
             免费素材库），所以这里只指路、不再重复放一套上传控件。
             另外「切到原图视图但源图不在内存里」也会落到这里。
             文案不写「左边」：手机上那张卡就在这块画布正上方，桌面端才在左栏。 -->
        <div v-if="showEmpty" class="empty">
          <div class="empty__icon"><PixelIcon name="layout" :size="24" /></div>
          <strong>先选一张图，这里就出图纸</strong>
          <p>
            先<b>上传照片</b>，或者直接从 <b>免费素材库</b> 挑一个；<b>AI 生成素材</b> 正在对接中，接入后可以用一句话出图。
          </p>
          <p class="only-lg">
            画布按真实底板拼装，标准大号方板 29 × 29 插钉（约 14.5 cm），
            当前 {{ options.boardCols }} × {{ options.boardRows }} 块 = {{ width }} × {{ height }} 格。
          </p>
          <div class="emptyActions only-sm">
            <button type="button" class="btn primary" @click="emit('upload')"><PixelIcon name="upload" :size="14" />上传图片</button>
            <button type="button" class="btn btn-secondary" @click="emit('browse')"><PixelIcon name="palette" :size="14" />免费素材库</button>
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
                共 {{ layout ? layout.count : 0 }} 块标准大号方板（每块 29×29 插钉，约 14.5 cm）。
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
        <template v-if="tool === 'pan'">
          移动画布模式 · 单指拖动（或双指）只平移视野，不会修改任何格子
        </template>
        <template v-else>
          <span class="hintWheel">滚轮缩放 · 按住空白处拖拽平移</span>
          <span class="hintTouch">双指捏合缩放 / 拖动平移 · 单指编辑</span>
          <span class="only-lg">· 直接点格子改色（当前工具：
            {{ tool === 'paint' ? '画笔' : tool === 'erase' ? '橡皮' : tool === 'pick' ? '吸色' : '填充' }}）</span>
        </template>
      </div>

      <!-- 画布太大就不逐格印色号了（见 CODES_CELL_LIMIT）。必须说清楚去哪儿看：
           用户只会发现「色号开关明明开着，图上却没有」，不给指路就等于坏了 -->
      <p v-if="!showEmpty && currentView === 'pattern' && codesSuppressed" class="codesHint">
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

      <!-- 缩放已经顶到像素上限：再按「＋」画面也不会变大（画布本身就这么大）。
           必须解释「不是你按坏了」并给出去哪儿看细节，否则用户只会以为缩放卡住了 -->
      <p v-if="!showEmpty && currentView === 'pattern' && zoomCapped" class="codesHint">
        <span class="hintLong">
          缩放已到上限：{{ width }}×{{ height }} 格的图纸整张铺开已经用满浏览器单张画布的像素上限
          （每格约 {{ cellPx.toFixed(1) }} px），再放大也只会变糊。
          要把每颗豆看得更清，请用分板视图逐块放大看，或者导出图纸对着拼。
        </span>
        <span class="hintShort">已到缩放上限，看细节请用分板视图或导出图纸。</span>
      </p>

      <!-- 手机端：右侧工具窄栏固定在画布容器内部（不随图纸滚动）。
           桌面端整块 display:none，画布下方仍是原来的两行工具条。 -->
      <div
        v-if="!showEmpty && currentView === 'pattern'"
        class="toolRail no-print" role="toolbar" aria-label="画布工具"
      >
        <button
          v-for="t in railTools" :key="t.key"
          type="button" class="toolRail__btn" :class="{ on: tool === t.key }"
          :title="t.title" :aria-label="t.title" :aria-pressed="tool === t.key"
          @click="pickTool(t.key)"
        >
          <PixelIcon :name="t.icon" :size="17" />
          <span>{{ t.label }}</span>
        </button>
        <button
          type="button" class="toolRail__btn toolRail__more" :class="{ on: moreOpen }"
          :aria-expanded="moreOpen" aria-haspopup="dialog"
          aria-label="更多工具" title="更多工具"
          @click="toggleMore"
        >
          <PixelIcon name="sliders" :size="17" />
          <span>更多</span>
        </button>
      </div>

      <!-- 手机端：更多工具抽屉。遮罩在抽屉下层，点空白只关抽屉，不会落到画布上 -->
      <div
        v-if="moreOpen" class="toolScrim no-print"
        @pointerdown.stop.prevent="closePanel" @click.stop.prevent
      ></div>
      <aside
        v-if="moreOpen" class="toolDrawer no-print" role="dialog" aria-label="更多工具"
        @pointerdown.stop
      >
        <header class="toolDrawer__head">
          <b>更多工具</b>
          <button type="button" class="toolDrawer__close" aria-label="关闭工具面板" @click="closePanel">
            <PixelIcon name="close" :size="13" />
          </button>
        </header>
        <div class="toolDrawer__body">
          <section>
            <h4>编辑操作</h4>
            <div class="drawerGrid">
              <button
                type="button" class="drawerBtn" :disabled="!canUndo"
                :title="historyTitle(history[0])" @click="undo()"
              >
                <PixelIcon name="undo" :size="14" /><span>撤销</span>
              </button>
              <button
                type="button" class="drawerBtn" :disabled="!canRedo"
                :title="historyTitle(history[1])" @click="redo()"
              >
                <PixelIcon name="redo" :size="14" /><span>重做</span>
              </button>
            </div>
          </section>

          <section>
            <h4>移动</h4>
            <button
              type="button" class="drawerBtn wide" :class="{ on: tool === 'pan' }"
              :aria-pressed="tool === 'pan'" @click="pickTool('pan')"
            >
              <PixelIcon name="pan" :size="14" /><span>移动画布</span>
              <em>单指拖动只平移视野</em>
            </button>
          </section>

          <section>
            <h4>镜像</h4>
            <div class="drawerGrid">
              <button
                type="button" class="drawerBtn" :disabled="!hasPattern"
                :title="actionTitle(actions[0])" @click="mirrorPattern('h')"
              >
                <PixelIcon name="flipH" :size="14" /><span>左右镜像</span>
              </button>
              <button
                type="button" class="drawerBtn" :disabled="!hasPattern"
                :title="actionTitle(actions[1])" @click="mirrorPattern('v')"
              >
                <PixelIcon name="flipV" :size="14" /><span>上下镜像</span>
              </button>
            </div>
          </section>

          <section>
            <h4>视图</h4>
            <button type="button" class="drawerRow" :aria-pressed="options.showGrid" @click="toggleGrid">
              <span>网格显示</span>
              <span class="drawerSwitch" :class="{ on: options.showGrid }">{{ options.showGrid ? '开' : '关' }}</span>
            </button>
            <button type="button" class="drawerRow" @click="openSplit">
              <span>分板视图</span><span class="drawerArrow"><PixelIcon name="chevronRight" :size="11" /></span>
            </button>
            <button type="button" class="drawerRow" @click="openMaterials">
              <span>材料清单</span><span class="drawerArrow"><PixelIcon name="chevronRight" :size="11" /></span>
            </button>
            <button type="button" class="drawerRow" @click="goTutorial">
              <span>新手教程</span><span class="drawerHint">4 段视频</span>
            </button>
            <button type="button" class="drawerRow" @click="goDelivery">
              <span>导出图纸</span><span class="drawerArrow"><PixelIcon name="chevronRight" :size="11" /></span>
            </button>
          </section>

          <section>
            <h4>缩放</h4>
            <div class="drawerZoom">
              <button type="button" class="drawerStep" aria-label="缩小" @click="onUserZoom(zoom - 0.25)">
                <PixelIcon name="minus" :size="12" />
              </button>
              <b>{{ Math.round(zoom * 100) }}%</b>
              <button type="button" class="drawerStep" aria-label="放大" @click="onUserZoom(zoom + 0.25)">
                <PixelIcon name="plus" :size="12" />
              </button>
              <button type="button" class="drawerFit" @click="autoFit = true; fitToStage()">适应</button>
            </div>
          </section>

          <section v-if="brush && (tool === 'paint' || tool === 'erase')">
            <h4>笔刷</h4>
            <div class="drawerBrush">
              <span class="swatchPill"><i :style="{ background: brush.hex }"></i>{{ brush.code }}</span>
              <button
                type="button" class="drawerStep" aria-label="缩小笔刷"
                :disabled="brushSize <= 1" @click="stepBrush(-1)"
              ><PixelIcon name="minus" :size="12" /></button>
              <input
                class="brushRange" type="range" min="1" :max="BRUSH_MAX" step="1"
                :value="brushSize" aria-label="笔刷大小（格）"
                @input="setBrushSize($event.target.value)"
              >
              <button
                type="button" class="drawerStep" aria-label="放大笔刷"
                :disabled="brushSize >= BRUSH_MAX" @click="stepBrush(1)"
              ><PixelIcon name="plus" :size="12" /></button>
              <b>{{ brushSize }} 格</b>
            </div>
          </section>
        </div>
      </aside>

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
                 两颗包成一组：窄屏放不下时一起换行，不会只把「上下」甩到第二行。
                 同样套一层 .toolSlot：按钮禁用时 Chrome 不弹 disabled 按钮的 tooltip。 -->
            <div class="toolgroup__act">
              <span
                v-for="a in actions" :key="a.key"
                class="toolSlot" :title="actionTitle(a)"
              >
                <button
                  class="tool" :aria-label="actionTitle(a)"
                  :disabled="!hasPattern"
                  @click="mirrorPattern(a.key === 'flipV' ? 'v' : 'h')"
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
/* 手机端才出现的部件：窄栏 / 更多抽屉 / 上传提示。桌面端全部不占位。 */
.toolRail,.toolDrawer,.toolScrim,.genNotice{display:none}
.hintLink{
  margin-left:6px;padding:0;border:0;background:transparent;color:var(--coral-deep);
  font:inherit;font-weight:850;text-decoration:underline;
}
/* 分隔线不跟着按钮拉伸：手机上工具组会换成两行，拉满高度会变成一条很长的竖线 */
.toolSep{width:1px;height:26px;align-self:center;background:var(--line-strong);margin:0 3px}
/* 9 颗按钮在 1440 三栏的中栏里正好卡满一行：间距从 6 收到 4，
   否则总宽和容器一样宽，四舍五入就会把最后一颗挤到第二行 */
.toolgroup{gap:4px}
/* 镜像两颗绑成一组：窄屏换行时一起下去。手机端改成 display:contents，
   让两颗按钮直接成为 9 列网格的格子。 */
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
  /* 手机工作台把工具收成一行（5 个工具 + 撤销 / 重做 + 2 个镜像 = 9 格），
     省下纵向空间。它是 .canvasCard__foot 的 flex 子项，必须 flex:1 才会撑满；
     否则按内容宽缩在左边，每格只剩 24px，标签会折成竖排。
     exportgroup 在手机上会被全局的 width:100% 撑开、把工具组挤扁，
     这里收回 auto（工作台的导出入口已经移进命令栏的「交付」）。 */
  .toolgroup{
    display:grid;grid-template-columns:repeat(9,minmax(0,1fr));
    flex:1 1 auto;gap:3px;justify-content:stretch;
  }
  .exportgroup{width:auto;flex:0 0 auto}
  /* 9 格之后每格只剩 30 多像素，图标 + 文字横排会互相挤：
     改成图标在上、文字在下，标签仍留在按钮里。 */
  .toolgroup .tool{
    width:100%;flex-direction:column;gap:2px;padding:3px 2px;
  }
  .toolSep{display:none}
  .toolSlot{display:block}
  /* 手机上是 9 列网格：拆掉镜像那层包裹，两颗按钮各占一格 */
  .toolgroup__act{display:contents}
  .actLong{display:none}
  .actShort{display:inline}
}
.stage--empty .empty__icon{
  width:58px;height:58px;border-radius:18px;background:var(--primary-soft);color:var(--primary-ink);
}
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
  /* 工具条 + 笔刷条在手机上整块隐藏：常用工具进右侧窄栏，其余进「更多」抽屉，
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

  /* 右侧工具窄栏：固定在画布容器内，不随图纸滚动 */
  .toolRail{
    display:flex;position:absolute;top:8px;right:6px;z-index:18;
    flex-direction:column;gap:3px;padding:4px;
    max-height:calc(100% - 16px);overflow-y:auto;overscroll-behavior:contain;
    background:rgba(255,255,255,.97);border:1px solid var(--line);
    border-radius:14px;box-shadow:0 8px 22px rgba(24,24,28,.13);
  }
  .toolRail__btn{
    width:46px;min-height:46px;padding:4px 2px;border:0;border-radius:10px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    background:transparent;color:var(--ink-2);font-size:9px;font-weight:850;line-height:1.1;
  }
  .toolRail__btn span{white-space:nowrap}
  .toolRail__btn:active{background:var(--surface-3)}
  .toolRail__btn.on{background:var(--primary-soft);color:var(--primary-ink)}
  .toolRail__more{color:var(--muted)}

  /* 更多工具抽屉：从右侧展开，高度受画布容器限制，内容自己滚 */
  .toolScrim{
    display:block;position:absolute;inset:0;z-index:28;background:rgba(31,41,55,.18);
  }
  .toolDrawer{
    display:flex;flex-direction:column;position:absolute;top:0;right:0;bottom:0;z-index:29;
    width:min(296px,86%);max-height:100%;
    background:var(--surface);border:1px solid var(--line);border-radius:12px 0 0 12px;
    box-shadow:-10px 0 30px rgba(24,24,28,.18);
  }
  .toolDrawer__head{
    display:flex;align-items:center;justify-content:space-between;gap:8px;
    padding:10px 12px;border-bottom:1px solid var(--line);flex:0 0 auto;
  }
  .toolDrawer__head b{font-size:var(--fs-sm)}
  .toolDrawer__close{
    width:36px;height:36px;flex:0 0 auto;border:1px solid var(--line);border-radius:10px;
    display:grid;place-items:center;background:var(--surface-2);color:var(--ink-2);
  }
  .toolDrawer__body{
    flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
    padding:10px 12px calc(14px + env(safe-area-inset-bottom));
  }
  .toolDrawer__body section+section{margin-top:12px;padding-top:11px;border-top:1px solid var(--line)}
  .toolDrawer__body h4{margin:0 0 7px;font-size:9px;font-weight:850;letter-spacing:.04em;color:var(--muted-2)}
  .drawerGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .drawerBtn{
    min-height:44px;padding:6px 8px;border:1px solid var(--line);border-radius:10px;
    display:flex;align-items:center;gap:6px;background:var(--surface-2);
    color:var(--ink-2);font-size:var(--fs-2xs);font-weight:800;text-align:left;
  }
  .drawerBtn:active{background:var(--primary-soft)}
  .drawerBtn.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary-ink)}
  .drawerBtn:disabled{opacity:.42}
  .drawerBtn.wide{width:100%}
  .drawerBtn em{margin-left:auto;font-style:normal;font-size:9px;color:var(--muted-2);font-weight:600}
  .drawerRow{
    width:100%;min-height:44px;padding:0 2px;border:0;border-bottom:1px solid var(--line);
    display:flex;align-items:center;justify-content:space-between;gap:8px;
    background:transparent;color:var(--ink);font-size:var(--fs-xs);font-weight:750;text-align:left;
  }
  .drawerRow:last-child{border-bottom:0}
  .drawerSwitch{
    min-width:38px;height:24px;padding:0 8px;border-radius:999px;display:grid;place-items:center;
    background:var(--surface-3);color:var(--muted);font-size:9px;font-weight:850;
  }
  .drawerSwitch.on{background:var(--green-soft);color:var(--green-deep)}
  .drawerArrow{display:inline-flex;color:var(--muted-2)}
  .drawerHint{font-size:9px;color:var(--muted-2);font-weight:600}
  .drawerZoom{display:flex;align-items:center;gap:6px}
  .drawerZoom b{min-width:44px;text-align:center;font-size:var(--fs-xs);font-variant-numeric:tabular-nums}
  .drawerStep{
    width:36px;height:36px;flex:0 0 auto;border:1px solid var(--line);border-radius:9px;
    display:grid;place-items:center;background:var(--surface-2);color:var(--ink-2);
  }
  .drawerStep:disabled{opacity:.4}
  .drawerFit{
    margin-left:auto;min-height:36px;padding:0 12px;border:1px solid var(--line);
    border-radius:9px;background:var(--surface-2);font-size:var(--fs-2xs);font-weight:850;color:var(--ink);
  }
  .drawerBrush{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .drawerBrush b{font-size:var(--fs-2xs);color:var(--ink-2);white-space:nowrap}
  .drawerBrush .brushRange{width:82px}
  .canvasCard__toolbar{flex-direction:row;align-items:center;gap:6px;padding-bottom:6px;flex-wrap:nowrap}
  .viewtabs{flex:1;min-width:0}
  .viewtabs button{flex:1;padding:6px 3px;font-size:var(--fs-2xs)}
  .viewtabs button .icon{display:none}
  /* 手机顶栏只留 图纸 / 原图 / 对照：分板与材料从「更多 → 分板视图」、
     分析/用量卡片进入，顶栏不再挤五个页签。 */
  .viewtabs button:nth-child(n+4){display:none}
  /* 手机上顶栏还要放「? / 保存」，五个页签用短名（图纸 / 原图 / …）才不换行 */
  .tabLong{display:none}
  .tabShort{display:inline}
  .zoomBar{gap:4px}
  .zoomBar .btn.icon.sm{display:none}
  .zoomBar .zoomText{min-width:38px;font-size:var(--fs-2xs)}
  /* 320 宽：三个页签 + 缩放 + 适应 + 保存会把「对照」挤到缩放数字下面，
     这里把固定宽度压一点，页签仍然完整可点。 */
  @media (max-width:360px){
    .canvasCard__toolbar{gap:4px}
    .viewtabs button{padding:6px 2px;font-size:10px}
    .zoomBar{gap:2px}
    .zoomBar .zoomText{min-width:32px}
    .zoomBar .btn.sm{padding:0 8px}
    .canvasActions .btn{padding:0 7px}
  }
  .panState{display:none}
  .stage{flex:1;height:auto;min-height:0;padding:8px}
  /* 图纸视图右侧留出工具窄栏的位置：不让窄栏压在可编辑的格子上，
     也让 fitToStage 量到的可用宽度和真实可画区域一致。 */
  .stage--edit{padding-right:62px}
  /* 手机上不再留那行手势说明：右侧窄栏已经把工具摆出来，
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
