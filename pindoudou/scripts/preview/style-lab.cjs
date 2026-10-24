/* =========================================================================
   素材库新风格试画：黑猫 / 蓝象 两张预览图

   风格取自参考图：
     - 奶白底（#F8F3E9），四周撒小装饰件（花朵 / 波浪 / 爱心 / 圆点 / 小树）
     - 主体是「无描边平涂色块」：没有黑边，靠颜色本身的明度差分层
     - 轮廓刻意手作：硬角三角形耳朵、头顶压一顶圆顶 + 波浪下沿的深色帽子
     - 五官夸张放大（大白眼球 + 小黑瞳 + 腮红），比例头大身小
     - 高饱和但不刺眼（哑光色，不用纯黑纯蓝），主体占满画面 8 成以上

   为什么先出栅格预览而不是直接进 src/data/assets.js：
     参考图的魅力在「形状本身的手作感」，不在路径写法。先用几何把形状调到顺眼，
     再决定要不要下沉到 scripts/build-assets.cjs 的素材流水线。

   用法： node scripts/preview/style-lab.cjs [输出目录]
   ========================================================================= */

const fs = require('fs')
const path = require('path')
const R = require('./renderer.cjs')

const {
  PALETTE, circle, ellipse, capsule, roundRect, polygon, stroke, implicit,
  sampleQuad, sampleCubic, createCanvas, fill, encodePNG
} = R

const SIZE = 600
const CREAM = '#F9F4EA'

/* ------------------------------------------------------------ 通用零件 */

/** 圆瓣花：花瓣圆 + 花心，参考图里那种「六个小圆组成的花」 */
function flower(cx, cy, petals, pr, core = 0) {
  const shapes = []
  for (let k = 0; k < petals; k++) {
    const a = (k / petals) * Math.PI * 2 - Math.PI / 2
    shapes.push(circle(cx + Math.cos(a) * pr * 0.62, cy + Math.sin(a) * pr * 0.62, pr * 0.62))
  }
  if (core > 0) shapes.push(circle(cx, cy, core))
  return shapes
}

/** 弯折的波浪线（两段反向的二次曲线接起来） */
function squiggle(x0, y0, len, amp, dir = 1) {
  return stroke([
    ...sampleQuad([x0, y0], [x0 + len * 0.25, y0 - amp * dir], [x0 + len * 0.5, y0], 4.6, 4.6, 12),
    ...sampleQuad([x0 + len * 0.5, y0], [x0 + len * 0.75, y0 + amp * dir], [x0 + len, y0], 4.6, 4.6, 12)
  ], true)
}

/** 左右对称的胡须 */
function whiskers(cx, cy, spreadX, r = 3.4) {
  const out = []
  for (const s of [-1, 1]) {
    out.push(stroke(sampleQuad([cx + s * 6, cy - 2], [cx + s * spreadX * 0.62, cy - 16], [cx + s * spreadX, cy - 20], r * 0.7, r), true))
    out.push(stroke(sampleQuad([cx + s * 6, cy + 14], [cx + s * spreadX * 0.62, cy + 16], [cx + s * spreadX, cy + 24], r * 0.7, r), true))
  }
  return out
}

/** 贴纸卡：奶白圆角底 + 底部一层柔和的接地影（参考图是整张画布，这里给个边界） */
function card(canvas, shadowColor, shadowAlpha) {
  fill(canvas, shadowColor, roundRect(-70, SIZE - 78, SIZE + 140, 92, 46), shadowAlpha)
  fill(canvas, CREAM, roundRect(0, 0, SIZE, SIZE, 34))
}

/* ------------------------------------------------------------ 黑猫 */

function drawCat(canvas) {
  card(canvas, '#B9AE99', 0.30)

  const HEAD = { cx: 300, cy: 380, rx: 172, ry: 148 }
  const CAP = { cx: 300, cy: 246, rx: 168, ry: 92 }

  // ---- 帽子：圆顶 + 波浪下沿。下沿的圆要小而密、起伏要小，
  //      半径大 + 间距大 + 起伏大都会让边缘变成「锯齿轮」
  const fringe = []
  for (let i = 0; i <= 15; i++) {
    const t = i / 15
    fringe.push(circle(152 + t * 296, 242 - 5 * Math.sin(t * Math.PI), 14))
  }
  fill(canvas, PALETTE.catCap, [ellipse(CAP.cx, CAP.cy, CAP.rx, CAP.ry), ...fringe])

  // ---- 耳朵：**盖在帽子之上**（顺序很关键：先画帽再画耳朵，
  //      耳朵才是「从帽子里穿出来」而不是被帽子压住）；两耳尖错开，避免撞在一起
  fill(canvas, PALETTE.cat, [
    polygon([[176, 292], [172, 92], [296, 226]]),
    polygon([[424, 292], [428, 92], [304, 226]])
  ])
  fill(canvas, PALETTE.rust, [
    polygon([[206, 268], [206, 148], [272, 224]]),
    polygon([[394, 268], [394, 148], [328, 224]])
  ])

  // ---- 脸
  fill(canvas, PALETTE.cat, ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry))
  // 肩：贴纸式裁切，头大身小
  fill(canvas, PALETTE.catShoulder, capsule(186, 512, 414, 512, 78))

  // ---- 眼睛（大眼球 + 偏内下的小黑瞳）
  const eL = { x: 254, y: 340 }, eR = { x: 346, y: 340 }
  fill(canvas, '#FFFFFF', [circle(eL.x, eL.y, 44), circle(eR.x, eR.y, 44)])
  fill(canvas, PALETTE.eye, [circle(eL.x + 2, eL.y + 5, 16), circle(eR.x + 2, eR.y + 5, 16)])

  // ---- 鼻子 + 嘴（嘴只留一小段，别和胡须缠在一起）
  fill(canvas, PALETTE.nose, ellipse(300, 402, 13, 9))
  fill(canvas, PALETTE.eye, [
    stroke(sampleQuad([290, 412], [300, 424], [309, 411], 3.6, 2.8), true),
    stroke(sampleQuad([309, 411], [318, 424], [328, 413], 2.8, 3.6), true)
  ])

  // ---- 胡须（参考图里是绿色，这点很关键）：越靠下越张开，允许探出脸外
  for (const sh of whiskers(296, 382, 88)) fill(canvas, PALETTE.whisker, sh)

  // ---- 头顶左侧的苹果：顶部有浅凹、底部有瓣、梗 + 斜出的叶
  const apple = implicit([152, 140, 324, 296], (x, y) => {
    const r = 76, b = 62
    const X = x - 246, Y = y - 238
    const t = 1.22 - Y / r
    return t * t * (X * X + Y * Y) - b * X * X
  })
  fill(canvas, PALETTE.rust, apple)
  // 顶部浅凹（苹果和樱桃的区别就在这一笔）
  fill(canvas, PALETTE.appleDark, [stroke(sampleQuad([215, 246], [246, 280], [277, 246], 34, 32), true)])
  fill(canvas, PALETTE.appleDark, [stroke(sampleQuad([238, 172], [240, 152], [246, 136], 12, 6), true)])
  fill(canvas, PALETTE.appleLeaf, [stroke(sampleQuad([252, 156], [280, 138], [308, 152], 13, 2.5), true)])

  // ---- 四周小装饰件
  fill(canvas, PALETTE.orange, flower(78, 132, 6, 40, 12))
  fill(canvas, PALETTE.teal, [squiggle(52, 250, 54, 18, 1)])
  fill(canvas, PALETTE.green, [stroke(sampleQuad([520, 108], [560, 140], [524, 172], 4.6, 4.0), true)])
  fill(canvas, PALETTE.yellow, flower(516, 470, 6, 30, 0))
  fill(canvas, PALETTE.smile, [circle(508, 190, 12)])
  fill(canvas, PALETTE.pink, [circle(96, 470, 12), circle(122, 496, 8)])
  fill(canvas, PALETTE.plum, [stroke(sampleQuad([70, 396], [104, 414], [72, 438], 4.6, 4.0), true)])
  fill(canvas, PALETTE.teal, [circle(534, 300, 10), circle(516, 326, 7), circle(552, 330, 6)])
}

/* ------------------------------------------------------------ 蓝象 */

function drawElephant(canvas) {
  card(canvas, '#B9AE99', 0.30)

  // ---- 身体：圆的并集（左右耳 + 头 + 颊 + 下巴），避免椭圆拼接出现缝。
  //      耳朵必须明显**小于**头、并且往外挪，否则整体会读成「熊」而不是「象」
  // ---- 身体：圆的并集（左右耳 + 头 + 颊 + 肩），避免椭圆拼接出现缝。
  //      左边要胖、右边要能挂住象鼻，所以「肩」这个圆往右下偏
  fill(canvas, PALETTE.blue, [
    circle(296, 430, 84),   // 左耳（贴在头外侧）
    circle(506, 430, 84),   // 右耳
    circle(398, 372, 126),  // 头
    circle(336, 468, 104),  // 左颊（重心偏左，别做成左右对称的球）
    circle(466, 498, 78)    // 肩 / 胸
  ])
  // ---- 象鼻：从肩的右侧探出去、往下再往外卷（留在轮廓里就会读成「尾巴」）
  fill(canvas, PALETTE.blue, [stroke(sampleCubic([486, 452], [588, 496], [512, 560], [592, 584], 44, 27), true)])
  fill(canvas, PALETTE.blueDeep, [circle(586, 570, 13)])

  // ---- 脸上的深色皱褶（手画两笔，不是轮廓描边）
  fill(canvas, PALETTE.blueDeep, [
    stroke(sampleQuad([372, 296], [360, 330], [374, 356], 4.6, 3.2), true),
    stroke(sampleQuad([434, 296], [446, 330], [432, 356], 4.6, 3.2), true)
  ])

  // ---- 香蕉帽：弯胶囊 + 两端褐色蒂（压在头顶正中，比耳朵抢眼）
  fill(canvas, PALETTE.banana, [stroke(sampleQuad([352, 278], [400, 234], [448, 274], 26, 24), true)])
  fill(canvas, PALETTE.bananaTip, [circle(346, 282, 9), circle(454, 278, 9)])

  // ---- 眼睛 + 腮红（眼睛要拉开，别挤成「斗鸡眼」）
  fill(canvas, '#FFFFFF', [circle(372, 348, 27), circle(448, 348, 27)])
  fill(canvas, PALETTE.eye, [circle(373, 351, 9.5), circle(449, 351, 9.5)])
  fill(canvas, PALETTE.pinkSoft, [circle(316, 384, 15), circle(506, 376, 14)])

  // ---- 口鼻
  fill(canvas, '#F6EFE2', ellipse(410, 404, 30, 23))
  fill(canvas, PALETTE.nose, ellipse(410, 390, 14, 9))
  fill(canvas, PALETTE.smile, [stroke(sampleQuad([394, 402], [410, 420], [428, 402], 3.2, 3.2), true)])

  // ---- 四周小装饰件（左上角那朵花往左挪，别贴着象头）
  fill(canvas, PALETTE.orange, flower(70, 84, 6, 40, 12))
  fill(canvas, PALETTE.pink, [squiggle(226, 88, 74, 13, -1)])
  fill(canvas, PALETTE.green, [circle(500, 118, 12), circle(478, 146, 8), circle(522, 146, 8)])
  fill(canvas, PALETTE.plum, flower(84, 486, 6, 30, 0))
  fill(canvas, PALETTE.yellow, [circle(524, 200, 11), circle(548, 224, 7)])
  fill(canvas, PALETTE.teal, [squiggle(52, 300, 48, 16, 1)])
  fill(canvas, PALETTE.smile, [circle(152, 556, 11), circle(180, 574, 7)])
  fill(canvas, PALETTE.green, [stroke(sampleQuad([152, 512], [178, 486], [206, 512], 4.6, 4.0), true)])
}

/* ------------------------------------------------------------ 出图 */

function renderOne(name, painter) {
  const canvas = createCanvas(SIZE, SIZE, CREAM)
  painter(canvas)
  const dir = process.argv[2] || path.join(__dirname, 'out')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `style-${name}.png`)
  const png = encodePNG(canvas)
  fs.writeFileSync(file, png)
  // 自检：不能是纯色（防止图元全跑到框外，出一张空白图）
  const seen = new Set()
  for (let i = 0; i < canvas.buf.length; i += 4) {
    seen.add(canvas.buf[i] + ',' + canvas.buf[i + 1] + ',' + canvas.buf[i + 2])
  }
  console.log(`${path.relative(process.cwd(), file)}  ${png.length} 字节  颜色数 ${seen.size}`)
  return file
}

renderOne('cat', drawCat)
renderOne('elephant', drawElephant)
