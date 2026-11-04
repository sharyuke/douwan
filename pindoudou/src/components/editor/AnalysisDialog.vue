<script setup>
/* 作品分析弹窗（Figma 124:1365）：用量总览 + 用色分布 + 材料明细。
   数字全部来自当前图纸（useStudio 的 stats / materials），没有占位值。 */
import { computed } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import Icon from '../ui/Icon.vue'
import { pattern, stats, materials, projectName, brand } from '../../composables/useStudio.js'
import { inventory } from '../../composables/useInventory.js'
import { exportMaterialsCSV } from '../../lib/exporters.js'
import { toastOk } from '../../composables/useToast.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const rows = computed(() => (materials.value ? materials.value.rows : []))
const total = computed(() => rows.value.reduce((s, r) => s + r.count, 0))
const restock = computed(() => Math.ceil(total.value * 1.1))

const segments = computed(() => {
  const list = rows.value.slice(0, 4)
  const used = list.reduce((s, r) => s + r.count, 0)
  const rest = Math.max(0, total.value - used)
  const out = list.map(r => ({ ...r, pct: total.value ? (r.count / total.value) * 100 : 0 }))
  if (rest > 0) out.push({ id: '__rest', code: `其余 ${rows.value.length - list.length} 色`, hex: '#D9D9CF', count: rest, pct: total.value ? (rest / total.value) * 100 : 0 })
  return out
})

const halves = computed(() => {
  const mid = Math.ceil(rows.value.length / 2)
  return [rows.value.slice(0, mid), rows.value.slice(mid)]
})

function pct(n) {
  if (!total.value) return '0%'
  const v = (n / total.value) * 100
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`
}

function exportList() {
  if (!pattern.value) return
  exportMaterialsCSV(pattern.value, inventory.value, projectName.value)
  toastOk('材料清单已导出')
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue" title="作品分析" head-icon="fn-analytics"
    dialog-class="cmdDlg" @update:model-value="v => emit('update:modelValue', v)"
  >
    <div v-if="!pattern || !stats" class="anaEmpty">还没有生成图纸，先上传图片或选一个素材。</div>
    <div v-else class="ana">
      <div class="ana__title">
        <b>{{ projectName }}</b>
        <span>{{ pattern.width }} × {{ pattern.height }} 颗 · 底板 {{ stats.boardCm }} · {{ stats.colors }} 色 · {{ brand.name }}</span>
      </div>
      <div class="cmdHint">
        <Icon name="info" :size="16" />
        <span>用量按当前图纸统计；备用量为总用量 + 10%，不计入下方明细。</span>
      </div>

      <div class="anaStats">
        <div class="anaStat">
          <span>拼豆总量</span>
          <b>{{ stats.total.toLocaleString() }} <em>颗</em></b>
          <small>不含备用损耗</small>
        </div>
        <div class="anaStat">
          <span>作品配色</span>
          <b>{{ stats.colors }} <em>色</em></b>
          <small>{{ brand.name }}</small>
        </div>
        <div class="anaStat">
          <span>画布规格</span>
          <b>{{ pattern.width }} × {{ pattern.height }}</b>
          <small>底板 {{ stats.boardCm }}</small>
        </div>
        <div class="anaStat">
          <span>建议备料</span>
          <b>{{ restock.toLocaleString() }} <em>颗</em></b>
          <small>总用量 + 10% 备用</small>
        </div>
      </div>

      <div class="ana__labelRow">
        <span class="cmdLabel">用色分布</span>
        <span class="ana__muted">按用量</span>
      </div>
      <div class="anaBar">
        <i v-for="s in segments" :key="s.id" :style="{ background: s.hex, flexGrow: Math.max(s.pct, 0.6) }" />
      </div>
      <div class="anaLegend">
        <span v-for="s in segments" :key="s.id">
          <i :style="{ background: s.hex }" />{{ s.code }} {{ pct(s.count) }}
        </span>
      </div>

      <div class="ana__labelRow">
        <span class="cmdLabel">材料数量明细</span>
        <span class="ana__muted">{{ rows.length }} 色 · 单位：颗</span>
      </div>
      <div class="anaTable">
        <table v-for="(half, hi) in halves" :key="hi">
          <thead>
            <tr><th>色号</th><th>数量 / 颗</th><th>占比</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in half" :key="r.id">
              <td><i :style="{ background: r.hex }" />{{ r.code }}</td>
              <td>{{ r.count.toLocaleString() }}</td>
              <td>{{ pct(r.count) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="ana__foot">合计 {{ total.toLocaleString() }} 颗 · 采购前请以实体色卡为准，备用量不计入上方明细。</p>
    </div>

    <template #footer="{ close }">
      <span class="cmdFoot__note"><span>只读分析 · 当前图纸用量</span></span>
      <div class="cmdFoot__actions">
        <button type="button" class="btn btn-secondary" @click="close">关闭</button>
        <button type="button" class="btn primary" :disabled="!pattern" @click="exportList">
          <Icon name="download" :size="16" />导出材料清单
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.ana{display:flex;flex-direction:column;gap:14px}
.ana__title{display:flex;flex-direction:column;gap:4px}
.ana__title b{font-size:var(--fs-md);font-weight:700;color:var(--ink);line-height:var(--ty-card-lh)}
.ana__title span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.anaStats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.anaStat{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
.anaStat>span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.anaStat b{font-size:24px;font-weight:700;color:var(--ink);line-height:var(--ty-dialog-lh)}
.anaStat b em{font-style:normal;font-size:var(--fs-xs);font-weight:700;color:var(--ink-2);line-height:var(--ty-label-lh)}
.anaStat small{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.ana__labelRow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:2px}
.ana__labelRow .cmdLabel{margin:0}
.ana__muted{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.anaBar{display:flex;height:16px;border-radius:99px;overflow:hidden;gap:2px}
.anaBar i{display:block;min-width:3px}
.anaLegend{display:flex;flex-wrap:wrap;gap:6px 18px}
.anaLegend span{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--ink-2);line-height:var(--ty-label-lh)}
.anaLegend i{width:8px;height:8px;border-radius:50%;display:block}
.anaTable{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.anaTable table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.anaTable th{
  font-size:var(--fs-xs);font-weight:500;color:var(--muted);text-align:right;
  padding:8px 12px;background:var(--surface-2);border-bottom:1px solid var(--line);line-height:var(--ty-label-lh)
}
.anaTable th:first-child{text-align:left}
.anaTable td{font-size:var(--fs-xs);color:var(--ink);text-align:right;padding:7px 12px;border-bottom:1px solid var(--line);line-height:var(--ty-label-lh)}
.anaTable tr:last-child td{border-bottom:0}
.anaTable td:first-child{text-align:left;display:flex;align-items:center;gap:7px;font-weight:700}
.anaTable td i{width:12px;height:12px;border-radius:4px;display:block;flex:0 0 auto}
.ana__foot{font-size:var(--fs-xs);color:var(--muted);margin:0;line-height:var(--ty-label-lh)}
.anaEmpty{padding:40px 0;text-align:center;color:var(--muted);font-size:var(--fs-sm);line-height:var(--ty-body-lh)}
@media(max-width:780px){
  .anaStats{grid-template-columns:1fr 1fr}
  .anaTable{grid-template-columns:1fr}
}
</style>
