/* =========================================================================
   导出图纸统一标版（需求《豆玩导出图纸完整交付包》V1.0）
   -------------------------------------------------------------------------
   新手版第 ③ 步「下载拼豆图纸」与专业工作台「图纸交付」的整图导出
   （PNG / JPG，含按 DPI 高清导出）共用这一套标版，一条链路、一种版式：

     · 页眉：豆玩 Logo + 显眼的网址 dw.sharyuke.com（橙→粉渐变粗体）
     · 主视觉：完整图纸（行列坐标、每格色号、10 格强调线由 drawChart 负责）
     · 下方左「图案信息」：成品尺寸 / 格子数量 / 钉板型号 / 钉板数量与排列 /
       需要豆子总数 / 颜色数量 / 色卡品牌及型号（全部按当前图纸真实统计）
     · 下方右「颜色清单」：色块 + 色号 + 颗数，按数量降序，多列铺开
     · 页脚：Slogan「所爱皆可拼，万物皆可造」

   约束（来自交付规范 §3 / §6）：
     · 图纸是绝对主视觉，页眉 / 页脚 / 材料区只占必要空间；
     · 布局优先级：每格色号可读性 > 图纸面积 > 材料清单完整 > 装饰；
     · 白色页面、细粉描边、装饰克制；不遮挡图纸、不伪造任何统计数字。
   ========================================================================= */

import { materialList, boardLayout } from './pattern.js'
import { normalizeBoardSize, beadOf, boardOf as boardDefOf } from './boardSpec.js'
import { getBrand } from './palettes.js'
import logoUrl from '../assets/logo-douwan.webp'

/** 页眉唯一网址（交付规范 §2：唯一正确的网站 URL） */
export const SITE_URL_TEXT = 'dw.sharyuke.com'
/** 页脚唯一 Slogan（交付规范 §2，字词必须完全准确） */
export const SLOGAN_TEXT = '所爱皆可拼，万物皆可造'

const FONT = '-apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif'

/* ---------------------------------------------------------------- 品牌色板

   与站内品牌令牌一致（global.css：--primary #F03D2E、--grad-logo #FFD62E→#FFC400），
   粉色系来自视觉参考（细粉描边 + 浅粉点缀），打印对比度都按「深字浅底」配。 */
const BRAND_RED = '#F03D2E'
const DOMAIN_GRAD = ['#F59F00', '#E64980']
const CARD_BORDER = '#F3C4D1'
const HEADER_BG = '#FFF7FA'
const PILL_STYLES = [
  { bg: '#FBDEE7', fg: '#B02A5B' },
  { bg: '#DCEBFB', fg: '#1864AB' },
  { bg: '#D9F1E3', fg: '#2B8A3E' },
  { bg: '#FFF3BF', fg: '#A6690A' },
  { bg: '#E9E1FA', fg: '#6741D9' },
  { bg: '#FFE8D9', fg: '#C44A0A' },
  { bg: '#FBDEE7', fg: '#B02A5B' }
]

/* ---------------------------------------------------------------- Logo 预载

   webp 在 canvas 上直接 drawImage 即可。模块加载时就开始拉，
   用户点导出时基本早就绪；万一还没就绪，页眉照常画（Logo 位留白），
   下一次导出自然补上 —— 不能为等一张图把整条导出链路改成异步。 */
let logoImg = null
if (typeof Image !== 'undefined') {
  logoImg = new Image()
  logoImg.src = logoUrl
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, rr)
    return
  }
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/* ---------------------------------------------------------------- 统计口径 */

function boardFacts(pattern) {
  const bs = normalizeBoardSize(pattern && pattern.boardSize, pattern && pattern.width, pattern && pattern.height)
  const def = boardDefOf(bs.x)
  const lay = boardLayout(pattern.width, pattern.height, bs)
  return {
    bs,
    def,
    spec: def && !def.legacy ? def.label : `老规格方板（${bs.x} 格）`,
    cols: lay.cols,
    rows: lay.rows,
    count: lay.count
  }
}

/** 「图案信息」卡的行 [{label, value}]；数据全部来自当前图纸的真实统计 */
function infoRowsOf(pattern, mats) {
  const bead = beadOf(pattern.beadKey)
  const artW = pattern.artW || pattern.width
  const artH = pattern.artH || pattern.height
  const b = boardFacts(pattern)
  const empty = pattern.stats && pattern.stats.emptyCount
  const cellsText = `${pattern.width} × ${pattern.height}（${(pattern.width * pattern.height).toLocaleString()} 格${empty ? ` · 空白 ${empty.toLocaleString()}` : ''}）`
  const brandName = (getBrand(pattern.brandId) || {}).name || ''
  return [
    { label: '成品尺寸', value: `${(artW * bead.cm).toFixed(1)} × ${(artH * bead.cm).toFixed(1)} cm（${bead.label}）` },
    { label: '格子数量', value: cellsText },
    { label: '钉板型号', value: b.spec },
    { label: '钉板数量', value: `${b.count} 块（${b.cols} × ${b.rows}）` },
    { label: '需要豆子总数', value: `${mats.totalBeads.toLocaleString()} 颗` },
    { label: '颜色数量', value: `${mats.colorCount} 种` },
    { label: '色卡品牌及型号', value: brandName || '—' }
  ]
}

/* ---------------------------------------------------------------- 版式尺寸

   页面宽度 = max(图纸宽度, 1000)：小图纸也有一个能放下两栏材料区的版面；
   大图纸（cell 大）以图纸宽度为准，材料区跟着撑开。
   templateExtraHeight 与 composeExportTemplate 必须用同一套尺寸函数，
   否则「dpiExportPlan 预检的尺寸」和「实际文件尺寸」会对不上。 */

const PAGE_MARGIN = 28
const HEADER_H = 104
const HEADER_GAP = 22
const FOOTER_H = 62
const CARD_GAP = 20
const INFO_CARD_W = 430
const CARD_PAD = 18
const CARD_TITLE_H = 40
const INFO_ROW_H = 38
const COLOR_ROW_H = 30

export const EXPORT_PAGE_MIN_WIDTH = 1000

export function exportPageWidth(pattern, chartWidth) {
  return Math.max(Math.ceil(chartWidth || 0), EXPORT_PAGE_MIN_WIDTH)
}

function colorsLayout(width, rows) {
  const cardW = width - PAGE_MARGIN * 2 - INFO_CARD_W - CARD_GAP
  const cols = Math.max(1, Math.min(4, Math.floor((cardW - CARD_PAD * 2) / 225)))
  return { cardW, cols, rows: Math.ceil(rows.length / cols) }
}

/**
 * 标版在图纸主体之外增加的高度（页眉 + 材料区 + 页脚 + 间距）。
 * dpiExportPlan('full') 用它算总尺寸并决定要不要降 cell；
 * composeExportTemplate 用同一套函数排版，两处永不失配。
 */
export function templateExtraHeight(pattern, width, { includeLegend = true, includeStats = true } = {}) {
  const pageW = exportPageWidth(pattern, width)
  const mats = materialList(pattern, null)
  const infoH = includeStats ? CARD_PAD * 2 + CARD_TITLE_H + infoRowsOf(pattern, mats).length * INFO_ROW_H : 0
  const cl = includeLegend ? colorsLayout(pageW, mats.rows) : null
  const colorH = cl ? CARD_PAD * 2 + CARD_TITLE_H + cl.rows * COLOR_ROW_H : 0
  const bottomH = Math.max(infoH, colorH)
  return PAGE_MARGIN + HEADER_H + HEADER_GAP + (bottomH ? bottomH + CARD_GAP : 0) + FOOTER_H + PAGE_MARGIN
}

/* ---------------------------------------------------------------- 页眉 / 页脚 */

/**
 * 页眉：白卡 + 细粉描边；左 Logo、右域名（橙→粉渐变粗体，比表格文字醒目得多）。
 * 返回消耗的高度（固定 HEADER_H）。
 */
export function drawTemplateHeader(ctx, { x = 0, y = 0, width }) {
  ctx.save()
  ctx.fillStyle = HEADER_BG
  roundRectPath(ctx, x, y, width, HEADER_H, 18)
  ctx.fill()
  ctx.strokeStyle = CARD_BORDER
  ctx.lineWidth = 2
  ctx.stroke()

  /* Logo：按原始比例 contain 到高 64px 的区域里，绝不拉伸变形 */
  const logoH = 64
  const padX = 24
  let drawW = 0
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    const k = logoH / logoImg.naturalHeight
    drawW = Math.round(logoImg.naturalWidth * k)
    ctx.drawImage(logoImg, x + padX, y + (HEADER_H - logoH) / 2, drawW, logoH)
  }

  /* 域名：渐变粗体、右对齐；保证打印对比度（不用低对比浅粉小字） */
  ctx.font = `800 40px ${FONT}`
  ctx.textBaseline = 'middle'
  const tw = ctx.measureText(SITE_URL_TEXT).width
  const grad = ctx.createLinearGradient(x + width - padX - tw, 0, x + width - padX, 0)
  grad.addColorStop(0, DOMAIN_GRAD[0])
  grad.addColorStop(1, DOMAIN_GRAD[1])
  ctx.fillStyle = grad
  ctx.textAlign = 'left'
  ctx.fillText(SITE_URL_TEXT, x + width - padX - tw, y + HEADER_H / 2 + 2)
  ctx.restore()
  return HEADER_H
}

/**
 * 页脚：居中 Slogan，两侧短线装饰。装饰克制、省墨，不抢图纸。
 */
export function drawTemplateSlogan(ctx, { x = 0, y = 0, width, height = FOOTER_H }) {
  ctx.save()
  ctx.font = `800 26px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = BRAND_RED
  const tw = ctx.measureText(SLOGAN_TEXT).width
  const cx = x + width / 2
  const cy = y + height / 2
  ctx.fillText(SLOGAN_TEXT, cx - tw / 2, cy)
  ctx.strokeStyle = '#EFA8BC'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  const gap = 22
  const line = 46
  ;[-1, 1].forEach(s => {
    const x1 = cx + s * (tw / 2 + gap)
    const x2 = x1 + s * line
    ctx.beginPath()
    ctx.moveTo(Math.min(x1, x2), cy)
    ctx.lineTo(Math.max(x1, x2), cy)
    ctx.stroke()
    ctx.fillStyle = '#F2B9CB'
    ctx.beginPath()
    ctx.arc(x2 + s * 10, cy, 4, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.restore()
  return height
}

/* ---------------------------------------------------------------- 材料区两卡 */

function drawCardTitle(ctx, text, x, y) {
  /* 小立方体图标（品牌渐变圆角方块）+ 标题 */
  ctx.save()
  const s = 20
  const g = ctx.createLinearGradient(x, y, x + s, y + s)
  g.addColorStop(0, '#FFD62E')
  g.addColorStop(1, '#FFC400')
  ctx.fillStyle = g
  roundRectPath(ctx, x, y + 4, s, s, 6)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,.35)'
  ctx.fillRect(x + 4, y + 8, s - 8, 5)

  ctx.font = `800 20px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#B02A5B'
  ctx.fillText(text, x + s + 10, y + 14)
  ctx.restore()
}

function drawInfoCard(ctx, pattern, mats, x, y, w, h) {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  roundRectPath(ctx, x, y, w, h, 16)
  ctx.fill()
  ctx.strokeStyle = CARD_BORDER
  ctx.lineWidth = 1.5
  ctx.stroke()
  drawCardTitle(ctx, '图案信息', x + CARD_PAD, y + CARD_PAD)

  const rows = infoRowsOf(pattern, mats)
  const labelW = 150
  rows.forEach((r, i) => {
    const ry = y + CARD_PAD + CARD_TITLE_H + i * INFO_ROW_H
    const style = PILL_STYLES[i % PILL_STYLES.length]
    ctx.fillStyle = style.bg
    roundRectPath(ctx, x + CARD_PAD, ry, labelW, 28, 14)
    ctx.fill()
    ctx.font = `600 13px ${FONT}`
    ctx.fillStyle = style.fg
    ctx.textBaseline = 'middle'
    ctx.fillText(r.label, x + CARD_PAD + 14, ry + 14)

    ctx.font = `700 14px ${FONT}`
    ctx.fillStyle = '#1B1B1F'
    ctx.fillText(r.value, x + CARD_PAD + labelW + 14, ry + 14)
  })
  ctx.restore()
}

function drawColorsCard(ctx, mats, x, y, w, h, cols) {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  roundRectPath(ctx, x, y, w, h, 16)
  ctx.fill()
  ctx.strokeStyle = CARD_BORDER
  ctx.lineWidth = 1.5
  ctx.stroke()

  /* 标题行：左标题、右「共 N 种颜色 · 总颗数对得上」 */
  ctx.font = `13px ${FONT}`
  const note = `实际统计，共 ${mats.colorCount} 种颜色`
  const noteW = ctx.measureText(note).width
  const titleY = y + CARD_PAD
  drawCardTitle(ctx, '颜色清单', x + CARD_PAD, titleY)
  ctx.font = `13px ${FONT}`
  ctx.fillStyle = '#9A8A93'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  ctx.fillText(note, x + w - CARD_PAD, titleY + 15)
  ctx.textAlign = 'left'

  const colW = (w - CARD_PAD * 2) / cols
  mats.rows.forEach((r, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const ry = y + CARD_PAD + CARD_TITLE_H + row * COLOR_ROW_H
    const rx = x + CARD_PAD + col * colW
    const chip = 16
    ctx.fillStyle = r.hex
    roundRectPath(ctx, rx, ry + 3, chip, chip, 4)
    ctx.fill()
    ctx.strokeStyle = 'rgba(28,28,32,.18)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.font = `700 13px ${FONT}`
    ctx.fillStyle = '#1B1B1F'
    ctx.textBaseline = 'middle'
    ctx.fillText(r.code, rx + chip + 8, ry + 11)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#6B6B73'
    ctx.font = `13px ${FONT}`
    ctx.fillText(r.count.toLocaleString(), rx + colW - 10, ry + 11)
    ctx.textAlign = 'left'
  })
  ctx.restore()
}

/* ---------------------------------------------------------------- 组装 */

/**
 * 把「图纸主体」与标版（页眉 / 材料区 / 页脚）拼到一张画布上。
 *
 * chartCanvas 是 buildPatternImageCanvas 里 drawChart 画好的主体，
 * 尺寸必然等于 plan.geometry（那边已做过尺寸对账）。
 * 返回整页画布；includeStats / includeLegend 关掉时对应卡片省略，
 * 两个都关掉时只保留页眉 + 页脚（此时调用方一般根本不走这条模板）。
 */
export function composeExportTemplate(pattern, chartCanvas, plan, {
  includeLegend = true,
  includeStats = true,
  projectName = ''
} = {}) {
  const g = plan.geometry
  const pageW = exportPageWidth(pattern, g.width)
  const extraH = templateExtraHeight(pattern, g.width, { includeLegend, includeStats })
  const out = document.createElement('canvas')
  out.width = pageW
  out.height = g.height + extraH
  const ctx = out.getContext('2d')

  /* 白色页面 + 四周细粉描边圆角框（规范 §3：白色页面、细粉描边、柔和圆角） */
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  const framePad = 10
  ctx.strokeStyle = CARD_BORDER
  ctx.lineWidth = 2
  roundRectPath(ctx, framePad, framePad, pageW - framePad * 2, out.height - framePad * 2, 20)
  ctx.stroke()

  /* 页眉 */
  let y = PAGE_MARGIN
  drawTemplateHeader(ctx, { x: PAGE_MARGIN, y, width: pageW - PAGE_MARGIN * 2 })
  y += HEADER_H + HEADER_GAP

  /* 图纸：绝对主视觉，横向居中，不缩放不裁切 */
  ctx.drawImage(chartCanvas, Math.round((pageW - g.width) / 2), y)
  y += g.height

  /* 材料区：左「图案信息」右「颜色清单」；只开其一则独占整行 */
  const mats = materialList(pattern, null)
  const infoH = includeStats ? CARD_PAD * 2 + CARD_TITLE_H + infoRowsOf(pattern, mats).length * INFO_ROW_H : 0
  const cl = includeLegend ? colorsLayout(pageW, mats.rows) : null
  const colorH = cl ? CARD_PAD * 2 + CARD_TITLE_H + cl.rows * COLOR_ROW_H : 0
  const bottomH = Math.max(infoH, colorH)
  if (bottomH) {
    y += CARD_GAP
    if (includeStats) {
      const w = includeLegend ? INFO_CARD_W : pageW - PAGE_MARGIN * 2
      drawInfoCard(ctx, pattern, mats, PAGE_MARGIN, y, w, bottomH)
    }
    if (includeLegend) {
      const w = cl.cardW
      const x = includeStats ? PAGE_MARGIN + INFO_CARD_W + CARD_GAP : PAGE_MARGIN
      drawColorsCard(ctx, mats, x, y, w, bottomH, cl.cols)
    }
    y += bottomH
  }

  /* 页脚 Slogan */
  drawTemplateSlogan(ctx, { x: 0, y: y + CARD_GAP, width: pageW })
  return out
}
