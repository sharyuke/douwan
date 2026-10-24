/* =========================================================================
   把本地 HTML 渲染成 PNG（headless Chrome）

   为什么不用快照库：项目已经有浏览器自检（scripts/audit*.js）跑在同一套
   Chrome 上，这里复用同一条路子，不额外引依赖。

   用法：
     node scripts/fidelity/render-html.mjs <in.html> <out.png> [--width 900] [--height 1200] [--scale 2]
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* 忽略 */
    }
  }
  throw new Error('找不到 Chrome / Edge，可用 CHROME_PATH 指定')
}

const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))
const [inHtml, outPng] = positional
if (!inHtml || !outPng) {
  console.error('用法：node scripts/fidelity/render-html.mjs <in.html> <out.png> [--width 900] [--height 1200] [--scale 2]')
  process.exit(2)
}

const width = Number(opt('--width', 900))
const height = Number(opt('--height', 1200))
const scale = Number(opt('--scale', 2))

const url = 'file:///' + path.resolve(inHtml).replace(/\\/g, '/')
const out = path.resolve(outPng)
fs.mkdirSync(path.dirname(out), { recursive: true })

const chrome = findChrome()
const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-sandbox',
  '--force-device-scale-factor=' + scale,
  `--window-size=${width},${height}`,
  '--screenshot=' + out,
  url
]

/* 输出目录必须是独立 profile，避免和用户正在用的 Chrome 抢锁 */
const profile = path.join(path.dirname(out), '.chrome-profile')
args.unshift('--user-data-dir=' + profile)

const r = spawnSync(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
if (!fs.existsSync(out)) {
  console.error(r.stdout || '', r.stderr || '')
  throw new Error('Chrome 没有产出截图')
}

const size = fs.statSync(out).size
console.log(`渲染完成 ${path.relative(process.cwd(), out)}  ${width}x${height} @${scale}x  ${(size / 1024).toFixed(1)} KB`)
