/* =========================================================================
   生成 SEO 内容清单 dist/seo/pages.json
   -------------------------------------------------------------------------
   后端渲染爬虫可见的 HTML 时要读这份 JSON（内部/seo 的 ContentStore）。
   内容全部来自 src/data/seo.js 与 src/data/tools.js —— 与前端同一份来源，
   所以「爬虫看到的标题」和「用户看到的标题」永远是同一个。

   用法：pnpm build（vite build 之后自动执行）
   ========================================================================= */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SITE_SEO,
  STATIC_PAGES,
  APP_ROUTES,
  KEYWORD_GROUPS,
  KEYWORD_INTENTS,
  KEYWORD_TARGETS,
  SEO_TEMPLATES,
  toolPageMeta
} from '../src/data/seo.js'
import { BUILD_TOOL_CONTENT } from '../src/data/tools.js'
import { CATEGORY_SLUGS } from '../src/data/categorySlugs.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outFile = resolve(root, 'dist/seo/pages.json')

/** 静态页 → 统一结构（补上 keywords / og_image 等字段）。 */
function staticPage(page) {
  return {
    path: page.path,
    kind: page.kind,
    title: page.title,
    description: page.description,
    h1: page.h1,
    badge: page.badge || '',
    lead: page.lead || '',
    intro: page.intro || [],
    features: page.features || [],
    steps: page.steps || [],
    sections: page.sections || [],
    faq: page.faq || [],
    links: page.links || [],
    keywords: page.keywords || SITE_SEO.keywords,
    og_image: SITE_SEO.ogImage,
    noindex: false
  }
}

const pages = [
  ...STATIC_PAGES.map(staticPage),
  ...Object.values(BUILD_TOOL_CONTENT).map(toolPageMeta).filter(Boolean)
]

const content = {
  site: {
    name: SITE_SEO.name,
    slogan: SITE_SEO.slogan,
    url: SITE_SEO.url,
    logo: SITE_SEO.logo,
    og_image: SITE_SEO.ogImage,
    description: SITE_SEO.description,
    keywords: SITE_SEO.keywords
  },
  pages,
  routes: APP_ROUTES,
  /* V3.0：关键词库与自动 SEO 模板。后端据此生成素材 / 分类页文案，
     后台「关键词管理」也用它做「页面 ↔ 关键词」的对照。 */
  keyword_groups: KEYWORD_GROUPS,
  keyword_intents: KEYWORD_INTENTS,
  keyword_targets: KEYWORD_TARGETS,
  templates: SEO_TEMPLATES
}

/** 简单校验：路径唯一、标题与描述非空、描述长度不过长。 */
const seen = new Set()
const problems = []
for (const p of pages) {
  if (seen.has(p.path)) problems.push(`路径重复：${p.path}`)
  seen.add(p.path)
  if (!p.title) problems.push(`缺标题：${p.path}`)
  if (!p.description) problems.push(`缺描述：${p.path}`)
  if (Array.from(p.description).length > 130) problems.push(`描述过长（>130 字）：${p.path}`)
  if (!p.h1) problems.push(`缺 H1：${p.path}`)
}

/* 关键词映射的校验：目标路径必须真的有页面存在，
   否则就是「给一个不存在的页派了搜索词」—— 属于需求里明确禁止的空白页。 */
const knownPaths = new Set(pages.map(p => p.path))
/* 素材分类页是动态路由（内容由后台的真实分类决定），
   路径本身来自 src/data/libraryCategories.js，这里补进已知路径集合。 */
for (const key of Object.keys(CATEGORY_SLUGS)) {
  const slug = CATEGORY_SLUGS[key] && CATEGORY_SLUGS[key][0]
  if (slug) knownPaths.add(`/materials/category/${slug}/`)
}
for (const t of KEYWORD_TARGETS) {
  if (!knownPaths.has(t.path)) problems.push(`关键词目标页不存在：${t.path}（${t.primary}）`)
  if (!t.primary) problems.push(`关键词缺主要目标词：${t.path}`)
  if (!t.group) problems.push(`关键词缺分组：${t.path}`)
}

/* 同一个主要搜索意图不能被两个页面同时认领。 */
const primaryOwner = new Map()
for (const t of KEYWORD_TARGETS) {
  const prev = primaryOwner.get(t.primary)
  if (prev && prev !== t.path) {
    problems.push(`主要搜索意图被两个页面认领：「${t.primary}」 → ${prev} 与 ${t.path}`)
  }
  primaryOwner.set(t.primary, t.path)
}

/* 相关词也不能在两个页面之间重复：
   同一个词被两个页面抢，搜索引擎只能挑一个，另一个必然被稀释。
   这是「多个页面争夺同一核心搜索意图」最典型的形态，在构建期就拦住。 */
const relatedOwner = new Map()
for (const t of KEYWORD_TARGETS) {
  for (const w of t.related || []) {
    const prev = relatedOwner.get(w)
    if (prev && prev !== t.path) {
      problems.push(`相关词被两个页面同时认领：「${w}」 → ${prev} 与 ${t.path}`)
    }
    relatedOwner.set(w, t.path)
  }
}

if (problems.length) {
  console.error('[seo] pages.json 校验失败：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(content, null, 2), 'utf8')
console.log(
  `[seo] 已生成 ${outFile}（${pages.length} 个静态页面 / ${KEYWORD_TARGETS.length} 条关键词目标）`
)
