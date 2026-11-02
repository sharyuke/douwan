/* 自检探针：左栏「画布与成品尺寸」的滑杆要能用滚轮改尺寸（2026-10-28 用户反馈）。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
           --eval-file scripts/audit-range-wheel.js --page editorProject

   病根：Chrome / Edge 默认不响应滑块上的滚轮（Firefox 会），电脑端在滑杆上
   滚滚轮数值纹丝不动，看着像功能坏了。这里补上滚轮，断言落在真实状态上：
     · 向上滚变大、向下滚变小，且**成品区域真的重算**（options.canvasW/H 跟着变）；
     · 按住 Shift 走最小步长（一格一格抠）；
     · 滚轮被吃掉：事件 defaultPrevented 为真，页面不会跟着一起滚；
     · 到上下限就不再动，也不报错；
     · 关闭等比后宽高各自可调，滚轮只动自己那条。

   真实滚轮输入（CDP mouseWheel）另有一份：scripts/audit-wheel-real.cjs。
*/
(async () => {
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()
    const waitFor = async (fn, ms = 20000, step = 50) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        try { if (fn()) return true } catch { /* 页面还在更新 */ }
        await sleep(step)
      }
      return false
    }
    const fail = msg => { throw new Error(msg) }

    const card = document.querySelector('[data-size-wide]')
    if (!card) return { ok: true, skipped: '手机端没有宽屏面板（滚轮只在电脑上用）' }

    const d = window.__douzao
    if (!d) fail('调试桥未就绪')
    const S = await d.studio()

    const head = card.querySelector('[data-size-row]')
    const body = card.querySelector('[data-size-panel]')
    if (!head || !body) fail('画布与成品尺寸卡片缺少标题 / 面板')
    if (!body.offsetParent) { head.click(); await sleep(200) }
    if (!body.offsetParent) fail('点标题行后面板没有展开')

    const range = card.querySelector('[data-size-range]')
    if (!range) fail('找不到成品尺寸滑杆')

    const out = { ok: true, skipped: null }

    /* 没有图时滑杆是禁用的：滚轮不应该有反应，也不该报错 */
    if (!S.pattern.value || range.disabled) {
      const ev = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })
      range.dispatchEvent(ev)
      out.empty = { disabled: range.disabled, prevented: ev.defaultPrevented }
      return out
    }

    const dims = () => ({ w: S.options.canvasW, h: S.options.canvasH })
    /* 滚轮：向上变大、向下变小。shiftKey 走最小步长。 */
    const wheel = (el, deltaY, shiftKey = false) => {
      const ev = new WheelEvent('wheel', { deltaY, shiftKey, bubbles: true, cancelable: true })
      el.dispatchEvent(ev)
      return ev.defaultPrevented
    }

    /* ---------- 先把滑杆停到量程中间：素材默认占满整块板（在上限），没有余量可滚 ---------- */
    {
      const min = Number(range.min)
      const max = Number(range.max)
      const mid = Math.round((min + max) / 2)
      range.value = String(mid)
      range.dispatchEvent(new Event('input', { bubbles: true }))
      range.dispatchEvent(new Event('change', { bubbles: true }))
      const ok = await waitFor(() => dims().w === mid && dims().h === mid)
      if (!ok) fail(`滑杆停到中间没有生效：成品区域 ${dims().w}×${dims().h}（期望 ${mid}×${mid}）`)
      out.parked = { min, max, mid, dims: dims() }
    }

    /* ---------- 向上滚：变大 ---------- */
    const start = dims()
    const v0 = Number(range.value)
    const preventedUp = wheel(range, -120)
    await sleep(600)
    const up = dims()
    const v1 = Number(range.value)
    out.up = { v0, v1, prevented: preventedUp, before: start, after: up }
    if (v1 <= v0) fail(`滚轮向上没有变大：滑杆 ${v0} → ${v1}`)
    if (up.w === start.w && up.h === start.h) fail(`滚轮向上后成品区域没有重算：${start.w}×${start.h} → ${up.w}×${up.h}`)
    if (!preventedUp) fail('滚轮没有被吃掉（页面会跟着一起滚）')

    /* ---------- 向下滚：变小 ---------- */
    const preventedDown = wheel(range, 120)
    await sleep(600)
    const down = dims()
    const v2 = Number(range.value)
    out.down = { v1, v2, prevented: preventedDown, after: down }
    if (v2 >= v1) fail(`滚轮向下没有变小：滑杆 ${v1} → ${v2}`)
    if (down.w === up.w && down.h === up.h) fail(`滚轮向下后成品区域没有重算：${up.w}×${up.h} → ${down.w}×${down.h}`)
    if (!preventedDown) fail('滚轮没有被吃掉（页面会跟着一起滚）')

    /* ---------- Shift：最小步长（一格一格抠） ---------- */
    {
      const coarse = Math.max(Number(range.step) || 1, Math.round((Number(range.max) - Number(range.min)) / 20))
      const before = Number(range.value)
      wheel(range, -120, true)
      await sleep(500)
      const after = Number(range.value)
      out.fine = { before, after, coarse, step: after - before }
      if (after !== before + 1) fail(`Shift + 滚轮应走最小步长 1 格：${before} → ${after}`)
    }

    /* ---------- 上下限：不再动，也不报错 ---------- */
    {
      range.value = range.max
      range.dispatchEvent(new Event('input', { bubbles: true }))
      range.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(600)
      const atMax = Number(range.value)
      wheel(range, -120)
      await sleep(400)
      const stillMax = Number(range.value)
      wheel(range, 120)
      await sleep(400)
      const backDown = Number(range.value)
      out.limits = { atMax, stillMax, backDown }
      if (stillMax !== atMax) fail(`到上限后滚轮还在动：${atMax} → ${stillMax}`)
      if (backDown >= stillMax) fail(`从上限往下滚没有变小：${stillMax} → ${backDown}`)
    }

    /* ---------- 关闭等比：宽高各自可调，滚轮只动自己那条 ---------- */
    {
      const aspect = card.querySelector('[data-size-aspect]')
      if (aspect && aspect.checked) {
        aspect.checked = false
        aspect.dispatchEvent(new Event('change', { bubbles: true }))
        await sleep(300)
      }
      const wRange = card.querySelector('[data-size-range="w"]')
      const hRange = card.querySelector('[data-size-range="h"]')
      if (!wRange || !hRange) fail('关闭等比后没有出现宽 / 高两条滑杆')
      /* 宽度滑杆先停到中间：宽高独立时宽的取值范围是底板宽度，上限处没有余量 */
      const wMin = Number(wRange.min)
      const wMax = Number(wRange.max)
      const wMid = Math.round((wMin + wMax) / 2)
      wRange.value = String(wMid)
      wRange.dispatchEvent(new Event('input', { bubbles: true }))
      wRange.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(600)
      const before = dims()
      wheel(wRange, -120)
      await sleep(600)
      const after = dims()
      out.side = { before, after, wMin, wMax, wMid }
      if (after.w === before.w) fail(`宽度滑杆滚轮没有生效：${before.w}×${before.h} → ${after.w}×${after.h}`)
      if (after.h !== before.h) fail(`滚轮动了高度：${before.w}×${before.h} → ${after.w}×${after.h}`)
    }

    out.scenarios = [
      '滚轮向上变大', '滚轮向下变小', 'Shift 走最小步长',
      '上下限不再动', '关闭等比后各自可调', '滚轮吃掉默认滚动'
    ]
    return out
  } catch (e) {
    return { ok: false, err: (e && (e.stack || e.message)) || String(e) }
  }
})()
