(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = {}

  location.hash = '#/admin/users'
  await sleep(1600)

  out.hash = location.hash
  out.pageText = document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)

  const detailBtn = [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === '查看详情')
  out.detailButton = !!detailBtn
  if (!detailBtn) return { ok: false, err: '用户列表没有渲染出「查看详情」', checks: out }

  detailBtn.click()
  await sleep(900)

  const modal = document.querySelector('.adm-modal__body')
  out.modalOpened = !!modal
  if (!modal) return { ok: false, err: '用户详情弹窗没有打开', checks: out }

  out.modalText = modal.textContent.replace(/\s+/g, ' ').trim()
  out.hasLoginMethod = out.modalText.includes('登录方式')
  out.hasQQ = out.modalText.includes('QQ')
  out.hasMaskedOpenID = /open\*{4}view/.test(out.modalText)
  out.hasBoundAt = out.modalText.includes('绑定于')

  return {
    ok: out.hash.startsWith('#/admin/users') && out.detailButton && out.modalOpened &&
      out.hasLoginMethod && out.hasQQ && out.hasMaskedOpenID && out.hasBoundAt,
    checks: out
  }
})()
