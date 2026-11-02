<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import AppHeader from './components/layout/AppHeader.vue'
import AppFooter from './components/layout/AppFooter.vue'
import DesktopSidebar from './components/layout/DesktopSidebar.vue'
import MobileTabbar from './components/layout/MobileTabbar.vue'
import FeedbackWidget from './components/layout/FeedbackWidget.vue'
import ToastHost from './components/ui/ToastHost.vue'
import ModeSwitchDialog from './components/beginner/ModeSwitchDialog.vue'
import { refreshEntitlement } from './composables/useMembership.js'
import { bootstrapDevice } from './composables/useUserAccount.js'
import { syncServerEntitlements, ensureBackend } from './composables/useBackend.js'
import { syncProjects } from './composables/useProjectSync.js'
import { undo, redo, canUndo, canRedo } from './composables/useStudio.js'
import { mode, setMode } from './composables/useBeginnerMode.js'

const route = useRoute()
const router = useRouter()

/* 工作台（编辑器）本身是「一屏放下三栏」的工具界面，站点页脚跟在它后面会把
   页面撑高两屏，滚动时页脚还挤进画布旁边（整页截图里最明显）。
   工具界面不需要营销导航，所以这些路由不渲染页脚 —— 由路由 meta.studio 标记，
   以后再有同类整屏工作台，加一个 meta 就行，不用改这里。
   操作台（/create）也是工具页，用 meta.noFooter 单独关掉页脚。 */
/* 站点页脚放首页：2026-10-26 晚把操作台底部那条三栏页脚挪到了首页，
   首页原来的 Figma 紧凑页脚一并去掉（两个页脚叠在一起会重复）。 */
const showFooter = computed(() => !route.meta.studio && !route.meta.admin && !route.meta.noFooter)

/* 后台有独立的顶栏、侧边导航与移动端抽屉，前台这些都不该出现 */
const showSiteChrome = computed(() => !route.meta.admin)

/* 首页的主导航放在顶栏（设计稿红框位置），进入内页后才换成左侧栏。
   手机端两边都不渲染这份外壳，继续用底部标签栏。 */
const isHome = computed(() => route.name === 'home')
const showSidebar = computed(() => showSiteChrome.value && !isHome.value)

/* ---------------------------------------------------------------- 模式同步
   操作台（/create，新手简化版三步向导）和专业工作台（/editor）是同一件作品，
   模式只决定显示哪一层界面 —— 所以切模式 = 换路由，作品状态原样留着。

   只在这两个地址之间同步：用户在素材库、我的作品这些页面时不要把他弹走，
   那会让人以为点坏了。首页（/）不参与同步：它是宣传页，不是工作台。 */
watch(() => route.path, p => {
  if (p === '/create' || p.startsWith('/editor')) {
    setMode(p.startsWith('/editor') ? 'pro' : 'beginner')
  }
}, { immediate: true })

/* 模式一变就跟着换页面（顶栏的「新手版 / 专业版」按钮触发的就是它） */
watch(mode, m => {
  const to = m === 'pro' ? '/editor' : '/create'
  if (route.path !== to) router.push(to).catch(() => {})
})

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

/* 素材库的筛选、搜索、排序都写在地址栏里；如果按 fullPath 重挂页面，
   每敲一次搜索都会把页面整个重建（滚动位置回顶、待生效的输入被地址栏覆盖）。
   素材库自己监听 query 变化，所以这里按路由名固定 key。 */
const viewKey = computed(() => {
  if (route.name === 'editor') return 'editor'
  if (route.name === 'materials-center' || route.name === 'material-category') return 'library'
  return route.fullPath
})

onMounted(async () => {
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
    <AppHeader v-if="showSiteChrome" />
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
    <MobileTabbar v-if="showSiteChrome" />
    <!-- 前台各页面右侧的意见反馈入口；后台不显示 -->
    <FeedbackWidget v-if="showSiteChrome" />
    <!-- 新手 / 专业 模式切换的保护弹层（全站只挂一个） -->
    <ModeSwitchDialog />
    <ToastHost />
  </div>
</template>
