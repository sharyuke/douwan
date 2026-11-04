<script setup>
/**
 * 全屏工作台右侧「成品尺寸」卡（设计稿 151:587「功能菜单 · 成品尺寸已展开」）。
 *
 * 图纸转换模式把这张卡并进了右侧「图片调整」面板：传 embedded 时只渲染面板本身
 * （没有卡头，始终展开），作为合并面板里的「成品尺寸」一段。
 *
 * 卡头点一下就地展开 / 收起，面板里是一条**等比例**滑杆：
 *   · 拖动时读数跟手（「等比例缩放」那一行），松手 240ms 后落到画布；
 *   · 「当前尺寸」读的是画布上**实际**的成品区域 —— 拖动中两者会短暂不同，落定后一致；
 *   · 落到画布走 `setCanvasSize`（原图部分按原图重新取样、手改按修改层投影），
 *     与左栏「图案清晰度」是同一条链路，不弹层、不遮盖手改。
 * 画布上的成品尺寸标注（标尺里的 W/H 尺寸线 + 厘米胶囊）由标题右侧的开关控制
 * （Figma 主要控件规范 124:2083 的开关：28×16 轨道，开启 #C8E63C + 深色滑块）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  options,
  width, height, canvasCapW, canvasCapH, sourceUrl, sourceAspect, hasPattern,
  bead, setCanvasSize, yieldForBusyPaint
} from '../../composables/useStudio.js'
import { finishCmText } from '../../lib/boardSpec.js'
import { onRangeWheel } from '../../lib/rangeWheel.js'
import Icon from '../ui/Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: true },
  /** 只渲染面板（合并进「图片调整」时用），没有卡头、不收起 */
  embedded: { type: Boolean, default: false }
})
const emit = defineEmits(['update:open'])

/** 画布上的成品尺寸标注开关（读写 useStudio.options.sizeMarks，随设置持久化） */
const marks = computed({
  get: () => options.sizeMarks !== false,
  set: v => { options.sizeMarks = v }
})

/* 与 EditorSidebar 的成品尺寸滑杆同一套口径：最小 8 格、拖动 240ms 后再落地 */
const SIZE_MIN_CELLS = 8
const SIZE_APPLY_DELAY = 240

const ready = computed(() => !!sourceUrl.value || hasPattern.value)

/** 素材宽高比（等比例缩放锁的就是它；矢量素材按 1:1） */
const ratio = computed(() => {
  const a = Number(sourceAspect.value)
  return a > 0 ? a : 1
})

/** 滑杆上限：底板里能放下的最大同比例网格的长边（与左栏那条一致） */
const capLong = computed(() => {
  const cw = canvasCapW.value
  const ch = canvasCapH.value
  const a = ratio.value
  const w = Math.min(cw, ch * a)
  return Math.max(1, Math.round(Math.max(w, w / a)))
})
const sliderMax = computed(() => Math.max(SIZE_MIN_CELLS, capLong.value))

const previewW = ref(width.value)
const previewH = ref(height.value)
const pending = ref(false)
const note = ref('')
let timer = 0
let token = 0
let noteTimer = 0

/* 外部改了网格（换图 / 换底板 / 打开存档）时把滑杆对齐；拖动中不抢 */
watch([width, height], ([w, h]) => {
  if (pending.value) return
  previewW.value = w
  previewH.value = h
})

/** 按长边格数求网格：按素材比例算，两个方向都是整数格，再夹进底板 */
function gridForLong(long) {
  const l = Math.max(SIZE_MIN_CELLS, Math.min(sliderMax.value, Math.round(Number(long) || 0)))
  const a = ratio.value
  let w
  let h
  if (a >= 1) {
    w = l
    h = Math.max(1, Math.round(l / a))
  } else {
    h = l
    w = Math.max(1, Math.round(l * a))
  }
  return { w: Math.min(canvasCapW.value, w), h: Math.min(canvasCapH.value, h) }
}

const previewLong = computed(() => Math.max(previewW.value, previewH.value))
const cmOf = (w, h) => finishCmText(w, h, bead.value.key)
const previewCm = computed(() => cmOf(previewW.value, previewH.value))
const currentCm = computed(() => cmOf(width.value, height.value))
const minCm = computed(() => { const g = gridForLong(SIZE_MIN_CELLS); return cmOf(g.w, g.h) })
const maxCm = computed(() => { const g = gridForLong(sliderMax.value); return cmOf(g.w, g.h) })
const fillPct = computed(() => Math.round(
  ((previewLong.value - SIZE_MIN_CELLS) / Math.max(1, sliderMax.value - SIZE_MIN_CELLS)) * 100
))

/* 副标题那一行兼作状态行：没状态时是设计稿那句说明，有状态时就地替换 ——
   这样提示不会把面板撑高（设计稿面板固定 180），卡片也不会在拖动时上下跳。 */
const noteText = computed(() => {
  if (!ready.value) return '上传图片或素材后可调整尺寸。'
  if (pending.value) return '正在按新尺寸重算…'
  return note.value
})

function flash(text) {
  note.value = text
  if (noteTimer) clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => { note.value = '' }, 3200)
}

function cancelWork() {
  if (timer) {
    clearTimeout(timer)
    timer = 0
  }
  token++
  pending.value = false
}

function applyNow(w, h) {
  if (!ready.value) return
  if (w === width.value && h === height.value) {
    /* 已经落到画布上了：说明行别清空（清了就再没人写回去） */
    pending.value = false
    return
  }
  pending.value = true
  const my = ++token
  void (async () => {
    await yieldForBusyPaint()
    if (my !== token) return
    const r = setCanvasSize(w, h, { silent: true, announce: false })
    pending.value = false
    /* 提示就一行、固定宽度（176），文案要短：细节口径在左栏那张完整卡里 */
    if (r && r.resampled) {
      flash(r.keptEdits ? '已按原图重算 · 手改按原尺寸保留' : `已按原图重算到 ${cmOf(w, h)}`)
    } else if (r && r.scaled) {
      flash(r.grew ? '已放大 · 细节从留底还原' : '已缩小 · 细节按块合并')
    } else if (!r) {
      flash(`画布已调整为 ${cmOf(w, h)}`)
    }
  })()
}

/* 拖动中：只排一次延迟落地，读数已经先更新 */
function queue(w, h) {
  if (!ready.value) return
  if (w === width.value && h === height.value) {
    pending.value = false
    return
  }
  pending.value = true
  const my = ++token
  if (timer) clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = 0
    if (my !== token) return
    applyNow(w, h)
  }, SIZE_APPLY_DELAY)
}

function onInput(e) {
  if (!ready.value) return
  const g = gridForLong(e.target.value)
  previewW.value = g.w
  previewH.value = g.h
  queue(g.w, g.h)
}

function onCommit(e) {
  if (!ready.value) return
  const g = gridForLong(e.target.value)
  previewW.value = g.w
  previewH.value = g.h
  applyNow(g.w, g.h)
}

function toggle() {
  emit('update:open', !props.open)
}

onBeforeUnmount(() => {
  cancelWork()
  if (noteTimer) clearTimeout(noteTimer)
})
</script>

<template>
  <div class="szq" :class="{ 'is-open': open, 'is-embedded': embedded }" data-size-card>
    <button
      v-if="!embedded"
      type="button" class="szq__head" :aria-expanded="open" aria-controls="size-card-panel"
      @click="toggle"
    >
      <span class="szq__ico"><Icon name="scan" :size="16" /></span>
      <span class="szq__name">成品尺寸</span>
      <span class="szq__chev"><Icon name="chevron-down" :size="16" /></span>
    </button>

    <div v-show="embedded || open" id="size-card-panel" class="szq__panel">
      <div class="szq__introTop">
        <b>成品尺寸</b>
        <button
          type="button" class="szq__switch" :class="{ on: marks }" role="switch"
          :aria-checked="marks" aria-label="画布上的成品尺寸标注" data-size-card-switch
          @click="marks = !marks"
        >
          <span class="szq__switchLabel">标注</span>
          <i aria-hidden="true"></i>
        </button>
      </div>
      <p
        class="szq__intro" :class="{ 'is-note': !!noteText }" data-size-card-intro
        :data-size-card-note="noteText || null" aria-live="polite"
      >{{ noteText || '默认锁定宽高比，整体等比例缩放' }}</p>

      <div class="szq__value">
        <span>等比例缩放</span>
        <b data-size-card-value>{{ previewCm }}</b>
      </div>
      <input
        class="szq__range" type="range" data-size-card-range
        :min="SIZE_MIN_CELLS" :max="sliderMax" step="1"
        :value="previewLong" :disabled="!ready"
        :aria-label="`成品尺寸，当前 ${previewCm}`" :aria-valuetext="previewCm"
        :style="{ '--fill': fillPct + '%' }"
        @input="onInput" @change="onCommit" @wheel="onRangeWheel"
      >
      <div class="szq__rangeRow" aria-hidden="true">
        <span>{{ minCm }}</span>
        <span>{{ maxCm }}</span>
      </div>

      <div class="szq__now">
        <span>当前尺寸</span>
        <b data-size-card-current>{{ currentCm }}</b>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 颜色与尺寸按设计稿 151:587 量的：卡面白、面板 #F7F9F5、强调色就是工作台的 --cs-accent
   字号字重按 Figma「豆玩 · 文字与字体规范」1:2：
   卡头 13/700/20（字段标签强调）· 面板标题 14/700/22（内容小标题）·
   说明与刻度 12/400/18（辅助·紧凑标签）· 数值 13/500/20 Inter（库存数量） */
.szq{display:flex;flex-direction:column;gap:4px}
.szq__head{
  display:flex;align-items:center;gap:10px;height:42px;padding:0 8px;
  border-radius:9px;font-size:13px;font-weight:700;line-height:var(--ty-label-lh);letter-spacing:0;
  color:var(--cs-ink);text-align:left;
}
.szq__head:hover{background:var(--cs-fill)}
.szq__name{flex:1;text-align:left}
.szq__ico{
  width:28px;height:28px;flex:0 0 auto;border-radius:8px;display:grid;place-items:center;
  background:#E8F5EE;color:#4D5F54;
}
.szq__chev{
  flex:0 0 auto;width:13px;height:13px;color:#B4BCB6;
  display:inline-flex;transform:rotate(-90deg);transition:transform .16s ease;
}
.szq.is-open .szq__chev{transform:none}

/* 面板高度锁死 180（设计稿 151:587 的 200×180）：
   字号换成规范档位后行高变大，靠收紧各段间距把总高压回 180，
   版面比例与设计稿一致，卡片也不会在拖动时上下跳。 */
.szq__panel{
  display:flex;flex-direction:column;padding:6px 12px 10px;border-radius:12px;
  background:#F7F9F5;color:#2A3C30;
}
.szq__introTop{display:flex;align-items:center;justify-content:space-between;gap:8px}
.szq__introTop b{font-size:14px;font-weight:700;line-height:var(--ty-body-lh);letter-spacing:0}
/* 成品尺寸标注开关（Figma 主要控件规范 124:2083）：28×16 轨道 + 10px 滑块，
   开 = #C8E63C 轨道 + #1A2D22 滑块（滑块贴右），关 = 灰轨道 + 白滑块。
   16 高的开关用「上下补 8px 内边距 + 负外边距」把点击区补到 32 高而版面不变 */
.szq__switch{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  padding:8px 0;margin:-8px 0;border:0;background:transparent;cursor:pointer;
}
.szq__switch:focus-visible{outline:0}
.szq__switch:focus-visible i{box-shadow:0 0 0 3px rgba(200,230,60,.45)}
.szq__switchLabel{font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;color:#959D97}
.szq__switch i{
  width:28px;height:16px;border-radius:8px;background:#DEDED4;position:relative;
  transition:background .16s ease;
}
.szq__switch i::after{
  content:'';position:absolute;left:3px;top:3px;width:10px;height:10px;border-radius:50%;
  background:#fff;box-shadow:0 1px 2px rgba(31,31,29,.2);transition:transform .16s ease,background .16s ease;
}
.szq__switch.on i{background:#C8E63C}
.szq__switch.on i::after{transform:translateX(12px);background:#1A2D22}
.szq__intro{
  margin:4px 0 0;font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;
  color:#959D97;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.szq__intro.is-note{color:#6C7A70}

.szq__value{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  margin-top:6px;font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:#959D97;
}
.szq__value b{
  font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
  color:#2A3C30;white-space:nowrap;font-variant-numeric:tabular-nums;
}

/* 轨道块 28 高（20 的滑块点上下各留 4），设计稿 151:603 就是这个盒子 */
.szq__range{
  -webkit-appearance:none;appearance:none;
  width:100%;height:28px;margin:4px 0 0;padding:0;background:transparent;cursor:pointer;
}
.szq__range:disabled{cursor:not-allowed}
/* 全局 input:focus 会给整条滑杆套一圈 3px 亮色光晕（设计稿没有）；
   键盘聚焦时靠下面滑块点那圈光晕给反馈，鼠标点过不留框 */
.szq__range:focus{box-shadow:none}
.szq__range:focus-visible{outline:0}
.szq__range::-webkit-slider-runnable-track{
  height:6px;border-radius:99px;
  background:linear-gradient(90deg,#C8E63C var(--fill,0%),#DFE5DA var(--fill,0%));
}
.szq__range::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;
  width:20px;height:20px;margin-top:-7px;border-radius:50%;
  background:#C8E63C;border:2px solid #1A2D22;box-shadow:0 1px 2px rgba(26,45,34,.18);
}
.szq__range:disabled::-webkit-slider-thumb{background:#DFE5DA;border-color:#B4BCB6;box-shadow:none}
.szq__range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px rgba(200,230,60,.45)}
.szq__range::-moz-range-track{height:6px;border-radius:99px;background:#DFE5DA}
.szq__range::-moz-range-progress{height:6px;border-radius:99px;background:#C8E63C}
.szq__range::-moz-range-thumb{
  width:16px;height:16px;border-radius:50%;
  background:#C8E63C;border:2px solid #1A2D22;
}

.szq__rangeRow{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  margin-top:4px;font-family:var(--font-numeric);font-size:12px;font-weight:400;
  line-height:var(--ty-caption-lh);letter-spacing:0;color:#959D97;white-space:nowrap;
  font-variant-numeric:tabular-nums;
}

.szq__now{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  height:34px;margin-top:6px;padding:0 10px;border-radius:10px;background:#fff;
  font-size:12px;font-weight:400;line-height:var(--ty-caption-lh);letter-spacing:0;color:#959D97;
}
.szq__now b{
  font-family:var(--font-numeric);font-size:13px;font-weight:500;line-height:var(--ty-label-lh);letter-spacing:0;
  color:#2A3C30;white-space:nowrap;font-variant-numeric:tabular-nums;
}
</style>
