/* =========================================================================
   自检探针：②「画布与成品尺寸」里的三处口径注释收进「!」

   用法：
     node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
       --eval-file scripts/audit-size-tips.js --page editorProject

   口径（桌面 / 平板 / 手机同一套）：
   · 三处长注释不再直接铺在面板里（没有 .sizeField__hint / 可见的 .sizeLimit 正文）；
   · 每处只剩一颗 15px 的「!」圆钮，点开才出现小说明卡，再点 / 点别处 / Esc 收起；
   · 说明文字比原来的 11.5px 提示低两档（10.5px），不能反过来变大；
   · 说明卡不能横向溢出卡片（平板 781~1319px 左栏只有 286px，最容易撑破）。
   ========================================================================= */
(async () => {
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const waitFor = async (fn, ms = 8000, step = 40) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        try { if (fn()) return true } catch { /* 页面还在刷新 */ }
        await sleep(step)
      }
      return false
    }
    const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()
    const visible = el => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
    const fail = msg => { throw new Error(msg) }

    const d = window.__douzao
    if (!d) fail('调试桥未就绪')
    const S = await d.studio()
    if (!(await waitFor(() => !!S.pattern.value, 8000))) fail('示例作品没有载入（pattern 为空）')

    const mobile = !document.querySelector('[data-size-wide]')
    let card
    if (mobile) {
      /* 手机端这张卡在底部抽屉里：先点快捷区的「画布」把抽屉打开 */
      const quick = [...document.querySelectorAll('.quickItem')]
      const btn = quick.find(b => /画布/.test(b.textContent))
      if (!btn) fail('手机端快捷区里找不到「画布」按钮')
      btn.click()
      await sleep(420)
      const dialog = document.querySelector('.modal.show .dialog')
      if (!dialog) fail('手机端「画布与成品尺寸」抽屉没有打开')
      card = dialog.querySelector('.card--size')
      if (!card) fail('抽屉里没有画布与成品尺寸卡片')
      if (!(await waitFor(() => visible(card.querySelector('[data-size-panel]')), 3000))) {
        fail('抽屉里的尺寸面板没有展开')
      }
    } else {
      card = document.querySelector('[data-size-wide]')
      if (!card) fail('找不到宽屏「画布与成品尺寸」卡片')
      const head = card.querySelector('[data-size-row]')
      if (!visible(card.querySelector('[data-size-panel]'))) {
        head.click()
        await sleep(160)
      }
      if (!visible(card.querySelector('[data-size-panel]'))) fail('宽屏尺寸面板没有展开')
    }

    /* ---------- 长注释必须已经收起来 ---------- */
    const hints = [...card.querySelectorAll('.sizeField__hint')].filter(visible)
    if (hints.length) fail(`还有 ${hints.length} 条长提示直接铺在面板里：${text(hints[0]).slice(0, 30)}…`)
    const limitText = [...card.querySelectorAll('.sizeLimit')].filter(el => visible(el) && !el.classList.contains('sizeLimit--warn'))
    if (limitText.length) fail('「尺寸口径」正文仍然直接显示，没有收进「!」')

    const cardBox = card.getBoundingClientRect()
    const tips = {}
    const EXPECT = {
      board: /按实物选底板/,
      sharp: /豆子越多/,
      limit: /清晰度由豆子数量决定/
    }
    for (const key of ['board', 'sharp', 'limit']) {
      const btn = card.querySelector(`[data-size-tip="${key}"]`)
      if (!btn) fail(`缺少「${key}」的「!」按钮`)
      if (!visible(btn)) fail(`「${key}」的「!」按钮不可见`)
      if (btn.tagName !== 'BUTTON') fail(`「${key}」的「!」不是按钮，键盘 / 触屏点不开`)
      if (text(btn) !== '!') fail(`「${key}」的圆钮里不是感叹号：${text(btn) || '(空)'}`)
      const bs = getComputedStyle(btn)
      const btnBox = btn.getBoundingClientRect()
      if (btnBox.width > 20 || btnBox.height > 20) fail(`「${key}」的「!」太大（${Math.round(btnBox.width)}×${Math.round(btnBox.height)}）`)
      if (parseFloat(bs.fontSize) > 10.5) fail(`「${key}」的感叹号字号 ${bs.fontSize} 太大`)

      btn.click()
      await sleep(90)
      const pop = card.querySelector(`[data-size-tip="${key}"]`)?.closest('.sizeTipWrap')?.querySelector('.sizeTipPop')
      if (!pop || !visible(pop)) fail(`点「${key}」的「!」没有展开说明卡`)
      if (!EXPECT[key].test(text(pop))) fail(`「${key}」的说明文字不对：${text(pop) || '(空)'}`)
      const ps = getComputedStyle(pop)
      const fs = parseFloat(ps.fontSize)
      if (!(fs > 0 && fs <= 10.5)) fail(`「${key}」的说明字号 ${ps.fontSize}，应该 ≤ 10.5px（比原来的 11.5px 低两档）`)
      const box = pop.getBoundingClientRect()
      if (box.left < cardBox.left - 1 || box.right > cardBox.right + 1) {
        fail(`「${key}」的说明卡横向溢出卡片：卡 ${Math.round(box.left)}~${Math.round(box.right)}，卡片 ${Math.round(cardBox.left)}~${Math.round(cardBox.right)}`)
      }
      if (box.width < 160) fail(`「${key}」的说明卡太窄（${Math.round(box.width)}px），文字会挤成一条`)
      tips[key] = { fs: ps.fontSize, w: Math.round(box.width), h: Math.round(box.height), text: text(pop).slice(0, 40) }

      /* 再点一次收起 */
      btn.click()
      await sleep(90)
      if (visible(pop)) fail(`再点「${key}」的「!」说明卡没有收起`)
    }

    /* ---------- 点别处 / Esc 也要收起 ---------- */
    const sharpBtn = card.querySelector('[data-size-tip="sharp"]')
    sharpBtn.click()
    await sleep(90)
    /* 组件监听的是 pointerdown（触屏也走这条），所以这里也要发 pointerdown */
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await sleep(90)
    if (visible(card.querySelector('.sizeTipPop'))) fail('点别处后说明卡没有收起')

    sharpBtn.click()
    await sleep(90)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(90)
    if (visible(card.querySelector('.sizeTipPop'))) fail('按 Esc 后说明卡没有收起')

    /* Esc 在手机端会被抽屉自己吃掉（关掉抽屉）：重新打开，截图才看得到面板 */
    if (mobile && !document.querySelector('.modal.show')) {
      const quick = [...document.querySelectorAll('.quickItem')]
      quick.find(b => /画布/.test(b.textContent))?.click()
      await sleep(420)
      const dialog = document.querySelector('.modal.show .dialog')
      card = (dialog && dialog.querySelector('.card--size')) || card
      await sleep(120)
    }

    /* 截图用：把卡片底部滚进视野（上面的断言已经跑完，不影响结果）。
       AUDIT_SHOT_AFTER_PROBE=1 时能看到底部的「尺寸口径」那颗「!」。 */
    card.scrollIntoView({ block: 'end' })
    await sleep(120)

    return { ok: true, mobile, tips }
  } catch (e) {
    return { ok: false, err: (e && (e.stack || e.message)) || String(e) }
  }
})()
