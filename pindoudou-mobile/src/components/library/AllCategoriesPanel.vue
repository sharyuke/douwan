<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'
import {
  CATEGORY_BY_KEY, COLLECTION_BY_KEY, PANEL_COLUMNS
} from '../../data/libraryCategories.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  active: { type: String, default: 'all' },
  collection: { type: String, default: '' },
  child: { type: String, default: '' },
  keyword: { type: String, default: '' }
})
const emit = defineEmits([
  'select-category', 'select-child', 'select-collection',
  'update:keyword', 'unavailable', 'close'
])

const mobile = ref(false)
let media = null
const expanded = ref('')

function syncMedia(e) {
  mobile.value = e.matches
  if (!e.matches) expanded.value = ''
}
onMounted(() => {
  media = window.matchMedia('(max-width: 780px)')
  syncMedia(media)
  media.addEventListener('change', syncMedia)
})
onBeforeUnmount(() => media && media.removeEventListener('change', syncMedia))

const columns = computed(() => PANEL_COLUMNS.map(keys => keys.map(key => {
  const category = CATEGORY_BY_KEY[key]
  if (category) return { ...category, kind: 'category' }
  const collection = COLLECTION_BY_KEY[key]
  return collection ? { ...collection, kind: 'collection' } : null
}).filter(Boolean)))

watch(() => props.open, v => {
  if (!v) {
    expanded.value = ''
    return
  }
  if (mobile.value) expanded.value = props.active !== 'all' ? props.active : ''
})

function isSelected(item) {
  if (item.kind === 'collection') return props.collection === item.key
  return !props.collection && props.active === item.key
}

function isChildSelected(item, child) {
  if (props.child !== child) return false
  if (item.kind === 'collection') return props.collection === item.key
  return !props.collection && props.active === item.key
}

function pickCategory(item) {
  if (item.available === false) {
    emit('unavailable', item)
    return
  }
  if (item.kind === 'collection') emit('select-collection', { collection: item.key, child: '' })
  else emit('select-category', item.key)
}

function pickChild(item, child) {
  if (item.available === false) return
  if (item.kind === 'collection') emit('select-collection', { collection: item.key, child })
  else emit('select-child', { category: item.key, child })
}

function onMain(item) {
  if (item.available === false) {
    emit('unavailable', item)
    return
  }
  if (!mobile.value) {
    pickCategory(item)
    return
  }
  expanded.value = expanded.value === item.key ? '' : item.key
}

function onSearch(e) {
  emit('update:keyword', e.target.value)
}
function clearSearch() {
  emit('update:keyword', '')
}
</script>

<template>
  <transition name="catPanel">
    <section
      v-if="open" id="all-categories" class="catPanel"
      data-audit="all-categories-panel" aria-label="全部分类"
    >
      <header class="catPanel__head">
        <div class="catPanel__title">
          <span class="catPanel__mark" aria-hidden="true"><PixelIcon name="layout" :size="20" /></span>
          <div>
            <h2>全部分类</h2>
            <p>海量可爱素材，点亮你的拼豆灵感！</p>
          </div>
        </div>
        <div class="catPanel__tools">
          <label class="catPanel__search">
            <PixelIcon name="search" :size="15" />
            <input
              :value="keyword" type="search" placeholder="搜索素材…"
              aria-label="搜索全部分类"
              @input="onSearch"
            >
            <button v-if="keyword" type="button" class="catPanel__clear" aria-label="清空搜索" @click="clearSearch">
              <PixelIcon name="close" :size="11" />
            </button>
          </label>
          <button type="button" class="catPanel__close" aria-label="关闭全部分类" @click="emit('close')">
            <PixelIcon name="close" :size="13" />
          </button>
        </div>
      </header>

      <div class="catPanel__body">
        <div v-for="(col, ci) in columns" :key="ci" class="catPanel__col">
          <div
            v-for="item in col" :key="item.key"
            class="catBlock" :class="[`tone-${item.tone}`, {
              'is-selected': isSelected(item),
              'is-open': expanded === item.key,
              'is-disabled': item.available === false
            }]"
            :data-cat="item.key"
          >
            <button
              type="button" class="catBlock__main"
              :aria-expanded="mobile ? expanded === item.key : undefined"
              :aria-disabled="item.available === false || undefined"
              @click="onMain(item)"
            >
              <span class="catBlock__icon" aria-hidden="true">
                <img v-if="item.icon" :src="item.icon" alt="" width="46" height="46" draggable="false">
                <PixelIcon v-else :name="item.pixelIcon" :size="32" />
              </span>
              <span class="catBlock__text">
                <span class="catBlock__name">
                  {{ item.name }}
                  <em v-if="item.badge" class="catBlock__badge">{{ item.badge }}</em>
                </span>
                <span v-if="mobile" class="catBlock__hint">{{ item.children.length }} 个小分类</span>
              </span>
            </button>

            <button
              type="button" class="catBlock__arrow" tabindex="-1" aria-hidden="true"
              @click="onMain(item)"
            ><PixelIcon name="arrowRight" :size="14" /></button>

            <div v-if="!mobile" class="catBlock__children">
              <button
                v-for="child in item.children" :key="child"
                type="button" class="catBlock__child"
                :class="{ on: isChildSelected(item, child) }"
                :disabled="item.available === false"
                @click="pickChild(item, child)"
              >{{ child }}</button>
            </div>

            <div v-else-if="expanded === item.key" class="catBlock__children catBlock__children--mobile">
              <button type="button" class="catBlock__child catBlock__child--all" @click="pickCategory(item)">
                全部{{ item.name }}
              </button>
              <button
                v-for="child in item.children" :key="child"
                type="button" class="catBlock__child"
                :class="{ on: isChildSelected(item, child) }"
                :disabled="item.available === false"
                @click="pickChild(item, child)"
              >{{ child }}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </transition>
</template>

<style scoped>
.catPanel{
  position:relative;margin-top:4px;padding:18px;
  background:#FFFDFC;border:1px solid #EDE4D7;border-radius:20px;
  box-shadow:0 10px 30px rgba(92,64,30,.07);
}
/* 锚点小三角：指向「全部」卡 */
.catPanel::before{
  content:'';position:absolute;left:38px;top:-8px;width:14px;height:14px;
  background:#FFFDFC;border-left:1px solid #EDE4D7;border-top:1px solid #EDE4D7;
  transform:rotate(45deg);border-top-left-radius:3px;
}
.catPanel__head{
  display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding-bottom:14px;
}
.catPanel__title{display:flex;align-items:center;gap:10px;min-width:0}
.catPanel__mark{
  width:38px;height:38px;border-radius:12px;display:grid;place-items:center;
  background:#FFF3C4;border:1px solid #FFE29A;flex:0 0 auto;
}
.catPanel__title h2{font-size:20px;font-weight:800;letter-spacing:-.02em}
.catPanel__title p{margin-top:2px;font-size:12px;color:#8B8378}
.catPanel__tools{display:flex;align-items:center;gap:8px;min-width:0}
.catPanel__search{
  display:flex;align-items:center;gap:7px;width:260px;max-width:100%;height:40px;
  padding:0 12px;background:#fff;border:1px solid #EDE4D7;border-radius:999px;
  color:#9C9488;
}
.catPanel__search:focus-within{border-color:#FFC84B;box-shadow:0 0 0 3px rgba(255,200,75,.16)}
.catPanel__search input{flex:1;min-width:0;border:0;background:transparent;outline:none;font-size:13px;color:#27201B}
.catPanel__search input::placeholder{color:#A8A093}
.catPanel__clear{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#8B8378}
.catPanel__clear:hover{background:#F6F3EE;color:#27201B}
.catPanel__close{
  width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;
  background:#F8F5F0;color:#8B8378;border:1px solid #EDE4D7;
}
.catPanel__close:hover{background:#FFF3C4;color:#27201B;border-color:#FFE29A}

.catPanel__body{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;
  max-height:min(70vh,720px);overflow-y:auto;overscroll-behavior:contain;
  padding:2px 4px 2px 2px;
}
.catPanel__col{display:flex;flex-direction:column;gap:12px;min-width:0}

/* 分类块：图标 + 标题 + 二级词条 + 箭头 */
.catBlock{
  display:grid;grid-template-columns:52px minmax(0,1fr) 18px;
  grid-template-rows:auto auto;column-gap:10px;row-gap:3px;
  padding:12px 14px;border-radius:14px;border:1px solid transparent;
  transition:border-color .16s var(--ease),box-shadow .16s var(--ease),transform .16s var(--ease);
}
.catBlock:hover{border-color:rgba(255,200,75,.5);box-shadow:0 6px 16px rgba(92,64,30,.06)}
.catBlock.is-selected{border-color:#FFC84B;box-shadow:0 0 0 2px rgba(255,200,75,.16)}
.catBlock__main{
  grid-column:1 / 3;grid-row:1;display:flex;align-items:center;gap:12px;
  min-width:0;text-align:left;color:#27201B;
}
.catBlock__icon{
  width:46px;height:46px;display:grid;place-items:center;flex:0 0 auto;
}
.catBlock__icon img{width:46px;height:46px;object-fit:contain;image-rendering:pixelated}
.catBlock__text{min-width:0;display:flex;flex-direction:column;gap:1px}
.catBlock__name{
  display:flex;align-items:center;gap:7px;min-width:0;
  font-size:16px;font-weight:800;line-height:1.25;letter-spacing:-.01em;
}
.catBlock__badge{
  flex:0 0 auto;padding:1px 7px;border-radius:999px;
  background:rgba(255,255,255,.78);border:1px solid rgba(140,122,230,.28);
  color:#6B5AC4;font-size:10px;font-style:normal;font-weight:750;
}
.catBlock__hint{display:none;font-size:11px;color:#8B8378}
.catBlock__arrow{
  grid-column:3;grid-row:1;align-self:center;justify-self:end;
  width:18px;height:18px;display:grid;place-items:center;color:#B4AA9C;
}
.catBlock__children{
  grid-column:2 / 4;grid-row:2;display:flex;flex-wrap:wrap;align-items:center;
  min-width:0;
}
.catBlock__child{
  position:relative;padding:1px 0;font-size:12px;line-height:1.5;color:#7B746B;
  white-space:nowrap;transition:color .14s var(--ease);
}
.catBlock__child + .catBlock__child::before{
  content:'|';margin:0 7px;color:#D8CFC2;
}
.catBlock__child:hover{color:#27201B}
.catBlock__child.on{color:#B47800;font-weight:750}
.catBlock__child:disabled{opacity:.5;cursor:default}
.catBlock.is-disabled{opacity:.78}
.catBlock.is-disabled:hover{border-color:transparent;box-shadow:none}

/* 每类的极淡色块（reference_1） */
.tone-anime{background:linear-gradient(135deg,#F5F1FF,#EFEAFF)}
.tone-pets{background:linear-gradient(135deg,#FFF9EE,#FFF4E3)}
.tone-couples{background:linear-gradient(135deg,#FFF3F5,#FFEBEF)}
.tone-food{background:linear-gradient(135deg,#FFF3EF,#FFEDE7)}
.tone-plants{background:linear-gradient(135deg,#F2FBF4,#EAF7EE)}
.tone-lifestyle{background:linear-gradient(135deg,#FFFAF0,#FFF6E6)}
.tone-festivals{background:linear-gradient(135deg,#FFF2F6,#FFEAF2)}
.tone-cute{background:linear-gradient(135deg,#F1F9FF,#E9F5FF)}
.tone-beginner{background:linear-gradient(135deg,#FFFCEB,#FFF7D6)}
.tone-hot{background:linear-gradient(135deg,#FFF5EA,#FFEEDD)}
.tone-shop{background:linear-gradient(135deg,#F8F3FF,#F2ECFF)}

/* 展开动画 */
.catPanel-enter-active,.catPanel-leave-active{transition:opacity .18s var(--ease),transform .18s var(--ease)}
.catPanel-enter-from,.catPanel-leave-to{opacity:0;transform:translateY(-6px)}

@media(max-width:780px){
  /* 面板整体不超屏，并给底部标签栏留出空间；内容在面板内部滚动 */
  .catPanel{
    padding:14px 12px;border-radius:16px;max-height:62vh;
    display:flex;flex-direction:column;
  }
  .catPanel::before{left:30px}
  .catPanel__head{padding-bottom:10px;flex:0 0 auto}
  .catPanel__title h2{font-size:17px}
  .catPanel__title p{font-size:11px}
  .catPanel__tools{width:100%}
  .catPanel__search{width:auto;flex:1 1 auto;min-width:0;height:38px}
  .catPanel__close{width:34px;height:34px}
  .catPanel__body{
    grid-template-columns:minmax(0,1fr);gap:8px;
    flex:1 1 auto;min-height:0;max-height:none;
    padding:2px 0 2px 0;
  }
  .catPanel__col{gap:8px}
  .catBlock{
    grid-template-columns:44px minmax(0,1fr) 16px;padding:10px 12px;
    row-gap:0;border-radius:12px;
  }
  .catBlock__main{gap:10px}
  .catBlock__icon,.catBlock__icon img{width:40px;height:40px}
  .catBlock__name{font-size:14px}
  .catBlock__hint{display:block}
  .catBlock__children{
    grid-column:1 / -1;grid-row:2;gap:6px;padding:8px 0 2px 54px;
  }
  .catBlock__child{
    display:inline-flex;align-items:center;min-height:34px;padding:5px 10px;
    border-radius:999px;background:rgba(255,255,255,.72);
    border:1px solid rgba(237,228,215,.9);font-size:11px;
  }
  .catBlock__child + .catBlock__child::before{content:none;margin:0}
  .catBlock__child--all{background:#FFF3C4;border-color:#FFE29A;color:#8A6500;font-weight:750}
  .catBlock.is-open .catBlock__arrow{transform:rotate(90deg)}
  .catBlock__arrow{transition:transform .18s var(--ease)}
}
@media(prefers-reduced-motion:reduce){
  .catPanel-enter-active,.catPanel-leave-active{transition:none}
}
</style>
