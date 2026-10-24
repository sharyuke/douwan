/* 自检探针：在真实浏览器里驱动工作台的「撤销 / 重做」。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-undo.js --page editorProject

   这条链路坏过一次，而且坏得很隐蔽：pushHistory() 只往栈里压快照、不刷新
   canUndo/canRedo，于是两个按钮永远停在 disabled 上（界面上就是「点了没反应」）。
   所以这里断言的都是真实 DOM 与真实数字，不调内部函数下结论：

     · 在画布上真的按下 → 拖动 → 松开（PointerEvent 走真实坐标换算），
       一整笔必须只留**一步**历史（按格压栈会变成几十步，撤销一次只退一格）；
     · 「撤销」按钮在这一笔之后必须真的可点（disabled=false），点了要逐格回到原样；
     · 「重做」按钮接着可点，点了要回到拖完的样子；
     · 撤销之后再改一笔，重做栈必须清空（不能重做出一条从未存在过的图纸）；
     · 点原色属于空操作，不该占一步历史；
     · 整色替换会让某个色号变成「死色」被剪掉、cells 里的色板下标会被重映射，
       撤销必须连色板一起还原（只存 cells 的老实现会把格子换成别的颜色）；
     · Ctrl+Z / Ctrl+Y 走真实 KeyboardEvent，与按钮同一套开关。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const cv = document.querySelector('.stage canvas')
  const pat = S.pattern.value
  if (!cv || !pat) return { ok: false, err: '画布或图案未就绪' }

  const out = { ok: true, board: `${pat.width}x${pat.height}`, colors: pat.palette.length }

  /* ---------- 工具 ---------- */
  const toolBtn = t => Array.from(document.querySelectorAll('.canvasCard__foot .tool'))
    .find(b => b.textContent.replace(/\s+/g, '').includes(t))
  const slotTitle = t => {
    const b = toolBtn(t)
    const slot = b && b.closest('.toolSlot')
    return slot ? slot.getAttribute('title') : ''
  }
  const cells = () => Array.from(S.pattern.value.cells)
  /** 每格的颜色**色号**（不是色板下标）：下标会被重映射，色号才是用户看到的 */
  const codes = () => {
    const p = S.pattern.value
    return Array.from(p.cells).map(k => (k < 0 ? null : (p.palette[k] || {}).code || '?'))
  }
  const paletteIds = () => S.pattern.value.palette.map(c => c.id).join(',')
  const diffIdx = (a, b) => {
    const r = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) r.push(i)
    return r
  }
  const diffCodes = (a, b) => {
    let n = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
    return n
  }

  /* 画布 → 格子 的坐标换算：canvas.style.width 就是 chartGeometry 的 width，
     反解出格子边长，才能点到「指定的那一格」（不然只能盲点，断言不出准确性） */
  const gW = parseFloat(cv.style.width) || cv.width
  const n = pat.width
  let cell = 0
  for (let c = 3; c <= 90; c++) {
    const r = Math.max(13, Math.min(52, Math.round(c * 1.8)))
    if (2 * r + n * c === gW) { cell = c; break }
  }
  if (!cell) return { ok: false, err: `画布尺寸解不出格子边长: style.width=${gW} width=${cv.width}` }
  const ruler = Math.max(13, Math.min(52, Math.round(cell * 1.8)))
  const rect = cv.getBoundingClientRect()
  const sx = rect.width / gW
  const sy = rect.height / gW
  const clientOf = (x, y) => ({
    clientX: rect.left + (ruler + (x + 0.5) * cell) * sx,
    clientY: rect.top + (ruler + (y + 0.5) * cell) * sy
  })
  const ptr = (type, x, y) => new PointerEvent(type, {
    ...clientOf(x, y), bubbles: true, cancelable: true,
    pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
  })
  out.geometry = { cell, ruler, canvasCssW: Math.round(gW) }

  /* ---------- 0) 初始状态：没改过图，两个按钮都该是灰的 ---------- */
  {
    const u = toolBtn('撤销')
    const r = toolBtn('重做')
    out.initial = {
      undoBtn: !!u, redoBtn: !!r,
      undoDisabled: !!u?.disabled, redoDisabled: !!r?.disabled,
      undoTitle: slotTitle('撤销'),
      canUndo: S.canUndo.value, depth: S.undoDepth.value
    }
  }

  /* ---------- 1) 真拖一笔：一笔 = 一步历史 ---------- */
  /* 挑 5 个连着的格子，都不是画笔色，保证每一格都真的变了 */
  const brush = pat.palette[0]
  S.brushColorId.value = brush.id
  let target = null
  for (let y = 2; y < pat.height - 2 && !target; y++) {
    for (let x = 2; x < pat.width - 7; x++) {
      let ok = 0
      for (let k = 0; k < 5; k++) if (pat.cells[y * pat.width + x + k] !== 0) ok++
      if (ok === 5) { target = { x, y }; break }
    }
  }
  if (!target) return { ok: false, err: '找不到 5 格连续的、非画笔色的格子' }
  const expected = []
  for (let k = 0; k < 5; k++) expected.push(target.y * pat.width + target.x + k)

  const before = cells()
  const depth0 = S.undoDepth.value
  cv.dispatchEvent(ptr('pointerdown', target.x, target.y))
  for (let k = 1; k < 5; k++) cv.dispatchEvent(ptr('pointermove', target.x + k, target.y))
  cv.dispatchEvent(ptr('pointerup', target.x + 4, target.y))
  await sleep(220)
  const afterStroke = cells()
  const strokeDiff = diffIdx(before, afterStroke)
  out.stroke = {
    targetCells: expected,
    changedCells: strokeDiff,
    changedCount: strokeDiff.length,
    /* 逐格精确命中：坐标换算或 hitTest 出问题这里会立刻露出来 */
    hitExactly: strokeDiff.join(',') === expected.join(','),
    /* 一整笔只算一步：这是「拖一下撤销几十次」那个体验问题的开关 */
    depthAdded: S.undoDepth.value - depth0,
    canUndo: S.canUndo.value,
    undoDisabled: !!toolBtn('撤销')?.disabled,
    undoTitle: slotTitle('撤销'),
    saveStatus: S.saveStatus.value
  }

  /* ---------- 2) 点真按钮撤销：逐格回到原样 ---------- */
  {
    toolBtn('撤销')?.click()
    await sleep(220)
    out.undo1 = {
      backToOriginal: diffIdx(before, cells()).length === 0,
      diffCount: diffIdx(before, cells()).length,
      depth: S.undoDepth.value,
      canRedo: S.canRedo.value,
      redoDisabled: !!toolBtn('重做')?.disabled,
      undoDisabled: !!toolBtn('撤销')?.disabled,
      undoTitle: slotTitle('撤销'),
      redoTitle: slotTitle('重做')
    }
  }

  /* ---------- 3) 点真按钮重做：回到拖完的样子 ---------- */
  {
    toolBtn('重做')?.click()
    await sleep(220)
    out.redo1 = {
      diffFromStroke: diffIdx(afterStroke, cells()).length,
      backToStroke: diffIdx(afterStroke, cells()).length === 0,
      depth: S.undoDepth.value,
      canRedo: S.canRedo.value
    }
  }

  /* ---------- 4) 撤销之后再改一笔 → 重做栈必须清空 ---------- */
  {
    toolBtn('撤销')?.click()
    await sleep(200)
    const target2 = expected[0]
    const y = Math.floor(target2 / pat.width)
    const x = target2 % pat.width
    S.brushColorId.value = pat.palette[pat.palette.length - 1].id
    const moved = S.paintAt(x, y)
    out.branch = {
      painted: moved,
      canRedo: S.canRedo.value,
      redoDisabled: !!toolBtn('重做')?.disabled,
      depth: S.undoDepth.value
    }
  }

  /* ---------- 5) 空操作：点原色不该占一步历史 ---------- */
  {
    const p = S.pattern.value
    const i = p.cells.findIndex(k => k >= 0)
    const same = p.palette[p.cells[i]]
    S.brushColorId.value = same.id
    const depthBefore = S.undoDepth.value
    const changed = S.paintAt(i % p.width, Math.floor(i / p.width))
    out.noop = {
      changed,
      depthBefore,
      depthAfter: S.undoDepth.value,
      noHistory: S.undoDepth.value === depthBefore
    }
  }

  /* ---------- 6) 整色替换 + 撤销：色板被剪掉又还原（只存 cells 的老实现会换色） ---------- */
  {
    const p = S.pattern.value
    const counts = new Map()
    for (let i = 0; i < p.cells.length; i++) {
      const k = p.cells[i]
      if (k >= 0) counts.set(k, (counts.get(k) || 0) + 1)
    }
    /* 挑一个「数量最少但存在」的颜色色号，替换掉它就能让它变成死色 */
    const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1])
    const fromK = sorted[0][0]
    const toK = sorted[sorted.length - 1][0]
    const fromId = p.palette[fromK].id
    const toColor = p.palette[toK]
    const beforeCodes = codes()
    const beforeIds = paletteIds()
    const beforeCount = p.palette.length
    const n = S.replaceColorEverywhere(fromId, toColor)
    await sleep(120)
    const afterReplaceIds = paletteIds()
    const pruned = S.pattern.value.palette.length < beforeCount
    toolBtn('撤销')?.click()
    await sleep(220)
    const p2 = S.pattern.value
    out.palette = {
      replacedCells: n,
      paletteBefore: beforeCount,
      paletteAfterReplace: afterReplaceIds.split(',').filter(Boolean).length,
      pruned,
      paletteRestored: paletteIds() === beforeIds,
      /* 逐格颜色必须一模一样：这一条就是「撤销之后图纸换色」那个 bug 的回归 */
      cellColorDiff: diffCodes(beforeCodes, codes()),
      colorsNow: p2.palette.length,
      depth: S.undoDepth.value
    }
  }

  /* ---------- 7) 快捷键：Ctrl+Z / Ctrl+Y ---------- */
  {
    const p = S.pattern.value
    const lastK = p.palette.length - 1
    S.brushColorId.value = p.palette[lastK].id
    /* 选一格「不是画笔色」的格子，保证真的会变 —— 否则这一步什么也没测到 */
    const i = Array.from(p.cells).findIndex(k => k >= 0 && k !== lastK)
    const snap = cells()
    const changed = i >= 0 ? S.paintAt(i % p.width, Math.floor(i / p.width)) : false
    await sleep(80)
    const depthAfterPaint = S.undoDepth.value
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
    await sleep(150)
    const afterUndo = diffIdx(snap, cells()).length === 0
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }))
    await sleep(150)
    out.shortcut = {
      painted: changed,
      depthAfterPaint,
      ctrlZRestored: afterUndo,
      ctrlYRedid: diffIdx(snap, cells()).length > 0,
      depth: S.undoDepth.value
    }
  }

  /* ---------- 8) 换方案 = 换了一张图纸，旧历史必须作废 ---------- */
  {
    const other = Array.from(document.querySelectorAll('.schemeCard')).find(e => !e.classList.contains('on'))
    const depthBefore = S.undoDepth.value
    other?.click()
    await sleep(260)
    out.switchVariant = {
      cardFound: !!other,
      depthBefore,
      depthAfter: S.undoDepth.value,
      canUndo: S.canUndo.value,
      undoDisabled: !!toolBtn('撤销')?.disabled,
      /* 换方案后旧快照不能还留着：图纸都换了，撤销回去没有意义 */
      historyCleared: S.undoDepth.value === 0 && !S.canUndo.value
    }
  }

  out.final = { canUndo: S.canUndo.value, canRedo: S.canRedo.value, saveStatus: S.saveStatus.value }
  return out
})()
