/* 自检探针：品牌色板来回切换不能丢颜色。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-brand-roundtrip.js --page editorProject

   为什么要有这一项：换品牌是「按新色板重匹配」，如果每次都从当前色板往回过，
   MARD 291 → MARD 24 → MARD 291 会把 24 色里没有的 267 个色号永久丢掉。
   这里要求换回原品牌后逐格颜色、色号、颜色数量都和离开时一致。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  if (!S.pattern.value) return { ok: false, err: '图案未就绪' }

  const out = { ok: true, checks: {} }
  const fail = (k, v) => { out.ok = false; out.checks[k] = v }
  const cur = () => S.pattern.value
  const snapshot = () => ({
    cells: Array.from(cur().cells),
    ids: cur().palette.map(c => c.id),
    count: cur().palette.length,
    brand: S.options.brandId,
    targetColors: S.options.targetColors
  })
  const sameCells = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  const allBrand = (ids, brandId) => ids.every(id => String(id).startsWith(brandId + ':'))
  const roundTrip = (from, to, label) => {
    const before = snapshot()
    S.setBrand(to)
    const mid = snapshot()
    S.setBrand(from)
    const after = snapshot()
    const ok = sameCells(before.cells, after.cells) &&
      before.ids.length === after.ids.length &&
      before.ids.every((id, i) => id === after.ids[i]) &&
      after.count === before.count &&
      after.brand === from
    if (!ok) {
      fail(label, {
        before: { count: before.count, ids: before.ids },
        mid: { count: mid.count, ids: mid.ids },
        after: { count: after.count, ids: after.ids },
        cellsDiff: before.cells.reduce((n, v, i) => n + (v === after.cells[i] ? 0 : 1), 0)
      })
    }
    return { before, mid, after }
  }

  /* 固定从 MARD 291 出发（fixture 默认品牌可能不是它） */
  if (S.options.brandId !== 'mard291') S.setBrand('mard291')
  await sleep(120)

  /* 落一笔手改：换品牌时手改要保留，不能被还原的底稿盖掉 */
  const p0 = cur()
  const cx = Math.floor(p0.width / 2)
  const cy = Math.floor(p0.height / 2)
  const paintColor = S.availableColors.value.find(c => c.brandId === 'mard291')
  if (!paintColor) return { ok: false, err: '没有可用的落笔颜色' }
  S.brushColorId.value = paintColor.id
  S.paintAt(cx, cy)
  await sleep(120)

  const start = snapshot()
  out.checks.start = { brand: start.brand, count: start.count, cells: start.cells.length }

  /* 多色 → 少色 → 多色，来回三遍 */
  const lows = ['mard24', 'mard48', 'mard72']
  for (const low of lows) {
    const r = roundTrip('mard291', low, `往返 ${low}`)
    out.checks[`往返 ${low}`] = {
      before: r.before.count, low: r.mid.count, after: r.after.count
    }
    if (r.mid.count > r.before.count) fail(`少色反而变多 ${low}`, r.mid.count)
  }
  for (let i = 0; i < 3; i++) {
    roundTrip('mard291', 'mard24', `重复往返 ${i + 1}`)
  }

  /* 跨品牌再回来：COCO → Hama → MARD */
  const cross = snapshot()
  S.setBrand('coco291')
  const coco = snapshot()
  S.setBrand('hama')
  const hama = snapshot()
  S.setBrand('mard291')
  const back = snapshot()
  if (!sameCells(cross.cells, back.cells) || cross.count !== back.count ||
      !cross.ids.every((id, i) => id === back.ids[i])) {
    fail('跨品牌往返', { start: cross.count, coco: coco.count, hama: hama.count, back: back.count })
  }
  if (!allBrand(coco.ids, 'coco291')) fail('COCO 色号不纯', coco.ids)
  if (!allBrand(hama.ids, 'hama')) fail('Hama 色号不纯', hama.ids)
  out.checks['跨品牌往返'] = { start: cross.count, coco: coco.count, hama: hama.count, back: back.count }

  /* 手改还在：落笔那一格仍是落笔颜色，且色号属于当前品牌 */
  const k = cy * cur().width + cx
  const cellColor = cur().palette[cur().cells[k]]
  if (!cellColor || cellColor.id !== paintColor.id) {
    fail('手改丢失', { want: paintColor.id, got: cellColor && cellColor.id })
  }
  out.checks['手改保留'] = cellColor && cellColor.id

  /* 用色上限按品牌记：切到少色品牌夹小，切回来恢复 */
  S.options.targetColors = 60
  S.setBrand('mard24')
  const t24 = S.options.targetColors
  S.setBrand('mard291')
  const tBack = S.options.targetColors
  if (t24 > 24) fail('少色品牌没夹色数', t24)
  if (tBack !== 60) fail('切回来没恢复色数', tBack)
  out.checks['用色上限'] = { mard24: t24, mard291: tBack }

  /* 三个方案都换回来 */
  out.checks.variants = S.variants.value.map(v => {
    const t = v.active || v
    return {
      key: v.key,
      brand: t.brandId,
      palette: t.palette.map(c => c.brandId).filter((b, i, a) => a.indexOf(b) === i),
      count: t.palette.length,
      edits: t.editMap ? t.editMap.size : 0
    }
  })
  if (!out.checks.variants.every(v => v.brand === 'mard291' && v.palette.length === 1 && v.palette[0] === 'mard291')) {
    fail('方案品牌不纯', out.checks.variants)
  }

  /* 真实入口也走一遍：点开色板下拉换成 mard24 再换回 mard291，颜色要逐格回来 */
  async function pickBrandViaUi(id) {
    const visible = el => el && el.offsetParent !== null
    if (window.matchMedia('(max-width:780px)').matches) {
      let sel = document.querySelector('.msColorBrand select')
      if (!visible(sel)) {
        const tool = [...document.querySelectorAll('.msTool')].find(b => /颜色/.test(b.textContent) && visible(b))
        if (tool) { tool.click(); await sleep(400) }
        sel = document.querySelector('.msColorBrand select')
      }
      if (visible(sel)) {
        sel.value = id
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        await sleep(160)
        return '手机色板抽屉'
      }
    }
    const card = document.querySelector('.card--more')
    const body = card && card.querySelector('.card__body')
    if (card && body && getComputedStyle(body).display === 'none') {
      const row = card.querySelector('.moreRow')
      if (row) { row.click(); await sleep(200) }
    }
    const sideSel = document.querySelector('[data-audit="palette-select"]')
    if (visible(sideSel)) {
      sideSel.value = id
      sideSel.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(160)
      return '左栏色板'
    }
    const btn = [...document.querySelectorAll('.csBoard__btn')]
      .find(b => !/钉板/.test(b.textContent) && visible(b))
    if (btn) {
      btn.click()
      await sleep(160)
      const name = d.palettes.getBrand(id).name.replace(/\s*套装$/, '')
      const item = [...document.querySelectorAll('.csBrand__pop .csBoard__item')]
        .find(b => b.textContent.includes(name))
      if (item) {
        item.click()
        await sleep(160)
        return '命令栏'
      }
    }
    return ''
  }
  if (S.options.brandId !== 'mard291') { S.setBrand('mard291'); await sleep(120) }
  const uiBefore = snapshot()
  const toLow = await pickBrandViaUi('mard24')
  const uiLow = snapshot()
  const toBack = await pickBrandViaUi('mard291')
  const uiAfter = snapshot()
  out.checks.uiRoundTrip = { toLow, uiLow: uiLow.count, toBack, uiAfter: uiAfter.count }
  if (!toLow || !toBack) fail('uiRoundTrip', out.checks.uiRoundTrip)
  if (uiLow.count > uiBefore.count) fail('uiRoundTrip.low', uiLow.count)
  if (!sameCells(uiBefore.cells, uiAfter.cells) || uiBefore.count !== uiAfter.count ||
      !uiBefore.ids.every((id, i) => id === uiAfter.ids[i])) {
    fail('uiRoundTrip.restore', { before: uiBefore.count, low: uiLow.count, after: uiAfter.count })
  }

  return out
})()
