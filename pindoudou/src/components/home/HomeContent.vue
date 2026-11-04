<script setup>
/* =========================================================================
   首页首屏以下的内容区（SEO V3.0 §4）
   -------------------------------------------------------------------------
   目的：把「第一次来豆玩的人」和「从搜索结果点进来的人」都能自然读下去，
   并且给搜索引擎一份真实、可抓取的内容。

   原则（需求原文）：
   - 首屏保持单屏清爽，这里是**首屏以下**的内容，不往上传卡上堆关键词；
   - 每一段都写真实的功能与真实的数据，不编造、不重复堆词；
   - 素材分类入口用后台的真实分类与真实素材数，没有内容的分类不出现。
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../../lib/api.js'
import { HOME_PAGE } from '../../data/seo.js'
import Icon from '../ui/Icon.vue'

/* 分类从后台拉：slug、名称、真实素材数、真实简介 */
const categories = ref([])
const catLoading = ref(false)
const catError = ref('')

async function loadCategories() {
  catLoading.value = true
  catError.value = ''
  try {
    const list = await api.get('/assets/categories', { auth: false })
    const arr = Array.isArray(list) ? list : []
    /* 只展示真正有素材的分类 —— 没有内容的分类页不会建，也不会出现在这里 */
    categories.value = arr
      .filter(c => Number(c.asset_count || 0) > 0)
      .sort((a, b) => Number(b.sort_order || 0) - Number(a.sort_order || 0))
  } catch (e) {
    catError.value = e instanceof Error ? e.message : '分类加载失败'
    categories.value = []
  } finally {
    catLoading.value = false
  }
}

/* 首页正文：与 src/data/seo.js 同源，服务端渲染的 SEO 外壳用的是同一份文案 */
const steps = computed(() => HOME_PAGE.steps || [])
const features = computed(() => HOME_PAGE.features || [])
const faq = computed(() => HOME_PAGE.faq || [])
const howTo = computed(() => (HOME_PAGE.sections || [])[0] || null)
const whyUs = computed(() => (HOME_PAGE.sections || [])[1] || null)
const howToGet = computed(() => (HOME_PAGE.sections || [])[2] || null)
const links = computed(() => HOME_PAGE.links || [])

onMounted(loadCategories)
</script>

<template>
  <section class="homeContent">
    <div class="homeContent__in">

      <!-- ① 图片如何转换拼豆图纸 -->
      <div class="hcBlock">
        <h2 class="hcH2">图片如何转换拼豆图纸</h2>
        <p class="hcLead">
          四步就能把一张照片变成能照着拼的图纸，全程在你的浏览器里完成，不需要注册。
        </p>
        <ol class="hcSteps">
          <li v-for="(s, i) in steps" :key="s.title" class="hcStep">
            <span class="hcStep__no">{{ i + 1 }}</span>
            <div>
              <b>{{ s.title }}</b>
              <p>{{ s.body }}</p>
            </div>
          </li>
        </ol>
        <div v-if="howTo" class="hcProse">
          <p v-for="(p, i) in howTo.p" :key="i">{{ p }}</p>
        </div>
      </div>

      <!-- ② 豆玩支持哪些制作功能 -->
      <div class="hcBlock">
        <h2 class="hcH2">豆玩支持哪些制作功能</h2>
        <ul class="hcFeatures">
          <li v-for="f in features" :key="f.title" class="hcFeature">
            <span class="hcFeature__icon"><Icon :name="f.icon || 'sparkles'" :size="20" /></span>
            <b>{{ f.title }}</b>
            <p>{{ f.body }}</p>
          </li>
        </ul>
        <div v-if="whyUs" class="hcProse">
          <p v-for="(p, i) in whyUs.p" :key="i">{{ p }}</p>
        </div>
      </div>

      <!-- ③ 如何获取免费拼豆素材 -->
      <div class="hcBlock">
        <h2 class="hcH2">如何获取免费拼豆素材</h2>
        <div v-if="howToGet" class="hcProse">
          <p v-for="(p, i) in howToGet.p" :key="i">{{ p }}</p>
        </div>
        <RouterLink to="/materials/" class="hcMore">
          <Icon name="folder-open" :size="16" />
          打开免费拼豆素材库
          <Icon name="arrow-right" :size="16" />
        </RouterLink>
      </div>

      <!-- ④ 常见问题 -->
      <div class="hcBlock">
        <h2 class="hcH2">常见问题</h2>
        <dl class="hcFaq">
          <div v-for="f in faq" :key="f.q" class="hcFaq__item">
            <dt>{{ f.q }}</dt>
            <dd>{{ f.a }}</dd>
          </div>
        </dl>
        <RouterLink to="/help/" class="hcMore">
          <Icon name="info" :size="16" />
          查看完整拼豆教程
          <Icon name="arrow-right" :size="16" />
        </RouterLink>
      </div>

      <!-- ⑤ 素材分类入口 -->
      <div class="hcBlock">
        <h2 class="hcH2">免费拼豆素材分类</h2>
        <p class="hcLead">
          点进任意一个分类都能直接看到这一类的全部拼豆素材，每张素材都能直接生成图纸。
        </p>
        <p v-if="catError" class="hcHint">{{ catError }}</p>
        <ul class="hcCats">
          <li v-for="c in categories" :key="c.id" class="hcCat">
            <RouterLink :to="`/materials/category/${c.slug}/`" class="hcCat__link">
              <span class="hcCat__name">{{ c.name }}</span>
              <span class="hcCat__count">{{ c.asset_count }} 个素材</span>
              <span v-if="c.description" class="hcCat__desc">{{ c.description }}</span>
            </RouterLink>
          </li>
        </ul>
        <p v-if="!catLoading && !categories.length" class="hcHint">
          素材正在整理中，可以先
          <RouterLink to="/materials/">打开素材库</RouterLink> 看看。
        </p>

        <ul class="hcLinks">
          <li v-for="l in links" :key="l.href">
            <RouterLink :to="l.href">{{ l.text }}</RouterLink>
          </li>
        </ul>
      </div>

    </div>
  </section>
</template>

<style scoped>
.homeContent{
  background:var(--bg);
  border-top:1px solid var(--line);
  padding:44px 20px 56px;
}
.homeContent__in{
  width:min(1080px,100%);margin:0 auto;
  display:flex;flex-direction:column;gap:40px;
}

.hcBlock{min-width:0}

.hcH2{
  margin:0 0 10px;
  font-size:var(--fs-h2);line-height:var(--ty-section-lh);font-weight:700;letter-spacing:0;
  color:var(--ink);
}
.hcLead{
  margin:0 0 18px;max-width:70ch;
  font-size:var(--fs-sm);line-height:var(--ty-body-lh);color:var(--muted);
}
.hcHint{margin:10px 0 0;font-size:var(--fs-2xs);color:var(--muted-2);line-height:var(--ty-caption-lh)}
.hcHint a{color:var(--ink-2);text-decoration:underline;text-underline-offset:3px}

/* ---- 四步流程 ---- */
.hcSteps{
  margin:0 0 20px;padding:0;list-style:none;
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;
}
.hcStep{
  display:flex;align-items:flex-start;gap:10px;
  padding:14px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);
}
.hcStep__no{
  flex:0 0 auto;width:24px;height:24px;border-radius:8px;
  display:grid;place-items:center;
  background:var(--primary-soft);color:var(--primary-deep);
  font-size:var(--fs-2xs);font-weight:700;line-height:var(--ty-caption-lh)
}
.hcStep b{display:block;font-size:var(--fs-sm);line-height:var(--ty-body-lh);font-weight:700;color:var(--ink)}
.hcStep p{margin:3px 0 0;font-size:var(--fs-2xs);line-height:var(--ty-caption-lh);color:var(--muted)}

/* ---- 功能列表 ---- */
.hcFeatures{
  margin:0 0 20px;padding:0;list-style:none;
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;
}
.hcFeature{
  padding:16px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);
}
.hcFeature__icon{
  display:grid;place-items:center;width:34px;height:34px;
  border-radius:10px;background:var(--primary-soft);margin-bottom:8px;
}
.hcFeature b{display:block;font-size:var(--fs-sm);font-weight:700;color:var(--ink);line-height:var(--ty-body-lh)}
.hcFeature p{margin:4px 0 0;font-size:var(--fs-2xs);line-height:var(--ty-caption-lh);color:var(--muted)}

/* ---- 正文段落 ---- */
.hcProse{max-width:74ch}
.hcProse p{
  margin:0 0 10px;
  font-size:var(--fs-sm);line-height:var(--ty-body-lh);color:var(--ink-2);
}
.hcProse p:last-child{margin-bottom:0}

/* ---- 更多入口 ---- */
.hcMore{
  display:inline-flex;align-items:center;gap:6px;
  margin-top:14px;padding:9px 14px;border-radius:var(--r-sm);
  background:var(--surface);border:1px solid var(--line);
  font-size:var(--fs-xs);font-weight:700;color:var(--ink);line-height:var(--ty-label-lh)
}
.hcMore:hover{border-color:var(--primary);color:var(--primary-deep)}

/* ---- 常见问题 ---- */
.hcFaq{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.hcFaq__item{
  padding:14px 16px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);
}
.hcFaq dt{margin:0;font-size:var(--fs-sm);font-weight:700;color:var(--ink);line-height:var(--ty-body-lh)}
.hcFaq dd{margin:6px 0 0;font-size:var(--fs-2xs);line-height:var(--ty-caption-lh);color:var(--muted)}

/* ---- 分类入口 ---- */
.hcCats{
  margin:0 0 18px;padding:0;list-style:none;
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;
}
.hcCat{min-width:0}
.hcCat__link{
  display:block;height:100%;
  padding:14px 16px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);
  transition:border-color var(--t),transform var(--t);
}
.hcCat__link:hover{border-color:var(--primary);transform:translateY(-2px)}
.hcCat__name{display:block;font-size:var(--fs-sm);font-weight:700;color:var(--ink);line-height:var(--ty-body-lh)}
.hcCat__count{display:block;margin-top:2px;font-size:var(--fs-2xs);color:var(--primary-deep);font-weight:700;line-height:var(--ty-caption-lh)}
.hcCat__desc{
  display:block;margin-top:6px;font-size:var(--fs-2xs);line-height:var(--ty-caption-lh);color:var(--muted);
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
}

/* ---- 相关链接 ---- */
.hcLinks{
  margin:0;padding:0;list-style:none;
  display:flex;flex-wrap:wrap;gap:8px 18px;
}
.hcLinks a{font-size:var(--fs-2xs);font-weight:700;color:var(--ink-2);line-height:var(--ty-caption-lh)}
.hcLinks a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}

@media(max-width:900px){
  .hcSteps,.hcFeatures{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hcFaq,.hcCats{grid-template-columns:1fr}
}
@media(max-width:560px){
  .homeContent{padding:32px 14px 40px}
  .homeContent__in{gap:30px}
  .hcSteps,.hcFeatures{grid-template-columns:1fr}
}
</style>
