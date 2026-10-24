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

/** CIEDE2000 色差（ΔE00）。用于最终质量评估与还原度评分 */
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2
  const kL = 1, kC = 1, kH = 1

  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const Cbar = (C1 + C2) / 2
  const Cbar7 = Math.pow(Cbar, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))))

  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)

  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0
    const h = (Math.atan2(b, ap) * 180) / Math.PI
    return h >= 0 ? h : h + 360
  }
  const h1p = hp(b1, a1p)
  const h2p = hp(b2, a2p)

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360)

  const Lbarp = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbarp
  if (C1p * C2p === 0) hbarp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2
  else hbarp = (h1p + h2p - 360) / 2

  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.20 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180)

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2))
  const Cbarp7 = Math.pow(Cbarp, 7)
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)))
  const Lm50sq = Math.pow(Lbarp - 50, 2)
  const SL = 1 + (0.015 * Lm50sq) / Math.sqrt(20 + Lm50sq)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC

  return Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
      Math.pow(dCp / (kC * SC), 2) +
      Math.pow(dHp / (kH * SH), 2) +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH))
  )
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
