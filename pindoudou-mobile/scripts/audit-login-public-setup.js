(() => {
  /* 每个视口都从「未登录」开始：上一个视口的邮箱登录会写入前台令牌 */
  try {
    localStorage.removeItem('douwan-user-tokens')
    localStorage.removeItem('douzao-device-account')
  } catch { /* 隐私模式忽略 */ }
  window.__auditCalls = []
  window.__auditAuthBodies = []
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const u = new URL(url, location.origin)
    const path = u.pathname
    window.__auditCalls.push(path)
    if (init && typeof init.body === 'string' && /^\/api\/v1\/auth\/(register|login)$/.test(path)) {
      try {
        window.__auditAuthBodies.push({ path, body: JSON.parse(init.body) })
      } catch { /* 非 JSON 请求体不记录 */ }
    }
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })

    if (path === '/api/v1/auth/oauth/wechat/start') {
      return reply({ code: 31001, message: '微信登录暂未配置，请联系管理员', data: null }, 503)
    }
    if (path === '/api/v1/plans') return reply({ code: 0, message: 'ok', data: [] })
    if (path === '/api/v1/settings/public' || path === '/api/v1/settings') {
      return reply({ code: 0, message: 'ok', data: { site_name: '豆玩', payment_ready: false } })
    }
    if (path === '/api/v1/users/me') {
      return reply({ code: 20001, message: '未登录', data: null }, 401)
    }
    return realFetch(input, init)
  }
})()
