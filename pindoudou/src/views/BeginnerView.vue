<script setup>
/* =========================================================================
   操作台 = 新手简化版的三步向导（2026-10-26 挂在「创作」命令底下）
   -------------------------------------------------------------------------
   路由 /create：① 选图 → ② 调整效果 → ③ 拿图纸。
   之前它顶掉了首页（/），现在首页恢复成带插画的主视觉，操作台退到
   「创作」这一条命令下面 —— 侧栏与手机底栏的「创作」都指到这里。

   三端（手机 / 平板 / 电脑）显示一致：只做这三步，不带首屏以下的长文内容区
10→   （转换步骤 / 功能清单 / FAQ 那套正文留在首页，见 HomeContent）。

   这块内容对爬虫来说不存在：操作台是应用内页面，noindex、不进 Sitemap。

   2026-10-26：手机端改成「一屏工作台」（新版手机端布局需求 V1.0）——
   整个操作台锁在一屏里：顶部步骤条固定、中间当前步骤自己滚、底部主按钮常显。
   桌面 / 平板的版面一个字没动。
   ========================================================================= */
import { onBeforeUnmount, onMounted } from 'vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import BeginnerWizard from '../components/beginner/BeginnerWizard.vue'

/* ---------------------------------------------------------------- 键盘弹起
   手机上弹出输入法时，100dvh 不会跟着缩（iOS / Android 都是），
   一屏工作台会被键盘顶掉一截 —— 底部主按钮就点不到了。
   这里量一下「被键盘吃掉的高度」，写进 --kb，容器高度再减掉它。
   window.innerHeight 是布局视口（不含地址栏），visualViewport.height 是真正
   能看见的那块，两者之差就是键盘高度；没弹键盘时差值≈0。 */
const vv = typeof window !== 'undefined' ? window.visualViewport : null

function syncKeyboard() {
  if (!vv) return
  const hidden = Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0))
  document.documentElement.style.setProperty('--kb', Math.max(0, hidden) + 'px')
}

onMounted(() => {
  syncKeyboard()
  if (vv) {
    vv.addEventListener('resize', syncKeyboard)
    vv.addEventListener('scroll', syncKeyboard)
  }
})

onBeforeUnmount(() => {
  if (vv) {
    vv.removeEventListener('resize', syncKeyboard)
    vv.removeEventListener('scroll', syncKeyboard)
  }
  document.documentElement.style.removeProperty('--kb')
})
</script>

<template>
  <div class="bview">
    <section class="bview__hero">
      <h1 class="sr-only">拼豆操作台 · 三步做出图纸</h1>
      <p class="bview__crumb">
        <PixelIcon name="sparkles" :size="12" />
        创作 · 操作台
      </p>
      <BeginnerWizard />
    </section>
  </div>
</template>

<style scoped>
.bview__hero{padding:18px 0 26px}
.bview__crumb{
  display:inline-flex;align-items:center;gap:6px;
  margin:0 auto 14px;padding:5px 12px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.72);border:1px solid var(--line);
  color:var(--ink-2);font-size:var(--fs-2xs);font-weight:800;letter-spacing:.08em;
}
.bview__crumb .pixelIcon{color:var(--coral)}

/* ============================ 手机端：一屏工作台 ============================
   高度 = 视口 − 顶栏 − 底部标签栏（含安全区）− 键盘高度。
   86 = 标签栏 72 + 离底 8 + 与内容之间的 6px 间距（与工作台 .studio 同一口径）。
   容器锁高 + overflow:hidden ⇒ 整页不再往下长，滚动只发生在中间那一步里。 */
@media(max-width:780px){
  .bview{
    height:calc(100vh - var(--header-h) - 86px - env(safe-area-inset-bottom));
    height:calc(100dvh - var(--header-h) - 86px - env(safe-area-inset-bottom) - var(--kb, 0px));
    display:flex;flex-direction:column;min-height:0;overflow:hidden;
    padding:8px 10px 0;
  }
  .bview__hero{
    flex:1;min-height:0;display:flex;flex-direction:column;
    padding:0;overflow:hidden;
  }
  .bview__crumb{flex:0 0 auto;margin:0 0 8px;padding:3px 10px}
}
/* 极矮的屏（360×640 这类）：面包屑让位给画布 ——
   底栏的「创作」已经说明了这是哪一页，少这一行不影响认路。 */
@media(max-width:780px) and (max-height:720px){
  .bview__crumb{display:none}
}
</style>
