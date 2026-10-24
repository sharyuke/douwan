/* =========================================================================
   自检探针：首页顶栏导航 + 内页左侧栏的收起 / 展开
   用法：node scripts/audit.cjs --eval-file scripts/audit-nav.js --page home

   验四件事：
     1. 首页：主导航在顶栏（红框位置），左侧栏不渲染；
     2. 内页：顶栏不再有主导航，左侧栏出现；
     3. 收起 / 展开是滑动过渡：点下去 120ms 时宽度在两端之间，
        过渡结束后落在 72 / 208 两个档位；
     4. 展开到 208px 时页面没有横向溢出，左栏底色条与侧栏同宽。
   ========================================================================= */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const round = n => Math.round(n * 10) / 10
  const box = el => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.left), right: Math.round(b.right), w: round(b.width) }
  }
  const sideEl = () => document.querySelector('[data-audit="desktop-sidebar"]')
  const navEl = () => document.querySelector('.navlinks')
  const navShown = () => {
    const el = navEl()
    return !!el && getComputedStyle(el).display !== 'none'
  }
  const sideShown = () => {
    const el = sideEl()
    return !!el && getComputedStyle(el).display !== 'none'
  }

  const vw = innerWidth
  const out = { vw }

  /* ---------- 首页 ---------- */
  location.hash = '#/'
  await sleep(800)
  const nav = navEl()
  out.home = {
    navShown: navShown(),
    navItems: nav ? [...nav.querySelectorAll('.navlink')].map(a => a.textContent.trim()) : [],
    navBox: box(nav),
    sideRendered: !!sideEl(),
    overflowX: document.documentElement.scrollWidth > vw
  }

  /* ---------- 内页：默认档位 + 过渡 ---------- */
  location.hash = '#/library'
  await sleep(900)
  const side = sideEl()
  out.library = {
    sideShown: sideShown(),
    navShown: navShown(),
    width: side ? round(side.getBoundingClientRect().width) : null,
    stripWidth: side ? round(parseFloat(getComputedStyle(document.querySelector('.appBody--side'), '::before').width)) : null,
    overflowX: document.documentElement.scrollWidth > vw
  }

  const toggle = side && side.querySelector('[data-audit="sidebar-toggle"]')
  out.library.hasToggle = !!toggle && getComputedStyle(toggle).display !== 'none'

  if (toggle) {
    const before = side.getBoundingClientRect().width
    toggle.click()
    await sleep(120)
    const mid = side.getBoundingClientRect().width
    await sleep(500)
    const after = side.getBoundingClientRect().width
    const strip = parseFloat(getComputedStyle(document.querySelector('.appBody--side'), '::before').width)
    out.toggle = {
      before: round(before),
      mid: round(mid),
      after: round(after),
      animated: mid > Math.min(before, after) + 4 && mid < Math.max(before, after) - 4,
      stripMatches: Math.abs(strip - after) <= 1,
      overflowX: document.documentElement.scrollWidth > vw,
      contentX: box(document.querySelector('.appContent'))
    }

    /* 用户手动收起后切页面：应保留选择（电脑不再自动弹开） */
    const collapsed = after < 100
    location.hash = '#/projects'
    await sleep(800)
    const kept = sideEl().getBoundingClientRect().width
    out.persist = { collapsed, widthAfterNav: round(kept), kept: collapsed ? kept < 100 : kept > 200 }

    /* 还原成默认档位，避免影响同一视口里的后续截图 */
    const t2 = sideEl().querySelector('[data-audit="sidebar-toggle"]')
    if (t2) t2.click()
    await sleep(500)
  }

  return out
})()
