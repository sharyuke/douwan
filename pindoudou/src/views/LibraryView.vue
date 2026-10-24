<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PixelIcon from '../components/ui/PixelIcon.vue'
import LibraryBanner from '../components/library/LibraryBanner.vue'
import LibraryCategoryTabs from '../components/library/LibraryCategoryTabs.vue'
import AllCategoriesPanel from '../components/library/AllCategoriesPanel.vue'
import LibraryFilters from '../components/library/LibraryFilters.vue'
import MaterialCard from '../components/library/MaterialCard.vue'
import MaterialPreviewDialog from '../components/library/MaterialPreviewDialog.vue'
import MaterialEmptyState from '../components/library/MaterialEmptyState.vue'
import {
  allAssets, favoriteAssets, favorites, libCol, libKeyword, loadRemoteAssets, remoteError, remoteLoaded, remoteLoading,
  setCollection
} from '../composables/useAssets.js'
import { toastWarn } from '../composables/useToast.js'
import { isLoggedIn } from '../composables/useUserAccount.js'
import {
  CATEGORY_BY_KEY, COLLECTION_BY_KEY, DIFFICULTY_OPTIONS, LEGACY_CATEGORY_ALIASES,
  LEGACY_SORT_ALIASES, PURPOSE_OPTIONS, SORT_TABS, categoryChildren, categoryLabel,
  inCategory, inCollection, matchesDifficulty, matchesPurpose, matchesSearch,
  matchesSubcategory, sortAssets
} from '../data/libraryCategories.js'

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 18
const sortMode = ref('recommended')
const diffFilter = ref('all')
const purposeFilter = ref('all')
const subFilter = ref('')
const collectionFilter = ref('')
/* 「我的收藏」：只看收藏的素材，分类筛选让位给收藏列表（个人中心「收藏素材」入口） */
const favOnly = ref(false)
const panelOpen = ref(false)
const visibleCount = ref(PAGE_SIZE)
const appliedKeyword = ref('')
const previewOpen = ref(false)
const previewAsset = ref(null)
const navPanelRef = ref(null)
const resultsRef = ref(null)

let searchTimer = null

/* 当前状态对应的地址栏参数（保留 query 里别的参数） */
function stateQuery() {
  const next = { ...route.query }
  if (favOnly.value) next.col = 'fav'
  else if (libCol.value === 'all' && !collectionFilter.value) delete next.col
  else next.col = libCol.value
  if (favOnly.value) delete next.collection
  else if (collectionFilter.value) next.collection = collectionFilter.value
  else delete next.collection
  if (subFilter.value) next.sub = subFilter.value
  else delete next.sub
  if (sortMode.value === 'recommended') delete next.sort
  else next.sort = sortMode.value
  if (diffFilter.value === 'all') delete next.diff
  else next.diff = diffFilter.value
  if (purposeFilter.value === 'all') delete next.purpose
  else next.purpose = purposeFilter.value
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
  let col = LEGACY_CATEGORY_ALIASES[rawCol] || rawCol
  let collection = typeof route.query.collection === 'string' ? route.query.collection : ''

  /* 旧链接：col=hot 是热门推荐，col=fav 是「我收藏的」 */
  favOnly.value = rawCol === 'fav'
  if (favOnly.value) {
    col = 'all'
    collection = ''
  } else if (rawCol === 'hot') {
    collection = 'hot'
    col = 'all'
  }
  if (!CATEGORY_BY_KEY[col]) col = 'all'
  /* 目前只有「热门推荐」有真实数据源；店主专区 / 原创精选暂不对外筛选 */
  if (collection !== 'hot' || !COLLECTION_BY_KEY[collection]) collection = ''
  setCollection(col)
  collectionFilter.value = collection

  let sort = typeof route.query.sort === 'string' ? route.query.sort : ''
  sort = LEGACY_SORT_ALIASES[sort] || sort
  if (!SORT_TABS.some(t => t.value === sort)) sort = 'recommended'
  sortMode.value = sort

  let diff = typeof route.query.diff === 'string' ? route.query.diff : ''
  diff = ({ beginner: 'easy', advanced: 'hard' })[diff] || diff
  diffFilter.value = DIFFICULTY_OPTIONS.some(o => o.value === diff) ? diff : 'all'

  const purpose = typeof route.query.purpose === 'string' ? route.query.purpose : ''
  purposeFilter.value = PURPOSE_OPTIONS.some(o => o.value === purpose) ? purpose : 'all'

  const sub = typeof route.query.sub === 'string' ? route.query.sub : ''
  const children = categoryChildren(collection || col)
  subFilter.value = children.includes(sub) ? sub : ''

  panelOpen.value = false
  visibleCount.value = PAGE_SIZE
}

onMounted(() => {
  readQuery()
  normalizeQuery()
  loadRemoteAssets()
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)
})

onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onDocKey)
})

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

watch([sortMode, diffFilter, purposeFilter, subFilter, collectionFilter], () => {
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
})

/* 「我的收藏」标签只给登录用户；退出登录后不要把用户留在收藏视图里 */
watch(isLoggedIn, v => {
  if (v || !favOnly.value) return
  favOnly.value = false
  normalizeQuery()
})

const filtered = computed(() => {
  let list = favOnly.value
    ? favoriteAssets.value.slice()
    : allAssets.value.filter(a => inCategory(a, libCol.value))
  if (collectionFilter.value) list = list.filter(a => inCollection(a, collectionFilter.value))
  if (subFilter.value) list = list.filter(a => matchesSubcategory(a, subFilter.value))
  if (diffFilter.value !== 'all') list = list.filter(a => matchesDifficulty(a, diffFilter.value))
  if (purposeFilter.value !== 'all') list = list.filter(a => matchesPurpose(a, purposeFilter.value))
  if (appliedKeyword.value) list = list.filter(a => matchesSearch(a, appliedKeyword.value))
  return sortAssets(list, sortMode.value, favorites.value)
})

const visibleAssets = computed(() => filtered.value.slice(0, visibleCount.value))

/* 卡片是统一规格的（方图 + 标题 + 色卡 + 收藏），所以用等宽网格，
   不再按列高拼瀑布流：方图在瀑布流里只是把列错开，反而看不出排序。 */

const remaining = computed(() => Math.max(0, filtered.value.length - visibleCount.value))
const hasMore = computed(() => remaining.value > 0)
const emptyMode = computed(() => {
  if (favOnly.value) return favoriteAssets.value.length ? 'search' : 'favorites'
  return allAssets.value.length ? 'search' : 'empty'
})

const currentName = computed(() =>
  collectionFilter.value ? categoryLabel(collectionFilter.value) : categoryLabel(libCol.value)
)
const heading = computed(() => {
  if (favOnly.value) return '我的收藏'
  if (collectionFilter.value) return currentName.value
  return libCol.value === 'all' ? '全部素材' : currentName.value
})
const summary = computed(() => {
  const total = filtered.value.length
  if (!total) return '共 0 个素材'
  if (!hasMore.value) return `共 ${total} 个素材`
  return `已显示 ${visibleCount.value} / 共 ${total} 个素材`
})
const hasActiveFilters = computed(() =>
  diffFilter.value !== 'all' || purposeFilter.value !== 'all' ||
  !!appliedKeyword.value || !!subFilter.value || sortMode.value !== 'recommended'
)

function scrollToResults() {
  nextTick(() => {
    const el = resultsRef.value
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 84
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  })
}

function togglePanel() {
  if (panelOpen.value) {
    panelOpen.value = false
    return
  }
  setCollection('all')
  favOnly.value = false
  collectionFilter.value = ''
  subFilter.value = ''
  panelOpen.value = true
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
}

function selectCategory(key) {
  const wasPanel = panelOpen.value
  favOnly.value = false
  collectionFilter.value = ''
  setCollection(key)
  if (!categoryChildren(key).includes(subFilter.value)) subFilter.value = ''
  panelOpen.value = false
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
  if (wasPanel || window.innerWidth <= 780) scrollToResults()
}

function selectChild({ category, child }) {
  favOnly.value = false
  collectionFilter.value = ''
  setCollection(category)
  subFilter.value = child || ''
  panelOpen.value = false
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
  scrollToResults()
}

function selectCollection({ collection, child }) {
  if (collection === 'shop') return
  favOnly.value = false
  collectionFilter.value = collection
  setCollection('all')
  subFilter.value = child || ''
  panelOpen.value = false
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
  scrollToResults()
}

function onUnavailable(item) {
  toastWarn(`${item.name}即将上线，敬请期待`)
}

function onKeyword(v) {
  libKeyword.value = v
}

/* 排序标签是「视图」的一部分：点任何一个排序都退出「我的收藏」 */
function onSort(v) {
  favOnly.value = false
  sortMode.value = v
}

function selectFavorites() {
  if (favOnly.value) return
  favOnly.value = true
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
}

function resetFilters() {
  clearTimeout(searchTimer)
  libKeyword.value = ''
  appliedKeyword.value = ''
  diffFilter.value = 'all'
  purposeFilter.value = 'all'
  subFilter.value = ''
  sortMode.value = 'recommended'
  visibleCount.value = PAGE_SIZE
  normalizeQuery()
}

function clearAll() {
  resetFilters()
  favOnly.value = false
  collectionFilter.value = ''
  setCollection('all')
  panelOpen.value = false
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

function onDocPointer(e) {
  if (!panelOpen.value) return
  if (navPanelRef.value && !navPanelRef.value.contains(e.target)) panelOpen.value = false
}

function onDocKey(e) {
  if (e.key === 'Escape' && panelOpen.value) panelOpen.value = false
}
</script>

<template>
  <div class="wrap main--pad libPage">
    <div class="libMain">
      <LibraryBanner />

      <div ref="navPanelRef" class="libNavWrap">
        <LibraryCategoryTabs
          :active="libCol"
          :panel-open="panelOpen"
          @select="selectCategory"
          @toggle-panel="togglePanel"
        />
        <AllCategoriesPanel
          :open="panelOpen"
          :active="libCol"
          :collection="collectionFilter"
          :child="subFilter"
          :keyword="libKeyword"
          @select-category="selectCategory"
          @select-child="selectChild"
          @select-collection="selectCollection"
          @update:keyword="onKeyword"
          @unavailable="onUnavailable"
          @close="panelOpen = false"
        />
      </div>

      <LibraryFilters
        :sort="sortMode"
        :diff="diffFilter"
        :purpose="purposeFilter"
        :keyword="libKeyword"
        :fav-visible="isLoggedIn"
        :fav-active="favOnly"
        @update:sort="onSort"
        @update:diff="diffFilter = $event"
        @update:purpose="purposeFilter = $event"
        @update:keyword="onKeyword"
        @select-favorites="selectFavorites"
      />

      <div ref="resultsRef" class="libResultBar">
        <div class="libResultBar__title">
          <h2>{{ heading }}</h2>
          <span v-if="subFilter" class="libSubChip">{{ subFilter }}</span>
        </div>
        <div class="libResultBar__right">
          <p>{{ summary }}</p>
          <button v-if="favOnly" type="button" class="libReset" @click="clearAll">查看全部素材</button>
          <button v-if="hasActiveFilters" type="button" class="libReset" @click="resetFilters">清空筛选</button>
        </div>
      </div>

      <div v-if="remoteError" class="libNotice">
        <span>平台素材暂时加载失败：{{ remoteError }}</span>
        <button type="button" class="btn sm" @click="loadRemoteAssets">重试</button>
      </div>
      <div v-else-if="remoteLoading && !remoteLoaded" class="libLoading">
        <i aria-hidden="true"></i>正在加载平台素材…
      </div>

      <template v-else>
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
      </template>

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
.libNavWrap{min-width:0;display:flex;flex-direction:column}
.libResultBar{
  display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:2px 2px 0;scroll-margin-top:84px;
}
.libResultBar__title{display:flex;align-items:center;gap:8px;min-width:0}
.libResultBar h2{font-size:18px;letter-spacing:-.02em}
.libResultBar p{font-size:12px;color:var(--muted-2)}
.libResultBar__right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.libReset{
  height:26px;padding:0 9px;border-radius:999px;border:1px solid #EDE4D7;
  background:#fff;color:#8A6500;font-size:12px;font-weight:700;
}
.libReset:hover{background:#FFF3C4;border-color:#FFE29A}
.libSubChip{
  display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:999px;
  background:#FFF3C4;border:1px solid #FFE29A;color:#8A6500;
  font-size:12px;font-weight:700;white-space:nowrap;
}
/* 统一规格卡片网格：卡片都是方图 + 标题 + 色卡 + 收藏，等高，不用瀑布流 */
.materialGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}
@media(max-width:1280px){.materialGrid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:1100px){.materialGrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
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
@media(max-width:780px){
  .libPage{padding-top:12px;padding-bottom:104px}
  .libMain{gap:12px}
  .materialGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .libResultBar h2{font-size:16px}
  .libMore .btn{width:100%;min-width:0}
}
</style>
