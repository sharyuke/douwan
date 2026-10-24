/* =========================================================================
   1000×1000（画布单边新上限）下的导出规格守卫
   跑法：node scripts/verify/export-plan-1000.mjs

   为什么单独一个脚本：export-plan.mjs 守的是「数字没被后人改松」，它跑的全是 ≤464 格的
   **旧**上限。画布单边放到 1000 格之后，三条导出链的正确行为都变了，而且是三种不同的结局：
     · 图纸 PNG：能导，但每格降到 3 px（4 px/格 是 4026×4026 = 16.21 Mpx，比 1600 万像素的墙
       多出 21 万 —— 多出来的正是 chartGeometry 两边各 13 px 的标尺），最终 3026×3026；
     · SVG：必拒绝（估算 ≈ 55 MB 不带色号），而且文案必须报出真实 MB 与图元个数，并指路 PNG；
     · 分板 PDF：能出图（1000 格铺不满任何规格 → 取「板数最少」的 120 钉画线板，ceil(1000/120) = 9 → 9×9 = 81 页，
       落在 ≤144 页的 16 px 档），但**超过 256 页仍然必须拒绝** —— 这条门禁改由 29 格老规格的
       580×377（20×13 = 260 块）继续守着，文案要带页数 / 上限 / 原因（157 MB）/ 替代（图纸 PNG、只打选中的板）；
     · Pattern JSON：能导，但是 10 MB 量级的文本，必须把真实体积报给用户。
   这些都是「用户点了导出之后会发生什么」，本机不跑就没人知道；所以固定成断言，
   顺便把真实数字打印出来，方便对着文案核。失败 process.exit(1)。

   桩：canvas 只桩尺寸与不抛异常（不验像素），300×300 以上一次绘制是几十万次 no-op 调用，
   这个脚本因此比 export-plan.mjs 慢几秒 —— 换来的是「1000 格下真的不炸」这一条能自动跑。
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { EMPTY, estimateSvgBytes, toPatternJSON, BOARD_SIZE } from '../../src/lib/pattern.js'
import { chartGeometry } from '../../src/lib/render.js'
import {
  pngExportPlan, printPlan, exportSVG, exportPatternJSON, exportCleanPNG, exportPatternPNG,
  buildPrintHTML, printPattern, PNG_MAX_SIDE, PNG_MAX_PIXELS, SVG_SINGLE_BYTES, SVG_MAX_BYTES,
  PRINT_MAX_BOARDS
} from '../../src/lib/exporters.js'

/* ---------------------------------------------------------------- 运行环境桩 */
function makeCtx() {
  /* 未知方法统一返回同一个 noop 函数：1000×1000 一次绘制是百万次调用，
     每次 get 都新建闭包会让这个脚本多跑十几秒（桩也要讲成本） */
  const noop = () => undefined
  return new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    createImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  }, {
    get: (o, k) => (k in o ? o[k] : noop),
    set: (o, k, v) => { o[k] = v; return true }
  })
}
/* failPreview 计数：只让「封面的那张预览图」toDataURL 抛错。
   注意不能做成「所有 canvas 都抛」—— 板图失败**应该**抛出去让 printPattern 报错，
   这里要验的是「封面预览是锦上添花，坏了不能拖垮整份文档」这一条。 */
let failPreviewCalls = 0
let canvasCount = 0
function makeCanvas() {
  canvasCount++
  const ctx = makeCtx()
  return {
    width: 0, height: 0, style: {},
    getContext: () => ctx,
    toBlob(cb) { cb({ size: this.width * this.height }) },
    toDataURL() {
      if (failPreviewCalls > 0) { failPreviewCalls--; throw new Error('stub: 预览图绘制失败') }
      return 'data:image/png;base64,AAAA'
    }
  }
}
const downloads = []
const printDocs = []
let lastBlob = null
/* devicePixelRatio 固定 1：桩里 exportBufferRatio 反推出来就是 1，
   导出的逻辑尺寸 = 缓冲尺寸，断言里的数字才是可读的「图纸像素」 */
globalThis.window = { devicePixelRatio: 1, open: () => ({ document: { open() {}, write(h) { printDocs.push(h) }, close() {} } }) }
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
  return { width: w, height: h, cells, palette, stats: { beadCount: w * h, colorCount: colors } }
}

const P1000 = mkPattern(1000, 1000)
const P464 = mkPattern(464, 464)
const P116 = mkPattern(116, 116)
/* 超过 256 页上限的样本必须自己造：29 格老规格的整数倍 29×20 × 29×13 = 580×377 → 20×13 = 260 块。
   1000 格在新口径下只有 81 块（120 钉画线板），已经造不出超限画布了。
   豆径字段按 lib/boardSpec.js 的 autoBeadKey 带上：任一轴退到 29 格老规格就是 5mm 中号豆
   （580 = 20×29、377 = 13×29，两轴都是老规格），所以拒绝文案里的「1 格 = ? mm」与成品厘米
   走的是真实口径，而不是「没带 beadKey 就默认 2.6mm」那条兜底。 */
const P260 = Object.assign(mkPattern(29 * 20, 29 * 13), { beadKey: '5', cmPerBead: 0.5 })

/* ---------------------------------------------- ① 图纸 PNG：1000 格要能导且不越线 */
console.log(`\n① 图纸 PNG（单边 ≤ ${PNG_MAX_SIDE} px、总量 ≤ ${PNG_MAX_PIXELS / 1e4} 万像素）`)
const pngPlans = {}
for (const [n, p] of [[1000, P1000], [464, P464], [116, P116]]) {
  const plan = pngExportPlan(p, 24)
  pngPlans[n] = plan
  const g = plan.geometry
  console.log(`     ${n}×${n} → cell=${plan.cell}，${g.width}×${g.height}（${(g.width * g.height / 1e6).toFixed(2)} Mpx），ruler=${g.ruler}px/边`)
  check(g.width <= PNG_MAX_SIDE && g.height <= PNG_MAX_SIDE && g.width * g.height <= PNG_MAX_PIXELS,
    `${n}×${n} 落在两条上限之内`)
}
{
  // 「4 px/格 应该是 4000×4000」是个常见的误算：标尺两边各占 13 px，实际是 4026×4026。
  // 这里把这条算式钉住 —— 哪天有人为了让 1000 格「正好 4000」去动标尺，这里会先红。
  const four = chartGeometry(P1000, { cell: 4, ruler: true })
  check(four.width * four.height > PNG_MAX_PIXELS,
    `4 px/格 = ${four.width}×${four.height}（${(four.width * four.height / 1e6).toFixed(2)} Mpx）> ${PNG_MAX_PIXELS / 1e4} 万像素，所以只能落到 3 px/格`,
    `标尺两边各 ${four.ruler} px，格子区 4000 px`)
  check(pngPlans[1000].cell === 3 && pngPlans[1000].geometry.width === 3026 && pngPlans[1000].geometry.height === 3026,
    '1000×1000 的结论：cell=3 / 3026×3026')
  check(pngPlans[464].cell === 8, `464×464 → cell=${pngPlans[464].cell}（和旧上限下的行为一致）`)
  check(pngPlans[116].cell === 24 && !pngPlans[116].reduced, '116×116 仍是 24 px/格（小画布行为不变）')
}

/* ---------------------------------------------- ② 分板 PDF：1000 格能出图，超 256 页仍必须拒绝 */
console.log(`\n② 分板 PDF（页数上限 ${PRINT_MAX_BOARDS} 页；每板规格由 boardSpecOf 推导）`)
{
  /* 1000 不是 104 / 120 / 78 / 52 / 29 中任何一个的倍数 → 取「板数最少」的规格 = 120（9×9 = 81 块；
     104 要 10×10 = 100 块），落在 PRINT_CELL_TIERS 的 ≤144 页档（16 px）。
     这是这次口径改造的回归：老口径按 29 分板是 35×35 = 1225 页，必然被拒。 */
  const plan = printPlan(P1000)
  const bs = plan.layout.boardSize
  console.log(`     1000×1000 → ${plan.count} 页（${plan.layout.cols}×${plan.layout.rows} 块，每块 ${bs.x}×${bs.y}），ok=${plan.ok}`)
  check(plan.ok === true, '1000×1000 → 出图（81 块 ≤ 256 页上限，不再被拒）', plan.message)
  check(plan.count === 81 && plan.total === 81, `页数/板数都是 81（${plan.count} / ${plan.total}）`)
  check(bs.x === 120 && bs.y === 120, `分板规格按画布推导成 120 钉画线板（${bs.x}×${bs.y}）`)
  check(plan.cell === 16, `81 页落在 ≤144 页那一档 → 每板 ${plan.cell} px`, plan.message)
  check(/共 81 页/.test(plan.message) && /120 × 120 插钉/.test(plan.message) && /每板 16 px\/格/.test(plan.message),
    '成功文案带页数 / 分板规格 / 每板分辨率')
  console.log(`     成功文案：${plan.message}`)
}
{
  /* 「超过 256 页必须拒绝」这条门禁不能因为 1000 格变合法而消失。
     580×377 = 20×13 = 260 块是 29 格老规格的整数倍，所以它稳稳落在 29 分板上（不随新口径漂移）。 */
  const plan = printPlan(P260)
  const bs = plan.layout.boardSize
  console.log(`     580×377 → ${plan.count} 页（${plan.layout.cols}×${plan.layout.rows} 块，每块 ${bs.x}×${bs.y}），ok=${plan.ok}`)
  check(plan.ok === false, '260 页（> 256 页上限）→ 拒绝（不生成文档）')
  check(plan.count === 260 && plan.total === 260, `页数/板数都是 260（${plan.count} / ${plan.total}）`)
  check(plan.message.includes('260') && plan.message.includes(String(PRINT_MAX_BOARDS)),
    `拒绝文案带上「这次要出 260 页」与上限 ${PRINT_MAX_BOARDS}`)
  check(/157 MB/.test(plan.message) && /打印预览/.test(plan.message), '拒绝文案说清为什么（256 页 ≈ 157 MB 内存 / 打印预览会崩）')
  check(/580×377 格 = 260 块拼板（20 列 × 13 行，每块 老规格方板）/.test(plan.message) &&
    /1 格 = 5 mm（5mm 中号豆）/.test(plan.message) && /成品约 290 × 189 cm/.test(plan.message),
    '拒绝文案带上当前画布 A×B 格 = N 块板、豆径（老规格 = 5mm 中号豆）与成品尺寸')
  check(/图纸 PNG/.test(plan.message) && /勾选/.test(plan.message), '拒绝文案给出替代路径（图纸 PNG / 勾选要打的板）')
  console.log(`     拒绝原文：${plan.message}`)
}
{
  // 传了 boardIndexes（用户在分板视图勾过板）时，必须提示「减到 256 块以内分批打」这条路。
  // 勾选的板号只能在 260 块那张画布上取：1000 格只有 100 块，勾不出超限的一批（那属于上面那条正常出图）
  const idx = Array.from({ length: 260 }, (_, i) => i)
  const part = printPlan(P260, { boardIndexes: idx })
  check(part.ok === false && part.count === 260, '勾选 260 块板 → 仍然拒绝（260 > 256）')
  check(/勾选了 260 块板/.test(part.message) && /256 块以内分批打印/.test(part.message),
    '传了 boardIndexes 时提示「分批打印」这条具体路径')
}
{
  const ok = printPlan(P464)
  check(ok.ok === true && ok.count === 256 && ok.cell === 12, `464×464 → ${ok.count} 页 / 每板 ${ok.cell} px（旧上限正好用满）`)
  const few = printPlan(P1000, { boardIndexes: [0, 1, 2, 3] })
  check(few.ok === true && few.count === 4 && few.cell === 24, '1000 格上只打 4 块板 → 仍然可以打（4 页 / 24 px）')
}

/* ---------------------------------------------- ③ SVG：估算与拒绝文案 */
console.log(`\n③ SVG（安全线 ${SVG_SINGLE_BYTES / 1048576} MB / 硬上限 ${SVG_MAX_BYTES / 1048576} MB）`)
const MB = b => b / 1048576
for (const codes of [false, true]) {
  const est = estimateSvgBytes(P1000, { cell: 12, withGrid: true, withCodes: codes, withRuler: true, boardSize: BOARD_SIZE })
  console.log(`     1000×1000 cell=12 codes=${codes ? 'Y' : 'N'} → 估算 ${MB(est).toFixed(1)} MB`)
  check(est > SVG_SINGLE_BYTES, `codes=${codes ? 'Y' : 'N'} 的估算 ${MB(est).toFixed(1)} MB 超过安全线（闸门必须拒绝）`)
}
for (const codes of [false, true]) {
  const res = exportSVG(P1000, { projectName: 'verify', cell: 12, codes })
  check(res.ok === false, `exportSVG(codes=${codes ? 'Y' : 'N'}) 在 1000×1000 下拒绝`, `bytes=${MB(res.bytes).toFixed(1)} MB`)
  check(/约 [\d.]+ MB/.test(res.message) && /超过单文件/.test(res.message), '拒绝文案报出实际估算 MB')
  check(/个图元/.test(res.message) && /最多 1,000,000 格/.test(res.message), '拒绝文案说清「一格一个 <rect>」与图元/格数')
  check(/图纸 PNG」（这张画布导出 3026×3026 像素）/.test(res.message), '拒绝文案指路图纸 PNG，并带上这张画布的真实导出尺寸')
  if (codes) console.log(`     拒绝原文：${res.message}`)
}
{
  // 464 格带色号：估算 40 MB 量级 → 丢色号后仍能导出（旧行为不能被这次改动挪动）
  const res = exportSVG(P464, { projectName: 'verify', cell: 12, codes: true })
  check(res.ok === true && res.droppedCodes === true, '464×464 带色号 → 丢色号后照给（旧行为不变）', res.message)
}

/* ---------------------------------------------- ④ Pattern JSON：体积必须报出来 */
console.log('\n④ Pattern JSON（100 万格 = 100 万个色号字符串）')
{
  const res = exportPatternJSON(P1000, 'verify-1000')
  console.log(`     1000×1000 → ${(res.bytes / 1048576).toFixed(2)} MB（${res.cells} 格）`)
  check(res.ok === true && res.bytes > 1024 * 1024, '仍然可以导出（不做拒绝，只是大）')
  check(res.bytes / 1048576 > 2 && res.bytes / 1048576 < 40, `体积在 2~40 MB 之间（实测 ${(res.bytes / 1048576).toFixed(2)} MB）`)
  check(new RegExp(`约 ${(res.bytes / 1048576).toFixed(1)} MB`).test(res.message), '文案里的 MB 数和 Blob 真实体积一致')
  check(downloads.some(d => d.size === res.bytes), '落盘的 Blob 就是回报的这份')
  // 用 pattern.js 自己的 toPatternJSON 交叉核对量级：估算依据是「每格一个色号 + 2 空格缩进」
  const raw = JSON.stringify(toPatternJSON(P1000, {}), null, 2).length
  const perCell = raw / res.cells
  console.log(`     交叉核对：toPatternJSON 文本 ${(raw / 1048576).toFixed(2)} MB，每格约 ${perCell.toFixed(1)} 字节（2 空格缩进下 ` + '`    "H1",\\n`' + ` = 11 字节）`)
  check(perCell > 8 && perCell < 16, `每格 ${perCell.toFixed(1)} 字节，落在「色号 + 缩进」的合理区间`)
  const small = exportPatternJSON(P116, 'verify-116')
  check(small.bytes < 1024 * 1024, `116×116 只有 ${(small.bytes / 1024).toFixed(0)} KB，不受影响`)
}

/* ---------------------------------------------- ⑤ 真跑一遍绘制链（桩 canvas） */
console.log('\n⑤ 绘制链（桩 canvas：只验「不抛 / 尺寸与结构对得上 / 文案带真实数字」）')
{
  const png = exportPatternPNG(P1000, { projectName: 'verify', cell: 24, codes: true })
  check(png.ok === true && png.cell === 3 && png.width === 3026 && png.height === 3026,
    `1000×1000 图纸 PNG → cell=${png.cell} / ${png.width}×${png.height}`, png.message)
  check(/3026×3026 像素/.test(png.message), 'PNG 文案带真实像素尺寸')
  check(/PDF 分板/.test(png.message) && /分板视图/.test(png.message), 'PNG 文案同时指路 PDF 分板与分板视图')
  console.log(`     PNG 文案：${png.message}`)

  const clean1 = exportCleanPNG(P1000, { projectName: 'verify' })
  check(clean1.width === 1000 && clean1.height === 1000, `1x 屏 1000×1000 纯图案 PNG → ${clean1.width}×${clean1.height}（cell=1，缓冲 4 MB）`)
  globalThis.window.devicePixelRatio = 2
  const clean2 = exportCleanPNG(P1000, { projectName: 'verify' })
  globalThis.window.devicePixelRatio = 1
  check(clean2.width === 2000 && clean2.height === 2000, `2x 屏 → ${clean2.width}×${clean2.height}（dpr 2 是上限，缓冲 16 MB，不会爆）`)
  check(/MB/.test(clean2.message) && /分板视图/.test(clean2.message), '纯图案文案报出体积并指路能看单颗豆的入口')
  console.log(`     纯图案文案：${clean2.message}`)

  const html = buildPrintHTML(P1000, { projectName: 'verify', boardIndexes: [0, 1, 2] })
  const imgs = (html.match(/<img/g) || []).length
  check(html.length > 0 && imgs === 4, `1000 格上只打 3 块板 → 文档生成成功（4 张图 = 1 封面 + 3 板）`, `img=${imgs}`)
  check(/只包含选中的 3 块板/.test(html) && /全图共 81 块/.test(html), '封面说明这份 PDF 只含选中的 3 块（全图 81 块）')

  printDocs.length = 0
  const res = printPattern(P1000, { projectName: 'verify', boardIndexes: [0, 1, 2] })
  check(res.ok === true && printDocs.length === 1, 'printPattern 在 1000 格上打子集成功', res.message)

  /* 封面预览失败不能拖垮整份文档：这是 includeCover 的兜底契约 */
  failPreviewCalls = 1
  let threw = null
  let degraded = ''
  try {
    degraded = buildPrintHTML(P1000, { projectName: 'verify', boardIndexes: [0, 1] })
  } catch (err) {
    threw = err
  }
  failPreviewCalls = 0
  check(!threw, '封面预览 toDataURL 抛错时 buildPrintHTML 不往外抛', threw ? String(threw.message) : '')
  check(degraded.length > 0 && /预览图没画出来/.test(degraded) && (degraded.match(/<img/g) || []).length === 2, '退化成没有预览图的封面，板图照旧', `img=${(degraded.match(/<img/g) || []).length}`)

  /* 1000 格 + 全部板：新口径下 81 页，能出图（老口径是 1225 页，会在这里被拒）——
     这是「画布上限放到 1000 格后分板 PDF 还能用」的那条回归。 */
  printDocs.length = 0
  const all = printPattern(P1000, { projectName: 'verify' })
  check(all.ok === true && printDocs.length === 1, '1000 格 + 全部板 → 81 页能出图，且只开一个文档', all.message)

  /* 门禁还在：超过 256 页时 printPattern 必须拒绝，而且不能先开一个空文档出来 */
  printDocs.length = 0
  const oversized = printPattern(P260, { projectName: 'verify' })
  check(oversized.ok === false && /260 页/.test(oversized.message) && printDocs.length === 0,
    '260 块（> 256 页上限）→ printPattern 拒绝且没有开出文档', oversized.message)
}

/* ---------------------------------------------- ⑥ 两个分板页面还能编译 */
/* BuildView / MaterialsView 在沙箱里跑不起来（要浏览器），但它们正是这次改动的另一半：
   1225 块板时列表要开窗、材料明细不能再一格一块地全渲染。这里只做「能不能编译」+
   几条关键规则的存在性检查 —— 和 editor-canvas-compile.mjs 一个思路。 */
/* @vue/compiler-sfc 是 @vitejs/plugin-vue 的传递依赖，项目没直接声明它：
   npm 的扁平 node_modules 下从项目根 require 得到，pnpm 的隔离布局下它只躺在
   node_modules/.pnpm/<pkg>/node_modules 里，从 scripts/ 里 require 会 MODULE_NOT_FOUND。
   两条路都试，最后再原样抛出 —— 「装了但不在解析路径上」不该让这一节变成未捕获崩溃
   （和 editor-canvas-compile.mjs 是同一个坑，那边只走第一条路所以整脚本挂在 require 上）。 */
function requireCompilerSfc() {
  const require = createRequire(import.meta.url)
  try {
    return require('@vue/compiler-sfc')
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err
    const store = path.resolve('node_modules/.pnpm')
    const dir = fs.existsSync(store)
      ? fs.readdirSync(store).find(d => d.startsWith('@vue+compiler-sfc@'))
      : null
    if (!dir) throw err
    return require(path.join(store, dir, 'node_modules', '@vue', 'compiler-sfc'))
  }
}

console.log('\n⑥ 分板 / 材料页面（@vue/compiler-sfc 编译 + 关键规则）')
{
  const sfc = requireCompilerSfc()
  const views = ['src/views/MaterialsView.vue', 'src/views/BuildView.vue']
  for (const rel of views) {
    const file = path.resolve(rel)
    const source = fs.readFileSync(file, 'utf8')
    const { descriptor, errors } = sfc.parse(source, { filename: file })
    const tpl = sfc.compileTemplate({ source: descriptor.template.content, filename: file, id: 'verify' })
    let scriptErr = 0
    try { sfc.compileScript(descriptor, { id: 'verify' }) } catch { scriptErr = 1 }
    check(errors.length === 0 && tpl.errors.length === 0 && !scriptErr,
      `${rel} 解析 / 模板 / script setup 全部编译通过`,
      [...errors, ...tpl.errors].map(e => e.message || e).join(' | '))
  }
  const mats = fs.readFileSync(path.resolve('src/views/MaterialsView.vue'), 'utf8')
  const matsTpl = mats.slice(mats.indexOf('<template>'))
  const build = fs.readFileSync(path.resolve('src/views/BuildView.vue'), 'utf8')
  const rules = [
    ['材料页：板数阈值常量（超过就按板展开）', /BOARD_DETAIL_FULL_MAX\s*=\s*200/, mats],
    ['材料页：模板里不再直接调 boardMaterials（改为 computed，一块板只算一次）', !/boardMaterials\s*\(/.test(matsTpl), mats],
    ['材料页：提供「展开全部」入口并说明代价', /展开全部/.test(mats) && /卡/.test(mats), mats],
    ['材料页：分板数量与成品尺寸来自真实 layout / stats', /layout\.count/.test(mats), mats],
    ['拼制页：板列表开窗常量', /BOARD_LIST_WINDOW\s*=\s*60/, build],
    ['拼制页：板号跳转输入', /boardNoInput/.test(build) && /jumpToBoard/.test(build), build],
    ['拼制页：进度统计节流（不要每一格都全量扫 100 万格）', /PROGRESS_SYNC_MS\s*=\s*200/, build],
    ['拼制页：整色标记大色号前有确认', /colorConfirm/.test(build), build]
  ]
  for (const [name, ok, ] of rules) check(ok, name)
}

console.log(failed ? `\n${failed} 项不通过\n` : `\n全部通过（本次共创建 ${canvasCount} 张桩画布）\n`)
process.exit(failed ? 1 : 0)
