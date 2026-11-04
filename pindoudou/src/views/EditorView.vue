<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EditorSidebar from '../components/editor/EditorSidebar.vue'
import EditorCanvas from '../components/editor/EditorCanvas.vue'
import EditorInsights from '../components/editor/EditorInsights.vue'
import DeliveryPanel from '../components/editor/DeliveryPanel.vue'
import UploadDialog from '../components/editor/UploadDialog.vue'
import MaterialsDialog from '../components/editor/MaterialsDialog.vue'
import AiDialog from '../components/editor/AiDialog.vue'
import ExportDialog from '../components/editor/ExportDialog.vue'
import AnalysisDialog from '../components/editor/AnalysisDialog.vue'
import StockDialog from '../components/editor/StockDialog.vue'
import ImageAdjustPanel from '../components/editor/ImageAdjustPanel.vue'
import SizeQuickCard from '../components/editor/SizeQuickCard.vue'
import PaletteCard from '../components/editor/PaletteCard.vue'
import ColorReplaceDialog from '../components/editor/ColorReplaceDialog.vue'
import ShortcutTip from '../components/editor/ShortcutTip.vue'
import BaseDialog from '../components/ui/BaseDialog.vue'
import LoginDialog from '../components/ui/LoginDialog.vue'
import Icon from '../components/ui/Icon.vue'
import { PALETTE_BRANDS, getColorById } from '../lib/palettes.js'
import { AI_GENERATION_READY, AI_PENDING_TEXT } from '../lib/aiPending.js'
import {
  hasPattern, projectName, stats, pattern, saveStatus,
  currentProjectId, ensureProjectLoaded, saveProject, generating,
  projectLimit, projects, useImageFile, sourceUrl,
  tool, brushSize, eraserSize, BRUSH_MAX, toolSizeOf, setToolSize, brushColorId,
  mirrorPattern, removeSpecks, options, currentView,
  zoom, setZoom, layout, availableColors, maxCells, brand,
  setCanvasCapacity, setMatteLevel, setRemoveBg, matteLevels,
  cropSource,
  undo, redo, canUndo, canRedo,
  openColorReplace, ensureBlankCanvas,
  createMode, workspaceMode, switchCreateMode, activateCreateMode, stashCurrentWorkspace
} from '../composables/useStudio.js'
import { EDIT_TOOLS } from '../data/icons.js'
import { BOARD_SPECS, boardSpecFor } from '../lib/boardSpec.js'
import { useBackClose } from '../composables/useBackClose.js'
import { useShortcutTip } from '../composables/useShortcutTip.js'
import { isLoggedIn, isAnonymousDevice } from '../composables/useUserAccount.js'
import { takePendingUpload } from '../composables/usePendingUpload.js'
import { toastOk, toastWarn, toastErr } from '../composables/useToast.js'
import { loadRemoteAssets } from '../composables/useAssets.js'
import { projectCanvas } from '../lib/forge.js'
import { onRangeWheel } from '../lib/rangeWheel.js'
import { trackEvent } from '../lib/telemetry.js'

const route = useRoute()
const router = useRouter()

const proOpen = ref(false)
const proReason = ref('')
const deliveryOpen = ref(false)
const deliveryTab = ref('export')

function openDelivery(tab = 'export') {
  mobileMore.value = 'none'
  closeDrawer()
  deliveryTab.value = tab
  deliveryOpen.value = true
}

function needPro(reason) {
  proReason.value = reason || '该功能需要 Pro 套餐。'
  proOpen.value = true
}

/* ---------------------------------------------------------------- 全屏工作台
   设计稿（Figma「豆玩 · 自由创作工作台 / 图片编辑工作台」）只有桌面与手机两档。
   全局命令栏（作品栏 + 素材与方案）→ 文档与视图 → 画布 → 画布状态栏。
   手机 / 平板没有对应设计，继续用原来的卡片式版面（命令收进底部两排按钮）。
   所以这里按视口切两套外壳，共用同一份工作台状态与同一个 EditorCanvas。 */
const logoUrl = new URL('../assets/logo-douwan.webp', import.meta.url).href

/* 创作模式：自由创作（在空白网格上画）/ 图片编辑（先调原图再生成图纸）。
   设计稿把这两个模式做成命令栏右侧的分段开关，切换时命令栏、工具轨、右侧入口、
   状态栏文案都跟着换。
   两种模式各自有一份独立文档（见 useStudio 的 switchCreateMode）：
   切到自由画布永远不会带出图纸转换导入的图片或生成好的图纸。 */
/* 自由画布：进来就是一张空白网格，左侧编辑工具默认就能画。
   全屏 / 手机工作台铺这张空白图；平板旧版面没有模式开关，保持原来的上传引导。 */
function blankableFree() {
  return consoleMode.value || mobileConsole.value
}
function syncFreeCanvas() {
  if (createMode.value !== 'free') return
  normalizeFreeView()
  if (blankableFree()) ensureBlankCanvas()
}
/* 自由画布没有原图与对照可看：停在「原图 / 对照」时回到拼豆图纸，
   否则页签被收起后会停在一个没有出口的视图上。平板旧版面没有模式开关，不受影响。 */
function normalizeFreeView() {
  if (createMode.value !== 'free') return
  if (!consoleMode.value && !mobileConsole.value) return
  if (currentView.value === 'original' || currentView.value === 'compare') currentView.value = 'pattern'
}
function setCreateMode(mode) {
  if (mode === createMode.value) return
  if (!switchCreateMode(mode, { blankFree: blankableFree() })) return
  if (mode === 'edit') {
    /* 图纸转换没有文档时回到上传卡；有自己的图纸就停在它离开时的那一页 */
    if (!hasPattern.value) currentView.value = 'original'
  } else {
    normalizeFreeView()
  }
}

/* 品牌色板下拉：命令栏里直接换色板（左栏 ④ 里那份是同一套数据） */
const brandOpen = ref(false)
/* 命令栏按设计稿只写「MARD 291 色」，下拉里保留完整名称「MARD 291 色套装」 */
const brandLabel = computed(() => (brand.value && brand.value.name ? brand.value.name.replace(/\s*套装$/, '') : ''))
const paletteBrands = PALETTE_BRANDS
function pickBrand(b) {
  brandOpen.value = false
  if (options.brandId === b.id) return
  options.brandId = b.id
}

/* 换色：入口在右栏「颜色用量」每行的换色按钮（桌面右栏与手机弹层共用同一实例状态） */
function onReplaceColor(id) {
  if (!openColorReplace(id)) toastWarn('没有在当前图纸上找到这个颜色')
}

/* 智能抠图：命令栏一颗开关，力度在「图片调整」面板里选 */
function toggleMatte() {
  if (!sourceUrl.value) return
  void setRemoveBg(!options.removeBg)
}

/* 图片调整面板应用后回到图纸视图（图纸转换里调的，不要顺手切到自由画布） */
function onAdjustApplied() {
  closeDrawer()
  closeMsSheet()
  currentView.value = 'pattern'
}

/* 图纸转换的视图名：进来先看原图（先调原图再生成），导入图像后停在拼豆图纸 */
const editViewLabel = computed(() => {
  if (currentView.value === 'original') return '原图预览'
  if (currentView.value === 'compare') return '原图对照'
  if (currentView.value === 'split') return '分板'
  if (currentView.value === 'materials') return '材料'
  return '拼豆图纸'
})

/* 状态栏一行：设计稿左边是「空白图纸 · 底板 14 × 14 cm · 0 色 · 0 颗 · 自由创作」 */
const statusLine = computed(() => {
  if (createMode.value === 'edit') {
    const w = options.canvasW
    const h = options.canvasH
    return `${editViewLabel.value} · 目标图纸 ${w} × ${h} 格 · 用色上限 ${options.targetColors} 色 · ${hasPattern.value ? '已生成图纸' : '待生成图纸'}`
  }
  if (!hasPattern.value) {
    const cm = (boardSpec.value * 0.27).toFixed(1)
    return `空白图纸 · 底板 ${cm} × ${cm} cm · 0 色 · 0 颗 · 自由画布`
  }
  const s = stats.value
  return `${s.artW} × ${s.artH} 格 · 底板 ${s.boardCm} · ${s.colors} 色 · ${s.total.toLocaleString()} 颗 · 自由画布`
})

/* 手机端图片编辑：状态行（设计稿「待生成 · 52 × 52 格 · MARD · 最多 24 色」） */
const msEditStatus = computed(() => {
  const name = brand.value && brand.value.name ? brand.value.name : ''
  return `${hasPattern.value ? '已生成' : '待生成'} · ${options.canvasW} × ${options.canvasH} 格 · ${name} · 最多 ${options.targetColors} 色`
})

const wideQuery = window.matchMedia('(min-width: 1100px)')
const consoleMode = ref(wideQuery.matches)
function onWideChange() {
  consoleMode.value = wideQuery.matches
  /* 跨回 ≥1100 时工具轨重新出现，面板要重新贴一次位置（跨出去时它随工具轨一起隐藏，
     状态留着，回来还是开着的那一块） */
  if (consoleMode.value && paletteOpen.value) placePaletteFly()
  syncFreeCanvas()
}

/* 手机工作台（≤780px）：设计稿 124:887。顶部作品栏 + 模式栏，
   画布铺满，底部缩放栏 + 五格工具轨；成品尺寸 / 色板 / 更多工具走底部抽屉。 */
const narrowQuery = window.matchMedia('(max-width: 780px)')
const mobileConsole = ref(narrowQuery.matches)
function onNarrowChange() { mobileConsole.value = narrowQuery.matches }
const msSheet = ref('')
const MS_SHEET_TITLES = { color: '颜色', more: '更多工具', menu: '更多', adjust: '图片调整', crop: '裁切图片' }
const msSheetTitle = computed(() => MS_SHEET_TITLES[msSheet.value] || '')
function openMsSheet(key) {
  if (key === 'crop' && !sourceUrl.value) return
  msSheet.value = msSheet.value === key ? '' : key
}
function closeMsSheet() { msSheet.value = '' }

/* 右侧滑出面板：复用左栏 / 右栏已有的卡片（它们本来就有 focus 模式只显示一张卡），
   不再为「成品尺寸 / 生成方案 / 作品分析 / 我的库存」各写一套界面。 */
const DRAWER_TITLES = {
  create: '图片与处理',
  size: '画布与成品尺寸',
  scheme: '生成方案',
  palette: '色板与参数',
  analysis: '作品分析',
  colors: '颜色用量',
  stock: '我的库存',
  adjust: '图片调整'
}
const drawerKey = ref('')
/* 右侧「成品尺寸」卡默认收起（设计稿 1:1193 / 1:2445 都是收起态：
   只留一行标题 + 箭头，滑杆、比例说明与当前尺寸都藏起来），点卡头就地展开。 */
const sizeOpen = ref(false)
const drawerTitle = computed(() => DRAWER_TITLES[drawerKey.value] || '')
const drawerIsSidebar = computed(() => ['create', 'size', 'scheme', 'palette'].includes(drawerKey.value))
function openDrawer(key) {
  drawerKey.value = drawerKey.value === key ? '' : key
  boardOpen.value = false
  brandOpen.value = false
  aiOpen.value = false
}
function closeDrawer() { drawerKey.value = '' }

/* 命令栏的两个小浮层：钉板下拉、AI 未接入说明 */
const boardOpen = ref(false)
const aiOpen = ref(false)
const boardSpec = computed(() => boardSpecFor(options.canvasW, options.canvasH))
const boardOptions = computed(() => BOARD_SPECS.map(s => ({
  spec: s,
  w: s,
  h: s,
  locked: s > maxCells.value,
  current: s === boardSpec.value
})))

function pickBoard(o) {
  boardOpen.value = false
  if (o.locked) {
    needPro(`这块底板（${o.w} × ${o.h} 格）是 Pro 功能：免费版单边上限 ${maxCells.value} 格。`)
    return
  }
  if (o.current) return
  setCanvasCapacity(o.w, o.h)
}

/* 智能抠图三档 + 关闭：与左栏「图片处理 → 智能抠图」同一套状态 */
function matteOn(key) {
  if (!options.removeBg) { setRemoveBg(true); setMatteLevel(key); return }
  if (options.matteLevel === key) return
  setMatteLevel(key)
}
function matteOff() { setRemoveBg(false) }

/* 视图页签与画布组件里的那一组完全一致（chrome='console' 时组件自己那条被隐藏） */
const views = [
  { key: 'pattern', icon: 'grid-3x3', label: '拼豆图纸' },
  { key: 'original', icon: 'image', label: '原图' },
  { key: 'compare', icon: 'columns-2', label: '对照' },
  { key: 'split', icon: 'layout-grid', label: '分板' },
  { key: 'materials', icon: 'list', label: '材料' }
]

/* 自由画布是从零手绘的空白网格，没有原图可看 —— 这两个视图页签收起来，
   只留图纸 / 分板 / 材料。图纸转换照旧五个。 */
const modeViews = computed(() => (
  createMode.value === 'free'
    ? views.filter(v => v.key !== 'original' && v.key !== 'compare')
    : views
))

const canvasRef = ref(null)
const zoomPct = computed(() => Math.round(zoom.value * 100))

/* 左侧浮动工具栏：工具本身来自 icons.js（画布组件与这里共用同一份定义），
   换色 / 去杂色也在这条栏上 —— 它们是编辑动作，不是面板设置。 */
/* 参考版的工具轨比旧工具行多一颗「换色」；旧版面（手机 / 平板）保持 8 颗不动 */
const SWAP_TOOL = {
  key: 'swap', icon: 'arrow-left-right', label: '换色',
  title: '换色：点一格，整张图里同色的豆全部换成当前颜色',
  desc: '点一格，整张图里同色的豆全部换成当前颜色',
  shortcut: 'C'
}
const railTools = computed(() => [...EDIT_TOOLS, SWAP_TOOL])

/* 左侧绘图工具栏默认展开（用户 2026-11-03 定）；
   收起后画布左上角只剩一颗绿色按钮，点它再展开。 */
const railOpen = ref(true)

/* 悬停浮动标签：鼠标停在工具上时浮出「工具名 + 说明 + 快捷键」（仅电脑端） */
const { onTipOver, hideTip } = useShortcutTip()

/* 画笔 / 橡皮的尺寸卡（设计稿 124:84 / 124:2）：
   工具轨上画笔、橡皮两颗按钮右侧各带一个箭头，点箭头展开自己那张 1–5 颗的滑杆卡，
   同一时刻只开一张。值 'paint' | 'erase' | null。 */
const sizePop = ref(null)
/* 尺寸卡留在工具轨里（--cs-* 变量定义在 .studio--console 上，搬到 body 会丢变量、底色变透明），
   但用 position:fixed 躲开轨道的 overflow 裁剪 —— 工具轨是 overflow:auto 的滚动容器，
   绝对定位的子元素跑到轨道右外侧会被裁掉（实测只剩 2% 露在轨道里，点开像没反应）。
   fixed 的包含块是视口（中间没有 transform/filter 的祖先），不会被轨道裁。 */
const sizePopPos = ref({ left: 0, top: 0 })
const SIZE_CARD_W = 156
const SIZE_CARD_H = 81
const sizePopStyle = computed(() => ({ left: `${sizePopPos.value.left}px`, top: `${sizePopPos.value.top}px` }))

/** 卡片里读写的尺寸 = 卡片所属工具自己的那一档 */
const sizePopValue = computed(() => (sizePop.value === 'erase' ? eraserSize.value : brushSize.value))
/** 轨道填充：1 颗 = 0%（设计稿最小值那一档滑块点压在轨道左端） */
const sizePopFill = computed(() => `${((sizePopValue.value - 1) / (BRUSH_MAX - 1)) * 100}%`)
const sizePopLabel = computed(() => (sizePop.value === 'erase' ? '橡皮大小' : '画笔大小'))

function sizeBtnOf(key) {
  return document.querySelector(`[data-tool-size="${key}"]`)
}
function placeSizePop() {
  const chev = sizePop.value ? sizeBtnOf(sizePop.value) : null
  if (!chev) return
  const toolBtn = chev.closest('.csToolWrap')?.querySelector('.csTool') || chev
  const rail = chev.closest('.csRail')
  const br = toolBtn.getBoundingClientRect()
  const rr = (rail || toolBtn).getBoundingClientRect()
  /* 卡片贴在工具轨右缘外侧 8px，竖直中线对齐当前这颗工具按钮（设计稿 124:84） */
  let left = Math.round(rr.right + 8)
  if (left + SIZE_CARD_W > window.innerWidth - 12) left = Math.round(rr.left - 8 - SIZE_CARD_W)
  const top = Math.round(Math.min(Math.max(12, br.top + br.height / 2 - SIZE_CARD_H / 2), window.innerHeight - SIZE_CARD_H - 12))
  sizePopPos.value = { left, top }
}
function bindSizePop() {
  window.addEventListener('resize', placeSizePop)
  document.querySelector('.csRail')?.addEventListener('scroll', placeSizePop, { passive: true })
}
function unbindSizePop() {
  window.removeEventListener('resize', placeSizePop)
  document.querySelector('.csRail')?.removeEventListener('scroll', placeSizePop)
}
/** 点画笔 / 橡皮右侧的箭头：选中这个工具，并切换它自己的尺寸卡 */
function toggleToolSize(key) {
  const next = sizePop.value === key ? null : key
  tool.value = key
  sizePop.value = next
  unbindSizePop()
  if (next) { placeSizePop(); bindSizePop() }
}
function closeSizePop() {
  sizePop.value = null
  unbindSizePop()
}
function setSizePopValue(value) {
  setToolSize(value, sizePop.value === 'erase' ? 'erase' : 'paint')
}
/** 点工具本体：只切换工具，尺寸卡留给箭头按钮控制 */
function onRailTool(key) {
  tool.value = key
}
function setBrushSize(value) {
  setToolSize(value, tool.value)
}
function stepBrush(delta) { setBrushSize(toolSizeOf() + delta) }
/** 平板 / 手机上那条滑杆跟着当前工具走：画笔改画笔、橡皮改橡皮 */
const activeToolSize = computed(() => toolSizeOf())
const brush = computed(() => {
  /* 画笔当前色：先按 id 从全局色板找（自由画布里挑的颜色还没进这张图纸的色板），
     找不到再退回图纸色板的最后一个色。 */
  const id = brushColorId.value
  if (id) {
    const c = getColorById(id)
    if (c) return c
  }
  const p = pattern.value
  return p ? (p.palette[p.palette.length - 1] || null) : null
})

/* 底部色板条：只列这张图实际用到的色号，点一下就是当前画笔色 */
const usedColors = computed(() => (pattern.value ? pattern.value.palette : []))

/* 选色面板（主选色入口）：从右栏搬到了左侧工具轨 ——
   点工具轨底部那颗「当前颜色」色块，从轨的右边滑出一块选色面板
   （系列 → 色系 → 搜索 → 多行网格），内容与样式跟原来右栏那张「色板」卡一模一样。
   面板用 fixed 定位：工具轨是 overflow:auto 的滚动容器，绝对定位会被它裁掉。 */
const paletteOpen = ref(false)
const paletteFlyEl = ref(null)
const swatchEl = ref(null)
const paletteFlyPos = ref({ left: 0, top: 0 })
const paletteFlyStyle = computed(() => ({
  left: `${paletteFlyPos.value.left}px`,
  top: `${paletteFlyPos.value.top}px`
}))
const PALETTE_FLY_W = 212

function placePaletteFly() {
  const el = swatchEl.value
  if (!el) return
  /* 贴着工具轨的右缘（不是色块的右缘）：色块在轨道里居中，贴色块会压住轨道本身 */
  const rail = el.closest('.csRail')
  const rr = (rail || el).getBoundingClientRect()
  const sr = el.getBoundingClientRect()
  const gap = 10
  let left = rr.right + gap
  /* 右边放不下就翻到工具轨左侧 */
  if (left + PALETTE_FLY_W > window.innerWidth - 12) left = rr.left - gap - PALETTE_FLY_W
  paletteFlyPos.value = { left: Math.round(left), top: Math.round(sr.top - 8) }
  /* 面板比色块高得多：量出真实高度后让底边贴着色块底边，再整体夹进视口 */
  nextTick(() => {
    const p = paletteFlyEl.value
    if (!p) return
    const h = p.getBoundingClientRect().height
    const top = Math.max(12, Math.min(sr.bottom + 6 - h, window.innerHeight - h - 12))
    paletteFlyPos.value = { ...paletteFlyPos.value, top: Math.round(top) }
  })
}

function openPaletteCard() {
  const next = !paletteOpen.value
  paletteOpen.value = next
  if (next) {
    closeDrawer()
    placePaletteFly()
    window.addEventListener('resize', placePaletteFly)
  } else {
    window.removeEventListener('resize', placePaletteFly)
  }
}
function closePaletteFly() {
  paletteOpen.value = false
  window.removeEventListener('resize', placePaletteFly)
}

/* 点面板外面就收起来（面板本身没有遮罩，键盘 Esc 也是出口） */
function onDocPointerDown(e) {
  if (sizePop.value) {
    const t = e.target
    if (!(t && t.closest && (t.closest('[data-brush-size]') || t.closest('[data-tool-size]')))) closeSizePop()
  }
  if (!paletteOpen.value) return
  const t = e.target
  if (t && t.closest && (t.closest('[data-palette-flyout]') || t.closest('.csRail__swatch'))) return
  closePaletteFly()
}

/* 手机端色板抽屉：品牌色板 + 当前色 + 搜索 + 色块网格（设计稿 124:654）。
   「全部」是这套品牌色板里的所有色号，「本图」只列这张图纸实际用到的颜色。 */
const colorQuery = ref('')
const colorTab = ref('all')
const msColorList = computed(() => {
  const base = colorTab.value === 'used' ? usedColors.value : availableColors.value
  const q = colorQuery.value.trim().toLowerCase()
  if (!q) return base
  return base.filter(c => `${c.code} ${c.name || ''} ${c.hex}`.toLowerCase().includes(q))
})
function pickMsColor(id) {
  brushColorId.value = id
}

/* 手机端裁切：四边各收多少（%），预览框上直接画出来。
   应用时把原图裁成这块再重新生成图纸，作品关联不变。 */
const cropInset = ref({ l: 0, r: 0, t: 0, b: 0 })
function openCrop() {
  if (!sourceUrl.value) return
  cropInset.value = { l: 0, r: 0, t: 0, b: 0 }
  openMsSheet('crop')
}
const cropBox = computed(() => ({
  left: cropInset.value.l,
  top: cropInset.value.t,
  width: Math.max(2, 100 - cropInset.value.l - cropInset.value.r),
  height: Math.max(2, 100 - cropInset.value.t - cropInset.value.b)
}))
const cropActive = computed(() => cropInset.value.l + cropInset.value.r + cropInset.value.t + cropInset.value.b > 0)
async function applyCrop() {
  if (!cropActive.value) { closeMsSheet(); return }
  const b = cropBox.value
  const ok = await cropSource({ x: b.left / 100, y: b.top / 100, w: b.width / 100, h: b.height / 100 })
  if (!ok) { toastWarn('裁切失败，请换一张图再试'); return }
  closeMsSheet()
  toastOk('已按裁切范围重新生成图纸')
}

/* 作品改名：设计稿里作品名旁边就是一支笔，就地改，不再跳到作品页 */
const renaming = ref(false)
const nameDraft = ref('')
const nameInput = ref(null)
function startRename() {
  if (!hasPattern.value) return
  nameDraft.value = projectName.value || ''
  renaming.value = true
  nextTick(() => { nameInput.value?.focus(); nameInput.value?.select() })
}
function commitRename() {
  const n = nameDraft.value.trim()
  if (n) projectName.value = n
  renaming.value = false
}

/* 去杂色：整图一次的动作，走撤销栈 */
function onRemoveSpecks() {
  if (!hasPattern.value) return
  const n = removeSpecks()
  if (n) toastOk(`已把 ${n} 颗孤立豆并进周围主色`)
  else toastOk('没有找到杂色，图纸保持原样')
}

/* 左右镜像：工具轨那颗按钮与快捷键 M 走同一条路 */
function doMirror() {
  if (!hasPattern.value) return
  mirrorPattern('h')
}

/* 命令弹窗（Figma 124:2316 / 2139 / 1545 / 1628 / 1365 / 1169） */
const materialsOpen = ref(false)
const uploadOpen = ref(false)
const exportOpen = ref(false)
const analysisOpen = ref(false)
const stockOpen = ref(false)

/* ---------------------------------------------------------------- 手机端命令栏
   手机上不再把 ①~⑤ 和右栏卡片一路堆在画布下面，而是把命令收成底部两排按钮；
   点一个按钮，从底部升起只包含那张卡的弹层。所有命令都在一屏内，
   画布始终占住中间那块空间。 */
const MOBILE_PANEL_TITLES = {
  create: '图片',
  size: '画布与成品尺寸',
  scheme: '生成方案',
  palette: '色板与参数',
  analysis: '作品分析',
  colors: '颜色用量',
  stock: '我的库存'
}
const mobilePanel = ref('')
const mobilePanelOpen = ref(false)
const mobilePanelTitle = computed(() => MOBILE_PANEL_TITLES[mobilePanel.value] || '')
const mobileSidebarPanel = computed(() => ['create', 'size', 'scheme', 'palette'].includes(mobilePanel.value))
const mobileInsightsPanel = computed(() => ['analysis', 'colors', 'stock'].includes(mobilePanel.value))

function openMobilePanel(key) {
  mobileMore.value = 'none'
  mobilePanel.value = key
  mobilePanelOpen.value = true
}
watch(mobilePanelOpen, v => {
  if (!v) mobilePanel.value = ''
})

/* ---------------------------------------------------------------- 手机端功能布局 4.0
   顶栏只留「图纸 / 原图 / 对照 + 缩放 + 适应」；下面一行是
   画布 / 色板 / 换图 / 导出 / 更多，画布下方常驻
   镜像 / 画笔 / 橡皮 / 填充 / 取色 / 更多（撤销 / 重做在画布右侧浮控）。
   两个「更多」共用一个状态，天然互斥，不会同时开着。 */
const mobileMore = ref('none') // 'none' | 'functions' | 'tools'

const quickEntries = [
  { key: 'size', label: '画布', icon: 'layout-grid' },
  { key: 'palette', label: '色板', icon: 'palette' },
  { key: 'create', label: '换图', icon: 'image-up' },
  { key: 'delivery', label: '导出', icon: 'download' }
]
/* 直接入口之外的业务功能：一个都没删，只是收进「更多」 */
const moreFunctions = [
  { key: 'colors', label: '用量', icon: 'list' },
  { key: 'scheme', label: '方案', icon: 'sparkles' },
  { key: 'analysis', label: '分析', icon: 'chart-no-axes-combined' },
  { key: 'stock', label: '库存', icon: 'package' },
  { key: 'save', label: '保存作品', icon: 'save' }
]
const mobileTools = [
  { key: 'paint', label: '画笔', icon: 'pencil' },
  { key: 'erase', label: '橡皮', icon: 'eraser' },
  { key: 'fill', label: '填充', icon: 'paint-bucket' },
  { key: 'pick', label: '取色', icon: 'pipette' }
]

function openQuick(key) {
  mobileMore.value = 'none'
  if (key === 'delivery') openDelivery('export')
  else openMobilePanel(key)
}
function toggleMore(which) {
  mobileMore.value = mobileMore.value === which ? 'none' : which
}
/* 参数条默认收起（设计稿的默认态）；点画笔 / 橡皮才展开，再点一下收起 */
const brushParams = ref(false)
function pickMobileTool(key) {
  if (!hasPattern.value) return
  const same = tool.value === key
  tool.value = key
  mobileMore.value = 'none'
  if (key === 'paint' || key === 'erase') brushParams.value = same ? !brushParams.value : true
  else brushParams.value = false
}
function pickMoreFunction(f) {
  mobileMore.value = 'none'
  if (f.key === 'save') openSave()
  else openMobilePanel(f.key)
}

const showBrushParams = computed(() => hasPattern.value && brushParams.value &&
  (tool.value === 'paint' || tool.value === 'erase'))

/* 手机工具行第一格：左右镜像是一次性动作，不切换画笔工具 */
function mobileMirror() {
  if (!hasPattern.value) return
  mirrorPattern('h')
}
function moreView(view) { currentView.value = view; mobileMore.value = 'none' }
function toggleGrid() { options.showGrid = !options.showGrid }

/* 抽屉打开时压一条历史记录：手机返回键先关抽屉，不会直接退出工作台。
   所有抽屉共用一条记录，避免一个刚关、另一个立刻开时被对方的 back 误关。 */
useBackClose(
  computed(() => mobileMore.value !== 'none' || mobilePanelOpen.value),
  () => {
    if (mobileMore.value !== 'none') mobileMore.value = 'none'
    else mobilePanelOpen.value = false
  }
)

/* ---------------------------------------------------------------- 上传 / 拖图 */
const fileInput = ref(null)
const mobileBusy = ref(false)
function pickImage() { fileInput.value?.click() }
/** 首页 / 素材库顶栏拖进来的图：控制台与手机工作台没有左栏，由这里接住 */
async function consumePendingUpload() {
  const f = takePendingUpload()
  if (!f) return
  mobileBusy.value = true
  try {
    await useImageFile(f)
  } catch (err) {
    toastWarn(err.message || '图片读取失败')
  } finally {
    mobileBusy.value = false
  }
}
async function onPickFile(e) {
  const f = e.target.files?.[0]
  if (!f) return
  mobileBusy.value = true
  try {
    /* 成功结果由画布上方的「已生成图纸」卡承担；这里再弹一条会盖住画布。 */
    await useImageFile(f)
  } catch (err) {
    toastWarn(err.message || '图片载入失败')
  } finally {
    mobileBusy.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}
/* 手机上上传入口直接放在画布空状态里（EditorCanvas 的 emptyActions 触发） */
const pickMobileImage = pickImage
const onMobileFile = onPickFile

const dropActive = ref(false)
let dropDepth = 0
function dragHasFiles(e) {
  const types = e.dataTransfer && e.dataTransfer.types
  return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0
}
function onDragEnter(e) {
  if (!dragHasFiles(e)) return
  e.preventDefault()
  dropDepth += 1
  dropActive.value = true
}
function onDragOver(e) {
  if (!dragHasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dropActive.value = true
}
/* dragenter / dragleave 会在每个子元素上成对触发，用计数判断是不是真的离开了画布栏 */
function onDragLeave() {
  if (!dropActive.value) return
  dropDepth = Math.max(0, dropDepth - 1)
  if (!dropDepth) dropActive.value = false
}
function resetDrop() {
  dropDepth = 0
  dropActive.value = false
}
/* 拖到画布栏以外（顶栏 / 页脚）松手时，浏览器默认会直接打开那张图，
   把正在编辑的工作台顶掉。编辑器里一律吃掉文件拖放的默认行为，
   真正接管上传的只有画布栏的 drop。 */
function onWindowDragOver(e) {
  if (dragHasFiles(e)) e.preventDefault()
}
function onWindowDrop(e) {
  if (dragHasFiles(e)) e.preventDefault()
  resetDrop()
}
async function onDropImage(e) {
  if (!dragHasFiles(e)) return
  e.preventDefault()
  resetDrop()
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  try {
    const ok = await useImageFile(f)
    if (ok) toastOk('已载入图片并生成方案')
  } catch (err) {
    toastWarn(err.message || '图片载入失败')
  }
}

/* 反馈：顶栏那颗按钮打开全站的反馈弹窗（FeedbackWidget 监听这个事件） */
function openFeedback() {
  window.dispatchEvent(new CustomEvent('douwan:open-feedback'))
}

/* Esc 关掉右侧面板 / 浮层（全屏工作台没有遮罩，键盘是主要出口）。
   按层级从高到低收：选色面板盖在画布上、层级最高，先收它。 */
function onKeydown(e) {
  if (e.key === 'Escape') {
    if (sizePop.value) { closeSizePop(); return }
    if (paletteOpen.value) { closePaletteFly(); return }
    if (boardOpen.value) { boardOpen.value = false; return }
    if (aiOpen.value) { aiOpen.value = false; return }
    if (drawerKey.value) { closeDrawer(); return }
    return
  }
  onShortcutKey(e)
}

/* ---------------------------------------------------------------- 键盘快捷键
   电脑端：画笔 P / 橡皮 E / 填充 G / 吸色 I / 换色 C / 去杂色 R / 镜像 M。
   与工具轨上的浮动标签一一对应（标签里标的就是这些键）。

   三种情况不抢按键：
     · 正在输入（改名输入框、尺寸滑杆等）—— 打字不能被工具切走；
     · 按着 Ctrl / Cmd / Alt —— 那些是浏览器与撤销重做的键；
     · 弹层开着 —— 按键归弹层（换色弹窗里按 C 不该切工具）。 */
const SHORTCUT_TOOLS = { p: 'paint', e: 'erase', g: 'fill', i: 'pick', c: 'swap' }

function onShortcutKey(e) {
  if (e.defaultPrevented) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  const tag = (t && t.tagName) || ''
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return
  if (document.querySelector('.modal.show')) return
  const k = (e.key || '').toLowerCase()
  const next = SHORTCUT_TOOLS[k]
  if (next) {
    e.preventDefault()
    tool.value = next
    return
  }
  if (k === 'r') { e.preventDefault(); onRemoveSpecks(); return }
  if (k === 'm') { e.preventDefault(); doMirror(); return }
}

onMounted(() => {
  /* 手机端命令栏占住底部两排：提示条要抬到它上面，别压住按钮。
     只在工作台挂这个类，其它页面的提示位置不变。 */
  document.body.classList.add('is-editor')
  /* 拖到窗口外松手时 dragleave 不一定来，兜底把提示层收掉 */
  window.addEventListener('dragend', resetDrop)
  window.addEventListener('dragover', onWindowDragOver)
  window.addEventListener('drop', onWindowDrop)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onDocPointerDown)
  wideQuery.addEventListener('change', onWideChange)
  narrowQuery.addEventListener('change', onNarrowChange)
  trackEvent('editor.open')
  /* 左栏「素材库」和空画布引导的配图都取素材库（后台已发布素材），
     进工作台就拉一次；失败时两处都会退回内置素材 */
  loadRemoteAssets()
  // 带 projectId 进来时先打开存档（/editor/:projectId），并切到它所属的创作模式
  const id = route.params.projectId
  if (id) {
    if (!openWorkspaceProject(id)) toastErr('该作品打不开，可能已被删除')
  } else if (hasPattern.value) {
    /* 已经有文档：素材页 / 工具页点「用这个素材生成图纸」会先把图导进来再跳过来，
       这份文档属于哪个模式就停在哪个模式，别用默认的自由画布把它顶掉。 */
    createMode.value = workspaceMode.value
  } else {
    /* 用户 2026-11-03：打开工作台默认进「图纸转换」（上传图片出图纸），
       自由画布改成手动切换；两种模式各留一份文档，切过去不会互相覆盖。
       进页面时顺手清掉上次的作品关联 —— 否则接着点「保存」会把那件没装载的作品覆盖掉。 */
    activateCreateMode('edit', { blankFree: blankableFree() })
  }
  normalizeFreeView()
  /* 首页 / 素材库顶栏拖图进来：控制台与手机工作台没有左栏，待处理的图要在这里接住
     （useImageFile 会把它写进图纸转换那份文档）。平板三栏由左栏自己取，别重复消费。 */
  if (consoleMode.value || mobileConsole.value) consumePendingUpload()
})

onBeforeUnmount(() => {
  document.body.classList.remove('is-editor')
  window.removeEventListener('dragend', resetDrop)
  window.removeEventListener('dragover', onWindowDragOver)
  window.removeEventListener('drop', onWindowDrop)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onDocPointerDown)
  unbindSizePop()
  window.removeEventListener('resize', placePaletteFly)
  wideQuery.removeEventListener('change', onWideChange)
  narrowQuery.removeEventListener('change', onNarrowChange)
})

// 切到别的存档（切作品、从作品页打开）时地址变了但组件不会重建，得自己盯住参数
watch(() => route.params.projectId, id => {
  if (!id) return
  openWorkspaceProject(id)
})

/* ---------------------------------------------------------------- 登录
   顶栏账户入口：未登录显示「登录」，已登录显示「个人中心」。
   保存要绑定账号 —— 只有本机匿名身份时也按未登录处理，先弹登录框，
   登录成功后把这次保存补上。 */
const loginOpen = ref(false)
/** 打开登录框的原因：'save' = 保存被拦下来了，登录后继续保存 */
const loginReason = ref('')
const needAccount = computed(() => !isLoggedIn.value || isAnonymousDevice.value)

function onSave() {
  /* 保存要绑定账号：未登录（只有本机匿名身份也算未登录）先弹登录框，
     登录成功后把这次保存补上 —— 用户不用再点一次。 */
  if (needAccount.value) {
    loginReason.value = 'save'
    loginOpen.value = true
    return
  }
  doSave()
}

function doSave() {
  const id = saveProject(undefined, { createMode: createMode.value })
  if (id && route.params.projectId !== id) {
    router.replace(`/editor/${id}`)
  }
}

/** 登录成功：把登录前挂起的那次保存补上 */
function onLoginSuccess() {
  if (loginReason.value === 'save') {
    if (mobileConsole.value) {
      /* 手机端的保存还要问作品名，登录完继续走那个弹窗 */
      mobileMore.value = 'none'
      saveName.value = projectName.value || ''
      saveOpen.value = true
    } else {
      doSave()
    }
  }
  loginReason.value = ''
}

/* ---------------------------------------------------------------- 手机端保存
   手机顶栏不放作品名，保存时再问名字：预填当前名字，确认后落盘并更新地址。
   桌面仍是一键保存（顶栏一直显示作品名，改名在作品页做）。 */
const saveOpen = ref(false)
const saveName = ref('')
const saveInput = ref(null)

function openSave() {
  if (!hasPattern.value) return
  mobileMore.value = 'none'
  /* 保存要绑定账号：未登录先弹登录框，登录成功后继续这次保存 */
  if (needAccount.value) {
    loginReason.value = 'save'
    loginOpen.value = true
    return
  }
  saveName.value = projectName.value || ''
  saveOpen.value = true
  nextTick(() => {
    saveInput.value?.focus()
    saveInput.value?.select()
  })
}

function confirmSave() {
  const name = saveName.value.trim()
  if (!name) {
    toastWarn('给作品起个名字再保存')
    return
  }
  const id = saveProject(name, { createMode: createMode.value })
  if (!id) return
  saveOpen.value = false
  if (route.params.projectId !== id) router.replace(`/editor/${id}`)
}

/* ---------------------------------------------------------------- 项目列表（切换存档） */

const switchOpen = ref(false)
const switchList = computed(() => projects.value)

/* 作品属于哪种模式：老存档没有 createMode（自由画布是后加的功能），按图纸转换算 */
function projectModeOf(proj) {
  return proj && proj.createMode === 'free' ? 'free' : 'edit'
}

/**
 * 打开一件存档，并把工作台切到它所属的模式。
 * 切换前先把当前模式那份文档收好 —— 打开图纸转换的作品不能把自由画布的画覆盖掉。
 */
function openWorkspaceProject(id) {
  const proj = projects.value.find(p => p.id === id)
  const target = projectModeOf(proj)
  if (target !== workspaceMode.value) stashCurrentWorkspace()
  const ok = ensureProjectLoaded(id)
  activateCreateMode(target, { blankFree: blankableFree(), loaded: ok })
  return ok
}

function doSwitch(id) {
  if (openWorkspaceProject(id)) {
    switchOpen.value = false
    router.replace(`/editor/${id}`)
    toastOk('已切换作品')
  }
}

const toolLabel = computed(() => {
  const t = EDIT_TOOLS.find(x => x.key === tool.value)
  return t ? t.label : ''
})

/* 顶栏状态：设计稿写的是「已保存」。存档打开后的「已打开存档」在卡片版面里
   用来区分「刚打开」和「刚保存」，全屏工作台这一行只留一个状态词，按设计稿显示。 */
const statusText = computed(() => (saveStatus.value === '已打开存档' ? '已保存' : saveStatus.value))
</script>

<template>
  <div class="studio studio--console" :class="{ 'studio--mobile': mobileConsole }">
    <!-- ============================ 全局命令栏（全屏工作台） ============================
         第一行：品牌 · 作品名（可改名）· 保存状态 ‖ 居中：模式切换 ‖ 保存 / 导出 / 反馈 / 个人中心
         第二行：上传图片 / AI 生成 / 素材库 | 智能抠图力度 · 卡通风格（对接中）| 钉板
         版面与文字层级按 Figma「豆玩操作台优化」1:593；字号字重按 1:2「豆玩 · 文字与字体规范」。
         手机 / 平板没有对应设计，这两行不渲染（见 consoleMode）。 -->
    <header v-if="consoleMode" class="csTop">
      <div class="csTop__side">
        <RouterLink to="/" class="csLogo" aria-label="豆玩首页">
          <img :src="logoUrl" alt="豆玩 DOUWAN">
        </RouterLink>
        <span class="csDiv"></span>

        <div class="csProject">
          <span class="csProject__ico"><Icon name="file-image" :size="16" /></span>
          <template v-if="!renaming">
            <button class="csProject__name" :disabled="!hasPattern" :title="hasPattern ? '点击改名' : projectName" @click="startRename">{{ projectName }}</button>
          </template>
          <input
            v-else ref="nameInput" v-model="nameDraft" class="csProject__input"
            maxlength="24" aria-label="作品名称"
            @keyup.enter="commitRename" @blur="commitRename" @keyup.esc="renaming = false"
          >
          <button class="csProject__pen hit32" type="button" :disabled="!hasPattern" title="重命名作品" aria-label="重命名作品" @click="startRename">
            <Icon name="pencil" :size="16" />
          </button>
          <span class="csSaved" :class="{ on: saveStatus !== '未保存' }"><i></i>{{ statusText }}</span>
        </div>
      </div>

      <div class="csModeSeg" role="group" aria-label="创作模式">
        <button type="button" :class="{ on: createMode === 'free' }" @click="setCreateMode('free')">
          <Icon name="pencil" :size="16" />自由画布
        </button>
        <button type="button" :class="{ on: createMode === 'edit' }" @click="setCreateMode('edit')">
          <Icon name="image" :size="16" />图纸转换
        </button>
      </div>

      <div class="topbar__actions csActions">
        <button class="csAction csAction--plain" :disabled="!hasPattern" @click="onSave">
          <Icon name="save" :size="16" />保存
        </button>
        <button class="csAction csAction--dark" :disabled="!hasPattern" @click="exportOpen = true">
          <Icon name="download" :size="16" />导出
        </button>
        <span class="csDiv"></span>
        <button class="csAction csAction--plain" @click="openFeedback">
          <Icon name="message-square" :size="16" />反馈
        </button>
        <!-- 账户入口：未登录是「登录」，已登录是「个人中心」（设计稿 1:1193） -->
        <RouterLink v-if="!needAccount" to="/account" class="csAction csAction--plain" data-console="account">
          <Icon name="user-round" :size="16" />个人中心
        </RouterLink>
        <button
          v-else type="button" class="csAction csAction--plain" data-console="account"
          @click="loginReason = ''; loginOpen = true"
        >
          <Icon name="user-round" :size="16" />登录
        </button>
      </div>
    </header>

    <div v-if="consoleMode" class="csCmd">
      <template v-if="createMode === 'free'">
        <!-- 自由画布：从零开始手绘，不提供上传入口（设计稿 1:2445 第二行只有这两颗）。
             AI 生图还没接（lib/aiPending.js 的 AI_GENERATION_READY），入口先保留位置、禁用。 -->
        <button
          class="csCmd__btn hit36h" :class="{ 'is-soon': !AI_GENERATION_READY }"
          type="button" :disabled="!AI_GENERATION_READY"
          :title="AI_GENERATION_READY ? 'AI 生成素材' : `AI 生成：${AI_PENDING_TEXT}`"
          @click="aiOpen = true"
        >
          <Icon name="sparkles" :size="20" /><span>AI 生成</span>
          <em v-if="!AI_GENERATION_READY">对接中</em>
        </button>
        <button class="csCmd__btn hit36h" data-console="materials" @click="materialsOpen = true">
          <Icon name="images" :size="20" /><span>素材库</span>
        </button>
      </template>
      <template v-else>
        <button class="csCmd__btn hit36h" data-console="upload" :disabled="mobileBusy" @click="uploadOpen = true">
          <Icon name="image-up" :size="20" /><span>更换图片</span>
        </button>
        <button class="csCmd__btn hit36h" :disabled="!sourceUrl" @click="openDrawer('adjust')">
          <Icon name="sliders-horizontal" :size="20" /><span>图片调整</span>
        </button>
        <button class="csCmd__btn hit36h" data-console="materials" @click="materialsOpen = true">
          <Icon name="images" :size="20" /><span>素材库</span>
        </button>
        <span class="csDiv csDiv--v"></span>
        <button class="csCmd__btn hit36h" :class="{ on: options.removeBg }" :disabled="!sourceUrl" @click="toggleMatte">
          <Icon name="wand-sparkles" :size="24" /><span>智能抠图</span>
        </button>
        <button class="csCmd__btn is-soon hit36h" type="button" disabled title="卡通风格：对接中，敬请期待">
          <Icon name="wand-sparkles" :size="24" /><span>卡通</span><em>对接中</em>
        </button>
      </template>

      <span class="csSpacer"></span>

      <div class="csBoard">
        <button class="csBoard__btn" type="button" :aria-expanded="boardOpen" @click="boardOpen = !boardOpen">
          <Icon name="grid-3x3" :size="16" />
          <span>钉板 {{ boardSpec }} × {{ boardSpec }}</span>
          <Icon name="chevron-down" :size="16" />
        </button>
        <div v-if="boardOpen" class="csPop csBoard__pop">
          <p class="csPop__title">底板尺寸</p>
          <button
            v-for="o in boardOptions" :key="o.spec" type="button"
            class="csBoard__item" :class="{ on: o.current, locked: o.locked }"
            @click="pickBoard(o)"
          >
            <b>{{ o.w }} × {{ o.h }}</b>
            <span>{{ o.w }} 钉画线板</span>
            <em v-if="o.locked">PRO</em>
            <Icon v-else-if="o.current" name="check" :size="16" />
          </button>
        </div>
      </div>

      <div class="csBoard">
        <button class="csBoard__btn" type="button" :aria-expanded="brandOpen" @click="brandOpen = !brandOpen">
          <Icon name="palette" :size="16" />
          <span>{{ brandLabel }}</span>
          <Icon name="chevron-down" :size="16" />
        </button>
        <div v-if="brandOpen" class="csPop csBoard__pop csBrand__pop">
          <p class="csPop__title">品牌色板</p>
          <button
            v-for="b in paletteBrands" :key="b.id" type="button"
            class="csBoard__item" :class="{ on: b.id === options.brandId }"
            @click="pickBrand(b)"
          >
            <b>{{ b.name }}</b>
            <span>{{ b.colorCount }} 色</span>
            <Icon v-if="b.id === options.brandId" name="check" :size="16" />
          </button>
        </div>
      </div>
    </div>

    <!-- 文档与视图：五个视图 + 网格开关 -->
    <div v-if="consoleMode" class="csDoc">
      <div class="viewtabs csViews" role="tablist" aria-label="视图">
        <button
          v-for="v in modeViews" :key="v.key" type="button"
          :class="{ on: currentView === v.key }"
          role="tab" :aria-selected="currentView === v.key"
          :disabled="v.key !== 'original' && createMode === 'edit' && !hasPattern"
          @click="currentView = v.key"
        ><Icon :name="v.icon" :size="16" /><span>{{ v.label }}</span></button>
      </div>
      <button class="csToggle" type="button" :class="{ on: options.showGrid }" :aria-pressed="options.showGrid" @click="toggleGrid">
        <span>网格</span><i aria-hidden="true"></i>
      </button>
    </div>

    <!-- ============================ 手机工作台（设计稿 124:887） ============================
         作品栏 → 模式栏 → 画布 → 缩放栏 → 工具轨。成品尺寸 / 色板 / 更多工具是底部抽屉。 -->
    <header v-if="mobileConsole" class="msTop no-print">
      <RouterLink to="/" class="msTop__logo" aria-label="豆玩首页">
        <img :src="logoUrl" alt="豆玩 DOUWAN">
      </RouterLink>
      <span class="msSpacer"></span>
      <button type="button" class="msPill" :disabled="!hasPattern" @click="onSave">
        <Icon name="save" :size="16" />保存
      </button>
      <button type="button" class="msPill msPill--dark" :disabled="!hasPattern" @click="exportOpen = true">
        <Icon name="download" :size="16" />导出
      </button>
      <button type="button" class="msIcon hit36" aria-label="更多" @click="openMsSheet('menu')">
        <Icon name="ellipsis" :size="20" />
      </button>
    </header>

    <div v-if="mobileConsole" class="msCmd no-print">
      <button type="button" :class="{ on: createMode === 'free' }" @click="setCreateMode('free')">
        <Icon name="pencil" :size="16" />自由画布
      </button>
      <button type="button" :class="{ on: createMode === 'edit' }" @click="setCreateMode('edit')">
        <Icon name="image" :size="16" />图纸转换
      </button>
      <span class="msSpacer"></span>
      <!-- 自由画布从零开始手绘，不给上传入口（设计稿 1:2445）；
           图纸转换可以换图，两种模式都有「素材库」。 -->
      <button
        v-if="createMode === 'edit'" type="button" class="msCmd__upload"
        :disabled="mobileBusy" @click="pickImage"
      >
        <Icon name="image-up" :size="16" />换图
      </button>
      <button type="button" class="msCmd__materials" @click="materialsOpen = true">
        <Icon name="images" :size="16" />素材库
      </button>
    </div>

    <div v-if="mobileConsole && createMode === 'edit'" class="msViews no-print" role="tablist" aria-label="视图">
      <button
        v-for="v in views.filter(x => ['original', 'pattern', 'compare'].includes(x.key))" :key="v.key" type="button"
        :class="{ on: currentView === v.key }"
        role="tab" :aria-selected="currentView === v.key"
        :disabled="v.key !== 'original' && !hasPattern"
        @click="currentView = v.key"
      ><Icon :name="v.icon" :size="16" /><span>{{ v.label }}</span>
        <em v-if="v.key === 'pattern' && !hasPattern">待生成</em>
      </button>
    </div>

    <!-- 手机 / 平板仍然是左栏 + 画布 + 右栏；全屏工作台把这两栏收进右侧滑出面板 -->
    <EditorSidebar
      v-if="!consoleMode && !mobileConsole"
      class="studio__sidebar"
      @need-pro="needPro" @need-create="router.push('/materials/')" @open-delivery="openDelivery"
    />

    <div
      class="col studio__canvas"
      :class="{ 'studio__canvas--console': consoleMode }"
      @dragenter="onDragEnter" @dragover="onDragOver"
      @dragleave="onDragLeave" @drop="onDropImage"
    >
      <div v-if="mobileConsole && createMode === 'edit'" class="msEditName no-print">
        <b>{{ projectName }}</b><span>示例图片</span>
      </div>

      <EditorCanvas
        ref="canvasRef"
        :chrome="consoleMode || mobileConsole ? 'console' : 'default'"
        :mode="createMode"
        @upload="pickMobileImage" @browse="router.push('/materials/')"
        @resize="openMobilePanel('size')" @delivery="openDelivery('export')"
      >
        <template #above>
          <div v-if="!consoleMode && !mobileConsole" class="canvasTitleBar no-print">
            <b class="studioTitle">{{ projectName }}</b>
            <span v-if="stats" class="tag">{{ stats.artSize }} · {{ stats.colors }} 色 · {{ stats.total.toLocaleString() }} 颗</span>
            <span v-if="generating" class="row" style="gap:6px"><span class="spinner"></span><span class="muted">生成中</span></span>
            <span v-else-if="mobileBusy" class="muted only-sm">载入中…</span>
            <span class="spacer"></span>
            <button class="btn btn-secondary sm" @click="switchOpen = true"><PixelIcon name="folder" :size="14" />作品 ({{ switchList.length }}/{{ projectLimit() }})</button>
            <button class="btn primary sm" :disabled="!hasPattern" @click="onSave"><PixelIcon name="save" :size="14" />保存</button>
          </div>
        </template>

        <template #quick>
          <div v-if="!consoleMode && !mobileConsole" class="quickRow no-print" role="toolbar" aria-label="常用功能">
            <button
              v-for="q in quickEntries" :key="q.key"
              type="button" class="quickItem" :class="{ on: q.key === 'size' }"
              :disabled="q.key === 'delivery' && !hasPattern"
              :title="q.key === 'delivery' && !hasPattern ? '先生成图纸才能导出' : q.label"
              @click="openQuick(q.key)"
            >
              <Icon :name="q.icon" :size="20" /><span>{{ q.label }}</span>
            </button>
            <button
              type="button" class="quickItem" :class="{ on: mobileMore === 'functions' }"
              aria-haspopup="dialog" :aria-expanded="mobileMore === 'functions'"
              @click="toggleMore('functions')"
            >
              <Icon name="sliders-horizontal" :size="20" /><span>更多</span>
            </button>
          </div>
        </template>
      </EditorCanvas>

      <!-- 手机端图片编辑：提示行 + 三个处理入口 + 状态行（设计稿 124:340） -->
      <div v-if="mobileConsole && createMode === 'edit'" class="msEditBar no-print">
        <p class="msEditBar__hint">{{ editViewLabel }} · 生成图纸后可用画笔修正</p>
        <div class="msEditBar__pills">
          <button type="button" @click="openMsSheet('adjust')">
            <Icon name="sliders-horizontal" :size="16" />图片调整
          </button>
          <button type="button" :disabled="!sourceUrl" @click="openCrop">
            <Icon name="scissors" :size="16" />裁切
          </button>
          <button type="button" :class="{ on: options.removeBg }" :disabled="!sourceUrl" @click="toggleMatte">
            <Icon name="wand-sparkles" :size="16" />抠图
          </button>
        </div>
        <p class="msEditBar__status">{{ msEditStatus }}</p>
      </div>

      <!-- 手机端缩放栏：撤销 / 重做 · 缩放 · 适应（设计稿 124:887） -->
      <div v-if="mobileConsole" class="msZoom no-print">
        <button type="button" class="msZoom__icon hit36" title="撤销" aria-label="撤销" :disabled="!canUndo" @click="undo()">
          <Icon name="undo-2" :size="20" />
        </button>
        <button type="button" class="msZoom__icon hit36" title="重做" aria-label="重做" :disabled="!canRedo" @click="redo()">
          <Icon name="redo-2" :size="20" />
        </button>
        <span class="msSpacer"></span>
        <button type="button" class="msZoom__icon hit36" title="缩小" aria-label="缩小" @click="canvasRef?.zoomStep(-0.25)">
          <Icon name="minus" :size="16" />
        </button>
        <span class="msZoom__pct">{{ zoomPct }}%</span>
        <button type="button" class="msZoom__icon hit36" title="放大" aria-label="放大" @click="canvasRef?.zoomStep(0.25)">
          <Icon name="plus" :size="16" />
        </button>
        <button type="button" class="msZoom__fit hit32h" title="适应窗口" @click="canvasRef?.fitStage()">
          <Icon name="scan" :size="16" />适应
        </button>
      </div>

      <!-- 手机端工具轨：画笔 / 橡皮 / 填充 / 颜色 / 更多工具 -->
      <div v-if="mobileConsole" class="msTools no-print" role="toolbar" aria-label="编辑工具">
        <button
          v-for="t in mobileTools.slice(0, 3)" :key="t.key" type="button"
          class="msTool" :class="{ on: tool === t.key }"
          :disabled="!hasPattern" :aria-pressed="tool === t.key"
          @click="pickMobileTool(t.key)"
        >
          <Icon :name="t.icon" :size="20" /><span>{{ t.label }}</span>
        </button>
        <button type="button" class="msTool msTool--color" :class="{ on: msSheet === 'color' }" :disabled="!hasPattern" @click="openMsSheet('color')">
          <span class="msTool__swatch" :style="{ background: brush?.hex || '#F3EFE6' }">
            <Icon v-if="brush" name="check" :size="16" />
          </span>
          <span>颜色</span>
        </button>
        <button type="button" class="msTool" :class="{ on: msSheet === 'more' }" :disabled="!hasPattern" @click="openMsSheet('more')">
          <Icon name="ellipsis" :size="20" /><span>更多工具</span>
        </button>
      </div>

      <div v-if="!consoleMode && !mobileConsole && showBrushParams" class="mobileParams no-print">
        <span class="mobileParams__label">{{ tool === 'erase' ? '橡皮大小' : '画笔大小' }}</span>
        <input
          class="mobileParams__range" type="range" min="1" :max="BRUSH_MAX" step="1"
          :value="activeToolSize" aria-label="笔刷大小（格）"
          @input="setBrushSize($event.target.value)"
        >
        <b class="mobileParams__val">{{ activeToolSize }} 格</b>
        <button
          v-if="tool === 'paint'" type="button" class="mobileParams__color"
          title="当前颜色，点开色板" @click="openMobilePanel('palette')"
        >
          <span>当前颜色</span>
          <i :style="{ background: brush?.hex || '#fff' }"></i>
        </button>
      </div>

      <div v-if="!consoleMode && !mobileConsole" class="mobileToolbar no-print" role="toolbar" aria-label="编辑工具">
        <button
          type="button" class="toolItem" data-tool="mirror"
          :disabled="!hasPattern" title="左右镜像" @click="mobileMirror"
        >
          <Icon name="flip-horizontal-2" :size="20" /><span>镜像</span>
        </button>
        <button
          v-for="t in mobileTools" :key="t.key"
          type="button" class="toolItem" :class="{ on: tool === t.key }"
          :disabled="!hasPattern"
          :aria-pressed="tool === t.key"
          @click="pickMobileTool(t.key)"
        >
          <Icon :name="t.icon" :size="20" /><span>{{ t.label }}</span>
        </button>
        <button
          type="button" class="toolItem" :class="{ on: mobileMore === 'tools' }"
          aria-haspopup="dialog" :aria-expanded="mobileMore === 'tools'"
          @click="toggleMore('tools')"
        >
          <Icon name="sliders-horizontal" :size="20" /><span>更多</span>
        </button>
      </div>

      <div v-if="dropActive" class="dropVeil no-print" aria-hidden="true">
        <div class="dropVeil__card">
          <span class="dropVeil__icon"><Icon name="image-up" :size="20" /></span>
          <b>松开即可上传图片</b>
          <span>JPG / PNG / WebP / GIF · 最大 12MB</span>
        </div>
      </div>

      <!-- ============================ 浮动层（全屏工作台） ============================
           都挂在画布栏里（.studio__canvas 是定位上下文），
           所以它们只覆盖画布区，不会压到顶部的命令栏与底部的状态栏。 -->

      <!-- 左侧绘图工具栏：默认折叠成画布左上角一颗绿色按钮（设计稿 1:593），
           点开是完整的竖向工具栏，底部的向上箭头负责收起。 -->
      <aside
        v-if="consoleMode" class="csRail no-print" :class="{ 'is-open': railOpen }"
        aria-label="绘图工具栏" @mouseover="onTipOver" @mouseleave="hideTip"
      >
        <button
          v-if="!railOpen" type="button" class="csRail__toggle"
          aria-label="展开绘图工具栏" :aria-expanded="false" data-rail-toggle
          @click="railOpen = true"
        >
          <Icon name="chevron-down" :size="20" />
        </button>
        <template v-else>
        <div class="toolgroup csTools" role="toolbar" aria-label="编辑工具">
          <div
            v-for="t in railTools" :key="t.key"
            class="csToolWrap" :class="{ 'has-size': t.key === 'paint' || t.key === 'erase' }"
          >
            <button
              type="button" class="tool csTool" :class="{ on: tool === t.key }"
              :aria-label="t.title" :aria-pressed="tool === t.key"
              :data-tip="t.label" :data-tip-desc="t.desc" :data-tip-key="t.shortcut || ''"
              :data-tool-key="t.key"
              @click="onRailTool(t.key)"
            >
              <Icon :name="t.icon" :size="24" /><span class="toolLabel">{{ t.label }}</span>
            </button>
            <!-- 画笔 / 橡皮右侧的尺寸箭头（设计稿 124:84 / 124:2）：
                 点它选中该工具并展开自己那张 1–5 颗的滑杆卡 -->
            <button
              v-if="t.key === 'paint' || t.key === 'erase'"
              type="button" class="csTool__sizeBtn" :class="{ on: tool === t.key }"
              :data-tool-size="t.key"
              :data-tip="`${t.label}大小`" data-tip-desc="1–5 颗，点开调整笔刷大小"
              :aria-expanded="sizePop === t.key" aria-haspopup="dialog" aria-controls="cs-size-card"
              :aria-label="`${t.label}大小，点开调整（1–5 颗）`"
              @click.stop="toggleToolSize(t.key)"
            >
              <Icon name="chevron-right" :size="16" />
            </button>
          </div>
          <button
            type="button" class="tool csTool"
            aria-label="去除杂色：把孤零零一颗、四周全是别的颜色的豆并进周围主色（可撤销）"
            data-tip="去除杂色"
            data-tip-desc="孤零零一颗、四周全是别的颜色的豆并进周围主色"
            data-tip-key="R"
            @click="onRemoveSpecks"
          >
            <Icon name="wand-sparkles" :size="24" /><span class="toolLabel">去除杂色</span>
          </button>

          <span class="csRail__sep" aria-hidden="true"></span>

          <button
            type="button" class="tool csTool" aria-label="撤销 (Ctrl+Z)"
            :disabled="!canUndo"
            data-tip="撤销" data-tip-desc="撤销上一步" data-tip-key="Ctrl+Z"
            @click="undo()"
          >
            <Icon name="undo-2" :size="24" /><span class="toolLabel">撤销</span>
          </button>
          <button
            type="button" class="tool csTool" aria-label="重做 (Ctrl+Y)"
            :disabled="!canRedo"
            data-tip="重做" data-tip-desc="重做上一步" data-tip-key="Ctrl+Y"
            @click="redo()"
          >
            <Icon name="redo-2" :size="24" /><span class="toolLabel">重做</span>
          </button>
          <button
            type="button" class="tool csTool" aria-label="左右镜像：整张图纸水平翻转（可撤销）"
            data-tip="左右镜像" data-tip-desc="整张图纸水平翻转（可撤销）" data-tip-key="M"
            @click="doMirror"
          >
            <Icon name="flip-horizontal-2" :size="24" /><span class="toolLabel">左右镜像</span>
          </button>
        </div>

        <!-- 吸底页脚：当前色 + 收起箭头。
             两样必须放在同一个吸底块里 —— 收起箭头在流里排在吸底块之后，
             只让颜色块吸底会把箭头压到轨道可视区外（点不着收不起来）。 -->
        <div class="csRail__foot">
          <div class="csRail__color">
            <button
              ref="swatchEl" type="button" class="csRail__swatch" :style="{ background: brush?.hex || '#fff' }"
              :title="brush ? `当前颜色 ${brush.code}，点开色板` : '选一个颜色开始画'"
              :aria-expanded="paletteOpen" aria-haspopup="dialog"
              aria-label="当前颜色，点开色板" @click="openPaletteCard"
            ></button>
          </div>

          <!-- 收起工具栏：向上箭头 -->
          <button
            type="button" class="csRail__collapse"
            aria-label="收起绘图工具栏" data-rail-collapse
            @click="railOpen = false; closePaletteFly(); closeSizePop()"
          >
            <Icon name="chevron-up" :size="20" />
          </button>
        </div>
        </template>
      </aside>

      <!-- 画笔 / 橡皮尺寸卡（设计稿 124:84 / 124:2）：156×81，标题 + 当前颗数、1–5 颗滑杆、范围行。
           fixed 定位贴在对应工具按钮右侧、竖直居中（工具轨是 overflow 容器，绝对定位会被裁）。 -->
      <div
        v-if="consoleMode && sizePop" id="cs-size-card"
        class="csSizeCard no-print" :style="sizePopStyle" data-brush-size
        role="dialog" :aria-label="`${sizePopLabel}（1–5 颗）`"
      >
        <div class="csSizeCard__head">
          <b>{{ sizePopLabel }}</b>
          <span data-size-value>{{ sizePopValue }} 颗</span>
        </div>
        <input
          class="csSizeCard__range" type="range" min="1" :max="BRUSH_MAX" step="1"
          :value="sizePopValue" :style="{ '--fill': sizePopFill }"
          :aria-label="`${sizePopLabel}（格）`" data-brush-range
          @input="setSizePopValue($event.target.value)" @wheel="onRangeWheel"
        >
        <div class="csSizeCard__foot"><span>1–5 颗</span><span>格 / 颗</span></div>
      </div>

      <!-- 选色面板：从工具轨底部那颗「当前颜色」色块向右滑出。
           内容与样式 = 原右栏「色板」卡里的那一块（系列 → 色系 → 搜索 → 网格 → 当前颜色）。 -->
      <div
        v-if="consoleMode && paletteOpen" ref="paletteFlyEl"
        class="csPaletteFly no-print" :style="paletteFlyStyle" data-palette-flyout
        role="dialog" aria-label="选择颜色"
      >
        <PaletteCard flyout />
      </div>

      <!-- 快捷键浮动标签：鼠标停在工具上时浮出来的那张小标签（全站只挂这一个） -->
      <ShortcutTip />

      <!-- 底部横向色板条撤掉了：主选色方式改成右栏的「色板」卡
           （系列 → 色系 → 搜索 → 多行网格），画布底部留给图纸。 -->

      <!-- 右侧入口：成品尺寸（可收起的滑杆卡）/ 作品分析 / 我的库存 / 色板 / 颜色用量 -->
      <aside v-if="consoleMode && !drawerKey" class="csSide no-print">
        <SizeQuickCard :open="sizeOpen" @update:open="sizeOpen = $event" />
        <button type="button" class="csSide__row" :class="{ 'is-off': createMode === 'edit' && !hasPattern }" @click="analysisOpen = true">
          <span class="csSide__ico csSide__ico--pink"><Icon name="chart-no-axes-combined" :size="16" /></span>
          <span>作品分析</span>
          <span class="csRot csSide__chev"><Icon name="chevron-down" :size="16" /></span>
        </button>
        <button type="button" class="csSide__row" @click="stockOpen = true">
          <span class="csSide__ico csSide__ico--lime"><Icon name="package" :size="16" /></span>
          <span>我的库存</span>
          <span class="csRot csSide__chev"><Icon name="chevron-down" :size="16" /></span>
        </button>
        <!-- 色板卡搬到了左侧工具轨：点工具轨底部那颗「当前颜色」色块，选色列表从轨的右边滑出来 -->
        <button type="button" class="csSide__row" :disabled="!hasPattern" @click="openDrawer('colors')">
          <span class="csSide__ico csSide__ico--pink"><Icon name="palette" :size="16" /></span>
          <span>颜色用量</span>
          <span class="csRot csSide__chev"><Icon name="chevron-down" :size="16" /></span>
        </button>
      </aside>

      <!-- 右侧滑出面板：复用左栏 / 右栏那张卡本身（focus 模式只显示它） -->
      <aside v-if="consoleMode && drawerKey" class="csDrawer no-print" aria-label="设置面板">
        <header class="csDrawer__head">
          <b>{{ drawerTitle }}</b>
          <button type="button" class="csIconBtn" aria-label="关闭面板" @click="closeDrawer">
            <Icon name="x" :size="16" />
          </button>
        </header>
        <div class="csDrawer__body">
          <ImageAdjustPanel
            v-if="drawerKey === 'adjust'" class="csAdjust"
            @cancel="closeDrawer" @applied="onAdjustApplied"
          />
          <template v-else>
            <EditorSidebar
              v-if="drawerIsSidebar" :key="drawerKey"
              :focus="drawerKey" narrow
              @close-panel="closeDrawer"
              @need-pro="needPro" @need-create="router.push('/materials/')" @open-delivery="openDelivery"
            />
            <EditorSidebar
              v-if="drawerKey === 'size'" key="scheme-in-size" focus="scheme" narrow
              @close-panel="closeDrawer"
              @need-pro="needPro" @need-create="router.push('/materials/')" @open-delivery="openDelivery"
            />
            <EditorInsights v-if="!drawerIsSidebar" :key="drawerKey" :focus="drawerKey" @need-pro="needPro" @replace-color="onReplaceColor" />
          </template>
        </div>
      </aside>
    </div>

    <EditorInsights v-if="!consoleMode && !mobileConsole" class="studio__insights" @need-pro="needPro" @replace-color="onReplaceColor" />

    <!-- 画布状态栏：当前状态 · 缩放 · 适应 / 实际大小 -->
    <footer v-if="consoleMode" class="csStatus no-print">
      <span class="csStatus__line">{{ statusLine }}</span>
      <span class="csSpacer"></span>
      <span class="csDiv"></span>
      <div class="zoomBar csZoom">
        <button class="csStatus__btn csStatus__btn--icon hit32" type="button" title="缩小" aria-label="缩小" @click="canvasRef?.zoomStep(-0.25)"><Icon name="zoom-out" :size="16" /></button>
        <span class="zoomText">缩放 {{ zoomPct }}%</span>
        <button class="csStatus__btn csStatus__btn--icon hit32" type="button" title="放大" aria-label="放大" @click="canvasRef?.zoomStep(0.25)"><Icon name="zoom-in" :size="16" /></button>
      </div>
      <span class="csDiv"></span>
      <button class="csStatus__btn hit32h" type="button" title="适应窗口" aria-label="适应窗口" @click="canvasRef?.fitStage()">
        <Icon name="scan" :size="16" />适应
      </button>
      <button
        class="csStatus__btn hit32h" :class="{ on: canvasRef?.actualMode }"
        type="button" data-actual-btn :disabled="!hasPattern"
        :title="hasPattern ? `按实际大小预览（成品 ${canvasRef?.finishCmText || ''}）` : '先生成图纸后才能按实际大小预览'"
        :aria-pressed="canvasRef?.actualMode"
        @click="canvasRef?.toggleActualSize()"
      ><Icon name="maximize" :size="16" />实际大小</button>
    </footer>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="onPickFile">

    <!-- 未登录时的登录框：保存被拦下来时说明「登录后才能保存」，
         登录成功后自动把那次保存补上；关掉弹窗就回到工作台。 -->
    <LoginDialog v-model="loginOpen" :reason="loginReason" @success="onLoginSuccess" />

    <!-- 手机端弹层：只显示命令对应的那张卡，底部升起 -->
    <BaseDialog v-model="mobilePanelOpen" :title="mobilePanelTitle" sheet>
      <EditorSidebar
        v-if="mobileSidebarPanel"
        :key="mobilePanel"
        :focus="mobilePanel"
        @close-panel="mobilePanelOpen = false"
        @need-pro="needPro" @need-create="router.push('/materials/')" @open-delivery="openDelivery"
      />
      <EditorInsights
        v-else-if="mobileInsightsPanel"
        :key="mobilePanel"
        :focus="mobilePanel"
        @need-pro="needPro"
        @replace-color="onReplaceColor"
      />
      <p v-if="mobilePanel === 'colors' && !hasPattern" class="processHint">
        生成图纸后这里显示每种颜色的用量与缺口。
      </p>
    </BaseDialog>

    <!-- 手机端「更多」抽屉：顶部业务功能 / 底部编辑工具共用一个状态，互斥 -->
    <BaseDialog
      :model-value="mobileMore === 'functions'" sheet title="更多功能"
      @update:model-value="v => { if (!v) mobileMore = 'none' }"
    >
      <div class="moreGrid moreGrid--3">
        <button
          v-for="f in moreFunctions" :key="f.key"
          type="button" class="moreItem"
          :disabled="f.key === 'save' && !hasPattern"
          @click="pickMoreFunction(f)"
        >
          <span class="moreItem__icon"><Icon :name="f.icon" :size="20" /></span>
          <span>{{ f.label }}</span>
        </button>
      </div>
    </BaseDialog>

    <BaseDialog
      :model-value="mobileMore === 'tools'" sheet title="更多编辑工具"
      @update:model-value="v => { if (!v) mobileMore = 'none' }"
    >
      <section class="moreSection">
        <h4>视图</h4>
        <div class="moreGrid moreGrid--4">
          <button type="button" class="moreItem" :aria-pressed="options.showGrid" @click="toggleGrid">
            <span class="moreItem__icon"><Icon name="grid-3x3" :size="20" /></span>
            <span>网格 {{ options.showGrid ? '开' : '关' }}</span>
          </button>
          <button type="button" class="moreItem" @click="moreView('split')">
            <span class="moreItem__icon"><Icon name="layout-grid" :size="20" /></span><span>分板视图</span>
          </button>
          <button type="button" class="moreItem" @click="moreView('materials')">
            <span class="moreItem__icon"><Icon name="list" :size="20" /></span><span>材料清单</span>
          </button>
        </div>
      </section>
    </BaseDialog>

    <!-- 会员引导：按钮不隐藏，点击后给出明确原因（PRD §43） -->
    <BaseDialog v-model="proOpen" title="升级 Pro 解锁这个功能" size="sm">
      <p style="font-size:var(--fs-sm);line-height:var(--ty-body-lh);color:var(--ink-2)">{{ proReason }}</p>
      <div class="proBullets">
        <div v-for="f in ['三方案自动搜索 + 智能推荐', '可拼性优化（去孤立豆 / 抖动 / 合并零星色）', '库存约束配色：只用我有的豆', '分板 PDF 与 1:1 打印图纸', '逐颗 / 整板拼制进度与分享卡', '完整品牌色板（COCO / 漫漫 / 盼盼 / 咪小窝 / 优肯 / Hama / Perler）']" :key="f">
          <span class="proCheck"><Icon name="check" :size="16" /></span>{{ f }}
        </div>
      </div>
      <div class="tag" style="margin-top:14px">AI 生图尚未接入，当前不收取 AI 费用</div>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">先不用</button>
      </template>
    </BaseDialog>

    <!-- 六个命令弹窗（设计稿 124:2316 / 2139 / 1545 / 1628 / 1365 / 1169） -->
    <UploadDialog v-model="uploadOpen" />
    <AiDialog v-model="aiOpen" />
    <MaterialsDialog v-model="materialsOpen" />
    <ExportDialog v-model="exportOpen" />
    <AnalysisDialog v-model="analysisOpen" />
    <StockDialog v-model="stockOpen" />

    <!-- 图纸交付：高清导出 / 分板 / 拼装进度 -->
    <DeliveryPanel v-model="deliveryOpen" :initial-tab="deliveryTab" @need-pro="needPro" />

    <!-- 换色：同系列色号矩阵 + 搜索 + 自动相近色 + 实时预览（全站只挂这一个实例，
         打开状态在 useStudio.colorReplace 里，桌面与手机入口共用） -->
    <ColorReplaceDialog />

    <!-- 切换作品 -->
    <BaseDialog v-model="switchOpen" title="我的作品">
      <div v-if="!switchList.length" class="empty">
        <div class="empty__icon"><Icon name="folder-open" :size="24" /></div>
        <strong>还没有保存过作品</strong>
        <p>点右上角「保存」会把当前图纸存到本机浏览器，刷新也在。</p>
      </div>
      <div v-else class="switchList">
        <button
          v-for="p in switchList" :key="p.id"
          class="switchItem" :class="{ on: p.id === currentProjectId }"
          @click="doSwitch(p.id)"
        >
          <div class="switchThumb">
            <img v-if="p.thumbnail" :src="p.thumbnail" :alt="p.name">
            <span v-else>—</span>
          </div>
          <div class="switchMeta">
            <b>{{ p.name }}</b>
            <span class="hint">{{ projectCanvas(p).w }}×{{ projectCanvas(p).h }} · {{ (p.variants && p.variants.length) || 0 }} 个方案</span>
          </div>
          <span v-if="p.id === currentProjectId" class="tag new">当前</span>
        </button>
      </div>
      <template #footer="{ close }">
        <RouterLink to="/projects" class="btn btn-secondary" @click="close">管理全部作品</RouterLink>
        <button class="btn primary" @click="onSave(); close()">保存当前</button>
      </template>
    </BaseDialog>

    <!-- 手机端保存：顶栏不显示作品名，先问名字再落盘 -->
    <BaseDialog v-model="saveOpen" title="保存作品" size="sm">
      <div class="field">
        <label for="save-name">作品名称</label>
        <input
          id="save-name" ref="saveInput" v-model="saveName"
          type="text" maxlength="24" placeholder="例如：橘猫钥匙扣"
          @keyup.enter="confirmSave"
        >
      </div>
      <p class="hint" style="margin-top:10px">名字只用于本机作品列表，之后可以在「作品」页改。</p>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button class="btn primary" :disabled="!saveName.trim()" @click="confirmSave">保存</button>
      </template>
    </BaseDialog>

    <!-- ============================ 手机端底部抽屉（设计稿 124:441 / 124:654 / 124:166） ============================
         抽屉从工具轨上方升起，盖住画布与缩放栏，工具轨本身一直可点。 -->
    <div v-if="mobileConsole && msSheet" class="msScrim no-print" @click="closeMsSheet"></div>
    <section v-if="mobileConsole && msSheet" class="msSheet no-print" :class="'msSheet--' + msSheet" role="dialog" aria-modal="true">
      <header class="msSheet__head">
        <b>{{ msSheetTitle }}</b>
        <button type="button" @click="closeMsSheet">收起<Icon name="chevron-down" :size="16" /></button>
      </header>

      <!-- 颜色 -->
      <div v-if="msSheet === 'color'" class="msSheet__body">
        <div class="msColorTop">
          <label class="msColorBrand">
            <span>品牌色板</span>
            <select :value="options.brandId" aria-label="品牌色板" @change="options.brandId = $event.target.value">
              <option v-for="b in paletteBrands" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </label>
          <div class="msColorNow">
            <i :style="{ background: brush?.hex || '#F3EFE6' }"></i>
            <span>当前</span>
            <b>{{ brush?.code || '—' }}</b>
            <em>{{ brush?.hex || '' }}</em>
          </div>
        </div>
        <label class="msSearch">
          <Icon name="search" :size="16" />
          <input v-model="colorQuery" type="search" placeholder="搜索色号或颜色，如 E02 / 粉色">
        </label>
        <div class="msTabs" role="tablist" aria-label="颜色范围">
          <button type="button" role="tab" :aria-selected="colorTab === 'all'" :class="{ on: colorTab === 'all' }" @click="colorTab = 'all'">
            全部 {{ availableColors.length }}
          </button>
          <button type="button" role="tab" :aria-selected="colorTab === 'used'" :class="{ on: colorTab === 'used' }" @click="colorTab = 'used'">
            本图 {{ usedColors.length }}
          </button>
        </div>
        <div class="msSwatches">
          <button
            v-for="c in msColorList" :key="c.id" type="button"
            class="msSwatch" :class="{ on: c.id === brushColorId }"
            :title="`${c.code}${c.name ? ' · ' + c.name : ''}`"
            :aria-pressed="c.id === brushColorId"
            @click="pickMsColor(c.id)"
          >
            <i :style="{ background: c.hex }"><Icon v-if="c.id === brushColorId" name="check" :size="16" /></i>
            <span>{{ c.code }}</span>
          </button>
          <p v-if="!msColorList.length" class="msEmpty">没有匹配的颜色</p>
        </div>
        <p class="msHint">向上滑动查看更多颜色</p>
      </div>

      <!-- 更多工具 -->
      <div v-else-if="msSheet === 'more'" class="msSheet__body">
        <div class="msBrushCard">
          <div class="msBrushCard__head"><b>{{ tool === 'erase' ? '橡皮大小' : '画笔大小' }}</b><span>当前 {{ tool === 'erase' ? '橡皮' : '画笔' }} · {{ activeToolSize }} 颗</span></div>
          <div class="msBrushCard__row">
            <span class="msBrushCard__swatch" :style="{ background: brush?.hex || '#F3EFE6' }"></span>
            <div class="msStepper">
              <button type="button" :disabled="activeToolSize <= 1" aria-label="减小画笔" @click="stepBrush(-1)">
                <Icon name="minus" :size="16" />
              </button>
              <b>{{ activeToolSize }} 颗</b>
              <button type="button" :disabled="activeToolSize >= BRUSH_MAX" aria-label="增大画笔" @click="stepBrush(1)">
                <Icon name="plus" :size="16" />
              </button>
            </div>
            <input
              class="msBrushCard__range" type="range" min="1" :max="BRUSH_MAX" step="1"
              :value="activeToolSize" aria-label="画笔大小（格）"
              @input="setBrushSize($event.target.value)"
            >
          </div>
        </div>

        <p class="msGroupTitle">辅助绘制</p>
        <button type="button" class="msRowBtn" :class="{ on: tool === 'pick' }" @click="pickMobileTool('pick')">
          <span class="msRowBtn__ico"><Icon name="pipette" :size="20" /></span>
          <span class="msRowBtn__main"><b>吸色</b><em>从画布取色</em></span>
        </button>

        <p class="msGroupTitle">图纸处理</p>
        <div class="msTriple">
          <button type="button" class="msTriple__btn" @click="openMsSheet('color')">
            <Icon name="arrow-left-right" :size="20" /><span>换色</span>
          </button>
          <button type="button" class="msTriple__btn" @click="onRemoveSpecks">
            <Icon name="wand-sparkles" :size="20" /><span>去除杂色</span>
          </button>
          <button type="button" class="msTriple__btn" @click="mirrorPattern('h')">
            <Icon name="flip-horizontal-2" :size="20" /><span>左右镜像</span>
          </button>
        </div>
      </div>

      <!-- ⋯ 更多 -->
      <div v-else-if="msSheet === 'menu'" class="msSheet__body">
        <div class="msMenu">
          <button type="button" :disabled="!hasPattern" @click="closeMsSheet(); openSave()">
            <Icon name="save" :size="20" /><span>保存作品</span>
          </button>
          <button type="button" :disabled="!hasPattern" @click="closeMsSheet(); openMobilePanel('colors')">
            <Icon name="palette" :size="20" /><span>颜色用量</span>
          </button>
          <button type="button" @click="closeMsSheet(); router.push('/')">
            <Icon name="chevron-left" :size="20" /><span>返回首页</span>
          </button>
        </div>
      </div>

      <!-- 图片调整 -->
      <div v-else-if="msSheet === 'adjust'" class="msSheet__body msSheet__body--adjust">
        <ImageAdjustPanel @cancel="closeMsSheet" @applied="onAdjustApplied" />
      </div>

      <!-- 裁切图片 -->
      <div v-else-if="msSheet === 'crop'" class="msSheet__body">
        <div class="msCrop">
          <div class="msCrop__stage">
            <img v-if="sourceUrl" :src="sourceUrl" alt="待裁切的图片">
            <span
              class="msCrop__box" aria-hidden="true"
              :style="{ left: cropBox.left + '%', top: cropBox.top + '%', width: cropBox.width + '%', height: cropBox.height + '%' }"
            ></span>
          </div>
          <label v-for="f in [
            { key: 'l', label: '左' }, { key: 'r', label: '右' }, { key: 't', label: '上' }, { key: 'b', label: '下' }
          ]" :key="f.key" class="msCrop__field">
            <span>{{ f.label }}</span>
            <input
              type="range" min="0" max="45" step="1" :value="cropInset[f.key]"
              :aria-label="'从' + f.label + '侧裁掉'"
              @input="cropInset[f.key] = Math.round(Number($event.target.value) || 0)"
            >
            <b>{{ cropInset[f.key] }}%</b>
          </label>
        </div>
        <div class="msSheet__foot">
          <button type="button" class="msBtn" @click="closeMsSheet">取消</button>
          <button type="button" class="msBtn msBtn--primary" @click="applyCrop">应用裁切</button>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
/* 画布上方的作品信息条（手机 / 平板），与画布卡片同宽、同一栏 */
.canvasTitleBar{
  display:flex;align-items:center;gap:9px;flex-wrap:wrap;
  padding:11px 14px;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-md);box-shadow:var(--sh-1);
}
.canvasTitleBar .spacer{flex:1;min-width:0}
/* 拖图上传提示层：只在文件拖进画布栏时出现，盖住画布但不吃指针事件 */
.studio__canvas{position:relative}
.dropVeil{
  position:absolute;inset:6px;z-index:40;display:grid;place-items:center;
  border:2px dashed var(--primary);border-radius:var(--r-xl);
  background:rgba(255,249,241,.9);pointer-events:none;
}
.dropVeil__card{
  display:flex;flex-direction:column;align-items:center;gap:5px;
  padding:18px 24px;border-radius:var(--r-lg);background:var(--surface);box-shadow:var(--sh-2);
}
.dropVeil__icon{
  width:42px;height:42px;border-radius:50%;display:grid;place-items:center;
  background:var(--primary-soft);color:var(--primary-ink);margin-bottom:2px;
}
.dropVeil__card b{font-size:var(--fs-sm);color:var(--ink);line-height:var(--ty-body-lh)}
.dropVeil__card span{font-size:var(--fs-2xs);color:var(--muted);line-height:var(--ty-caption-lh)}
.studioTitle{font-size:var(--fs-sm);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:var(--ty-body-lh)}
.proBullets{margin-top:14px;display:flex;flex-direction:column;gap:8px}
.proBullets div{display:flex;gap:8px;font-size:var(--fs-xs);color:var(--ink-2);line-height:var(--ty-label-lh)}
.proCheck{
  width:17px;height:17px;flex:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
  background:var(--green-soft);color:var(--green-deep);margin-top:1px;
}
.switchList{display:flex;flex-direction:column;gap:8px}
.switchItem{
  display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:11px;align-items:center;
  padding:9px;border:1.5px solid var(--line);border-radius:var(--r-sm);text-align:left;transition:var(--t);
}
.switchItem:hover{border-color:var(--line-strong)}
.switchItem.on{border-color:var(--primary);background:var(--cream)}
.switchThumb{width:54px;height:54px;border-radius:var(--r-xs);background:var(--surface-2);display:grid;place-items:center;overflow:hidden}
.switchThumb img{max-width:100%;max-height:100%;image-rendering:pixelated}
.switchMeta{display:flex;flex-direction:column;gap:3px;min-width:0}
.switchMeta b{font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:var(--ty-label-lh)}
/* 素材库弹窗的素材格 */
.csLib{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.csLib__item{
  display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px;
  border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2);text-align:center;
}
.csLib__item:hover{border-color:var(--primary)}
.csLib__thumb{width:100%;aspect-ratio:1;display:grid;place-items:center;overflow:hidden;border-radius:var(--r-xs);background:#fff}
.csLib__thumb img,.csLib__thumb svg{max-width:100%;max-height:100%;object-fit:contain}
.csLib__item b{font-size:var(--fs-2xs);font-weight:700;line-height:var(--ty-caption-lh)}

/* 手机端 4.0 的三块新布局只在手机出现；桌面端整块不占位 */
.quickRow,.mobileParams,.mobileToolbar{display:none}
@media(max-width:780px){
  .exportgroup .exp-csv,.exportgroup .exp-share{display:none}
  /* 作品名整条不显示（桌面保留）：手机优先把高度给画布，作品名在保存弹窗里编辑 */
  .canvasTitleBar{display:none}

  /* 快捷入口：画布 / 色板 / 用量 / 导出 / 更多，一行五格 */
  .quickRow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin-top:7px}
  .quickItem{
    min-height:48px;padding:4px 2px;border:1px solid var(--line);border-radius:12px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    background:var(--surface);color:var(--ink-2);font-size:12px;font-weight:700;
    box-shadow:var(--sh-1);line-height:var(--ty-caption-lh)
  }
  .quickItem:active{background:var(--primary-soft)}
  .quickItem.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary-ink)}
  .quickItem:disabled{opacity:.42}

  /* 画笔参数条：只在画笔 / 橡皮被选中时出现，插在工具行上方 */
  .mobileParams{
    display:flex;align-items:center;gap:7px;flex:0 0 auto;
    padding:4px 8px;border:1px solid var(--line);border-radius:12px;background:var(--surface);
  }
  .mobileParams__label{font-size:12px;font-weight:700;color:var(--muted);white-space:nowrap;line-height:var(--ty-caption-lh)}
  .mobileParams__range{flex:1;min-width:0;accent-color:var(--primary)}
  .mobileParams__val{font-size:12px;font-weight:700;color:var(--ink-2);white-space:nowrap;min-width:30px;text-align:right;line-height:var(--ty-caption-lh)}
  .mobileParams__color{
    display:flex;align-items:center;gap:5px;padding:0 4px 0 7px;height:26px;flex:0 0 auto;
    border:1px solid var(--line);border-radius:8px;background:var(--surface-2);
    font-size:12px;font-weight:700;color:var(--ink-2);white-space:nowrap;line-height:var(--ty-caption-lh)
  }
  .mobileParams__color i{width:17px;height:17px;border-radius:5px;border:1px solid rgba(0,0,0,.12)}

  /* 底部编辑工具：六格常驻 */
  .mobileToolbar{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;flex:0 0 auto}
  .toolItem{
    min-height:48px;padding:4px 1px;border:1px solid var(--line);border-radius:12px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    background:var(--surface);color:var(--ink-2);font-size:12px;font-weight:700;
    box-shadow:var(--sh-1);line-height:var(--ty-caption-lh)
  }
  .toolItem:active{background:var(--primary-soft)}
  .toolItem.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary-ink)}
  .toolItem:disabled{opacity:.42}

  /* 两个「更多」抽屉的格子 */
  .moreGrid{display:grid;gap:6px}
  .moreGrid--3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .moreGrid--4{grid-template-columns:repeat(4,minmax(0,1fr))}
  .moreItem{
    min-height:58px;padding:6px 3px;border:1px solid var(--line);border-radius:11px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
    background:var(--surface-2);color:var(--ink-2);font-size:12px;font-weight:700;text-align:center;line-height:var(--ty-caption-lh)
  }
  .moreItem:active{background:var(--primary-soft)}
  .moreItem:disabled{opacity:.42}
  .moreItem__icon{
    width:30px;height:30px;border-radius:9px;display:grid;place-items:center;
    background:var(--surface);border:1px solid var(--line);
  }
  .moreSection + .moreSection{margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
  .moreSection h4{margin:0 0 7px;font-size:12px;font-weight:700;letter-spacing:0;color:var(--muted-2);line-height:var(--ty-caption-lh)}
  .csLib{grid-template-columns:repeat(2,minmax(0,1fr))}
}
/* 矮屏手机：三块按钮各收 2px，画布优先 */
@media(max-width:780px) and (max-height:700px){
  .quickItem,.toolItem{min-height:44px;font-size:12px;line-height:var(--ty-caption-lh)}
  .quickRow{margin-top:5px}
  .mobileParams{padding:2px 7px}
}

/* ============================ 全屏工作台（Figma「豆玩操作台优化」1:593） ============================
   ≥1100px 用这套外壳：作品栏 → 命令栏 → 文档与视图 → 画布 → 状态栏。
   颜色：页面底 #EFF2EC、面板 #FFFFFF、描边 #DDE5D8、正文 #2A3C30、主文 #1A2D22、
         辅助 #7A9080、青柠 #C8E63C（只出现在「当前选中 / 主操作」上）。
   文字：字号字重行高一律按 1:2「豆玩 · 文字与字体规范」——
         标签 13/500、强调 13/700、辅助 12/400、正文 14/400、
         紧凑元信息 11/400（规范允许的高密度特例）、数字用 Inter。 */
@media(min-width:1100px){
  .studio--console{
    --cs-bg:#EFF2EC;
    --cs-surface:#FFFFFF;
    --cs-line:#DDE5D8;
    --cs-line-strong:#CBD8C4;
    --cs-ink:#1A2D22;
    --cs-ink-2:#2A3C30;
    --cs-secondary:#52685A;
    --cs-muted:#7A9080;
    --cs-disabled:#AFB6A9;
    --cs-accent:#C8E63C;
    --cs-accent-soft:#F2F8D9;
    --cs-fill:#F0F5EC;
    --cs-soft:#FAFBF7;
    width:100%;max-width:none;margin:0;padding:0;gap:0;
    display:flex;flex-direction:column;
    /* 基样式是 grid + align-items:start；只把 display 换成 flex 的话，1100~1319
       这一档（1280 笔记本）三行命令栏会缩成内容宽、右侧空出一条 */
    align-items:stretch;
    height:100dvh;overflow:hidden;
    background:var(--cs-bg);color:var(--cs-ink-2);
    font-family:var(--font-sans);letter-spacing:0;
  }
  /* 画布区：设计稿里那张白纸 + 极淡的方格线 */
  .studio--console > .studio__canvas{
    flex:1 1 auto;min-height:0;height:auto;overflow:hidden;padding:0;gap:0;
    position:relative;
    background:
      linear-gradient(#EDF1EA 1px,transparent 1px) 0 0/100% 26px,
      linear-gradient(90deg,#EDF1EA 1px,transparent 1px) 0 0/26px 100%,
      var(--cs-surface);
  }
  .studio--console > .studio__sidebar,
  .studio--console > .studio__insights{display:none}
  .studio--console .csDiv{width:1px;height:20px;flex:0 0 auto;background:var(--cs-line)}
  .studio--console .csDiv--v{height:18px;margin:0 4px}
  .studio--console .csSpacer{flex:1 1 auto;min-width:0}
  .studio--console .csRot{display:inline-flex;transform:rotate(-90deg)}
  .studio--console .csRot--left{transform:rotate(90deg)}

  /* ---------------- 第一行：作品栏 ---------------- */
  /* 三列等宽：左右两组各占 1fr，模式切换固定在页面中线上（设计稿 1:593） */
  .csTop{
    display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
    align-items:center;gap:16px;flex:0 0 auto;
    height:66px;padding:0 22px;background:var(--cs-surface);border-bottom:1px solid var(--cs-line);
  }
  .csTop__side{display:flex;align-items:center;gap:16px;min-width:0}
  .csLogo{display:flex;align-items:center;flex:0 0 auto}
  .csLogo img{display:block;height:42px;width:auto;object-fit:contain}
  .csProject{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}
  .csProject__ico{display:inline-flex;flex:0 0 auto;color:var(--cs-muted)}
  .csProject__pen{
    width:26px;height:26px;flex:0 0 auto;display:grid;place-items:center;
    border-radius:7px;background:transparent;color:var(--cs-muted);
  }
  .csProject__pen:hover:not(:disabled){background:var(--cs-fill);color:var(--cs-ink)}
  .csProject__pen:disabled{opacity:.4}
  /* 作品名：14px 内容小标题（规范补充条：14 / 700 / 22） */
  .csProject__name{
    background:none;border:0;padding:0;text-align:left;cursor:text;
    font-family:var(--font-sans);font-size:14px;font-weight:700;line-height:var(--ty-body-lh);letter-spacing:0;
    color:var(--cs-ink);max-width:280px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;
  }
  .csProject__name:hover{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
  .csProject__name:disabled{cursor:default;text-decoration:none}
  .csProject__input{
    height:30px;width:220px;padding:0 9px;
    font-family:var(--font-sans);font-size:14px;font-weight:400;line-height:var(--ty-body-lh);letter-spacing:0;
    border:1px solid var(--cs-line-strong);border-radius:8px;background:var(--cs-surface);color:var(--cs-ink);
  }
  .csProject__input:focus{outline:0;border-color:var(--cs-ink);box-shadow:0 0 0 3px rgba(200,230,60,.32)}
  /* 保存状态：紧凑元信息（规范允许的 11px 特例） */
  .csSaved{
    display:inline-flex;align-items:center;gap:5px;
    font-family:var(--font-sans);font-size:11px;font-weight:400;line-height:18px;letter-spacing:0;
    color:var(--cs-muted);white-space:nowrap;
  }
  .csSaved i{width:6px;height:6px;border-radius:50%;background:var(--cs-disabled)}
  .csSaved.on i{background:#5FC97E}
  .csActions{gap:4px;justify-content:flex-end;margin-left:0}
  /* 次按钮：13 / 500 / 20；导出是主按钮：15 / 700 / 24 */
  .csAction{
    display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;
    border:1px solid transparent;border-radius:9px;background:transparent;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--cs-ink-2);white-space:nowrap;transition:var(--t);
  }
  /* 1100~1160：右侧操作组按原内边距放不进 1fr 列，收紧按钮间距，
     否则会向左顶到中间的模式切换上（导出按钮的 padding 在后面单独定义，不受影响） */
  @media (max-width:1160px){
    .csActions{gap:2px}
    .csAction{padding:0 10px}
  }
  .csAction:hover{background:var(--cs-fill);color:var(--cs-ink)}
  .csAction--plain{background:transparent;border-color:transparent}
  .csAction--plain:hover{background:var(--cs-fill)}
  .csAction:disabled{color:var(--cs-disabled);background:var(--cs-fill);border-color:var(--cs-line)}
  .csAction--dark{
    background:var(--cs-ink);border-color:var(--cs-ink);color:#fff;
    font-size:15px;font-weight:700;line-height:var(--ty-card-lh);height:36px;padding:0 16px;border-radius:99px;
  }
  .csAction--dark:hover{background:#243A2D;border-color:#243A2D}
  .csAction--dark:disabled{background:var(--cs-fill);border-color:var(--cs-line);color:var(--cs-disabled)}
  .csCount{
    font-size:12px;font-weight:400;color:var(--cs-muted);
    padding:1px 5px;border-radius:99px;background:var(--cs-fill);line-height:var(--ty-caption-lh)
  }
  .csIconBtn{
    width:30px;height:30px;flex:0 0 auto;display:grid;place-items:center;
    border:1px solid transparent;border-radius:8px;background:transparent;color:var(--cs-ink);
  }
  .csIconBtn:hover{background:var(--cs-fill);border-color:var(--cs-line)}

  /* ---------------- 第二行：命令栏 ---------------- */
  .csCmd{
    display:flex;align-items:center;gap:6px;flex:0 0 auto;
    height:50px;padding:0 16px;background:var(--cs-surface);border-bottom:1px solid var(--cs-line);
  }
  .csCmd__btn{
    display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 10px;
    border:1px solid transparent;border-radius:9px;background:transparent;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--cs-ink-2);white-space:nowrap;transition:var(--t);
  }
  .csCmd__btn:hover:not(:disabled){background:var(--cs-fill);color:var(--cs-ink)}
  .csCmd__btn.on{background:var(--cs-accent);color:var(--cs-ink);font-weight:700}
  .csCmd__btn:disabled{color:var(--cs-disabled);cursor:not-allowed}
  .csCmd__btn.is-soon{color:var(--cs-disabled);cursor:not-allowed}
  .csCmd__btn.is-soon em{
    font-style:normal;font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);
    color:var(--cs-muted);padding:0 5px;border-radius:99px;background:var(--cs-fill);
  }
  .csBoard{position:relative}
  .csBoard__btn{
    display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;
    border:1px solid var(--cs-line);border-radius:9px;background:var(--cs-surface);
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--cs-ink-2);white-space:nowrap;
  }
  .csBoard__btn:hover{background:var(--cs-fill)}
  .csBrand__pop{width:236px}
  /* 模式切换：容器 #F0F5EC，选中项实心青柠（设计稿 1:593 顶栏正中） */
  .csModeSeg{
    flex:0 0 auto;display:flex;gap:2px;margin:0 8px;padding:4px;
    background:var(--cs-fill);border-radius:24px;
  }
  .csModeSeg button{
    display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;
    border:0;border-radius:20px;background:transparent;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--cs-ink-2);white-space:nowrap;transition:var(--t);
  }
  .csModeSeg button:hover{background:rgba(255,255,255,.72)}
  .csModeSeg button.on{background:var(--cs-accent);color:var(--cs-ink);font-weight:700}

  /* ---------------- 第三行：文档与视图 ---------------- */
  /* 与第一行同一套三列：视图页签固定在页面中线上，网格开关仍贴右缘 */
  .csDoc{
    display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
    align-items:center;gap:12px;flex:0 0 auto;
    height:44px;padding:0 20px;background:var(--cs-surface);border-bottom:1px solid var(--cs-line);
  }
  .csViews{
    grid-column:2;
    display:flex;gap:2px;justify-content:center;align-items:center;
    padding:0;border:0;border-radius:0;background:transparent;
    overflow:visible;width:auto;
  }
  /* 视图页签：标签 13/500，选中 13/700 */
  .csViews button{
    display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:99px;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--cs-muted);border:0;background:transparent;
  }
  .csViews button:hover:not(:disabled){background:var(--cs-fill);color:var(--cs-ink)}
  .csViews button.on{background:var(--cs-accent);color:var(--cs-ink);font-weight:700;box-shadow:none}
  .csViews button:disabled{color:var(--cs-disabled);cursor:not-allowed}
  .csToggle{
    display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 2px;
    border:0;background:transparent;grid-column:3;justify-self:end;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--cs-ink-2);white-space:nowrap;flex:0 0 auto;
  }
  .csToggle i{
    width:36px;height:20px;border-radius:99px;background:#DEDED4;position:relative;transition:var(--t);
  }
  .csToggle i::after{
    content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(26,45,34,.2);transition:transform var(--t);
  }
  .csToggle.on i{background:var(--cs-accent)}
  .csToggle.on i::after{transform:translateX(16px)}

  /* ---------------- 左侧绘图工具栏 ----------------
     折叠态（默认）：画布左上角只有一颗绿色按钮 + 下拉箭头（设计稿 1:593）。
     展开态：整条竖向工具栏 + 当前颜色 / 笔刷 + 底部的向上箭头（收起）。 */
  .csRail{
    position:absolute;left:48px;top:48px;z-index:20;width:84px;
    /* 上下各留 48px：10 颗工具 + 吸底页脚一共 707px 高，
       轨道比它矮就会把最后一颗（左右镜像）压在吸底页脚底下 ——
       悬停标签与快捷键都指着那颗按钮，压住了等于半个功能没有。
       屏再矮时（1100×700 那种）放不下，轨道自己滚，吸底页脚仍然常驻。 */
    max-height:calc(100% - 96px);overflow-y:auto;scrollbar-width:none;
    display:flex;flex-direction:column;gap:4px;
  }
  .csRail:not(.is-open){width:auto;max-height:none;overflow:visible}
  .csRail__toggle{
    width:44px;height:44px;border:0;border-radius:12px;background:var(--cs-accent);color:var(--cs-ink);
    display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 6px rgba(26,45,34,.14);
  }
  .csRail__toggle:hover{filter:brightness(.97)}
  .csRail__toggle:focus-visible{outline:2px solid var(--cs-ink);outline-offset:2px}
  .csRail.is-open{
    padding:10px 12px;background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:16px;
    box-shadow:0 1px 2px rgba(26,45,34,.04);
  }
  .csRail__collapse{
    width:100%;height:32px;margin-top:0;border:0;border-radius:9px;
    background:var(--cs-fill);color:var(--cs-ink-2);display:grid;place-items:center;cursor:pointer;
  }
  .csRail__collapse:hover{background:#E4EBDF}
  .csRail__collapse:focus-visible{outline:2px solid var(--cs-ink);outline-offset:2px}
  .csRail::-webkit-scrollbar{display:none}
  .csTools{display:flex;flex-direction:column;gap:4px}
  /* 设计稿 151:2：图标与文字落在外框中线上，未选中只有图标 + 文字、没有线框。
     基样式 .tool 带 min-width:68px 和 1px 描边，直接用会把按钮撑到 68 宽、
     顶出内容盒 ⇒ 整列图标右偏 5px、还多出一圈没要的线框。
     这里改成填满内容盒（width:100% + min-width:0）并把描边改成透明。 */
  /* 工具名：紧凑标签 12/500（规范辅助文字下限 12px） */
  .csTool{
    width:100%;min-width:0;min-height:clamp(44px,5.2vh,57px);padding:6px 2px;border-radius:12px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
    background:transparent;border-color:transparent;
    color:var(--cs-ink-2);
    font-family:var(--font-sans);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;
  }
  .csTool:hover:not(:disabled){background:var(--cs-fill)}
  .csTool.on{background:var(--cs-accent);color:var(--cs-ink);border-color:transparent;font-weight:700}
  .csTool:disabled{opacity:.34;cursor:not-allowed}
  /* 工具名（紧凑标签强调 12/700/18）——全局 .tool .toolLabel 是 800/1.1，
     在中文回退字体上会变伪粗体，这里按规范压回 700/18 */
  .csTool .toolLabel{
    font-family:var(--font-sans);font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;
  }
  .csRail__sep{height:1px;margin:5px 2px;background:var(--cs-line)}
  /* 吸底页脚：当前色 + 收起箭头。
     画笔 / 橡皮的尺寸不在这里，在各自按钮右侧的箭头上（设计稿 124:84 / 124:2）。
     工具在矮屏上放不下时轨道自己滚，这两样吸底，始终点得到。
     收起箭头必须跟颜色块在同一个吸底块里：它排在流里吸底块之后，
     颜色块单独吸底会把箭头压到轨道可视区外（点它等于点画布，收不起来）。 */
  .csRail__foot{
    position:sticky;bottom:0;z-index:2;
    margin-top:4px;padding:6px 0 8px;
    display:flex;flex-direction:column;align-items:center;gap:5px;
    background:var(--cs-surface);
  }
  .csRail__color{
    display:flex;flex-direction:column;align-items:center;gap:5px;
  }
  .csRail__swatch{
    width:28px;height:28px;border-radius:8px;border:2px solid #fff;
    box-shadow:0 0 0 1px var(--cs-line);
  }
  /* 工具按钮的包裹层：给画笔 / 橡皮右侧那颗尺寸箭头一个定位上下文。
     箭头是绝对定位，不参与 flex 排版 ⇒ 图标与文字仍落在按钮中线上。 */
  .csToolWrap{position:relative;width:100%}
  .csTool__sizeBtn{
    position:absolute;right:0;top:50%;transform:translateY(-50%);
    width:22px;height:28px;
    display:grid;place-items:center;border:0;border-radius:8px;
    background:transparent;color:var(--cs-muted);cursor:pointer;
  }
  /* 设计稿：箭头在选中态是深墨绿、未选中是灰绿；展开时背景压一层同色浅底便于看出点中了 */
  .csTool__sizeBtn.on{color:var(--cs-ink)}
  .csTool__sizeBtn:hover{background:rgba(26,45,34,.06)}
  .csTool__sizeBtn[aria-expanded="true"]{background:rgba(26,45,34,.10)}
  .csTool__sizeBtn:focus-visible{outline:2px solid var(--cs-ink);outline-offset:-2px}
  /* 短屏（900 / 800 高的笔记本）压缩工具轨：整条放得下，图标不被裁掉。
     1440×900 轨道可用 538、1280×800 可用 482，压缩后整条约 425 */
  @media (max-height:960px){
    .csRail.is-open{gap:2px;padding:8px 12px}
    .csTools{gap:2px}
    .csTool{height:44px;min-height:0;padding:2px;gap:1px}
    .csRail__sep{margin:3px 2px}
    .csRail__color{flex-direction:row;justify-content:center;gap:6px}
    .csRail__swatch{width:22px;height:22px}
  }
  /* 800 高的笔记本再压一档，颜色块也留在轨道里不被裁 */
  @media (max-height:860px){
    .csRail.is-open{gap:1px;padding:6px 12px}
    .csTools{gap:1px}
    .csTool{height:42px}
    .csRail__swatch{width:20px;height:20px}
  }
  /* 状态栏 34 高（内容盒 33）：16px 图标按钮 24 + 上下各 4 = 32 的点击区正好落在栏内，
     不会压到上面的画布，也不用向下越过视口底边 */

  /* ---------------- 选色面板（从工具轨向右滑出） ----------------
     原来它在右栏里是一张「色板」卡，现在搬到左侧工具轨：点底部那颗「当前颜色」色块，
     面板从轨的右边滑出来。外观沿用右栏那张卡的底子（白面 + 描边 + 圆角 + 5px 内边距），
     里面的系列 / 色系 / 搜索 / 网格是同一块组件，样式一个像素没改。
     定位用 fixed：工具轨是 overflow:auto 的滚动容器，绝对定位会被它裁掉。 */
  .csPaletteFly{
    position:fixed;z-index:45;width:212px;padding:5px;
    display:flex;flex-direction:column;
    background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:14px;
    box-shadow:0 8px 32px rgba(26,45,34,.12);
    animation:csFlyout .18s ease;
  }
  @keyframes csFlyout{from{transform:translateX(-14px);opacity:.35}to{transform:none;opacity:1}}

  /* ---------------- 底部色板条 ----------------
     整条在屏幕底部水平居中。宽度按 10 个色块算满 = 640：
     描边 1×2 + 内边距 8×2 + 箭头 26×2 + 间距 6×2
     + 色块 45×10 + 色块间距 12×9。再多的颜色用两侧箭头翻页。
     窄屏（<1120）按 max-width 收缩，左右各留 240，不压住右侧入口。 */
  .csPalette{
    position:absolute;left:50%;bottom:16px;z-index:20;
    transform:translateX(-50%);
    width:640px;max-width:calc(100% - 480px);
    height:82px;
    display:flex;align-items:center;gap:6px;padding:8px;
    background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:16px;
    box-shadow:0 3px 16px rgba(26,45,34,.08);
    transition:opacity var(--t);
  }
  .csPalette.is-dim{opacity:.45;pointer-events:none}
  .csPalette__list{
    flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px;
    overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
  }
  .csPalette__list::-webkit-scrollbar{display:none}
  .csPalette__cell{
    flex:0 0 auto;width:45px;display:flex;flex-direction:column;align-items:center;gap:4px;
    padding:0;border-radius:10px;border:1px solid transparent;
  }
  .csPalette__cell i{
    width:42px;height:34px;border-radius:7px;display:grid;place-items:center;
    border:1px solid rgba(0,0,0,.08);color:var(--cs-ink);
  }
  /* 色号：高密度元信息（规范允许的 10px 特例） */
  .csPalette__cell span{
    font-family:var(--font-numeric);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;
    color:var(--cs-muted);
  }
  .csPalette__cell.on{border-color:var(--cs-accent);background:rgba(200,230,60,.16)}
  .csPalette__cell.on span{color:var(--cs-ink)}
  .csPalette__cell:hover{background:var(--cs-fill)}
  .csPalette__arrow{
    width:26px;height:26px;flex:0 0 auto;display:grid;place-items:center;
    border-radius:7px;color:var(--cs-muted);
  }
  .csPalette__arrow:hover{background:var(--cs-fill);color:var(--cs-ink)}
  .csPalette__empty{
    margin:0;padding:0 12px;white-space:nowrap;
    font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--cs-muted);
  }

  /* ---------------- 右侧入口 ---------------- */
  /* 6 = 1 描边 + 5 内边距，卡片内宽正好 200（设计稿 151:587 的入口行与面板都是 200） */
  .csSide{
    position:absolute;right:28px;top:48px;z-index:20;width:212px;padding:5px;
    display:flex;flex-direction:column;gap:4px;background:var(--cs-surface);
    border:1px solid var(--cs-line);border-radius:14px;box-shadow:0 1px 2px rgba(26,45,34,.04);
  }
  /* 入口行：标签 13/500 */
  .csSide__row{
    display:flex;align-items:center;gap:9px;height:42px;padding:0 8px;border-radius:9px;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--cs-ink);
  }
  .csSide__row:hover{background:var(--cs-fill)}
  .csSide__row.is-off{opacity:.42}
  .csSide__row span:nth-child(2){flex:1;text-align:left}
  .csSide__ico{
    width:26px;height:26px;flex:0 0 auto;border-radius:8px;display:grid;place-items:center;
    background:var(--cs-fill);color:var(--cs-ink-2);
  }
  .csSide__ico--pink{background:#FBE7F0;color:#B8557F}
  .csSide__ico--lime{background:var(--cs-accent-soft);color:#6F8117}
  .csSide__row .csSide__chev{flex:0 0 auto;width:13px;height:13px;color:var(--cs-disabled)}

  /* ---------------- 右侧滑出面板 ---------------- */
  .csDrawer{
    position:absolute;right:28px;top:48px;bottom:16px;z-index:30;width:380px;
    display:flex;flex-direction:column;background:var(--cs-surface);
    border:1px solid var(--cs-line);border-radius:16px;
    box-shadow:0 8px 32px rgba(26,45,34,.12);animation:csSlide .18s ease;
  }
  @keyframes csSlide{from{transform:translateX(18px);opacity:.5}to{transform:none;opacity:1}}
  .csDrawer__head{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:12px 12px 10px 16px;border-bottom:1px solid var(--cs-line);flex:0 0 auto;
  }
  /* 面板标题按卡片标题 15/700/24 */
  .csDrawer__head b{font-family:var(--font-sans);font-size:15px;font-weight:700;line-height:var(--ty-card-lh);letter-spacing:0;color:var(--cs-ink)}
  .csDrawer__body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px;overscroll-behavior:contain}
  .csAdjust{padding:2px}

  /* ---------------- 画布状态栏 ---------------- */
  /* 状态栏是一行紧凑元信息（规范允许的 11px 特例） */
  .csStatus{
    display:flex;align-items:center;gap:8px;flex:0 0 auto;height:34px;padding:0 20px;
    background:var(--cs-surface);border-top:1px solid var(--cs-line);
    font-family:var(--font-sans);font-size:11px;font-weight:400;line-height:18px;letter-spacing:0;
    color:var(--cs-muted);white-space:nowrap;
  }
  .csStatus__line{overflow:hidden;text-overflow:ellipsis;color:var(--cs-muted)}
  .csZoom{gap:4px}
  .csZoom .zoomText{
    font-family:var(--font-numeric);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;
    color:var(--cs-ink);min-width:66px;text-align:center;font-variant-numeric:tabular-nums;
  }
  .csStatus__btn{
    display:inline-flex;align-items:center;gap:5px;
    height:24px;padding:0 8px;border:1px solid transparent;border-radius:7px;background:transparent;
    font-family:var(--font-sans);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;
    color:var(--cs-ink-2);
  }
  .csStatus__btn:hover{background:var(--cs-fill);border-color:var(--cs-line)}
  .csStatus__btn--icon{width:24px;padding:0;justify-content:center}
  .csStatus__btn.on{border-color:var(--cs-accent);background:rgba(200,230,60,.24);color:var(--cs-ink)}
  .csStatus__btn:disabled{color:var(--cs-disabled);background:transparent}

  /* ---------------- 小浮层（钉板 / 色板 / 笔刷大小） ---------------- */
  .csPop{
    position:absolute;z-index:40;padding:8px;background:var(--cs-surface);
    border:1px solid var(--cs-line);border-radius:12px;
    box-shadow:0 8px 32px rgba(26,45,34,.14);
  }
  .csPop__title{
    margin:2px 6px 6px;
    font-family:var(--font-sans);font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--cs-muted);
  }
  .csBoard__pop{right:0;top:calc(100% + 6px);width:224px}
  .csBoard__item{
    display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;
    width:100%;padding:7px 8px;border-radius:8px;text-align:left;
    font-family:var(--font-sans);font-size:13px;font-weight:400;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--cs-ink);
  }
  .csBoard__item b{font-size:13px;font-weight:700;color:var(--cs-ink);line-height:var(--ty-label-lh)}
  .csBoard__item span{font-size:12px;color:var(--cs-muted);line-height:var(--ty-caption-lh)}
  .csBoard__item em{
    font-style:normal;font-size:12px;font-weight:700;color:var(--cs-ink);
    background:var(--cs-accent-soft);border-radius:99px;padding:1px 5px;line-height:var(--ty-caption-lh)
  }
  .csBoard__item:hover{background:var(--cs-fill)}
  .csBoard__item.on{background:rgba(200,230,60,.22)}
  .csBoard__item.locked{color:var(--cs-disabled)}
  /* 画笔 / 橡皮尺寸卡（设计稿 124:133 / 124:51）：156×81、圆角 16、描边 #DDE5D8、
     阴影 0 3px 16 rgba(26,45,34,.08)。fixed 才能相对视口定位，不被工具轨裁掉。 */
  .csSizeCard{
    position:fixed;z-index:60;box-sizing:border-box;width:156px;height:81px;
    padding:8px;display:flex;flex-direction:column;gap:5px;
    background:#fff;border:1px solid #DDE5D8;border-radius:16px;
    box-shadow:0 3px 16px rgba(26,45,34,.08);
  }
  .csSizeCard__head{
    display:flex;align-items:center;justify-content:space-between;gap:8px;height:13px;
  }
  .csSizeCard__head b{
    font-family:var(--font-sans);font-size:11px;font-weight:700;line-height:13px;letter-spacing:0;
    color:#2A3C30;
  }
  .csSizeCard__head span{
    font-family:var(--font-sans);font-size:10px;font-weight:400;line-height:12px;letter-spacing:0;
    color:#7A9080;font-variant-numeric:tabular-nums;
  }
  .csSizeCard__range{
    -webkit-appearance:none;appearance:none;
    width:100%;height:28px;margin:0;padding:0;background:transparent;cursor:pointer;
  }
  .csSizeCard__range:focus{box-shadow:none}
  .csSizeCard__range:focus-visible{outline:0}
  .csSizeCard__range::-webkit-slider-runnable-track{
    height:6px;border-radius:100px;
    background:linear-gradient(90deg,#C8E63C var(--fill,0%),#DFE5DA var(--fill,0%));
  }
  .csSizeCard__range::-webkit-slider-thumb{
    -webkit-appearance:none;appearance:none;
    width:20px;height:20px;margin-top:-7px;border-radius:50%;
    background:#C8E63C;border:2px solid #1A2D22;box-shadow:0 1px 2px rgba(26,45,34,.18);
  }
  .csSizeCard__range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px rgba(200,230,60,.45)}
  .csSizeCard__range::-moz-range-track{height:6px;border-radius:100px;background:#DFE5DA}
  .csSizeCard__range::-moz-range-progress{height:6px;border-radius:100px;background:#C8E63C}
  .csSizeCard__range::-moz-range-thumb{
    width:16px;height:16px;border-radius:50%;
    background:#C8E63C;border:2px solid #1A2D22;
  }
  .csSizeCard__foot{
    display:flex;align-items:flex-start;justify-content:space-between;height:12px;
    font-family:var(--font-sans);font-size:10px;font-weight:400;line-height:12px;letter-spacing:0;
    color:#7A9080;
  }
}

/* ============================ 手机工作台（设计稿 124:887） ============================
   作品栏 64 → 模式栏 46 → 画布（铺满）→ 缩放栏 45 → 工具轨 69。
   青柠只用在「当前选中」，其余层级交给描边与浅灰。 */
@media(max-width:780px){
  .studio--mobile{
    /* 与桌面全屏工作台同一套底色体系（Figma「豆玩操作台优化」） */
    --ms-line:#DDE5D8;
    --ms-line-strong:#CBD8C4;
    --ms-ink:#1A2D22;
    --ms-ink-2:#2A3C30;
    --ms-muted:#7A9080;
    --ms-disabled:#AFB6A9;
    --ms-accent:#C8E63C;
    --ms-fill:#F0F5EC;
    position:relative;
    width:100%;max-width:none;margin:0;padding:0;gap:0;
    display:flex;flex-direction:column;align-items:stretch;
    height:100dvh;overflow:hidden;
    background:#EFF2EC;color:var(--ms-ink);
    font-family:var(--font-sans);letter-spacing:0;
  }
  .studio--mobile .msSpacer{flex:1 1 auto;min-width:0}

  /* 画布区：白底方格纸，图纸四周只留一点点边 */
  .studio--mobile > .studio__canvas{
    flex:1 1 auto;min-height:0;height:auto;overflow:hidden;padding:0;gap:0;
    position:relative;
    background:
      linear-gradient(#EDF1EA 1px,transparent 1px) 0 0/26px 26px,
      linear-gradient(90deg,#EDF1EA 1px,transparent 1px) 0 0/26px 26px,
      #FFFFFF;
  }
  .studio--mobile > .studio__canvas > .canvasCard{flex:1 1 auto;min-height:0;height:auto}
  .studio--mobile :deep(.canvasCard--console .stage--edit){padding:10px 10px 10px 30px}
  .studio--mobile :deep(.canvasCard--console .stage--empty){padding:0 16px}
  .studio--mobile :deep(.canvasCard--console .stage){background:transparent}
  /* 图纸直接铺在方格纸上：不要卡片边框、阴影与内边距 */
  .studio--mobile :deep(.board){background:#fff;border:0;border-radius:0;padding:0;box-shadow:none}
  /* 缩放 / 撤销 / 实际大小都在底部缩放栏里，画布右侧那六颗浮控不再出现 */
  .studio--mobile :deep(.stageTools){display:none}
  /* 图片编辑的「原图」页：设计稿把图片直接铺在画布上，不要卡片与说明文字 */
  .studio--mobile :deep(.compareWrap--single){max-width:none}
  .studio--mobile :deep(.compareWrap--single .compareBox){background:transparent;border:0;border-radius:0;padding:0}
  .studio--mobile :deep(.compareWrap--single .compareBox figcaption){display:none}
  .studio--mobile :deep(.compareWrap--single .compareBox img){max-height:100%;object-fit:contain;border-radius:0}

  /* ---------------- 第一行：作品栏 ---------------- */
  .msTop{
    display:flex;align-items:center;gap:6px;flex:0 0 auto;
    height:64px;padding:0 16px;background:#fff;border-bottom:1px solid var(--ms-line);
  }
  .msTop__logo{display:flex;align-items:center;flex:0 0 auto}
  .msTop__logo img{display:block;height:40px;width:auto;object-fit:contain}
  .msPill{
    display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 13px;
    border:1px solid var(--ms-line);border-radius:999px;background:#fff;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--ms-ink);white-space:nowrap;
  }
  .msPill--dark{background:var(--ms-ink);border-color:var(--ms-ink);color:#fff;font-weight:700}
  .msPill:disabled{opacity:.4}
  .msIcon{
    width:32px;height:32px;flex:0 0 auto;display:grid;place-items:center;
    border-radius:999px;color:var(--ms-ink);
  }
  .msIcon:active{background:var(--ms-fill)}

  /* ---------------- 第二行：模式栏 ---------------- */
  .msCmd{
    display:flex;align-items:center;gap:6px;flex:0 0 auto;
    height:46px;padding:0 16px;background:#fff;border-bottom:1px solid var(--ms-line);
  }
  .msCmd button{
    display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px;
    border-radius:999px;background:transparent;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--ms-ink-2);white-space:nowrap;
  }
  .msCmd button.on{background:var(--ms-accent);color:var(--ms-ink);font-weight:700}
  .msCmd__upload{border:1px solid var(--ms-line)}
  .msCmd__upload:disabled{opacity:.45}
  .msCmd__materials{border:1px solid var(--ms-line);color:var(--ms-ink)}

  /* ---------------- 图纸转换：视图页签 ---------------- */
  .msViews{
    display:flex;align-items:center;gap:4px;flex:0 0 auto;
    height:46px;padding:0 16px;background:#fff;border-bottom:1px solid var(--ms-line);
    overflow-x:auto;scrollbar-width:none;
  }
  .msViews::-webkit-scrollbar{display:none}
  .msViews button{
    display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 12px;
    border-radius:999px;background:transparent;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    color:var(--ms-ink-2);white-space:nowrap;
  }
  .msViews button.on{background:var(--ms-accent);color:var(--ms-ink);font-weight:700}
  .msViews button:disabled{color:var(--ms-disabled)}
  .msViews em{font-style:normal;font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}

  .msEditName{
    display:flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto;
    padding:8px 16px 0;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
  }
  .msEditName b{font-weight:700;color:var(--ms-ink)}
  .msEditName span{font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}

  /* ---------------- 图纸转换：提示 + 三个入口 + 状态 ---------------- */
  .msEditBar{flex:0 0 auto;padding:6px 12px 2px;display:flex;flex-direction:column;gap:6px}
  .msEditBar__hint{
    margin:0;text-align:center;
    font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted);
  }
  .msEditBar__pills{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .msEditBar__pills button{
    display:inline-flex;align-items:center;justify-content:center;gap:5px;height:38px;
    border:1px solid var(--ms-line);border-radius:999px;background:#fff;color:var(--ms-ink);
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
    white-space:nowrap;
  }
  .msEditBar__pills button:first-child{background:#FBF3F6;border-color:#FBE4EC}
  .msEditBar__pills button.on{background:var(--ms-accent);border-color:var(--ms-accent);font-weight:700}
  .msEditBar__pills button:disabled{opacity:.45}
  .msEditBar__status{
    margin:0;text-align:center;
    font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted);
  }

  /* ---------------- 缩放栏 ---------------- */
  .msZoom{
    display:flex;align-items:center;gap:2px;flex:0 0 auto;
    height:45px;padding:0 12px;background:#fff;border-top:1px solid var(--ms-line);
  }
  .msZoom__icon{
    width:34px;height:34px;flex:0 0 auto;display:grid;place-items:center;
    border-radius:9px;color:var(--ms-ink);
  }
  .msZoom__icon:active{background:var(--ms-fill)}
  .msZoom__icon:disabled{color:var(--ms-disabled)}
  .msZoom__pct{
    min-width:48px;text-align:center;
    font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-ink);
    font-variant-numeric:tabular-nums;
  }
  .msZoom__fit{
    display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;margin-left:4px;
    border-radius:999px;background:var(--ms-fill);
    font-family:var(--font-sans);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;
    color:var(--ms-ink);white-space:nowrap;
  }

  /* ---------------- 工具轨 ---------------- */
  .msTools{
    display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;flex:0 0 auto;
    height:calc(69px + env(safe-area-inset-bottom));
    padding:6px 10px calc(6px + env(safe-area-inset-bottom));
    background:#fff;border-top:1px solid var(--ms-line);
  }
  .msTool{
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
    border-radius:10px;background:transparent;
    font-family:var(--font-sans);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-ink-2);
  }
  .msTool.on{background:var(--ms-accent);color:var(--ms-ink);font-weight:700}
  .msTool:disabled{opacity:.4}
  .msTool--color .msTool__swatch{
    width:22px;height:22px;border-radius:5px;display:grid;place-items:center;
    color:var(--ms-ink);border:1px solid rgba(31,31,29,.12);
  }

  /* ---------------- 底部抽屉 ---------------- */
  .msScrim{position:absolute;inset:0 0 calc(69px + env(safe-area-inset-bottom));z-index:29;background:rgba(31,31,29,.06)}
  .msSheet{
    position:absolute;left:0;right:0;bottom:calc(69px + env(safe-area-inset-bottom));z-index:30;
    display:flex;flex-direction:column;max-height:min(58%,540px);
    background:#fff;border-radius:18px 18px 0 0;
    box-shadow:0 -10px 30px rgba(31,31,29,.12);
    animation:msSheetUp .2s var(--ease);
  }
  .msSheet::before{
    content:'';width:38px;height:4px;flex:0 0 auto;margin:8px auto 0;
    border-radius:99px;background:var(--ms-line-strong);
  }
  @keyframes msSheetUp{from{transform:translateY(28px);opacity:.5}to{transform:none;opacity:1}}
  .msSheet__head{
    display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto;
    padding:12px 16px 8px;
  }
  .msSheet__head b{font-size:15px;font-weight:700;line-height:var(--ty-card-lh);letter-spacing:0;color:var(--ms-ink)}
  .msSheet__head button{
    display:inline-flex;align-items:center;gap:3px;height:26px;padding:0 8px;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-muted);
  }
  .msSheet__body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 16px 14px;overscroll-behavior:contain}
  .msSheet__body--adjust{display:flex;flex-direction:column;padding:0 12px 12px}
  .msSheet__body--adjust :deep(.iap){flex:1 1 auto;min-height:0;overflow-y:auto;padding-bottom:8px}
  .msSheet__body--adjust :deep(.iap__foot){position:sticky;bottom:0;background:#fff;padding-top:10px}

  /* 颜色 */
  .msColorTop{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
  .msColorBrand{
    display:flex;flex-direction:column;gap:2px;padding:8px 12px;
    border:1px solid var(--ms-line-strong);border-radius:12px;background:#fff;
  }
  .msColorBrand span{font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msColorBrand select{
    border:0;background:transparent;font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-ink);
    padding:0;width:100%;appearance:none;
  }
  .msColorNow{
    display:grid;grid-template-columns:26px auto;grid-template-rows:auto auto;column-gap:8px;
    align-content:center;align-items:center;padding:8px 12px;
    border-radius:12px;background:#FBF3F6;
  }
  .msColorNow i{grid-row:1 / span 2;width:26px;height:26px;border-radius:6px;border:1px solid rgba(31,31,29,.1)}
  .msColorNow span{font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msColorNow b{font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-ink)}
  .msColorNow em{grid-column:2;font-style:normal;font-family:var(--font-numeric);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msSearch{
    display:flex;align-items:center;gap:7px;height:38px;margin-top:8px;padding:0 12px;
    border:1px solid var(--ms-line-strong);border-radius:12px;background:#fff;color:var(--ms-muted);
  }
  .msSearch input{flex:1;min-width:0;border:0;background:transparent;font-family:var(--font-sans);font-size:14px;font-weight:400;line-height:var(--ty-body-lh);letter-spacing:0;color:var(--ms-ink);outline:0}
  .msTabs{display:flex;gap:6px;margin:10px 0 8px}
  .msTabs button{
    height:28px;padding:0 12px;border-radius:999px;background:transparent;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-muted);
  }
  .msTabs button.on{background:var(--ms-accent);color:var(--ms-ink);font-weight:700}
  .msSwatches{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px 6px}
  .msSwatch{display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px;border-radius:8px}
  .msSwatch i{
    width:100%;aspect-ratio:1;border-radius:6px;display:grid;place-items:center;
    color:var(--ms-ink);border:1px solid rgba(31,31,29,.08);
  }
  .msSwatch span{font-family:var(--font-numeric);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msSwatch.on{background:#F5F8D8;box-shadow:inset 0 0 0 1.5px var(--ms-accent)}
  .msSwatch.on span{color:var(--ms-ink)}
  .msHint{margin:10px 0 0;text-align:center;font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msEmpty{margin:8px 0 0;grid-column:1 / -1;text-align:center;font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}

  /* 更多工具 */
  .msBrushCard{padding:10px 12px;border-radius:14px;background:#FBF3F6}
  .msBrushCard__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .msBrushCard__head b{font-family:var(--font-sans);font-size:13px;font-weight:700;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-ink)}
  .msBrushCard__head span{font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msBrushCard__row{display:flex;align-items:center;gap:8px;margin-top:8px}
  .msBrushCard__swatch{width:34px;height:34px;flex:0 0 auto;border-radius:8px;border:1px solid rgba(31,31,29,.1)}
  .msStepper{
    display:flex;align-items:center;gap:6px;height:34px;padding:0 6px;flex:0 0 auto;
    border-radius:999px;background:#fff;
  }
  .msStepper button{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;color:var(--ms-ink)}
  .msStepper button:disabled{color:var(--ms-disabled)}
  .msStepper b{font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;white-space:nowrap}
  .msBrushCard__range{flex:1;min-width:0;accent-color:var(--ms-accent)}
  .msGroupTitle{margin:12px 0 6px;font-family:var(--font-sans);font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msRowBtn{
    display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;
    border:1px solid var(--ms-line);border-radius:12px;background:#fff;text-align:left;
  }
  .msRowBtn.on{border-color:var(--ms-accent);background:#F8FBDF}
  .msRowBtn__ico{width:30px;height:30px;flex:0 0 auto;display:grid;place-items:center;border-radius:8px;background:var(--ms-fill)}
  .msRowBtn__main{display:flex;flex-direction:column;gap:1px;min-width:0}
  .msRowBtn__main b{font-family:var(--font-sans);font-size:14px;font-weight:700;line-height:var(--ty-body-lh);letter-spacing:0;color:var(--ms-ink)}
  .msRowBtn__main em{font-style:normal;font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msTriple{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .msTriple__btn{
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
    height:64px;border:1px solid var(--ms-line);border-radius:12px;background:#fff;
    font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-ink-2);
  }
  .msTriple__btn:active{background:var(--ms-fill)}

  /* ⋯ 更多 */
  .msMenu{display:flex;flex-direction:column}
  .msMenu button{
    display:flex;align-items:center;gap:10px;padding:12px 2px;
    border-bottom:1px solid var(--ms-line);text-align:left;color:var(--ms-ink);
  }
  .msMenu button:last-child{border-bottom:0}
  .msMenu button span{flex:1;font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0}
  .msMenu button em{font-style:normal;font-family:var(--font-sans);font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;color:var(--ms-muted)}
  .msMenu button:disabled{opacity:.4}

  /* 裁切 */
  .msCrop{display:flex;flex-direction:column;gap:8px}
  .msCrop__stage{
    position:relative;height:180px;border-radius:12px;overflow:hidden;
    background:#F4F5EE;display:grid;place-items:center;
  }
  .msCrop__stage img{max-width:100%;max-height:100%;object-fit:contain}
  .msCrop__box{
    position:absolute;border:2px solid var(--ms-ink);
    box-shadow:0 0 0 999px rgba(31,31,29,.42);pointer-events:none;
  }
  .msCrop__field{display:flex;align-items:center;gap:8px;font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-muted)}
  .msCrop__field span{width:14px;flex:0 0 auto}
  .msCrop__field input{flex:1;min-width:0;accent-color:var(--ms-accent)}
  .msCrop__field b{width:34px;flex:0 0 auto;text-align:right;font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ms-ink)}
  .msSheet__foot{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  .msBtn{height:42px;border-radius:999px;background:#F4F5EE;font-family:var(--font-sans);font-size:15px;font-weight:700;line-height:var(--ty-card-lh);letter-spacing:0;color:var(--ms-ink)}
  .msBtn--primary{background:var(--ms-accent)}

  /* 滑杆：浅灰轨道 + 青柠圆钮（原生外观在手机上轨道是深灰，和设计稿差得远）。
     子组件（图片调整 / 裁切）里的滑杆也要吃到，所以走 :deep。 */
  .studio--mobile :deep(input[type="range"]){
    -webkit-appearance:none;appearance:none;height:16px;background:transparent;
  }
  .studio--mobile :deep(input[type="range"]::-webkit-slider-runnable-track){
    height:4px;border-radius:99px;background:#E6E6DC;
  }
  .studio--mobile :deep(input[type="range"]::-webkit-slider-thumb){
    -webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-6px;
    border-radius:50%;background:var(--ms-accent);border:0;box-shadow:0 0 0 1px rgba(31,31,29,.08);
  }
  .studio--mobile :deep(input[type="range"]::-moz-range-track){height:4px;border-radius:99px;background:#E6E6DC}
  .studio--mobile :deep(input[type="range"]::-moz-range-thumb){
    width:16px;height:16px;border:0;border-radius:50%;background:var(--ms-accent);
  }
}

/* ==================== 排版收口：旧版三栏版面（781–1099 平板档） ====================
   这一档还没有设计稿（Figma 只给了 1600 宽的桌面稿与手机稿），
   界面仍是旧版三栏，卡片的字号字重写在全站共用的 global.css 里
   （800 / 850 / 900 字重、1.1~1.7 行高、-.01em 字距）。
   这里按 1:2「豆玩 · 文字与字体规范」把它们收进规范档位：
     卡片标题 15/700/24 · 导航标签 13/500/20（选中 700）
     正文 14/400/22 · 辅助 12/400/18 · 数字用 Inter 13/500/20
   规则挂在 .studio--console 根节点下 —— 只作用于工作台页面，
   首页 / 素材库 / 设置页共用的卡片样式一行没动。 */
.studio--console :deep(.card__head h3),
.studio--console :deep(.sizeWideHead__title),
.studio--console :deep(.moreRow__title){
  font-family:var(--font-sans);font-size:15px;font-weight:700;line-height:var(--ty-card-lh);letter-spacing:0;
}
/* 卡头右侧的辅助说明、字段旁的小注：辅助 12 / 400 / 18 */
.studio--console :deep(.muted),
.studio--console :deep(.field > label span){
  font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;
}
/* 步骤编号是数字：Inter 13 / 500 / 20 */
.studio--console :deep(.stepNo){
  font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
/* 图案来源页签：导航·标签 13 / 500 / 20（选中 700） */
.studio--console :deep(.sourceTabs button){
  font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
.studio--console :deep(.sourceTabs button.on){font-weight:700}
/* 字段标签：导航·标签 13 / 500 / 20 */
.studio--console :deep(.field > label){
  font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
/* 图片处理页签：紧凑标签强调 12 / 500 / 18（选中 700），副句 12 / 400 / 18
   —— 三个页签挤在左栏窄列里，用 12px 才不会把「智能抠图」折成两行 */
.studio--console :deep(.procTab strong){
  font-family:var(--font-sans);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;
  white-space:nowrap;
}
.studio--console :deep(.procTab.on strong){font-weight:700}
.studio--console :deep(.procTab span){
  font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;
}
/* 抠图 / 卡通档位：导航·标签 13 / 500 / 20（选中 700） */
.studio--console :deep(.matteBar__levels .seg),
.studio--console :deep(.cartoonBar__levels .seg){
  font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
.studio--console :deep(.matteBar__levels .seg.on),
.studio--console :deep(.cartoonBar__levels .seg.on){font-weight:700}
/* 说明与小结：辅助 12 / 400 / 18 */
.studio--console :deep(.matteBar__note),
.studio--console :deep(.processHint),
.studio--console :deep(.chartNote),
.studio--console :deep(.chartNote span),
.studio--console :deep(.sizeWideHead__sum),
.studio--console :deep(.moreRow__value){
  font-family:var(--font-sans);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;
}
/* 画布标题栏：作品名 14 / 700 / 22，主按钮 15 / 700 / 24，次按钮 13 / 500 / 20 */
.studio--console :deep(.studioTitle){
  font-family:var(--font-sans);font-size:14px;font-weight:700;line-height:var(--ty-body-lh);letter-spacing:0;
}
.studio--console :deep(.canvasTitleBar .tag){
  font-family:var(--font-numeric);font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;
}
.studio--console :deep(.canvasTitleBar .btn.btn-secondary){
  font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
.studio--console :deep(.canvasTitleBar .btn.primary){
  font-family:var(--font-sans);font-size:15px;font-weight:700;line-height:var(--ty-card-lh);letter-spacing:0;
}
/* 视图页签：导航·标签 13 / 500 / 20（选中 700） */
.studio--console :deep(.viewtabs button){
  font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
.studio--console :deep(.viewtabs button.on){font-weight:700}
/* 缩放条：数字用 Inter 13 / 500 / 20，按钮 13 / 500 / 20 */
.studio--console :deep(.zoomText){
  font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
.studio--console :deep(.zoomBar .btn){
  font-family:var(--font-sans);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
/* 工具条：紧凑标签强调 12 / 700 / 18 */
.studio--console :deep(.tool .toolLabel),
.studio--console :deep(.tool .actLong){
  font-family:var(--font-sans);font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;
}
/* 画笔浮条：色号与数量用 Inter 13 / 500 / 20 */
.studio--console :deep(.brushBar .swatchPill),
.studio--console :deep(.brushSizeVal){
  font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
}
</style>
