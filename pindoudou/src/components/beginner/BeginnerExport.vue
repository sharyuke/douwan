<script setup>
/* =========================================================================
   新手版 · 第 ③ 步：获取图纸
   -------------------------------------------------------------------------
   主 CTA「下载拼豆图纸」调的是**现有导出链路**（lib/exporters.js）：
   编号图纸 PNG 带行列坐标与色号，材料清单 CSV 带每种颜色的颗数与缺货数，
   打印版按分板分页。导出的内容与工作台、材料页完全一致 ——
   新手版只是把入口做得更少更清楚，没有另做一套导出。

   展示的数据分两类，界面上分开写：
   · 实时精确数：成品尺寸、颜色种类、有效豆数、画板数量（都来自当前图纸）
   · 估算值：只有第 ② 步拖动滑块的那一瞬间是估算，那里已单独标注

   2026-10-26 手机端一屏改造：材料清单在页面上只留摘要 + 前几项，
   全部明细放进底部抽屉（可搜索、可滚动）；下载主按钮在底部常驻条上。
   ========================================================================= */
import { computed, ref } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import PatternPreview from '../ui/PatternPreview.vue'
import {
  hasPattern, materials, options, pattern, projectName, stats
} from '../../composables/useStudio.js'
import { inventory } from '../../composables/useInventory.js'
import { exportMaterialsCSV, exportPatternPNG, printPattern } from '../../lib/exporters.js'
import { toastResult } from '../../composables/useToast.js'

const emit = defineEmits(['back', 'pro'])

const exporting = ref('')
const err = ref('')

const st = computed(() => stats.value)

/** 材料清单：色号 · 名称 · 需要多少颗（缺口只在库存页 / 材料清单 CSV 里看） */
const rows = computed(() => (materials.value ? materials.value.rows : []))
const shownRows = computed(() => rows.value.slice(0, 12))
const moreRows = computed(() => Math.max(0, rows.value.length - shownRows.value.length))

/* ---------------------------------------------------------------- 材料抽屉
   手机上材料明细有几十行，全铺在页面上会把这一屏挤爆 ——
   页面上留摘要 + 前几项，全部明细放进底部抽屉（能搜、能滚、关掉不丢状态）。 */
const drawerOpen = ref(false)
const matKw = ref('')

const drawerRows = computed(() => {
  const key = matKw.value.trim().toLowerCase()
  if (!key) return rows.value
  return rows.value.filter(r =>
    String(r.label || '').toLowerCase().includes(key) ||
    String(r.code || '').toLowerCase().includes(key) ||
    String(r.name || '').toLowerCase().includes(key)
  )
})

function downloadPNG() {
  if (!pattern.value || exporting.value) return
  exporting.value = 'png'
  err.value = ''
  try {
    const res = exportPatternPNG(pattern.value, {
      projectName: projectName.value || '我的拼豆作品',
      cell: 22,
      codes: true,
      /* 统一导出标版：与专业工作台「图纸交付」同一版式
         （页眉 Logo + 网址、图案信息、颜色清单、页脚 Slogan） */
      includeLegend: true,
      includeStats: true
    })
    if (res && res.ok === false) err.value = res.message || '导出失败，请重试'
    toastResult(res, '图纸已开始下载')
  } catch (e) {
    err.value = e instanceof Error ? e.message : '导出失败，请重试'
  } finally {
    exporting.value = ''
  }
}

function downloadCSV() {
  if (!pattern.value) return
  try {
    exportMaterialsCSV(pattern.value, inventory.value, projectName.value || '我的拼豆作品')
    toastResult({ ok: true }, '材料清单已开始下载')
  } catch (e) {
    err.value = e instanceof Error ? e.message : '材料清单导出失败，请重试'
  }
}

function printPdf() {
  if (!pattern.value) return
  const res = printPattern(pattern.value, {
    projectName: projectName.value || '我的拼豆作品',
    inventoryMap: inventory.value,
    stats: pattern.value.stats
  })
  toastResult(res, '已打开打印视图')
}

/* 手机端底部固定 CTA 调用的是同一个下载函数（两处参数不一致的话，
   用户会拿到不一样的图）。 */
defineExpose({ downloadPNG })
</script>

<template>
  <div class="bexp">
    <!-- ---------------------------------------------------------- 成果预览 -->
    <div class="bexp__stage">
      <div class="bexp__art">
        <PatternPreview v-if="pattern" :pattern="pattern" :max-size="640" alt="拼豆图纸预览" />
        <p v-else class="bexp__empty">还没有图纸</p>
      </div>

      <div class="bexp__facts">
        <div class="bexp__fact"><span>成品尺寸</span><b>{{ st ? st.cm : '—' }}</b></div>
        <div class="bexp__fact"><span>格子（列 × 行）</span><b>{{ st ? st.artSize : '—' }}</b></div>
        <div class="bexp__fact"><span>颜色种类</span><b>{{ st ? st.colors : '—' }}</b></div>
        <div class="bexp__fact"><span>总豆数</span><b>{{ st ? st.total.toLocaleString() : '—' }}</b></div>
        <div class="bexp__fact"><span>画板数量</span><b>{{ st ? `${st.boards} 块` : '—' }}</b></div>
        <div class="bexp__fact"><span>豆子规格</span><b>{{ st ? st.beadLabel : '—' }}</b></div>
      </div>
      <p v-if="st && st.boardText" class="bexp__boardNote">{{ st.boardText }}</p>
    </div>

    <!-- ---------------------------------------------------------- 材料清单 -->
    <div class="bexp__side">
      <section class="bexp__block">
        <div class="bexp__blockHead">
          <h3 class="bexp__blockTitle">材料清单</h3>
          <button type="button" class="btn btn-secondary bexp__allBtn" @click="drawerOpen = true">
            查看全部 {{ rows.length }} 种
          </button>
        </div>
        <p class="bexp__blockSub">
          共 {{ rows.length }} 种颜色、{{ st ? st.total.toLocaleString() : 0 }} 颗豆子
        </p>
        <ul class="bexp__list">
          <li v-for="r in shownRows" :key="r.id">
            <i class="bexp__chip" :style="{ background: r.hex }"></i>
            <span class="bexp__code">{{ r.label }}</span>
            <span class="bexp__count">{{ r.count.toLocaleString() }} 颗</span>
          </li>
        </ul>
        <p v-if="moreRows" class="bexp__more">还有 {{ moreRows }} 种颜色，下载材料清单看全部</p>
      </section>

      <section class="bexp__block">
        <h3 class="bexp__blockTitle">下载</h3>
        <p v-if="err" class="bexp__err">{{ err }}</p>
        <button type="button" class="btn primary bexp__cta" :disabled="exporting === 'png'" @click="downloadPNG">
          <PixelIcon name="download" :size="16" />
          {{ exporting === 'png' ? '正在生成图纸…' : '下载拼豆图纸' }}
        </button>
        <div class="bexp__row">
          <button type="button" class="btn btn-secondary" @click="printPdf">打印 / 存 PDF</button>
          <button type="button" class="btn btn-secondary" @click="downloadCSV">材料清单 CSV</button>
        </div>
        <p class="bexp__hint">图纸带豆玩统一标版：页眉 Logo 与网址、材料清单、页脚 Slogan；行列坐标与每格色号齐全。</p>
      </section>

      <div class="bexp__acts">
        <button type="button" class="btn btn-secondary" @click="emit('back')">返回上一步调整</button>
        <button type="button" class="btn primary" @click="emit('pro')">
          <PixelIcon name="fn-original-mode" :size="16" />
          进入专业模式继续编辑
        </button>
      </div>
    </div>

    <!-- ---------------------------------------------------------- 材料清单抽屉 -->
    <BaseDialog v-model="drawerOpen" title="材料清单" sheet>
      <label class="bexp__search">
        <PixelIcon name="search" :size="15" />
        <input v-model="matKw" type="search" placeholder="搜索色号或名称…" aria-label="搜索材料清单">
      </label>
      <p class="bexp__blockSub">
        共 {{ rows.length }} 种颜色、{{ st ? st.total.toLocaleString() : 0 }} 颗豆子
        <template v-if="matKw">（筛出 {{ drawerRows.length }} 种）</template>
      </p>
      <ul class="bexp__list bexp__list--drawer">
        <li v-for="r in drawerRows" :key="r.id">
          <i class="bexp__chip" :style="{ background: r.hex }"></i>
          <span class="bexp__code">{{ r.label }}</span>
          <span class="bexp__count">{{ r.count.toLocaleString() }} 颗</span>
        </li>
        <li v-if="!drawerRows.length" class="bexp__none">没有找到匹配的颜色</li>
      </ul>
    </BaseDialog>
  </div>
</template>

<style scoped>
.bexp{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:20px;align-items:start}

.bexp__stage{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:16px}
.bexp__art{
  background:var(--surface-3);border-radius:var(--r-md);padding:14px;
  min-height:280px;display:grid;place-items:center;margin-bottom:14px;
}
.bexp__art :deep(canvas){max-width:100%;height:auto}
.bexp__empty{font-size:var(--fs-xs);color:var(--muted-2);padding:30px 0}
.bexp__facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.bexp__fact{background:var(--surface-2);border-radius:var(--r-sm);padding:9px 11px}
.bexp__fact span{display:block;font-size:var(--fs-2xs);color:var(--muted)}
.bexp__fact b{font-size:var(--fs-sm);font-weight:800}
.bexp__boardNote{margin-top:10px;font-size:var(--fs-2xs);color:var(--muted-2)}

.bexp__side{display:flex;flex-direction:column;gap:12px}
.bexp__block{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px}
.bexp__blockTitle{font-size:var(--fs-h3);margin-bottom:4px}
.bexp__blockSub{font-size:var(--fs-2xs);color:var(--muted);margin-bottom:10px}
/* 标题行：手机上「查看全部」放在这一行，明细再长也点得到 */
.bexp__blockHead{display:flex;align-items:center;justify-content:space-between;gap:10px}

.bexp__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
.bexp__list li{display:flex;align-items:center;gap:8px;font-size:var(--fs-xs)}
.bexp__chip{width:14px;height:14px;border-radius:4px;border:1px solid rgba(0,0,0,.12);flex:0 0 auto}
.bexp__code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.bexp__count{color:var(--ink-2)}
.bexp__more{margin-top:8px;font-size:var(--fs-2xs);color:var(--muted-2)}
.bexp__none{color:var(--muted-2);justify-content:center;padding:10px 0}

/* 「查看全部」只给手机用：桌面上的清单本来就是完整可滚的 */
.bexp__allBtn{display:none;width:auto;margin:0;padding:5px 10px;font-size:var(--fs-2xs)}

/* 材料抽屉里的搜索框 */
.bexp__search{
  display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;margin-bottom:10px;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);
}
.bexp__search input{flex:1;min-width:0;border:0;background:transparent;outline:none;font-size:var(--fs-sm)}
.bexp__list--drawer{max-height:none}

.bexp__cta{width:100%;margin-bottom:8px}
.bexp__row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.bexp__row .btn{width:100%}
.bexp__hint{margin-top:8px;font-size:var(--fs-2xs);color:var(--muted-2);line-height:1.6}
.bexp__err{font-size:var(--fs-xs);color:var(--danger);background:var(--danger-soft);border-radius:var(--r-sm);padding:8px 10px;margin-bottom:8px}

.bexp__acts{display:flex;flex-direction:column;gap:8px}
.bexp__acts .btn{width:100%}

/* 电脑与平板（≥781px）：成果预览按比例撑满整块预览框。
   画布的行内尺寸是 prepareCanvas 写死的 px（1 格 = 1 CSS px），
   预览框本身很宽，图只占中间一小块 —— 这里让画布按可用区域等比放大。
   · width/height 必须带 !important：行内样式优先级最高，压不住就等于没改。
   · 用「auto + max 约束」而不是 height:100%：画布的固有高度比容器高时，
     网格行的基准尺寸会被它顶住，height:100% 解析不出来、画布直接溢出容器。
   · 高度用 clamp 定死、网格行写成 minmax(0,1fr)：行高一旦由内容决定，
     里面的百分比（max-height:100%）就解析不出来。 */
@media(min-width:781px){
  .bexp__art{
    height:clamp(360px,60vh,660px);
    min-height:0;
    grid-template-rows:minmax(0,1fr);
  }
  .bexp__art :deep(canvas){
    width:auto !important;
    height:auto !important;
    max-width:100%;
    max-height:100%;
  }
}

@media(max-width:1100px){
  .bexp{grid-template-columns:1fr}
  .bexp__facts{grid-template-columns:repeat(2,minmax(0,1fr))}
}

/* ============================ 手机端：一屏 ============================ */
@media(max-width:780px){
  .bexp{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:8px}

  /* 预览 + 摘要：预览给一个固定的高度带（自适应，不抢参数区的位置） */
  .bexp__stage{
    flex:0 0 auto;display:flex;flex-direction:column;padding:10px;
  }
  /* 用 flex 不用 grid：grid 的行高是「按内容算」的，画布的行内高度（几百 px）
     会把行顶高、画布直接溢出这个固定高度的盒子；flex 里 max-height:100%
     才解析得出容器高度。 */
  .bexp__art{
    height:clamp(110px,24vh,210px);min-height:0;max-height:none;padding:8px;margin-bottom:8px;
    display:flex;align-items:center;justify-content:center;
  }
  .bexp__art :deep(canvas){
    width:auto !important;height:auto !important;max-width:100%;max-height:100%;
  }
  /* 摘要：2 列紧凑卡，六个字段一个都不少 */
  .bexp__facts{flex:0 0 auto;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .bexp__fact{padding:6px 8px}
  .bexp__fact span{font-size:10px}
  .bexp__fact b{font-size:var(--fs-xs)}
  .bexp__boardNote{flex:0 0 auto;margin-top:6px;font-size:11px}

  /* 下面的清单 / 下载 / 操作：内容多就在这一块里滚，页面本身不动 */
  .bexp__side{flex:1 1 auto;min-height:0;gap:8px;overflow-y:auto;overscroll-behavior:contain}
  .bexp__block{padding:10px;border-radius:var(--r-md)}
  .bexp__blockTitle{font-size:var(--fs-sm);margin-bottom:0}
  .bexp__blockSub{margin-bottom:6px}
  .bexp__list{max-height:132px;gap:4px}
  .bexp__list li{font-size:var(--fs-2xs);gap:6px}
  .bexp__more{display:none}
  .bexp__allBtn{display:block}

  /* 下载主按钮在底部常驻条上，页面上就不重复一个了 */
  .bexp__cta{display:none}
  .bexp__row .btn{font-size:var(--fs-2xs);padding:8px 6px}
  .bexp__hint{display:none}
  .bexp__acts .btn{font-size:var(--fs-xs);padding:9px 8px}
}
</style>
