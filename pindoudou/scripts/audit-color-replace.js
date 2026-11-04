/* 自检探针：在真实浏览器里驱动「换色」整条链路（入口 → 矩阵 → 搜索 →
   自动相近色 → 实时预览 → 确认 / 取消 → 撤销 → 存档往返）。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-color-replace.js --page editorProject

   断言的都是真实 DOM 与真实图纸数据（cells 里的色号，不是内部下标）：
     · 颜色用量每行的换色按钮能打开弹窗（平板右栏 / 桌面滑出面板 / 手机菜单三条路都走）；
     · 矩阵 = 同系列全部色号（去掉源色），按 A→Z 自然序（A2 在 A10 前），每个都带色号标注；
     · 搜索能过滤（无结果有空态提示）；
     · 点色号画布立刻变（实时预览），换目标色从打开时的画面重映射、不叠在上一次预览上；
     · 没选目标色时「替换」按钮不可点；「取消 / Esc」整体回滚且不留历史；
     · 「自动选相近色」选中的就是全系列里 ΔE00 最小的那个；
     · 「替换」确认后：源色号从色板消失、历史只多一步、撤销能逐格回到原样、
       重做回到替换后，存档往返后替换仍在。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const tick = async () => { await sleep(120) }

  if (!S.pattern.value) return { ok: false, err: '图案未就绪' }

  /** 图纸每格的色号（下标会因色板剪枝重映射，色号才是用户看到的） */
  const codes = () => {
    const p = S.pattern.value
    return Array.from(p.cells).map(k => (k < 0 ? null : (p.palette[k] || {}).code || '?'))
  }
  const paletteIds = () => S.pattern.value.palette.map(c => c.id)
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  const modalOpen = () => !!Array.from(document.querySelectorAll('.modal.show .crGrid')).length
  const dialogCellCodes = () =>
    Array.from(document.querySelectorAll('.modal.show .crGrid .crCell span')).map(s => s.textContent.trim())
  const cellBtns = () => Array.from(document.querySelectorAll('.modal.show .crGrid .crCell'))
  const cellOf = code => cellBtns().find(b => b.querySelector('span').textContent.trim() === code)
  const footerBtn = text => Array.from(document.querySelectorAll('.modal.show .dialog__foot .btn'))
    .find(b => b.textContent.includes(text))

  /* 色号自然序（与组件内同一套规则），用于断言矩阵排序 */
  const codeKey = c => {
    const m = String(c).match(/^([A-Za-z]+)(\d*)$/)
    return m ? [m[1].toLowerCase(), Number(m[2] || 0)] : [String(c).toLowerCase(), 0]
  }
  const cmpCode = (a, b) => {
    const [la, na] = codeKey(a)
    const [lb, nb] = codeKey(b)
    return la !== lb ? (la < lb ? -1 : 1) : na - nb
  }

  /* ---------- 打开「颜色用量」卡（平板右栏 / 桌面滑出抽屉 / 手机菜单三条路） ---------- */
  async function ensureColorsCard() {
    const visible = el => el && el.offsetParent !== null
    let card = Array.from(document.querySelectorAll('.card--colors')).find(visible)
    if (!card) {
      /* 桌面全屏工作台（≥1100px）：右侧入口「颜色用量」→ 滑出面板 */
      const sideRow = Array.from(document.querySelectorAll('.csSide .csSide__row'))
        .find(b => b.textContent.includes('颜色用量') && visible(b))
      if (sideRow) {
        sideRow.click()
        for (let i = 0; i < 20 && !card; i++) {
          await sleep(100)
          card = Array.from(document.querySelectorAll('.csDrawer .card--colors')).find(visible)
        }
      }
    }
    if (!card) {
      /* 手机（≤780px）：顶栏「⋯」菜单 →「颜色用量」弹层 */
      const menuBtn = Array.from(document.querySelectorAll('.msIcon'))
        .find(b => (b.getAttribute('aria-label') || '').includes('更多') && visible(b))
      if (!menuBtn) return null
      menuBtn.click()
      await sleep(260)
      const item = Array.from(document.querySelectorAll('.msMenu button'))
        .find(b => b.textContent.includes('颜色用量'))
      if (!item) return null
      item.click()
      for (let i = 0; i < 20 && !card; i++) {
        await sleep(100)
        card = Array.from(document.querySelectorAll('.modal.show .card--colors')).find(visible)
      }
    }
    if (!card) return null
    if (card.classList.contains('is-folded')) {
      const arrow = card.querySelector('.cardArrowBtn')
      if (!arrow) return null
      arrow.click()
      await sleep(220)
    }
    return card
  }

  async function openDialog() {
    const card = await ensureColorsCard()
    if (!card) return { ok: false, err: '颜色用量卡没找到（桌面右栏 / 手机弹层都不在）' }
    const swap = Array.from(card.querySelectorAll('.matSwap')).find(el => el.offsetParent !== null)
    if (!swap) return { ok: false, err: '颜色用量行里没有换色按钮' }
    swap.click()
    for (let i = 0; i < 20 && !modalOpen(); i++) await sleep(100)
    if (!modalOpen()) return { ok: false, err: '点了换色按钮，弹窗没出现' }
    if (!cellBtns().length) return { ok: false, err: '弹窗里没有色号矩阵' }
    return { ok: true }
  }

  const results = []
  const check = (name, cond, extra) => {
    results.push({ name, ok: !!cond, extra: extra || '' })
  }

  /* ---------- ① 入口与矩阵 ---------- */
  const before = codes()
  const beforePalette = paletteIds()
  const undoDepth0 = S.undoDepth.value

  let opened = await openDialog()
  if (!opened.ok) return { ok: false, err: opened.err, results }
  await tick()

  /* 源色 = 点的那一行对应的颜色（ materials 第一行未必是色板第一个） */
  const st0 = S.colorReplace.value
  const srcColor = S.pattern.value.palette.find(c => c.id === st0.fromId)
  if (!srcColor) return { ok: false, err: '弹窗状态里找不到源色', results }
  const srcCode = srcColor.code
  const srcId = srcColor.id

  const seriesLen = S.availableColors.value.length
  const cellCodes = dialogCellCodes()
  check('矩阵 = 同系列全部色号去掉源色', cellCodes.length === seriesLen - 1,
    `弹窗 ${cellCodes.length} vs 系列 ${seriesLen}`)
  check('矩阵按 A→Z 自然序', cellCodes.every((c, i) => i === 0 || cmpCode(cellCodes[i - 1], c) <= 0),
    cellCodes.slice(0, 4).join(','))
  check('矩阵不含源色', !cellCodes.includes(srcCode), srcCode)
  check('每个格子都有色号标注', cellCodes.every(c => c.length > 0))
  check('A2 排在 A10 前（自然序抽查）', (() => {
    const a2 = cellCodes.indexOf('A2')
    const a10 = cellCodes.indexOf('A10')
    return a2 < 0 || a10 < 0 || a2 < a10
  })())

  /* 没选目标色：替换按钮不可点 */
  const confirmBtn0 = footerBtn('替换')
  check('没选目标色时替换按钮禁用', confirmBtn0 && confirmBtn0.disabled, '')

  /* ---------- ② 搜索 ---------- */
  const searchInput = document.querySelector('.modal.show .crSearch input')
  if (!searchInput) return { ok: false, err: '搜索框没找到', results }
  const setQuery = async v => {
    searchInput.value = v
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  }
  await setQuery('ZZZZ9')
  check('搜不到时给空态提示', document.querySelectorAll('.modal.show .crGrid .crCell').length === 0 &&
    /没有匹配/.test(document.querySelector('.modal.show .crGrid').textContent), '')
  const probeCode = cellCodes[Math.floor(cellCodes.length / 2)]
  await setQuery(probeCode)
  const hitCodes = dialogCellCodes()
  check('按色号搜索能过滤', hitCodes.length >= 1 && hitCodes.every(c => c.includes(probeCode)),
    `${probeCode} → ${hitCodes.length} 格`)
  await setQuery('')
  check('清空搜索恢复全列表', dialogCellCodes().length === seriesLen - 1, '')

  /* ---------- ③ 实时预览 ---------- */
  const srcCount = before.filter(c => c === srcCode).length
  const targetA = cellCodes.find(c => c !== srcCode)
  cellOf(targetA).click()
  await tick()
  const st1 = S.colorReplace.value
  const n1 = S.colorReplaceCount.value
  const afterA = codes()
  check('点色号后画布实时变化', !same(before, afterA), '')
  check('预览颗数 = 源色颗数', n1 === srcCount, `${n1} vs ${srcCount}`)
  check('预览结果逐格正确', afterA.every((c, i) => c === (before[i] === srcCode ? targetA : before[i])), '')
  check('弹窗状态记住了目标色', !!(st1 && st1.toId && st1.toId.endsWith(':' + targetA)), st1 && st1.toId)

  /* 换目标色：从打开时的画面重新映射，不叠在上一次预览上 */
  const targetB = cellCodes.find(c => c !== srcCode && c !== targetA)
  cellOf(targetB).click()
  await tick()
  const afterB = codes()
  check('换目标色按原图重映射', afterB.every((c, i) => c === (before[i] === srcCode ? targetB : before[i])), '')
  check('预览期间历史步数不变', S.undoDepth.value === undoDepth0, '')

  /* ---------- ④ 取消（按钮） ---------- */
  const cancelBtn = footerBtn('取消')
  if (!cancelBtn) return { ok: false, err: '取消按钮没找到', results }
  cancelBtn.click()
  for (let i = 0; i < 20 && modalOpen(); i++) await sleep(100)
  check('取消后弹窗关闭', !modalOpen(), '')
  check('取消后画面回到打开前', same(codes(), before), '')
  check('取消不留历史', S.undoDepth.value === undoDepth0 && !S.colorReplace.value, '')

  /* ---------- ⑤ Esc 关闭 = 取消 ---------- */
  opened = await openDialog()
  if (!opened.ok) return { ok: false, err: opened.err, results }
  cellOf(targetA).click()
  await tick()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  for (let i = 0; i < 20 && modalOpen(); i++) await sleep(100)
  check('Esc 关闭按取消处理', !modalOpen() && same(codes(), before) && S.undoDepth.value === undoDepth0, '')

  /* ---------- ⑥ 自动选相近色 ---------- */
  opened = await openDialog()
  if (!opened.ok) return { ok: false, err: opened.err, results }
  const autoBtn = Array.from(document.querySelectorAll('.modal.show .crAuto')).find(b => b.offsetParent !== null)
  if (!autoBtn) return { ok: false, err: '自动选相近色按钮没找到', results }
  autoBtn.click()
  await tick()
  /* 用同一套 ΔE00 在探针里独立算一遍 argmin，和弹窗的选择对 */
  const cands = S.availableColors.value.filter(c => c.id !== srcId && c.lab)
  let bestId = ''
  let bd = Infinity
  for (const c of cands) {
    const e = d.color.deltaE2000(srcColor.lab, c.lab)
    if (e < bd) { bd = e; bestId = c.id }
  }
  const bestCode = (cands.find(c => c.id === bestId) || {}).code || ''
  check('自动相近色 = 全系列 ΔE00 最小', S.colorReplace.value && S.colorReplace.value.toId === bestId,
    `选了 ${(S.colorReplace.value || {}).toId}，应为 ${bestId}`)
  const replacedCount = S.colorReplaceCount.value
  check('自动选完后替换按钮可点', !footerBtn('替换').disabled, '')

  /* ---------- ⑦ 确认替换 ---------- */
  footerBtn('替换').click()
  for (let i = 0; i < 20 && modalOpen(); i++) await sleep(100)
  await sleep(250) /* endEdit 里的统计收尾 */
  const afterCodes = codes()
  check('确认后弹窗关闭', !modalOpen() && !S.colorReplace.value, '')
  check('确认后画上没有源色号', !afterCodes.includes(srcCode), srcCode)
  check('确认后画布 = 预览结果', afterCodes.every((c, i) => c === (before[i] === srcCode ? bestCode : before[i])), '')
  check('源色号从色板剪掉', !paletteIds().includes(srcId), srcId)
  check('替换只留一步历史', S.undoDepth.value === undoDepth0 + 1, `${S.undoDepth.value} vs ${undoDepth0 + 1}`)
  check('替换后标记为手改过', S.manualEdited.value === true, '')
  check('替换颗数与预览一致', replacedCount === srcCount, `${replacedCount} vs ${srcCount}`)

  /* ---------- ⑧ 撤销 / 重做 ---------- */
  S.undo()
  await tick()
  check('撤销逐格回到原样', same(codes(), before), '')
  check('撤销连色板一起还原', paletteIds().join(',') === beforePalette.join(','), '')
  S.redo()
  await tick()
  check('重做回到替换后', !codes().includes(srcCode), '')

  /* ---------- ⑨ 存档往返 ---------- */
  const pid = S.saveProject('换色探针作品')
  check('保存成功', !!pid, '')
  if (pid) {
    const reopened = S.openProject(pid)
    await tick()
    check('重新打开成功', !!reopened, '')
    check('存档往返后替换仍在', !codes().includes(srcCode), '')
  }

  const failed = results.filter(r => !r.ok)
  return { ok: failed.length === 0, failed: failed.length, results }
})()
