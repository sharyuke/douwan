<script setup>
import { computed } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({
  mode: { type: String, default: 'search' },
  keyword: { type: String, default: '' }
})
defineEmits(['clear'])

const icon = computed(() => {
  if (props.mode === 'favorites') return 'heart'
  if (props.mode === 'empty') return 'sparkles'
  return 'search'
})
const title = computed(() => {
  if (props.mode === 'favorites') return '还没有收藏的素材'
  if (props.mode === 'empty') return '素材库正在上新'
  return '暂无符合条件的素材'
})
const hint = computed(() => {
  if (props.mode === 'favorites') return '在素材卡片上点一下爱心，喜欢的图案就会收在这里。'
  if (props.mode === 'empty') return '平台素材正在整理，稍后回来看看；也可以先上传自己的图片开始创作。'
  if (props.keyword) return `没有找到与「${props.keyword}」匹配的素材，试试其他关键词或筛选条件。`
  return '试试其他筛选条件，或清空筛选看看全部素材。'
})
const action = computed(() => {
  if (props.mode === 'favorites') return '去看全部素材'
  if (props.mode === 'empty') return ''
  return '清空筛选'
})
</script>

<template>
  <div class="empty libEmpty" data-audit="library-empty">
    <div class="empty__icon"><PixelIcon :name="icon" :size="24" /></div>
    <strong>{{ title }}</strong>
    <p>{{ hint }}</p>
    <button v-if="action" type="button" class="btn" @click="$emit('clear')">{{ action }}</button>
  </div>
</template>

<style scoped>
.libEmpty{padding:42px 20px;background:var(--surface);border:1px dashed var(--line-strong);border-radius:14px}
</style>
