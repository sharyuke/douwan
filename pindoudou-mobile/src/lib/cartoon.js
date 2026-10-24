/* =========================================================================
   照片 → 卡通形象（拼豆图的前置风格化）
   -------------------------------------------------------------------------
   目标：用户可以直接用写实照片出拼豆图纸，也可以**先转成简单卡通风格再出图**
   （纹理被抹平之后色块更大、颜色更少，拼起来明显省事，也更像"卡通形象"）。

   ---- 最重要的一条：只许概括，不许编造 ----
   照片转卡通常见的做法是接生成模型，那会"画"出原图没有的眼睛、花纹、背景。
   这里全程是经典图像处理（**没有模型、没有网络、没有随机数**），而且输出的每一种颜色
   都能追到原图上的真实像素：

     · 平涂色 = 该色块**所属色团内原图像素的平均值**（先分区，再用区内原图真实像素求均值）。
       所以色相、明度都是原图自己的，不会凭空多出一个原图没有的颜色。
       小碎块并进邻块时**取邻块的颜色**而不是把两者的像素平均 —— 平均出来的会是两者都
       不是的脏色（黄衣服上的深色印花会把整件衣服拉成灰绿），这正是"编造颜色"；
     · 描边色 = 该色块**自身颜色按比例压暗**（sRGB 三通道同乘一个系数 = HSV 里色相不变、
       只降明度）。也就是说线条的颜色来自它所在区域的颜色，而不是硬压一层黑；
       彩色区（帽子、衣服）因此保留自己的暗调，只有低饱和区（皮肤、头发、靴子）的
       线条才会压到接近纯黑 —— 和手绘插画的用线习惯一致；
     · 特征锚点 = 小尺度上对比很强的地方（眼睛、鼻孔、文字、高光）**保留原像素颜色**，
       不平涂。这是"抓住主要特征"的关键一步：卡通化最容易抹掉的正是这些
       只有几个像素、却决定像不像的部位；
     · 明暗关系只做"降明度 / 提饱和"，两者都不改变色相。

   是否真的做到了，不看感觉看数字：`scripts/fidelity/cartoon-bench.mjs` 会报
   结构一致度（原图与卡通的梯度图相关）、色块纯度、色相偏移中位数、边缘召回/精确、
   以及"与不做卡通化相比，拼豆图纸的结构保留度掉了多少"。

   ---- 算法（每一步都能单独关掉做对照） ----
     1. 降到工作分辨率（≤768 边长，面积平均）：分析在这一层做能快一个量级。
        ⚠️ 精细档（300 / 1000 格）下这个 768 会变成瓶颈：450 格配 2 倍超采样需要 900 边的
        中间图，768 不够用。**这次仍然没有跟着画布调**，原因与实测见 CARTOON_MAX_SIDE 的
        注释（预设里的 radius / inkWidth 是工作分辨率像素，换分辨率等于换风格，
        必须先做参数归一化 + 一轮单独的评测）；
     2. **保边平滑**（可分离双边滤波，颜色权重只看亮度差）：抹掉皮肤/毛发的细纹理，
        同时不跨过真实边缘 —— 跨过去就糊成一团，特征当场丢失；
     3. **轮廓线**：平滑后的亮度做 Sobel 得到梯度幅值，再沿梯度方向做**非极大值抑制**
        把边缘细化成一条线，最后做**双阈值滞后**连成封闭曲线。阈值取梯度分位数
        （自适应，暗调/低对比照片同样适用），所以只在原图真有边缘的地方落线；
        线宽由"描边半径"决定，落在线上就是**稳定的实心线**，而不是到处 15% 不透明度的糊边
        —— 后者是"照片糊了一层脏东西"，不是插画；
     4. **平涂分区**：在 Lab 空间对图像自身的颜色做加权 k-means（5bit 桶直方图加速、
        最远点初始化，全程确定性），色块颜色取区内原图真实均值；
     5. **色团切块**：同一个颜色标签往往在画面上有好几处（左右两只靴子、两段裙子条纹）。
        按 8 邻域把它们拆成互不相连的色团，每个色团**各自**取自己的原图均值。
        否则远隔画面两端的两块颜色会被平均成一个都不像的中间色；
     6. **特征锚点**：细节强度（原图亮度 − 盒式模糊）先做 3×3 平均再取分位数门限，
        只有成团的强细节会保留原色 —— 单像素噪点会被 3×3 平均压下去；
        最强的那些（眼睛、高光）再补一层**实心化**：它们本来在原图里就是一团同色，
        实心化让它不要被平涂与描边稀释掉；
     7. **逐像素合成**：平涂色 → 叠描边 → 贴回特征；最后按最近邻放大回源图分辨率，
        放大过程不引入任何新的中间色。

   ---- 和抠图（去背景）的关系 ----
   抠背景仍然在**原照片**上做：抠图靠的是颜色模型与边缘，而卡通化恰好会改掉边缘的
   原始信息。卡通化只改颜色、不改尺寸，所以 alpha 图与它逐像素对齐。

   纯函数、无 DOM、无随机：可以在 Node 里直接跑回归评测。
   ========================================================================= */

import { rgbToLab, rgbToHex, deltaE2000, labDist2 } from './color.js'

/**
 * 卡通化的工作分辨率上限。
 *
 * 原来取 512（拼豆画布最大 116 格，512 有 4 倍余量）。但"4 倍余量"是拿**色块**算的，
 * 没算**五官**：全身照里眼睛只有画面的 1.5% 宽，512 下就是 6~8 个像素 ——
 * 描边一加粗（半径 3）眼睛直接被糊掉，脸平了。768 下同样的眼睛有 10 个像素以上，
 * 描边与特征回贴才有地方落笔。像素数是 512 的 2.25 倍，实测一张 1337×1755 的照片
 * 卡通化从 ~230ms 到 ~500ms，仍在"和出图同量级"的范围内。
 *
 * ⚠️ 为什么**没有**跟着画布上限（1000 格）一起放大 —— 试过了，撤回来了：
 * 这三档预设里的 radius / inkWidth / minChunk 都是**工作分辨率像素**，换分辨率就等于换风格。
 * 实测（ref_girl 1337×1755、标准档、只改工作分辨率）：
 *   768  → 585×768 工作图，平涂色 344，meta.structure 0.712，色相偏移 0.9°，~340ms
 *   1000 → 762×1000，       平涂色 424，structure 0.581，色相偏移 1.4°，~345ms
 *   1152 → 878×1152，       平涂色 494，structure 0.633，色相偏移 1.1°，~465ms
 * 平涂色变多是"更细"没错，但 structure / 色相偏移同时变差，方向不明确；
 * 而且 `structure` 是在**工作分辨率**上算的梯度相关，跨分辨率本来就不完全可比 ——
 * 也就是说这一轮的量法给不出结论。要放开它，必须先把预设里那批像素单位参数
 * 按分辨率归一化，再重跑 cartoon-bench / cartoon-sweep 定标（README 里记着这件事）。
 */
export const CARTOON_MAX_SIDE = 768

/**
 * 三档风格预设。侧栏里就是这三档，与抠图的三档力度同构。
 *
 * 每一档的参数含义：
 *   radius      双边滤波半径（像素）——越大，纹理抹得越干净，也越容易糊掉小结构
 *   sigmaColor  双边滤波的颜色容差（灰度级）——越大越"敢"跨过弱边缘
 *   iterations  双边滤波迭代次数
 *   levels      平涂色块数的上限（k-means 的目标色块数；最终色号数可能略低于它，
 *               因为相邻且几乎同色的两块会被并成一个色号）
 *   ink         描边最大不透明度（0 = 不描边）
 *   inkWidth    描边半径（工作分辨率像素）
 *   minChunk    比它小的色块并进邻块（工作分辨率像素数）。调大 = 色号更少、细节（裙子条纹、
 *               靴子上的字）更容易被并掉；调小 = 保细节但色号变多。出图前还会按"目标颜色数"
 *               再合并一次，所以这里留细一点更划算
 *   inkDarken   描边色 = 局部色 × 这个系数（只降明度，色相不动）
 *   inkMix      描边额外混入"低饱和深色"的比例（0 = 纯用局部色自己的暗调）。
 *               彩色区混一点点更像手绘的墨线，又不会把黄帽子画成黑帽子
 *   detailKeep  特征锚点的最大回贴比例（弱细节按比例回贴）
 *   detailQuantile 细节强度的分位数门限（只有最强的这些细节被当作"特征"）
 *   detailSolid 最强细节的实心化比例（1 = 最强的那 1% 整块用原像素）
 *   inkYield    描边随底色明度收力的指数（越大，亮处的线越淡）。
 *               线落在两个色块的边界上，按"两侧谁更暗"取底色明度：
 *               深色头发/黑靴子上的线几乎不动（那里本来就该是深色），
 *               而亮橙色的南瓜、白色高光边上会把墨色收掉大半 ——
 *               不加这一条，一颗反光很强的水果会被描成一团脏兮兮的深色斑块
 *               （实测结构一致度掉到 0.19，加"收力"之后回到正常范围）
 *   saturate    平涂色的饱和度系数（以灰度为轴缩放，色相不变）
 *
 * 数值不是拍出来的：拿手绘插画本身当标尺量过（`scripts/fidelity/cartoon-sweep.mjs`
 * 逐参数扫描，对插画与照片跑同一套统计）。插画的签名是
 * **平涂更平、线更粗、深色像素占比更高**：
 *   亮度 <100 的像素占比   插画 0.200，源照片 0.103（插画靠粗线把深色占比翻了一倍）
 *   |Y−blur5| 平均残差     插画 2.84，源照片 2.07（插画色块内部更平）
 *   覆盖 90% 像素所需色数   插画 53，我们的输出落在 40~51
 * 所以线做粗（inkWidth 2）、色块做平（levels 更低、saturate 更保守），
 * 而不是按"看着像"调。
 */
export const CARTOON_STYLES = [
  {
    key: 'soft',
    label: '轻度',
    hint: '只去纹理，保留最多细节',
    radius: 2,
    sigmaColor: 22,
    iterations: 1,
    levels: 13,
    minChunk: 12,
    ink: 0.72,
    inkWidth: 1,
    inkDarken: 0.46,
    inkMix: 0.34,
    detailKeep: 0.75,
    detailQuantile: 0.94,
    detailSolid: 0.96,
    inkYield: 1.0,
    saturate: 1.0
  },
  {
    key: 'standard',
    label: '标准',
    hint: '通用：纹理抹平 + 清楚轮廓',
    radius: 3,
    sigmaColor: 28,
    iterations: 2,
    levels: 12,
    minChunk: 6,
    ink: 0.86,
    inkWidth: 2,
    inkDarken: 0.42,
    inkMix: 0.38,
    detailKeep: 0.75,
    detailQuantile: 0.93,
    detailSolid: 0.97,
    inkYield: 1.15,
    saturate: 1.02
  },
  {
    key: 'flat',
    label: '简约平涂',
    hint: '大色块 + 粗描边',
    radius: 4,
    sigmaColor: 42,
    iterations: 3,
    levels: 7,
    minChunk: 18,
    ink: 1.0,
    inkWidth: 3,
    inkDarken: 0.30,
    inkMix: 0.45,
    detailKeep: 0.68,
    detailQuantile: 0.90,
    detailSolid: 0.97,
    inkYield: 1.3,
    saturate: 1.05
  }
]

export function cartoonStyle(key) {
  if (key && typeof key === 'object') return key
  return CARTOON_STYLES.find(s => s.key === key) || CARTOON_STYLES[1]
}

/* ---------------------------------------------------------------- 小工具 */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(e0, e1, x) {
  if (!(e1 > e0)) return x >= e1 ? 1 : 0
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/**
 * 两个颜色"看着差多少"（0 = 一样，255 量级）。
 * 用亮度加权的 RGB 欧氏距离：绿色权重最高、蓝色最低（人眼对绿最敏感、对蓝最钝），
 * 权重按两色平均亮度做一点偏移 —— 深色区的差异更容易被看出来，浅色区相反。
 * 不用 CIEDE2000 是因为这里只用来比较两个**已经定下来的平涂色**，
 * 而且要在循环里被调用很多次，这个近似够用且便宜。
 */
function colorDistance(x, y) {
  const mean = (x.r + x.g + x.b + y.r + y.g + y.b) / 6
  const wr = 2 + mean / 256
  const wg = 4
  const wb = 2 + (255 - mean) / 256
  const dr = x.r - y.r
  const dg = x.g - y.g
  const db = x.b - y.b
  return Math.sqrt(wr * dr * dr + wg * dg * dg + wb * db * db) / 3
}

/**
 * "两个相邻色块算同一个色号"的距离阈值。
 * 调大到 30 会开始吃掉瞳孔与眼白之间的层次，调小到 20 又会留下大片几乎看不出的色块 ——
 * 26 是在 7 张评测图 + 人物照片上都能保住眼睛、同时把皮肤上的过渡层收掉的位置。
 */
const SIMILAR_MERGE = 26

/**
 * 降到工作分辨率：每个源像素按中心落进目标像素，透明按白底合成。
 * 与 pattern.js / matte.js 的降采样同口径（sRGB 平均 + 白底压平）。
 */
function toWork(src, sw, sh, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const rgb = new Float32Array(w * h * 3)
  const cnt = new Float64Array(w * h)
  for (let y = 0; y < sh; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / sh))
    for (let x = 0; x < sw; x++) {
      const tx = Math.min(w - 1, Math.floor((x * w) / sw))
      const t = ty * w + tx
      const i = (y * sw + x) * 4
      const a = src[i + 3] / 255
      rgb[t * 3] += src[i] * a + 255 * (1 - a)
      rgb[t * 3 + 1] += src[i + 1] * a + 255 * (1 - a)
      rgb[t * 3 + 2] += src[i + 2] * a + 255 * (1 - a)
      cnt[t]++
    }
  }
  for (let i = 0; i < w * h; i++) {
    const n = cnt[i] || 1
    rgb[i * 3] /= n
    rgb[i * 3 + 1] /= n
    rgb[i * 3 + 2] /= n
  }
  return { rgb, w, h }
}

function lumaOf(rgb, w, h) {
  const Y = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    Y[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]
  }
  return Y
}

/**
 * 可分离盒式模糊（前缀和，每像素 O(1) 次加减）。
 * `offset` / `stride` 用来直接从交错存放的 RGB 数据里模糊某一个通道（特征检测要分通道看）。
 */
function boxBlurF(src, w, h, radius, offset = 0, stride = 1) {
  const r = Math.max(0, radius | 0)
  const at = i => src[i * stride + offset]
  if (!r) {
    const copy = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) copy[i] = at(i)
    return copy
  }
  const span = 2 * r + 1
  const tmp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += at(y * w + Math.min(w - 1, Math.max(0, k)))
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span
      sum += at(y * w + Math.min(w - 1, x + r + 1)) - at(y * w + Math.max(0, x - r))
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

/** Sobel 梯度幅值（÷4 之后约等于「相邻像素的亮度差」，好定阈值） */
function sobelMag(Y, w, h) {
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0
    const yp = y < h - 1 ? y + 1 : h - 1
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0
      const xp = x < w - 1 ? x + 1 : w - 1
      const tl = Y[ym * w + xm], tc = Y[ym * w + x], tr = Y[ym * w + xp]
      const ml = Y[y * w + xm], mr = Y[y * w + xp]
      const bl = Y[yp * w + xm], bc = Y[yp * w + x], br = Y[yp * w + xp]
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl)
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr)
      g[y * w + x] = Math.sqrt(gx * gx + gy * gy) / 4
    }
  }
  return g
}

/**
 * Canny 式的边缘骨架：Sobel 幅值 → 沿梯度方向做**非极大值抑制**。
 *
 * 为什么必须有这一步：只有 Sobel 幅值的话，一条真实边缘会同时点亮它两侧各 3~4 个像素，
 * 阈值一切就是一道 6~8px 宽的"糊边"。把它当描边画上去，得到的是一张糊了脏东西的照片，
 * 而不是手绘插画那种一条清清楚楚的线。抑制掉非极大值之后，一条边缘只剩一个像素宽。
 */
function edgeSkeleton(Y, w, h) {
  const g = sobelMag(Y, w, h)
  const skel = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const m = g[i]
      if (!(m > 0)) continue
      const xm = x - 1, xp = x + 1
      const tl = Y[(y - 1) * w + xm], tc = Y[(y - 1) * w + x], tr = Y[(y - 1) * w + xp]
      const ml = Y[y * w + xm], mr = Y[y * w + xp]
      const bl = Y[(y + 1) * w + xm], bc = Y[(y + 1) * w + x], br = Y[(y + 1) * w + xp]
      // 梯度方向（未归一化）
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl)
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr)
      // 邻居梯度幅值：对梯度方向做**最近邻量化**成 8 个方向（标准 Canny 做法）
      const agx = gx < 0 ? -gx : gx
      const agy = gy < 0 ? -gy : gy
      let nb1, nb2
      if (agx >= agy * 2.4142) { nb1 = g[i - 1]; nb2 = g[i + 1] }
      else if (agy >= agx * 2.4142) { nb1 = g[i - w]; nb2 = g[i + w] }
      else if (gx * gy > 0) { nb1 = g[i - w - 1]; nb2 = g[i + w + 1] }
      else { nb1 = g[i - w + 1]; nb2 = g[i + w - 1] }
      // >= 而不是 >：谷底挨着的两个像素同时保留，1px 的线才不会断开
      if (m >= nb1 && m >= nb2) skel[i] = m
    }
  }
  return skel
}

/**
 * 双阈值滞后：强边缘一定画；弱边缘只有挨着已确认的边缘时才算数。
 * 这一步专治"轮廓断断续续"——单靠高阈值会漏掉对比度低的一截，
 * 单靠低阈值会把纹理噪点全画成线。
 */
function hysteresisEdge(skel, w, h, strongTh, weakTh) {
  const n = w * h
  const state = new Uint8Array(n) // 0 未定 / 1 已确认 / 2 已否决
  const stack = new Int32Array(n)
  let top = 0
  for (let i = 0; i < n; i++) {
    if (skel[i] >= strongTh) { state[i] = 1; stack[top++] = i }
  }
  while (top > 0) {
    const i = stack[--top]
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= w) continue
        const j = yy * w + xx
        if (state[j] || skel[j] < weakTh) continue
        state[j] = 1
        stack[top++] = j
      }
    }
  }
  return state
}

/**
 * 描边强度传播：把骨架上的线强度按半径往外铺开，铺出去的值取**种子线上的强度**。
 *
 * 为什么必须这样铺：1px 的线在拼豆尺度上看不见，得加宽；但如果"画一条 1px 的线，
 * 再在外圈叠一层半透明"，得到的是一圈灰扑扑的晕 —— 那正是照片"糊了一层脏东西"的观感。
 * 让外圈继承线的强度，才是一条有实体感的线：线本身对比越硬，整条线越实。
 *
 * `blocked`（高光）上的像素不落墨，而且**线穿不过去** —— 线会停在高光边上，
 * 而不是绕着高光描一圈。
 */
function growInk (strength, blocked, w, h, radius) {
  const n = w * h
  const r = Math.max(0, radius | 0)
  const out = Float32Array.from(strength)
  if (blocked) for (let i = 0; i < n; i++) if (blocked[i]) out[i] = 0
  if (!r) return out
  const queue = new Int32Array(n)
  let qh = 0
  let qt = 0
  for (let i = 0; i < n; i++) if (out[i] > 0) queue[qt++] = i
  let level = 0
  while (qh < qt && level < r) {
    const end = qt
    level++
    while (qh < end) {
      const i = queue[qh++]
      const x = i % w
      const y = (i - x) / w
      for (let k = 0; k < 4; k++) {
        const xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0)
        const yy = y + (k === 2 ? -1 : k === 3 ? 1 : 0)
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue
        const j = yy * w + xx
        if (blocked && blocked[j]) continue
        if (out[i] <= out[j]) continue
        out[j] = out[i]
        queue[qt++] = j
      }
    }
  }
  return out
}

/**
 * 高光遮罩：这个像素比它周围明显更亮的地方。
 *
 * 用两个半径的盒式模糊取"周围有多亮"：轮廓上的暗侧和亮侧各自都会被抹平，
 * 取两者中的较大值当背景亮度 —— 于是"亮"只表示"比两侧都亮"，而不是"比邻域平均亮"，
 * 边缘亮侧不会被误判成高光。
 *
 * 返回 1 = 该处是高光，不落墨。
 */
function highlightMask (Y, w, h) {
  const ok = new Uint8Array(w * h)
  const b1 = boxBlurF(Y, w, h, 2)
  const b2 = boxBlurF(Y, w, h, 5)
  for (let i = 0; i < w * h; i++) {
    const bg = b1[i] > b2[i] ? b1[i] : b2[i]
    // 52 个灰度级：只抓真正的镜面反光（玻璃/塑料/眼白上的亮点），
    // 皮肤与浅色布料上的柔和高光不会被切掉
    if (Y[i] > bg + 52) ok[i] = 1
  }
  return ok
}

/** 分位数（512 档直方图近似）。自适应阈值全靠它，换张照片不用重新调参 */
function quantileOf(arr, q) {  let max = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i]
  if (!(max > 0)) return 0
  const BINS = 512
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

/* ---------------------------------------------------------------- 保边平滑 */

/**
 * 可分离双边滤波的一个方向。
 * 颜色权重只用**亮度差**：比逐通道色差快得多，而在"要不要跨过这条边"这个问题上，
 * 亮度差已经足够（色相变化大的地方亮度差同样大）。权重查表，避免逐像素 exp。
 */
function bilateralPass(src, dst, w, h, Y, radius, spatial, rangeLut, horizontal) {
  const n = w * h
  for (let i = 0; i < n; i++) {
    const x = i % w
    const y = (i - x) / w
    const c = Y[i]
    let sr = 0, sg = 0, sb = 0, sw = 0
    const from = horizontal ? Math.max(0, x - radius) : Math.max(0, y - radius)
    const to = horizontal ? Math.min(w - 1, x + radius) : Math.min(h - 1, y + radius)
    for (let k = from; k <= to; k++) {
      const j = horizontal ? y * w + k : k * w + x
      const d = Y[j] - c
      const wt = spatial[Math.abs(k - (horizontal ? x : y))] *
        rangeLut[Math.min(255, (d < 0 ? -d : d) | 0)]
      sr += src[j * 3] * wt
      sg += src[j * 3 + 1] * wt
      sb += src[j * 3 + 2] * wt
      sw += wt
    }
    const o = i * 3
    dst[o] = sr / sw
    dst[o + 1] = sg / sw
    dst[o + 2] = sb / sw
  }
}

function bilateral(src, Y0, w, h, style) {
  const radius = Math.max(1, Math.min(8, style.radius | 0))
  const spatial = new Float32Array(radius + 1)
  const rs2 = 2 * (radius * 0.85) * (radius * 0.85)
  for (let i = 0; i <= radius; i++) spatial[i] = Math.exp(-(i * i) / rs2)
  const sc2 = 2 * style.sigmaColor * style.sigmaColor
  const rangeLut = new Float32Array(256)
  for (let i = 0; i < 256; i++) rangeLut[i] = Math.exp(-(i * i) / sc2)

  let cur = Float32Array.from(src)
  let Y = Y0
  const tmp = new Float32Array(w * h * 3)
  const iterations = Math.max(1, Math.min(4, style.iterations | 0))
  for (let it = 0; it < iterations; it++) {
    bilateralPass(cur, tmp, w, h, Y, radius, spatial, rangeLut, true)
    bilateralPass(tmp, cur, w, h, Y, radius, spatial, rangeLut, false)
    // 下一轮用新图的亮度做权重，但**每一轮内部两个方向共用同一份亮度**：
    // 用横向平滑后的亮度当纵向权重会让边缘横向拖影（试过，轮廓会歪）
    Y = lumaOf(cur, w, h)
  }
  return cur
}

/* ---------------------------------------------------------------- 平涂分区 */

/**
 * 在 Lab 空间做加权 k-means：样本是 5bit/通道的颜色桶（带像素数权重）。
 * 全程确定性（最远点初始化，不用随机数），所以同一张图每次结果完全一致。
 */
function clusterColors(rgb, w, h, k) {
  const n = w * h
  const map = new Map()
  const keysOf = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const r = Math.round(rgb[o]), g = Math.round(rgb[o + 1]), b = Math.round(rgb[o + 2])
    const key = (((r < 0 ? 0 : r > 255 ? 255 : r) >> 3) << 10) |
      (((g < 0 ? 0 : g > 255 ? 255 : g) >> 3) << 5) |
      ((b < 0 ? 0 : b > 255 ? 255 : b) >> 3)
    keysOf[i] = key
    let e = map.get(key)
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; map.set(key, e) }
    e.n++
    e.r += rgb[o]; e.g += rgb[o + 1]; e.b += rgb[o + 2]
  }
  const nb = map.size
  const keys = new Int32Array(nb)
  const wn = new Float64Array(nb)
  const labs = new Float32Array(nb * 3)
  let bi = 0
  for (const [key, e] of map) {
    keys[bi] = key
    wn[bi] = e.n
    const lab = rgbToLab(Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n))
    labs[bi * 3] = lab[0]; labs[bi * 3 + 1] = lab[1]; labs[bi * 3 + 2] = lab[2]
    bi++
  }

  const K = Math.max(1, Math.min(k | 0, nb))
  const centers = []
  let seed = 0
  for (let i = 1; i < nb; i++) if (wn[i] > wn[seed]) seed = i
  centers.push([labs[seed * 3], labs[seed * 3 + 1], labs[seed * 3 + 2]])
  const dmin = new Float64Array(nb).fill(Infinity)
  while (centers.length < K) {
    const c = centers[centers.length - 1]
    let best = -1
    let bestScore = -1
    for (let i = 0; i < nb; i++) {
      const dl = labs[i * 3] - c[0]
      const da = labs[i * 3 + 1] - c[1]
      const db = labs[i * 3 + 2] - c[2]
      const d = dl * dl + da * da + db * db
      if (d < dmin[i]) dmin[i] = d
      // 加权最远点：既要"离已选中心远"，也要"图上确实有那么一片颜色"
      const score = dmin[i] * wn[i]
      if (score > bestScore) { bestScore = score; best = i }
    }
    if (best < 0 || bestScore <= 0) break
    centers.push([labs[best * 3], labs[best * 3 + 1], labs[best * 3 + 2]])
  }

  const assign = new Int32Array(nb)
  for (let iter = 0; iter < 12; iter++) {
    let moved = false
    for (let i = 0; i < nb; i++) {
      let bj = 0
      let bd = Infinity
      for (let c = 0; c < centers.length; c++) {
        const dl = labs[i * 3] - centers[c][0]
        const da = labs[i * 3 + 1] - centers[c][1]
        const db = labs[i * 3 + 2] - centers[c][2]
        const d = dl * dl + da * da + db * db
        if (d < bd) { bd = d; bj = c }
      }
      if (assign[i] !== bj) { assign[i] = bj; moved = true }
    }
    const sum = new Float64Array(centers.length * 4)
    for (let i = 0; i < nb; i++) {
      const c = assign[i]
      sum[c * 4] += labs[i * 3] * wn[i]
      sum[c * 4 + 1] += labs[i * 3 + 1] * wn[i]
      sum[c * 4 + 2] += labs[i * 3 + 2] * wn[i]
      sum[c * 4 + 3] += wn[i]
    }
    for (let c = 0; c < centers.length; c++) {
      const wsum = sum[c * 4 + 3]
      if (!wsum) continue
      centers[c] = [sum[c * 4] / wsum, sum[c * 4 + 1] / wsum, sum[c * 4 + 2] / wsum]
    }
    if (!moved && iter > 0) break
  }

  const labelOfBucket = new Int16Array(1 << 15).fill(-1)
  for (let i = 0; i < nb; i++) labelOfBucket[keys[i]] = assign[i]

  const label = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    let l = labelOfBucket[keysOf[i]]
    if (l < 0) {
      // 理论上走不到这里（桶就是样本本身），兜底算一次最近中心
      const o = i * 3
      const lab = rgbToLab(rgb[o] | 0, rgb[o + 1] | 0, rgb[o + 2] | 0)
      let bj = 0
      let bd = Infinity
      for (let c = 0; c < centers.length; c++) {
        const d = labDist2(lab, centers[c])
        if (d < bd) { bd = d; bj = c }
      }
      l = bj
      labelOfBucket[keysOf[i]] = l
    }
    label[i] = l
  }
  return { label, count: centers.length }
}

/**
 * 平涂：标签取自**平滑后**的颜色，但每块的颜色取**原图真实像素的均值**。
 *
 * 为什么按"空间上连不连"再切一刀，而不是直接按颜色标签取均值：
 *   同一个颜色标签在画面上常有好几处 —— 左右两只靴子、两段裙子条纹、被轮廓隔开的
 *   同一件衣服。整体取均值会把远隔两端的深蓝和浅蓝平均成一个**原图上不存在的中间蓝**，
 *   这就是"编造颜色"。所以先按 8 邻域把它们拆成互不相连的色块，每块各自取色。
 *
 * 比 `minChunk` 还小的碎块（印花、扣子、一条细高光）不单独占一个色号，并进接触边界
 * 最长的那块，并**沿用面积最大那一块的颜色**（不把碎块的像素平均进来：深色印花混进
 * 黄衣服的均值会得到灰绿色，那是原图上任何一处都不存在的颜色）。这些小东西并进邻块
 * 之后就"消失"了，而真正重要的细节（眼睛、靴子上的字、高光）由特征锚点原样贴回。
 *
 * 纯度 = 各色块内部在原图上的方差占全局方差的比例（1 = 每块内部本来就是一致的）。
 */
function chunkFills (orig, clusterLabel, w, h, clusters, minChunk) {
  const n = w * h

  /* 8 邻域、标签相同才算同一块 */
  const comp = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  let nComp = 0
  for (let seed = 0; seed < n; seed++) {
    if (comp[seed] >= 0) continue
    const id = nComp++
    const lab = clusterLabel[seed]
    let top = 0
    comp[seed] = id
    stack[top++] = seed
    while (top > 0) {
      const i = stack[--top]
      const x = i % w
      const y = (i - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (comp[j] >= 0 || clusterLabel[j] !== lab) continue
          comp[j] = id
          stack[top++] = j
        }
      }
    }
  }

  const area = new Float64Array(nComp)
  const sum = new Float64Array(nComp * 3)
  const sumSq = new Float64Array(nComp)
  for (let i = 0; i < n; i++) {
    const c = comp[i]
    const o = i * 3
    const r = orig[o], g = orig[o + 1], b = orig[o + 2]
    area[c]++
    sum[c * 3] += r; sum[c * 3 + 1] += g; sum[c * 3 + 2] += b
    sumSq[c] += r * r + g * g + b * b
  }

  /* 碎块归并：并进接触边界最长的邻块（不是"颜色最像"的邻块 ——
     颜色最像但根本不相邻的两块并起来，会把原图没挨着的东西连成一体）。
     邻接表按需分配，避免 nComp 很大时开一个 nComp×8 的大数组。 */
  const merged = new Int32Array(nComp)
  for (let c = 0; c < nComp; c++) merged[c] = c
  const touch = new Map() // c -> Map(neighbour -> 接触长度)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = comp[i]
      if (x + 1 < w) {
        const b = comp[i + 1]
        if (a !== b) addTouch(a, b)
      }
      if (y + 1 < h) {
        const b = comp[i + w]
        if (a !== b) addTouch(a, b)
      }
    }
  }
  function addTouch (a, b) {
    let m = touch.get(a)
    if (!m) { m = new Map(); touch.set(a, m) }
    m.set(b, (m.get(b) || 0) + 1)
  }
  /* 链式归并 + 路径压缩：一长串小碎块（一道道细条纹）必须能顺着链走到最终的大块，
     否则链尾那些根本挨不到大块的碎块会**永远合并不掉**，最后每块都占一个色号
     （实测就是这一条让 11 个平涂色变成了 265 个）。 */
  const findBase = c => {
    let r = c
    while (merged[r] !== r) r = merged[r]
    while (merged[c] !== r) { const nx = merged[c]; merged[c] = r; c = nx }
    return r
  }
  for (let c = 0; c < nComp; c++) {
    if (area[c] >= minChunk) continue
    let cur = c
    let guard = 0
    let best = -1
    let bestLen = 0
    while (guard++ < 64) {
      const m = touch.get(cur)
      if (!m || !m.size) break
      best = -1
      bestLen = 0
      for (const [o, len] of m) {
        if (o === cur) continue
        if (len > bestLen) { bestLen = len; best = o }
      }
      if (best < 0) break
      if (area[best] >= minChunk) { merged[c] = best; break }
      cur = best // 邻块也是小碎块：顺着接触链继续往上找
    }
    // 整条链上没有一块够大（极小的孤立斑）：并进面积最大的那块，别白占一个色号
    if (merged[c] === c) {
      let big = -1
      for (let q = 0; q < nComp; q++) {
        if (q === c) continue
        if (big < 0 || area[q] > area[big]) big = q
      }
      if (big >= 0) merged[c] = big
    }
  }

  /* 合并成"上色单位"：颜色取组内**面积最大**那一块自己的原图均值 */
  const groupOf = new Int32Array(nComp).fill(-1)
  const groups = []
  for (let c = 0; c < nComp; c++) {
    const r = merged[c]
    if (groupOf[r] < 0) {
      groupOf[r] = groups.length
      groups.push({ head: r, area: 0, members: [] })
    }
    const g = groups[groupOf[r]]
    g.members.push(c)
    g.area += area[c]
    if (area[c] > area[g.head]) g.head = c
  }
  const count = groups.length
  const fillRgb = new Float32Array(count * 3)
  const fillOf = new Int32Array(nComp)
  const groupRgb = new Float32Array(count * 3)
  for (let k = 0; k < count; k++) {
    const g = groups[k]
    const hd = g.head
    /* 这块色块的颜色 = 「主干色块的像素」与「并进来的小碎块的像素」合起来求均值。
       为什么这里可以混、而归并小碎块时不能混：并进来之后，这些像素**全部**都会用这个
       颜色画出来 —— 所以它确实是"用这个颜色的那些像素"的平均（黄衣服并进一条深色印花，
       得到的仍是那条印花的深色）；而"并进邻块"的那一步如果混合，画出来的是邻色，
       被平均掉的是邻色的像素，那才是编造出来的假色。 */
    let sr = 0, sg = 0, sb = 0
    for (const c of g.members) { sr += sum[c * 3]; sg += sum[c * 3 + 1]; sb += sum[c * 3 + 2] }
    const a = g.area || 1
    groupRgb[k * 3] = sr / a
    groupRgb[k * 3 + 1] = sg / a
    groupRgb[k * 3 + 2] = sb / a
    fillRgb[k * 3] = groupRgb[k * 3]
    fillRgb[k * 3 + 1] = groupRgb[k * 3 + 1]
    fillRgb[k * 3 + 2] = groupRgb[k * 3 + 2]
    for (const c of g.members) fillOf[c] = k
  }

  /* 最后再降一次色数：**相邻**的色块之间，如果两个颜色在感知上几乎一样（皮肤上相邻的
     两道阴影层次、同一件衣服的亮部与暗部），就把小的并进大的。只并相邻的：原图上不相邻
     的两块即使颜色一样也不能碰，否则会把没挨着的东西连成一片。
     给"又暗又艳"的小色块留一条活路 —— 它们往往正是眼睛、嘴、高光，同色差下优先保留
     （`score` 上开个小口子），否则卡通化的脸会先糊没。

     这一步和 k-means 的目标色块数不是一回事：k-means 决定"在哪几个颜色上取平均"，
     这里决定"最后留下几个色号"，所以界面上报的色块数可能低于目标色块数。 */
  const groupAdj = new Array(count)
  for (let k = 0; k < count; k++) groupAdj[k] = new Map()
  for (const [a, m] of touch) {
    const ga = fillOf[a]
    for (const [b, len] of m) {
      const gb = fillOf[b]
      if (ga === gb) continue
      groupAdj[ga].set(gb, (groupAdj[ga].get(gb) || 0) + len)
      groupAdj[gb].set(ga, (groupAdj[gb].get(ga) || 0) + len)
    }
  }
  const pick = k => ({
    r: fillRgb[k * 3], g: fillRgb[k * 3 + 1], b: fillRgb[k * 3 + 2], area: groups[k].area
  })
  for (let pass = 0; pass < 4; pass++) {
    let mergedAny = false
    for (let k = 0; k < count; k++) {
      if (!(groups[k].area > 0)) continue
      const A = pick(k)
      let big = -1
      let bestScore = Infinity
      let bestLen = 0
      for (const [j, len] of groupAdj[k]) {
        const B = pick(j)
        if (!(B.area >= A.area * 1.05)) continue
        const sat = Math.max(A.r, A.g, A.b) - Math.min(A.r, A.g, A.b)
        const dark = 255 - (A.r + A.g + A.b) / 3
        const score = colorDistance(A, B) + (sat + dark * 0.5) * 0.12
        if (score < bestScore || (Math.abs(score - bestScore) < 0.5 && len > bestLen)) {
          bestScore = score; big = j; bestLen = len
        }
      }
      if (big < 0 || bestScore > SIMILAR_MERGE) continue
      const B = pick(big)
      const ta = A.area + B.area
      fillRgb[big * 3] = (A.r * A.area + B.r * B.area) / ta
      fillRgb[big * 3 + 1] = (A.g * A.area + B.g * B.area) / ta
      fillRgb[big * 3 + 2] = (A.b * A.area + B.b * B.area) / ta
      for (const c of groups[k].members) fillOf[c] = big
      groups[big].area = ta
      groups[big].members = groups[big].members.concat(groups[k].members)
      groups[k].members = []
      groups[k].area = 0
      for (const [j, len] of groupAdj[k]) {
        if (j === big) continue
        groupAdj[big].set(j, (groupAdj[big].get(j) || 0) + len)
        groupAdj[j].set(big, (groupAdj[j].get(big) || 0) + len)
      }
      groupAdj[k].clear()
      mergedAny = true
    }
    if (!mergedAny) break
  }

  /* 只保留还活着的组并重新编号 */
  const live = []
  for (let k = 0; k < count; k++) if (groups[k].area > 0) live.push(k)
  const finalCount = live.length
  const finalRgb = new Float32Array(finalCount * 3)
  const finalOf = new Int32Array(nComp)
  const finalGroups = new Array(finalCount)
  for (let q = 0; q < finalCount; q++) {
    const k = live[q]
    finalRgb[q * 3] = fillRgb[k * 3]
    finalRgb[q * 3 + 1] = fillRgb[k * 3 + 1]
    finalRgb[q * 3 + 2] = fillRgb[k * 3 + 2]
    finalGroups[q] = groups[k]
    for (const c of groups[k].members) finalOf[c] = q
  }

  /* 纯度：Σ(x-μ)² = Σ[(x-μ块)² + 面积×(μ块-μ)²]。
     用重编号之后的最终色号来算：色块内部越是一致，纯度越接近 1；
     把两个不同的东西糊成一块会把纯度拉下来。 */
  const total = new Float64Array(3)
  const totalSq = new Float64Array(3)
  for (let i = 0; i < n; i++) {
    const o = i * 3
    for (let k = 0; k < 3; k++) { total[k] += orig[o + k]; totalSq[k] += orig[o + k] * orig[o + k] }
  }
  let grand = 0
  for (let k = 0; k < 3; k++) {
    const m = total[k] / n
    grand += totalSq[k] - n * m * m
  }
  let within = 0
  for (const g of finalGroups) {
    const a = g.area || 1
    for (const c of g.members) {
      const ca = area[c] || 1
      const mr = sum[c * 3] / ca
      const mg = sum[c * 3 + 1] / ca
      const mb = sum[c * 3 + 2] / ca
      const ss = sumSq[c] - ca * (mr * mr + mg * mg + mb * mb)
      within += (ss > 0 ? ss : 0)
    }
  }
  const purity = grand > 0 ? clamp01(1 - within / grand) : 1

  return { rgb: finalRgb, count: finalCount, purity, fillOf: finalOf, comp }
}

/* ---------------------------------------------------------------- 指标 */

/** 抽样算「输出 vs 原图邻域平均色」的平均 ΔE00（远看像不像）与色相偏移 */
function fidelityOf(orig, out, w, h, stride) {
  const step = Math.max(1, stride | 0)
  let dE = 0
  let n = 0
  const hues = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (i % step) continue
      // 原图 3×3 邻域均值：拼豆是颗粒介质，人眼看到的是邻域平均色
      let ar = 0, ag = 0, ab = 0, an = 0
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const o = (yy * w + xx) * 3
          ar += orig[o]; ag += orig[o + 1]; ab += orig[o + 2]; an++
        }
      }
      const o = i * 3
      const lab1 = rgbToLab(ar / an, ag / an, ab / an)
      const lab2 = rgbToLab(out[o] | 0, out[o + 1] | 0, out[o + 2] | 0)
      dE += deltaE2000(lab1, lab2)
      n++
      const c1 = Math.sqrt(lab1[1] * lab1[1] + lab1[2] * lab1[2])
      const c2 = Math.sqrt(lab2[1] * lab2[1] + lab2[2] * lab2[2])
      if (c1 > 8 && c2 > 8) {
        let dh = Math.atan2(lab2[2], lab2[1]) - Math.atan2(lab1[2], lab1[1])
        while (dh > Math.PI) dh -= 2 * Math.PI
        while (dh < -Math.PI) dh += 2 * Math.PI
        hues.push(Math.abs(dh) * 180 / Math.PI)
      }
    }
  }
  hues.sort((a, b) => a - b)
  return {
    meanDeltaE: n ? dE / n : 0,
    /** 色相偏移中位数（度）：写实→卡通最容易在这一点上"编"出原图没有的颜色 */
    hueShift: hues.length ? hues[hues.length >> 1] : 0
  }
}

/** 结构一致度：原图与输出的梯度幅值图做相关（抽样）。掉下去 = 结构被改了 */
function structureOf(gA, gB, stride) {
  const step = Math.max(1, stride | 0)
  let n = 0, sa = 0, sb = 0
  const A = [], B = []
  for (let i = 0; i < gA.length; i += step) { A.push(gA[i]); B.push(gB[i]); sa += gA[i]; sb += gB[i]; n++ }
  if (!n) return 0
  const ma = sa / n, mb = sb / n
  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) {
    const a = A[i] - ma, b = B[i] - mb
    cov += a * b; va += a * a; vb += b * b
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0
}

/* ---------------------------------------------------------------- 主入口 */

/**
 * 照片 → 卡通形象。
 *
 * @param {Uint8ClampedArray} rgba 源图 RGBA（与 pattern.js 的 readImagePixels 同格式）
 * @param {number} sw @param {number} sh
 * @param {object} opts { style: 'standard' | 预设对象, maxSide }
 *        maxSide 是显式覆盖（评测脚本扫参数用）；不传就是 CARTOON_MAX_SIDE。
 * @returns {{ data: Uint8ClampedArray, width: number, height: number, meta: object }}
 *          data 与源图**同尺寸**（最近邻放大，不产生新的中间色），可直接喂给拼豆引擎。
 */
export function cartoonize(rgba, sw, sh, opts = {}) {
  if (!(sw > 0 && sh > 0) || !rgba || rgba.length < sw * sh * 4) {
    return { data: rgba, width: sw, height: sh, meta: null }
  }
  const t0 = Date.now()
  const style = cartoonStyle(opts.style)

  // 1. 工作分辨率
  const work = toWork(rgba, sw, sh, opts.maxSide || CARTOON_MAX_SIDE)
  const w = work.w
  const h = work.h
  const orig = work.rgb
  const n = w * h

  // 2. 保边平滑
  const Y0 = lumaOf(orig, w, h)
  const smooth = bilateral(orig, Y0, w, h, style)
  const Ys = lumaOf(smooth, w, h)

  /* 3. 轮廓线：Sobel → 非极大值抑制（细化成 1px 线）→ 双阈值滞后。
        滞后保证线是**连着的**（不会断断续续），但每条线画多实由原图的梯度强度决定
        —— 所以弱纹理会自动淡出，轮廓才是实线。 */
  const skel = edgeSkeleton(Ys, w, h)

  /* 线上的强度（0~1）。阈值取"骨架分布的高分位"，不是 0.9 那种分位 —— 实测骨架里
     90% 以上的像素是接近 0 的浮点噪声（平坦区 Sobel 响应落成 1/4 的零头），
     0.9 分位几乎等于 0。0.99 分位才代表"画面里真正的强边缘有多强"，
     用它当尺子，换一张低对比照片同样成立。

     强度曲线要**尽快爬到实心**：原来从 weakTh 一路线性淡入到 1.6×strongTh，
     结果一条轮廓线上大部分像素只拿到 20%~40% 的墨色，画出来是一圈灰蒙蒙的虚边
     ——那正是照片"糊了一层脏东西"的观感。改成在 0.5~1.2 倍 strongTh 这段窄区间内
     从 0 冲到 1：过了 strongTh 就是实心线，只有很弱的边才留一点点墨。 */
  const edgeRef = quantileOf(skel, 0.99)
  const strongTh = Math.max(3, edgeRef * 0.32)
  const weakTh = Math.max(1.5, edgeRef * 0.15)
  const edge = hysteresisEdge(skel, w, h, strongTh, weakTh)
  const inkStrength = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (edge[i]) inkStrength[i] = smoothstep(strongTh * 0.5, strongTh * 1.2, skel[i])
  }
  /* 高光不是轮廓。玻璃/塑料的反光在原图里是**亮**的，而 Sobel 只看"差多少"，
     所以高光的边界和物体真正的轮廓一样强 —— 不加区分的话，一颗南瓜会被描成
     "每一个反光点都套一个黑圈"，脸上也会每个高光一个黑边。
     判据：这个像素是不是明显比它周围更亮。是就不落墨，而且线也不许穿过去
     （否则会沿着高光的轮廓描一圈）。 */
  const blocked = highlightMask(Y0, w, h)
  const inkField = style.ink ? growInk(inkStrength, blocked, w, h, style.inkWidth) : inkStrength

  // 4. 颜色分区（标签来自平滑图）
  const { label: clusterLabel, count: clusterCount } = clusterColors(smooth, w, h, style.levels)

  // 5. 平涂：同标签但不相连的色块各自取原图均值，小碎块并进邻块（见 chunkFills 说明）
  const minChunk = style.minChunk || Math.max(8, Math.round(n * 0.0006))
  const flat = chunkFills(orig, clusterLabel, w, h, clusterCount, minChunk)
  const fillCount = flat.count
  const fillOf = flat.fillOf
  const label = new Int32Array(n)
  for (let i = 0; i < n; i++) label[i] = fillOf[flat.comp[i]]

  /* 每块色块的两个颜色：
       · 平涂色 = 该色块原图像素均值（可轻微提饱和，以灰度为轴缩放，色相角不变）
       · 描边色 = **平滑图**在这一点自己的颜色压暗（不是整块的均值）。
         线正好骑在两个色块的边界上，用哪一块的均值都会把线染成其中一边的颜色；
         用平滑图在**该像素**的局部色，线在物体内侧偏物体的暗调、外侧偏背景的暗调，
         看起来才像"画上去的一条线"而不是"糊上去的一块色"。 */
  const sat = style.saturate || 1
  const inkDarken = style.inkDarken != null ? style.inkDarken : 0.5
  const inkMix = style.inkMix != null ? style.inkMix : 0
  const fillRgb = new Float32Array(fillCount * 3)
  for (let l = 0; l < fillCount; l++) {
    let r = flat.rgb[l * 3], g = flat.rgb[l * 3 + 1], b = flat.rgb[l * 3 + 2]
    if (sat !== 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      r = gray + (r - gray) * sat
      g = gray + (g - gray) * sat
      b = gray + (b - gray) * sat
    }
    fillRgb[l * 3] = Math.max(0, Math.min(255, r))
    fillRgb[l * 3 + 1] = Math.max(0, Math.min(255, g))
    fillRgb[l * 3 + 2] = Math.max(0, Math.min(255, b))
  }
  const inkRgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const o = i * 3
    let r = smooth[o], g = smooth[o + 1], b = smooth[o + 2]
    if (sat !== 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      r = gray + (r - gray) * sat
      g = gray + (g - gray) * sat
      b = gray + (b - gray) * sat
    }
    r = Math.max(0, Math.min(255, r))
    g = Math.max(0, Math.min(255, g))
    b = Math.max(0, Math.min(255, b))
    // 这一点越灰，线条越接近纯黑；越鲜艳越保留自己的暗调
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const col = inkMix * (mx > 0 ? 1 - (mx - mn) / mx : 0)
    const t = inkDarken + (0.22 - inkDarken) * col
    inkRgb[o] = r * t
    inkRgb[o + 1] = g * t
    inkRgb[o + 2] = b * t
  }

  /* 6. 特征锚点：细节强度（原图 − 盒式模糊）先做 3×3 平均再取分位数门限。
        最强的那些再补一层实心化 —— 眼睛/高光在原图里本来就是一团同色，
        实心化让它们不要被平涂与描边稀释掉（否则眼睛会变成一圈灰边）。
        `detailCoreQuantile` 决定"多强才算特征的核心"：调高它，被整块保留的区域变小，
        脸不会被拉花；调低它，眼睛更完整。

        细节强度按**三通道最大差**算，不是只看亮度：东亚人的眼睛与周围皮肤的**亮度**很接近
        （瞳孔深棕 vs 肤色，差不多都在 60~70 个灰度级上），只看亮度会把眼睛判成"没细节"
        而整块平涂掉 —— 实测就是这一条让脸变成一块平的肉色。按通道最大差算，
        眼睛相对皮肤在色度上的差异（R 与 B 的差）会被抓住。 */
  const blurR = boxBlurF(orig, w, h, Math.max(2, (style.radius | 0) + 1), 0)
  const blurG = boxBlurF(orig, w, h, Math.max(2, (style.radius | 0) + 1), 1)
  const blurB = boxBlurF(orig, w, h, Math.max(2, (style.radius | 0) + 1), 2)
  const detail = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const dr = Math.abs(orig[o] - blurR[i])
    const dg = Math.abs(orig[o + 1] - blurG[i])
    const db = Math.abs(orig[o + 2] - blurB[i])
    detail[i] = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db)
  }
  const detailBlob = boxBlurF(detail, w, h, 1)
  const dFloor = Math.max(4, quantileOf(detailBlob, style.detailQuantile))
  const dCore = Math.max(dFloor, quantileOf(detailBlob, style.detailCoreQuantile || 0.99))

  /* 7. 逐像素合成：平涂色 → 叠描边 → 贴回特征。
        描边强度 = 原图梯度在 [weakTh, strongTh] 之间的归一化位置 × ink。
        梯度足够强的地方线是实心的，弱的地方线自己淡出，不会满屏都是灰边。 */
  const out = new Float32Array(n * 3)
  let inkSum = 0
  let anchorSum = 0
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const l = label[i]
    /* 描边不透明度：线本来就落在两个色块的边界上，所以按"两侧谁更暗"来收力。
       原图自带深色轮廓时（拼豆风格的插画、深色头发、黑色靴子），再往上刷一层墨
       只会把画面压成一团黑 —— 实测这种图的结构一致度会从 0.92 掉到 0.28。
       暗的地方少刷一点，让原本就有的深色自己去当那条线。 */
    const fr = fillRgb[l * 3], fg = fillRgb[l * 3 + 1], fb = fillRgb[l * 3 + 2]
    const fl = (0.299 * fr + 0.587 * fg + 0.114 * fb) / 255
    const inkA = style.ink * inkField[i] * Math.pow(fl, style.inkYield != null ? style.inkYield : 0.75)
    /* 特征锚点：强细节整块用原像素（保持"实"），弱一点的按比例回贴。
       原来只做渐变回贴，眼睛周围会拖出一圈半透明的照片残影 —— 那看起来像"描歪了"，
       而不像画上去的五官。 */
    let anchorA = style.detailKeep
      ? style.detailKeep * smoothstep(dFloor, dFloor * 2.2, detailBlob[i])
      : 0
    if (style.detailSolid && detailBlob[i] >= dCore) {
      anchorA = Math.max(anchorA, style.detailSolid)
    }
    inkSum += inkA
    anchorSum += anchorA
    for (let k = 0; k < 3; k++) {
      const base = fillRgb[l * 3 + k]
      let c = base + (inkRgb[o + k] - base) * inkA
      // 特征锚点贴回**原图像素**：眼睛/文字/高光因此不会被执行平涂吃掉
      c += (orig[o + k] - c) * anchorA
      out[o + k] = c < 0 ? 0 : c > 255 ? 255 : c
    }
  }

  // 指标（抽样，够用且便宜）
  const stride = Math.max(1, Math.round(n / 6000))
  const fid = fidelityOf(orig, out, w, h, stride)
  const structure = structureOf(sobelMag(Y0, w, h), sobelMag(lumaOf(out, w, h), w, h), stride)

  /* 放大回源图分辨率：目标像素取落在它中心的那个工作像素的**中心**（最近邻）。
     采样点取"中心"而不是块左上角，缩放比例不是整数时也不会把描边整体带偏半格；
     一个输出像素只来自一个工作像素，所以放大过程不引入任何新的中间色。 */
  const data = new Uint8ClampedArray(sw * sh * 4)
  const xs = new Int32Array(sw)
  for (let x = 0; x < sw; x++) {
    xs[x] = Math.min(w - 1, Math.max(0, Math.floor(((x + 0.5) * w) / sw)))
  }
  for (let y = 0; y < sh; y++) {
    const wy = Math.min(h - 1, Math.max(0, Math.floor(((y + 0.5) * h) / sh))) * w
    for (let x = 0; x < sw; x++) {
      const si = (wy + xs[x]) * 3
      const o = (y * sw + x) * 4
      data[o] = out[si]
      data[o + 1] = out[si + 1]
      data[o + 2] = out[si + 2]
      data[o + 3] = rgba[o + 3]
    }
  }

  return {
    data,
    width: sw,
    height: sh,
    meta: {
      style: style.key || 'custom',
      styleLabel: style.label || '自定义',
      width: w,
      height: h,
      levels: fillCount,
      /** 平均描边强度 / 平均特征回贴强度：界面用它如实说明"做了什么" */
      inkShare: Math.round((inkSum / n) * 1000) / 1000,
      anchorShare: Math.round((anchorSum / n) * 1000) / 1000,
      meanDeltaE: Math.round(fid.meanDeltaE * 100) / 100,
      hueShift: Math.round(fid.hueShift * 10) / 10,
      structure: Math.round(structure * 1000) / 1000,
      purity: Math.round(flat.purity * 1000) / 1000,
      /** 平涂色的真实色值（按面积从大到小）：自检脚本用它核对"没有编造颜色" */
      palette: topFills(fillRgb, fillCount, flat.fillOf, flat.comp, n, 12),
      ms: Date.now() - t0
    }
  }
}

/**
 * 平涂色按面积排序后取前几个的真实色值。
 * 自检脚本拿它核对"输出的颜色都能追到原图"——每个 hex 都在下面这份清单里，
 * 说明界面报出来的颜色不是随手编的。
 *
 * 面积按"上色单位"统计，而不是按色块自身的像素数：一块色块并进几个小碎块之后，
 * 它在界面上占的面积应该把那些碎块也算上，否则色号清单里的占比是假的。
 */
function topFills (rgb, fillCount, fillOf, comp, n, limit) {
  const area = new Float64Array(fillCount)
  for (let i = 0; i < n; i++) area[fillOf[comp[i]]]++
  const idx = []
  for (let l = 0; l < fillCount; l++) if (area[l] > 0) idx.push(l)
  idx.sort((a, b) => area[b] - area[a])
  return idx.slice(0, limit).map(l => ({
    hex: rgbToHex(rgb[l * 3], rgb[l * 3 + 1], rgb[l * 3 + 2]),
    share: Math.round((area[l] / n) * 1000) / 1000
  }))
}
