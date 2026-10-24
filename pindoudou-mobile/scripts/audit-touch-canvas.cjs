/* =========================================================================
   触屏画布编辑自检（开发用，不进构建产物）
   用途：在真实 Chrome 的触屏模拟下验证三件事：
     1. 单指在图纸上拖动 = 只改格子，画布不能跟着手指滚动；
     2. 双指拖动 = 平移画布，而且不能顺手在图纸上留颜色；
     3. 双指捏合 = 缩放画布（拉大放大、捏小缩小），同样不能改格子。
   为什么需要它：`touch-action` 与 PointerEvent 的组合在桌面浏览器里
   用合成事件测不出来（合成事件不会触发原生滚动），必须用 CDP 的真实触摸。

   用法（先在 home 上起 dev server：corepack pnpm dev）：
     node scripts/audit-touch-canvas.js --width 390 --height 844     # 手机
     node scripts/audit-touch-canvas.js --width 820 --height 1180    # 平板
   可选 --url（默认 http://127.0.0.1:5173）。
   ========================================================================= */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const URL_ = arg('url', 'http://127.0.0.1:5173')
const VW = Number(arg('width', 390))
const VH = Number(arg('height', 844))
const DEBUG_PORT = 9410 + (process.pid % 300)
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
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean).find(p => fs.existsSync(p))
  if (!chromePath) { console.error('找不到 Chrome，可用 CHROME_PATH 指定'); process.exit(1) }

  /* Chrome profile 放仓库 .tmp 里：Windows 上系统临时目录有时没有写权限，
     mkdtemp 会直接 EPERM（这台机器就踩过）。 */
  const tmpRoot = path.resolve(__dirname, '..', '.tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const profile = fs.mkdtempSync(path.join(tmpRoot, 'douwan-touch-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    /* Windows 上用普通用户跑 headless 会因为没有沙箱权限起不来 */
    '--no-sandbox',
    '--hide-scrollbars', '--lang=zh-CN', `--user-data-dir=${profile}`,
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: VW, height: VH, deviceScaleFactor: 2, mobile: true
  })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }

  await send('Page.navigate', { url: `${URL_}/#/editor` })
  await sleep(2500)

  const setup = await evalJS(`(async () => {
    const d = window.__douzao
    if (!d) return { err: '调试桥未就绪' }
    const [A, S, Inv] = await Promise.all([d.assets(), d.studio(), d.inventoryStore()])
    Inv.useInventory.value = false
    Inv.clearInventory()
    const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
    await S.useAsset(asset)
    S.setCanvasSize(52, 52)
    S.options.removeBg = false
    S.tool.value = 'paint'
    if (!S.regenerate({ keys: ['high'], silent: true })) return { err: '生成失败' }
    await new Promise(r => setTimeout(r, 900))
    /* 走界面上的「＋」：它会关掉自动适配，否则 ResizeObserver 会把缩放拉回去 */
    const plus = [...document.querySelectorAll('.zoomBar button')].find(b => b.title === '放大')
    if (plus) { for (let i = 0; i < 4; i++) plus.click() } else { S.setZoom(3) }
    await new Promise(r => setTimeout(r, 600))
    const stage = document.querySelector('.stage')
    const canvas = stage && stage.querySelector('canvas')
    if (!stage || !canvas) return { err: '找不到画布舞台' }
    stage.scrollIntoView({ block: 'center' })
    await new Promise(r => setTimeout(r, 500))
    const sr = stage.getBoundingClientRect()
    const cr = canvas.getBoundingClientRect()
    const x = Math.max(sr.left + 40, Math.min(sr.right - 40, cr.left + cr.width / 2))
    const y = Math.max(sr.top + 40, Math.min(sr.bottom - 40, cr.top + cr.height / 2))
    window.__touchProbe = {
      x, y,
      snapshot: () => ({ left: stage.scrollLeft, top: stage.scrollTop, cells: Array.from(S.pattern.value.cells) }),
      before: null
    }
    window.__touchProbe.before = window.__touchProbe.snapshot()
    return {
      ok: true,
      scrollable: stage.scrollWidth > stage.clientWidth,
      scroll: { left: stage.scrollLeft, top: stage.scrollTop },
      touch: { x, y },
      media: {
        innerH: innerHeight,
        short: matchMedia('(max-height:700px)').matches,
        chart: (() => {
          const el = document.querySelector('.chartNote')
          return el ? getComputedStyle(el).display : null
        })()
      }
    }
  })()`, true)
  if (!setup.ok) {
    console.error('准备失败：', setup.err || JSON.stringify(setup))
    chrome.kill()
    process.exit(1)
  }
  console.log(`视口 ${VW}×${VH} · 舞台可滚动=${setup.scrollable} · 触点 (${Math.round(setup.touch.x)}, ${Math.round(setup.touch.y)}) · 媒体=${JSON.stringify(setup.media)}`)

  const { x, y } = setup.touch
  const point = (px, py, id = 1) => [{ x: px, y: py, id, radiusX: 6, radiusY: 6, force: 1 }]

  /* ① 单指拖动：画布不动，格子要变 */
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) })
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x - i * 15, y - i * 4) })
    await sleep(40)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(500)

  /* 上面的触摸序列结束后，分别取滚动位移与改动格数 */
  const paintChanged = await evalJS(`(async () => {
    const m = await window.__douzao.studio()
    const before = window.__touchProbe.before.cells
    const cells = m.pattern.value.cells
    let n = 0
    for (let i = 0; i < cells.length; i++) if (cells[i] !== before[i]) n++
    return n
  })()`, true)
  const paintDelta = await evalJS(`(() => {
    const stage = document.querySelector('.stage')
    const b = window.__touchProbe.before
    return { left: stage.scrollLeft - b.left, top: stage.scrollTop - b.top }
  })()`)
  const paintOk = Math.abs(paintDelta.left) <= 2 && Math.abs(paintDelta.top) <= 2 && paintChanged > 0
  console.log(`${paintOk ? '✓' : '✗'} 单指编辑：画布位移 ${paintDelta.left}/${paintDelta.top}px，改动 ${paintChanged} 格`)

  /* ② 双指拖动：画布跟着走，不能留下颜色 */
  await evalJS(`(() => {
    const stage = document.querySelector('.stage')
    stage.scrollLeft = 0
    stage.scrollTop = 0
    window.__touchProbe.before = window.__touchProbe.snapshot()
  })()`)
  const pair = (dx) => [
    { x: x - 30 + dx, y, id: 1, radiusX: 6, radiusY: 6, force: 1 },
    { x: x + 30 + dx, y, id: 2, radiusX: 6, radiusY: 6, force: 1 }
  ]
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(0) })
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(-i * 15) })
    await sleep(40)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(500)

  const pan = await evalJS(`(async () => {
    const stage = document.querySelector('.stage')
    const b = window.__touchProbe.before
    const m = await window.__douzao.studio()
    const cells = m.pattern.value.cells
    let changed = 0
    for (let i = 0; i < cells.length; i++) if (cells[i] !== b.cells[i]) changed++
    return {
      delta: { left: stage.scrollLeft - b.left, top: stage.scrollTop - b.top },
      changed
    }
  })()`, true)
  const panOk = pan.delta.left >= 50 && pan.delta.left <= 75 && Math.abs(pan.delta.top) <= 2 && pan.changed === 0
  console.log(`${panOk ? '✓' : '✗'} 双指平移：画布位移 ${pan.delta.left}/${pan.delta.top}px，误改 ${pan.changed} 格`)

  /* ②b 双指捏合：两指距离从 60px 拉到 140px，缩放级别要跟着变大 */
  const zoomBefore = await evalJS(`(async () => {
    const m = await window.__douzao.studio()
    return m.zoom.value
  })()`, true)
  await evalJS(`(() => {
    const stage = document.querySelector('.stage')
    stage.scrollLeft = 0
    stage.scrollTop = 0
    window.__touchProbe.before = window.__touchProbe.snapshot()
  })()`)
  const spread = (gap) => [
    { x: x - gap / 2, y, id: 1, radiusX: 6, radiusY: 6, force: 1 },
    { x: x + gap / 2, y, id: 2, radiusX: 6, radiusY: 6, force: 1 }
  ]
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: spread(60) })
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: spread(60 + i * 20) })
    await sleep(40)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(500)

  const pinchResult = await evalJS(`(async () => {
    const m = await window.__douzao.studio()
    const cells = m.pattern.value.cells
    const b = window.__touchProbe.before.cells
    let changed = 0
    for (let i = 0; i < cells.length; i++) if (cells[i] !== b[i]) changed++
    return { zoom: m.zoom.value, changed }
  })()`, true)
  /* 距离 60 → 140，理论放大 2.33 倍；允许夹到 8 倍上限，也允许轻微抖动 */
  const zoomRatio = pinchResult.zoom / zoomBefore
  const pinchOk = zoomRatio > 1.5 && pinchResult.changed === 0
  console.log(`${pinchOk ? '✓' : '✗'} 双指捏合：缩放 ${zoomBefore.toFixed(2)} → ${pinchResult.zoom.toFixed(2)}（×${zoomRatio.toFixed(2)}），误改 ${pinchResult.changed} 格`)

  /* ③ 显式的「移动」工具：单指拖动只平移，绝不改图；模式状态要可见 */
  const panModeReady = await evalJS(`(() => {
    const btn = [...document.querySelectorAll('.toolgroup .tool')]
      .find(b => (b.getAttribute('aria-label') || '').includes('移动画布'))
    if (!btn) return { err: '找不到「移动画布」工具按钮' }
    btn.click()
    const stage = document.querySelector('.stage')
    stage.scrollLeft = 0
    stage.scrollTop = 0
    window.__touchProbe.before = window.__touchProbe.snapshot()
    return { ok: true, pressed: btn.getAttribute('aria-pressed') }
  })()`)
  if (!panModeReady.ok) {
    console.error('平移模式准备失败：', panModeReady.err)
    chrome.kill()
    process.exit(1)
  }
  await sleep(200)
  /* 缩放撞到像素上限时会多出一行提示，舞台高度和位置都会变；
     重新取当前舞台中心，别拿手势开始前的坐标。 */
  const panPoint = await evalJS(`(() => {
    const r = document.querySelector('.stage').getBoundingClientRect()
    return { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) }
  })()`)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(panPoint.x, panPoint.y) })
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(panPoint.x - i * 15, panPoint.y) })
    await sleep(40)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(500)

  const panMode = await evalJS(`(async () => {
    const stage = document.querySelector('.stage')
    const b = window.__touchProbe.before
    const m = await window.__douzao.studio()
    const cells = m.pattern.value.cells
    let changed = 0
    for (let i = 0; i < cells.length; i++) if (cells[i] !== b.cells[i]) changed++
    return {
      delta: { left: stage.scrollLeft - b.left, top: stage.scrollTop - b.top },
      changed,
      hint: !!document.querySelector('.panState'),
      scrollable: { sw: stage.scrollWidth, cw: stage.clientWidth, sh: stage.scrollHeight, ch: stage.clientHeight },
      stageRect: (() => { const r = stage.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } })(),
      hints: [...document.querySelectorAll('.codesHint')].map(el => {
        const r = el.getBoundingClientRect()
        return { text: el.textContent.trim().slice(0, 24), top: Math.round(r.top), bottom: Math.round(r.bottom) }
      }),
      hit: document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)})?.className || null
    }
  })()`, true)
  const panModeOk = panMode.delta.left >= 50 && panMode.delta.left <= 75 &&
    Math.abs(panMode.delta.top) <= 2 && panMode.changed === 0 && panMode.hint
  console.log(`${panModeOk ? '✓' : '✗'} 移动工具：画布位移 ${panMode.delta.left}/${panMode.delta.top}px，误改 ${panMode.changed} 格，状态提示=${panMode.hint}，可滚动=${JSON.stringify(panMode.scrollable)}，舞台=${JSON.stringify(panMode.stageRect)}，提示=${JSON.stringify(panMode.hints)}，触点元素=${panMode.hit}`)

  await browser.send('Target.closeTarget', { targetId: target.targetId })
  chrome.kill()
  if (!paintOk || !panOk || !pinchOk || !panModeOk) {
    console.error('触屏画布自检失败')
    process.exit(1)
  }
  console.log('触屏画布自检通过')
}

main().catch(e => { console.error(e); process.exit(1) })
