/* =========================================================================
   客户端 SEO：路由切换时更新 title / description / canonical / OG
   -------------------------------------------------------------------------
   服务端已经为爬虫渲染好了这些信息；前端负责的是「用户点着站内链接跳转后」
   标题与描述也要跟着变，否则一个会话里标题永远是首页的。

   三条自我约束：
   1. canonical 用绝对地址（https://dw.sharyuke.com/xxx/），与后端渲染的一致；
   2. 应用内页面（工作台、账户、后台）加 noindex，不进索引；
   3. 只写真实存在的内容 —— 不编下载量、不编用户评价、不编评分。
   ========================================================================= */

import { SITE_SEO, pageForPath, autoSeoText } from '../data/seo.js'

const SITE_URL = String(SITE_SEO.url || '').replace(/\/+$/, '')

/** 站内路径 → 规范绝对地址。 */
export function canonicalUrl(path) {
  if (!path) return SITE_URL + '/'
  if (/^https?:\/\//i.test(path)) return path
  let p = String(path)
  if (!p.startsWith('/')) p = '/' + p
  return SITE_URL + p
}

/** 页面路径 → 规范路径（公开页面统一带结尾斜杠，与服务端 CanonicalPath 一致）。 */
export function canonicalPath(path) {
  const p = String(path || '/')
  if (p === '/' || p === '') return '/'
  if (p.startsWith('/materials') || p.startsWith('/tools/') || p === '/help' || p === '/colors') {
    return p.endsWith('/') ? p : p + '/'
  }
  return p
}

function upsertMeta(attr, key, content) {
  if (!content) return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel, href) {
  if (!href) return
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/**
 * 写一次 head 信息。
 * @param {{title?:string, description?:string, canonical?:string, image?:string, noindex?:boolean}} data
 */
export function setMeta(data = {}) {
  if (typeof document === 'undefined') return
  const title = data.title || ''
  const description = data.description || ''
  const canonical = data.canonical || ''
  const image = data.image || SITE_SEO.ogImage

  if (title) document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:url', canonical)
  upsertMeta('property', 'og:image', image)
  upsertMeta('property', 'og:type', 'website')
  upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'twitter:image', image)
  upsertMeta('name', 'robots', data.noindex
    ? 'noindex,follow'
    : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1')
  upsertLink('canonical', canonical)
}

/**
 * 素材详情页的默认文案。
 *
 * 规则必须与后端 internal/service/seo.go 的 assetTitle / assetDescription 保持一致：
 * 后台手填过就用手填的，没填就用这里生成的（后端也会把生成结果写回素材表，
 * 所以正常情况下两边拿到的都是同一份）。
 */
export function materialMeta(asset) {
  const name = (asset && asset.name) || ''
  const auto = autoSeoText({
    name,
    category: (asset && asset.cat) || '',
    desc: (asset && asset.description) || '',
    cols: (asset && asset.beadCols) || 0,
    rows: (asset && asset.beadRows) || 0,
    tags: (asset && asset.tags) || []
  }, 'material')
  const title = (asset && asset.seoTitle) || auto.title
  const description = (asset && asset.seoDescription) || auto.description
  return { title, description }
}

/**
 * 路由切换后的默认 head 信息。
 *
 * 素材详情页与分类页的文案来自后台（可能被人改过），
 * 由对应视图在数据到位后调用 setMeta 覆盖这里的默认值。
 *
 * @param {import('vue-router').RouteLocationNormalized} route
 */
export function applyRouteMeta(route) {
  if (!route || typeof document === 'undefined') return
  const meta = route.meta || {}
  const path = canonicalPath(route.path)

  if (meta.admin || meta.noindex) {
    setMeta({
      /* 后台页面带「豆玩后台」后缀；前台的应用内页面（工作台、操作台…）
         是普通站点页面，别挂「后台」两个字 —— 会被误当成后台页。 */
      title: meta.title ? `${meta.title} · ${meta.admin ? '豆玩后台' : '豆玩 DOUWAN'}` : '豆玩 DOUWAN',
      description: '',
      canonical: canonicalUrl(path),
      noindex: true
    })
    return
  }

  /* 这类页面的标题与描述由视图自己定（数据到位后才写得准）：
     这里只补 canonical 与 robots，别把服务端渲染好的标题覆盖掉。 */
  if (meta.ownMeta) {
    setMeta({ canonical: canonicalUrl(path), noindex: false })
    return
  }

  const page = pageForPath(path)
  if (page) {
    setMeta({
      title: page.title,
      description: page.description,
      canonical: canonicalUrl(page.path || path),
      image: page.og_image || SITE_SEO.ogImage,
      noindex: false
    })
    return
  }

  setMeta({
    title: meta.title ? `${meta.title} · 豆玩 DOUWAN` : '豆玩 DOUWAN',
    description: SITE_SEO.description,
    canonical: canonicalUrl(path),
    noindex: false
  })
}
