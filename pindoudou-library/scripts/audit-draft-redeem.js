/* 「草稿套餐卡密」回归自检：
   绑定到未配置权益套餐的卡密，兑换后不能显示成 Pro，必须明确提示联系客服。
   这个场景来自一次线上问题：卡密绑到了草稿套餐，兑换显示成功但功能全锁。
   用法：node scripts/audit.cjs --url http://127.0.0.1:5173 \
         --eval-file scripts/audit-draft-redeem.js --page pricing */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const wait = async (fn, ms = 8000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const v = fn()
      if (v) return v
      await sleep(100)
    }
    return null
  }
  await sleep(900)
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const M = await d.membership()

  const tabBtn = [...document.querySelectorAll('.billingSwitch button')]
    .find(b => b.textContent.trim() === '卡密兑换')
  if (!tabBtn) return { ok: false, err: '找不到「卡密兑换」标签' }
  tabBtn.click()
  await sleep(200)

  const input = document.querySelector('.redeemCode')
  if (!input) return { ok: false, err: '找不到卡密输入框' }
  input.value = 'DRAFT-0000'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const submit = [...document.querySelectorAll('.redeemPanel button')]
    .find(b => b.textContent.includes('立即兑换'))
  if (!submit) return { ok: false, err: '找不到兑换按钮' }
  submit.click()

  const resultEl = await wait(() => document.querySelector('.redeemResult'))
  const text = resultEl ? resultEl.textContent.replace(/\s+/g, ' ').trim() : ''
  const checks = {
    结果文案: text.slice(0, 160),
    有未配置权益提示: /没有配置任何权益/.test(text),
    身份标签: (document.querySelector('.identityTag') || {}).textContent?.trim() || '',
    isPro: M.isPro.value,
    套餐: M.planLabel.value,
    PDF导出: M.check('export.pdf').ok,
    '40件存档': M.check('projects.limit', 40).ok
  }
  return {
    ok: checks['有未配置权益提示'] &&
      checks.isPro === false &&
      checks['PDF导出'] === false &&
      checks['40件存档'] === false,
    checks
  }
})()
