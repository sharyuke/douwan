/* =========================================================================
   自检探针：画布「实际大小」预览
   用法：
     node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
       --eval-file scripts/audit-actual-size.js --page editor,editorProject

   口径：
   · 实际大小 = 一格一颗豆的实物尺寸（2.6mm 豆 → 0.26cm/格），
     按 CSS 96dpi 换算成屏幕像素；屏幕校准比例默认 1。
   · 52×52 的成品是 13.5 × 13.5 cm，屏幕上画布应约 547px 宽
     （52 格 × 9.83px + 两侧 18px 标尺）。
   · 进入后状态条要写出成品厘米；再点一次要回到进入前的缩放。
   · 点「适应」要退出实际大小并让整张图纸放得下。
   · 校准滑杆改 10% → 画布宽度也跟约 10%；恢复默认回 1。
   · 空画布（/editor）按钮必须是禁用的，不能给出假预览。
   ========================================================================= */
(async () => {
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()
    const waitFor = async (fn, ms = 12000, step = 50) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        try { if (fn()) return true } catch { /* 页面还在更新 */ }
        await sleep(step)
      }
      return false
    }
    const fail = msg => { throw new Error(msg) }

    const d = window.__douzao
    if (!d) fail('调试桥未就绪')
    const S = await d.studio()

    const visible = el => !!el && !!el.offsetParent
    const desktopBtn = document.querySelector('[data-actual-btn]')
    const mobileBtn = document.querySelector('[data-actual-btn-mobile]')
    const btn = visible(desktopBtn) ? desktopBtn : mobileBtn
    const mobile = !visible(desktopBtn)

    /* ---------- 空画布：桌面按钮禁用；手机浮控整块不出现 ---------- */
    if (!S.pattern.value) {
      if (btn && !btn.disabled) fail('空画布时「实际大小」按钮应该禁用')
      if (document.querySelector('[data-actual-badge]')) fail('空画布不应出现实际大小状态条')
      return { ok: true, vw: window.innerWidth, empty: btn ? 'disabled' : 'no-button' }
    }

    if (!btn) fail('找不到「实际大小」按钮（桌面 / 手机浮控都没有）')
    if (btn.disabled) fail('有图纸时「实际大小」按钮不应禁用')

    const stats = S.stats.value
    const pattern = S.pattern.value
    const beadCm = pattern.beadKey === '5' ? 0.5 : 0.26
    const expectCm = `${(stats.artW * beadCm).toFixed(1)} × ${(stats.artH * beadCm).toFixed(1)} cm`
    const cellTarget = beadCm * 96 / 2.54

    const canvas = () => document.querySelector('.stage .board canvas')
    const canvasW = () => {
      const el = canvas()
      return el ? el.getBoundingClientRect().width : 0
    }
    /* 画布宽 = 两侧标尺 + 格数 × 格宽；标尺 = round(cell × 1.8)，夹在 13~52 */
    const expectCanvasW = cell => {
      const ruler = Math.max(13, Math.min(52, Math.round(cell * 1.8)))
      return ruler * 2 + pattern.width * cell
    }
    const solveCell = () => {
      const w = canvasW()
      let best = 0
      let bestDiff = Infinity
      for (let c = 0.5; c <= 60; c += 0.01) {
        const diff = Math.abs(expectCanvasW(c) - w)
        if (diff < bestDiff) { bestDiff = diff; best = c }
      }
      return { cell: best, diff: bestDiff, width: w }
    }

    const zoom0 = S.zoom.value
    const width0 = canvasW()
    if (!width0) fail('画布还没画出来')

    /* ---------- 进入实际大小 ---------- */
    btn.click()
    const entered = await waitFor(() => !!document.querySelector('[data-actual-badge]'))
    if (!entered) fail('点「实际大小」后没有出现状态条')
    const badge = document.querySelector('[data-actual-badge]')
    const badgeText = text(badge)
    if (!/实际大小/.test(badgeText)) fail(`状态条没有写「实际大小」：${badgeText}`)
    if (!badgeText.includes(expectCm)) fail(`状态条成品厘米不对：${badgeText}，期望含「${expectCm}」`)
    if (btn.getAttribute('aria-pressed') !== 'true') fail('按钮没有进入选中态（aria-pressed）')

    /* 等画布按新缩放重画完 */
    await waitFor(() => Math.abs(canvasW() - width0) > 0.5, 5000)
    await sleep(120)
    const got = solveCell()
    if (got.diff > 1.5) fail(`实际大小的画布宽度对不上：实测 ${got.width.toFixed(1)}px，按 ${got.cell.toFixed(2)}px/格应为 ${expectCanvasW(got.cell).toFixed(1)}px`)
    if (Math.abs(got.cell - cellTarget) > 0.35) {
      fail(`实际大小每格 ${got.cell.toFixed(2)}px，期望 ${cellTarget.toFixed(2)}px（${beadCm * 10}mm 豆）`)
    }
    if (S.zoom.value === zoom0) fail('进入实际大小后缩放没有变化')

    /* 成品区域要在视野中心附近：实际大小通常比舞台大，先看到成品本身 */
    const stage = document.querySelector('.stage')
    const centerX = stage.scrollLeft + stage.clientWidth / 2
    const artCenterX = stage.scrollWidth / 2
    if (Math.abs(centerX - artCenterX) > stage.clientWidth * 0.6) {
      fail(`视野没有对准成品中心：${centerX.toFixed(0)} vs ${artCenterX.toFixed(0)}`)
    }

    /* ---------- 再点一次：退出并回到原缩放 ---------- */
    btn.click()
    const exited = await waitFor(() => !document.querySelector('[data-actual-badge]'))
    if (!exited) fail('再点「实际大小」后状态条没有消失')
    await waitFor(() => Math.abs(S.zoom.value - zoom0) < 0.03, 5000)
    /* 进入前如果是「适应」状态，退出时会重新量一次舞台，允许几百分之一的测量差；
       进入前是手动缩放时（下面单独测）必须原样还回去。 */
    if (Math.abs(S.zoom.value - zoom0) > 0.08) fail(`退出后缩放没有回到进入前：${S.zoom.value} vs ${zoom0}`)

    /* ---------- 手动缩放后进入：退出必须精确回到那个缩放 ---------- */
    const zoomBtn = [...document.querySelectorAll('.zoomBar .btn, .stageTools__btn')]
      .find(el => visible(el) && /放大/.test(el.getAttribute('title') || ''))
    if (!zoomBtn) fail('找不到「放大」按钮')
    zoomBtn.click()
    await sleep(120)
    const zoomManual = S.zoom.value
    if (Math.abs(zoomManual - zoom0) < 0.05) fail('点「放大」后缩放没有变化，没法验证退出还原')
    btn.click()
    await waitFor(() => !!document.querySelector('[data-actual-badge]'))
    btn.click()
    await waitFor(() => !document.querySelector('[data-actual-badge]'))
    await waitFor(() => Math.abs(S.zoom.value - zoomManual) < 0.02, 5000)
    if (Math.abs(S.zoom.value - zoomManual) > 0.02) {
      fail(`手动缩放 ${zoomManual} 进入实际大小后退出，缩放变成了 ${S.zoom.value}`)
    }

    /* ---------- 进入后点「适应」：退出实际大小并放得下 ---------- */
    btn.click()
    await waitFor(() => !!document.querySelector('[data-actual-badge]'))
    /* 4.0 手机把「适应」挪到画布顶栏（.fitTop），桌面端仍在浮控里 */
    const fitBtn = [...document.querySelectorAll('.zoomBar .btn, .stageTools__btn, .fitTop')]
      .find(el => visible(el) && /适应/.test(el.getAttribute('title') || el.getAttribute('aria-label') || ''))
    if (!fitBtn) fail('找不到「适应」按钮')
    fitBtn.click()
    await waitFor(() => !document.querySelector('[data-actual-badge]'))
    await sleep(400)
    if (document.querySelector('[data-actual-badge]')) fail('点「适应」后实际大小状态条没有消失')
    const stageAfter = document.querySelector('.stage')
    if (canvasW() > stageAfter.clientWidth + 2) {
      fail(`点「适应」后图纸仍比舞台宽：${canvasW().toFixed(0)} > ${stageAfter.clientWidth}`)
    }

    /* ---------- 校准：比例 +10%，画布宽度也跟约 10% ---------- */
    btn.click()
    await waitFor(() => !!document.querySelector('[data-actual-badge]'))
    await sleep(120)
    const w100 = canvasW()
    const calibLink = document.querySelector('[data-actual-calib]')
    if (!calibLink) fail('状态条里没有「校准屏幕」入口')
    calibLink.click()
    const range = await waitFor(() => document.querySelector('[data-calib-range]')) && document.querySelector('[data-calib-range]')
    if (!range) fail('校准弹窗没有打开 / 找不到滑杆')
    range.value = '1.1'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(200)
    const w110 = canvasW()
    if (!(w110 > w100 * 1.07 && w110 < w100 * 1.13)) {
      fail(`校准到 110% 后画布宽度没有跟约 10%：${w100.toFixed(0)} → ${w110.toFixed(0)}`)
    }
    const stored = localStorage.getItem('douwan.editor.screenScale')
    if (stored !== '1.1') fail(`校准比例没有存到本机：${stored}`)
    const resetBtn = [...document.querySelectorAll('.dialog__foot .btn')].find(el => /恢复默认/.test(text(el)))
    if (!resetBtn) fail('校准弹窗没有「恢复默认」')
    resetBtn.click()
    await sleep(200)
    if (localStorage.getItem('douwan.editor.screenScale') !== '1') fail('恢复默认没有把比例写回 1')
    const doneBtn = [...document.querySelectorAll('.dialog__foot .btn')].find(el => /完成/.test(text(el)))
    if (doneBtn) doneBtn.click()
    await sleep(200)
    if (document.querySelector('[data-calib-range]')) fail('点「完成」后校准弹窗没有关闭')

    /* 收尾：停在「实际大小」状态，方便 AUDIT_SHOT_AFTER_PROBE=1 截到状态条。
       页面随后就关掉了，不会影响下一个自检。 */
    if (!document.querySelector('[data-actual-badge]')) {
      btn.click()
      await waitFor(() => !!document.querySelector('[data-actual-badge]'))
      await sleep(250)
    }

    return {
      ok: true,
      vw: window.innerWidth,
      mobile,
      pattern: `${pattern.width}×${pattern.height}`,
      beadCm,
      expectCm,
      cell: Number(got.cell.toFixed(2)),
      cellTarget: Number(cellTarget.toFixed(2)),
      canvasW: Number(got.width.toFixed(1)),
      calib: { w100: Number(w100.toFixed(1)), w110: Number(w110.toFixed(1)) }
    }
  } catch (e) {
    return { ok: false, err: (e && (e.stack || e.message)) || String(e) }
  }
})()
