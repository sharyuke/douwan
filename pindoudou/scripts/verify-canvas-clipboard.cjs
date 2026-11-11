/* =========================================================================
   操作台画布：Ctrl+V 贴图片，Ctrl+C / Ctrl+V 把图纸带到另一个操作台
   用法：node scripts/verify-canvas-clipboard.cjs

   走真按键（CDP Input）和系统剪贴板，两个标签页：
     · 空操作台 Ctrl+V 一张剪贴板图片 → 生成图纸；
     · 输入框里 Ctrl+C 不把图纸抄走；
     · 改一格之后 Ctrl+C，另一个操作台 Ctrl+V → 格子、手改标记、尺寸与原来一致；
     · 已有图纸时再贴一张图 → 先问要不要保存，点取消后换成新图。
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, '.tmp', 'verify-clipboard')
fs.mkdirSync(OUT, { recursive: true })
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon'
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

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
    server.listen(0, '127.0.0.1', () => resolve(server))
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
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message + '（' + method + '）'))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' 超时')) }
      }, 30000)
    })
  }
  close() { try { this.ws.close() } catch { /* 已经关了 */ } }
}

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find(p => p && fs.existsSync(p))

async function main() {
  if (!CHROME) throw new Error('找不到 Chrome')
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('先 pnpm build，dist 还没有')
  const server = await staticServer()
  const origin = `http://127.0.0.1:${server.address().port}`
  const port = 9800 + (process.pid % 150)
  const profile = fs.mkdtempSync(path.join(ROOT, '.tmp', 'probe-chrome-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let version = null
  for (let i = 0; i < 80; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch { await sleep(250) }
  }
  if (!version) { chrome.kill(); server.close(); throw new Error('Chrome 未就绪') }
  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready
  try {
    await browser.send('Browser.grantPermissions', {
      origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    })
  } catch (err) {
    console.log('grantPermissions:', err.message)
  }

  const newPage = async () => {
    const t = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
    const send = (m, p) => browser.send(m, p, sessionId)
    await send('Page.enable')
    await send('Runtime.enable')
    return { targetId: t.targetId, send }
  }
  const evalJs = async (send, expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''))
    }
    return r.result && r.result.value
  }
  const waitBridge = async send => {
    const ok = await evalJs(send, `new Promise(res => { const t0 = Date.now(); const tick = () => (window.__douzao ? res(true) : (Date.now() - t0 > 15000 ? res(false) : setTimeout(tick, 100))); tick() })`)
    if (!ok) throw new Error('调试桥未就绪')
  }
  const press = async (send, key, code, vk, mod) => {
    const base = { key, code, windowsVirtualKeyCode: vk, modifiers: mod || 0 }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 ? key : undefined })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(180)
  }
  const focusStudio = send => evalJs(send, `(() => {
    const sel = window.getSelection(); if (sel) sel.removeAllRanges()
    const el = document.querySelector('.studio') || document.body
    el.tabIndex = -1
    el.focus()
    return document.activeElement === el
  })()`)
  const openEditor = async send => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `${origin}/` })
    await waitBridge(send)
    await evalJs(send, `(() => {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith('douzao-') || k.startsWith('douwan'))) keys.push(k) }
      keys.forEach(k => localStorage.removeItem(k))
      sessionStorage.clear()
      sessionStorage.setItem('douwan-upgrade-notice', '1')
      localStorage.setItem('douwan.guide.v1', '1')
      return keys.length
    })()`)
    await send('Page.navigate', { url: `${origin}/editor` })
    await waitBridge(send)
    await sleep(600)
    await evalJs(send, `(() => {
      document.addEventListener('paste', e => {
        const dt = e.clipboardData
        window.__pasteLog = {
          types: dt ? Array.from(dt.types || []) : null,
          plain: dt ? (dt.getData('text/plain') || '').slice(0, 80) : '',
          html: dt ? (dt.getData('text/html') || '').slice(0, 120) : '',
          files: dt && dt.files ? dt.files.length : 0,
          custom: dt ? (dt.getData('application/x-douwan-canvas') || '').length : 0
        }
      }, true)
      return 1
    })()`)
  }

  const report = []
  const check = (name, ok, extra) => {
    report.push({ name, ok: !!ok, extra })
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''))
  }

  const pageA = await newPage()
  await openEditor(pageA.send)
  const hint = await evalJs(pageA.send, `(() => {
    const card = document.querySelector('.upCard__hint')
    const flow = document.querySelector('.flowBar__text')
    return { card: card ? card.textContent.trim() : '', flow: flow ? flow.textContent.trim() : '' }
  })()`)
  check('空画布写了可以 Ctrl+V', !!(hint && /Ctrl\+V/.test((hint.card || '') + (hint.flow || ''))), hint)

  const wrote = await evalJs(pageA.send, `(async () => {
    const c = document.createElement('canvas')
    c.width = 48; c.height = 48
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#e23d3d'
    ctx.fillRect(0, 0, 48, 48)
    ctx.fillStyle = '#2f6fed'
    ctx.fillRect(6, 6, 20, 20)
    const blob = await new Promise(r => c.toBlob(r, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return blob.size
  })()`)
  check('剪贴板写入了一张 PNG', wrote > 0, wrote)

  await focusStudio(pageA.send)
  await press(pageA.send, 'v', 'KeyV', 86, 2)
  let loaded = null
  for (let i = 0; i < 40; i++) {
    loaded = await evalJs(pageA.send, `(async () => {
      const S = await window.__douzao.studio()
      const p = S.pattern.value
      return {
        name: S.sourceName.value,
        project: S.projectName.value,
        sig: p ? S.patternSignature(p) : '',
        w: p ? p.width : 0,
        h: p ? p.height : 0,
        manual: S.manualEdited.value,
        paste: window.__pasteLog || null,
        toast: [...document.querySelectorAll('.toast')].map(t => (t.textContent || '').trim()).join(' | ')
      }
    })()`)
    if (loaded && loaded.sig) break
    await sleep(400)
  }
  check('Ctrl+V 把剪贴板图片贴成图纸', !!(loaded && loaded.sig), loaded)

  const snap = await evalJs(pageA.send, `(async () => {
    const S = await window.__douzao.studio()
    const p = S.pattern.value
    const at = 0
    const cur = p.cells[at]
    const curId = cur >= 0 && p.palette[cur] ? p.palette[cur].id : ''
    const other = p.palette.find(c => c.id !== curId)
    if (!other) return null
    S.tool.value = 'paint'
    S.brushColorId.value = other.id
    const painted = S.paintAt(0, 0)
    const next = S.pattern.value
    const k = next.cells[0]
    return {
      painted,
      sig: S.patternSignature(next),
      code: k >= 0 && next.palette[k] ? next.palette[k].code : '',
      manual: S.manualEdited.value,
      w: next.width,
      h: next.height,
      brand: S.options.brandId,
      board: S.boardLocked.value
    }
  })()`)
  check('改了一格，指纹变了', !!(snap && snap.painted && snap.sig && snap.sig !== loaded.sig), snap)

  await evalJs(pageA.send, `(() => {
    const i = document.createElement('input')
    i.id = '__probeInput'
    i.value = '只复制这段字'
    document.body.appendChild(i)
    i.focus()
    i.select()
    return 1
  })()`)
  await press(pageA.send, 'c', 'KeyC', 67, 2)
  const inputCopy = await evalJs(pageA.send, `(async () => {
    const text = await navigator.clipboard.readText()
    const i = document.getElementById('__probeInput')
    if (i) i.remove()
    const toasts = [...document.querySelectorAll('.toast')].map(t => (t.textContent || '').trim())
    return { text, toasts }
  })()`)
  check('输入框里的 Ctrl+C 复制的是文字', inputCopy && inputCopy.text === '只复制这段字' && !(inputCopy.toasts || []).some(t => t.includes('已复制图纸')), inputCopy)

  await focusStudio(pageA.send)
  await evalJs(pageA.send, `document.querySelectorAll('.toast').forEach(t => t.remove())`)
  await press(pageA.send, 'c', 'KeyC', 67, 2)
  await sleep(300)
  const copied = await evalJs(pageA.send, `(async () => {
    let text = ''
    let readErr = ''
    try { text = await navigator.clipboard.readText() } catch (e) { readErr = e.message }
    const toasts = [...document.querySelectorAll('.toast')].map(t => (t.textContent || '').trim())
    return { text: (text || '').slice(0, 80), readErr, toasts }
  })()`)
  check('Ctrl+C 复制了当前图纸', !!(copied && (copied.toasts || []).some(t => t.includes('已复制图纸'))), copied)

  const pageB = await newPage()
  await openEditor(pageB.send)
  await focusStudio(pageB.send)
  await press(pageB.send, 'v', 'KeyV', 86, 2)
  let pasted = null
  for (let i = 0; i < 30; i++) {
    pasted = await evalJs(pageB.send, `(async () => {
      const S = await window.__douzao.studio()
      const p = S.pattern.value
      const k = p ? p.cells[0] : -1
      return {
        sig: p ? S.patternSignature(p) : '',
        code: p && k >= 0 && p.palette[k] ? p.palette[k].code : '',
        manual: S.manualEdited.value,
        w: p ? p.width : 0,
        h: p ? p.height : 0,
        brand: S.options.brandId,
        board: S.boardLocked.value,
        paste: window.__pasteLog || null,
        toast: [...document.querySelectorAll('.toast')].map(t => (t.textContent || '').trim()).join(' | ')
      }
    })()`)
    if (pasted && pasted.sig) break
    await sleep(300)
  }
  const same = pasted && snap && pasted.sig === snap.sig && pasted.code === snap.code &&
    pasted.manual === true && pasted.w === snap.w && pasted.h === snap.h && pasted.brand === snap.brand
  check('另一个操作台 Ctrl+V 按原格子继续编辑', !!same, { snap, pasted })

  await evalJs(pageB.send, `(async () => {
    const c = document.createElement('canvas')
    c.width = 32; c.height = 64
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#22aa66'
    ctx.fillRect(0, 0, 32, 64)
    const blob = await new Promise(r => c.toBlob(r, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return blob.size
  })()`)
  await focusStudio(pageB.send)
  await press(pageB.send, 'v', 'KeyV', 86, 2)
  await sleep(400)
  const blue = await evalJs(pageB.send, `(() => {
    const tip = document.querySelector('[data-audit="replace-save-tip"]')
    const dialog = document.querySelector('.modal.show')
    return {
      open: !!(dialog && tip),
      text: tip ? (tip.textContent || '').replace(/\\s+/g, ' ').trim() : '',
      paste: window.__pasteLog || null
    }
  })()`)
  check('已有图纸时再贴图片，先问要不要保存', !!(blue && blue.open && /新图片/.test(blue.text || '')), blue)
  if (blue && blue.open) {
    await evalJs(pageB.send, `document.querySelector('[data-audit="replace-save-discard"]').click()`)
    let replaced = null
    for (let i = 0; i < 40; i++) {
      replaced = await evalJs(pageB.send, `(async () => {
        const S = await window.__douzao.studio()
        const p = S.pattern.value
        return { name: S.sourceName.value, sig: p ? S.patternSignature(p) : '', w: p ? p.width : 0, h: p ? p.height : 0 }
      })()`)
      if (replaced && replaced.sig && snap && replaced.sig !== snap.sig) break
      await sleep(400)
    }
    check('点取消后换成新贴的图片', !!(replaced && snap && replaced.sig !== snap.sig), replaced)
  } else {
    check('点取消后换成新贴的图片', false, '保存提示没出现')
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  const failed = report.filter(r => !r.ok).length
  console.log(`\n${report.length - failed}/${report.length}`)
  browser.close()
  chrome.kill()
  server.close()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* 临时配置清不掉也不影响结果 */ }
  if (failed) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
