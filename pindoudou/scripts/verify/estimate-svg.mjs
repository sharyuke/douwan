/* =========================================================================
   SVG 体积估算（exporters.js 的导出闸门）准不准？

   为什么必须验：`estimateSvgBytes` 决定「给不给 SVG、要不要丢色号」，
   而它是一套**按模板长度手算**的上界估算 —— 一旦它比真实体积小，
   闸门就会放一个几十 MB 的字符串进浏览器（正是要避免的事）；
   一旦它大得离谱，小图纸会被莫名其妙地丢掉色号。
   所以这里直接建出真实 SVG 量长度，和估算值对比。

   用法：node scripts/verify/estimate-svg.mjs
   ========================================================================= */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateFromPixels, toSVG, estimateSvgBytes } from '../../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'
import { readPNG } from '../fidelity/png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, '..', 'fidelity', 'fixtures', 'photo_pumpkin.png')

const img = readPNG(FIXTURE)
const palette = getColors(DEFAULT_BRAND_ID)

/** 导出实际用的参数（见 exporters.js 的 exportSVG / exportPatternPNG） */
const CASES = [
  { grid: 29, cell: 12, codes: false },
  { grid: 58, cell: 12, codes: false },
  { grid: 116, cell: 12, codes: false },
  { grid: 116, cell: 12, codes: true },
  { grid: 300, cell: 12, codes: false },
  { grid: 300, cell: 12, codes: true },
  { grid: 450, cell: 12, codes: false },
  { grid: 450, cell: 12, codes: true }
]

console.log('画布        色号      估算        实际        估算/实际')
let worst = { ratio: 0, label: '' }
let failed = 0

for (const c of CASES) {
  const pattern = generateFromPixels(img.data, img.width, img.height, {
    gw: c.grid, gh: c.grid, fit: 'contain', targetColors: 30,
    brandId: DEFAULT_BRAND_ID, colors: palette, variantKey: 'easy'
  })
  const opts = { cell: c.cell, withGrid: true, withCodes: c.codes, withRuler: true }
  const est = estimateSvgBytes(pattern, opts)
  const real = toSVG(pattern, opts).length
  const ratio = real / est
  const label = `${c.grid}×${c.grid}${c.codes ? ' +色号' : ''}`
  console.log(
    `${(c.grid + '×' + c.grid).padEnd(10)}` +
    `${(c.codes ? '带' : '不带').padEnd(8)}` +
    `${(est / 1048576).toFixed(2).padStart(8)} MB` +
    `${(real / 1048576).toFixed(2).padStart(10)} MB` +
    `${ratio.toFixed(3).padStart(11)}`
  )
  /* 估算必须是不小于实际的保守上界（否则闸门形同虚设），
     但也不能保守到 1.6 倍以上（那会让小图纸被无谓地丢掉色号） */
  if (ratio > 1.0) {
    failed++
    console.log(`   ✗ 估算偏小 ${((ratio - 1) * 100).toFixed(1)}%：闸门会放进比预期更大的字符串`)
  } else if (ratio < 1 / 1.6) {
    failed++
    console.log(`   ✗ 估算过保守 ${(1 / ratio).toFixed(2)} 倍：可能白白丢掉色号`)
  }
  if (ratio > worst.ratio) worst = { ratio, label }
}

console.log(`\n最紧的一例：${worst.label}（实际 = 估算的 ${worst.ratio.toFixed(3)}）`)
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
