/* =========================================================================
   抠图「主体与背景色相近」扫描（开发用，Node 直接跑）
   -------------------------------------------------------------------------
   为什么要它：matte-bench 用的是「合成图 + 真值掩膜」，但那批图的主体与背景
   色差都很大（ΔE00 ≥ 12）。用户抱怨的恰恰是**色差小**的那一档：
   「当主体和背景色相近时，尽可能多的保留主体」。
   所以这里按 ΔE00 从 8 扫到 30，一档一档看：
     · 主体有没有被吃掉（预测主体占比 vs 真值主体占比）
     · 影子那一步有没有把主体当成影子吃掉
     · 主体带/不带投影时结果差多少
   每个点都直接调 src/lib/matte.js 的 estimateMatte（线上同一份代码）。
   ========================================================================= */

import { estimateMatte, matteLevel } from '../../src/lib/matte.js'
import { rgbToLab, deltaE2000 } from '../../src/lib/color.js'

const NO_SHADOW = process.argv.includes('--no-shadow')
if (NO_SHADOW) matteLevel('normal').shadowFloor = 1

/** 圆心 (cx,cy) 半径 r 的覆盖率（1 像素线性过渡，与 fixtures-gen-cut.py 同一口径） */
function circleMask(size, cx, cy, r) {
  const m = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      m[y * size + x] = Math.min(1, Math.max(0, r + 0.5 - d))
    }
  }
  return m
}

/** 白底压出一块柔和投影（线性光乘法模型，与 fixtures-gen-cut.py 同一口径） */
function shadowField(size, cx, cy, rx, ry) {
  const s = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x - cx * size) / (rx * size), (y - cy * size) / (ry * size))
      const t = Math.min(1, Math.max(0, (1 - r) / 0.55))
      s[y * size + x] = t ** 1.3
    }
  }
  return s
}

/** sRGB 0~1 → 线性光 */
function toLin(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** 目标 ΔE00 的米色：沿 Lab 的 b 轴（加黄）调，让主体与白底的色差可控 */
function creamForDe(deTarget) {
  let lo = 0
  let hi = 90
  const white = rgbToLab(255, 255, 255)
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2
    const v = Math.max(0, 255 - mid)
    const lab = rgbToLab(v, v - 1.5, v - 3.5)
    if (deltaE2000(lab, white) < deTarget) lo = mid
    else hi = mid
  }
  const v = Math.max(0, 255 - lo)
  return [v, v - 1.5, v - 3.5]
}

function buildImage(size, objRGB, withShadow) {
  const src = new Uint8ClampedArray(size * size * 4)
  const truth = circleMask(size, size * 0.44, size * 0.44, size * 0.20)
  const sh = withShadow ? shadowField(size, 0.44, 0.70, 0.26, 0.08) : null
  const bgLin = [toLin(1), toLin(1), toLin(1)]
  for (let i = 0; i < size * size; i++) {
    let bg = [255, 255, 255]
    if (sh) {
      const s = sh[i] * 0.85
      const k = [0.55, 0.57, 0.62]
      for (let c = 0; c < 3; c++) {
        const lin = bgLin[c] * (1 - s * (1 - k[c]))
        const v = lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055
        bg[c] = Math.round(v * 255)
      }
    }
    const a = truth[i]
    for (let c = 0; c < 3; c++) src[i * 4 + c] = Math.round(objRGB[c] * a + bg[c] * (1 - a))
    src[i * 4 + 3] = 255
  }
  return { src, truth }
}

function evaluate(src, truth, size, level) {
  const m = estimateMatte(src, size, size, { level })
  const n = size * size
  let pred = 0
  let inter = 0
  let union = 0
  for (let i = 0; i < n; i++) {
    const a = m.alpha ? (m.alpha[i] >= 0.5 ? 1 : 0) : 1
    const t = truth[i] >= 0.5 ? 1 : 0
    if (a) pred++
    if (a || t) union++
    if (a && t) inter++
  }
  let truthCount = 0
  for (let i = 0; i < n; i++) if (truth[i] >= 0.5) truthCount++
  return {
    ok: m.ok,
    reason: m.reason,
    predShare: pred / n,
    truthShare: truthCount / n,
    iou: union ? inter / union : 0,
    conf: m.confidence,
    bgShare: m.bgShare,
    shadowShare: m.stats ? m.stats.shadowShare : 0,
    shadowRolledBack: m.stats ? m.stats.shadowRolledBack : false
  }
}

const SIZE = 384
console.log('主体颜色与背景(白)色差扫描 · size=' + SIZE)
console.log('ΔE00  有影  ok    IoU    预测占比  真值占比  主体保留  说明')
for (const withShadow of [false, true]) {
  for (let de = 8; de <= 30; de += 2) {
    const obj = creamForDe(de)
    const { src, truth } = buildImage(SIZE, obj, withShadow)
    const r = evaluate(src, truth, SIZE, 'normal')
    const keep = r.predShare / Math.max(1e-6, r.truthShare)
    console.log(
      String(de).padStart(4),
      (withShadow ? ' 有 ' : ' 无 '),
      String(r.ok).padEnd(5),
      r.iou.toFixed(3).padStart(6),
      r.predShare.toFixed(3).padStart(9),
      r.truthShare.toFixed(3).padStart(9),
      (keep * 100).toFixed(0).padStart(8) + '%',
      '  ' + (r.reason || '')
    )
  }
  console.log('')
}
