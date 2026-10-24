/* 素材库改版自检：真实点击、搜索、筛选、收藏、预览、加载更多、一键使用。
   用法：node scripts/audit.cjs --setup-file scripts/audit-library-setup.js \
         --eval-file scripts/audit-library.js --page library */
(async () => {
  let out = { ok: true, steps: [], width: innerWidth }
  try {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 8000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      if (fn()) return true
      await sleep(60)
    }
    return false
  }
  const q = (s, root = document) => root.querySelector(s)
  const qa = (s, root = document) => [...root.querySelectorAll(s)]
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0
  const click = el => el && el.click()
  const byText = (sel, text) => qa(sel).find(el => txt(el) === text) || null
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const setSelect = (el, v) => {
    el.value = v
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const mobile = innerWidth <= 780
  const searchEl = () => (mobile ? q('.libMobileSearch input') : q('.libSearch input'))
  const step = (name, pass, detail = '') => {
    out.steps.push({ name, pass: !!pass, detail })
    if (!pass) out.ok = false
  }
  const cards = () => qa('.mCard')
  const cardNames = () => cards().map(c => txt(q('.mCard__name', c)))
  const cardCount = () => cards().length
  const activeCat = () => txt(q('.catScroll .catTab.on'))
  const gridCols = () => getComputedStyle(q('.materialGrid')).gridTemplateColumns.split(' ').filter(Boolean).length

  /* ---------- 结构 ---------- */
  step('顶栏 Logo', !!q('.brand__logo'))
  step('顶栏 slogan', txt(q('.brand__slogan')) === '所爱皆可拼，万物皆可造', txt(q('.brand__slogan')))
  step('顶栏上传入口', !!q('.libUpload'))
  step('顶栏账号入口', !!q('.accountBtn'))
  step('搜索只有一个入口', mobile ? shown(q('.libMobileSearch')) && !shown(q('.libSearch')) : shown(q('.libSearch')) && !shown(q('.libMobileSearch')))
  step('左侧导航', mobile
    ? !shown(q('[data-audit="desktop-sidebar"]')) && shown(q('.tabbar'))
    : shown(q('[data-audit="desktop-sidebar"]')) && qa('[data-audit="desktop-sidebar"] .side__item').length === 4)
  const bannerImg = q('.libBanner img')
  step('Banner 用整张切片', !!bannerImg && bannerImg.naturalWidth === 1287 && bannerImg.naturalHeight === 222,
    bannerImg ? `${bannerImg.naturalWidth}x${bannerImg.naturalHeight}` : 'missing')
  step('Banner 不拉伸', (() => {
    if (!bannerImg) return false
    const r = bannerImg.getBoundingClientRect()
    return r.height > 0 && Math.abs(r.width / r.height - 1287 / 222) < 0.03
  })())
  step('Banner 文案', (bannerImg?.alt || '').includes('所爱皆可拼，万物皆可造')
    && (bannerImg?.alt || '').includes('海量免费拼豆素材'))
  step('Banner 不是操作入口', q('.libBanner') && q('.libBanner').querySelectorAll('button,a').length === 0)
  step('分类单行', qa('.catScroll .catTab').length === 9, `tabs=${qa('.catScroll .catTab').length}`)
  step('没有生活美学空分类', !txt(q('.catScroll')).includes('生活美学'))
  step('默认全部高亮', activeCat() === '全部', activeCat())
  step('初始卡片数量', cardCount() === 18, `count=${cardCount()}`)
  step('网格列数', gridCols() === (innerWidth >= 1400 ? 6 : innerWidth >= 1180 ? 5 : innerWidth >= 900 ? 4 : innerWidth >= 781 ? 3 : 2), `cols=${gridCols()}`)
  step('无横向溢出', document.documentElement.scrollWidth <= innerWidth + 2, `${document.documentElement.scrollWidth}/${innerWidth}`)

  const bodyText = document.body.innerText
  const banned = ['追星', '应援', '会员专属', 'VIP', '卡密', '购买', '价格', '解锁', 'PRO']
  const hits = banned.filter(w => bodyText.includes(w))
  step('无付费 / 追星残留', hits.length === 0, hits.join(','))

  /* ---------- 分类 ---------- */
  const petTab = () => byText('.catScroll .catTab', '宠物头像')
  click(petTab())
  await sleep(350)
  step('分类点击高亮', activeCat() === '宠物头像', activeCat())
  step('分类写入地址栏', location.hash.includes('col=petavatar'), location.hash)
  step('分类有结果', cardCount() > 0, `count=${cardCount()}`)
  step('分类重置分页', !q('.libMore') || txt(q('.libMore .btn')).includes('还有'), txt(q('.libMore .btn')))

  click(byText('.catScroll .catTab', '全部'))
  await sleep(350)
  step('回到全部', activeCat() === '全部' && cardCount() === 18, `${activeCat()} ${cardCount()}`)

  /* 组合筛选：分类 + 搜索 + 难度同时生效 */
  if (!mobile) {
    click(petTab())
    await sleep(300)
    setInput(searchEl(), '猫')
    await sleep(400)
    setSelect(q('select[aria-label="按难度筛选"]'), 'easy')
    await sleep(650)
    const combo = cardNames()
    step('分类+搜索+难度组合', combo.length === 3 && combo.every(n => n.includes('猫')), combo.join(' / '))
    setInput(searchEl(), '')
    setSelect(q('select[aria-label="按难度筛选"]'), 'all')
    click(byText('.catScroll .catTab', '全部'))
    await sleep(600)
    step('组合筛选完整重置', cardCount() === 18 && activeCat() === '全部', `${cardCount()} ${activeCat()}`)
  }

  /* ---------- 搜索 ---------- */
  setInput(searchEl(), '猫')
  await sleep(500)
  const catNames = cardNames()
  step('搜索去抖后生效', catNames.length > 0 && catNames.every(n => n.includes('猫')), catNames.slice(0, 5).join(' / '))
  step('搜索写入地址栏', decodeURIComponent(location.hash).includes('q=猫'), decodeURIComponent(location.hash))
  step('搜索提示可清除', !!q('.searchChip'))
  click(q('.searchChip button'))
  await sleep(500)
  step('清空搜索恢复分类', cardCount() === 18 && !decodeURIComponent(location.hash).includes('q='), `count=${cardCount()}`)

  /* 连续输入只保留最后一次结果（去抖取消旧定时器） */
  setInput(searchEl(), '猫')
  setInput(searchEl(), '蛋糕')
  await sleep(500)
  const raceNames = cardNames()
  step('连续输入不被旧结果覆盖', raceNames.length > 0 && raceNames.every(n => n.includes('蛋糕')), raceNames.join(' / '))
  step('连续输入地址栏为最后一次', decodeURIComponent(location.hash).includes('q=蛋糕'), decodeURIComponent(location.hash))
  click(q('.searchChip button'))
  await sleep(500)

  /* ---------- 排序 / 筛选 ---------- */
  click(byText('.sortTabs button', '最热'))
  await sleep(350)
  step('最热排序', txt(q('.mCard__name')) === '中国龙', txt(q('.mCard__name')))
  step('最热写入地址栏', location.hash.includes('sort=hot'), location.hash)
  click(byText('.sortTabs button', '最新'))
  await sleep(350)

  if (mobile) {
    click(q('.filterToggle'))
    await sleep(200)
    step('手机筛选面板展开', shown(q('.mobilePanel')))
    click(byText('.mobilePanel .mChips button', '进阶'))
    await sleep(350)
  } else {
    setSelect(q('select[aria-label="按难度筛选"]'), 'advanced')
    await sleep(350)
  }
  step('难度筛选结果', cardCount() === 1 && txt(q('.mCard__name')) === '中国龙', `${cardCount()} ${txt(q('.mCard__name'))}`)
  step('难度写入地址栏', location.hash.includes('diff=advanced'), location.hash)

  if (mobile) click(q('.resetBtn'))
  else {
    setSelect(q('select[aria-label="按难度筛选"]'), 'all')
    setSelect(q('select[aria-label="按尺寸筛选"]'), '58')
  }
  await sleep(350)
  if (!mobile) {
    step('尺寸筛选结果', cardCount() === 1 && txt(q('.mCard__name')) === '中国龙', `${cardCount()} ${txt(q('.mCard__name'))}`)
    setSelect(q('select[aria-label="按尺寸筛选"]'), 'all')
    await sleep(350)
  } else {
    step('重置筛选恢复', cardCount() === 18, `count=${cardCount()}`)
  }

  /* ---------- 收藏 / 预览 ---------- */
  const firstCard = cards()[0]
  const firstName = txt(q('.mCard__name', firstCard))
  click(q('.mCard__fav', firstCard))
  await sleep(250)
  step('收藏图标同步', q('.mCard__fav', cards()[0]).classList.contains('on'))
  step('收藏写入 localStorage', (localStorage.getItem('douzao-asset-favorites') || '').length > 2)
  click(qa('.sortTabs button').find(el => txt(el).includes('我收藏的')))
  await sleep(350)
  step('收藏筛选', cardCount() === 1 && txt(q('.mCard__name')) === firstName, `${cardCount()} ${txt(q('.mCard__name'))}`)
  step('收藏筛选写入地址栏', location.hash.includes('sort=fav'), location.hash)

  window.scrollTo(0, 420)
  await sleep(120)
  const scrollBefore = Math.round(window.scrollY)
  click(q('.mCard__media', cards()[0]))
  await sleep(350)
  step('预览弹窗打开', !!q('.modal.show .dialog'))
  step('预览标题正确', txt(q('.modal.show .dialog__head h2')) === firstName, txt(q('.modal.show .dialog__head h2')))
  step('预览收藏态同步', txt(byText('.preview__actions .btn', '已收藏')) === '已收藏')
  step('预览有一键使用', !!byText('.preview__actions .btn', '一键使用'))
  step('弹窗锁住页面滚动', document.body.style.overflow === 'hidden', document.body.style.overflow)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(300)
  step('Escape 关闭预览', !q('.modal.show'))
  step('关闭后筛选保持', location.hash.includes('sort=fav') && cardCount() === 1, location.hash)
  step('关闭后滚动位置保持', Math.abs(Math.round(window.scrollY) - scrollBefore) <= 2, `${scrollBefore}/${Math.round(window.scrollY)}`)

  click(q('.mCard__media', cards()[0]))
  await sleep(300)
  click(q('.modal.show .dialog__head .iconbtn'))
  await sleep(250)
  step('关闭按钮关闭预览', !q('.modal.show'))

  click(q('.mCard__media', cards()[0]))
  await sleep(300)
  q('.modal.show')?.click()
  await sleep(250)
  step('点遮罩关闭预览', !q('.modal.show'))

  click(q('.mCard__fav', cards()[0]))
  await sleep(300)
  step('取消收藏后空状态', !!q('.libEmpty') && txt(q('.libEmpty strong')).includes('还没有收藏'), txt(q('.libEmpty strong')))
  click(q('.libEmpty .btn'))
  await sleep(400)
  step('空状态可回到全部', cardCount() === 18 && !location.hash.includes('sort=fav'), `count=${cardCount()}`)

  /* ---------- 空结果 ---------- */
  const input2 = mobile ? q('.libMobileSearch input') : q('.libSearch input')
  setInput(input2, 'zzzzz')
  await sleep(500)
  step('空搜索结果状态', !!q('.libEmpty') && txt(q('.libEmpty strong')).includes('zzzzz'), txt(q('.libEmpty strong')))
  click(q('.libEmpty .btn'))
  await sleep(500)
  step('空结果可清除', cardCount() === 18, `count=${cardCount()}`)

  /* ---------- 加载更多 ---------- */
  step('加载更多初始', !!q('.libMore') && txt(q('.libMore .btn')).includes('还有 33 个'), txt(q('.libMore .btn')))
  click(q('.libMore .btn'))
  await sleep(300)
  step('加载更多追加', cardCount() === 36, `count=${cardCount()}`)
  click(q('.libMore .btn'))
  await sleep(300)
  const names = cardNames()
  step('加载完 51 个', cardCount() === 51 && !q('.libMore'), `count=${cardCount()}`)
  step('没有重复卡片', new Set(names).size === names.length, `${new Set(names).size}/${names.length}`)

  /* ---------- 一键使用（只在桌面和手机各跑一次） ---------- */
  if (innerWidth === 1440 || mobile) {
    click(q('.mCard__media', cards()[0]))
    await sleep(350)
    const useBtn = byText('.preview__actions .btn', '一键使用')
    click(useBtn)
    out.useHashOk = await waitFor(() => location.hash.startsWith('#/editor'), 10000)
    const d = window.__douzao
    if (d) {
      const S = await d.studio()
      out.useGenerated = await waitFor(() => S.pattern.value && S.pattern.value.width > 0, 20000)
      out.pattern = S.pattern.value ? `${S.pattern.value.width}×${S.pattern.value.height}` : ''
    }
    step('一键使用进入工作台', out.useHashOk, location.hash)
    step('一键使用生成图纸', !!out.useGenerated, out.pattern || '')
  }

  return out
} catch (e) {
  out.ok = false
  out.err = e && e.message
  out.stack = e && e.stack
  return out
}
})()
