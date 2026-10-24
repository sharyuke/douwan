/* =========================================================================
   微信登录的视口判定
   - 登录弹窗在手机与桌面共用同一套入口（微信登录 + 邮箱登录），
     这个断点只用来标记 data-mode，供自检区分手机 / 桌面两种布局。
   ========================================================================= */

const MOBILE_QUERY = '(max-width: 767px)'

/** 与布局断点保持一致：手机（≤767px）用底部标签栏。 */
export function isMobileViewport() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MOBILE_QUERY).matches
}
