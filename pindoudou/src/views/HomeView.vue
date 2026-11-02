<script setup>
/* =========================================================================
   首页（2026-10-20，按交付包「04 — Homepage」重做）
   -------------------------------------------------------------------------
   结构：奶油底顶栏 → 柔和主视觉（中心标题 + 上传卡 + 三条真实能力）
   → 紧凑页脚。左右像素拼豆作品是弱化的背景层，桌面显示、手机隐藏；
   上传卡始终是首屏视觉中心。

   上传卡支持把图片直接拖进来：文件先放进 usePendingUpload，跳到工作台后
   由 EditorSidebar 取走并走同一条「载入图片」流程。

   2026-10-26：首页恢复成这一版（之前被新手简化版顶掉过一天）。
   新手简化版没有删，改成「创作」命令底下的**操作台**（路由 /create），
   首页回到 / —— 手机、平板、电脑三端都是这个带插画的主视觉。

   2026-10-26 晚（用户第二次调整）：
   · 首屏以下的长文内容区（HomeContent）又删掉了 —— 用户要看的是干净的宣传页，
     正文仍在服务端的 SEO 壳里，爬虫照旧读得到；
   · 首页的入口（选择图片 / 免费素材 / 拖图）默认进**新手版**（操作台 /create），
     不再直接跳专业工作台；
   · 站点页脚（操作台底部那条）挪到首页，操作台是工具页、不再挂页脚。
   ========================================================================= */

import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { setPendingUpload } from '../composables/usePendingUpload.js'
import PixelIcon from '../components/ui/PixelIcon.vue'
import beanSmiley from '../assets/hero-bean-smiley.png'
import collageLeft from '../assets/home-collage-left.webp'
import collageRight from '../assets/home-collage-right.webp'
/* 主标题整图：交付包原图裁掉上下留白、背景抠成透明后的版本（1532 × 629）。
   三端共用同一张，整张缩放到标题栏宽度——图里的贴纸、描边、发光都是完整的一体，不做二次裁切。 */
import heroTitle from '../assets/home-hero-title.webp'

const router = useRouter()
const dragOver = ref(false)
const dropError = ref('')

function onDragOver(e) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  dropError.value = ''
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (!/^image\//.test(file.type)) {
    dropError.value = '请拖入图片文件（JPG、PNG、WEBP）'
    return
  }
  setPendingUpload(file)
  router.push('/create').catch(() => {})
}
</script>

<template>
  <div class="homeV2">
    <section class="homeHero">
      <div class="homeGlow homeGlow--pink" aria-hidden="true"></div>
      <div class="homeGlow homeGlow--sky" aria-hidden="true"></div>

      <img class="homeCollage homeCollage--left" :src="collageLeft" alt="" aria-hidden="true">
      <img class="homeCollage homeCollage--right" :src="collageRight" alt="" aria-hidden="true">

      <div class="homeHero__in">
        <div class="homeHead">
          <p class="homeEyebrow">
            <PixelIcon name="sparkles" :size="12" />
            拼豆创作工作台
          </p>

          <h1 class="sr-only">免费拼豆图纸生成器</h1>
          <img
            class="homeTitleArt"
            :src="heroTitle"
            width="1532" height="629" decoding="async"
            alt="把灵感，拼成喜欢的样子。调色、分格、材料清单，让每一份喜欢都有图可拼。"
          >
        </div>

        <div
          class="uploadCard"
          :class="{ 'is-drag': dragOver }"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <img class="uploadCard__bean" :src="beanSmiley" alt="" width="48" height="48">
          <h2>把喜欢的图片，变成拼豆图纸</h2>
          <p class="uploadCard__sub">从一张图片，开始你的拼豆灵感</p>
          <RouterLink to="/create" class="uploadCard__btn">
            <PixelIcon name="fn-upload" :size="18" />
            选择图片
          </RouterLink>
          <p class="uploadCard__hint">也可以将图片拖到这里 · JPG、PNG、WEBP</p>
          <p v-if="dropError" class="uploadCard__error">{{ dropError }}</p>
          <RouterLink to="/create?tab=library" class="uploadCard__free">
            没有图片？从免费素材开始
            <PixelIcon name="arrowRight" :size="12" />
          </RouterLink>
        </div>

        <div class="homeBottom">
          <ul class="homeFeatures">
            <li>
              <span class="homeFeature__icon is-pink"><PixelIcon name="heart" :size="18" /></span>
              <span><b>全部功能免费</b><small>图片转换任意玩</small></span>
            </li>
            <li>
              <span class="homeFeature__icon is-yellow"><PixelIcon name="palette" :size="18" /></span>
              <span><b>颜色和尺寸可调整</b><small>自由定制，拼出独特创意</small></span>
            </li>
            <li>
              <span class="homeFeature__icon is-green"><PixelIcon name="list" :size="18" /></span>
              <span><b>图纸材料清单</b><small>一键生成，轻松准备材料</small></span>
            </li>
          </ul>

          <p class="homePrivacy">图片转换在浏览器本地完成，照片不会上传到服务器。</p>
        </div>
      </div>
    </section>

    <!-- 首屏以下的内容区（HomeContent）2026-10-26 晚又删掉了：
         首页是宣传页，只要主视觉；正文仍在服务端的 SEO 壳里，爬虫照旧读得到。 -->

    <!-- 页脚用站点的三栏页脚（App.vue 统一渲染）：操作台底部那条挪到了这里，
         首页自己的紧凑页脚不再需要，两个页脚叠在一起会重复。 -->
  </div>
</template>

<style scoped>
/* ============================ 主视觉 ============================ */
.homeV2{background:var(--bg)}
.homeHero{
  position:relative;isolation:isolate;overflow:hidden;
  /* hero 的高度 = 视口 - 顶栏（页脚挪到首屏以下了）。
     内容栏拉满这块高度后，里面是「标题 / 上传卡 / 底部说明」三行网格：
     上传卡那一行正好压在 hero 的垂直中线上，
     上下两行等分剩余空间，标题往上贴、说明往下贴。 */
  min-height:max(660px,calc(100dvh - var(--header-h)));
  display:flex;align-items:stretch;justify-content:center;
  background:
    linear-gradient(180deg,#FFFDF8 0%,var(--bg) 46%,#FFF8EE 100%);
  /* 下内边距多留 72px：内容栏的高度 = 视口 - 顶栏 - 72px，
     这样上传卡的中心仍然正好落在「首屏中线」（顶栏 72px 被这 72px 抵消），
     多出来的这一截只是主视觉的底色，页脚从首屏以下才开始。 */
  padding:32px 20px 104px;
}
/* 柔和的粉 / 蓝光斑只做空气感，不抢上传卡 */
.homeGlow{
  position:absolute;z-index:-2;border-radius:50%;pointer-events:none;
  filter:blur(12px);
}
.homeGlow--pink{width:520px;height:520px;left:-140px;top:-90px;background:radial-gradient(circle,rgba(255,142,199,.12),rgba(255,142,199,0) 68%)}
.homeGlow--sky{width:560px;height:560px;right:-160px;bottom:-150px;background:radial-gradient(circle,rgba(56,169,243,.12),rgba(56,169,243,0) 68%)}

/* 左右拼豆作品：来自交付包首页视觉，弱化后作为背景层。
   multiply 让插画自带的奶油底和页面融在一起，四周再做渐隐。
   尺寸跟着视口走、外缘贴住屏幕边（-24px 出血），中间只留内容栏的宽度，
   这样宽屏上不会缩在中间、两侧空出一大片奶油底。 */
.homeCollage{
  position:absolute;z-index:-1;top:50%;transform:translateY(-50%);
  height:calc(100dvh - var(--header-h) - 72px);
  max-height:92vh;
  width:auto;max-width:calc(50% - 300px);
  object-fit:contain;
  pointer-events:none;user-select:none;
  mix-blend-mode:multiply;opacity:.86;
  filter:saturate(.9) contrast(.98);
  -webkit-mask-image:
    linear-gradient(to right,transparent 0,#000 9%,#000 91%,transparent 100%),
    linear-gradient(to bottom,transparent 0,#000 7%,#000 93%,transparent 100%);
  -webkit-mask-composite:source-in;
  mask-image:
    linear-gradient(to right,transparent 0,#000 9%,#000 91%,transparent 100%),
    linear-gradient(to bottom,transparent 0,#000 7%,#000 93%,transparent 100%);
  mask-composite:intersect;
}
/* 被 max-height 压窄时，让留白落在内侧，插画始终贴着屏幕外缘 */
.homeCollage--left{left:-24px;object-position:left center}
.homeCollage--right{right:-24px;object-position:right center}

.homeHero__in{
  position:relative;z-index:1;
  width:min(720px,100%);
  display:grid;grid-template-columns:minmax(0,1fr);
  grid-template-rows:minmax(auto,1fr) auto minmax(auto,1fr);
  row-gap:var(--block-gap);
  text-align:center;
  /* 三个板块（标题图 / 上传卡 / 底部三条能力）之间的统一间距。
     间距由网格的 row-gap 提供，三行等距。 */
  --block-gap:clamp(30px,4vh,50px);
  /* 标题图的高度跟着视口走：标题块越高，上传卡就越被顶离中线。
     46dvh - 303px 就是「首屏一半减去上传卡与间距」剩下的高度，
     卡片因此在各种屏幕高度上都能正好落在中线上。 */
  --title-h:clamp(100px,calc(46dvh - 303px),246px);
}
/* 标题块贴上行的底部（往上走），底部说明贴下行的顶部（往下走） */
.homeHead{align-self:end;width:min(720px,100%);display:flow-root}
.homeBottom{align-self:start;width:min(720px,100%);display:flow-root}

/* -------------------------------- 标题 */
.homeEyebrow{
  display:inline-flex;align-items:center;gap:6px;
  padding:5px 12px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.72);border:1px solid var(--line);
  color:var(--ink-2);font-size:var(--fs-2xs);font-weight:800;letter-spacing:.08em;
}
.homeEyebrow .pixelIcon{color:var(--coral)}
/* 标题是交付包里的一整张字图（文字、描边、小装饰都在图里），
   这里只控制宽度：跟着标题栏走，三端同一张图，不再排文字。
   .sr-only 是全局工具类（见 styles/global.css），这里不再重复定义。 */
.homeTitleArt{
  display:block;width:auto;max-width:100%;height:var(--title-h);
  object-fit:contain;aspect-ratio:1532/629;
  margin:18px auto 0;
}

/* -------------------------------- 上传卡 */
.uploadCard{
  width:min(520px,100%);min-height:300px;
  justify-self:center;margin-top:0;padding:24px 26px 20px;
  background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:var(--r-xl);
  box-shadow:0 2px 0 rgba(255,255,255,.7) inset,0 18px 44px rgba(30,27,25,.08);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  transition:box-shadow var(--t),transform var(--t),border-color var(--t);
}
.uploadCard.is-drag{
  border-color:var(--primary);
  box-shadow:0 0 0 4px var(--primary-soft),0 18px 44px rgba(30,27,25,.10);
  transform:translateY(-2px);
}
.uploadCard__bean{display:block;width:48px;height:48px;image-rendering:pixelated}
.uploadCard h2{
  margin-top:10px;font-size:20px;line-height:1.4;font-weight:900;letter-spacing:-.02em;color:var(--ink);
}
.uploadCard__sub{margin-top:5px;font-size:var(--fs-sm);line-height:1.6;color:var(--muted)}
.uploadCard__btn{
  margin-top:16px;width:min(360px,100%);height:48px;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border-radius:var(--r-sm);background:var(--primary);color:var(--primary-ink);
  font-size:15px;font-weight:900;
  box-shadow:0 2px 0 #E6B800;
  transition:background var(--t),transform var(--t),box-shadow var(--t);
}
.uploadCard__btn:hover{background:#FFC400;transform:translateY(-1px);box-shadow:0 4px 0 #E6B800}
.uploadCard__btn:active{background:var(--primary-deep);transform:translateY(1px);box-shadow:0 1px 0 #D6AA00}
.uploadCard__hint{margin-top:11px;font-size:var(--fs-2xs);line-height:1.6;color:var(--muted-2)}
.uploadCard__error{margin-top:6px;font-size:12px;color:var(--danger);font-weight:700}
.uploadCard__free{
  margin-top:10px;min-height:32px;padding:0 10px;
  display:inline-flex;align-items:center;gap:4px;
  border-radius:var(--r-xs);font-size:12px;font-weight:750;color:var(--ink-2);
}
.uploadCard__free:hover{background:var(--surface-3);color:var(--ink)}

/* -------------------------------- 三条能力 */
.homeFeatures{
  width:min(760px,100%);margin:0;padding:0;list-style:none;
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;
  text-align:left;
}
.homeFeatures li{display:flex;align-items:flex-start;gap:9px;min-width:0}
.homeFeature__icon{
  width:32px;height:32px;flex:0 0 auto;border-radius:10px;
  display:grid;place-items:center;
}
.homeFeature__icon.is-pink{background:var(--pink-soft);color:var(--pink-deep)}
.homeFeature__icon.is-yellow{background:var(--primary-soft);color:#8A6A00}
.homeFeature__icon.is-green{background:var(--green-soft);color:var(--green-deep)}
.homeFeatures b{display:block;font-size:var(--fs-sm);line-height:1.5;font-weight:850;color:var(--ink)}
.homeFeatures small{display:block;margin-top:1px;font-size:var(--fs-2xs);line-height:1.5;color:var(--muted)}
.homePrivacy{
  margin-top:14px;font-size:var(--fs-2xs);line-height:1.6;color:var(--muted-2);
}

/* ============================ 响应式 ============================ */
/* 屏幕不高时（1366×768、1280×800 这类笔记本）：hero 收成正好一屏，
   标题图、卡片一起矮一档，上传卡仍然落在首屏中线上。 */
@media(min-width:781px) and (max-height:900px){
  .homeHero{min-height:max(520px,calc(100dvh - var(--header-h)))}
  .homeHero__in{--title-h:clamp(64px,calc(46dvh - 303px),246px)}
  .uploadCard{min-height:260px;padding:20px 26px 18px}
}
@media(max-width:1240px){
  .homeCollage{opacity:.72}
  .homeHero__in{width:min(660px,100%)}
}
@media(max-width:1040px){
  .homeCollage{display:none}
  .homeGlow--pink{left:-220px}
  .homeGlow--sky{right:-240px}
}
@media(max-width:780px){
  .homeHero{
    min-height:calc(100dvh - var(--header-h));
    align-items:flex-start;padding:16px 14px 22px;
  }
  .homeGlow{display:none}
  /* 手机上回到普通竖排流：不用中线定位，间距由各自的 margin 决定 */
  .homeHero__in{
    width:100%;display:flex;flex-direction:column;align-items:center;row-gap:0;
  }
  .homeHead,.homeBottom{align-self:auto;width:100%}
  .homeEyebrow{font-size:var(--fs-2xs);padding:4px 10px}
  .homeTitleArt{height:auto;width:100%;max-width:none;margin:10px auto 0}
  .uploadCard{
    width:100%;min-height:0;margin-top:16px;padding:20px 18px 16px;border-radius:var(--r-xl);
  }
  .uploadCard__bean{width:42px;height:42px}
  .uploadCard h2{font-size:18px}
  .uploadCard__sub{font-size:12px}
  .uploadCard__btn{width:100%;margin-top:14px}
  .homeFeatures{
    grid-template-columns:1fr;gap:6px;margin-top:12px;
    padding:10px 14px;border:1px solid var(--line);border-radius:var(--r-lg);
    background:rgba(255,255,255,.64);
  }
  .homeFeatures li{align-items:center}
  .homeFeatures b{font-size:12px}
  .homeFeatures small{font-size:var(--fs-2xs)}
  .homePrivacy{margin-top:8px;font-size:var(--fs-2xs)}
}
@media(max-width:780px) and (max-height:700px){
  .homeHero{padding-top:14px}
  .homeEyebrow{display:none}
  .homeTitleArt{margin:0 auto}
  .uploadCard{margin-top:14px;padding:16px}
  .homeFeatures{display:none}
  .homePrivacy{margin-top:8px}
}
</style>
