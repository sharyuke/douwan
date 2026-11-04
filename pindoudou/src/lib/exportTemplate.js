/* =========================================================================
   豆玩导出图纸统一标版 V4
   -------------------------------------------------------------------------
   按《v3.0图纸导出》的批准设计图（最新图纸模板.png / 02_VISUAL_INDEX.png V2）
   逐区还原的导出版式。新手版第 ③ 步「下载拼豆图纸」与专业工作台「图纸交付」
   的整图导出（PNG / JPG / 高清 DPI，手机 · 平板 · 电脑三端）共用这一套标版：

     · 页眉：真 Logo → 浅绿网址胶囊（深色放大镜 + 黑体网址）→
       右侧深灰蓝 Slogan 与 粉/黄/绿/蓝 四圆点
     · 图纸：淡紫面板、浅绿描边、灰色细分格 + 每 10 格主格线、四边坐标
     · 底卡：白底淡紫描边双卡，标题都是黄绿胶囊（深色字），
       左「图案信息」胶囊右上角一对黄色星形装饰；六个像素风图标保留

   缩放口径：整套标版按「一格多少像素」等比放大（设计稿里一格 8.4 px）。
   所以 24 px/格 导出的整图与设计稿是同一套比例关系，只是分辨率更高；
   图纸本身不参与缩放（格内色号的清晰度优先）。

   数据口径（与《02_数据映射_动态导出与验收》一致）：
     · 格子数量 = 宽 × 高；豆子总数 = 实际有色豆子格数（透明格不计、白色豆子计）
     · 颜色数量 = 用量 > 0 的色号去重数，写作「N 色」
     · 色卡品牌及型号 = 当前选中的那一个套系（不并列多个候选）
     · 钉板型号 / 数量来自站内钉板元数据（boardSpec.js），不写死示意值
   ========================================================================= */

import { materialList, boardLayout } from './pattern.js'
import { normalizeBoardSize, boardOf as boardDefOf } from './boardSpec.js'
import { getBrand } from './palettes.js'

/* Logo 资源：用 new URL(..., import.meta.url) 取，Vite 构建时会换成带哈希的产物地址。
   不能写成 `import logo from '...webp'` —— 那样 Node 直接跑自检脚本
   （scripts/verify/export-*.mjs 直接 import 本模块）会因为不认 .webp 后缀而崩。
   包一层 try：自检脚本会把 globalThis.URL 换成只剩 createObjectURL 的桩，
   那时 new URL 不是构造器，直接抛会把整条自检带崩（Logo 在 Node 里本来也画不出来）。 */
const logoUrl = (() => {
  try {
    return new URL('../assets/logo-douwan.webp', import.meta.url).href
  } catch (e) {
    return ''
  }
})()

/** 页眉唯一网址 */
export const SITE_URL_TEXT = 'dw.sharyuke.com'
/** 页眉唯一 Slogan */
export const SLOGAN_TEXT = '所爱皆可拼，万物皆可造'

const FONT = '-apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'
const NUM = 'en-US'

/* ---------------------------------------------------------------- 设计基准

   全部取自最终设计图（1121 × 1403）里的实测像素，布局时统一乘缩放系数。 */
const D = {
  pageW: 1121,        // 设计稿页宽
  chartW: 1085,       // 设计稿里图纸区（网格 + 四边坐标）的宽
  rowW: 1080,         // 设计稿里底部双卡一行的宽
  cell: 8.4,          // 设计稿里一格的边长（= 图纸区 1005 px ÷ 120 格），仅作参考
  margin: 22,         // 页面左右留白
  bottomPad: 34,      // 页面底部留白
  headerH: 114,       // 页眉带高（V4 设计图实测 ≈107 px @ 1055 宽，折算 1121 ≈ 114）
  /* 图纸面板与底部双卡之间的留白（设计 px，导出时随整页一起放大）。
     V4 设计图实测 ≈30 px（1055 宽的稿子上 28 px）；左右双卡之间仍保持用户
     2026-10-29 定的 15 px。 */
  cardGap: 30,
  /* 底部左右两张卡之间的留白 */
  cardColGap: 15,
  logo: { x: 47, y: 18, h: 76 },
  capsule: { x: 329, y: 34, h: 49 },
  url: { size: 30, padL: 14, iconD: 21, iconGap: 10, padR: 20 },
  slogan: { size: 17, gap: 36 },
  blocks: { x: 975, y: 47, size: 18, gap: 7 },
  chart: { radius: 14 },
  card: {
    radius: 20,
    padTop: 20, padBottom: 16, padX: 19,
    pillH: 34, pillFont: 18, pillPadX: 17,
    /* 标题胶囊的左沿按卡片宽度的比例摆（设计稿：左卡 19/468、右卡 25/610） */
    pillXRatio: 19 / 468,
    rowH: 42, labelSize: 15, valueSize: 15,
    icon: 25, iconGap: 21,
    iconX: 36, labelX: 82, valueX: 227,   // 相对卡片宽度（468）的比例位置
    colHeadSize: 13, colTextSize: 12, colHeadH: 18, colRowH: 22,
    swatch: 15, colGap: 8,
    noteSize: 13
  },
  /* 底部双卡在页面上的占比（设计稿：左 468 : 右 610，中间留白见 cardColGap） */
  infoRatio: 468 / 1080
}

/* ---------------------------------------------------------------- 配色

   取自 V4 设计图（最新图纸模板.png）实测值：浅绿网址胶囊、淡紫面板与卡片描边、
   黄绿标题胶囊、灰色格线。 */
const C = {
  urlText: '#141414',
  urlPill: '#EBF6C5',
  urlIcon: '#2E3428',
  slogan: '#333845',
  blocks: ['#FCB9CA', '#FDD46B', '#A7DB6B', '#81B0FC'],
  panelBorder: '#E6F1C2',
  panelFill: '#FAF6FE',
  gridFine: '#EDEDF0',
  gridBold: '#D9D9DC',
  boardLine: '#C9A6A0',
  coord: '#7A809A',
  cardBg: '#FFFFFF',
  cardBorder: '#E4D6F1',
  pillTitleBg: '#C4E33C',
  pillTitleText: '#141708',
  sparkle: '#F9CD3F',
  sparkleLight: '#FEE780',
  label: '#43445C',
  value: '#26263E',
  colHead: '#8A8FA5',
  colText: '#303653',
  sep: '#ECECF0',
  ink: '#2A2F3C'
}

/* ---------------------------------------------------------------- Logo 预载

   webp 在 canvas 上直接 drawImage 即可。模块加载时就开始拉，用户点导出时
   基本早就绪；万一还没就绪，页眉照常画（Logo 位留白），下一次导出自然补上
   —— 不能为等一张图把整条导出链路改成异步。 */
let logoImg = null
if (typeof Image !== 'undefined') {
  logoImg = new Image()
  logoImg.src = logoUrl
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, rr)
    return
  }
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/* ---------------------------------------------------------------- 缩放 */

/**
 * 标版的缩放系数：图纸区（网格 + 四边坐标）有多宽，标版就放大多少倍。
 * 设计稿里图纸区 1085 px、标版元素按 1:1 排 —— 于是标版与页面永远保持设计稿的
 * 比例关系（页眉多高、双卡占多宽、字号多大），跟图纸有多少格无关。
 * 下限取 1：小图纸的标版不能缩到看不清字。
 */
export function exportScale(cellOrWidth) {
  const w = Number(cellOrWidth) > 0 ? Number(cellOrWidth) : 0
  return Math.max(1, w / D.chartW)
}

/** 导出图纸的坐标留白宽度（设计稿里坐标带约 4.6 格宽） */
export function exportRulerPx(cell) {
  const c = Number(cell) > 0 ? Number(cell) : 24
  return Math.max(18, Math.round(c * 4.6))
}

/** 页面左右留白 */
export function exportMargin(chartWidth) {
  return D.margin * exportScale(chartWidth)
}

/**
 * 导出页面的总宽（图纸区 + 两侧留白）。
 *
 * 标版不小于设计稿那一行（1080 px × 缩放系数）：小图纸时页面比图纸宽，
 * 双卡仍是设计稿的完整宽度 —— 不然卡片被挤窄、数值列放不下。
 * 预检尺寸与实际出图必须都用这个函数，否则两边会差一截。
 */
export function exportPageWidth(chartWidth) {
  const w = Number(chartWidth) > 0 ? Number(chartWidth) : 0
  const s = exportScale(w)
  const rowW = Math.max(w, D.rowW * s)
  return rowW + D.margin * s * 2
}

/** 坐标标注间隔（格）：格子越小间隔越大，免得数字挤成一团墨 */
export function exportCoordStep(cell) {
  const c = Number(cell) > 0 ? Number(cell) : 24
  if (c >= 16) return 5
  if (c >= 8) return 10
  if (c >= 4) return 20
  if (c >= 2) return 50
  return 100
}

/**
 * 导出图纸的线条与坐标配色（只影响导出，编辑器画布照旧）。
 * 设计稿的图纸区是浅蓝面板 + 极淡细格线 + 偏暖的每 10 格主格线，
 * 坐标没有灰底、直接落在面板上。
 */
export function exportChartTheme(cell) {
  const c = Number(cell) > 0 ? Number(cell) : 24
  return {
    grid: C.gridFine,
    bold: C.gridBold,
    board: C.boardLine,
    frame: C.gridBold,
    frameWidth: Math.max(1, Math.round(c * 0.09)),
    coordBg: null,
    coord: C.coord,
    coordSize: Math.max(8, Math.round(c * 1.55)),
    coordStep: exportCoordStep(c),
    coordFirst: true
  }
}

/* ---------------------------------------------------------------- 统计口径 */

function boardFacts(pattern) {
  const bs = normalizeBoardSize(pattern && pattern.boardSize, pattern && pattern.width, pattern && pattern.height)
  const def = boardDefOf(bs.x)
  const lay = boardLayout(pattern.width, pattern.height, bs)
  return {
    bs,
    cols: lay.cols,
    rows: lay.rows,
    count: lay.count,
    label: def ? def.label : `${bs.x} 格方板`
  }
}

/** 「图案信息」卡的六行（顺序与设计稿一致）；数据全部来自当前图纸的真实统计 */
function infoRowsOf(pattern, mats) {
  const b = boardFacts(pattern)
  const brandName = (getBrand(pattern.brandId) || {}).name || '—'
  const cells = pattern.width * pattern.height
  return [
    /* 设计稿的写法是「120 × 120（14,400）」——括号里只放数字，不带「格」字；
       「需要豆子总数」才带「颗」（设计稿是「8,650 颗」）。 */
    { label: '格子数量', value: `${pattern.width} × ${pattern.height}（${cells.toLocaleString(NUM)}）` },
    { label: '钉板型号', value: `${b.label}（${b.bs.x} × ${b.bs.y}）` },
    { label: '钉板数量', value: `${b.count} 块（${b.cols} × ${b.rows}）` },
    { label: '需要豆子总数', value: `${mats.totalBeads.toLocaleString(NUM)} 颗` },
    { label: '颜色数量', value: `${mats.colorCount} 色` },
    { label: '色卡品牌及型号', value: brandName }
  ]
}

/** 色号升序（数字段按数字比，A2 排在 A10 前面） */
function codeSort(a, b) {
  const pa = String(a.code || '').match(/^(\D*)(\d*)$/)
  const pb = String(b.code || '').match(/^(\D*)(\d*)$/)
  const la = pa ? pa[1] : String(a.code || '')
  const lb = pb ? pb[1] : String(b.code || '')
  if (la !== lb) return la < lb ? -1 : 1
  const na = pa && pa[2] ? parseInt(pa[2], 10) : 0
  const nb = pb && pb[2] ? parseInt(pb[2], 10) : 0
  if (na !== nb) return na - nb
  return String(a.code).localeCompare(String(b.code))
}

/* ---------------------------------------------------------------- 像素图标

   六个图标按设计稿 08_六个像素图标.png 的粗描边像素风绘制：
   小尺寸、深色像素描边、局部明亮配色 —— 不是彩色圆底、也不是线性通用 icon。
   每个图标是一张字符网格：K = 描边，其余字母是各自的填色。 */

const ICON_GRID = {
  /* ① 格子数量：浅蓝方块 + 白色分隔 + 四颗深蓝小格 */
  cells: {
    colors: { K: C.ink, B: '#BFE2F7', W: '#FFFFFF' },
    rows: [
      '..KKKKKKKK..',
      '.KBBBBBBBBK.',
      '.KBWWWWWWKB.',
      '.KBWWWWWWKB.',
      '.KBWWWWWWKB.',
      '.KBWWWWWWKB.',
      '.KBWWWWWWKB.',
      '.KBWWWWWWKB.',
      '.KBWWWWWWKB.',
      '.KBBBBBBBBK.',
      '..KKKKKKKK..'
    ],
    dots: [[3, 4, '#5FB4E8'], [7, 4, '#5FB4E8'], [3, 7, '#5FB4E8'], [7, 7, '#5FB4E8']]
  },
  /* ② 钉板型号：橙色钉板 + 竖向钉位 */
  board: {
    colors: { K: C.ink, L: '#FBD08A', D: '#E9822C' },
    rows: [
      '..KKKKKKKK..',
      '.KLLLLLLLLK.',
      '.KLDLLLDLLK.',
      '.KLDLLLDLLK.',
      '.KLDLLLDLLK.',
      '.KLDLLLDLLK.',
      '.KLDLLLDLLK.',
      '.KLLLLLLLLK.',
      '.KLLLLLLLLK.',
      '.KDDDDDDDDK.',
      '..KKKKKKKK..'
    ]
  },
  /* ③ 钉板数量：紫色叠层 */
  layers: {
    colors: { K: C.ink, L: '#B995E8', M: '#E2CDFA' },
    rows: [
      '..KKKKKKKK..',
      '.KMMMMMMMMK.',
      '.KLLLLLLLLK.',
      '.KKKKKKKKKK.',
      '..KKKKKKKK..',
      '.KMMMMMMMMK.',
      '.KLLLLLLLLK.',
      '.KKKKKKKKKK.',
      '..KKKKKKKK..',
      '.KMMMMMMMMK.',
      '.KLLLLLLLLK.',
      '.KKKKKKKKKK.'
    ]
  },
  /* ④ 需要豆子总数：薄荷色等距方块（一颗豆） */
  bead: {
    colors: { K: C.ink, L: '#B9F2C8', M: '#7FE0A8', D: '#43C489' },
    rows: [
      '...KKKKK...',
      '..KLLLLLK..',
      '.KLLLLLLLK.',
      'KLLLLLLLLLK',
      'KLLLKKLLLLK',
      'KMMMKKMMMMK',
      'KMMMKKMMMMK',
      '.KMMKKMMMK.',
      '..KMMKMMK..',
      '...KKKKK...',
      '...........'
    ]
  },
  /* ⑤ 颜色数量：调色盘 + 几个色点 */
  palette: {
    colors: { K: C.ink, W: '#FFFFFF' },
    rows: [
      '..KKKKKK....',
      '.KWWWWWWK...',
      'KWWWWWWWWK..',
      'KWWWWWWWWWK.',
      'KWWWWWWWWWK.',
      'KWWWWWWWWK..',
      '.KWWWWWWK...',
      '.KWWWWWK....',
      '..KWWWWK....',
      '...KWWK.....',
      '....KK......'
    ],
    dots: [[2, 2, '#F26D8D'], [4, 3, '#E23A20'], [6, 2, '#6BD4B6'], [8, 3, '#7AB2FE']]
  },
  /* ⑥ 色卡品牌及型号：黄色标签牌 */
  tag: {
    colors: { K: C.ink, Y: '#FCD97A' },
    rows: [
      '.....KK.....',
      '...KKYYKK...',
      '..KYYYYYYK..',
      '.KYYYYYYYYYK',
      'KYYYYYYYYYYK',
      'KYYKYYYYYYYK',
      'KYYYKYYYYYYK',
      '.KYYYKYYYYYK',
      '..KYYYKYYYK.',
      '...KYYKYYK..',
      '....KYYK....',
      '.....KK.....'
    ]
  }
}

const INFO_ICON_KEYS = ['cells', 'board', 'layers', 'bead', 'palette', 'tag']

/** 画一个像素图标：字符网格 → 实心方块，深色描边自带 */
function drawPixelIcon(ctx, key, x, y, size) {
  const icon = ICON_GRID[key]
  if (!icon) return
  const rows = icon.rows
  const h = rows.length
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const px = size / Math.max(w, h)
  ctx.save()
  ctx.fillStyle = icon.colors.K || C.ink
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.' || ch === ' ') continue
      ctx.fillStyle = icon.colors[ch] || C.ink
      ctx.fillRect(x + c * px, y + r * px, px, px)
    }
  })
  ;(icon.dots || []).forEach(([c, r, color]) => {
    ctx.fillStyle = color
    ctx.fillRect(x + c * px, y + r * px, px, px)
  })
  ctx.restore()
}

/* ---------------------------------------------------------------- 版面计算 */

/**
 * 底部颜色清单的列数：设计稿是三列（每列十行）。
 *
 * 列数按「每列最多 11 行」往上加 —— 设计稿那种 28 色是三列十行，卡片高度刚好等于
 * 设计稿的 301 px；颜色多了如果还锁死三列，卡片会一路长高，底部双卡在整页里的占比
 * 就远超设计稿（实测 45 色三列 → 卡片 427 px，占整页 26%，设计稿是 21.5%）。
 * 改成加列（45 色 → 五列九行 → 卡片回到 301 px）比缩字号好：字永远是设计稿那个大小。
 *
 * 上限五列：再窄就放不下「色块 + 色号 + 数量」三样（最窄的五列组宽 106 px，
 * 放六列只剩 87 px，4 位色号和 5 位数量会撞在一起）。颜色再多时让卡片长高 ——
 * 真到那一步（>55 色）应该另开材料清单页，不该把这一页压扁。
 */
function colorCols(n) {
  if (!n) return 3
  return Math.max(3, Math.min(5, Math.ceil(n / 11)))
}

/**
 * 整套标版的版面参数。templateExtraHeight 与 composeExportTemplate 必须用同一套
 * 计算，否则「预检说的尺寸」和「实际文件尺寸」会对不上。
 */
function layoutOf(pattern, chartWidth, { includeLegend = true, includeStats = true } = {}) {
  const s = exportScale(chartWidth)
  const mats = materialList(pattern, null)
  const infoRows = includeStats ? infoRowsOf(pattern, mats) : []
  const colorRows = includeLegend ? [...mats.rows].sort(codeSort) : []
  const cols = colorCols(colorRows.length)
  const colorRowsPerCol = colorRows.length ? Math.ceil(colorRows.length / cols) : 0
  const cd = D.card
  /* 卡片高度必须跟着缩放系数走：绘制时每一项都乘了 s，
     这里不乘的话 —— 页面比图纸宽的那一档（s > 1）会把清单卡的内容裁掉。 */
  const infoH = includeStats
    ? (cd.padTop + cd.pillH + 7 + infoRows.length * cd.rowH + cd.padBottom) * s
    : 0
  const colorH = includeLegend
    ? (cd.padTop + cd.pillH + 7 + cd.colHeadH + colorRowsPerCol * cd.colRowH + cd.padBottom) * s
    : 0
  const cardsH = Math.max(infoH, colorH)
  const margin = D.margin * s
  /* 页面宽度：图纸区 + 两侧留白；但标版不能小于设计稿那一行（1080 × s），
     小图纸时页面比图纸宽，双卡仍是设计稿的完整宽度 —— 不然卡片会被挤窄、
     数值列放不下。 */
  const rowW = Math.max(chartWidth, D.rowW * s)
  return {
    s, mats, infoRows, colorRows, cols, colorRowsPerCol,
    headerH: D.headerH * s,
    margin,
    rowW,
    pageW: exportPageWidth(chartWidth),
    cardsH,
    cardGap: D.cardGap * s,
    cardColGap: D.cardColGap * s,
    bottomPad: D.bottomPad * s
  }
}

/**
 * 图纸面板与底部双卡之间的留白（设计 15 px × 缩放系数）。
 *
 * 单独导出成函数：自检脚本要按同一口径反推卡片高度，
 * 两边各写一个数字就会再次对不上。
 */
export function exportCardGap(scale = 1) {
  return D.cardGap * scale
}

/** 底部左右两张卡之间的留白（与 exportCardGap 同口径） */
export function exportCardColGap(scale = 1) {
  return D.cardColGap * scale
}

/**
 * 标版在图纸主体之外增加的高度（页眉 + 底部双卡 + 页面留白）。
 * dpiExportPlan('full') 用它算总尺寸并决定要不要降 cell；
 * composeExportTemplate 用同一套函数排版，两处永不失配。
 */
export function templateExtraHeight(pattern, width, { includeLegend = true, includeStats = true } = {}) {
  const L = layoutOf(pattern, width, { includeLegend, includeStats })
  let h = L.headerH
  if (L.cardsH) h += L.cardGap + L.cardsH
  return h + L.bottomPad
}

/* ---------------------------------------------------------------- 页眉 */

function drawLogo(ctx, x, y, h) {
  if (!logoImg || !logoImg.complete || !logoImg.naturalWidth) return 0
  const k = h / logoImg.naturalHeight
  const w = logoImg.naturalWidth * k
  ctx.drawImage(logoImg, x, y, w, h)
  return w
}

/** 浅绿胶囊：左端一个深色放大镜，后面是黑体网址 */
function drawUrlCapsule(ctx, x, y, w, h, s) {
  const r = h / 2
  ctx.save()
  ctx.fillStyle = C.urlPill
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fill()

  /* 左侧深色放大镜（描边风格，设计稿里没有圆底） */
  const d = D.url.iconD * s
  const cx = x + D.url.padL * s
  const cy = y + h / 2
  ctx.strokeStyle = C.urlIcon
  ctx.lineWidth = Math.max(1.4, d * 0.13)
  ctx.lineCap = 'round'
  const gR = d * 0.28
  const gx = cx + d * 0.38
  const gy = cy - d * 0.08
  ctx.beginPath()
  ctx.arc(gx, gy, gR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(gx + gR * 0.72, gy + gR * 0.72)
  ctx.lineTo(gx + gR * 1.6, gy + gR * 1.6)
  ctx.stroke()
  ctx.restore()
}

/**
 * 页眉：真 Logo → 浅绿网址胶囊 → 右侧 Slogan 与四圆点。
 * 胶囊按设计稿落在固定位置（Logo 右侧、Slogan 左侧）；网址文字按自然宽度排，
 * 胶囊宽度随文字自适应 —— 不再横向压字。
 */
export function drawTemplateHeader(ctx, { x = 0, y = 0, width, height = null, scale = 1 } = {}) {
  const s = scale
  const H = height || D.headerH * s
  ctx.save()
  ctx.textBaseline = 'middle'

  /* 左：Logo（等比缩放，不拉伸） */
  const logoX = x + (D.logo.x - D.margin) * s
  const logoY = y + (D.logo.y - 0) * s
  const logoH = D.logo.h * s
  const logoW = drawLogo(ctx, logoX, logoY, logoH)

  /* 胶囊：设计稿位置（Logo 右侧留白处），宽度按网址文字自然宽度自适应 */
  const capY = y + D.capsule.y * s
  const capH = D.capsule.h * s
  const urlSize = D.url.size * s
  ctx.font = `800 ${urlSize}px ${FONT}`
  const urlW = ctx.measureText(SITE_URL_TEXT).width
  const capW = D.url.padL * s + D.url.iconD * s + D.url.iconGap * s + urlW + D.url.padR * s
  /* Logo 意外偏宽时往右让开，绝不压住 Logo */
  const pillX = Math.max(x + (D.capsule.x - D.margin) * s, logoX + logoW + 13 * s)
  drawUrlCapsule(ctx, pillX, capY, capW, capH, s)

  /* 网址文字：深色黑体，自然宽度 */
  ctx.fillStyle = C.urlText
  ctx.font = `800 ${urlSize}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(SITE_URL_TEXT, pillX + D.url.padL * s + D.url.iconD * s + D.url.iconGap * s, capY + capH / 2 + 1)

  /* 右：Slogan（深灰蓝） + 四圆点 */
  const blockSize = D.blocks.size * s
  const blockGap = D.blocks.gap * s
  const blocksSpan = D.blocks.size * 4 + D.blocks.gap * 3
  const blocksRight = x + width - (D.pageW - (D.blocks.x + blocksSpan) - D.margin) * s
  const blockTop = y + D.blocks.y * s
  const blocksLeft = blocksRight - blocksSpan * s
  C.blocks.forEach((color, i) => {
    const bx = blocksLeft + i * (blockSize + blockGap)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(bx + blockSize / 2, blockTop + blockSize / 2, blockSize / 2, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.fillStyle = C.slogan
  ctx.font = `700 ${D.slogan.size * s}px ${FONT}`
  ctx.textAlign = 'right'
  /* Slogan 右沿与圆点左沿留 36 px（设计稿：Slogan 到 938，圆点从 974 起） */
  ctx.fillText(SLOGAN_TEXT, blocksLeft - D.slogan.gap * s, y + D.blocks.y * s + blockSize / 2)
  ctx.textAlign = 'left'
  ctx.restore()
  return H
}

/* ---------------------------------------------------------------- 底部双卡 */

/** 四角星形（V4 设计稿里「图案信息」胶囊右上角的黄色装饰） */
function drawSparkle(ctx, cx, cy, r, s, color) {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, cy - r * s)
  ctx.quadraticCurveTo(cx, cy, cx + r * s, cy)
  ctx.quadraticCurveTo(cx, cy, cx, cy + r * s)
  ctx.quadraticCurveTo(cx, cy, cx - r * s, cy)
  ctx.quadraticCurveTo(cx, cy, cx, cy - r * s)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawCardTitle(ctx, text, x, y, s) {
  const h = D.card.pillH * s
  const font = `800 ${D.card.pillFont * s}px ${FONT}`
  ctx.save()
  ctx.font = font
  const tw = ctx.measureText(text).width
  const w = tw + D.card.pillPadX * 2 * s
  ctx.fillStyle = C.pillTitleBg
  roundRectPath(ctx, x, y, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = C.pillTitleText
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, x + w / 2, y + h / 2 + 1)
  ctx.textAlign = 'left'
  ctx.restore()
  return w
}

/** 左卡「图案信息」：六个像素图标 + 标签 / 数值两列
 *  列位置按卡片宽度的比例摆（设计稿 468 px 宽时刚好落在 36 / 82 / 227 px），
 *  卡片被拉宽或收窄时数值列都不会被挤出卡外。 */
function drawInfoCard(ctx, rows, x, y, w, h, s) {
  const cd = D.card
  ctx.save()
  ctx.fillStyle = C.cardBg
  roundRectPath(ctx, x, y, w, h, cd.radius * s)
  ctx.fill()
  ctx.strokeStyle = C.cardBorder
  ctx.lineWidth = Math.max(1, 1.5 * s)
  ctx.stroke()

  const pillX = x + w * cd.pillXRatio
  const pillY = y + cd.padTop * s
  const pillW = drawCardTitle(ctx, '图案信息', pillX, pillY, s)
  /* 黄色星形装饰：胶囊右上角，一对（设计稿里那一小簇「亮点」） */
  drawSparkle(ctx, pillX + pillW - 2 * s, pillY - 9 * s, 8, s, C.sparkle)
  drawSparkle(ctx, pillX + pillW + 9 * s, pillY - 2 * s, 4.5, s, C.sparkleLight)

  const iconSize = cd.icon * s
  const labelX = x + w * (cd.labelX / 468)
  const valueX = x + w * (cd.valueX / 468)
  const firstRowY = y + (cd.padTop + cd.pillH + 7) * s
  /* 分隔线：每行一条（设计稿里最后一行下面也有），从标签左沿画到卡片右沿 */
  const line = (ly) => {
    ctx.strokeStyle = C.sep
    ctx.lineWidth = Math.max(1, 1 * s)
    ctx.beginPath()
    ctx.moveTo(labelX, Math.round(ly) + 0.5)
    ctx.lineTo(x + w - cd.padX * s, Math.round(ly) + 0.5)
    ctx.stroke()
  }
  rows.forEach((r, i) => {
    const ry = firstRowY + i * cd.rowH * s
    const midY = ry + (cd.rowH * s) / 2
    if (i > 0) line(ry)
    drawPixelIcon(ctx, INFO_ICON_KEYS[i] || 'cells', x + w * (cd.iconX / 468), midY - iconSize / 2, iconSize)
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${cd.labelSize * s}px ${FONT}`
    ctx.fillStyle = C.label
    ctx.fillText(r.label, labelX, midY)
    ctx.font = `700 ${cd.valueSize * s}px ${FONT}`
    ctx.fillStyle = C.value
    ctx.fillText(r.value, valueX, midY)
  })
  if (rows.length) line(firstRowY + rows.length * cd.rowH * s)
  ctx.restore()
}

/** 右卡「颜色清单」：按色号排序，多列分组 */
function drawColorsCard(ctx, rows, cols, x, y, w, h, s) {
  const cd = D.card
  ctx.save()
  ctx.fillStyle = C.cardBg
  roundRectPath(ctx, x, y, w, h, cd.radius * s)
  ctx.fill()
  ctx.strokeStyle = C.cardBorder
  ctx.lineWidth = Math.max(1, 1.5 * s)
  ctx.stroke()

  const pillX = x + w * cd.pillXRatio
  const pillY = y + cd.padTop * s
  drawCardTitle(ctx, '颜色清单', pillX, pillY, s)

  /* 右上角备注 */
  ctx.font = `600 ${cd.noteSize * s}px ${FONT}`
  ctx.fillStyle = C.colHead
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('（按色号排序）', x + w - cd.padX * s, pillY + (cd.pillH * s) / 2)
  ctx.textAlign = 'left'

  const innerX = x + cd.padX * s
  const innerW = w - cd.padX * 2 * s
  const groupW = innerW / cols
  const groupTop = y + (cd.padTop + cd.pillH + 7) * s
  const headH = cd.colHeadH * s
  const rowH = cd.colRowH * s

  for (let c = 0; c < cols; c++) {
    const gx = innerX + c * groupW
    const gw = groupW - 8 * s
    /* 列内位置按设计稿的比例摆（设计稿每列约 189 px：
       色块左沿 0、色号 +30、数量 +108 —— 表头「数量」与数值同一条左沿）。
       列被压窄时（颜色多、列数变多）换紧凑排布：色块贴左、色号跟在后面、数量右对齐；
       紧凑排布的间距按 4 px 走 —— 五列时组宽只剩 103 px，
       4 位色号（H190）+ 5 位数量（10,816）也要塞得下不撞字。 */
    const wide = gw >= 140 * s
    const sw = cd.swatch * s
    const swX = wide ? gx + gw * 0.135 : gx + 4 * s
    const codeX = wide ? swX + gw * 0.160 : swX + sw + 4 * s
    const countX = wide ? swX + gw * 0.591 : gx + gw - 4 * s
    /* 分组白底 */
    ctx.fillStyle = '#FFFFFF'
    roundRectPath(ctx, gx, groupTop, gw, h - (groupTop - y) - cd.padBottom * s, 8 * s)
    ctx.fill()

    /* 表头：色号 / 数量 */
    ctx.font = `700 ${cd.colHeadSize * s}px ${FONT}`
    ctx.fillStyle = C.colHead
    ctx.textBaseline = 'middle'
    const headMid = groupTop + headH / 2
    ctx.fillText('色号', codeX, headMid)
    if (!wide) { ctx.textAlign = 'right'; ctx.fillText('数量', countX, headMid); ctx.textAlign = 'left' }
    else ctx.fillText('数量', countX, headMid)
    ctx.strokeStyle = C.sep
    ctx.lineWidth = Math.max(1, 1 * s)
    ctx.beginPath()
    ctx.moveTo(swX - 6 * s, Math.round(groupTop + headH) + 0.5)
    ctx.lineTo(gx + gw - 6 * s, Math.round(groupTop + headH) + 0.5)
    ctx.stroke()

    const perCol = Math.ceil(rows.length / cols)
    const list = rows.slice(c * perCol, (c + 1) * perCol)
    list.forEach((r, i) => {
      const ry = groupTop + headH + i * rowH
      const midY = ry + rowH / 2
      ctx.fillStyle = r.hex
      roundRectPath(ctx, swX, midY - sw / 2, sw, sw, 3 * s)
      ctx.fill()
      ctx.strokeStyle = 'rgba(42,47,60,.18)'
      ctx.lineWidth = Math.max(1, 1 * s)
      ctx.stroke()
      ctx.font = `700 ${cd.colTextSize * s}px ${FONT}`
      ctx.fillStyle = C.colText
      ctx.textBaseline = 'middle'
      ctx.fillText(r.code, codeX, midY)
      if (!wide) { ctx.textAlign = 'right'; ctx.fillText(r.count.toLocaleString(NUM), countX, midY); ctx.textAlign = 'left' }
      else ctx.fillText(r.count.toLocaleString(NUM), countX, midY)
      if (i > 0) {
        ctx.strokeStyle = C.sep
        ctx.lineWidth = Math.max(1, 0.6 * s)
        ctx.beginPath()
        ctx.moveTo(swX - 6 * s, Math.round(ry) + 0.5)
        ctx.lineTo(gx + gw - 6 * s, Math.round(ry) + 0.5)
        ctx.stroke()
      }
    })
  }
  ctx.restore()
}

/* ---------------------------------------------------------------- 组装 */

/**
 * 把「图纸主体」与标版（页眉 / 底部双卡）拼到一张画布上。
 *
 * chartCanvas 是 buildPatternImageCanvas 里 drawChart 画好的图纸主体
 * （透明底，含四边坐标），尺寸必然等于 plan.geometry。
 */
export function composeExportTemplate(pattern, chartCanvas, plan, {
  includeLegend = true,
  includeStats = true
} = {}) {
  const g = plan.geometry
  const L = layoutOf(pattern, g.width, { includeLegend, includeStats })
  const s = L.s
  const extraH = templateExtraHeight(pattern, g.width, { includeLegend, includeStats })
  const out = document.createElement('canvas')
  out.width = Math.ceil(L.pageW)
  out.height = Math.ceil(g.height + extraH)
  const ctx = out.getContext('2d')

  /* 白纸 */
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, out.width, out.height)

  /* 页眉 */
  drawTemplateHeader(ctx, { x: L.margin, y: 0, width: L.pageW - L.margin * 2, scale: s })

  /* 图纸面板：浅蓝底 + 极淡粉描边（坐标在面板内的四边留白里） */
  const panelY = L.headerH
  const panelX = Math.round((L.pageW - g.width) / 2)
  ctx.save()
  ctx.fillStyle = C.panelFill
  roundRectPath(ctx, panelX, panelY, g.width, g.height, D.chart.radius * s)
  ctx.fill()
  ctx.strokeStyle = C.panelBorder
  ctx.lineWidth = Math.max(1, 1.5 * s)
  ctx.stroke()
  ctx.restore()
  ctx.drawImage(chartCanvas, panelX, Math.round(panelY))

  /* 底部双卡 */
  if (L.cardsH) {
    const y = panelY + g.height + L.cardGap
    const infoW = L.rowW * D.infoRatio
    const colorsW = L.rowW - infoW - L.cardColGap
    if (includeStats) drawInfoCard(ctx, L.infoRows, L.margin, y, infoW, L.cardsH, s)
    if (includeLegend) {
      drawColorsCard(ctx, L.colorRows, L.cols, L.margin + infoW + L.cardColGap, y, colorsW, L.cardsH, s)
    }
  }
  return out
}

/* ---------------------------------------------------------------- 供 PDF 封面复用 */

/** 页眉高度（与 composeExportTemplate 用同一套口径） */
export function templateHeaderHeight(scale = 1) {
  return D.headerH * scale
}

/** 供 PDF 封面用的 Slogan 文本 */
export { SLOGAN_TEXT as TEMPLATE_SLOGAN }
