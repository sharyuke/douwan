/* 自检探针：「上传一张照片」这条路走对了吗。
   用法：node scripts/audit.cjs --eval-file scripts/audit-photo.js /editor
   （故意不带 --setup-file：要的就是「刚打开、什么都还没有」的工作台）

   为什么必须有这一项：上传照片是产品的主动线，而这条线上有四件事**只在这个入口**
   才会走到，且都不会报错、只会"结果不对"：
     ① 透明背景（抠好的贴纸 / 免抠素材）必须变成**空格**，不是一整片白豆 + 一圈白边；
        顺带断言抠图掩膜的分辨率**跟着源图走**（matteMaxSide ≥ 384），不再是固定 384；
     ② 画布与色号要按原图自动匹配（源图能细到什么程度，别让用户自己猜）；
     ③ 精细档的格子数要按原图比例算，不能把竖图放进方画布、让 40% 的格子空着；
     ④ 色号上限要到色板长度（221）而不是 90 —— 界面滑块与引擎常量两处都要跟；
        顺带把 cartoon 的工作分辨率钉在 768（这一轮试过放大又撤回来，见 README）；
     ⑤ 抠图掩膜边长要跟源图走（384~1024）而不是固定 384 —— 这是"抠图毛躁"那条的入口。
   这五条都用真实数据判定：空格数、画布尺寸、用色数、方案 key、滑块 max、掩膜边长。 */
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
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'))
    const file = new File([blob], name, { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    /* 顶栏还有一个 .libFile（素材库导入），它在 DOM 里更靠前。
       选择器列表里 `input[type=file]` 会先命中它，所以必须先单独找上传卡里的那个。 */
    const input = document.querySelector('.upload ~ input[type=file]') ||
      document.querySelector('input[type=file]:not(.libFile)')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => pat() && pat().width > 0)
    await sleep(150)
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
    /* 主体是 320×100 px（2:1），裁剪生效时图案比例就该是 2:1 而不是源图的 0.8 */
    aspect: Math.round((sticker.width / sticker.height) * 100) / 100,
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

  /* ---------- ② 不透明竖图：画布按原图比例 + 长边自动匹配 + 色号跟着抬 ----------
     先把画布收回小档再上传：settings 是长驻的，上一步（或上一个页面）留下的
     「312 极限」会被 autoFitForSource 有意保留（用户自己点过的档位不降级），
     那测的就不是自动匹配了。这里点的就是界面上那个 1×1 档。 */
  const smallTile = document.querySelector('.card--size .pick[data-size="52x52"]')
  if (smallTile) smallTile.click()
  await sleep(120)
  await upload(300, 600, null, 'photo-tall.png')
  const photo = pat()
  if (!photo) return { ok: false, err: '照片没有生成图案' }
  const a = S.options.canvasW / S.options.canvasH
  const srcA = 300 / 600
  out.photo = {
    canvas: `${S.options.canvasW}×${S.options.canvasH}`,
    aspect: Math.round(a * 1000) / 1000,
    srcAspect: Math.round(srcA * 1000) / 1000,
    targetColors: S.options.targetColors,
    usedColors: photo.palette.length,
    activeKey: S.activeKey.value,
    variantKeys: S.variants.value.map(v => v.key),
    auto: !!(photo.matte && photo.matte.auto),
    /* 不透明图不该自动抠背景：没有 alpha 就不该凭空少豆子 */
    empty: photo.stats.emptyCount,
    /* 一格至少摊到 2 个源像素 → 理想长边 = 600 ÷ 2 = 300，吸附到最近的一档 312；
       另一边按 1:2 得到 156（156 也是整板：3 块 52 板 / 2 块 78 板） */
    longSideOk: Math.max(S.options.canvasW, S.options.canvasH) === 312,
    aspectOk: Math.abs(a - srcA) < 0.06,
    colorsOk: S.options.targetColors >= 64
  }
  out.photo.ok = out.photo.aspectOk && out.photo.longSideOk && out.photo.colorsOk &&
    out.photo.activeKey === 'high' && out.photo.empty === 0 && out.photo.auto === false

  /* ---------- ②b 更大的原图：自动匹配落在最高档 312 ----------
     「一格 2 个源像素」这条规则对 800×1600 的原图算出理想长边 800，而档位阶梯到 312
     为止（= 3×3 块 104 钉板）。所以自动匹配给 156×312，一格摊到约 5 个源像素，
     超采样照样有效；想要更大只能自己走「自定义尺寸」按规格加板。 */
  if (smallTile) smallTile.click()
  await sleep(120)
  await upload(800, 1600, null, 'photo-big.png')
  const big = pat()
  if (!big) return { ok: false, err: '大图没有生成图案' }
  out.big = {
    canvas: `${S.options.canvasW}×${S.options.canvasH}`,
    pattern: `${big.width}×${big.height}`,
    targetColors: S.options.targetColors,
    usedColors: big.palette.length,
    longSide: Math.max(S.options.canvasW, S.options.canvasH),
    longSideOk: Math.max(S.options.canvasW, S.options.canvasH) === 312,
    aspectOk: Math.abs(S.options.canvasW / S.options.canvasH - 0.5) < 0.06,
    /* 156×312 = 4.9 万格 → 色号下限 64 色这一档 */
    colorsOk: S.options.targetColors >= 64
  }
  out.big.ok = out.big.longSideOk && out.big.aspectOk && out.big.colorsOk

  /* ---------- ④ 色号上限：滑块与引擎都要能到色板长度（漫德 221），不再是 90 ----------
     上限原来由存档格式倒推（一格一字符、91 字符集 → 90 色），存档字符集扩到 256 之后
     这条天花板跟着拆掉。这里同时断言"界面滑块"和"引擎常量"两处，防的是一处改了另一处没跟。 */
  const colorRange = document.querySelector('.card--more input[type=range]')
  out.colors = {
    sliderMax: colorRange ? Number(colorRange.max) : null,
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
  const fineTile = document.querySelector('.card--size .pick[data-tier="312"]')
  out.fine = { tile: fineTile ? fineTile.textContent.replace(/\s+/g, ' ').trim() : '' }
  if (fineTile) {
    fineTile.click()
    await waitFor(() => pat() && (pat().width === 156 || pat().height === 312), 25000)
    await sleep(150)
    const f = pat()
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
  }

  out.ok = !!(out.sticker.ok && out.photo.ok && out.big.ok && out.colors.ok &&
    out.colors.cartoonPinned && out.matteMask.ok && (!out.fine || out.fine.ok))
  return out
})()
