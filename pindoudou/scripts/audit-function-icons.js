/* 自检探针：14 个功能图标换成 icon 交付包的像素插画（2026-10-23）。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-function-icons.js --page editorProject

   断言的是「真实 DOM 里那个位置渲染的是哪张图」，不调内部数据：

     · 左栏三个来源入口：上传图片 / AI生成素材 / 免费素材库
     · 画布页签：拼豆图纸 / 原图 / 对照 / 分板 / 材料
     · 图片处理三选一：原图直接使用 / 智能抠图 / 卡通风格
     · 右栏卡片头：作品分析 / 我的库存
     · 交付面板：导出前检查
     · 手机端：顶部页签、快捷条「换图」、更多面板里的分析 / 库存、更多编辑工具里的分板 / 材料
     · 所有图标必须是 <img class="pixelIcon--art"> 且真的加载成功（naturalWidth > 0）
*/
(async () => {
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const steps = []
  const step = (name, pass, detail = '') => steps.push({ name, pass: !!pass, detail })

  /** 取元素里那张位图图标的 src；不是位图（还是 12×12 网格）就返回空串 */
  const artSrc = el => {
    const img = el && el.querySelector('img.pixelIcon--art')
    return img ? img.getAttribute('src') || '' : ''
  }
  const loaded = el => {
    const img = el && el.querySelector('img.pixelIcon--art')
    return !!img && img.complete && img.naturalWidth > 0
  }
  /* 构建后文件名带 8 位哈希（upload-FkzSvqzH.png）：去掉哈希再比原名，
     否则 original 会把 original-mode 也匹配上 */
  const fnName = src => {
    const base = String(src).split('/').pop() || ''
    return base.replace(/-[A-Za-z0-9_-]{8}\.png$/, '')
  }
  const isFn = (src, name) => fnName(src) === name

  /** 按可见文字找按钮 */
  const btnByText = (root, label) => qa(`${root} button`).find(b => txt(b).includes(label))

  const check = (label, el, file) => {
    const src = artSrc(el)
    step(`${label} 用 ${file}`, isFn(src, file), src ? fnName(src) : '还是网格图标')
    if (src) step(`${label} 图标加载成功`, loaded(el))
  }

  /** 等某个选择器出现（交付面板要画预览，800ms 不一定够） */
  const waitFor = async (sel, ms = 6000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (q(sel)) return true
      await sleep(150)
    }
    return false
  }

  try {
    if (innerWidth <= 780) {
      /* ---------- 手机 ---------- */
      const views = qa('.viewtabs button')
      step('顶部页签前 3 个是图纸 / 原图 / 对照', views.length >= 3 && txt(views[0]).includes('图纸') && txt(views[1]).includes('原图') && txt(views[2]).includes('对照'), views.map(txt).join('/'))
      check('页签·图纸', views[0], 'pattern')
      check('页签·原图', views[1], 'original')
      check('页签·对照', views[2], 'compare')

      const quick = qa('.quickRow .quickItem')
      check('快捷条·换图', quick.find(b => txt(b) === '换图'), 'upload')

      /* 更多（业务功能） */
      const more = quick.find(b => txt(b) === '更多')
      if (more) {
        more.click()
        await sleep(500)
        const items = qa('.moreItem')
        step('更多面板打开了', items.length > 0, items.map(txt).join('/'))
        check('更多·分析', items.find(b => txt(b).startsWith('分析')), 'analytics')
        check('更多·库存', items.find(b => txt(b).startsWith('库存')), 'inventory')
        /* 关抽屉只认抽屉自己的 × 按钮：页面上还有别处叫「完成」的按钮，
           按文字找会点到它，把命令栏整个重渲染掉 */
        const x = q('[role="dialog"] .dialog__head .iconbtn')
        if (x) { x.click(); await sleep(400) }
        step('更多抽屉关掉了', !q('[role="dialog"]'), q('[role="dialog"]') ? '还开着' : '')
      }

      /* 画布下方那排的「更多」：分板视图 / 材料清单 */
      const toolsMore = qa('.mobileToolbar .toolItem').find(b => txt(b) === '更多')
      if (toolsMore) {
        toolsMore.click()
        await sleep(500)
        const items = qa('.moreItem')
        step('编辑工具抽屉打开了', items.length > 0, items.map(txt).join('/'))
        check('更多工具·分板视图', items.find(b => txt(b).includes('分板视图')), 'split')
        check('更多工具·材料清单', items.find(b => txt(b).includes('材料清单')), 'materials')
        const x = q('[role="dialog"] .dialog__head .iconbtn')
        if (x) { x.click(); await sleep(400) }
      }

      /* 导出 → 交付面板 → 导出前检查（抽屉开合会重渲染命令栏，按钮重新取） */
      const delivery = qa('.quickRow .quickItem').find(b => txt(b) === '导出')
      step('找得到快捷条「导出」', !!delivery, delivery ? `disabled=${delivery.disabled}` : '')
      if (delivery && !delivery.disabled) {
        delivery.click()
        const ok = await waitFor('.acc--checks .checkIcon')
        step('交付面板打开了', ok, `panel=${qa('[data-audit="delivery-panel"]').length} tabs=${qa('.deliveryTabs button').map(txt).join('/')}`)
        if (ok) check('导出前检查', q('.acc--checks .checkIcon'), 'export-check')
      }
      return { ok: steps.every(s => s.pass), steps, width: innerWidth }
    }

    /* ---------- 桌面 / 平板 ---------- */
    const sources = qa('.sourceTabs button')
    step('左栏有 3 个来源入口', sources.length === 3, sources.map(txt).join('/'))
    check('来源·上传图片', sources.find(b => txt(b).includes('上传图片')), 'upload')
    check('来源·AI生成素材', sources.find(b => txt(b).includes('AI生成素材')), 'ai-create')
    check('来源·免费素材库', sources.find(b => txt(b).includes('免费素材库')), 'free-library')

    const views = qa('.viewtabs button')
    step('画布有 5 个页签', views.length === 5, views.map(txt).join('/'))
    check('页签·拼豆图纸', views[0], 'pattern')
    check('页签·原图', views[1], 'original')
    check('页签·对照', views[2], 'compare')
    check('页签·分板', views[3], 'split')
    check('页签·材料', views[4], 'materials')

    const procs = qa('.procTabs button')
    step('图片处理有 3 个选项', procs.length === 3, procs.map(txt).join('/'))
    check('处理·原图直接使用', procs[0], 'original-mode')
    check('处理·智能抠图', procs[1], 'cutout')
    check('处理·卡通风格', procs[2], 'cartoon')

    check('右栏·作品分析', q('.card--analysis .cardIcon'), 'analytics')
    check('右栏·我的库存', q('.card--stock .cardIcon'), 'inventory')

    /* ⑤ 图纸交付 → 打开面板 → 导出前检查 */
    const arrow = q('.card--build .cardArrowBtn')
    if (arrow && q('.card--build.is-folded')) { arrow.click(); await sleep(400) }
    const openBtn = q('[data-audit="open-delivery-build"]')
    step('找得到「打开图纸交付」', !!openBtn)
    if (openBtn && !openBtn.disabled) {
      openBtn.click()
      /* 侧栏那个入口落在「拼装与完成」页签上，导出前检查在「整张图纸」里 */
      await waitFor('[data-audit="delivery-panel"]')
      const exportTab = qa('.deliveryTabs button').find(b => txt(b) === '整张图纸')
      if (exportTab) { exportTab.click(); await sleep(300) }
      const ok = await waitFor('.acc--checks .checkIcon')
      step('交付面板打开了', ok, `panel=${qa('[data-audit="delivery-panel"]').length} tabs=${qa('.deliveryTabs button').map(txt).join('/')}`)
      if (ok) check('导出前检查', q('.acc--checks .checkIcon'), 'export-check')
    } else if (openBtn) {
      step('「打开图纸交付」可点', false, '按钮是 disabled')
    }

    return { ok: steps.every(s => s.pass), steps, width: innerWidth }
  } catch (e) {
    return { ok: false, steps, err: e && e.message, stack: e && e.stack, width: innerWidth }
  }
})()
