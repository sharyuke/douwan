/* 首页上传入口自检：
   ① 点「选择图片」要进工作台；
   ② 把图片拖到上传卡上，要经过 usePendingUpload → 工作台自动生成图纸。
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

  const btn = document.querySelector('.uploadCard__btn')
  if (!btn) return { ok: false, err: '首页没有上传按钮' }
  btn.click()
  out.clickOk = await waitFor(() => location.hash.startsWith('#/editor'))
  out.clickHash = location.hash

  location.hash = '#/'
  await waitFor(() => !!document.querySelector('.uploadCard'))
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

  const card = document.querySelector('.uploadCard')
  card.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  card.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))

  out.dropHashOk = await waitFor(() => location.hash.startsWith('#/editor'))
  out.dropHash = location.hash
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  out.dropGenerated = await waitFor(() => S.pattern.value && S.pattern.value.width > 0, 20000)
  out.pattern = S.pattern.value ? `${S.pattern.value.width}×${S.pattern.value.height}` : ''
  out.ok = out.clickOk && out.dropHashOk && out.dropGenerated
  return out
})()
