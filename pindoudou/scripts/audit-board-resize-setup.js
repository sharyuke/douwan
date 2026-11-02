/* 自检预置：只跳过新手指引浮层（audit-board-resize.js 要往画布上真拖一笔，
   指引层盖在画布上时指针事件落不到格子上）。 */
(async () => {
  try { localStorage.setItem('douwan.guide.v1', '1') } catch { /* 忽略 */ }
  return { ok: true, guide: 'off' }
})()
