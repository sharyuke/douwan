/* =========================================================================
   作品跨设备同步验收脚本（开发用，不进构建产物）
   -------------------------------------------------------------------------
   验的是什么：
     ① 电脑端登录 → 生成并保存一件作品 → 作品被推到服务端
     ② 平板端清空本机数据、重新登录同一账号 → 作品出现在「我的作品」
     ③ 手机端同样重新登录 → 作品还在
     ④ 手机端删除 → 服务端列表清空 → 电脑端重新登录也看不到了
   这正好对应「三个端口 / 换设备，同一账号的作品要同步」。

   默认用 scripts/mock-api-server.cjs（内存存作品，不碰线上库）；
   设置 SYNC_BASE_URL 可以指向一个真后端（本地起的 douwan-api + 静态代理）。
   用法：
     node scripts/verify-project-sync.cjs
     SYNC_BASE_URL=http://127.0.0.1:4413 node scripts/verify-project-sync.cjs
   ========================================================================= */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
const OUT = process.env.VERIFY_OUT || path.join(TMP_ROOT, 'project-sync-verify')
const PORT = Number(process.env.VERIFY_PORT || 4412)
/* 默认用脚本自带的 mock 服务端；设置 SYNC_BASE_URL 可以指向一个真后端
   （例如本地起的 douwan-api + 静态文件代理），验证真实接口。 */
const EXTERNAL_BASE = (process.env.SYNC_BASE_URL || '').replace(/\/+$/, '')
const ORIGIN = EXTERNAL_BASE || `http://127.0.0.1:${PORT}`
const CDP_TIMEOUT_MS = Number(process.env.VERIFY_CDP_TIMEOUT_MS || 90000)
/* 每次跑用一个新账号：真后端上不会看到上一次的测试作品。 */
const RUN_ID = Date.now().toString(36)
const ACCOUNT = { username: 'sync' + RUN_ID, password: 'secret-pass-1' }

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]

const VIEWPORTS = [
  { name: 'desktop', w: 1440, h: 900, mobile: false },
  { name: 'tablet', w: 834, h: 1112, mobile: true },
  { name: 'mobile', w: 390, h: 844, mobile: true }
]

const PROJECT_NAME = '跨设备同步验收'
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
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(method + ' 超时'))
        }
      }, CDP_TIMEOUT_MS)
    })
  }

  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts)
  return res.json()
}

async function evaluate(send, expression, { awaitPromise = false } = {}) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  }
  return r.result?.value
}

async function waitFor(send, expression, timeout = 20000, interval = 200) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const v = await evaluate(send, expression).catch(() => null)
    if (v) return v
    await sleep(interval)
  }
  return null
}

async function shot(send, name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  if (r && r.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
}

async function login(send) {
  const res = await evaluate(send, `(async () => {
    const U = await window.__douzao.userAccount()
    const account = ${JSON.stringify(ACCOUNT)}
    /* 第一台设备还没有这个账号：先登录，失败再注册；后面的设备直接登录成功。 */
    const login = await U.login({ account: account.username, password: account.password })
    if (login && login.ok) return login
    return await U.register({ username: account.username, password: account.password })
  })()`, { awaitPromise: true })
  if (!res || !res.ok) throw new Error('登录 / 注册失败：' + JSON.stringify(res))
}

async function serverProjects(send) {
  return evaluate(send, `(async () => {
    const t = JSON.parse(localStorage.getItem('douwan-user-tokens') || '{}')
    const res = await fetch('/api/v1/projects', {
      headers: t.access_token ? { Authorization: 'Bearer ' + t.access_token } : {}
    })
    const j = await res.json()
    return Array.isArray(j.data) ? j.data.length : -1
  })()`, { awaitPromise: true })
}

async function clearAndReload(send, pathname = '/') {
  /* 新 target 一开始是 about:blank，localStorage 访问会被拒绝；
     先落到同源页面，再清空，再导航到目标路径。 */
  await send('Page.navigate', { url: ORIGIN + '/' })
  await waitFor(send, `!!window.__douzao`, 20000)
  await evaluate(send, `localStorage.clear()`)
  await send('Page.navigate', { url: ORIGIN + pathname })
  await waitFor(send, `!!window.__douzao`, 20000)
  await sleep(700)
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/index.html 不存在，请先运行 pnpm build')
    process.exit(1)
  }
  fs.mkdirSync(OUT, { recursive: true })

  /* 默认起 mock 服务端（内存作品库）；SYNC_BASE_URL 指向真后端时不启动。 */
  let mock = null
  let mockErr = ''
  if (!EXTERNAL_BASE) {
    mock = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mock-api-server.cjs'), String(PORT)], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    mock.stderr.on('data', d => { mockErr += d.toString() })
  }
  let up = false
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(ORIGIN + '/api/v1/settings/public')
      if (r.ok) { up = true; break }
    } catch { /* 还没起来 */ }
    await sleep(200)
  }
  if (!up) {
    console.error('服务端没起来（' + ORIGIN + '）\n' + mockErr)
    if (mock) mock.kill()
    process.exit(1)
  }

  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    if (mock) mock.kill()
    process.exit(1)
  }

  const debugPort = 9222 + (process.pid % 500)
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'project-sync-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crashpad',
    '--disable-breakpad',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let chromeErr = ''
  chrome.stderr.on('data', d => { chromeErr += d.toString() })

  let version = null
  for (let i = 0; i < 80; i++) {
    try { version = await fetchJSON(`http://127.0.0.1:${debugPort}/json/version`); break } catch { await sleep(250) }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪\n' + chromeErr)
    chrome.kill()
    if (mock) mock.kill()
    process.exit(1)
  }

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready

  const results = []
  let failed = 0
  const errors = []
  const step = (name, ok, detail) => {
    results.push({ name, ok, detail })
    if (!ok) failed++
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
  }

  let projectId = ''

  try {
    /* ---------------------------------------------------------- ① 电脑端：生成并保存 */
    {
      const vp = VIEWPORTS[0]
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
      const send = (m, p) => browser.send(m, p, sessionId)
      browser.ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data)
        if (msg.sessionId && msg.sessionId !== sessionId) return
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          errors.push('console.error: ' + (msg.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' '))
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails
          errors.push('exception: ' + (d.exception?.description || d.text))
        }
      })
      await send('Runtime.enable')
      await send('Page.enable')
      await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile })

      await send('Page.navigate', { url: ORIGIN + '/' })
      await waitFor(send, `!!window.__douzao`, 20000)
      await sleep(800)
      await login(send)
      await waitFor(send, `!!JSON.parse(localStorage.getItem('douwan-user-tokens') || '{}').access_token`, 8000)
      step('电脑端登录成功', true)

      const saved = await evaluate(send, `(async () => {
        const S = await window.__douzao.studio()
        const A = await window.__douzao.assets()
        const Inv = await window.__douzao.inventoryStore()
        Inv.useInventory.value = false
        Inv.clearInventory()
        const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
        await S.useAsset(asset)
        S.setCanvasSize(52, 52)
        S.options.removeBg = true
        S.regenerate({ keys: ['high'], silent: true })
        const id = S.saveProject(${JSON.stringify(PROJECT_NAME)})
        return { id, count: S.projects.value.length }
      })()`, { awaitPromise: true })
      projectId = saved && saved.id
      step('电脑端保存作品', !!projectId, projectId || 'saveProject 返回空')

      /* 保存后有 900ms 防抖，等推送完成 */
      let serverCount = 0
      for (let i = 0; i < 40; i++) {
        serverCount = await serverProjects(send)
        if (serverCount >= 1) break
        await sleep(250)
      }
      step('作品已同步到服务端', serverCount === 1, `服务端 ${serverCount} 件`)

      await send('Page.navigate', { url: ORIGIN + '/projects' })
      await waitFor(send, `!!document.querySelector('.projectCard')`, 15000)
      /* 刷新后要先等本地令牌换回账号、同步完成，状态行才会写「已同步到账号」 */
      await waitFor(send, `(document.querySelector('[data-audit="project-sync"]') || {}).innerText?.includes('已同步到账号')`, 15000)
      const listText = await evaluate(send, `document.body.innerText`)
      const syncText = await evaluate(send, `(document.querySelector('[data-audit="project-sync"]') || {}).innerText || ''`)
      step('电脑端「我的作品」显示该作品', String(listText).includes(PROJECT_NAME))
      step('电脑端同步状态已写明', /已同步到账号/.test(syncText), syncText.replace(/\s+/g, ' ').trim())
      await shot(send, 'desktop-projects')
      await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    }

    /* ------------------------------------ ② 平板 / 手机：清空本机后重新登录，作品还在 */
    for (const vp of VIEWPORTS.slice(1)) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
      const send = (m, p) => browser.send(m, p, sessionId)
      await send('Runtime.enable')
      await send('Page.enable')
      await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile })

      await clearAndReload(send, '/')
      await login(send)
      await waitFor(send, `!!JSON.parse(localStorage.getItem('douwan-user-tokens') || '{}').access_token`, 8000)

      /* 等首次同步把服务端作品写进本机 */
      let localCount = 0
      for (let i = 0; i < 40; i++) {
        localCount = await evaluate(send, `(async () => (await window.__douzao.studio()).projects.value.length)()`, { awaitPromise: true })
        if (localCount >= 1) break
        await sleep(250)
      }
      step(`${vp.name} 端重新登录后下载到作品`, localCount === 1, `本机 ${localCount} 件`)

      await send('Page.navigate', { url: ORIGIN + '/projects' })
      await waitFor(send, `!!document.querySelector('.projectCard')`, 15000)
      const text = await evaluate(send, `document.body.innerText`)
      step(`${vp.name} 端「我的作品」能看到同一件作品`, String(text).includes(PROJECT_NAME))
      await shot(send, `${vp.name}-projects`)

      /* 手机端顺手验删除：删完服务端也要没有 */
      if (vp.name === 'mobile') {
        const clicked = await evaluate(send, `(() => {
          const card = [...document.querySelectorAll('.projectCard')].find(c => c.textContent.includes(${JSON.stringify(PROJECT_NAME)}))
          if (!card) return false
          const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('删除'))
          if (!btn) return false
          btn.click()
          return true
        })()`)
        step('手机端点删除', clicked)
        await sleep(400)
        const confirmed = await evaluate(send, `(() => {
          const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '确认删除')
          if (!btns.length) return false
          btns[btns.length - 1].click()
          return true
        })()`)
        step('确认删除', confirmed)
        let after = -1
        for (let i = 0; i < 40; i++) {
          after = await serverProjects(send)
          if (after === 0) break
          await sleep(250)
        }
        step('删除已同步到服务端', after === 0, `服务端 ${after} 件`)
        await shot(send, 'mobile-after-delete')
      }

      await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    }

    /* ------------------------------------------- ③ 电脑端再登录：被删的作品不该回来 */
    {
      const vp = VIEWPORTS[0]
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
      const send = (m, p) => browser.send(m, p, sessionId)
      await send('Runtime.enable')
      await send('Page.enable')
      await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile })

      await clearAndReload(send, '/')
      await login(send)
      await sleep(1500)
      await send('Page.navigate', { url: ORIGIN + '/projects' })
      await sleep(1500)
      const text = await evaluate(send, `document.body.innerText`)
      step('删除后电脑端重新登录不再看到该作品', !String(text).includes(PROJECT_NAME))
      await shot(send, 'desktop-after-delete')
      await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    }
  } catch (e) {
    step('脚本执行', false, e.message)
  } finally {
    step('无 console 报错 / 未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '))
    chrome.kill()
    if (mock) mock.kill()
  }

  const pass = results.filter(r => r.ok).length
  console.log(`\n${pass}/${results.length} 通过`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
