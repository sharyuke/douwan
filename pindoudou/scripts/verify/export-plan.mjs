/* =========================================================================
   导出链路的规格守卫（node scripts/verify/export-plan.mjs）

   为什么要有这个脚本：导出这块的「正确答案」全是一串数字 ——
   PNG 单边 ≤ 4096 px / 总量 ≤ 1600 万像素、SVG 安全线 16 MB 与硬上限 20 MB、
   分板 PDF 每板一档分辨率且最多 256 页。这些数字一旦被后人改松，症状是
   「用户点了导出，浏览器卡死 / 内存爆掉」—— 本机跑不出来，线上也很难复现。
   所以把决定这些数字的**纯计算**（pngExportPlan / printPlan / estimateSvgBytes /
   exportSVG 的取舍）固定成断言，改坏了这里当场就红。

   不测什么：真实像素。画布要浏览器，本脚本只跑不依赖 canvas 的部分
   （exportSVG 走到底只用 downloadText，给它一个假的 <a> 就够）。
   ========================================================================= */

import { toSVG, estimateSvgBytes, EMPTY } from '../../src/lib/pattern.js'
import { pngExportPlan, printPlan, exportSVG, PNG_MAX_SIDE, PNG_MAX_PIXELS, SVG_MAX_BYTES, PRINT_MAX_BOARDS } from '../../src/lib/exporters.js'

/* ---------------------------------------------------------------- 运行环境桩 */
/* 只桩 <a> 与 createObjectURL：这条链路本来就不碰画布，桩得越少越可信 */
const downloads = []
let lastBlob = null
globalThis.URL = {
  createObjectURL(blob) { lastBlob = blob; return 'blob:verify' },
  revokeObjectURL() {}
}
globalThis.document = {
  createElement: () => ({
    style: {},
    set href(v) {},
    set download(v) { this._n = v },
    click() { downloads.push({ name: this._n, size: lastBlob ? lastBlob.size : 0 }) },
    remove() {}
  }),
  body: { appendChild() {} }
}

let failed = 0
function check(ok, label, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
}

/* ---------------------------------------------------------------- 假图纸 */
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

/* ---------------------------------------------------------------- PNG 计划 */
console.log(`\nPNG：单边 ≤ ${PNG_MAX_SIDE} px、总量 ≤ ${PNG_MAX_PIXELS / 1e4} 万像素`)
for (const n of [29, 58, 116, 232, 300, 450, 464]) {
  const plan = pngExportPlan(mkPattern(n, n), 24)
  const g = plan.geometry
  check(
    g.width <= PNG_MAX_SIDE && g.height <= PNG_MAX_SIDE && g.width * g.height <= PNG_MAX_PIXELS,
    `${n}×${n} → ${g.width}×${g.height}（${(g.width * g.height / 1e6).toFixed(2)} Mpx，cell=${plan.cell}）`
  )
  // 小图纸必须留在 24 px/格：116×116 是改动前就有的尺寸，行为不能被这次改动挪动
  if (n <= 116) check(plan.cell === 24 && !plan.reduced, `${n}×${n} 沿用 24 px/格（小画布行为不变）`)
}
{
  const g = pngExportPlan(mkPattern(116, 116), 24).geometry
  check(g.width === 2870 && g.height === 2870, '116×116 仍是 2870×2870（和改动前一致）', `${g.width}×${g.height}`)
}

/* ---------------------------------------------------------------- 分板 PDF 计划 */
console.log(`\n分板 PDF：每板一档分辨率，最多 ${PRINT_MAX_BOARDS} 页`)
/* 分板规格按 lib/boardSpec.js 推导（52 / 78 / 104 / 120 钉画线板 + 29 格老规格）：能整铺就用最大的那个，
   铺不满就取「板数最少」的规格。116 = 4×29、464 = 16×29 都还是老规格（页数不变：4×4 = 16 / 16×16 = 256）；
   300 既不是 104/78/52 的倍数、也不是 29 的倍数 → 104 与 120 都是 3×3 = 9 块，取浪费更少的 104 → 9 页；
   450 → 120 是 4×4 = 16 块（104 要 5×5 = 25 块）→ 16 页。
   780 = 10×78 → 10×10 = 100 页：新口径下 16 px 那一档（65–144 页）也得有人守着，
   旧表里这一档由 300 格的 121 页提供，所以这里换成仍然落在同一档的 780 格。 */
for (const [n, pages, cell] of [[116, 16, 24], [300, 9, 24], [450, 16, 24], [780, 100, 16], [464, 256, 12]]) {
  const p = printPlan(mkPattern(n, n))
  check(p.ok && p.count === pages && p.cell === cell, `${n}×${n} → ${p.count} 页 / 每板 ${p.cell} px`, p.message)
}
/* 档位边界：PRINT_CELL_TIERS 的三条线（≤64 页 24 px / ≤144 页 16 px / ≤256 页 12 px）两侧都不能差一页。
   用 29 格老规格造精确页数：29 与 52 / 78 / 104 互质，所以 29k 的画布一定仍按 29 分板，
   cols × rows 就是页数本身（不依赖任何其它推导）。 */
for (const [cols, rows, cell] of [[8, 8, 24], [5, 13, 16], [12, 12, 16], [16, 16, 12]]) {
  const p = printPlan(mkPattern(29 * cols, 29 * rows))
  check(p.ok && p.count === cols * rows && p.cell === cell, `${cols}×${rows} = ${cols * rows} 页 → 每板 ${cell} px（档位边界）`, `count=${p.count} cell=${p.cell}`)
}
{
  const over = printPlan(mkPattern(29 * 20, 29 * 13))
  check(over.ok === false && over.count === 260, '260 板（超过上限）→ 拒绝并说明原因')
  // 空数组沿用旧语义 = 「没指定板号」= 全打；要真的「一块都没有」得是选中的板号全部越界
  check(printPlan(mkPattern(116, 116), { boardIndexes: [] }).count === 16, 'boardIndexes: [] 沿用旧语义（= 没指定 → 全部板）')
  check(printPlan(mkPattern(116, 116), { boardIndexes: [9999] }).ok === false, '选中的板号全部无效 → 拒绝而不是生成空文档')
  const part = printPlan(mkPattern(450, 450), { boardIndexes: [0, 1, 2] })
  check(part.ok && part.count === 3 && part.cell === 24, '只选 3 块板 → 3 页 / 24 px（页数少就给清晰）')
}

/* ---------------------------------------------------------------- SVG 闸门 */
console.log('\nSVG：估算必须先于生成，且估算不得低于实际')
for (const n of [116, 232, 300, 450]) {
  const p = mkPattern(n, n)
  for (const codes of [false, true]) {
    const real = toSVG(p, { cell: 12, withGrid: true, withCodes: codes, withRuler: true, boardSize: 29 }).length
    const est = estimateSvgBytes(p, { cell: 12, withGrid: true, withCodes: codes, withRuler: true, boardSize: 29 })
    // 估算是闸门的唯一依据：一旦低于实际，就可能放过一个超过硬上限的文件
    check(est >= real, `${n}×${n} codes=${codes ? 'Y' : 'N'} 估算 ≥ 实际`, `${(est / 1048576).toFixed(2)} MB vs ${(real / 1048576).toFixed(2)} MB`)
  }
}

console.log('\nexportSVG 的取舍（调用方要求带色号）')
for (const n of [116, 300, 450, 464]) {
  const p = mkPattern(n, n)
  downloads.length = 0
  const res = exportSVG(p, { projectName: 'verify', cell: 12, codes: true })
  check(res.ok === true, `${n}×${n} 有结果`, `ok=${res.ok}`)
  if (res.ok) {
    check(res.bytes <= SVG_MAX_BYTES, `${n}×${n} 体积 ≤ 硬上限`, `${(res.bytes / 1048576).toFixed(2)} MB`)
    check(downloads.length === 1 && downloads[0].size === res.bytes, `${n}×${n} 落盘字节数与回传一致`)
    check(res.droppedCodes === (n >= 300), `${n}×${n} 只有大画布丢色号`, `droppedCodes=${res.droppedCodes}`)
  } else {
    // 拒绝也必须是「理由清楚」的拒绝，不能只返回 false
    check(/未导出/.test(res.message) && /MB/.test(res.message), `${n}×${n} 拒绝时说明体积理由`, res.message)
  }
}

console.log(failed ? `\n${failed} 项不通过\n` : '\n全部通过\n')
process.exitCode = failed ? 1 : 0
