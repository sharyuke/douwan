/* 工具指引：停 2.5 秒后渐隐，并且不压住画笔 / 换色的下拉菜单。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-shortcut-tip.js --page editorProject
   视口只跑桌面：AUDIT_WIDTHS=desktop
*/
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = { ok: true, checks: {} }
  const fail = (k, v) => { out.ok = false; out.checks[k] = v }
  const rail = document.querySelector('.csRail')
  const paint = document.querySelector('[data-tool-key="paint"]')
  const arrow = document.querySelector('[data-tool-size="paint"]')
  if (!rail || !paint || !arrow) return { ok: false, err: '工具轨没找到' }

  const over = el => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  const box = el => {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1

  over(paint)
  await sleep(80)
  const tip = document.querySelector('[data-shortcut-tip]')
  if (!tip || !tip.textContent.includes('画笔')) fail('shown', tip && tip.textContent)
  else {
    const tr = box(tip)
    const rr = box(rail)
    if (tr.left < rr.right + 170) fail('offset', { tip: tr.left, rail: rr.right })
    if (tr.right > innerWidth + 1 || tr.top < 0) fail('inView', tr)
  }

  arrow.click()
  await sleep(80)
  const menu = document.querySelector('[data-brush-size]')
  const tip2 = document.querySelector('[data-shortcut-tip]')
  if (!menu) fail('menu', false)
  else if (tip2 && hit(box(tip2), box(menu))) fail('overlap', { tip: box(tip2), menu: box(menu) })

  await sleep(3100)
  if (document.querySelector('[data-shortcut-tip]')) fail('faded', true)
  over(paint)
  await sleep(60)
  if (document.querySelector('[data-shortcut-tip]')) fail('staysDismissed', true)

  rail.dispatchEvent(new MouseEvent('mouseleave'))
  await sleep(40)
  over(paint)
  await sleep(60)
  if (!document.querySelector('[data-shortcut-tip]')) fail('reshow', false)
  rail.dispatchEvent(new MouseEvent('mouseleave'))
  await sleep(40)
  if (document.querySelector('[data-shortcut-tip]')) fail('leaveHides', true)

  return out
})()
