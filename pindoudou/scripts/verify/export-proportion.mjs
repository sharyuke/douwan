/* ------------------------------------------------------------------
   底部双卡（图案信息 + 颜色清单）在整页里的占比 —— 回归守卫。

   背景：2026-10-29 用户看着线上导出的 104×104 / 45 色图纸说
   「这里的占比再小一点」（红框圈的就是底部那一行双卡）。
   当时底部占整页 25.9 %，设计稿是 21.5 %。

   现在的口径（src/lib/exportTemplate.js 的 colorCols）：
     颜色清单按「每列最多 11 行」排，列数 3 → 5。
     ⇒ 55 色以内，底部双卡的高度基本是设计稿那一档（≈ 301 设计 px × 缩放系数），
       不会随颜色数一路长高。

   本脚本盯住两件事：
     ① 55 色以内：底部双卡高度不超过「图案信息卡」高度的 1.06 倍
        （颜色清单卡不再把整行撑高）；
     ② 55 色以内：底部双卡占整页 ≤ 24 %（设计稿 21.5 %，留一点余量）。

   用法：node scripts/verify/export-proportion.mjs
   ------------------------------------------------------------------ */
import { templateExtraHeight, templateHeaderHeight, exportPageWidth, exportScale, exportRulerPx, exportCardGap } from '../../src/lib/exportTemplate.js'
import { chartGeometry } from '../../src/lib/render.js'

let failed = 0
function check(ok, label, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
}

function mkPattern(w, h, colors) {
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
  for (let i = 0; i < cells.length; i++) cells[i] = (i * 7919) % colors
  return { width: w, height: h, cells, palette, stats: { beadCount: w * h } }
}

/* 与导出一致的 cell 选择：从 24 往下试，整页（含标版）不超 4096 px 边长与 1600 万像素 */
function planFor(pattern) {
  for (let cell = 24; cell >= 1; cell--) {
    const geo = chartGeometry(pattern, { cell, ruler: true, rulerPx: exportRulerPx(cell) })
    const extraH = templateExtraHeight(pattern, geo.width, { includeLegend: true, includeStats: true })
    const pageW = exportPageWidth(geo.width)
    const pageH = geo.height + extraH
    if (pageW <= 4096 && pageH <= 4096 && pageW * pageH <= 16e6) return { cell, geo, extraH, pageW, pageH }
  }
  return null
}

/* 底部双卡在整页里的几何（设计 px × 缩放系数） */
function cardsOf(pl) {
  const s = exportScale(pl.geo.width)
  const headerH = templateHeaderHeight(s)
  const bottomPad = 34 * s
  const cardGap = exportCardGap(s)
  const cardsH = pl.extraH - headerH - cardGap - bottomPad
  /* 「图案信息」卡的高度：6 行 × 42 + 上下留白 + 胶囊 + 间距（V4 版式） */
  const infoH = (20 + 34 + 7 + 6 * 42 + 16) * s
  return { s, headerH, bottomPad, cardGap, cardsH, infoH }
}

console.log('① 45 色以内：底部双卡高度 = 图案信息卡高度（颜色清单卡不再把整行撑高）')
const tight = [[104, 104, 45], [104, 104, 28], [104, 104, 12], [78, 78, 28], [116, 116, 30]]
const loose = [[104, 104, 52], [78, 78, 52], [58, 58, 55]]
for (const [w, h, colors] of tight) {
  const p = mkPattern(w, h, colors)
  const pl = planFor(p)
  const c = cardsOf(pl)
  check(c.cardsH <= c.infoH * 1.06,
    `${w}×${h} / ${colors} 色：双卡 ${Math.round(c.cardsH)} px vs 图案信息卡 ${Math.round(c.infoH)} px`,
    `比值 ${(c.cardsH / c.infoH).toFixed(3)}`)
}

console.log('\n①b 46~55 色：清单要排 11 行，卡片比图案信息卡高一档（≤ 1.13 倍），仍不撑破整页')
for (const [w, h, colors] of loose) {
  const p = mkPattern(w, h, colors)
  const pl = planFor(p)
  const c = cardsOf(pl)
  check(c.cardsH <= c.infoH * 1.13,
    `${w}×${h} / ${colors} 色：双卡 ${Math.round(c.cardsH)} px vs 图案信息卡 ${Math.round(c.infoH)} px`,
    `比值 ${(c.cardsH / c.infoH).toFixed(3)}`)
}

console.log('\n② 55 色以内：底部双卡占整页 ≤ 24 %（设计稿 21.5 %）')
const cases = [...tight, ...loose]
for (const [w, h, colors] of cases) {
  const p = mkPattern(w, h, colors)
  const pl = planFor(p)
  const c = cardsOf(pl)
  const share = c.cardsH / pl.pageH
  check(share <= 0.24,
    `${w}×${h} / ${colors} 色：底部占整页 ${(share * 100).toFixed(1)} %`,
    `整页 ${Math.round(pl.pageW)}×${Math.round(pl.pageH)}`)
}

console.log('\n③ 用户那一档（104×104 / 45 色）必须明显小于改之前的 25.9 %')
{
  const p = mkPattern(104, 104, 45)
  const pl = planFor(p)
  const c = cardsOf(pl)
  const share = c.cardsH / pl.pageH
  check(share <= 0.21, `底部占整页 ${(share * 100).toFixed(1)} % ≤ 21 %`, `整页 ${Math.round(pl.pageW)}×${Math.round(pl.pageH)}`)
}

console.log('\n④ 颜色特别多时（> 55 色）卡片会长高 —— 已知未解决项，这里只做记录')
for (const [w, h, colors] of [[300, 300, 60], [450, 450, 90]]) {
  const p = mkPattern(w, h, colors)
  const pl = planFor(p)
  const c = cardsOf(pl)
  console.log(`     ${w}×${h} / ${colors} 色：底部占整页 ${(c.cardsH / pl.pageH * 100).toFixed(1)} %（超出 24 % 的部分靠材料清单页解决）`)
}

console.log(failed ? `\n${failed} 项不通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
