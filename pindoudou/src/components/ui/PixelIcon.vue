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
/* 编辑器工具栏 6 个工具的插画图标（2026-10-23 交付包「操作台/图标替换」）。
   原图是带柔边的像素插画，比 12×12 网格细，所以按位图渲染；
   源图约 150px，是 15px / 20px 槽位的 7 倍，1x / 2x 屏幕都够清晰。 */
import brushArt from '../../assets/icons/tools/brush.png'
import eraserArt from '../../assets/icons/tools/eraser.png'
import fillArt from '../../assets/icons/tools/fill.png'
import eyedropperArt from '../../assets/icons/tools/eyedropper.png'
import undoArt from '../../assets/icons/tools/undo.png'
import redoArt from '../../assets/icons/tools/redo.png'
/* 功能图标（2026-10-23 交付包「icon/完整交付包」）：14 张 170×170 透明 PNG 像素插画。
   只在「同名功能」的位置使用（左栏入口 / 画布页签 / 右栏卡片 / 交付检查 / 手机入口），
   用 fn- 前缀与 12×12 网格图标区分开 —— 语义名（photo / grid / chart…）在别处还有
   别的含义，直接换掉会把不相干的位置一起改掉。 */
import fnUpload from '../../assets/icons/functions/upload.png'
import fnAiCreate from '../../assets/icons/functions/ai-create.png'
import fnFreeLibrary from '../../assets/icons/functions/free-library.png'
import fnPattern from '../../assets/icons/functions/pattern.png'
import fnOriginal from '../../assets/icons/functions/original.png'
import fnCompare from '../../assets/icons/functions/compare.png'
import fnSplit from '../../assets/icons/functions/split.png'
import fnMaterials from '../../assets/icons/functions/materials.png'
import fnAnalytics from '../../assets/icons/functions/analytics.png'
import fnInventory from '../../assets/icons/functions/inventory.png'
import fnOriginalMode from '../../assets/icons/functions/original-mode.png'
import fnCutout from '../../assets/icons/functions/cutout.png'
import fnCartoon from '../../assets/icons/functions/cartoon.png'
import fnExportCheck from '../../assets/icons/functions/export-check.png'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 24 },
  label: { type: String, default: '' },
  mono: { type: Boolean, default: false }
})

/* 图标的显示尺寸固定就是 size。
   为什么用行内样式钉死：容器里常有「后代 img 一律铺满」这种规则
   （例如 .thumb img{width:100%;height:164px}，那是为了把源图铺满缩略图），
   位图分支的图标（fn-library / fn-upload 这类插画 PNG）也会被一起命中，
   14px 的图标被拉成 19×164，图形画到了按钮外面 —— 看上去就是一个白圆钮。
   行内样式只属于这个元素，祖先规则改不动它。 */
const boxStyle = computed(() => {
  const s = typeof props.size === 'number' ? `${props.size}px` : String(props.size)
  return { width: s, height: s, maxWidth: 'none' }
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

/* 位图图标优先于网格图标；mono 场景（跟着文字变色）仍走矢量网格 */
const RASTER_ICONS = {
  brush: brushArt,
  eraser: eraserArt,
  fill: fillArt,
  pick: eyedropperArt,
  undo: undoArt,
  redo: redoArt,
  'fn-upload': fnUpload,
  'fn-ai': fnAiCreate,
  'fn-library': fnFreeLibrary,
  'fn-pattern': fnPattern,
  'fn-original': fnOriginal,
  'fn-compare': fnCompare,
  'fn-split': fnSplit,
  'fn-materials': fnMaterials,
  'fn-analytics': fnAnalytics,
  'fn-inventory': fnInventory,
  'fn-original-mode': fnOriginalMode,
  'fn-cutout': fnCutout,
  'fn-cartoon': fnCartoon,
  'fn-export-check': fnExportCheck
}

const rasterSrc = computed(() => (props.mono ? '' : RASTER_ICONS[props.name] || ''))

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
  <img
    v-if="rasterSrc"
    class="pixelIcon pixelIcon--art"
    :src="rasterSrc"
    :width="size"
    :height="size"
    :style="boxStyle"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    alt=""
    draggable="false"
  >
  <svg
    v-else
    class="pixelIcon"
    :width="size"
    :height="size"
    :style="boxStyle"
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
/* 位图图标等比缩放进方形槽位，不拉伸；源图是位图的 7 倍，交给浏览器做高质量缩放 */
.pixelIcon--art{object-fit:contain}
</style>
