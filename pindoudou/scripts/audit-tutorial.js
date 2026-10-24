/* 自检探针：新手教程弹窗（桌面端 / 手机端各 5 段视频）
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-tutorial.js --page editor
   断言：入口（桌面顶栏 / 手机底部工具行「更多」）、两套设备、默认按视口选、5 课、
        视频元数据、封面、播放、背景音乐音轨、切课、切设备、无横向溢出。 */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const out = { ok: false }
  const narrow = innerWidth <= 820
  out.narrow = narrow
  out.expectedDevice = narrow ? 'mobile' : 'desktop'

  /* 首次进入工作台会自动弹新手指引；线上没有 fixture 时它可能已经盖在页面上。
     真实用户会先跳过，这里也先关掉，避免探针点到被遮住的按钮、截图也被挡住。 */
  const skipGuide = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('跳过'))
  if (skipGuide) {
    skipGuide.click()
    await sleep(350)
  }

  const clickText = (sel, text) => {
    const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text))
    if (el) el.click()
    return !!el
  }

  let entry
  if (narrow) {
    out.entryVia = 'tool-more'
    clickText('.toolItem', '更多')
    await sleep(450)
    entry = [...document.querySelectorAll('.moreItem')].find(b => b.textContent.includes('新手教程'))
  } else {
    out.entryVia = 'title-bar'
    entry = [...document.querySelectorAll('.canvasTitleBar button')].find(b => b.textContent.includes('新手教程'))
  }
  out.entry = !!entry
  if (!entry) return out
  entry.click()
  await sleep(700)

  const dialog = document.querySelector('[data-audit="tutorial-dialog"]')
  out.dialog = !!dialog
  if (!dialog) return out

  const tabs = [...dialog.querySelectorAll('[data-audit="tutorial-device"]')]
  out.deviceTabs = tabs.length
  out.defaultDevice = tabs.find(t => t.classList.contains('on'))?.dataset.device || ''

  const items = [...dialog.querySelectorAll('.lessonItem')]
  out.lessonCount = items.length

  const waitMeta = async (v, timeout = 8000) => {
    if (!v || v.readyState >= 1) return
    await new Promise(res => {
      v.onloadedmetadata = res
      setTimeout(res, timeout)
    })
  }

  const video = dialog.querySelector('video')
  out.video = !!video
  out.src = video?.getAttribute('src') || ''
  out.poster = video?.getAttribute('poster') || ''
  out.cover = !!dialog.querySelector('.player__cover')

  if (video) {
    await waitMeta(video)
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
    /* 教程视频带轻快背景音乐：播放 1.8 秒后音频解码字节数应该 > 0。
       muted 只影响输出音量，不影响解码，所以这里能查到音轨。 */
    out.audioBytes = video.webkitAudioDecodedByteCount || 0
    video.pause()
  }

  if (items[1]) {
    items[1].click()
    await sleep(900)
    /* 切课会重建 <video>（:key），必须重新查一次 */
    const video2 = dialog.querySelector('video')
    out.secondActive = items[1].classList.contains('on')
    out.secondSrc = video2?.getAttribute('src') || ''
    out.secondPoster = video2?.getAttribute('poster') || ''
    out.secondTitle = dialog.querySelector('.lessonMeta__head b')?.textContent?.trim() || ''
    out.switched = out.secondSrc !== out.src
  }

  /* 切到另一套设备：课程列表、视频路径、标题都要换 */
  const other = out.expectedDevice === 'mobile' ? 'desktop' : 'mobile'
  const otherTab = tabs.find(t => t.dataset.device === other)
  if (otherTab) {
    otherTab.click()
    await sleep(1000)
    const video3 = dialog.querySelector('video')
    const items3 = [...dialog.querySelectorAll('.lessonItem')]
    out.otherDevice = other
    out.otherActive = otherTab.classList.contains('on')
    out.otherLessonCount = items3.length
    out.otherFirstActive = items3[0]?.classList.contains('on') || false
    out.otherSrc = video3?.getAttribute('src') || ''
    out.otherPoster = video3?.getAttribute('poster') || ''
    out.otherTitle = dialog.querySelector('.lessonMeta__head b')?.textContent?.trim() || ''
    await waitMeta(video3)
    out.otherDuration = Math.round((video3?.duration || 0) * 10) / 10
    out.otherSize = `${video3?.videoWidth || 0}x${video3?.videoHeight || 0}`

    /* 切回默认那套，AUDIT_SHOT_AFTER_PROBE 截图看到的就是用户打开时的样子 */
    tabs.find(t => t.dataset.device === out.expectedDevice)?.click()
    await sleep(700)
  }

  const body = document.querySelector('.dialog__body')
  out.overflowX = !!body && body.scrollWidth > body.clientWidth + 1
  out.dialogWidth = dialog.getBoundingClientRect().width
  if (out.overflowX) {
    const br = body.getBoundingClientRect()
    out.overflowEls = [...body.querySelectorAll('*')]
      .filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.right > br.right + 1
      })
      .slice(0, 10)
      .map(el => `${el.tagName}.${String(el.className).slice(0, 36)} ${Math.round(el.getBoundingClientRect().width)}`)
  }

  const expectDevice = out.expectedDevice
  const otherDevice = expectDevice === 'mobile' ? 'desktop' : 'mobile'
  /* 桌面录 16:9，手机录竖屏 9:16 —— 手机那套在手机上要能看清界面 */
  const sizeOf = device => device === 'mobile' ? '720x1280' : '1280x720'
  out.ok = out.entry && out.dialog && out.video && out.deviceTabs === 2 &&
    out.defaultDevice === expectDevice && out.lessonCount === 5 &&
    out.src.includes(`/tutorials/${expectDevice}/upload.mp4`) && out.cover &&
    out.duration >= 14 && out.size === sizeOf(expectDevice) && out.posterLoaded &&
    out.playing && out.currentTime > 0.5 && out.audioBytes > 0 && out.secondActive && out.switched &&
    out.secondSrc.includes(`/tutorials/${expectDevice}/size.mp4`) &&
    out.otherActive && out.otherLessonCount === 5 && out.otherFirstActive &&
    out.otherSrc.includes(`/tutorials/${otherDevice}/upload.mp4`) &&
    out.otherDuration >= 14 && out.otherSize === sizeOf(otherDevice) && !out.overflowX
  return out
})()
