/* =========================================================================
   新手简化版（操作台）验收脚本（开发用，不进构建产物）
   -------------------------------------------------------------------------
   干什么：把「首页 → 操作台 → 选图 → 调效果 → 拿图纸 → 切专业 → 切回新手」
   这条链路在**手机 / 平板 / 电脑**三档视口下真跑一遍，
   每一���都检查：步骤是否真的切换了、数据是不是真实算出来的、
   有没有 console 报错、会不会横向溢出，并留下截图。

   为什么不用现成的 audit.cjs：audit 扫的是「每个路由渲染出来对不对」，
   而新手版的验收点是**交互链路**（点上传 → 出确认页 → 生成图纸 → 导出），
   必须真的点一遍才知道。

   用法：
     node scripts/verify-beginner.cjs
     node scripts/verify-beginner.cjs --url https://dw.sharyuke.com
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
fs.mkdirSync(TMP_ROOT, { recursive: true })
const OUT = process.env.VERIFY_OUT || path.join(TMP_ROOT, 'beginner-verify')
const PORT = Number(process.env.VERIFY_PORT || 4311)
const CDP_TIMEOUT_MS = Number(process.env.VERIFY_CDP_TIMEOUT_MS || 60000)

/* 上传用的真实照片（仓库内的评测图，不联网） */
const FIXTURE = path.join(ROOT, 'scripts', 'fidelity', 'fixtures', 'photo_pumpkin.png')

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

const ALL_VIEWPORTS = [
  /* 手机三档（低 / 中 / 高），再加平板与电脑 —— 一屏工作台必须三档都成立 */
  { name: 'mobile-s', w: 360, h: 640, mobile: true },
  { name: 'mobile', w: 390, h: 844, mobile: true },
  { name: 'mobile-l', w: 430, h: 932, mobile: true },
  { name: 'tablet', w: 834, h: 1112, mobile: true },
  { name: 'desktop', w: 1440, h: 900, mobile: false }
]

/* 调试时只跑某几档：VERIFY_VIEWPORTS=mobile-s,mobile */
const ONLY_VIEWPORTS = String(process.env.VERIFY_VIEWPORTS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const VIEWPORTS = ONLY_VIEWPORTS.length
  ? ALL_VIEWPORTS.filter(v => ONLY_VIEWPORTS.includes(v.name))
  : ALL_VIEWPORTS

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

/** 极简 CDP 客户端（与 audit.cjs 同一套：只用 WebSocket，不引第三方依赖） */
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

  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function fetchJSON(url) {
  const res = await fetch(url)
  return res.json()
}

/** 在页面里跑一段表达式，返回值 */
async function evaluate(send, expression, { awaitPromise = false } = {}) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  }
  return r.result?.value
}

/** 等页面里出现某个元素。首次打开（冷启动、要下载 bundle）与生成图纸都比固定
    sleep 慢，固定等待会把「机器慢」误报成「功能坏」，所以这里等就绪再断言。 */
async function waitFor(send, expression, { timeout = 15000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(send, expression)) return true
    await sleep(interval)
  }
  return false
}

/** 点一个元素（用文本找按钮，失败时抛出，脚本好定位问题） */
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

/** 只点「看得见的」那个：手机端同一个操作有两个入口（页面里的 + 底部常驻条），
    自检要按真人那样点可见的那个。 */
async function clickVisibleByText(send, selector, text) {
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
  if (!ok) throw new Error(`找不到可见可点的「${text}」（${selector}）`)
  return true
}

async function shot(send, name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  if (!r || !r.data) return false
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  return true
}

/** 把本地文件塞进 <input type=file>（会触发 change 事件） */
async function attachFile(send, file, selector = 'input[type=file]') {
  const { root } = await send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
  if (!nodeId) throw new Error(`页面上找不到 ${selector}`)
  await send('DOM.setFileInputFiles', { files: [file], nodeId })
}

async function main() {
  const argv = process.argv.slice(2)
  const urlIdx = argv.indexOf('--url')
  const externalBase = urlIdx >= 0 ? String(argv[urlIdx + 1] || '').replace(/\/+$/, '') : null
  if (urlIdx >= 0) argv.splice(urlIdx, 2)

  if (!externalBase && !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/index.html 不存在，请先运行 pnpm build')
    process.exit(1)
  }
  if (!fs.existsSync(FIXTURE)) {
    console.error(`缺少测试用图片：${FIXTURE}`)
    process.exit(1)
  }
  fs.mkdirSync(OUT, { recursive: true })

  const origin = externalBase || `http://127.0.0.1:${PORT}`
  const server = externalBase ? null : await staticServer()
  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    server && server.close()
    process.exit(1)
  }

  const debugPort = 9222 + (process.pid % 500)
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'beginner-chrome-'))
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
  let chromeErr = ''
  chrome.stderr.on('data', d => { chromeErr += d.toString() })

  let version = null
  for (let i = 0; i < 60; i++) {
    try { version = await fetchJSON(`http://127.0.0.1:${debugPort}/json/version`); break } catch { await sleep(250) }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪\n' + chromeErr)
    chrome.kill()
    server && server.close()
    process.exit(1)
  }

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready

  const results = []
  let failed = 0

  for (const vp of VIEWPORTS) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const send = (m, p) => browser.send(m, p, sessionId)
    /* 手机断点（≤780px）才是一屏工作台那套版面 */
    const narrow = vp.w <= 780
    const errors = []
    browser.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.sessionId && msg.sessionId !== sessionId) return
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console.error: ' + (msg.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' '))
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        errors.push('exception: ' + (d.exception?.description || d.text))
      }
    })

    await send('Runtime.enable')
    await send('Page.enable')
    await send('DOM.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile
    })

    const steps = []
    const step = (name, ok, detail) => {
      steps.push({ name, ok, detail })
      if (!ok) failed++
      console.log(`  ${ok ? '✓' : '✗'} ${vp.name} · ${name}${detail ? ' — ' + detail : ''}`)
    }

    try {
      /* ---------------------------------------------- ① 首页是主视觉，操作台是新手版 */
      await send('Page.navigate', { url: `${origin}/` })
      await waitFor(send, `!!document.querySelector('.homeHero') && !!document.querySelector('.uploadCard')`)
      await sleep(200)
      const landing = await evaluate(send, `(() => ({
        path: location.pathname,
        hero: !!document.querySelector('.homeHero'),
        titleArt: !!document.querySelector('.homeTitleArt'),
        uploadCard: !!document.querySelector('.uploadCard'),
        wizard: !!document.querySelector('.bwiz'),
        content: !!document.querySelector('.homeContent'),
        siteFooter: !!document.querySelector('footer.footer'),
        pickHref: (document.querySelector('.uploadCard__btn') || {}).getAttribute
          ? document.querySelector('.uploadCard__btn').getAttribute('href') : '',
        freeHref: (document.querySelector('.uploadCard__free') || {}).getAttribute
          ? document.querySelector('.uploadCard__free').getAttribute('href') : '',
        overflowX: document.documentElement.scrollWidth > innerWidth + 2
      }))()`)
      step('首页是带插画的主视觉', landing.path === '/' && landing.hero && landing.titleArt && landing.uploadCard,
        `路径 ${landing.path} · 标题图 ${landing.titleArt ? '有' : '无'} · 上传卡 ${landing.uploadCard ? '有' : '无'}`)
      step('首页不再放新手向导', !landing.wizard)
      step('首页首屏以下没有长文内容区', !landing.content)
      step('首页有站点页脚（操作台底部那条挪过来了）', landing.siteFooter)
      step('首页「选择图片」进的是新手版（操作台）', landing.pickHref === '/create', 'href=' + landing.pickHref)
      step('首页「从免费素材开始」进的是操作台的素材栏', landing.freeHref === '/create?tab=library', 'href=' + landing.freeHref)
      step('首页无横向溢出', !landing.overflowX)

      await send('Page.navigate', { url: `${origin}/create` })
      await waitFor(send, `!!document.querySelector('.bwiz')`)
      await evaluate(send, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', { awaitPromise: true })

      const home = await evaluate(send, `(() => ({
        path: location.pathname,
        wizard: !!document.querySelector('.bwiz'),
        step1on: !!document.querySelector('.bwiz__step.on'),
        stepTitle: document.querySelector('.bwiz__title')?.textContent.trim() || '',
        modeSwitch: !!document.querySelector('.modeSwitch'),
        siteFooter: !!document.querySelector('footer.footer'),
        overflowX: document.documentElement.scrollWidth > innerWidth + 2,
        h1: document.querySelector('h1')?.textContent.trim() || ''
      }))()`)
      step('操作台打开就是新手三步', home.path === '/create' && home.wizard && home.step1on, `路径 ${home.path} · ${home.stepTitle}`)
      step('顶栏有模式切换入口', home.modeSwitch)
      step('操作台底部不挂站点页脚（工具页）', !home.siteFooter)
      step('操作台无横向溢出', !home.overflowX)
      step('操作台有 H1（SEO）', !!home.h1, home.h1)
      await shot(send, `${vp.name}-1-select`)

      /* ---------------------------------------------- ①' 手机端：一屏工作台 */
      if (narrow) {
        const one = await evaluate(send, `(() => {
          const r = el => el ? el.getBoundingClientRect() : null
          const steps = r(document.querySelector('.bwiz__steps'))
          const panel = r(document.querySelector('.bwiz__panel'))
          const tab = r(document.querySelector('.tabbar'))
          return {
            docH: document.documentElement.scrollHeight,
            winH: innerHeight,
            scrollable: document.documentElement.scrollHeight > innerHeight + 2,
            stepsTop: steps ? Math.round(steps.top) : -1,
            stepsBottom: steps ? Math.round(steps.bottom) : -1,
            panelBottom: panel ? Math.round(panel.bottom) : -1,
            tabTop: tab ? Math.round(tab.top) : -1,
            tabBottom: tab ? Math.round(tab.bottom) : -1
          }
        })()`)
        step('手机端整页不滚动（一屏工作台）', !one.scrollable,
          `文档高 ${one.docH} / 视口 ${one.winH}`)
        step('手机端步骤条在视口内', one.stepsTop >= 0 && one.stepsBottom <= one.winH,
          `步骤条 ${one.stepsTop}~${one.stepsBottom}`)
        step('手机端底部标签栏在视口内', one.tabTop >= 0 && one.tabBottom <= one.winH + 1,
          `标签栏 ${one.tabTop}~${one.tabBottom}`)

        /* 键盘弹起：visualViewport 变矮 → --kb 写进 CSS 变量 → 容器跟着让出高度。
           无头浏览器没有真键盘，这里把 visualViewport.height 压低 300px 再派发 resize，
           走的是页面里那套真实的监听逻辑。 */
        const kb = await evaluate(send, `(() => {
          const box = document.querySelector('.bview')
          if (!box || !window.visualViewport) return null
          const before = Math.round(box.getBoundingClientRect().height)
          const vv = window.visualViewport
          const proto = Object.getPrototypeOf(vv)
          const desc = Object.getOwnPropertyDescriptor(proto, 'height')
          const own = Object.getOwnPropertyDescriptor(vv, 'height')
          const fake = (base) => Object.defineProperty(vv, 'height', {
            configurable: true, get: () => base - 300
          })
          fake(vv.height)
          vv.dispatchEvent(new Event('resize'))
          const kbVar = getComputedStyle(document.documentElement).getPropertyValue('--kb').trim()
          const after = Math.round(box.getBoundingClientRect().height)
          /* 还原：先删掉实例上的自有属性，再把原型上的原始描述装回去 */
          delete vv.height
          if (own) Object.defineProperty(vv, 'height', own)
          else if (desc) Object.defineProperty(proto, 'height', desc)
          vv.dispatchEvent(new Event('resize'))
          const restored = Math.round(box.getBoundingClientRect().height)
          return { before, after, restored, kbVar }
        })()`)
        if (kb) {
          step('手机端键盘弹起时容器让出高度（--kb 生效）',
            Math.abs(kb.before - kb.after - 300) <= 2 && parseFloat(kb.kbVar) >= 299,
            `容器 ${kb.before} → ${kb.after}px（--kb ${kb.kbVar}）`)
          step('手机端键盘收起后容器复原',
            Math.abs(kb.restored - kb.before) <= 2, `容器复原到 ${kb.restored}px`)
        } else {
          step('手机端键盘弹起时容器让出高度（--kb 生效）', false, '拿不到 .bview 或 visualViewport')
        }
      }

      /* ---------------------------------------------- ② 上传图片 → 确认页 */
      await attachFile(send, FIXTURE, '.bsel__file')
      await waitFor(send, `!!document.querySelector('.bsel__confirm')`)
      const confirmVisible = await evaluate(send, `!!document.querySelector('.bsel__confirm')`)
      step('选图后进入「图片已选好」确认页', confirmVisible)
      await shot(send, `${vp.name}-2-confirm`)

      /* ---------------------------------------------- ③ 确认 → 生成图纸 → 第 ② 步 */
      await clickByText(send, '.bsel__confirmBtns .btn', '下一步')
      await waitFor(send, `document.querySelector('.bwiz__step.on b')?.textContent.trim() === '调整效果'
        && !!document.querySelector('.badj__canvasBox canvas')`, { timeout: 25000 })
      await sleep(300)
      const adjust = await evaluate(send, `(() => ({
        on: document.querySelector('.bwiz__step.on b')?.textContent.trim() || '',
        hasCanvas: !!document.querySelector('.badj__canvasBox canvas'),
        stats: [...document.querySelectorAll('.badj__stats dd')].map(e => e.textContent.trim()),
        exact: document.querySelector('.badj__exact')?.textContent.trim() || '',
        overflowX: document.documentElement.scrollWidth > innerWidth + 2
      }))()`)
      step('第 ② 步打开且画出了图纸', adjust.on === '调整效果' && adjust.hasCanvas, `画布 ${adjust.hasCanvas ? '有' : '无'}`)
      step('第 ② 步数据是真实值', adjust.stats.length === 4 && adjust.stats.every(v => v && v !== '0'), adjust.stats.join(' / '))
      step('第 ② 步无横向溢出', !adjust.overflowX)

      /* 预览图占整块预览区的比例：电脑/平板要撑满，手机维持原来的小图 */
      const preview = await evaluate(send, `(() => {
        const box = document.querySelector('.badj__canvasBox')
        const cv = document.querySelector('.badj__canvasBox canvas')
        if (!box || !cv) return null
        const bs = getComputedStyle(box)
        const b = box.getBoundingClientRect()
        const c = cv.getBoundingClientRect()
        const innerH = b.height - parseFloat(bs.paddingTop) - parseFloat(bs.paddingBottom)
        const innerW = b.width - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight)
        return {
          innerW: Math.round(innerW), innerH: Math.round(innerH),
          cvW: Math.round(c.width), cvH: Math.round(c.height),
          hShare: innerH ? c.height / innerH : 0,
          wShare: innerW ? c.width / innerW : 0,
          area: innerW * innerH ? (c.width * c.height) / (innerW * innerH) : 0,
          wide: innerWidth >= 781
        }
      })()`)
      if (preview && preview.wide) {
        step('电脑/平板：预览图撑满预览区高度',
          preview.hShare >= 0.85,
          `画布 ${preview.cvW}×${preview.cvH} / 预览区 ${preview.innerW}×${preview.innerH} · 高占 ${(preview.hShare * 100).toFixed(0)}% · 宽占 ${(preview.wShare * 100).toFixed(0)}% · 面积占 ${(preview.area * 100).toFixed(0)}%`)
        step('电脑/平板：预览图不再是预览区里的一小块',
          preview.area >= 0.4,
          `面积占 ${(preview.area * 100).toFixed(0)}%`)
      } else if (preview) {
        step('手机：预览区维持原来的高度上限',
          preview.cvH <= Math.round(preview.innerH * 1.05),
          `画布 ${preview.cvW}×${preview.cvH} / 预览区 ${preview.innerW}×${preview.innerH}`)
      }
      await shot(send, `${vp.name}-3-adjust`)

      /* ---------------------------------------------- ③' 手机端第 ② 步：一屏 + 画布 */
      if (narrow) {
        const adj = await evaluate(send, `(() => {
          const r = el => el ? el.getBoundingClientRect() : null
          const box = r(document.querySelector('.badj__canvasBox'))
          const cv = r(document.querySelector('.badj__canvasBox canvas'))
          const rich = r(document.querySelector('.badj__rich'))
          const params = document.querySelector('.badj__params')
          const paramsBox = r(params)
          const bar = r(document.querySelector('.bwiz__mobileBar'))
          const tab = r(document.querySelector('.tabbar'))
          return {
            scrollable: document.documentElement.scrollHeight > innerHeight + 2,
            docH: document.documentElement.scrollHeight,
            winH: innerHeight,
            canvasInside: !!(box && cv && cv.width > 0 &&
              cv.bottom <= box.bottom + 1 && cv.right <= box.right + 1 &&
              cv.top >= box.top - 1 && cv.left >= box.left - 1),
            canvasH: cv ? Math.round(cv.height) : 0,
            canvasW: cv ? Math.round(cv.width) : 0,
            /* 颜色三档要落在「参数区看得见的那一截」里，
               光看它有没有落在视口内不算 —— 参数区自己会滚。 */
            richVisible: !!(rich && paramsBox &&
              rich.top >= paramsBox.top - 1 && rich.bottom <= paramsBox.bottom + 1),
            paramsScrollable: !!params && params.scrollHeight > params.clientHeight + 1,
            ctaAboveTab: !!(bar && tab && bar.bottom <= tab.top + 1),
            ctaBottom: bar ? Math.round(bar.bottom) : -1,
            ctaTop: bar ? Math.round(bar.top) : -1,
            tabTop: tab ? Math.round(tab.top) : -1
          }
        })()`)
        step('第 ② 步整页不滚动', !adj.scrollable, `文档高 ${adj.docH} / 视口 ${adj.winH}`)
        step('第 ② 步画布完整落在预览框里（没被压扁、没溢出）', adj.canvasInside,
          `画布 ${adj.canvasW}×${adj.canvasH}`)
        /* 预览按「专业版工作台画布」的量级给高度（2026-10-26 用户要求：
           新手版第 ② 步的预览图要跟专业版画布一样大）。
           专业版画布实测占视口 29% / 31% / 36%（360×640 / 390×844 / 430×932），
           这里断言画布不低于视口的 25%，再给一个绝对下限兜住极矮屏。 */
        step('第 ② 步画布达到专业版画布的量级',
          adj.canvasH >= Math.round(adj.winH * 0.25) && adj.canvasH >= 150,
          `画布 ${adj.canvasH}px · 视口 ${adj.winH}px（占 ${(adj.canvasH / adj.winH * 100).toFixed(0)}%）`)
        /* 画布优先之后参数区放不下全部内容：它自己滚，
           但必须真的滚得到颜色三档（不能有被裁掉、点不到的参数）。 */
        step('第 ② 步参数区自己滚', adj.paramsScrollable, `可滚 ${adj.paramsScrollable}`)
        const richEnd = await evaluate(send, `(() => {
          const params = document.querySelector('.badj__params')
          const rich = document.querySelector('.badj__rich')
          if (!params || !rich) return null
          params.scrollTop = params.scrollHeight
          const p = params.getBoundingClientRect()
          const r = rich.getBoundingClientRect()
          return {
            visible: r.top >= p.top - 1 && r.bottom <= p.bottom + 1,
            pTop: Math.round(p.top), pBottom: Math.round(p.bottom),
            rTop: Math.round(r.top), rBottom: Math.round(r.bottom),
            scrollTop: Math.round(params.scrollTop), scrollH: params.scrollHeight, clientH: params.clientHeight
          }
        })()`)
        step('第 ② 步滚到参数区底部能看到颜色三档', !!(richEnd && richEnd.visible),
          richEnd ? `参数区 ${richEnd.pTop}~${richEnd.pBottom} · 颜色三档 ${richEnd.rTop}~${richEnd.rBottom} · scrollTop ${richEnd.scrollTop}/${richEnd.scrollH - richEnd.clientH}` : '找不到元素')
        await evaluate(send, `(() => { const p = document.querySelector('.badj__params'); if (p) p.scrollTop = 0 })()`)
        step('第 ② 步底部常驻 CTA 在标签栏之上', adj.ctaAboveTab,
          `CTA ${adj.ctaTop}~${adj.ctaBottom} · 标签栏顶边 ${adj.tabTop}`)
      }

      /* ---------------------------------------------- ④ 拖尺寸滑块 → 数据联动 */
      const slider = await evaluate(send, `(() => {
        const el = document.querySelector('.badj__slider')
        if (!el) return null
        const max = Number(el.max)
        const next = Math.max(0, Number(el.value) - 1)
        el.value = String(next)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return { max, from: Number(el.value), before: document.querySelector('.badj__stats dd')?.textContent.trim() }
      })()`)
      await sleep(2500)
      const afterSlider = await evaluate(send, `(() => ({
        stats: [...document.querySelectorAll('.badj__stats dd')].map(e => e.textContent.trim()),
        exact: document.querySelector('.badj__exact')?.textContent.trim() || ''
      }))()`)
      step('尺寸滑块可拖且数据跟着变',
        !!slider && JSON.stringify(slider.before) !== JSON.stringify(afterSlider.stats[0]),
        `${slider ? slider.before : '-'} → ${afterSlider.stats[0]}`)

      /* ---------------------------------------------- ⑤ 颜色丰富程度 */
      const richness = await evaluate(send, `(() => {
        const btns = [...document.querySelectorAll('.badj__richBtn')]
        const few = btns.find(b => (b.textContent || '').includes('少色'))
        if (!few) return null
        few.click()
        return true
      })()`)
      await sleep(2500)
      const richState = await evaluate(send, `(() => ({
        on: document.querySelector('.badj__richBtn.on b')?.textContent.trim() || '',
        exact: document.querySelector('.badj__exact')?.textContent.trim() || ''
      }))()`)
      step('颜色丰富程度可切换', !!richness && richState.on === '少色', `当前 ${richState.on}`)
      await shot(send, `${vp.name}-4-adjust-rich`)

      /* ---------------------------------------------- ⑥ 第 ③ 步：成果 + 材料清单 */
      await clickVisibleByText(send, '.bwiz__mobileCta, .badj__actNext', '下一步：获取图纸')
      await sleep(1200)
      const exp = await evaluate(send, `(() => ({
        on: document.querySelector('.bwiz__step.on b')?.textContent.trim() || '',
        facts: [...document.querySelectorAll('.bexp__fact b')].map(e => e.textContent.trim()),
        mats: document.querySelectorAll('.bexp__list li').length,
        /* 清单行只跟「需要多少颗」，不跟缺口（缺口在库存页 / 材料清单 CSV 里看） */
        matTexts: [...document.querySelectorAll('.bexp__list li')].map(e => (e.textContent || '').replace(/\\s+/g, ' ').trim()),
        hasCta: !!document.querySelector('.bexp__cta'),
        overflowX: document.documentElement.scrollWidth > innerWidth + 2
      }))()`)
      step('第 ③ 步打开', exp.on === '获取图纸')
      step('成果数据齐全（尺寸/格数/色数/豆数/板数）', exp.facts.length === 6 && exp.facts.every(v => v && v !== '—'), exp.facts.join(' / '))
      step('材料清单有真实条目', exp.mats > 0, `${exp.mats} 种颜色`)
      step('材料清单每行只跟颗数、不跟缺口',
        exp.matTexts.every(t => /颗$/.test(t) && !t.includes('还缺')),
        exp.matTexts.slice(0, 2).join(' | '))
      step('第 ③ 步无横向溢出', !exp.overflowX)
      /* 成果预览占整块预览框的比例：电脑/平板要撑满，手机维持原来的小图 */
      const expArt = await evaluate(send, `(() => {
        const box = document.querySelector('.bexp__art')
        const cv = document.querySelector('.bexp__art canvas')
        if (!box || !cv) return null
        const bs = getComputedStyle(box)
        const b = box.getBoundingClientRect()
        const c = cv.getBoundingClientRect()
        const innerH = b.height - parseFloat(bs.paddingTop) - parseFloat(bs.paddingBottom)
        const innerW = b.width - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight)
        return {
          innerW: Math.round(innerW), innerH: Math.round(innerH),
          cvW: Math.round(c.width), cvH: Math.round(c.height),
          hShare: innerH ? c.height / innerH : 0,
          wShare: innerW ? c.width / innerW : 0,
          area: innerW * innerH ? (c.width * c.height) / (innerW * innerH) : 0,
          wide: innerWidth >= 781
        }
      })()`)
      if (expArt && expArt.wide) {
        step('电脑/平板：成果预览撑满预览框高度',
          expArt.hShare >= 0.85,
          `画布 ${expArt.cvW}×${expArt.cvH} / 预览框 ${expArt.innerW}×${expArt.innerH} · 高占 ${(expArt.hShare * 100).toFixed(0)}% · 宽占 ${(expArt.wShare * 100).toFixed(0)}% · 面积占 ${(expArt.area * 100).toFixed(0)}%`)
        step('电脑/平板：成果预览不再是预览框里的一小块',
          expArt.area >= 0.4,
          `面积占 ${(expArt.area * 100).toFixed(0)}%`)
      } else if (expArt) {
        step('手机：成果预览框维持原来的高度上限',
          expArt.cvH <= Math.round(expArt.innerH * 1.05),
          `画布 ${expArt.cvW}×${expArt.cvH} / 预览框 ${expArt.innerW}×${expArt.innerH}`)
      }
      /* 手机端：主操作要钉在底部（PRD「底部 CTA 固定于安全区域上方」） */

      const bar = await evaluate(send, `(() => {
        const el = document.querySelector('.bwiz__mobileBar')
        if (!el) return { visible: false, label: '' }
        const cs = getComputedStyle(el)
        return { visible: cs.display !== 'none', label: (el.textContent || '').trim(), bottom: Math.round(el.getBoundingClientRect().bottom) }
      })()`)
      if (narrow) {
        step('手机端底部常驻 CTA 在', bar.visible && bar.label.includes('下载拼豆图纸'), `${bar.label} · 底边 ${bar.bottom}px`)
      }
      await shot(send, `${vp.name}-5-export`)

      /* ---------------------------------------------- ⑥' 手机端第 ③ 步：摘要 + 材料抽屉 */
      if (narrow) {
        const exp2 = await evaluate(send, `(() => {
          const r = el => el ? el.getBoundingClientRect() : null
          const bar = r(document.querySelector('.bwiz__mobileBar'))
          const tab = r(document.querySelector('.tabbar'))
          const art = r(document.querySelector('.bexp__art'))
          const cv = r(document.querySelector('.bexp__art canvas'))
          const facts = [...document.querySelectorAll('.bexp__fact')]
          const cols = facts.length ? getComputedStyle(facts[0].parentElement).gridTemplateColumns.split(' ').length : 0
          return {
            scrollable: document.documentElement.scrollHeight > innerHeight + 2,
            docH: document.documentElement.scrollHeight,
            winH: innerHeight,
            facts: facts.length,
            cols,
            artH: art ? Math.round(art.height) : 0,
            canvasInside: !!(art && cv && cv.height > 0 && cv.bottom <= art.bottom + 1 && cv.right <= art.right + 1),
            allBtn: !!document.querySelector('.bexp__allBtn'),
            allBtnVisible: (() => {
              const b = document.querySelector('.bexp__allBtn')
              if (!b) return false
              const rr = b.getBoundingClientRect()
              return getComputedStyle(b).display !== 'none' && rr.width > 0
            })(),
            ctaAboveTab: !!(bar && tab && bar.bottom <= tab.top + 1),
            ctaBottom: bar ? Math.round(bar.bottom) : -1,
            tabTop: tab ? Math.round(tab.top) : -1
          }
        })()`)
        step('第 ③ 步整页不滚动', !exp2.scrollable, `文档高 ${exp2.docH} / 视口 ${exp2.winH}`)
        step('第 ③ 步摘要 6 个字段压成 2 列（一个都没少）', exp2.facts === 6 && exp2.cols === 2,
          `${exp2.facts} 个字段 · ${exp2.cols} 列`)
        step('第 ③ 步预览图完整落在预览区里', exp2.canvasInside, `预览区高 ${exp2.artH}px`)
        step('第 ③ 步有「查看全部」入口', exp2.allBtnVisible)
        step('第 ③ 步底部常驻 CTA 在标签栏之上', exp2.ctaAboveTab,
          `CTA 底边 ${exp2.ctaBottom} · 标签栏顶边 ${exp2.tabTop}`)

        /* 材料清单抽屉：打开 → 列全 → 关闭不丢状态 */
        const pageRows = await evaluate(send, `document.querySelectorAll('.bexp__block .bexp__list li').length`)
        await clickVisibleByText(send, '.bexp__allBtn', '查看全部')
        await sleep(800)
        const drawer = await evaluate(send, `(() => ({
          open: !!document.querySelector('.modal--sheet .dialog'),
          sheet: !!document.querySelector('.modal--sheet'),
          rows: document.querySelectorAll('.modal .bexp__list--drawer li').length,
          hasSearch: !!document.querySelector('.modal .bexp__search input')
        }))()`)
        step('材料清单抽屉能打开且是底部抽屉', drawer.open && drawer.sheet, `抽屉 ${drawer.rows} 行`)
        step('抽屉里的颜色比页面上多（明细搬进抽屉了）', drawer.rows > pageRows,
          `页面 ${pageRows} 行 → 抽屉 ${drawer.rows} 行`)
        step('抽屉里能按色号搜索', drawer.hasSearch)
        await shot(send, `${vp.name}-10-materials`)
        await evaluate(send, `(() => {
          const b = document.querySelector('.modal .iconbtn')
          if (b) b.click()
        })()`)
        await sleep(600)
        const closed = await evaluate(send, `!document.querySelector('.modal--sheet .dialog')`)
        step('抽屉能关掉', closed)
      }

      /* ---------------------------------------------- ⑦ 专业模式里画一笔 → 切回新手 */
      await clickByText(send, '.topbar__actions .modeSwitch button', '专业')
      await sleep(2600)
      const pro = await evaluate(send, `(() => ({
        path: location.pathname,
        hasPattern: !!document.querySelector('.canvasCard canvas, .stage canvas'),
        modeOn: document.querySelector('.modeSwitch button.on')?.textContent.trim() || ''
      }))()`)
      step('切到专业模式进工作台', pro.path === '/editor' && pro.modeOn === '专业', `路径 ${pro.path}`)
      step('专业模式里图纸还在（没丢作品）', pro.hasPattern)
      await shot(send, `${vp.name}-6-pro`)

      /* 先在专业工作台里改一格（模拟 pointer 事件）——
         被手改过的图纸切回新手版时必须先弹保护层，不能静默重画。 */
      const painted = await evaluate(send, `(() => {
        const stage = document.querySelector('.stage')
        const cv = stage && stage.querySelector('canvas')
        if (!stage || !cv) return 'no-canvas'
        const r = cv.getBoundingClientRect()
        const fire = (type, x, y) => stage.dispatchEvent(new PointerEvent(type, {
          clientX: x, clientY: y, bubbles: true, cancelable: true,
          pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1
        }))
        for (const fy of [0.35, 0.45, 0.55, 0.65]) {
          for (const fx of [0.35, 0.45, 0.55, 0.65]) {
            const x = r.left + r.width * fx
            const y = r.top + r.height * fy
            fire('pointerdown', x, y); fire('pointermove', x + 1, y + 1); fire('pointerup', x + 1, y + 1)
          }
        }
        return 'fired'
      })()`)

      await clickByText(send, '.topbar__actions .modeSwitch button', '新手')
      await sleep(1200)
      const guardOpen = await evaluate(send, `(() => ({
        open: !!document.querySelector('.modal .dialog'),
        title: document.querySelector('.modal .dialog__head h2')?.textContent.trim() || '',
        body: document.querySelector('.modal .dialog__body')?.textContent.trim().slice(0, 60) || ''
      }))()`)
      if (guardOpen.open) {
        step('手改过的图纸切回新手会先弹保护层', true, `${guardOpen.title}`)
        await shot(send, `${vp.name}-8-guard`)
        await clickByText(send, '.modal .dialog__foot .btn', '继续切换')
        await sleep(2000)
      } else {
        step('手改过的图纸切回新手会先弹保护层', painted !== 'fired',
          painted === 'fired' ? '画笔事件没生效，本轮不判定' : '画布不可用，本轮不判定')
      }

      const back = await evaluate(send, `(() => ({
        path: location.pathname,
        on: document.querySelector('.bwiz__step.on b')?.textContent.trim() || '',
        modeOn: document.querySelector('.modeSwitch button.on')?.textContent.trim() || ''
      }))()`)
      step('切回新手模式', back.path === '/create' && back.modeOn === '新手', `路径 ${back.path} · 第 ${back.on} 步`)
      step('切回后停在「获取图纸」且没重画', back.on === '获取图纸')
      await shot(send, `${vp.name}-7-beginner-back`)

      /* ---------------------------------------------- ⑧ 免费素材（PRD 情景 2）
         素材要真的从后端拉（本地静态服务器没有 /api/v1/assets），
         所以这一段只在 --url 指向线上时跑。 */
      if (externalBase) {
        /* 回到第 ① 步 */
        await evaluate(send, `(() => {
          const b = document.querySelector('.bwiz__step button')
          if (b) b.click()
        })()`)
        await sleep(600)
        /* 切到「免费素材」标签 */
        await evaluate(send, `(() => {
          const t = [...document.querySelectorAll('.bsel__tabs button')].find(b => (b.textContent || '').includes('免费素材'))
          if (t) t.click()
        })()`)
        await waitFor(send, `document.querySelectorAll('.bsel__card').length > 0`)
        await sleep(300)
        const lib = await evaluate(send, `(() => ({
          cards: document.querySelectorAll('.bsel__card').length,
          cats: document.querySelectorAll('.bsel__cat').length,
          loading: !!document.querySelector('.bsel__hint') && (document.querySelector('.bsel__hint').textContent || '').includes('加载中'),
          err: (document.querySelector('.bsel__err') || {}).textContent || '',
          vip: /VIP|付费|会员|卡密|应援/i.test((document.querySelector('.bsel__grid') || {}).textContent || '')
        }))()`)
        step('免费素材拉到了真实素材', lib.cards > 0 && !lib.loading && !lib.err, `${lib.cards} 张 · ${lib.cats} 个分类`)
        step('素材区没有 VIP / 付费 / 应援字样', !lib.vip)

        /* 手机端：素材卡片区自己滚，整页不跟着长 */
        if (narrow) {
          const scroll = await evaluate(send, `(() => {
            const sc = document.querySelector('.bsel__libScroll')
            if (!sc) return null
            const cs = getComputedStyle(sc)
            return {
              overflowY: cs.overflowY,
              clientH: sc.clientHeight,
              scrollH: sc.scrollHeight,
              pageScrollable: document.documentElement.scrollHeight > innerHeight + 2
            }
          })()`)
          step('手机端素材列表自己滚（整页不滚）',
            !!scroll && (scroll.overflowY === 'auto' || scroll.overflowY === 'scroll') && !scroll.pageScrollable,
            scroll ? `列表 ${scroll.clientH}px / 内容 ${scroll.scrollH}px` : '没有找到素材滚动容器')
        }

        /* 搜索：用第一张素材的名字当关键词，搜完应该还能搜到它 */
        const search = await evaluate(send, `(() => {
          const first = document.querySelector('.bsel__card .bsel__cardName')
          const name = (first && first.textContent || '').trim()
          const input = document.querySelector('.bsel__search input')
          if (!input || !name) return null
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(input, name.slice(0, 2))
          input.dispatchEvent(new Event('input', { bubbles: true }))
          return { name, before: document.querySelectorAll('.bsel__card').length }
        })()`)
        await sleep(900)
        const afterSearch = await evaluate(send, `document.querySelectorAll('.bsel__card').length`)
        step('素材搜索有结果', !!search && afterSearch > 0,
          search ? `「${search.name.slice(0, 2)}」→ ${afterSearch} 张` : '没有可搜的素材')

        /* 选中 → 确认页 → 生成图纸 */
        await evaluate(send, `(() => {
          const c = document.querySelector('.bsel__card')
          if (c) c.click()
        })()`)
        await sleep(700)
        const picked = await evaluate(send, `(() => ({
          confirm: !!document.querySelector('.bsel__confirm'),
          text: (document.querySelector('.bsel__confirmText') || {}).textContent || ''
        }))()`)
        step('选中素材后进入「图片已选好」确认页', picked.confirm, picked.text.trim().slice(0, 24))
        await shot(send, `${vp.name}-9-material`)

        await clickByText(send, '.bsel__confirmBtns .btn', '下一步')
        await waitFor(send, `document.querySelector('.bwiz__step.on b')?.textContent.trim() === '调整效果'
          && !!document.querySelector('.badj__canvasBox canvas')`, { timeout: 25000 })
        const matGen = await evaluate(send, `(() => ({
          on: document.querySelector('.bwiz__step.on b')?.textContent.trim() || '',
          hasCanvas: !!document.querySelector('.badj__canvasBox canvas'),
          stats: [...document.querySelectorAll('.badj__stats dd')].map(e => e.textContent.trim())
        }))()`)
        step('素材也能生成真实图纸', matGen.on === '调整效果' && matGen.hasCanvas, matGen.stats.join(' / '))
      }
    } catch (e) {
      step('脚本执行', false, e.message)
      await shot(send, `${vp.name}-error`).catch(() => {})
    }

    results.push({ viewport: vp.name, steps, errors })
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  /* ------------------------------------------------------------ 汇总 */
  console.log('\n================ 汇总 ================')
  let total = 0
  let bad = 0
  for (const r of results) {
    total += r.steps.length
    bad += r.steps.filter(s => !s.ok).length
    console.log(`${r.viewport}: ${r.steps.filter(s => s.ok).length}/${r.steps.length} 通过，console 报错 ${r.errors.length} 条`)
    for (const e of r.errors.slice(0, 5)) console.log('   ! ' + e)
  }
  console.log(`总计 ${total - bad}/${total} 通过 · 截图在 ${OUT}`)
  console.log(failed || bad ? '✗ 有未通过项' : '✓ 全部通过')

  browser.close()
  chrome.kill()
  server && server.close()
  process.exit(failed || bad ? 1 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
