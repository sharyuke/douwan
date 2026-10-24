(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = {}

  /* 等账号页把接口数据渲染出来 */
  for (let i = 0; i < 30 && !document.querySelector('[data-audit="account-auth"]'); i++) await sleep(120)

  const auth = document.querySelector('[data-audit="account-auth"]')
  const ent = document.querySelector('[data-audit="account-entitlement"]')
  out.authPresent = !!auth
  out.entPresent = !!ent
  if (!auth || !ent) return { ok: false, err: '账号页的登录方式 / 权益区块没有渲染', checks: out }

  out.authText = auth.textContent.replace(/\s+/g, ' ').trim()
  out.entText = ent.textContent.replace(/\s+/g, ' ').trim()
  out.entState = ent.getAttribute('data-state')

  /* QQ 未配置 / 应用未开通时，账号页也要说明原因。先读服务端状态，
     再等页面把状态渲染出来（ready 时不会出现提示）。 */
  let qqStatus = null
  try {
    const res = await fetch('/api/v1/auth/oauth/qq/status', { headers: { accept: 'application/json' } })
    const j = await res.json()
    qqStatus = j && j.data
  } catch { /* 状态接口失败时按「无提示」处理 */ }
  const qqExpectBlocked = !!qqStatus && (!qqStatus.configured || (qqStatus.checked && !qqStatus.available))
  let qqHint = null
  for (let i = 0; i < 15; i++) {
    qqHint = auth.querySelector('[data-audit="account-qq-status"]')
    if (qqHint || !qqExpectBlocked) break
    await sleep(100)
  }
  out.qqExpectBlocked = qqExpectBlocked
  out.qqHint = qqHint ? qqHint.textContent.replace(/\s+/g, ' ').trim() : ''

  /* 微信状态：配置齐全时显示「未绑定」，缺配置时同样要说明原因。 */
  let wechatStatus = null
  try {
    const res = await fetch('/api/v1/auth/oauth/wechat/status', { headers: { accept: 'application/json' } })
    const j = await res.json()
    wechatStatus = j && j.data
  } catch { /* 状态接口失败时按「无提示」处理 */ }
  const wechatExpectBlocked = !!wechatStatus && (!wechatStatus.configured || (wechatStatus.checked && !wechatStatus.available))
  let wechatHint = null
  for (let i = 0; i < 15; i++) {
    wechatHint = auth.querySelector('[data-audit="account-wechat-status"]')
    if (wechatHint || !wechatExpectBlocked) break
    await sleep(100)
  }
  out.wechatExpectBlocked = wechatExpectBlocked
  out.wechatHint = wechatHint ? wechatHint.textContent.replace(/\s+/g, ' ').trim() : ''

  /* 已登录账号：顶栏不再出现「登录」，个人中心显示昵称 */
  out.headerLoginHidden = !document.querySelector('[data-audit="header-login"]')
  const accountBtn = document.querySelector('.accountBtn')
  out.accountBtnText = accountBtn ? accountBtn.textContent.replace(/\s+/g, ' ').trim() : ''

  /* 没有密码 + 只有一条身份：解绑按钮必须禁用 */
  const unbind = [...auth.querySelectorAll('button')].find(b => b.textContent.trim() === '解绑')
  out.unbindDisabled = !!(unbind && unbind.disabled)

  /* 账号密码登录已下线：账号页只列微信 / QQ 两种方式 */
  out.passwordMethodGone = !/账号密码/.test(out.authText)

  /* 回调成功：令牌从地址栏抹掉，并给出「已创建账号」反馈 */
  location.hash = '#/auth/callback?access_token=audit-access-token&refresh_token=audit-refresh-token&provider=qq&is_new=1'
  await sleep(600)
  const callback = document.querySelector('[data-audit="auth-callback"]')
  out.callbackPresent = !!callback
  out.callbackStatus = callback ? callback.getAttribute('data-status') : ''
  out.callbackText = callback ? callback.textContent.replace(/\s+/g, ' ').trim() : ''
  out.hashAfterCallback = location.hash
  out.tokensInURL = /access_token=|refresh_token=/.test(location.hash)

  await sleep(1100)
  out.redirectedToAccount = location.hash.startsWith('#/account')

  return {
    ok: out.authPresent && out.entPresent &&
      /已绑定/.test(out.authText) && /审计拼豆工/.test(out.authText) &&
      /微信登录/.test(out.authText) &&
      (out.qqExpectBlocked ? /未配置|100008|审核|开通/.test(out.qqHint) : !out.qqHint) &&
      (out.wechatExpectBlocked ? /未配置|不可用/.test(out.wechatHint) : !out.wechatHint) &&
      out.entState === 'active' && /生效中/.test(out.entText) &&
      /一个月/.test(out.entText) && /2026-11-16/.test(out.entText) &&
      out.headerLoginHidden && /审计拼豆工/.test(out.accountBtnText) &&
      out.unbindDisabled && out.passwordMethodGone &&
      out.callbackPresent && out.callbackStatus === 'success' &&
      /已创建豆玩账号/.test(out.callbackText) &&
      !out.tokensInURL && out.redirectedToAccount,
    checks: out
  }
})()
