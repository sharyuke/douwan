/* 素材库分类 / 全部分类面板 / 筛选栏自检（真实点击 + 键盘 + 地址栏）
   用法：node scripts/audit.cjs --url http://127.0.0.1:4399 \
         --setup-file scripts/audit-library-setup.js \
         --eval-file scripts/audit-library.js --page library
   需要先启动 scripts/mock-api-server.cjs（自带 9 个分类 + 26 个素材）。 */
(async () => {
  let out = { ok: true, steps: [], width: innerWidth }
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const q = (s, root = document) => root.querySelector(s)
    const qa = (s, root = document) => [...root.querySelectorAll(s)]
    const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
    const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0
    const click = el => el && el.click()
    const hash = () => decodeURIComponent(location.hash)
    const setInput = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const key = (el, k) => el && el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    const step = (name, pass, detail = '') => {
      out.steps.push({ name, pass: !!pass, detail })
      if (!pass) out.ok = false
    }

    const mobile = innerWidth <= 780
    const tablet = innerWidth > 780 && innerWidth < 1200
    const wide = innerWidth >= 1200
    const cards = () => qa('.mCard')
    const cardNames = () => cards().map(c => txt(q('.mCard__name', c)))
    const cardByName = name => cards().find(c => txt(q('.mCard__name', c)) === name)
    const navBtn = k => q(`[data-audit="category-nav"] .catTab[data-cat="${k}"]`)
    const navText = () => txt(q('[data-audit="category-nav"] .catTab.on'))
    const panel = () => q('[data-audit="all-categories-panel"]')
    const filterInput = () => q('.filters__search input')
    const diffBtn = label => qa('.diffChips button').find(b => txt(b) === label)
    const purposeBtn = () => q('.purpose__btn')
    const purposeOption = label => qa('.purpose__option').find(b => txt(b) === label)
    const sortBtn = label => qa('.sortTabs button').find(b => txt(b) === label)

    async function openPanel() {
      if (panel()) return
      click(navBtn('all'))
      await sleep(350)
    }
    async function closePanel() {
      if (!panel()) return
      click(navBtn('all'))
      await sleep(350)
    }
    async function resetAll() {
      location.hash = '#/'
      await sleep(350)
      location.hash = '#/library'
      await sleep(650)
    }

    /* ---------- 结构 ---------- */
    step('顶栏 Logo', !!q('.brand__logo'))
    step('顶栏 slogan', txt(q('.brand__slogan')) === '所爱皆可拼，万物皆可造', txt(q('.brand__slogan')))
    step('顶栏上传入口', !!q('.libUpload'))
    step('顶栏账号入口', !!q('.accountBtn'))
    const bannerImg = q('.libBanner img')
    step('Banner 保持原切片', !!bannerImg && bannerImg.naturalWidth === 1287 && bannerImg.naturalHeight === 222,
      bannerImg ? `${bannerImg.naturalWidth}x${bannerImg.naturalHeight}` : 'missing')
    step('Banner 不是操作入口', !!q('.libBanner') && q('.libBanner').querySelectorAll('button,a').length === 0)

    const expectedNav = ['全部', '二次元', '萌宠动物', '情侣情感', '美食水果', '植物花卉', '生活美学', '节日祝福', '萌趣日常', '新手专区']
    const navLabels = qa('[data-audit="category-nav"] .catTab').map(txt)
    step('分类导航 10 项且顺序正确', JSON.stringify(navLabels) === JSON.stringify(expectedNav), navLabels.join(' / '))
    const navIcons = qa('[data-audit="category-nav"] .catIcon')
    step('分类图标 10 个 128px', navIcons.length === 10 && navIcons.every(i => i.naturalWidth === 128 && i.naturalHeight === 128),
      navIcons.map(i => `${i.naturalWidth}x${i.naturalHeight}`).join(','))
    /* 图标必须四边留透明边：内容贴到 128 画布边缘说明源图被裁过 */
    const iconBounds = navIcons.map(img => {
      const c = document.createElement('canvas')
      c.width = 128; c.height = 128
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, 128, 128)
      const d = ctx.getImageData(0, 0, 128, 128).data
      let minX = 128, minY = 128, maxX = -1, maxY = -1
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          if (d[(y * 128 + x) * 4 + 3] > 0) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      return { minX, minY, maxX, maxY }
    })
    step('分类图标内容未被裁切', iconBounds.every(m =>
      m.minX > 0 && m.minY > 0 && m.maxX < 127 && m.maxY < 127 && (m.maxY - m.minY + 1) >= 45),
      iconBounds.map(m => `${m.minX},${m.minY}-${m.maxX},${m.maxY}`).join(' '))
    step('默认选中全部', navText() === '全部', navText())
    step('默认排序推荐', txt(q('.sortTabs button.on')) === '推荐', txt(q('.sortTabs button.on')))
    step('默认难度全部', txt(q('.diffChips button.on')) === '全部', txt(q('.diffChips button.on')))
    step('默认用途全部', txt(purposeBtn()) === '全部', txt(purposeBtn()))
    step('搜索占位文案', filterInput()?.placeholder === '搜索当前分类的素材…', filterInput()?.placeholder)
    step('默认面板收起', !panel())
    step('默认结果 18 个', cards().length === 18, `count=${cards().length}`)
    step('结果标题', txt(q('.libResultBar h2')) === '全部素材', txt(q('.libResultBar h2')))
    step('分页文案', txt(q('.libResultBar p')).includes('已显示 18 / 共 26'), txt(q('.libResultBar p')))
    step('无横向溢出', document.documentElement.scrollWidth <= innerWidth + 2,
      `${document.documentElement.scrollWidth}/${innerWidth}`)

    const banned = ['追星', '应援', '会员专属', 'VIP', '卡密', '购买', '价格', '解锁', 'PRO']
    const hits = banned.filter(w => document.body.innerText.includes(w))
    step('无付费 / 追星残留', hits.length === 0, hits.join(','))

    if (wide) {
      const navCols = getComputedStyle(q('[data-audit="category-nav"] .catScroll')).gridTemplateColumns.split(' ').filter(Boolean).length
      step('桌面分类 10 列', navCols === 10, `cols=${navCols}`)
      step('桌面顶栏搜索与筛选栏搜索都在', shown(q('.libSearch')) && shown(filterInput()))
    } else if (tablet) {
      const navScroll = q('[data-audit="category-nav"] .catScroll')
      step('平板分类横滑', navScroll.scrollWidth > navScroll.clientWidth + 4, `${navScroll.scrollWidth}/${navScroll.clientWidth}`)
      step('平板顶栏搜索与筛选栏搜索都在', shown(q('.libSearch')) && shown(filterInput()))
    } else {
      step('手机分类横滑', q('[data-audit="category-nav"] .catScroll').scrollWidth > q('[data-audit="category-nav"] .catScroll').clientWidth + 4,
        `${q('[data-audit="category-nav"] .catScroll').scrollWidth}/${q('[data-audit="category-nav"] .catScroll').clientWidth}`)
      step('手机顶栏搜索隐藏', !shown(q('.libSearch')))
      const searchWrap = filterInput().closest('.filters__search')
      step('手机搜索框满宽', searchWrap.getBoundingClientRect().width > q('[data-audit="library-filters"]').getBoundingClientRect().width - 30,
        `${Math.round(searchWrap.getBoundingClientRect().width)}`)
    }

    /* ---------- 全部分类面板 ---------- */
    await openPanel()
    step('点全部展开面板', !!panel() && navBtn('all').getAttribute('aria-expanded') === 'true')
    step('面板标题 / 副文案', txt(q('.catPanel__title h2')) === '全部分类' &&
      txt(q('.catPanel__title p')).includes('海量可爱素材'), `${txt(q('.catPanel__title h2'))} / ${txt(q('.catPanel__title p'))}`)
    const panelCols = getComputedStyle(q('.catPanel__body')).gridTemplateColumns.split(' ').filter(Boolean).length
    step('面板列数（桌面两列 / 手机单列）', mobile ? panelCols === 1 : panelCols === 2, `cols=${panelCols}`)
    const blocks = qa('.catBlock').map(b => txt(q('.catBlock__name', b)).replace('即将上线', '').trim())
    const expectedBlocks = ['二次元', '萌宠动物', '情侣情感', '美食水果', '植物花卉', '生活美学', '节日祝福', '萌趣日常', '新手专区', '热门推荐', '店主专区']
    step('面板 11 个分类块顺序正确', JSON.stringify(blocks) === JSON.stringify(expectedBlocks), blocks.join(' / '))
    step('店主专区标注即将上线', txt(q('.catBlock[data-cat="shop"] .catBlock__badge')) === '即将上线')
    step('面板搜索框', q('.catPanel__search input')?.placeholder === '搜索素材…')
    if (mobile) {
      const r = panel().getBoundingClientRect()
      step('手机面板不超屏且避开底栏', r.bottom <= innerHeight - 48, `${Math.round(r.bottom)}/${innerHeight}`)
      click(q('.catBlock[data-cat="pets"] .catBlock__main'))
      await sleep(250)
      step('手机分类可展开二级项', qa('.catBlock[data-cat="pets"] .catBlock__child').length === 7,
        `${qa('.catBlock[data-cat="pets"] .catBlock__child').length}`)
    } else {
      step('桌面二级词条直接展示', qa('.catBlock__child').length > 30, `${qa('.catBlock__child').length}`)
      const panelRect = panel().getBoundingClientRect()
      const btnRect = navBtn('all').getBoundingClientRect()
      step('面板锚点在全部卡下方', panelRect.top >= btnRect.bottom - 2, `${Math.round(panelRect.top)}/${Math.round(btnRect.bottom)}`)
    }
    const pSearch = q('.catPanel__search input')
    setInput(pSearch, '猫')
    await sleep(500)
    step('面板搜索与筛选栏共享关键词', filterInput().value === '猫' && (!mobile ? q('.libSearch input').value === '猫' : true),
      `${filterInput().value}/${mobile ? '-' : q('.libSearch input').value}`)
    setInput(pSearch, '')
    await sleep(500)
    click(q('.catPanel__close'))
    await sleep(300)
    step('关闭按钮收起面板', !panel())
    await openPanel()
    await closePanel()
    step('再点全部收起面板', !panel())

    /* ---------- 一级分类 ---------- */
    click(navBtn('anime'))
    await sleep(450)
    step('一级分类切换', navText() === '二次元' && !panel(), `${navText()}/${!!panel()}`)
    step('一级分类写入地址栏', hash().includes('col=anime'), hash())
    step('一级分类结果', cardNames().length === 2 && cardNames().includes('抱星星的小恐龙') && cardNames().includes('游戏角色勇者'),
      cardNames().join(' / '))
    step('一级分类标题', txt(q('.libResultBar h2')) === '二次元', txt(q('.libResultBar h2')))

    click(navBtn('all'))
    await sleep(350)
    step('点全部回到全部并展开', navText() === '全部' && !!panel(), `${navText()}/${!!panel()}`)
    await closePanel()
    step('关闭后结果恢复 18 个', cards().length === 18, `count=${cards().length}`)

    /* ---------- 二级分类 ---------- */
    await openPanel()
    if (mobile) {
      click(q('.catBlock[data-cat="pets"] .catBlock__main'))
      await sleep(250)
    }
    const catChild = qa('.catBlock[data-cat="pets"] .catBlock__child').find(b => txt(b) === '猫咪')
    click(catChild)
    await sleep(500)
    step('二级分类筛选', hash().includes('col=pets') && hash().includes('sub=猫咪'), hash())
    step('二级分类标题 / 标签', txt(q('.libResultBar h2')) === '萌宠动物' && txt(q('.libSubChip')) === '猫咪',
      `${txt(q('.libResultBar h2'))}/${txt(q('.libSubChip'))}`)
    step('二级分类结果', cardNames().length === 3 && cardNames().every(n => n.includes('猫')), cardNames().join(' / '))
    step('二级分类后自动收起面板', !panel())
    click(q('.libReset'))
    await sleep(450)
    step('清空筛选保留一级分类', navText() === '萌宠动物' && !q('.libSubChip') && cards().length === 8,
      `${navText()}/${cards().length}`)

    /* ---------- 分类切换保留其他筛选 ---------- */
    await openPanel()
    if (mobile) {
      click(q('.catBlock[data-cat="pets"] .catBlock__main'))
      await sleep(250)
    }
    click(qa('.catBlock[data-cat="pets"] .catBlock__child').find(b => txt(b) === '猫咪'))
    await sleep(450)
    click(diffBtn('入门'))
    await sleep(350)
    click(purposeBtn())
    await sleep(200)
    click(purposeOption('钥匙扣'))
    await sleep(400)
    setInput(filterInput(), '猫')
    await sleep(500)
    click(navBtn('food'))
    await sleep(500)
    step('切一级分类清空二级、保留关键词 / 难度 / 用途',
      !q('.libSubChip') && hash().includes('col=food') && hash().includes('diff=easy') &&
      hash().includes('purpose=keychain') && hash().includes('q=猫'), hash())
    step('组合筛选无结果', !!q('.libEmpty') && txt(q('.libEmpty strong')) === '暂无符合条件的素材',
      txt(q('.libEmpty strong')))
    click(q('.libEmpty .btn'))
    await sleep(500)
    step('空状态清空筛选', cards().length === 18 && navText() === '全部', `${cards().length}/${navText()}`)

    /* ---------- 排序 ---------- */
    await resetAll()
    click(sortBtn('最新'))
    await sleep(400)
    step('最新排序', JSON.stringify(cardNames().slice(0, 3)) === JSON.stringify(['草莓小猫', '情侣爱心', '表情包团子']),
      cardNames().slice(0, 3).join(' / '))
    step('最新写入地址栏', hash().includes('sort=newest'), hash())

    click(sortBtn('最热'))
    await sleep(400)
    step('最热排序', cardNames()[0] === '草莓小猫' && cardNames()[1] === '橘子柯基', cardNames().slice(0, 3).join(' / '))
    step('最热写入地址栏', hash().includes('sort=hottest'), hash())

    const favTarget = cardByName('橘子柯基')
    click(q('.mCard__fav', favTarget))
    await sleep(250)
    click(sortBtn('收藏最多'))
    await sleep(400)
    step('收藏最多把已收藏素材排前', cardNames()[0] === '橘子柯基', cardNames().slice(0, 3).join(' / '))
    step('收藏最多写入地址栏', hash().includes('sort=most_favorited'), hash())
    click(q('.mCard__fav', cardByName('橘子柯基')))
    await sleep(250)

    click(sortBtn('推荐'))
    await sleep(400)
    step('推荐排序', JSON.stringify(cardNames().slice(0, 3)) === JSON.stringify(['草莓小猫', '表情包团子', '情侣爱心']),
      cardNames().slice(0, 3).join(' / '))

    /* ---------- 难度 ---------- */
    click(diffBtn('入门'))
    await sleep(400)
    step('难度入门', hash().includes('diff=easy') && cardNames().includes('草莓小猫') && !cardNames().includes('游戏角色勇者'),
      `${hash()} ${cardNames().slice(0, 4).join('/')}`)
    click(diffBtn('进阶'))
    await sleep(400)
    step('难度进阶', hash().includes('diff=hard') && cardNames().includes('游戏角色勇者') && !cardNames().includes('草莓小猫'),
      cardNames().join(' / '))
    click(diffBtn('全部'))
    await sleep(350)

    /* ---------- 用途下拉 ---------- */
    click(purposeBtn())
    await sleep(200)
    const purposeLabels = qa('.purpose__option').map(txt)
    const expectedPurpose = ['全部用途', '钥匙扣', '冰箱贴', '杯垫', '挂饰', '摆件', '装饰画']
    step('用途下拉 7 项且顺序正确', JSON.stringify(purposeLabels) === JSON.stringify(expectedPurpose), purposeLabels.join(' / '))
    step('用途选中项有勾选', !!q('.purpose__option.on svg'), txt(q('.purpose__option.on')))
    if (!mobile) {
      const pr = q('.purpose__menu').getBoundingClientRect()
      const br = purposeBtn().getBoundingClientRect()
      step('下拉左沿对齐按钮', Math.abs(pr.left - br.left) <= 2, `${Math.round(pr.left)}/${Math.round(br.left)}`)
    }
    if (mobile) {
      const pr = q('.purpose__menu').getBoundingClientRect()
      step('手机下拉不超出视口', pr.right <= innerWidth - 4, `${Math.round(pr.right)}/${innerWidth}`)
    }
    key(q('.purpose__menu'), 'Escape')
    await sleep(250)
    step('Escape 关闭用途下拉', !q('.purpose__menu'))

    purposeBtn().focus()
    key(purposeBtn(), 'ArrowDown')
    await sleep(200)
    step('键盘打开用途下拉', !!q('.purpose__menu'))
    key(q('.purpose__menu'), 'ArrowDown')
    key(q('.purpose__menu'), 'ArrowDown')
    await sleep(150)
    step('键盘移动焦点', txt(document.activeElement) === '冰箱贴', txt(document.activeElement))
    document.activeElement.click()
    await sleep(400)
    step('键盘选择用途', txt(purposeBtn()) === '冰箱贴' && hash().includes('purpose=fridge_magnet'),
      `${txt(purposeBtn())} ${hash()}`)
    step('用途筛选结果', cardNames().length === 3 && cardNames().includes('橘子柯基') && cardNames().includes('冰箱贴星星'),
      cardNames().join(' / '))

    click(purposeBtn())
    await sleep(200)
    click(purposeOption('钥匙扣'))
    await sleep(400)
    step('用途钥匙扣结果', cardNames().length === 6, `${cardNames().length}`)
    click(purposeBtn())
    await sleep(200)
    click(purposeOption('全部用途'))
    await sleep(400)
    step('用途恢复全部', cards().length === 18 && txt(purposeBtn()) === '全部', `${cards().length}/${txt(purposeBtn())}`)

    click(purposeBtn())
    await sleep(200)
    q('.libResultBar h2').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await sleep(250)
    step('点外部关闭用途下拉', !q('.purpose__menu'))

    /* ---------- 搜索 ---------- */
    setInput(filterInput(), '猫')
    await sleep(550)
    step('搜索去抖生效', cardNames().length === 4 && cardNames().every(n => n.includes('猫')), cardNames().join(' / '))
    step('搜索写入地址栏', hash().includes('q=猫'), hash())
    if (!mobile) step('顶栏搜索同步关键词', q('.libSearch input').value === '猫', q('.libSearch input').value)
    click(q('.filters__clear'))
    await sleep(500)
    step('清空搜索恢复', cards().length === 18 && !hash().includes('q='), `${cards().length} ${hash()}`)

    setInput(filterInput(), 'zzzzz')
    await sleep(550)
    step('空结果文案', txt(q('.libEmpty strong')) === '暂无符合条件的素材' &&
      txt(q('.libEmpty p')).includes('试试其他关键词或筛选条件'), `${txt(q('.libEmpty strong'))} / ${txt(q('.libEmpty p'))}`)
    click(q('.libEmpty .btn'))
    await sleep(500)
    step('空结果可清空', cards().length === 18, `${cards().length}`)

    /* ---------- 键盘 / 外部点击 ---------- */
    navBtn('all').focus()
    navBtn('all').click()
    await sleep(300)
    step('键盘打开面板（Enter 同点击）', !!panel())
    key(document.body, 'Escape')
    await sleep(250)
    step('Escape 关闭面板', !panel())
    navBtn('all').click()
    await sleep(300)
    q('.libResultBar h2').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await sleep(250)
    step('点外部关闭面板', !panel())

    /* ---------- 刷新 / 后退恢复 ---------- */
    location.hash = '#/library?col=food&diff=easy&purpose=keychain&sort=newest&q=柠檬'
    await sleep(700)
    step('地址栏恢复一级分类', navText() === '美食水果', navText())
    step('地址栏恢复排序 / 难度 / 用途', txt(q('.sortTabs button.on')) === '最新' &&
      txt(q('.diffChips button.on')) === '入门' && txt(purposeBtn()) === '钥匙扣',
      `${txt(q('.sortTabs button.on'))}/${txt(q('.diffChips button.on'))}/${txt(purposeBtn())}`)
    step('地址栏恢复关键词与结果', filterInput().value === '柠檬' && cardNames().length === 1 && cardNames()[0] === '柠檬小鸡',
      `${filterInput().value} ${cardNames().join('/')}`)

    location.hash = '#/'
    await sleep(400)
    history.back()
    await sleep(700)
    step('浏览器后退恢复筛选', navText() === '美食水果' && filterInput().value === '柠檬' && cardNames()[0] === '柠檬小鸡',
      `${navText()} ${filterInput().value} ${cardNames().join('/')}`)

    /* ---------- 收藏 / 预览 / 加载更多 ---------- */
    await resetAll()
    const favCard = cardByName('橘子柯基')
    click(q('.mCard__fav', favCard))
    await sleep(250)
    step('收藏图标同步', q('.mCard__fav', cardByName('橘子柯基')).classList.contains('on'))
    click(q('.mCard__fav', cardByName('橘子柯基')))
    await sleep(250)

    click(q('.mCard__media', cards()[0]))
    await sleep(350)
    step('素材卡仍可预览', !!q('.modal.show .dialog'), txt(q('.modal.show .dialog__head h2')))
    key(document.body, 'Escape')
    await sleep(300)
    step('Escape 关闭预览', !q('.modal.show'))

    click(q('.libMore .btn'))
    await sleep(300)
    step('加载更多', cards().length === 26 && !q('.libMore'), `count=${cards().length}`)
    step('加载完文案', txt(q('.libResultBar p')) === '共 26 个素材', txt(q('.libResultBar p')))

    out.cards = cardNames().length
    out.hash = hash()
    return out
  } catch (e) {
    out.ok = false
    out.err = e && e.message
    out.stack = e && e.stack
    return out
  }
})()
