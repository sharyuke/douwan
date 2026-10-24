<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PatternPreview from '../components/ui/PatternPreview.vue'
import AssetCard from '../components/ui/AssetCard.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import { filterAssets, loadRemoteAssets, pickAsset, remoteAssets } from '../composables/useAssets.js'
import { DEFAULT_BRAND_ID, getColors, getBrand } from '../lib/palettes.js'
import { BUILD_TOOL_CONTENT } from '../data/tools.js'

const route = useRoute()
const router = useRouter()

const content = computed(() => BUILD_TOOL_CONTENT[route.params.slug] || null)
const busy = ref(false)
const demo = ref(null)
const demoName = ref('')

/** 用同分类的第一个素材现场跑一次真实生成，让「演示」不是画出来的假图 */
onMounted(async () => {
  /* 工具页也顺手拉一次后台素材：下面的「相关素材」只展示后台上架内容 */
  loadRemoteAssets()
  const c = content.value
  if (!c) return
  try {
    const pool = filterAssets({ col: c.demoCol || 'hot' })
    const asset = pool[0]
    if (!asset) return
    const { svgToImage } = await import('../composables/useStudio.js')
    const { generateVariant } = await import('../lib/pattern.js')
    const { img } = await svgToImage(asset.svg)
    demoName.value = asset.name
    const brandId = c.brandId || DEFAULT_BRAND_ID
    demo.value = generateVariant({
      img,
      gw: 29,
      gh: 29,
      fit: 'contain',
      targetColors: 14,
      brandId,
      colors: getColors(brandId),
      variantKey: 'easy'
    })
  } catch {
    /* 演示失败不影响页面主体 */
  }
})

const brandName = computed(() => (content.value && content.value.brandId ? getBrand(content.value.brandId).name : ''))

/* 相关素材只取后台上架的；没有就不显示这一块（内置素材已退出素材库） */
const related = computed(() => (content.value ? remoteAssets.value.slice(0, 4) : []))

const otherTools = computed(() => Object.values(BUILD_TOOL_CONTENT).filter(t => t.slug !== route.params.slug).slice(0, 4))

async function onPick(asset) {
  busy.value = true
  const res = await pickAsset(asset.id)
  busy.value = false
  if (res.ok) router.push('/editor')
}
</script>

<template>
  <div class="wrap main--pad">
    <div v-if="!content" class="empty">
      <div class="empty__icon"><PixelIcon name="search" :size="24" /></div>
      <strong>找不到这个工具页</strong>
      <p>可能链接有误。你可以直接从素材库或上传照片开始。</p>
      <div class="row" style="gap:9px">
        <RouterLink to="/editor" class="btn primary">开始创作</RouterLink>
        <RouterLink to="/library" class="btn btn-secondary">素材中心</RouterLink>
      </div>
    </div>

    <template v-else>
      <div class="toolHero">
        <div>
          <span class="badge">{{ content.badge }}</span>
          <h1 style="margin:14px 0 10px">{{ content.h1 }}</h1>
          <p class="toolLead">{{ content.lead }}</p>
          <div class="row row--wrap" style="margin-top:18px">
            <RouterLink to="/editor" class="btn primary lg">免费生成一张图纸</RouterLink>
            <RouterLink to="/library" class="btn btn-secondary lg">先看素材库</RouterLink>
          </div>
          <p class="hint" style="margin-top:12px">
            不需要注册，图片在你的浏览器本地处理，不会上传到服务器。
          </p>
        </div>

        <div class="toolDemo card">
          <div class="card__head">
            <h3>实时生成演示</h3>
            <span class="muted">{{ demoName || '加载中' }}</span>
          </div>
          <div class="card__body">
            <div class="demoBody">
              <PatternPreview :pattern="demo" :max-size="260" />
            </div>
            <div v-if="demo" class="demoFacts">
              <div><b>{{ demo.width }}×{{ demo.height }}</b><span>格数</span></div>
              <div><b>{{ demo.stats.colorCount }} 色</b><span>颜色</span></div>
              <div><b>{{ demo.stats.beadCount }}</b><span>颗豆</span></div>
              <div><b>{{ Math.round(demo.stats.buildability * 100) }}</b><span>可拼性</span></div>
            </div>
            <p v-if="demo" class="hint" style="margin-top:10px">
              这张图是刚才在你浏览器里真实生成的，数字来自实际网格统计。
            </p>
            <p v-else class="hint">正在生成演示图案…</p>
          </div>
        </div>
      </div>

      <!-- 功能要点 -->
      <section class="secHead">
        <div><h2>{{ content.h2Features }}</h2><p>{{ brandName ? `当前演示用 ${brandName}` : '' }}</p></div>
      </section>
      <div class="featureListGrid">
        <div v-for="f in content.features" :key="f.title" class="featureItem">
          <div class="featureItem__icon" :style="{ background: f.bg, color: f.color }">
            <PixelIcon :name="f.icon" :size="22" />
          </div>
          <div>
            <b>{{ f.title }}</b>
            <p>{{ f.body }}</p>
          </div>
        </div>
      </div>

      <!-- 步骤 -->
      <section class="secHead">
        <div><h2>三步拿到图纸</h2><p>不用学任何像素画知识</p></div>
      </section>
      <div class="stepRow">
        <div v-for="(s, i) in content.steps" :key="s.title" class="stepCard">
          <div class="stepNo">{{ i + 1 }}</div>
          <b>{{ s.title }}</b>
          <p>{{ s.body }}</p>
        </div>
      </div>

      <!-- 长文（SEO） -->
      <section class="secHead">
        <div><h2>{{ content.articleTitle }}</h2></div>
      </section>
      <div class="article card">
        <div class="card__body">
          <div v-for="(sec, i) in content.article" :key="i" class="articleSec">
            <h3>{{ sec.h }}</h3>
            <p v-for="(p, j) in sec.p" :key="j">{{ p }}</p>
          </div>
        </div>
      </div>

      <!-- 相关素材 -->
      <section v-if="related.length" class="secHead">
        <div><h2>相关素材</h2><p>点一下直接生成</p></div>
        <RouterLink to="/library">全部素材 ›</RouterLink>
      </section>
      <div v-if="related.length" class="assetGrid">
        <AssetCard v-for="a in related" :key="a.id" :asset="a" @pick="onPick" />
      </div>

      <!-- 其他工具 -->
      <section class="secHead">
        <div><h2>其他工具</h2><p>按品牌与用途细分</p></div>
      </section>
      <div class="toolLinks">
        <RouterLink v-for="t in otherTools" :key="t.slug" :to="`/tools/${t.slug}`" class="toolLink">
          <b>{{ t.h1 }}</b>
          <span class="hint">{{ t.lead.slice(0, 42) }}…</span>
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<style scoped>
.toolHero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:32px;align-items:center}
.toolLead{font-size:15px;color:var(--ink-2);line-height:1.85;max-width:600px}
.demoBody{display:grid;place-items:center;background:var(--surface-2);border-radius:var(--r-md);padding:18px;min-height:250px}
.demoFacts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;text-align:center}
.demoFacts b{display:block;font-size:16px;font-weight:850;letter-spacing:-.02em}
.demoFacts span{font-size:var(--fs-2xs);color:var(--muted)}
.featureListGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.stepRow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.stepCard{
  position:relative;padding:20px;border-radius:var(--r-lg);background:var(--surface);
  border:1px solid var(--line);box-shadow:var(--sh-1);
}
.stepNo{
  width:30px;height:30px;border-radius:9px;background:var(--primary-soft);color:var(--primary-deep);
  display:grid;place-items:center;font-weight:900;font-size:var(--fs-sm);margin-bottom:11px;
}
.stepCard b{font-size:var(--fs-h3);display:block;margin-bottom:6px}
.stepCard p{font-size:var(--fs-xs);color:var(--muted);line-height:1.75}
.article{max-width:900px}
.articleSec{margin-bottom:22px}
.articleSec:last-child{margin-bottom:0}
.articleSec h3{font-size:var(--fs-h3);margin-bottom:9px}
.articleSec p{font-size:var(--fs-sm);color:var(--ink-2);line-height:1.95;margin-bottom:9px}
.toolLinks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.toolLink{
  display:flex;flex-direction:column;gap:5px;padding:16px;border-radius:var(--r-md);
  background:var(--surface);border:1px solid var(--line);transition:var(--t);
}
.toolLink:hover{border-color:var(--primary);transform:translateY(-2px);box-shadow:var(--sh-1)}
.toolLink b{font-size:var(--fs-xs);line-height:1.5}
@media(max-width:1000px){
  .toolHero{grid-template-columns:1fr;gap:22px}
  .featureListGrid,.stepRow,.toolLinks{grid-template-columns:1fr}
}
</style>
