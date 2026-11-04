/* ------------------------------------------------------------------
   按指定尺寸与颜色数，用**真实导出链路**出一张标版图纸（验收用测试图）。

   用途：视觉验收时要有「同一页面比例下」的对照图 —— 设计参考图 vs 新导出图，
   以及不同尺寸 / 钉板 / 颜色数的多档样本。

   颜色数怎么保证「就是 N 色」：照片量化出来的图案往往自己会收敛（引擎选到边际
   收益为 0 就停），实测南瓜照 104×104 只用 28 色，凑不出 45 色那一档。
   所以这里在真实图案上做一步**扩容**：给用量最大的那些颜色各配一个真实 MARD
   色号（取色值最接近的没被用过的色号），再把该色的一部分格子换成新色号 ——
   颜色数就是精确的 N，色号与色值都是真的（MARD 291 色卡里的）。

   用法：
     node scripts/export-case-preview.cjs                      # 默认 104×104 / 45 色
     node scripts/export-case-preview.cjs 104 104 45 case-104-45
     node scripts/export-case-preview.cjs --board 78 --colors 52   # 换钉板尺寸
   产物：.tmp/export-template-audit/<name>.png
   ------------------------------------------------------------------ */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4399)
const FIXTURE = path.join(ROOT, 'scripts', 'fidelity', 'fixtures', 'photo_pumpkin.png')
const OUT = path.join(ROOT, '.tmp', 'export-template-audit')

/* 参数：位置参数 gw gh colors name；--board N 指定钉板尺寸（格） */
const argv = process.argv.slice(2)
function takeFlag(name, def) {
  const i = argv.indexOf('--' + name)
  if (i < 0) return { value: def, next: argv }
  const value = argv[i + 1]
  const next = argv.slice(0, i).concat(argv.slice(i + 2))
  return { value, next }
}
const boardFlag = takeFlag('board', null)
const BOARD = boardFlag.value ? Number(boardFlag.value) : 0
const rest = boardFlag.next
const nums = rest.filter(a => /^\d+$/.test(a))
const GW = Number(nums[0] || 104)
const GH = Number(nums[1] || 104)
const COLORS = Number(nums[2] || 45)
const NAME = rest.find(a => !/^\d+$/.test(a)) || ('case-' + GW + 'x' + GH + '-' + COLORS)

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
]
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2'
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function staticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0])
      if (p === '/') p = '/index.html'
      const file = path.join(DIST, p)
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(fs.readFileSync(path.join(DIST, 'index.html')))
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
      res.end(fs.readFileSync(file))
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP connect failed')))
    })
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timeout')) } }, 180000)
    })
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function evaluate(send, expression, { awaitPromise = false } = {}) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}

async function waitFor(send, expression, { timeout = 30000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(send, expression)) return true
    await sleep(interval)
  }
  return false
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true })
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/ 不存在 —— 先跑 pnpm build')
    process.exit(1)
  }
  const server = await staticServer()
  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) { console.error('no chrome'); server.close(); process.exit(1) }
  const debugPort = 9222 + (process.pid % 500)
  const profile = path.join(ROOT, '.tmp', 'exp-case-' + process.pid)
  fs.mkdirSync(profile, { recursive: true })
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-crashpad', '--disable-breakpad', '--hide-scrollbars',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + debugPort, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let version = null
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json(); break } catch { await sleep(250) }
  }
  if (!version) { console.error('chrome debug port not ready'); chrome.kill(); server.close(); process.exit(1) }
  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready
  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const send = (m, p) => browser.send(m, p, sessionId)
    await send('Page.enable'); await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/editor' })
    await waitFor(send, '!!window.__douzao && !!window.__douzao.exporters', { timeout: 30000 })

    const imgB64 = fs.readFileSync(FIXTURE).toString('base64')
    const payload = await evaluate(send, `(async () => {
      const img = new Image()
      img.src = 'data:image/png;base64,${imgB64}'
      await img.decode()
      const pattern = window.__douzao.makeFromImage(img, { gw: ${GW}, gh: ${GH}, targetColors: ${COLORS}, brandId: 'mard291' })
      ${BOARD ? `pattern.boardSize = { x: ${BOARD}, y: ${BOARD} }` : ''}

      /* ---- 扩容到精确的 N 色（真实 MARD 色号） ---- */
      const want = ${COLORS}
      if (pattern.palette.length < want) {
        const all = window.__douzao.palettes.getColors('mard291')
        const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
        const dist = (a, b) => { const A = rgb(a), B = rgb(b); return (A[0]-B[0])**2 + (A[1]-B[1])**2 + (A[2]-B[2])**2 }
        const used = new Set(pattern.palette.map(p => p.code))
        const counts = new Map()
        for (let i = 0; i < pattern.cells.length; i++) { const k = pattern.cells[i]; if (k >= 0) counts.set(k, (counts.get(k) || 0) + 1) }
        const ranked = pattern.palette.map((p, i) => i).sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
        const palette = pattern.palette.slice()
        const pairs = []
        for (const bi of ranked) {
          if (palette.length >= want) break
          const base = palette[bi]
          const cands = all.filter(c => !used.has(c.code)).map(c => ({ c, d: dist(c.hex, base.hex) })).sort((a, b) => a.d - b.d)
          if (!cands.length) continue
          const pick = cands[0].c
          used.add(pick.code)
          palette.push({ id: base.id + '#' + pick.code, code: pick.code, name: pick.name || pick.code, hex: pick.hex, brandId: base.brandId })
          pairs.push([bi, palette.length - 1])
        }
        for (const [bi, ni] of pairs) {
          for (let i = 0; i < pattern.cells.length; i++) {
            if (pattern.cells[i] !== bi) continue
            const h = (i * 2654435761) >>> 0
            if (h % 100 < 30) pattern.cells[i] = ni
          }
        }
        pattern.palette = palette
      }

      const built = window.__douzao.exporters.buildPatternImageCanvas(pattern, { cell: 24, codes: true, grid: true, ruler: true, includeLegend: true, includeStats: true })
      if (!built.ok) return JSON.stringify({ error: built.message })
      const c = built.canvas
      return JSON.stringify({ w: c.width, h: c.height, colors: pattern.palette.length, beads: pattern.stats.beadCount, png: c.toDataURL('image/png') })
    })()`, { awaitPromise: true })
    const info = JSON.parse(payload)
    if (info.error) { console.error('export failed: ' + info.error); process.exitCode = 1 }
    else {
      const buf = Buffer.from(info.png.split(',')[1], 'base64')
      fs.writeFileSync(path.join(OUT, NAME + '.png'), buf)
      console.log(`${NAME}: ${info.w}x${info.h}, colors ${info.colors}, beads ${info.beads} -> ${path.join(OUT, NAME + '.png')}`)
    }
  } finally {
    browser.close(); chrome.kill(); server.close()
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
main()
