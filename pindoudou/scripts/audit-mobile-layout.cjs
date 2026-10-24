/* =========================================================================
   手机端编辑器版面自检（开发用，不进构建产物）
   用途：在 320×568 / 375×667 / 390×844 / 430×932 与横屏 844×390 里验证
     - 顶栏只有 图纸 / 原图 / 对照 + 缩放 + 适应
     - 顶栏下方一行 画布 / 色板 / 换图 / 导出 / 更多
     - 画布下方常驻 镜像 / 画笔 / 橡皮 / 填充 / 取色 / 更多
     - 画布右侧 6 颗浮控：撤销 / 重做 / 实际大小 / 放大 / 缩小 / 定位
     - 画笔参数条按需出现，切到填充后收起
     - 两个「更多」抽屉互斥、可关闭、返回键也能关
     - 画布仍有可用高度，页面无横向溢出
   用法（先起静态服务）：
     node scripts/serve-dist.mjs
     node scripts/audit-mobile-layout.cjs [--url http://127.0.0.1:4319]
   ========================================================================= */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const URL_ = arg('url', 'http://127.0.0.1:4319')
const VIEWPORTS = [
  { name: '320x568', w: 320, h: 568 },
  { name: '375x667', w: 375, h: 667 },
  { name: '390x844', w: 390, h: 844 },
  { name: '430x932', w: 430, h: 932 },
  { name: '844x390-landscape', w: 844, h: 390 }
]
const DEBUG_PORT = 9500 + (process.pid % 300)
const sleep = ms => new Promise(r => setTimeout(r, ms))

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
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
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')) }
      }, 30000)
    })
  }
}

async function main() {
  const chromePath = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].filter(Boolean).find(p => fs.existsSync(p))
  if (!chromePath) { console.error('找不到 Chrome，可用 CHROME_PATH 指定'); process.exit(1) }

  const tmpRoot = path.resolve(__dirname, '..', '.tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const profile = fs.mkdtempSync(path.join(tmpRoot, 'douwan-layout-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--no-sandbox', '--hide-scrollbars', '--lang=zh-CN', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let version = null
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(); break } catch { await sleep(250) }
  }
  if (!version) { console.error('Chrome 未就绪'); chrome.kill(); process.exit(1) }

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready
  const target = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }

  let failed = 0
  const check = (ok, label, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' · ' + detail : ''}`)
  }

  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true
    })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Page.navigate', { url: `${URL_}/#/editor` })
    await sleep(700)
    /* 首次进入会弹新手指引，盖住整个版面；自检先记成已看过再硬刷新 */
    await evalJS(`localStorage.setItem('douwan.guide.v1', '1')`)
    await send('Page.reload', { ignoreCache: true })
    await sleep(1600)
    const setup = await evalJS(`(async () => {
      const d = window.__douzao
      if (!d) return { err: '调试桥未就绪' }
      const [A, S, Inv] = await Promise.all([d.assets(), d.studio(), d.inventoryStore()])
      Inv.useInventory.value = false
      Inv.clearInventory()
      const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
      await S.useAsset(asset)
      S.setCanvasSize(52, 52)
      if (!S.regenerate({ keys: ['high'], silent: true })) return { err: '生成失败' }
      await new Promise(r => setTimeout(r, 900))
      return { ok: true }
    })()`, true)
    if (!setup.ok) { console.error(vp.name, '准备失败', setup.err); failed++; continue }

    const metrics = await evalJS(`(async () => {
      const q = s => document.querySelector(s)
      const qa = s => [...document.querySelectorAll(s)]
      const vis = el => {
        if (!el) return false
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'
      }
      const box = el => {
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }
      }
      const stage = q('.stage'), tabbar = q('.tabbar'), toolbar = q('.canvasCard__toolbar')
      const quick = qa('.quickItem'), tools = qa('.toolItem')
      const rowsOf = list => new Set(list.map(b => Math.round(b.getBoundingClientRect().top))).size
      return {
        stage: box(stage),
        toolbar: box(toolbar),
        quick: quick.filter(vis).map(b => ({ t: b.textContent.trim(), ...box(b) })),
        quickRows: rowsOf(quick.filter(vis)),
        tools: tools.filter(vis).map(b => ({ t: b.textContent.trim(), ...box(b) })),
        toolRows: rowsOf(tools.filter(vis)),
        params: vis(q('.mobileParams')) ? box(q('.mobileParams')) : null,
        tabbar: box(tabbar),
        tabs: qa('.viewtabs button').filter(vis).map(b => (b.querySelector('.tabShort') || b).textContent.trim()),
        fitTop: vis(q('.fitTop')) ? box(q('.fitTop')) : null,
        zoom: q('.zoomText')?.textContent?.trim() || '',
        floaters: qa('.stageTools__btn').filter(vis).map(b => ({ label: b.getAttribute('aria-label'), ...box(b) })),
        cmdLeft: qa('.cmdBtn').length,
        editPanel: vis(q('.editPanel')),
        overflowX: document.documentElement.scrollWidth > innerWidth + 1
      }
    })()`, true)

    if (process.env.AUDIT_SHOT === '1') {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      fs.writeFileSync(path.join(tmpRoot, `40-layout-${vp.name}.png`), Buffer.from(shot.data, 'base64'))
    }

    /* 手机横屏宽度会超过 780，此时仍走平板版面（桌面/平板本次不改），
       只确认没有被这次改动波及：无横向溢出、旧手机按钮不出现。 */
    if (vp.w > 780) {
      console.log(`\n— ${vp.name}（宽度 > 780，按平板版面，保持不变）—`)
      check(metrics.stage.w > 0, '画布仍在（平板版面）', `${metrics.stage.w}×${metrics.stage.h}`)
      check(metrics.cmdLeft === 0, '旧手机命令按钮不出现')
      check(!metrics.overflowX, '页面无横向溢出')
      continue
    }

    console.log(`\n— ${vp.name} —`)
    check(metrics.stage.h > 170, '画布舞台有可用高度', `${metrics.stage.w}×${metrics.stage.h}`)
    check(metrics.tabs.join('/') === '图纸/原图/对照', '顶栏只有三个视图页签', metrics.tabs.join('/'))
    check(!!metrics.fitTop && metrics.fitTop.w >= 32, '顶栏最右有「适应」按钮', metrics.fitTop ? `${metrics.fitTop.w}px` : '缺失')
    check(metrics.cmdLeft === 0, '旧的「功能 / 编辑」按钮已移除')
    check(metrics.quick.length === 5 && metrics.quickRows === 1, '快捷区一行五项',
      metrics.quick.map(q => q.t).join('/'))
    check(metrics.quick.every(q => q.h >= 42), '快捷入口触控高度 ≥ 42px', metrics.quick.map(q => `${q.t}:${q.h}`).join(' '))
    check(metrics.quick[0]?.t === '画布' && metrics.quick[4]?.t === '更多', '快捷区顺序：画布 … 更多')
    check(metrics.tools.length === 6 && metrics.toolRows === 1, '底部工具一行六项',
      metrics.tools.map(t => t.t).join('/'))
    check(metrics.tools[0]?.t === '镜像' && !metrics.tools.some(t => t.t === '移动'), '工具行首格是「镜像」，没有「移动」',
      metrics.tools.map(t => t.t).join('/'))
    check(metrics.tools.every(t => t.h >= 42), '工具触控高度 ≥ 42px', metrics.tools.map(t => `${t.t}:${t.h}`).join(' '))
    check(!metrics.params, '默认不展开画笔参数条')
    check(metrics.floaters.length === 6 && metrics.floaters.every(f => f.h >= 36),
      '画布右侧 6 颗浮控（撤销 / 重做 + 实际大小）',
      metrics.floaters.map(f => `${f.label}:${f.h}`).join(' '))
    check(metrics.floaters[0]?.label === '撤销' && metrics.floaters[1]?.label === '重做',
      '浮控前两颗是撤销 / 重做', metrics.floaters.map(f => f.label).join('/'))
    check(metrics.floaters.every(f => f.x >= metrics.stage.x && f.x + f.w <= metrics.stage.x + metrics.stage.w + 1),
      '浮控不越出画布')
    check(!metrics.editPanel, '桌面旧工具条在手机上仍隐藏')
    check(metrics.quick.length && metrics.tools.length &&
      metrics.quick[0].y > metrics.toolbar.y && metrics.tools[0].y > metrics.stage.b - 1,
      '顺序：顶栏 → 快捷区 → 画布 → 工具行', `快捷区 ${metrics.quick[0]?.y} · 工具行 ${metrics.tools[0]?.y}`)
    check(metrics.toolbar.y >= 0 && metrics.toolbar.b <= metrics.quick[0]?.y + 1,
      '顶栏与快捷区不重叠')
    check(!metrics.overflowX, '页面无横向溢出')

    // 参数条 / 两个更多抽屉 / 返回键
    const states = await evalJS(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const q = s => document.querySelector(s)
      const qa = s => [...document.querySelectorAll(s)]
      const vis = el => !!el && el.getClientRects().length > 0
      const title = () => q('.dialog__head h2')?.textContent?.trim() || ''
      const items = () => qa('.moreItem').map(b => b.textContent.replace(/\\s+/g, ' ').trim())
      const tool = t => qa('.toolItem').find(b => b.textContent.includes(t))
      const quick = t => qa('.quickItem').find(b => b.textContent.includes(t))
      const out = {}

      tool('画笔').click(); await sleep(220)
      out.params = vis(q('.mobileParams'))
      out.paramsAboveTools = (() => {
        const p = q('.mobileParams')?.getBoundingClientRect()
        const t = q('.mobileToolbar')?.getBoundingClientRect()
        return !!p && !!t && p.bottom <= t.top + 1
      })()
      out.rangeMax = Number(q('.mobileParams__range')?.max || 0)
      out.colorBtn = vis(q('.mobileParams__color'))

      quick('更多').click(); await sleep(320)
      out.top = { open: !!q('.modal--sheet'), title: title(), items: items() }
      q('.modal--sheet')?.click(); await sleep(240)
      out.topClosed = !q('.modal--sheet')

      tool('更多').click(); await sleep(320)
      out.bottom = { open: !!q('.modal--sheet'), title: title(), items: items() }
      quick('更多').click(); await sleep(300)
      out.mutex = { title: title(), items: items() }
      q('.dialog__head .iconbtn')?.click(); await sleep(240)
      out.afterClose = !q('.modal--sheet')

      tool('橡皮').click(); await sleep(180)
      out.erase = { shown: vis(q('.mobileParams')), label: q('.mobileParams__label')?.textContent }
      tool('填充').click(); await sleep(180)
      out.fillHidesParams = !vis(q('.mobileParams'))

      // 返回键：打开「画布」抽屉后 history.back()，应当只关抽屉
      quick('画布').click(); await sleep(360)
      out.sizeOpen = !!q('.modal--sheet') && title().includes('画布')
      history.back(); await sleep(520)
      out.backClosed = !q('.modal--sheet')
      out.urlAfterBack = location.hash
      return out
    })()`, true)

    check(states.params && states.paramsAboveTools, '点画笔出现参数条，且在工具行上方')
    check(states.rangeMax >= 8, '参数条有笔刷大小滑杆', `max=${states.rangeMax}`)
    check(states.colorBtn, '画笔参数条保留当前颜色入口')
    check(states.top.open && states.top.title === '更多功能' && states.top.items.length === 5,
      '顶部更多：5 项业务功能', states.top.items.join('/'))
    check(states.topClosed, '顶部更多可关闭')
    check(states.bottom.open && states.bottom.title === '更多编辑工具' && states.bottom.items.length === 4,
      '底部更多：4 项编辑工具（撤销 / 重做 / 镜像已移出）', states.bottom.items.join('/'))
    check(states.mutex.title === '更多功能' && states.mutex.items.length === 5, '两个更多面板互斥')
    check(states.afterClose, '抽屉关闭后不残留')
    check(states.erase.shown && states.erase.label === '橡皮大小', '橡皮参数条切换为「橡皮大小」')
    check(states.fillHidesParams, '切到填充后参数条收起')
    check(states.sizeOpen, '快捷区「画布」能打开尺寸面板')
    check(states.backClosed && states.urlAfterBack === '#/editor', '返回键只关抽屉，不离开工作台',
      states.urlAfterBack)
  }

  chrome.kill()
  console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 手机端 4.0 版面自检全部通过'}`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
