/* =========================================================================
   自检探针：手机工作台「一屏 + 命令栏」版式
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-mobile.js --page editor,editorProject

   为什么需要它：手机端（≤780px）已经不再把左右栏的卡片一路堆在画布下面，
   而是把左右栏整体隐藏、画布占住中间，所有命令收进底部一行按钮；点一个按钮，
   从底部升起只包含那张卡的抽屉。这套版式与桌面 / 平板完全不同，靠整页截图
   看不出「抽屉里其实叠了两张卡」「命令栏压住画布」「页面还能纵向滚」这类问题，
   所以这里量真实 DOM 位置、计算样式与真实点击结果：

     · 左右栏必须 display:none，命令栏必须是 8 颗按钮的单行网格；
     · 顶部作品条整条不显示（高度让给画布），保存 / 帮助在画布顶栏；
     · 点「保存」先弹「保存作品」名称编辑，输入框预填且自动聚焦；
     · 画布卡底边不能越过命令栏，命令栏不能压住底部标签栏；
     · 整页不能出现纵向滚动（所有命令都在这一屏）；
     · 每颗命令按钮点开必须是底部抽屉，抽屉里只能有一张对应的卡；
     · 空状态画布里的「上传图片」必须真的能触发文件选择；
     · 有图时第一颗按钮从「图片」变成「换图」；
     · 「交付」是普通弹窗，标题与内容要出来。

   宽屏（≥781px）沿用原来的断言：除 ① 创建外卡片默认收起、折叠按钮可见、
   手机下拉与宽屏按钮网格互斥、② 画布大小一行 + 弹出列表。
   ========================================================================= */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const M = await window.__douzao.membership()
  const allFree = !!M.ALL_FREE
  const box = el => (el ? el.getBoundingClientRect() : null)
  const shown = el => !!el && getComputedStyle(el).display !== 'none'
  const bodyOf = card => (card ? card.querySelector(':scope > .card__body') : null)
  /* 折叠开关现在有两种：
     ① 卡头右侧的圆钮 .cardArrowBtn 切 .is-folded（③④⑤ / 分析 / 颜色 / 库存）；
     ② ④ 色板选择的卡头本身就是那一行 .moreRow，点它切 .is-open。
     两种宽窄屏都默认收起；这里一律用字面类名，不用 :scope —— 自检失败时好排查。 */
  const foldBtnOf = card => {
    if (!card) return null
    return card.querySelector('.moreRow') ||
      card.querySelector(':scope > .card__head .cardArrowBtn') || null
  }
  const mini = () => document.querySelector('.miniPreview')

  const mobile = window.matchMedia('(max-width:780px)').matches
  const create = document.querySelector('.card--create')
  const canvasCard = document.querySelector('.canvasCard')
  if (!create || !canvasCard) return { ok: false, err: '工作台卡片没找到' }

  const cards = ['.card--more', '.card--scheme', '.card--analysis', '.card--colors', '.card--build', '.card--stock']
    .map(s => document.querySelector(s))
    .filter(Boolean)
  const out = { ok: true, mobile }

  /* ---------- 选项组：手机上只有下拉、桌面 / 平板上只有按钮网格 ----------
     两侧都量（display:none 也能 querySelector 到），元素压根不存在（还没选图时
     ③ 的下拉与方案格都不渲染）就不算它的账。
     ② 画布大小不在这一组：它是「一行 + 弹出列表」，不用下拉/网格两套控件。 */
  const DROP_PAIRS = [
    ['图片处理', '.mDrop--proc', '.procTabs'],
    ['生成方案', '.mDrop--scheme', '.schemeGrid'],
    ['颜色数量', '.mDrop--colors', '.colorRow'],
    ['填充方式', '.mDrop--fit', '.fitGrid']
  ]
  const shownSel = s => { const el = document.querySelector(s); return el ? shown(el) : null }
  out.swap = Object.fromEntries(DROP_PAIRS.map(([label, drop, grid]) =>
    [label, { drop: shownSel(drop), grid: shownSel(grid) }]))
  out.swapOk = DROP_PAIRS.every(([label]) => {
    const v = out.swap[label]
    if (v.drop === null && v.grid === null) return true
    return mobile ? (v.drop === true && v.grid === false) : (v.drop === false && v.grid === true)
  })

  /* ---------- ② 画布大小：一行 + 弹出列表 ----------
     收起时列表必须是 display:none（点得开、收得回、不能一直盖在画布上），
     而且手机上是**就地铺开**（position:static，不会溢出屏幕），
     桌面端才是 fixed 浮层（见 audit-scale 的 panelBeside）。
     这一段在宽屏量的是左栏里那张卡；手机端左栏隐藏，跳过（下面单独量抽屉）。 */
  const sizeCard = document.querySelector('.card--size')
  const sizeRow = sizeCard && sizeCard.querySelector('[data-size-row]')
  const sizePanel = sizeCard && sizeCard.querySelector('[data-size-panel]')
  if (!mobile) {
    out.sizeCollapsedByDefault = !!sizePanel && !shown(sizePanel)
    if (sizeRow && sizePanel) {
      sizeRow.click()
      await sleep(120)
      out.sizeExpandsOnTap = shown(sizePanel)
      /* 自定义尺寸那一项要能铺开、而且长宽是所选规格的整数倍 */
      const customToggle = sizeCard.querySelector('[data-custom-toggle]')
      const customBox = sizeCard.querySelector('[data-custom-box]')
      if (customToggle && customBox) {
        out.customCollapsed = !shown(customBox)
        customToggle.click()
        await sleep(80)
        out.customExpands = shown(customBox)
        const spec = sizeCard.querySelector('[data-custom-spec]')
        const cols = sizeCard.querySelector('[data-custom-cols]')
        const rows = sizeCard.querySelector('[data-custom-rows]')
        if (spec && cols && rows) {
          const setVal = (el, v) => {
            el.value = String(v)
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
          }
          /* 免费版（单边 52 格）：规格 52 钉板、横向 3 块 × 纵向 2 块会被上限收敛成 1 × 1 块；
             临时免费开放（单边 1000 格）：同样输入应当真的套成 156 × 104，不被收敛。 */
          setVal(spec, 52)
          setVal(cols, 3)
          setVal(rows, 2)
          await sleep(80)
          out.customSum = (sizeCard.querySelector('.customSum')?.textContent || '').replace(/\s+/g, ' ').trim()
          out.customNote = (sizeCard.querySelector('.customNote')?.textContent || '').replace(/\s+/g, ' ').trim()
          out.customMultiple = allFree
            ? /156\s*×\s*104/.test(out.customSum) && /最大单边 1000/.test(out.customNote)
            : /52\s*×\s*52/.test(out.customSum) && /收敛/.test(out.customNote)
        }
        customToggle.click()
        await sleep(60)
      }
      sizeRow.click()
      await sleep(100)
      out.sizeCollapsesBack = !shown(sizePanel)
    }
    /* 宽屏的 ② 已经换成「画布与成品尺寸」面板（规格下拉 + 成品尺寸滑杆），
       不再有自定义块数那一项 —— 它的功能验收在 scripts/audit-size-wide.js。
       这里只要求「默认收起 / 点开 / 再收起」，手机端（下面单独量抽屉）仍走原来的列表。 */
    const wideSize = sizeCard.hasAttribute('data-size-wide')
    out.sizeOk = out.sizeCollapsedByDefault && out.sizeExpandsOnTap && out.sizeCollapsesBack &&
      (wideSize || (out.customCollapsed === true && out.customExpands === true && out.customMultiple === true))
  }

  /* ---------- 宽屏：除 ① 创建外，卡片同样默认收起 ----------
     用户要求所有卡片（② 画布大小、③ 方案、④ 色板、分析、颜色、⑤ 交付、库存）
     默认折叠，只有 ① 创建保持展开；折叠按钮在宽屏也必须可见。
     ② 画布大小没有 .card__body，单独用 sizePanel 的显隐来量。 */
  if (!mobile) {
    out.allFoldedOnWide = cards.every(c => !shown(bodyOf(c)))
    out.sizeFoldedOnWide = !!sizePanel && !shown(sizePanel)
    out.foldButtonsOnWide = cards.every(c => shown(foldBtnOf(c)))
    out.noMiniOnWide = !mini()
    out.ok = out.allFoldedOnWide && out.sizeFoldedOnWide && out.foldButtonsOnWide &&
      out.noMiniOnWide && out.swapOk && out.sizeOk
    return out
  }

  /* ======================================================================
     手机：左右栏隐藏 + 命令栏 + 画布占一屏
     ====================================================================== */
  const styleOf = (sel, prop) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el)[prop] : null
  }
  out.asidesHidden = styleOf('.studio__sidebar', 'display') === 'none' &&
    styleOf('.studio__insights', 'display') === 'none'

  /* 手机端：顶栏右侧「功能 ▾ / 编辑 ▾」两颗按钮同一行，默认都收起；
     「功能」点开是 4 列 × 2 行的八功能浮层（不再是底部胶囊）。 */
  const cmdBtns = [...document.querySelectorAll('.cmdBtn')]
  const visible = el => !!el && el.getClientRects().length > 0
  out.cmdShown = cmdBtns.length === 2 && cmdBtns.every(visible)
  out.cmdSameRow = cmdBtns.length === 2 &&
    Math.abs(box(cmdBtns[0]).top - box(cmdBtns[1]).top) <= 1 &&
    box(cmdBtns[0]).right <= box(cmdBtns[1]).left + 1
  out.cmdLabels = cmdBtns.map(b => b.textContent.replace(/\s+/g, ' ').trim())
  cmdBtns[0]?.click()
  await sleep(260)
  const fnItems = [...document.querySelectorAll('.fnGrid__item')]
  const fnGrid = document.querySelector('.fnGrid')
  out.fnPopShown = visible(document.querySelector('.cmdPop--func'))
  out.cmdCount = fnItems.length
  out.cmdLabels = fnItems.map(b => b.textContent.replace(/\s+/g, ' ').trim())
  out.cmdRows = fnGrid ? new Set(fnItems.map(b => Math.round(b.getBoundingClientRect().top))).size : 0
  out.cmdCols = fnGrid ? getComputedStyle(fnGrid).gridTemplateColumns.split(' ').length : 0

  /* 互斥：点「编辑」后功能浮层必须消失；Escape 收起编辑浮层 */
  cmdBtns[1]?.click()
  await sleep(260)
  out.mutual = !document.querySelector('.cmdPop--func') && visible(document.querySelector('.cmdPop--edit'))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(220)
  out.escapeClosed = !document.querySelector('.cmdPop--edit')

  const toolbarRect = box(document.querySelector('.canvasCard__toolbar'))
  const canvasRect = box(canvasCard)
  const stageRect = box(document.querySelector('.stage'))
  const tabbarRect = box(document.querySelector('.tabbar'))
  out.layout = {
    toolbarBottom: Math.round(toolbarRect.bottom),
    canvasBottom: Math.round(canvasRect.bottom),
    stageTop: Math.round(stageRect.top),
    stageBottom: Math.round(stageRect.bottom),
    tabbarTop: tabbarRect ? Math.round(tabbarRect.top) : null,
    viewport: innerHeight,
    docOverflow: document.documentElement.scrollHeight - innerHeight,
    stageHeight: Math.round(stageRect.height)
  }
  out.toolbarAboveStage = stageRect.top >= toolbarRect.bottom - 1
  out.canvasAboveTabbar = !tabbarRect || canvasRect.bottom <= tabbarRect.top + 1
  out.noPageScroll = out.layout.docOverflow <= 1
  out.stageTall = stageRect.height >= 180
  /* 顶部作品条在手机上整条不显示，把高度让给画布；保存收进「功能」浮层 */
  const titleBar = document.querySelector('.canvasTitleBar')
  out.titleBarHidden = !titleBar || getComputedStyle(titleBar).display === 'none'

  /* 画布下方工具条 / 笔刷条在手机上整块隐藏，工具进「编辑 ▾」浮层；
     画布上只留四颗轻量浮控，不再有常驻窄栏。 */
  const rail = document.querySelector('.toolRail')
  const editPanel = document.querySelector('.editPanel')
  const floaters = [...document.querySelectorAll('.stageTools__btn')]
  out.editMenu = {
    rail: visible(rail),
    floaters: floaters.map(b => b.getAttribute('aria-label')),
    panelClosed: !document.querySelector('.cmdPop--edit')
  }

  const hasCanvas = !!document.querySelector('.stage canvas')
  out.editMenuOk = hasCanvas
    ? !out.editMenu.rail && out.editMenu.floaters.length === 4 && out.editMenu.panelClosed
    : !out.editMenu.rail && out.editMenu.panelClosed
  const firstLabel = out.cmdLabels[0] || ''
  out.uploadLabel = /换图/.test(firstLabel) ? '换图' : (/图片/.test(firstLabel) ? '图片' : '')
  /* 八功能固定写「换图」：空状态点它也进同一个上传面板 */
  out.uploadLabelOk = out.uploadLabel === '换图'

  /* 保存：手机「功能 ▾」浮层底部的保存按钮，先弹「保存作品」名称编辑，确认后才落盘 */
  let saveBtn = null
  if (hasCanvas) {
    cmdBtns[0]?.click()
    await sleep(260)
    saveBtn = document.querySelector('.fnSave')
    out.saveInFunctions = !!saveBtn
  }
  if (hasCanvas && saveBtn && !saveBtn.disabled) {
    saveBtn.click()
    await sleep(380)
    const dlg = document.querySelector('.modal.show .dialog')
    const input = dlg?.querySelector('input')
    out.saveDialog = {
      shown: !!dlg,
      title: (dlg?.querySelector('.dialog__head h2')?.textContent || '').trim(),
      value: input?.value || '',
      focused: document.activeElement === input
    }
    dlg?.querySelector('.dialog__head .iconbtn')?.click()
    await sleep(280)
    out.saveDialog.closed = !document.querySelector('.modal.show')
    out.saveDialog.ok = out.saveDialog.shown && out.saveDialog.title === '保存作品' &&
      !!out.saveDialog.value && out.saveDialog.focused && out.saveDialog.closed
  }

  /* 空状态画布里的上传入口：按钮在画布内，点了要真的触发隐藏的 file input */
  if (!hasCanvas) {
    const up = document.querySelector('.emptyActions .btn.primary')
    out.uploadBtnShown = !!up && up.offsetParent !== null
    if (up) {
      let clicks = 0
      const orig = HTMLInputElement.prototype.click
      HTMLInputElement.prototype.click = function () { clicks++ }
      up.click()
      HTMLInputElement.prototype.click = orig
      out.uploadClickWired = clicks > 0
    }
  }

  /* 每个命令：底部抽屉 + 只显示一张卡 */
  const PANELS = [
    ['create', '图片', 'card--create', /图片|换图/],
    ['size', '画布与成品尺寸', 'card--size', /画布/],
    ['scheme', '生成方案', 'card--scheme', /方案/],
    ['palette', '色板与参数', 'card--more', /色板/],
    ['analysis', '作品分析', 'card--analysis', /分析/],
    ['colors', '颜色用量', 'card--colors', /用量/],
    ['stock', '我的库存', 'card--stock', /库存/]
  ]
  out.panels = {}
  /* 八功能现在藏在顶栏「功能 ▾」浮层里：每次先点开面板，再按文案点对应格子。 */
  async function pickFunction(re) {
    const p = document.querySelector('.cmdBtn')
    if (!p) return null
    p.click()
    await sleep(240)
    const btn = [...document.querySelectorAll('.fnGrid__item')].find(b => re.test(b.textContent))
    if (!btn) return null
    btn.click()
    await sleep(420)
    return btn
  }
  for (const [key, title, cls, label] of PANELS) {
    const btn = await pickFunction(label)
    if (!btn) {
      out.panels[key] = { ok: false, err: 'button missing' }
      continue
    }
    const modal = document.querySelector('.modal.show')
    const dialog = modal && modal.querySelector('.dialog')
    const shownCards = modal
      ? [...modal.querySelectorAll('.card')].filter(c => getComputedStyle(c).display !== 'none')
      : []
    const card = shownCards[0]
    const body = card && card.querySelector('.card__body')
    const info = {
      sheet: !!modal && modal.classList.contains('modal--sheet'),
      title: (dialog?.querySelector('.dialog__head h2')?.textContent || '').trim(),
      cards: shownCards.length,
      cardClass: card?.className || '',
      bodyShown: !card || !body || shown(body),
      dialogBottom: dialog ? Math.round(dialog.getBoundingClientRect().bottom) : null
    }
    /* 空状态下「颜色用量」没有卡片，只留一句说明；这句必须真的出现。 */
    const emptyColors = !hasCanvas && key === 'colors'
    if (emptyColors) {
      info.emptyText = (dialog?.querySelector('.dialog__body')?.textContent || '').replace(/\s+/g, ' ').trim()
    }
    info.ok = info.sheet && info.title === title &&
      (emptyColors
        ? info.cards === 0 && /生成图纸后/.test(info.emptyText || '')
        : info.cards === 1 && info.cardClass.includes(cls) && info.bodyShown) &&
      (info.dialogBottom == null || info.dialogBottom <= innerHeight + 1)
    const close = dialog?.querySelector('.dialog__head .iconbtn')
    if (close) close.click()
    await sleep(260)
    info.closed = !document.querySelector('.modal.show')
    info.ok = info.ok && info.closed
    out.panels[key] = info
  }

  /* 「画布大小」抽屉不能只剩标题：那张卡就是抽屉正文，桌面端「点外面收起」的规则
     在手机端会把正文收掉、留下一个空抽屉。这里按一下抽屉标题（拖把手的起点），
     列表必须还在；选一档之后抽屉要直接关掉，不能留下空壳。 */
  if (hasCanvas) {
    await pickFunction(/画布/)
    const dlg = document.querySelector('.modal.show .dialog')
    const bodyEl = dlg && dlg.querySelector('.dialog__body')
    const bodyBefore = bodyEl ? Math.round(bodyEl.getBoundingClientRect().height) : 0
    dlg?.querySelector('.dialog__head')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await sleep(140)
    const panelAfter = dlg && dlg.querySelector('[data-size-panel]')
    const bodyAfter = bodyEl ? Math.round(bodyEl.getBoundingClientRect().height) : 0
    const row = dlg && (dlg.querySelector('[data-size="52×52"]') || dlg.querySelector('.sizeList .pick--row'))
    if (row) row.click()
    await sleep(600)
    out.sizeSheet = {
      bodyBefore,
      bodyAfter,
      panelKept: !!panelAfter && shown(panelAfter),
      closedAfterPick: !document.querySelector('.modal.show')
    }
    out.sizeSheet.ok = bodyBefore > 120 && out.sizeSheet.panelKept && bodyAfter > 120 &&
      out.sizeSheet.closedAfterPick
  }

  /* 交付：普通弹窗（不是抽屉），标题与内容要出来 */
  const deliveryBtn = await pickFunction(/交付/)
  let deliveryOk = false
  if (deliveryBtn) {
    await sleep(400)
    const dlg = document.querySelector('.modal.show .dialog')
    const title = (dlg?.querySelector('.dialog__head h2')?.textContent || '').trim()
    deliveryOk = title === '图纸交付' && !!dlg?.querySelector('.dialog__body')
    dlg?.querySelector('.dialog__head .iconbtn')?.click()
    await sleep(260)
    deliveryOk = deliveryOk && !document.querySelector('.modal.show')
  }
  out.deliveryOk = deliveryOk

  out.ok = out.asidesHidden && out.cmdShown && out.cmdSameRow && out.cmdCount === 8 &&
    out.fnPopShown && out.mutual && out.escapeClosed &&
    out.toolbarAboveStage && out.canvasAboveTabbar && out.noPageScroll &&
    out.stageTall && out.titleBarHidden && out.cmdRows === 2 && out.cmdCols === 4 &&
    (hasCanvas ? out.saveInFunctions : true) &&
    out.editMenuOk && out.uploadLabelOk && out.deliveryOk &&
    (!hasCanvas || !!out.sizeSheet?.ok) &&
    (hasCanvas ? !!out.saveDialog?.ok : true) &&
    Object.values(out.panels).every(p => p.ok) &&
    (hasCanvas || (out.uploadBtnShown && out.uploadClickWired))

  return out
})()
