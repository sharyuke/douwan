<script setup>
/**
 * 统一图标组件：把 src/data/icons.js 里的路径渲染成线性 SVG。
 * 用法 <Icon name="brush" />，颜色跟随 currentColor，尺寸用 size 调。
 */
import { ICON_PATHS, ICON_FILLS } from '../../data/icons.js'

const props = defineProps({
  // 图标名，见 ICON_PATHS
  name: { type: String, required: true },
  // 渲染尺寸（px），20 配 44px 高的工具按钮正合适
  size: { type: [Number, String], default: 20 }
})
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, i) in (ICON_PATHS[name] || [])" :key="i" :d="d" />
    <!-- 少数实心小块（比如填充那滴漆）单独描一遍 -->
    <path
      v-for="(d, i) in (ICON_FILLS[name] || [])" :key="'f' + i"
      :d="d" fill="currentColor" stroke="none"
    />
  </svg>
</template>

<style scoped>
.icon{display:block;flex:0 0 auto}
</style>
