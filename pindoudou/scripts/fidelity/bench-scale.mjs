/* =========================================================================
   画布尺寸 × 还原度评测（开发用，Node 直接跑）

   为什么单独写一个：bench.mjs 把 GW/GH 写死成 29×29，用来比「同一画布下算法改动的优劣」。
   但用户反馈的问题不是算法优劣，而是「画布太小 ⇒ 复杂照片 / 真人照片根本转不出来」——
   要回答的是「画布开到多大才够、代价是多少」，所以这里把画布尺寸当成自变量。

   指标口径与 bench.mjs 保持一致（可互相印证），只是格栅不同：
     dEcell  每格：图案豆色 vs 该格覆盖的源图平均色 —— 最严格，「这颗豆对不对」
     dEview  两侧都缩放到固定 256×256、再各做一次同半径模糊后逐像素 CIEDE2000
             —— 「远看像不像」。固定输出尺寸是关键：只在图案自己的格栅上比，
             大画布会因为「像素更多」而天然吃亏，没法横向比较。
     simApp  界面显示的还原度（算法内部口径），只作对照

   用法：
     node scripts/fidelity/bench-scale.mjs --image scripts/fidelity/out/photo-src/ref_girl.png
     node scripts/fidelity/bench-scale.mjs --grids 29,116,300,450,1000 --colors 16,30,64 --label scale-1000
     node scripts/fidelity/bench-scale.mjs --maxside 1024 --label scale-1000-src1024   # 对照：源图上限退回 1024
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateFromPixels, resampleRGBA, variantParams, MAX_SOURCE_SIDE } from '../../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'
import { deltaE2000, rgbToLab } from '../../src/lib/color.js'
import { readPNG, writePNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')

/* ------------------------------------------------------------ 参数 */

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0
    ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true)
    : fallback
}

const label = String(arg('label', 'scale'))
const imagePath = path.resolve(String(arg('image', path.join(OUT, 'photo-src', 'ref_girl.png'))))
const grids = String(arg('grids', '29,58,116,174,232,290,348,464')).split(',').map(Number).filter(n => n > 0)
const colorTargets = String(arg('colors', '16,30')).split(',').map(Number).filter(n => n > 0)
const variantKey = String(arg('variant', 'easy'))
/**
 * 源图读入时允许的最大边长：直接跟随 src/lib/pattern.js 的 MAX_SOURCE_SIDE（现在是 2048）。
 * 以前这里写死 1024 —— 那时它和库里那个常量恰好相等，所以看不出问题；上限提到 2048 之后，
 * 写死就会让评测默认跑在「1024 源图」上，测出来的数字和用户在浏览器里跑的（2048）
 * 不是同一件事。要复现旧档位就显式 `--maxside 1024`。
 */
const maxSide = Number(arg('maxside', MAX_SOURCE_SIDE))
const renderDir = path.join(OUT, label)

/* ------------------------------------------------------------ 图像工具 */

/** 源图先按最大边长做面积平均降采样（Node 里没有 canvas，等价于 readImagePixels 的逐级减半） */
function limitSide(src, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh))
  if (k >= 1) return { data: src, width: sw, height: sh, scaled: false }
  const tw = Math.max(1, Math.round(sw * k))
  const th = Math.max(1, Math.round(sh * k))
  const { data } = resampleRGBA(src, sw, sh, tw, th, 'cover')
  return { data, width: tw, height: th, scaled: true }
}

function labOf(r, g, b) {
  return rgbToLab(r | 0, g | 0, b | 0)
}

/** 每格：图案豆色 vs 该格覆盖的源图平均色 */
function cellDeltaE(pattern, src, sw, sh) {
  const g = pattern.width
  const cell = resampleRGBA(src, sw, sh, pattern.width, pattern.height, 'contain')
  let sum = 0
  let n = 0
  for (let i = 0; i < g * pattern.height; i++) {
    const c = pattern.palette[pattern.cells[i]]
    if (!c) continue
    const o = i * 4
    sum += deltaE2000(c.lab, labOf(cell.data[o], cell.data[o + 1], cell.data[o + 2]))
    n++
  }
  return n ? sum / n : 99
}

/** 图案 → N×N 栅格（每个输出像素取 2×2 子样本的平均色，等效于「缩小看」） */
function patternRaster(pattern, N) {
  const out = new Float32Array(N * N * 3)
  const gw = pattern.width
  const gh = pattern.height
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const cx = Math.min(gw - 1, Math.floor(((px + (sx + 0.5) / 2) / N) * gw))
          const cy = Math.min(gh - 1, Math.floor(((py + (sy + 0.5) / 2) / N) * gh))
          const c = pattern.palette[pattern.cells[cy * gw + cx]]
          if (!c) continue
          r += c.rgb[0]; g += c.rgb[1]; b += c.rgb[2]; n++
        }
      }
      const o = (py * N + px) * 3
      out[o] = n ? r / n : 255
      out[o + 1] = n ? g / n : 255
      out[o + 2] = n ? b / n : 255
    }
  }
  return out
}

/** 可分离盒式模糊，跑 passes 遍 */
function blurRaster(src, N, radius, passes = 2) {
  let a = Float32Array.from(src)
  const tmp = new Float32Array(a.length)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k
          if (xx < 0 || xx >= N) continue
          const o = (y * N + xx) * 3
          r += a[o]; g += a[o + 1]; b += a[o + 2]; n++
        }
        const o = (y * N + x) * 3
        tmp[o] = r / n; tmp[o + 1] = g / n; tmp[o + 2] = b / n
      }
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k
          if (yy < 0 || yy >= N) continue
          const o = (yy * N + x) * 3
          r += tmp[o]; g += tmp[o + 1]; b += tmp[o + 2]; n++
        }
        const o = (y * N + x) * 3
        a[o] = r / n; a[o + 1] = g / n; a[o + 2] = b / n
      }
    }
  }
  return a
}

const VIEW_N = 256

function viewDeltaE(pattern, src, sw, sh) {
  const pat = blurRaster(patternRaster(pattern, VIEW_N), VIEW_N, 2)
  const srcRaster = resampleRGBA(src, sw, sh, VIEW_N, VIEW_N, 'contain')
  const ref = new Float32Array(VIEW_N * VIEW_N * 3)
  for (let i = 0; i < VIEW_N * VIEW_N; i++) {
    ref[i * 3] = srcRaster.data[i * 4]
    ref[i * 3 + 1] = srcRaster.data[i * 4 + 1]
    ref[i * 3 + 2] = srcRaster.data[i * 4 + 2]
  }
  const refBlur = blurRaster(ref, VIEW_N, 2)
  let sum = 0
  for (let i = 0; i < VIEW_N * VIEW_N; i++) {
    sum += deltaE2000(labOf(pat[i * 3], pat[i * 3 + 1], pat[i * 3 + 2]),
      labOf(refBlur[i * 3], refBlur[i * 3 + 1], refBlur[i * 3 + 2]))
  }
  return sum / (VIEW_N * VIEW_N)
}

/** 渲染图案成 PNG：所有尺寸都输出约 300px 宽，方便并排肉眼比 */
function renderPNG(pattern, file) {
  const cell = Math.max(1, Math.min(12, Math.round(320 / pattern.width)))
  const w = pattern.width * cell
  const h = pattern.height * cell
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const c = pattern.palette[pattern.cells[y * pattern.width + x]]
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

const img = readPNG(imagePath)
const src = limitSide(img.data, img.width, img.height, maxSide)
const palette = getColors(DEFAULT_BRAND_ID)

fs.mkdirSync(renderDir, { recursive: true })

console.log(`===== 画布尺寸 × 还原度（${label}）=====`)
console.log(`源图 ${path.basename(imagePath)} ${img.width}×${img.height} ⇒ 读入后 ${src.width}×${src.height}` +
  `${src.scaled ? `（受 maxside=${maxSide} 限制）` : '（未受限）'}，色板 ${palette.length} 色，方案 ${variantKey}`)
console.log('')
console.log('画布      目标色  实用色  空格    simApp  dEcell  dEview   耗时ms')

const rows = []
for (const g of grids) {
  for (const target of colorTargets) {
    const t0 = Date.now()
    const pattern = generateFromPixels(src.data, src.width, src.height, {
      gw: g,
      gh: g,
      fit: 'contain',
      targetColors: target,
      brandId: DEFAULT_BRAND_ID,
      colors: palette,
      variantKey,
      variantParams: variantParams(variantKey, target)
    })
    const ms = Date.now() - t0
    const dEcell = cellDeltaE(pattern, src.data, src.width, src.height)
    const dEview = viewDeltaE(pattern, src.data, src.width, src.height)
    const row = {
      grid: g,
      cells: g * g,
      targetColors: target,
      usedColors: pattern.palette.length,
      empty: (pattern.stats && pattern.stats.emptyCount) || 0,
      simApp: Math.round(pattern.stats.similarity * 1000) / 1000,
      dEcell: Math.round(dEcell * 100) / 100,
      dEview: Math.round(dEview * 100) / 100,
      ms
    }
    rows.push(row)
    console.log(
      `${g}×${g}`.padEnd(9) +
      String(target).padStart(6) +
      String(row.usedColors).padStart(8) +
      String(row.empty).padStart(7) +
      row.simApp.toFixed(3).padStart(9) +
      row.dEcell.toFixed(2).padStart(8) +
      row.dEview.toFixed(2).padStart(8) +
      String(ms).padStart(9)
    )
    renderPNG(pattern, path.join(renderDir, `g${g}_c${target}.png`))
  }
}

const payload = {
  label,
  at: new Date().toISOString(),
  image: path.relative(HERE, imagePath).replace(/\\/g, '/'),
  sourceSize: { width: img.width, height: img.height },
  readSize: { width: src.width, height: src.height, maxSide },
  variantKey,
  rows
}
fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(payload, null, 2))
console.log('')
console.log('明细:', path.join(OUT, `${label}.json`))
console.log('渲染图:', renderDir)
