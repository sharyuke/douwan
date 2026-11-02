<script setup>
/* =========================================================================
   新手版 · 第 ② 步：调整拼豆效果
   -------------------------------------------------------------------------
   这一步只暴露三件事：成品多大、颜色多少、看效果（拼豆 / 原图 / 对比）。
   逐颗编辑、抠图、卡通化、抖动这些专业参数一律不出现（PRD 功能清单）。

   数据全部是真实算出来的：
   · 成品厘米 = 格数 × 豆径（口径在 lib/boardSpec.js）
   · 有效豆数 = 图纸里真正有豆的格子数（useStudio.stats）
   · 颜色种类 = 图纸色板里实际用到的颜色数
   · 板数 = 按当前分板规格铺满要几块板
   拖动滑块时显示的是**按面积比例估的**值（标注「估算」），
   松手后重新取样，再显示精确值 —— 估算与精确不混在一起说。
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'
import PatternPreview from '../ui/PatternPreview.vue'
import {
  activeKey, bead, generating, hasPattern, maxCells, options, pattern, sourceAspect, sourceUrl,
  stats, variants, yieldForBusyPaint, regenerate
} from '../../composables/useStudio.js'
import { SIZE_TIERS, tierBox, boardSpecFor } from '../../lib/boardSpec.js'
import { MAX_TARGET_COLORS, colorFloorForCells } from '../../lib/pattern.js'
import { toastOk, toastWarn } from '../../composables/useToast.js'

const emit = defineEmits(['next', 'back', 'protected'])

/* ---------------------------------------------------------------- 视图 */
const view = ref('pattern')   // 'pattern' | 'source' | 'split'

/* ---------------------------------------------------------------- 尺寸档位 */
/** 可选档位：受当前套餐单边上限约束（上限随画布容量 / 豆子规格 / 图片比例变化） */
const tiers = computed(() => SIZE_TIERS.filter(t => t.n <= maxCells.value))

/** 当前成品尺寸落在第几档 */
function indexOfBox(w, h) {
  let best = 0
  let bestD = Infinity
  tiers.value.forEach((t, i) => {
    const box = tierBox({ n: t.n }, sourceAspect.value)
    const d = Math.abs(box.w - w) + Math.abs(box.h - h)
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

const tierIndex = ref(0)
watch(tiers, () => { tierIndex.value = indexOfBox(options.canvasW, options.canvasH) }, { immediate: true })

/** 滑块指向的那一档实际是多少格 */
const targetBox = computed(() => {
  const t = tiers.value[tierIndex.value]
  if (!t) return { w: options.canvasW, h: options.canvasH }
  return tierBox({ n: t.n }, sourceAspect.value)
})

/** 自动匹配推荐的那一档（比它小 = 细节会掉）。
    存成快照而不是实时算：用户把尺寸改大之后，底板容量也跟着变了，
    实时算的话「推荐档」会一直跟着当前值走，警告就永远不出现。 */
const recommendedIndex = ref(0)
const tooSmall = computed(() => tierIndex.value < recommendedIndex.value)

/** 拖动中的估算值：豆数按当前图的填充率等比缩放 */
const preview = computed(() => {
  const box = targetBox.value
  const cells = box.w * box.h
  const st = stats.value
  const curArt = st ? st.artW * st.artH : cells
  const fill = st && curArt ? st.total / curArt : 0.9
  const spec = boardSpecFor(box.w, box.h)
  return {
    cm: `${(box.w * bead.value.cm).toFixed(1)} × ${(box.h * bead.value.cm).toFixed(1)} cm`,
    grid: `${box.w} × ${box.h}`,
    cells,
    beads: Math.round(cells * fill),
    boards: `${Math.ceil(box.w / spec) * Math.ceil(box.h / spec)} 块`,
    spec
  }
})

/** 精确值（重新取样之后） */
const exact = computed(() => {
  const st = stats.value
  if (!st) return null
  return {
    cm: st.cm,
    grid: `${st.artW} × ${st.artH}`,
    cells: st.artW * st.artH,
    beads: st.total,
    colors: st.colors,
    boards: st.boards,
    boardText: st.boardText
  }
})

/* ---------------------------------------------------------------- 颜色丰富程度 */
const RICHNESS = [
  { key: 'few', label: '少色', hint: '颜色少、好拼省力' },
  { key: 'standard', label: '标准', hint: '细节与省力兼顾' },
  { key: 'rich', label: '丰富', hint: '颜色多、更像原图' }
]
const richness = ref('standard')

function richnessOf(target) {
  const floor = colorFloorForCells(options.canvasW * options.canvasH) || 16
  if (target <= Math.round(floor * 0.8)) return 'few'
  if (target >= Math.round(floor * 1.3)) return 'rich'
  return 'standard'
}
watch(() => options.targetColors, v => { richness.value = richnessOf(Number(v) || 16) })

/* ---------------------------------------------------------------- 应用参数 */
/** 进入第 ② 步时的设置快照：给「撤销这次调整」用 */
const snapshot = ref(null)
watch(() => hasPattern.value, v => {
  if (v && !snapshot.value) {
    snapshot.value = { colors: options.targetColors, w: options.canvasW, h: options.canvasH }
    /* 自动匹配推荐的档位（底板容量就是自动匹配算出来的那一档） */
    recommendedIndex.value = indexOfBox(options.canvasMaxW, options.canvasMaxH)
  }
}, { immediate: true })

const applying = ref(false)

/**
 * 真正套用成品尺寸。
 * 先把底板容量撑到新尺寸，再把成品区域设成它 —— 两个都要改，
 * 只改一个会出现「成品比底板大」或「底板没跟着长」的不一致状态。
 */
async function applySize() {
  if (applying.value) return
  const box = targetBox.value
  applying.value = true
  try {
    await yieldForBusyPaint()
    options.canvasMaxW = box.w
    options.canvasMaxH = box.h
    options.canvasW = box.w
    options.canvasH = box.h
    regenerate({ silent: true })
    toastOk(`成品尺寸已改成 ${preview.value.cm}`)
  } finally {
    applying.value = false
  }
}

/** 滑块松手时才真正重算（拖动过程只更新估算值） */
function onSliderCommit() {
  const box = targetBox.value
  if (box.w === options.canvasW && box.h === options.canvasH) return
  emit('protected', { run: applySize })
}

/** 颜色丰富程度：映射到真实的量化参数（目标色号 + 方案档位） */
function applyRichness(key) {
  const cells = options.canvasW * options.canvasH
  const floor = colorFloorForCells(cells) || 16
  let target = floor
  if (key === 'few') target = Math.max(8, Math.round(floor * 0.75))
  if (key === 'rich') target = Math.min(MAX_TARGET_COLORS, Math.round(floor * 1.6))
  const wantKey = key === 'few' ? 'easy' : 'high'
  emit('protected', {
    run: async () => {
      applying.value = true
      try {
        await yieldForBusyPaint()
        options.targetColors = target
        regenerate({ silent: true })
        if (variants.value.some(v => v.key === wantKey)) activeKey.value = wantKey
        const label = RICHNESS.find(r => r.key === key)
        toastOk(`已切换到「${label.label}」：${options.targetColors} 色上限`)
      } finally {
        applying.value = false
      }
    }
  })
}

/** 撤销这次调整：回到进入第 ② 步时的尺寸与颜色 */
function revert() {
  const s = snapshot.value
  if (!s) return
  emit('protected', {
    run: async () => {
      applying.value = true
      try {
        await yieldForBusyPaint()
        options.canvasMaxW = s.w
        options.canvasMaxH = s.h
        options.canvasW = s.w
        options.canvasH = s.h
        options.targetColors = s.colors
        regenerate({ silent: true })
        toastOk('已恢复到上一步的设置')
      } finally {
        applying.value = false
      }
    }
  })
}

/* 手机底部的常驻「下一步」按钮要点这一步的下一步，
   顺便把「正在重算」的状态告诉外层（外层据此禁用按钮，避免连点）。 */
defineExpose({
  busy: applying,
  next: () => emit('next')
})
</script>

<template>
  <div class="badj">
    <!-- ---------------------------------------------------------- 预览 -->
    <div class="badj__stage">
      <div class="tabs badj__viewtabs" role="tablist">
        <button type="button" :class="{ on: view === 'pattern' }" @click="view = 'pattern'">拼豆效果</button>
        <button type="button" :class="{ on: view === 'source' }" @click="view = 'source'">原图</button>
        <button type="button" :class="{ on: view === 'split' }" @click="view = 'split'">对比</button>
      </div>

      <div class="badj__canvasBox">
        <div v-show="view === 'pattern'" class="badj__pane badj__pane--pattern">
          <PatternPreview v-if="pattern" :pattern="pattern" :max-size="640" :alt="'拼豆图纸预览'" />
          <p v-else class="badj__empty">正在生成图纸…</p>
        </div>
        <div v-show="view === 'source'" class="badj__pane badj__pane--source">
          <img v-if="sourceUrl" :src="sourceUrl" alt="原图" class="badj__source">
          <p v-else class="badj__empty">这张图是素材库里的矢量图，没有单独的原始照片</p>
        </div>
        <div v-show="view === 'split'" class="badj__split">
          <div class="badj__pane">
            <PatternPreview v-if="pattern" :pattern="pattern" :max-size="640" :alt="'拼豆图纸预览'" />
          </div>
          <div class="badj__pane">
            <img v-if="sourceUrl" :src="sourceUrl" alt="原图" class="badj__source">
            <p v-else class="badj__empty">无原图</p>
          </div>
        </div>
      </div>

      <p v-if="generating || applying" class="badj__busy">正在重新计算图纸…</p>
    </div>

    <!-- ---------------------------------------------------------- 参数 -->
    <div class="badj__params">
      <!-- 成品尺寸 -->
      <section class="badj__block">
        <h3 class="badj__blockTitle">成品尺寸</h3>
        <p class="badj__blockSub">拖动改变做出来多大，图纸会按新尺寸重新取样。</p>

        <input
          class="badj__slider"
          type="range"
          min="0"
          :max="Math.max(0, tiers.length - 1)"
          step="1"
          v-model.number="tierIndex"
          :disabled="applying"
          aria-label="成品尺寸"
          @change="onSliderCommit"
        >
        <div class="badj__tierRow">
          <span v-for="(t, i) in tiers" :key="t.n" class="badj__tier" :class="{ on: i === tierIndex }">
            {{ t.name }}
          </span>
        </div>

        <dl class="badj__stats">
          <div><dt>成品大小</dt><dd>{{ preview.cm }}</dd></div>
          <div><dt>格子（列 × 行）</dt><dd>{{ preview.grid }}</dd></div>
          <div><dt>豆子数（约）</dt><dd>{{ preview.beads.toLocaleString() }}</dd></div>
          <div><dt>画板</dt><dd>{{ preview.boards }}</dd></div>
        </dl>

        <p v-if="tooSmall" class="badj__warn">
          <PixelIcon name="sparkles" :size="13" />
          比自动推荐的小，细节可能减少，建议放大尺寸
        </p>
        <p v-if="exact" class="badj__exact">
          精确值：
          <span class="badj__exSize">{{ exact.cm }} · {{ exact.grid }} 格 ·</span>
          {{ exact.beads.toLocaleString() }} 颗豆 ·
          {{ exact.colors }} 种颜色 ·
          {{ exact.boards }} 块板
        </p>
      </section>

      <!-- 颜色丰富程度 -->
      <section class="badj__block">
        <h3 class="badj__blockTitle">颜色丰富程度</h3>
        <p class="badj__blockSub">颜色越多越像原图，颜色越少越好拼、省豆子。</p>
        <div class="badj__rich">
          <button
            v-for="r in RICHNESS"
            :key="r.key"
            type="button"
            class="badj__richBtn"
            :class="{ on: richness === r.key }"
            :disabled="applying"
            @click="applyRichness(r.key)"
          >
            <b>{{ r.label }}</b>
            <small>{{ r.hint }}</small>
          </button>
        </div>
      </section>

      <div class="badj__acts">
        <button type="button" class="btn btn-secondary badj__actRevert" :disabled="applying" @click="revert">
          <PixelIcon name="undo" :size="14" />
          撤销这次调整
        </button>
        <button type="button" class="btn btn-secondary badj__actBack" @click="emit('back')">返回上一步</button>
        <button type="button" class="btn primary badj__actNext" :disabled="applying" @click="emit('next')">
          <PixelIcon name="arrowRight" :size="14" />
          下一步：获取图纸
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.badj{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}

/* ---- 预览 ---- */
.badj__stage{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px}
.badj__viewtabs{margin-bottom:12px}
.badj__canvasBox{
  background:var(--surface-3);border-radius:var(--r-md);padding:14px;
  min-height:300px;display:grid;place-items:center;
}
.badj__pane{display:grid;place-items:center;width:100%;min-height:270px}
.badj__pane :deep(canvas){max-width:100%;height:auto}
.badj__source{max-width:100%;max-height:320px;object-fit:contain;display:block}
.badj__split{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%}
.badj__empty{font-size:var(--fs-xs);color:var(--muted-2);text-align:center;padding:30px 10px}

/* 电脑与平板（≥781px）：预览图按比例撑满整块预览区。
   画布的行内尺寸是 prepareCanvas 写死的 px（1 格 = 1 CSS px），预览区本身很宽，
   图只占中间一小块、四周大片空白 —— 这里让画布按可用区域等比放大。
   · width/height 必须带 !important：行内样式优先级最高，压不住就等于没改。
   · 用「auto + max 约束」而不是 height:100%：画布的固有高度比容器高时，
     网格行的基准尺寸会被它顶住，height:100% 解析不出来、画布直接溢出容器。
   · 高度用 clamp 定死、网格行写成 minmax(0,1fr)：行高一旦由内容决定，
     里面的百分比（max-height:100%）就解析不出来。 */
@media(min-width:781px){
  .badj__stage{--preview-h:clamp(360px,60vh,660px)}
  .badj__canvasBox{grid-template-rows:minmax(0,1fr)}
  .badj__pane{height:100%;min-height:0;grid-template-rows:minmax(0,1fr)}
  .badj__pane--pattern{height:var(--preview-h)}
  .badj__pane--source{height:auto}
  .badj__pane :deep(canvas){
    width:auto !important;
    height:auto !important;
    max-width:100%;
    max-height:100%;
  }
  .badj__source{max-width:100%;max-height:var(--preview-h);object-fit:contain}
  .badj__split{height:var(--preview-h);grid-template-rows:minmax(0,1fr)}
  .badj__split .badj__pane{height:100%;min-height:0;grid-template-rows:minmax(0,1fr)}
  .badj__split .badj__source{max-height:100%}
}
.badj__busy{margin-top:10px;font-size:var(--fs-xs);color:var(--muted);text-align:center}

/* ---- 参数 ---- */
.badj__params{display:flex;flex-direction:column;gap:12px}
.badj__block{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px}
.badj__blockTitle{font-size:var(--fs-h3);margin-bottom:4px}
.badj__blockSub{font-size:var(--fs-2xs);color:var(--muted);margin-bottom:12px}

.badj__slider{width:100%;accent-color:var(--primary)}
.badj__tierRow{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.badj__tier{
  font-size:var(--fs-2xs);color:var(--muted);padding:3px 8px;border-radius:var(--r-pill);
  background:var(--surface-3);
}
.badj__tier.on{background:var(--primary-soft);color:var(--primary-ink);font-weight:800}

.badj__stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.badj__stats div{background:var(--surface-2);border-radius:var(--r-sm);padding:8px 10px}
.badj__stats dt{font-size:var(--fs-2xs);color:var(--muted)}
.badj__stats dd{margin:0;font-size:var(--fs-sm);font-weight:800}

.badj__warn{
  display:flex;align-items:center;gap:6px;margin-top:10px;
  font-size:var(--fs-xs);color:var(--warn);background:var(--warn-soft);
  border-radius:var(--r-sm);padding:8px 10px;
}
.badj__exact{margin-top:8px;font-size:var(--fs-2xs);color:var(--muted-2);line-height:1.6}

.badj__rich{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.badj__richBtn{
  border:1px solid var(--line);border-radius:var(--r-md);padding:9px 6px;background:var(--surface);
  display:flex;flex-direction:column;gap:2px;align-items:center;transition:var(--t);
}
.badj__richBtn b{font-size:var(--fs-sm)}
.badj__richBtn small{font-size:var(--fs-2xs);color:var(--muted-2);line-height:1.3}
.badj__richBtn.on{border-color:var(--primary);background:var(--primary-soft);box-shadow:0 0 0 2px rgba(255,214,46,.18)}
.badj__richBtn:disabled{opacity:.6}

.badj__acts{display:flex;flex-direction:column;gap:8px}
.badj__acts .btn{width:100%}

@media(max-width:1100px){
  .badj{grid-template-columns:1fr}
  .badj__acts{flex-direction:column}
}
@media(max-width:780px){
  /* ============================ 手机端：一屏 ============================
     画布区占满剩下的高度，参数压在画布下面（两块各自滚动，
     整页不会越滚越长）。 */
  .badj{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:8px}

  .badj__stage{
    /* 基准取 0：画布的行内尺寸（几百 px）会把这一格的基准尺寸顶高，
       基准一高，参数区就被挤到只剩一点点。
       画布优先：这一格有下限高度，参数区放不下就在它自己里面滚。

       下限 40dvh 是照着「专业版工作台手机端画布」量的：那一版画布在
       360×640 / 390×844 / 430×932 上分别是 186 / 260 / 338 px，
       而这一格 = 画布 + 预览框内边距 16 + 页签与间距 56，
       取 40dvh 后画布落在 184 / 266 / 301 px，跟专业版一个量级。 */
    flex:1 1 0;
    min-height:clamp(250px,40vh,430px);
    min-height:clamp(250px,40dvh,430px);
    display:flex;flex-direction:column;padding:10px;overflow:hidden;
  }
  .badj__viewtabs{flex:0 0 auto;margin-bottom:6px}
  .badj__viewtabs button{padding:5px 12px}
  .badj__canvasBox{
    flex:1 1 auto;min-height:0;max-height:none;padding:8px;overflow:hidden;
  }
  .badj__pane{
    display:flex;align-items:center;justify-content:center;
    width:100%;height:100%;min-height:0;
  }
  /* 画布按容器等比缩到刚好放得下：行内尺寸是写死的 px，
     width/height 必须 !important 才压得住（行内样式优先级最高）。 */
  .badj__pane :deep(canvas){
    width:auto !important;height:auto !important;
    max-width:100%;max-height:100%;
  }
  .badj__source{max-height:100%;max-width:100%}
  /* 对比视图：左右并排，各占一半宽（不再是上下堆叠） */
  .badj__split{grid-template-columns:1fr 1fr;gap:8px;height:100%;width:100%}
  .badj__split .badj__pane{height:100%;min-height:0}
  .badj__busy{flex:0 0 auto;margin-top:6px}

  /* 参数区：压紧，内容多的时候自己滚 */
  .badj__params{flex:0 1 auto;min-height:0;gap:8px;overflow-y:auto;overscroll-behavior:contain}
  .badj__block{padding:10px}
  .badj__blockTitle{font-size:var(--fs-sm);margin-bottom:2px}
  /* 说明文字在手机上是废话（滑块和档位自己会说话），省下的高度给画布 */
  .badj__blockSub{display:none}
  /* 档位排成一行，横着滑（竖着排会占两行，把画布挤掉一半） */
  .badj__tierRow{flex-wrap:nowrap;overflow-x:auto;margin-top:4px;padding-bottom:2px}
  .badj__tier{flex:0 0 auto}
  .badj__stats{grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
  /* 每格改成「标签 · 数值」一行：竖着排要多占一整行的高度，
     那行高度正好够画布长大几十像素。 */
  .badj__stats div{display:flex;align-items:baseline;gap:6px;padding:5px 8px}
  .badj__stats dt{font-size:10px;line-height:1.3;flex:0 0 auto}
  .badj__stats dd{font-size:var(--fs-2xs);line-height:1.35;flex:1 1 auto;text-align:right;min-width:0}
  .badj__warn{margin-top:8px;padding:6px 8px}
  .badj__exact{margin-top:6px;font-size:10px;line-height:1.4}
  /* 尺寸与格数上面那四格里已经有了，这行只留「真值」里多出来的三个数 */
  .badj__exSize{display:none}
  /* 三档颜色并排一行（竖着三行会把画布挤没了） */
  .badj__rich{grid-template-columns:repeat(3,1fr);gap:6px}
  .badj__richBtn{flex-direction:column;gap:1px;padding:7px 4px;text-align:center}
  .badj__richBtn small{font-size:10px;line-height:1.25}

  /* 「返回上一步 / 下一步」在手机底部的常驻条里，这里只留「撤销这次调整」 */
  .badj__acts{flex-direction:row}
  .badj__actBack,.badj__actNext{display:none}
  .badj__actRevert{width:100%;padding:6px 10px;font-size:var(--fs-2xs)}
}

/* 矮屏（360×640 这类）：画布按专业版画布的量级给了高度之后，
   参数区只剩几十 px。这里把参数区压到最紧 ——
   颜色三档的说明文字（按钮第二行）去掉、块间距与内边距各收 2~4px，
   省下的十几 px 正好让「颜色丰富程度」整块滚到底就能完整看见。 */
@media(max-width:780px) and (max-height:700px){
  /* 矮屏上画布让出 6px 给参数区：参数区刚好能整块容下「颜色丰富程度」，
     滚到底不用猜有没有被裁掉 */
  .badj__stage{min-height:calc(40vh - 6px);min-height:calc(40dvh - 6px)}
  .badj{gap:6px}
  .badj__params{gap:6px}
  .badj__block{padding:8px}
  .badj__richBtn{padding:6px 4px}
  .badj__richBtn small{display:none}
  .badj__actRevert{padding:4px 8px}
}
</style>
