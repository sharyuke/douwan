/* =========================================================================
   还原度回归评测（开发用，Node 直接跑，不需要浏览器）

   为什么这么搭：拼豆引擎的取样 / 量化 / 后处理任何一步改动都可能「这张变好、那张变差」。
   只靠肉眼看一两张图，很容易把别的题材调坏。这里用固定的一组测试图 + 多个互相独立的
   指标，把「改之前 / 改之后」变成可比较的数字。

   为什么能在 Node 里跑：src/lib/pattern.js 的取样与生成核心都是纯函数
   （resampleRGBA / sampleCellsFromRGBA / generateFromPixels），不依赖 DOM，
   所以这里跑的就是线上那一份算法代码，不是另写一套。

   指标（全部是「越小越好」）：
     simApp  界面显示的还原度（图案单格 vs 原图邻域平均色）—— 只作对照
     dEcell  每格：图案颜色 vs 该格覆盖的原图像素均值 —— 最严格，看「这颗豆对不对」
     dEview  图案按每格铺开、与原图一起按一格半径模糊后逐像素 CIEDE2000 —— 看「远看像不像」

   用法：
     node scripts/fidelity/bench.mjs --label after
     node scripts/fidelity/bench.mjs --label before --quantizer legacy --legacy-post
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

import {
  generateFromPixels, sampleCellsFromRGBA, resampleRGBA, variantParams,
  MERGE_MAX_DE, CLEANUP_MAX_DE, VOTE_MIN_SHARE
} from '../../src/lib/pattern.js'
import { getColors, spreadColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'
import { deltaE2000, deltaEToSimilarity, rgbToLab, labDist2 } from '../../src/lib/color.js'
import { readPNG, writePNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')
const OUT = path.join(HERE, 'out')

const GW = 29
const GH = 29
const R = 4 // 评测栅格：每格 R×R 像素
const W = GW * R
const H = GH * R

const CONFIGS = [
  // 线上默认：漫德 MARD 全色号（免费版现在也是全色号）
  { name: 'easy-13-mard', variantKey: 'easy', targetColors: 13, pool: 'brand' },
  { name: 'easy-16-mard', variantKey: 'easy', targetColors: 16, pool: 'brand' },
  { name: 'high-13-mard', variantKey: 'high', targetColors: 13, pool: 'brand' },
  { name: 'art-13-mard', variantKey: 'art', targetColors: 13, pool: 'brand' },
  // 对照：旧的 48 色精简色板
  { name: 'easy-13-free48', variantKey: 'easy', targetColors: 13, pool: 'free48' },
  { name: 'high-13-free48', variantKey: 'high', targetColors: 13, pool: 'free48' }
]

/* ------------------------------------------------------------ 极简 PNG 读写 */
// readPNG / crc32 / writePNG 已抽到 ./png.mjs（matte-bench.mjs 共用同一份实现）

/* ------------------------------------------------------------ 旧实现（对照用） */

/** 改动前的量化：k-means（自由质心）→ 每个簇再找最近色号。只在评测里用来做对照。 */
function legacyQuantize(rgb, k, palette) {
  const total = rgb.length / 3
  const stride = Math.max(1, Math.floor(total / 5000))
  const pts = []
  for (let i = 0; i < total; i += stride) {
    const o = i * 3
    pts.push(rgbToLab(rgb[o], rgb[o + 1], rgb[o + 2]))
  }
  if (!pts.length || !palette.length) return palette.slice(0, Math.max(1, k))
  const K = Math.max(1, Math.min(k, palette.length, pts.length))
  const centers = [pts[Math.floor(pts.length / 2)].slice()]
  while (centers.length < K) {
    let pick = pts[0]
    let bestD = -1
    const step = Math.max(1, Math.floor(pts.length / 360))
    for (let i = 0; i < pts.length; i += step) {
      let dmin = Infinity
      for (const c of centers) {
        const d = labDist2(pts[i], c)
        if (d < dmin) dmin = d
      }
      if (dmin > bestD) { bestD = dmin; pick = pts[i] }
    }
    centers.push(pick.slice())
  }
  const assign = new Int32Array(pts.length)
  for (let iter = 0; iter < 10; iter++) {
    let moved = false
    for (let i = 0; i < pts.length; i++) {
      let bi = 0, bd = Infinity
      for (let c = 0; c < centers.length; c++) {
        const d = labDist2(pts[i], centers[c])
        if (d < bd) { bd = d; bi = c }
      }
      if (assign[i] !== bi) { assign[i] = bi; moved = true }
    }
    const sum = centers.map(() => [0, 0, 0, 0])
    for (let i = 0; i < pts.length; i++) {
      const s = sum[assign[i]]
      s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++
    }
    for (let c = 0; c < centers.length; c++) {
      if (sum[c][3]) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]]
    }
    if (!moved && iter > 0) break
  }
  const cost = centers.map(() => new Float64Array(palette.length))
  for (let i = 0; i < pts.length; i++) {
    const row = cost[assign[i]]
    for (let p = 0; p < palette.length; p++) row[p] += labDist2(pts[i], palette[p].lab)
  }
  const chosen = []
  const used = new Set()
  for (let c = 0; c < cost.length; c++) {
    const row = cost[c]
    let bi = 0, bd = Infinity
    for (let p = 0; p < row.length; p++) if (row[p] < bd) { bd = row[p]; bi = p }
    if (used.has(palette[bi].id)) {
      let alt = -1, abd = Infinity
      for (let p = 0; p < row.length; p++) {
        if (used.has(palette[p].id)) continue
        if (row[p] < abd) { abd = row[p]; alt = p }
      }
      if (alt >= 0) bi = alt
    }
    used.add(palette[bi].id)
    chosen.push(palette[bi])
  }
  return chosen.length ? chosen : palette.slice(0, K)
}

/* ------------------------------------------------------------ 指标 */

const labCache = new Map()
function labOf(r, g, b) {
  const k = (r << 16) | (g << 8) | b
  let v = labCache.get(k)
  if (!v) { v = rgbToLab(r, g, b); labCache.set(k, v) }
  return v
}

function patternRaster(pattern) {
  const out = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const c = pattern.palette[pattern.cells[y * GW + x]]
      if (!c) continue
      for (let sy = 0; sy < R; sy++) {
        for (let sx = 0; sx < R; sx++) {
          const o = ((y * R + sy) * W + (x * R + sx)) * 4
          out[o] = c.rgb[0]; out[o + 1] = c.rgb[1]; out[o + 2] = c.rgb[2]; out[o + 3] = 255
        }
      }
    }
  }
  return out
}

function blur(data, radius, passes = 3) {
  let src = Float32Array.from(data)
  const tmp = new Float32Array(src.length)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k
          if (xx < 0 || xx >= W) continue
          const o = (y * W + xx) * 4
          r += src[o]; g += src[o + 1]; b += src[o + 2]; n++
        }
        const o = (y * W + x) * 4
        tmp[o] = r / n; tmp[o + 1] = g / n; tmp[o + 2] = b / n; tmp[o + 3] = 255
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k
          if (yy < 0 || yy >= H) continue
          const o = (yy * W + x) * 4
          r += tmp[o]; g += tmp[o + 1]; b += tmp[o + 2]; n++
        }
        const o = (y * W + x) * 4
        src[o] = r / n; src[o + 1] = g / n; src[o + 2] = b / n; src[o + 3] = 255
      }
    }
  }
  return src
}

function meanDeltaE(a, b) {
  let sum = 0, n = 0
  for (let o = 0; o < a.length; o += 4) {
    sum += deltaE2000(labOf(a[o], a[o + 1], a[o + 2]), labOf(b[o], b[o + 1], b[o + 2]))
    n++
  }
  return n ? sum / n : 99
}

function cellDeltaE(pattern, srcData) {
  let sum = 0
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      let sr = 0, sg = 0, sb = 0
      for (let sy = 0; sy < R; sy++) {
        for (let sx = 0; sx < R; sx++) {
          const o = ((y * R + sy) * W + (x * R + sx)) * 4
          sr += srcData[o]; sg += srcData[o + 1]; sb += srcData[o + 2]
        }
      }
      const n = R * R
      const c = pattern.palette[pattern.cells[y * GW + x]]
      if (!c) continue
      sum += deltaE2000(c.lab, labOf(Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)))
    }
  }
  return sum / (GW * GH)
}

/**
 * 结构保留度：把「相邻两格的颜色差」当成边缘强度，
 * 看图案的边缘强度与原图的边缘强度是否一致（皮尔逊相关，越接近 1 越好），
 * 以及边缘能量比（图案 / 原图，1 表示对比不丢不涨）。
 * 只报 dEcell/dEview 是不够的：把每格都取成邻域平均色，这两个指标会很好看，
 * 但图会整体发糊 —— 这个指标就是用来兜住「越优化越糊」的。
 */
function edgeMetrics(pattern, srcData) {
  const srcCell = new Float64Array(GW * GH * 3)
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      let sr = 0, sg = 0, sb = 0
      for (let sy = 0; sy < R; sy++) {
        for (let sx = 0; sx < R; sx++) {
          const o = ((y * R + sy) * W + (x * R + sx)) * 4
          sr += srcData[o]; sg += srcData[o + 1]; sb += srcData[o + 2]
        }
      }
      const n = R * R
      const lab = labOf(Math.round(sr / n), Math.round(sg / n), Math.round(sb / n))
      const i = (y * GW + x) * 3
      srcCell[i] = lab[0]; srcCell[i + 1] = lab[1]; srcCell[i + 2] = lab[2]
    }
  }
  const patCell = new Float64Array(GW * GH * 3)
  for (let i = 0; i < GW * GH; i++) {
    const c = pattern.palette[pattern.cells[i]]
    const lab = c ? c.lab : [0, 0, 0]
    patCell[i * 3] = lab[0]; patCell[i * 3 + 1] = lab[1]; patCell[i * 3 + 2] = lab[2]
  }
  const ds = []
  const dp = []
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x
      for (const j of [x + 1 < GW ? i + 1 : -1, y + 1 < GH ? i + GW : -1]) {
        if (j < 0) continue
        ds.push(deltaE2000([srcCell[i * 3], srcCell[i * 3 + 1], srcCell[i * 3 + 2]], [srcCell[j * 3], srcCell[j * 3 + 1], srcCell[j * 3 + 2]]))
        dp.push(deltaE2000([patCell[i * 3], patCell[i * 3 + 1], patCell[i * 3 + 2]], [patCell[j * 3], patCell[j * 3 + 1], patCell[j * 3 + 2]]))
      }
    }
  }
  const n = ds.length
  let ms = 0, mp = 0
  for (let i = 0; i < n; i++) { ms += ds[i]; mp += dp[i] }
  ms /= n; mp /= n
  let cov = 0, vs = 0, vp = 0
  for (let i = 0; i < n; i++) {
    const a = ds[i] - ms
    const b = dp[i] - mp
    cov += a * b; vs += a * a; vp += b * b
  }
  return {
    edgeCorr: vs > 0 && vp > 0 ? cov / Math.sqrt(vs * vp) : 0,
    edgeEnergy: ms > 0 ? mp / ms : 1
  }
}

/* ------------------------------------------------------------ 主流程 */

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : fallback
}

function poolOf(kind) {
  const all = getColors(DEFAULT_BRAND_ID)
  if (kind === 'brand') return all
  const n = Number(String(kind).replace('free', '')) || 48
  return spreadColors(all, n)
}

function renderPNG(pattern, file, cell = 14) {
  const w = GW * cell
  const h = GH * cell
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const c = pattern.palette[pattern.cells[y * GW + x]]
      for (let sy = 0; sy < cell; sy++) {
        for (let sx = 0; sx < cell; sx++) {
          const o = ((y * cell + sy) * w + (x * cell + sx)) * 3
          rgb[o] = c ? c.rgb[0] : 255
          rgb[o + 1] = c ? c.rgb[1] : 255
          rgb[o + 2] = c ? c.rgb[2] : 255
        }
      }
    }
  }
  writePNG(file, rgb, w, h)
}

function main() {
  const label = String(arg('label', 'run'))
  const useLegacyQuant = arg('quantizer', 'new') === 'legacy'
  const legacyPost = !!arg('legacy-post', false)
  const doRender = !!arg('render', false)
  const assign = arg('assign', null) // 'lab' 旧口径 / 'de' 默认（CIEDE2000）
  const vote = arg('vote', null) // 多数投票门槛，默认 0.34
  const dither = arg('dither', null) // 覆盖抖动：off/low/medium/high
  const supersample = arg('ss', null)
  const cleanupDE = arg('cleanup-de', null)
  const mergeDE = arg('merge-de', null)
  const quantMetric = arg('quant-metric', null)

  // 有同名真值掩膜的图（cut_*.mask.png）属于抠图精度评测（matte-bench.mjs），
  // 不参与图案还原度评测：它们的平均色差量级和真实素材差太远，混进来会把指标带偏
  const files = fs.readdirSync(FIXTURES)
    .filter(f => /\.png$/i.test(f) && !/\.mask\.png$/i.test(f))
    .filter(f => !fs.existsSync(path.join(FIXTURES, f.replace(/\.png$/i, '.mask.png'))))
    .sort()
  if (!files.length) {
    console.error('没有测试图，先跑 python scripts/fidelity/fixtures-gen.py')
    process.exit(1)
  }

  const renderDir = path.join(OUT, 'renders', label)
  fs.mkdirSync(renderDir, { recursive: true })

  const rows = []
  const byConfig = new Map()

  for (const file of files) {
    const name = file.replace(/\.png$/i, '')
    const img = readPNG(path.join(FIXTURES, file))
    const src = resampleRGBA(img.data, img.width, img.height, W, H, 'contain')
    const srcBlur = blur(src.data, 2)

    for (const cfg of CONFIGS) {
      const t0 = Date.now()
      const vp = variantParams(cfg.variantKey, cfg.targetColors)
      if (legacyPost) { vp.mergeMaxDE = 999; vp.cleanupMaxDE = 999 }
      if (assign) vp.assign = assign
      if (dither) vp.dither = dither
      if (cleanupDE !== null) vp.cleanupMaxDE = Number(cleanupDE)
      if (mergeDE !== null) vp.mergeMaxDE = Number(mergeDE)
      const pattern = generateFromPixels(img.data, img.width, img.height, {
        gw: GW,
        gh: GH,
        fit: 'contain',
        targetColors: cfg.targetColors,
        brandId: DEFAULT_BRAND_ID,
        colors: poolOf(cfg.pool),
        variantKey: cfg.variantKey,
        variantParams: vp,
        supersample: supersample ? Number(supersample) : undefined,
        voteMinShare: vote ? Number(vote) : undefined,
        quantMetric: quantMetric || 'auto',
        quantizer: useLegacyQuant ? legacyQuantize : undefined
      })
      const ms = Date.now() - t0
      const raster = patternRaster(pattern)
      const dEview = meanDeltaE(blur(raster, 2), srcBlur)
      const edge = edgeMetrics(pattern, src.data)
      const row = {
        fixture: name,
        config: cfg.name,
        colorCount: pattern.palette.length,
        codes: pattern.palette.map(c => c.code).join(' '),
        simApp: pattern.stats.similarity,
        dEApp: pattern.stats.deltaE,
        dEcell: Math.round(cellDeltaE(pattern, src.data) * 100) / 100,
        dEview: Math.round(dEview * 100) / 100,
        simView: Math.round(deltaEToSimilarity(dEview) * 1000) / 1000,
        edgeCorr: Math.round(edge.edgeCorr * 1000) / 1000,
        edgeEnergy: Math.round(edge.edgeEnergy * 1000) / 1000,
        isolated: pattern.stats.isolatedCount,
        buildability: pattern.stats.buildability,
        ms
      }
      rows.push(row)
      const e = byConfig.get(cfg.name) || { n: 0, simApp: 0, dEcell: 0, dEview: 0, colors: 0, iso: 0, edge: 0, energy: 0, build: 0 }
      e.n++
      e.simApp += row.simApp
      e.dEcell += row.dEcell
      e.dEview += row.dEview
      e.colors += row.colorCount
      e.iso += row.isolated
      e.edge += row.edgeCorr
      e.energy += row.edgeEnergy
      e.build += row.buildability
      byConfig.set(cfg.name, e)

      if (doRender && (name === 'photo_pumpkin' || name === 'synth_fruit' || name === 'synth_sky')) {
        renderPNG(pattern, path.join(renderDir, `${name}__${cfg.name}.png`))
      }
    }
  }

  const payload = {
    label,
    at: new Date().toISOString(),
    quantizer: useLegacyQuant ? 'legacy' : 'medoids',
    legacyPost,
    assign: assign || 'de',
    vote: vote || VOTE_MIN_SHARE,
    dither: dither || 'variant',
    mergeMaxDE: legacyPost ? 'off' : MERGE_MAX_DE,
    cleanupMaxDE: legacyPost ? 'off' : CLEANUP_MAX_DE,
    grid: `${GW}x${GH}`,
    rows
  }
  fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(payload, null, 2))

  console.log(`\n===== 还原度评测 ${label}（量化=${payload.quantizer}，护栏=${legacyPost ? '关' : '开'}）=====`)
  console.log('config            simApp  dEcell  dEview  色数  孤立豆  可拼性  边缘相关  边缘强度')
  for (const [name, e] of byConfig) {
    console.log(
      name.padEnd(16) +
      (e.simApp / e.n).toFixed(3).padStart(7) +
      (e.dEcell / e.n).toFixed(2).padStart(8) +
      (e.dEview / e.n).toFixed(2).padStart(8) +
      (e.colors / e.n).toFixed(1).padStart(6) +
      (e.iso / e.n).toFixed(0).padStart(8) +
      (e.build / e.n).toFixed(2).padStart(8) +
      (e.edge / e.n).toFixed(3).padStart(10) +
      (e.energy / e.n).toFixed(3).padStart(10)
    )
  }
  console.log('\n明细:', path.join(OUT, `${label}.json`))
  if (doRender) console.log('渲染图:', renderDir)
}

main()
