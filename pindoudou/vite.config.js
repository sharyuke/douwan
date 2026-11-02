import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base 用根路径：SEO 需要真实路径（/materials/xxx/）而不是 hash，
// 静态资源也必须从站点根加载，否则深层路径下的相对地址会 404。
export default defineConfig({
  plugins: [vue()],
  base: '/',
  server: {
    // 本地开发时把接口与上传文件代理到后端，线上由 nginx 承担同样的角色
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8080', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500
  }
})
