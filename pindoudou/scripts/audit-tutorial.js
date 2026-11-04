/* 自检探针：工作台不再提供「新手教程」板块。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-tutorial.js --page editor
   断言：按钮文案 / aria / title 里都没有「新手教程」，教程弹窗也不在。
   找到残留时 console.error，让 audit.cjs 把这一页记成失败。 */
(async () => {
  const bits = [...document.querySelectorAll('button')].map(b =>
    `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''} ${b.textContent || ''}`)
  const hit = bits.filter(t => t.includes('新手教程'))
  const dialog = !!document.querySelector('[data-audit="tutorial-dialog"]')
  if (hit.length || dialog) {
    console.error('新手教程板块还在：' + (hit.slice(0, 3).join(' | ') || '教程弹窗'))
  }
  return { ok: !hit.length && !dialog, entries: hit.length, dialog, narrow: innerWidth <= 820 }
})()
