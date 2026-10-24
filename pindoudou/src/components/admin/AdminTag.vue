<script setup>
/* 状态标签：把 { text, kind } 渲染成统一样式的 tag */
defineProps({
  text: { type: String, default: '' },
  kind: { type: String, default: '' }, // '' | ok | warn | danger | info | primary | muted
  title: { type: String, default: '' }
})
</script>

<template>
  <span class="adm-tag" :class="kind && kind !== 'muted' ? `adm-tag--${kind}` : ''" :title="title || undefined">
    <slot>{{ text }}</slot>
  </span>
</template>
