/* 用真实照片（人物）渲染卡通化结果，供人工比对风格差距。

   开发过程中这张照片是判断"像不像手绘插画"的主要依据：synthetic 评测图都太平，
   只有真实人像才暴露得出"眼睛被平涂吃掉""描边糊成一层灰"这类问题。

   把要看的照片放到 out/photo-src/ 下（`.png`），然后：

     node scripts/fidelity/photo-render.mjs [--style key]

   默认把 CARTOON_STYLES 每一档都渲染一遍，写到 out/photo/ 。
   与 cartoon-bench.mjs 不同，这里**只看人眼效果**，不报指标。
*/

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cartoonize, CARTOON_STYLES } from '../../src/lib/cartoon.js'
import { readPNG, writePNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(HERE, 'out', 'photo-src')
const OUT = path.join(HERE, 'out', 'photo')

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : fallback
}

function writeRGB (file, rgba, w, h) {
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = rgba[i * 4]
    rgb[i * 3 + 1] = rgba[i * 4 + 1]
    rgb[i * 3 + 2] = rgba[i * 4 + 2]
  }
  writePNG(file, rgb, w, h)
}

if (!fs.existsSync(FIX) || !fs.readdirSync(FIX).some(f => /\.png$/i.test(f))) {
  console.error('把要看的照片（PNG）放进 ' + FIX + ' 再跑')
  process.exit(1)
}
const fixture = String(arg('fixture', fs.readdirSync(FIX).filter(f => /\.png$/i.test(f)).sort()[0])).replace(/\.png$/i, '')
const only = arg('style', null)
fs.mkdirSync(OUT, { recursive: true })

const img = readPNG(path.join(FIX, fixture + '.png'))
const styles = CARTOON_STYLES.filter(s => !only || s.key === only)

for (const style of styles) {
  const t0 = Date.now()
  const c = cartoonize(img.data, img.width, img.height, { style })
  writeRGB(path.join(OUT, `${fixture}__${style.key}.png`), c.data, c.width, c.height)
  console.log(style.key, JSON.stringify(c.meta), Date.now() - t0 + 'ms')
}
console.log('->', OUT)
