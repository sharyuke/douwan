/* =========================================================================
   自检探针：「免费素材」→「素材库」更名的 DOM 断言
   用法：node scripts/audit.cjs --eval-file scripts/audit-materials-rename.js \
         --page editor,account

   改名要钉住三件事：
     ① 工作台里指素材库的入口，文字就是「素材库」；
     ② 点开它弹出的素材弹窗，标题也是「素材库」；
     ③ 工作台与个人中心里不再出现「免费素材」这串旧文案。
   ========================================================================= */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const txt = el => (el ? (el.textContent || '').trim() : '')
  const studio = document.querySelector('.studio')
  const acct = document.querySelector('.ac')

  if (acct) {
    const body = acct.innerText || ''
    return {
      page: 'account',
      hasNew: /素材库/.test(body),
      hasOld: /免费素材/.test(body),
      ok: /素材库/.test(body) && !/免费素材/.test(body)
    }
  }
  if (!studio) return { page: 'unknown', ok: false, note: '页面既没有 .studio 也没有 .ac' }

  const cmd = studio.querySelector('.csCmd') || studio.querySelector('.msCmd')
  /* 桌面全屏工作台是 .csCmd 里的按钮；手机端是 .msCmd__materials；平板走老版面，
     入口在左栏的来源切换里。三处都找一遍。 */
  const btn = studio.querySelector('[data-console="materials"]') ||
              studio.querySelector('.msCmd__materials') ||
              [...studio.querySelectorAll('.sourceTabs button, .csSide button, .card button')]
                .find(b => txt(b) === '素材库')
  const label = txt(btn)

  btn && btn.click()
  await sleep(800)
  const dlgTitle = txt(document.querySelector('.dialog__title h2'))
  const closeBtn = document.querySelector('.dialog__head .iconbtn[aria-label="关闭"]')
  closeBtn && closeBtn.click()
  await sleep(250)

  const studioText = studio.innerText || ''
  return {
    page: 'editor',
    label,
    dlgTitle,
    cmdHasNew: /素材库/.test(txt(cmd)),
    studioHasOld: /免费素材/.test(studioText),
    ok: label === '素材库' && !/免费素材/.test(studioText) &&
        (dlgTitle === '' || dlgTitle === '素材库') &&
        (!cmd || /素材库/.test(txt(cmd)))
  }
})()
