(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = {}

  async function readStatus(provider) {
    try {
      const res = await fetch(`/api/v1/auth/oauth/${provider}/status`, { headers: { accept: 'application/json' } })
      const j = await res.json()
      out[`${provider}StatusCode`] = j && j.code
      return (j && j.data) || null
    } catch (e) {
      out[`${provider}StatusError`] = String((e && e.message) || e)
      return null
    }
  }
  function expectBlockedOf(status) {
    return !!status && (!status.configured || (status.checked && !status.available))
  }

  /* ① 顶栏登录入口 */
  const loginBtn = document.querySelector('[data-audit="header-login"]')
  out.headerLogin = !!loginBtn
  if (!loginBtn) return { ok: false, err: '顶栏没有登录按钮', checks: out }
  loginBtn.click()
  await sleep(350)

  const dialog = document.querySelector('[data-audit="login-dialog"]')
  out.dialogOpened = !!dialog
  if (!dialog) return { ok: false, err: '登录对话框没有打开', checks: out }

  /* ② 账号密码登录已下线：弹窗里只留微信 / QQ 两个入口，不能再出现密码框 */
  out.passwordFormGone = !dialog.querySelector('input[type="password"]')
  out.providerCount = dialog.querySelectorAll('.loginProvider').length

  /* ③ 两种登录方式的状态由服务端决定：
     not_configured / blocked(100008) 时必须禁用并说明原因；
     ready 时保持可用（但不真点，避免离开站点）。 */
  const [qqStatus, wechatStatus] = await Promise.all([readStatus('qq'), readStatus('wechat')])
  const qqExpectBlocked = expectBlockedOf(qqStatus)
  const wechatExpectBlocked = expectBlockedOf(wechatStatus)

  for (let i = 0; i < 30; i++) {
    const qqChecking = dialog.querySelector('[data-audit="qq-checking"]')
    const wxChecking = dialog.querySelector('[data-audit="wechat-checking"]')
    if (!qqChecking && !wxChecking) break
    await sleep(100)
  }

  const qq = dialog.querySelector('[data-audit="qq-login"]')
  out.qqPresent = !!qq
  out.qqDisabled = !!(qq && qq.disabled)
  const qqNotice = dialog.querySelector('[data-audit="qq-status"]')
  out.qqNoticeState = qqNotice ? qqNotice.getAttribute('data-state') : ''
  out.qqNoticeText = qqNotice ? qqNotice.textContent.replace(/\s+/g, ' ').trim() : ''

  const wechat = dialog.querySelector('[data-audit="wechat-login"]')
  out.wechatPresent = !!wechat
  out.wechatDisabled = !!(wechat && wechat.disabled)
  out.wechatText = wechat ? wechat.textContent.replace(/\s+/g, ' ').trim() : ''
  const wechatNotice = dialog.querySelector('[data-audit="wechat-status"]')
  out.wechatNoticeState = wechatNotice ? wechatNotice.getAttribute('data-state') : ''
  out.wechatNoticeText = wechatNotice ? wechatNotice.textContent.replace(/\s+/g, ' ').trim() : ''

  const beforeHash = location.hash
  if (qqExpectBlocked && qq) {
    qq.click()
    await sleep(400)
  }
  out.stayedOnPage = location.hash === beforeHash

  /* ③b 「重新检查」必须绕过缓存：点完要么仍不可用，要么立刻恢复可用。 */
  let recheckOk = true
  if (qqExpectBlocked) {
    const recheck = dialog.querySelector('[data-audit="qq-recheck"]')
    out.recheckPresent = !!recheck
    if (recheck) {
      recheck.click()
      let finished = false
      for (let i = 0; i < 120; i++) {
        const btn = dialog.querySelector('[data-audit="qq-recheck"]')
        if (!btn || !btn.disabled) { finished = true; break }
        await sleep(100)
      }
      const noticeAfter = dialog.querySelector('[data-audit="qq-status"]')
      const qqAfter = dialog.querySelector('[data-audit="qq-login"]')
      out.recheckFinished = finished
      out.recheckNoticeState = noticeAfter ? noticeAfter.getAttribute('data-state') : ''
      out.recheckQQDisabled = !!(qqAfter && qqAfter.disabled)
      recheckOk = finished && (
        (!!noticeAfter && out.recheckQQDisabled) ||
        (!noticeAfter && !out.recheckQQDisabled)
      )
    } else {
      recheckOk = false
    }
  }

  /* ④ 回调错误页：服务端把 oauth_error 带回来时，前端要能解释 */
  location.hash = '#/auth/callback?oauth_error=31001&provider=qq&message=' + encodeURIComponent('QQ 登录暂未配置')
  await sleep(800)
  let callback = document.querySelector('[data-audit="auth-callback"]')
  out.callback31001Present = !!callback
  out.callback31001Status = callback ? callback.getAttribute('data-status') : ''
  out.callback31001Text = callback ? callback.textContent.replace(/\s+/g, ' ').trim() : ''

  location.hash = '#/auth/callback?oauth_error=31007&provider=qq&message=' + encodeURIComponent('QQ 登录正在等待 QQ 互联开通（错误码 100008）。审核通过后会自动恢复，期间可以先使用微信登录。')
  await sleep(800)
  callback = document.querySelector('[data-audit="auth-callback"]')
  out.callback31007Present = !!callback
  out.callback31007Status = callback ? callback.getAttribute('data-status') : ''
  out.callback31007Text = callback ? callback.textContent.replace(/\s+/g, ' ').trim() : ''

  location.hash = '#/auth/callback?oauth_error=31001&provider=wechat&message=' + encodeURIComponent('微信登录暂未配置')
  await sleep(800)
  callback = document.querySelector('[data-audit="auth-callback"]')
  out.callbackWeChatPresent = !!callback
  out.callbackWeChatStatus = callback ? callback.getAttribute('data-status') : ''
  out.callbackWeChatText = callback ? callback.textContent.replace(/\s+/g, ' ').trim() : ''

  const qqBlockedOk = !qqExpectBlocked || (
    out.qqDisabled &&
    !!qqNotice &&
    out.qqNoticeState === (qqStatus.configured ? 'blocked' : 'not-configured') &&
    (qqStatus.configured ? /100008/.test(out.qqNoticeText) : /未配置/.test(out.qqNoticeText))
  )
  const qqReadyOk = qqExpectBlocked || (!out.qqDisabled && !qqNotice)

  const wechatBlockedOk = !wechatExpectBlocked || (
    out.wechatDisabled &&
    !!wechatNotice &&
    out.wechatNoticeState === (wechatStatus.configured ? 'blocked' : 'not-configured') &&
    /未配置|不可用/.test(out.wechatNoticeText)
  )
  const wechatReadyOk = wechatExpectBlocked || (!out.wechatDisabled && !wechatNotice)

  return {
    ok: out.headerLogin && out.dialogOpened && out.wechatPresent && out.passwordFormGone &&
      out.providerCount === 2 && out.qqPresent &&
      out.qqStatusCode === 0 && !!qqStatus &&
      out.wechatStatusCode === 0 && !!wechatStatus &&
      (qqBlockedOk || qqReadyOk) && (wechatBlockedOk || wechatReadyOk) &&
      out.stayedOnPage && recheckOk &&
      out.callback31001Present && out.callback31001Status === 'error' &&
      /暂未配置|登录没有完成/.test(out.callback31001Text) &&
      out.callback31007Present && out.callback31007Status === 'error' &&
      /100008|审核|开通/.test(out.callback31007Text) &&
      out.callbackWeChatPresent && out.callbackWeChatStatus === 'error' &&
      /微信|暂未配置|登录没有完成/.test(out.callbackWeChatText),
    checks: out
  }
})()
