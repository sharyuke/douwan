/* =========================================================================
   排版自检：按 Figma「豆玩操作台优化」1:2「豆玩 · 文字与字体规范」v1.0 验收
   用法：node scripts/verify-typography.cjs [--url http://127.0.0.1:4180]

   规范（唯一事实来源 = Figma 1:2）：
     字体：中文 Noto Sans SC（只 400 / 500 / 700）；拉丁与数字 Inter（400 / 500 / 600）
     语义角色                        字号/字重/行高      字距
     Title / Page      页面主标题   28 / 700 / 40      0
     Title / Dialog    弹窗标题     24 / 700 / 34      0
     Title / Section   区域标题     18 / 700 / 28      0
     Title / Card·Action 卡片标题·主按钮 15 / 700 / 24 0
     Body / Default    正文·输入    14 / 400 / 22      0
     Label / Control   导航·标签·次按钮 13 / 500 / 20 0
     Caption / Default 辅助·紧凑标签 12 / 400 / 18     0
     Number / Metric   概览指标    30 / 600 / 38     -1px
     Number / Inventory 库存数量   13 / 500 / 20      0
     补充：14px 内容小标题 700/22；13px 字段标签强调 700/20；12px 标签强调 700/18
     边界：正文 ≥14px，辅助 ≥12px；10–11px/400 仅作「高密度标尺、日期、次要元信息」特例

   本脚本做两件事：
     ① 角色断言 —— 逐个点名页面上该用哪种字号/字重的元素，核对计算样式；
     ② 全量扫查 —— 把页面上所有可见文字都扫一遍，抓「字号越界 / 字重越界
       / 行高与字号不匹配 / 字距不为 0 / 中文字重出现 600 以上伪粗体」。
   产物：.tmp/verify-typography/（截图 + report.json）
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.tmp', 'verify-typography')
fs.mkdirSync(OUT, { recursive: true })
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function staticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0])
      if (p === '/') p = '/index.html'
      const file = path.join(DIST, p)
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(fs.readFileSync(path.join(DIST, 'index.html'))); return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file))
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.handlers = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result)
      } else if (msg.method && this.handlers.has(msg.method)) {
        this.handlers.get(msg.method)(msg.params, msg.sessionId)
      }
    })
  }
  /* 事件订阅（Fetch.requestPaused 这类） */
  on(method, fn) { this.handlers.set(method, fn) }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')) } }, 30000)
    })
  }
  close() { try { this.ws.close() } catch {} }
}

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p))

/* ---------------- 规范表 ---------------- */
const SPEC = {
  page:    { size: 28, weight: 700, lh: 40, ls: 0 },
  dialog:  { size: 24, weight: 700, lh: 34, ls: 0 },
  section: { size: 18, weight: 700, lh: 28, ls: 0 },
  card:    { size: 15, weight: 700, lh: 24, ls: 0 },
  body:    { size: 14, weight: 400, lh: 22, ls: 0 },
  label:   { size: 13, weight: 500, lh: 20, ls: 0 },
  caption: { size: 12, weight: 400, lh: 18, ls: 0 },
  metric:  { size: 30, weight: 600, lh: 38, ls: -1 },
  num:     { size: 13, weight: 500, lh: 20, ls: 0 }
}
/* 字号 → 规范里唯一允许的行高（用于全量扫查） */
const LH_BY_SIZE = { 28: 40, 24: 34, 18: 28, 15: 24, 14: 22, 13: 20, 12: 18, 30: 38 }
/* 允许的字号：规范档位 + 补充档（14 小标题 / 13 字段标签 / 12 标签强调）+ 10~11 特例 */
const ALLOWED_SIZES = new Set([10, 11, 12, 13, 14, 15, 18, 24, 28, 30])
/* 10~11px 的特例位置（规范允许：高密度标尺、日期、次要元信息） */
const SMALL_OK = [
  'ruler', '标尺', 'csSaved', 'csStatus', 'date', 'time',
  'csPalette__cell', 'rulerLabel'
]
/* 中文允许的字重（Noto Sans SC 只有 400/500/700，600 以上会变伪粗体） */
const CN_WEIGHTS = new Set([400, 500, 700])

async function main() {
  const urlIdx = process.argv.indexOf('--url')
  const external = urlIdx > 0 ? String(process.argv[urlIdx + 1] || '').replace(/\/+$/, '') : ''
  const server = external ? null : await staticServer()
  const origin = external || `http://127.0.0.1:${server.address().port}`
  const port = 9700 + (process.pid % 200)
  const profile = fs.mkdtempSync(path.join(ROOT, '.tmp', 'probe-typo-'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let version = null
  for (let i = 0; i < 80; i++) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch { await sleep(250) } }
  if (!version) { chrome.kill(); if (server) server.close(); throw new Error('Chrome 未就绪') }
  const browser = new CDP(version.webSocketDebuggerUrl); await browser.ready

  const fixtureSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-fixture.js'), 'utf8')
  let fixtureId = 'p_audit_fixture'

  const newPage = async () => {
    const t = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
    const send = (m, p) => browser.send(m, p, sessionId)
    await send('Page.enable'); await send('Runtime.enable')
    return { targetId: t.targetId, sessionId, send }
  }
  const evalJs = async (send, expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result?.value
  }
  const waitBridge = send => send('Runtime.evaluate', {
    expression: `new Promise(res => { const t0 = Date.now(); const tick = () => (window.__douzao ? res(true) : (Date.now() - t0 > 12000 ? res(false) : setTimeout(tick, 100))); tick() })`,
    awaitPromise: true, returnByValue: true
  }).catch(() => {})

  /* 打开一个页面：先回站点根把「升级公告已看过」标记写进 sessionStorage，
     否则公告弹窗会盖住页面，截图与扫查都受影响 */
  const openPage = async (send, url) => {
    await send('Page.navigate', { url: `${origin}/` })
    await sleep(400)
    await evalJs(send, `sessionStorage.setItem('douwan-upgrade-notice','1'); localStorage.setItem('douwan.guide.v1','1'); 1`)
    await send('Page.navigate', { url })
    await waitBridge(send); await sleep(1200)
  }

  /* 预置作品（工作台要有图纸才有完整界面） */
  {
    const { targetId, send } = await newPage()
    await send('Page.navigate', { url: `${origin}/` })
    await waitBridge(send)
    await evalJs(send, `(() => { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('douzao-')) keys.push(k) } keys.forEach(k => localStorage.removeItem(k)); return keys.length })()`)
    await send('Page.reload', { ignoreCache: true })
    await waitBridge(send); await sleep(400)
    const r = await evalJs(send, fixtureSrc)
    if (r && r.projectId) fixtureId = r.projectId
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  const report = []
  const sweepIssues = []
  const check = (name, ok, extra) => { report.push({ name, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')) }

  /* 页面里所有可见文字元素的排版快照（只看「本页自己的版面」）
   扫查范围限定在页面根节点里（工作台 .studio--console / .studio--mobile，
   个人中心 .ac）：站点顶栏、左侧导航、页脚、反馈小标、升级公告与通用弹窗
   是全站共用的组件，改它们会连带影响首页、素材库等页面，不在本次范围内。 */
  const collect = rootSelector => `(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)})
    if (!root) return []
    const out = []
    const pathOf = el => {
      const parts = []
      let n = el
      while (n && n.nodeType === 1 && parts.length < 4) {
        let s = n.tagName.toLowerCase()
        if (n.classList && n.classList.length) s += '.' + [...n.classList].slice(0, 2).join('.')
        parts.unshift(s)
        n = n.parentElement
      }
      return parts.join(' > ')
    }
    const all = [...root.querySelectorAll('*')]
    for (const el of all) {
      const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
      if (!txt) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
      /* .sr-only：只给读屏器与爬虫看的标题，页面上不可见，排版规范不适用 */
      if (el.classList && el.classList.contains('sr-only')) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      out.push({
        sel: pathOf(el),
        text: txt.slice(0, 24),
        size: parseFloat(cs.fontSize),
        weight: Number(cs.fontWeight),
        lh: cs.lineHeight === 'normal' ? 'normal' : parseFloat(cs.lineHeight),
        ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
        family: cs.fontFamily,
        cls: el.className && typeof el.className === 'string' ? el.className : ''
      })
    }
    return out
  })()`

  /* 单个元素的计算样式（角色断言用） */
  const styleOf = async (send, selector) => evalJs(send, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight),
      lh: cs.lineHeight === 'normal' ? 'normal' : parseFloat(cs.lineHeight),
      ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
      family: cs.fontFamily, text: el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 30)
    }
  })()`)

  const assertRole = async (send, label, selector, spec, extra) => {
    const st = await styleOf(send, selector)
    if (!st) { check(label + '（' + selector + '）', false, { missing: true }); return }
    const bad = []
    if (st.size !== spec.size) bad.push('size ' + st.size + ' ≠ ' + spec.size)
    if (st.weight !== spec.weight) bad.push('weight ' + st.weight + ' ≠ ' + spec.weight)
    if (st.lh !== spec.lh) bad.push('lh ' + st.lh + ' ≠ ' + spec.lh)
    if (st.ls !== spec.ls) bad.push('ls ' + st.ls + ' ≠ ' + spec.ls)
    check(label + (extra ? ' · ' + extra : ''), bad.length === 0, bad.length ? { bad, st } : st.text)
  }

  /* 全量扫查（范围 = 该页自己的版面根节点） */
  const sweep = async (send, where, root) => {
    const list = await evalJs(send, collect(root))
    const badSize = [], badWeight = [], badLh = [], badLs = []
    for (const t of list) {
      const isSmall = t.size <= 11
      const smallOk = isSmall && SMALL_OK.some(k => (t.cls + ' ' + t.sel).includes(k))
      if (!ALLOWED_SIZES.has(t.size)) badSize.push([t.sel, t.size, t.text])
      else if (isSmall && !smallOk) badSize.push(['(11px 特例未登记)', t.size, t.sel, t.text])
      if (![400, 500, 600, 700].includes(t.weight)) badWeight.push([t.sel, t.weight, t.text])
      else if (t.weight === 600 && !/Inter/i.test(t.family)) badWeight.push(['(中文 600 伪粗体)', t.weight, t.sel, t.text])
      else if (t.weight > 700) badWeight.push([t.sel, t.weight, t.text])
      if (typeof t.lh === 'number' && t.size >= 12 && LH_BY_SIZE[t.size] !== undefined && t.lh !== LH_BY_SIZE[t.size]) badLh.push([t.sel, t.size, t.lh, t.text])
      if (t.ls !== 0 && !(t.ls === -1 && /Inter/i.test(t.family))) badLs.push([t.sel, t.ls, t.text])
    }
    check(where + '：字号全部在规范档位内', badSize.length === 0, badSize.slice(0, 12))
    check(where + '：字重全部合法（中文 400/500/700，数字可用 600）', badWeight.length === 0, badWeight.slice(0, 12))
    check(where + '：行高与字号匹配规范', badLh.length === 0, badLh.slice(0, 12))
    check(where + '：字距为 0（指标数字允许 -1px）', badLs.length === 0, badLs.slice(0, 12))
    sweepIssues.push({ where, badSize, badWeight, badLh, badLs })
    return list
  }

  const shot = async (send, name, width, height) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  }

  /* ================= 桌面：工作台（≥1100） ================= */
  {
    const { targetId, send } = await newPage()
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
    await openPage(send, `${origin}/editor/${fixtureId}`)

    /* 角色断言（选中态的页签按规范用 700 强调，所以断言未选中的那个） */
    await assertRole(send, '工作台 · 作品名（14px 内容小标题 700/22）', '.csProject__name', { size: 14, weight: 700, lh: 22, ls: 0 })
    await assertRole(send, '工作台 · 模式切换按钮（导航·标签 13/500/20）', '.csModeSeg button:not(.on)', SPEC.label)
    await assertRole(send, '工作台 · 模式切换选中态（导航·标签强调 700/20）', '.csModeSeg button.on', { size: 13, weight: 700, lh: 20, ls: 0 })
    await assertRole(send, '工作台 · 导出主按钮（卡片标题·主按钮 15/700/24）', '.csAction--dark', SPEC.card)
    await assertRole(send, '工作台 · 次按钮（导航·标签·次按钮 13/500/20）', '.csAction--plain', SPEC.label)
    await assertRole(send, '工作台 · 命令行按钮（导航·标签 13/500/20）', '.csCmd__btn:not(.on)', SPEC.label)
    await assertRole(send, '工作台 · 视图页签（导航·标签 13/500/20）', '.csViews button:not(.on)', SPEC.label)
    await assertRole(send, '工作台 · 右侧入口（导航·标签 13/500/20）', '.csSide__row', SPEC.label)
    await assertRole(send, '工作台 · 状态栏（紧凑元信息 11/400/18）', '.csStatus', { size: 11, weight: 400, lh: 18, ls: 0 })
    await sweep(send, '工作台 1600', '.studio--console')
    await shot(send, 'console-desktop')

    /* 右侧面板展开后再扫一次 */
    await evalJs(send, `(() => { const b = [...document.querySelectorAll('.csSide button')].find(x => x.textContent.includes('我的库存')); b && b.click(); return 1 })()`)
    await sleep(900)
    await sweep(send, '工作台 1600（弹窗打开）', '.studio--console')
    await evalJs(send, `document.querySelector('.dialog__head .iconbtn')?.click(); 1`)
    await sleep(300)
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  /* ================= 桌面：个人中心 ================= */
  {
    const { targetId, send } = await newPage()
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
    await openPage(send, `${origin}/account`)

    await assertRole(send, '个人中心 · 页面主标题（Title/Page 28/700/40）', '.acHero h1', SPEC.page)
    await assertRole(send, '个人中心 · 副句（正文 14/400/22）', '.acHero__text p', SPEC.body)
    await assertRole(send, '个人中心 · 概览指标（Number/Metric 30/600/38，-1px）', '.acStat__value b', SPEC.metric)
    await assertRole(send, '个人中心 · 卡片标题（Title/Section 18/700/28）', '.acCard__head h2', SPEC.section)
    await assertRole(send, '个人中心 · 导航项（导航·标签 13/500/20）', '.acNav__tab:not(.is-on)', SPEC.label)
    await assertRole(send, '个人中心 · 导航选中态（导航·标签强调 700/20）', '.acNav__tab.is-on', { size: 13, weight: 700, lh: 20, ls: 0 })
    await assertRole(send, '个人中心 · 辅助说明（辅助·紧凑标签 12/400/18）', '.acStat__note', SPEC.caption)
    await sweep(send, '个人中心 1600', '.ac')
    await shot(send, 'account-desktop')
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  /* ================= 手机：工作台 + 个人中心 ================= */
  {
    const { targetId, send } = await newPage()
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await openPage(send, `${origin}/editor/${fixtureId}`)
    await assertRole(send, '手机工作台 · 模式栏按钮（导航·标签 13/500/20）', '.msCmd button:not(.on)', SPEC.label)
    await assertRole(send, '手机工作台 · 工具轨（紧凑标签 12/500/18）', '.msTool:not(.on)', { size: 12, weight: 500, lh: 18, ls: 0 })
    await sweep(send, '手机工作台 390', '.studio--mobile')
    await shot(send, 'console-mobile')

    /* 切到「图纸转换」模式（那一档才有视图页签），再扫一次 */
    await evalJs(send, `(() => { const b = [...document.querySelectorAll('.msCmd button')].find(x => x.textContent.includes('图纸转换')); b && b.click(); return 1 })()`)
    await sleep(700)
    await assertRole(send, '手机工作台 · 视图页签（导航·标签 13/500/20）', '.msViews button:not(.on)', SPEC.label)
    await sweep(send, '手机工作台 390（图纸转换）', '.studio--mobile')

    /* 打开底部抽屉（颜色）再扫一次 */
    await evalJs(send, `(() => { const b = [...document.querySelectorAll('.msTool')].find(x => x.textContent.includes('颜色')); b && b.click(); return 1 })()`)
    await sleep(700)
    await sweep(send, '手机工作台 390（抽屉打开）', '.studio--mobile')
    await shot(send, 'console-mobile-sheet')
    await evalJs(send, `document.querySelector('.msScrim')?.click(); 1`)
    await sleep(300)

    await send('Page.navigate', { url: `${origin}/account` })
    await waitBridge(send); await sleep(1000)
    await sweep(send, '个人中心 390', '.ac')
    await shot(send, 'account-mobile')
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  /* ================= 平板（781–1099）：操作台仍走旧版三栏版面 ================= */
  {
    const { targetId, send } = await newPage()
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false })
    await openPage(send, `${origin}/editor/${fixtureId}`)
    await sweep(send, '平板工作台 900', '.studio--console')
    await shot(send, 'console-tablet')
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  /* ================= 全站页面：整页扫查（桌面 1440 + 手机 390）=================
     每页扫 #app 整棵树：站点顶栏、左侧导航、页脚、页面主体一起进范围 ——
     这次的目标就是「全站统一」，不再把共用组件排除在外。 */
  const SITE = [
    ['/', 'home', '.homeV3'],
    ['/materials', 'materials', '#app'],
    ['/materials/category/pets', 'materials-category', '#app'],
    ['/materials/asset-cc9bc456f7', 'asset-detail', '#app'],
    ['/projects', 'projects', '#app'],
    ['/inventory', 'inventory', '#app'],
    ['/settings', 'settings', '#app'],
    ['/help', 'help', '#app'],
    ['/colors', 'colors', '#app'],
    ['/tools/photo-to-bead-pattern/', 'tool', '#app'],
    ['/account', 'account', '#app'],
    ['/no-such-page', '404', '#app']
  ]
  for (const [path, name, root] of SITE) {
    for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
      const { targetId, send } = await newPage()
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 781 })
      await openPage(send, `${origin}${path}`)
      await sleep(700)
      await sweep(send, `${name} ${tag}`, root)
      await shot(send, `${name}-${tag}`, w, h)
      await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    }
  }

  /* ================= 后台：接口打桩后整页扫查 =================
     后台要登录才渲染，本机预览是只读的（写接口一律 503），线上接口也不让预览写。
     这里用 CDP Fetch 把 /api/v1/admin/* 拦下来回桩数据：
     auth/me 回一份带全部权限点的管理员，其余接口回空列表 ——
     目的是把版面渲染出来量字号，不验证后台业务。 */
  const ADMIN_PERMS = ['overview.view', 'activity.view', 'feedback.view', 'seo.view', 'seo.manage',
    'plan.manage', 'card.view', 'card.reveal', 'card.generate', 'card.export', 'card.revoke',
    'order.view', 'order.settle', 'order.refund', 'asset.view', 'asset.manage', 'user.view',
    'entitlement.view', 'entitlement.grant', 'setting.view', 'setting.manage', 'admin.manage', 'log.view']
  const ADMIN_ME = {
    id: 1, username: 'douwan', nickname: '豆玩管理员', role: 'super_admin', role_label: '超级管理员',
    status: 'active', permissions: ADMIN_PERMS,
    created_at: '2026-01-01T08:00:00+08:00', last_login_at: '2026-11-02T09:00:00+08:00'
  }
  const emptyData = () => ({
    items: [], list: [], rows: [], records: [], total: 0, page: 1, page_size: 20, days: 30,
    series: [], trend: [], buckets: [], by_day: [], by_hour: [], summary: {}, stats: {},
    regions: [], features: [], channels: [], pages: [], visitors: [], keywords: [],
    plans: [], cards: [], orders: [], assets: [], users: [], admins: [], logs: [], categories: [],
    groups: [], intents: [], targets: [], conflicts: [], checks: [], candidates: [], exclusions: [],
    /* SEO 概览页把 engines 当数组遍历、tasks 当对象读统计，这里按它的口径给空结构 */
    engines: [], tasks: { total: 0, pending: 0, success: 0, failed: 0, skipped: 0 },
    config: { engines: [] }, note: ''
  })
  const ADMIN = [
    ['/admin', 'admin-overview'],
    ['/admin/activity', 'admin-activity'],
    ['/admin/feedback', 'admin-feedback'],
    ['/admin/seo', 'admin-seo'],
    ['/admin/plans', 'admin-plans'],
    ['/admin/cards', 'admin-cards'],
    ['/admin/orders', 'admin-orders'],
    ['/admin/assets', 'admin-assets'],
    ['/admin/users', 'admin-users'],
    ['/admin/settings', 'admin-settings'],
    ['/admin/logs', 'admin-logs'],
    ['/admin/admins', 'admin-admins']
  ]
  for (const [path, name] of ADMIN) {
    for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
      const { targetId, sessionId, send } = await newPage()
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 781 })
      /* 只在这个 target 上开拦截：其它页面的真实请求不受影响 */
      await send('Fetch.enable', { patterns: [{ urlPattern: '*api/v1/admin/*', requestStage: 'Request' }] })
      const handler = (params, evSession) => {
        if (evSession !== sessionId) return
        const url = params.request.url
        const data = /\/admin\/auth\/me(\?|$)/.test(url) ? ADMIN_ME : emptyData()
        browser.send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
          body: Buffer.from(JSON.stringify({ code: 0, message: 'ok', data }), 'utf8').toString('base64')
        }, sessionId).catch(() => {})
      }
      browser.on('Fetch.requestPaused', handler)
      await send('Page.navigate', { url: `${origin}/` })
      await sleep(300)
      await evalJs(send, `localStorage.setItem('douwan-admin-tokens', JSON.stringify({ access_token: 'probe-access', refresh_token: 'probe-refresh' })); sessionStorage.setItem('douwan-upgrade-notice','1'); 1`)
      await send('Page.navigate', { url: `${origin}${path}` })
      await waitBridge(send); await sleep(1400)
      await sweep(send, `${name} ${tag}`, '#app')
      await shot(send, `${name}-${tag}`, w, h)
      await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    }
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1))
  fs.writeFileSync(path.join(OUT, 'sweep-issues.json'), JSON.stringify(sweepIssues, null, 1))
  const ok = report.filter(r => r.ok).length
  console.log('=== ' + ok + '/' + report.length + ' passed')
  browser.close(); chrome.kill(); if (server) server.close()
  if (ok !== report.length) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exit(1) })
