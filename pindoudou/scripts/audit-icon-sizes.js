/* 自检探针：全站每个 PixelIcon 的**实际渲染尺寸**是否等于它声明的 size。
   用法：node scripts/audit.cjs --eval-file scripts/audit-icon-sizes.js --page editor,home,library

   为什么要有这一项：图标有两种画法 —— 12×12 的网格（svg）与交付包的像素插画（位图 img）。
   位图那条会被容器里的「后代 img 一律铺满」规则误伤：
   例如 .thumb img{width:100%;height:164px} 是给缩略图源图用的，
   结果把按钮里 14px 的 fn-library 图标拉成 19×164，图形溢出到按钮外面，
   页面上一眼只看到一个白圆钮 —— 不报错、整页截图也不容易发现。
   这里把每个图标的「声明尺寸 vs 渲染尺寸」逐个读出来，尺寸对不上就报出来。 */
(async () => {
  const out = { ok: true, total: 0, checked: 0, bad: [] }

  const nodes = [...document.querySelectorAll('.pixelIcon')]
  out.total = nodes.length

  for (const el of nodes) {
    const cs = getComputedStyle(el)
    /* 隐藏的图标（手机上 .viewtabs 里的图标 display:none）不看尺寸 */
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue

    const want = Number(el.getAttribute('width'))
    if (!Number.isFinite(want) || want <= 0) continue
    out.checked++

    const dw = Math.abs(r.width - want)
    const dh = Math.abs(r.height - want)
    /* 容差 1px：浏览器会把 svg 的 12×12 网格按 1px 网格对齐，偶发半像素 */
    if (dw > 1 || dh > 1) {
      out.bad.push({
        kind: el.tagName.toLowerCase(),
        name: el.getAttribute('src') ? String(el.getAttribute('src')).split('/').pop() : 'grid',
        want,
        got: `${Math.round(r.width * 10) / 10}×${Math.round(r.height * 10) / 10}`,
        where: (el.closest('[class]') && el.closest('[class]').className || '').toString().slice(0, 60)
      })
    }
  }

  out.ok = out.bad.length === 0
  return out
})()
