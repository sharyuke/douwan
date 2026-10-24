/* =========================================================================
   色板注册表（PRD §16）
   品牌（PaletteBrand）与色号（PaletteColor）分开：
     brand = { id, name, region, note, desc }
     color = { id, code, name, hex, lab, brandId }
   ⚠️ 同色号在不同品牌之间不能通用（MARD 的 H1 与 Hama 的 H01 是两个产品）。
   ⚠️ 第三方公开色卡数据无法保证永久准确，上线前需用实体色卡复核。
   ========================================================================= */

import { PALETTES } from '../data/palette.js'
import { hexToRgb, rgbToLab } from '../lib/color.js'

/** 品牌元信息补全（PRD §16 要求 brand 与 code 分离） */
const MARD_URL = 'https://www.mardbeads.com/'
const BRAND_META = {
  'mard291': { region: 'CN', officialUrl: MARD_URL },
  'mard264': { region: 'CN', officialUrl: MARD_URL },
  'mard221': { region: 'CN', officialUrl: MARD_URL },
  'mard120': { region: 'CN', officialUrl: MARD_URL },
  'mard96': { region: 'CN', officialUrl: MARD_URL },
  'mard72': { region: 'CN', officialUrl: MARD_URL },
  'mard48': { region: 'CN', officialUrl: MARD_URL },
  'mard24': { region: 'CN', officialUrl: MARD_URL },
  'coco291': { region: 'CN' },
  'manman278': { region: 'CN' },
  'panpan289': { region: 'CN' },
  'mixiaowo290': { region: 'CN' },
  'artkal-c197': { region: 'CN', officialUrl: 'https://www.artkal.com/' },
  'hama': { region: 'DK', officialUrl: 'https://www.hama.dk/' },
  'perler': { region: 'US', officialUrl: 'https://perler.com/' }
}

/** 自定义色板：用户在「我的素材 / 色板管理」里自己加的颜色（PRD §16 自定义色板） */
export const CUSTOM_BRAND_ID = 'custom'
const CUSTOM_STORE = 'douzao-custom-colors'

function readCustom() {
  // 非浏览器环境（Node 里的算法评测 / 预渲染）没有 localStorage：
  // 这里必须容错，否则模块一加载就抛错，整个引擎在 Node 里根本跑不起来。
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_STORE) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeCustom(list) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CUSTOM_STORE, JSON.stringify(list))
  } catch {
    /* 隐私模式下可能写不进去，忽略即可 */
  }
}

/**
 * 归一化一条色卡数据。
 * ⚠️ scripts/build-palette.cjs 生成的是对象形式 { code, name, hex }；
 *    历史上这里按数组 ["A1","A1","#faf5cd"] 取值，结果每个色的 code/hex 都是
 *    undefined，hexToRgb(undefined) 会回落成 [0,0,0] ——
 *    整个色板全黑且 id 全部重复，量化阶段于是把所有格子映射到同一个颜色，
 *    表现为「生成的图案只有 1 种颜色」。两种写法都兼容，避免再次踩坑。
 */
function normalizeEntry(c) {
  if (!c) return null
  if (Array.isArray(c)) return { code: c[0], name: c[1], hex: c[2] }
  return { code: c.code, name: c.name, hex: c.hex }
}

function makeColor(brandId, code, name, hex, index) {
  const [r, g, b] = hexToRgb(hex)
  return {
    id: `${brandId}:${code}`,
    brandId,
    code,
    name: name || code,
    hex,
    rgb: [r, g, b],
    lab: rgbToLab(r, g, b),
    beadSize: 'M',
    active: true,
    index
  }
}

function buildBrands() {
  const brands = []
  const colorsByBrand = {}

  for (const set of PALETTES) {
    const meta = BRAND_META[set.id] || {}
    const entries = (set.colors || []).map(normalizeEntry).filter(e => e && e.code && e.hex)
    brands.push({
      id: set.id,
      name: set.name,
      desc: set.desc,
      note: set.note || '',
      region: meta.region || '--',
      officialUrl: meta.officialUrl || '',
      colorCount: entries.length,
      custom: false
    })
    colorsByBrand[set.id] = entries.map((c, i) => makeColor(set.id, c.code, c.name, c.hex, i))
  }

  // 自定义色板（用户自建）
  const custom = readCustom()
  const customColors = custom
    .filter(c => c && c.hex)
    .map((c, i) => makeColor(CUSTOM_BRAND_ID, c.code || `X${i + 1}`, c.name || c.code || `X${i + 1}`, c.hex, i))

  brands.push({
    id: CUSTOM_BRAND_ID,
    name: '我的自定义色板',
    desc: customColors.length ? `自己添加 · ${customColors.length} 色` : '自己添加颜色',
    note: '你手工录入的颜色。色号与色值由你自己维护，用于匹配手上不常见的散装豆或混色。',
    region: '--',
    officialUrl: '',
    colorCount: customColors.length,
    custom: true
  })
  colorsByBrand[CUSTOM_BRAND_ID] = customColors

  return { brands, colorsByBrand }
}

const built = buildBrands()
export const PALETTE_BRANDS = built.brands

/** brandId -> PaletteColor[] */
export const PALETTE_COLORS = built.colorsByBrand

/** 默认色板：国内最主流的漫德 MARD（291 是全色号，24~264 都是它的子集） */
export const DEFAULT_BRAND_ID = PALETTE_BRANDS[0].id

/**
 * 漫德 MARD 是「一套色号、多个套装」的体系：mard24 / mard48 / … / mard291
 * 共用同一份色号数据（同一个色号在哪个套装里都是同一个色值，见 data/palette.js 顶部注释），
 * 所以会员权益必须按「体系」判断，不能按单个色板判断 ——
 * 否则会出现「MARD 291 免费、切到 MARD 221 反而只剩 48 色」这种说不通的行为。
 */
export const MARD_BRAND_IDS = PALETTE_BRANDS.filter(b => b.id.startsWith('mard')).map(b => b.id)

/** 免费版开放的整个色号体系（漫德 MARD 全家桶） */
export function isFreeFamilyBrand(brandId) {
  return MARD_BRAND_IDS.includes(brandId)
}

/**
 * 全部品牌色号条数（会员文案用）。
 * ⚠️ 不能直接把各色板长度相加：MARD 八个套装共用 291 个色号，
 *    相加会把同一批色号数 8 遍（291+264+…+24 = 1136）。这里按体系去重。
 */
export const PALETTE_TOTAL_CODES = (() => {
  let n = 0
  for (const b of PALETTE_BRANDS) {
    if (b.custom) continue
    if (isFreeFamilyBrand(b.id) && b.id !== DEFAULT_BRAND_ID) continue
    n += b.colorCount
  }
  return n
})()

/** 全局色号索引：id → color（读存档 / 按色号反查用） */
const BY_ID = new Map()
for (const brand of PALETTE_BRANDS) {
  for (const c of PALETTE_COLORS[brand.id]) BY_ID.set(c.id, c)
}

export function getBrand(brandId) {
  return PALETTE_BRANDS.find(b => b.id === brandId) || PALETTE_BRANDS[0]
}

export function getColors(brandId) {
  const list = PALETTE_COLORS[brandId] || PALETTE_COLORS[DEFAULT_BRAND_ID]
  return list && list.length ? list : PALETTE_COLORS[DEFAULT_BRAND_ID]
}

export function getColorById(id) {
  return BY_ID.get(id) || null
}

/** 按色号在所有品牌里找（同色号可能命中多个品牌，只返回第一个） */
export function getColorByCode(code) {
  for (const brand of PALETTE_BRANDS) {
    const hit = PALETTE_COLORS[brand.id].find(c => c.code === code)
    if (hit) return hit
  }
  return null
}

/** 按「色板 + 色号」精确定位（跨品牌重名时用这个） */
export function getColor(brandId, code) {
  const id = `${brandId}:${code}`
  if (BY_ID.has(id)) return BY_ID.get(id)
  const list = PALETTE_COLORS[brandId] || []
  return list.find(c => c.code === code) || null
}

/** 自定义色板增删 */
export function addCustomColors(entries) {
  const list = readCustom()
  for (const e of entries) {
    if (!e || !e.hex) continue
    if (list.some(c => c.code === e.code)) continue
    list.push({ code: e.code, name: e.name || e.code, hex: e.hex })
  }
  writeCustom(list)
  refreshCustom()
  return list.length
}

export function removeCustomColor(code) {
  writeCustom(readCustom().filter(c => c.code !== code))
  refreshCustom()
}

export function customColors() {
  return readCustom()
}

/* ------------------------------------------------------- 色板子集选取 */

const spreadCache = new WeakMap()

/**
 * 从完整色板里挑 n 个「铺得最开」的颜色：先铺一条中性色阶梯，再在彩色里做最远点采样。
 *
 * 为什么不能用 `colors.slice(0, n)`：色板是按色号排的，前 48 色全挤在橙红色域 ——
 * 12 个色相桶的分布是 [1,6,5,19,8,7,1,1,0,0,0,0]，青/蓝/紫四个桶一个都没有，
 * 灰阶是 0。后果不是「差一点」：蓝天、水面、蓝衣服会被硬映射成暖色。
 *
 * 为什么也不能只做最远点采样（试过，已否掉）：最远点采样会一路去够
 * 极端饱和的角落，把中性色挤掉（只剩 2 个灰）。米白、浅灰这类「几乎无色」
 * 的底色就无处可落，只能落到最近的浅彩色上 —— 首页那张「橘猫头像」的
 * 米白底被映射成薄荷绿 #d5fcf7，白底商品图的还原度从 88% 掉到 83.7%。
 *
 * 五张评测图（暖色人脸 / 蓝色天空 / 绿色森林 / 白底商品 / 橘猫头像素材）
 * 的平均还原度与最坏情况：
 *   前 48 色（原实现）   平均 85.6%   最差 72.0%
 *   纯最远点采样         平均 86.1%   最差 81.9%（白底图反而变差）
 *   中性色阶梯 + 最远点   平均 90.5%   最差 87.1%   ← 现在用的
 *   完整 221 色（上限）   平均 93.7%   最差 90.2%
 * 单独看蓝色天空：72.0% → 87.4%；白底商品：88.0% → 94.9%；
 * 橘猫头像：89.3% → 93.8%（米白底正确落到 #ffffff）。
 *
 * 选色是确定性的（同色板 + 同 n 永远同一组色），保证同一张图重复生成的图案一致；
 * 结果按色板缓存，不重复计算。
 */
export function spreadColors(colors, n) {
  if (!colors || !colors.length) return []
  if (!(n > 0) || colors.length <= n) return colors.slice()

  let byN = spreadCache.get(colors)
  if (!byN) { byN = new Map(); spreadCache.set(colors, byN) }
  const hit = byN.get(n)
  if (hit) return hit

  const labOf = c => (c && c.lab) || [0, 0, 0]
  const chromaOf = c => { const l = labOf(c); return Math.sqrt(l[1] * l[1] + l[2] * l[2]) }

  const picked = []
  const chosen = new Set()

  // ① 中性色阶梯：白 → 灰 → 近黑，按 L 均匀取样
  const grays = colors
    .filter(c => chromaOf(c) < 10)
    .sort((a, b) => labOf(a)[0] - labOf(b)[0])
  const grayTarget = Math.min(grays.length, Math.max(4, Math.round(n * 0.21)))
  for (let i = 0; i < grayTarget; i++) {
    const g = grays[grayTarget === 1 ? 0 : Math.round(i * (grays.length - 1) / (grayTarget - 1))]
    if (g && !chosen.has(g)) { chosen.add(g); picked.push(g) }
  }

  // ② 剩下的名额在彩色里做最远点采样，把色相铺满一圈
  const pool = colors.filter(c => !chosen.has(c))
  if (pool.length && picked.length < n) {
    const labs = pool.map(labOf)
    let start = 0
    let farthest = -1
    for (let i = 0; i < labs.length; i++) {
      const dl = labs[i][0] - 50
      const da = labs[i][1]
      const db = labs[i][2]
      const d = dl * dl + da * da + db * db
      if (d > farthest) { farthest = d; start = i }
    }
    const sel = [start]
    const dist = new Float64Array(labs.length).fill(Infinity)
    dist[start] = -1 // 选过的标成 -1，「取最远」就再也选不到它
    while (picked.length + sel.length < n) {
      const last = labs[sel[sel.length - 1]]
      for (let i = 0; i < labs.length; i++) {
        const dl = labs[i][0] - last[0]
        const da = labs[i][1] - last[1]
        const db = labs[i][2] - last[2]
        const d = dl * dl + da * da + db * db
        if (d < dist[i]) dist[i] = d
      }
      let bi = -1
      let bd = -1
      for (let i = 0; i < labs.length; i++) if (dist[i] > bd) { bd = dist[i]; bi = i }
      if (bi < 0) break
      sel.push(bi)
      dist[bi] = -1
    }
    for (const i of sel) { chosen.add(pool[i]); picked.push(pool[i]) }
  }

  // ③ 数量还不够就用剩下的色补齐（中性色特别少的品牌会走到这里）
  if (picked.length < n) {
    for (const c of colors) {
      if (picked.length >= n) break
      if (!chosen.has(c)) { chosen.add(c); picked.push(c) }
    }
  }

  byN.set(n, picked)
  return picked
}

function refreshCustom() {
  const list = readCustom().map((c, i) => makeColor(CUSTOM_BRAND_ID, c.code, c.name, c.hex, i))
  PALETTE_COLORS[CUSTOM_BRAND_ID] = list
  const brand = PALETTE_BRANDS.find(b => b.id === CUSTOM_BRAND_ID)
  if (brand) {
    brand.colorCount = list.length
    brand.desc = list.length ? `自己添加 · ${list.length} 色` : '自己添加颜色'
  }
  for (const c of list) BY_ID.set(c.id, c)
}
