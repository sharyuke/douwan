/* =========================================================================
   统一 API 客户端（前台 + 后台共用）
   - 同源部署：base 用 '/api/v1'，线上由 nginx 反代，开发时由 vite proxy 转发
   - 业务码判定：HTTP 200 只代表传输成功，body.code === 0 才是业务成功
   - 收到 20002（访问令牌过期）自动用 refresh_token 换新令牌并重放一次
   - 401 且无法刷新时抛 ApiError，调用方负责跳登录页
   ========================================================================= */

const BASE = '/api/v1'

/** 业务错误码（与服务端 internal/response/errors.go 对齐，只列前端会用到的） */
export const CODE = {
  OK: 0,
  INVALID_PARAM: 10001,
  NOT_FOUND: 10404,
  TOO_MANY: 10429,
  INTERNAL: 10500,
  UNAUTHORIZED: 20001,
  TOKEN_EXPIRED: 20002,
  TOKEN_INVALID: 20003,
  PASSWORD_WRONG: 20004,
  ACCOUNT_DISABLED: 20005,
  FORBIDDEN: 20403,
  USER_NOT_FOUND: 30001,
  USER_EXISTS: 30002,
  // 第三方登录 31xxx
  OAUTH_NOT_CONFIGURED: 31001,
  OAUTH_FAILED: 31002,
  OAUTH_STATE_INVALID: 31003,
  IDENTITY_NOT_FOUND: 31004,
  IDENTITY_BOUND: 31005,
  IDENTITY_LAST: 31006,
  // 后台 40xxx：把最常被用户看到的几个也列出来，便于按码做特殊处理
  CARD_NOT_FOUND: 40008,
  CARD_USED: 40009,
  CARD_EXPIRED: 40010,
  CARD_VOIDED: 40011,
  ORDER_NOT_PAID: 40015,
  ALREADY_ISSUED: 40017,
  UPLOAD_REJECTED: 40022
}

/** 令牌失效（需要重新登录）的业务码 */
const AUTH_FAILED_CODES = [CODE.UNAUTHORIZED, CODE.TOKEN_INVALID, CODE.ACCOUNT_DISABLED]

/** 统一的接口错误 */
export class ApiError extends Error {
  constructor(message, { code = 0, status = 0, requestId = '', data = null } = {}) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
    this.data = data
  }

  /** 是否需要重新登录 */
  get needLogin() {
    return AUTH_FAILED_CODES.includes(this.code)
  }

  /** 是否是权限不足（不是登录问题） */
  get forbidden() {
    return this.code === CODE.FORBIDDEN
  }
}

/* ------------------------------------------------------------------ 令牌存储 */

/**
 * 令牌仓库。后台与前台各存一份，互不影响（两套令牌不能混用）。
 * 用 localStorage 而不是内存：刷新页面不该掉登录态。
 */
class TokenBox {
  constructor(prefix) {
    this.key = prefix + '-tokens'
  }

  read() {
    try {
      const raw = localStorage.getItem(this.key)
      if (!raw) return null
      const value = JSON.parse(raw)
      return value && typeof value === 'object' ? value : null
    } catch {
      return null
    }
  }

  write(tokens) {
    try {
      if (tokens) localStorage.setItem(this.key, JSON.stringify(tokens))
      else localStorage.removeItem(this.key)
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  get access() {
    const t = this.read()
    return (t && t.access_token) || ''
  }

  get refresh() {
    const t = this.read()
    return (t && t.refresh_token) || ''
  }

  clear() {
    this.write(null)
  }
}

export const adminTokens = new TokenBox('douwan-admin')
export const userTokens = new TokenBox('douwan-user')

/* ------------------------------------------------------------------ 核心请求 */

/** 并发请求只触发一次刷新：后来的请求等同一个 Promise */
let refreshInFlight = null

/**
 * 发一个 JSON 请求。
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.path        以 / 开头的路径，例如 '/admin/plans'
 * @param {object} [opts.body]      JSON 请求体
 * @param {URLSearchParams|object} [opts.query]
 * @param {TokenBox} [opts.tokens]  用哪套令牌（默认前台）
 * @param {boolean} [opts.auth]     是否附带 Authorization（默认自动判断）
 * @param {boolean} [opts.raw]      true 时返回 Response（下载文件用）
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.noRefresh] 401 时不尝试刷新（刷新接口自己用）
 */
export async function request(path, opts = {}) {
  const {
    method = 'GET',
    body,
    query,
    tokens = userTokens,
    auth,
    raw = false,
    signal,
    noRefresh = false
  } = opts

  const url = BASE + path + buildQuery(query)
  const headers = {}
  const useAuth = auth === undefined ? true : auth
  const token = useAuth ? tokens.access : ''
  if (token) headers.Authorization = 'Bearer ' + token
  let payload
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      // FormData 不能手动设 Content-Type：要让浏览器自己带 boundary
      payload = body
    } else {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }

  let response
  try {
    response = await fetch(url, { method, headers, body: payload, signal })
  } catch (e) {
    if (e && e.name === 'AbortError') throw e
    throw new ApiError('网络连接失败，请检查网络后重试', { code: -1 })
  }

  // 访问令牌过期：刷新一次再重放
  if (response.status === 401 && !noRefresh && tokens.refresh) {
    const refreshed = await refreshTokens(tokens)
    if (refreshed) {
      return request(path, { ...opts, noRefresh: true })
    }
    tokens.clear()
  }

  if (raw) {
    if (!response.ok) {
      throw await toError(response)
    }
    return response
  }

  // 204 / 空响应
  const text = await response.text()
  if (!text) {
    if (!response.ok) {
      throw new ApiError('请求失败（HTTP ' + response.status + '）', { status: response.status })
    }
    return null
  }

  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new ApiError('服务端返回了无法解析的内容', { status: response.status })
  }

  if (envelope.code !== CODE.OK) {
    throw new ApiError(envelope.message || '请求失败', {
      code: envelope.code,
      status: response.status,
      requestId: envelope.request_id,
      data: envelope.data
    })
  }
  return envelope.data
}

/** 上传文件（带进度回调）。 */
export function upload(path, formData, { tokens = adminTokens, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', BASE + path)
    const token = tokens.access
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.responseType = 'text'
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort())
    }
    xhr.upload.onprogress = e => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onerror = () => reject(new ApiError('上传失败，请检查网络后重试', { code: -1 }))
    xhr.onabort = () => reject(new ApiError('上传已取消', { code: -1 }))
    xhr.onload = () => {
      let envelope = null
      try {
        envelope = JSON.parse(xhr.responseText || '{}')
      } catch {
        reject(new ApiError('服务端返回了无法解析的内容', { status: xhr.status }))
        return
      }
      if (envelope.code === CODE.OK) {
        resolve(envelope.data)
        return
      }
      reject(new ApiError(envelope.message || '上传失败', {
        code: envelope.code,
        status: xhr.status,
        requestId: envelope.request_id,
        data: envelope.data
      }))
    }
    xhr.send(formData)
  })
}

/** 下载文件（CSV 导出）。返回 { blob, filename }。 */
export async function download(path, body, { tokens = adminTokens } = {}) {
  const response = await request(path, { method: 'POST', body, tokens, raw: true })
  const blob = await response.blob()
  return { blob, filename: parseFilename(response.headers.get('Content-Disposition')) }
}

/* ------------------------------------------------------------------ 刷新令牌 */

/** 用 refresh_token 换新令牌。多并发只发一次请求。 */
async function refreshTokens(tokens) {
  if (refreshInFlight) return refreshInFlight
  const refreshToken = tokens.refresh
  if (!refreshToken) return false

  const isAdmin = tokens === adminTokens
  const path = isAdmin ? '/admin/auth/refresh' : '/auth/refresh'

  refreshInFlight = (async () => {
    try {
      const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      })
      const text = await res.text()
      const envelope = text ? JSON.parse(text) : {}
      if (!res.ok || envelope.code !== CODE.OK || !envelope.data) return false
      const payload = envelope.data
      tokens.write(payload.tokens || payload)
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/* ------------------------------------------------------------------ 工具 */

function buildQuery(query) {
  if (!query) return ''
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(clean(query))
  const s = params.toString()
  return s ? '?' + s : ''
}

/** 去掉 undefined / null / 空字符串，避免把空筛选条件发给服务端 */
function clean(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

function parseFilename(disposition) {
  if (!disposition) return 'export.csv'
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* 落到下面的普通 filename */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1] : 'export.csv'
}

async function toError(response) {
  try {
    const text = await response.text()
    const envelope = JSON.parse(text || '{}')
    return new ApiError(envelope.message || '请求失败', {
      code: envelope.code,
      status: response.status,
      requestId: envelope.request_id
    })
  } catch {
    return new ApiError('请求失败（HTTP ' + response.status + '）', { status: response.status })
  }
}

/* ------------------------------------------------------------------ 便捷方法 */

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' })
}

/**
 * 前台意见反馈。
 *
 * 匿名也能提交：request 默认会带上登录令牌（如果有），
 * 服务端用 OptionalAuth 把登录用户关联到反馈上，没登录也照收。
 */
export const feedbackApi = {
  submit: body => api.post('/feedback', body)
}

/* ------------------------------------------------------------------ 通用格式化 */

/** 金额：两位小数，带 ¥ */
export function money(value) {
  const n = Number(value || 0)
  return '¥' + n.toFixed(2)
}

/** 金额（不带符号，表格里用） */
export function moneyPlain(value) {
  return Number(value || 0).toFixed(2)
}

/**
 * 时间：后端返回 RFC3339（带时区），这里按浏览器本地时区展示。
 * 「按项目约定时区展示」——线上服务与浏览器都在 +08，不做额外转换。
 */
export function datetime(value, { withTime = true } = {}) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = n => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (!withTime) return date
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间：3 分钟前 / 2 天前 */
export function fromNow(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const abs = Math.abs(diff)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (abs < minute) return '刚刚'
  if (abs < hour) return Math.floor(abs / minute) + ' 分钟前'
  if (abs < day) return Math.floor(abs / hour) + ' 小时前'
  if (abs < 30 * day) return Math.floor(abs / day) + ' 天前'
  return datetime(value, { withTime: false })
}

/** 文件大小 */
export function fileSize(bytes) {
  const n = Number(bytes || 0)
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB'
  if (n >= 1 << 10) return Math.round(n / (1 << 10)) + ' KB'
  return n + ' B'
}

/** 把筛选条件同步到地址栏（刷新后保留筛选） */
export function syncQuery(router, route, patch) {
  const next = { ...route.query, ...patch }
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null || v === '') delete next[k]
  }
  router.replace({ query: next })
}
