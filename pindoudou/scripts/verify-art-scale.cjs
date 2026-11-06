/* =========================================================================
   拖清晰度滑杆 → 画面在画布上等比缩放（2026-10-29 用户反馈
   「这个尺寸缩放出bug了，拉动调整的是画面在画布上的大小，不是调整画布大小」）
   用法：node scripts/verify-art-scale.cjs [--url https://dw.sharyuke.com]

   走的是真实用户路径：
     ① 打开 /editor → 载素材 → 铺满 156 钉板 → 在画布上真拖一笔（标成「手工改过」）
     ② 截图（改完的 156 板画面）
     ③ 真拖左栏「图案清晰度（豆子数量）」滑杆到 117
     ④ 截图（缩放后的画面）+ 量数据

   判据：
     · 底板不变（还是 156 钉板）—— 滑杆调的是画面大小，不是画布大小；
     · 成品区域变成 117 × 117；
     · **画面跟着等比缩小**（图案包围盒按 0.5 缩），不是留在原处；
     · 画面整个落在新的成品区域里（不溢出框）；
     · 顶栏的「N 颗」与格子里的豆子数一致（数字与画面对得上）。
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
const OUT = path.join(TMP_ROOT, 'art-scale')
const PORT = Number(process.env.AUDIT_PORT || 4322)
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

/** 页面里跑的脚本：只驱动、不下结论 */
const SETUP = `(async () => {
  const d = window.__douzao
  const S = await d.studio()
  const M = await d.membership()
  const A = await d.assets()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  S.options.removeBg = false
  const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
  await S.useAsset(asset)
  await sleep(300)
  S.options.canvasMaxW = 156
  S.options.canvasMaxH = 156
  S.options.canvasW = 156
  S.options.canvasH = 156
  if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: '生成失败' }
  await sleep(400)
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
  window.__studio = S
  return { ok: true, asset: asset.name, manualEdited: S.manualEdited.value }
})()`

/** 量的东西：底板 / 成品区域 / 画面包围盒 / 顶栏豆子数 */
const STATE = `(() => {
  const S = window.__studio
  const p = S.pattern.value
  const ids = p ? Array.from(p.cells).map(k => (k < 0 ? null : (p.palette[k] || {}).id || '?')) : []
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
  /* 只看成品区域里的画面，并相对成品区域左上角 */
  const bboxRelOf = (arr, w, h, ox, oy, aw, ah) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = oy; y < oy + ah; y++) {
      for (let x = ox; x < ox + aw; x++) {
        if (!arr[y * w + x]) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    return x1 < 0 ? null : { x0: x0 - ox, y0: y0 - oy, x1: x1 - ox, y1: y1 - oy }
  }
  const range = document.querySelector('[data-size-card-range]') || document.querySelector('[data-size-range]')
  const head = document.querySelector('.canvasTitleBar')
  const artBox = p ? { x0: Math.floor((p.width - p.artW) / 2), y0: Math.floor((p.height - p.artH) / 2) } : { x0: 0, y0: 0 }
  return {
    cap: S.options.canvasMaxW + 'x' + S.options.canvasMaxH,
    art: S.options.canvasW + 'x' + S.options.canvasH,
    board: p ? p.width + 'x' + p.height : null,
    patternArt: p ? (p.artW + 'x' + p.artH) : null,
    beads: ids.filter(Boolean).length,
    bbox: p ? bbox(ids, p.width, p.height) : null,
    /* 相对成品区域左上角的包围盒：成品区域本身也在挪，比缩放要拿这个比 */
    bboxRel: p ? bboxRelOf(ids, p.width, p.height, artBox.x0, artBox.y0, p.artW, p.artH) : null,
    artBox,
    manualEdited: S.manualEdited.value,
    sliderValue: range ? range.value : null,
    sliderMax: range ? range.max : null,
    cellsText: ((document.querySelector('[data-size-cells]') || {}).textContent || '').trim(),
    artText: ((document.querySelector('[data-size-art]') || {}).textContent || '').trim(),
    noteText: ((document.querySelector('[data-size-note]') || {}).textContent || '').trim(),
    headText: head ? head.textContent.replace(/\\s+/g, ' ').trim() : null,
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim())
  }
})()`

/** 真拖左栏的清晰度滑杆：设值 + input + change（走的是页面自己的处理链路） */
const DRAG = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const range = document.querySelector('[data-size-card-range]') || document.querySelector('[data-size-range]')
  if (!range) return { ok: false, err: '找不到清晰度滑杆' }
  range.value = '117'
  range.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(700)
  range.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(1500)
  return { ok: true }
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
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'art-scale-chrome-'))
  const debugPort = 9333
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

  /* 全屏创作工作台把成品尺寸收进命令栏「图纸调整」下拉；
     滑杆才在 DOM 里（平板左栏 / 手机抽屉已经可见时直接返回） */
  const ensureSize = await evaluate(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    if (document.querySelector('[data-size-card-range]') || document.querySelector('[data-size-range]')) return { ok: true, already: true }
    const entry = document.querySelector('[data-side-adjust]')
      || [...document.querySelectorAll('.csSide__row, .msCmd button')].find(b => /成品尺寸|图纸调整/.test(b.textContent))
    if (!entry) return { ok: false, err: '没有「图纸调整」入口' }
    entry.click()
    await sleep(700)
    return { ok: !!(document.querySelector('[data-size-card-range]') || document.querySelector('[data-size-range]')) }
  })()`

  const setup = await evaluate(SETUP)
  const before = await evaluate(STATE)
  const shotBefore = await shot('art-156-before.png')
  const drag = await evaluate(DRAG)
  /* 手改过的图纸改尺寸不弹层：按新尺寸重新取样后手改按比例落回
     （细节由 scripts/verify-size-guard.cjs 验收） */
  await new Promise(r => setTimeout(r, 1500))
  const after = await evaluate(STATE)
  const shotAfter = await shot('art-117-after.png')

  /* 判据 1：底板不变（滑杆调的是画面大小，不是画布大小） */
  const boardKept = before.cap === after.cap && before.board === after.board
  /* 判据 2：成品区域落到 117 */
  const artChanged = after.art === '117x117' && after.patternArt === '117x117'
  /* 判据 3：画面等比缩小（相对成品区域的包围盒按 117/156 缩），且整个落在新的成品区域里 */
  const k = 117 / 156
  const near = (u, v) => Math.abs(u * k - v) <= 2
  let scaled = false
  let inside = false
  if (before.bboxRel && after.bboxRel) {
    scaled = near(before.bboxRel.x0, after.bboxRel.x0) && near(before.bboxRel.y0, after.bboxRel.y0) &&
      near(before.bboxRel.x1, after.bboxRel.x1) && near(before.bboxRel.y1, after.bboxRel.y1)
    inside = after.bboxRel.x0 >= 0 && after.bboxRel.y0 >= 0 &&
      after.bboxRel.x1 <= 116 && after.bboxRel.y1 <= 116
  }
  /* 判据 4：顶栏豆子数与格子里的豆子数一致（数字与画面对得上） */
  const headBeads = after.headText ? (after.headText.match(/([\d,]+)\s*颗/) || [])[1] : null
  const headCount = headBeads ? Number(headBeads.replace(/,/g, '')) : null
  const numbersMatch = headCount === null ? true : headCount === after.beads

  const report = {
    origin, ensureSize, setup, before, drag, after,
    boardKept, artChanged, scaled, inside, numbersMatch,
    headBeads: headCount,
    consoleErrors, shotBefore, shotAfter
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))

  cdp.close()
  child.kill()
  server && server.close()
  const ok = ensureSize.ok && setup.ok && drag.ok && boardKept && artChanged && scaled && inside && numbersMatch && !consoleErrors.length
  process.exit(ok ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
