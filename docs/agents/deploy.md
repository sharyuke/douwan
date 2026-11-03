# 发布

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §4。逐步说明以仓库根目录 [DEPLOY.md](../../DEPLOY.md) 为准。

## 4. 部署（详细步骤见 [DEPLOY.md](DEPLOY.md)）

线上是 **qq** 上的 `https://dw.sharyuke.com`：nginx 托管前端静态文件，`/api/`、`/healthz`、`/readyz`
反代到 `127.0.0.1:8080` 的 `douwan-api.service`，数据在 PostgreSQL 16 的 `douwan` 库，证书由 certbot 自动续期。

发布顺序（**后端先迁移再起服，前端直接覆盖**）：

> ⚠️ 打包用 **`C:\Windows\System32\tar.exe`**（Windows 自带的 bsdtar）。
> PATH 上的 `tar` 是 Git 的 GNU tar，它会把 `C:\...` 当成远程主机名、把 `\d` 当转义，
> 打包会失败或生成错名字的文件名。
>
> ⚠️ **`vite build` 会清空整个 `dist/`**，而 `dist/seo/pages.json` 由
> `node scripts/build-seo-pages.mjs` 单独生成（不在 vite 产物里）。
> 前端发布固定三步：`vite build` → `node scripts/build-seo-pages.mjs` → 打包 `dist`。
> 少跑中间那步 ⇒ 线上没有 `seo/pages.json` ⇒ `/create`、`/editor` 直接 404
> （后端找不到 SEO 内容就回「页面不存在」的壳，2026-10-26 晚就踩过一次）。
> 发布后确认 `/var/www/dw.sharyuke.com/seo/pages.json` 存在（约 61KB），再验 `/create` 是 200。

```powershell
# ① 后端：本机测试 + 交叉编译 + 推送
cd C:\Users\sharyuke\Documents\work\douwan\douwan-api
go test ./...
$env:CGO_ENABLED='0'; $env:GOOS='linux'; $env:GOARCH='amd64'
go build -trimpath -ldflags='-s -w' -o bin\server ./cmd/server
go build -trimpath -ldflags='-s -w' -o bin\migrate ./cmd/migrate
& "C:\Windows\System32\tar.exe" -czf .tmp\douwan-api-bin.tar.gz -C bin server migrate
scp .tmp\douwan-api-bin.tar.gz qq:/tmp/
# ② 后端：qq 上换二进制 → 迁移 → 重启 → 探活
ssh qq 'set -e; systemctl stop douwan-api
  mkdir -p /tmp/douwan-api-bin && tar -xzf /tmp/douwan-api-bin.tar.gz -C /tmp/douwan-api-bin
  install -m 755 -o root -g root /tmp/douwan-api-bin/server /tmp/douwan-api-bin/migrate /opt/douwan-api/bin/
  set -a; . /etc/douwan/api.env; set +a
  /opt/douwan-api/bin/migrate -config /etc/douwan/config.yaml
  systemctl start douwan-api; sleep 2; curl -s http://127.0.0.1:8080/readyz; echo'

# ③ 前端：本机构建 + 推送 + 覆盖
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm build
& "C:\Windows\System32\tar.exe" -czf .tmp\douwan-web.tar.gz -C dist .
scp .tmp\douwan-web.tar.gz qq:/tmp/
ssh qq 'rm -rf /var/www/dw.sharyuke.com/* && tar -xzf /tmp/douwan-web.tar.gz -C /var/www/dw.sharyuke.com
  && chmod -R 755 /var/www/dw.sharyuke.com'

# ④ 公网验证（从 pro 走真实外网）
ssh pro 'curl -s -o /dev/null -w "https %{http_code} %{time_total}s\n" https://dw.sharyuke.com/; curl -s https://dw.sharyuke.com/healthz'
```

常用运维：`ssh qq 'journalctl -u douwan-api -n 100 --no-pager'`、
`ssh qq 'tail -f /var/log/nginx/dw.sharyuke.com.error.log'`、`ssh qq 'systemctl restart douwan-api'`。
