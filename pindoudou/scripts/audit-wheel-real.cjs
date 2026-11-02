/* =========================================================================
   真实滚轮输入自检（开发用，不进构建产物）
   为什么不用 audit.cjs 的页面内派发：页面里 new WheelEvent(...) 是**合成事件**，
   它只证明「处理函数还在、逻辑没坏」，证明不了浏览器会不会把真实滚轮送进来
   （真实滚轮带 deltaMode/deltaY 的实际取值，还会先派发非被动监听、可能被祖先滚动容器截走）。
   这里用 CDP 的 Input.dispatchMouseEvent(type: 'mouseWheel') 发**真输入**。

   用法：
     node scripts/audit-wheel-real.cjs
     node scripts/audit-wheel-real.cjs --url https://dw.sharyuke.com
     node scripts/audit-wheel-real.cjs --url http://127.0.0.1:4299 --dist
   ========================================================================= */

const fs = require('fs')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
fs.mkdirSync(TMP_ROOT, { recursive: true })
const OUT = process.env.AUDIT_OUT || path.join(TMP_ROOT, 'douzao-wheel')
const PORT = Number(process.env.AUDIT_PORT || 4298)

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
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

/* 极简 CDP 客户端（同 audit.cjs） */
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
      }, 30000)
    })
  }

  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function main() {
  const argv = process.argv.slice(2)
  const urlIdx = argv.indexOf('--url')
  const externalBase = urlIdx >= 0 ? String(argv[urlIdx + 1] || '').replace(/\/+$/, '') : null
  const useDist = argv.includes('--dist')
  const origin = externalBase || `http://127.0.0.1:${PORT}`

  let server = null
  if (!externalBase) {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      console.error('dist/index.html 不存在，请先运行 vite build')
      process.exit(1)
    }
    server = await staticServer()
  }
  fs.mkdirSync(OUT, { recursive: true })

  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) { console.error('找不到 Chrome'); process.exit(1) }

  const debugPort = 9700 + (process.pid % 200)
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'douzao-wheel-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-default-browser-check', '--disable-crashpad', '--disable-breakpad',
    '--hide-scrollbars', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let chromeErr = ''
  chrome.stderr.on('data', d => { chromeErr += d.toString() })

  let version = null
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      version = await res.json()
      break
    } catch { await sleep(250) }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪\n' + chromeErr)
    chrome.kill(); server && server.close(); process.exit(1)
  }
  console.log('Chrome:', version['Browser'], '目标:', origin)

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${origin}/editor` })
  await sleep(2500)

  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value
  }

  /* 等调试桥 */
  for (let i = 0; i < 40; i++) {
    if (await evalJs('!!window.__douzao')) break
    await sleep(250)
  }

  /* 关掉新手指引层 + 载一张图。
     AUDIT_GUIDE=0 时**不**关指引层 —— 首次进入工作台时指引层会盖住画布，
     真实滚轮/指针事件落到它上面就够不到 .stage，这正是要验的状态。 */
  const skipGuide = process.env.AUDIT_GUIDE !== '0'
  if (skipGuide) {
    await evalJs(`(() => { try { localStorage.setItem('douwan.guide.v1','1') } catch {} ; return true })()`)
  }
  const loaded = await evalJs(`(async () => {
    const d = window.__douzao
    if (!d) return 'no-bridge'
    const S = await d.studio()
    const A = await d.assets()
    const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
    await S.useAsset(asset)
    const okGen = S.regenerate({ keys: ['easy'], silent: true })
    await new Promise(r => setTimeout(r, 400))
    const cv = document.querySelector('.stage canvas')
    return { okGen: !!okGen, hasCanvas: !!cv, zoom: S.zoom.value }
  })()`, true)
  console.log('装载:', JSON.stringify(loaded))
  if (!loaded || !loaded.hasCanvas) {
    console.error('画布没出来，后续无法测滚轮')
    chrome.kill(); server && server.close(); process.exit(1)
  }

  const rect = await evalJs(`(() => {
    const cv = document.querySelector('.stage canvas')
    const r = cv.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      x, y, w: r.width, h: r.height,
      hitTag: hit ? hit.tagName : null,
      hitClass: hit ? (hit.className && hit.className.baseVal !== undefined ? hit.className.baseVal : String(hit.className || '')).slice(0, 80) : null,
      guideOpen: !!document.querySelector('.editorGuide, .guideMask, .guideOverlay')
    }
  })()`)
  console.log('画布中心:', JSON.stringify(rect))

  const readZoom = () => evalJs(`(async () => {
    const S = await window.__douzao.studio()
    const cv = document.querySelector('.stage canvas')
    return { zoom: S.zoom.value, cssW: cv ? cv.style.width : null }
  })()`, true)

  const before = await readZoom()

  /* 真实滚轮输入：向上（放大）。deltaY 负 = 向上 */
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: Math.round(rect.x), y: Math.round(rect.y),
    deltaX: 0, deltaY: -120, pointerType: 'mouse'
  })
  await sleep(400)
  const afterUp = await readZoom()

  /* 再向下（缩小） */
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: Math.round(rect.x), y: Math.round(rect.y),
    deltaX: 0, deltaY: 120, pointerType: 'mouse'
  })
  await sleep(400)
  const afterDown = await readZoom()

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, 'wheel-real.png'), Buffer.from(shot.data, 'base64'))

  /* ---------- 场景二：左栏「画布与成品尺寸」的滑杆上滚滚轮 ---------- */
  /* Chrome 默认不响应滑块上的滚轮（Firefox 会），所以这条要靠我们自己补：
     滚轮向上 = 变大、向下 = 变小，且不能带着页面一起滚。 */
  let slider = null
  try {
    slider = await evalJs(`(async () => {
      const d = window.__douzao
      const S = await d.studio()
      const card = document.querySelector('[data-size-wide]')
      if (!card) return { skipped: '没有宽屏尺寸面板' }
      const head = card.querySelector('[data-size-row]')
      const body = card.querySelector('[data-size-panel]')
      if (body && !body.offsetParent && head) { head.click(); await new Promise(r => setTimeout(r, 250)) }
      const range = card.querySelector('[data-size-range]')
      if (!range) return { skipped: '找不到成品尺寸滑杆' }
      const r = range.getBoundingClientRect()
      return {
        x: r.left + r.width / 2, y: r.top + r.height / 2,
        value: Number(range.value), min: Number(range.min), max: Number(range.max),
        artW: S.options.canvasW, artH: S.options.canvasH,
        scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : 0
      }
    })()`, true)
  } catch (e) {
    slider = { err: e.message }
  }
  console.log('尺寸滑杆:', JSON.stringify(slider))

  let sliderAfter = null
  if (slider && !slider.skipped && !slider.err) {
    const readSlider = `(async () => {
      const S = await window.__douzao.studio()
      const card = document.querySelector('[data-size-wide]')
      const range = card.querySelector('[data-size-range]')
      return {
        value: range ? Number(range.value) : null,
        artW: S.options.canvasW, artH: S.options.canvasH,
        scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : 0
      }
    })()`
    /* 先向下滚（变小）：滑杆一开始就在上限，向上滚是没有余地的 */
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(slider.x), y: Math.round(slider.y),
      deltaX: 0, deltaY: 120, pointerType: 'mouse'
    })
    await sleep(1200)
    const sDown = await evalJs(readSlider, true)
    /* 再向上滚（变大）：要能回到原来的大小才算真的双向可用 */
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(slider.x), y: Math.round(slider.y),
      deltaX: 0, deltaY: -120, pointerType: 'mouse'
    })
    await sleep(1200)
    const sUp = await evalJs(readSlider, true)
    sliderAfter = { afterDown: sDown, afterUp: sUp }
    console.log('滚轮向下后:', JSON.stringify(sDown))
    console.log('滚轮向上后:', JSON.stringify(sUp))
  }

  const result = {
    before, afterUp, afterDown,
    zoomedIn: afterUp.zoom > before.zoom,
    zoomedOut: afterDown.zoom < afterUp.zoom,
    slider: { before: slider, after: sliderAfter }
  }
  const sliderOk = !slider || slider.skipped || slider.err
    ? true
    : !!(sliderAfter && sliderAfter.afterDown && sliderAfter.afterUp
      && sliderAfter.afterDown.value < slider.value
      && sliderAfter.afterUp.value > sliderAfter.afterDown.value)
  result.sliderResponds = sliderOk
  console.log('\n===== 真实滚轮结果 =====')
  console.log(JSON.stringify(result, null, 2))
  console.log('截图:', path.join(OUT, 'wheel-real.png'))

  chrome.kill()
  server && server.close()
  await sleep(200)
  process.exit(result.zoomedIn && result.zoomedOut && sliderOk ? 0 : 2)
}

main().catch(e => { console.error(e); process.exit(1) })
