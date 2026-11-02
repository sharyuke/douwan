import { ref } from 'vue'

/* 首页把图片拖进上传卡后，工作台要接着用这张图。
   路由跳转会丢掉 File 对象，所以在模块作用域里暂存一次，
   工作台挂载时取走（取走即清空，刷新页面不会重复导入旧文件）。 */
const pendingFile = ref(null)

/* 导出这个 ref：有些地方要「盯着它」而不只是取一次。
   典型场景是顶栏的上传按钮 —— 用户已经在首页时点了上传，
   路由不会变化、组件也不会重新挂载，只在 onMounted 里取一次永远取不到。 */
export { pendingFile }

export function setPendingUpload(file) {
  pendingFile.value = file || null
}

export function takePendingUpload() {
  const f = pendingFile.value
  pendingFile.value = null
  return f
}
