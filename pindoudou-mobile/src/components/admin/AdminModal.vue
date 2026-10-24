<script setup>
/* =========================================================================
   通用弹窗
   - 用 <Teleport> 挂到 body，避免被父级 overflow 裁掉
   - 危险操作（删除、作废、确认收款）都用它做二次确认，并且必填原因
   ========================================================================= */
import { onBeforeUnmount, onMounted, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  size: { type: String, default: '' }, // '' | 'sm' | 'lg'
  /** 点遮罩是否关闭。危险操作建议设为 false，避免误触丢输入 */
  maskClosable: { type: Boolean, default: true },
  /** ESC 是否关闭 */
  escClosable: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue', 'close'])

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onMask() {
  if (props.maskClosable) close()
}

function onKey(e) {
  if (e.key === 'Escape' && props.escClosable && props.modelValue) close()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// 打开时锁滚动，避免背景跟着滚
watch(() => props.modelValue, open => {
  document.body.style.overflow = open ? 'hidden' : ''
})
onBeforeUnmount(() => { document.body.style.overflow = '' })
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="adm-modal" @click.self="onMask">
      <div class="adm-modal__panel" :class="size ? `adm-modal__panel--${size}` : ''">
        <div class="adm-modal__head">
          <h2>{{ title }}</h2>
          <slot name="head-extra" />
          <button class="adm-btn adm-btn--sm adm-btn--ghost" type="button" @click="close">关闭</button>
        </div>
        <div class="adm-modal__body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="adm-modal__foot">
          <slot name="footer" :close="close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
