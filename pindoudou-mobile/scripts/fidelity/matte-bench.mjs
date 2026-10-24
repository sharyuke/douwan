/* =========================================================================
   自动抠背景（src/lib/matte.js）精度评测（开发用，Node 直接跑，不需要浏览器）

   为什么这么搭：抠背景的产物是「源图分辨率的 0~1 α 图」+「每格放不放豆」。
   只用肉眼看，很容易出现「这张抠干净了、那张把主体吃了」而没人发现。
   这里用一批**带真值掩膜**的合成图（scripts/fidelity/fixtures-gen-cut.py 生成，
   真值 mask = 该图真正的合成覆盖率），把「改之前 / 改之后」变成可比较的数字。

   为什么能在 Node 里跑：src/lib/matte.js 是纯函数（无 DOM、无随机），
   所以这里跑的就是线上那一份算法代码，不是另写一套。
   PNG 读写与 bench.mjs 共用 scripts/fidelity/png.mjs（逐位一致的同一份实现）。

   指标口径（详见各函数注释）：
     iou         二值化 IoU：alpha>=0.5 vs mask>=128
     pixelAcc    逐像素二值一致率
     boundaryF1  真值边界(1px 轮廓像素)与预测边界的 F1，2 像素容差（欧氏距离变换）
     alphaMAE    预测 α 与真值 α 的平均绝对误差（只有 cut_soft_edge 有意义 → 只在那张算）
     cellAcc     按 29x29 网格聚合（格子主体覆盖率 = 该格真值 α 均值），
                 用当前档位的 emptyShare 判「放豆/不放豆」，与真值同口径判定的结果比一致率
     fineCellAcc 同上，但按 300x300 网格聚合 —— 也就是**精细档**画布下的判定一致率。
                 为什么要多这一列：掩膜分辨率以前固定 384，300 格时一个掩膜像素横跨 0.78 格，
                 「这一格放不放豆」基本是插值猜的；掩膜跟着源图走（matteMaxSide，384~1024）
                 之后这个数才代表真实精度。用 --maxside 384 可以跑出改动前的基线。
     cellIoU     同上二值化的 IoU（空格 / 放豆）
     bboxErr     预测 bbox 与真值 bbox 四边平均像素误差（真值 bbox 由 mask>=128 现算）
     ms          estimateMatte 单次耗时

   用法：
     node scripts/fidelity/matte-bench.mjs --level normal --label cut-normal
     node scripts/fidelity/matte-bench.mjs --level normal --label cut-normal --render
     node scripts/fidelity/matte-bench.mjs --level soft   --label cut-soft
     node scripts/fidelity/matte-bench.mjs --level strong --label cut-strong --render
     node scripts/fidelity/matte-bench.mjs --label cut-384 --maxside 384   # 改动前的基线

   参数：
     --level soft|normal|strong  档位（默认 normal），同时决定 cellAcc 用的 emptyShare
     --label <名字>              产物名前缀：out/matte-<label>.json 与 out/matte-<label>-<图名>.png
     --maxside <像素>            显式指定掩膜边长，复现旧基线用（默认不传 = 跟库里的
                                 matteMaxSide 走：源图分辨率，夹在 384~1024）
     --no-shadow                 关掉「阴影清除」那一步，得到改之前的基线。
                                 实现方式是把档位的 shadowFloor 抬到 1（纯数据开关，
                                 不改生产代码路径），于是同一份 fixture 能直接跑出
                                 「有阴影清除 / 没有阴影清除」两组可比数字。
     --render                    把每张图的「原图 | 预测掩膜 | 真值掩膜」拼一张 PNG 落盘
                                 另外也会拼一张 1200x900 合成图（matte-<label>-big1200x900.png）
     --dump-big                  把 1200x900 合成图本身落盘成 out/big1200x900.png（用于单独复测耗时）

   注意：没有真值的图（photo_pumpkin 等）不走指标，只在最后打一段"[无真值·定性]"，
   给出 ok / bgShare / confidence / clusters / 主体占比 / bbox / 耗时 —— 真实照片只能这样看。
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { estimateMatte, MATTE_LEVELS, matteLevel, matteMaxSide } from '../../src/lib/matte.js'
import { readPNG, writePNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')
const OUT = path.join(HERE, 'out')

const GW = 29
const GH = 29
/** 精细档画布下的判定口径（见文件头 fineCellAcc）：300 格长边 */
const FINE_GRID = 300
/** 大图（1200×900，解析式真值）额外报这几档画布下的判定一致率 —— 掩膜分辨率的价值在这几档上才看得出来 */
const BIG_GRIDS = [29, 300, 1000]
const BOUNDARY_TOL = 2 // 边界 F1 的容差（像素）
const RENDER_H = 240 // --render 每格高度

/* ------------------------------------------------------------ 命令行 */

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : fallback
}

/* ------------------------------------------------------------ 小工具 */

function mean(arr) {
  if (!arr.length) return null
  let s = 0
  for (const v of arr) s += v
  return s / arr.length
}

function round(v, d = 4) {
  if (v === null || v === undefined || !Number.isFinite(v)) return v
  const k = 10 ** d
  return Math.round(v * k) / k
}

/** 真值 mask（灰度 0~255）→ 0~1 的 α */
function maskToAlpha(img) {
  const n = img.width * img.height
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = img.data[i * 4] / 255
  return out
}

/**
 * 精确欧氏距离变换（Felzenszwalb & Huttenlocher 2012，两趟一维抛物线下包络）。
 * 返回 f[i] = 该像素到最近「0 像素」的欧氏距离（非 0 像素自身距离为 0）。
 * 比 8 邻域 BFS 准：BFS 的整数距离在斜方向会高估约 8%，
 * 而边界 F1 是「2 像素容差」这种紧容差指标，误差会直接变成假阴性。
 */
function edtDistances(bin, w, h) {
  const INF = 1e20
  const f = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) f[i] = bin[i] ? INF : 0

  const maxD = Math.max(w, h) + 1
  const dt = new Float64Array(maxD)
  const vt = new Int32Array(maxD)
  const zz = new Float64Array(maxD + 1)

  const dt1d = (src, len, step, dst) => {
    let k = 0
    vt[0] = 0
    zz[0] = -INF
    zz[1] = INF
    for (let q = 1; q < len; q++) {
      let s = ((src[q * step] + q * q) - (src[vt[k] * step] + vt[k] * vt[k])) / (2 * q - 2 * vt[k])
      while (s <= zz[k]) {
        k--
        s = ((src[q * step] + q * q) - (src[vt[k] * step] + vt[k] * vt[k])) / (2 * q - 2 * vt[k])
      }
      k++
      vt[k] = q
      zz[k] = s
      zz[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (zz[k + 1] < q) k++
      const d = q - vt[k]
      dst[q * step] = d * d + src[vt[k] * step]
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) dt[y] = f[y * w + x]
    dt1d(dt, h, 1, dt)
    for (let y = 0; y < h; y++) f[y * w + x] = dt[y]
  }
  for (let y = 0; y < h; y++) {
    const row = f.subarray(y * w, y * w + w)
    dt1d(row, w, 1, row)
  }
  for (let i = 0; i < w * h; i++) f[i] = Math.sqrt(f[i])
  return f
}

/**
 * 二值边界像素集合：与 4 邻域任一邻居取值不同，即为边界。
 * 图像边缘上的像素如果邻居越界，不算边界（否则整圈图像边框都会进集合）。
 */
function boundarySet(bin, w, h) {
  const out = new Uint8Array(w * h)
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = bin[i]
      let isEdge = false
      if (x > 0 && bin[i - 1] !== v) isEdge = true
      else if (x < w - 1 && bin[i + 1] !== v) isEdge = true
      else if (y > 0 && bin[i - w] !== v) isEdge = true
      else if (y < h - 1 && bin[i + w] !== v) isEdge = true
      if (isEdge) { out[i] = 1; n++ }
    }
  }
  return { set: out, count: n }
}

/** 二值 IoU；两边都空时约定 1 */
function iou(a, b) {
  let inter = 0, uni = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (x && y) inter++
    if (x || y) uni++
  }
  return uni ? inter / uni : 1
}

/**
 * 边界 F1（口径写清楚，免得以后看不懂数字）：
 *   T = 真值边界像素（mask>=128 的 1px 轮廓），P = 预测边界像素（alpha>=0.5 的 1px 轮廓）
 *   容差带 = BOUNDARY_TOL(2) 像素：只要到对方集合的**欧氏**距离 ≤ 2 就算匹配
 *   precision = |{p∈P : d(p,T) ≤ 2}| / |P|
 *   recall    = |{t∈T : d(t,P) ≤ 2}| / |T|
 *   F1 = 2PR/(P+R)
 * 分子分母都为 0 时约定 F1 = 1（空 vs 空 = 完全一致）。
 * 注意：它只乘了 1 倍容差（不是 2 倍带），所以报告里的 F1 会比"带宽口径"略保守。
 */
function boundaryF1(truthBin, predBin, w, h) {
  const t = boundarySet(truthBin, w, h)
  const p = boundarySet(predBin, w, h)
  if (!t.count && !p.count) return { f1: 1, precision: 1, recall: 1, truthCount: 0, predCount: 0 }
  const dT = edtDistances(t.set, w, h) // 每个像素到真值边界的距离
  const dP = edtDistances(p.set, w, h) // 每个像素到预测边界的距离
  let hitP = 0
  for (let i = 0; i < p.set.length; i++) if (p.set[i] && dT[i] <= BOUNDARY_TOL) hitP++
  let hitT = 0
  for (let i = 0; i < t.set.length; i++) if (t.set[i] && dP[i] <= BOUNDARY_TOL) hitT++
  const precision = p.count ? hitP / p.count : 1
  const recall = t.count ? hitT / t.count : 1
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0
  return { f1, precision, recall, truthCount: t.count, predCount: p.count }
}

/** 积分图：I[y*(w+1)+x] = 左上角 (x,y) 区域的和，用于 O(1) 求任意矩形均值 */
function integral(arr, w, h) {
  const iw = w + 1
  const I = new Float64Array(iw * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += arr[y * w + x]
      I[(y + 1) * iw + (x + 1)] = I[y * iw + (x + 1)] + rowSum
    }
  }
  return { I, iw }
}

function rectMean(int, x0, y0, x1, y1) {
  const { I, iw } = int
  const s = I[y1 * iw + x1] - I[y0 * iw + x1] - I[y1 * iw + x0] + I[y0 * iw + x0]
  return s / ((x1 - x0) * (y1 - y0))
}

/**
 * NxN 网格口径（和拼豆引擎一致）：格子 (cx,cy) 覆盖源图的
 * [floor(cx*w/N), floor((cx+1)*w/N)) 段像素，格子主体覆盖率 = 该格真值 α 的均值，
 * 覆盖率 < emptyShare 判「空格」，否则「放豆」。真值与预测用**同一口径同一阈值**。
 *
 * gridN 默认 29（默认档画布）；精细档传 300，用来量"掩膜分辨率够不够撑住精细档"。
 */
function cellMetrics(truthAlpha, predAlpha, w, h, emptyShare, gridN = GW) {
  const ti = integral(truthAlpha, w, h)
  const pi = integral(predAlpha, w, h)
  const N = gridN
  const bounds = (n, i) => [Math.floor((i * n) / N), Math.max(Math.floor((i * n) / N) + 1, Math.floor(((i + 1) * n) / N))]
  let agree = 0
  let truthCells = 0
  let predCells = 0
  let inter = 0
  const diffs = []
  for (let cy = 0; cy < N; cy++) {
    const [y0, y1] = bounds(h, cy)
    for (let cx = 0; cx < N; cx++) {
      const [x0, x1] = bounds(w, cx)
      const tc = rectMean(ti, x0, y0, x1, y1)
      const pc = rectMean(pi, x0, y0, x1, y1)
      const tb = tc >= emptyShare
      const pb = pc >= emptyShare
      if (tb === pb) agree++
      if (tb) truthCells++
      if (pb) predCells++
      if (tb && pb) inter++
      diffs.push(Math.abs(tc - pc))
    }
  }
  const uni = truthCells + predCells - inter
  return {
    cellAcc: agree / (N * N),
    cellIoU: uni ? inter / uni : 1,
    cellTruthShare: truthCells / (N * N),
    cellPredShare: predCells / (N * N),
    cellShareMAE: mean(diffs)
  }
}

/** 由二值掩膜现算紧包围盒（x0,y0,x1,y1 半开区间？不：x1/y1 是闭区间右/下边界像素坐标） */
function tightBBox(bin, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** 四边平均像素误差：上/左/右/下四条边的偏移量取平均（把矩形的平移与缩放都算进去） */
function bboxError(pred, truth) {
  if (!pred || !truth) return null
  const dx0 = Math.abs(pred.x - truth.x)
  const dy0 = Math.abs(pred.y - truth.y)
  const dx1 = Math.abs((pred.x + pred.w) - (truth.x + truth.w))
  const dy1 = Math.abs((pred.y + pred.h) - (truth.y + truth.h))
  return (dx0 + dy0 + dx1 + dy1) / 4
}

/** 按同样的 margin 把真值框外扩一圈（对齐算法"留呼吸边"的设计） */
function padBox(box, margin, w, h) {
  if (!box) return null
  const mx = box.w * margin
  const my = box.h * margin
  const x = Math.max(0, Math.floor(box.x - mx))
  const y = Math.max(0, Math.floor(box.y - my))
  const x1 = Math.min(w, Math.ceil(box.x + box.w + mx))
  const y1 = Math.min(h, Math.ceil(box.y + box.h + my))
  return { x, y, w: x1 - x, h: y1 - y }
}

/* ------------------------------------------------------------ --render */

/** 把 RGB 缓冲区裁剪/缩放成高 targetH 的竖条（最近邻，够看形状就行） */
function scaleToHeight(rgb, w, h, targetH) {
  const scale = targetH / h
  const tw = Math.max(1, Math.round(w * scale))
  const out = new Uint8ClampedArray(tw * targetH * 3)
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale))
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale))
      const o = (y * tw + x) * 3
      const s = (sy * w + sx) * 3
      out[o] = rgb[s]; out[o + 1] = rgb[s + 1]; out[o + 2] = rgb[s + 2]
    }
  }
  return { data: out, w: tw, h: targetH }
}

function grayBuffer(alpha, w, h) {
  const out = new Uint8ClampedArray(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(Math.max(0, Math.min(1, alpha[i])) * 255)
    out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v
  }
  return out
}

/**
 * 横向拼接「原图 | 预测掩膜 | 真值掩膜」，三格各自等比缩放到高 RENDER_H。
 * （原图那一格按当前档位加一条 2px 的分隔线，纯白，便于上眼看边界在哪。）
 */
/**
 * RGBA → RGB。
 * readPNG 的 data 恒为 4 通道，而 scaleToHeight/writePNG 都按 3 通道走。
 * 直接把 readPNG 的 data 传进 scaleToHeight，整张「原图」会按 4/3 的步长错位读，
 * 拼出来的那一格就是一片彩色条纹 —— 曾经真的这样渲染了很久，
 * 让「原图」这一格完全失去参考价值（掩膜两格是对的，所以不容易发现）。
 */
function rgbFromRGBA(data, w, h) {
  const out = new Uint8ClampedArray(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    out[i * 3] = data[i * 4]
    out[i * 3 + 1] = data[i * 4 + 1]
    out[i * 3 + 2] = data[i * 4 + 2]
  }
  return out
}

function renderStrip(file, srcRGBA, srcW, srcH, predAlpha, truthAlpha) {
  const tiles = [
    scaleToHeight(rgbFromRGBA(srcRGBA, srcW, srcH), srcW, srcH, RENDER_H),
    scaleToHeight(grayBuffer(predAlpha, srcW, srcH), srcW, srcH, RENDER_H),
    scaleToHeight(grayBuffer(truthAlpha, srcW, srcH), srcW, srcH, RENDER_H)
  ]
  const SEP = 6
  const W = tiles.reduce((s, t) => s + t.w, 0) + SEP * (tiles.length - 1)
  const out = new Uint8ClampedArray(W * RENDER_H * 3).fill(255)
  let ox = 0
  for (const t of tiles) {
    for (let y = 0; y < RENDER_H; y++) {
      for (let x = 0; x < t.w; x++) {
        const s = (y * t.w + x) * 3
        const d = (y * W + ox + x) * 3
        out[d] = t.data[s]; out[d + 1] = t.data[s + 1]; out[d + 2] = t.data[s + 2]
      }
    }
    ox += t.w + SEP
  }
  writePNG(file, out, W, RENDER_H)
  return { W, H: RENDER_H }
}

/* ------------------------------------------------------------ 合成大图（单独测耗时） */

/**
 * 1200x900 合成图：纵向渐变底 + 一个抗锯齿橙圆（都是解析式，无随机）。
 * 只用来单独报一个耗时 —— 源图越大，downscale 与 ΔE00 的量都线性增长。
 * （--big-render 会把它与预测 α 拼一张图落盘，方便确认这个耗时不是算在空图上。）
 */
function bigImage(w = 1200, h = 900) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  const truth = new Float32Array(w * h)
  const cx = w * 0.5, cy = h * 0.52, r = Math.min(w, h) * 0.34
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1)
    const br = 214 + (208 - 214) * t
    const bg = 232 + (240 - 232) * t
    const bb = 246 + (214 - 246) * t
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      const a = Math.max(0, Math.min(1, r + 0.5 - d))
      rgba[o] = Math.round(237 * a + br * (1 - a))
      rgba[o + 1] = Math.round(124 * a + bg * (1 - a))
      rgba[o + 2] = Math.round(46 * a + bb * (1 - a))
      rgba[o + 3] = 255
      truth[y * w + x] = a
    }
  }
  return { rgba, truth, w, h }
}

/* ------------------------------------------------------------ 主流程 */

function main() {
  const levelKey = String(arg('level', 'normal'))
  const level = matteLevel(levelKey)
  if (!MATTE_LEVELS.some(l => l.key === levelKey)) {
    console.error(`未知档位 ${levelKey}，可选：${MATTE_LEVELS.map(l => l.key).join(' / ')}`)
    process.exit(1)
  }
  const label = String(arg('label', `cut-${levelKey}`))
  const doRender = !!arg('render', false)
  /* 「没有阴影清除」的基线：把阴影的下限抬到 1（永远命中不了），
     生产代码一行都不用改，同一批 fixture 直接跑出可对比的两组数字。 */
  const noShadow = !!arg('no-shadow', false)
  if (noShadow) for (const l of MATTE_LEVELS) l.shadowFloor = 1

  /* 掩膜边长：默认**不传**，让 estimateMatte 走库里的 matteMaxSide（源图分辨率，384~1024）——
     这样这条评测跑的就是用户实际拿到的那条路径。--maxside 384 用来复现改动前的基线。 */
  const maxSideArg = Number(arg('maxside', 0)) || 0
  const matteOpts = side => (maxSideArg > 0
    ? { level: side, maxSide: maxSideArg }
    : { level: side })

  if (!fs.existsSync(FIXTURES)) {
    console.error(`没有测试图目录 ${FIXTURES}，先跑 python scripts/fidelity/fixtures-gen-cut.py`)
    process.exit(1)
  }
  fs.mkdirSync(OUT, { recursive: true })

  // 规则：fixtures/ 下的 PNG 全拿来做素材；带 cut_ 前缀且存在同名 .mask.png 的才算"有真值"，
  // 其余（如 photo_pumpkin）走定性检查 —— 真实照片没有真值，但 bgShare/confidence/ok 仍然要看。
  const files = fs.readdirSync(FIXTURES)
    .filter(f => /\.png$/i.test(f) && !/\.mask\.png$/i.test(f))
    .sort()
  if (!files.some(f => /^cut_/i.test(f))) {
    console.error('没有 cut_*.png 测试图，先跑 python scripts/fidelity/fixtures-gen-cut.py')
    process.exit(1)
  }

  const rows = []
  const qualitative = []

  for (const file of files) {
    const name = file.replace(/\.png$/i, '')
    const img = readPNG(path.join(FIXTURES, file))
    const maskFile = path.join(FIXTURES, `${name}.mask.png`)
    const hasTruth = fs.existsSync(maskFile)

    // 组装 RGBA（评测图都是不透明的 RGB 图，A 补 255）
    const rgba = new Uint8ClampedArray(img.width * img.height * 4)
    for (let i = 0; i < img.width * img.height; i++) {
      rgba[i * 4] = img.data[i * 4]
      rgba[i * 4 + 1] = img.data[i * 4 + 1]
      rgba[i * 4 + 2] = img.data[i * 4 + 2]
      rgba[i * 4 + 3] = 255
    }

    const t0 = performance.now()
    const res = estimateMatte(rgba, img.width, img.height, matteOpts(levelKey))
    const ms = performance.now() - t0

    // 预测 α：ok=false 时按「全部保留」处理（上层就是这么用的），但把 ok 如实报出来
    const predAlpha = res.alpha && res.alpha.length === img.width * img.height
      ? res.alpha
      : new Float32Array(img.width * img.height).fill(1)

    const base = {
      fixture: name,
      size: `${img.width}x${img.height}`,
      hasTruth,
      ok: res.ok,
      reason: res.reason,
      confidence: round(res.confidence, 4),
      bgShare: round(res.bgShare, 4),
      clusters: res.stats ? res.stats.clusters : null,
      maskSide: res.stats ? res.stats.maskSide : null,
      /** 其中投影（阴影）占全图的比例：验证「去掉了影子」时看这个数 */
      shadowShare: round(res.stats ? res.stats.shadowShare || 0 : 0, 4),
      shadowRolledBack: !!(res.stats && res.stats.shadowRolledBack),
      ms: round(ms, 2),
      resultBBox: res.bbox
    }

    if (!hasTruth) {
      // 真实照片：没有真值，只做定性检查（把判定的主体占比也带出来，便于人眼核对）
      let subj = 0
      for (let i = 0; i < predAlpha.length; i++) if (predAlpha[i] >= 0.5) subj++
      qualitative.push({ ...base, predSubjectShare: round(subj / predAlpha.length, 4) })
      rows.push(null)
      continue
    }

    const truthImg = readPNG(maskFile)
    if (truthImg.width !== img.width || truthImg.height !== img.height) {
      throw new Error(`真值 mask 尺寸不匹配：${maskFile}`)
    }
    const truthAlpha = maskToAlpha(truthImg)
    const w = img.width, h = img.height

    const truthBin = new Uint8Array(w * h)
    const predBin = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      truthBin[i] = truthAlpha[i] >= 128 / 255 ? 1 : 0
      predBin[i] = predAlpha[i] >= 0.5 ? 1 : 0
    }

    const iouV = iou(truthBin, predBin)
    let agree = 0
    for (let i = 0; i < w * h; i++) if (truthBin[i] === predBin[i]) agree++
    const pixelAcc = agree / (w * h)

    const bf1 = boundaryF1(truthBin, predBin, w, h)

    let alphaMAE = null
    if (name === 'cut_soft_edge') {
      let s = 0
      for (let i = 0; i < w * h; i++) s += Math.abs(predAlpha[i] - truthAlpha[i])
      alphaMAE = s / (w * h)
    }

    const cells = cellMetrics(truthAlpha, predAlpha, w, h, level.emptyShare)
    const fineCells = cellMetrics(truthAlpha, predAlpha, w, h, level.emptyShare, FINE_GRID)
    const truthBBox = tightBBox(truthBin, w, h)
    // 两个包围盒概念，别混：
    //   · bboxErr      —— 实际参与裁切的那个包围盒（estimateMatte 返回的 res.bbox），
    //                     决定主体在画布里占多大。⚠️ 它天然比真值大一圈：
    //                     算法会按档位留 margin（2%）的呼吸边，所以这里拿
    //                     「真值 bbox 加上同样的 margin」当参照，测的才是算法误差；
    //   · alphaBBoxErr —— 掩膜本身的紧包围盒误差，反映掩膜边缘有没有拖出细须，
    //                     它不影响裁切（裁切走的是稳健包围盒），只作诊断。
    const predBBoxTight = tightBBox(predBin, w, h)
    const alphaBBoxErr = bboxError(predBBoxTight, truthBBox)
    const truthBoxPadded = padBox(truthBBox, level.margin, w, h)
    const bboxErr = res.bbox ? bboxError(res.bbox, truthBoxPadded) : null

    let softPx = 0
    for (let i = 0; i < w * h; i++) if (truthAlpha[i] > 0.02 && truthAlpha[i] < 0.98) softPx++
    let predSoft = 0
    for (let i = 0; i < w * h; i++) if (predAlpha[i] > 0.02 && predAlpha[i] < 0.98) predSoft++

    const row = {
      ...base,
      iou: round(iouV, 4),
      pixelAcc: round(pixelAcc, 4),
      boundaryF1: round(bf1.f1, 4),
      boundaryPrecision: round(bf1.precision, 4),
      boundaryRecall: round(bf1.recall, 4),
      boundaryPixels: { truth: bf1.truthCount, pred: bf1.predCount },
      alphaMAE: alphaMAE === null ? null : round(alphaMAE, 4),
      cellAcc: round(cells.cellAcc, 4),
      cellIoU: round(cells.cellIoU, 4),
      cellShareMAE: round(cells.cellShareMAE, 4),
      fineCellAcc: round(fineCells.cellAcc, 4),
      fineCellIoU: round(fineCells.cellIoU, 4),
      fineCellShareMAE: round(fineCells.cellShareMAE, 4),
      cellTruthShare: round(cells.cellTruthShare, 4),
      cellPredShare: round(cells.cellPredShare, 4),
      truthShare: round(truthBin.reduce((s, v) => s + v, 0) / (w * h), 4),
      predShare: round(predBin.reduce((s, v) => s + v, 0) / (w * h), 4),
      truthSoftShare: round(softPx / (w * h), 4),
      predSoftShare: round(predSoft / (w * h), 4),
      truthBBox,
      predBBoxTight,
      bboxErr: bboxErr === null ? null : round(bboxErr, 2),
      alphaBBoxErr: alphaBBoxErr === null ? null : round(alphaBBoxErr, 2)
    }
    rows.push(row)

    if (doRender) {
      renderStrip(path.join(OUT, `matte-${label}-${name.replace(/^cut_/, '')}.png`),
        img.data, w, h, predAlpha, truthAlpha)
    }
  }

  const scored = rows.filter(Boolean)

  // 单独报一个 1200x900 的耗时（源图更大：downscale + ΔE00 量都更大）
  const big = bigImage()
  const tb = performance.now()
  const bigRes = estimateMatte(big.rgba, big.w, big.h, matteOpts(levelKey))
  const bigMs = performance.now() - tb
  const bigAlpha = bigRes.alpha && bigRes.alpha.length === big.w * big.h
    ? bigRes.alpha
    : new Float32Array(big.w * big.h).fill(1)
  const bigTruthBin = new Uint8Array(big.w * big.h)
  const bigPredBin = new Uint8Array(big.w * big.h)
  let bigMAE = 0
  for (let i = 0; i < big.w * big.h; i++) {
    bigTruthBin[i] = big.truth[i] >= 0.5 ? 1 : 0
    bigPredBin[i] = bigAlpha[i] >= 0.5 ? 1 : 0
    bigMAE += Math.abs(bigAlpha[i] - big.truth[i])
  }
  const bigMetrics = {
    size: `${big.w}x${big.h}`,
    ms: round(bigMs, 2),
    ok: bigRes.ok,
    bgShare: round(bigRes.bgShare, 4),
    confidence: round(bigRes.confidence, 4),
    maskSide: bigRes.stats ? bigRes.stats.maskSide : null,
    iou: round(iou(bigTruthBin, bigPredBin), 4),
    alphaMAE: round(bigMAE / (big.w * big.h), 4),
    /* 大图才看得出「掩膜分辨率」到底值多少：这张 1200×900 的合成图一格真值 α 是解析式给的，
       29 / 300 / 1000 三个画布档下的判定一致率一起打出来 —— 精细档（1000 格）下
       掩膜 384 时一个掩膜像素只覆盖 0.38 格，判定基本靠插值；跟源图走（1024）才有 1.02 格/像素。 */
    cellAccByGrid: Object.fromEntries(BIG_GRIDS.map(N => {
      const m = cellMetrics(big.truth, bigAlpha, big.w, big.h, level.emptyShare, N)
      return [N, { cellAcc: round(m.cellAcc, 4), cellShareMAE: round(m.cellShareMAE, 4) }]
    }))
  }
  if (doRender) {
    renderStrip(path.join(OUT, `matte-${label}-big1200x900.png`), big.rgba, big.w, big.h, bigAlpha, big.truth)
  }
  if (arg('dump-big', false)) {
    // 把那张 1200x900 合成图落盘成真 PNG，方便用别的脚本单独复测耗时
    const rgb = new Uint8ClampedArray(big.w * big.h * 3)
    for (let i = 0; i < big.w * big.h; i++) {
      rgb[i * 3] = big.rgba[i * 4]; rgb[i * 3 + 1] = big.rgba[i * 4 + 1]; rgb[i * 3 + 2] = big.rgba[i * 4 + 2]
    }
    const f = path.join(OUT, 'big1200x900.png')
    writePNG(f, rgb, big.w, big.h)
    console.log('已落盘合成大图:', f)
  }

  const avg = key => mean(scored.map(r => r[key]).filter(v => typeof v === 'number'))
  const med = key => {
    const a = scored.map(r => r[key]).filter(v => typeof v === 'number').sort((x, y) => x - y)
    if (!a.length) return null
    const m = a.length >> 1
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
  }
  const average = {
    iou: round(avg('iou'), 4),
    pixelAcc: round(avg('pixelAcc'), 4),
    boundaryF1: round(avg('boundaryF1'), 4),
    cellAcc: round(avg('cellAcc'), 4),
    cellIoU: round(avg('cellIoU'), 4),
    fineCellAcc: round(avg('fineCellAcc'), 4),
    fineCellIoU: round(avg('fineCellIoU'), 4),
    bboxErr: round(avg('bboxErr'), 2),
    ms: round(avg('ms'), 2),
    maskSide: round(avg('maskSide'), 0),
    images: scored.length
  }
  // 中位数：noise_bg 这种单张崩掉的用例会把均值拉得很偏，中位数更能代表"典型表现"
  const median = {
    iou: round(med('iou'), 4),
    boundaryF1: round(med('boundaryF1'), 4),
    cellAcc: round(med('cellAcc'), 4),
    fineCellAcc: round(med('fineCellAcc'), 4),
    bboxErr: round(med('bboxErr'), 2)
  }

  const payload = {
    label,
    level: levelKey,
    at: new Date().toISOString(),
    shadowOff: noShadow,
    matte: {
      maxSide: maxSideArg > 0 ? maxSideArg : `adaptive(matteMaxSide, ≤${matteMaxSide(99999, 99999)})`,
      emptyShare: level.emptyShare,
      tolerance: level.tolerance,
      unknownRadius: level.unknownRadius
    },
    boundaryTol: BOUNDARY_TOL,
    grid: `${GW}x${GH}`,
    fineGrid: `${FINE_GRID}x${FINE_GRID}`,
    bigImage: bigMetrics,
    average,
    median,
    rows: scored,
    qualitative
  }
  const jsonFile = path.join(OUT, `matte-${label}.json`)
  fs.writeFileSync(jsonFile, JSON.stringify(payload, null, 2))

  /* ---- 打印 ---- */
  const P = (v, d = 3) => (v === null || v === undefined ? '  n/a' : v.toFixed(d))
  console.log(`\n===== 抠背景精度评测 ${label}（档位=${levelKey} ${level.label}，emptyShare=${level.emptyShare}，边界容差=${BOUNDARY_TOL}px）=====`)
  console.log(`掩膜边长：${maxSideArg > 0 ? `固定 ${maxSideArg}（旧基线）` : 'matteMaxSide（跟源图走，384~1024）'}；` +
    `cellAcc 口径 ${GW}×${GH}（默认档），fineAcc 口径 ${FINE_GRID}×${FINE_GRID}（精细档）`)
  console.log('图                 尺寸  掩膜   ok    IoU   pixAcc   bF1    cellAcc  fineAcc  bboxErr  aMAE    耗时ms  bgShare conf')
  for (const r of rows) {
    if (!r) continue // 无真值的图（真实照片）下面单独打
    console.log(
      r.fixture.replace(/^cut_/, '').padEnd(18) +
      r.size.padStart(9) +
      String(r.maskSide == null ? '-' : r.maskSide).padStart(6) +
      (r.ok ? '   ✓  ' : '   ✗  ') +
      P(r.iou).padStart(6) +
      P(r.pixelAcc).padStart(8) +
      P(r.boundaryF1).padStart(7) +
      P(r.cellAcc).padStart(9) +
      P(r.fineCellAcc).padStart(9) +
      (r.bboxErr === null ? '   n/a' : r.bboxErr.toFixed(1).padStart(8)) +
      (r.alphaMAE === null ? '    -' : r.alphaMAE.toFixed(4).padStart(8)) +
      r.ms.toFixed(0).padStart(8) +
      r.bgShare.toFixed(3).padStart(9) +
      r.confidence.toFixed(3).padStart(6)
    )
  }
  console.log('-'.repeat(126))
  console.log(
    `平均(${average.images} 张真值图)`.padEnd(27) +
    String(average.maskSide == null ? '-' : average.maskSide).padStart(6) +
    '      ' +
    P(average.iou).padStart(6) +
    P(average.pixelAcc).padStart(8) +
    P(average.boundaryF1).padStart(7) +
    P(average.cellAcc).padStart(9) +
    P(average.fineCellAcc).padStart(9) +
    (average.bboxErr === null ? '   n/a' : average.bboxErr.toFixed(1).padStart(8)) +
    ''.padStart(8) +
    average.ms.toFixed(0).padStart(8)
  )
  // 中位数：noise_bg 这种单张崩掉的用例会把均值拉偏，中位数更能代表"典型表现"
  console.log(
    `中位数(${average.images} 张)`.padEnd(27) +
    ''.padStart(6) +
    '      ' +
    P(median.iou).padStart(6) +
    ''.padStart(8) +
    P(median.boundaryF1).padStart(7) +
    P(median.cellAcc).padStart(9) +
    P(median.fineCellAcc).padStart(9) +
    (median.bboxErr === null ? '   n/a' : median.bboxErr.toFixed(1).padStart(8))
  )
  console.log(`\n1200x900 合成图（解析式真值）: 掩膜 ${bigMetrics.maskSide}  耗时 ${bigMetrics.ms.toFixed(1)}ms  ok=${bigMetrics.ok}  IoU=${P(bigMetrics.iou)}  αMAE=${bigMetrics.alphaMAE.toFixed(4)}  bgShare=${bigMetrics.bgShare.toFixed(3)}  conf=${bigMetrics.confidence.toFixed(3)}`)
  console.log('  同一张图在不同画布档下的「放豆/空格」判定一致率：' +
    BIG_GRIDS.map(N => `${N} 格 ${P(bigMetrics.cellAccByGrid[N].cellAcc)}（格均覆盖率误差 ${P(bigMetrics.cellAccByGrid[N].cellShareMAE)}）`).join('  ·  '))
  if (scored.some(r => r.ms > 400)) {
    console.log('[注意] 有图单次 estimateMatte 超过 400ms（ΔE00 计算较重，如实记录）')
  }
  for (const q of qualitative) {
    console.log(`\n[无真值·定性] ${q.fixture} ${q.size} level=${levelKey} ok=${q.ok} bgShare=${q.bgShare} confidence=${q.confidence} `
      + `clusters=${q.clusters} 主体占比=${q.predSubjectShare} bbox=${JSON.stringify(q.resultBBox)} 耗时=${q.ms}ms`
      + (q.reason ? ` reason=${q.reason}` : ''))
  }
  console.log('\n明细 JSON:', jsonFile)
  if (doRender) console.log('拼接图(--render):', path.join(OUT, `matte-${label}-*.png`))
}

main()
