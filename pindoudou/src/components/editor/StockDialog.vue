<script setup>
/* 我的库存弹窗（Figma 124:1169）：作品用色 / 全部色号、搜索、品牌、仅看缺料、逐色步进、分页。
   改动先在弹窗里暂存，点「保存库存」才写进本机库存（与设计稿「已修改 N 项 · 尚未保存」一致）。 */
import { computed, reactive, ref, watch } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import Icon from '../ui/Icon.vue'
import { pattern, stats, materials, brand, availableColors } from '../../composables/useStudio.js'
import { inventory, setStock } from '../../composables/useInventory.js'
import { PALETTE_BRANDS, getColors } from '../../lib/palettes.js'
import { toastOk } from '../../composables/useToast.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const PAGE_SIZE = 8
const tab = ref('used')
const query = ref('')
const brandId = ref('')
const onlyLack = ref(false)
const page = ref(1)
const draft = reactive({})

watch(() => props.modelValue, v => {
  if (!v) return
  tab.value = 'used'
  query.value = ''
  brandId.value = brand.value ? brand.value.id : ''
  onlyLack.value = false
  page.value = 1
  Object.keys(draft).forEach(k => delete draft[k])
})

const needMap = computed(() => {
  const map = {}
  for (const r of (materials.value ? materials.value.rows : [])) map[r.id] = r.count
  return map
})

function paletteFor(id) {
  if (!id) return []
  const rows = getColors(id) || []
  return rows.map(c => ({ id: c.id, code: c.code, hex: c.hex, brandId: c.brandId }))
}

const allColors = computed(() => {
  if (brandId.value && brand.value && brandId.value !== brand.value.id) return paletteFor(brandId.value)
  return availableColors.value.map(c => ({ id: c.id, code: c.code, hex: c.hex, brandId: c.brandId }))
})

const sourceRows = computed(() => {
  if (tab.value === 'used') {
    return (materials.value ? materials.value.rows : []).map(r => ({ id: r.id, code: r.code, hex: r.hex, need: r.count }))
  }
  return allColors.value.map(c => ({ id: c.id, code: c.code, hex: c.hex, need: needMap.value[c.id] || 0 }))
})

function ownedOf(id) {
  if (Object.prototype.hasOwnProperty.call(draft, id)) return Number(draft[id]) || 0
  return Number(inventory.value[id]) || 0
}

const rows = computed(() => {
  const q = query.value.trim().toUpperCase()
  return sourceRows.value
    .map(r => {
      const owned = ownedOf(r.id)
      return { ...r, owned, lack: Math.max(0, r.need - owned) }
    })
    .filter(r => {
      if (q && !String(r.code).toUpperCase().includes(q)) return false
      if (onlyLack.value && r.lack <= 0) return false
      return true
    })
})

const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)))
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
watch([tab, query, brandId, onlyLack], () => { page.value = 1 })
watch(pages, n => { if (page.value > n) page.value = n })

const summary = computed(() => {
  const need = rows.value.reduce((s, r) => s + r.need, 0)
  const available = rows.value.reduce((s, r) => s + Math.min(r.owned, r.need), 0)
  const lack = rows.value.reduce((s, r) => s + r.lack, 0)
  const lackColors = rows.value.filter(r => r.lack > 0).length
  return { need, available, lack, lackColors }
})

const dirty = computed(() => Object.keys(draft).filter(id => (Number(draft[id]) || 0) !== (Number(inventory.value[id]) || 0)).length)

function bump(id, delta) {
  draft[id] = Math.max(0, ownedOf(id) + delta)
}
function onInput(id, e) {
  const n = Number(String(e.target.value).replace(/[^\d]/g, ''))
  draft[id] = Number.isFinite(n) ? Math.max(0, n) : 0
}
function save() {
  const n = dirty.value
  for (const [id, v] of Object.entries(draft)) setStock(id, v)
  toastOk(n ? `已更新 ${n} 个色号的库存` : '库存没有变化')
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue" title="我的库存" head-icon="fn-inventory"
    dialog-class="cmdDlg" @update:model-value="v => emit('update:modelValue', v)"
  >
    <div v-if="!pattern" class="stkEmpty">还没有生成图纸，先上传图片或选一个素材。</div>
    <div v-else class="stk">
      <div class="stk__title">
        <b>当前作品</b>
        <span>{{ pattern.width }} × {{ pattern.height }} 颗 · 底板 {{ stats.boardCm }} · {{ stats.colors }} 色 · {{ brand.name }}</span>
      </div>
      <div class="cmdHint">
        <Icon name="info" :size="16" />
        <span>库存只用于备料对照与「只用我的豆」配色，不扣减用量；数量单位为颗。</span>
      </div>

      <div class="stkFilters">
        <label class="stkSearch">
          <Icon name="search" :size="16" />
          <input v-model="query" type="search" placeholder="搜索色号，如 E02" aria-label="搜索色号">
        </label>
        <label class="stkSelect">
          <span>品牌</span>
          <select v-model="brandId">
            <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
          <Icon name="chevron-down" :size="16" />
        </label>
      </div>

      <div class="stkTabs">
        <div class="stkTabs__left">
          <button type="button" :class="{ on: tab === 'used' }" @click="tab = 'used'">
            作品用色 {{ (materials ? materials.rows.length : 0) }}
          </button>
          <button type="button" :class="{ on: tab === 'all' }" @click="tab = 'all'">
            全部色号 {{ allColors.length }}
          </button>
        </div>
        <label class="stkCheck">
          <input v-model="onlyLack" type="checkbox"><i /><span>仅看缺料</span>
        </label>
      </div>

      <div class="stkSummary">
        <span>本页 {{ pageRows.length }} 色 · 示例</span>
        <span>需求 <b>{{ summary.need.toLocaleString() }}</b> 颗</span>
        <span>可用 <b>{{ summary.available.toLocaleString() }}</b> 颗</span>
        <span class="stkSummary__lack">缺料 <b>{{ summary.lack.toLocaleString() }}</b> 颗 / {{ summary.lackColors }} 色</span>
      </div>

      <div class="stkTable">
        <div class="stkTable__head">
          <span>色号</span><span>我的库存 · 可编辑</span><span>作品需求</span><span>缺料</span><span>状态</span>
        </div>
        <div v-for="r in pageRows" :key="r.id" class="stkRow">
          <span class="stkRow__code"><i :style="{ background: r.hex }" />{{ r.code }}</span>
          <span class="stkStep">
            <button type="button" aria-label="减少" @click="bump(r.id, -1)"><Icon name="minus" :size="16" /></button>
            <input :value="r.owned" inputmode="numeric" @change="onInput(r.id, $event)">
            <button type="button" aria-label="增加" @click="bump(r.id, 1)"><Icon name="plus" :size="16" /></button>
          </span>
          <span>{{ r.need.toLocaleString() }}</span>
          <span :class="{ 'is-lack': r.lack > 0 }">{{ r.lack > 0 ? r.lack.toLocaleString() : '—' }}</span>
          <span><em class="stkChip" :class="r.lack > 0 ? 'is-warn' : 'is-ok'">{{ r.lack > 0 ? '待补充' : '充足' }}</em></span>
        </div>
        <div v-if="!pageRows.length" class="stkNone">没有符合条件的色号</div>
      </div>

      <div class="stkPager">
        <span class="stkPager__range">{{ pageRows.length ? (page - 1) * PAGE_SIZE + 1 : 0 }}-{{ (page - 1) * PAGE_SIZE + pageRows.length }}/{{ rows.length }} 色</span>
        <button type="button" aria-label="上一页" :disabled="page <= 1" @click="page -= 1">
          <Icon name="chevron-down" :size="16" />
        </button>
        <span class="stkPager__now">{{ page }}</span>
        <span class="stkPager__all">/ {{ pages }}</span>
        <button type="button" aria-label="下一页" :disabled="page >= pages" @click="page += 1">
          <Icon name="chevron-down" :size="16" />
        </button>
      </div>
    </div>

    <template #footer="{ close }">
      <span class="cmdFoot__note"><span>{{ dirty ? `已修改 ${dirty} 项 · 尚未保存` : '可直接输入数量 · 保存仅更新库存，不扣减用量' }}</span></span>
      <div class="cmdFoot__actions">
        <button type="button" class="btn btn-secondary" @click="close">取消</button>
        <button type="button" class="btn primary" @click="save">
          <Icon name="save" :size="16" />保存库存
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.stk{display:flex;flex-direction:column;gap:12px}
.stk__title{display:flex;flex-direction:column;gap:3px}
.stk__title b{font-size:var(--fs-sm);font-weight:700;color:var(--ink);line-height:var(--ty-body-lh)}
.stk__title span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.stkFilters{display:grid;grid-template-columns:1fr 220px;gap:10px}
.stkSearch{display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.stkSearch input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:var(--fs-sm);color:var(--ink);outline:none;line-height:var(--ty-body-lh)}
.stkSelect{position:relative;display:flex;align-items:center;gap:6px;height:38px;padding:0 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.stkSelect>span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.stkSelect select{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:var(--fs-sm);color:var(--ink);appearance:none;outline:none;padding-right:16px;cursor:pointer;line-height:var(--ty-body-lh)}
.stkSelect .pixelIcon{position:absolute;right:9px;pointer-events:none}
.stkTabs{display:flex;align-items:center;justify-content:space-between;gap:12px}
.stkTabs__left{display:flex;gap:6px}
.stkTabs__left button{
  height:32px;padding:0 14px;border-radius:9px;border:1px solid var(--line);
  background:var(--surface);font-size:var(--fs-xs);font-weight:700;color:var(--ink-2);line-height:var(--ty-label-lh)
}
.stkTabs__left button.on{background:var(--primary);border-color:var(--primary);color:var(--primary-ink)}
.stkCheck{display:flex;align-items:center;gap:7px;font-size:var(--fs-xs);color:var(--ink-2);cursor:pointer;line-height:var(--ty-label-lh)}
.stkCheck input{position:absolute;opacity:0;width:0;height:0}
.stkCheck i{width:16px;height:16px;border-radius:4px;border:1.5px solid var(--line-strong);background:#fff;display:grid;place-items:center}
.stkCheck input:checked + i{background:var(--primary);border-color:var(--primary)}
.stkCheck input:checked + i::after{content:'';width:8px;height:4px;border-left:2px solid var(--primary-ink);border-bottom:2px solid var(--primary-ink);transform:rotate(-45deg) translate(1px,-1px)}
.stkSummary{
  display:grid;grid-template-columns:1.2fr 1fr 1fr 1.2fr;gap:10px;padding:10px 14px;border-radius:10px;
  background:var(--surface-2);font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)
}
.stkSummary b{color:var(--ink);font-weight:700}
.stkSummary__lack{text-align:right;color:var(--danger)}
.stkSummary__lack b{color:var(--danger)}
.stkTable{border:1px solid var(--line);border-radius:10px;overflow:hidden}
.stkTable__head,.stkRow{
  display:grid;grid-template-columns:1.1fr 1.6fr 1fr .8fr .8fr;gap:10px;align-items:center;
  padding:9px 14px;font-size:var(--fs-xs);line-height:var(--ty-label-lh)
}
.stkTable__head{background:var(--surface-2);color:var(--muted);border-bottom:1px solid var(--line)}
.stkTable__head span:nth-child(n+3){text-align:right}
.stkTable__head span:last-child{text-align:center}
.stkRow{border-bottom:1px solid var(--line);color:var(--ink)}
.stkRow:last-child{border-bottom:0}
.stkRow>span:nth-child(3),.stkRow>span:nth-child(4){text-align:right}
.stkRow>span:last-child{text-align:center}
.stkRow__code{display:flex;align-items:center;gap:8px;font-weight:700}
.stkRow__code i{width:16px;height:16px;border-radius:5px;display:block;flex:0 0 auto}
.stkRow .is-lack{color:var(--danger);font-weight:700}
.stkStep{display:flex;align-items:center;gap:0;justify-self:start;border:1px solid var(--line);border-radius:9px;overflow:hidden}
.stkStep button{width:26px;height:28px;display:grid;place-items:center;background:var(--surface);color:var(--ink-2)}
.stkStep button:hover{background:var(--surface-3)}
.stkStep input{width:56px;height:28px;border:0;border-left:1px solid var(--line);border-right:1px solid var(--line);text-align:center;font:inherit;font-size:var(--fs-xs);font-weight:700;color:var(--ink);outline:none;background:var(--surface);line-height:var(--ty-label-lh)}
.stkChip{font-style:normal;font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px;white-space:nowrap;line-height:var(--ty-caption-lh)}
.stkChip.is-ok{background:var(--green-soft);color:var(--green-deep)}
.stkChip.is-warn{background:var(--orange-soft);color:var(--orange-deep)}
.stkNone{padding:26px;text-align:center;color:var(--muted);font-size:var(--fs-sm);line-height:var(--ty-body-lh)}
.stkPager{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.stkPager__range{margin-right:auto;font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.stkPager button{width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;color:var(--ink-2)}
.stkPager button:disabled{opacity:.4;cursor:not-allowed}
.stkPager button:first-of-type .pixelIcon{transform:rotate(90deg)}
.stkPager button:last-of-type .pixelIcon{transform:rotate(-90deg)}
.stkPager__now{min-width:28px;height:28px;border-radius:8px;background:var(--primary);color:var(--primary-ink);display:grid;place-items:center;font-size:var(--fs-xs);font-weight:700;line-height:var(--ty-label-lh)}
.stkPager__all{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.stkEmpty{padding:40px 0;text-align:center;color:var(--muted);font-size:var(--fs-sm);line-height:var(--ty-body-lh)}
@media(max-width:780px){
  .stkFilters{grid-template-columns:1fr}
  .stkSummary{grid-template-columns:1fr 1fr}
  .stkTable__head,.stkRow{grid-template-columns:1fr 1.4fr .8fr .7fr}
  .stkTable__head span:nth-child(4),.stkRow>span:nth-child(4){display:none}
}
</style>
