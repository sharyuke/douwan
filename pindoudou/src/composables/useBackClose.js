import { onBeforeUnmount, watch } from 'vue'

/* 手机端抽屉打开时压一条历史记录：按系统返回键先关抽屉，而不是直接退出工作台。
   抽屉自己关掉（X / 遮罩 / 选完功能）时补一次 back，别把用户多带一页。 */
export function useBackClose(isOpen, close) {
  let pushed = false
  let selfClosing = false
  let resetTimer = 0

  function onPop() {
    if (!pushed) return
    pushed = false
    if (selfClosing) { selfClosing = false; return }
    close()
  }

  watch(isOpen, open => {
    if (open && !pushed) {
      pushed = true
      history.pushState({ ...(history.state || {}), __sheet: true }, '')
      window.addEventListener('popstate', onPop)
    } else if (!open && pushed) {
      pushed = false
      window.removeEventListener('popstate', onPop)
      selfClosing = true
      history.back()
      clearTimeout(resetTimer)
      resetTimer = setTimeout(() => { selfClosing = false }, 200)
    }
  })

  onBeforeUnmount(() => {
    clearTimeout(resetTimer)
    window.removeEventListener('popstate', onPop)
    if (pushed) {
      pushed = false
      selfClosing = true
      history.back()
    }
  })
}
