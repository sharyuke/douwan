/* 导出设置与预览自检（需求 §4.7）：
   - 打开「更多…」后，预览画布必须真的画出东西
   - 图例 / 统计 / 坐标 / 网格开关要能改变预览
   - 图纸 PNG / JPG 两个入口存在
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-export-preview.js --page editorProject */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  if (!S.hasPattern.value) return { ok: false, err: '预置作品没有生成图纸' }

  const findButton = text => [...document.querySelectorAll('button')]
    .find(b => (b.textContent || '').trim() === text)
  const more = findButton('更多…')
  if (!more) return { ok: false, err: '找不到「更多…」按钮' }
  more.click()
  await sleep(700)

  const preview = document.querySelector('.exportPreview canvas')
  const previewHint = document.querySelector('.exportPreview .hint')
  const settings = document.querySelector('.exportSettings')
  if (!preview || !settings) return { ok: false, err: '导出弹窗里没有预览或设置区' }

  const blank = (() => {
    const ctx = preview.getContext('2d')
    const { data } = ctx.getImageData(0, 0, preview.width, preview.height)
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++
    return opaque === 0
  })()

  const toggles = {}
  for (const label of settings.querySelectorAll('label')) {
    const text = (label.textContent || '').trim()
    const input = label.querySelector('input[type=checkbox]')
    if (input) toggles[text] = input
  }
  const before = { w: preview.width, h: preview.height }
  const legend = toggles['颜色图例']
  if (legend) {
    legend.click()
    await sleep(600)
  }
  const afterLegend = { w: preview.width, h: preview.height }

  const stats = toggles['材料统计']
  if (stats) {
    stats.click()
    await sleep(600)
  }
  const afterStats = { w: preview.width, h: preview.height }

  const items = [...document.querySelectorAll('.exportGrid .exportItem b')].map(b => b.textContent.trim())
  const hasPNG = items.includes('图纸 PNG')
  const hasJPG = items.includes('图纸 JPG')

  const out = {
    ok: true,
    checks: {
      预览尺寸: before,
      预览空白: blank,
      预览说明: previewHint ? previewHint.textContent.trim() : '',
      开关项: Object.keys(toggles),
      关掉图例后: afterLegend,
      再关掉统计后: afterStats,
      导出入口: items,
      有PNG: hasPNG,
      有JPG: hasJPG
    }
  }
  if (blank) out.ok = false
  if (!hasPNG || !hasJPG) out.ok = false
  if (afterLegend.h >= before.h) out.ok = false
  if (afterStats.h >= afterLegend.h) out.ok = false
  return out
})()
