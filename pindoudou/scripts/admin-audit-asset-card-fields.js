/* 后台素材编辑弹窗：确认「成品尺寸 / 点赞数」两个字段存在且带出当前值。
   用法：ADMIN_USER=... ADMIN_PASS=... ADMIN_API_BASE=https://dw.sharyuke.com \
         ADMIN_EVAL_FILE=scripts/admin-audit-asset-card-fields.js \
         node scripts/admin-audit.cjs */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const q = (s, root = document) => root.querySelector(s)
  const qa = (s, root = document) => [...root.querySelectorAll(s)]
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const steps = []
  const step = (name, pass, detail = '') => steps.push({ name, pass: !!pass, detail })

  try {
    location.hash = '#/admin/assets'
    for (let i = 0; i < 40 && !q('.adm-table tbody tr'); i++) await sleep(200)

    /* 先切一次「分类 / 素材」：让表格重新渲染一遍，避免刚进页面时
       第一帧的按钮还没接上 Vue 事件（自检里踩到过）。 */
    const tab = label => qa('button').find(b => txt(b) === label)
    if (tab('分类')) {
      tab('分类').click()
      await sleep(500)
      tab('素材').click()
      await sleep(500)
    }

    const rows = qa('.adm-table tbody tr')
    step('素材列表有数据', rows.length > 0, `rows=${rows.length}`)

    const editBtn = qa('button', rows[0]).find(b => txt(b) === '编辑')
    step('第一行有编辑按钮', !!editBtn, editBtn ? `disabled=${editBtn.disabled}` : 'missing')
    editBtn.click()
    for (let i = 0; i < 30 && !q('.adm-modal'); i++) await sleep(200)
    step('编辑弹窗打开', !!q('.adm-modal'))
    if (!q('.adm-modal')) return { ok: false, steps, err: '编辑弹窗没有出现', width: innerWidth }

    const modal = q('.adm-modal')
    const bodyText = txt(modal)
    step('有「成品尺寸（格）」字段', bodyText.includes('成品尺寸（格）'))
    step('有「点赞数」字段', bodyText.includes('点赞数'))

    const sizeInputs = qa('.adm-size input', modal)
    step('尺寸是两个数字框', sizeInputs.length === 2, `count=${sizeInputs.length}`)
    step('尺寸带出 52 × 52', sizeInputs.length === 2 && sizeInputs[0].value === '52' && sizeInputs[1].value === '52',
      sizeInputs.map(i => i.value).join(' × '))

    const likeInput = qa('input', modal).find(i => {
      const field = i.closest('.adm-field')
      return field && txt(q('label', field)) === '点赞数'
    })
    step('点赞数带出当前值', !!likeInput && Number(likeInput.value) > 0, likeInput ? likeInput.value : 'missing')

    const close = qa('button', q('.adm-modal__head', modal)).find(b => txt(b) === '关闭')
    if (close) close.click()
    await sleep(300)
    step('关闭编辑弹窗', !q('.adm-modal'))

    return { ok: steps.every(s => s.pass), steps, width: innerWidth }
  } catch (e) {
    return { ok: false, steps, err: e && e.message, stack: e && e.stack, width: innerWidth }
  }
})()
