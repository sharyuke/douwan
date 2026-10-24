/* 图片加载失败兜底：用 mock 返回一张不存在的图片，确认卡片不塌、占位文案出现。
   用法：node scripts/audit.cjs --url http://127.0.0.1:4400 \
         --eval-file scripts/audit-library-broken.js --page library */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  await sleep(500)
  const card = q('.mCard')
  const out = {
    cardCount: document.querySelectorAll('.mCard').length,
    first: txt(q('.mCard__name')),
    cardH: card ? Math.round(card.getBoundingClientRect().height) : 0,
    fallback: txt(q('.mCard__fallback')),
    imgCount: document.querySelectorAll('.mCard img').length,
    duplicateNames: (() => {
      const n = [...document.querySelectorAll('.mCard__name')].map(e => txt(e))
      return n.length !== new Set(n).size
    })()
  }
  q('.mCard__media')?.click()
  await sleep(600)
  out.dialogOpen = !!q('.modal.show .dialog')
  out.dialogFallback = txt(q('.preview__fallback'))
  out.dialogUse = !!q('.preview__actions .btn.primary')
  q('.preview__actions .btn.primary')?.click()
  await sleep(1800)
  out.afterUseOpen = !!q('.modal.show .dialog')
  out.afterUseHash = location.hash
  out.toast = txt(q('.toasts'))
  return out
})()
