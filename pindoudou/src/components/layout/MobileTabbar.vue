<script setup>
import { RouterLink, useRoute } from 'vue-router'
import navCreation from '../../assets/nav/nav_creation.png'
import navLibrary from '../../assets/nav/nav_library.png'
import navInventory from '../../assets/nav/nav_inventory.png'
import navWorks from '../../assets/nav/nav_works.png'

/** 手机端底部标签栏（PRD §12：创作 | 材料 | 素材 | 作品）
    「创作」指操作台（/create）：新手简化版的三步向导；
    专业工作台在 /editor，从顶栏的「新手 / 专业」开关进。
    图标用「图标交付包」里的透明 PNG（与左侧栏同一套），24px、object-fit: contain；
    材料没有专属图标，用库存的箱子。 */
const tabs = [
  { to: '/create', img: navCreation, label: '创作' },
  { to: '/project-materials', img: navInventory, label: '材料' },
  { to: '/materials/', img: navLibrary, label: '素材' },
  { to: '/projects', img: navWorks, label: '作品' }
]

const route = useRoute()
/* 自己算高亮：RouterLink 自带的 router-link-active 对 '/' 是「祖先匹配」，
   那样在素材库、我的作品页也会把「创作」点亮 —— 用错的高亮比没有高亮更误导。 */
function isActive(to) {
  const p = route.path
  if (to === '/create') return p === '/create' || p.startsWith('/editor')
  return p === to || p.startsWith(to + '/')
}
</script>

<template>
  <nav class="tabbar no-print" aria-label="快捷导航">
    <RouterLink
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      :class="{ 'is-active': isActive(t.to) }"
      :aria-current="isActive(t.to) ? 'page' : undefined"
    >
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
/* 自己算的高亮（见上面的 isActive）：样式与全站 .router-link-active 一致 */
.tabbar a.is-active {
  background: var(--primary-soft);
  color: var(--ink);
  font-weight: 850;
}
</style>
