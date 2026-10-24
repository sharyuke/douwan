/* =========================================================================
   后台界面无头浏览器自检（开发用，不进构建产物）
   用途：把后台 9 个页面在真实 Chrome 里逐个渲染一遍，检查
        「页面是否白屏 / 有没有 console 报错 / 列表有没有真的渲染出数据 /
         有没有横向溢出」，并输出截图。
   为什么需要它：单元测试与接口自测都测不出「后台页面打不开」这种问题。

   用法（在 home 上跑，需要 dist/ 已构建）：
     ADMIN_USER=douwan ADMIN_PASS=xxx \
     ADMIN_API_BASE=https://dw.sharyuke.com \
     node scripts/admin-audit.cjs

   说明：
   - 页面与 npm 都从本机 dist/ 提供，只有 /api 与 /uploads 反代到真实后端，
     所以测的是「同一份前端产物 + 真实接口」，与线上形态一致。
   - 会真的登录、真的读取列表（只读，不做任何写操作）。
   - 想测别的产物目录（例如与别人并行开发时构建到 dist-xxx 避免互相覆盖）：
     加 AUDIT_DIST=/绝对或相对路径。
   ========================================================================= */

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
/** 产物目录：默认 dist/，可用 AUDIT_DIST 指到私有构建目录（并行开发时避免互相覆盖） */
const DIST = path.resolve(process.env.AUDIT_DIST || path.join(ROOT, 'dist'))
const OUT = process.env.AUDIT_OUT || path.join(os.tmpdir(), 'douwan-admin-audit')
const PORT = Number(process.env.AUDIT_PORT || 4399)
const UPSTREAM = new URL(process.env.ADMIN_API_BASE || 'https://dw.sharyuke.com')
const ADMIN_USER = process.env.ADMIN_USER || 'douwan'
const ADMIN_PASS = process.env.ADMIN_PASS || ''
/* 可选：登录后在某一个后台页面上执行一段自定义探针（例如打开上传弹窗查分类选项） */
const EVAL_FILE = process.env.ADMIN_EVAL_FILE || ''
const EVAL_PAGE = process.env.ADMIN_EVAL_PAGE || 'admin-assets'
const EVAL_SRC = EVAL_FILE ? fs.readFileSync(path.resolve(EVAL_FILE), 'utf8') : ''

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)

/** 后台页面清单：hash 路由 + 期望在页面上出现的关键字（用来判断是不是白屏） */
const PAGES = [
  { name: 'admin-overview', hash: '#/admin', expect: ['数据概览', '今日订单数', '支付'] },
  // 活跃监控：四个维度的 KPI 与标签页都要求至少渲染出固定文案，
  // 数据本身可能为空（0），所以只断言口径文案不空口。
  {
    name: 'admin-activity',
    hash: '#/admin/activity',
    expect: ['用户活跃监控', '今日活跃用户（DAU）', '使用频率', '采集周期'],
    optional: true
  },
  // 访问量标签：PV / UV 的口径文案必须出现（数字可以是 0），
  // 并且要能看到「含未登录访客」这句——不然很容易把 UV 当人数读。
  {
    name: 'admin-activity-traffic',
    hash: '#/admin/activity?tab=traffic',
    expect: ['访问量', '今日访问量（PV）', '今日访客（UV）', '页面访问排行', '访客明细', '未登录访客'],
    optional: true
  },
  { name: 'admin-plans', hash: '#/admin/plans', expect: ['套餐管理', '套餐方案 A'], optional: true },
  { name: 'admin-cards', hash: '#/admin/cards', expect: ['卡密管理', '生成卡密'] },
  { name: 'admin-orders', hash: '#/admin/orders', expect: ['订单管理', '人工确认'], optional: true },
  { name: 'admin-assets', hash: '#/admin/assets', expect: ['素材库', '上传'], optional: true },
  { name: 'admin-users', hash: '#/admin/users', expect: ['用户与兑换记录'], optional: true },
  { name: 'admin-settings', hash: '#/admin/settings', expect: ['系统设置', '网站名称'] },
  { name: 'admin-logs', hash: '#/admin/logs', expect: ['操作日志'], optional: true },
  // 登录页放最后：它需要在「未登录」状态下渲染，会清掉令牌
  { name: 'admin-login', hash: '#/admin/login', expect: ['豆玩后台管理', '管理员账号'], noAuth: true },
  // 前台衔接：临时免费开放期间，账户页展示免费说明，不再有卡密入口。
  { name: 'account', hash: '#/account', expect: ['我的账户', '全部功能免费开放'], noAuth: true }
]

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 }
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ------------------------------------------------------------------ 静态 + 反代 */

function server() {
  return new Promise(resolve => {
    const s = http.createServer(async (req, res) => {
      const url = req.url || '/'

      // 把 /api 与 /uploads 反代到真实后端（保持同源，前端不用改任何配置）
      if (url.startsWith('/api/') || url.startsWith('/uploads/')) {
        try {
          const upstream = await fetch(UPSTREAM.origin + url, {
            method: req.method,
            headers: {
              'content-type': req.headers['content-type'] || 'application/json',
              ...(req.headers.authorization ? { authorization: req.headers.authorization } : {})
            },
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req),
            redirect: 'manual'
          })
          const buf = Buffer.from(await upstream.arrayBuffer())
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
            'Content-Disposition': upstream.headers.get('content-disposition') || ''
          })
          res.end(buf)
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ code: 10500, message: 'audit 代理失败: ' + e.message }))
        }
        return
      }

      const p = decodeURIComponent(url.split('?')[0])
      const file = path.join(DIST, p === '/' ? '/index.html' : p)
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(fs.readFileSync(path.join(DIST, 'index.html')))
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
      res.end(fs.readFileSync(file))
    })
    s.listen(PORT, '127.0.0.1', () => resolve(s))
  })
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/* ------------------------------------------------------------------ CDP */

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
      } else if (msg.method) {
        this.events.push(msg)
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
      }, 30000)
    })
  }

  close() {
    try { this.ws.close() } catch { /* ignore */ }
  }
}

async function fetchJSON(url) {
  const res = await fetch(url)
  return res.json()
}

/* ------------------------------------------------------------------ 主体 */

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('没有 dist/index.html，请先在 home 上跑 corepack pnpm build')
    process.exit(1)
  }
  if (!ADMIN_PASS) {
    console.error('缺少 ADMIN_PASS（管理员密码），例如：ADMIN_PASS=xxx node scripts/admin-audit.cjs')
    process.exit(1)
  }

  fs.mkdirSync(OUT, { recursive: true })
  const srv = await server()
  const origin = `http://127.0.0.1:${PORT}`

  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome，可用 CHROME_PATH 指定')
    srv.close()
    process.exit(1)
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'douwan-admin-chrome-'))
  const debugPort = 9322 + (process.pid % 400)
  const chrome = spawn(chromePath, [
    '--headless=new',
    /* 本机 Windows 从 Node 子进程启动 Chrome 时沙箱会让进程直接退出（与 audit.cjs 同因），
       后台自检是本地只读页面，关掉沙箱即可稳定启动。 */
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crashpad',
    '--disable-breakpad',
    '--hide-scrollbars',
    '--lang=zh-CN',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let chromeErr = ''
  chrome.stderr.on('data', d => { chromeErr += d.toString() })

  let version = null
  for (let i = 0; i < 60; i++) {
    try {
      version = await fetchJSON(`http://127.0.0.1:${debugPort}/json/version`)
      break
    } catch {
      await sleep(250)
    }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪\n' + chromeErr)
    chrome.kill()
    srv.close()
    process.exit(1)
  }
  console.log('Chrome:', version['Browser'])
  console.log('被测地址:', origin, '→ API 反代到', UPSTREAM.origin)

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready

  const report = { generatedAt: new Date().toISOString(), browser: version['Browser'], pages: [] }
  let failures = 0

  // 一个 target 跑完一个视口下的所有页面。
  //
  // 两个关键点（都踩过）：
  //  1. 后台登录接口有限流（默认 10 次/分钟），所以**每个视口只登录一次**，
  //     令牌写进该 target 的 localStorage 后，同 target 内换 hash 路由不会丢；
  //  2. 不同 target 之间 localStorage **不共享**（Chrome 的隔离上下文），
  //     所以不能「先登一次再开新 target」——那样每个页面都会因为拿不到令牌
  //     被路由守卫弹回登录页，看起来像「后台打不开」。
  for (const vp of WIDTHS) {
    const target = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    const send = (m, p) => browser.send(m, p, sessionId)

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.name === 'mobile'
    })

    // 先在同 target 里登录一次
    await send('Page.navigate', { url: `${origin}/#/` })
    await sleep(600)
    const login = await send('Runtime.evaluate', {
      expression: `(async () => {
        const r = await fetch('/api/v1/admin/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: ${JSON.stringify(ADMIN_USER)}, password: ${JSON.stringify(ADMIN_PASS)} })
        })
        const j = await r.json()
        if (j.code !== 0) return 'login-failed: ' + j.message
        localStorage.setItem('douwan-admin-tokens', JSON.stringify(j.data.tokens))
        // 页面导航后 window 上的变量会丢，所以只在这里存一份用于同一次导航内恢复；
        // 真正的持久化靠 localStorage，导航后仍然在。
        return 'ok'
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (login.result.value !== 'ok') {
      console.error('登录失败：', login.result.value)
      chrome.kill(); srv.close(); process.exit(1)
    }

    for (const page of PAGES) {
      const before = browser.events.length

      // 登录页要单独处理：清掉令牌后必须**整页刷新**再去登录页。
      // 只改 hash 的话，SPA 内存里那份「已登录」状态还在（useAdminAuth 的
      // ref 不会因为 localStorage 被清就重置），登录页的 onMounted 会
      // 直接把用户送进后台，看起来像「登录页打不开」。
      //
      // 另外：每个页面都带一个**唯一的查询参数**强制浏览器重新加载文档。
      // 只改 hash 是「同文档内导航」，实测在连续切换多个 hash 路由后
      // 偶尔会停在上一页（SPA 的 hash 变化没触发 router）。
      const navUrl = `${origin}/?p=${page.name}-${vp.name}-${Date.now()}${page.hash}`
      if (page.noAuth) {
        await send('Runtime.evaluate', { expression: `localStorage.removeItem('douwan-admin-tokens')` })
      }
      await send('Page.navigate', { url: navUrl })
      await sleep(page.noAuth ? 1800 : 1500)

      const probe = await send('Runtime.evaluate', {
        expression: `(() => {
          const main = document.querySelector('.adm-main') || document.body
          const text = (main.innerText || '').slice(0, 6000)
          return {
            text,
            rows: document.querySelectorAll('.adm-table tbody tr').length,
            kpis: document.querySelectorAll('.adm-kpi').length,
            modal: !!document.querySelector('.adm-modal'),
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            panels: document.querySelectorAll('.adm-card, .adm-toolbar, .adm-kpis').length,
            url: location.hash,
            title: document.title
          }
        })()`,
        returnByValue: true
      })
      const v = probe.result.value

      // 收集本页的 console 错误与未捕获异常
      const errors = []
      for (const ev of browser.events.slice(before)) {
        if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
          errors.push(ev.params.args.map(a => a.value || a.description || '').join(' '))
        }
        if (ev.method === 'Runtime.exceptionThrown') {
          errors.push('未捕获异常: ' + (ev.params.exceptionDetails.exception?.description || ev.params.exceptionDetails.text))
        }
      }

      const missing = page.expect.filter(k => !v.text.includes(k))
      const blank = v.text.trim().length < 20
      let custom = null
      if (EVAL_SRC && page.name === EVAL_PAGE) {
        const ev = await send('Runtime.evaluate', {
          expression: EVAL_SRC,
          awaitPromise: true,
          returnByValue: true
        })
        custom = ev.result.value
      }
      const customOk = !custom || custom.ok !== false
      const ok = !blank && missing.length === 0 && errors.length === 0 && v.overflowX <= 2 && customOk

      // 截图留档（自定义探针之后截，能留下弹窗打开的状态）
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      const shotPath = path.join(OUT, `${page.name}-${vp.name}.png`)
      fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

      report.pages.push({ page: page.name, viewport: vp.name, ok, missing, blank, errors, custom, ...v, screenshot: shotPath })
      if (!ok) failures++
      console.log(
        `${ok ? '✓' : '✗'} ${page.name}@${vp.name}  行数=${v.rows} 卡片=${v.panels} KPI=${v.kpis} 溢出=${v.overflowX}` +
        (missing.length ? ` 缺少文案=${JSON.stringify(missing)}` : '') +
        (blank ? ' 页面空白' : '') +
        (errors.length ? ` 报错=${errors.length}` : '') +
        (custom ? ` 探针=${custom.ok ? '通过' : '失败'}` : '')
      )
      if (custom && custom.steps) {
        custom.steps.filter(s => !s.pass).slice(0, 5).forEach(s => console.log(`    ! 探针: ${s.name} ${s.detail || ''}`))
      }
      if (errors.length) errors.slice(0, 3).forEach(e => console.log('    ! ' + e.slice(0, 200)))
    }

    await browser.send('Target.closeTarget', { targetId: target.targetId })
  }

  const reportPath = path.join(OUT, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n截图与报告: ${OUT}`)
  console.log(`结果: ${report.pages.length - failures}/${report.pages.length} 通过`)

  browser.close()
  chrome.kill()
  srv.close()
  process.exit(failures ? 1 : 0)
}

main().catch(e => {
  console.error('自检脚本异常:', e)
  process.exit(1)
})
