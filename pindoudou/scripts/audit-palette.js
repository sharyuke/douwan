/* 色板选择器自检：把用户能选色板的三个入口原样读出来核对。
     · 工作台左栏「④ 色板选择」（展开后重点突出的色板块里的 select，/editor）
     · 设置页「默认色板」（select，/settings）
     · 库存页「选择色板」（按钮组，/inventory）
   核对内容：15 套内置色板 + 1 个自定义、顺序、每项显示的色数、以及免费 / Pro 的可用色号数。

   为什么要有这一项：色板清单是「数据 + 界面 + 会员权益」三处拼起来的，
   数据层有 scripts/palette-selfcheck.mjs 兜底，但「下拉框里到底有没有这一项、
   文案里的色数对不对、免费版切到别的品牌会不会被砍成 48 色」只有真跑浏览器才知道。

   用法：node scripts/audit.cjs --eval-file scripts/audit-palette.js --page editor,settings,inventory */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const M = await d.membership()
  const freeMode = !!M.ALL_FREE
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  /* 期望的顺序与色数（与 src/data/palette.js 一致；故意写死，
     这样「数据被改了但没人注意」会在这里暴露出来） */
  const EXPECT = [
    ['mard291', 291], ['mard264', 264], ['mard221', 221], ['mard120', 120],
    ['mard96', 96], ['mard72', 72], ['mard48', 48], ['mard24', 24],
    ['coco291', 291], ['manman278', 278], ['panpan289', 291], ['mixiaowo290', 286],
    ['artkal-c197', 197], ['hama', 92], ['perler', 103]
  ]
  const EXPECT_IDS = EXPECT.map(([id]) => id)

  const dumpSelect = el => el ? {
    count: el.options.length,
    selected: el.value,
    options: [...el.options].map(o => ({ v: o.value, t: o.textContent.trim() }))
  } : null

  /* 工作台那一个挂在「展开后重点突出的色板块」里，不再是 .field + label 的结构，
     所以先按 data-audit 找自己人；找不到再退回按标签找（设置页用那条路）。 */
  const findSelectByLabel = text => {
    /* 手机抽屉里的那一份优先：左栏虽然还在 DOM 里，但已经 display:none，
       量它等于量一个用户看不见的控件。 */
    const tagged = document.querySelector('.modal--sheet [data-audit="palette-select"]') ||
      document.querySelector('[data-audit="palette-select"]')
    if (tagged && tagged.options.length) return tagged
    for (const f of document.querySelectorAll('.field')) {
      const lab = f.querySelector('label')
      if (lab && lab.textContent.includes(text)) {
        const s = f.querySelector('select')
        if (s && s.options.length) return s
      }
    }
    return null
  }

  const findBrandButtons = () => {
    for (const sec of document.querySelectorAll('section.card, .card')) {
      const h = sec.querySelector('h3, h2')
      if (h && h.textContent.includes('色板')) {
        const btns = [...sec.querySelectorAll('.tabs button')]
        if (btns.length) return btns.map(b => b.textContent.trim())
      }
    }
    return null
  }

  const out = { ok: true, checks: {} }

  /* 手机工作台把左栏藏起来，色板卡在画布上方快捷区的「色板」里。先点快捷区、
     量抽屉里的真实控件；桌面 / 平板仍按左栏那张卡来量。 */
  const isEditorPage = (location.hash || '').startsWith('#/editor')
  const mobile = window.matchMedia('(max-width:780px)').matches
  let sheetOpened = false
  if (isEditorPage && mobile) {
    const cmd = [...document.querySelectorAll('.quickItem')]
      .find(b => /色板/.test(b.textContent))
    if (cmd) {
      cmd.click()
      await sleep(500)
      sheetOpened = !!document.querySelector('.modal--sheet')
    }
    out.checks.mobileSheet = sheetOpened
    if (!sheetOpened) out.ok = false
  }

  /* 工作台的那张卡宽窄屏都默认收起，收起时色板下拉是 display:none ——
     自检要量的是展开后的真实控件，所以先把它点开。量完（本函数 return 前）再收回去，
     别让自检自己改的版面留到下一条用例的截图里。 */
  const moreCard = (sheetOpened ? document.querySelector('.modal--sheet .card--more') : null) ||
    document.querySelector('.card--more')
  const moreToggle = moreCard && moreCard.querySelector('.moreRow')
  const moreBody = moreCard && moreCard.querySelector('.card__body')
  const moreWasFolded = !!(moreBody && getComputedStyle(moreBody).display === 'none')
  if (moreWasFolded && moreToggle) {
    moreToggle.click()
    await sleep(150)
    out.checks.moreExpanded = true
  }

  /* ---------- 1) 下拉框形态（工作台 / 设置页） ---------- */
  const sel = findSelectByLabel('色板')
  const dump = dumpSelect(sel)
  if (dump) {
    const ids = dump.options.map(o => o.v)
    const missing = EXPECT_IDS.filter(id => !ids.includes(id))
    const wrongCount = dump.options
      .filter(o => EXPECT.some(([id, n]) => id === o.v && !o.t.includes(String(n))))
      .map(o => o.t)
    out.checks.select = {
      选项数: dump.count, 当前: dump.selected, 缺色板: missing, 色数文案不符: wrongCount,
      顺序: ids.join(' > ')
    }
    if (missing.length || wrongCount.length) out.ok = false
    if (dump.count !== EXPECT.length + 1) { out.ok = false; out.checks.select.err = `选项数应为 ${EXPECT.length + 1}` }
  }

  /* ---------- 2) 按钮组形态（库存页） ---------- */
  const btns = findBrandButtons()
  if (btns) {
    const text = btns.join(' | ')
    const missing = EXPECT.filter(([id, n]) => {
      const name = d.palettes.getBrand(id).name
      return !btns.some(t => t.includes(name))
    }).map(([id]) => id)
    out.checks.buttons = { 按钮数: btns.length, 缺色板: missing, 文案: text }
    if (missing.length) out.ok = false
    if (btns.length !== EXPECT.length + 1) { out.ok = false; out.checks.buttons.err = `按钮数应为 ${EXPECT.length + 1}` }
  }

  /* ---------- 3) 免费版权益：切品牌到底能用多少色 ---------- */
  if (sel && S.availableColors && S.options) {
    const MAXV = d.pattern.MAX_TARGET_COLORS
    const sel2 = sel
    const set = async v => {
      sel2.value = v
      sel2.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(400)
    }
    const before = S.options.brandId.value
    await set('coco291')
    const coco = { limit: S.availableColors.value.length, target: S.options.targetColors.value }
    await set('mard291')
    const mard = { limit: S.availableColors.value.length, target: S.options.targetColors.value }
    await set('mard24')
    const mard24 = { limit: S.availableColors.value.length }
    await set(before || 'mard291')
    out.checks.entitlement = { coco, mard, mard24 }
    // 临时免费开放：所有品牌都给全色号；恢复会员制后非漫德回落 48 色
    if (freeMode) {
      if (coco.limit !== 291) out.ok = false
    } else if (coco.limit !== 48) {
      out.ok = false
    }
    if (mard.limit !== 291 || mard24.limit !== 24) out.ok = false
    if (mard.target > MAXV || coco.target > MAXV) out.ok = false

    /* ---------- 4) 「颜色数量」的上限：滑块 / 数字框 / 下拉三处必须一致 = 引擎上限 ----------
       这一条是「把颜色数量最大加到 291」这件事的验收点：改了常量但界面某处还写死旧值，
       表现就是「滑到头也只到 221」——只读常量的单测看不出来，得量真实控件。 */
    const rangeEl = document.querySelector('[data-audit="target-colors"][type="range"]')
    const numEl = document.querySelector('[data-audit="target-colors"][type="number"]')
    const ladderSel = document.querySelector('select[aria-label="颜色数量"]')
    const ladder = ladderSel ? Math.max(...[...ladderSel.options].map(o => Number(o.value))) : null
    out.checks.targetMax = {
      引擎上限: MAXV,
      滑块max: rangeEl && rangeEl.getAttribute('max'),
      数字框max: numEl && numEl.getAttribute('max'),
      下拉最大档: ladder,
      当前色板: S.options.brandId.value,
      当前可用色号: S.availableColors.value.length
    }
    if (!rangeEl || Number(rangeEl.getAttribute('max')) !== MAXV) out.ok = false
    if (numEl && Number(numEl.getAttribute('max')) !== MAXV) out.ok = false
    if (ladder != null && ladder !== MAXV) out.ok = false
    if (isEditorPage && (!numEl || ladder == null)) out.ok = false
  }

  /* 把工作台那张卡收回进入时的样子（原本收起才收） */
  if (moreWasFolded && moreToggle) {
    moreToggle.click()
    await sleep(100)
  }
  /* 手机抽屉量完就关掉，别让截图和下一条用例看到它 */
  if (sheetOpened) {
    document.querySelector('.modal--sheet .dialog__head .iconbtn')?.click()
    await sleep(200)
  }

  return out
})()
