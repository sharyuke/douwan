/* 套餐页真实接口自检：后端返回三档套餐 + 购买入口时，页面必须原样渲染。
   用法：node scripts/audit.cjs --eval-file scripts/audit-pricing-live.js --page pricing */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  await sleep(900)
  const cards = [...document.querySelectorAll('.planGrid .plan')].map(card => ({
    name: (card.querySelector('h3') || {}).textContent,
    price: (card.querySelector('.plan__price b') || {}).textContent,
    validity: (card.querySelector('.plan__price span') || {}).textContent,
    button: (card.querySelector('button') || {}).textContent
  }))
  const support = [...document.querySelectorAll('a')]
    .find(a => (a.getAttribute('href') || '').includes('example.com/shop'))
  const notice = document.querySelector('.boardInfo')
  const out = {
    ok: true,
    checks: {
      套餐卡片: cards,
      购买入口: support ? support.getAttribute('href') : '',
      购买说明: support ? support.textContent.trim() : '',
      支付说明: notice ? notice.textContent.trim() : ''
    }
  }
  if (cards.length !== 3) out.ok = false
  if (!support) out.ok = false
  return out
})()
