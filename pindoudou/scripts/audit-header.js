/* =========================================================================
   自检探针：顶栏「登录 / 个人中心」在所有页面位置一致
   用法：node scripts/audit.cjs --eval-file scripts/audit-header.js --page home

   为什么需要它：手机上主导航是隐藏的，中间没有 flex:1 的元素时，
   右侧操作区会紧跟 logo；而工作台 / 材料页有「创建 → 设计 → 完成」三步流程，
   它占满中间空间，把按钮顶到最右。结果是从「素材 / 作品」切到「材料 / 创作」
   时，登录与个人中心会横跳一百多像素。这里逐页量真实坐标：
     · 登录按钮、个人中心的 left 必须四页一致；
     · 操作区必须贴住顶栏右内边距（不随页面内容变化）。
   ========================================================================= */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const rect = el => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.left), right: Math.round(b.right), y: Math.round(b.top), w: Math.round(b.width) }
  }
  const measure = () => {
    const inner = document.querySelector('.topbar__in')
    const login = document.querySelector('[data-audit="header-login"]')
    const acct = document.querySelector('.accountBtn')
    const style = inner ? getComputedStyle(inner) : null
    return {
      hash: location.hash,
      inner: rect(inner),
      padRight: style ? Math.round(parseFloat(style.paddingRight) || 0) : 0,
      login: rect(login),
      acct: rect(acct)
    }
  }

  const routes = ['#/library', '#/projects', '#/materials', '#/editor']
  const rows = []
  for (const h of routes) {
    location.hash = h
    await sleep(800)
    rows.push(measure())
  }

  const missing = rows.filter(r => !r.login || !r.acct)
  if (missing.length) {
    return { ok: false, err: '顶栏登录 / 个人中心没有渲染', rows }
  }

  /* 同一元素在所有页面的 left 必须相同（1px 容差给亚像素取整） */
  const sameLeft = key => rows.every(r => Math.abs(r[key].x - rows[0][key].x) <= 1)
  /* 操作区贴右：个人中心右边缘 = 顶栏内右边缘 - paddingRight */
  const pinned = rows.every(r => Math.abs(r.inner.right - r.padRight - r.acct.right) <= 1)

  return {
    ok: sameLeft('login') && sameLeft('acct') && pinned,
    checks: {
      sameLoginX: sameLeft('login'),
      sameAccountX: sameLeft('acct'),
      pinnedRight: pinned,
      rows
    }
  }
})()
