/* 本机匿名身份 + 卡密兑换自检（需求 §3.3 / §3.4）：
   1. 未登录时输入卡密 → 自动创建本机匿名身份 → 服务端兑换成功 → 前台变成 Pro
   2. 模拟刷新（清掉令牌，用本机保存的匿名凭据重新登录）→ 身份与权益都还在
   3. 界面必须写清「清理浏览器数据 / 换设备可能无法恢复」
   用法：node scripts/audit.cjs --url http://127.0.0.1:5173 \
         --eval-file scripts/audit-device-redeem.js --page pricing */
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
  const UA = await d.userAccount()
  const B = await d.backend()

  const tabBtn = [...document.querySelectorAll('.billingSwitch button')]
    .find(b => b.textContent.trim() === '卡密兑换')
  if (!tabBtn) return { ok: false, err: '找不到「卡密兑换」标签' }
  tabBtn.click()
  await sleep(200)

  const warning = (document.querySelector('.redeemPanel')?.textContent || '').replace(/\s+/g, ' ')
  const input = document.querySelector('.redeemCode')
  if (!input) return { ok: false, err: '找不到卡密输入框' }
  input.value = 'TEST-1234'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const submit = [...document.querySelectorAll('.redeemPanel button')]
    .find(b => b.textContent.includes('立即兑换'))
  if (!submit) return { ok: false, err: '找不到兑换按钮' }
  submit.click()

  const resultEl = await wait(() => document.querySelector('.redeemResult'))
  const afterRedeem = {
    兑换结果: resultEl ? resultEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
    身份标签: (document.querySelector('.identityTag') || {}).textContent?.trim() || '',
    是匿名身份: UA.isAnonymousDevice.value,
    服务端已确认: M.entitlementVerified.value,
    isPro: M.isPro.value,
    权益列表行数: document.querySelectorAll('.redeemMine__row').length,
    本机凭据已保存: !!localStorage.getItem('douzao-device-account'),
    恢复提示: /清理浏览器数据|换设备/.test(warning)
  }

  /* 模拟刷新：令牌清掉，本机匿名凭据还在 → 重新登录并同步权益 */
  await UA.logout()
  const afterLogout = { isPro: M.isPro.value }
  const restored = await UA.bootstrapDevice()
  await B.syncServerEntitlements()
  const afterReload = {
    恢复的用户: restored ? (restored.nickname || restored.username) : '',
    是匿名身份: UA.isAnonymousDevice.value,
    服务端已确认: M.entitlementVerified.value,
    isPro: M.isPro.value,
    套餐: M.planLabel.value
  }

  const ok = afterRedeem['身份标签'] === '本机匿名身份' &&
    afterRedeem['是匿名身份'] === true &&
    afterRedeem['服务端已确认'] === true &&
    afterRedeem.isPro === true &&
    afterRedeem['权益列表行数'] >= 1 &&
    afterRedeem['本机凭据已保存'] === true &&
    afterRedeem['恢复提示'] === true &&
    afterLogout.isPro === false &&
    afterReload['恢复的用户'] === '本机访客' &&
    afterReload['是匿名身份'] === true &&
    afterReload.isPro === true

  return { ok, checks: { afterRedeem, afterLogout, afterReload } }
})()
