<script setup>
/* =========================================================================
   桌面 / 平板左侧导航
   - 只在 ≥768px 出现；手机端继续用底部标签栏，不受影响。
   - 收起 = 72px 图标轨，展开 = 208px，宽度过渡 .26s（电脑 / 平板同一套）。
   - 默认档位在 App.vue：电脑展开、平板收起、编辑器收起。
   - 底部按钮（图标轨里只有箭头）切换收起 / 展开。
   ========================================================================= */
import { RouterLink, useRoute } from 'vue-router'
import { siteNav } from './siteNav.js'

defineProps({
  open: { type: Boolean, default: true }
})
defineEmits(['toggle'])

const route = useRoute()

function isActive(item) {
  const p = route.path
  if (p === item.to) return true
  if (item.to !== '/' && p.startsWith(item.to + '/')) return true
  return (item.also || []).some(x => p === x || p.startsWith(x + '/'))
}
</script>

<template>
  <aside
    class="side no-print"
    :class="{ 'is-open': open }"
    data-audit="desktop-sidebar"
    aria-label="站点导航"
  >
    <nav class="side__nav">
      <RouterLink
        v-for="item in siteNav" :key="item.to"
        :to="item.to"
        class="side__item"
        :class="{ 'is-active': isActive(item) }"
        :aria-current="isActive(item) ? 'page' : undefined"
        :title="item.label"
      >
        <img class="side__icon" :src="item.iconSrc" alt="" aria-hidden="true" width="28" height="28">
        <span class="side__label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <button
      class="side__fold"
      type="button"
      data-audit="sidebar-toggle"
      :aria-label="open ? '收起导航' : '展开导航'"
      :title="open ? '收起导航' : '展开导航'"
      @click="$emit('toggle')"
    >
      <svg
        class="side__chev" :class="{ 'is-closed': !open }"
        viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"
      >
        <path d="M15 6l-6 6 6 6"></path>
      </svg>
      <span class="side__label">{{ open ? '收起导航' : '展开导航' }}</span>
    </button>
  </aside>
</template>

<style scoped>
.side {
  position: sticky;
  top: var(--header-h);
  z-index: 40;
  /* 宽度跟着外层 --side-w（72 / 208）走，收起 / 展开时平滑过渡；
     高度跟着导航内容走，短页面不会因为「一屏高的侧栏」把页脚推下去；
     底色与分隔线由 .appBody--side::before 负责，短页面也保持整列同色。 */
  width: var(--side-w, 72px);
  flex: 0 0 auto;
  max-height: calc(100dvh - var(--header-h));
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 10px 12px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  transition: width .26s var(--ease);
  animation: sideIn .24s var(--ease);
}

/* 从首页（导航在顶栏）进入内页时，侧栏轻轻滑入 */
@keyframes sideIn {
  from { opacity: 0; transform: translateX(-10px); }
  to { opacity: 1; transform: none; }
}

.side__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.side__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 12px;
  border-radius: 12px;
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  transition: background .16s var(--ease), color .16s var(--ease);
}
.side__item:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.side__item:focus-visible {
  outline: 2px solid var(--pink);
  outline-offset: 2px;
}
.side__item.is-active {
  background: var(--primary-soft);
  color: var(--primary-ink);
  font-weight: 850;
}

/* 交付包原图 192×192 透明 PNG，按 28px 显示，保持比例、不加底板 */
.side__icon {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  object-fit: contain;
}

.side__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 展开时文字跟着宽度一起淡入，避免在图标轨里先挤出来再跳到位 */
.side.is-open .side__label {
  animation: sideLabelIn .2s var(--ease) .04s both;
}
@keyframes sideLabelIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.side__fold {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  margin: 10px 2px 0;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: background .16s var(--ease), color .16s var(--ease);
}
.side__fold:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.side__fold:focus-visible {
  outline: 2px solid var(--pink);
  outline-offset: 2px;
}

.side__chev {
  flex: 0 0 auto;
  transition: transform .26s var(--ease);
}
.side__chev.is-closed {
  transform: rotate(180deg);
}

/* 收起 = 图标轨：电脑、平板同一套规则，宽度由外层 is-open 决定 */
.side:not(.is-open) .side__item {
  justify-content: center;
  padding: 0;
}
.side:not(.is-open) .side__label {
  display: none;
}
.side:not(.is-open) .side__fold {
  justify-content: center;
  padding: 0;
}

/* 手机端保持原样：底部标签栏负责导航（768px 起由左侧图标轨接管） */
@media (max-width: 767px) {
  .side {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .side,
  .side__chev {
    transition: none;
  }
  .side {
    animation: none;
  }
  .side.is-open .side__label {
    animation: none;
  }
}
</style>
