<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import { isFavorite, pickAsset, toggleFavorite } from '../../composables/useAssets.js'
import { difficultyTone } from '../../lib/forge.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  asset: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue'])

const router = useRouter()
const busy = ref(false)
const imgError = ref(false)

const fav = computed(() => (props.asset ? isFavorite(props.asset.id) : false))
const tone = computed(() => difficultyTone(props.asset?.difficulty))
const imageSrc = computed(() => (props.asset ? (props.asset.imageFull || props.asset.image || '') : ''))

watch(() => [props.modelValue, props.asset && props.asset.id], () => {
  busy.value = false
  imgError.value = false
})

function close() {
  emit('update:modelValue', false)
}

async function onUse() {
  if (!props.asset || busy.value) return
  busy.value = true
  const res = await pickAsset(props.asset.id)
  busy.value = false
  if (res.ok) {
    close()
    router.push('/editor').catch(() => {})
  }
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="asset ? asset.name : '素材预览'"
    size="lg"
    sheet
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="asset" class="preview">
      <div class="preview__media" :style="asset.featBg ? { background: asset.featBg } : null">
        <img
          v-if="imageSrc && !imgError"
          :src="imageSrc" :alt="asset.name"
          @error="imgError = true"
        >
        <div v-else-if="asset.svg && !imgError" class="preview__svg" v-html="asset.svg"></div>
        <div v-else class="preview__fallback">
          <PixelIcon name="photo" :size="34" />
          <span>{{ imageSrc ? '图片加载失败' : '暂无预览图' }}</span>
        </div>
      </div>

      <div class="preview__info">
        <div class="preview__tags">
          <span class="tag" :class="tone">{{ asset.difficulty }}</span>
          <span class="tag">{{ asset.cat }}</span>
          <span v-if="asset.isNew" class="tag new">新上架</span>
        </div>

        <div v-if="asset.remote" class="pStats">
          <div><b>{{ asset.size }}</b><span>图片尺寸</span></div>
          <div><b>{{ asset.cat }}</b><span>分类</span></div>
          <div class="wide"><b>{{ asset.tags.length ? asset.tags.slice(0, 3).join(' / ') : '—' }}</b><span>标签</span></div>
        </div>
        <div v-else class="pStats">
          <div><b>{{ asset.size }}</b><span>底板尺寸</span></div>
          <div><b>{{ asset.colors }}</b><span>颜色数</span></div>
          <div><b>{{ asset.beads.toLocaleString() }}</b><span>画布格数</span></div>
          <div><b>{{ asset.minutes }} 分钟</b><span>预计时间</span></div>
        </div>

        <p v-if="asset.remote && asset.description" class="preview__desc">{{ asset.description }}</p>
        <p class="preview__hint">
          一键使用会把这张素材载入工作台并生成可编辑图纸，颜色数量、画布大小都能再调。
        </p>

        <div class="preview__actions">
          <button type="button" class="btn primary lg" :disabled="busy" @click="onUse">
            {{ busy ? '正在载入…' : '一键使用' }}
          </button>
          <button
            type="button" class="btn lg" :class="{ 'is-fav': fav }"
            :aria-pressed="fav"
            @click="toggleFavorite(asset.id)"
          >
            <PixelIcon name="heart" :size="15" />{{ fav ? '已收藏' : '收藏' }}
          </button>
        </div>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.preview{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:20px;align-items:start}
.preview__media{
  aspect-ratio:4 / 3;min-height:280px;border-radius:14px;overflow:hidden;
  background:linear-gradient(135deg,#FFF9E4,#EAF8FB);
  display:grid;place-items:center;padding:18px;
}
.preview__media img{width:100%;height:100%;object-fit:contain;display:block}
.preview__svg{width:100%;height:100%;display:grid;place-items:center}
.preview__svg :deep(svg){width:94%;height:94%;display:block}
.preview__fallback{
  display:flex;flex-direction:column;align-items:center;gap:8px;
  color:var(--muted-2);font-size:var(--fs-2xs);
}
.preview__info{min-width:0;display:flex;flex-direction:column;gap:13px}
.preview__tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pStats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pStats > div{
  padding:10px 11px;border-radius:11px;background:var(--surface-2);
  border:1px solid var(--line);display:flex;flex-direction:column;gap:2px;min-width:0;
}
.pStats > div.wide{grid-column:1 / -1}
.pStats b{font-size:15px;font-weight:850;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pStats span{font-size:var(--fs-2xs);color:var(--muted-2)}
.preview__desc{
  font-size:var(--fs-xs);color:var(--ink-2);line-height:1.7;
  padding:10px 12px;border-radius:11px;background:var(--surface-2);border:1px solid var(--line);
}
.preview__hint{font-size:var(--fs-2xs);color:var(--muted);line-height:1.7}
.preview__actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:2px}
.preview__actions .btn{flex:1 1 auto}
.preview__actions .is-fav{color:var(--coral-deep);border-color:#F6D3E3;background:var(--coral-soft)}
@media(max-width:780px){
  .preview{grid-template-columns:1fr;gap:14px}
  .preview__media{min-height:0;aspect-ratio:4 / 3;max-height:36vh;padding:12px}
  .preview__actions .btn{flex:1 1 140px}
}
</style>
