/* 素材库分类：每一项都对应 assets.js 里真实存在的字段，不造空分类。
   - 宠物头像合并 pet + avatar 两个 cols（同一批素材本来就同时属于两者）
   - 热门推荐用真实热度字段 hot 的前段（>= 70）
   - 新手专区沿用 30 分钟内可完成的真实时长字段
   - 生活美学没有对应数据，因此不出现在这一行（见执行命令：不造空分类） */

export const LIBRARY_CATEGORIES = [
  { key: 'all', label: '全部', icon: 'grid' },
  { key: 'hot', label: '热门推荐', icon: 'star' },
  { key: 'anime', label: '原创二次元', icon: 'sparkles' },
  { key: 'petavatar', label: '宠物头像', icon: 'cat' },
  { key: 'couple', label: '情侣系列', icon: 'heart' },
  { key: 'food', label: '食物饮品', icon: 'cake' },
  { key: 'plant', label: '植物花卉', icon: 'flower' },
  { key: 'holiday', label: '节日主题', icon: 'gift' },
  { key: 'quick', label: '新手专区', icon: 'play' }
]

export const MORE_CATEGORIES = [
  { key: 'cute', label: '可爱', icon: 'smile' },
  { key: 'guofeng', label: '国风', icon: 'palette' },
  { key: 'fantasy', label: '幻想', icon: 'sparkles' },
  { key: 'pixel', label: '像素艺术', icon: 'grid' },
  { key: 'new', label: '新上架', icon: 'plus' },
  { key: 'avatar', label: '头像', icon: 'user' }
]

export const CATEGORY_BY_KEY = Object.fromEntries(
  [...LIBRARY_CATEGORIES, ...MORE_CATEGORIES].map(c => [c.key, c])
)

export const HOT_THRESHOLD = 70

/** 分类判定：hot / quick / petavatar 是按真实字段组合出来的，其余按 cols 命中 */
export function inCategory(asset, key) {
  if (!key || key === 'all') return true
  if (key === 'hot') return Number(asset.hot) >= HOT_THRESHOLD
  if (key === 'quick') return Number(asset.minutes) > 0 && Number(asset.minutes) <= 30
  if (key === 'petavatar') return asset.cols.includes('pet') || asset.cols.includes('avatar')
  if (key === 'new') return !!asset.isNew
  return asset.cols.includes(key)
}

export function categoryLabel(key) {
  return (CATEGORY_BY_KEY[key] || CATEGORY_BY_KEY.all).label
}

/** 旧链接里的 pet / free 仍然可用：pet 归到「宠物头像」，free 就是全部（全站免费） */
export const LEGACY_CATEGORY_ALIASES = { pet: 'petavatar', free: 'all' }

/** 详情页「看同类素材」用：把素材的 cols 落到这一页真实存在的分类上 */
export function libraryCategoryForAsset(asset) {
  if (!asset) return 'all'
  const cols = asset.cols || []
  if (cols.includes('pet')) return 'petavatar'
  return cols.find(c => CATEGORY_BY_KEY[c]) || 'all'
}

/** 关键词匹配：名称 / 分类 / 标签 / 后台素材描述 / 内置素材的 cols */
export function matchesSearch(asset, keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return true
  return (
    String(asset.name || '').toLowerCase().includes(kw) ||
    String(asset.cat || '').toLowerCase().includes(kw) ||
    String(asset.description || '').toLowerCase().includes(kw) ||
    (asset.tags || []).some(t => String(t).toLowerCase().includes(kw)) ||
    (asset.cols || []).some(c => String(c).toLowerCase().includes(kw))
  )
}

export const DIFFICULTY_OPTIONS = [
  { value: 'beginner', label: '入门', match: '入门' },
  { value: 'easy', label: '简单', match: '简单' },
  { value: 'advanced', label: '进阶', match: '进阶' }
]

export const SIZE_OPTIONS = [
  { value: '29', label: '29 × 29' },
  { value: '58', label: '58 × 58' }
]

export const SORT_OPTIONS = [
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '最热' },
  { value: 'fav', label: '我收藏的' }
]
