/* =========================================================================
   色彩工具：sRGB ⇄ CIELAB(D65) + CIEDE2000 色差
   拼豆色卡之间距离很近（比如「浅粉 vs 纯白」），在 RGB 空间算距离会误判，
   必须转到感知均匀的 Lab 空间再用 CIEDE2000（PRD §15.2 的 V2 方案）。
   ========================================================================= */

const SRGB_LIN = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const v = i / 255
  SRGB_LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const q = parseInt(h, 16)
  if (!Number.isFinite(q)) return [0, 0, 0]
  return [(q >> 16) & 255, (q >> 8) & 255, q & 255]
}

export function rgbToHex(r, g, b) {
  const f = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + f(r) + f(g) + f(b)
}

const D65 = [0.95047, 1, 1.08883]

export function rgbToLab(r, g, b) {
  const R = SRGB_LIN[Math.max(0, Math.min(255, r | 0))]
  const G = SRGB_LIN[Math.max(0, Math.min(255, g | 0))]
  const B = SRGB_LIN[Math.max(0, Math.min(255, b | 0))]
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / D65[0]
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / D65[2]
  const f = t => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116)
  const fx = f(X)
  const fy = f(Y)
  const fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex)
  return rgbToLab(r, g, b)
}

/** 快速欧氏距离（Lab 空间）。用于 k-means 内部迭代，够快也够准 */
export function labDist2(a, b) {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return dl * dl + da * da + db * db
}

const DEG = 180 / Math.PI
const POW25_7 = Math.pow(25, 7)

/**
 * CIEDE2000 色差的标量版（kL = kC = kH = 1）。
 *
 * 为什么单独开一个标量入口：最近色匹配要对**每个色板色号**算一次，
 * 1000×1000 画布有近 9 万个不同颜色，每次调用都解构两个数组会白白多出
 * 两次数组读取 + 一次闭包分配。公式与 `deltaE2000(lab1, lab2)` 逐项相同，
 * 只是参数摊平、`Math.pow(x, 7)` 换成乘法、`hp` 闭包换成内联。
 */
export function deltaE2000Lab(L1, a1, b1, L2, a2, b2) {
  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const Cbar = (C1 + C2) * 0.5
  const Cbar2 = Cbar * Cbar
  const Cbar7 = Cbar2 * Cbar2 * Cbar2 * Cbar
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)))

  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)

  let h1p = 0
  let h2p = 0
  if (b1 !== 0 || a1p !== 0) {
    h1p = Math.atan2(b1, a1p) * DEG
    if (h1p < 0) h1p += 360
  }
  if (b2 !== 0 || a2p !== 0) {
    h2p = Math.atan2(b2, a2p) * DEG
    if (h2p < 0) h2p += 360
  }

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360)

  const Lbarp = (L1 + L2) * 0.5
  const Cbarp = (C1p + C2p) * 0.5
  let hbarp
  if (C1p * C2p === 0) hbarp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) * 0.5
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) * 0.5
  else hbarp = (h1p + h2p - 360) * 0.5

  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.20 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180)

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2))
  const Cbarp2 = Cbarp * Cbarp
  const Cbarp7 = Cbarp2 * Cbarp2 * Cbarp2 * Cbarp
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7))
  const Lm50sq = (Lbarp - 50) * (Lbarp - 50)
  const SL = 1 + (0.015 * Lm50sq) / Math.sqrt(20 + Lm50sq)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC

  const z = dLp / SL
  const x = dCp / SC
  const y = dHp / SH
  return Math.sqrt(z * z + x * x + y * y + RT * x * y)
}

/** CIEDE2000 色差（ΔE00）。用于最终质量评估与还原度评分 */
export function deltaE2000(lab1, lab2) {
  return deltaE2000Lab(lab1[0], lab1[1], lab1[2], lab2[0], lab2[1], lab2[2])
}

/** 感知亮度（0–255），用于决定豆子上印白字还是深字 */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** 深色豆配白字、浅色豆配深字 */
export function inkOn(hex) {
  return luminance(hex) > 158 ? 'rgba(28,38,27,.78)' : 'rgba(255,255,255,.95)'
}

/** 色彩增强：以灰度为轴拉饱和度，抵消有限色板造成的发灰 */
export function enhanceColor(r, g, b, k = 1.35) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  return [
    Math.max(0, Math.min(255, gray + (r - gray) * k)),
    Math.max(0, Math.min(255, gray + (g - gray) * k)),
    Math.max(0, Math.min(255, gray + (b - gray) * k))
  ]
}

export function isLight(hex, threshold = 158) {
  return luminance(hex) > threshold
}

/**
 * 平均 CIEDE2000 → 还原度百分比。
 * ΔE00≈3 人眼几乎看不出差别，ΔE00≥28 视为完全不同。
 * 这里用分段线性映射，避免「轻微色差就大幅掉分」的不合理曲线。
 */
export function deltaEToSimilarity(dE) {
  if (!Number.isFinite(dE)) return 0
  const anchors = [
    [0, 1.0],
    [2, 0.985],
    [4, 0.96],
    [7, 0.925],
    [10, 0.885],
    [15, 0.82],
    [22, 0.72],
    [30, 0.58],
    [40, 0.4]
  ]
  if (dE <= 0) return 1
  for (let i = 1; i < anchors.length; i++) {
    const [d0, s0] = anchors[i - 1]
    const [d1, s1] = anchors[i]
    if (dE <= d1) {
      const t = (dE - d0) / (d1 - d0)
      return s0 + (s1 - s0) * t
    }
  }
  return Math.max(0, 0.4 - (dE - 40) * 0.006)
}
