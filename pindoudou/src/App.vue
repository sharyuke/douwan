<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppHeader from './components/layout/AppHeader.vue'
import AppFooter from './components/layout/AppFooter.vue'
import DesktopSidebar from './components/layout/DesktopSidebar.vue'
import AccountNav from './components/layout/AccountNav.vue'
import MobileTabbar from './components/layout/MobileTabbar.vue'
import FeedbackWidget from './components/layout/FeedbackWidget.vue'
import ToastHost from './components/ui/ToastHost.vue'
import { refreshEntitlement } from './composables/useMembership.js'
import { bootstrapDevice } from './composables/useUserAccount.js'
import { syncServerEntitlements, ensureBackend } from './composables/useBackend.js'
import { syncProjects } from './composables/useProjectSync.js'
import { undo, redo, canUndo, canRedo } from './composables/useStudio.js'

const route = useRoute()

/* 工作台（编辑器）本身是「一屏放下三栏」的工具界面，站点页脚跟在它后面会把
   页面撑高两屏，滚动时页脚还挤进画布旁边（整页截图里最明显）。
   工具界面不需要营销导航，所以这些路由不渲染页脚 —— 由路由 meta.studio 标记，
   以后再有同类整屏工作台，加一个 meta 就行，不用改这里。 */
/* 站点页脚放首页：2026-10-26 晚把工具页底部那条三栏页脚挪到了首页，
   首页原来的 Figma 紧凑页脚一并去掉（两个页脚叠在一起会重复）。 */
const showFooter = computed(() => !route.meta.studio && !route.meta.admin && !route.meta.noFooter)

/* 后台有独立的顶栏、侧边导航与移动端抽屉，前台这些都不该出现 */
const showSiteChrome = computed(() => !route.meta.admin)

/* 全屏工作台（/editor，2026-11-01 按 Figma 设计改版）：桌面端不渲染站点顶栏、
   左侧导航、底部标签栏与右下角反馈小标 —— 工作台自己有完整的全局命令栏，
   站点外壳会额外吃掉 72px 高度、还会和浮动工具栏抢位置。
   平板没有对应的全屏设计，继续保留站点外壳；手机端 2026-11-01 也有了工作台设计稿
   （124:887），自己带作品栏与工具轨，站点顶栏 / 标签栏同样让位。 */
const wideViewportQuery = window.matchMedia('(min-width: 1100px)')
const wideViewport = ref(wideViewportQuery.matches)
const narrowViewportQuery = window.matchMedia('(max-width: 780px)')
const narrowViewport = ref(narrowViewportQuery.matches)
const fullscreenStudio = computed(() => !!route.meta.studio && (wideViewport.value || narrowViewport.value))

/* 首页的主导航放在顶栏（设计稿红框位置），进入内页后才换成左侧栏。
   手机端两边都不渲染这份外壳，继续用底部标签栏。 */
const isHome = computed(() => route.name === 'home')
/* 个人空间（个人概览 / 我的作品 / 我的库存 / 设置）不用左侧站点导航：
   分区切换与去创作、素材库的入口都收在顶部 AccountNav 一条里（2026-11-05）。
   素材收藏是素材库的收藏视图（/materials/?col=fav），同样算个人空间的一页。 */
const isFavorites = computed(() =>
  route.name === 'materials-center' && route.query.col === 'fav')
const inAccountArea = computed(() => !!route.meta.account || isFavorites.value)
const showSidebar = computed(() =>
  showSiteChrome.value && !isHome.value && !fullscreenStudio.value && !inAccountArea.value)


/* 左侧导航默认状态：电脑展开、平板（768–1099）收起成图标轨、工作台收起。
   用户手动点过收起 / 展开后，切页面时保留他的选择；工作台始终收起。 */
const narrowSidebar = () => window.matchMedia('(max-width: 1099px)').matches
const sidebarOpen = ref(!narrowSidebar())
const sidebarTouched = ref(false)
watch(() => route.meta.studio, studio => {
  if (studio) sidebarOpen.value = false
  else if (!sidebarTouched.value) sidebarOpen.value = !narrowSidebar()
}, { immediate: true })

function toggleSidebar() {
  sidebarTouched.value = true
  sidebarOpen.value = !sidebarOpen.value
}

/* 跨过 1100px 时全屏工作台与卡片版面互换：站点外壳跟着出现 / 消失 */
function onWideViewport(e) { wideViewport.value = e.matches }
function onNarrowViewport(e) { narrowViewport.value = e.matches }


/* 素材库的筛选、搜索、排序都写在地址栏里；如果按 fullPath 重挂页面，
   每敲一次搜索都会把页面整个重建（滚动位置回顶、待生效的输入被地址栏覆盖）。
   素材库自己监听 query 变化，所以这里按路由名固定 key。 */
const viewKey = computed(() => {
  if (route.name === 'editor') return 'editor'
  if (route.name === 'materials-center' || route.name === 'material-category') return 'library'
  return route.fullPath
})

onMounted(async () => {
  wideViewportQuery.addEventListener('change', onWideViewport)
  narrowViewportQuery.addEventListener('change', onNarrowViewport)
  // 进入应用先做一次到期检查，验证「到期后权限正确回落」（PRD §57）
  refreshEntitlement()


  /* 恢复本机身份并同步服务端权益。
     收费功能的可用性以服务端返回的权益矩阵为准；同步失败时保持未验证状态，
     免费功能不受影响。 */
  const user = await bootstrapDevice()
  await ensureBackend()
  if (user) await syncServerEntitlements()
  /* 作品按账号同步：登录后（含本机匿名身份）拉一次服务端列表，
     换设备 / 换浏览器登录同一账号就能看到同一份作品。 */
  if (user) await syncProjects()

  // 全局撤销 / 重做快捷键（PRD 交互原则 4：所有结果都要可逆）
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || ''
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    const k = e.key.toLowerCase()
    /* 没得撤销时不要吞掉按键：浏览器自己的 Ctrl+Z 该干嘛干嘛，
       也免得用户以为快捷键生效了却什么都没发生 */
    if (k === 'z' && !e.shiftKey) { if (canUndo.value) { e.preventDefault(); undo() } }
    else if (k === 'y' || (e.shiftKey && k === 'z')) { if (canRedo.value) { e.preventDefault(); redo() } }
  })
})
</script>

<template>
  <div class="app">
    <AppHeader v-if="showSiteChrome && !fullscreenStudio" />
    <AccountNav v-if="showSiteChrome && inAccountArea" />

    <div
      class="appBody"
      :class="{ 'appBody--side': showSidebar, 'is-open': sidebarOpen }"
    >
      <DesktopSidebar
        v-if="showSidebar"
        :open="sidebarOpen"
        @toggle="toggleSidebar"
      />
      <div class="appContent">
        <main class="main">
          <RouterView v-slot="{ Component, route }">
            <component :is="Component" :key="viewKey" />
          </RouterView>
        </main>
        <AppFooter v-if="showFooter" />
      </div>
    </div>
    <MobileTabbar v-if="showSiteChrome && !fullscreenStudio" />
    <!-- 前台各页面右侧的意见反馈入口；后台不显示。
         全屏工作台把入口收进顶部命令栏（反馈按钮派发 douwan:open-feedback），
         所以这里只隐藏那颗浮标，弹窗仍然可用。 -->
    <FeedbackWidget v-if="showSiteChrome" :tab-hidden="fullscreenStudio" />

    <ToastHost />
  </div>
</template>
