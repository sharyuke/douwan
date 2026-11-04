<script setup>
/* =========================================================================
   首页（2026-11-01，按「豆玩 · 像素花园首页」重做）
   -------------------------------------------------------------------------
   设计稿 1600×900：导航 88 → 主视觉 730 → 页脚 82。
   主视觉只有三件东西：插画（DOUWAN 水印 + 角色）、主标题、主按钮。
   插画是设计稿里那张图（裁掉导航与标题后的部分），标题与按钮是真实 DOM。
   ========================================================================= */

import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { setPendingUpload } from '../composables/usePendingUpload.js'
import Icon from '../components/ui/Icon.vue'
import heroArt from '../assets/home-hero-v3.png'

const router = useRouter()
const dragOver = ref(false)
const dropError = ref('')

function onDragOver(e) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  dropError.value = ''
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (!/^image\//.test(file.type)) {
    dropError.value = '请拖入图片文件（JPG、PNG、WEBP）'
    return
  }
  setPendingUpload(file)
  router.push('/editor').catch(() => {})
}
</script>

<template>
  <div
    class="homeV3"
    :class="{ 'is-drag': dragOver }"
    @dragenter="onDragOver" @dragover="onDragOver"
    @dragleave="onDragLeave" @drop="onDrop"
  >
    <h1 class="sr-only">豆玩拼豆图纸生成器</h1>
    <div class="homeV3__hero">
      <img class="homeV3__art" :src="heroArt" alt="豆玩拼豆创作插画" draggable="false">
      <p class="homeV3__title"><span>把灵感</span><span class="homeV3__comma">，</span><span>拼成喜欢的样子</span></p>
      <RouterLink to="/editor" class="homeV3__cta">
        <Icon name="wand-sparkles" :size="24" />
        <span>立即创作</span>
        <Icon name="arrow-right" :size="24" />
      </RouterLink>
      <p v-if="dropError" class="homeV3__error">{{ dropError }}</p>
    </div>
  </div>
</template>

<style scoped>
.homeV3{
  display:flex;flex-direction:column;
  min-height:calc(100dvh - var(--header-h) - 82px);
  background:var(--cream);
}
.homeV3__hero{
  flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:12px 20px 64px;text-align:center;
}
.homeV3__art{
  display:block;width:min(1440px,100%);height:auto;
  user-select:none;-webkit-user-drag:none;
}
.homeV3__title{
  margin:22px 0 0;font-size:28px;line-height:var(--ty-page-lh);font-weight:700;
  font-family:var(--font-sans);
  letter-spacing:0;color:var(--ink);
}
.homeV3__cta{
  display:inline-flex;align-items:center;justify-content:center;gap:14px;
  min-width:282px;height:62px;padding:0 34px;margin-top:16px;
  border-radius:var(--r-pill);background:var(--primary);color:var(--ink);
  font-size:18px;font-weight:700;letter-spacing:0;
  transition:background var(--t),transform var(--t);line-height:var(--ty-section-lh)
}
.homeV3__cta:hover{background:var(--primary-deep);transform:translateY(-1px)}
.homeV3__error{margin:12px 0 0;font-size:13px;font-weight:700;color:var(--danger);line-height:var(--ty-label-lh)}
.homeV3.is-drag .homeV3__cta{background:var(--primary-deep)}

@media(max-width:780px){
  .homeV3{min-height:calc(100dvh - var(--header-h));padding-bottom:calc(96px + env(safe-area-inset-bottom))}
  .homeV3__hero{padding:20px 18px 40px}
  .homeV3__title{margin:26px auto 0;max-width:300px;font-size:24px;line-height:var(--ty-dialog-lh)}
  /* 手机稿标题固定断成两行：把灵感 / 拼成喜欢的样子（不带逗号） */
  .homeV3__title span{display:block}
  .homeV3__title .homeV3__comma{display:none}
  .homeV3__cta{width:100%;max-width:320px;min-width:0;height:60px;margin-top:22px;font-size:18px;line-height:var(--ty-section-lh)}
}
</style>
