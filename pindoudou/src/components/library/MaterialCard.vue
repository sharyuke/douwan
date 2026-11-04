<script setup>
import { computed, ref, watch } from 'vue'
import { isFavorite, toggleFavorite } from '../../composables/useAssets.js'
import { difficultyTone } from '../../lib/forge.js'
import { dominantColors } from '../../lib/imageColors.js'
import Icon from '../ui/Icon.vue'

const props = defineProps({
  asset: { type: Object, required: true }
})
defineEmits(['open'])

const imgError = ref(false)
watch(() => props.asset && props.asset.id, () => { imgError.value = false })

const fav = computed(() => isFavorite(props.asset.id))
const tone = computed(() => difficultyTone(props.asset.difficulty))
const badge = computed(() => props.asset.difficulty || '')

/* 点赞数：1000 以上缩成 1.2k，和参考稿的写法一致 */
const likeText = computed(() => {
  const n = Number(props.asset.likeCount) || 0
  if (n <= 0) return ''
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
})

/* 卡片底部的色卡：从缩略图里抽主色（见 lib/imageColors.js）。
   素材切换时用 token 丢掉上一张迟到的结果。 */
const dots = ref([])
let dotsToken = 0
watch(() => props.asset && props.asset.image, async url => {
  const token = ++dotsToken
  const colors = url ? await dominantColors(url) : []
  if (token === dotsToken) dots.value = colors
}, { immediate: true })
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
        <Icon name="image" :size="24" />
        <span>{{ asset.image ? '图片加载失败' : '暂无预览' }}</span>
      </div>
      <span v-if="badge" class="mCard__badge" :class="tone">{{ badge }}</span>
      <span v-if="likeText" class="mCard__likes" :aria-label="`${asset.likeCount} 人点赞`">
        <Icon class="mCard__likeIcon" name="heart" :size="16" />
        <b>{{ likeText }}</b>
      </span>
      <span class="mCard__hover">预览</span>
    </button>

    <div class="mCard__body">
      <div class="mCard__info">
        <h3 class="mCard__name" :title="asset.name">{{ asset.name }}</h3>
      </div>
      <button
        type="button" class="mCard__fav hit32" :class="{ on: fav }"
        :title="fav ? '取消收藏' : '收藏'"
        :aria-label="fav ? `取消收藏 ${asset.name}` : `收藏 ${asset.name}`"
        :aria-pressed="fav"
        @click.stop="toggleFavorite(asset.id)"
      ><Icon class="mCard__favIcon" name="star" :size="16" /></button>
      <span v-if="dots.length" class="mCard__dots" aria-hidden="true">
        <i v-for="(c, i) in dots" :key="i" :style="{ background: c }" />
      </span>
    </div>
  </article>
</template>

<style scoped>
.mCard{
  position:relative;min-width:0;background:#fff;
  border:1px solid #F3EBDD;border-radius:16px;padding:6px;
  box-shadow:0 2px 8px rgba(82,62,24,.05);
  transition:transform .18s var(--ease),box-shadow .18s var(--ease),border-color .18s var(--ease);
}
.mCard:hover{transform:translateY(-3px);box-shadow:0 12px 26px rgba(82,62,24,.10);border-color:#EADFCC}

/* 米色方图底：缩略图是铺白底的 JPEG，multiply 把白底融进暖色渐变，图案直接浮在上面 */
.mCard__media{
  position:relative;display:block;width:100%;aspect-ratio:1 / 1;padding:0;
  border-radius:12px;overflow:hidden;isolation:isolate;
  background:linear-gradient(165deg,#FDEFDE 0%,#FDF5E7 55%,#FEFCF8 100%);
}
/* 只铺缩略图本身：点赞爱心也在这张卡里，别把它一起拉满（> 子选择器） */
.mCard__media > img{
  width:100%;height:100%;display:block;object-fit:contain;padding:5px;
  mix-blend-mode:multiply;
}
.mCard__svg{width:100%;aspect-ratio:1 / 1;display:grid;place-items:center}
.mCard__svg :deep(svg){width:92%;height:92%;display:block}
.mCard__fallback{
  width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  color:var(--muted-2);font-size:var(--fs-2xs);background:var(--surface-3);line-height:var(--ty-caption-lh)
}

/* 难度胶囊：浅色底 + 同色系深字，和参考稿一样是圆角药丸 */
.mCard__badge{
  position:absolute;left:7px;top:7px;z-index:2;padding:3px 9px;border-radius:999px;
  background:#E4F7EA;color:#2E8B57;font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);
  box-shadow:0 1px 3px rgba(46,139,87,.10);
}
.mCard__badge.new{background:#FFF3D9;color:#B27413;box-shadow:0 1px 3px rgba(178,116,19,.10)}
.mCard__badge.warn{background:#FDE9E4;color:#C04A34;box-shadow:0 1px 3px rgba(192,74,52,.10)}
.mCard__badge.hot{background:#FBE0DA;color:#A93424;box-shadow:0 1px 3px rgba(169,52,36,.10)}

/* 点赞数：右上角粉色桃心 + 数字 */
.mCard__likes{
  position:absolute;right:8px;top:8px;z-index:2;
  display:flex;align-items:center;gap:3px;color:#FE435F;
  font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;
}
.mCard__likes b{font-weight:700}
/* 图标规范 16px 档：线色跟着数字一起用点赞红 */
.mCard__likeIcon{flex:0 0 auto;color:inherit}

.mCard__hover{
  position:absolute;left:50%;bottom:8px;transform:translate(-50%,6px);
  padding:3px 9px;border-radius:var(--r-pill);background:rgba(31,41,55,.78);color:#fff;
  font-size:12px;font-weight:700;opacity:0;pointer-events:none;transition:var(--t);line-height:var(--ty-caption-lh)
}
.mCard__media:hover .mCard__hover,.mCard__media:focus-visible .mCard__hover{opacity:1;transform:translate(-50%,0)}

/* 信息区：标题 + 尺寸在左，收藏按钮在右；色卡单独占下一行 */
.mCard__body{
  display:grid;grid-template-columns:minmax(0,1fr) auto;
  grid-template-areas:"info fav" "dots dots";
  column-gap:8px;row-gap:6px;align-items:center;
  padding:8px 3px 2px;min-width:0;
}
.mCard__info{grid-area:info;min-width:0}
.mCard__name{
  font-size:13px;font-weight:700;line-height:var(--ty-label-lh);color:var(--ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.mCard__fav{
  grid-area:fav;width:30px;height:30px;flex:0 0 auto;border-radius:9px;
  /* padding 归零：手机上按钮缩到 30px，全局 button 的内边距会把星星挤成 16×18 */
  padding:0;
  border:1px solid #F6D98C;background:#FFF8DE;color:#F0B01C;
  display:grid;place-items:center;transition:var(--t);
}
.mCard__favIcon{display:block;color:inherit}
.mCard__fav:hover{background:#FFF0B8;border-color:#EFC35A;color:#E9A400}
.mCard__fav.on{background:var(--primary);border-color:var(--primary-deep);color:var(--ink)}
.mCard__dots{grid-area:dots;display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden}
.mCard__dots i{
  width:8px;height:8px;border-radius:50%;display:block;flex:0 0 auto;
  box-shadow:inset 0 0 0 1px rgba(36,29,25,.08);
}

@media(hover:none){.mCard__hover{display:none}}
@media(max-width:780px){
  .mCard{padding:7px;border-radius:16px}
  .mCard__media{border-radius:12px}
  .mCard__body{padding:8px 2px 1px;column-gap:8px;row-gap:7px}
  .mCard__name{font-size:13px;line-height:var(--ty-label-lh)}
  .mCard__fav{width:30px;height:30px;border-radius:9px}
  .mCard__dots i{width:8px;height:8px}
  .mCard__badge{padding:3px 8px;font-size:12px;line-height:var(--ty-caption-lh)}
  .mCard__likes{font-size:12px;line-height:var(--ty-caption-lh)}
}
</style>
