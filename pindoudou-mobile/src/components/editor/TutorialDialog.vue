<script setup>
/* =========================================================================
   新手教程（工作台右上角入口）
   把原来「5 分钟上手」的文字清单改成 4 段无声演示视频：
   上传与抠图 / 选方案与色板 / 检查与微调 / 导出与开拼。
   视频由 scripts/make-tutorial-videos.cjs 用真实工作台截图生成，
   放在 public/tutorials/，改版后重跑脚本即可替换。
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const BASE = import.meta.env.BASE_URL
const videoSrc = file => `${BASE}tutorials/${file}.mp4`
const posterSrc = file => `${BASE}tutorials/${file}-poster.png`

const lessons = [
  {
    id: 'upload',
    title: '上传图片 · 自动抠图',
    sub: '从一张照片开始',
    desc: '先把照片变成图纸：上传图片或挑一个现成素材，再用智能抠图把背景和投影去掉。',
    duration: '0:24',
    points: [
      '左栏「① 创建」上传照片，或从免费素材库挑一个图案。',
      '「智能抠图」会去掉背景和投影，主体自动占满画布。',
      '透明 PNG 不用开抠图：透明的地方直接不放豆。',
      '背景杂乱时把力度切到「激进」，主体边缘要保守一点。'
    ]
  },
  {
    id: 'scheme',
    title: '选方案 · 调色板',
    sub: '像不像，由这一步决定',
    desc: '在 2×2 方案格里挑一个方向，再用色板控制颜色数量和品牌；改完立刻重算。',
    duration: '0:20',
    points: [
      '「③ 生成方案」四选一：高还原 / 好拼版 / 艺术版，推荐项会标出来。',
      '颜色数量、品牌色板、填充方式都在「④ 色板选择」展开后。',
      '48~64 色是多数作品的舒适区，色号越多越难拼。',
      '改错了用「恢复方案」回到系统推荐值。'
    ]
  },
  {
    id: 'check',
    title: '检查 · 微调',
    sub: '把难拼的地方提前修掉',
    desc: '右侧看还原度、可拼性与材料用量，画布上直接改格子；所有编辑都能撤销。',
    duration: '0:20',
    points: [
      '作品分析里看还原度、可拼性与孤立豆数量。',
      '颜色用量列出每种色号的颗数，缺色会标出来。',
      '画笔改色、橡皮擦掉、填充整片、吸色取样。',
      'Ctrl / ⌘ + Z 撤销，拖着画笔划过一排算一步。'
    ]
  },
  {
    id: 'deliver',
    title: '导出 · 开拼 · 完成',
    sub: '从屏幕走到实物',
    desc: '按用途导出 PNG / PDF / CSV，分板拼装并记录进度，拼完扣库存、进成长记录。',
    duration: '0:25',
    points: [
      '「⑤ 图纸交付」：PNG 发出去，PDF 打印照着拼，CSV 拿去采购。',
      '大图按真实板边自动分板，每块板单独一页。',
      '「开始拼这一板」后逐颗或整板记录进度。',
      '拼完点「完成作品」：扣减库存、记下完成时间、生成分享卡。'
    ]
  }
]

const current = ref(0)
const videoEl = ref(null)
const playing = ref(false)
const failed = ref(false)
const active = computed(() => lessons[current.value])
const totalText = '4 课 · 约 1 分 30 秒'

function select(i) {
  if (i === current.value) return
  current.value = i
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

watch(current, () => {
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
        <div class="player">
          <video
            ref="videoEl" :key="active.id"
            :src="videoSrc(active.id)" :poster="posterSrc(active.id)"
            controls playsinline preload="metadata"
            :aria-label="`第 ${current + 1} 课：${active.title}`"
            @play="onPlay" @pause="onPause" @ended="onEnded" @error="onError"
          ></video>
          <button
            v-if="!playing && !failed" type="button" class="player__cover"
            :aria-label="`播放第 ${current + 1} 课：${active.title}`" @click="play"
          >
            <img class="player__poster" :src="posterSrc(active.id)" alt="">
            <span class="player__play" aria-hidden="true"><PixelIcon name="play" :size="26" /></span>
          </button>
          <div v-if="failed" class="player__fallback">
            <b>视频暂时加载失败</b>
            <p>可以先看 <RouterLink to="/help" @click="close">完整文字教程</RouterLink>，内容一样完整。</p>
          </div>
        </div>

        <div class="lessonMeta">
          <div class="lessonMeta__head">
            <span class="tag new">第 {{ current + 1 }} 课</span>
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
          <span>无声演示，重点看画面字幕</span>
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
          <RouterLink to="/editor" class="btn primary block" @click="close">去工作台试一次</RouterLink>
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
.player{position:relative;aspect-ratio:16/9;background:#14161a;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line)}
.player video{display:block;width:100%;height:100%;object-fit:contain;background:#14161a}
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
  .player{border-radius:var(--r-sm)}
  .player__play{width:52px;height:52px;margin:-26px 0 0 -26px;font-size:18px}
  .lessonMeta{padding-top:0}
  .tutorial__list{padding:9px}
  .lessonItem{padding:9px 10px}
  .tutorial__foot{flex-direction:row}
  .tutorial__foot :deep(.btn){flex:1}
  .tutorial__note{display:none}
}
</style>
