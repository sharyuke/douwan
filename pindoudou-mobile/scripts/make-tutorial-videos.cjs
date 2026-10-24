/* =========================================================================
   生成新手教程视频（开发用，不进构建产物）
   做法：用 scripts/tutorial-recorder.html 把真实工作台截图按镜头脚本画到
        canvas 上，再用 MediaRecorder 录成 MP4；封面同一次导出。
   前置：先跑截图脚本，把图放到 .tmp/tutorial-shots/
        （截图脚本见 .tmp/capture-tour.cjs，或按 README 里的步骤手动截）
   用法：node scripts/make-tutorial-videos.cjs            # 全部 4 课
        node scripts/make-tutorial-videos.cjs upload     # 只做某一课
   产物：public/tutorials/<id>.mp4 + <id>-poster.png
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const SHOTS = path.join(ROOT, '.tmp', 'tutorial-shots')
const OUT = path.join(ROOT, 'public', 'tutorials')
const PROFILE = path.join(ROOT, '.tmp', 'tutorial-video-profile')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9342
const WEB = 4342
const TOTAL_TEXT = '4 课 · 约 1 分 30 秒'

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(PROFILE, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm'
}

/* ---------------------------------------------------------------- 镜头脚本
   focus 是截图里的像素矩形（截图统一 1440×810）。 */
const LESSONS = [
  {
    id: 'upload', no: 1,
    segments: [
      { type: 'intro', dur: 2.4, title: '上传图片 · 自动抠图', sub: '从一张照片开始' },
      { type: 'scene', dur: 4.8, image: '01-editor-top', focus: { x: 12, y: 80, w: 280, h: 590 }, badge: '01', title: '先选一张图', sub: '上传照片，或从素材库挑一个', cursorX: 0.5, cursorY: 0.3 },
      { type: 'scene', dur: 5.0, image: '02-create-process', focus: { x: 16, y: 380, w: 272, h: 190 }, badge: '02', title: '智能抠图', sub: '背景和投影一起去掉', cursorX: 0.5, cursorY: 0.55 },
      { type: 'scene', dur: 4.6, image: '01-editor-top', focus: { x: 331, y: 201, w: 752, h: 444 }, badge: '03', title: '主体占满画布', sub: '透明的地方不放豆', cursorX: 0.5, cursorY: 0.5 },
      { type: 'scene', dur: 4.6, image: '09-library', focus: { x: 35, y: 320, w: 1160, h: 150 }, badge: '04', title: '没有照片也能开始', sub: '素材库有现成图案，点一下就用', cursorX: 0.62, cursorY: 0.5 },
      { type: 'outro', dur: 2.6, next: '选方案 · 调色板' }
    ]
  },
  {
    id: 'scheme', no: 2,
    segments: [
      { type: 'intro', dur: 2.4, title: '选方案 · 调色板', sub: '像不像，由这一步决定' },
      { type: 'scene', dur: 5.2, image: '03-scheme', focus: { x: 12, y: 393, w: 280, h: 253 }, badge: '01', title: '先选方向', sub: '高还原 / 好拼版 / 艺术版', cursorX: 0.68, cursorY: 0.45 },
      { type: 'scene', dur: 5.2, image: '04-palette', focus: { x: 12, y: 301, w: 280, h: 535 }, badge: '02', title: '再定颜色', sub: '颜色数量、品牌色板、填充方式', cursorX: 0.5, cursorY: 0.55 },
      { type: 'scene', dur: 4.8, image: '01-editor-top', focus: { x: 331, y: 201, w: 752, h: 444 }, badge: '03', title: '48~64 色最舒服', sub: '颜色越多，换色和孤立豆越多', cursorX: 0.5, cursorY: 0.5 },
      { type: 'outro', dur: 2.6, next: '检查 · 微调' }
    ]
  },
  {
    id: 'check', no: 3,
    segments: [
      { type: 'intro', dur: 2.4, title: '检查 · 微调', sub: '把难拼的地方提前修掉' },
      { type: 'scene', dur: 5.0, image: '05-insights', focus: { x: 1100, y: 80, w: 320, h: 610 }, badge: '01', title: '先看数据', sub: '还原度、可拼性、孤立豆', cursorX: 0.55, cursorY: 0.5 },
      { type: 'scene', dur: 5.0, image: '05b-colors', focus: { x: 1100, y: 88, w: 320, h: 680 }, badge: '02', title: '再看材料', sub: '每种色号的颗数与缺口', cursorX: 0.5, cursorY: 0.45 },
      { type: 'scene', dur: 4.8, image: '01-editor-top', focus: { x: 331, y: 560, w: 752, h: 120 }, badge: '03', title: '直接在画布上改', sub: '画笔 / 橡皮 / 填充 / 吸色', cursorX: 0.42, cursorY: 0.5 },
      { type: 'outro', dur: 2.6, next: '导出 · 开拼 · 完成' }
    ]
  },
  {
    id: 'deliver', no: 4,
    segments: [
      { type: 'intro', dur: 2.4, title: '导出 · 开拼 · 完成', sub: '从屏幕走到实物' },
      { type: 'scene', dur: 5.2, image: '06-delivery-export', focus: { x: 160, y: 50, w: 1120, h: 710 }, badge: '01', title: '按用途导出', sub: 'PNG 发出去，PDF 打印，CSV 采购', cursorX: 0.68, cursorY: 0.62 },
      { type: 'scene', dur: 5.0, image: '06c-delivery-split', focus: { x: 160, y: 50, w: 1120, h: 710 }, badge: '02', title: '大图自动分板', sub: '每块板单独一页，带坐标和色号', cursorX: 0.45, cursorY: 0.5 },
      { type: 'scene', dur: 5.0, image: '07-build', focus: { x: 35, y: 92, w: 1360, h: 650 }, badge: '03', title: '边拼边记进度', sub: '逐颗或整板标记，随时看还差多少', cursorX: 0.55, cursorY: 0.3 },
      { type: 'scene', dur: 5.0, image: '08-finished', focus: { x: 697, y: 420, w: 637, h: 350 }, badge: '04', title: '拼完就完成', sub: '扣库存、记时间、生成分享卡', cursorX: 0.35, cursorY: 0.45 },
      { type: 'outro', dur: 2.6, next: '' }
    ]
  }
]

const WANTED = process.argv.slice(2).filter(a => !a.startsWith('-'))
const queue = WANTED.length ? LESSONS.filter(l => WANTED.includes(l.id)) : LESSONS

/* MediaRecorder 出的是 fragmented MP4：播放器首帧拿到的 duration 只有 2 秒多，
   要整段播完才变成真实时长。用 ffmpeg 无损重封装一次，moov 移到文件头，
   时长和拖动条在加载时就是对的。找不到 ffmpeg 时保留原文件（仍能播，只是不能拖）。 */
const FFMPEG_CANDIDATES = [process.env.FFMPEG].filter(Boolean)
function findFfmpeg() {
  const works = p => {
    try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return true } catch { return false }
  }
  for (const p of FFMPEG_CANDIDATES) if (works(p)) return p
  /* imageio-ffmpeg 装出来的二进制带版本号，目录里找第一个 ffmpeg-*.exe */
  const dir = path.join(ROOT, '..', 'tools', 'ffmpeg-py', 'imageio_ffmpeg', 'binaries')
  try {
    const hit = fs.readdirSync(dir).find(f => /^ffmpeg.*\.exe$/i.test(f))
    if (hit && works(path.join(dir, hit))) return path.join(dir, hit)
  } catch { /* 没装 */ }
  if (works('ffmpeg')) return 'ffmpeg'
  return ''
}
const FFMPEG = findFfmpeg()

function remux(file) {
  if (!FFMPEG) return false
  const tmp = file.replace(/\.mp4$/, '.raw.mp4')
  fs.renameSync(file, tmp)
  try {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', tmp, '-c', 'copy', '-movflags', '+faststart', file], { stdio: 'ignore' })
    fs.unlinkSync(tmp)
    return true
  } catch (e) {
    try { fs.unlinkSync(file) } catch { /* 忽略 */ }
    fs.renameSync(tmp, file)
    console.warn('  ! ffmpeg 重封装失败，保留原始 MP4：', e.message)
    return false
  }
}

let currentConfig = null

function staticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname === '/__recorder.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(fs.readFileSync(path.join(ROOT, 'scripts', 'tutorial-recorder.html')))
        return
      }
      if (u.pathname === '/__config') {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(currentConfig || {}))
        return
      }
      if (u.pathname.startsWith('/__shots/')) {
        const file = path.join(SHOTS, path.basename(u.pathname))
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': MIME['.png'] })
          res.end(fs.readFileSync(file))
          return
        }
        res.writeHead(404); res.end('missing shot'); return
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

async function main() {
  if (!fs.existsSync(DIST)) throw new Error('缺少 dist/，先运行 vite build')
  if (!fs.existsSync(SHOTS)) throw new Error('缺少截图目录 .tmp/tutorial-shots/')
  console.log(FFMPEG ? `ffmpeg: ${FFMPEG}` : '⚠️  未找到 ffmpeg，视频时长要播完才正确')

  const server = await staticServer()
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
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

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result?.value
  }

  for (const lesson of queue) {
    const id = lesson.id
    const mp4 = path.join(OUT, `${id}.mp4`)
    const poster = path.join(OUT, `${id}-poster.png`)
    for (const f of [mp4, poster]) { try { fs.unlinkSync(f) } catch { /* 不存在 */ } }

    const images = [...new Set(lesson.segments.filter(s => s.type === 'scene').map(s => s.image))]
    currentConfig = {
      id, lessonNo: lesson.no, lessonCount: LESSONS.length, totalText: TOTAL_TEXT,
      images, segments: lesson.segments
    }
    console.log(`\n▶ 第 ${lesson.no} 课 ${id}（${lesson.segments.reduce((a, s) => a + s.dur, 0).toFixed(1)}s）`)

    await send('Page.navigate', { url: `http://127.0.0.1:${WEB}/__recorder.html?t=${Date.now()}` })
    await sleep(600)
    const state = await evalJS(`new Promise(res => {
      const t0 = Date.now()
      const tick = () => {
        const s = window.__recorderState
        if (s === 'done' || s === 'error') return res(s)
        if (Date.now() - t0 > 180000) return res('timeout')
        setTimeout(tick, 300)
      }
      tick()
    })`, true)
    if (state === 'error') {
      const msg = await evalJS('window.__recorderError || "unknown"')
      throw new Error(`第 ${lesson.no} 课录制失败: ${msg}`)
    }
    if (state === 'timeout') throw new Error(`第 ${lesson.no} 课录制超时`)

    const count = await evalJS('window.__videoChunks ? window.__videoChunks.length : 0')
    if (!count) throw new Error(`第 ${lesson.no} 课没有拿到录制数据`)
    let b64 = ''
    for (let i = 0; i < count; i++) b64 += await evalJS(`window.__videoChunks[${i}]`)
    fs.writeFileSync(mp4, Buffer.from(b64, 'base64'))
    remux(mp4)
    const posterB64 = await evalJS('window.__posterB64 || ""')
    fs.writeFileSync(poster, Buffer.from(posterB64, 'base64'))
    const meta = await evalJS('JSON.stringify(window.__recorderMeta || {})')
    console.log(`  ✓ ${id}.mp4 ${(fs.statSync(mp4).size / 1024 / 1024).toFixed(2)} MB · 封面 ${(fs.statSync(poster).size / 1024).toFixed(0)} KB · ${meta}`)
  }

  chrome.kill()
  server.close()
  console.log('\n完成，产物在 public/tutorials/')
  process.exit(0)
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1) })
