/* =========================================================================
   电脑端工作台：键盘快捷键 + 中键拖动画布 + 悬停浮动标签 自检
   用法：node scripts/verify-shortcuts.cjs [--url http://127.0.0.1:4180]

   断言的都是**真实输入**（CDP 的 Input 域），不是脚本里改状态：
     · 中键按住拖动 → 画布真的跟着走（图纸在屏幕上的位置变了），
       而且没有顺手在图上落一笔（格子逐格不变）；
     · 电脑端（≥1100）：B / E / G / I / C 切工具、R 去除杂色、M 左右镜像；
     · 输入框里打字不切工具；Ctrl+Z 仍然是撤销（快捷键不抢浏览器的键）；
     · 电脑端鼠标停在工具上 → 浮出标签，标签里有工具名与快捷键标注，移开就消失；
     · 平板（781–1099）与手机（≤780）：工具上不标快捷键，按 B 不切工具；
       手指长按一格吸到这一格的颜色并切回画笔，短按不吸色；
       两指同时点下去撤回上一步，而且不把画布拖走。
   产物：.tmp/verify-shortcuts/（截图 + report.json）
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.tmp', 'verify-shortcuts')
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
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id); this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message + '（' + method + '）')); else resolve(msg.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')) } }, 30000)
    })
  }
  close() { try { this.ws.close() } catch {} }
}

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => p && fs.existsSync(p))

async function main() {
  const urlIdx = process.argv.indexOf('--url')
  const external = urlIdx > 0 ? String(process.argv[urlIdx + 1] || '').replace(/\/+$/, '') : ''
  const server = external ? null : await staticServer()
  const origin = external || `http://127.0.0.1:${server.address().port}`
  const port = 9800 + (process.pid % 150)
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
    return { targetId: t.targetId, send, sessionId }
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

  /* 真实按键：走 CDP 的 Input 域，页面收到的是货真价实的 keydown */
  const pressKey = async (send, key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk })
    await sleep(140)
  }
  /* 真实鼠标：中键按下 → 移动 → 松开 */
  const middleDrag = async (send, x, y, dx, dy) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'middle', buttons: 4, clickCount: 1 })
    for (let i = 1; i <= 4; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x + dx * i / 4), y: Math.round(y + dy * i / 4), button: 'middle', buttons: 4 })
      await sleep(30)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x + dx), y: Math.round(y + dy), button: 'middle', buttons: 0, clickCount: 1 })
    await sleep(180)
  }
  const hoverAt = async (send, x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 0 })
    await sleep(160)
  }

  // 预置作品（真实生成链路）
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

  const { targetId, send, sessionId } = await newPage()
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${origin}/` })
  await sleep(400)
  await evalJs(send, `sessionStorage.setItem('douwan-upgrade-notice','1'); localStorage.setItem('douwan.guide.v1','1'); 1`)
  await send('Page.navigate', { url: `${origin}/editor/${fixtureId}` })
  await waitBridge(send); await sleep(1400)

  const report = []
  const check = (name, ok, extra) => { report.push({ name, ok: !!ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')) }
  const errors = []
  await send('Log.enable').catch(() => {})

  /* 把控制台报错收进来（页面级报错也算） */
  await send('Runtime.enable')
  browser.ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.sessionId !== sessionId) return
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text || 'exception')
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '))
    }
  })

  // 展开工具轨
  await evalJs(send, `(() => { const r = document.querySelector('.csRail'); if (!r.classList.contains('is-open')) { const t = document.querySelector('[data-rail-toggle]'); if (t) t.click() } return 1 })()`)
  await sleep(500)
  const railOpen = await evalJs(send, `!!document.querySelector('.csRail.is-open')`)
  check('工具轨已展开', railOpen === true, railOpen)
  await sleep(300)

  const toolNow = () => evalJs(send, `window.__douzao.studio().then(S => S.tool.value)`)

  /* ---------------- 1. 键盘快捷键：切工具 ---------------- */
  const TOOL_KEYS = [
    ['b', 'KeyB', 66, 'paint'],
    ['e', 'KeyE', 69, 'erase'],
    ['g', 'KeyG', 71, 'fill'],
    ['i', 'KeyI', 73, 'pick'],
    ['c', 'KeyC', 67, 'swap']
  ]
  for (const [key, code, vk, want] of TOOL_KEYS) {
    await pressKey(send, key, code, vk)
    const got = await toolNow()
    check(`快捷键 ${key.toUpperCase()} 切到「${want}」`, got === want, got)
  }

  /* ---------------- 2. 键盘快捷键：镜像（M）逐格比对 ---------------- */
  const mirror = await evalJs(send, `(async () => {
    const S = await window.__douzao.studio()
    const before = Array.from(S.pattern.value.cells)
    const w = S.pattern.value.width, h = S.pattern.value.height
    return { before, w, h }
  })()`)
  await pressKey(send, 'm', 'KeyM', 77)
  await sleep(400)
  const mirrored = await evalJs(send, `(async () => {
    const S = await window.__douzao.studio()
    return { after: Array.from(S.pattern.value.cells), w: S.pattern.value.width, h: S.pattern.value.height }
  })()`)
  const expectFlip = (arr, w, h) => {
    const out = new Array(arr.length)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = arr[y * w + (w - 1 - x)]
    return out
  }
  const flipped = expectFlip(mirror.before, mirror.w, mirror.h)
  const same = mirrored.after.length === flipped.length && flipped.every((v, i) => v === mirrored.after[i])
  const changed = mirror.before.some((v, i) => v !== mirrored.after[i])
  check('快捷键 M 把图纸水平翻转了（逐格比对）', same && changed, { same, changed })

  /* Ctrl+Z 仍然是撤销（快捷键不能抢浏览器的键） */
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2, text: 'z' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 })
  await sleep(500)
  const undone = await evalJs(send, `(async () => { const S = await window.__douzao.studio(); return Array.from(S.pattern.value.cells) })()`)
  const backToStart = mirror.before.length === undone.length && mirror.before.every((v, i) => v === undone[i])
  check('Ctrl+Z 仍然是撤销（快捷键没抢）', backToStart, backToStart)

  /* ---------------- 3. 键盘快捷键：去杂色（R） ---------------- */
  await evalJs(send, `(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); return 1 })()`)
  await pressKey(send, 'r', 'KeyR', 82)
  await sleep(500)
  const speckToast = await evalJs(send, `(() => { const t = [...document.querySelectorAll('.toast')].map(x => (x.textContent || '').trim()); return t.join(' | ') })()`)
  check('快捷键 R 触发了「去除杂色」', /杂色|孤立豆/.test(speckToast), speckToast)

  /* ---------------- 4. 输入框里打字不切工具 ---------------- */
  await pressKey(send, 'b', 'KeyB', 66)
  const beforeType = await toolNow()
  await evalJs(send, `(() => { const i = document.createElement('input'); i.id = '__probeInput'; document.body.appendChild(i); i.focus(); return 1 })()`)
  await pressKey(send, 'e', 'KeyE', 69)
  const afterType = await toolNow()
  const typed = await evalJs(send, `(() => { const i = document.getElementById('__probeInput'); const v = i.value; i.remove(); return v })()`)
  check('输入框里打字不切工具', beforeType === afterType && beforeType === 'paint' && typed === 'e', { beforeType, afterType, typed })

  /* ---------------- 5. 中键拖动画布 ---------------- */
  await evalJs(send, `(() => { const S = window.__douzao; return 1 })()`)
  const stageBox = await evalJs(send, `(() => {
    const s = document.querySelector('.stage'); const b = document.querySelector('.board.editing');
    const sr = s.getBoundingClientRect(); const br = b ? b.getBoundingClientRect() : sr
    return { sl: s.scrollLeft, st: s.scrollTop, sx: sr.x, sy: sr.y, sw: sr.width, sh: sr.height, bx: br.x, by: br.y }
  })()`)
  const cellsBefore = await evalJs(send, `(async () => { const S = await window.__douzao.studio(); return Array.from(S.pattern.value.cells) })()`)
  const cx = Math.round(stageBox.sx + stageBox.sw / 2)
  const cy = Math.round(stageBox.sy + stageBox.sh / 2)
  await middleDrag(send, cx, cy, 140, 90)
  const stageAfter = await evalJs(send, `(() => {
    const s = document.querySelector('.stage'); const b = document.querySelector('.board.editing');
    const sr = s.getBoundingClientRect(); const br = b ? b.getBoundingClientRect() : sr
    return { sl: s.scrollLeft, st: s.scrollTop, bx: br.x, by: br.y, midPan: !!document.querySelector('.stage.mid-pan') }
  })()`)
  const dx = stageAfter.bx - stageBox.bx
  const dy = stageAfter.by - stageBox.by
  check('中键拖动把画布拖走了', Math.abs(dx - 140) < 12 && Math.abs(dy - 90) < 12, { dx, dy, sl: [stageBox.sl, stageAfter.sl], st: [stageBox.st, stageAfter.st] })
  const cellsAfter = await evalJs(send, `(async () => { const S = await window.__douzao.studio(); return Array.from(S.pattern.value.cells) })()`)
  const cellsSame = cellsBefore.length === cellsAfter.length && cellsBefore.every((v, i) => v === cellsAfter[i])
  check('中键拖动没有顺手落笔（格子逐格不变）', cellsSame, { before: cellsBefore.length, after: cellsAfter.length })
  check('中键拖动结束后光标状态复位', stageAfter.midPan === false, stageAfter.midPan)

  /* ---------------- 6. 悬停浮动标签 ---------------- */
  const railGeo = await evalJs(send, `(() => {
    const r = document.querySelector('.csRail')
    const rect = r.getBoundingClientRect()
    const cs = document.querySelector('.csStatus')
    const canvas = document.querySelector('.studio__canvas')
    const box = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { y: Math.round(b.y), h: Math.round(b.height), bottom: Math.round(b.bottom) } }
    return {
      clientH: r.clientHeight, scrollH: r.scrollHeight, rectH: Math.round(rect.height),
      overflow: r.scrollHeight - r.clientHeight,
      rail: box(r), canvas: box(canvas), status: box(cs),
      maxH: getComputedStyle(r).maxHeight,
      tools: [...document.querySelectorAll('.csTools .csTool')].map(b => {
        const q = b.getBoundingClientRect()
        return { name: (b.textContent || '').trim(), y: Math.round(q.y), h: Math.round(q.height), inRail: q.y >= rect.top - 1 && q.bottom <= rect.bottom + 1 }
      })
    }
  })()`)
  console.log('rail geometry:', JSON.stringify(railGeo))
  const TOOL_TIPS = [
    ['移动', '中键'],
    ['画笔', 'B'], ['橡皮', 'E'], ['填充', 'G'], ['吸色', 'I'],
    ['换色', 'C'], ['去除杂色', 'R'], ['左右镜像', 'M']
  ]
  for (const [label, key] of TOOL_TIPS) {
    const box = await evalJs(send, `(() => {
      const b = [...document.querySelectorAll('.csTools .csTool')].find(x => (x.textContent || '').trim() === ${JSON.stringify(label)})
      if (!b) return null
      /* 工具轨是滚动容器，底部还有一块吸底页脚：
         把按钮滚到轨的正中间，避开吸底页脚盖住的那一截 */
      b.scrollIntoView({ block: 'center' })
      return true
    })()`)
    await sleep(260)
    const pos = await evalJs(send, `(() => {
      const b = [...document.querySelectorAll('.csTools .csTool')].find(x => (x.textContent || '').trim() === ${JSON.stringify(label)})
      if (!b) return null
      const r = b.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const hit = document.elementFromPoint(x, y)
      return { x, y, inView: r.y > 0 && r.y < innerHeight, onTarget: !!(hit && b.contains(hit)) }
    })()`)
    if (!pos || !pos.inView || !pos.onTarget) { check(`悬停「${label}」浮出标签`, false, pos || '按钮没找到'); continue }
    await hoverAt(send, pos.x, pos.y)
    const tip = await evalJs(send, `(() => {
      const t = document.querySelector('[data-shortcut-tip]')
      if (!t) return null
      const r = t.getBoundingClientRect()
      const rail = document.querySelector('.csRail').getBoundingClientRect()
      return { text: (t.textContent || '').replace(/\\s+/g, ' ').trim(), key: (t.querySelector('.stip__key') || {}).textContent, x: r.x, y: r.y, w: r.width, railRight: rail.right, vw: innerWidth, vh: innerHeight }
    })()`)
    const okTip = !!tip && tip.text.includes(label) && (tip.key || '').trim() === key &&
      tip.x >= tip.railRight - 1 && tip.x < tip.vw && tip.y >= 0 && tip.y < tip.vh
    check(`悬停「${label}」浮出标签并标注快捷键 ${key}`, okTip, tip)
    if (label === '移动' || label === '画笔') {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, label === '移动' ? 'tip-pan.png' : 'tip-brush.png'), Buffer.from(shot.data, 'base64'))
    }
  }
  /* 移开鼠标 → 标签消失 */
  await hoverAt(send, Math.round(stageBox.sx + stageBox.sw / 2), Math.round(stageBox.sy + stageBox.sh / 2))
  const tipGone = await evalJs(send, `!document.querySelector('[data-shortcut-tip]')`)
  check('鼠标移开后标签消失', tipGone === true, tipGone)

  /* ---------------- 6.5 笔：点「画笔」进入画笔模式，笔只编辑不拖画布 ---------------- */
  {
    await evalJs(send, `(() => {
      window.__penSeen = []
      document.addEventListener('pointerdown', e => window.__penSeen.push(e.pointerType), true)
      const b = document.querySelector('[data-tool-key="paint"]')
      if (b) b.scrollIntoView({ block: 'center' })
      return 1
    })()`)
    await sleep(250)
    const brushPos = await evalJs(send, `(() => {
      const b = document.querySelector('[data-tool-key="paint"]')
      if (!b) return null
      const r = b.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const hit = document.elementFromPoint(x, y)
      return { x, y, onTarget: !!(hit && b.contains(hit)) }
    })()`)
    /* 先把工具切到「移动」：笔点画笔必须真的把工具换回画笔 */
    await evalJs(send, `window.__douzao.studio().then(S => { S.tool.value = 'pan' })`)
    await sleep(120)
    if (brushPos && brushPos.onTarget) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: brushPos.x, y: brushPos.y, buttons: 0, pointerType: 'pen' })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: brushPos.x, y: brushPos.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: brushPos.x, y: brushPos.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
      await sleep(220)
    }
    const penTool = await toolNow()
    const penSeen = await evalJs(send, `window.__penSeen.slice()`)
    check('笔点「画笔」后进入画笔模式', penTool === 'paint' && penSeen.includes('pen'), { penTool, penSeen, clicked: !!(brushPos && brushPos.onTarget) })

    /* 画布状态：格子、图纸在屏幕上的位置、舞台滚动 */
    const view = () => evalJs(send, `(async () => {
      const S = await window.__douzao.studio()
      const b = document.querySelector('.board.editing').getBoundingClientRect()
      const s = document.querySelector('.stage')
      return { cells: Array.from(S.pattern.value.cells), board: { x: Math.round(b.x), y: Math.round(b.y) }, sl: s.scrollLeft, st: s.scrollTop }
    })()`)
    const stroke = async (x, y, pointerType) => {
      const at = { x: Math.round(x), y: Math.round(y) }
      const opt = pointerType ? { pointerType } : {}
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, buttons: 0, ...opt })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1, ...opt })
      for (let i = 1; i <= 4; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + i * 12, y: at.y + i * 8, button: 'left', buttons: 1, ...opt })
        await sleep(30)
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + 48, y: at.y + 32, button: 'left', buttons: 0, clickCount: 1, ...opt })
      await sleep(260)
    }
    const paintPoint = await evalJs(send, `(() => {
      const b = document.querySelector('.board.editing').getBoundingClientRect()
      return { x: b.x + b.width * 0.4, y: b.y + b.height * 0.4 }
    })()`)

    const mouseBefore = await view()
    await stroke(paintPoint.x + 60, paintPoint.y, '')
    const mouseAfter = await view()
    check('鼠标画一笔后视野不动',
      mouseAfter.board.x === mouseBefore.board.x && mouseAfter.board.y === mouseBefore.board.y &&
      mouseAfter.sl === mouseBefore.sl && mouseAfter.st === mouseBefore.st,
      { board: [mouseBefore.board, mouseAfter.board], scroll: [[mouseBefore.sl, mouseBefore.st], [mouseAfter.sl, mouseAfter.st]] })

    const penBefore = await view()
    await stroke(paintPoint.x, paintPoint.y, 'pen')
    const penAfter = await view()
    const penChanged = penAfter.cells.reduce((n, v, i) => n + (v !== penBefore.cells[i] ? 1 : 0), 0)
    check('笔在画布上画，不拖动画布',
      penChanged > 0 && penAfter.board.x === penBefore.board.x && penAfter.board.y === penBefore.board.y &&
      penAfter.sl === penBefore.sl && penAfter.st === penBefore.st,
      { changed: penChanged, board: [penBefore.board, penAfter.board], scroll: [[penBefore.sl, penBefore.st], [penAfter.sl, penAfter.st]] })
  }

  /* ---------------- 7. 控制台报错 ---------------- */
  check('控制台没有报错', errors.length === 0, errors)

  /* ---------------- 8. 平板（781~1099）与手机（≤780）：没有快捷键，手指长按吸色 ---------------- */
  {
    const { targetId: tid2, send: send2 } = await newPage()
    await send2('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: true })
    await send2('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    /* 新标签页的 sessionStorage 是空的 → 网站升级公告会盖住整页。
       先在同源页面把它标成「本次会话已看过」，再去开工作台。 */
    await send2('Page.navigate', { url: `${origin}/` })
    await waitBridge(send2)
    await evalJs(send2, `sessionStorage.setItem('douwan-upgrade-notice','1'); localStorage.setItem('douwan.guide.v1','1'); 1`)
    await send2('Page.navigate', { url: `${origin}/editor/${fixtureId}` })
    await waitBridge(send2); await sleep(1500)

    const legacy = await evalJs(send2, `(() => {
      const modal = document.querySelector('.modal.show')
      const panel = document.querySelector('.editPanel')
      const btn = [...document.querySelectorAll('.editPanel .tool')].find(x => (x.textContent || '').trim() === '画笔')
      if (!btn) return { panel: !!panel, btn: false, modal: modal ? modal.className : null }
      const r = btn.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const hit = document.elementFromPoint(x, y)
      return {
        panel: !!panel, btn: true, x, y,
        modal: modal ? modal.className : null,
        inView: r.y > 0 && r.y < innerHeight,
        onTarget: !!(hit && btn.contains(hit)),
        hitTag: hit ? hit.tagName + '.' + (hit.className || '') : null,
        tipAttr: btn.getAttribute('data-tip'),
        panelDisplay: panel ? getComputedStyle(panel).display : null
      }
    })()`)
    check('平板：画布下方的工具行在（781~1099px）', legacy.panel && legacy.btn && !legacy.modal, legacy)
    /* 浏览器窗口锁在屏幕上：页面本身不滚、不回弹，双指不能缩放页面；
       内容改在 .studio 里自己滚，画布自己的平移 / 编辑仍走 PointerEvent。 */
    const locked = await evalJs(send2, `(() => {
      const html = document.documentElement
      const studio = document.querySelector('.studio')
      const meta = document.querySelector('meta[name="viewport"]')
      const before = { y: scrollY, doc: document.scrollingElement.scrollTop }
      window.scrollTo(0, 600)
      document.scrollingElement.scrollTop = 600
      const after = { y: scrollY, doc: document.scrollingElement.scrollTop }
      return {
        htmlFixed: html.classList.contains('is-editor-fixed'),
        bodyFixed: document.body.classList.contains('is-editor-fixed'),
        overflow: getComputedStyle(html).overflow,
        meta: meta && meta.getAttribute('content'),
        page: [before, after],
        studioOverflow: studio && getComputedStyle(studio).overflowY,
        studioScrollable: !!studio && studio.scrollHeight > studio.clientHeight + 2,
        studioClass: studio && studio.className
      }
    })()`)
    check('平板：浏览器页面固定在屏幕上，双指不能缩放页面',
      locked.htmlFixed && locked.bodyFixed && locked.overflow === 'hidden' &&
      /user-scalable=no/.test(locked.meta || '') &&
      locked.page[1].y === 0 && locked.page[1].doc === 0 &&
      locked.studioOverflow === 'auto' && locked.studioScrollable, locked)
    const noKey = await evalJs(send2, `(() => {
      const tools = [...document.querySelectorAll('.editPanel .tool[data-tip], .editPanel .tool')]
      const marked = tools.filter(b => (b.getAttribute('data-tip-key') || '').trim())
      return { n: tools.length, marked: marked.map(b => (b.textContent || '').trim() + '=' + b.getAttribute('data-tip-key')) }
    })()`)
    check('平板：工具按钮上不标快捷键', noKey.n > 0 && noKey.marked.length === 0, noKey)
    const toolBeforeKey = await evalJs(send2, `window.__douzao.studio().then(S => S.tool.value)`)
    await pressKey(send2, 'b', 'KeyB', 66)
    await pressKey(send2, 'i', 'KeyI', 73)
    const toolAfterKey = await evalJs(send2, `window.__douzao.studio().then(S => S.tool.value)`)
    check('平板：按 B / I 不切工具', toolBeforeKey === toolAfterKey, { toolBeforeKey, toolAfterKey })
    if (legacy.btn && legacy.inView && !legacy.modal) {
      await hoverAt(send2, legacy.x, legacy.y)
      const tip = await evalJs(send2, `!!document.querySelector('[data-shortcut-tip]')`)
      check('平板：悬停工具不浮出快捷键标签', tip === false, tip)
      await hoverAt(send2, 5, 5)
      const gestureTip = await evalJs(send2, `(() => {
        const pick = [...document.querySelectorAll('.editPanel .tool')].find(x => (x.textContent || '').replace(/\\s+/g, '') === '吸色')
        const undo = document.querySelector('.editPanel [data-tip="撤销"]')
        const box = el => {
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 20)) }
        }
        const note = document.querySelector('.hintTouch')
        const shown = el => !!el && getComputedStyle(el).display !== 'none' && (!el.parentElement || getComputedStyle(el.parentElement).display !== 'none')
        return {
          pick: pick ? box(pick) : null,
          undo: undo ? box(undo) : null,
          pickDesc: pick ? pick.getAttribute('data-tip-desc') : '',
          undoDesc: undo ? undo.getAttribute('data-tip-desc') : '',
          note: shown(note) && (note.textContent || '')
        }
      })()`)
      let pickTip = ''
      if (gestureTip.pick) {
        await hoverAt(send2, gestureTip.pick.x, gestureTip.pick.y)
        pickTip = await evalJs(send2, `(() => {
          const tip = document.querySelector('[data-shortcut-tip]')
          return tip ? (tip.textContent || '').replace(/\\s+/g, '') : ''
        })()`)
        await hoverAt(send2, 5, 5)
      }
      check('平板：吸色指引写长按取色，撤销指引写两指',
        !!gestureTip.pick && /长按一格/.test(gestureTip.pickDesc || '') && /长按一格/.test(pickTip) &&
        /两根手指/.test(gestureTip.undoDesc || ''), { gestureTip, pickTip })
      check('平板：画布提示能看见吸色和撤回', /长按一格吸色/.test(gestureTip.note || '') && /撤回/.test(gestureTip.note || ''), gestureTip)

      /* 平板锁画布：顶栏不再给缩放按钮，工具行里没有「移动」；
         连隐藏的手机浮控被脚本点到、滚轮事件打上去都不改缩放。 */
      const lockUi = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const stage = document.querySelector('.stage')
        const zoomBarButtons = [...document.querySelectorAll('.canvasCard__toolbar .zoomBar .btn')]
          .filter(b => getComputedStyle(b).display !== 'none')
        const toolLabels = [...document.querySelectorAll('.editPanel .tool')].map(b => (b.textContent || '').trim())
        const zoomBefore = S.zoom.value
        const plus = [...document.querySelectorAll('.stageTools__btn')].find(x => (x.getAttribute('title') || '') === '放大')
        if (plus) plus.click()
        if (stage) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
        await new Promise(r => setTimeout(r, 500))
        return {
          zoomBarButtons: zoomBarButtons.length,
          hasPan: toolLabels.includes('移动'),
          zoomBefore, zoomAfter: S.zoom.value,
          stageLocked: !!stage && stage.classList.contains('stage--locked'),
          stageOverflow: stage ? getComputedStyle(stage).overflow : null
        }
      })()`)
      check('平板：没有缩放按钮，隐藏浮控 / 滚轮也改不了缩放',
        lockUi.zoomBarButtons === 0 && lockUi.zoomAfter === lockUi.zoomBefore &&
        lockUi.stageLocked && lockUi.stageOverflow === 'hidden', lockUi)
      check('平板：工具行没有「移动」', lockUi.hasPan === false, lockUi)

      /* 中键拖动在锁画布后也不该把画布拖走 */
      const before = await evalJs(send2, `(() => {
        const s = document.querySelector('.stage'); const b = document.querySelector('.board.editing')
        if (!s || !b) return null
        const sr = s.getBoundingClientRect(); const br = b.getBoundingClientRect()
        return {
          sl: s.scrollLeft, st: s.scrollTop, bx: br.x, by: br.y,
          cx: Math.round(sr.x + sr.width / 2), cy: Math.round(sr.y + sr.height / 2)
        }
      })()`)
      if (before) {
        await middleDrag(send2, before.cx, before.cy, 120, 90)
        const after = await evalJs(send2, `(() => {
          const s = document.querySelector('.stage'); const b = document.querySelector('.board.editing')
          return { sl: s.scrollLeft, st: s.scrollTop, bx: b.getBoundingClientRect().x, by: b.getBoundingClientRect().y }
        })()`)
        check('平板：中键拖动不再平移画布',
          after.sl === before.sl && after.st === before.st &&
          Math.abs(after.bx - before.bx) < 2 && Math.abs(after.by - before.by) < 2,
          { before, after })
      } else {
        check('平板：中键拖动不再平移画布', false, { reason: '找不到舞台或图纸' })
      }
    }

    /* 手指长按一格：吸到这一格的颜色，切回画笔，而且不把这一格改掉。
       短按（按下马上松开）不能吸色。 */
    const holdPoint = await evalJs(send2, `(async () => {
      const S = await window.__douzao.studio()
      S.tool.value = 'paint'
      const canvas = document.querySelector('.board.editing canvas')
      if (!canvas || !S.pattern.value) return null
      const p = S.pattern.value
      const box = canvas.getBoundingClientRect()
      /* 用页面自己的命中函数反查：从画布中心往外找第一格有颜色的点，
         这样落点和长按吸色走的是同一套几何（含标尺、边框、缩放）。 */
      const hitAt = (x, y) => window.__douzao.render.hitTest(canvas, p, { clientX: x, clientY: y }, {
        cell: Math.max(3, Math.round(Math.max(0.5, Math.min(20, 640 / Math.max(p.width, p.height))) * S.zoom.value)),
        ruler: !document.querySelector('.canvasCard--console'),
        grid: S.options.showGrid !== false, codes: !!S.options.numbering, bold: true
      })
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      let found = null
      for (let ring = 0; ring < 24 && !found; ring++) {
        const step = 6 + ring * 4
        const spots = ring === 0 ? [[cx, cy]] : [[cx + step, cy], [cx - step, cy], [cx, cy + step], [cx, cy - step]]
        for (const [x, y] of spots) {
          const hit = hitAt(x, y)
          if (!hit) continue
          const k = p.cells[hit.index]
          if (k < 0 || !p.palette[k]) continue
          found = { x: Math.round(x), y: Math.round(y), id: p.palette[k].id, code: p.palette[k].code, idx: hit.index }
          break
        }
      }
      return found
    })()`)
    if (!holdPoint) {
      check('平板：长按吸到这一格的颜色并切回画笔', false, '找不到有颜色的格子')
      check('平板：长按没有改掉这一格', false, '找不到有颜色的格子')
      check('平板：短按不吸色', false, '找不到有颜色的格子')
    } else {
      const touchAt = (type, pts) => send2('Input.dispatchTouchEvent', { type, touchPoints: pts })
      const finger = (px, py) => [{ x: px, y: py, id: 1, radiusX: 6, radiusY: 6, force: 1 }]
      /* 先长按：短按若走画笔会先改掉这一格，后面就分不清吸到的是原色还是刚画上去的色 */
      await evalJs(send2, `window.__douzao.studio().then(S => { S.tool.value = 'erase'; S.brushColorId.value = ''; return 1 })`)
      await touchAt('touchStart', finger(holdPoint.x, holdPoint.y))
      await sleep(620)
      const heldCell = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const p = S.pattern.value
        const k = p.cells[${holdPoint.idx}]
        const id = k >= 0 && p.palette[k] ? p.palette[k].id : null
        return { tool: S.tool.value, brush: S.brushColorId.value, id, want: ${JSON.stringify(holdPoint.id)} }
      })()`)
      await touchAt('touchEnd', [])
      await sleep(200)
      check('平板：长按吸到这一格的颜色并切回画笔', heldCell.tool === 'paint' && heldCell.brush === holdPoint.id, { heldCell, code: holdPoint.code })
      check('平板：长按没有把这一格擦掉', heldCell.id === holdPoint.id, heldCell)

      /* 真机按住时手指会抖十几像素。抖动不能取消吸色，也不能把笔拖出去。 */
      await evalJs(send2, `window.__douzao.studio().then(S => { S.tool.value = 'erase'; S.brushColorId.value = ''; return 1 })`)
      const beforeJitter = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        return Array.from(S.pattern.value.cells)
      })()`)
      await touchAt('touchStart', finger(holdPoint.x, holdPoint.y))
      for (let i = 1; i <= 3; i++) {
        await touchAt('touchMove', finger(holdPoint.x + i * 4, holdPoint.y + 2))
        await sleep(40)
      }
      await sleep(500)
      const jitter = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const cells = Array.from(S.pattern.value.cells)
        let changed = 0
        const before = ${JSON.stringify(beforeJitter)}
        for (let i = 0; i < cells.length; i++) if (cells[i] !== before[i]) changed++
        return { tool: S.tool.value, brush: S.brushColorId.value, changed }
      })()`)
      await touchAt('touchEnd', [])
      await sleep(150)
      check('平板：手指抖动仍能吸色，且没有拖动画笔', jitter.tool === 'paint' && jitter.brush === holdPoint.id && jitter.changed === 0, jitter)

      await evalJs(send2, `window.__douzao.studio().then(S => { S.brushColorId.value = ''; return 1 })`)
      await touchAt('touchStart', finger(holdPoint.x, holdPoint.y))
      await sleep(80)
      await touchAt('touchEnd', [])
      await sleep(200)
      const tap = await evalJs(send2, `window.__douzao.studio().then(S => S.brushColorId.value)`)
      check('平板：短按不吸色', tap !== holdPoint.id, { tap, cell: holdPoint.id, code: holdPoint.code })

      /* 锁画布只锁缩放 / 平移，鼠标点格子改色照常 */
      const editTarget = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const p = S.pattern.value
        S.tool.value = 'paint'
        const other = p.palette.find(c => c.id !== ${JSON.stringify(holdPoint.id)})
        if (!other) return null
        S.brushColorId.value = other.id
        return { id: other.id, idx: ${holdPoint.idx} }
      })()`)
      if (editTarget) {
        await send2('Input.dispatchMouseEvent', { type: 'mouseMoved', x: holdPoint.x, y: holdPoint.y, buttons: 0 })
        await send2('Input.dispatchMouseEvent', { type: 'mousePressed', x: holdPoint.x, y: holdPoint.y, button: 'left', buttons: 1, clickCount: 1 })
        await sleep(60)
        await send2('Input.dispatchMouseEvent', { type: 'mouseReleased', x: holdPoint.x, y: holdPoint.y, button: 'left', buttons: 0, clickCount: 1 })
        await sleep(200)
        const edited = await evalJs(send2, `(async () => {
          const S = await window.__douzao.studio()
          const p = S.pattern.value
          const k = p.cells[${holdPoint.idx}]
          return { id: k >= 0 && p.palette[k] ? p.palette[k].id : null }
        })()`)
        check('平板：锁画布后鼠标点格子仍能改色', edited.id === editTarget.id, { edited, want: editTarget.id })
      } else {
        check('平板：锁画布后鼠标点格子仍能改色', false, '调色板里找不到第二种颜色')
      }

      /* 两指同时点下去 = 撤回。前面的长按测试可能已经把瞄准格擦空，
         所以这里另找一格还有颜色的，擦掉它入历史，再两指点：整张格子回到擦之前。 */
      const painted = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const canvas = document.querySelector('.board.editing canvas')
        const p = S.pattern.value
        const before = Array.from(p.cells)
        const opts = {
          cell: Math.max(3, Math.round(Math.max(0.5, Math.min(20, 640 / Math.max(p.width, p.height))) * S.zoom.value)),
          ruler: !document.querySelector('.canvasCard--console'),
          grid: S.options.showGrid !== false, codes: !!S.options.numbering, bold: true
        }
        const box = canvas.getBoundingClientRect()
        const cx = box.left + box.width / 2
        const cy = box.top + box.height / 2
        let hit = null
        for (let ring = 0; ring < 28 && !hit; ring++) {
          const step = 8 + ring * 6
          const spots = ring === 0 ? [[cx, cy]] : [[cx + step, cy], [cx - step, cy], [cx, cy + step], [cx, cy - step]]
          for (const [x, y] of spots) {
            const h = window.__douzao.render.hitTest(canvas, p, { clientX: x, clientY: y }, opts)
            if (!h) continue
            if (p.cells[h.index] < 0) continue
            hit = h
            break
          }
        }
        if (!hit) return { wrote: false, reason: 'no colored cell' }
        S.tool.value = 'erase'
        const wrote = S.paintAt(hit.x, hit.y)
        const cells = S.pattern.value.cells
        let changed = 0
        for (let i = 0; i < cells.length; i++) if (cells[i] !== before[i]) changed++
        return { wrote, changed, depth: S.undoDepth.value, before }
      })()`)
      const stageBefore = await evalJs(send2, `(() => {
        const s = document.querySelector('.stage'); const b = document.querySelector('.board.editing')
        if (!s || !b) return null
        return { sl: s.scrollLeft, st: s.scrollTop, bx: b.getBoundingClientRect().x, by: b.getBoundingClientRect().y }
      })()`)
      /* 两指必须出现在同一次 touchStart 里。分开两次 start、第二次仍只带一根手指时，
         页面收不到第二根手指，手势不会成立。 */
      /* 两指必须出现在同一次 touchStart 里，而且都落在画布舞台内。
         落在舞台外的那根手指页面收不到，剩下的一根会被当成普通点按。 */
      const finger2 = (px, py, id) => ({ x: px, y: py, id, radiusX: 6, radiusY: 6, force: 1 })
      const stageBox = await evalJs(send2, `(() => {
        const s = document.querySelector('.stage').getBoundingClientRect()
        return { x: s.x, y: s.y, w: s.width, h: s.height }
      })()`)
      const ax = Math.round(stageBox.x + stageBox.w * 0.35)
      const ay = Math.round(stageBox.y + stageBox.h * 0.45)
      const bx = Math.round(stageBox.x + stageBox.w * 0.68)
      const by = Math.round(stageBox.y + stageBox.h * 0.62)
      /* ① 两指轻点：不动、快速抬起 = 撤回 */
      await touchAt('touchStart', [finger2(ax, ay, 1), finger2(bx, by, 2)])
      await sleep(80)
      await touchAt('touchEnd', [])
      await sleep(200)
      const tapped = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const cells = Array.from(S.pattern.value.cells)
        const before = ${JSON.stringify(painted.before || [])}
        let differ = 0
        const n = Math.max(cells.length, before.length)
        for (let i = 0; i < n; i++) if (cells[i] !== before[i]) differ++
        return { differ, depth: S.undoDepth.value, zoom: S.zoom.value }
      })()`)
      check('平板：两指轻点撤回上一步',
        painted.wrote === true && painted.changed > 0 && tapped.differ === 0 && tapped.depth === painted.depth - 1,
        { wrote: painted.wrote, changed: painted.changed, depth: [painted.depth, tapped.depth], differ: tapped.differ })

      /* ② 两指捏合：距离拉大 = 放大画布，不能顺手撤回或改格子 */
      const pinchBefore = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const b = document.querySelector('.board.editing').getBoundingClientRect()
        return { zoom: S.zoom.value, depth: S.undoDepth.value, cells: Array.from(S.pattern.value.cells),
          board: { x: b.x, y: b.y, w: b.width, h: b.height } }
      })()`)
      await touchAt('touchStart', [finger2(ax, ay, 1), finger2(bx, by, 2)])
      await sleep(60)
      await touchAt('touchMove', [finger2(ax - 30, ay - 16, 1), finger2(bx + 30, by + 16, 2)])
      await sleep(60)
      await touchAt('touchMove', [finger2(ax - 55, ay - 30, 1), finger2(bx + 55, by + 30, 2)])
      await sleep(200)
      const pinched = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const cells = Array.from(S.pattern.value.cells)
        const before = ${JSON.stringify(pinchBefore.cells)}
        let differ = 0
        const n = Math.max(cells.length, before.length)
        for (let i = 0; i < n; i++) if (cells[i] !== before[i]) differ++
        const b = document.querySelector('.board.editing').getBoundingClientRect()
        return { zoom: S.zoom.value, depth: S.undoDepth.value, differ,
          board: { x: b.x, y: b.y, w: b.width, h: b.height } }
      })()`)
      /* 捏合锚点：手指中点下的那一格，缩放前后应该还在同一个屏幕位置 */
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      const fx = (mx - pinchBefore.board.x) / pinchBefore.board.w
      const fy = (my - pinchBefore.board.y) / pinchBefore.board.h
      const drift = [
        Math.round(pinched.board.x + fx * pinched.board.w - mx),
        Math.round(pinched.board.y + fy * pinched.board.h - my)
      ]
      await touchAt('touchEnd', [])
      await sleep(150)
      check('平板：两指捏合放大画布，且不触发撤回',
        pinched.zoom > pinchBefore.zoom * 1.1 && pinched.depth === pinchBefore.depth && pinched.differ === 0,
        { zoom: [pinchBefore.zoom, pinched.zoom], depth: [pinchBefore.depth, pinched.depth], differ: pinched.differ, drift })

      /* ③ 两指一起拖 = 平移画布：缩放不变、不撤回、不改格子。
         往还有滚动余量的方向拖，避免被边界夹住看不出位移。 */
      const panBefore = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const s = document.querySelector('.stage')
        return { zoom: S.zoom.value, depth: S.undoDepth.value, sl: s.scrollLeft, st: s.scrollTop,
          roomX: s.scrollWidth - s.clientWidth - s.scrollLeft, roomY: s.scrollHeight - s.clientHeight - s.scrollTop,
          cells: Array.from(S.pattern.value.cells) }
      })()`)
      const panDx = panBefore.roomX >= 30 ? -30 : 30
      const panDy = panBefore.roomY >= 24 ? -24 : 24
      await touchAt('touchStart', [finger2(ax, ay, 1), finger2(bx, by, 2)])
      await sleep(60)
      await touchAt('touchMove', [finger2(ax + panDx / 2, ay + panDy / 2, 1), finger2(bx + panDx / 2, by + panDy / 2, 2)])
      await sleep(60)
      await touchAt('touchMove', [finger2(ax + panDx, ay + panDy, 1), finger2(bx + panDx, by + panDy, 2)])
      await sleep(200)
      const panAfter = await evalJs(send2, `(async () => {
        const S = await window.__douzao.studio()
        const s = document.querySelector('.stage')
        const cells = Array.from(S.pattern.value.cells)
        const before = ${JSON.stringify(panBefore.cells)}
        let differ = 0
        const n = Math.max(cells.length, before.length)
        for (let i = 0; i < n; i++) if (cells[i] !== before[i]) differ++
        return { zoom: S.zoom.value, depth: S.undoDepth.value, sl: s.scrollLeft, st: s.scrollTop, differ }
      })()`)
      await touchAt('touchEnd', [])
      await sleep(150)
      const panMoved = Math.abs(panAfter.sl - panBefore.sl) >= 20 && Math.abs(panAfter.st - panBefore.st) >= 14
      check('平板：两指拖动平移画布，不缩放也不撤回',
        panMoved && Math.abs(panAfter.zoom - panBefore.zoom) < 0.01 &&
        panAfter.depth === panBefore.depth && panAfter.differ === 0,
        { scroll: [[panBefore.sl, panBefore.st], [panAfter.sl, panAfter.st]], want: [panDx, panDy], zoom: [panBefore.zoom, panAfter.zoom], depth: [panBefore.depth, panAfter.depth], differ: panAfter.differ })
    }
    await browser.send('Target.closeTarget', { targetId: tid2 }).catch(() => {})
  }

  /* ---------------- 9. 手机（390×844）：同样没有快捷键，长按吸色 ---------------- */
  {
    const { targetId: tid3, send: send3 } = await newPage()
    await send3('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send3('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send3('Page.navigate', { url: `${origin}/` })
    await waitBridge(send3)
    await evalJs(send3, `sessionStorage.setItem('douwan-upgrade-notice','1'); localStorage.setItem('douwan.guide.v1','1'); 1`)
    await send3('Page.navigate', { url: `${origin}/editor/${fixtureId}` })
    await waitBridge(send3); await sleep(1600)
    const phone = await evalJs(send3, `(async () => {
      const S = await window.__douzao.studio()
      const keys = [...document.querySelectorAll('[data-tip-key]')].map(b => (b.getAttribute('data-tip-key') || '').trim()).filter(Boolean)
      const before = S.tool.value
      return { before, keys, mobile: !!document.querySelector('.msTools'), w: innerWidth }
    })()`)
    await pressKey(send3, 'e', 'KeyE', 69)
    const phoneAfter = await evalJs(send3, `window.__douzao.studio().then(S => S.tool.value)`)
    check('手机：界面上不标快捷键', phone.keys.length === 0 && phone.mobile && phone.w <= 780, phone)
    check('手机：按 E 不切工具', phone.before === phoneAfter, { before: phone.before, after: phoneAfter })

    const phonePoint = await evalJs(send3, `(async () => {
      const S = await window.__douzao.studio()
      S.tool.value = 'fill'
      S.brushColorId.value = ''
      const canvas = document.querySelector('.board.editing canvas')
      if (!canvas) return null
      canvas.scrollIntoView({ block: 'center' })
      await new Promise(r => setTimeout(r, 200))
      const p = S.pattern.value
      const box = canvas.getBoundingClientRect()
      const hitAt = (x, y) => window.__douzao.render.hitTest(canvas, p, { clientX: x, clientY: y }, {
        cell: Math.max(3, Math.round(Math.max(0.5, Math.min(20, 640 / Math.max(p.width, p.height))) * S.zoom.value)),
        ruler: !document.querySelector('.canvasCard--console'),
        grid: S.options.showGrid !== false, codes: !!S.options.numbering, bold: true
      })
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      for (let ring = 0; ring < 24; ring++) {
        const step = 6 + ring * 4
        const spots = ring === 0 ? [[cx, cy]] : [[cx + step, cy], [cx - step, cy], [cx, cy + step], [cx, cy - step]]
        for (const [x, y] of spots) {
          const hit = hitAt(x, y)
          if (!hit) continue
          const k = p.cells[hit.index]
          if (k < 0 || !p.palette[k]) continue
          return { x: Math.round(x), y: Math.round(y), id: p.palette[k].id, inView: true }
        }
      }
      return null
    })()`)
    await sleep(300)
    if (!phonePoint) {
      check('手机：长按吸到这一格的颜色并切回画笔', false, '找不到格子')
    } else {
      const finger = (px, py) => [{ x: px, y: py, id: 1, radiusX: 6, radiusY: 6, force: 1 }]
      await send3('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(phonePoint.x, phonePoint.y) })
      await sleep(620)
      const got = await evalJs(send3, `window.__douzao.studio().then(S => ({ tool: S.tool.value, brush: S.brushColorId.value }))`)
      await send3('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      check('手机：长按吸到这一格的颜色并切回画笔', got.tool === 'paint' && got.brush === phonePoint.id, { got, want: phonePoint.id })
    }
    const helpKeys = await evalJs(send3, `(async () => {
      const app = document.querySelector('#app').__vue_app__
      const router = app.config.globalProperties.$router
      await router.push('/help')
      await new Promise(r => setTimeout(r, 300))
      const head = document.querySelector('.shortcutHead')
      const grid = document.querySelector('.shortcutGrid')
      const shown = (el) => !!el && getComputedStyle(el).display !== 'none'
      return { head: shown(head), grid: shown(grid), path: location.pathname, w: innerWidth }
    })()`)
    check('手机：帮助页不展示快捷键表', helpKeys.head === false && helpKeys.grid === false && helpKeys.w <= 780, helpKeys)
    await browser.send('Target.closeTarget', { targetId: tid3 }).catch(() => {})
  }

  /* ---------------- 10. 平板横屏（1194×834，宽度超过 1100）：手指长按仍然吸色 ---------------- */
  {
    const { targetId: tid4, send: send4 } = await newPage()
    await send4('Emulation.setDeviceMetricsOverride', { width: 1194, height: 834, deviceScaleFactor: 2, mobile: true })
    await send4('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send4('Page.navigate', { url: `${origin}/` })
    await waitBridge(send4)
    await evalJs(send4, `sessionStorage.setItem('douwan-upgrade-notice','1'); localStorage.setItem('douwan.guide.v1','1'); 1`)
    await send4('Page.navigate', { url: `${origin}/editor/${fixtureId}` })
    await waitBridge(send4); await sleep(1600)
    /* 横屏 iPad 走全屏工作台：手指设备同样锁画布 —— 状态栏没有缩放 / 适应按钮，
       左侧工具栏里没有「移动」，滚轮也改不了缩放。 */
    const wideLock = await evalJs(send4, `(async () => {
      const S = await window.__douzao.studio()
      const stage = document.querySelector('.stage')
      const before = S.zoom.value
      if (stage) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 400))
      const visible = els => els.filter(b => getComputedStyle(b).display !== 'none')
      const zoomBtns = visible([...document.querySelectorAll('.csStatus .zoomBar .csStatus__btn')])
      const fitBtns = visible([...document.querySelectorAll('.csStatus__btn')].filter(b => (b.textContent || '').includes('适应')))
      document.querySelector('[data-rail-toggle]')?.click()
      await new Promise(r => setTimeout(r, 200))
      const railLabels = [...document.querySelectorAll('.csTools .tool')].map(b => (b.textContent || '').trim())
      document.querySelector('[data-rail-collapse]')?.click()
      await new Promise(r => setTimeout(r, 150))
      return {
        locked: !!stage && stage.classList.contains('stage--locked'),
        overflow: stage ? getComputedStyle(stage).overflow : null,
        zoomBefore: before, zoomAfter: S.zoom.value,
        zoomBtns: zoomBtns.length, fitBtns: fitBtns.length,
        hasPan: railLabels.includes('移动'), railLabels
      }
    })()`)
    check('横屏平板：画布同样锁定（无缩放 / 适应按钮，滚轮与工具栏都改不了）',
      wideLock.locked && wideLock.overflow === 'hidden' && wideLock.zoomAfter === wideLock.zoomBefore &&
      wideLock.zoomBtns === 0 && wideLock.fitBtns === 0 && wideLock.hasPan === false, wideLock)
    const widePoint = await evalJs(send4, `(async () => {
      const S = await window.__douzao.studio()
      S.tool.value = 'paint'
      S.brushColorId.value = ''
      const canvas = document.querySelector('.board.editing canvas')
      if (!canvas) return { err: 'no canvas', w: innerWidth }
      const p = S.pattern.value
      const box = canvas.getBoundingClientRect()
      const hitAt = (x, y) => window.__douzao.render.hitTest(canvas, p, { clientX: x, clientY: y }, {
        cell: Math.max(3, Math.round(Math.max(0.5, Math.min(20, 640 / Math.max(p.width, p.height))) * S.zoom.value)),
        ruler: !document.querySelector('.canvasCard--console'),
        grid: S.options.showGrid !== false, codes: !!S.options.numbering, bold: true
      })
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      for (let ring = 0; ring < 24; ring++) {
        const step = 6 + ring * 4
        const spots = ring === 0 ? [[cx, cy]] : [[cx + step, cy], [cx - step, cy], [cx, cy + step], [cx, cy - step]]
        for (const [x, y] of spots) {
          const hit = hitAt(x, y)
          if (!hit) continue
          const k = p.cells[hit.index]
          if (k < 0 || !p.palette[k]) continue
          return { x: Math.round(x), y: Math.round(y), id: p.palette[k].id, w: innerWidth }
        }
      }
      return { err: 'no cell', w: innerWidth }
    })()`)
    if (!widePoint || !widePoint.id) {
      check('横屏平板：长按仍能吸色', false, widePoint)
    } else {
      const finger = (px, py) => [{ x: px, y: py, id: 1, radiusX: 6, radiusY: 6, force: 1 }]
      await send4('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(widePoint.x, widePoint.y) })
      await sleep(560)
      const got = await evalJs(send4, `window.__douzao.studio().then(S => ({ tool: S.tool.value, brush: S.brushColorId.value }))`)
      await send4('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      check('横屏平板：长按仍能吸色', got.tool === 'paint' && got.brush === widePoint.id && widePoint.w >= 1100, { got, want: widePoint.id, w: widePoint.w })

      /* 横屏宽度 ≥1100 时页面是电脑端工具轨。手指设备上键帽必须消失，
         两指点下去必须撤回，不能把画布拖走。 */
      const wideKeys = await evalJs(send4, `(() => {
        const keys = [...document.querySelectorAll('[data-tip-key]')].map(b => (b.getAttribute('data-tip-key') || '').trim()).filter(Boolean)
        const note = document.querySelector('.hintTouch')
        const wheel = document.querySelector('.hintWheel')
        const shown = (el) => !!el && getComputedStyle(el).display !== 'none'
        return { keys, touch: shown(note), wheel: shown(wheel), coarse: matchMedia('(pointer: coarse)').matches }
      })()`)
      check('横屏平板：工具上不标快捷键', wideKeys.keys.length === 0, wideKeys)
      check('横屏平板：画布提示是两指撤回', wideKeys.touch === true && wideKeys.wheel === false, wideKeys)
      const wideGuide = await evalJs(send4, `(async () => {
        const toggle = document.querySelector('[data-rail-toggle]')
        if (toggle) { toggle.click(); await new Promise(r => setTimeout(r, 80)) }
        const byText = (word) => [...document.querySelectorAll('.csTools .tool')].find(b => (b.textContent || '').replace(/\\s+/g, '').includes(word))
        const gesture = document.querySelector('.csStatus__gesture')
        const pick = byText('吸色')
        const undo = byText('撤销')
        const shown = el => !!el && getComputedStyle(el).display !== 'none'
        return {
          gesture: shown(gesture) ? (gesture.textContent || '') : '',
          pick: pick ? (pick.getAttribute('data-tip-desc') || '') : '',
          undo: undo ? (undo.getAttribute('data-tip-desc') || '') : '',
          pickKey: pick ? (pick.getAttribute('data-tip-key') || '') : 'missing'
        }
      })()`)
      check('横屏平板：指引写长按吸色和两指撤回',
        /长按一格吸色/.test(wideGuide.gesture) && /两指同时点一下撤回/.test(wideGuide.gesture) &&
        /长按一格/.test(wideGuide.pick || '') && /两根手指/.test(wideGuide.undo || '') &&
        !(wideGuide.pickKey || '').trim(), wideGuide)
      const widePainted = await evalJs(send4, `(async () => {
        const S = await window.__douzao.studio()
        const canvas = document.querySelector('.board.editing canvas')
        const p = S.pattern.value
        const before = Array.from(p.cells)
        const opts = {
          cell: Math.max(3, Math.round(Math.max(0.5, Math.min(20, 640 / Math.max(p.width, p.height))) * S.zoom.value)),
          ruler: !document.querySelector('.canvasCard--console'),
          grid: S.options.showGrid !== false, codes: !!S.options.numbering, bold: true
        }
        const box = canvas.getBoundingClientRect()
        let hit = null
        const cx = box.left + box.width / 2
        const cy = box.top + box.height / 2
        for (let ring = 0; ring < 28 && !hit; ring++) {
          const step = 8 + ring * 6
          const spots = ring === 0 ? [[cx, cy]] : [[cx + step, cy], [cx - step, cy], [cx, cy + step], [cx, cy - step]]
          for (const [x, y] of spots) {
            const h = window.__douzao.render.hitTest(canvas, p, { clientX: x, clientY: y }, opts)
            if (!h || p.cells[h.index] < 0) continue
            hit = h
            break
          }
        }
        if (!hit) return { wrote: false }
        S.tool.value = 'erase'
        const wrote = S.paintAt(hit.x, hit.y)
        const cells = S.pattern.value.cells
        let changed = 0
        for (let i = 0; i < cells.length; i++) if (cells[i] !== before[i]) changed++
        return { wrote, changed, depth: S.undoDepth.value, before }
      })()`)
      /* 长按的 toast 约 1.6s 后消失，布局一变自动适配会再算一次缩放。
         等它收完再记基线，否则量到的 0.95 只是过渡值。 */
      await sleep(1800)
      const wideStage = await evalJs(send4, `(() => {
        const s = document.querySelector('.stage')
        const r = s.getBoundingClientRect()
        const b = document.querySelector('.board.editing').getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height, bx: b.x, by: b.y, sl: s.scrollLeft, st: s.scrollTop, z: 0 }
      })()`)
      const f2 = (px, py, id) => ({ x: px, y: py, id, radiusX: 6, radiusY: 6, force: 1 })
      const p1x = Math.round(wideStage.x + wideStage.w * 0.35)
      const p1y = Math.round(wideStage.y + wideStage.h * 0.45)
      const p2x = Math.round(wideStage.x + wideStage.w * 0.68)
      const p2y = Math.round(wideStage.y + wideStage.h * 0.62)
      /* ① 两指轻点 = 撤回 */
      await send4('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [f2(p1x, p1y, 1), f2(p2x, p2y, 2)] })
      await sleep(80)
      await send4('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await sleep(200)
      const wideTapped = await evalJs(send4, `(async () => {
        const S = await window.__douzao.studio()
        const cells = Array.from(S.pattern.value.cells)
        const before = ${JSON.stringify(widePainted.before || [])}
        let differ = 0
        const n = Math.max(cells.length, before.length)
        for (let i = 0; i < n; i++) if (cells[i] !== before[i]) differ++
        return { differ, depth: S.undoDepth.value, zoom: S.zoom.value }
      })()`)
      check('横屏平板：两指轻点撤回上一步',
        widePainted.wrote === true && widePainted.changed > 0 && wideTapped.differ === 0 && wideTapped.depth === widePainted.depth - 1,
        { wrote: widePainted.wrote, changed: widePainted.changed, depth: [widePainted.depth, wideTapped.depth], differ: wideTapped.differ })

      /* ② 两指捏合 = 放大画布，不能顺手撤回或改格子 */
      const widePinchBefore = await evalJs(send4, `(async () => {
        const S = await window.__douzao.studio()
        const b = document.querySelector('.board.editing').getBoundingClientRect()
        return { zoom: S.zoom.value, depth: S.undoDepth.value, cells: Array.from(S.pattern.value.cells),
          board: { x: b.x, y: b.y, w: b.width, h: b.height } }
      })()`)
      await send4('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [f2(p1x, p1y, 1), f2(p2x, p2y, 2)] })
      await sleep(60)
      await send4('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [f2(p1x - 30, p1y - 16, 1), f2(p2x + 30, p2y + 16, 2)] })
      await sleep(60)
      await send4('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [f2(p1x - 55, p1y - 30, 1), f2(p2x + 55, p2y + 30, 2)] })
      await sleep(250)
      const widePinched = await evalJs(send4, `(async () => {
        const S = await window.__douzao.studio()
        const cells = Array.from(S.pattern.value.cells)
        const before = ${JSON.stringify(widePinchBefore.cells)}
        let differ = 0
        const n = Math.max(cells.length, before.length)
        for (let i = 0; i < n; i++) if (cells[i] !== before[i]) differ++
        const b = document.querySelector('.board.editing').getBoundingClientRect()
        return { zoom: S.zoom.value, depth: S.undoDepth.value, differ,
          board: { x: b.x, y: b.y, w: b.width, h: b.height } }
      })()`)
      const wideMx = (p1x + p2x) / 2
      const wideMy = (p1y + p2y) / 2
      const wideFx = (wideMx - widePinchBefore.board.x) / widePinchBefore.board.w
      const wideFy = (wideMy - widePinchBefore.board.y) / widePinchBefore.board.h
      const wideDrift = [
        Math.round(widePinched.board.x + wideFx * widePinched.board.w - wideMx),
        Math.round(widePinched.board.y + wideFy * widePinched.board.h - wideMy)
      ]
      await send4('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await sleep(150)
      const wideCss = await evalJs(send4, `(() => {
        const s = document.querySelector('.stage')
        const cs = getComputedStyle(s)
        return { overflow: cs.overflow, touchAction: cs.touchAction, coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches, hover: matchMedia('(hover: hover)').matches }
      })()`)
      check('横屏平板：两指捏合放大画布，且不触发撤回',
        widePinched.zoom > widePinchBefore.zoom * 1.1 && widePinched.depth === widePinchBefore.depth && widePinched.differ === 0,
        { zoom: [widePinchBefore.zoom, widePinched.zoom], depth: [widePinchBefore.depth, widePinched.depth], differ: widePinched.differ, drift: wideDrift, css: wideCss })

      /* ③ 两指一起拖 = 平移画布：缩放不变、不撤回、不改格子 */
      const widePanBefore = await evalJs(send4, `(async () => {
        const S = await window.__douzao.studio()
        const s = document.querySelector('.stage')
        return { zoom: S.zoom.value, depth: S.undoDepth.value, sl: s.scrollLeft, st: s.scrollTop,
          roomX: s.scrollWidth - s.clientWidth - s.scrollLeft, roomY: s.scrollHeight - s.clientHeight - s.scrollTop,
          cells: Array.from(S.pattern.value.cells) }
      })()`)
      const widePanDx = widePanBefore.roomX >= 30 ? -30 : 30
      const widePanDy = widePanBefore.roomY >= 24 ? -24 : 24
      await send4('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [f2(p1x, p1y, 1), f2(p2x, p2y, 2)] })
      await sleep(60)
      await send4('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [f2(p1x + widePanDx / 2, p1y + widePanDy / 2, 1), f2(p2x + widePanDx / 2, p2y + widePanDy / 2, 2)] })
      await sleep(60)
      await send4('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [f2(p1x + widePanDx, p1y + widePanDy, 1), f2(p2x + widePanDx, p2y + widePanDy, 2)] })
      await sleep(200)
      const widePanAfter = await evalJs(send4, `(async () => {
        const S = await window.__douzao.studio()
        const s = document.querySelector('.stage')
        const cells = Array.from(S.pattern.value.cells)
        const before = ${JSON.stringify(widePanBefore.cells)}
        let differ = 0
        const n = Math.max(cells.length, before.length)
        for (let i = 0; i < n; i++) if (cells[i] !== before[i]) differ++
        return { zoom: S.zoom.value, depth: S.undoDepth.value, sl: s.scrollLeft, st: s.scrollTop, differ }
      })()`)
      await send4('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await sleep(150)
      const widePanMoved = Math.abs(widePanAfter.sl - widePanBefore.sl) >= 20 && Math.abs(widePanAfter.st - widePanBefore.st) >= 14
      check('横屏平板：两指拖动平移画布，不缩放也不撤回',
        widePanMoved && Math.abs(widePanAfter.zoom - widePanBefore.zoom) < 0.01 &&
        widePanAfter.depth === widePanBefore.depth && widePanAfter.differ === 0,
        { scroll: [[widePanBefore.sl, widePanBefore.st], [widePanAfter.sl, widePanAfter.st]], want: [widePanDx, widePanDy], zoom: [widePanBefore.zoom, widePanAfter.zoom], depth: [widePanBefore.depth, widePanAfter.depth], differ: widePanAfter.differ })
    }
    await browser.send('Target.closeTarget', { targetId: tid4 }).catch(() => {})
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  const bad = report.filter(r => !r.ok)
  console.log(`\n合计 ${report.length} 项，通过 ${report.length - bad.length}，失败 ${bad.length}`)
  if (bad.length) console.log('失败项：\n' + bad.map(b => ' · ' + b.name + ' ' + JSON.stringify(b.extra || '')).join('\n'))

  await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  browser.close(); chrome.kill()
  if (server) server.close()
  process.exit(bad.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
