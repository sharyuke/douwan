/* =========================================================================
   库存（PRD §17）
   字段：{ [colorId]: quantity }，colorId 形如 "mard221:A1"
   功能：添加颜色 / 设置颗数 / 批量导入 / 只用我的豆 / 缺色与不足提醒 /
        自动替换 / 补购建议
   ========================================================================= */

import { computed, ref, watch } from 'vue'
import { PALETTE_BRANDS, PALETTE_COLORS, getColorById, getColor } from '../lib/palettes.js'
import { materialList } from '../lib/pattern.js'

const KEY = 'douzao-inventory-v2'

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (!raw || typeof raw !== 'object') return {}
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) out[k] = Math.round(n)
    }
    return out
  } catch {
    return {}
  }
}

/** colorId -> 颗数。0 或缺失都表示「没有」 */
export const inventory = ref(load())

/** 未填颗数、只勾选「有这色」时的默认存量 */
export const DEFAULT_STOCK = 500

/** 库存是否参与生成（“只用我的豆”，PRD §6 差异化 3） */
export const useInventory = ref(false)
/** 库存策略：strict 完全不补购 / mincost 补购最少 / best 最高还原 */
export const inventoryMode = ref('strict')

watch(inventory, v => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}, { deep: true })

watch(useInventory, v => {
  try {
    localStorage.setItem(KEY + ':on', v ? '1' : '0')
  } catch {
    /* ignore */
  }
})
try {
  useInventory.value = localStorage.getItem(KEY + ':on') === '1'
} catch {
  /* ignore */
}

/* ------------------------------------------------------------------ 读 */

export function stockOf(colorId) {
  return Number(inventory.value[colorId] || 0)
}

export function hasColor(colorId) {
  return stockOf(colorId) > 0
}

export const inventoryColorIds = computed(() => Object.keys(inventory.value).filter(id => inventory.value[id] > 0))

export const inventoryColors = computed(() =>
  inventoryColorIds.value.map(id => getColorById(id)).filter(Boolean)
)

/** 按品牌分组的库存统计 */
export const inventoryByBrand = computed(() => {
  const map = new Map()
  for (const id of inventoryColorIds.value) {
    const c = getColorById(id)
    if (!c) continue
    const brand = PALETTE_BRANDS.find(b => b.id === c.brandId)
    const e = map.get(c.brandId) || { brandId: c.brandId, brandName: brand ? brand.name : c.brandId, colors: 0, beads: 0 }
    e.colors++
    e.beads += stockOf(id)
    map.set(c.brandId, e)
  }
  return [...map.values()].sort((a, b) => b.colors - a.colors)
})

export const inventorySummary = computed(() => {
  let colors = 0
  let beads = 0
  for (const id of inventoryColorIds.value) {
    colors++
    beads += stockOf(id)
  }
  return {
    colors,
    beads,
    label: colors ? `已设置 ${colors} 色 · ${beads.toLocaleString()} 颗` : '未设置库存'
  }
})

/* ------------------------------------------------------------------ 写 */

export function setStock(colorId, qty) {
  const n = Math.max(0, Math.round(Number(qty) || 0))
  const next = { ...inventory.value }
  if (n > 0) next[colorId] = n
  else delete next[colorId]
  inventory.value = next
}

export function toggleColor(colorId, defaultQty = DEFAULT_STOCK) {
  if (hasColor(colorId)) setStock(colorId, 0)
  else setStock(colorId, defaultQty)
}

export function addStock(colorId, delta) {
  setStock(colorId, stockOf(colorId) + delta)
}

export function clearInventory() {
  inventory.value = {}
}

/**
 * 批量导入（PRD §17 ③）：支持每行「色号,数量」「色号 数量」「色号」三种写法。
 * 需要指定品牌，因为不同品牌同色号是不同产品。
 */
export function importInventory(text, brandId) {
  const list = PALETTE_COLORS[brandId] || []
  const byCode = new Map(list.map(c => [String(c.code).toLowerCase(), c]))
  const result = { ok: 0, fail: [], rows: [] }
  const next = { ...inventory.value }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/[,，\t;；\s]+/).filter(Boolean)
    if (!parts.length) continue
    const code = parts[0]
    const qtyRaw = parts[1]
    const color = byCode.get(code.toLowerCase()) || getColor(brandId, code)
    if (!color) {
      result.fail.push(code)
      continue
    }
    let qty = DEFAULT_STOCK
    if (qtyRaw !== undefined) {
      const n = Number(String(qtyRaw).replace(/[^\d.]/g, ''))
      qty = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_STOCK
    }
    next[color.id] = qty
    result.ok++
    result.rows.push({ code: color.code, name: color.name, qty })
  }

  inventory.value = next
  return result
}

/** 导出库存为 CSV，便于备份 / 换设备 */
export function inventoryCSV() {
  const rows = ['品牌,色号,颜色,数量']
  for (const id of inventoryColorIds.value) {
    const c = getColorById(id)
    if (!c) continue
    const brand = PALETTE_BRANDS.find(b => b.id === c.brandId)
    const qty = stockOf(id)
    rows.push([brand ? brand.name : c.brandId, c.code, c.name || '', qty].join(','))
  }
  return '\ufeff' + rows.join('\n')
}

/* ------------------------------------------------------------------ 缺色 / 补购 */

/**
 * 缺色与不足提醒（PRD §17 ⑤⑥）
 * 对比当前图案需要的材料与库存，标出「完全没有」和「数量不足」。
 */
export function shortageOf(pattern) {
  const mats = materialList(pattern, inventory.value)
  const missing = mats.rows.filter(r => r.owned <= 0)
  const short = mats.rows.filter(r => r.owned > 0 && r.lack > 0)
  return {
    ...mats,
    missing,
    short,
    needRestock: missing.length > 0 || short.length > 0,
    missingCount: missing.length,
    shortCount: short.length
  }
}

/* ------------------------------------------------- 完成作品：按材料表动库存 */

/**
 * 拼完一件作品 → 把真正用掉的豆从库存里扣掉。
 *
 * 口径与材料表一致，有两条刻意的设计：
 *   ① 需要 `count` 颗、库存只有 `owned` 颗时只扣 `min(owned, count)`；
 *      不够的那部分是**要去买的**，扣成负数会让「我的库存」出现永远还不上的债，
 *      也会让之后的补购表算错。
 *   ② 库存里没有的颜色直接跳过（用户可能用的是散装豆、根本没登记）。
 *
 * @returns {{[colorId:string]: number}} 实际扣掉的颗数，用于「取消完成」原样加回
 */
export function consumeMaterials(rows = []) {
  const next = { ...inventory.value }
  const deducted = {}
  for (const row of rows) {
    const id = row && (row.id || row.colorId)
    if (!id) continue
    const owned = Number(next[id] || 0)
    if (owned <= 0) continue
    const need = Number(row.count != null ? row.count : row.qty) || 0
    const use = Math.min(owned, need)
    if (use <= 0) continue
    deducted[id] = use
    const left = owned - use
    if (left > 0) next[id] = left
    else delete next[id]
  }
  if (Object.keys(deducted).length) inventory.value = next
  return deducted
}

/**
 * 取消完成：把 consumeMaterials 扣掉的颗数原样加回去。
 * 记录的是「当时实际扣了多少」，所以中间无论手动改过库存，
 * 回滚都不会多退也不少退。
 */
export function restoreMaterials(deducted) {
  if (!deducted || typeof deducted !== 'object') return 0
  const next = { ...inventory.value }
  let restored = 0
  for (const [id, qty] of Object.entries(deducted)) {
    const v = Math.round(Number(qty) || 0)
    if (v <= 0) continue
    next[id] = Number(next[id] || 0) + v
    restored += v
  }
  if (restored) inventory.value = next
  return restored
}

/**
 * 最高还原方案的色号转成库存等价物。
 * 有些散装豆色号在色板里查不到，这时给出「跳过」而不是静默丢弃。
 */
export function suggestRestock(pattern) {
  const short = shortageOf(pattern)
  const items = short.rows.filter(r => r.lack > 0)
  return {
    items,
    totalBeads: items.reduce((s, r) => s + r.lack, 0),
    packages: items.map(r => ({
      ...r,
      // 常见分装规格：100 / 500 / 1000 颗
      suggest: r.lack <= 100 ? '100 颗装' : r.lack <= 500 ? '500 颗装' : '1000 颗装'
    }))
  }
}
