# 豆玩 SEO 基础设施

> 上线日期：2026-10-25　站点：<https://dw.sharyuke.com>
> 代码：`pindoudou` 提交 `08b45bf` + `8335988`；`douwan-api` 提交 `cb67ac0` + `2765403`（分支 `feat/seo-platform`，已并入 `master`）
>
> **V3.0（搜索词优化与关键词管理）见 [seo-v3.md](seo-v3.md)。** 本文是 V2.0 的技术 SEO 交付记录。
>
> **本文档不声称任何页面已被收录。** 百度、Google、Bing 的收录状态只能在对应站长平台里看到。
> 豆玩这边能证明的只有一件事：页面可被抓取、Sitemap 正确、推送请求按协议发出且返回成功。

---

## 1. 实际完成的功能

### 1.1 技术 SEO（路由与可抓取性）

| 问题 | 原状 | 现在 |
| --- | --- | --- |
| 路由 | vue-router hash 模式，爬虫看到的全是同一个 URL | 改成 history 模式（`createWebHistory`），URL 是真实路径 |
| 页面内容 | 纯 CSR，初始 HTML 里只有空 `<div id="app">` | 后端把渲染好的「SEO 壳」注入 `index.html` 的 `<!--seo-head-->` / `<!--seo-body-->` 标记位 |
| 旧链接 | `#/xxx` | 前端 shim 接管并 301 到对应新路径；OAuth 回调的 token 仍留在 fragment 里不外泄 |
| 老地址 | `/library` 直接 404 | nginx / 后端 301 → `/materials/` |
| Canonical | 无 | 每个公开页都有唯一 `<link rel="canonical">` |
| robots.txt | 无 | 后端动态生成（`text/plain`），声明 Sitemap 与三个爬虫的放行规则 |
| sitemap.xml | 无 | 后端动态生成，含 91 个 URL，按内容实际更新时间写 `lastmod` |
| noindex | 无 | 应用内路由（`/editor` `/projects` `/admin` …）自动带 `noindex`，且不进 Sitemap |

### 1.2 素材库独立详情页

- 每个已发布素材有独立可索引页：`/materials/{slug}/`
- 每个分类有独立页：`/materials/category/{slug}/`
- 内链链路由真实 `<a href>` 构成：首页 → 素材中心 → 素材分类 → 素材详情，详情页底部另有相关素材推荐
- 结构化数据按页面类型给出：`WebSite`、`Organization`、`SoftwareApplication`、`BreadcrumbList`、`CollectionPage`、`ItemList`、`ImageObject`
  - **没有**编造用户评分、下载量、评价

### 1.3 自动推送系统

```
管理员发布素材 / 教程
        ↓
检查是否公开、是否可索引（noindex 的不入队）
        ↓
生成或更新独立页面
        ↓
内容指纹（hash）比对：没变就跳过，不重复推送
        ↓
写入推送队列 seo_push_tasks
        ↓
   ┌────┼────┐
 百度  IndexNow  Google
 API推送  IndexNow   Sitemap 提交
   ↓
记录每个平台的返回结果（成功 / 失败 / 待推送 / 跳过 + 原因）
        ↓
失败重试（最多 3 次）+ 定时巡检 + 后台监控
```

| 引擎 | 实现方式 | 状态 |
| --- | --- | --- |
| 百度 | 普通收录 API `POST https://data.zz.baidu.com/urls?site=&token=`，body `{"urls":[...]}` | 代码就绪，**等 Token** |
| Bing | IndexNow `POST https://api.indexnow.org/indexnow`，body `{host,key,keyLocation,urlList}` | 代码就绪，**等 Key** |
| Google | Sitemaps API `PUT https://www.googleapis.com/webmasters/v3/sites/{site}/sitemaps/{feedpath}`，手写 RS256 服务账号 JWT（不引新依赖） | 代码就绪，**等服务账号** |
| Google 即时收录 | **未使用**。Google 不支持普通网页的通用即时收录 API，普通网页靠 Sitemap + 内链 + 自然抓取发现 | — |

### 1.4 SEO 管理后台

后台新增「SEO 管理」页（`#/admin/seo`，权限点 `seo.view` / `seo.manage`）：

- 数据概览：可索引页面数、Sitemap 状态、robots 状态、百度/Bing 推送结果（成功 / 失败 / 待推送 / 跳过）、Google 配置状态、最近任务记录
- 推送历史查询、手动补推指定页面、批量补推历史页面、查看失败原因
- 素材与分类的 SEO 标题 / 描述可改（也可设 noindex）
- 「强制补推」开关：忽略「内容没变就跳过」，重新推一遍
- 页面数据严格区分：**URL 已推送 ≠ 已抓取 ≠ 已收录 ≠ 有排名**。没接官方数据接口时，不显示任何「收录数」。

---

## 2. 修改的代码文件

### 2.1 前端 `pindoudou`（`b22b897..8335988`，45 个文件）

**新增**

| 文件 | 作用 |
| --- | --- |
| `src/data/seo.js` | SEO 文案单一事实来源：站点信息、首页/素材中心/教程页文案、工具页生成规则、应用内路由清单 |
| `src/lib/seo.js` | 运行时注入 canonical / OG / Twitter / JSON-LD |
| `src/views/admin/AdminSeoView.vue` | 后台「SEO 管理」页 |
| `scripts/build-seo-pages.mjs` | 构建时把 `src/data/seo.js` 编译成 `dist/seo/pages.json` |
| `public/og-cover.png` | OG 分享封面 |

**修改（要点）**

| 文件 | 改动 |
| --- | --- |
| `src/router/index.js` | hash → history；`watchLegacyHash` / `restoreFragment` 兼容老链接与 OAuth 回调 |
| `vite.config.js` | `base: './'` → `'/'` |
| `index.html` | 加 `<!--seo-head-->` / `<!--seo-body-->` 标记位、默认 title/description、`baidu-site-verification` meta |
| `src/views/HomeView.vue` | 首页 H1 改为 `免费拼豆图纸生成器`，与需求一致 |
| `src/views/MaterialsView.vue` / `LibraryView.vue` / `AssetDetailView.vue` | 素材路径迁移到 `/materials/`，作品材料清单挪到 `/project-materials/:projectId?` |
| `src/components/admin/adminNav.js` | 后台导航加「SEO 管理」入口 |
| `src/lib/adminApi.js` / `src/composables/useAdminAuth.js` | `seoApi` 与 SEO 权限点 |
| `scripts/audit*.{cjs,js}`（9 个） | 自检地址从 `#/x` 改成真实路径 `/x`；产物落到仓库内 `.tmp/`（本机系统临时目录不可写） |

### 2.2 后端 `douwan-api`（`943fff1..2765403`，25 个文件）

**新增**

| 文件 | 作用 |
| --- | --- |
| `internal/seo/render.go` | SEO 壳渲染（head / body / JSON-LD / 面包屑 / 内链） |
| `internal/seo/content.go` | `pages.json` 读取与缓存（按 mtime 重读） |
| `internal/seo/push.go` | 三个推送器：百度普通收录、IndexNow、Google Sitemaps |
| `internal/model/seo.go` | `seo_push_tasks` 表模型与状态常量 |
| `internal/repository/seo.go` | 队列仓储：入队、去重、到期取件、重试 |
| `internal/service/seo.go` | Sitemap 生成、推送执行、内容变更触发入队 |
| `internal/service/seo_admin.go` | 后台查询与手动补推 |
| `internal/service/seo_scheduler.go` | 定时巡检（默认 24h） |
| `internal/handler/seo.go` | `/api/v1/admin/seo/*` 接口 |
| `internal/seo/{render,content,push}_test.go` | 单测（含缓存重读回归测试） |

**修改**：`internal/config/config.go`（SEO 配置段）、`internal/dto/library.go`、`internal/model/admin.go`（两个新权限点）、`internal/model/library.go`、`internal/model/migrate.go`、`internal/repository/library.go`、`internal/repository/repository.go`、`internal/router/router.go`、`internal/server/server.go`、`internal/service/library.go`（素材变更时触发 SEO 更新）

---

## 3. 数据库变更

| 变更 | 说明 |
| --- | --- |
| 新表 `seo_push_tasks` | 推送队列：URL、引擎、动作（submit/update/delete）、触发方式、内容指纹、状态、重试次数、引擎返回原文 |
| `library_assets` 加列 | `seo_title`、`seo_description`、`seo_no_index` |
| `library_categories` 加列 | 同上 |
| 新权限点 | `seo.view`、`seo.manage`（同时写进 `model.rolePermissions` 角色矩阵与 `model.permissionOrder` 唯一清单） |

迁移由 `bin/migrate` 执行，随发布流程走。已上线库当前的填充情况：**73 个已发布素材、9 个分类的 SEO 标题与描述全部有值**。

回滚准备：数据库备份 `/var/backups/douwan/db-20261025-133709.*`（发布前）。

---

## 4. SEO 页面配置清单

### 4.1 静态页（9 个，由 `src/data/seo.js` 维护）

| 路径 | Title |
| --- | --- |
| `/` | 豆玩 - 免费拼豆图纸生成器｜图片转拼豆图纸在线制作 |
| `/materials/` | 免费拼豆素材库 · 拼豆图纸素材大全 - 豆玩 |
| `/help/` | 拼豆教程与常见问题 - 豆玩 |
| `/tools/perler-bead-pattern-maker/` | Perler 拼豆图纸生成器 - 免费在线生成拼豆图纸 - 豆玩 |
| `/tools/hama-bead-pattern-maker/` | Hama 拼豆图纸生成器 - 免费在线生成拼豆图纸 - 豆玩 |
| `/tools/artkal-bead-pattern-maker/` | Artkal 优肯拼豆图纸生成器 - 免费在线生成拼豆图纸 - 豆玩 |
| `/tools/photo-to-bead-pattern/` | 照片转拼豆图纸 - 免费在线生成拼豆图纸 - 豆玩 |
| `/tools/pet-bead-pattern/` | 宠物拼豆图纸生成器 - 免费在线生成拼豆图纸 - 豆玩 |
| `/tools/pixel-bead-maker/` | 像素拼豆图纸生成器 - 免费在线生成拼豆图纸 - 豆玩 |

### 4.2 动态页（82 个，由数据库内容自动生成）

- 分类页 9 个：`/materials/category/{slug}/`（例 `/materials/category/anime/`）
- 素材详情页 73 个：`/materials/{slug}/`（例 `/materials/asset-beee8ccb80/`）

分类 slug 用 `/materials/category/` 前缀而不是需求建议的 `/materials/{分类}/`，是因为素材 slug 与分类 slug 会撞名（`pets` 既是分类也是可能的素材名）。加一层前缀后两类互不干扰，也不用改动素材已有 slug。

### 4.3 首页（按需求原文）

| 项 | 值 |
| --- | --- |
| Title | `豆玩 - 免费拼豆图纸生成器｜图片转拼豆图纸在线制作` |
| Description | `豆玩是一站式拼豆创作平台。支持上传图片一键生成拼豆图纸、像素画转换、拼豆色号匹配、材料数量统计及图纸导出。提供免费拼豆素材，手机电脑均可使用。` |
| H1 | `免费拼豆图纸生成器` |

### 4.4 不收录的页面

`/editor` `/create` `/projects` `/project-materials` `/build` `/inventory` `/account` `/auth/callback` `/settings` `/admin`（含全部二级页面）—— 照常可用，但带 `noindex` 且不进 Sitemap。

---

## 5. 自动推送流程测试结果

推送协议在 qq 上对着本地 mock 端点实测过（mock 端点与配置事后已全部还原）。

| 用例 | 结果 |
| --- | --- |
| 百度请求格式 | `POST /urls?site=dw.sharyuke.com&token=<token>`，`Content-Type: application/json`，body `{"urls":[...]}` ✓ |
| IndexNow 请求格式 | `POST /indexnow`，`Content-Type: application/json; charset=utf-8`，body `{"host":"dw.sharyuke.com","key":"...","keyLocation":"https://dw.sharyuke.com/<key>.txt","urlList":[...]}` ✓ |
| 批量补推 | 182 条任务 → 2 个 HTTP 请求完成（百度 1 次 + IndexNow 1 次），182 条全部提交 ✓ |
| 重复推送去重 | 同样内容再推一次 → 处理 0 条、跳过 182 条（原因「内容未变化，跳过重复推送」）、**0 个 HTTP 请求** ✓ |
| 强制补推 | 对 1 个页面 `force: true` → 新建 1 条、处理 1 条、发出 1 个新请求 ✓ |
| 队列排空 | 一次灌入 120 条任务，`RunQueue` 全部处理完（修复前只能发出前 50 条）✓ |
| 未配置通道 | 推送接口返回 `created: 0 / processed: 0`，不报错、不产生假数据 ✓ |
| 单测 | `internal/seo`、`internal/service`、`internal/model`、`internal/handler` 全绿 ✓ |

**测试数据已清理**：`seo_push_tasks` 表当前 0 行，三个推送通道的配置均为空（等正式 Token）。

---

## 6. robots.txt 与 sitemap.xml

| 地址 | 说明 |
| --- | --- |
| <https://dw.sharyuke.com/robots.txt> | 后端动态生成，`text/plain`；放行 Baiduspider / Googlebot / Bingbot；`Disallow` 只针对应用内路由与 `/api/`；末尾声明 Sitemap |
| <https://dw.sharyuke.com/sitemap.xml> | 后端动态生成，当前 **91 个 URL**（1 首页 + 1 素材中心 + 1 教程 + 6 工具页 + 9 分类 + 73 素材），全部 HTTPS 绝对地址，带 `lastmod` / `changefreq` / `priority` |

页面数超过单文件上限时支持分片（`sitemap-<n>.xml`），当前未触发。

---

## 7. 三家站长平台验证步骤

### 7.1 百度搜索资源平台 <https://ziyuan.baidu.com>

1. 用百度账号登录 → 添加网站 → 填 `dw.sharyuke.com`
2. **所有权验证**：选择「HTML标签验证」，把 meta 里的内容填进去
   - 站内已有：`<meta name="baidu-site-verification" content="codeva-wiHiaJr2y6" />`（`index.html`）
   - 另有两个验证文件已放在站点根目录：
     `https://dw.sharyuke.com/baidu_verify_codeva-eASMuEQNXe.html`
     `https://dw.sharyuke.com/baidu_verify_codeva-wiHiaJr2y6.html`
3. **普通收录** → 推送接口 → 取 `token`（形如 `abcd1234efgh5678`）
4. 把 token 填到 qq 的 `/etc/douwan/api.env`：
   ```
   DOUWAN_SEO_BAIDU_TOKEN=你的token
   ```
5. `systemctl restart douwan-api`
6. 后台 `#/admin/seo` → 百度应显示「已配置」，可点「批量补推」

### 7.2 Google Search Console <https://search.google.com/search-console>

1. 添加网站 → **网址前缀** → `https://dw.sharyuke.com/`
2. 验证方式选 **DNS TXT**（最稳）：把给出的 `google-site-verification=...` TXT 记录加到 DNS
   - 加好后可以填进 `config.yaml` 的 `seo.google_verify`（留空也不影响 Sitemap 提交）
3. 「站点地图」→ 提交 `https://dw.sharyuke.com/sitemap.xml`
4. 要让豆玩自动提交 Sitemap，需要服务账号（见 §8），填好后 `seo.google` 会自动显示「已配置」并定期提交

> 按需求要求，**不使用** Google Indexing API 批量推送普通素材页面。

### 7.3 Bing Webmaster Tools <https://www.bing.com/webmasters>

1. 添加网站 → 导入 GSC 站点或用 `XML 文件` 方式验证
2. 拿到 IndexNow Key：网页右上角「用户」→「API 密钥」→ 生成（形如 8~32 位十六进制）
3. 把 Key 填到 qq 的 `/etc/douwan/api.env`：
   ```
   DOUWAN_SEO_INDEXNOW_KEY=你的key
   ```
4. `systemctl restart douwan-api`
5. 豆玩会自动在站点根目录提供 `https://dw.sharyuke.com/{key}.txt` 供引擎校验
6. 在 Bing 后台「站点地图」里也填一次 `https://dw.sharyuke.com/sitemap.xml`

---

## 8. 需要提供的账号、Token 与 DNS 信息

| 用途 | 需要什么 | 填到哪里 |
| --- | --- | --- |
| 百度普通收录 | ziyuan.baidu.com 里的推送 **token** | `/etc/douwan/api.env` 的 `DOUWAN_SEO_BAIDU_TOKEN` |
| Bing IndexNow | bing.com/webmasters 的 **API 密钥** | `/etc/douwan/api.env` 的 `DOUWAN_SEO_INDEXNOW_KEY` |
| Google 自动提交 Sitemap | Search Console 的**服务账号**邮箱 + 该账号的 **JSON 私钥**（base64 编码的 PEM） | `DOUWAN_SEO_GOOGLE_CLIENT_EMAIL`、`DOUWAN_SEO_GOOGLE_PRIVATE_KEY`（已在 `api.env` 里留好位置） |
| Google Sitemap 站点属性 | `https://dw.sharyuke.com/` | `DOUWAN_SEO_GOOGLE_SITE` |
| Google 站点所有权验证 | DNS TXT 记录 `google-site-verification=...` | DNS 服务商（也可填 `config.yaml` 的 `seo.google_verify`） |
| 百度 / Bing 站点所有权验证 | 已放好验证文件，一般无需再操作 | — |

**不需要** DNS 变更来启用推送功能 —— 只有 Google 的站点所有权验证需要一条 TXT 记录。

**密钥不会泄漏**：`api.env` 权限 600、只有 root 可读；所有推送凭据只从服务端配置读，不进仓库、不通过任何接口返回明文（后台只显示「已配置 / 未配置」与密钥位数）。

---

## 9. 尚未完成的内容与原因

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实推送 | 代码与协议已验证，但线上三个通道**未配置** | 需要 §8 的 Token / 密钥 |
| 收录情况 | 未知 | 需要在各家站长平台查看。豆玩这边没有也不应伪造这个数据 |
| WebP / AVIF 图片输出 | 未做 | Go 标准库不能编码 WebP，AVIF 更没有现成实现；需要引新依赖或走前端构建期转换。当前素材图已是 png/webp 混用，前端首屏大图已经是 webp |
| 自动图片 `alt` 文案批量生成 | 部分完成 | 素材详情页的图有 alt；分类封面图沿用素材自身描述。要做到每张图语义化 alt 需要人工/模型补文案 |
| 教程内容的独立可索引页 | 只做了 `/help/` 汇总页 | 需求把教程内容 SEO 列在 P2；现在还没有独立的教程文章与后台教程管理 |
| 搜索关键词表现分析 | 未做 | 需要先有真实收录量与排名数据才有分析对象，列在 P2 |
| 自然搜索流量统计 | 未做 | 需要接站长平台的数据接口（GA / Search Console API），列在 P2 |
| Sitemap 分片 | 代码支持，未触发 | 当前 91 个 URL，远未到 5 万上限 |
| 后台「可索引页面数」的实时 diff | 未做 | 后台显示的是当前清单与推送任务数，不是站长平台的收录数 |

---

## 10. 验证记录（2026-10-25）

| 检查 | 结果 |
| --- | --- |
| 首页 / robots.txt / sitemap.xml / 素材中心 / 教程 / 工具页 | 全部 200 |
| 未知路径 | 404 |
| `/library` | 301 → `/materials/` |
| `/editor`、`/admin/seo` | 200 且带 noindex |
| 每页 `<title>` / description / `<h1>` | 各恰好 1 个（无重复 meta） |
| canonical | 每页唯一，均为 HTTPS 绝对地址 |
| 内链 | 分类页与详情页均为真实 `<a href>`，构成 首页→素材中心→分类→详情 链 |
| 结构化数据 | WebSite / Organization / SoftwareApplication / BreadcrumbList / CollectionPage / ItemList / ImageObject；无虚构评分与下载量 |
| 全站自检 | 80 页 × 4 视口，**0 错误**、无横向溢出、无画布空白 |
| 后台自检（真登录 + 真接口） | **26/26 通过**（桌面 + 手机） |
| 后端单测 | `internal/seo` `internal/service` `internal/model` `internal/handler` `internal/oauth` 等全绿 |
| 线上路由与接口 | SEO 后台 7 个接口全部返回真实数据；未配置通道时优雅降级 |

回滚材料（qq）：

- `/var/backups/douwan/web-20261025-141321.tar.gz`（前端）
- `/var/backups/douwan/server-20261025-141448.bak`、`migrate-20261025-141448.bak`（后端二进制）
- `/var/backups/douwan/db-20261025-133709.*`（数据库）
- `/var/backups/douwan/nginx-dw.sharyuke.com.bak-20261025-134300`（nginx 配置）
- `/var/backups/douwan/seo-audit-admin-20261025-140739.dump`（临时管理员清理前）
