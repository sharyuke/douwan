<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PixelIcon from '../components/ui/PixelIcon.vue'
import LibraryBanner from '../components/library/LibraryBanner.vue'
import LibraryCategoryTabs from '../components/library/LibraryCategoryTabs.vue'
import LibraryFilters from '../components/library/LibraryFilters.vue'
import MaterialCard from '../components/library/MaterialCard.vue'
import MaterialPreviewDialog from '../components/library/MaterialPreviewDialog.vue'
import MaterialEmptyState from '../components/library/MaterialEmptyState.vue'
import {
  allAssets, favorites, libCol, libKeyword, loadRemoteAssets, remoteError, remoteLoaded, remoteLoading,
  setCollection
} from '../composables/useAssets.js'
import {
  CATEGORY_BY_KEY, DIFFICULTY_OPTIONS, LEGACY_CATEGORY_ALIASES, categoryLabel, inCategory, matchesSearch
} from '../data/libraryCategories.js'

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 18
const sortMode = ref('latest')
const diffFilter = ref('all')
const sizeFilter = ref('all')
const visibleCount = ref(PAGE_SIZE)
const appliedKeyword = ref('')
const previewOpen = ref(false)
const previewAsset = ref(null)

let searchTimer = null

/* 当前状态对应的地址栏参数（保留 query 里别的参数） */
function stateQuery() {
  const next = { ...route.query }
  if (libCol.value === 'all') delete next.col
  else next.col = libCol.value
  if (sortMode.value === 'latest') delete next.sort
  else next.sort = sortMode.value
  if (diffFilter.value === 'all') delete next.diff
  else next.diff = diffFilter.value
  if (sizeFilter.value === 'all') delete next.size
  else next.size = sizeFilter.value
  if (appliedKeyword.value) next.q = appliedKeyword.value
  else delete next.q
  return next
}

function queryInSync() {
  const next = stateQuery()
  const keys = new Set([...Object.keys(next), ...Object.keys(route.query)])
  for (const k of keys) {
    if (String(next[k] ?? '') !== String(route.query[k] ?? '')) return false
  }
  return true
}

function normalizeQuery() {
  if (queryInSync()) return
  router.replace({ query: stateQuery() }).catch(() => {})
}

function readQuery() {
  const q = typeof route.query.q === 'string' ? route.query.q : ''
  libKeyword.value = q
  appliedKeyword.value = q.trim()

  const rawCol = typeof route.query.col === 'string' ? route.query.col : ''
  const col = LEGACY_CATEGORY_ALIASES[rawCol] || rawCol
  if (col === 'fav') {
    sortMode.value = 'fav'
    setCollection('all')
  } else if (col && CATEGORY_BY_KEY[col]) {
    setCollection(col)
  } else {
    setCollection('all')
  }

  const s = typeof route.query.sort === 'string' ? route.query.sort : ''
  if (['latest', 'hot', 'fav'].includes(s)) sortMode.value = s
  const d = typeof route.query.diff === 'string' ? route.query.diff : ''
  diffFilter.value = ['beginner', 'easy', 'advanced'].includes(d) ? d : 'all'
  const z = typeof route.query.size === 'string' ? route.query.size : ''
  sizeFilter.value = ['29', '58'].includes(z) ? z : 'all'
  visibleCount.value = PAGE_SIZE
}

onMounted(() => {
  readQuery()
  normalizeQuery()
  loadRemoteAssets()
})

onBeforeUnmount(() => clearTimeout(searchTimer))

/* 页面不再随 query 重挂，所以外部改地址栏（顶栏「素材中心」、别处带 col 的链接）要在这里同步 */
watch(() => route.query, () => {
  if (route.name !== 'library' || queryInSync()) return
  clearTimeout(searchTimer)
  readQuery()
  normalizeQuery()
}, { deep: true })

/* 输入去抖：旧输入不会覆盖新结果（过滤是本地同步计算，永远读最新 appliedKeyword） */
watch(libKeyword, v => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    appliedKeyword.value = String(v || '').trim()
    visibleCount.value = PAGE_SIZE
    normalizeQuery()
  }, 220)
})

watch([sortMode, diffFilter, sizeFilter], () => {
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
})

const filtered = computed(() => {
  let list = allAssets.value.filter(a => inCategory(a, libCol.value))

  if (sortMode.value === 'fav') list = list.filter(a => favorites.value.includes(a.id))
  if (diffFilter.value !== 'all') {
    const d = DIFFICULTY_OPTIONS.find(x => x.value === diffFilter.value)
    if (d) list = list.filter(a => a.difficulty === d.match)
  }
  if (sizeFilter.value !== 'all') {
    list = list.filter(a => Number(a.grid) === Number(sizeFilter.value))
  }
  if (appliedKeyword.value) list = list.filter(a => matchesSearch(a, appliedKeyword.value))

  if (sortMode.value === 'hot') {
    return list.sort((a, b) => (Number(b.hot) || 0) - (Number(a.hot) || 0))
  }
  return list.sort((a, b) => {
    const an = a.isNew ? 1 : 0
    const bn = b.isNew ? 1 : 0
    if (an !== bn) return bn - an
    const ac = Number(a.createdAt) || 0
    const bc = Number(b.createdAt) || 0
    if (ac !== bc) return bc - ac
    return (Number(b.hot) || 0) - (Number(a.hot) || 0)
  })
})

const visibleAssets = computed(() => filtered.value.slice(0, visibleCount.value))
const remaining = computed(() => Math.max(0, filtered.value.length - visibleCount.value))
const hasMore = computed(() => remaining.value > 0)
const emptyMode = computed(() => (sortMode.value === 'fav' ? 'favorites' : 'search'))
const currentName = computed(() => categoryLabel(libCol.value))
const summary = computed(() => {
  const total = filtered.value.length
  if (!total) return '共 0 个素材'
  if (!hasMore.value) return `共 ${total} 个素材`
  return `已显示 ${visibleCount.value} / 共 ${total} 个素材`
})

function onCategory(key) {
  setCollection(key)
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
}

function clearSearch() {
  clearTimeout(searchTimer)
  libKeyword.value = ''
  appliedKeyword.value = ''
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
}

function clearAll() {
  clearTimeout(searchTimer)
  libKeyword.value = ''
  appliedKeyword.value = ''
  sortMode.value = 'latest'
  diffFilter.value = 'all'
  sizeFilter.value = 'all'
  setCollection('all')
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
}

function loadMore() {
  visibleCount.value += PAGE_SIZE
}

function openPreview(asset) {
  previewAsset.value = asset
  previewOpen.value = true
}

function onPreviewToggle(v) {
  previewOpen.value = v
  if (!v) previewAsset.value = null
}
</script>

<template>
  <div class="wrap main--pad libPage">
    <div class="libMain">
        <!-- 手机上顶栏放不下搜索框：这一页单独给一个搜索入口，桌面端用顶栏那个 -->
        <div class="libMobileSearch">
          <PixelIcon name="search" :size="15" />
          <input v-model="libKeyword" type="search" placeholder="搜索素材：猫 / 甜品 / 国风…" aria-label="搜索素材">
          <button v-if="libKeyword" type="button" aria-label="清空搜索" @click="clearSearch">
            <PixelIcon name="close" :size="12" />
          </button>
        </div>

        <LibraryBanner />

        <LibraryCategoryTabs :active="libCol" @select="onCategory" />

        <div class="libListHead">
          <div>
            <h2>{{ currentName }}</h2>
            <p>{{ summary }}</p>
          </div>
          <div v-if="appliedKeyword" class="searchChip">
            搜索「{{ appliedKeyword }}」
            <button type="button" aria-label="清空搜索" @click="clearSearch"><PixelIcon name="close" :size="10" /></button>
          </div>
        </div>

        <LibraryFilters
          v-model:sort="sortMode"
          v-model:diff="diffFilter"
          v-model:size="sizeFilter"
          :fav-count="favorites.length"
          @reset="diffFilter = 'all'; sizeFilter = 'all'"
        />

        <div v-if="remoteError" class="libNotice">
          <span>平台素材暂时加载失败：{{ remoteError }}</span>
          <button type="button" class="btn sm" @click="loadRemoteAssets">重试</button>
        </div>
        <div v-else-if="remoteLoading && !remoteLoaded" class="libLoading">
          <i aria-hidden="true"></i>正在加载平台素材…
        </div>

        <div v-if="visibleAssets.length" class="materialGrid">
          <MaterialCard
            v-for="a in visibleAssets" :key="a.id"
            :asset="a" @open="openPreview"
          />
        </div>
        <MaterialEmptyState
          v-else
          :mode="emptyMode"
          :keyword="appliedKeyword"
          @clear="clearAll"
        />

        <div v-if="hasMore" class="libMore">
          <button type="button" class="btn" @click="loadMore">加载更多（还有 {{ remaining }} 个）</button>
        </div>

        <p class="libCopyright">
          素材均为豆玩平台原创或已获得授权，全部免费开放。用户上传图片需确认拥有或已获得使用权利；
          如发现侵权内容，可通过帮助页的举报入口提交，我们会在核实后下架。
        </p>
    </div>

    <MaterialPreviewDialog
      :model-value="previewOpen"
      :asset="previewAsset"
      @update:model-value="onPreviewToggle"
    />
  </div>
</template>

<style scoped>
.libPage{padding-top:22px;display:flex;flex-direction:column}
.libMain{min-width:0;display:flex;flex-direction:column;gap:14px}
.libMobileSearch{display:none}
.libListHead{
  display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;
  margin-top:2px;
}
.libListHead h2{font-size:20px;letter-spacing:-.02em}
.libListHead p{margin-top:2px;font-size:var(--fs-2xs);color:var(--muted-2)}
.searchChip{
  display:inline-flex;align-items:center;gap:5px;padding:4px 6px 4px 10px;border-radius:999px;
  background:var(--primary-soft);color:var(--ink-2);font-size:var(--fs-2xs);font-weight:650;
}
.searchChip button{
  width:18px;height:18px;border-radius:50%;display:grid;place-items:center;
  background:rgba(255,255,255,.72);color:var(--ink-2);
}
.searchChip button:hover{background:#fff;color:var(--ink)}
.materialGrid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
.libNotice{
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 12px;border:1px solid #F6D3E3;border-radius:12px;
  background:var(--coral-soft);color:var(--coral-deep);font-size:var(--fs-2xs);
}
.libLoading{display:flex;align-items:center;gap:8px;font-size:var(--fs-2xs);color:var(--muted)}
.libLoading i{
  width:12px;height:12px;border-radius:50%;border:2px solid var(--line-strong);
  border-top-color:var(--primary-deep);animation:libSpin .8s linear infinite;
}
@keyframes libSpin{to{transform:rotate(360deg)}}
.libMore{display:flex;justify-content:center;padding:4px 0 2px}
.libMore .btn{min-width:220px}
.libCopyright{
  margin-top:4px;padding-top:14px;border-top:1px solid var(--line);
  font-size:11px;line-height:1.75;color:var(--muted-2);
}
@media(max-width:1399px){.materialGrid{grid-template-columns:repeat(5,minmax(0,1fr))}}
@media(max-width:1179px){.materialGrid{grid-template-columns:repeat(4,minmax(0,1fr))}}

@media(max-width:899px){.materialGrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:780px){
  .libPage{padding-top:12px;padding-bottom:104px}
  .libMain{gap:12px}
  .libMobileSearch{
    display:flex;align-items:center;gap:7px;height:42px;padding:0 12px;
    background:var(--surface);border:1px solid var(--line);border-radius:12px;
  }
  .libMobileSearch input{flex:1;min-width:0;border:0;background:transparent;outline:none;font-size:var(--fs-xs)}
  .libMobileSearch button{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:var(--muted)}
  .materialGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .libListHead h2{font-size:18px}
  .libMore .btn{width:100%;min-width:0}
}
</style>
