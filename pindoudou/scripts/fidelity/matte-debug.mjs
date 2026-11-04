/* 单张图的抠图诊断：把「背景色模型 / 核心背景背书 / 模糊地带的小岛判定」
   的中间量打出来，用来调参（开发用，不参与线上）。

   用法：node scripts/fidelity/matte-debug.mjs cut_touch_edge --level normal
*/
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { estimateMatte, matteLevel } from '../../src/lib/matte.js'
import { readPNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : fallback
}

const name = process.argv[2]
const levelKey = arg('level', 'normal')
if (!name) {
  console.error('用法：node scripts/fidelity/matte-debug.mjs cut_xxx --level normal')
  process.exit(1)
}

const img = readPNG(path.join(FIXTURES, `${name}.png`))
const rgba = new Uint8ClampedArray(img.width * img.height * 4)
for (let i = 0; i < img.width * img.height; i++) {
  rgba[i * 4] = img.data[i * 4]
  rgba[i * 4 + 1] = img.data[i * 4 + 1]
  rgba[i * 4 + 2] = img.data[i * 4 + 2]
  rgba[i * 4 + 3] = img.data[i * 4 + 3]
}

const level = matteLevel(levelKey)
const res = estimateMatte(rgba, img.width, img.height, { level: levelKey })
console.log(`图：${name}  ${img.width}x${img.height}  档位：${levelKey}`)
console.log(`ok=${res.ok} reason=${res.reason || '（无）'}`)
console.log('stats:', JSON.stringify({
  clusters: res.stats.clusters,
  bgColors: res.stats.bgColors,
  bgShare: res.stats.bgShare,
  shadowShare: res.stats.shadowShare,
  islandCount: res.stats.islandCount,
  maskSide: res.stats.maskSide,
  confidence: res.confidence
}, null, 1))
console.log('小岛判定：')
for (const it of res.stats.islands || []) {
  console.log(`  size=${String(it.size).padStart(7)} depth=${String(it.depth).padStart(4)} border=${it.border ? 'Y' : 'n'} `
    + `gradEdge=${it.gradEdge} gradInner=${it.gradInner} de=${it.de} -> ${it.keep ? '保留为主体' : it.why}`)
}
