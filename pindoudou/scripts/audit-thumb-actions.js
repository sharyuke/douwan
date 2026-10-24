/* 自检探针：上传后的缩略图右上角那两个圆钮（换一张 / 去素材中心）图标是否真的画出来了。
   用法：node scripts/audit.cjs --eval-file scripts/audit-thumb-actions.js /editor

   为什么要有这一项：这两个钮用的是 PixelIcon 的**位图**分支（fn-library 是 170×170 的
   像素插画 PNG），跟左边 12×12 网格图标（swap）走的不是同一条路。
   位图那格一旦出问题（资源 404、尺寸塌成 0、被白色背景吃掉），
   页面**不会报错**，只会看到「一个白圆钮」—— 纯看整页截图发现不了，
   所以这里直接把每个钮里的图标的真实渲染尺寸 / 加载状态读出来。 */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 20000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      if (fn()) return true
      await sleep(80)
    }
    return false
  }

  /* 造一张 200×200 的测试图，像用户一样塞进 input[type=file] */
  const cv = document.createElement('canvas')
  cv.width = 200
  cv.height = 200
  const cx = cv.getContext('2d')
  cx.fillStyle = '#F4F6F8'
  cx.fillRect(0, 0, 200, 200)
  cx.fillStyle = '#E4572E'
  cx.beginPath()
  cx.arc(100, 100, 60, 0, Math.PI * 2)
  cx.fill()
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'))
  const file = new File([blob], 'thumb-probe.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('.upload ~ input[type=file]') ||
    document.querySelector('input[type=file]:not(.libFile)')
  if (!input) return { ok: false, err: '找不到上传用的 file input' }
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  const uploaded = await waitFor(() => !!document.querySelector('.thumb__actions'))
  if (!uploaded) return { ok: false, err: '上传后没有出现缩略图' }
  await sleep(400)

  const btns = [...document.querySelectorAll('.thumb__actions button')].map(b => {
    const img = b.querySelector('img')
    const svg = b.querySelector('svg')
    const node = img || svg
    const r = b.getBoundingClientRect()
    const nr = node ? node.getBoundingClientRect() : null
    const cs = node ? getComputedStyle(node) : null
    return {
      title: b.getAttribute('title') || '',
      box: `${Math.round(r.width)}×${Math.round(r.height)}`,
      kind: img ? 'img' : svg ? 'svg' : 'none',
      src: img ? img.getAttribute('src') : null,
      currentSrc: img ? img.currentSrc : null,
      natural: img ? `${img.naturalWidth}×${img.naturalHeight}` : null,
      complete: img ? img.complete : null,
      drawn: nr ? `${Math.round(nr.width)}×${Math.round(nr.height)}` : null,
      opacity: cs ? cs.opacity : null,
      visibility: cs ? cs.visibility : null,
      display: cs ? cs.display : null
    }
  })

  const out = { ok: true, count: btns.length, btns }
  /* 两个钮都要画出来：swap 是网格图标（svg），fn-library 是位图（img） */
  out.ok = btns.length === 2 && btns.every(b => b.kind !== 'none' && b.drawn && b.drawn !== '0×0')
  return out
})()
