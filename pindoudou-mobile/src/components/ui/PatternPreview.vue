<script setup>
import { usePatternCanvas } from '../../composables/usePatternCanvas.js'

/**
 * 图案预览：把结构化 Pattern 渲染成像素缩略图。
 * 缩略图卡、作品列表、素材演示、对照视图都复用它。
 */
const props = defineProps({
  pattern: { type: Object, default: null },
  maxSize: { type: Number, default: 320 },
  boardLines: { type: Boolean, default: false },
  blank: { type: String, default: '#ffffff' },
  alt: { type: String, default: '拼豆图案预览' }
})

const { canvasRef } = usePatternCanvas(() => props.pattern, {
  mode: 'pixels',
  config: () => ({ maxSize: props.maxSize, boardLines: props.boardLines, blank: props.blank }),
  sig: () => `${props.maxSize}|${props.boardLines}|${props.blank}`
})
</script>

<template>
  <canvas
    v-if="pattern && pattern.cells && pattern.cells.length"
    ref="canvasRef"
    :aria-label="alt"
    role="img"
  />
  <div v-else class="previewEmpty" aria-hidden="true">尚未生成</div>
</template>

<style scoped>
canvas{display:block;image-rendering:pixelated;max-width:100%}
.previewEmpty{
  display:grid;place-items:center;width:100%;height:100%;min-height:90px;
  color:var(--muted-2);font-size:var(--fs-2xs);background:var(--surface-2);border-radius:var(--r-sm);
}
</style>
