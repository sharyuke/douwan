/* =========================================================================
   自检探针：手机端 4.0 编辑区 —— 底部工具行 + 画笔参数条 + 「更多编辑工具」
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-edit-menu.js --page editorProject

   为什么需要它：4.0 把常驻窄栏和顶栏「编辑 ▾」浮层都去掉了，工具改成
   画布下方一行六个（镜像/画笔/橡皮/填充/取色/更多），笔刷参数在选画笔 /
   橡皮时临时出现在工具行上方；撤销 / 重做放在画布右侧浮控里。这类改动最容易坏在：
     · 工具行压住画布、或参数条把工具行顶出屏幕；
     · 单指点画布不再落笔、双指捏合 / 平移失效；
     · 工具行第一格「镜像」没有真的翻转，或误切画笔；
     · 浮控上的撤销 / 重做点不动；
     · 「更多编辑工具」里少了材料清单这类没有新入口的功能。

   断言：
     · 手机：没有 .toolRail / .editPanel / .cmdPop；右侧 6 颗浮控在舞台内；
     · 浮控前两颗是撤销 / 重做，且能真的撤销、重做；
     · 工具行 6 项、首格「镜像」、没有「移动」、参数条默认不出现；
     · 点橡皮 → erase + 「橡皮大小」；点画笔 → 画笔大小 + 当前颜色；
     · 单指点画布真的落笔，撤销后逐格还原；双指拖动改变滚动位置；
     · 双指捏合改变缩放；「镜像」翻转图案且不切换工具；
     · 「更多」4 项（撤销 / 重做 / 镜像已移出，导出在快捷区），点「材料清单」进材料视图；
     · 宽屏：工具行 / 快捷区 / 参数条都不出现，画布下方的工具条与笔刷条仍在。
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
  const foot = q('.canvasCard__foot')
  const brush = q('.brushBar')
  const cv = q('.stage canvas')
  const pat = S.pattern.value
  if (!card || !stage) return { ok: false, err: '画布结构没找到' }
  if (!cv || !pat) return { ok: false, err: '画布或图案未就绪' }

  const out = { ok: true, mobile }

  if (!mobile) {
    /* 桌面 / 平板：4.0 的手机件一个都不能露出来 */
    out.mobilePiecesHidden = !shown(q('.mobileToolbar')) && !shown(q('.quickRow')) &&
      !shown(q('.mobileParams')) && !shown(q('.fitTop'))
    out.cmdGone = qa('.cmdBtn').length === 0 && !q('.cmdPop')
    out.footShown = shown(foot)
    out.brushShown = shown(brush)
    out.footBelowStage = box(foot).top >= box(stage).bottom - 1
    out.stageTools = qa('.stageTools__btn').map(b => b.getAttribute('aria-label'))
    /* 「移动画布模式 · 单指拖动（或双指）只平移视野…」只放在手机新手指引里，
       电脑端画布下方的提示不再出现这句 */
    const prevTool = S.tool.value
    S.tool.value = 'pan'
    await sleep(180)
    out.panHintGone = !/只平移视野/.test((q('.chartNote')?.textContent || '').replace(/\s+/g, ' '))
    S.tool.value = prevTool
    await sleep(120)
    out.ok = out.mobilePiecesHidden && out.cmdGone && out.footShown && out.brushShown &&
      out.footBelowStage && out.stageTools.length >= 3 && out.panHintGone
    return out
  }

  /* ---------- 默认：没有常驻窄栏，只有 6 颗浮控（撤销 / 重做 + 视图控制） ---------- */
  const floaters = qa('.stageTools__btn')
  out.railGone = !shown(q('.toolRail')) && !shown(q('.editPanel'))
  out.floaters = {
    shown: shown(q('.stageTools')),
    items: floaters.map(b => b.getAttribute('aria-label')),
    sizes: floaters.map(b => Math.round(b.getBoundingClientRect().width)),
    insideStage: floaters.every(b => {
      const r = box(b), s = box(stage)
      return r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1
    })
  }
  out.paramsDefaultHidden = !shown(q('.mobileParams'))

  /* ---------- 底部工具行 ---------- */
  const tools = qa('.toolItem')
  const toolbar = q('.mobileToolbar')
  out.toolbar = {
    count: tools.length,
    labels: tools.map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    belowStage: !!toolbar && box(toolbar).top >= box(card).bottom - 1,
    insideViewport: !!toolbar && box(toolbar).bottom <= innerHeight + 1
  }

  /* ---------- 选橡皮 / 画笔：参数条 ---------- */
  tools.find(b => /橡皮/.test(b.textContent))?.click()
  await sleep(240)
  const params = q('.mobileParams')
  const range = q('.mobileParams__range')
  out.eraser = {
    tool: S.tool.value,
    shown: shown(params),
    label: q('.mobileParams__label')?.textContent?.trim() || '',
    rangeMax: range ? Number(range.max) : null,
    colorButton: shown(q('.mobileParams__color')),
    aboveTools: !!params && !!toolbar && box(params).bottom <= box(toolbar).top + 1,
    belowStage: !!params && box(params).top >= box(card).bottom - 1,
    insideViewport: !!params && box(params).bottom <= innerHeight + 1
  }
  /* 笔刷大小：拖到最大 → brushSize 跟着变，且不超过引擎上限 */
  if (range) {
    range.value = range.max
    range.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(120)
  }
  out.eraser.sizeApplied = S.brushSize.value === S.BRUSH_MAX

  tools.find(b => /画笔/.test(b.textContent))?.click()
  await sleep(200)
  out.paint = {
    tool: S.tool.value,
    shown: shown(q('.mobileParams')),
    label: q('.mobileParams__label')?.textContent?.trim() || '',
    colorButton: shown(q('.mobileParams__color'))
  }
  /* 再点一次画笔：参数条收起；再点回来展开，不能卡死 */
  tools.find(b => /画笔/.test(b.textContent))?.click()
  await sleep(180)
  out.paint.togglesOff = !shown(q('.mobileParams'))
  tools.find(b => /画笔/.test(b.textContent))?.click()
  await sleep(180)
  out.paint.togglesBack = shown(q('.mobileParams'))

  /* ---------- 单指点画布：真的落笔 ---------- */
  const point = (id, x, y) => new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id,
    isPrimary: id === 21, button: 0, clientX: x, clientY: y
  })
  const move = (id, x, y) => new PointerEvent('pointermove', {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id,
    isPrimary: id === 21, button: 0, clientX: x, clientY: y
  })
  const up = (id, x, y) => new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id,
    isPrimary: id === 21, button: 0, clientX: x, clientY: y
  })

  const before = Array.from(S.pattern.value.cells)
  const r = box(cv)
  const y = r.top + r.height * 0.5
  cv.dispatchEvent(point(21, r.left + r.width * 0.2, y))
  for (let i = 1; i <= 6; i++) {
    cv.dispatchEvent(move(21, r.left + r.width * (0.2 + i * 0.08), y))
  }
  cv.dispatchEvent(up(21, r.left + r.width * 0.68, y))
  await sleep(240)
  const after = Array.from(S.pattern.value.cells)
  let painted = 0
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) painted++
  S.undo()
  await sleep(200)
  let restored = 0
  const undone = Array.from(S.pattern.value.cells)
  for (let i = 0; i < undone.length; i++) if (undone[i] !== before[i]) restored++
  out.tapDraw = { painted, undoRestored: restored === 0 }

  /* ---------- 双指拖动：平移画布（工具行的「移动」已去掉，平移靠双指） ---------- */
  q('.stageTools__btn[aria-label="放大"]')?.click()
  await sleep(320)
  const zoomText = () => (q('.zoomText')?.textContent || '').trim()
  const zoomBefore = zoomText()
  const sr = box(stage)
  const sx = stage.scrollLeft
  const sy = stage.scrollTop
  const p1x = sr.left + sr.width * 0.6
  const p1y = sr.top + sr.height * 0.6
  stage.dispatchEvent(point(31, p1x, p1y))
  stage.dispatchEvent(point(32, p1x - 50, p1y))
  await sleep(60)
  stage.dispatchEvent(move(31, p1x - 90, p1y - 30))
  stage.dispatchEvent(move(32, p1x - 140, p1y - 30))
  await sleep(160)
  stage.dispatchEvent(up(31, p1x - 90, p1y - 30))
  stage.dispatchEvent(up(32, p1x - 140, p1y - 30))
  await sleep(220)
  out.pan = {
    zoom: zoomBefore,
    scrollBefore: Math.round(sx),
    scrollAfter: Math.round(stage.scrollLeft),
    topBefore: Math.round(sy),
    topAfter: Math.round(stage.scrollTop),
    moved: Math.abs(stage.scrollLeft - sx) > 8 || Math.abs(stage.scrollTop - sy) > 8
  }

  /* ---------- 工具行第一格「镜像」：左右翻转，不切换画笔 ---------- */
  const cellsBeforeMirror = Array.from(S.pattern.value.cells)
  const toolBeforeMirror = S.tool.value
  tools[0].click()
  await sleep(240)
  const cellsAfterMirror = Array.from(S.pattern.value.cells)
  let mirrored = 0
  for (let i = 0; i < cellsBeforeMirror.length; i++) {
    if (cellsBeforeMirror[i] !== cellsAfterMirror[i]) mirrored++
  }
  out.mirror = {
    label: tools[0].textContent.replace(/\s+/g, ' ').trim(),
    changed: mirrored > 0,
    toolKept: S.tool.value === toolBeforeMirror
  }

  /* ---------- 双指捏合：缩放变大 ---------- */
  const zBefore = zoomText()
  const cx = sr.left + sr.width / 2
  const cy = sr.top + sr.height / 2
  stage.dispatchEvent(point(41, cx - 40, cy))
  stage.dispatchEvent(point(42, cx + 40, cy))
  await sleep(60)
  stage.dispatchEvent(move(41, cx - 70, cy))
  stage.dispatchEvent(move(42, cx + 70, cy))
  await sleep(160)
  stage.dispatchEvent(up(41, cx - 70, cy))
  stage.dispatchEvent(up(42, cx + 70, cy))
  await sleep(260)
  const zAfter = zoomText()
  out.pinch = {
    before: zBefore,
    after: zAfter,
    changed: zBefore !== zAfter,
    zoomedIn: parseInt(zAfter, 10) > parseInt(zBefore, 10)
  }

  /* ---------- 更多编辑工具：4 项（撤销 / 重做 / 镜像已移到工具行与浮控），材料清单能进 ---------- */
  tools.find(b => /更多/.test(b.textContent))?.click()
  await sleep(320)
  const moreItems = qa('.moreItem')
  out.more = {
    title: (q('.dialog__head h2')?.textContent || '').trim(),
    labels: moreItems.map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    sheet: !!q('.modal--sheet')
  }
  moreItems.find(b => /材料清单/.test(b.textContent))?.click()
  await sleep(320)
  out.more.materialsView = S.currentView.value === 'materials' && !q('.modal.show')
  S.currentView.value = 'pattern'
  await sleep(150)

  /* ---------- 撤销 / 重做：画布右侧浮控，点了要真的生效 ----------
     先落一笔，保证「撤销」是可点的（上面的验证性撤销已经把历史用掉了）。 */
  S.paintAt(0, 0)
  await sleep(150)
  const undoBtn = q('.stageTools__btn[aria-label="撤销"]')
  const redoBtn = q('.stageTools__btn[aria-label="重做"]')
  out.history = {
    undoEnabled: !!undoBtn && !undoBtn.disabled,
    undoMoved: false,
    redoWorked: false
  }
  undoBtn?.click()
  await sleep(220)
  out.history.undoMoved = S.canRedo.value
  redoBtn?.click()
  await sleep(220)
  out.history.redoWorked = !S.canRedo.value

  /* 收尾：回到画笔、适应窗口，别把状态留给后续截图 */
  S.tool.value = 'paint'
  q('.fitTop')?.click()
  await sleep(200)

  out.ok = out.railGone && out.floaters.shown && out.floaters.items.length === 6 &&
    out.floaters.items[0] === '撤销' && out.floaters.items[1] === '重做' &&
    out.floaters.sizes.every(n => n >= 36) && out.floaters.insideStage &&
    out.paramsDefaultHidden &&
    out.toolbar.count === 6 && out.toolbar.belowStage && out.toolbar.insideViewport &&
    out.toolbar.labels.join('/') === '镜像/画笔/橡皮/填充/取色/更多' &&
    out.eraser.tool === 'erase' && out.eraser.shown && out.eraser.label === '橡皮大小' &&
    out.eraser.rangeMax === S.BRUSH_MAX && !out.eraser.colorButton && out.eraser.sizeApplied &&
    out.eraser.aboveTools && out.eraser.belowStage && out.eraser.insideViewport &&
    out.paint.tool === 'paint' && out.paint.shown && out.paint.label === '画笔大小' &&
    out.paint.colorButton && out.paint.togglesOff && out.paint.togglesBack &&
    out.tapDraw.painted > 0 && out.tapDraw.undoRestored &&
    out.pan.moved && out.pinch.changed && out.pinch.zoomedIn &&
    out.mirror.label === '镜像' && out.mirror.changed && out.mirror.toolKept &&
    out.history.undoEnabled && out.history.undoMoved && out.history.redoWorked &&
    out.more.title === '更多编辑工具' && out.more.sheet && out.more.labels.length === 4 &&
    !out.more.labels.some(l => /导出|撤销|重做|镜像/.test(l)) &&
    out.more.materialsView
  return out
})()
