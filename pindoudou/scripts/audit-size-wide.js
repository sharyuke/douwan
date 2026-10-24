/* =========================================================================
   自检探针：宽屏（≥781px）的「画布与成品尺寸」面板
   用法：
     node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
       --eval-file scripts/audit-size-wide.js --page editorProject
     node scripts/audit.cjs --eval-file scripts/audit-size-wide.js --page editor

   口径：
   · 收起 = 标题 + 实时摘要；展开 = 规格 / 成品尺寸 / 等比 / 摘要 / 提示 / 恢复默认。
   · 滑杆拖动必须真的重新采样：图案宽高、豆子总数、成品厘米一起变；
     缩到最小再放回最大，图案指纹必须与第一次一致（证明用的是原图，不是上一张图纸）。
   · 换画布规格只改「容量」；当前网格超限时自动收敛并给一句轻提示。
   · 关闭等比后宽高各自可调；重新打开按容量比例收回。
   · 空画布：成品尺寸控件禁用 + 提示文案，豆子总数不显示假数字。
   · 手机端（≤780px）没有这块面板，直接跳过（手机端另有 verify:size-live）。
   ========================================================================= */
(async () => {
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()
    const waitFor = async (fn, ms = 20000, step = 50) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        try { if (fn()) return true } catch { /* 页面还在更新 */ }
        await sleep(step)
      }
      return false
    }
    const fail = msg => { throw new Error(msg) }

    const card = document.querySelector('[data-size-wide]')
    if (!card) return { ok: true, skipped: '手机端没有宽屏面板（见 verify:size-live）' }

    const d = window.__douzao
    if (!d) fail('调试桥未就绪')
    const [S, M] = await Promise.all([d.studio(), d.membership()])
    const head = card.querySelector('[data-size-row]')
    const body = card.querySelector('[data-size-panel]')
    const spec = card.querySelector('[data-size-spec]')
    if (!head || !body || !spec) fail('画布与成品尺寸卡片缺少标题 / 面板 / 规格下拉')

    const title = text(head.querySelector('.sizeWideHead__title'))
    if (!/画布与成品尺寸/.test(title)) fail(`标题不对：${title || '(空)'}`)
    if (head.tagName !== 'BUTTON') fail('标题行不是按钮，键盘聚焦不了')
    if (head.getAttribute('aria-expanded') !== 'false') fail('默认应该是收起状态')
    if (body.offsetParent) fail('默认收起时面板仍然显示')

    const summaryText = () => text(card.querySelector('[data-size-value]'))
    const dims = () => ({
      w: S.options.canvasW,
      h: S.options.canvasH,
      capW: S.canvasCapW.value,
      capH: S.canvasCapH.value,
      pw: S.pattern.value && S.pattern.value.width,
      ph: S.pattern.value && S.pattern.value.height,
      share: S.stats.value && S.stats.value.sharePct,
      beads: S.stats.value && S.stats.value.total,
      generating: S.generating.value
    })
    const panel = () => ({
      cells: text(card.querySelector('[data-size-cells]')),
      finish: text(card.querySelector('[data-size-finish]')),
      beads: text(card.querySelector('[data-size-beads]')),
      cm: text(card.querySelector('[data-size-cm]')),
      note: text(card.querySelector('[data-size-note]'))
    })
    const cmOf = n => (n * 0.26).toFixed(1)
    const hash = () => {
      const p = S.pattern.value
      if (!p) return 0
      let h = 0
      for (let i = 0; i < p.cells.length; i++) h = (h * 31 + p.cells[i] + 1) >>> 0
      return h
    }
    const open = async () => {
      if (!body.offsetParent) { head.click(); await sleep(150) }
      if (!body.offsetParent) fail('点标题行后面板没有展开')
    }
    const close = async () => {
      if (body.offsetParent) { head.click(); await sleep(120) }
      if (body.offsetParent) fail('再点标题行后面板没有收起')
    }
    /* 底板下拉现在是「实物优先」：1 块 104 钉板 · 28 × 28 cm；按 option.value 找最稳 */
    const optionByCells = (w, h) => [...spec.options].find(o => o.value === `${w}x${h}`)
    const setSpec = async (w, h) => {
      const opt = optionByCells(w, h)
      if (!opt) fail(`规格下拉里没有 ${w} × ${h} 格（当前选项：${[...spec.options].map(o => text(o)).join(' / ')}）`)
      spec.value = opt.value
      spec.dispatchEvent(new Event('change', { bubbles: true }))
      await waitFor(() => !S.generating.value, 20000)
      await sleep(80)
    }
    const setRange = async (el, v, expectW, expectH) => {
      el.value = String(v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      /* 等的是**成品区域**（options.canvasW/H）；图纸本身是画布大小，不跟着滑杆变 */
      const ok = await waitFor(() => {
        const n = dims()
        return n.w === expectW && n.h === expectH && !n.generating
      })
      if (!ok) {
        const n = dims()
        fail(`滑杆 ${v} 没有落到 ${expectW}×${expectH}：成品区域 ${n.w}×${n.h}，画布 ${n.capW}×${n.capH}，generating=${n.generating}`)
      }
      const n = dims()
      if (n.pw !== n.capW || n.ph !== n.capH) {
        fail(`图纸应该始终是画布大小：图纸 ${n.pw}×${n.ph}，画布 ${n.capW}×${n.capH}`)
      }
    }

    const out = { ok: true, vw: window.innerWidth, collapsed: summaryText() }

    /* ---------- 收起 / 展开 / 收起 / 展开 ---------- */
    await open()
    await close()
    await open()

    /* ---------- 规格下拉与滑杆的静态口径 ---------- */
    const current = optionByCells(dims().capW, dims().capH)
    if (!current) fail(`规格下拉选不中当前容量 ${dims().capW}×${dims().capH}`)
    if (spec.value !== current.value) fail(`规格下拉的当前值与容量对不上：${spec.value} vs ${current.value}`)
    const range = card.querySelector('[data-size-range]')
    if (!range) fail('找不到成品尺寸滑杆')
    if (Number(range.max) !== Math.max(dims().capW, dims().capH)) {
      fail(`滑杆上限 ${range.max} 与容量 ${dims().capW}×${dims().capH} 对不上`)
    }
    if (Number(range.min) !== 8) fail(`滑杆下限应为 8 格，实际 ${range.min}`)
    const aspect = card.querySelector('[data-size-aspect]')
    if (!aspect || !aspect.checked) fail('等比例缩放默认应该是开的')
    if (!card.querySelector('[data-size-reset]')) fail('缺少「恢复默认」按钮')
    out.static = { spec: spec.value, min: range.min, max: range.max, current }

    /* ---------- 空画布：控件禁用 + 提示 + 不显示假豆子数 ---------- */
    if (!S.pattern.value || !S.sourceUrl.value) {
      if (!range.disabled) fail('空画布时成品尺寸滑杆应该禁用')
      const empty = text(card.querySelector('[data-size-empty]'))
      if (!/上传图片或选择素材后可调整成品尺寸/.test(empty)) fail(`空画布提示不对：${empty || '(空)'}`)
      if (panel().beads !== '—') fail(`空画布不应显示豆子数：${panel().beads}`)
      if (card.querySelector('[data-size-minus]').disabled !== true) fail('空画布时 − 按钮应该禁用')

      /* 空画布选规格：容量与网格一起落到新规格 */
      const before = dims()
      const next = before.capW === 78 ? 104 : 78
      await setSpec(next, next)
      const after = dims()
      if (after.capW === before.capW) fail('空画布换规格没有改容量')
      if (after.w !== after.capW || after.h !== after.capH) {
        fail(`空画布换规格后网格应等于容量：网格 ${after.w}×${after.h}，容量 ${after.capW}×${after.capH}`)
      }
      out.empty = { before, after, empty, beads: panel().beads, disabled: range.disabled }
      await close()
      return out
    }

    /* ---------- 有图：拖动滑杆真的重新采样 ---------- */
    const start = dims()
    if (panel().beads !== `${start.beads.toLocaleString()} 颗`) {
      fail(`豆子总数不是真实值：界面「${panel().beads}」，stats ${start.beads}`)
    }
    if (!panel().cells.startsWith(`${start.w} × ${start.h} 颗`)) fail(`成品区域摘要不对：${panel().cells}`)
    const startCm = `${cmOf(start.w)} × ${cmOf(start.h)} cm`
    if (!panel().finish.includes(startCm)) fail(`成品摘要不对：${panel().finish}，期望含「${startCm}」`)

    /* 规格换成 104：只改容量，当前网格保持不动（规格 = 最大可用网格） */
    const targetW = 104
    const targetH = 104
    await setSpec(targetW, targetH)
    const afterSpec = dims()
    if (afterSpec.capW !== targetW || afterSpec.capH !== targetH) {
      fail(`换规格后容量不对：${afterSpec.capW}×${afterSpec.capH}，期望 ${targetW}×${targetH}`)
    }
    if (afterSpec.w !== start.w || afterSpec.h !== start.h) {
      fail(`换规格不该改成品区域：${start.w}×${start.h} → ${afterSpec.w}×${afterSpec.h}`)
    }
    /* 画布变大了，成品区域没变：图纸是 104 画布，成品只占中间 52（25%） */
    if (afterSpec.pw !== targetW || afterSpec.ph !== targetH) {
      fail(`换规格后图纸应该铺满画布：图纸 ${afterSpec.pw}×${afterSpec.ph}，期望 ${targetW}×${targetH}`)
    }
    if (afterSpec.share !== 25) fail(`成品占画布的比例不对：${afterSpec.share}%（期望 25%）`)
    const padded = S.pattern.value
    if (padded.cells[0] !== -1 || padded.cells[padded.cells.length - 1] !== -1) {
      fail('成品区域之外的格子应该是空的（四周留空）')
    }
    const filled = (() => { let n = 0; for (let i = 0; i < padded.cells.length; i++) if (padded.cells[i] >= 0) n++; return n })()
    if (filled !== afterSpec.beads) fail(`留空后的实际豆子数不对：${filled} vs stats ${afterSpec.beads}`)
    if (Number(range.max) !== targetW) fail(`换规格后滑杆上限没变：${range.max}`)
    out.spec = { after: afterSpec, max: range.max, filled, share: afterSpec.share }

    /* 拖到上限：图案 / 摘要 / 豆子数一起变 */
    await setRange(range, targetW, targetW, targetH)
    const atMax = dims()
    const maxHash = hash()
    if (!panel().cells.startsWith(`${targetW} × ${targetH} 颗`)) fail(`拉到上限后成品区域摘要不对：${panel().cells}`)
    if (!panel().finish.includes(`${cmOf(targetW)} × ${cmOf(targetH)} cm`)) {
      fail(`拉到上限后成品尺寸不对：${panel().finish}`)
    }
    if (panel().beads !== `${atMax.beads.toLocaleString()} 颗`) {
      fail(`拉到上限后豆子数不是真实值：${panel().beads}，stats ${atMax.beads}`)
    }
    out.max = { ...atMax, panel: panel(), hash: maxHash }

    /* 拖到下限 */
    await setRange(range, 8, 8, 8)
    const atMin = dims()
    if (!panel().cells.startsWith('8 × 8 颗')) fail(`拉到下限后成品区域摘要不对：${panel().cells}`)
    if (atMin.pw !== targetW) fail(`拉到下限后图纸仍是画布大小：${atMin.pw}×${atMin.ph}`)
    if (atMin.share !== 1) fail(`拉到下限后占画布比例不对：${atMin.share}%`)
    if (panel().beads !== `${atMin.beads.toLocaleString()} 颗`) fail(`下限豆子数不对：${panel().beads}`)
    out.min = { ...atMin, panel: panel() }

    /* 再拉回上限：指纹必须与第一次完全一致（重新从原图采样，不累积模糊） */
    await setRange(range, targetW, targetW, targetH)
    if (hash() !== maxHash) fail('缩到最小再放回最大后图案变了：重采样没有用原始源图')
    out.noBlur = true

    /* 关闭等比：宽高各自可调，互不牵连 */
    aspect.checked = false
    aspect.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(120)
    const wRange = card.querySelector('[data-size-range="w"]')
    const hRange = card.querySelector('[data-size-range="h"]')
    if (!wRange || !hRange || !wRange.offsetParent || !hRange.offsetParent) fail('关闭等比后没有出现宽 / 高两条滑杆')
    await setRange(wRange, 60, 60, targetH)
    await setRange(hRange, 80, 60, 80)
    const side = dims()
    if (side.w !== 60 || side.h !== 80) fail(`宽高独立调整失败：${side.w}×${side.h}`)
    if (!panel().cells.startsWith('60 × 80 颗')) fail(`宽高独立调整后摘要不对：${panel().cells}`)
    if (!panel().finish.includes(`${cmOf(60)} × ${cmOf(80)} cm`)) fail(`宽高独立调整后成品不对：${panel().finish}`)
    out.side = { ...side, panel: panel() }

    /* 重新打开等比：按长边收回正方形（看的是成品区域，不是画布） */
    aspect.checked = true
    aspect.dispatchEvent(new Event('change', { bubbles: true }))
    const okLock = await waitFor(() => dims().w === dims().h && !dims().generating, 20000)
    if (!okLock) fail('重新打开等比后没有收回等宽高')
    out.relock = { ...dims(), panel: panel() }

    /* 恢复默认 = 成品区域用满当前画布 */
    card.querySelector('[data-size-reset]').click()
    const okReset = await waitFor(() => {
      const n = dims()
      return n.w === n.capW && n.h === n.capH && !n.generating
    }, 20000)
    if (!okReset) fail(`恢复默认没有回到画布尺寸：成品区域 ${dims().w}×${dims().h}，画布 ${dims().capW}×${dims().capH}`)
    out.reset = { ...dims(), panel: panel() }

    /* 画布收小：成品区域自动收敛 + 轻提示 */
    await setSpec(52, 52)
    const okClamp = await waitFor(() => {
      const n = dims()
      return n.w === 52 && n.h === 52 && n.capW === 52 && !n.generating
    }, 20000)
    if (!okClamp) fail(`画布收小后成品区域没有收敛：${dims().w}×${dims().h}，画布 ${dims().capW}×${dims().capH}`)
    if (!/收敛/.test(panel().note)) fail(`容量收小后没有轻提示：${panel().note || '(空)'}`)
    out.clamp = { ...dims(), panel: panel() }

    /* 自定义尺寸：规格 × 块数仍然可用（Pro 单边可到 1000 格） */
    const customOpt = [...spec.options].find(o => o.value === 'custom')
    if (!customOpt) fail('规格下拉缺少「自定义尺寸」')
    spec.value = 'custom'
    spec.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(120)
    const cSpec = card.querySelector('[data-size-custom-spec]')
    const cCols = card.querySelector('[data-size-custom-cols]')
    const cRows = card.querySelector('[data-size-custom-rows]')
    const cApply = card.querySelector('[data-size-custom-apply]')
    if (!cSpec || !cCols || !cRows || !cApply) fail('自定义尺寸的输入 / 按钮不完整')
    const setVal = (el, v) => {
      el.value = String(v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setVal(cSpec, 104)
    setVal(cCols, 2)
    setVal(cRows, 1)
    await sleep(120)
    const cSum = text(card.querySelector('[data-size-custom-sum]'))
    if (!/208 × 104 颗/.test(cSum)) fail(`自定义尺寸的预览不对：${cSum || '(空)'}`)
    cApply.click()
    const okCustom = await waitFor(() => {
      const n = dims()
      return n.w === 208 && n.h === 104 && n.capW === 208 && n.capH === 104 && !n.generating
    }, 30000)
    if (!okCustom) fail(`自定义尺寸没有落地：成品区域 ${dims().w}×${dims().h}，画布 ${dims().capW}×${dims().capH}，图纸 ${dims().pw}×${dims().ph}`)
    if (!spec.value.startsWith('c')) fail(`自定义尺寸落地后下拉没有停在自定义项：${spec.value}`)
    /* 自定义画布比例 ≠ 素材比例时，等比缩放自动关闭，避免留下一条对不上的长边滑杆 */
    if (aspect.checked) fail('自定义非素材比例的画布后，等比缩放应该自动关闭')
    if (!card.querySelector('[data-size-range="w"]') || !card.querySelector('[data-size-range="h"]')) {
      fail('自定义非素材比例后没有展开宽 / 高两条滑杆')
    }
    out.custom = { ...dims(), panel: panel(), sum: cSum, spec: spec.value, aspectLocked: aspect.checked }

    /* 收起后摘要仍是真实网格 */
    await close()
    if (!summaryText().includes(`${dims().w} × ${dims().h} 颗`)) {
      fail(`收起后的摘要不是真实网格：${summaryText()}`)
    }
    out.collapsedEnd = summaryText()
    return out
  } catch (e) {
    return { ok: false, err: (e && (e.stack || e.message)) || String(e) }
  }
})()
