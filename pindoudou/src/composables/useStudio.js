/* =========================================================================
   创作工作台状态中枢
   - 源图 / 参数 / 三方案 / 当前图案 / 编辑 / 撤销重做 / 项目存档 / 建造进度
   - 所有统计都来自真实图案数据（PRD 开发指令 6）
   - 权益通过 useMembership 的 entitlement 统一控制（开发指令 9）
   ========================================================================= */

import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import {
  BOARD_SIZE, EMPTY, beadCountOf, variantParams, generateVariants as runVariants, generateVariant,
  applyInventory, materialList, boardLayout, BEAD_WEIGHT_G,
  buildability, estimateMinutes, readImagePixels, MAX_SOURCE_SIDE, colorFloorForCells,
  cleanupIsolated, CLEANUP_MAX_DE, PATTERN_VERSION, patternProfile
} from '../lib/pattern.js'
import { hexToLab } from '../lib/color.js'
/* 拼板规格（52 / 78 / 104 / 120 钉画线板）与豆径（2.6mm 小豆 / 5mm 中号豆）的唯一口径 */
import {
  BEADS, BEAD_KEYS, DEFAULT_BEAD, BOARD_SPECS, BOARD_MIN, SIZE_TIERS,
  beadOf, autoBeadKey, boardSpecFor, boardProfile, boardsText, boardsTextShort,
  isWholeBoard, snapSpec, snapTier, tierBox, customBox
} from '../lib/boardSpec.js'
import { packPattern, unpackPattern, packProgress, unpackProgress } from '../lib/archive.js'
import { packCellColors } from '../lib/render.js'
import { estimateComplexity } from '../lib/complexity.js'
import { matteLevel, MATTE_LEVELS, estimateMatte } from '../lib/matte.js'
import { cartoonize, CARTOON_STYLES } from '../lib/cartoon.js'
import { getColors, getColorById, DEFAULT_BRAND_ID, getBrand } from '../lib/palettes.js'
import { ALL_FREE, can, check, clipPalette, paletteLimitFor, trackUsage } from './useMembership.js'
import { trackEvent } from '../lib/telemetry.js'
import {
  inventory, useInventory, inventoryMode, inventoryColors,
  consumeMaterials, restoreMaterials
} from './useInventory.js'
import { toast, toastOk, toastWarn, toastErr } from './useToast.js'

export { BOARD_SIZE }
/* 界面直接要用的规格常量与换算（EditorSidebar / SettingsView / MaterialsView 都从这里取，
   免得又出现「两个页面各写一份档位表」） */
export { BEADS, BEAD_KEYS, BOARD_SPECS, BOARD_MIN, SIZE_TIERS, beadOf, boardsText, boardsTextShort, boardSpecFor, isWholeBoard, snapSpec, snapTier, tierBox, customBox }

const LS_PROJECTS = 'douzao-projects-v2'
const LS_CURRENT = 'douzao-current-v2'
const LS_SETTINGS = 'douzao-settings-v2'

/* 画布上限只写在 useMembership 的 ENTITLEMENTS 里（'canvas.cells'），这里不再留第二份数字：
   两处各写一个上限，迟早会改漏一处，然后出现「界面说能到 1000、生成却被裁到 116」这种怪事。
   下面的 MAX_CELLS 只在权益表读不出数字时兜底。 */
export const MAX_CELLS = 1000

/* ------------------------------------------------------------------ 参数 */

function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/**
 * 画布尺寸读存档：新版本存的是格数（canvasW/canvasH），
 * 老版本存的是块数（boardCols/boardRows）——按 1 块 = 29 格换算。
 * 为什么必须兼容：设置是深度 watch 自动落盘的长驻数据，老用户一升级就丢掉
 * 自己调好的默认画布，属于「改了但用户没动过手」的静默回退。
 */
function cellsFromSaved(cells, boards) {
  const n = Number(cells)
  if (Number.isFinite(n) && n > 0) return Math.round(n)
  const b = Number(boards)
  return Number.isFinite(b) && b > 0 ? Math.round(b) * BOARD_SIZE : DEFAULT_CANVAS
}

/* 什么设置都没有时的默认画布：一块 52 钉板（最小规格）。
   以前默认是 29 格（5mm 中号豆的大号方板），现在主力规格是 52 / 78 / 104 / 120 钉画线板，
   默认落到最小那块板，新用户第一眼就能做出一个完整成品。 */
const DEFAULT_CANVAS = BOARD_MIN

const saved = readSettings()

const savedCanvasW = cellsFromSaved(saved.canvasW, saved.boardCols)
const savedCanvasH = cellsFromSaved(saved.canvasH, saved.boardRows)
/** 画布规格（底板）读存档：老存档没有这两个字段时，底板就等于成品区域 */
function capacityFromSaved(v, base) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : base
}

export const options = reactive({
  brandId: saved.brandId || DEFAULT_BRAND_ID,
  /* 画布尺寸单位是「格」。一钉 = 一格，规格是 52 / 78 / 104 / 120 四个（见 lib/boardSpec.js），
     所以界面上的尺寸都是这四个规格的整数倍（暂不混拼）；老存档里的 29 / 58 / 116 / 300 照旧能打开。 */
  canvasW: savedCanvasW,
  canvasH: savedCanvasH,
  /* 画布规格 = 底板多大（整板拼出来的容量）。
     成品尺寸调的是图案在底板上占多大，四周留空；分板规格也按底板定 —— 缩小成品时板子不会跟着变小。
     老存档没有这两个字段，底板 = 成品区域，行为与以前完全一致。 */
  canvasMaxW: capacityFromSaved(saved.canvasMaxW, savedCanvasW),
  canvasMaxH: capacityFromSaved(saved.canvasMaxH, savedCanvasH),
  /**
   * 豆径：'' = 自动（按**分板规格**判断：52 / 78 / 104 / 120 钉画线板 → 2.6mm 小豆，29 格老规格 → 5mm 中号豆），
   * 也可以是 '2.6' / '5'（用户在设置页手动指定）。
   * 为什么默认自动：52 / 78 / 104 / 120 钉画线板配 2.6mm 小豆、29 格老档位配 5mm 中号豆，
   * 成品厘米差近一倍 —— 让它跟着画布走比让用户每次自己想起来更可靠。
   */
  beadKey: BEAD_KEYS.includes(saved.beadKey) ? saved.beadKey : '',
  targetColors: saved.targetColors || 16,
  fit: saved.fit || 'contain',
  dither: saved.dither || 'off',
  cleanup: saved.cleanup !== false,
  enhance: saved.enhance || false,
  /** 自动抠背景：去掉背景，只留主体，背景位置不放豆 */
  removeBg: saved.removeBg || false,
  /** 抠图力度：soft / normal / strong */
  matteLevel: saved.matteLevel || 'normal',
  /**
   * 卡通化：把写实照片先概括成「平涂色块 + 轮廓线」再出图。
   * 关掉就是原来的「照片直接转图纸」路线（PRD 的两条路线都保留）。
   */
  cartoon: saved.cartoon || false,
  /** 卡通风格：soft（轻度）/ standard（标准）/ flat（简约平涂） */
  cartoonStyle: saved.cartoonStyle || 'standard',
  numbering: saved.numbering !== false,
  showGrid: saved.showGrid !== false,
  /** 画布上的成品尺寸标注（标尺里的 W/H 尺寸线 + 厘米胶囊）：关 = 只留刻度 */
  sizeMarks: saved.sizeMarks !== false,
  boardLines: saved.boardLines !== false,
  inventoryMode: saved.inventoryMode || 'strict'
})

watch(options, v => {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}, { deep: true })

/* ------------------------------------------------------------------ 核心状态 */

export const sourceImg = shallowRef(null)
export const sourceUrl = ref('')
export const sourceName = ref('')
/** 源图是位图（上传的照片）还是矢量（素材库的 SVG）—— 决定要不要提示「画布超过原图分辨率」 */
export const sourceKind = ref('raster')
/**
 * 当前源图的「有效宽高比」：位图默认是图片本身的比例；
 * 源图自带透明背景（贴纸 / 免抠素材）时换成**主体包围盒**的比例 ——
 * 透明的那一圈花边不该占格子，画布跟主体同比例，格子才全用在主体上。
 * 矢量素材按 1:1（它们本来就是照 29 格整块底板画的，SVG 的 200×160 只是取像素的画布尺寸）。
 */
export const sourceAspect = ref(1)
/**
 * 源图是不是「拿图纸自己重建的位图」。
 *
 * 从老存档打开时没有原图，就把当前图纸重建成一张位图当源图（见 rebuildThumbSource）：
 * 最长边提到 REBUILD_SOURCE_SIDE（1024 px），插值管几何（边界落在 1/k 格的
 * 精细位置）、落色管颜色（像素收回图案本来的颜色），放大重新取样是脆边，
 * 既不一块一块、也不长一圈虚边（2026-10-31 用户反馈「放大之后变模糊了」）。
 * 这个标记只剩一个用途：saveProject 不给这种源图存快照（存了也是同样分辨率，白占地方）。
 */
export const sourceFromPattern = ref(false)
/**
 * 存档里带的那份源图（最长边 512 px 的 data URL）。
 *
 * 为什么要存：作品存下来再打开时原图已经不在内存里，以前只能拿图纸重建一张位图当源图，
 * 于是「放大尺寸 / 恢复方案」都是在放大一张低分辨率的图 —— 出来一片马赛克
 * （2026-10-29 用户反馈「放大缩小尺寸为什么会出现这样的情况」）。
 * 存一份够重新取样的源图，重新打开的作品放大才有细节。
 */
let sourceSnapshot = null
/**
 * 手机上「已生成图纸」的紧凑提示（桌面端仍走原来的 toast）。
 * 只在 ≤780px 上传照片、自动匹配画布后写入；字段全部来自真实生成结果，
 * 界面上的「当前图纸」另外读 pattern 的宽高，用户改过尺寸就以实时值为准。
 */
export const fitNotice = ref(null)
/**
 * 导入图片后按**图案复杂度**给出的钉板推荐（2026-11-04 用户口径）：
 * `{ spec, tier, w, h, level, name, desc, score, colors, sourceCapped, planCapped, keepCustom }`。
 *
 * spec 是推荐的那**一块**板（52 / 78 / 104 / 120）；tier 是尺寸列表里该打「推荐」的那一档
 * （上传走 spec 本身，素材库按素材自带尺寸可能落在 156 / 208 这类多块档）。
 * 只在上传 / 换图 / 选素材时写；打开存档时清空 —— 存档里的尺寸是用户当时定的，不再改。
 */
export const sourceRecommend = ref(null)
/**
 * 三个方案（可能是 1 个，取决于套餐）。
 *
 * 为什么是 shallowRef 而不是 ref：方案对象里装着 20 万格的 cells 与整份色板，
 * 深响应式会把它们包成 Proxy，而所有统计 / 材料表 / 分板进度都是**逐格**读 palette 的
 * （`pattern.palette[cells[i]].id` 这种）。实测在 450×450 下，光是这些 Proxy 属性读取
 * 就让「材料表」一次重算要 232 ms、「分板进度」138 ms —— 用户拖笔时每一格都要付一遍。
 * 改动一律是**整份替换**（`variants.value = list`、`{...v, active: next}`），
 * 没有任何地方就地改方案内部的字段，所以浅层引用足够触发更新，去掉这层 Proxy 是纯收益。
 */
export const variants = shallowRef([])
export const activeKey = ref('easy')
/**
 * 「下一张照片生成时默认选高还原」的一次性开关。
 * 为什么需要：推荐打分（pickRecommended）里可拼性权重 0.44，照片一旦开到精细档 + 多色号，
 * 高还原必然被判成"不好拼"，默认落点就变成色号最少的那一版 —— 用户上传照片想要的却是"像"。
 * 只在**新上传一张照片**时置位，生成一次就清掉（之后完全尊重用户手选的方案）。
 */
export const preferDetail = ref(false)
export const generating = ref(false)
export const genMs = ref(0)
export const projectName = ref('我的拼豆作品')
export const saveStatus = ref('未保存')
export const currentView = ref('pattern')
/**
 * 创作模式：free = 自由画布（从零手绘）/ edit = 图纸转换（上传图片转图纸）。
 *
 * 这是两件互不相干的事：各自有一份图纸、源图、画布尺寸、作品名与保存关联。
 * 切换模式只换文档，绝不把图纸转换导入的图片 / 生成出来的图纸带进自由画布
 * （见下面的 switchCreateMode / activateCreateMode）。界面上的分段开关读这个 ref。
 */
export const createMode = ref('edit')
/** 当前内存里这份文档属于哪种模式（切换时靠它决定把文档收进哪个槽位） */
export const workspaceMode = ref('edit')
/** 两种模式各自收着的文档；null = 这个模式还没有自己的文档 */
const modeWorkspaces = { free: null, edit: null }
export const zoom = ref(1)
export const tool = ref('paint')
/** 画笔的笔刷边长（格）。1 = 单格编辑，2~5 用于大面积上色（设计稿 124:84） */
export const brushSize = ref(1)
/** 橡皮的笔刷边长（格）。与画笔分开存，切换工具不会把对方的尺寸带走 */
export const eraserSize = ref(1)
/** 笔刷边长上限：设计稿「画笔尺寸 / 橡皮尺寸」的滑杆都是 1–5 颗 */
export const BRUSH_MAX = 5

/** 当前工具自己的笔刷边长（填充 / 吸色等工具不画，读出来仍是画笔那一档） */
export function toolSizeOf(t = tool.value) {
  return t === 'erase' ? eraserSize.value : brushSize.value
}
export function setToolSize(value, t = tool.value) {
  const n = Math.min(BRUSH_MAX, Math.max(1, Math.round(Number(value)) || 1))
  if (t === 'erase') eraserSize.value = n
  else brushSize.value = n
  return n
}
export const brushColorId = ref('')
export const selectedBoard = ref(0)
export const canvasEl = shallowRef(null)

/** 三方案搜索的汇总信息 */
export const lastSearch = ref(null)

const undoStack = []
const redoStack = []

/* ------------------------------------------------------------------ 派生 */

export const width = computed(() => options.canvasW)
export const height = computed(() => options.canvasH)
/**
 * 当前套餐的画布单边上限（格）。
 * 上限统一从权益表读：免费版 52 格（= 一块 52 钉板，正好是最小的整板尺寸）、
 * Pro 1000 格（自定义按规格一块一块加，104×9 = 936 这种）。
 */
export const maxCells = computed(() => {
  const r = check('canvas.cells', Infinity)
  return typeof r.value === 'number' ? r.value : MAX_CELLS
})

/**
 * 画布规格（容量）的实际取值：容量永远 ≥ 当前网格，且不超过套餐单边上限。
 * 用 max(容量, 网格) 兜底，是为了让「只改了 canvasW、没写容量」的旧调用
 * （设置页、老存档）仍按原来的尺寸分板，不会突然把板子缩小。
 */
export const canvasCapW = computed(() => Math.max(1, Math.min(maxCells.value, Math.max(options.canvasMaxW, options.canvasW))))
export const canvasCapH = computed(() => Math.max(1, Math.min(maxCells.value, Math.max(options.canvasMaxH, options.canvasH))))

/** 图纸里「成品区域」的边长（老图纸没有 artW/H 时就是整张画布） */
export function artBoxOf(p) {
  if (!p) return { w: 0, h: 0 }
  return {
    w: Math.max(1, Math.min(p.artW || p.width, p.width)),
    h: Math.max(1, Math.min(p.artH || p.height, p.height))
  }
}

/**
 * 把「成品区域」的图案放进「画布」：成品居中，四周留空（EMPTY）。
 *
 * 为什么要这一步：画布 = 你手上的底板（画布规格），成品 = 图案在底板上占多大（成品尺寸）。
 * 调成品尺寸只该改成品区域的大小，底板与网格密度保持不变 —— 所以生成仍按成品区域取样，
 * 拿到结果后再居中贴进画布，四周是空格（不放豆），而不是把整张画布缩成 8 × 8。
 *
 * 对齐以「成品区域左上角」为锚点：底板换大换小时，已经画到留白里的格子也跟着走，不会丢。
 */
function padToCanvas(p, cw, ch) {
  if (!p || !p.cells) return p
  const aw = Math.max(1, p.artW || p.width)
  const ah = Math.max(1, p.artH || p.height)
  const bw = Math.max(cw, aw)
  const bh = Math.max(ch, ah)
  if (p.width === bw && p.height === bh && p.artW === aw && p.artH === ah) return p
  const ox = Math.floor((bw - aw) / 2)
  const oy = Math.floor((bh - ah) / 2)
  /* 旧图案里成品区域的左上角（未填充过的图案就是 0,0） */
  const sx = Math.floor((p.width - aw) / 2)
  const sy = Math.floor((p.height - ah) / 2)
  const cells = new Int32Array(bw * bh).fill(EMPTY)
  for (let y = 0; y < bh; y++) {
    const py = y - oy + sy
    if (py < 0 || py >= p.height) continue
    const srcRow = py * p.width
    const dstRow = y * bw
    for (let x = 0; x < bw; x++) {
      const px = x - ox + sx
      if (px < 0 || px >= p.width) continue
      cells[dstRow + x] = p.cells[srcRow + px]
    }
  }
  const beads = beadCountOf(cells)
  const total = bw * bh
  /* 手工修改记录跟着格子一起平移：它是按格子下标记的，底板变了下标就变了 */
  let editMap
  if (p.editMap instanceof Map && p.editMap.size) {
    editMap = new Map()
    for (const [i, e] of p.editMap) {
      const nx = (i % p.width) + ox - sx
      const ny = Math.floor(i / p.width) + oy - sy
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
      editMap.set(ny * bw + nx, e)
    }
  }
  return {
    ...p,
    width: bw,
    height: bh,
    artW: aw,
    artH: ah,
    cells,
    editMap,
    stats: {
      ...(p.stats || {}),
      beadCount: beads,
      cellCount: total,
      /* 四周留白单独记：emptyCount 仍只算成品区域里「去背景留下的空格」，
         混在一起会让「已去背景 N 格」把留白也算进去。 */
      padCount: total - aw * ah
    }
  }
}

/** 底板（画布）变了：把现有方案重新贴一遍，成品区域不动、也不重新取样 */
function repadVariants(cw, ch) {
  if (!variants.value.length) return
  /* 豆径与分板口径跟着底板走：52 / 78 / 104 / 120 钉板是 2.6mm 小豆，
     29 格老规格是 5mm 中号豆 —— 换了板还沿用旧口径，厘米数就是错的。 */
  const bs = boardProfile(cw, ch)
  const bk = options.beadKey || autoBeadKey(cw, ch)
  variants.value = variants.value.map(v => {
    const base = { ...padToCanvas(v, cw, ch), boardSize: bs, beadKey: bk }
    return v.active ? { ...base, active: { ...padToCanvas(v.active, cw, ch), boardSize: bs, beadKey: bk } } : base
  })
}

/**
 * 手工改过的图纸换尺寸：**不重新取样**，按新的成品区域改画面。
 *
 * 为什么：setCanvasSize 原来一律 regenerate，按源图重新采样会把逐颗修改冲掉
 * （2026-10-28 用户反馈：图纸转换后换钉板尺寸，已经编辑好的图不要重置）。
 *
 * 两条路，看**成品区域有没有变**：
 *   · 变了 → **画面等比缩放**（从底稿投影，见 masterFromPattern）：整张图缩到新的成品区域里，
 *     缩小时按块合并、放大时从底稿把细节还原（缩到 52 再放回 104，细节一颗不少）。
 *     界面写「117 × 117 颗」时画面就得是 117 × 117 格大 —— 数字与画面对不上，
 *     是最容易被当成「坏了」的那种不一致
 *     （2026-10-29 用户反馈：拖清晰度滑杆调的是**画面在画布上的大小**，
 *     不是把画布改小；以前只把成品区域的框改小，画面照旧留在原处）。
 *   · 没变（只是底板换大了）→ 旧格子 1:1 挪进新底板，以底板中心为锚居中落位，
 *     画到留白里的格子也跟着走，不会丢。
 * 画在成品区域之外（板面留白里）的豆子在缩放时带不过去，要如实报数（别静默丢）。
 * 想按新尺寸重新转换仍走「恢复方案」。
 *
 * @returns {{ next: object, moved: boolean, croppedBeads: number, keptArtEmpty: number, scaled: boolean }}
 *          moved = 格子整体挪过位（下标失效，进度与撤销栈要清）
 *          croppedBeads = 没带过去的豆子颗数（缩放时是成品区域外那颗）
 *          keptArtEmpty = 幸存下来的「去背景空格」（只数新旧成品区域都盖住的）
 *          scaled = 走的是「等比缩放」而不是 1:1 平移
 */
function resizePreserveCells(p, bw, bh, aw, ah, bs, bk) {
  const oldW = p.width
  const oldH = p.height
  const oldArtW = Math.max(1, Math.min(oldW, p.artW || oldW))
  const oldArtH = Math.max(1, Math.min(oldH, p.artH || oldH))
  const sx = Math.floor((oldW - oldArtW) / 2)
  const sy = Math.floor((oldH - oldArtH) / 2)
  const ox = Math.floor((bw - aw) / 2)
  const oy = Math.floor((bh - ah) / 2)
  /* 底板中心差就是成品区域中心差（成品区域始终居中在底板上） */
  const dx = Math.round(bw / 2 - oldW / 2)
  const dy = Math.round(bh / 2 - oldH / 2)
  const cells = new Int32Array(bw * bh).fill(EMPTY)
  let croppedBeads = 0
  let keptArtEmpty = 0
  /* 成品区域变了 → 画面跟着缩放（数字与画面对得上）；没变（只换底板）→ 1:1 平移 */
  const scaled = oldArtW !== aw || oldArtH !== ah
  /* 底稿：这个方案见过的**最大网格**（见 masterFromPattern 的说明）。
     画面一律从它投影，缩小再放大才能把并掉的细节还回来。 */
  const master = ensureMaster(p)
  let nextMaster = master
  let palette = Array.from(p.palette || [])
  if (scaled) {
    const art = projectMasterArt(master, aw, ah)
    /* 画面上的格子下标属于底稿色板（之后 recalcStats 会修剪掉没用的色号） */
    palette = master.palette.slice()
    for (let y = 0; y < ah; y++) {
      const dstRow = (oy + y) * bw
      for (let x = 0; x < aw; x++) {
        const v = art[y * aw + x]
        cells[dstRow + ox + x] = v
        if (v < 0) keptArtEmpty++
      }
    }
    /* 画在成品区域之外（板面留白里）的豆子这次带不过去，要如实报数 */
    for (let y = 0; y < oldH; y++) {
      const row = y * oldW
      const inArtY = y >= sy && y < sy + oldArtH
      for (let x = 0; x < oldW; x++) {
        if (inArtY && x >= sx && x < sx + oldArtW) continue
        if (p.cells[row + x] >= 0) croppedBeads++
      }
    }
    /* 放大到比底稿还大：把投影结果升格成新底稿，
       此后在这个更大的尺寸上缩小再放大，仍能精确还原。 */
    if (aw > master.artW || ah > master.artH) {
      nextMaster = { artW: aw, artH: ah, cells: Int32Array.from(art), palette: master.palette.slice() }
    }
  } else {
    for (let y = 0; y < oldH; y++) {
      const ny = y + dy
      const srcRow = y * oldW
      const yInOldArt = y >= sy && y < sy + oldArtH
      if (ny < 0 || ny >= bh) {
        for (let x = 0; x < oldW; x++) if (p.cells[srcRow + x] >= 0) croppedBeads++
        continue
      }
      const dstRow = ny * bw
      const yInNewArt = ny >= oy && ny < oy + ah
      for (let x = 0; x < oldW; x++) {
        const v = p.cells[srcRow + x]
        const nx = x + dx
        if (nx < 0 || nx >= bw) {
          if (v >= 0) croppedBeads++
          continue
        }
        cells[dstRow + nx] = v
        if (v < 0 && yInOldArt && yInNewArt && x >= sx && x < sx + oldArtW && nx >= ox && nx < ox + aw) keptArtEmpty++
      }
    }
  }
  const next = {
    ...p,
    width: bw,
    height: bh,
    artW: aw,
    artH: ah,
    cells,
    palette,
    colors: palette.map(c => c.id),
    editMap: remapEditMap(p, bw, bh, aw, ah, sx, sy, ox, oy),
    master: nextMaster,
    boardSize: bs,
    beadKey: bk
  }
  recalcStats(next)
  /* 去背景空格只数「原来就是去背景空格」的那些：放大补进来的留白不是抠图结果，
     recalcStats 按新成品区域数会把它们也算进去，抠图提示就虚高。 */
  const artCells = aw * ah
  next.stats.emptyCount = keptArtEmpty
  next.stats.emptyRatio = artCells ? Math.round((keptArtEmpty / artCells) * 1000) / 1000 : 0
  return {
    next,
    moved: scaled || dx !== 0 || dy !== 0 || oldW !== bw || oldH !== bh,
    croppedBeads,
    scaled
  }
}

/**
 * 底稿（master）：每个方案在内存里留一份**最大网格**的成品区域 + 色板。
 *
 * 为什么要它（2026-10-31 用户反馈）：「缩小之后再放大，细节全部丢失了」。
 * 缩小时几颗旧格并成一颗（块内多数色），这是必然的有损操作；但如果下一笔放大
 * 又拿**缩小后的画面**当源，那些并掉的细节就再也回不来了。
 * 所以缩小时只改画面、不动底稿；放大时从底稿投影 —— 缩到 52 再放回 104，
 * 104 的细节一颗不少。在更小尺寸上逐颗改的格子会按比例写回底稿对应的那一块
 * （见 bakeEditsIntoMaster），换回大尺寸时修改还在原处。
 *
 * 只存成品区域（四周留白由底板决定，不属于图纸内容）；放大到比底稿还大时
 * 把投影结果升格成新底稿（见 resizePreserveCells），此后仍能精确还原。
 * 底稿不进存档（体积会翻倍），打开存档时底稿 = 存档里的网格。
 */
function masterFromPattern(p) {
  const aw = Math.max(1, Math.min(p.width, p.artW || p.width))
  const ah = Math.max(1, Math.min(p.height, p.artH || p.height))
  const sx = Math.floor((p.width - aw) / 2)
  const sy = Math.floor((p.height - ah) / 2)
  const cells = new Int32Array(aw * ah).fill(EMPTY)
  for (let y = 0; y < ah; y++) {
    const row = (sy + y) * p.width + sx
    for (let x = 0; x < aw; x++) cells[y * aw + x] = p.cells[row + x]
  }
  return { artW: aw, artH: ah, cells, palette: Array.from(p.palette || []) }
}

/** 拿这个方案的底稿；还没有（刚生成 / 刚打开存档）就按当前画面建一份 */
function ensureMaster(p) {
  const m = p.master
  if (m && m.cells && m.cells.length === m.artW * m.artH && Array.isArray(m.palette)) return m
  return masterFromPattern(p)
}

/**
 * 把底稿的成品区域投影到 aw × ah：每个新格子取覆盖它的那块底稿里**出现最多的豆色**
 * （整块没豆就留空；平手取先扫到的，结果稳定可复现）。
 * 放大时覆盖块落在一格之内 ⇒ 就是那颗豆，等于按比例铺满；缩小就是块内多数色。
 */
function projectMasterArt(master, aw, ah) {
  const mw = master.artW
  const mh = master.artH
  if (aw === mw && ah === mh) return Int32Array.from(master.cells)
  const out = new Int32Array(aw * ah).fill(EMPTY)
  const counts = new Map()
  for (let ny = 0; ny < ah; ny++) {
    const y0 = Math.floor(ny * mh / ah)
    const y1 = Math.min(mh, Math.max(y0 + 1, Math.ceil((ny + 1) * mh / ah)))
    for (let nx = 0; nx < aw; nx++) {
      const x0 = Math.floor(nx * mw / aw)
      const x1 = Math.min(mw, Math.max(x0 + 1, Math.ceil((nx + 1) * mw / aw)))
      counts.clear()
      let best = EMPTY
      let bestN = 0
      for (let y = y0; y < y1; y++) {
        const row = y * mw
        for (let x = x0; x < x1; x++) {
          const v = master.cells[row + x]
          if (v < 0) continue
          const n = (counts.get(v) || 0) + 1
          counts.set(v, n)
          if (n > bestN) { bestN = n; best = v }
        }
      }
      out[ny * aw + nx] = best
    }
  }
  return out
}

/**
 * 把这一笔在**当前画面**上的改动写回底稿：改过的画面格子按比例映射到
 * 底稿里它盖住的那一块，整块都改成这颗豆（擦掉就是 EMPTY）。
 * 画在成品区域之外（板面留白里）的豆子不属于底稿，跳过。
 */
function bakeEditsIntoMaster(p, diffs) {
  const master = ensureMaster(p)
  const mw = master.artW
  const mh = master.artH
  const aw = Math.max(1, Math.min(p.width, p.artW || p.width))
  const ah = Math.max(1, Math.min(p.height, p.artH || p.height))
  const sx = Math.floor((p.width - aw) / 2)
  const sy = Math.floor((p.height - ah) / 2)
  const palette = master.palette.slice()
  const indexOf = new Map(palette.map((c, i) => [c.id, i]))
  const cells = Int32Array.from(master.cells)
  let touched = false
  for (const [i, e] of diffs) {
    const rx = (i % p.width) - sx
    const ry = Math.floor(i / p.width) - sy
    if (rx < 0 || ry < 0 || rx >= aw || ry >= ah) continue
    let k = EMPTY
    if (e) {
      k = indexOf.get(e.id)
      if (k === undefined) {
        palette.push(e.color)
        k = palette.length - 1
        indexOf.set(e.id, k)
      }
    }
    const x0 = Math.floor(rx * mw / aw)
    const x1 = Math.min(mw, Math.max(x0 + 1, Math.ceil((rx + 1) * mw / aw)))
    const y0 = Math.floor(ry * mh / ah)
    const y1 = Math.min(mh, Math.max(y0 + 1, Math.ceil((ry + 1) * mh / ah)))
    for (let y = y0; y < y1; y++) {
      const row = y * mw
      for (let x = x0; x < x1; x++) {
        cells[row + x] = k
        touched = true
      }
    }
  }
  return touched ? { artW: mw, artH: mh, cells, palette } : master
}

/**
 * 手工修改记录跟着画面一起挪位（按块缩放 / 换底板都走这里）。
 * 规则与豆子一致：成品区域内的按比例映射，画在成品区域外的丢掉（那边本来也带不过去）。
 */
function remapEditMap(p, bw, bh, aw, ah, sx, sy, ox, oy) {
  if (!(p.editMap instanceof Map) || !p.editMap.size) return undefined
  const oldArtW = Math.max(1, Math.min(p.width, p.artW || p.width))
  const oldArtH = Math.max(1, Math.min(p.height, p.artH || p.height))
  const out = new Map()
  for (const [i, e] of p.editMap) {
    const rx = (i % p.width) - sx
    const ry = Math.floor(i / p.width) - sy
    if (rx < 0 || ry < 0 || rx >= oldArtW || ry >= oldArtH) continue
    const nx = Math.min(aw - 1, Math.floor(rx * aw / oldArtW))
    const ny = Math.min(ah - 1, Math.floor(ry * ah / oldArtH))
    out.set((oy + ny) * bw + ox + nx, e)
  }
  return out
}

/* ------------------------------------------------------------ 手工修改层 */

/**
 * 手工修改层（editLayer）：只记**用户亲手改过的格子**，分辨率是**改那一刻的网格**。
 *
 * 为什么不能只用 editMap（2026-11-01 用户定稿：「缩放分两部分，原图部分按原图缩放，
 * 修改的部分按修改时所在的尺寸缩放」）：editMap 记的是当前网格的下标，跟着画面按比例
 * 映射 —— 在 104 上改的一颗，缩到 52 再放回 104 就变成 2×2 一块（52 的分辨率），
 * 那一颗 104 的精度被吃掉了。所以另存一层：
 *   · 这一层**不随画面缩小**，只在「在更大的网格上改」时按比例放大；
 *   · 换尺寸时把它投影到新网格：放大 = 一颗铺满它对应的块，缩小 = 块内改过的值占多数者胜；
 *   · 没改过的格子在这一层是空的，换尺寸时那部分永远按原图重新取样。
 *
 * 编码：mask[i] = 1 表示这格被改过；cells[i] = 这一层色板的下标，EMPTY = 用户擦掉；
 * palette 只存这一层用到的颜色（按色号 id 与主色板对齐）。
 */
function createEditLayer(w, h) {
  return { w, h, mask: new Uint8Array(w * h), cells: new Int32Array(w * h).fill(EMPTY), palette: [] }
}

/** 按当前图纸的 editMap 建一层（老存档 / 首次编辑时用；分辨率 = 当前网格） */
function editLayerFromPattern(p) {
  if (!(p.editMap instanceof Map) || !p.editMap.size) return null
  const art = artBoxOf(p)
  const sx = Math.floor((p.width - art.w) / 2)
  const sy = Math.floor((p.height - art.h) / 2)
  const layer = createEditLayer(art.w, art.h)
  const indexOf = new Map()
  for (const [i, e] of p.editMap) {
    const rx = (i % p.width) - sx
    const ry = Math.floor(i / p.width) - sy
    if (rx < 0 || ry < 0 || rx >= art.w || ry >= art.h) continue
    const at = ry * art.w + rx
    layer.mask[at] = 1
    if (!e) {
      layer.cells[at] = EMPTY
      continue
    }
    const color = e.color || (e.id ? getColorById(e.id) : null)
    if (!color) {
      layer.cells[at] = EMPTY
      continue
    }
    let k = indexOf.get(color.id)
    if (k === undefined) {
      k = layer.palette.length
      layer.palette.push(color)
      indexOf.set(color.id, k)
    }
    layer.cells[at] = k
  }
  return layer.mask.some(Boolean) ? layer : null
}

/** 层要跟得上当前网格：只在变大时按比例放大（每颗旧格铺满它盖住的那一块） */
function growEditLayer(layer, w, h) {
  if (layer && layer.w >= w && layer.h >= h) return layer
  if (!layer) return createEditLayer(w, h)
  const nw = Math.max(w, layer.w)
  const nh = Math.max(h, layer.h)
  const out = createEditLayer(nw, nh)
  out.palette = layer.palette.slice()
  for (let y = 0; y < layer.h; y++) {
    const y0 = Math.floor(y * nh / layer.h)
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * nh / layer.h))
    for (let x = 0; x < layer.w; x++) {
      const i = y * layer.w + x
      if (!layer.mask[i]) continue
      const x0 = Math.floor(x * nw / layer.w)
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * nw / layer.w))
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const j = yy * nw + xx
          out.mask[j] = 1
          out.cells[j] = layer.cells[i]
        }
      }
    }
  }
  return out
}

/**
 * 把当前网格上的几格改动写进层里（层分辨率不够先放大）。
 * 在更小的网格上改：这一笔按比例盖住层里对应的那一块（= 修改时的尺寸决定它的粗细）。
 * 层是只读的：每次都换新对象，撤销快照才不会被后续改动污染。
 */
function writeEditsToLayer(layer, aw, ah, diffs) {
  const base = growEditLayer(layer, aw, ah)
  const mask = Uint8Array.from(base.mask)
  const cells = Int32Array.from(base.cells)
  const palette = base.palette.slice()
  const indexOf = new Map(palette.map((c, i) => [c.id, i]))
  for (const e of diffs) {
    let k = EMPTY
    if (e.color) {
      k = indexOf.get(e.color.id)
      if (k === undefined) {
        k = palette.length
        palette.push(e.color)
        indexOf.set(e.color.id, k)
      }
    }
    const x0 = Math.floor(e.rx * base.w / aw)
    const x1 = Math.min(base.w, Math.max(x0 + 1, Math.ceil((e.rx + 1) * base.w / aw)))
    const y0 = Math.floor(e.ry * base.h / ah)
    const y1 = Math.min(base.h, Math.max(y0 + 1, Math.ceil((e.ry + 1) * base.h / ah)))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const at = y * base.w + x
        mask[at] = 1
        cells[at] = k
      }
    }
  }
  return { w: base.w, h: base.h, mask, cells, palette }
}

/**
 * 把修改层投影到一张（刚从原图重新取样出来的）图纸上。
 * 每颗层格子按它覆盖的面积给目标格子投票：放大时一颗铺满对应的块，
 * 缩小时块内被改过的值按面积占多数者胜。没被任何层格子盖住的格子保持原图取样结果。
 */
function applyEditLayer(p, layer) {
  if (!layer || !layer.mask) return null
  const art = artBoxOf(p)
  const aw = art.w
  const ah = art.h
  const ox = Math.floor((p.width - aw) / 2)
  const oy = Math.floor((p.height - ah) / 2)
  const lw = layer.w
  const lh = layer.h
  const acc = new Map()
  for (let i = 0; i < layer.mask.length; i++) {
    if (!layer.mask[i]) continue
    const v = layer.cells[i]
    const x = i % lw
    const y = (i - x) / lw
    const tx0 = x * aw / lw
    const tx1 = (x + 1) * aw / lw
    const ty0 = y * ah / lh
    const ty1 = (y + 1) * ah / lh
    const nx0 = Math.floor(tx0)
    const nx1 = Math.min(aw - 1, Math.ceil(tx1) - 1)
    const ny0 = Math.floor(ty0)
    const ny1 = Math.min(ah - 1, Math.ceil(ty1) - 1)
    for (let ny = ny0; ny <= ny1; ny++) {
      const wy = Math.min(ty1, ny + 1) - Math.max(ty0, ny)
      if (wy <= 0) continue
      for (let nx = nx0; nx <= nx1; nx++) {
        const wx = Math.min(tx1, nx + 1) - Math.max(tx0, nx)
        if (wx <= 0) continue
        const at = ny * aw + nx
        let votes = acc.get(at)
        if (!votes) {
          votes = new Map()
          acc.set(at, votes)
        }
        votes.set(v, (votes.get(v) || 0) + wx * wy)
      }
    }
  }
  if (!acc.size) return null
  const cells = Int32Array.from(p.cells)
  const palette = p.palette.slice()
  const indexOf = new Map(palette.map((c, i) => [c.id, i]))
  const map = new Map()
  for (const [at, votes] of acc) {
    let best = EMPTY
    let bestW = -1
    for (const [v, weight] of votes) {
      if (weight > bestW) {
        bestW = weight
        best = v
      }
    }
    let k = EMPTY
    let entry = null
    if (best >= 0) {
      const color = layer.palette[best]
      if (!color) continue
      let pi = indexOf.get(color.id)
      if (pi === undefined) {
        pi = palette.length
        palette.push(color)
        indexOf.set(color.id, pi)
      }
      k = pi
      entry = { id: color.id, color }
    }
    const target = (oy + Math.floor(at / aw)) * p.width + ox + (at % aw)
    cells[target] = k
    map.set(target, entry)
  }
  if (!map.size) return null
  return {
    ...p,
    cells,
    palette,
    colors: palette.map(c => c.id),
    editMap: map,
    editLayer: layer
  }
}

/** 换尺寸前把每个方案的修改层取出来（没有层就按 editMap 现建一层） */
function collectEditLayers() {
  const out = []
  for (const v of variants.value) {
    const t = v.active || v
    const layer = t.editLayer && t.editLayer.mask ? t.editLayer : editLayerFromPattern(t)
    if (layer) out.push({ key: v.key, onActive: !!v.active, layer })
  }
  return out
}

/** 按原图重新取样之后，把修改层落回每个方案；返回落回去的格子数 */
function applyEditLayers(list) {
  if (!list || !list.length) return 0
  let total = 0
  variants.value = variants.value.map(v => {
    const hit = list.find(e => e.key === v.key)
    if (!hit) return v
    const target = hit.onActive && v.active ? v.active : v
    const next = applyEditLayer(target, hit.layer)
    if (!next) return v
    recalcStats(next)
    total += next.editMap.size
    return hit.onActive && v.active ? { ...v, active: next } : { ...v, ...next }
  })
  return total
}

/**
 * 全部方案做「保留手工修改」的尺寸调整（没有源图时的兜底：按当前图纸块缩放）。
 * 方案基底与 active 各自缩放；进度 / 撤销栈按下标是否失效处理；
 * 没带过去的豆子即使 silent 也要说一声 —— 丢数据不能没有解释。
 *
 * announce：要不要弹提示。拖滑杆是连续动作，每次都弹一条会刷满提示栏，
 * 那边改用尺寸说明行回填（见 EditorSidebar 的 applySizeNow）；
 * 丢豆子那种必须说的，announce 关掉也照弹。
 */
function resizeVariantsPreserving(aw, ah, { silent = false, announce = true } = {}) {
  const max = maxCells.value
  const bw = Math.max(1, Math.min(max, canvasCapW.value))
  const bh = Math.max(1, Math.min(max, canvasCapH.value))
  const bs = boardProfile(bw, bh)
  const bk = options.beadKey || autoBeadKey(bw, bh)
  /* 旧图纸的底板与成品区域：提示语要说清「是换了底板」还是「只是画面改大小」 */
  const first = variants.value[0]
  const oldBoardW = first ? first.width : bw
  const oldBoardH = first ? first.height : bh
  const oldArtW = first ? Math.max(1, Math.min(oldBoardW, first.artW || oldBoardW)) : aw
  const oldArtH = first ? Math.max(1, Math.min(oldBoardH, first.artH || oldBoardH)) : ah
  const boardChanged = oldBoardW !== bw || oldBoardH !== bh
  let moved = false
  let croppedBeads = 0
  let scaled = false
  variants.value = variants.value.map(v => {
    /* 底稿与「库存重配色」那份**都要**缩：只缩显示的那一份，
       另一份会留在旧尺寸上（切回底稿时又看到旧图，等于「换板只换了一半」）。 */
    const r = resizePreserveCells(v, bw, bh, aw, ah, bs, bk)
    moved = moved || r.moved
    croppedBeads += r.croppedBeads
    scaled = scaled || r.scaled
    if (!v.active) return r.next
    const ra = resizePreserveCells(v.active, bw, bh, aw, ah, bs, bk)
    moved = moved || ra.moved
    croppedBeads += ra.croppedBeads
    scaled = scaled || ra.scaled
    return { ...r.next, active: ra.next }
  })
  let progressReset = false
  if (moved && buildProgress.value.size) {
    /* 下标整体挪了：旧进度对应的是另一张网格，留着会显示一个假百分比 */
    buildProgress.value = new Set()
    progressReset = true
  }
  if (moved) clearUndoStacks()
  saveStatus.value = '未保存'
  /* 放大：目标尺寸在底稿范围内 ⇒ 从留底细节还原；超过底稿 ⇒ 每颗豆按比例复制。
     缩小：块内多数色合并，底稿不动（放大回来会恢复）。 */
  const grows = aw > oldArtW || ah > oldArtH
  const firstMaster = first ? ensureMaster(first.active || first) : null
  const withinMaster = !!firstMaster && aw <= firstMaster.artW && ah <= firstMaster.artH
  const grew = scaled && grows
  const restored = grew && withinMaster
  let text
  if (scaled) {
    const how = restored ? '从留底细节还原，颜色不变' : grew ? '每颗豆按比例复制，颜色不变' : '细节按块合并，留底不变，放大回来会恢复'
    text = boardChanged
      ? `已按新底板把画面${grows ? '放大' : '缩小'}到 ${aw} × ${ah} 格，手工修改保留（${how}）`
      : `已把画面${grows ? '放大' : '缩小'}到 ${aw} × ${ah} 格，手工修改保留（${how}）`
  } else {
    text = `已保留手工修改，画布调整为 ${aw} × ${ah} 格`
  }
  if (croppedBeads > 0) text += scaled ? `，画在成品区域外的 ${croppedBeads} 颗没带过去` : `，放不下的 ${croppedBeads} 颗已裁掉`
  if (progressReset) text += '，拼制进度已重置'
  text += '；想按新尺寸重新转换请点「恢复方案」'
  if (croppedBeads > 0) toastWarn(text)
  else if (announce && (scaled || !silent)) toastOk(text)
  /* runWithBusy 会先把 generating 置 true 等一帧，等的是 regenerate 来收尾；
     这条路不跑 regenerate，得自己复位，否则「生成中」永远转。 */
  generating.value = false
  return { scaled, grew, restored, croppedBeads, moved, boardChanged }
}

/**
 * 当前画布该用哪种豆径。
 * 自动时按**分板规格**判断（见 boardSpec.js 的 autoBeadKey）：52 / 78 / 104 / 120 钉画线板 → 2.6mm 小豆，
 * 退到 29 格老规格（29 / 58 / 116 / 464…）→ 5mm 中号豆；
 * 当前图案（如果已经生成过）自带的 beadKey 优先 —— 图纸的口径在生成那一刻就定下来了，
 * 之后改画布尺寸不应该让屏幕上这张图纸的「成品 13.5 cm」突然变成 26.0 cm。
 *
 * 读**画布（底板）**而不是成品区域：豆径是底板的属性，成品缩到 8 × 8 也不会让底板变成另一种板。
 */
export const beadAuto = computed(() => autoBeadKey(canvasCapW.value, canvasCapH.value))
export const beadKey = computed(() => {
  const p = pattern.value
  if (p && p.beadKey) {
    /* 画布尺寸与图纸一致时才认图纸的口径；尺寸刚被改过（还没重新生成）就按新尺寸算 */
    if (p.width === canvasCapW.value && p.height === canvasCapH.value) return p.beadKey
  }
  return options.beadKey || beadAuto.value
})
export const bead = computed(() => beadOf(beadKey.value))
/** 当前画布的分板规格（整张画布只用一种板，见 lib/boardSpec.js）——按**底板**算：
    成品缩到 26 × 26 仍然铺在 52 板上，分板线与豆径都不跟着成品变。 */
export const boardSize = computed(() => boardProfile(canvasCapW.value, canvasCapH.value))

/**
 * 画布是不是已经超过了原图**有效**分辨率。
 *
 * 为什么要提示：用户点精细档 / 极限档的动机是「想更清楚」，但格数只能还原**原图里已有的信息**。
 * 实测一张 155×168 的图，开到 300 格和 116 格的差别几乎为零（多出来的格子都是插值出来的），
 * 而 1337×1755 的图开到 450 格确实明显更清楚。这种「加大画布却没变清楚」如果不说，
 * 用户只会觉得工具没用。
 *
 * 有效分辨率还要再夹一道 MAX_SOURCE_SIDE：原图再大，生成时也会先缩到那个边长再逐格取样
 * （readImagePixels 的逐级减半），所以「画布 > 取样边长」之后多加的格子同样没有新像素可用 ——
 * 这句话必须如实说，否则 1000 格会遇到「原图 4000 px 宽、界面却不说任何话」的空白地带。
 *
 * 用 min(宽,高) 而不是 max：fit 默认 contain，短边才是先被用满的那一边。
 * 矢量素材（素材库 SVG）没有分辨率上限，直接跳过。
 */
export const canvasOverSource = computed(() => {
  if (sourceKind.value === 'vector') return null
  const img = sourceImg.value
  const sw = img && (img.naturalWidth || img.width)
  const sh = img && (img.naturalHeight || img.height)
  if (!sw || !sh) return null
  const srcMin = Math.min(sw, sh)
  const effSide = Math.min(srcMin, MAX_SOURCE_SIDE)
  const canvasMax = Math.max(width.value, height.value)
  if (canvasMax <= effSide) return null
  return { srcW: sw, srcH: sh, srcMin, effSide, canvasMax, cappedByApp: srcMin > MAX_SOURCE_SIDE }
})

/** 当前图案（含库存重配色的最终结果） */
export const pattern = computed(() => {
  const v = variants.value.find(x => x.key === activeKey.value) || variants.value[0] || null
  if (!v) return null
  return v.active || v
})

export const activeVariant = computed(() => variants.value.find(x => x.key === activeKey.value) || variants.value[0] || null)

export const hasPattern = computed(() => !!pattern.value && pattern.value.cells && pattern.value.cells.length > 0)

export const brand = computed(() => getBrand(options.brandId))

/** 当前可用色板：默认品牌给全色号，其它品牌按套餐裁剪 */
export const availableColors = computed(() => clipPalette(getColors(options.brandId), paletteLimitFor(options.brandId)))
/** 引擎能用的色号比品牌色板少时，界面上要说明原因（否则用户以为色板坏了） */
export const paletteLimited = computed(() => availableColors.value.length < getColors(options.brandId).length)

/**
 * 抠背景的运行结果。
 * 界面必须如实说明「去了多少背景」或「为什么没生效」——
 * 用户勾了开关却什么都没变、又没有任何解释，是最糟糕的体验。
 */
export const matteInfo = computed(() => {
  const p = pattern.value
  const mm = p && p.matte
  /* 源图自带透明背景 = 不用用户开任何开关就生效的抠图（见 pattern.js 的 resolveMatte）。
     这条必须能在界面上看见：用户没勾「智能抠图」，图案里却少了一大片豆子，
     不给一句解释就等于"程序偷偷吃了我的格子"。 */
  if (mm && mm.auto && mm.applied) {
    const box = artBoxOf(p)
    const cells = box.w * box.h
    const empty = p && p.stats ? p.stats.emptyCount || 0 : 0
    return {
      status: 'applied',
      auto: true,
      emptyCount: empty,
      cropped: !!mm.cropped,
      text: `源图自带透明背景：透明处已留空 ${empty} 格不放豆（占成品区域 ${cells ? Math.round((empty / cells) * 100) : 0}%）`
        + (mm.cropped ? '，并已自动裁到主体范围' : '')
    }
  }
  if (!options.removeBg) return null
  const m = mm
  if (!m) {
    /* 从本机存档打开的作品没有 matte 元数据（空格已经烘进 cells 了）。
       这时按实际空格数如实说明，不要写成"重新生成后生效"——
       用户看到的明明已经是去过背景的图，提示却像没生效。 */
    const box = artBoxOf(p)
    const cells = box.w * box.h
    const empty = p && p.stats ? p.stats.emptyCount || 0 : 0
    if (empty > 0 && cells > 0) {
      return {
        status: 'applied',
        fromSave: true,
        emptyCount: empty,
        text: `已去背景：${empty} 格不放豆（占成品区域 ${Math.round((empty / cells) * 100)}%）`
      }
    }
    return { status: 'idle', text: '重新生成后生效' }
  }
  if (!m.applied) {
    return { status: 'failed', confidence: m.confidence || 0, text: m.reason || '未检测到明显背景，已保留整图' }
  }
  const pct = Math.round((m.bgShare || 0) * 100)
  const shadowPct = Math.round((m.shadowShare || 0) * 100)
  /* 把「背景」和「投影」分开说：用户要的结果是"只剩一个干净的物体"，
     能一眼看到影子也被去掉了，才敢相信这件衣服/这个玩偶抠干净了。 */
  const parts = [`已去掉约 ${pct}% 的背景`]
  if (shadowPct >= 1) parts.push(`其中 ${shadowPct}% 是投影`)
  if (m.cropped) parts.push('已自动裁到主体范围')
  return {
    status: 'applied',
    confidence: m.confidence,
    bgPct: pct,
    shadowPct,
    cropped: !!m.cropped,
    weak: (m.confidence || 0) < 0.45,
    text: parts.join('，')
  }
})

/** 抠图力度档位（给界面用） */
export const matteLevels = MATTE_LEVELS
export const currentMatteLevel = computed(() => matteLevel(options.matteLevel))

/**
 * 切换自动抠背景。
 * 参数变了必须重跑生成，否则用户看到的还是旧图案，会以为开关没生效。
 */
export function setRemoveBg(on) {
  options.removeBg = !!on
  if (!sourceImg.value) return false
  return regenerate()
}

export function setMatteLevel(key) {
  options.matteLevel = key
  if (!options.removeBg || !sourceImg.value) return false
  return regenerate()
}

/* ------------------------------------------------- 卡通化（照片 → 卡通形象） */

/** 三档卡通风格（给界面用） */
export const cartoonStyles = CARTOON_STYLES
export const currentCartoonStyle = computed(() => cartoonStyle(options.cartoonStyle))

function cartoonStyle(key) {
  return CARTOON_STYLES.find(s => s.key === key) || CARTOON_STYLES[1]
}

/**
 * 卡通化的运行结果。
 * 与抠图一样，界面必须如实说明"做了什么"：转了多少色块、描了多少线、
 * 结构一致度多少、色相偏移多少 —— 用户最担心的就是「卡通化把原图改得不像了」。
 */
export const cartoonInfo = computed(() => {
  if (!options.cartoon) return null
  const p = pattern.value
  const c = p && p.cartoon
  if (!c) {
    /* 从本机存档打开的作品没有 cartoon 元数据（色块已经烘进 cells 了）。
       这时如实说明"存档里没有这次卡通化的记录"，不要假装它还在。 */
    return { status: 'fromSave', text: '这件存档没有卡通化记录，重新生成后按当前风格卡通化' }
  }
  const levels = c.levels || 0
  const inkPct = Math.round((c.inkShare || 0) * 100)
  const structPct = Math.round((c.structure ?? 1) * 100)
  const parts = [`已卡通化「${c.styleLabel || '标准'}」：${levels} 个平涂色块`]
  if (c.inkShare) parts.push(`轮廓线 ${inkPct}%`)
  if (c.anchorShare) parts.push(`特征回贴 ${Math.round(c.anchorShare * 100)}%`)
  parts.push(`结构一致 ${structPct}%`)
  if (c.hueShift != null) parts.push(`色相偏移 ${c.hueShift}°`)
  return {
    status: 'applied',
    ...c,
    structurePct: structPct,
    inkPct,
    weak: structPct < 60,
    text: parts.join(' · ')
  }
})

/**
 * 切换卡通化。
 * 参数变了必须重跑生成 —— 否则用户看到的还是按照片出的旧图案，
 * 会以为开关没生效（抠图那边踩过同一个坑）。
 */
export function setCartoon(on) {
  options.cartoon = !!on
  previewMode.value = options.cartoon ? 'cartoon' : 'source'
  if (!sourceImg.value) {
    if (options.cartoon) toastWarn('先上传一张图片，「卡通化」会在生成时生效')
    cartoonPreviewUrl.value = ''
    return false
  }
  refreshCartoonPreview()
  return regenerate()
}

export function setCartoonStyle(key) {
  if (!CARTOON_STYLES.some(s => s.key === key)) return false
  options.cartoonStyle = key
  if (!options.cartoon || !sourceImg.value) return false
  refreshCartoonPreview()
  return regenerate()
}

/**
 * 侧栏缩略图上「原图 / 卡通」对照用的预览图。
 * 用的是与出图**完全相同**的 cartoonize 与参数，所以缩略图上看到什么，出图就是什么；
 * 只在源图 ≤420 边长上算（几十毫秒），不为了一张预览图拖慢交互。
 */
export const cartoonPreviewUrl = ref('')
export const previewMode = ref('source')
let previewSeq = 0

export function refreshCartoonPreview() {
  const img = sourceImg.value
  if (!img || !options.cartoon) {
    cartoonPreviewUrl.value = ''
    return ''
  }
  const seq = ++previewSeq
  let url = ''
  try {
    const px = readImagePixels(img, 420)
    const c = cartoonize(px.data, px.width, px.height, { style: options.cartoonStyle })
    const canvas = document.createElement('canvas')
    canvas.width = px.width
    canvas.height = px.height
    const ctx = canvas.getContext('2d')
    const frame = ctx.createImageData(px.width, px.height)
    frame.data.set(c.data)
    ctx.putImageData(frame, 0, 0)
    url = canvas.toDataURL('image/png')
  } catch (e) {
    url = ''
  }
  if (seq === previewSeq) cartoonPreviewUrl.value = url
  return url
}

/** 材料 / 分板 */
export const materials = computed(() =>
  (hasPattern.value ? materialList(pattern.value, inventory.value) : null)
)
/* 分板规格从图纸自己身上读（52 / 78 / 104 / 120 钉画线板，整张画布一种规格）；老图纸没有该字段时
   boardLayout 会按画布尺寸推导，29 / 58 / 116 这些老档位仍按 29 分板。 */
export const layout = computed(() => (hasPattern.value ? boardLayout(pattern.value.width, pattern.value.height, pattern.value.boardSize || BOARD_SIZE) : null))
export const stats = computed(() => {
  const p = pattern.value
  if (!p) return null
  /* 块数来自 boardLayout（按规格切），不是 options —— 画布可以跨不满整块，
     老存档（300 / 450）那种铺不满的也要如实算成 3 × 3 / 5 × 5 块。 */
  const lay = layout.value
  const s = p.stats || {}
  const cells = p.width * p.height
  const beads = s.beadCount != null ? s.beadCount : cells
  const bp = beadOf(p.beadKey || beadKey.value)
  /* 成品区域（成品尺寸滑杆控制的块）与画布（底板）分开报：
     图纸的 width/height 是画布，成品厘米只算成品区域那几格。 */
  const artW = Math.max(1, Math.min(p.artW || options.canvasW, p.width))
  const artH = Math.max(1, Math.min(p.artH || options.canvasH, p.height))
  const artCells = artW * artH
  const empty = Math.max(0, Math.min(s.emptyCount != null ? s.emptyCount : artCells - beads, artCells))
  return {
    size: `${p.width}×${p.height}`,
    width: p.width,
    height: p.height,
    artSize: `${artW}×${artH}`,
    artW,
    artH,
    sharePct: cells ? Math.round((artCells / cells) * 100) : 100,
    boards: lay ? lay.count : 1,
    boardText: lay ? boardsText(p.width, p.height, lay.boardSize) : '',
    beadLabel: bp.label,
    cm: `${(artW * bp.cm).toFixed(1)} × ${(artH * bp.cm).toFixed(1)} cm`,
    boardCm: `${(p.width * bp.cm).toFixed(1)} × ${(p.height * bp.cm).toFixed(1)} cm`,
    capacity: cells,
    cells,
    total: beads,
    emptyCount: empty,
    emptyPct: artCells ? Math.round((empty / artCells) * 100) : 0,
    padCells: Math.max(0, cells - artCells),
    colors: s.colorCount || 0,
    similarity: s.similarity || 0,
    similarityPct: Math.round((s.similarity || 0) * 100),
    deltaE: s.deltaE || 0,
    buildability: Math.round((s.buildability || 0) * 100),
    isolatedCount: s.isolatedCount || 0,
    smallRegionRatio: s.smallRegionRatio || 0,
    minutes: s.estimatedMinutes || 0,
    modeLabel: p.label || '好拼版',
    weight: `${Math.round(beads * (p.beadWeightG || BEAD_WEIGHT_G))} g`,
    notes: p.notes || []
  }
})

/* ------------------------------------------------------------------ 撤销重做

   为什么是一套「事务」而不是每次改一格就压栈：

   ① 按钮点了没反应的老毛病出在 canUndo 上 —— 早先只有 undo()/redo()/重置
      会刷新这两个标志，pushHistory() 自己不刷，于是画完格子 canUndo 仍是
      false，两个按钮永远停在 disabled 上（界面上就是「撤销/重做用不了」）。
      现在所有改动都走 beginEdit/endEdit，提交时才刷标志，不可能再脱节。

   ② 拖动画笔是一格一个 pointermove。按格压栈的话，随手划一道就是几十步，
      点一次撤销只退回一格，看着就像「撤销没生效」。所以一次操作 = 从按下到
      松开，中途的每一格共用同一个「操作前快照」，松手时统一提交。

   ③ 快照必须连**色板**一起存。recalcStats() 会把「一颗豆都没有」的颜色从
      色板里剪掉并重映射 cells 下标，ensurePaletteIndex() 又会往色板追加颜色。
      只存 cells 的话，撤销时旧下标会指到新色板的另一格上（颜色错乱），
      甚至越界取到 undefined。存整份 {cells, palette} 才能真正回退。

   ④ 空操作不留历史：点了一下原色、在同一格里拖动，cells 没变就不入栈，
      否则用户点「撤销」会看到画面纹丝不动，以为按钮坏了。
   ------------------------------------------------------------------ */

/* 撤销步数上限。小画布按步数（60 步足够用），大画布改成按**内存预算**折算：
   一份快照 = Int32Array(cells) + 色板，450×450 一张就是 810 KB、1000×1000 一张 4 MB，
   还是 60 步的话常驻 240 MB —— 手机浏览器会直接把标签页杀掉。
   16 MB 的预算下，116×116 仍然是满额 60 步，450×450 降到 19 步，1000×1000 只剩 4 步，
   换来的是「精细档下也能正常撤销，而不是越用越卡直到崩」。
   兜底步数从 8 降到 3：1000×1000 下 8 步就是 32 MB，比预算本身还高一倍，
   「至少有几步可退」的价值不值得拿 32 MB 去换。 */
const HISTORY_STEPS = 60
const HISTORY_BYTES = 16 * 1024 * 1024
const HISTORY_MIN_STEPS = 3

function historyLimit() {
  const cells = pattern.value && pattern.value.cells ? pattern.value.cells.length : 0
  if (!cells) return HISTORY_STEPS
  return Math.max(HISTORY_MIN_STEPS, Math.min(HISTORY_STEPS, Math.floor(HISTORY_BYTES / (cells * 4))))
}

export const canUndo = ref(false)
export const canRedo = ref(false)
/**
 * 这张图纸有没有被**手工改过**（画笔 / 橡皮 / 填充 / 吸色 / 镜像 / 换色）。
 *
 * 干什么用：改尺寸或改颜色数会重新生成图纸，把手工改的格子冲掉。
 * 参数重算前要拿它当保护条件（见 EditorSidebar 的改尺寸说明）。
 *
 * 为什么不用 undoDepth 判断：重新生成会清空历史栈，undoDepth 归零，
 * 但「这张图被手改过」这件事本身不会因为重新生成而消失（用户还是想保留那份结果）。
 * 重新生成 / 换方案 / 打开存档时由 clearHistory() 复位。
 */
export const manualEdited = ref(false)
/** 可撤销 / 可重做的步数：按钮 tooltip 上直接告诉用户攒了几步 */
export const undoDepth = ref(0)
export const redoDepth = ref(0)

function syncHistoryFlags() {
  undoDepth.value = undoStack.length
  redoDepth.value = redoStack.length
  canUndo.value = undoStack.length > 0
  canRedo.value = redoStack.length > 0
}

/** 取某个方案的完整快照（cells + 色板），用于回退 */
function snapshotOf(key) {
  const v = variants.value.find(x => x.key === key)
  if (!v) return null
  const t = v.active || v
  const palette = Array.from(t.palette || [])
  return {
    key: v.key,
    cells: Int32Array.from(t.cells),
    /* 色板（含顺序）必须一起存：cells 里放的是它的下标，见上面 ③ */
    palette,
    /* 手工修改记录跟着快照走：撤销回到哪一步，记录就回到那一步
       （否则「撤销掉的一笔」在换尺寸时又会被当成手工修改重新落回去） */
    edits: t.editMap instanceof Map ? new Map(t.editMap) : undefined,
    /* 修改层同样是不可变对象（每次改动都换新的一份），快照存引用就够 ——
       撤销时连修改层一起回退，否则「撤销掉的一笔」会在下次换尺寸时又落回去。 */
    editLayer: t.editLayer,
    /* 底稿是不可变对象（每次改动都换新的一份），快照直接存引用就够 ——
       撤销时连底稿一起回退，否则「撤销掉的一笔」会被下一次放大从底稿里带回来。 */
    master: t.master
  }
}

/** 快照与当前状态是否真有差别（空操作不入栈） */
function sameAsCurrent(snap) {
  const v = variants.value.find(x => x.key === snap.key)
  if (!v) return false
  const t = v.active || v
  const cells = t.cells
  if (!cells || cells.length !== snap.cells.length) return false
  for (let i = 0; i < cells.length; i++) if (cells[i] !== snap.cells[i]) return false
  const palette = t.palette || []
  if (palette.length !== snap.palette.length) return false
  for (let i = 0; i < palette.length; i++) if (palette[i].id !== snap.palette[i].id) return false
  return true
}

/* 未提交的「操作前快照」+ 嵌套深度。一次拖拽 = 一层，fillAt / 整色替换
   各自开一层，嵌套时复用最外层快照，谁最外层收尾谁提交。 */
let pendingSnap = null
let editDepth = 0

/**
 * 把这一笔相对「落笔前」的改动记进方案的**手工修改记录**（格子下标 → { id, color } | null，
 * null = 用户擦掉了这一格）。
 *
 * 干什么用：换尺寸时按原图重新取样（放大才长细节），取回来的是一张全新的机器图纸；
 * 这张记录就是「哪些格子是用户自己点的、点成了什么色」，新图纸生成后按比例把它们落回去
 * （见 setCanvasSize）。没有它，重新取样就会把手改覆盖掉。
 *
 * ⚠️ 必须在 flushPendingStats 之前调用：recalcStats 会修剪色板并重映射 cells 下标，
 * 之后再和落笔前的快照比，会把整张图都当成「改过」。
 */
function recordEdits(snap) {
  const v = variants.value.find(x => x.key === snap.key)
  if (!v) return
  const t = v.active || v
  const cur = t.cells
  if (!cur || cur.length !== snap.cells.length) return
  const art = artBoxOf(t)
  const sx = Math.floor((t.width - art.w) / 2)
  const sy = Math.floor((t.height - art.h) / 2)
  let map = null
  /* 这一笔的改动（成品区域相对坐标）：同时写进修改层。
     修改层记的是「改那一刻的尺寸」，换尺寸时按它自己的分辨率缩放（见 editLayer 的说明）。 */
  const diffs = []
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] === snap.cells[i]) continue
    if (!map) map = new Map(t.editMap || [])
    const k = cur[i]
    const color = k >= 0 ? t.palette[k] : null
    if (k >= 0 && !color) continue
    map.set(i, color ? { id: color.id, color } : null)
    const rx = (i % t.width) - sx
    const ry = Math.floor(i / t.width) - sy
    if (rx >= 0 && ry >= 0 && rx < art.w && ry < art.h) diffs.push({ rx, ry, color })
  }
  if (!map) return
  const idx = variants.value.findIndex(x => x.key === snap.key)
  const list = variants.value.slice()
  const baseLayer = t.editLayer && t.editLayer.mask ? t.editLayer : editLayerFromPattern(t)
  const editLayer = diffs.length ? writeEditsToLayer(baseLayer, art.w, art.h, diffs) : baseLayer
  /* 改过的格子同时写回底稿：没有源图时按块缩放还要靠它还原细节。 */
  const next = { ...t, editMap: map, editLayer, master: bakeEditsIntoMaster(t, map) }
  list[idx] = v.active ? { ...v, active: next } : next
  variants.value = list
}

/** 开始一次可撤销的编辑。可以嵌套：内层只记深度，不覆盖外层的快照
 * （拖拽时每个 pointermove 都会进一次，靠这个把一整笔合成一步）。
 */
export function beginEdit({ progress = false } = {}) {
  editDepth++
  if (editDepth === 1) {
    pendingSnap = snapshotOf(activeKey.value)
    /* 镜像会把格子整张挪位，拼制进度也要跟着回退；普通编辑不动进度，
       快照里就不带这个字段，免得撤销画笔时把后来打的勾也抹掉。 */
    if (pendingSnap && progress) pendingSnap.progress = Uint32Array.from(buildProgress.value)
  }
}

/**
 * 结束一次编辑。只有回到最外层才提交，并且要真有改动才入栈。
 * @returns {boolean} 这次编辑是否产生了一步历史
 */
export function endEdit() {
  if (editDepth === 0) return false
  editDepth--
  if (editDepth > 0) return false
  const snap = pendingSnap
  pendingSnap = null
  /* 先记手工修改记录，再补统计：统计会把色板修剪 + 重映射下标，之后比就不准了 */
  if (snap) recordEdits(snap)
  /* 挂起的统计重算在这里补上：整笔编辑期间只算这一次 */
  flushPendingStats()
  if (!snap || sameAsCurrent(snap)) return false
  undoStack.push(snap)
  if (undoStack.length > historyLimit()) undoStack.shift()
  redoStack.length = 0
  saveStatus.value = '未保存'
  /* 真的改动了 ⇒ 这张图纸带手工修改，模式切换 / 参数重算要拿它做保护判断 */
  manualEdited.value = true
  /* 空白画布上落下第一笔之后就不再是「还没画过的草稿」，
     切到图纸转换时要留着这张图，不能把它当成空状态清掉。 */
  clearBlankDraft()
  syncHistoryFlags()
  return true
}

/** 放弃这一层编辑（没有任何实际改动），不留下历史 */
export function cancelEdit() {
  if (editDepth === 0) return
  editDepth--
  if (editDepth === 0) {
    pendingSnap = null
    /* 指针被系统抢走时格子其实已经改过了，统计不能就这么停在旧值上 */
    flushPendingStats()
  }
}

/**
 * 放弃当前这一笔并恢复落笔前的画面。
 *
 * cancelEdit 只丢历史、不回滚格子（指针被系统抢走时是故意保留改动的）。
 * 触屏双指平移不一样：第一根手指落下时已经画了一格，第二根手指加入后
 * 这一格必须真的退回去，否则「想挪画布」会顺手在图纸上留一个点。
 */
export function revertEdit() {
  if (editDepth === 0) return false
  const snap = pendingSnap
  editDepth = 0
  pendingSnap = null
  if (!snap) return false
  const restored = applySnapshot(snap)
  if (!restored) flushPendingStats()
  return restored
}

/** 只清撤销 / 重做栈。格子整体挪位但图纸仍是用户手改的那张时用它（manualEdited 必须保留） */
function clearUndoStacks() {
  undoStack.length = 0
  redoStack.length = 0
  editDepth = 0
  pendingSnap = null
  syncHistoryFlags()
}

/** 清空历史（重新生成 / 换方案 / 打开存档时用：图纸换了，旧步骤没有意义） */
function clearHistory() {
  clearUndoStacks()
  /* 重新生成出来的图是「机器画的」，不带任何手工修改 */
  manualEdited.value = false
}

/** 挂起的统计重算（哪一份方案还没算），见 replaceCells 的说明 */
let pendingStatsKey = ''

/**
 * 把某个方案的 cells 替换掉（编辑 / 撤销都走这里）。
 *
 * `deferStats` 是关键：recalcStats 要整表扫三遍（死色统计 / 豆子数 / 可拼性），
 * 1000×1000（100 万格）下一次就是几百毫秒。拖笔时每个 pointermove 都会调用它，
 * 逐格都重算的话画一笔要好几秒、手指跟画面对不上。所以一笔之内先只换 cells
 * （画面立刻正确），统计等这一笔收尾时算一次（见 endEdit 的 flushPendingStats）。
 */
function replaceCells(key, cells, { deferStats = false } = {}) {
  const idx = variants.value.findIndex(v => v.key === key)
  if (idx < 0) return false
  const v = variants.value[idx]
  const target = v.active || v
  const next = { ...target, cells: Int32Array.from(cells) }
  // 重算统计，保持「统计与数据一致」
  if (deferStats) pendingStatsKey = key
  else recalcStats(next)
  const list = variants.value.slice()
  list[idx] = { ...v, active: next }
  variants.value = list
  return true
}

/** 把挂起的统计补算掉。没有挂起就是空操作，所以可以随便调 */
function flushPendingStats() {
  const key = pendingStatsKey
  pendingStatsKey = ''
  if (!key) return
  const idx = variants.value.findIndex(v => v.key === key)
  if (idx < 0) return
  const v = variants.value[idx]
  const target = v.active || v
  recalcStats(target)
  const list = variants.value.slice()
  list[idx] = { ...v, active: { ...target } }
  variants.value = list
}

/** 用快照整体还原一个方案（撤销 / 重做都走这里） */
function applySnapshot(snap) {
  const idx = variants.value.findIndex(v => v.key === snap.key)
  if (idx < 0) return false
  const v = variants.value[idx]
  const target = v.active || v
  /* 画布尺寸变了就不认这条快照：格子对不上，硬套会得到一张和底板不符的图纸 */
  if (!target.cells || target.cells.length !== snap.cells.length) return false
  const next = {
    ...target,
    cells: Int32Array.from(snap.cells),
    palette: snap.palette.slice(),
    colors: snap.palette.map(c => c.id),
    /* 撤销 / 重做连手工修改记录与修改层一起回退（见 snapshotOf 的说明） */
    editMap: snap.edits ? new Map(snap.edits) : undefined,
    editLayer: snap.editLayer,
    master: snap.master
  }
  recalcStats(next)
  const list = variants.value.slice()
  list[idx] = { ...v, active: next }
  variants.value = list
  /* 只有镜像这类会移动格子的快照才带进度；普通编辑不带，撤销时不能碰进度 */
  if (snap.progress) buildProgress.value = new Set(snap.progress)
  return true
}

/** 撤销。返回是否真的退了一步（快捷键那边靠它决定要不要 preventDefault） */
export function undo() {
  /* 拖笔 / 换色预览这类开着的事务不能被撤销插进来：
     否则会把「改到一半」的中间态写进历史，收口时快照对不上 */
  if (editDepth > 0) return false
  while (undoStack.length) {
    const snap = undoStack.pop()
    const current = snapshotOf(snap.key)
    /* 镜像的快照带着「翻之前」的拼制进度；重做要回到翻之后的那一份 */
    const progressNow = snap.progress ? Uint32Array.from(buildProgress.value) : null
    if (!applySnapshot(snap)) continue
    /* 重做要回到「刚撤销掉的那个状态」，所以先记当前状态再还原 */
    if (current) {
      if (progressNow) current.progress = progressNow
      redoStack.push(current)
    }
    /* 正常情况下历史只属于当前方案（换方案会清空历史）；
       万一真出现跨方案的历史，就跟着切过去，免得「撤销了但画面没动」 */
    if (snap.key !== activeKey.value && variants.value.some(x => x.key === snap.key)) {
      activeKey.value = snap.key
    }
    saveStatus.value = '未保存'
    syncHistoryFlags()
    return true
  }
  syncHistoryFlags()
  return false
}

/** 重做 */
export function redo() {
  if (editDepth > 0) return false
  while (redoStack.length) {
    const snap = redoStack.pop()
    const current = snapshotOf(snap.key)
    const progressNow = snap.progress ? Uint32Array.from(buildProgress.value) : null
    if (!applySnapshot(snap)) continue
    if (current) {
      if (progressNow) current.progress = progressNow
      undoStack.push(current)
    }
    if (snap.key !== activeKey.value && variants.value.some(x => x.key === snap.key)) {
      activeKey.value = snap.key
    }
    saveStatus.value = '未保存'
    syncHistoryFlags()
    return true
  }
  syncHistoryFlags()
  return false
}

function recalcStats(p) {
  /* 先修剪色板：手动擦掉某种颜色之后，色板里会留下"一颗豆都没有"的死色，
     统计与材料表都会跟着错。这里把死色去掉并重映射索引，保证数据自洽。 */
  const used = new Int32Array(p.palette.length)
  for (let i = 0; i < p.cells.length; i++) {
    const k = p.cells[i]
    if (k >= 0) used[k]++
  }
  let dead = 0
  for (let i = 0; i < used.length; i++) if (!used[i]) dead++
  if (dead) {
    const keepMap = new Int32Array(p.palette.length).fill(-1)
    const palette = []
    for (let i = 0; i < p.palette.length; i++) {
      if (!used[i]) continue
      keepMap[i] = palette.length
      palette.push(p.palette[i])
    }
    if (palette.length) {
      const cells = new Int32Array(p.cells.length)
      for (let i = 0; i < p.cells.length; i++) {
        const k = p.cells[i]
        cells[i] = k < 0 ? EMPTY : keepMap[k]
      }
      p.cells = cells
      p.palette = palette
      p.colors = palette.map(c => c.id)
    }
  }
  const beads = beadCountOf(p.cells)
  const build = buildability(p.cells, p.width, p.height, p.palette.length)
  /* 空格只数成品区域里的：画布四周的留白不是「去背景」，不该进这个数字 */
  const { w: aw, h: ah } = artBoxOf(p)
  const ox = Math.floor((p.width - aw) / 2)
  const oy = Math.floor((p.height - ah) / 2)
  let artEmpty = 0
  for (let y = 0; y < ah; y++) {
    const row = (oy + y) * p.width + ox
    for (let x = 0; x < aw; x++) if (p.cells[row + x] < 0) artEmpty++
  }
  const artCells = aw * ah
  p.stats = {
    ...p.stats,
    beadCount: beads,
    cellCount: p.cells.length,
    emptyCount: artEmpty,
    emptyRatio: artCells ? Math.round((artEmpty / artCells) * 1000) / 1000 : 0,
    padCount: p.cells.length - artCells,
    colorCount: p.palette.length,
    buildability: build.score / 100,
    isolatedCount: build.isolatedCount,
    smallRegionRatio: Math.round(build.smallRegionRatio * 1000) / 1000,
    estimatedMinutes: estimateMinutes(beads, build.score)
  }
}

/* ------------------------------------------------------------------ 编辑 */

/** 改一格的调色板下标。@returns {boolean} 是否真的改动了（没变就没必要记历史） */
function setCell(index, paletteIndex) {
  const p = pattern.value
  if (!p || index < 0 || index >= p.cells.length) return false
  if (p.cells[index] === paletteIndex) return false
  const cells = Int32Array.from(p.cells)
  cells[index] = paletteIndex
  /* 在编辑事务里（拖笔 / 整色替换）先不算统计，收尾时算一次，见 replaceCells */
  return replaceCells(activeKey.value, cells, { deferStats: editDepth > 0 })
}

function ensurePaletteIndex(color) {
  const p = pattern.value
  if (!p || !color) return -1
  let i = p.palette.findIndex(c => c.id === color.id)
  if (i >= 0) return i
  // 颜色不在当前图案色板里：追加进去（保证编辑可逆、统计正确）
  const list = [...p.palette, color]
  const idx = variants.value.findIndex(v => v.key === activeKey.value)
  if (idx >= 0) {
    const v = variants.value[idx]
    const target = { ...(v.active || v), palette: list, colors: list.map(c => c.id) }
    const l = variants.value.slice()
    l[idx] = { ...v, active: target }
    variants.value = l
  }
  return list.length - 1
}

/**
 * 自由画布的空白图纸：整板都是空格，左侧编辑工具可以直接往上画。
 * 已经有图纸（上传生成的、打开的存档、或者已经画过的）时什么都不做。
 * @returns {boolean} 这次是不是新铺了一张空白图纸
 */
export function ensureBlankCanvas() {
  if (pattern.value && pattern.value.cells && pattern.value.cells.length) return false
  const cw = canvasCapW.value
  const ch = canvasCapH.value
  const aw = Math.max(1, Math.min(options.canvasW, cw))
  const ah = Math.max(1, Math.min(options.canvasH, ch))
  const bw = Math.max(cw, aw)
  const bh = Math.max(ch, ah)
  const cells = new Int32Array(bw * bh).fill(EMPTY)
  const p = {
    version: PATTERN_VERSION,
    key: 'easy',
    label: '好拼版',
    tagline: '自由画布',
    width: bw,
    height: bh,
    artW: aw,
    artH: ah,
    brandId: options.brandId,
    ...patternProfile(bw, bh, boardProfile(bw, bh), options.beadKey || autoBeadKey(bw, bh)),
    cells,
    palette: [],
    colors: [],
    /* 还没画过：切到图纸转换时收起，把上传卡让出来 */
    blankDraft: true,
    stats: {
      beadCount: 0,
      cellCount: cells.length,
      emptyCount: aw * ah,
      emptyRatio: 1,
      padCount: cells.length - aw * ah,
      colorCount: 0,
      similarity: 0,
      deltaE: 0,
      buildability: 1,
      isolatedCount: 0,
      smallRegionRatio: 0,
      estimatedMinutes: 0
    },
    notes: []
  }
  variants.value = [p]
  activeKey.value = 'easy'
  clearHistory()
  if (!brushColorId.value && availableColors.value.length) {
    brushColorId.value = availableColors.value[0].id
  }
  currentView.value = 'pattern'
  return true
}

/** 空白草稿还一笔没画：从自由画布切到图纸转换时收起，上传卡才能出来 */
export function discardBlankDraft() {
  const p = pattern.value
  if (!p || !p.blankDraft) return false
  if (beadCountOf(p.cells) > 0) return false
  variants.value = []
  clearHistory()
  return true
}

function clearBlankDraft() {
  const idx = variants.value.findIndex(v => v.key === activeKey.value)
  if (idx < 0) return
  const v = variants.value[idx]
  const t = v.active || v
  if (!t.blankDraft && !v.blankDraft) return
  const next = { ...t, blankDraft: false }
  const list = variants.value.slice()
  list[idx] = v.active ? { ...v, blankDraft: false, active: next } : next
  variants.value = list
}

/* ---------------------------------------------------------------- 两套独立文档
   自由画布与图纸转换各存一份文档。切换模式时把当前这份收进它的槽位、
   把目标模式那份放回来（没有就新建：自由画布铺空白网格，图纸转换留给上传卡）。
   不这样做的话，图纸转换导入的图片 / 生成的图纸会一直留在同一个工作区里，
   切到自由画布看到的还是那张转换出来的图。 */

function captureWorkspace() {
  return {
    variants: variants.value,
    activeKey: activeKey.value,
    canvasW: options.canvasW,
    canvasH: options.canvasH,
    canvasMaxW: options.canvasMaxW,
    canvasMaxH: options.canvasMaxH,
    projectName: projectName.value,
    currentProjectId: currentProjectId.value,
    saveStatus: saveStatus.value,
    sourceImg: sourceImg.value,
    sourceUrl: sourceUrl.value,
    sourceName: sourceName.value,
    sourceKind: sourceKind.value,
    sourceAspect: sourceAspect.value,
    sourceFromPattern: sourceFromPattern.value,
    sourceSnapshot,
    rebuildSourceGrid,
    manualEdited: manualEdited.value,
    buildProgress: buildProgress.value,
    currentView: currentView.value
  }
}

function applyWorkspace(snap) {
  if (!snap) return false
  cancelColorReplace()
  /* 画布尺寸先落回去：图纸的 width/height 与成品区域都要跟它一致 */
  options.canvasW = snap.canvasW
  options.canvasH = snap.canvasH
  options.canvasMaxW = snap.canvasMaxW
  options.canvasMaxH = snap.canvasMaxH
  variants.value = snap.variants
  activeKey.value = snap.activeKey
  projectName.value = snap.projectName
  currentProjectId.value = snap.currentProjectId
  saveStatus.value = snap.saveStatus
  sourceImg.value = snap.sourceImg
  sourceUrl.value = snap.sourceUrl
  sourceName.value = snap.sourceName
  sourceKind.value = snap.sourceKind
  sourceAspect.value = snap.sourceAspect
  sourceFromPattern.value = snap.sourceFromPattern
  sourceSnapshot = snap.sourceSnapshot
  rebuildSourceGrid = snap.rebuildSourceGrid
  buildProgress.value = snap.buildProgress
  fitNotice.value = null
  cartoonPreviewUrl.value = ''
  previewMode.value = 'source'
  currentView.value = snap.currentView
  /* 撤销栈记的是另一份图纸的格子，跨文档没有意义 */
  clearHistory()
  /* clearHistory 会把「手改过」标记清掉，这里按存档恢复 */
  manualEdited.value = snap.manualEdited
  return true
}

/** 清空工作区，按需铺一张自由画布的空白网格（图纸转换则留给上传卡） */
export function resetWorkspace({ blank = false } = {}) {
  cancelColorReplace()
  variants.value = []
  activeKey.value = 'easy'
  projectName.value = '我的拼豆作品'
  currentProjectId.value = ''
  saveStatus.value = '未保存'
  sourceImg.value = null
  sourceUrl.value = ''
  sourceName.value = ''
  sourceKind.value = 'raster'
  sourceAspect.value = 1
  sourceFromPattern.value = false
  sourceSnapshot = null
  rebuildSourceGrid = null
  buildProgress.value = new Set()
  fitNotice.value = null
  cartoonPreviewUrl.value = ''
  previewMode.value = 'source'
  clearHistory()
  manualEdited.value = false
  currentView.value = blank ? 'pattern' : 'original'
  if (blank) ensureBlankCanvas()
  return true
}

/** 把当前内存里的文档收进它所属模式的槽位（打开存档前调用，别让另一模式的作品被覆盖） */
export function stashCurrentWorkspace() {
  modeWorkspaces[workspaceMode.value] = captureWorkspace()
}

/**
 * 导入图像（上传 / 拖图 / 素材库）一律写进「图纸转换」那份文档：
 * 当前在自由画布时先把自由画布收进它的槽位，再切过去。
 */
function enterConversionWorkspace() {
  if (workspaceMode.value === 'edit') return
  stashCurrentWorkspace()
  workspaceMode.value = 'edit'
  createMode.value = 'edit'
  if (!applyWorkspace(modeWorkspaces.edit)) resetWorkspace({ blank: false })
}

/**
 * 切换创作模式：收好当前文档，放回目标模式的文档。
 * @param {'free'|'edit'} mode
 * @param {{blankFree?: boolean}} opts blankFree = 自由画布没有文档时铺不铺空白网格
 *        （全屏 / 手机工作台铺；平板旧版面没有模式开关，保持原来的上传引导）
 * @returns {boolean} 是否真的换了模式
 */
export function switchCreateMode(mode, { blankFree = true } = {}) {
  const target = mode === 'edit' ? 'edit' : 'free'
  if (workspaceMode.value === target) {
    createMode.value = target
    return false
  }
  modeWorkspaces[workspaceMode.value] = captureWorkspace()
  workspaceMode.value = target
  createMode.value = target
  const snap = modeWorkspaces[target]
  if (snap) applyWorkspace(snap)
  else resetWorkspace({ blank: target === 'free' && blankFree })
  return true
}

/**
 * 进入工作台 / 打开某件存档时把「当前文档」对齐到指定模式。
 * @param {'free'|'edit'} mode
 * @param {{blankFree?: boolean, loaded?: boolean}} opts
 *        loaded = true 表示当前内存里的文档就是刚打开的那件存档（不要再用槽位覆盖它）
 */
export function activateCreateMode(mode, { blankFree = true, loaded = false } = {}) {
  const target = mode === 'edit' ? 'edit' : 'free'
  const prev = workspaceMode.value
  if (prev !== target) {
    /* 当前这份属于另一种模式：先收好，否则会被目标模式的文档盖掉 */
    if (!loaded) modeWorkspaces[prev] = captureWorkspace()
    workspaceMode.value = target
    createMode.value = target
    if (loaded) {
      modeWorkspaces[target] = null
      return true
    }
    const snap = modeWorkspaces[target]
    if (snap) applyWorkspace(snap)
    else resetWorkspace({ blank: target === 'free' && blankFree })
    return true
  }
  createMode.value = target
  if (loaded) {
    /* 刚打开的存档就是当前文档，槽位里那份旧文档作废 */
    modeWorkspaces[target] = null
    return false
  }
  /* 当前没有文档（刚进页面 / 上次留下的只有一份失效的作品关联）：
     有槽位就放回来，没有就按目标模式新建，顺手把 currentProjectId 清干净 */
  if (!hasPattern.value) {
    const snap = modeWorkspaces[target]
    if (snap) applyWorkspace(snap)
    else resetWorkspace({ blank: target === 'free' && blankFree })
    return true
  }
  if (target === 'free' && blankFree) ensureBlankCanvas()
  return false
}

export function paintAt(x, y, { record = true } = {}) {
  const p = pattern.value
  if (!p) return false
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return false
  /* 自己开一层事务：单次调用（脚本 / 键盘）也是一步；拖拽时它被外层包住，
     内层只累加深度，一整笔到最后一起提交 */
  if (record) beginEdit()
  try {
    /* 笔刷是以点中的格子为中心的方形：size=1 时就是原来的单格。
       先定好颜色索引，再一次性改完再提交 —— 大笔刷逐格 setCell 会反复
       复制整张 cells（1000×1000 时每次 4MB），拖动会明显卡。 */
    let pi = EMPTY
    if (tool.value !== 'erase') {
      const color = getColorByIdSafe(brushColorId.value) || p.palette[p.palette.length - 1]
      if (!color) return false
      pi = ensurePaletteIndex(color)
      if (pi < 0) return false
    }
    /* 画笔与橡皮各用各的尺寸：橡皮擦一大片不该把画笔也撑大 */
    const size = Math.min(BRUSH_MAX, Math.max(1, Math.round(toolSizeOf(tool.value)) || 1))
    const half = Math.floor(size / 2)
    const startX = Math.max(0, x - half)
    const startY = Math.max(0, y - half)
    const endX = Math.min(p.width, startX + size)
    const endY = Math.min(p.height, startY + size)
    const cells = Int32Array.from(p.cells)
    let changed = false
    for (let yy = startY; yy < endY; yy++) {
      for (let xx = startX; xx < endX; xx++) {
        const i = yy * p.width + xx
        if (cells[i] === pi) continue
        cells[i] = pi
        changed = true
      }
    }
    if (!changed) return false
    return replaceCells(activeKey.value, cells, { deferStats: editDepth > 0 })
  } finally {
    if (record) endEdit()
  }
}

/** 橡皮的语义在 pattern.js 里由 EMPTY 表达（不放豆），这里不再需要"最浅色"的兜底 */

function getColorByIdSafe(id) {
  if (!id) return null
  const p = pattern.value
  const hit = p && p.palette.find(c => c.id === id)
  return hit || getColorById(id)
}

/** 油漆桶：把相连的同色区域整体替换 */
export function fillAt(x, y) {
  const p = pattern.value
  if (!p) return 0
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return 0
  const target = p.cells[y * p.width + x]
  const color = getColorByIdSafe(brushColorId.value)
  if (!color) return 0

  /* 快照要在 ensurePaletteIndex 可能追加色号之前拿，撤销才能回到本来的色板 */
  beginEdit()
  const pi = ensurePaletteIndex(color)
  if (pi < 0 || pi === target) { cancelEdit(); return 0 }
  const cur = pattern.value
  const cells = Int32Array.from(cur.cells)
  const w = cur.width
  const h = cur.height
  const stack = [y * w + x]
  let changed = 0
  const seen = new Uint8Array(cells.length)
  while (stack.length) {
    const i = stack.pop()
    if (seen[i]) continue
    seen[i] = 1
    if (cells[i] !== target) continue
    cells[i] = pi
    changed++
    const cx = i % w
    const cy = (i - cx) / w
    if (cx > 0) stack.push(i - 1)
    if (cx < w - 1) stack.push(i + 1)
    if (cy > 0) stack.push(i - w)
    if (cy < h - 1) stack.push(i + w)
  }
  if (!changed) { cancelEdit(); return 0 }
  replaceCells(activeKey.value, cells)
  endEdit()
  return changed
}

/** 整色替换（PRD P0 编辑：颜色替换） */
export function replaceColorEverywhere(fromId, toColor) {
  const p = pattern.value
  if (!p || !toColor) return 0
  const fromIndex = p.palette.findIndex(c => c.id === fromId)
  if (fromIndex < 0) return 0
  beginEdit()
  const toIndex = ensurePaletteIndex(toColor)
  if (toIndex < 0) { cancelEdit(); return 0 }
  const cur = pattern.value
  const cells = Int32Array.from(cur.cells)
  let n = 0
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === fromIndex) { cells[i] = toIndex; n++ }
  }
  if (!n) { cancelEdit(); return 0 }
  replaceCells(activeKey.value, cells)
  endEdit()
  return n
}

/* ---------------- 换色弹窗：整色替换 + 实时预览（未点「替换」前随时可取消） ---------------- */

/** 换色弹窗状态。null = 关闭；{ fromId, toId } = 打开中（toId 空串 = 还没选目标色） */
export const colorReplace = ref(null)
/** 当前预览里会被替换掉的豆子数（0 = 还没选目标色） */
export const colorReplaceCount = ref(0)
/* 打开弹窗那一刻的画面（cells + 色板）。预览与取消都以它为底。
   预览期间编辑事务一直开着（openColorReplace 里 beginEdit）：确认时整次替换
   收成一步可撤销历史，取消时 revertEdit 整体回滚 —— 翻着试几个目标色
   也只会在历史上留一步（或者一步都不留）。 */
let colorReplaceBase = null

/** 打开换色弹窗，fromId 是要被替换掉的颜色。 */
export function openColorReplace(fromId) {
  if (colorReplace.value) cancelColorReplace()
  const p = pattern.value
  if (!p || !p.palette.some(c => c.id === fromId)) return false
  colorReplaceBase = {
    key: activeKey.value,
    cells: Int32Array.from(p.cells),
    palette: p.palette.slice()
  }
  colorReplace.value = { fromId, toId: '' }
  colorReplaceCount.value = 0
  /* 事务必须在预览动手之前开，快照才是「替换前」的画面 */
  beginEdit()
  return true
}

/** 回到打开弹窗时的画面（还没选目标色 / 清掉目标色时）。 */
function colorReplaceRestoreBase() {
  const base = colorReplaceBase
  if (!base) return
  /* deferStats：预览是连续动作，统计等确认 / 取消收尾时算一次（见 replaceCells）。
     这同时保证预览期间色板只增不减 —— base.cells 的下标始终有效。 */
  replaceCells(base.key, base.cells, { deferStats: true })
}

/** 选了目标色就实时预览。传 null / 原色自己 = 清掉预览。@returns 替换掉的豆子数 */
export function previewColorReplace(toColor) {
  const st = colorReplace.value
  const base = colorReplaceBase
  if (!st || !base) return 0
  if (!toColor || toColor.id === st.fromId) {
    st.toId = ''
    colorReplaceCount.value = 0
    colorReplaceRestoreBase()
    return 0
  }
  const fromIndex = base.palette.findIndex(c => c.id === st.fromId)
  if (fromIndex < 0) return 0
  const toIndex = ensurePaletteIndex(toColor)
  if (toIndex < 0) return 0
  /* 每次都从打开时的画面重新映射：换目标色不会叠在上一次预览上 */
  const mapped = Int32Array.from(base.cells)
  let n = 0
  for (let i = 0; i < mapped.length; i++) {
    if (mapped[i] === fromIndex) { mapped[i] = toIndex; n++ }
  }
  st.toId = toColor.id
  colorReplaceCount.value = n
  if (n) replaceCells(base.key, mapped, { deferStats: true })
  else colorReplaceRestoreBase()
  return n
}

/** 确认替换：画面已经是预览结果，这里只负责把事务收口成一步历史。 */
export function confirmColorReplace() {
  const st = colorReplace.value
  if (!st || !st.toId) { cancelColorReplace(); return 0 }
  const n = colorReplaceCount.value
  colorReplace.value = null
  colorReplaceBase = null
  endEdit()
  return n
}

/** 取消换色：画面回到打开弹窗前，不留任何历史。 */
export function cancelColorReplace() {
  if (!colorReplace.value) return
  colorReplace.value = null
  colorReplaceBase = null
  revertEdit()
}

/**
 * 去除杂色：把整张图里「孤零零一颗、四周全是别的颜色」的豆并进四周出现最多的颜色。
 * 判定口径与自动生成时的去孤立豆完全一致（`cleanupIsolated`，ΔE00 ≤ 18 才并），
 * 所以手动点一次不会把有意留的点状细节吃掉。
 * 和其它编辑一样是一步可撤销的操作；统计要重算（可能少一个色号）。
 * @returns 实际改掉的颗数（0 = 没有找到杂色）
 */
export function removeSpecks(maxDE = CLEANUP_MAX_DE) {
  const p = pattern.value
  if (!p || !p.cells || !p.cells.length) return 0
  const labs = p.palette.map(c => hexToLab(c.hex))
  beginEdit()
  const { idx, changed } = cleanupIsolated(p.cells, p.width, p.height, labs, maxDE)
  if (!changed) { cancelEdit(); return 0 }
  replaceCells(activeKey.value, idx)
  endEdit()
  return changed
}

/**
 * 镜像：整张图纸按水平 / 垂直中轴翻转（axis: 'h' 左右，'v' 上下）。
 * 和其它编辑一样是一步可撤销的操作，统计不用重算（色板没变）。
 */
export function mirrorPattern(axis = 'h') {
  const p = pattern.value
  if (!p || !p.cells || !p.cells.length) return false
  const w = p.width
  const h = p.height
  if (!w || !h || p.cells.length !== w * h) return false

  beginEdit({ progress: true })
  const cells = p.cells
  const next = new Int32Array(cells.length)
  if (axis === 'v') {
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w
      next.set(cells.subarray(src, src + w), y * w)
    }
  } else {
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) next[row + x] = cells[row + (w - 1 - x)]
    }
  }
  replaceCells(activeKey.value, next, { deferStats: true })
  const changed = endEdit()
  /* 对称图案翻完还是同一张图，没有产生历史，进度也不该动 */
  if (!changed) return false

  /* 拼制进度是按下标记的：图纸翻了，打勾的位置也要跟着走，否则「已完成」
     会落在别的豆子上。撤销时由快照里的 progress 把它翻回原样。 */
  const progress = buildProgress.value
  if (progress.size) {
    const moved = new Set()
    for (const i of progress) {
      const x = i % w
      const y = (i - x) / w
      moved.add(axis === 'v' ? (h - 1 - y) * w + x : y * w + (w - 1 - x))
    }
    buildProgress.value = moved
  }
  return true
}

/** 吸色：把点击处的颜色设为当前画笔色（空格上没有颜色，保持画笔不变） */
export function pickAt(x, y) {
  const p = pattern.value
  if (!p) return null
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return null
  const k = p.cells[y * p.width + x]
  if (k < 0) return null
  const c = p.palette[k]
  if (c) brushColorId.value = c.id
  return c || null
}

/* ------------------------------------------------------------------ 生成 */

export const variantCount = computed(() => {
  const r = check('generate.variants', 3)
  return r.ok && r.value ? 3 : 1
})

/* ------------------------------------------------- 图纸调整（亮度 / 对比度 / 饱和度）
   设计稿「图纸调整」面板里的原图调整：三个滑杆都是 -100 ~ +100，0 = 原样。
   预览用 CSS filter（画布上的原图直接套），生成时把同一组滤镜烘焙成一张位图再取样 ——
   两边用的是同一个换算，看到什么就生成什么。 */
export const sourceFilter = reactive({ brightness: 0, contrast: 0, saturation: 0 })

export const sourceFilterActive = computed(() =>
  !!(sourceFilter.brightness || sourceFilter.contrast || sourceFilter.saturation))

export const sourceCssFilter = computed(() => {
  const f = []
  if (sourceFilter.brightness) f.push(`brightness(${1 + sourceFilter.brightness / 100})`)
  if (sourceFilter.contrast) f.push(`contrast(${1 + sourceFilter.contrast / 100})`)
  if (sourceFilter.saturation) f.push(`saturate(${1 + sourceFilter.saturation / 100})`)
  return f.length ? f.join(' ') : 'none'
})

let filterCache = { key: '', img: null }
function filteredSource() {
  const img = sourceImg.value
  if (!img || !sourceFilterActive.value) return img
  const key = `${sourceFilter.brightness}|${sourceFilter.contrast}|${sourceFilter.saturation}|${sourceUrl.value}`
  if (filterCache.key === key) return filterCache.img
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) return img
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.filter = sourceCssFilter.value
  ctx.drawImage(img, 0, 0, w, h)
  filterCache = { key, img: c }
  return c
}

export function resetSourceFilter() {
  sourceFilter.brightness = 0
  sourceFilter.contrast = 0
  sourceFilter.saturation = 0
}

function sourceImage() {
  return filteredSource()
}

/**
 * 让浏览器先把「生成中」那一帧画出来，再去跑同步的重活。
 *
 * 为什么需要：1000×1000 生成三个方案要 4~5 秒，而且全在主线程上同步跑 ——
 * 不在之前让出一帧的话，`generating = true` 引发的 DOM 更新要等这段同步代码
 * 跑完才有机会上屏，用户看到的是「点了没反应，几秒后突然出图」，
 * 界面里那两个 spinner（左栏「正在生成方案…」、顶栏「生成中」）永远画不出来。
 *
 * 只在动手前调用，不改变任何生成逻辑；调用方（左栏的尺寸 / 色号 / 色板入口）
 * 自己决定要不要 await。
 */
export async function yieldForBusyPaint() {
  generating.value = true
  await nextTick()
  await new Promise(r => requestAnimationFrame(r))
}

/** 根据当前参数跑一次生成（会替换掉现有三方案） */
export function regenerate({ silent = false, keys } = {}) {
  const img = sourceImage()
  if (!img) {
    if (!silent) toastWarn('请先上传图片，或从素材中心挑一个图案')
    return false
  }
  generating.value = true
  const t0 = performance.now()
  const prevArt = [options.canvasW, options.canvasH]
  try {
    const wantAll = keys || (variantCount.value >= 3 ? ['high', 'easy', 'art'] : ['easy'])
    /* gw/gh = **成品区域**（成品尺寸滑杆控制的那块），不是画布本身 */
    const gw = Math.min(options.canvasW, maxCells.value, canvasCapW.value)
    const gh = Math.min(options.canvasH, maxCells.value, canvasCapH.value)
    if (gw !== options.canvasW) options.canvasW = gw
    if (gh !== options.canvasH) options.canvasH = gh
    /* 画布（底板）：成品区域居中贴进去，四周留空 */
    const cw = canvasCapW.value
    const ch = canvasCapH.value

    const colors = availableColors.value
    const res = runVariants({
      img,
      gw,
      gh,
      fit: options.fit,
      targetColors: options.targetColors,
      brandId: options.brandId,
      colors,
      variantKeys: wantAll,
      removeBg: options.removeBg,
      matteLevel: options.matteLevel,
      /* 板规格与豆径按**画布（底板）**定：图纸自己记住口径（分板线 / 成品厘米 / 1:1 打印都用它），
         成品区域缩小不会让底板变成另一种板 */
      boardSize: boardProfile(cw, ch),
      beadKey: options.beadKey || autoBeadKey(cw, ch),
      /** 空串 = 不做卡通化（照片直接出图的原始路线） */
      cartoonStyle: options.cartoon ? options.cartoonStyle : '',
      /** 图纸重建的源图 + 没缩小 ⇒ 最近邻采样（颜色一格不错，见 sourceNearestOpt） */
      sourceNearest: sourceNearestOpt(gw, gh)
    })

    // 应用库存约束（若开启且用户确有库存）
    const invColors = inventoryColors.value
    const invMap = inventory.value
    const wantInv = useInventory.value && invColors.length > 0
    const list = res.patterns.map(p => {
      const base = wantInv
        ? (() => {
            const r = applyInventory(p, invColors, invMap, inventoryMode.value)
            return { ...r.pattern, key: p.key, label: p.label, tagline: p.tagline, desc: p.desc, recommended: p.recommended, compare: p.compare, inventoryApplied: r.applied }
          })()
        : { ...p, inventoryApplied: false }
      return padToCanvas(base, cw, ch)
    })

    let recommendedKey = res.recommendedKey
    /* 照片路线默认给「高还原」：推荐打分里可拼性权重 0.44，照片在大画布 + 多色号下必然
       被算成"不好拼"，于是默认推荐会落到色号最少的那一版 —— 而用户上传照片要的恰恰是"像"。
       只在新上传一张照片后的第一次生成里强制生效，用户自己切过方案之后就尊重他的选择。 */
    let forceKey = ''
    if (preferDetail.value && list.some(p => p.key === 'high')) {
      recommendedKey = 'high'
      forceKey = 'high'
      preferDetail.value = false
    }
    // 库存约束下重算推荐：以「补购颗数最少」为优先
    if (wantInv && inventoryMode.value !== 'best') {
      let best = list[0]
      let bestScore = Infinity
      for (const p of list) {
        /* 补购颗数项乘 100 是为了让它压过豆子数与可拼性两项。 */
        const mats = materialList(p, invMap)
        const score = mats.totalLack * 100 + p.stats.beadCount * 0.02 - p.stats.buildability * 50
        if (score < bestScore) { bestScore = score; best = p }
      }
      recommendedKey = best.key
    }

    variants.value = list.map(p => ({ ...p, recommended: p.key === recommendedKey }))
    if (forceKey) {
      activeKey.value = forceKey
    } else if (!variants.value.some(v => v.key === activeKey.value)) {
      activeKey.value = recommendedKey
    }
    /* 成品区域变了（画布没变），旧的拼制进度下标对应的是另一张网格：
       留着它会让进度条显示一个跟当前图纸无关的百分比，
       完成过的作品更会变成「已完成但格子对不上」。 */
    if (prevArt && (options.canvasW !== prevArt[0] || options.canvasH !== prevArt[1]) && buildProgress.value.size) {
      buildProgress.value = new Set()
      /* silent 是「调用方自己负责反馈」：手机上传时画布上方已经有紧凑提示卡，
         再来一条长 toast 会把画布中央盖住。 */
      if (!silent) toast('成品尺寸变了，拼制进度已重置', 'warn')
    }
    lastSearch.value = {
      candidates: list.length,
      recommendedKey,
      at: Date.now(),
      inventoryApplied: wantInv,
      inventoryMode: wantInv ? inventoryMode.value : null
    }
    clearHistory()
    genMs.value = Math.round(performance.now() - t0)
    saveStatus.value = '未保存'
    trackUsage('generated')
    trackEvent('pattern.generate')
    if (options.removeBg) trackEvent('pattern.matte')
    if (!silent) {
      const rec = list.find(p => p.key === recommendedKey)
      const m = list[0] && list[0].matte
      const detailNote = forceKey === 'high' ? '，照片默认给「高还原」（还原度优先；想省力可切「好拼版」）' : ''
      if (options.removeBg && m && !m.applied) {
        toastWarn(`已生成方案，但抠背景没生效：${m.reason || '未检测到明显背景'}`)
      } else if (options.removeBg && m) {
        toastOk(`已生成 ${list.length} 个方案，去掉了约 ${Math.round((m.bgShare || 0) * 100)}% 的背景${detailNote}（${genMs.value}ms）`)
      } else if (m && m.auto && m.applied) {
        toastOk(`已生成 ${list.length} 个方案：源图自带透明背景，透明处已留空不放豆${detailNote}（${genMs.value}ms）`)
      } else {
        toastOk(`已生成 ${list.length} 个方案，推荐「${rec ? rec.label : ''}」${detailNote}（${genMs.value}ms）`)
      }
    }
    return true
  } catch (e) {
    console.error(e)
    toastErr('生成失败：' + (e && e.message ? e.message : '未知错误'))
    return false
  } finally {
    generating.value = false
  }
}

/** 只重算当前方案（编辑参数时用，保留其它方案不动） */
export function regenerateActive() {
  const img = sourceImage()
  if (!img) return false
  const key = activeKey.value
  const gw = Math.min(options.canvasW, maxCells.value, canvasCapW.value)
  const gh = Math.min(options.canvasH, maxCells.value, canvasCapH.value)
  const cw = canvasCapW.value
  const ch = canvasCapH.value
  try {
    const vp = variantParams(key, options.targetColors)
    if (!can('optimize.buildability')) {
      vp.dither = 'off'
      vp.cleanup = 0
      vp.mergeRatio = 0
    } else {
      vp.dither = options.dither
      vp.cleanup = options.cleanup ? 1 : 0
      if (!options.enhance) vp.saturate = 1
    }
    const p = generateVariant({
      img,
      gw,
      gh,
      fit: options.fit,
      targetColors: options.targetColors,
      brandId: options.brandId,
      colors: availableColors.value,
      variantKey: key,
      variantParams: vp,
      removeBg: options.removeBg,
      matteLevel: options.matteLevel,
      cartoonStyle: options.cartoon ? options.cartoonStyle : '',
      boardSize: boardProfile(cw, ch),
      beadKey: options.beadKey || autoBeadKey(cw, ch),
      sourceNearest: sourceNearestOpt(gw, gh)
    })
    const meta = variants.value.find(v => v.key === key) || {}
    const idx = variants.value.findIndex(v => v.key === key)
    const next = {
      ...padToCanvas(p, cw, ch),
      key,
      label: meta.label || p.mode,
      tagline: meta.tagline || '',
      desc: meta.desc || '',
      recommended: meta.recommended,
      compare: meta.compare
    }
    const list = variants.value.slice()
    if (idx >= 0) list[idx] = next
    else list.push(next)
    variants.value = list
    return true
  } catch (e) {
    toastErr('重新生成失败')
    return false
  }
}

export function selectVariant(key) {
  if (!variants.value.some(v => v.key === key)) return
  activeKey.value = key
  /* 换方案等于换了一张图纸：旧方案的撤销步骤套到新方案上没有意义 */
  clearHistory()
}

/* ------------------------------------------------------------------ 源图载入 */

/** 存档里源图的最长边（px）：512 够 300~450 格的图纸重新取样，再大就把 localStorage 撑爆 */
const SOURCE_SAVE_SIDE = 512

/**
 * 把源图缩成一份能进存档的快照（最长边 512 px）。
 *
 * 带透明通道的（贴纸 / 免抠素材）存 PNG —— 存 JPEG 会把透明区压成黑底，
 * 重新打开后再抠图 / 取样全错；不透明的照片存 JPEG，体积只有 PNG 的几分之一。
 * 任何一步失败都返回 null：源图是「锦上添花」，不能因为它让保存失败。
 */
function makeSourceSnapshot(img) {
  try {
    const sw = (img && (img.naturalWidth || img.width)) || 0
    const sh = (img && (img.naturalHeight || img.height)) || 0
    if (!sw || !sh) return null
    const k = Math.min(1, SOURCE_SAVE_SIDE / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * k))
    const h = Math.max(1, Math.round(sh * k))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    /* 抽样看有没有透明像素：整张扫一遍没必要，每 7 个像素取一个已经够准 */
    const d = ctx.getImageData(0, 0, w, h).data
    let alpha = false
    for (let i = 3; i < d.length; i += 28) {
      if (d[i] < 250) { alpha = true; break }
    }
    const url = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.82)
    return { url }
  } catch {
    return null
  }
}

export function loadImageSource(img, url, name = '', kind = 'raster') {
  /* 新拖进来的图是一件新作品（2026-10-31）：此前打开的那件作品还挂在
     currentProjectId 上，直接点保存会把新图盖进旧作品里，旧作品就没了。
     这里先解除关联，保存时另建一件；旧作品原样留在「我的作品」里，想接着改再打开它。
     打开存档走的是 openProject（不经过这里），所以不会误伤「改存档再保存」那条路。
     拼制进度记的是旧图纸的格子下标，换了图必须一起清掉。 */
  if (currentProjectId.value) currentProjectId.value = ''
  if (buildProgress.value.size) buildProgress.value = new Set()
  saveStatus.value = '未保存'
  sourceImg.value = img
  sourceUrl.value = url
  sourceName.value = name
  sourceKind.value = kind
  /* 这是真原图（不是图纸重建出来的）：存档要带一份，重新打开后放大才有细节 */
  sourceFromPattern.value = false
  rebuildSourceGrid = null
  sourceSnapshot = makeSourceSnapshot(img)
  /* 宽高比默认就是图片本身的；源图自带透明背景时会被 autoFitForSource 换成
     「主体包围盒」的比例（贴纸的花边留白不该占格子，见那里的说明）。 */
  const sw = (img && (img.naturalWidth || img.width)) || 0
  const sh = (img && (img.naturalHeight || img.height)) || 0
  sourceAspect.value = sw > 0 && sh > 0 ? sw / sh : 1
  if (name) projectName.value = name
  /* 换了图，上一张的卡通预览必须作废：否则缩略图上「卡通」那一栏
     显示的还是上一张脸的卡通，看着就像卡通化没生效。 */
  cartoonPreviewUrl.value = ''
  /* 上一张图的复杂度推荐也作废：换图后由 autoFitForSource 重新给（素材库在 useAsset 里给） */
  sourceRecommend.value = null
  previewMode.value = options.cartoon ? 'cartoon' : 'source'
  if (options.cartoon) refreshCartoonPreview()
}

/**
 * 裁切原图（手机工作台「裁切」抽屉）：只保留 rect 那一块，替换源图并重新生成。
 * 与 loadImageSource 的区别是这是同一件作品的编辑动作 —— 不清作品关联、
 * 不改作品名，保存时仍更新原来那件。
 * @param {{x:number,y:number,w:number,h:number}} rect 0~1 的相对范围
 */
export async function cropSource(rect) {
  const img = sourceImg.value
  if (!img) return false
  const sw = (img.naturalWidth || img.width) || 0
  const sh = (img.naturalHeight || img.height) || 0
  if (!sw || !sh) return false
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0))
  const x = Math.round(clamp01(rect.x) * sw)
  const y = Math.round(clamp01(rect.y) * sh)
  const w = Math.max(1, Math.min(sw - x, Math.round(clamp01(rect.w) * sw)))
  const h = Math.max(1, Math.min(sh - y, Math.round(clamp01(rect.h) * sh)))
  if (w < 2 || h < 2) return false
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
  /* 透明图（贴纸 / 抠图后的图）必须存 PNG，JPEG 会把透明区压成黑色 */
  let alpha = false
  try {
    const d = ctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 250) { alpha = true; break }
    }
  } catch { /* 跨域画布读不到像素时按不透明处理 */ }
  const url = alpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92)
  const next = new Image()
  next.src = url
  try {
    await ensureDrawable(next)
  } catch {
    return false
  }
  sourceImg.value = next
  sourceUrl.value = url
  sourceAspect.value = w / h
  sourceFromPattern.value = false
  rebuildSourceGrid = null
  sourceSnapshot = makeSourceSnapshot(next)
  cartoonPreviewUrl.value = ''
  regenerate()
  return true
}

/**
 * 等到图片真的可以 drawImage 为止。
 *
 * 为什么必须这么绕：img.onload 触发、甚至 img.decode() resolve 之后，
 * 浏览器仍可能还没把位图光栅化好（SVG blob URL 尤其明显）。
 * 这时 drawImage 会画出一张全白图 —— 表现是「生成成功但图案全白」，
 * 而且全程不报错，极难排查。所以这里用「两帧渲染完成」作为可靠信号，
 * 再配合尺寸校验兜底。
 */
function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

export async function ensureDrawable(img) {
  const ready = () => img.complete && (img.naturalWidth || img.width) > 0

  if (typeof img.decode === 'function') {
    try {
      await img.decode()
    } catch {
      /* 部分浏览器对已解码的图会 reject，忽略即可，下面继续校验 */
    }
  }
  if (!ready()) {
    await new Promise(resolve => {
      const ok = () => resolve()
      img.addEventListener('load', ok, { once: true })
      img.addEventListener('error', ok, { once: true })
      setTimeout(resolve, 5000)
    })
  }
  if (!ready()) throw new Error('图片解码失败')
  // 关键：尺寸就绪后再等两帧，确保光栅数据真的可用
  await nextFrame()
  await nextFrame()
  if (!ready()) throw new Error('图片解码失败')
  return img
}

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('请选择图片文件（JPG / PNG / WebP / GIF）'))
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error('图片不能超过 12MB'))
      return
    }
    const url = URL.createObjectURL(file)
    const im = new Image()
    // decoding='sync' 让解码在 onload 之前完成，避免上面的半解码问题
    im.decoding = 'sync'
    im.onload = async () => {
      try {
        await ensureDrawable(im)
        resolve({ img: im, url })
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    im.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败，换一张试试'))
    }
    im.src = url
  })
}

/**
 * 把 SVG 字符串变成可 drawImage 的 Image。
 *
 * 注意：必须先把根标签上已有的 width / height 去掉再注入。
 * 否则会出现 `<svg width="200" height="160" … width="100" height="100">`，
 * XML 属性重复属于致命解析错误，浏览器直接判为加载失败，
 * 表现是「素材明明存在却生成不出图案」。
 * viewBox 一定要保留，它是几何基准，删掉会把图形拉变形。
 */
export function svgToImage(svg, w = 200, h = 160) {
  return new Promise((resolve, reject) => {
    const raw = String(svg)
    const src = raw.includes('<svg')
      ? raw.replace(/<svg\b[^>]*>/i, tag => {
        const cleaned = tag
          .replace(/\swidth\s*=\s*"[^"]*"/gi, '')
          .replace(/\sheight\s*=\s*"[^"]*"/gi, '')
          .replace(/\swidth\s*=\s*'[^']*'/gi, '')
          .replace(/\sheight\s*=\s*'[^']*'/gi, '')
        return cleaned.replace(/<svg\b/i, `<svg width="${w}" height="${h}"`)
      })
      : raw
    const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }))
    const im = new Image()
    im.decoding = 'sync'
    im.onload = async () => {
      try {
        await ensureDrawable(im)
        resolve({ img: im, url })
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(new Error('素材解码失败'))
      }
    }
    im.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('素材加载失败'))
    }
    im.src = url
  })
}

export async function useImageFile(file) {
  const { img, url } = await fileToImage(file)
  /* 导入图片属于「图纸转换」这件事。当前如果在自由画布，先把自由画布那份文档收进它的槽位，
     再切到图纸转换来写这份文档 —— 不管入口是上传 / 拖图 / 素材库 / 首页拖图，
     导入的图片都不会落进自由画布的文档里（切回自由画布看到的仍是原来那张手绘图）。 */
  enterConversionWorkspace()
  loadImageSource(img, url, file.name.replace(/\.[^.]+$/, ''))
  autoFitForSource(img)
  /* 手机上成功结果由画布上方的「已生成图纸」卡承担，不再弹长 toast；
     只有抠背景没生效这种需要用户知道的失败才补一条短提示。 */
  const mobile = isMobileViewport()
  const ok = regenerate({ silent: mobile })
  /* 导入图像后回到拼豆图纸：图纸转换模式进来时停在「原图」（先调原图再生成），
     换图 / 拖图完成后如果还停在那儿，用户看到的仍是原图，会以为图纸没生成。
     生成失败就留在原图，让用户看清是哪张图出的问题。 */
  if (ok) currentView.value = 'pattern'
  /* 生成失败时撤掉提示卡：卡上写的是「已生成图纸」，不能和失败 toast 同时出现。 */
  if (mobile && !ok) fitNotice.value = null
  if (mobile && ok && options.removeBg) {
    const m = variants.value[0] && variants.value[0].matte
    if (m && !m.applied) toastWarn(`没能去背景：${m.reason || '未检测到明显背景'}`)
  }
  return ok
}

/**
 * 上传**图片**时自动推荐画布与色号（素材库的矢量素材走 useAsset，不在这里）。
 *
 * 2026-11-04 用户口径：按**图案复杂度**推荐一块钉板 —— 越复杂越大、越简单越小，
 * 钉板数量默认 1 块（52 / 78 / 104 / 120 四个规格之一）。复杂度怎么量见
 * lib/complexity.js（色彩熵 + 边缘强度 + 纹理覆盖率，在 80 边长的工作图上算）。
 *
 * 为什么不再只看源图分辨率：旧口径「一格至少摊到 2 个源像素」只回答「源图**能**细到
 * 什么程度」。一张 4000 px 的纯色 Logo 按旧口径会被推到 312 档（9 块 104 板），
 * 拼出来却还是一大片单色 —— 细节填不满格子，多买的板纯属浪费。
 *
 * 三条约束叠在一起取最小的规格：
 *   ① 复杂度推荐（越复杂越大）；
 *   ② 源图分辨率上限：一格至少摊到 2 个源像素（超采样的下限，见 maxUsefulSupersample），
 *      所以推荐规格不超过「源图长边 ÷ 2」能放下的最大规格；
 *   ③ 套餐上限：免费版单边 52 格（一块 52 板）。
 *
 * 画布 = 推荐规格的一块板（正方形）；成品区域按主体比例贴在板内、四周留空
 * （padToCanvas 会把留空写成空格，不占豆子）。贴纸先按 alpha 量出**主体包围盒**：
 * 比例与复杂度都只算主体，透明底不占格子也不算复杂度。
 *
 * 用户自己已经把画布开到最高档以上（自定义更大）时保留他选的底板，
 * 只按新图的比例重排 —— 「我明明开到 416 格，换张图就变回 120」是纯粹的意外。
 */
function isMobileViewport() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width:780px)').matches
}

/** 手机上传后的紧凑提示：只写结构化数据，文案与关闭交互交给编辑器 */
function publishFitNotice(data) {
  if (!isMobileViewport()) return false
  fitNotice.value = { ...data, at: Date.now() }
  return true
}

/** 在 capW × capH 的底板里按图片比例摆成品区域（居中留空由 padToCanvas 处理） */
function aspectGrid(capW, capH, aspect) {
  const cw = Math.max(1, Math.round(Number(capW) || 1))
  const ch = Math.max(1, Math.round(Number(capH) || 1))
  const a = Number(aspect) > 0 ? Number(aspect) : 1
  const w = a >= 1 ? cw : Math.max(1, Math.round(ch * a))
  const h = a >= 1 ? Math.max(1, Math.round(cw / a)) : ch
  return { w: Math.min(cw, w), h: Math.min(ch, h) }
}

function autoFitForSource(img) {
  const sw = (img && (img.naturalWidth || img.width)) || 0
  const sh = (img && (img.naturalHeight || img.height)) || 0
  if (!(sw > 0 && sh > 0)) return false

  /* 透明贴纸：先量出主体包围盒（estimateMatte 走的就是生成时会用的那条 alpha 分支，
     两处口径必须一致，否则画布比例和实际裁剪结果对不上）。读像素失败的极端情况退回整图比例。 */
  let px = null
  try { px = readImagePixels(img) } catch { /* 读像素失败：按整图比例走 */ }
  let subject = null
  if (px && px.transparent) {
    const m = estimateMatte(px.data, px.width, px.height, { level: options.matteLevel })
    if (m && m.ok && m.stats && m.stats.transparent && m.bbox) {
      subject = m.bbox
      sourceAspect.value = m.bbox.w / m.bbox.h
    }
  }
  if (!subject) sourceAspect.value = sw / sh

  const box = subject || { w: sw, h: sh }
  const long = Math.max(box.w, box.h)
  const aspect = sourceAspect.value

  /* ① 复杂度推荐（读像素失败时给中高档：多数上传是照片，宁可多给几格也别糊） */
  let picked = null
  if (px) {
    try { picked = estimateComplexity(px.data, px.width, px.height, subject) } catch { picked = null }
  }
  if (!picked) picked = { spec: 104, level: 3, name: '较复杂', desc: '未能读取像素，按中高档给', score: null, colors: 0 }

  /* ② 源图分辨率上限：一格至少摊到 2 个源像素 */
  const useful = Math.round(long / 2)
  const sourceCap = BOARD_SPECS.filter(s => s <= Math.max(BOARD_MIN, useful)).pop() || BOARD_MIN
  /* ③ 套餐上限：免费版 52 格 = 一块 52 板 */
  const planCap = BOARD_SPECS.filter(s => s <= maxCells.value).pop() || BOARD_MIN
  const spec = Math.min(picked.spec, sourceCap, planCap)

  /* 用户自己开到最高档以上：保留他选的底板，只按新图比例重排成品区域 */
  const AUTO_MAX = SIZE_TIERS[SIZE_TIERS.length - 1].n
  const currentLong = Math.max(Number(options.canvasW) || 0, Number(options.canvasH) || 0)
  const keepCustom = currentLong > AUTO_MAX
  let capW
  let capH
  if (keepCustom) {
    capW = Math.max(1, Math.min(maxCells.value, Number(options.canvasMaxW) || spec))
    capH = Math.max(1, Math.min(maxCells.value, Number(options.canvasMaxH) || spec))
  } else {
    /* 默认就是推荐规格的**一块板**：正方形，成品区域贴在里面 */
    capW = spec
    capH = spec
  }
  const grid = aspectGrid(capW, capH, aspect)
  const w = grid.w
  const h = grid.h

  const cells = w * h
  const floor = Math.min(colorFloorForCells(cells), availableColors.value.length)
  let raisedColors = 0
  if (floor && options.targetColors < floor) {
    raisedColors = options.targetColors
    options.targetColors = floor
  }
  /* 照片默认给「高还原」：见 preferDetail 的说明 */
  preferDetail.value = true
  const perCell = cells ? ((box.w * box.h) / cells) : 0
  /* 套餐上限只在这里读一次，界面文案与前面的收敛用的是同一个数 */
  const cap = maxCells.value
  const sourceCapped = picked.spec > sourceCap
  const planCapped = Math.min(picked.spec, sourceCap) > planCap

  /* 尺寸列表 / 钉板下拉的「推荐」标：上传走推荐的规格本身；
     用户保留自定义大底板时不标（那一档是他自己开的，不是推荐出来的） */
  sourceRecommend.value = {
    spec,
    tier: keepCustom ? null : spec,
    w,
    h,
    level: picked.level,
    name: picked.name,
    desc: picked.desc,
    score: picked.score,
    colors: picked.colors,
    sourceCapped,
    planCapped,
    keepCustom
  }

  /* 手机上不再用 7 秒长 toast 挡住画布：结构化提示卡自己读实时宽高，
     详情里才展开来源像素 / 每格摊多少 / 颜色数变化。 */
  const mobileNotice = publishFitNotice({
    subject: !!subject,
    sourceW: Math.round(sw), sourceH: Math.round(sh),
    boxW: Math.round(box.w), boxH: Math.round(box.h),
    suggestedW: w, suggestedH: h,
    cells,
    perCell,
    raisedColors: raisedColors || 0,
    colors: options.targetColors,
    boardSpec: spec,
    level: picked.level,
    levelName: picked.name,
    levelDesc: picked.desc,
    sourceCapped,
    planCapped,
    cap,
    autoMax: AUTO_MAX
  })

  /* 换图时画布规格跟着这张图重算：容量 = 推荐的那一块板（或用户保留的自定义底板），
     成品尺寸滑块从「这张图推荐的大小」开始往上限走。 */
  options.canvasMaxW = capW
  options.canvasMaxH = capH
  if (w === options.canvasW && h === options.canvasH) return false

  options.canvasW = w
  options.canvasH = h
  if (!mobileNotice) {
    toast(
      `已按图案复杂度推荐 1 块 ${spec} 钉板（${picked.name}）：${w} × ${h} 格`
      + `，一格摊到约 ${perCell.toFixed(1)} 个源像素`
      + (raisedColors ? `，颜色数 ${raisedColors} → ${options.targetColors}` : '')
      + (planCapped
        ? `。免费版单边上限 ${cap} 格，升 Pro 可用更大的板`
        : sourceCapped
          ? `。原图长边 ${Math.round(long)} 像素，再细就只是插值`
          : '。想更细可点更高档，或用「自定义尺寸」按规格加板'),
      '', 7000
    )
  }
  return true
}

export async function useAsset(asset) {
  const { img, url } = await svgToImage(asset.svg)
  /* 素材库选图同样是「图纸转换」的入口：在自由画布下选素材也要切过去，别污染手绘稿 */
  enterConversionWorkspace()
  loadImageSource(img, url, asset.name, 'vector')
  /* 素材自带尺寸（asset.boards 是块数，照 29 格整块画的）：换算成格以后再落到最近的
     **整板尺寸**（52 / 78 / 104 / 120 的倍数）—— 素材是矢量，格子多了细节只会更足。
     最后按套餐上限收敛，别让免费用户点开一个素材就超出上限。 */
  const assetCells = (Number(asset.boards) || 1) * BOARD_SIZE
  const assetCap = Math.max(1, Math.min(maxCells.value, SIZE_TIERS[SIZE_TIERS.length - 1].n))
  const assetBox = snapSpec(Math.min(assetCells, assetCap), { max: assetCap, min: Math.min(BOARD_MIN, assetCap) })
  options.canvasMaxW = assetBox
  options.canvasMaxH = assetBox
  options.canvasW = assetBox
  options.canvasH = assetBox
  options.targetColors = asset.colors || options.targetColors
  /* 素材的尺寸来自它自带的块数，不是复杂度推荐；列表里给最近的那一档打「推荐」 */
  sourceRecommend.value = {
    spec: boardSpecFor(assetBox, assetBox),
    tier: snapTier(assetBox),
    w: assetBox,
    h: assetBox,
    level: null,
    name: '素材尺寸',
    desc: '按素材自带的块数',
    score: null,
    colors: 0,
    sourceCapped: false,
    planCapped: false,
    keepCustom: false
  }
  /* 手机上不弹「已生成 N 个方案」长提示：它会盖住画布中央，
     而选完素材后图案本身就换好了，不需要再用 toast 确认。 */
  const ok = regenerate({ silent: isMobileViewport() })
  /* 选素材也是导入图像：同样回到拼豆图纸，不停在原图（见 useImageFile 的说明） */
  if (ok) currentView.value = 'pattern'
  return ok
}

/* ------------------------------------------------------------------ 项目存档 */

/* 存档是紧凑格式（见 lib/archive.js）：进度是位图字符串，这里还原成下标数组；
   老存档里本来就是数组，unpackProgress 原样返回。
   progressBeforeFinish（完成前的进度快照）也走同一套：1000×1000 完成一次是 100 万个下标，
   按 JSON 数组存约 5 MB，比图纸本身还大 —— 必须一起压。 */
function unpackProjectRecord(p) {
  if (!p) return p
  let out = p
  if (typeof out.buildProgress === 'string') out = { ...out, buildProgress: unpackProgress(out.buildProgress) }
  if (typeof out.progressBeforeFinish === 'string') out = { ...out, progressBeforeFinish: unpackProgress(out.progressBeforeFinish) }
  return out
}

/* 落盘 / 上传那一刻才打包进度位图：内存里始终是下标数组（Build Mode 每标一颗都要改），
   只在写 localStorage 与同步到账号时各压一次，两边不用各自记两套格式。 */
function packProjectRecord(p) {
  if (!p) return p
  let out = p
  if (Array.isArray(out.buildProgress) && out.buildProgress.length) out = { ...out, buildProgress: packProgress(out.buildProgress) }
  if (Array.isArray(out.progressBeforeFinish) && out.progressBeforeFinish.length) out = { ...out, progressBeforeFinish: packProgress(out.progressBeforeFinish) }
  return out
}

function readProjects() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PROJECTS) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(unpackProjectRecord)
  } catch {
    return []
  }
}

export const projects = ref(readProjects())

/* 存档写盘 / 同步的观察者。useProjectSync 在应用启动时注册，
   保存、删除、完成作品、记进度都会走 persist()，同步层据此把改动推到服务端。
   用回调而不是让 useStudio 直接 import 同步模块：同步模块要读 currentUser，
   反过来 import 会形成循环依赖。 */
let projectsPersistedListener = null
export function onProjectsPersisted(fn) {
  projectsPersistedListener = typeof fn === 'function' ? fn : null
}

/** 当前作品列表的「落盘格式」（进度已压成字符串），同步到服务端时用它。 */
export function packedProjects() {
  return projects.value.map(packProjectRecord)
}

/**
 * 用服务端 / 另一台设备的作品列表替换本机存档。
 *
 * 传入的记录必须是落盘格式（进度是字符串）——服务端存的就是这个格式。
 * 写盘失败时回滚内存里的列表，避免「界面显示有、刷新就没了」。
 */
export function applySyncedProjects(records) {
  const incoming = (Array.isArray(records) ? records : []).map(unpackProjectRecord)
  /* 服务端可能攒了多台设备加起来的作品，超过本机 localStorage 配额时不能整份写：
     按列表顺序（服务端已按 updatedAt 倒序）装到装不下为止，至少让用户先看到最近的作品。 */
  let list = incoming
  if (charsOf(incoming.map(packProjectRecord)) > LS_SAFE_CHARS) {
    list = []
    let used = 2
    for (const p of incoming) {
      const size = charsOf(packProjectRecord(p)) + 1
      if (used + size > LS_SAFE_CHARS) break
      list.push(p)
      used += size
    }
  }
  const before = projects.value
  projects.value = list
  if (!persist()) {
    projects.value = before
    return false
  }
  if (currentProjectId.value && !list.some(p => p && p.id === currentProjectId.value)) {
    currentProjectId.value = ''
  }
  return true
}

/** 数据量较大（116×116 = 13456 格，1000×1000 = 100 万格），限制内存里的项目数 */
const MAX_PROJECTS_FREE = 3
const MAX_PROJECTS_PRO = 40

/**
 * localStorage 的安全体积（UTF-16 码元数）。
 *
 * Chrome 的配额是约 5,000,000 个码元（按「key + value」一起算），写满抛 QuotaExceededError。
 * 这里留 8% 余量：settings / membership / credits 这些键也占位置。
 * 为什么现在要算这个：1000×1000 一个方案打包后就是 1,000,000 个字符，
 * 三个方案 300 万 —— 一张图就能吃掉配额的一大半，而以前最大 464 格时
 * 「三个方案全存」是理所当然的。所以存档必须按真实体积决定存几个方案。
 */
const LS_SAFE_CHARS = 4600000

/** 一段存档 JSON 的字符数（出错按 Infinity 处理：宁可当成"存不下"） */
function charsOf(value) {
  try {
    return JSON.stringify(value).length
  } catch {
    return Infinity
  }
}

/**
 * 体积超预算时，把「这次保存的这件作品」压到只留当前方案。
 *
 * 为什么只动这一件：用户刚存的是它，最坏情况也只是"另外两个方案没进存档、重新生成即可恢复"，
 * 而删掉旧作品是不可逆的。返回 { list, dropped }，dropped 为 0 表示没动过。
 */
function trimVariantsToFit(list, keepId) {
  if (charsOf(list) <= LS_SAFE_CHARS) return { list, dropped: 0 }
  const out = list.slice()
  const i = out.findIndex(p => p && p.id === keepId)
  if (i < 0) return { list: out, dropped: 0 }
  const proj = out[i]
  const vs = Array.isArray(proj.variants) ? proj.variants : []
  if (vs.length <= 1) return { list: out, dropped: 0 }
  /* 从后往前丢非当前方案：当前方案一定留下，用户至少还能看到自己刚保存的那张图 */
  const active = proj.activeKey
  const keep = vs.filter(v => v.key === active)
  const dropped = vs.length - keep.length
  out[i] = { ...proj, variants: keep.length ? keep : vs.slice(0, 1) }
  return { list: out, dropped: keep.length ? dropped : 0 }
}

function persist() {
  let text
  try {
    text = JSON.stringify(packedProjects())
  } catch (e) {
    toastErr('作品数据序列化失败，请把这句话反馈给开发者')
    return false
  }
  try {
    localStorage.setItem(LS_PROJECTS, text)
  } catch (e) {
    /* 把真实体积说出来：用户才知道"删一件旧作品"够不够 */
    toastErr(`本机存储空间不足（这次要写约 ${(text.length / 1048576).toFixed(1)} MB，浏览器上限约 5 MB），请删除一些旧作品再保存`)
    return false
  }
  /* 本机写成功之后再通知同步层：写盘失败时不该把「没存下」的版本传到服务端。 */
  if (projectsPersistedListener) {
    try {
      projectsPersistedListener()
    } catch {
      /* 同步失败不影响本机存档 */
    }
  }
  return true
}

export function projectLimit() {
  return can('projects.limit', MAX_PROJECTS_PRO) ? MAX_PROJECTS_PRO : MAX_PROJECTS_FREE
}

/* 手工修改记录进存档：板坐标 + 色号 id，null = 用户擦掉。
   一格里只多 3 个数，正常「逐颗改过」是几十到几百格；超过上限就不存
   （那种量级的改动更像整体换色，存下来也只会把存档撑爆）。 */
const MAX_SAVED_EDITS = 20000

/** 手工修改记录 → 存档用的一维数组 [x, y, id, x, y, id, …] */
function packEditMap(p) {
  if (!p || !(p.editMap instanceof Map) || !p.editMap.size) return null
  if (p.editMap.size > MAX_SAVED_EDITS) return null
  const out = []
  for (const [i, e] of p.editMap) {
    if (i < 0 || i >= p.cells.length) continue
    out.push(i % p.width, Math.floor(i / p.width), e && e.id ? e.id : null)
  }
  return out.length ? out : null
}

/**
 * 修改层进存档：[w, h, x, y, id, …]，null = 擦掉。
 * 只在「层的分辨率与保存时的图纸不同」时存 —— 同分辨率时 editMap 已经能完整复原这一层，
 * 再存一份只是白占体积（这两份数据在 localStorage 里是按作品各存一次的）。
 */
function packEditLayer(p) {
  const layer = p && p.editLayer
  if (!layer || !layer.mask) return null
  const art = artBoxOf(p)
  if (layer.w === art.w && layer.h === art.h) return null
  const out = [layer.w, layer.h]
  let n = 0
  for (let i = 0; i < layer.mask.length && n < MAX_SAVED_EDITS; i++) {
    if (!layer.mask[i]) continue
    const k = layer.cells[i]
    const color = k >= 0 ? layer.palette[k] : null
    out.push(i % layer.w, Math.floor(i / layer.w), color ? color.id : null)
    n++
  }
  return n ? out : null
}

/** 存档里的一维数组 → 修改层（色号 id 在当前图纸的色板里找，找不到就查全局色板） */
function unpackEditLayer(p, flat) {
  if (!p || !Array.isArray(flat) || flat.length < 2) return null
  const w = Number(flat[0])
  const h = Number(flat[1])
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null
  if (w * h > 1000000) return null
  const layer = createEditLayer(w, h)
  for (let i = 2; i + 2 < flat.length; i += 3) {
    const x = Number(flat[i])
    const y = Number(flat[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= w || y >= h) continue
    const at = y * w + x
    const id = flat[i + 2]
    layer.mask[at] = 1
    if (id == null) {
      layer.cells[at] = EMPTY
      continue
    }
    const color = p.palette.find(c => c.id === id) || getColorById(id)
    if (!color) {
      layer.mask[at] = 0
      continue
    }
    let k = layer.palette.findIndex(c => c.id === id)
    if (k < 0) {
      k = layer.palette.length
      layer.palette.push(color)
    }
    layer.cells[at] = k
  }
  return layer.mask.some(Boolean) ? layer : null
}

/** 存档里的一维数组 → 手工修改记录（色号 id 在当前图纸的色板里找，找不到就查全局色板） */
function unpackEditMap(p, flat) {
  if (!p || !Array.isArray(flat) || !flat.length) return undefined
  const map = new Map()
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const x = Number(flat[i])
    const y = Number(flat[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= p.width || y >= p.height) continue
    const id = flat[i + 2]
    const at = y * p.width + x
    if (id == null) {
      map.set(at, null)
      continue
    }
    const color = p.palette.find(c => c.id === id) || getColorById(id)
    if (!color) continue
    map.set(at, { id: color.id, color })
  }
  return map.size ? map : undefined
}

/**
 * 存一件作品。
 * extra：调用方额外塞进存档的字段（例如工作台的创作模式「自由创作 / 图纸转换」，
 * 个人中心的作品卡要靠它显示类型标签）。老存档没有这些字段，按默认值读。
 */
export function saveProject(name, extra) {
  const p = pattern.value
  if (!p) {
    toastWarn('先生成一个图案再保存')
    return null
  }
  const title = (name || projectName.value || '未命名作品').trim()
  const existing = projects.value.find(x => x.id === currentProjectId.value)
  const limit = projectLimit()
  if (!existing && projects.value.length >= limit) {
    toastWarn(ALL_FREE
      ? `最多保存 ${limit} 个作品，请删除一些旧作品再保存`
      : `当前套餐最多保存 ${limit} 个作品，升级后可保存 40 件`)
    return null
  }
  const payload = {
    id: existing ? existing.id : `p_${Date.now().toString(36)}`,
    name: title,
    updatedAt: Date.now(),
    createdAt: existing ? existing.createdAt : Date.now(),
    /* 画布按格存（老存档里是 boardCols/boardRows，读取端会按 29 换算），
       这样 300 / 450 这类跨不满整块底板的精细档才能原样存回来 */
    canvasW: options.canvasW,
    canvasH: options.canvasH,
    /* 画布规格（容量）一起存：重新打开时滑块上限与「最大可用网格」才对得上。
       老存档没有这两个字段，读取端按图纸尺寸兜底。 */
    canvasMaxW: options.canvasMaxW,
    canvasMaxH: options.canvasMaxH,
    brandId: options.brandId,
    targetColors: options.targetColors,
    activeKey: activeKey.value,
    /* 手工编辑标记跟着存档走：改过格子再保存的作品，重新打开后换尺寸
       仍走「保留手工修改」那条路（没有这个标记，打开存档就被当成机器画的）。
       老存档没有这个字段，读取端按 false 处理，行为与以前一致。 */
    manualEdited: manualEdited.value,
    variants: variants.value.map(v => {
      const t = v.active || v
      /* 手工修改记录跟着作品走：重新打开后放大缩小才能把手改按比例落回去
         （没有它，重新取样会把逐颗改过的格子覆盖掉）。
         修改层也一起存：层比保存时的图纸更细时（在 104 上改、缩到 52 保存），
         只有它能把「改那一刻的尺寸」带过存档。 */
      const extra = {}
      const edits = packEditMap(t)
      if (edits) extra.edits = edits
      const layer = packEditLayer(t)
      if (layer) extra.layer = layer
      return {
        key: v.key,
        label: v.label,
        tagline: v.tagline,
        stats: v.stats,
        recommended: v.recommended,
        data: packPattern(t, extra)
      }
    }),
    /* 源图快照（最长边 512 px）：重新打开这件作品后「放大尺寸 / 恢复方案」
       才能按原图重新取样；没有它就只能拿图纸重建一张位图，放大出来是马赛克。
       图纸自己重建出来的源图不存（存了也是同样分辨率，白白占地方）。
       aspect 存**当时界面用的比例**：矢量素材按 1:1、位图按（抠图后的）主体包围盒比例 ——
       存图片自己的比例会让重新打开的作品换一个网格比例（方块图变成 156 × 125）。 */
    source: (sourceFromPattern.value || !sourceSnapshot)
      ? null
      : {
          url: sourceSnapshot.url,
          aspect: Math.round((sourceKind.value === 'vector' ? 1 : sourceAspect.value) * 10000) / 10000
        },
    thumbnail: thumbnailData(),
    /* 拼制进度：新作品也要带上内存里已有的进度。
       旧写法对新作品一律写 null —— 在 Build Mode 里拼了半天再点「保存作品与进度」，
       进度不会进存档（只有离开页面时才补写一次），刷新一下就全没了。 */
    buildProgress: existing
      ? (existing.buildProgress || (buildProgress.value.size ? [...buildProgress.value] : null))
      : (buildProgress.value.size ? [...buildProgress.value] : null),
    /* 完成态：已有作品原样保留，新作品从「未完成」开始 */
    finishedAt: existing ? existing.finishedAt || 0 : 0,
    finishPhoto: existing ? existing.finishPhoto || '' : '',
    finishNote: existing ? existing.finishNote || '' : '',
    finishDeduct: existing ? existing.finishDeduct || null : null,
    progressBeforeFinish: existing ? existing.progressBeforeFinish || null : null,
    completedBeads: existing ? existing.completedBeads || 0 : 0,
    finishSignature: existing ? existing.finishSignature || '' : ''
  }
  /* 调用方补的字段放在最后（同名键以此为准） */
  if (extra && typeof extra === 'object') Object.assign(payload, extra)

  const list = projects.value.slice()
  const idx = list.findIndex(x => x.id === payload.id)
  if (idx >= 0) list[idx] = { ...list[idx], ...payload }
  else list.unshift(payload)
  /* 体积超预算就只存当前方案（见 trimVariantsToFit）：1000×1000 三个方案 300 万字符，
     直接写会顶爆 localStorage 的 500 万配额，结果是一次都存不下 */
  let trimmed = trimVariantsToFit(list, payload.id)
  /* 源图快照是「锦上添花」：真撑不下时先丢它，别为了它把另外两个方案裁掉 */
  if (charsOf(trimmed.list) > LS_SAFE_CHARS) {
    const withoutSource = list.map(p => (p && p.id === payload.id ? { ...p, source: null } : p))
    trimmed = trimVariantsToFit(withoutSource, payload.id)
  }
  const before = projects.value
  projects.value = trimmed.list
  if (!persist()) {
    /* 写盘失败就把内存里的列表回退：否则列表里明明有这件作品、刷新一下却不见了 */
    projects.value = before
    return null
  }
  currentProjectId.value = payload.id
  projectName.value = title
  saveStatus.value = '已保存'
  trackEvent('pattern.save')
  toastOk(`已保存「${title}」`)
  if (trimmed.dropped > 0) {
    toast(`画布太大，本次只存档了当前方案（另外 ${trimmed.dropped} 个方案没进存档，切过去点「恢复方案」即可重新生成）`, 'warn', 6000)
  }
  return payload.id
}

/**
 * 当前打开的作品 id。
 * 必须落盘并在下次进入工作台时恢复 —— 否则用户刷新页面、或从导航点「工作台」
 * 回来（路由不带 id）就会看到一个空工作台，之前存的作品像丢了。
 */
const lastOpenId = (() => {
  try {
    return localStorage.getItem(LS_CURRENT) || ''
  } catch {
    return ''
  }
})()

export const currentProjectId = ref(
  lastOpenId && projects.value.some(p => p.id === lastOpenId) ? lastOpenId : ''
)

watch(currentProjectId, id => {
  try {
    if (id) localStorage.setItem(LS_CURRENT, id)
    else localStorage.removeItem(LS_CURRENT)
  } catch {
    /* 隐私模式下忽略 */
  }
}, { flush: 'sync' })

/* 「不带 id 进工作台就接着上次的作品」这个行为已经去掉：
   不带 id 的 /editor 就是工作台的创建步骤，想继续哪件作品由用户在创建页上点。
   自作主张打开一件用户没点的存档，会让人以为「新建作品」没生效。 */

/**
 * 确保某个作品已经真正装载。
 * 只比较 id 是不够的：currentProjectId 会在模块初始化时从本机存档恢复，
 * 刷新页面后「id 相同但图案还没装载」，旧写法会直接跳过装载，
 * 于是页面停在空状态。判断条件必须是「id 对得上 **而且** 图案已经在内存里」。
 */
export function ensureProjectLoaded(id) {
  if (!id) return false
  if (id === currentProjectId.value && hasPattern.value) return true
  return openProject(id)
}

export function openProject(id) {
  const proj = projects.value.find(p => p.id === id)
  if (!proj) {
    toastErr('作品不存在')
    return false
  }
  try {
    const list = []
    for (const v of proj.variants || []) {
      const p = unpackPattern(v.data, proj.brandId)
      if (!p) continue
      list.push({
        ...p,
        /* 逐颗改过的格子（存档里带的）：换尺寸时按比例落回去，重新取样不会覆盖手改 */
        editMap: unpackEditMap(p, v.data && v.data.edits),
        /* 修改层：记着「改那一刻的尺寸」，比存档里的图纸更细时靠它保住精度 */
        editLayer: unpackEditLayer(p, v.data && v.data.layer),
        key: v.key,
        label: v.label,
        tagline: v.tagline,
        stats: v.stats || p.stats,
        recommended: v.recommended
      })
    }
    if (!list.length) {
      toastErr('作品数据已损坏')
      return false
    }
    variants.value = list
    activeKey.value = proj.activeKey && list.some(v => v.key === proj.activeKey) ? proj.activeKey : list[0].key
    /* 打开存档时把画布尺寸还原成「这张图纸自己的尺寸」，而不是存档里记的参数值：
       图纸的 width/height 才是真正的依据（旧存档只记了块数，也在这里按 29 换算回来）。
       用参数值会在「存档尺寸 ≠ 图纸尺寸」时让 ② 的画布控件和画布内容对不上。
       注意图纸的 width/height 是**画布（底板）**；成品区域是存档里的 canvasW/H。 */
    const restored = variants.value.find(v => v.key === activeKey.value) || variants.value[0]
    const active = restored.active || restored
    const boardW = Math.min(active.width || (Number(proj.boardCols) || 1) * BOARD_SIZE, maxCells.value)
    const boardH = Math.min(active.height || (Number(proj.boardRows) || 1) * BOARD_SIZE, maxCells.value)
    /* 画布规格（底板）：老存档没记，就按图纸尺寸兜底（底板 = 成品区域，行为与以前一致） */
    options.canvasMaxW = Math.min(Number(proj.canvasMaxW) || boardW, maxCells.value)
    options.canvasMaxH = Math.min(Number(proj.canvasMaxH) || boardH, maxCells.value)
    /* 成品区域：存档里记的就是它；没有就按画布兜底 */
    const artW = Math.min(Number(proj.canvasW) || boardW, options.canvasMaxW)
    const artH = Math.min(Number(proj.canvasH) || boardH, options.canvasMaxH)
    options.canvasW = artW
    options.canvasH = artH
    /* 老存档的图纸是「成品区域大小」的，这里补成画布大小（居中 + 四周留空）；
       新存档已经是画布大小，这一步只是把成品区域的尺寸补回图案上。 */
    variants.value = variants.value.map(v => {
      const base = { ...padToCanvas(v, options.canvasMaxW, options.canvasMaxH), artW, artH }
      return v.active
        ? { ...base, active: { ...padToCanvas(v.active, options.canvasMaxW, options.canvasMaxH), artW, artH } }
        : base
    })
    options.brandId = proj.brandId || DEFAULT_BRAND_ID
    options.targetColors = proj.targetColors || options.targetColors
    projectName.value = proj.name
    currentProjectId.value = proj.id
    sourceImg.value = null
    sourceUrl.value = ''
    cartoonPreviewUrl.value = ''
    previewMode.value = 'source'
    /* 存档里的尺寸是用户当时定下的，不再按复杂度重推（也不在列表里打「推荐」） */
    sourceRecommend.value = null
    buildProgress.value = proj.buildProgress ? new Set(proj.buildProgress) : new Set()
    /* 完成的作品进度必须是满的：老存档 / 只写了 finishedAt 的存档补一次，
       否则会出现「顶栏打了 ✓、进度条却是 0%」的自相矛盾。 */
    if (proj.finishedAt && !buildProgress.value.size) {
      buildProgress.value = allBuildIndexes(pattern.value)
    }
    clearHistory()
    /* 手工编辑标记从存档恢复（saveProject 存的；老存档没有按 false 算）：
       clearHistory 只负责「旧撤销步骤失效」，不能把「这张图被手改过」一起忘掉，
       否则重新打开的作品换尺寸会把手工修改重新生成掉。 */
    manualEdited.value = !!proj.manualEdited
    saveStatus.value = '已打开存档'
    /* 源图：新存档带着一份（最长边 512 px），直接用它 —— 放大尺寸 / 恢复方案都是
       按原图重新取样。老存档没带，就按当前图纸重建一张（见 rebuildThumbSource）：
       插值管几何、落色管颜色，放大是脆边不糊（2026-10-31 两条用户反馈：
       「放大不能一块一块」「放大之后变模糊了」）。 */
    if (proj.source && proj.source.url) {
      const snap = proj.source
      sourceKind.value = 'raster'
      sourceAspect.value = Number(snap.aspect) || (active.width / active.height)
      sourceUrl.value = snap.url
      sourceFromPattern.value = false
      sourceSnapshot = snap
      /* 落色目标 = 当前方案自己的调色板（快照画面就是这一方案渲染出来的）。
         不能用所有方案的并集：把别的方案的色号混进落色目标，放大后最近邻采样
         会从那批颜色里投票，长出当前方案没有的色号（2026-10-31 探针实测
         70×87 放大多出 7 色）。快照是 512px 的位图：不落色的话，放大重新取样时
         边缘格混出中间色，量化后长出原图没有的邻近色 —— 和老存档发虚是同一个病。
         落色 + 最近邻（rebuildSourceGrid 让 sourceNearestOpt 生效）让放大同样
         「颜色一格不错、边界更细」。sourceFromPattern 保持 false：这份快照是真原图，
         存档照旧带它。 */
      const snapColors = []
      for (const c of active.palette || []) {
        const m = /^#?([0-9a-f]{6})$/i.exec(c && c.hex ? c.hex : '')
        if (!m) continue
        snapColors.push([parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)])
      }
      const im = new Image()
      im.onload = () => {
        /* 快照只有 512 px：成品网格放大超过 512 格之后，采样会退化成最近邻（一块一块）。
           内存里平滑插值到 REBUILD_SOURCE_SIDE、落色到图纸色号，再当源图；
           存档里那份 512 快照原样保留（sourceSnapshot 不动，localStorage 的体积不涨）。 */
        const m = Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height)
        const up = m < REBUILD_SOURCE_SIDE ? smoothUpscaledUrl(im, REBUILD_SOURCE_SIDE, snapColors.length ? snapColors : null) : null
        if (!up) { sourceImg.value = im; return }
        const big = new Image()
        big.onload = () => { sourceImg.value = big; sourceUrl.value = up.url }
        big.src = up.url
      }
      im.src = snap.url
      rebuildSourceGrid = { w: artW, h: artH }
    } else {
      rebuildThumbSource()
    }
    return true
  } catch (e) {
    toastErr('打开失败')
    return false
  }
}

/** 图纸重建源图 / 快照插值的目标分辨率（最长边，px）。
 *  采样口径见 lib/pattern.js 的 maxUsefulSupersample：源图比成品网格大 ⇒ 每格做面积平均，
 *  源图比网格小 ⇒ 退化成最近邻，画面一格一块。档位最大 936 格，1024 保证怎么放大
 *  都落在面积平均那一侧；插值把旧格边界放到 1/k 格的精细位置上，配合落色
 *  （见 smoothUpscaledUrl 的 snap 参数）输出脆边。 */
const REBUILD_SOURCE_SIDE = 1024

/** 落色源图对应的**成品网格**（rebuildThumbSource / openProject 的快照落色写入，
 *  换真原图时清掉）。
 *  生成时用它判断这次是放大还是缩小：放大走最近邻采样（颜色一格不错，不许混出
 *  中间色 —— 面积平均混中间色就是「放大发虚」的根源），缩小才用面积平均做块合并。 */
let rebuildSourceGrid = null

/** 这次生成要不要走「图纸源图最近邻采样」：
 *  源图被落过色（rebuildSourceGrid 非空 = 老存档重建的、或快照插值落色的），
 *  且这次成品网格**没有比落色基准网格小**（放大或原尺寸）。
 *  原尺寸重算也走这条路 —— 最近邻 + 落色能一格不错地还原现在的图纸，
 *  「恢复方案」因此不会悄悄改颜色。缩小传 false：块合并要靠面积平均。 */
function sourceNearestOpt(gw, gh) {
  return !!(rebuildSourceGrid && gw >= rebuildSourceGrid.w && gh >= rebuildSourceGrid.h)
}

/**
 * 把已解码的位图平滑插值到最长边 ≥ side，返回可以直接 new Image() 的 data URL。
 * 已经不小（≥ side）时返回 null，调用方按原样用。
 * 展示格式优先 WebP（平滑位图存 PNG 又大又慢）；不支持 WebP 编码的浏览器
 * （iOS Safari 的 canvas.toDataURL）会静默回退成 PNG，行为不变只是文件大一点。
 */
function smoothUpscaledUrl(im, side, snap = null) {
  const iw = im.naturalWidth || im.width
  const ih = im.naturalHeight || im.height
  if (!(iw > 0 && ih > 0)) return null
  if (Math.max(iw, ih) >= side) return null
  const k = side / Math.max(iw, ih)
  const c = document.createElement('canvas')
  c.width = Math.round(iw * k)
  c.height = Math.round(ih * k)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(im, 0, 0, c.width, c.height)
  /* 图纸重建的源图要做「落色」：插值出来的过渡色收回到图案本来用的那几种颜色上。
     不落色的话，放大重新取样时边缘格取到的是插值中间色，量化后长出一堆原图没有
     的浅中间色 —— 画面整圈发虚（2026-10-31 用户反馈「放大之后变模糊了」）。
     落色把插值的几何保留下来（边界落在 1/k 格的精细位置上），颜色却回到
     非黑即白的原色，取样多数投票就能稳定选出真色，边缘是脆的。
     alpha 也一并二值化：半透明的边缘像素被白底合成后会泛白，最近邻采样
     采到它就镶一圈白边；硬了之后每个像素要么是纯色、要么完全透明。 */
  let lossless = false
  if (snap && snap.length) {
    lossless = true
    const lut = snapPaletteLUT(snap)
    const id = ctx.getImageData(0, 0, c.width, c.height)
    const d = id.data
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]
      if (a < 128) { d[i + 3] = 0; continue }
      d[i + 3] = 255
      const e = snap[lut[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]]
      d[i] = e[0]; d[i + 1] = e[1]; d[i + 2] = e[2]
    }
    ctx.putImageData(id, 0, 0)
  }
  /* 落过色的源图必须走无损编码：WebP 0.9 是有损的，会把精确的色值扰动几个色阶，
     重新取样时就被量化到相邻色号上（实测 33 色又长出 9 个邻近色）。
     平涂像素图 PNG 压得很小，而且这份 URL 只在内存里（saveProject 不存它的快照）。 */
  let url = ''
  try { url = lossless ? c.toDataURL('image/png') : c.toDataURL('image/webp', 0.9) } catch { /* 编码抛错就回退 PNG */ }
  if (!url.startsWith('data:image')) url = c.toDataURL('image/png')
  return { url }
}

/** 15-bit 色桶 → 最近落色下标的查找表：850k 像素逐个算 291 色距离太慢，
 *  先把 32768 个桶各算一次最近色（约 950 万次乘加，一次 <50ms），像素只查表。 */
function snapPaletteLUT(colors) {
  const lut = new Uint8Array(32768)
  for (let i = 0; i < 32768; i++) {
    const r = ((i >> 10) << 3) | 4
    const g = (((i >> 5) & 31) << 3) | 4
    const b = ((i & 31) << 3) | 4
    let best = 0
    let bd = Infinity
    for (let c = 0; c < colors.length; c++) {
      const dr = r - colors[c][0]
      const dg = g - colors[c][1]
      const db = b - colors[c][2]
      const d = dr * dr + dg * dg + db * db
      if (d < bd) { bd = d; best = c }
    }
    lut[i] = best
  }
  return lut
}

/**
 * 从存档打开时没有源图，把当前图纸重建一张能重新取样的源图。
 *
 * 2026-10-31 之前是把格子按块放大（320 px 或 1 格 1 像素），拿它「放大尺寸 /
 * 重新生成」出来的画面还是一格一块。当天改成平滑插值后，用户接着反馈
 * 「放大之后变模糊了」—— 插值在每条色块边界上拉出约一格宽的过渡带，
 * 重新取样时边缘格取到中间色，量化后长出几十种原图没有的浅中间色
 * （实测「131」这件作品 33 色放大成 57 色，69% 的边界变成 A→B→C 三级渐变）。
 *
 * 现在的口径：插值管**几何**（边界落在 1/k 格的精细位置上），落色管**颜色**
 * （每个像素收回图案本来用的那几种颜色）。这样放大既有精细的轮廓、
 * 又是干净的原色，既不是一块一块、也不是一圈虚边。
 *
 * 另外底子必须是**透明的**：空格（去背景留空的位置）不能铺 #EFF1F4 灰底 ——
 * 铺了灰底，重新取样后背景会变成一整片白豆/灰豆（实测 1375 个空格全被吃掉）。
 * 带 alpha 的源图走「源图自带透明背景」的自动抠图，空格还是空格。
 */
function rebuildThumbSource() {
  const p = pattern.value
  if (!p) return
  /* 只取**成品区域**（画布四周的留白不是画面）：源图对应的是「原图」，
     重新取样时它要铺满新的成品网格 —— 把整块底板当源图的话，放大后画面
     会缩进中间一小块，四周全是留白的灰。 */
  const ox = Math.max(0, Math.floor((p.width - p.artW) / 2))
  const oy = Math.max(0, Math.floor((p.height - p.artH) / 2))
  const base = document.createElement('canvas')
  base.width = p.artW
  base.height = p.artH
  const bctx = base.getContext('2d')
  const bimg = bctx.createImageData(p.artW, p.artH)
  /* 落色的目标 = 这张图案实际用到的颜色（hex → RGB 只解析一次）。
     顺带收集给插值后的落色步骤用。 */
  const snap = []
  const rgbOf = new Map()
  for (let k = 0; k < p.palette.length; k++) {
    const m = /^#?([0-9a-f]{6})$/i.exec((p.palette[k] && p.palette[k].hex) || '')
    const rgb = m
      ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)]
      : null
    rgbOf.set(k, rgb)
    if (rgb) snap.push(rgb)
  }
  for (let y = 0; y < p.artH; y++) {
    const srcRow = (y + oy) * p.width + ox
    for (let x = 0; x < p.artW; x++) {
      const rgb = rgbOf.get(p.cells[srcRow + x])
      if (!rgb) continue
      const o = (y * p.artW + x) * 4
      bimg.data[o] = rgb[0]
      bimg.data[o + 1] = rgb[1]
      bimg.data[o + 2] = rgb[2]
      bimg.data[o + 3] = 255
    }
  }
  bctx.putImageData(bimg, 0, 0)
  const up = smoothUpscaledUrl(base, REBUILD_SOURCE_SIDE, snap)
  const url = up ? up.url : base.toDataURL('image/png')
  const im = new Image()
  im.onload = () => {
    sourceImg.value = im
    sourceUrl.value = url
    /* 从存档重建出来的源图是**这张图纸自己**的位图：比例、种类都要跟着换，
       否则精细档会拿着「上一张照片」的比例去算格子（跨作品切来切去时必然歪）。 */
    sourceKind.value = 'raster'
    sourceAspect.value = p.artW / p.artH
    /* 标记「源图是图纸重建的」：saveProject 不给它存快照（存了也是同样分辨率）。
       rebuildSourceGrid 记下重建时的成品网格：生成时用它判断「这次是放大还是缩小」，
       放大走最近邻采样（颜色一格不错，见 sourceNearestOpt），缩小才用面积平均做块合并。 */
    sourceFromPattern.value = true
    rebuildSourceGrid = { w: p.artW, h: p.artH }
    sourceSnapshot = null
  }
  im.src = url
}

export function deleteProject(id) {
  projects.value = projects.value.filter(p => p.id !== id)
  persist()
  if (currentProjectId.value === id) currentProjectId.value = ''
  /* 删除要同步到账号：否则另一台设备下次同步会把这件作品又带回来。
     动态 import 避免 useStudio ↔ useProjectSync 的循环依赖。 */
  import('./useProjectSync.js')
    .then(m => m.queueProjectDelete(id))
    .catch(() => { /* 同步层没加载成功时，本机删除仍然生效 */ })
  toastOk('已删除作品')
}

export function duplicateProject(id) {
  const proj = projects.value.find(p => p.id === id)
  if (!proj) return
  const limit = projectLimit()
  if (projects.value.length >= limit) {
    toastWarn(ALL_FREE ? `最多保存 ${limit} 个作品` : `当前套餐最多保存 ${limit} 个作品`)
    return
  }
  /* 副本 = 一件还没拼的新作品：完成态与拼制进度都不能带过去，
     否则「已完成 2 件」会凭空多出一件根本没拼过的作品。 */
  const copy = {
    ...proj,
    id: `p_${Date.now().toString(36)}`,
    name: proj.name + ' 副本',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    buildProgress: null,
    finishedAt: 0,
    finishPhoto: '',
    finishNote: '',
    finishDeduct: null,
    progressBeforeFinish: null,
    completedBeads: 0,
    finishSignature: ''
  }
  projects.value = [copy, ...projects.value]
  persist()
  toastOk('已复制作品')
}

/* ------------------------------------------------------- 图案位图（缩略图 / 重建源图）

   为什么不逐格 fillRect：1000×1000 是 100 万格，而存一次作品要画两遍
   （缩略图一遍、打开存档时重建源图一遍），逐格走是秒级阻塞且全程没有反馈。
   packCellColors 的取色规则与逐格绘制逐像素一致（见 scripts/verify/render-batch-equiv.mjs），
   这里只把「1 格 = 1 像素的位图」一次性写进 canvas，再按需缩放。
   464 格以内继续走原来的逐格绘制：那些尺寸是老作品就有的、缩略图是像素硬边的，
   换成 drawImage 缩放会让已有作品的缩略图变样（用户会以为图被改了）。 */

/** 超过这个边长（格）才改用位图缩放：取旧的画布上限，保证老作品缩略图逐像素不变 */
const THUMB_STRAIGHT_MAX = 464

/** 图案 → 1 格 1 像素的离屏 canvas（放大缩小都交给 drawImage，不在这里做插值） */
function patternBitmap(p) {
  const off = document.createElement('canvas')
  off.width = p.width
  off.height = p.height
  const octx = off.getContext('2d')
  const img = octx.createImageData(p.width, p.height)
  new Uint32Array(img.data.buffer).set(packCellColors(p.cells, p.palette))
  octx.putImageData(img, 0, 0)
  return off
}

/**
 * 图案 → 最长边不超过 maxSize 的 canvas。
 * 小图案：整数倍像素块 + 硬边（与原实现完全一致）；大图案：位图 + 双线性缩放
 * （1000 格缩到 240 px 只能这样画，逐格画既慢又会因为 scale=1 而存出一张 1000×1000 的 PNG）。
 */
function patternThumbCanvas(p, maxSize) {
  const m = Math.max(p.width, p.height)
  if (m <= THUMB_STRAIGHT_MAX) {
    const scale = Math.max(1, Math.round(maxSize / m))
    const c = document.createElement('canvas')
    c.width = p.width * scale
    c.height = p.height * scale
    const ctx = c.getContext('2d')
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const col = p.palette[p.cells[y * p.width + x]]
        if (!col) continue
        ctx.fillStyle = col.hex
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
    }
    return c
  }
  const k = Math.min(1, maxSize / m)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(p.width * k))
  c.height = Math.max(1, Math.round(p.height * k))
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(patternBitmap(p), 0, 0, p.width, p.height, 0, 0, c.width, c.height)
  return c
}

function thumbnailData() {
  const p = pattern.value
  if (!p) return ''
  try {
    /* 缩略图一律缩到 240 px 以内：它是存进 localStorage 的，
       1000 格的图案按原尺寸存一张 PNG 就是几百 KB，而作品存档总共只有约 5 MB */
    return patternThumbCanvas(p, 240).toDataURL('image/png')
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ 建造进度 */

/** 已完成格子的全局下标集合 */
/**
 * 已拼的格子下标集合（Build Mode）。
 *
 * 和 variants 同理用 shallowRef：分板进度是**逐格** `has(i)` 扫 20 万格的，
 * 而 reactive 的 Set 每次 has/delete 都要过一遍 Proxy 拦截，实测 450×450 下一次
 * 分板进度重算要 138 ms。这里所有改动也都是整份替换（`buildProgress.value = next`），
 * 所以浅层引用完全够用。
 */
export const buildProgress = shallowRef(new Set())
/** 建造模式默认显示第几块板 */
export const buildBoard = ref(0)

export const buildStats = computed(() => {
  const p = pattern.value
  if (!p) return { total: 0, done: 0, percent: 0, remaining: 0, complete: false }
  /* 空格不用拼，既不算进总数也不算"完成"。
     total 取图案统计里的豆数（生成 / 编辑收尾时已经整表数过一次），
     done 只遍历进度集合 —— 不再整表扫。
     为什么必须改：1000×1000 是 100 万格，而 Build Mode 每标一颗豆都会让这个
     computed 重算一遍；原来那种「1,000,000 次 cells 读取 + 1,000,000 次 Set.has」
     点一下要等半秒，逐颗拼制的模式等于没法用。
     进度集合里的下标只会落在真实豆子上（markBoard / markColor 都跳过空格），
     这里仍然判一次 cells[i] < 0，是防手动标记/老存档里混进空格。 */
  const total = p.stats && p.stats.beadCount != null ? p.stats.beadCount : beadCountOf(p.cells)
  let done = 0
  for (const i of buildProgress.value) if (p.cells[i] >= 0) done++
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 1000) / 10 : 0,
    remaining: Math.max(0, total - done),
    complete: total > 0 && done >= total
  }
})

/**
 * 每块板「要放几颗豆」（空格不算）。
 * 只跟图案有关，所以单独成一个 computed：编辑拼制进度时不必再逐格重算 ——
 * 1000×1000 有 1225 块板、100 万格，每标一颗豆都重扫一遍的话点一下要卡一秒。
 */
const boardBeadTotals = computed(() => {
  const p = pattern.value
  const lay = layout.value
  if (!p || !lay) return null
  const totals = new Int32Array(lay.boards.length)
  const w = p.width
  const bw = lay.boardSize.x
  const bh = lay.boardSize.y
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] < 0) continue
    const x = i % w
    const y = (i - x) / w
    totals[Math.floor(y / bh) * lay.cols + Math.floor(x / bw)]++
  }
  return totals
})

/** 每块板的完成情况：完成数从进度集合反推（O(已标记数)，不是 O(总格数)） */
export const buildBoards = computed(() => {
  const lay = layout.value
  const p = pattern.value
  if (!lay || !p) return []
  const totals = boardBeadTotals.value
  const done = new Int32Array(lay.boards.length)
  if (buildProgress.value.size) {
    const w = p.width
    const bw = lay.boardSize.x
    const bh = lay.boardSize.y
    for (const i of buildProgress.value) {
      if (p.cells[i] < 0) continue
      const x = i % w
      const y = (i - x) / w
      done[Math.floor(y / bh) * lay.cols + Math.floor(x / bw)]++
    }
  }
  return lay.boards.map((b, bi) => {
    const total = totals ? totals[bi] : 0
    const d = done[bi]
    return { ...b, cells: total, done: d, remaining: total - d, percent: total ? Math.round((d / total) * 1000) / 10 : 0 }
  })
})

export function toggleBuildCell(index) {
  const next = new Set(buildProgress.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  buildProgress.value = next
}

export function markBuildCell(index, done = true) {
  if (buildProgress.value.has(index) === done) return
  const next = new Set(buildProgress.value)
  if (done) next.add(index)
  else next.delete(index)
  buildProgress.value = next
}

export function markBoard(boardIndex, done = true) {
  const lay = layout.value
  if (!lay) return
  const b = lay.boards[boardIndex]
  if (!b) return
  const p = pattern.value
  const next = new Set(buildProgress.value)
  for (let y = b.y0; y < b.y0 + b.h; y++) {
    for (let x = b.x0; x < b.x0 + b.w; x++) {
      const i = y * p.width + x
      if (p.cells[i] < 0) continue // 空格不用拼
      if (done) next.add(i)
      else next.delete(i)
    }
  }
  buildProgress.value = next
}

export function markColor(colorId, done = true) {
  const p = pattern.value
  if (!p) return
  const pi = p.palette.findIndex(c => c.id === colorId)
  if (pi < 0) return
  const next = new Set(buildProgress.value)
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] !== pi) continue
    if (done) next.add(i)
    else next.delete(i)
  }
  buildProgress.value = next
}

export function clearBuild() {
  buildProgress.value = new Set()
}

/** 建造进度持久化（跟随项目存档） */
export function persistBuildProgress() {
  if (!currentProjectId.value) return
  const list = projects.value.slice()
  const idx = list.findIndex(p => p.id === currentProjectId.value)
  if (idx < 0) return
  list[idx] = { ...list[idx], buildProgress: [...buildProgress.value], updatedAt: Date.now() }
  projects.value = list
  persist()
}

/* ------------------------------------------------------------------ 完成作品 */

/**
 * 「完成」是创作流程的第三步，也是唯一一个**会改动存档与库存**的动作，
 * 所以它的状态一律挂在作品存档上（finishedAt / finishPhoto / finishDeduct …），
 * 而不是另开一份内存 ref：存档被保存、被覆盖、被打开时这些值自动跟着走，
 * 不会出现「界面说完成了、存档里什么都没有」的错位。
 */
export const currentProject = computed(() => projects.value.find(p => p.id === currentProjectId.value) || null)

/** 完成时间（0 = 还没完成） */
export const finishedAt = computed(() => (currentProject.value ? currentProject.value.finishedAt || 0 : 0))
export const isFinished = computed(() => finishedAt.value > 0)
/** 成品照片（本机 dataURL，最长边 ≤900px） */
export const finishPhoto = computed(() => (currentProject.value ? currentProject.value.finishPhoto || '' : ''))
/** 完成时实际扣掉的库存明细，用于取消完成时原样退回 */
export const finishDeducted = computed(() => (currentProject.value ? currentProject.value.finishDeduct || null : null))

/**
 * 图纸指纹（FNV-1a，13k 格也只是微秒级）。
 * 为什么需要：完成记录说的是「这件图纸我拼完了」。用户完成之后再回工作台改颜色数、
 * 换方案、重新生成，存档里的完成记录就和眼前的图纸不是一回事了。
 * 不去自动清掉记录（拼豆已经真的用掉了，退库存反而是假账），而是如实告诉用户
 * 「完成后图纸又改过」，让他自己决定取消完成还是保持原样。
 */
export function patternSignature(p) {
  if (!p || !p.cells) return ''
  /* 逐格按**色号**取值：色板下标的排列方式不该影响「这是不是同一张图纸」，
     而格子里的色号才是用户真正看到的东西。 */
  let h = 2166136261
  for (let i = 0; i < p.cells.length; i++) {
    const k = p.cells[i]
    const code = k < 0 ? '' : ((p.palette[k] && p.palette[k].code) || '?')
    for (let j = 0; j < code.length; j++) {
      h ^= code.charCodeAt(j)
      h = Math.imul(h, 16777619)
    }
    h ^= 31
    h = Math.imul(h, 16777619)
  }
  return `${p.width}x${p.height}:${p.palette.length}:${(h >>> 0).toString(36)}`
}

export const currentSignature = computed(() => patternSignature(pattern.value))
/** 已完成的作品，图纸在完成后又被改过 */
export const finishStale = computed(() => {
  const proj = currentProject.value
  if (!proj || !proj.finishedAt) return false
  const saved = proj.finishSignature || ''
  return !!saved && saved !== currentSignature.value
})

/** 图案里所有「要放豆」的格子（空格不用拼，永远不进进度） */
function allBuildIndexes(p) {
  const set = new Set()
  if (!p || !p.cells) return set
  for (let i = 0; i < p.cells.length; i++) if (p.cells[i] >= 0) set.add(i)
  return set
}

/**
 * 完成前的结算预览：要用多少豆、其中多少能从库存里扣、还缺多少。
 * 先给用户看清楚再动手 —— 完成会真扣库存，不能点完才知道扣了什么。
 */
export const finishPlan = computed(() => {
  const p = pattern.value
  if (!p) return null
  const rows = materialList(p, inventory.value).rows
  const need = rows.reduce((s, r) => s + r.count, 0)
  const fromStock = rows.reduce((s, r) => s + Math.min(r.owned || 0, r.count), 0)
  return {
    rows,
    need,
    fromStock,
    lack: Math.max(0, need - fromStock),
    colors: rows.length,
    colorsFromStock: rows.filter(r => (r.owned || 0) > 0).length,
    finishedColors: rows.filter(r => (r.owned || 0) >= r.count).length
  }
})

/**
 * 标记「作品完成」。
 *
 * 做的事（缺一不可，否则「完成」就只是个装饰）：
 *   ① 先确保作品已存档 —— 完成记录得有地方放；没存过就先存一次；
 *   ② 按材料表扣减本机库存（严格按实扣，缺的部分不动库存）；
 *   ③ 把拼制进度补满（空格不算），让进度条、作品列表、成长体系口径一致；
 *   ④ 记下完成时间 / 成品照片 / 扣了多少豆，以及完成前的进度（供撤销回退）。
 *
 * @returns {{ok:boolean, reason?:string, deducted?:object, beads?:number, fromStock?:number}}
 */
export function finishProject({ photo = '', note = '', deduct = true } = {}) {
  const p = pattern.value
  if (!p) {
    toastWarn('先生成一张图纸，再标记完成')
    return { ok: false, reason: 'no-pattern' }
  }
  let id = currentProjectId.value
  if (!id || !projects.value.some(x => x.id === id)) {
    id = saveProject()
    if (!id) return { ok: false, reason: 'save-failed' }
  }
  const idx = projects.value.findIndex(x => x.id === id)
  if (idx < 0) return { ok: false, reason: 'missing' }
  const proj = projects.value[idx]
  if (proj.finishedAt) return { ok: false, reason: 'already' }

  const plan = finishPlan.value
  const deducted = deduct && plan
    ? consumeMaterials(plan.rows.map(r => ({ id: r.id, count: r.count })))
    : {}
  const prevProgress = [...buildProgress.value]
  const all = allBuildIndexes(p)
  const fromStock = Object.values(deducted).reduce((s, n) => s + n, 0)

  const list = projects.value.slice()
  list[idx] = {
    ...proj,
    finishedAt: Date.now(),
    finishPhoto: photo || '',
    finishNote: (note || '').trim(),
    finishDeduct: Object.keys(deducted).length ? deducted : null,
    completedBeads: all.size,
    finishSignature: currentSignature.value,
    progressBeforeFinish: prevProgress,
    buildProgress: [...all],
    updatedAt: Date.now()
  }
  const before = projects.value
  projects.value = list
  // 存档写不进去（配额满）时必须整体回滚：库存已经扣了、完成却没记下来是最糟的结果
  if (!persist()) {
    projects.value = before
    restoreMaterials(deducted)
    return { ok: false, reason: 'quota' }
  }
  buildProgress.value = all
  toastOk(`已完成「${projectName.value}」：${all.size.toLocaleString()} 颗豆${fromStock ? `，库存扣掉 ${fromStock.toLocaleString()} 颗` : ''}`)
  return { ok: true, deducted, beads: all.size, fromStock }
}

/**
 * 取消完成（误点可撤销）。
 * 三件事一起回退：库存加回去、完成痕迹清掉、拼制进度回到完成前的样子。
 * 可以传 id —— 作品列表 / 详情页要能撤销**任意一件**作品的完成状态。
 */
export function unfinishProject(id = currentProjectId.value) {
  const idx = projects.value.findIndex(x => x.id === id)
  if (idx < 0) {
    toastWarn('这件作品不在这台设备上')
    return false
  }
  const proj = projects.value[idx]
  if (!proj.finishedAt) return false
  const restored = restoreMaterials(proj.finishDeduct)
  const prev = Array.isArray(proj.progressBeforeFinish) ? proj.progressBeforeFinish : []
  const list = projects.value.slice()
  list[idx] = {
    ...proj,
    finishedAt: 0,
    finishPhoto: '',
    finishNote: '',
    finishDeduct: null,
    completedBeads: 0,
    finishSignature: '',
    progressBeforeFinish: null,
    buildProgress: prev.length ? prev : null,
    updatedAt: Date.now()
  }
  projects.value = list
  persist()
  if (id === currentProjectId.value) buildProgress.value = new Set(prev)
  toastOk(restored
    ? `已取消完成：拼制进度回到完成前，${restored.toLocaleString()} 颗豆已退回库存`
    : '已取消完成：拼制进度回到完成前')
  return true
}

/** 完成后补 / 换成品照片（分享卡第三格就用它） */
export function attachFinishPhoto(dataUrl) {
  const idx = projects.value.findIndex(x => x.id === currentProjectId.value)
  if (idx < 0 || !projects.value[idx].finishedAt) return false
  const list = projects.value.slice()
  list[idx] = { ...list[idx], finishPhoto: dataUrl || '', updatedAt: Date.now() }
  projects.value = list
  persist()
  return true
}

/**
 * 成品照片存进本机前先压一遍。
 * 为什么要压：存档在 localStorage（通常只有 5MB），手机原图动辄 3~5MB，
 * 直接存会把整个「我的作品」写爆 —— 表现是完成成功了、下次打开作品全没了。
 * 最长边 900px + JPEG 0.82 大约 150~300KB，分享卡那一格够用。
 */
export async function photoToStoredUrl(file, maxSize = 900) {
  const { img, url } = await fileToImage(file)
  try {
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) throw new Error('照片读取失败')
    const k = Math.min(1, maxSize / Math.max(iw, ih))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(iw * k))
    c.height = Math.max(1, Math.round(ih * k))
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.82)
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}

/** dataURL / blobURL → 可 drawImage 的 Image（分享卡要把它画进第三格） */
export function loadImageFromUrl(src) {
  return new Promise((resolve, reject) => {
    if (!src) { reject(new Error('没有图片')); return }
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('图片读取失败'))
    im.src = src
  })
}

/* ------------------------------------------------------------------ 工具 */

export function resetZoom() {
  zoom.value = 1
}

export function setZoom(v) {
  /* 下限 0.1 而不是 0.4：1000 格画布的 baseCell 只有 0.5~0.6 px/格，
     「适应窗口」算出来的缩放会低于 0.4，夹在 0.4 就等于没有适应 ——
    图案仍然比舞台大，用户以为按钮坏了。上限 8 不变（真实上限由渲染层的像素预算管，
    见 render.js 的 chartCellCap：放不下时会停在能画的最大格子尺寸上并给出提示）。 */
  zoom.value = Math.max(0.1, Math.min(8, Math.round(v * 100) / 100))
}

export function zoomBy(d) {
  setZoom(zoom.value + d)
}

/**
 * 设定画布尺寸（单位：格）。
 *
 * 规格口径见 lib/boardSpec.js：界面上的档位与自定义都落在 52 / 78 / 104 / 120 的整数倍上，
 * 但这里**不强制**取整 —— 老存档（58 / 116 / 300 / 450）在重新生成时仍要按原样落地，
 * 否则「打开旧作品 → 想改一下参数 → 尺寸被悄悄换掉」。
 *
 * silent 给「自定义尺寸实时预览」用：用户每改一次块数都会套用画布，每次都弹
 * 「已生成 N 个方案」会把提示栏刷满，而实时预览的反馈应该由输入框旁边那行字承担。
 * 失败（生成异常 / 无图）仍然会提示，不吞错误。
 *
 * announce：一次性动作（换底板 / 点尺寸快选）传 true，拖滑杆传 false。
 *
 * 口径（2026-11-01 用户定稿）：换尺寸分成两部分 ——
 *   · **原图部分**永远按原图在新尺寸上重新取样（每个尺寸的效果都来自原图，放大长细节、
 *     缩小块合并），不复制工作区里那张已经缩过的图；
 *   · **修改过的部分**按**修改那一刻的尺寸**缩放（editLayer）：在 104 上改的一颗，
 *     缩到 52 再放回 104 仍是那一颗；在 52 上改的一颗，放大到 104 是 2×2 一块。
 *   · 不弹层、不遮盖手改；没有源图（老存档且没快照）才退回按当前图纸块缩放。
 *
 * @returns {{ resampled: boolean, keptEdits: number }|{ scaled: boolean, croppedBeads: number, moved: boolean, boardChanged: boolean }|null}
 */
export function setCanvasSize(w, h, { silent = false, announce = true } = {}) {
  const max = maxCells.value
  /* 画布规格（容量）是这次的上限：成品尺寸只能在容量里缩，不能缩到比容量还大。
     容量由 ②「画布规格」写入（见 setCanvasCapacity），老存档容量 = 画布本身。 */
  const capW = Math.min(max, canvasCapW.value)
  const capH = Math.min(max, canvasCapH.value)
  const cw = Math.max(1, Math.min(max, capW, Math.round(w) || 1))
  const ch = Math.max(1, Math.min(max, capH, Math.round(h) || 1))
  if (cw !== w || ch !== h) {
    if (!silent) toast(ALL_FREE
      ? `单边最大 ${max} 格，已按上限收敛`
      : `当前套餐单边最大 ${max} 格，升级 Pro 可到 ${MAX_CELLS} 格（按规格一块一块加，104 × 9 = 936 这种）`, 'warn')
  }
  if (cw === options.canvasW && ch === options.canvasH) return
  const prevW = options.canvasW
  const prevH = options.canvasH
  options.canvasW = cw
  options.canvasH = ch

  /* 有真原图：按新尺寸重新取样整张图，再把修改层按它自己的分辨率落回去。
     原图部分因此永远跟着原图走，修改部分保留「改那一刻」的精度。
     老存档的源图是按图纸重建的（sourceFromPattern）—— 那不是原图，放大也只能铺块，
     走下面的按块缩放更忠实（颜色一颗不变），不去假装重新取样。 */
  if (sourceUrl.value && !sourceFromPattern.value && variants.value.length) {
    const layers = collectEditLayers()
    /* silent 交给调用方：一次重新取样要几百毫秒，提示由下面这一条 / 左栏说明行承担 */
    const ok = regenerate({ silent: true })
    if (!ok) {
      options.canvasW = prevW
      options.canvasH = prevH
      return null
    }
    const kept = applyEditLayers(layers)
    if (kept) {
      manualEdited.value = true
      saveStatus.value = '未保存'
    }
    if (announce) {
      toastOk(`已按原图重新缩放到 ${cw} × ${ch} 格${kept ? '，手工修改按原尺寸保留' : ''}`)
    }
    return { resampled: true, keptEdits: kept }
  }

  /* 没有源图（老存档且没带快照）：只能按当前图纸块缩放，手改跟着格子走 */
  if (variants.value.length) return resizeVariantsPreserving(cw, ch, { silent, announce })
  return null
}

/**
 * 设定「画布规格」= 底板大小（单位：格）。
 *
 * 成品尺寸滑块的上限、自动匹配的上限都读它；成品区域（canvasW/H）可以比它小。
 * 规格变小时成品区域会被裁到画布里（否则界面上会出现「成品 312 × 312，画布 104 × 104」）。
 * 只是换底板（成品区域放得下）时**不重新取样**：把现有方案重新居中贴一遍就行。
 * 没有源图时直接把成品区域也落到画布上：空画布选规格，用户要看到的就是这块板的大小。
 */
export function setCanvasCapacity(w, h, { silent = false, announce = true } = {}) {
  const max = maxCells.value
  const cw = Math.max(1, Math.min(max, Math.round(w) || 1))
  const ch = Math.max(1, Math.min(max, Math.round(h) || 1))
  if (cw === options.canvasMaxW && ch === options.canvasMaxH) return false
  options.canvasMaxW = cw
  options.canvasMaxH = ch
  const aw = Math.min(options.canvasW, cw)
  const ah = Math.min(options.canvasH, ch)
  if (aw !== options.canvasW || ah !== options.canvasH) {
    /* 底板换小了，原来的图放不下：手改过的图按比例缩到新的成品区域，
       没手改过的图照旧按新尺寸重新取样 —— 两边画面大小一致，
       不会一个缩小一个被裁掉（2026-10-29 用户反馈「切换钉板画面会裁掉」）。 */
    setCanvasSize(aw, ah, { silent, announce })
  } else if (!sourceUrl.value) {
    setCanvasSize(cw, ch, { silent: true, announce })
  } else {
    /* 底板换了，成品区域没变：重新贴一遍。格子下标整体平移了，拼制进度得清掉。 */
    repadVariants(cw, ch)
    if (buildProgress.value.size) buildProgress.value = new Set()
    saveStatus.value = '未保存'
  }
  return true
}

/** 一键可拼性优化（PRD P0 AI优化） */
export function optimizeBuildability() {
  const gate = check('optimize.buildability')
  if (!gate.ok) {
    toastWarn(gate.reason)
    return false
  }
  options.cleanup = true
  options.dither = 'off'
  options.targetColors = Math.min(options.targetColors, 16)
  const ok = regenerateActive()
  if (ok) toastOk('已优化可拼性：关闭抖动、清理孤立豆、收敛颜色数')
  return ok
}

/** 恢复方案（PRD 交互原则 4：所有结果都要可逆） */
export function restoreVariant() {
  const ok = regenerate()
  if (ok) toastOk('已按当前参数恢复方案')
  return ok
}
