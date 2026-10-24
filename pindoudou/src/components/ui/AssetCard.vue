<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { isLocked, isFavorite, toggleFavorite } from '../../composables/useAssets.js'
import { ALL_FREE } from '../../composables/useMembership.js'
import { difficultyTone } from '../../lib/forge.js'
import PixelIcon from './PixelIcon.vue'
const props = defineProps({
  asset: { type: Object, required: true },
  showFavorite: { type: Boolean, default: true },
  showDetailLink: { type: Boolean, default: true }
})
const emit = defineEmits(['pick'])

const locked = computed(() => isLocked(props.asset))
const fav = computed(() => isFavorite(props.asset.id))
const tone = computed(() => difficultyTone(props.asset.difficulty))
</script>

<template>
  <div class="assetCard">
    <span v-if="asset.tier === 'free'" class="tag free assetCard__tier">免费</span>
    <span v-else class="tag assetCard__tier" :class="ALL_FREE ? 'free' : 'pro'">{{ ALL_FREE ? '已开放' : 'PRO' }}</span>
    <span v-if="locked" class="assetCard__lock" title="会员专属素材"><PixelIcon name="lock" :size="12" /></span>

    <button
      v-if="showFavorite"
      class="favBtn"
      :class="{ on: fav }"
      :title="fav ? '取消收藏' : '收藏'"
      :aria-label="fav ? '取消收藏' : '收藏'"
      @click.stop.prevent="toggleFavorite(asset.id)"
    ><PixelIcon name="heart" :size="13" /></button>

    <button class="thumbBtn" @click="emit('pick', asset)">
      <div v-if="asset.image" class="assetCard__thumb">
        <img :src="asset.image" :alt="asset.name" loading="lazy">
      </div>
      <div v-else class="assetCard__thumb" v-html="asset.svg" />
    </button>

    <div class="assetCard__name" :title="asset.name">{{ asset.name }}</div>
    <div class="assetCard__meta">
      {{ asset.cat }}<template v-if="asset.remote"> · {{ asset.tags.slice(0, 2).join(' / ') || '平台素材' }}</template><template v-else> · {{ asset.difficulty }}</template>
    </div>

    <div class="assetCard__facts">
      <template v-if="asset.remote">
        <span>{{ asset.size }} px</span>
        <span>点击生成图纸</span>
      </template>
      <template v-else>
        <span>{{ asset.size }}</span>
        <span>{{ asset.colors }} 色</span>
        <span>{{ asset.minutes }} 分钟</span>
      </template>
    </div>

    <div class="assetCard__foot">
      <span v-if="asset.remote" class="tag" :class="tone">图片素材</span>
      <span v-else class="tag" :class="tone" :title="`画布共 ${asset.beads} 个插钉位`">{{ asset.beads.toLocaleString() }} 格</span>
      <RouterLink
        v-if="showDetailLink"
        class="detailLink"
        :to="`/library/${asset.id}`"
        @click.stop
      >详情 ›</RouterLink>
      <button v-else class="detailLink asBtn" @click="emit('pick', asset)">使用 ›</button>
    </div>
  </div>
</template>

<style scoped>
.assetCard{position:relative}
.thumbBtn{display:block;width:100%;padding:0;text-align:left}
.favBtn{
  position:absolute;right:9px;bottom:auto;top:9px;z-index:3;
  width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.9);
  display:grid;place-items:center;font-size:13px;color:var(--muted);box-shadow:var(--sh-1);
  transition:var(--t);
}
.assetCard__lock{right:39px}
.favBtn:hover{color:var(--coral)}
.favBtn.on{color:var(--coral);background:#fff}
.assetCard__foot{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:8px}
.assetCard__thumb img{object-fit:contain}
.detailLink{font-size:var(--fs-2xs);font-weight:800;color:var(--coral-deep)}
.asBtn{padding:0;background:none}
</style>
