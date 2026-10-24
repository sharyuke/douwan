# 豆玩 DOUWAN 工作区说明（DSH 控制端）

本机是**控制端**：只有 git / ssh / scp，没有 node / pnpm / go，也没有项目源码。
真正的代码、构建、测试都在 `home`（192.168.1.135）上做，线上跑在 `qq` 上。
主机、部署、凭据的完整说明见上级目录的 [AGENTS.md](../AGENTS.md) 与 [DEPLOY.md](../DEPLOY.md)。

## 目录

| 目录 | 作用 |
| --- | --- |
| `.mirror/douwan-api` | home 上后端源码的**只读镜像**，用 read/grep 工具分析用 |
| `.mirror/pindoudou` | home 上前端源码的**只读镜像** |
| `tools/` | 同步脚本与说明 |

> `.mirror` 是镜像，改动它不会影响 home。**改代码的正确流程**：
> 在本机编辑 → `scp` 推到 home → 在 home 上 `go build` / `go test` / `pnpm build`。

## 从 home 拉取源码（刷新镜像）

```powershell
# 后端
$dest = Join-Path $PWD ".mirror\douwan-api"
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
ssh home 'cd ~/Documents/work/dw/douwan-api && tar --exclude=.git --exclude=bin --exclude=dist -czf /tmp/dw-api.tgz .'
scp -q home:/tmp/dw-api.tgz "$env:TEMP\dw-api.tgz"
tar -xzf "$env:TEMP\dw-api.tgz" -C $dest

# 前端
$dest = Join-Path $PWD ".mirror\pindoudou"
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
ssh home 'cd ~/Documents/work/dw/pindoudou && tar --exclude=.git --exclude=node_modules --exclude=dist -czf /tmp/dw-web.tgz .'
scp -q home:/tmp/dw-web.tgz "$env:TEMP\dw-web.tgz"
tar -xzf "$env:TEMP\dw-web.tgz" -C $dest
```

## 把本机改动推到 home

```powershell
scp -q -r "$PWD\.mirror\douwan-api\internal\*" home:~/Documents/work/dw/douwan-api/internal/
```

## 相关文档（都在 `.mirror` 里）

| 文档 | 说明 |
| --- | --- |
| `.mirror/douwan-api/docs/api.md` | 接口契约（含后台「用户活跃数据监控」8 个接口 + `POST /api/v1/events` 埋点上报） |
| `.mirror/douwan-api/docs/activity.md` | 活跃监控的设计、统计口径、ip2region 数据文件部署、运维排查 |
| `.mirror/douwan-api/docs/admin.md` | 后台管理系统交付说明 |

## 用户活跃监控页面

正式页面已经在后台前端里：**<https://dw.sharyuke.com/#/admin/activity>**（豆玩后台 → 经营 → 用户活跃监控，
权限点 `activity.view`，源码 `pindoudou/src/views/admin/AdminActivityView.vue`）。
页面共 8 个标签页：总览 / **访问量** / 留存 / 使用频率 / 地区 / 功能使用 / 来源渠道 / 用户明细。

**访问量（PV / UV，含未登录访客）**是 2026-10-16 下午新增的：
- 前台埋点在 `pindoudou/src/lib/telemetry.js`（路由切换时上报 `POST /api/v1/visits`）
- 后台接口 `GET /api/v1/admin/activity/traffic`（指标卡 + 趋势 + 页面排行 + 落地页 + 来源）
  与 `GET /api/v1/admin/activity/traffic/visitors`（访客明细）
- 口径细节见 `.mirror/douwan-api/docs/activity.md` §12；**UV 不是人数**（访客标识存在浏览器本地）

验证一次「线上埋点真的在写库」（在 pro 上跑，走真实外网）：

```bash
curl -s -X POST https://dw.sharyuke.com/api/v1/visits \
  -H 'Content-Type: application/json' -d '{"path":"/","referrer":"https://tieba.baidu.com/p/1"}'
# 返回里会带 visitor；立刻重发同一个 path 应得到 accepted=false（2 秒去抖）
```

想清掉验证留下的假数据（`site_visitors` / `site_visitor_page_daily` 两张表都在 douwan 库里）：

```sql
TRUNCATE site_visitor_page_daily, site_visitors;
```

下面这个单文件静态页保留作**只读预览**（不进后台也能快速看一眼，配色与后台统一）：

**<https://dw.sharyuke.com/activity-preview.html>**（用管理员账号登录，令牌只存在该标签页）

| 文件 | 作用 |
| --- | --- |
| `preview/activity-preview.html` | 预览页本体（无外部依赖）。改完 scp 到 `qq:/var/www/dw.sharyuke.com/activity-preview.html` |
| `preview/seed-preview-data.sh` | 造一点真实自测流量（注册 `actverify*` 账号打前台接口），否则页面上全是 0 |
| `preview/check-preview-api.sh` | 抽查预览页要渲染的接口返回值（在 pro 上跑，需要临时管理员密码） |

> 后台页面的自检在 home 上跑：`ADMIN_USER=… ADMIN_PASS=… node scripts/admin-audit.cjs`
> （真登录 + 真接口，只读；会输出截图与 `report.json`；`AUDIT_DIST=/path/to/dist-xxx` 可指定私有构建目录，
> 与并行会话同时构建时不会互相覆盖）。
> 临时管理员用 `qq` 上的 `/opt/douwan-api/bin/seed -config /etc/douwan/config.yaml -admin actcheck01 -drafts=false`
> 建（密码走 `DOUWAN_SEED_ADMIN_PASSWORD`），测完 **必须删掉**：`tools/cleanup-e2e.sh` 已覆盖 `actcheck%`。
> 注意 `cleanup-e2e.sh` 也会顺手删掉 `actverify%` 自测账号与它们的活跃记录（`users` 表会回到 0），
> 但它**不动访问量表**（访问量按访客计，与用户账号无关）。

## 常见坑

- **本机 PowerShell 是 5.1，禁止运行 .ps1**（ExecutionPolicy）。命令请内联执行，别调脚本文件。
- 从 PowerShell 调 ssh 时内层引号会被吞掉；远端命令用**单引号**包住，
  超过两三行或要用 `$(...)`、括号、heredoc 时，用 base64 传脚本（见 AGENTS.md）。
- **不要**把 ssh 输出接到 `| tail` / `| head`：本机 PATH 里的 tail 是 Git 自带的，会报
  `fatal error - couldn't create signal pipe`。要截取就用 `$out | Select-Object -Last 40`。
- 控制台是 GBK，直接 `Get-Content` 看中文会乱码。看中文文件用 read 工具，
  或加 `-Encoding UTF8`。
