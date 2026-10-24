/* =========================================================================
   自动抠背景（主体 / 背景分离）
   -------------------------------------------------------------------------
   目标：上传一张图，勾上「自动抠背景」后，背景位置不放豆，只留主体。
   拼豆是实体颗粒，没有"半透明"这回事，所以最终一定要落到「这一格放不放豆」；
   但**判定必须在源图像素级别做**，否则边缘会出现一圈原图没有的浅色豆（白边）。

   算法（纯函数、无 DOM、无随机，可在 Node 里回归评测）：
     1. 先把图降到 ≤1024 边长做分析（面积平均）——抠图只需要知道"哪里是背景"。
        分辨率**跟着源图走**（matteMaxSide：一格至少摊到一个掩膜像素，夹在 384~1024）：
        旧的固定 384 是按 116 格画布留的余量，精细档下掩膜比画布还粗（1000 格时
        一个掩膜像素横跨 2.6 格），主体边缘被量化成 2~3 颗豆的阶梯 ——
        用户看到的就是"抠图有点毛躁"；
     2. 只取图像外圈像素做**背景色模型**（Lab + CIEDE2000 的 k-means，最多 3 个簇）：
        外圈天然几乎全是背景，且能同时容纳"白底 + 卡片底色"这种双色背景；
        噪声背景（草地 / 墙面）的簇内离散度会进入容差，容差自适应；
     3. **从四边向内做洪水填充**，只走"像背景"的像素，并且不允许跨过强边缘
        （ΔE00 > edgeLimit）：这样白衬衫上的白色、雪人身上的白色不会被一起吃掉
        ——它们与背景只是颜色像，并不连通；
     3.5 **阴影清除**（见文件末尾单独一段说明）。投影既不是主体、也不是背景色，
        只靠第 3 步的容差往往会在物体周围留下一圈灰豆，所以必须单独建模；
     4. **三区软抠图**：确定背景 / 未知带 / 确定前景。
        未知带（背景边界 ± r 像素）内用「颜色线」投影估 α：
        α = clamp(dot(I-B, F-B)/|F-B|²)，F、B 取最近的确切前景/背景像素颜色。
        这一步是精度的关键：发丝、绒毛、抗锯齿边缘会得到真实的 0~1 覆盖率，
        而不是硬邦邦的阶梯，映射到格子上就是"这格留几成"；
     5. **连通域清洁**：去掉主体上的小碎点，补掉主体内部的小孔（高光点），
        不做整体模糊（那会磨掉尖角）；
     6. 输出 0~1 的 α 图（源图分辨率）+ 主体紧包围盒 + 置信度与原因。

   置信度低时**不硬抠**：返回 ok:false，由上层保留整图并给出提示，
   避免"把主体整个吃掉"这种比不抠更糟的结果。

   ---- 关于阴影（目标：只剩主体，没有背景也没有阴影） ----
   投影的物理成因是"直射光被挡住，只剩环境光"，在**线性光空间里就是逐通道乘法**：
       p_lin ≈ k · bg_lin      （k 是光照保留比例；环境光偏冷，所以 k_B 通常略大）
   由此得到两个可判定的性质，缺一不可：
     · **颜色**：k 的三个分量彼此接近 —— 同一种材质、只是被压暗。
       彩色主体压在浅底上的抗锯齿像素是"两个颜色的混合"，k 三分量会散得很开，被排除；
     · **边缘**：阴影的 k 是**渐变**的，而物体的轮廓是**硬边**。
       这条是分辨「浅灰物体」与「灰阴影」的唯一可靠信号 ——
       一块中灰物体放在白底上，颜色上与阴影毫无区别（都只是"白乘一个系数"），
       只有"轮廓一步跨过去 vs 阴影连续衰减"能把两者分开。
   所以洪水填充要求相邻像素的 k 变化不超过 shadowStep，硬边一律不许跨；
   生长方向只能是"从已确认的背景 / 阴影往外扩"，主体轮廓内部不会被从外面吃进来。
   ========================================================================= */

import { rgbToLab, rgbToHex, deltaE2000, labDist2 } from './color.js'

/**
 * 分析用的**最小**边长（兼容旧默认：小图仍然按这个跑）。
 *
 * 为什么不再是固定值：384 是照着旧画布上限（116 格）留的 3 倍余量，而画布上限
 * 早就是 1000 格了 —— 1000 格配 384 的掩膜，一个掩膜像素横跨 2.6 格，
 * 主体边缘被量化成一格 2~3 颗豆的**阶梯**（用户的原话是"抠图有点毛躁"），
 * 而且每格覆盖率是从这个粗掩膜插值出来的，判定「这一格放不放豆」时会整段整段地偏。
 * 现在的口径：**掩膜分辨率 = 源图分辨率**（源图已经被 readImagePixels 夹到 2048 以内），
 * 只受下面这条内存上限约束 —— 一格至少摊到一个掩膜像素，边缘才落在格子上。
 */
export const MATTE_MAX_SIDE = 384

/**
 * 掩膜边长上限（内存口径）。
 *
 * estimateMatte 会给每个掩膜像素分配 Lab(3×Float32) + 覆盖率 + 阴影 + 簇号
 * ≈ 27 字节/像素，1024² 就是约 28 MB（外加源图自己的 16 MB RGBA）——
 * 这是移动端还扛得住的量级；2048² 会到 110 MB 以上，标签页会被系统杀掉。
 * 1024 也正好覆盖「1000 格画布 × 1 个掩膜像素/格」这个下限。
 */
export const MATTE_MAX_SIDE_LIMIT = 1024

/**
 * 这张源图该按多大边长估掩膜：**源图本身小于上限时照原样跑**（downscale 只缩不放），
 * 所以返回值只表达"别超过多少"。夹在 [MATTE_MAX_SIDE, MATTE_MAX_SIDE_LIMIT] 之间。
 */
export function matteMaxSide(sw, sh) {
  const long = Math.max(Number(sw) || 0, Number(sh) || 0)
  if (!(long > 0)) return MATTE_MAX_SIDE
  return Math.max(MATTE_MAX_SIDE, Math.min(MATTE_MAX_SIDE_LIMIT, Math.round(long)))
}

/**
 * sRGB(0~255) → 线性光的查找表。
 * 阴影的乘法模型只在线性光空间成立（sRGB 是感知编码，直接相乘没有物理意义），
 * 而这是逐像素都要做的换算，所以做成表：比每像素 pow 快一个量级，且完全精确。
 */
const SRGB_TO_LIN = (() => {
  const t = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return t
})()

/**
 * 三档力度。tolerance 是「像素与背景色模型的 ΔE00 容差」，
 * emptyShare 是「一格的主体覆盖率低于多少就判为空格」。
 * 保守档只敢去白底，激进档敢去杂乱背景（也更容易误伤，所以给了手动橡皮擦兜底）。
 *
 * shadow* 是阴影清除的力度（详见文件头「关于阴影」）：
 *   shadowFloor  允许的最暗光照保留比例。越小 = 敢去越深的阴影，
 *                也越可能把深色物体误当阴影（0.30 = "暗到只剩三成光"仍算阴影）；
 *   shadowStep   相邻像素允许的**光照保留比例**变化量。
 *                越小越不敢跨硬边（越保守）。这个值要卡在
 *                「阴影的半影梯度」与「物体轮廓的台阶」之间：
 *                取大了会把浅色物体当阴影整个吃掉，取小了深色阴影去不掉。
 *                实测（scripts/fidelity/matte-bench.mjs）：0.10 能挡住
 *                「白底上 196 灰物体」的轮廓（台阶 0.13），
 *                同时够穿过柔和投影（梯度约 0.04/像素）；
 *   shadowSpread 三个通道 k 值的最大/最小比。越大越能容忍偏色环境光，
 *                也越容易把"彩色主体被压暗后的边缘"算进来。
 */
export const MATTE_LEVELS = [
  {
    key: 'soft', label: '保守', hint: '白底 / 纯色底最稳',
    tolerance: 7, unknownRadius: 1, edgeScale: 2.2, minBlobRatio: 0.0016, emptyShare: 0.40, margin: 0.02,
    shadowFloor: 0.45, shadowStep: 0.06, shadowSpread: 1.35
  },
  {
    key: 'normal', label: '标准', hint: '通用',
    tolerance: 10, unknownRadius: 2, edgeScale: 2.6, minBlobRatio: 0.0009, emptyShare: 0.52, margin: 0.02,
    shadowFloor: 0.30, shadowStep: 0.10, shadowSpread: 1.60
  },
  {
    key: 'strong', label: '激进', hint: '杂乱背景（可能误伤）',
    tolerance: 14, unknownRadius: 3, edgeScale: 3.0, minBlobRatio: 0.0005, emptyShare: 0.62, margin: 0.02,
    shadowFloor: 0.18, shadowStep: 0.22, shadowSpread: 1.85
  }
]

export function matteLevel(key) {
  return MATTE_LEVELS.find(l => l.key === key) || MATTE_LEVELS[1]
}

/* ---------------------------------------------------------------- 工具 */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** labDist2 的标量版：阴影填充里逐邻居要算一次，避免每像素都建数组 */
function labDist2At(labs, i, j) {
  const dl = labs[i * 3] - labs[j * 3]
  const da = labs[i * 3 + 1] - labs[j * 3 + 1]
  const db = labs[i * 3 + 2] - labs[j * 3 + 2]
  return dl * dl + da * da + db * db
}

/**
 * 面积平均降采样：每个源像素按中心落进目标像素累加。
 * 与 pattern.js 的 resampleRGBA 同口径（sRGB 平均、透明按白底压平），
 * 单独实现一份是为了让 matte.js 不依赖 pattern.js（避免循环依赖）。
 */
function downscale(src, sw, sh, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const out = new Uint8ClampedArray(w * h * 4)
  const alpha = new Uint8ClampedArray(w * h)
  const cnt = new Uint32Array(w * h)
  const accR = new Float64Array(w * h)
  const accG = new Float64Array(w * h)
  const accB = new Float64Array(w * h)
  const accA = new Float64Array(w * h)

  for (let y = 0; y < sh; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / sh))
    for (let x = 0; x < sw; x++) {
      const tx = Math.min(w - 1, Math.floor((x * w) / sw))
      const t = ty * w + tx
      const i = (y * sw + x) * 4
      const a = src[i + 3] / 255
      accR[t] += src[i] * a + 255 * (1 - a)
      accG[t] += src[i + 1] * a + 255 * (1 - a)
      accB[t] += src[i + 2] * a + 255 * (1 - a)
      accA[t] += src[i + 3]
      cnt[t]++
    }
  }
  for (let t = 0; t < w * h; t++) {
    const c = cnt[t] || 1
    out[t * 4] = Math.round(accR[t] / c)
    out[t * 4 + 1] = Math.round(accG[t] / c)
    out[t * 4 + 2] = Math.round(accB[t] / c)
    out[t * 4 + 3] = Math.round(accA[t] / c)
    alpha[t] = Math.round(accA[t] / c)
  }
  return { data: out, alpha, w, h }
}

/** 双线性放大 α（低分辨率掩膜 → 源图分辨率），顺带避免硬阶梯 */
function upsampleAlpha(mask, w, h, tw, th) {
  const out = new Float32Array(tw * th)
  const sx = w / tw
  const sy = h / th
  for (let y = 0; y < th; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(h - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(w - 1, x0 + 1)
      const wx = fx - x0
      const a = mask[y0 * w + x0] * (1 - wx) + mask[y0 * w + x1] * wx
      const b = mask[y1 * w + x0] * (1 - wx) + mask[y1 * w + x1] * wx
      out[y * tw + x] = a * (1 - wy) + b * wy
    }
  }
  return out
}

/* ---------------------------------------------------------------- 背景色模型 */

/**
 * 外圈像素的 k-means（Lab 空间，ΔE00 分配）。
 * 用 ΔE00 而不是欧氏距离分配：亮饱和色（橙、青）在 Lab 欧氏距离下会被高估，
 * 背景里的"浅米 vs 白"这种差别必须按人眼判。
 */
function clusterBorderColors(labs, ring, k, data, iterations = 6) {
  const n = ring.length
  if (!n) return []
  if (n < k) k = 1

  // 初始化：第一个中心取"最靠近外圈平均色"的真实像素，其余按最远点采样
  let mL = 0, mA = 0, mB = 0
  for (const i of ring) {
    mL += labs[i * 3]; mA += labs[i * 3 + 1]; mB += labs[i * 3 + 2]
  }
  const mean = [mL / n, mA / n, mB / n]
  const centers = []
  let bestI = ring[0]
  let bestD = Infinity
  for (const i of ring) {
    const d = labDist2([labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]], mean)
    if (d < bestD) { bestD = d; bestI = i }
  }
  centers.push([labs[bestI * 3], labs[bestI * 3 + 1], labs[bestI * 3 + 2]])

  while (centers.length < k) {
    let far = null
    let farD = -1
    for (const i of ring) {
      const lab = [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]]
      let d = Infinity
      for (const c of centers) {
        const e = deltaE2000(lab, c)
        if (e < d) d = e
      }
      if (d > farD) { farD = d; far = lab }
    }
    if (!far || farD <= 0) break
    centers.push(far)
  }

  let assign = new Int32Array(n)
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < n; j++) {
      const i = ring[j]
      const lab = [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]]
      let bi = 0
      let bd = Infinity
      for (let c = 0; c < centers.length; c++) {
        const e = deltaE2000(lab, centers[c])
        if (e < bd) { bd = e; bi = c }
      }
      assign[j] = bi
    }
    const sumL = new Float64Array(centers.length)
    const sumA = new Float64Array(centers.length)
    const sumB = new Float64Array(centers.length)
    const cnt = new Uint32Array(centers.length)
    for (let j = 0; j < n; j++) {
      const i = ring[j]
      const c = assign[j]
      sumL[c] += labs[i * 3]; sumA[c] += labs[i * 3 + 1]; sumB[c] += labs[i * 3 + 2]
      cnt[c]++
    }
    for (let c = 0; c < centers.length; c++) {
      if (!cnt[c]) continue
      centers[c] = [sumL[c] / cnt[c], sumA[c] / cnt[c], sumB[c] / cnt[c]]
    }
  }

  // 统计每个簇的规模、离散度与平均 RGB（平均 RGB 只是为了给界面显示"识别到的背景色"）
  const stat = centers.map((center, c) => {
    let cnt = 0
    let sq = 0
    let sr = 0
    let sg = 0
    let sb = 0
    for (let j = 0; j < n; j++) {
      if (assign[j] !== c) continue
      const i = ring[j]
      const e = deltaE2000([labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]], center)
      cnt++
      sq += e * e
      if (data) { sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2] }
    }
    return {
      center,
      count: cnt,
      share: cnt / n,
      spread: cnt ? Math.sqrt(sq / cnt) : 0,
      rgb: cnt && data ? [sr / cnt, sg / cnt, sb / cnt] : null
    }
  })
  const kept = stat.filter(s => s.share >= 0.06 && s.count >= 8)
  if (!kept.length) {
    // 全被丢掉说明外圈颜色极散（例如满屏纹理）：保留最大的那个，交给置信度去降级
    stat.sort((a, b) => b.count - a.count)
    return stat.slice(0, 1)
  }
  kept.sort((a, b) => b.count - a.count)
  return kept.slice(0, 3)
}

/* ---------------------------------------------------------------- 主流程 */

/**
 * 估算主体 α 图。
 * @param {Uint8ClampedArray} src RGBA 源图（源图分辨率的像素）
 * @param {number} sw
 * @param {number} sh
 * @param {object} opts { level, maxSide }
 * @returns {{
 *   alpha: Float32Array, width: number, height: number,
 *   bbox: {x,y,w,h}|null, coverage: number, confidence: number,
 *   ok: boolean, reason: string, stats: object
 * }}
 */
export function estimateMatte(src, sw, sh, opts = {}) {
  const level = matteLevel(opts.level)
  const fail = (reason, extra = {}) => ({
    alpha: null,
    width: sw,
    height: sh,
    bbox: null,
    bgShare: 0,
    confidence: 0,
    ok: false,
    reason,
    stats: { level: level.key, ...extra }
  })
  if (!(sw > 0 && sh > 0) || !src || src.length < sw * sh * 4) return fail('图片像素不可用')

  /* 不传 maxSide 就按源图分辨率走（见 matteMaxSide 的说明）：抠图边缘的精度
     必须至少是「一格一个掩膜像素」，否则精细档下边缘会整体变成阶梯。 */
  const { data, alpha: srcAlpha, w, h } = downscale(src, sw, sh, opts.maxSide || matteMaxSide(sw, sh))
  const n = w * h

  /* ---- 0) 原图自带透明背景：直接沿用，最精确也最省事 ---- */
  let transparent = 0
  for (let i = 0; i < n; i++) if (srcAlpha[i] < 8) transparent++
  if (transparent > n * 0.015) {
    const mask = new Float32Array(n)
    let subject = 0
    for (let i = 0; i < n; i++) {
      const a = srcAlpha[i] / 255
      mask[i] = a
      if (a >= 0.5) subject++
    }
    const out = finishMask(mask, w, h, sw, sh, level, {
      confidence: 1,
      clusters: 0,
      transparent: true,
      bgColors: [],
      reason: '原图已带透明背景，直接沿用'
    }, null)
    return out
  }

  /* ---- 1) Lab 缓存 ---- */
  const labs = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const lab = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    labs[i * 3] = lab[0]; labs[i * 3 + 1] = lab[1]; labs[i * 3 + 2] = lab[2]
  }

  /* ---- 2) 外圈背景色模型 ---- */
  const ringW = Math.max(2, Math.min(8, Math.round(Math.min(w, h) * 0.025)))
  const ringAll = []
  for (let y = 0; y < h; y++) {
    const edgeRow = y < ringW || y >= h - ringW
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < ringW || x >= w - ringW) ringAll.push(y * w + x)
    }
  }
  // 聚类只需要外圈的颜色分布，等距抽样到 ~1500 个样本即可（ΔE00 不便宜）
  const stride = Math.max(1, Math.ceil(ringAll.length / 1500))
  const ring = stride > 1 ? ringAll.filter((_, i) => i % stride === 0) : ringAll
  const clusters = clusterBorderColors(labs, ring, 3, data)
  if (!clusters.length) return fail('无法估计背景颜色')

  const tol = clusters.map(c => level.tolerance + Math.min(6, c.spread * 0.6))
  const maxSpread = clusters.reduce((m, c) => Math.max(m, c.spread), 0)
  /* ---- 分辨率归一化（只作用于「相邻像素」的判据）----
     edgeLimit / shadowStep 衡量的都是**一步能跨多大**，而"一步"的物理距离随掩膜分辨率变：
     掩膜越细，相邻两像素的差异越小，同一个阈值就等于被放开了 —— 背景洪水填充会沿着
     一条原来跨不过去的轮廓渗进主体（实测 fixtures/synth_sky 512²：384 掩膜下背景占比
     0.907、抠图正常；512 掩膜下渗过地平线一路吃到 99.99%+，触发"纯色图"安全网）。
     所以这两个阈值按掩膜边长相对标定分辨率（384）等比缩放；而 tol（像素 vs 背景色模型）
     是**颜色距离**，与分辨率无关，不缩放。掩膜 ≤ 384 时归一化系数为 1，行为不变。 */
  const resScale = Math.min(1, MATTE_MAX_SIDE / Math.max(w, h))
  const edgeLimit = Math.max(28, level.tolerance * level.edgeScale + maxSpread * 1.5) * resScale
  /* 「像背景」的放宽线：外圈色模型只见过背景的一部分，图内背景色稍微偏一点
     就会超出容差，所以做连通域判定时给 1.5 倍 + 3 的余量。 */
  const limits = tol.map(t => t * 1.5 + 3)

  /* 背景簇的**线性光**表示：阴影的乘法模型必须与背景在同一个空间里比。
     聚类本身仍然在 Lab 里做（那里才符合人眼），这里只是换算一份给阴影用。 */
  let shadowReady = true
  for (const c of clusters) {
    if (!c.rgb) { shadowReady = false; break }
    c.lin = [0, 1, 2].map(k => {
      const v = Math.min(255, Math.max(0, Math.round(c.rgb[k])))
      return Math.max(1e-4, SRGB_TO_LIN[v])
    })
  }

  /* ---- 3) 背景相似度 + 从四边洪水填充（不跨强边缘） ---- */
  const bgLike = new Uint8Array(n)
  const deToCluster = new Float32Array(n).fill(Infinity)
  const clusterOf = new Int8Array(n).fill(-1)
  /* 每个像素相对所属背景簇的「光照保留比例」k（逐通道平均，1 = 全亮）。
     必须对**所有**像素都算，不能只给阴影候选算：
     渐变判定比的是相邻两像素真实明暗之差，而背景那一侧的标称值是 1，
     实际上它可能早就被压到 0.7 了 —— 拿 1 去比，第一步就会被判成"硬边"而卡死
     （实测就是这个 bug：阴影一个像素都长不出来）。 */
  const shade = new Float32Array(n).fill(1)
  const shadowLike = new Uint8Array(n)
  const shadeOf = i => {
    const lin = clusters[clusterOf[i]].lin
    const o = i * 4
    return (SRGB_TO_LIN[data[o]] / lin[0] + SRGB_TO_LIN[data[o + 1]] / lin[1] + SRGB_TO_LIN[data[o + 2]] / lin[2]) / 3
  }
  for (let i = 0; i < n; i++) {
    const lab = [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]]
    let bestC = -1
    let bestD2 = Infinity
    for (let c = 0; c < clusters.length; c++) {
      const d2 = labDist2(lab, clusters[c].center)
      if (d2 < bestD2) { bestD2 = d2; bestC = c }
    }
    /* 两级判定，目的只有一个：别把 ΔE00 花在没争议的像素上。
       ΔE00 的分量都除以 ≥1 的 SL/SC/SH，还带一个非正的交叉项，
       所以 ΔE00 ≲ 欧氏距离（CIE76）。于是：
         · 欧氏距离 ≤ 0.85 倍容差  → 不必算也一定算作背景（背景像素走这条快路）；
         · 欧氏距离 > 6 倍容差     → 一定不是背景；
         · 中间地带            → 老老实实算 ΔE00。
       合成图（白底 + 主体）里绝大多数像素落在前两种情况，
       实测这一改能把抠图耗时砍掉一半左右，且判定结果逐像素一致。 */
    const rough = Math.sqrt(bestD2)
    clusterOf[i] = bestC
    if (shadowReady && bestC >= 0) shade[i] = shadeOf(i)
    if (rough <= tol[bestC] * 0.85) {
      deToCluster[i] = 0
      bgLike[i] = 1
      continue
    }
    if (rough > tol[bestC] * 6 + 12) continue
    const de = deltaE2000(lab, clusters[bestC].center)
    deToCluster[i] = de
    if (de <= tol[bestC]) bgLike[i] = 1
  }

  /* 逐像素的「离背景色模型够近」标记（用放宽线）。
     连通域判定要靠它，而不是靠整块的平均色 ——
     一块被强边缘挡住的背景碎片往往和主体边缘混在一起，平均色会被主体那一侧带跑。 */
  const nearBgColor = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const c = clusterOf[i]
    if (c >= 0 && deToCluster[i] <= limits[c]) nearBgColor[i] = 1
  }

  /* ---- 3.4) 阴影候选：与背景「同一种材质、只是被压暗」 ----
     物理模型见文件头：p_lin ≈ k · bg_lin。这里只做逐像素的颜色判定，
     能不能真的算阴影还要看下面的连通性与渐变约束 ——
     因为「中灰物体」在颜色上与「灰阴影」完全一致，颜色本身不足以定性。 */
  if (shadowReady) {
    for (let i = 0; i < n; i++) {
      if (bgLike[i]) continue
      const c = clusterOf[i]
      if (c < 0) continue
      const lin = clusters[c].lin
      const o = i * 4
      const kr = SRGB_TO_LIN[data[o]] / lin[0]
      const kg = SRGB_TO_LIN[data[o + 1]] / lin[1]
      const kb = SRGB_TO_LIN[data[o + 2]] / lin[2]
      const kMin = Math.min(kr, kg, kb)
      const kMax = Math.max(kr, kg, kb)
      // 任何通道都不该比背景更亮（偏色环境光允许一点点）
      if (kMax > 1.2) continue
      // 三个通道的保留比例必须接近：差太远说明是「两个颜色混在一起」（主体边缘）
      if (kMax > kMin * level.shadowSpread) continue
      const kMean = (kr + kg + kb) / 3
      if (kMean < level.shadowFloor || kMean > 0.97) continue
      shadowLike[i] = 1
    }
  }

  const bg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const seed = i => {
    if (!bg[i] && bgLike[i]) { bg[i] = 1; stack[sp++] = i }
  }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }

  // 「核心背景」= 与所属簇的色差在容差内。两个核心像素之间最大也就 2*容差 ≈ edgeLimit，
  // 所以这一对不必再算 ΔE00 —— 洪水填充里绝大多数是这种情况，省下大量计算。
  const isCore = i => bgLike[i] === 1 && deToCluster[i] <= tol[clusterOf[i]]

  while (sp > 0) {
    const cur = stack[--sp]
    const cx = cur % w
    const cy = (cur - cx) / w
    const curCore = isCore(cur)
    for (let dy = -1; dy <= 1; dy++) {
      const yy = cy + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const xx = cx + dx
        if (xx < 0 || xx >= w) continue
        const q = yy * w + xx
        if (bg[q] || !bgLike[q]) continue
        // 不跨强边缘：背景被主体轮廓"隔开"的另一侧不应被吃进来
        if (!(curCore && isCore(q))) {
          const cl = [labs[cur * 3], labs[cur * 3 + 1], labs[cur * 3 + 2]]
          const ql = [labs[q * 3], labs[q * 3 + 1], labs[q * 3 + 2]]
          if (deltaE2000(cl, ql) > edgeLimit) continue
        }
        bg[q] = 1
        stack[sp++] = q
      }
    }
  }

  let bgCount = 0
  for (let i = 0; i < n; i++) bgCount += bg[i] ? 1 : 0
  const baseBgCount = bgCount

  /* ---- 3.5) 阴影洪水填充：从已确认的背景往外长 ----
     两道闸门，缺一不可：
       · **光照保留比例必须渐变**（|Δk| ≤ shadowStep）—— 硬边一律不许跨。
         这是「浅灰物体」与「灰阴影」的唯一分界线：一块中灰物体放在白底上，
         颜色上与阴影毫无区别（都只是"白乘一个系数"），
         只有"轮廓一步跨过去 vs 阴影连续衰减"能把两者分开；
       · 依旧不许跨强边缘，避免沿着一条低对比的轮廓渗进主体内部。
     用 BFS（队列）而不是 DFS（栈）：从整片背景同时向外一圈圈扩散，
     到达每个像素的路径一定是最靠近背景的那条，渐变判定的口径才稳定。 */
  const shadow = new Uint8Array(n)
  if (shadowReady && level.shadowFloor < 1) {
    /* ⚠️ shadowStep 是**逐像素**的光照变化容差，而它是在 384 边长的掩膜上标定的。
       掩膜变细之后，同一条渐变在相邻两像素上的落差会等比变小（512 下约为 384 的 0.75 倍），
       阈值不跟着缩，精细档下这道闸门就等于被放开了 —— 实测 fixtures/synth_sky（512²）：
       384 掩膜时背景占比 0.907、抠图正常；掩膜跟源图走之后（512+）一路吃到 0.9999+，
       连"背景占比过高（可能是一张纯色图）"的安全网都被触发，主体整个消失。
       所以掩膜比 384 细时把容差等比缩回 384 的口径：step_eff = shadowStep × 384 / max(w,h)。
       （掩膜 ≤ 384 时保持原值：那是标定时的口径，不动它。） */
    const shadowStep = level.shadowStep * resScale
    const seen = new Uint8Array(n)
    const queue = new Int32Array(n)
    let qh = 0
    let qt = 0
    for (let i = 0; i < n; i++) if (bg[i]) { seen[i] = 1; queue[qt++] = i }
    const roughLimit2 = (edgeLimit * 0.85) ** 2
    while (qh < qt) {
      const cur = queue[qh++]
      const cx = cur % w
      const cy = (cur - cx) / w
      const curShade = shade[cur]
      for (let dy = -1; dy <= 1; dy++) {
        const yy = cy + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const xx = cx + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (seen[q]) continue
          if (bg[q]) { seen[q] = 1; queue[qt++] = q; continue }
          if (!shadowLike[q]) continue
          if (Math.abs(curShade - shade[q]) > shadowStep) continue
          if (labDist2At(labs, cur, q) > roughLimit2) {
            const cl = [labs[cur * 3], labs[cur * 3 + 1], labs[cur * 3 + 2]]
            const ql = [labs[q * 3], labs[q * 3 + 1], labs[q * 3 + 2]]
            if (deltaE2000(cl, ql) > edgeLimit) continue
          }
          shadow[q] = 1
          seen[q] = 1
          queue[qt++] = q
        }
      }
    }
  }

  /* 阴影并入背景：阴影就是"该放背景豆的位置"，必须按确定背景处理，
     不能落进未知带被颜色线分到半个 α —— 那样边缘还是会留一圈灰豆。
     同时把它标进 nearBgColor：万一有没连通上的阴影碎片，
     连通域清洁那一步会按「离背景色模型近」把它回收掉。

     ⚠️ 安全网：浅色物体与阴影在颜色上无法区分（见文件头），
     万一阴影那一步吃掉了原本前景的绝大部分，那基本就是吃到了主体。
     这种时候宁可**放弃阴影清除、保留阴影**，也不能交出一张空图 ——
     去掉阴影是体验优化，把主体删了是事故，两者不能等价权衡。
     判据：剩余前景不得低于「原前景的 5%」与「整图 1.2%」中的较大者。 */
  let shadowCount = 0
  for (let i = 0; i < n; i++) if (shadow[i]) shadowCount++
  const fgBefore = n - baseBgCount
  const fgAfter = fgBefore - shadowCount
  const shadowSafe = fgAfter >= Math.max(n * 0.012, fgBefore * 0.05)
  if (shadowSafe) {
    for (let i = 0; i < n; i++) {
      if (!shadow[i]) continue
      bg[i] = 1
      nearBgColor[i] = 1
    }
  } else {
    shadowCount = 0
  }
  bgCount = baseBgCount + shadowCount
  const bgShare = bgCount / n
  if (bgShare < 0.012) return fail('几乎没有检测到背景，已保留整图')
  if (bgShare > 0.94) return fail('背景占比过高（可能是一张纯色图），已保留整图')

  /* ---- 4) 三区软抠图 ---- */
  /**
   * 两个「区域内部深度」场：背景区里离边界多远、前景区里离边界多远（只在自身区域内传播）。
   *
   * ⚠️ 这里**不能**用「到背景区的距离」来做三区划分。背景像素自己到背景区的距离恒为 0，
   * 于是「确定背景 = 背景像素里距离 > r 的那些」会恒为空集 —— 未知带与整个颜色线软抠图
   * 都被跳过，边缘退化成硬边（实测：6px 羽化的软边被整体外扩 2.6px，
   * 预测 α 只剩 {0,1}）。深度场才是正确口径。
   */
  const fgFlag = new Uint8Array(n)
  for (let i = 0; i < n; i++) fgFlag[i] = bg[i] ? 0 : 1

  const depthIn = inside => {
    const depth = new Int32Array(n).fill(-1)
    const q = new Int32Array(n)
    let hh = 0
    let tt = 0
    for (let i = 0; i < n; i++) {
      if (inside[i] !== 1) continue
      const x = i % w
      const y = (i - x) / w
      let edge = false
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (inside[yy * w + xx] !== 1) { edge = true; break }
        }
      }
      if (edge) { depth[i] = 0; q[tt++] = i }
    }
    while (hh < tt) {
      const cur = q[hh++]
      const x = cur % w
      const y = (cur - x) / w
      const nd = depth[cur] + 1
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const p = yy * w + xx
          if (depth[p] >= 0 || inside[p] !== 1) continue
          depth[p] = nd
          q[tt++] = p
        }
      }
    }
    return depth
  }
  const depthBg = depthIn(bg)
  const depthFg = depthIn(fgFlag)

  /**
   * 未知带半径要同时满足两件事：
   *   1) 不超过档位设定（带宽越大，边缘越柔，但也越容易糊）；
   *   2) 「确定前景」和「确定背景」都必须剩下足够的像素，否则颜色线没有 F/B 可用。
   * 主体很细（比如一根杆子）时，按档位取 2~3 会让整根都落进未知带，必须收窄。
   * 收到 -1 就意味着退化成硬边掩膜 —— 这比"没有 F/B 可用导致主体被整体吃掉"安全得多。
   */
  const minPx = Math.max(8, Math.round(n * 0.002))
  const maxD = Math.max(w, h)
  const bgByDepth = new Int32Array(maxD + 2)
  const fgByDepth = new Int32Array(maxD + 2)
  for (let i = 0; i < n; i++) {
    if (bg[i]) bgByDepth[Math.min(maxD, Math.max(0, depthBg[i]))]++
    else fgByDepth[Math.min(maxD, Math.max(0, depthFg[i]))]++
  }
  const above = (hist, rr) => {
    let c = 0
    for (let d = rr + 1; d <= maxD; d++) c += hist[d]
    return c
  }
  let r = level.unknownRadius
  // 背景占九成以上时主体本来就小，带宽收一档，避免边界糊成一团
  if (bgShare > 0.85) r = Math.max(0, r - 1)
  while (r >= 0 && (above(bgByDepth, r) < minPx || above(fgByDepth, r) < minPx)) r--

  const mask = new Float32Array(n)
  const unknown = new Uint8Array(n)
  if (r < 0) {
    for (let i = 0; i < n; i++) mask[i] = bg[i] ? 0 : 1
  } else {
    for (let i = 0; i < n; i++) {
      if (bg[i] ? depthBg[i] > r : depthFg[i] > r) mask[i] = bg[i] ? 0 : 1
      else unknown[i] = 1
    }
  }

  // 未知带内：最近的确切前景 / 确切背景（两次多源 BFS）
  const nearFg = new Int32Array(n).fill(-1)
  const nearBg = new Int32Array(n).fill(-1)
  const dFg = new Int32Array(n).fill(-1)
  const dBg = new Int32Array(n).fill(-1)
  const spreadFrom = (seedPred, distArr, srcArr) => {
    let h2 = 0
    let t2 = 0
    const q2 = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      if (seedPred(i)) { distArr[i] = 0; srcArr[i] = i; q2[t2++] = i }
    }
    while (h2 < t2) {
      const cur = q2[h2++]
      const cx = cur % w
      const cy = (cur - cx) / w
      const nd = distArr[cur] + 1
      for (let dy = -1; dy <= 1; dy++) {
        const yy = cy + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const xx = cx + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (distArr[q] >= 0) continue
          // 只允许在未知带里传播，保证 F/B 取的是"确定"的像素
          if (!unknown[q]) continue
          distArr[q] = nd
          srcArr[q] = srcArr[cur]
          q2[t2++] = q
        }
      }
    }
  }
  if (r >= 0) {
    spreadFrom(i => !unknown[i] && mask[i] === 1, dFg, nearFg)
    spreadFrom(i => !unknown[i] && mask[i] === 0, dBg, nearBg)
  }

  for (let i = 0; i < n; i++) {
    if (!unknown[i]) continue
    const fi = nearFg[i]
    const bi = nearBg[i]
    if (fi < 0) { mask[i] = 0; continue }
    if (bi < 0) { mask[i] = 1; continue }
    const ir = data[i * 4], ig = data[i * 4 + 1], ib = data[i * 4 + 2]
    const br = data[bi * 4], bgc = data[bi * 4 + 1], bb = data[bi * 4 + 2]
    const fr = data[fi * 4], fg = data[fi * 4 + 1], fb = data[fi * 4 + 2]
    const vr = fr - br
    const vg = fg - bgc
    const vb = fb - bb
    const len2 = vr * vr + vg * vg + vb * vb
    if (len2 < 400) {
      // 前景与背景颜色几乎一样（例如白色主体压在白背景上）：
      // 颜色线退化，改用「谁更近」的空间插值，边缘依然能落在真实位置
      const df = dFg[i] < 0 ? r : dFg[i]
      const db = dBg[i] < 0 ? r : dBg[i]
      mask[i] = clamp01(df / Math.max(1e-6, df + db))
    } else {
      const a = ((ir - br) * vr + (ig - bgc) * vg + (ib - bb) * vb) / len2
      mask[i] = clamp01(a)
    }
  }

  /* ---- 5) 连通域清洁（去小碎点 / 补小孔 / 剔游离背景块） ---- */
  const minBlob = Math.max(10, Math.round(n * level.minBlobRatio))
  const bin = new Uint8Array(n)
  for (let i = 0; i < n; i++) bin[i] = mask[i] >= 0.5 ? 1 : 0
  const bboxMask = cleanComponents(bin, w, h, minBlob, { nearBg: nearBgColor })
  for (let i = 0; i < n; i++) {
    if (bin[i] === 0) mask[i] = 0
    else if (mask[i] < 0.5) mask[i] = 1
  }

  let subject = 0
  for (let i = 0; i < n; i++) if (bin[i]) subject++
  const subjectShare = subject / n
  if (subjectShare < 0.004) return fail('主体几乎被全部去掉，已放弃抠图')

  /* ---- 6) 置信度 ---- */
  let confidence = 1
  const topShare = clusters[0].share
  if (topShare < 0.5) confidence -= 0.35 * (1 - topShare / 0.5)
  if (bgShare > 0.9) confidence -= 0.2
  confidence -= Math.min(0.15, maxSpread / 160)
  if (unknown.length && subject < minBlob * 2) confidence -= 0.2
  confidence = Math.max(0, Math.min(1, confidence))
  const ok = confidence >= 0.3

  const out = finishMask(mask, w, h, sw, sh, level, {
    confidence,
    clusters: clusters.length,
    bgShare,
    shadowShare: shadowCount / n,
    shadowRolledBack: shadowCount === 0 && !shadowSafe,
    bgColors: clusters.map(c => (c.rgb ? rgbToHex(c.rgb[0], c.rgb[1], c.rgb[2]) : '')),
    transparent: false,
    reason: ok ? '' : '背景模型置信度较低，抠图结果可能不干净（可用橡皮擦手动修正）'
  }, bboxMask)
  if (!ok) {
    // 置信度不足：交给上层决定保留整图，但把掩膜一起带回去便于诊断
    return { ...out, ok: false }
  }
  return out
}

/**
 * 连通域清洁：
 *   ① 小于 minBlob 的前景碎点 → 去掉（噪点、压缩杂色）；
 *   ② 主体内部小于 minBlob 的孔 → 补掉（高光点、眼睛反光，别在肚子中间挖个洞）；
 *   ③ 与主体**不连通**、且多数像素「离背景色模型够近」的前景块 → 按背景处理。
 *      这条专治「背景颜色散一点就漏出几块游离前景」：外圈色模型只见过背景的
 *      一小部分，图内背景色偏出去一点点就会漏判，而"与主体不连通"是可靠的几何信号。
 *      判定用**逐像素投票**而不是整块平均色：这类碎块常和主体边缘黏在一起，
 *      平均色会被主体那一侧带跑（实测过：平均色口径下这块永远判不掉）。
 */
function cleanComponents(bin, w, h, minBlob, prune = null) {
  const n = w * h
  const label = new Int32Array(n).fill(-1)
  const q = new Int32Array(n)
  const comps = []
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0) continue
    const target = bin[s]
    let head = 0
    let tail = 0
    q[tail++] = s
    label[s] = comps.length
    let size = 0
    let touchBorder = false
    let bgVotes = 0
    while (head < tail) {
      const cur = q[head++]
      size++
      if (prune && prune.nearBg[cur]) bgVotes++
      const cx = cur % w
      const cy = (cur - cx) / w
      if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchBorder = true
      for (let k = 0; k < 4; k++) {
        const xx = cx + (k === 0 ? -1 : k === 1 ? 1 : 0)
        const yy = cy + (k === 2 ? -1 : k === 3 ? 1 : 0)
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const p = yy * w + xx
        if (label[p] >= 0 || bin[p] !== target) continue
        label[p] = comps.length
        q[tail++] = p
      }
    }
    comps.push({ size, target, touchBorder, bgVotes, drop: false })
  }

  if (prune) {
    let main = -1
    let bestSize = 0
    for (let c = 0; c < comps.length; c++) {
      if (comps[c].target === 1 && comps[c].size > bestSize) { bestSize = comps[c].size; main = c }
    }
    for (let c = 0; c < comps.length; c++) {
      const comp = comps[c]
      if (comp.target !== 1 || c === main || comp.size < minBlob) continue
      if (comp.bgVotes / comp.size >= 0.6) comp.drop = true
    }
  }

  for (let i = 0; i < n; i++) {
    const c = comps[label[i]]
    if (c.drop) bin[i] = 0
    else if (c.target === 1 && c.size < minBlob) bin[i] = 0
    else if (c.target === 0 && !c.touchBorder && c.size < minBlob) bin[i] = 1
  }

  /* 包围盒用「结实」的前景算：主体 + 占比够大的独立部件（比如旁边单独一朵花），
     不含细小的游离碎片。
     为什么包围盒要单独算：主体边缘在杂乱背景里常会拖出细长的须状痕迹，
     它们和主体连通（所以连通域规则管不着），却能把包围盒往外撑出上百像素 ——
     一裁就变成"主体只占画布一半"，格子全浪费在背景上。 */
  const mainSize = comps.reduce((m, c) => (c.target === 1 && c.size > m ? c.size : m), 0)
  const solidMin = Math.max(minBlob, Math.round(mainSize * 0.04))
  const bboxMask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const c = comps[label[i]]
    if (c.target !== 1 || c.drop) continue
    if (c.size >= solidMin) bboxMask[i] = 1
  }
  return bboxMask
}

/** 收尾：包围盒 + 放大到源图分辨率 + 统计 */
function finishMask(mask, w, h, sw, sh, level, meta, bboxMask = null) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  let subject = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (mask[i] < 0.5) continue
      subject++
      if (bboxMask && !bboxMask[i]) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < x0) {
    // 没有可用的包围盒（例如前景全被清掉）：退化成整幅图，交给上层按覆盖率判空格
    x0 = 0
    y0 = 0
    x1 = w - 1
    y1 = h - 1
  }
  const kx = sw / w
  const ky = sh / h
  let bbox = null
  if (x1 >= x0 && y1 >= y0) {
    const bw = (x1 - x0 + 1) * kx
    const bh = (y1 - y0 + 1) * ky
    const mx = bw * level.margin
    const my = bh * level.margin
    const bx = Math.max(0, Math.floor(x0 * kx - mx))
    const by = Math.max(0, Math.floor(y0 * ky - my))
    const br = Math.min(sw, Math.ceil((x1 + 1) * kx + mx))
    const bb = Math.min(sh, Math.ceil((y1 + 1) * ky + my))
    bbox = { x: bx, y: by, w: Math.max(1, br - bx), h: Math.max(1, bb - by) }
  }
  return {
    alpha: upsampleAlpha(mask, w, h, sw, sh),
    width: sw,
    height: sh,
    bbox,
    bgShare: 1 - subject / (w * h),
    confidence: meta.confidence,
    ok: true,
    reason: meta.reason || '',
    stats: {
      level: level.key,
      clusters: meta.clusters,
      /** 识别到的背景色（给界面显示，让用户一眼看出算法把什么当成了背景） */
      bgColors: meta.bgColors || [],
      bgShare: meta.bgShare != null ? meta.bgShare : 1 - subject / (w * h),
      /** 其中有多少是投影（阴影）。界面用它说明"去掉了背景和阴影" */
      shadowShare: meta.shadowShare || 0,
      /** 阴影那一步是否因为"可能吃到主体"而被整体回滚（见 estimateMatte 的安全网） */
      shadowRolledBack: !!meta.shadowRolledBack,
      transparent: !!meta.transparent,
      maskSide: w
    }
  }
}
