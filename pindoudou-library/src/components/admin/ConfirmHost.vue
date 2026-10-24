<script setup>
/* 二次确认弹窗宿主：挂在后台布局里，配合 useAdminConfirm 使用 */
import { computed, ref, watch } from 'vue'
import AdminModal from './AdminModal.vue'
import { confirmState, resolveConfirm, cancelConfirm } from '../../composables/useAdminConfirm.js'

const reason = ref('')

watch(() => confirmState.open, open => {
  if (open) reason.value = ''
})

const canSubmit = computed(() => {
  if (confirmState.ackText && !confirmState.ack) return false
  if (confirmState.reasonRequired && reason.value.trim().length < 2) return false
  return true
})

function submit() {
  if (!canSubmit.value) return
  resolveConfirm({ reason: reason.value.trim() })
}
</script>

<template>
  <AdminModal
    :model-value="confirmState.open"
    :title="confirmState.title"
    size="sm"
    :mask-closable="false"
    @update:model-value="v => { if (!v) cancelConfirm() }"
  >
    <div class="adm-stack">
      <p v-if="confirmState.message" style="line-height:1.8">{{ confirmState.message }}</p>
      <div v-if="confirmState.detail" class="adm-note" :class="confirmState.danger ? 'adm-note--danger' : 'adm-note--warn'">
        {{ confirmState.detail }}
      </div>

      <label v-if="confirmState.ackText" class="adm-check">
        <input v-model="confirmState.ack" type="checkbox">
        <span>{{ confirmState.ackText }}</span>
      </label>

      <div v-if="confirmState.reasonRequired" class="adm-field">
        <label>{{ confirmState.reasonLabel }} <em>*</em></label>
        <textarea
          v-model="reason"
          class="adm-textarea"
          :placeholder="confirmState.reasonPlaceholder"
          maxlength="255"
        />
        <span class="adm-hint">
          {{ confirmState.reasonHint || '至少 2 个字；会随操作一起写入操作日志，便于事后追溯。' }}
        </span>
      </div>
    </div>

    <template #footer>
      <button class="adm-btn" type="button" @click="cancelConfirm">{{ confirmState.cancelText }}</button>
      <button
        class="adm-btn"
        :class="confirmState.danger ? 'adm-btn--danger' : 'adm-btn--primary'"
        type="button"
        :disabled="!canSubmit"
        @click="submit"
      >{{ confirmState.confirmText }}</button>
    </template>
  </AdminModal>
</template>
