# 豆玩 DOUWAN 后端架构事实报告（只读侦察）

> 侦察范围：本工作区只读镜像 `.mirror/douwan-api`（Go 后端，与 home `~/Documents/work/dw/douwan-api` 同源，
> HEAD = `5364499`）+ 线上 qq 只读命令。**未修改任何 .mirror 之外的代码，未对线上做任何写操作。**
> 行号引用格式：`路径:行`（路径相对仓库根 `.mirror/douwan-api/`，本报告内统一省略该前缀）。

---

## 0. 一句话总览

Go 1.26 + Gin 1.12 + GORM 1.31 + PostgreSQL 16，单进程单体服务，无外部队列/无 Redis（默认关）。
分层固定为 `model → repository → dto → service → handler → router`，HTTP 状态码管协议层、
body 里 `code == 0` 才是业务成功（`internal/response/errors.go:3-4`）。
**目前没有任何 AI 推理调用代码**，只有「AI Credits 账户 + 权益点 + 埋点功能点」三处占位。

---

## 1. 路由注册方式（`internal/router/router.go`）

### 1.1 结构

| 位置 | 内容 |
| --- | --- |
| `router.go:26-44` | `Deps` 依赖结构体：`Config / DB / Tokens / TokenStore / Storage / StorageErr / Activity` |
| `router.go:48-61` | `New(deps)` 构造 gin 引擎 + 全局中间件链 |
| `router.go:63-73` | `SetTrustedProxies`（默认回环，活跃监控地区统计依赖它） |
| `router.go:77-79` | 活跃采集中间件挂在**最外层** |
| `router.go:81-92` | 健康探针 + 上传目录静态托管 |
| `router.go:94-158` | 逐模块构造 repository / service / handler（**手工 new，无 DI 框架**） |
| `router.go:160-378` | `v1 := engine.Group("/api/v1")` + 全部分组 |
| `router.go:380-383` | `NoRoute` → `ErrNotFound.WithMessage("接口不存在")` |

### 1.2 全局中间件链（`router.go:55-61`）

```go
engine := gin.New()
engine.Use(
	middleware.RequestID(),
	middleware.AccessLog(),
	middleware.Recovery(),
	middleware.CORS(deps.Config.CORS),
)
```

采集中间件在之后追加（`router.go:77-79`），**位置刻意最外层**，靠 `c.Next()` 之后的代码回看请求
（`internal/activity/recorder.go:190-214`）。

### 1.3 现有 `/api/v1` 分组与准入级别

| 行 | 分组 | 准入写法 |
| --- | --- | --- |
| `router.go:163-170` | `v1.Group("/auth")` | **公开**：register / login / refresh / logout |
| `router.go:172-176` | `v1.Group("/users", middleware.Auth(...))` | **需登录**：`GET/PATCH /users/me` |
| `router.go:180-196` | 直接挂 `v1.GET(...)` | **公开**：`/plans`、`/settings/public`、`/assets`、`/assets/categories`、`/assets/:slug` |
| `router.go:199-229` | `authed := v1.Group("", middleware.Auth(...))` | **需登录**：`/card-keys/redeem`（限流）、`/orders*`、`/my/entitlements`、`/events`（限流） |
| `router.go:236` | `v1.GET("/permissions", middleware.OptionalAuth(...))` | **可选登录** |
| `router.go:239-245` | `v1.Group("/admin/auth")` | 后台登录/刷新/登出（login 限流 10/min） |
| `router.go:248-377` | `v1.Group("/admin", middleware.AdminAuth(...))` | **需管理员**，组内再逐条挂 `RequirePermission` |

### 1.4 三层写法的关键代码片段

**公开**（`router.go:189-196`）——注意素材路由用 `libraryHandler != nil` 包裹：

```go
v1.GET("/settings/public", settingHandler.Public)
if libraryHandler != nil {
	v1.GET("/assets", libraryHandler.PublicAssets)
	v1.GET("/assets/categories", libraryHandler.PublicCategories)
	v1.GET("/assets/:slug", libraryHandler.PublicAssetDetail)
}
```

**需登录 + 单接口限流**（`router.go:206-208`、`226-228`）：

```go
authed.POST("/card-keys/redeem",
	middleware.RateLimit(redeemLimit, time.Minute),
	cardHandler.Redeem)
...
authed.POST("/events",
	middleware.RateLimit(reportLimit, time.Minute),
	eventHandler.Report)
```

**需权限**（两种等价写法）——单条挂（`router.go:255-256`）与分组挂（`router.go:259-270`）：

```go
adm.GET("/overview",
	middleware.RequirePermission(model.PermOverviewView), overviewHandler.Load)

activity := adm.Group("/activity",
	middleware.RequirePermission(model.PermActivityView))
{
	activity.GET("/overview", activityHandler.Overview)
	...
}
```

**仅超管**（`router.go:368-376`）：`adm.Group("/admins", middleware.RequireSuper())`。

### 1.5 存储降级的三态约定（`router.go:31-40`、`311-351`）——新增模块要照抄的坑

- `Storage == nil && StorageErr == nil`：测试场景，素材路由**不注册**（404）。
- `StorageErr != nil`：线上配置坏了，**占住路径**返回 500 并写明原因（`storageNotReady`，`router.go:386-396`），
  避免运营误以为「功能没做」。
- 素材相关 handler 为 nil 时，对应分组整体不注册。

---

## 2. 配置体系

### 2.1 读取机制（`internal/config/config.go`）

- 优先级：**环境变量 > 配置文件 > 内置默认值**（`config.go:3-5`）。
- 前缀 `DOUWAN_`，层级用 `_` 连接（`config.go:281-283`）：

```go
v.SetEnvPrefix("DOUWAN")
v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
v.AutomaticEnv()
setDefaults(v)
for _, key := range v.AllKeys() { _ = v.BindEnv(key) }   // config.go:289-291
```

  注意 `config.go:285-291` 的注释：**viper 只对「已知键」生效**，所以每个键都必须在 `setDefaults` 里声明一次，
  否则环境变量会被静默忽略 → 新增 `local_ai.*` 时**必须**在 `setDefaults` 里补默认值。
- 配置树是**每个模块一个 struct + mapstructure tag**，根结构体 `Config`（`config.go:18-29`）：

```go
type Config struct {
	App App `mapstructure:"app"`; Server ...; Database ...; Redis ...; JWT ...;
	Log ...; CORS ...; Admin ...; Storage ...; Activity Activity `mapstructure:"activity"`
}
```

- 加载入口 `Load(path)`（`config.go:279-319`）：`path != ""` 用指定文件；为空则依次试 `./configs/config.yaml`、`./config.yaml`，
  都找不到就只用默认值 + 环境变量（容器化部署友好）。
- 校验 `Validate()`（`config.go:323-381`）：生产弱密钥拒绝启动（`config.go:333-335`）、
  生产必须注入卡密密钥（`config.go:356-358`）、`storage.max_upload_mb` 必须 1~100（`config.go:348-350`）。
- **`Activity` 是最贴近「新增一段配置」的范本**（`config.go:176-206` 定义 + `config.go:264-274` 默认值 +
  `config.go:361-380` 校验），字段覆盖 bool / Duration / int / string + 注释写清降级行为。

### 2.2 三份配置文件的字段风格

| 文件 | 行数 | 特点 |
| --- | --- | --- |
| `configs/config.yaml` | 115 | 开发默认，**每段都有中文注释**，含 `trusted_proxies`、`storage`、`activity` 全量字段 |
| `deploy/config/prod.config.yaml` | 88 | 生产模板，`app.env: prod`、`debug: false`、`server.host: 127.0.0.1`、`database.auto_migrate: false`（`:32`）、`upload_dir: /var/lib/douwan/uploads`（`:63`）、`geo_v4_xdb: /var/lib/douwan/ip2region_v4.xdb`（`:84`）；**密钥一律不写**（`:2`、`:53`） |
| `.env.example` | 72 | 全大写 `DOUWAN_<段>_<键>`，逐行中文注释；`DOUWAN_SERVER_TRUSTED_PROXIES=127.0.0.1,::1` 这种逗号分隔数组（`:63`）；`seed` 用的变量注释掉（`:66-69`） |

关键：`prod.config.yaml` 里 `jwt.secret` / `admin.card_cipher_key` / `database.password` **全部缺席**，
由 systemd `EnvironmentFile=/etc/douwan/api.env` 注入（`deploy/systemd/douwan-api.service:13`）。

### 2.3 新增一段 `local_ai:` 配置最符合现有约定的做法

按 `Activity` 的模子来，改动 5 处（**全是加法，无破坏性**）：

1. `internal/config/config.go:18-29` —— `Config` 加 `LocalAI LocalAI \`mapstructure:"local_ai"\``。
2. 同文件（建议紧邻 `Activity`，即 `:206` 之后）—— 新增 `type LocalAI struct`，字段带 `mapstructure` tag 与中文注释，
   注释里写明**「不可达时降级成什么样」**（照 `Activity.GeoEnabled` 的写法 `config.go:193`）。
3. `config.go:264-274` 区域 —— `setDefaults` 补 `v.SetDefault("local_ai.enabled", false)` 等**每一个键**（对应 §2.1 的坑）。
4. `config.go:361-380` 区域 —— `Validate()` 里 `if c.LocalAI.Enabled { ... }` 只拦「明显不合理」的值（照 activity 的尺度）。
5. `configs/config.yaml`（`activity:` 段之后，`:115` 后）、`deploy/config/prod.config.yaml`（`:88` 后）、`.env.example`（`:59` 后）
   各补一段，风格照抄 activity（中文注释 + 说明缺失时的降级）。

URL / 密钥类字段（如本地推理服务地址、token）**不要**写进 `configs/config.yaml` 与 `prod.config.yaml` 的真值位置，
照 `card_cipher_key` 的做法：yaml 里留空/不写，真值走 `DOUWAN_LOCAL_AI_*`（见 `config.go:252` 与 `prod.config.yaml:53-54` 的注释约定）。

---

## 3. 鉴权与权限点

### 3.1 令牌（`internal/auth/jwt.go`）

- 主体类型常量 `KindUser = "user"` / `KindAdmin = "admin"`（`jwt.go:20-23`）——**用户令牌不能调后台接口**
  （`ParseAccessToken` 显式拒绝 admin 令牌，`jwt.go:108-111`；`ParseAdminAccessToken` 反向校验 `jwt.go:124-126`）。
- `Claims`：`uid` / `knd` / `aid` / `rol` + `RegisteredClaims`（`jwt.go:30-36`）。
- 访问令牌 HS256 无状态，刷新令牌是不透明随机串存 TokenStore（`jwt.go:149-151`）；
  `parse` 用 `jwt.WithIssuer` + `WithValidMethods` 白名单（`jwt.go:133-138`），过期/非法分别映射
  `ErrTokenExpired` / `ErrTokenInvalid`（`jwt.go:139-144`）。

### 3.2 前台中间件（`internal/middleware/auth.go`）

- `Auth(m)`（`auth.go:20-35`）：只验令牌本身，**不查库**（省一次往返，`auth.go:16-19` 有说明）。
- `OptionalAuth(m)`（`auth.go:39-55`）：无令牌或非法令牌都当匿名放行（素材库/权限矩阵用）。
- 上下文键 `CtxUserID = "user_id"`（`auth.go:13`），读取 `CurrentUserID`（`auth.go:58-65`）。

### 3.3 后台中间件（`internal/middleware/admin.go`）

- `AdminAuth`（`admin.go:24-52`）：**每个请求都查库**（`admin.go:21-23` 说明为什么），校验 `IsActive()`，
  写入 `CtxAdmin / CtxAdminID / CtxAdminRole`（`admin.go:47-49`）。
- `RequirePermission(perm)`（`admin.go:58-71`）：

```go
if !admin.Can(perm) {
	response.Fail(c, response.ErrForbidden.WithMessage("当前角色没有该操作权限："+permLabel(perm)))
	return
}
```

- `RequireSuper()`（`admin.go:74-87`）。
- `permLabel` 中文映射表用 `switch` 硬编码（`admin.go:110-152`），**新增权限点必须在这里补一条**，
  否则拒绝提示会退回英文信号串。

### 3.4 权限点清单的唯一出处：`internal/model/admin.go`

- 常量定义 `admin.go:47-68`（20 个，最新一个是 `PermActivityView = "activity.view"`，`admin.go:67`）。
- 角色 → 权限矩阵 `rolePermissions`（`admin.go:72-99`）：`AdminRoleSuper: nil` 表示全权（`admin.go:73`、`Can` 里 `admin.go:110-112`）；
  `AdminRoleSupport`（运营）与 `AdminRoleViewer`（只读）各自显式列出。
- 判定入口 `Can`（`admin.go:102-114`）/ `CanRole`（`admin.go:117-126`）。

### 3.5 `activity.view` 的完整「声明链」——加 `ai.use` 抄这一条

| # | 文件 | 位置 | 动作 |
| --- | --- | --- | --- |
| 1 | `internal/model/admin.go` | `:47-68` | 加常量 `PermAIUse = "ai.use"` |
| 2 | `internal/model/admin.go` | `:72-99` | 给 `AdminRoleSupport`（、`AdminRoleViewer`）矩阵加 `PermAIUse: true`；super 无需改（nil=全权） |
| 3 | `internal/middleware/admin.go` | `:110-152` | `permLabel` 加 `case model.PermAIUse: return "本地 AI 调用"` |
| 4 | `internal/service/admin.go` | `:143-149` | `PermissionList` 的 `perms` 切片**补上** `model.PermAIUse`（⚠ 见下方坑） |
| 5 | `internal/router/router.go` | `:248-377` | 目标路由挂 `middleware.RequirePermission(model.PermAIUse)` |
| 6 | `docs/api.md` | `:822-825` | 权限点清单文档同步 |
| 7 | `docs/admin.md` | `:60-71` | 功能表同步（若进后台页面） |

> ⚠ **已存在的缺陷（本次侦察发现，非本次改动引入）**：`internal/service/admin.go:143-149` 的
> `PermissionList` 白名单里**漏了 `model.PermActivityView`**（对比 `internal/model/admin.go:67` 与
> `internal/middleware/admin.go:110-152` 都有它）。后果：`GET /api/v1/admin/permissions` 的 `current`
> 数组与 `GET /api/v1/admin/auth/me` 的 `permissions` 字段（`internal/service/admin.go:130-135`）
> **不会返回 `activity.view`**，后台前端若按该数组判断按钮可见性，活跃监控页面会显示不出来
> （路由鉴权本身正常，因为走的是 `admin.Can()`）。加 `ai.use` 时应顺手修掉这一行。

### 3.6 另一套「权限」：功能权益（与权限点无关，别混）

`internal/entitlement/entitlement.go` 是**面向 C 端套餐**的功能矩阵（`generate.*` / `export.*` / `assets.pro` …），
18 个点（`entitlement.go:14-33` 常量、`:45-66` `Features()` 带中文名/提示/值类型），
`FreeMatrix`（`:90-109`）、`Merge`（`:115-127`）、`Allow`（`:131-154`）。
**AI 相关键已经存在于这里**（如 `FeatureBatchExport`、`FeatureAssetsPro`），而
`internal/model/activity.go:183-185` 已有埋点功能点 `ai.text / ai.variants / ai.batch`，
`internal/model/user.go:88-92` 的 `CreditTransaction.Reason` 注释也点名了这三个值，
`internal/model/user.go:72-79` 是 `CreditAccount`、`:100` 是 `UsageStat.AICalls`。
→ **本地 AI 接入应该同时考虑：权益点（能不能用）+ Credits 扣费（用几次）+ 埋点（用没用）**，三者代码位点都已存在。

---

## 4. 图片 / 文件存储

### 4.1 实现（`internal/storage/storage.go`）——只有本地磁盘一种

注释明确「接口设计留出了将来换成对象存储的位置」（`storage.go:8-9`），但**没有 Go interface 抽象**，
是具体类型 `*Store`（`storage.go:64-68`），调用方直接依赖它。

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| `New(cfg)` | `:71-82` | 只接受 `driver=local`，`MkdirAll(upload_dir, 0o755)` |
| `Config()` / `SetMaxUploadMB()` | `:85-103` | 运行期改上限（后台系统设置用），范围锁定 1~100 |
| `Root()` / `PublicPrefix()` | `:106-124` | 前缀规范化：补前导 `/`、去尾 `/`，空值回落 `/uploads` |
| **子目录白名单** `subdirs` | `:128-132` | **只有 `assets` / `thumbnails` / `covers`** —— 新业务目录必须在此登记，否则直接 `ErrUploadRejected`（`:142-144`） |
| `SaveUploaded(fh, subdir)` | `:138-235` | 见下 |
| `SaveThumbnail(src, subdir)` | `:241-287` | 生成失败不致命，调用方回落「缩略图 = 原图」（`:239-240`） |
| `Remove(relPath)` | `:291-300` | 拒绝 `..` 与绝对路径，删不掉不报错 |
| `DetectImageType` | `:308-336` | 魔数优先（WEBP 手工判 RIFF/WEBP），**显式挡掉 SVG**（`:331-334`，XSS 理由） |
| `ImageSize` / `ResizeToFit` / `HumanSize` | `:339-421` | 纯标准库，面积平均降采样 |
| `buildStoredName` | `:423-440` | 时间戳 + 8 字节随机 hex + 扩展名，**丢弃原文件名** |

### 4.2 校验与目录结构（`storage.go:138-235`）

校验顺序刻意「从便宜到昂贵」（`:136-137`）：非 nil → 子目录白名单 → `Size > 0` → 大小上限 →
只读前 **512 字节**魔数嗅探（不信扩展名与客户端 Content-Type，`:160-176`）→ 完整读入 → `image.DecodeConfig` 真解码 →
尺寸为正 → 像素上限 **6000 万**（`storage.go:46`）。

目录结构：`<upload_dir>/<subdir>/<YYYY>/<MM>/<时间戳>-<8字节hex>.<ext>`（`:215-220`）。
URL 拼接：`PublicPrefix() + "/" + rel`，`rel` 是 `subdir/2006/01/文件名`（`:225-227`、`:279`）。
落库备查的是 `RelPath` / `StoredName`（`SavedFile`，`:51-62`）。
缩略图统一转 **JPEG q=82**、长边上限 `max_thumb_size`（默认 480，`:264-271`）。

### 4.3 上传接口在哪个 handler

`internal/handler/library.go:73-99` `LibraryHandler.Upload` → `service.LibraryService.Upload`（`internal/service/library.go`），
路由 `router.go:317`：`POST /api/v1/admin/assets/upload`，`RequirePermission(model.PermAssetManage)`。

表单字段解析全在 `library.go:291-356`：字段名同时接受 `files` / `file` / `images`（`:299`），
**单次最多 50 张**（`:307-308`），标签同时接受 JSON 数组与中英文逗号分隔（`:328-355`）。
返回 `response.Created`（`library.go:98`）。

### 4.4 `/uploads/` 静态服务

- **后端直托管**（`router.go:87-92`）：`engine.Static(deps.Storage.PublicPrefix(), deps.Storage.Root())`；
  Storage 为 nil 时回落 `engine.Static("/uploads", "./data/uploads")`。
- **nginx 也直读同一目录**（`deploy/nginx/dw.sharyuke.com.conf:44-51`）：

```nginx
location /uploads/ {
    alias /var/lib/douwan/uploads/;
    expires 7d;
    add_header Cache-Control "public, max-age=604800";
    location ~* \.(php|jsp|asp|sh|cgi)$ { deny all; }
    try_files $uri =404;
}
```

- `client_max_body_size 20m`（同文件 `:14`），`/api/` 反代 `proxy_read_timeout 60s`（`:25-35`）。
  ⚠ **本地 AI 若走同步推理，超过 60s 会被 nginx 掐断**；长任务需要异步化或调这个超时。
- ⚠ 路径重叠：前端构建产物也有 `/assets/`（`:54-58`，`try_files $uri =404`），
  与上传子目录 `uploads/assets/` 不冲突（前者在 `/var/www`，后者在 `/uploads/`），但**发布前端时
  `rm -rf /var/www/dw.sharyuke.com/*`**（AGENTS.md 部署脚本）不影响上传目录。

### 4.5 线上实测（qq，只读）

```
$ find /var/lib/douwan/uploads -type f | wc -l
0
$ ls -la /var/lib/douwan/uploads
drwxr-xr-x 2 douwan douwan 4096 Oct 15 17:47 .
$ ls -la /var/lib/douwan/
-rw-r--r-- 1 root root 11122642 Oct 15 17:40 ip2region_v4.xdb
drwxr-xr-x 2 douwan douwan     4096 Oct 15 17:47 uploads
```

→ 上传目录**完全空**（素材库尚未开始使用）；`ip2region_v4.xdb` 11MB 已就位。
systemd 侧：`ReadWritePaths=-/var/lib/douwan/uploads` + `ExecStartPre=+install -d`（`deploy/systemd/douwan-api.service:23,35`）。

---

## 5. 现有图片相关业务 / 任务队列现状

### 5.1 素材库存在**两套模型**（`internal/model/library.go:27-37` 有明确解释）

| 模型 | 定义 | 用途 |
| --- | --- | --- |
| `Asset` / `AssetFavorite` / `PaletteBrand` / `PaletteColor` | `internal/model/asset.go`（`model.AllModels()` `:18-21`） | 前端 `src/data/assets.js` 那批**内置矢量素材**（`svg / cols / tier`），待 `cmd/seed` 导入，**表还是空的** |
| `LibraryAsset` / `LibraryCategory` | `internal/model/library.go:38-82` / `:102-112` | 管理员**上传的真实位图素材**（原图 + 缩略图 + 分类 + 标签 + 版权备注 + tier），本次上传功能的落点 |

`LibraryAsset` 关键字段：`Slug`（唯一索引 `:41`）、`ImageURL` / `ThumbnailURL`（`:45-46`）、
`ImageWidth/Height/FileSize/MimeType/StoredName`（`:48-52`）、`Tags []string` 用 `serializer:json;type:jsonb`（`:57`）、
`Status`（draft/published/archived，`:65`，常量 `:15-19`）、`Tier`（free/pro，`:73`）、归档字段（`:77-81`）。
`OperationLog`（`:129-148`）明确「不记录明文密码、API Key、支付密钥、完整卡密」（`:127-128`）。
`Setting`（`:168-182`）是键值表，带 `Public` / `Secret` 两个布尔开关，**分组常量里已经有 `SettingGroupAI = "ai"`**（`:11`）。

素材相关 handler：`internal/handler/library.go`（上传 `:73`、列表 `:28`、详情 `:51`、改状态 `:120`、
批量排序 `:138`、删除 `:152`、标签 `:165`、分类 CRUD `:177-245`、前台三接口 `:250-287`）。

### 5.2 作品 / 项目模型（`internal/model/project.go`）

- `Project`（`:9-25`）：`UserID` 索引、`BoardCols/Rows`、`BrandID`、`ActiveVariantKey`、
  `Thumbnail` 是 **text**（注释写「data URL 或对象存储地址」，`:19-20`）、`BuildProgress jsonb`（`:22`）。
- `ProjectVariant`（`:28-40`）：`Key`（detail/buildable/artistic）、`Stats jsonb`、`Pattern jsonb`（完整图纸）。
  拆表理由是「单个方案 pattern 很大（116×116 = 13456 格）」（`:6-8`）。
- ⚠ **`Project` 目前没有任何 handler / service / 路由**——只有模型与迁移，前台作品仍在 localStorage。
  同理 `PaletteBrand` / `PaletteColor` / `InventoryItem` 也只有模型。

### 5.3 埋点 `POST /api/v1/events`

- 路由：`router.go:226-228`，需登录 + `RateLimit(reportLimit=120/min)`。
- Handler：`internal/handler/activity.go:136-152`（`EventHandler.Report`），未登录直接 `ErrUnauthorized`（`:142-145`）。
- 白名单唯一出处：`internal/model/activity.go:199-226` 的 `activityFeatureCatalog`，
  `Client: true` 才允许客户端上报（`:216-225`），**`ai.text` / `ai.variants` / `ai.batch` 已在其中**。
- 非法功能点返回 `CodeEventFeatureUnknown = 40027`（`internal/response/errors.go:65`、
  `ErrEventFeatureUnknown` `:146`）。
- 落库口径：`user_daily_activities` + `user_feature_daily` 两张日汇总表（`internal/model/activity.go`、
  `internal/repository/activity.go`），来源区分 `ActivitySourceClient`（见 `internal/handler/postgres_test.go:403`）。
- 详见 `docs/activity.md`。

### 5.4 「任务 / 队列 / job」现状：**不存在**

grep `job|queue|task|worker|async|scheduled`（大小写不敏感，全仓 `*.go`）命中 34 处，**全部是 `defer`、
`sync.WaitGroup`、`go func`、`ticker` 这类本地协程原语，没有任何任务表、任务状态机或消息队列**。
现有后台协程只有两处：

1. `internal/activity/recorder.go:150-163` `Start` → `flushLoop` + `cleanupLoop`（内存缓冲批量落库，`:221-229` `Touch`；
   `Stop` 时用 30s 独立 ctx 做最后一次落库，`:170-188`）。
2. `internal/auth/token_store.go` 的清理协程（`:91` `ticker.Stop()`）。

唯一的「状态机」是**订单发卡**（同步执行，非队列）：`Order.FulfillmentStatus`
（pending/issued/failed/canceled，`internal/model/order.go:18-21`）、
`repository/order.go:159-208` 的 `ClaimFulfillment`（条件更新抢锁）/`CompleteFulfillment`/`MarkFulfillmentFailed`，
服务层 `internal/service/order.go:366-463` 用事务 + 条件更新保证幂等，失败改回 `failed` 等人工重试（`:190-194`）。
→ **要做「异步本地 AI 任务」，这是最接近的可借鉴范式（DB 表 + 状态字段 + 条件更新抢锁 + 人工重试），
  但需要从零新建表、handler、轮询/后台 worker。**

---

## 6. 数据模型约定与迁移

### 6.1 公共基类（`internal/model/base.go:13-19`）

```go
type Base struct {
	ID        uint64         `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
```

- 主键是 **`uint64` 自增**（不是 UUID / 雪花）。
- 时间戳由 GORM 自动维护；软删除用 `gorm.DeletedAt`，**JSON 不输出**（`json:"-"`）。
- 所有业务表**内嵌 `Base`**（如 `model/admin.go:26`、`model/library.go:39`、`model/project.go:10`）。
- 金额 / 计数用 `int` / `int64`，jsonb 用 `json.RawMessage`（`project.go:22,37,39`）或 `serializer:json`（`library.go:57`）。

### 6.2 `AllModels()` 与迁移

- `internal/model/migrate.go:5-36`：`AllModels()` 返回**全部**参与迁移的实体（当前 24 个），
  新增实体必须追加（注释 `:4`）。分四组注释：账号与权益 / 作品与库存 / 素材与色板 / 后台管理 + 活跃监控。
- `internal/database/migrate.go:14-22` `AutoMigrate(db)`：`db.AutoMigrate(model.AllModels()...)` + `fixLegacyIndexes`。
  注释明确：**「它不会删除列、也不会改列类型」**（`:12-13`），复杂变更要写显式 SQL。
- `fixLegacyIndexes`（`:33-75`）是历史补丁的范本：先探测是否需要修（`emptyCount == 0 && !hasLegacyFullIndex` 就跳过，`:43-45`），
  再删索引 → `ALTER COLUMN ... DROP NOT NULL`（SQLite 不支持则 `slog.Debug` 忽略，`:59-62`）→ 清空串 → 重新 AutoMigrate。
- 触发点：启动时（`internal/server/server.go:41-47`，受 `database.auto_migrate` 控制）与
  `cmd/migrate/main.go` / `cmd/seed/main.go:76-78`。
- 生产 `auto_migrate: false`（`deploy/config/prod.config.yaml:32`），发布流程里**显式跑 `bin/migrate`**。
- 测试库也走同一份 `AllModels`（`internal/testsupport/db.go:38`），保证结构不漂移。

---

## 7. 响应体与错误码

### 7.1 统一响应体（`internal/response/response.go`）

```go
type Body struct {
	Code      Code   `json:"code"`
	Message   string `json:"message"`
	Data      any    `json:"data,omitempty"`
	RequestID string `json:"request_id,omitempty"`
}
```

- `Success` → HTTP 200 + `code 0`（`:26-28`）；`Created` → HTTP 201 + `code 0`（`:31-33`）。
- `Fail(c, err)`（`:37-54`）：`From(err)` 归一 → **带 `Err` 内部原因才打 `slog.ErrorContext`**（含 code/message/path/err/request_id）
  → 写 `e.HTTPStatus` + 对外 `Message` → `c.Abort()`。
- `RequestID` 读 `CtxRequestID = "request_id"`（`:14`），也回写响应头 `X-Request-ID`（`:12`）。

### 7.2 业务码分段（`internal/response/errors.go:16-66`）

| 段 | 含义 | 已用 |
| --- | --- | --- |
| `0` | 成功 | — |
| `10xxx` | 通用 | 10001 参数错、10002 缺参、**10404** 不存在、**10429** 限流、**10500** 内部错误 |
| `20xxx` | 认证授权 | 20001 未登录、20002 过期、20003 无效、20004 密码错、20005 账号禁用、**20403** 无权限 |
| `30xxx` | 用户 | 30001 不存在、30002 已存在 |
| `40xxx` | 后台管理（**混装业务错误**） | 40001 … **40027** `CodeEventFeatureUnknown` |

**新增码从 `40028` 开始**（`errors.go:65` 是当前最大值）。约定：
- 每个码配一个 `ErrXxx` 包级变量（`errors.go:120-146`），带 `HTTPStatus` 与中文 `Message`；
- 想改文案用 `.WithMessage()`（返回副本，不污染全局，`:88-92`）；想带内部原因用 `.WithCause()`（`:95-99`）；
- `From()`（`:151-159`）把**非业务错误一律折叠成 `ErrInternal`（10500）**，避免泄露 DB 报错。
- 分段并不严格（后台业务错误全挤 40xxx），**新码跟着末尾追加即可**，不必另开段。

### 7.3 参数绑定（`internal/response/bind.go`）

- `BindJSON(c, obj)`（`:63-68`）→ `c.ShouldBindJSON` 失败包成 `ErrInvalidParam.WithMessage(bindMessage(err))`。
- `bindMessage`（`:70-115`）用 `validator.ValidationErrors` 把**第一个**错误译成中文，
  支持 required / min / max / len / email / url / alphanum / numeric / number / gt / gte / lt / lte / oneof / required_if / required_without_all。
- `fieldLabels`（`:13-59`）是结构体字段名 → 中文标签的映射表，**新增 DTO 字段要在这里补**，否则报错文案会露出英文字段名。
- handler 里的惯用包装是 `internal/handler/common.go:27-33` 的 `bind(c, &req) bool`。

---

## 8. 日志与限流

### 8.1 日志（`internal/logger/logger.go`）

- 基于标准库 **`log/slog`**，构造器 `New(cfg config.Log)`（`:14-24`）：`format=json` → `slog.NewJSONHandler(os.Stdout)`，
  否则 `slog.NewTextHandler(os.Stdout)`；`level` 支持 debug/warn/error/默认 info（`:29-39`）。
- `SetDefault(l)`（`:27`）让全进程用 `slog.Info` 等；`cmd/server` 启动时调用。
- **是结构化的**（key-value attrs），但不是「字段固定」的：各调用点自己给字段。
- **没有自动脱敏机制**——脱敏靠调用方自觉：卡密走 `admin.MaskCode()`（`internal/admin/cardcode.go:118-132`），
  设置项靠 `Setting.Secret` 标志（`internal/model/library.go:179`），`OperationLog` 注释声明不记密钥（`internal/model/library.go:127-128`）。
- 访问日志（`internal/middleware/access_log.go:14-47`）字段：
  `method / path / status / latency_ms / ip / request_id`（`:23-30`），有 query 才加 `query`（`:31-33`），
  有 `c.Errors` 才加 `errors`（`:34-36`）；**5xx → Error、4xx → Warn、其余 Info**（`:39-46`）。
  ⚠ `query` 原样记录 → 若本地 AI 的 URL 把 token 放 query 会进日志，需自行避免。
- 上传解码失败会打一条带 `head_hex` 的 warn 便于排查（`internal/storage/storage.go:195-201`）。

### 8.2 限流（`internal/middleware/ratelimit.go`）

- `RateLimit(limit int, window time.Duration)`（`:20-42`）：**进程内固定窗口**，key = `ClientIP(c)`，
  超限返回 `ErrTooManyRequests`（业务码 10429）。每个实例各计数，多实例部署阈值等于 `limit × 实例数`（`:16-19`）。
- 内部 `fixedWindowLimiter`（`:49-70`）+ `janitor` 定期清过期 key（`:73-90`，最小间隔 1 分钟）。
- `ClientIP`（`:98-116`）优先 `X-Forwarded-For` 第一跳 → `X-Real-IP` → `RemoteAddr`。
- **现有 3 处用法**：`router.go:206-208` 卡密兑换（默认 10/min，来自 `admin.card_redeem_per_minute`）、
  `router.go:226-228` 埋点上报（默认 120/min，来自 `activity.event_report_per_minute`）、
  `router.go:242` 后台登录（硬编码 10/min）。
- 注意：gin 引擎层的 `SetTrustedProxies`（`router.go:71`）也影响 `c.ClientIP()`，
  而中间件里的 `ClientIP` 是自己读 header 的，两套并存。

---

## 9. 测试约定

- `internal/testsupport/db.go:20-43` `NewDB(t)`：**纯 Go SQLite 内存库**（`github.com/glebarez/sqlite`），
  DSN `file:<t.Name()>?mode=memory&cache=shared`，**连接数锁成 1**（`:36`，内存库不跨连接共享），
  跑 `database.AutoMigrate`（`:38`），`t.Cleanup` 关库。
- `internal/testsupport/auth.go`：`TestJWTConfig()`（`:12-19`）、`NewTokens()`（`:22`）、
  `NewTokenStore(t)`（`:25-30`，注册 Cleanup 关清理协程）。
- **构造 router + 令牌的标准写法**（`internal/handler/user_test.go:26-42`）：

```go
db := testsupport.NewDB(t)
tokens := testsupport.NewTokens()
engine := router.New(router.Deps{
	Config: &config.Config{App: config.App{Env: "test"}, Server: config.Server{Port: 8080}, CORS: ...},
	DB: db, Tokens: tokens, TokenStore: testsupport.NewTokenStore(t),
})
```

  发请求用 `httptest.NewRequest` + `engine.ServeHTTP`，认证头 `Authorization: Bearer <token>`（`user_test.go:44-68`）；
  响应统一用 `envelope{Code, Message, Data, RequestID}` 解（`user_test.go:71-85`）。

- **后台环境 `adminEnv`**（`internal/handler/admin_test.go:39-96`）：真路由 + 内存库 + 临时上传目录
  （`storage.New(config.Storage{UploadDir: t.TempDir(), ...})`，`:68-74`），先建超管（`:60-66`），
  再 `env.login()` 拿后台令牌（`:99-118`）。上传测试用 multipart 构造，图片用 `makePNG(t)` 现造（`admin_test.go:234`）。
- **并发场景单独造环境**（`internal/handler/concurrency_test.go:33-89`）：因为 `testsupport.NewDB` 把连接数限成 1 会串行化，
  这里自己开 `cache=shared&_pragma=busy_timeout(10000)` 并把连接数放到 8（`:37,48`）。
- **PostgreSQL 真库冒烟**（`internal/handler/postgres_test.go`）：靠环境变量 `DOUWAN_TEST_POSTGRES_DSN` 开关，
  没设就 `t.Skip`（`:43-46`）；跑之前 `dropAllTables`（`:472-480`）；测试内注释点名了「只在真 PG 暴露」的坑
  （jsonb 写法、部分唯一索引、`ON CONFLICT DO UPDATE` 列名歧义，`:31-35,349-352`）。覆盖 12 条链路（`:108-466`）。
- 命令：`make test` / `go test ./...`（`Makefile:33-35`）、`make test-race`（`:37-39`）。
  ⚠ **本机无 Go，测试只能在 home 上跑**。

---

## 10. 提交 / 构建

### 10.1 `Makefile`（83 行，`.DEFAULT_GOAL := help`）

| 目标 | 行 | 作用 |
| --- | --- | --- |
| `help` | `:8-10` | `grep -E '^[a-zA-Z_-]+:.*?## '` 自动生成帮助 |
| `run` | `:12-14` | `go run ./cmd/server`（读 `configs/config.yaml`） |
| **`build`** | `:16-21` | 产出 `bin/server`、`bin/migrate`、**`bin/seed`** 三个二进制（`-trimpath -ldflags="-s -w"`） |
| `seed` / `seed-admin` | `:23-31` | `go run ./cmd/seed -config ...`；`seed-admin` 要求 `DOUWAN_SEED_ADMIN_PASSWORD` 且**密码不许上命令行** |
| `test` / `test-race` / `cover` | `:33-44` | 测试 / 竞态 / 覆盖率 |
| `fmt` / `vet` / `lint` / `tidy` | `:46-59` | 格式与静态检查 |
| `migrate` | `:61-63` | `go run ./cmd/migrate` |
| `up` / `down` / `docker-up` / `docker-logs` / `clean` | `:65-83` | docker compose 与清理 |

注意：**`build` 不含交叉编译**。发布用的交叉编译命令写在工作区 `AGENTS.md`/`DEPLOY.md` 里
（`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ... ./cmd/server` 与 `./cmd/migrate`）。
`seed` 二进制已存在于线上（`/opt/douwan-api/bin/seed`），但**发布流程只推 server + migrate**。

### 10.2 `cmd/seed/main.go`（189 行）

作用（文件头注释 `:1-24`）：初始化后台运行所需的**最小数据**，全部幂等，可放进每次发布脚本：

1. 系统设置默认键 —— `settingsService.EnsureDefaults(ctx)`（`:85-90`）；
2. 占位草稿套餐 —— `planService.SeedDrafts(...)`（`:93-103`，`-drafts` 默认 true）；
3. **首个管理员** —— 仅当给了 `-admin` 或 `DOUWAN_SEED_ADMIN_USERNAME` 且 `DOUWAN_SEED_ADMIN_PASSWORD` 非空
   （`:106-131`），密码强制 **≥10 位**（`:122-124`），角色校验用 `model.ValidAdminRole`（`:132-134`），
   写一条 `OperationLog` 留痕（`:182-187`）。

关键设计：`ensureAdmin`（`:151-188`）**已存在就跳过、绝不改密码**，注释解释「否则这就是个拿到服务器就能改后台密码的后门」（`:146-150`）。
另外它先跑 `database.AutoMigrate`（`:76-78`），所以 seed 也可用于建表。

### 10.3 线上（qq）实测

```
$ systemctl status douwan-api --no-pager
● douwan-api.service - 豆玩 DOUWAN API (douwan-api)
     Loaded: loaded (/etc/systemd/system/douwan-api.service; enabled)
     Active: active (running) since Thu 2026-10-15 17:57:04 CST; 19min ago
   Main PID: 78762 (server)
      Tasks: 8 (limit: 1857)
     Memory: 17.8M (peak: 30.1M)
        CPU: 372ms
             └─78762 /opt/douwan-api/bin/server -config /etc/douwan/config.yaml
```

- `ExecStartPre=/usr/bin/install -d -m 755 -o douwan -g douwan /var/lib/douwan/uploads (status=0/SUCCESS)`。
- 日志里能看到正常业务：`POST /api/v1/events → 200`、`POST /api/v1/admin/auth/login → 200`、
  8 个 `/api/v1/admin/activity/*` 全 200、`GET /healthz → 200`（ip=127.0.0.1）。
- `$ ls -la /opt/douwan-api/bin/` → `migrate`(14MB) / `seed`(22MB) / `server`(37MB) + `server.bak-20261015-174024`，全部 root:root 755，`douwan` 用户可读。
- `$ ls -la /etc/douwan/` → `api.env`（**600 root**）、`config.yaml`（644）、`config.yaml.bak-*`。
- `$ cut -d= -f1 /etc/douwan/api.env`（**只输出键名，值未读取**）：

```
DOUWAN_DATABASE_PASSWORD
DOUWAN_JWT_SECRET
DOUWAN_ADMIN_CARD_CIPHER_KEY
```

- **Go 版本：qq 上没有 Go 工具链**（`go: command not found`；`which go` 空）。
  开发机 home 上是 **`go version go1.26.0 linux/amd64`**（`go.mod:3` 要求 `go 1.26.0`）。
  → 任何改动都必须**在 home 编译后 scp 到 qq**，qq 上无法就地构建。
- 磁盘：`/dev/vda3 40G 3.4G used 34G avail 9% /`（`/var/lib/douwan` 同分区，充裕）。
- `/etc/douwan/config.yaml` 与仓库 `deploy/config/prod.config.yaml` **内容一致（88 行）**，
  无密钥字面量；只多出一个 `.bak-20261015-174024` 备份。
- nginx 现状：`nginx -T` 里 `/uploads/` 段与仓库 conf 完全一致。

---

## 11. 对「接入本地 AI 服务」最相关的 5 条结论

1. **鉴权与准入的落点是现成的，照 `activity.view` 抄 4 个文件即可**：
   `internal/model/admin.go:47-68`（加常量）→ `:72-99`（角色矩阵）→ `internal/middleware/admin.go:110-152`（中文标签）
   → `internal/service/admin.go:143-149`（`PermissionList` 白名单）→ `internal/router/router.go:248-377` 挂
   `middleware.RequirePermission(...)`。⚠ 顺手修掉 `PermissionList` 漏了 `PermActivityView` 的既有缺陷。
   **不要**把「能不能调本地 AI」只做成前端按钮显隐——`docs/api.md:365` 明确「前端隐藏按钮不构成权限」。

2. **配置与密钥的约定已定型，新段配置必须走 viper 默认值 + `DOUWAN_` 前缀**：
   `internal/config/config.go:18-29`（结构体）、`:210-275`（**每个键都要在 `setDefaults` 声明**，否则 env 被静默忽略，
   见 `:285-291` 注释）、`:323-381`（Validate）。三份 yaml/env 同步：`configs/config.yaml`、
   `deploy/config/prod.config.yaml`、`.env.example`。**推理服务地址/密钥之类不要写进仓库 yaml**，
   照 `admin.card_cipher_key`（`prod.config.yaml:53-54`）走 `/etc/douwan/api.env`（systemd `EnvironmentFile`，
   `deploy/systemd/douwan-api.service:13`）。`Activity` 段（`config.go:176-206`）是最好的仿写模板。

3. **没有任何任务/队列基础设施，长耗时推理要么同步 + 调超时，要么新建任务表**：
   全仓 grep 无 job/queue/task/worker —— 现有异步只有两个常驻 goroutine（活跃采集
   `internal/activity/recorder.go:150-188`、令牌清理）。最可借鉴的「状态机 + 幂等」范式是订单发卡
   （`internal/model/order.go:18-21` 状态、`internal/repository/order.go:159-208` 条件更新抢锁、
   `internal/service/order.go:366-463` 事务）。同时注意 **nginx `proxy_read_timeout 60s`**
   （`deploy/nginx/dw.sharyuke.com.conf:34`）会掐断同步慢请求；上传体积上限 `client_max_body_size 20m`（`:14`）。

4. **图片进出管道的复用点与两处硬约束**：上传走 `internal/handler/library.go:73-99` →
   `storage.Store.SaveUploaded`（`internal/storage/storage.go:138-235`），目录结构
   `<upload_dir>/<subdir>/YYYY/MM/时间戳-hex.ext`，URL = `public_prefix + "/" + rel`（`:225-227`），
   缩略图 `SaveThumbnail`（`:241-287`）。**硬约束 1**：`subdirs` 白名单只有 `assets/thumbnails/covers`
   （`storage.go:128-132`），存 AI 产物必须先在白名单登记；**硬约束 2**：像素上限 6000 万、类型白名单
   `image/jpeg|png|webp|gif`、**显式拒绝 SVG**（`storage.go:46,174-176,331-334`）。
   nginx 已直读 `/var/lib/douwan/uploads/`（`nginx conf:44-51`），线上该目录**当前为空**
   （`find ... | wc -l` = 0），`df` 剩余 34G —— 磁盘适合放模型/产物，但**不要放系统盘外的临时目录之外**
   （systemd 只 `ReadWritePaths=-/var/lib/douwan/uploads`，其余只读，`douwan-api.service:31-35`）。

5. **AI 的业务闭环已经预埋了三块，接入时应一次打通**：
   （a）**权益**：`internal/entitlement/entitlement.go:14-33` 的功能键 + `Features()`（`:45-66`）+ `FreeMatrix`（`:90-109`）；
   （b）**Credits 计费**：`internal/model/user.go:72-92`（`CreditAccount` / `CreditTransaction.Reason`
   注释已点名 `ai.text / ai.variants / ai.batch`）+ `UsageStat.AICalls`（`:100`）；
   （c）**埋点**：`internal/model/activity.go:183-185` 的 `ai.text / ai.variants / ai.batch`
   已在客户端上报白名单（`:216-225`，`Client: true`），经 `POST /api/v1/events`（`router.go:226-228`，
   限流 120/min）落入 `user_feature_daily`。
   另外 `internal/model/library.go:11` 的 `SettingGroupAI = "ai"` 与 `internal/service/setting.go:35,85-90`
   的「AI 成本告警」是**已预留但无数据**的设置项与分组，可直接作为「本地 AI 用量/成本」配置的挂载点。

---

### 附：本次侦察的证据边界

- 代码事实全部来自 `.mirror/douwan-api`（只读镜像，HEAD `5364499`）；行号与镜像内容一一对应。
- 线上事实来自 qq 上的只读命令：`systemctl status`、`ls -la`、`find | wc -l`、`df -h`、
  `nginx -T | grep`、`cut -d= -f1`。**未读取任何密钥值，未执行任何写操作或 restart。**
- 未验证项（镜像/权限所限）：home 上的实际 git 工作区状态（只读了 `git log`）、
  PostgreSQL 表实际行数、前端 pindoudou 侧与 AI 相关的实现（本次任务范围外）。
