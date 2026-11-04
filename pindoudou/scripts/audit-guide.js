/* =========================================================================
   自检探针：工作台不再自动弹出新手指引
   用法：
     node scripts/audit.cjs --eval-file scripts/audit-guide.js --page editor --widths desktop,narrow3col,mobile

   2026-11-02：分步新手指引（EditorGuide）从最新版工作台卸掉。
   首次进入等过原来的弹出时间（900ms）之后，页面上不能再有 [data-guide]。
   ========================================================================= */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()

  const notice = document.querySelector('.modal.show')
  if (notice && /升级/.test(text(notice))) {
    const ack = [...notice.querySelectorAll('button')].find(b => /我知道了|继续使用/.test(text(b)))
    if (ack) ack.click()
    await sleep(400)
  }
  /* 旧版在挂载约 900ms 后弹出；多等一会儿，确认不会迟到出现 */
  await sleep(1600)
  const guide = document.querySelector('[data-guide]')
  if (guide) {
    console.error('新手指引仍会自动出现')
    throw new Error('新手指引仍会自动出现')
  }
  return { ok: true, guide: 'absent' }
})()
