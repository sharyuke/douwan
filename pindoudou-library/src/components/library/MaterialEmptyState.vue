<script setup>
import { computed } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({
  mode: { type: String, default: 'search' },
  keyword: { type: String, default: '' }
})
defineEmits(['clear'])

const icon = computed(() => (props.mode === 'favorites' ? 'heart' : 'search'))
const title = computed(() => {
  if (props.mode === 'favorites') return '还没有收藏的素材'
  return props.keyword ? `没有找到「${props.keyword}」` : '没有找到匹配的素材'
})
const hint = computed(() => {
  if (props.mode === 'favorites') return '在素材卡片上点一下爱心，喜欢的图案就会收在这里。'
  if (props.keyword) return '换个关键词试试，或者清空筛选看看全部素材。'
  return '当前的分类和筛选条件组合起来没有结果，清空后再试一次。'
})
const action = computed(() => (props.mode === 'favorites' ? '去看全部素材' : '清空筛选'))
</script>

<template>
  <div class="empty libEmpty">
    <div class="empty__icon"><PixelIcon :name="icon" :size="24" /></div>
    <strong>{{ title }}</strong>
    <p>{{ hint }}</p>
    <button type="button" class="btn" @click="$emit('clear')">{{ action }}</button>
  </div>
</template>

<style scoped>
.libEmpty{padding:42px 20px;background:var(--surface);border:1px dashed var(--line-strong);border-radius:14px}
</style>
