/* =========================================================================
   首页板块导航（顶栏 + 首页内链接共用）
   为什么不能用 href="#start"：本站用 hash 路由（createWebHashHistory），
   浏览器会把地址改成 `#start`，路由把它当成路径 `/start`，直接判成不存在的页面
   —— 用户点「开始制作」会看到 404，而不是滚到第一屏。
   所以统一走这里：手动平滑滚动，地址栏只用 replaceState 清掉 hash 同步一下
   （改成 `#/` 而不是 `#/start`，否则会再次被路由匹配成 /start）。
   ========================================================================= */

import router from '../router/index.js'

/** 滚到首页某个板块。返回 false 表示当前页面没有这个板块（例如不在首页）。 */
export function scrollToSection(id) {
  if (typeof document === 'undefined') return false
  const el = document.getElementById(id)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  try {
    const { pathname, search } = window.location
    history.replaceState(null, '', pathname + search + '#/')
  } catch {
    /* 地址栏同步失败不影响滚动本身 */
  }
  return true
}

/** 顶栏用：不在首页时先回首页，等板块挂载后再滚过去 */
export function goSection(id) {
  if (scrollToSection(id)) return
  router.push('/').then(() => setTimeout(() => scrollToSection(id), 120))
}
