/* =========================================================================
   100 万格（1000×1000）生成耗时解剖（开发用，Node 直接跑）

   为什么要它：用户把画布上限从 464 提到 1000（100 万格），"跑不动" 和 "色彩还原不够"
   是同一件需求的两面 —— 只优化还原度会让 1000 格更慢，只优化速度又会更糊。
   所以先把一次 generateFromPixels 拆开量出来：到底卡在采样、选色、映射、还是评分。
   拆法：几个阶段用 pattern.js 的导出函数单独跑一遍，剩下的归到"其余"（映射 + 后处理）。

   --impl before 会加载一份"改动前"的 pattern.js 冻结副本（默认找
   scripts/fidelity/pattern-before.mjs，也可以用 --before 指定别的路径），
   于是同一台机器、同一条命令就能得到"改动前 vs 改动后"的耗时，不受机器差异影响。
   那份副本不进版本库，需要时按下面两条命令重新生成（git 直接写文件，不经任何文本转码）：
     git archive HEAD src/lib/pattern.js -o head.tar && tar -xf head.tar
     然后把 src/lib/pattern.js 复制成 scripts/fidelity/pattern-before.mjs，
     并把里面 4 行 './color.js' 之类的 import 改成 '../../src/lib/...'

   用法：
     node scripts/verify/perf-1000.mjs
     node scripts/verify/perf-1000.mjs --impl before --image scripts/fidelity/out/asset-redraw-tall.png
     node scripts/verify/perf-1000.mjs --grids 1000 --colors 30 --ss 2 --repeat 3
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as implAfter from '../../src/lib/pattern.js'
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

const implKey = String(arg('impl', 'after'))
if (implKey !== 'after' && implKey !== 'before') throw new Error('--impl 只能是 after / before')
let impl = implAfter
if (implKey === 'before') {
  const beforePath = path.resolve(String(arg('before', path.join(HERE, '..', 'fidelity', 'pattern-before.mjs'))))
  if (!fs.existsSync(beforePath)) {
    console.error(`找不到"改动前"的冻结副本：${beforePath}`)
    console.error('按本文件头部注释里的两条命令从 git HEAD 生成一份即可。')
    process.exit(2)
  }
  impl = await import(new URL('file://' + beforePath.replace(/\\/g, '/')).href)
}
const {
  generateFromPixels, variantParams, resampleRGBA, sampleCellsMatted, supersampleFactor,
  quantize, similarityOf, buildability
} = impl

const imagePath = path.resolve(String(arg('image', path.join(ROOT, 'scripts', 'fidelity', 'out', 'photo-src', 'ref_girl.png'))))
const maxSide = Number(arg('maxside', 2048))
const grids = String(arg('grids', '116,450,1000')).split(',').map(Number).filter(n => n > 0)
const targets = String(arg('colors', '16,30')).split(',').map(Number).filter(n => n > 0)
const outFile = arg('out', null)
const variantKey = String(arg('variant', 'easy'))
/** 显式钉死超采样倍率：用来把「超采样封顶」和「最近色记忆化」两个改动分开测 */
const ssOverride = arg('ss', null)
const repeat = Number(arg('repeat', 2)) || 1

function limitSide(src, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh))
  if (k >= 1) return { data: src, width: sw, height: sh, scaled: false }
  const tw = Math.max(1, Math.round(sw * k))
  const th = Math.max(1, Math.round(sh * k))
  const { data } = resampleRGBA(src, sw, sh, tw, th, 'cover')
  return { data, width: tw, height: th, scaled: true }
}

const img = readPNG(imagePath)
const src = limitSide(img.data, img.width, img.height, maxSide)
const palette = getColors(DEFAULT_BRAND_ID)

const ms = (fn) => { const t = performance.now(); const v = fn(); return { v, ms: performance.now() - t } }

console.log(`===== 100 万格耗时解剖（impl=${implKey}${ssOverride ? `，SS 钉死为 ${ssOverride}` : ''}）=====`)
console.log(`源图 ${path.basename(imagePath)} ${img.width}×${img.height} ⇒ 读入 ${src.width}×${src.height}（maxside=${maxSide}）`)
console.log('')
console.log('画布      目标色  SS  采样ms  选色ms  映射+其余ms  评分ms  合计ms  每格源像素  不同色数')

const rows = []
for (const g of grids) {
  for (const target of targets) {
    const vp = variantParams(variantKey, target)
    /* 阶段 1 必须用「这个实现真正会用的 SS」，否则分解出来的"其余"会算成负数：
       改动后 SS = min(supersampleFactor, 按源图真实分辨率封顶)，改动前只有 supersampleFactor。
       靠导出的 maxUsefulSupersample 是否存在来判断是哪一版。 */
    const autoSs = impl.maxUsefulSupersample
      ? Math.min(supersampleFactor(g, g), impl.maxUsefulSupersample(src.width, src.height, g, g, 'contain'))
      : supersampleFactor(g, g)
    const ss = ssOverride ? Number(ssOverride) : autoSs

    // 阶段 1：采样 + 每格取色
    const p1 = ms(() => sampleCellsMatted(src.data, src.width, src.height, g, g, 'contain', ss, undefined, null, null))
    const cellRgb = p1.v.rgb
    // 每格摊得到几个源像素（只作说明用：contain 下按短边算）
    const k = Math.min(g / src.width, g / src.height)
    const perCell = 1 / k
    // 记忆化到底有多少复用机会？统计 cellRgb 里不同的 24bit 颜色数
    const seen = new Set()
    for (let i = 0; i < cellRgb.length; i += 3) {
      seen.add((cellRgb[i] << 16) | (cellRgb[i + 1] << 8) | cellRgb[i + 2])
    }
    // 阶段 2：选色
    const p2 = ms(() => quantize(cellRgb, vp.cap, palette, 'lab', null))
    const labs = p2.v.map(p => p.lab)
    // 阶段 3：评分（相似度 + 可拼性）—— 用一条真实索引序列，量级与真实一致
    const n = g * g
    const fakeIdx = new Int32Array(n)
    for (let i = 0; i < n; i++) fakeIdx[i] = i % Math.max(1, labs.length)
    const p3 = ms(() => {
      similarityOf(fakeIdx, p2.v, cellRgb, g, g)
      buildability(fakeIdx, g, g, p2.v.length)
    })
    // 全流程（跑 repeat 次取最小值，压掉 GC / JIT 抖动）
    let total = Infinity
    let last = null
    for (let r = 0; r < repeat; r++) {
      const p4 = ms(() => generateFromPixels(src.data, src.width, src.height, {
        gw: g,
        gh: g,
        fit: 'contain',
        targetColors: target,
        brandId: DEFAULT_BRAND_ID,
        colors: palette,
        variantKey,
        variantParams: vp,
        supersample: ssOverride ? Number(ssOverride) : undefined
      }))
      if (p4.ms < total) total = p4.ms
      last = p4.v
    }
    const p4 = { v: last, ms: total }
    const other = p4.ms - p1.ms - p2.ms - p3.ms
    const row = {
      grid: g,
      cells: n,
      targetColors: target,
      variant: variantKey,
      cap: vp.cap,
      ss,
      usedColors: p4.v.palette.length,
      emptyCount: p4.v.stats.emptyCount,
      similarity: p4.v.stats.similarity,
      deltaE: p4.v.stats.deltaE,
      sampleMs: Math.round(p1.ms),
      quantizeMs: Math.round(p2.ms),
      scoreMs: Math.round(p3.ms),
      otherMs: Math.round(other),
      totalMs: Math.round(p4.ms),
      perCellSourcePixels: Math.round(perCell * 100) / 100,
      distinctColors: seen.size
    }
    rows.push(row)
    console.log(
      `${g}×${g}`.padEnd(10) +
      String(target).padStart(5) +
      String(ss).padStart(4) +
      String(row.sampleMs).padStart(8) +
      String(row.quantizeMs).padStart(8) +
      String(row.otherMs).padStart(12) +
      String(row.scoreMs).padStart(8) +
      String(row.totalMs).padStart(8) +
      row.perCellSourcePixels.toFixed(2).padStart(12) +
      String(row.distinctColors).padStart(11) +
      `   实用色 ${row.usedColors}`
    )
  }
}

if (outFile) {
  fs.writeFileSync(path.resolve(outFile), JSON.stringify({
    at: new Date().toISOString(),
    image: path.basename(imagePath),
    sourceSize: { width: img.width, height: img.height },
    readSize: { width: src.width, height: src.height, maxSide },
    rows
  }, null, 2))
  console.log('\n已写入:', path.resolve(outFile))
}
