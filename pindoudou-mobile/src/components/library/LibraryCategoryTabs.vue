<script setup>
import { nextTick, ref, watch } from 'vue'
import { LIBRARY_CATEGORIES } from '../../data/libraryCategories.js'

const props = defineProps({
  active: { type: String, default: 'all' },
  panelOpen: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'toggle-panel'])

const scrollEl = ref(null)
const tabEls = ref([])

function setTab(el, index) {
  if (el) tabEls.value[index] = el
}

function isActive(c) {
  return props.active === c.key
}

function onPick(c) {
  if (c.key === 'all') emit('toggle-panel')
  else emit('select', c.key)
}

/** 手机横向滚动时把当前分类滚到可见位置 */
async function revealActive() {
  await nextTick()
  const index = LIBRARY_CATEGORIES.findIndex(c => c.key === props.active)
  const el = tabEls.value[index]
  if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
}

watch(() => props.active, revealActive)
</script>

<template>
  <div class="catRow" data-audit="category-nav">
    <div ref="scrollEl" class="catScroll" role="tablist" aria-label="素材分类">
      <button
        v-for="(c, i) in LIBRARY_CATEGORIES" :key="c.key"
        :ref="el => setTab(el, i)"
        type="button" role="tab" class="catTab"
        :class="{ on: isActive(c), 'catTab--all': c.key === 'all' }"
        :aria-selected="isActive(c)"
        :aria-expanded="c.key === 'all' ? panelOpen : undefined"
        :data-cat="c.key"
        @click="onPick(c)"
      >
        <img class="catIcon" :src="c.icon" alt="" width="56" height="56" draggable="false">
        <span class="catName">{{ c.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.catRow{min-width:0}
.catScroll{
  display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:12px;
  padding:2px 0 4px;
}
/* 分类卡：奶油白底 + 浅米描边，选中暖黄 */
.catTab{
  position:relative;min-width:0;height:112px;padding:6px 4px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
  border-radius:16px;border:1px solid #EDE4D7;background:#FFFDFC;
  color:#27201B;box-shadow:0 4px 14px rgba(92,64,30,.045);
  transition:transform .18s var(--ease),background .18s var(--ease),
    border-color .18s var(--ease),box-shadow .18s var(--ease);
}
.catTab:hover{transform:translateY(-2px);border-color:#F0D9A8;box-shadow:0 8px 20px rgba(92,64,30,.08)}
.catTab.on{background:#FFE29A;border-color:#FFC84B;box-shadow:0 6px 16px rgba(255,200,75,.22)}
.catTab.on:hover{transform:translateY(-1px)}
.catIcon{
  display:block;width:54px;height:54px;object-fit:contain;flex:0 0 auto;
  image-rendering:pixelated;
}
.catName{
  font-size:14px;font-weight:750;line-height:1.2;letter-spacing:-.01em;
  white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;
}

/* 平板 / 窄屏：横向滑动，卡片固定宽度，避免图标被压扁 */
@media(max-width:1199px){
  .catScroll{
    display:flex;align-items:stretch;gap:10px;
    overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
    scroll-snap-type:x proximity;padding:2px 0 6px;
  }
  .catScroll::-webkit-scrollbar{display:none}
  .catTab{flex:0 0 96px;width:96px;height:104px;scroll-snap-align:start}
  .catIcon{width:48px;height:48px}
}

@media(max-width:780px){
  .catScroll{gap:8px}
  .catTab{flex:0 0 82px;width:82px;height:92px;border-radius:14px;gap:5px}
  .catIcon{width:40px;height:40px}
  .catName{font-size:12px;font-weight:700}
}
</style>
