<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { hasPattern, currentProjectId, isFinished } from '../../composables/useStudio.js'
import {
  currentUser, displayName, isAnonymousDevice, isLoggedIn
} from '../../composables/useUserAccount.js'
import LoginDialog from '../ui/LoginDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import logoDouwan from '../../assets/logo-douwan.webp'
import { setPendingUpload } from '../../composables/usePendingUpload.js'
import { libKeyword } from '../../composables/useAssets.js'
import { toastErr } from '../../composables/useToast.js'

const loginOpen = ref(false)
const uploadInput = ref(null)

/* 登录统一先弹框：微信扫码与邮箱注册 / 登录都在弹窗里 */
function openLogin() {
  loginOpen.value = true
}
/* 未登录、或只是本机匿名身份时，顶栏给一个明确的「登录」入口。
   真实账号登录后不再显示，避免顶栏出现两个账号入口。 */
const needLogin = computed(() => !isLoggedIn.value || isAnonymousDevice.value)

const route = useRoute()
const router = useRouter()

/* 主导航在桌面 / 平板的左侧栏与手机底部标签栏，顶栏不放导航，避免双导航。 */
const isLibrary = computed(() => route.name === 'library')

/** 素材库顶栏的上传入口：沿用首页那条 pendingUpload → /editor 的链路 */
function triggerUpload() {
  uploadInput.value?.click()
}

function onUpload(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!/^image\//.test(file.type)) {
    toastErr('请选择图片文件（JPG / PNG / WEBP）')
    return
  }
  setPendingUpload(file)
  router.push('/editor').catch(() => {})
}
/* 首页现在只有一屏，没有可滚的板块了：顶栏在首页也用站内导航，
   不再挂那组「滚到某个板块」的按钮（点不到东西的按钮比没有更糟）。 */

/**
 * 创作流程：创建 → 设计 → 完成。工作台页面用它替换主导航（对齐参考版顶栏版面）。
 *
 * 三步都要能点、能到：
 *   - 「创建」和「设计」其实都在 /editor 这一个地址下（选好图之前是第一步，
 *     有图纸之后才是第二步），点谁都回工作台；
 *   - 「完成」= /build（拼制 + 标记完成）。它以前只能靠路由偶然到达，
 *     而且免费版被 Pro 弹窗挡住 —— 第三步在界面上是个永远点不动的装饰。
 *     现在它跟着当前作品走（带上作品 id），没图纸时才锁住。
 */
const STUDIO_STEPS = [
  { n: 1, label: '创建', hint: '上传照片 / AI生成素材 / 免费素材库' },
  { n: 2, label: '设计', hint: '选方案、调颜色与画布大小' },
  { n: 3, label: '完成', hint: '逐颗拼制并标记作品完成' }
]
const stepIndex = computed(() => {
  const p = route.path
  if (p.startsWith('/editor')) return hasPattern.value ? 2 : 1
  if (p.startsWith('/materials')) return 2
  if (p.startsWith('/build')) return 3
  return 0
})
const inStudio = computed(() => stepIndex.value > 0)

/** 第 3 步的目标地址：带上作品 id，BuildView 才能装载图案 */
const finishTo = computed(() => {
  if (!hasPattern.value) return ''
  return currentProjectId.value ? `/build/${currentProjectId.value}` : '/build'
})

function stepTo(s) {
  // 第 1 / 2 步都在工作台里（选好图之前是创建，之后是设计）
  if (s.n === 3) return finishTo.value
  if (s.n === 2 && !hasPattern.value) return ''
  return '/editor'
}

function stepLocked(s) {
  return !stepTo(s)
}

/** 已经走过的步骤打 ✓；第 3 步另外看「作品是否真的完成了」 */
function stepDone(n) {
  if (n === 3) return isFinished.value || stepIndex.value > 3
  return stepIndex.value > n
}

function stepTitle(s) {
  if (!stepTo(s)) {
    return s.n === 2 ? '先生成一张图纸，再进入设计' : '先生成一张图纸，再进入这一步'
  }
  if (s.n === 3) return isFinished.value ? '这件作品已完成 · 查看完成记录' : s.hint
  return s.hint
}

function goStep(s) {
  const to = stepTo(s)
  if (to && route.path !== to) router.push(to).catch(() => {})
}
</script>

<template>
  <header class="topbar no-print" :class="{ 'topbar--library': isLibrary }">
    <div class="topbar__in">
      <RouterLink to="/" class="brand" aria-label="豆玩 DOUWAN 首页">
        <img class="brand__logo" :src="logoDouwan" alt="豆玩 DOUWAN" width="157" height="52">
      </RouterLink>
      <span class="brand__slogan">所爱皆可拼，万物皆可造</span>

      <!-- 工作台里用创作流程指示 -->
      <div v-if="inStudio" class="topsteps" aria-label="创作流程">
        <template v-for="(s, i) in STUDIO_STEPS" :key="s.n">
          <span v-if="i" class="stepsep" aria-hidden="true"></span>
          <button
            type="button"
            class="step"
            :class="{ done: stepDone(s.n), active: stepIndex === s.n, locked: stepLocked(s) }"
            :disabled="stepLocked(s)"
            :aria-current="stepIndex === s.n ? 'step' : undefined"
            :title="stepTitle(s)"
            @click="goStep(s)"
          >
            <i><PixelIcon v-if="stepDone(s.n)" name="check" :size="11" /><template v-else>{{ s.n }}</template></i>
            <span class="stepLabel">{{ s.label }}</span>
          </button>
        </template>
      </div>

      <label v-if="isLibrary" class="libSearch">
        <PixelIcon name="search" :size="15" />
        <input v-model="libKeyword" type="search" placeholder="搜索你喜欢的素材…" aria-label="搜索素材">
      </label>

      <div class="topbar__actions">
        <input ref="uploadInput" class="libFile" type="file" accept="image/*" @change="onUpload">
        <button
          v-if="isLibrary"
          type="button" class="btn primary libUpload"
          title="上传图片去创作"
          @click="triggerUpload"
        >
          <PixelIcon name="upload" :size="15" />
          <span class="libUpload__label">上传图片去创作</span>
        </button>
        <RouterLink v-if="inStudio" to="/projects" class="btn btn-secondary btn--desktop">作品</RouterLink>
        <button
          v-if="needLogin"
          type="button"
          class="btn btn-secondary loginBtn"
          data-audit="header-login"
          @click="openLogin"
        >登录</button>
        <RouterLink
          to="/account"
          class="btn btn-secondary accountBtn"
          :title="needLogin ? '个人中心（可登录或绑定账号）' : '个人中心'"
          aria-label="个人中心"
        >
          <!-- 原来的 ☺ 太小也太抽象，换成明确的单人图标；桌面同时写出「个人中心」 -->
          <img
            v-if="currentUser && currentUser.avatar_url"
            class="accountBtn__avatar"
            :src="currentUser.avatar_url"
            alt=""
            referrerpolicy="no-referrer"
          >
          <svg v-else viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
               fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="4"></circle>
            <path d="M4.5 20c0-3.4 3.4-6 7.5-6s7.5 2.6 7.5 6"></path>
          </svg>
          <span class="accountBtn__label">{{ needLogin ? '个人中心' : (displayName || '个人中心') }}</span>
        </RouterLink>
      </div>
    </div>
  </header>

  <LoginDialog v-model="loginOpen" />
</template>

<style scoped>
.libFile{display:none}
.libSearch{
  display:flex;align-items:center;gap:8px;flex:1;min-width:160px;max-width:460px;
  height:40px;padding:0 12px;margin-left:4px;
  background:var(--surface);border:1px solid var(--line);border-radius:12px;
  transition:var(--t);
}
.libSearch:focus-within{border-color:#F0D98A;box-shadow:0 0 0 3px rgba(255,214,46,.14)}
.libSearch input{
  flex:1;min-width:0;border:0;background:transparent;outline:none;
  font-size:var(--fs-sm);color:var(--ink);
}
.libSearch input::placeholder{color:var(--muted-2)}
.libUpload{flex:0 0 auto}
/* 素材库顶栏多了搜索框：中等宽度先收掉 slogan，给搜索留位置 */
@media(max-width:1240px){.topbar--library .brand__slogan{display:none}}
@media(max-width:1000px){
  .libUpload__label{display:none}
  .libUpload{width:40px;padding:0}
}
@media(max-width:780px){
  .libSearch{display:none}
  .libUpload{width:38px;min-height:38px;padding:0;border-radius:12px}
}
</style>
