/* =========================================================================
   本地预览「刚构建好的 dist/」的最小静态服务器
   -------------------------------------------------------------------------
   为什么不用 vite preview：那台服务器会带缓存策略，而且它启动时仍会走 vite
   的工具链。排查「改了代码但页面上看不到」时，最需要的恰恰是**完全不吃缓存**：
   这里对 index.html 与所有产物都发 no-store，改完 `pnpm build` 直接刷新就能看到。

   用法：
     node scripts/serve-dist.mjs            # 默认 http://127.0.0.1:4319/
     PORT=8080 node scripts/serve-dist.mjs
   ========================================================================= */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const PORT = Number(process.env.PORT || 4319)
const HOST = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`找不到 ${path.join(ROOT, 'index.html')}，先运行 pnpm build`)
  process.exit(1)
}

const server = http.createServer((req, res) => {
  let url = '/'
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0])
  } catch {
    /* 非法编码按根路径处理 */
  }
  let file = path.join(ROOT, url)
  // 防目录穿越：解析后的路径必须仍在 dist 内
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // 应用是 hash 路由，静态文件找不到时回落到 index.html
    file = path.join(ROOT, 'index.html')
  }
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, HOST, () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const js = (index.match(/assets\/[A-Za-z0-9_\-\.]+\.js/) || ['?'])[0]
  console.log(`豆玩 DOUWAN 本地预览: http://${HOST}:${PORT}/`)
  console.log(`入口产物: ${js}（no-store，改完重新 build 刷新即可）`)
})

server.on('error', e => {
  console.error(`端口 ${PORT} 启动失败: ${e.message}`)
  process.exit(1)
})
