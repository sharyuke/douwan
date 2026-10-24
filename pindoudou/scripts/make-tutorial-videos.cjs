/* =========================================================================
   生成新手教程视频（开发用，不进构建产物）
   做法：用 scripts/tutorial-recorder.html 把真实工作台截图按镜头脚本画到
        canvas 上，再用 MediaRecorder 录成 MP4；封面同一次导出。
   桌面端和手机端是两套独立的课，画面与文案都按各自界面写。
   前置：node scripts/capture-tutorial-shots.cjs   # 先截当前 UI
   用法：node scripts/make-tutorial-videos.cjs                  # 两端全部 5 课
        node scripts/make-tutorial-videos.cjs desktop          # 只做桌面端
        node scripts/make-tutorial-videos.cjs mobile deliver   # 只做手机端第 5 课
   产物：public/tutorials/desktop/<id>.mp4 + <id>-poster.png
        public/tutorials/mobile/<id>.mp4  + <id>-poster.png
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
const TOTAL_TEXT = '5 课 · 约 2 分钟'

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(PROFILE, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm'
}

/* ---------------------------------------------------------------- 课程脚本
   shot 是 capture-tutorial-shots.cjs 产出的截图名；focus 从 shots.json 读。 */
const LESSONS = {
  desktop: [
    {
      id: 'upload', no: 1, title: '上传图片 · 自动抠图', sub: '从一张照片开始',
      steps: ['认识工作台', '上传照片', '智能抠图', '看生成结果', '免费素材库'],
      scenes: [
        { shot: 'd00-empty', dur: 4.8, title: '先认识工作台', sub: '左栏做设置，中间是画布，右边看分析', cursor: false },
        { shot: 'd01-create', dur: 5.0, title: '上传一张照片', sub: '在「① 先选你要拼什么」里上传', cursorX: 0.5, cursorY: 0.32 },
        { shot: 'd02-matte', dur: 5.0, title: '智能抠图', sub: '背景和投影一起去掉，只留主体', cursorX: 0.5, cursorY: 0.52 },
        { shot: 'd03-canvas', dur: 4.8, title: '看看生成结果', sub: '52 × 52 颗豆，主体自动占满画布', cursor: false },
        { shot: 'd04-library', dur: 4.8, title: '没有照片也能开始', sub: '「免费素材库」有现成图案，点一下就用', cursorX: 0.62, cursorY: 0.5 }
      ]
    },
    {
      id: 'size', no: 2, title: '画布与成品尺寸', sub: '底板和清晰度先定下来',
      steps: ['底板尺寸', '清晰度', '实际大小'],
      scenes: [
        { shot: 'd05-size-board', dur: 5.0, title: '先定底板大小', sub: '选实物厘米数，工作台换算成豆子格数', cursorX: 0.5, cursorY: 0.45 },
        { shot: 'd06-size-clarity', dur: 5.0, title: '再定清晰度', sub: '豆子越多细节越多，拼起来也更费时间', cursorX: 0.5, cursorY: 0.55 },
        { shot: 'd16-actual', dur: 5.2, title: '按实际大小看', sub: '「实际大小」按屏幕比例还原成品尺寸', cursorX: 0.28, cursorY: 0.16 }
      ]
    },
    {
      id: 'scheme', no: 3, title: '生成方案 · 色板', sub: '像不像，由这一步决定',
      steps: ['生成方案', '色板选择', '回到画布'],
      scenes: [
        { shot: 'd07-scheme', dur: 5.0, title: '先选方向', sub: '免费版给「高还原」一套；Pro 可三套对比', cursorX: 0.5, cursorY: 0.55 },
        { shot: 'd08-palette', dur: 5.2, title: '再定颜色', sub: '颜色数量、品牌色板、填充方式都在这里', cursorX: 0.5, cursorY: 0.52 },
        { shot: 'd03-canvas', dur: 4.8, title: '改完立刻重算', sub: '画布会按新方案重新生成', cursor: false }
      ]
    },
    {
      id: 'check', no: 4, title: '检查 · 微调', sub: '把难拼的地方提前修掉',
      steps: ['作品分析', '颜色用量', '画布工具'],
      scenes: [
        { shot: 'd09-analysis', dur: 5.0, title: '先看数据', sub: '还原度、可拼性、孤立豆都在这里', cursorX: 0.5, cursorY: 0.5 },
        { shot: 'd10-colors', dur: 5.0, title: '再看材料', sub: '每种色号的颗数，缺色会直接标出来', cursorX: 0.5, cursorY: 0.45 },
        { shot: 'd11-tools', dur: 5.0, title: '直接在画布上改', sub: '画笔 / 橡皮 / 填充 / 吸色，撤销随时可用', cursorX: 0.42, cursorY: 0.5 }
      ]
    },
    {
      id: 'deliver', no: 5, title: '交付 · 开拼 · 完成', sub: '从屏幕走到实物',
      steps: ['图纸交付', '整张图纸', '分板交付', '拼装与完成'],
      scenes: [
        { shot: 'd12-delivery-card', dur: 4.8, title: '出口在左栏最下面', sub: '「⑤ 图纸交付」展开就是导出与开拼', cursorX: 0.55, cursorY: 0.5 },
        { shot: 'd13-export', dur: 5.2, title: '按用途导出', sub: 'PNG 发出去，PDF 打印，CSV 采购', cursorX: 0.66, cursorY: 0.6 },
        { shot: 'd14-split', dur: 5.2, title: '大图自动分板', sub: '每块板单独一页，带坐标和色号', cursorX: 0.5, cursorY: 0.45 },
        { shot: 'd15-build', dur: 5.2, title: '边拼边记进度', sub: '逐颗或整板标记，随时看还差多少', cursorX: 0.55, cursorY: 0.32 }
      ]
    }
  ],
  mobile: [
    {
      id: 'upload', no: 1, title: '上传与快捷区', sub: '手机端的入口都在画布边上',
      steps: ['空画布引导', '画布与快捷区', '更多功能', '换图'],
      scenes: [
        { shot: 'm00-empty', dur: 4.8, title: '先看空画布', sub: '上传入口就在画布中间', cursor: false },
        { shot: 'm01-canvas', dur: 5.0, title: '画布与快捷区', sub: '上方切图纸 / 原图 / 对照，下面一行常用功能', cursorX: 0.5, cursorY: 0.2 },
        { shot: 'm02-functions', dur: 5.0, title: '「更多」放其余功能', sub: '用量、方案、分析、库存、保存作品', cursorX: 0.5, cursorY: 0.72 },
        { shot: 'm03-library', dur: 5.0, title: '换图也能用素材库', sub: '快捷区 → 换图 → 免费素材库', cursorX: 0.5, cursorY: 0.5 }
      ]
    },
    {
      id: 'size', no: 2, title: '尺寸与清晰度', sub: '快捷区「画布」抽屉里调',
      steps: ['画布尺寸', '尺寸摘要', '实际大小'],
      scenes: [
        { shot: 'm04-size-board', dur: 5.0, title: '快捷区「画布」', sub: '底板选实物厘米数，清晰度选豆子数量', cursorX: 0.5, cursorY: 0.35 },
        { shot: 'm05-size-summary', dur: 5.0, title: '看尺寸摘要', sub: '成品多大、多少颗豆，一眼确认', cursorX: 0.5, cursorY: 0.5 },
        { shot: 'm16-actual', dur: 5.2, title: '按实际大小看', sub: '「实际大小」按屏幕比例还原成品', cursorX: 0.5, cursorY: 0.15 }
      ]
    },
    {
      id: 'scheme', no: 3, title: '生成方案 · 色板', sub: '手机上同样能调',
      steps: ['生成方案', '色板选择'],
      scenes: [
        { shot: 'm06-scheme', dur: 5.0, title: '「更多 → 方案」', sub: '免费版给「高还原」一套；Pro 可三套对比', cursorX: 0.5, cursorY: 0.5 },
        { shot: 'm07-palette', dur: 5.2, title: '快捷区「色板」', sub: '颜色数量、品牌、填充方式都在这里', cursorX: 0.5, cursorY: 0.45 }
      ]
    },
    {
      id: 'edit', no: 4, title: '编辑与检查', sub: '工具行就在画布下方',
      steps: ['编辑工具行', '笔刷参数', '更多编辑', '作品分析与用量'],
      scenes: [
        { shot: 'm11-tools', dur: 5.0, title: '底部工具行', sub: '镜像 / 画笔 / 橡皮 / 填充 / 取色，点开就有参数条', cursorX: 0.3, cursorY: 0.88 },
        { shot: 'm08-edit', dur: 5.0, title: '「更多」放其余编辑', sub: '网格、分板、材料、教程；撤销 / 重做在画布右侧', cursorX: 0.5, cursorY: 0.72 },
        { shot: 'm09-analysis', dur: 5.0, title: '「更多 → 分析」', sub: '还原度、可拼性、孤立豆', cursorX: 0.5, cursorY: 0.5 },
        { shot: 'm10-colors', dur: 5.0, title: '「更多 → 用量」', sub: '每种色号的颗数，缺色会标出来', cursorX: 0.5, cursorY: 0.55 }
      ]
    },
    {
      id: 'deliver', no: 5, title: '交付与保存', sub: '快捷区导出，更多里保存',
      steps: ['图纸交付', '分板交付', '拼装与完成', '保存作品'],
      scenes: [
        { shot: 'm12-delivery', dur: 5.0, title: '快捷区「导出」', sub: '整张图纸、分板、拼装三个标签', cursorX: 0.5, cursorY: 0.25 },
        { shot: 'm13-split', dur: 5.2, title: '分板交付', sub: '每块板单独一页，带坐标和色号', cursorX: 0.5, cursorY: 0.45 },
        { shot: 'm14-build', dur: 5.2, title: '边拼边记进度', sub: '逐颗或整板标记，随时看还差多少', cursorX: 0.5, cursorY: 0.35 },
        { shot: 'm15-save', dur: 5.0, title: '「更多 → 保存作品」', sub: '存下来，下次从底部「作品」继续', cursorX: 0.5, cursorY: 0.72 }
      ]
    }
  ]
}

const args = process.argv.slice(2)
const devices = args.filter(a => a === 'desktop' || a === 'mobile')
const wantedIds = args.filter(a => a !== 'desktop' && a !== 'mobile')
const queue = (devices.length ? devices : ['desktop', 'mobile']).flatMap(device =>
  (wantedIds.length ? LESSONS[device].filter(l => wantedIds.includes(l.id)) : LESSONS[device])
    .map(lesson => ({ device, lesson }))
)

/* MediaRecorder 出的是 fragmented MP4：播放器首帧拿到的 duration 只有 2 秒多，
   要整段播完才变成真实时长。用 ffmpeg 无损重封装一次，moov 移到文件头，
   时长和拖动条在加载时就是对的。找不到 ffmpeg 时保留原文件（仍能播，只是不能拖）。 */
const FFMPEG_CANDIDATES = [process.env.FFMPEG].filter(Boolean)
function findFfmpeg() {
  const works = p => {
    try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return true } catch { return false }
  }
  for (const p of FFMPEG_CANDIDATES) if (works(p)) return p
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
        const rel = decodeURIComponent(u.pathname.slice('/__shots/'.length)).replace(/\\/g, '/')
        const file = path.resolve(SHOTS, rel)
        if (file.startsWith(path.resolve(SHOTS)) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
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

function buildConfig(device, lesson, manifest) {
  const set = manifest.sets[device]
  if (!set) throw new Error(`截图清单里没有 ${device} 这一套，先跑 capture-tutorial-shots.cjs`)
  const images = []
  const seen = new Set()
  const segments = [
    { type: 'intro', dur: 2.4, title: lesson.title, sub: lesson.sub }
  ]
  lesson.scenes.forEach((scene, i) => {
    const shot = set.shots[scene.shot]
    if (!shot) throw new Error(`缺少截图 ${device}/${scene.shot}，先重跑 capture-tutorial-shots.cjs`)
    if (!seen.has(scene.shot)) {
      seen.add(scene.shot)
      images.push({ name: scene.shot, file: shot.file })
    }
    segments.push({
      type: 'scene', image: scene.shot, dur: scene.dur,
      w: shot.w, h: shot.h, focus: shot.focus,
      badge: String(i + 1).padStart(2, '0'), step: i,
      title: scene.title, sub: scene.sub,
      cursor: scene.cursor, cursorX: scene.cursorX, cursorY: scene.cursorY
    })
  })
  const next = LESSONS[device][lesson.no] ? LESSONS[device][lesson.no].title : ''
  segments.push({ type: 'outro', dur: 2.6, next })
  return {
    id: lesson.id, device, lessonNo: lesson.no, lessonCount: LESSONS[device].length,
    lessonTitle: lesson.title, steps: lesson.steps.map(title => ({ title })),
    totalText: TOTAL_TEXT, images, segments
  }
}

async function main() {
  if (!fs.existsSync(DIST)) throw new Error('缺少 dist/，先运行 vite build')
  if (!fs.existsSync(path.join(SHOTS, 'shots.json'))) throw new Error('缺少截图清单 .tmp/tutorial-shots/shots.json')
  const manifest = JSON.parse(fs.readFileSync(path.join(SHOTS, 'shots.json'), 'utf8'))
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

  for (const { device, lesson } of queue) {
    const id = lesson.id
    const dir = path.join(OUT, device)
    fs.mkdirSync(dir, { recursive: true })
    const mp4 = path.join(dir, `${id}.mp4`)
    const poster = path.join(dir, `${id}-poster.png`)
    for (const f of [mp4, poster]) { try { fs.unlinkSync(f) } catch { /* 不存在 */ } }

    currentConfig = buildConfig(device, lesson, manifest)
    const seconds = currentConfig.segments.reduce((a, s) => a + s.dur, 0)
    console.log(`\n▶ ${device === 'mobile' ? '手机' : '桌面'} 第 ${lesson.no} 课 ${id}（${seconds.toFixed(1)}s）`)

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
      throw new Error(`${device} 第 ${lesson.no} 课录制失败: ${msg}`)
    }
    if (state === 'timeout') throw new Error(`${device} 第 ${lesson.no} 课录制超时`)

    const count = await evalJS('window.__videoChunks ? window.__videoChunks.length : 0')
    if (!count) throw new Error(`${device} 第 ${lesson.no} 课没有拿到录制数据`)
    let b64 = ''
    for (let i = 0; i < count; i++) b64 += await evalJS(`window.__videoChunks[${i}]`)
    fs.writeFileSync(mp4, Buffer.from(b64, 'base64'))
    remux(mp4)
    const posterB64 = await evalJS('window.__posterB64 || ""')
    fs.writeFileSync(poster, Buffer.from(posterB64, 'base64'))
    const meta = await evalJS('JSON.stringify(window.__recorderMeta || {})')
    console.log(`  ✓ ${device}/${id}.mp4 ${(fs.statSync(mp4).size / 1024 / 1024).toFixed(2)} MB · 封面 ${(fs.statSync(poster).size / 1024).toFixed(0)} KB · ${meta}`)
  }

  chrome.kill()
  server.close()
  console.log('\n完成，产物在 public/tutorials/desktop 与 public/tutorials/mobile')
  process.exit(0)
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1) })
