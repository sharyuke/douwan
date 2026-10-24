/* =========================================================================
   会员权益控制（PRD §43 权限矩阵 / §57 会员验收）
   ⚠️ PRD 明确要求：权限通过 entitlement 统一控制，不在前端简单隐藏按钮。
      所以这里的做法是「先判定 → 拿到拒绝原因 → 由调用方决定提示文案与升级引导」，
      按钮始终可见可点，点击后给出明确原因，而不是凭空消失。
   ========================================================================= */

import { computed, ref } from 'vue'
import { spreadColors, DEFAULT_BRAND_ID } from '../lib/palettes.js'

const KEY = 'douzao-membership'
const CREDIT_KEY = 'douzao-credits'
const USAGE_KEY = 'douzao-usage'

export const PLAN_FREE = 'free'
export const PLAN_PRO = 'pro'

/** 套餐定义（价格按 PRD §24 建议留作测试口径） */
export const PLANS = [
  {
    id: PLAN_FREE,
    name: '免费版',
    price: 0,
    unit: '永久',
    tagline: '先把第一张图做出来',
    features: [
      { text: '上传图片 · 本地生成图纸', on: true },
      { text: '抠图去背景 · 只留主体（背景与投影一起去掉 · 三档力度）', on: true },
      { text: '基础编辑（画笔 / 橡皮 / 撤销）', on: true },
      { text: '免费素材库', on: true },
      { text: 'PNG 图纸导出', on: true },
      { text: '标记作品完成 · 计入成长记录', on: true },
      { text: '3 个作品本地存档', on: true },
      { text: '标准底板尺寸（最大 2×2 块）', on: true },
      { text: '所选默认品牌全色号（漫德 221 色）', on: true },
      { text: '三方案自动搜索', on: false },
      { text: '可拼性优化 · 自动去孤立豆', on: false },
      { text: '库存约束配色', on: false },
      { text: 'PDF 分板图纸 · 1:1 打印', on: false },
      { text: 'Build Mode 逐颗 / 整板拼制进度', on: false },
      { text: '全部品牌色板（613 色）', on: false }
    ],    cta: '当前套餐'
  },
  {
    id: PLAN_PRO,
    name: 'Pro',
    price: 19.9,
    yearPrice: 159,
    unit: '/ 月',
    tagline: '把它真的拼出来',
    featured: true,
    features: [
      { text: '免费版全部功能', on: true },
      { text: '三方案自动搜索 + 推荐', on: true },
      { text: '可拼性优化 · 去孤立豆 · 抖动', on: true },
      { text: '精细档画布 · 单边长边最大 1000 格（按原图比例，最多 100 万格 ≈ 35 块底板）', on: true },
      { text: '照片自动匹配画布与色号（一格摊到 2 个原图像素，长边最高 500 格）', on: true },
      { text: '库存约束配色（只用我的豆）', on: true },
      { text: 'PDF 分板图纸 · 1:1 打印', on: true },
      { text: '材料清单 CSV / 采购清单', on: true },
      { text: 'Build Mode 逐颗 / 整板拼制进度', on: true },
      { text: '分享卡导出', on: true },
      { text: '无限作品存档', on: true },
      { text: '完整品牌色板（613 色）', on: true },
      { text: '批量生成 / 导出 · 商用授权', on: false }
    ],
    cta: '升级 Pro'
  }
]

/** 会员状态：原型阶段用 localStorage 模拟，正式版换成接口返回的 entitlement */
export const plan = ref(readJSON(KEY, { plan: PLAN_FREE, expireAt: null }))
export const credits = ref(readJSON(CREDIT_KEY, { balance: 30, log: [] }))
export const usage = ref(readJSON(USAGE_KEY, { generated: 0, exported: 0, aiCalls: 0 }))

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? { ...fallback, ...v } : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式忽略 */
  }
}

export const isPro = computed(() => {
  if (plan.value.plan !== PLAN_PRO) return false
  if (!plan.value.expireAt) return true
  return new Date(plan.value.expireAt).getTime() > Date.now()
})

export const planLabel = computed(() => (isPro.value ? 'Pro 会员' : '免费版'))

export const creditsBalance = computed(() => credits.value.balance || 0)

/* ------------------------------------------------------------------ 权益矩阵 */

/** 每个功能在中各套餐下的限制值 */
export const ENTITLEMENTS = {
  'generate.basic': { free: true, pro: true },
  'generate.normal': { free: true, pro: true },
  // 多方案自动搜索：免费版只给 1 个方案
  'generate.variants': { free: 1, pro: 3 },
  /* 最大画布：单位是**格**（单边）。
     规格口径见 lib/boardSpec.js：拼板只有 52 / 78 / 104 钉三个规格，一钉 = 一格，
     所以可选尺寸都是这三个规格的整数倍（52 / 78 / 104 / 156 / 208 / 312…）。
     免费版 52 格 = 一块 52 钉板（正好是最小的整板尺寸，能做出一个完整成品）；
     Pro 1000 格 = 按规格一块一块加（104 × 9 = 936 这种），够把复杂照片转细。
     上限用「格」而不是「块」：78 × 104 这种两个方向规格不同的画布，
     用块数根本表达不出来（1 块 78 + 1 块 104）。 */
  'canvas.cells': { free: 52, pro: 1000 },
  'optimize.buildability': { free: false, pro: true },
  'palette.full': { free: false, pro: true },
  'inventory.use': { free: false, pro: true },
  'export.png': { free: true, pro: true },
  'export.svg': { free: false, pro: true },
  'export.csv': { free: false, pro: true },
  'export.pdf': { free: false, pro: true },
  'export.json': { free: true, pro: true },
  'export.share': { free: false, pro: true },
  'build.mode': { free: false, pro: true },
  // 本地存档数量
  'projects.limit': { free: 3, pro: Infinity },
  'assets.pro': { free: false, pro: true },
  'batch.export': { free: false, pro: false },
  'license.commercial': { free: false, pro: false },
  /* ------------------------------------------------------------------ AI
     这几个键**必须**与后端 internal/entitlement/entitlement.go 的常量同名，
     否则 applyServerPermissions 会静默忽略服务端下发的值（它只覆盖已存在的键）。
     键名同时是 CREDIT_COST 的索引（本文件下方），两边不要写错。

     ⚠ 这里的 free/pro 只是「能不能用」的门禁，**不是价格**；
       价格与扣费口径见 CREDIT_COST（ai.text / ai.variants / ai.batch）。

     为什么 ai.text 免费版也开：单次成本由 Credits 覆盖，
     把「能不能用」也卡住会让新用户第一眼就用不上 AI。
     真正的成本控制靠 Credits 余额，不靠套餐门禁。 */
  'ai.text': { free: true, pro: true },
  'ai.image': { free: true, pro: true },
  /* 抠图：浏览器内已有确定性实现（lib/matte.js），AI 版是模型级边缘细化，
     属增值项，保留给 Pro。 */
  'ai.matte': { free: false, pro: true },
  /* 卡通化：同上，浏览器内有 lib/cartoon.js。AI 版会重绘主体，
     默认不替用户做主（见 DENY_REASON 的说明）。 */
  'ai.cartoon': { free: false, pro: true },
  'ai.variants': { free: false, pro: true }
}

/** 升级引导文案：告诉用户「为什么不能做」以及升级后能得到什么 */
const DENY_REASON = {
  'generate.variants': '自动搜索并对比 3 个方案是 Pro 功能，免费版一次给出 1 个方案。',
  'canvas.cells': '超过 52 × 52 格的画布是 Pro 功能（免费版 = 一块 52 钉板）；Pro 可以按规格一块一块加，最大单边 1000 格。',
  'optimize.buildability': '可拼性优化（去孤立豆 / 抖动 / 换色合并）是 Pro 功能。',
  'palette.full': '全部品牌色板（613 色）是 Pro 功能；免费版可用漫德 MARD 的全部 221 色，其它品牌为 48 色精简色板。',
  'inventory.use': '「只用我的豆」库存约束配色是 Pro 功能。',
  'export.svg': 'SVG 矢量导出是 Pro 功能。',
  'export.csv': '材料清单 CSV 是 Pro 功能。',
  'export.pdf': 'PDF 分板图纸与 1:1 打印是 Pro 功能。',
  'export.share': '分享卡导出是 Pro 功能。',
  'build.mode': '逐颗 / 整板标记拼制进度是 Pro 功能；「完成作品」免费版也能用。',
  'assets.pro': '这是会员专属素材，升级 Pro 后可直接使用。',
  'batch.export': '批量生成 / 导出属于 Creator 套餐，当前尚未开放。',
  'license.commercial': '商用授权属于 Creator 套餐，当前尚未开放。',
  'ai.matte': 'AI 抠图（模型级边缘细化）是 Pro 功能；免费版使用浏览器内的自动抠图，效果对拼豆图纸已经够用。',
  'ai.cartoon': 'AI 卡通化是 Pro 功能。它由模型重绘，可能改变主体形象；免费版可用浏览器内的卡通化滤镜，会保留原图主体。',
  'ai.variants': '一次生成多个方向是 Pro 功能。'
}

/**
 * 判定某个权益是否可用。
 * @returns {{ok:boolean, reason?:string, value?:any, limit?:any}}
 */
export function check(feature, amount = 1) {
  const ent = ENTITLEMENTS[feature]
  if (!ent) return { ok: true, value: undefined }
  const raw = isPro.value ? ent.pro : ent.free
  if (raw === true) return { ok: true, value: true }
  if (raw === false) return { ok: false, reason: DENY_REASON[feature] || '该功能需要升级套餐。', value: false }
  if (typeof raw === 'number') {
    if (raw === Infinity) return { ok: true, value: Infinity, limit: Infinity }
    if (amount <= raw) return { ok: true, value: raw, limit: raw }
    return { ok: false, reason: DENY_REASON[feature] || `当前套餐上限为 ${raw}。`, value: raw, limit: raw }
  }
  return { ok: true, value: raw }
}

export function can(feature, amount = 1) {
  return check(feature, amount).ok
}

/**
 * 免费版可用色号。
 *
 * 默认品牌（漫德 MARD 221 色）**给全部色号**：`FREE_PALETTE_LIMIT = 0` 表示不裁剪。
 * 为什么改：实测 48 色池是还原度最大的瓶颈 ——
 * 同一套算法、同一个色数上限（8 色）下，48 色池的平均色差 6.15，
 * 换成漫德全色号后降到 4.59（-25%），界面还原度 92.7% → 94.2%；
 * 加上色数上限提到 13 色后是 4.36（-29%）。原因很直接：48 色要在整个色域里
 * 「铺得最开」，落到具体题材上（橘色南瓜的高光、肤色渐变、森林的绿色层次）
 * 经常没有相邻档位，只能硬映射到一个明显偏色的色号 —— 这不是算法问题，是色号不够。
 *
 * 其它品牌仍然保留 48 色精简色板（Pro 解锁全部品牌 613 色），
 * 否则「完整品牌色板」这个 Pro 权益就名存实亡了。
 */
export const FREE_PALETTE_LIMIT = 0
export const FREE_OTHER_BRAND_LIMIT = 48

/** 当前套餐 + 品牌 → 色号上限（0 = 不限制） */
export function paletteLimitFor(brandId, defaultBrandId = DEFAULT_BRAND_ID) {
  if (isPro.value) return 0
  return brandId === defaultBrandId ? FREE_PALETTE_LIMIT : FREE_OTHER_BRAND_LIMIT
}

/**
 * 按上限裁剪色板。limit <= 0 表示不裁剪；否则取「铺得最开」的 limit 个色号。
 *
 * 这里不能用 slice(0, N)：色板按色号排序，前 48 色全在橙红色域，
 * 青/蓝/紫一个都没有、灰阶也是 0 —— 蓝天的图会被映射成暖色（详见 palettes.js）。
 * 库存页展示的可用色号也必须走同一个函数，否则用户看到的和引擎能用的不是同一批。
 */
export function clipPalette(colors, limit = FREE_PALETTE_LIMIT) {
  if (limit > 0 && colors.length > limit) return spreadColors(colors, limit)
  return colors
}

/* ------------------------------------------------------------------ Credits */

/** AI 相关功能按 Credits 计费（PRD §24 / 开发指令 10） */
export const CREDIT_COST = {
  'ai.text': 8,
  'ai.variants': 3,
  'ai.batch': 20
}

export function spendCredits(cost, note = '') {
  const c = Number(cost) || 0
  if (c <= 0) return { ok: true }
  if ((credits.value.balance || 0) < c) {
    return { ok: false, reason: `AI Credits 不足（需要 ${c}，当前 ${credits.value.balance || 0}）。` }
  }
  credits.value = {
    balance: credits.value.balance - c,
    log: [{ at: Date.now(), cost: c, note }, ...(credits.value.log || [])].slice(0, 60)
  }
  writeJSON(CREDIT_KEY, credits.value)
  usage.value = { ...usage.value, aiCalls: (usage.value.aiCalls || 0) + 1 }
  writeJSON(USAGE_KEY, usage.value)
  return { ok: true }
}

export function addCredits(n, note = '充值') {
  credits.value = {
    balance: (credits.value.balance || 0) + n,
    log: [{ at: Date.now(), cost: -n, note }, ...(credits.value.log || [])].slice(0, 60)
  }
  writeJSON(CREDIT_KEY, credits.value)
}

export function trackUsage(key) {
  usage.value = { ...usage.value, [key]: (usage.value[key] || 0) + 1 }
  writeJSON(USAGE_KEY, usage.value)
}

/* ------------------------------------------------------------------ 升级 / 降级 */

export function upgradeTo(months = 0, planId = PLAN_PRO) {
  const now = new Date()
  let expireAt = null
  if (months > 0) {
    const d = new Date(now)
    d.setMonth(d.getMonth() + months)
    expireAt = d.toISOString()
  }
  plan.value = { plan: planId, expireAt, startedAt: now.toISOString() }
  writeJSON(KEY, plan.value)
}

export function setYearly() {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  plan.value = { plan: PLAN_PRO, expireAt: d.toISOString(), startedAt: new Date().toISOString() }
  writeJSON(KEY, plan.value)
}

/** 降级：用于验证「到期后权限正确回落」（PRD §57 会员） */
export function cancelPlan() {
  plan.value = { plan: PLAN_FREE, expireAt: null }
  writeJSON(KEY, plan.value)
}

/** 到期检查：进入应用时调用，模拟订阅到期自动降级 */
export function refreshEntitlement() {
  const saved = readJSON(KEY, { plan: PLAN_FREE, expireAt: null })
  if (saved.plan === PLAN_PRO && saved.expireAt && new Date(saved.expireAt).getTime() <= Date.now()) {
    plan.value = { plan: PLAN_FREE, expireAt: null }
    writeJSON(KEY, plan.value)
    return false
  }
  plan.value = saved
  return true
}

/* ------------------------------------------------------------------ 兼容旧 API */
export const unlockPro = () => upgradeTo()
export const lockPro = cancelPlan

/* ------------------------------------------------------------------ 服务端权益同步 */

/**
 * 把服务端返回的会员状态写进前台状态。
 *
 * 为什么需要它：权益的真正来源是服务端的 entitlements 表（卡密兑换 / 订单发卡），
 * 前台这份 localStorage 只是离线兜底。登录后必须用服务端状态覆盖本地，
 * 否则会出现「后台已经发了权益，前台还显示免费版」这种前后不一致。
 *
 * @param {{plan?:string, is_pro?:boolean, expire_at?:string|null}} membership
 */
export function applyServerMembership(membership) {
  if (!membership) return
  const next = {
    plan: membership.is_pro ? (membership.plan || PLAN_PRO) : PLAN_FREE,
    expireAt: membership.expire_at || null,
    startedAt: null,
    fromServer: true
  }
  plan.value = next
  writeJSON(KEY, next)
}

/**
 * 用服务端返回的权限矩阵覆盖本地矩阵（登录后调用，保证按钮口径一致）。
 *
 * 服务端返回的是「已经按该用户套餐合并过」的单份矩阵，所以这里同时写进
 * free / pro 两档：当前用户的套餐已经决定了最终结果。
 * 只覆盖键**已存在**的项，避免服务端新增了前台还不认识的功能键时污染矩阵。
 */
export function applyServerPermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') return
  for (const [key, value] of Object.entries(permissions)) {
    if (!ENTITLEMENTS[key]) continue
    ENTITLEMENTS[key] = { free: value, pro: value }
  }
}

/** 用服务端返回的额度覆盖本地 Credits */
export function applyServerCredits(balance) {
  if (typeof balance !== 'number') return
  credits.value = { ...credits.value, balance }
}
