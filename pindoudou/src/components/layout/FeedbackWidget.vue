<script setup>
/* =========================================================================
   意见反馈：贴在前台右侧的悬浮小标签
   - 平时收进屏幕边缘，只露出一条 16px 的黄色「反馈」条；
   - 桌面悬停 / 键盘聚焦 / 手机左滑 会滑出来，点击打开反馈弹窗；
   - 弹窗关闭或一段时间没有操作后自动收回，不挡页面内容。
   只在网站页面出现：后台路由由 App.vue 的 showSiteChrome 拦掉。
   ========================================================================= */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import { feedbackApi } from '../../lib/api.js'
import { currentUser, displayName, isAnonymousDevice } from '../../composables/useUserAccount.js'
import { toastErr, toastOk } from '../../composables/useToast.js'

const TYPES = [
  { value: 'suggestion', label: '功能建议' },
  { value: 'bug', label: '使用问题' },
  { value: 'content', label: '内容错误' },
  { value: 'other', label: '其他' }
]

const CONTENT_MAX = 500
const CONTACT_MAX = 100

const route = useRoute()

/** 是否滑出（false = 收在屏幕边缘） */
const slid = ref(false)
const dialogOpen = ref(false)
const submitting = ref(false)
const error = ref('')

const form = ref({ type: 'suggestion', content: '', contact: '' })

const canSubmit = computed(() => form.value.content.trim().length > 0 && !submitting.value)

const userHint = computed(() => {
  if (!currentUser.value) return '未登录也可以提交；留下联系方式才能收到回复。'
  if (isAnonymousDevice.value) return '当前是本机访客身份，留下联系方式才能收到回复。'
  return `已登录 ${displayName.value}，这条反馈会关联到你的账号。`
})

/* ------------------------------------------------------------------ 滑出 / 收起 */

let hideTimer = null

function clearHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function reveal() {
  clearHide()
  slid.value = true
}

function scheduleHide(delay = 2600) {
  clearHide()
  hideTimer = setTimeout(() => {
    // 弹窗开着的时候不收起，否则关掉弹窗时标签已经不见了，用户会以为没提交成功
    if (!dialogOpen.value) slid.value = false
  }, delay)
}

function onMouseEnter() {
  reveal()
}

function onMouseLeave() {
  scheduleHide(320)
}

function onFocusIn() {
  reveal()
}

function onFocusOut() {
  scheduleHide(320)
}

/* 手机：向左滑一下把标签拉出来；滑动结束的那一下不触发点击 */
let startX = null
let startY = null
let swiped = false
let suppressClick = false

function onPointerDown(e) {
  if (e.pointerType === 'mouse') return
  startX = e.clientX
  startY = e.clientY
  swiped = false
}

function onPointerMove(e) {
  if (startX == null) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (dx < -12 && Math.abs(dx) > Math.abs(dy)) {
    slid.value = true
    swiped = true
  }
}

function onPointerUp() {
  if (startX == null) return
  startX = null
  if (swiped) {
    suppressClick = true
    setTimeout(() => { suppressClick = false }, 400)
    scheduleHide(3200)
  }
}

/* ------------------------------------------------------------------ 弹窗 */

/** 当前页面的路由模板（/library/:slug），用来帮运营定位问题 */
function currentPage() {
  const matched = route.matched && route.matched.length ? route.matched[route.matched.length - 1] : null
  return (matched && matched.path) || route.path || ''
}

function openDialog() {
  if (suppressClick) return
  error.value = ''
  // 登录用户留过邮箱 / 手机号时预填，省一次输入；用户仍可改
  if (!form.value.contact) {
    const user = currentUser.value
    form.value.contact = (user && (user.email || user.phone)) || ''
  }
  reveal()
  dialogOpen.value = true
}

function closeDialog() {
  dialogOpen.value = false
  scheduleHide(1200)
}

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  submitting.value = true
  try {
    const data = await feedbackApi.submit({
      type: form.value.type,
      content: form.value.content.trim(),
      contact: form.value.contact.trim(),
      page: currentPage()
    })
    toastOk((data && data.message) || '已收到，谢谢你的反馈')
    form.value = { type: 'suggestion', content: '', contact: '' }
    closeDialog()
  } catch (e) {
    // 错误留在弹窗里，用户不用重新打开就能改完再提交
    error.value = e && e.message ? e.message : '提交失败，请稍后再试'
  } finally {
    submitting.value = false
  }
}

/* 换页面时收回标签，避免它停在上一个页面的状态里 */
watch(() => route.fullPath, () => {
  clearHide()
  slid.value = false
  dialogOpen.value = false
})

onBeforeUnmount(clearHide)
</script>

<template>
  <div
    class="fb no-print"
    :class="{ 'is-open': slid }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <button
      class="fb__tab"
      type="button"
      aria-label="意见反馈"
      title="意见反馈"
      @click="openDialog"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <span class="fb__hint" aria-hidden="true">反馈</span>
      <span class="fb__body">
        <span class="fb__icon"><PixelIcon name="info" :size="16" /></span>
        <span class="fb__label">意见反馈</span>
      </span>
    </button>
  </div>

  <BaseDialog
    :model-value="dialogOpen"
    title="意见反馈"
    sheet
    @update:model-value="v => { if (!v) closeDialog() }"
  >
    <div class="fbForm">
      <p class="fbForm__lead">
        用一句话告诉我们哪里可以更好。遇到问题时写清楚页面和操作步骤，我们能更快定位。
      </p>

      <div class="fbForm__types" role="group" aria-label="反馈类型">
        <button
          v-for="t in TYPES" :key="t.value"
          class="fbChip" :class="{ on: form.type === t.value }"
          type="button"
          @click="form.type = t.value"
        >{{ t.label }}</button>
      </div>

      <label class="fbField">
        <span class="fbField__label">反馈内容 <em>*</em></span>
        <textarea
          v-model="form.content"
          class="fbField__area"
          :maxlength="CONTENT_MAX"
          rows="5"
          placeholder="例如：导出 PDF 时第二页是空白，我用的是手机端，点了「图纸交付 → 打印」……"
        />
        <span class="fbField__count">{{ form.content.length }}/{{ CONTENT_MAX }}</span>
      </label>

      <label class="fbField">
        <span class="fbField__label">联系方式（选填）</span>
        <input
          v-model="form.contact"
          class="fbField__input"
          type="text"
          :maxlength="CONTACT_MAX"
          placeholder="邮箱 / QQ / 微信，方便我们回复你"
        >
      </label>

      <p class="fbForm__hint">{{ userHint }}</p>
      <p v-if="error" class="fbForm__error" role="alert">{{ error }}</p>
    </div>

    <template #footer="{ close }">
      <button class="btn" type="button" @click="close">取消</button>
      <button class="btn primary" type="button" :disabled="!canSubmit" @click="submit">
        {{ submitting ? '提交中…' : '提交反馈' }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
/* ---------------------------------------------------------------- 悬浮标签 */

.fb {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 110;
}

.fb__tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-height: 88px;
  padding: 10px 0;
  border: 1px solid #EBD9A8;
  border-right: 0;
  border-radius: 14px 0 0 14px;
  background: linear-gradient(180deg, #FFE977 0%, #FFD62E 100%);
  color: var(--ink);
  box-shadow: -2px 2px 10px rgba(82, 62, 24, .14);
  cursor: pointer;
  /* 收起时只留 16px 在屏幕里，其余滑出视口 */
  transform: translateX(28px);
  transition: transform .24s var(--ease), box-shadow .2s var(--ease);
}

.fb.is-open .fb__tab,
.fb__tab:focus-visible {
  transform: translateX(0);
  box-shadow: -3px 4px 16px rgba(82, 62, 24, .2);
}

.fb__tab:hover {
  background: linear-gradient(180deg, #FFE36B 0%, #FFC400 100%);
}

/* 收起时露出的那条「反馈」竖排小字：让人知道这里可以点 */
.fb__hint {
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #7A5A08;
  transition: opacity .16s var(--ease);
}

.fb.is-open .fb__hint {
  opacity: 0;
}

.fb__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transform: translateX(6px);
  transition: opacity .2s var(--ease) .04s, transform .2s var(--ease) .04s;
}

.fb.is-open .fb__body {
  opacity: 1;
  transform: none;
}

.fb__icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, .55);
}

.fb__label {
  writing-mode: vertical-rl;
  font-size: var(--fs-2xs);
  font-weight: 800;
  letter-spacing: 1px;
}

/* ---------------------------------------------------------------- 弹窗内容 */

.fbForm {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fbForm__lead {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--ink-2);
  line-height: 1.7;
}

.fbForm__types {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.fbChip {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 700;
  cursor: pointer;
  transition: var(--t);
}

.fbChip:hover {
  border-color: #EED9B7;
  background: #FFF1D8;
}

.fbChip.on {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--ink);
  font-weight: 850;
}

.fbField {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fbField__label {
  font-size: var(--fs-xs);
  font-weight: 750;
  color: var(--ink-2);
}

.fbField__label em {
  font-style: normal;
  color: var(--danger);
}

.fbField__area,
.fbField__input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--fs-sm);
  font-family: inherit;
  padding: 10px 12px;
  transition: var(--t);
}

.fbField__area {
  resize: vertical;
  min-height: 108px;
  line-height: 1.7;
}

.fbField__area:focus,
.fbField__input:focus {
  outline: none;
  border-color: var(--pink);
  box-shadow: 0 0 0 3px rgba(255, 142, 199, .18);
}

.fbField__count {
  align-self: flex-end;
  font-size: var(--fs-2xs);
  color: var(--muted-2);
  margin-top: -2px;
}

.fbForm__hint {
  margin: 0;
  font-size: var(--fs-2xs);
  color: var(--muted);
  line-height: 1.6;
}

.fbForm__error {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--fs-xs);
  font-weight: 700;
}

/* ---------------------------------------------------------------- 手机 */

@media (max-width: 780px) {
  .fb {
    /* 手机端避开底部标签栏：贴在右侧中段，收起后只露一条边 */
    top: 46%;
    transform: translateY(-50%);
  }

  .fb__tab {
    width: 40px;
    min-height: 78px;
    transform: translateX(26px);
  }

  .fb.is-open .fb__tab,
  .fb__tab:focus-visible {
    transform: translateX(0);
  }

  .fbForm__lead {
    font-size: var(--fs-xs);
  }
}

/* 打印时不要这个标签 */
@media print {
  .fb {
    display: none !important;
  }
}
</style>
