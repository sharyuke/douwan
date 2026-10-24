/* =========================================================================
   图案生成「逐位指纹」对照（开发用，Node 直接跑）

   为什么要它：这次改动里有两条诉求互相拉扯 ——
     · 1000 格要变快（超采样倍率按源图真实分辨率封顶、最近色记忆化）；
     · ≤464 格的既有档位**一格都不许变**。
   只比 dEcell/simApp 这种汇总数字不够：它们被平均过，几十个格子换色了也可能看不出来。
   所以这里把每个方案的 cells（Int32Array 的原始字节）做 sha256，再附上统计量与色号表，
   改动前后各跑一次逐位对比 —— 相同就是相同，不同就是不同，没有"差不多"。

   expect 字段的含义：
     'same'    必须逐位一致（≤464 既有档位 / 显式指定 supersample 的路径 / 抖动路径）
     'changed' 预期会变（1000 格触发超采样封顶；目标色号 >32 触发色号上限放开）

   长期用法（当成回归门禁用）：
     node scripts/verify/pattern-fingerprint.mjs --compare scripts/verify/fingerprint-before.json
   判据：所有 expect='same' 的配置，cells 的 sha256 + 色号表哈希 + 统计量（可拼性 / 孤立豆 /
   豆数 / 空格数 / simApp / dE）必须**逐位逐字一致**；只要有一条不符就 exit 1 并打印 ✗。
   fingerprint-before.json 是「画布上限提到 1000 / 最近色记忆化 / buildability 重构」
   这一轮改动之前的冻结基线（= 当时 git HEAD 的算法），换算法前的对照就靠它。

   用法：
     node scripts/verify/pattern-fingerprint.mjs --out   scripts/verify/fingerprint-<label>.json
     node scripts/verify/pattern-fingerprint.mjs --compare scripts/verify/fingerprint-before.json
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { generateFromPixels, variantParams, resampleRGBA } from '../../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'
import { readPNG } from '../fidelity/png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0
    ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true)
    : fallback
}

const GIRL = path.join(ROOT, 'scripts', 'fidelity', 'out', 'photo-src', 'ref_girl.png')
const PORTRAIT = path.join(ROOT, 'scripts', 'fidelity', 'fixtures', 'synth_portrait.png')
const PUMPKIN = path.join(ROOT, 'scripts', 'fidelity', 'fixtures', 'photo_pumpkin.png')
const TALL = path.join(ROOT, 'scripts', 'fidelity', 'out', 'asset-redraw-tall.png')

/** 与 readImagePixels / bench-scale 的 limitSide 同口径：按最大边长面积平均降到 maxSide 以内 */
function limitSide(src, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh))
  if (k >= 1) return { data: src, width: sw, height: sh }
  const tw = Math.max(1, Math.round(sw * k))
  const th = Math.max(1, Math.round(sh * k))
  const { data } = resampleRGBA(src, sw, sh, tw, th, 'cover')
  return { data, width: tw, height: th }
}

const imageCache = new Map()
function loadImage(file, maxSide) {
  const key = file + '@' + maxSide
  if (imageCache.has(key)) return imageCache.get(key)
  const img = readPNG(file)
  const lim = limitSide(img.data, img.width, img.height, maxSide)
  const v = { ...lim, src: { width: img.width, height: img.height } }
  imageCache.set(key, v)
  return v
}

/** 一份配置 = 一次 generateFromPixels 调用 + 一个预期 */
const CONFIGS = []
function cfg(o) { CONFIGS.push(o) }

// A. ≤464 既有档位：SS 本来就已经被 supersampleFactor 限制在 2/4，源图也够，必须逐位一致
for (const grid of [29, 116, 300, 450]) {
  for (const target of [16, 30]) {
    for (const variant of ['easy', 'art']) {
      cfg({ name: `girl-${variant}-g${grid}-c${target}`, file: GIRL, maxSide: 1024, grid, target, variant, expect: 'same' })
    }
  }
}
// high 档这次**刻意**改成 CIEDE2000 选色（quantMetric:'de'），所以要单独标 changed
cfg({ name: 'girl-high-g116-c16', file: GIRL, maxSide: 1024, grid: 116, target: 16, variant: 'high', expect: 'changed' })
cfg({ name: 'girl-high-g450-c30', file: GIRL, maxSide: 1024, grid: 450, target: 30, variant: 'high', expect: 'changed' })

// B. 显式 supersample 覆盖：这条路径不受"按源图封顶"影响，必须逐位一致。
//    同时 SS=1 会让每格颜色保留大量不同取值 —— 正是最近色记忆化压力最大的情形，
//    用它来证明记忆化是「语义等价」而不是「近似」。
cfg({ name: 'portrait-easy-g116-c30-ss1', file: PORTRAIT, maxSide: 1024, grid: 116, target: 30, variant: 'easy', ss: 1, expect: 'same' })
cfg({ name: 'portrait-easy-g300-c30-ss1', file: PORTRAIT, maxSide: 1024, grid: 300, target: 30, variant: 'easy', ss: 1, expect: 'same' })
cfg({ name: 'portrait-art-g450-c30-ss1', file: PORTRAIT, maxSide: 1024, grid: 450, target: 30, variant: 'art', ss: 1, expect: 'same' })
// 300 格 / 显式 SS=1 / 源图 512（够）→ 唯一变量是色号上限：64 会从 22 放开到 40
cfg({ name: 'portrait-easy-g300-c64-ss1', file: PORTRAIT, maxSide: 1024, grid: 300, target: 64, variant: 'easy', ss: 1, expect: 'changed' })

// C. 抖动分支：误差扩散逐格改 buf，记忆化只能按「当前值」查表。
//    这条必须逐位一致，否则说明记忆化把抖动搞成了另一种东西。
cfg({ name: 'girl-easy-g116-c16-dither-low', file: GIRL, maxSide: 1024, grid: 116, target: 16, variant: 'easy', dither: 'low', expect: 'same' })
cfg({ name: 'portrait-easy-g116-c16-dither-high-ss1', file: PORTRAIT, maxSide: 1024, grid: 116, target: 16, variant: 'easy', ss: 1, dither: 'high', expect: 'same' })

// D. 预期会变：1000 格（超采样封顶生效）
cfg({ name: 'girl-easy-g1000-c30', file: GIRL, maxSide: 2048, grid: 1000, target: 30, variant: 'easy', expect: 'changed' })
cfg({ name: 'girl-easy-g1000-c30-src1024', file: GIRL, maxSide: 1024, grid: 1000, target: 30, variant: 'easy', expect: 'changed' })
// E. 预期会变：目标色号 >32（原来被 Math.min(36, …) 静默截断）
cfg({ name: 'girl-easy-g116-c64', file: GIRL, maxSide: 1024, grid: 116, target: 64, variant: 'easy', expect: 'changed' })
cfg({ name: 'girl-high-g116-c64', file: GIRL, maxSide: 1024, grid: 116, target: 64, variant: 'high', expect: 'changed' })

// F. 已知的、实测过的小回退（不是 bug）：源图 155×168 对 116 格画布只有 1.45 个源像素/格，
//    按"源图真实分辨率封顶"的规则就不该再假装有 2×2 个样本可投 —— SS 从 2 降到 1。
//    实测 dEcell 5.09→5.14（+0.05 ΔE00），simApp 0.947→0.947。换来的是一张 155px 的小图
//    在 300/450/1000 格档位上少做 4 倍的采样。这条单列出来，免得和"允许变好"混在一起看。
cfg({ name: 'pumpkin-easy-g116-c30-small', file: PUMPKIN, maxSide: 1024, grid: 116, target: 30, variant: 'easy', expect: 'changed' })
// 同一张图 / 同一档位，但把 supersample 显式钉成 2（= 改动前的自动值）：
// 这条必须与基线逐位一致 —— 它把"超采样封顶"这一条的影响完全排除掉，
// 剩下唯一的变量就是最近色记忆化 + buildability 重构，正好用来证明那两件事零损失。
cfg({ name: 'pumpkin-easy-g116-c30-base', file: PUMPKIN, maxSide: 1024, grid: 116, target: 30, variant: 'easy', ss: 2, expect: 'same' })

function fingerprint(pattern) {
  const cells = Buffer.from(pattern.cells.buffer, pattern.cells.byteOffset, pattern.cells.byteLength)
  const cellsHash = crypto.createHash('sha256').update(cells).digest('hex').slice(0, 16)
  const codes = pattern.palette.map(p => p.code).join(',')
  const codesHash = crypto.createHash('sha256').update(codes).digest('hex').slice(0, 12)
  return {
    cellsHash,
    codesHash,
    colors: pattern.palette.length,
    colorCodes: codes,
    beadCount: pattern.stats.beadCount,
    emptyCount: pattern.stats.emptyCount,
    similarity: pattern.stats.similarity,
    deltaE: pattern.stats.deltaE,
    buildability: pattern.stats.buildability,
    isolatedCount: pattern.stats.isolatedCount
  }
}

const outFile = arg('out', null)
const compareFile = arg('compare', null)
const palette = getColors(DEFAULT_BRAND_ID)

console.log('===== 图案逐位指纹 =====')
console.log('配置'.padEnd(40) + '格数'.padStart(9) + '色数'.padStart(6) + 'simApp'.padStart(8) + 'dE'.padStart(7) + 'cellsHash'.padStart(18) + '  耗时ms')

const result = { at: new Date().toISOString(), entries: [] }
for (const c of CONFIGS) {
  const img = loadImage(c.file, c.maxSide)
  const vp = variantParams(c.variant, c.target)
  if (c.dither) vp.dither = c.dither
  const t0 = performance.now()
  const pattern = generateFromPixels(img.data, img.width, img.height, {
    gw: c.grid,
    gh: c.grid,
    fit: 'contain',
    targetColors: c.target,
    brandId: DEFAULT_BRAND_ID,
    colors: palette,
    variantKey: c.variant,
    variantParams: vp,
    supersample: c.ss
  })
  const ms = Math.round(performance.now() - t0)
  const fp = fingerprint(pattern)
  result.entries.push({ name: c.name, expect: c.expect, grid: c.grid, target: c.target, ms, ...fp })
  console.log(
    c.name.padEnd(40) +
    String(c.grid * c.grid).padStart(9) +
    String(fp.colors).padStart(6) +
    fp.similarity.toFixed(3).padStart(8) +
    fp.deltaE.toFixed(2).padStart(7) +
    fp.cellsHash.padStart(18) +
    String(ms).padStart(8)
  )
}

if (outFile) {
  fs.writeFileSync(path.resolve(outFile), JSON.stringify(result, null, 2))
  console.log('\n已写入:', path.resolve(outFile))
}

if (compareFile) {
  const before = JSON.parse(fs.readFileSync(path.resolve(compareFile), 'utf8'))
  const map = new Map(before.entries.map(e => [e.name, e]))
  let bad = 0
  console.log('\n===== 对照 =====')
  for (const e of result.entries) {
    const b = map.get(e.name)
    if (!b) { console.log(`? ${e.name}：基线里没有这条（新加的配置）`); continue }
    const same = b.cellsHash === e.cellsHash && b.codesHash === e.codesHash
    /* 逐位一致之外，还要逐字比对所有统计量：可拼性 / 孤立豆 / 豆数 / 空格数 / 还原度。
       光比 cells 可能"格子一样但统计读错"，那同样是不能接受的回归。 */
    const fields = ['beadCount', 'emptyCount', 'similarity', 'deltaE', 'buildability', 'isolatedCount']
    const diffs = fields.filter(f => b[f] !== e[f])
    const ok = e.expect === 'same' ? (same && !diffs.length) : true
    if (!ok) bad++
    const mark = (same ? '逐位一致' : '格子有差异') + (diffs.length ? ` 统计量变:${diffs.join(',')}` : '')
    console.log(
      `${ok ? (e.expect === 'same' ? '✓' : '·') : '✗'} ${e.name.padEnd(38)} ${mark.padEnd(28)}` +
      `色数 ${b.colors}→${e.colors}  simApp ${b.similarity.toFixed(3)}→${e.similarity.toFixed(3)}` +
      `  dE ${b.deltaE.toFixed(2)}→${e.deltaE.toFixed(2)}` +
      `  可拼性 ${b.buildability.toFixed(2)}→${e.buildability.toFixed(2)}` +
      `  孤立 ${b.isolatedCount}→${e.isolatedCount}` +
      `  ${b.ms}ms→${e.ms}ms`
    )
  }
  console.log(bad ? `\n${bad} 项不符合预期` : '\n全部符合预期（≤464 既有档位 / 显式 supersample / 抖动 路径逐位一致，统计量逐字一致）')
  process.exit(bad ? 1 : 0)
}
