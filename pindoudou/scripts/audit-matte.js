/* 自检探针：在真实浏览器里驱动「自动抠背景」的完整链路。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-matte.js /editor
   返回的都是真实数字（豆数 / 空格数 / 还原度 / 耗时），不是"有没有报错"这种弱断言。 */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const [A, S, Inv] = await Promise.all([d.assets(), d.studio(), d.inventoryStore()])
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // 图案对象是 Vue 响应式代理，CDP 的 returnByValue 序列化代理会得到空对象，
  // 所以这里统一走一次 JSON 往返，拿到的才是真实内容
  const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
  const stat = p => ({
    beads: p.stats.beadCount,
    empty: p.stats.emptyCount,
    emptyPct: Math.round((p.stats.emptyRatio || 0) * 100),
    colors: p.stats.colorCount,
    sim: p.stats.similarity,
    dE: p.stats.deltaE,
    build: Math.round(p.stats.buildability * 100),
    matte: plain(p.matte),
    notes: plain(p.notes)
  })
  const out = { ok: true }

  // 关掉库存约束，保证颜色不被重新配色干扰
  Inv.useInventory.value = false

  // ---------- 1) 「① 创建」里的抠图小控件是否真的渲染出来 ----------
  // 位置断言和存在性一样重要：这个开关曾经藏在「④ 配色与优化」下面没人找得到，
  // 所以这里连「它在第几张卡里」一起测，防止以后又被挪回去。
  S.options.removeBg = true
  await sleep(400)
  out.ui = {
    inCreateCard: !!document.querySelector('.matteBar')?.closest('section.card'),
    createCardTitle: (document.querySelector('.matteBar')?.closest('section.card')?.querySelector('h3') || {}).textContent?.trim() || '',
    toggle: document.querySelectorAll('.matteBar__main[role="switch"]').length,
    levelButtons: document.querySelectorAll('.matteBar__levels .seg').length,
    statusText: (document.querySelector('.matteBar__note') || {}).textContent?.trim().slice(0, 60) || ''
  }
  S.options.removeBg = false

  // ---------- 2) 素材（自带浅色卡片背景）对照 ----------
  const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
  await S.useAsset(asset)
  S.options.boardCols = 1
  S.options.boardRows = 1
  S.options.targetColors = 13
  S.options.matteLevel = 'normal'
  out.asset = { id: asset.id, name: asset.name }

  S.options.removeBg = false
  let t = performance.now()
  S.regenerate({ keys: ['easy'], silent: true })
  out.assetNoBg = { ...stat(S.pattern.value), ms: Math.round(performance.now() - t) }

  S.options.removeBg = true
  t = performance.now()
  S.regenerate({ keys: ['easy'], silent: true })
  out.assetWithBg = { ...stat(S.pattern.value), ms: Math.round(performance.now() - t) }

  // 三档力度必须真的给出不同结果（否则档位是假的）
  const byLevel = {}
  for (const lv of ['soft', 'normal', 'strong']) {
    S.options.matteLevel = lv
    S.regenerate({ keys: ['easy'], silent: true })
    byLevel[lv] = { empty: S.pattern.value.stats.emptyCount, beads: S.pattern.value.stats.beadCount }
  }
  out.levels = byLevel
  S.options.matteLevel = 'normal'
  S.regenerate({ keys: ['easy'], silent: true })

  // ---------- 3) 橡皮擦 → 空格，统计与色板同步 ----------
  {
    const p = S.pattern.value
    const target = p.cells.findIndex(c => c >= 0)
    const colorOfTarget = p.palette[p.cells[target]].id
    const before = { beads: p.stats.beadCount, colors: p.stats.colorCount }
    S.tool.value = 'erase'
    S.paintAt(target % p.width, Math.floor(target / p.width))
    const after = S.pattern.value
    out.eraser = {
      cellValue: after.cells[target],
      before,
      after: { beads: after.stats.beadCount, colors: after.stats.colorCount },
      colorStillUsed: after.palette.some(c => c.id === colorOfTarget)
    }
    S.tool.value = 'paint'
  }

  // ---------- 4) 大图（2400×1800，白底橙圆）58×58 ----------
  {
    const c = document.createElement('canvas')
    c.width = 2400
    c.height = 1800
    const cx = c.getContext('2d')
    cx.fillStyle = '#ffffff'
    cx.fillRect(0, 0, 2400, 1800)
    cx.fillStyle = '#E87828'
    cx.beginPath()
    cx.arc(1200, 900, 700, 0, Math.PI * 2)
    cx.fill()
    const img = new Image()
    img.src = c.toDataURL('image/png')
    await new Promise(r => { img.onload = r })
    const t2 = performance.now()
    const big = await d.makeFromImage(img, { gw: 58, gh: 58, targetColors: 16, removeBg: true })
    out.big = { ...stat(big), ms: Math.round(performance.now() - t2) }
    // 圆占到画布的比例（裁到主体后应该是 ~78%）
    out.big.subjectFill = Math.round(((big.stats.cellCount - big.stats.emptyCount) / big.stats.cellCount) * 100)
    // 三个方案共用一次抠图：耗时不该是单方案的三倍
    const t3 = performance.now()
    await d.makeFromImage(img, { gw: 29, gh: 29, targetColors: 13, removeBg: true })
    out.singleMs = Math.round(performance.now() - t3)
  }

  // ---------- 5) 纯色图应当"不硬抠"并说明原因 ----------
  {
    const c2 = document.createElement('canvas')
    c2.width = 600
    c2.height = 600
    const cx2 = c2.getContext('2d')
    cx2.fillStyle = '#dddddd'
    cx2.fillRect(0, 0, 600, 600)
    const img2 = new Image()
    img2.src = c2.toDataURL('image/png')
    await new Promise(r => { img2.onload = r })
    const flat = await d.makeFromImage(img2, { gw: 29, gh: 29, removeBg: true })
    out.flat = { beads: flat.stats.beadCount, empty: flat.stats.emptyCount, matte: flat.matte }
  }

  // ---------- 6) 纵向拼图（主体贴边 + 渐变背景）不该把主体吃掉 ----------
  {
    const c3 = document.createElement('canvas')
    c3.width = 800
    c3.height = 600
    const cx3 = c3.getContext('2d')
    const g = cx3.createLinearGradient(0, 0, 0, 600)
    g.addColorStop(0, '#BFE3F5')
    g.addColorStop(1, '#8FC98A')
    cx3.fillStyle = g
    cx3.fillRect(0, 0, 800, 600)
    cx3.fillStyle = '#C0392B'
    cx3.beginPath()
    cx3.moveTo(400, 120)
    cx3.bezierCurveTo(620, 200, 620, 460, 400, 480)
    cx3.bezierCurveTo(180, 460, 180, 200, 400, 120)
    cx3.fill()
    const img3 = new Image()
    img3.src = c3.toDataURL('image/png')
    await new Promise(r => { img3.onload = r })
    const grad = await d.makeFromImage(img3, { gw: 29, gh: 29, targetColors: 13, removeBg: true })
    out.gradient = { ...stat(grad), subjectFill: Math.round(((grad.stats.cellCount - grad.stats.emptyCount) / grad.stats.cellCount) * 100) }
  }

  // ---------- 7) 投影（阴影）必须一起去掉：只剩主体，不留一圈灰豆 ----------
  // 口径：同一张图分别画「带投影」和「不带投影」两版，抠图后的豆数/包围盒应当基本一致。
  // 如果阴影被当成主体留下来，带投影那版的豆数会明显变多、包围盒会被撑大。
  {
    const S2 = 512
    const box = { x: S2 * 0.24, y: S2 * 0.14, w: S2 * 0.24, h: S2 * 0.44 }

    const makeCanvas = withShadow => {
      const c = document.createElement('canvas')
      c.width = S2
      c.height = S2
      const x = c.getContext('2d')
      x.fillStyle = '#CECCC7'
      x.fillRect(0, 0, S2, S2)
      if (withShadow) {
        // 右下角一团柔和投影，和主体在视觉上连在一起（真实产品图的样子）
        const g = x.createRadialGradient(S2 * 0.62, S2 * 0.68, 0, S2 * 0.62, S2 * 0.68, S2 * 0.28)
        g.addColorStop(0, 'rgba(90,94,106,0.92)')
        g.addColorStop(0.6, 'rgba(122,126,138,0.72)')
        g.addColorStop(1, 'rgba(206,204,199,0)')
        x.save()
        x.translate(S2 * 0.62, S2 * 0.68)
        x.scale(1, 0.36)
        x.translate(-S2 * 0.62, -S2 * 0.68)
        x.fillStyle = g
        x.beginPath()
        x.arc(S2 * 0.62, S2 * 0.68, S2 * 0.28, 0, Math.PI * 2)
        x.fill()
        x.restore()
      }
      x.fillStyle = '#2E9E8F'
      x.fillRect(box.x, box.y, box.w, box.h)
      return c
    }

    const load = c =>
      new Promise(r => {
        const im = new Image()
        im.onload = () => r(im)
        im.src = c.toDataURL('image/png')
      })

    const withShadow = await d.makeFromImage(await load(makeCanvas(true)),
      { gw: 29, gh: 29, targetColors: 13, removeBg: true, matteLevel: 'normal' })
    const withoutShadow = await d.makeFromImage(await load(makeCanvas(false)),
      { gw: 29, gh: 29, targetColors: 13, removeBg: true, matteLevel: 'normal' })
    const sw = stat(withShadow)
    const sn = stat(withoutShadow)
    out.shadow = {
      withShadow: { beads: sw.beads, empty: sw.empty, matte: sw.matte },
      withoutShadow: { beads: sn.beads, empty: sn.empty, matte: sn.matte },
      beadDelta: sw.beads - sn.beads,
      beadDeltaPct: sn.beads ? Math.round(((sw.beads - sn.beads) / sn.beads) * 1000) / 10 : null,
      shadowPickedUp: sw.matte ? sw.matte.shadowShare : null
    }
  }

  return out
})()
