/* =========================================================================
   自检探针：手机端顶栏「编辑 ▾」浮层 + 画布右侧轻量浮控
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-edit-menu.js --page editorProject

   为什么需要它：手机上画布下方不再有常驻工具条，工具全部收进顶栏「编辑 ▾」
   浮层，画布右侧只留四颗浮控（适应 / 放大 / 缩小 / 定位）。这类改动最容易坏在：
     · 浮层打不开、或者打开后压住画布且关不掉；
     · 点画布关浮层时顺手改了一格；
     · 浮控把图纸顶出舞台 / 桌面端被连带显示。

   断言：
     · 手机：没有 .toolRail；右侧 4 颗浮控可见、≥36px、在舞台内；
     · 点「编辑」：浮层出现，包含工具 / 操作 / 视图三块；
     · 点「橡皮」：tool 切到 erase，浮层收起；
     · 再开浮层，点画布空白：浮层收起且格子一格没变；
     · 从「编辑 → 材料清单」能进材料视图；
     · 宽屏：浮控与浮层都不显示，画布下方工具条 / 笔刷条仍在。
   ========================================================================= */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const S = await window.__douzao.studio()
  const mobile = window.matchMedia('(max-width:780px)').matches
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const box = el => (el ? el.getBoundingClientRect() : null)
  const shown = el => !!el && el.getClientRects().length > 0

  const card = q('.canvasCard')
  const stage = q('.stage')
  const panel = q('.editPanel')
  const foot = q('.canvasCard__foot')
  const brush = q('.brushBar')
  const cv = q('.stage canvas')
  const pat = S.pattern.value
  if (!card || !stage || !panel || !foot) return { ok: false, err: '画布结构没找到' }
  if (!cv || !pat) return { ok: false, err: '画布或图案未就绪' }

  const out = { ok: true, mobile }
  const editBtn = qa('.cmdBtn').find(b => b.textContent.includes('编辑'))

  if (!mobile) {
    /* 桌面 / 平板：浮控与浮层不出现，工具条和笔刷条仍在画布下方 */
    out.floatersHidden = !shown(q('.stageTools'))
    out.popHidden = !q('.cmdPop')
    out.editBtnHidden = !shown(editBtn)
    out.footShown = shown(foot)
    out.brushShown = shown(brush)
    out.footBelowStage = box(foot).top >= box(stage).bottom - 1
    out.panelInFlow = getComputedStyle(panel).position === 'static'
    out.ok = out.floatersHidden && out.popHidden && out.editBtnHidden &&
      out.footShown && out.brushShown && out.footBelowStage && out.panelInFlow
    return out
  }

  /* ---------- 默认：没有常驻窄栏，只有 4 颗浮控 ---------- */
  const floaters = qa('.stageTools__btn')
  out.railGone = !q('.toolRail')
  out.floaters = {
    shown: shown(q('.stageTools')),
    items: floaters.map(b => b.getAttribute('aria-label')),
    sizes: floaters.map(b => Math.round(b.getBoundingClientRect().width)),
    insideStage: floaters.every(b => {
      const r = box(b), s = box(stage)
      return r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1
    })
  }
  out.closed = { pop: !q('.cmdPop'), panel: !shown(panel), foot: !shown(foot), brush: !shown(brush) }
  out.stage = { height: Math.round(box(stage).height), fills: box(stage).height >= 200 }

  /* ---------- 「编辑」浮层：开 → 分区 → 选橡皮 ---------- */
  editBtn.click()
  await sleep(220)
  const pop = q('.cmdPop--edit')
  out.open = {
    shown: shown(pop),
    sections: qa('.cmdPop--edit h4').map(h => h.textContent.trim()),
    tools: qa('.cmdPop--edit .editTool').map(b => b.textContent.trim()),
    rows: qa('.cmdPop--edit .editBtn').map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    inCard: !!pop && box(pop).right <= box(card).right + 1 && box(pop).left >= box(card).left - 1,
    aboveTabbar: !!pop && box(pop).bottom <= box(q('.tabbar')).top + 1
  }

  const eraser = qa('.cmdPop--edit .editTool').find(b => b.textContent.includes('橡皮'))
  eraser?.click()
  await sleep(200)
  out.pick = { tool: S.tool.value, closed: !q('.cmdPop--edit') }

  /* ---------- 再开浮层：点画布空白只关面板，不改格子 ---------- */
  editBtn.click()
  await sleep(200)
  const before = Array.from(pat.cells)
  const canvasRect = box(cv)
  const ev = {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0,
    clientX: canvasRect.left + canvasRect.width * 0.5,
    clientY: canvasRect.top + canvasRect.height * 0.5
  }
  cv.dispatchEvent(new PointerEvent('pointerdown', ev))
  cv.dispatchEvent(new PointerEvent('pointerup', ev))
  cv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY }))
  await sleep(220)
  const after = Array.from(pat.cells)
  let changed = 0
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) changed++
  out.dismiss = { closed: !q('.cmdPop--edit'), changed }

  /* 材料清单：手机顶栏收掉了这个页签，入口必须在「编辑」里真的能进 */
  editBtn.click()
  await sleep(200)
  const matRow = qa('.cmdPop--edit .editBtn').find(b => b.textContent.includes('材料清单'))
  matRow?.click()
  await sleep(300)
  out.materialsView = S.currentView.value === 'materials' && !q('.cmdPop--edit')
  S.currentView.value = 'pattern'
  await sleep(150)

  /* 收尾：回到画笔，别把工具留在橡皮上影响后续截图 */
  S.tool.value = 'paint'

  out.ok = out.railGone && out.floaters.shown && out.floaters.items.length === 4 &&
    out.floaters.sizes.every(n => n >= 36) && out.floaters.insideStage &&
    out.closed.pop && out.closed.panel && out.closed.foot && out.closed.brush &&
    out.stage.fills &&
    out.open.shown && out.open.sections.includes('工具') && out.open.sections.includes('视图') &&
    out.open.tools.join('/') === '画笔/取色/橡皮/填充/移动' &&
    out.open.rows.some(r => r.includes('撤销')) && out.open.rows.some(r => r.includes('分板视图')) &&
    out.open.inCard && out.open.aboveTabbar &&
    out.pick.tool === 'erase' && out.pick.closed &&
    out.dismiss.closed && out.dismiss.changed === 0 && out.materialsView
  return out
})()
