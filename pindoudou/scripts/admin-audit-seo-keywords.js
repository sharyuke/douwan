/* =========================================================================
   后台「关键词管理」标签页的端到端探针
   -------------------------------------------------------------------------
   给 scripts/admin-audit.cjs 用（ADMIN_EVAL_FILE + ADMIN_EVAL_PAGE=admin-seo）。

   它在真实浏览器里把关键词管理的主要流程走一遍：
     切标签 → 看列表 → 看「暂无数据」口径 → 看三个诊断面板
     → 筛分组 → 新增 → 校验 → 删除 → 校验

   新增的关键词用的是固定名字「自检临时关键词」，跑完一定删掉；
   万一上次跑崩了没删干净，删除那一步会先按名字找到并删掉。
   ========================================================================= */
(async () => {
  const steps = []
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const q = sel => document.querySelector(sel)
  const qa = sel => Array.from(document.querySelectorAll(sel))
  const text = el => (el && el.textContent ? el.textContent.trim() : '')
  const TEMP = '自检临时关键词'

  function setInput(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function setSelect(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function waitFor(fn, timeout = 6000, step = 60) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const v = fn()
      if (v) return v
      await sleep(step)
    }
    return null
  }

  /* 关键词表格（列表）与布局表格要分开数，所以给表格加了 data-audit 标记 */
  const kwTable = () => q('[data-audit="seo-keywords-table"]')
  const kwRows = () => {
    const t = kwTable()
    return t ? t.querySelectorAll('.adm-table tbody tr').length : 0
  }
  /* 关键词表格里包含指定关键词的那一行 */
  const kwRow = () => {
    const t = kwTable()
    if (!t) return null
    return Array.from(t.querySelectorAll('.adm-table tbody tr')).find(tr => text(tr).includes(TEMP)) || null
  }

  /* 1. 切到「关键词管理」标签 */
  const chip = qa('.adm-chip').find(el => text(el).includes('关键词管理'))
  if (!chip) {
    return { ok: false, steps: [{ name: '找到「关键词管理」标签', pass: false, detail: '标签不存在' }] }
  }
  chip.click()
  const on = await waitFor(() => {
    const c = q('.adm-chip.on')
    return c && text(c).includes('关键词管理') ? c : null
  })
  steps.push({ name: '切到「关键词管理」标签', pass: !!on, detail: on ? text(on) : '标签没有变成选中态' })
  if (!on) return { ok: false, steps }

  await sleep(1200)

  /* 2. 关键词列表有数据 */
  const firstTableRows = await waitFor(() => {
    const n = kwRows()
    return n > 0 ? n : null
  })
  steps.push({ name: '关键词列表加载出数据', pass: !!firstTableRows, detail: (firstTableRows || 0) + ' 行' })

  /* 3. 搜索表现口径：没有数据源时必须显示「暂无数据」，不能出现假数字 */
  const bodyText = () => document.body.innerText
  steps.push({
    name: '未接数据源时显示「暂无数据」',
    pass: bodyText().includes('暂无数据'),
    detail: ''
  })

  /* 4. 分组 / 状态计数要真的有数字（曾经错读 meta 接口导致全是 0） */
  const groupCard = qa('.adm-card').find(card => text(card).includes('关键词分组（三层策略）'))
  const groupTags = groupCard ? Array.from(groupCard.querySelectorAll('.adm-tag')).map(t => text(t)) : []
  const groupOk = groupTags.length === 3 && groupTags.every(t => Number(t) > 0)
  steps.push({ name: '分组计数有真实数字', pass: groupOk, detail: groupTags.join(' / ') })

  /* 5. 三个诊断面板都在 */
  const panels = ['核心搜索意图冲突', '页面字段自检', '优化候选']
  const missingPanels = panels.filter(p => !bodyText().includes(p))
  steps.push({
    name: '三个诊断面板都在',
    pass: missingPanels.length === 0,
    detail: missingPanels.join('、')
  })

  /* 6. 关键词 ↔ 页面对应表（布局总览）有 16 个目标页 */
  const layout = q('[data-audit="seo-keywords-layout"]')
  const layoutCount = layout ? layout.querySelectorAll('.adm-table tbody tr').length : 0
  steps.push({ name: '关键词与页面对应表有目标页', pass: layoutCount >= 16, detail: layoutCount + ' 行' })

  /* 7. 按分组筛选：选「教程与专业功能词」后行数应变少 */
  const groupSelect = qa('.adm-toolbar select')[0]
  const before = kwRows()
  if (groupSelect) {
    setSelect(groupSelect, 'tutorial')
    await sleep(1000)
    const after = kwRows()
    steps.push({
      name: '按分组筛选生效',
      pass: after > 0 && after < before,
      detail: before + ' → ' + after
    })
    setSelect(groupSelect, '')
    await sleep(800)
  } else {
    steps.push({ name: '按分组筛选生效', pass: false, detail: '找不到分组下拉' })
  }

  /* 8. 先把可能残留的同名数据清掉（上一轮跑崩时留下的） */
  const searchInput = () => qa('.adm-toolbar input[type="search"]')[0]
  /* 搜索框是 v-model + 回车/「查询」才发请求，所以改完值要点「查询」 */
  async function searchKw(term) {
    const input = searchInput()
    if (!input) return
    setInput(input, term)
    const btn = qa('button').find(b => text(b) === '查询')
    if (btn) btn.click()
    else input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await sleep(1100)
  }
  async function cleanupTemp() {
    await searchKw(TEMP)
    const row = kwRow()
    if (!row) return false
    const btn = Array.from(row.querySelectorAll('button')).find(b => text(b) === '删除')
    if (!btn) return false
    btn.click()
    const delModal = await waitFor(() => q('.adm-modal__panel'))
    const ok = delModal
      ? Array.from(delModal.querySelectorAll('button')).find(b => text(b) === '删除')
      : null
    if (!ok) return false
    ok.click()
    const gone = await waitFor(() => !bodyText().includes(TEMP), 9000)
    return !!gone
  }
  const preClean = await cleanupTemp()
  steps.push({ name: '清理残留的临时关键词', pass: true, detail: preClean ? '清掉了残留' : '没有残留' })
  await searchKw('')

  /* 9. 新增关键词 */
  const addBtn = qa('button').find(b => text(b).includes('新增关键词'))
  if (!addBtn) {
    steps.push({ name: '打开「新增关键词」弹窗', pass: false, detail: '找不到按钮' })
    return { ok: false, steps }
  }
  addBtn.click()
  const modal = await waitFor(() => q('.adm-modal__panel'))
  steps.push({ name: '打开「新增关键词」弹窗', pass: !!modal, detail: modal ? '' : '弹窗没出现' })
  if (!modal) return { ok: false, steps }

  const mBody = modal.querySelector('.adm-modal__body')
  const mInputs = mBody.querySelectorAll('input.adm-input')
  const mSelects = mBody.querySelectorAll('select.adm-select')
  setInput(mInputs[0], TEMP)
  setSelect(mSelects[0], '/colors/')
  setSelect(mSelects[1], 'tutorial')
  setSelect(mSelects[2], 'info')
  await sleep(250)

  const saveBtn = Array.from(modal.querySelectorAll('button')).find(b => text(b) === '保存')
  if (!saveBtn) {
    steps.push({ name: '提交新增关键词', pass: false, detail: '找不到保存按钮' })
    return { ok: false, steps }
  }
  saveBtn.click()
  await sleep(1200)
  /* 列表默认按优先级排序、每页 20 条，新加的词不一定在第一页 —— 用搜索框定位它 */
  await searchKw(TEMP)
  const appeared = await waitFor(() => {
    const row = kwRow()
    return row && text(row).includes(TEMP) ? row : null
  }, 9000)
  steps.push({ name: '新增的关键词出现在列表里', pass: !!appeared, detail: appeared ? '' : '等不到新关键词' })

  /* 10. 删除刚加的那条 */
  const row = kwRow()
  const delBtn = row ? Array.from(row.querySelectorAll('button')).find(b => text(b) === '删除') : null
  if (delBtn) {
    delBtn.click()
    const delModal = await waitFor(() => q('.adm-modal__panel'))
    const delOk = delModal
      ? Array.from(delModal.querySelectorAll('button')).find(b => text(b) === '删除')
      : null
    if (delOk) delOk.click()
    const gone = await waitFor(() => !bodyText().includes(TEMP), 9000)
    steps.push({ name: '删除后列表里不再出现', pass: !!gone, detail: gone ? '' : '还在列表里' })
  } else {
    steps.push({ name: '删除后列表里不再出现', pass: false, detail: '找不到那一行的删除按钮' })
  }
  setInput(searchInput(), '')
  await sleep(500)
  return { ok: steps.every(s => s.pass), steps }
})()
