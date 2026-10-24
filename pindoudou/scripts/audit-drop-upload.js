/* =========================================================================
   自检探针：把图片拖到工作台画布栏就能上传
   用法：node scripts/audit.cjs --eval-file scripts/audit-drop-upload.js /editor

   为什么需要它：拖放是浏览器事件，改代码时最容易「看着接了、其实没接」——
   dragover 没 preventDefault、dragleave 计数没配对、拖文字也弹提示层，
   这些都不会报错。这里用真的 DragEvent + 真的 File 走完整条链路，
   以「图纸真的换了 + 源图名变了」为证据。

     · 拖文件进画布栏 → 出现「松开即可上传图片」提示层；
     · 松手 → 图纸重新生成、源图名变成文件名、提示层消失；
     · 拖纯文字 → 不出现提示层（不能接管所有拖拽）；
     · 拖非图片文件 → 给出「请选择图片文件」提示，图纸保持不变。
   ========================================================================= */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const col = document.querySelector('.studio__canvas')
  if (!col) return { ok: false, err: '画布栏没找到' }

  const veil = () => document.querySelector('.dropVeil')
  const veilText = () => (veil() ? veil().innerText.replace(/\s+/g, ' ').trim() : '')
  const fire = (type, dt) => col.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))

  /* 一张真的 PNG：用画布画，避免依赖仓库里的测试图 */
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#F03D2E'
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#2F6BFF'
  ctx.fillRect(8, 8, 28, 28)
  const blob = await new Promise(r => c.toBlob(r, 'image/png'))
  const file = new File([blob], 'drop-test.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)

  const out = { ok: true }

  /* ① 拖纯文字：不能出现提示层（否则页面里所有拖拽都被接管） */
  const textDt = new DataTransfer()
  textDt.setData('text/plain', 'hello')
  fire('dragenter', textDt)
  fire('dragover', textDt)
  await sleep(80)
  out.textDragQuiet = !veil()
  fire('drop', textDt)
  await sleep(80)

  /* ② 拖文件：提示层出现，文案要说清楚 */
  fire('dragenter', dt)
  fire('dragover', dt)
  await sleep(80)
  out.veilShown = !!veil()
  out.veilText = veilText()

  /* ③ 松手：真的换图（源图名 = 文件名），提示层收起 */
  const beforeName = S.sourceName.value
  fire('drop', dt)
  let changed = false
  const t0 = performance.now()
  while (performance.now() - t0 < 15000) {
    if (S.sourceName.value === 'drop-test' && S.pattern.value) { changed = true; break }
    await sleep(120)
  }
  out.droppedName = S.sourceName.value
  out.nameChanged = beforeName !== S.sourceName.value
  out.pattern = S.pattern.value ? `${S.pattern.value.width}×${S.pattern.value.height}` : ''
  out.changed = changed
  await sleep(200)
  out.veilGone = !veil()

  /* ④ 非图片：给提示、不换图 */
  const nameAfterImage = S.sourceName.value
  const txt = new File(['not an image'], 'note.txt', { type: 'text/plain' })
  const dt2 = new DataTransfer()
  dt2.items.add(txt)
  fire('dragenter', dt2)
  fire('dragover', dt2)
  await sleep(60)
  fire('drop', dt2)
  await sleep(500)
  out.txtToast = [...document.querySelectorAll('.toast')]
    .map(t => t.innerText.replace(/\s+/g, ' ').trim())
    .find(t => /请选择图片文件/.test(t)) || ''
  out.txtKeptPattern = S.sourceName.value === nameAfterImage
  out.txtVeilGone = !veil()

  out.ok = out.textDragQuiet && out.veilShown && /松开即可上传图片/.test(out.veilText) &&
    out.changed && out.nameChanged && out.veilGone &&
    /请选择图片文件/.test(out.txtToast) && out.txtKeptPattern && out.txtVeilGone
  return out
})()
