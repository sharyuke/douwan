<script setup>
/* 导出弹窗（Figma 124:1628）：格式 / 范围 / 纸张 / 文件名 + 版式预览。
   图纸固定带上网格与坐标、色号标注、材料数量清单和作品信息，页面上不再勾选。
   三种格式都接真实导出链路：PDF 走分板图纸打印、PNG 走高分辨率图纸、CSV 走材料清单。 */
import { computed, nextTick, ref, watch } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import Icon from '../ui/Icon.vue'
import { pattern, stats, projectName, hasPattern, layout, brand, bead } from '../../composables/useStudio.js'
import { inventory } from '../../composables/useInventory.js'
import { boardLayout } from '../../lib/pattern.js'
import { drawBoard } from '../../lib/render.js'
import { exportBoardPdf, exportPatternPNGAtDpi, exportMaterialsCSV, patternSheetPlan } from '../../lib/exporters.js'
import { toastOk, toastWarn, toastResult } from '../../composables/useToast.js'
import BoardPreviewDialog from './BoardPreviewDialog.vue'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const FORMATS = [
  { key: 'pdf', label: 'PDF 图纸', desc: '适合打印' },
  { key: 'png', label: 'PNG 图片', desc: '适合分享' },
  { key: 'csv', label: 'CSV 清单', desc: '材料表格' }
]

const format = ref('pdf')
const range = ref('full')
const paper = ref('portrait')
const baseName = ref('')
const busy = ref(false)
const previewEl = ref(null)
const previewMsg = ref('')
const bigOpen = ref(false)
const bigIndex = ref(0)

const artW = computed(() => (pattern.value ? Math.min(pattern.value.artW || pattern.value.width, pattern.value.width) : 0))
const artH = computed(() => (pattern.value ? Math.min(pattern.value.artH || pattern.value.height, pattern.value.height) : 0))
const artOnly = computed(() => pattern.value && (artW.value !== pattern.value.width || artH.value !== pattern.value.height))
/* 右侧「第 n / N 页」按这次真正要导出的范围切板，不是永远拿整张画布的板数 */
const previewPattern = computed(() => targetPattern())
const previewBoards = computed(() => {
  const p = previewPattern.value
  if (!p) return []
  return boardLayout(p.width, p.height, p.boardSize || undefined).boards
})
const pageCount = computed(() => previewBoards.value.length || (layout.value ? layout.value.count : 1))
const meta = computed(() => {
  const p = pattern.value
  if (!p) return ''
  const s = stats.value
  return `${p.width} × ${p.height} 颗 · 底板 ${s ? s.boardCm : ''} · ${s ? s.colors : 0} 色 · ${brand.value ? brand.value.name : ''}`
})

const pngPlan = computed(() => {
  if (format.value !== 'png') return null
  const p = targetPattern()
  if (!p) return null
  const mm = bead.value && bead.value.mm ? bead.value.mm : 2.6
  const want = Math.max(1, Math.round((mm / 25.4) * 300))
  return patternSheetPlan(p, want, {
    ruler: true,
    codes: true,
    includeLegend: true,
    includeStats: true
  })
})
const rangeLabel = computed(() => {
  const p = pattern.value
  if (!p) return ''
  return range.value === 'art' ? `成品区域 · ${artW.value} × ${artH.value}` : `完整画布 · ${p.width} × ${p.height}`
})
const summary = computed(() => {
  if (format.value === 'pdf') return `PDF · ${rangeLabel.value} · ${pageCount.value} 页`
  if (format.value === 'png') {
    if (pngPlan.value && pngPlan.value.tiled) {
      return `PNG · ${rangeLabel.value} · ${pngPlan.value.count} 张，每张都有色号`
    }
    return `PNG · ${rangeLabel.value} · 1 个文件`
  }
  return 'CSV · 材料清单 · 1 个文件'
})

watch(() => props.modelValue, v => {
  if (!v) return
  baseName.value = projectName.value || ''
  nextTick(drawPreview)
})
watch([format, range, paper], () => { if (props.modelValue) nextTick(drawPreview) })

function targetPattern() {
  const p = pattern.value
  if (!p) return null
  if (range.value === 'full') return p
  const aw = artW.value, ah = artH.value
  if (aw === p.width && ah === p.height) return p
  const ox = Math.floor((p.width - aw) / 2)
  const oy = Math.floor((p.height - ah) / 2)
  const cells = new Int32Array(aw * ah)
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) cells[y * aw + x] = p.cells[(y + oy) * p.width + (x + ox)]
  }
  let beads = 0
  const used = new Set()
  for (const k of cells) {
    if (k < 0) continue
    beads += 1
    used.add(k)
  }
  return {
    ...p, width: aw, height: ah, cells,
    artW: aw, artH: ah,
    stats: { beadCount: beads, colorCount: used.size, emptyCount: cells.length - beads }
  }
}

function openBig() {
  bigIndex.value = 0
  bigOpen.value = true
}

/* 纸上只放得下第 1 页的缩略。整页大图在点击后的弹窗里，一页一块板。 */
function drawPreview() {
  const el = previewEl.value
  const p = previewPattern.value
  const b = previewBoards.value[0]
  if (!el || !p || !b) return
  try {
    const cell = Math.max(2, Math.min(12, Math.floor(220 / Math.max(b.w, b.h))))
    drawBoard(el, p, b, { cell, codes: false, ruler: true, grid: true })
    el.style.width = ''
    el.style.height = ''
    previewMsg.value = pageCount.value > 1
      ? `第 1 / ${pageCount.value} 页 · 点击预览大图`
      : `底板 ${stats.value ? stats.value.boardCm : ''} · 点击预览大图`
  } catch (e) {
    previewMsg.value = `预览生成失败：${e && e.message ? e.message : '浏览器不支持'}`
  }
}

async function run() {
  const p = targetPattern()
  if (!p || busy.value) return
  busy.value = true
  try {
    if (format.value === 'pdf') {
      const res = await exportBoardPdf(p, {
        projectName: baseName.value || projectName.value,
        orientation: paper.value,
        ruler: true,
        codes: true,
        grid: true,
        includeLegend: true,
        includeMaterials: true,
        inventoryMap: inventory.value
      })
      toastResult(res, '图纸已生成')
      if (res && res.ok) emit('update:modelValue', false)
    } else if (format.value === 'png') {
      const res = await exportPatternPNGAtDpi(p, {
        dpi: 300,
        projectName: baseName.value || projectName.value,
        ruler: true,
        codes: true,
        grid: true,
        includeLegend: true,
        includeStats: true
      })
      toastResult(res, '图纸已导出')
      if (res && res.ok) emit('update:modelValue', false)
    } else {
      exportMaterialsCSV(p, inventory.value, baseName.value || projectName.value)
      toastOk('材料清单已导出')
      emit('update:modelValue', false)
    }
  } catch (e) {
    toastWarn(e && e.message ? e.message : '导出失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue" title="导出" head-icon="download"
    dialog-class="cmdDlg" @update:model-value="v => emit('update:modelValue', v)"
  >
    <div v-if="!pattern" class="expEmpty">还没有生成图纸，先上传图片或选一个素材。</div>
    <div v-else class="exp">
      <div class="exp__form">
        <div class="exp__title">
          <b>{{ projectName }}</b>
          <span>{{ meta }}</span>
        </div>

        <p class="cmdLabel exp__block">导出格式</p>
        <div class="exp__formats">
          <button
            v-for="f in FORMATS" :key="f.key" type="button"
            class="expFmt" :class="{ on: format === f.key }" @click="format = f.key"
          >
            <i class="expFmt__radio" aria-hidden="true" />
            <b>{{ f.label }}</b>
            <span>{{ f.desc }}</span>
          </button>
        </div>

        <div class="exp__row">
          <label class="expField">
            <span>导出范围</span>
            <select v-model="range">
              <option value="full">完整画布 · {{ pattern.width }} × {{ pattern.height }}</option>
              <option v-if="artOnly" value="art">成品区域 · {{ artW }} × {{ artH }}</option>
            </select>
            <Icon name="chevron-down" :size="16" />
          </label>
          <label v-if="format === 'pdf'" class="expField">
            <span>纸张</span>
            <select v-model="paper">
              <option value="portrait">A4 · 纵向</option>
              <option value="landscape">A4 · 横向</option>
            </select>
            <Icon name="chevron-down" :size="16" />
          </label>
        </div>

        <input
          v-model="baseName" class="expName" type="text" maxlength="40"
          aria-label="文件名" :placeholder="projectName || '豆玩图纸'"
        >

        <div class="cmdHint">
          <Icon name="info" :size="16" />
          <span>{{ hasPattern ? '导出内容按当前画布与所选格式生成，修改画布后重新导出即可。' : '当前画布为空，将导出空白网格图纸；绘制后可导出作品及材料清单。' }}</span>
        </div>
      </div>

      <div class="exp__side">
        <div class="expPreview">
          <div class="expPreview__head">
            <span>图纸预览</span>
            <span>A4 · 第 1 / {{ pageCount }} 页</span>
          </div>
          <div class="expPreview__page">
            <div class="expPreview__paper">
              <div class="expPreview__pageHead">
                <b>{{ projectName }}</b>
                <span>{{ pattern.width }} × {{ pattern.height }} 颗 · {{ brand ? brand.name : '' }}</span>
              </div>
              <button type="button" class="expPreview__art" aria-label="预览大图" @click="openBig">
                <canvas ref="previewEl" />
                <span class="expPreview__zoom" aria-hidden="true"><Icon name="zoom-in" :size="16" /></span>
              </button>
              <span class="expPreview__note">布局示意 · 非作品成品图</span>
            </div>
          </div>
          <p class="expPreview__cap">{{ previewMsg }}</p>
        </div>
      </div>
    </div>

    <BoardPreviewDialog
      v-if="pattern"
      v-model="bigOpen"
      :boards="previewBoards"
      :index="bigIndex"
      :pattern-source="previewPattern"
      :show-codes="true"
      @update:index="v => bigIndex = v"
    />

    <template #footer="{ close }">
      <span class="cmdFoot__note"><span>{{ summary }}</span></span>
      <div class="cmdFoot__actions">
        <button type="button" class="btn btn-secondary" @click="close">取消</button>
        <button type="button" class="btn primary" :disabled="!pattern || busy" @click="run">
          <Icon name="download" :size="16" />{{ hasPattern ? '导出图纸' : '导出空白图纸' }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.exp{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.exp__title{display:flex;flex-direction:column;gap:4px;margin-bottom:16px}
.exp__title b{font-size:var(--fs-md);font-weight:700;color:var(--ink);line-height:var(--ty-card-lh)}
.exp__title span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.exp__block{margin:16px 0 8px}
.exp__formats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.expFmt{
  position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:3px;
  padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);
  text-align:left;transition:var(--t);
}
.expFmt:hover{border-color:var(--line-strong)}
.expFmt.on{border-color:var(--primary-deep);background:#FBFDF1;box-shadow:0 0 0 1px var(--primary-deep) inset}
.expFmt b{font-size:var(--fs-sm);font-weight:700;color:var(--ink);line-height:var(--ty-body-lh)}
.expFmt span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.expFmt__radio{
  position:absolute;right:10px;top:10px;width:14px;height:14px;border-radius:50%;
  border:1.5px solid var(--line-strong);background:#fff;
}
.expFmt.on .expFmt__radio{border-color:var(--primary-deep);box-shadow:inset 0 0 0 3px var(--primary-deep)}
.exp__row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
.expField{position:relative;display:flex;flex-direction:column;gap:6px}
.expField>span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.expField select{
  height:38px;padding:0 30px 0 12px;border:1px solid var(--line);border-radius:12px;
  background:var(--surface);font:inherit;font-size:var(--fs-sm);color:var(--ink);
  appearance:none;outline:none;cursor:pointer;line-height:var(--ty-body-lh)
}
.expField .pixelIcon{position:absolute;right:10px;bottom:13px;pointer-events:none}
.expName{
  width:100%;height:38px;margin-top:14px;padding:0 12px;
  border:1px solid var(--line);border-radius:12px;background:var(--surface);
  font:inherit;font-size:var(--fs-sm);color:var(--ink);outline:none;line-height:var(--ty-body-lh)
}
.expName:focus{border-color:var(--primary-deep)}
.exp .cmdHint{margin-top:14px}
.exp__side{display:flex;flex-direction:column}
.expPreview{display:flex;flex-direction:column;gap:8px;height:100%}
.expPreview__head{display:flex;align-items:center;justify-content:space-between;font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.expPreview__page{
  flex:1;min-height:0;display:flex;align-items:stretch;justify-content:center;
  padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);
}
.expPreview__paper{
  flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;
  padding:14px;background:#fff;border-radius:4px;box-shadow:0 1px 4px rgba(31,31,29,.08);
}
.expPreview__pageHead{display:flex;flex-direction:column;gap:2px;width:100%}
.expPreview__pageHead b{font-size:var(--fs-xs);font-weight:700;color:var(--ink);line-height:var(--ty-label-lh)}
.expPreview__pageHead span{font-size:12px;color:var(--muted);line-height:var(--ty-caption-lh)}
.expPreview__art{
  position:relative;flex:1;min-height:0;display:grid;place-items:center;
  border:0;padding:0;background:transparent;cursor:zoom-in
}
.expPreview__art canvas{max-width:100%;max-height:100%;width:auto;height:auto;border-radius:2px}
.expPreview__zoom{
  position:absolute;right:8px;bottom:8px;width:28px;height:28px;border-radius:50%;
  display:grid;place-items:center;background:rgba(27,27,31,.72);color:#fff;pointer-events:none
}
.expPreview__art:hover .expPreview__zoom{background:var(--ink)}
.expPreview__note{font-size:12px;color:var(--muted-2);line-height:var(--ty-caption-lh)}
.expPreview__cap{font-size:var(--fs-xs);color:var(--muted);text-align:center;margin:0;line-height:var(--ty-label-lh)}
.expEmpty{padding:40px 0;text-align:center;color:var(--muted);font-size:var(--fs-sm);line-height:var(--ty-body-lh)}
@media(max-width:780px){
  .exp{grid-template-columns:1fr;gap:18px}
  .expPreview__page{min-height:180px}
  .expPreview__art canvas{max-height:170px}
}
</style>
