/* =========================================================================
   导出链路的冒烟测试（node scripts/verify/export-smoke.mjs）

   为什么要它：export-plan.mjs 只验算数字，验不到「接线」——
   导出入口在 450×450 下会不会抛、1:1 画布外壳有没有把尺寸算对、
   打印文档里还有没有一格一个的 <td>、每板图的 mm 宽度对不对。
   这些都要跑一遍才知道，而跑它们需要 canvas —— 沙箱里没有浏览器，
   所以这里用假的 document / canvas / 2D 上下文把这些调用接住。

   ⚠️ 它只是桩，不是浏览器：
     · 不验证任何像素（桩的 2D 上下文什么都不画），只验证尺寸、体积、结构、异常；
     · render.js 要是用到了新的 canvas API，需要在这里补桩 —— 补之前这里会报错，
       那是桩过时了，不一定是业务代码坏了；
     · 探针 `prepareCanvas(probe,100,100)` 在桩里算出倍率 1（没有 devicePixelRatio），
       所以桩环境下导出的尺寸等于逻辑尺寸；真实浏览器里由 exportBufferRatio 兜住。
   ========================================================================= */

import { EMPTY } from '../../src/lib/pattern.js'

/* ---------------------------------------------------------------- DOM 桩 */
function makeCtx() {
  return new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    createImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  }, {
    get: (o, k) => (k in o ? o[k] : (() => undefined)),
    set: (o, k, v) => { o[k] = v; return true }
  })
}
let canvasCount = 0
function makeCanvas() {
  canvasCount++
  const ctx = makeCtx()
  const el = {
    width: 0, height: 0, style: {},
    getContext: () => ctx,
    toBlob(cb) { cb({ size: el.width * el.height }) },
    toDataURL() { return 'data:image/png;base64,AAAA' }
  }
  return el
}
const downloads = []
const printDocs = []
let lastBlob = null
globalThis.window = { devicePixelRatio: 1 }
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas()
    return {
      style: {},
      set href(v) { this._h = v },
      set download(v) { this._d = v },
      click() { downloads.push({ name: this._d, size: lastBlob ? lastBlob.size : 0 }) },
      remove() {}
    }
  },
  body: { appendChild() {}, removeChild() {} },
  execCommand: () => true
}
globalThis.URL = { createObjectURL(blob) { lastBlob = blob; return 'blob:verify' }, revokeObjectURL() {} }

const {
  exportPatternPNG, exportCleanPNG, exportSVG, exportShareCard, exportComparePNG,
  printPattern, printPlan, pngExportPlan, buildPrintHTML, PRINT_MAX_BOARDS
} = await import('../../src/lib/exporters.js')

let failed = 0
function check(ok, label, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
}

function mkPattern(w, h, colors = 48, emptyShare = 0.12) {
  const palette = []
  for (let i = 0; i < colors; i++) {
    palette.push({
      id: 'c' + i,
      code: (i % 3 === 0 ? 'H' : i % 3 === 1 ? 'A' : 'B') + (i + 1),
      name: '色' + i,
      hex: '#' + ((i * 2654435761) % 0xffffff).toString(16).padStart(6, '0')
    })
  }
  const cells = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if ((x * 7 + y * 13) % 100 < emptyShare * 100) { cells[i] = EMPTY; continue }
      cells[i] = ((((x >> 2) * 31 + (y >> 2) * 17) % colors) + colors) % colors
    }
  }
  return { width: w, height: h, cells, palette, stats: { beadCount: w * h } }
}

/* ------------------------------------------------- 1:1 外壳与设备 DPR 无关 */
console.log('\n1:1 画布外壳：导出的像素尺寸必须和 devicePixelRatio 无关')
for (const dpr of [1, 1.25, 1.5, 2, 3]) {
  globalThis.window.devicePixelRatio = dpr
  for (const n of [116, 450]) {
    const p = mkPattern(n, n)
    const res = exportPatternPNG(p, { projectName: 'verify' })
    const want = pngExportPlan(p, 24).geometry
    check(
      res.ok === true && res.width === want.width && res.height === want.height,
      `DPR=${dpr} ${n}×${n} → ${want.width}×${want.height}`,
      `实际 ${res.width}×${res.height}`
    )
  }
}

/* ------------------------------------------------- 全链路不抛 + 文案与尺寸 */
console.log('\n各导出入口（文本里必须带真实数字）')
globalThis.window.devicePixelRatio = 2
const expectCell = { 116: 24, 300: 13, 450: 8, 464: 8 }
for (const n of [116, 300, 450, 464]) {
  const p = mkPattern(n, n)
  const png = exportPatternPNG(p, { projectName: 'verify', cell: 24, codes: true })
  check(png.ok && png.cell === expectCell[n], `${n}×${n} PNG cell=${png.cell}`, png.message)
  check(!png.ok || new RegExp(`${png.width}×${png.height} 像素`).test(png.message), `${n}×${n} PNG 文案带实际像素`)
  if (n > 116) check(/PDF 分板/.test(png.message), `${n}×${n} PNG 降档时导流到 PDF 分板`)

  const clean = exportCleanPNG(p, { projectName: 'verify' })
  check(clean.ok && clean.width > 0, `${n}×${n} 纯图案 PNG ${clean.width}×${clean.height}`, clean.message)

  const svg = exportSVG(p, { projectName: 'verify', cell: 12, codes: false })
  check(svg.ok && svg.bytes > 0 && /约 [\d.]+ MB/.test(svg.message), `${n}×${n} SVG ${(svg.bytes / 1048576).toFixed(2)}MB`, svg.message)

  const card = exportShareCard(p, { projectName: 'verify' })
  check(card.ok && /分享卡/.test(card.message), `${n}×${n} 分享卡`, card.message)
  if (n > 280) check(/缩略图/.test(card.message), `${n}×${n} 分享卡说明是缩略展示`)

  const cmp = exportComparePNG(p, { projectName: 'verify' })
  check(cmp.ok && cmp.width === 1600, `${n}×${n} 对比图 ${cmp.width}×${cmp.height}`, cmp.message)
}

/* ------------------------------------------------- 打印文档结构与 1:1 尺寸 */
console.log('\n打印文档：每板一张位图，不能再出现「一格一个 <td>」')
globalThis.window.open = () => ({ document: { open() {}, write(h) { printDocs.push(h) }, close() {} } })
/* 纸面口径（lib/boardSpec.js）：一钉 = 一格 = 一颗豆，所以 1 格 = 豆径。
   这些假图纸不带 beadKey → 默认豆径 2.6mm（2.6mm 小豆）；分板规格按 boardSpecOf 推导：
   116 格 → 29 格老规格（116 = 4 × 29）、300 / 450 格 → 104 钉板（都不是 104/78/52/29 的倍数）。
   每页板图的纸面宽度 = (该页格数 × cell + 两边标尺) × 豆径 / cell；
   标尺宽 = max(14, round(cell × 1.7))（render.js drawBoard 的 R，和整图导出用的 drawChart 标尺 1.8× 不是一回事）。

   ⚠️ 旧断言写死的是「29 格 × 5mm = 145mm 格子区 + 两边标尺 ≈ 162mm，且任何一块板都 ≤ A4 可打印 190mm」。
   新口径下 300 / 450 格按 104 钉板分板，一块板就是 104 × 2.6mm = 270.4mm 格子区、纸面 279.3mm ≈ 27.9cm，
   **比 A4 竖版可打印宽度 19cm（横版 27.7cm）还宽** —— 「每块板都放进 A4」这条前提对 104 钉板不再成立。
   产品侧（MaterialsView 的 printPaper）现在按纸幅判档：≤19cm 走 A4 竖版、≤27.7cm 走 A4 横版、
   ≤40cm 走 A3 横版，更宽才提示「1:1 请用 A3 或按纸幅分条打印，或者换小一档画布」。所以下面改成：
     ① 精确数字：每页宽度必须等于「格数 × 豆径 + 两边标尺」，一格不多一格不少；
     ② 边缘半块板必须按实际格数变窄；
     ③ 纸幅：放得进 A4 的必须真的 ≤190mm；放不进 A4 的必须仍落在 A3 横版（≤400mm）这一档，
        否则连一张能整页 1:1 放下的纸都没有了（那就只剩分条打印，属于要重写文案的口径变化）。 */
const BEAD_MM = 2.6
/* 纸幅门槛跟着 MaterialsView 的 printPaper 走（A4 竖版 / A4 横版 / A3 横版）。
   两边毫米数略有出入不是错：printPaper 用固定的「+9mm 标尺」估个约数，
   这里用精确标尺（2 × max(14, round(cell × 1.7)) px 折算），两种算法落在同一档纸幅上。 */
const PAPER_MM = [
  { name: 'A4 竖版', max: 190 },
  { name: 'A4 横版', max: 277 },
  { name: 'A3 横版', max: 400 }
]
const paperOf = mm => (PAPER_MM.find(p => mm <= p.max) || {}).name || ''
const A4_PRINTABLE_MM = PAPER_MM[0].max
const boardRulerPx = cell => Math.max(14, Math.round(cell * 1.7))
const pageWidthMm = (cells, cell, beadMm = BEAD_MM) => +((cells * cell + 2 * boardRulerPx(cell)) * beadMm / cell).toFixed(1)
const PAPER_OVERFLOW = []
for (const n of [116, 300, 450]) {
  const p = mkPattern(n, n)
  printDocs.length = 0
  downloads.length = 0
  const res = printPattern(p, { projectName: 'verify' })
  const html = printDocs[0] || ''
  const plan = printPlan(p)
  const boards = plan.count
  check(res.ok === true && html.length > 0, `${n}×${n} 打开了打印文档`, res.message)
  // 材料清单表本身有 td（几十行），分板格子不能有 —— 用「td 数远小于格子数」来卡
  const tds = (html.match(/<td/g) || []).length
  check(tds < 400, `${n}×${n} 没有逐格 <td>（td=${tds}）`)
  const imgs = (html.match(/<img/g) || []).length
  check(imgs === boards + 1, `${n}×${n} 板图数量 = ${boards} 页 + 1 张封面`, `img=${imgs}`)

  const widths = [...html.matchAll(/class="boardImg" style="width:([\d.]+)mm"/g)].map(m => +m[1])
  check(widths.length === boards, `${n}×${n} 每一页都带纸面宽度`, `widths=${widths.length} / boards=${boards}`)
  const want = plan.boards.map(b => pageWidthMm(b.w, plan.cell))
  check(widths.length === want.length && widths.every((w, i) => w === want[i]),
    `${n}×${n} 每页纸面宽度 = 格数 × 豆径 ${BEAD_MM}mm + 两边标尺`,
    `实际 ${widths.join(', ')}mm / 期望 ${[...new Set(want)].join(', ')}mm`)

  const mm = [...new Set(widths)]
  const partial = plan.boards.some(b => b.w < plan.layout.boardW || b.h < plan.layout.boardH)
  check(partial ? mm.length > 1 : mm.length === 1,
    `${n}×${n} ${partial ? '边缘半块板按实际格数变窄' : '全图都是整板，只有一档宽度'}`,
    `宽度集合 ${mm.join(', ')}mm`)

  /* 纸幅的账（见文件内注释 ③）：这一页最宽多少毫米、落在哪一档纸上 */
  const widestCells = Math.max(...plan.boards.map(b => b.w))
  const widestMm = pageWidthMm(widestCells, plan.cell)
  const widest = Math.max(...widths)
  check(widest === widestMm, `${n}×${n} 最宽一页 ${widest}mm = ${widestCells} 格 × ${BEAD_MM}mm + 标尺`)
  const paper = paperOf(widestMm)
  if (widestMm <= A4_PRINTABLE_MM) {
    check(mm.every(w => w <= A4_PRINTABLE_MM), `${n}×${n} 每页都在 A4 可打印范围（≤${A4_PRINTABLE_MM}mm）内`, `宽度集合 ${mm.join(', ')}mm`)
    check(paper === 'A4 竖版', `${n}×${n} 最宽一页判成 A4 竖版（${widestMm}mm ≈ ${(widestMm / 10).toFixed(1)}cm）`)
  } else {
    check(paper !== '', `${n}×${n} 最宽一页 ${widestMm}mm 仍落在一档纸幅内：${paper || '没有任何纸能整页放下'}`)
    PAPER_OVERFLOW.push(`${n}×${n}：最宽一块 ${widestCells} 格 = ${widestMm}mm ≈ ${(widestMm / 10).toFixed(1)}cm → ${paper}；` +
      `A4 竖版 ${(PAPER_MM[0].max / 10).toFixed(1)}cm / 横版 ${(PAPER_MM[1].max / 10).toFixed(1)}cm 都放不下`)
  }
}
if (PAPER_OVERFLOW.length) {
  console.log('\n纸幅告警（不是断言失败：这些画布 1:1 打不进 A4，产品文案已按纸幅给出路）：')
  for (const line of PAPER_OVERFLOW) console.log(`  ⚠ ${line}`)
  console.log('  104 钉板 × 2.6mm 小豆 = 270.4mm 格子区 + 标尺 ≈ 279mm ≈ 27.9cm ——')
  console.log('  MaterialsView 的 printPaper 会判成「A3 横版」，并按「1:1 请用 A3 或按纸幅分条打印，或者换小一档画布」提示用户。')
}

/* 老存档口径不回归：116×116 是 29 格老规格（autoBeadKey → 任一轴退到 29 就按 5mm 中号豆），
   它必须还是「29 格 × 5mm + 两边标尺 = 162.1mm / 16 页 / 放得进 A4 竖版」——
   这正是改动前那条写死「满板整图约 162mm」的断言，现在按真实豆径（5mm）写回去。
   上面那一轮验的是「pattern 不带 beadKey → 默认 2.6mm 小豆」那条兜底，两条路都得对。 */
{
  const p = Object.assign(mkPattern(116, 116), { beadKey: '5', cmPerBead: 0.5 })
  printDocs.length = 0
  const res = printPattern(p, { projectName: 'verify' })
  const html = printDocs[0] || ''
  const plan = printPlan(p)
  const mm = [...new Set([...html.matchAll(/class="boardImg" style="width:([\d.]+)mm"/g)].map(m => +m[1]))]
  const legacyMm = pageWidthMm(plan.layout.boardW, plan.cell, 5)
  check(res.ok === true && plan.count === 16 && plan.cell === 24,
    `116×116 老存档（5mm 中号豆）→ ${plan.count} 页 / 每板 ${plan.cell} px`, res.message)
  check(mm.length === 1 && mm[0] === legacyMm,
    `老存档满板整图 ${legacyMm}mm（29 格 × 5mm + 两边标尺，改动前就是这一档 162mm）`,
    `实际 ${mm.join(', ')}mm`)
  check(legacyMm <= A4_PRINTABLE_MM,
    `老存档一块板仍放得进 A4 竖版（${legacyMm}mm ≤ ${A4_PRINTABLE_MM}mm）`)
}

/* ------------------------------------------------- 超页数上限 */
console.log(`\n页数上限（${PRINT_MAX_BOARDS} 页）`)
{
  /* 29 格老规格的整数倍（29×20 × 29×13 = 580×377）：按 lib/boardSpec.js 的 autoBeadKey，
     两轴都退到 29 格老规格 → 5mm 中号豆，所以把豆径字段带上，拒绝文案里的毫米数才是真实口径。
     页数与豆径无关（分板规格只由 boardSpecOf 决定），这条断言仍然靠 20×13 = 260 > 256 成立。 */
  const huge = Object.assign(mkPattern(29 * 20, 29 * 13), { beadKey: '5', cmPerBead: 0.5 })
  printDocs.length = 0
  globalThis.window.open = () => { throw new Error('超上限时不该开打印窗口') }
  const res = printPattern(huge, { projectName: 'verify' })
  check(res.ok === false && /未生成/.test(res.message), '超上限 → 拒绝且不开窗口', res.message)
  // 老规格画布（两轴都退到 29）必须是 5mm 中号豆：这条正是「104 钉板配 5mm」那种自相矛盾的反面，
  // 拒绝文案里的豆径与成品厘米都得走 pattern 上的口径，不能回落到默认 2.6mm
  check(/1 格 = 5 mm（5mm 中号豆）/.test(res.message), '老规格画布按 5mm 中号豆算（autoBeadKey 口径）', res.message)
  check(buildPrintHTML(huge, { projectName: 'verify' }) === '', '超上限 → buildPrintHTML 返回空串')
  check(printDocs.length === 0, '超上限 → 没有写出任何文档')
}

console.log(failed ? `\n${failed} 项不通过\n` : `\n全部通过（本次共创建 ${canvasCount} 张桩画布）\n`)
process.exitCode = failed ? 1 : 0
