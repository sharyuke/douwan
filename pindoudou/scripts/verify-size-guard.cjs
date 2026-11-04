/* 换成品尺寸的验收（真浏览器、真滑杆事件、真指针笔画）

   2026-11-01 用户定下的口径：缩放分成两部分 ——
     ① **原图部分**：永远按原图在新尺寸上重新取样。每个尺寸的效果都来自原图，
        不是把工作区里那张已经缩过的图按块放大；
     ② **修改过的部分**：按**修改那一刻的尺寸**缩放。在 104 上改的一颗，缩到 52 再放回
        104 仍是那一颗；在 52 上改的一颗，放大到 104 是 2×2 一块（按比例铺满）；
     ③ 手改过的图放大缩小不许弹层、不许把手改重新生成掉；
     ④ 清晰度滑杆的上限 = 底板边界：拉到最大时图案把画布撑满，但不超出、不被裁切。

   判据：「原图部分」与同一份源图、同一套参数重新生成出来的图纸**逐格一致**
   （色号 id 平面；改过的那块除外），这样才叫「各个尺寸都按原图来」。

   跑法：
     pnpm verify:size-guard                 # 本地 dist（先 pnpm build）
     pnpm verify:size-guard -- --url https://dw.sharyuke.com
     pnpm verify:size-guard -- --width 390 --height 844
*/
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
const OUT = path.join(TMP_ROOT, 'size-guard')
const PORT = Number(process.env.AUDIT_PORT || 4324)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
]

function staticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0])
      if (p === '/' || !path.extname(p)) p = '/index.html'
      const file = path.join(DIST, p)
      if (!file.startsWith(DIST) || !fs.existsSync(file)) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
      fs.createReadStream(file).pipe(res)
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
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (!msg.id) return
      const { resolve, reject } = this.pending.get(msg.id) || {}
      this.pending.delete(msg.id)
      if (!resolve) return
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    })
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(method + ' 超时'))
      }, 60000)
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

/** 页面里跑的准备：载素材 → 底板 156 / 成品 art → 重新生成（可选：真画一笔） */
const setupExpr = (art, paint) => `(async () => {
  const d = window.__douzao
  const S = await d.studio()
  const M = await d.membership()
  const A = await d.assets()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  S.options.removeBg = false
  const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
  await S.useAsset(asset)
  await sleep(300)
  S.options.canvasMaxW = 156
  S.options.canvasMaxH = 156
  S.options.canvasW = ${art}
  S.options.canvasH = ${art}
  if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: '生成失败' }
  await sleep(500)
  window.__studio = S
  ${paint ? `
  /* 真拖一笔：走画布自己的指针事件，manualEdited 由 endEdit 立起来 */
  const cv = document.querySelector('.stage canvas')
  const p = S.pattern.value
  const gw = parseFloat(cv.style.width) || cv.width
  let best = null
  for (let rl = 13; rl <= ${art}; rl++) {
    const cs = (gw - 2 * rl) / p.width
    if (!(cs >= 0.5)) continue
    if (Math.min(${art}, Math.max(13, Math.round(cs * 1.8))) !== rl) continue
    const diff = Math.abs(2 * rl + p.width * cs - gw)
    if (!best || diff < best.diff) best = { cs, rl, diff }
  }
  if (!best) return { ok: false, err: '量不到格子尺寸' }
  const rc = cv.getBoundingClientRect()
  const ptr = (type, x, y) => new PointerEvent(type, {
    clientX: rc.left + (best.rl + (x + 0.5) * best.cs) * (rc.width / gw),
    clientY: rc.top + (best.rl + (y + 0.5) * best.cs) * (rc.height / gw),
    bubbles: true, cancelable: true,
    pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
  })
  /* 画在**成品区域**里（成品居中在底板上，四周是留白）：成品坐标 (12,12)。
     笔色挑一个与这一格不同的：同色画上去不算改动，manualEdited 不会立起来。 */
  const ax = Math.floor((p.width - p.artW) / 2)
  const ay = Math.floor((p.height - p.artH) / 2)
  const at = (ay + 12) * p.width + (ax + 12)
  const brush = p.palette.find((c, i) => i !== p.cells[at]) || p.palette[0]
  S.brushColorId.value = brush.id
  cv.dispatchEvent(ptr('pointerdown', ax + 12, ay + 12))
  cv.dispatchEvent(ptr('pointerup', ax + 12, ay + 12))
  await sleep(300)
  ` : ''}
  return { ok: true, asset: asset.name, manualEdited: S.manualEdited.value }
})()`

/** 量状态：成品 / 底板 / 弹层在不在 / 画面（成品区域内的色号 id 平面） */
const STATE = `(() => {
  const S = window.__studio
  const p = S.pattern.value
  const ox = p ? Math.floor((p.width - p.artW) / 2) : 0
  const oy = p ? Math.floor((p.height - p.artH) / 2) : 0
  const artGrid = p ? Array.from({ length: p.artH }, (_, y) =>
    Array.from({ length: p.artW }, (_, x) => p.cells[(oy + y) * p.width + (ox + x)])) : null
  const range = document.querySelector('[data-size-range]')
  const head = document.querySelector('.canvasTitleBar')
  return {
    cap: S.options.canvasMaxW + 'x' + S.options.canvasMaxH,
    art: p ? p.artW + 'x' + p.artH : null,
    board: p ? p.width + 'x' + p.height : null,
    manualEdited: S.manualEdited.value,
    editCount: p && p.editMap instanceof Map ? p.editMap.size : -1,
    layer: p && p.editLayer ? p.editLayer.w + 'x' + p.editLayer.h : null,
    layerCells: p && p.editLayer ? Array.from(p.editLayer.mask).reduce((n, v) => n + v, 0) : -1,
    sourceFromPattern: S.sourceFromPattern.value,
    artGrid,
    palette: p ? p.palette.map(c => c.id) : [],
    beads: p ? Array.from(p.cells).filter(k => k >= 0).length : 0,
    guardOpen: !!document.querySelector('[data-size-guard]') || !!document.querySelector('.dialog__head h2'),
    slider: range ? range.value : null,
    sliderMax: range ? range.max : null,
    note: ((document.querySelector('[data-size-note]') || {}).textContent || '').trim(),
    headText: head ? head.textContent.replace(/\\s+/g, ' ').trim() : null
  }
})()`

/** 真拖滑杆（设值 + input + change，走页面自己的处理链路） */
const dragExpr = (v) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const range = document.querySelector('[data-size-range]')
  if (!range) return { ok: false, err: '找不到清晰度滑杆' }
  range.value = String(${JSON.stringify(v)})
  range.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(900)
  range.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(2200)
  return { ok: true, value: range.value }
})()`

/** 某格在成品区域里的色号 id（越界返回 '?'） */
function cellId(state, x, y) {
  const [w, h] = state.art.split('x').map(Number)
  if (x < 0 || y < 0 || x >= w || y >= h) return '?'
  const k = state.artGrid[y][x]
  return k < 0 ? null : state.palette[k] || '?'
}

/** 两套色号是不是完全相同（换尺寸不许自动改颜色） */
function sameColors(a, b) {
  const x = (a || []).slice().sort().join('|')
  const y = (b || []).slice().sort().join('|')
  return x === y
}

/** 老存档（没有真原图、源图由图纸重建）放大后，旧豆的颜色一颗不变 */
function anchorsMatch(before, after) {
  const [bw, bh] = before.art.split('x').map(Number)
  const [aw, ah] = after.art.split('x').map(Number)
  if (aw < bw || ah < bh) return true
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const k = before.artGrid[y][x]
      if (k < 0) continue
      const id = before.palette[k]
      const nx = Math.min(aw - 1, Math.floor((x + 0.5) * aw / bw))
      const ny = Math.min(ah - 1, Math.floor((y + 0.5) * ah / bh))
      if (cellId(after, nx, ny) !== id) return false
    }
  }
  return true
}

/** 改过的格子按比例应占的块（层分辨率 = 修改时的尺寸；放大时一颗铺满一块） */
function editBlock(x, y, fromW, fromH, toW, toH) {
  return {
    x0: Math.floor(x * toW / fromW),
    x1: Math.min(toW - 1, Math.ceil((x + 1) * toW / fromW) - 1),
    y0: Math.floor(y * toH / fromH),
    y1: Math.min(toH - 1, Math.ceil((y + 1) * toH / fromH) - 1)
  }
}

/** 某块矩形里的色号 id 是否全是同一个值 */
function blockAll(state, rect, id) {
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (cellId(state, x, y) !== id) return false
    }
  }
  return true
}

/** 除某块以外，两张图的色号是否逐格一致（原图部分必须等于重新生成的结果） */
function diffOutside(a, b, rect) {
  const [w, h] = a.art.split('x').map(Number)
  let diff = 0
  let checked = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rect && x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) continue
      checked++
      if (cellId(a, x, y) !== cellId(b, x, y)) diff++
    }
  }
  return { diff, checked }
}

/** 按块放大的指纹：把旧画面最近邻放大到新尺寸，逐格比色号 */
function upscaleMismatch(before, after) {
  const [bw, bh] = before.art.split('x').map(Number)
  const [aw, ah] = after.art.split('x').map(Number)
  let diff = 0
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const sx = Math.min(bw - 1, Math.floor((x + 0.5) * bw / aw))
      const sy = Math.min(bh - 1, Math.floor((y + 0.5) * bh / ah))
      const a = after.artGrid[y][x] < 0 ? null : after.palette[after.artGrid[y][x]]
      const b = before.artGrid[sy][sx] < 0 ? null : before.palette[before.artGrid[sy][sx]]
      if (a !== b) diff++
    }
  }
  return aw * ah ? diff / (aw * ah) : 1
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const argv = process.argv.slice(2)
  const urlIdx = argv.indexOf('--url')
  const externalBase = urlIdx >= 0 ? String(argv[urlIdx + 1] || '').replace(/\/+$/, '') : ''
  const wIdx = argv.indexOf('--width')
  const hIdx = argv.indexOf('--height')
  const VW = wIdx >= 0 ? Number(argv[wIdx + 1]) : 1440
  const VH = hIdx >= 0 ? Number(argv[hIdx + 1]) : 1000
  const isMobile = VW <= 780
  const server = externalBase ? null : await staticServer()
  const origin = externalBase || `http://127.0.0.1:${PORT}`

  const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    process.exit(1)
  }
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'size-guard-chrome-'))
  const debugPort = 9335
  const child = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=' + VW + ',' + VH,
    'about:blank'
  ], { stdio: 'ignore' })

  let ws = ''
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 300))
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      const info = await res.json()
      ws = info.webSocketDebuggerUrl
      break
    } catch {
      /* 还没起来 */
    }
  }
  if (!ws) {
    console.error('Chrome 起不来')
    child.kill()
    process.exit(1)
  }

  const cdp = new CDP(ws)
  await cdp.ready
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => cdp.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

  const consoleErrors = []
  cdp.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(String(msg.params.exceptionDetails.text || ''))
    }
  })

  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: isMobile })
  await send('Page.navigate', { url: `${origin}/editor` })
  await new Promise((r) => setTimeout(r, 1800))
  await send('Runtime.evaluate', { expression: `try { localStorage.setItem('douwan.guide.v1', '1') } catch (e) {}` })

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'))
  }
  /* 全屏创作工作台把尺寸滑杆收进了右侧抽屉：桌面 / 窄三栏先点「成品尺寸」把抽屉打开，
     滑杆与说明行才在 DOM 里（手机端在底部弹层里，见 drag） */
  const openSizePanel = async () => {
    if (isMobile) return
    await evaluate(`(() => {
      if (document.querySelector('[data-size-range]')) return 'already'
      const b = [...document.querySelectorAll('.csSide__row')].find(el => /成品尺寸/.test(el.textContent))
      if (b) b.click()
      return !!b
    })()`)
    await sleep(700)
  }
  const reload = async () => {
    await send('Page.navigate', { url: `${origin}/editor` })
    await sleep(3500)
    await openSizePanel()
  }
  /* 手机端成品尺寸在底部弹层里：先点快捷栏的「尺寸」把弹层打开，滑杆才在 DOM 里 */
  const drag = async (v) => {
    if (isMobile) {
      await evaluate(`(() => {
        const b = [...document.querySelectorAll('.quickItem')].find(el => el.textContent.trim() === '尺寸')
        if (b) b.click()
        return !!b
      })()`)
      await sleep(800)
    }
    return evaluate(dragExpr(v))
  }

  const report = { origin, viewport: [VW, VH], consoleErrors }
  const fail = (msg) => {
    report.err = msg
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.error(JSON.stringify(report, null, 2))
    cdp.close()
    child.kill()
    server && server.close()
    process.exit(1)
  }

  /* ---------- ① 手改 + 放大：原图部分按原图重新取样，改过的那颗按 52 的尺寸铺成一块 ---------- */
  await reload()
  report.setup = await evaluate(setupExpr(52, true))
  if (!report.setup.ok) fail('准备失败：' + report.setup.err)
  const beforeUp = await evaluate(STATE)
  if (!beforeUp.manualEdited) fail('准备：画一笔之后 manualEdited 没立起来')
  const painted = cellId(beforeUp, 12, 12)
  await shot('up-before.png')
  await drag(156)
  const afterUp = await evaluate(STATE)
  await shot('up-after.png')
  const upBlock = editBlock(12, 12, 52, 52, 156, 156)
  /* 原图部分要与「同一份源图、同一套参数重新生成」逐格一致 —— 这就是「按原图缩放」 */
  await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    S.regenerate({ keys: ['easy'], silent: true })
    await sleep(700)
    return true
  })()`)
  const freshUp = await evaluate(STATE)
  report.upscale = { before: beforeUp, after: afterUp, painted, block: upBlock, freshDiff: diffOutside(afterUp, freshUp, upBlock) }
  if (afterUp.guardOpen) fail('放大：还弹层（用户明确说不要这个弹层）')
  if (afterUp.art !== '156x156') fail(`放大：成品区域没落到 156（实际 ${afterUp.art}）`)
  if (!afterUp.manualEdited) fail('放大：手改标记丢了（重新打开再改尺寸就不知道哪格是手改的）')
  if (!blockAll(afterUp, upBlock, painted)) {
    fail(`放大：改过的那颗没按 52 的尺寸铺成一块（${upBlock.x0},${upBlock.y0}–${upBlock.x1},${upBlock.y1} 应是 ${painted}）`)
  }
  if (report.upscale.freshDiff.diff) {
    fail(`放大：原图部分与重新生成的结果有 ${report.upscale.freshDiff.diff} 格不一致（应按原图缩放）`)
  }
  if (!/按原图/.test(afterUp.note)) fail(`放大：说明行没提「按原图」（实际「${afterUp.note}」）`)
  const headBeads = afterUp.headText ? (afterUp.headText.match(/([\d,]+)\s*颗/) || [])[1] : null
  if (headBeads && Number(headBeads.replace(/,/g, '')) !== afterUp.beads) fail('放大：顶栏颗数与画面对不上')

  /* ---------- ② 手改 + 缩小：原图部分按原图重新取样，改过的那颗落回对应的格子 ---------- */
  await reload()
  report.setupShrink = await evaluate(setupExpr(156, true))
  const beforeDown = await evaluate(STATE)
  const paintedDown = cellId(beforeDown, 12, 12)
  await drag(52)
  const afterDown = await evaluate(STATE)
  await shot('down-after.png')
  const downBlock = editBlock(12, 12, 156, 156, 52, 52)
  await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    S.regenerate({ keys: ['easy'], silent: true })
    await sleep(700)
    return true
  })()`)
  const freshDown = await evaluate(STATE)
  report.shrink = { before: beforeDown, after: afterDown, painted: paintedDown, block: downBlock, freshDiff: diffOutside(afterDown, freshDown, downBlock) }
  if (afterDown.guardOpen) fail('缩小：不该弹层')
  if (afterDown.art !== '52x52') fail(`缩小：成品区域没落到 52（实际 ${afterDown.art}）`)
  if (!afterDown.manualEdited) fail('缩小：手改标记丢了')
  if (!blockAll(afterDown, downBlock, paintedDown)) fail(`缩小：改过的豆子没跟着缩过去（应是 ${paintedDown}）`)
  if (report.shrink.freshDiff.diff) {
    fail(`缩小：原图部分与重新生成的结果有 ${report.shrink.freshDiff.diff} 格不一致（应按原图缩放）`)
  }

  /* ---------- ③ 存成作品 → 重开 → 放大：手改记录跟着存档走 ---------- */
  await reload()
  await evaluate(setupExpr(52, true))
  report.save = await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const id = S.saveProject('probe-' + Date.now())
    await sleep(800)
    const p = S.projects.value.find(x => x.id === id)
    const v = p && p.variants && (p.variants.find(x => x.key === p.activeKey) || p.variants[0])
    return { id, hasSource: !!(p && p.source && p.source.url), hasEdits: !!(v && v.data && v.data.edits) }
  })()`)
  if (!report.save.id) fail('存档：保存作品失败')
  if (!report.save.hasSource) fail('存档：作品里没带源图快照')
  if (!report.save.hasEdits) fail('存档：作品里没带手工修改记录')
  await reload()
  report.open = await evaluate(`(async () => {
    const S = await window.__douzao.studio()
    window.__studio = S
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const list = S.projects.value
    const p = list.find(x => /^probe-/.test(x.name)) || list[0]
    const ok = p ? S.openProject(p.id) : false
    await sleep(1500)
    return { ok, id: p && p.id, art: S.pattern.value && S.pattern.value.artW, manualEdited: S.manualEdited.value, sourceFromPattern: S.sourceFromPattern.value }
  })()`)
  if (!report.open.ok) fail('存档：打开作品失败')
  if (report.open.sourceFromPattern) fail('存档：打开作品后源图还是图纸重建的（应该用存档里的源图）')
  const beforeReopen = await evaluate(STATE)
  await drag(156)
  const afterReopen = await evaluate(STATE)
  await shot('reopen-after.png')
  const reopenBlock = editBlock(12, 12, 52, 52, 156, 156)
  await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    S.regenerate({ keys: ['easy'], silent: true })
    await sleep(700)
    return true
  })()`)
  const freshReopen = await evaluate(STATE)
  report.reopen = { before: beforeReopen, after: afterReopen, block: reopenBlock, freshDiff: diffOutside(afterReopen, freshReopen, reopenBlock) }
  if (afterReopen.guardOpen) fail('存档：放大弹层了')
  if (afterReopen.art !== '156x156') fail(`存档：成品区域没落到 156（实际 ${afterReopen.art}）`)
  if (!afterReopen.manualEdited) fail('存档：打开后放大，手改标记丢了')
  if (!blockAll(afterReopen, reopenBlock, painted)) fail(`存档：重开后放大，改过的豆子没落回原位（应是 ${painted}）`)
  if (report.reopen.freshDiff.diff) {
    fail(`存档：重开后放大，原图部分与重新生成的结果有 ${report.reopen.freshDiff.diff} 格不一致`)
  }

  /* ---------- ④ 没手改过：放大就是一张全新的原图转换（与重新生成逐格一致） ---------- */
  await reload()
  report.setupPlain = await evaluate(setupExpr(52, false))
  const beforePlain = await evaluate(STATE)
  await drag(156)
  const afterPlain = await evaluate(STATE)
  await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    S.regenerate({ keys: ['easy'], silent: true })
    await sleep(700)
    return true
  })()`)
  const freshPlain = await evaluate(STATE)
  report.plain = { before: beforePlain, after: afterPlain, freshDiff: diffOutside(afterPlain, freshPlain, null) }
  if (afterPlain.guardOpen) fail('没手改过：不该弹层')
  if (afterPlain.art !== '156x156') fail('没手改过：成品区域没落到 156')
  if (report.plain.freshDiff.diff) {
    fail(`没手改过：放大后有 ${report.plain.freshDiff.diff} 格与重新生成的结果不一致（应按原图缩放）`)
  }

  /* ---------- ⑤ 老存档（没源图快照）：源图按图纸重建，放大后旧豆颜色不变、手改不丢 ---------- */
  await reload()
  await evaluate(`(() => {
    const key = 'douzao-projects-v2'
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    const out = raw.map(p => { const q = { ...p }; delete q.source; return q })
    localStorage.setItem(key, JSON.stringify(out))
    return out.length
  })()`)
  await reload()
  await evaluate(`(async () => {
    const S = await window.__douzao.studio()
    window.__studio = S
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const list = S.projects.value
    const p = list.find(x => /^probe-/.test(x.name)) || list[0]
    if (p) S.openProject(p.id)
    await sleep(1500)
    return true
  })()`)
  const beforeLegacy = await evaluate(STATE)
  if (!beforeLegacy.sourceFromPattern) fail('老存档：源图应该是图纸重建的')
  await drag(156)
  const afterLegacy = await evaluate(STATE)
  await shot('legacy-after.png')
  report.legacy = { before: beforeLegacy, after: afterLegacy, mismatch: upscaleMismatch(beforeLegacy, afterLegacy) }
  if (afterLegacy.guardOpen) fail('老存档：不该弹层')
  if (afterLegacy.art !== '156x156') fail('老存档：成品区域没落到 156')
  /* 老存档（没源图快照）：同样按工作区当前图纸复制，颜色与画面位置都不变 */
  if (report.legacy.mismatch > 0.02) fail('老存档：放大不是按当前图纸复制的')
  if (!sameColors(beforeLegacy.palette, afterLegacy.palette)) {
    fail(`老存档：放大后色号变了（${beforeLegacy.palette.join(',')} → ${afterLegacy.palette.join(',')}）`)
  }
  if (!anchorsMatch(beforeLegacy, afterLegacy)) fail('老存档：放大后有些旧豆换了颜色')
  if (painted && cellId(afterLegacy, 36, 36) !== painted) fail('老存档：放大后改过的豆子丢了')

  /* ---------- ⑥ 滑杆上限 = 底板边界：拉到最大撑满画布、不超出不裁切 ---------- */
  await reload()
  await evaluate(`(async () => {
    const d = window.__douzao
    const S = await d.studio()
    const M = await d.membership()
    const A = await d.assets()
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
    S.options.removeBg = false
    await S.useAsset(A.ASSETS.find(a => a.featured) || A.ASSETS[0])
    await sleep(300)
    S.options.canvasMaxW = 104
    S.options.canvasMaxH = 104
    S.options.canvasW = 52
    S.options.canvasH = 52
    S.regenerate({ keys: ['easy'], silent: true })
    await sleep(600)
    window.__studio = S
    return true
  })()`)
  const beforeMax = await evaluate(STATE)
  const maxLong = Number(beforeMax.sliderMax)
  report.maxSlider = { before: beforeMax, sliderMax: maxLong }
  if (!(maxLong >= 104)) fail(`滑杆上限 ${maxLong} 小于底板边界 104（图案放不到画布最大）`)
  await drag(maxLong)
  const atMax = await evaluate(STATE)
  report.maxSlider.atMax = atMax
  await shot('max-after.png')
  const [bw, bh] = atMax.board.split('x').map(Number)
  const [aw, ah] = atMax.art.split('x').map(Number)
  if (aw > bw || ah > bh) fail(`拉到上限后图案超出画布（成品 ${atMax.art}，画布 ${atMax.board}）`)
  if (Math.max(aw, ah) !== Math.max(bw, bh)) fail(`拉到上限后没撑满画布（成品 ${atMax.art}，画布 ${atMax.board}）`)

  /* ---------- ⑦ 缩小再放大：细节一颗不少，缩小尺寸上改的格子也回原位 ---------- */
  await reload()
  report.setupRound = await evaluate(setupExpr(104, false))
  if (!report.setupRound.ok) fail('留底：准备失败 ' + report.setupRound.err)
  const roundBefore = await evaluate(STATE)
  await drag(52)
  const roundSmall = await evaluate(STATE)
  if (roundSmall.art !== '52x52') fail(`原图缩放：没缩到 52（实际 ${roundSmall.art}）`)
  await drag(104)
  const roundBack = await evaluate(STATE)
  await shot('roundtrip-back.png')
  await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    S.regenerate({ keys: ['easy'], silent: true })
    await sleep(700)
    return true
  })()`)
  const freshRound = await evaluate(STATE)
  report.round = {
    before: roundBefore.art,
    small: roundSmall.art,
    back: roundBack.art,
    freshDiff: diffOutside(roundBack, freshRound, null)
  }
  if (roundBack.art !== roundBefore.art) fail(`原图缩放：放回去没到原尺寸（${roundBefore.art} → ${roundBack.art}）`)
  if (report.round.freshDiff.diff) {
    fail(`原图缩放：缩小再放大后有 ${report.round.freshDiff.diff} 格与重新生成的结果不一致（应始终按原图）`)
  }
  if (!/按原图/.test(roundBack.note)) fail(`原图缩放：说明行没提「按原图」（实际「${roundBack.note}」）`)

  /* 在缩小后的尺寸上改一格，再放回去：这一笔按 52 的尺寸铺成 2×2 一块 */
  await drag(52)
  report.roundPaint = await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const p = S.pattern.value
    const ox = Math.floor((p.width - p.artW) / 2)
    const oy = Math.floor((p.height - p.artH) / 2)
    const at = (oy + 12) * p.width + (ox + 12)
    const k = p.cells[at]
    const brush = p.palette.find((c, i) => i !== k) || p.palette[0]
    S.brushColorId.value = brush.id
    S.paintAt(ox + 12, oy + 12)
    await sleep(250)
    return { id: brush.id, x: 12, y: 12, manualEdited: S.manualEdited.value }
  })()`)
  await drag(104)
  const roundEdited = await evaluate(STATE)
  report.round.edited = roundEdited.art
  if (!report.roundPaint.manualEdited) fail('修改缩放：缩小尺寸上改了一笔，manualEdited 没立起来')
  const roundBlock = editBlock(report.roundPaint.x, report.roundPaint.y, 52, 52, 104, 104)
  report.round.block = roundBlock
  if (!blockAll(roundEdited, roundBlock, report.roundPaint.id)) {
    fail(`修改缩放：缩小尺寸上改的那一格放大后没按 52 的尺寸铺成一块（${roundBlock.x0},${roundBlock.y0}–${roundBlock.x1},${roundBlock.y1} 应是 ${report.roundPaint.id}）`)
  }

  /* ---------- ⑧ 在 104 上改 → 缩到 52 → 存档 → 重开 → 放回 104：仍是那一颗（修改层进存档） ---------- */
  await reload()
  report.setupLayer = await evaluate(setupExpr(104, true))
  if (!report.setupLayer.ok) fail('修改层：准备失败 ' + report.setupLayer.err)
  const layerBefore = await evaluate(STATE)
  report.layerBefore = layerBefore
  const layerPainted = cellId(layerBefore, 12, 12)
  await drag(52)
  report.layerSmall = await evaluate(STATE)
  report.layerSave = await evaluate(`(async () => {
    const S = window.__studio
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const id = S.saveProject('probe-layer-' + Date.now())
    await sleep(800)
    const p = S.projects.value.find(x => x.id === id)
    const v = p && p.variants && (p.variants.find(x => x.key === p.activeKey) || p.variants[0])
    return { id, activeKey: p && p.activeKey, hasLayer: !!(v && v.data && v.data.layer) }
  })()`)
  if (!report.layerSave.id) fail('修改层：存档失败')
  if (!report.layerSave.hasLayer) fail('修改层：存档里没带上比图纸更细的修改层')
  await reload()
  await evaluate(`(async () => {
    const S = await window.__douzao.studio()
    window.__studio = S
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const p = S.projects.value.find(x => /^probe-layer-/.test(x.name)) || S.projects.value[0]
    if (p) S.openProject(p.id)
    await sleep(1500)
    return true
  })()`)
  const layerReopen = await evaluate(STATE)
  report.layerStates = { before: layerBefore, reopen: layerReopen }
  if (layerReopen.art !== '52x52') fail(`修改层：重开后成品区域应是 52（实际 ${layerReopen.art}）`)
  await drag(104)
  const layerBack = await evaluate(STATE)
  await shot('layer-roundtrip.png')
  const layerBlock = editBlock(12, 12, 104, 104, 104, 104)
  report.layerRound = { before: layerBefore.art, reopen: layerReopen.art, back: layerBack.art, painted: layerPainted }
  if (layerBack.art !== '104x104') fail(`修改层：放回去没到 104（实际 ${layerBack.art}）`)
  if (!blockAll(layerBack, layerBlock, layerPainted)) {
    fail(`修改层：104 上改的那一颗放回 104 后变成了一块（${layerBlock.x0},${layerBlock.y0} 应是 ${layerPainted}，实际 ${cellId(layerBack, layerBlock.x0, layerBlock.y0)}）`)
  }

  if (consoleErrors.length) fail('页面 console 有报错：' + consoleErrors.slice(0, 3).join(' | '))
  report.ok = true
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    ok: true,
    viewport: [VW, VH],
    upscale: { freshDiff: report.upscale.freshDiff.diff, block: report.upscale.block },
    shrink: { art: report.shrink.after.art, freshDiff: report.shrink.freshDiff.diff },
    reopen: { freshDiff: report.reopen.freshDiff.diff, block: report.reopen.block },
    legacy: { mismatch: report.legacy.mismatch },
    round: report.round,
    layer: report.layerRound,
    maxSlider: { max: maxLong, art: atMax.art, board: atMax.board }
  }, null, 2))
  cdp.close()
  child.kill()
  server && server.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
