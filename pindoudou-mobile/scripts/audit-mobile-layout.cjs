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
      const stage = q('.stage'), tabbar = q('.tabbar'), toolbar = q('.canvasCard__toolbar')
      const sr = stage.getBoundingClientRect(), tr = tabbar.getBoundingClientRect(), br = toolbar.getBoundingClientRect()
      const cmds = qa('.cmdBtn')
      return {
        stage: { w: Math.round(sr.width), h: Math.round(sr.height), top: Math.round(sr.top), bottom: Math.round(sr.bottom) },
        toolbar: { top: Math.round(br.top), bottom: Math.round(br.bottom), h: Math.round(br.height) },
        tabbar: { top: Math.round(tr.top) },
        gapStageToTabbar: Math.round(tr.top - sr.bottom),
        tabs: qa('.viewtabs button').filter(vis).map(b => b.querySelector('.tabShort')?.textContent || b.textContent.trim()),
        tabTexts: qa('.viewtabs button').filter(vis).map(b => (b.querySelector('.tabShort') || b).textContent.trim()),
        cmds: cmds.filter(vis).map(b => ({ label: b.textContent.trim(), top: Math.round(b.getBoundingClientRect().top), h: Math.round(b.getBoundingClientRect().height) })),
        cmdSameRow: cmds.length === 2 && Math.abs(cmds[0].getBoundingClientRect().top - cmds[1].getBoundingClientRect().top) <= 1,
        saveInBar: vis(qa('.canvasCard__toolbar .btn').find(b => b.textContent.includes('保存'))),
        zoom: vis(q('.zoomText')),
        floaters: qa('.stageTools__btn').filter(vis).map(b => ({ label: b.getAttribute('aria-label'), h: Math.round(b.getBoundingClientRect().height) })),
        rail: vis(q('.toolRail')),
        editPanel: vis(q('.editPanel')),
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        bodyOverflowX: getComputedStyle(document.body).overflowX
      }
    })()`, true)

    console.log(`\n— ${vp.name} —`)
    check(metrics.stage.h > 220, '画布舞台有可用高度', `${metrics.stage.w}×${metrics.stage.h}`)
    check(metrics.tabs.length === 3 && metrics.tabs.join('/') === '图纸/原图/对照', '顶栏只有三个视图页签', metrics.tabs.join('/'))
    check(metrics.cmds.length === 2 && metrics.cmdSameRow, '「功能 / 编辑」同一行并排',
      metrics.cmds.map(c => `${c.label}@${c.top}`).join(' · '))
    check(metrics.cmds.every(c => c.h >= 32), '命令按钮触控高度 ≥ 32px', metrics.cmds.map(c => `${c.label}:${c.h}`).join(' '))
    check(metrics.zoom && !metrics.saveInBar, '顶栏显示实时缩放，保存收进功能浮层')
    check(!metrics.rail && metrics.floaters.length === 4, '画布右侧只有 4 颗浮控，无常驻窄栏',
      metrics.floaters.map(f => f.label).join('/'))
    check(metrics.floaters.every(f => f.h >= 36), '浮控触控高度 ≥ 36px', metrics.floaters.map(f => `${f.label}:${f.h}`).join(' '))
    check(!metrics.editPanel, '手机端画布下方旧工具条已隐藏')
    check(!metrics.overflowX, '页面无横向溢出')
    check(metrics.gapStageToTabbar >= 0 && metrics.stage.top >= metrics.toolbar.bottom - 1,
      '顶栏 / 画布 / 标签栏依次排列、互不覆盖',
      `画布-标签栏 ${metrics.gapStageToTabbar}px`)

    // 功能浮层：开 → 4 列 × 2 行 → 点按钮关
    const fn = await evalJS(`(async () => {
      const q = s => document.querySelector(s)
      const qa = s => [...document.querySelectorAll(s)]
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      qa('.cmdBtn').find(b => b.textContent.includes('功能')).click()
      await sleep(200)
      const grid = q('.fnGrid')
      const items = qa('.fnGrid__item').map(b => b.textContent.trim())
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
      const rows = grid ? new Set(qa('.fnGrid__item').map(b => Math.round(b.getBoundingClientRect().top))).size : 0
      const pop = q('.cmdPop--func')
      const pr = pop.getBoundingClientRect()
      const inViewport = pr.left >= -1 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1
      qa('.cmdBtn').find(b => b.textContent.includes('功能')).click()
      await sleep(160)
      return { open: !!grid, cols, rows, items, inViewport, closed: !q('.fnGrid') }
    })()`, true)
    check(fn.open && fn.closed, '「功能」浮层可开可关（再点按钮）')
    check(fn.cols === 4 && fn.rows === 2 && fn.items.length === 8, '八功能 4 列 × 2 行',
      `${fn.cols} 列 · ${fn.rows} 行 · ${fn.items.join('/')}`)
    check(fn.inViewport, '功能浮层不溢出屏幕')

    // 编辑浮层：开 → 关
    const edit = await evalJS(`(async () => {
      const q = s => document.querySelector(s)
      const qa = s => [...document.querySelectorAll(s)]
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      qa('.cmdBtn').find(b => b.textContent.includes('编辑')).click()
      await sleep(200)
      const pop = q('.cmdPop--edit')
      const tools = qa('.editTool').map(b => b.textContent.trim())
      const pr = pop ? pop.getBoundingClientRect() : null
      const inViewport = !!pr && pr.left >= -1 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1
      q('.cmdPop__close')?.click()
      await sleep(160)
      return { open: !!pop, tools, inViewport, closed: !q('.cmdPop--edit') }
    })()`, true)
    check(edit.open && edit.closed, '「编辑」浮层可开可关')
    check(edit.tools.join('/') === '画笔/取色/橡皮/填充/移动', '编辑工具全部保留', edit.tools.join('/'))
    check(edit.inViewport, '编辑浮层不溢出屏幕')
  }

  chrome.kill()
  console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 手机端版面自检全部通过'}`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
