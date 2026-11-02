/* =========================================================================
   换钉板不裁画面 —— 真浏览器验收（2026-10-29 用户反馈「画布编辑后切换钉板画面会裁掉」）
   用法：node scripts/verify-board-crop.cjs [--url https://dw.sharyuke.com]

   走的是真实用户路径：
     ① 打开 /editor → 载素材 → 铺满 104 钉板 → 在画布上真拖一笔（标成「手工改过」）
     ② 截图（改完的 104 板画面）
     ③ 左栏「底板尺寸（实物）」下拉里选 52 钉板（真点 select + change 事件）
     ④ 截图（换板后的画面）+ 量数据

   判据：换板后画面是**整张缩小**的（图案包围盒跟着等比缩小），不是被裁掉一半。
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
const OUT = path.join(TMP_ROOT, 'board-crop')
const PORT = Number(process.env.AUDIT_PORT || 4321)
fs.mkdirSync(OUT, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
]

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
    this.events = []
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
      } else if (msg.method) this.events.push(msg)
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

/** 页面里跑的脚本：只驱动、不下结论 */
const SETUP = `(async () => {
  const d = window.__douzao
  const S = await d.studio()
  const M = await d.membership()
  const A = await d.assets()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  S.options.removeBg = false
  S.options.smartColors = false
  const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
  await S.useAsset(asset)
  await sleep(200)
  S.options.canvasMaxW = 104
  S.options.canvasMaxH = 104
  S.options.canvasW = 104
  S.options.canvasH = 104
  if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: '生成失败' }
  await sleep(300)
  /* 在画布上真拖一笔：指针事件走真实坐标换算 */
  const cv = document.querySelector('.stage canvas')
  const p = S.pattern.value
  const gw = parseFloat(cv.style.width) || cv.width
  let best = null
  for (let rl = 13; rl <= 52; rl++) {
    const cs = (gw - 2 * rl) / p.width
    if (!(cs >= 0.5)) continue
    if (Math.min(52, Math.max(13, Math.round(cs * 1.8))) !== rl) continue
    const diff = Math.abs(2 * rl + p.width * cs - gw)
    if (!best || diff < best.diff) best = { cs, rl, diff }
  }
  const rc = cv.getBoundingClientRect()
  const ptr = (type, x, y) => new PointerEvent(type, {
    clientX: rc.left + (best.rl + (x + 0.5) * best.cs) * (rc.width / gw),
    clientY: rc.top + (best.rl + (y + 0.5) * best.cs) * (rc.height / gw),
    bubbles: true, cancelable: true,
    pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
  })
  S.brushColorId.value = p.palette[0].id
  cv.dispatchEvent(ptr('pointerdown', 12, 12))
  cv.dispatchEvent(ptr('pointerup', 12, 12))
  await sleep(300)
  const ids = Array.from(S.pattern.value.cells).map(k => (k < 0 ? null : (S.pattern.value.palette[k] || {}).id || '?'))
  const bbox = (arr, w, h) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!arr[y * w + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 }
  }
  const pat = S.pattern.value
  return {
    ok: true,
    asset: asset.name,
    manualEdited: S.manualEdited.value,
    board: pat.width + 'x' + pat.height,
    art: pat.artW + 'x' + pat.artH,
    beads: ids.filter(Boolean).length,
    bbox: bbox(ids, pat.width, pat.height),
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim())
  }
})()`

/** 真点 UI：展开左栏卡片 → 在「底板尺寸」下拉里选 52 钉板 */
const PICK_BOARD = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const head = document.querySelector('.sizeWideHead')
  const panel = document.querySelector('[data-size-panel]')
  if (head && panel && !panel.offsetParent) head.click()
  await sleep(200)
  const sel = document.querySelector('[data-size-spec]')
  if (!sel) return { ok: false, err: '找不到底板下拉' }
  const opt = [...sel.options].find(o => /^52x/.test(o.value))
  if (!opt) return { ok: false, err: '下拉里没有 52 钉板', options: [...sel.options].map(o => o.value) }
  const label = opt.textContent.trim()
  sel.value = opt.value
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(600)
  const d = window.__douzao
  const S = await d.studio()
  const pat = S.pattern.value
  const ids = Array.from(pat.cells).map(k => (k < 0 ? null : (pat.palette[k] || {}).id || '?'))
  const bbox = (arr, w, h) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!arr[y * w + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 }
  }
  return {
    ok: true,
    picked: label,
    manualEdited: S.manualEdited.value,
    board: pat.width + 'x' + pat.height,
    art: pat.artW + 'x' + pat.artH,
    beads: ids.filter(Boolean).length,
    bbox: bbox(ids, pat.width, pat.height),
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()),
    specValue: sel.value
  }
})()`

async function main() {
  const argv = process.argv.slice(2)
  const urlIdx = argv.indexOf('--url')
  const externalBase = urlIdx >= 0 ? String(argv[urlIdx + 1] || '').replace(/\/+$/, '') : ''
  const server = externalBase ? null : await staticServer()
  const origin = externalBase || `http://127.0.0.1:${PORT}`

  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    process.exit(1)
  }
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'board-crop-chrome-'))
  const debugPort = 9331
  const child = spawn(chromePath, [
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
    process.exit(1)
  }

  const cdp = new CDP(ws)
  await cdp.ready
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => cdp.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

  const consoleErrors = []
  cdp.ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(String(msg.params.exceptionDetails.text || ''))
    }
  })

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${origin}/editor` })
  await new Promise(r => setTimeout(r, 1500))
  /* 关掉新手指引浮层（它盖在画布上，截图看不清画面） */
  await send('Runtime.evaluate', { expression: `try { localStorage.setItem('douwan.guide.v1', '1') } catch (e) {}` })
  await send('Page.navigate', { url: `${origin}/editor` })
  await new Promise(r => setTimeout(r, 3500))

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const file = path.join(OUT, name)
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'))
    return file
  }

  const before = await evaluate(SETUP)
  const shotBefore = await shot('board-104-before.png')
  const after = await evaluate(PICK_BOARD)
  const shotAfter = await shot('board-52-after.png')

  /* 判据：包围盒等比缩小（画面整张缩小），不是被裁掉一半 */
  const near = (u, v) => Math.abs(u * 0.5 - v) <= 1.5
  const k = 52 / 104
  const scaled = before.bbox && after.bbox &&
    near(before.bbox.x0, after.bbox.x0) && near(before.bbox.y0, after.bbox.y0) &&
    near(before.bbox.x1, after.bbox.x1) && near(before.bbox.y1, after.bbox.y1)

  const report = { origin, before, after, scaled, consoleErrors, shotBefore, shotAfter }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))

  cdp.close()
  child.kill()
  server && server.close()
  process.exit(scaled && before.ok && after.ok && !consoleErrors.length ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
