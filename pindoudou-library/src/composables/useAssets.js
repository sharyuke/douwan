/* =========================================================================
   素材中心（PRD §22 / §55）
   - 分类 / 搜索 / 收藏 / 一键生成
   - 免费与会员分层：锁定的素材照常可见（权限由 entitlement 判定，
     点击时给出明确原因与升级引导，而不是把卡片藏起来 —— PRD §43）
   - 后台「素材库管理」上传并**发布**的图片素材也在这里展示：
     静态内置素材负责「开箱即用」，后台素材负责「运营随时上新」。
   ========================================================================= */

import { computed, ref } from 'vue'
import {
  ASSETS, COLLECTIONS, filterAssets as filterStaticAssets, assetById as staticAssetById,
  assetByName as staticAssetByName,
  featuredAssets, hotAssets, newAssets, freeAssets, proAssets
} from '../data/assets.js'
import { api } from '../lib/api.js'
import { check } from './useMembership.js'
import { toastOk, toastWarn, toastErr } from './useToast.js'
import { useAsset, useImageFile } from './useStudio.js'

export {
  ASSETS, COLLECTIONS, featuredAssets, hotAssets, newAssets, freeAssets, proAssets
}

/* ------------------------------------------------------------------ 后台素材 */

/** 后台已发布素材（/api/v1/assets），归一化成和内置素材同一套字段 */
export const remoteAssets = ref([])
export const remoteLoaded = ref(false)
export const remoteLoading = ref(false)
export const remoteError = ref('')
let remotePending = null

function normalizeRemote(a, catSlug) {
  const image = a.thumbnail_url || a.image_url || ''
  const published = a.published_at ? new Date(a.published_at).getTime() : 0
  return {
    id: `api-${a.id}`,
    remote: true,
    remoteId: a.id,
    slug: a.slug || '',
    name: a.title || '未命名素材',
    cat: a.category_name || '平台素材',
    cols: catSlug ? [catSlug] : [],
    tier: a.tier === 'pro' ? 'pro' : 'free',
    image,
    imageFull: a.image_url || image,
    imageWidth: Number(a.image_width) || 0,
    imageHeight: Number(a.image_height) || 0,
    createdAt: published,
    description: a.description || '',
    tags: Array.isArray(a.tags) ? a.tags : [],
    hot: Number(a.sort_order) || 0,
    feat: !!a.is_featured,
    isNew: published > 0 && Date.now() - published < 30 * 24 * 3600 * 1000,
    difficulty: '图片素材',
    size: a.image_width && a.image_height ? `${a.image_width} × ${a.image_height}` : '—',
    grid: 0,
    boards: 0,
    colors: 0,
    beads: 0,
    minutes: 0
  }
}

/**
 * 拉取后台已发布素材。只请求一次，失败时静默降级到内置素材。
 * 分类接口用来把 category_id 换成 slug，才能和前台分类标签对上。
 */
export function loadRemoteAssets() {
  if (remoteLoaded.value) return Promise.resolve(remoteAssets.value)
  if (remotePending) return remotePending
  remotePending = (async () => {
    remoteLoading.value = true
    remoteError.value = ''
    try {
      const [cats, data] = await Promise.all([
        api.get('/assets/categories', { auth: false }),
        api.get('/assets', { auth: false, query: { page_size: 200 } })
      ])
      const slugById = new Map((Array.isArray(cats) ? cats : []).map(c => [c.id, c.slug]))
      const list = (data && Array.isArray(data.list)) ? data.list : []
      remoteAssets.value = list.map(a => normalizeRemote(a, slugById.get(a.category_id) || ''))
      remoteLoaded.value = true
    } catch (e) {
      remoteError.value = e instanceof Error ? e.message : '素材加载失败'
    } finally {
      remoteLoading.value = false
      remotePending = null
    }
  })()
  return remotePending
}

/** 内置 + 后台已发布素材；后台素材排前面，刚上传的更容易被看到 */
export const allAssets = computed(() => [...remoteAssets.value, ...ASSETS])

const FAV_KEY = 'douzao-asset-favorites'

function readFavs() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/** 我收藏的素材 id（PRD P1：素材收藏） */
export const favorites = ref(readFavs())

function saveFavs(list) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export function isFavorite(id) {
  return favorites.value.includes(id)
}

export function toggleFavorite(id) {
  const before = favorites.value
  const next = before.includes(id)
    ? before.filter(x => x !== id)
    : [...before, id]
  favorites.value = next
  /* 写入失败（隐私模式 / 存储被禁用）时回滚，避免界面显示已收藏、刷新后丢失 */
  if (!saveFavs(next)) {
    favorites.value = before
    toastErr('收藏没有保存成功，请检查浏览器存储权限')
    return false
  }
  toastOk(next.includes(id) ? '已收藏' : '已取消收藏')
  return true
}

/* ------------------------------------------------------------------ 筛选状态 */

export const libCol = ref('all')
export const libKeyword = ref('')
export const libTier = ref('all')

export function setCollection(key) {
  libCol.value = key
}

/** 后台素材没有「颜色数 / 分钟数」这些内置素材的统计，按分类 / 关键词 / 会员层筛选 */
function filterRemote({ col = 'all', keyword = '', tier = 'all' } = {}) {
  let list = remoteAssets.value
  if (col === 'free') list = list.filter(a => a.tier === 'free')
  else if (col === 'hot') list = list.slice().sort((a, b) => b.hot - a.hot)
  else if (col === 'new') list = list.filter(a => a.isNew)
  else if (col === 'quick') list = []
  else if (col && col !== 'all') list = list.filter(a => a.cols.includes(col))
  if (tier !== 'all') list = list.filter(a => a.tier === tier)
  const kw = String(keyword || '').trim().toLowerCase()
  if (kw) {
    list = list.filter(a =>
      a.name.toLowerCase().includes(kw) ||
      a.cat.toLowerCase().includes(kw) ||
      a.description.toLowerCase().includes(kw) ||
      a.tags.some(t => String(t).toLowerCase().includes(kw))
    )
  }
  return list
}

export const collectionAssets = computed(() => {
  // 「我的收藏」不是素材库里的分类，单独在这里处理
  if (libCol.value === 'fav') {
    const ids = favorites.value
    return allAssets.value.filter(a => ids.includes(a.id))
  }
  const local = filterStaticAssets({ col: libCol.value, keyword: libKeyword.value, tier: libTier.value })
  const remote = filterRemote({ col: libCol.value, keyword: libKeyword.value, tier: libTier.value })
  return [...remote, ...local]
})

export const favoriteAssets = computed(() => allAssets.value.filter(a => favorites.value.includes(a.id)))

export const freeCount = computed(() => freeAssets.length)
export const proCount = computed(() => proAssets.length)

/** 每个分类下的素材数量（给分类标签加角标用） */
export const collectionCounts = computed(() => {
  const map = {}
  for (const c of COLLECTIONS) {
    map[c.key] = filterStaticAssets({ col: c.key }).length + filterRemote({ col: c.key }).length
  }
  return map
})

/** 素材库总数（内置 + 后台已发布），页面文案用 */
export const ASSET_COUNT = computed(() => ASSETS.length + remoteAssets.value.length)

/* ------------------------------------------------------------------ 会员锁定 */

export function isLocked(asset) {
  if (!asset || asset.tier !== 'pro') return false
  return !check('assets.pro').ok
}

/** 把后台素材的原图下载成 File，走和用户上传照片完全相同的生成链路 */
async function useRemoteAsset(asset) {
  const url = asset.imageFull || asset.image
  if (!url) throw new Error('素材没有图片地址')
  const res = await fetch(url)
  if (!res.ok) throw new Error('素材图片下载失败')
  const blob = await res.blob()
  const type = blob.type || 'image/jpeg'
  const ext = (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const safeName = String(asset.name || '素材').replace(/[\\/:*?"<>|]/g, '_')
  const file = new File([blob], `${safeName}.${ext}`, { type })
  return useImageFile(file)
}

/** 尝试使用素材：被锁定时返回原因而不是静默失败 */
export async function pickAsset(id) {
  const asset = typeof id === 'object' ? id : assetById(id)
  if (!asset) {
    toastErr('素材不存在')
    return { ok: false }
  }
  const gate = check('assets.pro')
  if (asset.tier === 'pro' && !gate.ok) {
    toastWarn(`「${asset.name}」是会员专属素材。${gate.reason}`)
    return { ok: false, needPro: true, asset }
  }
  try {
    const ok = asset.remote ? await useRemoteAsset(asset) : await useAsset(asset)
    if (ok) toastOk(`已载入「${asset.name}」并生成图纸`)
    return { ok, asset }
  } catch (e) {
    toastErr('素材加载失败，请重试')
    return { ok: false }
  }
}

/** 供「一句话创作」调用的关键词匹配（精确名 → 模糊） */
export function matchKeyword(kw) {
  const key = String(kw || '').trim()
  if (!key) return null
  const exact = staticAssetByName(key)
  if (exact) return exact
  const lower = key.toLowerCase()
  return (
    remoteAssets.value.find(a => a.name.toLowerCase() === lower) ||
    ASSETS.find(a => a.name.toLowerCase() === lower) ||
    remoteAssets.value.find(a => a.name.includes(key) || a.cat.includes(key) || a.tags.some(t => String(t).includes(key))) ||
    ASSETS.find(a => a.name.includes(key)) ||
    ASSETS.find(a => a.cat.includes(key)) ||
    ASSETS.find(a => a.cols.some(c => c.includes(key))) ||
    null
  )
}

/** 素材详情页 /library/:slug 用（内置素材的 slug 就是 id） */
export function assetBySlug(slug) {
  return allAssets.value.find(a => a.id === slug || a.slug === slug) || null
}

export function slugOf(asset) {
  return asset ? (asset.slug || asset.id) : ''
}

/** 保留旧导出：调用方按内置素材筛选时行为不变 */
export const filterAssets = filterStaticAssets
export function assetById(id) {
  return remoteAssets.value.find(a => a.id === id) || staticAssetById(id)
}
export const assetByName = staticAssetByName
