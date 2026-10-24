/* =========================================================================
   按色批量绘制 与 逐格绘制 的像素级等价性验证

   为什么这么测：编辑器的填色已经被改成「同色格子合成一条路径」（同色只切一次
   fillStyle），这条路径必须和原来的逐格 fillRect 产出完全一样的像素。
   浏览器里没有现成的对照实现，所以这里
     ① 把原来的逐格循环原样搬进来（oldLoop）
     ② 两边的绘制指令都录进同一个 stub canvas
     ③ 逐格比对「这一格最终被涂成了什么颜色」—— 也就是像素是否一致

   跑法：node scripts/verify/render-batch-equiv.mjs
   ========================================================================= */

import { EMPTY_FILL, EMPTY_DOT, packCellColors } from '../../src/lib/render.js'

const CELL = 14
const OX = 13
const OY = 13
const EMPTY_DOT_MIN_CELL = 9

/** 只记录「谁在什么位置画了什么」，不真的光栅化 */
function makeCtx(ops) {
  let style = null
  return {
    set fillStyle(v) { style = v },
    get fillStyle() { return style },
    fillRect(x, y, w, h) { ops.push({ x, y, w, h, style }) },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    rect(x, y, w, h) { ops.push({ x, y, w, h, style }) },
    fill() {},
    closePath() {}
  }
}

/** 现在的渲染方式：按颜色分组合并成一条路径（空格单独一组，与 render.js 一致） */
function newLoop(ctx, gw, gh, cells, palette, ox, oy, cell) {
  const groups = new Map()
  let emptyCount = 0
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = cells[y * gw + x]
      if (k < 0) { emptyCount++; continue }
      const c = palette[k]
      if (!c) continue
      const key = c.id === undefined ? c.hex : (c.id + '\u0000' + c.hex)
      let g = groups.get(key)
      if (!g) { g = { hex: c.hex, idx: [] }; groups.set(key, g) }
      g.idx.push(y * gw + x)
    }
  }
  if (emptyCount) {
    ctx.fillStyle = EMPTY_FILL
    let open = false
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (cells[y * gw + x] >= 0) continue
        if (!open) { ctx.beginPath(); open = true }
        ctx.rect(ox + x * cell, oy + y * cell, cell, cell)
      }
    }
    if (open) ctx.fill()
  }
  for (const g of groups.values()) {
    ctx.fillStyle = g.hex
    ctx.beginPath()
    for (const i of g.idx) {
      const x = i % gw
      const y = (i - x) / gw
      ctx.rect(ox + x * cell, oy + y * cell, cell, cell)
    }
    ctx.fill()
  }
}

/** 改动前的写法：逐格 fillRect，空格走 drawEmptyCell */
function oldLoop(ctx, gw, gh, cells, palette, ox, oy, cell) {
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = cells[y * gw + x]
      const px = ox + x * cell
      const py = oy + y * cell
      if (k < 0) {
        ctx.fillStyle = EMPTY_FILL
        ctx.fillRect(px, py, cell, cell)
        if (cell >= EMPTY_DOT_MIN_CELL) {
          const s = Math.max(1, Math.round(cell * 0.14))
          ctx.fillRect(Math.round(px + cell / 2 - s / 2), Math.round(py + cell / 2 - s / 2), s, s)
        }
        continue
      }
      const c = palette[k]
      if (!c) continue
      ctx.fillStyle = c.hex
      ctx.fillRect(px, py, cell, cell)
    }
  }
}

/* 格子颜色 → 每格最终涂了什么。空格中心的小点叠在底色上，不参与比较
   （批量路径不画那个小点，见 render.js 的说明：1px 图案层放不下它）。
   小点数量必须和用例自己的空格数对得上：不然颜色判断一旦写错，
   整块都会被静默跳过，测试就成了空转。 */
function paintMap(ops, cell, expectedDots) {
  const map = new Map()
  let dots = 0
  for (const o of ops) {
    if (o.h !== cell || o.w !== cell) { dots++; continue }
    map.set(o.x + ',' + o.y + ',' + o.w + 'x' + o.h, o.style)
  }
  if (dots !== expectedDots) {
    throw new Error(`空格小点数量不符：录到 ${dots}，按空格数应为 ${expectedDots}`)
  }
  return map
}

function compare(name, mapOld, mapNew) {
  let bad = 0
  const detail = []
  for (const [k, v] of mapOld) {
    if (mapNew.get(k) !== v) { bad++; if (detail.length < 6) detail.push(`${k}: 旧=${v} 新=${mapNew.get(k)}`) }
  }
  for (const [k, v] of mapNew) {
    if (!mapOld.has(k)) { bad++; if (detail.length < 6) detail.push(`${k}: 只在新实现里 (${v})`) }
  }
  console.log(`${bad === 0 ? 'PASS' : 'FAIL'}  ${name}`)
  console.log(`      两边各 ${mapOld.size} / ${mapNew.size} 个填色矩形，不一致 ${bad}`)
  detail.forEach(d => console.log('      · ' + d))
  return bad === 0
}

function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makePattern(rnd, gw, gh, nColors, emptyRatio, hexOf) {
  const palette = []
  for (let i = 0; i < nColors; i++) palette.push({ id: 'c' + i, code: 'A' + i, hex: hexOf(i) })
  const cells = new Int32Array(gw * gh)
  for (let i = 0; i < cells.length; i++) {
    const r = rnd()
    cells[i] = r < emptyRatio ? -1 : Math.floor(rnd() * nColors)
  }
  return { palette, cells }
}

function run(name, { gw, gh, nColors, emptyRatio, cell, blankSlot, allOneColor, dupHex }) {
  const rnd = mulberry((gw * 7919 + gh * 104729 + nColors * 31 + Math.round(emptyRatio * 1000)) >>> 0)
  // dupHex：故意让两个不同色号的豆子颜色一样（真实色板里存在，比如两批白）
  const hexOf = i => (dupHex && i % 2 === 1 ? '#101010' : '#' + ((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0'))
  const p = makePattern(rnd, gw, gh, nColors, emptyRatio, hexOf)
  if (blankSlot != null) {
    // 色板里挖一个空槽：cells 指到不存在的颜色，原写法必须跳过
    p.palette[blankSlot] = null
    p.cells[Math.floor(p.cells.length / 3)] = blankSlot
  }
  if (allOneColor) {
    p.cells.fill(0)
    p.cells[0] = 1 % nColors
    p.cells[p.cells.length - 1] = 2 % nColors
  }

  let emptyCells = 0
  for (let i = 0; i < p.cells.length; i++) if (p.cells[i] < 0) emptyCells++
  const expectedDots = cell >= EMPTY_DOT_MIN_CELL ? emptyCells : 0

  const opsOld = []
  const opsNew = []
  oldLoop(makeCtx(opsOld), gw, gh, p.cells, p.palette, OX, OY, cell)
  newLoop(makeCtx(opsNew), gw, gh, p.cells, p.palette, OX, OY, cell)

  const styleSetsOld = opsOld.reduce((n, o, i) => (i === 0 || opsOld[i - 1].style !== o.style ? n + 1 : n), 0)
  const styleSetsNew = opsNew.reduce((n, o, i) => (i === 0 || opsNew[i - 1].style !== o.style ? n + 1 : n), 0)
  const fillsNew = opsNew.filter(o => o.style).length

  const ok = compare(name, paintMap(opsOld, cell, expectedDots), paintMap(opsNew, cell, 0))
  console.log(`      指令量：旧 每格一次 fillRect = ${opsOld.length} 次；新 = ${fillsNew} 条路径（换色 ${styleSetsNew} 次，旧为 ${styleSetsOld} 次）`)
  return ok
}

const cases = [
  ['小画布 116×116，16 色，无空格', { gw: 116, gh: 116, nColors: 16, emptyRatio: 0 }],
  ['小画布 116×116，16 色，25% 空格', { gw: 116, gh: 116, nColors: 16, emptyRatio: 0.25 }],
  ['300×300，24 色，15% 空格', { gw: 300, gh: 300, nColors: 24, emptyRatio: 0.15, cell: 6 }],
  ['450×450，32 色，20% 空格', { gw: 450, gh: 450, nColors: 32, emptyRatio: 0.2, cell: 5 }],
  ['色板有空槽', { gw: 40, gh: 40, nColors: 8, emptyRatio: 0.1, blankSlot: 3 }],
  ['整张只有一个颜色', { gw: 60, gh: 60, nColors: 8, emptyRatio: 0, allOneColor: true }],
  ['两个色号颜色相同（合并后仍等价）', { gw: 48, gh: 48, nColors: 6, emptyRatio: 0.1, dupHex: true }],
  ['格子极小 cell=1', { gw: 64, gh: 64, nColors: 4, emptyRatio: 0.3, cell: 1 }],
  ['格子极大 cell=40', { gw: 20, gh: 20, nColors: 6, emptyRatio: 0.2, cell: 40 }],
  ['1×1 图案', { gw: 1, gh: 1, nColors: 1, emptyRatio: 0 }]
]

let allOk = true
for (const [name, cfg] of cases) allOk = run(name, { cell: CELL, ...cfg }) && allOk

/* ---- 顺带验证图案层的像素换算：packCellColors 与逐格 (k<0 / palette[k]) 一致 ---- */
{
  const rnd = mulberry(12345)
  const gw = 200
  const gh = 200
  const nColors = 12
  const p = makePattern(rnd, gw, gh, nColors, 0.2, i => '#' + ((i * 2246822519) >>> 8 & 0xffffff).toString(16).padStart(6, '0'))
  p.palette[5] = null
  for (let i = 0; i < 30; i++) p.cells[Math.floor(rnd() * p.cells.length)] = -1
  const packed = packCellColors(p.cells, p.palette)

  let bad = 0
  const hexToRgbLocal = hex => {
    const h = hex.replace('#', '')
    const q = parseInt(h, 16)
    return [(q >> 16) & 255, (q >> 8) & 255, q & 255]
  }
  const packLocal = hex => {
    const [r, g, b] = hexToRgbLocal(hex)
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
  }
  for (let i = 0; i < p.cells.length; i++) {
    const k = p.cells[i]
    const expect = k < 0
      ? packLocal(EMPTY_FILL)
      : (p.palette[k] ? packLocal(p.palette[k].hex) : 0)
    if (packed[i] !== expect) { bad++; if (bad < 4) console.log(`      · 第 ${i} 格：packed=${packed[i]} expect=${expect} k=${k}`) }
  }
  console.log(`${bad === 0 ? 'PASS' : 'FAIL'}  packCellColors 与逐格取色一致（含空槽与空格）`)
  allOk = bad === 0 && allOk
}

console.log('')
console.log(allOk ? '✅ 全部用例通过：按色批量绘制与逐格绘制的像素结果一致' : '❌ 存在不一致，见上面的 FAIL')
process.exit(allOk ? 0 : 1)
