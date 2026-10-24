<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AssetCard from '../components/ui/AssetCard.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import {
  assetBySlug, allAssets, loadRemoteAssets, pickAsset, isFavorite, toggleFavorite
} from '../composables/useAssets.js'
import { difficultyTone, buildStars } from '../lib/forge.js'
import { setCollection } from '../composables/useAssets.js'
import { libraryCategoryForAsset } from '../data/libraryCategories.js'

const route = useRoute()
const router = useRouter()
const busy = ref(false)

const asset = computed(() => assetBySlug(route.params.slug))
onMounted(loadRemoteAssets)
const fav = computed(() => (asset.value ? isFavorite(asset.value.id) : false))
const categoryKey = computed(() => libraryCategoryForAsset(asset.value))
const tone = computed(() => difficultyTone(asset.value?.difficulty))

/** 同分类推荐 */
const similar = computed(() => {
  if (!asset.value) return []
  return allAssets.value
    .filter(a => a.id !== asset.value.id && a.cols.some(c => asset.value.cols.includes(c)))
    .slice(0, 4)
})

/** 这个素材的预估可拼性：颜色越少、尺寸越小越容易 */
const estimate = computed(() => {
  const a = asset.value
  if (!a || a.remote) return null
  const colorPenalty = Math.max(0, a.colors - 8) * 1.6
  const sizePenalty = Math.max(0, a.grid - 29) * 0.09
  const score = Math.round(Math.max(60, Math.min(97, 96 - colorPenalty - sizePenalty)))
  return { score, stars: buildStars(score) }
})

async function onUse() {
  if (!asset.value) return
  busy.value = true
  const res = await pickAsset(asset.value.id)
  busy.value = false
  if (res.ok) router.push('/editor')
}

function goCategory() {
  if (!asset.value) return
  const key = categoryKey.value
  setCollection(key)
  router.push({ path: '/library', query: key === 'all' ? {} : { col: key } })
}

async function onPickSimilar(a) {
  busy.value = true
  const res = await pickAsset(a.id)
  busy.value = false
  if (res.ok) router.push('/editor')
}
</script>

<template>
  <div class="wrap main--pad">
    <div v-if="!asset" class="empty">
      <div class="empty__icon"><PixelIcon name="search" :size="24" /></div>
      <strong>找不到这个素材</strong>
      <p>链接可能已失效，或者这个素材已经下架。</p>
      <RouterLink to="/library" class="btn primary">回到素材中心</RouterLink>
    </div>

    <template v-else>
      <div class="crumb">
        <RouterLink to="/library">素材中心</RouterLink>
        <span>/</span>
        <RouterLink :to="{ path: '/library', query: categoryKey === 'all' ? {} : { col: categoryKey } }">{{ asset.cat }}</RouterLink>
        <span>/</span>
        <b>{{ asset.name }}</b>
      </div>

      <div class="detailGrid">
        <div class="card">
          <div class="detailPreview" :style="asset.featBg ? { background: asset.featBg } : null">
            <div class="detailPreview__inner">
              <img v-if="asset.image" :src="asset.imageFull || asset.image" :alt="asset.name">
              <div v-else class="detailPreview__svg" v-html="asset.svg"></div>
            </div>
          </div>
          <div class="card__body">
            <div class="row row--between row--wrap">
              <div class="row">
                <span class="tag free">免费开放</span>
                <span v-if="asset.isNew" class="tag new">新上架</span>
                <span class="tag" :class="tone">{{ asset.difficulty }}</span>
              </div>
              <button class="btn btn-secondary sm" @click="toggleFavorite(asset.id)"><PixelIcon name="heart" :size="14" />{{ fav ? '已收藏' : '收藏' }}</button>
            </div>
          </div>
        </div>

        <div class="col">
          <div class="card">
            <div class="card__head"><h3>{{ asset.name }}</h3><span class="muted">{{ asset.cat }}</span></div>
            <div class="card__body stack">
              <div v-if="asset.remote" class="stats">
                <div class="stat tone-3"><b>{{ asset.size }}</b><span>图片尺寸（px）</span></div>
                <div class="stat tone-2"><b>免费</b><span>素材权益</span></div>
                <div class="stat tone-1"><b>{{ asset.cat }}</b><span>分类</span></div>
                <div class="stat tone-4"><b>{{ asset.tags.length ? asset.tags.slice(0, 2).join(' / ') : '—' }}</b><span>标签</span></div>
              </div>
              <div v-else class="stats">
                <div class="stat tone-3"><b>{{ asset.size }}</b><span>底板尺寸</span></div>
                <div class="stat tone-2"><b>{{ asset.colors }}</b><span>颜色数</span></div>
                <div class="stat tone-1"><b>{{ asset.beads.toLocaleString() }}</b><span>画布格数</span></div>
                <div class="stat tone-4"><b>{{ asset.minutes }} 分钟</b><span>预计拼制时间</span></div>
              </div>
              <p v-if="asset.remote && asset.description" class="hint">{{ asset.description }}</p>
              <p v-if="!asset.remote" class="hint">
                画布格数 = 底板尺寸 × 底板尺寸 的全部插钉位；实际用豆量取决于图案留白，
                生成图纸后按真实网格统计。1 格 = 1 颗豆。
              </p>

              <div v-if="estimate" class="boardInfo">
                <div class="row row--between">
                  <b>预估可拼性</b>
                  <span class="row" style="gap:6px">
                    <span class="stars">
                      <PixelIcon v-for="i in estimate.stars.filled" :key="`f${i}`" name="star" :size="14" />
                      <PixelIcon v-for="i in estimate.stars.empty" :key="`e${i}`" name="star" :size="14" class="is-empty" />
                    </span>
                    {{ estimate.score }}
                  </span>
                </div>
                <p class="hint" style="margin-top:6px">
                  按颜色数与画布尺寸推算。实际数值在你生成图纸后按真实网格数据计算。
                </p>
              </div>

              <div v-if="!asset.remote" class="boardInfo">
                素材按 {{ asset.boards }} × {{ asset.boards }} 幅整块拼板画（工作台里落到 52 / 78 / 104 / 120 钉画线板的整板尺寸）·
                2.6mm 小豆成品约 {{ (asset.grid * 0.26).toFixed(1) }} × {{ (asset.grid * 0.26).toFixed(1) }} cm、
                5mm 中号豆约 {{ (asset.grid * 0.5).toFixed(1) }} × {{ (asset.grid * 0.5).toFixed(1) }} cm
              </div>

              <div class="row" style="gap:9px;flex-wrap:wrap">
                <button class="btn primary lg" :disabled="busy" @click="onUse">
                  {{ busy ? '生成中…' : '开始拼这个' }}
                </button>
                <button class="btn btn-secondary lg" @click="toggleFavorite(asset.id)">{{ fav ? '取消收藏' : '收藏' }}</button>
                <button class="btn btn-secondary lg" @click="goCategory">看同类素材</button>
              </div>
              <p class="hint">
                「开始拼这个」会把它载入工作台，自动生成高还原 / 好拼版 / 艺术版三个方案，你可以再调尺寸和颜色。
              </p>
            </div>
          </div>

          <div class="card">
            <div class="card__head"><h3>怎么拼</h3><span class="muted">新手提示</span></div>
            <div class="card__body">
              <ol class="steps">
                <li>生成图纸后先看「材料清单」，把要用的色号找齐。</li>
                <li>决定要不要分板打印（大图建议一板一页）。</li>
                <li>按图纸一板一板摆，摆完熨烫时垫好烘焙纸、中温、均匀用力。</li>
                <li>拼完回到第三步「完成」点「我拼完了 · 完成作品」，记录完成、扣减库存，顺手传一张成品照片生成分享卡。</li>
              </ol>
              <RouterLink to="/help" class="btn soft block" style="margin-top:12px">查看完整教程</RouterLink>
            </div>
          </div>
        </div>
      </div>

      <template v-if="similar.length">
        <div class="secHead">
          <div><h2>同类素材</h2><p>同一风格可以做成系列</p></div>
        </div>
        <div class="assetGrid">
          <AssetCard v-for="a in similar" :key="a.id" :asset="a" @pick="onPickSimilar" />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.crumb{display:flex;align-items:center;gap:8px;font-size:var(--fs-xs);color:var(--muted);margin-bottom:14px}
.crumb a:hover{color:var(--coral-deep)}
.crumb b{color:var(--ink)}
.detailGrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
.detailPreview{
  border-radius:var(--r-lg) var(--r-lg) 0 0;min-height:380px;display:grid;place-items:center;
  background:linear-gradient(150deg,var(--yellow-soft),var(--surface-warm));padding:24px;
}
.detailPreview__inner{width:min(340px,100%)}
.detailPreview__inner :deep(svg){width:100%;height:auto;display:block}
.detailPreview__inner img{width:100%;height:auto;display:block;border-radius:10px}
.stars{display:inline-flex;align-items:center;gap:2px;color:var(--orange-deep)}
.stars .is-empty{opacity:.22}
.boardInfo{padding:11px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-2xs);color:var(--muted);line-height:1.7}
.boardInfo b{color:var(--ink);font-size:var(--fs-xs)}
.alertBox{padding:11px;border-radius:var(--r-sm);background:var(--yellow-soft);border:1px solid #F0E3A8;font-size:var(--fs-2xs);color:var(--yellow-deep);font-weight:650}
.steps{margin:0;padding-left:19px;display:flex;flex-direction:column;gap:9px;font-size:var(--fs-xs);line-height:1.7;color:var(--ink-2)}
@media(max-width:1000px){.detailGrid{grid-template-columns:1fr}}
</style>
