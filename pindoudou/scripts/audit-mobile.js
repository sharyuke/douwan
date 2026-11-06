/* =========================================================================
   自检探针：手机工作台「一屏 + 命令栏」版式
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-mobile.js --page editor,editorProject

   为什么需要它：手机端（≤780px）已经不再把左右栏的卡片一路堆在画布下面，
   而是把左右栏整体隐藏、画布占住中间，所有命令收进底部一行按钮；点一个按钮，
   从底部升起只包含那张卡的抽屉。这套版式与桌面 / 平板完全不同，靠整页截图
   看不出「抽屉里其实叠了两张卡」「命令栏压住画布」「页面还能纵向滚」这类问题，
   所以这里量真实 DOM 位置、计算样式与真实点击结果：

     · 左右栏必须 display:none，快捷区 5 颗 + 工具行 6 颗各占一行；
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

  /* 全屏创作工作台（≥1100px，2026-11 按 Figma 改版）没有左栏卡片：
     卡片折叠 / 选图卡那一套断言只适用于平板的三栏版面，
     桌面这一档的版面由 scripts/verify-console.cjs 单独验收。 */
  if (document.querySelector('.csTop')) return { ok: true, consoleMode: true, skipped: true }

  const mobile = window.matchMedia('(max-width:780px)').matches

  /* ======================================================================
     v3 手机工作台（Figma 124:887）：顶栏 / 模式栏 / 画布 / 缩放栏 / 工具轨 / 底部抽屉
     ====================================================================== */
  if (document.querySelector('.msTop')) {
    const out = { ok: true, mobile: true, mode: 'mobile-v3' }
    const visible = el => !!el && el.getClientRects().length > 0
    const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '')
    const rect = sel => box(document.querySelector(sel))
    const hasCanvas = !!document.querySelector('.stage canvas')

    /* 顶栏：品牌 + 保存 / 导出 / 更多 */
    out.top = {
      logo: !!document.querySelector('.msTop__logo'),
      save: txt(document.querySelector('.msTop .msPill')),
      export: txt(document.querySelector('.msPill--dark')),
      more: !!document.querySelector('.msTop .msIcon')
    }
    /* 命令栏：只剩换图 / 图纸调整 / 素材库（自由画布与视图页签都去掉了） */
    const cmdBtns = [...document.querySelectorAll('.msCmd > button')]
    out.cmd = {
      labels: cmdBtns.map(txt),
      upload: txt(document.querySelector('.msCmd__upload')),
      adjust: txt(cmdBtns.find(b => /图纸调整/.test(txt(b)))),
      materials: txt(document.querySelector('.msCmd__materials')),
      modeButtonsGone: !cmdBtns.some(b => /自由画布|图纸转换/.test(txt(b))),
      viewTabsGone: !document.querySelector('.msViews')
    }
    out.cmd.ok = out.cmd.modeButtonsGone && out.cmd.viewTabsGone &&
      out.cmd.labels.join(',') === '换图,图纸调整,素材库' && out.cmd.materials === '素材库'
    /* 画布 + 缩放栏 + 工具轨 */
    out.zoom = {
      shown: visible(document.querySelector('.msZoom')),
      undo: !!document.querySelector('.msZoom [title="撤销"]'),
      redo: !!document.querySelector('.msZoom [title="重做"]'),
      fit: !!document.querySelector('.msZoom__fit'),
      pct: txt(document.querySelector('.msZoom__pct'))
    }
    const tools = [...document.querySelectorAll('.msTools .msTool')]
    out.tools = {
      labels: tools.map(txt),
      count: tools.length,
      sameRow: tools.length > 0 && new Set(tools.map(b => Math.round(b.getBoundingClientRect().top))).size === 1
    }
    out.layout = {
      canvas: hasCanvas,
      docOverflow: document.documentElement.scrollHeight - innerHeight,
      top: rect('.msTop'),
      tools: rect('.msTools'),
      viewport: [innerWidth, innerHeight]
    }
    out.noPageScroll = out.layout.docOverflow <= 1
    out.toolsAtBottom = !!out.layout.tools && Math.abs(out.layout.tools.bottom - innerHeight) <= 1
    /* 旧版手机工作台的浮层不应该再出现（空画布时画布内的「上传图片 / 素材库」是 v3 空状态，不算旧版） */
    out.legacyGone = !document.querySelector('.quickRow') && !document.querySelector('.mobileToolbar')

    /* 颜色抽屉：打开有真实色块，收起后消失 */
    const colorBtn = document.querySelector('.msTool--color')
    if (colorBtn && !colorBtn.disabled) {
      colorBtn.click(); await sleep(420)
      out.colorSheet = {
        open: !!document.querySelector('.msSheet--color'),
        title: txt(document.querySelector('.msSheet__head b')),
        swatches: document.querySelectorAll('.msSwatch').length
      }
      document.querySelector('.msSheet__head button')?.click(); await sleep(300)
      out.colorSheet.closed = !document.querySelector('.msSheet--color')
      out.colorSheet.ok = out.colorSheet.open && out.colorSheet.title === '颜色' &&
        out.colorSheet.swatches > 0 && out.colorSheet.closed
    }

    /* 更多工具抽屉：画笔大小 + 辅助绘制 + 图纸处理 */
    const moreBtn = [...document.querySelectorAll('.msTools .msTool')].find(b => /更多工具/.test(txt(b)))
    if (moreBtn && !moreBtn.disabled) {
      moreBtn.click(); await sleep(420)
      out.moreSheet = {
        open: !!document.querySelector('.msSheet--more'),
        title: txt(document.querySelector('.msSheet__head b')),
        groups: [...document.querySelectorAll('.msGroupTitle')].map(txt),
        triple: document.querySelectorAll('.msTriple__btn').length
      }
      document.querySelector('.msSheet__head button')?.click(); await sleep(300)
      out.moreSheet.closed = !document.querySelector('.msSheet--more')
      out.moreSheet.ok = out.moreSheet.open && out.moreSheet.title === '更多工具' &&
        out.moreSheet.groups.join(',') === '辅助绘制,图纸处理' &&
        out.moreSheet.triple === 3 && out.moreSheet.closed
    }

    /* ⋯ 菜单抽屉：点遮罩收起 */
    document.querySelector('.msTop .msIcon')?.click(); await sleep(420)
    out.menuSheet = { open: !!document.querySelector('.msSheet--menu'), title: txt(document.querySelector('.msSheet__head b')) }
    document.querySelector('.msScrim')?.click(); await sleep(300)
    out.menuSheet.closed = !document.querySelector('.msSheet--menu')
    out.menuSheet.ok = out.menuSheet.open && out.menuSheet.title === '更多' && out.menuSheet.closed

    /* 图纸调整抽屉：图纸设置（钉板 / 品牌色系）在成品尺寸上面，再是智能抠图 */
    const adjustBtn = cmdBtns.find(b => /图纸调整/.test(txt(b)))
    if (adjustBtn) {
      adjustBtn.click(); await sleep(450)
      const iap = document.querySelector('.iap')
      const sec = document.querySelector('[data-adjust-board-brand]')
      const kids = iap ? [...iap.children] : []
      out.adjustSheet = {
        open: !!document.querySelector('.msSheet'),
        title: txt(document.querySelector('.msSheet__head b')),
        boards: sec ? [...sec.querySelectorAll('.iap__board')].map(txt) : [],
        brandOptions: sec ? sec.querySelectorAll('select option').length : 0,
        hint: txt(sec && sec.querySelector('.iap__hint')),
        matte: !!document.querySelector('[data-adjust-matte]'),
        order: kids.map(el => el.hasAttribute('data-adjust-board-brand') ? 'board'
          : el.hasAttribute('data-size-card') ? 'size'
          : el.hasAttribute('data-adjust-matte') ? 'matte'
          : (el.className || '').toString())
      }
      document.querySelector('.msSheet__head button')?.click(); await sleep(300)
      out.adjustSheet.closed = !document.querySelector('.msSheet')
      out.adjustSheet.ok = out.adjustSheet.open && out.adjustSheet.title === '图纸调整' &&
        out.adjustSheet.boards.length === 5 &&
        out.adjustSheet.boards[0].startsWith('52') &&
        out.adjustSheet.brandOptions > 1 && out.adjustSheet.matte &&
        out.adjustSheet.order.join(',') === 'board,size,matte' &&
        /成品尺寸在下面调/.test(out.adjustSheet.hint) &&
        !/倍数/.test(txt(sec)) &&
        out.adjustSheet.closed
    }

    /* 导出：有图纸时打开「导出」弹窗；空画布时按钮禁用 */
    const exportBtn = document.querySelector('.msPill--dark')
    if (hasCanvas) {
      exportBtn.click(); await sleep(700)
      out.exportDialog = { title: txt(document.querySelector('.dialog__title')) }
      document.querySelector('.dialog__head .iconbtn')?.click(); await sleep(300)
      out.exportDialog.closed = !document.querySelector('.dialog__title')
      out.exportDialog.ok = out.exportDialog.title.includes('导出') && out.exportDialog.closed
    } else {
      out.exportDisabledWhenEmpty = !!exportBtn && exportBtn.disabled
    }

    out.ok = out.top.logo && out.top.save === '保存' && out.top.export === '导出' && out.top.more &&
      !!out.cmd.ok &&
      out.zoom.shown && out.zoom.undo && out.zoom.redo && out.zoom.fit &&
      out.tools.count === 5 && out.tools.labels.join(',') === '画笔,橡皮,换色,颜色,更多工具' && out.tools.sameRow &&
      out.noPageScroll && out.toolsAtBottom && out.legacyGone && !!out.menuSheet.ok &&
      !!out.adjustSheet?.ok &&
      (hasCanvas
        ? (!!out.colorSheet?.ok && !!out.moreSheet?.ok && !!out.exportDialog?.ok)
        : out.exportDisabledWhenEmpty === true)
    return out
  }

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

  /* 手机端已由上面的 v3 分支返回；走到这里说明版面既不是全屏工作台也不是手机工作台 */
  return { ok: false, err: '未知工作台版面' }
})()
