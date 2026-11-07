/* 换色箭头菜单：三项文案、相近色、空豆、撤销，以及教程弹窗里的视频。
   用法：node scripts/verify/swap-menu.cjs
   需要先 pnpm build，并且 public/tutorials/swap.mp4 已经复制进 dist/tutorials/。 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.tmp', 'swap-menu')
const PORT = Number(process.env.AUDIT_PORT || 4407)
const CDP_PORT = Number(process.env.AUDIT_CDP || 9347)
const PROFILE = path.join(ROOT, '.tmp', 'swap-menu-profile')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(PROFILE, { recursive: true })

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find(p => fs.existsSync(p))
if (!CHROME) throw new Error('找不到 Chrome')
if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('缺少 dist/')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm'
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const fails = []
function check(name, ok, extra) {
  const mark = ok ? 'ok' : 'FAIL'
  console.log(`${mark}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`)
  if (!ok) fails.push(name)
}

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
      const ext = path.extname(file)
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Accept-Ranges': 'bytes'
      })
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
      this.ws.addEventListener('open', resolve)
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
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
}

const DRIVE = `
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const hueOf = hex => {
    const n = parseInt(String(hex || '').replace('#', ''), 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const d = max - min
    if (!d || !max) return 0
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return (h * 60 + 360) % 360
  }
  const hueDist = (hex, target) => {
    const d = Math.abs(hueOf(hex) - target)
    return Math.min(d, 360 - d)
  }
  for (let i = 0; i < 8; i++) {
    const modal = document.querySelector('.modal.show')
    if (!modal) break
    const btn = [...modal.querySelectorAll('button')].find(b => /我知道了|继续使用|关闭/.test(b.textContent || ''))
    if (!btn) break
    btn.click()
    await sleep(200)
  }
  const S = await window.__douzao.studio()
  const colorApi = window.__douzao.color
  const colors = (S.availableColors.value || []).filter(c => c && c.hex && c.lab)
  const used = new Set()
  const pick = target => {
    const c = colors.filter(x => !used.has(x.id)).slice().sort((a, b) => hueDist(a.hex, target) - hueDist(b.hex, target))[0]
    if (c) used.add(c.id)
    return c
  }
  const red = pick(8), yellow = pick(52), green = pick(135), blue = pick(220)
  if (!red || !yellow || !green || !blue) return { ok: false, err: '色板不够' }
  S.options.canvasW = 16
  S.options.canvasH = 16
  S.options.canvasMaxW = 16
  S.options.canvasMaxH = 16
  S.resetWorkspace({ blank: true })
  S.tool.value = 'paint'
  S.setToolSize(1, 'paint')
  S.beginEdit()
  const paint = (color, x0, x1) => {
    S.brushColorId.value = color.id
    for (let y = 3; y <= 12; y++) for (let x = x0; x <= x1; x++) S.paintAt(x, y, { record: false })
  }
  paint(red, 2, 5)
  paint(yellow, 6, 9)
  paint(green, 10, 13)
  S.endEdit()
  S.brushColorId.value = blue.id
  S.tool.value = 'swap'
  S.swapMode.value = 'brush'
  await sleep(600)
  const arrow = document.querySelector('[data-swap-arrow]')
  const sizeToggles = [...document.querySelectorAll('[data-tool-size]')].map(b => b.getAttribute('data-tool-size'))
  if (!arrow) return { ok: false, err: '没有换色箭头', sizeToggles }
  arrow.click()
  await sleep(250)
  const labels = [...document.querySelectorAll('#cs-swap-menu button')].map(b => (b.textContent || '').replace(/\\s+/g, ''))
  const outside = document.querySelector('.stage')
  if (outside) outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 800, clientY: 400 }))
  await sleep(150)
  const closedByOutside = !document.querySelector('#cs-swap-menu')
  arrow.click()
  await sleep(150)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(150)
  const closedByEsc = !document.querySelector('#cs-swap-menu')

  const cv = document.querySelector('.board.editing canvas')
  const p0 = S.pattern.value
  const cssW = parseFloat(cv.style.width) || cv.getBoundingClientRect().width
  const cssH = parseFloat(cv.style.height) || cv.getBoundingClientRect().height
  let geo = null
  const cell0 = cssW / p0.width
  if (Math.abs(cssH - p0.height * cell0) < 1.2) geo = { cell: cell0, originX: 0, originY: 0, width: cssW, height: cssH }
  else {
    for (let cell = 0.5; cell <= 80 && !geo; cell += 0.01) {
      const ruler = Math.max(13, Math.min(52, Math.round(cell * 1.8)))
      const w = ruler * 2 + p0.width * cell
      const h = ruler * 2 + p0.height * cell
      if (Math.abs(w - cssW) < 0.8 && Math.abs(h - cssH) < 0.8) geo = { cell, originX: ruler, originY: ruler, width: w, height: h }
    }
  }
  const clickAt = (x, y) => {
    const rect = cv.getBoundingClientRect()
    const scaleX = geo.width / rect.width
    const scaleY = geo.height / rect.height
    cv.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + (geo.originX + (x + 0.5) * geo.cell) / scaleX,
      clientY: rect.top + (geo.originY + (y + 0.5) * geo.cell) / scaleY,
      bubbles: true, cancelable: true, view: window
    }))
  }
  const idsAt = () => {
    const p = S.pattern.value
    const idOf = k => (k < 0 ? '' : (p.palette[k] && p.palette[k].id) || '')
    return {
      red: idOf(p.cells[7 * p.width + 3]),
      yellow: idOf(p.cells[7 * p.width + 7]),
      green: idOf(p.cells[7 * p.width + 11])
    }
  }
  const before = idsAt()
  clickAt(3, 7)
  await sleep(200)
  const afterBrush = idsAt()
  const brushId = blue.id
  S.undo()
  await sleep(120)
  const afterUndoBrush = idsAt()

  arrow.click()
  await sleep(150)
  const nearestBtn = [...document.querySelectorAll('#cs-swap-menu button')].find(b => (b.textContent || '').includes('自动替换相近色'))
  nearestBtn.click()
  await sleep(80)
  let best = null, bestD = Infinity
  for (const c of S.availableColors.value) {
    if (!c || !c.lab || c.id === green.id) continue
    const d = colorApi.deltaE2000(green.lab, c.lab)
    if (d < bestD) { bestD = d; best = c }
  }
  clickAt(11, 7)
  await sleep(200)
  const afterNearest = idsAt()
  const modeAfterNearest = S.swapMode.value
  S.undo()
  await sleep(120)

  arrow.click()
  await sleep(120)
  const emptyBtn = [...document.querySelectorAll('#cs-swap-menu button')].find(b => (b.textContent || '').includes('替换为空豆'))
  emptyBtn.click()
  await sleep(80)
  clickAt(7, 7)
  await sleep(200)
  const afterEmpty = idsAt()
  const emptyCount = (() => {
    const p = S.pattern.value
    let n = 0
    for (let i = 0; i < p.cells.length; i++) if (p.cells[i] < 0) n++
    return n
  })()
  const undoDepth = S.undoDepth.value
  S.undo()
  await sleep(150)
  const afterUndoEmpty = idsAt()

  document.querySelector('[data-tool-key="swap"]').click()
  await sleep(80)
  const modeAfterTool = S.swapMode.value

  arrow.click()
  await sleep(120)
  const tutorialBtn = [...document.querySelectorAll('#cs-swap-menu button')].find(b => (b.textContent || '').includes('查看教程'))
  tutorialBtn.click()
  await sleep(400)
  const video = document.querySelector('.swapTutorial video')
  const dialogText = (document.querySelector('.modal.show') || {}).textContent || ''
  let media = null
  if (video) {
    media = await new Promise(resolve => {
      const done = () => resolve({
        src: video.currentSrc || video.src,
        ready: video.readyState,
        w: video.videoWidth,
        h: video.videoHeight,
        duration: video.duration,
        error: video.error ? (video.error.message || String(video.error.code)) : ''
      })
      if (video.readyState >= 1) return done()
      video.addEventListener('loadedmetadata', done, { once: true })
      video.addEventListener('error', done, { once: true })
      setTimeout(done, 4000)
    })
  }
  return {
    ok: true,
    labels, sizeToggles, closedByOutside, closedByEsc,
    before, afterBrush, brushId, afterUndoBrush,
    bestId: best && best.id, bestCode: best && best.code, afterNearest, modeAfterNearest,
    afterEmpty, emptyCount, undoDepth, afterUndoEmpty, modeAfterTool,
    hasVideo: !!video, dialogHasTitle: dialogText.includes('换色教程'), media
  }
})()
`

async function main() {
  const videoFile = path.join(DIST, 'tutorials', 'swap.mp4')
  const videoBuf = fs.existsSync(videoFile) ? fs.readFileSync(videoFile) : null
  const videoHead = videoBuf ? videoBuf.subarray(0, Math.min(videoBuf.length, 4 * 1024 * 1024)).toString('latin1') : ''
  check('教程视频在 dist 里', !!videoBuf && videoBuf.length > 100000, { bytes: videoBuf ? videoBuf.length : 0 })
  check('教程视频含音轨', !!videoBuf && (videoHead.includes('mp4a') || videoHead.includes('OpusHead')), { mp4a: videoHead.includes('mp4a') })

  const server = await staticServer()
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'
  ], { stdio: 'ignore' })
  let version
  for (let i = 0; i < 80; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break } catch { await sleep(200) }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪')
  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  const evalJS = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result?.value
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('douwan.guide.v1','1')}catch(e){}" })
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/editor` })
  await sleep(1000)
  const booted = await evalJS(`new Promise(res => {
    const t0 = Date.now()
    const tick = () => {
      if (window.__douzao) return res('ok')
      if (Date.now() - t0 > 20000) return res('timeout')
      setTimeout(tick, 150)
    }
    tick()
  })`, true)
  if (booted !== 'ok') throw new Error('工作台没起来')
  const result = await evalJS(DRIVE, true)
  console.log(JSON.stringify(result, null, 2))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, 'tutorial.png'), Buffer.from(shot.data, 'base64'))
  chrome.kill()
  server.close()
  if (!result || !result.ok) {
    console.error('驱动失败')
    process.exit(1)
  }
  check('菜单顺序是相近色、空豆、教程', result.labels.join(',') === '自动替换相近色,替换为空豆,查看教程', result.labels)
  check('画笔橡皮尺寸箭头还在', result.sizeToggles.join(',') === 'paint,erase', result.sizeToggles)
  check('点外面关掉菜单', result.closedByOutside === true)
  check('Esc 关掉菜单', result.closedByEsc === true)
  check('默认换色换成画笔色', result.afterBrush.red === result.brushId && result.afterBrush.yellow === result.before.yellow && result.afterBrush.green === result.before.green, result.afterBrush)
  check('撤销恢复画笔换色', result.afterUndoBrush.red === result.before.red)
  check('相近色换的是独立算出来的色号', result.afterNearest.green === result.bestId && result.afterNearest.red === result.before.red && result.modeAfterNearest === 'nearest', { best: result.bestCode, after: result.afterNearest })
  check('空豆把这一色清掉，旁边两色还在', result.afterEmpty.yellow === '' && result.afterEmpty.red === result.before.red && result.afterEmpty.green === result.before.green && result.emptyCount > 100, { afterEmpty: result.afterEmpty, emptyCount: result.emptyCount, undoDepth: result.undoDepth })
  check('撤销恢复空豆', result.afterUndoEmpty.yellow === result.before.yellow)
  check('再点换色按钮回到画笔模式', result.modeAfterTool === 'brush')
  check('查看教程打开小弹窗', result.hasVideo === true && result.dialogHasTitle === true)
  check('弹窗里的视频能读到时长', result.media && result.media.duration > 8 && !result.media.error, result.media)
  if (fails.length) {
    console.error('失败 ' + fails.length + ' 项: ' + fails.join('、'))
    process.exit(1)
  }
  console.log('swap-menu ok')
  process.exit(0)
}

main().catch(e => { console.error(e && e.stack || e); process.exit(1) })
