<script setup>
/* 素材库弹窗（Figma 124:2139）：搜索 / 用途 / 难度 / 分类标签 / 排序 / 分页 / 选中预览。
   素材来源与素材中心同一份数据（后台已发布素材优先，没有就退回内置素材）。 */
import { computed, ref, watch } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import Icon from '../ui/Icon.vue'
import { loadRemoteAssets, remoteAssets, freeAssets, pickAsset } from '../../composables/useAssets.js'
import { matchesPurpose, sortAssets } from '../../data/libraryCategories.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const PAGE_SIZE = 6
const CATS = [
  { key: 'all', label: '全部' },
  { key: 'anime', label: '二次元' },
  { key: 'pet', label: '萌宠动物' },
  { key: 'couple', label: '情侣情感' },
  { key: 'food', label: '美食水果' },
  { key: 'plant', label: '植物花卉' },
  { key: 'life', label: '生活美学' },
  { key: 'holiday', label: '节日祝福' },
  { key: 'cute', label: '萌趣日常' },
  { key: 'beginner', label: '新手专区' }
]
const CAT_MAP = {
  二次元: 'anime', 幻想: 'anime',
  动物: 'pet', 萌宠动物: 'pet',
  情侣: 'couple', 情侣情感: 'couple',
  甜品: 'food', 水果: 'food', 美食水果: 'food',
  植物: 'plant', 植物花卉: 'plant',
  国风: 'life', 生活美学: 'life',
  节日: 'holiday', 节日祝福: 'holiday',
  可爱: 'cute', 头像: 'cute', 萌趣日常: 'cute'
}
const PURPOSES = [
  { value: 'all', label: '全部' },
  { value: 'keychain', label: '钥匙扣' },
  { value: 'fridge_magnet', label: '冰箱贴' },
  { value: 'coaster', label: '杯垫' },
  { value: 'hanging', label: '挂饰' },
  { value: 'ornament', label: '摆件' },
  { value: 'wall_art', label: '装饰画' }
]
const SORTS = [
  { key: 'recommended', label: '推荐' },
  { key: 'newest', label: '最新' },
  { key: 'hottest', label: '最热' },
  { key: 'most_favorited', label: '收藏最多' }
]

const query = ref('')
const purpose = ref('all')
const difficulty = ref('all')
const cat = ref('all')
const sort = ref('recommended')
const page = ref(1)
const selected = ref(null)
const busy = ref(false)

const pool = computed(() => {
  const remoteFree = remoteAssets.value.filter(a => a.tier === 'free')
  return remoteFree.length ? remoteFree : freeAssets
})

function catKeyOf(a) {
  if (cat.value === 'beginner') return true
  if (cat.value === 'all') return true
  return CAT_MAP[a.cat] === cat.value
}

const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  const rows = pool.value.filter(a => {
    if (!catKeyOf(a)) return false
    if (cat.value === 'beginner' && Number(a.colors) > 10) return false
    if (difficulty.value !== 'all' && a.difficulty !== difficulty.value) return false
    if (!matchesPurpose(a, purpose.value)) return false
    if (q && !`${a.name} ${a.cat}`.toLowerCase().includes(q)) return false
    return true
  })
  return sortAssets(rows, sort.value)
})

const total = computed(() => list.value.length)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const pageRows = computed(() => list.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

watch([query, purpose, difficulty, cat, sort], () => { page.value = 1 })
watch(pages, n => { if (page.value > n) page.value = n })

watch(() => props.modelValue, v => {
  if (!v) return
  loadRemoteAssets().catch(() => {})
})

function dots(a) {
  const src = String(a.svg || '')
  const hexes = [...src.matchAll(/#([0-9a-fA-F]{6})/g)].map(m => `#${m[1]}`).filter(h => {
    const n = parseInt(h.slice(1), 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    return !(r > 245 && g > 245 && b > 245)
  })
  return [...new Set(hexes)].slice(0, 4)
}

function pick(a) {
  selected.value = selected.value && selected.value.id === a.id ? null : a
}

async function confirm() {
  if (!selected.value || busy.value) return
  busy.value = true
  try {
    /* 后台素材要下载原图再走上传链路；直接 svgToImage 会把没有 svg 的素材
       当成 "undefined" 的 SVG，加载必失败。pickAsset 按 remote 分流并给提示。 */
    const res = await pickAsset(selected.value.id)
    if (res.ok) emit('update:modelValue', false)
  } finally {
    busy.value = false
  }
}

function resetFilters() {
  query.value = ''
  purpose.value = 'all'
  difficulty.value = 'all'
  cat.value = 'all'
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue" title="素材库" head-icon="fn-library"
    dialog-class="cmdDlg" @update:model-value="v => emit('update:modelValue', v)"
  >
    <template #headExtra><span class="matHead__count">{{ total }} 个</span></template>

    <div class="matFilters">
      <label class="matSearch">
        <Icon name="search" :size="16" />
        <input v-model="query" type="search" placeholder="搜索素材名称" aria-label="搜索素材名称">
      </label>
      <label class="matSelect">
        <span>用途</span>
        <select v-model="purpose">
          <option v-for="p in PURPOSES" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
        <Icon name="chevron-down" :size="16" />
      </label>
      <label class="matSelect">
        <span>难度</span>
        <select v-model="difficulty">
          <option value="all">全部</option>
          <option value="入门">入门</option>
          <option value="简单">简单</option>
          <option value="进阶">进阶</option>
        </select>
        <Icon name="chevron-down" :size="16" />
      </label>
    </div>

    <div class="matChips" role="tablist" aria-label="素材分类">
      <button
        v-for="c in CATS" :key="c.key" type="button" role="tab"
        :class="{ on: cat === c.key }" :aria-selected="cat === c.key"
        @click="cat = c.key"
      >{{ c.label }}</button>
    </div>

    <div class="matBar">
      <span>全部素材 · {{ total }} 个</span>
      <div class="matSort">
        <button
          v-for="s in SORTS" :key="s.key" type="button"
          :class="{ on: sort === s.key }" @click="sort = s.key"
        >{{ s.label }}</button>
      </div>
    </div>

    <div v-if="pageRows.length" class="matGrid">
      <button
        v-for="a in pageRows" :key="a.id" type="button"
        class="matCard" :class="{ on: selected && selected.id === a.id }"
        @click="pick(a)"
      >
        <span class="matCard__art">
          <img v-if="a.image" :src="a.image" :alt="a.name" loading="lazy" decoding="async">
          <span v-else class="matCard__svg" v-html="a.svg" />
          <em class="matCard__badge">{{ a.difficulty || '入门' }}</em>
          <i v-if="selected && selected.id === a.id" class="matCard__check"><Icon name="check" :size="16" /></i>
        </span>
        <span class="matCard__row">
          <b>{{ a.name }}</b>
          <Icon name="star" :size="16" />
        </span>
        <span class="matCard__row matCard__row--sub">
          <span>{{ a.difficulty || '入门' }}</span>
          <span class="matCard__dots"><i v-for="(c, i) in dots(a)" :key="i" :style="{ background: c }" /></span>
        </span>
      </button>
    </div>
    <div v-else class="matEmpty">
      <Icon name="search" :size="24" />
      <b>这个筛选下没有素材</b>
      <button type="button" class="btn btn-secondary" @click="resetFilters">清除筛选</button>
    </div>

    <div class="matPager">
      <button type="button" aria-label="上一页" :disabled="page <= 1" @click="page -= 1">
        <Icon name="chevron-down" :size="16" />
      </button>
      <span class="matPager__now">{{ page }}</span>
      <span class="matPager__all">/ {{ pages }}</span>
      <button type="button" aria-label="下一页" :disabled="page >= pages" @click="page += 1">
        <Icon name="chevron-down" :size="16" />
      </button>
    </div>

    <template #footer="{ close }">
      <span class="cmdFoot__note">
        <template v-if="selected">
          <span class="matFoot__thumb">
            <img v-if="selected.image" :src="selected.image" :alt="selected.name">
            <span v-else v-html="selected.svg" />
          </span>
          已选择 <b>{{ selected.name }}</b>
        </template>
        <template v-else>选择一个素材后可以使用到画布</template>
      </span>
      <div class="cmdFoot__actions">
        <button type="button" class="btn btn-secondary" @click="close">取消</button>
        <button type="button" class="btn primary" :disabled="!selected || busy" @click="confirm">
          {{ busy ? '载入中…' : '使用素材到画布' }}
          <Icon v-if="!busy" name="arrow-right" :size="16" />
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.matHead__count{font-size:var(--fs-xs);color:var(--muted);font-weight:500;line-height:var(--ty-label-lh)}
.matFilters{display:grid;grid-template-columns:1fr 168px 148px;gap:10px}
.matSearch{
  display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;
  border:1px solid var(--line);border-radius:12px;background:var(--surface);
}
.matSearch input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:var(--fs-sm);color:var(--ink);outline:none;line-height:var(--ty-body-lh)}
.matSelect{
  position:relative;display:flex;align-items:center;gap:6px;height:38px;padding:0 10px;
  border:1px solid var(--line);border-radius:12px;background:var(--surface);
}
.matSelect>span{font-size:var(--fs-xs);color:var(--muted);flex:0 0 auto;line-height:var(--ty-label-lh)}
.matSelect select{
  flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:var(--fs-sm);
  color:var(--ink);appearance:none;outline:none;padding-right:16px;cursor:pointer;line-height:var(--ty-body-lh)
}
.matSelect .pixelIcon{position:absolute;right:9px;pointer-events:none}
.matChips{display:flex;flex-wrap:nowrap;gap:2px;margin-top:14px;overflow-x:auto;scrollbar-width:none}
.matChips::-webkit-scrollbar{display:none}
.matChips button{
  height:30px;padding:0 9px;border-radius:99px;font-size:var(--fs-xs);font-weight:700;
  color:var(--ink-2);background:transparent;border:1px solid transparent;transition:var(--t);
  flex:0 0 auto;white-space:nowrap;line-height:var(--ty-label-lh)
}
.matChips button:hover{background:var(--surface-3)}
.matChips button.on{background:var(--primary);color:var(--primary-ink);border-color:var(--primary)}
.matBar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0 10px}
.matBar>span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.matSort{display:flex;gap:12px}
.matSort button{font-size:var(--fs-xs);font-weight:500;color:var(--muted);background:none;border:0;padding:0;line-height:var(--ty-label-lh)}
.matSort button:hover{color:var(--ink)}
.matSort button.on{color:var(--ink);font-weight:700;text-decoration:underline;text-underline-offset:4px}
.matGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.matCard{
  display:flex;flex-direction:column;gap:6px;padding:8px 8px 10px;text-align:left;
  border:1px solid var(--line);border-radius:14px;background:var(--surface);transition:var(--t);
}
.matCard:hover{border-color:var(--line-strong);box-shadow:0 2px 10px rgba(31,31,29,.05)}
.matCard.on{border-color:var(--primary-deep);box-shadow:0 0 0 1px var(--primary-deep) inset}
.matCard__art{
  position:relative;display:grid;place-items:center;aspect-ratio:1 / 1;border-radius:10px;
  background:#FBFDF6;overflow:hidden;
}
/* 完整显示整张素材：cover 会把竖图上下裁掉，contain 才能看到全貌 */
.matCard__art img{width:100%;height:100%;object-fit:contain;padding:4px}
.matCard__svg{display:block;width:100%;height:100%}
.matCard__svg :deep(svg){width:100%;height:100%;display:block}
.matCard__badge{
  position:absolute;left:6px;top:6px;font-style:normal;font-size:12px;font-weight:700;
  padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.9);color:var(--ink-2);line-height:var(--ty-caption-lh)
}
.matCard__check{
  position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:7px;
  display:grid;place-items:center;background:var(--primary);color:var(--primary-ink);
}
.matCard__row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px}
.matCard__row b{font-size:var(--fs-sm);font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:var(--ty-body-lh)}
.matCard__row .pixelIcon{color:var(--muted-2)}
.matCard__row--sub span:first-child{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.matCard__dots{display:flex;gap:3px}
.matCard__dots i{width:8px;height:8px;border-radius:50%;display:block}
.matEmpty{
  min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  border:1px dashed var(--line-strong);border-radius:14px;color:var(--muted);
}
.matEmpty b{font-size:var(--fs-sm);color:var(--ink-2);line-height:var(--ty-body-lh)}
.matPager{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px}
.matPager button{
  width:30px;height:30px;border-radius:9px;border:1px solid var(--line);background:var(--surface);
  display:grid;place-items:center;color:var(--ink-2);
}
.matPager button:disabled{opacity:.4;cursor:not-allowed}
.matPager button:first-child .pixelIcon{transform:rotate(90deg)}
.matPager button:last-child .pixelIcon{transform:rotate(-90deg)}
.matPager__now{
  min-width:30px;height:30px;border-radius:9px;background:var(--primary);color:var(--primary-ink);
  display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700;line-height:var(--ty-label-lh)
}
.matPager__all{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.matFoot__thumb{
  width:30px;height:30px;border-radius:8px;overflow:hidden;background:var(--surface-3);flex:0 0 auto;
  display:grid;place-items:center;
}
.matFoot__thumb img{width:100%;height:100%;object-fit:contain}
.matFoot__thumb :deep(svg){width:100%;height:100%;display:block}
@media(max-width:780px){
  .matFilters{grid-template-columns:1fr 1fr}
  .matSearch{grid-column:1/-1}
  .matGrid{grid-template-columns:repeat(2,1fr)}
}
</style>
