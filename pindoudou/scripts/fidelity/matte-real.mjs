/* =========================================================================
   抠图实拍检视（开发用）：拿真实素材图跑 estimateMatte，出「原图 | 抠图结果」对照图
   -------------------------------------------------------------------------
   素材库里的图大多是「带透明通道的 PNG」（走 alpha 分支），真正考验颜色模型的是
   用户自己上传的照片/白底图。这里把真实图跑一遍，肉眼看结果对不对，
   并把对照图落到 scripts/fidelity/out/real/ 下。

   用法：
     node scripts/fidelity/matte-real.mjs                 # 跑默认那批
     node scripts/fidelity/matte-real.mjs <png...>        # 跑指定文件
     node scripts/fidelity/matte-real.mjs --level soft
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { estimateMatte } from '../../src/lib/matte.js'
import { readPNG, writePNG } from './png.mjs'

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'out', 'real')
fs.mkdirSync(OUT, { recursive: true })

const args = process.argv.slice(2)
let level = 'normal'
const files = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--level') level = args[++i]
  else files.push(args[i])
}

/** 默认那批：素材库里比较典型的几张（白底 / 浅底 / 有投影） */
const DEFAULT = [
  'Z:/拼豆/素材库/素材/美食水果/蔬菜/扁豆.png',
  'Z:/拼豆/素材库/素材/动物/246501ac-66a3-42a0-bdcc-61669c116485.png',
  'Z:/拼豆/素材库/素材/植物/aff41301-499c-4d73-938a-5f350484e2f0.png'
].filter(f => fs.existsSync(f))

const list = files.length ? files : DEFAULT
if (!list.length) {
  console.log('没有可跑的图片（默认那批在 Z: 盘上，不在就显式给路径）')
  process.exit(0)
}

for (const file of list) {
  const img = readPNG(file)
  const t0 = Date.now()
  const m = estimateMatte(img.data, img.width, img.height, { level })
  const ms = Date.now() - t0

  // 合成：主体合成到白底上，看抠图结果长什么样
  const out = new Uint8ClampedArray(img.width * img.height * 4)
  for (let i = 0; i < img.width * img.height; i++) {
    const a = m.alpha ? m.alpha[i] : 1
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.round(img.data[i * 4 + c] * a + 255 * (1 - a))
    }
    out[i * 4 + 3] = 255
  }
  const base = path.basename(file).replace(/\.[^.]+$/, '')
  writePNG(path.join(OUT, `${base}-${level}-cut.png`), out, img.width, img.height)

  let subject = 0
  if (m.alpha) for (let i = 0; i < m.alpha.length; i++) if (m.alpha[i] >= 0.5) subject++
  console.log(
    base.padEnd(28),
    `${img.width}x${img.height}`.padEnd(11),
    'ok=' + String(m.ok).padEnd(5),
    'bgShare=' + (m.bgShare != null ? m.bgShare.toFixed(3) : '-').padStart(6),
    '主体=' + (m.alpha ? (subject / (img.width * img.height)).toFixed(3) : '-').padStart(6),
    'conf=' + (m.confidence != null ? m.confidence.toFixed(2) : '-').padStart(5),
    `影子=${m.stats ? (m.stats.shadowShare || 0).toFixed(3) : '-'}`,
    `掩膜=${m.stats ? m.stats.maskSide : '-'}`,
    `${ms}ms`,
    m.reason || ''
  )
}
