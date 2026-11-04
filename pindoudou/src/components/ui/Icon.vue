<script setup>
/**
 * 规范线性图标（Figma「豆玩 · 图标规范」155:2）
 * -------------------------------------------------------------------------
 * 一套 24×24 矢量用在 16 / 20 / 24 三档尺寸与所有状态：
 *   · 线宽 1.65、round 端点与接头、只描边不填充
 *   · 颜色走 currentColor，图标本身不染色（选中态也只改文字色）
 *   · 尺寸只认三档，其它数值吸附到最近一档；图标框 ≠ 点击热区
 * 旧名字（camelCase / fn- 前缀）通过 ICON_ALIASES 收口，新代码直接用规范名。
 */
import { computed } from 'vue'
import { SPEC_ICONS, ICON_ALIASES } from '../../data/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 24 },
  label: { type: String, default: '' },
  strokeWidth: { type: [Number, String], default: 1.65 },
  /** 仅给 chevron 这类同一段矢量的方向复用，其它图标不要传 */
  rotate: { type: [Number, String], default: 0 }
})

const resolved = computed(() => ICON_ALIASES[props.name] || props.name)
const path = computed(() => SPEC_ICONS[resolved.value] || SPEC_ICONS.info)

/* 16 / 20 / 24 三档：≤17 → 16，18~21 → 20，≥22 → 24 */
const px = computed(() => {
  const raw = Number(props.size)
  if (!Number.isFinite(raw) || raw <= 0) return 24
  if (raw <= 17) return 16
  if (raw <= 21) return 20
  return 24
})

const boxStyle = computed(() => ({
  width: `${px.value}px`,
  height: `${px.value}px`,
  transform: Number(props.rotate) ? `rotate(${Number(props.rotate)}deg)` : undefined
}))
</script>

<template>
  <svg
    class="pixelIcon uiIcon"
    :width="px"
    :height="px"
    :style="boxStyle"
    viewBox="0 0 24 24"
    fill="none"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    :data-icon="resolved"
    focusable="false"
  >
    <path :d="path" stroke="currentColor" />
  </svg>
</template>

<style scoped>
/* pixelIcon 是旧类名：站内已有几十条定位 / 旋转 / 隐藏规则挂在它上面，保留它免得布局跑偏 */
.uiIcon{display:block;flex:0 0 auto;overflow:visible}
</style>
