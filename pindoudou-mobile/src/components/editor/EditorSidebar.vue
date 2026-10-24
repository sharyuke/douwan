<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  options, sourceUrl, sourceName, projectName, hasPattern, stats, saveStatus,
  width, height, brand, paletteLimited, maxCells, canvasOverSource, availableColors,
  canvasCapW, canvasCapH, regenerate, setCanvasSize, setCanvasCapacity, restoreVariant, canUndo,
  selectVariant, generating, activeKey, variants as variantList,
  lastSearch, matteInfo, matteLevels, setRemoveBg, setMatteLevel,
  cartoonInfo, cartoonStyles, setCartoonStyle,
  cartoonPreviewUrl, previewMode, refreshCartoonPreview, yieldForBusyPaint, sourceImg, sourceKind, sourceAspect,
  bead, SIZE_TIERS, BOARD_SPECS, BOARD_MIN, boardSpecFor, boardsText, boardsTextShort,
  isWholeBoard, snapTier, tierBox, customBox,
  saveProject, buildStats, buildBoards, buildBoard, isFinished, finishedAt
} from '../../composables/useStudio.js'
import { PALETTE_BRANDS } from '../../lib/palettes.js'
/* 板 / 豆径 / 成品的口径全在 lib/boardSpec.js：这一块要显示「豆子多大 · 板子多大 · 成品多大」，
   三个数各有出处，不能自己乘一遍（口径见该文件头） */
import {
  BOARDS, BOARD_SPEC_LIST_TEXT, DEFAULT_BEAD_TEXT,
  boardOf, beadLabel, boardOuterText, finishCmText
} from '../../lib/boardSpec.js'
import { MAX_TARGET_COLORS, MAX_SOURCE_SIDE, colorFloorForCells } from '../../lib/pattern.js'
import { buildStars, buildabilityLabel, similarityLabel, signedPct, num, timeAgo } from '../../lib/forge.js'
import { toastOk, toastWarn, toast } from '../../composables/useToast.js'
import { useImageFile } from '../../composables/useStudio.js'
import { takePendingUpload } from '../../composables/usePendingUpload.js'
import { ASSET_COUNT, hotAssets, freeAssets, pickAsset } from '../../composables/useAssets.js'
import { AI_PENDING_TEXT } from '../../lib/aiPending.js'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({
  /* 手机端弹层：只显示 focus 指定的那张卡（'' = 桌面完整侧栏）。
     create / size / scheme / palette 四个值，对应命令栏里的四个按钮。 */
  focus: { type: String, default: '' }
})

const emit = defineEmits(['need-pro', 'need-create', 'open-delivery', 'close-panel'])

const route = useRoute()

const fileInput = ref(null)
const dragOver = ref(false)
const busy = ref(false)
/* ④「⚙ 抖动 / 去孤立豆 / 格内色号」的折叠（③ 那个「更多设置」折叠已按需求删除） */
const advancedOpen = ref(false)

/* ---------------------------------------------------------------- 卡片的默认折叠
   ① 创建保持展开；②③④⑤ 都默认收起，卡头右侧共用同一颗 .cardArrow，
   点它再展开。工作台是一整页滚动，默认摊开会把图纸挤远。 */
const openMore = ref(props.focus === 'palette')
function onMoreFoldClick() {
  openMore.value = !openMore.value
}
const openScheme = ref(props.focus === 'scheme')
const openBuild = ref(false)

/* ---------------------------------------------------------------- 手机端的下拉
   ①「图片处理」三选一、③ 方案 3+1 格、④ 填充方式 2 格 —— 这几组
   都是有明确单选语义的「选项」，在手机上却要排 1~4 行按钮（合计 400px 上下的版面）。
   手机上换成原生下拉：一行一个，语义一样，省下来的高度还给图纸。

   （② 画布大小从这份名单里出去了：它现在是一行 + 弹出列表，
   手机与桌面用同一份列表，靠 CSS 决定「浮在右侧」还是「就地铺开」。）

   只在 ≤780px 出现（.mDrop 默认 display:none，见文件末尾 scoped 样式），桌面端仍是
   原来那套按钮网格（网格挂 .mHide，手机上让位）。两套控件绑的是同一份状态，
   所以桌面端的行为一行没变。

   为什么这里一律 :value + @change，而不是 v-model：<select> 的 v-model 也监听
   change，而元素上的 props 监听先于指令注册 —— 同一个 change 事件里 @change 先跑，
   v-model 还没把值写回，onColorsChange() 读到的就是旧值（滑杆没这个问题：range 的
   v-model 走 input 事件，先于 change）。 */

/** 手机端「颜色数量」下拉的档位梯子：常用色数 + 当前值 + 上限，保证永远选得到自己。
 *  梯子只到 221 —— 再往上留 264（= MARD 264 套装）与 291（= 最大色板）两个有意义的点，
 *  中间那一小段没必要逐档铺开，直接输入框敲也行。 */
const COLOR_STEPS = [4, 6, 8, 10, 12, 16, 20, 24, 30, 32, 36, 40, 48, 56, 64, 72, 80, 96, 112, 128, 160, 192, 221, 264]

/* ---------------------------------------------------------------- 三个来源
   参考版的「① 先选你要拼什么」把三条入口做成三个页签（上传图片 / AI生成素材 /
   免费素材库），选完直接在画布出图 —— 没有中间页。
   AI 生成素材依赖服务端生图，目前只放占位文案。
   外链仍然可以用 ?tab=ai / ?tab=library 直接落到某个入口。 */
const SOURCE_KEYS = ['photo', 'ai', 'library']
const sourceMode = ref(SOURCE_KEYS.includes(route.query.tab) ? route.query.tab : 'photo')
const sourceTabs = [
  { key: 'photo', icon: 'photo', label: '上传图片' },
  { key: 'ai', icon: 'sparkles', label: 'AI生成素材' },
  { key: 'library', icon: 'palette', label: '免费素材库' }
]
/**
 * 侧栏只列 6 个「一眼可选」的（完整素材在素材中心）。
 * 这里只放免费素材：这个入口叫「免费素材库」，点第一个就弹「会员专属」
 * 是最让人反感的体验；会员素材的可见性留给素材中心那页去做。
 */
const libraryPicks = computed(() => {
  const hotFree = hotAssets.filter(a => a.tier === 'free')
  const restFree = freeAssets.filter(a => !hotFree.includes(a))
  return [...hotFree, ...restFree].slice(0, 6)
})

/* ---------------------------------------------------------------- 图片处理
   参考版把「原图 / 智能抠图 / 卡通风格」做成同级的三个页签，选中项在下面
   展开自己的细节（抠图三档力度、卡通三档风格）。
   它俩都不是开关，而是「用哪条路线处理这张图」的三选一 ——
   做成开关会让人以为可以「既抠图又卡通」。 */
const processMode = computed({
  get() {
    if (options.removeBg) return 'cutout'
    if (options.cartoon) return 'cartoon'
    return 'original'
  },
  set(key) {
    if (key === processMode.value) return
    if (key === 'cartoon') {
      /* 卡通风格属于 AI 生图能力，入口先关闭；已经开着卡通化的旧作品不受影响。 */
      toastWarn(AI_PENDING_TEXT)
      return
    }
    if (key === 'original') {
      options.removeBg = false
      options.cartoon = false
      previewMode.value = 'source'
      cartoonPreviewUrl.value = ''
      if (sourceUrl.value) regenerate()
      return
    }
    if (key === 'cutout') {
      options.cartoon = false
      previewMode.value = 'source'
      cartoonPreviewUrl.value = ''
      onRemoveBg(true)
    }
  }
})
const processHint = computed(() =>
  processMode.value === 'original' ? '原图直接进入拼豆转换。' : ''
)

/**
 * 手机端「图片处理」下拉的回写（受控 + 必要时回拨，理由见上面「手机端的下拉」）。
 * 这里为什么还需要回拨：抠图开着的时候选「卡通风格」，状态里会同时留下 removeBg
 * （另外两条路线会清掉对方，卡通这条没有），processMode 读回来仍然是 cutout ——
 * 选择框拿到的值跟上一帧一样，Vue 不会重新 patch，框会停在用户刚点的那一项上。
 * 桌面的三个页签遇到同一种情况是「高亮不动」，拨回去才是同一套行为。 */
async function onProcessPick(e) {
  processMode.value = e.target.value
  await nextTick()
  if (e.target) e.target.value = processMode.value
}

/* ---------------------------------------------------------------- ② 画布大小

   这一块以前是「6 格按钮 + 两个数字框」，现在是**一行 + 右侧弹出的列表**：
     左边标题 / 右边当前尺寸 / 最右一个箭头，点一下从右边弹出可选画布列表。
     为什么收成一行：左栏只有 300px 宽，8 个档位格 + 灰底信息条要吃掉 340px 高，
     而这块参数是「偶尔改一次」的 —— 需要时再看，不需要时别占着画布的地盘。

   列表里的尺寸全部来自 lib/boardSpec.js：
     · 拼板是 52 / 78 / 104 / 120 钉画线板（一条边上的钉位数，一钉 = 一格，实测外框 14 / 21 / 28 / 34 cm）；
     · 比一块板更大 = **同规格**再拼几块，所以可选尺寸都是这四个规格的整数倍（暂不混拼，见 boardSpec.js 文件头）；
     · 从简单到特别精细一共 7 档（52 / 78 / 104 / 120 / 156 / 208 / 312）：前四档一块板一个规格，
       后面三档同规格拼块（156 = 2 × 2 块 78、208 = 2 × 2 块 104、312 = 3 × 3 块 104）；
     · 每一行要同时说清三件事：**豆子多大 · 板子多大 · 成品多大**（口径分别是 bead / BOARDS / 格数 × 豆径），
       再加一句「适合做什么」——格数太抽象，用户是照「能不能认出脸」选尺寸的；
     · 已经选了图片时按原图方向修正（长边取档位值、短边吸附到整板规格），
       没选图片时就是「常用拼盘尺寸」（正方形整板）；
     · 最后一项是「自定义尺寸」：选规格 × 横向几块 × 纵向几块，长宽必然是规格的整数倍，
       下面直接算出成品尺寸（格数 × 豆径）；
     · 自定义里的规格 / 块数一改就自动套用画布（360ms 防抖），不再等「用 X × Y 格」——
       用户改这个选项问的就是「这样拼出来长什么样」，先看到结果才谈得上确认。
*/
const sizeOpen = ref(props.focus === 'size')
const sizeWrap = ref(null)
/** 自定义尺寸的输入（规格 × 块数），点开「自定义」时才铺开 */
const customOpen = ref(false)
const customSpec = ref(BOARD_MIN)
const customCols = ref(1)
const customRows = ref(1)
/** 档位阶梯的上限（312 格 = 3×3 块 104 板） */
const MAX_TIER = SIZE_TIERS[SIZE_TIERS.length - 1].n

/** 有没有已经选好的图片：决定列表的标题与短边是否按原图比例修正 */
const sizeHasSource = computed(() => !!sourceUrl.value)
/** 源图方向（矢量素材按 1:1，照片按原图 / 主体包围盒的比例 —— 与 presetAspect 同一口径） */
const sizeAspect = computed(() => presetAspect())

/**
 * 档位的「长边格数」怎么落到具体画布：**规格在长边的因数里挑，块数按原图比例定**。
 *
 *   · 一块板的档位（52 / 78 / 104 / 120）没有可调的余地，就只能是正方 —— 这四个规格是实物的物理边界；
 *   · 更大的档位（156 / 208 / 312）是「把这张图转多细」，此时"方画布 + 竖图居中"会把格子浪费成留白：
 *     一张 0.59 比例的竖图放进 208×208，主体只占到 122 列 —— 用户点的是 208 格，实际拿到的是
 *     122 格的清晰度，另外 40% 的格子（和豆子）全用在空白上。按原图比例重排块数之后，
 *     同一档位下主体的清晰度直接 ×1.7。
 *   · 重排**只在同一规格内**做（tierBox）：3:4 的竖图在 312 档下是 3 × 4 块 78 = 234 × 312，
 *     比例正好；1:2 的竖图是 3 × 6 块 52 = 156 × 312。不能两个方向各挑一个规格 ——
 *     混规格（78 宽 × 104 高这种）现在不做：同珠径的板钉距一样、并排摆图案是连着的，
 *     但接缝位置不规律、能不能卡扣要按实物确认，等板型兼容数据搞明白再说（口径见 boardSpec.js）。
 * 没有源图（素材库矢量 / AI 出图）时保持正方：那类图本来就是按整块板画的，
 * 它们的"图片尺寸"（svgToImage 固定 200×160）是取像素用的画布，不是图案比例 ——
 * 拿 1.25 去算只会得到一张歪的网格。
 *
 * 比例直接用 useStudio 的 sourceAspect：透明贴纸在那里已经被换成**主体包围盒**的比例
 * （跟生成时的自动裁剪同一口径），否则画布比例和实际裁剪结果对不上，又会留一大片空格。
 */
function presetAspect() {
  if (sourceKind.value !== 'raster') return 1
  const a = sourceAspect.value
  const img = sourceImg.value
  if (!(a > 0)) return 1
  /* 没有源图时 sourceAspect 是上一次的残留值，必须靠 sourceImg 判活 */
  if (!img || !(img.naturalWidth || img.width)) return 1
  return a
}

/** 源图长边（像素），没有源图时 0 */
function sourceLongPx() {
  const img = sourceImg.value
  const sw = img && (img.naturalWidth || img.width)
  const sh = img && (img.naturalHeight || img.height)
  return sw && sh ? Math.max(sw, sh) : 0
}

/**
 * 这张图最多撑到多细：一格至少摊到 2 个源像素（超采样的下限，见 useStudio 的 autoFitForSource）。
 * 超过它的档位不是不能选，而是「再加格只是插值」—— 必须如实标出来，
 * 否则用户会以为「开到极限还是不清晰 = 工具不行」。
 * 取样边长还有一道 MAX_SOURCE_SIDE（原图再大也会先缩到那个边长再逐格取样）。
 */
const sizeUsefulLong = computed(() => {
  if (!sizeHasSource.value || sourceKind.value !== 'raster') return Infinity
  const long = sourceLongPx()
  if (!long) return Infinity
  return Math.min(long, MAX_SOURCE_SIDE) / 2
})

/** 按原图自动匹配会落在哪一档（列表里给它标「推荐」） */
const autoTier = computed(() => {
  if (!sizeHasSource.value) return null
  const long = sourceLongPx()
  if (!long) return null
  return snapTier(Math.round(long / 2), { max: Math.min(maxCells.value, MAX_TIER) })
})

/**
 * 列表里的每一行 = 一个可选的「方案」，四个信息缺一不可：
 *   ① 尺寸（格）；② 豆子多大；③ 板子多大（几块 + 板面厘米）；④ 成品多大；⑤ 适合做什么。
 *
 * 为什么每行都要把豆子/板子/成品写出来：用户是拿这三个数去对「手上有多少板、做出来放哪」的，
 * 只给格数他得自己乘一遍（而且乘错的人不少：52 格是 13.5 cm 成品、板面 14 cm，是两个数）。
 * 豆子取当前生效的豆径（默认 2.6mm 小豆），成品厘米 = 格数 × 豆径，板面 = 块数 × 板实测外框。
 */
const sizeRows = computed(() => {
  const cap = maxCells.value
  const aspect = sizeAspect.value
  const useful = sizeUsefulLong.value
  const auto = autoTier.value
  const beadKey = bead.value.key
  const beadLabelText = beadLabel(beadKey, { withDefault: true })
  return SIZE_TIERS.map(t => {
    const box = tierBox(t, aspect)
    const long = Math.max(box.w, box.h)
    return {
      key: String(t.n),
      name: t.name,
      /* 适合做什么：选尺寸的锚点（格数太抽象） */
      use: t.use,
      note: t.note,
      w: box.w,
      h: box.h,
      /* 这一档在当前图片方向下用的是哪个规格 / 拼几块（同一个 312 档，正方图是 3×3 块 104，
         3:4 竖图是 3×4 块 78 —— 同一规格才拼得成一块整板，见 boardSpec.js） */
      spec: box.spec,
      beadText: beadLabelText,
      /* 正方形只说一个数（52 格 → 成品 13.5 cm），长方形的短边另算 */
      finish: box.w === box.h
        ? `${(box.w * bead.value.cm).toFixed(1)} cm`
        : finishCmText(box.w, box.h, beadKey),
      cells: box.w * box.h,
      /* 锁住的档位照常显示：用户需要的是「知道更细是存在的 + 怎么解锁」，
         而不是把选项藏起来让他以为这个工具只能做小图 */
      locked: long > cap,
      current: options.canvasW === box.w && options.canvasH === box.h,
      recommended: !!auto && auto.n === t.n,
      overSource: useful !== Infinity && long > useful
    }
  })
})

/* ---------------------------------------------------------------- ② 宽屏版：画布与成品尺寸
   只在 ≥781px（电脑 / 平板）用这一套；手机端仍是上面「一行 + 弹出列表」那套，代码不动。

   两个层级别混：
     · 画布规格 = **底板**（canvasCapW/H）：你手上的板多大，决定滑块上限；
     · 成品尺寸 = **图案在底板上占的那块**（width/height，生成后四周留空）：
       在底板里缩放，分板与豆径都按底板算。
   改成品尺寸要按新尺寸重新取样（setCanvasSize → regenerate），不能只缩预览图。 */
const wide = ref(typeof window !== 'undefined' && !!window.matchMedia
  ? window.matchMedia('(min-width:781px)').matches
  : true)
let wideMq = null
function onWideMq(e) { wide.value = e.matches }

/** 有源图或已有图纸才能调成品尺寸（空画布不显示虚假豆子数） */
const sizeReady = computed(() => sizeHasSource.value || hasPattern.value)

/** 画布规格下拉：档位按当前图片方向换成具体网格（与老列表共用 tierBox 口径） */
const specRows = computed(() => {
  const cap = maxCells.value
  const aspect = sizeAspect.value
  return SIZE_TIERS.map(t => {
    const box = tierBox(t, aspect)
    return {
      key: String(t.n),
      n: t.n,
      name: t.name,
      w: box.w,
      h: box.h,
      spec: box.spec,
      boards: boardsTextShort(box.w, box.h, { x: box.spec, y: box.spec }),
      locked: Math.max(box.w, box.h) > cap,
      current: canvasCapW.value === box.w && canvasCapH.value === box.h
    }
  })
})

/** 下拉的当前值：容量正好是某个档位就用它，否则是「自定义」那一项 */
const specValue = computed(() => {
  const row = specRows.value.find(r => r.current)
  return row ? `${row.w}x${row.h}` : `c${canvasCapW.value}x${canvasCapH.value}`
})
/** 下拉实际显示的值：展开自定义块时停在「自定义尺寸…」上 */
const specSelectValue = computed(() => (sizeCustomOpen.value ? 'custom' : specValue.value))

/** 容量不是阶梯档位（老存档 / 自定义加板）时补一项，保证下拉选得中自己 */
const specOptions = computed(() => {
  const list = specRows.value.map(r => ({
    value: `${r.w}x${r.h}`,
    label: `${r.w} × ${r.h} 格（${r.boards}${r.locked ? ' · PRO' : ''}）`,
    locked: r.locked
  }))
  if (!specRows.value.some(r => r.current)) {
    list.unshift({
      value: `c${canvasCapW.value}x${canvasCapH.value}`,
      label: `${canvasCapW.value} × ${canvasCapH.value} 格（当前 · 自定义）`,
      locked: false
    })
  }
  return list
})

/** 容量文案：「312 × 234 格（3 × 4 块 78 钉板）」 */
const specLabel = computed(() => `${canvasCapW.value} × ${canvasCapH.value} 格（${boardsTextShort(canvasCapW.value, canvasCapH.value)}）`)

/** 手机端「画布规格」下拉：只列标准档位；底板是自定义尺寸时把当前值补在最前 */
const boardSpecOptions = computed(() => {
  const list = specRows.value.map(r => ({
    value: `${r.w}x${r.h}`,
    label: `${r.w} × ${r.h} 格（${r.boards}${r.locked ? ' · PRO' : ''}）`,
    locked: r.locked
  }))
  if (!specRows.value.some(r => r.current)) {
    list.unshift({
      value: `c${canvasCapW.value}x${canvasCapH.value}`,
      label: `${canvasCapW.value} × ${canvasCapH.value} 格（当前 · 自定义）`,
      locked: false
    })
  }
  return list
})

/** 手机端换底板：只改画布规格，成品区域放不下才收敛（与宽屏下拉同一套 applyCapacity） */
function onBoardPick(e) {
  const v = String(e.target.value || '')
  if (!v || v.startsWith('c')) return
  const [w, h] = v.split('x').map(Number)
  if (!w || !h) return
  const row = specRows.value.find(r => r.w === w && r.h === h)
  /* 锁住的档位在列表里带「· PRO」：选了要回到原值并说明原因，
     否则 setCanvasCapacity 会静默夹回 52，看起来像下拉坏了 */
  if (row && row.locked) {
    e.target.value = specValue.value
    emit('need-pro', `这块底板（${row.w} × ${row.h} 格）是 Pro 功能：免费版单边上限 ${maxCells.value} 格。`)
    return
  }
  applyCapacity(w, h)
}

/* 成品尺寸滑块：锁定比例时一个长边滑杆；关闭后宽、高各一个。
   拖动时先更新读数（跟手），重活延后 240ms；松手 / 点 ± 立即落地。 */
const SIZE_MIN_CELLS = 8
const SIZE_APPLY_DELAY = 240
const sizePreviewW = ref(width.value)
const sizePreviewH = ref(height.value)
const sizePending = ref(false)
const sizeNote = ref('')
const aspectLocked = ref(true)
/* 规格下拉最后的「自定义尺寸…」：复用下面那套规格 × 块数（Pro 可到单边 1000 格） */
const sizeCustomOpen = ref(false)
let sizeTimer = 0
let sizeToken = 0
let sizeNoteTimer = 0

/** 素材宽高比（等比例缩放锁的就是它；矢量素材按 1:1） */
const sizeAspectRatio = computed(() => {
  const a = Number(sizeAspect.value)
  return a > 0 ? a : 1
})
/**
 * 滑杆上限：容量里能放下的**最大同比例网格**的长边。
 * 容量通常就是按素材比例选的档位（两者一致）；只有「自定义规格 × 块数」选了别的比例时，
 * 上限才会比容量长边小 —— 这样锁定比例时不会把图硬拉成另一个形状。
 */
const capLong = computed(() => {
  const cw = canvasCapW.value
  const ch = canvasCapH.value
  const a = sizeAspectRatio.value
  const w = Math.min(cw, ch * a)
  return Math.max(1, Math.round(Math.max(w, w / a)))
})
const previewLong = computed(() => Math.max(sizePreviewW.value, sizePreviewH.value))
const previewCm = computed(() => `${(previewLong.value * bead.value.cm).toFixed(1)} cm`)
const previewCmBoth = computed(() => finishCmText(sizePreviewW.value, sizePreviewH.value, bead.value.key))
const previewCells = computed(() => `${sizePreviewW.value} × ${sizePreviewH.value} 格`)
/** 成品区域占画布多少（面积比）：这一块调的就是「图案在画布上占多大」 */
const previewShare = computed(() => {
  const total = canvasCapW.value * canvasCapH.value
  if (!total) return 100
  return Math.round((sizePreviewW.value * sizePreviewH.value / total) * 100)
})
/** 豆子总数只在「预览 = 已生成的网格」时给：旧数字挂在新尺寸上是假数据 */
const previewBeads = computed(() => {
  if (!sizeReady.value || !stats.value) return ''
  if (sizePending.value || sizePreviewW.value !== width.value || sizePreviewH.value !== height.value) return ''
  return `${stats.value.total.toLocaleString()} 颗`
})
/** 滑杆刻度：等距取 5 个点，按当前豆径换算成厘米（不写死 2/4/6/8…） */
const sizeTicks = computed(() => {
  const lo = SIZE_MIN_CELLS
  const hi = Math.max(lo, capLong.value)
  const out = []
  for (let i = 0; i < 5; i++) {
    const cells = Math.round(lo + (hi - lo) * (i / 4))
    out.push((cells * bead.value.cm).toFixed(1))
  }
  return out
})
const sizeLimitHint = computed(() =>
  `成品尺寸只在画布（${canvasCapW.value} × ${canvasCapH.value} 格）里缩放，四周留空不放豆；缩小成品会减少能表达的细节。`
)
/** 滑杆已填充比例（CSS 用它画黄色进度条） */
const longFillPct = computed(() => {
  const span = Math.max(1, capLong.value - SIZE_MIN_CELLS)
  return Math.round(((previewLong.value - SIZE_MIN_CELLS) / span) * 100)
})
function sideFillPct(axis) {
  const max = sideMax(axis)
  const v = axis === 'w' ? sizePreviewW.value : sizePreviewH.value
  return Math.round(((v - SIZE_MIN_CELLS) / Math.max(1, max - SIZE_MIN_CELLS)) * 100)
}

/** 按长边格数求网格：按素材比例算，两个方向都是整数格，再夹进容量 */
function gridForLong(long) {
  const l = Math.max(SIZE_MIN_CELLS, Math.min(capLong.value, Math.round(Number(long) || 0)))
  const a = sizeAspectRatio.value
  let w
  let h
  if (a >= 1) {
    w = l
    h = Math.max(1, Math.round(l / a))
  } else {
    h = l
    w = Math.max(1, Math.round(l * a))
  }
  return {
    w: Math.min(canvasCapW.value, w),
    h: Math.min(canvasCapH.value, h)
  }
}

function clampCells(v, max) {
  return Math.max(SIZE_MIN_CELLS, Math.min(max, Math.round(Number(v) || 0)))
}

/** 作废还没落地的定时器与在途任务（换规格 / 恢复默认 / 卸载时用） */
function cancelSizeWork() {
  if (sizeTimer) {
    clearTimeout(sizeTimer)
    sizeTimer = 0
  }
  sizeToken++
  sizePending.value = false
}

function clearSizeNote() {
  if (sizeNoteTimer) {
    clearTimeout(sizeNoteTimer)
    sizeNoteTimer = 0
  }
  sizeNote.value = ''
}

function flashSizeNote(text) {
  sizeNote.value = text
  if (sizeNoteTimer) clearTimeout(sizeNoteTimer)
  sizeNoteTimer = window.setTimeout(() => { sizeNote.value = '' }, 3200)
}

/** 立即把预览尺寸落到画布（会重新采样并重新生成） */
function applySizeNow(w, h, token = ++sizeToken) {
  if (token !== sizeToken) return
  clearSizeNote()
  if (!sizeReady.value) {
    sizePending.value = false
    return
  }
  if (w === width.value && h === height.value) {
    sizePending.value = false
    return
  }
  sizePending.value = true
  void runWithBusy(() => {
    /* 等那一帧的工夫里用户可能又拖了滑杆 */
    if (token !== sizeToken) return
    setCanvasSize(w, h, { silent: true })
    sizePending.value = false
  })
}

/** 拖动中：只排一次延迟落地，读数已经先更新 */
function queueSizeApply(w, h) {
  if (!sizeReady.value) return
  const token = ++sizeToken
  if (w === width.value && h === height.value) {
    sizePending.value = false
    return
  }
  sizePending.value = true
  if (sizeTimer) clearTimeout(sizeTimer)
  sizeTimer = window.setTimeout(() => {
    sizeTimer = 0
    if (token !== sizeToken) return
    applySizeNow(w, h, token)
  }, SIZE_APPLY_DELAY)
}

/* 外部改了网格（换图 / 换规格 / 打开存档）时把预览对齐；拖动中不抢滑杆 */
watch([width, height], ([w, h]) => {
  if (sizePending.value) return
  sizePreviewW.value = w
  sizePreviewH.value = h
})

function onLongInput(e) {
  if (!sizeReady.value) return
  const g = gridForLong(clampCells(e.target.value, capLong.value))
  sizePreviewW.value = g.w
  sizePreviewH.value = g.h
  queueSizeApply(g.w, g.h)
}
function onLongCommit(e) {
  if (!sizeReady.value) return
  const g = gridForLong(clampCells(e.target.value, capLong.value))
  sizePreviewW.value = g.w
  sizePreviewH.value = g.h
  applySizeNow(g.w, g.h)
}
function nudgeLong(d) {
  if (!sizeReady.value) return
  const g = gridForLong(clampCells(previewLong.value + d, capLong.value))
  sizePreviewW.value = g.w
  sizePreviewH.value = g.h
  applySizeNow(g.w, g.h)
}

/* 关闭等比后：宽、高各自一条滑杆，改哪个只动哪个，不静默拉另一半 */
function sideMax(axis) {
  return axis === 'w' ? canvasCapW.value : canvasCapH.value
}
function onSideInput(axis, e) {
  if (!sizeReady.value) return
  const v = clampCells(e.target.value, sideMax(axis))
  if (axis === 'w') sizePreviewW.value = v
  else sizePreviewH.value = v
  queueSizeApply(sizePreviewW.value, sizePreviewH.value)
}
function onSideCommit(axis, e) {
  if (!sizeReady.value) return
  const v = clampCells(e.target.value, sideMax(axis))
  if (axis === 'w') sizePreviewW.value = v
  else sizePreviewH.value = v
  applySizeNow(sizePreviewW.value, sizePreviewH.value)
}
function nudgeSide(axis, d) {
  if (!sizeReady.value) return
  const v = clampCells((axis === 'w' ? sizePreviewW.value : sizePreviewH.value) + d, sideMax(axis))
  if (axis === 'w') sizePreviewW.value = v
  else sizePreviewH.value = v
  applySizeNow(sizePreviewW.value, sizePreviewH.value)
}

/** 重新打开等比：按容量比例把当前长边收回来，避免留下一条被单独拉长的边 */
function onAspectChange(e) {
  aspectLocked.value = !!e.target.checked
  if (!aspectLocked.value) return
  const g = gridForLong(previewLong.value)
  sizePreviewW.value = g.w
  sizePreviewH.value = g.h
  applySizeNow(g.w, g.h)
}

/** 换画布规格：容量变了，当前网格超限就收敛到最近的合法尺寸并给一句轻提示 */
function applyCapacity(w, h) {
  cancelSizeWork()
  sizeCustomOpen.value = false
  const wasW = width.value
  const wasH = height.value
  const run = () => {
    setCanvasCapacity(w, h, { silent: true })
    sizePreviewW.value = width.value
    sizePreviewH.value = height.value
    if (wasW > w || wasH > h) flashSizeNote(`已按新规格收敛到 ${width.value} × ${height.value} 格`)
  }
  if (wasW > w || wasH > h) void runWithBusy(run)
  else run()
}

function onSpecChange(e) {
  const v = String(e.target.value || '')
  if (v === 'custom') {
    /* 展开自定义块：先按当前网格铺初值，用户改完点「用 X × Y 格」才落地 */
    if (!sizeCustomOpen.value) seedCustom()
    sizeCustomOpen.value = true
    return
  }
  sizeCustomOpen.value = false
  if (v.startsWith('c')) return
  const [w, h] = v.split('x').map(Number)
  const row = specRows.value.find(r => r.w === w && r.h === h)
  if (!row) {
    e.target.value = specValue.value
    return
  }
  if (row.locked) {
    e.target.value = specValue.value
    emit('need-pro', `这块画布（${row.w} × ${row.h} 格）是 Pro 功能：免费版单边上限 ${maxCells.value} 格。`)
    return
  }
  applyCapacity(row.w, row.h)
}

/** 恢复默认 = 用满当前画布规格（只动这一块，不刷新页面、不重置其它参数） */
function resetSize() {
  cancelSizeWork()
  clearSizeNote()
  sizeCustomOpen.value = false
  /* 锁比例时用满「容量里能放下的同比例网格」，别把方形图拉到非方形容器里；
     已经关掉等比（自定义画布）时就用满容量本身 */
  const box = sizeReady.value && aspectLocked.value
    ? gridForLong(capLong.value)
    : { w: canvasCapW.value, h: canvasCapH.value }
  sizePreviewW.value = box.w
  sizePreviewH.value = box.h
  if (!sizeReady.value) {
    setCanvasSize(box.w, box.h, { silent: true })
    return
  }
  void runWithBusy(() => setCanvasSize(box.w, box.h, { silent: true }))
}

/** 宽屏自定义尺寸落地：容量与网格一起换成「规格 × 块数」，面板保持展开 */
function applyCustomWide() {
  if (customLocked.value) return
  const box = customPreview.value
  cancelSizeWork()
  clearSizeNote()
  sizePreviewW.value = box.w
  sizePreviewH.value = box.h
  sizeCustomOpen.value = false
  /* 自定义画布的比例和素材不一致时，等比缩放没有意义：直接展开宽 / 高两条滑杆，
     让用户看到「这两个方向是分开的」，而不是留一条对不上的长边滑杆。 */
  if (Math.abs(box.w / box.h - sizeAspectRatio.value) > 0.02) aspectLocked.value = false
  void runWithBusy(() => {
    ensureColorsForCanvas(box.w, box.h)
    options.canvasMaxW = box.w
    options.canvasMaxH = box.h
    setCanvasSize(box.w, box.h, { silent: true })
  })
}

/** 自定义尺寸：规格 × 横向几块 × 纵向几块（超出套餐上限时自动收敛，并告诉用户） */
const customPreview = computed(() => customBox({
  spec: customSpec.value, cols: customCols.value, rows: customRows.value, max: maxCells.value
}))
const customCm = computed(() => finishCmText(customPreview.value.w, customPreview.value.h, bead.value.key))
/** 板面（拼起来占多大桌面）：成品 + 边框，买板 / 摆桌子看这个数 */
const customOuter = computed(() => boardOuterText(
  customPreview.value.w, customPreview.value.h, { x: customPreview.value.spec, y: customPreview.value.spec }
))
/** 当前豆径文案（默认那颗带「默认」） */
const beadText = computed(() => beadLabel(bead.value.key, { withDefault: true }))
/** 四种板的实测外框文案：'52 钉 14 cm · 78 钉 21 cm · …'（列表头那行说明用） */
const boardNotesText = computed(() => BOARD_SPECS.map(s => `${s} 钉 ${BOARDS[s].outerCm} cm`).join(' · '))
/** 选中的规格档案（自定义里显示「1 块 = 14 × 14 cm」用） */
const customSpecBoard = computed(() => boardOf(customPreview.value.spec))
/** 这个自定义尺寸超出当前套餐上限（免费版只有 52 格：一块 78 / 104 / 120 钉板都放不下） */
const customLocked = computed(() => Math.max(customPreview.value.w, customPreview.value.h) > maxCells.value)

/* ---------------- 自定义尺寸的实时预览 ----------------
   用户改规格 / 块数，问的就是「这样拼出来长什么样」，所以不再等「用 X × Y 格」：
   输入停下来 360ms 就自动把画布换成当前尺寸（防抖避免每敲一位都跑一次生成）。
   生成是同步重活，大画布会卡一下 —— runWithBusy 会先把「正在生成方案…」画上屏。

   为什么不直接 watch 三个 ref：seedCustom() 打开面板时也会写这三个值，
   用 watch 的话「点开自定义」就会把老存档的 58×58 悄悄缩成 52×52。
   这里只认用户的 input / change 事件。 */
const CUSTOM_PREVIEW_DELAY = 360
const customPending = ref(false)
let customPreviewTimer = 0
let customPreviewSeq = 0

/** 当前画布是不是已经就是自定义预览的尺寸（状态行与按钮据此改文案） */
const customApplied = computed(() =>
  !customLocked.value &&
  customPreview.value.w === width.value &&
  customPreview.value.h === height.value
)

/** 输入框旁边那行状态：说清「不用点按钮，画布已经跟着变了」 */
const customLiveText = computed(() => {
  if (customLocked.value) return ''
  if (customApplied.value) return `已实时套用到成品 · ${width.value} × ${height.value} 格`
  if (customPending.value) return '正在更新成品尺寸…'
  return '改动上面的规格 / 块数，成品尺寸会自动更新'
})

/** 取消尚未落地的实时预览（换档位 / 关面板时用，避免晚到的定时器覆盖用户刚做的选择） */
function cancelCustomPreview() {
  if (customPreviewTimer) {
    clearTimeout(customPreviewTimer)
    customPreviewTimer = 0
  }
  /* 已经让出一帧、正在等 runWithBusy 执行的那一次也一并作废 */
  customPreviewSeq++
  customPending.value = false
}

/** 防抖到点：把「规格 × 块数」自动落到画布上（不弹「已生成 N 个方案」） */
function applyCustomPreview() {
  customPreviewTimer = 0
  if (!customOpen.value) return
  const cols = Number(customCols.value)
  const rows = Number(customRows.value)
  /* 输入框被清空 / 敲了 0 时先不动画布，等用户填完 —— 拿 1 去套会让画布突然缩一下 */
  if (!(cols >= 1) || !(rows >= 1)) {
    customPending.value = false
    return
  }
  /* 免费版放不下的规格（78 / 104 / 120 一块就超上限）不自动套用：
     画布保持不变，下面的 note 已经说明需要 Pro。 */
  if (customLocked.value) {
    customPending.value = false
    return
  }
  const box = customPreview.value
  if (box.w === width.value && box.h === height.value) {
    customPending.value = false
    return
  }
  const seq = ++customPreviewSeq
  void runWithBusy(() => {
    /* 等那一帧的工夫里用户可能又改了尺寸、或点了别的档位 */
    if (seq !== customPreviewSeq || !customOpen.value) return
    customPending.value = false
    ensureColorsForCanvas(box.w, box.h, { quiet: true })
    /* 成品尺寸快选：只改图案占的那块；底板放不下时才跟着长，已有更大的板就保留留白 */
    options.canvasMaxW = Math.max(canvasCapW.value, box.w)
    options.canvasMaxH = Math.max(canvasCapH.value, box.h)
    setCanvasSize(box.w, box.h, { silent: true })
  })
}

/** 输入事件 → 防抖预览（nextTick 等 v-model 把值写回再读） */
function queueCustomPreview() {
  customPending.value = true
  customPreviewSeq++
  if (customPreviewTimer) clearTimeout(customPreviewTimer)
  customPreviewTimer = window.setTimeout(applyCustomPreview, CUSTOM_PREVIEW_DELAY)
}
function onCustomEdit() {
  nextTick(queueCustomPreview)
}


/** 点开自定义时用它铺初值：从当前画布反推（反推不出来就退回一块最小规格的板） */
function seedCustom() {
  const spec = boardSpecFor(options.canvasW, options.canvasH)
  customSpec.value = BOARD_SPECS.includes(spec) ? spec : BOARD_MIN
  customCols.value = Math.max(1, Math.round(options.canvasW / customSpec.value))
  customRows.value = Math.max(1, Math.round(options.canvasH / customSpec.value))
}

function toggleCustom() {
  if (customOpen.value) {
    customOpen.value = false
    cancelCustomPreview()
    return
  }
  customOpen.value = true
  seedCustom()
}

/**
 * 落下一个尺寸。锁住的档位只给「升级 Pro」的说明，不改任何状态 ——
 * 「点了没反应」和「点了变成另一个尺寸」都会让人以为界面坏了。
 */
function pickBox(box) {
  /* 档位 / 自定义的按钮是明确选择：先作废还在防抖里的实时预览，
     否则 360ms 后那次会反过来覆盖用户刚点的档位 */
  cancelCustomPreview()
  const cap = maxCells.value
  if (Math.max(box.w, box.h) > cap) {
    emit('need-pro', `这块画布（${box.w} × ${box.h} 格）是 Pro 功能：免费版单边上限 ${cap} 格（正好一块 ${BOARD_MIN} 钉板）。`)
    return
  }
  sizeOpen.value = false
  /* 手机弹层里这块列表就是抽屉的全部内容：收起来只会剩下一个空抽屉，
     所以选完直接把抽屉关掉，回到画布看结果（和桌面端点一档就收起同一个意思）。 */
  if (props.focus) emit('close-panel')
  /* 尺寸没变就不要进 runWithBusy：yieldForBusyPaint 会把 generating 置 true，
     而 setCanvasSize 对相同尺寸直接 return，没人再把它关掉 —— 表现是「生成中」永远转。
     自定义的「完成 · 已是 X × Y 格」按的就是这一条。 */
  if (box.w === width.value && box.h === height.value) return
  /* 生成是同步的重活（312 格约 1 秒），先让「正在生成方案…」上屏再动手 */
  void runWithBusy(() => {
    ensureColorsForCanvas(box.w, box.h)
    /* 成品尺寸快选：只改图案占的那块；底板放不下时才跟着长（桌面端的底板由规格下拉单独管） */
    options.canvasMaxW = Math.max(canvasCapW.value, box.w)
    options.canvasMaxH = Math.max(canvasCapH.value, box.h)
    setCanvasSize(box.w, box.h)
  })
}

function applyCustom() {
  const box = customPreview.value
  pickBox({ w: box.w, h: box.h })
}

/* 点外面 / 按 Esc 关掉弹出的列表（浮层盖在画布上，不关掉就没法看结果）。
   手机弹层（focus）里不能这么收：那张卡就是抽屉正文，收起后抽屉只剩标题，
   变成一个空壳 —— 关抽屉交给 BaseDialog（点遮罩 / 右上角 X / Esc）自己处理。 */
function onSizeOutside(e) {
  /* 宽屏是就地铺开的面板，不是浮层：点画布 / 别处不该把它收起来 */
  if (wide.value) return
  if (props.focus) return
  if (!sizeOpen.value) return
  if (sizeWrap.value && !sizeWrap.value.contains(e.target)) {
    sizeOpen.value = false
    cancelCustomPreview()
  }
}
function onSizeKey(e) {
  if (props.focus) return
  if (e.key === 'Escape') {
    sizeOpen.value = false
    cancelCustomPreview()
  }
}

/**
 * 桌面端浮层的位置。
 * 为什么用 fixed + 实测坐标而不是 absolute：>1319px 时左栏自己 `overflow-y:auto`
 * （工作台是「画布不动、两边各自滚」的版面），absolute 的子元素会被那一层裁掉 ——
 * 表现是「点了箭头，列表被切掉一半」。
 * 右侧放不下就翻到卡片左边（781~1319px 的窄桌面），上下各留 8px。
 */
const PANEL_W = 308
const PANEL_H = 460
const panelPos = ref({ top: 0, left: 0 })
function placePanel() {
  const el = sizeWrap.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 720
  let left = r.right + 8
  if (left + PANEL_W > vw - 8) left = Math.max(8, Math.min(r.left - PANEL_W - 8, vw - PANEL_W - 8))
  let top = r.top
  if (top + PANEL_H > vh - 8) top = Math.max(8, vh - PANEL_H - 8)
  panelPos.value = { top: Math.round(top), left: Math.round(left) }
}
/** 滚动 / 缩放时跟着卡片走（浮层是 fixed，不跟着就会飘到别处） */
function onSizeViewport() {
  if (sizeOpen.value) placePanel()
}
watch(sizeOpen, v => {
  if (v) nextTick(placePanel)
})
onMounted(() => {
  document.addEventListener('pointerdown', onSizeOutside)
  document.addEventListener('keydown', onSizeKey)
  window.addEventListener('resize', onSizeViewport)
  window.addEventListener('scroll', onSizeViewport, true)
  /* 宽屏 / 手机两套 ② 卡片靠 media query 切换：跨过 780px 时跟着换，
     否则平板横竖屏切换会停在上一次的布局上 */
  if (typeof window !== 'undefined' && window.matchMedia) {
    wideMq = window.matchMedia('(min-width:781px)')
    wide.value = wideMq.matches
    if (wideMq.addEventListener) wideMq.addEventListener('change', onWideMq)
    else if (wideMq.addListener) wideMq.addListener(onWideMq)
  }
  /* 首页上传卡支持拖入图片：文件在跳转前暂存，这里取走并走同一条载入流程 */
  const pending = takePendingUpload()
  if (pending) loadFile(pending)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onSizeOutside)
  document.removeEventListener('keydown', onSizeKey)
  window.removeEventListener('resize', onSizeViewport)
  window.removeEventListener('scroll', onSizeViewport, true)
  if (wideMq) {
    if (wideMq.removeEventListener) wideMq.removeEventListener('change', onWideMq)
    else if (wideMq.removeListener) wideMq.removeListener(onWideMq)
    wideMq = null
  }
  cancelCustomPreview()
  cancelSizeWork()
  if (sizeNoteTimer) clearTimeout(sizeNoteTimer)
})

/** 卡片头右侧那行尺寸信息：「成品 26 × 26 格 · 画布 52 × 52 格」（铺满时只写画布） */
const sizeRowValue = computed(() => {
  const art = `${width.value} × ${height.value} 格`
  const board = `${canvasCapW.value} × ${canvasCapH.value} 格`
  return art === board ? `${art} · ${boardsTextShort(width.value, height.value)}` : `成品 ${art} · 画布 ${board}`
})
/** 成品区域是不是整板尺寸（老存档的 58 / 116 / 300 不是，信息条要说清楚） */
const sizeWholeBoard = computed(() => isWholeBoard(canvasCapW.value, canvasCapH.value))

/**
 * 精细档的「色号配套」建议值（表在 lib/pattern.js 的 COLOR_FLOOR_BY_CELLS，与
 * 「上传照片自动匹配画布」共用同一张表，避免两处各写一套数字）。
 *
 * 只往上抬、不往下压：用户自己调过更低的色数是他的选择（风格化），
 * 抬了会 toast 说明，随时可以滑回去。
 */
function colorFloorFor(cells) {
  return colorFloorForCells(cells)
}
/** 只有用户真的换了尺寸（而不是拖色号滑块）才抬色数，避免每次改参数都重新抬一遍 */
function ensureColorsForCanvas(w, h, { quiet = false } = {}) {
  const floor = colorFloorFor(w * h)
  if (!floor || options.targetColors >= floor) return false
  const before = options.targetColors
  options.targetColors = Math.min(floor, colorsMax.value)
  /* 实时预览每改一档都会走到这里：状态行已经说明画布在变，再弹 6 秒 toast 会刷屏 */
  if (!quiet) {
    toast(`画布 ${w} × ${h} 格已把颜色数从 ${before} 提到 ${options.targetColors}：格数决定形状多细，色号才决定像不像（可随时改回去）`, '', 6000)
  }
  return true
}

/** 25 万格（500²）以上算「实物量级」：尺寸说明里要额外讲清它的定位（只有自定义能到） */
const hugeCanvas = computed(() => width.value * height.value >= 250000)

/**
 * 色号偏少的提醒（只提醒，不自动改）。
 * 为什么是提醒而不是自动改：用户可能是故意要"色块感"（艺术版就是这个口味），
 * 自动改他的色数是越权；但这句提示必须给出具体数字，不然等于没说。
 */
const colorHint = computed(() => {
  const cells = width.value * height.value
  const floor = colorFloorFor(cells)
  if (!floor || options.targetColors >= floor) return ''
  const pad = Math.min(90, Math.max(4, colorsInUse.value))
  return `这张图 ${width.value} × ${height.value} 格，现在只给 ${options.targetColors} 色：${floor} 色以上才交代得出脸部过渡和褶皱。`
    + `复杂照片建议拖到 ${Math.min(floor, pad)} 色左右，色号多一档，拼的时候也多一档功夫。`
})

/**
 * 跑一次「可能很久」的生成：先让浏览器画一帧 busy 状态，再进同步重活。
 * 为什么包成这样：左栏这几个入口（尺寸档、色号、色板）在 312 格下每次都要 1 秒上下，
 * 不先让出一帧的话 spinner 永远画不出来，用户以为没点上。
 */
async function runWithBusy(fn) {
  await yieldForBusyPaint()
  fn()
}


const variantCards = computed(() =>
  variantList.value.map(v => {
    const s = v.stats || {}
    const active = v.active || v
    const buildScore = Math.round((s.buildability || 0) * 100)
    return {
      key: v.key,
      label: v.label,
      tagline: v.tagline,
      desc: v.desc,
      recommended: v.recommended,
      compare: v.compare,
      stats: s,
      pattern: active,
      stars: buildStars(buildScore),
      buildText: buildabilityLabel(buildScore),
      simText: similarityLabel(s.similarity)
    }
  })
)

/**
 * 方案格下面那行小字：参考版是「第一次玩推荐 / 细节更多 / 更像插画」这种
 * 一句话卖点。官方 tagline 太短（「细节优先」），所以按方案 key 给文案，
 * 认不出的 key 再退回 tagline —— 新增方案时不会出现空行。
 */
const HINTS = { high: '细节更多', easy: '更省力', art: '更像插画' }
function schemeHint(v) {
  return HINTS[v.key] || (v.tagline || '').trim() || '可选'
}

/**
 * 抠图那一行的状态文案。
 * 必须一行说清「去了什么 / 为什么没生效」——用户选了抠图却什么都没变、
 * 又没有任何解释，是最糟糕的体验。
 */
const matteNote = computed(() => {
  const m = matteInfo.value
  if (!m) return ''
  const beads = stats.value ? ` · 保留 ${stats.value.total.toLocaleString()} 颗豆` : ''
  if (m.status === 'applied') return `已生效 · ${m.text}${beads}`
  if (m.status === 'failed') return `未生效 · ${m.text}`
  return m.text
})
const matteNoteClass = computed(() => ({
  warn: matteInfo.value?.status === 'failed',
  weak: !!matteInfo.value?.weak
}))

async function loadFile(f) {
  if (!f) return
  busy.value = true
  try {
    const ok = await useImageFile(f)
    if (ok) toastOk('已载入图片并生成方案')
  } catch (err) {
    toastWarn(err.message || '图片载入失败')
  } finally {
    busy.value = false
  }
}

async function onFile(e) {
  const f = e.target.files?.[0]
  if (!f) return
  try {
    await loadFile(f)
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function onDrop(e) {
  dragOver.value = false
  await loadFile(e.dataTransfer?.files?.[0])
}

async function onPickAsset(asset) {
  busy.value = true
  try {
    await pickAsset(asset.id)
  } finally {
    busy.value = false
  }
}

function onColorsChange() {
  /* 夹在 [4, colorsMax]：数字框可以直接敲 200，也可能因为换了色板（Pro → 免费版）
     而留下一个当前色板根本没有的色数。夹在这里，引擎与界面才是同一个数。 */
  const v = Math.round(Number(options.targetColors)) || 4
  options.targetColors = Math.max(4, Math.min(colorsMax.value, v))
  if (sourceUrl.value) void runWithBusy(() => regenerate())
}

function onRemoveBg(on) {
  if (!sourceUrl.value) {
    // 还没上传图片：只记住选择，等图片进来时自动生效
    options.removeBg = !!on
    if (on) toastWarn('先上传一张图片，「智能抠图」会在生成时生效')
    return
  }
  setRemoveBg(on)
}

function onMatteLevel(key) {
  if (options.matteLevel === key) return
  setMatteLevel(key)
}

/* ---------------------------------------------------------------- 卡通化 */

/**
 * 缩略图上的「原图 / 卡通」切换：让用户在出图之前先看一眼卡通化的结果。
 * 用户最担心的是"卡通化把原图改得不像了"，能当场对照就不用猜。
 */
const thumbSrc = computed(() =>
  previewMode.value === 'cartoon' && cartoonPreviewUrl.value ? cartoonPreviewUrl.value : sourceUrl.value
)

const cartoonNote = computed(() => (cartoonInfo.value ? cartoonInfo.value.text : ''))
const cartoonNoteClass = computed(() => ({
  weak: !!cartoonInfo.value?.weak,
  fromSave: cartoonInfo.value?.status === 'fromSave'
}))

function onCartoonStyle(key) {
  if (options.cartoonStyle === key) return
  setCartoonStyle(key)
}

function onPreviewCartoon() {
  if (!cartoonPreviewUrl.value) refreshCartoonPreview()
  previewMode.value = 'cartoon'
}

const currentBrand = computed(() => brand.value)
const paletteNote = computed(() => currentBrand.value.note || currentBrand.value.desc)
/** 色卡来源说明默认收起，点「!」才展开（说明很长，常驻会把色板块撑高） */
const paletteNoteOpen = ref(false)
/** 当前品牌下引擎真正能用的色号数（免费版在非默认品牌上是精简子集） */
const colorsInUse = computed(() => availableColors.value.length)

/**
 * 颜色数上限（滑块与数字框共用）。
 * 两头上限取小：① 引擎的 MAX_TARGET_COLORS（= 291 = 最大色板长度；存档容量已经扩到
 * 547，所以不再是「存不下」的问题，见 lib/pattern.js 与 lib/archive.js）；
 * ② 当前品牌真正可用的色号数 —— 滑块能拖到 291 而手上只有 48 色可选，
 * 用户只会以为程序坏了（免费版在非漫德品牌上就是 48 色精简色板）。
 */
const colorsMax = computed(() => Math.min(MAX_TARGET_COLORS, Math.max(4, colorsInUse.value)))

/** 手机端「颜色数量」下拉的档位：梯子 + 当前值 + 上限（色板变小后旧值也要选得到） */
const colorChoices = computed(() => {
  const max = colorsMax.value
  const cur = Math.max(4, Math.min(max, Math.round(Number(options.targetColors)) || 4))
  return [...new Set([...COLOR_STEPS.filter(n => n < max), cur, max])].sort((a, b) => a - b)
})

/* 手机端下拉的回写：必须自己赋值，不能指望 <select> 的 v-model（见上面「手机端的下拉」） */
function onColorsPick(e) {
  options.targetColors = Number(e.target.value)
  onColorsChange()
}

function onFitPick(e) {
  options.fit = e.target.value
  onColorsChange()
}

/* ---------------------------------------------------------------- ⑤ 图纸交付
   进度摘要 + 打开交付面板的入口。卡片本身默认收起，卡头显示当前状态。 */
const nextBoard = computed(() => {
  const list = buildBoards.value || []
  if (!list.length) return null
  const idx = Math.min(buildBoard.value, list.length - 1)
  return list[idx]
})
const doneBoards = computed(() => (buildBoards.value || []).filter(b => b.percent >= 100).length)

function onSave() {
  saveProject()
}
</script>

<template>
  <aside class="col" :class="{ 'is-focus-mode': !!focus }">
    <!-- ① 先选你要拼什么：来源页签 + 上传区 + 图片处理 + 作品名，一块到底
         手机上这张卡被 order 提到最前面，图纸紧跟在它后面（见 global.css 响应式段） -->
    <section class="card card--create" :class="{ 'is-focus': focus === 'create' }">
      <div class="card__head">
        <h3><span class="stepNo">1</span>先选你要拼什么</h3>
        <span class="muted only-lg">从上到下操作</span>
      </div>
      <div class="card__body stack stack--sm">
        <!-- 三个来源入口 -->
        <div class="sourceTabs" role="tablist" aria-label="选择图案来源">
          <button
            v-for="t in sourceTabs" :key="t.key"
            type="button" role="tab"
            :class="{ on: sourceMode === t.key }"
            :aria-selected="sourceMode === t.key"
            @click="sourceMode = t.key"
          >
            <span class="srcIcon" aria-hidden="true"><PixelIcon :name="t.icon" :size="16" /></span>
            {{ t.label }}
          </button>
        </div>

        <!-- ①-1 上传图片 -->
        <template v-if="sourceMode === 'photo'">
          <div
            v-if="!sourceUrl"
            class="upload"
            :class="{ drag: dragOver }"
            role="button"
            tabindex="0"
            @click="fileInput.click()"
            @keyup.enter="fileInput.click()"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
          >
            <div class="upload__plus"><PixelIcon name="upload" :size="36" /></div>
            <b>上传一张图片</b>
            <span>宠物、情侣、头像、旅行照都可以</span>
            <span class="hint">JPG / PNG / WebP / GIF · 最大 12MB<span class="only-lg"> · 拖进来也可以</span></span>
            <button class="btn primary" @click.stop="fileInput.click()">选择图片</button>
          </div>

          <div v-else class="thumb">
            <img :src="thumbSrc" :alt="sourceName || '素材预览'">
            <div class="thumb__actions">
              <button title="换一张" aria-label="换一张" @click="fileInput.click()"><PixelIcon name="swap" :size="14" /></button>
              <button title="去素材中心" aria-label="去素材中心" @click="emit('need-create')"><PixelIcon name="palette" :size="14" /></button>
            </div>
            <!-- 开了卡通化之后，缩略图上可以直接切换「原图 / 卡通」对照 -->
            <div v-if="options.cartoon" class="thumbModes" role="group" aria-label="预览原图或卡通">
              <button
                class="thumbMode" :class="{ on: previewMode === 'source' }"
                @click="previewMode = 'source'"
              >原图</button>
              <button
                class="thumbMode" :class="{ on: previewMode === 'cartoon' }"
                @click="onPreviewCartoon"
              >卡通</button>
            </div>
            <div v-if="sourceName" class="thumbName">{{ sourceName }}</div>
          </div>
          <input ref="fileInput" type="file" accept="image/*" @change="onFile">
        </template>

        <!-- ①-2 AI 生成素材：服务端生图还没接，先放文字占位 -->
        <template v-else-if="sourceMode === 'ai'">
          <div class="soonPanel" data-audit="ai-pending">
            <span class="soonPanel__icon"><PixelIcon name="sparkles" :size="20" /></span>
            <b>{{ AI_PENDING_TEXT }}</b>
            <p>接入后这里可以用一句话生成素材；现在请先上传图片，或从免费素材库挑一个。</p>
          </div>
        </template>

        <!-- ①-3 免费素材库 -->
        <template v-else>
          <div class="srcAssets">
            <button
              v-for="a in libraryPicks" :key="a.id"
              class="srcAsset" :title="`${a.name} · ${a.colors} 色 · ${a.tier === 'free' ? '免费可商用' : '会员专属'}`"
              @click="onPickAsset(a)"
            >
              <span class="srcAsset__thumb" v-html="a.svg"></span>
              <b>{{ a.name }}</b>
            </button>
          </div>
          <RouterLink to="/library" class="btn soft sm block">全部 {{ ASSET_COUNT }} 个素材 ›</RouterLink>
        </template>

        <div v-if="busy || generating" class="loading"><span class="spinner"></span>正在生成方案…</div>

        <!-- 图片处理：参考版的核心交互 —— 三条路线同级三选一，选中项展开细节。
             手机上这三格收成一行下拉（.mDrop--proc）：三选一本就是下拉的语义，
             省下的 40px 让首屏里的「① 创建」短一截。 -->
        <div class="field">
          <label>图片处理 <span>不需要就跳过</span></label>
          <div class="procTabs mHide" role="tablist" aria-label="图片处理方式">
            <button
              type="button" role="tab"
              class="procTab" :class="{ on: processMode === 'original' }"
              :aria-selected="processMode === 'original'"
              @click="processMode = 'original'"
            ><strong><PixelIcon name="photo" :size="13" />原图</strong><span>直接使用</span></button>
            <button
              type="button" role="tab"
              class="procTab" :class="{ on: processMode === 'cutout' }"
              :aria-selected="processMode === 'cutout'"
              @click="processMode = 'cutout'"
            ><strong><PixelIcon name="eye" :size="13" />智能抠图</strong><span>突出主体</span></button>
            <button
              type="button" role="tab"
              class="procTab" :class="{ on: processMode === 'cartoon', 'is-soon': processMode !== 'cartoon' }"
              :aria-selected="processMode === 'cartoon'"
              :aria-disabled="processMode !== 'cartoon'"
              :title="processMode === 'cartoon' ? '当前作品已开着卡通风格' : AI_PENDING_TEXT"
              @click="processMode = 'cartoon'"
            ><strong><PixelIcon name="wand" :size="13" />卡通风格</strong><span>{{ processMode === 'cartoon' ? '更适合拼豆' : '对接中' }}</span></button>
          </div>
          <div class="mDrop mDrop--proc">
            <select
              :value="processMode" aria-label="图片处理方式"
              @change="onProcessPick"
            >
              <option value="original">原图 · 直接使用</option>
              <option value="cutout">智能抠图 · 突出主体</option>
              <option value="cartoon" :disabled="processMode !== 'cartoon'">
                卡通风格 · {{ processMode === 'cartoon' ? '更适合拼豆' : '对接中，敬请期待' }}
              </option>
            </select>
          </div>
          <p v-if="processMode !== 'cartoon'" class="soonHint">卡通风格：{{ AI_PENDING_TEXT }}</p>

          <!-- 选中项的细节：抠图三档力度 -->
          <div v-if="processMode === 'cutout'" class="procDetail">
            <div class="matteBar__levels" role="group" aria-label="抠图力度">
              <button
                v-for="l in matteLevels" :key="l.key"
                type="button" class="seg" :class="{ on: options.matteLevel === l.key }"
                :title="l.hint"
                @click="onMatteLevel(l.key)"
              >{{ l.label }}</button>
            </div>
            <p v-if="matteNote" class="matteBar__note" :class="matteNoteClass">{{ matteNote }}</p>
          </div>

          <!-- 选中项的细节：卡通三档风格 -->
          <div v-else-if="processMode === 'cartoon'" class="procDetail">
            <div class="cartoonBar__levels" role="group" aria-label="卡通风格">
              <button
                v-for="s in cartoonStyles" :key="s.key"
                type="button" class="seg" :class="{ on: options.cartoonStyle === s.key }"
                :title="s.hint"
                @click="onCartoonStyle(s.key)"
              >{{ s.label }}</button>
            </div>
            <p v-if="cartoonNote" class="matteBar__note cartoonNote" :class="cartoonNoteClass">{{ cartoonNote }}</p>
          </div>

          <p v-else class="processHint">{{ processHint }}</p>
        </div>

        <div class="field">
          <label>作品名称 <span>可修改</span></label>
          <input v-model="projectName" type="text" placeholder="我的拼豆作品">
        </div>
      </div>
    </section>

    <!-- ② 画布与成品尺寸（电脑 / 平板）：
         收起时只有标题 + 实时摘要 + 一颗箭头；展开后就地铺开（不是浮层）。
         画布规格决定底板多大，成品尺寸调图案在底板上占多大（四周留空）；
         缩小成品 = 重新取样，不是把整张画布缩成小图。 -->
    <section
      v-if="wide"
      ref="sizeWrap"
      class="card card--size card--sizeWide"
      :class="{ 'is-open': sizeOpen, 'is-focus': focus === 'size' }"
      data-size-wide
    >
      <button
        class="sizeWideHead" type="button" data-size-row
        :aria-expanded="sizeOpen" aria-controls="sizeWideBody"
        :title="sizeOpen ? '收起画布与成品尺寸' : '展开画布与成品尺寸'"
        @click="sizeOpen = !sizeOpen"
      >
        <span class="sizeWideHead__text">
          <span class="sizeWideHead__title"><span class="stepNo">2</span>画布与成品尺寸</span>
          <span class="sizeWideHead__sum" data-size-value>{{ sizeRowValue }}</span>
        </span>
        <i class="cardArrow" :class="{ 'cardArrow--open': sizeOpen }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
      </button>

      <div v-show="sizeOpen" id="sizeWideBody" class="sizeWideBody" data-size-panel>
        <!-- ① 画布规格：底板多大（成品区域在它里面缩放） -->
        <div class="sizeField">
          <div class="sizeField__head">
            <b>画布规格</b>
            <span class="sizeQ" aria-hidden="true">?</span>
          </div>
          <select class="sizeSpecSelect" data-size-spec :value="specSelectValue" @change="onSpecChange">
            <option v-for="o in specOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            <option value="custom">自定义尺寸（规格 × 块数）</option>
          </select>
          <p class="sizeField__hint">决定底板多大（当前 {{ specLabel }}）；成品尺寸在它里面缩放。</p>

          <!-- 自定义尺寸：规格 × 横向几块 × 纵向几块（Pro 单边可到 1000 格） -->
          <div v-if="sizeCustomOpen" class="sizeCustom" data-size-custom>
            <div class="sizeCustom__row">
              <label for="sizeCustomSpec">规格</label>
              <select id="sizeCustomSpec" v-model.number="customSpec" data-size-custom-spec>
                <option v-for="s in BOARD_SPECS" :key="s" :value="s">{{ s }} 钉板</option>
              </select>
            </div>
            <div class="sizeCustom__row sizeCustom__row--n">
              <label for="sizeCustomCols">横向</label>
              <input id="sizeCustomCols" v-model.number="customCols" data-size-custom-cols type="number" min="1" max="19" step="1">
              <span>块</span>
              <label for="sizeCustomRows">纵向</label>
              <input id="sizeCustomRows" v-model.number="customRows" data-size-custom-rows type="number" min="1" max="19" step="1">
              <span>块</span>
            </div>
            <p class="sizeCustom__sum" :class="{ warn: customLocked }" data-size-custom-sum>
              <template v-if="customLocked">
                当前套餐单边上限 {{ maxCells }} 格：{{ customPreview.spec }} 钉板一块就是 {{ customPreview.spec }} 格，需要 Pro 才能用。
              </template>
              <template v-else>
                {{ customPreview.w }} × {{ customPreview.h }} 格 · 成品 {{ customCm }} ·
                {{ customPreview.cols * customPreview.rows }} 块 {{ customPreview.spec }} 钉板
              </template>
            </p>
            <button
              class="btn primary sm block" type="button" data-size-custom-apply
              :disabled="customLocked" @click="applyCustomWide"
            >{{ customLocked ? `升级 Pro 解锁 ${customPreview.w} × ${customPreview.h} 格` : `用 ${customPreview.w} × ${customPreview.h} 格` }}</button>
          </div>
        </div>

        <!-- ② 成品尺寸：实时读数 + − / 滑杆 / ＋（调的是图案在画布上占多大） -->
        <div class="sizeField">
          <div class="sizeField__head">
            <b>成品尺寸</b>
            <span class="sizeBig" data-size-cm>{{ previewCm }}</span>
          </div>
          <p class="sizeField__hint">图案在画布上占多大；四周留空不放豆。</p>

          <template v-if="aspectLocked">
            <div class="sizeSlideRow">
              <button
                class="sizeStep" type="button" data-size-minus aria-label="缩小成品尺寸"
                :disabled="!sizeReady" @click="nudgeLong(-1)"
              >−</button>
              <input
                class="sizeRange" type="range" data-size-range
                :min="SIZE_MIN_CELLS" :max="capLong" step="1"
                :value="previewLong" :disabled="!sizeReady"
                :aria-valuetext="previewCm"
                :style="{ '--fill': longFillPct + '%' }"
                @input="onLongInput" @change="onLongCommit"
              >
              <button
                class="sizeStep" type="button" data-size-plus aria-label="放大成品尺寸"
                :disabled="!sizeReady" @click="nudgeLong(1)"
              >＋</button>
            </div>
            <div class="sizeTicks" aria-hidden="true">
              <span v-for="(t, i) in sizeTicks" :key="i">{{ t }}</span>
              <em>(cm)</em>
            </div>
          </template>

          <template v-else>
            <div v-for="axis in ['w', 'h']" :key="axis" class="sizeSlideRow sizeSlideRow--side">
              <span class="sizeSideLabel">{{ axis === 'w' ? '宽' : '高' }}</span>
              <button
                class="sizeStep" type="button" :aria-label="axis === 'w' ? '缩小宽度' : '缩小高度'"
                :disabled="!sizeReady" @click="nudgeSide(axis, -1)"
              >−</button>
              <input
                class="sizeRange" type="range" :data-size-range="axis"
                :min="SIZE_MIN_CELLS" :max="sideMax(axis)" step="1"
                :value="axis === 'w' ? sizePreviewW : sizePreviewH" :disabled="!sizeReady"
                :aria-label="axis === 'w' ? '宽度' : '高度'"
                :style="{ '--fill': sideFillPct(axis) + '%' }"
                @input="onSideInput(axis, $event)" @change="onSideCommit(axis, $event)"
              >
              <button
                class="sizeStep" type="button" :aria-label="axis === 'w' ? '放大宽度' : '放大高度'"
                :disabled="!sizeReady" @click="nudgeSide(axis, 1)"
              >＋</button>
              <b class="sizeSideVal">{{ axis === 'w' ? sizePreviewW : sizePreviewH }} 格</b>
            </div>
          </template>

          <p v-if="!sizeReady" class="sizeEmpty" data-size-empty>上传图片或选择素材后可调整成品尺寸。</p>
          <p v-else-if="sizePending" class="sizeLive" data-size-live aria-live="polite">正在按新尺寸重算…</p>
          <p v-else-if="sizeNote" class="sizeLive sizeLive--note" data-size-note aria-live="polite">{{ sizeNote }}</p>
        </div>

        <!-- ③ 等比例缩放：默认开；关闭后宽高各自可调 -->
        <label class="sizeLock">
          <span>等比例缩放 <em>（宽高锁定）</em></span>
          <input type="checkbox" class="sizeSwitch" data-size-aspect :checked="aspectLocked" @change="onAspectChange">
          <i aria-hidden="true"></i>
        </label>

        <!-- ④ 实时摘要：画布 / 成品区域 / 成品厘米 / 豆子总数（豆子数来自实际重新采样后的有效格子） -->
        <dl class="sizeSummary" data-size-summary>
          <div><dt>画布（底板）</dt><dd data-size-board>{{ canvasCapW }} × {{ canvasCapH }} 格 · {{ boardsTextShort(canvasCapW, canvasCapH) }}</dd></div>
          <div><dt>成品区域</dt><dd data-size-cells>{{ previewCells }} · 占画布 {{ previewShare }}%</dd></div>
          <div><dt>预计成品尺寸</dt><dd data-size-finish>{{ previewCmBoth }}</dd></div>
          <div><dt>预计豆子总数</dt><dd data-size-beads>{{ previewBeads || '—' }}</dd></div>
        </dl>

        <!-- ⑤ 提示：画布与豆径两条限制，外加缩小的代价 -->
        <p class="sizeLimit" data-size-limit><i aria-hidden="true">!</i>{{ sizeLimitHint }}</p>
        <!-- 画布超过原图分辨率：再加格只是插值，不会更清楚 -->
        <p v-if="canvasOverSource" class="sizeLimit sizeLimit--warn" data-size-over-source>
          <i aria-hidden="true">!</i>
          <template v-if="canvasOverSource.cappedByApp">
            原图 {{ canvasOverSource.srcW }}×{{ canvasOverSource.srcH }} px，生成时会先缩到 {{ canvasOverSource.effSide }} px 再逐格取样，超过 {{ canvasOverSource.effSide }} 格不会更清楚。
          </template>
          <template v-else>
            原图只有 {{ canvasOverSource.srcW }}×{{ canvasOverSource.srcH }} px，当前 {{ canvasOverSource.canvasMax }} 格已经超过它，再加格不会更清楚。
          </template>
        </p>

        <!-- ⑥ 恢复默认：用满当前画布规格，不动其它参数 -->
        <button class="sizeReset" type="button" data-size-reset @click="resetSize">
          <PixelIcon name="restore" :size="13" />恢复默认
        </button>
      </div>
    </section>

    <!-- ② 画布大小（手机）：整块只留一行 —— 左边标题、右边当前尺寸、最右一个箭头。
         点这一行就地弹出可选画布列表，见下面的 .sizePanel。
         为什么收成一行：左栏只有 300px 宽，原来 8 个档位格 + 灰底信息条要吃掉 340px 高，
         而这块参数是「偶尔改一次」的，平时不该占着画布的地盘。 -->
    <section v-else ref="sizeWrap" class="card card--size" :class="{ 'is-open': sizeOpen, 'is-focus': focus === 'size' }">
      <button
        class="sizeRow" type="button" data-size-row
        :aria-expanded="sizeOpen" aria-haspopup="true"
        :title="sizeOpen ? '收起可选画布列表' : `点这里选择画布尺寸（拼板规格 ${BOARD_SPEC_LIST_TEXT} 钉）`"
        @click="sizeOpen = !sizeOpen"
      >
        <span class="sizeRow__title"><span class="stepNo">2</span>画布与成品</span>
        <span class="sizeRow__value" data-size-value>{{ sizeRowValue }}</span>
        <i class="cardArrow" :class="{ 'cardArrow--open': sizeOpen }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
      </button>

      <div v-show="sizeOpen" class="sizePanel" data-size-panel :style="{ top: panelPos.top + 'px', left: panelPos.left + 'px' }">
        <!-- 手机端这块列表就是抽屉正文，标题已经由抽屉头显示：这里只留一句口径说明 -->
        <div class="sizePanel__head">
          <span class="muted">底板定死；成品尺寸调图案在底板上占多大</span>
        </div>

        <!-- ① 画布规格（底板）：与宽屏下拉同一套档位，只换底板，成品区域放不下才收敛 -->
        <div class="sizeField">
          <div class="sizeField__head"><b>画布规格（底板）</b></div>
          <select class="sizeSpecSelect" data-size-board-spec :value="specValue" @change="onBoardPick">
            <option v-for="o in boardSpecOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p class="sizeField__hint">决定底板多大（当前 {{ specLabel }}）；成品尺寸在它里面缩放。</p>
        </div>

        <!-- ② 成品尺寸：图案在底板上占多大（四周留空），与宽屏同一套滑杆与读数 -->
        <div class="sizeField">
          <div class="sizeField__head">
            <b>成品尺寸</b>
            <span class="sizeBig" data-size-cm>{{ previewCm }}</span>
          </div>
          <p class="sizeField__hint">图案在画布上占多大；四周留空不放豆。</p>

          <template v-if="aspectLocked">
            <div class="sizeSlideRow">
              <button
                class="sizeStep" type="button" data-size-minus aria-label="缩小成品尺寸"
                :disabled="!sizeReady" @click="nudgeLong(-1)"
              >−</button>
              <input
                class="sizeRange" type="range" data-size-range
                :min="SIZE_MIN_CELLS" :max="capLong" step="1"
                :value="previewLong" :disabled="!sizeReady"
                :aria-valuetext="previewCm"
                :style="{ '--fill': longFillPct + '%' }"
                @input="onLongInput" @change="onLongCommit"
              >
              <button
                class="sizeStep" type="button" data-size-plus aria-label="放大成品尺寸"
                :disabled="!sizeReady" @click="nudgeLong(1)"
              >＋</button>
            </div>
            <div class="sizeTicks" aria-hidden="true">
              <span v-for="(t, i) in sizeTicks" :key="i">{{ t }}</span>
              <em>(cm)</em>
            </div>
          </template>

          <template v-else>
            <div v-for="axis in ['w', 'h']" :key="axis" class="sizeSlideRow sizeSlideRow--side">
              <span class="sizeSideLabel">{{ axis === 'w' ? '宽' : '高' }}</span>
              <button
                class="sizeStep" type="button" :aria-label="axis === 'w' ? '缩小宽度' : '缩小高度'"
                :disabled="!sizeReady" @click="nudgeSide(axis, -1)"
              >−</button>
              <input
                class="sizeRange" type="range" :data-size-range="axis"
                :min="SIZE_MIN_CELLS" :max="sideMax(axis)" step="1"
                :value="axis === 'w' ? sizePreviewW : sizePreviewH" :disabled="!sizeReady"
                :aria-label="axis === 'w' ? '宽度' : '高度'"
                :style="{ '--fill': sideFillPct(axis) + '%' }"
                @input="onSideInput(axis, $event)" @change="onSideCommit(axis, $event)"
              >
              <button
                class="sizeStep" type="button" :aria-label="axis === 'w' ? '放大宽度' : '放大高度'"
                :disabled="!sizeReady" @click="nudgeSide(axis, 1)"
              >＋</button>
              <b class="sizeSideVal">{{ axis === 'w' ? sizePreviewW : sizePreviewH }} 格</b>
            </div>
          </template>

          <p v-if="!sizeReady" class="sizeEmpty" data-size-empty>上传图片或选择素材后可调整成品尺寸。</p>
          <p v-else-if="sizePending" class="sizeLive" data-size-live aria-live="polite">正在按新尺寸重算…</p>
          <p v-else-if="sizeNote" class="sizeLive sizeLive--note" data-size-note aria-live="polite">{{ sizeNote }}</p>
        </div>

        <!-- ③ 实时摘要：画布 / 成品区域 / 成品厘米 / 豆子总数 -->
        <dl class="sizeSummary" data-size-summary>
          <div><dt>画布（底板）</dt><dd data-size-board>{{ canvasCapW }} × {{ canvasCapH }} 格 · {{ boardsTextShort(canvasCapW, canvasCapH) }}</dd></div>
          <div><dt>成品区域</dt><dd data-size-cells>{{ previewCells }} · 占画布 {{ previewShare }}%</dd></div>
          <div><dt>预计成品尺寸</dt><dd data-size-finish>{{ previewCmBoth }}</dd></div>
          <div><dt>预计豆子总数</dt><dd data-size-beads>{{ previewBeads || '—' }}</dd></div>
        </dl>

        <!-- 三个数的口径必须写在列表头上：豆子（珠径）、板子（钉数 + 实测外框）、成品（格数 × 豆径）。
             板面比成品大一点是正常的 —— 差的那点就是板的边框。 -->
        <p class="sizeHint" data-size-hint>
          <b>{{ DEFAULT_BEAD_TEXT }}</b> · 一钉 = 一格 · 成品尺寸 = 格数 × {{ bead.mm }} mm ·
          板子 {{ boardNotesText }}（板面含边框，比成品略大）
        </p>

        <div class="sizeQuickHead">
          <b>常用成品尺寸</b>
          <span>点一档就把图案改成这么大；底板放不下时自动换大</span>
        </div>

        <ul class="sizeList">
          <li v-for="row in sizeRows" :key="row.key">
            <button
              class="pick pick--row" :class="{ on: row.current, 'is-locked': row.locked }"
              :data-size="`${row.w}×${row.h}`" :data-tier="row.key" :data-spec="row.spec"
              :title="row.locked
                ? `${row.name} ${row.w} × ${row.h} 格 · Pro 功能`
                : `${row.name} · ${row.note} · 成品 ${row.finish}`"
              @click="pickBox(row)"
            >
              <strong>{{ row.w }} × {{ row.h }}<span v-if="row.locked" class="sizeLock" aria-label="Pro 功能"><PixelIcon name="lock" :size="11" /></span></strong>
              <span class="pickRowInfo">
                <b>{{ row.name }} · {{ row.use }}</b>
                <em>{{ row.beadText }} · 成品 {{ row.finish }}</em>
              </span>
              <em v-if="row.current" class="sizeTag sizeTag--now">当前</em>
              <em v-else-if="row.recommended" class="sizeTag sizeTag--rec">推荐</em>
              <em v-else-if="row.overSource" class="sizeTag sizeTag--warn">超出原图</em>
            </button>
          </li>

          <!-- 尺寸列表的最后一项永远是「自定义」：选规格 × 横向几块 × 纵向几块。
               长宽必然是规格的整数倍 —— 拼板就是 52 / 78 / 104 / 120 四个规格，
               要更大的画布只能再加同等规格的板。 -->
          <li class="sizeList__custom">
            <button
              class="pick pick--row pick--custom" :class="{ on: customOpen }"
              data-custom-toggle type="button" :aria-expanded="customOpen"
              :title="`按规格一块一块加：${BOARD_SPEC_LIST_TEXT} 钉画线板 × 横几块 × 纵几块`"
              @click="toggleCustom"
            >
              <strong>自定义尺寸</strong>
              <span>{{ customOpen ? '收起来' : `当前 ${width} × ${height} 格` }}</span>
              <em class="sizeTag sizeTag--custom" aria-hidden="true"><PixelIcon :name="customOpen ? 'chevronUp' : 'chevronDown'" :size="12" /></em>
            </button>

            <div v-show="customOpen" class="customBox" data-custom-box>
              <div class="customRow">
                <label for="customSpec">规格</label>
                <select id="customSpec" v-model.number="customSpec" data-custom-spec @change="onCustomEdit">
                  <option v-for="s in BOARD_SPECS" :key="s" :value="s">{{ s }} 钉板</option>
                </select>
              </div>
              <div class="customRow customRow--n">
                <label for="customCols">横向</label>
                <input id="customCols" v-model.number="customCols" data-custom-cols type="number" min="1" max="19" step="1" @input="onCustomEdit">
                <span>块</span>
                <label for="customRows">纵向</label>
                <input id="customRows" v-model.number="customRows" data-custom-rows type="number" min="1" max="19" step="1" @input="onCustomEdit">
                <span>块</span>
              </div>
              <!-- 选完规格 / 块数，下面直接算出成品尺寸：不用再点「算尺寸」 -->
              <div class="customFinish" :class="{ 'is-locked': customLocked }" data-custom-finish>
                <span>成品尺寸</span>
                <b>{{ customCm }}</b>
                <em v-if="customLocked">需 Pro 解锁</em>
                <em v-else>板面 {{ customOuter }}</em>
              </div>
              <div class="customSum">
                <b>{{ customPreview.w }} × {{ customPreview.h }}</b> 格 ·
                {{ customPreview.cols * customPreview.rows }} 块 {{ customPreview.spec }} 钉画线板<template v-if="customSpecBoard">（{{ customSpecBoard.note }}）</template><br>
                最多 {{ (customPreview.w * customPreview.h).toLocaleString() }} 颗 · {{ beadText }}
              </div>
              <!-- 改块数不再需要点按钮：这行字告诉用户画布已经跟着变了（或正在变） -->
              <div v-if="customLiveText" class="customLive" data-custom-live aria-live="polite">
                <i aria-hidden="true"></i>{{ customLiveText }}
              </div>
              <div class="customNote" :class="{ warn: customPreview.capped || customLocked }">
                <template v-if="customLocked">
                  当前套餐单边上限 {{ maxCells }} 格：{{ customPreview.spec }} 钉板一块就是 {{ customPreview.spec }} 格，需要 Pro 才能用。
                </template>
                <template v-else-if="customPreview.capped">
                  已按当前套餐收敛：单边最大 {{ maxCells }} 格（{{ customPreview.spec }} 钉板最多 {{ Math.floor(maxCells / customPreview.spec) }} 块）。
                </template>
                <template v-else>
                  最大单边 {{ maxCells }} 格（{{ customPreview.spec }} 钉板最多 {{ Math.floor(maxCells / customPreview.spec) }} 块）·
                  长宽都是 {{ customPreview.spec }} 的整数倍。
                </template>
              </div>
              <button class="btn primary block" type="button" data-custom-apply @click="applyCustom">
                {{ customLocked
                  ? `升级 Pro 解锁 ${customPreview.w} × ${customPreview.h} 格`
                  : customApplied
                    ? `完成 · 已是 ${customPreview.w} × ${customPreview.h} 格`
                    : `用 ${customPreview.w} × ${customPreview.h} 格` }}
              </button>
            </div>
          </li>
        </ul>

        <!-- 灰底信息条：选完以后「到底多大、要几颗豆、多少钱」是唯一的确认，
             收掉了用户就不知道自己刚选的是什么。 -->
        <div class="boardInfo" data-size-info>
          画布 <b>{{ canvasCapW }} × {{ canvasCapH }}</b> 格 · 成品区域 <b>{{ width }} × {{ height }}</b> 格
          <template v-if="stats"> · 占画布 {{ stats.sharePct }}% · 成品 {{ stats.cm }}</template>
          · {{ boardsText(canvasCapW, canvasCapH) }}（板面 {{ boardOuterText(canvasCapW, canvasCapH) }}）
          · {{ beadText }}（1 格 = {{ bead.mm }} mm）
          <template v-if="maxCells < MAX_TIER">
            · 免费版单边上限 {{ maxCells }} 格
            <button class="inlineLink" @click="emit('need-pro', `更大的画布（单边最大 1000 格）是 Pro 功能：拼板按 ${BOARD_SPEC_LIST_TEXT} 钉一块一块加。`)">升级解锁更多拼板</button>
          </template>
        </div>

        <!-- 老存档 / 手动改过的底板铺不满整板：分板线之外会留空，必须先说清楚 -->
        <p v-if="!sizeWholeBoard" class="processHint" style="margin:6px 0 0">
          这块底板（{{ canvasCapW }} × {{ canvasCapH }} 格）没有哪个规格能整铺满 —— 多半来自老存档
          （拼板是 {{ BOARD_SPEC_LIST_TEXT }} 钉画线板，两个方向都得是**同一个规格**的整数倍；
          现在不做混规格，所以 52 × 78 这种边长最外圈会空一条）。
          图纸上的板边线仍按整板画，最外圈留空即可；换成整板尺寸拼起来才对得上。
        </p>

        <!-- 极限档（≥ 25 万格）的定位必须说清：这已经不是"照着一张图拼完"的量级了，
             不然用户会以为我们建议他真去买几万克豆子 -->
        <p v-if="hugeCanvas" class="processHint" style="margin:6px 0 0">
          {{ width }} × {{ height }} = {{ (width * height).toLocaleString() }} 格，成品约
          {{ (width * bead.cm / 100).toFixed(1) }} × {{ (height * bead.cm / 100).toFixed(1) }} 米、
          {{ boardsText(width, height) }}，实体量级已经不适合整张拼出来。
          这一档的用处是「先把复杂照片转准」：看清细节后导成 PNG 存档，或者挑其中一块区域用小档位重做。
        </p>
        <!-- 画布超过原图（或超过取样上限）分辨率：加大画布只是插值，先把这句话说清楚，
             否则用户会以为「开到大档还是不清晰 = 工具不行」 -->
        <p v-if="canvasOverSource" class="processHint" style="color:var(--danger);margin:6px 0 0">
          <template v-if="canvasOverSource.cappedByApp">
            原图 {{ canvasOverSource.srcW }}×{{ canvasOverSource.srcH }} px，为了不让浏览器爆内存，
            生成时会先把原图缩到 {{ canvasOverSource.effSide }} px 再逐格取样，
            所以画布超过 {{ canvasOverSource.effSide }} 格之后多加的格子没有新的像素可用，不会更清楚。
          </template>
          <template v-else>
            原图只有 {{ canvasOverSource.srcW }}×{{ canvasOverSource.srcH }} px，当前画布 {{ canvasOverSource.canvasMax }} 格已经超过它 ——
            再加上去的格子都是插值出来的，不会更清楚。想更细请换一张更大的原图。
          </template>
        </p>
      </div>
    </section>

    <!-- ③ 生成方案：2×2 方案格
         一个方案只在一个地方出现 —— 原来这里是「一行一个」的长列表，
         右栏还并排放着同一批方案的「一次看懂 N 种方案」，两份列表信息完全重复；
         右栏那份已删除，这里换成参考版的 2×2 方案格（更矮、更好点）。
         卡里原来自带一个「⚙ 更多设置」折叠（方案明细 + 恢复方案），已按需求删除：
         明细挪不回来也不可惜（每个方案的数值右栏「作品分析」里有），
         「恢复方案」挪到 ④ 的「⚙ 抖动 / 去孤立豆 / 格内色号」折叠里，和它影响的参数待在一起。 -->
    <section class="card card--scheme" :class="{ 'is-folded': !openScheme, 'is-focus': focus === 'scheme' }">
      <div class="card__head">
        <h3><span class="stepNo">3</span>生成方案</h3>
        <span class="muted card__headValue">{{ variantCards.length ? '先用推荐就好' : '先选图' }}</span>
        <button
          class="cardArrowBtn" type="button"
          :aria-expanded="openScheme" aria-label="展开或收起生成方案"
          @click="openScheme = !openScheme"
        ><i class="cardArrow" :class="{ 'cardArrow--open': openScheme }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i></button>
      </div>
      <div class="card__body stack stack--sm">
        <div v-if="!hasPattern" class="processHint" style="margin-top:0">
          上传图片或选择素材后，会自动搜索并给出方案。
        </div>
        <!-- 需求 §4.3：重新生成可能覆盖手工编辑时必须提示。这里在用户动手前给出明确警告，
             用户仍可先保存作品或不动参数，等于保留了取消的机会。 -->
        <div v-else-if="canUndo" class="processHint" style="margin-top:0;color:var(--orange-deep)">
          当前图纸有手工编辑。切换方案或修改参数会重新生成并清空编辑历史；
          想保留这次修改，请先点上方「保存」。
        </div>

        <div v-else class="schemeGrid mHide">
          <button
            v-for="v in variantCards" :key="v.key"
            type="button"
            class="schemeCard" :class="{ on: activeKey === v.key }"
            :title="v.desc || v.buildText"
            @click="selectVariant(v.key)"
          >
            <b>{{ v.label }}<span v-if="v.recommended" class="recStar" aria-label="第一次玩推荐"><PixelIcon name="star" :size="11" /></span></b>
            <span>{{ v.recommended ? '第一次玩推荐' : schemeHint(v) }}</span>
          </button>
          <div class="schemeCard schemeCard--ai is-soon" :title="AI_PENDING_TEXT" data-audit="ai-pending-optimize">
            <b class="aiLabel"><PixelIcon name="sparkles" :size="12" />一键优化</b>
            <span>{{ AI_PENDING_TEXT }}</span>
          </div>
        </div>
        <!-- 手机上：三个方案一行下拉 + 「✦ 一键优化」一个按钮（它是动作不是选项，
             所以留在下拉外面）。推荐那一档在下拉里自带 ⭐，不然换成下拉就丢了推荐信息。
             一键优化依赖 AI 生图能力，按钮先禁用，下面用文字占位。 -->
        <div v-if="hasPattern" class="mDrop mDrop--scheme mRow">
          <select :value="activeKey" aria-label="生成方案" @change="selectVariant($event.target.value)">
            <option v-for="v in variantCards" :key="v.key" :value="v.key">
              {{ v.label }}{{ v.recommended ? '（推荐）' : '' }} · {{ v.recommended ? '第一次玩推荐' : schemeHint(v) }}
            </option>
          </select>
          <button
            type="button" class="btn btn-secondary sm aiBtn is-soon" disabled
            :title="AI_PENDING_TEXT"
          ><PixelIcon name="sparkles" :size="13" />一键优化</button>
        </div>
        <p v-if="hasPattern" class="soonHint mOnly">一键优化：{{ AI_PENDING_TEXT }}</p>

        <div v-if="variantCards.length === 1" class="processHint" style="margin-top:0">
          免费版一次给出 1 个方案。升级 Pro 可同时搜索 3 个方案并自动推荐。
          <button class="inlineLink" @click="emit('need-pro', '自动搜索并对比 3 个方案是 Pro 功能。')">了解 Pro</button>
        </div>
        <p v-else-if="lastSearch" class="processHint" style="margin-top:0">
          已搜索 {{ lastSearch.candidates }} 个候选方案，综合还原度、可拼性、颜色数与豆子数量后推荐
          「{{ (variantCards.find(v => v.recommended) || variantCards[0]).label }}」。
          <template v-if="lastSearch.inventoryApplied">（已按你的库存重新配色）</template>
        </p>
      </div>
    </section>

    <!-- ④ 色板选择：卡头就是这个折叠的唯一一行「色板选择 + 当前值 + ▼」，
         点开才是颜色数量 / 色板 / 填充方式 / 高级参数（色板那一项在展开后重点突出）。
         宽窄屏都默认收起，展开状态只由用户点这一行决定。 -->
    <section class="card card--more" data-fold="js" :class="{ 'is-open': openMore, 'is-focus': focus === 'palette' }">
      <button
        class="moreRow" type="button" :aria-expanded="openMore" aria-controls="morePanel"
        @click="onMoreFoldClick"
      >
        <h3 class="moreRow__title"><span class="stepNo">4</span>色板选择</h3>
        <span class="moreRow__value">{{ options.targetColors }} 色 · {{ currentBrand.name }}</span>
        <i class="cardArrow" :class="{ 'cardArrow--open': openMore }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
      </button>
      <div id="morePanel" class="card__body stack stack--sm">
        <!-- 色板：整张卡的重点。展开后第一眼看到的就是它 —— 品牌色描边 + 淡底，
             标题右边写清「本套共几色」，下面一行放品牌下拉 + 本套实时可用色数，
             免费版被砍过色号时再补一条升级提示。 -->
        <div class="paletteHero">
          <div class="paletteHero__head">
            <b>色板</b>
            <span>{{ currentBrand.name }} · 本套 {{ currentBrand.colorCount }} 色</span>
          </div>
          <select
            v-model="options.brandId" class="paletteHero__pick" aria-label="色板选择"
            data-audit="palette-select" @change="onColorsChange"
          >
            <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">
              {{ b.name }} · {{ b.colorCount }} 色
            </option>
          </select>
          <div class="paletteHero__foot">
            <span>本套可用 <b>{{ colorsInUse }}</b> 色{{ paletteLimited ? '（免费版精简）' : '' }}</span>
            <span class="paletteHero__footEnd">
              <button
                v-if="paletteLimited" class="inlineLink" type="button"
                @click="emit('need-pro', '完整品牌色板是 Pro 功能。')"
              >解锁全部色板</button>
              <!-- 来源说明收进这个灰色「!」：和「本套可用」同一行，贴齐下拉框右边缘 -->
              <button
                type="button" class="paletteNoteBtn" :class="{ on: paletteNoteOpen }"
                :aria-expanded="paletteNoteOpen" aria-controls="paletteNote"
                aria-label="色卡来源说明" title="色卡来源说明"
                data-audit="palette-note-toggle"
                @click="paletteNoteOpen = !paletteNoteOpen"
              ><PixelIcon name="info" :size="11" /></button>
            </span>
          </div>
          <p v-if="paletteNoteOpen" id="paletteNote" class="paletteNote">{{ paletteNote }}</p>
          <p v-if="paletteLimited" class="processHint" style="color:var(--coral-deep)">
            免费版在「{{ currentBrand.name }}」上可用 {{ colorsInUse }} 色精简色板（共 {{ currentBrand.colorCount }} 色）；
            漫德 MARD 全套（24–291 色，八个套装都给全）可用全部色号。
          </p>
        </div>

        <div class="field">
          <label>
            颜色数量
            <span>目标 {{ options.targetColors }}{{ stats ? ' · 实际 ' + stats.colors : '' }} 色</span>
          </label>
          <div class="rangeRow mHide colorRow">
            <input v-model.number="options.targetColors" type="range" min="4" :max="colorsMax" data-audit="target-colors" @change="onColorsChange">
            <input class="valueBox" type="number" min="4" :max="colorsMax" data-audit="target-colors" :value="options.targetColors" @change="options.targetColors = Number($event.target.value); onColorsChange()">
          </div>
          <!-- 手机上：档位下拉 + 原来的数字框（精确值还得能直接敲，比如 37 色） -->
          <div class="mDrop mDrop--colors mRow">
            <select :value="options.targetColors" aria-label="颜色数量" @change="onColorsPick">
              <option v-for="n in colorChoices" :key="n" :value="n">{{ n }} 色</option>
            </select>
            <input
              class="valueBox" type="number" min="4" :max="colorsMax"
              :value="options.targetColors" aria-label="颜色数量（直接输入）"
              @change="options.targetColors = Number($event.target.value); onColorsChange()"
            >
          </div>
          <!-- 上限从 30 放到「色板真实可用色号数」（漫德 291 / COCO 291，最多取 291）：
               复杂照片"不像"有一半是色号不够，只给 30 色时脸部的过渡只能硬着落 -->
          <p class="processHint only-lg">
            最多 {{ colorsMax }} 色（{{ currentBrand.name }} 可用 {{ colorsInUse }} 色）。格数决定形状多细，色号决定像不像。
          </p>
          <!-- 1000 格配 16 色 = 把精细档的一半浪费掉：给一句可执行建议，不自动改用户的选择 -->
          <p v-if="colorHint" class="processHint" :style="{ color: 'var(--coral-deep)' }">{{ colorHint }}</p>
        </div>

        <div class="field">
          <label>填充方式 <span>{{ options.fit === 'contain' ? '不裁剪' : '会裁边缘' }}</span></label>
          <div class="grid-2 mHide fitGrid">
            <button class="pick" :class="{ on: options.fit === 'contain' }" @click="options.fit = 'contain'; onColorsChange()">
              <strong>完整放入</strong><span>整图保留</span>
            </button>
            <button class="pick" :class="{ on: options.fit === 'cover' }" @click="options.fit = 'cover'; onColorsChange()">
              <strong>裁切填满</strong><span>不留白</span>
            </button>
          </div>
          <div class="mDrop mDrop--fit">
            <select :value="options.fit" aria-label="填充方式" @change="onFitPick">
              <option value="contain">完整放入 · 整图保留</option>
              <option value="cover">裁切填满 · 不留白</option>
            </select>
          </div>
        </div>

        <div class="folds">
          <button class="foldHeader" type="button" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
            <span class="foldLabel"><PixelIcon name="sliders" :size="13" />抖动 / 去孤立豆 / 格内色号</span>
            <i class="foldChev"><PixelIcon :name="advancedOpen ? 'minus' : 'plus'" :size="12" /></i>
          </button>
          <div v-if="advancedOpen" class="foldBody">
            <div class="field">
              <label>抖动 <span>默认关闭</span></label>
              <div class="grid-2 keep">
                <button
                  v-for="d in [{ k: 'off', t: '关闭' }, { k: 'low', t: '低' }, { k: 'medium', t: '中' }, { k: 'high', t: '高' }]"
                  :key="d.k" class="pick" :class="{ on: options.dither === d.k }"
                  @click="options.dither = d.k; onColorsChange()"
                ><strong>{{ d.t }}</strong><span>{{ d.k === 'off' ? '色块最干净' : '渐变更顺滑' }}</span></button>
              </div>
              <p class="processHint">抖动会用误差扩散模拟中间色，代价是豆子更零散、更难拼。</p>
            </div>

            <div class="checkrow">
              <label class="check">
                <input v-model="options.cleanup" type="checkbox" @change="onColorsChange()">
                去孤立豆
              </label>
              <label class="check">
                <input v-model="options.enhance" type="checkbox" @change="onColorsChange()">
                色彩增强
              </label>
              <label class="check">
                <input v-model="options.numbering" type="checkbox">
                格内色号
              </label>
              <label class="check">
                <input v-model="options.showGrid" type="checkbox">
                网格线
              </label>
              <label class="check">
                <input v-model="options.boardLines" type="checkbox">
                底板边界
              </label>
            </div>

            <!-- 恢复方案原来挂在 ③ 的折叠里；那个折叠删掉后挪到这里，
                 和它影响的那些参数待在一起（改动随时可逆） -->
            <button
              v-if="hasPattern"
              class="btn soft block"
              title="回到这张图的最优方案"
              @click="restoreVariant()"
            ><PixelIcon name="restore" :size="14" />恢复方案</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ⑤ 图纸交付：从右栏移到这里（与「我的库存」交换位置）。
         卡里只放进度摘要和一个入口，具体格式 / DPI / 分板 / 完成操作都在面板里。 -->
    <section class="card card--build" :class="{ 'is-folded': !openBuild, 'is-focus': focus === 'delivery' }">
      <div class="card__head">
        <h3><span class="stepNo">5</span>图纸交付</h3>
        <span class="muted card__headValue">{{ isFinished ? '已完成' : '导出 · 分板 · 拼装' }}</span>
        <button
          class="cardArrowBtn" type="button"
          :aria-expanded="openBuild" aria-label="展开或收起图纸交付"
          @click="openBuild = !openBuild"
        ><i class="cardArrow" :class="{ 'cardArrow--open': openBuild }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i></button>
      </div>
      <div class="card__body stack stack--sm">
        <div class="folds">
          <div class="foldBody" style="padding:12px;gap:9px">
            <div class="row row--between">
              <b style="font-size:var(--fs-xs)">拼装进度</b>
              <b class="buildPct">{{ hasPattern ? (isFinished ? 100 : buildStats.percent) : 0 }}%</b>
            </div>
            <div class="bar"><i :style="{ width: (hasPattern ? (isFinished ? 100 : buildStats.percent) : 0) + '%' }"></i></div>
            <p class="hint">
              <template v-if="isFinished">
                <span class="iconInline doneMark"><PixelIcon name="check" :size="12" />完成于 {{ timeAgo(finishedAt) }} · 共 {{ num(buildStats.total) }} 颗豆</span>
              </template>
              <template v-else-if="hasPattern && nextBoard">
                第 {{ nextBoard.no }} / {{ buildBoards.length }} 块板 · 已完成 {{ doneBoards }} 块 ·
                本板剩 {{ nextBoard.remaining }} 颗
              </template>
              <template v-else-if="hasPattern">
                共 {{ buildBoards.length }} 块板 · {{ buildStats.total.toLocaleString() }} 颗豆待拼
              </template>
              <template v-else>生成图纸后，这里会告诉你从哪一块板开始拼。</template>
            </p>
          </div>
        </div>

        <button class="btn primary block" :disabled="!hasPattern" data-audit="open-delivery-build" @click="emit('open-delivery', 'build')">
          打开图纸交付<PixelIcon name="arrowRight" :size="14" />
        </button>
        <p class="hint" style="margin:0">
          高清 PNG / JPG（150 / 300 / 600 DPI）、分板 PDF 与图片组、材料清单、拼装进度都在这里。
        </p>

        <div class="row row--between">
          <span class="muted">{{ saveStatus }}</span>
          <button class="btn btn-secondary sm" :disabled="!hasPattern" @click="onSave">保存作品</button>
        </div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
/* 手机端弹层（focus 模式）：只留一张卡，卡头由弹层标题代替。
   桌面侧栏的 focus 为空，下面这些规则一条都不生效。 */
.is-focus-mode > .card{display:none}
.is-focus-mode > .card.is-focus{display:block}
.is-focus-mode > .card.is-focus > .card__head,
.is-focus-mode > .card.is-focus > .moreRow,
.is-focus-mode > .card.is-focus > .sizeRow{display:none}

/* 缩略图 */
.thumb{position:relative}
.thumbName{
  position:absolute;left:8px;bottom:8px;background:rgba(35,49,34,.78);color:#fff;
  font-size:var(--fs-2xs);font-weight:700;padding:3px 9px;border-radius:var(--r-pill);
}
/* AI 功能占位：入口保留位置，用一句话说明还在对接 */
.soonPanel{
  display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;
  margin-top:9px;padding:18px 12px;border:1px dashed var(--line-strong);border-radius:var(--r-md);
  background:var(--surface-warm);
}
.soonPanel__icon{
  width:44px;height:44px;border-radius:12px;display:grid;place-items:center;
  background:var(--primary-soft);border:1px solid #F1E4B8;color:var(--primary-deep);
}
.soonPanel b{font-size:var(--fs-sm);font-weight:850;color:var(--primary-ink)}
.soonPanel p{font-size:var(--fs-2xs);color:var(--muted);line-height:1.6;margin:0}
.soonHint{font-size:var(--fs-2xs);color:var(--muted-2);line-height:1.5;margin-top:6px}
.procTab.is-soon{opacity:.62;background:var(--surface-2);border-style:dashed}
.procTab.is-soon:hover{border-color:var(--line);background:var(--surface-2)}
.schemeCard.is-soon{opacity:.8;background:var(--surface-2);cursor:not-allowed}
.schemeCard.is-soon b{color:var(--muted)}
.schemeCard.is-soon span{color:var(--muted)}
.aiBtn.is-soon{opacity:.7;cursor:not-allowed}
/* 免费素材：三列缩略格 */
.srcAssets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:9px}
.srcAsset{
  display:flex;flex-direction:column;gap:4px;padding:5px;
  border:1px solid var(--line);border-radius:var(--r-xs);background:var(--surface);transition:var(--t);
}
.srcAsset:hover{border-color:var(--line-strong);background:var(--surface-warm)}
.srcAsset__thumb{display:block;aspect-ratio:1;border-radius:6px;background:var(--surface-2);overflow:hidden}
.srcAsset__thumb svg{width:100%;height:100%;display:block}
.srcAsset b{
  font-size:var(--fs-2xs);font-weight:750;color:var(--ink-2);text-align:center;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* 处理页签展开的细节面板 */
.procDetail{margin-top:8px;display:flex;flex-direction:column;gap:7px}
.matteBar__levels,.cartoonBar__levels{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.matteBar__levels .seg,.cartoonBar__levels .seg{
  padding:6px 0;border-radius:var(--r-xs);border:1px solid var(--line-strong);background:var(--surface);
  font-size:var(--fs-2xs);font-weight:800;color:var(--muted);transition:var(--t);
}
.matteBar__levels .seg:hover{border-color:var(--line-strong)}
.matteBar__levels .seg.on{background:var(--primary-soft);border-color:var(--primary);color:var(--ink)}
.cartoonBar__levels .seg:hover{border-color:var(--line-strong)}
.cartoonBar__levels .seg.on{background:var(--primary-soft);border-color:var(--primary);color:var(--ink)}
.matteBar__note{font-size:var(--fs-2xs);line-height:1.6;color:var(--ink-2)}
.matteBar__note.warn{color:var(--coral-deep)}
.matteBar__note.weak{color:#B7791F}
.matteBar__note.fromSave{color:var(--muted)}
/* 缩略图上的「原图 / 卡通」对照开关 */
.thumbModes{
  position:absolute;left:8px;top:8px;display:flex;gap:3px;padding:3px;
  border-radius:var(--r-pill);background:rgba(255,255,255,.92);box-shadow:0 4px 12px rgba(0,0,0,.13);
}
.thumbModes .thumbMode{
  padding:3px 10px;border-radius:var(--r-pill);font-size:var(--fs-2xs);font-weight:800;color:var(--muted);
}
.thumbModes .thumbMode.on{background:var(--primary-soft);color:var(--ink)}
/* 方案格：2×2 —— 名字 + 一句「第一次玩推荐 / 细节更多」，
   选中项走全局 .pick 同一套橙色描边（border 2px + 淡橙底）。
   第 4 格是「✦ 一键优化」这个动作，和三个方案格长得一样但用虚线区分。 */
.schemeGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.schemeCard{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  padding:9px 6px;min-height:56px;text-align:center;
  border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);transition:var(--t);
}
.schemeCard:hover{border-color:var(--line-strong);background:var(--surface-warm)}
.schemeCard b{font-size:var(--fs-2xs);font-weight:850}
.schemeCard span{font-size:var(--fs-2xs);color:var(--muted-2);line-height:1.35}
.schemeCard.on{
  border:2px solid var(--primary);background:var(--primary-soft);padding:8px 5px;box-shadow:none;
}
.schemeCard.on b{color:var(--ink)}
.schemeCard.on span{color:var(--ink);opacity:.85}
.schemeCard--ai{border-style:dashed}
.schemeCard--ai b{color:var(--purple-deep)}
/* 方案名后面的推荐星：实心小星，和「第一次玩推荐」那行字同色 */
.recStar{display:inline-flex;align-items:center;margin-left:4px;vertical-align:-2px;color:var(--warn)}
.aiLabel{display:inline-flex;align-items:center;gap:5px}

/* 「✦ 一键优化」在下拉右边：它是动作不是选项，所以不塞进下拉里 ——
   虚线边沿用网格里 .schemeCard--ai 的同一套语言，一眼看出它不是第四个方案 */
.aiBtn{border-style:dashed;color:var(--purple-deep);font-weight:850}

/* ---------------- 手机端：①③④ 的选项组收成原生下拉（≤780px） ----------------
   桌面端这些下拉一律不出现（.mDrop 默认 display:none），仍然是原来那套按钮网格；
   手机上反过来：下拉出场、对应的网格让位（.mHide）。
   两套控件绑同一份状态，所以这里只是「显示哪一个」的问题 —— 少写一个类名，用户看到的
   就是「两层控件叠在一起」或「一个控件都没有」，而截图上没有任何报错可看。
   ② 画布大小不在名单里：它是一行 + 弹出列表，手机与桌面共用一份列表。 */
.mDrop{display:none}
/* 只在手机出现的一行说明（桌面上同一信息已经写在按钮/卡片里） */
.mOnly{display:none}
@media(max-width:780px){
  .mDrop{display:block}
  .mOnly{display:block}
  /* 下拉 + 右侧一个动作/数字框（✦ 一键优化、颜色数量的数字框就是这一行） */
  .mDrop.mRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center}
  /* .btn.sm 只有 ~27px 高，和 40px 的 select 并排会显得陷进去 */
  .mDrop .btn{min-height:40px}
  .mDrop .valueBox{width:64px;height:40px}
  .mHide{display:none}
}

/* ---------------- ④ 色板选择：一行卡头 + 展开后的参数 ----------------
   卡头是「色板选择 / 当前值 / ▼」的整行按钮，宽窄屏都是同一套（不再有手机专属的
   「展开 · 收起」字样按钮）；展开后色板那一块用品牌色描边 + 淡底抬出来。
   收起/展开靠 .is-open 控制，类名别再改动：它同时决定 ▼ 的旋转与面板的显隐。 */
.moreRow{
  width:100%;min-height:52px;padding:0 14px;display:flex;align-items:center;gap:9px;
  border:0;background:transparent;text-align:left;border-radius:var(--r-lg);transition:var(--t);
}
.moreRow:hover{background:var(--surface-3)}
.moreRow:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.card--more.is-open > .moreRow{border-bottom:1px solid var(--line);border-radius:var(--r-lg) var(--r-lg) 0 0}
.moreRow__title{margin:0;font-size:14px;font-weight:800;letter-spacing:-.01em;white-space:nowrap}
.moreRow__value{
  flex:1;min-width:0;text-align:right;font-size:var(--fs-2xs);color:var(--muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* 折叠箭头统一用全局 .cardArrow（见 styles/global.css），这里不再单独写一份。 */

/* 面板的显隐只认 .is-open。这里必须写死 display:none，不能靠全局 .card.is-folded
   那条规则：面板上挂着 .stack（display:flex），类顺序决定谁赢 —— 手机上出现过
   「卡头已经收起、参数还在下面摊着」的假收起，就是被它盖掉的。 */
.card--more:not(.is-open) > .card__body{display:none}

/* 展开后色板是主角：淡黄底 + 品牌黄描边，比同排的普通 .field 高一层 */
.paletteHero{
  display:flex;flex-direction:column;gap:9px;padding:11px 12px 12px;
  border:1px solid var(--primary);border-radius:var(--r-md);
  background:#FFF9F1;
}
.paletteHero__head{display:flex;align-items:baseline;gap:8px}
.paletteHero__head b{font-size:var(--fs-sm);font-weight:850;color:var(--ink);white-space:nowrap}
.paletteHero__head span{
  flex:1;min-width:0;font-size:var(--fs-2xs);color:var(--ink);opacity:.8;
  text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* 下拉比同排的普通 select 更重：字号大一点、边框用品牌色（背景留给全局 select
   那个箭头小三角，这里不覆盖 background-image，免得多出一层。）
   桌面端 38px 与全局 input 同高（44px 在宽屏上太胖）；手机上回到 46px 好点。 */
.paletteHero select.paletteHero__pick{
  min-height:38px;font-size:var(--fs-sm);font-weight:800;color:var(--ink);
  border-color:var(--primary);background-color:#fff;
}
@media(max-width:780px){
  .paletteHero select.paletteHero__pick{min-height:46px}
}
.paletteHero__foot{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-size:var(--fs-2xs);color:var(--ink-2);
}
.paletteHero__foot b{color:var(--ink);font-weight:850}
/* 这块底是淡黄，链接用黑字 + 下划线最清楚；scoped 的 [data-v-] 比全局单类多一位，压得住。 */
.paletteHero .inlineLink{color:var(--ink);font-size:var(--fs-2xs);white-space:nowrap}
/* 右端这一组（升级链接 + 来源「!」）贴齐下拉框右边缘；「!」与左边「本套可用」
   同一基线，所以整行用 align-items:center 压住。 */
.paletteHero__footEnd{display:flex;align-items:center;gap:8px;flex:none}
.paletteNoteBtn{
  width:18px;height:18px;flex:none;padding:0;border-radius:50%;
  border:1px solid #B4AEA9;background:transparent;color:#8C8681;
  font-family:inherit;font-size:12px;font-weight:900;line-height:1;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;
  transition:color .15s,border-color .15s,background .15s;
}
.paletteNoteBtn:hover,.paletteNoteBtn.on{color:#5F5A56;border-color:#5F5A56;background:#F4F0ED}
/* 展开后的来源说明：和色板块同底，只换一层浅色卡面，长文本按小字铺开 */
.paletteNote{
  margin:0;padding:7px 9px;border-radius:var(--r-sm,8px);
  border:1px solid #EFE7B8;background:#fff;
  font-size:var(--fs-2xs);line-height:1.5;color:#7A6A20;
}
/* 色板块里剩下的 processHint 只有免费版精简那一条：它是说明而不是表单字段，
   顶距收掉，字号收一档。用 :where() 让权重停在 0-1-0：模板里带
   style="color:var(--coral-deep)" 的升级提示要压得住这里的颜色，不然会被染成普通灰。 */
.paletteHero .processHint{margin-top:0;line-height:1.5}
.paletteHero :where(.processHint){font-size:var(--fs-2xs);color:#9A6B5E}

/* ---------------- ② 画布大小：一行 + 可选画布列表 ----------------
   收起状态就是那一行（左标题 / 右当前尺寸 / 最右箭头）；
   点开后桌面端从**右侧**浮出，手机上就地铺开（同一份列表，只有定位不同）。 */
.card--size{position:relative}
.sizeRow{
  width:100%;min-height:52px;padding:0 14px;display:flex;align-items:center;gap:9px;
  border:0;background:transparent;text-align:left;border-radius:var(--r-lg);transition:var(--t);
}
.sizeRow:hover{background:var(--surface-3)}
.sizeRow:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.card--size.is-open .sizeRow{border-bottom:1px solid var(--line);border-radius:var(--r-lg) var(--r-lg) 0 0}
.sizeRow__title{
  display:inline-flex;align-items:center;gap:8px;
  font-size:14px;font-weight:850;letter-spacing:-.01em;white-space:nowrap;
}
.sizeRow__value{
  flex:1;min-width:0;text-align:right;font-size:var(--fs-2xs);color:var(--muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}

.sizePanel{padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px}
.sizePanel__head{display:flex;align-items:baseline;gap:8px}
.sizePanel__head .muted{flex:1;min-width:0;font-size:var(--fs-2xs);line-height:1.45}

/* 列表头那三行口径：默认 2.6mm 豆 / 成品 = 格数 × 豆径 / 板子实测外框。
   这三句是用户对数的依据，不能省 —— 省了他就得自己乘一遍（见 sizeRows 的注释）。 */
.sizeHint{margin:0;font-size:var(--fs-2xs);line-height:1.55;color:var(--muted-2)}
.sizeHint b{color:var(--primary-ink);font-weight:850}

/* 手机端「常用成品尺寸」小标题：列表是成品快选，底板由上面的画布规格决定 */
.sizeQuickHead{margin-top:2px}
.sizeQuickHead b{display:block;font-size:var(--fs-2xs);font-weight:850;color:var(--ink)}
.sizeQuickHead span{display:block;font-size:var(--fs-2xs);line-height:1.45;color:var(--muted-2)}

.sizeList{list-style:none;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
/* 列表行：尺寸 + 档位说明 + 右侧标记（.pick 的全局样式给了边框与选中态，
   这里只把它从「竖排格子」掰成「横排一行」） */
.pick--row{
  width:100%;min-height:44px;flex-direction:row;align-items:center;gap:8px;padding:8px 10px;
}
.pick--row strong{font-size:var(--fs-2xs);font-weight:850;white-space:nowrap}
.pick--row span{
  flex:1;min-width:0;font-size:var(--fs-2xs);color:var(--muted-2);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* 每一行的「适合做什么 + 豆子 / 板子 / 成品」：两行文字，允许折行 ——
   .pick--row span 那条 nowrap 是给单行说明用的，这里必须覆盖（选择器权重也要压过它） */
.pick--row .pickRowInfo{
  flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;
  white-space:normal;overflow:visible;text-overflow:clip;
}
.pickRowInfo b{font-size:var(--fs-2xs);font-weight:850;color:var(--ink-2);line-height:1.3}
.pickRowInfo em{font-style:normal;font-size:var(--fs-2xs);color:var(--muted-2);line-height:1.45}
.sizeTag{
  font-style:normal;font-size:var(--fs-2xs);font-weight:850;padding:2px 7px;border-radius:var(--r-pill);
  white-space:nowrap;
}
.sizeTag--now{background:var(--ink);color:#fff}
.sizeTag--rec{background:var(--primary-soft);color:var(--primary-ink)}
.sizeTag--warn{background:var(--yellow-soft);color:var(--yellow-deep)}
.sizeTag--custom{background:transparent;color:var(--muted);display:inline-flex;align-items:center}
.sizeLock{display:inline-flex;align-items:center;margin-left:5px;vertical-align:-2px;color:var(--muted-2)}
.pick--custom{border-style:dashed}

/* 自定义尺寸：规格 × 横向几块 × 纵向几块 —— 长宽必然是规格的整数倍 */
.customBox{
  display:flex;flex-direction:column;gap:8px;margin-top:6px;padding:10px;
  border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface-2);
}
.customRow{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center}
.customRow label{font-size:var(--fs-2xs);font-weight:800;color:#78787F;white-space:nowrap}
.customRow--n{grid-template-columns:auto 54px auto auto 54px auto}
.customRow--n input{text-align:center;min-height:34px;padding:4px 6px}
/* 成品尺寸结果条：改规格 / 块数就跟着变，是这块面板的答案 */
.customFinish{
  display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;
  padding:8px 10px;border-radius:var(--r-sm);
  background:var(--primary-soft);color:var(--primary-ink);
}
.customFinish span{font-size:var(--fs-2xs);font-weight:800}
.customFinish b{font-size:16px;font-weight:900;letter-spacing:-.2px}
.customFinish em{font-style:normal;font-size:var(--fs-2xs);color:var(--ink-2);margin-left:auto}
.customFinish.is-locked{background:var(--surface);color:var(--muted)}
.customFinish.is-locked b{font-size:14px;color:var(--muted)}
.customRow select{min-height:34px;padding:4px 26px 4px 8px;background-position:calc(100% - 13px) 15px,calc(100% - 8px) 15px}
.customSum{font-size:var(--fs-2xs);color:var(--ink-2);line-height:1.55}
.customSum b{color:var(--ink);font-weight:850}
/* 实时预览的状态行：小圆点 + 一句话，说明「不用点按钮，画布已经跟着变了」 */
.customLive{display:flex;align-items:center;gap:6px;font-size:var(--fs-2xs);line-height:1.5;color:var(--green-deep)}
.customLive i{
  flex:none;width:6px;height:6px;border-radius:50%;background:var(--green);
  box-shadow:0 0 0 3px var(--green-soft);
}
.customNote{font-size:var(--fs-2xs);color:var(--muted-2);line-height:1.55}
.customNote.warn{color:var(--coral-deep)}
.buildPct{font-size:var(--fs-h3);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.foldLabel{display:inline-flex;align-items:center;gap:6px}
.foldLabel .icon{color:var(--muted)}
.foldChev{display:inline-flex;align-items:center;color:var(--muted)}
.doneMark{color:var(--green-deep);font-weight:750}

/* ---------------- ② 画布与成品尺寸（电脑 / 平板） ----------------
   收起 = 标题 + 实时摘要；展开后就地铺开，不再从右侧浮出。 */
.card--sizeWide{
  border-color:#F0DFA6;
  background:linear-gradient(180deg,#FFFDF5 0%,#fff 62%);
}
.sizeWideHead{
  width:100%;padding:11px 14px;display:flex;align-items:center;gap:10px;
  border:0;background:transparent;text-align:left;border-radius:var(--r-lg);transition:var(--t);
}
.sizeWideHead:hover{background:rgba(255,214,46,.12)}
.sizeWideHead:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.card--sizeWide.is-open .sizeWideHead{border-bottom:1px solid #F3E7C2;border-radius:var(--r-lg) var(--r-lg) 0 0}
.sizeWideHead__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.sizeWideHead__title{
  display:inline-flex;align-items:center;gap:8px;
  font-size:14px;font-weight:850;letter-spacing:-.01em;white-space:nowrap;color:var(--ink);
}
.sizeWideHead__sum{
  font-size:var(--fs-2xs);color:var(--muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.sizeWideBody{padding:13px 14px 14px;display:flex;flex-direction:column;gap:14px}

.sizeField{display:flex;flex-direction:column;gap:7px}
.sizeField__head{display:flex;align-items:baseline;gap:6px}
.sizeField__head b{font-size:13px;font-weight:850;color:var(--ink)}
.sizeQ{
  width:15px;height:15px;border-radius:50%;border:1.5px solid var(--muted-2);
  color:var(--muted-2);font-size:10px;font-weight:900;line-height:1;
  display:grid;place-items:center;transform:translateY(1px);
}
.sizeBig{
  margin-left:auto;font-size:19px;font-weight:900;letter-spacing:-.4px;
  color:var(--primary-deep);font-variant-numeric:tabular-nums;
}
.sizeField__hint{margin:0;font-size:11.5px;line-height:1.5;color:var(--muted-2)}
.sizeSpecSelect{
  width:100%;min-height:40px;padding:6px 34px 6px 11px;border-radius:10px;
  border:1px solid var(--line-strong);background-color:#fff;
  font-size:13px;font-weight:750;color:var(--ink);
  background-position:calc(100% - 17px) 17px,calc(100% - 12px) 17px;
}

/* 自定义尺寸：规格 × 块数，展开在规格下拉下面 */
.sizeCustom{
  display:flex;flex-direction:column;gap:8px;padding:10px;
  border:1px solid var(--line);border-radius:10px;background:var(--surface-2);
}
.sizeCustom__row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center}
.sizeCustom__row label{font-size:11.5px;font-weight:800;color:var(--muted);white-space:nowrap}
.sizeCustom__row--n{grid-template-columns:auto 54px auto auto 54px auto}
.sizeCustom__row select,.sizeCustom__row input{min-height:34px;font-size:12px;padding:4px 8px}
.sizeCustom__row--n input{text-align:center;padding:4px 4px}
.sizeCustom__row--n span{font-size:11.5px;color:var(--muted-2)}
.sizeCustom__sum{margin:0;font-size:11.5px;line-height:1.55;color:var(--ink-2)}
.sizeCustom__sum.warn{color:var(--coral-deep)}
.sizeCustom .btn.sm{min-height:34px}

/* 滑杆：黄色已填充 + 白心黄环的圆钮 */
.sizeSlideRow{display:flex;align-items:center;gap:9px}
.sizeSlideRow--side{gap:7px}
.sizeSideLabel{flex:none;width:18px;font-size:12px;font-weight:850;color:var(--muted)}
.sizeSideVal{flex:none;width:44px;text-align:right;font-size:11.5px;font-weight:850;color:var(--ink-2);font-variant-numeric:tabular-nums}
.sizeStep{
  flex:none;width:28px;height:28px;border-radius:50%;
  display:grid;place-items:center;font-size:16px;font-weight:900;line-height:1;
  background:var(--primary-soft);color:var(--primary-ink);border:0;transition:var(--t);
}
.sizeStep:hover:not(:disabled){background:var(--primary)}
.sizeStep:disabled{opacity:.42;cursor:not-allowed}
.sizeSlideRow .sizeRange{
  flex:1;min-width:0;width:auto;height:6px;border-radius:99px;cursor:pointer;
  -webkit-appearance:none;appearance:none;accent-color:var(--primary);
  background:linear-gradient(to right,var(--primary) 0 var(--fill,50%),var(--surface-3) var(--fill,50%) 100%);
  outline:none;
}
.sizeSlideRow .sizeRange::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;
  background:#fff;border:2px solid var(--primary);box-shadow:0 1px 4px rgba(24,24,28,.18);
  cursor:grab;
}
.sizeSlideRow .sizeRange::-moz-range-thumb{
  width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid var(--primary);
  box-shadow:0 1px 4px rgba(24,24,28,.18);cursor:grab;
}
.sizeSlideRow .sizeRange:disabled{opacity:.45;cursor:not-allowed}
.sizeTicks{
  display:flex;justify-content:space-between;margin:0 34px;padding:0;
  font-size:10px;color:var(--muted-2);font-variant-numeric:tabular-nums;
}
.sizeTicks em{font-style:normal}

.sizeEmpty,.sizeLive{margin:0;font-size:11.5px;line-height:1.5;color:var(--muted-2)}
.sizeEmpty{color:var(--orange-deep)}
.sizeLive{display:flex;align-items:center;gap:6px;color:var(--green-deep)}
.sizeLive::before{
  content:'';flex:none;width:6px;height:6px;border-radius:50%;
  background:var(--green);box-shadow:0 0 0 3px var(--green-soft);
}
.sizeLive--note{color:var(--orange-deep)}
.sizeLive--note::before{background:var(--orange);box-shadow:0 0 0 3px var(--orange-soft)}

/* 等比例缩放开关 */
.sizeLock{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  font-size:13px;font-weight:850;color:var(--ink);cursor:pointer;user-select:none;
}
.sizeLock em{font-style:normal;font-weight:600;color:var(--muted-2);font-size:12px}
.sizeSwitch{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
.sizeLock i{
  flex:none;position:relative;width:42px;height:24px;border-radius:99px;
  background:var(--surface-3);transition:var(--t);
}
.sizeLock i::after{
  content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;
  background:#fff;box-shadow:0 1px 3px rgba(24,24,28,.2);transition:var(--t);
}
.sizeSwitch:checked + i{background:var(--primary)}
.sizeSwitch:checked + i::after{transform:translateX(18px)}
.sizeSwitch:focus-visible + i{outline:2px solid var(--primary);outline-offset:2px}

/* 实时摘要：三行对齐的数字，换尺寸时整块一起变 */
.sizeSummary{
  margin:0;padding:10px 12px;border-radius:12px;background:var(--surface-2);
  display:flex;flex-direction:column;gap:7px;
}
.sizeSummary > div{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.sizeSummary dt{font-size:12px;color:var(--muted)}
.sizeSummary dd{
  margin:0;font-size:12px;font-weight:850;color:var(--ink);
  font-variant-numeric:tabular-nums;text-align:right;
}

.sizeLimit{display:flex;gap:7px;margin:0;font-size:11.5px;line-height:1.6;color:var(--muted-2)}
.sizeLimit--warn{color:var(--orange-deep)}
.sizeLimit i{
  flex:none;width:15px;height:15px;margin-top:1px;border-radius:50%;
  border:1.5px solid currentColor;display:grid;place-items:center;
  font-style:normal;font-size:10px;font-weight:900;line-height:1;
}
.sizeReset{
  width:100%;min-height:40px;display:flex;align-items:center;justify-content:center;gap:7px;
  border:1px solid var(--line);border-radius:12px;background:#fff;
  font-size:13px;font-weight:850;color:var(--ink);transition:var(--t);
}
.sizeReset:hover{background:var(--surface-warm);border-color:var(--line-strong)}

/* 手机（≤780px）：就地铺开。侧栏在手机上就是整屏宽，往右浮会溢出屏幕。 */
@media(max-width:780px){
  .sizePanel{position:static;width:auto;max-height:none;box-shadow:none;border:0}
  .pick--row{min-height:46px}
}

/* 桌面端（≥781px）：从右侧浮出，盖在画布上 —— 所以选完一档就自动收起。
   用 fixed + JS 实测坐标：左栏自己 overflow-y:auto，absolute 会被裁掉（见 placePanel）。 */
@media(min-width:781px){
  .sizePanel{
    position:fixed;width:308px;z-index:60;
    background:#fff;border:1px solid var(--line);border-radius:var(--r-lg);
    box-shadow:0 20px 48px rgba(24,24,28,.18);
    max-height:min(460px,72vh);overflow-y:auto;overscroll-behavior:contain;
  }
}
</style>
