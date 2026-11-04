<script setup>
/* =========================================================================
   换色弹窗：把图纸上某一种颜色整批换成同系列的另一个色号。

   入口在右栏「颜色用量」每行末尾的换色按钮。打开后：
   - 同系列（当前作品用的那套色板）全部色号按 A→Z 排列成矩阵，带色号标注；
   - 顶部可按色号 / 颜色名搜索；
   - 「自动选相近色」按 CIEDE2000 挑肉眼最接近的色号（缺豆时用）；
   - 点任何色号，画布立刻实时预览替换效果；点「替换」才真正确认，
     整次替换是一步可撤销历史；关掉弹窗（X / Esc / 遮罩 / 取消）整体回滚。
   预览与提交的机制都在 useStudio（colorReplace / previewColorReplace 等），
   这里只负责展示与选择。
   ========================================================================= */
import { computed, ref } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import {
  pattern, availableColors, colorReplace, colorReplaceCount,
  previewColorReplace, confirmColorReplace, cancelColorReplace
} from '../../composables/useStudio.js'
import { deltaE2000 } from '../../lib/color.js'
import { toastOk } from '../../composables/useToast.js'

const query = ref('')
const open = computed(() => !!colorReplace.value)

/* 弹窗的关闭动作（X / Esc / 遮罩）一律按取消处理：画面回到打开前 */
function onToggle(v) {
  if (!v) cancelColorReplace()
}

/** 被替换的源颜色（弹窗打开时一定存在） */
const source = computed(() => {
  const st = colorReplace.value
  if (!st) return null
  const p = pattern.value
  return (p && p.palette.find(c => c.id === st.fromId)) || null
})

/** 色号自然序：字母段升序、数字段按数值升序（A2 在 A10 前，与导出清单同一习惯） */
function compareCode(a, b) {
  const sa = String(a.code || '')
  const sb = String(b.code || '')
  const ma = sa.match(/^([A-Za-z]+)(\d*)$/)
  const mb = sb.match(/^([A-Za-z]+)(\d*)$/)
  if (ma && mb) {
    const la = ma[1].toLowerCase()
    const lb = mb[1].toLowerCase()
    if (la !== lb) return la < lb ? -1 : 1
    const na = Number(ma[2] || 0)
    const nb = Number(mb[2] || 0)
    if (na !== nb) return na - nb
  }
  return sa.localeCompare(sb, undefined, { numeric: true })
}

/** 同系列全部候选色号（当前作品色板体系），去掉源色自己 */
const series = computed(() => {
  const st = colorReplace.value
  if (!st) return []
  return availableColors.value
    .filter(c => c.id !== st.fromId)
    .slice()
    .sort(compareCode)
})

/** 图纸里已经用到的色号：格子上标个小圆点，找起来更快 */
const usedIds = computed(() => {
  const p = pattern.value
  const set = new Set()
  if (p && p.palette) for (const c of p.palette) set.add(c.id)
  return set
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return series.value
  return series.value.filter(c =>
    String(c.code || '').toLowerCase().includes(q) ||
    String(c.name || '').toLowerCase().includes(q))
})

const target = computed(() => {
  const st = colorReplace.value
  if (!st || !st.toId) return null
  return series.value.find(c => c.id === st.toId) || null
})

/** 选中的目标色与源色的 CIEDE2000 色差（和引擎选色同一口径） */
const targetDE = computed(() => {
  const s = source.value
  const t = target.value
  return s && t && s.lab && t.lab ? deltaE2000(s.lab, t.lab) : null
})

const deHint = computed(() => {
  const d = targetDE.value
  if (d == null) return ''
  if (d < 2) return '肉眼几乎看不出差别'
  if (d < 6) return '同一色系的相邻色号，很接近'
  if (d < 12) return '有可见色差，先看预览再确认'
  return '色差较大，确认前请仔细看预览'
})

/** 自动选相近色：在全系列里挑 ΔE00 最小的那个（买不到原色号时的兜底） */
function autoPick() {
  const s = source.value
  if (!s || !s.lab) return
  let best = null
  let bd = Infinity
  for (const c of series.value) {
    if (!c.lab) continue
    const d = deltaE2000(s.lab, c.lab)
    if (d < bd) { bd = d; best = c }
  }
  if (best) previewColorReplace(best)
}

function onConfirm() {
  const n = confirmColorReplace()
  if (n > 0) toastOk(`已把 ${n.toLocaleString()} 颗豆换成 ${target.value ? target.value.code : '新色号'}，可撤销`)
}
</script>

<template>
  <BaseDialog :model-value="open" title="换色" size="lg" @update:model-value="onToggle">
    <div v-if="source" class="cr">
      <div class="crHead">
        <i class="crSwatch" :style="{ background: source.hex }"></i>
        <div class="crHeadText">
          <b>把 <span class="crCode">{{ source.code }}</span> 全部换成…</b>
          <p class="hint">
            同系列色号按 A→Z 排列 · 点色号即时预览，点「替换」才确认
          </p>
        </div>
        <button class="btn soft sm crAuto" type="button" title="按色差挑最接近的色号" @click="autoPick">
          <PixelIcon name="sparkles" :size="13" />自动选相近色
        </button>
      </div>

      <label class="crSearch">
        <PixelIcon name="search" :size="14" />
        <input
          v-model="query"
          type="search"
          placeholder="搜索色号或颜色名，如 A2 / 奶白"
          aria-label="搜索色号"
        >
      </label>

      <div class="crGrid" role="listbox" aria-label="同系列色号列表">
        <button
          v-for="c in filtered" :key="c.id"
          type="button" class="crCell" role="option"
          :aria-selected="c.id === colorReplace.toId"
          :class="{ on: c.id === colorReplace.toId, used: usedIds.has(c.id) }"
          :title="`${c.code}${c.name && c.name !== c.code ? ' ' + c.name : ''}${usedIds.has(c.id) ? ' · 图纸上在用' : ''}`"
          @click="previewColorReplace(c)"
        >
          <i :style="{ background: c.hex }"></i>
          <span>{{ c.code }}</span>
        </button>
        <p v-if="!filtered.length" class="hint" style="padding:14px">
          没有匹配「{{ query }}」的色号。
        </p>
      </div>

      <p v-if="target" class="crTarget">
        已选 <b><i :style="{ background: target.hex }"></i>{{ target.code }}{{ target.name && target.name !== target.code ? ' ' + target.name : '' }}</b>
        <span v-if="targetDE != null">· ΔE {{ targetDE.toFixed(1) }}，{{ deHint }}</span>
        <span class="crTargetCount">预览中：{{ colorReplaceCount.toLocaleString() }} 颗豆将替换</span>
      </p>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="cancelColorReplace">取消</button>
      <button
        class="btn primary" :disabled="!colorReplaceCount"
        @click="onConfirm"
      >替换（{{ colorReplaceCount.toLocaleString() }} 颗）</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.crHead{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
.crSwatch{
  width:34px;height:34px;flex:none;border-radius:10px;
  border:1px solid var(--line-strong);box-shadow:inset 0 0 0 2px rgba(255,255,255,.65);
}
.crHeadText{min-width:0;flex:1}
.crHeadText b{font-size:var(--fs-sm);line-height:var(--ty-body-lh)}
.crHeadText .hint{margin:2px 0 0}
.crCode{font-weight:700}
.crAuto{flex:none}

.crSearch{
  display:flex;align-items:center;gap:7px;margin:11px 0 9px;padding:0 11px;
  height:36px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2);
  color:var(--muted);
}
.crSearch input{
  flex:1;min-width:0;border:0;outline:0;background:transparent;
  font-size:var(--fs-xs);color:var(--ink);line-height:var(--ty-label-lh)
}
.crSearch:focus-within{border-color:var(--pink);background:var(--surface)}

.crGrid{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:7px;
  max-height:min(50vh,430px);overflow:auto;padding:2px;
}
.crCell{
  display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 4px 6px;
  border:1.5px solid var(--line);border-radius:var(--r-sm);background:var(--surface);
  cursor:pointer;transition:var(--t);position:relative;
}
.crCell i{
  width:100%;aspect-ratio:2/1;border-radius:6px;display:block;
  border:1px solid rgba(0,0,0,.12);
}
.crCell span{font-size:var(--fs-2xs);font-weight:700;color:var(--ink-2);font-variant-numeric:tabular-nums;line-height:var(--ty-caption-lh)}
.crCell:hover{border-color:var(--line-strong);background:#FFFCF7}
.crCell.on{border-color:var(--primary);background:var(--primary-soft)}
.crCell.on span{color:var(--primary-ink)}
/* 图纸上正在用的色号：左上角一颗小圆点 */
.crCell.used::after{
  content:'';position:absolute;top:5px;left:5px;width:6px;height:6px;border-radius:50%;
  background:var(--primary);opacity:.85;
}

.crTarget{
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  margin:10px 0 0;padding:9px 11px;border-radius:var(--r-sm);
  background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-2xs);color:var(--ink-2);line-height:var(--ty-caption-lh)
}
.crTarget b{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-xs);line-height:var(--ty-label-lh)}
.crTarget b i{width:15px;height:15px;border-radius:4px;border:1px solid rgba(0,0,0,.12)}
.crTargetCount{margin-left:auto;font-weight:700;color:var(--primary-deep)}

@media(max-width:780px){
  .crGrid{grid-template-columns:repeat(auto-fill,minmax(60px,1fr));max-height:46vh}
  .crHeadText b{font-size:var(--fs-xs);line-height:var(--ty-label-lh)}
}
</style>
