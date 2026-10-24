<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'
import { PURPOSE_OPTIONS } from '../../data/libraryCategories.js'

const props = defineProps({
  modelValue: { type: String, default: 'all' },
  options: { type: Array, default: () => PURPOSE_OPTIONS }
})
const emit = defineEmits(['update:modelValue'])

const root = ref(null)
const button = ref(null)
const menu = ref(null)
const open = ref(false)
const optionEls = ref([])

const current = computed(() => props.options.find(o => o.value === props.modelValue) || props.options[0])
const buttonLabel = computed(() => (props.modelValue === 'all' ? '全部' : current.value?.label || '全部'))

function setOption(el, index) {
  if (el) optionEls.value[index] = el
}

function close(refocus = false) {
  if (!open.value) return
  open.value = false
  if (refocus) button.value?.focus()
}

function openMenu(focus = true) {
  open.value = true
  if (!focus) return
  nextTick(() => {
    const index = Math.max(0, props.options.findIndex(o => o.value === props.modelValue))
    optionEls.value[index]?.focus()
  })
}

function toggle() {
  if (open.value) close()
  else openMenu()
}

function pick(value) {
  emit('update:modelValue', value)
  close(true)
}

function onButtonKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    openMenu()
  } else if (e.key === 'Escape') {
    close()
  }
}

function onMenuKey(e) {
  const list = props.options
  const index = optionEls.value.findIndex(el => el === document.activeElement)
  if (e.key === 'Escape') {
    e.preventDefault()
    close(true)
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const step = e.key === 'ArrowDown' ? 1 : -1
    const next = index < 0 ? 0 : (index + step + list.length) % list.length
    optionEls.value[next]?.focus()
    return
  }
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    optionEls.value[e.key === 'Home' ? 0 : list.length - 1]?.focus()
    return
  }
  if (e.key === 'Tab') close()
}

function onDocPointer(e) {
  if (open.value && root.value && !root.value.contains(e.target)) close()
}
function onDocKey(e) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <div ref="root" class="purpose">
    <button
      ref="button" type="button" class="purpose__btn"
      :class="{ on: open }"
      aria-haspopup="listbox"
      :aria-expanded="open"
      aria-controls="purpose-menu"
      @click="toggle"
      @keydown="onButtonKey"
    >
      <span>{{ buttonLabel }}</span>
      <PixelIcon :name="open ? 'chevronUp' : 'chevronDown'" :size="11" />
    </button>

    <transition name="purposeMenu">
      <div
        v-if="open" id="purpose-menu" ref="menu" class="purpose__menu"
        role="listbox" aria-label="按用途筛选"
        @keydown="onMenuKey"
      >
        <button
          v-for="(o, i) in options" :key="o.value"
          :ref="el => setOption(el, i)"
          type="button" role="option" class="purpose__option"
          :class="{ on: modelValue === o.value }"
          :aria-selected="modelValue === o.value"
          @click="pick(o.value)"
        >
          <span>{{ o.label }}</span>
          <PixelIcon v-if="modelValue === o.value" name="check" :size="13" />
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.purpose{position:relative;display:inline-flex;min-width:0}
.purpose__btn{
  display:inline-flex;align-items:center;justify-content:space-between;gap:10px;
  min-width:106px;height:38px;padding:0 11px;border-radius:10px;
  border:1px solid #EDE4D7;background:#fff;color:#27201B;
  font-size:13px;font-weight:650;white-space:nowrap;transition:var(--t);
}
.purpose__btn:hover{border-color:#E5D6BF}
.purpose__btn.on{border-color:#FFC84B;box-shadow:0 0 0 3px rgba(255,200,75,.14)}
.purpose__menu{
  position:absolute;left:0;top:calc(100% + 8px);z-index:70;
  min-width:190px;max-width:calc(100vw - 40px);padding:6px;
  background:#fff;border:1px solid #EDE4D7;border-radius:14px;
  box-shadow:0 14px 34px rgba(92,64,30,.14);
}
.purpose__option{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  width:100%;height:36px;padding:0 10px;border-radius:9px;
  font-size:13px;color:#4B5563;text-align:left;white-space:nowrap;
}
.purpose__option:hover{background:#F8F5F0;color:#27201B}
.purpose__option.on{background:#FFF3C4;color:#27201B;font-weight:750}
.purposeMenu-enter-active,.purposeMenu-leave-active{transition:opacity .14s var(--ease),transform .14s var(--ease)}
.purposeMenu-enter-from,.purposeMenu-leave-to{opacity:0;transform:translateY(-4px)}
@media(max-width:780px){
  .purpose__btn{min-width:92px;height:36px}
  .purpose__menu{min-width:176px}
}
@media(prefers-reduced-motion:reduce){
  .purposeMenu-enter-active,.purposeMenu-leave-active{transition:none}
}
</style>
