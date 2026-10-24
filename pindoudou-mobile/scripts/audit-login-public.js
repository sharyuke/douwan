(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  /* 记录邮箱注册 / 登录的请求体：setup 脚本只负责预置 localStorage，
     不会注入到被测页面，所以这层包装必须写在 eval 里。 */
  const authBodies = []
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (init && typeof init.body === 'string' && /\/auth\/(register|login)$/.test(String(url))) {
      try {
        authBodies.push({ path: new URL(String(url), location.origin).pathname, body: JSON.parse(init.body) })
      } catch { /* 非 JSON 请求体不记录 */ }
    }
    return realFetch(input, init)
  }

  /* 微信登录状态：服务端配置齐全时按钮可点，缺配置 / 应用未开通时禁用并说明原因 */
  let wechatStatus = null
  try {
    const res = await fetch('/api/v1/auth/oauth/wechat/status', { headers: { accept: 'application/json' } })
    const j = await res.json()
    out.wechatStatusCode = j && j.code
    wechatStatus = (j && j.data) || null
  } catch (e) {
    out.wechatStatusError = String((e && e.message) || e)
  }
  const expectBlocked = !!wechatStatus && (!wechatStatus.configured || (wechatStatus.checked && !wechatStatus.available))

  const loginBtn = document.querySelector('[data-audit="header-login"]')
  out.headerLogin = !!loginBtn
  if (!loginBtn) return { ok: false, err: '顶栏没有登录按钮', checks: out }

  const mobile = innerWidth <= 767
  out.mobile = mobile

  /* 不能真的跳去微信：把 /start 换成永不返回的请求，
     既能证明「点哪个按钮才会请求微信授权」，又不会把自检页面带走。 */
  let startCalls = 0
  const fetchAfterAuthLog = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (String(url).includes('/auth/oauth/wechat/start')) {
      startCalls += 1
      return new Promise(() => {})
    }
    return fetchAfterAuthLog(input, init)
  }

  loginBtn.click()
  await sleep(400)
  const dialog = document.querySelector('[data-audit="login-dialog"]')
  out.dialogOpened = !!dialog
  out.dialogMode = dialog ? dialog.getAttribute('data-mode') : ''
  out.startCallsOnOpen = startCalls
  if (!dialog) { window.fetch = realFetch; return { ok: false, err: '登录对话框没有打开', checks: out } }

  /* 两种入口：微信登录 + 邮箱表单。手机上不再有「复制链接 / 另一台手机扫码」引导。 */
  const wechat = dialog.querySelector('[data-audit="wechat-login"]')
  out.wechatPresent = !!wechat
  out.wechatText = wechat ? wechat.textContent.replace(/\s+/g, ' ').trim() : ''
  out.wechatNamedLogin = !!(wechat && wechat.querySelector('b') &&
    wechat.querySelector('b').textContent.trim() === '微信登录')
  out.providerCount = dialog.querySelectorAll('.loginProvider').length
  out.qqGone = !dialog.querySelector('[data-audit="qq-login"]') && !/QQ/.test(dialog.textContent || '')
  out.phoneGuidesGone = !dialog.querySelector('[data-audit="phone-scan-note"]') &&
    !dialog.querySelector('[data-audit="phone-copy-link"]') &&
    !dialog.querySelector('[data-audit="phone-scan-login"]')
  out.emailForm = !!dialog.querySelector('[data-audit="login-email"]') &&
    !!dialog.querySelector('[data-audit="login-password"]') &&
    !!dialog.querySelector('[data-audit="email-submit"]')
  out.emailDivider = !!dialog.querySelector('[data-audit="email-divider"]')

  if (mobile) {
    /* 手机：打开弹窗不请求 /start，点「微信登录」才请求一次 */
    if (wechat) {
      wechat.click()
      await sleep(300)
    }
    out.startCallsAfterWechat = startCalls
    window.fetch = realFetch
    return {
      ok: out.dialogMode === 'phone' && out.wechatPresent && out.wechatNamedLogin &&
        out.providerCount === 1 && out.qqGone && out.phoneGuidesGone &&
        out.emailForm && out.emailDivider &&
        out.startCallsOnOpen === 0 && out.startCallsAfterWechat === 1,
      checks: out
    }
  }

  /* 桌面 / 平板：微信按钮下面不再有扫码提示 */
  out.scanHintGone = !dialog.querySelector('[data-audit="wechat-scan-hint"]') &&
    !/长按识别/.test(dialog.textContent || '')

  for (let i = 0; i < 30; i++) {
    if (!dialog.querySelector('[data-audit="wechat-checking"]')) break
    await sleep(100)
  }
  const notice = dialog.querySelector('[data-audit="wechat-status"]')
  out.wechatDisabled = !!(wechat && wechat.disabled)
  out.wechatNoticeState = notice ? notice.getAttribute('data-state') : ''
  out.wechatNoticeText = notice ? notice.textContent.replace(/\s+/g, ' ').trim() : ''
  const blockedOk = !expectBlocked || (
    out.wechatDisabled && !!notice &&
    out.wechatNoticeState === (wechatStatus.configured ? 'blocked' : 'not-configured') &&
    /未配置|不可用/.test(out.wechatNoticeText)
  )
  const readyOk = expectBlocked || (!out.wechatDisabled && !notice)

  /* 邮箱登录：先用错误密码，确认请求体带的是邮箱、错误提示能显示 */
  function type(selector, value) {
    const el = dialog.querySelector(selector)
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  type('[data-audit="login-email"]', 'audit@example.com')
  type('[data-audit="login-password"]', 'wrongpass')
  dialog.querySelector('[data-audit="email-submit"]').click()
  await sleep(700)
  const emailErr = dialog.querySelector('[data-audit="email-error"]')
  out.loginErrorText = emailErr ? emailErr.textContent.replace(/\s+/g, ' ').trim() : ''
  const loginReq = authBodies.find(r => r.path === '/api/v1/auth/login')
  out.loginRequestBody = loginReq ? loginReq.body : null
  out.loginUsesEmail = !!(loginReq && loginReq.body.account === 'audit@example.com' && loginReq.body.password === 'wrongpass')

  /* 邮箱注册：切到注册模式，填 8 位以上密码，成功后弹窗关闭、顶栏不再显示登录 */
  dialog.querySelector('[data-audit="email-to-register"]').click()
  await sleep(150)
  out.registerMode = !!dialog.querySelector('[data-audit="email-to-login"]')
  type('[data-audit="login-password"]', 'audit12345')
  dialog.querySelector('[data-audit="email-submit"]').click()
  await sleep(1000)
  out.dialogClosedAfterRegister = !document.querySelector('[data-audit="login-dialog"]')
  out.headerLoginHidden = !document.querySelector('[data-audit="header-login"]')
  const regReq = authBodies.find(r => r.path === '/api/v1/auth/register')
  out.registerRequestBody = regReq ? regReq.body : null
  out.registerCarriesEmail = !!(regReq && regReq.body.email === 'audit@example.com' && regReq.body.password === 'audit12345')
  out.registerUsername = regReq ? regReq.body.username : ''
  out.registerUsernameFromEmail = /^audit[a-z0-9]*$/i.test(out.registerUsername) && out.registerUsername.length >= 5

  /* 回调错误页：微信配置缺失要能解释；老的 provider=qq 链接也不能白屏 */
  location.hash = '#/auth/callback?oauth_error=31001&provider=wechat&message=' + encodeURIComponent('微信登录暂未配置')
  await sleep(800)
  let callback = document.querySelector('[data-audit="auth-callback"]')
  out.callbackPresent = !!callback
  out.callbackStatus = callback ? callback.getAttribute('data-status') : ''
  out.callbackText = callback ? callback.textContent.replace(/\s+/g, ' ').trim() : ''

  location.hash = '#/auth/callback?oauth_error=31001&provider=qq&message=' + encodeURIComponent('QQ 登录暂未配置')
  await sleep(800)
  callback = document.querySelector('[data-audit="auth-callback"]')
  out.callbackLegacyPresent = !!callback
  out.callbackLegacyText = callback ? callback.textContent.replace(/\s+/g, ' ').trim() : ''

  window.fetch = realFetch
  /* 登录态只用于本次自检：清掉令牌，避免同一 Chrome profile 的后续视口一进来就是已登录 */
  try { localStorage.removeItem('douwan-user-tokens') } catch { /* 隐私模式忽略 */ }
  return {
    ok: out.dialogOpened && out.dialogMode === 'screen' &&
      out.wechatPresent && out.wechatNamedLogin && out.providerCount === 1 && out.qqGone &&
      out.phoneGuidesGone && out.emailForm && out.emailDivider &&
      out.startCallsOnOpen === 0 && out.scanHintGone && (blockedOk || readyOk) &&
      out.loginUsesEmail && /密码/.test(out.loginErrorText) &&
      out.registerMode && out.registerCarriesEmail && out.registerUsernameFromEmail &&
      out.dialogClosedAfterRegister && out.headerLoginHidden &&
      out.callbackPresent && out.callbackStatus === 'error' && /微信/.test(out.callbackText) &&
      out.callbackLegacyPresent && /QQ/.test(out.callbackLegacyText),
    checks: out
  }
})()
