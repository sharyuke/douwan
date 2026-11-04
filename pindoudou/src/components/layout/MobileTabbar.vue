<script setup>
import { RouterLink, useRoute } from 'vue-router'
import Icon from '../ui/Icon.vue'

/** 手机端底部标签栏（PRD §12：创作 | 材料 | 素材 | 作品）
    「创作」直接进全屏工作台（/editor）：上传、编辑、导出都在这一屏里完成。
    图标按 Figma 图标规范（155:2）：24px 线性图标、currentColor，随高亮一起变色。 */
const tabs = [
  { to: '/editor', icon: 'pencil', label: '创作' },
  { to: '/project-materials', icon: 'list', label: '材料' },
  { to: '/materials/', icon: 'images', label: '素材' },
  { to: '/projects', icon: 'folder-open', label: '作品' }
]

const route = useRoute()
/* 自己算高亮：RouterLink 自带的 router-link-active 对 '/' 是「祖先匹配」，
   那样在素材库、我的作品页也会把「创作」点亮 —— 用错的高亮比没有高亮更误导。 */
function isActive(to) {
  const p = route.path
  if (to === '/editor') return p.startsWith('/editor')
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
      <Icon class="tabbar__icon" :name="t.icon" :size="24" />
      <span>{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar__icon {
  display: block;
  /* 图标固定 24×24：格子在窄屏会被 flex 压窄，别让图标跟着被横向挤扁 */
  flex: 0 0 auto;
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
  font-weight: 700;
}
</style>
