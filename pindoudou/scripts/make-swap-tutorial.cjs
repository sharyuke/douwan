/* =========================================================================
   换色工具的短视频教程（开发用）
   1. 打开构建好的工作台，摆一张三色小图，按真实按钮走一遍换色；
   2. 把截图交给 swap-tutorial-recorder.html，烧上文字解说和背景音乐。
   用法：node scripts/make-swap-tutorial.cjs
   前置：先在 pindoudou 里 pnpm build
   产物：public/tutorials/swap.mp4（或 .webm）和 swap-poster.png
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const SHOTS = path.join(ROOT, '.tmp', 'swap-tutorial-shots')
const OUT = path.join(ROOT, 'public', 'tutorials')
const PROFILE = path.join(ROOT, '.tmp', 'swap-tutorial-profile')
const RECORDER = path.join(__dirname, 'swap-tutorial-recorder.html')
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find(p => fs.existsSync(p))
const PORT = 9348
const WEB = 4408

if (!CHROME) throw new Error('找不到 Chrome')
if (!fs.existsSync(DIST)) throw new Error('缺少 dist/，先运行 pnpm build')

fs.mkdirSync(SHOTS, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(PROFILE, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm'
}

let currentConfig = null

function findFfmpeg() {
  const works = p => {
    try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return true } catch { return false }
  }
  if (process.env.FFMPEG && works(process.env.FFMPEG)) return process.env.FFMPEG
  const dir = path.join(ROOT, '..', 'tools', 'ffmpeg-py', 'imageio_ffmpeg', 'binaries')
  try {
    const hit = fs.readdirSync(dir).find(f => /^ffmpeg.*\.exe$/i.test(f))
    if (hit && works(path.join(dir, hit))) return path.join(dir, hit)
  } catch { /* 没装 */ }
  const localExe = path.join(ROOT, '.tmp', 'ffbin', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  if (works(localExe)) return localExe
  if (works('ffmpeg')) return 'ffmpeg'
  return ''
}

function staticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname === '/__recorder.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(fs.readFileSync(RECORDER))
        return
      }
      if (u.pathname === '/__config') {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(currentConfig || {}))
        return
      }
      if (u.pathname.startsWith('/__shots/')) {
        const name = path.basename(decodeURIComponent(u.pathname))
        const file = path.join(SHOTS, name)
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': 'image/png' })
          res.end(fs.readFileSync(file))
          return
        }
        res.writeHead(404); res.end('missing'); return
      }
      let p = decodeURIComponent(u.pathname)
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
    server.listen(WEB, '127.0.0.1', () => resolve(server))
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')) } }, 180000)
    })
  }
}

const PAGE = `
window.__swapCap = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const hueOf = hex => {
    const n = parseInt(String(hex || '').replace('#', ''), 16)
    if (!Number.isFinite(n)) return 0
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const d = max - min
    if (!d || !max) return 0
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return (h * 60 + 360) % 360
  }
  const hueDist = (hex, target) => {
    const h = hueOf(hex)
    const d = Math.abs(h - target)
    return Math.min(d, 360 - d)
  }
  function geometry() {
    const cv = document.querySelector('.board.editing canvas')
    const S = window.__swapS
    const p = S && S.pattern.value
    if (!cv || !p) return null
    const cssW = parseFloat(cv.style.width) || cv.getBoundingClientRect().width
    const cssH = parseFloat(cv.style.height) || cv.getBoundingClientRect().height
    const cell0 = cssW / p.width
    if (Math.abs(cssH - p.height * cell0) < 1.2) {
      return { cv, cell: cell0, originX: 0, originY: 0, width: cssW, height: cssH }
    }
    for (let cell = 0.5; cell <= 80; cell += 0.01) {
      const ruler = Math.max(13, Math.min(52, Math.round(cell * 1.8)))
      const w = ruler * 2 + p.width * cell
      const h = ruler * 2 + p.height * cell
      if (Math.abs(w - cssW) < 0.8 && Math.abs(h - cssH) < 0.8) {
        return { cv, cell, originX: ruler, originY: ruler, width: w, height: h }
      }
    }
    return null
  }
  function pointOf(x, y) {
    const g = geometry()
    if (!g) return null
    const rect = g.cv.getBoundingClientRect()
    const scaleX = g.width / rect.width
    const scaleY = g.height / rect.height
    const clientX = rect.left + (g.originX + (x + 0.5) * g.cell) / scaleX
    const clientY = rect.top + (g.originY + (y + 0.5) * g.cell) / scaleY
    return {
      clientX, clientY,
      fx: clientX / window.innerWidth,
      fy: clientY / window.innerHeight
    }
  }
  function clickCell(x, y) {
    const pt = pointOf(x, y)
    const g = geometry()
    if (!pt || !g) return null
    g.cv.dispatchEvent(new MouseEvent('click', {
      clientX: pt.clientX, clientY: pt.clientY, bubbles: true, cancelable: true, view: window
    }))
    return { fx: pt.fx, fy: pt.fy }
  }
  async function dismiss() {
    for (let i = 0; i < 8; i++) {
      const modal = document.querySelector('.modal.show')
      if (!modal) return
      const btn = [...modal.querySelectorAll('button')].find(b => /我知道了|继续使用|关闭/.test(b.textContent || ''))
      if (!btn) return
      btn.click()
      await sleep(250)
    }
  }
  return {
    async setup() {
      await dismiss()
      const S = await window.__douzao.studio()
      window.__swapS = S
      const colors = (S.availableColors.value || []).filter(c => c && c.hex && c.id)
      const pick = (target, used) => colors
        .filter(c => !used.has(c.id))
        .slice()
        .sort((a, b) => hueDist(a.hex, target) - hueDist(b.hex, target))[0]
      const used = new Set()
      const red = pick(8, used); used.add(red && red.id)
      const yellow = pick(52, used); used.add(yellow && yellow.id)
      const green = pick(135, used); used.add(green && green.id)
      const blue = pick(220, used)
      if (!red || !yellow || !green || !blue) return { ok: false, err: '色板不够四种颜色' }
      S.options.canvasW = 16
      S.options.canvasH = 16
      S.options.canvasMaxW = 16
      S.options.canvasMaxH = 16
      S.resetWorkspace({ blank: true })
      S.tool.value = 'paint'
      S.setToolSize(1, 'paint')
      S.swapMode.value = 'brush'
      S.beginEdit()
      const paint = (color, x0, x1) => {
        S.brushColorId.value = color.id
        for (let y = 3; y <= 12; y++) {
          for (let x = x0; x <= x1; x++) S.paintAt(x, y, { record: false })
        }
      }
      paint(red, 2, 5)
      paint(yellow, 6, 9)
      paint(green, 10, 13)
      S.endEdit()
      S.brushColorId.value = blue.id
      S.tool.value = 'swap'
      S.swapMode.value = 'brush'
      await sleep(700)
      const arrow = document.querySelector('[data-swap-arrow]')
      const cv = document.querySelector('.board.editing canvas')
      if (!arrow || !cv) return { ok: false, err: '换色箭头或画布没出现', arrow: !!arrow, cv: !!cv, mode: document.body.className }
      const redPt = pointOf(3, 7)
      const yellowPt = pointOf(7, 7)
      const greenPt = pointOf(11, 7)
      return {
        ok: true,
        red: red.code, yellow: yellow.code, green: green.code, blue: blue.code,
        redPt, yellowPt, greenPt
      }
    },
    clickCell,
    pointOf,
    openMenu() {
      const btn = document.querySelector('[data-swap-arrow]')
      if (btn) btn.click()
      return !!btn
    },
    menuItems() {
      return [...document.querySelectorAll('#cs-swap-menu button')].map(b => {
        const r = b.getBoundingClientRect()
        return {
          text: (b.textContent || '').replace(/\\s+/g, '').trim(),
          x: r.left / window.innerWidth,
          y: r.top / window.innerHeight,
          w: r.width / window.innerWidth,
          h: r.height / window.innerHeight
        }
      })
    },
    clickMenu(label) {
      const btn = [...document.querySelectorAll('#cs-swap-menu button')].find(b => (b.textContent || '').includes(label))
      if (btn) btn.click()
      return !!btn
    },
    undo() {
      const S = window.__swapS
      if (S) S.undo()
    },
    async settle() { await sleep(450) }
  }
})()
`

function hasAudio(buf, mime) {
  const head = buf.subarray(0, Math.min(buf.length, 8 * 1024 * 1024)).toString('latin1')
  if (/mp4|avc1/i.test(mime)) return head.includes('mp4a') || head.includes('sowt')
  return head.includes('OpusHead') || head.includes('A_OPUS') || head.includes('vorbis')
}

async function main() {
  const server = await staticServer()
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'
  ], { stdio: 'ignore' })

  let version
  for (let i = 0; i < 100; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break } catch { await sleep(200) }
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
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    }
    return r.result?.value
  }

  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'))
    console.log('  截图', name)
  }

  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('douwan.guide.v1','1')}catch(e){}" })
  await send('Page.navigate', { url: `http://127.0.0.1:${WEB}/editor` })
  await sleep(1200)
  const ready = await evalJS(`new Promise(res => {
    const t0 = Date.now()
    const tick = () => {
      if (window.__douzao) return res('ok')
      if (Date.now() - t0 > 20000) return res('timeout')
      setTimeout(tick, 150)
    }
    tick()
  })`, true)
  if (ready !== 'ok') throw new Error('工作台调试桥没起来')
  await evalJS(PAGE)
  const setup = await evalJS('window.__swapCap.setup()', true)
  console.log('setup', setup)
  if (!setup || !setup.ok) throw new Error('摆拍失败: ' + JSON.stringify(setup))
  await shot('ready')

  const redPt = await evalJS('window.__swapCap.clickCell(3, 7)', true)
  await evalJS('window.__swapCap.settle()', true)
  await shot('brushed')

  await evalJS('window.__swapCap.openMenu()')
  await evalJS('window.__swapCap.settle()', true)
  const menu = await evalJS('window.__swapCap.menuItems()', true)
  console.log('menu', menu)
  await shot('menu')
  if (!menu || menu.map(m => m.text).join(',') !== '自动替换相近色,替换为空豆,查看教程') {
    throw new Error('菜单文案不对: ' + JSON.stringify(menu))
  }

  await evalJS('window.__swapCap.clickMenu("自动替换相近色")')
  await sleep(200)
  const greenPt = await evalJS('window.__swapCap.clickCell(11, 7)', true)
  await evalJS('window.__swapCap.settle()', true)
  await shot('nearest')

  await evalJS('window.__swapCap.openMenu()')
  await evalJS('window.__swapCap.settle()', true)
  await shot('menuEmpty')

  await evalJS('window.__swapCap.clickMenu("替换为空豆")')
  await sleep(200)
  const yellowPt = await evalJS('window.__swapCap.clickCell(7, 7)', true)
  await evalJS('window.__swapCap.settle()', true)
  await shot('empty')

  await evalJS('window.__swapCap.undo()')
  await evalJS('window.__swapCap.settle()', true)
  await shot('undo')

  const hi = (label) => menu.find(m => m.text === label)
  currentConfig = {
    images: ['ready', 'brushed', 'menu', 'nearest', 'menuEmpty', 'empty', 'undo'],
    segments: [
      {
        dur: 5.2, a: 'ready', b: 'brushed',
        title: '点一格，同色的豆一起换',
        sub: `换色会把 ${setup.red} 全部换成当前画笔色 ${setup.blue}`,
        cursor: { fromX: 0.55, fromY: 0.42, x: redPt.fx, y: redPt.fy }
      },
      {
        dur: 5.6, a: 'menu', b: 'nearest',
        title: '自动替换相近色',
        sub: `在同系列里挑色差最小的色号，把 ${setup.green} 一次换完`,
        highlight: hi('自动替换相近色'),
        cursor: { fromX: menu[0].x + menu[0].w * 0.4, fromY: menu[0].y, x: greenPt.fx, y: greenPt.fy }
      },
      {
        dur: 5.4, a: 'menuEmpty', b: 'empty',
        title: '替换为空豆',
        sub: `这一色从画布上拿掉，${setup.yellow} 变成空位`,
        highlight: hi('替换为空豆'),
        cursor: { fromX: menu[1].x + menu[1].w * 0.3, fromY: menu[1].y, x: yellowPt.fx, y: yellowPt.fy }
      },
      {
        dur: 4.2, a: 'empty', b: 'undo',
        title: '换错了可以撤销',
        sub: '每一步都是单独的一步，Ctrl+Z 就能回到刚才'
      }
    ]
  }

  console.log('开始录制…')
  await send('Page.navigate', { url: `http://127.0.0.1:${WEB}/__recorder.html?t=${Date.now()}` })
  await sleep(500)
  const state = await evalJS(`new Promise(res => {
    const t0 = Date.now()
    const tick = () => {
      const s = window.__recorderState
      if (s === 'done' || s === 'error') return res(s)
      if (Date.now() - t0 > 90000) return res('timeout')
      setTimeout(tick, 300)
    }
    tick()
  })`, true)
  if (state !== 'done') {
    const msg = await evalJS('window.__recorderError || ""')
    throw new Error('录制失败 ' + state + ' ' + msg)
  }
  const meta = await evalJS('window.__recorderMeta')
  const peak = await evalJS('window.__audioPeak || 0')
  const mime = await evalJS('window.__recorderMime || ""')
  const count = await evalJS('window.__videoChunks ? window.__videoChunks.length : 0')
  if (!count) throw new Error('没有拿到视频数据')
  let b64 = ''
  for (let i = 0; i < count; i++) b64 += await evalJS(`window.__videoChunks[${i}]`)
  const buf = Buffer.from(b64, 'base64')
  const ext = /mp4/i.test(mime) ? 'mp4' : 'webm'
  const videoPath = path.join(OUT, 'swap.' + ext)
  fs.writeFileSync(videoPath, buf)
  const posterB64 = await evalJS('window.__posterB64 || ""')
  fs.writeFileSync(path.join(OUT, 'swap-poster.png'), Buffer.from(posterB64, 'base64'))
  const audio = hasAudio(buf, mime)
  console.log(`视频 ${videoPath} ${(buf.length / 1024 / 1024).toFixed(2)} MB mime=${mime} peak=${peak} audio=${audio}`)
  console.log('meta', meta)

  const ffmpeg = findFfmpeg()
  if (ffmpeg && ext === 'mp4') {
    const tmp = videoPath.replace(/\.mp4$/, '.raw.mp4')
    fs.renameSync(videoPath, tmp)
    try {
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', tmp, '-c', 'copy', '-movflags', '+faststart', videoPath], { stdio: 'inherit' })
      fs.unlinkSync(tmp)
      console.log('ffmpeg 已把 moov 移到文件头')
    } catch (e) {
      if (!fs.existsSync(videoPath)) fs.renameSync(tmp, videoPath)
      console.warn('ffmpeg 重封装失败', e.message)
    }
  } else if (!audio) {
    console.warn('音轨没写进文件，peak=', peak, 'ffmpeg=', ffmpeg || '无')
  }

  chrome.kill()
  server.close()
  if (!audio || !peak) {
    console.error('视频里没有可用的背景音乐')
    process.exit(2)
  }
  if (ext !== 'mp4') {
    console.error('录出来的不是 mp4，页面要的是 tutorials/swap.mp4')
    process.exit(3)
  }
  console.log('完成')
  process.exit(0)
}

main().catch(e => { console.error('\n✗', e && e.stack || e); process.exit(1) })
