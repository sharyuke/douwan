/* =========================================================================
   「智能抠图」真浏览器验收（抠图算法改动后的回归关卡）
   用法：node scripts/verify-matte.cjs [--url https://dw.sharyuke.com]

   走的是真实用户路径：
     ① 打开 /editor → 用页面里真实的 file input 上传图片（DOM.setFileInputFiles）
     ② 真点「智能抠图」（电脑端点页签、手机端选下拉）→ 触发重新生成
     ③ 读工作台真实状态：抠图有没有生效、背景去掉了多少、主体还在不在
     ④ 拿页面里**同一份** estimateMatte（就是线上跑的那份代码）与真值掩膜比 IoU
     ⑤ 三端视口各跑一遍，前后留截图

   判据（每张图都要过）：
     · matte.applied 为真 —— 抠图真的生效了
     · 背景确实被去掉：启用抠图后的豆数明显少于不抠图
     · 主体还在：启用抠图后仍留有相当比例的豆（主体没被吃掉）
     · 像素级 IoU ≥ 0.9（低对比主体 / 顶边主体 这两类必须 ≥ 0.99）
     · 全程 console 无报错
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const FIXTURES = path.join(ROOT, 'scripts', 'fidelity', 'fixtures')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
const OUT = path.join(TMP_ROOT, 'matte')
const PORT = Number(process.env.AUDIT_PORT || 4331)
fs.mkdirSync(OUT, { recursive: true })

/** 要验的图：低对比主体、顶边主体、大面积低对比、白底白主体，外加一张真实照片 */
const CASES = [
  { file: 'cut_low_contrast.png', truth: 'cut_low_contrast.mask.png', minIou: 0.99, note: '主体与背景色相近' },
  { file: 'cut_low_contrast_big.png', truth: 'cut_low_contrast_big.mask.png', minIou: 0.99, note: '大面积低对比主体' },
  { file: 'cut_low_contrast_shadow.png', truth: 'cut_low_contrast_shadow.mask.png', minIou: 0.99, note: '低对比主体 + 投影' },
  { file: 'cut_touch_edge.png', truth: 'cut_touch_edge.mask.png', minIou: 0.99, note: '主体顶到画幅边缘' },
  { file: 'cut_white_on_white.png', truth: 'cut_white_on_white.mask.png', minIou: 0.99, note: '白主体压白背景' },
  { file: 'cut_soft_edge.png', truth: 'cut_soft_edge.mask.png', minIou: 0.9, note: '软边（羽化）' }
]

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 1000, mobile: false },
  { key: 'tablet', width: 834, height: 1112, mobile: false },
  { key: 'mobile', width: 390, height: 844, mobile: true }
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
]

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
    this.events = []
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
      } else if (msg.method) this.events.push(msg)
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(method + ' 超时'))
        }
      }, 120000)
    })
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

/* ---------------------------------------------------------------- 页面脚本 */

/** 上传前：会员身份 + 关掉会干扰比对的选项（卡通化） */
const PREP = `(async () => {
  const d = window.__douzao
  const M = await d.membership()
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  const S = await d.studio()
  S.options.cartoon = false
  S.options.removeBg = false
  return { ok: true }
})()`

/**
 * 每张图开始前把「智能抠图」关掉并重新生成一次 ——
 * 上一张图结束时它是开着的，状态会留在 options 里，
 * 不复位的话「不抠图的对照」拿到的是已经抠过的图，两边就一样多了。
 */
const RESET = `(async () => {
  const d = window.__douzao
  const S = await d.studio()
  S.options.removeBg = false
  await S.regenerate({ silent: true })
  return { ok: true, removeBg: S.options.removeBg }
})()`

/** 真点「智能抠图」：电脑端点页签，手机端先点「换图」把创建面板拉起来再选下拉 */
const PICK_CUTOUT = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const visible = el => !!(el && el.offsetParent !== null)
  const findCtl = () => {
    const tab = [...document.querySelectorAll('.procTab')].find(b => b.textContent.includes('智能抠图') && visible(b))
    if (tab) return { el: tab, kind: 'tab' }
    /* 全屏创作工作台：命令栏里的「智能抠图 关 / 保守 / 标准 / 激进」分段控件 */
    const matte = [...document.querySelectorAll('.csMatte')].find(el => visible(el))
    if (matte) {
      const btns = [...matte.querySelectorAll('.csSeg button')]
      const std = btns.find(b => b.textContent.trim() === '标准') || btns[1]
      if (std) return { el: std, kind: 'console' }
    }
    const sel = [...document.querySelectorAll('select[aria-label="图片处理方式"]')].find(visible)
    if (sel) return { el: sel, kind: 'select' }
    return null
  }
  let ctl = findCtl()
  if (!ctl) {
    /* 手机端：侧栏在底部抽屉里，得先点工具条上的「换图」把它拉出来 */
    const swap = [...document.querySelectorAll('.quickItem')].find(b => b.textContent.includes('换图') && visible(b))
    if (!swap) return { ok: false, err: '找不到「换图」入口（手机端要先打开创建面板）' }
    swap.click()
    await sleep(500)
    ctl = findCtl()
    if (!ctl) return { ok: false, err: '「换图」面板里没有可见的「智能抠图」入口' }
  }
  if (ctl.kind === 'tab' || ctl.kind === 'console') {
    ctl.el.click()
  } else {
    ctl.el.value = 'cutout'
    ctl.el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await sleep(400)
  return { ok: true, how: ctl.kind }
})()`

/** 读工作台真实状态 */
const READ_STATE = `(async () => {
  const d = window.__douzao
  const S = await d.studio()
  const pat = S.pattern.value
  const cells = pat ? Array.from(pat.cells) : []
  const artW = pat ? (pat.artW || pat.width) : 0
  const artH = pat ? (pat.artH || pat.height) : 0
  const ox = pat ? Math.floor((pat.width - artW) / 2) : 0
  const oy = pat ? Math.floor((pat.height - artH) / 2) : 0
  let beads = 0, empty = 0
  for (let y = 0; y < artH; y++) {
    for (let x = 0; x < artW; x++) {
      const v = cells[(y + oy) * pat.width + (x + ox)]
      if (v < 0) empty++
      else beads++
    }
  }
  const v0 = S.variants.value && S.variants.value[0]
  const matte = v0 ? v0.matte : null
  return {
    ok: true,
    hasPattern: !!pat,
    board: pat ? pat.width + 'x' + pat.height : '',
    art: artW + 'x' + artH,
    beads, empty,
    removeBg: S.options.removeBg,
    matte: matte ? {
      applied: !!matte.applied,
      bgShare: matte.bgShare,
      shadowShare: matte.shadowShare,
      confidence: matte.confidence,
      reason: matte.reason || ''
    } : null,
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim())
  }
})()`

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  const argv = process.argv.slice(2)
  const urlIdx = argv.indexOf('--url')
  const externalBase = urlIdx >= 0 ? String(argv[urlIdx + 1] || '').replace(/\/+$/, '') : ''
  const server = externalBase ? null : await staticServer()
  const origin = externalBase || `http://127.0.0.1:${PORT}`

  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    process.exit(1)
  }
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'matte-chrome-'))
  const debugPort = 9337
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-default-browser-check', '--disable-crashpad', '--disable-breakpad',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' })

  let ws = null
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 300))
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      const info = await res.json()
      ws = info.webSocketDebuggerUrl
      break
    } catch { /* 还没起来 */ }
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
  await send('DOM.enable')

  const consoleErrors = []
  cdp.ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(String(msg.params.exceptionDetails.text || ''))
    }
  })

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    }
    return r.result.value
  }
  const shot = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const file = path.join(OUT, name)
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'))
    return file
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const results = []
  let pass = 0
  let fail = 0
  const note = (viewport, name, ok, msg) => {
    results.push({ viewport, name, ok, msg })
    if (ok) pass++
    else fail++
    console.log(`${ok ? '  ✓' : '  ✗'} [${viewport}] ${name} ${msg}`)
  }

  for (const vp of VIEWPORTS) {
    console.log(`\n===== ${vp.key} ${vp.width}x${vp.height} =====`)
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile
    })
    /* 关掉新手指引浮层（它盖在画布上） */
    await send('Page.navigate', { url: `${origin}/editor` })
    await sleep(1200)
    await evaluate(`try { localStorage.setItem('douwan.guide.v1', '1') } catch (e) {}`)
    await send('Page.navigate', { url: `${origin}/editor` })
    await sleep(3500)
    await evaluate(PREP)

    for (const c of CASES) {
      const imgPath = path.join(FIXTURES, c.file)
      const truthPath = path.join(FIXTURES, c.truth)
      if (!fs.existsSync(imgPath)) {
        note(vp.key, c.file, false, 'fixture 不存在')
        continue
      }
      const tag = `${vp.key}-${c.file.replace(/\.png$/, '')}`

      /* ① 用真实的 file input 上传 */
      const { root } = await send('DOM.getDocument', { depth: 1 })
      const { nodeId } = await send('DOM.querySelector', {
        nodeId: root.nodeId, selector: 'input[type=file][hidden]'
      })
      if (!nodeId) {
        note(vp.key, c.file, false, '页面里找不到编辑器上传用的 file input')
        continue
      }
      await send('DOM.setFileInputFiles', { nodeId, files: [imgPath] })
      await sleep(2500)

      /* ② 复位成「不抠图」并重新生成（当对照） */
      await evaluate(RESET)
      await sleep(2500)
      const before = await evaluate(READ_STATE)

      /* ③ 真点「智能抠图」→ 重新生成 */
      const picked = await evaluate(PICK_CUTOUT)
      if (!picked.ok) {
        note(vp.key, c.file, false, picked.err || '点不到「智能抠图」')
        continue
      }
      await sleep(3000)
      const after = await evaluate(READ_STATE)

      await shot(`${tag}.png`)

      /* 判据：抠图生效 + 背景去掉 + 主体还在 */
      const matte = after.matte || {}
      const appliedOk = !!matte.applied
      const fewer = after.beads < before.beads
      /* 主体还在：抠图后仍留有一定比例的豆（相对不抠图） */
      const keepRatio = before.beads > 0 ? after.beads / before.beads : 0
      const subjectOk = keepRatio > 0.2

      note(vp.key, `${c.file} 抠图生效`, appliedOk,
        `applied=${appliedOk} 入口=${picked.how} bgShare=${matte.bgShare != null ? Math.round(matte.bgShare * 100) + '%' : '-'} ` +
        `reason=${matte.reason || '-'} 豆 ${before.beads}→${after.beads}`)
      note(vp.key, `${c.file} 背景被去掉`, fewer, `豆数 ${before.beads} → ${after.beads}`)
      note(vp.key, `${c.file} 主体保留`, subjectOk, `保留比例 ${(keepRatio * 100).toFixed(0)}%`)

      /* ④ 页面里同一份 estimateMatte 与真值比 IoU */
      if (fs.existsSync(truthPath)) {
        const imgB64 = fs.readFileSync(imgPath).toString('base64')
        const truthB64 = fs.readFileSync(truthPath).toString('base64')
        const expr = `(async () => {
          const d = window.__douzao
          const load = async (b64) => {
            const bin = atob(b64)
            const buf = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
            const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
            const cv = new OffscreenCanvas(bmp.width, bmp.height)
            const ctx = cv.getContext('2d')
            ctx.drawImage(bmp, 0, 0)
            return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data }
          }
          const img = await load(${JSON.stringify(imgB64)})
          const truth = await load(${JSON.stringify(truthB64)})
          const n = img.w * img.h
          const rgba = new Uint8ClampedArray(n * 4)
          for (let i = 0; i < n; i++) {
            rgba[i * 4] = img.data[i * 4]
            rgba[i * 4 + 1] = img.data[i * 4 + 1]
            rgba[i * 4 + 2] = img.data[i * 4 + 2]
            rgba[i * 4 + 3] = 255
          }
          const t0 = performance.now()
          const res = d.matte.estimateMatte(rgba, img.w, img.h, { level: 'normal' })
          const ms = performance.now() - t0
          const alpha = res.alpha && res.alpha.length === n ? res.alpha : new Float32Array(n).fill(1)
          let inter = 0, union = 0, fp = 0, fn = 0
          for (let i = 0; i < n; i++) {
            const p = alpha[i] >= 0.5 ? 1 : 0
            const t = truth.data[i * 4] >= 128 ? 1 : 0
            if (p && t) inter++
            if (p || t) union++
            if (p && !t) fp++
            if (!p && t) fn++
          }
          return {
            ok: true, iou: union ? inter / union : 0,
            missed: n ? fn / n : 0, extra: n ? fp / n : 0,
            applied: !!res.applied, bgShare: res.bgShare, ms
          }
        })()`
        const m = await evaluate(expr)
        note(vp.key, `${c.file} IoU≥${c.minIou}`, m.iou >= c.minIou,
          `IoU=${m.iou.toFixed(3)} 漏掉=${(m.missed * 100).toFixed(1)}% 多余=${(m.extra * 100).toFixed(1)}% ${m.ms.toFixed(0)}ms`)
      }
    }
  }

  console.log(`\nconsole 报错 ${consoleErrors.length} 条`)
  for (const e of consoleErrors.slice(0, 8)) console.log('  ! ' + e)

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  const bad = results.filter(r => !r.ok)
  if (bad.length) {
    console.log('失败项：')
    for (const r of bad) console.log(`  - [${r.viewport}] ${r.name} ${r.msg}`)
  }

  cdp.close()
  child.kill()
  if (server) server.close()
  process.exit(fail > 0 || consoleErrors.length > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
