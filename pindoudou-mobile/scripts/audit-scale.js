/* =========================================================================
   自检探针：画布档位（52 → 312 格，自定义最大单边 1000 格）真的能用吗？

   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-scale.js --page editor,editorProject
        （最大的几档要连生三个方案、几十万格，跑之前先设 AUDIT_CDP_TIMEOUT_MS=240000）

   口径（见 lib/boardSpec.js）：拼板只有 52 / 78 / 104 钉三个规格，一钉 = 一格，
   所以档位阶梯是 52 / 78 / 104 / 156 / 208 / 312（不超过 6 档），更大的走
   「② 画布大小 → 自定义尺寸：规格 × 横向几块 × 纵向几块」。

   为什么需要它：画布放开到几十万格之后，「能不能生成」只是第一步 ——
   真正会崩的是后面几条按小画布写的链路：编辑器每改一格就全量重绘、整图按 14 px/格画要几百 MB
   后备缓冲、导出 PNG 超过 canvas 边长上限、存档写满 localStorage、分板视图要建上千个 canvas。
   这些在小画布下全都看不出来，所以这里直接驱动真实链路，把每一步的**耗时与占用**量出来：

     · ② 画布大小是「一行 + 弹出列表」：列表里有 6 档（含 312 极限），
       档位文案要说清是几块什么规格的板；自定义那组要能改出规格的整数倍尺寸；
     · 点一档 → 生成完的 pattern 尺寸、总颗数、跨几块板、成品厘米数是否如实；
     · 生成耗时、**单格编辑后的重绘耗时**（拖笔能不能用就看这个）；
     · 图纸画布的实际后备缓冲像素（几十万格必须被像素预算夹住，不能真的去建上万像素见方的画布）；
     · 本机存档的真实配额，以及一张最大档作品存下来占多大（存几个会满）；
     · 移动端有没有被弹出列表撑出横向滚动条。

   注意：探针只读测量，不做断言判定（audit.cjs 只负责把结果打出来）。
   ========================================================================= */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const now = () => performance.now()
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }

  const [S, M, Inv] = await Promise.all([d.studio(), d.membership(), d.inventoryStore()])
  /* 精细档是 Pro 权益，自检里直接把身份切成 Pro（和用户点「升级」后的状态一致）。
     必须等一帧：档位文案是按 isPro 算出来的 computed，不等刷新就读 DOM 会看到锁着的旧状态。 */
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  await new Promise(r => requestAnimationFrame(r))
  /* 关掉抠图与库存约束：这里量的是画布尺寸带来的开销，别让别的分支掺进来 */
  S.options.removeBg = false
  Inv.useInventory.value = false

  const mobile = window.matchMedia('(max-width:780px)').matches
  const out = { ok: true, mobile, worst: window.innerWidth || 0 }

  /* ---------- ⓪ localStorage 的真实配额 ----------
     为什么要量：useStudio 里「一张 1000 格作品存几个方案」是按这个数算的
     （LS_SAFE_CHARS = 4.6M 码元），配额到底是多少不能靠猜。
     做法：按 256 KB 一档往一个临时键里写，写到抛错为止，最后删掉这个键。 */
  out.quotaKB = (() => {
    const key = 'douzao__quota_probe'
    let kb = 0
    try {
      const chunk = 'x'.repeat(256 * 1024)
      let s = ''
      for (let i = 0; i < 40; i++) {
        localStorage.setItem(key, s + chunk)
        s += chunk
        kb += 256
      }
    } catch { /* 到这里就是上限 */ } finally {
      try { localStorage.removeItem(key) } catch { /* ignore */ }
    }
    return kb
  })()

  const sizeCard = document.querySelector('.card--size')
  const sizeRow = sizeCard && sizeCard.querySelector('[data-size-row]')
  const sizePanel = sizeCard && sizeCard.querySelector('[data-size-panel]')
  /* 列表默认是收起的（② 整块只留一行），探针要先点开才读得到档位 */
  if (sizeRow && sizePanel && getComputedStyle(sizePanel).display === 'none') {
    sizeRow.click()
    await sleep(120)
  }
  out.panelOpen = sizePanel ? getComputedStyle(sizePanel).display !== 'none' : false
  /* 桌面端是从右侧浮出的 fixed 浮层：位置必须落在卡片右边、并且完整在视口内
     （左栏自己 overflow-y:auto，absolute 会被裁掉 —— 这条就是盯着那个坑的） */
  if (!mobile && sizePanel && sizeRow && out.panelOpen) {
    const pr = sizePanel.getBoundingClientRect()
    const rr = sizeRow.getBoundingClientRect()
    out.panelPos = { left: Math.round(pr.left), top: Math.round(pr.top), w: Math.round(pr.width) }
    out.panelBeside = pr.left >= rr.right - 1
    out.panelInsideViewport = pr.left >= 0 && pr.right <= (window.innerWidth || 0) + 1
  }

  /* ---------- ① 档位：6 档（52 / 78 / 104 / 156 / 208 / 312）+ 自定义尺寸 ----------
     档位表来自 lib/boardSpec.js 的 SIZE_TIERS；每一档都是「整板拼法」，
     所以断言的是「尺寸是 52/78/104 的整数倍 + 档位数字齐全」，而不是某个写死的像素标签。 */
  const tiles = [...document.querySelectorAll('.card--size .pick[data-size]')]
  out.presets = tiles.map(b => b.textContent.replace(/\s+/g, ' ').trim())
  out.presetSizes = tiles.map(b => b.getAttribute('data-size'))
  out.presetSpecs = tiles.map(b => Number(b.getAttribute('data-spec')))
  out.presetCount = tiles.length
  /* 宽屏（≥781px）的 ② 已经换成「画布与成品尺寸」面板：规格是下拉、尺寸是滑杆，
     没有这一排档位按钮。它的功能与容量边界由 scripts/audit-size-wide.js 验收；
     这里只保留手机端的档位测量，别拿空数组继续算出一堆误导性的 false。 */
  if (!tiles.length) {
    return {
      ok: true,
      mobile,
      skipped: '宽屏使用「画布与成品尺寸」面板（规格下拉 + 成品尺寸滑杆），见 verify:size-wide',
      quotaKB: out.quotaKB,
      specOptions: [...document.querySelectorAll('.card--size [data-size-spec] option')].map(o => o.textContent.replace(/\s+/g, ' ').trim())
    }
  }
  /* 规格表从 boardSpec 读（52 / 78 / 104 / 120 钉板），别在这里再抄一份 ——
     抄的那份在加 120 钉板之后就漏了这一档，导致 specMultiples 假红。 */
  const SPECS = S.BOARD_SPECS || [52, 78, 104, 120]
  /* 每一档的两个方向都必须是**同一个规格**的整数倍 —— 混规格铺不满
     （52 / 78 / 104 的最小公约数是 26，没有 26 钉的板），所以这里按行上的 data-spec 判，
     而不是「两个方向各自能被某个规格整除」。 */
  out.specMultiples = out.presetSizes.every((s, i) => {
    /* data-size 用的是全角乘号（「52×52」），别按 ASCII 的 x 去 split —— 那样两位都变成 NaN */
    const [w, h] = s.split('×').map(Number)
    const spec = out.presetSpecs[i]
    return SPECS.includes(spec) && w % spec === 0 && h % spec === 0
  })
  out.oneSpecPerRow = out.presets.every(t => !/混拼/.test(t))
  out.hasAllTiers = ['52', '78', '104', '156', '208', '312']
    .every(t => [...document.querySelectorAll('.card--size .pick[data-tier]')].some(b => b.getAttribute('data-tier') === t))
  out.tileOverflow = tiles.some(b => b.scrollWidth > b.clientWidth + 1)
  /* 自定义那一项必须是**最后一项**，而且要真的能改出规格的整数倍 */
  const customToggle = document.querySelector('.card--size [data-custom-toggle]')
  out.customIsLast = !!(customToggle && customToggle.closest('li') === sizeCard.querySelector('.sizeList li:last-child'))
  if (customToggle) {
    customToggle.click()
    await sleep(80)
    const spec = document.querySelector('.card--size [data-custom-spec]')
    const cols = document.querySelector('.card--size [data-custom-cols]')
    const rows = document.querySelector('.card--size [data-custom-rows]')
    if (spec && cols && rows) {
      const setVal = (el, v) => {
        el.value = String(v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setVal(spec, 104)
      setVal(cols, 2)
      setVal(rows, 1)
      await sleep(60)
      const apply = document.querySelector('.card--size [data-custom-apply]')
      out.customText = apply ? apply.textContent.replace(/\s+/g, ' ').trim() : ''
      out.customOk = /208\s*×\s*104/.test(out.customText)
    }
    customToggle.click()
    await sleep(60)
  }

  /* 手机端「常用成品尺寸」快选：只改成品区域，底板不动（底板由上面的规格下拉单独管）。
     这条是手机端与桌面端同步的核心语义，别退回「点一档就把底板一起换大」。 */
  if (mobile && sizeRow) {
    S.setCanvasCapacity(156, 156)
    S.setCanvasSize(52, 52)
    await sleep(80)
    if (sizePanel && getComputedStyle(sizePanel).display === 'none') {
      sizeRow.click()
      await sleep(120)
    }
    const tier = [...document.querySelectorAll('.card--size .pick[data-tier]')]
      .find(b => b.getAttribute('data-tier') === '78')
    if (tier) {
      tier.click()
      await sleep(900)
      out.artOnlyPick = {
        board: `${S.options.canvasMaxW}×${S.options.canvasMaxH}`,
        art: `${S.options.canvasW}×${S.options.canvasH}`,
        pattern: S.pattern.value ? `${S.pattern.value.width}×${S.pattern.value.height}` : '—'
      }
      out.artOnlyPick.ok = out.artOnlyPick.board === '156×156' &&
        out.artOnlyPick.art === '78×78' && out.artOnlyPick.pattern === '156×156'
      out.ok = out.ok && out.artOnlyPick.ok
    } else {
      out.artOnlyPick = { ok: false, err: '找不到 78 档' }
      out.ok = false
    }
  }

  /* ---------- ② 每一步：切画布 → 生成 → 量耗时与尺寸 ---------- */
  /* /editor 这类没有载入任何作品的页面拿不到图案（setCanvasSize 需要 sourceUrl 才会重算），
     直接说清楚「这一页没东西可量」，不要报一堆 0 让人以为功能坏了。 */
  if (!S.pattern.value) {
    return { ok: true, mobile, skipped: '这一页没有图案（未载入作品），精细档探针只在 editorProject 上有意义', presets: out.presets, quotaKB: out.quotaKB }
  }

  /** 图纸画布的真实后备缓冲（不是 CSS 尺寸）：像素预算有没有生效看这个 */
  function canvasPx() {
    const el = document.querySelector('.stage canvas')
    return el ? `${el.width}×${el.height}` : '—'
  }

  /**
   * 反推编辑器当前的「每格像素 + 标尺宽」。
   * 不抄 EditorCanvas 的算式（抄了就会随它一起过期），而是拿画布的 CSS 宽度去解
   * `2×ruler + 格数×cell = CSS 宽`：ruler 是 cell 的阶梯函数（cell<7 恒为 13，
   * 之后是 round(cell*1.8) 且封顶 52），所以对 ruler 的每个候选值直接解出 cell，
   * 再回代验证 —— 等距扫描在 cell 只有 1.5 这种小数时会差一个整像素而漏配。
   */
  function geometryFromCss(gw) {
    const el = document.querySelector('.stage canvas')
    if (!el) return null
    const cssW = parseFloat(el.style.width)
    if (!cssW) return null
    for (let ruler = 13; ruler <= 52; ruler++) {
      const cell = (cssW - 2 * ruler) / gw
      if (!(cell > 0)) continue
      if (Math.max(13, Math.min(52, Math.round(cell * 1.8))) !== ruler) continue
      return { cell, ruler, dpr: el.width / cssW, el }
    }
    return null
  }


  /**
   * 「改一格，画布上那一格真的变色了」—— 唯一能发现「数据变了、画面没变」的判据。
   * 图案层的增量贴图曾经把源矩形按 CSS 像素传（没除以 cell），贴图区整个落在图案层之外、
   * 一格都没画上；116 格以内不走图案层，所以只能在 300 格以上的档位测出来。
   *
   * 判据用**差分**而不是绝对值：每格不到 2 个物理像素时 drawImage 是平滑缩放的，
   * 读回来的必然是与邻格的混合色（那是几何事实，不是 bug），
   * 所以只要求「改完之后，这一格的像素比改之前更接近新色号」。
   * 需要时先放大到每格 ≥ 1 物理像素，测完恢复缩放。
   */
  async function paintPixelCheck() {
    const p = S.pattern.value
    if (!p) return null
    /* 放大走界面上的「＋」按钮，而不是直接调 S.setZoom：
       直接改 zoom 不会把 EditorCanvas 的 autoFit 关掉，舞台的 ResizeObserver
       过一会儿又会「适应窗口」把缩放弹回去（窄屏上尤其明显），量到的位置就对不上了。
       点按钮 = 走 onUserZoom，autoFit 变 false，缩放才稳得住。 */
    const zoomBtn = label => [...document.querySelectorAll('.zoomBar button')].find(b => b.textContent.trim() === label)
    const geo0 = geometryFromCss(p.width)
    const needZoom = geo0 ? geo0.cell * geo0.dpr < 1.5 : false
    if (needZoom) {
      const plus = zoomBtn('＋')
      const clicks = Math.min(8, Math.max(1, Math.ceil(1.5 / (geo0.cell * geo0.dpr) / 0.25)))
      for (let i = 0; i < clicks && plus; i++) {
        plus.click()
        await new Promise(r => requestAnimationFrame(r))
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      await sleep(150)
    }
    const centerRgb = () => {
      const geo = geometryFromCss(p.width)
      if (!geo) return null
      const ctx = geo.el.getContext('2d')
      const px = Math.round((geo.ruler + (10 + 0.5) * geo.cell) * geo.dpr)
      const py = Math.round((geo.ruler + (10 + 0.5) * geo.cell) * geo.dpr)
      const d = ctx.getImageData(px, py, 1, 1).data
      return { rgb: [d[0], d[1], d[2]], cell: geo.cell * geo.dpr }
    }
    const before = centerRgb()
    const oldK = p.cells[10 * p.width + 10]
    const oldHex = oldK < 0 ? '#EFF1F4' : (p.palette[oldK] && p.palette[oldK].hex)
    /* 选一个与当前格不同的色号，保证这一笔真的改了颜色 */
    const pick = p.palette.findIndex((_c, idx) => idx !== oldK)
    if (pick < 0) return { ok: false, reason: '色板里只有一个色号' }
    S.brushColorId.value = p.palette[pick].id
    S.paintAt(10, 10)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await sleep(30)
    const after = centerRgb()
    if (needZoom) {
      /* 用「适应」按钮回到原来看整图的状态（也顺手把 autoFit 放回去） */
      const fit = zoomBtn('适应')
      if (fit) fit.click()
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      await sleep(120)
    }
    if (!before || !after) return { ok: false, reason: '反推不出格子尺寸' }
    const toRgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    const want = toRgb((p.palette[pick] && p.palette[pick].hex) || '#000000')
    const old = toRgb(oldHex || '#000000')
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    const dBefore = dist(before.rgb, want)
    const dAfter = dist(after.rgb, want)
    const moved = before.rgb.some((v, i) => v !== after.rgb[i])
    return {
      ok: moved && dAfter < dBefore - 8 && dAfter < dist(after.rgb, old),
      cell: Math.round(after.cell * 100) / 100,
      oldHex,
      newHex: p.palette[pick].hex,
      before: before.rgb.join(','),
      after: after.rgb.join(','),
      dBefore,
      dAfter
    }
  }

  async function step(w, h, label) {
    const t0 = now()
    /* 直接调接口放大画布时，「画布规格」（容量）要一起放开：
       否则 setCanvasSize 会被上一档容量裁回去，量到的全是上一档的数字。 */
    S.setCanvasCapacity(w, h)
    S.setCanvasSize(w, h)
    const genMs = Math.round(now() - t0)
    await sleep(60)
    const p = S.pattern.value
    const st = S.stats.value
    const row = {
      label,
      genMs,
      size: p ? `${p.width}×${p.height}` : '—',
      beads: st ? st.total : 0,
      colors: p ? p.palette.length : 0,
      targetColors: S.options.targetColors,
      boards: S.layout.value ? S.layout.value.count : 0,
      cm: st ? st.cm : '',
      canvasPx: canvasPx(),
      zoom: Math.round(S.zoom.value * 100) / 100
    }
    /* 单格编辑的响应时间 = 落笔 → 统计重算 → 重绘完成。
       这是「精细档能不能用」最关键的数字：拖笔时每一格都会走一遍。
       拆成三段量，否则只知道「慢」，不知道慢在数据层还是渲染层：
         paintSyncMs —— 同步部分（改一格 + 更新响应式状态；统计已改成收尾时算一次）
         paintFrame1Ms —— 第一次 rAF（Vue 刷新 watcher、开始重绘）
         paintTotalMs —— 两帧之后（含重绘完成）
       注意 S.paintAt 自己会开一层编辑事务（beginEdit/endEdit），所以这里的
       paintTotalMs 里也包含了「这一笔收尾时重算统计」的那一次。 */
    const before = p ? p.cells[10 * p.width + 10] : 0
    /* 故意选一个与当前格不同的色号当画笔：这样这一笔一定真的改了颜色，
       才能验证「画面也跟着变了」。画笔色和当前格色相同时 paintChanged 会是 false，
       测出来的是"什么都没发生"，等于空转。 */
    if (p) {
      const i = 10 * p.width + 10
      const same = p.cells[i]
      const pick = p.palette.findIndex((_c, idx) => idx !== same)
      if (pick >= 0) S.brushColorId.value = p.palette[pick].id
    }
    const ts0 = now()
    S.paintAt(10, 10)
    row.paintSyncMs = Math.round(now() - ts0)
    const ts1 = now()
    await new Promise(r => requestAnimationFrame(r))
    row.paintFrame1Ms = Math.round(now() - ts1)
    const ts2 = now()
    await new Promise(r => requestAnimationFrame(r))
    await sleep(0)
    row.paintMs = Math.round(now() - ts0)
    row.paintFrame2Ms = Math.round(now() - ts2)
    row.paintChanged = S.pattern.value ? S.pattern.value.cells[10 * S.pattern.value.width + 10] !== before : false
    /* 画布上那一格真的变成新颜色了吗 —— 见 paintPixelCheck 的说明 */
    row.paintPixel = await paintPixelCheck()
    /* 全量重绘一次（切网格开关会触发完整重画）：比单格编辑更能暴露渲染瓶颈 */
    const t2 = now()
    S.options.showGrid = !S.options.showGrid
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    row.fullRedrawMs = Math.round(now() - t2)
    /* 分板视图：1225 块板时会不会把 DOM / 内存打爆（只量渲染耗时，不判定） */
    const t3 = now()
    S.currentView.value = 'split'
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await sleep(120)
    row.splitMs = Math.round(now() - t3)
    row.splitTiles = document.querySelectorAll('.boardGrid .boardTile').length
    row.splitCanvases = document.querySelectorAll('.boardGrid .boardTile canvas').length
    S.currentView.value = 'pattern'
    await new Promise(r => requestAnimationFrame(r))
    return row
  }

  out.steps = []
  out.steps.push(await step(52, 52, '52×52（入门 · 1 块 52 钉板）'))
  out.steps.push(await step(104, 104, '104×104（精细 · 1 块 104 钉板）'))
  out.steps.push(await step(312, 312, '312×312（极限 · 3×3 块 104 钉板）'))
  out.steps.push(await step(936, 936, '936×936（自定义：104 钉板 × 9 块）'))

  /* 免费版必须被夹回 52（= 一块 52 钉板）：上限是从权益表读的，
     这里顺手验一次「降级后不会真的按 1000 生成」 */
  M.resetEntitlements()
  await new Promise(r => requestAnimationFrame(r))
  S.setCanvasCapacity(1000, 1000)
  S.setCanvasSize(1000, 1000)
  await sleep(60)
  out.freeClamp = {
    w: S.options.canvasW,
    h: S.options.canvasH,
    pattern: S.pattern.value ? `${S.pattern.value.width}×${S.pattern.value.height}` : '—'
  }
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  S.setCanvasCapacity(1000, 1000)
  S.setCanvasSize(1000, 1000)
  await sleep(60)
  out.proCanvas = S.pattern.value ? `${S.pattern.value.width}×${S.pattern.value.height}` : '—'

  /* ---------- ③ 存档体积：真实配额下还能存几个 ---------- */
  S.currentProjectId.value = ''
  const t4 = now()
  const pid = S.saveProject('自检：极限档作品')
  out.saveMs = Math.round(now() - t4)
  await sleep(80)
  let stored = 0
  try {
    stored = (localStorage.getItem('douzao-projects-v2') || '').length
  } catch { /* ignore */ }
  out.saveOk = !!pid
  out.storageKB = Math.round(stored / 1024)
  out.projectsFitInQuota = stored > 0 && out.quotaKB ? Math.floor((out.quotaKB * 1024) / stored) : 0
  /* 三个方案没全存下来时，存档里只剩几个方案 —— 这件事必须能看出来（saveProject 会 toast 说明） */
  const saved = (S.projects.value || []).find(p => p.id === pid)
  out.savedVariants = saved ? (saved.variants || []).length : 0
  out.savedThumbKB = saved && saved.thumbnail ? Math.round(saved.thumbnail.length / 1024) : 0

  /* 重新打开这件作品：100 万格的解码 / 还原链路也要能扛住 */
  const t5 = now()
  const opened = pid ? S.openProject(pid) : false
  await sleep(60)
  out.reopenMs = Math.round(now() - t5)
  out.reopenOk = !!opened && !!S.pattern.value && S.pattern.value.width === 1000

  /* ---------- ④ 移动端：弹出列表有没有撑出横向滚动条 ---------- */
  if (mobile) {
    out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth
    out.ok = out.ok && out.overflowX <= 0
  }

  /* 档位数只要求「至少 6 档齐全」：120 钉板是后加的（SIZE_TIERS 现在 7 档），
     写死 6 会让这条断言随产品扩容而假红。 */
  out.ok = out.ok && !!out.hasAllTiers && out.presetCount >= 6 && out.specMultiples && out.oneSpecPerRow
    && !!out.customOk && out.customIsLast && !out.tileOverflow && out.saveOk && out.reopenOk
  if (!mobile) out.ok = out.ok && !!out.panelOpen && !!out.panelBeside && !!out.panelInsideViewport
  /* 每一档的「改一格，画面上那一格真的变色了」都必须成立 —— 这是唯一能发现
     「数据变了、画面没变」的判据（图案层增量贴图的源矩形单位错过一次）。
     例外：一格不足 1 个物理像素时读不回单格差异（312 / 936 档的画布后备缓冲被
     像素预算夹在 ~500px，放大只是插值），这些档位只记录 paintChanged 与耗时。 */
  out.paintPixelSkipped = out.steps
    .filter(s => s.paintPixel && s.paintPixel.cell < 1)
    .map(s => s.label)
  out.paintPixelOk = out.steps.every(s => !s.paintPixel || s.paintPixel.cell < 1 || s.paintPixel.ok)
  out.ok = out.ok && out.paintPixelOk
  return out
})()
