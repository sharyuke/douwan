/* 图形工具的四种轮廓。只负责「这一格在不在描边上」和等比例外框，
   不碰图纸。盖到格子上由 useStudio.paintShapeStamp 做。
   掩膜是一圈豆宽的边，内部留空，方便之后自己填充。 */

export const SHAPES = [
  { key: 'star5', label: '五角星', icon: 'star', aw: 1, ah: 1, min: 5 },
  { key: 'heart', label: '心形', icon: 'heart', aw: 1, ah: 1, min: 5 },
  { key: 'cloud', label: '云', icon: 'cloud', aw: 9, ah: 7, min: 7 },
  { key: 'star4', label: '四角星', icon: 'star-4', aw: 1, ah: 1, min: 5 }
]

const maskCache = new Map()

export function shapeSpec(kind) {
  return SHAPES.find(s => s.key === kind) || SHAPES[0]
}

/** 把拖出来的跨度收成整数宽高，宽高比锁在图形自己的那一档。 */
export function shapeSize(kind, spanX, spanY = spanX) {
  const spec = shapeSpec(kind)
  const sx = Math.max(1, Math.abs(Math.round(spanX)) || 1) / spec.aw
  const sy = Math.max(1, Math.abs(Math.round(spanY)) || 1) / spec.ah
  const scale = Math.max(sx, sy)
  let w = Math.max(spec.min, Math.round(spec.aw * scale))
  let h = Math.max(1, Math.round(w * spec.ah / spec.aw))
  w = Math.max(spec.min, Math.round(h * spec.aw / spec.ah))
  h = Math.max(1, Math.round(w * spec.ah / spec.aw))
  if (spec.aw === spec.ah) {
    const n = Math.max(spec.min, w, h)
    w = n
    h = n
  }
  return { w, h }
}

/** 点一下时落下的最小图形，中心落在按下的那一格。 */
export function minShapeBox(kind, ax, ay) {
  const spec = shapeSpec(kind)
  const { w, h } = shapeSize(kind, spec.min, Math.round(spec.min * spec.ah / spec.aw))
  return {
    x: ax - Math.floor((w - 1) / 2),
    y: ay - Math.floor((h - 1) / 2),
    w,
    h
  }
}

/**
 * 一个角钉死，另一角跟着指针走。宽高一起变，不单拉一边。
 * (fx, fy) 是钉死的那一格，(px, py) 是指针所在格。
 */
export function boxFromCorner(kind, fx, fy, px, py) {
  const { w, h } = shapeSize(kind, Math.abs(px - fx) + 1, Math.abs(py - fy) + 1)
  const x = px >= fx ? fx : fx - w + 1
  const y = py >= fy ? fy : fy - h + 1
  return { x, y, w, h }
}

/** 整块都拖出图纸时拽回一格，让图形至少还沾着画布。没完全出去就不动。 */
export function nudgeBox(box, gw, gh) {
  let { x, y, w, h } = box
  if (gw > 0 && x + w <= 0) x = 0
  if (gh > 0 && y + h <= 0) y = 0
  if (gw > 0 && x >= gw) x = gw - w
  if (gh > 0 && y >= gh) y = gh - h
  return { x, y, w, h }
}

function starVerts(points, inner) {
  const v = []
  for (let i = 0; i < points; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / points
    v.push([Math.cos(a), Math.sin(a)])
    const b = a + Math.PI / points
    v.push([Math.cos(b) * inner, Math.sin(b) * inner])
  }
  return v
}

const STAR5 = starVerts(5, 0.4)
const STAR4 = starVerts(4, 0.42)

function pointInPoly(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const hit = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

/** 格子中心换到图形自己的坐标系。0.84 让尖角落进最外一圈，而不是刚好擦过格子中心。 */
function cellPos(col, row, w, h) {
  return [
    ((col + 0.5) / w - 0.5) * 2 * 0.84,
    ((row + 0.5) / h - 0.5) * 2 * 0.84
  ]
}

function inStar(col, row, w, h, verts) {
  const [x, y] = cellPos(col, row, w, h)
  return pointInPoly(x, y, verts)
}

/** 心形：(x²+y²-1)³ - x²y³。y 向上，顶部留出中间那道缺口。 */
function inHeart(col, row, w, h) {
  const nx = (col + 0.5) / w
  const ny = (row + 0.5) / h
  const x = (nx - 0.5) * 2.05
  const y = 1.28 - ny * 2.45
  const a = x * x + y * y - 1
  return a * a * a - x * x * y * y * y <= 0
}

/** 云：三团圆加上底部一条，比图标 18×14 再宽一点，小图上也认得出。 */
function inCloud(col, row, w, h) {
  const nx = (col + 0.5) / w
  const ny = (row + 0.5) / h
  const blobs = [
    [0.27, 0.52, 0.26],
    [0.5, 0.34, 0.3],
    [0.74, 0.5, 0.26]
  ]
  for (let i = 0; i < blobs.length; i++) {
    const dx = nx - blobs[i][0]
    const dy = ny - blobs[i][1]
    if (dx * dx + dy * dy <= blobs[i][2] * blobs[i][2]) return true
  }
  return nx >= 0.14 && nx <= 0.88 && ny >= 0.46 && ny <= 0.92
}

function filledMask(kind, w, h) {
  const mask = new Uint8Array(w * h)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      let on = false
      if (kind === 'heart') on = inHeart(col, row, w, h)
      else if (kind === 'cloud') on = inCloud(col, row, w, h)
      else if (kind === 'star4') on = inStar(col, row, w, h, STAR4)
      else on = inStar(col, row, w, h, STAR5)
      if (on) mask[row * w + col] = 1
    }
  }
  return mask
}

/** 实心图形只留下贴着外侧的那一圈。四邻接的填充过不了这条边。 */
function outlineMask(filled, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!filled[i]) continue
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !filled[i - 1] || !filled[i + 1] || !filled[i - w] || !filled[i + w]
      if (edge) out[i] = 1
    }
  }
  return out
}

function buildMask(kind, w, h) {
  return outlineMask(filledMask(kind, w, h), w, h)
}

/** 返回 w×h 的 0/1 描边掩膜，行优先。同尺寸会复用上一次的结果。 */
export function shapeMask(kind, w, h) {
  w = Math.round(w)
  h = Math.round(h)
  if (w < 1 || h < 1) return new Uint8Array(0)
  const key = `${shapeSpec(kind).key}:${w}x${h}`
  const hit = maskCache.get(key)
  if (hit) return hit
  const mask = buildMask(shapeSpec(kind).key, w, h)
  maskCache.set(key, mask)
  if (maskCache.size > 48) maskCache.delete(maskCache.keys().next().value)
  return mask
}
