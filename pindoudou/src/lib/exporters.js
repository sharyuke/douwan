/* =========================================================================
   导出（PRD §18 / §19 / §49）
   - PNG 图纸：带标尺、网格、色号
   - SVG 矢量：可无损缩放
   - 材料清单 CSV / 采购纯文本
   - Pattern JSON：结构化网格数据（PRD §41）
   - 分板 PDF：浏览器打印为 PDF，每块板一页 + 1:1 打印尺寸 + 材料清单页
   ========================================================================= */

import { drawChart, drawBoard, drawPixels, chartGeometry, EMPTY_FILL } from './render.js'
import { materialList, boardMaterials, boardBeadCounts, boardLayout, toSVG, estimateSvgBytes, toMaterialsCSV, toShoppingText } from './pattern.js'
/* 分板规格（52 / 78 / 104 / 120 钉画线板，整张画布一种规格）与豆径（2.6mm 小豆 / 5mm 中号豆）的唯一口径 */
import { normalizeBoardSize, beadOf, boardOf as boardDefOf } from './boardSpec.js'
/* 统一导出标版（页眉 Logo + 浅绿网址胶囊 + Slogan 与四圆点 / 图案信息 / 颜色清单）：
   新手版第 ③ 步与专业工作台「图纸交付」的整图导出共用同一版式，见 exportTemplate.js */
import {
  composeExportTemplate, templateExtraHeight,
  drawTemplateHeader, SITE_URL_TEXT, SLOGAN_TEXT,
  exportRulerPx, exportPageWidth, exportChartTheme
} from './exportTemplate.js'
/* Logo 资源：同 exportTemplate.js，用 new URL(..., import.meta.url) 取 ——
   `import logo from '...webp'` 会让 Node 直接跑的自检脚本崩（不认 .webp 后缀）。
   包一层 try 是因为自检脚本会把 globalThis.URL 换成只剩 createObjectURL 的桩。 */
const logoTemplateUrl = (() => {
  try {
    return new URL('../assets/logo-douwan.webp', import.meta.url).href
  } catch (e) {
    return ''
  }
})()
/* 下面几个小工具是「图纸口径」的唯一入口：分板、成品厘米、1:1 打印毫米数全部走它们，
   老图纸（没有 boardSize / beadKey 字段）自动退到 29 格 + 5mm 中号豆，行为与以前一致。 */
const boardOf = p => normalizeBoardSize(p && p.boardSize, p && p.width, p && p.height)
/* 导出时允许临时换一种板规格（分板交付里用户可选 52 / 78 / 104 / 120 或自定义）。
   没传就沿用图纸自己的规格 —— 老图纸的行为不变。 */
const boardOfExport = (p, boardSize) => (boardSize
  ? normalizeBoardSize(boardSize, p && p.width, p && p.height)
  : boardOf(p))
const cmPerBeadOf = p => (p && p.cmPerBead) || 0.5
const beadOfPattern = p => beadOf(p && p.beadKey)
const boardLabelOf = (p, boardSize) => {
  const b = boardOfExport(p, boardSize)
  /* 老存档的方板只写「老规格方板」：站上只有 52 / 78 / 104 / 120 钉画线板 */
  const def = boardDefOf(b.x)
  return def && def.legacy ? def.label : `${b.x} × ${b.y} 插钉`
}
import { getBrand } from './palettes.js'

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1200)
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

function safeName(name) {
  return String(name || 'douzao').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)
}

/* ---------------------------------------------------------------- 导出规格

   下面这几个数是三条互相独立的墙，不是随手取的整数：
   1) 浏览器 canvas 单边 16384 px（render.js:290 的 MAX_CANVAS_SIDE，超了整块画布会静默变空白），
      但导出 PNG 还要过一遍 toBlob 编码，边长再往上加只是白烧内存；
   2) RGBA 每像素 4 字节：1600 万像素 = 64 MB 后备缓冲，编码时还有同量级的临时副本；
   3) 「图纸」是拿去照着拼、发出去看的，4096 px 早就够用，再大只是让手机相册打不开。
   116×116 格在 24 px/格 下是 2870×2870（8.24 Mpx），两条上限都还有余量 ——
   所以小图纸永远落在 24 px/格 这一档，行为和以前一模一样，降档只发生在大画布上。

   画布单边上限提到 1000 格之后这张网依然兜得住，但**降档落在 3 px/格，不是 4**：
   1000 格 × 4 px = 4000，再加上 chartGeometry 两边各 13 px 的标尺就是 4026×4026 = 16.21 Mpx，
   比 1600 万像素的墙多出 21 万像素；pngExportPlan 从 24 逐档减 1 往下试，第一个过得去的是
   3 px/格（3026×3026 = 9.16 Mpx）。标尺不能为了凑出「4000×4000」抹掉 —— 抹了图纸就没有行列坐标，
   用户得靠数格子才知道自己拼到第几列。
*/
export const PNG_MAX_SIDE = 4096
export const PNG_MAX_PIXELS = 16000000

/**
 * SVG 单文件的两道线。
 * 实测（node 直接跑 toSVG 量出来的字符数）：450×450 格不带色号约 10.7 MB，带色号约 40.2 MB。
 * 字符串在内存里是 UTF-16（体积再翻一倍），落盘时 Blob 还要复制一份，
 * 所以「能生成」和「该生成」是两件事：估算超过 SVG_SINGLE_BYTES 就先考虑丢色号，
 * 丢色号还是超，就拒绝并说明原因 —— 绝不把 40 MB 的字符串交给浏览器。
 * SVG_MAX_BYTES 是用户侧的硬上限（PRD 里定的「不要超过约 20MB」），
 * 估算毕竟只是估算，真建出来之后还要再量一次，超了就宁可丢掉不给。
 */
export const SVG_SINGLE_BYTES = 16 * 1024 * 1024
export const SVG_MAX_BYTES = 20 * 1024 * 1024

/**
 * 分板 PDF 的页数上限 = 16×16 块底板 = 旧的权益上限 464×464 格（ceil(464/29) = 16，16² = 256）。
 *
 * 这个 256 不是「纸张贵」也不是产品口径，是**内存**算出来的硬墙：
 * 每页要内联一张板图 PNG，256 页的解码后位图（RGBA）合计约 157 MB（算式见下面 PRINT_CELL_TIERS 的注释），
 * 再多浏览器在打印预览阶段就会崩。所以画布上限放开到 1000 格后，这条链路**必然拒绝**：
 *   1000×1000 → ceil(1000/29) = 35 → 35×35 = 1225 块板 = 1225 页，
 *   按 12 px/格算每页板图 388×388 像素 = 150,544 px × 4 B ≈ 0.57 MB（上界口径 0.6 MB），
 *   1225 页就是 ≈ 700~750 MB 解码位图（再加上 HTML 里那 1225 段 base64 文本），比 256 页多 4.8 倍。
 * 以后真要支持 1225 页，不能只是把 256 改大，必须换成**流式**方案：一页一页地
 * drawBoard → 编码 → 立刻写进目标（直接生成 PDF 字节流 / 分块写入），峰值内存只保留当前这一页；
 * 代价是 1225 次 drawBoard + PNG 编码要跑几十秒到几分钟，而且 PDF 文件本身仍有几十 MB。
 * 在那之前，宁可让用户看到「1225 页 > 256 页」和替代路径，也不要给他一个会把标签页打死的按钮。
 */
export const PRINT_MAX_BOARDS = 256

/**
 * 高清导出的 DPI 档位（需求：默认 300，可选 150 预览与 600）。
 *
 * DPI 不是写进文件元数据就算数：像素必须按「物理打印尺寸 × DPI」算出来再重新渲染。
 * 一格 = 一颗豆 = bead.mm 毫米，所以每格像素 = round(bead.mm / 25.4 × dpi)。
 * 5mm 豆：150 → 30 px/格，300 → 59 px/格，600 → 118 px/格。
 * 大画布 / 大板会撞上浏览器单张画布的像素墙，dpiExportPlan 会算出实际可达的 DPI
 * 并把「请求多少、实际多少、为什么」写进 message —— 不静默降质。
 */
export const DPI_OPTIONS = [150, 300, 600]
const MM_PER_INCH = 25.4
/** 分板 PDF 所有板图解码后的总像素预算：4000 万 px ≈ 160 MB RGBA（与旧的 256 页标定同量级） */
const PRINT_TOTAL_PIXELS = 40000000

/** drawBoard 的几何：格子区 + 四边标尺（R = max(14, round(cell × 1.7))） */
function boardImagePx(board, cell, ruler = true) {
  const R = ruler ? Math.max(14, Math.round(cell * 1.7)) : 0
  return { w: board.w * cell + R * 2, h: board.h * cell + R * 2 }
}

function fitsCanvas(size) {
  // chartGeometry 用 width/height，drawBoard 的估算用 w/h，两种形状都接受
  const w = size.w != null ? size.w : size.width
  const h = size.h != null ? size.h : size.height
  return w <= PNG_MAX_SIDE && h <= PNG_MAX_SIDE && w * h <= PNG_MAX_PIXELS
}

function dpiOf(mm, cell) {
  return Math.round((cell * MM_PER_INCH / mm) * 10) / 10
}

/* ------------------------------------------------------------------ 离屏绘制 */

/**
 * 导出专用的「1:1 画布」。
 *
 * prepareCanvas 按**屏幕像素预算**（宽屏 24 Mpx / 窄屏 8 Mpx）决定后备缓冲倍率，
 * 那是给编辑器那块画布省内存的设计；文件导出跟着它走有两个麻烦：
 *   · 同一张图纸在 1x 屏和 2x 屏导出的像素尺寸不一样，没法跟用户交代「你拿到的是 3026×3026」；
 *   · 手机窄屏的预算是 8 Mpx，一张 4096 px 的图纸会被退到 0.5 倍边长，而
 *     round(cssW*0.5)/0.5 在 cssW 是奇数时会得到 cssW+1 —— 反推回逻辑尺寸差 1 px，
 *     导出侧那道尺寸对账会偶发失败（不是画错，是直接拒绝导出）。
 * 所以这里给宿主挂 `__dpr: 1`：render.js 的 prepareCanvas 见到它就跳过屏幕预算，
 * 缓冲尺寸严格等于逻辑尺寸 —— 导出就是 1:1，与设备 DPR、屏幕宽窄完全无关。
 * 导出自己的内存上限由本文件的 PNG_MAX_SIDE / PNG_MAX_PIXELS 负责，两套预算互不污染。
 *
 * 以前这里走的是「拿一张 100×100 的探针反推倍率，再把 host 的尺寸除以它」：
 * 探针面积小、预算算出来是 2 倍，真实导出画布是 1 倍，反推出来的倍率是错的
 * （2870 的逻辑宽度被写成 1435），现在这条弯路整个删掉了。
 */
function createExportCanvas() {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  // 只抵消 DPR 缩放这一件事，其余绘制状态照常
  ctx.setTransform = () => {}
  const host = {
    style: {},
    // render.js 的 1:1 旁路（见 prepareCanvas 的 forcedDpr）
    __dpr: 1,
    // 不再除以任何倍率：__dpr=1 之后缓冲尺寸就等于逻辑尺寸，再除一次会砍掉一半
    get width() { return canvas.width },
    set width(v) { canvas.width = Math.max(1, Math.round(v)) },
    get height() { return canvas.height },
    set height(v) { canvas.height = Math.max(1, Math.round(v)) },
    getContext: () => ctx
  }
  return { canvas, ctx, host }
}

/**
 * PNG 的 cell 与尺寸计划：默认沿用 24 px/格，只有撞上边长/总像素上限才逐档往下降。
 * 用 chartGeometry 算尺寸而不是自己乘一遍：标尺宽度也跟着 cell 变（cell=4 时两边各 13 px、
 * cell=24 时各 43 px），自己按「格数 × cell」算迟早对不上，并且会算出 4000×4000 这种
 * 事实上超限的假尺寸。
 */
export function pngExportPlan(pattern, wantedCell = 24, { ruler = true, includeLegend = false, includeStats = false } = {}) {
  for (let cell = wantedCell; cell >= 1; cell--) {
    const geometry = chartGeometry(pattern, { cell, ruler, rulerPx: exportRulerPx(cell) })
    /* 标版页面 = 图纸 + 页眉 + 底部双卡，比图纸主体高不少：
       只按图纸主体算上限的话，成品会超出单边 / 总像素上限，toBlob 直接返回 null。
       所以这里连标版一起算，必要时继续降 cell。 */
    const extraH = (includeLegend || includeStats)
      ? templateExtraHeight(pattern, geometry.width, { includeLegend, includeStats })
      : 0
    const pageW = (includeLegend || includeStats)
      ? exportPageWidth(geometry.width)
      : geometry.width
    const pageH = geometry.height + extraH
    if (pageW <= PNG_MAX_SIDE && pageH <= PNG_MAX_SIDE && pageW * pageH <= PNG_MAX_PIXELS) {
      return { cell, geometry, reduced: cell < wantedCell, extraH, pageW, pageH }
    }
  }
  return { cell: 1, geometry: chartGeometry(pattern, { cell: 1, ruler, rulerPx: exportRulerPx(1) }), reduced: true }
}

/**
 * 导出结果要如实说明「你拿到的是什么尺寸」；降了规格更要说清降在哪、下一步该用哪个功能。
 *
 * 1000×1000 是这条链路的极端例子：cell=3、3026×3026（917 万像素），一格只有 3 px、
 * 一颗豆在图上就是 3×3 像素 —— 这时候「图纸 PNG」的定位已经变成「看整体构图 + 发给别人看」，
 * 想核对单颗豆的颜色/色号必须走分板视图或 PDF 分板。三句话缺一句用户就会拿着 3 px/格 的图
 * 去找色号，然后觉得是导出坏了。
 */
function imageMessage(pattern, plan, opts, out) {
  const g = plan.geometry
  const label = opts.format === 'jpg' ? 'JPG' : 'PNG'
  const bits = [
    `${label} 图纸 ${pattern.width}×${pattern.height} 格，已按 ${plan.cell} px/格导出 ${out.width}×${out.height} 像素`
  ]
  const extras = []
  if (opts.ruler) extras.push('行列坐标')
  if (opts.grid) extras.push('网格')
  if (opts.codes) extras.push('每格色号')
  if (opts.includeLegend || opts.includeStats) extras.push('统一标版（豆玩 Logo + 浅绿网址胶囊页眉 / 图案信息 / 颜色清单）')
  if (extras.length) bits.push('包含 ' + extras.join(' / '))
  if (opts.format === 'jpg' && opts.background === 'transparent') bits.push('JPG 不支持透明，已自动铺白底')
  if ((opts.includeLegend || opts.includeStats) && opts.background === 'transparent') {
    bits.push('标版页面固定白底（页眉 / 材料区 / 页脚在白纸上）')
  }
  if (opts.format === 'png' && opts.background === 'transparent' && !opts.includeLegend && !opts.includeStats) {
    bits.push('空白格保持透明（不放豆的位置不铺底色）')
  }
  if (plan.reduced) {
    bits.push(`大画布受 ${PNG_MAX_SIDE} px 边长 / ${PNG_MAX_PIXELS / 1e4} 万像素上限限制，每格像素已自动降档（原来想要 24 px/格，现在 ${plan.cell} px/格）`)
    if (opts.codes && plan.cell < 11) bits.push('这个尺度画不下色号')
    bits.push('1:1 打印请用 PDF 分板')
  }
  if (plan.cell <= 4) bits.push('这个尺度一颗豆只有几个像素，想看单颗豆请用分板视图（或 PDF 分板的单板页）')
  return bits.join('；')
}

/**
 * 图案底图（1 格 = 若干像素，不带标尺）。
 * 返回实际缓冲尺寸：drawPixels 自己按 maxSize 缩格子，所以缓冲不会随画布变大而无上限增长。
 */
function renderToCanvas(pattern, maxSize, opts) {
  const c = document.createElement('canvas')
  const info = drawPixels(c, pattern, { maxSize, ...opts })
  return { canvas: c, cell: info ? info.cell : 1, width: c.width, height: c.height }
}

/**
 * 图纸图片导出（PNG / JPG 共用一条链路）。
 *
 * 需求 §4.7：网格、行列坐标、每格色号、颜色图例、材料统计、背景都可开关；
 * PNG 可以保留透明背景，JPG 必须铺白底（否则透明区域会变黑）。
 * 图例 / 统计会拼在图纸下方，避免长表把图纸主体压小。
 */
export function buildPatternImageCanvas(pattern, {
  format = 'png',
  cell = 24,
  ruler = true,
  grid = true,
  codes = true,
  /* 统一导出标版（图纸标版 V3）：页眉 Logo + 浅绿网址胶囊 + Slogan 与四圆点、
     图案信息卡、颜色清单卡。
     新手版 / 专业版 / 作品页 / 素材页的整图导出默认全走这一套版式；
     要「纯图纸主体」的调用方（对照图、纯图案等另有链路）显式传 false。 */
  includeLegend = true,
  includeStats = true,
  background = '#ffffff'
} = {}) {
  const opts = { format, ruler, grid, codes, includeLegend, includeStats, background }
  const plan = pngExportPlan(pattern, cell, { ruler, includeLegend, includeStats })
  const g = plan.geometry
  const { canvas, host } = createExportCanvas()
  /* 标版页面固定白底（页眉 / 底部双卡都在白纸上）；
     图纸主体本身画成透明底 —— 浅蓝面板与坐标留白由标版那层铺，
     这样透明格（不放豆的位置）露出的就是面板色，跟设计稿一致。 */
  const templated = includeLegend || includeStats
  const bg = templated
    ? 'rgba(0,0,0,0)'
    : (format === 'jpg' ? '#ffffff' : (background === 'transparent' ? 'rgba(0,0,0,0)' : background))
  // 不把几何对象直传进去：画什么由 opts 里的 codes/grid 决定，让 drawChart 自己算几何，
  // 两边用的是同一个 chartGeometry，算出来必然一致（传 geo 反而要连 opts 一起打包）
  drawChart(host, pattern, {
    cell: plan.cell,
    ruler,
    rulerPx: exportRulerPx(plan.cell),
    grid,
    codes,
    bold: true,
    boardLines: true,
    /* 导出的图不画板号角标：角标是画在格子上的白色圆角块，会盖住它下面几格的色号。
       分板信息由 PDF 页眉 / 单板图横幅给出，整图这里保持干净。 */
    boardLabels: false,
    /* 边缘中心红三角是编辑器里的定位标记，导出稿上不要 */
    centerMarks: false,
    background: bg,
    /* 透明导出时空格也留空，否则空白区会被铺成浅灰、整张图没有 alpha */
    emptyFill: bg === 'rgba(0,0,0,0)' ? null : undefined,
    /* 导出标版的线条 / 坐标配色（编辑器画布照旧） */
    theme: templated ? exportChartTheme(plan.cell) : undefined
  })
  // host 上挂了 __dpr: 1（prepareCanvas 的 1:1 旁路），所以缓冲尺寸应该精确等于计划好的几何尺寸。
  // 万一这个旁路失效（render.js 不再认 __dpr、或有人把 __dpr 从 host 上删掉），导出的图会被
  // 裁掉一块还不报错 —— 那种错用户不一定看得出来，所以这里对一次账：宁可报错，
  // 也不要给一张缺角的图纸。
  if (canvas.width !== g.width || canvas.height !== g.height) {
    return {
      ...g,
      ok: false,
      message: `图纸导出失败：画布尺寸校验不通过（期望 ${g.width}×${g.height}，实际 ${canvas.width}×${canvas.height}）。请把这句话反馈给开发者。`
    }
  }
  const out = templated
    ? composeExportTemplate(pattern, canvas, plan, { includeLegend, includeStats })
    : canvas
  return { ok: true, canvas: out, plan, opts }
}

/**
 * 图纸图片导出（PNG / JPG 共用一条链路）。
 *
 * 需求 §4.7：网格、行列坐标、每格色号、颜色图例、材料统计、背景都可开关；
 * PNG 可以保留透明背景，JPG 必须铺白底（否则透明区域会变黑）。
 * 图例 / 统计会拼在图纸下方，避免长表把图纸主体压小。
 */
export function exportPatternImage(pattern, {
  projectName = '豆玩 DOUWAN',
  quality = 0.92,
  onFail = null,
  ...imageOptions
} = {}) {
  const built = buildPatternImageCanvas(pattern, imageOptions)
  if (!built.ok) return built
  const { canvas: out, plan, opts } = built
  const format = opts.format
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const ext = format === 'jpg' ? 'jpg' : 'png'
  const filename = `${safeName(projectName)}-${pattern.width}x${pattern.height}-图纸.${ext}`
  try {
    out.toBlob(blob => {
      if (blob) {
        downloadBlob(blob, filename)
      } else if (typeof onFail === 'function') {
        onFail('浏览器没能编码这张图，请降低画布尺寸或改用 PDF 分板')
      }
    }, mime, format === 'jpg' ? quality : undefined)
  } catch (e) {
    return { ok: false, message: `导出失败：${e && e.message ? e.message : '浏览器不支持这个尺寸'}` }
  }
  return {
    ...plan.geometry,
    width: out.width,
    height: out.height,
    ok: true,
    pixels: out.width * out.height,
    message: imageMessage(pattern, plan, opts, out)
  }
}

/** 图纸 PNG：离屏重绘，不依赖屏幕上当前的缩放与视图 */
export function exportPatternPNG(pattern, opts = {}) {
  return exportPatternImage(pattern, { ...opts, format: 'png' })
}

/** 图纸 JPG：白底，适合手机查看、分享与普通打印 */
export function exportPatternJPG(pattern, opts = {}) {
  return exportPatternImage(pattern, { ...opts, format: 'jpg' })
}

/**
 * 按 DPI 导出整张图纸：像素 = 物理尺寸 × DPI，重新渲染（不是只写元数据）。
 * 实际 DPI 可能低于请求值（受单张画布上限），message 会写清。
 */
export function exportPatternImageAtDpi(pattern, {
  dpi = 300,
  format = 'png',
  projectName = '豆玩 DOUWAN',
  quality = 0.92,
  ...opts
} = {}) {
  const plan = dpiExportPlan(pattern, {
    dpi,
    mode: 'full',
    ruler: opts.ruler !== false,
    includeLegend: opts.includeLegend === true,
    includeStats: opts.includeStats === true
  })
  const res = exportPatternImage(pattern, { ...opts, format, projectName, quality, cell: plan.cell })
  if (res && res.ok) {
    res.dpi = plan.dpi
    res.requestedDpi = dpi
    res.capped = plan.capped
    res.message = `${plan.message}；${res.message}`
  }
  return res
}

export function exportPatternPNGAtDpi(pattern, opts = {}) {
  return exportPatternImageAtDpi(pattern, { ...opts, format: 'png' })
}

export function exportPatternJPGAtDpi(pattern, opts = {}) {
  return exportPatternImageAtDpi(pattern, { ...opts, format: 'jpg' })
}

/* ------------------------------------------------------------------ ZIP（无依赖） */

let CRC_TABLE = null
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * 最小 ZIP 写入器（store 模式，不压缩）。
 * 图片本身已经压缩过，再 deflate 收益很小；store 模式不需要引入第三方库，
 * 也让「分板图片组」能一次下载一个文件，而不是让浏览器连弹几十个下载。
 */
export function makeZip(entries) {
  const enc = new TextEncoder()
  const chunks = []
  const central = []
  let offset = 0
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xFFFF
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF

  for (const e of entries) {
    const name = enc.encode(e.name)
    const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data)
    const crc = crc32(data)
    const head = new Uint8Array(30 + name.length)
    const dv = new DataView(head.buffer)
    dv.setUint32(0, 0x04034B50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 0x0800, true) // UTF-8 文件名
    dv.setUint16(8, 0, true) // store
    dv.setUint16(10, dosTime, true)
    dv.setUint16(12, dosDate, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, data.length, true)
    dv.setUint16(26, name.length, true)
    dv.setUint16(28, 0, true)
    head.set(name, 30)
    chunks.push(head, data)
    central.push({ name, crc, size: data.length, offset })
    offset += head.length + data.length
  }

  const cdStart = offset
  for (const c of central) {
    const h = new Uint8Array(46 + c.name.length)
    const dv = new DataView(h.buffer)
    dv.setUint32(0, 0x02014B50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 20, true)
    dv.setUint16(8, 0x0800, true)
    dv.setUint16(10, 0, true)
    dv.setUint16(12, dosTime, true)
    dv.setUint16(14, dosDate, true)
    dv.setUint32(16, c.crc, true)
    dv.setUint32(20, c.size, true)
    dv.setUint32(24, c.size, true)
    dv.setUint16(28, c.name.length, true)
    dv.setUint16(30, 0, true)
    dv.setUint16(32, 0, true)
    dv.setUint16(34, 0, true)
    dv.setUint16(36, 0, true)
    dv.setUint32(38, 0, true)
    dv.setUint32(42, c.offset, true)
    h.set(c.name, 46)
    chunks.push(h)
    offset += h.length
  }

  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054B50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, offset - cdStart, true)
  ev.setUint32(16, cdStart, true)
  ev.setUint16(20, 0, true)
  chunks.push(end)
  return new Blob(chunks, { type: 'application/zip' })
}

/**
 * 分板图片底部那条色号用量：色块 + 色号 + 本板需要多少颗。
 * 字号跟着格子大小走（150 DPI 也不小于 11px），列数按图片宽度自适应。
 * 返回排版结果；entries 为空时返回 null（没有豆子的板不加这条）。
 */
function boardLegendLayout(entries, { width, cell }) {
  if (!entries.length) return null
  const fs = Math.max(11, Math.round(cell * 0.62))
  const font = `600 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = font
  const labels = entries.map(e => `${e.code} × ${e.count} 颗`)
  const colors = entries.map(e => e.hex || '#cccccc')
  const sw = Math.max(10, Math.round(fs * 1.05))
  const gap = Math.max(6, Math.round(fs * 0.4))
  const colGap = Math.max(14, Math.round(fs * 1.1))
  const margin = Math.max(10, Math.round(cell * 0.35))
  const chipW = Math.max(...labels.map(t => probe.measureText(t).width)) + sw + gap
  const usable = Math.max(width - margin * 2, chipW)
  const cols = Math.max(1, Math.floor((usable + colGap) / (chipW + colGap)))
  const rows = Math.ceil(labels.length / cols)
  const rowH = Math.round(fs * 1.85)
  const padTop = Math.round(fs * 1.0)
  const padBottom = Math.round(fs * 0.7)
  return {
    font, fs, labels, colors, sw, gap, colGap, margin, chipW, cols, rows, rowH, padTop,
    height: padTop + rows * rowH + padBottom
  }
}

function drawBoardLegend(ctx, lay, { width, top }) {
  const { font, fs, labels, colors, sw, gap, colGap, margin, chipW, cols, rowH, padTop } = lay
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, top, width, lay.height)
  ctx.strokeStyle = '#E6E6EB'
  ctx.lineWidth = Math.max(1, Math.round(fs * 0.1))
  ctx.beginPath()
  ctx.moveTo(0, top + 0.5)
  ctx.lineTo(width, top + 0.5)
  ctx.stroke()
  ctx.font = font
  ctx.textBaseline = 'middle'
  labels.forEach((text, i) => {
    const x = margin + (i % cols) * (chipW + colGap)
    const cy = top + padTop + Math.floor(i / cols) * rowH + rowH / 2
    const sy = cy - sw / 2
    ctx.fillStyle = colors[i]
    ctx.fillRect(x, sy, sw, sw)
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, sy + 0.5, sw - 1, sw - 1)
    ctx.fillStyle = '#1B1B1F'
    ctx.fillText(text, x + sw + gap, cy)
  })
  ctx.restore()
}

/**
 * 分板图片组：每块板一张 PNG / JPG，打成一个 ZIP。
 * 命名稳定（图纸名_第01板_300dpi.png），板号按全图顺序，不随本次勾选变化。
 * JPG 的空白区由 drawBoard 铺白底，不会出现透明变黑。
 * 每张图底部带一条色号用量（色块 + 色号 + 本板需要颗数），单独发出去也能照着备豆。
 */
export async function exportBoardImagesZip(pattern, {
  dpi = 300,
  format = 'png',
  projectName = '豆玩 DOUWAN',
  boardIndexes = null,
  background = '#ffffff',
  ruler = true,
  codes = true,
  grid = true,
  boardSize = null,
  includeLegend = true
} = {}) {
  const plan = dpiExportPlan(pattern, { dpi, mode: 'split', boardIndexes, ruler, boardSize })
  if (!plan.ok) return plan
  const entries = []
  const ext = format === 'jpg' ? 'jpg' : 'png'
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const beadCounts = boardBeadCounts(pattern, plan.layout)
  for (const b of plan.boards) {
    const { canvas, host } = createExportCanvas()
    const info = drawBoard(host, pattern, b, {
      cell: plan.cell,
      codes,
      ruler,
      grid,
      boardSize: boardOfExport(pattern, boardSize)
    })
    if (!info) return { ok: false, message: `第 ${b.no} 板绘制失败，请减少画布尺寸后重试` }
    if (canvas.width !== info.width || canvas.height !== info.height) {
      return { ok: false, message: `第 ${b.no} 板尺寸校验不通过（期望 ${info.width}×${info.height}，实际 ${canvas.width}×${canvas.height}）` }
    }

    /* 分板图片组没有 PDF 那样的页眉，单独一张图发出去就丢了「这是第几块、覆盖全图哪里」。
       在图上加一条窄横幅：板号 + 全局列/行范围 + 本板颗数与色数。
       坐标一律用**整张图纸的全局列 / 行号**，不从 1 或 0 重新数 —— 单板图和整图对得上。
       横幅是图片的一部分，不会改变网格本身；PDF 仍用页面页眉，不重复加。 */
    const bannerH = Math.max(26, Math.round(plan.cell * 1.5))
    const bmats = boardMaterials(pattern, b, null)
    const legend = includeLegend ? boardLegendLayout(bmats, { width: info.width, cell: plan.cell }) : null
    const out = document.createElement('canvas')
    out.width = info.width
    out.height = info.height + bannerH + (legend ? legend.height : 0)
    const octx = out.getContext('2d')
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.fillStyle = '#1B1B1F'
    octx.font = `700 ${Math.max(12, Math.round(plan.cell * 0.8))}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
    octx.textBaseline = 'middle'
    const colorCount = bmats.length
    const caption = `第 ${b.no} 板 · 全图第 ${b.x0 + 1}–${b.x0 + b.w} 列 / 第 ${b.y0 + 1}–${b.y0 + b.h} 行 · 本板 ${beadCounts[b.index] || 0} 颗 · ${colorCount} 色`
    octx.fillText(caption, Math.max(8, Math.round(plan.cell * 0.3)), Math.round(bannerH / 2))
    octx.drawImage(canvas, 0, bannerH)
    if (legend) drawBoardLegend(octx, legend, { width: out.width, top: bannerH + info.height })

    const blob = await new Promise(resolve => {
      try {
        out.toBlob(resolve, mime, format === 'jpg' ? 0.92 : undefined)
      } catch {
        resolve(null)
      }
    })
    if (!blob) return { ok: false, message: `第 ${b.no} 板编码失败，请降低 DPI 或改用 PDF` }
    entries.push({
      name: `${safeName(projectName)}_第${String(b.no).padStart(2, '0')}板_${plan.dpi}dpi.${ext}`,
      data: new Uint8Array(await blob.arrayBuffer())
    })
    // 让出主线程，避免连续编码几十块板时页面看起来卡死
    await new Promise(r => setTimeout(r, 0))
  }
  const zip = makeZip(entries)
  const first = plan.boards[0].no
  const last = plan.boards[plan.boards.length - 1].no
  downloadBlob(zip, `${safeName(projectName)}_分板_第${String(first).padStart(2, '0')}-${String(last).padStart(2, '0')}板_${plan.dpi}dpi.zip`)
  return {
    ok: true,
    count: entries.length,
    dpi: plan.dpi,
    requestedDpi: plan.requestedDpi,
    capped: plan.capped,
    cell: plan.cell,
    bytes: zip.size,
    message: `${plan.message}；已打包 ${entries.length} 张 ${ext.toUpperCase()}（${(zip.size / 1048576).toFixed(1)} MB）`
  }
}

/** 纯图案 PNG（不带标尺，适合发社媒 / 当预览图） */
export function exportCleanPNG(pattern, { projectName = '豆玩 DOUWAN', maxSize = 1600 } = {}) {
  const { canvas, width, height } = renderToCanvas(pattern, maxSize, { dpr: 2 })
  canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, `${safeName(projectName)}-${pattern.width}x${pattern.height}-图案.png`)
  }, 'image/png')
  // 这条链路本来就是安全的：drawPixels 按 maxSize 缩格子（保底 1 px/格），
  // 450 格也只是 450 px 底图 ×2 DPR，缓冲封顶 2×maxSize，不会像逐格图纸那样爆内存。
  // 1000×1000 时 cell 落到下限 1：底图 1000×1000、设备缓冲 2000×2000 = 16 MB RGBA，仍在安全范围内，
  // 所以这里不拒绝、只如实报尺寸 —— 但要说清「一格只有一个像素」，不然用户会拿它去核对色号。
  const cellPx = pattern.width ? width / pattern.width : 1
  const rawMb = (4 * width * height) / 1048576
  const bits = [`纯图案 PNG 已导出：${pattern.width}×${pattern.height} 格 → ${width}×${height} 像素（1 格 = ${cellPx} px，未压缩 RGBA 约 ${rawMb.toFixed(1)} MB，PNG 压缩后小得多）`]
  // 这条链路本来就不印色号；一格只剩一两个像素时它连「一颗豆长什么样」都看不出来，
  // 所以直接指路到能核对单颗豆的两个入口（阈值取 2：2x 屏上 1000 格正好是 2 px/格）
  if (cellPx <= 2) bits.push('这个尺寸下一格只有一两个像素，看单颗豆请用「图纸 PNG」或分板视图')
  return { ok: true, width, height, message: bits.join('；') }
}

/* ------------------------------------------------------------------ SVG / 数据 */

/**
 * 真正要画出来的豆子数（空格是 -1，toSVG 会 skip）。
 * 用来把「要画多少个图元」写进拒绝文案：1000×1000 满格是 100 万个，抠过背景之后通常少一些，
 * 文案里报一个数就得是真的，不能拿格数冒充图元数。
 */
function drawnBeadCount(pattern) {
  const cells = pattern.cells || []
  const palette = pattern.palette || []
  let n = 0
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i]
    if (k >= 0 && palette[k]) n++
  }
  return n
}

/**
 * SVG 矢量图。
 *
 * 大画布上这条链路的问题不是「慢」而是「体积」：一格一个 <rect>，开色号再一格一个 <text>，
 * 450×450 不带色号 10.7 MB、带色号 40.2 MB（node 实测量出来的字符串长度）；
 * 1000×1000 按同一套模板估算是不带色号约 57.5 MB、带色号约 214 MB（estimateSvgBytes 实测）——
 * 是 450 格的 5 倍上下，因为图元数（88 万颗豆）和坐标位数（4~6 位）都变大了。
 * 所以先估算、再决定给什么，绝不先建字符串后判断 —— 字符串一旦 join 出来，内存已经花掉了。
 * 三级处置：估算 ≤ 16 MB 照给（把体积告诉用户）→ 超了就丢色号（色号是体积大头）→
 * 丢色号还超就拒绝，并说明该改用哪个功能。硬上限 20 MB 会在真正建出字符串后再校验一次。
 */
export function exportSVG(pattern, { projectName = '豆玩 DOUWAN', cell = 12, codes = false } = {}) {
  const base = { cell, withGrid: true, withRuler: true, boardSize: boardOf(pattern) }
  const est = estimateSvgBytes(pattern, { ...base, withCodes: codes })
  const estPlain = codes ? estimateSvgBytes(pattern, { ...base, withCodes: false }) : est
  const mb = b => (b / 1048576).toFixed(1)
  const size = `${pattern.width}×${pattern.height} 格`
  let withCodes = codes
  let note = ''

  if (est > SVG_SINGLE_BYTES) {
    if (codes && estPlain <= SVG_SINGLE_BYTES) {
      // 丢色号比「什么都不给」有用：图还能无损放大、还能印，只是得对照屏幕看色号
      withCodes = false
      note = `色号会把文件撑到约 ${mb(est)} MB，已按上限丢掉色号降到约 ${mb(estPlain)} MB`
    } else {
      // 拒绝也要拒绝得有用：报出实际估算、说清为什么、指向真的能用的那条链路。
      // PNG 的尺寸在这里现算一次（**按标版整页算**，因为「图纸 PNG」导出的就是那张带页眉与
      // 底部双卡的整页图），免得文案里写死「4000×4000」而实际是别的数字
      //（1000 格在标版下是 2104×3117，不是图纸主体的 3036×3036）。
      const pngPlan = pngExportPlan(pattern, 24, { includeLegend: true, includeStats: true })
      const pngW = Math.ceil(pngPlan.pageW || pngPlan.geometry.width)
      const pngH = Math.ceil(pngPlan.pageH || pngPlan.geometry.height)
      return {
        ok: false,
        bytes: estPlain,
        message: `SVG 未导出：${size}的矢量图估算约 ${mb(estPlain)} MB${codes ? `（带色号约 ${mb(est)} MB）` : ''}，` +
          `超过单文件 ${mb(SVG_SINGLE_BYTES)} MB 的安全线（硬上限 ${mb(SVG_MAX_BYTES)} MB）。` +
          `原因：SVG 一格一个 <rect>，这张图纸要画 ${drawnBeadCount(pattern).toLocaleString()} 个图元（${size}最多 ${(pattern.width * pattern.height).toLocaleString()} 格），` +
          '浏览器光解析这些图元就会长时间卡住，字符串本身在内存里还要翻倍。' +
          `整张图纸请用「图纸 PNG」（这张画布导出 ${pngW}×${pngH} 像素）；1:1 分页打印请用「分板 PDF」。`
      }
    }
  }

  const svg = toSVG(pattern, { ...base, withCodes })
  // 估算只是估算（当前偏保守 5%～8%），真建出来再量一次，超过硬上限宁可丢掉
  if (svg.length > SVG_MAX_BYTES) {
    return {
      ok: false,
      bytes: svg.length,
      message: `SVG 未导出：实际体积约 ${mb(svg.length)} MB，超过 ${mb(SVG_MAX_BYTES)} MB 硬上限。请改用「图纸 PNG」或「分板 PDF」。`
    }
  }
  downloadText(svg, `${safeName(projectName)}-${pattern.width}x${pattern.height}.svg`, 'image/svg+xml;charset=utf-8')

  const heavy = svg.length > 4 * 1024 * 1024
  return {
    ok: true,
    bytes: svg.length,
    droppedCodes: codes && !withCodes,
    message: `${note ? note + '；' : ''}SVG 已导出：${size}，约 ${mb(svg.length)} MB${withCodes ? '' : '（不含色号）'}` +
      (heavy ? '；图元多，浏览器打开要等几秒，打印请优先用分板 PDF' : '')
  }
}

export function exportMaterialsCSV(pattern, inventoryMap, projectName) {
  downloadText(toMaterialsCSV(pattern, inventoryMap, projectName), `${safeName(projectName)}-材料清单.csv`, 'text/csv;charset=utf-8')
}

/**
 * Pattern JSON（结构化网格数据）。
 *
 * 体积随画布面积线性涨：cells 是「一格一个色号字符串」，1000×1000 = 100 万格，
 * 带 2 空格缩进时每格约占 11 字节（`    "H1",\n`），所以成品是 10 MB 量级的文本
 * —— 450×450 时约 2.3 MB，还看不出来；1000×1000 就必须先把体积报给用户，
 * 否则点了没反应，用户会以为按钮坏了（其实是在序列化 100 万个字符串）。
 * 这里先把 Blob 建出来、按真实字节数回报，再让 downloadBlob 用它，避免同一份文本建两次 Blob。
 */
export function exportPatternJSON(pattern, projectName, extra = {}) {
  const payload = {
    app: '豆玩 DOUWAN',
    exportedAt: new Date().toISOString(),
    projectName,
    version: 1,
    brandId: pattern.brandId,
    mode: pattern.mode,
    width: pattern.width,
    height: pattern.height,
    palette: pattern.palette.map(p => ({ id: p.id, code: p.code, name: p.name, hex: p.hex })),
    paletteCodes: pattern.palette.map(p => p.code),
    cells: Array.from(pattern.cells, i => pattern.palette[i]?.code ?? null),
    stats: pattern.stats,
    boardSize: boardOf(pattern),
    beadKey: (pattern && pattern.beadKey) || null,
    beadMm: (pattern && pattern.beadMm) || null,
    ...extra
  }
  const text = JSON.stringify(payload, null, 2)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  downloadBlob(blob, `${safeName(projectName)}-pattern.json`)
  const mbytes = blob.size / 1048576
  return {
    ok: true,
    bytes: blob.size,
    cells: pattern.width * pattern.height,
    message:
      `Pattern JSON 已导出：${pattern.width}×${pattern.height} = ${(pattern.width * pattern.height).toLocaleString()} 格，文件约 ${mbytes.toFixed(1)} MB` +
      `（每格一个色号字符串，${mbytes >= 4 ? '浏览器要序列化 100 万量级的字符串，生成时会卡一两秒；' : ''}只要材料用量可以改用 CSV）`
  }
}

export async function copyShoppingList(pattern, inventoryMap, projectName) {
  const text = toShoppingText(pattern, inventoryMap, projectName)
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, text }
  } catch {
    // 剪贴板 API 在非安全上下文会失败，退回 textarea 方案
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return { ok, text }
    } catch {
      return { ok: false, text }
    }
  }
}

/* ------------------------------------------------------------------ PDF / 打印 */

/**
 * 分板打印的计划：出几页、每板多少像素。
 *
 * 为什么不再用 <td> 画格子：300×300 是 121 页 / 90,000 个 <td>，450×450 是 256 页 / 202,500 个，
 * 每个 td 还带 class + style + 色号（约 110 字节），光 HTML 字符串就 20 MB 起步，
 * 浏览器还要为每个格建元素再跑一遍表格布局 —— 这就是「页面直接卡死」的来源。
 * 现在每板画一张 <canvas>（render.js 的 drawBoard）再内联成 PNG，DOM 里只剩 256 个 <img>。
 *
 * 每板分辨率为什么随页数往下走：无论哪一档，「所有板图解码后的 RGBA」都压在 ~160 MB：
 *   64 板 × 24 px/格（782² ≈ 2.4 MB）≈ 156 MB
 *   144 板 × 16 px/格（522² ≈ 1.1 MB）≈ 157 MB
 *   256 板 × 12 px/格（392² ≈ 0.6 MB）≈ 157 MB
 *   （392 是按标尺 = 1.8 × cell 的上界算的；drawBoard 实际用 1.7 × cell → 388² ≈ 0.57 MB。
 *     两条都用过、都压在同一个量级，这里统一取更保守的那一侧，下面所有 MB 数都以它为准。）
 * 固定 24 px/格 直接上 256 板就是 615 MB，Chrome 在打印预览阶段就会崩。
 * 纸面代价（1 格 = 5 mm）：24 px/格 ≈ 122 dpi、16 ≈ 81 dpi、12 ≈ 61 dpi —— 色号都还认得出来。
 *
 * 页数上限 = PRINT_MAX_BOARDS（256 = 16×16 块 = 旧权益上限 464×464 格）。
 * 1000×1000 是 35×35 = 1225 块板 = 1225 页，远超这道墙，所以 printPlan 一定返回 ok:false
 * 并把「要出多少页 / 上限多少 / 为什么 / 能改用什么」一次说全（见 printPlan 的 message）。
 * 换句话说：档位表只覆盖 ≤256 页；1225 页不会掉进某个更低的档位，而是根本不出图。
 */
const PRINT_CELL_TIERS = [
  { maxBoards: 64, cell: 24 },
  { maxBoards: 144, cell: 16 },
  { maxBoards: PRINT_MAX_BOARDS, cell: 12 }
]

/** 出几页 / 每板多少 px。导出前先过这道闸门，UI 也可以拿它做预检 */
export function printPlan(pattern, { boardIndexes = null, cell = null, ruler = true, boardSize = null } = {}) {
  const layout = boardLayout(pattern.width, pattern.height, boardOfExport(pattern, boardSize))
  const boards = boardIndexes && boardIndexes.length
    ? boardIndexes.map(i => layout.boards[i]).filter(Boolean)
    : layout.boards
  const tier = boards.length > 0 ? PRINT_CELL_TIERS.find(t => boards.length <= t.maxBoards) : null
  if (!tier) {
    // 拒绝文案的四件事：出多少页 / 上限多少 / 为什么（内存数字）/ 能改用什么。
    // 只丢一句「超过上限」等于把用户堵死在这里 —— 1000×1000 是 1225 页，他没有别的办法把它变成 256 页，
    // 必须知道「整图看 PNG、1:1 只打选中的板」这两条路。
    // 每页的量级从「256 页 ≈ 157 MB」这条标定换算（157/256 ≈ 0.61 MB/页，算式见 PRINT_CELL_TIERS 注释）：
    // 用固定常数 0.6 会让 260 页算出 155 MB —— 比 256 页的 157 MB 还小，一眼就是错的。
    const pageMb = 157 / PRINT_MAX_BOARDS
    const cm = cmPerBeadOf(pattern)
    /* 成品厘米只算图案占的那块：画布四周留白不算成品 */
    const artW = pattern.artW || pattern.width
    const artH = pattern.artH || pattern.height
    const cmW = (artW * cm).toFixed(0)
    const cmH = (artH * cm).toFixed(0)
    const alternative = boardIndexes && boardIndexes.length
      ? `你这次勾选了 ${boards.length} 块板，请在分板视图里把勾选减到 ${PRINT_MAX_BOARDS} 块以内分批打印（每批 ≤ ${PRINT_MAX_BOARDS} 页），或者改用「图纸 PNG」看整张图。`
      : `可用的替代：整张图纸用「图纸 PNG」（一次导出全图）；要 1:1 打印就先去分板视图里勾选要打的板，一批不超过 ${PRINT_MAX_BOARDS} 块。`
    return {
      layout,
      boards,
      count: boards.length,
      total: layout.count,
      cell: 0,
      ok: false,
      message: boards.length === 0
        ? '没有选中要打印的板（勾选的板号都无效），请回到分板视图重新选择'
        : `分板 PDF 未生成：这次要出 ${boards.length} 页，超过 ${PRINT_MAX_BOARDS} 页上限。` +
          `原因：每页是一张板图（canvas 位图），按 12 px/格算每页解码后约 0.6 MB —— ${PRINT_MAX_BOARDS} 页已经要吃掉约 157 MB 内存，` +
          `${boards.length} 页约 ${Math.round(boards.length * pageMb)} MB，浏览器在打印预览阶段就会崩。` +
          `当前画布 ${pattern.width}×${pattern.height} 格 = ${layout.count} 块拼板（${layout.cols} 列 × ${layout.rows} 行，每块 ${boardLabelOf(pattern, boardSize)}），` +
          `1 格 = ${beadOfPattern(pattern).mm} mm（${beadOfPattern(pattern).label}），成品约 ${cmW} × ${cmH} cm。` +
          alternative
    }
  }
  /* 高清导出会显式传 cell（由 dpiExportPlan 算好）；这里再兜一道单张画布上限，
     避免调用方传一个 600 DPI 的格宽把某块板撑过 4096 px。 */
  const wantedCell = cell ? Math.max(1, Math.round(cell)) : tier.cell
  let useCell = wantedCell
  while (useCell > 1 && !boards.every(b => fitsCanvas(boardImagePx(b, useCell, ruler)))) useCell--
  const actualDpi = dpiOf(beadOfPattern(pattern).mm, useCell)
  const capped = useCell < wantedCell
  return {
    layout,
    boards,
    count: boards.length,
    total: layout.count,
    cell: useCell,
    requestedCell: wantedCell,
    dpi: actualDpi,
    capped,
    ok: true,
    message: `分板图纸已生成：共 ${boards.length} 页（全图 ${layout.count} 块拼板 · ${boardLabelOf(pattern, boardSize)}），1 格 = ${beadOfPattern(pattern).mm} mm，每板 ${useCell} px/格（约 ${actualDpi} DPI）` +
      (capped
        ? `；请求 ${wantedCell} px/格，受 ${PNG_MAX_SIDE} px 单张上限压到 ${useCell} px/格`
        : (useCell < PRINT_CELL_TIERS[0].cell ? '（页数多，已自动降低每板分辨率）' : ''))
  }
}

/**
 * 标版（页眉 / 图案信息 / 颜色清单 / 页脚）拼在图纸下方会增加的高度。
 *
 * 尺寸口径全部在 exportTemplate.js 里（templateExtraHeight 与 composeExportTemplate
 * 用同一套排版常量）—— 这里只做转发。两处必须一起改，
 * 否则「预检说 1716×1716、实际文件 1716×1900」又会回来。
 */
function legendExtraHeight(pattern, { width, includeLegend = false, includeStats = false }) {
  if (!includeLegend && !includeStats) return 0
  return templateExtraHeight(pattern, width, { includeLegend, includeStats })
}

/**
 * 高清导出的尺寸计划：按 DPI 算真实像素，并算出浏览器实际能承载的档位。
 *
 * mode:
 *   'full'  → 整张图纸一张图（PNG / JPG）
 *   'split' → 分板图片组（每块板一张，最后打 ZIP；一次只在内存里放一块板）
 *   'pdf'   → 分板 PDF（所有板图会同时留在打印文档里，所以要按总像素预算再压一档）
 *
 * 返回的 dpi 是**实际** DPI（可能低于 requestedDpi）；capped=true 时 message 会写清原因。
 */
export function dpiExportPlan(pattern, {
  dpi = 300,
  mode = 'full',
  boardIndexes = null,
  ruler = true,
  includeLegend = false,
  includeStats = false,
  boardSize = null
} = {}) {
  const mm = beadOfPattern(pattern).mm
  const wantCell = Math.max(1, Math.round((mm / MM_PER_INCH) * dpi))
  const layout = boardLayout(pattern.width, pattern.height, boardOfExport(pattern, boardSize))
  const boards = boardIndexes && boardIndexes.length
    ? boardIndexes.map(i => layout.boards[i]).filter(Boolean)
    : layout.boards

  if (mode === 'full') {
    /* 这里的几何必须与 buildPatternImageCanvas 完全一致（同一套标尺宽度、
       同一套页面留白），否则「预检报的尺寸」和「实际导出的文件」会差一截。 */
    const templated = includeLegend || includeStats
    let cell = wantCell
    let geo = chartGeometry(pattern, { cell, ruler, rulerPx: exportRulerPx(cell) })
    let extraH = legendExtraHeight(pattern, { width: geo.width, includeLegend, includeStats })
    let pageW = templated ? exportPageWidth(geo.width) : geo.width
    while (cell > 1 && !fitsCanvas({ width: pageW, height: geo.height + extraH })) {
      cell--
      geo = chartGeometry(pattern, { cell, ruler, rulerPx: exportRulerPx(cell) })
      extraH = legendExtraHeight(pattern, { width: geo.width, includeLegend, includeStats })
      pageW = templated ? exportPageWidth(geo.width) : geo.width
    }
    const height = geo.height + extraH
    const capped = cell < wantCell
    const actual = dpiOf(mm, cell)
    const legendNote = extraH
      ? `（图纸主体 ${geo.width}×${geo.height} px + 标版 ${extraH} px）`
      : ''
    return {
      ok: true, mode, requestedDpi: dpi, dpi: actual, cell, capped,
      width: pageW, height, chartHeight: geo.height, pixels: pageW * height,
      pages: 1, count: 1, total: layout.count, layout, boards: [],
      message: capped
        ? `图太大，${dpi} DPI 导不出来，已自动降到 ${actual} DPI（${pageW}×${height} px）。想要 ${dpi} DPI 的清晰度，请改用「分板交付」分块导出。`
        : `${dpi} DPI · 每格 ${cell} px · ${pageW}×${height} px${legendNote}`
    }
  }

  if (!boards.length) {
    return { ok: false, mode, requestedDpi: dpi, dpi: 0, cell: 0, capped: false, width: 0, height: 0, pages: 0, count: 0, total: layout.count, layout, boards: [], message: '没有可导出的分板（板号无效或图纸为空）' }
  }

  let cell = wantCell
  while (cell > 1 && !boards.every(b => fitsCanvas(boardImagePx(b, cell, ruler)))) cell--
  const totalPixels = () => boards.reduce((sum, b) => {
    const p = boardImagePx(b, cell)
    return sum + p.w * p.h
  }, 0)
  let px = totalPixels()
  if (mode === 'pdf') {
    while (cell > 1 && px > PRINT_TOTAL_PIXELS) {
      cell--
      px = totalPixels()
    }
  }
  const maxSize = boards.reduce((m, b) => {
    const p = boardImagePx(b, cell)
    return { w: Math.max(m.w, p.w), h: Math.max(m.h, p.h) }
  }, { w: 0, h: 0 })
  const capped = cell < wantCell
  const actual = dpiOf(mm, cell)
  /* 提示写给普通用户看：只说「导不出来、降到了多少、想要高清怎么办」，
     不解释像素上限、内存占用这些实现细节。 */
  const pdfNote = mode === 'pdf' ? '分板 PDF 要一次装下全部板图，尺寸会再小一点。' : ''
  return {
    ok: true, mode, requestedDpi: dpi, dpi: actual, cell, capped,
    width: maxSize.w, height: maxSize.h, pixels: px,
    pages: boards.length, count: boards.length, total: layout.count,
    layout, boards,
    message: capped
      ? `图太大，${dpi} DPI 导不出来，已自动降到 ${actual} DPI（单板最大 ${maxSize.w}×${maxSize.h} px）。共 ${boards.length} 页。${pdfNote}`
      : `${dpi} DPI · 每格 ${cell} px · 单板最大 ${maxSize.w}×${maxSize.h} px · 共 ${boards.length} 页`
  }
}

/**
 * 生成可打印的分板图纸文档。
 * 结构（PRD §49）：
 *   第 1 页 封面：作品名 / 预览 / 尺寸 / 总豆数 / 色数 / 预计时间
 *   中间每块板一页：该板整图（canvas 画的 PNG）+ 板号 + 该板材料清单
 *   最后材料总表
 *
 * 1:1 尺寸说明：一钉 = 一格 = 一颗豆，所以 1 格 = 豆径（2.6mm 小豆 → 2.6mm/格、
 * 5mm 中号豆 → 5mm/格，见 lib/boardSpec.js）。板图整张（含四边标尺）按豆径换算成 mm 宽，
 * 打印时格子在纸上正好一颗豆的宽度 —— 这一点以前是错的：老表格版给的是 14 CSS px/格（5mm 时≈3.7mm），
 * 和封面上「实体约 xx cm」「1 格 = 5mm」自相矛盾（对照旧代码 exporters.js 的 cellPx = 14）。
 *
 * 板数超过上限时返回空字符串，由 printPattern 负责把原因说出来（buildPrintHTML 的契约仍是「给 HTML」）。
 */
export function buildPrintHTML(pattern, {
  projectName = '豆玩 DOUWAN',
  boardIndexes = null,
  inventoryMap = null,
  includeCover = true,
  includeMaterials = true,
  includeBoardLegend = true,
  orientation = 'portrait',
  stats = null,
  brandName = '',
  cellMm = null,
  cell = null,
  dpi = null,
  ruler = true,
  codes = true,
  grid = true,
  boardSize = null
} = {}) {
  const plan = printPlan(pattern, { boardIndexes, cell, ruler, boardSize })
  if (!plan.ok) return ''
  const lay = plan.layout
  const boards = plan.boards
  const mats = materialList(pattern, inventoryMap)
  /* 打印毫米数默认跟图纸的豆径走（2.6mm 小豆 → 2.6mm/格）；调用方显式传 cellMm 时以传的为准 */
  const bead = beadOfPattern(pattern)
  const mmPerCell = Number(cellMm) > 0 ? Number(cellMm) : bead.mm

  const s = stats || pattern.stats || {}
  /* 封面预览走 drawPixels(maxSize 520)：1000 格时 cell 落到下限 1，底图 1000×1000、设备缓冲 2000×2000，
     也就是 16 MB RGBA —— 这条路径不会因为画布变大而爆，但要真的画 100 万格，慢且有可能抛。
     封面是「锦上添花」，一张预览图失败不该让整份 1225 页/多页文档生不出来，所以这里兜住：
     失败就退化成没有预览图的封面（下面 coverHTML 里按 previewUrl 有没有决定画不画那张 <img>）。 */
  let previewUrl = ''
  if (includeCover) {
    try {
      previewUrl = renderToCanvas(pattern, 520).canvas.toDataURL('image/png')
    } catch {
      previewUrl = ''
    }
  }

  const artW = pattern.artW || pattern.width
  const artH = pattern.artH || pattern.height
  const cmW = (artW * bead.cm).toFixed(1)
  const cmH = (artH * bead.cm).toFixed(1)

  const css = `
  @page { size: A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 10mm; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#1B1B1F;margin:0}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:15px;margin:0 0 8px}
  .meta{font-size:11px;color:#8B8B93;margin-bottom:10px}
  .cover{page-break-after:always;text-align:center;padding-top:8mm}
  .brandBar{display:flex;justify-content:space-between;align-items:center;gap:6mm;margin-bottom:8mm}
  .brandBar img{height:12mm;width:auto;object-fit:contain}
  .urlPill{display:inline-flex;align-items:center;gap:2.4mm;border:1px solid #FBDDE6;background:#FDECF1;border-radius:6mm;padding:1.4mm 4mm 1.4mm 1.4mm;font-weight:800;font-size:16px;color:#F8385A;letter-spacing:.2px}
  .urlIcon{width:5.4mm;height:5.4mm;border-radius:50%;background:#FB6480;position:relative;display:inline-block;flex:0 0 auto}
  .urlIcon:after{content:"";position:absolute;right:-1.1mm;bottom:-1.1mm;width:2.1mm;height:2.1mm;border-radius:2mm;background:#FB6480;transform:rotate(45deg)}
  .sloganRow{display:inline-flex;align-items:center;gap:3mm;margin-left:auto}
  .slogan{color:#5A6488;font-weight:700;font-size:14px;white-space:nowrap}
  .blk{width:4.4mm;height:4.4mm;border-radius:1.2mm;display:inline-block}
  .blk.b1{background:#FDB9C5}.blk.b2{background:#FDD56C}.blk.b3{background:#6BD4B6}.blk.b4{background:#7AB2FE}
  .cover img{max-width:100%;max-height:120mm;image-rendering:pixelated;border:1px solid #E9EAEE;border-radius:6px}
  .previewFallback{font-size:11px;color:#9A9AA2;padding:40mm 0}
  .coverGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:150mm;margin:14px auto 0;text-align:left}
  .coverGrid div{border:1px solid #E9EAEE;border-radius:8px;padding:7px 9px}
  .coverGrid b{display:block;font-size:15px}
  .coverGrid span{font-size:10px;color:#9A9AA2}
  .boardPage{page-break-after:always;break-after:page;display:flex;flex-direction:column;align-items:center}
  .boardHead{width:100%;display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px}
  .boardHead .no{font-size:17px;font-weight:800}
  .boardHead .sub{font-size:11px;color:#8B8B93}
  /* 板图是 canvas 位图：按 mm 定尺寸（格子在纸上才是真的豆径宽），像素边缘保持硬边，
     插值会让小豆的格子里那两三个字符糊掉。pixelated 写在后面 —— 两个都支持时以它为准 */
  .boardImg{display:block;image-rendering:crisp-edges;image-rendering:pixelated;border:1px solid #E4E5E9;break-inside:avoid}
  .legend{font-size:10px;color:#8B8B93;margin-top:6px;width:100%;display:flex;flex-wrap:wrap;gap:8px}
  .legend span{display:inline-flex;align-items:center;gap:4px}
  .legend i{width:10px;height:10px;border-radius:3px;border:1px solid rgba(28,28,32,.14);display:block}
  .matTable{width:100%;border-collapse:collapse;font-size:11px}
  .matTable th,.matTable td{border-bottom:1px solid #E9EAEE;padding:5px 6px;text-align:left}
  .matTable th{background:#F4F5F7;font-size:10px;color:#8B8B93}
  .matTable td.num,.matTable th.num{text-align:right}
  .sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid rgba(28,28,32,.14);vertical-align:-2px}
  .tip{font-size:10px;color:#9A9AA2;margin-top:10px;line-height:1.7}
  .pageBreak{page-break-after:always}
  @media print{ .no-print{display:none} }
  `

  /**
   * 一块板 = 一张 PNG（canvas 离屏画好再内联）。
   * 宽度按 info.cell 换算成 mm：整张图（含四边标尺）都是同一个比例，
   * 所以不能把「格子区宽度」直接写成 board.w * cellMm，标尺会被算漏、格子就不到豆径宽。
   */
  const renderBoardImage = board => {
    const { canvas, host } = createExportCanvas()
    const info = drawBoard(host, pattern, board, { cell: plan.cell, codes, ruler, grid, boardSize: boardOfExport(pattern, boardSize) })
    if (!info) return null
    // 和整图导出同一道对账：__dpr 旁路一旦失效，缓冲尺寸就和 drawBoard 报的几何尺寸对不上，
    // 直接抛出去让 printPattern 变成一句能给用户看的失败原因，别印出缺角的板
    if (canvas.width !== info.width || canvas.height !== info.height) {
      throw new Error(`板图尺寸校验不通过（期望 ${info.width}×${info.height}，实际 ${canvas.width}×${canvas.height}）`)
    }
    const mm = (info.width * mmPerCell) / info.cell
    return {
      url: canvas.toDataURL('image/png'),
      mm: mm.toFixed(1),
      px: `${info.width}×${info.height}`
    }
  }

  const coverHTML = includeCover
    ? `
  <section class="cover">
    <div class="brandBar">
      <img src="${logoTemplateUrl}" alt="豆玩 DOUWAN">
      <span class="urlPill"><span class="urlIcon"></span>${SITE_URL_TEXT}</span>
      <span class="sloganRow">
        <span class="slogan">${SLOGAN_TEXT}</span>
        <span class="blk b1"></span><span class="blk b2"></span><span class="blk b3"></span><span class="blk b4"></span>
      </span>
    </div>
    <h1>${escapeHtml(projectName)}</h1>
    <div class="meta">豆玩 DOUWAN · 拼豆分板图纸${brandName ? ' · ' + escapeHtml(brandName) : ''}</div>
    ${previewUrl
      ? `<img src="${previewUrl}" alt="作品预览">`
      : '<div class="previewFallback">（预览图没画出来，不影响下面的分板页与材料表）</div>'}
    <div class="coverGrid">
      <div><b>${artW} × ${artH}</b><span>成品区域（1 格 = 1 颗豆）</span></div>
      ${artW < pattern.width || artH < pattern.height ? `<div><b>${pattern.width} × ${pattern.height}</b><span>画布（底板）</span></div>` : ''}
      <div><b>${(s.beadCount || 0).toLocaleString()} 颗</b><span>总豆数</span></div>
      ${s.emptyCount ? `<div><b>${s.emptyCount.toLocaleString()} 格</b><span>不放豆（已去背景）</span></div>` : ''}
      <div><b>${s.colorCount || pattern.palette.length} 色</b><span>颜色数</span></div>
      <div><b>${cmW} × ${cmH} cm</b><span>成品尺寸（${bead.label}）</span></div>
      <div><b>${lay.count} 块</b><span>拼板 ${boardLabelOf(pattern, boardSize)}</span></div>
      <div><b>${formatMin(s.estimatedMinutes)}</b><span>预计拼制时间</span></div>
    </div>
    <p class="tip">打印说明：纸张 A4 ${orientation === 'landscape' ? '横向' : '纵向'}，每块板单独一页，格内为色号，每格在纸上正好 ${bead.mm} mm（${bead.label}）。打印时请选择「实际大小 / 100%」，不要勾选「适合页面」，否则尺寸会缩小。${boards.length < lay.count ? `本 PDF 只包含选中的 ${boards.length} 块板（全图共 ${lay.count} 块，其余板可以分批再打）。` : ''}</p>
  </section>`
    : ''

  const boardPages = boards
    .map(b => {
      const img = renderBoardImage(b)
      if (!img) return ''
      const bmats = boardMaterials(pattern, b, inventoryMap)
      /* b.cells 是「这块板最多能放多少颗」，抠掉背景后会虚高；
         页眉要的是真正要放的豆数，按材料明细求和 */
      const bBeads = bmats.reduce((sum, m) => sum + m.count, 0)
      const legend = includeBoardLegend
        ? bmats
          .map(m => {
            const rowBrand = m.brandId ? getBrand(m.brandId).name : brandName
            return `<span><i style="background:${m.hex}"></i>${escapeHtml(rowBrand)} · ${escapeHtml(m.code)}${m.name ? ' ' + escapeHtml(m.name) : ''} × ${m.count} 颗</span>`
          })
          .join('')
        : ''
      return `
  <section class="boardPage">
    <div class="boardHead">
      <div><span class="no">第 ${b.no} / ${lay.count} 板</span>
        <span class="sub">　全图 ${b.x0 + 1}–${b.x0 + b.w} 列 · ${b.y0 + 1}–${b.y0 + b.h} 行（单板图沿用同一套全局列 / 行号）</span></div>
      <div class="sub">本板 ${bBeads.toLocaleString()} 颗 · ${bmats.length} 色 · 实体约 ${(b.w * bead.cm).toFixed(1)} × ${(b.h * bead.cm).toFixed(1)} cm · 图 ${img.px} px · 约 ${dpi || plan.dpi} DPI</div>
    </div>
    <img class="boardImg" style="width:${img.mm}mm" src="${img.url}" alt="第 ${b.no} 板图纸">
    ${legend ? `<div class="legend">${legend}</div>` : ''}
  </section>`
    })
    .join('')

  const matPage = includeMaterials && mats.rows.length
    ? `
  <section>
    <h2>材料清单（全部 ${mats.colorCount} 色 · 共 ${mats.totalBeads.toLocaleString()} 颗）</h2>
    <table class="matTable">
      <thead><tr><th>色块</th><th>品牌/系列</th><th>色号</th><th>颜色</th><th class="num">需要</th><th class="num">已拥有</th><th class="num">缺少</th></tr></thead>
      <tbody>
        ${mats.rows
          .map(
            r => `<tr>
          <td><span class="sw" style="background:${r.hex}"></span></td>
          <td>${escapeHtml(r.brandId ? (getBrand(r.brandId) || {}).name || r.brandId : brandName)}</td>
          <td>${escapeHtml(r.code)}</td>
          <td>${escapeHtml(r.name || '—')}</td>
          <td class="num">${r.count}</td>
          <td class="num">${r.owned || '—'}</td>
          <td class="num" ${r.lack > 0 ? 'style="color:#D3244A;font-weight:700"' : ''}>${r.lack || '—'}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
    ${mats.totalLack > 0
      ? `<p class="tip">需补购 ${mats.totalLack.toLocaleString()} 颗。</p>`
      : '<p class="tip">当前库存已足够完成这件作品。</p>'}
    <p class="tip">颜色用量按当前图纸逐格统计，与图上的色号完全一致。</p>
  </section>`
    : ''

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(projectName)} · 豆玩 DOUWAN 分板图纸</title>
<style>${css}</style></head>
<body>
${coverHTML}
${boardPages}
${matPage}
<script>
(function(){
  /* 大图纸一页一张板图，最多 256 张。必须等它们解码完再弹打印，
     否则靠后的页会印成空白；解码万一卡住也得兜底弹出，不能什么都不发生 */
  var done = false
  function go(){ if (done) return; done = true; try { window.print() } catch (e) {} }
  function ready(){
    var imgs = [].slice.call(document.images || [])
    var waits = imgs.map(function(im){ return im && im.decode ? im.decode().catch(function(){}) : null })
    Promise.all(waits).then(function(){ setTimeout(go, 300) }, function(){ setTimeout(go, 300) })
    setTimeout(go, 8000)
  }
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready)
})()
<\/script>
</body></html>`
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function formatMin(m) {
  const v = Math.round(Number(m) || 0)
  if (!v) return '—'
  if (v < 60) return `${v} 分钟`
  const h = Math.floor(v / 60)
  const r = v % 60
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`
}

/**
 * 打开打印窗口（浏览器里「打印 → 保存为 PDF」即得到分板 PDF）。
 * 返回 { ok, message, opened }：ok=false 表示根本没生成（页数超上限），message 必须给用户看；
 * 调用方原来只用返回值判断「弹窗有没有被拦」，现在统一读 message 走 toast。
 */
export function printPattern(pattern, opts = {}) {
  const plan = printPlan(pattern, opts)
  if (!plan.ok) return { ok: false, message: plan.message }
  let html
  try {
    html = buildPrintHTML(pattern, opts)
  } catch (err) {
    // buildPrintHTML 里的尺寸对账失败会抛错：那说明导出画布反推错了，
    // 与其让用户拿到一份缺角的图纸，不如把原因说清楚
    return { ok: false, message: `分板图纸生成失败：${err.message}` }
  }
  if (!html) {
    // 走到这里说明页数过了闸门、但文档没生成出来（板图绘制失败）。
    // 不能回一句「已生成」了事：ok:false 必须配一个说得出原因的 message。
    return { ok: false, message: '分板图纸生成失败：没有画出任何板图。可以改用「图纸 PNG」导出整张图，或减少选中的板再试一次。' }
  }
  const w = window.open('', '_blank')
  if (!w) {
    // 弹窗被拦截：退回隐藏 iframe 打印。iframe 里的脚本自己会等图解码完再 print，
    // 这里的 900ms 只够触发一次「兜底」打印，真正的打印时机由页面内脚本决定
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    document.body.appendChild(frame)
    frame.srcdoc = html
    setTimeout(() => {
      try {
        frame.contentWindow.focus()
      } catch {
        /* ignore */
      }
      setTimeout(() => frame.remove(), 120000)
    }, 900)
    return { ok: true, opened: false, message: `${plan.message}（弹窗被拦截，已用隐藏页打印）` }
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  return { ok: true, opened: true, message: plan.message }
}

/* ------------------------------------------------------------------ 电子档 PDF

   和上面的「分板 PDF」不是同一条路：
     · 上面那条走 window.print()，用户要在打印对话框里选「另存为 PDF」才拿到文件；
     · 这里直接生成 .pdf 字节并下载，点一下就得文件，不弹打印窗口。

   实现方式：每一页先在 canvas 上按 A4 版式画好（封面 / 每板一页 / 材料清单），
   再把整页位图压成 FlateDecode 的 RGB 流写进 PDF。这样中文、色号、表格都由 canvas
   负责排版，不需要往 PDF 里嵌字体（CJK 字体动辄几 MB），也不用引第三方 PDF 库。
   150 DPI 是「手机看得清、文件不至于太大」的折中：A4 = 1240×1754 px。 */

const PDF_DPI = 150
const PDF_FONT = '-apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'
const PDF_A4_PT = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] }

function pdfPageSize(orientation) {
  const [ptW, ptH] = PDF_A4_PT[orientation === 'landscape' ? 'landscape' : 'portrait']
  const s = PDF_DPI / 72
  return { ptW, ptH, w: Math.round(ptW * s), h: Math.round(ptH * s) }
}

function pdfCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  return { c, ctx }
}

function fitCanvasText(ctx, text, maxW) {
  const s = String(text == null ? '' : text)
  if (ctx.measureText(s).width <= maxW) return s
  let cut = s
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxW) cut = cut.slice(0, -1)
  return cut + '…'
}

function wrapCanvasText(ctx, text, maxW) {
  const lines = []
  let line = ''
  for (const ch of String(text || '')) {
    if (line && ctx.measureText(line + ch).width > maxW) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

/** 一页 canvas → PDF 里的一条 FlateDecode RGB 图像流 */
async function encodePdfPage(canvas) {
  const w = canvas.width
  const h = canvas.height
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h)
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0, j = 0; i < data.length; i += 4) {
    rgb[j++] = data[i]
    rgb[j++] = data[i + 1]
    rgb[j++] = data[i + 2]
  }
  const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))
  const packed = new Uint8Array(await new Response(stream).arrayBuffer())
  return { width: w, height: h, data: packed }
}

/** 把若干整页图像拼成一份最小但结构完整的 PDF（每页 = 一张全页图） */
function buildPdfBlob(pages, { ptW, ptH }) {
  const chunks = []
  let offset = 0
  const offsets = []
  const enc = new TextEncoder()
  const put = part => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part
    chunks.push(bytes)
    offset += bytes.length
  }
  put(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]))
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const totalObjs = 2 + pages.length * 3
  const obj = (n, body) => {
    offsets[n] = offset
    put(`${n} 0 obj\n${body}\nendobj\n`)
  }
  const streamObj = (n, dict, data) => {
    offsets[n] = offset
    put(`${n} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`)
    put(data)
    put('\nendstream\nendobj\n')
  }
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  const kids = pages.map((_, i) => `${3 + i * 3 + 2} 0 R`).join(' ')
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  pages.forEach((pg, i) => {
    const imgObj = 3 + i * 3
    const contentObj = imgObj + 1
    const pageObj = imgObj + 2
    streamObj(
      imgObj,
      `/Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
      pg.data
    )
    const content = enc.encode(`q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`)
    streamObj(contentObj, '', content)
    obj(pageObj, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 ${imgObj} 0 R >> >> /Contents ${contentObj} 0 R >>`)
  })
  const xref = offset
  put(`xref\n0 ${totalObjs + 1}\n`)
  put('0000000000 65535 f \n')
  for (let n = 1; n <= totalObjs; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks, { type: 'application/pdf' })
}

function pdfFooter(ctx, { pageW, pageH, margin, pageNo, totalPages }) {
  ctx.textBaseline = 'alphabetic'
  ctx.font = `13px ${PDF_FONT}`
  ctx.fillStyle = '#9A9AA2'
  ctx.textAlign = 'left'
  ctx.fillText('豆玩 DOUWAN · 拼豆分板图纸', margin, pageH - 24)
  ctx.textAlign = 'right'
  ctx.fillText(`第 ${pageNo} / ${totalPages} 页`, pageW - margin, pageH - 24)
  ctx.textAlign = 'left'
}

/** 每块板一页的版式：板图缩放、图例分栏与续页数都在这里先算出来 */
function planPdfBoardPage({ board, bmats, pageW, pageH, margin, cell, ruler, includeLegend }) {
  const img = boardImagePx(board, cell, ruler)
  const top = margin + 86
  const maxW = pageW - margin * 2
  const maxH = pageH - top - margin - 120
  const scale = Math.min(1, maxW / img.w, maxH / img.h)
  const dw = Math.max(1, Math.round(img.w * scale))
  const dh = Math.max(1, Math.round(img.h * scale))
  const legendTop = top + dh + 28
  const availH = pageH - margin - 46 - legendTop
  const fontSize = 15
  const lineH = 27
  const chip = 15
  const entries = includeLegend
    ? bmats.map(m => {
      const brand = m.brandId ? ((getBrand(m.brandId) || {}).name || '') : ''
      return {
        hex: m.hex,
        text: `${brand ? brand + ' · ' : ''}${m.code}${m.name ? ' ' + m.name : ''} × ${m.count.toLocaleString()} 颗`
      }
    })
    : []
  let cols = 1
  let colW = maxW
  let rowsPerPage = 0
  let rowsTotal = 0
  let legendPages = 0
  if (entries.length) {
    const mctx = document.createElement('canvas').getContext('2d')
    mctx.font = `${fontSize}px ${PDF_FONT}`
    const maxText = entries.reduce((mx, e) => Math.max(mx, mctx.measureText(e.text).width), 0)
    cols = Math.max(1, Math.min(3, Math.floor(maxW / (chip + 10 + maxText + 24))))
    colW = maxW / cols
    rowsPerPage = Math.max(1, Math.floor(availH / lineH))
    rowsTotal = Math.ceil(entries.length / cols)
    legendPages = Math.max(1, Math.ceil(rowsTotal / rowsPerPage))
  }
  return { img, scale, dw, dh, top, legendTop, cols, colW, rowsPerPage, legendPages, entries, fontSize, lineH, chip }
}

function drawPdfLegend(ctx, entries, plan, x0, y0) {
  ctx.font = `${plan.fontSize}px ${PDF_FONT}`
  ctx.textBaseline = 'middle'
  entries.forEach((e, i) => {
    const col = i % plan.cols
    const row = Math.floor(i / plan.cols)
    const x = x0 + col * plan.colW
    const y = y0 + row * plan.lineH + plan.lineH / 2
    ctx.fillStyle = e.hex
    ctx.fillRect(x, y - 7, 14, 14)
    ctx.strokeStyle = 'rgba(28,28,32,.16)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y - 6.5, 13, 13)
    ctx.fillStyle = '#1B1B1F'
    ctx.fillText(e.text, x + 22, y)
  })
}

function drawPdfBoardHeader(ctx, { board, bmats, total, pageW, margin, continuation = false }) {
  const bBeads = bmats.reduce((sum, m) => sum + m.count, 0)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#1B1B1F'
  ctx.font = `800 34px ${PDF_FONT}`
  ctx.fillText(
    continuation ? `第 ${board.no} / ${total} 板 · 色号图例（续）` : `第 ${board.no} / ${total} 板`,
    margin,
    margin + 36
  )
  ctx.textAlign = 'right'
  ctx.fillStyle = '#4B423C'
  ctx.font = `700 17px ${PDF_FONT}`
  ctx.fillText(`本板 ${bBeads.toLocaleString()} 颗 · ${bmats.length} 色`, pageW - margin, margin + 36)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#8B8B93'
  ctx.font = `15px ${PDF_FONT}`
  ctx.fillText(
    `全图 ${board.x0 + 1}–${board.x0 + board.w} 列 · ${board.y0 + 1}–${board.y0 + board.h} 行（单板沿用同一套全局列 / 行号）`,
    margin,
    margin + 62
  )
}

/**
 * 分板电子档 PDF：封面 + 每板一页 + 材料清单，直接下载 .pdf。
 *
 * 与 printPattern 的区别只有一个：不弹打印窗口。用户在「分板交付」里点一下，
 * 浏览器就落一个文件；要 1:1 打印仍然用「分板 PDF（打印）」那条。
 */
export async function exportBoardPdf(pattern, {
  projectName = '豆玩 DOUWAN',
  orientation = 'portrait',
  ruler = true,
  codes = true,
  grid = true,
  includeLegend = true,
  includeMaterials = true,
  boardSize = null,
  inventoryMap = null,
  onProgress = null
} = {}) {
  if (!pattern || !pattern.width || !pattern.height) {
    return { ok: false, message: '还没有图纸，先生成一张再导出。' }
  }
  if (typeof CompressionStream === 'undefined' || typeof Blob === 'undefined') {
    return { ok: false, message: '当前浏览器不支持直接生成 PDF 电子档，请改用「分板 PNG（ZIP）」或「分板 PDF（打印）」。' }
  }
  const layout = boardLayout(pattern.width, pattern.height, boardOfExport(pattern, boardSize))
  const boards = layout.boards
  if (!boards.length) return { ok: false, message: '当前图纸没有可用的分板。' }
  if (boards.length > PRINT_MAX_BOARDS) {
    return {
      ok: false,
      message: `分板电子档最多 ${PRINT_MAX_BOARDS} 页，当前需要 ${boards.length} 页。请减少画布尺寸，或改用「分板 PNG（ZIP）」分批导出。`
    }
  }

  const bead = beadOfPattern(pattern)
  const mats = materialList(pattern, inventoryMap)
  const { ptW, ptH, w: pageW, h: pageH } = pdfPageSize(orientation)
  const margin = Math.round((10 / 25.4) * PDF_DPI)
  const cell = Math.max(6, Math.round((bead.mm / 25.4) * PDF_DPI))
  const boardMats = boards.map(b => boardMaterials(pattern, b, inventoryMap))
  const plans = boards.map((b, i) => planPdfBoardPage({
    board: b, bmats: boardMats[i], pageW, pageH, margin, cell, ruler, includeLegend
  }))

  /* 材料清单页数：先算出来，页脚才能写「第 N / 共 M 页」 */
  const matTop = margin + 78
  const matRowH = 30
  const matRowsPerPage = Math.max(1, Math.floor((pageH - matTop - margin - 60) / matRowH))
  const matPages = includeMaterials && mats.rows.length ? Math.ceil(mats.rows.length / matRowsPerPage) : 0
  const totalPages = 1 + plans.reduce((sum, p) => sum + Math.max(1, p.legendPages), 0) + matPages

  const pages = []
  let pageNo = 0
  const addPage = async canvas => {
    pageNo++
    pdfFooter(canvas.ctx, { pageW, pageH, margin, pageNo, totalPages })
    pages.push(await encodePdfPage(canvas.c))
    /* 编码完立刻释放后备缓冲：256 页 × 6.5 MB 全留在内存里会把标签页撑爆 */
    canvas.c.width = 0
    canvas.c.height = 0
    if (typeof onProgress === 'function') onProgress({ page: pageNo, total: totalPages })
  }

  /* ---------------------------------------------------------- 封面 */
  {
    const { c, ctx } = pdfCanvas(pageW, pageH)
    const s = pattern.stats || {}
    const artW = pattern.artW || pattern.width
    const artH = pattern.artH || pattern.height
    const cmW = (artW * bead.cm).toFixed(1)
    const cmH = (artH * bead.cm).toFixed(1)
    /* 封面页眉用与整图导出同一套标版（Logo + 浅绿网址胶囊 + Slogan / 四圆点） */
    const coverScale = (pageW - margin * 2) / 1085
    const headerH = drawTemplateHeader(ctx, { x: margin, y: margin, width: pageW - margin * 2, scale: coverScale })
    const titleY = margin + headerH + 44
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#1B1B1F'
    ctx.font = `800 46px ${PDF_FONT}`
    ctx.fillText(fitCanvasText(ctx, projectName, pageW - margin * 2), margin, titleY)
    ctx.fillStyle = '#8B8B93'
    ctx.font = `600 20px ${PDF_FONT}`
    ctx.fillText('豆玩 DOUWAN · 拼豆分板图纸（电子档）', margin, titleY + 38)
    ctx.strokeStyle = '#E9EAEE'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(margin, titleY + 58)
    ctx.lineTo(pageW - margin, titleY + 58)
    ctx.stroke()

    const boxTop = titleY + 86
    const boxH = Math.max(240, Math.min(660, pageH - boxTop - 430))
    const boxW = pageW - margin * 2
    ctx.fillStyle = '#F7F8FA'
    ctx.fillRect(margin, boxTop, boxW, boxH)
    ctx.strokeStyle = '#E9EAEE'
    ctx.lineWidth = 1
    ctx.strokeRect(margin + 0.5, boxTop + 0.5, boxW - 1, boxH - 1)
    try {
      const preview = renderToCanvas(pattern, 640).canvas
      const k = Math.min((boxW - 40) / preview.width, (boxH - 40) / preview.height)
      const dw = Math.max(1, Math.round(preview.width * k))
      const dh = Math.max(1, Math.round(preview.height * k))
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(preview, margin + (boxW - dw) / 2, boxTop + (boxH - dh) / 2, dw, dh)
    } catch {
      /* 预览画不出来不影响正文 */
    }

    const statsTop = boxTop + boxH + 48
    const facts = [
      ['画布格数', `${pattern.width} × ${pattern.height} 格`],
      ['成品尺寸', `${cmW} × ${cmH} cm`],
      ['颜色数', `${mats.colorCount} 色`],
      ['总豆数', `${mats.totalBeads.toLocaleString()} 颗`],
      ['拼板', `${layout.count} 块 · ${boardLabelOf(pattern, boardSize)}`],
      ['豆子规格', `${bead.label}（1 格 = ${bead.mm} mm）`]
    ]
    const factCols = 3
    const factW = (pageW - margin * 2) / factCols
    const factH = 82
    facts.forEach((f, i) => {
      const col = i % factCols
      const row = Math.floor(i / factCols)
      const x = margin + col * factW
      const y = statsTop + row * factH
      ctx.fillStyle = '#1B1B1F'
      ctx.font = `800 26px ${PDF_FONT}`
      ctx.fillText(f[1], x, y)
      ctx.fillStyle = '#8B8B93'
      ctx.font = `14px ${PDF_FONT}`
      ctx.fillText(f[0], x, y + 26)
    })

    const noteTop = statsTop + Math.ceil(facts.length / factCols) * factH + 22
    ctx.fillStyle = '#6B6B73'
    ctx.font = `14px ${PDF_FONT}`
    const note = `本文件是直接下载的电子档 PDF，不经过浏览器打印窗口。分板按 1 格 = ${bead.mm} mm 排版；` +
      `如需 1:1 打印，请用「分板 PDF（打印）」并选择「实际大小 / 100%」，不要勾选「适合页面」。`
    wrapCanvasText(ctx, note, pageW - margin * 2).slice(0, 6).forEach((line, i) => {
      ctx.fillText(line, margin, noteTop + i * 24)
    })
    ctx.fillStyle = '#9A9AA2'
    ctx.font = `13px ${PDF_FONT}`
    ctx.fillText(`生成日期：${new Date().toLocaleDateString('zh-CN')}`, margin, noteTop + 6 * 24 + 6)
    await addPage({ c, ctx })
  }

  /* ---------------------------------------------------------- 每板一页 */
  for (let i = 0; i < boards.length; i++) {
    const board = boards[i]
    const bmats = boardMats[i]
    const plan = plans[i]
    const chunks = Math.max(1, plan.legendPages)
    for (let chunk = 0; chunk < chunks; chunk++) {
      const { c, ctx } = pdfCanvas(pageW, pageH)
      drawPdfBoardHeader(ctx, { board, bmats, total: boards.length, pageW, margin, continuation: chunk > 0 })
      if (chunk === 0) {
        try {
          const { canvas, host } = createExportCanvas()
          const info = drawBoard(host, pattern, board, {
            cell, codes, ruler, grid, boardSize: boardOfExport(pattern, boardSize)
          })
          if (info) {
            const dx = Math.round((pageW - plan.dw) / 2)
            ctx.imageSmoothingEnabled = plan.scale < 1
            ctx.drawImage(canvas, dx, plan.top, plan.dw, plan.dh)
          }
        } catch {
          /* 单板图失败也继续出后面的页，别让整份电子档生不出来 */
        }
        drawPdfLegend(
          ctx,
          plan.entries.slice(0, plan.rowsPerPage * plan.cols),
          plan,
          margin,
          plan.legendTop
        )
      } else {
        const perPage = plan.rowsPerPage * plan.cols
        const start = chunk * perPage
        drawPdfLegend(ctx, plan.entries.slice(start, start + perPage), plan, margin, margin + 96)
      }
      await addPage({ c, ctx })
    }
  }

  /* ---------------------------------------------------------- 材料清单 */
  if (matPages) {
    const colDefs = [
      { key: 'sw', w: 46, label: '色块', align: 'left' },
      { key: 'brand', w: 300, label: '品牌/系列', align: 'left' },
      { key: 'code', w: 150, label: '色号', align: 'left' },
      { key: 'name', w: 0, label: '颜色', align: 'left' },
      { key: 'count', w: 120, label: '需要', align: 'right' }
    ]
    const contentW = pageW - margin * 2
    const fixed = colDefs.reduce((sum, d) => sum + d.w, 0)
    colDefs[3].w = Math.max(120, contentW - fixed)
    const xs = []
    let acc = margin
    colDefs.forEach(d => { xs.push(acc); acc += d.w })

    for (let p = 0; p < matPages; p++) {
      const { c, ctx } = pdfCanvas(pageW, pageH)
      const start = p * matRowsPerPage
      const slice = mats.rows.slice(start, start + matRowsPerPage)
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.fillStyle = '#1B1B1F'
      ctx.font = `800 30px ${PDF_FONT}`
      ctx.fillText(
        p === 0
          ? `材料清单 · 共 ${mats.colorCount} 色 · 共 ${mats.totalBeads.toLocaleString()} 颗`
          : '材料清单（续）',
        margin,
        margin + 40
      )
      ctx.fillStyle = '#F4F5F7'
      ctx.fillRect(margin, matTop - 22, contentW, 32)
      ctx.font = `600 13px ${PDF_FONT}`
      ctx.fillStyle = '#6B6B73'
      colDefs.forEach((d, ci) => {
        ctx.textAlign = d.align === 'right' ? 'right' : 'left'
        ctx.fillText(d.label, d.align === 'right' ? xs[ci] + d.w - 6 : xs[ci] + 6, matTop)
      })
      ctx.textAlign = 'left'
      slice.forEach((r, ri) => {
        const y = matTop + 22 + ri * matRowH
        ctx.strokeStyle = '#E9EAEE'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(margin, y + matRowH - 0.5)
        ctx.lineTo(pageW - margin, y + matRowH - 0.5)
        ctx.stroke()
        ctx.fillStyle = r.hex
        ctx.fillRect(xs[0] + 6, y + 7, 16, 16)
        ctx.strokeStyle = 'rgba(28,28,32,.16)'
        ctx.strokeRect(xs[0] + 6.5, y + 7.5, 15, 15)
        ctx.fillStyle = '#1B1B1F'
        ctx.font = `15px ${PDF_FONT}`
        ctx.fillText(fitCanvasText(ctx, r.brandId ? ((getBrand(r.brandId) || {}).name || '') : '', colDefs[1].w - 12), xs[1] + 6, y + 21)
        ctx.fillText(r.code, xs[2] + 6, y + 21)
        ctx.fillText(fitCanvasText(ctx, r.name || '—', colDefs[3].w - 12), xs[3] + 6, y + 21)
        ctx.textAlign = 'right'
        ctx.fillText(`${r.count.toLocaleString()} 颗`, xs[4] + colDefs[4].w - 6, y + 21)
        ctx.textAlign = 'left'
      })
      if (p === matPages - 1) {
        ctx.fillStyle = '#9A9AA2'
        ctx.font = `13px ${PDF_FONT}`
        const noteY = Math.min(matTop + 22 + slice.length * matRowH + 26, pageH - margin - 50)
        ctx.fillText('颜色用量按当前图纸逐格统计，与图上的色号一致。', margin, noteY)
      }
      await addPage({ c, ctx })
    }
  }

  const blob = buildPdfBlob(pages, { ptW, ptH })
  downloadBlob(blob, `${safeName(projectName)}-分板图纸.pdf`)
  const mb = (blob.size / 1048576).toFixed(1)
  return {
    ok: true,
    pages: totalPages,
    size: blob.size,
    message: `分板电子档已下载：${totalPages} 页 PDF（约 ${mb} MB，${boards.length} 块板 + 材料清单）`
  }
}

/* ------------------------------------------------------------------ 分享卡 */

/**
 * 分享卡（PRD §21）：原图 → 拼豆图 → 成品占位 + 作品数据。
 * 输出 1080×1350 竖版 PNG，适合小红书 / 抖音。
 */
export function exportShareCard(pattern, {
  projectName = '豆玩 DOUWAN',
  sourceImage = null,
  /** 成品照片（完成作品时上传的那张，Image 对象）：有就画进第三格 */
  finishImage = null,
  stats = null,
  author = '',
  brandName = '',
  buildPercent = null
} = {}) {
  const W = 1080
  const H = 1350
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#FFF7F3')
  bg.addColorStop(0.45, '#FFFFFF')
  bg.addColorStop(1, '#EAF9FC')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 卡片
  const pad = 60
  const cardX = pad
  const cardY = 300
  const cardW = W - pad * 2
  ctx.save()
  ctx.shadowColor = 'rgba(28,28,32,.12)'
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 14
  ctx.fillStyle = '#FFFFFF'
  roundRectPath(ctx, cardX, cardY, cardW, 780, 36)
  ctx.fill()
  ctx.restore()

  // 品牌头
  ctx.fillStyle = '#1B1B1F'
  ctx.font = '800 46px -apple-system,"PingFang SC","Microsoft YaHei",Arial'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('豆玩 DOUWAN', pad, 130)
  ctx.fillStyle = '#9A9AA2'
  ctx.font = '700 22px -apple-system,Arial'
  ctx.fillText('DOUWAN BEAD STUDIO', pad, 166)

  ctx.fillStyle = '#1B1B1F'
  ctx.font = '850 62px -apple-system,"PingFang SC","Microsoft YaHei",Arial'
  const title = fitText(ctx, projectName, cardW - 80, 62, 850)
  ctx.fillText(title, pad, 246)
  ctx.fillStyle = '#E23A20'
  ctx.font = '700 24px -apple-system,"PingFang SC",Arial'
  ctx.fillText('我的拼豆作品', pad, 246)

  // 三图：原图 / 拼豆图 / 成品（有成品照片就画照片，没有才留占位）
  const boxW = 280
  const boxH = 280
  const gap = (cardW - boxW * 3) / 4
  const top = cardY + 60
  const labels = ['原图', '拼豆图', '成品']
  const boxes = []
  let patternScaled = false

  for (let i = 0; i < 3; i++) {
    const x = cardX + gap + i * (boxW + gap)
    boxes.push({ x, y: top, w: boxW, h: boxH })
    ctx.save()
    roundRectPath(ctx, x, top, boxW, boxH, 22)
    ctx.clip()
    ctx.fillStyle = '#F7F8FA'
    ctx.fillRect(x, top, boxW, boxH)
    if (i === 0 && sourceImage) {
      drawContain(ctx, sourceImage, x, top, boxW, boxH)
    } else if (i === 1) {
      patternScaled = drawPatternContain(ctx, pattern, x, top, boxW, boxH)
    } else if (i === 2 && finishImage) {
      drawCover(ctx, finishImage, x, top, boxW, boxH)
    }
    ctx.restore()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#E9EAEE'
    roundRectPath(ctx, x, top, boxW, boxH, 22)
    ctx.stroke()

    ctx.fillStyle = '#8B8B93'
    ctx.font = '700 22px -apple-system,"PingFang SC",Arial'
    ctx.textAlign = 'center'
    ctx.fillText(labels[i], x + boxW / 2, top + boxH + 40)
    ctx.textAlign = 'left'
  }

  // 成品占位提示（只有没上传成品照片时才需要）
  if (!finishImage) {
    const ph = boxes[2]
    ctx.save()
    ctx.strokeStyle = '#E4E5E9'
    ctx.lineWidth = 3
    ctx.setLineDash([12, 10])
    roundRectPath(ctx, ph.x + 18, ph.y + 18, ph.w - 36, ph.h - 36, 16)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#C8CBD2'
    ctx.font = '700 22px -apple-system,"PingFang SC",Arial'
    ctx.textAlign = 'center'
    ctx.fillText('这里放你拼好的', ph.x + ph.w / 2, ph.y + ph.h / 2 - 6)
    ctx.fillText('实物照片', ph.x + ph.w / 2, ph.y + ph.h / 2 + 28)
    ctx.textAlign = 'left'
  }

  // 数据区
  const s = stats || pattern.stats || {}
  const facts = [
    ['尺寸', `${pattern.width} × ${pattern.height}`],
    ['颜色', `${s.colorCount || pattern.palette.length} 色`],
    ['豆子', `${(s.beadCount || 0).toLocaleString()} 颗`],
    ['还原度', `${Math.round((s.similarity || 0) * 100)}%`],
    ['可拼性', `${Math.round((s.buildability || 0) * 100)}`],
    ['预计用时', formatMin(s.estimatedMinutes)]
  ]
  const gx = cardX + 50
  const gy = top + boxH + 86
  const cw = (cardW - 100) / 3
  facts.forEach((f, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = gx + col * cw
    const y = gy + row * 118
    ctx.fillStyle = '#F7F8FA'
    roundRectPath(ctx, x, y, cw - 18, 100, 18)
    ctx.fill()
    ctx.fillStyle = '#1B1B1F'
    ctx.font = '850 38px -apple-system,"PingFang SC",Arial'
    ctx.fillText(f[1], x + 22, y + 52)
    ctx.fillStyle = '#8B8B93'
    ctx.font = '700 20px -apple-system,"PingFang SC",Arial'
    ctx.fillText(f[0], x + 22, y + 82)
  })

  // 底部
  ctx.fillStyle = '#8B8B93'
  ctx.font = '600 24px -apple-system,"PingFang SC",Arial'
  const footBits = []
  if (brandName) footBits.push(brandName)
  if (author) footBits.push('@' + author)
  if (buildPercent != null && buildPercent > 0) footBits.push(`已完成 ${buildPercent}%`)
  if (!footBits.length) footBits.push('用豆玩 DOUWAN 生成 · 把喜欢的东西拼成自己的作品')
  ctx.fillText(footBits.join('　·　'), pad, H - 70)

  ctx.fillStyle = '#E23A20'
  ctx.font = '800 24px -apple-system,"PingFang SC",Arial'
  ctx.fillText(SITE_URL_TEXT, W - pad - ctx.measureText(SITE_URL_TEXT).width, H - 70)

  c.toBlob(blob => {
    if (blob) downloadBlob(blob, `${safeName(projectName)}-分享卡.png`)
  }, 'image/png')
  // 卡面是 1080×1350 的固定尺寸，图纸再大也不会撑爆内存；只有「拼豆图」那一格是缩略展示，
  // 大画布上要如实说清楚，不然用户会拿卡面去数格子
  return {
    ok: true,
    message: patternScaled
      ? `分享卡已生成（1080×1350）；${pattern.width}×${pattern.height} 格在卡面上按缩略图展示，要看格子请用「图纸 PNG」`
      : '分享卡已生成（1080×1350）'
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawContain(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const k = Math.min(w / iw, h / ih)
  const dw = iw * k
  const dh = ih * k
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

/** 成品照片按「填满并居中裁切」画（照片是实物拍摄，留白比裁掉更难看） */
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const k = Math.max(w / iw, h / ih)
  const dw = iw * k
  const dh = ih * k
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

/**
 * 把图纸按「contain」画进一个方框（分享卡 / 对照图用）。
 *
 * 小图纸沿用逐格直绘（整数倍放大，1 格 = scale px 的实心方块，和以前逐像素一致）。
 * 大图纸不能这么干：以前那行 `Math.max(1, floor(...))` 会把 300/450 格的图纸钉在 1 px/格上，
 * 而方框只有 280 px（分享卡），于是整张图被「居中裁切」—— 卡面上只剩正中间一块，
 * 用户看到的拼豆图和图纸不是一回事。这里改成先渲一张 1 格 = 1 像素的底图再平滑缩放：
 * 整张图都会落在方框里，也省掉了 20 万次 fillRect。
 * @returns {boolean} 是否走了缩放路径（调用方据此如实告知「按缩略图展示」）
 */
function drawPatternContain(ctx, pattern, x, y, w, h) {
  const scale = Math.floor(Math.min(w / pattern.width, h / pattern.height))
  if (scale >= 1) {
    const pw = pattern.width * scale
    const ph = pattern.height * scale
    const ox = x + (w - pw) / 2
    const oy = y + (h - ph) / 2
    for (let yy = 0; yy < pattern.height; yy++) {
      for (let xx = 0; xx < pattern.width; xx++) {
        const k = pattern.cells[yy * pattern.width + xx]
        const c = k < 0 ? null : pattern.palette[k]
        if (!c) {
          if (k < 0) {
            ctx.fillStyle = EMPTY_FILL
            ctx.fillRect(ox + xx * scale, oy + yy * scale, scale, scale)
          }
          continue
        }
        ctx.fillStyle = c.hex
        ctx.fillRect(ox + xx * scale, oy + yy * scale, scale, scale)
      }
    }
    return false
  }

  // 底图固定 1 格 = 1 像素（dpr: 1）：450 格也就是 450×450×4B = 810 KB，
  // 与图纸本身的规模无关，不存在放大到卡面尺寸的内存问题
  const { canvas: off, width: ow, height: oh } = renderToCanvas(pattern, Math.max(pattern.width, pattern.height), { dpr: 1 })
  if (!ow || !oh) return false
  const k = Math.min(w / ow, h / oh)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(off, x + (w - ow * k) / 2, y + (h - oh * k) / 2, ow * k, oh * k)
  return true
}

function fitText(ctx, text, maxWidth, size, weight) {
  let t = String(text || '')
  ctx.font = `${weight} ${size}px -apple-system,"PingFang SC","Microsoft YaHei",Arial`
  if (ctx.measureText(t).width <= maxWidth) return t
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

/* ------------------------------------------------------------------ 对照图 */

/** 原图 ↔ 拼豆图对照 PNG（PRD §2.1 爽点 B，短视频前后对比素材） */
export function exportComparePNG(pattern, { projectName = '豆玩 DOUWAN', sourceImage = null, width = 1600 } = {}) {
  const half = Math.floor(width / 2) - 30
  const c = document.createElement('canvas')
  c.width = width
  c.height = half + 120
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, c.width, c.height)

  const boxes = [
    { x: 20, label: '原图' },
    { x: width / 2 + 10, label: '拼豆图' }
  ]
  boxes.forEach((b, i) => {
    ctx.save()
    roundRectPath(ctx, b.x, 42, half, half, 20)
    ctx.clip()
    ctx.fillStyle = '#F7F8FA'
    ctx.fillRect(b.x, 42, half, half)
    if (i === 0 && sourceImage) drawContain(ctx, sourceImage, b.x, 42, half, half)
    else if (i === 1) drawPatternContain(ctx, pattern, b.x, 42, half, half)
    ctx.restore()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#E9EAEE'
    roundRectPath(ctx, b.x, 42, half, half, 20)
    ctx.stroke()
    ctx.fillStyle = '#1B1B1F'
    ctx.font = '800 26px -apple-system,"PingFang SC",Arial'
    ctx.fillText(b.label, b.x, 34)
  })

  ctx.fillStyle = '#8B8B93'
  ctx.font = '700 24px -apple-system,"PingFang SC",Arial'
  ctx.fillText(`${projectName}　${pattern.width}×${pattern.height}　${pattern.palette.length} 色　${(pattern.stats?.beadCount || 0).toLocaleString()} 颗`, 20, c.height - 24)

  c.toBlob(blob => {
    if (blob) downloadBlob(blob, `${safeName(projectName)}-原图对照.png`)
  }, 'image/png')
  // 画布固定 1600 宽，两个格子各 (1600/2-30)=770 px：450×450 的图纸也能整张放进格子，
  // 不需要缩放或拒绝；只是这种尺寸下 1 格 = 1 px，画一次要遍历 20 万格（数百毫秒），如实报出尺寸即可
  return { ok: true, width: c.width, height: c.height, message: `原图对照 PNG 已导出：${c.width}×${c.height} 像素` }
}
