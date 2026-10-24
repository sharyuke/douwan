<script setup>
/* =========================================================================
   新手教程（工作台右上角 / 手机底部「更多」里的入口）
   桌面端和手机端各 5 段轻快背景音乐演示，界面与操作分开录：
   · 桌面：tutorials/desktop/<id>.mp4
   · 手机：tutorials/mobile/<id>.mp4
   默认按当前视口选一套，也可以手动切换。视频由
   scripts/capture-tutorial-shots.cjs + scripts/make-tutorial-videos.cjs
   用真实工作台截图生成，改版后重跑两个脚本即可替换。
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'guide'])

const BASE = import.meta.env.BASE_URL
const videoSrc = (device, file) => `${BASE}tutorials/${device}/${file}.mp4`
const posterSrc = (device, file) => `${BASE}tutorials/${device}/${file}-poster.png`

const DEVICES = [
  { id: 'desktop', label: '桌面端', note: '电脑上的三栏工作台' },
  { id: 'mobile', label: '手机端', note: '画布上下两条功能栏' }
]

const SETS = {
  desktop: {
    totalText: '5 课 · 约 2 分钟',
    lessons: [
      {
        id: 'upload',
        title: '上传图片 · 自动抠图',
        sub: '从一张照片开始',
        desc: '先把照片变成图纸：在左栏上传照片或挑一个现成素材，智能抠图会去掉背景和投影。',
        duration: '0:29',
        points: [
          '左栏「① 先选你要拼什么」上传照片，主体自动裁到画布。',
          '「智能抠图」去背景和投影；透明 PNG 可以不开。',
          '背景杂乱时把力度切到「激进」，边缘保守一点。',
          '没有照片就用「免费素材库」里的现成图案。'
        ]
      },
      {
        id: 'size',
        title: '画布与成品尺寸',
        sub: '底板和清晰度先定下来',
        desc: '在「② 画布与成品尺寸」选实物底板，再用清晰度控制豆子数量；改完可以看实际大小。',
        duration: '0:20',
        points: [
          '底板按实物厘米选，工作台换算成豆子格数。',
          '清晰度 = 豆子数量：越多细节越多，也越费时间。',
          '「实际大小」按屏幕比例还原成品尺寸。',
          '拿不准就先选 52 × 52 颗试一张。'
        ]
      },
      {
        id: 'scheme',
        title: '生成方案 · 色板',
        sub: '像不像，由这一步决定',
        desc: '在「③ 生成方案」选方向，在「④ 色板选择」定颜色数量和品牌；改完立刻重算。',
        duration: '0:20',
        points: [
          '免费版先给「高还原」一套；Pro 可三套对比。',
          '颜色数量、品牌色板、填充方式都在 ④ 展开后。',
          '48~64 色是多数作品的舒适区，色号越多越难拼。',
          '改错了用「恢复方案」回到推荐值。'
        ]
      },
      {
        id: 'check',
        title: '检查 · 微调',
        sub: '把难拼的地方提前修掉',
        desc: '右侧看还原度、可拼性和材料用量，画布上直接改格子；所有编辑都能撤销。',
        duration: '0:20',
        points: [
          '作品分析看还原度、可拼性、孤立豆。',
          '颜色用量列出每色颗数，缺色会标出来。',
          '画笔改色、橡皮擦掉、填充整片、吸色取样。',
          'Ctrl / ⌘ + Z 撤销，划过一排算一步。'
        ]
      },
      {
        id: 'deliver',
        title: '交付 · 开拼 · 完成',
        sub: '从屏幕走到实物',
        desc: '左栏最下面的「⑤ 图纸交付」按用途导出，分板拼装并记录进度，拼完扣库存。',
        duration: '0:25',
        points: [
          'PNG 发出去，PDF 打印照着拼，CSV 拿去采购。',
          '大图按真实板边自动分板，每块板单独一页。',
          '「开始拼这一板」后逐颗或整板记录进度。',
          '拼完点「完成作品」：扣库存、记时间、生成分享卡。'
        ]
      }
    ]
  },
  mobile: {
    totalText: '5 课 · 约 2 分钟',
    lessons: [
      {
        id: 'upload',
        title: '上传与快捷区',
        sub: '手机端的入口都在画布边上',
        desc: '手机把常用功能放在画布上下两条：上面是快捷区，下面是工具行；空画布的上传入口就在中间。',
        duration: '0:25',
        points: [
          '空画布先看引导，上传入口就在画布中间。',
          '顶栏切 图纸 / 原图 / 对照，右边调缩放、点「适应」回整张。',
          '快捷区：画布、色板、换图、导出、更多。',
          '换图时也能进「免费素材库」挑现成图案。'
        ]
      },
      {
        id: 'size',
        title: '尺寸与清晰度',
        sub: '快捷区「画布」抽屉里调',
        desc: '点快捷区「画布」，在底部抽屉里选底板厘米数和清晰度，摘要会写清成品多大、多少颗豆。',
        duration: '0:20',
        points: [
          '底板按实物厘米选，清晰度按豆子数量选。',
          '抽屉下方的摘要写成品尺寸和总颗数。',
          '画布右侧浮控「1:1」按实际大小看成品。',
          '手机上先定尺寸再调方案，重算更快。'
        ]
      },
      {
        id: 'scheme',
        title: '生成方案 · 色板',
        sub: '手机上同样能调',
        desc: '「更多 → 方案」选方向，快捷区「色板」定颜色数量和品牌；免费版先给一套高还原。',
        duration: '0:15',
        points: [
          '免费版给「高还原」一套；Pro 可三套对比。',
          '色板抽屉里改颜色数量、品牌、填充方式。',
          '改完画布立刻重算。'
        ]
      },
      {
        id: 'edit',
        title: '编辑与检查',
        sub: '工具行就在画布下方',
        desc: '画布下方是工具行，画布右侧浮控管撤销和缩放；分析和用量在「更多」里。',
        duration: '0:25',
        points: [
          '工具行：镜像、画笔、橡皮、填充、取色、更多；选画笔会出现笔刷大小。',
          '右侧浮控：撤销 / 重做 / 1:1 / 加减缩放 / 定位。',
          '「更多 → 分析」看还原度、可拼性、孤立豆。',
          '「更多 → 用量」看每色颗数，缺色会标出来。'
        ]
      },
      {
        id: 'deliver',
        title: '交付与保存',
        sub: '快捷区导出，更多里保存',
        desc: '快捷区「导出」分整张图纸、分板、拼装三个标签；「更多 → 保存作品」存下来，下次从底部「作品」继续。',
        duration: '0:25',
        points: [
          '整张图纸导出 PNG / PDF / CSV。',
          '分板交付每块板单独一页，带坐标和色号。',
          '拼装页逐颗或整板记录进度。',
          '「更多 → 保存作品」后从底部「作品」继续。'
        ]
      }
    ]
  }
}

const detectDevice = () => {
  if (typeof window === 'undefined') return 'desktop'
  return window.matchMedia('(max-width: 820px)').matches ? 'mobile' : 'desktop'
}

const device = ref('desktop')
const current = ref(0)
const videoEl = ref(null)
const playing = ref(false)
const failed = ref(false)

const lessons = computed(() => SETS[device.value].lessons)
const totalText = computed(() => SETS[device.value].totalText)
const active = computed(() => lessons.value[current.value])

function select(i) {
  if (i === current.value) return
  current.value = i
  playing.value = false
  failed.value = false
}

function setDevice(id) {
  if (id === device.value) return
  device.value = id
  current.value = 0
  playing.value = false
  failed.value = false
}

function play() {
  failed.value = false
  const el = videoEl.value
  if (!el) return
  el.play().then(() => { playing.value = true }).catch(() => { failed.value = true })
}

function onPlay() { playing.value = true; failed.value = false }
function onPause() { playing.value = false }
function onEnded() { playing.value = false }
function onError() { failed.value = true; playing.value = false }

function close() { emit('update:modelValue', false) }

watch(() => props.modelValue, open => {
  if (open) {
    device.value = detectDevice()
    current.value = 0
    failed.value = false
    playing.value = false
    return
  }
  const el = videoEl.value
  if (el) {
    el.pause()
    try { el.currentTime = 0 } catch { /* 元数据还没到时忽略 */ }
  }
  playing.value = false
})

watch([current, device], () => {
  const el = videoEl.value
  if (el) {
    try { el.load() } catch { /* 忽略 */ }
  }
})
</script>

<template>
  <BaseDialog
    :model-value="modelValue" size="lg" title="新手教程"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <div class="tutorial" data-audit="tutorial-dialog">
      <div class="tutorial__main">
        <div class="deviceBar" role="tablist" aria-label="选择设备版本">
          <button
            v-for="d in DEVICES" :key="d.id"
            type="button" role="tab" class="deviceTab"
            :class="{ on: device === d.id }"
            :aria-selected="device === d.id"
            :data-device="d.id"
            data-audit="tutorial-device"
            @click="setDevice(d.id)"
          >
            <b>{{ d.label }}</b><small>{{ d.note }}</small>
          </button>
        </div>

        <div class="player" :class="{ 'player--portrait': device === 'mobile' }">
          <video
            ref="videoEl" :key="`${device}-${active.id}`"
            :src="videoSrc(device, active.id)" :poster="posterSrc(device, active.id)"
            controls playsinline preload="metadata"
            :aria-label="`${device === 'mobile' ? '手机端' : '桌面端'}第 ${current + 1} 课：${active.title}`"
            @play="onPlay" @pause="onPause" @ended="onEnded" @error="onError"
          ></video>
          <button
            v-if="!playing && !failed" type="button" class="player__cover"
            :aria-label="`播放第 ${current + 1} 课：${active.title}`" @click="play"
          >
            <img class="player__poster" :src="posterSrc(device, active.id)" alt="">
            <span class="player__play" aria-hidden="true"><PixelIcon name="play" :size="26" /></span>
          </button>
          <div v-if="failed" class="player__fallback">
            <b>视频暂时加载失败</b>
            <p>可以先看 <RouterLink to="/help" @click="close">完整文字教程</RouterLink>，内容一样完整。</p>
          </div>
        </div>

        <div class="lessonMeta">
          <div class="lessonMeta__head">
            <span class="tag new">{{ device === 'mobile' ? '手机端' : '桌面端' }} · 第 {{ current + 1 }} 课</span>
            <b>{{ active.title }}</b>
            <span class="muted">{{ active.duration }}</span>
          </div>
          <p>{{ active.desc }}</p>
          <ul class="lessonPoints">
            <li v-for="p in active.points" :key="p">
              <PixelIcon name="check" :size="12" class="pointCheck" /><span>{{ p }}</span>
            </li>
          </ul>
        </div>
      </div>

      <aside class="tutorial__list" aria-label="教程列表">
        <div class="tutorial__listHead">
          <b>{{ totalText }}</b>
          <span>{{ device === 'mobile' ? '手机界面单独一套' : '轻快背景音乐，重点看画面字幕' }}</span>
        </div>
        <button
          v-for="(l, i) in lessons" :key="l.id"
          type="button" class="lessonItem" :class="{ on: i === current }"
          :aria-current="i === current ? 'true' : undefined" @click="select(i)"
        >
          <span class="lessonItem__no">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="lessonItem__body"><b>{{ l.title }}</b><small>{{ l.sub }}</small></span>
          <span class="lessonItem__time">{{ l.duration }}</span>
        </button>
        <div class="tutorial__foot">
          <button type="button" class="btn primary block" data-guide-replay @click="emit('guide')">看一遍工作台指引</button>
          <RouterLink to="/editor" class="btn soft block" @click="close">去工作台试一次</RouterLink>
          <RouterLink to="/help" class="btn soft block" @click="close">完整文字教程</RouterLink>
        </div>
      </aside>
    </div>
    <template #footer="{ close: closeDialog }">
      <span class="tutorial__note">教程会随功能更新，遇到对不上的地方以工作台实际界面为准。</span>
      <button class="btn btn-secondary" @click="closeDialog">关闭</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.tutorial{display:grid;grid-template-columns:minmax(0,1fr) 292px;gap:16px;align-items:start}
.tutorial__main{min-width:0}
.deviceBar{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:11px}
.deviceTab{
  display:flex;flex-direction:column;gap:2px;padding:9px 12px;text-align:left;
  border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);
  cursor:pointer;transition:var(--t);
}
.deviceTab:hover{border-color:#C9C9C3}
.deviceTab.on{border-color:var(--primary);background:var(--primary-soft)}
.deviceTab b{font-size:var(--fs-sm)}
.deviceTab small{font-size:var(--fs-2xs);color:var(--muted)}
.player{position:relative;aspect-ratio:16/9;background:#14161a;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line)}
.player video{display:block;width:100%;height:100%;object-fit:contain;background:#14161a}
/* 手机端教程是竖屏录的：播放器跟着换成 9:16，限宽限高避免把弹窗顶出屏幕 */
.player--portrait{width:min(100%,315px);aspect-ratio:9/16;margin:0 auto}
.player__cover{
  position:absolute;inset:0;display:block;width:100%;height:100%;padding:0;border:0;
  background:#14161a;cursor:pointer;text-align:left;
}
.player__poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.96}
.player__play{
  position:absolute;left:50%;top:46%;width:64px;height:64px;margin:-32px 0 0 -32px;
  border-radius:50%;display:grid;place-items:center;padding-left:3px;
  background:var(--primary);color:var(--primary-ink);
  box-shadow:0 10px 30px rgba(0,0,0,.28);transition:transform .16s var(--ease);
}
.player__cover:hover .player__play{transform:scale(1.06)}
.player__fallback{
  position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:6px;padding:24px;text-align:center;color:#fff;background:#14161a;
}
.player__fallback p{margin:0;font-size:var(--fs-sm);color:rgba(255,255,255,.78)}
.player__fallback a{color:#fff;text-decoration:underline}
.lessonMeta{padding:13px 2px 0}
.lessonMeta__head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.lessonMeta__head b{font-size:var(--fs-h3)}
.lessonMeta__head .muted{margin-left:auto;font-size:var(--fs-xs)}
.lessonMeta p{margin:8px 0 0;font-size:var(--fs-sm);line-height:1.8;color:var(--ink-2)}
.lessonPoints{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:7px}
.lessonPoints li{display:flex;gap:6px;font-size:var(--fs-xs);line-height:1.7;color:var(--ink-2)}
.pointCheck{flex:none;margin-top:4px;color:var(--green-deep)}
.tutorial__list{display:flex;flex-direction:column;gap:8px;padding:11px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2)}
.tutorial__listHead{display:flex;flex-direction:column;gap:2px;padding:2px 3px 5px}
.tutorial__listHead b{font-size:var(--fs-sm)}
.tutorial__listHead span{font-size:var(--fs-xs);color:var(--muted)}
.lessonItem{
  display:flex;align-items:center;gap:10px;width:100%;padding:10px 11px;text-align:left;
  border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);
  cursor:pointer;transition:var(--t);
}
.lessonItem:hover{border-color:#C9C9C3}
.lessonItem.on{border-color:var(--primary);background:var(--primary-soft);box-shadow:none}
.lessonItem__no{font-size:var(--fs-xs);font-weight:800;color:var(--primary-deep);font-variant-numeric:tabular-nums}
.lessonItem.on .lessonItem__no{color:var(--ink)}
.lessonItem__body{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.lessonItem__body b{font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lessonItem__body small{font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lessonItem__time{font-size:var(--fs-2xs);color:var(--muted);font-variant-numeric:tabular-nums}
.tutorial__foot{display:flex;flex-direction:column;gap:7px;margin-top:4px}
.tutorial__note{margin-right:auto;font-size:var(--fs-xs);color:var(--muted);line-height:1.5}

@media(max-width:820px){
  .tutorial{grid-template-columns:1fr;gap:13px}
  .deviceBar{margin-bottom:10px}
  .deviceTab{padding:8px 10px}
  .player{border-radius:var(--r-sm)}
  .player--portrait{width:min(100%,calc(58vh * 9 / 16))}
  .player__play{width:52px;height:52px;margin:-26px 0 0 -26px;font-size:18px}
  .lessonMeta{padding-top:0}
  .tutorial__list{padding:9px}
  .lessonItem{padding:9px 10px}
  /* 三个按钮排一行会把 330px 的弹窗撑出横向滚动：
     第一个占满一行，另外两个各占一半 */
  .tutorial__foot{flex-direction:row;flex-wrap:wrap}
  .tutorial__foot > .btn{flex:1 1 calc(50% - 4px)}
  .tutorial__foot > .btn:first-child{flex-basis:100%}
  .tutorial__note{display:none}
}
</style>
