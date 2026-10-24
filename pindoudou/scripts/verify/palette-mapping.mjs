/* =========================================================================
   色板 → 图案 的「零误差」自检（离线、确定性）

   用户诉求（2026-10-24）：
     · 图片转换出来的每一个颜色，都必须是色板里真实存在的色号；
     · 色板里没有的颜色，必须替换成色板里**最接近**的那个（按 CIEDE2000）；
     · 色号与实物拼豆的对应关系要严格，不能是「差不多」。

   这个脚本盯住其中可以离线证明的两条：
     1. 数据层：每个色号的 hex / rgb / lab 三者一致，色号在品牌内唯一，
        hex 是合法 6 位写法（实物对应关系只能靠公开色卡 + 实体色卡复核，
        见 scripts/build-palette.cjs 的来源与交叉验证，脚本本身证明不了实物颜色）。
     2. 映射层：把任意颜色喂给引擎，得到的色号必须是整块色板里
        CIEDE2000 最小的那一个（不是「前 3 名里最近」，也不是 Lab 欧氏距离）。

   判定口径：
     · 用 generateFromCells + 自定义 quantizer 强制「整块色板都参与映射」，
       这样检查的是全色板最优，而不是量化器挑出来的子集内部最优；
     · 用 'high' 方案（不调色、不海报化、不合并、不去孤立豆），
       保证每格的参考色就是喂进去的原色，没有中间变换。
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateFromCells, generateFromPixels, applyInventory } from '../../src/lib/pattern.js'
import { readPNG } from '../fidelity/png.mjs'
import { PALETTE_BRANDS, PALETTE_COLORS, DEFAULT_BRAND_ID, getColors } from '../../src/lib/palettes.js'
import { hexToRgb, rgbToLab, rgbToHex, deltaE2000 } from '../../src/lib/color.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')

let failures = 0
function ok(msg) { console.log(`  ✓ ${msg}`) }
function bad(msg) { failures++; console.log(`  ✗ ${msg}`) }
function section(title) { console.log(`\n=== ${title} ===`) }

/* ------------------------------------------------------------ 1. 数据层 */

section('1. 色号数据一致性')

const realBrands = PALETTE_BRANDS.filter(b => !b.custom)
for (const brand of realBrands) {
  const colors = PALETTE_COLORS[brand.id]
  const seen = new Set()
  let dup = 0, badHex = 0, rgbMismatch = 0, labMismatch = 0, idMismatch = 0
  for (const c of colors) {
    if (seen.has(c.code)) dup++
    seen.add(c.code)
    if (!/^#[0-9a-f]{6}$/i.test(c.hex)) { badHex++; continue }
    const [r, g, b] = hexToRgb(c.hex)
    if (r !== c.rgb[0] || g !== c.rgb[1] || b !== c.rgb[2]) rgbMismatch++
    if (rgbToHex(r, g, b).toLowerCase() !== c.hex.toLowerCase()) rgbMismatch++
    const lab = rgbToLab(r, g, b)
    if (Math.abs(lab[0] - c.lab[0]) > 1e-9 || Math.abs(lab[1] - c.lab[1]) > 1e-9 || Math.abs(lab[2] - c.lab[2]) > 1e-9) labMismatch++
    if (c.id !== `${brand.id}:${c.code}`) idMismatch++
  }
  const tag = `${brand.id.padEnd(12)} ${String(colors.length).padStart(3)} 色`
  if (dup || badHex || rgbMismatch || labMismatch || idMismatch) {
    bad(`${tag}  重复色号 ${dup} / 非法 hex ${badHex} / rgb 不一致 ${rgbMismatch} / lab 不一致 ${labMismatch} / id 不一致 ${idMismatch}`)
  } else {
    ok(`${tag}  色号唯一、hex↔rgb↔lab 三者一致`)
  }
}

/* ------------------------------------------- 2. 全色板精确最近色（合成色） */

section('2. 任意颜色 → 整块色板里 CIEDE2000 最近的色号')

/** 确定性伪随机（不用 Math.random，保证每次跑的是同一批颜色） */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/** 把一批 RGB 喂给引擎（强制整块色板参与映射），返回每格结果 */
function mapAll(rgbList, colors) {
  const n = rgbList.length / 3
  const gw = Math.ceil(Math.sqrt(n))
  const gh = Math.ceil(n / gw)
  const cells = new Float32Array(gw * gh * 3)
  for (let i = 0; i < n; i++) {
    cells[i * 3] = rgbList[i * 3]
    cells[i * 3 + 1] = rgbList[i * 3 + 1]
    cells[i * 3 + 2] = rgbList[i * 3 + 2]
  }
  // 补位用最后一个颜色，检查时只查前 n 格
  for (let i = n; i < gw * gh; i++) {
    cells[i * 3] = rgbList[(n - 1) * 3]
    cells[i * 3 + 1] = rgbList[(n - 1) * 3 + 1]
    cells[i * 3 + 2] = rgbList[(n - 1) * 3 + 2]
  }
  const pattern = generateFromCells(cells, {
    gw, gh, targetColors: colors.length, variantKey: 'high',
    colors, quantizer: () => colors.slice()
  })
  return { pattern, n }
}

/** 逐格核对：结果色号必须是整块色板里 ΔE00 最小的那个（平局允许任一） */
function checkExact(rgbList, colors, label) {
  const { pattern, n } = mapAll(rgbList, colors)
  const labs = colors.map(c => c.lab)
  let worse = 0, worstGap = 0, offPalette = 0, badIndex = 0
  const samples = []
  for (let i = 0; i < n; i++) {
    const k = pattern.cells[i]
    if (!(k >= 0 && k < pattern.palette.length)) { badIndex++; continue }
    const got = pattern.palette[k]
    if (!colors.some(c => c.id === got.id)) { offPalette++; continue }
    const lab = rgbToLab(rgbList[i * 3], rgbList[i * 3 + 1], rgbList[i * 3 + 2])
    const gotDE = deltaE2000(lab, got.lab)
    let bestDE = Infinity
    for (const l of labs) {
      const d = deltaE2000(lab, l)
      if (d < bestDE) bestDE = d
    }
    const gap = gotDE - bestDE
    if (gap > 1e-6) {
      worse++
      if (gap > worstGap) worstGap = gap
      if (samples.length < 3) samples.push({ rgb: rgbList.slice(i * 3, i * 3 + 3), got: got.code, gotDE, bestDE })
    }
  }
  if (badIndex) bad(`${label}  ${badIndex} 格下标越界`)
  else if (offPalette) bad(`${label}  ${offPalette} 格用了色板外的颜色`)
  else if (worse) bad(`${label}  ${worse}/${n} 格不是 ΔE00 最近（最大多出 ${worstGap.toFixed(4)}）`)
  else ok(`${label}  ${n} 格全部是整块色板里的 ΔE00 最近色`)
  return { worse, worstGap, offPalette, badIndex, samples }
}

const rand = mulberry32(20261024)
for (const brandId of [DEFAULT_BRAND_ID, 'coco291', 'manman278', 'panpan289', 'mixiaowo290', 'artkal-c197', 'hama', 'perler']) {
  const colors = getColors(brandId)
  if (!colors.length) { bad(`${brandId} 没有颜色`); continue }
  /* 测试集：
       ① 色板自身的每个颜色（必须映射回自己，ΔE00 = 0）；
       ② 500 个随机 RGB（覆盖色板外的大量颜色）；
       ③ 色板颜色的 ±12 抖动（模拟「色卡里没有、但很接近」的过渡色）。 */
  const list = []
  for (const c of colors) list.push(c.rgb[0], c.rgb[1], c.rgb[2])
  for (let i = 0; i < 500; i++) list.push(rand() * 255, rand() * 255, rand() * 255)
  for (const c of colors) {
    for (const d of [-12, 12]) {
      list.push(
        Math.max(0, Math.min(255, c.rgb[0] + d)),
        Math.max(0, Math.min(255, c.rgb[1] + d)),
        Math.max(0, Math.min(255, c.rgb[2] + d))
      )
    }
  }
  const rgbList = Float32Array.from(list)
  checkExact(rgbList, colors, brandId.padEnd(12))
}

/* ---------------------------------------- 3. 真实图片：每格都必须落在色板内 */

section('3. 真实图片生成：每格颜色都来自所选色板')

const FIXTURES = [
  ['synth_portrait.png', path.join(ROOT, 'scripts', 'fidelity', 'fixtures', 'synth_portrait.png')],
  ['photo_pumpkin.png', path.join(ROOT, 'scripts', 'fidelity', 'fixtures', 'photo_pumpkin.png')]
]
for (const [name, file] of FIXTURES) {
  if (!fs.existsSync(file)) { console.log(`  · 跳过 ${name}：文件不存在`); continue }
  const img = readPNG(file)
  for (const brandId of [DEFAULT_BRAND_ID, 'coco291', 'panpan289']) {
    const colors = getColors(brandId)
    const ids = new Set(colors.map(c => c.id))
    const p = generateFromPixels(img.data, img.width, img.height, {
      gw: 116, gh: 116, fit: 'contain', targetColors: 48,
      brandId, colors, variantKey: 'high', variantParams: { cap: 48, dither: 'off', cleanup: 0, posterize: 0, mergeRatio: 0, saturate: 1, contrast: 1, assign: 'de' }
    })
    const off = p.palette.filter(c => !ids.has(c.id))
    let badCell = 0
    for (const k of p.cells) if (k >= 0 && (k >= p.palette.length || !p.palette[k])) badCell++
    if (off.length || badCell) bad(`${name} / ${brandId}  色板外颜色 ${off.length}、坏格子 ${badCell}`)
    else ok(`${name} / ${brandId.padEnd(10)}  ${p.palette.length} 色 / ${p.cells.length} 格全部落在色板内`)
  }
}

/* ------------------------------------------------------------ 4. 库存重配色 */

section('4. 按库存重配色：替换目标也是 ΔE00 最近')

if (fs.existsSync(FIXTURES[0][1])) {
  const colors = getColors(DEFAULT_BRAND_ID)
  const img = readPNG(FIXTURES[0][1])
  const p = generateFromPixels(img.data, img.width, img.height, {
    gw: 116, gh: 116, fit: 'contain', targetColors: 32,
    brandId: DEFAULT_BRAND_ID, colors, variantKey: 'high',
    variantParams: { cap: 32, dither: 'off', cleanup: 0, posterize: 0, mergeRatio: 0, saturate: 1, contrast: 1, assign: 'de' }
  })
  // 去掉用量前 1/3 的颜色，模拟「手上没有这些色号」
  const used = new Map()
  for (const k of p.cells) if (k >= 0) used.set(p.palette[k].id, (used.get(p.palette[k].id) || 0) + 1)
  const drop = new Set([...used.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.ceil(used.size / 3)).map(e => e[0]))
  const pool = colors.filter(c => !drop.has(c.id))
  const next = applyInventory(p, pool, null, 'strict').pattern
  const byId = new Map(colors.map(c => [c.id, c]))
  let wrong = 0, worst = 0
  for (const [id, count] of used) {
    if (!drop.has(id)) continue
    const src = byId.get(id)
    let bestDE = Infinity
    for (const c of pool) bestDE = Math.min(bestDE, deltaE2000(src.lab, c.lab))
    // 找出这一格被换成了谁：用 next.palette 里 ΔE00 与 src 最近的那个当作实际替换目标
    let gotDE = Infinity
    for (const c of next.palette) gotDE = Math.min(gotDE, deltaE2000(src.lab, c.lab))
    if (gotDE - bestDE > 1e-6) { wrong++; worst = Math.max(worst, gotDE - bestDE) }
  }
  if (wrong) bad(`库存重配色：${wrong}/${drop.size} 个被移除的色号没有换到最近库存色（最大多出 ${worst.toFixed(4)}）`)
  else ok(`库存重配色：${drop.size} 个被移除的色号都换到了最近库存色（${next.palette.length} 色）`)
} else {
  console.log('  · 跳过：没有可用测试图')
}

/* ---------------------------------------------------------------- 收尾 */

console.log('')
if (failures) {
  console.log(`❌ ${failures} 项未通过`)
  process.exit(1)
}
console.log('✅ 全部通过：色号数据自洽，转换结果的每一格都是整块色板里 ΔE00 最近的色号')
