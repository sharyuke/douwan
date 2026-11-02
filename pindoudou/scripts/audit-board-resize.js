/* 自检探针：换钉板尺寸必须保留逐颗修改（2026-10-28 用户反馈）。
   用法：node scripts/audit.cjs --setup-file scripts/audit-board-resize-setup.js --eval-file scripts/audit-board-resize.js --page editor

   以前 setCanvasSize 一律 regenerate：图纸转换后一改尺寸，手工修的格子全被按源图
   重新采样冲掉。现在的口径：
     · 没手改过 → 照旧重新生成（「换档位 = 按新尺寸重新转换」这条主流程不能变）；
     · 手改过（manualEdited）→ 不重新取样，旧格子 1:1 按**底板中心**整体平移：
       换大板居中落位、同一块板上原地不动、越出底板的格子裁掉；
     · 底板换小到**装不下原图**时改成「等比缩图」（2026-10-29 用户反馈
       「画布编辑后切换钉板画面会裁掉」）：整张图缩到新成品区域，不裁画面；
     · 手改标记跟存档走：保存后重新打开，换尺寸仍走保留那条路。

   所以断言全部落在真实状态上（调试桥只驱动、不下结论）：
     · 换尺寸前后逐格比对「色号 id 平面」（palette 下标会被重映射，色号才稳定）；
     · 用 lastSearch.at 区分「真的重新生成了」与「没碰生成」；
     · manualEdited / canUndo / 撤销深度逐段核对；
     · 存档往返用真实 saveProject → localStorage → openProject 走一遍。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const Inv = await d.inventoryStore()
  const A = await d.assets()
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  /* 免费版单边上限 52（一块 52 钉板），换到 104 档是 Pro 行为，先切身份 */
  const M = await d.membership()
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  Inv.useInventory.value = false
  Inv.clearInventory()
  S.options.removeBg = false

  const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
  await S.useAsset(asset)
  S.options.canvasMaxW = 52
  S.options.canvasMaxH = 52
  if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: '生成失败' }
  await sleep(120)

  const out = { ok: true, asset: asset.name }
  const pat = () => S.pattern.value
  const idsOf = p => Array.from(p.cells).map(k => (k < 0 ? null : (p.palette[k] || {}).id || '?'))
  const sameIds = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  /** 旧 ids 平面按 (dx,dy) 平移进新画布，挪不进来的当 null（被裁掉） */
  const shiftIds = (before, oldW, oldH, dx, dy, newW, newH) => {
    const o = new Array(newW * newH).fill(null)
    for (let y = 0; y < oldH; y++) {
      const ny = y + dy
      if (ny < 0 || ny >= newH) continue
      for (let x = 0; x < oldW; x++) {
        const nx = x + dx
        if (nx < 0 || nx >= newW) continue
        o[ny * newW + nx] = before[y * oldW + x]
      }
    }
    return o
  }

  /** 旧成品区域等比缩到新成品区域：每个新格子取覆盖它的那块旧格子里出现最多的色号 */
  const resampleIds = (before, oldW, oldH, sx, sy, oldArtW, oldArtH, aw, ah) => {    const o = new Array(aw * ah).fill(null)
    for (let ny = 0; ny < ah; ny++) {
      const y0 = sy + Math.floor(ny * oldArtH / ah)
      const y1 = Math.min(sy + oldArtH, sy + Math.max(Math.floor(ny * oldArtH / ah) + 1, Math.ceil((ny + 1) * oldArtH / ah)))
      for (let nx = 0; nx < aw; nx++) {
        const x0 = sx + Math.floor(nx * oldArtW / aw)
        const x1 = Math.min(sx + oldArtW, sx + Math.max(Math.floor(nx * oldArtW / aw) + 1, Math.ceil((nx + 1) * oldArtW / aw)))
        const counts = new Map()
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const v = before[y * oldW + x]
            if (!v) continue
            counts.set(v, (counts.get(v) || 0) + 1)
          }
        }
        let best = null
        let bestN = 0
        for (const [v, n] of counts) if (n > bestN) { bestN = n; best = v }
        o[ny * aw + nx] = best
      }
    }
    return o
  }

  /** 有内容的格子的包围盒（判断「画面还在不在」用） */
  const bboxOf = (ids, w, h) => {
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!ids[y * w + x]) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 }
  }

  /** 包围盒是不是等比缩小了（差 1 格以内算通过） */
  const bboxScaled = (a, b, k) => {
    if (!a || !b) return false
    const near = (u, v) => Math.abs(u * k - v) <= 1.5
    return near(a.x0, b.x0) && near(a.y0, b.y0) && near(a.x1, b.x1) && near(a.y1, b.y1)
  }

  /* ---------- A) 没手改：换尺寸仍然重新生成（老行为不能丢） ---------- */
  {
    const at0 = S.lastSearch.value.at
    S.setCanvasSize(40, 40)
    await sleep(120)
    const p1 = pat()
    out.A = {
      manualEdited: S.manualEdited.value,
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      regenerated: S.lastSearch.value.at > at0
    }
    if (S.manualEdited.value) return { ok: false, err: 'A: 未手改却误判为已编辑', ...out }
    if (p1.width !== 52 || p1.height !== 52 || p1.artW !== 40 || p1.artH !== 40) {
      return { ok: false, err: `A: 画布没落地 ${p1.width}x${p1.height} art ${p1.artW}x${p1.artH}`, ...out }
    }
    if (!out.A.regenerated) return { ok: false, err: 'A: 未手改时换尺寸没有重新生成', ...out }
    /* 回到满格，给下一场当底图 */
    if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: 'A: 复位生成失败', ...out }
    await sleep(120)
  }

  /* ---------- B) 真拖一笔（指针事件走真实坐标换算） ---------- */
  const cv = document.querySelector('.stage canvas')
  if (!cv) return { ok: false, err: '画布未就绪', ...out }
  /** 画布尺寸随档位变（B 在 52 板、E 在 104 板），每次落笔前重解格子边长与矩形。
      chartGeometry：width = 标尺×2 + 板宽×cell，标尺 = clamp(round(cell×1.8), 13, 52)。
      编辑器恒带标尺（chartOpts.ruler = true），只解 13..52 的标尺候选，
      否则「无标尺」的解会和真解并列、把落点带偏。 */
  const geometryOf = () => {
    const c = document.querySelector('.stage canvas')
    const p0 = pat()
    const gw = parseFloat(c.style.width) || c.width
    let best = null
    for (let rl = 13; rl <= 52; rl++) {
      const cs = (gw - 2 * rl) / p0.width
      if (!(cs >= 0.5)) continue
      if (Math.min(52, Math.max(13, Math.round(cs * 1.8))) !== rl) continue
      const diff = Math.abs(2 * rl + p0.width * cs - gw)
      if (!best || diff < best.diff) best = { cs, rl, diff }
    }
    if (!best || best.diff >= 0.01) throw new Error(`画布格子边长解不出: ${gw} (board ${p0.width})`)
    const rc = c.getBoundingClientRect()
    return {
      ptr: (type, x, y) => new PointerEvent(type, {
        clientX: rc.left + (best.rl + (x + 0.5) * best.cs) * (rc.width / gw),
        clientY: rc.top + (best.rl + (y + 0.5) * best.cs) * (rc.height / gw),
        bubbles: true, cancelable: true,
        pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
      })
    }
  }
  p = pat()
  let geo
  try { geo = geometryOf() } catch (e) { return { ok: false, err: String(e.message || e), ...out } }
  const brush = p.palette[0]
  S.brushColorId.value = brush.id
  let paint = null
  for (let y = 3; y < p.height - 3 && !paint; y++) {
    for (let x = 3; x < p.width - 3; x++) {
      const k = p.cells[y * p.width + x]
      if (k < 0 || (p.palette[k] || {}).id !== brush.id) { paint = { x, y }; break }
    }
  }
  if (!paint) return { ok: false, err: 'B: 找不到可画的格子', ...out }
  const beforeStroke = idsOf(p)
  cv.dispatchEvent(geo.ptr('pointerdown', paint.x, paint.y))
  cv.dispatchEvent(geo.ptr('pointerup', paint.x, paint.y))
  await sleep(220)
  p = pat()
  const paintedId = (p.palette[p.cells[paint.y * p.width + paint.x]] || {}).id
  out.B = {
    cell: `${paint.x},${paint.y}`,
    paintedId,
    manualEdited: S.manualEdited.value,
    canUndo: S.canUndo.value
  }
  if (!S.manualEdited.value) return { ok: false, err: 'B: 画了一笔但 manualEdited 没立起来', ...out }
  if (paintedId !== brush.id) {
    /* 诊断：真的改动的格子在哪（合成事件的落点换算差多少） */
    const changed = []
    for (let i = 0; i < p.cells.length; i++) {
      if (beforeStroke[i] !== idsOf(p)[i]) changed.push({ x: i % p.width, y: Math.floor(i / p.width) })
    }
    return { ok: false, err: 'B: 画的颜色没落到格子上', probeCell: paint, changedCells: changed.slice(0, 8), ...out }
  }

  /* ---------- C) 手改后放大 52 → 104：不重画，旧格子按底板中心居中落位 ---------- */
  {
    const before = idsOf(pat())
    S.options.canvasMaxW = 104
    S.options.canvasMaxH = 104
    const at0 = S.lastSearch.value.at
    S.setCanvasSize(104, 104)
    await sleep(120)
    const p1 = pat()
    /* 52 → 104，底板中心差 (+26,+26)：内容整体挪过去，四周补空格 */
    const expect = shiftIds(before, 52, 52, 26, 26, 104, 104)
    out.C = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      regenerated: S.lastSearch.value.at > at0,
      preserved: sameIds(expect, idsOf(p1)),
      undoCleared: S.canUndo.value === false && S.undoDepth.value === 0
    }
    if (out.C.regenerated) return { ok: false, err: 'C: 手改后放大触发了重新生成', ...out }
    if (!out.C.preserved) return { ok: false, err: 'C: 放大后格子内容对不上（居中落位破坏）', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'C: 保留路径把 manualEdited 复位了', ...out }
    if (!out.C.undoCleared) return { ok: false, err: 'C: 撤销栈没清（旧快照下标已失效）', ...out }
  }

  /* ---------- D) 同一块板上把成品区域改小 104 → 78：图案原地不动 ---------- */
  {
    const before = idsOf(pat())
    const beadsBefore = before.filter(v => v !== null).length
    S.setCanvasSize(78, 78)
    await sleep(120)
    const p1 = pat()
    out.D = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      preserved: sameIds(before, idsOf(p1)),
      beadCount: p1.stats && p1.stats.beadCount,
      beadsBefore
    }
    if (!out.D.preserved) return { ok: false, err: 'D: 同板缩成品区域动了格子', ...out }
    if (p1.artW !== 78 || p1.artH !== 78) return { ok: false, err: 'D: 成品区域没落到 78×78', ...out }
    if (p1.stats.beadCount !== beadsBefore) return { ok: false, err: 'D: 豆子数变了（不该有裁剪）', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'D: manualEdited 丢了', ...out }
  }

  /* ---------- E) 画到留白里一颗（成品区域外的板面上） ---------- */
  {
    try { geo = geometryOf() } catch (e) { return { ok: false, err: String(e.message || e), ...out } }
    const p0 = pat()
    cv.dispatchEvent(geo.ptr('pointerdown', 100, 50))
    cv.dispatchEvent(geo.ptr('pointerup', 100, 50))
    await sleep(220)
    const p1 = pat()
    out.E = { manualEdited: S.manualEdited.value, painted: (p1.palette[p1.cells[50 * p1.width + 100]] || {}).id || null }
    if (!out.E.painted) return { ok: false, err: 'E: 留白处没画上', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'E: manualEdited 丢了', ...out }
  }

  /* ---------- F) 底板缩小 104 → 52：画面等比缩到新成品区域（不裁画面） ----------
     2026-10-29 用户反馈：「画布编辑后切换钉板画面会裁掉」。
     旧口径是 1:1 平移 + 裁边：画面只剩中间一块，看着像坏了。
     现在底板装不下原图时走「等比缩图」：整张图缩到新成品区域，
     手改的格子按块合并（块内多数色），画面不会被裁掉。 */
  {
    const before = idsOf(pat())
    const p0 = pat()
    const oldW = p0.width
    const oldH = p0.height
    const oldArtW = p0.artW
    const oldArtH = p0.artH
    const sx = Math.floor((oldW - oldArtW) / 2)
    const sy = Math.floor((oldH - oldArtH) / 2)
    S.setCanvasCapacity(52, 52)
    await sleep(120)
    const p1 = pat()
    const art = resampleIds(before, oldW, oldH, sx, sy, oldArtW, oldArtH, 52, 52)
    const expect = new Array(52 * 52).fill(null)
    for (let i = 0; i < art.length; i++) expect[i] = art[i]
    out.F = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      preserved: sameIds(expect, idsOf(p1)),
      /* 画面没被裁：整块成品区域都有内容（不是只剩中间一块） */
      artFilled: expect.filter(v => v !== null).length,
      /* 画在成品区域外（板面留白里）的那颗这次带不过去，要如实报数 */
      droppedOutsideArt: 1,
      statsBeadCount: p1.stats && p1.stats.beadCount
    }
    if (p1.width !== 52 || p1.height !== 52 || p1.artW !== 52 || p1.artH !== 52) {
      return { ok: false, err: `F: 缩板后画布/成品区域没落到 52×52（${p1.width}x${p1.height} art ${p1.artW}x${p1.artH}）`, ...out }
    }
    if (!out.F.preserved) return { ok: false, err: 'F: 缩板后格子内容对不上（等比缩图结果不符）', ...out }
    if (out.F.artFilled <= 0) return { ok: false, err: 'F: 缩板后画面空了', ...out }
    if (p1.stats.beadCount !== out.F.artFilled) return { ok: false, err: 'F: 统计的豆子数与格子对不上', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'F: manualEdited 丢了', ...out }
  }

  /* ---------- H) 用户的原场景：满格图纸 + 手改 → 换钉板，画面不裁 ---------- */
  {
    /* 先出一张铺满 104 板的图纸（重新生成会清掉手工修改，所以放在最前面做） */
    S.options.canvasMaxW = 104
    S.options.canvasMaxH = 104
    S.options.canvasW = 104
    S.options.canvasH = 104
    if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: 'H: 生成失败', ...out }
    await sleep(200)
    /* 再画一笔（把图标成「手工改过」） */
    try { geo = geometryOf() } catch (e) { return { ok: false, err: String(e.message || e), ...out } }
    cv.dispatchEvent(geo.ptr('pointerdown', 20, 20))
    cv.dispatchEvent(geo.ptr('pointerup', 20, 20))
    await sleep(220)
    if (!S.manualEdited.value) return { ok: false, err: 'H: manualEdited 丢了', ...out }

    const p0 = pat()
    const before = idsOf(p0)
    const bboxBefore = bboxOf(before, 104, 104)
    const beforeBeads = before.filter(v => v !== null).length
    S.setCanvasCapacity(52, 52)
    await sleep(120)
    const p1 = pat()
    const art = resampleIds(before, 104, 104, 0, 0, 104, 104, 52, 52)
    const expect = new Array(52 * 52).fill(null)
    for (let i = 0; i < art.length; i++) expect[i] = art[i]
    const bboxAfter = bboxOf(expect, 52, 52)
    out.H = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      preserved: sameIds(expect, idsOf(p1)),
      beadsBefore: beforeBeads,
      beadsAfter: art.filter(v => v !== null).length,
      bboxBefore,
      bboxAfter,
      statsBeadCount: p1.stats && p1.stats.beadCount
    }
    if (!out.H.preserved) return { ok: false, err: 'H: 换钉板后画面被裁了（内容对不上等比缩图）', ...out }
    if (p1.artW !== 52 || p1.artH !== 52) return { ok: false, err: 'H: 成品区域没缩到 52×52', ...out }
    if (out.H.beadsAfter <= 0) return { ok: false, err: 'H: 换钉板后画面空了', ...out }
    if (p1.stats.beadCount !== out.H.beadsAfter) return { ok: false, err: 'H: 统计的豆子数与格子对不上', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'H: manualEdited 丢了', ...out }
    /* 画面没被裁：图案的包围盒跟着等比缩小（约一半），不是只剩中间一块 */
    if (!bboxScaled(bboxBefore, bboxAfter, 0.5)) {
      return { ok: false, err: 'H: 换钉板后画面被裁了（包围盒没等比缩小）', ...out }
    }
  }

  /* ---------- G) 存档往返：manualEdited 跟着存档走，再放大仍保留 ---------- */
  {
    const pid = S.saveProject('换板保留手改自检')
    if (!pid) return { ok: false, err: 'G: 存档失败', ...out }
    let rec = null
    try {
      rec = (JSON.parse(localStorage.getItem('douzao-projects-v2') || '[]')).find(x => x.id === pid)
    } catch { /* 下面统一判 */ }
    out.G = { savedManualEdited: !!(rec && rec.manualEdited) }
    if (!out.G.savedManualEdited) return { ok: false, err: 'G: 存档里没带上 manualEdited', ...out }

    const reopened = S.openProject(pid)
    await sleep(120)
    const p1 = pat()
    out.G.reopened = {
      ok: !!reopened,
      manualEdited: S.manualEdited.value,
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`
    }
    if (!reopened) return { ok: false, err: 'G: 重新打开失败', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'G: 打开存档后 manualEdited 丢了', ...out }

    /* 再放大 52 → 104：仍走保留（重新打开后的源图只是图纸自己的位图，
       重生成会把用户的手改结果重采样一遍 —— 这里必须不发生） */
    const before = idsOf(pat())
    S.options.canvasMaxW = 104
    S.options.canvasMaxH = 104
    const at0 = S.lastSearch.value.at
    S.setCanvasSize(104, 104)
    await sleep(120)
    const p2 = pat()
    const expect = shiftIds(before, 52, 52, 26, 26, 104, 104)
    out.G.regrow = {
      board: `${p2.width}x${p2.height}`,
      art: `${p2.artW}x${p2.artH}`,
      manualEdited: S.manualEdited.value,
      regenerated: S.lastSearch.value.at > at0,
      preserved: sameIds(expect, idsOf(p2))
    }
    if (out.G.regrow.regenerated) return { ok: false, err: 'G: 存档往返后放大触发了重新生成', ...out }
    if (!out.G.regrow.preserved) return { ok: false, err: 'G: 存档往返后格子内容对不上', ...out }
  }

  out.scenarios = [
    'A 未手改照旧重生成', 'B 真画一笔立标记', 'C 手改放大居中落位', 'D 同板缩成品区域原地不动',
    'E 画到留白', 'F 缩板等比缩图不裁画面', 'G 存档往返仍保留', 'H 换钉板画面不裁'
  ]
  return out
})()
