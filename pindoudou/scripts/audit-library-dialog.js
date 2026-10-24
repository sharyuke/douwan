/* 素材预览弹窗视觉自检：打开第一张卡，停留在弹窗上供截图。
   用法：AUDIT_SHOT_AFTER_PROBE=1 AUDIT_WIDTHS=desktop,mobile \
         node scripts/audit.cjs --url http://127.0.0.1:4399 --page library \
         --eval-file scripts/audit-library-dialog.js */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  q('.mCard__media')?.click()
  await sleep(1400)
  return {
    open: !!q('.modal.show .dialog'),
    title: txt(q('.modal.show .dialog__head h2')),
    hasUse: !!q('.preview__actions .btn.primary'),
    hasFav: !!q('.preview__actions .btn'),
    bodyOverflow: document.body.style.overflow,
    modalOpacity: q('.modal.show') ? getComputedStyle(q('.modal.show')).opacity : '',
    dialogOpacity: q('.modal.show .dialog') ? getComputedStyle(q('.modal.show .dialog')).opacity : '',
    dialogH: q('.modal.show .dialog') ? Math.round(q('.modal.show .dialog').getBoundingClientRect().height) : 0,
    viewportH: innerHeight
  }
})()
