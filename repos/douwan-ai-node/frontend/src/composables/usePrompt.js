/* =========================================================================
   AI 文字创作（PRD §23 / §13 Flow C）
   
   现状（诚实告知，不假装比实际更强）：
     · 已接入**自建推理节点**的文字生图：文字 → 服务端 SD 1.5 → 图片 → 载入工作台
     · 节点离线 / 功能未开启时**自动降级**为「关键词匹配平台自制素材」，
       且界面会说明当前走了哪条路（降级不消耗 Credits）
     · 生成是异步的（提交 → 轮询），因为一次出图在 6GB 显存上要 6~25s
   
   计费：不在本文件里写价格。可用性看 useMembership 的 'ai.text' 权益，
        扣费走 CREDIT_COST['ai.text']（useMembership 里已有的口径）。
   ========================================================================= */

import { computed, ref } from 'vue'
import { ASSETS, PROMPT_KEYWORDS, filterAssets } from '../data/assets.js'
import { pickAsset } from './useAssets.js'
import { check, creditsBalance, spendCredits, CREDIT_COST } from './useMembership.js'
import { toastOk, toastWarn } from './useToast.js'
import { AI_KIND, aiReady, aiUnavailableReason, applyAiResultToStudio, runAiJob } from './useAI.js'

export const promptText = ref('')
export const promptMsg = ref('')
export const promptMsgKind = ref('')   // '' | 'ok' | 'warn'
export const promptBusy = ref(false)
/** 真实 AI 生成时的进度文案（「排队中（前面还有 2 个）」这类） */
export const promptProgress = ref('')

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

export const aiGate = computed(() => check('ai.text'))

/** 给用户看的候选（未命中关键词时推荐一批） */
export const promptSuggestions = computed(() => filterAssets({ col: 'hot' }).slice(0, 6))

/** 当前会走哪条路：'model'（自建推理节点）还是 'local'（关键词匹配素材） */
export const promptMode = computed(() => (aiReady.value ? 'model' : 'local'))

/**
 * 把任务状态翻译成一句人话（进度用）。
 * 排队位置由后端算：6GB 显存一次只跑一条，用户最想知道的就是「还要等几个」。
 */
function progressText(job) {
  if (!job) return ''
  if (job.status === 'queued') {
    const pos = job.queue_position || 1
    return pos > 1 ? `排队中（前面还有 ${pos - 1} 个任务）` : '排队中…'
  }
  if (job.status === 'running') return '正在生成…'
  if (job.status === 'succeeded') return '生成完成'
  if (job.status === 'canceled') return '已取消'
  if (job.status === 'failed') return job.error_message || '生成失败'
  return ''
}

/**
 * 文字 → 图片。
 *
 * 两条路都实现，按 `promptMode` 自动选择：
 *   · model：真调自建推理节点（需要登录 + 节点在线）
 *   · local：关键词匹配素材（离线兜底，永远可用，不扣费）
 */
export async function runPrompt() {
  const text = promptText.value.trim()
  if (!text) {
    promptMsgKind.value = 'warn'
    promptMsg.value = '先写一句话，比如「一只橘猫」'
    return { ok: false }
  }
  if (promptBusy.value) return { ok: false }

  // 权益门禁（按钮不隐藏，点了给原因 —— 前台硬约定）
  const gate = check('ai.text')
  if (!gate.ok) {
    promptMsgKind.value = 'warn'
    promptMsg.value = gate.reason
    toastWarn(gate.reason)
    return { ok: false, needPro: true }
  }

  // 扣费判定放在**提交之前**：余额不足就先说，不要等生成了再告诉用户
  const cost = CREDIT_COST['ai.text'] || 0
  if (cost > 0 && creditsBalance.value < cost) {
    const reason = `AI Credits 不足（需要 ${cost}，当前 ${creditsBalance.value}）。`
    promptMsgKind.value = 'warn'
    promptMsg.value = reason
    toastWarn(reason)
    return { ok: false, needCredits: true }
  }

  promptBusy.value = true
  promptProgress.value = ''
  try {
    if (aiReady.value) return await runPromptWithModel(text, cost)
    return await runPromptWithLocalAssets(text)
  } finally {
    promptBusy.value = false
    promptProgress.value = ''
  }
}

/** 走自建推理节点 */
async function runPromptWithModel(text, cost) {
  promptProgress.value = '提交任务…'
  const res = await runAiJob(
    { kind: AI_KIND.TEXT2IMAGE, prompt: text },
    { onTick: (job) => { promptProgress.value = progressText(job) } }
  )

  if (!res.ok) {
    // 提交后失败：给出原因并提示可改用素材兜底。
    // 刻意**不自动降级** —— 否则用户以为「AI 生成了」，实际拿到的是素材库里的旧图。
    promptMsgKind.value = 'warn'
    promptMsg.value = `${res.reason || '生成失败'}（可以改用关键词匹配平台素材，或稍后重试）`
    return { ok: false, reason: res.reason }
  }

  if (cost > 0) {
    const pay = spendCredits(cost, `文字生图：${text.slice(0, 20)}`)
    if (!pay.ok) {
      // 前面已判过余额；只有并发扣费才可能走到这里
      promptMsgKind.value = 'warn'
      promptMsg.value = pay.reason
      return { ok: false, needCredits: true }
    }
  }

  const applied = await applyAiResultToStudio(res.job, text.slice(0, 24) || 'AI 生图')
  if (!applied.ok) {
    promptMsgKind.value = 'warn'
    promptMsg.value = '图片已生成，但载入工作台失败，可在「我的 AI 任务」里重新下载'
    return { ok: false, job: res.job }
  }

  promptMsgKind.value = 'ok'
  promptMsg.value = 'AI 已生成图片并载入工作台。可以直接开始转换图纸。'
  toastOk('AI 生成完成')
  return { ok: true, job: res.job }
}

/** 降级：关键词匹配平台自制素材（不联网、不扣费） */
async function runPromptWithLocalAssets(text) {
  const asset = matchByKeywords(text) || fuzzyMatch(text)
  if (!asset) {
    promptMsgKind.value = 'warn'
    promptMsg.value = `AI 节点当前不可用（${aiUnavailableReason.value || '离线'}），已回退到关键词匹配，但没有匹配到素材。试试：${SUGGEST.join('、')}`
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
  promptMsg.value = `AI 节点当前不可用（${aiUnavailableReason.value || '离线'}），已按关键词匹配到「${asset.name}」。本次不消耗 Credits。`
  toastOk(`已生成「${asset.name}」`)
  return { ok: true, asset, fallback: true }
}

/**
 * 「AI 生成更多方向」。
 *
 * 后端目前每次任务出一张图，所以这里**如实说明**多方向仍未开放，
 * 而不是假装在跑。等后端支持批量出图（或串行提交多次）后再实现，
 * 那时用 CREDIT_COST['ai.variants'] 计费。
 */
export async function generateMoreDirections() {
  const gate = check('ai.variants')
  if (!gate.ok) {
    toastWarn(gate.reason)
    return { ok: false, needPro: true }
  }
  if (!aiReady.value) {
    toastWarn(`${aiUnavailableReason.value || 'AI 节点离线'}；多方向生成需要 AI 节点在线。`)
    return { ok: false }
  }
  toastWarn('多方向生成尚未开放：当前每次任务生成一张图。')
  return { ok: false, notReady: true }
}
