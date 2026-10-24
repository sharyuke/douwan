/* 自检探针：桌面 / 平板的整图动作行只保留「左右镜像」（上下镜像 2026-10-23 下线）。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-mirror-buttons.js --page editorProject

   断言的都是真实 DOM 与真实格子数据：

     · 桌面 / 平板：画布下方工具行 8 颗按钮（5 工具 + 撤销 / 重做 + 左右镜像），
       没有「上下镜像」；1440 是设计目标（正好一行），1320 / 834 按组换行但最多两行，
       没有按钮被挤出容器；
     · 点「左右镜像」真的把整张图纸水平翻转（逐格比对，不是只看按钮有没有变灰），
       并且不切换当前画笔；
     · 手机（≤780px）：画布下方工具条整块隐藏，底部工具行首格仍是「镜像」，点一下同样水平翻转。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const steps = []
  const step = (name, pass, detail = '') => steps.push({ name, pass: !!pass, detail })

  const isMobile = innerWidth <= 780
  const cells = () => Array.from(S.pattern.value.cells)
  const pat = S.pattern.value
  const w = pat.width
  const h = pat.height

  /* 水平 / 垂直翻转后每格应有的下标：直接按坐标算，跟实现无关 */
  const flipH = arr => {
    const out = new Array(arr.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] = arr[y * w + (w - 1 - x)]
    }
    return out
  }
  const flipV = arr => {
    const out = new Array(arr.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] = arr[(h - 1 - y) * w + x]
    }
    return out
  }
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

  try {
    if (isMobile) {
      const panel = q('.editPanel')
      step('手机上画布下方工具条隐藏', !panel || getComputedStyle(panel).display === 'none')
      const row = qa('.mobileToolbar .toolItem')
      step('底部工具行有按钮', row.length > 0, `count=${row.length}`)
      const mirror = row[0]
      step('首格是「镜像」', txt(mirror) === '镜像', txt(mirror))
      const before = cells()
      const toolBefore = S.tool.value
      mirror.click()
      await sleep(260)
      const after = cells()
      step('镜像真的水平翻转了图纸', same(after, flipH(before)))
      step('镜像不切换画笔', S.tool.value === toolBefore, S.tool.value)
      return { ok: steps.every(s => s.pass), steps, width: innerWidth }
    }

    const buttons = qa('.toolgroup .tool')
    /* 宽屏标签是「左右镜像」，窄屏换成短标签「左右」；两段都在 DOM 里，
       只取当前可见的那一段，别把拼接后的「左右镜像左右」当标签 */
    const labelOf = b => {
      const long = b.querySelector('.actLong')
      if (long && getComputedStyle(long).display !== 'none') return txt(long)
      const short = b.querySelector('.actShort')
      return short ? txt(short) : txt(b)
    }
    const labels = buttons.map(labelOf)
    step('桌面 / 平板工具行 8 颗按钮', buttons.length === 8, `count=${buttons.length}：${labels.join('/')}`)
    step('没有「上下镜像」', !labels.includes('上下镜像'), labels.join('/'))
    step('保留「左右镜像」', labels.includes('左右镜像'), labels.join('/'))

    /* 1440 三栏是设计目标：8 颗正好卡满一行。1320 / 834 放不下时按组换行，
       这里只要求「最多两行」，且没有按钮被挤出容器。 */
    const tops = buttons.map(b => Math.round(b.getBoundingClientRect().top))
    const rows = [...new Set(tops)].length
    step(innerWidth >= 1400 ? '1440 下工具行只有一行' : '工具行最多两行', innerWidth >= 1400 ? rows === 1 : rows <= 2,
      `rows=${rows} tops=${tops.join(',')}`)
    const gr = q('.toolgroup').getBoundingClientRect()
    const spill = buttons.some(b => b.getBoundingClientRect().right > gr.right + 1)
    step('按钮没有被挤出工具组', !spill)

    const mirrorBtn = buttons.find(b => labelOf(b) === '左右镜像')
    const before = cells()
    const toolBefore = S.tool.value
    mirrorBtn.click()
    await sleep(260)
    const after = cells()
    step('左右镜像真的水平翻转了图纸', same(after, flipH(before)))
    step('没有把图纸上下翻转', !same(after, flipV(before)) || same(before, flipV(before)))
    step('镜像不切换画笔', S.tool.value === toolBefore, S.tool.value)

    return { ok: steps.every(s => s.pass), steps, width: innerWidth }
  } catch (e) {
    return { ok: false, steps, err: e && e.message, stack: e && e.stack, width: innerWidth }
  }
})()
