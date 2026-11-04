/* =========================================================================
   手机验证码登录验收脚本（开发用，不进构建产物）
   -------------------------------------------------------------------------
   当前状态：短信资质审核中，入口在 LoginDialog.vue 里关着（SMS_LOGIN_ENABLED=false）。
   默认只验「入口确实不出现」：服务端配没配短信，弹窗都只有微信 + 邮箱两种方式，
   也没有手机号输入框。审核通过、把开关改成 true 之后，用
   SMS_LOGIN_RELEASED=1 node scripts/verify-sms-login.cjs 跑下面的完整流程。
   -------------------------------------------------------------------------
   完整流程验的是什么（真浏览器走真实用户路径）：
     ① 服务端配了短信（mock 默认 configured）→ 登录弹窗出现「手机号登录 /
        邮箱登录」页签，默认落在手机号表单
     ② 非法手机号点「获取验证码」→ 表单内报错
     ③ 合法手机号发码成功 → 按钮进入 60 秒倒计时
     ④ 错误验证码提交 → 表单内报「验证码不正确」
     ⑤ 正确验证码（mock 固定 638264）→ 登录成功：弹窗关闭、令牌落 localStorage、
        用户资料带手机号
     ⑥ 切到邮箱页签 → 邮箱表单显示、手机表单隐藏
     ⑦ 服务端未配置短信（MOCK_SMS_DISABLED=1）→ 不出现页签，回到「或使用邮箱」
        的老版式，邮箱表单直接可见
   用法：node scripts/verify-sms-login.cjs
   ========================================================================= */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
const OUT = path.join(TMP_ROOT, 'sms-login-verify')
const PORT = Number(process.env.VERIFY_PORT || 4414)
const ORIGIN = `http://127.0.0.1:${PORT}`
const SMS_CODE = '638264'
const PHONE = '13800138000'
/* 入口放开后才跑完整流程（见文件头说明）。 */
const RELEASED = process.env.SMS_LOGIN_RELEASED === '1'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]

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
      }, 60000)
    })
  }

  close() { try { this.ws.close() } catch { /* ignore */ } }
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

function startMock(disabled) {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mock-api-server.cjs'), String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOCK_SMS_DISABLED: disabled ? '1' : '' }
  })
  let err = ''
  child.stderr.on('data', d => { err += d.toString() })
  return { child, err: () => err }
}

async function waitMock() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(ORIGIN + '/api/v1/settings/public')
      if (r.ok) return true
    } catch { /* 还没起来 */ }
    await sleep(200)
  }
  return false
}

async function openLoginDialog(send) {
  await send('Page.navigate', { url: ORIGIN + '/' })
  await waitFor(send, `!!window.__douzao`, 20000)
  await sleep(600)
  await evaluate(send, `document.querySelector('[data-audit="header-login"]').click()`)
  await waitFor(send, `!!document.querySelector('[data-audit="login-dialog"]')`, 8000)
  /* 等两个状态探测（微信 + 短信）回来 */
  await sleep(600)
}

async function runScenario(browser, { disabled }) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  const consoleErrors = []
  browser.ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.sessionId && msg.sessionId !== sessionId) return
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      consoleErrors.push('exception: ' + (d.exception?.description || d.text))
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  const checks = []
  const step = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    console.log(`    [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  }

  /* 上一个场景可能已登录，先清掉本机登录态 */
  await send('Page.navigate', { url: ORIGIN + '/' })
  await waitFor(send, `!!window.__douzao`, 20000)
  await evaluate(send, `localStorage.clear()`)

  await openLoginDialog(send)
  const q = sel => `!!(document.querySelector('[data-audit="login-dialog"]') && document.querySelector('[data-audit="login-dialog"]').querySelector('${sel}'))`
  const vis = sel => `(() => { const d = document.querySelector('[data-audit="login-dialog"]'); const el = d && d.querySelector('${sel}'); return !!el && el.offsetParent !== null })()`
  const text = sel => `(() => { const d = document.querySelector('[data-audit="login-dialog"]'); const el = d && d.querySelector('${sel}'); return el ? el.textContent.trim() : '' })()`
  const type = (sel, value) => evaluate(send, `(() => { const d = document.querySelector('[data-audit="login-dialog"]'); const el = d.querySelector('${sel}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const click = sel => evaluate(send, `(() => { const d = document.querySelector('[data-audit="login-dialog"]'); d.querySelector('${sel}').click() })()`)

  if (!RELEASED) {
    /* 入口关闭：服务端配没配短信，弹窗都不该出现页签、手机号表单与相关隐私说明 */
    step('入口隐藏：不出现手机号 / 邮箱页签', !(await evaluate(send, q('[data-audit="login-tabs"]'))))
    step('入口隐藏：没有手机号输入框', !(await evaluate(send, q('[data-audit="login-phone"]'))))
    step('保留「或使用邮箱」版式', !!(await evaluate(send, q('[data-audit="email-divider"]'))))
    step('邮箱表单直接可见', !!(await evaluate(send, vis('[data-audit="email-submit"]'))))
    step('隐私说明不再提手机号登录', !/手机号登录/.test(
      await evaluate(send, `document.querySelector('[data-audit="login-dialog"]').textContent`)
    ))
    await shot(send, 'sms-hidden')
    return { checks, consoleErrors }
  }

  if (disabled) {
    step('未配置短信：不出现页签', !(await evaluate(send, q('[data-audit="login-tabs"]'))))
    step('未配置短信：保留「或使用邮箱」版式', !!(await evaluate(send, q('[data-audit="email-divider"]'))))
    step('未配置短信：邮箱表单直接可见', !!(await evaluate(send, vis('[data-audit="email-submit"]'))))
    await shot(send, 'sms-disabled')
    return { checks, consoleErrors }
  }

  step('页签出现（手机号 / 邮箱）', !!(await evaluate(send, q('[data-audit="tab-sms"]'))) && !!(await evaluate(send, q('[data-audit="tab-email"]'))))
  step('默认落在手机号表单', !!(await evaluate(send, vis('[data-audit="login-phone"]'))) && !(await evaluate(send, vis('[data-audit="email-submit"]'))))

  /* 非法手机号 */
  await type('[data-audit="login-phone"]', '12345')
  await click('[data-audit="sms-send"]')
  await sleep(500)
  step('非法手机号报错', /请输入正确的手机号/.test(await evaluate(send, text('[data-audit="sms-error"]'))))

  /* 合法手机号发码 → 倒计时 */
  await type('[data-audit="login-phone"]', PHONE)
  await click('[data-audit="sms-send"]')
  await sleep(500)
  step('发码成功进入倒计时', /后重发/.test(await evaluate(send, text('[data-audit="sms-send"]'))))
  await shot(send, 'sms-countdown')

  /* 错误验证码 */
  await type('[data-audit="login-sms-code"]', '000000')
  await click('[data-audit="sms-submit"]')
  await sleep(600)
  step('错误验证码报「验证码不正确」', /验证码不正确/.test(await evaluate(send, text('[data-audit="sms-error"]'))))

  /* 正确验证码 → 登录成功 */
  await type('[data-audit="login-sms-code"]', SMS_CODE)
  await click('[data-audit="sms-submit"]')
  await sleep(1200)
  const tokens = await evaluate(send, `JSON.parse(localStorage.getItem('douwan-user-tokens') || '{}')`)
  step('登录成功：弹窗关闭', !(await evaluate(send, `!!document.querySelector('[data-audit="login-dialog"]')`)))
  step('登录成功：令牌落库', !!(tokens && tokens.access_token))
  const me = await evaluate(send, `(async () => {
    const t = JSON.parse(localStorage.getItem('douwan-user-tokens') || '{}')
    const r = await fetch('/api/v1/users/me', { headers: { Authorization: 'Bearer ' + t.access_token } })
    return (await r.json()).data
  })()`, { awaitPromise: true })
  step('登录用户资料带手机号', me && me.user && me.user.phone === PHONE, me && me.user ? me.user.phone : '')

  /* 切邮箱页签（重新开一次弹窗，先清登录态让登录按钮回来） */
  await evaluate(send, `localStorage.clear()`)
  await openLoginDialog(send)
  await click('[data-audit="tab-email"]')
  await sleep(300)
  step('切邮箱页签后邮箱表单显示', !!(await evaluate(send, vis('[data-audit="email-submit"]'))) && !(await evaluate(send, vis('[data-audit="login-phone"]'))))
  await shot(send, 'sms-tabs-email')

  return { checks, consoleErrors }
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/index.html 不存在，请先构建')
    process.exit(1)
  }
  fs.mkdirSync(OUT, { recursive: true })

  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge')
    process.exit(1)
  }
  const debugPort = 9222 + (process.pid % 500)
  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'sms-login-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crashpad',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let version = null
  for (let i = 0; i < 80; i++) {
    try { version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.json()); break } catch { await sleep(250) }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪')
    chrome.kill()
    process.exit(1)
  }
  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready

  let failed = 0
  for (const scenario of [{ disabled: false }, { disabled: true }]) {
    console.log(scenario.disabled ? '场景 B：服务端未配置短信' : '场景 A：服务端已配置短信')
    let mock = startMock(scenario.disabled)
    if (!(await waitMock())) {
      console.error('mock 服务没起来\n' + mock.err())
      mock.child.kill()
      chrome.kill()
      process.exit(1)
    }
    const { checks, consoleErrors } = await runScenario(browser, scenario)
    for (const c of checks) if (!c.ok) failed++
    const consoleBad = consoleErrors.filter(e => !/favicon/.test(e))
    if (consoleBad.length) {
      console.log(`    ✗ console 报错 ${consoleBad.length} 条`)
      for (const e of consoleBad.slice(0, 5)) console.log('      ' + e.slice(0, 200))
      failed++
    } else {
      console.log('    ✓ console 报错 0 条')
    }
    mock.child.kill()
    await sleep(400)
  }

  browser.close()
  chrome.kill()
  console.log(failed === 0 ? '\n全部通过' : `\n失败 ${failed} 项`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
