<script setup>
/**
 * 像素图标：优先使用 ui完整交付包 里的彩色 SVG 像素图标（12×12），
 * 缺失的图标回落到项目内的单色网格，并按语义补上深色描边与品牌色。
 * 颜色来自图标本身（交付包规范），不再依赖 currentColor；
 * 需要单色的地方传 mono。
 */
import { computed } from 'vue'
import { PIXEL_ICONS } from '../../data/pixelIcons.js'
import { PIXEL_COLOR_ICONS } from '../../data/pixelIconsColor.js'
import { PIXEL_EXTRA_ICONS } from '../../data/pixelIconsExtra.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 24 },
  label: { type: String, default: '' },
  mono: { type: Boolean, default: false }
})

const INK = '#241D19'

/** 缺失图标的强调色：按语义取品牌色，描边统一深色 */
const ACCENTS = {
  alert: '#FF8C45',
  info: '#38A9F3',
  arrowRight: INK,
  chevronDown: INK,
  chevronUp: INK,
  chart: '#28BF87',
  box: '#FFDA35',
  layers: '#38A9F3',
  list: '#FFDA35',
  photo: '#38A9F3',
  user: '#38A9F3',
  sparkles: '#F45E93',
  play: '#F45E93',
  save: '#FFDA35',
  restore: '#38A9F3',
  sliders: '#38A9F3',
  layout: '#FFDA35',
  smile: '#FFDA35',
  swap: '#38A9F3',
  scissors: '#F45E93',
  wand: '#F45E93',
  brush: '#F45E93',
  pick: '#F45E93',
  flipH: '#38A9F3',
  flipV: '#38A9F3',
  zoomIn: INK,
  zoomOut: INK,
  redo: '#38A9F3'
}

const COLOR_ALIASES = {
  fill: 'paint-bucket',
  redo: 'undo'
}

const colored = computed(() => {
  const key = COLOR_ALIASES[props.name] || props.name
  return PIXEL_EXTRA_ICONS[key] || PIXEL_COLOR_ICONS[key] || null
})

function colorRuns(row, palette) {
  const runs = []
  let x = 0
  while (x < row.length) {
    const ch = row[x]
    if (ch === '.') { x += 1; continue }
    let w = 1
    while (x + w < row.length && row[x + w] === ch) w += 1
    runs.push({ x, w, fill: palette['abcdefghijklmnop'.indexOf(ch)] || INK })
    x += w
  }
  return runs
}

function monoRuns(row) {
  const runs = []
  let x = 0
  while (x < row.length) {
    if (row[x] !== '1') { x += 1; continue }
    let w = 1
    while (x + w < row.length && row[x + w] === '1') w += 1
    runs.push({ x, w })
    x += w
  }
  return runs
}

function fallbackColor(grid, x, y, accent) {
  if (x < 0 || y < 0 || y >= grid.length) return null
  const row = grid[y] || ''
  return row[x] === '1' ? accent : null
}

const rows = computed(() => {
  if (colored.value) {
    return colored.value.rows.map((row, y) => ({
      y,
      runs: colorRuns(row, colored.value.palette)
    }))
  }
  const grid = PIXEL_ICONS[props.name] || []
  if (props.mono) {
    return grid.map((row, y) => ({ y, runs: monoRuns(row).map(r => ({ ...r, fill: 'currentColor' })) }))
  }
  const accent = ACCENTS[props.name] || INK
  return grid.map((row, y) => {
    const runs = []
    let x = 0
    while (x < row.length) {
      if (row[x] !== '1') { x += 1; continue }
      const boundary =
        !fallbackColor(grid, x - 1, y, accent) || !fallbackColor(grid, x + 1, y, accent) ||
        !fallbackColor(grid, x, y - 1, accent) || !fallbackColor(grid, x, y + 1, accent)
      const fill = boundary ? INK : accent
      let w = 1
      while (x + w < row.length && row[x + w] === '1') {
        const b =
          !fallbackColor(grid, x + w - 1, y, accent) || !fallbackColor(grid, x + w + 1, y, accent) ||
          !fallbackColor(grid, x + w, y - 1, accent) || !fallbackColor(grid, x + w, y + 1, accent)
        if ((b ? INK : accent) !== fill) break
        w += 1
      }
      runs.push({ x, w, fill })
      x += w
    }
    return { y, runs }
  })
})
</script>

<template>
  <svg
    class="pixelIcon"
    :width="size"
    :height="size"
    viewBox="0 0 12 12"
    :shape-rendering="mono ? 'crispEdges' : 'crispEdges'"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <g v-for="row in rows" :key="row.y">
      <rect
        v-for="(run, i) in row.runs" :key="i"
        :x="run.x" :y="row.y" :width="run.w" height="1"
        :fill="run.fill"
      />
    </g>
  </svg>
</template>

<style scoped>
.pixelIcon{display:block;flex:0 0 auto}
</style>
