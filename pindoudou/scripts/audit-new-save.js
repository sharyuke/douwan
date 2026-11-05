/* 自检探针：新拖进来的图保存成新作品，不覆盖已打开的作品。
   用法：node scripts/audit.cjs --eval-file scripts/audit-new-save.js /editor
   （只想跑两档视口时加 AUDIT_WIDTHS=desktop,mobile）

   要钉住的行为：
     ① 第一次上传 + 点界面上的「保存」→ 1 件作品，地址变成 /editor/<id>；
     ② 再拖一张新图进来：与旧作品解除关联（currentProjectId 归空、状态回「未保存」），
        旧作品的本机存档逐字节不变；
     ③ 再点「保存」→ 第 2 件作品，旧作品仍在，名字 / 图纸 / 缩略图都没变；
     ③-2 在同一张画布上继续改再保存 → 更新第 2 件，不新建、地址不变；
     ③-3 手机顶栏「保存」对已保存的画布直接落盘，不再弹名字框；
     ④ 打开旧作品 → 它的图纸还是原来那张（不是新图）；
     ⑤ 回归：打开旧作品改一格再保存 → 仍是同一件作品，不新建、不动别的作品；
     ⑥ 打开旧作品后拖新图再保存 → 第 3 件作品，前两件都不受影响。

   注意：保存按钮走真实界面（桌面顶栏「保存」；手机顶栏「保存」），
   上传走真实的 file input change，不直接调 saveProject。 */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 20000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      const v = fn()
      if (v) return v
      await sleep(80)
    }
    return null
  }
  const out = { ok: true, steps: [] }
  const step = (name, pass, info) => {
    out.steps.push({ name, pass, info: info || '' })
    if (!pass) out.ok = false
  }
  const pat = () => S.pattern.value
  const isVisible = el => !!el && el.offsetParent !== null

  /* 升级公告（2026-11-01）首次进入会盖一层弹窗：先关掉，否则「更多」里的保存流程点不到 */
  const notice = document.querySelector('.modal.show')
  if (notice && /升级/.test(String(notice.textContent || ''))) {
    const ack = [...notice.querySelectorAll('button')].find(b => /我知道了|继续使用/.test(String(b.textContent || '')))
    if (ack) ack.click()
    await sleep(600)
  }
  const rawList = () => {
    try { return JSON.parse(localStorage.getItem('douzao-projects-v2') || '[]') } catch { return [] }
  }
  const recOf = id => rawList().find(p => p && p.id === id) || null
  const recText = id => {
    const r = recOf(id)
    return r ? JSON.stringify(r) : ''
  }
  /* 图纸指纹：宽高 + 色号数 + 豆子数 + 逐格 FNV 哈希（比较「还是不是同一张图」） */
  const sig = p => {
    if (!p) return ''
    let h = 2166136261
    for (let i = 0; i < p.cells.length; i++) {
      h ^= p.cells[i]
      h = Math.imul(h, 16777619)
    }
    return `${p.width}x${p.height}:${p.palette.length}色:${p.stats.beadCount}颗:${(h >>> 0).toString(16)}`
  }

  const M = await d.membership()
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  /* 保存要绑定账号（未登录会先弹登录框）。这个探针只验「换图 = 新作品」，
     不测登录流程，所以直接给一个已登录身份，别让登录框把保存拦下来。 */
  const U = await d.userAccount()
  U.currentUser.value = { id: 'probe-user', username: 'probe-user', nickname: '自检账号' }
  S.options.removeBg = false

  /* 从干净状态开始：同一 Chrome profile 在各视口之间共享 localStorage */
  for (const p of S.projects.value.slice()) S.deleteProject(p.id)
  await sleep(150)
  step('起点没有作品', S.projects.value.length === 0, `${S.projects.value.length} 件`)

  /** 造一张纯色 + 角标的图，经真实 file input 载入 */
  async function upload(name, color, mark) {
    const w = 320
    const h = 320
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d')
    cx.fillStyle = color
    cx.fillRect(0, 0, w, h)
    cx.fillStyle = '#FFFFFF'
    cx.beginPath()
    cx.arc(w * mark, h * 0.5, w * 0.18, 0, Math.PI * 2)
    cx.fill()
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'))
    const file = new File([blob], `${name}.png`, { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const input = document.querySelector('input[type=file]:not(.libFile)')
    if (!input) return false
    const before = pat()
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return !!(await waitFor(() => pat() && pat() !== before && pat().width > 0))
  }

  /** 点界面上的保存（全屏工作台顶栏 / 手机工作台顶栏 / 旧版画布标题栏 / 手机更多抽屉） */
  async function saveViaUI() {
    const bar = [...document.querySelectorAll('.csActions button, .msTop .msPill, .canvasTitleBar button')]
      .find(b => isVisible(b) && b.textContent.trim() === '保存')
    if (bar) {
      bar.click()
      await sleep(250)
      return '顶栏保存'
    }
    const more = [...document.querySelectorAll('.quickItem')].find(b => /更多/.test(b.textContent))
    if (!more) return ''
    more.click()
    await sleep(320)
    const item = [...document.querySelectorAll('.moreItem')].find(b => /保存作品/.test(b.textContent))
    if (!item) return ''
    item.click()
    await sleep(320)
    const dlg = document.querySelector('.modal.show .dialog')
    if (!dlg) return ''
    const ok = [...dlg.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')
    if (!ok || ok.disabled) return ''
    ok.click()
    await sleep(320)
    return '更多 → 保存作品'
  }

  /* ---------------------------------------------------- ① 第一件作品：上传 + 保存 */
  step('上传第一张图', await upload('probe-old', '#E4572E', 0.5))
  const first = pat()
  const how1 = await saveViaUI()
  step('界面保存可用', !!how1, how1)
  const idA = await waitFor(() => S.currentProjectId.value, 8000)
  step('保存后是 1 件作品', S.projects.value.length === 1, `${S.projects.value.length} 件`)
  step('保存后地址指向该作品', idA && location.pathname === `/editor/${idA}`, location.pathname)
  const recA0 = recText(idA)
  const aSig = sig(first)
  step('旧作品已落盘', !!recA0 && recA0.length > 100, `${recA0.length} 字符 / ${aSig}`)

  /* ------------------------------------------- ② 新拖一张图：与旧作品解除关联 */
  step('上传第二张图', await upload('probe-new', '#2F6FB4', 0.3))
  step('新图不再挂在旧作品上', S.currentProjectId.value === '', `currentProjectId=${S.currentProjectId.value || '空'}`)
  step('状态回到「未保存」', S.saveStatus.value === '未保存', S.saveStatus.value)
  /* 换图 = 新建画布：地址也收回 /editor，不再停在 /editor/<旧作品> */
  step('换图后地址是新建画布', location.pathname === '/editor', location.pathname)
  step('旧作品存档逐字节未变', recText(idA) === recA0)
  step('新图还没进任何作品', S.projects.value.length === 1, `${S.projects.value.length} 件`)

  /* --------------------------------------------------- ③ 保存新图：另建一件 */
  const second = pat()
  const how2 = await saveViaUI()
  const idB = await waitFor(() => S.currentProjectId.value, 8000)
  await waitFor(() => idB && location.pathname === `/editor/${idB}`, 4000)
  step('第二次界面保存可用', !!how2, how2)
  step('保存后是 2 件作品', S.projects.value.length === 2, `${S.projects.value.length} 件`)
  step('新作品是新 id', !!idB && idB !== idA, `${idA} → ${idB}`)
  step('保存后地址指向新作品', location.pathname === `/editor/${idB}`, location.pathname)
  const recA1 = recText(idA)
  step('旧作品仍在且未被改写', !!recA1 && recA1 === recA0)
  const recB = recOf(idB)
  step('新作品用新图的名字', !!recB && recB.name === 'probe-new', recB && recB.name)
  step('新作品带的是新图的图纸', !!recB && sig(second) !== aSig && sig(pat()) === sig(second),
    `${sig(second)}（旧 ${aSig}）`)

  /* ------------------- ③-2 同一张画布继续改再保存：更新这一件，不再新建 */
  const beforeReSaveAt = (recOf(idB) || {}).updatedAt || 0
  step('在同一张画布上继续改一格', S.paintAt(1, 1))
  await sleep(120)
  const howReSave = await saveViaUI()
  await waitFor(() => (recOf(idB) || {}).updatedAt > beforeReSaveAt, 6000)
  step('同一张画布再保存仍用界面保存', !!howReSave, howReSave)
  step('同一张画布再保存还是这一件', S.projects.value.length === 2 && S.currentProjectId.value === idB,
    `${S.projects.value.length} 件 / ${S.currentProjectId.value}`)
  step('同一张画布保存写入最新状态', (recOf(idB) || {}).updatedAt > beforeReSaveAt,
    `${beforeReSaveAt} → ${(recOf(idB) || {}).updatedAt}`)
  step('同一张画布保存后地址不变', location.pathname === `/editor/${idB}`, location.pathname)

  /* ------- ③-3 手机顶栏「保存」：已保存的画布直接落盘，不再问名字 ------- */
  if (document.querySelector('.msTop')) {
    const beforeMenuAt = (recOf(idB) || {}).updatedAt || 0
    S.paintAt(2, 2)
    await sleep(120)
    const topSave = [...document.querySelectorAll('.msTop .msPill')]
      .find(b => isVisible(b) && b.textContent.trim() === '保存')
    if (topSave) topSave.click()
    await sleep(900)
    const nameDlg = [...document.querySelectorAll('.modal.show .dialog')].find(d => /保存作品/.test(d.textContent))
    step('手机顶栏「保存」对已保存的画布直接保存（不再问名字）',
      !!topSave && !nameDlg && (recOf(idB) || {}).updatedAt > beforeMenuAt,
      `${beforeMenuAt} → ${(recOf(idB) || {}).updatedAt}`)
    if (nameDlg) {
      const cancel = [...nameDlg.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')
      if (cancel) cancel.click()
      await sleep(300)
    }
  }

  /* 这一件刚被 ③-2 / ③-3 更新过，后面「别的作品没被顺手改写」要拿这一刻的存档做基线 */
  const recBAfter = recText(idB)

  /* --------------------------------------- ④ 打开旧作品：图纸还是原来那张 */
  step('打开旧作品', S.openProject(idA))
  await sleep(200)
  const back = pat()
  step('旧作品图纸未变', sig(back) === aSig, `${sig(back)}（原 ${aSig}）`)
  step('旧作品名字未变', S.projectName.value === 'probe-old', S.projectName.value)

  /* ----------------------------- ⑤ 回归：改一格再保存，仍更新同一件作品 */
  const beforeEditAt = (recOf(idA) || {}).updatedAt || 0
  step('在旧作品上改一格', S.paintAt(0, 0))
  await sleep(120)
  const how3 = await saveViaUI()
  await waitFor(() => S.currentProjectId.value === idA && (recOf(idA) || {}).updatedAt > beforeEditAt, 6000)
  const recA2 = recOf(idA) || {}
  step('改完保存仍是同一件作品', S.projects.value.length === 2 && S.currentProjectId.value === idA,
    `${S.projects.value.length} 件 / ${S.currentProjectId.value}`)
  step('旧作品确实被更新了', (recA2.updatedAt || 0) > beforeEditAt, `${beforeEditAt} → ${recA2.updatedAt}`)
  step('别的作品没被顺手改写', recText(idB) === recBAfter)

  /* --------------------- ⑥ 打开旧作品后拖新图：再保存应另建第 3 件 */
  const recA3 = recText(idA)
  step('打开旧作品后上传第三张图', await upload('probe-third', '#3FA06A', 0.7))
  step('第三张图同样解除关联', S.currentProjectId.value === '', `currentProjectId=${S.currentProjectId.value || '空'}`)
  step('打开旧作品换图后地址同样收回新建画布', location.pathname === '/editor', location.pathname)
  const how4 = await saveViaUI()
  const idC = await waitFor(() => S.currentProjectId.value, 8000)
  step('第三次界面保存可用', !!how4, how4)
  step('保存后是 3 件作品', S.projects.value.length === 3, `${S.projects.value.length} 件`)
  step('第三件是新 id', !!idC && idC !== idA && idC !== idB, `${idC}`)
  step('前两件都没被改写', recText(idA) === recA3 && recText(idB) === recBAfter)

  out.ids = { old: idA, second: idB, third: idC }
  out.persisted = rawList().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
  return out
})()
