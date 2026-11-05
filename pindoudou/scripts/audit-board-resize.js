/* 自检探针：手改过的图纸换尺寸必须保留逐颗修改，且**画面跟着成品区域缩放**
   （2026-10-28 / 10-29 / 10-31 / 11-01 用户反馈）。
   用法：node scripts/audit.cjs --setup-file scripts/audit-board-resize-setup.js --eval-file scripts/audit-board-resize.js --page editor

   以前 setCanvasSize 一律 regenerate：图纸转换后一改尺寸，手工修的格子全被按源图
   重新采样冲掉。2026-11-01 定下的口径把「原图」与「手改」分成两层：
     · **原图部分** → 每次换尺寸都按真原图在新网格上重新取样（放大长细节、缩小块合并），
       不复制工作区里那张已经缩过的图；
     · **手改部分** → 独立修改层（editLayer）按**改那一刻的网格**保存，投影到新网格：
       放大 = 一颗铺满对应的块，缩小 = 块内改过的值占多数者胜；
     · 成品区域变了 → 画面按新网格重建（界面写「78 × 78 颗」，画面就是 78 × 78 格大）；
     · 成品区域没变（只换了大底板）→ 旧格子 1:1 按**底板中心**整体平移、居中落位；
     · 手改标记跟存档走：保存后重新打开，换尺寸仍走保留那条路。

   ⚠️ 2026-11-01 最终口径（用户：「缩放分两部分：原图部分按原图缩放，修改的部分按修改时
   所在的尺寸缩放」）：
     · **原图部分**每次换尺寸都按**真原图**在新网格上重新取样 —— 每个尺寸的效果都来自原图，
       不复制工作区里那张已经缩过的图；**不弹层**；
     · **修改过的部分**存在独立的修改层里（editLayer），分辨率 = 改那一刻的网格：
       在 104 上改的一颗，缩到 52 再放回 104 仍是那一颗；在 52 上改的一颗，放大到 104 是 2×2；
     · 只换钉板（成品区域不变）→ 旧格子 1:1 居中平移，不重新取样；
     · 老存档的源图是按图纸重建的（sourceFromPattern）→ 那不是原图，退回按当前图纸块缩放。
   2026-11-05 补充（用户硬性要求）：小尺寸回到用过的尺寸时，直接还原那个尺寸的生成结果，
   细节与颜色数量一颗不少（`restored` 为 true），保存 / 未保存的作品都一样。
   所以本探针里：A / C / D / F / H 换到没生成过的尺寸**重新取样**（`regenerated` 为 true）；
   G 存档往返后放大、I 缩回用过的 52 都走尺寸缓存**还原**（`restored` 为 true）；
   手改格子的期望位置由 `projectEditKeys` 按修改层投影算出来；C2 只换钉板仍是 1:1 平移。

   所以断言全部落在真实状态上（调试桥只驱动、不下结论）：
     · 换尺寸前后逐格比对「色号 id 平面」（palette 下标会被重映射，色号才稳定）；
     · 手改格子的期望位置由探针按修改层投影算一遍（projectEditKeys），逐格对照；
     · 用 lastSearch.at 区分「真的重新取样了」与「没碰生成」；
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
  /** 手工修改记录 → 排序后的格子下标（没记录时是空数组） */
  const editKeys = p => (p.editMap instanceof Map ? [...p.editMap.keys()].sort((a, b) => a - b) : [])
  /** 旧记录按「成品区域等比映射」落到新画布上的下标（与 useStudio.applyPatternEdits 同口径） */
  const mapEditKeys = (p0, bw, bh, aw, ah) => {
    const sx = Math.floor((p0.width - p0.artW) / 2)
    const sy = Math.floor((p0.height - p0.artH) / 2)
    const ox = Math.floor((bw - aw) / 2)
    const oy = Math.floor((bh - ah) / 2)
    const out = []
    for (const i of editKeys(p0)) {
      const rx = (i % p0.width) - sx
      const ry = Math.floor(i / p0.width) - sy
      if (rx < 0 || ry < 0 || rx >= p0.artW || ry >= p0.artH) continue
      const nx = Math.min(aw - 1, Math.floor(rx * aw / p0.artW))
      const ny = Math.min(ah - 1, Math.floor(ry * ah / p0.artH))
      out.push((oy + ny) * bw + ox + nx)
    }
    return out.sort((a, b) => a - b)
  }
  /** 修改层投影到新成品区域：层里每一颗改过的格子盖住目标网格上的那一块，
      块里的格子都算「改过」（与 useStudio.applyEditLayer 同口径）。
      层分辨率 = 改那一刻的网格，所以放大是块、缩小是块内合并，精度不会被当前网格吃掉。 */
  const projectEditKeys = (p0, bw, bh, aw, ah) => {
    const layer = p0.editLayer && p0.editLayer.mask ? p0.editLayer : null
    if (!layer) return mapEditKeys(p0, bw, bh, aw, ah)
    const ox = Math.floor((bw - aw) / 2)
    const oy = Math.floor((bh - ah) / 2)
    const keys = new Set()
    for (let i = 0; i < layer.mask.length; i++) {
      if (!layer.mask[i]) continue
      const x = i % layer.w
      const y = (i - x) / layer.w
      const tx0 = Math.floor(x * aw / layer.w)
      const tx1 = Math.min(aw - 1, Math.ceil((x + 1) * aw / layer.w) - 1)
      const ty0 = Math.floor(y * ah / layer.h)
      const ty1 = Math.min(ah - 1, Math.ceil((y + 1) * ah / layer.h) - 1)
      for (let ny = ty0; ny <= ty1; ny++) {
        for (let nx = tx0; nx <= tx1; nx++) keys.add((oy + ny) * bw + ox + nx)
      }
    }
    return [...keys].sort((a, b) => a - b)
  }
  const sameKeys = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

  /** 有内容的格子的包围盒（判断「画面还在不在」用） */
  const bboxOf = (ids, w, h) => {    let x0 = w
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

  /** 限定在某个矩形里的包围盒（只看成品区域里的画面） */
  const bboxIn = (ids, w, h, rx0, ry0, rx1, ry1) => {
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        if (!ids[y * w + x]) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 }
  }

  /** 相对成品区域左上角的包围盒：画面缩放前后要拿这个比（成品区域本身也在挪） */
  const bboxRel = (ids, w, h, ox, oy, aw, ah) => {
    const b = bboxIn(ids, w, h, ox, oy, ox + aw, oy + ah)
    return b ? { x0: b.x0 - ox, y0: b.y0 - oy, x1: b.x1 - ox, y1: b.y1 - oy } : null
  }

  /** 包围盒是不是等比缩小了（差 1 格以内算通过） */
  const bboxScaled = (a, b, k, tol = 1.5) => {
    if (!a || !b) return false
    const near = (u, v) => Math.abs(u * k - v) <= tol
    return near(a.x0, b.x0) && near(a.y0, b.y0) && near(a.x1, b.x1) && near(a.y1, b.y1)
  }

  /* ---------- A) 没手改：换尺寸按原图重新取样（每个尺寸都来自原图） ---------- */
  {
    const at0 = S.lastSearch.value.at
    S.setCanvasSize(40, 40)
    await sleep(400)
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
    if (!out.A.regenerated) return { ok: false, err: 'A: 未手改时换尺寸没按原图重新取样', ...out }
    /* 回到满格，给下一场当底图 */
    if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: 'A: 复位生成失败', ...out }
    await sleep(120)
  }

  /* ---------- B) 真拖一笔（指针事件走真实坐标换算） ---------- */
  const cv = document.querySelector('.stage canvas')
  if (!cv) return { ok: false, err: '画布未就绪', ...out }
  /** 画布尺寸随档位变（B 在 52 板、E 在 104 板），每次落笔前重解格子边长与矩形。
      全屏工作台 / 手机工作台（chrome = console，≥1100 或 ≤780）把标尺画成覆盖层，
      位图里**没有**标尺：width = 板宽×cell；平板（781..1099）仍是位图内标尺：
      width = 标尺×2 + 板宽×cell，标尺 = clamp(round(cell×1.8), 13, 52)。
      两种口径分开解，别拿「位图内标尺」去套覆盖层（会整整偏一格）。 */
  const geometryOf = () => {
    const c = document.querySelector('.stage canvas')
    const p0 = pat()
    const gw = parseFloat(c.style.width) || c.width
    const gh = parseFloat(c.style.height) || c.height
    const rc = c.getBoundingClientRect()
    const ptrAt = (cs, rl) => (type, x, y) => new PointerEvent(type, {
      clientX: rc.left + (rl + (x + 0.5) * cs) * (rc.width / gw),
      clientY: rc.top + (rl + (y + 0.5) * cs) * (rc.height / gh),
      bubbles: true, cancelable: true,
      pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
    })
    const consoleChrome = window.matchMedia('(min-width:1100px)').matches ||
      window.matchMedia('(max-width:780px)').matches
    if (consoleChrome) {
      const cs = gw / p0.width
      if (!(cs >= 0.5)) throw new Error(`画布格子边长解不出: ${gw} (board ${p0.width})`)
      return { ptr: ptrAt(cs, 0) }
    }
    let best = null
    for (let rl = 13; rl <= 52; rl++) {
      const cs = (gw - 2 * rl) / p0.width
      if (!(cs >= 0.5)) continue
      if (Math.min(52, Math.max(13, Math.round(cs * 1.8))) !== rl) continue
      const diff = Math.abs(2 * rl + p0.width * cs - gw)
      if (!best || diff < best.diff) best = { cs, rl, diff }
    }
    if (!best || best.diff >= 0.01) throw new Error(`画布格子边长解不出: ${gw} (board ${p0.width})`)
    return { ptr: ptrAt(best.cs, best.rl) }
  }
  p = pat()
  let geo
  try { geo = geometryOf() } catch (e) { return { ok: false, err: String(e.message || e), ...out } }
  const brush = p.palette[0]
  S.brushColorId.value = brush.id
  /* 画在成品区域里（底板四周的留白不属于图案，改那里不会随尺寸落回） */
  const ax = Math.floor((p.width - p.artW) / 2)
  const ay = Math.floor((p.height - p.artH) / 2)
  let paint = null
  for (let y = ay + 3; y < ay + p.artH - 3 && !paint; y++) {
    for (let x = ax + 3; x < ax + p.artW - 3; x++) {
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

  /* ---------- C2) 只换钉板（成品区域不变）：格子 1:1 居中落位，不重新生成 ----------
     这是 2026-10-28 那条需求的原场景（「换钉板尺寸时已经编辑好的图不要重置」）：
     底板变大、成品区域不动，旧格子整体挪进去就行。 */
  {
    const p0 = pat()
    const before = idsOf(p0)
    const at0 = S.lastSearch.value.at
    S.setCanvasCapacity(104, 104)
    await sleep(150)
    const p1 = pat()
    const dx = Math.round(104 / 2 - p0.width / 2)
    const dy = Math.round(104 / 2 - p0.height / 2)
    const expect = shiftIds(before, p0.width, p0.height, dx, dy, 104, 104)
    out.C2 = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      regenerated: S.lastSearch.value.at > at0,
      preserved: sameIds(expect, idsOf(p1))
    }
    if (out.C2.regenerated) return { ok: false, err: 'C2: 只换钉板却重新生成了（手改被冲掉）', ...out }
    if (!out.C2.preserved) return { ok: false, err: 'C2: 换钉板后格子没 1:1 居中落位', ...out }
    if (p1.artW !== 40 || p1.artH !== 40) return { ok: false, err: `C2: 成品区域不该变（art ${p1.artW}x${p1.artH}）`, ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'C2: manualEdited 丢了', ...out }
  }

  /* ---------- C) 手改后放大成品区域 40 → 104：按原图重新取样（长细节），手改按修改层落回 ---------- */
  {
    const p0 = pat()
    const expectKeys = projectEditKeys(p0, 104, 104, 104, 104)
    const at0 = S.lastSearch.value.at
    S.setCanvasSize(104, 104)
    await sleep(200)
    const p1 = pat()
    out.C = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      regenerated: S.lastSearch.value.at > at0,
      editsKept: sameKeys(expectKeys, editKeys(p1)),
      beads: p1.stats && p1.stats.beadCount
    }
    if (!out.C.regenerated) return { ok: false, err: 'C: 放大没按原图重新取样（画面该长细节）', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'C: 放大后 manualEdited 丢了', ...out }
    if (!out.C.editsKept) return { ok: false, err: 'C: 放大后手改的格子没按修改层落回去', ...out }
    if (p1.artW !== 104 || p1.artH !== 104) return { ok: false, err: `C: 成品区域没落到 104（art ${p1.artW}x${p1.artH}）`, ...out }
    if (!(out.C.beads > 0)) return { ok: false, err: 'C: 放大后画面空了', ...out }
    /* 再画一笔：D 要一张「手改过」的图 */
    try { geo = geometryOf() } catch (e) { return { ok: false, err: String(e.message || e), ...out } }
    const pp = pat()
    const brushId = pp.palette[0].id
    S.brushColorId.value = brushId
    let cell = null
    for (let y = 30; y < pp.height - 3 && !cell; y++) {
      for (let x = 30; x < pp.width - 3; x++) {
        const k = pp.cells[y * pp.width + x]
        if (k < 0 || (pp.palette[k] || {}).id !== brushId) { cell = { x, y }; break }
      }
    }
    if (!cell) return { ok: false, err: 'C: 找不到可画的格子', ...out }
    cv.dispatchEvent(geo.ptr('pointerdown', cell.x, cell.y))
    cv.dispatchEvent(geo.ptr('pointerup', cell.x, cell.y))
    await sleep(220)
    if (!S.manualEdited.value) return { ok: false, err: 'C: 重画一笔后 manualEdited 没立起来', ...out }
  }

  /* ---------- D) 同一块板上把成品区域改小 104 → 78：画面跟着缩、手改落回新网格 ---------- */
  {
    const p0 = pat()
    const before = idsOf(p0)
    const beadsBefore = before.filter(v => v !== null).length
    const expectKeys = projectEditKeys(p0, 104, 104, 78, 78)
    const at0 = S.lastSearch.value.at
    S.setCanvasSize(78, 78)
    await sleep(400)
    const p1 = pat()
    const afterIds = idsOf(p1)
    out.D = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      regenerated: S.lastSearch.value.at > at0,
      editsKept: sameKeys(expectKeys, editKeys(p1)),
      beadCount: p1.stats && p1.stats.beadCount,
      beadsBefore,
      bboxBefore: bboxRel(before, 104, 104, 0, 0, 104, 104),
      bboxAfter: bboxRel(afterIds, 104, 104, 13, 13, 78, 78)
    }
    if (!out.D.regenerated) return { ok: false, err: 'D: 缩成品区域没按原图重新取样', ...out }
    if (!out.D.editsKept) return { ok: false, err: 'D: 缩成品区域后手改的格子没落回新网格', ...out }
    if (p1.artW !== 78 || p1.artH !== 78) return { ok: false, err: 'D: 成品区域没落到 78×78', ...out }
    if (p1.stats.beadCount !== afterIds.filter(v => v !== null).length) return { ok: false, err: 'D: 统计的豆子数与格子对不上', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'D: manualEdited 丢了', ...out }
    /* 画面跟着等比缩小（相对成品区域比，差 2 格以内算通过） */
    if (!bboxScaled(out.D.bboxBefore, out.D.bboxAfter, 78 / 104, 2)) {
      return { ok: false, err: 'D: 同板缩成品区域后画面没跟着缩（包围盒没变）', ...out }
    }
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
    const p0 = pat()
    const before = idsOf(p0)
    const expectKeys = projectEditKeys(p0, 52, 52, 52, 52)
    const at0 = S.lastSearch.value.at
    S.setCanvasCapacity(52, 52)
    await sleep(400)
    const p1 = pat()
    const afterIds = idsOf(p1)
    out.F = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      regenerated: S.lastSearch.value.at > at0,
      editsKept: sameKeys(expectKeys, editKeys(p1)),
      /* 画面没被裁：整块成品区域都有内容（不是只剩中间一块） */
      artFilled: afterIds.filter(v => v !== null).length,
      bboxBefore: bboxRel(before, p0.width, p0.height,
        Math.floor((p0.width - p0.artW) / 2), Math.floor((p0.height - p0.artH) / 2), p0.artW, p0.artH),
      bboxAfter: bboxRel(afterIds, 52, 52, 0, 0, 52, 52),
      statsBeadCount: p1.stats && p1.stats.beadCount
    }
    if (p1.width !== 52 || p1.height !== 52 || p1.artW !== 52 || p1.artH !== 52) {
      return { ok: false, err: `F: 缩板后画布/成品区域没落到 52×52（${p1.width}x${p1.height} art ${p1.artW}x${p1.artH}）`, ...out }
    }
    if (!out.F.regenerated) return { ok: false, err: 'F: 缩板没按原图重新取样', ...out }
    if (!out.F.editsKept) return { ok: false, err: 'F: 缩板后手改的格子没落回新网格', ...out }
    if (out.F.artFilled <= 0) return { ok: false, err: 'F: 缩板后画面空了', ...out }
    if (p1.stats.beadCount !== out.F.artFilled) return { ok: false, err: 'F: 统计的豆子数与格子对不上', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'F: manualEdited 丢了', ...out }
    /* 画面没被裁：图案的包围盒跟着等比缩小（约 0.5），不是只剩中间一块 */
    const sx0 = Math.floor((p0.width - p0.artW) / 2)
    const sy0 = Math.floor((p0.height - p0.artH) / 2)
    const bboxBefore = bboxRel(before, p0.width, p0.height, sx0, sy0, p0.artW, p0.artH)
    const bboxAfter = bboxRel(afterIds, 52, 52, 0, 0, 52, 52)
    if (!bboxScaled(bboxBefore, bboxAfter, 52 / p0.artW)) {
      return { ok: false, err: 'F: 换钉板后画面被裁了（包围盒没等比缩小）', ...out }
    }
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
    const expectKeys = projectEditKeys(p0, 52, 52, 52, 52)
    const beforeBeads = before.filter(v => v !== null).length
    const at0 = S.lastSearch.value.at
    S.setCanvasCapacity(52, 52)
    await sleep(400)
    const p1 = pat()
    const afterIds = idsOf(p1)
    const bboxAfter = bboxOf(afterIds, 52, 52)
    out.H = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      regenerated: S.lastSearch.value.at > at0,
      editsKept: sameKeys(expectKeys, editKeys(p1)),
      beadsBefore: beforeBeads,
      beadsAfter: afterIds.filter(v => v !== null).length,
      bboxBefore,
      bboxAfter,
      statsBeadCount: p1.stats && p1.stats.beadCount
    }
    if (!out.H.regenerated) return { ok: false, err: 'H: 换钉板没按原图重新取样', ...out }
    if (!out.H.editsKept) return { ok: false, err: 'H: 换钉板后手改的格子没落回新网格', ...out }
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
    out.G = { savedManualEdited: !!(rec && rec.manualEdited), savedSource: !!(rec && rec.source && rec.source.url) }
    if (!out.G.savedManualEdited) return { ok: false, err: 'G: 存档里没带上 manualEdited', ...out }
    /* 存档要带源图快照：重新打开后放大按它重新取样（没有快照的老存档也有兜底，
       源图按图纸平滑重建 —— 见 useStudio 的 rebuildThumbSource） */
    if (!out.G.savedSource) return { ok: false, err: 'G: 存档里没带上源图快照', ...out }

    const reopened = S.openProject(pid)
    /* 源图是异步解码的：等它真的能画了再往下（超时 3 秒，报错时把状态带出来） */
    for (let i = 0; i < 30; i++) {
      const im = S.sourceImg.value
      if (im && (im.naturalWidth || im.width)) break
      await sleep(100)
    }
    const p1 = pat()
    out.G.reopened = {
      ok: !!reopened,
      manualEdited: S.manualEdited.value,
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      sourceReady: !!(S.sourceImg.value && (S.sourceImg.value.naturalWidth || S.sourceImg.value.width)),
      sourceFromPattern: S.sourceFromPattern.value,
      sourceUrlHead: String(S.sourceUrl.value || '').slice(0, 24)
    }
    if (!reopened) return { ok: false, err: 'G: 重新打开失败', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'G: 打开存档后 manualEdited 丢了', ...out }

    /* 再放大 52 → 104：这个尺寸之前生成过（存档里带了尺寸缓存），直接还原那一份，
       细节与颜色数量原样回来；缓存没命中才回源图重新取样。 */
    const at0 = S.lastSearch.value.at
    /* 底板也得放得下（界面上的档位快选会顺带把底板撑到放得下，见 EditorSidebar 的 pickBox） */
    S.options.canvasMaxW = 104
    S.options.canvasMaxH = 104
    const regrow = S.setCanvasSize(104, 104)
    await sleep(250)
    const p2 = pat()
    out.G.regrow = {
      board: `${p2.width}x${p2.height}`,
      art: `${p2.artW}x${p2.artH}`,
      manualEdited: S.manualEdited.value,
      restored: !!(regrow && regrow.restored),
      regenerated: S.lastSearch.value.at > at0,
      editsKept: sameKeys(projectEditKeys(p1, 104, 104, 104, 104), editKeys(p2)),
      beads: p2.stats && p2.stats.beadCount
    }
    if (!out.G.regrow.restored) return { ok: false, err: 'G: 存档往返后放大没还原到 104 那一份（细节与颜色数量应原样回来）', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'G: 放大后 manualEdited 丢了（手改记录没跟存档走）', ...out }
    if (!out.G.regrow.editsKept) return { ok: false, err: 'G: 存档往返后放大，手改的格子没落回去', ...out }
    if (p2.artW !== 104 || p2.artH !== 104) return { ok: false, err: `G: 成品区域没落到 104（art ${p2.artW}x${p2.artH}）`, ...out }
    if (!(out.G.regrow.beads > 0)) return { ok: false, err: 'G: 放大后画面空了', ...out }
  }

  /* ---------- I) 用户原场景：同一块板上拖清晰度滑杆 → 画面在画布上等比缩小 ----------
     2026-10-29 用户反馈：「拉动调整的是画面在画布上的大小，不是调整画布大小」。
     旧口径只把成品区域的框改小、画面照旧留在原处 —— 界面写「78 × 78 颗」，
     画面却还是 104 格大，数字与画面对不上（看着像坏了）。
     现在成品区域一变，画面就跟着等比缩到新的成品区域里。 */
  {
    /* 先画一笔：G 结尾刚重新生成过（manualEdited 已清），这一场要验的是「手改图缩小」 */
    try { geo = geometryOf() } catch (e) { return { ok: false, err: String(e.message || e), ...out } }
    const pp0 = pat()
    const brushId0 = pp0.palette[0].id
    S.brushColorId.value = brushId0
    let cell0 = null
    for (let y = 3; y < pp0.height - 3 && !cell0; y++) {
      for (let x = 3; x < pp0.width - 3; x++) {
        const k = pp0.cells[y * pp0.width + x]
        if (k < 0 || (pp0.palette[k] || {}).id !== brushId0) { cell0 = { x, y }; break }
      }
    }
    if (!cell0) return { ok: false, err: 'I: 找不到可画的格子', ...out }
    cv.dispatchEvent(geo.ptr('pointerdown', cell0.x, cell0.y))
    cv.dispatchEvent(geo.ptr('pointerup', cell0.x, cell0.y))
    await sleep(220)
    if (!S.manualEdited.value) return { ok: false, err: 'I: 画一笔后 manualEdited 没立起来', ...out }
    const before = idsOf(pat())
    const p0i = pat()
    const bboxBefore = bboxRel(before, 104, 104, 0, 0, 104, 104)
    const expectKeys = projectEditKeys(p0i, 104, 104, 52, 52)
    const at0 = S.lastSearch.value.at
    /* 52 这个尺寸之前用过（H / G 缩到过），这里会直接还原那一份 */
    const shrunk = S.setCanvasSize(52, 52)
    await sleep(400)
    const p1 = pat()
    const afterIds = idsOf(p1)
    const bboxAfter = bboxRel(afterIds, 104, 104, 26, 26, 52, 52)
    /* 成品区域在 104 板中间：ox = oy = (104-52)/2 = 26 */
    const artX0 = Math.floor((104 - 52) / 2)
    out.I = {
      board: `${p1.width}x${p1.height}`,
      art: `${p1.artW}x${p1.artH}`,
      manualEdited: S.manualEdited.value,
      restored: !!(shrunk && shrunk.restored),
      regenerated: S.lastSearch.value.at > at0,
      editsKept: sameKeys(expectKeys, editKeys(p1)),
      beadCount: p1.stats && p1.stats.beadCount,
      artFilled: afterIds.filter(v => v !== null).length,
      bboxBefore,
      bboxAfter
    }
    if (p1.artW !== 52 || p1.artH !== 52) return { ok: false, err: 'I: 成品区域没落到 52×52', ...out }
    if (!out.I.restored && !out.I.regenerated) return { ok: false, err: 'I: 拖滑杆缩小既没还原缓存也没按原图重新取样', ...out }
    if (!out.I.editsKept) return { ok: false, err: 'I: 拖滑杆后手改的格子没落回新网格', ...out }
    if (p1.stats.beadCount !== out.I.artFilled) return { ok: false, err: 'I: 统计的豆子数与格子对不上', ...out }
    if (!S.manualEdited.value) return { ok: false, err: 'I: manualEdited 丢了', ...out }
    /* 画面缩了（包围盒跟着等比缩小一半） */
    if (!bboxScaled(bboxBefore, bboxAfter, 0.5)) {
      return { ok: false, err: 'I: 拖滑杆后画面没跟着缩（包围盒没等比缩小）', ...out }
    }
    /* 而且整个画面都落在新的成品区域里（不再溢出到框外）：用的是相对成品区域的包围盒 */
    if (!bboxAfter || bboxAfter.x0 < 0 || bboxAfter.y0 < 0 ||
        bboxAfter.x1 > 51 || bboxAfter.y1 > 51) {
      return { ok: false, err: 'I: 画面跑出成品区域了', ...out }
    }
  }

  /* ---------- J) 缩小再放大：每个尺寸都从原图重新取样，细节一颗不少 ---------- */
  {
    S.options.canvasMaxW = 104
    S.options.canvasMaxH = 104
    S.options.canvasW = 104
    S.options.canvasH = 104
    if (!S.regenerate({ keys: ['easy'], silent: true })) return { ok: false, err: 'J: 重新生成失败', ...out }
    await sleep(220)
    const beforeIds = idsOf(pat())
    S.setCanvasSize(52, 52)
    await sleep(150)
    const small = pat()
    S.setCanvasSize(104, 104)
    await sleep(150)
    const p2 = pat()
    const afterIds = idsOf(p2)
    let diff = 0
    for (let i = 0; i < afterIds.length && i < beforeIds.length; i++) {
      if (afterIds[i] !== beforeIds[i]) diff++
    }
    out.J = { small: `${small.artW}x${small.artH}`, art: `${p2.artW}x${p2.artH}`, diff }
    if (small.artW !== 52 || small.artH !== 52) return { ok: false, err: 'J: 没缩到 52', ...out }
    if (p2.artW !== 104 || p2.artH !== 104) return { ok: false, err: 'J: 放大没回到 104', ...out }
    if (diff) return { ok: false, err: `J: 缩小再放大后有 ${diff} 格细节没回来`, ...out }
  }

  out.scenarios = [
    'A 未手改：换尺寸按原图重新取样', 'B 真画一笔立标记', 'C2 只换钉板：1:1 居中不重生成',
    'C 手改放大：原图重新取样 + 修改层落回',
    'D 同板缩成品区域：画面等比缩小', 'E 画到留白', 'F 缩板按原图重新取样不裁画面',
    'G 存档往返：放大还原 104 那一份、修改层跟着走', 'H 换钉板画面不裁', 'I 拖清晰度滑杆：画面在画布上缩放',
    'J 缩小再放大：细节回到原样'
  ]
  return out
})()
