/* =========================================================================
   「创作」直达全屏工作台自检
   -------------------------------------------------------------------------
   2026-11-01：新手三步操作台（/create）与顶栏「新手 / 专业」开关下线，
   所有「创作」入口都直接进 /editor 的全屏工作台。这个探针钉住四件事：
     ① 站点顶栏不再有模式开关（首页 / 内页 / 素材库都查）；
     ② 首页「立即创作」、左侧栏「创作」、手机底栏「创作」都指向 /editor；
     ③ 点进去就是全屏工作台：没有站点顶栏、左侧栏、手机底部标签栏；
     ④ 老链接 /create 跳回 /editor；工作台顶栏与手机「⋯」菜单里不再有「操作台」。
   工作台不再提供「新手教程」入口，也不再自动弹出分步新手指引。
   用法：
     node scripts/verify-direct-entry.cjs
     node scripts/verify-direct-entry.cjs --url https://dw.sharyuke.com
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.tmp', 'verify-direct-entry')
const PORT = Number(process.env.VERIFY_PORT || 4392)

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find(p => fs.existsSync(p))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2'
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function staticServer() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0])
      if (p === '/') p = '/index.html'
      const f = path.join(DIST, p)
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(fs.readFileSync(path.join(DIST, 'index.html')))
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
      res.end(fs.readFileSync(f))
    })
    s.listen(PORT, '127.0.0.1', () => resolve(s))
  })
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map()
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res)
      this.ws.addEventListener('error', () => rej(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id)
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(method + ' 超时')) }
      }, 60000)
    })
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

let passed = 0, failed = 0
function check(name, ok, extra) {
  if (ok) { passed++; console.log('PASS ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')) }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')) }
}

async function main() {
  const urlIdx = process.argv.indexOf('--url')
  const external = urlIdx > 0 ? String(process.argv[urlIdx + 1] || '').replace(/\/+$/, '') : ''
  const server = external ? null : await staticServer()
  const origin = external || `http://127.0.0.1:${PORT}`
  if (!CHROME) { console.error('找不到 Chrome / Edge'); if (server) server.close(); process.exit(1) }
  fs.mkdirSync(OUT, { recursive: true })

  const port = 9700 + (process.pid % 200)
  const profile = fs.mkdtempSync(path.join(ROOT, '.tmp', 'direct-'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })

  let version = null
  for (let i = 0; i < 80; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch { await sleep(250) }
  }
  if (!version) { chrome.kill(); if (server) server.close(); throw new Error('Chrome 未就绪') }

  const browser = new CDP(version.webSocketDebuggerUrl); await browser.ready
  const t = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  await send('Page.enable'); await send('Runtime.enable')

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value
  }
  const go = async p => { await send('Page.navigate', { url: origin + p }); await sleep(1600) }
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    if (r && r.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  }
  /* 升级公告首次进入会盖一层：「我知道了」只关闭，不会跳页（「继续使用」会进工作台） */
  const dismissNotice = () => ev(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    for (let i = 0; i < 12 && !document.querySelector('.upgradeNotice'); i++) await sleep(120)
    const n = document.querySelector('.upgradeNotice')
    if (!n) return false
    const b = [...n.querySelectorAll('button')].find(x => x.textContent.trim() === '我知道了')
    if (b) b.click()
    await sleep(300)
    return true
  })()`)

  try {
    /* ---------------------------------------------------------- 桌面 1440×900 */
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await go('/')
    await dismissNotice()
    check('首页顶栏没有模式开关', !(await ev(`!!document.querySelector('.modeSwitch')`)))
    const cta = await ev(`(() => { const a = document.querySelector('.homeV3__cta'); return a ? a.getAttribute('href') : null })()`)
    check('首页「立即创作」指向 /editor', cta === '/editor', cta)
    await ev(`document.querySelector('.homeV3__cta').click(); 1`)
    await sleep(1800)
    const landed = await ev(`(() => ({
      path: location.pathname,
      header: !!document.querySelector('.topbar'),
      sidebar: !!document.querySelector('.side'),
      console: !!document.querySelector('.csTop'),
      tabbar: !!document.querySelector('.tabbar')
    }))()`)
    check('点「立即创作」直达全屏工作台', landed.path === '/editor' && landed.console, landed)
    check('工作台里没有站点顶栏 / 左侧栏 / 手机标签栏', !landed.header && !landed.sidebar && !landed.tabbar, landed)
    const topActions = await ev(`[...document.querySelectorAll('.csActions .csAction')].map(b => b.textContent.trim())`)
    check('桌面工作台顶栏没有「操作台」', !topActions.some(x => x.includes('操作台')), topActions)
    await shot('desktop-editor')

    const tut = await ev(`(() => {
      const bits = [...document.querySelectorAll('button')].map(b =>
        (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + b.textContent)
      return { labeled: bits.some(t => t.includes('新手教程')), dialog: !!document.querySelector('[data-audit="tutorial-dialog"]') }
    })()`)
    check('桌面工作台没有新手教程入口', !tut.labeled && !tut.dialog, tut)
    await sleep(1200)
    check('桌面工作台没有新手指引', !(await ev(`!!document.querySelector('[data-guide]')`)))

    await go('/create')
    await sleep(600)
    check('老链接 /create 跳到 /editor', (await ev('location.pathname')) === '/editor', await ev('location.pathname'))

    await go('/projects')
    await dismissNotice()
    const nav = await ev(`(() => {
      const links = [...document.querySelectorAll('.side a')].map(a => ({ t: a.textContent.trim(), h: a.getAttribute('href') }))
      return { creation: links.filter(x => x.t === '创作'), mode: !!document.querySelector('.modeSwitch') }
    })()`)
    check('左侧栏「创作」指向 /editor', nav.creation.some(l => l.h === '/editor'), nav.creation)
    check('内页顶栏也没有模式开关', !nav.mode, nav.mode)

    await go('/materials/')
    await dismissNotice()
    check('素材库顶栏没有模式开关', !(await ev(`!!document.querySelector('.modeSwitch')`)))

    /* ---------------------------------------------------------- 手机 390×844 */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await go('/')
    await dismissNotice()
    const mcta = await ev(`(() => { const a = document.querySelector('.homeV3__cta'); return a ? a.getAttribute('href') : null })()`)
    check('手机首页「立即创作」指向 /editor', mcta === '/editor', mcta)
    const mtab = await ev(`(() => {
      const a = [...document.querySelectorAll('.tabbar a')].find(x => x.textContent.trim() === '创作')
      return a ? a.getAttribute('href') : null
    })()`)
    check('手机底栏「创作」指向 /editor', mtab === '/editor', mtab)
    await ev(`[...document.querySelectorAll('.tabbar a')].find(x => x.textContent.trim() === '创作').click(); 1`)
    await sleep(1800)
    const mland = await ev(`(() => ({
      path: location.pathname,
      tabbar: !!document.querySelector('.tabbar'),
      header: !!document.querySelector('.topbar'),
      mobileConsole: !!document.querySelector('.msTop'),
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`)
    check('手机点「创作」直达全屏工作台', mland.path === '/editor' && mland.mobileConsole, mland)
    check('手机工作台里没有站点顶栏 / 底部标签栏', !mland.tabbar && !mland.header, mland)
    check('手机工作台无横向溢出', mland.overflow === false, mland.overflow)
    await shot('mobile-editor')

    await ev(`document.querySelector('.msIcon').click(); 1`)
    await sleep(600)
    const menu = await ev(`[...document.querySelectorAll('.msMenu button')].map(b => b.textContent.trim())`)
    check('手机「⋯」菜单里没有「操作台」', !menu.some(x => x.includes('操作台')), menu)
    /* 「我的作品」入口统一收进个人中心，工作台里不再重复放一份 */
    check('手机「⋯」菜单里没有「我的作品」', !menu.some(x => x.includes('我的作品')), menu)
    check('手机「⋯」菜单里没有「新手教程」', !menu.some(x => x.includes('新手教程')), menu)
    check('手机工作台没有新手指引', !(await ev(`!!document.querySelector('[data-guide]')`)))
    check('手机「⋯」菜单里仍有「返回首页」', menu.some(x => x.includes('返回首页')), menu)
  } catch (e) {
    failed++
    console.log('FAIL 自检中断：' + (e && e.message ? e.message : e))
  } finally {
    browser.close(); chrome.kill(); if (server) server.close()
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败　截图在 ${OUT}`)
  process.exit(failed ? 1 : 0)
}

main()
