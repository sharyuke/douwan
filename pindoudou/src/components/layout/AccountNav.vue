<script setup>
/* =========================================================================
   个人空间顶部导航（2026-11-05）

   个人中心不再挂左侧站点导航：四个分区（个人概览 / 我的作品 / 素材收藏 /
   我的库存）全部由这一条顶栏切换，右侧留「创作」「素材库」两个互通入口；
   从这两处回个人空间走顶栏的头像 / 侧栏的「我的作品」「我的库存」。
   页面切换由 App.vue 按路由 meta.account 统一挂载，各页不用自己再写一份。
   ========================================================================= */
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from '../ui/Icon.vue'

const route = useRoute()

const tabs = [
  { key: 'overview', label: '个人概览', to: '/account' },
  { key: 'works', label: '我的作品', to: '/projects' },
  { key: 'favorites', label: '素材收藏', to: '/materials/?col=fav' },
  { key: 'inventory', label: '我的库存', to: '/inventory' }
]

const activeKey = computed(() => {
  const p = route.path
  if (p.startsWith('/projects')) return 'works'
  if (p.startsWith('/inventory')) return 'inventory'
  if (p.startsWith('/materials') && route.query.col === 'fav') return 'favorites'
  if (p.startsWith('/account')) return 'overview'
  return ''
})

const inSettings = computed(() => route.path.startsWith('/settings'))
</script>

<template>
  <nav
    class="acNav no-print"
    :class="{ 'acNav--account': route.name === 'account' }"
    aria-label="个人空间"
  >
    <div class="acNav__inner">
      <RouterLink
        v-for="t in tabs" :key="t.key"
        :to="t.to"
        class="acNav__tab"
        :class="{ 'is-on': activeKey === t.key }"
        :aria-current="activeKey === t.key ? 'page' : undefined"
      >{{ t.label }}</RouterLink>
      <span class="acNav__spacer"></span>
      <RouterLink
        class="acNav__tab acNav__tab--quiet"
        :class="{ 'is-on': inSettings }"
        to="/settings"
        :aria-current="inSettings ? 'page' : undefined"
      >设置</RouterLink>
      <RouterLink class="acNav__go" to="/editor" title="去工作台创作">
        <Icon name="pencil" :size="16" />创作
      </RouterLink>
      <RouterLink class="acNav__go" to="/materials/" title="去素材库">
        <Icon name="images" :size="16" />素材库
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.acNav{
  background:var(--ty-surface);
  border-bottom:1px solid var(--ty-line);
}
.acNav__inner{
  width:min(1440px,100%);margin:0 auto;
  padding:0 22px;
  display:flex;align-items:center;gap:28px;height:50px;
}
/* 个人概览按 1:290 设计稿的 64px 留白走，和下面的内容对齐 */
.acNav--account .acNav__inner{padding:0 64px}
.acNav__tab{
  position:relative;display:inline-flex;align-items:center;height:50px;
  font-family:var(--font-sans);font-size:var(--ty-label);font-weight:500;
  line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ty-body-ink);
  text-decoration:none;white-space:nowrap;
}
.acNav__tab:hover{color:var(--ty-ink)}
.acNav__tab.is-on{font-weight:700;color:var(--ty-ink)}
.acNav__tab.is-on::after{
  content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;
  background:var(--ty-accent);border-radius:2px 2px 0 0;
}
.acNav__tab--quiet{color:var(--ty-muted)}
.acNav__spacer{flex:1 1 auto}
.acNav__go{
  display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;
  border:1px solid var(--ty-line);border-radius:99px;background:var(--ty-surface);
  font-family:var(--font-sans);font-size:var(--ty-label);font-weight:500;
  line-height:var(--ty-label-lh);letter-spacing:0;color:var(--ty-ink);text-decoration:none;
  white-space:nowrap;
}
.acNav__go:hover{background:var(--ty-surface-soft)}

@media(max-width:1180px){
  .acNav--account .acNav__inner{padding-left:32px;padding-right:32px}
}
@media(max-width:780px){
  .acNav__inner{padding-left:14px;padding-right:14px}
  .acNav--account .acNav__inner{padding-left:16px;padding-right:16px}
  .acNav__inner{gap:18px;overflow-x:auto}
  .acNav__go{display:none}
}
</style>
