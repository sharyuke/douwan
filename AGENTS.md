# 豆玩 DOUWAN 工作区

> 这个文件是给「以后在这个工作区干活的 AI」看的：先读这里，再看 [DEPLOY.md](DEPLOY.md)。
> 最后更新：2026-10-18（工作台除 ① 外全部卡片默认折叠，⑤ 图纸交付移到左栏、
> 我的库存移到右栏，已上线（`5ab3ce6`）；**开发环境迁到本机 Windows**：pindoudou / douwan-api 源码、
> Node 24 + pnpm 11 + Go 1.26 都在本地，日常不再用 home；图纸交付改左右结构、
> 画布高清导出按钮移除，已上线；10-16 深夜：颜色数量上限 221 → 291，存档字符集扩容到容量 547，已上线；
> 夜里：工作台左栏 ④ 收成一行「色板选择 ▾」，展开后色板做重点突出，已上线；
> 傍晚：色板换成 8 个体系 15 套并上线——MARD 24~291 八套装 + COCO/漫漫/盼盼/咪小窝，
> 数据双源交叉验证；下午：后台「用户访问量」PV/UV 上线——含匿名访客、前台埋点、部署验证；
> 同一天上午：活跃监控做进后台前端 + 换品牌色；home 上还有并行会话在做豆径/分板规格与本地 AI 模块）

---

## 0. 一句话说清工作方式

**2026-10-18 起，开发在本机 Windows 上做，日常不再使用 home。** 源码、Node、pnpm、Go 都在本机；
构建、测试、提交都在本地完成，产物用 `scp` 推到 **qq** 上线。home（192.168.1.135）只作为旧开发机和备份保留。

```
   本机 Windows（开发机 + 控制端）                         qq 47.103.213.224（线上）
   C:\Users\sharyuke\Documents\work\douwan\               nginx + douwan-api + PostgreSQL
   ├── pindoudou/    前端 Vue3+Vite6                       https://dw.sharyuke.com
   ├── douwan-api/   后端 Go+Gin+GORM
   └── tools/        node 24.21.0 / pnpm 11.17.0 / go 1.26.0
          │
          └── git push ──▶ gitee.com/maryuke/{pindoudou,douwan-api}
```

**标准动作**：本机改代码 → 本地 `pnpm build` / `go test ./...` → `scp` 到 qq → 重启服务 → 公网验证 →
本地 `git commit && git push`。

### 本地工具链（已装好，2026-10-18）

| 工具 | 路径 / 版本 | 说明 |
| --- | --- | --- |
| Node | `tools\node\node.exe` v24.21.0 | 官方 Windows zip，含 npm 11.19.0 |
| pnpm | `tools\npm-global\pnpm.cmd` 11.17.0 | 已加入用户 PATH |
| Go | `tools\go\bin\go.exe` 1.26.0 | 官方 Windows zip |
| 前端依赖 | `pindoudou\node_modules` | **必须是 hoisted 布局**（见下） |
| Go 缓存 | `tools\gopath` / `tools\go-cache` | 已设为用户环境变量 |

用户环境变量已持久化：`PNPM_HOME`、`npm_config_cache`、`npm_config_store_dir`、
`npm_config_node_linker=hoisted`、`GOPATH`、`GOMODCACHE`、`GOCACHE`、`GOTMPDIR`，
并把 `tools\node`、`tools\npm-global`、`tools\go\bin` 加进了用户 PATH；
另外 `C:\Users\sharyuke\.npmrc` 里固定了 `node-linker=hoisted`、`store-dir`、`cache-dir`。新开的终端直接可用；
如果当前会话读不到，就在命令前临时补：
`$env:Path = "C:\Users\sharyuke\Documents\work\douwan\tools\node;C:\Users\sharyuke\Documents\work\douwan\tools\npm-global;C:\Users\sharyuke\Documents\work\douwan\tools\go\bin;" + $env:Path`

> ⚠️ **pnpm 在 Windows 上必须用 hoisted 布局**：默认 isolated 布局会创建
> `\??\Global\C:\...` 形式的 junction，Node 24 的 ESM 解析器不认，`vite build` 会报
> `Cannot find package 'picomatch'`。已通过用户环境变量 `npm_config_node_linker=hoisted` 固定；
> 手动装依赖时也可显式加 `--config.node-linker=hoisted`。

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm install --frozen-lockfile
pnpm build

cd ..\douwan-api
go vet ./...
go test ./...
go build -o bin\server.exe ./cmd/server
```

### ssh 调用的坑（踩过好几次）

从 PowerShell 调 `ssh` 时，**内层引号会被吞掉**，命令行里的 `(`、`|`、`$` 还会被远端 bash 二次解析
（症状例如 `syntax error near unexpected token '('`）。稳妥写法：

- 外层用**单引号**包住整条远端命令（避免 PowerShell 展开 `$`），里面别用双引号；
- 一旦脚本超过两三行、或要用 `$(...)`、括号、heredoc，就**用 base64 传**：

```powershell
$s = @'
set -euo pipefail
cd ~/Documents/work/dw/douwan-api
go test ./...
'@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))
ssh qq "echo $b | base64 -d | bash"
```

- **不要**把输出接到 `| tail` / `| head`（本机 PATH 里是 Git 自带的 tail，管道会炸：
  `fatal error - couldn't create signal pipe`）。要截取就用 `$out | Select-Object -Last 40`。

---

## 1. 主机与环境

| 别名 | 地址 | 身份 | 用途 |
| --- | --- | --- | --- |
| `home` | 192.168.1.135（sy-home，Ubuntu） | sharyuke | **旧开发机 / 备份**：日常不用，只在需要找回历史代码时登录 |
| `qq` | 47.103.213.224（qq，Ubuntu 24.04.2，2C/1.6G/40G） | root | **线上**：dw.sharyuke.com（nginx + douwan-api + PostgreSQL） |
| `pro` | 192.168.1.185 | root | 旧的线上机（`/var/www/douzao`，pindoudou 老版本部署在这，仍可访问） |
| `pro1` / `nb` / `dev` | rt.yuke.ink:2222 / 192.168.1.205 / 192.168.1.173 | — | 其他备用机（本机与 home 都能免密登录） |
| `dk` / `dt` / `ts` / `uc` / `lt` | 各家云 | root | 其他云主机（本机 known_hosts 里没有这些主机，直接 ssh 会 host key 报错） |

**本机工具链**：Node v24.21.0、pnpm 11.17.0、Go 1.26.0，全部在 `tools\` 下，详见 §0。
本机与 qq 都能免密 ssh；home 仍可 ssh，但不再用于开发。

---

## 2. 代码与仓库

### 2.1 前端 `pindoudou`（豆玩 DOUWAN 拼豆图纸工作台）

- 路径：本机 `C:\Users\sharyuke\Documents\work\douwan\pindoudou`；仓库 <https://gitee.com/maryuke/pindoudou.git>（`master`）
- Vue 3.5 + Vite 6 + vue-router（hash 路由），**纯前端 SPA**：账号 / 会员 / Credits 目前都在 localStorage 里演示
- 线上：**<https://dw.sharyuke.com>**（qq 的 `/var/www/dw.sharyuke.com`，由 nginx 托管 `dist/`）
- 依赖已装、`dist/` 已产出（2026-10-15 装过一轮）；`README.md` 是权威设计文档（算法、色板、会员模型、设计令牌）

| 关键文件 | 作用 |
| --- | --- |
| `src/lib/pattern.js` (1623 行) | 核心引擎：采样 → k-medoids 量化 → CIEDE2000 映射 → 后处理 → 评分 |
| `src/lib/matte.js` (926 行) | 自动抠背景 + 去投影（经典图像处理，确定性、无模型） |
| `src/lib/render.js` / `exporters.js` | 图纸绘制 / PNG·SVG·CSV·JSON·打印导出 |
| `src/composables/useStudio.js` (1150 行) | 工作台状态中枢 |
| `src/composables/useMembership.js` | 会员权益判定，**按钮永不隐藏**，点不动要给原因 + 升级路径 |
| `src/data/palette.js`、`assets.js` | **脚本生成，勿手改**（`pnpm palette` / `assets`） |
| `src/views/admin/AdminActivityView.vue` | 后台「用户活跃监控」页：总览 / **访问量** / 留存 / 使用频率 / 地区 / 功能使用 / 来源渠道 / 用户明细，调 10 个 `/admin/activity/*` |
| `src/lib/telemetry.js` | 前台访问量埋点：路由 `afterEach` 上报 `POST /api/v1/visits`（访客标识存 localStorage、同页面 2 秒去抖、后台页面不上报、失败静默） |
| `scripts/audit.cjs` | 无头浏览器自检：51 页 × 3 视口，查报错 / 横向溢出 / 画布空白 |
| `scripts/admin-audit.cjs` | 后台页无头自检（**真登录 + 真接口**，只读）：查白屏 / console 报错 / 溢出并留截图；`AUDIT_DIST=` 可指向私有构建目录 |
| `scripts/fidelity/` | 还原度与抠图精度跑分（改算法前后各跑一次比数字） |

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm install --frozen-lockfile
pnpm build
pnpm verify              # 全站自检（跑的是 dist/）
pnpm fidelity            # 还原度跑分
# 后台页自检：需要临时管理员（用 qq 上的 /opt/douwan-api/bin/seed -drafts=false 建，测完删掉）
$env:ADMIN_USER='xxx'; $env:ADMIN_PASS='yyy'
$env:ADMIN_API_BASE='https://dw.sharyuke.com'; $env:AUDIT_OUT='C:\Users\sharyuke\AppData\Local\Temp\douwan-admin-audit'
node scripts/admin-audit.cjs
```

> ⚠️ pnpm 11 不再读 `package.json` 的 `pnpm.onlyBuiltDependencies`，构建脚本白名单必须写在
> `pnpm-workspace.yaml` 的 `allowBuilds: { esbuild: true }`，否则 `pnpm install` 会以退出码 1 结束。
>
> ⚠️ **同一个工作区可能有第二个会话在同时改代码**（2026-10-16 下午就发生过：一边做「访问量」、
> 一边做首页改版 + 本地 AI）。两个会话往同一份工作区里 `tar -x` / `git add -A` 会互相覆盖文件，
> 甚至把对方未完成的改动带进提交。稳妥做法：
> 用 `git worktree add /tmp/<私有目录>` 建隔离工作区 → 只在里面构建（`vite build --outDir dist-xxx`）→
> 提交时**只 add 自己的路径**；共享文件（`router.js`/`config.go`/`repository.go`/`migrate.go`）
> 若已被对方改过，就用 `git update-index --cacheinfo` 把自己那一版写进索引而**不覆盖工作区文件**。

### 2.2 后端 `douwan-api`（已完成首个版本，不再是脚手架）

- 路径：本机 `C:\Users\sharyuke\Documents\work\douwan\douwan-api`；仓库 <https://gitee.com/maryuke/douwan-api.git>（**私有**，`master`）
- 线上：`https://dw.sharyuke.com/api/v1/...`（nginx 反代到 `127.0.0.1:8080`）
- Go 1.26 + Gin + GORM + PostgreSQL 16；`module gitee.com/maryuke/douwan-api`
- 已实现：健康探针、账号与鉴权（注册 / 登录 / 刷新轮换 / 登出 / 资料读写）、统一响应体与错误码、
  业务表（用户 / 会员 / Credits / 用量 / 作品 / 库存 / 素材 / 色板 + 后台管理 10 张 + 活跃监控 2 张 + 访问量 2 张），
  接口清单见仓库 `docs/api.md`
- 后台管理（套餐 / 卡密 / 订单 / 素材 / 用户 / 设置 / 日志 / 管理员）与**用户活跃数据监控**
  （`/api/v1/admin/activity/*`，权限点 `activity.view`；设计与口径见仓库 `docs/activity.md`）
- **站点访问量（PV / UV，含未登录访客）**：表 `site_visitors` + `site_visitor_page_daily`，
  上报接口 `POST /api/v1/visits`（**允许匿名**，OptionalAuth + 限流），后台 `/admin/activity/traffic`
  与 `/traffic/visitors`（复用 `activity.view`）。要点：
  - 路径收的是**路由模板**（`/library/:slug`），非法值统一归 `/other`；后台页面与 404 不计数
  - UV = 浏览器随机访客标识的去重值（**不是人数**：清缓存 / 换设备 / 无痕都算新访客）；
    与「用户活跃」是两套口径，数字不合并、不互相加减
  - 客户端 2 秒 + 服务端 2 秒去抖；访问明细随 `activity.retain_days` 硬删，访客档案保留
    （`first_day` 是新老访客的依据，删了会让回访用户变成新访客）
  - 只新增配置项 `activity.visit_report_per_minute`（默认 240）；`freshness` 里访问量缓冲
    与活跃缓冲分开报（`buffered_visits` / `dropped_visits`）
- 测试：纯 Go SQLite 内存库 + `httptest`，**不需要起 PostgreSQL**：`go test ./...`
  - ⚠️ 真 PG 上才暴露的问题（`ON CONFLICT DO UPDATE` 列名歧义、jsonb 写法、部分唯一索引）
    靠 `internal/handler/postgres_test.go` 兜：`DOUWAN_TEST_POSTGRES_DSN=... go test ./internal/handler/ -run Postgres`。
    本机没有 PG，可用 `ssh -f -N -L 15432:127.0.0.1:5432 qq` 隧道 + qq 上的空库 `douwan_pgtest`
    跑一遍（用完 `DROP DATABASE`）

加一个业务模块的固定套路（README 里也写了）：
`model`（加进 `model.AllModels()`）→ `repository` → `dto` → `service` → `handler` → `router` 挂 `/api/v1/...` → 补 `_test.go`。

⚠️ **新增权限点要改两处**：`model.rolePermissions`（角色矩阵）**和** `model.permissionOrder`
（全部权限点的唯一清单）。`/admin/auth/me` 返回的 `permissions` = 「清单 ∩ 角色权限」，
只改矩阵不改清单的后果是「接口 200、后台页面进不去」（前端路由守卫直接跳 `/admin/forbidden`）——
`activity.view` 就这么踩过一次，现在有 `internal/model/admin_test.go` 盯着（清单必须等于矩阵并集）。

核心约定：**HTTP 状态码管协议层，body 里 `code == 0` 才是业务成功**；内部错误只进日志不出接口
（`response.From()` 会把非数据库的业务错误折叠成 10500）。

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\douwan-api
go vet ./...
go test ./...
go build -o bin\server.exe ./cmd/server
go build -o bin\migrate.exe ./cmd/migrate
```

### 2.3 提交代码（在本机提交）

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
git add <只加自己改的路径>
git commit -m "feat: ..."
git push
```

- 本机已配好 Git 凭据：`pindoudou` 的 remote 内嵌账号密码（历史遗留），
  `douwan-api` 走 Git Credential Manager，`git push` 可直接用。
- ⚠️ 本机 `douwan-api` 是从 home 工作区整包同步的：`master` 比 `origin/master` 落后 5 个提交
  （QQ 登录相关），且工作区里有并行会话未提交的本地 AI 模块。先不要贸然 `git pull`，
  等这批 AI 改动提交/确认后再合并，避免覆盖。

---

## 3. 凭据（**不要提交进任何仓库、不要贴到公开地方**）

| 用途 | 值 / 位置 |
| --- | --- |
| **Gitee maryuke 私人令牌**（建仓 + 推送 douwan-api） | 不写在本文件里（本仓是公开仓，令牌不能进公开仓库）——新令牌放本机 `~/.gitee` 或 Gitee 账号设置页；2026-10-24 之前那枚曾写在本文件里，**已在 Gitee 上作废，请重新生成并吊销旧的** |
| Gitee sharyuke 令牌（另一个账号，建过 notes/ssh 等仓库） | home 的 `~/.gitee`（`{"token":"998b...","username":"sharyuke"}`）；`~/.netrc` 里也是 sharyuke |
| pindoudou 仓库密码 | 内嵌在本机 `pindoudou/.git/config` 的 remote URL 里 |
| 线上数据库密码 / JWT 密钥 | **只在 qq 的 `/etc/douwan/api.env`**（600，root）；部署文档里有读取与更换方法 |
| 服务器登录 | 全部走 ssh 公钥，本机与 home 都已能免密 `ssh qq` / `ssh pro` / `ssh home` |

Gitee API 备忘（v5，认证只能传 `access_token`，**传账号密码会 401**；推送才能用密码当口令）：

```bash
# 当前令牌身份
curl -s "https://gitee.com/api/v5/user?access_token=$T"
# 建仓（name 必须 ≤ 仓库名规则；private=true 私有；auto_init=false 不初始化）
curl -s -X POST "https://gitee.com/api/v5/user/repos" -d "access_token=$T" -d "name=douwan-api" -d "private=true" -d "auto_init=false"
# 删仓
curl -s -X DELETE "https://gitee.com/api/v5/repos/maryuke/douwan-api?access_token=$T"
```

> Gitee **不支持 push 建仓**（推不存在的仓库只会 404），必须先用 API 或网页建好空仓库。

---

## 4. 部署（详细步骤见 [DEPLOY.md](DEPLOY.md)）

线上是 **qq** 上的 `https://dw.sharyuke.com`：nginx 托管前端静态文件，`/api/`、`/healthz`、`/readyz`
反代到 `127.0.0.1:8080` 的 `douwan-api.service`，数据在 PostgreSQL 16 的 `douwan` 库，证书由 certbot 自动续期。

发布顺序（**后端先迁移再起服，前端直接覆盖**）：

```powershell
# ① 后端：本机测试 + 交叉编译 + 推送
cd C:\Users\sharyuke\Documents\work\douwan\douwan-api
go test ./...
$env:CGO_ENABLED='0'; $env:GOOS='linux'; $env:GOARCH='amd64'
go build -trimpath -ldflags='-s -w' -o bin\server ./cmd/server
go build -trimpath -ldflags='-s -w' -o bin\migrate ./cmd/migrate
tar -czf .tmp\douwan-api-bin.tar.gz -C bin server migrate
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
tar -czf .tmp\douwan-web.tar.gz -C dist .
scp .tmp\douwan-web.tar.gz qq:/tmp/
ssh qq 'rm -rf /var/www/dw.sharyuke.com/* && tar -xzf /tmp/douwan-web.tar.gz -C /var/www/dw.sharyuke.com
  && chmod -R 755 /var/www/dw.sharyuke.com'

# ④ 公网验证（从 pro 走真实外网）
ssh pro 'curl -s -o /dev/null -w "https %{http_code} %{time_total}s\n" https://dw.sharyuke.com/; curl -s https://dw.sharyuke.com/healthz'
```

常用运维：`ssh qq 'journalctl -u douwan-api -n 100 --no-pager'`、
`ssh qq 'tail -f /var/log/nginx/dw.sharyuke.com.error.log'`、`ssh qq 'systemctl restart douwan-api'`。

---

## 5. 当前状态与待办

**已完成（2026-10-15）**

- `douwan-api` 首次提交 `e965b19` 并推到 `gitee.com/maryuke/douwan-api`（私有）
- qq 上从零装好 nginx 1.24 / PostgreSQL 16.15 / certbot 2.9，建库建表 12 张，后端跑成 systemd 常驻服务
- 前端构建产物部署到 `/var/www/dw.sharyuke.com`
- HTTPS 签发成功（有效期至 2027-01-13，`certbot.timer` 自动续期）；`http://` 301 → `https://`
- 端到端验证 12 项全绿；测试账号已清理（`users` 表为空）
- **后台「用户活跃数据监控」上线**（`douwan-api` 提交 `ff386b6` + `f4e6a3a`）：
  使用频率 / 地区 / 功能使用 / 来源渠道四个维度，8 个 `/api/v1/admin/activity/*` 接口 +
  客户端埋点上报 `POST /api/v1/events`；表 `user_daily_activities`、`user_feature_daily`，
  `users` 加 `last_active_at` / `channel` / `channel_detail`
  - 地区解析靠本地 ip2region 数据文件：**qq 上在 `/var/lib/douwan/ip2region_v4.xdb`**（11MB，不在仓库里，
    换机器/重装要重新放，见 `docs/activity.md` §4）
  - systemd 单元加固过：`ReadWritePaths=-…` + `ExecStartPre=+…` + `/etc/tmpfiles.d/douwan.conf`，
    以后误删 `/var/lib/douwan/uploads` 也能自愈启动（原先会 226/NAMESPACE 起不来）
  - 公网端到端验证全绿（含地区解析出「重庆市 电信」、功能/渠道/留存/频率数据），验证数据已清理

**已完成（2026-10-16）**

- **活跃监控做进了后台前端并上线**：`pindoudou` 新增 `src/views/admin/AdminActivityView.vue`
  （路由 `#/admin/activity`，权限点 `activity.view`，左侧「经营」组第 2 项），
  7 个标签页覆盖四个维度 + 留存 + 用户明细；配色直接吃 `global.css` 的品牌令牌
  （`--primary:#F03D2E` / `--grad`），没有新增任何依赖
- 顺手修掉一个**真 bug**：`service.PermissionList` 里那份手写权限清单漏了 `activity.view`，
  表现是「接口 200、后台页面跳 /admin/forbidden」。现在清单收敛到 `model.permissionOrder()`
  并有 `internal/model/admin_test.go` 断言「清单 == 各角色矩阵并集」
- 临时预览页 `https://dw.sharyuke.com/activity-preview.html` 也换成了品牌色（渐变方块 + 橙红主色），
  定位改成「只读预览」，正式入口以后台页面为准
- 后台界面的无头自检加进了新页：`ADMIN_USER=… ADMIN_PASS=… node scripts/admin-audit.cjs`
  → **24/24 通过**（桌面 + 手机两种视口，无 console 报错、无横向溢出）

**已完成（2026-10-16 下午）——「用户访问量」上线（`douwan-api` `420e33a`+`edd8835`，`pindoudou` `544cc02`）**

- 口径：「访问量（PV）= 页面被打开多少次」「访客数（UV）= 多少个浏览器来过」，**含未登录访客**；
  与「用户活跃」（只算登录用户）是两套口径，页面上明写「数字不能互相加减、UV 不是人数」
- 后端：`site_visitors` + `site_visitor_page_daily` 两张日汇总表；`POST /api/v1/visits`（匿名可上报，
  非法 visitor 由服务端换发新标识并回传，路径按路由模板归一化，非法值归 `/other`）；
  后台 `GET /admin/activity/traffic`（PV/UV 卡 + 趋势 + 页面排行 + 落地页 + 来源）与
  `/traffic/visitors`（访客明细，可按 `path` / `channel` 筛选、`sort` 排序），权限复用 `activity.view`
- 前端：`src/lib/telemetry.js` + 路由 `afterEach` 埋点；后台页新增「访问量」标签页
  （10 个 KPI + PV/UV 双色柱状趋势 + 4 张表），`adminNav` 顶栏副标题同步
- 验证：`go vet` + 全量单测 + **真 PG 冒烟**（`douwan_pgtest`，用完已 DROP）全绿；
  公网端到端用真实 Chrome 打开线上页面，确认访问真的落库（匿名、地区解析出「重庆市 电信」）；
  后台无头自检 **26/26 通过**（新增访问量页的桌面 / 手机两档）
- 注意：线上 `site_visitors` / `site_visitor_page_daily` 里目前那几条记录（5 访客 / 14 PV）
  全部来自本次验证用的 curl 与无头 Chrome，**不是真实用户**；要清空就直接 `TRUNCATE` 这两张表

**已完成（2026-10-16 傍晚）——色板扩到 8 个体系 15 套（`pindoudou` `6fc167b`，已部署）**

- 色板选择器现在是：**MARD 24 / 48 / 72 / 96 / 120 / 221 / 264 / 291 色套装**（一套色号的八个套装，
  同一色号在任何套装里色值都相同，换套餐只增删色号）＋ **COCO 291 / 漫漫 278 / 盼盼 285 / 咪小窝 286**
  ＋原保留的**优肯 Artkal C197 / Hama 92 / Perler 103**（后两者有独立 SEO 落地页，别删数据）＋自定义色板
- `scripts/build-palette.cjs` 重写：多源交叉验证 + 硬校验（来源不一致 / 重复色号 / 套装嵌套被破坏 → **中止构建**）；
  `--check` 只校验、`--offline` 复用 `scripts/.palette-cache`（已 gitignore）
  - MARD 221 用**官方色卡版（Alfonse）覆盖**、291 多出的 70 色走公开色卡库，口径写在每个色板的 `note` 里
  - 盼盼 / 咪小窝各有 4 个上游认不出真实品牌编号的色号，**直接剔除**（不做猜测），所以是 285 / 286
- 会员权益改成按「**体系**」判定：免费版漫德每个套装都给全，其它品牌 48 色精简（Pro 全解锁）；
  色号总数按体系去重 → `PALETTE_TOTAL_CODES = 1823`（**别再写死 613**，那是旧的 4 品牌之和）
- `MAX_TARGET_COLORS` 当时仍是 **221**（卡在存档容量；**深夜已放到 291，见下一条**），
  不是画质；色板更大只是让「取哪 221 种」更准
- 新增两条自检：`pnpm verify:palette`（数据层，1 秒）与
  `pnpm verify:palette-ui`（editor / settings / inventory × 4 视口的选项与权益）
- 色板总览图（肉眼复核色号有没有整体错位）：[docs/palette-overview.png](docs/palette-overview.png)
- 验证：数据自检 + `verify:archive` + 全站 84 页自检 0 错误 + 色板自检 3 入口 × 4 视口全绿；
  公网 `https://dw.sharyuke.com` 从 pro 走真实外网复核过（bundle 里 15 套色板齐全）
- ⚠️ 这次是在 `/tmp/pal-work` 隔离工作区里改 + 构建 + 部署的（共享工作区当时有并行会话的未提交改动）；
  收尾时已把改动**镜像回共享工作区**（7 个重叠文件是逐个手改进去的，两边改动都在）。
  qq 上留了回滚包 `/tmp/dw-web-backup-20261016-170942.tar.gz`

**已完成（2026-10-16 夜里）——工作台 ④ 收成一行「色板选择」（`pindoudou` `ded804a`，已部署）**

- `EditorSidebar.vue` 的 ④ 卡头不再分宽窄屏两套：整行就是「**色板选择** + 当前值（几色 · 哪个色板）+ ▼」，
  点开才是颜色数量 / 色板 / 填充方式 / 高级参数；手机默认收起、**桌面默认展开**
  （`matchMedia('(max-width:780px)')` 定档，用户手动点过之后不再随窗口宽度自动改）
- 展开后色板从普通 `.field` 抬成 `.paletteHero`（品牌色描边 + 淡红底 + 大号下拉 + 「本套可用 N 色」+
  来源说明），并排到参数最前；免费版被砍色号时的升级提示与「解锁全部色板」也收进这块
- ⚠️ **踩到的坑（以后改折叠必看）**：面板上挂着 `.stack`（`display:flex`），
  全局那条 `.card.is-folded > .card__body{display:none}` 会被它盖掉 —— 表现是
  「卡头已经收起、参数还摊在下面」的**假收起**，而且手机上不报错、只看整页截图看不出来。
  现在由 `.card--more:not(.is-open) > .card__body{display:none}` 显式压住
- 自检跟上：`audit-mobile.js` 的 `foldBtnOf` 现在认两种折叠开关（`.moreRow` / `.cardFoldBtn`），
  并断言「手机收起 / 桌面展开」的默认档位 + 收起时整张卡只有一行高；
  `audit-palette.js` 先点开那一行再量（手机上色板下拉默认是 `display:none`）
- 验证：全站 84 页自检 0 错误（4 档视口）+ `verify:mobile`（除基线本来就有的
  「`/editor` 空状态只有 2 张卡 → allFolded=false`，改动前后一致）+ `verify:palette-ui` 3 入口全绿
  + `verify:palette` / `verify:archive` 全通过；**线上实例用 `--url https://dw.sharyuke.com` 真浏览器复核**
  （桌面 633px 展开 / 手机 54px 收起、点开 542px、色板下拉 16 项）
- ⚠️ 这次同样在 `/tmp/moreset-work` 隔离工作区里改 + 构建（共享工作区当时也有别的 worktree 在跑）；
  收尾已把 5 个文件镜像回共享工作区并把 HEAD 快进到 `ded804a`。
  qq 上留了滚动前的回滚包 `/tmp/dw-web-backup-before-palette-fold.tar.gz`
- 效果图（收起一行 / 展开后的色板块）：
  [手机·收起](docs/palette-fold-mobile-closed.png) ·
  [手机·展开](docs/palette-fold-mobile-open.png) ·
  [桌面·展开](docs/palette-fold-desktop-open.png)
- 小抄：隔离 worktree 里 `corepack pnpm build` 会先跑 `pnpm install`（符号链接的 node_modules 会被当成
  「需要重装」而失败）；直接跑 `./node_modules/.bin/vite build` 绕过，自检脚本仍读 `dist/`

**已完成（2026-10-16 深夜）——颜色数量上限 221 → 291（`pindoudou` `1d94226`，已部署）**

- 用户要的是「颜色数量滑块能拖到 291」。这条上限从来不是画质问题，而是
  **「引擎能选多少色」必须 ≤「存档能存多少色」**，所以三处一起改（缺一处就静默出错）：
  - `lib/archive.js`：紧凑存档字符集 256 → **548**（补齐被 slice 掉的拉丁扩展-A + 接上拉丁扩展-B），
    **`PACK_CAPACITY` 255 → 547**；⚠️ 前 256 个字符逐字不变，新增字符只接在末尾（老存档必须原样可解）；
  - `lib/pattern.js`：`MAX_TARGET_COLORS = 291`；记忆化下标 `Uint8Array` → **`Uint16Array`**
    （下标最大 290，8 位会静默绕回成 34 → 「某些格子变成别的颜色」），`MEMO_MAX_COLORS` 250 → 512；
  - 文案：设置页 / 帮助页 / 编辑器注释 / README（色号上限一节 + 存档对照表）/ `scripts/README.md`；
    编辑器手机端档位梯子补一档 264。
- 新增自检（这三条是这次改动的验收点，以后别再退化）：
  - `verify:archive`：291 色（含 **>255** 的高色号）编码→JSON→解码逐格一致；
    两条历史字符集（纯 ASCII 90 色时代 / 容量 255 那一版）解码逐格不变；
    上限档真实生成 → 打包 → 还原一致。
  - `verify:palette`：断言「每套色板都能整块用上」「上限 = 291 = 最大色板」「容量 ≥ 上限」。
  - `verify:palette-ui`：新增浏览器断言「**滑块 / 数字框 / 下拉三处 max 都 = 引擎上限**」
    （色号控件加了 `data-audit="target-colors"` 标记）——只读常量的单测查不出「界面某处写死 221」。
- ⚠️ **实测结论（别误会这次改动的效果）**：同一张照片、312 / 450 格、high 档，
  目标 90 / 221 / 291 的图案色板是 **94 / 127 / 127 色**，耗时 380 / 344 / 336 ms ——
  **引擎自己提前收敛在 ~127 色**（贪心选色边际收益 ≤0 就 break，README 早有记录）。
  所以这次改动的意义是「允许用户要 291、真要到了也存得下」，**不是「图案颜色变多」**；
  想让照片真的用更多颜色，得改收敛策略或量化目标，那是另一件事。
- 验证：`verify:archive` / `verify:palette` 全绿、`verify:palette-ui` 3 入口 × 4 视口全绿、
  全站 84 页自检 0 错误；线上用 `--url https://dw.sharyuke.com` 真浏览器复核
  （编辑器滑块 max = 291、数字框 = 291、手机下拉最大档 = 291、当前可用色号 291）。
  qq 回滚包 `/tmp/dw-web-backup-before-cap291-20261016-183547.tar.gz`

**已完成（2026-10-18）——开发环境迁到本机 Windows**

- 从 home 整包同步了两个仓库（含 `.git` 和未提交改动）：
  `pindoudou`（`b846d19`，工作区干净）、`douwan-api`（`166879c` + 本地 AI 未提交改动）
- 本机装好 Node v24.21.0 / pnpm 11.17.0 / Go 1.26.0（都在 `tools\`，用户 PATH 与环境变量已持久化）
- 前端 `pnpm install --frozen-lockfile` + `pnpm build` 通过，产物哈希与线上一致；
  后端 `go vet ./...` + `go test ./...` 全绿，native 与 linux/amd64 交叉编译都通过
- ⚠️ pnpm 必须用 hoisted 布局（`npm_config_node_linker=hoisted`），否则 Windows junction 会让
  Vite 报 `Cannot find package 'picomatch'`
- `douwan-api` 的 `master` 仍比 `origin/master` 落后 5 个提交（QQ 登录相关），
  与本地 AI 未提交改动有重叠风险，暂未合并

**已完成（2026-10-18）——工作台卡片默认折叠 + 图纸交付 / 我的库存换位（`pindoudou` `5ab3ce6`，已部署）**

- 除 ① 创建外，② 画布大小 / ③ 生成方案 / ④ 色板选择 / 作品分析 / 颜色用量 / ⑤ 图纸交付 / 我的库存
  全部默认折叠；卡头右侧统一用 24px 品牌色圆钮 `.cardArrow`（收起淡底橙字、展开实底白字 + 旋转），
  ②④ 的整行按钮里也用同一颗，所有箭头样式一致
- ⑤ 图纸交付移到左栏最下面（标题加编号 ⑤），我的库存移到右栏最下面；手机端 order 同步调整
  （③ 方案 → ② 尺寸 → ④ 设置 → 分析 → 颜色 → ⑤ 交付 → 库存）
- 验证：`pnpm build` + 全站 84 页自检 0 错误 + `verify:mobile` + `verify:palette-ui` +
  色板 / 存档自检 + 交付面板自检全绿；线上用 `--url https://dw.sharyuke.com` 真浏览器复核
  （桌面 + 手机：7 个箭头样式一致、逐张开合、⑤ 能打开交付面板）
- qq 回滚包 `/tmp/dw-web-backup-before-card-fold-20261018-143634.tar.gz`
- ⚠️ 本机无头 Chrome 在 Node 子进程里需要 `--no-sandbox` 才能启动；自检产物与 Chrome profile
  统一放在仓库内 `.tmp/`（已 gitignore），不再依赖系统临时目录

**待办**

1. **前端功能埋点还没接**：访问量（页面级）已经通了，但 `pattern.generate` / `pattern.export` /
   `pattern.matte` / `pattern.save` 这类**浏览器内的功能行为**还没调 `POST /api/v1/events`，
   所以后台「功能使用」页里没有 client 来源的数据（白名单见 `docs/activity.md` §6）。
   注意 `useStudio.js` / `exporters.js` 正在被并行会话改，接的时候要小心冲突
2. **没有 Redis**：刷新令牌在进程内存，重启服务 = 所有人重新登录；要持久化就装 redis 并开 `redis.enabled`
3. **没有自动备份**：建议加 cron `pg_dump` 并把 dump 拉回本机（活跃监控与访问量四张表都在备份范围内）
4. **色板 / 素材数据未导入**：`palette_*`、`assets` 表是空的，待写 `cmd/seed` 从
   `pindoudou/src/data/{palette,assets}.js` 导入
5. **README 引用的 PRD 文档（§15.3 / §43 / §44）在仓库里找不到**，需要按 PRD 对齐时先向用户要
6. **pro 上还留着旧版 pindoudou**（`/var/www/douzao`），域名没切过去的话可以考虑清理或做跳转
7. **并行会话的在做的「本地 AI 出图」模块**（`internal/localai`、`internal/service/ai.go`、
   `repository/ai_*.go`、`model/ai_job.go`、`dto/ai.go`、`internal/handler/ai.go`）在
   `douwan-api` 工作区里**尚未提交**；本机 `go vet ./...` / `go test ./...` 已通过，但未部署这部分。
   访问量模块提交时已刻意避开这些文件（`config.go` / `migrate.go` / `repository.go` 只提交本模块所需的行）
8. **临时预览页 `activity-preview.html` 现在是历史遗留**：正式入口是 `#/admin/activity`，
   保留只是为了对外做只读演示，等用户确认后可删
