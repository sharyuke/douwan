/* 自检探针：「智能减色 / 自动合并相近色」已整体移除，转换回到最初算法。
   用法：
     node scripts/audit.cjs --eval-file scripts/audit-smart-removed.js --page editor
     node scripts/audit.cjs --eval-file scripts/audit-smart-removed.js --page editor --url https://dw.sharyuke.com

   同一份探针两种口径：
   · 新版（本地预览 / 部署后）：断言 smartColors 选项、图纸 smart 字段、
     界面「智能减色」开关、生成说明全部不存在；
   · 老版（线上还带开关的构建）：把 smartColors 置 false 走最初算法，
     输出同一张图的指纹（色号表 / cells 校验和 / 统计量）。
   两边指纹逐项一致 = 新版输出 == 老版关闭智能减色的输出（最初的贴近原图算法）。 */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 10000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      if (fn()) return true
      await sleep(60)
    }
    return false
  }

  /* 老构建（线上）还有智能减色：置 false，让两边都走最初算法路径 */
  const oldBuild = Object.prototype.hasOwnProperty.call(S.options, 'smartColors')
  if (oldBuild) S.options.smartColors = false

  /* 上传一张带渐变 + 多个色块的测试图（走真实 file input，与用户上传同一条链路） */
  const cv = document.createElement('canvas')
  cv.width = 260
  cv.height = 200
  const cx = cv.getContext('2d')
  const grad = cx.createLinearGradient(0, 0, 260, 0)
  grad.addColorStop(0, '#123B6D')
  grad.addColorStop(0.5, '#3FA9A0')
  grad.addColorStop(1, '#F2D8A7')
  cx.fillStyle = grad
  cx.fillRect(0, 0, 260, 200)
  const blobs = [['#E4572E', 60, 60, 34], ['#5B3A78', 190, 70, 26], ['#F4F6F8', 120, 140, 30], ['#17263F', 210, 160, 18]]
  for (const [c, x, y, r] of blobs) {
    cx.fillStyle = c
    cx.beginPath()
    cx.arc(x, y, r, 0, Math.PI * 2)
    cx.fill()
  }
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'))
  const file = new File([blob], 'audit-smart-removed.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))

  const got = await waitFor(() => S.pattern.value && S.pattern.value.stats.beadCount > 0)
  let via = 'upload'
  if (!got) {
    /* 平板（老右栏版面）的上传入口要先进弹窗，直接塞 file input 不出图 ——
       与 audit-create 在平板上的表现一致（探针层局限，不是应用坏了）。
       兜底改走素材库，保证四个视口都能拿到指纹。 */
    const A = await d.assets()
    const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
    await S.useAsset(asset)
    via = `asset:${asset.id}`
    await waitFor(() => S.pattern.value && S.pattern.value.stats.beadCount > 0)
    if (!S.pattern.value) return { ok: false, err: '上传与素材库都没有出图' }
  }

  const p = S.pattern.value
  let sum = 0
  for (let i = 0; i < p.cells.length; i++) {
    sum = (sum * 31 + (p.cells[i] + 2)) % 0xffffffff
  }

  const out = { ok: true, build: oldBuild ? 'old(smart-off)' : 'new', via, fingerprint: {
    codes: p.palette.map(c => c.code).join(','),
    cells: p.cells.length,
    colors: p.stats.colorCount,
    beads: p.stats.beadCount,
    empty: p.stats.emptyCount,
    similarity: p.stats.similarity,
    deltaE: p.stats.deltaE,
    cellsChecksum: sum,
    notes: (p.notes || []).join(' | ')
  } }

  if (!oldBuild) {
    out.removed = {
      optionGone: !Object.prototype.hasOwnProperty.call(S.options, 'smartColors'),
      patternFieldGone: !Object.prototype.hasOwnProperty.call(p, 'smart'),
      uiGone: !(document.body.textContent || '').includes('智能减色'),
      noteClean: !(p.notes || []).some(n => n.includes('智能减色'))
    }
    for (const k of Object.keys(out.removed)) {
      if (!out.removed[k]) { out.ok = false; out.failAt = k }
    }
  }
  return out
})()
