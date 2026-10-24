/* 自检探针：在真实浏览器里驱动「照片 → 卡通形象 → 拼豆图」的完整链路。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-cartoon.js /editor

   断言的都是真实数字，不是"有没有报错"：
     · 「① 创建」里真的长出了卡通化控件（开关 + 三档风格），而且是点它生效的；
     · 三档风格给出**不同**的平涂色块数 / 描边量 / 结构一致度；
     · 卡通化的结果里，结构一致度高、色相偏移小（= 抓的是原图特征，没有凭空创作）；
     · 卡通化确实改变了图纸（色块更大 / 颜色更少），并且不会把统计搞坏（豆数、色号、还原度都在合理范围）；
     · 与「抠图去背景」同时打开不冲突（空格仍然是空格）；
     · 缩略图上的「原图 / 卡通」对照真的换了一张图。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const [S, Inv] = await Promise.all([d.studio(), d.inventoryStore()])
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
  const stat = p => ({
    beads: p.stats.beadCount,
    empty: p.stats.emptyCount,
    colors: p.stats.colorCount,
    sim: p.stats.similarity,
    build: Math.round(p.stats.buildability * 100),
    isolated: p.stats.isolatedCount,
    cartoon: p.cartoon ? {
      style: p.cartoon.styleLabel,
      levels: p.cartoon.levels,
      inkShare: p.cartoon.inkShare,
      anchorShare: p.cartoon.anchorShare,
      structure: p.cartoon.structure,
      hueShift: p.cartoon.hueShift,
      meanDeltaE: p.cartoon.meanDeltaE,
      purity: p.cartoon.purity,
      work: `${p.cartoon.width}×${p.cartoon.height}`
    } : null
  })
  const out = { ok: true }
  Inv.useInventory.value = false

  /* 造一张"照片"：有渐变、有纹理噪点、有深色五官、有高光。
     这几个元素正是卡通化最容易翻车的地方（纹理抹不干净 / 五官被吃掉 / 高光被平涂）。 */
  function photoCanvas(w = 520, h = 520) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d')
    const bg = x.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#BFD8E8')
    bg.addColorStop(1, '#8FA9C0')
    x.fillStyle = bg
    x.fillRect(0, 0, w, h)
    // 脸
    const face = x.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.5, w * 0.34)
    face.addColorStop(0, '#F3D3B6')
    face.addColorStop(1, '#D8A57F')
    x.fillStyle = face
    x.beginPath()
    x.ellipse(w * 0.5, h * 0.52, w * 0.22, h * 0.3, 0, 0, Math.PI * 2)
    x.fill()
    // 头发
    x.fillStyle = '#4A3323'
    x.beginPath()
    x.ellipse(w * 0.5, h * 0.3, w * 0.24, h * 0.18, 0, Math.PI, Math.PI * 2)
    x.fill()
    // 眼睛（关键小特征）
    for (const dx of [-0.1, 0.1]) {
      x.fillStyle = '#241C14'
      x.beginPath()
      x.ellipse(w * (0.5 + dx), h * 0.44, w * 0.032, h * 0.022, 0, 0, Math.PI * 2)
      x.fill()
      x.fillStyle = '#FFFFFF'
      x.beginPath()
      x.arc(w * (0.5 + dx) + 4, h * 0.44 - 3, 2.6, 0, Math.PI * 2)
      x.fill()
    }
    // 嘴
    x.fillStyle = '#A8544F'
    x.beginPath()
    x.ellipse(w * 0.5, h * 0.63, w * 0.07, h * 0.028, 0, 0, Math.PI * 2)
    x.fill()
    // 皮肤纹理噪点（照片质感）
    const img = x.getImageData(0, 0, w, h)
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 22
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n))
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n))
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n))
    }
    x.putImageData(img, 0, 0)
    return c
  }

  const load = c => new Promise(r => {
    const im = new Image()
    im.onload = () => r(im)
    im.src = c.toDataURL('image/png')
  })
  const photo = await load(photoCanvas())

  // ---------- 1) 工作台里真的长了这个控件（不是只存在于代码里） ----------
  S.options.boardCols = 1
  S.options.boardRows = 1
  S.options.targetColors = 13
  await S.useAsset({ id: 'probe', name: 'probe', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F2C94C"/><circle cx="50" cy="50" r="26" fill="#2D9CDB"/></svg>' })
  S.options.cartoon = false
  await sleep(200)
  const bar = document.querySelector('.cartoonBar')
  out.ui = {
    inCreateCard: !!bar?.closest('section.card'),
    createCardTitle: (bar?.closest('section.card')?.querySelector('h3') || {}).textContent?.trim() || '',
    rightAfterMatte: !!bar && !!document.querySelector('.matteBar') &&
      (document.querySelector('.matteBar').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    switchRole: bar?.querySelector('.cartoonBar__main')?.getAttribute('role') || '',
    // 打开之前不该有三档风格（否则控件状态是假的）
    styleButtonsWhenOff: document.querySelectorAll('.cartoonBar__levels .seg').length,
    label: bar?.querySelector('.cartoonBar__label')?.textContent?.trim() || ''
  }

  // ---------- 2) 点真实的开关 → 用真实照片走完整链路 ----------
  S.options.cartoonStyle = 'standard'
  document.querySelector('.cartoonBar__main').click()
  await sleep(600)
  out.ui.styleButtonsWhenOn = document.querySelectorAll('.cartoonBar__levels .seg').length
  out.ui.optionOn = S.options.cartoon === true
  out.ui.patternHasCartoon = !!S.pattern.value?.cartoon
  out.ui.cartoonNote = (document.querySelector('.cartoonNote') || {}).textContent?.trim() || ''
  out.ui.thumbnailModes = document.querySelectorAll('.thumbModes .thumbMode').length

  // ---------- 3) 换上真实"照片"（带纹理 + 五官）：先取关掉卡通化的基线 ----------
  S.loadImageSource(photo, photo.src, 'probe-photo')
  S.setCartoon(false)
  await sleep(300)
  out.off = { ...stat(S.pattern.value) }

  S.setCartoon(true)
  await sleep(300)
  const byStyle = {}
  for (const key of ['soft', 'standard', 'flat']) {
    const btn = Array.from(document.querySelectorAll('.cartoonBar__levels .seg'))
      .find(b => b.textContent.trim() === ({ soft: '轻度', standard: '标准', flat: '简约平涂' }[key]))
    const t = performance.now()
    if (btn) btn.click()
    else { S.options.cartoonStyle = key; S.regenerate({ keys: ['easy'], silent: true }) }
    await sleep(250)
    byStyle[key] = { ...stat(S.pattern.value), ms: Math.round(performance.now() - t) }
  }
  S.setCartoonStyle('standard')
  out.byStyle = byStyle

  // 三档必须真的不一样（否则档位是装饰）
  out.styleDiff = {
    levels: [byStyle.soft.cartoon.levels, byStyle.standard.cartoon.levels, byStyle.flat.cartoon.levels],
    ink: [byStyle.soft.cartoon.inkShare, byStyle.standard.cartoon.inkShare, byStyle.flat.cartoon.inkShare],
    meanDeltaE: [byStyle.soft.cartoon.meanDeltaE, byStyle.standard.cartoon.meanDeltaE, byStyle.flat.cartoon.meanDeltaE],
    distinct: new Set([byStyle.soft.cartoon.levels, byStyle.standard.cartoon.levels, byStyle.flat.cartoon.levels]).size
  }

  // ---------- 4) 缩略图上的「原图 / 卡通」对照 ----------
  {
    const modes = Array.from(document.querySelectorAll('.thumbModes .thumbMode'))
    const srcOf = () => document.querySelector('.thumb img')?.getAttribute('src') || ''
    // 等一帧：前一步刚改过风格，Vue 还没把新的 data URL 刷到 <img> 上
    await sleep(250)
    const shownNow = srcOf()
    modes.find(b => b.textContent.trim() === '原图')?.click()
    await sleep(300)
    const srcSource = srcOf()
    modes.find(b => b.textContent.trim() === '卡通')?.click()
    await sleep(300)
    const srcCartoon = srcOf()
    out.preview = {
      hasToggle: modes.length === 2,
      // 开了卡通化之后，缩略图默认就给用户看卡通结果（切到「原图」能当场对照）
      autoShowsCartoon: !!shownNow && shownNow === srcCartoon,
      sourceIsOriginal: srcSource === photo.src,
      cartoonIsDifferent: srcCartoon !== srcSource && srcCartoon.startsWith('data:image/png'),
      len: srcCartoon.length
    }
    modes.find(b => b.textContent.trim() === '原图')?.click()
  }

  // ---------- 5) 关键小特征（眼睛）必须还在：局部对比保留了多少 ----------
  // "抓住主要特征"最直观的一条：眼睛在原图里比周围皮肤暗一大截，卡通化之后这个对比
  // 还剩多少。只做平涂会把眼睛吃掉（对比 → 0），那就不叫抓住特征了。
  {
    const px = d.pattern.readImagePixels(photo, 480)
    const lum = (data, w, h, nx, ny) => {
      const i = (Math.round(ny * h) * w + Math.round(nx * w)) * 4
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    const contrast = (data, w, h) =>
      lum(data, w, h, 0.5, 0.58) - Math.min(lum(data, w, h, 0.4, 0.44), lum(data, w, h, 0.6, 0.44))
    const eyes = {}
    const base = contrast(px.data, px.width, px.height)
    for (const s of d.cartoon.CARTOON_STYLES) {
      const c = d.cartoon.cartoonize(px.data, px.width, px.height, { style: s.key })
      const after = contrast(c.data, px.width, px.height)
      eyes[s.key] = {
        contrastBefore: Math.round(base * 10) / 10,
        contrastAfter: Math.round(after * 10) / 10,
        keep: base > 0 ? Math.round((after / base) * 100) / 100 : null
      }
    }
    out.eyes = eyes
  }

  // ---------- 6) 与「抠图去背景」同时打开 ----------
  {
    S.options.removeBg = true
    S.setCartoonStyle('standard')
    await sleep(300)
    out.withMatte = { ...stat(S.pattern.value) }
    out.withMatte.matteApplied = !!S.pattern.value?.matte?.applied
    out.withMatte.matteReason = S.pattern.value?.matte?.reason || ''
    S.options.removeBg = false
    S.regenerate({ keys: ['easy'], silent: true })
  }

  // ---------- 7) 关掉之后必须回到"照片直接出图" ----------
  {
    S.setCartoon(false)
    await sleep(300)
    out.offAgain = { ...stat(S.pattern.value) }
    out.offAgain.backToNoCartoon = !S.pattern.value?.cartoon
    // 关掉之后缩略图不该再显示对照开关
    out.offAgain.thumbnailModes = document.querySelectorAll('.thumbModes .thumbMode').length
  }

  // ---------- 8) 纯函数口径：卡通化的结构一致度 / 色相偏移（同一张图直接算） ----------
  {
    const px = d.pattern.readImagePixels(photo, 480)
    const res = {}
    for (const s of d.cartoon.CARTOON_STYLES) {
      const c = d.cartoon.cartoonize(px.data, px.width, px.height, { style: s.key })
      res[s.key] = plain(c.meta)
    }
    out.pure = res
  }

  /* 探针结束时把卡通化开着（截图就是"功能真实生效"的样子，
     顺带让自检的横向溢出检查跑在开启状态上） */
  S.setCartoon(true)
  await sleep(250)
  out.finalState = {
    cartoon: S.options.cartoon,
    style: S.options.cartoonStyle,
    patternHasCartoon: !!S.pattern.value?.cartoon,
    note: (document.querySelector('.cartoonNote') || {}).textContent?.trim() || ''
  }

  return out
})()
