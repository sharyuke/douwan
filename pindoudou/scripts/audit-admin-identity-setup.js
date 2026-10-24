(() => {
  try {
    localStorage.setItem('douwan-admin-tokens', JSON.stringify({
      access_token: 'audit-admin-access',
      refresh_token: 'audit-admin-refresh'
    }))
  } catch { /* ignore */ }
  return { ok: true }
})()
