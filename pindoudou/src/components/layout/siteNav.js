/* 桌面 / 平板左侧导航的唯一配置。
   只放已上线、能打开的真实页面；贴纸 / 教程还没有独立页面，先不加入口。
   手机端继续用底部标签栏，不读这份配置。
   图标用「图标交付包」里的透明 PNG，28px、object-fit: contain，保持原稿像素风。 */
import navCreation from '../../assets/nav/nav_creation.png'
import navLibrary from '../../assets/nav/nav_library.png'
import navInventory from '../../assets/nav/nav_inventory.png'
import navWorks from '../../assets/nav/nav_works.png'

export const siteNav = [
  /* 「创作」进操作台（/create）：新手简化版的三步向导，
     选图 → 调整 → 拿图纸，做完就是一张能下载的图纸。
     专业工作台（/editor）也从这一项进 —— 顶栏的「新手 / 专业」开关随时能换，
     所以侧栏不用再塞一个入口。 */
  { to: '/create', label: '创作', iconSrc: navCreation, also: ['/editor', '/project-materials', '/build'] },
  { to: '/materials/', label: '素材库', iconSrc: navLibrary },
  { to: '/inventory', label: '我的库存', iconSrc: navInventory },
  { to: '/projects', label: '我的作品', iconSrc: navWorks }
]
