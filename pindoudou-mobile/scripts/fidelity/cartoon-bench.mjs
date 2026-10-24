/* =========================================================================
   卡通化回归评测（开发用，Node 直接跑，不需要浏览器）

   为什么要有这个脚本：「照片 → 卡通形象」这种效果最容易糊弄 —— 看着"挺卡通"，
   实际上眼睛、纹样、小物件已经被平涂吃掉了，或者干脆长出了原图没有的颜色。
   这里把"像不像/有没有编造"变成可比较的数字，改动前后各跑一次。

   指标（全部在源图分辨率上算，抽样加速）：
     结构一致度  原图与卡通的梯度幅值图相关（皮尔逊）—— 0.7 以上才算结构没被改
     色相偏移    卡通 vs 原图邻域平均色的色相角中位数（度）—— 编造颜色会立刻抬高它
     远看色差    卡通 vs 原图邻域平均色的平均 ΔE00 —— 概括了多少（越小越忠实）
     色块纯度    色块内部的原图方差占全局方差的比例 —— 低 = 把不同的东西糊成一块
     特征对比保留 原图上最强的 2% 细节（眼睛/文字/高光）在卡通里的局部对比还剩多少
     特征相关     同样这些点上，原图与卡通的局部对比的相关系数

   另外把「同一条拼豆链路」在卡通图上再跑一遍，看卡通化对图纸的影响
   （色块更大 = 更好拼；这里如实报出还原度/孤立豆/可拼性的变化）。

   用法：
     node scripts/fidelity/cartoon-bench.mjs
     node scripts/fidelity/cartoon-bench.mjs --style flat --render
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cartoonize, CARTOON_STYLES } from '../../src/lib/cartoon.js'
import {
  generateFromPixels, resampleRGBA, variantParams
} from '../../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'
import { deltaE2000, rgbToLab } from '../../src/lib/color.js'
import { readPNG, writePNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')
const OUT = path.join(HERE, 'out')

const GW = 29
const GH = 29
const R = 4
const W = GW * R
const H = GH * R

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : fallback
}

/* ------------------------------------------------------------ 基础指标 */

function lumaOf(data, w, h) {
  const Y = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    Y[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return Y
}

/** 可分离盒式模糊（和 cartoon.js 里那份同口径，评测脚本刻意自己写一遍） */
function boxBlur(src, w, h, r) {
  const span = 2 * r + 1
  const tmp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[y * w + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]
    }
  }
  const out = new Float32Array(w * h)
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

function sobel(Y, w, h) {
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1)
    const yp = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1)
      const xp = Math.min(w - 1, x + 1)
      const gx = Y[ym * w + xp] + 2 * Y[y * w + xp] + Y[yp * w + xp] -
        (Y[ym * w + xm] + 2 * Y[y * w + xm] + Y[yp * w + xm])
      const gy = Y[yp * w + xm] + 2 * Y[yp * w + x] + Y[yp * w + xp] -
        (Y[ym * w + xm] + 2 * Y[ym * w + x] + Y[ym * w + xp])
      g[y * w + x] = Math.sqrt(gx * gx + gy * gy) / 4
    }
  }
  return g
}

function corr(a, b, idx) {
  const n = idx.length
  let ma = 0, mb = 0
  for (const i of idx) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let cov = 0, va = 0, vb = 0
  for (const i of idx) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db; va += da * da; vb += db * db
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0
}

/**
 * 卡通化前后「像不像、有没有编造」的核心指标。
 * 全部在源图分辨率上抽样算：不依赖 cartoon.js 自己报的数字，属于独立口径。
 */
function cartoonMetrics(src, out, w, h) {
  const Ys = lumaOf(src, w, h)
  const Yo = lumaOf(out, w, h)
  const stride = Math.max(1, Math.round((w * h) / 20000))
  const idx = []
  for (let i = 0; i < w * h; i += stride) idx.push(i)

  // 远看色差 + 色相偏移：与原图 3×3 邻域平均色比
  let dE = 0, n = 0
  const hues = []
  for (const i of idx) {
    const x = i % w
    const y = (i - x) / w
    let ar = 0, ag = 0, ab = 0, an = 0
    for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
        const o = (yy * w + xx) * 4
        ar += src[o]; ag += src[o + 1]; ab += src[o + 2]; an++
      }
    }
    const l1 = rgbToLab(ar / an, ag / an, ab / an)
    const l2 = rgbToLab(out[i * 4], out[i * 4 + 1], out[i * 4 + 2])
    dE += deltaE2000(l1, l2)
    n++
    const c1 = Math.hypot(l1[1], l1[2])
    const c2 = Math.hypot(l2[1], l2[2])
    if (c1 > 8 && c2 > 8) {
      let dh = Math.atan2(l2[2], l2[1]) - Math.atan2(l1[2], l1[1])
      while (dh > Math.PI) dh -= 2 * Math.PI
      while (dh < -Math.PI) dh += 2 * Math.PI
      hues.push(Math.abs(dh) * 180 / Math.PI)
    }
  }
  hues.sort((a, b) => a - b)

  /* 边缘召回 / 边缘精确 —— 「抓住主要特征、不随手编造」最直接的两个数。
     口径（标准的边缘检测评测做法）：
       · 两边的"边缘"都按**各自图像**的对比度定阈值：取最强大 2% 梯度的一半，
         并且不低于 4 个灰度级 —— 低对比照片与高对比照片因此可以互相比较；
       · 允许 1 像素位移（卡通会把边缘改画成描边或色块交界，位置不可能逐像素一致），
         所以用 3×3 膨胀后再判定命中。
     召回低 = 原图的轮廓被抹掉了；精确低 = 卡通凭空画出了原图没有的线。 */
  const gs = sobel(Ys, w, h)
  const go = sobel(Yo, w, h)
  const thS = Math.max(4, quantile(gs, 0.98) * 0.5)
  const thO = Math.max(4, quantile(go, 0.98) * 0.5)
  const ms = new Uint8Array(w * h)
  const mo = new Uint8Array(w * h)
  let es = 0, eo = 0
  for (let i = 0; i < w * h; i++) {
    if (gs[i] >= thS) { ms[i] = 1; es++ }
    if (go[i] >= thO) { mo[i] = 1; eo++ }
  }
  const dil = (m) => {
    const d = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1) && !v; yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            if (m[yy * w + xx]) { v = 1; break }
          }
        }
        d[y * w + x] = v
      }
    }
    return d
  }
  const msD = dil(ms)
  const moD = dil(mo)
  let hit = 0, real = 0
  const edgeIdx = []
  for (let i = 0; i < w * h; i++) {
    if (ms[i] && moD[i]) hit++
    if (mo[i] && msD[i]) real++
    if (ms[i] && (i % stride === 0)) edgeIdx.push(i)
  }
  const structure = edgeIdx.length > 4 ? corr(gs, go, edgeIdx) : 0
  const recall = es ? hit / es : 1
  const precision = eo ? real / eo : 1

  /* 特征对比保留：原图上最强的 2% 细节（眼睛 / 文字 / 高光这类"关键小结构"），
     在卡通里还剩下多少局部对比。 */
  const detailS = new Float32Array(w * h)
  const blurS = boxBlur(Ys, w, h, 3)
  for (let i = 0; i < w * h; i++) detailS[i] = Math.abs(Ys[i] - blurS[i])
  const detailBlob = boxBlur(detailS, w, h, 1)
  const cut = quantile(detailBlob, 0.98)
  const featIdx = idx.filter(i => detailBlob[i] >= cut && detailBlob[i] > 3)
  const contrastS = new Float32Array(w * h)
  const blurO = boxBlur(Yo, w, h, 3)
  const contrastO = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    contrastS[i] = Ys[i] - blurS[i]
    contrastO[i] = Yo[i] - blurO[i]
  }
  let sumS = 0, sumO = 0
  for (const i of featIdx) { sumS += Math.abs(contrastS[i]); sumO += Math.abs(contrastO[i]) }
  const keep = sumS > 0 ? sumO / sumS : 0
  const featCorr = featIdx.length > 4 ? corr(contrastS, contrastO, featIdx) : 0

  /* 纹理压平度：只看**原图没有边缘**的地方（梯度低于自身 60 分位）——
     那里本来只有纹理，卡通应该把它抹平。包含边缘像素会把描边算进来，
     指标就不单调了（描边本身是很强的局部对比）。 */
  const gLow = quantile(gs, 0.6)
  let sq = 0, oq = 0, qn = 0
  for (let i = 0; i < w * h; i++) {
    if (gs[i] >= gLow) continue
    sq += Math.abs(contrastS[i]); oq += Math.abs(contrastO[i]); qn++
  }
  const flatten = sq > 0 ? 1 - oq / sq : 0

  return {
    dEview: dE / n,
    hueShift: hues.length ? hues[Math.floor(hues.length / 2)] : 0,
    structure,
    edgeRecall: recall,
    edgePrecision: precision,
    featKeep: keep,
    featCorr,
    featCount: featIdx.length,
    edgeCount: edgeIdx.length,
    flatten
  }
}

/** 分位数（直方图近似，与 cartoon.js 同口径但独立实现） */
function quantile(arr, q) {
  let max = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i]
  if (!(max > 0)) return 0
  const BINS = 1024
  const hist = new Uint32Array(BINS)
  for (let i = 0; i < arr.length; i++) hist[Math.min(BINS - 1, (arr[i] / max * BINS) | 0)]++
  const target = arr.length * q
  let acc = 0
  for (let b = 0; b < BINS; b++) {
    acc += hist[b]
    if (acc >= target) return ((b + 0.5) / BINS) * max
  }
  return max
}

/* ------------------------------------------------------------ 拼豆链路指标 */

function patternOf(data, w, h, variantKey, targetColors) {
  const vp = variantParams(variantKey, targetColors)
  return generateFromPixels(data, w, h, {
    gw: GW,
    gh: GH,
    fit: 'contain',
    targetColors,
    brandId: DEFAULT_BRAND_ID,
    colors: getColors(DEFAULT_BRAND_ID),
    variantKey,
    variantParams: vp
  })
}

function rasterOf(pattern) {
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

/** 图纸的每格色差 / 相邻格边缘相关（与 bench.mjs 同口径，便于互相印证） */
function patternQuality(pattern, target) {
  let dE = 0
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      let sr = 0, sg = 0, sb = 0
      for (let sy = 0; sy < R; sy++) {
        for (let sx = 0; sx < R; sx++) {
          const o = ((y * R + sy) * W + (x * R + sx)) * 4
          sr += target[o]; sg += target[o + 1]; sb += target[o + 2]
        }
      }
      const n = R * R
      const c = pattern.palette[pattern.cells[y * GW + x]]
      if (!c) continue
      dE += deltaE2000(c.lab, rgbToLab(sr / n, sg / n, sb / n))
    }
  }
  return dE / (GW * GH)
}

function renderPNG(file, data, w, h) {
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = data[i * 4]
    rgb[i * 3 + 1] = data[i * 4 + 1]
    rgb[i * 3 + 2] = data[i * 4 + 2]
  }
  writePNG(file, rgb, w, h)
}

function renderPatternPNG(file, pattern, cell = 14) {
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

/* ------------------------------------------------------------ 主流程 */

function main() {
  const only = arg('style', null)
  const doRender = !!arg('render', false)
  const targetColors = Number(arg('colors', 13)) || 13
  const variantKey = String(arg('variant', 'easy'))

  const files = fs.readdirSync(FIXTURES)
    .filter(f => /\.png$/i.test(f) && !/\.mask\.png$/i.test(f))
    .filter(f => !fs.existsSync(path.join(FIXTURES, f.replace(/\.png$/i, '.mask.png'))))
    .sort()
  if (!files.length) {
    console.error('没有测试图，先跑 python scripts/fidelity/fixtures-gen.py')
    process.exit(1)
  }
  const styles = CARTOON_STYLES.filter(s => !only || s.key === only)
  const renderDir = path.join(OUT, 'renders', 'cartoon')
  if (doRender) fs.mkdirSync(renderDir, { recursive: true })

  const rows = []
  for (const file of files) {
    const name = file.replace(/\.png$/i, '')
    const img = readPNG(path.join(FIXTURES, file))
    const src = img.data
    const w = img.width
    const h = img.height
    const sample = resampleRGBA(src, w, h, W, H, 'contain').data
    const base = patternOf(src, w, h, variantKey, targetColors)
    const baseDE = patternQuality(base, sample)
    rows.push({
      fixture: name,
      style: 'off',
      levels: base.palette.length,
      ms: 0,
      dEview: 0, hueShift: 0, structure: 1, edgeRecall: 1, edgePrecision: 1,
      featKeep: 1, featCorr: 1, purity: 1, flatten: 0,
      patColors: base.palette.length,
      patIsolated: base.stats.isolatedCount,
      patBuild: base.stats.buildability,
      patDE: Math.round(baseDE * 100) / 100,
      patSim: base.stats.similarity
    })

    for (const style of styles) {
      const t0 = Date.now()
      const c = cartoonize(src, w, h, { style })
      const ms = Date.now() - t0
      const m = cartoonMetrics(src, c.data, w, h)
      const p = patternOf(c.data, w, h, variantKey, targetColors)
      const pSample = resampleRGBA(c.data, w, h, W, H, 'contain').data
      const row = {
        fixture: name,
        style: style.key,
        levels: c.meta.levels,
        work: `${c.meta.width}×${c.meta.height}`,
        ms,
        dEview: Math.round(m.dEview * 100) / 100,
        hueShift: Math.round(m.hueShift * 10) / 10,
        structure: Math.round(m.structure * 1000) / 1000,
        edgeRecall: Math.round(m.edgeRecall * 1000) / 1000,
        edgePrecision: Math.round(m.edgePrecision * 1000) / 1000,
        featKeep: Math.round(m.featKeep * 1000) / 1000,
        featCorr: Math.round(m.featCorr * 1000) / 1000,
        purity: c.meta.purity,
        flatten: Math.round(m.flatten * 1000) / 1000,
        inkShare: c.meta.inkShare,
        anchorShare: c.meta.anchorShare,
        patColors: p.palette.length,
        patIsolated: p.stats.isolatedCount,
        patBuild: p.stats.buildability,
        patDE: Math.round(patternQuality(p, pSample) * 100) / 100,
        patSim: p.stats.similarity,
        baseDE: Math.round(baseDE * 100) / 100,
        baseBuild: base.stats.buildability,
        baseIsolated: base.stats.isolatedCount
      }
      rows.push(row)
      if (doRender) {
        renderPNG(path.join(renderDir, `${name}__${style.key}.png`), c.data, w, h)
        renderPatternPNG(path.join(renderDir, `${name}__${style.key}__pattern.png`), p)
        if (style === styles[0]) renderPatternPNG(path.join(renderDir, `${name}__off__pattern.png`), base)
      }
    }
  }

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'cartoon.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 2))

  // 汇总
  const agg = new Map()
  for (const r of rows) {
    const e = agg.get(r.style) || { n: 0, ms: 0, dEview: 0, hue: 0, structure: 0, recall: 0, precision: 0, keep: 0, fcorr: 0, purity: 0, flatten: 0, colors: 0, iso: 0, build: 0, de: 0, sim: 0, levels: 0 }
    e.n++
    e.ms += r.ms
    e.dEview += r.dEview
    e.hue += r.hueShift
    e.structure += r.structure
    e.recall += r.edgeRecall
    e.precision += r.edgePrecision
    e.keep += r.featKeep
    e.fcorr += r.featCorr
    e.purity += r.purity
    e.flatten += r.flatten
    e.colors += r.patColors
    e.iso += r.patIsolated
    e.build += r.patBuild
    e.de += r.patDE
    e.sim += r.patSim
    e.levels += r.levels
    agg.set(r.style, e)
  }

  console.log('\n===== 卡通化评测（每格 %d×%d 格，%s 方案，目标 %d 色）=====', GW, GH, variantKey, targetColors)
  console.log('风格        平涂色  色块纯度  远看ΔE  色相偏移  边缘召回  边缘精确  边缘相关  特征保留  特征相关  压平度  耗时ms')
  for (const [style, e] of agg) {
    console.log(
      style.padEnd(11) +
      (e.levels / e.n).toFixed(1).padStart(6) +
      (e.purity / e.n).toFixed(3).padStart(10) +
      (e.dEview / e.n).toFixed(2).padStart(8) +
      (e.hue / e.n).toFixed(2).padStart(10) +
      (e.recall / e.n).toFixed(3).padStart(10) +
      (e.precision / e.n).toFixed(3).padStart(10) +
      (e.structure / e.n).toFixed(3).padStart(10) +
      (e.keep / e.n).toFixed(3).padStart(10) +
      (e.fcorr / e.n).toFixed(3).padStart(10) +
      (e.flatten / e.n).toFixed(3).padStart(8) +
      (e.ms / e.n).toFixed(0).padStart(8)
    )
  }
  console.log('\n（色块纯度 = 每个平涂色块内部在原图上本来就是一致的；边缘召回/边缘精确/特征保留/特征相关' +
    '\n  越接近 1 越好；色相偏移 = 编造颜色的程度；压平度 = 无边缘处的纹理被抹掉的比例）')

  console.log('\n----- 对拼豆图纸的影响（同一条链路，只是源图换成卡通图）-----')
  console.log('风格        色号数  孤立豆  可拼性  每格ΔE(对卡通图)  界面还原度')
  for (const [style, e] of agg) {
    console.log(
      style.padEnd(11) +
      (e.colors / e.n).toFixed(1).padStart(6) +
      (e.iso / e.n).toFixed(0).padStart(8) +
      (e.build / e.n).toFixed(2).padStart(8) +
      (e.de / e.n).toFixed(2).padStart(18) +
      (e.sim / e.n).toFixed(3).padStart(12)
    )
  }
  console.log('\n明细:', path.join(OUT, 'cartoon.json'))
  if (doRender) console.log('渲染图:', renderDir)
}

main()
