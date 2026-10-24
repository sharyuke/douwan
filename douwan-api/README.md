# 豆玩 DOUWAN 后端 API

拼豆图纸工作台 `pindoudou` 的服务端。前端原本是纯静态 SPA（账号、会员、Credits、作品存档
都放在 localStorage 里演示），这个服务把这些能力搬到服务端，并作为后续「后台相关功能」的骨架。

当前状态：**框架 + 一个跑得通的示例模块**（账号与鉴权）。其余业务表结构已经建好，
按同一套分层补 Service 与 Handler 即可。

## 技术栈

| 用途 | 选型 |
| --- | --- |
| 语言 | Go 1.26 |
| HTTP 框架 | Gin |
| ORM | GORM |
| 数据库 | PostgreSQL |
| 缓存 | Redis（可选，未启用时刷新令牌存进程内存） |
| 鉴权 | JWT（访问令牌）+ 不透明刷新令牌（可撤销、轮换） |
| 配置 | Viper（yaml + 环境变量覆盖） |
| 日志 | 标准库 log/slog |

## 目录结构

```
cmd/
  server/            服务入口（启动 HTTP、优雅关闭）
  migrate/           单独执行数据库迁移
configs/
  config.yaml        默认配置，任何一项都可用环境变量覆盖
internal/
  config/            配置加载与校验
  logger/            slog 日志器
  response/          统一响应体、业务错误码、参数校验中文提示
  middleware/        RequestID / 访问日志 / Recovery / CORS / JWT 鉴权
  router/            路由装配
  server/            依赖组装 + 优雅关闭
  model/             GORM 实体（全产品线已建好）
  database/          连接池、迁移、事务辅助
  repository/        数据访问层
  service/           业务层
  handler/           HTTP 层
  dto/               请求 / 响应结构（接口契约）
  auth/              JWT 签发校验、密码哈希、刷新令牌存储
  activity/          用户活跃采集（内存缓冲 + 异步落库、路由映射、IP 归属地）
  cache/             Redis 客户端
  testsupport/       测试装置（SQLite 内存库等）
deploy/
  Dockerfile         多阶段构建
docker-compose.yml   PostgreSQL + Redis + API
```

## 快速开始

```bash
# 1. 起依赖
make up                      # = docker compose up -d postgres redis

# 2. 启动服务（首次启动会自动建表）
make run                     # = go run ./cmd/server

# 3. 探活
curl -s http://127.0.0.1:8080/healthz
```

注册一个账号：

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"douwaner","password":"secret-pass-1","nickname":"拼豆小工"}'
```

带上返回的 `access_token` 查资料：

```bash
curl -s http://127.0.0.1:8080/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN"
```

接口清单见 [docs/api.md](docs/api.md)。

## 配置

优先级：**环境变量 > `configs/config.yaml` > 内置默认值**。

环境变量统一以 `DOUWAN_` 开头、层级用下划线连接：

```bash
DOUWAN_DATABASE_HOST=db.internal \
DOUWAN_DATABASE_PASSWORD=*** \
DOUWAN_JWT_SECRET=*** \
DOUWAN_APP_ENV=prod \
  ./bin/server
```

列表类配置用英文逗号分隔，例如 `DOUWAN_CORS_ALLOW_ORIGINS=http://a.com,http://b.com`。
完整变量名见 `.env.example`。

生产环境的两条硬约束（不满足会拒绝启动，见 `internal/config/config.go` 的 `Validate`）：

- `jwt.secret` 必须通过 `DOUWAN_JWT_SECRET` 换成真实密钥，不能是示例值
- `jwt.refresh_ttl` 必须大于 `jwt.access_ttl`

## 分层约定

一次请求的流向固定为：

```
router → middleware → handler → service → repository → GORM
                        ↓          ↓
                      dto        response（统一错误码）
```

- **handler** 只做「解析请求 → 调 service → 写响应」，不写业务规则
- **service** 编排业务、开事务、返回 `*response.Error`；不碰 `gin.Context`
- **repository** 只做增删改查，把 `gorm.ErrRecordNotFound` 之类的驱动错误翻译成业务错误
- 需要一次写多张表时用 `database.WithTx`，并在事务内用 `repos.WithTx(tx)`
  拿到绑定事务的仓储（注册就是这么做的：用户、订阅、Credits 账户、统计一起提交）

### 加一个业务模块

以「作品存档」为例：

1. `internal/model/project.go` 里已有实体，确认字段后加入 `model.AllModels()`
2. `internal/repository/project.go` 写仓储
3. `internal/dto/project.go` 定义请求 / 响应结构
4. `internal/service/project.go` 写业务（配额校验用 `response.ErrForbidden.WithMessage(...)`）
5. `internal/handler/project.go` 写处理函数
6. `internal/router/router.go` 里挂到 `/api/v1/projects`
7. 补 `_test.go`：service 层用 `testsupport.NewDB(t)`，handler 层参考
   `internal/handler/user_test.go` 的 `newEnv(t)`
8. **要加权限点就改两处**：`model.rolePermissions`（哪个角色能用）与 `model.permissionOrder`
   （全部权限点的唯一清单，同时决定展示顺序）。`/admin/auth/me` 返回的 `permissions`
   是「清单 ∩ 角色权限」，只加矩阵不加清单的后果是**接口能调、后台页面进不去**
   （前端路由守卫看不到权限点，直接跳 `/admin/forbidden`）——`activity.view` 就这么踩过一次。
   `internal/model/admin_test.go` 断言「清单 == 各角色矩阵的并集」，漏了会红

## 数据模型

表结构与前端已有的数据形态对齐，字段注释里标了对应的前端概念。

| 表 | 说明 | 对应前端 |
| --- | --- | --- |
| `users` | 账号 | 「我的账户」 |
| `memberships` | 会员订阅（套餐 / 到期时间 / 自动续费） | `useMembership.js` 的 `plan` |
| `credit_accounts` / `credit_transactions` | AI Credits 余额与流水 | `credits.balance` / `credits.log` |
| `usage_stats` | 生成 / 导出 / AI 调用次数 | `usage` |
| `projects` / `project_variants` | 作品存档与三方案图纸（jsonb） | `useStudio.js` 的 `projects` |
| `inventory_items` | 库存色号与数量 | `useInventory.js` |
| `assets` / `asset_favorites` | 素材库与收藏 | `src/data/assets.js` |
| `palette_brands` / `palette_colors` | 品牌色板（含预计算的 Lab 分量） | `src/data/palette.js` |
| `user_daily_activities` | 用户日活跃汇总（请求 / 功能次数、地区） | 后台「用户活跃数据监控」 |
| `user_feature_daily` | 用户功能使用日汇总（按功能 + 来源） | 同上 |

`users` 表还带了两个渠道字段（`channel` / `channel_detail`，注册时的首触来源）
与冗余的 `last_active_at`，供活跃监控做渠道分析与沉默用户筛选。

图纸这类大结构用 `jsonb` 存：单张 116×116 的图纸有 13456 格，
放 jsonb 里既能整存整取，也便于后续按需查内部字段。

> 色板与素材是内容数据，需要从 `pindoudou/src/data/` 导入，
> 导入脚本尚未编写（见「后续」）。

## 用户活跃数据监控

后台的活跃监控模块（使用频率 / 地区 / 功能使用 / 来源渠道）与普通业务模块的形态不同：
数据在**请求发生时**顺带采集，写库是异步批量的，所以它多了 `internal/activity` 这一层。

- 采集：`internal/activity` 在内存里按「用户 × 天」累加，每 `activity.flush_interval` 批量 upsert 一次
- 查询：`/api/v1/admin/activity/*`（权限点 `activity.view`），读侧 SQL 都在 `internal/repository/activity.go`
- 客户端埋点：`POST /api/v1/events` 上报图纸生成 / 导出 / 抠图这类服务端看不见的行为
- 地区：本地 ip2region 的 xdb 文件解析 IP 归属地，文件缺失只降级成「未知」，不影响启动

部署时需要额外做一件事——把 xdb 数据文件放到持久化目录（仓库里不放 11MB 二进制）：

```bash
curl -L -o /tmp/ip2region_v4.xdb \
  https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb
ssh qq 'mkdir -p /var/lib/douwan'
scp /tmp/ip2region_v4.xdb qq:/var/lib/douwan/ip2region_v4.xdb
```

设计与统计口径（活跃定义、留存口径、渠道归因、保留策略、运维排查）见
[docs/activity.md](docs/activity.md)。

## 测试

```bash
make test          # 全部测试
make test-race     # 带竞态检测
make cover         # 覆盖率
```

测试用纯 Go 的 SQLite 内存库（`github.com/glebarez/sqlite`），**不需要起 PostgreSQL**：
建表语句仍由同一份 GORM 模型生成。`internal/handler` 的测试通过 `httptest` 打真路由，
覆盖了注册 → 登录 → 刷新 → 登出 → 改资料整条链路，以及参数校验、鉴权失败、
跨域白名单、404 等分支。

## 部署

```bash
# 本地整套（含 API）
make docker-up

# 只跑迁移（生产建议把 database.auto_migrate 设为 false，由这步单独执行）
./bin/migrate -config /etc/douwan/config.yaml
```

`deploy/Dockerfile` 是多阶段构建，产出静态二进制；运行镜像是 alpine + 非 root 用户。

## 后续

- 活跃监控的**后台页面已经做完**（`pindoudou/src/views/admin/AdminActivityView.vue`，路由 `#/admin/activity`）；
  还差前端把浏览器内行为接上 `POST /api/v1/events`（生成 / 导出 / 抠图）
- 把 `pindoudou/src/data/palette.js` 与 `assets.js` 导入 `palette_*` / `assets` 表（写一个 `cmd/seed`）
- 会员、Credits、作品的业务接口（表已就绪，按上面的「加一个业务模块」补）
- 支付回调与订单表
- 一句话创作接真实模型（前端目前是本地关键词匹配，`AI_COST_PER_CALL = 8`）
- 接口文档：需要的话接 swaggo 生成 OpenAPI
- 活跃监控的后台页面与前端埋点接入（后端接口已就绪，见 [docs/activity.md](docs/activity.md) §11）
