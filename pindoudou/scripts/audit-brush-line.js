/* 画笔菜单里的直线，以及手机上的画笔 / 换色菜单。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-brush-line.js --page editorProject
   视口：AUDIT_WIDTHS=desktop,mobile
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = { ok: true, width: innerWidth, checks: {} }
  const fail = (k, v) => { out.ok = false; out.checks[k] = v }
  if (!S.pattern.value) return { ok: false, err: '图案未就绪' }

  const txt = el => (el ? (el.textContent || '').replace(/\s+/g, '') : '')
  const cellOf = (x, y) => {
    const p = S.pattern.value
    return p.cells[y * p.width + x]
  }
  const codeAt = (x, y) => {
    const k = cellOf(x, y)
    return k < 0 ? '' : ((S.pattern.value.palette[k] || {}).code || '?')
  }

  /* 全屏工作台的位图不含标尺，画布元素正好铺满格子。 */
  function pointFor(x, y) {
    const cv = document.querySelector('.board.editing canvas')
    const stage = document.querySelector('.stage')
    const p = S.pattern.value
    if (!cv || !stage || !p) return null
    const rect = cv.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return { ok: false, rect }
    return {
      ok: true,
      clientX: rect.left + (x + 0.5) * (rect.width / p.width),
      clientY: rect.top + (y + 0.5) * (rect.height / p.height),
      stage
    }
  }
  function pointer(type, pt, extra) {
    pt.stage.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: pt.clientX, clientY: pt.clientY,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse',
      ...extra
    }))
  }
  /* 从 a 经拐角 b 拖到 c。直线模式只连 a 到 c，涂抹会经过 b。 */
  async function dragL(a, b, c, extra) {
    const pa = pointFor(a.x, a.y)
    const pb = pointFor(b.x, b.y)
    const pc = pointFor(c.x, c.y)
    if (!pa || !pa.ok) return { ok: false, pa }
    pointer('pointerdown', pa, extra)
    await sleep(30)
    pointer('pointermove', pb, extra)
    await sleep(20)
    pointer('pointermove', pc, extra)
    await sleep(20)
    pointer('pointerup', pc, extra)
    await sleep(40)
    return { ok: true }
  }

  S.brushStroke.value = 'free'
  S.swapMode.value = 'brush'
  S.tool.value = 'paint'
  const shortcut = document.querySelector('[data-tool-key="paint"]')
  if (shortcut && shortcut.getAttribute('data-tip-key') !== 'B' && innerWidth >= 1100) {
    fail('shortcut', shortcut.getAttribute('data-tip-key'))
  }

  const mobile = innerWidth <= 780
  if (mobile) {
    const labels = [...document.querySelectorAll('.msTools .msTool')].map(txt)
    if (labels.join(',') !== '画笔,橡皮,换色,颜色,更多工具') fail('labels', labels)
    const paintArrow = document.querySelector('[data-ms-tool-arrow="paint"]')
    if (!paintArrow) fail('paintArrow', false)
    else paintArrow.click()
    await sleep(80)
    const menuBox = document.querySelector('[data-ms-tool-menu]')?.getBoundingClientRect()
    if (!menuBox || menuBox.width < 40 || menuBox.top < 0 || menuBox.bottom > innerHeight + 1 || menuBox.left < -1 || menuBox.right > innerWidth + 1) {
      fail('menuBox', menuBox && { top: menuBox.top, left: menuBox.left, right: menuBox.right, bottom: menuBox.bottom, h: innerHeight, w: innerWidth })
    }
    const lineBtn = document.querySelector('[data-ms-tool-menu] [data-brush-line]')
    if (!lineBtn || txt(lineBtn) !== '直线') fail('paintMenu', txt(lineBtn))
    else lineBtn.click()
    await sleep(60)
    if (S.brushStroke.value !== 'line') fail('lineMode', S.brushStroke.value)
    if (S.tool.value !== 'paint') fail('lineTool', S.tool.value)
    const range = document.querySelector('[data-ms-tool-menu] [data-brush-range]')
    if (range) fail('sizeStaysOpen', true)
    paintArrow.click()
    await sleep(60)
    const range2 = document.querySelector('[data-ms-tool-menu] [data-brush-range]')
    if (!range2) fail('sizeRange', false)
    else {
      range2.value = '3'
      range2.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(30)
      if (S.brushSize.value !== 3) fail('brushSize', S.brushSize.value)
    }
    document.querySelector('.stage')?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 8, clientY: 8, pointerId: 3, pointerType: 'mouse'
    }))
    await sleep(40)
    if (document.querySelector('[data-ms-tool-menu]')) fail('menuClosed', true)

    const swapArrow = document.querySelector('[data-ms-tool-arrow="swap"]')
    if (!swapArrow) fail('swapArrow', false)
    else swapArrow.click()
    await sleep(80)
    const items = [...document.querySelectorAll('[data-ms-tool-menu] button')].map(txt)
    if (items.join(',') !== '自动替换相近色,替换为空豆,查看教程') fail('swapItems', items)
    const nearest = [...document.querySelectorAll('[data-ms-tool-menu] button')].find(b => txt(b) === '自动替换相近色')
    nearest?.click()
    await sleep(40)
    if (S.swapMode.value !== 'nearest') fail('nearest', S.swapMode.value)
    swapArrow.click()
    await sleep(60)
    const tutorial = [...document.querySelectorAll('[data-ms-tool-menu] button')].find(b => txt(b) === '查看教程')
    tutorial?.click()
    await sleep(200)
    const title = txt(document.querySelector('.dialog__title'))
    if (title !== '换色教程') fail('tutorial', title)
    const video = document.querySelector('.swapTutorial video')
    if (!video) fail('video', false)
    document.querySelector('.dialog__head .iconbtn')?.click()
    await sleep(150)
  } else {
    const arrow = document.querySelector('[data-tool-size="paint"]')
    if (!arrow) fail('paintArrow', false)
    else arrow.click()
    await sleep(80)
    const lineBtn = document.querySelector('[data-brush-size] [data-brush-line]')
    if (!lineBtn || txt(lineBtn) !== '直线') fail('lineItem', txt(lineBtn))
    else lineBtn.click()
    await sleep(60)
    if (S.brushStroke.value !== 'line') fail('lineMode', S.brushStroke.value)
    if (document.querySelector('[data-tool-key="paint"]')?.getAttribute('data-tip-key') !== 'B') {
      fail('shortcutAfter', document.querySelector('[data-tool-key="paint"]')?.getAttribute('data-tip-key'))
    }
    const eraser = document.querySelector('[data-tool-size="erase"]')
    eraser?.click()
    await sleep(60)
    if (document.querySelector('[data-brush-line]')) fail('eraserLine', true)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 2 }))
    await sleep(40)
  }

  const brush = S.availableColors.value.find(c => c.code && c.code !== codeAt(4, 10))
  if (!brush) return { ok: false, err: '没有可落笔的颜色' }
  S.brushColorId.value = brush.id
  S.tool.value = 'paint'
  S.brushSize.value = 1
  S.brushStroke.value = 'free'
  const beforeCorner = codeAt(12, 10)
  const freeDrag = await dragL({ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 18 })
  if (!freeDrag.ok) fail('freeGeom', freeDrag)
  else if (codeAt(12, 10) === beforeCorner) fail('freeCorner', { got: codeAt(12, 10), before: beforeCorner, brush: brush.code })
  if (!S.undo()) fail('undoFree', false)

  S.brushStroke.value = 'line'
  S.tool.value = 'paint'
  const lineDrag = await dragL({ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 18 })
  if (!lineDrag.ok) fail('lineGeom', lineDrag)
  else {
    const corner = codeAt(12, 10)
    const end = codeAt(12, 18)
    const start = codeAt(4, 10)
    if (start !== brush.code) fail('lineStart', { start, brush: brush.code })
    if (end !== brush.code) fail('lineEnd', { end, brush: brush.code })
    if (corner === brush.code) fail('lineSkipsCorner', corner)
  }
  const depth = S.undoDepth.value
  if (!S.undo()) fail('undoLine', false)
  if (S.undoDepth.value !== depth - 1) fail('oneStep', { depth, now: S.undoDepth.value })
  if (codeAt(4, 10) === brush.code) fail('undoRestores', codeAt(4, 10))

  S.brushStroke.value = 'free'
  const shiftDrag = await dragL({ x: 6, y: 8 }, { x: 14, y: 8 }, { x: 14, y: 16 }, { shiftKey: true })
  if (!shiftDrag.ok) fail('shiftGeom', shiftDrag)
  else if (codeAt(14, 8) === brush.code) fail('shiftStillLine', codeAt(14, 8))
  else if (codeAt(6, 8) !== brush.code || codeAt(14, 16) !== brush.code) fail('shiftEnds', { a: codeAt(6, 8), b: codeAt(14, 16), brush: brush.code })
  S.undo()

  out.checks.final = { stroke: S.brushStroke.value, tool: S.tool.value, swap: S.swapMode.value }
  return out
})()
