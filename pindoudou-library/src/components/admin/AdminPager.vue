<script setup>
/* 分页控件：只在有数据时出现，页码按钮保持在可控数量内 */
import { computed } from 'vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 }
})
const emit = defineEmits(['update:page', 'update:pageSize'])

const pages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize))))

/** 生成页码按钮：当前位置附近 5 个，两端各留一个端点 */
const buttons = computed(() => {
  const total = pages.value
  const current = props.page
  const out = []
  const push = v => { if (!out.includes(v)) out.push(v) }
  push(1)
  for (let i = current - 2; i <= current + 2; i++) {
    if (i > 1 && i < total) push(i)
  }
  if (total > 1) push(total)
  out.sort((a, b) => a - b)

  const withGaps = []
  let prev = 0
  for (const p of out) {
    if (prev && p - prev > 1) withGaps.push('...')
    withGaps.push(p)
    prev = p
  }
  return withGaps
})

function goto(p) {
  if (p === '...') return
  const next = Math.min(Math.max(1, Number(p)), pages.value)
  if (next !== props.page) emit('update:page', next)
}

function changeSize(e) {
  emit('update:pageSize', Number(e.target.value))
  emit('update:page', 1)
}
</script>

<template>
  <div v-if="total > 0" class="adm-pager">
    <span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span>

    <select class="adm-select adm-input--sm" :value="pageSize" style="width:auto" @change="changeSize">
      <option :value="10">10 条 / 页</option>
      <option :value="20">20 条 / 页</option>
      <option :value="50">50 条 / 页</option>
      <option :value="100">100 条 / 页</option>
    </select>

    <button class="adm-btn adm-btn--sm" :disabled="page <= 1" type="button" @click="goto(page - 1)">上一页</button>
    <button
      v-for="(p, i) in buttons" :key="`${p}-${i}`"
      class="adm-btn adm-btn--sm"
      :class="{ 'adm-btn--primary': p === page }"
      :disabled="p === '...'"
      type="button"
      @click="goto(p)"
    >{{ p }}</button>
    <button class="adm-btn adm-btn--sm" :disabled="page >= pages" type="button" @click="goto(page + 1)">下一页</button>
  </div>
</template>
