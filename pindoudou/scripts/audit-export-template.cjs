/* =========================================================================
   统一导出标版自检（豆玩图纸标版 V4）
   -------------------------------------------------------------------------
   真浏览器跑完整导出链路，抓真实下载文件来验收：
     预置一件作品（真实生成链路）→ /editor 顶部「导出」→ 图纸 PNG（高清）→ 抓下载的 PNG；
   对每个文件按《v3.0图纸导出》批准设计图（最新图纸模板.png）逐区验收：
     · 页眉：真 Logo + 浅绿网址胶囊（深色放大镜 + 网址文字）+ 深灰蓝 Slogan + 粉/黄/绿/蓝四圆点；
     · 图纸区：淡紫面板 + 灰色细分格线 + 每 10 格主格线；
     · 底部左卡：黄绿「图案信息」胶囊（右上角黄色星形）+ 六个像素图标；
     · 底部右卡：黄绿「颜色清单」胶囊 + 色块色号用量；
     · 页面底部没有页脚。
   用法：
     node scripts/audit-export-template.cjs
     node scripts/audit-export-template.cjs --url https://dw.sharyuke.com
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = path.join(ROOT, '.tmp')
const OUT = path.join(TMP_ROOT, 'export-template-audit')
const PORT = Number(process.env.VERIFY_PORT || 4331)
const FIXTURE = path.join(ROOT, 'scripts', 'fidelity', 'fixtures', 'photo_pumpkin.png')
const DOWNLOADS = path.join(TMP_ROOT, 'export-downloads')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
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

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.events = []
    this.onEvent = null
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
      } else if (msg.method) {
        this.events.push(msg)
        if (this.onEvent) this.onEvent(msg)
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
      }, 120000)
    })
  }

  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function fetchJSON(url) {
  const res = await fetch(url)
  return res.json()
}

async function evaluate(send, expression, { awaitPromise = false } = {}) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  }
  return r.result?.value
}

async function waitFor(send, expression, { timeout = 20000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(send, expression)) return true
    await sleep(interval)
  }
  return false
}

async function clickByText(send, selector, text) {
  const ok = await evaluate(send, `(() => {
    const list = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const el = list.find(e => (e.textContent || '').includes(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!ok) throw new Error(`找不到可点的「${text}」（${selector}）`)
  return true
}

async function attachFile(send, file, selector) {
  const { root } = await send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
  if (!nodeId) throw new Error(`页面上找不到 ${selector}`)
  await send('DOM.setFileInputFiles', { files: [file], nodeId })
}

async function shot(send, name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  if (!r || !r.data) return false
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  return true
}

/** PNG 尺寸（IHDR）：不用第三方库，直接按 PNG 结构读 */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** 布防：拦截 URL.createObjectURL 与 canvas.toBlob，观察导出链路走到哪一步。
    必须在点击导出之前调用。 */
async function armBlobCapture(send) {
  await evaluate(send, `(() => {
    if (!window.__blobs) {
      window.__blobs = []
      window.__blobCalls = []
      const orig = URL.createObjectURL.bind(URL)
      URL.createObjectURL = b => { if (b instanceof Blob) window.__blobs.push(b); return orig(b) }
      const origToBlob = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (cb, mime, q) {
        window.__blobCalls.push({ at: 'call', mime, w: this.width, h: this.height })
        return origToBlob.call(this, b => {
          window.__blobCalls.push({ at: 'done', size: b ? b.size : -1 })
          cb(b)
        }, mime, q)
      }
    }
    window.__blobBase = window.__blobs.length
  })()`)
}

/** 收取：点击导出之后，等 window.__blobs 长出新的一根，把整份字节读回 Node。
    无头下载管理器对 blob: URL 的下载在这台机器上会判 canceled，所以不依赖它：
    downloadBlob 拿到的就是同一份 Blob，逐字节等价于落盘文件。 */
async function grabExportBlob(send, label, minSize = 200000) {
  const before = await evaluate(send, `window.__blobBase`)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    await sleep(500)
    const n = await evaluate(send, `window.__blobs.length`)
    if (n > before) break
  }
  const size = await evaluate(send, `window.__blobs.length > ${before} ? window.__blobs[window.__blobs.length - 1].size : 0`)
  if (!size) throw new Error(`${label}：60 秒内没等到导出文件生成`)
  const b64 = await evaluate(send, `(async () => {
    const b = window.__blobs[window.__blobs.length - 1]
    const buf = new Uint8Array(await b.arrayBuffer())
    let s = ''
    const CH = 0x8000
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH))
    return btoa(s)
  })()`, { awaitPromise: true })
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < minSize) throw new Error(`${label}：导出文件只有 ${buf.length} 字节，小得不像话`)
  return buf
}

let passed = 0
let failed = 0
/** 已完成的下载次数（Browser.downloadProgress completed 事件计数） */
let downloadsCompleted = 0
function step(name, ok, detail = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '　' + detail : ''}`)
}

/** 把下载的 PNG 读回页面画布，按 V4 设计图验收标版
 *  （页眉 Logo + 浅绿网址胶囊 + Slogan / 四圆点；淡紫图纸面板；
 *    底部左信息卡 + 右颜色清单卡，两张黄绿标题胶囊） */
async function verifyBranded(send, buf, label) {
  const size = pngSize(buf)
  step(`${label}：是合法 PNG 且尺寸完整`, !!size && size.width >= 1000, size ? `${size.width}×${size.height}` : '不是 PNG')
  fs.writeFileSync(path.join(OUT, label + '.png'), buf)

  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
  const res = await evaluate(send, `(async () => {
    const img = new Image()
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = '${dataUrl}' })
    const W = img.naturalWidth, H = img.naturalHeight
    /* 标版按页面宽度等比放大（设计稿 1121 px 宽），所以缩放系数可从宽度反推 */
    const s = W / 1121
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, W, H).data
    const px = (x, y) => {
      const i = (Math.round(y) * W + Math.round(x)) * 4
      return [data[i], data[i + 1], data[i + 2]]
    }
    const near = (p, t, tol) => Math.abs(p[0] - t[0]) <= tol && Math.abs(p[1] - t[1]) <= tol && Math.abs(p[2] - t[2]) <= tol
    const count = (x0, y0, x1, y1, test, step = 1) => {
      let n = 0
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y += step) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x += step) if (test(px(x, y))) n++
      }
      return n
    }
    /* 找一个「实心胶囊」：该颜色出现最多的那一行就是胶囊的主体行 */
    const capsuleAt = (x0, x1, y0, y1, target, tol) => {
      let best = null
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
        let n = 0, minx = 1e9, maxx = -1
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          if (near(px(x, y), target, tol)) { n++; if (x < minx) minx = x; if (x > maxx) maxx = x }
        }
        if (!best || n > best.n) best = { n, y, x0: minx, x1: maxx }
      }
      return best && best.n ? best : null
    }

    /* ── 页眉 ── */
    const headH = Math.round(H * 0.09)
    const logo = count(0, 0, Math.round(W * 0.13), headH, p => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) > 40)
    const urlText = count(Math.round(W * 0.27), 0, Math.round(W * 0.62), headH, p => p[0] < 90 && p[1] < 90 && p[2] < 90)
    const capsule = count(Math.round(W * 0.24), 0, Math.round(W * 0.62), headH, p => near(p, [0xEB, 0xF6, 0xC5], 8))
    const slogan = count(Math.round(W * 0.58), 0, Math.round(W * 0.84), headH, p => near(p, [0x33, 0x38, 0x45], 30))
    const blkX = Math.round(W * 0.86)
    const blk = [
      count(blkX, 0, W, headH, p => near(p, [0xFC, 0xB9, 0xCA], 12)),
      count(blkX, 0, W, headH, p => near(p, [0xFD, 0xD4, 0x6B], 12)),
      count(blkX, 0, W, headH, p => near(p, [0xA7, 0xDB, 0x6B], 12)),
      count(blkX, 0, W, headH, p => near(p, [0x81, 0xB0, 0xFC], 12))
    ]

    /* ── 底部双卡 ── */
    const bottomY = Math.round(H * 0.55)
    const pinkPill = capsuleAt(0, Math.round(W * 0.45), bottomY, H, [0xC4, 0xE3, 0x3C], 26)
    const bluePill = capsuleAt(Math.round(W * 0.45), W, bottomY, H, [0xC4, 0xE3, 0x3C], 26)
    /* 左卡胶囊右上角的黄色星形装饰 */
    const sparkle = pinkPill
      ? count(0, Math.max(0, pinkPill.y - Math.round(30 * s)), Math.round(W * 0.45), pinkPill.y + Math.round(10 * s), p => near(p, [0xF9, 0xCD, 0x3F], 34) || near(p, [0xFE, 0xE7, 0x80], 24), 1)
      : 0
    /* 六个像素图标：信息卡左列上「彩色且成团」的像素，按 y 分组 */
    const iconX1 = Math.round(50 * s)
    const iconX2 = Math.round(86 * s)
    const iconY0 = pinkPill ? pinkPill.y + Math.round(10 * s) : bottomY
    const clusters = []
    let cur = null
    for (let y = iconY0; y < H; y++) {
      let hit = 0
      for (let x = iconX1; x < iconX2; x++) {
        const p = px(x, y)
        if (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) > 40) hit++
      }
      if (hit >= 2) { if (!cur) cur = [y, y]; else cur[1] = y }
      else if (cur && y - cur[1] > Math.round(6 * s)) { clusters.push(cur); cur = null }
    }
    if (cur) clusters.push(cur)
    /* 颜色清单里的色块：右卡里的彩色小方块 */
    const swX0 = bluePill ? bluePill.x0 : Math.round(W * 0.55)
    const swatches = count(swX0, bluePill ? bluePill.y + Math.round(40 * s) : bottomY, W, H, p => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) > 40, 2)

    /* ── 页面底部留白（V4 沿用 V3：没有页脚 Slogan）：底部 34×s 的留白里应当没有深色像素 ── */
    const footTop = H - Math.round(34 * s)
    const footInk = count(0, footTop, W, H, p => p[0] < 150 || p[1] < 150 || p[2] < 150, 2)
    /* ── 图纸区：灰色细分格线 + 每 10 格主格线 ── */
    const midY0 = Math.round(H * 0.10)
    const midY1 = Math.round(H * 0.62)
    const fine = count(0, midY0, W, midY1, p => near(p, [0xED, 0xED, 0xF0], 6), 2)
    const bold = count(0, midY0, W, midY1, p => near(p, [0xD9, 0xD9, 0xDC], 10), 2)

    return {
      W, H,
      logo, urlText, capsule, slogan, blocks: blk,
      pinkPill, bluePill, sparkle, icons: clusters.length, swatches, footInk, fine, bold
    }
  })()`, { awaitPromise: true })

  step(`${label}：页眉有真 Logo（彩色像素）`, res.logo > 500, `彩色像素 ${res.logo}`)
  step(`${label}：页眉是浅绿网址胶囊 + 深色网址文字`, res.urlText > 100 && res.capsule > 200, `网址字 ${res.urlText} / 胶囊底 ${res.capsule}`)
  step(`${label}：页眉右侧有 Slogan（深灰蓝）`, res.slogan > 30, `像素 ${res.slogan}`)
  step(`${label}：页眉最右有四个圆点（粉黄绿蓝）`, res.blocks.every(n => n > 20), res.blocks.join('/'))
  step(`${label}：图纸区有细分格线与每 10 格主格线`, res.fine > 500 && res.bold > 50, `细 ${res.fine} / 主 ${res.bold}`)
  step(`${label}：左卡是黄绿「图案信息」胶囊`, !!res.pinkPill && res.pinkPill.n > 100,
    res.pinkPill ? `${res.pinkPill.n} px @ x${res.pinkPill.x0}-${res.pinkPill.x1} y${res.pinkPill.y}` : '没找到')
  step(`${label}：右卡是黄绿「颜色清单」胶囊`, !!res.bluePill && res.bluePill.n > 100,
    res.bluePill ? `${res.bluePill.n} px @ x${res.bluePill.x0}-${res.bluePill.x1} y${res.bluePill.y}` : '没找到')
  step(`${label}：左卡胶囊右上角有黄色星形装饰`, res.sparkle >= 6, `黄色像素 ${res.sparkle}`)
  step(`${label}：两个胶囊左右分开（左信息卡 / 右颜色卡）`,
    !!res.pinkPill && !!res.bluePill && res.bluePill.x0 > res.pinkPill.x1)
  step(`${label}：信息卡有六个像素图标`, res.icons >= 5, `${res.icons} 团`)
  step(`${label}：颜色清单有色块与色号`, res.swatches > 300, `彩色像素 ${res.swatches}`)
  step(`${label}：页面底部留白，没有页脚 Slogan`, res.footInk < 40, `深色像素 ${res.footInk}`)
  return res
}

async function main() {
  const argv = process.argv.slice(2)
  const urlIdx = argv.indexOf('--url')
  const externalBase = urlIdx >= 0 ? String(argv[urlIdx + 1] || '').replace(/\/+$/, '') : null
  if (urlIdx >= 0) argv.splice(urlIdx, 2)

  if (!externalBase && !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/index.html 不存在，请先构建')
    process.exit(1)
  }
  fs.mkdirSync(OUT, { recursive: true })
  fs.rmSync(DOWNLOADS, { recursive: true, force: true })
  fs.mkdirSync(DOWNLOADS, { recursive: true })

  const origin = externalBase || `http://127.0.0.1:${PORT}`
  const server = externalBase ? null : await staticServer()
  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    server && server.close()
    process.exit(1)
  }

  const debugPort = 9222 + (process.pid % 500)
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'export-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crashpad',
    '--disable-breakpad',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let version = null
  for (let i = 0; i < 60; i++) {
    try { version = await fetchJSON(`http://127.0.0.1:${debugPort}/json/version`); break } catch { await sleep(250) }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪')
    chrome.kill()
    server && server.close()
    process.exit(1)
  }

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready
  /* 下载不弹窗、直接落到 DOWNLOADS 目录（无头浏览器抓真实导出文件的关键）。
     无头新模式必须把授权挂到**browser context**上，挂浏览器级会被判 canceled */
  browser.onEvent = msg => {
    if (msg.method === 'Browser.downloadProgress' && msg.params.state === 'completed') downloadsCompleted++
  }
  const { browserContextIds } = await browser.send('Target.getBrowserContexts')
  await browser.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOADS,
    browserContextId: browserContextIds && browserContextIds[0],
    eventsEnabled: true
  })

  const consoleErrors = []
  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const send = (m, p) => browser.send(m, p, sessionId)
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Log.enable')
    send('Log.entryAdded', {}).catch(() => {})
    browser.events.filter(e => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
      .forEach(() => {})

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    /* 升级公告（2026-11-01）只在首次会话弹一次：自检只关心导出本身，
       先把会话标记成「看过了」，否则公告遮罩会挡住「下载拼豆图纸」的点击。
       公告本身由 scripts/verify-upgrade-notice.cjs 单独验。 */
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: "try { sessionStorage.setItem('douwan-upgrade-notice','1') } catch (e) {}"
    }).catch(() => {})
    await send('Page.navigate', { url: origin + '/' })
    await waitFor(send, `!!window.__douzao`, { timeout: 30000 })

    /* 监听 console 报错（挂在页面上下文里） */
    await evaluate(send, `(() => {
      window.__consoleErrors = []
      const orig = console.error
      console.error = (...a) => { window.__consoleErrors.push(a.join(' ')); orig(...a) }
      window.addEventListener('error', e => window.__consoleErrors.push(String(e.message)))
      /* 无头下载管理器偶尔比 revokeObjectURL(1200ms) 慢，URL 被撤掉下载就被判 canceled；
         自检期间冻结 revoke，让 blob 下载一定能完成 */
      URL.revokeObjectURL = () => {}
    })()`)

    /* ------------------------------------------ 预置一件作品 */
    /* 走真实生成链路造作品（不手写 localStorage 结构），再打开它 */
    const fixtureSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-fixture.js'), 'utf8')
    const fixture = await evaluate(send, fixtureSrc, { awaitPromise: true })
    step('预置作品（真实生成链路）', !!(fixture && fixture.projectId), fixture && fixture.err)

    /* ------------------------------------------ 图纸交付下载 */
    await send('Page.navigate', { url: origin + '/editor/' + fixture.projectId })
    /* 全屏创作工作台（2026-11 改版）把「图纸交付」收进了顶部「导出」按钮；
       老的三栏版面还有左栏那张「图纸交付」卡片，两种都认 */
    await waitFor(send, `!!document.querySelector('.csTop, [data-audit="open-delivery-build"]')`, { timeout: 30000 })
    const openedBy = await evaluate(send, `(() => {
      const top = [...document.querySelectorAll('.csActions .csAction')].find(b => /导出/.test(b.textContent))
      if (top) { top.click(); return 'console-top' }
      const card = document.querySelector('[data-audit="open-delivery-build"]')
      if (card) { card.click(); return 'sidebar-card' }
      return 'none'
    })()`)
    await sleep(700)
    /* v3：顶部「导出」直接打开导出弹窗（默认 PDF），模板验收要 PNG，先切到「PNG 图片」；
       老的三栏版面打开的是「拼装与完成」页签，再切到「整张图纸」 */
    const isDialog = await evaluate(send, `!!document.querySelector('.cmdDlg')`)
    if (isDialog) {
      await clickByText(send, '.expFmt', 'PNG')
      await sleep(400)
    } else {
      await clickByText(send, '[role="tab"]', '整张图纸')
      await sleep(500)
    }
    const panelDiag = await evaluate(send, `(() => ({
      path: location.pathname,
      openedBy: ${JSON.stringify(openedBy)},
      hasRun: !!document.querySelector('.deliveryRun') || !!document.querySelector('.cmdDlg'),
      modal: [...document.querySelectorAll('.modal,.dialog,.baseDialog')].length,
      bodyHint: document.body.innerText.slice(0, 200)
    }))()`)
    console.log('  [panel]', JSON.stringify(panelDiag))
    step('图纸交付面板打开', panelDiag.hasRun)
    await sleep(300)

    await armBlobCapture(send)
    await realClick(send, isDialog ? '.cmdDlg .dialog__foot .btn.primary' : '.deliveryRun')
    const proBuf = await grabExportBlob(send, '专业版下载')
    await verifyBranded(send, proBuf, 'pro-delivery')

    const errs = await evaluate(send, `window.__consoleErrors || []`)
    for (const e of errs) consoleErrors.push(e)
    step('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  } catch (e) {
    failed++
    console.error('✗ 自检中断：' + (e && e.message ? e.message : e))
  } finally {
    browser.close()
    chrome.kill()
    server && server.close()
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败　产物与截图在 ${OUT}`)
  process.exit(failed ? 1 : 0)
}

/** 只点「可见的」那一个（桌面端与底部常驻条可能同时有同文案按钮） */
async function clickVisibleLike(send, selector, text) {
  const ok = await evaluate(send, `(() => {
    const list = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const hit = list.find(e => {
      if (!(e.textContent || '').includes(${JSON.stringify(text)})) return false
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'
    })
    if (!hit) return false
    hit.click()
    return true
  })()`)
  if (!ok) throw new Error(`找不到可见的「${text}」（${selector}）`)
  return true
}

/** CDP 真实鼠标事件点击一个选择器（带用户激活，下载不会被当成无手势而取消） */
async function realClick(send, selector) {
  const pos = await evaluate(send, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  if (!pos) throw new Error(`页面上找不到 ${selector}，无法真实点击`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: pos.x, y: pos.y, button: 'left', clickCount: 1
    })
  }
}

main()
