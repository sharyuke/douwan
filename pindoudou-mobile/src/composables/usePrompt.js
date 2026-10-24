/* =========================================================================
   AI 生成素材（PRD §23 / §13 Flow C；当前是关键词匹配，不是生成式 AI）

   2026-10-18：工作台入口已临时关闭，界面上只留「AI 生图功能对接中，敬请期待」。
   这里的实现原样保留，接入服务端生图后把 EditorSidebar 的占位换回来即可。

   现状说明（诚实告知，不假装已经接了大模型）：
     · 真正的「文字 → 图片」需要服务端模型，尚未接入
     · 当前实现：关键词匹配平台自制素材，匹配不到时给出可用关键词建议
   正式接入后，这里改成调用 POST /api/ai/generate 并按 Credits 计费。
   ========================================================================= */

import { computed, ref } from 'vue'
import { ASSETS, PROMPT_KEYWORDS, filterAssets } from '../data/assets.js'
import { pickAsset } from './useAssets.js'
import { toastOk, toastWarn, toastErr } from './useToast.js'

export const promptText = ref('')
export const promptMsg = ref('')
export const promptMsgKind = ref('')   // '' | 'ok' | 'warn'
export const promptBusy = ref(false)

/** 每个方案消耗的 Credits（PRD §24：AI 生图不全部包进低价会员） */
export const AI_COST_PER_CALL = 8

export const PROMPT_CHIPS = ['橘猫头像', '草莓蛋糕', '中国龙', '彩虹小云', '小兔子', '梅花']

const SUGGEST = ['橘猫', '柴犬', '中国龙', '向日葵', '星星眼少女', '复古游戏机', '小企鹅', '生日蛋糕']

/** 最长关键词优先，避免「猫」抢走「猫耳少女」 */
function matchByKeywords(text) {
  const t = String(text || '').replace(/\s/g, '')
  let name = ''
  let len = 0
  for (const [kw, target] of Object.entries(PROMPT_KEYWORDS)) {
    if (kw.length > len && t.includes(kw)) { name = target; len = kw.length }
  }
  if (!name) return null
  return ASSETS.find(a => a.name === name) || null
}

/** 关键词完全没命中时的兜底：按描述里的字符做模糊搜索 */
function fuzzyMatch(text) {
  const chars = [...new Set(String(text || '').replace(/\s/g, ''))]
  let best = null
  let bestScore = 0
  for (const a of ASSETS) {
    let score = 0
    for (const ch of chars) {
      if (a.name.includes(ch)) score += 2
      else if (a.cat.includes(ch)) score += 1
    }
    if (score > bestScore) { bestScore = score; best = a }
  }
  return bestScore >= 2 ? best : null
}

/** 给用户看的候选（未命中关键词时推荐一批） */
export const promptSuggestions = computed(() => filterAssets({ col: 'hot' }).slice(0, 6))

export async function runPrompt() {
  const text = promptText.value.trim()
  if (!text) {
    promptMsgKind.value = 'warn'
    promptMsg.value = '先写一句话，比如「一只橘猫」'
    return { ok: false }
  }

  if (promptBusy.value) return { ok: false }
  promptBusy.value = true
  try {
    const asset = matchByKeywords(text) || fuzzyMatch(text)
    if (!asset) {
      promptMsgKind.value = 'warn'
      promptMsg.value = `还没有接入 AI 生图，当前按关键词匹配平台自制素材。试试：${SUGGEST.join('、')}`
      return { ok: false }
    }

    // 会员素材先判定，避免先扣 Credits 再告诉用户用不了
    const res = await pickAsset(asset.id)
    if (!res.ok) {
      promptMsgKind.value = 'warn'
      promptMsg.value = res.needPro
        ? `「${asset.name}」是会员专属素材，升级 Pro 后可直接生成`
        : '素材加载失败，请重试'
      return { ok: false, needPro: !!res.needPro }
    }

    promptMsgKind.value = 'ok'
    promptMsg.value = `已按关键词匹配到「${asset.name}」并生成图纸（AI 生图接入后这里会直接出图）`
    toastOk(`已生成「${asset.name}」`)
    return { ok: true, asset }
  } finally {
    promptBusy.value = false
  }
}

/**
 * 「AI 生成更多方向」：真正接入模型前的占位入口。
 * 依然会明确告知用户当前是素材匹配，并按 Credits 计费规则给出余额提示，
 * 避免产生"付了钱却没功能"的误解。
 */
export async function generateMoreDirections() {
  /* 需求 §8：AI 生图尚未接入时，不把它包装成已上线收费功能。
     这里直接说明真实状态，不扣 Credits，也不要求先购买额度。 */
  toastWarn('AI 生图服务尚未接入，当前会继续用平台素材匹配；接入并通过测试后才会开放计费。')
  return { ok: false, notReady: true }
}
