<script setup>
import { RouterLink } from 'vue-router'
import navCreation from '../../assets/nav/nav_creation.png'
import navLibrary from '../../assets/nav/nav_library.png'
import navInventory from '../../assets/nav/nav_inventory.png'
import navWorks from '../../assets/nav/nav_works.png'

/** 手机端底部标签栏（PRD §12：创作 | 材料 | 素材 | 作品）
    「创作」原本指向独立的开始创作页，那一层现在并进了工作台
    （没图纸时工作台就是创建步骤），两个格子会跳同一处，所以合成一个。
    图标用「图标交付包」里的透明 PNG（与左侧栏同一套），24px、object-fit: contain；
    材料没有专属图标，用库存的箱子。 */
const tabs = [
  { to: '/editor', img: navCreation, label: '创作' },
  { to: '/materials', img: navInventory, label: '材料' },
  { to: '/library', img: navLibrary, label: '素材' },
  { to: '/projects', img: navWorks, label: '作品' }
]
</script>

<template>
  <nav class="tabbar no-print" aria-label="快捷导航">
    <RouterLink v-for="t in tabs" :key="t.to" :to="t.to">
      <img class="tabbar__icon" :src="t.img" alt="" aria-hidden="true" width="24" height="24">
      <span>{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar__icon {
  width: 24px;
  height: 24px;
  display: block;
  /* 图标固定 24×24：格子在窄屏会被 flex 压窄，别让图标跟着被横向挤扁 */
  flex: 0 0 auto;
  object-fit: contain;
}
/* 24px 图标比原来的 18px 线性图标高 6px。把格子上下内边距从 9px 收到 5px，
   底栏总高维持在 67px 左右，别把工作台的「功能」胶囊（bottom: 84px）顶住。 */
.tabbar a {
  padding-top: 5px;
  padding-bottom: 5px;
}
</style>
