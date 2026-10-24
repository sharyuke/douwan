<script setup>
import { toasts } from '../../composables/useToast.js'
import PixelIcon from './PixelIcon.vue'
</script>

<template>
  <div class="toasts no-print" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">
        <span aria-hidden="true">
          <PixelIcon :name="t.kind === 'ok' ? 'check' : t.kind === 'warn' ? 'alert' : t.kind === 'err' ? 'close' : 'info'" :size="12" />
        </span>
        <span>{{ t.text }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,.toast-leave-active{transition:all .22s cubic-bezier(.22,.61,.36,1)}
.toast-enter-from,.toast-leave-to{opacity:0;transform:translateY(10px) scale(.97)}
</style>
