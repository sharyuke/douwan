/* 素材卡片改版自检（参考稿：奶油底 + 浅色难度胶囊 + 点赞 + 尺寸 + 色卡 + 星标）
   用法：先起 scripts/mock-api-server.cjs（4399），再
   node scripts/audit.cjs --url http://127.0.0.1:4399 \
     --eval-file scripts/audit-card-design.js --page library */
(async () => {
  let out = { ok: true, steps: [], width: innerWidth }
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const q = (s, root = document) => root.querySelector(s)
    const qa = (s, root = document) => [...root.querySelectorAll(s)]
    const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
    const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop)
    const rgb = el => cs(el, 'background-color').replace(/\s/g, '')
    const step = (name, pass, detail = '') => {
      out.steps.push({ name, pass: !!pass, detail })
      if (!pass) out.ok = false
    }

    const mobile = innerWidth <= 780
    const tablet = innerWidth > 780 && innerWidth <= 1100

    location.hash = '#/library'
    await sleep(900)
    const cards = qa('.mCard')
    step('素材卡渲染', cards.length >= 6, `count=${cards.length}`)
    if (!cards.length) return out

    const card = cards[0]
    const media = q('.mCard__media', card)
    const badge = q('.mCard__badge', card)
    const likes = q('.mCard__likes', card)
    const name = q('.mCard__name', card)
    const dots = qa('.mCard__dots i', card)
    const fav = q('.mCard__fav', card)

    /* ---------- 卡片外观 ---------- */
    step('卡片奶油白底', rgb(card) === 'rgb(255,253,248)', rgb(card))
    step('卡片大圆角', parseFloat(cs(card, 'border-radius')) >= 16, cs(card, 'border-radius'))
    step('卡片细描边 + 轻阴影', cs(card, 'border-top-width') === '1px' && cs(card, 'box-shadow') !== 'none',
      `${cs(card, 'border-top-width')} / ${cs(card, 'box-shadow').slice(0, 40)}`)

    const mediaBg = cs(media, 'background-image')
    step('主图米色渐变底', mediaBg.includes('linear-gradient'), mediaBg.slice(0, 60))
    step('主图区域圆角', parseFloat(cs(media, 'border-radius')) >= 12, cs(media, 'border-radius'))
    const mr = media.getBoundingClientRect()
    step('主图接近方形', Math.abs(mr.width - mr.height) <= 2, `${Math.round(mr.width)}x${Math.round(mr.height)}`)
    const img = q('img', media)
    step('缩略图 multiply 融进米色底', img && cs(img, 'mix-blend-mode') === 'multiply', img ? cs(img, 'mix-blend-mode') : 'missing')

    /* ---------- 难度胶囊 ---------- */
    step('左上角难度标签', !!badge && ['入门', '简单', '进阶'].includes(txt(badge)), txt(badge))
    if (badge) {
      const br = badge.getBoundingClientRect()
      step('难度标签是浅色胶囊', parseFloat(cs(badge, 'border-radius')) >= 20 && rgb(badge) !== 'rgb(63,159,95)',
        `${cs(badge, 'border-radius')} / ${rgb(badge)}`)
      step('难度标签文字有对比色', cs(badge, 'color') !== rgb(badge), `${cs(badge, 'color')} on ${rgb(badge)}`)
      step('难度标签贴左上', br.left - mr.left < 14 && br.top - mr.top < 14,
        `${Math.round(br.left - mr.left)},${Math.round(br.top - mr.top)}`)
    }

    /* ---------- 点赞 ---------- */
    step('右上角点赞', !!likes && /^\d+(\.\d)?k?$/.test(txt(likes)), txt(likes))
    if (likes) {
      const lr = likes.getBoundingClientRect()
      step('点赞贴右上', mr.right - lr.right < 14 && lr.top - mr.top < 14,
        `${Math.round(mr.right - lr.right)},${Math.round(lr.top - mr.top)}`)
      step('点赞粉红色', cs(likes, 'color') === 'rgb(254, 67, 95)', cs(likes, 'color'))
      /* 2026-10-23 起点赞爱心换成交付包的 PNG（like-heart.png），不再是矢量 svg */
      const heart = q('.mCard__likeIcon', likes)
      step('点赞带心形图标', !!heart && heart.tagName === 'IMG' && heart.naturalWidth > 0,
        heart ? `${heart.tagName} ${heart.naturalWidth}x${heart.naturalHeight}` : 'missing')
    }
    const likeTexts = qa('.mCard__likes b').map(txt)
    step('点赞数字不是全 0', likeTexts.length > 0 && likeTexts.some(t => t !== '0'), likeTexts.slice(0, 6).join(','))

    /* ---------- 标题 ---------- */
    step('标题单行省略', cs(name, 'white-space') === 'nowrap' && cs(name, 'text-overflow') === 'ellipsis',
      `${cs(name, 'white-space')} / ${cs(name, 'text-overflow')}`)

    /* ---------- 色卡 ---------- */
    /* 圆点数量由缩略图主色决定（真实缩略图 5~6 个；假数据只有 1 个） */
    step('底部色卡有圆点', dots.length >= 1 && dots.length <= 6, `count=${dots.length}`)
    step('色卡是圆点', dots.every(d => cs(d, 'border-radius') === '50%'), dots.map(d => cs(d, 'border-radius')).join(','))

    /* ---------- 收藏按钮 ---------- */
    step('右下角收藏按钮', !!fav, fav ? 'ok' : 'missing')
    if (fav) {
      const fr = fav.getBoundingClientRect()
      step('收藏按钮浅黄底 + 黄描边', rgb(fav) === 'rgb(255,248,222)' && cs(fav, 'border-top-color') === 'rgb(246, 217, 140)',
        `${rgb(fav)} / ${cs(fav, 'border-top-color')}`)
      step('收藏按钮尺寸合适', fr.width >= 28 && fr.width <= 40 && Math.abs(fr.width - fr.height) <= 1,
        `${Math.round(fr.width)}x${Math.round(fr.height)}`)
      step('收藏按钮在信息区右侧', fr.left > name.getBoundingClientRect().right - 1,
        `${Math.round(fr.left)}/${Math.round(name.getBoundingClientRect().right)}`)
      const before = fav.classList.contains('on')
      fav.click()
      await sleep(250)
      const after = fav.classList.contains('on')
      step('点星标能切换收藏', before !== after, `${before}->${after}`)
      fav.click()
      await sleep(200)
    }

    /* ---------- 网格 / 溢出 ---------- */
    const grid = q('.materialGrid')
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
    /* 列数跟着 LibraryView.vue 的断点走：电脑 6 个，窄屏逐级减到手机 2 个 */
    const wantCols = innerWidth <= 780 ? 2
      : innerWidth <= 880 ? 3
        : innerWidth <= 1080 ? 4
          : innerWidth <= 1280 ? 5 : 6
    step('网格列数', cols === wantCols, `${cols}（期望 ${wantCols}）`)
    step('无横向溢出', document.documentElement.scrollWidth <= innerWidth + 2,
      `${document.documentElement.scrollWidth}/${innerWidth}`)
    const rowCards = cards.slice(0, wantCols)
    const heights = rowCards.map(c => Math.round(c.getBoundingClientRect().height))
    step('同一行卡片等高', new Set(heights).size === 1, heights.join(','))

    /* ---------- 预览仍然可用 ---------- */
    q('.mCard__media', card).click()
    await sleep(400)
    step('点卡片能打开预览', !!q('.modal.show .dialog'), txt(q('.modal.show .dialog__head h2')))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(300)
    step('Escape 关闭预览', !q('.modal.show'))

    out.cards = cards.length
    return out
  } catch (e) {
    out.ok = false
    out.err = e && e.message
    out.stack = e && e.stack
    return out
  }
})()
