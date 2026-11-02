/* =========================================================================
   后台管理接口封装
   - 路径与 internal/router/router.go 里的 /api/v1/admin 路由一一对应
   - 这一层只做「拼参数 + 调接口」，不做业务判断，便于对照后端文档排查
   - 令牌一律用 adminTokens（后台专属），与前台用户令牌完全隔离
   ========================================================================= */

import { api, download, upload, adminTokens } from './api.js'

const opts = extra => ({ tokens: adminTokens, ...extra })

/* ------------------------------------------------------------------ 鉴权 */

export const authApi = {
  login: (account, password) =>
    api.post('/admin/auth/login', { account, password }, { tokens: adminTokens, auth: false }),
  logout: refreshToken => api.post('/admin/auth/logout', { refresh_token: refreshToken }, opts()),
  me: () => api.get('/admin/auth/me', opts()),
  changePassword: (oldPassword, newPassword) =>
    api.post('/admin/auth/password', { old_password: oldPassword, new_password: newPassword }, opts()),
  permissions: () => api.get('/admin/permissions', opts()),
  listAdmins: query => api.get('/admin/admins', { ...opts(), query }),
  createAdmin: body => api.post('/admin/admins', body, opts()),
  updateAdmin: (id, body) => api.patch(`/admin/admins/${id}`, body, opts()),
  resetAdminPassword: (id, newPassword) =>
    api.post(`/admin/admins/${id}/password`, { new_password: newPassword }, opts()),
  setAdminStatus: (id, status, reason) =>
    api.patch(`/admin/admins/${id}/status`, { status, reason }, opts()),
  deleteAdmin: id => api.del(`/admin/admins/${id}`, opts())
}

/* ------------------------------------------------------------------ 概览 */

export const overviewApi = {
  load: () => api.get('/admin/overview', opts())
}

/* ------------------------------------------------------------------ 用户活跃监控 */

/**
 * 用户活跃数据监控（后端 douwan-api/internal/handler/activity.go）。
 * 通用查询参数 `days` 是统计窗口（最近 N 天，1~90，默认 30），regions / features 还有 `limit`，
 * users 支持分页与筛选。口径（留存 eligible、功能按来源拆分、地区百分比的分母）
 * 见后端 docs/activity.md，页面上的说明文案与它保持一致。
 */
export const activityApi = {
  overview: query => api.get('/admin/activity/overview', { ...opts(), query }),
  retention: query => api.get('/admin/activity/retention', { ...opts(), query }),
  frequency: query => api.get('/admin/activity/frequency', { ...opts(), query }),
  regions: query => api.get('/admin/activity/regions', { ...opts(), query }),
  features: query => api.get('/admin/activity/features', { ...opts(), query }),
  channels: query => api.get('/admin/activity/channels', { ...opts(), query }),
  users: query => api.get('/admin/activity/users', { ...opts(), query }),
  userDetail: (id, query) => api.get(`/admin/activity/users/${id}`, { ...opts(), query }),
  /**
   * 站点访问量（PV / UV，含未登录访客）：/admin/activity/traffic。
   * 与「用户活跃」是两套口径（一个按登录账号去重、一个按浏览器访客标识去重），
   * 数字不能互相加减；`limit` 控制页面排行 / 落地页返回条数。
   */
  traffic: query => api.get('/admin/activity/traffic', { ...opts(), query }),
  /** 访客明细：可按页面 / 渠道筛选，page_size 同其它列表接口 */
  trafficVisitors: query => api.get('/admin/activity/traffic/visitors', { ...opts(), query }),
  /**
   * 监控排除名单：把「自己（站点主人）的访问」从统计里扣掉。
   * 名单支持三种方式：ip（整个 IP）、visitor（某个浏览器）、user（某个前台账号）。
   * 命中名单的访问不计入 PV / UV / DAU，但剔掉了多少会在卡片里单独报出来。
   */
  exclusions: () => api.get('/admin/activity/exclusions', opts()),
  addExclusion: body => api.post('/admin/activity/exclusions', body, opts()),
  deleteExclusion: id => api.del(`/admin/activity/exclusions/${id}`, opts())
}

/* ------------------------------------------------------------------ SEO 管理 */

/**
 * SEO 管理（后端 douwan-api/internal/handler/seo.go）。
 * 口径：这里所有「成功/失败/待推送」都只是**我们发出的通知**，
 * 不代表搜索引擎已抓取或已收录；收录数据要等接了站长平台官方接口才有。
 */
export const seoApi = {
  /** 概览：可索引页面数、Sitemap/robots 状态、各引擎推送统计、最近任务、最近巡检 */
  overview: () => api.get('/admin/seo/overview', opts()),
  /** 可索引页面清单（可编辑素材 / 分类的 SEO 标题与描述） */
  pages: query => api.get('/admin/seo/pages', { ...opts(), query }),
  /** 推送任务历史 */
  tasks: query => api.get('/admin/seo/tasks', { ...opts(), query }),
  /** 手动推送：paths 传路径数组，all=true 表示全部页面 */
  push: body => api.post('/admin/seo/push', body, opts()),
  /** 立刻跑一次巡检 */
  check: () => api.post('/admin/seo/check', {}, opts()),
  /** 修改素材 / 分类的 SEO 文案（kind: material | material_category） */
  updatePage: (kind, id, body) => api.patch(`/admin/seo/pages/${kind}/${id}`, body, opts()),
  /** 各推送通道的配置状态（只有布尔值，不含任何密钥明文） */
  config: () => api.get('/admin/seo/config', opts()),
  /**
   * 按模板重算素材 / 分类的自动 SEO 文案。
   * 人工写过的文案（seo_auto = false）不会被覆盖。
   */
  regenerate: () => api.post('/admin/seo/regenerate', {}, opts())
}

/* ------------------------------------------------------------------ 关键词管理 */

/**
 * 搜索关键词管理（V3.0，后端 douwan-api/internal/handler/seo_keyword.go）。
 * 口径红线：曝光 / 点击 / 点击率 / 平均排名只来自官方站长平台接口或人工导入的 CSV，
 * 没有数据源时接口返回 null，前端一律显示「暂无数据」，不用 0 冒充。
 */
export const seoKeywordApi = {
  /** 关键词列表：group / intent / status / engine / target_path / keyword + 排序与数值筛选 */
  list: query => api.get('/admin/seo/keywords', { ...opts(), query }),
  /** 基础信息：分组、意图、目标页面清单、数据来源 */
  meta: () => api.get('/admin/seo/keywords/meta', opts()),
  /** 多个页面争抢同一个核心搜索意图 */
  conflicts: () => api.get('/admin/seo/keywords/conflicts', opts()),
  /** 页面缺 Title / Description / H1 的自检 */
  checks: () => api.get('/admin/seo/keywords/checks', opts()),
  /** 低点击率但有曝光的优化候选（没有搜索数据时返回空） */
  candidates: query => api.get('/admin/seo/keywords/candidates', { ...opts(), query }),
  /** 新增关键词 */
  create: body => api.post('/admin/seo/keywords', body, opts()),
  /** 修改关键词 */
  update: (id, body) => api.patch(`/admin/seo/keywords/${id}`, body, opts()),
  /** 删除关键词 */
  remove: id => api.del(`/admin/seo/keywords/${id}`, opts()),
  /** CSV 导入：body = { csv, engine, update_stats } */
  import: body => api.post('/admin/seo/keywords/import', body, opts()),
  /** 同步内置初始关键词库（幂等） */
  sync: () => api.post('/admin/seo/keywords/sync', {}, opts()),
  /** 从 Google Search Console 拉搜索表现：body = { start_date, end_date } */
  searchConsole: body => api.post('/admin/seo/keywords/search-console', body, opts())
}

/* ------------------------------------------------------------------ 套餐 */

export const planApi = {
  list: query => api.get('/admin/plans', { ...opts(), query }),
  options: () => api.get('/admin/plans/options', opts()),
  detail: id => api.get(`/admin/plans/${id}`, opts()),
  preview: id => api.get(`/admin/plans/${id}/preview`, opts()),
  create: body => api.post('/admin/plans', body, opts()),
  update: (id, body) => api.put(`/admin/plans/${id}`, body, opts()),
  setStatus: (id, status, reason) => api.patch(`/admin/plans/${id}/status`, { status, reason }, opts()),
  duplicate: id => api.post(`/admin/plans/${id}/duplicate`, {}, opts()),
  remove: (id, reason) => api.del(`/admin/plans/${id}${reason ? '?reason=' + encodeURIComponent(reason) : ''}`, opts()),
  seedDrafts: () => api.post('/admin/plans/drafts', {}, opts())
}

/* ------------------------------------------------------------------ 卡密 */

export const cardApi = {
  list: query => api.get('/admin/card-keys', { ...opts(), query }),
  meta: () => api.get('/admin/card-keys/meta', opts()),
  batches: query => api.get('/admin/card-keys/batches', { ...opts(), query }),
  generate: body => api.post('/admin/card-keys/generate', body, opts()),
  reveal: ids => api.post('/admin/card-keys/reveal', { ids }, opts()),
  void: (ids, reason) => api.post('/admin/card-keys/void', { ids, reason }, opts()),
  export: async body => {
    const { blob, filename } = await download('/admin/card-keys/export', body, opts())
    saveBlob(blob, filename)
    return filename
  }
}

/* ------------------------------------------------------------------ 订单 */

export const orderApi = {
  list: query => api.get('/admin/orders', { ...opts(), query }),
  detail: id => api.get(`/admin/orders/${id}`, opts()),
  settle: (id, body) => api.post(`/admin/orders/${id}/settle`, body, opts()),
  issue: (id, note) => api.post(`/admin/orders/${id}/issue`, { note }, opts()),
  close: (id, reason) => api.post(`/admin/orders/${id}/close`, { reason }, opts()),
  refund: (id, note) => api.post(`/admin/orders/${id}/refund`, { note }, opts())
}

/* ------------------------------------------------------------------ 素材 */

export const assetApi = {
  list: query => api.get('/admin/assets', { ...opts(), query }),
  detail: id => api.get(`/admin/assets/${id}`, opts()),
  tags: () => api.get('/admin/assets/tags', opts()),
  update: (id, body) => api.patch(`/admin/assets/${id}`, body, opts()),
  setStatus: (id, status, reason) => api.patch(`/admin/assets/${id}/status`, { status, reason }, opts()),
  batchSort: items => api.post('/admin/assets/sort', { items }, opts()),
  /** 批量修改：ids + 要改的字段（分类 / 状态 / 分层 / 推荐 / 排序 / 标签） */
  batchUpdate: body => api.post('/admin/assets/batch', body, opts()),
  remove: (id, reason) =>
    api.del(`/admin/assets/${id}${reason ? '?reason=' + encodeURIComponent(reason) : ''}`, opts()),
  /** 上传：files 是 File[]，fields 是其余表单字段 */
  upload: (files, fields, onProgress, signal) => {
    const form = new FormData()
    for (const file of files) form.append('files', file)
    for (const [k, v] of Object.entries(fields || {})) {
      if (v === undefined || v === null || v === '') continue
      form.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v))
    }
    return upload('/admin/assets/upload', form, { tokens: adminTokens, onProgress, signal })
  },
  categories: query => api.get('/admin/asset-categories', { ...opts(), query }),
  categoryOptions: onlyEnabled => api.get(`/admin/asset-categories/options${onlyEnabled ? '?only_enabled=true' : ''}`, opts()),
  createCategory: body => api.post('/admin/asset-categories', body, opts()),
  updateCategory: (id, body) => api.put(`/admin/asset-categories/${id}`, body, opts()),
  removeCategory: id => api.del(`/admin/asset-categories/${id}`, opts())
}

/* ------------------------------------------------------------------ 用户与权益 */

export const userApi = {
  list: query => api.get('/admin/users', { ...opts(), query }),
  detail: id => api.get(`/admin/users/${id}`, opts()),
  entitlements: query => api.get('/admin/entitlements', { ...opts(), query }),
  grant: body => api.post('/admin/entitlements', body, opts()),
  revoke: (id, reason) => api.post(`/admin/entitlements/${id}/revoke`, { reason }, opts())
}

/* ------------------------------------------------------------------ 设置与日志 */

export const settingApi = {
  list: () => api.get('/admin/settings', opts()),
  update: items => api.put('/admin/settings', { items }, opts())
}

export const logApi = {
  list: query => api.get('/admin/logs', { ...opts(), query })
}

/* ------------------------------------------------------------------ 意见反馈 */

export const feedbackApi = {
  list: query => api.get('/admin/feedback', { ...opts(), query }),
  detail: id => api.get(`/admin/feedback/${id}`, opts()),
  handle: (id, body) => api.patch(`/admin/feedback/${id}`, body, opts()),
  remove: id => api.del(`/admin/feedback/${id}`, opts())
}

/* ------------------------------------------------------------------ 前台衔接 */

/** 这些接口不需要登录，前台页面也能用 */
export const publicApi = {
  plans: () => api.get('/plans', { auth: false }),
  settings: () => api.get('/settings/public', { auth: false }),
  assets: query => api.get('/assets', { auth: false, query }),
  assetDetail: slug => api.get(`/assets/${slug}`, { auth: false }),
  assetCategories: () => api.get('/assets/categories', { auth: false })
}

/* ------------------------------------------------------------------ 工具 */

/** 触发浏览器下载 */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'export.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立刻 revoke 会让部分浏览器来不及开始下载，延后一点
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 把对象转成 CSV 文本（用于「复制到剪贴板」这类轻量导出） */
export function toCSV(rows, headers) {
  const escape = v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  return lines.join('\n')
}
