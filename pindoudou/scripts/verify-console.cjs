/* =========================================================================
   全屏创作工作台（≥1100px）版面与交互自检
   用法：node scripts/verify-console.cjs [--url http://127.0.0.1:4180]

   设计稿 124:2342「豆玩 v3.0 · 自由创作工作台」（1600×1000）：
     · 命令栏 66px / 命令行 50px / 文档行 44px / 状态栏 32px
     · 工具轨 (48,208) 84 宽 · 色板条宽 640（刚好 10 个颜色）距状态栏 16 · 右侧入口距右 28 宽 212
   这里先按设计稿量一遍几何，再逐项点真实控件（视图页签 / 网格 / 钉板 /
   工具轨 / 色板 / 右侧抽屉 / 撤销重做镜像 / 反馈 / 保存 / 改名 / 导出），
   最后在 1280×800 这一档复核三行命令栏撑满视口 ——
   基样式 .studio 是 grid + align-items:start，只改 display:flex 时
   1100~1319 这一档会缩成内容宽、右侧空一条（已踩过一次）。
   产物：.tmp/verify-console/（截图 + layout.json + report.json）
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.tmp', 'verify-console')
fs.mkdirSync(OUT, { recursive: true })
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' }
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
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result)
      }
    })
  }
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

async function main() {
  /* --url <base>：不自己起静态服务器，直接审一个已经跑着的实例（例如 .tmp/preview.cjs） */
  const urlIdx = process.argv.indexOf('--url')
  const external = urlIdx > 0 ? String(process.argv[urlIdx + 1] || '').replace(/\/+$/, '') : ''
  const server = external ? null : await staticServer()
  const origin = external || `http://127.0.0.1:${server.address().port}`
  const port = 9600 + (process.pid % 300)
  const profile = fs.mkdtempSync(path.join(ROOT, '.tmp', 'probe-chrome-'))
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
    return { targetId: t.targetId, send }
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

  // 预置作品
  {
    const { targetId, send } = await newPage()
    await send('Page.navigate', { url: `${origin}/` })
    await waitBridge(send)
    await evalJs(send, `(() => { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('douzao-')) keys.push(k) } keys.forEach(k => localStorage.removeItem(k)); return keys.length })()`)
    await send('Page.reload', { ignoreCache: true })
    await waitBridge(send); await sleep(400)
    const r = await evalJs(send, fixtureSrc)
    if (r && r.projectId) fixtureId = r.projectId
    console.log('fixture:', JSON.stringify(r))
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  const shotEl = async (send, selector, name, scale = 1, beyond = true) => {
    const rect = await evalJs(send, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
    if (!rect) { console.log('shotEl missing', selector); return }
    /* beyond=false：固定定位的浮层（选色面板）在「拍整页」模式下会跟着临时视口重排，拍不到 */
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale }, captureBeyondViewport: beyond })
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'))
    console.log('shot', name, JSON.stringify(rect))
  }

  // ---------- 桌面 1600×1000 ----------
  const { targetId, send } = await newPage()
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${origin}/` })
  await sleep(400)
  await evalJs(send, `sessionStorage.setItem('douwan-upgrade-notice','1'); localStorage.setItem('douwan.guide.v1','1'); 1`)
  await send('Page.navigate', { url: `${origin}/editor/${fixtureId}` })
  await waitBridge(send); await sleep(1200)

  const report = []
  const check = (name, ok, extra) => { report.push({ name, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')) }

  // 控制台报错
  await send('Runtime.enable')
  const errors = []
  await send('Log.enable').catch(() => {})

  const layout = await evalJs(send, `(() => {
    const q = s => document.querySelector(s)
    const r = s => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    return {
      vw: innerWidth, vh: innerHeight,
      top: r('.csTop'), cmd: r('.csCmd'), doc: r('.csDoc'), status: r('.csStatus'),
      modeSeg: r('.csModeSeg'), modeGone: !q('.csModeSeg'), views: r('.csViews'),
      canvas: r('.studio__canvas'), card: r('.canvasCard'), stage: r('.stage'),
      rail: r('.csRail'), palette: r('.csPalette'), side: r('.csSide'),
      /* 工具栏：默认展开（用户 2026-11-03 定）；收起后画布左上角是一颗青柠按钮 */
      railOpen: !!q('.csRail.is-open'),
      railToggle: r('.csRail__toggle'),
      railCollapse: r('.csRail__collapse'),
      railSwatch: r('.csRail__swatch'),
      railSize: r('.csRail__size'),
      /* 色板：底部横向色板条与右栏「色板」卡都撤掉了，入口是工具轨底部的当前颜色色块 */
      paletteCardInSide: (() => { const c = q('[data-palette-card]'); const s = q('.csSide'); return !!(c && s && s.contains(c)) })(),
      sideOrder: [...(q('.csSide') ? q('.csSide').children : [])].map(el => {
        const t = (el.textContent || '').replace(/\\s+/g, ' ').trim()
        if (el.hasAttribute('data-size-card')) return '成品尺寸'
        return t.slice(0, 4)
      }),
      paletteCells: document.querySelectorAll('[data-palette-code]').length,
      paletteArrows: document.querySelectorAll('.csPalette__arrow').length,
      chevInfo: [...document.querySelectorAll('.csSide__chev')].map(c => { const r = c.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) } }),
      sideRows: [...document.querySelectorAll('.csSide__row')].map(row => { const rr = row.getBoundingClientRect(); const c = row.querySelector('.csSide__chev'); const cr = c && c.getBoundingClientRect(); return { row: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)], chev: cr ? [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)] : null } }),
      tabs: [...document.querySelectorAll('.csViews button')].map(b => b.textContent.trim()),
      railTools: [...document.querySelectorAll('.csTools .csTool')].map(b => (b.textContent || '').trim()),
      /* 工具轨的几何：设计稿 151:2 里图标与文字落在外框中线上，未选中只有图标 + 文字、没有线框 */
      railGeom: (() => {
        const rail = document.querySelector('.csRail')
        if (!rail) return null
        const rb = rail.getBoundingClientRect()
        return {
          railCx: +(rb.x + rb.width / 2).toFixed(1),
          railW: +rb.width.toFixed(1),
          tools: [...document.querySelectorAll('.csTools .csTool')].map(b => {
            const br = b.getBoundingClientRect()
            const svg = b.querySelector('svg')
            const lbl = b.querySelector('.toolLabel')
            const cs = getComputedStyle(b)
            return {
              label: (b.textContent || '').trim(),
              on: b.classList.contains('on'),
              btnCx: +(br.x + br.width / 2).toFixed(1),
              btnW: +br.width.toFixed(1),
              iconCx: svg ? +(svg.getBoundingClientRect().x + svg.getBoundingClientRect().width / 2).toFixed(1) : null,
              labelCx: lbl ? +(lbl.getBoundingClientRect().x + lbl.getBoundingClientRect().width / 2).toFixed(1) : null,
              borderColor: cs.borderTopColor,
              borderWidth: cs.borderTopWidth,
              bg: cs.backgroundColor
            }
          })
        }
      })(),
      docTab: (q('.csDoc__tab') || {}).textContent,
      brandBtn: [...document.querySelectorAll('.csBoard__btn')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
      topButtons: [...document.querySelectorAll('.csActions .csAction, .csActions .csIconBtn')].map(b => b.textContent.trim() || b.getAttribute('title')),
      scrollW: document.documentElement.scrollWidth
    }
  })()`)
  console.log('layout:', JSON.stringify(layout, null, 1))
  fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 1))
  check('页面无横向溢出', layout.scrollW <= layout.vw, { scrollW: layout.scrollW, vw: layout.vw })
  /* 自由画布和顶栏模式开关已取消：打开作品就是图纸转换，页签不再出现在顶栏 */
  check('顶栏没有自由画布 / 图纸转换切换',
    layout.modeGone && !(layout.topButtons || []).some(t => /自由画布|图纸转换/.test(String(t))),
    { modeSeg: layout.modeSeg, top: layout.topButtons })
  check('视图页签已从顶栏拿掉', layout.tabs.length === 0, layout.tabs)
  check('右侧色板文案不重复', (layout.brandBtn || []).some(t => t === 'MARD 291 色'), layout.brandBtn)
  /* 用户 2026-11-03：左侧绘图工具栏默认展开，进工作台就能直接选工具 */
  check('工具栏默认展开（10 颗工具 + 当前颜色 + 收起箭头）',
    layout.railOpen && layout.railTools.length === 10 && !layout.railToggle &&
    !!layout.railSwatch && !!layout.railCollapse,
    { railOpen: layout.railOpen, toggle: layout.railToggle, tools: layout.railTools.length, swatch: layout.railSwatch, collapse: layout.railCollapse })
  /* 设计稿 1:2445：底部横向色板条撤掉了；色板入口从右栏搬到左侧工具轨的当前颜色色块 */
  check('底部横向色板条已撤掉', !layout.palette, layout.palette)
  check('右栏不再有色板卡（入口搬到工具轨的当前颜色色块）',
    !layout.paletteCardInSide && layout.sideOrder.join(',') === '作品分析,我的库存,颜色用量,分板',
    { order: layout.sideOrder, inSide: layout.paletteCardInSide })
  check('右侧入口贴设计位（右距 28，宽 212）', Math.round(1600 - layout.side.x - layout.side.w) === 28 && layout.side.w === 212, layout.side)

  /* 顶栏账户入口：未登录显示「登录」，登录后显示「个人中心」 */
  check('顶栏账户入口未登录时是「登录」', (layout.topButtons || []).includes('登录'), layout.topButtons)
  /* 用户要求去掉顶栏右上角的「我的作品」入口（作品列表走个人中心） */
  check('顶栏右上角没有「我的作品」入口',
    !(layout.topButtons || []).some(t => String(t).includes('我的作品')), layout.topButtons)

  /* ---------- 量展开态的工具栏（默认就是展开，不用先点开） ---------- */
  await sleep(400)
  const railOpenState = await evalJs(send, `(() => {
    const q = s => document.querySelector(s)
    const r = s => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    const rail = q('.csRail')
    const rb = rail.getBoundingClientRect()
    return {
      open: rail.classList.contains('is-open'),
      box: { x: Math.round(rb.x), y: Math.round(rb.y), w: Math.round(rb.width), h: Math.round(rb.height) },
      railCx: +(rb.x + rb.width / 2).toFixed(1),
      tools: [...document.querySelectorAll('.csTools .csTool')].map(b => {
        const br = b.getBoundingClientRect()
        const svg = b.querySelector('svg')
        const lbl = b.querySelector('.toolLabel')
        const cs = getComputedStyle(b)
        return {
          label: (b.textContent || '').trim(),
          on: b.classList.contains('on'),
          btnCx: +(br.x + br.width / 2).toFixed(1),
          btnW: +br.width.toFixed(1),
          iconCx: svg ? +(svg.getBoundingClientRect().x + svg.getBoundingClientRect().width / 2).toFixed(1) : null,
          labelCx: lbl ? +(lbl.getBoundingClientRect().x + lbl.getBoundingClientRect().width / 2).toFixed(1) : null,
          borderColor: cs.borderTopColor,
          borderWidth: cs.borderTopWidth,
          bg: cs.backgroundColor
        }
      }),
      swatch: r('.csRail__swatch'),
      sizeToggles: [...document.querySelectorAll('[data-tool-size]')].map(b => b.getAttribute('data-tool-size')),
      collapse: r('.csRail__collapse')
    }
  })()`)
  console.log('railOpen:', JSON.stringify(railOpenState))
  check('展开的工具栏：完整工具 + 撤销/重做/左右镜像',
    railOpenState.open && railOpenState.tools.slice(0, 7).map(t => t.label).join(',') === '移动,画笔,橡皮,填充,吸色,换色,去除杂色' &&
    railOpenState.tools.length === 10, railOpenState.tools.map(t => t.label))
  check('展开的工具栏带当前颜色，画笔和橡皮各有尺寸箭头，底部有收起箭头',
    !!railOpenState.swatch && !!railOpenState.collapse &&
    railOpenState.sizeToggles.join(',') === 'paint,erase', {
      swatch: railOpenState.swatch, toggles: railOpenState.sizeToggles, collapse: railOpenState.collapse
    })
  check('展开的工具栏贴左侧 48、宽 84', railOpenState.box.x === 48 && railOpenState.box.y === 208 && railOpenState.box.w === 84, railOpenState.box)
  /* 图标与文字要和长外框同一条中线（设计稿 151:2） */
  check('工具轨图标与外框中线对齐', railOpenState.tools.length > 0 && railOpenState.tools.every(t => t.iconCx !== null && Math.abs(t.iconCx - railOpenState.railCx) <= 1), { railCx: railOpenState.railCx, off: railOpenState.tools.map(t => [t.label, t.iconCx]) })
  check('工具轨文字与外框中线对齐', railOpenState.tools.every(t => t.labelCx !== null && Math.abs(t.labelCx - railOpenState.railCx) <= 1), railOpenState.tools.map(t => [t.label, t.labelCx]))
  check('工具轨按钮不溢出外框内容盒', railOpenState.tools.every(t => t.btnW <= railOpenState.box.w - 2), railOpenState.tools.map(t => [t.label, t.btnW]))
  /* 未选中的工具只有图标 + 文字，没有线框（设计稿 151:2） */
  check('未选中工具没有线框', railOpenState.tools.filter(t => !t.on).every(t => t.borderColor === 'rgba(0, 0, 0, 0)' || t.borderWidth === '0px'), railOpenState.tools.filter(t => !t.on).map(t => [t.label, t.borderWidth, t.borderColor]))
  check('选中工具是实心青柠', railOpenState.tools.filter(t => t.on).every(t => t.bg === 'rgb(200, 230, 60)'), railOpenState.tools.filter(t => t.on).map(t => [t.label, t.bg]))
  await shotEl(send, '.csRail', 'rail-open')

  /* 收起箭头：点一下回到折叠态 */
  await evalJs(send, `document.querySelector('[data-rail-collapse]').click(); 1`)
  await sleep(300)
  const railClosed = await evalJs(send, `(() => { const rail = document.querySelector('.csRail'); return { open: rail.classList.contains('is-open'), toggle: !!document.querySelector('[data-rail-toggle]') } })()`)
  check('点收起箭头回到折叠态', railClosed.open === false && railClosed.toggle === true, railClosed)
  /* 再点开，后面的工具交互要在展开态上跑 */
  await evalJs(send, `document.querySelector('[data-rail-toggle]').click(); 1`)
  await sleep(300)

  await shotEl(send, '.csTop', 'top')
  await shotEl(send, '.csCmd', 'cmd')
  await shotEl(send, '.csDoc', 'doc')
  await shotEl(send, '.csSide', 'side')
  await shotEl(send, '.csStatus', 'status')

  check('打开存档后顶栏仍没有模式切换',
    await evalJs(send, `!document.querySelector('.csModeSeg')`), true)

  /* 成品尺寸在钉板下拉的自定义尺寸下面；智能抠图占原来图纸调整的位置。 */
  {
    await evalJs(send, `(async () => {
      const d = window.__douzao
      const [A, S] = await Promise.all([d.assets(), d.studio()])
      /* 画布上已有作品时 useAsset 会等「要不要保存」；脚本里直接继续换图 */
      S.setReplaceConfirm(() => true)
      const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
      await S.useAsset(asset)
      return 1
    })()`)
    for (let i = 0; i < 30; i++) {
      const ready = await evalJs(send, `(async () => { const S = await window.__douzao.studio(); return !!(S.pattern.value && S.pattern.value.cells && S.pattern.value.cells.length) })()`)
      if (ready) break
      await sleep(200)
    }
    await sleep(500)
    const merged = await evalJs(send, `(() => {
      const txt = el => (el ? el.textContent : '').replace(/\\s+/g, ' ').trim()
      const cmd = document.querySelector('.csCmd')
      const side = document.querySelector('.csSide')
      const board = cmd && cmd.querySelector('[data-cmd-board]')
      const matte = cmd && cmd.querySelector('[data-cmd-matte]')
      const brand = cmd && cmd.querySelector('[data-cmd-brand]')
      const adjust = cmd && [...cmd.querySelectorAll('button')].some(b => /图纸调整/.test(txt(b)))
      return {
        topMatte: !!(matte && /智能抠图/.test(txt(matte))),
        afterBoard: board && board.nextElementSibling === matte,
        beforeBrand: !!(matte && brand && matte.nextElementSibling === brand),
        noAdjust: !adjust,
        sideAdjust: !!(side && [...side.querySelectorAll('button')].some(b => /图纸调整|智能抠图|成品尺寸/.test(txt(b)))),
        sideFirst: txt(side && side.firstElementChild)
      }
    })()`)
    check('命令栏：智能抠图在钉板旁边，没有图纸调整，右侧也没有',
      merged.topMatte && merged.afterBoard && merged.beforeBrand && merged.noAdjust && !merged.sideAdjust,
      merged)

    await evalJs(send, `document.querySelector('[data-cmd-board] .csBoard__btn').click(); 1`)
    await sleep(400)
    const boardSize = await evalJs(send, `(() => {
      const pop = document.querySelector('[data-cmd-board] .csPop')
      const custom = pop && pop.querySelector('[data-board-custom]')
      const size = pop && pop.querySelector('[data-board-finish] [data-size-card]')
      const following = custom && size ? (custom.compareDocumentPosition(size) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false
      return {
        open: !!pop,
        custom: !!custom,
        size: !!(size && size.querySelector('.szq__range')),
        sizeAfterCustom: following,
        matte: !!(pop && pop.querySelector('[data-adjust-matte]'))
      }
    })()`)
    check('钉板下拉：成品尺寸在自定义尺寸下面，没有智能抠图',
      boardSize.open && boardSize.custom && boardSize.size && boardSize.sizeAfterCustom && !boardSize.matte,
      boardSize)
    await evalJs(send, `document.querySelector('[data-cmd-board] .csBoard__btn').click(); 1`)
    await sleep(200)

    await evalJs(send, `document.querySelector('[data-side-matte]').click(); 1`)
    await sleep(400)
    const mattePanel = await evalJs(send, `(() => {
      const txt = el => (el ? el.textContent : '').replace(/\\s+/g, ' ').trim()
      const d = document.querySelector('.csMattePop')
      const matte = d && d.querySelector('[data-adjust-matte]')
      return {
        open: !!d,
        size: !!(d && d.querySelector('.szq__range')),
        matte: !!matte,
        matteSwitch: !!(matte && matte.querySelector('[role="switch"]')),
        settings: /图纸设置|图纸调整/.test(txt(d)),
        oldAdjust: /原图调整|亮度|对比度|饱和度/.test(txt(d))
      }
    })()`)
    check('智能抠图下拉：只有抠图开关，没有成品尺寸 / 图纸设置',
      mattePanel.open && mattePanel.matte && mattePanel.matteSwitch &&
      !mattePanel.size && !mattePanel.settings && !mattePanel.oldAdjust,
      mattePanel)

    /* 真点智能抠图开关：三档力度出现；选「保守」写回 options；再关掉。
       预置作品可能本来就开着抠图，先按真实开关把它关掉，保证下面从「关」开始。 */
    await evalJs(send, `(() => {
      const sw = document.querySelector('[data-adjust-matte] [role="switch"]')
      if (sw && sw.getAttribute('aria-checked') === 'true') sw.click()
      return 1
    })()`)
    await sleep(700)
    await evalJs(send, `document.querySelector('[data-adjust-matte] [role="switch"]').click(); 1`)
    await sleep(600)
    const matteOn = await evalJs(send, `(() => {
      const txt = el => (el ? el.textContent : '').replace(/\\s+/g, ' ').trim()
      const box = document.querySelector('[data-adjust-matte]')
      const sw = box && box.querySelector('[role="switch"]')
      const levels = [...(box ? box.querySelectorAll('.iap__levels button') : [])].map(txt)
      return { checked: sw && sw.getAttribute('aria-checked'), levels }
    })()`)
    check('智能抠图：打开后出现 保守 / 标准 / 激进 三档',
      matteOn.checked === 'true' && matteOn.levels.join('/') === '保守/标准/激进', matteOn)

    await evalJs(send, `[...document.querySelectorAll('[data-adjust-matte] .iap__levels button')].find(b => b.textContent.includes('保守')).click(); 1`)
    await sleep(600)
    const matteLevel = await evalJs(send, `(async () => { const S = await window.__douzao.studio(); return S.options.matteLevel })()`)
    check('智能抠图：力度选「保守」写回状态', matteLevel === 'soft', matteLevel)

    await evalJs(send, `document.querySelector('[data-adjust-matte] [role="switch"]').click(); 1`)
    await sleep(600)
    const matteOff = await evalJs(send, `(async () => {
      const S = await window.__douzao.studio()
      const sw = document.querySelector('[data-adjust-matte] [role="switch"]')
      return { removeBg: S.options.removeBg, checked: sw && sw.getAttribute('aria-checked') }
    })()`)
    check('智能抠图：再点开关关掉', matteOff.removeBg === false && matteOff.checked === 'false', matteOff)

    await evalJs(send, `document.querySelector('[data-side-matte]').click(); 1`)
    await sleep(400)
    const closed = await evalJs(send, `!document.querySelector('.csMattePop')`)
    check('再点智能抠图收起下拉', closed === true, { closed })
  }

  // 交互：网格开关
  const gridBefore = await evalJs(send, `document.querySelector('.csToggle').getAttribute('aria-pressed')`)
  await evalJs(send, `document.querySelector('.csToggle').click(); 1`)
  await sleep(300)
  const gridAfter = await evalJs(send, `document.querySelector('.csToggle').getAttribute('aria-pressed')`)
  check('网格开关可切换', gridBefore !== gridAfter, { gridBefore, gridAfter })
  await evalJs(send, `document.querySelector('.csToggle').click(); 1`)
  await sleep(200)

  // 交互：钉板下拉
  await evalJs(send, `document.querySelector('.csBoard__btn').click(); 1`)
  await sleep(300)
  const boardItems = await evalJs(send, `[...document.querySelectorAll('.csBoard__item')].map(b => b.textContent.replace(/\\s+/g,' ').trim())`)
  const boardHasCustom = boardItems.some(t => /自定义尺寸/.test(t))
  const boardHint = await evalJs(send, `(document.querySelector('[data-board-multiple-hint]') || {}).textContent || ''`)
  check('钉板下拉有 4 个规格，下面一项是自定义尺寸', boardItems.length === 5 && boardHasCustom && /多拼几块板/.test(boardHint), { boardItems, boardHint })
  await shotEl(send, '.csBoard', 'board-open')
  await evalJs(send, `document.body.click(); 1`)
  await sleep(200)

  // 交互：工具轨（当前工具看 .csTool.on）
  await evalJs(send, `[...document.querySelectorAll('.csRail .csTool')].find(b => b.textContent.includes('橡皮')).click(); 1`)
  await sleep(300)
  const toolNow = await evalJs(send, `(document.querySelector('.csRail .csTool.on') || {}).textContent`)
  check('点工具轨切换当前工具', /橡皮/.test((toolNow || '').replace(/\s/g, '')), toolNow)
  await evalJs(send, `[...document.querySelectorAll('.csRail .csTool')].find(b => b.textContent.includes('画笔')).click(); 1`)
  await sleep(200)

  /* 画笔 / 橡皮尺寸卡（设计稿 124:84 / 124:2）：箭头展开，1–5 颗，两支笔各记各的 */
  await evalJs(send, `document.querySelector('[data-tool-size="paint"]').click(); 1`)
  await sleep(350)
  const brushCard = await evalJs(send, `(() => {
    const card = document.querySelector('[data-brush-size]')
    const rail = document.querySelector('.csRail')
    const btn = document.querySelector('[data-tool-key="paint"]')
    if (!card || !rail || !btn) return { open: false }
    const c = card.getBoundingClientRect()
    const r = rail.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    return {
      open: true,
      w: Math.round(c.width), h: Math.round(c.height),
      gap: Math.round(c.left - r.right),
      dy: Math.round((c.top + c.height / 2) - (b.top + b.height / 2)),
      text: card.textContent.replace(/\\s+/g, ' '),
      inView: c.top >= 8 && c.bottom <= innerHeight - 8 && c.right <= innerWidth - 8
    }
  })()`)
  check('画笔尺寸卡贴在工具轨右侧 8px，156×81，对准画笔按钮',
    brushCard.open && brushCard.w === 156 && brushCard.h === 81 && brushCard.gap === 8 &&
    Math.abs(brushCard.dy) <= 2 && brushCard.inView &&
    /画笔大小/.test(brushCard.text) && /1 颗/.test(brushCard.text) &&
    /1–5 颗/.test(brushCard.text) && /格 \/ 颗/.test(brushCard.text), brushCard)
  await shotEl(send, 'body', 'brush-size-open', 1, false)
  await evalJs(send, `(() => { const range = document.querySelector('[data-brush-range]'); range.value = '3'; range.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(150)
  await evalJs(send, `document.querySelector('[data-tool-size="erase"]').click(); 1`)
  await sleep(300)
  const splitSize = await evalJs(send, `(async () => {
    const S = await window.__douzao.studio()
    const range = document.querySelector('[data-brush-range]')
    range.value = '2'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 80))
    const card = document.querySelector('[data-brush-size]')
    const text = card ? card.textContent.replace(/\\s+/g, ' ') : ''
    const snap = { text, brush: S.brushSize.value, eraser: S.eraserSize.value, tool: S.tool.value }
    const cur = () => S.pattern.value
    const w = cur().width
    const x = Math.min(10, Math.max(2, w - 3))
    const y = Math.min(10, Math.max(2, cur().height - 3))
    const at = (xx, yy) => { const p = cur(); return p.cells[yy * p.width + xx] }
    S.tool.value = 'erase'
    S.setToolSize(5, 'erase')
    const cleared = S.paintAt(x, y)
    const emptyId = at(x, y)
    S.tool.value = 'paint'
    S.setToolSize(3, 'paint')
    const painted = S.paintAt(x, y)
    let block = 0
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (at(xx, yy) !== emptyId) block++
    S.tool.value = 'erase'
    S.setToolSize(2, 'erase')
    const erased = S.paintAt(x, y)
    const kept = at(x + 1, y + 1) !== emptyId
    const gone = at(x - 1, y - 1) === emptyId
    if (erased) S.undo()
    if (painted) S.undo()
    if (cleared) S.undo()
    S.tool.value = 'paint'
    S.setToolSize(1, 'paint')
    S.setToolSize(1, 'erase')
    return { ...snap, block, kept, gone, cleared, painted, erased, emptyId }
  })()`)
  check('画笔 3 颗与橡皮 2 颗各自生效，改橡皮不改画笔',
    splitSize.tool === 'erase' && /橡皮大小/.test(splitSize.text) && /2 颗/.test(splitSize.text) &&
    splitSize.brush === 3 && splitSize.eraser === 2 && splitSize.block === 9 && splitSize.kept && splitSize.gone, splitSize)
  const sizeClosed = await evalJs(send, `(async () => {
    document.querySelector('.csStatus').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    for (let i = 0; i < 15; i++) {
      if (!document.querySelector('[data-brush-size]')) return true
      await new Promise(r => setTimeout(r, 40))
    }
    return false
  })()`)
  check('点尺寸卡外面就收起', sizeClosed === true, { sizeClosed })

  // 交互：色板（工具轨底部的当前颜色色块 → 向右滑出选色面板：系列 → 色系 → 搜索 → 多行网格）
  await evalJs(send, `document.querySelector('.csRail__swatch').click(); 1`)
  await sleep(400)
  const paletteCard = await evalJs(send, `(() => {
    const q = s => document.querySelector(s)
    const t = s => { const el = q(s); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '' }
    const box = s => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) } }
    const fly = q('[data-palette-flyout]')
    const grid = q('[data-palette-grid]')
    const cells = grid ? [...grid.querySelectorAll('[data-palette-code]')] : []
    const rows = new Set(cells.map(c => Math.round(c.getBoundingClientRect().y)))
    const select = q('[data-palette-brand]')
    return {
      open: !!fly,
      fly: box('[data-palette-flyout]'),
      rail: box('.csRail'),
      swatch: box('.csRail__swatch'),
      inSide: (() => { const c = q('[data-palette-card]'); const s = q('.csSide'); return !!(c && s && s.contains(c)) })(),
      hasHead: !!q('[data-palette-toggle]'),
      hasBrand: !!select, brand: select ? select.options.length : 0,
      families: [...document.querySelectorAll('[data-palette-family]')].map(b => b.textContent.trim()),
      hasSearch: !!q('[data-palette-search]'),
      cells: cells.length, rows: rows.size,
      current: t('[data-palette-current]'),
      vw: innerWidth, vh: innerHeight
    }
  })()`)
  console.log('paletteFly:', JSON.stringify(paletteCard))
  check('点当前颜色色块：选色面板向右滑出', paletteCard.open && !!paletteCard.fly, paletteCard)
  check('选色面板在工具轨右边，整块落在视口内',
    !!paletteCard.fly && paletteCard.fly.x >= paletteCard.rail.right + 8 &&
    paletteCard.fly.y >= 12 && paletteCard.fly.bottom <= paletteCard.vh - 12,
    { fly: paletteCard.fly, rail: paletteCard.rail, vh: paletteCard.vh })
  check('选色面板宽度与右栏入口一致（212）', !!paletteCard.fly && paletteCard.fly.w === 212, paletteCard.fly)
  check('选色面板不在右栏里', !paletteCard.inSide, paletteCard.inSide)
  check('选色面板：有色卡系列下拉、色系筛选、搜索框', paletteCard.hasBrand && paletteCard.brand > 1 && paletteCard.families.length >= 2 && paletteCard.hasSearch, paletteCard)
  check('选色面板是多行网格（不是一行色块）', paletteCard.cells > 4 && paletteCard.rows >= 2, paletteCard)
  /* 选一个颜色：画笔当前色跟着换 */
  const code = await evalJs(send, `(() => { const c = document.querySelectorAll('[data-palette-code]')[1]; if (!c) return ''; c.click(); return c.textContent.trim() })()`)
  await sleep(400)
  const brushCode = await evalJs(send, `((document.querySelector('.csRail__swatch') || {}).getAttribute('title') || '')`)
  check('点色板切换画笔色', !!code && brushCode.includes(code), { code, brushCode })
  /* 搜索：按色号过滤 */
  await evalJs(send, `(() => { const i = document.querySelector('[data-palette-search]'); i.value = 'A2'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
  await sleep(400)
  const searched = await evalJs(send, `(() => { const cells = [...document.querySelectorAll('[data-palette-code]')]; return { n: cells.length, codes: cells.slice(0, 5).map(c => c.textContent.trim()) } })()`)
  check('色板可按色号搜索', searched.n > 0 && searched.n < paletteCard.cells && searched.codes.every(c => /A2/i.test(c)), searched)
  await shotEl(send, '[data-palette-flyout]', 'palette-flyout-open', 1, false)
  await shotEl(send, 'body', 'palette-flyout-page', 1, false)

  /* 收起的三个出口：再点一次色块 / 点面板外面 / Esc（等状态落定，不靠固定 sleep） */
  const waitFly = async want => {
    for (let i = 0; i < 25; i++) {
      const open = await evalJs(send, `!!document.querySelector('[data-palette-flyout]')`)
      if (open === want) return true
      await sleep(100)
    }
    return false
  }
  await evalJs(send, `document.querySelector('.csRail__swatch').click(); 1`)
  check('再点一次色块收起选色面板', await waitFly(false), await evalJs(send, `(document.querySelector('.csRail__swatch') || {}).getAttribute && document.querySelector('.csRail__swatch').getAttribute('aria-expanded')`))
  await evalJs(send, `document.querySelector('.csRail__swatch').click(); 1`)
  await waitFly(true)
  await evalJs(send, `(() => { const el = document.querySelector('.csStatus'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return 1 })()`)
  check('点面板外面收起选色面板', await waitFly(false), await evalJs(send, `!!document.querySelector('[data-palette-flyout]')`))
  await evalJs(send, `document.querySelector('.csRail__swatch').click(); 1`)
  await waitFly(true)
  await evalJs(send, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`)
  check('Esc 收起选色面板', await waitFly(false), await evalJs(send, `!!document.querySelector('[data-palette-flyout]')`))

  // 交互：成品尺寸在钉板下拉的自定义尺寸下面，面板始终展开
  {
    await evalJs(send, `(() => { if (!document.querySelector('[data-board-finish]')) document.querySelector('[data-cmd-board] .csBoard__btn').click(); return 1 })()`)
    await sleep(400)
    const cardOpen = await evalJs(send, `(() => {
      const t = s => { const el = document.querySelector(s); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '' }
      const range = document.querySelector('[data-board-finish] .szq__range')
      const panel = document.querySelector('[data-board-finish] .szq__panel')
      return {
        inBoard: !!document.querySelector('[data-board-finish] [data-size-card]'),
        head: !!document.querySelector('[data-board-finish] .szq__head'),
        open: panel ? getComputedStyle(panel).display !== 'none' : false,
        title: t('[data-board-finish] .szq__introTop b'), intro: t('[data-board-finish] .szq__intro'),
        valueLabel: t('[data-board-finish] .szq__value span'), nowLabel: t('[data-board-finish] .szq__now span'),
        min: range ? range.min : '', max: range ? range.max : '', value: range ? range.value : ''
      }
    })()`)
    console.log('sizeCardOpen:', JSON.stringify(cardOpen))
    check('钉板下拉里的成品尺寸始终展开，没有收起卡头', cardOpen.inBoard && cardOpen.open && !cardOpen.head, cardOpen)
    check('成品尺寸卡文案与设计稿一致', cardOpen.intro === '默认锁定宽高比，整体等比例缩放' && cardOpen.valueLabel === '等比例缩放' && cardOpen.nowLabel === '当前尺寸' && cardOpen.title === '成品尺寸', cardOpen)
    check('滑杆上限 = 底板长边', Number(cardOpen.max) > 0 && Number(cardOpen.max) === Number(cardOpen.value), { min: cardOpen.min, max: cardOpen.max, value: cardOpen.value })
    /* beyond=false：captureBeyondViewport 会临时改视口，宽度跌破 1100 时命令栏浮层会被关掉 */
    await shotEl(send, '[data-cmd-board] .csPop', 'size-card', 1, false)

    // 滑杆改尺寸：真键盘方向键（Chrome 原生 range 会派发 input + change）
    await evalJs(send, `(() => { if (!document.querySelector('[data-board-finish] .szq__range')) document.querySelector('[data-cmd-board] .csBoard__btn').click(); return 1 })()`)
    await sleep(400)
    await evalJs(send, `(() => { const range = document.querySelector('[data-board-finish] .szq__range'); range.focus(); return 1 })()`)
    const beforeSize = await evalJs(send, `document.querySelector('.csStatus__line').textContent`)
    for (let i = 0; i < 3; i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
      await sleep(80)
    }
    /* 松手 240ms 后才落到画布，重算原图常常超过 1.6s。等到状态栏变掉，最多再等 16s。 */
    let afterSize = null
    for (let i = 0; i < 40; i++) {
      await sleep(400)
      afterSize = await evalJs(send, `(() => ({ status: document.querySelector('.csStatus__line').textContent, note: (document.querySelector('[data-board-finish] [data-size-card-note]') || {}).textContent || '', now: (document.querySelector('[data-board-finish] [data-size-card-current]') || {}).textContent || '' }))()`)
      if (afterSize.status !== beforeSize) break
    }
    console.log('sizeChanged:', JSON.stringify({ beforeSize, afterSize }))
    check('滑杆改成品尺寸（状态栏网格跟着变）', afterSize.status !== beforeSize && /格/.test(afterSize.status), { beforeSize, afterSize: afterSize.status })

    // 标注开关（原「更多设置」位置，按主要控件规范做的开关）：
    // 关 = 画布上的成品尺寸标注（W/H 尺寸线 + 厘米胶囊）隐藏，开 = 恢复
    const sw0 = await evalJs(send, `(() => { const b = document.querySelector('[data-board-finish] [data-size-card-switch]'); if (!b) return null; const r = b.getBoundingClientRect(); return { on: b.getAttribute('aria-checked'), w: Math.round(r.width), h: Math.round(r.height) } })()`)
    check('尺寸卡标题右侧有标注开关（默认开）', !!sw0 && sw0.on === 'true', sw0)
    await evalJs(send, `document.querySelector('[data-board-finish] [data-size-card-switch]').click(); 1`)
    await sleep(400)
    const swOff = await evalJs(send, `(() => { const r = document.querySelector('[data-canvas-ruler]'); const b = document.querySelector('[data-board-finish] [data-size-card-switch]'); return { dim: r && r.getAttribute('data-ruler-dim'), on: b && b.getAttribute('aria-checked') } })()`)
    check('关掉开关后画布成品尺寸标注隐藏', swOff.dim === 'off' && swOff.on === 'false', swOff)
    await shotEl(send, '[data-canvas-ruler]', 'ruler-dim-off', 1, false)
    await evalJs(send, `(() => { if (!document.querySelector('[data-board-finish] [data-size-card-switch]')) document.querySelector('[data-cmd-board] .csBoard__btn').click(); return 1 })()`)
    await sleep(400)
    await evalJs(send, `document.querySelector('[data-board-finish] [data-size-card-switch]').click(); 1`)
    await sleep(400)
    const swOn = await evalJs(send, `(() => { const r = document.querySelector('[data-canvas-ruler]'); const b = document.querySelector('[data-size-card-switch]'); return { dim: r && r.getAttribute('data-ruler-dim'), on: b.getAttribute('aria-checked'), cm: r && r.getAttribute('data-ruler-cm') } })()`)
    check('再开启后成品尺寸标注恢复', swOn.dim === 'on' && swOn.on === 'true' && !!swOn.cm && /cm/.test(swOn.cm), swOn)
  }

  /* ---------- 贴边标尺（设计稿 151:288 顶条 / 151:412 左条）：
     它是贴在画布视口顶边与左边的覆盖层，不跟图纸一起缩放平移；
     刻度与数字按「当前一格有多少屏幕像素」实时换算，换尺寸 / 缩放 / 平移都要跟着变 ---------- */
  {
    const rr = await evalJs(send, `(() => {
      const box = s => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
      const r = document.querySelector('[data-canvas-ruler]')
      const attrs = r ? {
        labels: r.getAttribute('data-ruler-labels'), rows: r.getAttribute('data-ruler-row-labels'),
        cell: Number(r.getAttribute('data-ruler-cell')), cols: Number(r.getAttribute('data-ruler-cols')),
        tick: Number(r.getAttribute('data-ruler-tick')), label: Number(r.getAttribute('data-ruler-label-step')),
        cm: r.getAttribute('data-ruler-cm')
      } : null
      return {
        has: !!r, wrap: box('.stageWrap'), board: box('.board'), canvas: box('.stage canvas'), ruler: box('[data-canvas-ruler]'),
        attrs, current: ((document.querySelector('[data-size-card-current]') || {}).textContent || '').trim()
      }
    })()`)
    console.log('ruler:', JSON.stringify(rr))
    const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
    check('标尺贴在画布视口上（与舞台同框，不跟图纸走）', rr.has && same(rr.ruler, rr.wrap), { ruler: rr.ruler, wrap: rr.wrap })
    check('标尺刻度按真实格宽换算（cell = 画布宽 / 格数）',
      !!rr.attrs && rr.attrs.cols === 52 && Math.abs(rr.attrs.cell - rr.canvas.w / rr.attrs.cols) < 0.5, rr.attrs)
    check('标尺有刻度数字（顶条 + 左条）',
      !!rr.attrs && rr.attrs.labels.includes('0') && rr.attrs.rows.length > 0, rr.attrs && { labels: rr.attrs.labels, rows: rr.attrs.rows })
    check('标尺的成品尺寸标注 = 当前成品尺寸',
      !!rr.attrs && rr.attrs.cm === rr.current.replace(/\s/g, ' ').trim(), { cm: rr.attrs && rr.attrs.cm, current: rr.current })
    const innerX = rr.wrap.x + 32
    const innerY = rr.wrap.y + 28
    const innerW = rr.wrap.w - 32
    const innerH = rr.wrap.h - 28
    const centered = !!rr.board &&
      Math.abs(rr.board.x + rr.board.w / 2 - (innerX + innerW / 2)) <= 3 &&
      Math.abs(rr.board.y + rr.board.h / 2 - (innerY + innerH / 2)) <= 3
    const fills = !!rr.board && (rr.board.w >= innerW * 0.92 || rr.board.h >= innerH * 0.92)
    check('图纸落在标尺内侧正中央，并沿一条边撑满标尺内侧', centered && fills,
      { board: rr.board, wrap: rr.wrap, centered, fills })
    await shotEl(send, '.stageWrap', 'ruler-pinned')

    /* 缩放：连点「放大」→ 格子变宽、刻度变稀、数字换一套 */
    for (let i = 0; i < 8; i++) {
      await evalJs(send, `[...document.querySelectorAll('.csStatus__btn')].find(b => b.getAttribute('aria-label') === '放大').click(); 1`)
      await sleep(250)
    }
    await sleep(800)
    const zoomed = await evalJs(send, `(() => { const r = document.querySelector('[data-canvas-ruler]'); const b = r.getBoundingClientRect(); return { cell: Number(r.getAttribute('data-ruler-cell')), labels: r.getAttribute('data-ruler-labels'), label: Number(r.getAttribute('data-ruler-label-step')), box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } } })()`)
    console.log('ruler zoomed:', JSON.stringify(zoomed))
    check('缩放后标尺数值实时重算',
      zoomed.cell > rr.attrs.cell && zoomed.labels !== rr.attrs.labels, { before: rr.attrs.cell, after: zoomed.cell, labels: zoomed.labels })
    check('缩放后标尺仍贴在视口上（位置不动）', same(zoomed.box, rr.wrap), { box: zoomed.box, wrap: rr.wrap })
    /* 按钮缩放以可见区中心为锚：放大后图纸中心仍压在标尺内侧中线上 */
    const zoomCenter = await evalJs(send, `(() => {
      const box = s => { const el = document.querySelector(s); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
      const b = box('.board'); const w = box('.stageWrap')
      return { dx: Math.round((b.x + b.w / 2) - (w.x + 32 + (w.w - 32) / 2)), dy: Math.round((b.y + b.h / 2) - (w.y + 28 + (w.h - 28) / 2)) }
    })()`)
    check('放大后图纸仍在标尺内侧正中央', Math.abs(zoomCenter.dx) <= 4 && Math.abs(zoomCenter.dy) <= 4, zoomCenter)

    /* 平移：把舞台滚开，数字跟着走 */
    const scrolled = await evalJs(send, `(() => { const s = document.querySelector('.stage'); s.scrollLeft = Math.round(s.scrollWidth / 2); s.scrollTop = Math.round(s.scrollHeight / 2); return { sl: s.scrollLeft, st: s.scrollTop } })()`)
    await sleep(600)
    const afterScroll = await evalJs(send, `(() => { const r = document.querySelector('[data-canvas-ruler]'); const b = r.getBoundingClientRect(); return { labels: r.getAttribute('data-ruler-labels'), rows: r.getAttribute('data-ruler-row-labels'), box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } } })()`)
    console.log('ruler scrolled:', JSON.stringify({ scrolled, afterScroll }))
    check('平移后标尺位置不动、数字跟着走',
      scrolled.sl + scrolled.st > 0 && same(afterScroll.box, rr.wrap) &&
      (afterScroll.labels !== zoomed.labels || afterScroll.rows !== zoomed.rows),
      { scrolled, labels: afterScroll.labels, rows: afterScroll.rows })
    await shotEl(send, '.stageWrap', 'ruler-scrolled')

    /* 还原缩放与滚动，后面的交互断言仍在原始视角上跑 */
    await evalJs(send, `(() => { const s = document.querySelector('.stage'); s.scrollLeft = 0; s.scrollTop = 0; return 1 })()`)
    await evalJs(send, `[...document.querySelectorAll('.csStatus__btn')].find(b => b.textContent.trim() === '适应').click(); 1`)
    await sleep(800)
    const fitCenter = await evalJs(send, `(() => {
      const box = s => { const el = document.querySelector(s); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
      const b = box('.board'); const w = box('.stageWrap')
      return { dx: Math.round((b.x + b.w / 2) - (w.x + 32 + (w.w - 32) / 2)), dy: Math.round((b.y + b.h / 2) - (w.y + 28 + (w.h - 28) / 2)) }
    })()`)
    check('点「适应」后图纸回到标尺内侧正中央', Math.abs(fitCenter.dx) <= 3 && Math.abs(fitCenter.dy) <= 3, fitCenter)

    /* 视图页签已去掉，画布固定停在拼豆图纸，标尺一直在 */
    const onRuler = await evalJs(send, `!!document.querySelector('[data-canvas-ruler]')`)
    check('拼豆图纸上有标尺', onRuler === true, { onRuler })
    const backCenter = await evalJs(send, `(() => {
      const box = s => { const el = document.querySelector(s); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
      const b = box('.board'); const w = box('.stageWrap')
      return { dx: Math.round((b.x + b.w / 2) - (w.x + 32 + (w.w - 32) / 2)), dy: Math.round((b.y + b.h / 2) - (w.y + 28 + (w.h - 28) / 2)) }
    })()`)
    check('适应后图纸仍在正中央', Math.abs(backCenter.dx) <= 4 && Math.abs(backCenter.dy) <= 4, backCenter)
  }
  for (const label of ['作品分析', '我的库存']) {
    await evalJs(send, `(() => { const b = [...document.querySelectorAll('.csSide button')].find(x => x.textContent.includes(${JSON.stringify(label)})); b && b.click(); return !!b })()`)
    await sleep(600)
    const t = await evalJs(send, `(document.querySelector('.dialog__title') || {}).textContent`)
    check('弹窗：' + label, (t || '').includes(label), t)
    await shotEl(send, '.dialog', 'dialog-' + (label === '作品分析' ? 'analysis' : 'stock'))
    await evalJs(send, `(() => { const b = document.querySelector('.dialog__head .iconbtn'); b && b.click(); return !!b })()`)
    await sleep(400)
  }

  // 交互：撤销 / 重做 / 镜像
  const before = await evalJs(send, `document.querySelectorAll('[data-palette-code]').length`)
  await evalJs(send, `[...document.querySelectorAll('.csRail .csTool')].find(b => b.textContent.includes('镜像')).click(); 1`)
  await sleep(400)
  const undoEnabled = await evalJs(send, `[...document.querySelectorAll('.csRail .csTool')].find(b => b.textContent.includes('撤销')).disabled`)
  check('镜像后撤销可用', undoEnabled === false, undoEnabled)
  await evalJs(send, `[...document.querySelectorAll('.csRail .csTool')].find(b => b.textContent.includes('撤销')).click(); 1`)
  await sleep(400)
  const redoEnabled = await evalJs(send, `[...document.querySelectorAll('.csRail .csTool')].find(b => b.textContent.includes('重做')).disabled`)
  check('撤销后重做可用', redoEnabled === false, redoEnabled)

  /* 交互：图纸转换的「更换图片」直接打开文件选择。
     不再经过「上传图片 → 选择图片 → 导入图片」两步确认，所以点完不应出现 .cmdDlg。
     用 CDP 拦住系统文件选择框，避免无头浏览器挂住。 */
  {
    await send('Page.setInterceptFileChooserDialog', { enabled: true })
    const clicked = await evalJs(send, `(() => { const b = document.querySelector('[data-console="upload"]'); if (!b) return false; b.click(); return true })()`)
    await sleep(400)
    const dlgOpened = await evalJs(send, `!!document.querySelector('.cmdDlg')`)
    check('「更换图片」直接打开文件选择（不再弹导入确认）', clicked && !dlgOpened, { clicked, dlgOpened })
    await send('Page.setInterceptFileChooserDialog', { enabled: false })
  }

  // 交互：反馈按钮
  await evalJs(send, `[...document.querySelectorAll('.csActions .csAction')].find(b => b.textContent.trim() === '反馈').click(); 1`)
  await sleep(600)
  const fbOpen = await evalJs(send, `!!document.querySelector('.fbDialog, .fb-dialog, [class*="fb"]') && document.body.innerText.includes('反馈')`)
  check('顶栏反馈按钮打开弹窗', fbOpen, fbOpen)
  await shotEl(send, 'body', 'feedback-open', 1)
  /* 关掉反馈弹窗：走它自己的「取消」按钮（合成 KeyboardEvent 不冒泡到 window，
     用 Esc 关不掉，会把后面的弹窗断言带偏） */
  await evalJs(send, `[...document.querySelectorAll('.dialog__foot .btn')].find(b => b.textContent.trim() === '取消')?.click(); 1`)
  await sleep(300)

  // 交互：未登录点保存 → 弹登录窗（「登录后才能保存」），登录成功后继续保存
  {
    const savedBefore = await evalJs(send, `(document.querySelector('.csSaved') || {}).textContent`)
    await evalJs(send, `[...document.querySelectorAll('.csActions .csAction')].find(b => b.textContent.includes('保存')).click(); 1`)
    await sleep(800)
    const dlg = await evalJs(send, `(() => {
      const d = document.querySelector('[data-audit="login-dialog"]')
      if (!d) return { open: false }
      const t = s => { const el = d.querySelector(s); return el ? el.textContent.trim() : '' }
      return {
        open: true,
        reason: t('[data-audit="login-reason"]'),
        submit: t('[data-audit="email-submit"]'),
        hasForgot: !!d.querySelector('[data-audit="forgot-password"]'),
        hasRegister: !!d.querySelector('[data-audit="email-to-register"]'),
        hasWechat: !!d.querySelector('[data-audit="wechat-login"]'),
        hasPhone: !!d.querySelector('[data-audit="login-phone"]'),
        hasSmsTab: !!d.querySelector('[data-audit="login-tabs"]'),
        text: d.textContent
      }
    })()`)
    console.log('loginDialog:', JSON.stringify(dlg))
    check('未登录点保存弹出登录窗', dlg.open === true, dlg)
    check('登录窗说明「登录后才能保存」且主按钮是「登录并保存」', /登录后才能保存/.test(dlg.reason || '') && /登录并保存/.test(dlg.submit || ''), { reason: dlg.reason, submit: dlg.submit })
    check('登录窗有微信登录 / 邮箱表单 / 忘记密码 / 邮箱注册', dlg.hasWechat && dlg.hasForgot && dlg.hasRegister, dlg)
    /* 短信入口按服务端配置显示；这个自检没有后端，页签不出现是正常的。这里只守老版手机扫码引导不再回来。 */
    check('登录窗没有老的手机扫码引导', !/扫码登录|复制链接|另一台手机/.test(dlg.text || ''), dlg)
    await shotEl(send, '.dialog', 'login-dialog-save')
    await evalJs(send, `document.querySelector('.dialog__head .iconbtn')?.click(); 1`)
    await sleep(400)
    const after = await evalJs(send, `(document.querySelector('.csSaved') || {}).textContent`)
    check('关掉登录窗回到工作台且没有误保存', after === savedBefore, { savedBefore, after })
  }

  // 交互：重命名
  await evalJs(send, `document.querySelector('.csProject__name').click(); 1`)
  await sleep(300)
  const renaming = await evalJs(send, `!!document.querySelector('.csProject__input')`)
  check('重命名进入编辑态', renaming === true, renaming)
  await evalJs(send, `(() => { const i = document.querySelector('.csProject__input'); i.value = '探针作品'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); return 1 })()`)
  await sleep(500)
  const nameNow = await evalJs(send, `(document.querySelector('.csProject__name') || {}).textContent`)
  check('重命名生效', nameNow === '探针作品', nameNow)

  // 交互：导出（导出弹窗是懒加载的，冷启动时首帧要等 chunk 落地，轮询等它出来）
  await evalJs(send, `[...document.querySelectorAll('.csActions .csAction')].find(b => b.textContent.includes('导出')).click(); 1`)
  let exportOpen = false
  for (let i = 0; i < 25 && !exportOpen; i++) {
    await sleep(200)
    exportOpen = await evalJs(send, `(() => { const t = document.querySelector('.cmdDlg .dialog__title'); return !!t && t.textContent.includes('导出') })()`)
  }
  check('导出面板打开', exportOpen, exportOpen)
  await shotEl(send, 'body', 'export-open')
  await evalJs(send, `document.querySelector('.cmdDlg .dialog__head .iconbtn')?.click(); 1`)
  await sleep(300)

  await shotEl(send, 'body', 'full-1600', 1)

  /* ---------- 1280×800：1100~1319 这一档必须撑满视口 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${origin}/editor/${fixtureId}` })
  await waitBridge(send); await sleep(1200)
  const narrow = await evalJs(send, `(() => {
    const r = s => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    return { vw: innerWidth, top: r('.csTop'), status: r('.csStatus'), side: r('.csSide'), rail: r('.csRail'), palette: r('.csPalette'), scrollW: document.documentElement.scrollWidth,
      modeSeg: r('.csModeSeg'), views: r('.csViews'),
      paletteCard: r('[data-palette-card]'), railToggle: r('.csRail__toggle'),
      ruler: r('[data-canvas-ruler]'), wrap: r('.stageWrap'),
      rulerLabels: (document.querySelector('[data-canvas-ruler]') || {}).getAttribute ? document.querySelector('[data-canvas-ruler]').getAttribute('data-ruler-labels') : null }
  })()`)
  console.log('narrow:', JSON.stringify(narrow))
  check('1280 宽：命令栏 / 状态栏撑满视口',
    !!narrow.top && narrow.top.w === 1280 && narrow.status.w === 1280, { top: narrow.top, status: narrow.status })
  check('1280 宽：右侧入口贴右 28px',
    !!narrow.side && 1280 - narrow.side.x - narrow.side.w === 28, narrow.side)
  check('1280 宽：顶栏没有模式切换和视图页签',
    !narrow.modeSeg && !narrow.views, { mode: narrow.modeSeg, views: narrow.views })
  check('1280 宽：工具栏默认展开，贴左侧 48、宽 84',
    !!narrow.rail && narrow.rail.x === 48 && narrow.rail.w === 84 && !narrow.railToggle, { rail: narrow.rail, toggle: narrow.railToggle })
  check('1280 宽：右栏没有色板卡，底部色板条不存在',
    !narrow.paletteCard && !narrow.palette, { paletteCard: narrow.paletteCard, palette: narrow.palette, side: narrow.side })
  /* 1280 这一档也要能从工具轨滑出选色面板，并且整块落在视口内 */
  await evalJs(send, `document.querySelector('.csRail__swatch').click(); 1`)
  await sleep(500)
  const narrowFly = await evalJs(send, `(() => {
    const b = s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } }
    return { fly: b('[data-palette-flyout]'), rail: b('.csRail'), side: b('.csSide'), vh: innerHeight }
  })()`)
  check('1280 宽：点当前颜色仍向右滑出选色面板，且不压右侧入口',
    !!narrowFly.fly && narrowFly.fly.x >= narrowFly.rail.right + 8 &&
    narrowFly.fly.y >= 12 && narrowFly.fly.bottom <= narrowFly.vh - 12 &&
    !!narrowFly.side && narrowFly.fly.right <= narrowFly.side.x,
    narrowFly)
  await shotEl(send, 'body', 'palette-flyout-1280', 1, false)
  check('1280 宽：无横向溢出', narrow.scrollW <= narrow.vw, { scrollW: narrow.scrollW, vw: narrow.vw })
  check('1280 宽：标尺仍贴在画布视口上',
    !!narrow.ruler && !!narrow.wrap && narrow.ruler.x === narrow.wrap.x && narrow.ruler.y === narrow.wrap.y &&
    narrow.ruler.w === narrow.wrap.w && narrow.ruler.h === narrow.wrap.h && !!narrow.rulerLabels,
    { ruler: narrow.ruler, wrap: narrow.wrap, labels: narrow.rulerLabels })
  await shotEl(send, 'body', 'full-1280', 1)

  /* ---------- 空白工作台：两种模式的初始状态（设计稿 1:593 / 1:1869） ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${origin}/editor` })
  await waitBridge(send); await sleep(1400)
  {
    const initial = await evalJs(send, `(() => {
      const q = s => document.querySelector(s)
      const modeText = (q('.csTop') ? q('.csTop').textContent : '') + (q('.csCmd') ? q('.csCmd').textContent : '')
      return {
        hint: (q('[data-empty-free]') || {}).textContent || '',
        uploadCard: !!q('[data-empty-upload]'),
        canvas: !!q('.board canvas'),
        railOpen: !!q('.csRail.is-open') && !q('[data-rail-toggle]'),
        modeGone: !q('.csModeSeg') && !/自由画布/.test(modeText),
        tabs: [...document.querySelectorAll('.csViews button')].map(b => b.textContent.trim())
      }
    })()`)
    await sleep(300)
    const initialTools = await evalJs(send, `(() => {
      const tools = [...document.querySelectorAll('.csTools .csTool')].map(b => ({
        label: (b.textContent || '').trim(),
        disabled: !!b.disabled
      }))
      return {
        tools,
        drawingEnabled: tools.filter(t => t.label !== '撤销' && t.label !== '重做').every(t => !t.disabled)
      }
    })()`)
    console.log('initialEmpty:', JSON.stringify({ ...initial, ...initialTools }))
    /* 打开工作台就是图纸转换：没有模式开关，画布中央是上传卡 */
    check('打开工作台默认是图纸转换（画布中央是上传卡，没有模式开关）',
      initial.modeGone && initial.uploadCard && !initial.hint, initial)
    check('打开工作台没有视图页签', initial.tabs.length === 0, initial.tabs)
    check('空白工作台的工具栏也是展开态', initial.railOpen === true, initial)
    check('图纸转换左侧编辑工具默认可用', initialTools.drawingEnabled === true && initialTools.tools.length >= 8, initialTools.tools)
    /* 空白工作台也能从当前颜色色块打开选色面板（还没画任何东西时色板照常可选） */
    await evalJs(send, `document.querySelector('.csRail__swatch').click(); 1`)
    await sleep(400)
    const emptyPalette = await evalJs(send, `(() => {
      const fly = document.querySelector('[data-palette-flyout]')
      return {
        open: !!fly,
        cells: document.querySelectorAll('[data-palette-code]').length,
        inViewport: fly ? (() => { const r = fly.getBoundingClientRect(); return r.top >= 12 && r.bottom <= innerHeight - 12 } )() : false
      }
    })()`)
    check('空白工作台：点当前颜色也能滑出选色面板', emptyPalette.open && emptyPalette.cells > 4 && emptyPalette.inViewport, emptyPalette)
    await evalJs(send, `document.querySelector('.csRail__swatch').click(); 1`)
    await sleep(300)
    await shotEl(send, '.canvasCard', 'edit-empty-upload')

    const edit = await evalJs(send, `(() => {
      const q = s => document.querySelector(s)
      const card = q('[data-empty-upload]')
      const tools = [...document.querySelectorAll('.csTools .csTool')].map(b => ({
        label: (b.textContent || '').trim(),
        disabled: !!b.disabled
      }))
      return {
        hint: (q('[data-empty-free]') || {}).textContent || '',
        uploadCard: !!card,
        cardText: card ? card.textContent.replace(/\\s+/g, ' ').trim() : '',
        hasPick: !!q('[data-empty-upload] button'),
        dropHint: /拖拽/.test(card ? card.textContent : ''),
        hasMaterials: /素材库/.test(document.querySelector('.csCmd') ? document.querySelector('.csCmd').textContent : ''),
        tabs: [...document.querySelectorAll('.csViews button')].map(b => b.textContent.trim()),
        tools,
        drawingEnabled: tools.filter(t => t.label !== '撤销' && t.label !== '重做').every(t => !t.disabled)
      }
    })()`)
    console.log('editEmpty:', JSON.stringify(edit))
    check('图纸转换空状态：画布中央是上传卡（本地图片 + 拖拽上传）',
      edit.uploadCard && !edit.hint && edit.hasPick && edit.dropHint, edit)
    check('图纸转换的命令行有「素材库」入口', edit.hasMaterials === true, edit)
    check('图纸转换没有视图页签', edit.tabs.length === 0, edit.tabs)
    check('图纸转换不禁用左侧编辑工具', edit.drawingEnabled === true && edit.tools.length >= 8, edit.tools)
    await shotEl(send, '.canvasCard', 'edit-empty-upload')

    /* 素材入口：命令行按钮叫「素材库」，弹窗标题也是「素材库」 */
    await evalJs(send, `(() => { const b = document.querySelector('[data-console="materials"]'); b && b.click(); return !!b })()`)
    await sleep(700)
    const matDlg = await evalJs(send, `(() => {
      const btn = document.querySelector('[data-console="materials"]')
      const h2 = document.querySelector('.dialog__title h2')
      return {
        btnLabel: btn ? (btn.textContent || '').trim() : '',
        title: h2 ? (h2.textContent || '').trim() : '',
        open: !!document.querySelector('.dialog__title')
      }
    })()`)
    console.log('materialsDialog:', JSON.stringify(matDlg))
    check('素材入口叫「素材库」，弹窗标题也是「素材库」',
      matDlg.btnLabel === '素材库' && matDlg.title === '素材库', matDlg)
    await evalJs(send, `document.querySelector('.dialog__head .iconbtn[aria-label="关闭"]')?.click(); 1`)
    await sleep(300)
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1))
  console.log('=== ' + report.filter(r => r.ok).length + '/' + report.length + ' passed')
  browser.close(); chrome.kill(); if (server) server.close()
}

main().catch(e => { console.error(e); process.exit(1) })
