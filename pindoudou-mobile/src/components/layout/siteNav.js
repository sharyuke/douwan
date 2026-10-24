/* 桌面 / 平板左侧导航的唯一配置。
   只放已上线、能打开的真实页面；贴纸 / 教程还没有独立页面，先不加入口。
   手机端继续用底部标签栏，不读这份配置。
   图标用「图标交付包」里的透明 PNG，28px、object-fit: contain，保持原稿像素风。 */
import navCreation from '../../assets/nav/nav_creation.png'
import navLibrary from '../../assets/nav/nav_library.png'
import navInventory from '../../assets/nav/nav_inventory.png'
import navWorks from '../../assets/nav/nav_works.png'

export const siteNav = [
  /* 「创作」直接进工作台：没图纸时工作台就是创建步骤（与手机底部标签栏一致） */
  { to: '/editor', label: '创作', iconSrc: navCreation, also: ['/materials', '/build'] },
  { to: '/library', label: '素材库', iconSrc: navLibrary },
  { to: '/inventory', label: '我的库存', iconSrc: navInventory },
  { to: '/projects', label: '我的作品', iconSrc: navWorks }
]
