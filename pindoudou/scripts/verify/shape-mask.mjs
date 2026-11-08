/* 图形掩膜：等比例、左右对称、轮廓认得出。不打开浏览器。 */
import { SHAPES, shapeMask, shapeSize, boxFromCorner, minShapeBox, nudgeBox } from '../../src/lib/shapes.js'

let failed = 0
function assert(cond, msg) {
  if (cond) return
  failed++
  console.error('FAIL', msg)
}

function ascii(kind, w, h) {
  const m = shapeMask(kind, w, h)
  const lines = []
  for (let y = 0; y < h; y++) {
    let s = ''
    for (let x = 0; x < w; x++) s += m[y * w + x] ? '#' : '.'
    lines.push(s)
  }
  return lines
}

function symmetric(kind, n) {
  const m = shapeMask(kind, n, n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (m[y * n + x] !== m[y * n + (n - 1 - x)]) return false
    }
  }
  return true
}

for (const s of SHAPES) {
  const size = shapeSize(s.key, 12, 9)
  assert(size.w >= s.min, `${s.key} 不小于最小尺寸`)
  if (s.aw === s.ah) assert(size.w === size.h, `${s.key} 应是正方形，得到 ${size.w}x${size.h}`)
  else {
    const ratio = size.w / size.h
    const want = s.aw / s.ah
    assert(Math.abs(ratio - want) < 0.2, `${s.key} 比例 ${ratio} 偏离 ${want}`)
  }
}

assert(symmetric('star5', 15), '五角星不左右对称')
assert(symmetric('star4', 15), '四角星不左右对称')
assert(symmetric('heart', 15), '心形不左右对称')

const star = shapeMask('star5', 15, 15)
assert(star[0 * 15 + 7] === 1, '五角星顶部尖角没有豆')
assert(star[7 * 15 + 7] === 1, '五角星中心是空的')
assert(star[0] === 0 && star[14] === 0, '五角星四个角不该铺满')

const heart = shapeMask('heart', 15, 15)
assert(heart[1 * 15 + 7] === 0, '心形顶部中间应是缺口')
assert(heart[2 * 15 + 3] === 1 && heart[2 * 15 + 11] === 1, '心形上方左右应各有一团')
assert(heart[12 * 15 + 7] === 1, '心形底部应有豆')

const cloud = shapeMask('cloud', 18, 14)
let cloudN = 0
for (let i = 0; i < cloud.length; i++) cloudN += cloud[i]
assert(cloudN > 20 && cloudN < cloud.length * 0.8, `云的豆数不对 ${cloudN}`)
assert(cloud[0] === 0, '云的左上角应是空的')
assert(cloud[6 * 18 + 9] === 1, '云的中间应有豆')

const grown = boxFromCorner('star5', 2, 3, 10, 6)
assert(grown.w === grown.h, '拉动边角后五角星不再是正方形')
assert(grown.x === 2 && grown.y === 3, '钉住的角被挪走了')
const flipped = boxFromCorner('star5', 10, 10, 4, 6)
assert(flipped.x + flipped.w - 1 === 10 && flipped.y + flipped.h - 1 === 10, '反向拉时对角没有钉住')
assert(flipped.w === flipped.h, '反向拉丢了等比例')

const mini = minShapeBox('cloud', 4, 4)
assert(mini.w >= 7 && mini.h >= 1 && mini.w !== mini.h, '云的最小框应是扁的')
const back = nudgeBox({ x: 20, y: 1, w: 5, h: 5 }, 8, 8)
assert(back.x + back.w <= 8 || back.x < 8, '完全拖出画布后没有拽回来')
assert(back.x < 8 && back.x + 5 > 0, '拽回后仍不沾画布')

for (const s of SHAPES) {
  const box = minShapeBox(s.key, 10, 10)
  const m = shapeMask(s.key, box.w, box.h)
  let n = 0
  for (let i = 0; i < m.length; i++) n += m[i]
  assert(n >= 5, `${s.key} 最小图形几乎是空的（${n}）`)
}

const same = boxFromCorner('star5', 0, 0, 8, 8)
const again = boxFromCorner('star5', 0, 0, 8, 8)
assert(same.w === again.w && same.h === again.h, '同一跨度两次结果不同')

if (failed) {
  console.error(ascii('star5', 15, 15).join('\n'))
  console.error('---')
  console.error(ascii('heart', 15, 15).join('\n'))
  console.error('---')
  console.error(ascii('cloud', 18, 14).join('\n'))
  console.error('---')
  console.error(ascii('star4', 15, 15).join('\n'))
  process.exit(1)
}
console.log('shape-mask ok', SHAPES.map(s => s.key).join(','))
