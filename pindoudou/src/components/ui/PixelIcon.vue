<script setup>
/**
 * 兼容壳：2026-11-01 起站内图标统一换成规范线性图标（见 Icon.vue）。
 * 这个组件保留旧 props（含 mono），内部直接渲染 Icon，
 * 旧名字由 data/icons.js 的 ICON_ALIASES 映射到规范名。
 * 新代码请直接用 <Icon name="...">。
 */
import Icon from './Icon.vue'

defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 24 },
  label: { type: String, default: '' },
  mono: { type: Boolean, default: false }
})
</script>

<template>
  <Icon :name="name" :size="size" :label="label" />
</template>
