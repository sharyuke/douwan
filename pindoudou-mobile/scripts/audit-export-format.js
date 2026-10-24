/* 导出格式自检（需求 §4.7）：
   - 浏览器能真实编码 JPG（不是只改扩展名）
   - PNG「透明背景」真的保留 alpha，白底时真的不透明
   图案可能铺满整张画布，所以这里先把左上角 4 格改成空格（-1），
   再检查透明导出在这几格上是 alpha=0、白底导出是 alpha=255。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
         --eval-file scripts/audit-export-format.js --page editorProject */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const p = S.pattern.value
  if (!p) return { ok: false, err: '预置作品没有图纸' }

  /* 复制一份并把左上角 4 格挖空，专门验证透明背景 */
  const q = { ...p, cells: p.cells.slice() }
  for (let i = 0; i < 4; i++) q.cells[i] = -1

  const base = {
    format: 'png', cell: 12, ruler: false, grid: false, codes: false,
    includeLegend: false, includeStats: false
  }

  const jpg = d.exporters.buildPatternImageCanvas(q, {
    ...base, format: 'jpg', background: 'transparent'
  })
  if (!jpg.ok) return { ok: false, err: jpg.message || 'JPG 画布生成失败' }
  const jpgUrl = jpg.canvas.toDataURL('image/jpeg', 0.92)

  const pngT = d.exporters.buildPatternImageCanvas(q, { ...base, background: 'transparent' })
  if (!pngT.ok) return { ok: false, err: pngT.message || 'PNG 画布生成失败' }
  const tData = pngT.canvas.getContext('2d').getImageData(0, 0, pngT.canvas.width, pngT.canvas.height).data
  let transparent = 0
  for (let i = 3; i < tData.length; i += 4) if (tData[i] === 0) transparent++
  const cornerAlpha = tData[3]

  const pngW = d.exporters.buildPatternImageCanvas(q, { ...base, background: '#ffffff' })
  if (!pngW.ok) return { ok: false, err: pngW.message || 'PNG 白底画布生成失败' }
  const wData = pngW.canvas.getContext('2d').getImageData(0, 0, pngW.canvas.width, pngW.canvas.height).data
  let whiteTransparent = 0
  for (let i = 3; i < wData.length; i += 4) if (wData[i] === 0) whiteTransparent++

  const checks = {
    JPG编码前缀: jpgUrl.slice(0, 30),
    JPG数据长度: jpgUrl.length,
    JPG尺寸: `${jpg.canvas.width}×${jpg.canvas.height}`,
    PNG透明像素数: transparent,
    PNG左上角alpha: cornerAlpha,
    PNG总像素数: pngT.canvas.width * pngT.canvas.height,
    PNG白底透明像素数: whiteTransparent,
    PNG尺寸: `${pngT.canvas.width}×${pngT.canvas.height}`
  }
  return {
    ok: jpgUrl.startsWith('data:image/jpeg') && jpgUrl.length > 1000 &&
      transparent > 0 && cornerAlpha === 0 && whiteTransparent === 0,
    checks
  }
})()
