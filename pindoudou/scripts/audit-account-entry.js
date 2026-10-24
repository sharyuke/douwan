/* 顶栏「个人中心」入口自检：
   - 桌面必须同时有单人图标和「个人中心」四个字
   - 手机上只留图标，且顶栏不能被挤出横向滚动
   - 点击真的能进 #/account
   用法：node scripts/audit.cjs --eval-file scripts/audit-account-entry.js --page home,editor */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  await sleep(300)
  const a = document.querySelector('.accountBtn')
  if (!a) return { ok: false, err: '找不到个人中心入口' }
  const label = a.querySelector('.accountBtn__label')
  const visible = el => !!el && getComputedStyle(el).display !== 'none'
  const r = a.getBoundingClientRect()
  const checks = {
    href: a.getAttribute('href'),
    文字: (label ? label.textContent : '').trim(),
    文字可见: visible(label),
    有图标: !!a.querySelector('svg'),
    按钮尺寸: `${Math.round(r.width)}×${Math.round(r.height)}`,
    按钮在视口内: r.left >= 0 && r.right <= innerWidth + 1,
    顶栏无横向溢出: document.documentElement.scrollWidth <= innerWidth + 1,
    视口宽度: innerWidth
  }
  a.click()
  await sleep(400)
  checks.跳转后路径 = location.hash

  const mobile = innerWidth <= 780
  const ok = checks['有图标'] &&
    checks['按钮在视口内'] &&
    checks['顶栏无横向溢出'] &&
    String(checks.跳转后路径).startsWith('#/account') &&
    (mobile ? checks['文字可见'] === false : (checks['文字可见'] === true && checks['文字'] === '个人中心'))
  return { ok, checks }
})()
