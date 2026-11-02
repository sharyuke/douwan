<script setup>
/* =========================================================================
   新手版向导（三步）
   -------------------------------------------------------------------------
   ① 选择图片 → ② 调整效果 → ③ 获取图纸
   三步共用同一份作品状态（useStudio），和专业工作台是**同一件作品**，
   不是第二份图纸副本。

   两条保护（PRD §模式切换状态机）：
   ① 参数保护：新手版改尺寸 / 改颜色数会重新生成图纸，会冲掉专业模式里
      逐颗改过的格子 → 先弹窗，给「保留当前修改」和「另存一个版本并继续」两条路；
   ② 模式保护：专业 → 新手时若图被手工改过，弹层说明「不会自动重画」。

   2026-10-26：手机端改成一屏工作台（新版手机端布局需求 V1.0）——
   步骤条固定在顶部，中间那一步自己滚，底部主按钮常显（在标签栏上方）。
   桌面 / 平板的版面没动。
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import BeginnerSelect from './BeginnerSelect.vue'
import BeginnerAdjust from './BeginnerAdjust.vue'
import BeginnerExport from './BeginnerExport.vue'
import { hasPattern, manualEdited, projectName, saveProject } from '../../composables/useStudio.js'
import { requestSwitch } from '../../composables/useBeginnerMode.js'
import { toastOk } from '../../composables/useToast.js'

const STEPS = [
  { n: 1, label: '选择图片', hint: '上传照片或挑一个免费素材' },
  { n: 2, label: '调整效果', hint: '调成品大小与颜色多少' },
  { n: 3, label: '获取图纸', hint: '下载图纸与材料清单' }
]

const step = ref(1)

/* 挂载时手上已经有图纸 ⇒ 是从专业模式切回来的（或者刷新后接着做），
   直接落在第 ③ 步「获取图纸」，不按新手默认参数重画（PRD §模式切换状态机）。
   ⚠️ 这里用 onMounted 而不是 watch(hasPattern)：watch 会在第 ① 步
   **生成图纸的那一刻**也触发，那样用户刚选完图就被跳到第 ③ 步，
   中间的「调整效果」整步被吃掉 —— 这正是踩过的坑。 */
onMounted(() => {
  if (hasPattern.value) step.value = 3
})

const canGo = computed(() => ({
  1: true,
  2: hasPattern.value,
  3: hasPattern.value
}))

function go(n) {
  if (!canGo.value[n]) return
  step.value = n
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ---------------------------------------------------------------- 参数保护 */
const guard = ref(null)   // { reason, run }

function onProtected(payload) {
  if (!payload || typeof payload.run !== 'function') return
  /* 有手工修改 → 先问一句；没有就直接改 */
  if (hasPattern.value && manualEdited.value) {
    guard.value = { reason: '改这个参数会重新计算图纸，专业模式里逐颗改过的格子会被覆盖。', run: payload.run }
  } else {
    payload.run()
  }
}

/** 保留当前修改：什么都不做 */
function keepManual() {
  guard.value = null
}

/** 另存一个版本并继续：先把当前（含手工修改）存成作品，再照新参数重算 */
function saveVersionAndContinue() {
  const run = guard.value && guard.value.run
  guard.value = null
  if (!run) return
  const saved = saveProject(projectName.value || '我的拼豆作品')
  if (saved) toastOk('已保存当前版本，正在按新参数重新计算')
  run()
}

/* ---------------------------------------------------------------- 模式切换 */
function toPro() {
  requestSwitch('pro', 'wizard')
}

/* 手机底部常驻条上的「下载拼豆图纸」：转手给第 ③ 步自己那份导出逻辑，
   免得同一件事写两遍（两处导出参数不一致的话，用户会拿到不一样的图）。 */
const exportRef = ref(null)
function downloadFromBar() {
  exportRef.value && exportRef.value.downloadPNG && exportRef.value.downloadPNG()
}

/* 第 ② 步正在重算图纸时，底部的「下一步」按钮要跟着禁用（页面上那个按钮是禁用的，
   底部常驻条要是一样，否则会出现「点了没反应」）。 */
const adjustRef = ref(null)
const adjustBusy = computed(() => !!(adjustRef.value && adjustRef.value.busy))
</script>

<template>
  <div class="bwiz">
    <!-- ---------------------------------------------------------- 步骤条 -->
    <ol class="bwiz__steps" aria-label="新手三步">
      <li
        v-for="s in STEPS"
        :key="s.n"
        class="bwiz__step"
        :class="{ on: step === s.n, done: step > s.n, locked: !canGo[s.n] }"
      >
        <button type="button" :disabled="!canGo[s.n]" @click="go(s.n)">
          <i><PixelIcon v-if="step > s.n" name="check" :size="11" /><template v-else>{{ s.n }}</template></i>
          <span class="bwiz__stepText">
            <b>{{ s.label }}</b>
            <small>{{ s.hint }}</small>
          </span>
        </button>
      </li>
    </ol>

    <!-- ---------------------------------------------------------- 三步内容 -->
    <section v-if="step === 1" class="bwiz__panel">
      <h2 class="bwiz__title">第一步 · 选一张图</h2>
      <p class="bwiz__sub">上传自己的照片，或者从免费素材里挑一个，都不用注册。</p>
      <BeginnerSelect @next="go(2)" />
    </section>

    <section v-else-if="step === 2" class="bwiz__panel">
      <h2 class="bwiz__title">第二步 · 调整拼豆效果</h2>
      <p class="bwiz__sub">做出来多大、用多少颜色，都能在这里定；随时能改。</p>
      <BeginnerAdjust
        ref="adjustRef"
        @next="go(3)"
        @back="go(1)"
        @protected="onProtected"
      />
    </section>

    <section v-else class="bwiz__panel">
      <h2 class="bwiz__title">第三步 · 拿走图纸</h2>
      <p class="bwiz__sub">下载带色号的图纸和材料清单，就可以开始拼了。</p>
      <BeginnerExport ref="exportRef" @back="go(2)" @pro="toPro" />
    </section>

    <!-- ---------------------------------------------------------- 手机端常驻 CTA
         手机上预览图很大，主按钮被顶到屏幕外很远的位置 ——
         按需求「底部本步主按钮常显，不遮挡画布」，
         把这一步的主操作钉在底部标签栏上方（它现在是容器里的一格，不是浮层，
         所以永远不会盖住上面的内容）。 -->
    <div v-if="step > 1" class="bwiz__mobileBar">
      <button v-if="step === 2" type="button" class="btn btn-secondary bwiz__mobileBack" @click="go(1)">
        上一步
      </button>
      <button v-if="step === 2" type="button" class="btn primary bwiz__mobileCta" :disabled="adjustBusy" @click="go(3)">
        <PixelIcon name="arrowRight" :size="14" />
        下一步：获取图纸
      </button>
      <button v-else type="button" class="btn primary bwiz__mobileCta" @click="downloadFromBar">
        <PixelIcon name="download" :size="14" />
        下载拼豆图纸
      </button>
    </div>

    <!-- ---------------------------------------------------------- 参数保护弹层 -->
    <BaseDialog :model-value="!!guard" title="重新计算会覆盖手工修改" size="sm"
                @update:model-value="v => { if (!v) keepManual() }">
      <p class="bwiz__guardText">{{ guard ? guard.reason : '' }}</p>
      <p class="bwiz__guardText bwiz__guardText--muted">
        「保留当前修改」= 这次不改，图纸保持原样；「另存一个版本并继续」= 先把现在这份存成作品，再按新参数重算。
      </p>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="keepManual">保留当前修改</button>
        <button type="button" class="btn primary" @click="saveVersionAndContinue">另存一个版本并继续</button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.bwiz{width:min(1180px,100%);margin:0 auto}

/* ---- 步骤条：电脑横向、平板与手机横向滚动 ---- */
.bwiz__steps{
  list-style:none;margin:0 0 18px;padding:0;
  display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;
}
.bwiz__step{flex:1 1 0;min-width:150px}
.bwiz__step button{
  width:100%;display:flex;align-items:center;gap:10px;text-align:left;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  padding:10px 12px;transition:var(--t);
}
.bwiz__step button:disabled{cursor:not-allowed;opacity:.6}
.bwiz__step i{
  width:26px;height:26px;flex:0 0 auto;border-radius:var(--r-xs);
  display:grid;place-items:center;background:var(--surface-3);
  font-size:var(--fs-xs);font-weight:800;font-style:normal;
}
.bwiz__stepText{display:flex;flex-direction:column;line-height:1.35;min-width:0}
.bwiz__stepText b{font-size:var(--fs-sm);white-space:nowrap}
.bwiz__stepText small{font-size:var(--fs-2xs);color:var(--muted-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bwiz__step.on button{border-color:var(--primary);background:var(--primary-soft);box-shadow:0 0 0 2px rgba(255,214,46,.16)}
.bwiz__step.on i{background:var(--primary);color:var(--primary-ink)}
.bwiz__step.done button{border-color:var(--green);background:var(--green-soft)}
.bwiz__step.done i{background:var(--green);color:#fff}

.bwiz__panel{
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:18px;
}
.bwiz__title{font-size:var(--fs-h2);margin-bottom:4px}
.bwiz__sub{font-size:var(--fs-sm);color:var(--muted);margin-bottom:16px}
.bwiz__guardText{font-size:var(--fs-sm);color:var(--ink-2);line-height:1.7;margin-bottom:10px}
.bwiz__guardText--muted{color:var(--muted);font-size:var(--fs-xs);margin-bottom:0}

/* 手机端常驻 CTA 条：桌面与平板用不到，默认不渲染 */
.bwiz__mobileBar{display:none}

/* ============================ 手机端：一屏工作台 ============================ */
@media(max-width:780px){
  /* 整条向导就是一列：步骤条（固定）→ 当前步骤（占满剩余高度）→ 常驻 CTA */
  .bwiz{width:100%;height:100%;display:flex;flex-direction:column;min-height:0}

  /* 步骤条压扁：三段平分一行，不再横向滚动（滚动会让「当前在第几步」看不清） */
  .bwiz__steps{margin-bottom:8px;gap:6px;overflow-x:visible;padding-bottom:0;flex:0 0 auto}
  .bwiz__step{flex:1 1 0;min-width:0}
  .bwiz__step button{padding:7px 8px;gap:6px}
  .bwiz__step i{width:22px;height:22px;font-size:11px}
  .bwiz__stepText b{font-size:var(--fs-2xs)}
  .bwiz__stepText small{display:none}

  /* 中间的工作区：占满剩余高度，溢出由各步自己处理 */
  .bwiz__panel{
    flex:1 1 auto;min-height:0;display:flex;flex-direction:column;
    padding:10px;border-radius:var(--r-md);overflow:hidden;
  }
  .bwiz__title{flex:0 0 auto;font-size:var(--fs-sm);margin-bottom:2px}
  /* 说明文字与步骤条重复，手机上省掉，把高度留给画布 */
  .bwiz__sub{display:none}

  /* 常驻 CTA：容器里的一格，不是浮层 ⇒ 永远不会压住上面的内容 */
  .bwiz__mobileBar{
    display:flex;gap:8px;flex:0 0 auto;margin-top:8px;
    position:static;background:none;border:0;border-radius:0;padding:0;box-shadow:none;
  }
  .bwiz__mobileCta{flex:1 1 auto}
  .bwiz__mobileBack{flex:0 0 auto;padding-left:16px;padding-right:16px}
}
</style>
