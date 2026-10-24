/* =========================================================================
   自检探针：手机端右侧工具窄栏 + 「更多」抽屉
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-edit-menu.js --page editorProject

   为什么需要它：手机上画布下方的工具条 / 笔刷条已经收进右侧窄栏与「更多」抽屉，
   这类「看起来还在、实际点不到」的改动最容易坏在三处：
     · 窄栏压住画布、或者按钮小于 44px；
     · 抽屉开着时点遮罩，结果落到画布上改了一格；
     · 桌面端被连带隐藏。

   断言：
     · 手机：窄栏 5 项（编辑 / 取色 / 橡皮 / 填充 / 更多）可见且 ≥44px；
       画布下方旧工具条不占位；舞台高度吃掉省下的空间；
     · 点「橡皮」：tool 切到 erase；
     · 点「更多」：抽屉出现，分区只包含现有功能；点遮罩关闭，格子一格没变；
     · 宽屏：窄栏不显示，工具条 / 笔刷条仍在画布下方。
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
  const toolbar = q('.canvasCard__toolbar')
  const rail = q('.toolRail')
  /* 抽屉是 v-if：打开前节点还不存在，必须点完「更多」再取。 */
  const panel = q('.editPanel')
  const foot = q('.canvasCard__foot')
  const brush = q('.brushBar')
  const cv = q('.stage canvas')
  const pat = S.pattern.value
  if (!card || !stage || !panel || !foot) return { ok: false, err: '画布结构没找到' }
  if (!cv || !pat) return { ok: false, err: '画布或图案未就绪' }

  const out = { ok: true, mobile }

  if (!mobile) {
    /* 桌面 / 平板：窄栏与抽屉不出现，工具条和笔刷条仍在画布下方 */
    out.railHidden = !shown(rail)
    out.drawerHidden = !q('.toolDrawer')
    out.footShown = shown(foot)
    out.brushShown = shown(brush)
    out.footBelowStage = box(foot).top >= box(stage).bottom - 1
    out.panelInFlow = getComputedStyle(panel).position === 'static'
    out.ok = out.railHidden && out.drawerHidden && out.footShown && out.brushShown &&
      out.footBelowStage && out.panelInFlow
    return out
  }

  /* ---------- 默认：窄栏 5 项，旧工具条不占位 ---------- */
  const railButtons = qa('.toolRail__btn')
  out.rail = {
    shown: shown(rail),
    items: railButtons.map(b => b.textContent.trim()),
    heights: railButtons.map(b => Math.round(b.getBoundingClientRect().height)),
    insideStage: box(rail).right <= box(stage).right + 1 && box(rail).top >= box(stage).top - 1
  }
  out.closed = { drawer: !q('.toolDrawer'), panel: !shown(panel), foot: !shown(foot), brush: !shown(brush) }
  out.stage = { height: Math.round(box(stage).height), fills: box(stage).height >= 200 }

  /* ---------- 选「橡皮」 ---------- */
  const eraser = railButtons.find(b => b.textContent.includes('橡皮'))
  eraser?.click()
  await sleep(180)
  out.pick = { tool: S.tool.value, pressed: eraser?.getAttribute('aria-pressed') }

  /* ---------- 「更多」抽屉：开 → 分区 → 遮罩关 ---------- */
  const more = railButtons.find(b => b.textContent.includes('更多'))
  more.click()
  await sleep(200)
  const drawer = q('.toolDrawer')
  out.open = {
    drawer: shown(drawer),
    sections: qa('.toolDrawer__body h4').map(h => h.textContent.trim()),
    rows: qa('.toolDrawer .drawerRow, .toolDrawer .drawerBtn').map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    insideStage: !!drawer && box(drawer).bottom <= box(stage).bottom + 1 && box(drawer).top >= box(stage).top - 1
  }

  const before = Array.from(pat.cells)
  q('.toolScrim')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  await sleep(200)
  const after = Array.from(pat.cells)
  let changed = 0
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) changed++
  out.dismiss = { closed: !q('.toolDrawer'), changed }

  /* 材料清单：手机顶栏收掉了这个页签，入口必须在「更多」里真的能进 */
  more.click()
  await sleep(200)
  const matRow = qa('.toolDrawer .drawerRow').find(b => b.textContent.includes('材料清单'))
  matRow?.click()
  await sleep(300)
  out.materialsView = S.currentView.value === 'materials' && !q('.toolDrawer')
  S.currentView.value = 'pattern'
  await sleep(150)

  /* 收尾：回到画笔，别把工具留在橡皮上影响后续截图 */
  S.tool.value = 'paint'

  out.ok = out.rail.shown && out.rail.items.length === 5 &&
    out.rail.items.join('/') === '编辑/取色/橡皮/填充/更多' &&
    out.rail.heights.every(h => h >= 44) && out.rail.insideStage &&
    out.closed.drawer && out.closed.panel && out.closed.foot && out.closed.brush &&
    out.stage.fills &&
    out.pick.tool === 'erase' && out.pick.pressed === 'true' &&
    out.open.drawer && out.open.sections.includes('编辑操作') && out.open.sections.includes('视图') &&
    out.open.rows.some(r => r.includes('撤销')) && out.open.rows.some(r => r.includes('网格显示')) &&
    out.open.rows.some(r => r.includes('材料清单')) &&
    out.open.insideStage &&
    out.dismiss.closed && out.dismiss.changed === 0 && out.materialsView
  return out
})()
