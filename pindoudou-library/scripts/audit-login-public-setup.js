(() => {
  window.__auditCalls = []
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const u = new URL(url, location.origin)
    const path = u.pathname
    window.__auditCalls.push(path)
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })

    if (path === '/api/v1/auth/oauth/qq/start') {
      return reply({ code: 31001, message: 'QQ 登录尚未配置，请联系管理员', data: null }, 503)
    }
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
