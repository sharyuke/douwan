/* 操作台撤销要覆盖工具栏以外的步骤。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-undo-ops.js --page editorProject
   视口只跑桌面：AUDIT_WIDTHS=desktop
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = { ok: true, checks: {} }
  const fail = (k, v) => { out.ok = false; out.checks[k] = v }
  if (!S.pattern.value) return { ok: false, err: '图案未就绪' }

  const p0 = S.pattern.value
  const cx = Math.floor(p0.width / 2)
  const cy = Math.floor(p0.height / 2)
  const at = () => {
    const p = S.pattern.value
    if (!p || cx >= p.width || cy >= p.height) return ''
    const k = p.cells[cy * p.width + cx]
    return k < 0 ? '' : ((p.palette[k] || {}).code || '?')
  }
  const before = {
    brand: S.options.brandId,
    w: S.options.canvasW,
    h: S.options.canvasH,
    colors: S.options.targetColors,
    key: S.activeKey.value,
    code: at(),
    depth: S.undoDepth.value
  }
  out.checks.before = before

  const brush = S.availableColors.value.find(c => {
    const k = p0.cells[cy * p0.width + cx]
    return k < 0 || !p0.palette[k] || p0.palette[k].id !== c.id
  })
  if (!brush) return { ok: false, err: '没有可落笔的颜色' }
  S.brushColorId.value = brush.id
  const paintedOk = S.paintAt(cx, cy)
  const painted = at()
  if (!paintedOk || painted === before.code) fail('paint', { paintedOk, painted, before: before.code })

  const otherBrand = before.brand === 'coco291' ? 'mard291' : 'coco291'
  if (!S.setBrand(otherBrand)) fail('setBrand', S.options.brandId)
  await sleep(60)
  const undoBtn = [...document.querySelectorAll('button')].find(b => b.getAttribute('data-tip') === '撤销' && !b.disabled)
  if (!undoBtn) fail('undoBtn', '撤销按钮不可点')
  else undoBtn.click()
  await sleep(80)
  if (S.options.brandId !== before.brand) fail('undoBrand', S.options.brandId)
  if (at() !== painted) fail('undoBrandKeepsPaint', { got: at(), painted })
  if (!S.redo()) fail('redoBrand', false)
  if (S.options.brandId !== otherBrand) fail('redoBrandId', S.options.brandId)
  if (!S.undo()) fail('undoBrandAgain', false)

  const otherKey = S.variants.value.map(v => v.key).find(k => k !== before.key)
  if (otherKey) {
    const depth = S.undoDepth.value
    S.selectVariant(otherKey)
    if (S.activeKey.value !== otherKey) fail('scheme', S.activeKey.value)
    if (S.undoDepth.value !== depth + 1) fail('schemeDepth', { depth, now: S.undoDepth.value })
    if (!S.undo()) fail('undoScheme', false)
    if (S.activeKey.value !== before.key) fail('undoSchemeKey', S.activeKey.value)
    if (S.undoDepth.value !== depth) fail('undoSchemeDepth', S.undoDepth.value)
  } else out.checks.schemeSkipped = true

  for (let i = 0; i < 25 && S.sourceUrl.value && !S.sourceImg.value; i++) await sleep(100)
  const nextColors = before.colors > 8 ? 8 : Math.min(12, S.availableColors.value.length)
  if (nextColors !== before.colors && S.sourceUrl.value) {
    S.options.targetColors = nextColors
    const gen = S.regenerate({ silent: true })
    if (!gen) fail('regen', false)
    else {
      if (S.options.targetColors !== nextColors) fail('colors', S.options.targetColors)
      if (!S.undo()) fail('undoColors', false)
      if (S.options.targetColors !== before.colors) fail('undoColorsValue', S.options.targetColors)
      if (at() !== painted) fail('undoColorsCell', { got: at(), painted })
    }
  } else out.checks.colorsSkipped = { nextColors, hasSource: !!(S.sourceUrl && S.sourceUrl.value) }

  const nw = Math.max(24, before.w - 12)
  const nh = Math.max(24, before.h - 12)
  const sized = await Promise.resolve(S.setCanvasSize(nw, nh, { silent: true, announce: false }))
  if (!sized) fail('size', { nw, nh, w: S.options.canvasW, h: S.options.canvasH })
  else if (S.options.canvasW === before.w && S.options.canvasH === before.h) fail('sizeSame', sized)
  else {
    if (!S.undo()) fail('undoSize', false)
    if (S.options.canvasW !== before.w || S.options.canvasH !== before.h) {
      fail('undoSizeValue', { w: S.options.canvasW, h: S.options.canvasH, before })
    }
    if (at() !== painted) fail('undoSizeCell', { got: at(), painted })
    if (!S.redo()) fail('redoSize', false)
    if (S.options.canvasW === before.w && S.options.canvasH === before.h) fail('redoSizeValue', { w: S.options.canvasW, h: S.options.canvasH })
    S.undo()
  }

  out.checks.final = {
    brand: S.options.brandId,
    w: S.options.canvasW,
    h: S.options.canvasH,
    colors: S.options.targetColors,
    key: S.activeKey.value,
    code: at(),
    depth: S.undoDepth.value,
    canUndo: S.canUndo.value,
    canRedo: S.canRedo.value
  }
  return out
})()
