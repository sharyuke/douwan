/* =========================================================================
   素材 SVG 配色校验器

   为什么需要它：素材不是只当缩略图看。它会被 svgToImage 栅格化、再量化成
   拼豆图纸。如果 SVG 里出现「拼豆色卡里查不到的色值」，量化的第一步就要把它
   替换成最近的色号 —— 色相偏移、色号数、可拼性三项指标全部受牵连。

   所以重画素材有一条硬规矩：**每个 fill / stroke 色值都必须是某个品牌色卡里
   真实存在的色号**，并且要报出对应色号，方便玩家照着买豆。

   用法：
     node scripts/fidelity/asset-palette-check.mjs <file.svg> [more.svg ...]
     node scripts/fidelity/asset-palette-check.mjs --dir scripts/fidelity/out/redraw

   退出码：0 = 全部色值都能落到色号上；1 = 有查不到的色值。
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getColors, PALETTE_BRANDS } from '../../src/lib/palettes.js'

/* 用哪个品牌作基准：拼豆国内最主流的是漫德 MARD 221 色 */
const BASE_BRAND = 'mard221'

/* ------------------------------------------------------------ 色值解析 */

/** "#abc" / "#aabbcc" -> [r,g,b]，非法返回 null */
function parseHex(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
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

function deltaE(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

/* ------------------------------------------------------------ 色卡索引 */

const brand = PALETTE_BRANDS.find((b) => b.id === BASE_BRAND)
if (!brand) throw new Error(`色卡里找不到品牌 ${BASE_BRAND}`)

const BY_HEX = new Map()
const BY_LAB = []
for (const c of getColors(BASE_BRAND)) {
  const key = c.hex.toLowerCase()
  if (!BY_HEX.has(key)) BY_HEX.set(key, c)
  BY_LAB.push({ code: c.code, hex: c.hex, lab: rgbToLab(parseHex(c.hex)) })
}

/** 精确命中色号；否则给最近色号 + 距离 */
function resolve(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return { ok: false, reason: `不是合法色值：${hex}` }
  const hit = BY_HEX.get(hex.toLowerCase())
  if (hit) return { ok: true, code: hit.code, deltaE: 0 }
  const lab = rgbToLab(rgb)
  let best = null
  for (const c of BY_LAB) {
    const d = deltaE(lab, c.lab)
    if (!best || d < best.deltaE) best = { code: c.code, hex: c.hex, deltaE: d }
  }
  return { ok: false, nearest: best, hex }
}

/* ------------------------------------------------------------ 扫描 SVG */

/** 抓出所有 fill="…" / stroke="…" 里的 #rrggbb，忽略 none / currentColor / url() */
function extractColors(svg) {
  const out = []
  const re = /\b(fill|stroke)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(svg))) {
    const raw = m[2].trim()
    if (!raw.startsWith('#')) continue
    out.push(raw.toLowerCase())
  }
  return out
}

/** 抓出所有 opacity / fill-opacity / stroke-opacity，非 1 就说明产生了混合色 */
function extractOpacities(svg) {
  const out = []
  const re = /\b(opacity|fill-opacity|stroke-opacity)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(svg))) {
    const v = Number(m[2])
    if (Number.isFinite(v) && v < 1) out.push(`${m[1]}="${m[2]}"`)
  }
  return out
}

function checkFile(file) {
  const svg = fs.readFileSync(file, 'utf8')
  const colors = extractColors(svg)
  const uniq = [...new Set(colors)]
  const misses = []
  const codes = new Map()
  for (const hex of uniq) {
    const r = resolve(hex)
    if (r.ok) codes.set(hex, r.code)
    else misses.push({ hex, nearest: r.nearest })
  }
  return {
    file,
    total: colors.length,
    unique: uniq.length,
    codes,
    misses,
    opacities: extractOpacities(svg),
    elements: (svg.match(/<(circle|ellipse|rect|path|polygon|g|line)\b/g) || []).length
  }
}

/* ------------------------------------------------------------ 输出 */

const ARGS = process.argv.slice(2)
let files = []
if (ARGS[0] === '--dir') {
  files = fs
    .readdirSync(ARGS[1])
    .filter((f) => f.endsWith('.svg'))
    .map((f) => path.join(ARGS[1], f))
} else {
  files = ARGS
}

if (!files.length) {
  console.error('用法：node scripts/fidelity/asset-palette-check.mjs <file.svg ...> | --dir <dir>')
  process.exit(2)
}

let bad = 0
for (const f of files) {
  const r = checkFile(f)
  const name = path.basename(f)
  console.log(`\n=== ${name} ===`)
  console.log(`  元素 ${r.elements} 个 · 色值引用 ${r.total} 次 · 去重 ${r.unique} 色`)
  const list = [...r.codes.entries()].map(([hex, code]) => `${code} ${hex}`)
  console.log(`  全部命中色号（${r.codes.size}/${r.unique}）：${list.join(' · ')}`)
  if (r.misses.length) {
    bad++
    console.log(`  ✗ 有 ${r.misses.length} 个色值不在色卡里：`)
    for (const m of r.misses) {
      console.log(`      ${m.hex} → 最近是 ${m.nearest.code} ${m.nearest.hex}，ΔE ${m.nearest.deltaE.toFixed(2)}`)
    }
  }
  if (r.opacities.length) {
    bad++
    console.log(`  ✗ 存在半透明（会渲染出混合色，图纸里没有对应豆）：${r.opacities.join(' ')}`)
  }
}

console.log(bad === 0 ? '\n通过：全部色值都能落到真实色号上。' : `\n不通过：${bad} 个文件有问题。`)
process.exit(bad === 0 ? 0 : 1)
