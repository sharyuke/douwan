<script setup>
import { RouterLink } from 'vue-router'
import PixelIcon from '../ui/PixelIcon.vue'

/** 手机端底部标签栏（PRD §12：创作 | 材料 | 素材 | 作品）
    「创作」原本指向独立的开始创作页，那一层现在并进了工作台
    （没图纸时工作台就是创建步骤），两个格子会跳同一处，所以合成一个。
    图标统一走 ui/Icon 的线性 SVG：字符图标在不同系统字体下粗细不一致。 */
const tabs = [
  { to: '/editor', icon: 'brush', label: '创作' },
  { to: '/materials', icon: 'layers', label: '材料' },
  { to: '/library', icon: 'palette', label: '素材' },
  { to: '/projects', icon: 'folder', label: '作品' }
]
</script>

<template>
  <nav class="tabbar no-print" aria-label="快捷导航">
    <RouterLink v-for="t in tabs" :key="t.to" :to="t.to">
      <PixelIcon :name="t.icon" :size="18" />
      <span>{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>
