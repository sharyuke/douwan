/* =========================================================================
   本地 AI（自建推理节点）—— 前台调用层
   
   与「浏览器内算法」的区别（这一点必须在文案里说清楚，不能含糊）：
     · lib/matte.js 与 lib/cartoon.js 是**纯浏览器内**的确定性算法，图片不出设备；
     · 本文件的三个能力会**把图片上传到服务端**，再由服务端转给自建的推理节点
       （豆玩自己的机器，不经第三方），结果回传后落 storage。
   因此站点的隐私声明已同步更新（SettingsView / PricingView / AppFooter）。

   为什么是异步的：
     一次卡通化在节点侧要 6~25s，排队时更久。后端接口是「提交 → 拿 job_id → 轮询」，
     不是同步返回；同步调用会被 nginx 的 60s proxy_read_timeout 掐断。

   费用：本文件**不定义价格**。是否计费、计多少由 useMembership 的
   CREDIT_COST / 权益矩阵决定（需求红线：不把价格写死在 AI 功能里）。
   ========================================================================= */

import { computed, ref } from 'vue'
import { request, upload, ApiError } from '../lib/api.js'
import { check } from './useMembership.js'
import { toastOk, toastWarn, toastErr } from './useToast.js'

/** 任务类型，与后端 model.AIJobKind* 一致 */
export const AI_KIND = {
  MATTING: 'matting',
  CARTOONIZE: 'cartoonize',
  TEXT2IMAGE: 'text2image'
}

/** 后端业务码（与 douwan-api/internal/response/errors.go 对齐） */
export const AI_CODE = {
  NOT_ENABLED: 40028,
  QUEUE_FULL: 40029,
  UNAVAILABLE: 40030,
  JOB_NOT_FOUND: 40031,
  JOB_FINISHED: 40032,
  REJECTED: 40033
}

/** 节点可用性（由 refreshAiStatus 填充）。null = 还没探测过 */
export const aiStatus = ref(null)
export const aiStatusBusy = ref(false)
/** 最近一次探测失败的原因（给界面显示「为什么不能用」） */
export const aiStatusError = ref('')

/** 当前进行中的任务（按 job_id），供界面显示进度 */
export const activeJobs = ref({})

/**
 * 探测节点可用性。
 * 需要登录：未登录直接返回 null，不产生请求（避免匿名请求被 401 刷屏）。
 */
export async function refreshAiStatus() {
  if (aiStatusBusy.value) return aiStatus.value
  aiStatusBusy.value = true
  try {
    const data = await request('/ai/status')
    aiStatus.value = data || null
    aiStatusError.value = ''
    return aiStatus.value
  } catch (e) {
    aiStatus.value = null
    aiStatusError.value = e instanceof ApiError && e.status === 401
      ? '登录后才能使用 AI 功能'
      : (e?.message || '无法连接 AI 服务')
    return null
  } finally {
    aiStatusBusy.value = false
  }
}

/** 功能是否可用（开关打开 + 节点在线）。未探测过按「不可用」处理，避免误报可用 */
export const aiReady = computed(() => !!(aiStatus.value && aiStatus.value.enabled && aiStatus.value.reachable))

/** 给用户看的不可用原因；可用时返回空串 */
export const aiUnavailableReason = computed(() => {
  if (aiReady.value) return ''
  if (aiStatusError.value) return aiStatusError.value
  if (!aiStatus.value) return 'AI 服务状态未知，请稍后重试'
  if (!aiStatus.value.enabled) return 'AI 功能尚未开启'
  if (!aiStatus.value.reachable) return aiStatus.value.message || 'AI 推理节点当前离线'
  return ''
})

/**
 * 上传一张图作为 AI 任务的输入，返回 asset_id。
 * @param {File|Blob} file
 * @param {(percent:number)=>void} [onProgress]
 */
export async function uploadAiInput(file, onProgress) {
  if (!file) throw new ApiError('请先选择一张图片')
  const fd = new FormData()
  fd.append('file', file, file.name || 'input.png')
  // 注意：upload() 默认用后台令牌，前台必须显式传 userTokens
  return upload('/ai/uploads', fd, { onProgress })
}

/**
 * 提交任务，返回任务对象（含 id）。
 * @param {{kind:string, inputAssetId?:number, prompt?:string, negativePrompt?:string,
 *          denoise?:number, width?:number, height?:number, seed?:number,
 *          alphaMatting?:boolean, idempotencyKey?:string}} params
 */
export async function submitAiJob(params) {
  const body = {
    kind: params.kind,
    input_asset_id: params.inputAssetId || 0,
    idempotency_key: params.idempotencyKey || ''
  }
  if (params.prompt !== undefined) body.prompt = params.prompt
  if (params.negativePrompt !== undefined) body.negative_prompt = params.negativePrompt
  if (params.denoise !== undefined) body.denoise = params.denoise
  if (params.width !== undefined) body.width = params.width
  if (params.height !== undefined) body.height = params.height
  if (params.seed !== undefined) body.seed = params.seed
  if (params.alphaMatting !== undefined) body.alpha_matting = params.alphaMatting
  return request('/ai/jobs', { method: 'POST', body })
}

/** 查单个任务状态 */
export async function getAiJob(jobId) {
  return request(`/ai/jobs/${jobId}`)
}

/** 我的任务列表 */
export async function listAiJobs(query = {}) {
  return request('/ai/jobs', { query })
}

/** 取消任务（排队中的立即生效；正在跑的只能尽力而为） */
export async function cancelAiJob(jobId) {
  return request(`/ai/jobs/${jobId}/cancel`, { method: 'POST' })
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 提交并轮询到结束。
 *
 * @param {object} params            同 submitAiJob
 * @param {object} [opts]
 * @param {(job:object)=>void} [opts.onTick]   每次轮询回调（界面更新进度用）
 * @param {number} [opts.intervalMs]           轮询间隔，默认 1.5s
 * @param {number} [opts.timeoutMs]            总超时，默认 10 分钟（与后端 job_timeout 对齐）
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok:boolean, job?:object, reason?:string, code?:number}>}
 */
export async function runAiJob(params, opts = {}) {
  const { onTick, intervalMs = 1500, timeoutMs = 10 * 60 * 1000, signal } = opts

  let created
  try {
    created = await submitAiJob(params)
  } catch (e) {
    // 排队已满 / 功能未开 / 参数问题都在这里落地成可读提示
    const code = e instanceof ApiError ? e.code : 0
    const reason = e?.message || '提交任务失败'
    if (code === AI_CODE.QUEUE_FULL || code === AI_CODE.NOT_ENABLED) {
      toastWarn(reason)
    } else {
      toastErr(reason)
    }
    return { ok: false, reason, code }
  }

  const job = created?.job
  if (!job?.id) {
    toastErr('服务端没有返回任务号')
    return { ok: false, reason: '服务端没有返回任务号' }
  }
  if (created.deduplicated) {
    toastOk('这次提交与之前的任务重复，已复用同一个任务')
  }
  activeJobs.value = { ...activeJobs.value, [job.id]: job }
  if (onTick) onTick(job)

  const started = Date.now()
  let current = job
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) return { ok: false, reason: '已取消' }
    if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'canceled') break
    await sleep(intervalMs)
    try {
      current = await getAiJob(job.id)
    } catch {
      // 单次轮询失败不致命（网络抖动），下一轮再试；一直失败会走超时
      continue
    }
    activeJobs.value = { ...activeJobs.value, [job.id]: current }
    if (onTick) onTick(current)
  }

  const done = { ...activeJobs.value }
  delete done[job.id]
  activeJobs.value = done

  if (current.status === 'succeeded') return { ok: true, job: current }
  if (current.status === 'canceled') return { ok: false, job: current, reason: '任务已取消' }
  if (current.status === 'failed') {
    return { ok: false, job: current, reason: current.error_message || '生成失败', code: current.error_code }
  }
  return { ok: false, job: current, reason: '任务超时，请稍后在「我的 AI 任务」里查看' }
}

/** 取任务产物 URL（成功任务才有） */
export function aiJobOutputUrl(job) {
  return job?.output_url || ''
}

/**
 * 把 AI 产物加载进工作台。
 *
 * 产物在**服务端**生成，所以要先经网络把图取回来（storage 的公开 URL，与站点同源），
 * 再交给 useStudio 的加载入口 —— 这与本地四条图片入口不同。
 *
 * 用动态 import 避免 useStudio ↔ useAI 的循环依赖：
 * useStudio 会 import useAI（为了工作台里的 AI 入口），这里又需要 useStudio 的加载函数。
 */
export async function applyAiResultToStudio(job, name) {
  if (!job?.output_url) {
    toastErr('任务没有产物地址')
    return { ok: false }
  }
  const { loadImageFromUrl, loadImageSource } = await import('./useStudio.js')
  try {
    const img = await loadImageFromUrl(job.output_url)
    loadImageSource(img, job.output_url, name || `AI ${job.kind_cn || job.kind}`, 'ai')
    return { ok: true }
  } catch (e) {
    toastErr('AI 结果加载失败：' + (e?.message || '未知错误'))
    return { ok: false }
  }
}

/** 检查某个 AI 能力是否被套餐允许；不允许时给 toast（返回 gate 供调用方决定是否中断） */
export function gateAi(feature) {
  const gate = check(feature)
  if (!gate.ok) toastWarn(gate.reason)
  return gate
}

/** 供界面直接显示的队列情况（未探测过时为空） */
export const aiQueue = computed(() => aiStatus.value?.queue || null)
