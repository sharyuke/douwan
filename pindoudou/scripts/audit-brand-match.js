/* 自检探针：换品牌色板时，图纸的颜色和色号必须跟着一起换。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-brand-match.js --page editorProject

   为什么要有这一项：只写 options.brandId 时，色板面板已经列着新品牌的色号，
   画布和「颜色用量」却还印着旧品牌 —— 用户看到的就是「换色板没反应」。
   这里同时核对数据与真实入口：
     · 三种视口各自的入口（桌面命令栏 / 平板左栏 / 手机色板抽屉）都能切色板；
     · 每个用到的颜色都换成新色板里 ΔE00 最近的色号（独立重算一遍对照）；
     · 形状不变（cells 长度、空格位置、豆子数）、色板无重复、色号全部属于新品牌；
     · 底稿 / 手工修改层 / 手工修改记录 / 画笔一起搬过去，不把旧色号带回来；
     · 换色板后旧撤销步骤失效（快照里的旧色板对象不能跨品牌套用）。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const tick = async () => { await sleep(160) }

  if (!S.pattern.value) return { ok: false, err: '图案未就绪' }

  const out = { ok: true, checks: {} }
  const fail = (k, v) => { out.ok = false; out.checks[k] = v }
  const paletteOf = p => (p.palette || []).map(c => ({
    id: c.id, code: c.code, brandId: c.brandId, hex: c.hex, lab: c.lab
  }))
  const active = () => S.pattern.value
  const brandOfId = id => String(id || '').split(':')[0]
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

  /* 先在图上落一笔：换色板时手工修改记录 / 修改层 / 底稿都要一起换，
     否则下一次换尺寸或重新取样会把旧品牌色号带回来。 */
  const p0 = active()
  const cx = Math.floor(p0.width / 2)
  const cy = Math.floor(p0.height / 2)
  const paintColor = S.availableColors.value.find(c => !p0.palette.some(p => p.id === c.id))
  if (!paintColor) return { ok: false, err: '没有可用的落笔颜色' }
  S.brushColorId.value = paintColor.id
  const painted = S.paintAt(cx, cy)
  await tick()
  const snapshot = () => ({
    cells: Array.from(active().cells),
    palette: paletteOf(active()),
    beadCount: active().stats.beadCount,
    canUndo: S.canUndo.value,
    editMap: active().editMap instanceof Map ? active().editMap : null
  })
  const paintedSnap = snapshot()
  out.checks.paint = { painted, canUndo: paintedSnap.canUndo, editMap: !!(paintedSnap.editMap && paintedSnap.editMap.size) }
  if (!painted) fail('paint', '无法在图上落笔')
  if (!paintedSnap.editMap || !paintedSnap.editMap.size) fail('editMap', '落笔后没有手工修改记录')

  /* 独立重算「旧色 → 新色板最近色」：不能拿实现里的映射函数自证 */
  const nearest = (color, pool) => {
    if (!color) return null
    const hit = pool.find(c => c.id === color.id)
    if (hit) return hit
    let best = pool[0]
    let bd = Infinity
    for (const c of pool) {
      const dd = d.color.deltaE2000(color.lab || [0, 0, 0], c.lab)
      if (dd < bd) { bd = dd; best = c }
    }
    return best
  }
  const verifyBrand = (brandId, label, before) => {
    const p = active()
    const pool = S.availableColors.value
    const poolIds = new Set(pool.map(c => c.id))
    const expected = before.palette.map(c => nearest(c, pool))
    const actualCodes = Array.from(p.cells).map(k => (k < 0 ? null : (p.palette[k] || {}).code || '?'))
    const expectedCodes = before.cells.map(k => (k < 0 ? null : (expected[k] ? expected[k].code : null)))
    const mismatch = []
    for (let i = 0; i < actualCodes.length; i++) {
      if (actualCodes[i] !== expectedCodes[i]) {
        mismatch.push(i)
        if (mismatch.length >= 8) break
      }
    }
    const checks = {
      入口: label,
      品牌: p.brandId,
      色板品牌: [...new Set(p.palette.map(c => c.brandId))],
      颜色数: p.palette.length,
      色号全部可用: p.palette.every(c => poolIds.has(c.id)),
      色板无重复: new Set(p.palette.map(c => c.id)).size === p.palette.length,
      豆子数: `${before.beadCount} → ${p.stats.beadCount}`,
      空格位置一致: same(Array.from(p.cells, k => k < 0), before.cells.map(k => k < 0)),
      形状一致: p.cells.length === before.cells.length,
      逐格色号不符: mismatch,
      色号确实变了: p.palette.some(c => {
        const old = before.palette.find(o => o.code === c.code)
        return !old || old.hex !== c.hex
      })
    }
    out.checks[label] = checks
    if (p.brandId !== brandId) fail(`${label}.品牌`, checks.品牌)
    if (!checks.色板品牌.every(b => b === brandId)) fail(`${label}.色板品牌`, checks.色板品牌)
    if (!checks.色号全部可用) fail(`${label}.色号全部可用`, checks.色号全部可用)
    if (!checks.色板无重复) fail(`${label}.色板无重复`, checks.色板无重复)
    if (p.stats.beadCount !== before.beadCount) fail(`${label}.豆子数`, checks.豆子数)
    if (!checks.空格位置一致) fail(`${label}.空格位置一致`, false)
    if (!checks.形状一致) fail(`${label}.形状一致`, false)
    if (mismatch.length) fail(`${label}.逐格色号`, mismatch)
    if (p.stats.colorCount !== p.palette.length) fail(`${label}.统计色数`, `${p.stats.colorCount} / ${p.palette.length}`)
    return checks
  }

  /* ---------- 1) 数据层：MARD → COCO ---------- */
  const prev1 = snapshot()
  const switched = S.setBrand('coco291')
  await tick()
  out.checks.setBrand = { switched, options: S.options.brandId }
  if (!switched) fail('setBrand', 'setBrand 没有返回 true')
  if (S.options.brandId !== 'coco291') fail('setBrand.options', S.options.brandId)
  verifyBrand('coco291', '数据层 COCO', prev1)

  /* 换色板后旧撤销步骤失效（旧快照里的色板对象不能跨品牌） */
  out.checks.history = { canUndo: S.canUndo.value, canRedo: S.canRedo.value }
  if (S.canUndo.value || S.canRedo.value) fail('history', '换色板后撤销 / 重做栈没有清空')

  /* 画笔跟着换：不能停在一个新色板里不存在的旧色号上 */
  out.checks.brush = { id: S.brushColorId.value, brand: brandOfId(S.brushColorId.value) }
  if (brandOfId(S.brushColorId.value) !== 'coco291') fail('brush', S.brushColorId.value)

  /* 底稿 / 修改层 / 修改记录一起换 */
  const p = active()
  const masterBrands = p.master && p.master.palette ? [...new Set(p.master.palette.map(c => c.brandId))] : []
  const layerBrands = p.editLayer && p.editLayer.palette ? [...new Set(p.editLayer.palette.map(c => c.brandId))] : []
  const editBrands = p.editMap ? [...new Set([...p.editMap.values()].filter(Boolean).map(e => (e.color && e.color.brandId) || brandOfId(e.id)))] : []
  out.checks.sidecars = { master: masterBrands, layer: layerBrands, editMap: editBrands }
  if (masterBrands.some(b => b !== 'coco291')) fail('sidecars.master', masterBrands)
  if (layerBrands.some(b => b !== 'coco291')) fail('sidecars.layer', layerBrands)
  if (editBrands.some(b => b !== 'coco291')) fail('sidecars.editMap', editBrands)

  /* 三个方案都换（不能只换当前显示的那一个） */
  const variantBrands = S.variants.value.map(v => ({
    key: v.key,
    base: [...new Set(((v.active || v).palette || []).map(c => c.brandId))],
    active: v.active ? [...new Set((v.active.palette || []).map(c => c.brandId))] : []
  }))
  out.checks.variants = variantBrands
  if (variantBrands.some(v => v.base.some(b => b !== 'coco291'))) fail('variants.base', variantBrands)
  if (variantBrands.some(v => v.active.some(b => b !== 'coco291'))) fail('variants.active', variantBrands)

  /* ---------- 2) 真实入口：三种视口各自点一遍 ---------- */
  S.setBrand('mard291')
  await tick()
  async function pickBrandViaUi(id) {
    const visible = el => el && el.offsetParent !== null
    /* 手机：底部「颜色」抽屉 */
    if (window.matchMedia('(max-width:780px)').matches) {
      const tool = [...document.querySelectorAll('.msTool')].find(b => /颜色/.test(b.textContent) && visible(b))
      if (tool) { tool.click(); await sleep(300) }
      const sel = document.querySelector('.msColorBrand select')
      if (visible(sel)) {
        sel.value = id
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        await tick()
        return '手机色板抽屉'
      }
    }
    /* 平板：左栏「④ 色板选择」默认收起，先展开 */
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
      await tick()
      return '左栏色板'
    }
    /* 桌面全屏工作台：命令栏的品牌下拉 */
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
        await tick()
        return '命令栏'
      }
    }
    return ''
  }
  const prev3 = snapshot()
  const entry = await pickBrandViaUi('coco291')
  out.checks.uiEntry = { entry, brand: S.options.brandId }
  if (!entry) fail('uiEntry', '找不到当前视口的品牌入口')
  if (S.options.brandId !== 'coco291') fail('uiEntry.brand', S.options.brandId)
  verifyBrand('coco291', `入口 ${entry || '无'}`, prev3)

  /* 手机色板抽屉的「本图」页签直接读 pattern.palette：换色板后这里必须显示新色号 */
  if (entry === '手机色板抽屉') {
    const usedTab = [...document.querySelectorAll('.msTabs button')].find(b => /本图/.test(b.textContent))
    if (usedTab) {
      usedTab.click()
      await sleep(200)
      const shown = [...document.querySelectorAll('.msSwatches .msSwatch span')].map(s => s.textContent.trim())
      const patternCodes = new Set(S.pattern.value.palette.map(c => c.code))
      out.checks.usedTab = { 数量: shown.length, 前几个: shown.slice(0, 10), 全部在图纸色板里: shown.every(c => patternCodes.has(c)) }
      if (!shown.length || !shown.every(c => patternCodes.has(c))) fail('usedTab', out.checks.usedTab)
    }
  }

  /* ---------- 3) 存档往返：重新打开后仍是新品牌的色号 ---------- */
  const pid = S.currentProjectId.value
  const savedId = S.saveProject('审计用示例作品', { createMode: 'free' })
  const reopened = savedId ? S.openProject(savedId) : false
  await tick()
  const reloadBrands = S.variants.value.map(v => [...new Set(((v.active || v).palette || []).map(c => c.brandId))])
  const reloadEditBrands = S.pattern.value && S.pattern.value.editMap
    ? [...new Set([...S.pattern.value.editMap.values()].filter(Boolean).map(e => (e.color && e.color.brandId) || brandOfId(e.id)))]
    : []
  out.checks.roundTrip = {
    项目: pid === savedId,
    保存: !!savedId,
    重新打开: reopened,
    品牌: S.options.brandId,
    色板品牌: reloadBrands,
    修改记录品牌: reloadEditBrands
  }
  if (!savedId || !reopened) fail('roundTrip', '保存 / 重新打开失败')
  if (S.options.brandId !== 'coco291') fail('roundTrip.品牌', S.options.brandId)
  if (reloadBrands.some(b => b.some(x => x !== 'coco291'))) fail('roundTrip.色板品牌', reloadBrands)
  if (reloadEditBrands.some(b => b !== 'coco291')) fail('roundTrip.修改记录品牌', reloadEditBrands)

  /* ---------- 4) 旧存档修复：项目品牌与图纸色号不一致时，打开即补匹配 ---------- */
  const proj = S.projects.value.find(x => x.id === savedId)
  if (proj) {
    /* 模拟旧版本留下的存档：切了品牌只改了项目设置，图纸还是上一个品牌的色号 */
    proj.brandId = 'hama'
    S.currentProjectId.value = ''
    const repaired = S.openProject(savedId)
    await tick()
    const fixed = S.pattern.value
    const brands = [...new Set(((fixed && fixed.palette) || []).map(c => c.brandId))]
    out.checks.legacyRepair = { 打开: repaired, 品牌: S.options.brandId, 色板品牌: brands }
    if (!repaired) fail('legacyRepair', '旧存档打开失败')
    if (S.options.brandId !== 'hama') fail('legacyRepair.品牌', S.options.brandId)
    if (!brands.length || brands.some(b => b !== 'hama')) fail('legacyRepair.色板品牌', brands)
  }

  return out
})()
