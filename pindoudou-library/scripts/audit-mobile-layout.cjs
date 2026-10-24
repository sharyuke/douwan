/* =========================================================================
   手机端编辑器版面自检（开发用，不进构建产物）
   用途：在 320×568 / 375×667 / 390×844 / 430×932 四个视口里验证
     - 顶栏只出现 图纸 / 原图 / 对照 + 缩放 + 适应 + 保存
     - 右侧工具窄栏 5 项（编辑 / 取色 / 橡皮 / 填充 / 更多）都在 44px 以上
     - 画布舞台占满顶栏与底部标签栏之间的空间，页面无横向溢出
     - 「功能」按钮与八功能 BottomSheet（4 列 × 2 行）可开关
     - 「更多」抽屉可开关，遮罩点击只关抽屉
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
  { name: '430x932', w: 430, h: 932 }
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
    await sleep(1800)
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
      const stage = q('.stage'), pill = q('.fnPill'), tabbar = q('.tabbar'), rail = q('.toolRail')
      const sr = stage.getBoundingClientRect(), pr = pill.getBoundingClientRect(), tr = tabbar.getBoundingClientRect()
      return {
        stage: { w: Math.round(sr.width), h: Math.round(sr.height), top: Math.round(sr.top), bottom: Math.round(sr.bottom) },
        pill: { visible: vis(pill), h: Math.round(pr.height), bottom: Math.round(innerHeight - pr.bottom) },
        tabbar: { top: Math.round(tr.top) },
        gapPillToTabbar: Math.round(tr.top - pr.bottom),
        gapStageToPill: Math.round(pr.top - sr.bottom),
        tabs: qa('.viewtabs button').filter(vis).map(b => b.querySelector('.tabShort')?.textContent || b.textContent.trim()),
        save: vis(qa('.canvasActions .btn').find(b => b.textContent.includes('保存'))),
        zoom: vis(q('.zoomText')),
        fit: vis(qa('.zoomBar .btn').find(b => b.textContent.includes('适应'))),
        rail: {
          visible: vis(rail),
          items: qa('.toolRail__btn').filter(vis).map(b => ({ label: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) }))
        },
        editPanel: vis(q('.editPanel')),
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        bodyOverflowX: getComputedStyle(document.body).overflowX
      }
    })()`, true)

    console.log(`\n— ${vp.name} —`)
    check(metrics.stage.h > 220, '画布舞台有可用高度', `${metrics.stage.w}×${metrics.stage.h}`)
    check(metrics.tabs.length === 3 && metrics.tabs.join('/') === '图纸/原图/对照', '顶栏只有三个视图页签', metrics.tabs.join('/'))
    check(metrics.save && metrics.zoom && metrics.fit, '缩放 / 适应 / 保存都在顶栏')
    check(metrics.rail.visible && metrics.rail.items.length === 5, '右侧窄栏 5 项', metrics.rail.items.map(i => i.label).join('/'))
    check(metrics.rail.items.every(i => i.h >= 44), '窄栏触控高度 ≥ 44px', metrics.rail.items.map(i => `${i.label}:${i.h}`).join(' '))
    check(!metrics.editPanel, '手机端画布下方旧工具条已隐藏')
    check(!metrics.overflowX, '页面无横向溢出')
    check(metrics.gapPillToTabbar >= 0 && metrics.gapStageToPill >= 0, '功能按钮不压标签栏、画布不压功能按钮',
      `标签栏-功能 ${metrics.gapPillToTabbar}px · 画布-功能 ${metrics.gapStageToPill}px`)

    // 更多抽屉：开 → 遮罩关
    const drawer = await evalJS(`(async () => {
      const q = s => document.querySelector(s)
      const qa = s => [...document.querySelectorAll(s)]
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      qa('.toolRail__btn').find(b => b.textContent.includes('更多')).click()
      await sleep(160)
      const open = !!q('.toolDrawer')
      const sections = qa('.toolDrawer__body h4').map(h => h.textContent.trim())
      const scrim = q('.toolScrim')
      if (scrim) scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
      await sleep(160)
      return { open, sections, closed: !q('.toolDrawer') }
    })()`, true)
    check(drawer.open && drawer.closed, '「更多」抽屉可开可关（点遮罩）')
    check(drawer.sections.includes('编辑操作') && drawer.sections.includes('视图'), '抽屉包含现有功能分区', drawer.sections.join('/'))

    // 八功能：开 → 4 列 → 遮罩关
    const fn = await evalJS(`(async () => {
      const q = s => document.querySelector(s)
      const qa = s => [...document.querySelectorAll(s)]
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      q('.fnPill').click()
      await sleep(200)
      const grid = q('.fnGrid')
      const items = qa('.fnGrid__item').map(b => b.textContent.trim())
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
      const modal = q('.modal--sheet')
      if (modal) modal.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(160)
      return { open: !!grid, cols, items, closed: !q('.fnGrid') }
    })()`, true)
    check(fn.open && fn.closed, '八功能 BottomSheet 可开可关（点遮罩）')
    check(fn.cols === 4 && fn.items.length === 8, '八功能 4 列 × 2 行', `${fn.cols} 列 · ${fn.items.join('/')}`)
  }

  chrome.kill()
  console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 手机端版面自检全部通过'}`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
