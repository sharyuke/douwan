<script setup>
/* =========================================================================
   新手指引（桌面 / 平板 / 手机三套）
   依据交付包 `Z:\拼豆\新手指引` 的视觉切片：
   · 桌面 / 平板：3 步气泡（功能面板 / 编辑工具 / 画布区域）+ 指引重点摘要
   · 手机：1/5 ~ 5/5 五步，底部「跳过引导 / 下一步」
   用户要求不要一次全部显示完，所以三端都按步骤逐条出现；
   气泡文案、编号圆点、黄色描边、跳过按钮按切片还原。
   ========================================================================= */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /* desktop ≥1320 / tablet 781~1319 / mobile ≤780，由 EditorView 判定 */
  mode: { type: String, default: 'desktop' }
})
const emit = defineEmits(['update:modelValue', 'done'])

const isMobile = computed(() => props.mode === 'mobile')
const isTablet = computed(() => props.mode === 'tablet')

/* ---------------------------------------------------------------- 步骤文案
   桌面 / 平板的正文来自切片，一字未改；只有两处「点击箭头展开更多工具」
   在现版本工作台里没有这个箭头（工具本来就全部排在一行），改成了实际动作，
   否则指引会让人去找一个不存在的按钮。 */
const BOARD_STEPS = [
  {
    key: 'panel', no: 1, title: '功能面板',
    body: '在这里可以上传图片、选择素材，以及调整画布、方案、色板、分析、用量、交付、库存等功能。',
    extra: [
      ['① 创建', '上传图片 / 素材库'],
      ['②~⑤', '画布与成品尺寸 / 生成方案 / 色板选择 / 图纸交付'],
      ['右栏', '作品分析 / 颜色用量 / 我的库存']
    ],
    target: () => document.querySelector('.card--create'),
    place: 'right', pad: 8
  },
  {
    key: 'tools', no: 2, title: '编辑工具',
    body: '点击下方的编辑工具进行图纸编辑：移动、画笔、橡皮、填充、取色等。',
    extra: [
      ['工具', '移动 / 画笔 / 橡皮 / 填充 / 取色'],
      ['操作', '撤销 / 重做 / 左右镜像'],
      ['笔刷', '画笔和橡皮都能调笔刷大小，一笔刷过几格算一步']
    ],
    target: () => document.querySelector('.canvasCard__foot'),
    place: 'top', pad: 8
  },
  {
    key: 'canvas', no: 3, title: '画布区域',
    body: '这里是你的创作画布，上传图片或选择素材后，会在这里生成拼豆图纸。你可以使用下方的编辑工具进行调整。',
    extra: [
      ['视图', '图纸 / 原图 / 对照 / 分板 / 材料'],
      ['缩放', '适应 / 实际大小（1:1 实物预览）'],
      ['手势', '滚轮缩放 · 按住空白处拖拽平移']
    ],
    target: () => document.querySelector('.stage'),
    place: 'inside-right', pad: 8
  }
]

const MOBILE_STEPS = [
  {
    key: 'create', no: 1, title: '上传图片 / 开始创作',
    body: '支持上传图片，也可以使用 AI 生成素材，快速开始创作！',
    /* 手机端左栏不参与排版：空画布时上传入口在画布空状态里，出图后是快捷区的「换图」 */
    target: () => document.querySelector('.emptyActions') || quickItem('换图') || document.querySelector('.quickRow'),
    place: 'above', pad: 8
  },
  {
    key: 'size', no: 2, title: '画布与成品尺寸',
    body: '选择画布格数，并调整成品尺寸。支持设置等比例缩放。',
    /* 尺寸卡在手机上是快捷区的「画布」抽屉，指引把抽屉真的打开给用户看 */
    target: () => document.querySelector('.modal.show .card--size') || document.querySelector('.quickRow'),
    place: 'above', pad: 8,
    prepare: openSizeSheet, cleanup: closeSheet
  },
  {
    key: 'cmd', no: 3, title: '快捷区与工具行',
    body: '画布上方是常用功能，画布下方是编辑工具，常用操作都只差一次点击。',
    extra: [
      ['快捷区', '画布 / 色板 / 换图 / 导出 / 更多'],
      ['工具行', '镜像 / 画笔 / 橡皮 / 填充 / 取色 / 更多']
    ],
    /* 4.0 把「功能」和「编辑」拆到了画布上下两处：两块都要框出来 */
    targets: () => [document.querySelector('.quickRow'), document.querySelector('.mobileToolbar')],
    place: 'below', pad: 6
  },
  {
    key: 'zoom', no: 4, title: '画布缩放与操作',
    body: '画布右侧可以撤销 / 重做，也能放大缩小、一键居中显示。',
    extra: [
      ['移动画布模式', '单指拖动（或双指）只平移视野，不会修改任何格子']
    ],
    target: () => document.querySelector('.stageTools') || document.querySelector('.stage'),
    place: 'left', pad: 8
  },
  {
    key: 'save', no: 5, title: '导出 / 作品保存',
    body: '完成后可以生成拼豆图纸，并保存到作品中。',
    /* 导出在快捷区第一排，保存作品在「更多功能」抽屉里，展开后直接看到 */
    target: () => document.querySelector('.modal.show .dialog') || document.querySelector('.quickRow'),
    place: 'below', pad: 6,
    prepare: openMoreSheet, cleanup: closeSheet
  }
]

/* 切片里桌面 / 平板的「指引重点」三块摘要卡 */
const DESKTOP_SUMMARY = {
  title: '桌面端指引重点',
  sub: '三栏工作区 · 上传、生成、编辑、交付都在同一屏',
  items: [
    { no: 1, icon: 'grid', title: '功能面板', text: '上传图片、素材库、画布大小、生成方案、色板选择、作品分析、用量统计、图纸交付、我的库存等。' },
    { no: 2, icon: 'brush', title: '编辑工具', text: '移动、画笔、橡皮、填充、取色、撤销、重做、镜像等，全部排在这一行。' },
    { no: 3, icon: 'layout', title: '画布区域', text: '显示和编辑拼豆图纸，支持缩放、适应画布大小，实时预览修改效果。' }
  ]
}
const TABLET_SUMMARY = {
  title: '平板端指引重点',
  sub: '触屏操作 · 大按钮，点选更轻松',
  items: [
    { no: 1, icon: 'grid', title: '功能面板', text: '左侧就是功能面板，包含画布、方案、色板、分析、用量、交付、库存等核心功能。' },
    { no: 2, icon: 'brush', title: '编辑工具', text: '移动、画笔、橡皮、填充、取色等，大按钮设计，适合触屏操作。' },
    { no: 3, icon: 'layout', title: '画布区域', text: '支持手势缩放和拖动画布，轻松调整和编辑图纸。' }
  ]
}

const steps = computed(() => (isMobile.value ? MOBILE_STEPS : BOARD_STEPS))
const summary = computed(() => (isTablet.value ? TABLET_SUMMARY : DESKTOP_SUMMARY))

const index = ref(0)
const phase = ref('steps') // steps | summary
/* 一步可以同时高亮多个控件（第 3 步：上方快捷区 + 下方工具行） */
const holes = ref([])
const primaryHole = computed(() => holes.value[0] || null)
/* 底部抽屉会把「下一步」挡住时，把固定条抬到抽屉上方 */
const barStyle = ref({})
const tipSize = ref({ w: 340, h: 190 })
const tipStyle = ref({ left: '50%', top: '50%', transform: 'translate(-50%,-50%)' })
const arrow = ref(null)
const placement = ref('right')
const tipEl = ref(null)
const activeStep = computed(() => steps.value[index.value] || steps.value[0])

/* ---------------------------------------------------------------- 定位
   高亮洞跟着目标元素的视口矩形走；气泡按 place 贴边，放不下就换一侧，
   最后夹在视口里（平板 / 手机不会被挤出屏幕）。 */
function resolveTarget(step) {
  if (!step) return null
  const el = typeof step.target === 'function' ? step.target() : document.querySelector(step.target)
  if (el && el.getClientRects().length) return el
  return null
}

/* 单目标用 target，多目标用 targets；没有可见目标就退回空数组 */
function resolveTargets(step) {
  if (!step) return []
  const list = typeof step.targets === 'function' ? step.targets() : [resolveTarget(step)]
  return list.filter(el => el && el.getClientRects().length)
}

function measureTip() {
  const el = tipEl.value
  if (!el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  if (w > 0 && h > 0) tipSize.value = { w, h }
}

function edgePoint(rect, tx, ty) {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const sx = dx ? (rect.width / 2) / Math.abs(dx) : Infinity
  const sy = dy ? (rect.height / 2) / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

function makeArrow(tip, h) {
  if (placement.value === 'inside-right') return null
  const tcx = tip.left + tip.width / 2
  const tcy = tip.top + tip.height / 2
  const hcx = h.left + h.width / 2
  const hcy = h.top + h.height / 2
  const start = edgePoint(tip, hcx, hcy)
  const end = edgePoint(h, tcx, tcy)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (len < 20) return null
  const off = Math.min(24, len * 0.16)
  const mx = (start.x + end.x) / 2 - (dy / len) * off
  const my = (start.y + end.y) / 2 + (dx / len) * off
  return { d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}` }
}

function positionTip() {
  const h = primaryHole.value
  if (!h || phase.value !== 'steps') {
    tipStyle.value = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }
    arrow.value = null
    return
  }
  const t = tipSize.value
  const vw = window.innerWidth
  const vh = window.innerHeight
  /* 留出 26px 让虚线箭头看得见；贴太紧时箭头只剩一个点 */
  const gap = 26
  const m = 12
  /* 步骤里写 above / below，定位只认 top / bottom */
  const ALIAS = { above: 'top', below: 'bottom' }
  const want = ALIAS[activeStep.value?.place] || activeStep.value?.place || 'right'
  const fits = p => {
    if (p === 'right') return vw - (h.left + h.width) >= t.w + gap + m
    if (p === 'left') return h.left >= t.w + gap + m
    if (p === 'top') return h.top >= t.h + gap + m
    if (p === 'bottom') return vh - (h.top + h.height) >= t.h + gap + m
    return true
  }
  let p = want
  if (want !== 'inside-right' && !fits(want)) {
    p = ['right', 'left', 'bottom', 'top'].find(fits) || want
  }
  placement.value = p
  let left = 0
  let top = 0
  if (p === 'right') { left = h.left + h.width + gap; top = h.top + h.height / 2 - t.h / 2 }
  else if (p === 'left') { left = h.left - t.w - gap; top = h.top + h.height / 2 - t.h / 2 }
  else if (p === 'top') { left = h.left + h.width / 2 - t.w / 2; top = h.top - t.h - gap }
  else if (p === 'bottom') { left = h.left + h.width / 2 - t.w / 2; top = h.top + h.height + gap }
  else { left = h.left + h.width - t.w - 20; top = h.top + 18 }

  left = Math.max(m, Math.min(vw - t.w - m, left))
  top = Math.max(m, Math.min(vh - t.h - m, top))
  /* 手机底部有一条「跳过引导 / 下一步」，气泡不能压住它。
     第 5 步这条固定条会抬到底部抽屉上方，所以按它的真实位置夹。 */
  if (isMobile.value) {
    const bar = document.querySelector('[data-guide-bar]')
    const barTop = bar ? bar.getBoundingClientRect().top : vh - 76
    top = Math.max(m, Math.min(barTop - t.h - 12, top))
  }
  tipStyle.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, transform: 'none' }
  arrow.value = makeArrow({ left, top, width: t.w, height: t.h }, h)
}

function sameHoles(a, b) {
  if (a.length !== b.length) return false
  return a.every((r, i) => {
    const o = b[i]
    return Math.abs(r.left - o.left) <= 0.5 && Math.abs(r.top - o.top) <= 0.5 &&
      Math.abs(r.width - o.width) <= 0.5 && Math.abs(r.height - o.height) <= 0.5
  })
}

/* 底部抽屉比较矮、固定条会压住抽屉内容时，把固定条抬到抽屉上方；
   整屏高的抽屉（画布尺寸）不抬，否则会顶到气泡。 */
function updateBar() {
  let bottom = ''
  if (isMobile.value && phase.value === 'steps') {
    const dialog = document.querySelector('.modal.show .dialog')
    if (dialog) {
      const r = dialog.getBoundingClientRect()
      if (r.top > window.innerHeight * 0.5 && r.top < window.innerHeight) {
        bottom = `calc(${Math.round(window.innerHeight - r.top + 8)}px + env(safe-area-inset-bottom))`
      }
    }
  }
  if (barStyle.value.bottom !== bottom) barStyle.value = bottom ? { bottom } : {}
}

function updateHole() {
  if (phase.value !== 'steps') {
    if (holes.value.length) holes.value = []
    updateBar()
    return
  }
  const step = activeStep.value
  const pad = step?.pad ?? 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const next = []
  for (const el of resolveTargets(step)) {
    const r = el.getBoundingClientRect()
    const left = Math.max(6, r.left - pad)
    const top = Math.max(6, r.top - pad)
    const width = Math.min(vw - 12, r.right + pad) - left
    const height = Math.min(vh - 12, r.bottom + pad) - top
    if (width > 0 && height > 0) next.push({ left, top, width, height })
  }
  if (!sameHoles(next, holes.value)) holes.value = next
  updateBar()
  positionTip()
}

/* ---------------------------------------------------------------- 手机端抽屉
   第 2 步要真的把快捷区的「画布」抽屉打开，第 5 步打开「更多功能」抽屉；
   离开这一步时收回去，不让指引把界面留在半开状态。 */
function quickItem(label) {
  return [...document.querySelectorAll('.quickItem')].find(b => new RegExp(label).test(b.textContent || ''))
}
function closeSheet() {
  const modal = document.querySelector('.modal.show')
  if (!modal) return
  const btn = modal.querySelector('.dialog__head .iconbtn')
  if (btn) btn.click()
}
/* 收起上一张抽屉要等退场动画走完：抽屉还在 DOM 里时点快捷区会被当成
   「已经有抽屉打开」，新抽屉永远不出现（快速连点下一步时最容易踩到）。 */
async function openSizeSheet() {
  closeSheet()
  await new Promise(r => setTimeout(r, 260))
  if (!document.querySelector('.modal.show')) {
    quickItem('画布')?.click()
    await new Promise(r => setTimeout(r, 420))
  }
}
async function openMoreSheet() {
  closeSheet()
  await new Promise(r => setTimeout(r, 260))
  if (!document.querySelector('.modal.show')) {
    quickItem('更多')?.click()
    await new Promise(r => setTimeout(r, 380))
  }
}

/* ---------------------------------------------------------------- 滚动与步进 */
function focusTarget() {
  const el = resolveTargets(activeStep.value)[0]
  if (!el) return
  const r = el.getBoundingClientRect()
  /* 比视口还高的目标（整块画布 / 长卡片）只把顶部带进来，居中会滚过头 */
  const block = r.height > window.innerHeight * 0.72 ? 'start' : 'center'
  try { el.scrollIntoView({ block, inline: 'nearest', behavior: 'smooth' }) } catch { el.scrollIntoView() }
}

let cleanupFn = null
let stepToken = 0
/* 进入一步：先收上一步打开的面板，再准备这一步要展示的面板，最后定位 */
async function applyStep() {
  const token = ++stepToken
  if (cleanupFn) { try { cleanupFn() } catch { /* 忽略 */ } cleanupFn = null }
  const step = activeStep.value
  if (step?.prepare) {
    try { await step.prepare() } catch { /* 面板打不开就退回只讲不指 */ }
    if (token !== stepToken) return
  }
  cleanupFn = step?.cleanup || null
  await nextTick()
  measureTip()
  positionTip()
  focusTarget()
}
function runCleanup() {
  if (!cleanupFn) return
  try { cleanupFn() } catch { /* 忽略 */ }
  cleanupFn = null
}

function next() {
  if (index.value < steps.value.length - 1) {
    index.value += 1
    applyStep()
    return
  }
  if (isMobile.value) { finish(); return }
  phase.value = 'summary'
  arrow.value = null
  holes.value = []
  barStyle.value = {}
}

function prev() {
  if (index.value === 0) return
  index.value -= 1
  applyStep()
}

function markDone() {
  try { localStorage.setItem('douwan.guide.v1', '1') } catch { /* 无痕模式：下次还会出现 */ }
  emit('done')
}

function close() {
  markDone()
  runCleanup()
  emit('update:modelValue', false)
}

function finish() {
  markDone()
  runCleanup()
  emit('update:modelValue', false)
}

/* ---------------------------------------------------------------- 生命周期 */
let raf = 0
function tick() {
  if (!props.modelValue) return
  updateHole()
  raf = requestAnimationFrame(tick)
}
function startLoop() {
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(tick)
}
function stopLoop() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

let ro = null
watch(tipEl, el => {
  if (ro) { ro.disconnect(); ro = null }
  if (el && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { measureTip(); positionTip() })
    ro.observe(el)
  }
})

watch(() => props.modelValue, open => {
  if (open) {
    index.value = 0
    phase.value = 'steps'
    holes.value = []
    barStyle.value = {}
    nextTick(() => { measureTip(); positionTip() })
    applyStep()
    startLoop()
  } else {
    runCleanup()
    stopLoop()
  }
})

watch([index, phase], () => {
  if (!props.modelValue) return
  measureTip()
  positionTip()
})

/* 换端（窗口跨过断点）时把步骤收回第一屏，避免停在不存在的第 4 步 */
watch(() => props.mode, () => {
  index.value = Math.min(index.value, steps.value.length - 1)
  phase.value = 'steps'
  applyStep()
})

function onKey(e) {
  if (!props.modelValue) return
  if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
}
function onResize() {
  if (props.modelValue) { measureTip(); positionTip() }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  if (props.modelValue) { applyStep(); startLoop() }
})
onBeforeUnmount(() => {
  stopLoop()
  runCleanup()
  if (ro) ro.disconnect()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue" class="guide" role="dialog" aria-modal="true"
      :aria-label="`${isTablet ? '平板端' : isMobile ? '手机端' : '桌面端'}新手指引`"
      :data-guide="mode" :data-guide-phase="phase"
    >
      <!-- 遮罩：用 SVG mask 在整层压暗上挖出高亮洞（一步可以挖多个），
           洞内保持原亮度；黄色虚线框单独画在洞上 -->
      <svg v-if="phase === 'steps' && holes.length" class="guide__mask" aria-hidden="true">
        <defs>
          <mask id="guideHoleMask">
            <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
            <rect
              v-for="(h, i) in holes" :key="i"
              :x="h.left" :y="h.top" :width="h.width" :height="h.height" rx="16" fill="#000"
            />
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(31,41,55,.55)" mask="url(#guideHoleMask)" />
      </svg>
      <div v-else class="guide__dim" aria-hidden="true"></div>
      <div
        v-for="(h, i) in holes" :key="i" class="guide__hole"
        :style="{ left: h.left + 'px', top: h.top + 'px', width: h.width + 'px', height: h.height + 'px' }"
        aria-hidden="true"
      ></div>

      <!-- 黄色虚线箭头：从气泡指向高亮区域 -->
      <svg v-if="phase === 'steps' && arrow" class="guide__arrows" aria-hidden="true">
        <defs>
          <marker id="guideArrowHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="#FFD62E" />
          </marker>
        </defs>
        <path :d="arrow.d" fill="none" stroke="#FFD62E" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#guideArrowHead)" />
      </svg>

      <!-- 桌面 / 平板：右上角跳过 -->
      <button v-if="!isMobile" type="button" class="guide__skip" data-guide-skip @click="close">
        {{ isTablet ? '关闭指引' : '跳过指引' }} <span aria-hidden="true">×</span>
      </button>

      <!-- 步骤气泡 -->
      <div
        v-if="phase === 'steps' && activeStep"
        ref="tipEl" class="guide__tip" :class="`guide__tip--${placement}`"
        :style="tipStyle" data-guide-tip :data-guide-step="activeStep.no"
      >
        <div class="guide__tipHead">
          <span class="guide__no" :class="{ 'guide__no--frac': isMobile }">
            {{ isMobile ? `${activeStep.no}/${steps.length}` : activeStep.no }}
          </span>
          <b class="guide__title">{{ activeStep.title }}</b>
        </div>
        <p class="guide__body">{{ activeStep.body }}</p>
        <dl v-if="activeStep.extra" class="guide__extra">
          <div v-for="row in activeStep.extra" :key="row[0]">
            <dt>{{ row[0] }}</dt><dd>{{ row[1] }}</dd>
          </div>
        </dl>

        <!-- 桌面 / 平板：气泡内步进 -->
        <div v-if="!isMobile" class="guide__tipFoot">
          <span class="guide__dots" aria-hidden="true"><i v-for="(s, i) in steps" :key="s.key" :class="{ on: i === index }"></i></span>
          <button v-if="index > 0" type="button" class="guide__back" data-guide-back @click="prev">上一步</button>
          <button type="button" class="guide__next" data-guide-next @click="next">
            {{ index === steps.length - 1 ? '看指引重点' : '下一步' }}
          </button>
        </div>
      </div>

      <!-- 手机：底部「跳过引导 / 圆点 / 下一步」 -->
      <div v-if="isMobile && phase === 'steps'" class="guide__bar" data-guide-bar :style="barStyle">
        <button type="button" class="guide__skipText" data-guide-skip @click="close">跳过引导</button>
        <span class="guide__dots" aria-hidden="true"><i v-for="(s, i) in steps" :key="s.key" :class="{ on: i === index }"></i></span>
        <button type="button" class="guide__next" data-guide-next @click="next">
          {{ index === steps.length - 1 ? '完成' : '下一步 →' }}
        </button>
      </div>

      <!-- 桌面 / 平板：指引重点摘要 -->
      <section v-if="phase === 'summary'" class="guide__summary" data-guide-summary>
        <header class="guide__summaryHead">
          <span class="guide__summaryIcon"><PixelIcon :name="isTablet ? 'layout' : 'grid'" :size="18" /></span>
          <div class="guide__summaryTitle">
            <b>{{ summary.title }}</b>
            <span>{{ summary.sub }}</span>
          </div>
        </header>
        <div class="guide__summaryGrid">
          <article v-for="item in summary.items" :key="item.no">
            <span class="guide__no">{{ item.no }}</span>
            <div>
              <b><PixelIcon :name="item.icon" :size="14" />{{ item.title }}</b>
              <p>{{ item.text }}</p>
            </div>
          </article>
        </div>
        <footer class="guide__summaryFoot">
          <span class="guide__summaryNote">指引随时可以从「新手教程」里重看</span>
          <button type="button" class="guide__next" data-guide-finish @click="finish">开始创作</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* ---------------------------------------------------------------- 遮罩 */
.guide{position:fixed;inset:0;z-index:400;pointer-events:none;font-family:inherit}
.guide__dim{position:fixed;inset:0;background:rgba(31,41,55,.55);animation:guideFade .18s var(--ease)}
/* 压暗层用 SVG mask 挖洞：一步可以同时挖出快捷区和工具行两块 */
.guide__mask{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
/* 高亮洞：border 是切片里的黄色虚线框，压暗由上面的 mask 负责 */
.guide__hole{
  position:fixed;border:2px dashed var(--primary);border-radius:16px;
  pointer-events:none;
}
@keyframes guideFade{from{opacity:0}to{opacity:1}}

.guide__arrows{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}

/* ---------------------------------------------------------------- 跳过 */
.guide__skip{
  position:fixed;top:14px;right:16px;z-index:2;pointer-events:auto;
  display:inline-flex;align-items:center;gap:7px;padding:9px 15px;
  border:1.5px solid var(--line);border-radius:999px;background:var(--surface);
  box-shadow:var(--sh-1);font-size:13px;font-weight:850;color:var(--ink);
  white-space:nowrap;transition:var(--t);
}
.guide__skip:hover{background:var(--surface-2);border-color:var(--line-strong)}
.guide__skip span{font-size:15px;line-height:1;color:var(--muted)}

/* ---------------------------------------------------------------- 气泡 */
.guide__tip{
  position:fixed;z-index:3;width:min(340px,calc(100vw - 24px));
  padding:15px 16px 13px;border:2px solid var(--primary);border-radius:16px;
  background:var(--surface);box-shadow:0 16px 38px rgba(31,41,55,.24);
  pointer-events:auto;animation:guidePop .18s var(--ease);
}
@keyframes guidePop{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.guide__tipHead{display:flex;align-items:center;gap:9px}
.guide__no{
  width:28px;height:28px;flex:0 0 auto;border-radius:50%;
  display:grid;place-items:center;background:var(--primary);color:var(--primary-ink);
  font-size:14px;font-weight:900;line-height:1;
}
.guide__no--frac{width:auto;min-width:46px;height:26px;padding:0 9px;border-radius:999px;font-size:12px;letter-spacing:.02em}
.guide__title{font-size:15px;font-weight:900;color:var(--ink);letter-spacing:.01em;line-height:1.35}
.guide__body{margin:9px 0 0;font-size:13px;line-height:1.75;color:var(--ink-2)}
.guide__extra{margin:10px 0 0;display:flex;flex-direction:column;gap:5px}
.guide__extra div{display:flex;gap:8px;font-size:12px;line-height:1.55}
.guide__extra dt{flex:0 0 auto;min-width:38px;font-weight:850;color:var(--yellow-deep)}
.guide__extra dd{margin:0;color:var(--ink-2)}

.guide__tipFoot{
  display:flex;align-items:center;gap:8px;margin-top:13px;padding-top:11px;
  border-top:1px solid var(--line);
}
.guide__dots{display:flex;align-items:center;gap:5px}
.guide__dots i{width:6px;height:6px;border-radius:50%;background:var(--line-strong);transition:var(--t)}
.guide__dots i.on{width:16px;border-radius:3px;background:var(--primary)}
.guide__back{
  margin-left:auto;padding:8px 10px;border:0;background:transparent;
  font-size:12px;font-weight:800;color:var(--muted);
}
.guide__back:hover{color:var(--ink)}
.guide__next{
  padding:8px 16px;border:0;border-radius:999px;
  background:var(--primary);color:var(--primary-ink);
  font-size:13px;font-weight:900;line-height:1.2;white-space:nowrap;
  box-shadow:0 2px 0 var(--primary-deep);transition:var(--t);
}
.guide__next:hover{filter:brightness(1.03)}
.guide__next:active{transform:translateY(1px);box-shadow:0 1px 0 var(--primary-deep)}

/* ---------------------------------------------------------------- 手机底栏 */
.guide__bar{
  position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));
  z-index:3;pointer-events:auto;display:flex;align-items:center;gap:10px;
  padding:9px 12px;border:1.5px solid var(--line);border-radius:999px;
  background:var(--surface);box-shadow:0 12px 30px rgba(31,41,55,.2);
}
.guide__bar .guide__dots{flex:1;justify-content:center}
.guide__skipText{
  padding:6px 4px;border:0;background:transparent;
  font-size:13px;font-weight:800;color:var(--muted);white-space:nowrap;
}

/* ---------------------------------------------------------------- 摘要 */
.guide__summary{
  position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:3;
  width:min(780px,calc(100vw - 28px));max-height:calc(100vh - 40px);overflow:auto;
  padding:20px;border:2px solid var(--primary);border-radius:20px;
  background:var(--surface);box-shadow:0 26px 64px rgba(31,41,55,.3);
  pointer-events:auto;animation:guidePop .2s var(--ease);
}
.guide__summaryHead{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
.guide__summaryIcon{
  width:38px;height:38px;flex:0 0 auto;border-radius:12px;display:grid;place-items:center;
  background:var(--primary-soft);color:var(--primary-ink);
}
.guide__summaryTitle{display:flex;flex-direction:column;gap:3px;min-width:0}
.guide__summaryTitle b{font-size:18px;font-weight:900;color:var(--ink);line-height:1.3}
.guide__summaryTitle span{font-size:12px;color:var(--muted)}
.guide__summaryGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}
.guide__summaryGrid article{
  display:flex;gap:10px;padding:12px;border:1.5px solid #FFE58A;border-radius:14px;
  background:var(--cream-2);min-width:0;
}
.guide__summaryGrid article > div{min-width:0}
.guide__summaryGrid b{
  display:flex;align-items:center;gap:6px;font-size:13px;font-weight:900;color:var(--ink);
}
.guide__summaryGrid b .icon{color:var(--primary-deep)}
.guide__summaryGrid p{margin:5px 0 0;font-size:12px;line-height:1.7;color:var(--ink-2)}
.guide__summaryFoot{
  display:flex;align-items:center;gap:12px;margin-top:16px;padding-top:13px;
  border-top:1px solid var(--line);
}
.guide__summaryNote{margin-right:auto;font-size:11px;color:var(--muted)}

@media(max-width:900px){
  .guide__summaryGrid{grid-template-columns:1fr}
  .guide__summary{padding:16px}
}
@media(max-width:780px){
  .guide__tip{width:min(330px,calc(100vw - 24px));padding:13px 14px 12px}
  .guide__title{font-size:14px}
  .guide__body{font-size:12.5px;line-height:1.7}
  .guide__extra div{font-size:11.5px}
}
</style>
