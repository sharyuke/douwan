# 豆玩 DOUWAN 部署文档（DEPLOY）

本文件记录 `dw.sharyuke.com` 这套线上环境的**真实部署形态**、**完整操作步骤**与**排障方法**。
所有命令都是实际执行过的，可以直接复制运行。

- 本地写成了 `DEPLOY.md`（你口述的是 “DEPLY”，按正确拼写落盘；要改名说一声）
- 涉及的两台机器：**home**（开发机，写代码 / 构建）、**qq**（线上服务器，跑 nginx + API + 数据库）

---

## 1. 线上拓扑

```
                  用户浏览器
                      │  https://dw.sharyuke.com  (Let's Encrypt 证书, HTTP 自动 301 → HTTPS)
                      ▼
        ┌─────────────────────────────────────────────────────────┐
        │ qq  47.103.213.224   Ubuntu 24.04.2 LTS  2C / 1.6G      │
        │                                                         │
        │  nginx 1.24.0                                           │
        │   ├─ /                      → /var/www/dw.sharyuke.com  │ 前端 pindoudou 的 dist（静态）
        │   ├─ /assets/*              → 同上，30 天强缓存            │
        │   ├─ /index.html            → 同上，no-store             │
        │   ├─ /api/                  → proxy_pass 127.0.0.1:8080 │ 后端 douwan-api
        │   └─ /healthz /readyz       → proxy_pass 127.0.0.1:8080 │ 探针
        │                                                         │
        │  douwan-api.service (systemd, 用户 douwan, 仅监听回环)     │
        │   └─ /opt/douwan-api/bin/server -config /etc/douwan/config.yaml
        │                                                         │
        │  PostgreSQL 16.15  127.0.0.1:5432  库/用户 douwan        │
        └─────────────────────────────────────────────────────────┘
```

| 项目 | 值 |
| --- | --- |
| 域名 | `https://dw.sharyuke.com`（A 记录 → `47.103.213.224`） |
| 服务器 | `ssh qq` = root@47.103.213.224，主机名 `qq` |
| 前端产物 | `/var/www/dw.sharyuke.com` |
| 后端二进制 | `/opt/douwan-api/bin/{server,migrate}` |
| 后端配置 | `/etc/douwan/config.yaml`（644） |
| 密钥文件 | `/etc/douwan/api.env`（**600，root only**，systemd 注入） |
| systemd | `/etc/systemd/system/douwan-api.service` |
| nginx 站点 | `/etc/nginx/sites-available/dw.sharyuke.com` → `sites-enabled/` |
| 证书 | `/etc/letsencrypt/live/dw.sharyuke.com/`，`certbot.timer` 自动续期 |
| 数据库 | `douwan` / 用户 `douwan`，12 张表由 `bin/migrate` 建 |
| 源码 | 本机 `C:\Users\sharyuke\Documents\work\douwan\{pindoudou,douwan-api}` |
| 仓库 | 前端 `gitee.com/maryuke/pindoudou`；后端 `gitee.com/maryuke/douwan-api` |

> **Redis 没有装**（`redis.enabled: false`）：刷新令牌存在后端进程内存里，**重启服务后所有刷新令牌失效**，
> 用户需要重新登录。1.6G 内存的机器上这是有意的取舍；要改成 Redis 见 §7。

---

## 2. 服务器侧初始化（首次已经跑过，幂等，可重复执行）

登录：`ssh qq`（从 home 或本机 Windows 都行，配置里默认 `User root`）。

```bash
# 1) 装依赖
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx postgresql postgresql-contrib certbot python3-certbot-nginx

# 2) 运行用户 + 目录
useradd --system --shell /usr/sbin/nologin --home-dir /opt/douwan-api douwan
install -d -m 755 -o douwan -g douwan /opt/douwan-api /opt/douwan-api/bin
install -d -m 755 /var/www/dw.sharyuke.com
install -d -m 755 /etc/douwan

# 3) 生成密钥（只生成一次，之后复用）
DBPASS=$(openssl rand -hex 24)
JWTSECRET=$(openssl rand -hex 32)
cat > /etc/douwan/api.env <<EOF
DOUWAN_DATABASE_PASSWORD=$DBPASS
DOUWAN_JWT_SECRET=$JWTSECRET
EOF
chmod 600 /etc/douwan/api.env

# 4) 数据库与角色
sudo -u postgres psql -c "CREATE ROLE douwan LOGIN PASSWORD '$DBPASS'"
sudo -u postgres createdb -O douwan -E UTF8 -T template0 --locale=C douwan
# 注意：必须带 -T template0，否则报 “new collation (C) is incompatible with the template database”
```

`/etc/douwan/config.yaml`（生产配置，**不含任何密钥**，仓库里有同一份 `deploy/config/prod.config.yaml`）：

```yaml
app:    { name: douwan-api, env: prod, debug: false }
server: { host: 127.0.0.1, port: 8080, shutdown_timeout: 15s,
          read_timeout: 30s, write_timeout: 2m, idle_timeout: 2m }
database:
  host: 127.0.0.1
  port: 5432
  user: douwan
  name: douwan
  sslmode: disable
  timezone: Asia/Shanghai
  auto_migrate: false        # 生产关掉自动建表，由 bin/migrate 显式执行
redis:  { enabled: false }
jwt:    { issuer: douwan-api, access_ttl: 2h, refresh_ttl: 720h }
log:    { level: info, format: text }
cors:
  allow_origins: [https://dw.sharyuke.com, http://dw.sharyuke.com, http://localhost:5173]
```

systemd 单元（仓库同款 `deploy/systemd/douwan-api.service`）：

```ini
[Unit]
Description=豆玩 DOUWAN API (douwan-api)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=douwan
Group=douwan
WorkingDirectory=/opt/douwan-api
EnvironmentFile=/etc/douwan/api.env      # ← 密钥只从这里进进程
ExecStart=/opt/douwan-api/bin/server -config /etc/douwan/config.yaml
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
LimitNOFILE=8192
SyslogIdentifier=douwan-api

[Install]
WantedBy=multi-user.target
```

nginx 站点（仓库同款 `deploy/nginx/dw.sharyuke.com.conf`，当前线上还多了一段 certbot 写的 443 配置）：

```nginx
upstream douwan_api { server 127.0.0.1:8080; keepalive 16; }

server {
    listen 80;
    listen [::]:80;
    server_name dw.sharyuke.com;

    root /var/www/dw.sharyuke.com;
    index index.html;
    charset utf-8;
    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://douwan_api;          # 不带斜杠，保留 /api 前缀
        proxy_http_version 1.1;
        proxy_set_header Connection        "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /healthz { proxy_pass http://douwan_api/healthz; access_log off; }
    location = /readyz  { proxy_pass http://douwan_api/readyz;  access_log off; }

    location /assets/ { expires 30d; add_header Cache-Control "public, max-age=2592000, immutable"; try_files $uri =404; }
    location = /index.html { add_header Cache-Control "no-store, must-revalidate"; }
    location / { try_files $uri $uri/ /index.html; }
}
```

启用站点：

```bash
ln -sf /etc/nginx/sites-available/dw.sharyuke.com /etc/nginx/sites-enabled/dw.sharyuke.com
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
systemctl enable --now douwan-api
```

### HTTPS（certbot / Let's Encrypt）

```bash
certbot --nginx -d dw.sharyuke.com --non-interactive --agree-tos --redirect --keep-until-expiring -m sharyuke@sharyuke.com
```

- 证书到 **2027-01-13** 到期，`certbot.timer` 会在到期前自动续（`systemctl list-timers certbot.timer`）
- 续期后 reload nginx：`certbot renew --deploy-hook "systemctl reload nginx"` 可手工验证一次
- 换域名：`certbot --nginx -d 新域名`，同时改 nginx 的 `server_name` 与 `cors.allow_origins`

---

## 3. 日常发布流程

> 2026-10-18 起，所有构建都在**本机 Windows**上做（Node/pnpm/Go 已装在 `tools\`，见 AGENTS.md §0），
> 产物用 `scp` 推到 qq。本机 → qq 已配好密钥登录（`~/.ssh/config` 里的 `Host qq`）。

### 3.1 发布后端

```powershell
# ① 本机：测试 + 交叉编译（静态二进制，服务器上没有 Go 也能跑）
cd C:\Users\sharyuke\Documents\work\douwan\douwan-api
go vet ./...
go test ./...
$env:CGO_ENABLED='0'; $env:GOOS='linux'; $env:GOARCH='amd64'
go build -trimpath -ldflags='-s -w' -o bin\server ./cmd/server
go build -trimpath -ldflags='-s -w' -o bin\migrate ./cmd/migrate
tar -czf .tmp\douwan-api-bin.tar.gz -C bin server migrate
scp .tmp\douwan-api-bin.tar.gz qq:/tmp/

# ② qq：停服 → 换二进制 → 迁移 → 起服（停机窗口约 1~2 秒）
ssh qq 'set -e
  systemctl stop douwan-api
  mkdir -p /tmp/douwan-api-bin && tar -xzf /tmp/douwan-api-bin.tar.gz -C /tmp/douwan-api-bin
  install -m 755 -o root -g root /tmp/douwan-api-bin/server /tmp/douwan-api-bin/migrate /opt/douwan-api/bin/
  set -a; . /etc/douwan/api.env; set +a
  /opt/douwan-api/bin/migrate -config /etc/douwan/config.yaml
  systemctl start douwan-api
  sleep 2; systemctl is-active douwan-api
  curl -s http://127.0.0.1:8080/readyz; echo'
```

要点：

- **先迁移再起服**：`auto_migrate` 在生产是 `false`，新表/新字段必须靠 `migrate` 这一步
- 迁移可重复执行（GORM AutoMigrate 幂等），失败就 `journalctl -u douwan-api -n 50` 看原因
- 只改代码不动表结构时，`migrate` 也可以跳过，但留着不会出错

### 3.2 发布前端

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm install --frozen-lockfile
pnpm build
tar -czf .tmp\douwan-web.tar.gz -C dist .
scp .tmp\douwan-web.tar.gz qq:/tmp/

ssh qq 'set -e
  rm -rf /var/www/dw.sharyuke.com/*
  tar -xzf /tmp/douwan-web.tar.gz -C /var/www/dw.sharyuke.com
  chmod -R 755 /var/www/dw.sharyuke.com
  curl -s -o /dev/null -w "首页 HTTP %{http_code}\n" -H "Host: dw.sharyuke.com" http://127.0.0.1/'
```

要点：

- `dist` 是纯静态 + hash 路由，**不需要 reload nginx**，覆盖文件即可
- `index.html` 在 nginx 里配了 `no-store`，带 hash 的资源长缓存，所以发版不会串版本
- 第一次在本机装依赖如果报 `ERR_PNPM_IGNORED_BUILDS: esbuild`，说明 `pnpm-workspace.yaml` 里的
  `allowBuilds.esbuild` 不是 `true`（pnpm 11 已不再读 `package.json` 的 `pnpm.onlyBuiltDependencies`）
- Windows 上 pnpm 必须用 hoisted 布局（`npm_config_node_linker=hoisted`），否则 junction 会让
  Vite 报 `Cannot find package 'picomatch'`

### 3.3 发布后统一验证

```bash
# 服务器本地
ssh qq 'curl -s http://127.0.0.1:8080/readyz; echo; curl -s -o /dev/null -w "nginx %{http_code}\n" -H "Host: dw.sharyuke.com" http://127.0.0.1/'
# 走公网 + 证书（从 pro 或任何外网机器）
ssh pro 'curl -s -o /dev/null -w "https %{http_code} %{time_total}s\n" https://dw.sharyuke.com/; curl -s https://dw.sharyuke.com/healthz'
```

外网自测（在 qq 上跑，走公网域名回环）：

```bash
ssh qq 'curl -s -X POST https://dw.sharyuke.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"smoketest01\",\"password\":\"secret-pass-1\"}" | head -c 300; echo'
```

---

## 4. 配置与密钥

| 位置 | 内容 | 权限 |
| --- | --- | --- |
| `/etc/douwan/api.env` | `DOUWAN_DATABASE_PASSWORD` / `DOUWAN_JWT_SECRET` | 600 root |
| `/etc/douwan/config.yaml` | 非敏感全部配置（端口、日志、CORS、TTL…） | 644 |

- 环境变量 **优先级高于** config.yaml，命名规则 `DOUWAN_` + 层级下划线
  （`database.password` → `DOUWAN_DATABASE_PASSWORD`）
- **密钥不进仓库**：`deploy/config/prod.config.yaml` 只是样例，里面没有密码
- 改密钥：编辑 `/etc/douwan/api.env` 后 `systemctl restart douwan-api`
  - 改 `JWT_SECRET` 会让**所有已签发的访问令牌立即失效**（用户重新登录）
  - 改数据库密码要同时 `ALTER ROLE douwan WITH LOGIN PASSWORD '...'`
- 备份密钥文件：`ssh qq 'cat /etc/douwan/api.env'` 存到密码管理器（丢了无法解出旧 token，
  但可以直接换新的）

---

## 5. 运维速查

```bash
# 状态 / 日志
systemctl status douwan-api --no-pager
journalctl -u douwan-api -n 100 --no-pager        # 后端日志（slog 文本）
journalctl -u douwan-api -f                       # 跟踪
tail -f /var/log/nginx/dw.sharyuke.com.error.log  # nginx 错误
tail -f /var/log/nginx/dw.sharyuke.com.access.log # 访问日志（含 request_id 可串后端日志）

# 重启 / 重载
systemctl restart douwan-api
nginx -t && systemctl reload nginx

# 数据库
sudo -u postgres psql douwan                       # 本机免密进库
PGPASSWORD=$(grep -oP '(?<=DOUWAN_DATABASE_PASSWORD=).*' /etc/douwan/api.env) \
  psql -h 127.0.0.1 -U douwan -d douwan -c '\dt'
sudo -u postgres pg_dump -Fc douwan > /root/douwan-$(date +%F).dump        # 备份
sudo -u postgres pg_restore -c -d douwan /root/douwan-2026-10-15.dump      # 恢复

# 端口/进程
ss -tlnp | grep -E ':(80|443|8080|5432)'
```

### 排障对照

| 现象 | 先查 |
| --- | --- |
| 502 Bad Gateway | `systemctl is-active douwan-api`；`journalctl -u douwan-api -n 50`（多半是数据库连不上） |
| `/readyz` 报 10500 | 数据库挂了：`systemctl status postgresql`；密码是否和 api.env 一致 |
| 页面 404 / 空白 | 前端是否解包到 `/var/www/dw.sharyuke.com`；浏览器是否缓存了旧 `index.html`（强刷） |
| 改了代码没生效 | 后端忘了 `systemctl restart`；前端忘了重新 `pnpm build` 再覆盖 |
| 定时全体重新登录 | 服务重启过（内存令牌存储），要避免就上 Redis |
| 证书告警 | `certbot certificates`；`systemctl list-timers certbot.timer` |

---

## 6. 本次部署的验证记录（2026-10-15）

| 项目 | 结果 |
| --- | --- |
| 后端构建 | `go build ./...`、`go vet ./...`、`go test ./...` 全绿（SQLite 内存库，无需 PostgreSQL） |
| 数据库迁移 | `bin/migrate` 建表 12 张（users / memberships / credit_* / usage_stats / projects / project_variants / inventory_items / assets / asset_favorites / palette_*） |
| 服务启动 | `douwan-api.service` active，内存占用约 3.4 MB |
| 进程内探针 | `/healthz` `{"code":0,...}`；`/readyz` `{"database":"up"}` |
| 经 nginx | 首页 HTTP 200；`/healthz`、`/readyz` 正常；`/api/*` 反代正常 |
| 外网访问 | 从 pro 访问 `https://dw.sharyuke.com/` 200（0.13s），`http://` 301 → `https://`，证书链校验通过，页面标题正确 |
| API 端到端 | 注册 201 / 登录 200 / 错密码 20004 / 无令牌 20001 / 刷新 200 / 旧 refresh 复用 20003 / 重复注册 30002 / 参数校验 10001 / 改资料 200 / 登出 200 / 未知路由 10404 —— 12 项全绿 |
| HTTPS | certbot 签发成功，`https://dw.sharyuke.com` 证书有效期至 2027-01-13 |
| 收尾 | 端到端用的 3 个 `e2e*` 测试账号及其会员/Credits/统计记录已全部删除，`users` 表为空 |

---

## 7. 待办与已知限制

1. **前端还没接后端**：`pindoudou` 目前是纯前端（账号、会员、Credits 全在 localStorage），
   `/api/` 已经通到后端，但页面上还没有调用。接入时把 API base 设成同源 `/api`（无跨域问题），
   并在收到 `20002` 时用 refresh_token 换新令牌（见 `douwan-api/docs/api.md`）。
2. **单实例、无 Redis**：刷新令牌存内存，重启即失效；要持久化就 `apt install redis-server` +
   `DOUWAN_REDIS_ENABLED=true`（配置文件里改 `redis.enabled`）再重启。
3. **自动备份还没配**：建议加个 cron 每天 `pg_dump`，并把 dump 拉到 home。
4. **色板与素材数据还没导入**：`palette_brands` / `palette_colors` / `assets` 表是空的，
   需要写一个 `cmd/seed` 从 `pindoudou/src/data/{palette,assets}.js` 导入（README「后续」里也记着）。
5. **服务器规格**：2 核 1.6G，PostgreSQL 独占约 128MB 共享内存；跑得动现在的量级，
   但不要在上面再装 Docker + 一整套服务。
6. **备案**：`sharyuke.com` 若已在阿里云备案，子域可正常访问 80/443（本次实测公网访问正常）；
   未备案的域名在阿里云大陆机器上会被拦截 80 端口。
