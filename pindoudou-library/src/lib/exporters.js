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
import { normalizeBoardSize, beadOf } from './boardSpec.js'

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
  return `${b.x} × ${b.y} 插钉`
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
export function pngExportPlan(pattern, wantedCell = 24, { ruler = true } = {}) {
  for (let cell = wantedCell; cell >= 1; cell--) {
    const geometry = chartGeometry(pattern, { cell, ruler })
    if (geometry.width <= PNG_MAX_SIDE && geometry.height <= PNG_MAX_SIDE && geometry.width * geometry.height <= PNG_MAX_PIXELS) {
      return { cell, geometry, reduced: cell < wantedCell }
    }
  }
  return { cell: 1, geometry: chartGeometry(pattern, { cell: 1, ruler }), reduced: true }
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
  if (opts.includeLegend) extras.push('颜色图例')
  if (opts.includeStats) extras.push('材料统计')
  if (extras.length) bits.push('包含 ' + extras.join(' / '))
  if (opts.format === 'jpg' && opts.background === 'transparent') bits.push('JPG 不支持透明，已自动铺白底')
  if (opts.format === 'png' && opts.background === 'transparent' && !opts.includeLegend) {
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
 * 把图纸和图例 / 材料统计拼到同一张画布（需求 §4.7）。
 *
 * 图例按可用宽度自动分栏；每行是「色块 + 色号 + 颜色名 + 品牌 + 数量」，
 * 标题行给出总豆数与颜色数。透明背景只在没有图例时保留；
 * 有图例时图例区域铺白底，否则文字在透明背景上不可读。
 *
 * 需求 §4.7 明确要求图例里能看到「品牌 / 系列」：同色号在不同品牌之间不能通用，
 * 只写色号会让用户拿错豆子。这里按 materialList 的 brandId 查品牌名。
 */
function composeChartWithLegend(pattern, chartCanvas, plan, {
  includeLegend = true,
  includeStats = true,
  background = '#ffffff'
} = {}) {
  const g = plan.geometry
  const mats = materialList(pattern, null)
  const pad = 24
  const headerH = 44
  const rowH = 32
  const width = Math.max(g.width, 720)
  const cols = Math.max(1, Math.min(4, Math.floor((width - pad * 2) / 260)))
  const rows = includeLegend ? Math.ceil(mats.rows.length / cols) : 0
  const statsH = includeStats ? 28 : 0
  const extraH = pad + headerH + rows * rowH + statsH + pad
  const out = document.createElement('canvas')
  out.width = width
  out.height = g.height + extraH
  const ctx = out.getContext('2d')
  const transparent = background === 'transparent' || background === 'rgba(0,0,0,0)'
  ctx.fillStyle = transparent ? 'rgba(0,0,0,0)' : background
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(chartCanvas, 0, 0)

  const ly = g.height
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, ly, width, extraH)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1B1B1F'
  ctx.font = '700 16px -apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'
  ctx.fillText(`${includeLegend ? '材料清单' : '材料统计'} · ${mats.colorCount} 色 · 共 ${mats.totalBeads.toLocaleString()} 颗`, pad, ly + pad + 8)
  if (includeStats) {
    const empty = pattern.stats && pattern.stats.emptyCount
    ctx.font = '12px -apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'
    ctx.fillStyle = '#6B6B73'
    ctx.fillText(
      `${pattern.width}×${pattern.height} 格${empty ? ` · 空白 ${empty.toLocaleString()} 格（不计豆数）` : ''} · 材料统计与图上的色号一致`,
      pad, ly + pad + 30
    )
  }
  if (includeLegend) {
    const colW = (width - pad * 2) / cols
    ctx.font = '12px -apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'
    mats.rows.forEach((r, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = pad + col * colW
      const y = ly + pad + headerH + row * rowH
      ctx.fillStyle = r.hex
      ctx.fillRect(x, y - 8, 16, 16)
      ctx.strokeStyle = 'rgba(28,28,32,.16)'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y - 8, 16, 16)
      ctx.fillStyle = '#1B1B1F'
      const name = r.name ? ` ${r.name}` : ''
      ctx.fillText(`${r.code}${name}`, x + 23, y - 5)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#6B6B73'
      ctx.fillText(String(r.count), x + colW - 12, y - 5)
      ctx.textAlign = 'left'
      const brandName = (getBrand(r.brandId) || {}).name || ''
      ctx.font = '10px -apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'
      ctx.fillStyle = '#8A8A93'
      ctx.fillText(brandName, x + 23, y + 9)
      ctx.font = '12px -apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'
    })
  }
  return out
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
  /* 默认只出图纸主体，保持 `exportPatternPNG` 原有尺寸契约；
     需要「图纸 + 图例 / 统计」的调用方（编辑器导出设置）显式传 true。 */
  includeLegend = false,
  includeStats = false,
  background = '#ffffff'
} = {}) {
  const opts = { format, ruler, grid, codes, includeLegend, includeStats, background }
  const plan = pngExportPlan(pattern, cell, { ruler })
  const g = plan.geometry
  const { canvas, host } = createExportCanvas()
  /* JPG 没有透明通道：无论用户选了什么背景，都铺白，避免出现黑底。 */
  const bg = format === 'jpg'
    ? '#ffffff'
    : (background === 'transparent' ? 'rgba(0,0,0,0)' : background)
  // 不把几何对象直传进去：画什么由 opts 里的 codes/grid 决定，让 drawChart 自己算几何，
  // 两边用的是同一个 chartGeometry，算出来必然一致（传 geo 反而要连 opts 一起打包）
  drawChart(host, pattern, {
    cell: plan.cell,
    ruler,
    grid,
    codes,
    bold: true,
    boardLines: true,
    boardLabels: true,
    background: bg,
    /* 透明导出时空格也留空，否则空白区会被铺成浅灰、整张图没有 alpha */
    emptyFill: bg === 'rgba(0,0,0,0)' ? null : undefined
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
  const out = (includeLegend || includeStats)
    ? composeChartWithLegend(pattern, canvas, plan, { includeLegend, includeStats, background: bg })
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
 * 分板图片组：每块板一张 PNG / JPG，打成一个 ZIP。
 * 命名稳定（图纸名_第01板_300dpi.png），板号按全图顺序，不随本次勾选变化。
 * JPG 的空白区由 drawBoard 铺白底，不会出现透明变黑。
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
  boardSize = null
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
    const out = document.createElement('canvas')
    out.width = info.width
    out.height = info.height + bannerH
    const octx = out.getContext('2d')
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.fillStyle = '#1B1B1F'
    octx.font = `700 ${Math.max(12, Math.round(plan.cell * 0.8))}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
    octx.textBaseline = 'middle'
    const colorCount = boardMaterials(pattern, b, null).length
    const caption = `第 ${b.no} 板 · 全图第 ${b.x0 + 1}–${b.x0 + b.w} 列 / 第 ${b.y0 + 1}–${b.y0 + b.h} 行 · 本板 ${beadCounts[b.index] || 0} 颗 · ${colorCount} 色`
    octx.fillText(caption, Math.max(8, Math.round(plan.cell * 0.3)), Math.round(bannerH / 2))
    octx.drawImage(canvas, 0, bannerH)

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
      // PNG 的尺寸在这里现算一次，免得文案里写死「4000×4000」而实际是别的数字（1000 格就是 3026×3026）。
      const png = pngExportPlan(pattern, 24).geometry
      return {
        ok: false,
        bytes: estPlain,
        message: `SVG 未导出：${size}的矢量图估算约 ${mb(estPlain)} MB${codes ? `（带色号约 ${mb(est)} MB）` : ''}，` +
          `超过单文件 ${mb(SVG_SINGLE_BYTES)} MB 的安全线（硬上限 ${mb(SVG_MAX_BYTES)} MB）。` +
          `原因：SVG 一格一个 <rect>，这张图纸要画 ${drawnBeadCount(pattern).toLocaleString()} 个图元（${size}最多 ${(pattern.width * pattern.height).toLocaleString()} 格），` +
          '浏览器光解析这些图元就会长时间卡住，字符串本身在内存里还要翻倍。' +
          `整张图纸请用「图纸 PNG」（这张画布导出 ${png.width}×${png.height} 像素）；1:1 分页打印请用「分板 PDF」。`
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
    const cmW = (pattern.width * cm).toFixed(0)
    const cmH = (pattern.height * cm).toFixed(0)
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
 * 图例 / 材料统计拼在图纸下方会增加的高度。
 *
 * 与 composeChartWithLegend 用同一套排版参数；两处必须一起改，
 * 否则「预检说 1716×1716、实际文件 1716×1900」又会回来。
 */
function legendExtraHeight(pattern, { width, includeLegend = false, includeStats = false }) {
  if (!includeLegend && !includeStats) return 0
  const mats = materialList(pattern, null)
  const pad = 24
  const headerH = 44
  const rowH = 32
  const cols = Math.max(1, Math.min(4, Math.floor((width - pad * 2) / 260)))
  const rows = includeLegend ? Math.ceil(mats.rows.length / cols) : 0
  const statsH = includeStats ? 28 : 0
  return pad + headerH + rows * rowH + statsH + pad
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
    let cell = wantCell
    let geo = chartGeometry(pattern, { cell, ruler })
    let extraH = legendExtraHeight(pattern, { width: geo.width, includeLegend, includeStats })
    while (cell > 1 && !fitsCanvas({ width: geo.width, height: geo.height + extraH })) {
      cell--
      geo = chartGeometry(pattern, { cell, ruler })
      extraH = legendExtraHeight(pattern, { width: geo.width, includeLegend, includeStats })
    }
    const height = geo.height + extraH
    const capped = cell < wantCell
    const actual = dpiOf(mm, cell)
    const legendNote = extraH
      ? `（图纸主体 ${geo.width}×${geo.height} px + 图例/统计 ${extraH} px）`
      : ''
    return {
      ok: true, mode, requestedDpi: dpi, dpi: actual, cell, capped,
      width: geo.width, height, chartHeight: geo.height, pixels: geo.width * height,
      pages: 1, count: 1, total: layout.count, layout, boards: [],
      message: capped
        ? `请求 ${dpi} DPI（每格 ${wantCell} px）超出单张 ${PNG_MAX_SIDE} px / ${PNG_MAX_PIXELS / 1e4} 万像素上限，实际按 ${actual} DPI（每格 ${cell} px，${geo.width}×${height} px${legendNote}）导出。要 ${dpi} DPI 请改用「分板交付」逐板输出。`
        : `${dpi} DPI · 每格 ${cell} px · ${geo.width}×${height} px${legendNote}`
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
  const bigBoard = boards.reduce((m, b) => (b.w * b.h > m.w * m.h ? b : m), boards[0])
  const reason = []
  if (capped) {
    reason.push(`请求 ${dpi} DPI（每格 ${wantCell} px）时，${bigBoard.w}×${bigBoard.h} 格的板单张需要 ${boardImagePx(bigBoard, wantCell, ruler).w} px，超过 ${PNG_MAX_SIDE} px 单张上限`)
    reason.push(`实际按 ${actual} DPI（每格 ${cell} px，单板最大 ${maxSize.w}×${maxSize.h} px）输出`)
  }
  if (mode === 'pdf' && capped && px <= PRINT_TOTAL_PIXELS) {
    reason.push(`分板 PDF 还要把全部 ${boards.length} 张板图同时留在打印文档里，实际板图解码约 ${Math.round(px * 4 / 1048576)} MB`)
  }
  return {
    ok: true, mode, requestedDpi: dpi, dpi: actual, cell, capped,
    width: maxSize.w, height: maxSize.h, pixels: px,
    pages: boards.length, count: boards.length, total: layout.count,
    layout, boards,
    message: capped
      ? `${reason.join('；')}。共 ${boards.length} 页。`
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

  const cmW = (pattern.width * bead.cm).toFixed(1)
  const cmH = (pattern.height * bead.cm).toFixed(1)

  const css = `
  @page { size: A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 10mm; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#1B1B1F;margin:0}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:15px;margin:0 0 8px}
  .meta{font-size:11px;color:#8B8B93;margin-bottom:10px}
  .cover{page-break-after:always;text-align:center;padding-top:10mm}
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
    <h1>${escapeHtml(projectName)}</h1>
    <div class="meta">豆玩 DOUWAN · 拼豆分板图纸${brandName ? ' · ' + escapeHtml(brandName) : ''}</div>
    ${previewUrl
      ? `<img src="${previewUrl}" alt="作品预览">`
      : '<div class="previewFallback">（预览图没画出来，不影响下面的分板页与材料表）</div>'}
    <div class="coverGrid">
      <div><b>${pattern.width} × ${pattern.height}</b><span>格数（1 格 = 1 颗豆）</span></div>
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
            return `<span><i style="background:${m.hex}"></i>${escapeHtml(rowBrand)} · ${escapeHtml(m.code)}${m.name ? ' ' + escapeHtml(m.name) : ''} × ${m.count} 颗${
              m.lack > 0 ? ` <b style="color:#D3244A">缺 ${m.lack} 颗</b>` : ''
            }</span>`
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
  ctx.fillText('douzao.ai', W - pad - ctx.measureText('douzao.ai').width, H - 70)

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
