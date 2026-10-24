<script setup>
/* 素材库 Banner：直接用交付包里的整张切片（04_Banner_含文字.png，1287×222），
   标题、副标题、插画、装饰都在图里，页面不再自己排文字、不换字体。
   按容器宽度等比缩放，不裁切、不拉伸。 */
import banner from '../../assets/library-banner.png'
</script>

<template>
  <section class="libBanner">
    <img
      class="libBanner__img"
      :src="banner"
      alt="所爱皆可拼，万物皆可造。海量免费拼豆素材，激发你的创作灵感。"
    >
  </section>
</template>

<style scoped>
.libBanner{display:block;border-radius:16px;overflow:hidden;line-height:0}
.libBanner__img{display:block;width:100%;height:auto}
</style>
