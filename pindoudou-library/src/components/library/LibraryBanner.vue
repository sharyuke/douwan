<script setup>
/* 素材库 Banner：按已确认视觉稿还原。
   插画是从确认稿里切出的独立 Banner 素材（不含文字），文字仍用 HTML 渲染，
   方便响应式与无障碍；插画按原始比例贴右，不做白蒙层、不重绘。 */
import bannerArt from '../../assets/library-banner.jpg'
</script>

<template>
  <section class="libBanner" aria-label="豆玩素材库">
    <div class="libBanner__copy">
      <h1><span class="line">所爱皆可<span class="pink">拼</span>，<span class="heart heart--pink" aria-hidden="true"></span></span><span class="line">万物皆可<span class="pink">造</span><span class="heart heart--orange" aria-hidden="true"></span></span></h1>
      <p>发现喜欢的原创拼豆图案，从灵感开始创作。</p>
    </div>
    <div class="libBanner__art" aria-hidden="true">
      <img :src="bannerArt" alt="">
    </div>
  </section>
</template>

<style scoped>
.libBanner{
  position:relative;display:flex;align-items:center;overflow:hidden;
  /* 与确认稿同比例：1286 × 218，文字区约占左侧 38%，插画占右侧 64% */
  aspect-ratio:1286 / 218;min-height:132px;
  border-radius:16px;
  background:linear-gradient(90deg,#FDF8EC 0%,#FDF6E5 58%,#FFF3E3 100%);
}
.libBanner__copy{
  position:relative;z-index:2;width:38%;min-width:0;
  padding:0 0 0 6%;
}
.libBanner h1{
  font-size:clamp(22px,3.5vw,50px);line-height:1.08;font-weight:900;
  letter-spacing:-.035em;color:#1B1B1F;
}
.libBanner .line{display:block}
.libBanner .pink{color:#F45E93}
.libBanner .heart{display:inline-block;font-size:.42em;line-height:1;vertical-align:.55em;margin-left:.08em}
.libBanner .heart::before{content:'♥'}
.libBanner .heart--pink{color:#F45E93}
.libBanner .heart--orange{color:#F59B4B}
.libBanner p{
  margin-top:.7em;font-size:clamp(11px,1.1vw,15px);line-height:1.5;
  color:#4B5563;max-width:34em;
}
.libBanner__art{
  position:absolute;right:0;top:0;height:100%;width:auto;pointer-events:none;
}
.libBanner__art img{
  display:block;height:100%;width:auto;
}
@media(max-width:1000px){
  .libBanner__copy{padding-left:4.5%}
}
@media(max-width:780px){
  /* 手机上文字占满整行，插画按原比例放到文字下面，不裁切、不放大 */
  .libBanner{display:block;aspect-ratio:auto;min-height:0;padding:16px 16px 0}
  .libBanner__copy{width:auto;padding:0}
  .libBanner h1{font-size:26px}
  .libBanner p{font-size:12px;margin-top:6px}
  .libBanner__art{position:static;height:auto;width:calc(100% + 32px);margin:12px -16px 0}
  .libBanner__art img{width:100%;height:auto}
}
</style>
