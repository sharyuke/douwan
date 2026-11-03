# 后端 douwan-api

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §2.2。

### 2.2 后端 `douwan-api`（已完成首个版本，不再是脚手架）

- 路径：本机 `C:\Users\sharyuke\Documents\work\douwan\douwan-api`，和前端在同一个仓库里。旧地址 <https://gitee.com/maryuke/douwan-api.git> 只留作历史，不再往那里提交
- 线上：`https://dw.sharyuke.com/api/v1/...`（nginx 反代到 `127.0.0.1:8080`）
- Go 1.26 + Gin + GORM + PostgreSQL 16；`module gitee.com/maryuke/douwan-api`
- 已实现：健康探针、账号与鉴权（注册 / 登录 / 刷新轮换 / 登出 / 资料读写）、统一响应体与错误码、
  业务表（用户 / 会员 / Credits / 用量 / 作品 / 库存 / 素材 / 色板 + 后台管理 10 张 + 活跃监控 2 张 + 访问量 2 张），
  接口清单见仓库 `docs/api.md`
- 后台管理（套餐 / 卡密 / 订单 / 素材 / 用户 / 设置 / 日志 / 管理员）与**用户活跃数据监控**
  （`/api/v1/admin/activity/*`，权限点 `activity.view`；设计与口径见仓库 `docs/activity.md`）
- **SEO 平台**（2026-10-25 上线，权限点 `seo.view` / `seo.manage`）：`internal/seo/`（渲染 / 内容 / 推送）、
  `internal/{model,repository,service,handler}/seo*.go`、`/api/v1/admin/seo/*` 7 个接口、
  表 `seo_push_tasks`、`library_assets`/`library_categories` 加 `seo_title`/`seo_description`/`seo_no_index`。
  交付文档见 `pindoudou/docs/seo.md`；架构决策见工作区记忆 `topics/seo-architecture.md`
- **SEO V3.0 关键词管理**（2026-10-25 上线，复用 `seo.view`/`seo.manage`）：
  表 `seo_keywords`（分组 / 优先级 / 意图 / 目标页 / 状态 / 引擎 / 曝光 / 点击 / 点击率 / 排名 / 统计周期 / 数据来源），
  `/api/v1/admin/seo/keywords*` 11 个接口（含 CSV 导入、库同步、冲突检测、页面字段自检、低点击率候选、
  Search Console 数据导入）+ `POST /admin/seo/regenerate` 重新生成自动文案。
  交付文档见 `pindoudou/docs/seo-v3.md`
  - ⚠️ 关键词表的分组列名是 **`keyword_group`**（`group` 在 SQLite 和 PostgreSQL 里都是保留字），
    Go/JSON 字段仍叫 `group`；写 SQL 一定要用 `keyword_group`
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

> ⚠️ **本机 `go test` 可能跑不了改过的包**：本机有「企业签名级别」的 WDAC 策略，
> Go 构建是确定性的 ⇒ 没改过的包每次哈希一样能跑，**一改代码哈希就变**会被直接拦掉：
> `fork/exec ...test.exe: An Application Control policy has blocked this file.`
> 事件日志在 `Microsoft-Windows-CodeIntegrity/Operational`（Id 3033 / 3077）。
> **对策：后端测试放到 home 上跑**（home 有 Go 1.26.8）：
> ```powershell
> cd C:\Users\sharyuke\Documents\work\douwan\douwan-api\.tmp\wt-seo
> & "C:\Windows\System32\tar.exe" -czf ..\wt-seo-src.tar.gz --exclude=.git --exclude=.tmp --exclude=bin .
> scp ..\wt-seo-src.tar.gz home:/tmp/wt-seo-src.tar.gz
> ssh home 'rm -rf /tmp/wt-seo-test && mkdir -p /tmp/wt-seo-test && tar -xzf /tmp/wt-seo-src.tar.gz -C /tmp/wt-seo-test && cd /tmp/wt-seo-test && go vet ./... && go test -count=1 ./...'
> ```
> 注意 PATH 上的 `tar` 是 Git 的 GNU tar，会把 `C:\...` 当远程主机名 —— 要用
> `C:\Windows\System32\tar.exe`（bsdtar）。
