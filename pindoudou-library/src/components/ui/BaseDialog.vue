<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PixelIcon from './PixelIcon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  size: { type: String, default: '' },      // '' | 'sm' | 'lg'
  /* 手机端从底部升起的抽屉：桌面端仍是普通居中弹窗（样式在 global.css 的媒体查询里） */
  sheet: { type: Boolean, default: false },
  closeOnBackdrop: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue', 'close'])

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onKey(e) {
  if (e.key === 'Escape' && props.modelValue) close()
}

function onBackdrop() {
  if (props.closeOnBackdrop) close()
}

/* 手机底部抽屉：按住顶部的把手往下拖超过 72px 就关闭。
   只在把手上监听，内容区自己的滚动不受影响；没有拖动能力时
   关闭按钮 / 点遮罩 / Esc 仍然都在。 */
const dragY = ref(0)
let dragStart = null
function onGrabStart(e) {
  if (!props.sheet) return
  dragStart = e.touches?.[0]?.clientY ?? null
}
function onGrabMove(e) {
  if (dragStart == null) return
  dragY.value = Math.max(0, (e.touches?.[0]?.clientY ?? dragStart) - dragStart)
}
function onGrabEnd() {
  if (dragY.value > 72) close()
  dragY.value = 0
  dragStart = null
}

let prevOverflow = ''
watch(() => props.modelValue, v => {
  if (v) {
    prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = prevOverflow
  }
})

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = prevOverflow
})
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="modal show" :class="{ 'modal--sheet': sheet }" @click.self="onBackdrop">
      <div
        class="dialog" :class="[size ? 'dialog--' + size : '', { 'dialog--sheet': sheet }]"
        role="dialog" aria-modal="true"
        :style="dragY ? { transform: `translateY(${dragY}px)` } : null"
      >
        <div
          v-if="sheet" class="sheetGrab" aria-hidden="true"
          @touchstart.passive="onGrabStart" @touchmove.passive="onGrabMove" @touchend="onGrabEnd"
          @touchcancel="onGrabEnd"
        ><i></i></div>
        <div class="dialog__head">
          <h2>{{ title }}</h2>
          <button class="iconbtn" aria-label="关闭" @click="close"><PixelIcon name="close" :size="14" /></button>
        </div>
        <div class="dialog__body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="dialog__foot">
          <slot name="footer" :close="close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 底部抽屉的拖动把手：只在 sheet 模式出现 */
.sheetGrab{
  display:flex;align-items:center;justify-content:center;
  height:18px;flex:0 0 auto;touch-action:none;cursor:grab;
}
.sheetGrab i{display:block;width:38px;height:4px;border-radius:99px;background:var(--line-strong)}
/* 桌面端是居中弹窗，不需要底部抽屉的拖动把手 */
@media(min-width:781px){.sheetGrab{display:none}}
</style>
