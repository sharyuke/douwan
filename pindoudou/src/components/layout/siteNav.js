/* 侧栏 / 平板左导航的唯一出处。
   只放能跳转的真实页面；图纸 / 教程还没有独立页面，先不放进导航。
   手机端底栏另有 MobileTabbar，图标与这里同一套规范名（见 data/icons.js）。 */
export const siteNav = [
  /* 「创作」直接进全屏工作台（/editor）：上传、编辑、导出都在这一屏里完成。
     材料清单、拼制页也归到创作下面，算同一组的子页 */
  { to: '/editor', label: '创作', icon: 'pencil', also: ['/project-materials', '/build'] },
  { to: '/materials/', label: '素材库', icon: 'images' },
  { to: '/inventory', label: '我的库存', icon: 'package' },
  { to: '/projects', label: '我的作品', icon: 'folder-open' }
]
