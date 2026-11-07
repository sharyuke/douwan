/* 套索局部拖动：选区扫过的、没选中的豆子必须还在。
   用法：node scripts/verify/lasso-drag.cjs
   走真实页面：空白画布点上四颗豆 → 手绘套索只圈住第一颗 → 按住拖过后面几颗。 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
const OUT = path.join(TMP_ROOT, 'lasso-drag')
const PORT = Number(process.env.AUDIT_PORT || 4397)
fs.mkdirSync(OUT, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
}

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p))

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
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(method + ' 超时'))
        }
      }, 60000)
    })
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

const DRAG = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const S = await window.__douzao.studio()
  const pal = window.__douzao.palettes
  const colors = pal.getColors(S.options.brandId) || []
  const chroma = hex => {
    const n = parseInt(String(hex || '').slice(1), 16)
    if (!Number.isFinite(n)) return 0
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    return Math.max(r, g, b) - Math.min(r, g, b)
  }
  const color = colors.slice().sort((a, b) => chroma(b.hex) - chroma(a.hex))[0]
  if (!color) return { ok: false, err: '没有可用颜色' }
  S.resetWorkspace({ blank: true })
  S.tool.value = 'paint'
  S.setToolSize(1, 'paint')
  S.brushColorId.value = color.id
  const painted = []
  for (const [x, y] of [[2, 2], [3, 2], [4, 2], [5, 2]]) {
    painted.push(S.paintAt(x, y))
  }
  await sleep(900)
  const lassoBtn = document.querySelector('[data-tool-key="lasso"]')
  if (lassoBtn) lassoBtn.click()
  else S.tool.value = 'lasso'
  await sleep(80)
  const cv = document.querySelector('.board.editing canvas')
  const stage = document.querySelector('.stage')
  const p0 = S.pattern.value
  if (!cv || !stage || !p0) {
    return { ok: false, err: '画布没出来', painted, tool: S.tool.value, has: !!p0 }
  }
  const cssW = parseFloat(cv.style.width) || cv.getBoundingClientRect().width
  const cssH = parseFloat(cv.style.height) || cv.getBoundingClientRect().height
  let geo = null
  const cell0 = cssW / p0.width
  if (Math.abs(cssH - p0.height * cell0) < 1.2) {
    geo = { cell: cell0, originX: 0, originY: 0, width: cssW, height: cssH }
  } else {
    for (let cell = 0.5; cell <= 64; cell += 0.01) {
      const ruler = Math.max(13, Math.min(52, Math.round(cell * 1.8)))
      const w = ruler * 2 + p0.width * cell
      const h = ruler * 2 + p0.height * cell
      if (Math.abs(w - cssW) < 0.8 && Math.abs(h - cssH) < 0.8) {
        geo = { cell, originX: ruler, originY: ruler, width: w, height: h }
        break
      }
    }
  }
  if (!geo) return { ok: false, err: '对不上格子', cssW, cssH, w: p0.width, h: p0.height }
  const point = (x, y) => {
    const rect = cv.getBoundingClientRect()
    const scaleX = geo.width / rect.width
    const scaleY = geo.height / rect.height
    return {
      clientX: rect.left + (geo.originX + (x + 0.5) * geo.cell) / scaleX,
      clientY: rect.top + (geo.originY + (y + 0.5) * geo.cell) / scaleY
    }
  }
  const ptr = (type, x, y) => {
    const pt = point(x, y)
    return new PointerEvent(type, {
      clientX: pt.clientX, clientY: pt.clientY,
      bubbles: true, cancelable: true,
      pointerId: 7, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1
    })
  }
  const row = () => {
    const p = S.pattern.value
    const out = {}
    for (let x = 1; x <= 7; x++) out[x] = p.cells[2 * p.width + x]
    return out
  }
  const sample = (x, y) => {
    const px = geo.originX + (x + 0.5) * geo.cell
    const py = geo.originY + (y + 0.5) * geo.cell
    const bx = Math.min(cv.width - 1, Math.max(0, Math.floor(px * (cv.width / geo.width))))
    const by = Math.min(cv.height - 1, Math.max(0, Math.floor(py * (cv.height / geo.height))))
    const d = cv.getContext('2d').getImageData(bx, by, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  const nearEmpty = rgb => Math.abs(rgb[0] - 239) + Math.abs(rgb[1] - 241) + Math.abs(rgb[2] - 244) < 36
  /* 手绘一圈，只围住 (2,2) 那颗。边上的空格可以进选区，旁边的豆子不能进。 */
  const loop = [[1.2, 1.2], [2.8, 1.2], [2.8, 2.8], [1.2, 2.8], [1.2, 1.2]]
  stage.dispatchEvent(ptr('pointerdown', loop[0][0], loop[0][1]))
  for (let i = 1; i < loop.length; i++) {
    const [x, y] = loop[i]
    stage.dispatchEvent(ptr('pointermove', x, y))
  }
  stage.dispatchEvent(ptr('pointerup', loop[0][0], loop[0][1]))
  await sleep(60)
  const traced = !!document.querySelector('.lassoShape')
  /* 按住选中的那颗，一格一格拖到最右边，再拖回起点，最后停在往右两格。 */
  stage.dispatchEvent(ptr('pointerdown', 2, 2))
  stage.dispatchEvent(ptr('pointermove', 3, 2))
  stage.dispatchEvent(ptr('pointermove', 4, 2))
  stage.dispatchEvent(ptr('pointermove', 5, 2))
  await sleep(40)
  const atFar = { cells: row(), pix3: sample(3, 2), pix4: sample(4, 2), pix2: sample(2, 2) }
  stage.dispatchEvent(ptr('pointermove', 2, 2))
  await sleep(40)
  const back = row()
  stage.dispatchEvent(ptr('pointermove', 4, 2))
  stage.dispatchEvent(ptr('pointerup', 4, 2))
  await sleep(80)
  const dropped = { cells: row(), pix3: sample(3, 2), pix2: sample(2, 2) }
  const beforeUndo = S.undoDepth.value
  S.undo()
  await sleep(40)
  const undone = row()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(20)
  stage.dispatchEvent(ptr('pointerdown', 2, 2))
  stage.dispatchEvent(ptr('pointermove', 3, 2))
  stage.dispatchEvent(ptr('pointerup', 3, 2))
  await sleep(40)
  const whole = row()
  return {
    ok: true,
    painted,
    color: color.hex,
    tool: S.tool.value,
    traced,
    geo,
    atFar,
    back,
    dropped,
    beforeUndo,
    undone,
    whole,
    empty2: nearEmpty(atFar.pix2),
    bead3: !nearEmpty(atFar.pix3),
    bead4: !nearEmpty(atFar.pix4),
    droppedBead3: !nearEmpty(dropped.pix3),
    droppedHole2: nearEmpty(dropped.pix2)
  }
})()`

async function main() {
  if (!CHROME) {
    console.error('找不到 Chrome / Edge')
    process.exit(1)
  }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('还没有 dist，先在 pindoudou 里 vite build')
    process.exit(1)
  }
  const server = await staticServer()
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'lasso-drag-chrome-'))
  const debugPort = 9347
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-default-browser-check', '--disable-crashpad', '--disable-breakpad',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' })

  let ws = null
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 300))
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      const info = await res.json()
      ws = info.webSocketDebuggerUrl
      break
    } catch { /* 还没起来 */ }
  }
  if (!ws) {
    console.error('Chrome 起不来')
    child.kill()
    server.close()
    process.exit(1)
  }

  const cdp = new CDP(ws)
  await cdp.ready
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => cdp.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/editor` })
  await new Promise(r => setTimeout(r, 800))
  await send('Runtime.evaluate', { expression: `try { localStorage.setItem('douwan.guide.v1', '1') } catch (e) {}` })
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/editor` })
  await new Promise(r => setTimeout(r, 2500))
  for (let i = 0; i < 20; i++) {
    const ready = await send('Runtime.evaluate', { expression: '!!window.__douzao', returnByValue: true })
    if (ready.result && ready.result.value) break
    await new Promise(r => setTimeout(r, 300))
  }

  const evaluated = await send('Runtime.evaluate', { expression: DRAG, returnByValue: true, awaitPromise: true })
  if (evaluated.exceptionDetails) {
    console.error('页面脚本失败', evaluated.exceptionDetails.text, evaluated.exceptionDetails.exception && evaluated.exceptionDetails.exception.description)
    cdp.close(); child.kill(); server.close()
    process.exit(1)
  }
  const r = evaluated.result.value
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, 'after.png'), Buffer.from(shot.data, 'base64'))
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(r, null, 2))

  /* 四颗同色：下标只要不是空（-1）就算还在。拖到最右时，起点空了，被扫过的两颗还在。 */
  const far = r && r.atFar && r.atFar.cells
  const dropped = r && r.dropped && r.dropped.cells
  const checks = [
    ['画布点上了四颗', r && r.painted && r.painted.every(Boolean)],
    ['手绘套索收成了选区', r && r.traced],
    ['拖过时起点空了', far && far[2] < 0],
    ['拖过时旁边那颗还在', far && far[3] >= 0],
    ['再旁边那颗也还在', far && far[4] >= 0],
    ['选中的那颗落到了最右', far && far[5] >= 0],
    ['画面上起点是空的', r && r.empty2],
    ['画面上被扫过的豆子还画着', r && r.bead3 && r.bead4],
    ['拖回起点四颗都回来', r && r.back && r.back[2] >= 0 && r.back[3] >= 0 && r.back[4] >= 0 && r.back[5] >= 0],
    ['松手后被扫过的那颗还在', dropped && dropped[3] >= 0 && dropped[5] >= 0 && dropped[2] < 0 && dropped[4] >= 0],
    ['松手后画面没有把扫过的地方擦掉', r && r.droppedBead3 && r.droppedHole2],
    ['撤销后四颗回到原位', r && r.undone && r.undone[2] >= 0 && r.undone[3] >= 0 && r.undone[4] >= 0 && r.undone[5] >= 0 && r.undone[6] < 0],
    ['整张拖动一格，四颗都还在', r && r.whole && r.whole[2] < 0 && r.whole[3] >= 0 && r.whole[4] >= 0 && r.whole[5] >= 0 && r.whole[6] >= 0]
  ]
  let failed = 0
  for (const [name, ok] of checks) {
    console.log(ok ? 'ok' : 'FAIL', name)
    if (!ok) failed++
  }
  if (!r || !r.ok) console.log(JSON.stringify(r, null, 2))
  else if (failed) console.log(JSON.stringify({ atFar: r.atFar, back: r.back, dropped: r.dropped, undone: r.undone, whole: r.whole, traced: r.traced, geo: r.geo }, null, 2))
  cdp.close()
  child.kill()
  server.close()
  if (failed || !r || !r.ok) process.exit(1)
  console.log('lasso-drag ok')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
