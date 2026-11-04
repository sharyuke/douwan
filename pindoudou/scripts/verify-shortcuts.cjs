/* =========================================================================
   电脑端工作台：键盘快捷键 + 中键拖动画布 + 悬停浮动标签 自检
   用法：node scripts/verify-shortcuts.cjs [--url http://127.0.0.1:4180]

   断言的都是**真实输入**（CDP 的 Input 域），不是脚本里改状态：
     · 中键按住拖动 → 画布真的跟着走（图纸在屏幕上的位置变了），
       而且没有顺手在图上落一笔（格子逐格不变）；
     · P / E / G / I / C 切工具、R 去除杂色、M 左右镜像（逐格比对翻转结果）；
     · 输入框里打字不切工具；Ctrl+Z 仍然是撤销（快捷键不抢浏览器的键）；
     · 鼠标停在工具上 → 浮出标签，标签里有工具名与快捷键标注，移开就消失。
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

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p))

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
    ['p', 'KeyP', 80, 'paint'],
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
  await pressKey(send, 'p', 'KeyP', 80)
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
    ['画笔', 'P'], ['橡皮', 'E'], ['填充', 'G'], ['吸色', 'I'],
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
    if (label === '画笔') {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, 'tip-brush.png'), Buffer.from(shot.data, 'base64'))
    }
  }
  /* 移开鼠标 → 标签消失 */
  await hoverAt(send, Math.round(stageBox.sx + stageBox.sw / 2), Math.round(stageBox.sy + stageBox.sh / 2))
  const tipGone = await evalJs(send, `!document.querySelector('[data-shortcut-tip]')`)
  check('鼠标移开后标签消失', tipGone === true, tipGone)

  /* ---------------- 7. 控制台报错 ---------------- */
  check('控制台没有报错', errors.length === 0, errors)

  /* ---------------- 8. 旧版面（781~1099px）：工具行同样有浮动标签与中键拖动 ---------------- */
  {
    const { targetId: tid2, send: send2 } = await newPage()
    await send2('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false })
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
    check('旧版面：画布下方的工具行在（781~1099px）', legacy.panel && legacy.btn && !legacy.modal, legacy)
    if (legacy.btn && legacy.inView && !legacy.modal) {
      await hoverAt(send2, legacy.x, legacy.y)
      const tip = await evalJs(send2, `(() => {
        const t = document.querySelector('[data-shortcut-tip]')
        if (!t) return null
        return { text: (t.textContent || '').replace(/\\s+/g, ' ').trim(), key: (t.querySelector('.stip__key') || {}).textContent }
      })()`)
      check('旧版面：悬停工具也浮出快捷键标签', !!tip && (tip.key || '').trim() === 'P' && tip.text.includes('画笔'), tip)
      await hoverAt(send2, 5, 5)
      const gone = await evalJs(send2, `!document.querySelector('[data-shortcut-tip]')`)
      check('旧版面：鼠标移开标签消失', gone === true, gone)

      /* 旧版面里画布常常正好装得下（autoFit），本来就没有可平移的范围 ——
         先放大两档让画布超出舞台，再拖。 */
      const zoomIn = await evalJs(send2, `(() => {
        const b = [...document.querySelectorAll('.stageTools__btn')].find(x => (x.getAttribute('title') || '') === '放大')
        if (!b) return false
        b.click(); b.click(); return true
      })()`)
      if (zoomIn) await sleep(800)

      const before = await evalJs(send2, `(() => {
        const s = document.querySelector('.stage'); const b = document.querySelector('.board.editing')
        if (!s || !b) return null
        const sr = s.getBoundingClientRect(); const br = b.getBoundingClientRect()
        return {
          sl: s.scrollLeft, bx: br.x, sx: sr.x, sy: sr.y, sw: sr.width, sh: sr.height,
          scrollW: s.scrollWidth, clientW: s.clientWidth, scrollH: s.scrollHeight, clientH: s.clientHeight
        }
      })()`)
      const scrollable = !!before && (before.scrollW > before.clientW + 2 || before.scrollH > before.clientH + 2)
      if (before && scrollable) {
        /* 旧版面的舞台是 grid 居中：内容溢出时只有「起点方向」那侧滑不到
           （scrollLeft 停在 0 就没法再往左滚）。所以往能滚的那一侧拖。
           可滚的距离也有限（scrollWidth - clientWidth），只按能滚的那段算。 */
        const dir = before.sl <= 0 ? -120 : 120
        const room = Math.max(0, before.scrollW - before.clientW)
        const expect = Math.min(Math.abs(dir), room)
        await middleDrag(send2, Math.round(before.sx + before.sw / 2), Math.round(before.sy + before.sh / 2), dir, 0)
        const after = await evalJs(send2, `(() => { const s = document.querySelector('.stage'); const b = document.querySelector('.board.editing'); return { sl: s.scrollLeft, bx: b.getBoundingClientRect().x } })()`)
        check('旧版面：中键拖动也能平移画布', Math.abs(Math.abs(after.bx - before.bx) - expect) < 12, { dx: after.bx - before.bx, dir, expect, sl: [before.sl, after.sl], room })
      } else {
        check('旧版面：中键拖动也能平移画布', false, { reason: '画布装得下，没有可平移的范围', before })
      }
    }
    await browser.send('Target.closeTarget', { targetId: tid2 }).catch(() => {})
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
