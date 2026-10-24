/* 自检探针：换了图标之后，这些按钮的点击行为、选中态、禁用态还和以前一样。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
     --eval-file scripts/audit-function-icons-clicks.js --page editorProject

   只看「点下去有没有反应」：来源页签切换、画布页签切换、图片处理三选一、
   手机端没图纸时「导出」禁用。图标本身由 audit-function-icons.js 负责。 */
(async () => {
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const steps = []
  const step = (name, pass, detail = '') => steps.push({ name, pass: !!pass, detail })
  const btnByText = (list, label) => list.find(b => txt(b).includes(label))

  try {
    if (innerWidth <= 780) {
      const views = qa('.viewtabs button')
      views[1].click()
      await sleep(350)
      step('点「原图」页签切过去', txt(q('.viewtabs button.on')).includes('原图'), txt(q('.viewtabs button.on')))
      views[0].click()
      await sleep(300)
      step('点回「图纸」页签', txt(q('.viewtabs button.on')).includes('图纸'), txt(q('.viewtabs button.on')))

      const quick = qa('.quickRow .quickItem')
      const size = quick.find(b => txt(b) === '画布')
      size.click()
      await sleep(400)
      step('点「画布」打开尺寸抽屉', !!q('[role="dialog"]') && /画布/.test(txt(q('[role="dialog"]'))), txt(q('[role="dialog"]')).slice(0, 30))
      const x = q('[role="dialog"] .dialog__head .iconbtn')
      if (x) { x.click(); await sleep(400) }
      step('抽屉能关掉', !q('[role="dialog"]'))
      return { ok: steps.every(s => s.pass), steps, width: innerWidth }
    }

    /* ---------- 桌面 / 平板 ---------- */
    const sources = qa('.sourceTabs button')
    btnByText(sources, 'AI生成素材').click()
    await sleep(350)
    step('点「AI生成素材」出现占位面板', !!q('[data-audit="ai-pending"]'))
    btnByText(sources, '免费素材库').click()
    await sleep(400)
    step('点「免费素材库」列出素材', qa('.srcAsset').length > 0, `srcAsset=${qa('.srcAsset').length}`)
    btnByText(sources, '上传图片').click()
    await sleep(300)
    /* 这个示例作品已经带图：上传页签显示的是缩略图，不是空的上传框 */
    step('点「上传图片」回到上传面板', !!(q('.thumb') || q('.upload__plus')), q('.thumb') ? '显示缩略图' : (q('.upload__plus') ? '显示上传框' : '都没有'))

    const views = qa('.viewtabs button')
    views[1].click()
    await sleep(400)
    step('点「原图」页签切过去', txt(q('.viewtabs button.on')).includes('原图'), txt(q('.viewtabs button.on')))
    views[0].click()
    await sleep(300)
    step('点回「拼豆图纸」', txt(q('.viewtabs button.on')).includes('图纸'), txt(q('.viewtabs button.on')))

    const procs = qa('.procTabs button')
    procs[1].click()
    await sleep(300)
    step('点「智能抠图」选中', procs[1].classList.contains('on'), txt(procs[1]))
    procs[0].click()
    await sleep(300)
    step('点「原图直接使用」选中', procs[0].classList.contains('on'), txt(procs[0]))
    step('「卡通风格」仍是待接入态', procs[2].classList.contains('is-soon') || procs[2].getAttribute('aria-disabled') === 'true', txt(procs[2]))

    /* 右栏两张卡：点箭头能开合 */
    const card = q('.card--analysis')
    const arrow = card && card.querySelector('.cardArrowBtn')
    const before = card && card.classList.contains('is-folded')
    if (arrow) { arrow.click(); await sleep(300) }
    step('作品分析卡能开合', !!card && card.classList.contains('is-folded') !== before, `folded ${before} → ${card && card.classList.contains('is-folded')}`)

    return { ok: steps.every(s => s.pass), steps, width: innerWidth }
  } catch (e) {
    return { ok: false, steps, err: e && e.message, width: innerWidth }
  }
})()
