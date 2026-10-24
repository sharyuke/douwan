(() => {
  try {
    localStorage.setItem('douwan-user-tokens', JSON.stringify({
      access_token: 'audit-access-token',
      refresh_token: 'audit-refresh-token',
      expires_at: '2026-10-17T23:00:00+08:00'
    }))
  } catch { /* ignore */ }
  return { ok: true }
})()
