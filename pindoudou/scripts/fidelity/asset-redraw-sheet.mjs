/* =========================================================================
   素材重画对比页生成器

   做两件事：
     1. 从 src/data/assets.js 取「旧素材」，从指定目录取「新素材」，
        渲染成一张左右对照的 HTML（旧 | 新 | 数据）。
     2. 按拼豆色卡算「配色保真度」：把每张图的用色逐个落到最近色号，
        统计平均色差 ΔE，以及有多少色值本来就在色卡上。

   为什么统计这个：素材要被栅格化并量化成图纸。用色偏离色卡越远，
   量化时被替换的幅度越大 —— 色相偏移、色号数、可还原度三项都会变差。
   新素材要求 100% 命中色号，就是为了让这一步的 ΔE 恒为 0。

   用法：
     node scripts/fidelity/asset-redraw-sheet.mjs [--in scripts/fidelity/out/redraw] [--out scripts/fidelity/out/asset-redraw.html]
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getColors } from '../../src/lib/palettes.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const IN_DIR = path.resolve(ROOT, opt('--in', 'scripts/fidelity/out/redraw'))
const OUT_HTML = path.resolve(ROOT, opt('--out', 'scripts/fidelity/out/asset-redraw.html'))

const BASE_BRAND = 'mard221'

/* ------------------------------------------------------------ 色卡工具 */

function parseHex(hex) {
  let h = String(hex).trim().replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToLab([r, g, b]) {
  const f = (v) => {
    v /= 255
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92
  }
  const R = f(r)
  const G = f(g)
  const B = f(b)
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const k = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  x = k(x)
  y = k(y)
  z = k(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const dE = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)

const CARD = getColors(BASE_BRAND)
const BY_HEX = new Map(CARD.map((c) => [c.hex.toLowerCase(), c]))
const CARD_LAB = CARD.map((c) => ({ code: c.code, hex: c.hex, lab: rgbToLab(parseHex(c.hex)) }))

function nearest(hex) {
  const lab = rgbToLab(parseHex(hex))
  let best = null
  for (const c of CARD_LAB) {
    const d = dE(lab, c.lab)
    if (!best || d < best.d) best = { code: c.code, hex: c.hex, d }
  }
  return best
}

/** 抓 fill/stroke 的色值，按出现次数加权统计偏离色卡的程度 */
function colorStats(svg) {
  const counts = new Map()
  const re = /\b(?:fill|stroke)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(svg))) {
    const raw = m[1].trim().toLowerCase()
    if (!raw.startsWith('#')) continue
    counts.set(raw, (counts.get(raw) || 0) + 1)
  }
  let total = 0
  let hits = 0
  let sum = 0
  let worst = 0
  const detail = []
  for (const [hex, n] of counts) {
    total += n
    const onCard = BY_HEX.has(hex)
    const nb = nearest(hex)
    if (onCard) hits += n
    sum += nb.d * n
    if (nb.d > worst) worst = nb.d
    detail.push({ hex, n, onCard, code: nb.code, d: nb.d })
  }
  detail.sort((a, b) => b.d - a.d)
  return {
    total,
    onCardRate: total ? hits / total : 1,
    meanDE: total ? sum / total : 0,
    worstDE: worst,
    detail,
    colors: counts.size
  }
}

/* ------------------------------------------------------------ 取素材 */

const assetsSrc = fs.readFileSync(path.join(ROOT, 'src/data/assets.js'), 'utf8')
const OLD = []
{
  const re = /\{\s*"id": "([^"]+)",\s*"name": "([^"]+)",[\s\S]*?"svg": "([\s\S]*?)",\n/g
  let m
  while ((m = re.exec(assetsSrc))) {
    OLD.push({ id: m[1], name: m[2], svg: m[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\') })
  }
}
const byName = new Map(OLD.map((a) => [a.name, a]))

const NEW = fs
  .readdirSync(IN_DIR)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => {
    const svg = fs.readFileSync(path.join(IN_DIR, f), 'utf8').trim()
    return { file: f, key: path.basename(f, '.svg'), svg }
  })

/* 新素材靠文件名对齐旧素材：cat.svg -> 名称里含「橘猫」 */
const ALIAS = { cat: '橘猫头像', panda: '熊猫' }

/* ------------------------------------------------------------ 生成 HTML */

const rows = []
let oldMean = 0
let oldRate = 0
let newMean = 0
let newRate = 0
let n = 0

for (const nw of NEW) {
  const name = ALIAS[nw.key] || nw.key
  const old = byName.get(name)
  const so = old ? colorStats(old.svg) : null
  const sn = colorStats(nw.svg)
  if (so) {
    oldMean += so.meanDE
    oldRate += so.onCardRate
  }
  newMean += sn.meanDE
  newRate += sn.onCardRate
  n++

  const pickOut = (s) =>
    s
      ? `平均 ΔE <b>${s.meanDE.toFixed(2)}</b> · 命中色号 <b>${(s.onCardRate * 100).toFixed(0)}%</b> · 用色 ${s.colors}`
      : '<i>旧库里没有同名素材</i>'

  rows.push(`
  <section class="row">
    <div class="col old">
      <div class="lbl">旧 · ${name}</div>
      <div class="art">${old ? old.svg : '<div class="miss">无</div>'}</div>
      <div class="stat">${pickOut(so)}</div>
    </div>
    <div class="col new">
      <div class="lbl">新 · ${name}</div>
      <div class="art">${nw.svg}</div>
      <div class="stat">${pickOut(sn)}</div>
      <div class="codes">${sn.detail
        .map((d) => `<span class="chip" style="background:${d.hex}" title="${d.hex}"></span><code>${d.code}</code>`)
        .join('')}</div>
    </div>
  </section>`)
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>素材重画对照</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 32px 40px; background: #f4f6f8;
         font: 14px/1.5 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #2b3038; }
  h1 { margin: 0 0 4px; font-size: 21px; }
  .sub { color: #6b7480; margin-bottom: 22px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-bottom: 22px; }
  .col { background: #fff; border-radius: 14px; padding: 16px 18px 14px;
         box-shadow: 0 1px 3px rgba(20,30,50,.09); }
  .old { border-top: 3px solid #c9ced6; }
  .new { border-top: 3px solid #2f7cf6; }
  .lbl { font-weight: 600; margin-bottom: 10px; }
  .art svg { width: 100%; height: auto; display: block; border-radius: 12px; }
  .stat { margin-top: 10px; color: #4a5260; font-size: 13px; }
  .stat b { color: #1f2530; }
  .codes { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { width: 14px; height: 14px; border-radius: 4px; display: inline-block;
          outline: 1px solid rgba(0,0,0,.12); }
  .codes code { font-size: 12px; color: #59616e; margin-right: 8px; }
  .miss { height: 160px; display: grid; place-items: center; color: #98a0ab; }
  .foot { margin-top: 10px; padding: 14px 18px; background: #fff; border-radius: 14px;
          box-shadow: 0 1px 3px rgba(20,30,50,.09); }
</style></head>
<body>
  <h1>素材重画对照 · 旧 vs 新</h1>
  <div class="sub">判定标准：每张图的每个色值都必须是漫德 MARD 221 色卡里真实存在的色号</div>
  ${rows.join('')}
  <div class="foot">
    平均配色偏差：旧 <b>${(oldMean / n).toFixed(2)}</b> ΔE → 新 <b>${(newMean / n).toFixed(2)}</b> ΔE ｜
    命中色号比例：旧 <b>${((oldRate / n) * 100).toFixed(0)}%</b> → 新 <b>${((newRate / n) * 100).toFixed(0)}%</b>
  </div>
</body></html>`

fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true })
fs.writeFileSync(OUT_HTML, html)

console.log(`写出 ${path.relative(ROOT, OUT_HTML)}（${NEW.length} 组对照）`)
for (const nw of NEW) {
  const name = ALIAS[nw.key] || nw.key
  const old = byName.get(name)
  const so = old ? colorStats(old.svg) : null
  const sn = colorStats(nw.svg)
  console.log(
    `  ${name.padEnd(6)} 旧: ΔE ${so ? so.meanDE.toFixed(2).padStart(5) : '  n/a'} 命中 ${so ? (so.onCardRate * 100).toFixed(0).padStart(3) : 'n/a'}%` +
      `  →  新: ΔE ${sn.meanDE.toFixed(2)} 命中 ${(sn.onCardRate * 100).toFixed(0)}%`
  )
}
