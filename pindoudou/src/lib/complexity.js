/* =========================================================================
   图案复杂度 → 钉板规格推荐（2026-11-04 用户需求）

   上传图片后，按「这张图案有多复杂」推荐一块钉板：越复杂越大、越简单越小，
   钉板数量默认 1 块（52 / 78 / 104 / 120 四个规格之一）。

   为什么不看原图分辨率：旧口径「一格至少摊到 2 个源像素」只回答「源图**能**细到什么程度」，
   不回答「这张图**值得**开多大」。一张 4000 px 的纯色 Logo 按旧口径会被推到 312 档
   （9 块 104 板），但拼出来还是一大片单色 —— 复杂度才决定细节能不能填满格子。

   三个互相独立的信号（都在「缩到 80 边长的工作图」上量，缩放本身就是一次抗噪）：
     · colors 色彩丰富度：4 bit/通道量化后的色桶分布取熵，报 2^H 的等效色数。
       Logo 2~6、简单卡通 ~10、渐变插画 30~80、照片几百。
       用熵而不是「数色桶」：平涂图 + 一块投影渐变会摊出十几个小桶，
       但绝大多数像素仍集中在那几个色上，等效色数并不会高。
     · edgeMean 边缘强度：相邻格亮度差的平均（0~255 尺度）。
       大色块内部为 0，只有轮廓线贡献；照片每一格都在变。
     · textureFrac 纹理覆盖率：亮度差 ≥ 3 的相邻格对占比。
       这是「照片 vs 插画」最锋利的一条：插画大片区域是平的（≈0.1），
       照片的渐变 + 噪点让几乎所有格对都有微小起伏（≈0.9）。

   纯函数、确定性：输入 readImagePixels 的 RGBA（已与白底合成），
   可选 rect 把量测收窄到主体包围盒（贴纸不该把一圈透明底算进复杂度）。
   Node 里没有 canvas 也能跑，自检（scripts/verify/complexity.mjs）直接喂合成像素。
   ========================================================================= */

/** 工作图长边：量复杂度用的小图。再小会把轮廓抹平，再大会被噪点骗 */
const WORK_SIDE = 80
/** 纹理判定：相邻格亮度差 ≥ 这个值算「有起伏」（低于它视觉上是同一块颜色） */
const TEXTURE_D = 3

/** 三个信号的权重与归一化系数 —— 自检按这组数校准，改动要跑 verify:complexity */
export const COMPLEXITY_MODEL = {
  wColor: 0.45,
  wEdge: 0.2,
  wTexture: 0.35,
  /** edgeMean 除到 0~1 的除数（22/255 ≈ 平均亮度差 8% 就满格） */
  edgeDiv: 22,
  /** textureFrac 除到 0~1 的除数：照片实测 0.45~0.9，插画 0.1~0.25 */
  textureDiv: 0.45,
  /** colorScore = (log2(bins) − colorSub) / colorDiv，bins 2 → 0、256 → 1 */
  colorSub: 1,
  colorDiv: 7
}

/** 分数 → 档位。带 1 块板的推荐规格与给用户看的说法 */
export const COMPLEXITY_LEVELS = [
  { level: 1, max: 0.2, spec: 52, name: '简洁', desc: '大色块、轮廓少' },
  { level: 2, max: 0.42, spec: 78, name: '一般', desc: '色块适中、轮廓清晰' },
  { level: 3, max: 0.62, spec: 104, name: '较复杂', desc: '颜色多、细节开始密集' },
  { level: 4, max: 1.01, spec: 120, name: '复杂', desc: '照片级渐变与纹理' }
]

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 把 RGBA 缩成 longSide ≤ WORK_SIDE 的工作图（整数面积平均，同 resampleRGBA 的口径）。
 * 只做这一层缩小：量复杂度要的是统计量，不需要保边缘锐度。
 */
function workGrid(data, sw, sh) {
  const k = Math.max(sw, sh) / WORK_SIDE
  const w = Math.max(2, Math.round(sw / k))
  const h = Math.max(2, Math.round(sh / k))
  const lum = new Float32Array(w * h)
  const bins = new Uint32Array(4096)
  /* 每个工作格覆盖的源像素区间（与 resampleRGBA 相同的面积平均写法） */
  for (let y = 0; y < h; y++) {
    const v0 = (y * sh) / h
    const v1 = ((y + 1) * sh) / h
    for (let x = 0; x < w; x++) {
      const u0 = (x * sw) / w
      const u1 = ((x + 1) * sw) / w
      let r = 0, g = 0, b = 0, s = 0
      for (let v = Math.floor(v0); v < Math.min(sh, Math.ceil(v1)); v++) {
        const cy = Math.min(v + 1, v1) - Math.max(v, v0)
        if (cy <= 0) continue
        for (let u = Math.floor(u0); u < Math.min(sw, Math.ceil(u1)); u++) {
          const cx = Math.min(u + 1, u1) - Math.max(u, u0)
          if (cx <= 0) continue
          const a = cx * cy
          const i = (v * sw + u) * 4
          r += data[i] * a
          g += data[i + 1] * a
          b += data[i + 2] * a
          s += a
        }
      }
      if (!s) s = 1
      const R = r / s, G = g / s, B = b / s
      lum[y * w + x] = 0.299 * R + 0.587 * G + 0.114 * B
      bins[((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4)]++
    }
  }
  return { lum, w, h, bins }
}

/**
 * 估算图案复杂度并给出推荐规格。
 * @param {Uint8ClampedArray|Uint8Array} data RGBA，已与白底合成（readImagePixels 的输出）
 * @param {number} width data 的宽
 * @param {number} height data 的高
 * @param {{x:number,y:number,w:number,h:number}} [rect] 只量这个区域（主体包围盒，源图像素坐标）
 * @returns {{score:number,level:number,spec:number,name:string,desc:string,
 *            colors:number,edge:number,texture:number}} score ∈ [0,1]
 */
export function estimateComplexity(data, width, height, rect = null) {
  let sw = Math.max(1, Math.round(Number(width) || 0))
  let sh = Math.max(1, Math.round(Number(height) || 0))
  let src = data
  /* 贴纸：透明底不该算进复杂度，量测收窄到主体包围盒（一行行拷，避免大数组切片） */
  if (rect && rect.w > 1 && rect.h > 1 && (rect.w < sw - 1 || rect.h < sh - 1)) {
    const rx = Math.max(0, Math.min(sw - 2, Math.floor(rect.x)))
    const ry = Math.max(0, Math.min(sh - 2, Math.floor(rect.y)))
    const rw = Math.max(2, Math.min(sw - rx, Math.round(rect.w)))
    const rh = Math.max(2, Math.min(sh - ry, Math.round(rect.h)))
    const crop = new Uint8ClampedArray(rw * rh * 4)
    for (let y = 0; y < rh; y++) {
      const from = ((ry + y) * sw + rx) * 4
      crop.set(src.subarray(from, from + rw * 4), y * rw * 4)
    }
    src = crop
    sw = rw
    sh = rh
  }
  if (!src || src.length < sw * sh * 4) {
    return { score: 0, level: 1, spec: 52, name: COMPLEXITY_LEVELS[0].name, desc: COMPLEXITY_LEVELS[0].desc, colors: 1, edge: 0, texture: 0 }
  }

  const { lum, w, h, bins } = workGrid(src, sw, sh)

  /* 色彩丰富度：色桶分布的熵 → 等效色数（2^H）。
     用熵而不是「数够份量的桶」：平涂图 + 一块投影渐变会摊出十几个小桶，
     但绝大多数像素仍集中在那几个色上（等效色数低）；渐变人像 / 照片的分布才是真的散。 */
  const total = w * h
  let entropy = 0
  for (let i = 0; i < bins.length; i++) {
    if (!bins[i]) continue
    const p = bins[i] / total
    entropy -= p * Math.log2(p)
  }
  const colors = Math.round(Math.pow(2, entropy))

  /* 边缘强度 + 纹理覆盖率：横竖两个方向的相邻格对 */
  let dSum = 0
  let dCount = 0
  let tex = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = lum[y * w + x]
      if (x + 1 < w) {
        const d = Math.abs(a - lum[y * w + x + 1])
        dSum += d
        dCount++
        if (d >= TEXTURE_D) tex++
      }
      if (y + 1 < h) {
        const d = Math.abs(a - lum[(y + 1) * w + x])
        dSum += d
        dCount++
        if (d >= TEXTURE_D) tex++
      }
    }
  }
  const edge = dCount ? dSum / dCount : 0
  const texture = dCount ? tex / dCount : 0

  const M = COMPLEXITY_MODEL
  const colorScore = clamp01((Math.log2(Math.max(1, colors)) - M.colorSub) / M.colorDiv)
  const edgeScore = clamp01(edge / M.edgeDiv)
  const textureScore = clamp01(texture / M.textureDiv)
  const score = clamp01(M.wColor * colorScore + M.wEdge * edgeScore + M.wTexture * textureScore)

  const lv = COMPLEXITY_LEVELS.find(l => score < l.max) || COMPLEXITY_LEVELS[COMPLEXITY_LEVELS.length - 1]
  return {
    score: Math.round(score * 1000) / 1000,
    level: lv.level,
    spec: lv.spec,
    name: lv.name,
    desc: lv.desc,
    colors,
    edge: Math.round(edge * 100) / 100,
    texture: Math.round(texture * 1000) / 1000
  }
}
