<script setup>
/* =========================================================================
   模式切换确认弹层（专业 ⇄ 新手）
   -------------------------------------------------------------------------
   只在一种情况下出现：**专业模式里逐颗改过图纸**，这时切到新手版会被
   「要不要按新手默认参数重画」这件事吓到 —— 所以先说清楚「不会自动重画」，
   再让用户选继续还是取消。

   状态放在 composables/useBeginnerMode.js（switchDialog），
   全站只挂这一个弹层：顶栏切换与向导里的「进入专业模式」共用它。
   ========================================================================= */
import { computed } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import { switchDialog, confirmSwitch, cancelSwitch } from '../../composables/useBeginnerMode.js'

const toPro = computed(() => switchDialog.target === 'pro')
</script>

<template>
  <BaseDialog
    :model-value="switchDialog.open"
    :title="toPro ? '切换到专业模式' : '切换到新手模式'"
    size="sm"
    :layer="500"
    @update:model-value="v => { if (!v) cancelSwitch() }"
  >
    <p class="msd__text">{{ switchDialog.reason }}</p>
    <p class="msd__text msd__text--muted">
      两种模式共用同一件作品：图片、图纸、尺寸、色号、素材来源与作品 ID 都会完整保留。
    </p>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="cancelSwitch">先不切换</button>
      <button type="button" class="btn primary" @click="confirmSwitch">
        <PixelIcon name="check" :size="14" />
        继续切换
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.msd__text{font-size:var(--fs-sm);color:var(--ink-2);line-height:1.7;margin-bottom:10px}
.msd__text--muted{color:var(--muted);font-size:var(--fs-xs);margin-bottom:0}
</style>
