(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = {}

  /* 等账号页把接口数据渲染出来 */
  for (let i = 0; i < 30 && !document.querySelector('[data-audit="account-auth"]'); i++) await sleep(120)

  const auth = document.querySelector('[data-audit="account-auth"]')
  out.authPresent = !!auth
  if (!auth) return { ok: false, err: '账号页的登录方式区块没有渲染', checks: out }

  out.authText = auth.textContent.replace(/\s+/g, ' ').trim()

  /* 前台只剩微信：账号页不能再出现 QQ 入口 */
  out.qqGone = !/QQ/.test(out.authText) && !auth.querySelector('[data-audit="account-bind-qq"]')

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

  /* 只有一条身份：解绑按钮必须禁用 */
  const unbind = [...auth.querySelectorAll('button')].find(b => b.textContent.trim() === '解绑')
  out.unbindDisabled = !!(unbind && unbind.disabled)

  /* 账号密码登录已下线：账号页只有微信一种方式 */
  out.passwordMethodGone = !/账号密码/.test(out.authText)

  /* 回调成功：令牌从地址栏抹掉，并给出「已创建账号」反馈 */
  location.hash = '#/auth/callback?access_token=audit-access-token&refresh_token=audit-refresh-token&provider=wechat&is_new=1'
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
    ok: out.authPresent &&
      /已绑定/.test(out.authText) && /审计拼豆工/.test(out.authText) &&
      /微信登录/.test(out.authText) && out.qqGone &&
      (out.wechatExpectBlocked ? /未配置|不可用/.test(out.wechatHint) : !out.wechatHint) &&
      out.headerLoginHidden && /审计拼豆工/.test(out.accountBtnText) &&
      out.unbindDisabled && out.passwordMethodGone &&
      out.callbackPresent && out.callbackStatus === 'success' &&
      /已创建豆玩账号/.test(out.callbackText) &&
      !out.tokensInURL && out.redirectedToAccount,
    checks: out
  }
})()
