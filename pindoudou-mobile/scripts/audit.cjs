/* =========================================================================
   无头浏览器自检脚本（开发用，不进构建产物）
   用途：起一个静态服务 + Chrome DevTools Protocol，把每个路由真实渲染一遍，
        收集 console 错误 / 未捕获异常 / 页面尺寸，并输出截图。
   为什么需要它：单元测试无法发现「画布空白」「底栏被挤到视口外」这类问题。
   用法：
     node scripts/audit.cjs                 # 检查默认页面集
     node scripts/audit.cjs /create /library
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
/* 本机 Windows 的系统临时目录（AppData\Local）权限受限，mkdtemp 会 EPERM。
   自检报告和 Chrome profile 统一放到仓库内的 .tmp/（已 gitignore），
   需要换位置时用 AUDIT_OUT / AUDIT_TMP 覆盖。 */
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
fs.mkdirSync(TMP_ROOT, { recursive: true })
const OUT = process.env.AUDIT_OUT || path.join(TMP_ROOT, 'douzao-audit')
const PORT = Number(process.env.AUDIT_PORT || 4299)
/* CDP 单条命令的超时。默认 30 秒对绝大多数页面够用（超时说明页面卡死了），
   但 1000×1000（100 万格）的画布自检里，一次 Runtime.evaluate 要同步跑完
   「生成 3 个方案」或「存一次 100 万格的作品」，那是分钟级的：
   AUDIT_CDP_TIMEOUT_MS=240000 显式放开，别把这道超时改大 ——
   它同时也是「页面真的卡住了」的唯一信号。 */
const CDP_TIMEOUT_MS = Number(process.env.AUDIT_CDP_TIMEOUT_MS || 30000)

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
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
}

const PAGES = [
  { name: 'home', hash: '#/' },
  // /create 现在是 /editor 的跳转别名：这一项同时验证「老链接还能用」
  // 和「跳过去落在创建步骤上」两件事
  { name: 'createAlias', hash: '#/create' },
  { name: 'library', hash: '#/library' },
  { name: 'editor', hash: '#/editor' },
  // ?tab= 是外链能用到的那种深链（「免费素材库」直接指到左栏那个入口），
  // 单独列一项，顺便留一张「侧栏停在素材库」的截图
  { name: 'editorLibraryTab', hash: '#/editor?tab=library' },
  { name: 'editorProject', hash: '#/editor/p_audit_fixture' },
  { name: 'account', hash: '#/account' },
  { name: 'settings', hash: '#/settings' },
  { name: 'help', hash: '#/help' },
  { name: 'projects', hash: '#/projects' },
  { name: 'projectDetail', hash: '#/projects/p_audit_fixture' },
  { name: 'inventory', hash: '#/inventory' },
  { name: 'materials', hash: '#/materials/p_audit_fixture' },
  { name: 'build', hash: '#/build/p_audit_fixture' },
  /* 第三步「完成」的两个关键状态：
     - buildFinish：完成弹窗（?finish=1 是工作台「我已经拼完了」的落点）
     - buildDone / projectDone：真完成过一件作品之后的页面（庆祝块、完成卡片） */
  { name: 'buildFinish', hash: '#/build/p_audit_fixture?finish=1' },
  { name: 'buildDone', hash: '#/build/p_audit_done' },
  { name: 'projectDone', hash: '#/projects/p_audit_done' },
  { name: 'tool', hash: '#/tools/perler-bead-pattern-maker' },
  { name: 'assetDetail', hash: '#/library/a1f8ajij' },
  { name: 'notfound', hash: '#/definitely-not-a-page' }
]

const WIDTHS = [
  { name: 'desktop', w: 1440, h: 1000 },
  /* 三栏掉两栏的分界（.studio 的 max-width:1319px 断点）两侧各取一个宽度。
     版面在断点附近坏过两次（列宽不够 / 锁高把内容裁掉），只测 1440 发现不了。 */
  { name: 'narrow3col', w: 1320, h: 900 },
  { name: 'tablet', w: 834, h: 1100 },
  { name: 'mobile', w: 390, h: 844 }
]

/* 只跑指定视口：AUDIT_WIDTHS=desktop,tablet
   为什么需要：1000×1000 的画布探针要在每个视口里真生成三个方案（每个约 1.5 秒），
   四个视口跑一遍要几分钟；只想复核某一档数字时不必每次全跑。默认仍然是全部视口 ——
   版面回归的价值就在"四种宽度都过一遍"。 */
const WANTED_WIDTHS = (process.env.AUDIT_WIDTHS || '').split(',').map(s => s.trim()).filter(Boolean)
const AUDIT_WIDTHS = WANTED_WIDTHS.length ? WIDTHS.filter(v => WANTED_WIDTHS.includes(v.name)) : WIDTHS

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * dist 新鲜度检查。
 * 为什么必须做：这个脚本跑的是 dist/，如果忘了 vite build，测的就是旧代码，
 * 会得出完全错误的结论（本项目已经因此误判过一次「图案还是空白」）。
 */
function newestMtime(dir, filter, skip = new Set()) {
  let newest = 0
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (filter(p)) newest = Math.max(newest, fs.statSync(p).mtimeMs)
    }
  }
  walk(dir)
  return newest
}

function assertFresh() {
  const srcNewest = Math.max(
    newestMtime(path.join(ROOT, 'src'), p => /\.(js|vue|css)$/.test(p)),
    fs.statSync(path.join(ROOT, 'index.html')).mtimeMs,
    fs.statSync(path.join(ROOT, 'vite.config.js')).mtimeMs
  )
  const distDir = path.join(DIST, 'assets')
  const distNewest = fs.existsSync(distDir) ? newestMtime(distDir, () => true) : 0
  if (distNewest >= srcNewest) return true
  const behind = ((srcNewest - distNewest) / 1000).toFixed(1)
  const msg = `dist 比源码旧 ${behind}s，请先运行 vite build（否则自检结果无效）`
  if (process.argv.includes('--allow-stale')) {
    console.log('⚠️  ' + msg)
    return true
  }
  console.error('✗ ' + msg)
  return false
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
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
      res.end(fs.readFileSync(file))
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

/** 极简 CDP 客户端：只用 WebSocket，不引第三方依赖 */
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.events = []
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', e => reject(new Error('CDP 连接失败')))
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
      }, CDP_TIMEOUT_MS)
    })
  }

  close() {
    try { this.ws.close() } catch { /* ignore */ }
  }
}

async function fetchJSON(url) {
  const res = await fetch(url)
  return res.json()
}

async function main() {
  // --setup-file <path>：在页面加载前注入一段脚本（可 await）。
  // 用来预置 localStorage 里的作品，从而在无头环境里验证「编辑器/材料/建造」
  // 这些需要真实图案才能渲染的页面，而不是只看空状态。
  const argv = process.argv.slice(2)
  let evalFile = null
  let setupFile = null
  /* --url <base>：不自己起静态服务器，直接审一个已经跑着的实例
     （本地 preview、部署后的 nginx 都行）。用于确认「用户看到的那个地址
     到底有没有生效」——这是排查"改了代码但页面上没有"最直接的一步。 */
  let externalBase = null
  const urlIdx = argv.indexOf('--url')
  if (urlIdx >= 0) {
    externalBase = String(argv[urlIdx + 1] || '').replace(/\/+$/, '')
    argv.splice(urlIdx, 2)
  }
  const evalIdx = argv.indexOf('--eval-file')
  if (evalIdx >= 0) {
    evalFile = argv[evalIdx + 1]
    argv.splice(evalIdx, 2)
  }
  const setupIdx = argv.indexOf('--setup-file')
  if (setupIdx >= 0) {
    setupFile = argv[setupIdx + 1]
    argv.splice(setupIdx, 2)
  }
  const probeExpr = evalFile ? fs.readFileSync(evalFile, 'utf8') : null
  let setupExpr = setupFile ? fs.readFileSync(setupFile, 'utf8') : null
  // --pro / AUDIT_PRO=1：把当前身份切成 Pro，用来验证被权益挡住的那部分界面
  // （Build Mode、完整 613 色板、SVG/CSV 导出…）在解锁后确实能正常渲染。
  if (setupExpr && process.env.AUDIT_PRO === '1') {
    setupExpr = 'window.__AUDIT_PRO = 1;\n' + setupExpr
  }

  const wanted = argv.filter(a => a.startsWith('/'))
  /* --page <name>：按 PAGES 里的 name 精确选页。位置参数是按 hash「包含」匹配的，
     '/editor' 会连带选中 editorLibraryTab / editorProject，探针只想要一页时得能精确点 */
  let pageNames = null
  const pageIdx = argv.indexOf('--page')
  if (pageIdx >= 0) {
    pageNames = String(argv[pageIdx + 1] || '').split(',').map(s => s.trim()).filter(Boolean)
    argv.splice(pageIdx, 2)
    const unknown = pageNames.filter(n => !PAGES.some(p => p.name === n))
    if (unknown.length) {
      console.error(`--page 里有不存在的页面: ${unknown.join(', ')}`)
      process.exit(1)
    }
  }
  const pages = pageNames && pageNames.length
    ? PAGES.filter(p => pageNames.includes(p.name))
    : (wanted.length
      ? PAGES.filter(p => wanted.some(w => p.hash.includes(w.replace(/^\//, ''))))
      : PAGES)

  const origin = externalBase || `http://127.0.0.1:${PORT}`
  if (!externalBase) {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      console.error('dist/index.html 不存在，请先运行 vite build')
      process.exit(1)
    }
    if (!assertFresh()) process.exit(1)
  } else {
    console.log(`审核外部实例: ${origin}（跳过 dist 新鲜度检查）`)
  }
  fs.mkdirSync(OUT, { recursive: true })

  const server = externalBase ? null : await staticServer()
  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    process.exit(1)
  }

  // Chrome 用户数据目录也放在仓库内的 .tmp/：系统临时目录在本机不可写
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'douzao-chrome-'))
  const debugPort = 9222 + (process.pid % 500)
  const args = [
    '--headless=new',
    '--disable-gpu',
    /* 本机 Windows 的 Chrome 在 Node 子进程里启动时，沙箱会让进程以
       STATUS_BREAKPOINT 直接退出（手动 Start-Process 不受影响）。
       自检是无头只读的本地页面，关掉沙箱即可稳定启动。 */
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crashpad',
    '--disable-breakpad',
    '--disable-features=Translate,MediaRouter',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ]
  const chrome = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let chromeErr = ''
  chrome.stderr.on('data', d => { chromeErr += d.toString() })

  // 等调试端口起来
  let version = null
  for (let i = 0; i < 60; i++) {
    try {
      version = await fetchJSON(`http://127.0.0.1:${debugPort}/json/version`)
      break
    } catch {
      await sleep(250)
    }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪\n' + chromeErr)
    chrome.kill()
    server && server.close()
    process.exit(1)
  }
  console.log('Chrome:', version['Browser'])

  const report = { generatedAt: new Date().toISOString(), browser: version['Browser'], pages: [] }

  // 用浏览器级会话创建/关闭 target —— 新版 Chrome 的 /json/new 只接受 PUT，
  // 直接走 CDP 更稳，也不需要额外的 HTTP 往返
  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready

  let fixtureId = 'p_audit_fixture'
  let fixtureDoneId = 'p_audit_done'
  for (const vp of AUDIT_WIDTHS) {
    // 预置脚本每个视口只跑一次就够了：localStorage 在同 profile 的 target 之间共享，
    // 脚本自身会清空并重建存档，所以结果是确定的（跑 16 次纯属浪费）
    if (setupExpr) {
      const setupTarget = await browser.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId: setupSession } = await browser.send('Target.attachToTarget', { targetId: setupTarget.targetId, flatten: true })
      const setupSend = (m, p) => browser.send(m, p, setupSession)
      await setupSend('Page.enable')
      await setupSend('Runtime.enable')
      await setupSend('Page.navigate', { url: `${origin}/#/` })
      // 等调试桥就绪：SPA 挂载 + 动态 import 需要时间，固定 sleep 容易抢跑
      const waitBridge = () => setupSend('Runtime.evaluate', {
        expression: `new Promise(res => {
          const t0 = Date.now()
          const tick = () => (window.__douzao ? res(true) : (Date.now() - t0 > 8000 ? res(false) : setTimeout(tick, 100)))
          tick()
        })`,
        awaitPromise: true, returnByValue: true
      }).catch(() => {})
      await waitBridge()

      /* 先清空存档，再「重新导航一次」。
         为什么必须重载：各 store 是在模块加载时把 localStorage 读进内存的，
         只 removeItem 的话内存里那份旧数据还在，作品 id 会被复用、
         免费套餐的项目配额也会算错，后续页面就装载不出图案。 */
      await setupSend('Runtime.evaluate', {
        expression: `(() => {
          const keys = []
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && k.startsWith('douzao-')) keys.push(k)
          }
          keys.forEach(k => localStorage.removeItem(k))
          return keys
        })()`,
        returnByValue: true
      }).catch(() => {})
      await setupSend('Page.reload', { ignoreCache: true })
      await waitBridge()
      await sleep(300)

      try {
        const sr = await setupSend('Runtime.evaluate', { expression: setupExpr, awaitPromise: true, returnByValue: true })
        const sv = sr.result?.value
        if (sv && sv.projectId) fixtureId = sv.projectId
        if (sv && sv.finishedId) fixtureDoneId = sv.finishedId
        console.log(`  ↳ setup@${vp.name}:`, JSON.stringify(sv ?? sr.result?.description ?? sr.result))
      } catch (e) {
        console.log(`  ↳ setup@${vp.name} 失败:`, e.message)
      }
      await browser.send('Target.closeTarget', { targetId: setupTarget.targetId }).catch(() => {})
    }

    for (const page of pages) {

      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })

      const send = (m, p) => browser.send(m, p, sessionId)
      const errors = []
      const warnings = []

      browser.ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data)
        if (msg.sessionId && msg.sessionId !== sessionId) return
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = (msg.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')
          if (msg.params.type === 'error') errors.push('console.error: ' + text)
          else if (msg.params.type === 'warning') warnings.push('console.warn: ' + text)
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails
          errors.push('exception: ' + (d.exception?.description || d.text))
        }
        if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
          errors.push('log: ' + msg.params.entry.text)
        }
      })

      await send('Runtime.enable')
      await send('Log.enable')
      await send('Page.enable')
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.name === 'mobile'
      })

      const url = `${origin}/${page.hash.replace('p_audit_fixture', fixtureId).replace('p_audit_done', fixtureDoneId)}`
      await send('Page.navigate', { url })
      await sleep(3200)
      // 再等两帧：canvas 的像素读取需要绘制提交完成，
      // 否则会把「已经画好」的图误判成空白画布，产生假告警
      await send('Runtime.evaluate', {
        expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
        awaitPromise: true
      }).catch(() => {})

      const probe = await send('Runtime.evaluate', {
        expression: `(() => {
          const de = document.documentElement;
          const q = s => document.querySelector(s);
          const paint = fn => { try { return fn() } catch (e) { return 'ERR:' + e.message } };
          const canvases = [...document.querySelectorAll('canvas')].map(c => ({
            w: c.width, h: c.height,
            cssW: c.style.width, cssH: c.style.height,
            nonBlank: paint(() => {
              const ctx = c.getContext('2d');
              if (!ctx || !c.width || !c.height) return false;
              const step = Math.max(1, Math.floor(Math.min(c.width, c.height) / 40));
              let seen = 0;
              for (let y = 0; y < c.height; y += step) {
                for (let x = 0; x < c.width; x += step) {
                  const d = ctx.getImageData(x, y, 1, 1).data;
                  if (d[3] > 0 && !(d[0] > 250 && d[1] > 250 && d[2] > 250)) seen++;
                }
              }
              return seen > 3;
            })
          }));
          const footer = q('.canvasCard__foot');
          const card = q('.canvasCard');
          /* 色板色块去重计数：色板解析一旦出错（例如色值全黑），
             所有色块会渲染成同一种颜色，这个数字会掉到 1 —— 直接兜住这类回归 */
          const swatches = [...document.querySelectorAll('.pick, .swatch, [class*="swatch"]')];
          const swatchColors = new Set(swatches.map(e => getComputedStyle(e).backgroundColor));
          const painted = canvases.filter(c => c.nonBlank === true).length;
          return {
            title: document.title,
            route: location.hash,
            docW: de.scrollWidth,
            docH: de.scrollHeight,
            winW: innerWidth,
            winH: innerHeight,
            overflowX: de.scrollWidth > innerWidth + 2,
            topbarH: q('.topbar') ? Math.round(q('.topbar').getBoundingClientRect().height) : 0,
            canvasCardH: card ? Math.round(card.getBoundingClientRect().height) : 0,
            canvasCardBottom: card ? Math.round(card.getBoundingClientRect().bottom) : 0,
            footerInView: footer ? footer.getBoundingClientRect().bottom <= innerHeight + 2 : true,
            footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : 0,
            /* 卡片底部超出视口说明底栏被顶出去了；
               整页截图会 captureBeyondViewport，所以不能用 docH 判断 */
            cardOverflowsViewport: card ? card.getBoundingClientRect().bottom > innerHeight + 2 : false,
            /* 舞台内部出现滚动条 = 图纸没适配好（画布把舞台顶出去了），
               留给 2px 余量避免四舍五入误报 */
            stageScrollOverflow: (() => {
              const st = q('.stage')
              return st ? st.scrollHeight > st.clientHeight + 2 : false
            })(),
            canvasCount: canvases.length,
            canvasesPainted: painted,
            canvases: canvases.slice(0, 8),
            swatchCount: swatches.length,
            swatchDistinct: swatchColors.size,
            h1: q('h1') ? q('h1').textContent.trim() : '',
            bodyTextLen: document.body.innerText.length,
            tabbarVisible: q('.tabbar') ? getComputedStyle(q('.tabbar')).display !== 'none' : false,
            cardCount: document.querySelectorAll('.card').length,
            assetCards: document.querySelectorAll('.assetCard').length,
            emptyStates: document.querySelectorAll('.empty').length
          };
        })()`,
        returnByValue: true
      })

      let screenshotOk = false
      try {
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
          // 整页截图会把 position:sticky 的列重复渲染在滚动位置上，
          // 看起来像「底栏插进内容中间」。要判断真实版式必须看视口截图。
          captureBeyondViewport: process.env.AUDIT_VIEWPORT_ONLY !== '1'
        })
        fs.writeFileSync(path.join(OUT, `${page.name}-${vp.name}.png`), Buffer.from(shot.data, 'base64'))
        screenshotOk = true
      } catch (e) {
        errors.push('screenshot: ' + e.message)
      }

      const value = probe.result.value || {}
      if (probeExpr) {
        try {
          const extra = await send('Runtime.evaluate', { expression: probeExpr, returnByValue: true, awaitPromise: true })
          console.log(`  ↳ probe[${page.name}@${vp.name}]:`, JSON.stringify(extra.result?.value ?? extra.result))
        } catch (e) {
          console.log(`  ↳ probe[${page.name}@${vp.name}] 失败:`, e.message)
        }
      }

      /* 截图默认在探针**之前**（探针可能改了页面状态，比如点开某个浮层）。
         要看「点开之后长什么样」时用 AUDIT_SHOT_AFTER_PROBE=1 再补一张，
         文件名带 -probe 后缀，不会覆盖上面那张干净的截图。 */
      if (probeExpr && process.env.AUDIT_SHOT_AFTER_PROBE === '1') {
        try {
          const shot = await send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: process.env.AUDIT_VIEWPORT_ONLY !== '1'
          })
          fs.writeFileSync(path.join(OUT, `${page.name}-${vp.name}-probe.png`), Buffer.from(shot.data, 'base64'))
          console.log(`  ↳ 探针后截图: ${path.join(OUT, `${page.name}-${vp.name}-probe.png`)}`)
        } catch (e) {
          console.log(`  ↳ 探针后截图失败: ${e.message}`)
        }
      }
      report.pages.push({
        page: page.name,
        viewport: vp.name,
        width: vp.w,
        url,
        screenshot: screenshotOk ? path.join(OUT, `${page.name}-${vp.name}.png`) : null,
        errors,
        warnings: warnings.slice(0, 6),
        ...value
      })
      console.log(`${page.name}@${vp.name}: errors=${errors.length} overflowX=${value.overflowX} canvases=${value.canvasCount}`)

      await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    }
  }

  const reportPath = path.join(OUT, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  // 汇总
  const allErrors = report.pages.filter(p => p.errors.length)
  const overflow = report.pages.filter(p => p.overflowX)
  const blankCanvas = report.pages.flatMap(p => (p.canvases || []).filter(c => c.w > 0 && c.nonBlank === false).map(c => `${p.page}@${p.viewport}`))

  console.log('\n===== 自检汇总 =====')
  console.log('页面数:', report.pages.length)
  console.log('有错误的页面:', allErrors.length)
  for (const p of allErrors) {
    console.log(`  [${p.page}@${p.viewport}]`)
    for (const e of [...new Set(p.errors)]) console.log('    ' + e.split('\n')[0].slice(0, 240))
  }
  console.log('横向溢出:', overflow.length ? [...new Set(overflow.map(p => p.page + '@' + p.viewport))].join(', ') : '无')
  console.log('画布空白:', blankCanvas.length ? [...new Set(blankCanvas)].join(', ') : '无')
  // 色板渲染回归：色块数量多但颜色只有 1 种，说明色板数据没解析出来
  const flatPalette = report.pages.filter(p => p.swatchCount > 5 && p.swatchDistinct <= 1)
  console.log('色板只有单一颜色:', flatPalette.length ? [...new Set(flatPalette.map(p => p.page + '@' + p.viewport))].join(', ') : '无')
  /* 工作台是「画布锁一屏、左右两栏各自滚」的版面（>1319px）：
     整页不该被内容顶高，画布卡也不该超出视口 —— 这正是「调参数时图纸
     一直看得见」的前提。曾经因为漏掉 align-items:stretch，左栏 2000px 的内容
     把整个 grid 行顶高，画布卡跟着被拉到 983px、底栏导出条被挤出视口。 */
  const studioOverflow = report.pages.filter(p =>
    /^editor/.test(p.page) && p.width > 1319 && p.canvasCardH > 0 && p.cardOverflowsViewport
  )
  console.log('编辑器画布卡超出视口:', studioOverflow.length
    ? [...new Set(studioOverflow.map(p => p.page + '@' + p.viewport + ' ' + p.canvasCardBottom + 'px'))].join(', ')
    : '无')
  /* 舞台内部不该出现滚动条：出现说明缩放没适配好，图纸会被裁掉一角 */
  const stageScroll = report.pages.filter(p => /^editor/.test(p.page) && p.stageScrollOverflow)
  console.log('画布舞台内部溢出:', stageScroll.length
    ? [...new Set(stageScroll.map(p => p.page + '@' + p.viewport))].join(', ')
    : '无')
  console.log('报告:', reportPath)
  console.log('截图目录:', OUT)

  chrome.kill()
  server && server.close()
  await sleep(300)
  process.exit(allErrors.length || overflow.length || blankCanvas.length || flatPalette.length || studioOverflow.length || stageScroll.length ? 2 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
