/* 图形工具：菜单四种、拖出的五角星左右对称且等比例，拖中间能挪走，一步撤销一步。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-shape.js --page editorProject
   视口：AUDIT_WIDTHS=desktop,tablet,mobile
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = { ok: true, width: innerWidth, checks: {} }
  const fail = (k, v) => { out.ok = false; out.checks[k] = v }
  const txt = el => (el ? (el.textContent || '').replace(/\s+/g, '') : '')
  if (!S.pattern.value) return { ok: false, err: '图案未就绪' }

  const mobile = innerWidth <= 780
  const tablet = innerWidth > 780 && innerWidth < 1100

  if (mobile) {
    const labels = [...document.querySelectorAll('.msTools .msTool')].map(txt)
    if (labels.join(',') !== '画笔,橡皮,换色,颜色,更多工具') fail('labels', labels)
    const more = [...document.querySelectorAll('.msTools .msTool')].find(b => txt(b) === '更多工具')
    more?.click()
    await sleep(300)
    const kinds = [...document.querySelectorAll('.msShapeGrid [data-shape-kind]')].map(el => txt(el))
    if (kinds.join(',') !== '五角星,心形,云,四角星') fail('mobileKinds', kinds)
    const star = document.querySelector('.msShapeGrid [data-shape-kind="star5"]')
    star?.click()
    await sleep(200)
    if (S.tool.value !== 'shape' || S.shapeKind.value !== 'star5') {
      fail('mobilePick', { tool: S.tool.value, kind: S.shapeKind.value })
    }
    if (document.querySelector('.msSheet--more')) fail('mobileSheet', 'still-open')
  } else if (tablet) {
    const btn = document.querySelector('.editPanel [data-tool-key="shape"]')
    if (!btn || txt(btn) !== '图形') fail('tabletBtn', btn ? txt(btn) : 'missing')
    btn?.click()
    await sleep(40)
    const kinds = [...document.querySelectorAll('.brushBar [data-shape-kind]')].map(el => txt(el))
    if (kinds.join(',') !== '五角星,心形,云,四角星') fail('tabletKinds', kinds)
    document.querySelector('.brushBar [data-shape-kind="heart"]')?.click()
    await sleep(40)
    if (S.shapeKind.value !== 'heart' || S.tool.value !== 'shape') {
      fail('tabletPick', { tool: S.tool.value, kind: S.shapeKind.value })
    }
  } else {
    const btn = document.querySelector('.csRail [data-tool-key="shape"]')
    if (!btn || txt(btn) !== '图形') fail('rail', btn ? txt(btn) : 'missing')
    document.querySelector('[data-shape-arrow]')?.click()
    await sleep(40)
    const menu = document.querySelector('[data-shape-menu]')
    const kinds = menu ? [...menu.querySelectorAll('[data-shape-kind]')].map(el => txt(el)) : []
    if (kinds.join(',') !== '五角星,心形,云,四角星') fail('menu', kinds)
    const star = menu && menu.querySelector('[data-shape-kind="star5"]')
    if (!star || star.getAttribute('aria-checked') !== 'true') fail('starOn', star && star.getAttribute('aria-checked'))
    star?.click()
    await sleep(40)
    if (document.querySelector('[data-shape-menu]')) fail('menuClosed', 'still-open')
    if (S.tool.value !== 'shape' || S.shapeKind.value !== 'star5') {
      fail('picked', { tool: S.tool.value, kind: S.shapeKind.value })
    }

    function pointFor(x, y) {
      const cv = document.querySelector('.board.editing canvas')
      const stage = document.querySelector('.stage')
      const p = S.pattern.value
      if (!cv || !stage || !p) return null
      const rect = cv.getBoundingClientRect()
      return {
        clientX: rect.left + (x + 0.5) * (rect.width / p.width),
        clientY: rect.top + (y + 0.5) * (rect.height / p.height),
        stage
      }
    }
    function pointer(type, pt) {
      pt.stage.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: pt.clientX, clientY: pt.clientY,
        button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse'
      }))
    }
    async function drag(a, b) {
      const pa = pointFor(a.x, a.y)
      const pb = pointFor(b.x, b.y)
      pointer('pointerdown', pa)
      await sleep(30)
      pointer('pointermove', pb)
      await sleep(20)
      pointer('pointerup', pb)
      await sleep(40)
    }
    const p = S.pattern.value
    const w = p.width
    const snap = () => Array.from(S.pattern.value.cells)
    const changedBox = (before, cells) => {
      let x0 = w
      let y0 = p.height
      let x1 = -1
      let y1 = -1
      let n = 0
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === before[i]) continue
        const x = i % w
        const y = (i - x) / w
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
        n++
      }
      return { x0, y0, x1, y1, n }
    }
    const before = snap()
    const depth = S.undoDepth.value
    await drag({ x: 12, y: 12 }, { x: 26, y: 20 })
    const stamped = snap()
    const box = changedBox(before, stamped)
    if (box.n < 8) fail('painted', box)
    else if (box.x1 - box.x0 !== box.y1 - box.y0) fail('square', box)
    else {
      let skew = 0
      for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) {
          const a = stamped[y * w + x] !== before[y * w + x]
          const mx = box.x0 + box.x1 - x
          const b = stamped[y * w + mx] !== before[y * w + mx]
          if (a !== b) skew++
        }
      }
      if (skew) fail('symmetry', skew)
    }
    if (document.querySelectorAll('.shapeHandle').length !== 4) fail('handles', document.querySelectorAll('.shapeHandle').length)
    if (S.undoDepth.value !== depth + 1) fail('oneStep', { before: depth, after: S.undoDepth.value })

    const anchor = { x: Math.round((box.x0 + box.x1) / 2), y: Math.round((box.y0 + box.y1) / 2) }
    await drag(anchor, { x: anchor.x + 6, y: anchor.y })
    const moved = snap()
    const movedBox = changedBox(before, moved)
    if (box.n >= 8 && movedBox.x0 < box.x0 + 3) fail('moved', { from: box, to: movedBox })
    let leaked = 0
    if (box.n >= 8) {
      for (let i = 0; i < before.length; i++) {
        const x = i % w
        const y = (i - x) / w
        const inOld = x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
        const inNew = x >= movedBox.x0 && x <= movedBox.x1 && y >= movedBox.y0 && y <= movedBox.y1
        if (!inOld && !inNew && moved[i] !== before[i]) leaked++
      }
      if (leaked) fail('leaked', leaked)
    }
    if (S.undo()) {
      const back = snap()
      let diff = 0
      for (let i = 0; i < back.length; i++) if (back[i] !== stamped[i]) diff++
      if (diff) fail('undoMove', diff)
    } else fail('undo', 'no')
    out.checks.box = box
    out.checks.moved = movedBox
  }

  if (out.ok) out.checks.final = { tool: S.tool.value, kind: S.shapeKind.value }
  return out
})()
