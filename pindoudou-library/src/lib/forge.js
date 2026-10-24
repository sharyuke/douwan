/* =========================================================================
   展示层小工具：把真实数据翻译成界面文案
   放在这里的原因：难度色调、星级、百分比说明这类映射
   在多个页面都要用，集中一处避免各页写出不一致的标签。
   ========================================================================= */

import { formatDuration, difficultyOf, BOARD_SIZE } from './pattern.js'

export { formatDuration, difficultyOf }

/**
 * 存档里记的画布尺寸（格）。
 *
 * 为什么要这样一个函数：画布单位从「块」改成「格」之后，同一个作品列表里会
 * 同时存在两种存档 —— 老存档只有 boardCols/boardRows（块数），新存档是 canvasW/canvasH。
 * 列表页 / 切换作品弹窗如果各自写一遍换算，迟早有一处漏掉，表现就是「老作品显示 0×0 格」。
 * 顺带一提：不能拿 grid:29 去乘了事，精细档（300 / 450）本来就不是 29 的整数倍。
 */
export function projectCanvas(p) {
  const w = Number(p && p.canvasW)
  const h = Number(p && p.canvasH)
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { w, h }
  const c = Number(p && p.boardCols) || 1
  const r = Number(p && p.boardRows) || 1
  return { w: c * BOARD_SIZE, h: r * BOARD_SIZE }
}

/** 难度 → 标签色调 class */
export function difficultyTone(difficulty) {
  switch (difficulty) {
    case '入门': return 'free'
    case '简单': return 'new'
    case '进阶': return 'warn'
    case '挑战': return 'hot'
    default: return ''
  }
}

/** 可拼性分值 → 星级（PRD §6 差异化 2：AI 推荐：好拼版 ★★★★★） */
export function buildStars(score) {
  const n = Math.max(1, Math.min(5, Math.round(score / 20)))
  return { filled: n, empty: 5 - n, text: '★'.repeat(n) + '☆'.repeat(5 - n) }
}

/** 还原度 → 一句话评价，让百分比有意义 */
export function similarityLabel(sim) {
  const p = Math.round((Number(sim) || 0) * 100)
  if (p >= 94) return '几乎看不出与原图的差别'
  if (p >= 88) return '很接近原图'
  if (p >= 80) return '整体像，细节有取舍'
  if (p >= 70) return '神似，适合风格化'
  return '差异较明显，建议提高颜色数'
}

/** 可拼性 → 一句话评价 */
export function buildabilityLabel(score) {
  const s = Number(score) || 0
  if (s >= 92) return '换色少、孤立豆少，很快能拼完'
  if (s >= 84) return '拼起来顺，偶尔需要数格'
  if (s >= 72) return '细节较多，建议分板慢慢拼'
  return '细节密集，适合有经验时挑战'
}

/** 带正负号的百分比（方案对比用） */
export function signedPct(n) {
  const v = Math.round(Number(n) || 0)
  return (v > 0 ? '+' : '') + v + '%'
}

/** 数字千分位 */
export function num(n) {
  return Number(n || 0).toLocaleString()
}

/** 相对时间（作品列表用） */
export function timeAgo(ts) {
  const diff = Date.now() - Number(ts || 0)
  if (!Number.isFinite(diff) || diff < 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const date = new Date(Number(ts))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 文件体积（导出提示用） */
export function fileSize(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(2) + ' MB'
}
