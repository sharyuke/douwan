/* =========================================================================
   抠背景前后「拼豆图」对照图（Node，无浏览器）
   -------------------------------------------------------------------------
   和 matte-bench 的区别：那个比的是掩膜（IoU 之类的数字），
   这个比的是**用户真正看到的东西** —— 同一张图，关掉 / 打开「自动抠背景」
   各生成一次图案，把两张拼豆图并排画出来。

   用法：node scripts/fidelity/matte-pattern-compare.mjs
   输出：scripts/fidelity/out/cutout-before-after.png
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readPNG, writePNG } from './png.mjs'
import { generateFromPixels } from '../../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')
const OUT = path.join(HERE, 'out')

const EMPTY_FILL = [239, 241, 244]
const PANEL_BG = [255, 255, 255]
const GAP = 10

/** 把图案画成色块图（空格用淡灰，和白色豆区分开） */
function rasterize(pattern, cell, emptyFill = EMPTY_FILL) {
  const w = pattern.width * cell
  const h = pattern.height * cell
  const out = new Uint8ClampedArray(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    out[i * 3] = PANEL_BG[0]
    out[i * 3 + 1] = PANEL_BG[1]
    out[i * 3 + 2] = PANEL_BG[2]
  }
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const k = pattern.cells[y * pattern.width + x]
      const rgb = k < 0 ? emptyFill : pattern.palette[k].rgb
      for (let dy = 0; dy < cell; dy++) {
        const yy = y * cell + dy
        let o = (yy * w + x * cell) * 3
        for (let dx = 0; dx < cell; dx++) {
          out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]
          o += 3
        }
      }
    }
  }
  return { data: out, w, h }
}

/** 原图等比缩放到 height（最近邻，只看效果） */
function fitHeight(rgb, sw, sh, height) {
  const scale = height / sh
  const w = Math.max(1, Math.round(sw * scale))
  const out = new Uint8ClampedArray(w * height * 3)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor(y / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor(x / scale))
      const o = (y * w + x) * 3
      const s = (sy * sw + sx) * 3
      out[o] = rgb[s]; out[o + 1] = rgb[s + 1]; out[o + 2] = rgb[s + 2]
    }
  }
  return { data: out, w, h: height }
}

function loadRGBA(file) {
  const img = readPNG(file)
  const rgba = new Uint8ClampedArray(img.width * img.height * 4)
  for (let i = 0; i < img.width * img.height; i++) {
    rgba[i * 4] = img.data[i * 4]
    rgba[i * 4 + 1] = img.data[i * 4 + 1]
    rgba[i * 4 + 2] = img.data[i * 4 + 2]
    rgba[i * 4 + 3] = 255
  }
  return { rgba, w: img.width, h: img.height }
}

const CELL = 9
const PANEL_H = 29 * CELL
const ROW_GAP = 22

const FILES = ['photo_pumpkin.png', 'synth_product.png', 'synth_portrait.png']
const colors = getColors(DEFAULT_BRAND_ID)

const rows = []
for (const f of FILES) {
  const file = path.join(FIXTURES, f)
  if (!fs.existsSync(file)) continue
  const { rgba, w, h } = loadRGBA(file)
  const base = { gw: 29, gh: 29, targetColors: 13, brandId: DEFAULT_BRAND_ID, colors, variantKey: 'easy' }
  const off = generateFromPixels(rgba, w, h, { ...base, removeBg: false })
  const on = generateFromPixels(rgba, w, h, { ...base, removeBg: true })
  rows.push({
    name: f.replace(/\.png$/, ''),
    source: fitHeight(rgba, w, h, PANEL_H),
    off: rasterize(off, CELL),
    on: rasterize(on, CELL),
    statOff: `${off.stats.beadCount} 颗 · ${off.stats.colorCount} 色 · 还原 ${Math.round(off.stats.similarity * 100)}%`,
    statOn: `${on.stats.beadCount} 颗 · ${on.stats.colorCount} 色 · 还原 ${Math.round(on.stats.similarity * 100)}%`
  })
  console.log(`${f}: 关=${rows.at(-1).statOff} | 开=${rows.at(-1).statOn}`)
}

if (!rows.length) {
  console.error('没有可用的测试图，先跑 python scripts/fidelity/fixtures-gen.py')
  process.exit(1)
}

// 横向拼 [原图 | 关掉抠背景 | 打开抠背景]，纵向多行
const widths = rows.map(r => r.source.w + r.off.w + r.on.w + GAP * 4)
const totalW = Math.max(...widths)
const totalH = rows.length * PANEL_H + (rows.length + 1) * ROW_GAP
const canvas = new Uint8ClampedArray(totalW * totalH * 3)
for (let i = 0; i < totalW * totalH; i++) {
  canvas[i * 3] = 247; canvas[i * 3 + 1] = 248; canvas[i * 3 + 2] = 250
}

function blit(panel, x, y) {
  for (let row = 0; row < panel.h; row++) {
    const dst = ((y + row) * totalW + x) * 3
    const src = row * panel.w * 3
    canvas.set(panel.data.subarray(src, src + panel.w * 3), dst)
  }
}

rows.forEach((r, i) => {
  const y = ROW_GAP + i * (PANEL_H + ROW_GAP)
  let x = GAP
  blit(r.source, x, y)
  x += r.source.w + GAP
  blit(r.off, x, y)
  x += r.off.w + GAP
  blit(r.on, x, y)
  console.log(`第 ${i + 1} 行 y=${y}: 原图 w=${r.source.w} | 关 w=${r.off.w} | 开 w=${r.on.w}`)
})

fs.mkdirSync(OUT, { recursive: true })
const outFile = path.join(OUT, 'cutout-before-after.png')
writePNG(outFile, canvas, totalW, totalH)
console.log(`\n写出对照图: ${outFile}  ${totalW}×${totalH}`)
console.log('每行三格：原图 | 关掉自动抠背景 | 打开自动抠背景（淡灰空格 = 不放豆）')
