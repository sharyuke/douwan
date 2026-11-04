/* ------------------------------------------------------------------
   图案复杂度 → 钉板推荐的自检（Node，无需浏览器）

   用户口径（2026-11-04）：图纸模式导入图片后，按图案复杂度推荐一块钉板 ——
   越复杂越大、越简单越小，钉板数量默认 1 块。

   校准锚点用仓库里已有的 fidelity 样例（scripts/fidelity/fixtures/，都是 8bit
   truecolor PNG，自带的极简解码器直接读，不引依赖）：

     synth_flat_cartoon  扁平卡通（大色块）        → 52
     synth_product       平涂产品图（3 色 + 投影）  → 52
     synth_portrait      渐变人像（色块 + 柔渐变）  → 78
     synth_fruit         渐变球体 + 投影            → 78
     synth_sky           天空渐变                   → 78
     synth_forest        多层半透明色块（细节多）    → 104
     photo_pumpkin       真实照片                   → 120

   另有合成图锁两头：纯色 Logo → 52，逐像素噪点 + 渐变的照片 → 120。
   断言除了档位，还要求分数离档位边界有余量（≥ 0.03），
   否则轻微调参就会把一类图挤到隔壁档 —— 那是用户看得见的行为变化。

   用法：node scripts/verify/complexity.mjs
   ------------------------------------------------------------------ */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'
import { estimateComplexity, COMPLEXITY_LEVELS } from '../../src/lib/complexity.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, '..', 'fidelity', 'fixtures')

let failed = 0
function check(ok, label, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
}

/* ---------------------------------------------------------------- 极简 PNG 解码
   只服务 fidelity 样例：8bit、非隔行、truecolor(2) / truecolor+alpha(6)。 */

function decodePng(file) {
  const b = fs.readFileSync(file)
  let pos = 8
  let w = 0, h = 0, depth = 0, colorType = 0
  const idat = []
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos)
    const type = b.toString('ascii', pos + 4, pos + 8)
    const data = b.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') break
    pos += 12 + len
  }
  if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`${path.basename(file)}：只支持 8bit truecolor PNG（depth ${depth} / type ${colorType}）`)
  }
  const ch = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = new Uint8ClampedArray(w * h * 4)
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const off = y * (stride + 1)
    const ft = raw[off]
    for (let x = 0; x < stride; x++) {
      const v = raw[off + 1 + x]
      const a = x >= ch ? cur[x - ch] : 0
      const up = prev[x]
      const c = x >= ch ? prev[x - ch] : 0
      let o
      if (ft === 0) o = v
      else if (ft === 1) o = v + a
      else if (ft === 2) o = v + up
      else if (ft === 3) o = v + ((a + up) >> 1)
      else {
        const p = a + up - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - c)
        o = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)
      }
      cur[x] = o & 0xff
    }
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4
      const s = x * ch
      out[d] = cur[s]
      out[d + 1] = cur[s + 1]
      out[d + 2] = cur[s + 2]
      out[d + 3] = 255
    }
    cur.copy(prev)
  }
  return { w, h, data: out }
}

/* ---------------------------------------------------------------- 合成图 */

function blank(w, h, r = 255, g = 255, b = 255) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
  }
  return { w, h, data }
}

function put(cv, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return
  const i = (y * cv.w + x) * 4
  cv.data[i] = r; cv.data[i + 1] = g; cv.data[i + 2] = b
}

function disc(cv, cx, cy, rad, r, g, b) {
  const r2 = rad * rad
  for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(cv.h - 1, Math.ceil(cy + rad)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(cv.w - 1, Math.ceil(cx + rad)); x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r2) put(cv, x, y, r, g, b)
    }
  }
}

function rect(cv, x0, y0, w, h, r, g, b) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) put(cv, x, y, r, g, b)
  }
}

/** 纯色 Logo：白底 + 红圆 + 蓝块（3 色、硬边） */
function flatLogo() {
  const cv = blank(400, 300)
  disc(cv, 150, 150, 90, 214, 69, 65)
  rect(cv, 230, 90, 120, 120, 40, 90, 150)
  return cv
}

/** 照片：渐变底 + 大量带结构的小色块（枝叶 / 毛发那种细节）+ 逐像素噪点 */
function noisyPhoto() {
  const cv = blank(400, 300)
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const u = x / cv.w
      const v = y / cv.h
      put(cv, x, y,
        120 + 90 * Math.sin(u * 3.1) + 40 * v,
        110 + 70 * Math.cos(v * 2.4) + 50 * u,
        150 + 60 * Math.sin((u + v) * 4.2))
    }
  }
  for (let i = 0; i < 260; i++) {
    const cx = rnd() * cv.w
    const cy = rnd() * cv.h
    const rad = 2 + rnd() * 13
    disc(cv, cx, cy, rad, 30 + rnd() * 220, 30 + rnd() * 220, 30 + rnd() * 220)
  }
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const i = (y * cv.w + x) * 4
      const n = () => (rnd() - 0.5) * 26
      cv.data[i] += n()
      cv.data[i + 1] += n()
      cv.data[i + 2] += n()
    }
  }
  return cv
}

/* ---------------------------------------------------------------- 断言 */

function expectSpec(name, cv, spec) {
  const r = estimateComplexity(cv.data, cv.w, cv.h)
  const band = COMPLEXITY_LEVELS.find(l => l.spec === spec)
  const prevMax = COMPLEXITY_LEVELS[COMPLEXITY_LEVELS.indexOf(band) - 1]
  const lo = prevMax ? prevMax.max : 0
  const hi = band.max
  const margin = Math.min(r.score - lo, hi - r.score)
  const detail = `score ${r.score} · ${r.colors} 色桶 · edge ${r.edge} · texture ${r.texture} → ${r.spec} 钉板（${r.name}）`
  check(r.spec === spec, `${name} → ${spec} 钉板`, detail)
  check(margin >= 0.03, `${name} 离档位边界有 ≥0.03 余量`, `margin ${margin.toFixed(3)}`)
}

const fixtures = [
  ['synth_flat_cartoon.png', 52],
  ['synth_product.png', 52],
  ['synth_portrait.png', 78],
  ['synth_fruit.png', 78],
  ['synth_sky.png', 78],
  ['synth_forest.png', 104],
  ['photo_pumpkin.png', 120]
]
for (const [file, spec] of fixtures) {
  const p = decodePng(path.join(FIXTURES, file))
  expectSpec(file.replace('.png', ''), p, spec)
}

expectSpec('合成 · 纯色 Logo', flatLogo(), 52)
expectSpec('合成 · 噪点照片', noisyPhoto(), 120)

/* 确定性：同一张图量两次结果必须完全一致（推荐不能每次刷新都变） */
const logo = flatLogo()
const a = estimateComplexity(logo.data, logo.w, logo.h)
const b = estimateComplexity(logo.data, logo.w, logo.h)
check(JSON.stringify(a) === JSON.stringify(b), '同一张图两次量测结果一致')

/* 贴纸：主体只占整图一角时，透明底不能把复杂度稀释掉 */
const forest = decodePng(path.join(FIXTURES, 'synth_forest.png'))
const sticker = blank(400, 400)
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 200; x++) {
    const s = ((y * 2) * forest.w + x * 2) * 4
    const d = (y * 400 + x) * 4
    sticker.data[d] = forest.data[s]
    sticker.data[d + 1] = forest.data[s + 1]
    sticker.data[d + 2] = forest.data[s + 2]
  }
}
const whole = estimateComplexity(sticker.data, sticker.w, sticker.h)
const cropped = estimateComplexity(sticker.data, sticker.w, sticker.h, { x: 0, y: 0, w: 200, h: 200 })
check(cropped.spec === 104, '贴纸按主体包围盒量到插画档', `整图 ${whole.spec} → 主体 ${cropped.spec}（score ${cropped.score}）`)

/* 档位表与界面口径一致：四级 → 52 / 78 / 104 / 120，恰好每级一块板 */
check(
  COMPLEXITY_LEVELS.map(l => l.spec).join(',') === '52,78,104,120',
  '四级推荐规格是 52 / 78 / 104 / 120（每级 1 块板）'
)

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
