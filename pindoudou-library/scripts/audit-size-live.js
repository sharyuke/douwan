/* =========================================================================
   自检探针：自定义尺寸的「实时预览」真的在改画布吗？

   用法：
     AUDIT_PRO=1 node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
       --eval-file scripts/audit-size-live.js --page editorProject
     node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
       --eval-file scripts/audit-size-live.js --page editorProject

   口径：用户改「规格 / 横向几块 / 纵向几块」之后，画布应当自动换成当前尺寸，
   不需要点「用 X × Y 格」。这里**故意不点 apply**，只改输入框，然后等画布 /
   pattern 真的变成期望尺寸；再断言状态行与按钮文案也跟上了。

   Pro 跑：52 钉板 2×2 → 104×104；纵向改 3 → 104×156；换 78 钉板 2×2 → 156×156。
   免费跑：78 钉板一块就超上限，画布必须保持原样并给出 Pro 说明；
           52 钉板 3×2 收敛成 1×1（52×52），画布不应被撑大。
   ========================================================================= */
(async () => {
  try {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 12000, step = 40) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try { if (fn()) return true } catch { /* 页面还在刷新 */ }
      await sleep(step)
    }
    return false
  }

  const d = window.__douzao
  if (!d) throw new Error('调试桥未就绪')
  const [S, M] = await Promise.all([d.studio(), d.membership()])
  if (!(await waitFor(() => !!S.pattern.value, 8000))) throw new Error('示例作品没有载入（pattern 为空）')

  /* 不能读 window.__AUDIT_PRO：那面旗子只存在于 setup 那一轮执行上下文，
     页面真正加载时已经没了。套餐以 useMembership 里的真实状态为准。 */
  const pro = M.isPro.value
  const card = document.querySelector('.card--size')
  if (!card) throw new Error('找不到画布大小卡片')
  const row = card.querySelector('[data-size-row]')
  const panel = card.querySelector('[data-size-panel]')
  if (!row || !panel) throw new Error('画布大小卡片缺少行 / 面板')
  if (!panel.offsetParent) {
    row.click()
    await sleep(120)
  }

  const customToggle = card.querySelector('[data-custom-toggle]')
  if (!customToggle) throw new Error('找不到自定义尺寸入口')
  customToggle.click()
  await sleep(80)

  const spec = card.querySelector('[data-custom-spec]')
  const cols = card.querySelector('[data-custom-cols]')
  const rows = card.querySelector('[data-custom-rows]')
  const apply = card.querySelector('[data-custom-apply]')
  if (!spec || !cols || !rows || !apply) throw new Error('自定义尺寸的输入 / 按钮不完整')

  const setVal = (el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const dims = () => {
    const p = S.pattern.value
    return {
      w: S.options.canvasW,
      h: S.options.canvasH,
      pw: p ? p.width : 0,
      ph: p ? p.height : 0
    }
  }
  const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()
  const liveEl = () => card.querySelector('[data-custom-live]')
  const finishEl = () => card.querySelector('[data-custom-finish]')
  const noteEl = () => card.querySelector('.customNote')

  /* 成品尺寸 = 格数 × 豆径；默认 2.6mm 小豆 = 0.26 cm/格 */
  const CM_PER_CELL = 0.26

  const out = { pro, start: dims(), steps: [] }

  async function step(label, specV, colsV, rowsV, expectW, expectH) {
    setVal(spec, specV)
    setVal(cols, colsV)
    setVal(rows, rowsV)
    /* 关键：不点 [data-custom-apply]，只等画布自己变 */
    const ok = await waitFor(() => {
      const n = dims()
      return n.w === expectW && n.h === expectH && n.pw === expectW && n.ph === expectH
    })
    const got = dims()
    const liveText = text(liveEl())
    const btnText = text(apply)
    const finishText = text(finishEl())
    const expectCm = `${(expectW * CM_PER_CELL).toFixed(1)} × ${(expectH * CM_PER_CELL).toFixed(1)} cm`
    out.steps.push({ label, ok, expect: `${expectW}×${expectH}`, got, liveText, btnText, finishText, expectCm })
    if (!ok) {
      throw new Error(`实时预览失败：${label} 期望画布 / 图案 ${expectW}×${expectH}，实际 ${got.w}×${got.h} / ${got.pw}×${got.ph}`)
    }
    if (!finishText.includes(expectCm)) {
      throw new Error(`成品尺寸没有跟着算出来：${label} 期望含「${expectCm}」，实际「${finishText || '(空)'}」`)
    }
    if (!/已实时套用/.test(liveText)) {
      throw new Error(`实时预览的状态行没有说「已实时套用」：${liveText || '(空)'}`)
    }
    if (!/完成/.test(btnText)) {
      throw new Error(`画布已经变了，按钮还停在「用…」：${btnText}`)
    }
  }

  if (pro) {
    /* 老存档 / 手动尺寸（58×58）：打开自定义只是铺初值，不能自己把画布改掉。
       这一条盯着「seedCustom 写值会不会误触发实时预览」——没有事件守卫时，
       一打开自定义就会从 58×58 变成 78×78。 */
    customToggle.click()
    await sleep(80)
    S.setCanvasSize(58, 58)
    await sleep(150)
    const legacyBefore = dims()
    customToggle.click()
    await sleep(80)
    await sleep(800)
    const legacyAfter = dims()
    out.legacySeed = { before: legacyBefore, after: legacyAfter }
    if (legacyAfter.w !== 58 || legacyAfter.h !== 58) {
      throw new Error(`打开自定义把老画布改掉了：${legacyBefore.w}×${legacyBefore.h} → ${legacyAfter.w}×${legacyAfter.h}`)
    }

    await step('52 钉板 2×2 块', 52, 2, 2, 104, 104)
    await step('纵向改 3 块', 52, 2, 3, 104, 156)
    await step('78 钉板 2×2 块', 78, 2, 2, 156, 156)
  } else {
    /* 免费版：78 钉板一块就超单边上限，画布必须保持原样 */
    const before = dims()
    setVal(spec, 78)
    setVal(cols, 1)
    setVal(rows, 1)
    await sleep(1000)
    const after = dims()
    const note = text(noteEl())
    out.locked = { before, after, note }
    if (after.w !== before.w || after.h !== before.h) {
      throw new Error(`免费版 78 钉板不应该改画布：${before.w}×${before.h} → ${after.w}×${after.h}`)
    }
    if (!/Pro/.test(note)) throw new Error(`免费版没有给出 Pro 说明：${note || '(空)'}`)

    /* 52 钉板 3×2 被套餐收敛成 1×1（52×52）；当前画布本来就是 52×52，不应被撑大 */
    setVal(spec, 52)
    setVal(cols, 3)
    setVal(rows, 2)
    await sleep(1000)
    const capped = dims()
    const cappedNote = text(noteEl())
    out.capped = { got: capped, note: cappedNote }
    if (capped.w !== 52 || capped.h !== 52) {
      throw new Error(`免费版 52 钉板应收敛到 52×52，实际 ${capped.w}×${capped.h}`)
    }
    if (!/收敛/.test(cappedNote)) throw new Error(`收敛后没有说明：${cappedNote || '(空)'}`)
  }

  if (pro) {
    /* 「完成」按钮：画布已经是这个尺寸，点它只应该收起面板。
       顺便盯住 generating 复位 —— yieldForBusyPaint 会把它置 true，
       而 setCanvasSize 对相同尺寸直接 return，没人关掉的话「生成中」会一直转。 */
    const beforeApply = dims()
    apply.click()
    await sleep(400)
    const afterApply = dims()
    out.applyButton = {
      generating: S.generating.value,
      before: beforeApply,
      after: afterApply,
      panelShown: !!panel.offsetParent
    }
    if (S.generating.value) throw new Error('点「完成」后 generating 没有复位，界面会一直显示生成中')
    if (afterApply.w !== beforeApply.w || afterApply.h !== beforeApply.h) {
      throw new Error(`点「完成」把画布改掉了：${beforeApply.w}×${beforeApply.h} → ${afterApply.w}×${afterApply.h}`)
    }
    if (panel.offsetParent) throw new Error('点「完成」后尺寸面板没有收起')
  } else {
    /* 免费版：关掉自定义 / 整个面板之后，画布不能回退 */
    const beforeClose = dims()
    customToggle.click()
    await sleep(80)
    row.click()
    await sleep(120)
    const afterClose = dims()
    out.closed = { beforeClose, afterClose }
    if (afterClose.w !== beforeClose.w || afterClose.h !== beforeClose.h) {
      throw new Error(`关面板后画布回退了：${beforeClose.w}×${beforeClose.h} → ${afterClose.w}×${afterClose.h}`)
    }
  }

  return { ok: true, ...out }
  } catch (e) {
    return { ok: false, err: (e && (e.stack || e.message)) || String(e) }
  }
})()
