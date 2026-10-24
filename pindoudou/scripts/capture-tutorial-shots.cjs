/* =========================================================================
   抓取新手教程用的真实界面截图（开发用，不进构建产物）
   桌面 1440×900 / 手机 390×844，DSF 2（推近镜头不糊）。
   同时写出 shots.json：每张图的文件、尺寸、以及镜头该对准的焦点矩形。
   焦点来自真实 DOM 的 getBoundingClientRect()，所以 UI 改版后重跑本脚本，
   视频脚本不需要再手改坐标。

   用法：node scripts/capture-tutorial-shots.cjs            # 桌面 + 手机
        node scripts/capture-tutorial-shots.cjs mobile     # 只抓手机
   前置：先 vite build（本脚本不会自动构建）
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.tmp', 'tutorial-shots')
const MANIFEST = path.join(OUT, 'shots.json')
const DEMO = path.join(ROOT, '.tmp', 'tutorial-demo.jpg')
const PROFILE = path.join(ROOT, '.tmp', 'tutorial-capture-profile')
const PORT = 4353
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4'
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
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')) }
      }, 60000)
    })
  }
}

const manifest = { generatedAt: new Date().toISOString(), demo: path.basename(DEMO), sets: {} }

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('缺少 dist/，先运行 vite build')
  if (!fs.existsSync(DEMO)) throw new Error(`缺少演示图片 ${DEMO}`)
  fs.mkdirSync(OUT, { recursive: true })
  fs.mkdirSync(PROFILE, { recursive: true })

  const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const modes = wanted.length ? wanted : ['desktop', 'mobile']

  const server = await staticServer()
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--lang=zh-CN',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--user-data-dir=${PROFILE}`, '--remote-debugging-port=9349',
    '--no-first-run', '--no-default-browser-check', 'about:blank'
  ], { stdio: 'ignore' })

  let version
  for (let i = 0; i < 100; i++) {
    try { version = await (await fetch('http://127.0.0.1:9349/json/version')).json(); break } catch { await sleep(200) }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪')

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')

  /* 每次新文档都先把新手指引标记成「看过」：否则首次进入工作台会自动盖一层指引 */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('douwan.guide.v1', '1') } catch (e) {}`
  })

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value
  }
  const waitFor = async (fn, ms = 12000, step = 150) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try { if (await fn()) return true } catch { /* 页面还在更新 */ }
      await sleep(step)
    }
    return false
  }
  const clickText = (selector, text) => evalJS(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(e => e.getClientRects().length && e.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`)
  const click = selector => evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    el.click()
    return true
  })()`)
  const escape = () => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  const waitBridge = () => waitFor(() => evalJS('!!window.__douzao'), 12000)
  const waitPattern = () => waitFor(async () => {
    return await evalJS(`(async () => {
      const d = window.__douzao
      if (!d) return false
      const S = await d.studio()
      return !!(S.hasPattern && S.hasPattern.value)
    })()`, true)
  }, 20000)

  async function setViewport(vp) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.mobile
    })
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }

  async function clearStore() {
    await evalJS(`(() => {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('douzao-')) keys.push(k)
      }
      keys.forEach(k => localStorage.removeItem(k))
      localStorage.setItem('douwan.guide.v1', '1')
      return keys
    })()`)
  }

  async function goto(hash) {
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hash}` })
    await waitBridge()
    await sleep(700)
  }

  async function uploadDemo() {
    /* 无头 Chrome 里给隐藏 input 设 files 后，change 处理完 files 立刻被清空，
       拿不到稳定的上传态。这里直接调工作台自己的 useImageFile() ——
       和点「上传图片」走的是同一条载入 / 生成链路，只是不经过 input 元素。 */
    const b64 = fs.readFileSync(DEMO).toString('base64')
    const res = await evalJS(`(async () => {
      const d = window.__douzao
      if (!d) return { err: 'no-bridge' }
      const S = await d.studio()
      const blob = await (await fetch('data:image/jpeg;base64,${b64}')).blob()
      const file = new File([blob], 'tutorial-demo.jpg', { type: 'image/jpeg' })
      const ok = await S.useImageFile(file)
      /* 上传会把画布自动放大到原图能用的最大格数（312×312），
         教程里用一个 52×52 的整板示例更接近真实新手作品。
         底板容量和成品区域都要收，否则成品是 52 格、底板仍是 312 格。 */
      S.projectName.value = '橘猫玩偶'
      S.sourceName.value = '橘猫玩偶'
      S.setCanvasCapacity(52, 52)
      S.setCanvasSize(52, 52)
      S.options.removeBg = true
      S.regenerate({ keys: ['high'], silent: true })
      await new Promise(r => setTimeout(r, 2200))
      /* 换过画布尺寸后沿用旧缩放会只剩 10%，点一下「适应」回到整张图纸 */
      /* 4.0 手机把「适应」挪到画布顶栏（.fitTop），桌面端仍在 .zoomBar 里 */
      const fit = [...document.querySelectorAll('.zoomBar button')].find(b => b.textContent.trim() === '适应') ||
        document.querySelector('.fitTop')
      if (fit) fit.click()
      await new Promise(r => setTimeout(r, 900))
      /* 库存：把图案要用的色号都备足，避免「颜色用量」整页显示缺货。
         教程看的是怎么用，不是一份空库存。 */
      const Inv = await d.inventoryStore()
      Inv.clearInventory()
      const p = S.pattern.value
      const seen = new Set()
      if (p) {
        for (const c of p.palette) {
          if (!seen.has(c.id)) { seen.add(c.id); Inv.setStock(c.id, 900) }
        }
      }
      Inv.inventoryMode.value = 'strict'
      Inv.useInventory.value = true
      S.regenerate({ keys: ['high'], silent: true })
      await new Promise(r => setTimeout(r, 1400))
      if (S.fitNotice) S.fitNotice.value = null
      return {
        ok, hasPattern: S.hasPattern.value, name: S.sourceName ? S.sourceName.value : '',
        cells: S.width.value + 'x' + S.height.value,
        pattern: S.pattern.value ? S.pattern.value.width + 'x' + S.pattern.value.height : null,
        hint: (document.querySelector('.codesHint') || {}).textContent || ''
      }
    })()`, true)
    console.log('  upload:', JSON.stringify(res))
    if (!res || !res.ok) throw new Error('演示图片没有生成图纸')
    await sleep(1200)
    // 清掉上传后的提示卡，画面更干净
    await evalJS(`(async () => {
      const d = window.__douzao
      if (!d) return
      const S = await d.studio()
      if (S.fitNotice) S.fitNotice.value = null
    })()`, true)
    await sleep(300)
  }

  async function seedAsset() {
    const res = await evalJS(`(async () => {
      const d = window.__douzao
      const [A, S, Inv] = await Promise.all([d.assets(), d.studio(), d.inventoryStore()])
      Inv.useInventory.value = false
      Inv.clearInventory()
      const asset = A.ASSETS.find(a => a.feat) || A.ASSETS[0]
      await S.useAsset(asset)
      S.setCanvasSize(52, 52)
      S.options.removeBg = false
      if (!S.regenerate({ keys: ['high'], silent: true })) return { err: 'regen' }
      if (S.fitNotice) S.fitNotice.value = null
      await new Promise(r => setTimeout(r, 1800))
      if (S.fitNotice) S.fitNotice.value = null
      return { ok: true, name: asset.name }
    })()`, true)
    if (!res || !res.ok) throw new Error('素材预置失败：' + JSON.stringify(res))
    await sleep(500)
  }

  async function capture(mode, name, opts = {}) {
    if (opts.scroll) {
      await evalJS(`(() => {
        const el = document.querySelector(${JSON.stringify(opts.scroll)})
        if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' })
      })()`)
      await sleep(380)
    }
    if (opts.prepare) {
      await evalJS(opts.prepare, true)
      await sleep(opts.wait || 500)
    }
    /* 上传提示卡 / 生成成功的 toast 会在截图里抢画面：截图前统一收掉 */
    await evalJS(`(async () => {
      const d = window.__douzao
      if (!d) return
      const S = await d.studio()
      if (S.fitNotice) S.fitNotice.value = null
    })()`, true)
    await sleep(120)
    await evalJS('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true)

    const focus = await evalJS(`(() => {
      const vw = innerWidth, vh = innerHeight
      const sels = ${JSON.stringify(opts.focus || [])}
      let box = null
      for (const s of sels) {
        for (const el of document.querySelectorAll(s)) {
          if (!el.getClientRects().length) continue
          const r = el.getBoundingClientRect()
          if (!r.width || !r.height) continue
          box = box ? {
            x: Math.min(box.x, r.x), y: Math.min(box.y, r.y),
            right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom)
          } : { x: r.x, y: r.y, right: r.right, bottom: r.bottom }
        }
      }
      if (!box) box = { x: 16, y: 16, right: vw - 16, bottom: vh - 16 }
      const pad = 10
      const x = Math.max(0, Math.floor(box.x - pad))
      const y = Math.max(0, Math.floor(box.y - pad))
      const right = Math.min(vw, Math.ceil(box.right + pad))
      const bottom = Math.min(vh, Math.ceil(box.bottom + pad))
      return { x, y, w: right - x, h: bottom - y }
    })()`)

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const dir = path.join(OUT, mode)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(shot.data, 'base64'))
    const vp = manifest.sets[mode].viewport
    manifest.sets[mode].shots[name] = { file: `${mode}/${name}.png`, w: vp.w, h: vp.h, focus }
    console.log(`  ✓ ${mode}/${name}.png  focus ${focus.x},${focus.y} ${focus.w}×${focus.h}`)
  }

  /* ================================================================ 桌面 */
  if (modes.includes('desktop')) {
    manifest.sets.desktop = { viewport: { w: 1440, h: 900, dsf: 2, mobile: false }, shots: {} }
    console.log('\n▶ 桌面 1440×900')
    await setViewport({ w: 1440, h: 900, mobile: false })
    await goto('#/')
    await clearStore()
    await send('Page.reload', { ignoreCache: true })
    await waitBridge()
    await sleep(600)
    await goto('#/editor')
    await sleep(1200)

    // 空状态：左栏 ① 创建 + 中间空画布
    await capture('desktop', 'd00-empty', {
      focus: ['.card--create', '.stage']
    })

    // 上传演示照片
    await uploadDemo()
    await capture('desktop', 'd01-create', { focus: ['.card--create'] })

    // 智能抠图：点开「智能抠图」并等重算
    await evalJS(`(() => {
      const b = [...document.querySelectorAll('.procTab')].find(x => x.textContent.includes('智能抠图'))
      if (b) b.click()
    })()`)
    await sleep(2200)
    await capture('desktop', 'd02-matte', {
      focus: ['.card--create .thumb', '.card--create .procTabs', '.card--create .procDetail']
    })

    // 画布结果
    await capture('desktop', 'd03-canvas', {
      focus: ['.stageWrap']
    })

    // ① 创建里的「免费素材库」：没有照片也能开始（本地素材，不依赖后端）
    await clickText('.card--create .sourceTabs button', '免费素材库')
    await sleep(500)
    await capture('desktop', 'd04-library', {
      scroll: '.card--create',
      focus: ['.card--create .srcAsset']
    })
    await clickText('.card--create .sourceTabs button', '上传图片')
    await sleep(300)

    // ② 画布与成品尺寸：展开，分两张（底板 / 清晰度+摘要）
    await click('.card--size .sizeWideHead')
    await sleep(500)
    await capture('desktop', 'd05-size-board', {
      scroll: '.card--size',
      focus: ['.card--size .sizeWideHead', '.card--size .sizeField']
    })
    await capture('desktop', 'd06-size-clarity', {
      scroll: '.card--size .sizeSummary',
      focus: ['.card--size .sizeField:nth-of-type(2)', '.card--size .sizeSummary', '.card--size .sizeLock']
    })
    await click('.card--size .sizeWideHead')
    await sleep(300)

    // ③ 生成方案
    await click('.card--scheme .cardArrowBtn')
    await sleep(500)
    await capture('desktop', 'd07-scheme', {
      scroll: '.card--scheme',
      focus: ['.card--scheme']
    })
    await click('.card--scheme .cardArrowBtn')
    await sleep(300)

    // ④ 色板选择
    await click('.card--more .moreRow')
    await sleep(500)
    await capture('desktop', 'd08-palette', {
      scroll: '.card--more',
      focus: ['.card--more']
    })
    await click('.card--more .moreRow')
    await sleep(300)

    // 右栏：作品分析 / 颜色用量
    await click('.card--analysis .cardArrowBtn')
    await sleep(400)
    await capture('desktop', 'd09-analysis', {
      scroll: '.card--analysis',
      focus: ['.card--analysis']
    })
    await click('.card--colors .cardArrowBtn')
    await sleep(400)
    await capture('desktop', 'd10-colors', {
      scroll: '.card--colors',
      focus: ['.card--colors']
    })
    await click('.card--analysis .cardArrowBtn')
    await click('.card--colors .cardArrowBtn')
    await sleep(300)

    // 画布下方编辑工具
    await capture('desktop', 'd11-tools', {
      scroll: '.canvasCard',
      focus: ['.canvasCard__foot']
    })

    // ⑤ 图纸交付卡片
    await capture('desktop', 'd12-delivery-card', {
      scroll: '.card--build',
      focus: ['.card--build']
    })

    // 交付弹窗：导出 / 分板 / 拼装
    await click('[data-audit="open-delivery-build"]')
    await sleep(1200)
    await clickText('.deliveryTabs button', '整张图纸')
    await sleep(1200)
    await capture('desktop', 'd13-export', { focus: ['.delivery'] })
    await clickText('.deliveryTabs button', '分板交付')
    await sleep(1800)
    await capture('desktop', 'd14-split', { focus: ['.delivery'] })
    await clickText('.deliveryTabs button', '拼装与完成')
    await sleep(800)
    await capture('desktop', 'd15-build', { focus: ['.delivery'] })
    await escape()
    await sleep(500)

    // 实际大小
    await click('[data-actual-btn]')
    await sleep(1000)
    await capture('desktop', 'd16-actual', { focus: ['.actualBadge', '.board'] })
    await click('[data-actual-btn]')
    await sleep(400)
  }

  /* ================================================================ 手机 */
  if (modes.includes('mobile')) {
    manifest.sets.mobile = { viewport: { w: 390, h: 844, dsf: 2, mobile: true }, shots: {} }
    console.log('\n▶ 手机 390×844')
    await setViewport({ w: 390, h: 844, mobile: true })
    await goto('#/')
    await clearStore()
    await send('Page.reload', { ignoreCache: true })
    await waitBridge()
    await sleep(600)
    await goto('#/editor')
    await sleep(1200)

    // 空状态：画布里的上传入口 + 画布上方的快捷区
    await capture('mobile', 'm00-empty', {
      focus: ['.emptyActions', '.quickRow']
    })

    // 上传演示照片后的画布
    await uploadDemo()
    await capture('mobile', 'm01-canvas', {
      focus: ['.stage', '.stageTools', '.quickRow', '.mobileToolbar']
    })

    // 快捷区 → 更多：五个业务功能
    await clickText('.quickItem', '更多')
    await sleep(500)
    await capture('mobile', 'm02-functions', { focus: ['.modal--sheet .moreGrid'] })
    // 快捷区 → 换图 → 免费素材库：没有照片也能开始（本地素材，不依赖后端）
    await clickText('.quickItem', '换图')
    await sleep(900)
    await clickText('.modal.show .sourceTabs button', '免费素材库')
    await sleep(500)
    await capture('mobile', 'm03-library', {
      focus: ['.card--create .srcAsset']
    })
    await escape()
    await sleep(500)

    // 快捷区 → 画布：尺寸抽屉
    await clickText('.quickItem', '画布')
    await sleep(900)
    await capture('mobile', 'm04-size-board', {
      focus: ['.modal.show .dialog__body', '.card--size .sizeField']
    })
    await capture('mobile', 'm05-size-summary', {
      scroll: '.card--size .sizeSummary',
      focus: ['.card--size .sizeSummary', '.card--size .sizeHint']
    })
    await escape()
    await sleep(500)

    // 更多 → 方案
    await clickText('.quickItem', '更多')
    await sleep(400)
    await clickText('.moreItem', '方案')
    await sleep(900)
    await capture('mobile', 'm06-scheme', { focus: ['.modal.show .dialog__body', '.modal.show .card--scheme'] })
    await escape()
    await sleep(500)

    // 快捷区 → 色板
    await clickText('.quickItem', '色板')
    await sleep(900)
    await capture('mobile', 'm07-palette', { focus: ['.modal.show .dialog__body', '.card--more'] })
    await escape()
    await sleep(500)

    // 工具行：选画笔会展开参数条
    await clickText('.toolItem', '画笔')
    await sleep(500)
    await capture('mobile', 'm11-tools', {
      focus: ['.mobileParams', '.mobileToolbar']
    })

    // 工具行 → 更多：网格 / 分板 / 材料 / 教程（撤销、重做在画布右侧浮控）
    await clickText('.toolItem', '更多')
    await sleep(500)
    await capture('mobile', 'm08-edit', { focus: ['.modal--sheet .moreGrid'] })
    await escape()
    await sleep(400)

    // 更多 → 分析 / 更多 → 用量
    await clickText('.quickItem', '更多')
    await sleep(400)
    await clickText('.moreItem', '分析')
    await sleep(900)
    await capture('mobile', 'm09-analysis', { focus: ['.modal.show .dialog__body', '.card--analysis'] })
    await escape()
    await sleep(500)
    await clickText('.quickItem', '更多')
    await sleep(400)
    await clickText('.moreItem', '用量')
    await sleep(900)
    await capture('mobile', 'm10-colors', { focus: ['.modal.show .dialog__body', '.card--colors'] })
    await escape()
    await sleep(500)

    // 快捷区 → 导出：整张图纸 / 分板 / 拼装
    await clickText('.quickItem', '导出')
    await sleep(1400)
    await capture('mobile', 'm12-delivery', { focus: ['.delivery'] })
    await clickText('.deliveryTabs button', '分板')
    await sleep(1800)
    await capture('mobile', 'm13-split', { focus: ['.delivery'] })
    await clickText('.deliveryTabs button', '拼装')
    await sleep(800)
    await capture('mobile', 'm14-build', { focus: ['.delivery'] })
    await escape()
    await sleep(500)

    // 保存作品：更多 → 保存作品
    await clickText('.quickItem', '更多')
    await sleep(400)
    await clickText('.moreItem', '保存作品')
    await sleep(700)
    await capture('mobile', 'm15-save', { focus: ['.modal.show .dialog'] })
    await escape()
    await sleep(400)

    // 实际大小
    await click('[data-actual-btn-mobile]')
    await sleep(1100)
    await capture('mobile', 'm16-actual', { focus: ['.actualBadge', '.stage'] })
    await click('[data-actual-btn-mobile]')
    await sleep(400)
  }

  chrome.kill()
  server.close()
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  console.log(`\n完成：${MANIFEST}`)
  process.exit(0)
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1) })
