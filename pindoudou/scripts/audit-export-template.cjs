/* =========================================================================
   统一导出标版自检（需求《豆玩导出图纸完整交付包》V1.0）
   -------------------------------------------------------------------------
   真浏览器跑完整导出链路，抓真实下载文件来验收：
     ① 新手版第 ③ 步「下载拼豆图纸」→ 抓下载的 PNG；
     ② 切专业模式 → 图纸交付 → 「图纸 PNG（高清）」→ 抓下载的 PNG；
   对每个文件验收：
     · 是合法 PNG、尺寸完整；
     · 标版四件套都在（用页面里同一条 buildPatternImageCanvas 断言更好，
       但 dist 是打包产物，这里退而求其次：把下载的 PNG 像素逐点验收——
       读回页面画布后检查页眉 Logo 区域非空、域名渐变色存在、
       底部两卡区域非空、页脚 Slogan 区域有品牌红字）。
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

/** 把下载的 PNG 读回页面画布，验收标版四件套 */
async function verifyBranded(send, buf, label) {
  const size = pngSize(buf)
  step(`${label}：是合法 PNG 且尺寸完整`, !!size && size.width >= 1000, size ? `${size.width}×${size.height}` : '不是 PNG')
  fs.writeFileSync(path.join(OUT, label + '.png'), buf)

  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
  const res = await evaluate(send, `(async () => {
    const img = new Image()
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = '${dataUrl}' })
    const W = img.naturalWidth, H = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = (x, y) => {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
      return [d[0], d[1], d[2]]
    }
    const regionHasInk = (x0, y0, x1, y1, test, samples = 400) => {
      let hits = 0
      for (let i = 0; i < samples; i++) {
        const x = x0 + Math.random() * (x1 - x0)
        const y = y0 + Math.random() * (y1 - y0)
        if (test(px(x, y))) hits++
      }
      return hits / samples
    }
    const dark = p => p[0] < 150 || p[1] < 150 || p[2] < 150
    const orangePink = p => (p[0] > 190 && p[2] < 140)
    const red = p => (p[0] > 170 && p[1] < 120 && p[2] < 120)
    /* 顶带 12%：页眉 Logo + 渐变域名；中间应有深色像素与橙粉像素 */
    const headInk = regionHasInk(0, 0, W, H * 0.12, dark)
    const headGrad = regionHasInk(W * 0.45, 0, W, H * 0.12, orangePink)
    /* 底部 18%（去掉 Slogan 行）：材料两卡应有大量文字深色像素 */
    const bottomInk = regionHasInk(0, H * 0.80, W, H * 0.95, dark)
    /* 最后 5%：Slogan 品牌红字 */
    const footRed = regionHasInk(W * 0.3, H * 0.95, W * 0.7, H, red)
    return { W, H, headInk, headGrad, bottomInk, footRed }
  })()`, { awaitPromise: true })
  step(`${label}：页眉（Logo + 域名）有内容`, res.headInk > 0.01, `深色像素 ${(res.headInk * 100).toFixed(1)}%`)
  step(`${label}：域名是橙→粉渐变粗体`, res.headGrad > 0.002, `橙粉像素 ${(res.headGrad * 100).toFixed(2)}%`)
  step(`${label}：底部材料区（图案信息 / 颜色清单）有内容`, res.bottomInk > 0.01, `深色像素 ${(res.bottomInk * 100).toFixed(1)}%`)
  step(`${label}：页脚有品牌红 Slogan`, res.footRed > 0.002, `红字像素 ${(res.footRed * 100).toFixed(2)}%`)
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
    await send('Page.navigate', { url: origin + '/create' })
    await waitFor(send, `!!document.querySelector('.bsel__file')`, { timeout: 30000 })

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

    /* ------------------------------------------ ① 新手版第 ③ 步下载 */
    await attachFile(send, FIXTURE, '.bsel__file')
    step('上传图片进入确认页', await waitFor(send, `!!document.querySelector('.bsel__confirm')`, { timeout: 25000 }))
    await clickByText(send, '.bsel__confirmBtns .btn', '下一步')
    step('第 ② 步画出图纸', await waitFor(send, `!!document.querySelector('.badj__canvasBox canvas')`, { timeout: 30000 }))
    await clickVisibleLike(send, '.badj__actNext, .bwiz__mobileCta', '获取图纸')
    step('第 ③ 步打开', await waitFor(send, `!!document.querySelector('.bexp__cta')`, { timeout: 25000 }))
    await sleep(400)

    /* 真实鼠标点击（带用户激活）+ 提前布防抓 Blob */
    await armBlobCapture(send)
    await realClick(send, `.bexp__cta`)
    await sleep(2500)
    const diag = await evaluate(send, `(() => ({
      err: document.querySelector('.bexp__err')?.textContent.trim() || '',
      ctaDisabled: document.querySelector('.bexp__cta')?.disabled,
      ctaText: document.querySelector('.bexp__cta')?.textContent.trim()
    }))()`)
    console.log('  [diag]', JSON.stringify(diag))
    console.log('  [probe]', JSON.stringify(await evaluate(send, `({ blobs: window.__blobs.length, calls: window.__blobCalls, errs: window.__consoleErrors })`)))
    const begBuf = await grabExportBlob(send, '新手版下载')
    await verifyBranded(send, begBuf, 'beginner-step3')

    /* ------------------------------------------ ② 专业版图纸交付下载 */
    await clickByText(send, '.topbar__actions .modeSwitch button', '专业')
    await waitFor(send, `location.pathname === '/editor'`, { timeout: 20000 })
    await waitFor(send, `!!document.querySelector('[data-audit="open-delivery-build"]')`, { timeout: 20000 })
    await evaluate(send, `document.querySelector('[data-audit="open-delivery-build"]').click()`)
    await sleep(500)
    /* 入口打开的是「拼装与完成」页签，切到「整张图纸」 */
    await clickByText(send, '[role="tab"]', '整张图纸')
    await sleep(500)
    const panelDiag = await evaluate(send, `(() => ({
      path: location.pathname,
      hasRun: !!document.querySelector('.deliveryRun'),
      modal: [...document.querySelectorAll('.modal,.dialog,.baseDialog')].length,
      bodyHint: document.body.innerText.slice(0, 200)
    }))()`)
    console.log('  [panel]', JSON.stringify(panelDiag))
    step('图纸交付面板打开', panelDiag.hasRun)
    await sleep(300)

    await armBlobCapture(send)
    await realClick(send, '.deliveryRun')
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
