/* =========================================================================
   素材预览用的极简矢量栅格化器（构建期脚本，不进产物）

   为什么手写而不用现成库：
     1) 这个仓库没有 satori / canvas / resvg 之类的依赖，预览图只是设计稿，
        为它引一个原生依赖不划算；
     2) 参考图的画法是「无描边平涂色块」，用椭圆 / 胶囊 / 多边形这几样图元
        就能完整还原，不需要通用 SVG 路径解析；
     3) 抗锯齿走「解析式覆盖率」（在隐函数上取梯度归一化）而不是超采样，
        曲边干净、速度快、结果确定（同一份代码每次出图逐像素一致）。

   坐标：y 轴向下，与 CSS / SVG 一致。所有图元都自带包围盒，
   栅格化时只遍历包围盒内的像素。
   ========================================================================= */

const zlib = require('zlib')

/* ------------------------------------------------------------ 覆盖率 → 色 */

function hexToRgb(hex) {
  const s = String(hex).replace('#', '')
  const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  const n = parseInt(v, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 覆盖率 → 0..255 的 alpha（0 与 1 直接落回端值，避免整块平色被削掉一点） */
function covToAlpha(c) {
  if (c <= 0) return 0
  if (c >= 1) return 255
  return Math.round(c * 255)
}

const PALETTE = {
  ink: '#1F1B18',
  cream: '#F8F3E9',
  cat: '#191613',
  catCap: '#413B36',
  catShoulder: '#2A2523',
  eye: '#3A332C',
  rust: '#B23A2E',
  appleDark: '#8E2A1F',
  appleLeaf: '#5C7A3F',
  nose: '#C4453A',
  whisker: '#3E7A4A',
  blue: '#3E8FBE',
  blueDeep: '#2B6C93',
  banana: '#E8C13F',
  bananaTip: '#8A6E24',
  smile: '#C4453A',
  pink: '#F1A9C4',
  pinkSoft: '#F7C6D8',
  green: '#7FA653',
  greenDeep: '#4F7A3A',
  greenLight: '#A9C46C',
  orange: '#DD7A33',
  teal: '#1D8FA3',
  plum: '#8E5A80',
  brown: '#6E4B32',
  brownRed: '#A8452F',
  yellow: '#F2C230',
  page: '#F4F5F7',
  card: '#FFFFFF',
  label: '#8B8B93',
  title: '#1B1B1F'
}

/* ------------------------------------------------------------ 图元 */

const cache = new WeakMap()
const CACHE_CELL = 3

/**
 * 把「可以算覆盖率的好函数」包装成一个图元。
 * - bounds：包围盒（含 1px 余量）
 * - fn(x,y)：内部 ≥0、边界 ≈0、外部 ≤0
 * - aa：true 时用梯度归一化算覆盖率（边缘圆润）；false 时按 sign 硬切
 *
 * 关键优化：谓词按 3×3 像素的格子记忆化。同一格里的子像素共享一次求值，
 * 代价从「每像素 81 次」降到「每格 1 次」，才能把 4096 个圆（香蕉的戳印）
 * 塞进一笔形状里而不炸掉。
 */
function makeShape(bounds, fn, aa = true) {
  const x0 = Math.max(0, Math.floor(bounds[0]) - 2)
  const y0 = Math.max(0, Math.floor(bounds[1]) - 2)
  const x1 = Math.ceil(bounds[2]) + 2
  const y1 = Math.ceil(bounds[3]) + 2
  const w = Math.max(0, x1 - x0)
  const h = Math.max(0, y1 - y0)
  const memo = new Int8Array(Math.ceil(w / CACHE_CELL) * Math.ceil(h / CACHE_CELL)).fill(-1)
  const cols = Math.ceil(w / CACHE_CELL)
  const value = (px, py) => {
    const qx = px - x0, qy = py - y0
    const ci = ((qy / CACHE_CELL) | 0) * cols + ((qx / CACHE_CELL) | 0)
    const hit = memo[ci]
    if (hit >= 0) return hit
    const v = fn(px, py) >= 0 ? 1 : 0
    memo[ci] = v
    return v
  }
  return {
    x0, y0, w, h,
    value,
    coverage: aa ? (x, y) => coverageOf(fn, x, y) : (x, y) => value(x, y)
  }
}

/** 解析式覆盖率：|f| / |∇f| 就是到边界的像素距离 */
function coverageOf(fn, x, y) {
  const v = fn(x, y)
  if (v === 0) return 0.5
  const e = 0.35
  const gx = fn(x + e, y) - fn(x - e, y)
  const gy = fn(x, y + e) - fn(x, y - e)
  const g = Math.hypot(gx, gy) / (2 * e)
  if (g < 1e-9) return v > 0 ? 1 : 0
  return Math.min(1, Math.max(0, 0.5 + v / g))
}

const circle = (cx, cy, r, aa = true) =>
  makeShape([cx - r, cy - r, cx + r, cy + r], (x, y) => r - Math.hypot(x - cx, y - cy), aa)

const ellipse = (cx, cy, rx, ry, aa = true) =>
  makeShape([cx - rx, cy - ry, cx + rx, cy + ry], (x, y) => 1 - (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2), aa)

/** 椭圆 + 下半部平切（拼豆图案里的大圆脸常用这个） */
const capsule = (x0, y0, x1, y1, r, aa = true) => {
  const dx = x1 - x0, dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  const minX = Math.min(x0, x1) - r, maxX = Math.max(x0, x1) + r
  const minY = Math.min(y0, y1) - r, maxY = Math.max(y0, y1) + r
  return makeShape([minX, minY, maxX, maxY], (x, y) => {
    let t = ((x - x0) * dx + (y - y0) * dy) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    return r - Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy))
  }, aa)
}

/** 圆角矩形（用 SDF 近似，够用） */
function roundRect(x, y, w, h, r, aa = true) {
  const cx = x + w / 2, cy = y + h / 2
  const hx = w / 2 - r, hy = h / 2 - r
  return makeShape([x, y, x + w, y + h], (px, py) => {
    const qx = Math.abs(px - cx) - hx
    const qy = Math.abs(py - cy) - hy
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
    return -d
  }, aa)
}

/** 多边形（奇偶规则，硬边；三角形耳朵用这个最省） */
function polygon(pts, aa = true) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  return makeShape(b, (x, y) => (insidePoly(pts, x, y) ? 1 : -1), aa)
}

function insidePoly(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * 「有宽度的曲线」：沿采样点戳一串圆，再做并集。
 * 把成千上万个圆塞进**一笔**形状是必须的 —— 逐个圆单独栅格化会在圆与圆的
 * 交界处留下一圈半透明接缝（每个圆各自抗锯齿的必然结果），看起来就是毛边。
 */
function stroke(samples, aa = true) {
  const pts = samples.map(s => (Array.isArray(s) ? { x: s[0], y: s[1], r: s[2] } : s))
  let maxR = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    maxR = Math.max(maxR, p.r)
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  // 每个圆心按格索引，查询时只看附近的格子 —— 否则每个像素都要遍历全部圆
  const cell = Math.max(8, maxR * 2)
  const buckets = new Map()
  for (let i = 0; i < pts.length; i++) {
    const k = ((pts[i].x / cell) | 0) + ',' + ((pts[i].y / cell) | 0)
    let arr = buckets.get(k)
    if (!arr) buckets.set(k, (arr = []))
    arr.push(i)
  }
  const near = Math.ceil(maxR / cell) + 1
  const fn = (x, y) => {
    const cx = (x / cell) | 0, cy = (y / cell) | 0
    let best = -Infinity
    for (let i = cx - near; i <= cx + near; i++) {
      for (let j = cy - near; j <= cy + near; j++) {
        const arr = buckets.get(i + ',' + j)
        if (!arr) continue
        for (const idx of arr) {
          const p = pts[idx]
          const d = p.r - Math.hypot(x - p.x, y - p.y)
          if (d > best) best = d
        }
      }
    }
    return best
  }
  return makeShape([minX - maxR, minY - maxR, maxX + maxR, maxY + maxR], fn, aa)
}

/** 隐函数图元的通用入口（苹果那种 f(x,y)=0 的曲线用） */
const implicit = (bounds, fn, aa = true) => makeShape(bounds, fn, aa)

/** 贝塞尔 / 折线采样，交给 stroke() */
function sampleCubic(p0, c0, c1, p1, r0, r1, n = 24) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    const x = u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0]
    const y = u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1]
    out.push([x, y, r0 + (r1 - r0) * t])
  }
  return out
}

function sampleQuad(p0, c, p1, r0, r1, n = 24) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    const x = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0]
    const y = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]
    out.push([x, y, r0 + (r1 - r0) * t])
  }
  return out
}

/* ------------------------------------------------------------ 画布 */

function createCanvas(w, h, bg = PALETTE.page) {
  const buf = new Uint8Array(w * h * 4)
  const c = hexToRgb(bg)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = c[0]; buf[i * 4 + 1] = c[1]; buf[i * 4 + 2] = c[2]; buf[i * 4 + 3] = 255
  }
  return { w, h, buf }
}

/** 画一笔：同一颜色、可以有多个图元（并集，用来拼大轮廓而不留接缝） */
function fill(canvas, color, shapes, alpha = 1) {
  const [sr, sg, sb] = hexToRgb(color)
  const { w, h, buf } = canvas
  const list = Array.isArray(shapes) ? shapes : [shapes]
  for (const sh of list) {
    const x0 = Math.max(0, sh.x0), x1 = Math.min(w, sh.x0 + sh.w)
    const y0 = Math.max(0, sh.y0), y1 = Math.min(h, sh.y0 + sh.h)
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const cov = sh.coverage(px + 0.5, py + 0.5)
        if (cov <= 0) continue
        const i = (py * w + px) * 4
        const a = cov * alpha
        buf[i] = Math.round(buf[i] + (sr - buf[i]) * a)
        buf[i + 1] = Math.round(buf[i + 1] + (sg - buf[i + 1]) * a)
        buf[i + 2] = Math.round(buf[i + 2] + (sb - buf[i + 2]) * a)
      }
    }
  }
}

/* ------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** 逐行做 Paeth 过滤再 zlib 压缩（PNG 的常规做法，体积能小一截） */
function encodePNG(canvas) {
  const { w, h, buf } = canvas
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    const dst = y * (stride + 1)
    raw[dst] = 4 // Paeth
    const line = buf.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? buf.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= 4 ? prev[x - 4] : 0
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      raw[dst + 1 + x] = (line[x] - pred) & 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 读回自己写的 PNG（拼版时要按圆角把两张角色图贴到画布上） */
function decodePNG(file) {
  const b = require('fs').readFileSync(file)
  let off = 8, w = 0, h = 0
  const idat = []
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off)
    const type = b.toString('ascii', off + 4, off + 8)
    const data = b.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) throw new Error('只支持 8bit RGBA 的 PNG')
    } else if (type === 'IDAT') idat.push(Buffer.from(data))
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0
      const bb = prev ? prev[x] : 0
      const c = prev && x >= 4 ? prev[x - 4] : 0
      let v = src[x]
      if (filter === 1) v = (v + a) & 255
      else if (filter === 2) v = (v + bb) & 255
      else if (filter === 3) v = (v + ((a + bb) >> 1)) & 255
      else if (filter === 4) {
        const p = a + bb - c
        const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 255
      }
      cur[x] = v
    }
  }
  return { w, h, buf: out }
}

/* 文字不在这里画：中文排版交给 scripts/preview/sheet.py（Pillow + 系统字体），
   自己写 TrueType 解析只为拼一行标题不划算。 */

module.exports = {
  PALETTE, hexToRgb,
  circle, ellipse, capsule, roundRect, polygon, stroke, implicit,
  sampleCubic, sampleQuad,
  createCanvas, fill, encodePNG, decodePNG
}
