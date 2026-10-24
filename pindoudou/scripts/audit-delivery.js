/* 图纸交付自检（需求 V1.1 第二部分）：
   - DPI 计划按物理尺寸算像素，并在超过画布上限时如实降档
   - 面板能从左栏 ⑤「图纸交付」卡片打开，三个页签都有内容
   - 分板页签没有 fatal 检查项，导出项齐全
   - 拼装页签能显示进度与入口
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-delivery.js --page editorProject */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const p = S.pattern.value
  if (!p) return { ok: false, err: '预置作品没有图纸' }
  const E = d.exporters

  /* ① 纯函数：52×52 / 5mm 豆在 300 DPI 下应算出 59 px/格 */
  const full = E.dpiExportPlan(p, { dpi: 300, mode: 'full' })
  const split = E.dpiExportPlan(p, { dpi: 300, mode: 'split' })
  const pdf = E.dpiExportPlan(p, { dpi: 300, mode: 'pdf' })
  const expectCell = Math.round((p.beadMm || 5) / 25.4 * 300)

  /* ② 大画布：450×450、120 钉板，300 DPI 单张必然超 4096 px，必须 capped */
  const big = { width: 450, height: 450, beadKey: 'm5', beadMm: 5, boardSize: { x: 120, y: 120 } }
  const bigFull = E.dpiExportPlan(big, { dpi: 300, mode: 'full' })
  const bigSplit = E.dpiExportPlan(big, { dpi: 300, mode: 'split' })

  /* ③ ZIP 写入器：store 模式的最小 ZIP，至少要有本地头 / 中央目录 / EOCD */
  const zip = E.makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }])
  const zipHead = new Uint8Array(await zip.slice(0, 4).arrayBuffer())
  const zipTail = new Uint8Array(await zip.slice(zip.size - 22).arrayBuffer())
  const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

  /* ④ 分板 PDF 文档：全局坐标 / DPI / 每板统计都要在，且不允许出现「本板局部」这种重新起算的坐标 */
  let printHtml = ''
  try {
    printHtml = E.buildPrintHTML(p, { projectName: '审计', cell: split.cell })
  } catch (e) {
    printHtml = 'ERR:' + (e && e.message)
  }
  /* PDF 每板页眉的颗数必须是「真正要放的豆数」，不是「板子容量」：
     这块 52×52 的板抠掉背景后是 2134 颗，容量 2704 颗，两个数不能混。 */
  const pdfBeadsActual = printHtml.includes(`本板 ${(p.stats.beadCount || 0).toLocaleString()} 颗`) &&
    !printHtml.includes(`本板 ${(p.width * p.height).toLocaleString()} 颗`)
  /* 每板色号图例的数量必须带单位：G15 × 460 颗 */
  const pdfLegendUnit = /× \d+ 颗/.test(printHtml)

  const csv = d.pattern.toMaterialsCSV(p, null, '审计')
  const csvLines = csv.split('\n')
  const csvHead = csvLines.find(l => l.startsWith('品牌/系列')) || ''
  const csvRow = csvLines[csvLines.indexOf(csvHead) + 1] || ''

  /* ④b 单板标尺必须沿用整图的全局列号。
     直接画第二块板（29 格分板 → 从第 30 列开始），临时接住 fillText 看标尺上写了什么：
     全局编号应出现 30 / 35 / 40 / 45 / 50，局部编号会从 1 / 5 / 10 重新开始。 */
  let rulerGlobal = false
  let rulerLabels = []
  try {
    const lay29 = d.pattern.boardLayout(p.width, p.height, { x: 29, y: 29 })
    const cv = document.createElement('canvas')
    cv.__dpr = 1
    const proto = CanvasRenderingContext2D.prototype
    const orig = proto.fillText
    const calls = []
    proto.fillText = function (text, x, y, ...rest) {
      calls.push({ text: String(text), x: Number(x), y: Number(y) })
      return orig.call(this, text, x, y, ...rest)
    }
    try {
      d.render.drawBoard(cv, p, lay29.boards[1], { cell: 12, codes: false, ruler: true, grid: false })
    } finally {
      proto.fillText = orig
    }
    /* 上下标尺在 y≈R/2 与 y≈OY+gridH+R/2，只取这一组就是列号 */
    const R = Math.max(14, Math.round(12 * 1.7))
    const gridH = lay29.boards[1].h * 12
    rulerLabels = calls
      .filter(c => c.y < R + 6 || c.y > R + gridH - 6)
      .map(c => Number(c.text))
      .filter(n => Number.isFinite(n))
    rulerGlobal = rulerLabels.includes(30) && rulerLabels.includes(50) && rulerLabels.every(n => n >= 30)
  } catch (e) {
    rulerLabels = ['ERR:' + (e && e.message)]
  }

  /* ⑤ 界面：从左栏 ⑤「图纸交付」卡片打开（画布下方的高清导出按钮已移除）。
     卡片默认收起，先像用户一样点开卡头右侧的箭头，再点入口。 */
  const openBtn = document.querySelector('[data-audit="open-delivery-build"]')
  if (!openBtn) return { ok: false, err: '找不到「图纸交付」入口' }
  const buildCard = openBtn.closest('.card--build')
  const buildBody = buildCard && buildCard.querySelector(':scope > .card__body')
  const buildFold = buildCard && buildCard.querySelector('.cardArrowBtn')
  if (buildFold && buildBody && getComputedStyle(buildBody).display === 'none') {
    buildFold.click()
    await new Promise(r => setTimeout(r, 120))
  }
  openBtn.click()
  await new Promise(r => setTimeout(r, 600))
  const panel = document.querySelector('[data-audit="delivery-panel"]')
  if (!panel) return { ok: false, err: '图纸交付面板没有打开' }

  /* 入口默认落在「拼装与完成」，切回「整张图纸」再量导出 */
  const tabs = [...panel.querySelectorAll('.deliveryTabs button')]
  tabs[0].click()
  await new Promise(r => setTimeout(r, 400))

  const dpiBtns = [...panel.querySelectorAll('[data-audit^="dpi-"]')]
  const dpiText = dpiBtns.map(b => b.textContent.replace(/\s+/g, ' ').trim())
  const planText = [...panel.querySelectorAll('.accBody .hint')].map(e => e.textContent.trim()).join(' | ')
  const formatSelect = panel.querySelector('[data-audit="delivery-format"]')
  const exportItems = formatSelect ? [...formatSelect.options].map(o => o.textContent.replace(/\s+/g, ' ').trim()) : []

  /* ⑤ 真点一次高清 PNG：状态条必须给出真实像素，而不是只关掉弹窗 */
  if (formatSelect) {
    formatSelect.value = 'png'
    formatSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
  }
  panel.querySelector('[data-audit="delivery-run"]').click()
  await new Promise(r => setTimeout(r, 1600))
  const pngStatus = panel.querySelector('[data-audit="delivery-status"]')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  const pngStatusClass = panel.querySelector('[data-audit="delivery-status"]')?.className || ''

  /* ⑥ 分板页签 + 真点一次分板 PNG ZIP */
  tabs[1].click()
  await new Promise(r => setTimeout(r, 400))
  const splitItems = [...panel.querySelectorAll('[data-audit="delivery-format"] option')]
  const fatal = panel.querySelectorAll('.checkLine.fatal').length
  const splitPlanText = [...panel.querySelectorAll('.accBody .hint')].map(e => e.textContent.trim()).join(' | ')

  /* ⑥b 分板规格可配置：下拉里只有 52 / 78 / 104 / 120 钉画线板（52×52 的图纸选哪个都是 1 块），
     所以走「自定义」输 29 验证 2×2 = 4 块与全局坐标；切回「跟随图纸」应恢复 1 块。 */
  const specSelect = panel.querySelector('[data-audit="split-spec"]')
  const specOptions = specSelect ? [...specSelect.options].map(o => o.textContent.replace(/\s+/g, ' ').trim()) : []
  let splitCustomText = ''
  let splitCustomPreview = ''
  let splitCustomCards = 0
  let splitCustomGlobalRange = false
  let splitCustomLegendUnit = false
  let customVisible = false
  if (specSelect) {
    specSelect.value = '-1'
    specSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 350))
    const custom = panel.querySelector('[data-audit="split-custom"]')
    customVisible = !!custom
    if (custom) {
      custom.value = '29'
      custom.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      splitCustomText = [...panel.querySelectorAll('.splitSpecRow .hint')].map(e => e.textContent.trim()).join(' | ')
      const splitPreview = panel.querySelector('[data-audit="split-preview"]')
      splitCustomPreview = splitPreview?.textContent?.replace(/\s+/g, ' ').trim() || ''
      splitCustomCards = splitPreview ? splitPreview.querySelectorAll('.boardCard').length : 0
      /* 每块板的卡头必须写全局列 / 行范围，且不能出现「局部 1–…」这种重新起算的坐标 */
      splitCustomGlobalRange = !!splitPreview &&
        /全图 1–29 列 · 1–29 行/.test(splitCustomPreview) &&
        /全图 30–52 列 · 1–29 行/.test(splitCustomPreview) &&
        !/局部/.test(splitCustomPreview)
      splitCustomLegendUnit = /× \d+ 颗/.test(splitCustomPreview)
    }

    specSelect.value = '0'
    specSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
  }

  const splitFormat = panel.querySelector('[data-audit="delivery-format"]')
  if (splitFormat) {
    splitFormat.value = 'split-png'
    splitFormat.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
  }
  panel.querySelector('[data-audit="delivery-run"]').click()
  await new Promise(r => setTimeout(r, 2200))
  const zipStatus = panel.querySelector('[data-audit="delivery-status"]')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  const zipStatusClass = panel.querySelector('[data-audit="delivery-status"]')?.className || ''

  /* ⑦ 拼装页签 */
  tabs[2].click()
  await new Promise(r => setTimeout(r, 300))
  const buildBox = panel.querySelector('.buildBox')
  const buildText = buildBox ? buildBox.textContent.replace(/\s+/g, ' ').trim() : ''
  const buildActions = panel.querySelectorAll('.buildActions button').length

  return {
    ok: full.ok && full.cell === expectCell && full.dpi >= 295 && full.dpi <= 305 &&
      split.ok && split.pages === 1 && pdf.ok &&
      bigFull.capped && bigFull.width <= 4096 && bigFull.height <= 4096 &&
      bigSplit.width <= 4096 && bigSplit.height <= 4096 &&
      zip.size > 100 && rd32(zipHead, 0) === 0x04034B50 && rd32(zipTail, 0) === 0x06054B50 &&
      printHtml.includes('全图') && printHtml.includes('DPI') && !printHtml.includes('本板局部') && rulerGlobal && pdfBeadsActual && pdfLegendUnit &&
      csvHead.includes('品牌/系列') && /MARD|COCO|漫漫|盼盼|咪小窝/.test(csvRow) &&
      dpiBtns.length === 3 && exportItems.length >= 8 &&
      splitItems.length === 3 && fatal === 0 &&
      specOptions.length >= 6 && specOptions.some(t => t.includes('52')) && !specOptions.some(t => /29/.test(t)) &&
      customVisible && /共 4 块/.test(splitCustomText) && splitCustomCards === 4 &&
      splitCustomGlobalRange && splitCustomLegendUnit &&
      /导出 \d+×\d+ 像素/.test(pngStatus) && /success/.test(pngStatusClass) &&
      /已打包 1 张 PNG/.test(zipStatus) && /success/.test(zipStatusClass) &&
      !!buildBox && buildActions >= 2,
    checks: {
      请求300实际DPI: full.dpi,
      每格像素: full.cell,
      期望每格像素: expectCell,
      整图尺寸: `${full.width}×${full.height}`,
      整图capped: full.capped,
      分板尺寸: `${split.width}×${split.height}`,
      分板页数: split.pages,
      大画布整图: `${bigFull.width}×${bigFull.height} · ${bigFull.dpi} DPI · capped=${bigFull.capped}`,
      大画布分板: `${bigSplit.width}×${bigSplit.height} · ${bigSplit.dpi} DPI · capped=${bigSplit.capped}`,
      ZIP字节: zip.size,
      ZIP头: rd32(zipHead, 0).toString(16),
      ZIP尾: rd32(zipTail, 0).toString(16),
      PDF不含局部坐标: !printHtml.includes('本板局部'),
      单板标尺全局列号: rulerGlobal,
      单板标尺列号样本: rulerLabels.slice(0, 12),
      PDF每板豆数是实放数: pdfBeadsActual,
      PDF图例带颗: pdfLegendUnit,
      PDF含全图坐标: printHtml.includes('全图'),
      PDF含DPI: printHtml.includes('DPI'),
      CSV表头: csvHead,
      CSV首行: csvRow.slice(0, 80),
      DPI按钮: dpiText,
      整图计划文案: planText,
      整图导出项: exportItems,
      分板计划文案: splitPlanText,
      分板导出项: splitItems.length,
      分板fatal: fatal,
      分板规格选项: specOptions,
      自定义分板: splitCustomText,
      自定义分板预览: splitCustomPreview,
      自定义分板板数: splitCustomCards,
      分板预览全局坐标: splitCustomGlobalRange,
      分板预览图例带颗: splitCustomLegendUnit,
      自定义输入: customVisible,
      PNG导出状态: pngStatus,
      PNG状态类: pngStatusClass,
      ZIP导出状态: zipStatus,
      ZIP状态类: zipStatusClass,
      拼装文案: buildText,
      拼装按钮: buildActions
    }
  }
})()
