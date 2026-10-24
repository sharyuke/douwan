<script setup>
import { computed, ref, watch } from 'vue'
import { isFavorite, toggleFavorite } from '../../composables/useAssets.js'
import { difficultyTone } from '../../lib/forge.js'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({
  asset: { type: Object, required: true }
})
defineEmits(['open'])

const imgError = ref(false)
watch(() => props.asset && props.asset.id, () => { imgError.value = false })

const fav = computed(() => isFavorite(props.asset.id))
const tone = computed(() => (props.asset.remote ? '' : difficultyTone(props.asset.difficulty)))
const badge = computed(() => (props.asset.remote ? '图片素材' : props.asset.difficulty || ''))
const meta = computed(() => {
  const a = props.asset
  if (a.remote) return a.size && a.size !== '—' ? `${a.size} px` : '平台素材'
  const bits = []
  if (a.size) bits.push(a.size)
  if (a.colors) bits.push(`${a.colors} 色`)
  return bits.join(' · ')
})
</script>

<template>
  <article class="mCard">
    <button
      type="button" class="mCard__media"
      :aria-label="`预览 ${asset.name}`"
      @click="$emit('open', asset)"
    >
      <img
        v-if="asset.image && !imgError"
        :src="asset.image" :alt="asset.name"
        loading="lazy" decoding="async"
        @error="imgError = true"
      >
      <div v-else-if="asset.svg && !imgError" class="mCard__svg" v-html="asset.svg"></div>
      <div v-else class="mCard__fallback">
        <PixelIcon name="photo" :size="26" />
        <span>{{ asset.image ? '图片加载失败' : '暂无预览' }}</span>
      </div>
      <span v-if="badge" class="mCard__badge" :class="tone">{{ badge }}</span>
      <span class="mCard__hover">预览</span>
    </button>

    <button
      type="button" class="mCard__fav" :class="{ on: fav }"
      :title="fav ? '取消收藏' : '收藏'"
      :aria-label="fav ? `取消收藏 ${asset.name}` : `收藏 ${asset.name}`"
      :aria-pressed="fav"
      @click.stop="toggleFavorite(asset.id)"
    ><PixelIcon name="heart" :size="14" /></button>

    <div class="mCard__body">
      <h3 class="mCard__name" :title="asset.name">{{ asset.name }}</h3>
      <p v-if="meta" class="mCard__meta">{{ meta }}</p>
    </div>
  </article>
</template>

<style scoped>
.mCard{
  position:relative;min-width:0;background:var(--surface);
  border:1px solid var(--line);border-radius:14px;padding:8px;
  transition:transform .18s var(--ease),box-shadow .18s var(--ease),border-color .18s var(--ease);
}
.mCard:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(82,62,24,.09);border-color:#EADFCB}
.mCard__media{
  position:relative;display:block;width:100%;aspect-ratio:4 / 3;padding:0;
  border-radius:10px;overflow:hidden;background:linear-gradient(135deg,#FFF9E4,#EAF8FB);
}
.mCard__media img{width:100%;height:100%;object-fit:contain;display:block}
.mCard__svg{width:100%;height:100%;display:grid;place-items:center}
.mCard__svg :deep(svg){width:92%;height:92%;display:block}
.mCard__fallback{
  width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  color:var(--muted-2);font-size:var(--fs-2xs);background:var(--surface-3);
}
.mCard__badge{
  position:absolute;left:8px;top:8px;z-index:2;padding:2px 8px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.94);color:var(--ink-2);font-size:11px;font-weight:700;
  box-shadow:0 1px 4px rgba(0,0,0,.06);
}
.mCard__badge.free{color:var(--green-deep)}
.mCard__badge.new{color:var(--yellow-deep)}
.mCard__badge.warn{color:var(--orange-deep)}
.mCard__badge.hot{color:var(--pink-deep)}
.mCard__fav{
  position:absolute;right:14px;top:14px;z-index:3;width:30px;height:30px;border-radius:50%;
  display:grid;place-items:center;background:rgba(255,255,255,.92);color:var(--muted);
  box-shadow:0 2px 8px rgba(0,0,0,.08);transition:var(--t);
}
.mCard__fav:hover{color:var(--coral-deep);background:#fff}
.mCard__fav.on{color:var(--coral-deep);background:#fff}
.mCard__hover{
  position:absolute;left:50%;bottom:9px;transform:translate(-50%,6px);
  padding:3px 10px;border-radius:var(--r-pill);background:rgba(31,41,55,.78);color:#fff;
  font-size:11px;font-weight:700;opacity:0;pointer-events:none;transition:var(--t);
}
.mCard__media:hover .mCard__hover,.mCard__media:focus-visible .mCard__hover{opacity:1;transform:translate(-50%,0)}
.mCard__body{padding:9px 3px 3px;min-width:0}
.mCard__name{
  font-size:var(--fs-sm);font-weight:800;line-height:1.35;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.mCard__meta{
  margin-top:2px;font-size:var(--fs-2xs);color:var(--muted-2);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
@media(hover:none){.mCard__hover{display:none}}
</style>
