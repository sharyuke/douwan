import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base 用相对路径，方便部署到任意子目录 / 域名下
export default defineConfig({
  plugins: [vue()],
  base: './',
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
