/* 权益自检：
   - 临时免费开放期间：未登录也直接拿到全部已上线功能，isPro 按最高权益处理；
   - 恢复会员制后：本机缓存写成永久 Pro，isPro 仍必须是 false（没经过服务端确认），
     PDF 导出 / 40 件存档 / 三方案这些付费能力仍必须被拒绝。
   用法：node scripts/audit.cjs --setup-file scripts/audit-entitlement-setup.js \
         --eval-file scripts/audit-entitlement.js --page pricing */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  await sleep(900)
  const M = await window.__douzao.membership()
  const checks = {
    免费开放: !!M.ALL_FREE,
    本地缓存: JSON.parse(localStorage.getItem('douzao-membership') || '{}'),
    服务端已确认: M.entitlementVerified.value,
    isPro: M.isPro.value,
    PDF导出: M.check('export.pdf').ok,
    '40件存档': M.check('projects.limit', 40).ok,
    三方案: M.check('generate.variants', 3).ok,
    Credits: M.creditsBalance.value
  }
  const allFree = checks['免费开放']
  return {
    ok: allFree
      ? checks.isPro === true &&
        checks['PDF导出'] === true &&
        checks['40件存档'] === true &&
        checks['三方案'] === true &&
        checks.Credits === 0
      : checks.isPro === false &&
        checks['服务端已确认'] === false &&
        checks['PDF导出'] === false &&
        checks['40件存档'] === false &&
        checks['三方案'] === false &&
        checks.Credits === 0,
    checks
  }
})()
