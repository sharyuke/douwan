<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'
import {
  LIBRARY_CATEGORIES, MORE_CATEGORIES, CATEGORY_BY_KEY
} from '../../data/libraryCategories.js'

const props = defineProps({
  active: { type: String, default: 'all' }
})
const emit = defineEmits(['select'])

const root = ref(null)
const moreOpen = ref(false)
const moreActive = computed(() => MORE_CATEGORIES.some(c => c.key === props.active))
const moreLabel = computed(() => (moreActive.value ? CATEGORY_BY_KEY[props.active].label : '更多分类'))

function pick(key) {
  moreOpen.value = false
  emit('select', key)
}

function onDocClick(e) {
  if (moreOpen.value && root.value && !root.value.contains(e.target)) moreOpen.value = false
}
function onKey(e) {
  if (e.key === 'Escape') moreOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="catRow">
    <div class="catScroll" role="tablist" aria-label="素材分类">
      <button
        v-for="c in LIBRARY_CATEGORIES" :key="c.key"
        type="button" role="tab" class="catTab"
        :class="{ on: active === c.key }"
        :aria-selected="active === c.key"
        @click="pick(c.key)"
      >
        <PixelIcon :name="c.icon" :size="16" />
        <span>{{ c.label }}</span>
      </button>
    </div>

    <div class="catMoreWrap">
      <button
        type="button" class="catTab catMoreBtn"
        :class="{ on: moreActive, open: moreOpen }"
        :aria-expanded="moreOpen"
        @click.stop="moreOpen = !moreOpen"
      >
        <PixelIcon name="plus" :size="14" />
        <span>{{ moreLabel }}</span>
        <PixelIcon name="chevronDown" :size="12" />
      </button>
      <div v-if="moreOpen" class="catMoreMenu" role="menu">
        <button
          v-for="c in MORE_CATEGORIES" :key="c.key"
          type="button" role="menuitem" class="catMoreItem"
          :class="{ on: active === c.key }"
          @click="pick(c.key)"
        >{{ c.label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.catRow{display:flex;align-items:center;gap:8px;min-width:0}
.catScroll{
  display:flex;align-items:center;gap:6px;flex:1;min-width:0;
  overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:2px 0;
}
.catScroll::-webkit-scrollbar{display:none}
.catTab{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  height:38px;padding:0 13px;border-radius:var(--r-pill);
  border:1px solid var(--line);background:var(--surface);
  color:var(--ink-2);font-size:var(--fs-xs);font-weight:650;white-space:nowrap;
  transition:var(--t);
}
.catTab:hover{background:var(--surface-3);color:var(--ink)}
.catTab.on{background:var(--primary-soft);border-color:#F0D98A;color:var(--ink);font-weight:800}
.catMoreWrap{position:relative;flex:0 0 auto}
.catMoreBtn{padding-right:10px}
.catMoreBtn.open{background:var(--surface-3)}
.catMoreMenu{
  position:absolute;right:0;top:calc(100% + 6px);z-index:40;
  min-width:150px;padding:6px;background:var(--surface);
  border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--sh-2);
  display:flex;flex-direction:column;gap:2px;
}
.catMoreItem{
  text-align:left;padding:8px 10px;border-radius:8px;font-size:var(--fs-xs);
  color:var(--ink-2);font-weight:650;
}
.catMoreItem:hover{background:var(--surface-3);color:var(--ink)}
.catMoreItem.on{background:var(--primary-soft);color:var(--ink);font-weight:800}
@media(max-width:780px){
  .catTab{height:36px;padding:0 11px;font-size:var(--fs-2xs)}
  .catTab :deep(svg){width:14px;height:14px}
}
</style>
