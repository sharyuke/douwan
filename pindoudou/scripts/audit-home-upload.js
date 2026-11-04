/* 首页上传入口自检：
   ① 点主按钮「立即创作」要进工作台；
   ② 把图片拖到首页上，要经过 usePendingUpload → 工作台自动生成图纸，
      并按图案复杂度给出推荐钉板（简单图 → 52，钉板 1 块）。
   用法：node scripts/audit.cjs --eval-file scripts/audit-home-upload.js --page home */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 15000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      if (fn()) return true
      await sleep(60)
    }
    return false
  }
  const out = { ok: true }

  /* 首页 2026-11-01 改版后没有上传卡：主按钮进工作台，整页都能接拖入的图 */
  const cta = document.querySelector('.homeV3__cta')
  if (!cta) return { ok: false, err: '首页没有主按钮' }
  cta.click()
  out.clickOk = await waitFor(() => location.pathname.startsWith('/editor'))
  out.clickHash = location.pathname + location.search

  history.back()
  out.backHome = await waitFor(() => !!document.querySelector('.homeV3'), 5000)
  if (!out.backHome) return { ok: false, err: '回不到首页', ...out }
  await sleep(120)

  const cv = document.createElement('canvas')
  cv.width = 240
  cv.height = 240
  const cx = cv.getContext('2d')
  cx.fillStyle = '#F4F6F8'
  cx.fillRect(0, 0, 240, 240)
  cx.fillStyle = '#E4572E'
  cx.beginPath()
  cx.arc(120, 120, 76, 0, Math.PI * 2)
  cx.fill()
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'))
  const file = new File([blob], 'home-drop.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)

  const home = document.querySelector('.homeV3')
  home.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  home.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))

  out.dropHashOk = await waitFor(() => location.pathname.startsWith('/editor'))
  out.dropHash = location.pathname + location.search
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪', ...out }
  const S = await d.studio()
  out.dropGenerated = await waitFor(() => S.pattern.value && S.pattern.value.width > 0, 20000)
  out.pattern = S.pattern.value ? `${S.pattern.value.width}×${S.pattern.value.height}` : ''
  out.recommend = S.sourceRecommend.value
    ? { spec: S.sourceRecommend.value.spec, score: S.sourceRecommend.value.score }
    : null
  /* 简单平涂图：推荐最小板 52，画布就是一块板（钉板数量 1 块） */
  out.specOk = !!out.recommend && out.recommend.spec === 52
  out.oneBoardOk = S.options.canvasMaxW === 52 && S.options.canvasMaxH === 52
  out.ok = !!(out.clickOk && out.dropHashOk && out.dropGenerated && out.specOk && out.oneBoardOk)
  return out
})()
