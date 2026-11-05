/* 自检探针：「上传一张照片」这条路走对了吗。
   用法：node scripts/audit.cjs --eval-file scripts/audit-photo.js /editor
   （故意不带 --setup-file：要的就是「刚打开、什么都还没有」的工作台）

   为什么必须有这一项：上传照片是产品的主动线，而这条线上有四件事**只在这个入口**
   才会走到，且都不会报错、只会"结果不对"：
     ① 透明背景（抠好的贴纸 / 免抠素材）必须变成**空格**，不是一整片白豆 + 一圈白边；
        顺带断言抠图掩膜的分辨率**跟着源图走**（matteMaxSide ≥ 384），不再是固定 384；
     ② 按**图案复杂度**推荐钉板（2026-11-04 用户口径）：越复杂越大、越简单越小，
        钉板数量默认 1 块。简单平涂图 → 52 板（原图再大也不跟着变大），
        普通照片 → 104 板；只有细节极密的照片才到 120（2026-11-05 用户口径：
        104 就够的不要给 120）；
     ③ 成品区域要按原图比例算，不能把竖图放进方画布、让 40% 的格子空着；
     ④ 色号上限要到色板长度（221）而不是 90 —— 界面滑块与引擎常量两处都要跟；
        顺带把 cartoon 的工作分辨率钉在 768（这一轮试过放大又撤回来，见 README）；
     ⑤ 抠图掩膜边长要跟源图走（384~1024）而不是固定 384 —— 这是"抠图毛躁"那条的入口。
   这几条都用真实数据判定：空格数、画布尺寸、推荐规格、用色数、方案 key、滑块 max、掩膜边长。 */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 15000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      if (fn()) return true
      await sleep(60)
    }
    return false
  }
  const pat = () => S.pattern.value
  const out = { ok: true, steps: [] }

  /* 用 Pro 身份跑：精细档、多方案、按原图自动匹配画布都只在 Pro 下才走到完整路径
     （免费版单边夹 58 格，断言会全部退化成"被夹住"这件事，测不到本探针要测的东西）。
     免费版的夹取由 audit-scale.js 负责。 */
  const M = await d.membership()
  M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
  S.options.removeBg = false

  /**
   * 造一张测试图并像用户一样塞进 input[type=file]。
   * @param w,h 画布尺寸
   * @param inner 不透明主体的范围比例 {x,y,w,h}；传 null 表示整张图不透明
   */
  async function commit(cv, name) {
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'))
    const file = new File([blob], name, { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    /* 顶栏还有一个 .libFile（素材库导入），它在 DOM 里更靠前。
       选择器列表里 `input[type=file]` 会先命中它，所以必须先单独找上传卡里的那个。 */
    const input = document.querySelector('.upload ~ input[type=file]') ||
      document.querySelector('input[type=file]:not(.libFile)')
    /* 等的是「这一次重新生成」：lastSearch.at 由 regenerate 在收尾时写。
       连续上传时只等图案非空会立刻命中上一张的图案，测到的就是旧结果。 */
    const before = S.lastSearch.value ? S.lastSearch.value.at : 0
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => S.lastSearch.value && S.lastSearch.value.at > before)
    await sleep(120)
  }

  async function upload(w, h, inner, name) {
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d')
    cx.clearRect(0, 0, w, h)
    if (inner) {
      const ix = Math.round(w * inner.x)
      const iy = Math.round(h * inner.y)
      const iw = Math.round(w * inner.w)
      const ih = Math.round(h * inner.h)
      cx.fillStyle = '#E4572E'
      cx.fillRect(ix, iy, iw, ih)
      cx.fillStyle = '#2F4858'
      cx.beginPath()
      cx.arc(ix + iw / 2, iy + ih / 2, Math.min(iw, ih) * 0.3, 0, Math.PI * 2)
      cx.fill()
    } else {
      cx.fillStyle = '#F4F6F8'
      cx.fillRect(0, 0, w, h)
      cx.fillStyle = '#E4572E'
      cx.beginPath()
      cx.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2)
      cx.fill()
      cx.fillStyle = '#2F4858'
      cx.fillRect(Math.round(w * 0.1), Math.round(h * 0.1), Math.round(w * 0.3), Math.round(h * 0.2))
    }
    await commit(cv, name)
  }

  /**
   * 照片级复杂度的合成图：渐变底 + 260 个带结构的小色块 + 逐像素噪点。
   * 默认参数（半径 2~16）代表**普通照片**：按 2026-11-05 的口径落在 104，
   * 「104 就够的不要给 120」。传更大的半径 / 噪点代表细节极密的照片，才会到 120。
   */
  async function uploadPhoto(w, h, name, { rMin = 2, rMax = 16, noise = 26 } = {}) {
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d')
    const grad = cx.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, '#4A7FB5')
    grad.addColorStop(0.5, '#B9C98A')
    grad.addColorStop(1, '#7A4E3A')
    cx.fillStyle = grad
    cx.fillRect(0, 0, w, h)
    for (let i = 0; i < 260; i++) {
      cx.fillStyle = `hsl(${Math.floor(Math.random() * 360)} 60% ${20 + Math.random() * 60}%)`
      cx.beginPath()
      cx.arc(Math.random() * w, Math.random() * h, rMin + Math.random() * (rMax - rMin), 0, Math.PI * 2)
      cx.fill()
    }
    const img = cx.getImageData(0, 0, w, h)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * noise
      img.data[i] += n
      img.data[i + 1] += n
      img.data[i + 2] += n
    }
    cx.putImageData(img, 0, 0)
    await commit(cv, name)
  }

  /* ---------- ① 透明贴纸：透明处不能变成白豆，且要自动裁到主体 ----------
     主体故意做成横长条（源图是竖的）：裁剪生效时空格画布会变成 2:1，
     没生效则还是源图的 0.5，两者一眼可分 —— 这样断言才真的锁住了「自动按 alpha 裁剪」。 */
  await upload(400, 500, { x: 0.1, y: 0.35, w: 0.8, h: 0.2 }, 'sticker.png')
  const sticker = pat()
  if (!sticker) return { ok: false, err: '透明图没有生成图案' }
  const cells = sticker.width * sticker.height
  const empty = sticker.stats.emptyCount
  const nearWhite = sticker.palette.filter(c => {
    const r = parseInt(c.hex.slice(1, 3), 16)
    const g = parseInt(c.hex.slice(3, 5), 16)
    const b = parseInt(c.hex.slice(5, 7), 16)
    return (r + g + b) / 3 > 235
  })
  /* 近白色号占多少**颗**：全是白豆时这个比例会接近「主体之外那部分」，
     而抗锯齿描边格合法地带一点浅色，所以判据是占比而不是"有没有"。 */
  const nearWhiteBeads = (S.materials.value ? S.materials.value.rows : [])
    .filter(r => nearWhite.some(c => c.id === r.id))
    .reduce((s, r) => s + r.count, 0)
  const beadCount = sticker.stats.beadCount || 1
  out.sticker = {
    canvas: `${S.options.canvasW}×${S.options.canvasH}`,
    pattern: `${sticker.width}×${sticker.height}`,
    targetColors: S.options.targetColors,
    usedColors: sticker.palette.length,
    empty,
    emptyRatio: Math.round((empty / cells) * 1000) / 1000,
    auto: !!(sticker.matte && sticker.matte.auto),
    cropped: !!(sticker.matte && sticker.matte.cropped),
    matteInfo: S.matteInfo.value ? S.matteInfo.value.text : '',
    note: sticker.notes.find(n => n.includes('透明背景')) || '',
    nearWhiteColors: nearWhite.map(c => c.hex),
    nearWhiteShare: Math.round((nearWhiteBeads / beadCount) * 1000) / 1000,
    /* 主体是 320×100 px（2:1），裁剪生效时成品区域比例就该是 2:1 而不是源图的 0.8。
       图案现在是「一块正方形板 + 中间按比例留空的成品区域」，所以比例要读 artW/artH。 */
    art: `${sticker.artW || sticker.width}×${sticker.artH || sticker.height}`,
    aspect: Math.round(((sticker.artW || sticker.width) / (sticker.artH || sticker.height)) * 100) / 100,
    allOpaque: sticker.stats.emptyCount === 0 && sticker.palette.length > 0
  }
  out.sticker.ok =
    out.sticker.auto === true &&
    out.sticker.cropped === true &&
    !!out.sticker.note &&
    /* 关键判别：图案比例必须是**主体**的 3.2，而不是源图的 0.8。
       透明边没被裁掉时，图案会是源图比例、四周一圈白豆 —— 这条断言就是冲着它去的。 */
    Math.abs(out.sticker.aspect - 3.2) < 0.6 &&
    out.sticker.emptyRatio < 0.35 &&
    /* 白豆（近白色号）必须只是抗锯齿描边那一点点，不能是一整片背景 */
    out.sticker.nearWhiteShare < 0.02

  /* ---------- ② 不透明竖图：按图案复杂度推荐「一块板」，成品区域按原图比例 ----------
     这张合成图只有 3 个平涂色 → 复杂度「简洁」→ 推荐最小的一块 52 钉板（钉板数量 1 块）。
     先把画布收回小档再上传：settings 是长驻的，上一步（或上一个页面）留下的
     自定义大底板会被 autoFitForSource 有意保留（用户自己开过的底板不降级），
     那测的就不是自动推荐了。这里点的就是界面上那个 1×1 档。 */
  const smallTile = document.querySelector('.card--size .pick[data-size="52x52"]')
  if (smallTile) smallTile.click()
  await sleep(120)
  await upload(300, 600, null, 'photo-tall.png')
  const photo = pat()
  if (!photo) return { ok: false, err: '照片没有生成图案' }
  const a = S.options.canvasW / S.options.canvasH
  const srcA = 300 / 600
  const rec = S.sourceRecommend.value
  out.photo = {
    canvas: `${S.options.canvasW}×${S.options.canvasH}`,
    board: `${S.options.canvasMaxW}×${S.options.canvasMaxH}`,
    aspect: Math.round(a * 1000) / 1000,
    srcAspect: Math.round(srcA * 1000) / 1000,
    recommend: rec ? { spec: rec.spec, tier: rec.tier, score: rec.score, name: rec.name } : null,
    targetColors: S.options.targetColors,
    usedColors: photo.palette.length,
    activeKey: S.activeKey.value,
    variantKeys: S.variants.value.map(v => v.key),
    auto: !!(photo.matte && photo.matte.auto),
    /* 不透明图不该自动抠背景：没有 alpha 就不该凭空少豆子 */
    empty: photo.stats.emptyCount,
    /* 复杂度「简洁」→ 推荐 52；底板就是那一块 52 板，成品区域按 1:2 摆在板内（26 × 52） */
    specOk: !!rec && rec.spec === 52,
    boardOk: S.options.canvasMaxW === 52 && S.options.canvasMaxH === 52,
    aspectOk: Math.abs(a - srcA) < 0.06,
    /* 26 × 52 = 1352 格 → 色号下限 16 色这一档 */
    colorsOk: S.options.targetColors >= 16
  }
  out.photo.ok = out.photo.specOk && out.photo.boardOk && out.photo.aspectOk && out.photo.colorsOk &&
    out.photo.activeKey === 'high' && out.photo.empty === 0 && out.photo.auto === false

  /* ---------- ②b 更大的原图、同样的简单图案：推荐不跟着分辨率变大 ----------
     旧口径「一格 2 个源像素」会把 800×1600 推到 312（9 块 104 板）；
     新口径看复杂度：还是那 3 个平涂色 → 仍是 1 块 52 板。 */
  if (smallTile) smallTile.click()
  await sleep(120)
  await upload(800, 1600, null, 'photo-big.png')
  const big = pat()
  if (!big) return { ok: false, err: '大图没有生成图案' }
  const bigRec = S.sourceRecommend.value
  out.big = {
    canvas: `${S.options.canvasW}×${S.options.canvasH}`,
    board: `${S.options.canvasMaxW}×${S.options.canvasMaxH}`,
    pattern: `${big.width}×${big.height}`,
    targetColors: S.options.targetColors,
    usedColors: big.palette.length,
    recommend: bigRec ? { spec: bigRec.spec, score: bigRec.score } : null,
    specOk: !!bigRec && bigRec.spec === 52,
    boardOk: S.options.canvasMaxW === 52 && S.options.canvasMaxH === 52,
    aspectOk: Math.abs(S.options.canvasW / S.options.canvasH - 0.5) < 0.06,
    colorsOk: S.options.targetColors >= 16
  }
  out.big.ok = out.big.specOk && out.big.boardOk && out.big.aspectOk && out.big.colorsOk

  /* ---------- ②a 界面上的推荐标记：钉板下拉里推荐的那一档要挂「推荐」 ----------
     推荐值只写进 store 不算数，用户要能在下拉里看见它。手机 / 平板没有这个下拉，跳过。 */
  async function readBoardBadge() {
    const boardBtn = document.querySelector('.csBoard__btn')
    if (!boardBtn) return null
    boardBtn.click()
    await sleep(250)
    const recBadge = document.querySelector('.csBoard__rec')
    const item = recBadge ? recBadge.closest('.csBoard__item') : null
    const data = {
      seen: !!recBadge,
      text: recBadge ? recBadge.textContent.trim() : '',
      onItem: !!item,
      itemText: item ? item.textContent.replace(/\s+/g, ' ').trim() : ''
    }
    boardBtn.click()
    await sleep(150)
    return data
  }

  const simpleBadge = await readBoardBadge()
  if (simpleBadge) {
    out.boardBadge = simpleBadge
    out.boardBadge.ok = simpleBadge.seen && simpleBadge.onItem && /推荐/.test(simpleBadge.text)
  }

  /* ---------- ④ 色号上限：滑块与引擎都要能到色板长度（漫德 221），不再是 90 ----------
     上限原来由存档格式倒推（一格一字符、91 字符集 → 90 色），存档字符集扩到 256 之后
     这条天花板跟着拆掉。这里同时断言"界面滑块"和"引擎常量"两处，防的是一处改了另一处没跟。 */
  /* 全屏工作台把色号滑块收进「图纸调整」抽屉（「颜色用量」抽屉里只有用量表）；
     手机 / 平板可能在侧栏卡片或底部弹层里。先找现成的，没有就开抽屉再找。 */
  let drawerOpened = false
  const readColorRange = () => document.querySelector('input[type=range][data-audit="target-colors"]')
    || document.querySelector('.card--more input[type=range]')
    || document.querySelector('.iap__field input[type=range][aria-label="用色上限"]')
  if (!readColorRange()) {
    const adjustBtn = [...document.querySelectorAll('button')]
      .find(b => /图纸调整/.test(b.textContent || '') && !b.disabled)
    if (adjustBtn) {
      adjustBtn.click()
      drawerOpened = true
      await sleep(900)
    }
  }
  /* 旧版面的 `.card--more` 在改版后没了；现在滑块带 data-audit，手机版则只留数字框 */
  const colorRange = readColorRange()
  const colorNumber = document.querySelector('.mDrop--colors input[type=number]')
  out.colors = {
    sliderMax: colorRange ? Number(colorRange.max) : (colorNumber ? Number(colorNumber.max) : null),
    sliderVia: colorRange ? 'range' : (colorNumber ? 'number' : 'none'),
    engineMax: d.pattern.MAX_TARGET_COLORS,
    archiveCapacity: d.archive ? d.archive.PACK_CAPACITY : null,
    cartoonSide: d.cartoon.CARTOON_MAX_SIDE
  }
  out.colors.ok = out.colors.sliderMax === d.pattern.MAX_TARGET_COLORS &&
    d.pattern.MAX_TARGET_COLORS >= 221 &&
    (out.colors.archiveCapacity == null || out.colors.archiveCapacity >= d.pattern.MAX_TARGET_COLORS)
  /* 卡通化的工作分辨率这一轮试过跟着画布放大、又撤回来了（理由见 README），
     所以把它钉在 768，防止以后无意中改动基线 */
  out.colors.cartoonPinned = out.colors.cartoonSide === 768
  if (drawerOpened) {
    const closeDrawerBtn = document.querySelector('.csDrawer__head .csIconBtn')
      || document.querySelector('.dialog__head .iconbtn')
    if (closeDrawerBtn) {
      closeDrawerBtn.click()
      await sleep(400)
    }
  }

  /* ---------- ⑤ 抠图掩膜的边长：跟源图走（384~1024），不再是固定 384 ----------
     这条盯的是"抠图边缘毛躁"那个改动：maskSide 没接上就还是 384。
     直接调纯函数（桥里挂了 matte），不依赖图案里的摘要字段。 */
  const sideCases = [[100, 120], [300, 600], [400, 500], [1200, 900], [2048, 1536]].map(([w, h]) => ({
    src: `${w}×${h}`,
    side: d.matte.matteMaxSide(w, h)
  }))
  /* 真的跑一次：600×600 的合成图（白底 + 中间红块），掩膜边长必须是 600。
     用正方形是为了避开"掩膜边长记的是宽度"这个细节（stats.maskSide = w）——
     竖图时它等于宽边，横/方图时才等于长边。 */
  const sw2 = 600
  const sh2 = 600
  const buf = new Uint8ClampedArray(sw2 * sh2 * 4)
  for (let y = 0; y < sh2; y++) {
    for (let x = 0; x < sw2; x++) {
      const o = (y * sw2 + x) * 4
      const inSubject = x > 180 && x < 420 && y > 180 && y < 420
      buf[o] = inSubject ? 228 : 246
      buf[o + 1] = inSubject ? 87 : 248
      buf[o + 2] = inSubject ? 46 : 250
      buf[o + 3] = 255
    }
  }
  const ran = d.matte.estimateMatte(buf, sw2, sh2, { level: 'normal' })
  out.matteMask = {
    cases: sideCases,
    floor: d.matte.MATTE_MAX_SIDE,
    limit: d.matte.MATTE_MAX_SIDE_LIMIT,
    ranMaskSide: ran.stats ? ran.stats.maskSide : null,
    ranOk: !!ran.ok
  }
  out.matteMask.ok =
    out.matteMask.floor === 384 &&
    out.matteMask.limit === 1024 &&
    /* 小于下限的图保持 384（那是标定口径），大图按源图、再大夹到 1024 */
    sideCases[0].side === 384 &&
    sideCases[1].side === 600 &&
    sideCases[2].side === 500 &&
    sideCases[3].side === 1024 &&
    sideCases[4].side === 1024 &&
    out.matteMask.ranMaskSide === 600 &&
    out.matteMask.ranOk === true

  /* ---------- ③ 极限档：长边按档位、另一边按原图比例并吸附到整板（不留白边） ---------- */
  /* 全屏工作台里尺寸档位在右侧「成品尺寸」抽屉里 */
  if (!document.querySelector('.card--size') && document.querySelector('.csSide__row')) {
    const sizeRow = [...document.querySelectorAll('.csSide__row')].find(b => /成品尺寸/.test(b.textContent))
    if (sizeRow) {
      sizeRow.click()
      await sleep(700)
    }
  }
  const fineTile = document.querySelector('.card--size .pick[data-tier="312"]')
  out.fine = { tile: fineTile ? fineTile.textContent.replace(/\s+/g, ' ').trim() : '' }
  if (fineTile) {
    fineTile.click()
  } else {
    /* 宽屏（≥781px）的尺寸卡没有档位列表：先把底板换成 312 规格，
       再把清晰度滑杆拉到 312 —— 与点「312 档」是同一条 setCanvasSize 链路 */
    out.fine.via = 'wide-card'
    const spec = document.querySelector('.card--size [data-size-spec]')
    const opt = spec ? [...spec.options].find(o => /312/.test(o.textContent)) : null
    if (opt) {
      spec.value = opt.value
      spec.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(900)
    }
    const range = document.querySelector('.card--size [data-size-range]')
    if (range) {
      range.value = String(Math.min(312, Number(range.max) || 312))
      range.dispatchEvent(new Event('input', { bubbles: true }))
      range.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  let fineReady = await waitFor(() => pat() && pat().width === 156 && pat().height === 312, 3000)
  if (!fineReady) {
    /* 全屏工作台改版后尺寸入口换了位置：桌面 / 手机的尺寸卡收进抽屉（DOM 里根本没有
       `.card--size`），平板的规格下拉按图片方向列出「1 × 2 块 52 钉板」这类具体网格、
       不再有「312」字样。这条断言盯的是**引擎口径**（长边按档位、另一边按比例吸附），
       所以 UI 找不到时退回与界面同一条链路（setCanvasCapacity + setCanvasSize + 色号下限），
       不让版面改动把它变成空转。 */
    out.fine.via = (out.fine.via || 'ui') + '+api'
    S.setCanvasCapacity(156, 312)
    const floor = d.pattern.colorFloorForCells(156 * 312)
    if (floor && S.options.targetColors < floor) S.options.targetColors = floor
    S.setCanvasSize(156, 312, { silent: true })
    fineReady = await waitFor(() => pat() && pat().width === 156 && pat().height === 312, 30000)
  }
  await sleep(150)
  const f = pat()
  if (f) {
    out.fine.canvas = `${S.options.canvasW}×${S.options.canvasH}`
    out.fine.pattern = `${f.width}×${f.height}`
    out.fine.targetColors = S.options.targetColors
    out.fine.usedColors = f.palette.length
    /* 长边必须是 312；另一边按 300:600 = 1:2 的理想值是 156，而 156 本身就是整板
       （3 块 52 板 / 2 块 78 板），所以这里同时验证了「按比例」与「吸附到整板」两件事 */
    out.fine.sizeOk = f.width === 156 && f.height === 312
    /* 156×312 = 4.9 万格 → 色号下限 64 色这一档 */
    out.fine.colorsOk = S.options.targetColors >= 64
    out.fine.ok = out.fine.sizeOk && out.fine.colorsOk
  } else {
    out.fine.ok = false
  }

  /* ---------- ②c 普通照片：推荐 1 块 104 钉板（104 就够的不要给 120） ----------
     渐变 + 小色块 + 噪点 → 复杂度「较复杂」→ 1 块 104 板；
     成品区域按 3:4 摆在板内（78 × 104），四周是空格。 */
  await uploadPhoto(600, 800, 'photo-normal.png')
  const normal = pat()
  if (!normal) return { ok: false, err: '普通照片没有生成图案' }
  const nRec = S.sourceRecommend.value
  out.photoNormal = {
    canvas: `${S.options.canvasW}×${S.options.canvasH}`,
    board: `${S.options.canvasMaxW}×${S.options.canvasMaxH}`,
    recommend: nRec ? { spec: nRec.spec, score: nRec.score, name: nRec.name } : null,
    targetColors: S.options.targetColors,
    usedColors: normal.palette.length,
    specOk: !!nRec && nRec.spec === 104,
    boardOk: S.options.canvasMaxW === 104 && S.options.canvasMaxH === 104,
    aspectOk: Math.abs(S.options.canvasW / S.options.canvasH - 0.75) < 0.06,
    /* 78 × 104 = 8112 格 → 色号下限 48 色这一档 */
    colorsOk: S.options.targetColors >= 48
  }
  /* 下拉里的「推荐」必须挂在 104 那一项，不能还停在 120（用户反馈的就是这个） */
  const normalBadge = await readBoardBadge()
  out.photoNormal.badge = normalBadge
  out.photoNormal.badgeOk = !normalBadge || /104/.test(normalBadge.itemText)
  /* 手机上「已生成图纸」卡里的推荐文案也要跟着是 104 */
  const normalNotice = S.fitNotice.value
  out.photoNormal.notice = normalNotice ? { boardSpec: normalNotice.boardSpec, levelName: normalNotice.levelName } : null
  out.photoNormal.noticeOk = window.innerWidth > 780 ||
    (!!normalNotice && normalNotice.boardSpec === 104)
  out.photoNormal.ok = out.photoNormal.specOk && out.photoNormal.boardOk &&
    out.photoNormal.aspectOk && out.photoNormal.colorsOk && out.photoNormal.badgeOk &&
    out.photoNormal.noticeOk

  /* ---------- ②d 细节极密的照片：才推荐最大的一块 120 钉板 ----------
     大半径高对比色块 + 更强噪点 → 复杂度「极复杂」→ 1 块 120 板；
     成品区域按 3:4 摆在板内（90 × 120），四周是空格。 */
  await uploadPhoto(600, 800, 'photo-extreme.png', { rMin: 8, rMax: 50, noise: 30 })
  const extreme = pat()
  if (!extreme) return { ok: false, err: '极密照片没有生成图案' }
  const eRec = S.sourceRecommend.value
  out.photoExtreme = {
    canvas: `${S.options.canvasW}×${S.options.canvasH}`,
    board: `${S.options.canvasMaxW}×${S.options.canvasMaxH}`,
    recommend: eRec ? { spec: eRec.spec, score: eRec.score, name: eRec.name } : null,
    targetColors: S.options.targetColors,
    usedColors: extreme.palette.length,
    specOk: !!eRec && eRec.spec === 120,
    boardOk: S.options.canvasMaxW === 120 && S.options.canvasMaxH === 120,
    aspectOk: Math.abs(S.options.canvasW / S.options.canvasH - 0.75) < 0.06,
    colorsOk: S.options.targetColors >= 48
  }
  const extremeBadge = await readBoardBadge()
  out.photoExtreme.badge = extremeBadge
  out.photoExtreme.badgeOk = !extremeBadge || /120/.test(extremeBadge.itemText)
  const extremeNotice = S.fitNotice.value
  out.photoExtreme.notice = extremeNotice ? { boardSpec: extremeNotice.boardSpec, levelName: extremeNotice.levelName } : null
  out.photoExtreme.noticeOk = window.innerWidth > 780 ||
    (!!extremeNotice && extremeNotice.boardSpec === 120)
  out.photoExtreme.ok = out.photoExtreme.specOk && out.photoExtreme.boardOk &&
    out.photoExtreme.aspectOk && out.photoExtreme.colorsOk && out.photoExtreme.badgeOk &&
    out.photoExtreme.noticeOk

  out.ok = !!(out.sticker.ok && out.photo.ok && out.big.ok && out.photoNormal.ok && out.photoExtreme.ok &&
    out.colors.ok && out.colors.cartoonPinned && out.matteMask.ok && (!out.fine || out.fine.ok) &&
    (!out.boardBadge || out.boardBadge.ok))
  return out
})()
