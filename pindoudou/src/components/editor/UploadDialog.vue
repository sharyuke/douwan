<script setup>
/* 上传图片弹窗（Figma 124:2316）：拖拽区 + 选择图片 + 导入确认。
   真正的读图仍走 useStudio 的 useImageFile —— 与顶栏上传、拖图进窗口是同一条链路。 */
import { ref, watch } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import Icon from '../ui/Icon.vue'
import { useImageFile } from '../../composables/useStudio.js'
import { toastWarn } from '../../composables/useToast.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const MAX_MB = 12
const fileInput = ref(null)
const file = ref(null)
const dragOver = ref(false)
const busy = ref(false)
let dragDepth = 0

watch(() => props.modelValue, v => {
  if (v) return
  file.value = null
  dragOver.value = false
  dragDepth = 0
  if (fileInput.value) fileInput.value.value = ''
})

function accept(f) {
  if (!f) return
  if (!/^image\//.test(f.type || '')) {
    toastWarn('请选择图片文件（JPG / PNG / WebP / GIF）')
    return
  }
  if (f.size > MAX_MB * 1024 * 1024) {
    toastWarn(`图片超过 ${MAX_MB}MB，请换一张小一点的`)
    return
  }
  file.value = f
}

function onPick(e) {
  accept(e.target.files?.[0])
  e.target.value = ''
}

function onEnter(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  dragDepth += 1
  dragOver.value = true
}

function onLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragOver.value = false
}

function onDrop(e) {
  dragDepth = 0
  dragOver.value = false
  accept(e.dataTransfer?.files?.[0])
}

async function submit() {
  if (!file.value || busy.value) return
  busy.value = true
  try {
    const ok = await useImageFile(file.value)
    if (ok) emit('update:modelValue', false)
  } catch (err) {
    toastWarn(err.message || '图片读取失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue" title="上传图片" head-icon="fn-upload"
    dialog-class="cmdDlg cmdDlg--sm" @update:model-value="v => emit('update:modelValue', v)"
  >
    <div
      class="upDrop" :class="{ 'is-over': dragOver, 'has-file': !!file }"
      @dragenter.prevent="onEnter" @dragover.prevent @dragleave.prevent="onLeave" @drop.prevent="onDrop"
    >
      <span class="upDrop__ico"><Icon :name="file ? 'photo' : 'fn-upload'" :size="24" /></span>
      <p class="upDrop__line">{{ file ? file.name : '将图片拖到此处，或' }}</p>
      <button type="button" class="btn primary upDrop__pick" @click="fileInput?.click()">
        <Icon name="folder-open" :size="16" />{{ file ? '重新选择' : '选择图片' }}
      </button>
      <p class="upDrop__hint">JPG / PNG / WebP / GIF · 最大 {{ MAX_MB }}MB</p>
      <input ref="fileInput" type="file" accept="image/*" class="upDrop__file" @change="onPick">
    </div>

    <template #footer="{ close }">
      <span class="cmdFoot__note"><span>{{ file ? file.name : '未选择图片' }}</span></span>
      <div class="cmdFoot__actions">
        <button type="button" class="btn btn-secondary" @click="close">取消</button>
        <button type="button" class="btn primary" :disabled="!file || busy" @click="submit">
          {{ busy ? '导入中…' : '导入图片' }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.upDrop{
  min-height:330px;border:1.5px dashed var(--line-strong);border-radius:14px;
  background:#FBFDF6;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;padding:28px 20px;text-align:center;transition:var(--t);
}
.upDrop.is-over{border-color:var(--primary-deep);background:#F4FADF}
.upDrop.has-file{border-style:solid;border-color:var(--primary-deep);background:#FBFDF6}
.upDrop__ico{
  width:48px;height:48px;border-radius:12px;display:grid;place-items:center;
  background:var(--pink-soft);
}
.upDrop__line{font-size:var(--fs-sm);font-weight:700;color:var(--ink);margin:2px 0 0;word-break:break-all;line-height:var(--ty-body-lh)}
.upDrop__pick{min-height:38px;padding:0 18px;border-radius:12px;gap:7px}
.upDrop__hint{font-size:var(--fs-xs);color:var(--muted);margin:2px 0 0;line-height:var(--ty-label-lh)}
.upDrop__file{display:none}
</style>
