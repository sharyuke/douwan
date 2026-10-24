/* =========================================================================
   拼豆图纸绘制（Canvas 2D）
   所有绘制入口共用同一套规范：
     · 1 格 = 1 颗豆，每 10 格加粗辅助线
     · 四边坐标标尺
     · 格内印完整色号（H1 / A1 / F1 是三颗不同的豆，只印数字会认错）
     · 底板边界用珊瑚色虚线，角标为板号
     · 边缘中心三角，方便多板拼接对位
   ========================================================================= */

import { inkOn, hexToRgb } from './color.js'
/* 分板规格的归一化 / 推导（52 / 78 / 104 / 120 钉画线板与 29 格老规格）都在 boardSpec.js */
import { normalizeBoardSize } from './boardSpec.js'

/**
 * 「空格」的画法（自动抠背景 / 橡皮擦留下的位置）。
 * 必须和「白色豆」明确区分：白色豆是 #FFFFFF 的实体颗粒，
 * 空格是不放豆的位置。这里统一用极浅灰打底 + 中心一个小点表示"此处不放豆"。
 */
export const EMPTY_FILL = '#EFF1F4'
export const EMPTY_DOT = '#CBD0D8'

function drawEmptyCell(ctx, x, y, cell) {
  ctx.fillStyle = EMPTY_FILL
  ctx.fillRect(x, y, cell, cell)
  if (cell >= 9) {
    const s = Math.max(1, Math.round(cell * 0.14))
    ctx.fillStyle = EMPTY_DOT
    ctx.fillRect(Math.round(x + cell / 2 - s / 2), Math.round(y + cell / 2 - s / 2), s, s)
  }
}

/**
 * 一次「豆子填色」的笔刷状态。
 *
 * 为什么要有它：一格里一个 fillStyle 在 200k 格下是 20 万次状态切换，
 * 换成按颜色批量之后，同色的连续格子不必再重复设色。
 * brush.color 为 null 表示「与上一格同色」—— 调用方格子坐标是连续的，
 * 所以这个判断成立；空格（drawEmptyCell 自己会改 fillStyle）画完必须 reset()。
 */
let brush = { color: null, hex: null }
function resetBrush() {
  brush.color = null
  brush.hex = null
}
function fillCell(ctx, color, hex, x, y, cell) {
  if (color !== brush.color) {
    ctx.fillStyle = hex
    brush.color = color
    brush.hex = hex
  }
  ctx.fillRect(x, y, cell, cell)
}

/** 色板下标 → ABGR 像素值。1 格 = 1 像素的图案层靠它写 ImageData */
function packHex(hex) {
  const [r, g, b] = hexToRgb(hex)
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/**
 * 色板 → 查找表（下标 → { color 用于比对的键, hex, packed }）。
 * 每次绘制都建一次：色板最多几十项，比起逐格判断可以忽略。
 */
function colorLUT(palette) {
  const list = palette || []
  const lut = new Array(list.length)
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (!c) { lut[i] = null; continue }
    lut[i] = { color: c.id || c.hex, hex: c.hex, packed: packHex(c.hex) }
  }
  return lut
}

/**
 * 只画豆子：按颜色分组，一组一条路径。
 * 返回值全部来自「先把同色格子的下标收集起来，再一次性 fill」，
 * 所以它和原来的「逐格 fillRect」在几何上完全等价 —— 20 万格只切几十次 fillStyle。
 */
function paintCells(ctx, gw, gh, cells, lut, ox, oy, cell, emptyFill = EMPTY_FILL) {
  const groups = new Map()
  let emptyCount = 0
  for (let y = 0; y < gh; y++) {
    const row = y * gw
    for (let x = 0; x < gw; x++) {
      const k = cells[row + x]
      if (k < 0) { emptyCount++; continue }
      const c = lut[k]
      if (!c) continue
      let g = groups.get(c.color)
      if (!g) { g = { hex: c.hex, idx: [] }; groups.set(c.color, g) }
      /* 存下标而不是坐标：一条路径里的 rect 必须一次 beginPath 提交，
         坐标留到最后再算，省掉一模一样的中间数组 */
      g.idx.push(row + x)
    }
  }
  resetBrush()
  /* emptyFill = null：空白格不铺色，保留画布 alpha（导出「透明背景 PNG」用） */
  if (emptyCount && emptyFill) {
    ctx.fillStyle = emptyFill
    let open = false
    for (let y = 0; y < gh; y++) {
      const row = y * gw
      for (let x = 0; x < gw; x++) {
        if (cells[row + x] >= 0) continue
        if (!open) { ctx.beginPath(); open = true }
        ctx.rect(ox + x * cell, oy + y * cell, cell, cell)
      }
    }
    if (open) ctx.fill()
  }
  for (const g of groups.values()) {
    ctx.fillStyle = g.hex
    ctx.beginPath()
    const idx = g.idx
    for (let i = 0; i < idx.length; i++) {
      const k = idx[i]
      const x = k % gw
      const y = (k - x) / gw
      ctx.rect(ox + x * cell, oy + y * cell, cell, cell)
    }
    ctx.fill()
  }
}

/* ---------------------------------------------------- 图案层（1 格 = 1 像素的离屏缓存）

   为什么是 1 格 1 像素：大画布上「豆子填色」是重复率最高的一层，
   而网格 / 板号 / 标尺这些装饰层每帧都要按最新的可见区域重画。
   把重复率最高的一层压成一张小位图（450×450 只要 810KB），
   主画布用 drawImage 一次铺开，缩放和开关变化就不必再跑一遍逐格绘制。

   差分：pattern.cells 每次编辑都是一个新的 Int32Array，但里面只有几格变了。
   拿缓存里的像素缓冲直接和新数组比，O(n)（20 万格约 0.2ms）就能给出脏矩形，
   拖笔时每格只更新那一小块，不再每次都重画整张图。
   ------------------------------------------------------------------------- */

/** 元素 → 图案层缓存。WeakMap 是故意的：画布元素没了一整个缓存跟着走 */
const layerCache = new WeakMap()

function getLayer(el, gw, gh) {
  let c = layerCache.get(el)
  if (!c) {
    const canvas = document.createElement('canvas')
    const off = canvas.getContext('2d', { willReadFrequently: true })
    if (!off) return null
    c = { canvas, off, gw: 0, gh: 0, buffer: null, data: null, cells: null, paletteHash: null, full: true, dirties: [], fresh: false }
    layerCache.set(el, c)
  }
  if (c.gw !== gw || c.gh !== gh || !c.buffer) {
    c.canvas.width = gw
    c.canvas.height = gh
    c.buffer = c.off.createImageData(gw, gh)
    c.data = new Uint32Array(c.buffer.data.buffer)
    c.cells = null
    c.gw = gw
    c.gh = gh
    c.full = true
  }
  return c
}

/** 色板指纹：编辑会重建 palette 数组，但绝大多数时候内容没变，没必要整层重刷 */
function paletteHash(palette) {
  let h = 2166136261
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]
    const s = ((c && c.id) || '') + ((c && c.hex) || '')
    for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619)
  }
  return h >>> 0
}

/**
 * cells + palette → ABGR 像素数组（1 格 1 像素）。
 *
 * 单独导出是为了能不依赖浏览器验证它：它和逐格绘制里
 * 「k < 0 用 EMPTY_FILL，否则 palette[k].hex」的取色规则必须完全一致。
 */
export function packCellColors(cells, palette) {
  const lut = colorLUT(palette)
  const EMPTY_PACK = packHex(EMPTY_FILL)
  const out = new Uint32Array(cells.length)
  for (let i = 0; i < cells.length; i++) out[i] = cellPack(cells[i], lut, EMPTY_PACK)
  return out
}

/** 单格取色：k < 0 = 空格，palette[k] 缺失 = 这一格不画（与原实现一致） */
function cellPack(k, lut, emptyPack) {
  return k < 0 ? emptyPack : (lut[k] ? lut[k].packed : 0)
}

/**
 * 把 pattern.cells 的改动同步进图案层。
 * @returns {{x,y,w,h}|null} 本次变化的格子包围盒（格子坐标）；null = 一点没变
 */
function syncLayer(c, cells, palette) {
  const n = cells.length
  const hash = paletteHash(palette)
  /* 色板换了（重配色 / 死色被剪掉）→ 每个格子的颜色都可能变，只能整层重来 */
  if (c.paletteHash !== hash || !c.cells || c.cells.length !== n) c.full = true
  c.paletteHash = hash

  const buf = c.data
  const lut = colorLUT(palette)
  const EMPTY_PACK = packHex(EMPTY_FILL)
  let minX = c.gw
  let minY = c.gh
  let maxX = -1
  let maxY = -1
  const prev = c.cells

  if (c.full || !prev) {
    for (let i = 0; i < n; i++) buf[i] = cellPack(cells[i], lut, EMPTY_PACK)
    minX = 0; minY = 0; maxX = c.gw - 1; maxY = c.gh - 1
  } else {
    const w = c.gw
    for (let i = 0; i < n; i++) {
      const k = cells[i]
      const px = cellPack(k, lut, EMPTY_PACK)
      if (buf[i] === px) continue
      buf[i] = px
      /* 空的色板槽（palette[k] 缺失）保持原样：和原来的「跳过不画」视觉一致 */
      if (k >= 0 && !lut[k]) continue
      const x = i % w
      const y = (i - x) / w
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) { c.fresh = false; return null }

  c.off.putImageData(c.buffer, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1)
  c.cells = cells
  c.full = false
  c.fresh = true
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * 把图案层的某块区域铺到主画布上（没传脏矩形就整层）。
 *
 * ⚠️ 源矩形必须除以 cell 换算回「图案层像素」。图案层是 1 格 1 像素，
 * 而这里的 cx/cy/cw/ch 是主画布上的 CSS 像素（1 格 = cell 个像素）。
 *
 * 这条曾经是错的：源矩形直接用了 CSS 像素（`cx - originX` 等），
 * 铺整层时因为「源矩形超出图像会被按比例裁剪到图像范围」正好看不出问题，
 * 但脏矩形重绘时 —— 例如 120 格的图纸、cell=9、改第 57 列 —— 源矩形会是
 * (495, 351, 63, 45)，而图案层只有 120×120：交集为空，于是一格都没画上去。
 * 表现是「大画布上改一格，颜色要等换缩放/切视图才出现」，
 * 而 116 格以内（≤2 万格不走图案层）根本复现不出来。
 */
function blitLayer(ctx, c, g, cx, cy, cw, ch) {
  const cell = g.cell
  let sx = (cx - g.originX) / cell
  let sy = (cy - g.originY) / cell
  let sw = cw / cell
  let sh = ch / cell
  let dx = cx
  let dy = cy
  let dw = cw
  let dh = ch
  /* 贴到图案层外面时按同样的比例同时收源和目标，宁可少画一条边，
     也不要把「错位的图案」画进去（后者看起来像换色，最难发现） */
  if (sx < 0) { const k = -sx; sx = 0; dx += k * cell; sw -= k; dw -= k * cell }
  if (sy < 0) { const k = -sy; sy = 0; dy += k * cell; sh -= k; dh -= k * cell }
  if (sx + sw > c.gw) { const k = sx + sw - c.gw; sw -= k; dw -= k * cell }
  if (sy + sh > c.gh) { const k = sy + sh - c.gh; sh -= k; dh -= k * cell }
  if (sw <= 0 || sh <= 0) return

  ctx.save()
  ctx.beginPath()
  ctx.rect(cx, cy, cw, ch)
  ctx.clip()
  ctx.fillStyle = g.opts.background
  ctx.fillRect(cx, cy, cw, ch)
  /* 只有**缩小**（每格不到 1 个物理像素）才开平滑：那时一个屏幕像素要盖住好几格，
     平滑是唯一能保住整体明暗的做法。每格 ≥ 1 px 时是放大，必须关掉 ——
     开了双线性之后，一格的颜色会被左右邻格稀释（1.4 px/格时中心像素只有约四成是它自己的颜色），
     用户"点一格改色"看到的就不是那个色号，一屏之内还得靠猜。关掉就是像素硬边，
     和界面上其它地方（缩略图、对照图的 image-rendering: pixelated）也是同一套观感。 */
  ctx.imageSmoothingEnabled = cell < 1
  ctx.drawImage(c.canvas, sx, sy, sw, sh, dx, dy, dw, dh)
  ctx.restore()
}

/** 脏矩形 → 像素坐标，并给线条 / 角标留出溢出余量 */
function pixelRect(g, cells, dirty) {
  const { cell, originX: OX, originY: OY, gridW, gridH } = g
  if (!dirty) return { x: OX, y: OY, w: gridW, h: gridH }
  const pad = 2 * cell
  const x0 = Math.max(OX, Math.floor(OX + dirty.x * cell) - pad)
  const y0 = Math.max(OY, Math.floor(OY + dirty.y * cell) - pad)
  const x1 = Math.min(OX + gridW, Math.ceil(OX + (dirty.x + dirty.w) * cell) + pad)
  const y1 = Math.min(OY + gridH, Math.ceil(OY + (dirty.y + dirty.h) * cell) + pad)
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

export const DRAW_DEFAULTS = {
  cell: 14,
  ruler: true,
  grid: true,
  bold: true,
  codes: true,
  boardLines: true,
  boardLabels: true,
  centerMarks: true,
  outerFrame: true,
  background: '#ffffff',
  /* 空白格底色；null = 不铺色（透明导出）。编辑器与普通图纸导出保持浅灰 */
  emptyFill: EMPTY_FILL
}

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * 保证 canvas 后端缓冲按 DPR 放大，线条在 HiDPI 屏上不发虚。
 *
 * 现在这里只剩「照算出来的倍率写尺寸」这一件事，倍率本身由 resolveCanvasDpr 决定 ——
 * 单边 16384 只挡住了「线」，挡不住「面」：1000×1000 格的图纸在 14 px/格下
 * 是 14000² ≈ 1.96 亿像素。RGBA 每像素 4 字节，那是 780 MB 的后备缓冲，
 * 浏览器分配不出来，画布会静默变成空白（既不报错也不抛异常，用户只看到一片白）。
 * 所以倍率必须同时受单边和总像素两个上限约束，两处调用点也必须是同一份算式。
 */
export const MAX_CANVAS_SIDE = 16384

/**
 * 允许的后备缓冲总像素数。
 *
 * 桌面 2400 万像素 ≈ 96 MB：这是 4K 屏上「整张图纸铺满一屏 + DPR 2」的真实用量，
 * 再往上多出来的倍率在屏幕上已经看不出来，只是白烧内存。
 * 窄屏（≤780px）给 800 万 ≈ 32 MB：手机内存紧张，而且一屏本来也放不下多少格，
 * 这条线让 1000×1000 的图纸在手机上稳定退回 1 倍甚至更低。
 *
 * 屏幕宽度只在内部函数里问 window：纯函数不能依赖 window，
 * 否则 Node 里跑验证脚本、或者导出链路在 Web Worker 里调用都会直接抛。
 */
function isNarrowScreen() {
  return typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(max-width: 780px)').matches
}

export function chartPixelBudget(narrow = isNarrowScreen()) {
  return narrow ? 8e6 : 24e6
}

/**
 * 真正生效的缓冲倍率 —— 整个链路里唯一的「事实来源」。
 *
 * 为什么要退档而不是夹尺寸：缓冲比 CSS 小的时候，元素仍按 cssW×cssH 排版，
 * 由 CSS 把缓冲拉伸回去（ctx 的 setTransform(dpr,…) 让几何照旧自洽）。
 * 这样滚动范围、命中判定都一致；导出链路则走 el.__dpr 的 1:1 旁路（见下面 forcedDpr），
 * 不受这里的预算影响。
 *
 * 为什么档位是 2 → 1 → 0.5 → 0.25 而不是「精确算一个 1.37」：
 * 非整数倍率下 1px 的格线落在半个设备像素上，会被光栅化成两条灰线（发虚），
 * 而 0.5 / 0.25 这种整数比是干净的降采样。下限 0.25 是因为再小线条就真的糊没了。
 *
 * @param {number} cssW 逻辑（CSS）宽度
 * @param {number} cssH 逻辑（CSS）高度
 * @param {number} wantDpr 期望倍率，默认 2
 * @param {number} budget 允许的缓冲总像素数，默认按屏幕宽窄取
 * @returns {number} 2 / 1 / 0.5 / 0.25 之一
 */
export function resolveCanvasDpr(cssW, cssH, wantDpr = 2, budget = chartPixelBudget()) {
  const w = Math.max(0, Number(cssW) || 0)
  const h = Math.max(0, Number(cssH) || 0)
  const area = Math.max(1, w * h)

  /* 从「期望倍率向上取整」出发，先按任意倍率算一个够用的值 */
  let d = Math.max(0.25, Math.ceil(Math.max(0.25, Number(wantDpr) || 1) * 2) / 2)

  /* ① 单边：resolveCanvasDpr 的契约是超限时把两侧都夹住，而缓冲尺寸是取整的，
     所以这里用取整后的 max 反推，round(w*d) 一定不会越过 16384 */
  const maxSide = Math.max(Math.ceil(w), Math.ceil(h), 1)
  if (maxSide * d > MAX_CANVAS_SIDE) d = MAX_CANVAS_SIDE / maxSide

  /* ② 总像素：按面积反推，再用地板除保证 round 之后也不越界 */
  const byArea = Math.sqrt(budget / area)
  if (d > byArea) d = byArea

  /* 落到 2 的整数次幂档位上，永远不会高估（floor） */
  const e = Math.max(-2, Math.min(1, Math.floor(Math.log2(d))))
  return Math.pow(2, e)
}

/**
 * 元素上带 `__dpr` 时以它为准 —— 这是给导出链路的「1:1 旁路」。
 *
 * 导出要的是「逻辑尺寸 = 缓冲尺寸」，不是「屏幕上最省的倍率」：
 * 手机（窄屏预算 8 Mpx）上按预算算一张 4096 px 的图纸会退到 0.5 倍，
 * 而 `round(cssW*0.5)/0.5` 在 cssW 是奇数时会变成 cssW+1 —— 反推回逻辑尺寸差 1 px，
 * 导出侧那道尺寸对账会偶发失败（不是画错，是直接拒绝导出）。
 * 屏幕像素预算是为了「编辑器那一块画布别把内存打爆」，导出的上限由 exporters.js
 * 自己那套（PNG_MAX_SIDE / PNG_MAX_PIXELS）管，两套预算不该互相污染。
 * 编辑器画布没有这个属性，行为不变；markChartLayer / updateChartLayer 也不用为它特判。
 */
function forcedDpr(el) {
  const forced = el && Number(el.__dpr)
  return Number.isFinite(forced) && forced > 0 ? forced : 0
}

/**
 * 没带 `__dpr` 时的期望倍率：设备 DPR 与调用方上限取小，但**不取到 1 以下**。
 * 浏览器缩放到 50% 时 devicePixelRatio 会是 0.5，照它画缓冲就只有 CSS 尺寸的一半，
 * 整张图纸（含格内色号）会糊掉。0.5 / 0.25 只应该在「像素预算装不下」时由
 * resolveCanvasDpr 自己退出来，而不是被一个缩小的窗口带进去。
 */
function wantDprOf(dprCap = 2) {
  const dev = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return Math.max(1, Math.min(dprCap, dev))
}

/**
 * 画布元素该写多大的缓冲，以及按这个倍率铺开的 ctx。
 * 元素宽度严格等于 round(cssW*dpr) —— 不再套一层 Math.min：
 * 夹过之后再 setTransform 就会和 exporters 反推的倍率对不上，导出图被裁掉一块还不报错。
 */
export function prepareCanvas(el, cssW, cssH, dprCap = 2) {
  const forced = forcedDpr(el)
  const dpr = forced || resolveCanvasDpr(cssW, cssH, wantDprOf(dprCap))
  /* 元素尺寸就是 CSS 尺寸：这里不夹，否则滚动范围会和实际画布对不上 */
  el.width = Math.max(1, Math.round(cssW * dpr))
  el.height = Math.max(1, Math.round(cssH * dpr))
  el.style.width = cssW + 'px'
  el.style.height = cssH + 'px'
  const ctx = el.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/** 真正生效的缓冲倍率（hitTest / 脏矩形都要用它把 CSS 像素换成缓冲像素） */
export function canvasDpr(el, cssW, cssH, dprCap = 2) {
  const forced = forcedDpr(el)
  if (forced) return forced
  return resolveCanvasDpr(cssW, cssH, wantDprOf(dprCap))
}

/**
 * 在像素预算内，每格最多能画多少像素（整数，至少 1）。
 *
 * 编辑器的缩放上限就靠它：cell 再大，画布也只会更糊 / 更省内存。
 *
 * 判据必须落在**逻辑尺寸 × resolveCanvasDpr 的真实缓冲尺寸**上，不能自己乘一遍 dpr；
 * 而且只接受 **dpr ≥ 1** 的级别。
 *
 * 为什么必须卡 dpr ≥ 1：dpr < 1 时缓冲比 CSS 小、由浏览器拉伸，
 * 1 px 的格线只剩零点几个设备像素，整张图（包括格内色号）都是糊的 ——
 * 那不是「省内存」，是画了一张看不清的图。实测按纯面积判会给 1000 格放到 cell=15
 * （逻辑 15052 px、预算把倍率压到 0.25），屏幕上看到的是每格 3.8 个缓冲像素放大 4 倍。
 * 所以宁可让缩放停在这里、由 zoomCapped 提示用户去分板视图看细节，
 * 也不放一个「能画但看不清」的级别出来。
 */
export function chartCellCap(gw, gh, rulerPx = 0) {
  const R = Math.max(0, Math.round(rulerPx) || 0)
  const a = Math.max(1, gw) + 2 * R
  const b = Math.max(1, gh) + 2 * R
  let cap = 1
  /* 逐格试：cap 每次 +1，边长线性增长，上限很快把它按下去 ——
     最坏（1×1 图案）也就几百轮，这点算术比一次绘制便宜得多。 */
  while (cap < 512) {
    const c = cap + 1
    const W = a * c
    const H = b * c
    if (Math.max(W, H) > MAX_CANVAS_SIDE) break
    const d = resolveCanvasDpr(W, H)
    if (d < 1) break
    if (Math.round(W * d) * Math.round(H * d) > chartPixelBudget()) break
    cap = c
  }
  return cap
}

/**
 * 把「格子像素坐标」换算为图纸偏移与尺寸。
 * 标尺宽度跟着格子大小走，太小时自动收紧。
 *
 * cell 下限是 0.5 而不是 1：1000×1000 格要让整张图纸缩进一屏（舞台约 700px），
 * 每格只有零点几像素。下限取 1 的话图纸最小也是 1000px 宽，怎么都缩不到「一眼看全图」。
 * 图案层本来就是 drawImage 把 1 格 1 像素的位图缩放铺开的，分数格只是采样比变了，
 * 不会出现逐格 fillRect 那种亚像素接缝。
 */
export function chartGeometry(pattern, opts = {}) {
  const o = { ...DRAW_DEFAULTS, ...opts }
  const cell = Math.max(0.5, o.cell)
  const ruler = o.ruler ? Math.max(13, Math.min(52, Math.round(cell * 1.8))) : 0
  const gridW = pattern.width * cell
  const gridH = pattern.height * cell
  return {
    cell,
    ruler,
    gridW,
    gridH,
    width: ruler + gridW + ruler,
    height: ruler + gridH + ruler,
    originX: ruler,
    originY: ruler,
    opts: o
  }
}

/**
 * 绘制整张图纸。
 *
 * @param {HTMLCanvasElement} el
 * @param {object} pattern  { width, height, cells, palette }
 * @param {object} opts     见 DRAW_DEFAULTS + { boardSize, useLayer }
 * @param {object} [geo]    已经算好的 chartGeometry（编辑器缩放时会连着用几次）
 *
 * `useLayer` 打开后「豆子填色」走 1 格 1 像素的离屏图案层（见上面的说明）：
 * 大画布缩放、平移、开网格都不必再跑一遍逐格绘制，编辑时也只重刷脏格。
 * 默认关闭 —— 导出与其它预览要的是逐格精确的像素结果。
 *
 * 注意：LOD（画布太大就不印色号）不在这里判断。这个函数的契约是
 * 「参数说了印就印」，导出图纸要的就是完整色号；该不该印由调用方决定。
 */
export function drawChart(el, pattern, opts = {}, geo = null) {
  if (!el || !pattern) return null
  const g = geo || chartGeometry(pattern, opts)
  const { gridW, gridH, width: W, height: H, originX: OX, originY: OY, opts: o } = g
  const ctx = prepareCanvas(el, W, H)
  if (!ctx) return g

  const { width: gw, height: gh, cells, palette } = pattern
  const useLayer = !!o.useLayer && !!cells && cells.length > 0
  const cache = useLayer ? getLayer(el, gw, gh) : null
  /* 整层重画，脏矩形在这里没用 —— 同步一遍是为了让缓存跟上最新的 cells */
  if (cache) syncLayer(cache, cells, palette)
  /* 图案层拿不到（无 document / 尺寸为 0）就退回逐格精绘，不能画出一张空白 */
  const layered = !!cache

  ctx.fillStyle = o.background
  ctx.fillRect(0, 0, W, H)

  // 标尺底色
  if (g.ruler > 0) {
    const R = g.ruler
    ctx.fillStyle = '#F4F5F7'
    ctx.fillRect(0, 0, W, R)
    ctx.fillRect(0, OY + gridH, W, R)
    ctx.fillRect(0, R, R, gridH)
    ctx.fillRect(OX + gridW, R, R, gridH)
    ctx.fillStyle = '#E9EAEE'
    ctx.fillRect(0, 0, R, R)
    ctx.fillRect(OX + gridW, 0, R, R)
    ctx.fillRect(0, OY + gridH, R, R)
    ctx.fillRect(OX + gridW, OY + gridH, R, R)
  }

  if (!cells || !cells.length) {
    ctx.fillStyle = '#9A9AA2'
    ctx.font = '13px -apple-system,Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('尚未生成', W / 2, H / 2)
    return g
  }

  // 1) 豆子填色
  if (layered) {
    blitLayer(ctx, cache, g, OX, OY, gridW, gridH)
  } else {
    paintCells(ctx, gw, gh, cells, colorLUT(palette), OX, OY, g.cell, o.emptyFill)
  }

  // 2~9) 装饰层
  paintChartOverlay(ctx, g, pattern)

  return g
}

/**
 * 把「一帧里的装饰层」画出来：细格线 / 每 10 格加粗 / 底板虚线 / 色号 /
 * 板号角标 / 标尺 / 中心三角 / 外框。
 *
 * 单独抽出来的原因：图案层是缓存的，装饰层不是 —— 脏矩形重绘时只更新
 * 那一小块，必须能只重画这块区域里的装饰，而不是整张图纸再来一遍。
 * region 传像素矩形（CSS 像素），不传就是全图。
 */
function paintChartOverlay(ctx, g, pattern) {
  const { cell, ruler: R, gridW, gridH, width: W, height: H, originX: OX, originY: OY, opts: o } = g
  const { width: gw, height: gh, cells, palette } = pattern
  const region = o.region || null
  if (region) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(region.x, region.y, region.w, region.h)
    ctx.clip()
  }
  /* 装饰层的坐标只跟图纸几何有关，不随 region 变 —— 这样同一块区域重画出来的
     线与全量绘制逐像素一致。region 只用来跳过画在区域外的图形：
     不加这层判断，脏矩形重绘反而比全量还慢（每次都要走完几百条格线）。 */
  const PAD = 2
  const hitRect = (x, y, w, h) => !region ||
    (x <= region.x + region.w && x + w >= region.x && y <= region.y + region.h && y + h >= region.y)
  const hitCol = x => !region || (x >= region.x - PAD && x <= region.x + region.w + PAD)
  const hitRow = y => !region || (y >= region.y - PAD && y <= region.y + region.h + PAD)

  // 细格线
  if (o.grid && cell >= 3.5) {
    ctx.strokeStyle = 'rgba(28,28,32,.14)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= gw; i++) {
      const v = OX + i * cell + 0.5
      if (!hitCol(v)) continue
      ctx.moveTo(v, OY)
      ctx.lineTo(v, OY + gridH)
    }
    for (let j = 0; j <= gh; j++) {
      const h = OY + j * cell + 0.5
      if (!hitRow(h)) continue
      ctx.moveTo(OX, h)
      ctx.lineTo(OX + gridW, h)
    }
    ctx.stroke()
  }

  // 每 10 格加粗
  if (o.bold && cell >= 4) {
    ctx.strokeStyle = 'rgba(28,28,32,.44)'
    ctx.lineWidth = Math.max(1, Math.round(cell / 11))
    ctx.beginPath()
    for (let i = 10; i < gw; i += 10) {
      const v = OX + i * cell + 0.5
      if (!hitCol(v)) continue
      ctx.moveTo(v, OY)
      ctx.lineTo(v, OY + gridH)
    }
    for (let j = 10; j < gh; j += 10) {
      const h = OY + j * cell + 0.5
      if (!hitRow(h)) continue
      ctx.moveTo(OX, h)
      ctx.lineTo(OX + gridW, h)
    }
    ctx.stroke()
  }

  // 底板边界
  /* 分板规格由 boardSpec.js 统一推导（整张画布一种规格；老图纸那里是 29 格老板），
     {x, y} 两种写法都过 normalizeBoardSize */
  const BS = normalizeBoardSize(o.boardSize, gw, gh)
  const bCols = Math.ceil(gw / BS.x)
  const bRows = Math.ceil(gh / BS.y)
  if (o.boardLines && (bCols > 1 || bRows > 1)) {
    ctx.save()
    ctx.strokeStyle = 'rgba(240,61,46,.92)'
    ctx.lineWidth = Math.max(1.5, Math.round(cell / 7))
    ctx.setLineDash([Math.max(4, cell / 2.5), Math.max(3, cell / 4)])
    ctx.beginPath()
    for (let i = BS.x; i < gw; i += BS.x) {
      const v = OX + i * cell + 0.5
      if (!hitCol(v)) continue
      ctx.moveTo(v, OY)
      ctx.lineTo(v, OY + gridH)
    }
    for (let j = BS.y; j < gh; j += BS.y) {
      const h = OY + j * cell + 0.5
      if (!hitRow(h)) continue
      ctx.moveTo(OX, h)
      ctx.lineTo(OX + gridW, h)
    }
    ctx.stroke()
    ctx.restore()
  }

  // 格内色号
  if (o.codes && cell >= 11) {
    const maxLen = palette.reduce((m, p) => Math.max(m, p.code.length), 2)
    const fs = Math.max(5, Math.min(Math.round(cell * 0.46), Math.round((1.41 * cell) / maxLen)))
    if (maxLen * 0.58 * fs <= cell * 0.99) {
      ctx.font = `700 ${fs}px Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let curInk = null
      for (let y = 0; y < gh; y++) {
        const row = y * gw
        const cy = OY + y * cell + cell / 2
        if (region && (cy < region.y - cell || cy > region.y + region.h + cell)) continue
        for (let x = 0; x < gw; x++) {
          const k = cells[row + x]
          if (k < 0) continue // 空格不印色号
          const c = palette[k]
          if (!c) continue
          const cx = OX + x * cell + cell / 2
          if (region && (cx < region.x - cell || cx > region.x + region.w + cell)) continue
          const ink = inkOn(c.hex)
          /* 同色豆子的字色一样，没必要每格都设一遍 */
          if (ink !== curInk) { ctx.fillStyle = ink; curInk = ink }
          ctx.fillText(c.code, cx, cy)
        }
      }
    }
  }

  // 板号角标
  if (o.boardLabels && cell >= 6 && (bCols > 1 || bRows > 1)) {
    const cw = Math.max(16, cell * 2.2)
    const ch = Math.max(13, cell * 1.4)
    ctx.font = `700 ${Math.max(9, Math.round(cell * 0.52))}px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let by = 0; by < bRows; by++) {
      for (let bx = 0; bx < bCols; bx++) {
        const px = OX + bx * BS.x * cell + 3
        const py = OY + by * BS.y * cell + 3
        if (!hitRect(px, py, cw, ch)) continue
        ctx.fillStyle = 'rgba(255,255,255,.9)'
        roundRect(ctx, px, py, cw, ch, 4)
        ctx.fill()
        ctx.strokeStyle = 'rgba(240,61,46,.9)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = '#E23A20'
        ctx.fillText(String(by * bCols + bx + 1), px + cw / 2, py + ch / 2 + 0.5)
      }
    }
  }

  // 标尺坐标
  if (R > 0) {
    const step = cell >= 15 ? 1 : cell >= 9 ? 5 : 10
    const fs = Math.max(8, Math.min(Math.round(cell * 0.46), Math.round(R * 0.52)))
    ctx.font = `${fs}px -apple-system, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 1; i <= gw; i++) {
      const major = i % 10 === 0
      if (!major && i % step !== 0) continue
      const cx = OX + (i - 0.5) * cell
      /* 标尺在图纸四边，只有贴着脏矩形的才需要重画 */
      if (!hitCol(cx)) continue
      ctx.fillStyle = major ? '#1B1B1F' : '#9A9AA2'
      ctx.fillText(String(i), cx, R * 0.5)
      ctx.fillText(String(i), cx, OY + gridH + R * 0.5)
    }
    for (let j = 1; j <= gh; j++) {
      const major = j % 10 === 0
      if (!major && j % step !== 0) continue
      const cy = OY + (j - 0.5) * cell
      if (!hitRow(cy)) continue
      ctx.fillStyle = major ? '#1B1B1F' : '#9A9AA2'
      ctx.fillText(String(j), R * 0.5, cy)
      ctx.fillText(String(j), OX + gridW + R * 0.5, cy)
    }
  }

  // 边缘中心三角
  if (o.centerMarks && R > 0) {
    ctx.fillStyle = 'rgba(240,61,46,.9)'
    const mx = OX + gridW / 2
    const my = OY + gridH / 2
    const t = Math.max(4, Math.round(cell * 0.36))
    const tri = (ax, ay, bx, by, cx2, cy2) => {
      if (!hitRect(Math.min(ax, bx, cx2), Math.min(ay, by, cy2), Math.abs(bx - ax), Math.abs(cy2 - ay))) return
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.lineTo(cx2, cy2)
      ctx.closePath()
      ctx.fill()
    }
    tri(mx - t, 0, mx + t, 0, mx, R)
    tri(mx - t, H, mx + t, H, mx, OY + gridH)
    tri(0, my - t, 0, my + t, R, my)
    tri(W, my - t, W, my + t, OX + gridW, my)
  }

  // 外框
  if (o.outerFrame && hitRect(OX - 1, OY - 1, gridW + 2, gridH + 2)) {
    ctx.strokeStyle = '#1B1B1F'
    ctx.lineWidth = 2
    ctx.strokeRect(OX - 1, OY - 1, gridW + 2, gridH + 2)
  }

  if (region) ctx.restore()
}

/**
 * 编辑用的增量重绘：图案层只同步脏格，主画布只刷新脏矩形。
 *
 * @returns {boolean} 是否走通了增量路径。false = 缓存还没建立（首次绘制 /
 *   刚换过缩放），调用方应改成一次完整 drawChart。
 */
export function updateChartLayer(el, pattern, opts = {}, geo = null) {
  if (!el || !pattern || !pattern.cells || !pattern.cells.length) return false
  const g = geo || chartGeometry(pattern, opts)
  const gw = pattern.width
  const gh = pattern.height
  const cache = getLayer(el, gw, gh)
  if (!cache) return false
  /* 主画布尺寸/倍率和缓存建立时对不上，说明期间换过缩放：这一小块坐标没法换算 */
  const W = g.width
  const H = g.height
  if (cache.cw !== W || cache.ch !== H || cache.cdpr !== canvasDpr(el, W, H)) return false
  if (el.width !== Math.round(W * cache.cdpr) || el.height !== Math.round(H * cache.cdpr)) return false

  const dirty = syncLayer(cache, pattern.cells, pattern.palette)
  if (!dirty) return true

  const r = pixelRect(g, pattern.cells, dirty)
  const ctx = el.getContext('2d')
  ctx.save()
  ctx.setTransform(cache.cdpr, 0, 0, cache.cdpr, 0, 0)
  blitLayer(ctx, cache, g, r.x, r.y, r.w, r.h)
  paintChartOverlay(ctx, { ...g, opts: { ...g.opts, region: r } }, pattern)
  ctx.restore()
  return true
}

/** 由调用方在自己的一次完整绘制之后登记缓存信息（几何 / 倍率） */
export function markChartLayer(el, g) {
  const cache = layerCache.get(el)
  if (!cache) return
  cache.cw = g.width
  cache.ch = g.height
  cache.cdpr = canvasDpr(el, g.width, g.height)
}

/** 纯色块渲染（缩略图 / 预览 / 对照图用，不带标尺与色号） */
export function drawPixels(el, pattern, { maxSize = 420, dpr = 2, boardLines = false, boardSize = null, blank = '#ffffff' } = {}) {
  if (!el || !pattern) return
  const { width: gw, height: gh, cells, palette } = pattern
  /* 默认跟图纸自己的口径走（52 钉板就每 52 格一条线），老调用显式传数字仍然生效 */
  const bs = normalizeBoardSize(boardSize || pattern.boardSize, gw, gh)
  /* 1 px/格 是地板，不再往下取整：1000 格的图纸在 420px 的缩略图里每格只有 0.42 格位，
     cell 取 1 时画布是 1000×1000，超出的部分让 CSS（max-width:100%）压回去，
     总比「1000 格只画 420 格」直接丢内容强 */
  const cell = Math.max(1, Math.floor(maxSize / Math.max(gw, gh)))
  const W = gw * cell
  const H = gh * cell
  const ctx = prepareCanvas(el, W, H, dpr)
  if (!ctx) return
  ctx.fillStyle = blank
  ctx.fillRect(0, 0, W, H)
  const lut = colorLUT(palette)

  /* 快路径：图案本身比 maxSize 还大时 cell 会退化到 1 px（1000×1000 格在 420px 的
     缩略图里就是这样），这时候逐格 fillRect 是 100 万次调用 —— 实测要几秒，
     而这块缩略图在很多列表里会被反复重画。packCellColors 把整张图案压成一张
     1 格 1 像素的位图（1000×1000 = 4 MB），一次 drawImage 就铺完，结果逐像素相同：
     空格同样是 EMPTY_FILL、色板空槽同样是透明（不画，露出 blank 底色）。 */
  const canBitmap = cell < 2 && typeof ctx.putImageData === 'function' && typeof el.getContext === 'function'
  if (canBitmap) {
    const bmp = document.createElement('canvas')
    bmp.width = gw
    bmp.height = gh
    const bctx = bmp.getContext('2d')
    if (bctx && typeof bctx.putImageData === 'function') {
      const img = bctx.createImageData(gw, gh)
      /* 缓冲必须正好装得下 gw×gh 格。真浏览器里这条永远成立；
         但测试桩的 createImageData 常常返回一个固定大小的小对象，
         直接 set() 会抛 RangeError 把整条渲染链路带崩 —— 宁可退回逐格路径。 */
      if (img && img.data && img.data.buffer && img.data.buffer.byteLength >= gw * gh * 4) {
        /* 100 万格实测 7ms（见 scripts/verify/render-canvas-limits.mjs），逐格 fillRect 要几秒 */
        const packed = packCellColors(cells, palette)
        new Uint32Array(img.data.buffer, 0, gw * gh).set(packed)
        bctx.putImageData(img, 0, 0)
        const prevSmoothing = ctx.imageSmoothingEnabled
        ctx.imageSmoothingEnabled = false // 硬边：放大也要能看清每一格
        ctx.drawImage(bmp, 0, 0, gw, gh, 0, 0, W, H)
        ctx.imageSmoothingEnabled = prevSmoothing
        resetBrush()
        return { cell, width: W, height: H }
      }
    }
  }

  resetBrush()
  for (let y = 0; y < gh; y++) {
    const row = y * gw
    for (let x = 0; x < gw; x++) {
      const k = cells[row + x]
      if (k < 0) {
        drawEmptyCell(ctx, x * cell, y * cell, cell)
        resetBrush()
        continue
      }
      const c = lut[k]
      if (!c) continue
      fillCell(ctx, c.color, c.hex, x * cell, y * cell, cell)
    }
  }
  resetBrush()
  /* cell = 1 时每格还不到 3 px，画上去只是把图案糊成一片红，不如不画 */
  if (boardLines && cell >= 3) {
    ctx.strokeStyle = 'rgba(240,61,46,.8)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = bs.x; i < gw; i += bs.x) {
      ctx.moveTo(i * cell + 0.5, 0)
      ctx.lineTo(i * cell + 0.5, H)
    }
    for (let j = bs.y; j < gh; j += bs.y) {
      ctx.moveTo(0, j * cell + 0.5)
      ctx.lineTo(W, j * cell + 0.5)
    }
    ctx.stroke()
  }
  return { cell, width: W, height: H }
}

/**
 * 只画一块板（自动分板 / Build Mode 用）。
 * doneSet 为已完成的全局格子下标集合，完成格用半透明遮罩压暗。
 */
export function drawBoard(el, pattern, board, {
  cell = 16,
  codes = true,
  ruler = true,
  grid = true,
  doneSet = null,
  highlightColorIndex = -1,
  boardSize = 29
} = {}) {
  if (!el || !pattern || !board) return null
  const R = ruler ? Math.max(14, Math.round(cell * 1.7)) : 0
  const gridW = board.w * cell
  const gridH = board.h * cell
  const W = R + gridW + R
  const H = R + gridH + R
  const OX = R
  const OY = R
  const ctx = prepareCanvas(el, W, H)
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  if (R > 0) {
    ctx.fillStyle = '#F4F5F7'
    ctx.fillRect(0, 0, W, R)
    ctx.fillRect(0, OY + gridH, W, R)
    ctx.fillRect(0, R, R, gridH)
    ctx.fillRect(OX + gridW, R, R, gridH)
    ctx.fillStyle = '#E9EAEE'
    ctx.fillRect(0, 0, R, R)
    ctx.fillRect(OX + gridW, 0, R, R)
    ctx.fillRect(0, OY + gridH, R, R)
    ctx.fillRect(OX + gridW, OY + gridH, R, R)
  }

  const { width: gw, palette, cells } = pattern

  /* 这里也用颜色查找表 + 笔刷：分板视图下 450×450 会一次画上百块板，
     原来每格都设一遍 fillStyle，加起来是十几万次状态切换 */
  const lut = colorLUT(palette)
  resetBrush()
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const gx = board.x0 + x
      const gy = board.y0 + y
      const gi = gy * gw + gx
      const k = cells[gi]
      const px = OX + x * cell
      const py = OY + y * cell
      if (k < 0) {
        drawEmptyCell(ctx, px, py, cell)
        resetBrush()
      } else {
        const c = lut[k]
        if (c) fillCell(ctx, c.color, c.hex, px, py, cell)
      }
      if (doneSet && doneSet.has(gi)) {
        resetBrush()
        ctx.fillStyle = 'rgba(255,255,255,.74)'
        ctx.fillRect(px, py, cell, cell)
        ctx.strokeStyle = 'rgba(29,143,163,.5)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px + cell * 0.26, py + cell * 0.52)
        ctx.lineTo(px + cell * 0.44, py + cell * 0.7)
        ctx.lineTo(px + cell * 0.76, py + cell * 0.3)
        ctx.stroke()
      } else if (highlightColorIndex >= 0 && k !== highlightColorIndex) {
        resetBrush()
        ctx.fillStyle = 'rgba(244,245,247,.68)'
        ctx.fillRect(px, py, cell, cell)
      }
    }
  }
  resetBrush()

  // 网格
  if (grid && cell >= 3.5) {
    ctx.strokeStyle = 'rgba(28,28,32,.16)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= board.w; i++) {
      const v = OX + i * cell + 0.5
      ctx.moveTo(v, OY)
      ctx.lineTo(v, OY + gridH)
    }
    for (let j = 0; j <= board.h; j++) {
      const h = OY + j * cell + 0.5
      ctx.moveTo(OX, h)
      ctx.lineTo(OX + gridW, h)
    }
    ctx.stroke()
  }

  if (codes && cell >= 11) {
    const maxLen = palette.reduce((m, p) => Math.max(m, p.code.length), 2)
    const fs = Math.max(5, Math.min(Math.round(cell * 0.46), Math.round((1.41 * cell) / maxLen)))
    ctx.font = `700 ${fs}px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = 0; y < board.h; y++) {
      for (let x = 0; x < board.w; x++) {
        const gx = board.x0 + x
        const gy = board.y0 + y
        const k = cells[gy * gw + gx]
        if (k < 0) continue
        const c = palette[k]
        if (!c) continue
        ctx.fillStyle = inkOn(c.hex)
        ctx.fillText(c.code, OX + x * cell + cell / 2, OY + y * cell + cell / 2)
      }
    }
  }

  if (R > 0) {
    const step = cell >= 15 ? 1 : cell >= 9 ? 5 : 10
    const fs = Math.max(8, Math.min(Math.round(cell * 0.46), Math.round(R * 0.5)))
    ctx.font = `${fs}px -apple-system, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let x = 0; x < board.w; x++) {
      const col = board.x0 + x + 1
      const major = col % 10 === 0
      if (!major && col % step !== 0) continue
      ctx.fillStyle = major ? '#1B1B1F' : '#9A9AA2'
      const cx = OX + x * cell + cell / 2
      ctx.fillText(String(col), cx, R * 0.5)
      ctx.fillText(String(col), cx, OY + gridH + R * 0.5)
    }
    for (let y = 0; y < board.h; y++) {
      const rowNo = board.y0 + y + 1
      const major = rowNo % 10 === 0
      if (!major && rowNo % step !== 0) continue
      ctx.fillStyle = major ? '#1B1B1F' : '#9A9AA2'
      const cy = OY + y * cell + cell / 2
      ctx.fillText(String(rowNo), R * 0.5, cy)
      ctx.fillText(String(rowNo), OX + gridW + R * 0.5, cy)
    }
  }

  ctx.strokeStyle = '#1B1B1F'
  ctx.lineWidth = 1.6
  ctx.strokeRect(OX - 1, OY - 1, gridW + 2, gridH + 2)

  return { cell, width: W, height: H }
}

/** 屏幕坐标 → 图纸格子坐标（点击编辑用） */
export function hitTest(el, pattern, evt, opts = {}) {
  const g = chartGeometry(pattern, opts)
  const rect = el.getBoundingClientRect()
  const scaleX = g.width / rect.width
  const scaleY = g.height / rect.height
  const x = Math.floor(((evt.clientX - rect.left) * scaleX - g.originX) / g.cell)
  const y = Math.floor(((evt.clientY - rect.top) * scaleY - g.originY) / g.cell)
  if (x < 0 || y < 0 || x >= pattern.width || y >= pattern.height) return null
  return { x, y, index: y * pattern.width + x }
}
