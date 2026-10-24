<script setup>
import { computed, ref } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'
import { DIFFICULTY_OPTIONS, SIZE_OPTIONS, SORT_OPTIONS } from '../../data/libraryCategories.js'

const props = defineProps({
  sort: { type: String, default: 'latest' },
  diff: { type: String, default: 'all' },
  size: { type: String, default: 'all' },
  favCount: { type: Number, default: 0 }
})
const emit = defineEmits(['update:sort', 'update:diff', 'update:size', 'reset'])

const open = ref(false)
const hasFilter = computed(() => props.diff !== 'all' || props.size !== 'all')

function pickDiff(v) { emit('update:diff', v) }
function pickSize(v) { emit('update:size', v) }
</script>

<template>
  <div class="filters" :class="{ 'is-open': open, 'has-filter': hasFilter }">
    <div class="filters__top">
      <div class="sortTabs" role="tablist" aria-label="排序">
        <button
          v-for="s in SORT_OPTIONS" :key="s.value"
          type="button" role="tab" :class="{ on: sort === s.value }"
          :aria-selected="sort === s.value"
          @click="emit('update:sort', s.value)"
        >
          <PixelIcon v-if="s.value === 'fav'" name="heart" :size="12" />
          {{ s.label }}<span v-if="s.value === 'fav' && favCount" class="favNum">{{ favCount }}</span>
        </button>
      </div>

      <div class="filters__right">
        <label class="selectWrap">
          <span>难度</span>
          <select :value="diff" aria-label="按难度筛选" @change="pickDiff($event.target.value)">
            <option value="all">全部难度</option>
            <option v-for="d in DIFFICULTY_OPTIONS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <label class="selectWrap">
          <span>尺寸</span>
          <select :value="size" aria-label="按尺寸筛选" @change="pickSize($event.target.value)">
            <option value="all">全部尺寸</option>
            <option v-for="s in SIZE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </label>
        <button type="button" class="filterToggle" :class="{ on: hasFilter }" @click="open = !open">
          <PixelIcon name="sliders" :size="14" />
          筛选<span v-if="hasFilter" class="dot" aria-hidden="true"></span>
          <PixelIcon :name="open ? 'chevronUp' : 'chevronDown'" :size="12" />
        </button>
      </div>
    </div>

    <div class="mobilePanel">
      <div class="mGroup">
        <span class="mLabel">难度</span>
        <div class="mChips">
          <button type="button" :class="{ on: diff === 'all' }" @click="pickDiff('all')">全部</button>
          <button
            v-for="d in DIFFICULTY_OPTIONS" :key="d.value" type="button"
            :class="{ on: diff === d.value }" @click="pickDiff(d.value)"
          >{{ d.label }}</button>
        </div>
      </div>
      <div class="mGroup">
        <span class="mLabel">尺寸</span>
        <div class="mChips">
          <button type="button" :class="{ on: size === 'all' }" @click="pickSize('all')">全部</button>
          <button
            v-for="s in SIZE_OPTIONS" :key="s.value" type="button"
            :class="{ on: size === s.value }" @click="pickSize(s.value)"
          >{{ s.label }}</button>
        </div>
      </div>
      <button v-if="hasFilter" type="button" class="resetBtn" @click="emit('reset')">重置难度和尺寸</button>
    </div>
  </div>
</template>

<style scoped>
.filters{
  display:flex;flex-direction:column;gap:10px;
  padding:10px 12px;background:var(--surface);
  border:1px solid var(--line);border-radius:14px;
}
.filters__top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.sortTabs{display:inline-flex;align-items:center;gap:2px;padding:3px;background:var(--surface-3);border-radius:11px}
.sortTabs button{
  display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 13px;border-radius:9px;
  font-size:var(--fs-xs);font-weight:650;color:var(--muted);white-space:nowrap;transition:var(--t);
}
.sortTabs button:hover{color:var(--ink)}
.sortTabs button.on{background:var(--primary-soft);color:var(--ink);font-weight:800;box-shadow:0 1px 2px rgba(82,62,24,.06)}
.favNum{
  min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--coral-soft);
  color:var(--coral-deep);font-size:10px;font-weight:800;display:inline-grid;place-items:center;
}
.filters__right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.selectWrap{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap;flex:0 0 auto}
.selectWrap > span{white-space:nowrap}
.selectWrap select{
  height:34px;padding:0 26px 0 10px;border:1px solid var(--line);border-radius:10px;
  background:var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236B7280' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 9px center;
  color:var(--ink-2);font-size:var(--fs-2xs);font-weight:650;appearance:none;cursor:pointer;
}
.selectWrap select:hover{border-color:var(--line-strong)}
.filterToggle{
  display:none;align-items:center;gap:5px;height:34px;padding:0 11px;border-radius:10px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2);
  font-size:var(--fs-2xs);font-weight:700;position:relative;
}
.filterToggle.on{border-color:#F0D98A;background:var(--primary-soft);color:var(--ink)}
.filterToggle .dot{width:5px;height:5px;border-radius:50%;background:var(--coral-deep)}
.mobilePanel{display:none}
@media(max-width:780px){
  .filters{padding:9px 10px;gap:0}
  .filters__top{gap:8px;flex-wrap:nowrap}
  .sortTabs{flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
  .sortTabs::-webkit-scrollbar{display:none}
  .sortTabs button{height:30px;padding:0 10px}
  .filters__right .selectWrap{display:none}
  .filterToggle{display:inline-flex;flex:0 0 auto}
  .mobilePanel{display:none;padding-top:10px}
  /* 带上 .filters：App.vue 的布局壳也有 is-open，别让祖先的类名把面板撑开 */
  .filters.is-open .mobilePanel{display:flex;flex-direction:column;gap:10px}
  .mGroup{display:flex;align-items:flex-start;gap:8px}
  .mLabel{flex:0 0 auto;font-size:var(--fs-2xs);color:var(--muted);line-height:30px}
  .mChips{display:flex;flex-wrap:wrap;gap:6px}
  .mChips button{
    height:30px;padding:0 11px;border-radius:999px;border:1px solid var(--line);
    background:var(--surface);font-size:var(--fs-2xs);font-weight:650;color:var(--ink-2);
  }
  .mChips button.on{background:var(--primary-soft);border-color:#F0D98A;color:var(--ink);font-weight:800}
  .resetBtn{align-self:flex-start;font-size:var(--fs-2xs);font-weight:700;color:var(--coral-deep);padding:4px 0}
}
</style>
