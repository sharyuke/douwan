/* =========================================================================
   素材生成器（构建期脚本，产物是 src/data/assets.js）
   为什么用脚本而不是手写：
     50 个素材如果手写 SVG，风格一定会飘。这里用一套统一的「扁平手作」绘图语言
     （圆角底 + 一个主体 + 少量高光/五官），保证全库视觉一致。
   所有素材均为平台自制，不使用任何未经授权的 IP 形象（PRD §22 版权策略）。
   用法： node scripts/build-assets.cjs
   ========================================================================= */

const fs = require('fs')
const path = require('path')

/* ------------------------------------------------------------ 绘图小工具 */

const H = {
  /** 圆角底 */
  bg: (fill, r = 28) => `<rect width="200" height="160" rx="${r}" fill="${fill}"/>`,
  circle: (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`,
  ellipse: (cx, cy, rx, ry, fill, rot = 0) =>
    rot ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" transform="rotate(${rot} ${cx} ${cy})"/>` : `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`,
  rect: (x, y, w, h, fill, r = 0) => (r ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`),
  path: (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`,
  stroke: (d, color, w, cap = 'round') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}"/>`,
  eyes: (cx, cy, gap, r, fill) => `<circle cx="${cx - gap}" cy="${cy}" r="${r}" fill="${fill}"/><circle cx="${cx + gap}" cy="${cy}" r="${r}" fill="${fill}"/>`,
  smile: (cx, cy, w, color, sw = 4) => `<path d="M${cx - w} ${cy}q${w} ${w * 0.9} ${w * 2} 0" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`,
  blush: (cx, cy, gap, color) => `<circle cx="${cx - gap}" cy="${cy}" r="5" fill="${color}"/><circle cx="${cx + gap}" cy="${cy}" r="5" fill="${color}"/>`
}

function svg(...parts) {
  return `<svg viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

/* ------------------------------------------------------------ 素材定义 */

/** 每条：id 稳定不变（存档 / 收藏都靠它），cat 是中文分类，组是合集 key */
const ASSETS = []

function add(cfg) {
  ASSETS.push(cfg)
}

/* ---------------- A 组：动物头像（圆润大脸，最容易一眼认出来） ---------------- */

function animalFace({ bg, fur, ear, earInner, muzzle, eye = '#5B4638', extra = '' }) {
  return svg(
    H.bg(bg),
    // 耳朵
    H.circle(66, 46, 20, ear),
    H.circle(134, 46, 20, ear),
    H.circle(66, 46, 11, earInner),
    H.circle(134, 46, 11, earInner),
    // 脸
    H.ellipse(100, 88, 46, 42, fur),
    // 嘴部色块
    H.ellipse(100, 104, 22, 15, muzzle),
    H.eyes(100, 82, 19, 6, eye),
    H.path('M94 100q6 7 12 0', 'none', ` stroke="${eye}" stroke-width="4" stroke-linecap="round"`),
    H.blush(100, 96, 33, 'rgba(255,160,175,.55)'),
    extra
  )
}

add({ name: '橘猫头像', cat: '动物', cols: ['pet', 'avatar'], hot: 95, feat: true, featBg: 'linear-gradient(135deg,#FFF5E2,#FFDCC0)', boards: 1, colors: 14, svg: svg(
  H.bg('#FFF5E2'),
  H.path('M54 55l12-27 25 19c19-7 31-7 50 0l24-19 12 28c7 11 10 25 6 39-8 28-38 42-70 42s-61-14-69-42c-4-14-1-28 10-40z', '#F4A15B'),
  H.stroke('M65 77q14-13 28 0M110 77q14-13 28 0', '#5B4638', 5),
  H.eyes(103, 88, 18, 4.5, '#5B4638'),
  H.stroke('M96 105q4 7 8 0q4 7 8 0', '#5B4638', 4),
  H.path('M92 96h22l-11 8z', '#FFF0DC')
) })

add({ name: '小狗头像', cat: '动物', cols: ['pet', 'avatar'], hot: 91, boards: 1, colors: 13, svg: svg(
  H.bg('#EFF8FF'),
  H.path('M56 49c-17-4-24 12-22 27 2 13 12 22 22 22 2 27 22 48 45 48h1c25 0 45-21 45-48 10 0 20-9 22-22 2-15-7-31-24-27-18-14-68-14-89 0z', '#D8B089'),
  H.stroke('M67 83q13-11 26 0M114 83q13-11 26 0', '#57463A', 5),
  H.eyes(106, 91, 17, 4.5, '#57463A'),
  H.ellipse(106, 106, 12, 8, '#57463A')
) })

add({ name: '小兔子', cat: '动物', cols: ['pet'], hot: 68, boards: 1, colors: 10, svg: svg(
  H.bg('#FFF0F6'),
  H.ellipse(82, 52, 11, 34, '#FFFFFF', -12),
  H.ellipse(118, 52, 11, 34, '#FFFFFF', 12),
  H.ellipse(82, 52, 5, 24, '#FFD2DD', -12),
  H.ellipse(118, 52, 5, 24, '#FFD2DD', 12),
  H.circle(100, 96, 36, '#FFFFFF'),
  H.eyes(100, 90, 15, 4.5, '#4A3327'),
  H.stroke('M94 104q6 5 12 0', '#4A3327', 4),
  H.blush(100, 102, 27, '#FFC3D2')
) })

add({ name: '仓鼠', cat: '动物', cols: ['pet'], hot: 40, boards: 1, colors: 12, svg: svg(
  H.bg('#FFF7E6'),
  H.circle(72, 78, 13, '#F4C98A'),
  H.circle(128, 78, 13, '#F4C98A'),
  H.circle(72, 78, 6, '#FFD9B3'),
  H.circle(128, 78, 6, '#FFD9B3'),
  H.ellipse(100, 96, 40, 34, '#F4C98A'),
  H.eyes(100, 90, 14, 4.5, '#3A2A1E'),
  H.ellipse(100, 100, 6, 4, '#E08B6F'),
  H.stroke('M92 108q8 6 16 0', '#3A2A1E', 3.5),
  H.circle(80, 112, 6, '#FFD2DD'),
  H.circle(120, 112, 6, '#FFD2DD')
) })

add({ name: '熊猫', cat: '动物', cols: ['pet'], hot: 74, boards: 1, colors: 9, svg: svg(
  H.bg('#F2F7F1'),
  H.circle(68, 48, 18, '#3A3A3A'),
  H.circle(132, 48, 18, '#3A3A3A'),
  H.ellipse(100, 90, 46, 42, '#FFFFFF'),
  H.ellipse(87, 84, 15, 17, '#3A3A3A', -8),
  H.ellipse(113, 84, 15, 17, '#3A3A3A', 8),
  H.circle(87, 84, 5, '#FFFFFF'),
  H.circle(113, 84, 5, '#FFFFFF'),
  H.ellipse(100, 106, 8, 6, '#3A3A3A'),
  H.stroke('M92 112q8 6 16 0', '#3A3A3A', 4)
) })

add({ name: '小狐狸', cat: '动物', cols: ['pet'], hot: 66, boards: 1, colors: 13, svg: svg(
  H.bg('#FFF3EC'),
  H.path('M62 30l30 24-38 12z', '#E8703F'),
  H.path('M138 30l-30 24 38 12z', '#E8703F'),
  H.path('M62 30l18 18-20 6z', '#F7B9A0'),
  H.path('M138 30l-18 18 20 6z', '#F7B9A0'),
  H.path('M100 44c26 0 44 22 40 46-4 22-24 34-40 34s-36-12-40-34c-4-24 14-46 40-46z', '#F08A4B'),
  H.path('M100 96c11 0 20 8 20 18-4 8-13 12-20 12s-16-4-20-12c0-10 9-18 20-18z', '#FFF3E4'),
  H.eyes(100, 84, 18, 5, '#4A2E1E'),
  H.ellipse(100, 104, 6, 4.5, '#4A2E1E')
) })

add({ name: '小企鹅', cat: '动物', cols: ['pet'], hot: 58, boards: 1, colors: 11, svg: svg(
  H.bg('#E9F6FF'),
  H.ellipse(100, 92, 42, 48, '#2D2927'),
  H.ellipse(100, 98, 30, 38, '#FFFFFF'),
  H.path('M100 56c9 0 16 7 16 16s-7 16-16 16-16-7-16-16 7-16 16-16z', '#2D2927'),
  H.circle(92, 70, 4, '#FFFFFF'),
  H.circle(108, 70, 4, '#FFFFFF'),
  H.path('M100 80l7 6-7 6-7-6z', '#F5A623'),
  H.ellipse(72, 46, 14, 9, '#2D2927', -20),
  H.ellipse(128, 46, 14, 9, '#2D2927', 20)
) })

add({ name: '小蜜蜂', cat: '动物', cols: ['pet'], hot: 52, boards: 1, colors: 12, svg: svg(
  H.bg('#FFFBE0'),
  H.ellipse(78, 54, 20, 13, '#CFE9F7', -24),
  H.ellipse(122, 54, 20, 13, '#CFE9F7', 24),
  H.ellipse(100, 94, 40, 34, '#F7D94C'),
  H.path('M78 70h44M76 96h48', 'none', ' stroke="#3A3226" stroke-width="11" stroke-linecap="round"'),
  H.circle(86, 84, 5, '#3A3226'),
  H.circle(114, 84, 5, '#3A3226'),
  H.stroke('M92 96q8 6 16 0', '#3A3226', 4)
) })

/* ---------------- B 组：甜品 ---------------- */

add({ name: '草莓蛋糕', cat: '甜品', cols: ['food'], hot: 76, boards: 1, colors: 13, svg: svg(
  H.bg('#FFF0F6'),
  H.path('M42 62h116l-10 70H52z', '#F4B46E'),
  H.rect(43, 62, 114, 17, '#FF91AD'),
  H.path('M48 58c8-18 31-20 42-6 10-15 37-18 48 1 14-13 37-1 34 16H41c-4-6 0-8 7-11z', '#FFFFFF'),
  H.circle(83, 92, 8, '#EF4B68'),
  H.circle(118, 111, 8, '#EF4B68'),
  H.circle(140, 93, 8, '#EF4B68')
) })

add({ name: '甜甜圈', cat: '甜品', cols: ['food'], hot: 70, boards: 1, colors: 14, svg: svg(
  H.bg('#FFF6EC'),
  H.circle(100, 82, 46, '#D9A566'),
  H.path('M56 82c0-24 20-42 44-42s44 18 44 42-20 42-44 42c-12 0-22-4-30-11 12 4 26 2 36-6 12-10 16-26 10-40-6-14-20-22-36-20-16 2-28 15-28 30 0 5 1 10 4 15z', '#FF8FB0'),
  H.circle(100, 82, 15, '#FFF6EC'),
  H.path('M74 58l8 20M100 44v22M126 60l-10 18M58 88l22-6M142 88l-22-6', 'none', ' stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"')
) })

add({ name: '奶茶', cat: '甜品', cols: ['food'], hot: 64, boards: 1, colors: 12, svg: svg(
  H.bg('#FFF3EA'),
  H.path('M77 38h54l-7 88H83z', '#D9AD79'),
  H.stroke('M75 55h58', '#9D6F51', 7, 'butt'),
  H.stroke('M106 37l14-22', '#8E694F', 7),
  H.circle(91, 108, 7, '#5D4638'),
  H.circle(109, 116, 7, '#5D4638'),
  H.circle(122, 102, 7, '#5D4638'),
  H.stroke('M90 68h30', '#FFE7C5', 8)
) })

add({ name: '冰淇淋', cat: '甜品', cols: ['food'], hot: 69, boards: 1, colors: 12, svg: svg(
  H.bg('#F3F9FF'),
  H.circle(100, 56, 30, '#FFC7DE'),
  H.circle(82, 74, 24, '#FFE1A8'),
  H.circle(118, 74, 24, '#B8E4C9'),
  H.path('M74 84h52l-22 60h-8z', '#E0A96D'),
  H.stroke('M84 100h32M90 118h22', 'none', ' stroke="#C98F51" stroke-width="4" stroke-linecap="round"'),
  H.circle(100, 34, 6, '#EF4B68')
) })

add({ name: '马卡龙', cat: '甜品', cols: ['food'], hot: 55, boards: 1, colors: 13, svg: svg(
  H.bg('#FFF0F7'),
  H.ellipse(100, 74, 46, 22, '#F4A0BE'),
  H.ellipse(100, 96, 46, 22, '#F4A0BE'),
  H.rect(54, 80, 92, 10, '#FFF3EA'),
  H.ellipse(100, 74, 40, 15, '#FFC9DC'),
  H.ellipse(100, 96, 40, 15, '#FFC9DC'),
  H.stroke('M78 92h44', 'none', ' stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"')
) })

add({ name: '纸杯蛋糕', cat: '甜品', cols: ['food'], hot: 62, boards: 1, colors: 14, svg: svg(
  H.bg('#FFF6E9'),
  H.path('M66 88h68l-8 48H74z', '#7FC6E8'),
  H.stroke('M84 88l-4 48M100 88v48M116 88l4 48', 'none', ' stroke="#5FA9CD" stroke-width="4" stroke-linecap="round"'),
  H.path('M58 88c0-22 18-38 42-38s42 16 42 38z', '#FFB3C9'),
  H.circle(100, 40, 9, '#EF4B68'),
  H.stroke('M70 70q14-10 28-2M104 68q14-10 28-2', 'none', ' stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"')
) })

/* ---------------- C 组：水果 / 植物 ---------------- */

add({ name: '草莓', cat: '水果', cols: ['food'], hot: 60, boards: 1, colors: 11, svg: svg(
  H.bg('#FFF3F0'),
  H.path('M100 46c28 0 54 18 49 49-5 33-33 48-49 48S56 128 51 95c-5-31 21-49 49-49z', '#EF536C'),
  H.path('M84 49l16-20 16 20 22-8-10 18H72L62 41z', '#5DBF83'),
  H.circle(80, 76, 3.5, '#FFE59A'),
  H.circle(102, 68, 3.5, '#FFE59A'),
  H.circle(122, 81, 3.5, '#FFE59A'),
  H.circle(90, 100, 3.5, '#FFE59A'),
  H.circle(113, 111, 3.5, '#FFE59A')
) })

add({ name: '柠檬', cat: '水果', cols: ['food'], hot: 48, boards: 1, colors: 10, svg: svg(
  H.bg('#FFFCE4'),
  H.ellipse(100, 82, 46, 36, '#F7D94C'),
  H.ellipse(100, 82, 34, 25, '#FFF3A8'),
  H.stroke('M100 60v44M78 82h44M85 68l30 28M115 68l-30 28', 'none', ' stroke="#F0C93A" stroke-width="3.5" stroke-linecap="round"'),
  H.path('M100 46c0-8 6-14 14-14-2 10-6 14-14 14z', '#6FBF7F')
) })

add({ name: '西瓜', cat: '水果', cols: ['food'], hot: 57, boards: 1, colors: 9, svg: svg(
  H.bg('#EEFBF1'),
  H.path('M30 44h140c0 44-32 76-70 76S30 88 30 44z', '#5DBF83'),
  H.path('M40 50h120c0 38-28 64-60 64S40 88 40 50z', '#F6F1D8'),
  H.path('M50 56h100c0 32-24 54-50 54S50 88 50 56z', '#EF536C'),
  H.circle(78, 76, 3, '#3A3226'),
  H.circle(104, 68, 3, '#3A3226'),
  H.circle(122, 84, 3, '#3A3226'),
  H.circle(92, 96, 3, '#3A3226')
) })

add({ name: '牛油果', cat: '水果', cols: ['food'], hot: 53, boards: 1, colors: 11, svg: svg(
  H.bg('#F1F8E9'),
  H.ellipse(100, 86, 40, 50, '#4E8C3A'),
  H.ellipse(100, 88, 33, 43, '#B7D96A'),
  H.circle(100, 104, 20, '#8A5A3A'),
  H.stroke('M96 100a5 5 0 1 0 8 4', 'none', ' stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"')
) })

add({ name: '向日葵', cat: '植物', cols: ['plant'], hot: 55, boards: 1, colors: 11, svg: svg(
  H.bg('#FFF9DC'),
  `<g fill="#FFD34D"><circle cx="100" cy="68" r="22"/><circle cx="100" cy="27" r="18"/><circle cx="100" cy="109" r="18"/><circle cx="59" cy="68" r="18"/><circle cx="141" cy="68" r="18"/><circle cx="71" cy="39" r="18"/><circle cx="129" cy="39" r="18"/><circle cx="71" cy="98" r="18"/><circle cx="129" cy="98" r="18"/></g>`,
  H.circle(100, 68, 20, '#8F5B2E'),
  H.stroke('M100 88v49M100 117c-18-15-28-11-36-5M100 106c18-15 28-11 36-5', '#4F9567', 7)
) })

add({ name: '多肉盆栽', cat: '植物', cols: ['plant'], hot: 50, boards: 1, colors: 13, svg: svg(
  H.bg('#EEFAF3'),
  H.path('M74 96h52l-6 42H80z', '#E08E6D'),
  H.rect(70, 90, 60, 12, '#C97A5B', 4),
  H.ellipse(100, 74, 16, 22, '#7CBF8B'),
  H.ellipse(80, 80, 12, 17, '#95CFA2', -22),
  H.ellipse(120, 80, 12, 17, '#95CFA2', 22),
  H.ellipse(100, 60, 11, 16, '#A9DDB4')
) })

add({ name: '仙人掌', cat: '植物', cols: ['plant'], hot: 46, boards: 1, colors: 10, svg: svg(
  H.bg('#FFF6E4'),
  H.path('M88 44h24v86H88z', '#5DA86F'),
  H.path('M88 70H70v20h18z', '#5DA86F'),
  H.path('M112 62h18v20h-18z', '#5DA86F'),
  H.path('M88 44a12 12 0 0 1 24 0z', '#5DA86F'),
  H.rect(74, 126, 52, 16, '#D98E63', 5),
  H.stroke('M96 58v-8M100 62v-8M104 58v-8', 'none', ' stroke="#3F7C4E" stroke-width="3" stroke-linecap="round"'),
  H.circle(100, 88, 3, '#F7D94C')
) })

add({ name: '小雏菊', cat: '植物', cols: ['plant'], hot: 44, boards: 1, colors: 10, svg: svg(
  H.bg('#F4FBF6'),
  `<g fill="#FFFFFF"><ellipse cx="100" cy="48" rx="13" ry="18"/><ellipse cx="100" cy="106" rx="13" ry="18"/><ellipse cx="72" cy="74" rx="18" ry="13"/><ellipse cx="128" cy="74" rx="18" ry="13"/></g>`,
  `<g fill="#FFF3C9"><ellipse cx="82" cy="52" rx="11" ry="15" transform="rotate(-40 82 52)"/><ellipse cx="118" cy="52" rx="11" ry="15" transform="rotate(40 118 52)"/><ellipse cx="82" cy="98" rx="11" ry="15" transform="rotate(40 82 98)"/><ellipse cx="118" cy="98" rx="11" ry="15" transform="rotate(-40 118 98)"/></g>`,
  H.circle(100, 78, 14, '#F5C64C'),
  H.stroke('M100 106v42', '#5DA86F', 7)
) })

/* ---------------- D 组：可爱 / 幻想 ---------------- */

add({ name: '彩虹小云', cat: '可爱', cols: ['cute'], hot: 88, boards: 1, colors: 12, svg: svg(
  H.bg('#FFF4E9'),
  H.path('M42 103c0-19 15-34 34-34 7-19 26-31 47-25 14 4 24 13 28 27 18-2 33 11 33 28 0 17-14 30-31 30H71c-16 0-29-12-29-26z', '#FFFFFF'),
  H.stroke('M55 122c22-9 29-14 43-7 12 6 21 8 33 1 15-9 27-8 39 2', '#FF92B2', 10),
  H.stroke('M63 111c16-7 21-10 31-5', '#FFD24E', 10)
) })

add({ name: '爱心糖果', cat: '可爱', cols: ['cute'], hot: 66, boards: 1, colors: 11, svg: svg(
  H.bg('#FFF0F7'),
  H.path('M58 72c-12-18 1-36 18-36 12 0 20 8 24 17 4-9 12-17 24-17 17 0 30 18 18 36l-42 45z', '#FF78A2'),
  H.stroke('M52 82l-18-10 8 21 16-2M148 82l18-10-8 21-16-2', '#FFB7CC', 8),
  H.stroke('M81 67l38 31M119 67L81 98', '#FFFFFF', 7)
) })

add({ name: '太阳小表情', cat: '可爱', cols: ['cute'], hot: 58, boards: 1, colors: 10, svg: svg(
  H.bg('#FFF8D7'),
  H.circle(100, 80, 47, '#FFD84F'),
  `<g stroke="#EFA92E" stroke-width="7" stroke-linecap="round"><path d="M100 22v-10M100 148v-10M42 80H32M168 80h-10M58 38l-7-8M149 130l-7-8M58 122l-7 8M149 30l-7 8"/></g>`,
  H.eyes(100, 78, 17, 4.5, '#6D5633'),
  H.stroke('M87 98q13 10 26 0', '#6D5633', 5)
) })

add({ name: '月亮与星星', cat: '幻想', cols: ['fantasy'], hot: 63, boards: 1, colors: 9, svg: svg(
  H.bg('#EDF0FF'),
  H.path('M132 35c-8 34 7 61 39 70-12 17-31 27-51 22-30-7-45-39-32-66 7-16 24-28 44-26z', '#FFD86C'),
  H.path('M58 44l6 16 17 1-13 11 4 17-14-9-15 9 5-17-14-11 18-1z', '#FFCA48'),
  H.circle(66, 113, 5, '#9C93DB'),
  H.circle(93, 42, 5, '#9C93DB'),
  H.circle(45, 89, 4, '#9C93DB')
) })

add({ name: '蘑菇小屋', cat: '幻想', cols: ['fantasy'], hot: 70, boards: 1, colors: 12, svg: svg(
  H.bg('#EEF8F2'),
  H.path('M45 76c4-35 26-52 55-52s51 17 55 52z', '#E85F67'),
  H.circle(74, 50, 6, '#FFF0D5'),
  H.circle(103, 40, 7, '#FFF0D5'),
  H.circle(127, 55, 6, '#FFF0D5'),
  H.rect(67, 76, 66, 57, '#F7CF8A'),
  H.rect(91, 98, 18, 35, '#A66E4F'),
  H.circle(80, 96, 5, '#70A86D'),
  H.circle(120, 96, 5, '#70A86D')
) })

add({ name: '小熊软糖', cat: '可爱', cols: ['cute'], hot: 61, boards: 1, colors: 11, svg: svg(
  H.bg('#FFF1F4'),
  H.circle(72, 52, 14, '#F58AA8'),
  H.circle(128, 52, 14, '#F58AA8'),
  H.ellipse(100, 76, 34, 28, '#F58AA8'),
  H.ellipse(100, 116, 26, 22, '#F58AA8'),
  H.circle(88, 80, 9, '#FFD9E2'),
  H.circle(112, 80, 9, '#FFD9E2'),
  H.ellipse(100, 122, 9, 8, '#FFE9EE')
) })

add({ name: '彩虹独角兽', cat: '幻想', cols: ['fantasy', 'cute'], hot: 72, boards: 1, colors: 14, svg: svg(
  H.bg('#FDF0FF'),
  H.path('M96 30l14 26-10 4-16-22z', '#F7D94C'),
  H.path('M60 56c-6 30 8 62 40 62s46-32 40-62z', '#FFFFFF'),
  H.path('M60 56c-8 14-6 30 4 40-12 6-20-8-14-20z', '#FFC7DE'),
  H.eyes(100, 84, 17, 4.5, '#5B4A6B'),
  H.circle(100, 104, 7, '#F58AA8'),
  `<g><circle cx="60" cy="46" r="6" fill="#71C5DF"/><circle cx="76" cy="38" r="6" fill="#F7D94C"/><circle cx="92" cy="32" r="6" fill="#F18A82"/></g>`
) })

add({ name: '简单笑脸', cat: '可爱', cols: ['avatar', 'cute'], hot: 50, boards: 1, colors: 8, svg: svg(
  H.bg('#FFF8E0'),
  H.circle(100, 80, 46, '#FFD84F'),
  H.eyes(100, 74, 18, 6, '#4A3A1E'),
  H.stroke('M82 98q18 16 36 0', '#4A3A1E', 6),
  H.circle(68, 64, 8, '#FFB74D'),
  H.circle(132, 64, 8, '#FFB74D')
) })

add({ name: '开心云朵', cat: '可爱', cols: ['cute'], hot: 49, boards: 1, colors: 9, svg: svg(
  H.bg('#EAF7FB'),
  H.path('M52 106c0-18 14-32 32-32 6-16 24-26 42-21 12 4 21 12 24 24 15-2 28 9 28 24 0 14-12 25-26 25H78c-14 0-26-10-26-20z', '#FFFFFF'),
  H.eyes(96, 92, 15, 4, '#5B6B72'),
  H.stroke('M82 106q14 11 28 0', '#5B6B72', 4.5)
) })

/* ---------------- E 组：情侣 / 节日 ---------------- */

add({ name: '一对小熊', cat: '情侣', cols: ['couple'], hot: 89, boards: 1, colors: 13, svg: svg(
  H.bg('#FFF0EC'),
  H.circle(64, 70, 10, '#B98E6F'),
  H.circle(88, 70, 10, '#B98E6F'),
  H.circle(76, 86, 30, '#B98E6F'),
  H.circle(112, 70, 10, '#D8B089'),
  H.circle(136, 70, 10, '#D8B089'),
  H.circle(124, 86, 30, '#D8B089'),
  H.eyes(76, 90, 7, 3, '#4A3327'),
  H.eyes(124, 90, 7, 3, '#4A3327'),
  H.stroke('M70 98q6 5 12 0M118 98q6 5 12 0', '#4A3327', 3),
  H.stroke('M104 94c-4-10 8-14 16-8', '#FF87AB', 6)
) })

add({ name: '爱心企鹅', cat: '情侣', cols: ['couple'], hot: 72, boards: 1, colors: 11, svg: svg(
  H.bg('#E8F5FB'),
  H.path('M100 44c30 0 46 30 42 54-4 26-26 38-42 38s-38-12-42-38c-4-24 12-54 42-54z', '#2D2927'),
  H.path('M100 50c24 0 36 24 32 42-3 20-20 30-32 30s-29-10-32-30c-4-18 8-42 32-42z', '#FFFFFF'),
  H.path('M100 56c16 0 24 18 20 30-3 12-14 18-20 18s-17-6-20-18c-4-12 4-30 20-30z', '#2D2927'),
  H.circle(90, 80, 4, '#FFFFFF'),
  H.circle(110, 80, 4, '#FFFFFF'),
  H.stroke('M96 88q4 4 8 0', '#FFD86B', 3),
  H.stroke('M78 110q-12-3-20 0M122 110q12-3 20 0', '#2D2927', 6)
) })

add({ name: '牵手的猫', cat: '情侣', cols: ['couple', 'pet'], hot: 68, boards: 1, colors: 14, svg: svg(
  H.bg('#FFF4F0'),
  H.path('M48 68l8-20 18 14c13-5 21-5 34 0l17-14 9 21c5 8 7 18 4 28-6 20-27 30-50 30s-44-10-50-30c-3-10-1-20 10-29z', '#F4A15B'),
  H.path('M152 68l-8-20-18 14c-13-5-21-5-34 0l-17-14-9 21c-5 8-7 18-4 28 6 20 27 30 50 30s44-10 50-30c3-10 1-20-10-29z', '#C9C4C0'),
  H.eyes(74, 96, 10, 3.5, '#5B4638'),
  H.eyes(126, 96, 10, 3.5, '#4A4A4A'),
  H.stroke('M96 112q4 5 8 0M100 116q4 5 8 0', '#8A6A5A', 3.5)
) })

add({ name: '情人节玫瑰', cat: '情侣', cols: ['couple', 'holiday'], hot: 64, boards: 1, colors: 12, svg: svg(
  H.bg('#FFF0F2'),
  H.path('M100 44c14 0 26 8 30 20 4 12-2 24-14 28-8 3-14 9-14 17v33', 'none', ' stroke="#5DA86F" stroke-width="7" stroke-linecap="round"'),
  H.stroke('M100 96c-14-10-26-8-34 0M100 108c14-10 26-8 34 0', 'none', ' stroke="#5DA86F" stroke-width="6" stroke-linecap="round"'),
  H.circle(100, 62, 22, '#EF536C'),
  H.path('M100 48c-8 6-10 16-4 22s16 6 22 0', 'none', ' stroke="#C93B52" stroke-width="5" stroke-linecap="round"'),
  H.path('M86 78c-6-8-16-8-20-2 6 8 16 10 20 2z', '#5DBF83')
) })

add({ name: '圣诞树', cat: '节日', cols: ['holiday'], hot: 82, boards: 1, colors: 12, svg: svg(
  H.bg('#E8F6EE'),
  H.path('M100 26l30 46h-24l26 42h-26l26 40h-64l26-40h-26l26-42h-24z', '#3FA66A'),
  H.rect(93, 126, 14, 20, '#8A5A3A', 3),
  H.circle(100, 52, 6, '#FFD84F'),
  H.circle(78, 84, 6, '#FF87AB'),
  H.circle(122, 84, 6, '#66B8FF'),
  H.circle(100, 112, 6, '#FFD84F'),
  H.path('M100 22l6 9-6 3-6-3z', '#FFD84F')
) })

add({ name: '万圣节南瓜', cat: '节日', cols: ['holiday'], hot: 78, boards: 1, colors: 11, svg: svg(
  H.bg('#2B2420'),
  H.ellipse(100, 94, 46, 38, '#FF9A3D'),
  H.ellipse(100, 94, 30, 38, '#FFB05C'),
  H.path('M100 48c-6 0-9-6-5-10 5-5 15-1 15 5-1 3-5 4-10 5z', '#3FA66A'),
  H.path('M76 84l10 8-10 8zM124 84l-10 8 10 8z', '#D9761F'),
  H.path('M82 112q18 10 36 0', 'none', ' stroke="#D9761F" stroke-width="5" stroke-linecap="round"')
) })

add({ name: '新春灯笼', cat: '节日', cols: ['holiday', 'guofeng'], hot: 85, feat: true, featBg: 'linear-gradient(135deg,#FFF0E6,#FFE0E0)', boards: 1, colors: 11, svg: svg(
  H.bg('#FFF0E6'),
  H.path('M84 34c-8 0-10 8-8 14h48c2-6 0-14-8-14z', '#D94F4F'),
  H.path('M70 48h60l-8 70c-2 14-42 14-44 0z', '#EF5B5B'),
  H.stroke('M100 48v70', '#C23B3B', 4, 'butt'),
  H.path('M100 118l-14 8 14-2 14 2z', '#F0B23F'),
  H.circle(100, 80, 16, '#FFD86B'),
  H.stroke('M96 80h8M100 76v8', '#D94F4F', 3)
) })

add({ name: '礼物盒', cat: '节日', cols: ['holiday'], hot: 59, boards: 1, colors: 12, svg: svg(
  H.bg('#F1F6FF'),
  H.rect(56, 70, 88, 62, '#71C5DF', 8),
  H.rect(56, 70, 88, 16, '#5AAEC9', 8),
  H.rect(90, 70, 20, 62, '#F7D94C'),
  H.path('M100 70c-16-22-34-14-30-2 3 9 18 8 30 2zM100 70c16-22 34-14 30-2-3 9-18 8-30 2z', '#F18A82')
) })

add({ name: '生日蛋糕', cat: '节日', cols: ['holiday', 'food'], hot: 71, boards: 1, colors: 13, svg: svg(
  H.bg('#FFF3F8'),
  H.rect(58, 88, 84, 46, '#F4B46E', 6),
  H.rect(58, 88, 84, 14, '#F58AA8', 6),
  H.path('M50 88c0-18 22-30 50-30s50 12 50 30z', '#FFFFFF'),
  H.rect(97, 46, 6, 20, '#71C5DF', 3),
  H.path('M100 34c6 6 4 12 0 14-4-2-6-8 0-14z', '#F7D94C'),
  H.circle(78, 108, 4, '#EF536C'),
  H.circle(100, 116, 4, '#71C5DF'),
  H.circle(122, 108, 4, '#7CBF8B')
) })

/* ---------------- F 组：头像 / 二次元 / 国风 ---------------- */

add({ name: '星星眼少女', cat: '头像', cols: ['avatar', 'anime'], hot: 92, boards: 1, colors: 14, svg: svg(
  H.bg('#F3ECFF'),
  H.path('M100 40c22 0 38 16 38 36 0 8-2 15-6 21l18 26H50l18-26c-4-6-6-13-6-21 0-20 16-36 38-36z', '#FFD9B3'),
  H.path('M60 52c-8-10-4-26 12-26 12 0 20 9 20 19 0 5-2 9-5 12zM140 52c8-10 4-26-12-26-12 0-20 9-20 19 0 5 2 9 5 12z', '#8B5A3A'),
  H.circle(84, 82, 8, '#FFFFFF'),
  H.circle(116, 82, 8, '#FFFFFF'),
  H.path('M84 78l3 5 6 2-6 3-3 5-3-5-6-3 6-2zM116 78l3 5 6 2-6 3-3 5-3-5-6-3 6-2z', '#FFD84F'),
  H.stroke('M96 94q4 4 8 0', '#C25B6E', 3),
  H.circle(72, 80, 5, '#FF9DB0'),
  H.circle(128, 80, 5, '#FF9DB0')
) })

add({ name: '猫耳少女', cat: '头像', cols: ['avatar', 'anime'], hot: 96, feat: true, featBg: 'linear-gradient(135deg,#EEF2FF,#FFD9EC)', boards: 1, colors: 14, svg: svg(
  H.bg('#EEF2FF'),
  H.path('M100 44c24 0 40 18 40 40 0 9-3 17-7 23l20 28H47l20-28c-4-6-7-14-7-23 0-22 16-40 40-40z', '#FFE0D0'),
  H.path('M62 44l-6-22c-4-12 10-18 18-10l18 18zM138 44l6-22c4-12-10-18-18-10l-18 18z', '#7A6AF0'),
  H.stroke('M100 34c0-18-10-24-22-24', '#6B5BD0', 5),
  H.eyes(100, 86, 16, 6, '#2B2B2B'),
  H.stroke('M96 96q4 4 8 0', '#C25B6E', 3),
  H.circle(72, 80, 5, '#FF9DB0'),
  H.circle(128, 80, 5, '#FF9DB0')
) })

add({ name: '国风团扇', cat: '国风', cols: ['guofeng'], hot: 73, boards: 1, colors: 12, svg: svg(
  H.bg('#FDEEF0'),
  H.path('M100 52c30 4 48 24 44 44-3 18-18 30-36 30h-16c-18 0-33-12-36-30-4-20 14-40 44-44z', '#FFD9E0'),
  H.path('M100 52c30 4 48 24 44 44-3 18-18 30-36 30h-16c-18 0-33-12-36-30-4-20 14-40 44-44z', 'none', ' stroke="#FF87AB" stroke-width="4"'),
  H.stroke('M100 126v18', '#A66E4F', 8),
  H.stroke('M78 82c12-10 26-14 42-12', '#CF4F79', 5),
  H.circle(100, 74, 6, '#CF4F79'),
  H.stroke('M88 96q12 9 24 0', '#CF4F79', 4)
) })

add({ name: '梅花', cat: '国风', cols: ['guofeng'], hot: 61, boards: 1, colors: 11, svg: svg(
  H.bg('#FDF3F5'),
  H.stroke('M54 128c8-40 34-62 68-60 30 2 52 24 54 52', '#5D4638', 8),
  `<g fill="#EF6A8A"><circle cx="70" cy="72" r="12"/><circle cx="70" cy="48" r="12"/><circle cx="46" cy="60" r="12"/><circle cx="94" cy="60" r="12"/></g>`,
  H.circle(70, 60, 11, '#FFD9E0'),
  `<g fill="#EF6A8A"><circle cx="140" cy="40" r="10"/><circle cx="128" cy="52" r="10"/><circle cx="152" cy="52" r="10"/></g>`,
  H.circle(140, 52, 9, '#FFD9E0'),
  `<g fill="#FFB3C6"><circle cx="128" cy="96" r="9"/><circle cx="118" cy="106" r="9"/><circle cx="138" cy="106" r="9"/></g>`,
  H.circle(128, 106, 8, '#FFFFFF')
) })

add({ name: '中国龙', cat: '国风', cols: ['guofeng'], hot: 98, feat: true, featBg: 'linear-gradient(135deg,#FFF0E7,#FFD6D6)', boards: 2, colors: 16, svg: svg(
  H.bg('#FFF0E7'),
  H.path('M45 103c18-43 67-59 111-32 11 7 18 18 14 28-4 9-18 9-23 0-6-11-2-22 12-28-18-5-34 0-44 8 14 4 24 14 24 26 0 12-12 21-24 19-8-1-13-7-14-14-1 11-8 20-20 22-16 3-30-12-36-29z', '#ED655D'),
  H.circle(140, 60, 5, '#2B2B2B'),
  H.stroke('M62 63l-13-9M73 58l-8-15M153 91l20 5M153 98l18 11', '#D14B4A', 7)
) })

add({ name: '水墨远山', cat: '国风', cols: ['guofeng'], hot: 42, boards: 1, colors: 9, svg: svg(
  H.bg('#F6F4EC'),
  H.path('M20 118c22-30 34-46 48-46 12 0 18 12 28 26 8-16 16-26 26-26 12 0 22 18 38 46z', '#8A9AA6'),
  H.path('M52 118c14-22 22-34 30-34 8 0 13 9 20 20 6-12 11-19 18-19 9 0 16 13 26 33z', '#B9C4CC'),
  H.circle(146, 44, 15, '#E8C86A'),
  H.stroke('M40 88h34M120 106h40', 'none', ' stroke="#C7CFD6" stroke-width="3" stroke-linecap="round"')
) })

/* ---------------- G 组：像素艺术 / 游戏感 ---------------- */

add({ name: '像素小勇者', cat: '二次元', cols: ['anime', 'pixel'], hot: 57, boards: 1, colors: 12, svg: svg(
  H.bg('#E9F6FF'),
  H.rect(70, 30, 60, 50, '#FFD9B3', 6),
  H.rect(80, 80, 40, 46, '#4B86D8', 6),
  H.rect(70, 80, 10, 46, '#4B86D8', 4),
  H.rect(120, 80, 10, 46, '#4B86D8', 4),
  H.rect(80, 126, 14, 18, '#5B4638'),
  H.rect(106, 126, 14, 18, '#5B4638'),
  H.rect(84, 42, 8, 8, '#2B2B2B'),
  H.rect(108, 42, 8, 8, '#2B2B2B'),
  H.rect(94, 58, 12, 4, '#2B2B2B'),
  H.rect(94, 104, 12, 22, '#FFD84F')
) })

add({ name: '动漫星星', cat: '二次元', cols: ['anime'], hot: 54, boards: 1, colors: 10, svg: svg(
  H.bg('#FFF4FA'),
  H.path('M100 30l12 26 28 3-20 19 5 28-25-14-25 14 5-28-20-19 28-3z', '#FFD84F'),
  H.path('M100 30l12 26 28 3-20 19 5 28-25-14-25 14 5-28-20-19 28-3z', 'none', ' stroke="#FF87AB" stroke-width="3"'),
  H.circle(46, 54, 5, '#FF87AB'),
  H.circle(158, 46, 4, '#66B8FF'),
  H.circle(150, 120, 5, '#A88CFF'),
  H.circle(52, 122, 4, '#66B8FF')
) })

add({ name: '像素爱心', cat: '二次元', cols: ['pixel', 'cute'], hot: 47, boards: 1, colors: 6, svg: svg(
  H.bg('#FFF1F4'),
  H.path('M100 124L44 74c-12-14-4-36 16-36 12 0 20 8 24 17 4-9 12-17 24-17 20 0 28 22 16 36z', '#EF536C'),
  H.rect(84, 76, 12, 12, '#FFFFFF', 2),
  H.rect(104, 76, 12, 12, '#FFFFFF', 2),
  H.rect(94, 62, 12, 12, '#FFFFFF', 2)
) })

add({ name: '复古游戏机', cat: '二次元', cols: ['pixel', 'anime'], hot: 51, boards: 1, colors: 13, svg: svg(
  H.bg('#F3F6E9'),
  H.rect(46, 46, 108, 74, '#C9CBB8', 10),
  H.rect(62, 58, 52, 40, '#7CBF8B', 5),
  H.rect(70, 66, 36, 24, '#3A4A34', 3),
  H.circle(134, 68, 8, '#EF536C'),
  H.circle(150, 86, 8, '#EF536C'),
  H.rect(126, 96, 30, 8, '#8A8E7A', 3)
) })

add({ name: '像素蘑菇', cat: '二次元', cols: ['pixel', 'plant'], hot: 45, boards: 1, colors: 10, svg: svg(
  H.bg('#F1F8EC'),
  H.path('M52 84c0-26 22-44 48-44s48 18 48 44z', '#EF536C'),
  H.circle(82, 68, 7, '#FFFFFF'),
  H.circle(112, 58, 8, '#FFFFFF'),
  H.circle(130, 76, 6, '#FFFFFF'),
  H.rect(84, 84, 32, 42, '#FFF3E4', 4),
  H.rect(92, 96, 8, 8, '#5B4638'),
  H.rect(108, 96, 8, 8, '#5B4638')
) })

/* ------------------------------------------------------------ 统计信息 */

/** 分类 → 合集 key（PRD §22 分类） */
const CAT_COLS = {
  动物: ['pet'],
  宠物: ['pet'],
  甜品: ['food'],
  水果: ['food'],
  植物: ['plant'],
  可爱: ['cute'],
  幻想: ['fantasy'],
  情侣: ['couple'],
  节日: ['holiday'],
  头像: ['avatar'],
  国风: ['guofeng'],
  二次元: ['anime']
}

/** 难度 / 预计时间：由板数与颜色数推导，保证与卡片显示一致 */
function derive(a) {
  const boards = a.boards || 1
  const cells = boards * boards * 29 * 29
  const colors = a.colors || 12
  // 拼制速度按每分钟 22 颗估（有图纸照着摆的常见速度）
  const minutes = Math.max(8, Math.round((cells * (0.42 + colors * 0.018)) / 22))
  let diff = '入门'
  if (minutes > 25) diff = '简单'
  if (minutes > 60) diff = '进阶'
  if (minutes > 120) diff = '挑战'
  return {
    id: a.id,
    name: a.name,
    cat: a.cat,
    svg: a.svg,
    tier: a.tier || 'free',
    hot: a.hot || 50,
    cols: a.cols || CAT_COLS[a.cat] || [],
    feat: !!a.feat,
    featBg: a.featBg || null,
    boards,
    size: `${boards * 29} × ${boards * 29}`,
    grid: boards * 29,
    colors,
    beads: cells,
    minutes,
    difficulty: diff,
    duration: minutes <= 30 ? '30分钟' : minutes <= 60 ? '1小时' : minutes <= 120 ? '2小时' : '半天',
    isNew: !!a.isNew
  }
}

/** 稳定 id：按名称生成短哈希，避免数组顺序变化导致存档失效 */
function stableId(name) {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  return 'a' + h.toString(36).slice(0, 7)
}

const list = ASSETS.map((a, i) => derive({ ...a, id: stableId(a.name) }))

/** 标注部分为新上架（内容运营节奏，PRD §54） */
const NEW_NAMES = ['熊猫', '小狐狸', '冰淇淋', '马卡龙', '多肉盆栽', '彩虹独角兽', '像素爱心', '水墨远山', '生日蛋糕', '国风团扇']
for (const a of list) if (NEW_NAMES.includes(a.name)) a.isNew = true

/**
 * 会员专属素材：选「耗时较长 / 颜色较多」的进阶图案，
 * 让免费层能真正完成一件作品，同时保留升级动机（PRD §24 原则）。
 */
const PRO_NAMES = [
  '中国龙', '星星眼少女', '猫耳少女', '彩虹独角兽', '一对小熊', '牵手的猫',
  '圣诞树', '万圣节南瓜', '像素小勇者', '复古游戏机', '生日蛋糕', '水墨远山'
]
for (const a of list) if (PRO_NAMES.includes(a.name)) a.tier = 'pro'

/** 去重校验：同名会覆盖存档引用，构建期就报错 */
const seen = new Map()
for (const a of list) {
  if (seen.has(a.name)) throw new Error('素材重名：' + a.name)
  seen.set(a.name, a)
}
const idSeen = new Set()
for (const a of list) {
  if (idSeen.has(a.id)) throw new Error('素材 id 冲突：' + a.name)
  idSeen.add(a.id)
}

const COLLECTIONS = [
  { key: 'all', name: '全部' },
  { key: 'free', name: '免费精选' },
  { key: 'hot', name: '今日热门' },
  { key: 'new', name: '新上架' },
  { key: 'quick', name: '30分钟完成' },
  { key: 'pet', name: '宠物' },
  { key: 'cute', name: '可爱' },
  { key: 'food', name: '甜品美食' },
  { key: 'plant', name: '植物' },
  { key: 'couple', name: '情侣' },
  { key: 'avatar', name: '头像' },
  { key: 'guofeng', name: '国风' },
  { key: 'anime', name: '二次元' },
  { key: 'fantasy', name: '幻想' },
  { key: 'holiday', name: '节日' },
  { key: 'pixel', name: '像素艺术' }
]

const out = `// 豆玩 DOUWAN 素材库（平台自制，不使用任何未经授权的 IP 形象）
// 本文件由 scripts/build-assets.cjs 生成，请勿手改。
// 素材统计（尺寸 / 颜色数 / 豆数 / 难度 / 预计时间）由脚本按同一套规则推导，
// 与素材卡片上显示的数值保持一致。
// 重新生成：node scripts/build-assets.cjs

export const ASSETS = ${JSON.stringify(list, null, 1)}

export const COLLECTIONS = ${JSON.stringify(COLLECTIONS, null, 1)}

/** 合集筛选（PRD §22：全部 / 热门 / 新上架 / 30分钟完成 / 各分类） */
export function filterAssets({ col = 'all', keyword = '', tier = 'all', maxMinutes = 0 } = {}) {
  let list = ASSETS.slice()
  if (col === 'free') list = list.filter(a => a.tier === 'free')
  else if (col === 'hot') list = list.slice().sort((a, b) => b.hot - a.hot)
  else if (col === 'new') list = list.filter(a => a.isNew)
  else if (col === 'quick') list = list.filter(a => a.minutes <= 30)
  else if (col && col !== 'all') list = list.filter(a => a.cols.includes(col))
  if (tier !== 'all') list = list.filter(a => a.tier === tier)
  if (maxMinutes > 0) list = list.filter(a => a.minutes <= maxMinutes)
  const kw = String(keyword || '').trim().toLowerCase()
  if (kw) {
    list = list.filter(a =>
      a.name.toLowerCase().includes(kw) ||
      a.cat.toLowerCase().includes(kw) ||
      a.cols.some(c => c.includes(kw))
    )
  }
  return list
}

export function assetById(id) {
  return ASSETS.find(a => a.id === id) || null
}

export function assetByName(name) {
  return ASSETS.find(a => a.name === name) || null
}

export const freeAssets = ASSETS.filter(a => a.tier === 'free')
export const proAssets = ASSETS.filter(a => a.tier === 'pro')
export const featuredAssets = ASSETS.filter(a => a.feat)
export const hotAssets = ASSETS.slice().sort((a, b) => b.hot - a.hot).slice(0, 8)
export const newAssets = ASSETS.filter(a => a.isNew)

export const ASSET_COUNT = ASSETS.length

/** 一句话创作的关键词 → 素材名映射（按关键词长度优先匹配） */
export const PROMPT_KEYWORDS = ${JSON.stringify(buildKeywords(list), null, 1)}
`

function buildKeywords(list) {
  const map = [
    ['猫耳少女', '猫耳少女'], ['猫娘', '猫耳少女'], ['橘猫', '橘猫头像'], ['猫咪', '橘猫头像'], ['小猫', '橘猫头像'], ['猫', '橘猫头像'],
    ['柴犬', '小狗头像'], ['小狗', '小狗头像'], ['狗狗', '小狗头像'], ['狗', '小狗头像'],
    ['熊猫', '熊猫'], ['兔子', '小兔子'], ['兔', '小兔子'],
    ['仓鼠', '仓鼠'], ['老鼠', '仓鼠'], ['狐狸', '小狐狸'], ['企鹅', '小企鹅'], ['蜜蜂', '小蜜蜂'],
    ['小熊', '一对小熊'], ['熊', '一对小熊'],
    ['草莓蛋糕', '草莓蛋糕'], ['蛋糕', '生日蛋糕'], ['甜甜圈', '甜甜圈'], ['奶茶', '奶茶'],
    ['冰淇淋', '冰淇淋'], ['雪糕', '冰淇淋'], ['马卡龙', '马卡龙'], ['纸杯蛋糕', '纸杯蛋糕'],
    ['草莓', '草莓'], ['柠檬', '柠檬'], ['西瓜', '西瓜'], ['牛油果', '牛油果'],
    ['向日葵', '向日葵'], ['多肉', '多肉盆栽'], ['仙人掌', '仙人掌'], ['雏菊', '小雏菊'],
    ['彩虹小云', '彩虹小云'], ['彩虹', '彩虹小云'], ['云朵', '开心云朵'], ['云', '开心云朵'],
    ['爱心糖果', '爱心糖果'], ['糖果', '爱心糖果'], ['爱心', '爱心糖果'],
    ['太阳', '太阳小表情'], ['笑脸', '简单笑脸'], ['微笑', '简单笑脸'],
    ['月亮', '月亮与星星'], ['星星', '动漫星星'],
    ['蘑菇小屋', '蘑菇小屋'], ['蘑菇', '像素蘑菇'], ['小屋', '蘑菇小屋'],
    ['独角兽', '彩虹独角兽'], ['小熊软糖', '小熊软糖'],
    ['情人节', '情人节玫瑰'], ['玫瑰', '情人节玫瑰'], ['情侣', '牵手的猫'], ['牵手', '牵手的猫'],
    ['圣诞', '圣诞树'], ['万圣', '万圣节南瓜'], ['南瓜', '万圣节南瓜'],
    ['春节', '新春灯笼'], ['灯笼', '新春灯笼'], ['礼物', '礼物盒'], ['生日', '生日蛋糕'],
    ['中国龙', '中国龙'], ['龙', '中国龙'], ['梅花', '梅花'], ['水墨', '水墨远山'], ['远山', '水墨远山'],
    ['团扇', '国风团扇'], ['扇子', '国风团扇'], ['国风', '梅花'],
    ['少女', '星星眼少女'], ['女孩', '星星眼少女'],
    ['勇者', '像素小勇者'], ['像素', '像素小勇者'], ['游戏机', '复古游戏机'], ['游戏', '复古游戏机']
  ]
  const names = new Set(list.map(a => a.name))
  const out = {}
  for (const [kw, target] of map) if (names.has(target) && !out[kw]) out[kw] = target
  return out
}

const target = path.join(__dirname, '..', 'src', 'data', 'assets.js')
fs.writeFileSync(target, out, 'utf8')

const total = list.length
const freeN = list.filter(a => a.tier === 'free').length
const proN = total - freeN
console.log(`已生成 ${total} 个素材（免费 ${freeN} / 会员 ${proN}）`)
console.log(`分类覆盖：${COLLECTIONS.map(c => c.name).join(' / ')}`)
console.log(`写入：${target}`)
