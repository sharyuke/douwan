// 本地共用的静态预览服务器。全工作区只开这一台，别的 agent 不要再另起端口。
// 用法：node tools/preview/server.mjs [--port 5180] [--host 0.0.0.0] [--root tools/preview/www]
// 页面放在 www/。换版本只覆盖 www，不要重启这个进程。
// history 路由回落到 index.html；index.html 不缓存；/api、/healthz、/readyz 反代到线上后端。

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const PORT = Number(argOf('--port', process.env.PREVIEW_PORT || 5180))
const HOST = argOf('--host', process.env.PREVIEW_HOST || '0.0.0.0')
const ROOT = path.resolve(argOf('--root', path.join(HERE, 'www')))
const UPSTREAM = argOf('--upstream', 'https://dw.sharyuke.com')

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
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4'
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

const proxy = async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  try {
    const upstream = await fetch(UPSTREAM + req.url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      redirect: 'manual'
    })
    const out = {}
    for (const [k, v] of upstream.headers) {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(k)) continue
      out[k] = v
    }
    res.writeHead(upstream.status, out)
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    send(res, 502, `preview proxy error: ${err.message}`, { 'Content-Type': 'text/plain; charset=utf-8' })
  }
}

const serveFile = async (req, res, filePath) => {
  const stat = await fsp.stat(filePath)
  if (stat.isDirectory()) return serveFile(req, res, path.join(filePath, 'index.html'))
  const ext = path.extname(filePath).toLowerCase()
  const immutable = /[\\/]assets[\\/]/.test(filePath)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
  })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (urlPath.startsWith('/api/') || urlPath === '/healthz' || urlPath === '/readyz') return proxy(req, res)

  const target = path.join(ROOT, urlPath)
  if (!target.startsWith(ROOT)) return send(res, 403, 'forbidden')
  try {
    return await serveFile(req, res, target)
  } catch {
    // history 路由：没有扩展名的路径一律回落到 index.html
    if (!path.extname(urlPath)) {
      try {
        return await serveFile(req, res, path.join(ROOT, 'index.html'))
      } catch {}
    }
    return send(res, 404, `404 ${urlPath}`, { 'Content-Type': 'text/plain; charset=utf-8' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`preview: http://127.0.0.1:${PORT}/  bind=${HOST}  root=${ROOT}  api->${UPSTREAM}`)
})
