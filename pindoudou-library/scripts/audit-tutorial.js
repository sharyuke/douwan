/* 自检探针：新手教程弹窗（4 段视频）
   用法：node scripts/audit.cjs --eval-file scripts/audit-tutorial.js --page editor
   断言：入口按钮、4 课列表、视频元数据、封面、播放、切换课程、无横向溢出。 */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = { ok: false }

  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新手教程')
  out.entry = !!btn
  if (!btn) return out
  btn.click()
  await sleep(700)

  const dialog = document.querySelector('[data-audit="tutorial-dialog"]')
  out.dialog = !!dialog
  if (!dialog) return out

  const video = dialog.querySelector('video')
  const items = [...dialog.querySelectorAll('.lessonItem')]
  out.video = !!video
  out.lessonCount = items.length
  out.src = video?.getAttribute('src') || ''
  out.poster = video?.getAttribute('poster') || ''
  out.cover = !!dialog.querySelector('.player__cover')

  if (video) {
    await new Promise(res => {
      if (video.readyState >= 1) return res()
      video.onloadedmetadata = res
      setTimeout(res, 6000)
    })
    out.duration = Math.round((video.duration || 0) * 10) / 10
    out.size = `${video.videoWidth}x${video.videoHeight}`
    out.posterLoaded = await new Promise(res => {
      const img = dialog.querySelector('.player__poster')
      if (!img) return res(false)
      if (img.complete) return res(img.naturalWidth > 0)
      img.onload = () => res(img.naturalWidth > 0)
      img.onerror = () => res(false)
      setTimeout(() => res(img.naturalWidth > 0), 5000)
    })

    video.muted = true
    dialog.querySelector('.player__cover')?.click()
    await sleep(1800)
    out.playing = !video.paused
    out.currentTime = Math.round((video.currentTime || 0) * 10) / 10
    video.pause()
  }

  if (items[1]) {
    items[1].click()
    await sleep(900)
    /* 切课会重建 <video>（:key），必须重新查一次；旧的引用已经脱离文档 */
    const video2 = dialog.querySelector('video')
    out.secondActive = items[1].classList.contains('on')
    out.secondSrc = video2?.getAttribute('src') || ''
    out.secondPoster = video2?.getAttribute('poster') || ''
    out.secondTitle = dialog.querySelector('.lessonMeta__head b')?.textContent?.trim() || ''
    out.switched = out.secondSrc !== out.src
  }

  const body = document.querySelector('.dialog__body')
  out.overflowX = !!body && body.scrollWidth > body.clientWidth + 1
  out.dialogWidth = dialog.getBoundingClientRect().width

  out.ok = out.entry && out.dialog && out.video && out.lessonCount === 4 &&
    /upload\.mp4$/.test(out.src) && out.cover && out.duration >= 23 &&
    out.size === '1280x720' && out.posterLoaded && out.playing &&
    out.currentTime > 0.5 && out.secondActive && out.switched &&
    /scheme\.mp4$/.test(out.secondSrc) && !out.overflowX
  return out
})()
