/* =========================================================================
   自检探针：侧栏「创作」入口 + 收起 / 展开过渡
   用法：node scripts/audit.cjs --eval-file scripts/audit-nav.js --page home

   验四件事：
     1. 首页（电脑 / 平板）不放主导航，也不渲染左侧栏；
     2. 内页有左侧栏，「创作」指向工作台（#/editor），点进去真的落在工作台；
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
  const sideShown = () => {
    const el = sideEl()
    return !!el && getComputedStyle(el).display !== 'none'
  }
  const navShown = () => {
    const el = document.querySelector('.navlinks')
    return !!el && getComputedStyle(el).display !== 'none'
  }

  const vw = innerWidth
  const out = { vw }

  /* ---------- 首页：没有顶栏导航，也没有左侧栏 ---------- */
  location.hash = '#/'
  await sleep(800)
  out.home = {
    navShown: navShown(),
    sideRendered: !!sideEl(),
    overflowX: document.documentElement.scrollWidth > vw
  }

  /* ---------- 内页：侧栏存在，「创作」指向工作台 ---------- */
  location.hash = '#/library'
  await sleep(900)
  const side = sideEl()
  const creation = side && side.querySelector('.side__item')
  out.library = {
    sideShown: sideShown(),
    navShown: navShown(),
    width: side ? round(side.getBoundingClientRect().width) : null,
    stripWidth: side ? round(parseFloat(getComputedStyle(document.querySelector('.appBody--side'), '::before').width)) : null,
    creationHref: creation ? creation.getAttribute('href') : null,
    overflowX: document.documentElement.scrollWidth > vw
  }

  if (creation) {
    creation.click()
    await sleep(900)
    const s2 = sideEl()
    const active = s2 && s2.querySelector('.side__item.is-active')
    out.creationNav = {
      hash: location.hash,
      activeLabel: active ? active.textContent.trim() : null,
      workbench: !!document.querySelector('.studio'),
      sideWidth: s2 ? round(s2.getBoundingClientRect().width) : null
    }
    location.hash = '#/library'
    await sleep(900)
  }

  /* ---------- 收起 / 展开过渡 ---------- */
  const s3 = sideEl()
  const toggle = s3 && s3.querySelector('[data-audit="sidebar-toggle"]')
  out.library.hasToggle = !!toggle && getComputedStyle(toggle).display !== 'none'

  if (toggle) {
    const before = s3.getBoundingClientRect().width
    toggle.click()
    await sleep(120)
    const mid = s3.getBoundingClientRect().width
    await sleep(500)
    const after = s3.getBoundingClientRect().width
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
