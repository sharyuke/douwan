/* =========================================================================
   素材分类 slug（单一事实来源）
   -------------------------------------------------------------------------
   单独成文件的原因：src/data/libraryCategories.js 顶部 import 了分类图标 PNG，
   Node 侧（scripts/build-seo-pages.mjs）没法直接加载它。
   这里只放纯数据，构建脚本与前端共用同一份。
   ========================================================================= */

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
