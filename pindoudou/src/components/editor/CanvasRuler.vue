<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/* ============================================================================
   操作台标尺（设计稿 151:288 顶部标尺 / 151:412 左侧标尺 / 151:476 标尺原点）

   它不是画进图纸位图里的那一条 —— 位图里的标尺会跟着图纸一起缩放、平移、被裁掉。
   这一层是贴在画布视口顶边与左边上的覆盖层：位置永远不动，
   刻度按「当前一格有多少屏幕像素」换算，数字是格坐标
   （0 = 图纸左上角那条格线，负数是图纸外的留白），
   所以换成品尺寸 / 缩放 / 平移时数值实时跟着变。

   几何全部由父组件量好传进来（geom），这里只负责画。
   ========================================================================== */
const props = defineProps({
  /* { viewW, viewH, left, top, cell, cols, rows,
       artLeft, artTop, artW, artH, cmW, cmH } —— CSS 像素 / 格 / 厘米 */
  geom: { type: Object, default: null },
  /* 画布上的成品尺寸标注（W/H 尺寸线 + 厘米胶囊）：
     false = 只画刻度与数字，成品尺寸卡里的开关管它 */
  showSize: { type: Boolean, default: true }
})

const STRIP_H = 28 // 顶条高
const STRIP_W = 32 // 左条宽
const STRIP_BG = '#F5F8F3'
const TICK = '#E2DDD1'
const EDGE = '#C8D4C0'
const LABEL = '#7A9080'
const DIM = 'rgba(122,144,128,.7)'
const PILL_LINE = '#DDE5D8'
const PILL_INK = '#2A3C30'
const FONT = 'Noto Sans SC,PingFang SC,Microsoft YaHei,system-ui,sans-serif'

const cvs = ref(null)
/* 给自检脚本读的一份摘要：刻度间隔、格数、这一帧画出来的数字 */
const info = ref({ labels: '', cell: 0, cols: 0, rows: 0, tick: 0, label: 0, cm: '' })

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
/** 刻度间隔：格子再小也不让刻度挤成一片（最少 4px 一根） */
function tickStepFor(cell) {
  for (const s of STEPS) if (s * cell >= 4) return s
  return STEPS[STEPS.length - 1]
}
/** 标注间隔：数字之间至少留 80px，而且必须是刻度间隔的整数倍，
    否则「带数字的那条格线」会落在两根刻度中间 */
function labelStepFor(cell, tick) {
  for (const s of STEPS) {
    if (s < tick || s % tick !== 0) continue
    if (s * cell >= 80) return s
  }
  return tick
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h / 2, w / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

/** 「W 13.5 cm」那颗胶囊：白底 + 1px 浅绿描边（设计稿 151:657 / 151:660） */
function pillMetrics(ctx, key, value) {
  ctx.font = '400 10px ' + FONT
  const a = ctx.measureText(key).width
  ctx.font = '700 10px ' + FONT
  const b = ctx.measureText(value).width
  return { a, b, w: Math.ceil(8 + a + 6 + b + 8), h: 20 }
}
function paintPill(ctx, x, cy, key, value) {
  const m = pillMetrics(ctx, key, value)
  const px = Math.round(x)
  const py = Math.round(cy - m.h / 2)
  roundRect(ctx, px + 0.5, py + 0.5, m.w - 1, m.h - 1, (m.h - 1) / 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.strokeStyle = PILL_LINE
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = '400 10px ' + FONT
  ctx.fillStyle = LABEL
  ctx.fillText(key, px + 8, py + m.h / 2 + 0.5)
  ctx.font = '700 10px ' + FONT
  ctx.fillStyle = PILL_INK
  ctx.fillText(value, px + 8 + m.a + 6, py + m.h / 2 + 0.5)
  return m.w
}

function paint() {
  const el = cvs.value
  const g = props.geom
  if (!el) return
  if (!g || !(g.viewW > 1) || !(g.viewH > 1) || !(g.cell > 0)) {
    info.value = { labels: '', cell: 0, cols: 0, rows: 0, tick: 0, label: 0, cm: '' }
    return
  }
  const W = Math.round(g.viewW)
  const H = Math.round(g.viewH)
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
    el.width = Math.round(W * dpr)
    el.height = Math.round(H * dpr)
    el.style.width = W + 'px'
    el.style.height = H + 'px'
  }
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const cell = g.cell
  const tickStep = tickStepFor(cell)
  const labelStep = labelStepFor(cell, tickStep)

  /* 底：顶条 + 左条（不透明的，图纸放大到贴边时会被它挡住，读数才清楚） */
  ctx.fillStyle = STRIP_BG
  ctx.fillRect(0, 0, W, STRIP_H)
  ctx.fillRect(0, STRIP_H, STRIP_W, H - STRIP_H)

  /* ---- 顶条：每格一根短刻度，每 labelStep 格一根长刻度 + 数字 ---- */
  const labels = []
  ctx.save()
  ctx.beginPath()
  ctx.rect(STRIP_W, 0, Math.max(0, W - STRIP_W), STRIP_H - 1)
  ctx.clip()
  const i0 = Math.ceil(-g.left / cell)
  const i1 = Math.floor((W - g.left) / cell)
  ctx.fillStyle = TICK
  for (let i = i0; i <= i1; i++) {
    if (i % tickStep !== 0) continue
    const x = Math.round(g.left + i * cell)
    const major = i % labelStep === 0
    ctx.fillRect(x, major ? STRIP_H - 12 : STRIP_H - 6, 1, major ? 12 : 6)
  }
  ctx.font = '400 10px ' + FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = LABEL
  for (let i = i0; i <= i1; i++) {
    if (i % labelStep !== 0) continue
    const x = Math.round(g.left + i * cell)
    const text = String(i)
    if (x + 4 + ctx.measureText(text).width > W - 4) continue
    ctx.fillText(text, x + 4, 8)
    labels.push(i)
  }
  ctx.restore()

  /* ---- 左条：同一套刻度，数字贴着左边排 ---- */
  const rowLabels = []
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, STRIP_H, STRIP_W - 1, Math.max(0, H - STRIP_H))
  ctx.clip()
  const j0 = Math.ceil(-g.top / cell)
  const j1 = Math.floor((H - g.top) / cell)
  ctx.fillStyle = TICK
  for (let j = j0; j <= j1; j++) {
    if (j % tickStep !== 0) continue
    const y = Math.round(g.top + j * cell)
    const major = j % labelStep === 0
    ctx.fillRect(major ? STRIP_W - 13 : STRIP_W - 7, y, major ? 13 : 7, 1)
  }
  ctx.font = '400 10px ' + FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = LABEL
  for (let j = j0; j <= j1; j++) {
    if (j % labelStep !== 0) continue
    const y = Math.round(g.top + j * cell) + 10
    if (y + 6 > H) continue
    ctx.fillText(String(j), 3, y)
    rowLabels.push(j)
  }
  ctx.restore()

  /* ---- 两条边线 ---- */
  ctx.fillStyle = EDGE
  ctx.fillRect(STRIP_W, STRIP_H - 1, Math.max(0, W - STRIP_W), 1)
  ctx.fillRect(STRIP_W - 1, STRIP_H, 1, Math.max(0, H - STRIP_H))

  /* ---- 标尺原点（设计稿 151:476）---- */
  ctx.font = '400 10px ' + FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = LABEL
  ctx.fillText('格', 8, STRIP_H / 2)

  /* ---- 成品宽度 / 高度标注：贴着成品区域画，读数跟着成品尺寸走 ----
     开关关掉时整块跳过（info.cm 仍照算，那只是几何读数，不是画面） */
  if (props.showSize) {
    const artL = g.artLeft
    const artT = g.artTop
    const artR = artL + g.artW
    const artB = artT + g.artH
    ctx.fillStyle = DIM
    const dimY = 20
    const wFrom = Math.max(STRIP_W, Math.round(artL))
    const wTo = Math.min(W, Math.round(artR))
    if (wTo - wFrom > 2) {
      ctx.fillRect(wFrom, dimY, wTo - wFrom, 1)
      if (artL >= STRIP_W) ctx.fillRect(Math.round(artL), dimY - 5, 1, 11)
      if (artR <= W) ctx.fillRect(Math.round(artR), dimY - 5, 1, 11)
    }
    const dimX = Math.round(artL - 14)
    if (dimX > STRIP_W + 2) {
      const hFrom = Math.max(STRIP_H, Math.round(artT))
      const hTo = Math.min(H, Math.round(artB))
      if (hTo - hFrom > 2) {
        ctx.fillRect(dimX, hFrom, 1, hTo - hFrom)
        if (artT >= STRIP_H) ctx.fillRect(dimX - 5, Math.round(artT), 11, 1)
        if (artB <= H) ctx.fillRect(dimX - 5, Math.round(artB), 11, 1)
      }
    }
    const cmW = g.cmW.toFixed(1) + ' cm'
    const cmH = g.cmH.toFixed(1) + ' cm'
    if (g.artW >= 120) {
      const m = pillMetrics(ctx, 'W', cmW)
      const cx = artL + g.artW / 2
      let px = cx - m.w / 2
      px = Math.max(STRIP_W + 4, Math.min(W - m.w - 4, px))
      paintPill(ctx, px, dimY, 'W', cmW)
    }
    if (g.artH >= 120 && dimX > STRIP_W + 2) {
      const m = pillMetrics(ctx, 'H', cmH)
      let px = dimX - 12 - m.w
      if (px < STRIP_W + 4) px = dimX + 12
      const cy = artT + g.artH / 2
      if (px + m.w < W - 4 && cy > STRIP_H + 12 && cy < H - 12) paintPill(ctx, px, cy, 'H', cmH)
    }
  }

  info.value = {
    labels: labels.join(','),
    rows: rowLabels.join(','),
    cell: Math.round(cell * 100) / 100,
    cols: g.cols,
    gridRows: g.rows,
    tick: tickStep,
    label: labelStep,
    cm: g.cmW.toFixed(1) + ' × ' + g.cmH.toFixed(1) + ' cm'
  }
}

watch(() => [props.geom, props.showSize], paint, { flush: 'post' })
onMounted(paint)
onBeforeUnmount(() => { info.value = { labels: '', cell: 0, cols: 0, rows: 0, tick: 0, label: 0, cm: '' } })
</script>

<template>
  <div
    class="cr" aria-hidden="true"
    data-canvas-ruler
    :data-ruler-dim="showSize ? 'on' : 'off'"
    :data-ruler-labels="info.labels"
    :data-ruler-row-labels="info.rows"
    :data-ruler-cell="info.cell"
    :data-ruler-cols="info.cols"
    :data-ruler-rows="info.gridRows"
    :data-ruler-tick="info.tick"
    :data-ruler-label-step="info.label"
    :data-ruler-cm="info.cm"
  >
    <canvas ref="cvs" class="cr__canvas"></canvas>
  </div>
</template>

<style scoped>
/* 覆盖层只负责画，不吃指针事件：标尺下面的格子照样能画 */
.cr{position:absolute;inset:0;z-index:5;pointer-events:none}
.cr__canvas{display:block}
</style>
