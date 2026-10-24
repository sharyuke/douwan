<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import BaseDialog from '../components/ui/BaseDialog.vue'
import {
  inventory, inventorySummary, inventoryByBrand, inventoryColors, inventoryColorIds,
  stockOf, setStock, toggleColor, addStock, clearInventory, importInventory, inventoryCSV,
  useInventory, inventoryMode
} from '../composables/useInventory.js'
import { PALETTE_BRANDS, getColors, getColorById } from '../lib/palettes.js'
import { check, clipPalette, paletteLimitFor } from '../composables/useMembership.js'
import { toastOk, toastWarn, toastErr } from '../composables/useToast.js'
import { num } from '../lib/forge.js'
import { downloadText } from '../lib/exporters.js'
import { pattern, hasPattern, regenerate } from '../composables/useStudio.js'
import { shortageOf } from '../composables/useInventory.js'

const activeBrand = ref(PALETTE_BRANDS[0].id)
const keyword = ref('')
const importOpen = ref(false)
const importText = ref('')
const importBrand = ref(PALETTE_BRANDS[0].id)
const proOpen = ref(false)

const gate = computed(() => check('inventory.use'))

const brandColors = computed(() => {
  const list = getColors(activeBrand.value)
  // 免费版展示的子集必须和引擎实际能用的完全一致（同一个 paletteLimitFor / clipPalette），
  // 否则用户在库存页挑的颜色会生成不出来
  const base = clipPalette(list, paletteLimitFor(activeBrand.value))
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return base
  return base.filter(c => c.code.toLowerCase().includes(kw) || (c.name || '').toLowerCase().includes(kw))
})

const brandColorTotal = computed(() => getColors(activeBrand.value).length)
const brandColorShown = computed(() => brandColors.value.length)

const short = computed(() => (hasPattern.value ? shortageOf(pattern.value) : null))

function onToggle(color) {
  // 记录库存本身是免费的；只有"用库存反过来决定配色"才需要 Pro
  toggleColor(color.id)
}

/** 颜色名与色号相同时，退回显示品牌简称，避免出现「A1 A1」 */
function brandLabel(id) {
  const map = { mard221: 'MARD', 'artkal-c197': 'Artkal', hama: 'Hama', perler: 'Perler', custom: '自定义' }
  return map[id] || '色号'
}

function onSetQty(color, qty) {
  setStock(color.id, qty)
}

function onAdd(color, delta) {
  addStock(color.id, delta)
}

function onImport() {
  const res = importInventory(importText.value, importBrand.value)
  if (res.ok) {
    toastOk(`成功导入 ${res.ok} 个色号${res.fail.length ? `，${res.fail.length} 个未识别` : ''}`)
    if (res.fail.length) toastWarn(`未识别的色号：${res.fail.slice(0, 8).join('、')}${res.fail.length > 8 ? '…' : ''}`)
    importOpen.value = false
    importText.value = ''
    if (hasPattern.value && useInventory.value) regenerate()
  } else {
    toastErr('没有识别到任何色号，请检查格式与品牌是否对应')
  }
}

function onExport() {
  if (!inventorySummary.value.colors) {
    toastWarn('还没有设置库存')
    return
  }
  downloadText(inventoryCSV(), 'douzao-inventory.csv', 'text/csv;charset=utf-8')
  toastOk('库存清单已导出')
}

function onClear() {
  clearInventory()
  toastOk('库存已清空')
}

function onToggleUse() {
  const g = check('inventory.use')
  if (!g.ok) {
    proOpen.value = true
    return
  }
  useInventory.value = !useInventory.value
  if (hasPattern.value) regenerate()
}

function onMode(m) {
  const g = check('inventory.use')
  if (!g.ok) {
    proOpen.value = true
    return
  }
  inventoryMode.value = m
  if (hasPattern.value && useInventory.value) regenerate()
}

const quickSets = [
  { name: '新手 24 色', codes: ['A1', 'A4', 'A6', 'A10', 'A14', 'A17', 'B1', 'B3', 'B5', 'C1', 'C3', 'C6', 'D1', 'D4', 'E1', 'E3', 'F1', 'F4', 'G1', 'G3', 'H1', 'H3', 'H6', 'H9'] },
  { name: '黑白灰基础', codes: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'] }
]

function applyQuickSet(set) {
  const brandId = activeBrand.value
  const list = getColors(brandId)
  let n = 0
  for (const code of set.codes) {
    const c = list.find(x => x.code === code)
    if (c) { setStock(c.id, 500); n++ }
  }
  if (n) toastOk(`已添加 ${n} 个色号（每个 500 颗）`)
  else toastWarn(`这套色号在当前品牌（${PALETTE_BRANDS.find(b => b.id === brandId)?.name}）里没找到，换个品牌试试`)
}
</script>

<template>
  <div class="wrap main--pad">
    <div class="pagehead">
      <div>
        <h1>我的库存</h1>
        <p>
          勾选你手里真的有的颜色，生成时会自动只用这些颜色 ——
          不用先买齐再创作，也不会因为缺一色就拼不完。
        </p>
      </div>
      <div class="row row--wrap">
        <button class="btn btn-secondary" @click="importOpen = true">批量导入</button>
        <button class="btn btn-secondary" @click="onExport">导出库存</button>
        <button class="btn danger" @click="onClear">清空</button>
      </div>
    </div>

    <!-- 概览 -->
    <div class="summaryRow">
      <div class="summaryCard">
        <span class="muted">已有颜色</span>
        <b>{{ inventorySummary.colors }} 色</b>
        <span class="hint">共 {{ num(inventorySummary.beads) }} 颗</span>
      </div>
      <div class="summaryCard" :class="{ warn: !gate.ok }">
        <span class="muted">参与生成</span>
        <b>{{ useInventory ? '已开启' : '未开启' }}</b>
        <span class="hint">{{ gate.ok ? '只用我的豆' : 'Pro 功能' }}</span>
      </div>
      <div class="summaryCard">
        <span class="muted">当前作品缺口</span>
        <b v-if="short && short.totalLack">{{ num(short.totalLack) }} 颗</b>
        <b v-else-if="short">已够</b>
        <b v-else>—</b>
        <span class="hint">{{ short ? (short.needRestock ? '需补购' : '库存充足') : '生成图纸后统计' }}</span>
      </div>
    </div>

    <!-- 品牌分布 -->
    <section v-if="inventoryByBrand.length" class="card" style="margin-top:18px">
      <div class="card__head"><h3>按品牌分布</h3><span class="muted">同色号跨品牌不能混用</span></div>
      <div class="card__body">
        <div class="brandBars">
          <div v-for="b in inventoryByBrand" :key="b.brandId" class="brandBar">
            <div class="row row--between">
              <b>{{ b.brandName }}</b>
              <span class="muted">{{ b.colors }} 色 · {{ num(b.beads) }} 颗</span>
            </div>
            <div class="bar" style="margin-top:6px">
              <i :style="{ width: Math.max(4, (b.colors / inventorySummary.colors) * 100) + '%' }"></i>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 只用我的豆 -->
    <section class="card" style="margin-top:18px">
      <div class="card__head">
        <h3>只用我的豆</h3>
        <span class="tag" :class="gate.ok ? 'free' : 'pro'">{{ gate.ok ? '可用' : 'PRO' }}</span>
      </div>
      <div class="card__body stack stack--sm">
        <label class="check">
          <input type="checkbox" :checked="useInventory" @change="onToggleUse">
          生成时只使用我已有颜色的豆子
        </label>
        <div class="grid-3 keep">
          <button class="pick" :class="{ on: inventoryMode === 'strict' }" @click="onMode('strict')">
            <strong>完全不补购</strong><span>一颗都不用买</span>
          </button>
          <button class="pick" :class="{ on: inventoryMode === 'mincost' }" @click="onMode('mincost')">
            <strong>补购最少</strong><span>允许少量补货</span>
          </button>
          <button class="pick" :class="{ on: inventoryMode === 'best' }" @click="onMode('best')">
            <strong>最高还原度</strong><span>忽略库存限制</span>
          </button>
        </div>
        <p class="hint">
          开启后会按你选择的策略重新计算配色：先尽量用现有颜色，找不到最接近的替代色时才提示补购。
          方案会连同「需要补多少颗」一起算给你。
        </p>
      </div>
    </section>

    <!-- 缺口 -->
    <section v-if="short && short.needRestock" class="card" style="margin-top:18px">
      <div class="card__head">
        <h3>当前作品的缺色提醒</h3>
        <RouterLink to="/materials">查看完整材料表 ›</RouterLink>
      </div>
      <div class="card__body">
        <div class="tableWrap">
          <table class="table">
            <thead><tr><th class="swatchCell">色块</th><th>色号</th><th class="num">需要</th><th class="num">已有</th><th class="num">缺</th></tr></thead>
            <tbody>
              <tr v-for="r in short.rows.filter(x => x.lack > 0)" :key="r.id">
                <td><span class="swatch" :style="{ background: r.hex }"></span></td>
                <td>{{ r.code }}</td>
                <td class="num">{{ num(r.count) }}</td>
                <td class="num">{{ r.owned ? num(r.owned) : '—' }}</td>
                <td class="num" style="color:var(--danger);font-weight:800">{{ num(r.lack) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 色板选择 -->
    <section class="card" style="margin-top:18px">
      <div class="card__head">
        <h3>选择色板</h3>
        <span class="muted">{{ brandColorShown }} / {{ brandColorTotal }} 色</span>
      </div>
      <div class="card__body">
        <div class="tabs" style="margin-bottom:12px">
          <button
            v-for="b in PALETTE_BRANDS" :key="b.id"
            :class="{ on: activeBrand === b.id }"
            @click="activeBrand = b.id"
          >{{ b.name }}</button>
        </div>

        <div class="row row--wrap" style="margin-bottom:12px">
          <input v-model="keyword" type="search" placeholder="搜索色号或颜色名…" style="max-width:260px">
          <span v-for="s in quickSets" :key="s.name">
            <button class="btn btn-secondary sm" @click="applyQuickSet(s)">{{ s.name }}</button>
          </span>
          <span class="spacer"></span>
          <span v-if="brandColorShown < brandColorTotal" class="tag warn">免费版在本品牌可用 {{ brandColorShown }} 色（漫德 MARD 全套 24–291 色都给全）</span>
        </div>

        <div class="swatchGrid">
          <button
            v-for="c in brandColors" :key="c.id"
            class="swatchItem" :class="{ on: stockOf(c.id) > 0 }"
            :title="`${c.code} ${c.name}`"
            @click="onToggle(c)"
            @contextmenu.prevent="onAdd(c, -100)"
          >
            <i :style="{ background: c.hex }"></i>
            <span>{{ c.code }}</span>
            <small>{{ c.name !== c.code ? c.name : brandLabel(activeBrand) }}</small>
            <span v-if="stockOf(c.id) > 0" class="swatchItem__qty">{{ stockOf(c.id) }}</span>
          </button>
        </div>

        <p class="hint" style="margin-top:12px">
          点一下切换「有 / 没有」，默认记 500 颗。要精确填写数量，请在上方列表选中后用下面的数量设置。
        </p>

        <!-- 已选颜色与数量 -->
        <div v-if="inventoryColorIds.length" class="selectedList">
          <div class="row row--between" style="margin-bottom:10px">
            <b style="font-size:var(--fs-xs)">已选 {{ inventoryColorIds.length }} 色</b>
            <span class="muted">可精确调整颗数</span>
          </div>
          <div class="qtyList">
            <div v-for="id in inventoryColorIds.slice().reverse().slice(0, 40)" :key="id" class="qtyRow">
              <span class="swatch" :style="{ background: getColorById(id)?.hex }"></span>
              <span class="qtyCode">{{ getColorById(id)?.code }}</span>
              <input
                type="number" min="0" step="50"
                :value="stockOf(id)"
                @change="onSetQty(getColorById(id), Number($event.target.value))"
              >
              <button class="btn btn-secondary sm" @click="onAdd(getColorById(id), 100)">+100</button>
              <button class="btn sm ghost" @click="onSetQty(getColorById(id), 0)">移除</button>
            </div>
          </div>
          <p v-if="inventoryColorIds.length > 40" class="hint" style="margin-top:8px">
            只显示最近添加的 40 个色号，完整列表请用「导出库存」查看。
          </p>
        </div>
      </div>
    </section>

    <!-- 批量导入 -->
    <BaseDialog v-model="importOpen" title="批量导入库存" size="sm">
      <div class="stack stack--sm">
        <div class="field">
          <label>这些色号属于哪个品牌 <span>不同品牌同色号是不同产品</span></label>
          <select v-model="importBrand">
            <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>粘贴你的库存 <span>每行一个色号</span></label>
          <textarea
            v-model="importText"
            rows="8"
            placeholder="支持这些写法：&#10;A1,500&#10;A2 300&#10;B5&#10;（只写色号默认记 500 颗）"
          ></textarea>
        </div>
        <p class="hint">
          可以从淘宝订单、聊天记录里直接复制色号贴进来。识别不到的色号会单独列出来，不会静默丢弃。
        </p>
      </div>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button class="btn primary" @click="onImport">导入</button>
      </template>
    </BaseDialog>

    <BaseDialog v-model="proOpen" title="库存约束配色是 Pro 功能" size="sm">
      <p style="font-size:var(--fs-sm);line-height:1.85;color:var(--ink-2)">
        {{ gate.reason || '库存约束配色需要 Pro 套餐。' }}
        浏览和记录库存是免费的 —— 只有「用库存反过来决定配色」这一层需要 Pro。
      </p>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">先看看</button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.summaryRow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
.summaryCard{
  padding:15px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line);
  display:flex;flex-direction:column;gap:4px;box-shadow:var(--sh-1);
}
.summaryCard b{font-size:20px;font-weight:850;letter-spacing:-.02em}
.summaryCard.warn{border-color:#F3C9A8;background:var(--yellow-soft)}
.brandBars{display:flex;flex-direction:column;gap:12px}
.brandBar b{font-size:var(--fs-xs)}
.selectedList{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.qtyList{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto}
.qtyRow{display:grid;grid-template-columns:22px 66px minmax(0,1fr) auto auto;gap:8px;align-items:center}
.qtyRow input{min-height:34px}
.qtyCode{font-size:var(--fs-xs);font-weight:800}
@media(max-width:900px){.summaryRow{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
