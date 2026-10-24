/* =========================================================================
   自检探针：三端新手指引
   用法：
     node scripts/audit.cjs --eval-file scripts/audit-guide.js --page editor --widths desktop,narrow3col,mobile

   验收点（对应交付包 04_验收清单.md）：
   · 首次进入自动出现；一次只显示一个步骤（用户要求不要一次全部显示完）
   · 桌面 / 平板 3 步：功能面板 / 编辑工具 / 画布区域，之后是「指引重点」三块摘要卡
   · 手机 1/5 ~ 5/5，底部有「跳过引导 / 下一步」
   · 高亮框跟着真实元素走；气泡不超出视口、不压住底部按钮
   · 关闭后写入 localStorage，不再自动弹出；新手教程里能重新打开
   ========================================================================= */
(async () => {
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const waitFor = async (fn, ms = 5000, step = 50) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        try { if (fn()) return true } catch { /* 页面还在更新 */ }
        await sleep(step)
      }
      return false
    }
    const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()
    const fail = msg => { throw new Error(msg) }
    const visible = el => !!el && !!el.offsetParent

    const mobile = window.innerWidth <= 780
    const tablet = !mobile && window.innerWidth < 1320
    const total = mobile ? 5 : 3
    const root = () => document.querySelector('[data-guide]')
    const tip = () => document.querySelector('[data-guide-tip]')
    const stepNo = () => Number(tip()?.dataset.guideStep || 0)
    const nextBtn = () => document.querySelector('[data-guide-next]')
    const skipBtn = () => document.querySelector('[data-guide-skip]')

    const inViewport = el => {
      const r = el.getBoundingClientRect()
      return r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1
    }
    const intersects = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)

    /* 新手教程 → 看一遍工作台指引（有存档时自检预置会先关掉自动弹出） */
    async function openViaTutorial() {
      if (mobile) {
        const more = [...document.querySelectorAll('.toolItem')].find(b => /更多/.test(text(b)))
        if (!more) fail('手机端找不到工具行的「更多」')
        more.click()
        await sleep(320)
        const tut = [...document.querySelectorAll('.moreItem')].find(b => /新手教程/.test(text(b)))
        if (!tut) fail('「更多编辑工具」里找不到新手教程')
        tut.click()
      } else {
        const entry = [...document.querySelectorAll('button')].find(b => visible(b) && /新手教程/.test(text(b)))
        if (!entry) fail('找不到新手教程入口')
        entry.click()
      }
      if (!(await waitFor(() => document.querySelector('[data-audit="tutorial-dialog"]'), 5000))) {
        fail('新手教程没有打开')
      }
      const replay = document.querySelector('[data-guide-replay]')
      if (!replay) fail('新手教程里没有「看一遍工作台指引」')
      replay.click()
      if (!(await waitFor(() => !!root(), 5000))) fail('从教程里没有重新打开指引')
    }

    /* ---------- 首次进入：自动出现，且只显示第一步 ---------- */
    const autoOpened = await waitFor(() => !!root(), 2500)
    if (!autoOpened) {
      await openViaTutorial()
      /* 教程弹窗退场 + 首帧高亮定位 */
      await sleep(700)
    }
    if (!root()) fail('首次进入没有自动出现新手指引')
    if (!tip()) fail('指引没有步骤气泡')
    if (stepNo() !== 1) fail(`第一步编号不对：${stepNo()}`)
    if (document.querySelectorAll('[data-guide-tip]').length !== 1) fail('一次出现了多个步骤气泡')
    if (!inViewport(tip())) fail('气泡超出视口')
    if (!(await waitFor(() => !!document.querySelector('.guide__hole'), 4000))) fail('没有高亮区域')
    if (mobile) {
      if (!document.querySelector('[data-guide-bar]')) fail('手机端没有底部「跳过引导 / 下一步」')
      if (!/跳过引导/.test(text(document.querySelector('[data-guide-bar]')))) fail('底部没有「跳过引导」')
      if (!/下一步/.test(text(nextBtn()))) fail('底部没有「下一步」')
    } else {
      if (!skipBtn()) fail('桌面 / 平板没有跳过按钮')
      if (!new RegExp(tablet ? '关闭指引' : '跳过指引').test(text(skipBtn()))) fail(`跳过按钮文案不对：${text(skipBtn())}`)
    }

    /* ---------- 高亮框要罩住当前这一步的真实元素 ---------- */
    const targets = mobile
      ? ['.emptyActions', '.modal.show .card--size', '.quickRow + .mobileToolbar', '.stageTools', '.modal.show .dialog']
      : ['.card--create', '.canvasCard__foot', '.stage']
    /* 空画布时手机上还没有右侧浮控，指引会退回高亮整块画布；
       有图纸时第 1 步的上传入口是快捷区的「换图」 */
    const quickItem = label => [...document.querySelectorAll('.quickItem')].find(b => new RegExp(label).test(text(b)))
    const targetFor = i => {
      if (i === 1) {
        if (mobile) return [document.querySelector('.emptyActions') || quickItem('换图') || document.querySelector('.quickRow')]
        return [document.querySelector('.card--create')]
      }
      if (mobile && i === 2) return [document.querySelector('.modal.show .card--size')]
      /* 第 3 步要同时框出上方的快捷区和下方的工具行 */
      if (mobile && i === 3) return [document.querySelector('.quickRow'), document.querySelector('.mobileToolbar')]
      if (mobile && i === 4) return [document.querySelector('.stageTools') || document.querySelector('.stage')]
      if (mobile && i === 5) return [document.querySelector('.modal.show .dialog')]
      return [document.querySelector(targets[i - 1])]
    }
    const holes = () => [...document.querySelectorAll('.guide__hole')].map(h => h.getBoundingClientRect())
    const covered = list => {
      const hs = holes()
      return list.every(t => t && hs.some(h => intersects(h, t.getBoundingClientRect())))
    }
    const first = targetFor(1)
    if (!first.every(Boolean)) fail('第 1 步找不到要高亮的元素')
    if (!covered(first)) {
      fail(`第 1 步高亮框没有罩住 ${targets[0]}`)
    }

    /* ---------- 逐下一步：编号递增，始终只有一个气泡 ---------- */
    for (let i = 2; i <= total; i++) {
      if (!nextBtn()) fail(`第 ${i} 步找不到「下一步」`)
      nextBtn().click()
      /* 第 2 步要先打开快捷区的「画布」抽屉，等目标和高亮框都就位再断言 */
      const ok = await waitFor(() => {
        if (stepNo() !== i) return false
        return covered(targetFor(i))
      }, 6000)
      if (!ok) { const list = targetFor(i); const hs = holes(); fail(`点下一步后没有切到第 ${i} 步（当前 ${stepNo()}；目标 ${list.map(Boolean)}；洞 ${JSON.stringify(hs)}；弹窗 ${!!document.querySelector('.modal.show')}）`) }
      await sleep(200)
      if (document.querySelectorAll('[data-guide-tip]').length !== 1) fail(`第 ${i} 步出现了多个气泡`)
      if (!inViewport(tip())) fail(`第 ${i} 步气泡超出视口`)
      const list = targetFor(i)
      if (!list.every(Boolean)) fail(`第 ${i} 步目标元素不存在：${targets[i - 1]}`)
      if (!covered(list)) {
        fail(`第 ${i} 步高亮框没有罩住 ${targets[i - 1]}`)
      }
      if (mobile) {
        const tipR = tip().getBoundingClientRect()
        const barR = document.querySelector('[data-guide-bar]').getBoundingClientRect()
        if (tipR.bottom > barR.top + 1) fail(`第 ${i} 步气泡压住了底部按钮`)
        /* 第 3 步的两块高亮缺一不可 */
        if (i === 3 && holes().length < 2) fail(`第 3 步没有同时框出快捷区和工具行：${holes().length} 块`)
        /* 第 5 步固定条要抬到抽屉上方，不能压住「保存作品」 */
        if (i === 5) {
          const save = [...document.querySelectorAll('.modal.show .moreItem')].find(b => /保存作品/.test(text(b)))
          if (save && intersects(barR, save.getBoundingClientRect())) fail('第 5 步底部固定条压住了「保存作品」')
        }
        /* 第 4 步要讲清「拖动只平移视野，不会修改格子」——电脑端画布下方已不再显示这句 */
        if (i === 4) {
          const extra = text(tip().querySelector('.guide__extra'))
          if (!/只平移视野，不会修改任何格子/.test(extra)) fail(`第 4 步缺少移动画布说明：${extra}`)
        }
      }
    }

    /* ---------- 最后一步：桌面 / 平板进摘要；手机直接完成 ---------- */
    if (mobile) {
      if (!/完成/.test(text(nextBtn()))) fail('手机最后一步按钮不是「完成」')
      nextBtn().click()
      if (!(await waitFor(() => !root(), 3000))) fail('手机点完成后指引没有关闭')
    } else {
      nextBtn().click()
      const summary = await waitFor(() => document.querySelector('[data-guide-summary]'), 4000)
      if (!summary) fail('桌面 / 平板没有出现「指引重点」摘要')
      const cards = document.querySelectorAll('.guide__summaryGrid article')
      if (cards.length !== 3) fail(`摘要卡不是 3 块：${cards.length}`)
      const head = text(document.querySelector('.guide__summaryTitle b'))
      if (head !== (tablet ? '平板端指引重点' : '桌面端指引重点')) fail(`摘要标题不对：${head}`)
      if (!/功能面板/.test(text(cards[0])) || !/编辑工具/.test(text(cards[1])) || !/画布区域/.test(text(cards[2]))) {
        fail('三块摘要卡标题不对')
      }
      const finish = document.querySelector('[data-guide-finish]')
      if (!finish) fail('摘要没有「开始创作」')
      finish.click()
      if (!(await waitFor(() => !root(), 3000))) fail('点「开始创作」后指引没有关闭')
    }

    if (localStorage.getItem('douwan.guide.v1') !== '1') fail('关闭后没有记住「已看过」')

    /* ---------- 重新打开：新手教程 → 看一遍工作台指引 ---------- */
    await openViaTutorial()

    /* ---------- 跳过 / 关闭：立即退出 ---------- */
    const skip = skipBtn()
    if (!skip) fail('重新打开后找不到跳过按钮')
    skip.click()
    if (!(await waitFor(() => !root(), 2500))) fail('点跳过后指引没有立即退出')

    /* 留给下一个视口：下一次页面加载应当再次自动出现 */
    localStorage.removeItem('douwan.guide.v1')

    return {
      ok: true,
      vw: window.innerWidth,
      mode: mobile ? 'mobile' : tablet ? 'tablet' : 'desktop',
      steps: total,
      autoOpened,
      summary: mobile ? 0 : 3,
      replay: true
    }
  } catch (e) {
    return { ok: false, err: (e && (e.stack || e.message)) || String(e) }
  }
})()
