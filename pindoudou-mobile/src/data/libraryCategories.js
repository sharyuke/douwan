/* =========================================================================
   素材库分类 / 筛选配置（单一事实来源）
   -------------------------------------------------------------------------
   内容来自交付包 category_config.json（10 个一级分类 + 二级词条 +
   热门推荐 / 店主专区 / 原创精选），这里只补充前端需要的视觉色调与匹配规则。
   - 一级分类：严格按交付包顺序，不新增「追星应援」等类别
   - 二级词条：优先匹配后台素材的 tags，其次匹配标题 / 分类名 / 描述
   - 难度、用途：后台目前没有独立字段，用真实 tags（以及描述文本）映射；
     没有对应标签的素材不会被硬塞进某个难度 / 用途
   - 热门推荐：用后台真实的 is_featured（feat）
   - 店主专区：暂无数据，标注「即将上线」，不伪造素材
   ========================================================================= */

import iconAll from '../assets/category/all.png'
import iconAnime from '../assets/category/anime.png'
import iconPets from '../assets/category/pets.png'
import iconCouples from '../assets/category/couples.png'
import iconFood from '../assets/category/food.png'
import iconPlants from '../assets/category/plants.png'
import iconLifestyle from '../assets/category/lifestyle.png'
import iconFestivals from '../assets/category/festivals.png'
import iconCute from '../assets/category/cute.png'
import iconBeginner from '../assets/category/beginner.png'
import iconHot from '../assets/category/hot.png'

/** 一级分类：顺序就是导航顺序 */
export const LIBRARY_CATEGORIES = [
  { key: 'all', name: '全部', icon: iconAll, tone: 'all', children: [] },
  {
    key: 'anime', name: '二次元', icon: iconAnime, tone: 'anime',
    children: ['动漫萌系', '游戏角色', 'Q版人物', '原创角色', '幻想生物']
  },
  {
    key: 'pets', name: '萌宠动物', icon: iconPets, tone: 'pets',
    children: ['猫咪', '狗狗', '兔兔', '熊熊', '其他动物', '宠物头像']
  },
  {
    key: 'couples', name: '情侣情感', icon: iconCouples, tone: 'couples',
    children: ['情侣头像', '双人组合', '爱心元素', '纪念日', '友情闺蜜']
  },
  {
    key: 'food', name: '美食水果', icon: iconFood, tone: 'food',
    children: ['水果', '甜品蛋糕', '饮品', '零食', '萌趣食物']
  },
  {
    key: 'plants', name: '植物花卉', icon: iconPlants, tone: 'plants',
    children: ['花束', '单支花', '盆栽', '多肉植物', '四季植物']
  },
  {
    key: 'lifestyle', name: '生活美学', icon: iconLifestyle, tone: 'lifestyle',
    children: ['杯垫', '冰箱贴', '家居摆件', '房屋建筑', '生活小物']
  },
  {
    key: 'festivals', name: '节日祝福', icon: iconFestivals, tone: 'festivals',
    children: ['新年春节', '生日', '圣诞节', '万圣节', '情人节', '毕业季']
  },
  {
    key: 'cute', name: '萌趣日常', icon: iconCute, tone: 'cute',
    children: ['原创萌物', '表情包', '治愈系', '搞怪有趣', '幸运符号']
  },
  {
    key: 'beginner', name: '新手专区', icon: iconBeginner, tone: 'beginner',
    children: ['简单好拼', '小尺寸', '少颜色', '快速完成', '入门推荐']
  }
]

export const CATEGORY_BY_KEY = Object.fromEntries(LIBRARY_CATEGORIES.map(c => [c.key, c]))

/** 运营专题：不属于主导航一级分类 */
export const FEATURED_COLLECTIONS = [
  {
    key: 'hot', name: '热门推荐', icon: iconHot, tone: 'hot',
    children: ['爆款素材', '热门话题', '季节流行', '精选合集']
  },
  {
    key: 'shop', name: '店主专区', pixelIcon: 'box', tone: 'shop',
    children: ['热卖款', '可批量制作', '成套商品', '节日上新'],
    available: false, badge: '即将上线'
  },
  {
    key: 'original', name: '原创精选', pixelIcon: 'sparkles', tone: 'original',
    children: ['原创角色', '主题套系', '精选图纸']
  }
]

export const COLLECTION_BY_KEY = Object.fromEntries(FEATURED_COLLECTIONS.map(c => [c.key, c]))

/** 展开面板的两列顺序（reference_1） */
export const PANEL_COLUMNS = [
  ['anime', 'pets', 'couples', 'food', 'plants'],
  ['lifestyle', 'festivals', 'cute', 'beginner', 'hot', 'shop']
]

export const SORT_TABS = [
  { value: 'recommended', label: '推荐' },
  { value: 'newest', label: '最新' },
  { value: 'hottest', label: '最热' },
  { value: 'most_favorited', label: '收藏最多' }
]

export const DIFFICULTY_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'easy', label: '入门' },
  { value: 'medium', label: '简单' },
  { value: 'hard', label: '进阶' }
]

export const PURPOSE_OPTIONS = [
  { value: 'all', label: '全部用途' },
  { value: 'keychain', label: '钥匙扣' },
  { value: 'fridge_magnet', label: '冰箱贴' },
  { value: 'coaster', label: '杯垫' },
  { value: 'hanging', label: '挂饰' },
  { value: 'ornament', label: '摆件' },
  { value: 'wall_art', label: '装饰画' }
]

export const SEARCH_PLACEHOLDER = '搜索当前分类的素材…'

/* ------------------------------------------------------------------ 旧链接 */

/** 旧分类 key → 新分类 key（旧链接、旧收藏里的 col 仍然可用） */
export const LEGACY_CATEGORY_ALIASES = {
  pet: 'pets',
  petavatar: 'pets',
  couple: 'couples',
  plant: 'plants',
  holiday: 'festivals',
  quick: 'beginner',
  free: 'all'
}

/** 旧排序 key → 新排序 key */
export const LEGACY_SORT_ALIASES = {
  latest: 'newest',
  hot: 'hottest',
  fav: 'most_favorited'
}

/* ------------------------------------------------------------ 分类匹配 */

/** 新分类对应的后台分类 slug（含旧 slug，方便旧素材继续落位） */
export const CATEGORY_SLUGS = {
  anime: ['anime'],
  pets: ['pets', 'pet', 'avatar'],
  couples: ['couples', 'couple'],
  food: ['food'],
  plants: ['plants', 'plant'],
  lifestyle: ['lifestyle'],
  festivals: ['festivals', 'holiday'],
  cute: ['cute'],
  beginner: ['beginner']
}

/** 后台分类名 → 新分类 key（分类被停用、slug 拿不到时兜底） */
const CATEGORY_NAME_ALIASES = {
  二次元: 'anime',
  宠物: 'pets',
  萌宠动物: 'pets',
  头像: 'pets',
  情侣: 'couples',
  情侣情感: 'couples',
  甜品美食: 'food',
  美食水果: 'food',
  植物: 'plants',
  植物花卉: 'plants',
  生活美学: 'lifestyle',
  节日: 'festivals',
  节日祝福: 'festivals',
  可爱: 'cute',
  萌趣日常: 'cute',
  新手专区: 'beginner'
}

const lower = v => String(v ?? '').trim().toLowerCase()

function tagsOf(asset) {
  return (Array.isArray(asset?.tags) ? asset.tags : []).map(lower)
}

function haystack(asset) {
  return [
    asset?.name, asset?.cat, asset?.description, ...(asset?.tags || [])
  ].map(lower).join(' ')
}

function hasAny(hay, words) {
  return words.some(w => hay.includes(lower(w)))
}

/** 热门推荐：后台真实推荐位，或运营明确打了热门标签 */
export function isFeatured(asset) {
  if (!asset) return false
  if (asset.feat) return true
  return hasAny(tagsOf(asset).join(' '), ['热门', '爆款', '精选合集', '热门话题'])
}

/** 是否属于某个一级分类（all / hot / shop 也走这里） */
export function inCategory(asset, key) {
  if (!asset || !key || key === 'all') return true
  if (key === 'hot') return isFeatured(asset)
  if (key === 'shop') return false

  const slugs = CATEGORY_SLUGS[key]
  if (slugs && (asset.cols || []).some(c => slugs.includes(c))) return true

  const byName = CATEGORY_NAME_ALIASES[lower(asset.cat)]
  if (byName === key) return true

  /* 新手专区是聚合位：简单难度或明确的入门标签都算 */
  if (key === 'beginner') {
    if (difficultyOf(asset) === 'easy') return true
    return hasAny(haystack(asset), ['新手', '入门', '简单好拼', '小尺寸', '少颜色', '快速完成'])
  }
  return false
}

/** 运营专题（热门推荐） */
export function inCollection(asset, key) {
  if (!key) return true
  if (key === 'hot') return isFeatured(asset)
  if (key === 'shop') return false
  return true
}

/* ------------------------------------------------------------ 二级词条 */

/** 二级词条的同义词：让「猫咪」也能命中标题里的「猫」 */
const SUB_ALIASES = {
  动漫萌系: ['动漫', '萌系', 'anime'],
  游戏角色: ['游戏', '角色', 'game'],
  Q版人物: ['q版', 'q 版', 'chibi', 'q人物'],
  原创角色: ['原创角色', '原创', 'oc'],
  幻想生物: ['幻想', '生物', 'fantasy', '龙', '独角兽'],
  猫咪: ['猫咪', '猫', 'cat', 'kitty'],
  狗狗: ['狗狗', '狗', 'dog', 'puppy', '柯基', '柴犬'],
  兔兔: ['兔兔', '兔', 'rabbit', 'bunny'],
  熊熊: ['熊熊', '熊', 'bear'],
  其他动物: ['动物', 'animal', '企鹅', '鸭', '青蛙', '小鸡'],
  宠物头像: ['宠物头像', '头像', 'avatar'],
  情侣头像: ['情侣头像', '情侣', '头像', 'couple'],
  双人组合: ['双人', '组合', '一对', 'pair'],
  爱心元素: ['爱心', '心形', 'heart', 'love'],
  纪念日: ['纪念日', '纪念', '周年', 'anniversary'],
  友情闺蜜: ['友情', '闺蜜', '朋友', 'friend'],
  水果: ['水果', 'fruit', '草莓', '橘子', '西瓜', '苹果', '柠檬', '樱桃', '蜜桃'],
  甜品蛋糕: ['甜品', '蛋糕', 'dessert', 'cake', '布丁'],
  饮品: ['饮品', '饮料', '咖啡', '奶茶', 'drink'],
  零食: ['零食', '饼干', '糖果', 'snack'],
  萌趣食物: ['食物', '美食', 'food', '萌趣'],
  花束: ['花束', 'bouquet', '捧花'],
  单支花: ['单支花', '单支', '一朵', 'flower'],
  盆栽: ['盆栽', '花盆', 'pot', 'plant'],
  多肉植物: ['多肉', 'succulent', '仙人掌'],
  四季植物: ['四季', '植物', '叶子', '树'],
  杯垫: ['杯垫', 'coaster'],
  冰箱贴: ['冰箱贴', '磁贴', 'magnet', 'fridge'],
  家居摆件: ['家居', '摆件', '摆台', 'ornament'],
  房屋建筑: ['房屋', '建筑', '房子', 'house', '小屋'],
  生活小物: ['生活小物', '小物', '生活', '日用品'],
  新年春节: ['新年', '春节', '过年', '新春', 'new year', 'spring festival'],
  生日: ['生日', 'birthday', '蛋糕'],
  圣诞节: ['圣诞', 'christmas', 'xmas'],
  万圣节: ['万圣', 'halloween', '南瓜'],
  情人节: ['情人节', 'valentine', '爱心'],
  毕业季: ['毕业', 'graduation', '学士帽'],
  原创萌物: ['原创萌物', '原创', '萌物', 'cute'],
  表情包: ['表情包', '表情', 'emoji', 'meme'],
  治愈系: ['治愈', 'healing', '温柔'],
  搞怪有趣: ['搞怪', '有趣', 'funny', '沙雕'],
  幸运符号: ['幸运', 'lucky', '四叶草', '星星'],
  简单好拼: ['简单', '好拼', '入门', 'easy'],
  小尺寸: ['小尺寸', '小号', 'small', '迷你'],
  少颜色: ['少颜色', '颜色少', 'few colors'],
  快速完成: ['快速完成', '快速', 'quick', '分钟'],
  入门推荐: ['入门推荐', '入门', '新手', 'beginner']
}

export function matchesSubcategory(asset, child) {
  if (!child) return true
  const terms = SUB_ALIASES[child] || [child]
  const hay = haystack(asset)
  return terms.some(t => hay.includes(lower(t)))
}

/* ------------------------------------------------------------ 难度 / 用途 */

const DIFFICULTY_ALIASES = {
  easy: ['入门', '新手', '容易', 'easy', 'beginner'],
  medium: ['简单', '普通', '中等', 'medium', 'intermediate'],
  hard: ['进阶', '困难', '高难', '复杂', '挑战', 'hard', 'advanced', 'expert']
}

/** 从真实标签 / 难度字段推断难度；没有依据时返回空串 */
export function difficultyOf(asset) {
  if (!asset) return ''
  const tags = (asset.tags || []).map(lower)
  /* 先按完整标签匹配：「简单好拼」这类二级词里带「简单」，不能当成难度 */
  for (const [level, words] of Object.entries(DIFFICULTY_ALIASES)) {
    if (tags.some(t => words.some(w => t === lower(w)))) return level
  }
  const hay = [asset.difficulty, ...tags].map(lower).join(' ').replaceAll('简单好拼', '')
  for (const [level, words] of Object.entries(DIFFICULTY_ALIASES)) {
    if (words.some(w => hay.includes(lower(w)))) return level
  }
  return ''
}

export function matchesDifficulty(asset, level) {
  if (!level || level === 'all') return true
  return difficultyOf(asset) === level
}

const PURPOSE_ALIASES = {
  keychain: ['钥匙扣', '钥匙链', 'keychain', 'key chain'],
  fridge_magnet: ['冰箱贴', '磁贴', 'fridge magnet', 'fridge_magnet', 'magnet'],
  coaster: ['杯垫', 'coaster'],
  hanging: ['挂饰', '挂件', '吊饰', 'hanging'],
  ornament: ['摆件', '摆台', 'ornament'],
  wall_art: ['装饰画', '挂画', 'wall art', 'wall_art', 'poster']
}

/** 用途同样只吃真实 tags / 描述，不做「看起来生效」的假筛选 */
export function matchesPurpose(asset, purpose) {
  if (!purpose || purpose === 'all') return true
  const words = PURPOSE_ALIASES[purpose] || [purpose]
  return hasAny(haystack(asset), words)
}

/* ------------------------------------------------------------ 排序 */

function recommendedCompare(a, b) {
  const af = a.feat ? 1 : 0
  const bf = b.feat ? 1 : 0
  if (af !== bf) return bf - af
  const ah = Number(a.hot) || 0
  const bh = Number(b.hot) || 0
  if (ah !== bh) return bh - ah
  return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
}

/**
 * 列表排序。
 * - recommended：后台推荐位 → 排序值 → 发布时间
 * - newest：真实发布时间倒序
 * - hottest：后台已有的排序值（运营热度）倒序
 * - most_favorited：本地收藏优先；全局收藏数后台暂未提供，
 *   这里先按推荐序兜底（TODO：接 /assets 的收藏统计后改成真实收藏数）
 */
export function sortAssets(list, sort, favoriteIds = []) {
  const arr = Array.isArray(list) ? list.slice() : []
  if (sort === 'newest') {
    return arr.sort((a, b) =>
      (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0) ||
      (Number(b.remoteId) || 0) - (Number(a.remoteId) || 0)
    )
  }
  if (sort === 'hottest') {
    return arr.sort((a, b) =>
      (Number(b.hot) || 0) - (Number(a.hot) || 0) || recommendedCompare(a, b)
    )
  }
  if (sort === 'most_favorited') {
    const fav = new Set(favoriteIds)
    return arr.sort((a, b) => {
      const af = fav.has(a.id) ? 1 : 0
      const bf = fav.has(b.id) ? 1 : 0
      if (af !== bf) return bf - af
      return recommendedCompare(a, b)
    })
  }
  return arr.sort(recommendedCompare)
}

/* ------------------------------------------------------------ 文案 / 详情 */

export function categoryLabel(key) {
  if (!key) return '全部'
  return (CATEGORY_BY_KEY[key] || COLLECTION_BY_KEY[key] || CATEGORY_BY_KEY.all).name
}

export function categoryChildren(key) {
  return (CATEGORY_BY_KEY[key] || COLLECTION_BY_KEY[key] || {}).children || []
}

/** 详情页「看同类素材」用：把素材落到新分类上 */
export function libraryCategoryForAsset(asset) {
  if (!asset) return 'all'
  const cols = asset.cols || []
  for (const c of LIBRARY_CATEGORIES) {
    if (c.key === 'all') continue
    const slugs = CATEGORY_SLUGS[c.key] || []
    if (cols.some(x => slugs.includes(x))) return c.key
  }
  return CATEGORY_NAME_ALIASES[lower(asset.cat)] || 'all'
}

/** 关键词匹配：名称 / 分类 / 标签 / 后台描述 / 旧分类 cols */
export function matchesSearch(asset, keyword) {
  const kw = lower(keyword)
  if (!kw) return true
  return haystack(asset).includes(kw)
}
