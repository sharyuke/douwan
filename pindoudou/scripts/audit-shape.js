/* 图形工具已下线：电脑左栏、平板工具条、手机更多工具都不该再出现。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-shape.js --page editorProject
   视口：AUDIT_WIDTHS=desktop,tablet,mobile
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = { ok: true, width: innerWidth, checks: {} }
  const fail = (k, v) => { out.ok = false; out.checks[k] = v }
  const txt = el => (el ? (el.textContent || '').replace(/\s+/g, '') : '')
  if (!S.pattern.value) return { ok: false, err: '图案未就绪' }

  const confirm = document.querySelector('[data-confirm-board]')
  if (confirm && !confirm.disabled) {
    confirm.click()
    await sleep(400)
  }

  const hits = [...document.querySelectorAll('[data-tool-key="shape"], [data-shape-kind], [data-shape-menu], [data-shape-arrow]')]
  if (hits.length) fail('entry', hits.map(el => el.getAttribute('data-tool-key') || el.getAttribute('data-shape-kind') || el.className))

  const mobile = innerWidth <= 780
  const tablet = innerWidth > 780 && innerWidth < 1100
  if (mobile) {
    const more = [...document.querySelectorAll('.msTools .msTool')].find(b => txt(b) === '更多工具')
    if (!more || more.disabled) fail('moreBtn', more ? 'disabled' : 'missing')
    more?.click()
    await sleep(450)
    const groups = [...document.querySelectorAll('.msGroupTitle')].map(txt)
    if (groups.join(',') !== '辅助绘制,图纸处理') fail('groups', groups)
    if (document.querySelector('[data-shape-kind], [data-tool-key="shape"]')) fail('mobileShape', 'still-there')
    document.querySelector('.msSheet__head button')?.click()
  } else if (tablet) {
    if (document.querySelector('.editPanel [data-tool-key="shape"]')) fail('tabletBtn', 'still-there')
  } else {
    if (document.querySelector('.csRail [data-tool-key="shape"]')) fail('rail', 'still-there')
    const before = S.tool.value
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }))
    await sleep(20)
    if (S.tool.value !== before) fail('shortcut', { before, after: S.tool.value })
  }
  return out
})()
