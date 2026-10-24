import { ref } from 'vue'

/* 首页把图片拖进上传卡后，工作台要接着用这张图。
   路由跳转会丢掉 File 对象，所以在模块作用域里暂存一次，
   工作台挂载时取走（取走即清空，刷新页面不会重复导入旧文件）。 */
const pendingFile = ref(null)

export function setPendingUpload(file) {
  pendingFile.value = file || null
}

export function takePendingUpload() {
  const f = pendingFile.value
  pendingFile.value = null
  return f
}
