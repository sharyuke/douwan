/* 卡通化的参数搜索台（开发用）。

   cartoon-bench.mjs 只报"当前预设"的分数；这个脚本回答另一个问题：
   **"把某个参数扫一遍，指标往哪个方向走"**。

   数值一律用 cartoon-bench.mjs 的同一套独立口径，保证和正式跑分对得上：
     edgeRecall/edgePrecision 原图轮廓保住了多少、画出来的线有多少是真轮廓
     featKeep/featCorr      眼睛/文字/高光这类特征还剩多少
     flatten                无边缘处的纹理被抹平了多少（越高越像平涂）
     inkShare               画面里有多少像素被描边覆盖（对照手绘插画实测约 0.06~0.10）
     dEview/hueShift        远看色差 / 色相偏移（有没有编造颜色）
     build/isolated         对拼豆图纸的影响

   用法：
     node scripts/fidelity/cartoon-sweep.mjs --param inkWidth --values 0,1,2,3
     node scripts/fidelity/cartoon-sweep.mjs --param inkDarken --values 0.3,0.42,0.55 --style standard
*/

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cartoonize, CARTOON_STYLES } from '../../src/lib/cartoon.js'
import {
  generateFromPixels, resampleRGBA, variantParams
} from '../../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'
import { deltaE2000, rgbToLab } from '../../src/lib/color.js'
import { readPNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')
const USER = path.join(HERE, 'fixtures-user')

const GW = 29
const GH = 29

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : fallback
}

/* ------------------------------ 指标（与 cartoon-bench.mjs 同口径） */

function lumaOf (data, w, h) {
  const Y = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    Y[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return Y
}

function boxBlur (src, w, h, r) {
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

function sobel (Y, w, h) {
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

function quantile (arr, q) {
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

function corr (a, b, idx) {
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

function cartoonMetrics (src, out, w, h, inkMask) {
  const Ys = lumaOf(src, w, h)
  const Yo = lumaOf(out, w, h)
  const stride = Math.max(1, Math.round((w * h) / 20000))
  const idx = []
  for (let i = 0; i < w * h; i += stride) idx.push(i)

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

  const blurS = boxBlur(Ys, w, h, 3)
  const blurO = boxBlur(Yo, w, h, 3)
  const detailS = new Float32Array(w * h)
  const contrastS = new Float32Array(w * h)
  const contrastO = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    detailS[i] = Math.abs(Ys[i] - blurS[i])
    contrastS[i] = Ys[i] - blurS[i]
    contrastO[i] = Yo[i] - blurO[i]
  }
  const detailBlob = boxBlur(detailS, w, h, 1)
  const cut = quantile(detailBlob, 0.98)
  const featIdx = idx.filter(i => detailBlob[i] >= cut && detailBlob[i] > 3)
  let sumS = 0, sumO = 0
  for (const i of featIdx) { sumS += Math.abs(contrastS[i]); sumO += Math.abs(contrastO[i]) }
  const keep = sumS > 0 ? sumO / sumS : 0
  const featCorr = featIdx.length > 4 ? corr(contrastS, contrastO, featIdx) : 0
  // 特征点的平均局部对比（绝对值），比"比例"更能看出五官有没有真的留下来
  const featContrast = featIdx.length ? sumS / featIdx.length : 0
  const featOutContrast = featIdx.length ? sumO / featIdx.length : 0

  /* 压平度：只看原图没有边缘、且**不在描边上**的地方 ——
     描边本身是强对比，算进来指标就失去意义（这一条原来漏了，导致加粗描边会把压平度算成负数） */
  const gLow = quantile(gs, 0.6)
  let sq = 0, oq = 0, qn = 0
  for (let i = 0; i < w * h; i++) {
    if (gs[i] >= gLow) continue
    if (inkMask && inkMask[i]) continue
    sq += Math.abs(contrastS[i]); oq += Math.abs(contrastO[i]); qn++
  }
  const flatten = sq > 0 ? 1 - oq / sq : 0
  let ink = 0
  if (inkMask) for (let i = 0; i < w * h; i++) if (inkMask[i]) ink++

  return {
    dEview: n ? dE / n : 0,
    hueShift: hues.length ? hues[Math.floor(hues.length / 2)] : 0,
    structure,
    edgeRecall: recall,
    edgePrecision: precision,
    featKeep: keep,
    featCorr,
    featContrast,
    featOutContrast,
    flatten,
    inkShare: n ? ink / (w * h) : 0
  }
}

/* ------------------------------ 拼豆链路 */

function patternOf (data, w, h, variantKey, targetColors) {
  return generateFromPixels(data, w, h, {
    gw: GW,
    gh: GH,
    fit: 'contain',
    targetColors,
    brandId: DEFAULT_BRAND_ID,
    colors: getColors(DEFAULT_BRAND_ID),
    variantKey,
    variantParams: variantParams(variantKey, targetColors)
  })
}

function main () {
  const onlyStyle = String(arg('style', 'standard'))
  const param = String(arg('param', 'inkWidth'))
  const values = String(arg('values', '0,1,2,3')).split(',').map(v => Number(v))
  const targetColors = Number(arg('colors', 13)) || 13
  const variantKey = String(arg('variant', 'easy'))

  const files = []
  for (const f of fs.readdirSync(FIXTURES).sort()) {
    if (!/\.png$/i.test(f) || /\.mask\.png$/i.test(f)) continue
    if (fs.existsSync(path.join(FIXTURES, f.replace(/\.png$/i, '.mask.png')))) continue
    files.push(path.join(FIXTURES, f))
  }
  if (fs.existsSync(USER)) {
    for (const f of fs.readdirSync(USER).sort()) if (/\.png$/i.test(f)) files.push(path.join(USER, f))
  }
  if (!files.length) { console.error('没有测试图'); process.exit(1) }
  const base = CARTOON_STYLES.find(s => s.key === onlyStyle) || CARTOON_STYLES[1]

  console.log(`参数扫描：${param} = ${values.join(' / ')}   风格 ${base.key}   测试图 ${files.length} 张\n`)
  console.log('值'.padEnd(8) + '平涂色  ink占比  边缘召回 边缘精确  特征保留 特征相关  压平度  远看ΔE  色相  可拼性 孤立豆')

  for (const v of values) {
    const style = { ...base, [param]: v }
    const acc = { levels: 0, ink: 0, recall: 0, precision: 0, keep: 0, fcorr: 0, flatten: 0, dE: 0, hue: 0, build: 0, iso: 0 }
    for (const file of files) {
      const img = readPNG(file)
      const c = cartoonize(img.data, img.width, img.height, { style })
      const m = cartoonMetrics(img.data, c.data, img.width, img.height, null)
      const p = patternOf(c.data, img.width, img.height, variantKey, targetColors)
      acc.levels += c.meta.levels
      acc.ink += inkCoverage(c, img.width, img.height)
      acc.recall += m.edgeRecall
      acc.precision += m.edgePrecision
      acc.keep += m.featKeep
      acc.fcorr += m.featCorr
      acc.flatten += m.flatten
      acc.dE += m.dEview
      acc.hue += m.hueShift
      acc.build += p.stats.buildability
      acc.iso += p.stats.isolatedCount
    }
    const N = files.length
    console.log(
      String(v).padEnd(8) +
      (acc.levels / N).toFixed(1).padStart(6) +
      (acc.ink / N).toFixed(3).padStart(8) +
      (acc.recall / N).toFixed(3).padStart(10) +
      (acc.precision / N).toFixed(3).padStart(9) +
      (acc.keep / N).toFixed(3).padStart(10) +
      (acc.fcorr / N).toFixed(3).padStart(9) +
      (acc.flatten / N).toFixed(3).padStart(8) +
      (acc.dE / N).toFixed(2).padStart(8) +
      (acc.hue / N).toFixed(1).padStart(6) +
      (acc.build / N).toFixed(2).padStart(8) +
      (acc.iso / N).toFixed(0).padStart(7)
    )
  }
}

/** 输出图里被描边覆盖的比例：直接数"比周围明显更暗"的像素，不依赖内部状态 */
function inkCoverage (c, w, h) {
  const src = c.data
  const Y = lumaOf(src, w, h)
  const blur = boxBlur(Y, w, h, 2)
  let dark = 0
  for (let i = 0; i < w * h; i++) if (blur[i] - Y[i] > 12) dark++
  return dark / (w * h)
}

/* 只有被直接执行时才跑：import 这个文件（比如做语法检查或复用它的指标函数）不应该
   顺手跑一整套参数扫描。 */
const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
