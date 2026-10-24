/* =========================================================================
   1000×1000 格（100 万格）画布链路的纯函数验证

   为什么要有它：画布上限从 464 提到 1000 格之后，「14 px/格铺满整图」是
   14000² ≈ 1.96 亿像素 ≈ 780 MB 后备缓冲 —— 浏览器分配不出来，画布会静默
   变成一张白图（不抛异常）。所以整条链路改成按「像素预算」退倍率 + 夹格子尺寸。
   这些判断全是纯算术，能在 Node 里闭环验证，不必等浏览器：

     · resolveCanvasDpr —— 缓冲倍率是单边 16384 与总像素预算的交集，
       而且只能落在 {2,1,0.5,0.25} 档位上（非整数倍率会让 1px 格线发虚）
     · chartCellCap    —— 编辑器缩放的像素上限（超了就是白画布）
     · chartGeometry   —— cell 下限 0.5：1000 格要能整体缩进一屏
     · packCellColors  —— 缩略图位图快路径的取色规则必须与逐格 fillRect 一致

   ⚠️ 它不碰 canvas：drawPixels 的位图快路径只验到「纯数据部分」（取色表与耗时），
   真正的 drawImage 像素等价性需要浏览器，见文件末尾的说明。

   跑法：node scripts/verify/render-canvas-limits.mjs
   ========================================================================= */

import {
  EMPTY_FILL, EMPTY_DOT, MAX_CANVAS_SIDE,
  chartPixelBudget, resolveCanvasDpr, chartCellCap, chartGeometry, packCellColors,
  prepareCanvas, canvasDpr
} from '../../src/lib/render.js'

let allOk = true
function check(ok, label, detail = '') {
  if (!ok) allOk = false
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
}

const show = n => Number.isInteger(n) ? String(n) : n.toFixed(2)

function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DESKTOP = chartPixelBudget(false)
const NARROW = chartPixelBudget(true)

/* ---------------------------------------------------------------- 预算本身 */
console.log('=== 像素预算 ===')
console.log(`桌面 ${DESKTOP / 1e6} Mpx（≈ ${(DESKTOP * 4 / 1048576).toFixed(0)} MB RGBA）/ 窄屏 ${NARROW / 1e6} Mpx（≈ ${(NARROW * 4 / 1048576).toFixed(0)} MB）`)
check(DESKTOP === 24e6 && NARROW === 8e6, 'chartPixelBudget：桌面 24 Mpx / 窄屏 8 Mpx')
// 纯函数不能依赖 window：Node 里没有 window，上面两行能算出来就说明没依赖
check(typeof globalThis.window === 'undefined', 'chartPixelBudget 在 Node（无 window）里可调用')

/* ---------------------------------------- ① 1000×1000 整图的真实倍率与硬约束
   注意：这里断言的是「硬约束」，不是某个固定倍率。1000×1000 CSS 像素在 24 Mpx
   预算下 dpr=2 只占 4 Mpx，本来就没撞线；同样的图纸在 cell=14 时是 14050×14050
   CSS 像素，那时候 2 倍会顶到 2.8 万 px，单边立刻把它压到 1 倍 —— 下面两个尺寸
   一起看，才能证明「单边」和「总像素」两道墙都在生效。 */
console.log('\n=== resolveCanvasDpr：1000×1000 格整图 ===')
{
  const area1000 = resolveCanvasDpr(1000, 1000, 2, DESKTOP)
  const plain = resolveCanvasDpr(14050, 14050, 2, DESKTOP)
  const narrow = resolveCanvasDpr(1000, 1000, 2, NARROW)
  const narrowPlain = resolveCanvasDpr(14050, 14050, 2, NARROW)
  console.log(`1000×1000 CSS px：桌面 dpr=${area1000}（缓冲 ${1000 * area1000}² = ${(1000 * area1000) ** 2 / 1e6} Mpx）` +
    `；窄屏 dpr=${narrow}（${(1000 * narrow) ** 2 / 1e6} Mpx）`)
  console.log(`14050×14050 CSS px（1000 格 @ 14 px/格）：桌面 dpr=${plain}；窄屏 dpr=${narrowPlain}`)

  const within = (w, h, dpr, budget) => Math.round(w * dpr) <= MAX_CANVAS_SIDE &&
    Math.round(h * dpr) <= MAX_CANVAS_SIDE && Math.round(w * dpr) * Math.round(h * dpr) <= budget
  check(within(1000, 1000, area1000, DESKTOP), '1000×1000：桌面倍率满足单边与预算', `dpr=${area1000}`)
  check(within(1000, 1000, narrow, NARROW), '1000×1000：窄屏倍率满足单边与预算', `dpr=${narrow}`)
  check(narrow <= area1000, '窄屏倍率不高于桌面（预算更小只会更省）', `${narrow} ≤ ${area1000}`)
  check(plain === 0.25, '1.4 万 CSS 像素宽（1000 格 @14px）撞上总像素上限 → 退到地板 0.25', `dpr=${plain}`)
  check(narrowPlain <= plain, '同一尺寸在窄屏预算下不高于桌面', `${narrowPlain} ≤ ${plain}`)
  /* 单边 16384 只保证「画布不炸」，不保证「不超预算」：14050² 即使 1 倍也是 197 Mpx，
     现实里靠调用方先夹 cell（chartCellCap，见下一节）或导出的 PNG_MAX_SIDE 兜住 */
  const bigPx = Math.round(14050 * plain) ** 2
  console.log(`      注：14050² @ 0.25 倍是 ${(bigPx / 1e6).toFixed(1)} Mpx，< 24 Mpx 预算，代价是线宽只剩 0.25 设备像素；` +
    '编辑器里这个尺寸压根不会出现，chartCellCap 只接受 dpr ≥ 1 的级别，会把 cell 夹到 4')
}

/* ---------------------------------------------- ② 随机/边界尺寸的硬约束 */
console.log('\n=== resolveCanvasDpr：单边 ≤ 16384 且 缓冲像素 ≤ 预算（随机 + 边界）===')
{
  const rnd = mulberry(20250816)
  const sizes = [
    [1, 1], [16, 16], [100, 100], [420, 420], [640, 640], [780, 780],
    [1000, 1000], [1500, 1500], [2000, 1200],
    [4096, 4096], [8192, 8192], [16383, 16383], [16384, 16384], [20000, 300],
    [0.5, 0.5], [0, 0]
  ]
  for (let i = 0; i < 60; i++) sizes.push([1 + Math.floor(rnd() * 20000), 1 + Math.floor(rnd() * 20000)])

  let bad = 0
  let worst = { dpr: Infinity, w: 0, h: 0, px: 0 }
  const seenDpr = new Set()
  for (const [w, h] of sizes) {
    const dpr = resolveCanvasDpr(w, h, 2, DESKTOP)
    seenDpr.add(dpr)
    const bw = Math.round(w * dpr)
    const bh = Math.round(h * dpr)
    if (bw > MAX_CANVAS_SIDE || bh > MAX_CANVAS_SIDE) { bad++; console.log(`  · 单边超限 ${w}×${h} dpr=${dpr} → ${bw}×${bh}`) }
    /* 契约只覆盖「画布真的有面积」的情况：0×0 是退化输入，只保证不返回 NaN */
    if (w >= 1 && h >= 1 && bw * bh > DESKTOP) { bad++; console.log(`  · 超预算 ${w}×${h} dpr=${dpr} → ${bw * bh} px`) }
    if (bw * bh > worst.px && w >= 1 && h >= 1) worst = { dpr, w, h, px: bw * bh }
  }
  check(bad === 0, `${sizes.length} 组尺寸（含 0.5 / 0 / 16384 / 20000 边界）全部满足预算`, `不一致 ${bad}`)
  console.log(`      实测最大缓冲：${worst.w}×${worst.h} @ dpr=${worst.dpr} = ${(worst.px / 1e6).toFixed(2)} Mpx（预算 ${DESKTOP / 1e6} Mpx）`)
  console.log(`      出现过的 dpr：${[...seenDpr].sort((a, b) => b - a).join(', ')}`)
}

/* ---------------------------------------------- ③ 倍率只能是 2 / 1 / 0.5 / 0.25 */
console.log('\n=== resolveCanvasDpr：档位只允许 {2,1,0.5,0.25} ===')
{
  const ladder = new Set([2, 1, 0.5, 0.25])
  const rnd = mulberry(777)
  let bad = 0
  let seen = new Set()
  for (let i = 0; i < 400; i++) {
    const w = 1 + Math.floor(rnd() * 30000)
    const h = 1 + Math.floor(rnd() * 30000)
    const want = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4][Math.floor(rnd() * 9)]
    const dpr = resolveCanvasDpr(w, h, want, DESKTOP)
    seen.add(dpr)
    if (!ladder.has(dpr)) { bad++; if (bad < 5) console.log(`  · ${w}×${h} want=${want} → dpr=${dpr}`) }
  }
  check(bad === 0, '400 组随机尺寸 × 随机期望倍率，返回值都在档位上', `异常 ${bad}`)
  console.log(`      出现过的档位：${[...seen].sort((a, b) => b - a).join(', ')}`)

  check(resolveCanvasDpr(200, 200, 1, DESKTOP) === 1, 'wantDpr=1 时不会返回 2（小画布 200×200）', `dpr=${resolveCanvasDpr(200, 200, 1, DESKTOP)}`)
  check(resolveCanvasDpr(200, 200, 2, DESKTOP) === 2, 'wantDpr=2 时小画布才拿到 2 倍', `dpr=${resolveCanvasDpr(200, 200, 2, DESKTOP)}`)
  check(resolveCanvasDpr(200, 200, 0.25, DESKTOP) === 0.5, 'wantDpr 低于档位时向上取到最近的档（0.25 → 0.5），不会反而更糊', `dpr=${resolveCanvasDpr(200, 200, 0.25, DESKTOP)}`)
  const huge = resolveCanvasDpr(60000, 60000, 2, DESKTOP)
  check(huge === 0.25, '极端尺寸（60000×60000）退到下限 0.25，不会返回 0', `dpr=${huge}`)
  check(resolveCanvasDpr(60000, 60000, 2, DESKTOP) * 60000 <= MAX_CANVAS_SIDE, '下限 0.25 也仍然守住单边 16384', `缓冲边 ${Math.round(60000 * huge)}`)
}

/* ---------------------------------------------- ④ chartCellCap */
console.log('\n=== chartCellCap：预算内允许的最大 cell ===')
{
  const R = 26 // EditorCanvas 用的标尺宽（zoom=1 时约 20~26）
  for (const [n, ruler] of [[1000, R], [1000, 0], [116, R], [464, R]]) {
    const cap = chartCellCap(n, n, ruler)
    const w = n * cap + 2 * ruler
    const dpr = resolveCanvasDpr(w, w)
    const px = Math.round(w * dpr) * Math.round(w * dpr)
    console.log(`      ${n}×${n} ruler=${ruler} → cap=${cap}，画布 ${w}×${w} @ dpr=${dpr} = ${(px / 1e6).toFixed(2)} Mpx`)
    check(cap >= 1, `${n} 格的 cap ≥ 1`, `cap=${cap}`)
    check(px <= DESKTOP, `${n} 格的 cap 不越预算`, `${(px / 1e6).toFixed(2)} Mpx / ${DESKTOP / 1e6} Mpx`)
    check(Math.round(w * dpr) <= MAX_CANVAS_SIDE, `${n} 格的 cap 不越单边 16384`, `${Math.round(w * dpr)}`)
    /* 只接受 dpr ≥ 1：dpr < 1 时 1 px 的格线只剩零点几个设备像素，整张图（含色号）是糊的，
       那不是"省内存"而是画了一张看不清的图。缩放宁可停在这里并由 zoomCapped 提示去分板视图。 */
    check(dpr >= 1, `${n} 格的 cap 只用 dpr ≥ 1 的级别（缓冲不小于逻辑尺寸）`, `dpr=${dpr}`)
  }
  const cap1000 = chartCellCap(1000, 1000, R)
  const cap116 = chartCellCap(116, 116, R)
  const cap464 = chartCellCap(464, 464, R)
  console.log(`      cap(1000) = ${cap1000}，cap(464) = ${cap464}，cap(116) = ${cap116}`)
  check(cap116 > cap464 && cap464 > cap1000, 'cap 随尺寸单调递减：116 > 464 > 1000', `${cap116} > ${cap464} > ${cap1000}`)
  check(cap1000 >= 1 && cap464 >= 2, '1000 格能放大到 ≥ 1 px/格，464 格至少 2 px/格')

  /* 非方形也得成立 */
  const wide = chartCellCap(1000, 200, R)
  const widePx = Math.round((1000 * wide + 52) * resolveCanvasDpr(1000 * wide + 52, 200 * wide + 52)) *
                 Math.round((200 * wide + 52) * resolveCanvasDpr(1000 * wide + 52, 200 * wide + 52))
  check(widePx <= DESKTOP, '1000×200 的非方形图案 cap 也不越预算', `cap=${wide} → ${(widePx / 1e6).toFixed(2)} Mpx`)
}

/* ---------------------------------------------- ⑤ chartGeometry 的分数格 */
console.log('\n=== chartGeometry：cell 0.6 / 1 / 14 自洽，下限 0.5 ===')
{
  const pattern = { width: 1000, height: 1000 }
  for (const cell of [0.6, 1, 14]) {
    const g = chartGeometry(pattern, { cell, ruler: true })
    const selfConsistent = g.width === g.ruler * 2 + pattern.width * g.cell &&
      g.height === g.ruler * 2 + pattern.height * g.cell &&
      g.originX === g.ruler && g.originY === g.ruler
    console.log(`      cell=${cell} → 实际 cell=${g.cell} ruler=${g.ruler} 图纸 ${g.width}×${g.height} origin=(${g.originX},${g.originY})`)
    check(selfConsistent, `cell=${cell} 时 width/height/originX 自洽（width = ruler*2 + gw*cell）`)
  }
  const tiny = chartGeometry(pattern, { cell: 0.1, ruler: true })
  check(tiny.cell === 0.5, 'cell 低于 0.5 时被抬到下限 0.5', `cell=${tiny.cell}`)
  const noRuler = chartGeometry(pattern, { cell: 0.6, ruler: false })
  check(noRuler.ruler === 0 && noRuler.width === 1000 * 0.6, 'ruler:false 时宽度就是纯格区', `${noRuler.width}`)
  const g1000 = chartGeometry(pattern, { cell: 0.5 })
  check(g1000.width <= 640 && g1000.height <= 640, '1000 格在 cell=0.5 时整图只有 500+2×13 px，能缩进一屏', `${g1000.width}×${g1000.height}`)
}

/* ------------------------------------- ⑥ 导出的「1:1 旁路」（元素上的 __dpr）
   为什么需要旁路：导出要的是「逻辑尺寸 = 缓冲尺寸」。窄屏预算（8 Mpx）下 4096 px
   的图纸按预算算会退到 0.5 倍，而 round(cssW*0.5)/0.5 在 cssW 是奇数时会变成 cssW+1 ——
   反推回逻辑尺寸差 1 px，exporters 的尺寸对账会偶发失败（不是画错，是直接拒绝导出）。
   所以宿主对象上带 __dpr 时以它为准，屏幕预算只作用于编辑器画布。 */
console.log('\n=== 导出旁路：prepareCanvas(host.__dpr = 1, 4096, 4096) 必须精确等于 4096 ===')
{
  const makeHost = (dpr = null) => {
    const host = {
      style: {},
      getContext: () => ({ setTransform() {} })
    }
    if (dpr != null) host.__dpr = dpr
    return host
  }
  const withWin = (devicePixelRatio, narrow, fn) => {
    const saved = globalThis.window
    globalThis.window = { devicePixelRatio, matchMedia: q => ({ matches: narrow && /max-width/.test(q) }) }
    try { return fn() } finally { globalThis.window = saved }
  }

  /* 4096² 在窄屏 8 Mpx 预算下必然退到 0.5 —— 先把这个前提钉住 */
  check(resolveCanvasDpr(4096, 4096, 2, NARROW) === 0.5, '前提：4096² 在窄屏 8 Mpx 预算下只能拿到 0.5 倍', `dpr=${resolveCanvasDpr(4096, 4096, 2, NARROW)}`)
  /* 反推误差：奇数宽度上 round(w*0.5)/0.5 = w+1 */
  const oddW = 2871
  const badReverse = Math.round(Math.round(oddW * 0.5) / 0.5)
  console.log(`      反推误差示例：逻辑宽 ${oddW} @dpr=0.5 → 缓冲 ${Math.round(oddW * 0.5)} → 反推回 ${badReverse}（差 ${badReverse - oddW} px，尺寸对账就是在这里失败的）`)
  check(badReverse === oddW + 1, '偶数取整在奇数逻辑宽度上确实会多出 1 px（旁路存在的理由）', `${oddW} → ${badReverse}`)

  let bad = 0
  const rows = []
  for (const dpr of [1, 2]) {
    for (const narrow of [false, true]) {
      const budget = withWin(dpr, narrow, () => chartPixelBudget())
      const res = withWin(dpr, narrow, () => {
        const el = makeHost(1)
        prepareCanvas(el, 4096, 4096)
        return { w: el.width, h: el.height, style: el.style.width, css: canvasDpr(el, 4096, 4096) }
      })
      rows.push(`devicePixelRatio=${dpr} ${narrow ? '窄屏' : '桌面'}预算(${budget / 1e6} Mpx)：带 __dpr:1 → ${res.w}×${res.h}，canvasDpr=${res.css}，style=${res.style}`)
      if (res.w !== 4096 || res.h !== 4096) bad++
      if (res.css !== 1) bad++
      if (res.style !== '4096px') bad++
    }
  }
  rows.forEach(r => console.log('      ' + r))
  check(bad === 0, 'devicePixelRatio 1/2 × 桌面/窄屏 四种组合下都精确等于 4096（无 1 px 误差）', `异常 ${bad}`)

  /* 普通元素（编辑器画布）在同一尺寸下仍然受预算约束，没有被旁路放开 */
  let plainBad = 0
  for (const narrow of [false, true]) {
    const budget = withWin(1, narrow, () => chartPixelBudget())
    const r = withWin(1, narrow, () => {
      const el = makeHost()
      prepareCanvas(el, 4096, 4096)
      return { w: el.width, h: el.height, dpr: canvasDpr(el, 4096, 4096) }
    })
    console.log(`      普通元素（无 __dpr）@devicePixelRatio=1 ${narrow ? '窄屏' : '桌面'}预算(${budget / 1e6} Mpx)：${r.w}×${r.h} @dpr=${r.dpr}，缓冲 ${(r.w * r.h / 1e6).toFixed(2)} Mpx`)
    if (r.w > 4096 || r.h > 4096) plainBad++
    if (r.w * r.h > budget) plainBad++
    if (r.w !== Math.round(4096 * r.dpr)) plainBad++
  }
  check(plainBad === 0, '普通元素仍受预算约束（≤4096 且不超预算），旁路只对带 __dpr 的宿主生效', `异常 ${plainBad}`)

  /* 编辑器画布上没有 __dpr，行为必须和旁路之前完全一样。
     render.js 里「没带 __dpr」的期望倍率是 wantDprOf()：设备 DPR 与 dprCap 取小、
     但不取到 1 以下（浏览器缩到 50% 时 devicePixelRatio 会是 0.5，照它画会糊）。
     所以这里要拿**同一套期望倍率**去和 resolveCanvasDpr 对账，而不是硬写 2 ——
     硬写 2 只是在验证我自己的假设，验证不到「旁路没改变原行为」。
     Node 里本来没有 window；上面 withWin 留过桩，这里必须置空再断言。 */
  globalThis.window = undefined
  const plainEl = makeHost()
  const noBypass = resolveCanvasDpr(1000, 1000, 1)          // 无 window → devicePixelRatio 缺省 1
  const with2x = resolveCanvasDpr(1000, 1000, 2)
  console.log(`      对账基准：resolveCanvasDpr(1000,1000,wantDpr=1) = ${noBypass}，wantDpr=2 = ${with2x}`)
  check(canvasDpr(plainEl, 1000, 1000) === noBypass,
    '没有 __dpr 时 canvasDpr 与 resolveCanvasDpr（同一期望倍率）完全一致，旁路没有改动原行为',
    `${canvasDpr(plainEl, 1000, 1000)} / ${noBypass}`)
  check(canvasDpr(makeHost(0.25), 1000, 1000) === 0.25 && canvasDpr(makeHost(-1), 1000, 1000) === noBypass,
    '__dpr 只在是正数时生效（0.25 生效，-1 被忽略）',
    `${canvasDpr(makeHost(0.25), 1000, 1000)} / ${canvasDpr(makeHost(-1), 1000, 1000)}`)
  /* 2x 屏上编辑器仍应拿到 2 倍：旁路只在带 __dpr 时接管 */
  const twoX = withWin(2, false, () => {
    const el = makeHost()
    prepareCanvas(el, 1000, 1000)
    return { w: el.width, css: canvasDpr(el, 1000, 1000) }
  })
  check(twoX.css === with2x && twoX.w === Math.round(1000 * twoX.css),
    'devicePixelRatio=2 的编辑器画布仍是 2 倍（旁路不误伤）', `dpr=${twoX.css}，width=${twoX.w}`)
  delete globalThis.window
}

/* ---------------------------------------------- ⑦ 位图快路径的纯数据部分 */
console.log('\n=== 缩略图位图快路径：packCellColors 取色规则 + 100 万格耗时 ===')
{
  const gw = 1000
  const gh = 1000
  const nColors = 48
  const rnd = mulberry(99991)
  const palette = []
  for (let i = 0; i < nColors; i++) {
    palette.push({ id: 'c' + i, code: 'A' + i, hex: '#' + ((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0') })
  }
  const cells = new Int32Array(gw * gh)
  for (let i = 0; i < cells.length; i++) {
    const r = rnd()
    /* 12% 空格（k = -1）、5% 指到色板空槽（palette[k] = null，这一格不画） */
    if (r < 0.12) cells[i] = -1
    else if (r < 0.17) cells[i] = 900 + (i % 7)
    else cells[i] = Math.floor(rnd() * nColors)
  }
  palette[900] = null

  /* 每格最终是「1 个像素的 ABGR 值」，与逐格路径的规则一一对照：
     k < 0 → EMPTY_FILL 的 packed；palette[k] 缺失 → 0（透明，不画）；否则 palette[k].hex */
  const hexToRgbLocal = hex => {
    const q = parseInt(String(hex).replace('#', ''), 16)
    return [(q >> 16) & 255, (q >> 8) & 255, q & 255]
  }
  const packLocal = hex => {
    const [r, g, b] = hexToRgbLocal(hex)
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
  }

  const t0 = process.hrtime.bigint()
  const packed = packCellColors(cells, palette)
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  console.log(`      ${gw}×${gh} = ${(cells.length / 1e4).toFixed(0)} 万格：packCellColors 耗时 ${ms.toFixed(1)} ms，产出 ${(packed.byteLength / 1048576).toFixed(1)} MB 像素缓冲`)
  check(ms < 500, '100 万格 packCellColors 在 500ms 内（逐格 fillRect 要几秒，位图快路径是毫秒级）', `${ms.toFixed(1)} ms`)
  check(packed.length === cells.length, '像素数与格数一致', `${packed.length}`)

  let bad = 0
  let emptyPx = 0
  let transparentPx = 0
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i]
    const expect = k < 0 ? packLocal(EMPTY_FILL) : (palette[k] ? packLocal(palette[k].hex) : 0)
    if (packed[i] !== expect) { bad++; if (bad < 5) console.log(`  · 第 ${i} 格 k=${k}：packed=${packed[i]} expect=${expect}`) }
    if (k < 0) emptyPx++
    if (k >= 0 && !palette[k]) transparentPx++
  }
  check(bad === 0, '100 万格逐像素与「k<0 → EMPTY_FILL / palette[k] → hex / 空槽 → 透明」规则一致', `不一致 ${bad}`)
  console.log(`      其中空格 ${(emptyPx / 1e4).toFixed(1)} 万格（EMPTY_FILL），指到空槽 ${(transparentPx / 1e4).toFixed(1)} 万格（透明=不画，露出底色）`)
  check(emptyPx > 0 && transparentPx > 0, '用例真的覆盖了空格与空槽两条分支（否则上面那条断言是空转）', `空格 ${emptyPx} / 空槽 ${transparentPx}`)

  /* 对照：逐格 fillRect 的数量级（只数指令，不画） */
  const t2 = process.hrtime.bigint()
  let rects = 0
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i]
    if (k < 0) { rects += 2; continue } // 空格 = 底块 + 中心小点（cell ≥ 9 时）
    if (palette[k]) rects++
  }
  const t3 = process.hrtime.bigint()
  console.log(`      对照：逐格路径要发起 ${rects.toLocaleString()} 次 fillRect（这里只数指令，约 ${(Number(t3 - t2) / 1e6).toFixed(1)} ms；真 raster 化要几秒），位图路径只要 1 次 drawImage`)
  check(rects > 900000, '100 万格下逐格路径确实是百万级 fillRect', `${rects}`)
}

console.log('')
console.log(allOk
  ? `✅ 全部通过：1000×1000 格的倍率/格子上限都在像素预算内（桌面 ${DESKTOP / 1e6} Mpx / 窄屏 ${NARROW / 1e6} Mpx），缩略图位图快路径取色与逐格一致`
  : '❌ 有失败项（见上面 FAIL）')
console.log('')
console.log('需要浏览器复核的部分（Node 里没有 canvas）：')
console.log('  · drawPixels 位图快路径真正光栅化后，与逐格 fillRect 的像素是否逐点相同（drawImage 缩放 + imageSmoothingEnabled=false）')
console.log(`  · EMPTY_DOT（${EMPTY_DOT}）只在 cell ≥ 9 的逐格路径出现；cell < 2 的快路径不画它，视觉上等价于「空格 = 浅灰底」`)
console.log('  · prepareCanvas 写出的 el.width 与 canvasDpr 反推的倍率是否一致（exporters.js 的尺寸对账会报错，不会静默出错图）')
process.exit(allOk ? 0 : 1)
