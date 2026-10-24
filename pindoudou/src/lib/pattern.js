/* =========================================================================
   拼豆图案生成引擎（PRD §6 / §14 / §15 / §41）
   要点：
   1. 结构化网格数据：cells 存「调色板索引」，pattern.palette 存颜色对象，
      不把整张图只保存成 PNG（PRD §41）。
   2. CIELAB + k-means++ 量化，最大色号数可调。
   3. 三种方案真正差异化：高还原 / 好拼版 / 艺术版，各自独立参数与评分。
   4. 还原度 = 与「邻域平均色」的平均 CIEDE2000（抖动只是有意加噪，不算失真）。
   5. 可拼性评分由孤立豆、换色次数、小色块、轮廓保留、颜色数真实算出。
   6. 库存约束：生成后按「只用我的豆 / 补购最少 / 最高还原」重新配色。
   ========================================================================= */

import {
  rgbToLab, deltaE2000, deltaE2000Lab, deltaEToSimilarity, enhanceColor, hexToRgb, rgbToHex, luminance
} from './color.js'
import { estimateMatte, matteLevel, matteMaxSide } from './matte.js'
import { cartoonize } from './cartoon.js'
import { getColors, getColor, getBrand, DEFAULT_BRAND_ID } from './palettes.js'
/* 板规格 / 豆径的唯一口径（52 / 78 / 104 / 120 钉画线板、2.6mm 小豆与 5mm 中号豆）都在这里 */
import { boardProfile, normalizeBoardSize, beadOf, autoBeadKey, BOARD_SPECS, LEGACY_BOARD } from './boardSpec.js'
export { normalizeBoardSize }

export const PATTERN_VERSION = 1
/**
 * 空格（不放豆）。自动抠背景之后，主体轮廓之外的位置就是空格；手动橡皮擦也写它。
 * 用 -1 而不是 0：0 是色板里第一个真实色号，两者混在一起没法区分。
 * 空格不参与选色、统计、材料表，也不计入豆子数。
 */
export const EMPTY = -1

/** 真正要放的豆子数（空格不算） */
export function beadCountOf(cells) {
  let n = 0
  for (let i = 0; i < cells.length; i++) if (cells[i] !== EMPTY) n++
  return n
}

/**
 * 每格主体覆盖率低于多少就判为空格。
 * 0.52 的含义：一格里有超过一半是背景就不放豆，边缘格按少数服从多数处理。
 * 这个阈值是「图案像不像」与「边缘有没有多余豆」的折中，抠图力度档位会覆盖它。
 */
export const EMPTY_SHARE = 0.52
/**
 * 老规格：29 × 29 插钉的 5mm 中号大号方板。
 *
 * ⚠️ 新画布不再用它（规格见 lib/boardSpec.js：52 / 78 / 104 / 120 钉画线板），
 * 但**不能删** —— 老存档（canvasW/canvasH = 29 / 58 / 116 / 300 / 450）与
 * 免费素材（照 29 格画的 SVG）都还按 29 分板，删掉它们打开旧作品就变了样。
 * 分板规格现在按画布尺寸推导（boardSpecFor），这里只作为「缺省值」兜底。
 */
export const BOARD_SIZE = LEGACY_BOARD
/** 中号豆直径 5mm → 1 颗 = 0.5cm（老规格兜底；新画布读 pattern.cmPerBead） */
export const CM_PER_BEAD = 0.5
/**
 * 一粒 5mm 中号豆约多重（克）。只用于「预计重量」这类展示口径。
 *
 * 0.07 g 的来处（原来写的 0.35 g 没有任何出处，等于把重量放大了 5 倍：
 * 49,800 颗会被显示成 17.4 kg 豆子）：
 *   · 卖家字段：Artkal 5mm 1000 颗装「Item weight 0.15 Pounds」≈ 68 g/千颗（亚马逊英国）；
 *   · 换算口径：5mm 约 50 g ≈ 750 粒 → 0.067 g/颗（同一条聚合摘要里另有「一斤约 3750 粒」
 *     = 0.133 g/颗，与它自己给出的 50 g/750 粒差一倍，取前者是因为下面第三条也支持 0.07）；
 *   · 几何估算：直径 5mm、高 5mm、孔径约 2.5mm 的空心圆柱 ≈ 70 mm³ × PE 约 0.95 g/cm³ ≈ 0.067 g。
 * 后两条互相印证，所以这里取 0.07 g；若将来拿到官方重量表，以官方为准。
 */
export const BEAD_WEIGHT_G = 0.07

/**
 * 图案对象上的豆径字段（分板、材料克重、成品厘米、1:1 打印都读它）。
 * 为什么不直接读全局设置：图纸是**生成那一刻**的口径，之后用户改设置不该
 * 让已经存好的作品跟着变（老存档没有这些字段时由 fromPatternJSON 补）。
 */
export function beadFields(beadKey) {
  const b = beadOf(beadKey)
  return { beadKey: b.key, beadMm: b.mm, cmPerBead: b.cm, beadWeightG: b.weightG }
}

/** 图案对象上的板 / 豆径口径（生成与读档两条路都走它，保证同一份图纸只有一个口径） */
export function patternProfile(gw, gh, boardSize, beadKey) {
  return {
    boardSize: normalizeBoardSize(boardSize, gw, gh),
    ...beadFields(beadKey || autoBeadKey(gw, gh))
  }
}

/**
 * 后处理的感知护栏（单位：CIEDE2000）。
 * ΔE00 < 6 基本看不出差别（同一个色系的相邻色号就是这个量级），
 * 因此「合并零星色」只允许并掉这种程度的色差；「去孤立豆」放宽到 18 ——
 * 孤立豆本身是噪点，允许换到相邻色阶，但绝不允许把眼睛/轮廓这种高对比孤点抹掉。
 *
 * 18 是实测出来的平衡点（漫德全色号，7 张评测图）：平均色差 4.61，孤立豆 6 颗；
 * 收紧到 12 只再降 0.4% 色差、孤立豆却翻倍；放宽到 24 则开始抹掉细节（边缘相关 0.786 → 0.772）。
 */
export const MERGE_MAX_DE = 6
export const CLEANUP_MAX_DE = 18
export const VARIANT_META = [
  {
    key: 'high',
    label: '高还原',
    tagline: '细节优先',
    desc: '保留更多细节与过渡色，最贴近原图，适合收藏与大图。'
  },
  {
    key: 'easy',
    label: '好拼版',
    tagline: '更省力',
    desc: '颜色更少、换色更少、孤立豆更少，实际拼起来最省力。'
  },
  {
    key: 'art',
    label: '艺术版',
    tagline: '风格优先',
    desc: '色块概括、色阶分明，做风格化插画效果。'
  }
]

/**
 * 目标色号数的硬上限。
 *
 * 为什么是 291：**等于我们内置的最大色板长度**（漫德 MARD 291 / COCO 291 都是 291 色），
 * 再往上没有可选的豆子。它现在**不再受存档格式限制** —— 这条限制的历史见下，
 * 两次扩容之后存档容量（PACK_CAPACITY = 547）已经比任何一块色板都大得多。
 *
 * 这个数变过两次，两次都不是因为画质，而是因为**「引擎能选多少色」必须 ≤「存档能存多少色」**：
 *   · 90：存档是「一格一个字符」，字符集 = 可打印 ASCII 去掉 JSON 必须转义的 " 和 \，
 *     共 91 个，其中 1 个留给空格 —— 色板明明有 221 个，引擎却只允许选 90 个；
 *   · 221：字符集扩到 256 个（91 个 ASCII + 165 个 BMP 字符，体积一分没涨，见 archive.js），
 *     容量 90 → 255，刚好覆盖当时的最大色板（漫德 221）；
 *   · 291：色板扩到 291 之后 255 又不够了，于是字符集再一次扩到 548 个
 *     （补上拉丁扩展-B，仍是 BMP、仍不被 JSON 转义、仍是「一格一个字符」），
 *     容量 255 → 547，留给以后更大的色板（优肯 418 那种）也用得上。
 * 三处必须一起满足：`PACK_CAPACITY >= MAX_TARGET_COLORS`（verify-archive.mjs 钉住了），
 * 以及记忆化下标不能溢出（下标存 Uint16Array，见 MEMO_MAX_COLORS）。
 *
 * 注意「上限」不等于「建议值」：真实题材在 5bit 直方图上把平均 ΔE00 压到 2~3 一档
 * 只需要几十个色号，48~64 是实测拐点（见 COLOR_FLOOR_BY_CELLS），
 * 90 以上实测 dEcell 只再降 ≤0.6%、dEview 0%，代价是孤立豆 +12%、可拼性 -0.04
 * —— 所以自动档仍然落在拐点上，291 是留给用户手动推的余量。
 * 顺带一提，这个上限以前还被写死成 36（见 variantParams 的旧注释），
 * 用户把目标色数调到 36 以上会被**静默截断** —— 界面显示 64 色、实际只出 36 色。
 */
export const MAX_TARGET_COLORS = 291

/**
 * 「画布多大就该给多少色号」的配套建议值（按画布总格数分档）。
 *
 * 为什么要有这张表：格数只决定「形状能画多细」，色号才决定「像不像」。
 * 用户点精细档的动机是"不够像"，而真正让他觉得不像的往往不是格数而是色号 ——
 * 一张 116×116 的真人照只用 16 色，脸就是十几个色块在拼，格数再多也救不回来。
 *
 * 数字口径来自 scripts/fidelity/bench-colors.mjs 的「色号数 → 平均色差」曲线
 * （ref_girl.png、photo_pumpkin.png 两张真实照片，116 格与 300 格两档）：
 *   · 16 → 32 色这一段最陡，每加 10 色能降 0.11~0.34 dEcell；
 *   · 48 → 64 色只剩 0.02~0.05，64 → 90 只剩 0.004~0.02；
 *   · 90 以上实测再降 ≤0.6%dEcell、dEview 一律 0%，孤立豆却 +11.8%、可拼性 -0.04
 *     —— 所以**硬上限放开了（90 → 221 → 291），这张建议表仍然停在拐点上**：
 *     引擎还会自己提前收敛（贪心选色的边际收益 ≤0 就 break，实测最多用到 126 色），
 *     想要极限用色数的用户可以把滑块拖到底，默认档不替他做这个决定。
 * 换句话说：116 格配 16 色（旧默认）离"像"差得最远；按 116 格 48 色、
 * 精细档（≥4 万格）64 色来配，就已经吃掉了色号所能带来的九成收益，
 * 而孤立豆比推到 90 色少两成 —— 少一个色号，用户就少买一包豆子。
 */
export const COLOR_FLOOR_BY_CELLS = [
  { cells: 800000, colors: 90 },
  { cells: 200000, colors: 80 },
  { cells: 40000, colors: 64 },
  { cells: 6000, colors: 48 },
  { cells: 2500, colors: 32 },
  { cells: 1, colors: 16 }
]

/** 画布格数 → 建议色号数（见 COLOR_FLOOR_BY_CELLS） */
export function colorFloorForCells(cells) {
  const hit = COLOR_FLOOR_BY_CELLS.find(t => cells >= t.cells)
  return hit ? Math.min(MAX_TARGET_COLORS, hit.colors) : 0
}

/** 三套方案的生成参数（相对用户设定的目标色数做偏移，保证差异真实存在） */
export function variantParams(key, target) {
  const base = Math.max(4, Math.min(MAX_TARGET_COLORS, Math.round(target) || 16))
  if (key === 'high') {
    /* 高还原档：把「最近色号」这一步显式写成 CIEDE2000（assign='de'，也是 mapCells 的默认值），
       并把选色阶段的色号上限从旧的 36 放开到 MAX_TARGET_COLORS —— 复杂照片色号不够时，
       被静默截断才是"不像"的主因。
       ⚠️ 这里**故意不给 quantMetric='de'**：让 quantize 的 k-medoids 也改用 ΔE00 度量，
       实测平均色差只再降约 1.9%（中位数），但 dEview 在 10 个档位里有 3 个反而变差
       （最多 +2.9%）、孤立豆最多 +17.5%、可拼性 −0.05 —— 典型按下葫芦浮起瓢，
       所以按「收益 <2% 就撤」的口径撤掉了。相关实测见
       scripts/fidelity/bench-scale.mjs --variant high 与 scripts/verify/pattern-fingerprint.mjs。 */
    return {
      cap: Math.min(MAX_TARGET_COLORS, base + 4),
      dither: 'off', cleanup: 0, posterize: 0, mergeRatio: 0, saturate: 1, contrast: 1,
      assign: 'de'
    }
  }
  if (key === 'easy') {
    return { cap: Math.max(4, Math.round(base * 0.62)), dither: 'off', cleanup: 1, posterize: 0, mergeRatio: 0.0016, saturate: 1.06, contrast: 1.04 }
  }
  return { cap: Math.max(3, Math.round(base * 0.42)), dither: 'off', cleanup: 1, posterize: 30, mergeRatio: 0.005, saturate: 1.16, contrast: 1.12 }
}

/* ---------------------------------------------------------------- 采样 */

/**
 * 读图时允许的最大边长。源图再大也先降到这个尺寸，避免一次 4K/8K 全图取像素撑爆内存。
 *
 * 为什么从 1024 提到 2048：画布上限提到 1000 格（100 万格）之后，1024 的源图上限意味着
 * 「一格最多摊到 1 个源像素」（1024 / 1000 ≈ 1.02），也就是只能 1:1 点采样 ——
 * 既没有面积平均、也没有多数投票的余量，真人照片的轮廓和过渡会直接糊掉、糊出原图没有的
 * 脏色。2048 才留出 2×2 的余量（1000 格 × SS=2 = 2000 ≤ 2048），边缘格走的是真正的
 * 「2×2 源像素投票 + 面积平均」，这正是"画布能开到 1000 格"的必要成本。
 *
 * 内存代价：2048² 像素 × RGBA = 16 MB 的像素缓冲（外加浏览器 canvas 自身的一份副本，
 * 以及逐级减半过程中的中间 canvas，峰值约 40 MB），现代桌面/移动浏览器都可接受；
 * 相比之下 4K 源图按原始尺寸取像素是 4096² × 4 = 67 MB 起，那才是要挡住的。
 *
 * 导出给界面用：UI 要拿它和画布格数比较，如实提示「画布已经超过原图的有效分辨率」。
 */
export const MAX_SOURCE_SIDE = 2048

/**
 * 纯函数：把 RGBA 源图重采样成 tw×th，返回 { data, rect, cover }。
 *
 * 为什么不用 canvas 的 drawImage 做最终缩放：
 *   1. 各浏览器 / 各缩放倍率下的滤波器不一致（双线性、盒式、Lanczos 都有），
 *      同一张图换台机器结果就变，出问题无法复现；
 *   2. 它依赖 DOM，算法就没法在 Node 里跑测试与回归评测。
 * 这里统一成「目标像素 = 对应源区域的面积平均」——和图像缩放的通用做法同口径
 * （在 sRGB 空间平均，与浏览器的做法一致，不是线性光平均：一颗豆的观感更接近
 *  感知空间的平均，线性光平均会把黑白色块平均成过亮的灰）。
 * 留白区域按白底填充（拼豆没有透明，白底最接近实物）。
 *
 * 两个可选参数服务于「自动抠背景」：
 *   · srcRect 只对源图的某个矩形采样（主体紧包围盒）——主体因此占满画布，
 *     格子全用在主体上，还原度会明显好于「整图缩小 + 一圈背景」；
 *   · mask 是源图分辨率的 0~1 主体覆盖率。给了它之后：
 *       - `cover` 返回每个目标像素的主体覆盖率（连续值，用于判定空格）；
 *       - 目标像素的颜色只由「主体样本」平均（覆盖率 ≥0.5 的源像素），
 *         **不与背景做平均** —— 否则轮廓一圈会混出原图没有的浅色，也就是白边。
 */
export function resampleRGBA(src, sw, sh, tw, th, fit = 'contain', srcRect = null, mask = null) {
  const out = new Uint8ClampedArray(tw * th * 4)
  const cover = mask ? new Float32Array(tw * th) : null
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255
  }
  if (!(sw > 0 && sh > 0) || !(tw > 0 && th > 0)) {
    return { data: out, rect: { x: 0, y: 0, w: tw, h: th }, cover }
  }

  // 采样窗口：默认整张图；抠背景时收窄到主体包围盒
  const rx = srcRect ? Math.max(0, Math.min(sw - 1, Math.floor(srcRect.x))) : 0
  const ry = srcRect ? Math.max(0, Math.min(sh - 1, Math.floor(srcRect.y))) : 0
  const rw = srcRect ? Math.max(1, Math.min(sw - rx, Math.round(srcRect.w))) : sw
  const rh = srcRect ? Math.max(1, Math.min(sh - ry, Math.round(srcRect.h))) : sh

  // 目标画布上真正被源图覆盖的区域
  let dw, dh
  if (fit === 'cover') {
    const k = Math.max(tw / rw, th / rh)
    dw = rw * k
    dh = rh * k
  } else {
    const k = Math.min(tw / rw, th / rh)
    dw = Math.max(1, rw * k)
    dh = Math.max(1, rh * k)
  }
  const dx = (tw - dw) / 2
  const dy = (th - dh) / 2
  const sx = rw / dw // 源像素 / 目标像素
  const sy = rh / dh

  const x0 = Math.max(0, Math.ceil(dx - 0.5))
  const x1 = Math.min(tw, Math.ceil(dx + dw - 0.5))
  const y0 = Math.max(0, Math.ceil(dy - 0.5))
  const y1 = Math.min(th, Math.ceil(dy + dh - 0.5))

  for (let y = y0; y < y1; y++) {
    // 目标像素 y 覆盖的源区间（像素中心对齐：目标像素 y 的中心在 dy + y + 0.5 - dy）
    let v0 = (y + 0.5 - dy) * sy - sy / 2
    let v1 = v0 + sy
    if (v0 < 0) v0 = 0
    if (v1 > rh) v1 = rh
    const vy0 = Math.floor(v0)
    const vy1 = Math.min(rh, Math.ceil(v1))
    if (vy1 <= vy0) continue

    for (let x = x0; x < x1; x++) {
      let u0 = (x + 0.5 - dx) * sx - sx / 2
      let u1 = u0 + sx
      if (u0 < 0) u0 = 0
      if (u1 > rw) u1 = rw
      const ux0 = Math.floor(u0)
      const ux1 = Math.min(rw, Math.ceil(u1))
      if (ux1 <= ux0) continue

      let ar = 0, ag = 0, ab = 0, wsum = 0
      let asum = 0, awsum = 0
      for (let v = vy0; v < vy1; v++) {
        const cy = Math.min(v + 1, v1) - Math.max(v, v0)
        if (cy <= 0) continue
        const rowOff = (v + ry) * sw + rx
        for (let u = ux0; u < ux1; u++) {
          const cx = Math.min(u + 1, u1) - Math.max(u, u0)
          if (cx <= 0) continue
          const w = cx * cy
          const i = (rowOff + u) * 4
          if (mask) {
            // 覆盖率用连续 α 累加；颜色只用主体样本，避免白边
            const a = mask[rowOff + u]
            asum += a * w
            awsum += w
            if (a >= 0.5) {
              ar += src[i] * w
              ag += src[i + 1] * w
              ab += src[i + 2] * w
              wsum += w
            }
          } else {
            const a = src[i + 3] / 255
            // 透明像素按白底合成，避免变成黑豆
            ar += (src[i] * a + 255 * (1 - a)) * w
            ag += (src[i + 1] * a + 255 * (1 - a)) * w
            ab += (src[i + 2] * a + 255 * (1 - a)) * w
            wsum += w
          }
        }
      }
      const o = (y * tw + x) * 4
      if (cover && awsum > 0) cover[y * tw + x] = asum / awsum
      if (!wsum) continue
      out[o] = Math.round(ar / wsum)
      out[o + 1] = Math.round(ag / wsum)
      out[o + 2] = Math.round(ab / wsum)
      out[o + 3] = 255
    }
  }

  return { data: out, rect: { x: dx, y: dy, w: dw, h: dh }, cover }
}

/**
 * 半透明像素与白底合成（原地改 RGB，**保留 alpha**）。
 *
 * 为什么必须保留 alpha：matte.js 的 estimateMatte 里有一条「源图自带透明背景就直接沿用
 * alpha」的分支（最精确、零猜测的抠图路径）。但那条分支的判据是 `alpha < 8`，
 * 而 canvas 一旦先铺白底再 drawImage，读回来的 alpha 全是 255 —— 这条分支在浏览器里
 * 等于死代码（只有 Node 评测里直接喂原始 RGBA 才走得到）。
 * 于是「透明背景的 PNG 贴纸」会退化成：背景一整片白豆 + 主体边缘镶一圈白边。
 *
 * 合成放在**最后一步、在 JS 里做一次**：先铺白底再逐级减半会让每一步的 alpha 都被抹掉，
 * 而且与「先按面积平均、再与白底合成」在数学上并不等价（后者才是正确的面积平均）。
 */
function flattenOverWhite(data) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 255) continue
    const k = a / 255
    data[i] = Math.round(data[i] * k + 255 * (1 - k))
    data[i + 1] = Math.round(data[i + 1] * k + 255 * (1 - k))
    data[i + 2] = Math.round(data[i + 2] * k + 255 * (1 - k))
  }
}

/**
 * 源图是不是「自带透明背景」。
 * 判据与 matte.js 的 alpha 分支保持一致：alpha < 8 的像素超过 1.5%。
 * 上限 2048² = 420 万像素，一次线性扫描约 4~6 ms，只在读图时算一次。
 */
export function hasTransparency(data) {
  let n = 0
  const total = data.length / 4
  for (let i = 3; i < data.length; i += 4) if (data[i] < 8) n++
  return n > total * 0.015
}

/**
 * 浏览器路径：把已解码的 <img> 读成 RGBA 像素。
 * 先逐级减半降到 MAX_SOURCE_SIDE 以内（一次性大幅缩小会让浏览器丢掉高频细节，
 * 边缘出现摩尔纹），之后交给纯函数做真正的面积平均。
 *
 * 返回值多了 `transparent`：源图自带透明背景时为 true，调用方据此**自动**走抠图
 * （不需要用户手动打开「智能抠图」——他上传的本来就是一张贴纸，透明区域就是"不放豆"）。
 * RGB 仍然是「与白底合成」后的值，所以对不透明的图，逐字节与改造前完全一致。
 */
export function readImagePixels(img, maxSide = MAX_SOURCE_SIDE) {
  const iw = (img && (img.naturalWidth || img.width)) || 0
  const ih = (img && (img.naturalHeight || img.height)) || 0
  if (!(iw > 0 && ih > 0)) throw new Error('图片尺寸异常，无法读取像素')

  let cur = img
  let cw = iw
  let ch = ih
  let guard = 0
  while (Math.max(cw, ch) > maxSide * 2 && guard++ < 14) {
    const nw = Math.max(1, Math.round(cw / 2))
    const nh = Math.max(1, Math.round(ch / 2))
    const c = document.createElement('canvas')
    c.width = nw
    c.height = nh
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.imageSmoothingEnabled = true
    cx.imageSmoothingQuality = 'high'
    // 这里**不铺白底**：铺了 alpha 就在第一次减半时没了（见 flattenOverWhite 的说明）
    cx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh)
    cur = c
    cw = nw
    ch = nh
  }

  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, cw, ch)
  const data = ctx.getImageData(0, 0, cw, ch).data
  const transparent = hasTransparency(data)
  flattenOverWhite(data)
  return { data, width: cw, height: ch, transparent }
}

/**
 * 每格取色：SS×SS 个源像素做多数投票。
 * 直接取平均会把形状边缘混出原图没有的过渡色（看起来"晕染"），
 * 多数投票让边缘直接落在两种真实颜色之一，图案干净得多。
 * 票数不够集中（渐变 / 噪点区域）时退回面积平均，保证渐变区域取到真实中间色。
 *
 * cover 是 resampleRGBA 给出的「主体覆盖率」：
 *   · 覆盖率 < 0.5 的高分辨率样本直接不参与取色（那是主体外面的像素）；
 *   · 每格的 coverage = 所有样本覆盖率的平均，交给上层判定「这一格放不放豆」。
 * 只统计被采用的样本做投票，边缘格因此不会被背景色污染。
 */
function cellsFromSupersampled(data, hiW, hiH, gw, gh, SS, voteMinShare = VOTE_MIN_SHARE, cover = null) {
  const rgb = new Float32Array(gw * gh * 3)
  const coverage = cover ? new Float32Array(gw * gh) : null
  for (let i = 0; i < rgb.length; i++) rgb[i] = 255
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const groups = new Map()
      let sr = 0, sg = 0, sb = 0, cnt = 0
      let csum = 0, ctotal = 0
      for (let sy = 0; sy < SS; sy++) {
        const py = cy * SS + sy
        if (py >= hiH) continue
        for (let sx = 0; sx < SS; sx++) {
          const px = cx * SS + sx
          if (px >= hiW) continue
          const pi = py * hiW + px
          ctotal++
          if (cover) {
            const cv = cover[pi]
            csum += cv
            if (cv < 0.5) continue
          }
          const i = pi * 4
          const r = data[i], g = data[i + 1], b = data[i + 2]
          sr += r; sg += g; sb += b; cnt++
          const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
          let e = groups.get(key)
          if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; groups.set(key, e) }
          e.n++; e.r += r; e.g += g; e.b += b
        }
      }
      const o = (cy * gw + cx) * 3
      if (coverage) coverage[cy * gw + cx] = ctotal ? csum / ctotal : 0
      if (!cnt) continue
      let best = null
      for (const e of groups.values()) if (!best || e.n > best.n) best = e
      if (best && best.n >= cnt * voteMinShare) {
        rgb[o] = best.r / best.n
        rgb[o + 1] = best.g / best.n
        rgb[o + 2] = best.b / best.n
      } else {
        rgb[o] = sr / cnt
        rgb[o + 1] = sg / cnt
        rgb[o + 2] = sb / cnt
      }
    }
  }
  return { rgb, coverage }
}

/** 超采样倍率：格子越多，每格可用的源像素越少，倍率相应降低 */
export function supersampleFactor(gw, gh) {
  return Math.max(2, Math.min(4, Math.floor(300 / Math.max(gw, gh)) || 2))
}

/**
 * 按**源图真实分辨率**算出还有意义的超采样倍率上限。
 *
 * 为什么必须封顶：supersampleFactor 只看画布格数（gw ≥ 150 就恒返回 2），它完全不知道
 * 源图有多少像素。1000 格画布 + 2048 源图时，它会指挥引擎先把源图上采样到 2000×2000
 * 再按 2×2 投票 —— 那 2×2 个样本本来就是同一个源像素插值出来的复制品，投票投的是自己，
 * 白花 4 倍采样量与 16 MB 缓冲，还原度一点都不涨（1000 格时源图只有 1.02 个像素/格，
 * SS=2 的第 2 行第 2 列样本是重采样凭空造出来的）。
 *
 * 真正的上限是「一格摊得到几个源像素」：
 *   · fit='contain'：源图按 k=min(gw/rw, gh/rh) 缩放到画布内居中，缩放后覆盖 dw×dh 个格子，
 *     于是横向每格摊到 rw/dw 个源像素、纵向 rh/dh 个，取较小的一侧 —— 也就是被"短边"
 *     卡住的那一边。注意不能图省事写成 rw/gw：contain 会留白，留白那一侧并没有富余像素，
 *     直接除会把"实际没被采样到的源像素"算成可用余量，倍率就会封不住。
 *   · fit='cover'：k=max(...)，源图溢出画布，同样按实际覆盖量 dw/dh 算。
 * 最后向下取整到 ≥1：把一个源像素劈成两半当两个样本是没有意义的。
 */
export function maxUsefulSupersample(rw, rh, gw, gh, fit = 'contain') {
  if (!(rw > 0) || !(rh > 0) || !(gw > 0) || !(gh > 0)) return 1
  const cover = fit === 'cover'
  const k = cover ? Math.max(gw / rw, gh / rh) : Math.min(gw / rw, gh / rh)
  // 与 resampleRGBA 里的 dw/dh 同口径：contain 会 clamp 到 1，cover 不会
  const dw = cover ? rw * k : Math.max(1, rw * k)
  const dh = cover ? rh * k : Math.max(1, rh * k)
  const perCell = Math.min(rw / dw, rh / dh)
  // 相对容差：k 是两次除法算出来的，理论上刚好等于 2 的档位可能算出 1.9999999996；
  // 少给一档会实打实地丢掉超采样，所以按相对量放宽 1e-9 再取整。
  return Math.max(1, Math.floor(perCell + 1e-9 * Math.max(1, perCell)))
}

/**
 * 多数投票的门槛：同色像素占比达到这个比例才采用「众数色」，否则退回面积平均。
 * 0.34 是实测出来的折中 —— 太低会让渐变色区域变成色块（噪点被当成主体色），
 * 太高则边缘又会被平均成原图没有的过渡色。
 */
export const VOTE_MIN_SHARE = 0.34

/**
 * 纯函数：从 RGBA 像素直接算出 gw×gh 的每格颜色。
 * matte 为抠图结果（见 matte.js）时，会按主体包围盒采样并额外返回每格覆盖率。
 */
export function sampleCellsMatted(src, sw, sh, gw, gh, fit = 'contain', SS = 3, voteMinShare = VOTE_MIN_SHARE, matte = null, srcRect = null) {
  const hiW = gw * SS
  const hiH = gh * SS
  const rect = srcRect || (matte && matte.bbox) || null
  const { data, cover } = resampleRGBA(src, sw, sh, hiW, hiH, fit, rect, matte ? matte.alpha : null)
  return cellsFromSupersampled(data, hiW, hiH, gw, gh, SS, voteMinShare, cover)
}

/** 兼容旧签名：只要每格颜色 */
export function sampleCellsFromRGBA(src, sw, sh, gw, gh, fit = 'contain', SS = 3, voteMinShare = VOTE_MIN_SHARE) {
  return sampleCellsMatted(src, sw, sh, gw, gh, fit, SS, voteMinShare, null, null).rgb
}

/** 把源图采样成 gw×gh 的像素数据（浏览器路径） */
export function sampleImage(img, gw, gh, fit = 'contain') {
  const px = readImagePixels(img)
  return resampleRGBA(px.data, px.width, px.height, gw, gh, fit)
}

/** 每格取色（浏览器路径） */
export function sampleCells(img, gw, gh, fit = 'contain', SS = 3) {
  const px = readImagePixels(img)
  return sampleCellsFromRGBA(px.data, px.width, px.height, gw, gh, fit, SS)
}
/* ---------------------------------------------------------------- 量化 */

/**
 * 颜色直方图：像素按 5bit/通道聚合，得到「唯一色 + 权重」。
 * 为什么先聚合：照片里大量像素颜色几乎相同；116×116（4 块板）有 13456 个格子，
 * 聚合后通常只剩几百个桶，选色迭代能快一个数量级，而且不影响精度（同桶内的色差已远小于色板间距）。
 */
function buildHistogram(rgb, keep = null) {
  const map = new Map()
  const total = rgb.length / 3
  for (let i = 0; i < total; i++) {
    // 空格（抠掉的背景）不参与选色：否则白背景会白白占掉一个色号
    if (keep && !keep[i]) continue
    const o = i * 3
    const r = rgb[o], g = rgb[o + 1], b = rgb[o + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    let e = map.get(key)
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; map.set(key, e) }
    e.n++; e.r += r; e.g += g; e.b += b
  }
  const bins = []
  for (const e of map.values()) {
    bins.push({ n: e.n, lab: rgbToLab(e.r / e.n, e.g / e.n, e.b / e.n) })
  }
  return bins
}

/**
 * 从色板里挑 k 个颜色来代表整张画面。
 *
 * 算法：k-medoids（限定了「候选颜色必须是色板里真实存在的色号」的 k-means）
 *   ① 贪心选址：每一轮加入「让总映射误差下降最多」的那个色号；
 *   ② Lloyd 迭代：把像素归到最近的已选色 → 每个簇重新挑簇内加权误差最小的色号，
 *      反复到不再变化。整个过程直接优化「最终每格映射误差」这个目标本身。
 *
 * 为什么不用原来的「k-means 出质心 → 质心找最近色号」：质心是自由浮点色，
 * 找最近色号时经常两个簇抢同一个色号，抢不到的那个只能退而求其次拿一个明显更差的色，
 * 于是同样的色数下误差更大。这里候选色从头到尾都限制在色板内，不存在这一步损失。
 *
 * 全程确定性（不用随机数，平局按色板顺序判定），保证同一张图重复生成结果一致。
 */
export function quantize(rgb, k, palette, metric = 'lab', keep = null) {
  if (!palette.length) return []
  const P = palette.length
  const K = Math.max(1, Math.min(k, P))
  const bins = buildHistogram(rgb, keep)
  if (!bins.length) return palette.slice(0, K)

  const N = bins.length
  const w = new Float64Array(N)
  /* 距离口径：默认 Lab 欧氏距离（CIE76），和「最近色号」这一步一致，选出来的色号
     互相之间的对比度更温和，孤立豆更少。metric='de' 可以换成 CIEDE2000 ——
     平均色差会再小 1%~3%，代价是选色更「锐」、可拼性下降几个点，
     所以只在明确要极限还原度时才用（例如离线评测 / 未来的「极致还原」开关）。 */
  const useDE = metric === 'de'
  const dist = new Float64Array(N * P)
  for (let i = 0; i < N; i++) {
    w[i] = bins[i].n
    const l = bins[i].lab
    for (let p = 0; p < P; p++) {
      if (useDE) {
        dist[i * P + p] = deltaE2000(l, palette[p].lab)
      } else {
        const d = palette[p].lab
        const dl = l[0] - d[0], da = l[1] - d[1], db = l[2] - d[2]
        dist[i * P + p] = dl * dl + da * da + db * db
      }
    }
  }

  const minDist = new Float64Array(N).fill(Infinity)
  const assign = new Int32Array(N).fill(-1)
  const picked = []
  const pickedSet = new Set()

  /* ① 贪心选址 */
  for (let step = 0; step < K; step++) {
    let bestP = -1
    let bestGain = -Infinity
    for (let p = 0; p < P; p++) {
      if (pickedSet.has(p)) continue
      let gain = 0
      if (step === 0) {
        for (let i = 0; i < N; i++) gain -= dist[i * P + p] * w[i]
      } else {
        for (let i = 0; i < N; i++) {
          const d = dist[i * P + p]
          if (d < minDist[i]) gain += (minDist[i] - d) * w[i]
        }
      }
      if (gain > bestGain) { bestGain = gain; bestP = p }
    }
    if (bestP < 0) break
    picked.push(bestP)
    pickedSet.add(bestP)
    for (let i = 0; i < N; i++) {
      const d = dist[i * P + bestP]
      if (d < minDist[i]) { minDist[i] = d; assign[i] = bestP }
    }
    if (step > 0 && bestGain <= 0) break
  }

  /* ② Lloyd 迭代（medoid 更新） */
  const clusterCost = new Float64Array(K * P)
  for (let iter = 0; iter < 6 && picked.length > 1; iter++) {
    const size = new Int32Array(K)
    let moved = 0
    for (let i = 0; i < N; i++) {
      let bi = 0, bd = Infinity
      for (let c = 0; c < picked.length; c++) {
        const d = dist[i * P + picked[c]]
        if (d < bd) { bd = d; bi = c }
      }
      if (assign[i] !== bi) { assign[i] = bi; moved++ }
      size[bi]++
    }
    if (!moved && iter > 0) break

    clusterCost.fill(0)
    for (let i = 0; i < N; i++) {
      const base = assign[i] * P
      const wi = w[i]
      const row = i * P
      for (let p = 0; p < P; p++) clusterCost[base + p] += dist[row + p] * wi
    }

    // 大簇先挑色号，避免小簇把大簇最需要的颜色抢走
    const order = [...picked.keys()].sort((a, b) => size[b] - size[a])
    const taken = new Set()
    const next = new Int32Array(picked.length)
    for (const c of order) {
      let bp = -1, bd = Infinity
      for (let p = 0; p < P; p++) {
        if (taken.has(p)) continue
        const v = clusterCost[c * P + p]
        if (v < bd) { bd = v; bp = p }
      }
      if (bp < 0) bp = picked[c]
      taken.add(bp)
      next[c] = bp
    }
    for (let c = 0; c < picked.length; c++) picked[c] = next[c]
    pickedSet.clear()
    for (const p of picked) pickedSet.add(p)
  }

  return picked.length ? picked.map(p => palette[p]) : palette.slice(0, K)
}

/* ---------------------------------------------------------------- 映射 */

function buildLabCache(palette) {
  return palette.map(p => p.lab)
}

function nearestIndex(L, A, B, labs) {
  let bi = 0, bd = Infinity
  for (let i = 0; i < labs.length; i++) {
    const l = labs[i]
    const dl = L - l[0], da = A - l[1], db = B - l[2]
    const d = dl * dl + da * da + db * db
    if (d < bd) { bd = d; bi = i }
  }
  return bi
}

/**
 * 用 CIEDE2000 找最近色号（**全量精确搜索**）。
 *
 * 色号之间往往只差一档明度（ΔE00 常常只有 3~6），Lab 欧氏距离在这个尺度上
 * 会系统性地偏向高彩度颜色，导致「浅色区域被拉深、深色区域被拉浅」。
 *
 * 历史实现先用 Lab 欧氏距离筛 3 个候选、再只在候选里算 ΔE00。实测这 3 个候选
 * 并不总包含真正的 ΔE00 赢家：2 万个随机颜色里 8.6% 会落到更远的色号上，
 * 平均多出 1.30 ΔE00、最大多出 9.80 —— 对「每一格都要用色卡里最接近的颜色」
 * 这个要求来说是硬伤。现在改成对色板里**每一个**色号算 ΔE00，平局按色板顺序。
 *
 * 速度由「24bit RGB 精确记忆化」兜底：同一张图里大量格子颜色相同，
 * 每个不同颜色只扫一次色板（见 memoizedNearest）。
 */
function nearestIndexDE(L, A, B, labs) {
  let bi = 0, bd = Infinity
  for (let i = 0; i < labs.length; i++) {
    const l = labs[i]
    const d = deltaE2000Lab(L, A, B, l[0], l[1], l[2])
    if (d < bd) { bd = d; bi = i }
  }
  return bi
}

/** 抖动强度：none / low / medium / high（PRD §15.3，默认关闭） */
const DITHER_STRENGTH = { off: 0, none: 0, low: 0.42, medium: 0.72, high: 1 }

/* ---------------------------------------------------- 最近色记忆化 */

/**
 * 最近色记忆化：把「某个 RGB 采到了哪个色板下标」这件事查表复用。
 *
 * 为什么必须加：1000×1000 = 100 万格，每格都要在色板里扫一遍 Lab 距离，再对前 3 名算
 * CIEDE2000 —— 1000 格真人照片实测这一步（含后处理）要 700~770 ms，是整条生成链里
 * 最重的一段。但照片采样出来的每格颜色高度重复：同一张 1000 格真人照片，cellRgb 里
 * 不同的 24bit 颜色只有 88,338 个（占 8.8%）—— 也就是 91% 的格子问的是同一个问题。
 *
 * 为什么用 **24bit 精确 RGB** 当 key，而不是 buildHistogram 那种 5bit/通道的桶：
 * 实测过（把这里的 key 换成 `(r>>3)<<10|(g>>3)<<5|(b>>3)`，重跑
 * scripts/verify/pattern-fingerprint.mjs 的整批指纹）—— 17 条"必须逐位一致"的配置里有 5 条变了：
 *   · 450×450 / 30 色：dEcell 2.71 → 2.78、simApp 0.976 → 0.975、孤立豆 2709 → 2773
 *   · 300×300 / 30 色：dEcell 3.14 → 3.21
 *   · 1000×1000 / 30 色：dEcell 2.19 → 2.26（同时耗时 724 ms → 597 ms，确实更快）
 * 一个 5bit 桶覆盖 8×8×8 = 512 个颜色，桶内第一个被问到的颜色会把答案借给整桶，
 * 相当于悄悄把邻近色并成一个色号 —— 差 0.07 个 ΔE00 听着小，但它已经**不是同一个算法**了，
 * "同图同参数必须同结果"是硬要求，评测基线的可比性也建立在这上面。所以宁可多花那 100 多毫秒。
 *
 * 为什么精确 key 可以做到零损失：rgbToLab 内部就是 `SRGB_LIN[... r | 0]`，
 * 每个通道先截断成整数再查表 —— 也就是说 nearest(rgbToLab(r,g,b)) 本身就只依赖
 * 三个通道截断后的整数值。用 (r|0,g|0,b|0) 组成的 24bit key 因此是**无损**的，
 * 命中与不命中算出来的是同一个纯函数的同一个值。
 *
 * 抖动分支（strength > 0）的边界：误差扩散会逐格改 buf，记忆化只能按**当前值**查表。
 * 由于上面那条截断性质对当前值同样成立，抖动路径依然是逐位等价的（已用
 * scripts/verify/pattern-fingerprint.mjs 的 dither 配置逐位验证过）。
 * 需要说明的是**这条性质依赖 rgbToLab 的"先截断再查表"**：哪天 rgbToLab 改成插值，
 * 这个 key 就会退化成近似 —— 那时必须把 key 换成原始浮点值。
 * 另外 options.dither 默认是 off，三个方案的 variantParams 也全是 'off'，
 * 也就是说 99% 的调用根本走不到这个分支。
 *
 * 结构：定长开放寻址（一张 Int32Array 存 key+1，0 表示空；一张 Uint8Array 存下标）。
 * 槽位取 2^20：一次 100 万格的生成大约出现 8~9 万个不同颜色，2^20 槽的哈希冲突率
 * 只有个位数百分比，而内存只要 4 MB + 2 MB（相比之下"用 2^24 个槽直接寻址"要 16 MB
 * 且随机访问范围大一倍，缓存命中率反而更差）。命中失败只是重算一次，结果不受影响。
 */
const MEMO_SLOTS_BITS = 20
const MEMO_SLOTS = 1 << MEMO_SLOTS_BITS
/**
 * 低于这个格数就不值得开表：建表（含清空 4 MB）的成本比省下来的比较还多。
 *
 * 精确最近色（全量 ΔE00）比旧的 3 候选实现贵一个数量级，所以门槛从 65536
 * 降到 4096（64×64）：116×116 这类常用画布现在也能吃到记忆化，
 * 同一张图里重复的格子颜色只扫一次色板。
 */
const MEMO_MIN_CELLS = 4096
/**
 * 色号数超过这个值就关掉记忆化（只影响速度，不影响结果）。
 *
 * 下标用 Uint16Array 存：上限 MAX_TARGET_COLORS 从 221 提到 291 之后，
 * 下标最大 290 —— 用 Uint8Array 会**静默绕回**（290 & 255 = 34），
 * 表现是「色板换成 291 之后某些格子变成别的颜色」，所以这里必须 16 位。
 * 留到 512 是余量：图案色板理论上还可能被别的品牌（优肯 418 那种）撑大。
 */
const MEMO_MAX_COLORS = 512
let memoKeys = null
let memoVals = null

/** RGB（可以是浮点，rgbToLab 会先截断）→ 24bit key，截断/夹取口径与 rgbToLab 完全一致 */
function rgbKey(r, g, b) {
  let ri = r | 0, gi = g | 0, bi = b | 0
  if (ri < 0) ri = 0; else if (ri > 255) ri = 255
  if (gi < 0) gi = 0; else if (gi > 255) gi = 255
  if (bi < 0) bi = 0; else if (bi > 255) bi = 255
  return (ri << 16) | (gi << 8) | bi
}

/**
 * 包一层记忆化的最近色查询。返回的函数多收一个 key（第 5 个参数），
 * 直接调 nearestIndex / nearestIndexDE 时多传一个参数是无害的 ——
 * 所以 mapCells 里可以不分叉，统一按 5 个参数调用。
 */
function memoizedNearest(nearest) {
  if (!memoKeys) {
    memoKeys = new Int32Array(MEMO_SLOTS)
    /* ⚠️ Uint16Array，不能是 Uint8Array：色号下标会超过 255（见 MEMO_MAX_COLORS） */
    memoVals = new Uint16Array(MEMO_SLOTS)
  } else {
    /* 上一次生成留下的下标只对上一次的色板有意义，换色板复用会串色，必须清空。
       4 MB 的 fill 大约 1 ms，相对一次 100 万格生成可以忽略。 */
    memoKeys.fill(0)
  }
  const keys = memoKeys
  const vals = memoVals
  const shift = 32 - MEMO_SLOTS_BITS
  return (L, A, B, labs, key) => {
    // key+1 存进去，0 留给"空槽"；乘法哈希取高位（高位比低位分布均匀）
    const probe = key + 1
    const slot = Math.imul(probe, 2654435761) >>> shift
    if (keys[slot] === probe) return vals[slot]
    const idx = nearest(L, A, B, labs)
    keys[slot] = probe
    vals[slot] = idx
    return idx
  }
}

/**
 * 把采样色映射到色板索引。
 * 返回 { idx, adjacent, quantRgb }：
 *   - idx      最终每格颜色索引（含抖动结果）
 *   - adjacent 每格在「无抖动量化图」里的索引 —— 还原度按它算，
 *              这样抖动产生的有意识噪点不会被误判成"失真"
 *   - quantRgb 映射前的每格采样色（参考图）。⚠️ 抖动会用误差扩散改 `buf`，
 *              所以参考图必须在扩散之前就拷出来；否则参考会变成全黑，
 *              还原度会从 94% 掉到 20% —— 这正是「开了抖动还原度暴跌」的根因。
 */
function mapCells(cellRgb, labs, strength, gw, gh, palRgb, metric = 'de') {
  const n = gw * gh
  const idx = new Int32Array(n)
  const adjacent = new Int32Array(n)
  const quantRgb = Float32Array.from(cellRgb)
  const buf = Float32Array.from(cellRgb)
  const baseNearest = metric === 'lab' ? nearestIndex : nearestIndexDE
  const memo = n >= MEMO_MIN_CELLS && labs.length <= MEMO_MAX_COLORS
  const nearest = memo ? memoizedNearest(baseNearest) : baseNearest

  // ⚠️ 单位必须对齐：cells 里存的是 RGB(0~255)，labs 是 CIELAB。
  //    直接把 RGB 当 Lab 去比距离，三个分量的量级完全不匹配（L 只有 0~100，
  //    R 高达 255），最近色几乎恒定落在「a+b 最大」的那一个颜色上，
  //    于是整张图被映射成同一种颜色 —— 这正是「图案只有 1 种颜色」的根因。
  //    这里统一先把格子颜色转成 Lab 再比。
  const cellLab = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const lab = rgbToLab(buf[o], buf[o + 1], buf[o + 2])
    cellLab[o] = lab[0]
    cellLab[o + 1] = lab[1]
    cellLab[o + 2] = lab[2]
  }

  if (!strength) {
    for (let i = 0; i < n; i++) {
      const o = i * 3
      const k = nearest(cellLab[o], cellLab[o + 1], cellLab[o + 2], labs, rgbKey(cellRgb[o], cellRgb[o + 1], cellRgb[o + 2]))
      idx[i] = k
      adjacent[i] = k
    }
    return { idx, adjacent, quantRgb }
  }

  const spread = [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16]
  ]
  for (let y = 0; y < gh; y++) {
    const ltr = y % 2 === 0
    for (let xi = 0; xi < gw; xi++) {
      const x = ltr ? xi : gw - 1 - xi
      const i = y * gw + x
      const o = i * 3
      const r = buf[o], g = buf[o + 1], b = buf[o + 2]
      /* adjacent 用的是**采样原值**的 Lab（cellLab 在误差扩散开始前就算好了，是本格的原始色），
         所以记忆化 key 也必须取 cellRgb 而不是被扩散改过的 buf。 */
      const noDither = nearest(cellLab[o], cellLab[o + 1], cellLab[o + 2], labs, rgbKey(cellRgb[o], cellRgb[o + 1], cellRgb[o + 2]))
      adjacent[i] = noDither
      // 误差扩散过程中 buf 已经被改动，需要按当前值重新算 Lab
      const cur = rgbToLab(r, g, b)
      const k = nearest(cur[0], cur[1], cur[2], labs, rgbKey(r, g, b))
      idx[i] = k
      const po = k * 3
      const er = (r - palRgb[po]) * strength
      const eg = (g - palRgb[po + 1]) * strength
      const eb = (b - palRgb[po + 2]) * strength
      for (const [dx0, dy, w] of spread) {
        const dx = ltr ? dx0 : -dx0
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || xx >= gw || yy >= gh) continue
        const j = (yy * gw + xx) * 3
        buf[j] += er * w
        buf[j + 1] += eg * w
        buf[j + 2] += eb * w
      }
    }
  }
  return { idx, adjacent, quantRgb }
}

/* Lab → RGB 反查：把色板颜色的真实 RGB 预先摊平，抖动误差扩散时直接用，
   避免走 Lab 逆变换带来的往返误差 */
function paletteRgb(palette) {
  const out = new Float32Array(palette.length * 3)
  for (let i = 0; i < palette.length; i++) {
    const o = i * 3
    out[o] = palette[i].rgb[0]
    out[o + 1] = palette[i].rgb[1]
    out[o + 2] = palette[i].rgb[2]
  }
  return out
}

/* ---------------------------------------------------------------- 后处理 */

function countByIndex(idx, paletteLen) {
  const c = new Int32Array(paletteLen)
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i]
    if (k < 0) continue // 空格
    c[k]++
  }
  return c
}

/** 稀有色合并：把用量过少的颜色并进最接近的主色，减少换色次数。
 *
 *  这里有一道「感知护栏」：只有当零星色与目标主色的 ΔE00 足够小（肉眼几乎分不出）
 *  才合并。否则保留 —— 否则一颗眼睛、一道轮廓线这种「只用了 1~2 颗但很关键」的颜色
 *  会被并掉，色号是省了，图也毁了。 */
function mergeRare(idx, labs, minCount, maxDE = MERGE_MAX_DE) {
  const counts = countByIndex(idx, labs.length)
  const kept = []
  const rare = []
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] <= 0) continue
    if (counts[i] >= minCount) kept.push(i)
    else rare.push(i)
  }
  if (!kept.length) {
    let bi = 0
    for (let i = 0; i < counts.length; i++) if (counts[i] > counts[bi]) bi = i
    kept.push(bi)
  }

  const remap = new Int32Array(labs.length).fill(-1)
  for (const k of kept) remap[k] = k
  let remapped = 0
  for (const i of rare) {
    if (remap[i] >= 0) continue
    /* 选目标色与「最近色号」同一口径：全量 CIEDE2000。
       用 Lab 欧氏距离选、再用 ΔE00 判护栏，会挑到「Lab 最近但肉眼更远」的主色，
       等于在合并这一步又引入一次非最优映射。 */
    let best = kept[0], bd = Infinity
    for (const k of kept) {
      const d = deltaE2000(labs[i], labs[k])
      if (d < bd) { bd = d; best = k }
    }
    if (bd > maxDE) {
      // 差得太明显，宁可多一个色号也要留住它
      kept.push(i)
      remap[i] = i
      continue
    }
    remap[i] = best
    remapped += counts[i]
  }
  if (!remapped) return { idx, remapped: 0 }
  const next = new Int32Array(idx.length)
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i]
    if (k < 0) { next[i] = EMPTY; continue } // 空格保持空格，别被合并成一颗豆
    next[i] = remap[k] >= 0 ? remap[k] : k
  }
  return { idx: next, remapped }
}

/**
 * 去孤立豆（PRD §15.4）：四邻无同色时改成邻居里出现最多的颜色。
 * 返回修正颗数，方便 UI 如实告诉用户「本次修正了 N 颗」。
 *
 * 同样加了感知护栏（maxDE）：只有「换过去几乎看不出差别」时才修。
 * 拼豆图里真正扎眼的孤立豆，多半是残留的过渡色 / 噪点，它们和邻居的色差本来就很小；
 * 而眼睛、轮廓、文字这类有意为之的孤点，色差很大，必须原样保留。
 */
export function cleanupIsolated(idx, gw, gh, labs, maxDE = CLEANUP_MAX_DE) {
  const out = Int32Array.from(idx)
  let changed = 0
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x
      const self = out[i]
      if (self === EMPTY) continue // 空格不是豆，谈不上孤立
      const ns = [out[i - 1], out[i + 1], out[i - gw], out[i + gw]]
      let same = false
      for (const v of ns) if (v === self) { same = true; break }
      if (same) continue
      // 空格邻居不参与投票：主体外侧的空白不该影响里面那颗豆的颜色
      const tally = new Map()
      for (const v of ns) {
        if (v === EMPTY) continue
        tally.set(v, (tally.get(v) || 0) + 1)
      }
      if (!tally.size) continue // 周围全是空格：这是一颗有意留下的孤豆，保留
      let best = -1, bc = -1
      for (const [k, c] of tally) if (c > bc) { bc = c; best = k }
      if (labs && labs[self] && labs[best] && deltaE2000(labs[self], labs[best]) > maxDE) continue
      out[i] = best
      changed++
    }
  }
  return { idx: out, changed }
}

/** 色阶概括：把颜色通道按步进取整，做出「艺术版」的分明色块 */
function posterizeRgb(cellRgb, step) {
  if (!step) return cellRgb
  const out = Float32Array.from(cellRgb)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] / step) * step
  return out
}

/** 对比度 / 饱和度微调（好拼版略微加强，抵消有限色板的发灰） */
function toneRgb(cellRgb, saturate, contrast) {
  if (saturate === 1 && contrast === 1) return cellRgb
  const out = Float32Array.from(cellRgb)
  for (let i = 0; i < out.length; i += 3) {
    let r = out[i], g = out[i + 1], b = out[i + 2]
    if (contrast !== 1) {
      r = (r - 128) * contrast + 128
      g = (g - 128) * contrast + 128
      b = (b - 128) * contrast + 128
    }
    if (saturate !== 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      r = gray + (r - gray) * saturate
      g = gray + (g - gray) * saturate
      b = gray + (b - gray) * saturate
    }
    out[i] = Math.max(0, Math.min(255, r))
    out[i + 1] = Math.max(0, Math.min(255, g))
    out[i + 2] = Math.max(0, Math.min(255, b))
  }
  return out
}

/* ---------------------------------------------------------------- 评分 */

/**
 * 可拼性评分（PRD §15.6）
 * BuildabilityScore = 0.25*孤立豆 + 0.20*换色次数 + 0.20*色块连贯 + 0.20*轮廓 + 0.15*颜色数
 * 全部指标由真实网格数据算出，不写死。
 */
export function buildability(idx, gw, gh, colorCount) {
  const n = gw * gh
  if (!n) return { score: 0, isolation: 0, transitions: 0, isolatedCount: 0, smallRegionRatio: 0, outline: 0, colorCount: 0, paletteScore: 0 }

  let isolated = 0
  let transitions = 0
  let samePairs = 0
  /* 空格（不放豆）不参与任何统计：
     它们既不是孤立豆，也不构成"换色"，更不该算进分母 ——
     否则抠掉一半背景后，孤立豆比例会被凭空稀释，可拼性分数虚高。 */
  let beads = 0
  /* 这里原来还有一张 `const regionSize = new Int32Array(n)`，从头到尾没有任何地方用它 ——
     100 万格就是每次调用白分配 4 MB，还要把这块内存交给 GC 反复回收。
     连通块大小是用下面的 flood fill 现算的（size 变量），不需要预先分配。 */
  const stack = new Int32Array(n)

  // 一次遍历同时统计孤立豆与相邻换色
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const self = idx[i]
      if (self === EMPTY) continue
      beads++
      /* 四邻居用四个局部变量直比，**不要**写成 `const nb = [a,b,c,d]`：
         那等于每格新建一个 4 元素数组，100 万格就是 100 万次数组分配 + 一次迭代器分配，
         是这条主循环里最贵的一笔开销（V8 逃逸分析救不了 for...of 的迭代器）。
         计数口径与数组版完全一致：越界邻居按 EMPTY 处理（EMPTY 不落进任何一支），
         是自身色就 samePairs++、是别的豆子才 transitions++。 */
      const left = x > 0 ? idx[i - 1] : EMPTY
      const right = x < gw - 1 ? idx[i + 1] : EMPTY
      const up = y > 0 ? idx[i - gw] : EMPTY
      const down = y < gh - 1 ? idx[i + gw] : EMPTY
      let hasSame = false
      if (left === self) { hasSame = true; samePairs++ } else if (left !== EMPTY) transitions++
      if (right === self) { hasSame = true; samePairs++ } else if (right !== EMPTY) transitions++
      if (up === self) { hasSame = true; samePairs++ } else if (up !== EMPTY) transitions++
      if (down === self) { hasSame = true; samePairs++ } else if (down !== EMPTY) transitions++
      if (!hasSame) isolated++
    }
  }

  // 连通块大小（用于「小色块密度」）
  const seen = new Uint8Array(n)
  let smallPixels = 0
  for (let s = 0; s < n; s++) {
    if (seen[s] || idx[s] === EMPTY) continue
    const color = idx[s]
    let sp = 0
    let size = 0
    stack[sp++] = s
    seen[s] = 1
    while (sp > 0) {
      const cur = stack[--sp]
      size++
      const cx = cur % gw
      const cy = (cur - cx) / gw
      if (cx > 0) { const k = cur - 1; if (!seen[k] && idx[k] === color) { seen[k] = 1; stack[sp++] = k } }
      if (cx < gw - 1) { const k = cur + 1; if (!seen[k] && idx[k] === color) { seen[k] = 1; stack[sp++] = k } }
      if (cy > 0) { const k = cur - gw; if (!seen[k] && idx[k] === color) { seen[k] = 1; stack[sp++] = k } }
      if (cy < gh - 1) { const k = cur + gw; if (!seen[k] && idx[k] === color) { seen[k] = 1; stack[sp++] = k } }
    }
    if (size <= 3) smallPixels += size
  }

  // 轮廓保留：高对比局部邻域在量化后是否仍保持对比（人物/宠物/文字最怕轮廓糊掉）
  let outlineTotal = 0
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x
      const v = idx[i]
      if (v === EMPTY) continue
      if (idx[i - 1] !== v || idx[i + 1] !== v || idx[i - gw] !== v || idx[i + gw] !== v) outlineTotal++
    }
  }

  const base = Math.max(1, beads)
  const isolationScore = 1 - Math.min(1, isolated / (base * 0.09))
  const transitionScore = 1 - Math.min(1, transitions / Math.max(1, 4 * base) / 0.3)
  const regionScore = 1 - Math.min(1, smallPixels / (base * 0.09))
  const outlineScore = 1 - Math.min(1, outlineTotal / (base * 0.55))
  const paletteScore = 1 - Math.min(1, Math.max(0, colorCount - 8) / 24)

  const score =
    0.25 * isolationScore +
    0.2 * transitionScore +
    0.2 * regionScore +
    0.2 * outlineScore +
    0.15 * paletteScore

  return {
    score: Math.round(Math.max(0, Math.min(1, score)) * 100),
    isolation: isolationScore,
    transitionScore,
    regionScore,
    outlineScore,
    paletteScore,
    isolatedCount: isolated,
    transitions,
    smallRegionRatio: smallPixels / base,
    beadCount: beads,
    colorCount
  }
}

/**
 * 还原度：与「无抖动量化图」的邻域平均色做平均 CIEDE2000。
 * 用邻域平均是刻意的 —— 拼豆是颗粒介质，单格取色必然有偏差，
 * 人眼在正常观看距离看到的是邻域平均色，这个指标才对应"看起来像不像"。
 */
export function similarityOf(idx, palette, quantRgb, gw, gh) {
  const n = gw * gh
  if (!n) return { similarity: 0, deltaE: 99 }

  let sum = 0
  let count = 0
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      // 空格处本来就不放豆，既不参与评分，也不参与参考图的邻域平均
      if (idx[i] < 0) continue
      let sr = 0, sg = 0, sb = 0, c = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= gh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= gw) continue
          const ii = yy * gw + xx
          // 参考图同样只看主体：抠掉背景之后，主体边缘不该被"已经决定不放豆"
          // 的那片背景拉浅，否则轮廓一圈的还原度会被冤枉地算低
          if (idx[ii] < 0) continue
          const j = ii * 3
          sr += quantRgb[j]; sg += quantRgb[j + 1]; sb += quantRgb[j + 2]; c++
        }
      }
      if (!c) continue
      const ref = rgbToLab(sr / c, sg / c, sb / c)
      sum += deltaE2000(palette[idx[i]].lab, ref)
      count++
    }
  }
  const dE = count ? sum / count : 99
  return { similarity: deltaEToSimilarity(dE), deltaE: dE }
}

/** 预计拼制时间：豆子越多越慢，可拼性越好越快 */
export function estimateMinutes(beadCount, buildScore) {
  const perMinute = 17 + (buildScore / 100) * 12
  return Math.max(1, Math.round(beadCount / perMinute))
}

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`
}

export function difficultyOf(buildScore, beadCount) {
  if (buildScore >= 88 && beadCount <= 900) return '入门'
  if (buildScore >= 80 && beadCount <= 2200) return '简单'
  if (buildScore >= 68) return '进阶'
  return '挑战'
}

/* ---------------------------------------------------------------- 生成 */

/**
 * 纯核心：给定「每格已取好的颜色」，产出完整图案（量化 → 映射 → 后处理 → 评分）。
 * 与 DOM 无关，因此可以在 Node 里跑回归评测（scripts/fidelity/bench.mjs）——
 * 算法改动有没有真的变好，靠的是同一批测试图跑出来的数字，而不是感觉。
 *
 * @param {Float32Array} cellRgbRaw gw*gh*3 的每格颜色
 * @param {object} opts gw, gh, targetColors, variantKey, brandId, colors, variantParams
 */
export function generateFromCells(cellRgbRaw, opts = {}) {
  const {
    gw, gh, targetColors = 16, variantKey = 'easy',
    brandId = DEFAULT_BRAND_ID, colors, variantParams: vpOverride, coverage, matte, cartoon
  } = opts
  if (!(gw > 0) || !(gh > 0)) throw new Error('画布尺寸不合法')

  const paletteAll = colors && colors.length ? colors : getColors(brandId)
  const vp = vpOverride || variantParams(variantKey, targetColors)

  /* 空格：抠背景之后「主体之外」的格子。
     阈值越小越保守（留下的豆越多），档位会覆盖它。 */
  const emptyShare = opts.emptyShare != null ? opts.emptyShare : (vp.emptyShare != null ? vp.emptyShare : EMPTY_SHARE)
  const empty = coverage ? buildEmptyMask(coverage, emptyShare) : null
  const keep = empty ? buildKeepMask(empty) : null

  /* 选色口径：opts.quantMetric 是显式覆盖（'lab' / 'de'），
     'auto' 与不传都表示「跟随方案」——「高还原」档在 variantParams 里就写着 quantMetric:'de'，
     好拼版/艺术版没写，于是仍然是原来的 Lab 欧氏距离（行为一个字都没变）。
     以前这里直接 `opts.quantMetric || 'lab'`，把 vp.quantMetric 整个丢掉了 ——
     于是"方案自带口径"这件事根本没生效过。 */
  const metric = opts.quantMetric && opts.quantMetric !== 'auto' ? opts.quantMetric : (vp.quantMetric || 'lab')
  const chosen = (opts.quantizer || quantize)(cellRgbRaw, vp.cap, paletteAll, metric, keep)
  const labs = buildLabCache(chosen)

  let workRgb = cellRgbRaw
  if (vp.saturate !== 1 || vp.contrast !== 1) workRgb = toneRgb(workRgb, vp.saturate, vp.contrast)
  if (vp.posterize) workRgb = posterizeRgb(workRgb, vp.posterize)

  const strength = typeof vp.dither === 'number' ? vp.dither : (DITHER_STRENGTH[vp.dither] || 0)
  const { idx, adjacent, quantRgb } = mapCells(
    workRgb, labs, strength, gw, gh, paletteRgb(chosen), vp.assign || 'de'
  )

  /* 先把空格打上标记，再做后处理：
     合并零星色 / 去孤立豆都跳过空格，否则空背景里会凭空长出豆子。 */
  let finalIdx = idx
  if (empty) {
    for (let i = 0; i < finalIdx.length; i++) {
      if (!empty[i]) continue
      finalIdx[i] = EMPTY
      adjacent[i] = EMPTY
    }
  }

  const notes = []
  if (cartoon) {
    notes.push(`已按「${cartoon.styleLabel || '卡通'}」风格卡通化：${cartoon.levels} 个平涂色块、特征保留 ${Math.round((cartoon.structure ?? 1) * 100)}%`)
  }
  if (matte && matte.applied && !matte.auto) {
    const pct = Math.round((matte.bgShare || 0) * 100)
    notes.push(`已去除背景约 ${pct}%，背景位置不放豆`)
    if (matte.cropped) notes.push('已自动裁到主体范围')
  } else if (matte && !matte.applied && matte.reason) {
    notes.push(`未抠背景：${matte.reason}`)
  }

  if (vp.mergeRatio) {
    const minCount = Math.max(2, Math.round(gw * gh * vp.mergeRatio))
    const merged = mergeRare(finalIdx, labs, minCount, vp.mergeMaxDE ?? MERGE_MAX_DE)
    finalIdx = merged.idx
    if (merged.remapped) notes.push(`合并了 ${merged.remapped} 颗零星色`)
  }
  if (vp.cleanup) {
    const cleaned = cleanupIsolated(finalIdx, gw, gh, labs, vp.cleanupMaxDE ?? CLEANUP_MAX_DE)
    finalIdx = cleaned.idx
    if (cleaned.changed) notes.push(`修正 ${cleaned.changed} 颗孤立豆`)
  }

  // 只保留真正用到的颜色，并重映射索引（保证 palette 里没有死色）
  const counts = countByIndex(finalIdx, chosen.length)
  const keepMap = new Int32Array(chosen.length).fill(-1)
  const palette = []
  for (let i = 0; i < chosen.length; i++) {
    if (counts[i] > 0) {
      keepMap[i] = palette.length
      palette.push(chosen[i])
    }
  }
  const cells = new Int32Array(finalIdx.length)
  for (let i = 0; i < finalIdx.length; i++) {
    const k = finalIdx[i]
    cells[i] = k < 0 ? EMPTY : (keepMap[k] >= 0 ? keepMap[k] : EMPTY)
  }

  const beadCount = beadCountOf(cells)
  const emptyCount = cells.length - beadCount
  const colorCount = palette.length
  const build = buildability(cells, gw, gh, colorCount)

  /* 自动按源图透明通道留空的说明放在这里：空格数要等上面算完才知道，
     写在前面只能给一句"已去背景"，用户看到的却是"背景没了、豆子少了 N 颗"，
     数字对不上就会怀疑少算了豆子。 */
  if (matte && matte.auto) {
    const pct = cells.length ? Math.round((emptyCount / cells.length) * 100) : 0
    notes.unshift(`源图自带透明背景：已按透明区域留空 ${emptyCount} 格（占画布 ${pct}%，这些位置不放豆）`)
  }
  /* 还原度按「无抖动量化图」算（见 mapCells 的说明）：
     抖动是有意加噪，如果拿抖动后的图去比，分数会从 94% 掉到 21%，
     而人眼看到的其实是更接近原图的过渡 —— 那是个纯粹的指标 bug，不是画质变差。 */
  const useAdjacent = strength !== 0 && adjacent
  const { similarity, deltaE } = useAdjacent
    ? similarityOf(adjacent, chosen, quantRgb, gw, gh)
    : similarityOf(cells, palette, quantRgb, gw, gh)
  const minutes = estimateMinutes(beadCount, build.score)

  return {
    version: PATTERN_VERSION,
    width: gw,
    height: gh,
    brandId,
    mode: variantKey,
    /* 板 / 豆径口径（见 lib/boardSpec.js）：分板线、材料克重、成品厘米、1:1 打印
       全部读这两个字段，而不是各自的写死值 —— 52 钉板 + 2.6mm 小豆与 29 格 + 5mm
       中号豆的成品尺寸差一倍，口径散在各处必然对不上。 */
    ...patternProfile(gw, gh, opts.boardSize, opts.beadKey),
    cells,
    palette,
    colors: palette.map(p => p.id),
    /* 抠图结果摘要：界面要如实告诉用户「去了多少背景 / 为什么没生效」 */
    matte: matte
      ? {
        applied: !!matte.applied,
        ok: !!matte.ok,
        bgShare: Math.round((matte.bgShare || 0) * 1000) / 1000,
        /** 其中投影（阴影）占多大比例：界面用它说明"连影子一起去掉了" */
        shadowShare: Math.round((matte.stats && matte.stats.shadowShare || 0) * 1000) / 1000,
        /** 阴影清除是否因为"可能吃到主体"被整体回滚 */
        shadowRolledBack: !!(matte.stats && matte.stats.shadowRolledBack),
        confidence: Math.round((matte.confidence || 0) * 100) / 100,
        cropped: !!matte.cropped,
        /** true = 没有用户开关，是「源图自带透明背景」自动生效的（界面要说清这一点） */
        auto: !!matte.auto,
        reason: matte.reason || ''
      }
      : null,
    /* 卡通化结果摘要：界面按这些真实数字说明"做了什么"（见 lib/cartoon.js） */
    cartoon: cartoon || null,
    stats: {
      beadCount,
      /** 画布总格数（含不放豆的位置） */
      cellCount: cells.length,
      emptyCount,
      emptyRatio: cells.length ? Math.round((emptyCount / cells.length) * 1000) / 1000 : 0,
      colorCount,
      similarity: Math.round(similarity * 1000) / 1000,
      deltaE: Math.round(deltaE * 100) / 100,
      buildability: build.score / 100,
      isolatedCount: build.isolatedCount,
      smallRegionRatio: Math.round(build.smallRegionRatio * 1000) / 1000,
      estimatedMinutes: minutes
    },
    notes
  }
}

/** 覆盖率 → 空格掩膜（1 = 不放豆） */
function buildEmptyMask(coverage, emptyShare) {
  const out = new Uint8Array(coverage.length)
  for (let i = 0; i < coverage.length; i++) out[i] = coverage[i] < emptyShare ? 1 : 0
  return out
}

/** 空格掩膜 → 反向保留掩膜（选色用） */
function buildKeepMask(empty) {
  const out = new Uint8Array(empty.length)
  for (let i = 0; i < empty.length; i++) out[i] = empty[i] ? 0 : 1
  return out
}

/**
 * 纯核心入口：直接从 RGBA 像素生成图案（Node 评测与浏览器共用同一条路径）。
 * opts.removeBg 打开时会先抠背景：拿主体包围盒当采样窗口，并把每格覆盖率带下去。
 *
 * 卡通化（opts.cartoonStyle）**发生在取每格颜色之前**：它先把照片概括成平涂色块 +
 * 轮廓线，再由拼豆引擎取样量化。直接传像素进来（Node 评测 / 单张调用）时会在这里做；
 * 浏览器入口（generateVariant / generateVariants）已经把卡通化结果与 meta 备好，
 * 通过 opts.cartoon 传进来，避免同一张图重复算。抠背景仍在**原图**上做（见 cartoon.js 说明）。
 */
export function generateFromPixels(src, sw, sh, opts = {}) {
  const { gw, gh, fit = 'contain', supersample, voteMinShare } = opts

  let pixels = src
  let cartoon = opts.cartoon || null
  if (opts.cartoonStyle && !cartoon) {
    const c = cartoonize(src, sw, sh, { style: opts.cartoonStyle })
    pixels = c.data
    cartoon = c.meta
  }

  let matte = opts.matte || null
  if (!matte && !opts.alphaChecked) {
    /* 纯函数调用方（Node 评测 / 单张调用）也要拿到同一条保证：
       源图自带透明背景 ⇒ 透明处就是空格。以前这条只在浏览器入口做，
       于是同一个缺陷还有第二个出口 —— 直接调 generateFromPixels 会得到一整片白豆。
       注意用的是**原始** src（卡通化已经把 alpha 抹成 255，那一路的掩膜由入口传进来）。 */
    matte = resolveMatte({
      data: src,
      width: sw,
      height: sh,
      transparent: hasTransparency(src)
    }, opts)
  }
  const applied = !!(matte && matte.ok && matte.alpha)
  if (matte) {
    matte = {
      ...matte,
      applied,
      cropped: applied && !!(matte.bbox && opts.autoCrop !== false)
    }
  }

  /* 超采样倍率：
     · opts.supersample 是**显式的实验开关**（评测脚本用它扫倍率、做对照），原样尊重；
     · 自动档才按源图真实分辨率封顶 —— 原因见 maxUsefulSupersample 的说明。
     抠背景会先用主体包围盒把采样窗口收窄，封顶必须按**收窄后**的尺寸算，
     否则一张大图里的小主体会被误判成"源像素很富余"。这里的 rx/ry/rw/rh 与
     resampleRGBA 内部对 srcRect 的取整口径保持一致。 */
  const rect = applied && matte.bbox ? matte.bbox : null
  const rx = rect ? Math.max(0, Math.min(sw - 1, Math.floor(rect.x))) : 0
  const ry = rect ? Math.max(0, Math.min(sh - 1, Math.floor(rect.y))) : 0
  const rw = rect ? Math.max(1, Math.min(sw - rx, Math.round(rect.w))) : sw
  const rh = rect ? Math.max(1, Math.min(sh - ry, Math.round(rect.h))) : sh
  const SS = supersample || Math.min(supersampleFactor(gw, gh), maxUsefulSupersample(rw, rh, gw, gh, fit))

  const { rgb, coverage } = sampleCellsMatted(
    pixels, sw, sh, gw, gh, fit, SS, voteMinShare ?? VOTE_MIN_SHARE,
    applied ? matte : null,
    null
  )
  /* 档位同时决定「一格里主体占多少才留豆」：
     保守档更容易留豆（阈值低），激进档会削掉更多边缘格。 */
  const level = matteLevel(opts.matteLevel)
  return generateFromCells(rgb, {
    ...opts,
    cartoon,
    coverage,
    matte,
    emptyShare: applied ? level.emptyShare : undefined
  })
}

/**
 * 卡通化缓存：key 是 <img> 对象本身。
 * 同一张图在调参数（颜色数 / 色板 / 尺寸）时会被反复生成，而卡通化只跟
 * 「源图 + 风格」有关 —— 不缓存的话每拖一次滑块都要重算一遍（几十到一百多毫秒）。
 * 换图 ⇒ 新的 Image 对象 ⇒ 缓存自然失效。
 */
const cartoonCache = new WeakMap()

function cartoonPixels(img, px, style) {
  const key = img && typeof img === 'object' ? img : null
  if (key) {
    const hit = cartoonCache.get(key)
    if (hit && hit.style === style && hit.width === px.width && hit.height === px.height) return hit
  }
  const c = cartoonize(px.data, px.width, px.height, { style })
  const entry = { style, width: px.width, height: px.height, data: c.data, meta: c.meta }
  if (key) cartoonCache.set(key, entry)
  return entry
}

/** 源图像素 → 送进生成的像素（开了卡通化就是卡通图，尺寸不变、与 alpha 图对齐） */
function resolveSource(img, px, opts) {
  if (!opts.cartoonStyle) return { pixels: px, cartoon: null }
  const c = cartoonPixels(img, px, opts.cartoonStyle)
  return { pixels: c, cartoon: c.meta }
}

/**
 * 这一张图要不要抠背景、用哪张掩膜。两个来源：
 *   · 用户手动打开「智能抠图」→ 按颜色模型估（源图自带 alpha 时 estimateMatte 内部会直接用 alpha）；
 *   · 源图自带透明背景（贴纸 / 免抠素材）→ **自动**用 alpha，不再要求用户多点一次开关：
 *     透明区域本来就等于"这一格不放豆"，让用户为此多按一个开关、按了还可能被颜色模型
 *     判错一次（白色背景上的浅色主体是最容易判错的场景），没有任何道理。
 *
 * 返回 null = 不抠，整张画布都用豆子拼。
 */
function resolveMatte(px, opts) {
  const want = !!opts.removeBg
  if (!want && !px.transparent) return null
  const m = estimateMatte(px.data, px.width, px.height, { level: opts.matteLevel })
  if (want) return m
  /* 自动档**只认 alpha 分支**：透明像素占比刚好在 1.5% 门槛附近浮动时，
     颜色模型给出的是一份"猜测"，而这张图本来就有确切的 alpha —— 宁可不抠。 */
  if (!(m && m.ok && m.stats && m.stats.transparent)) return null
  return { ...m, auto: true }
}

/**
 * 生成单个方案（浏览器入口）。
 * @param {object} opts
 *   img, gw, gh, fit, targetColors, variantKey, brandId, dither, cleanup, enhance, posterize,
 *   removeBg, matteLevel, cartoonStyle
 */
export function generateVariant(opts) {
  const { img, gw, gh, fit = 'contain' } = opts

  // 源图必须已经解码完成。否则取像素会得到一张全白的图，
  // 生成"成功"但结果是空白，且不报错 —— 这里提前拦住并给出可读的原因。
  const sw = img && (img.naturalWidth || img.width)
  const sh = img && (img.naturalHeight || img.height)
  if (!sw || !sh) {
    throw new Error('图片还没解码完成，请稍后重试')
  }

  const px = readImagePixels(img)
  const matte = resolveMatte(px, opts)
  const src = resolveSource(img, px, opts)
  return generateFromPixels(src.pixels.data, px.width, px.height, {
    ...opts, gw, gh, fit, matte, cartoon: src.cartoon, alphaChecked: true
  })
}

/**
 * 主入口：一次生成 1~3 个方案，并挑出推荐方案。
 * 推荐逻辑（PRD §6 差异化 1）：不追求还原度最高，而是找
 * 「还原度够高 + 可拼性明显更好 + 豆子数量合理」的 Pareto 点。
 *
 * 注意：读像素 + 抠背景只做一次，三个方案共用 —— 抠图是这个流程里最贵的一步，
 * 每个方案各抠一遍会白白多花两三倍时间。
 */
export function generateVariants(opts) {
  const keys = opts.variantKeys || ['easy']
  const sw = opts.img && (opts.img.naturalWidth || opts.img.width)
  const sh = opts.img && (opts.img.naturalHeight || opts.img.height)
  if (!sw || !sh) throw new Error('图片还没解码完成，请稍后重试')
  const px = readImagePixels(opts.img)
  const matte = resolveMatte(px, opts)
  // 卡通化也只做一次，三个方案共用（和抠图同理）
  const src = resolveSource(opts.img, px, opts)

  const patterns = []
  for (const key of keys) {
    const p = generateFromPixels(src.pixels.data, px.width, px.height, {
      ...opts, matte, cartoon: src.cartoon, variantKey: key, alphaChecked: true
    })
    const meta = VARIANT_META.find(v => v.key === key) || VARIANT_META[1]
    patterns.push({
      ...p,
      key,
      label: meta.label,
      tagline: meta.tagline,
      desc: meta.desc
    })
  }

  const recommended = pickRecommended(patterns)
  const baseline = patterns.find(p => p.key === 'high') || patterns[0]
  const list = patterns.map(p => ({
    ...p,
    recommended: p.key === recommended.key,
    compare: compareTo(p, baseline)
  }))

  return { patterns: list, recommendedKey: recommended.key, baselineKey: baseline.key }
}

/** 推荐打分：还原度、可拼性、颜色数、豆数四个维度加权 */
function pickRecommended(patterns) {
  if (patterns.length === 1) return patterns[0]
  let best = patterns[0]
  let bestScore = -Infinity
  for (const p of patterns) {
    const s = p.stats
    const value =
      s.similarity * 0.34 +
      (s.buildability) * 0.44 +
      (1 - Math.min(1, Math.max(0, s.colorCount - 8) / 24)) * 0.14 +
      (1 - Math.min(1, s.beadCount / 8000)) * 0.08
    if (value > bestScore) { bestScore = value; best = p }
  }
  return best
}

/** 与基准方案（高还原）的对比说明，用来回答「为什么推荐这个方案」 */
function compareTo(p, base) {
  if (p.key === base.key) return null
  const pct = (a, b) => {
    if (!b) return 0
    return Math.round(((a - b) / b) * 100)
  }
  return {
    colorDelta: pct(p.stats.colorCount, base.stats.colorCount),
    beadDelta: pct(p.stats.beadCount, base.stats.beadCount),
    isolatedDelta: pct(p.stats.isolatedCount, base.stats.isolatedCount),
    buildDelta: Math.round((p.stats.buildability - base.stats.buildability) * 100),
    similarityDelta: Math.round((p.stats.similarity - base.stats.similarity) * 1000) / 10
  }
}

/* ---------------------------------------------------------------- 派生数据 */

export function materialList(pattern, inventoryMap) {
  const counts = new Map()
  for (let i = 0; i < pattern.cells.length; i++) {
    const k = pattern.cells[i]
    if (k < 0) continue // 空格不放豆，不进材料表
    const c = pattern.palette[k]
    if (!c) continue
    const e = counts.get(c.id) || { color: c, count: 0 }
    e.count++
    counts.set(c.id, e)
  }
  const rows = [...counts.values()]
    .map(({ color, count }) => {
      const owned = inventoryMap ? Number(inventoryMap[color.id] || 0) : 0
      const lack = Math.max(0, count - owned)
      return {
        id: color.id,
        code: color.code,
        brandId: color.brandId,
        name: color.name && color.name !== color.code ? color.name : '',
        label: color.name && color.name !== color.code ? `${color.code} · ${color.name}` : color.code,
        hex: color.hex,
        count,
        owned,
        lack
      }
    })
    .sort((a, b) => b.count - a.count)

  const totalBeads = rows.reduce((s, r) => s + r.count, 0)
  const totalLack = rows.reduce((s, r) => s + r.lack, 0)
  return {
    rows,
    totalBeads,
    totalLack,
    colorCount: rows.length,
    weight: Math.round(totalBeads * (pattern.beadWeightG || BEAD_WEIGHT_G))
  }
}

/**
 * 按板切分画布。
 *
 * boardSize 可以是数字（老调用）或 {x, y}，缺省按画布尺寸推导
 * （boardSpecFor：104 格是 1 块 104 板，156 格是 2 块 78 板…）。
 * **整张画布只有一种规格**：暂不混拼（同珠径的板钉距一样、并排摆图案是连着的，但接缝位置不规律、能不能卡扣要按实物确认，见 boardSpec.js），
 * 混着摆最外圈必然留空，所以 {x, y} 里 x ≠ y 的旧数据会被收敛掉（见 boardSpec.js）。
 */
export function boardLayout(width, height, boardSize = BOARD_SIZE) {
  const bs = normalizeBoardSize(boardSize, width, height)
  const cols = Math.ceil(width / bs.x)
  const rows = Math.ceil(height / bs.y)
  const boards = []
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * bs.x
      const y0 = by * bs.y
      const w = Math.min(bs.x, width - x0)
      const h = Math.min(bs.y, height - y0)
      boards.push({
        index: boards.length,
        no: boards.length + 1,
        col: bx,
        row: by,
        x0,
        y0,
        w,
        h,
        cells: w * h,
        label: `第 ${boards.length + 1} 板`,
        coord: `${bx + 1} 列 ${by + 1} 行`,
        isFirst: bx === 0 && by === 0
      })
    }
  }
  return { cols, rows, count: boards.length, boards, boardSize: bs, boardW: bs.x, boardH: bs.y }
}

/** 每块板各自的颜色用量（分板材料表用） */
export function boardMaterials(pattern, board, inventoryMap) {
  const counts = new Map()
  for (let y = board.y0; y < board.y0 + board.h; y++) {
    for (let x = board.x0; x < board.x0 + board.w; x++) {
      const k = pattern.cells[y * pattern.width + x]
      if (k < 0) continue
      const c = pattern.palette[k]
      if (!c) continue
      counts.set(c.id, (counts.get(c.id) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => {
      const color = pattern.palette.find(p => p.id === id)
      return {
        id,
        code: color.code,
        brandId: color.brandId,
        name: color.name !== color.code ? color.name : '',
        hex: color.hex,
        count,
        owned: inventoryMap ? Number(inventoryMap[id] || 0) : 0,
        lack: Math.max(0, count - (inventoryMap ? Number(inventoryMap[id] || 0) : 0))
      }
    })
    .sort((a, b) => b.count - a.count)
}

/**
 * 每块板真正要放的豆数（空格不算），按 layout.boards 的顺序返回。
 * 界面上「第 N 板 841 颗」是按板子容量算的，抠掉背景之后会虚高，必须用这个数。
 */
export function boardBeadCounts(pattern, layout) {
  return layout.boards.map(b => {
    let n = 0
    for (let y = b.y0; y < b.y0 + b.h; y++) {
      for (let x = b.x0; x < b.x0 + b.w; x++) {
        if (pattern.cells[y * pattern.width + x] >= 0) n++
      }
    }
    return n
  })
}

/* ---------------------------------------------------------------- 库存约束 */
/**
 * 库存约束重新配色（PRD §6 差异化 3 / §13 Flow D）
 * mode:
 *   'strict'   完全不补购 —— 只能用已有颜色（没设库存则不限制）
 *   'mincost'  补购最少 —— 优先用已有色，不足时允许少量补购（按缺的颗数排）
 *   'best'     最高还原度 —— 忽略库存，用完整色板
 */
export function applyInventory(pattern, inventoryColors, inventoryMap, mode = 'strict') {
  const allow = mode === 'best' ? null : inventoryColors
  if (!allow || !allow.length) {
    return { pattern, applied: false, replaced: 0, mode }
  }
  const pool = allow
  const labs = buildLabCache(pool)

  const remap = new Map()
  let replaced = 0
  const counts = new Map()
  for (let i = 0; i < pattern.cells.length; i++) {
    const k = pattern.cells[i]
    if (k < 0) continue
    const cur = pattern.palette[k]
    if (!cur) continue
    counts.set(cur.id, (counts.get(cur.id) || 0) + 1)
  }

  for (const [id, count] of counts) {
    if (pool.some(p => p.id === id)) { remap.set(id, id); continue }
    const cur = pattern.palette.find(p => p.id === id)
    /* 和生成阶段同一口径：库存重配色也用 CIEDE2000 全量比，
       否则「按库存替换」会悄悄把颜色换到 Lab 距离更近、但肉眼更远的色号上。 */
    let best = pool[0], bd = Infinity
    for (const p of pool) {
      const d = deltaE2000(cur.lab, p.lab)
      if (d < bd) { bd = d; best = p }
    }
    remap.set(id, best.id)
    replaced += count
  }

  const nextPalette = []
  const paletteIndex = new Map()
  const cells = new Int32Array(pattern.cells.length)
  for (let i = 0; i < pattern.cells.length; i++) {
    const k = pattern.cells[i]
    if (k < 0) { cells[i] = EMPTY; continue }
    const cur = pattern.palette[k]
    if (!cur) { cells[i] = EMPTY; continue }
    const targetId = remap.get(cur.id) || cur.id
    let pi = paletteIndex.get(targetId)
    if (pi === undefined) {
      const color = pool.find(p => p.id === targetId) || cur
      pi = nextPalette.length
      paletteIndex.set(targetId, pi)
      nextPalette.push(color)
    }
    cells[i] = pi
  }

  const build = buildability(cells, pattern.width, pattern.height, nextPalette.length)
  const beadCount = beadCountOf(cells)
  const next = {
    ...pattern,
    cells,
    palette: nextPalette,
    colors: nextPalette.map(p => p.id),
    stats: {
      ...pattern.stats,
      beadCount,
      colorCount: nextPalette.length,
      buildability: build.score / 100,
      isolatedCount: build.isolatedCount,
      estimatedMinutes: estimateMinutes(beadCount, build.score)
    },
    inventoryMode: mode,
    notes: [...(pattern.notes || []), `按库存重新配色，替换 ${replaced} 颗豆`]
  }
  return { pattern: next, applied: true, replaced, mode }
}

/* ---------------------------------------------------------------- 序列化 */

export function toPatternJSON(pattern, extra = {}) {
  return {
    version: PATTERN_VERSION,
    width: pattern.width,
    height: pattern.height,
    brandId: pattern.brandId,
    mode: pattern.mode,
    paletteId: pattern.brandId,
    /* 板 / 豆径口径要一起存：老存档没有这两个字段时读回端按画布尺寸推导，
       新存档存下来才能保证「52 钉板 + 2.6mm 小豆」的作品过了半年再打开还是同一套尺寸。 */
    boardSize: pattern.boardSize || null,
    beadKey: pattern.beadKey || null,
    // 空格存成 null（palette[-1] 取不到 code），读回时还原为 EMPTY
    cells: Array.from(pattern.cells, i => (i < 0 ? null : pattern.palette[i]?.code ?? null)),
    paletteCodes: pattern.palette.map(p => p.code),
    stats: pattern.stats,
    ...extra
  }
}

export function fromPatternJSON(json, brandId) {
  if (!json || !json.width || !json.height) return null
  const brand = json.brandId || brandId || DEFAULT_BRAND_ID
  const palette = []
  const index = new Map()
  const codes = json.paletteCodes && json.paletteCodes.length ? json.paletteCodes : null

  /*
   * 色板顺序必须**先**按存档里的 paletteCodes 定下来，再往 cells 里写下标。
   *
   * 旧写法是「边扫格子边按首次出现顺序建色板，最后再 sort 色板」—— 排序发生在写下标之后，
   * 于是只要格子里首次出现的顺序和色板顺序不同，每个格子的颜色都会被换掉。
   * 这不是理论问题：合成一组「首次出现顺序 ≠ 色板顺序」的数据实测 10 格里有 6 格换色，
   * 表现是**本机存档重新打开后整张图纸颜色错乱**（材料清单与用量跟着一起错）。
   * 存档里的 cells 存的是色号，所以按色号建索引天然与存档自洽，也不需要事后排序。
   */
  if (codes) {
    for (const code of codes) {
      if (index.has(code)) continue
      const color = getColor(brand, code) || getColor(DEFAULT_BRAND_ID, code)
      if (!color) continue
      index.set(code, palette.length)
      palette.push(color)
    }
  }

  const cells = new Int32Array(json.width * json.height)
  for (let i = 0; i < cells.length; i++) {
    const code = json.cells ? json.cells[i] : null
    // null = 不放豆（抠掉的背景 / 擦掉的位置），不是"未知色号"
    if (code === null || code === undefined) { cells[i] = EMPTY; continue }
    let pi = index.get(code)
    if (pi === undefined) {
      const color = getColor(brand, code) || getColor(DEFAULT_BRAND_ID, code)
      if (!color) { cells[i] = EMPTY; continue }
      pi = palette.length
      palette.push(color)
      index.set(code, pi)
    }
    cells[i] = pi
  }
  if (!palette.length) return null
  const stats = json.stats || {}
  if (stats.beadCount == null) stats.beadCount = beadCountOf(cells)
  return {
    version: PATTERN_VERSION,
    width: json.width,
    height: json.height,
    brandId: brand,
    mode: json.mode || 'easy',
    /* 板 / 豆径：存档里带了就用存档的，老存档（只有宽高）按画布尺寸推导 ——
       29 / 58 / 116 / 300 这些会推导成 29 格老规格，52 / 78 / 104 / 120 系推导成钉板规格，
       所以「打开旧作品」和「打开新作品」各自拿到自己那套口径，不会互相串。 */
    ...patternProfile(json.width, json.height, json.boardSize, json.beadKey),
    cells,
    palette,
    colors: palette.map(p => p.id),
    stats
  }
}

/* ---------------------------------------------------------------- 导出数据 */

/**
 * SVG 体积估算（导出闸门）。
 *
 * 为什么要先算：toSVG 是一格一个 <rect>、开色号再一格一个 <text>。实测 450×450 格
 * 「不带色号」就有 10.7 MB，「带色号」是 40.2 MB —— 字符串一旦 join 出来，这份内存
 * 就已经吃掉了，再判断「太大了」已经晚了（UTF-16 下还要再翻一倍）。所以导出前先用
 * 算式判断能不能给、要不要丢色号，这个函数就是那道闸门。
 *
 * 口径是**偏保守的上界**：坐标一律按最宽的位数（右下角那格）算，最后再乘 1.05 的安全系数，
 * 宁可高估后降级，也不要低估后把浏览器撑爆。返回的是字符数；toSVG 的输出全是 ASCII，
 * 字符数即 UTF-8 字节数，也等于 Blob 的实际体积。
 * 下面的 rect / text / line 模板必须和 toSVG 里的写法保持一致，改了 toSVG 就要一起改。
 */
export function estimateSvgBytes(pattern, { cell = 10, withGrid = true, withCodes = false, withRuler = true, boardSize = BOARD_SIZE } = {}) {
  const { width: gw, height: gh, cells, palette } = pattern
  const R = withRuler ? Math.max(16, Math.round(cell * 1.8)) : 0
  const xDigits = String(R + Math.max(0, gw - 1) * cell + cell).length
  const yDigits = String(R + Math.max(0, gh - 1) * cell + cell).length
  const pad = n => '9'.repeat(n)

  // 真正要画出来的豆子（空格是 -1，toSVG 会 skip，不能按格数算）
  let beads = 0
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i]
    if (k >= 0 && palette[k]) beads++
  }

  const rectBytes = `<rect x="${pad(xDigits)}" y="${pad(yDigits)}" width="${cell}" height="${cell}" fill="#123456"/>`.length
  let bytes = 700 + beads * rectBytes // 700：svg 头、白底、外框、空 <g> 等零碎

  if (withGrid && cell >= 4) {
    const line = `<line x1="${pad(xDigits)}" y1="${pad(yDigits)}" x2="${pad(xDigits)}" y2="${pad(yDigits)}"/>`.length
    bytes += (gw + gh + 2) * line
    bytes += (Math.floor(gw / 10) + Math.floor(gh / 10)) * line
    const bs = normalizeBoardSize(boardSize, gw, gh)
    if (Math.ceil(gw / bs.x) > 1 || Math.ceil(gh / bs.y) > 1) {
      bytes += (Math.floor(gw / bs.x) + Math.floor(gh / bs.y)) * line
    }
  }

  if (withCodes && cell >= 12) {
    const maxLen = palette.reduce((m, p) => Math.max(m, String(p.code).length), 2)
    const fs = Math.max(5, Math.min(Math.round(cell * 0.46), Math.round((1.41 * cell) / maxLen)))
    // 色号最长 maxLen，ink 最长的一种是 rgba(255,255,255,.95)（22 字符），按最长算
    const text = `<text x="${pad(xDigits)}" y="${pad(yDigits)}" font-family="Arial,sans-serif" font-size="${fs}" font-weight="700" fill="${pad(22)}" text-anchor="middle" dominant-baseline="central">${'X'.repeat(maxLen)}</text>`.length
    bytes += beads * text
  }

  if (withRuler) {
    const step = cell >= 15 ? 1 : cell >= 9 ? 5 : 10
    const fs = Math.max(8, Math.min(Math.round(cell * 0.46), Math.round(R * 0.52)))
    // 标尺数字最宽 4 位：画布上限 1000 格，行列号会真的出现 1000（4 位数）。
    // 旧注释写的是"当前画布上限 464，到不了 4 位"，那是 464 时代的假设；
    // 估算偏小就失去闸门意义（宁可高估后降级，也不要低估后把浏览器撑爆）。
    const t = `<text x="${pad(xDigits)}" y="${pad(yDigits)}" font-family="Arial,sans-serif" font-size="${fs}" fill="#123456" text-anchor="middle" dominant-baseline="central">${pad(4)}</text>`.length
    let labels = 0
    for (let i = 1; i <= gw; i++) if (i % 10 === 0 || i % step === 0) labels++
    for (let j = 1; j <= gh; j++) if (j % 10 === 0 || j % step === 0) labels++
    bytes += labels * 2 * t // 上下各一份 / 左右各一份
  }

  return Math.round(bytes * 1.05)
}

export function toSVG(pattern, { cell = 10, withGrid = true, withCodes = false, withRuler = true, boardSize = BOARD_SIZE } = {}) {
  const { width: gw, height: gh, cells, palette } = pattern
  const R = withRuler ? Math.max(16, Math.round(cell * 1.8)) : 0
  const GWpx = gw * cell
  const GHpx = gh * cell
  const W = R + GWpx + R
  const H = R + GHpx + R
  const OX = R
  const OY = R

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`)
  if (withRuler) parts.push(`<rect width="${W}" height="${H}" fill="none"/>`)

  // 豆子
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const c = palette[cells[y * gw + x]]
      if (!c) continue
      parts.push(`<rect x="${OX + x * cell}" y="${OY + y * cell}" width="${cell}" height="${cell}" fill="${c.hex}"/>`)
    }
  }

  // 网格
  if (withGrid && cell >= 4) {
    const lines = []
    for (let i = 0; i <= gw; i++) lines.push(`<line x1="${OX + i * cell}" y1="${OY}" x2="${OX + i * cell}" y2="${OY + GHpx}"/>`)
    for (let j = 0; j <= gh; j++) lines.push(`<line x1="${OX}" y1="${OY + j * cell}" x2="${OX + GWpx}" y2="${OY + j * cell}"/>`)
    parts.push(`<g stroke="rgba(28,38,27,.13)" stroke-width="1">${lines.join('')}</g>`)

    const bold = []
    for (let i = 10; i < gw; i += 10) bold.push(`<line x1="${OX + i * cell}" y1="${OY}" x2="${OX + i * cell}" y2="${OY + GHpx}"/>`)
    for (let j = 10; j < gh; j += 10) bold.push(`<line x1="${OX}" y1="${OY + j * cell}" x2="${OX + GWpx}" y2="${OY + j * cell}"/>`)
    if (bold.length) parts.push(`<g stroke="rgba(28,38,27,.46)" stroke-width="${Math.max(1, Math.round(cell / 11))}">${bold.join('')}</g>`)
  }

  // 底板边界
  const bs = normalizeBoardSize(boardSize, gw, gh)
  const bCols = Math.ceil(gw / bs.x)
  const bRows = Math.ceil(gh / bs.y)
  if (bCols > 1 || bRows > 1) {
    const dash = []
    for (let i = bs.x; i < gw; i += bs.x) dash.push(`<line x1="${OX + i * cell}" y1="${OY}" x2="${OX + i * cell}" y2="${OY + GHpx}"/>`)
    for (let j = bs.y; j < gh; j += bs.y) dash.push(`<line x1="${OX}" y1="${OY + j * cell}" x2="${OX + GWpx}" y2="${OY + j * cell}"/>`)
    parts.push(`<g stroke="#FF8EC7" stroke-width="${Math.max(1.4, cell / 7)}" stroke-dasharray="${Math.max(4, cell / 2.5)} ${Math.max(3, cell / 4)}">${dash.join('')}</g>`)
  }

  // 色号
  if (withCodes && cell >= 12) {
    const maxLen = palette.reduce((m, p) => Math.max(m, p.code.length), 2)
    const fs = Math.max(5, Math.min(Math.round(cell * 0.46), Math.round((1.41 * cell) / maxLen)))
    const texts = []
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const c = palette[cells[y * gw + x]]
        if (!c) continue
        const ink = luminance(c.hex) > 150 ? 'rgba(28,38,27,.72)' : 'rgba(255,255,255,.95)'
        texts.push(
          `<text x="${OX + x * cell + cell / 2}" y="${OY + y * cell + cell / 2}" font-family="Arial,sans-serif" font-size="${fs}" font-weight="700" fill="${ink}" text-anchor="middle" dominant-baseline="central">${c.code}</text>`
        )
      }
    }
    parts.push(texts.join(''))
  }

  // 标尺
  if (withRuler) {
    const step = cell >= 15 ? 1 : cell >= 9 ? 5 : 10
    const fs = Math.max(8, Math.min(Math.round(cell * 0.46), Math.round(R * 0.52)))
    const t = []
    for (let i = 1; i <= gw; i++) {
      const major = i % 10 === 0
      if (!major && i % step !== 0) continue
      const fill = major ? '#1B1B1F' : '#9A9AA2'
      const cx = OX + (i - 0.5) * cell
      t.push(`<text x="${cx}" y="${R * 0.5}" font-family="Arial,sans-serif" font-size="${fs}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${i}</text>`)
      t.push(`<text x="${cx}" y="${OY + GHpx + R * 0.5}" font-family="Arial,sans-serif" font-size="${fs}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${i}</text>`)
    }
    for (let j = 1; j <= gh; j++) {
      const major = j % 10 === 0
      if (!major && j % step !== 0) continue
      const fill = major ? '#1B1B1F' : '#9A9AA2'
      const cy = OY + (j - 0.5) * cell
      t.push(`<text x="${R * 0.5}" y="${cy}" font-family="Arial,sans-serif" font-size="${fs}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${j}</text>`)
      t.push(`<text x="${OX + GWpx + R * 0.5}" y="${cy}" font-family="Arial,sans-serif" font-size="${fs}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${j}</text>`)
    }
    parts.push(`<g>${t.join('')}</g>`)
  }

  parts.push(`<rect x="${OX - 1}" y="${OY - 1}" width="${GWpx + 2}" height="${GHpx + 2}" fill="none" stroke="#1B1B1F" stroke-width="2"/>`)
  parts.push('</svg>')
  return parts.join('')
}

/** 品牌 / 系列名（色号离开品牌就没有意义，导出表必须带上） */
function brandLabelOf(brandId) {
  if (!brandId) return ''
  try {
    const b = getBrand(brandId)
    return b ? b.name : brandId
  } catch {
    return brandId
  }
}

function csvCell(v) {
  const s = String(v == null ? '' : v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 材料清单 CSV（品牌/系列 / 色号 / 颜色 / 数量 / 已拥有 / 缺少） */
export function toMaterialsCSV(pattern, inventoryMap, projectName = '豆玩 DOUWAN') {
  const { rows, totalBeads, totalLack } = materialList(pattern, inventoryMap)
  const head = '品牌/系列,色号,颜色,数量,已拥有,缺少'
  const body = rows.map(r => [
    brandLabelOf(r.brandId), r.code, r.name || '', r.count, r.owned, r.lack
  ].map(csvCell).join(','))
  const meta = `# 总豆数,${totalBeads}\n# 需补购,${totalLack}`
  return `\ufeff# ${projectName} 材料清单\n${meta}\n${head}\n${body.join('\n')}\n`
}

/** 采购清单纯文本（一键复制用，PRD §18） */
export function toShoppingText(pattern, inventoryMap, projectName = '豆玩 DOUWAN') {
  const { rows, totalBeads, totalLack } = materialList(pattern, inventoryMap)
  const lines = [
    `【${projectName}】拼豆采购清单`,
    `总豆数 ${totalBeads} 颗 · 需补购 ${totalLack} 颗`,
    ''
  ]
  for (const r of rows) {
    lines.push(`${brandLabelOf(r.brandId)} · ${r.code}\t${r.name || '—'}\t共 ${r.count} 颗\t已有 ${r.owned} 颗\t缺 ${r.lack} 颗`)
  }
  lines.push('', '由 豆玩 DOUWAN 生成 · 数量按当前图纸实际统计')
  return lines.join('\n')
}
