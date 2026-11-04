/* 抠图耗时剖析：跑一张固定 fixture N 次，输出 CPU profile 供 node --cpu-prof 分析。
   用法：node --cpu-prof --cpu-prof-dir=out/prof scripts/fidelity/matte-prof.mjs [fixture] [次数] */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { estimateMatte } from '../../src/lib/matte.js'
import { readPNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')

const name = process.argv[2] || 'cut_low_contrast'
const times = Number(process.argv[3] || 5)

const png = readPNG(path.join(FIXTURES, `${name}.png`))
const src = new Uint8ClampedArray(png.width * png.height * 4)
let o = 0
for (let i = 0; i < png.data.length; i += 3) {
  src[o++] = png.data[i]
  src[o++] = png.data[i + 1]
  src[o++] = png.data[i + 2]
  src[o++] = 255
}

const samples = []
for (let t = 0; t < times; t++) {
  const t0 = performance.now()
  const r = estimateMatte(src, png.width, png.height, { level: 'normal' })
  const dt = performance.now() - t0
  samples.push(dt)
}
samples.sort((a, b) => a - b)
const med = samples[samples.length >> 1]
console.log(`${name}: median ${med.toFixed(1)}ms  min ${samples[0].toFixed(1)}ms  max ${samples[samples.length - 1].toFixed(1)}ms  (n=${times})`)
