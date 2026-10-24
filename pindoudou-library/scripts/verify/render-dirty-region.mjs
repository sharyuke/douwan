/* =========================================================================
   脏矩形重绘 与 完整重绘 的一致性验证

   为什么这么测：编辑器拖笔时只重画「变脏的那一块」，如果这块区域里的
   格线 / 板号 / 标尺 / 色号漏画或画错位置，用户会看到一根线断掉、一个
   板号消失。这里用一个记录型 stub canvas 跑真实实现：
     ① drawChart 完整画一遍 → 收录全部绘制指令
     ② 改掉一小片格子，再 updateChartLayer → 只收录脏矩形里的指令
     ③ 把 ① 的指令裁到同一块区域，逐条比对
   另外单独验证「1 格 1 像素的图案层铺开后，每一格的颜色与逐格绘制一致」，
   以及贴图那一下的**源矩形单位**（图案层像素 = CSS 像素 ÷ cell）——
   这一条曾经写错过，症状是「大画布上改一格要等换缩放才显示」。

   跑法：node scripts/verify/render-dirty-region.mjs
   ========================================================================= */

import { drawChart, updateChartLayer, markChartLayer, chartGeometry, EMPTY_FILL } from '../../src/lib/render.js'

/* ---------------------------------------------------------------- stub DOM */

const GW = 120
const GH = 120
const BOARDS = 29
const CELL = 9

function makeCtx(rec, label) {
  let style = null
  let stroke = null
  let lw = 1
  let font = ''
  let dash = null
  return {
    canvas: { width: 0, height: 0 },
    get fillStyle() { return style },
    set fillStyle(v) { style = v },
    get strokeStyle() { return stroke },
    set strokeStyle(v) { stroke = v },
    get lineWidth() { return lw },
    set lineWidth(v) { lw = v },
    get font() { return font },
    set font(v) { font = v },
    get textAlign() { return 'center' },
    set textAlign(_v) {},
    get textBaseline() { return 'middle' },
    set textBaseline(_v) {},
    get imageSmoothingEnabled() { return true },
    set imageSmoothingEnabled(_v) {},
    setTransform() {},
    save() {}, restore() {},
    setLineDash(v) { dash = v },
    beginPath() {}, closePath() {},
    moveTo(x, y) { rec.push({ label, op: 'moveTo', x, y, stroke, lw }) },
    lineTo(x, y) { rec.push({ label, op: 'lineTo', x, y, stroke, lw }) },
    stroke() { rec.push({ label, op: 'stroke', stroke, lw, dash }) },
    strokeRect(x, y, w, h) { rec.push({ label, op: 'strokeRect', x, y, w, h, stroke, lw }) },
    arcTo() {},
    roundRect(x, y, w, h) { rec.push({ label, op: 'roundRect', x, y, w, h }) },
    rect(x, y, w, h) { rec.push({ label, op: 'rect', x, y, w, h, style, stroke }) },
    clip() { rec.push({ label, op: 'clip' }) },
    fill() { rec.push({ label, op: 'fill', style }) },
    fillRect(x, y, w, h) { rec.push({ label, op: 'fillRect', x, y, w, h, style }) },
    fillText(t, x, y) { rec.push({ label, op: 'fillText', t, x, y, style, font }) },
    drawImage(_img, sx, sy, sw, sh, dx, dy, dw, dh) {
      rec.push({ label, op: 'drawImage', sx, sy, sw, sh, dx, dy, dw, dh })
    },
    /* putImageData(imageData, dx, dy, dirtyX, dirtyY, dirtyW, dirtyH)
       —— 真正写进画布的只有后 4 个参数标出的那块，前面的是贴图目标位置；
       同时把缓冲合并进「离屏画布的当前像素」，方便整体核对 */
    putImageData(data, dx, dy, dirtyX, dirtyY, dirtyW, dirtyH) {
      const ox = dirtyX || 0
      const oy = dirtyY || 0
      const w = dirtyW === undefined ? data.width : dirtyW
      const h = dirtyH === undefined ? data.height : dirtyH
      this._pixels = this._pixels || new Uint8ClampedArray(data.width * data.height * 4)
      for (let y = 0; y < h; y++) {
        const src = ((oy + y) * data.width + ox) * 4
        const dst = ((dy + oy + y) * data.width + dx + ox) * 4
        this._pixels.set(data.data.subarray(src, src + w * 4), dst)
      }
      rec.push({ label, op: 'putImageData', data, x: dx + ox, y: dy + oy, w, h })
    },
    createImageData(w, h) {
      const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
      /* 图案层是「就地改 buffer + putImageData」，所以把 buffer 挂到 ctx 上，
         测试直接读它的内容就等于读图案层的像素 */
      this._imageData = img
      return img
    }
  }
}

/** 记录每一次 createElement('canvas')，图案层就建在它上面 */
const offscreens = []
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag)
    const el = {
      _tag: 'canvas',
      width: 0,
      height: 0,
      style: {},
      /* 离屏画布当前的像素内容：putImageData 时按块合并进来，便于整体核对 */
      _pixels: null,
      _rec: [],
      getContext() {
        this._rec = this._rec || []
        this._ctx = this._ctx || makeCtx(this._rec, 'off')
        return this._ctx
      }
    }
    offscreens.push(el)
    return el
  }
}
globalThis.window = { devicePixelRatio: 1 }

/* ---------------------------------------------------------------- 造数据 */

function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rnd = mulberry(20240607)
const NCOL = 18
const palette = []
for (let i = 0; i < NCOL; i++) {
  palette.push({ id: 'p' + i, code: 'A' + i, hex: '#' + ((i * 2654435761) >>> 7 & 0xffffff).toString(16).padStart(6, '0') })
}
const cells = new Int32Array(GW * GH)
for (let i = 0; i < cells.length; i++) cells[i] = rnd() < 0.18 ? -1 : Math.floor(rnd() * NCOL)

const pattern = { width: GW, height: GH, cells, palette }
const opts = {
  cell: CELL, ruler: true, grid: true, bold: true, codes: true,
  boardLines: true, boardLabels: true, centerMarks: true, outerFrame: true,
  boardSize: BOARDS, useLayer: true
}
const g = chartGeometry(pattern, opts)

function makeMainCanvas(rec) {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext() {
      this._ctx = this._ctx || makeCtx(rec, 'main')
      return this._ctx
    }
  }
}

/* ------------------------------------------------- ① 完整绘制 → ② 脏矩形重绘

   每块画布一个固定的记录数组：stub 的 ctx 必须每次返回同一个对象，
   否则「增量那一段」会被记进另一个数组里，比对就成了空转。 */
function recorder() {
  const rec = []
  return {
    rec,
    canvas: { width: 0, height: 0, style: {}, getContext() { return (this._ctx = this._ctx || makeCtx(rec, 'main')) } }
  }
}

const full = recorder()
drawChart(full.canvas, pattern, opts, g)
markChartLayer(full.canvas, g)
const fullRec = full.rec

/* 改 3 个格子（模拟拖一笔），位置刻意选在图纸中间 */
const edited = Int32Array.from(cells)
const editedAt = [[57, 41], [58, 41], [59, 41]]
for (const [x, y] of editedAt) edited[y * GW + x] = 3
const pattern2 = { width: GW, height: GH, cells: edited, palette }

const inc = recorder()
/* 缓存必须建立在**改动前的**图纸上，否则 updateChartLayer 一比发现没有差异，
   什么都不会画（这条也顺便验证了「空改动不重绘」） */
drawChart(inc.canvas, pattern, opts, g)
markChartLayer(inc.canvas, g)
const before = inc.rec.length
const ok = updateChartLayer(inc.canvas, pattern2, opts, g)
const incOps = inc.rec.slice(before)

/* ---------------------------------------------------------------- 比对
   路径指令（moveTo/lineTo + 一条 fill/stroke）不带矩形，要按「这条路径的
   包围盒」与全量绘制对照；板号角标那种完全在脏矩形外的路径，增量绘制
   本来就不该画，所以只要求「增量画了的，全量里在同样位置也有」。 */

function collectShapes(rec) {
  const shapes = []
  const ops = []
  const rects = []
  let pts = null
  let dash = null
  for (const op of rec) {
    if (op.op === 'clip' || op.op === 'save' || op.op === 'restore' || op.op === 'setTransform') continue
    if (op.op === 'fillText') { ops.push({ kind: 'text', x: op.x, y: op.y, t: op.t, style: op.style, font: op.font }); continue }
    if (op.op === 'fillRect' || op.op === 'strokeRect' || op.op === 'rect' || op.op === 'roundRect') {
      rects.push({ kind: op.op, x: op.x, y: op.y, w: op.w, h: op.h, style: op.style || op.stroke })
      continue
    }
    if (op.op === 'drawImage') { ops.push({ kind: 'image', x: op.dx, y: op.dy, w: op.dw, h: op.dh }); continue }
    if (op.op === 'putImageData') { ops.push({ kind: 'image', x: op.x, y: op.y, w: op.w, h: op.h }); continue }
    if (op.op === 'moveTo' || op.op === 'lineTo') {
      if (!pts) pts = { minX: op.x, maxX: op.x, minY: op.y, maxY: op.y }
      else {
        pts.minX = Math.min(pts.minX, op.x); pts.maxX = Math.max(pts.maxX, op.x)
        pts.minY = Math.min(pts.minY, op.y); pts.maxY = Math.max(pts.maxY, op.y)
      }
      continue
    }
    if (op.op === 'stroke' || op.op === 'fill') {
      if (pts) {
        shapes.push({ kind: op.op, style: op.style || op.stroke, dash, ...pts })
        pts = null
        dash = null
      }
      continue
    }
    if (op.op === 'setLineDash') dash = op.dash
  }
  return { shapes, ops, rects }
}

const A = collectShapes(fullRec)
const B = collectShapes(incOps)

function rectOf(op) {
  if (op.op === 'fillRect' || op.op === 'strokeRect' || op.op === 'rect' || op.op === 'roundRect') {
    return { x: op.x, y: op.y, w: op.w, h: op.h, style: op.style || op.stroke }
  }
  return null
}

/** 每一块「实际被涂到的矩形/文字/路径」都要求增量里也有（图形本身逐条一致） */
function shapecmp(kind, listA, listB) {
  const norm = item => JSON.stringify(item)
  const setB = new Set(listB.map(norm))
  const missingItems = []
  let shown = 0
  for (const item of listA) {
    if (setB.has(norm(item))) continue
    // 增量绘制没有的，必须确认它整个都在脏矩形之外（或纯装饰且被 region 过滤）
    missingItems.push(item)
    if (shown++ < 6) missingDetail.push(kind + ' ' + norm(item))
  }
  return missingItems
}

/* 脏矩形的格子包围盒：改的是 x 57..59, y 41 */
const dirtyCells = { x: 57, y: 41, w: 3, h: 1 }
const dirtyPixels = {
  x: g.originX + dirtyCells.x * CELL,
  y: g.originY + dirtyCells.y * CELL,
  w: dirtyCells.w * CELL,
  h: dirtyCells.h * CELL
}
/* 增量绘制给自己留了 2 格余量 */
const region = {
  x: dirtyPixels.x - 2 * CELL,
  y: dirtyPixels.y - 2 * CELL,
  w: dirtyPixels.w + 4 * CELL,
  h: dirtyPixels.h + 4 * CELL
}

const missingDetail = []
/* 增量是「裁剪到这块区域」画的：一条竖格线的包围盒是整张图高，
   底图那一下也可能带 1~2px 的取整差，所以「多画的图形」只要求
   它在脏矩形附近 —— 真正要卡死的是「脏矩形内的图形有没有漏」。 */
const nearRegion = item => {
  const w = item.w || 0
  const h = item.h || 0
  return item.x <= region.x + region.w + 4 && item.x + w >= region.x - 4 &&
    item.y <= region.y + region.h + 4 && item.y + h >= region.y - 4
}
/* 增量贴图那一下自带「底色 + 裁剪区」三个矩形（见 blitLayer），
   全量绘制没有对等物（它是一格格画过去的），比对时排除 */
const isBlitBase = item => item.x === region.x && item.y === region.y &&
  (item.w || 0) === region.w && (item.h || 0) === region.h
const extraPaths = shapecmp('路径缺失于全量', B.shapes.filter(nearRegion), A.shapes)
const extraTexts = shapecmp('文字缺失于全量', B.ops.filter(o => o.kind === 'text').filter(nearRegion), A.ops.filter(o => o.kind === 'text'))
const extraRects = shapecmp('矩形缺失于全量', B.rects.filter(nearRegion).filter(i => !isBlitBase(i)), A.rects)
const extra = extraPaths.length + extraTexts.length + extraRects.length

/* ② 脏矩形内的矩形与文字，全量有的增量也必须补齐（漏画就是这里报出来） */
const inRegion = item => item.x >= region.x && item.y >= region.y &&
  item.x + (item.w || 0) <= region.x + region.w && item.y + (item.h || 0) <= region.y + region.h
const needRects = A.rects.filter(inRegion)
const needShapes = A.shapes.filter(inRegion)
const missRects = shapecmp('脏矩形内漏画的矩形', needRects, B.rects)
const missShapes = shapecmp('脏矩形内漏画的路径', needShapes, B.shapes)
const missTexts = shapecmp('脏矩形内漏画的文字', A.ops.filter(o => o.kind === 'text' && inRegion(o)), B.ops.filter(o => o.kind === 'text'))
const missing = missRects.length + missShapes.length + missTexts.length

console.log('=== 脏矩形重绘 vs 完整重绘 ===')
console.log(`完整绘制：路径 ${A.shapes.length} 条、矩形 ${A.rects.length} 个、文字 ${A.ops.filter(o => o.kind === 'text').length} 处`)
console.log(`增量绘制：路径 ${B.shapes.length} 条、矩形 ${B.rects.length} 个、文字 ${B.ops.filter(o => o.kind === 'text').length} 处（updateChartLayer 返回 ${ok}）`)
console.log(`脏矩形 ${region.w}×${region.h}（含 2 格余量）内：应有矩形 ${needRects.length} 个 / 路径 ${needShapes.length} 条，缺 ${missing}；增量多画的图形 ${extra}`)
missingDetail.forEach(d => console.log('  · ' + d))
const pass1 = ok === true && missing === 0 && extra === 0
console.log(pass1 ? 'PASS  脏矩形内该画的装饰一条不少、也没有多画' : 'FAIL  脏矩形重绘与完整重绘不一致')

/* ------------------------------------------------- ③ 图案层像素与逐格结果一致

   把图案层收到的像素缓冲按「空格 / 各色」对一遍（是差分更新还是整层重建都行）。 */
const off = offscreens[offscreens.length - 1]
const puts = off._rec.filter(o => o.op === 'putImageData')
/* 图案层的像素 = 它自己维护的 ImageData 缓冲（差分更新是就地改这个缓冲） */
const data = off._ctx._imageData ? off._ctx._imageData.data : null
console.log('')
console.log('=== 图案层（1 格 1 像素）像素内容 ===')
console.log(`putImageData 调用 ${puts.length} 次，最后一次区域 ${puts.length ? `${puts[puts.length - 1].x},${puts[puts.length - 1].y} ${puts[puts.length - 1].w}x${puts[puts.length - 1].h}` : '无'}`)
let pixelBad = 0
if (!data) {
  console.log('FAIL  没有拿到像素缓冲')
} else {
  const toRgb = hex => {
    const q = parseInt(hex.replace('#', ''), 16)
    return [(q >> 16) & 255, (q >> 8) & 255, q & 255]
  }
  const enc = new Map()
  for (let i = 0; i < NCOL; i++) enc.set(i, toRgb(palette[i].hex))
  const emptyRgb = toRgb(EMPTY_FILL)
  for (let i = 0; i < edited.length; i++) {
    const k = edited[i]
    const want = k < 0 ? emptyRgb : enc.get(k)
    const r = data[i * 4]
    const gg = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    if (r !== want[0] || gg !== want[1] || b !== want[2] || a !== 255) {
      pixelBad++
      if (pixelBad < 4) console.log(`  · 第 ${i} 格（${i % GW},${(i / GW) | 0}）: 得到 rgba(${r},${gg},${b},${a})，应为 rgb(${want.join(',')})`)
    }
  }
  console.log(`逐格核对图案层像素：不一致 ${pixelBad} / ${edited.length}`)
}
const pass2 = pixelBad === 0 && !!data
console.log(pass2 ? 'PASS  图案层像素与逐格取色一致' : 'FAIL  图案层像素不对')

/* ------------------------------------------------- ④ 只改了 3 格 → 只刷这一小块 */
const lastPut = puts[puts.length - 1]
const tiny = !!lastPut && lastPut.w <= 5 && lastPut.h <= 5
console.log('')
console.log(`=== 增量更新的大小 ===`)
console.log(`最后一次 putImageData 区域：${lastPut ? `${lastPut.w}×${lastPut.h}` : '无'}（改动 3 格）`)
console.log(tiny ? 'PASS  只更新了改动的那几格' : 'FAIL  更新范围过大')

/* ------------------------------------------------- ⑤ 1 格 1 像素铺开后的主画布

   这里卡的是**源矩形的单位**。图案层是 1 格 1 像素，而贴图目标用的是 CSS 像素
   （1 格 = cell 个像素），源矩形必须先除以 cell 换算回图案层像素。
   这条曾经是错的：源矩形直接用了 CSS 像素的 (cx-originX, cy-originY, cw, ch)，
   铺整层时因为「源矩形超出图像会被按比例裁到图像范围」刚好蒙对，
   但脏矩形重绘时会得到一个完全在图案层之外的源矩形（120×120 的层收到
   (495, 351, 63, 45)），交集为空 → 一格都没画上去。
   表现是「大画布上改一格，颜色要等换缩放/切视图才出现」，116 格以内根本复现不出来。
   所以断言必须同时管住「源矩形在层内」与「源/目标严格成 cell 倍关系」。 */
const blits = incOps.filter(o => o.op === 'drawImage')
console.log('')
console.log(`=== 主画布贴图 ===`)
console.log(`增量绘制里的 drawImage：${blits.map(b => `${b.sx},${b.sy} ${b.sw}x${b.sh} → ${b.dx},${b.dy} ${b.dw}x${b.dh}`).join(' / ') || '无'}`)
const near = (a, b) => Math.abs(a - b) < 1e-6
/* 图案层的真实尺寸：getLayer 把它建成了 gw×gh（1 格 1 像素） */
const LAYER_W = GW
const LAYER_H = GH
const blitChecks = blits.length === 1
  ? [
    ['源矩形的下标换算：originX + sx × cell 必须等于目标 x', near(g.originX + blits[0].sx * CELL, blits[0].dx)],
    ['源矩形的下标换算：originY + sy × cell 必须等于目标 y', near(g.originY + blits[0].sy * CELL, blits[0].dy)],
    ['源宽 × cell 必须等于目标宽', near(blits[0].sw * CELL, blits[0].dw)],
    ['源高 × cell 必须等于目标高', near(blits[0].sh * CELL, blits[0].dh)],
    ['源矩形落在图案层内（否则 drawImage 会被裁成空）', blits[0].sx >= 0 && blits[0].sy >= 0 && blits[0].sx + blits[0].sw <= LAYER_W + 1e-6 && blits[0].sy + blits[0].sh <= LAYER_H + 1e-6],
    ['源矩形不是整层（脏矩形只该贴这一小块）', blits[0].sw * blits[0].sh < LAYER_W * LAYER_H]
  ]
  : [['增量绘制恰好一次贴图', false]]
blitChecks.forEach(([label, okOne]) => console.log(`  ${okOne ? 'ok  ' : 'FAIL'} ${label}`))
const blitOk = blitChecks.every(([, okOne]) => okOne)

const allOk = pass1 && pass2 && tiny && blitOk
console.log('')
console.log(allOk ? '✅ 增量重绘路径验证通过' : '❌ 有失败项')
process.exit(allOk ? 0 : 1)
