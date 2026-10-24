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
  buildability, estimateMinutes, readImagePixels, MAX_SOURCE_SIDE, colorFloorForCells
} from '../lib/pattern.js'
/* 拼板规格（52 / 78 / 104 / 120 钉画线板）与豆径（2.6mm 小豆 / 5mm 中号豆）的唯一口径 */
import {
  BEADS, BEAD_KEYS, DEFAULT_BEAD, BOARD_SPECS, BOARD_MIN, SIZE_TIERS,
  beadOf, autoBeadKey, boardSpecFor, boardProfile, boardsText, boardsTextShort,
  isWholeBoard, snapSpec, snapTier, tierBox, customBox
} from '../lib/boardSpec.js'
import { packPattern, unpackPattern, packProgress, unpackProgress } from '../lib/archive.js'
import { packCellColors } from '../lib/render.js'
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
 * 手机上「已生成图纸」的紧凑提示（桌面端仍走原来的 toast）。
 * 只在 ≤780px 上传照片、自动匹配画布后写入；字段全部来自真实生成结果，
 * 界面上的「当前图纸」另外读 pattern 的宽高，用户改过尺寸就以实时值为准。
 */
export const fitNotice = ref(null)
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
export const zoom = ref(1)
export const tool = ref('paint')
/** 画笔 / 橡皮的笔刷边长（格）。1 = 原来的单格编辑，大笔刷用于大面积涂改 */
export const brushSize = ref(1)
export const BRUSH_MAX = 32
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
  return {
    ...p,
    width: bw,
    height: bh,
    artW: aw,
    artH: ah,
    cells,
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
    palette
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
 * 开始一次可撤销的编辑。可以嵌套：内层只记深度，不覆盖外层的快照
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
  /* 挂起的统计重算在这里补上：整笔编辑期间只算这一次 */
  flushPendingStats()
  const snap = pendingSnap
  pendingSnap = null
  if (!snap || sameAsCurrent(snap)) return false
  undoStack.push(snap)
  if (undoStack.length > historyLimit()) undoStack.shift()
  redoStack.length = 0
  saveStatus.value = '未保存'
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

/** 清空历史（重新生成 / 换方案 / 打开存档时用：图纸换了，旧步骤没有意义） */
function clearHistory() {
  undoStack.length = 0
  redoStack.length = 0
  editDepth = 0
  pendingSnap = null
  syncHistoryFlags()
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
    colors: snap.palette.map(c => c.id)
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
    const size = Math.min(BRUSH_MAX, Math.max(1, Math.round(brushSize.value) || 1))
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

function sourceImage() {
  return sourceImg.value
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
      cartoonStyle: options.cartoon ? options.cartoonStyle : ''
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
      beadKey: options.beadKey || autoBeadKey(cw, ch)
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

export function loadImageSource(img, url, name = '', kind = 'raster') {
  sourceImg.value = img
  sourceUrl.value = url
  sourceName.value = name
  sourceKind.value = kind
  /* 宽高比默认就是图片本身的；源图自带透明背景时会被 autoFitForSource 换成
     「主体包围盒」的比例（贴纸的花边留白不该占格子，见那里的说明）。 */
  const sw = (img && (img.naturalWidth || img.width)) || 0
  const sh = (img && (img.naturalHeight || img.height)) || 0
  sourceAspect.value = sw > 0 && sh > 0 ? sw / sh : 1
  if (name) projectName.value = name
  /* 换了图，上一张的卡通预览必须作废：否则缩略图上「卡通」那一栏
     显示的还是上一张脸的卡通，看着就像卡通化没生效。 */
  cartoonPreviewUrl.value = ''
  previewMode.value = options.cartoon ? 'cartoon' : 'source'
  if (options.cartoon) refreshCartoonPreview()
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
  loadImageSource(img, url, file.name.replace(/\.[^.]+$/, ''))
  autoFitForSource(img)
  /* 手机上成功结果由画布上方的「已生成图纸」卡承担，不再弹长 toast；
     只有抠背景没生效这种需要用户知道的失败才补一条短提示。 */
  const mobile = isMobileViewport()
  const ok = regenerate({ silent: mobile })
  /* 生成失败时撤掉提示卡：卡上写的是「已生成图纸」，不能和失败 toast 同时出现。 */
  if (mobile && !ok) fitNotice.value = null
  if (mobile && ok && options.removeBg) {
    const m = variants.value[0] && variants.value[0].matte
    if (m && !m.applied) toastWarn(`没能去背景：${m.reason || '未检测到明显背景'}`)
  }
  return ok
}

/**
 * 上传**照片**时自动匹配画布与色号（素材库的矢量素材走 useAsset，不在这里）。
 *
 * 为什么必须自动：默认值（29×29 格、16 色）是给「1 块底板的小图」准备的，
 * 而用户上传照片想要的是「像我拍的那张」。让他自己去猜"该填多少格、多少色"，
 * 结果就是所有照片都停在 116 格 / 16 色上，然后得出"这工具转不像"的结论 ——
 * 他真正缺的不是耐心，而是「这张图到底能细到什么程度」这个答案。
 *
 * 口径（两条，都能用一句话交代清楚）：
 *   ① 一格至少摊到 2 个源像素：这是超采样还能生效的下限（SS=2 需要每格 2×2 个源像素
 *      才谈得上面积平均 + 多数投票，再密就是插值出来的假细节，见 maxUsefulSupersample）；
 *      所以长边 = 源图长边 ÷ 2。
 *   ② 长边封顶 500：500 格长边约 25 万格、生成 1 秒出头（450² 实测 0.76~0.93s）、
 *      存档约 0.75 MB（三个方案），仍在"上传完就能看"的范围里。
 *      再往上（750/1000）是 56~100 万格、要 5 秒、存档 3 MB（实测本机只放得下 1 件），
 *      豆子用量也从几万颗跳到几十万颗，而且成品是 2.5 m 以上的挂画量级 ——
 *      这种量级必须是用户自己点的，不能替他决定，所以它留在右边的
 *      「超清 750 / 极限 1000」两档里。
 *
 *      ⚠️ 这个封顶以前是 300，而 ① 对一张 1000 边的原图算出来就是 500 —— 也就是说
 *      **上限把规则 ① 盖掉了**：用户看到的"自动匹配"其实是"自动少给一半格子"。
 *      两个口径必须一致，否则「一格 2 个源像素」这句话在界面上是假的。
 *
 * 只往上抬、不往下压：源图本来就小（比如 200×250 的图）时给出它自己的尺寸即可，
 * 画得比原图还大只是把插值出来的假细节摊成格子。免费版仍按套餐上限收敛。
 *
 * 贴纸（源图自带透明背景）要多做一步：画布比例取**主体包围盒**的比例，而不是整张图的比例。
 * 不这么做的话，一张 400×500 的贴纸（主体只有中间 320×100 的横条）会被放进 2:5 的画布，
 * 主体只占中间一小条 —— 实测 200×250 的画布里 77% 是空格，那些格子不但白占画布，
 * 还会被分板、材料表和 PDF 当成"要拼的区域"，白白多切几十块底板。
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

function autoFitForSource(img) {
  const sw = (img && (img.naturalWidth || img.width)) || 0
  const sh = (img && (img.naturalHeight || img.height)) || 0
  if (!(sw > 0 && sh > 0)) return false

  /* 透明贴纸：先量出主体包围盒（estimateMatte 走的就是生成时会用的那条 alpha 分支，
     两处口径必须一致，否则画布比例和实际裁剪结果对不上）。读像素失败的极端情况退回整图比例。 */
  let subject = null
  try {
    const px = readImagePixels(img)
    if (px.transparent) {
      const m = estimateMatte(px.data, px.width, px.height, { level: options.matteLevel })
      if (m && m.ok && m.stats && m.stats.transparent && m.bbox) {
        subject = m.bbox
        sourceAspect.value = m.bbox.w / m.bbox.h
      }
    }
  } catch { /* 读像素失败：按整图比例走 */ }
  if (!subject) sourceAspect.value = sw / sh

  const box = subject || { w: sw, h: sh }
  const long = Math.max(box.w, box.h)
  /* 自动匹配只在**整块板**上落点：先按「一格摊到 2 个源像素」求理想长边（长边 ÷ 2），
     吸附到档位阶梯，再由 tierBox 在**同一规格**里按原图比例挑块数
     （正方图 → 3 × 3 块 104 = 312×312；3:4 竖图 → 3 × 4 块 78 = 234×312）。
     为什么不能两个方向各按各的规格吸附：78 宽 × 104 高这种矩形没有对应的实物板。 */
  const AUTO_MAX = SIZE_TIERS[SIZE_TIERS.length - 1].n
  let tier = snapTier(Math.round(long / 2), { max: Math.min(AUTO_MAX, maxCells.value) })
  /* 用户自己已经把画布开到最高档以上（自定义更大）时保留他选的档位，
     只按新图的比例重排 —— 「我明明开到 416 格，换张图就变回 312」是纯粹的意外。 */
  const currentLong = Math.max(Number(options.canvasW) || 0, Number(options.canvasH) || 0)
  if (currentLong > AUTO_MAX) tier = currentLong
  const fit = tierBox({ n: tier }, sourceAspect.value)
  let w = fit.w
  let h = fit.h

  /* 套餐上限：免费版单边 52 格（一块 52 板），换到能放下的最高档 —— 同一规格，不混板 */
  if (Math.max(w, h) > maxCells.value) {
    const small = snapTier(Math.min(maxCells.value, AUTO_MAX), { max: Math.min(maxCells.value, AUTO_MAX) })
    const shrunk = tierBox({ n: small }, sourceAspect.value)
    w = shrunk.w
    h = shrunk.h
  }
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
    cap,
    autoMax: AUTO_MAX
  })

  /* 换图时画布规格跟着这张图重算：容量 = 自动匹配出来的整板尺寸，
     成品尺寸滑块从「这张图推荐的大小」开始往上限走。 */
  options.canvasMaxW = w
  options.canvasMaxH = h
  if (w === options.canvasW && h === options.canvasH) return false

  options.canvasW = w
  options.canvasH = h
  if (!mobileNotice) {
    toast(
      `已按${subject ? '主体' : '原图'} ${Math.round(box.w)}×${Math.round(box.h)} 像素把画布设成 ${w} × ${h} 格`
      + `（${cells} 格，一格摊到约 ${perCell.toFixed(1)} 个源像素）`
      + (raisedColors ? `，颜色数 ${raisedColors} → ${options.targetColors}` : '')
      + (cap < AUTO_MAX ? `。免费版单边上限 ${cap} 格，升 Pro 可以到 ${AUTO_MAX} 格（自定义还能更大）` : `。想更细可点「${SIZE_TIERS[SIZE_TIERS.length - 1].name} ${AUTO_MAX}」，或用「自定义尺寸」按规格再加板`),
      '', 7000
    )
  }
  return true
}

export async function useAsset(asset) {
  const { img, url } = await svgToImage(asset.svg)
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
  /* 手机上不弹「已生成 N 个方案」长提示：它会盖住画布中央，
     而选完素材后图案本身就换好了，不需要再用 toast 确认。 */
  return regenerate({ silent: isMobileViewport() })
}

/* ------------------------------------------------------------------ 项目存档 */

function readProjects() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PROJECTS) || '[]')
    if (!Array.isArray(raw)) return []
    /* 存档是紧凑格式（见 lib/archive.js）：进度是位图字符串，这里还原成下标数组；
       老存档里本来就是数组，unpackProgress 原样返回。
       progressBeforeFinish（完成前的进度快照）也走同一套：1000×1000 完成一次是 100 万个下标，
       按 JSON 数组存约 5 MB，比图纸本身还大 —— 必须一起压。 */
    return raw.map(p => {
      if (!p) return p
      let out = p
      if (typeof out.buildProgress === 'string') out = { ...out, buildProgress: unpackProgress(out.buildProgress) }
      if (typeof out.progressBeforeFinish === 'string') out = { ...out, progressBeforeFinish: unpackProgress(out.progressBeforeFinish) }
      return out
    })
  } catch {
    return []
  }
}

export const projects = ref(readProjects())

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
    /* 落盘那一刻才打包进度位图：内存里始终是下标数组（Build Mode 每标一颗都要改），
       只在写 localStorage 时压一次，读回来再还原，两边不用各自记两套格式。
       progressBeforeFinish 同理（1000×1000 是 100 万个下标，数组存不下）。 */
    const payload = projects.value.map(p => {
      if (!p) return p
      let out = p
      if (Array.isArray(out.buildProgress) && out.buildProgress.length) out = { ...out, buildProgress: packProgress(out.buildProgress) }
      if (Array.isArray(out.progressBeforeFinish) && out.progressBeforeFinish.length) out = { ...out, progressBeforeFinish: packProgress(out.progressBeforeFinish) }
      return out
    })
    text = JSON.stringify(payload)
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
  return true
}

export function projectLimit() {
  return can('projects.limit', MAX_PROJECTS_PRO) ? MAX_PROJECTS_PRO : MAX_PROJECTS_FREE
}

export function saveProject(name) {
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
    variants: variants.value.map(v => ({
      key: v.key,
      label: v.label,
      tagline: v.tagline,
      stats: v.stats,
      recommended: v.recommended,
      data: packPattern(v.active || v)
    })),
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

  const list = projects.value.slice()
  const idx = list.findIndex(x => x.id === payload.id)
  if (idx >= 0) list[idx] = { ...list[idx], ...payload }
  else list.unshift(payload)
  /* 体积超预算就只存当前方案（见 trimVariantsToFit）：1000×1000 三个方案 300 万字符，
     直接写会顶爆 localStorage 的 500 万配额，结果是一次都存不下 */
  const trimmed = trimVariantsToFit(list, payload.id)
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
    buildProgress.value = proj.buildProgress ? new Set(proj.buildProgress) : new Set()
    /* 完成的作品进度必须是满的：老存档 / 只写了 finishedAt 的存档补一次，
       否则会出现「顶栏打了 ✓、进度条却是 0%」的自相矛盾。 */
    if (proj.finishedAt && !buildProgress.value.size) {
      buildProgress.value = allBuildIndexes(pattern.value)
    }
    clearHistory()
    saveStatus.value = '已打开存档'
    // 恢复预览：用图案自己画一张，不依赖原图
    rebuildThumbSource()
    return true
  } catch (e) {
    toastErr('打开失败')
    return false
  }
}

/**
 * 从存档打开时没有源图，但编辑/重新生成需要源图。
 * 这里把当前图案合成一张位图当作"源图"，保证「重新生成」不会报错。
 */
function rebuildThumbSource() {
  const p = pattern.value
  if (!p) return
  let c
  if (Math.max(p.width, p.height) > THUMB_STRAIGHT_MAX) {
    /* 大画布直接按 1 格 1 像素重建：原来的 320 px 缩略图再拿去「重新生成」，
       等于先把图纸降采样一遍 —— 1000 格的图会掉到约 1/3 分辨率，
       用户点「恢复方案」会以为自己把图弄糊了。位图路径下 1:1 与缩略图一样快。 */
    c = patternBitmap(p)
  } else {
    const scale = Math.max(1, Math.round(320 / Math.max(p.width, p.height)))
    c = document.createElement('canvas')
    c.width = p.width * scale
    c.height = p.height * scale
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const col = p.palette[p.cells[y * p.width + x]]
        if (!col) continue
        ctx.fillStyle = col.hex
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
    }
  }
  const url = c.toDataURL('image/png')
  const im = new Image()
  im.onload = () => {
    sourceImg.value = im
    sourceUrl.value = url
    /* 从存档重建出来的源图是**这张图纸自己**的位图：比例、种类都要跟着换，
       否则精细档会拿着「上一张照片」的比例去算格子（跨作品切来切去时必然歪）。 */
    sourceKind.value = 'raster'
    sourceAspect.value = p.width / p.height
  }
  im.src = url
}

export function deleteProject(id) {
  projects.value = projects.value.filter(p => p.id !== id)
  persist()
  if (currentProjectId.value === id) currentProjectId.value = ''
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
 */
export function setCanvasSize(w, h, { silent = false } = {}) {
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
  options.canvasW = cw
  options.canvasH = ch

  /* 改完画布尺寸必须重新生成。
     图案自己的 width/height 是生成那一刻定下来的，只改 options 的话
     界面会显示「画布 58 × 58 格」而画布上还是旧的 29 × 29 图案 ——
     用户点「2 块」看起来就是按钮没反应（实测确实是：改了 options，
     pattern 仍停在 29×29）。其余参数（颜色数 / 填充方式 / 色板）都走
     regenerate，这里保持一致。 */
  if (sourceUrl.value) regenerate({ silent })
}

/**
 * 设定「画布规格」= 底板大小（单位：格）。
 *
 * 成品尺寸滑块的上限、自动匹配的上限都读它；成品区域（canvasW/H）可以比它小。
 * 规格变小时成品区域会被裁到画布里（否则界面上会出现「成品 312 × 312，画布 104 × 104」）。
 * 只是换底板（成品区域放得下）时**不重新取样**：把现有方案重新居中贴一遍就行。
 * 没有源图时直接把成品区域也落到画布上：空画布选规格，用户要看到的就是这块板的大小。
 */
export function setCanvasCapacity(w, h, { silent = false } = {}) {
  const max = maxCells.value
  const cw = Math.max(1, Math.min(max, Math.round(w) || 1))
  const ch = Math.max(1, Math.min(max, Math.round(h) || 1))
  if (cw === options.canvasMaxW && ch === options.canvasMaxH) return false
  options.canvasMaxW = cw
  options.canvasMaxH = ch
  const aw = Math.min(options.canvasW, cw)
  const ah = Math.min(options.canvasH, ch)
  if (aw !== options.canvasW || ah !== options.canvasH) {
    setCanvasSize(aw, ah, { silent })
  } else if (!sourceUrl.value) {
    setCanvasSize(cw, ch, { silent: true })
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
