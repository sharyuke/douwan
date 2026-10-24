<script setup>
/* =========================================================================
   后台数据表格
   - columns: [{ key, label, width, align, nowrap }]
   - 每个单元格用插槽渲染：#cell-<key>="{ row, value }"
   - 空数据、加载中、加载失败都有明确状态（后台需求 §14）
   ========================================================================= */
import PixelIcon from '../ui/PixelIcon.vue'

defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  rowKey: { type: String, default: 'id' },
  /** 空态文案 */
  emptyTitle: { type: String, default: '暂无数据' },
  emptyHint: { type: String, default: '' },
  minWidth: { type: String, default: '720px' }
})
</script>

<template>
  <div class="adm-tablewrap">
    <table class="adm-table" :style="{ minWidth }">
      <thead>
        <tr>
          <th
            v-for="col in columns" :key="col.key"
            :class="{ num: col.align === 'right' }"
            :style="col.width ? { width: col.width } : null"
          >{{ col.label }}</th>
        </tr>
      </thead>
      <tbody v-if="loading">
        <tr v-for="n in 4" :key="`sk-${n}`">
          <td v-for="col in columns" :key="col.key">
            <div class="adm-skeleton" :style="{ width: n % 2 ? '70%' : '45%' }" />
          </td>
        </tr>
      </tbody>
      <tbody v-else-if="rows.length">
        <tr v-for="row in rows" :key="row[rowKey]">
          <td
            v-for="col in columns" :key="col.key"
            :class="[col.align === 'right' ? 'num' : '', col.nowrap ? 'adm-nowrap' : '']"
          >
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] ?? '—' }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!loading && !rows.length" class="adm-empty">
      <div class="adm-empty__icon"><PixelIcon name="folder" :size="26" /></div>
      <strong>{{ emptyTitle }}</strong>
      <p v-if="emptyHint">{{ emptyHint }}</p>
      <slot name="empty-action" />
    </div>
  </div>
</template>
