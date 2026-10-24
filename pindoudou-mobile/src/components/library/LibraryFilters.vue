<script setup>
import PixelIcon from '../ui/PixelIcon.vue'
import PurposeDropdown from './PurposeDropdown.vue'
import {
  DIFFICULTY_OPTIONS, SEARCH_PLACEHOLDER, SORT_TABS
} from '../../data/libraryCategories.js'

const props = defineProps({
  sort: { type: String, default: 'recommended' },
  diff: { type: String, default: 'all' },
  purpose: { type: String, default: 'all' },
  keyword: { type: String, default: '' }
})
const emit = defineEmits([
  'update:sort', 'update:diff', 'update:purpose', 'update:keyword'
])

function onSearch(e) {
  emit('update:keyword', e.target.value)
}
function clearSearch() {
  emit('update:keyword', '')
}
</script>

<template>
  <div class="filters" data-audit="library-filters">
    <div class="filters__row">
      <div class="sortTabs" role="tablist" aria-label="排序">
        <button
          v-for="s in SORT_TABS" :key="s.value"
          type="button" role="tab" :class="{ on: sort === s.value }"
          :aria-selected="sort === s.value"
          @click="emit('update:sort', s.value)"
        >{{ s.label }}</button>
      </div>

      <span class="filters__sep" aria-hidden="true"></span>

      <div class="filters__group">
        <span class="filters__label">难度：</span>
        <div class="diffChips" role="group" aria-label="难度">
          <button
            v-for="d in DIFFICULTY_OPTIONS" :key="d.value"
            type="button" :class="{ on: diff === d.value }"
            :aria-pressed="diff === d.value"
            @click="emit('update:diff', d.value)"
          >{{ d.label }}</button>
        </div>
      </div>

      <span class="filters__sep" aria-hidden="true"></span>

      <div class="filters__group filters__group--purpose">
        <span class="filters__label">用途：</span>
        <PurposeDropdown
          :model-value="purpose"
          @update:model-value="emit('update:purpose', $event)"
        />
      </div>

      <label class="filters__search">
        <PixelIcon name="search" :size="15" />
        <input
          :value="keyword" type="search"
          :placeholder="SEARCH_PLACEHOLDER"
          aria-label="搜索当前分类的素材"
          @input="onSearch"
        >
        <button v-if="keyword" type="button" class="filters__clear" aria-label="清空搜索" @click="clearSearch">
          <PixelIcon name="close" :size="11" />
        </button>
      </label>
    </div>
  </div>
</template>

<style scoped>
.filters{
  position:relative;z-index:20;
  padding:9px 12px;background:#FFFDFC;
  border:1px solid #EDE4D7;border-radius:16px;
  box-shadow:0 4px 16px rgba(92,64,30,.045);
}
.filters__row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:46px}
.sortTabs{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto}
.sortTabs button{
  height:38px;padding:0 14px;border-radius:10px;
  font-size:13px;font-weight:650;color:#4B5563;white-space:nowrap;
  transition:background .16s var(--ease),color .16s var(--ease);
}
.sortTabs button:hover{background:#FFF7DE;color:#27201B}
.sortTabs button.on{background:#FFE29A;color:#27201B;font-weight:800}
.filters__sep{width:1px;height:22px;background:#EDE4D7;flex:0 0 auto}
.filters__group{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0}
.filters__label{font-size:12px;color:#8B8378;white-space:nowrap}
.diffChips{display:inline-flex;align-items:center;gap:2px}
.diffChips button{
  height:34px;padding:0 11px;border-radius:9px;border:1px solid transparent;
  font-size:13px;font-weight:600;color:#4B5563;white-space:nowrap;
  transition:var(--t);
}
.diffChips button:hover{background:#F8F5F0;color:#27201B}
.diffChips button.on{
  background:#fff;border-color:#EDE4D7;color:#27201B;font-weight:800;
  box-shadow:0 1px 3px rgba(92,64,30,.06);
}
.filters__search{
  display:flex;align-items:center;gap:7px;
  flex:1 1 230px;min-width:180px;max-width:340px;height:40px;margin-left:auto;
  padding:0 12px;background:#fff;border:1px solid #EDE4D7;border-radius:999px;
  color:#A8A093;transition:var(--t);
}
.filters__search:focus-within{border-color:#FFC84B;box-shadow:0 0 0 3px rgba(255,200,75,.14)}
.filters__search input{flex:1;min-width:0;border:0;background:transparent;outline:none;font-size:13px;color:#27201B}
.filters__search input::placeholder{color:#A8A093}
.filters__clear{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#8B8378;flex:0 0 auto}
.filters__clear:hover{background:#F6F3EE;color:#27201B}
@media(max-width:1300px){
  .filters__search{max-width:none}
}
@media(max-width:780px){
  .filters{padding:9px 10px;border-radius:14px}
  .filters__row{gap:8px;min-height:0}
  .sortTabs{
    width:100%;overflow-x:auto;scrollbar-width:none;gap:2px;
    padding-bottom:1px;
  }
  .sortTabs::-webkit-scrollbar{display:none}
  .sortTabs button{height:36px;padding:0 12px;flex:0 0 auto}
  .filters__sep{display:none}
  .filters__group{gap:4px}
  .filters__label{font-size:11px}
  .diffChips button{height:32px;padding:0 9px;font-size:12px}
  .filters__group--purpose{flex:1 1 auto}
  .filters__search{
    flex:1 1 100%;max-width:none;min-width:0;height:40px;margin-left:0;
  }
}
</style>
