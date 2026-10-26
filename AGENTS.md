# 豆玩 DOUWAN 工作区

> 这个文件是给「以后在这个工作区干活的 AI」看的：先读这里，再看 [DEPLOY.md](DEPLOY.md)。
> 最后更新：2026-10-26 晚（**操作台第 ② 步预览图放大**：电脑与平板端预览图按比例撑满整块预览区，
> 已上线（`pindoudou` `95894a6`）；同日晚（**首页再调整**：首屏以下的长文内容区删掉、首页入口默认进新手版（操作台）、
> 操作台底部那条站点页脚挪到首页，已上线（`pindoudou` `4f64c9a`）；
> 同日晚（**首页恢复 + 新手版变成「创作」底下的操作台**：首页回到带插画的主视觉，
> 新手简化版挪到 `/create`（操作台，隶属「创作」命令），三端首页都恢复，已上线（`pindoudou` `c1e2990`）；
> 同日下午（**首页那行「免费拼豆图纸生成器」标题不再显示**：`.sr-only` 提到全局样式，
> 已上线（`pindoudou` `e04c543`）；同日下午（**首页首屏以下的长文内容区三端全删**：手机 / 平板 / 电脑都不再显示
> 「图片如何转换拼豆图纸」以下的内容，正文仍由服务端 SEO 壳写进原始 HTML，已上线
> （`pindoudou` `c8bb9a5`）；同日下午（**新手简化版上线**：打开网站默认新手版（三步做出图纸），
> 顶栏可切专业模式，已上线（`pindoudou` `959565a`）；同日下午（**后端两条分支合并并重新发布**：
> `feat/seo-platform`（SEO V3.0）合回 master，线上恢复 `/colors/` 服务端渲染与关键词管理接口，
> `douwan-api` `5111531`）；2026-10-25 深夜（**「植物花卉」5 张花束进素材库**（运营数据，无代码改动）；
> 深夜（**「蔬菜」6 张图进素材库「美食水果」分类**（运营数据，无代码改动）；
> 深夜（**后台监控「排除名单」上线**：把主人自己的访问从统计里扣掉，
> 已上线（`douwan-api` `7d065d7`、`pindoudou` `c98001a`）；同日晚（**SEO V3.0 上线**：三层关键词库 53 条 + 16 个目标页 + 素材库自动 SEO +
> 首页首屏以下内容区 + `/colors/` 色卡页 + 后台「关键词管理」页，已上线（`pindoudou` `5fbbef0`+`fddad8e`+`42bdf62`，
> `douwan-api` `dc9acc5`+`df1b801`，分支 `feat/seo-platform`）；同日晚（**SEO 平台上线**：history 路由 +
> 服务端渲染 SEO 壳 + 动态 Sitemap + 百度/IndexNow/Google 推送队列 + 后台「SEO 管理」页，已上线
> （`pindoudou` `08b45bf`+`8335988`+`b4cfd2c`，`douwan-api` `cb67ac0`+`2765403`）；
> 同日（上传卡片对齐首屏中线，已上线（`b22b897`）；
> 同日（电脑端首页首屏三板块等距、整组居中，已上线（`ec476db`）；
> 2026-10-18（工作台除 ① 外全部卡片默认折叠，⑤ 图纸交付移到左栏、
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
- Vue 3.5 + Vite 6 + vue-router（**2026-10-25 起是 history 路由**，`createWebHistory()` + `base: '/'`；
  老的 `#/xxx` 链接由 `src/router/index.js` 的 `watchLegacyHash` shim 接管并 301 到新路径），
  **纯前端 SPA**：账号 / 会员 / Credits 目前都在 localStorage 里演示
- 公开页面的可抓取内容由**后端渲染成 SEO 壳**注入 `index.html` 的 `<!--seo-head-->` / `<!--seo-body-->`，
  爬虫在初始 HTML 里就能读到 H1、正文、内链、JSON-LD（详见 §5「已完成（2026-10-25 晚）」）
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
| `src/views/admin/AdminActivityView.vue` | 后台「用户活跃监控」页：总览 / **访问量** / 留存 / 使用频率 / 地区 / 功能使用 / 来源渠道 / 用户明细 / **排除名单**，调 13 个 `/admin/activity/*` |
| `src/lib/telemetry.js` | 前台访问量埋点：路由 `afterEach` 上报 `POST /api/v1/visits`（访客标识存 localStorage、同页面 2 秒去抖、后台页面不上报、失败静默） |
| `src/data/seo.js` | **SEO 文案单一事实来源**：站点信息、首页/素材中心/教程页文案、工具页生成规则、应用内路由清单；构建时编译成 `dist/seo/pages.json` 供后端渲染。**V3.0 起还包含关键词库（分组 / 意图 / 目标页）与自动 SEO 模板** |
| `src/lib/seo.js` | 运行时注入 canonical / OG / Twitter / JSON-LD |
| `src/views/admin/AdminSeoView.vue` | 后台「SEO 管理」页（权限点 `seo.view`/`seo.manage`）：可索引页面数、Sitemap 状态、各引擎推送结果、推送历史、手动补推（含「强制补推」）、素材 SEO 文案编辑 |
| `src/views/admin/AdminSeoKeywords.vue` | 后台「SEO 管理 → 关键词管理」标签页（V3.0 新增）：列表 / 增删改 / CSV 导入 / 分组筛选 / 三个诊断面板（意图冲突、页面字段自检、低点击率候选） |
| `src/components/home/HomeContent.vue` | 首页首屏以下的内容区（转换步骤 / 功能清单 / 免费素材 / 常见问题 / 分类入口）。⚠️ 2026-10-26 白天删过一次、当晚首页恢复时挂回来，**当天晚些时候又删掉了** —— 现在页面不渲染它，正文只存在于服务端的 SEO 壳里（组件文件还在仓库里，`git checkout c8bb9a5^ --` 能取回） |
| `src/views/ColorsView.vue` | 拼豆色号 / 色卡对照页（V3.0 新增，路由 `/colors/`），15 个品牌的真实色号 |
| `src/components/beginner/BeginnerWizard.vue` | **新手简化版三步向导**（2026-10-26）：步骤条 + 参数保护弹层 + 手机端固定 CTA |
| `src/components/beginner/BeginnerSelect.vue` | 新手版第 ① 步：上传 / 免费素材 → 统一「图片已选好」确认页 |
| `src/components/beginner/BeginnerAdjust.vue` | 新手版第 ② 步：拼豆效果 / 原图 / 对比三视图 + 等比例尺寸滑块 + 颜色丰富程度。**≥781px（电脑 / 平板）预览图按比例撑满整块预览区**（`max-size` 640 + CSS 等比放大，预览区高 `clamp(360px,60vh,660px)`），手机端样式不动 |
| `src/components/beginner/BeginnerExport.vue` | 新手版第 ③ 步：成果预览 + 材料清单 + 下载真实图纸 |
| `src/components/beginner/ModeSwitchDialog.vue` | 模式切换确认弹层（全站只挂一个，z-index 500 压在工作台指引层 400 之上） |
| `src/composables/useBeginnerMode.js` | 新手 / 专业模式状态 + 两条保护判断（**不落 localStorage**；操作台 `/create` ↔ 专业工作台 `/editor` 之间切） |
| `src/views/BeginnerView.vue` | `/create`（**操作台** = 新手简化版）的容器：sr-only H1 + 「创作 · 操作台」面包屑 + 向导（工具页，不挂站点页脚） |
| `scripts/verify-beginner.cjs` | **操作台三端验收**：手机 390 / 平板 834 / 电脑 1440 真浏览器跑完整链路（先验首页是带插画的主视觉 → 上传→调效果→拿图纸→切专业→切回新手→免费素材），带 `--url` 可直接验收线上。含**第 ② 步预览图占比断言**（≥781px 高度占预览区 ≥85%、面积占比 ≥40%；手机端画布不超出预览区 105%） |
| `scripts/verify-seo-v3.cjs` | **SEO V3.0 验收自检**：head 标签 / sitemap / robots / 首页主视觉与内容区 / 色卡页，电脑 + 平板 + 手机三档视口；`node scripts/verify-seo-v3.cjs --url https://dw.sharyuke.com`（线上 59/59） |
| `scripts/admin-audit-seo-keywords.js` | 关键词管理端到端探针（11 步），由 `admin-audit.cjs` 带 `ADMIN_EVAL_FILE` 调用 |
| `scripts/audit.cjs` | 无头浏览器自检：21 页 × 4 视口 = 84 项，查报错 / 横向溢出 / 画布空白 |
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

### 2.3 提交代码（在本机提交）

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
git add <只加自己改的路径>
git commit -m "feat: ..."
git push
```

- 本机已配好 Git 凭据：`pindoudou` 的 remote 内嵌账号密码（历史遗留），
  `douwan-api` 走 Git Credential Manager，`git push` 可直接用。
- ⚠️ 本机 `douwan-api` 的**主工作区**（`douwan-api\`）仍停在旧状态：落后 `origin/master`，
  且工作区里有并行会话未提交的本地 AI 模块。**别在主工作区 `git pull`**，会覆盖那批改动。
  SEO 平台是在隔离 worktree `douwan-api\.tmp\wt-seo`（分支 `feat/seo-platform`）里做的；
  2026-10-26 已把 `feat/seo-platform` merge 进 master（`feat/seo-v3-merge`，`5111531`）并推到 `origin/master`。
  **以后改后端一律用 `douwan-api\.tmp\wt-*` 隔离工作区**（主工作区不能 pull）。

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

> ⚠️ 打包用 **`C:\Windows\System32\tar.exe`**（Windows 自带的 bsdtar）。
> PATH 上的 `tar` 是 Git 的 GNU tar，它会把 `C:\...` 当成远程主机名、把 `\d` 当转义，
> 打包会失败或生成错名字的文件名。

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

**已完成（2026-10-25）——电脑端首页首屏三板块等距、整组居中（`pindoudou` `ec476db`，已上线）**

- 用户按截图提的要求：标题往上走、底部文字往下走、上传卡片上下居中、三个板块间距相等、整组在画面正中
- 改动只在 `src/views/HomeView.vue` 的样式（模板与脚本没动）：
  - `.homeHero` 上下留白改成对称的 `padding:32px 20px` → 内容栏正好居中于 hero，
    而 hero 高度 = 视口 - 顶栏 - 页脚，所以三块内容的**整体落在画面正中**
  - 新增 CSS 变量 `--block-gap:clamp(30px,4vh,50px)`，`.uploadCard` 与 `.homeFeatures` 的
    `margin-top` 都用它 → 三板块间距**相等**（改前 28 / 20 不等），卡片自然落在上下两板块中间
- 实测（Chrome 无头，2561×1227，与用户截图同一视口）：间距 49 / 49、卡片中心 = 两板块中点、
  整组中心 = 视口中心（改前间距 28 / 20，整组中心与视口中心差 8px）
- 手机端不动（≤780px 自己一套 margin）；1440×1000 下页面比改前多滚 6px（可接受）
- 验证：全站 80 页自检 0 错误；线上 `--url https://dw.sharyuke.com` 真浏览器复核 4 档视口全绿；
  首页上传自检（点按钮 / 拖图进卡）仍全绿
- qq 回滚包 `/tmp/dw-web-backup-before-home-gap-20261025-125523.tar.gz`

**已完成（2026-10-25 下午）——上传卡片对齐首屏中线（`pindoudou` `b22b897`，已上线）**

- 用户看线上首页截图，圈出上传卡说「卡片上下居中对齐」。先量了线上：`ec476db` 那版卡片**在上下两块之间**
  确实是居中的（间距 48/48），但整组被**比它高得多的标题块**（345px，底部块只有 73px）压偏，
  卡片中心落在首屏中线**下方 136px**。用户选了「落到首屏中线」这条
- 改法（仍只动 `src/views/HomeView.vue`）：`.homeHero` 从 `align-items:center` 改成 `stretch`，
  内容栏变成**三行网格** `minmax(auto,1fr) auto minmax(auto,1fr)`——
  标题块 `align-self:end`（往上贴）、上传卡在中间行、底部说明 `align-self:start`（往下贴），
  三行等分剩余空间 ⇒ 卡片那一行天然压在 hero 的垂直中线上；`row-gap` 就是统一间距
- 标题图改成**按视口高度缩放**：`height:clamp(100px,calc(46dvh - 303px),246px)` + `aspect-ratio:1532/629`
  （246px 高 = 600px 宽，用户确认过的尺寸）。公式来历：标题块高 ≤ 「首屏一半 − 卡片高 − 两个间距」，
  即 `46dvh − 303px`；超出的部分标题就矮一档，卡片照样居中
- 矮屏（≤900px 高）另加一段媒体查询：hero 的 `min-height` 去掉 660px 下限、标题图下限放到 64px、
  卡片 `min-height` 收到 260px ⇒ 1366×768 / 1280×800 这类笔记本也能卡在中线上
- 手机端（≤780px）整段回退成原来的竖排流，间距仍是 16 / 12，**逐像素与改前一致**
- 实测（无头 Chrome，线上）：2554×1206 卡片 453..753、中心 603 = 首屏中线**差 0px**、间距 48/48；
  1920×1080 / 2560×1440 / 1440×1000 / 1440×900 / 1600×900 **全部差 0px**；
  1366×768 差 9px、1280×800 差 35px（页面本来就要滚一点，卡片仍在 hero 里居中）
- 验证：全站 80 页自检 0 错误（4 档视口）+ 首页上传自检全绿（点按钮进工作台 / 拖图生成 120×120）；
  线上 `--url https://dw.sharyuke.com` 真浏览器复核 4 档视口
- qq 回滚包 `/tmp/dw-web-backup-before-home-center-20261025-133632.tar.gz`
- ⚠️ **这次是共享工作区并行会话最凶的一次**：对方已经把路由从 hash 模式改成 history 模式
  （SEO 落地页，`edd81b5` 已提交但**没上线**），工作区里还有 30+ 个对方改过的文件。
  所以**没有直接构建共享工作区**，而是 `git worktree add` 到 `ec476db`（线上那版），
  只把改好的 `HomeView.vue` 拷进去、用 junction 挂 `node_modules` 构建 → 部署的产物 =
  「线上版本 + 我这一处改动」，不会把对方未上线的路由改动带上线
  （junction 要用 `cmd /c rmdir` 删，删 worktree 前先摘掉，否则会连真 `node_modules` 一起删掉）

**已完成（2026-10-25 晚）——SEO 平台上线（`pindoudou` `08b45bf`+`8335988`+`b4cfd2c`，`douwan-api` `cb67ac0`+`2765403`，已上线）**

- 需求原文：「豆玩 SEO 搜索引擎优化与自动抓取系统开发需求 V2.0」。交付文档：`pindoudou/docs/seo.md`
- **路由 hash → history**（`createWebHistory()` + `base: '/'`）。这是可抓取的前提：
  爬虫眼里 hash 路由的所有页面都是同一个 URL。配套 `watchLegacyHash`/`restoreFragment` 兼容老链接，
  OAuth 回调的 token 仍留在 fragment 里不外泄；`/library` 由 nginx/后端 301 → `/materials/`
- **服务端渲染 SEO 壳**（不重构 SPA）：后端读 `dist/index.html` 外壳，把渲染好的 head/body 注入
  `<!--seo-head-->`/`<!--seo-body-->`。内容来源是前端构建时生成的 `dist/seo/pages.json`
  （`scripts/build-seo-pages.mjs` 从 `src/data/seo.js` 编译）——「爬虫看到的」与「用户看到的」同一份文案
- **路径命名**：分类 `/materials/category/{slug}/`（**不**用需求建议的 `/materials/animals/`，
  因为素材 slug 与分类 slug 会撞名）；素材 `/materials/{slug}/`；
  作品材料清单从 `/materials/:projectId` 挪到 `/project-materials/:projectId?`
- **推送**：百度普通收录 API、IndexNow、Google Sitemaps API（**不用** Google Indexing API 推普通素材页）。
  Token 只从服务端配置读，不进仓库、不通过接口返回明文。内容指纹去重（没变就跳过），
  后台有「强制补推」开关；队列一次取 50 条并循环排空
- **后台「SEO 管理」页** `#/admin/seo`：可索引页面数、Sitemap/robots 状态、各引擎推送结果、推送历史、
  手动补推、批量补推、素材 SEO 文案编辑、查看失败原因
- **口径**：后台严格区分「已推送 ≠ 已抓取 ≠ 已收录 ≠ 有排名」，没接官方数据接口时**不显示任何收录数**
- ⚠️ **踩到的真 bug**：`ContentStore.Get()` 读过一次 `pages.json` 就永远用缓存，
  注释里写的「按 mtime 判断是否需要重新读」其实没实现 —— 前端发布覆盖 `pages.json` 后爬虫看到的还是旧文案
  （首页 H1 就是这么没更新的）。已修 + 补回归测试 `internal/seo/content_test.go`
- ⚠️ **本机 WDAC 会拦掉改过的 Go 测试二进制**（策略「企业签名级别」）：
  Go 构建确定性 ⇒ 没改过的包哈希一样能跑，**一改代码哈希就变**直接被拦
  （`An Application Control policy has blocked this file`）。**后端测试改到 home 上跑**
- 验证：全站 80 页自检 0 错误（4 视口）、后台自检 26/26、后端全量单测全绿（home 上跑）、
  公网逐项复核（每页 title/description/h1 各恰好 1 个、canonical 唯一、内链是真 `<a href>`、
  JSON-LD 无虚构评分与下载量）；推送协议对着本地 mock 端点实测过（百度与 IndexNow 请求格式、批量、去重、强制补推）
- ⚠️ **线上三个推送通道当前都未配置**（等用户在百度/IndexNow/GSC 取 Token），`seo_push_tasks` 表 0 行。
  平台验证步骤、Token 填法见 `pindoudou/docs/seo.md` §7 §8

**已完成（2026-10-25 深夜）——SEO V3.0：搜索词优化与关键词管理（`pindoudou` `5fbbef0`+`fddad8e`+`42bdf62`，`douwan-api` `dc9acc5`+`df1b801`，已上线）**

- 需求原文：「豆玩 SEO 搜索词优化与关键词管理 V3.0」。交付文档：**`pindoudou/docs/seo-v3.md`**
- **三层关键词库**（`src/data/seo.js` 的 `KEYWORD_GROUPS`/`KEYWORD_INTENTS`/`KEYWORD_TARGETS`，
  编译进 `dist/seo/pages.json`，后台「同步关键词库」写进 `seo_keywords` 表）：
  工具转换词 15 / 免费素材词 30 / 教程与专业功能词 8 = **53 条**，对应 **16 个目标页**
  （品牌词「豆玩」挂在首页相关词上，主意图仍是「拼豆图纸生成器」，不单独建页）
- **关键词与页面对应**（每页一个主要意图 + 一组相关词，不为近义词造重复页面）：
  首页=拼豆图纸生成器；工具页=图片转拼豆 / 照片转拼豆图纸 / 像素 / 宠物；
  素材中心=免费拼豆图纸 / 拼豆素材；分类页=动物 / 水果 / 甜品 / 秋冬；
  教程中心=拼豆新手教程；色卡页=拼豆色号 / 拼豆色卡对照（`/colors/`，V3.0 新建的真实色号页）
- **素材库自动 SEO**：按真实字段（名称 / 分类 / 简介 / 格数 / 标签）生成 Title / H1 / 描述 / 图片 alt；
  管理员改过的文案 `seo_auto=false`，自动重算不覆盖；没有内容的页面标 noindex、不进 Sitemap
- **首页内容区**（`src/components/home/HomeContent.vue`）：首屏保持单屏不动，内容放在首屏以下 ——
  转换步骤 4 步 / 功能 6 项 / 免费素材 3 段 / FAQ 5 条 / 分类入口（真实分类 + 真实数量）。
  ⚠️ **2026-10-26 白天删过一次、当晚首页恢复时挂回来、当天晚些时候又删掉** ——
  现在**页面不渲染**它，正文只存在于服务端的 SEO 壳（原始 HTML）里
- **后台「关键词管理」页**（`src/views/admin/AdminSeoKeywords.vue`）：列表、增删改、CSV 导入、
  分组与状态筛选、按点击/曝光/点击率排序，外加三个诊断面板（意图冲突 / 页面缺字段 / 低点击率候选）
- **搜索表现数据**：Google Search Console API 的代码路径已就绪（`internal/seo/searchconsole.go`），
  **但没配服务账号凭据** ⇒ 曝光/点击/点击率/排名一律显示「暂无数据」，绝不编造；
  百度、Bing 没有可用的关键词查询接口，走站长后台手动导出 CSV 导入
- ⚠️ **踩到的真 bug（已修）**：`CountByCategory` 把草稿和已下架的素材也数了进去，
  首页写「22 个素材」、分类页写「共 21 个」，用户点进去数一遍就对不上。
  改成只数 `status = published`，并把「可索引数」与「已发布数」分成两个计数；
  回归测试 `TestCategoryCountOnlyCountsPublished` 盯着（去掉过滤后该用例会失败）
- 验证：`go vet` + 全量单测全绿（home 上跑）、**线上 SEO V3 验收自检 50/50 通过**
  （`node scripts/verify-seo-v3.cjs --url https://dw.sharyuke.com`）、
  后台自检 **28/28 通过**（桌面 + 手机）、关键词管理探针两档视口各 11/11 步通过、
  全站自检 80 页 × 4 视口 0 错误（`notfound` 页那条 404 是按设计的）
- 回滚：qq `/opt/douwan-api/bin/*.bak-seov3-20261025-151030`、
  `/root/douwan-backups/douwan-seov3-20261025-151030.dump`
- ⚠️ **线上还有 5 个分类没有已发布素材**（beginner / couples / cute / festivals / lifestyle；
  plants 已于 2026-10-25 深夜补上 5 张花束），
  对应关键词状态是「planned」，分类页标 noindex、不进 Sitemap、不推送；
  素材到位后发布流程会自动建页并转「已上线」

**已完成（2026-10-25 深夜）——后台监控「排除名单」：把「自己」的访问从统计里扣掉（`douwan-api` `7d065d7`，`pindoudou` `c98001a`，已上线）**

- 需求原文：「后台的用户监控，我想把我自己访问的区分出来，我自己打开的不算」。
  实测主人自己的流量占了访客数的九成（`219.152.45.216` 一个 IP 就 384 个访客 / 3985 次访问），
  不剔除的话「访问量 / 访客数」几乎全是自己
- 做法：后台「用户活跃监控」新增**「排除名单」**标签页（新表 `monitor_exclusions`，kind = ip / visitor / user）。
  名单里的访问**不计入** PV / UV / DAU / 留存 / 地区 / 功能 / 渠道 / 用户列表，
  但**剔掉了多少会在卡片里单独报出来**（「剔掉了自己」和「本来就没有人」必须分得开）
- 后端要点：
  - 名单通过 **context** 传到查询层（`repository.WithExclusion` + `excludeUsers` / `excludeVisitors`），
    二十来个统计查询自动带上；不给每个方法加参数 ⇒ 不会漏掉某一张表
  - IP 与账号要**展开成访客标识**（访问量那张表只有访客标识），访客标识支持**前 8 位前缀**
    （后台列表出于隐私只显示前 8 位，主人能对着列表点「标为自己」）
  - 值都要校验（IP 用 `net.ParseIP`、访客标识只认十六进制、账号只认数字）：
    写错的规则在库里看起来和正确的一样，实际一条都排除不掉
  - 删除走软删除 ⇒ `Add` 必须 `Unscoped` 找回并**恢复**那条记录，
    否则重新添加会撞 `(kind, value)` 唯一索引（已踩过，已修 + 回归测试）
  - 新增 `GET/POST/DELETE /api/v1/admin/activity/exclusions`，复用 `activity.view` 权限
- 前端：新增「排除名单」标签页（名单条数 / 覆盖访客 / 覆盖账号三张卡 + 一键标记 + 手动添加 + 逐条删除）；
  访客明细表每行加「标为自己」；用户明细每行加「标为自己」（按账号）；
  总览与「访问量」两页各加一条提示写明剔掉了多少
- 已按主人实际出口预置 6 条：IP `219.152.45.216` / `219.152.41.0` / `219.152.40.85` / `219.152.43.28`
  （自己的宽带与手机网络）、`127.0.0.1`（服务器本机自检）、账号 `32`（`yqf5258`，自己的前台账号）。
  效果：30 天窗口 PV 从 5544 → 408、UV 从 519 → 26
- 验证：`go vet` + 全量单测全绿（home 上跑，本机 WDAC 会拦改过的测试二进制，见 §2.2）；
  真机（临时管理员）确认增删、统计立即重算、软删除后重新添加不撞唯一索引；后台无头自检 **30/30 通过**
  （含线上产物复检）；临时管理员已删除
- 回滚：qq `/opt/douwan-api/bin/server.bak-20261025-152834`（部署前那版）、
  `/tmp/dw-web-backup-before-exclusions-20261025-153612.tar.gz`（前端）
- ⚠️ 这次前端是**从 `42bdf62`（不是旧基线）**打的补丁：并行会话已经往 `master` 推了 SEO V3.0 的三个提交，
  线上产物哈希与旧基线对不上；用 `git diff --output` 导出补丁 + `git apply --3way` 落到最新基线上，
  才不会把对方没上线的改动带上线 / 覆盖掉
- ⚠️ 部署前先核对线上产物哈希（`dist/index.html` 里的 `assets/index-*.js`）与本地基线构建是否一致：
  不一致说明线上比基线新，**必须重新基于最新提交打补丁**，不能直接覆盖

**已完成（2026-10-25 深夜）——「蔬菜」6 张图进素材库「美食水果」分类（运营数据，无代码改动）**

- 需求原文：「/z/拼豆/素材库/素材/美食水果/蔬菜 把这个传进素材库的美食水果分类，不做用途分类」
- 源目录 `Z:\拼豆\素材库\素材\美食水果\蔬菜`（6 张 1254×1254 PNG，带透明背景的 Q 版蔬菜）：
  扁豆 / 大葱 / 萝卜 / 西兰花 / 香菇 / 洋葱
- 走**后台素材上传接口** `POST /api/v1/admin/assets/upload`（等价于后台「素材库管理 → 上传素材」），
  每张单独一次请求（同一请求里的多张图只能共用一个标题，后端会给后面的加 `-2`、`-3` 后缀）：
  `category_id=15`（美食水果）、`status=published`、`tier=free`、`is_featured=false`、
  `sort_order` 840~890（该分类原有区间是 620~830，所以这 6 张排在最前面），
  落库 id 114~119
- 标签按该分类已有素材的惯例给：`["美食水果","萌趣食物","Q版食物","原创角色","入门"]`；
  **不带任何用途标签**（钥匙扣 / 冰箱贴 / 杯垫 / 挂饰 / 摆件 / 装饰画）——
  前台「用途」筛选是按标签匹配的，所以这些图只会出现在「全部用途」下
- 缩略图由后端生成（`SaveThumbnail`，透明区铺白底），前台卡片用的是缩略图不是原图
- 操作用的临时管理员 `tmp_veg_uploader`（id 34）已软删除并停用，令牌立即失效（再请求返回 401）；
  6 条素材的 `created_by` 已改回真实管理员 `douwan`（id 1）
- 验证：公开接口 `GET /api/v1/assets?category_slug=food` 返回 27 条（21 旧 + 6 新）；
  真浏览器打开 `https://dw.sharyuke.com/materials/category/food`（桌面 1440×960 与手机 390×844）
  —— 6 张都在最前面、缩略图全部加载成功、无 console 报错、无失败请求；
  详情页 `/materials/asset-cc9bc456f7` 正常（标题「扁豆拼豆图纸素材免费下载 - 豆玩」、
  分类「美食水果 / 萌趣食物」、标签齐全、同类素材正常）

**已完成（2026-10-25 深夜）——「植物花卉」5 张花束进素材库（运营数据，无代码改动）**

- 需求原文：「/z/拼豆/素材库/素材/植物/aff41301-499c-4d73-938a-5f350484e2f0.zip 这个传到植物花卉的分类，不做用途分类」
- 源是一个 zip（4.2MB），里面 5 张 PNG（文件名是 UUID，没有可读名字）：
  `aff41301…` 紫粉花束小兔、`b4ace3b7…` 向日葵小鸡花束、`ccce96e7…` 紫白花束熊猫、
  `4dc15ab1…` 红玫瑰花束小熊、`16bec14a…` 蓝色花束小猫（都是 Q 版花束 + 中间一只小动物）
- 走后台素材上传接口 `POST /api/v1/admin/assets/upload`（每张单独一次请求，理由同上一条）：
  `category_id=16`（植物花卉）、`status=published`、`tier=free`、`is_featured=false`、
  `sort_order` 895~935，落库 id 120~124
- 标签 `["植物花卉","花束","原创角色","入门"]`，描述「Q版萌趣花束拼豆图案，入门难度，色块大、线条简单，适合新手练习。」；
  **同样不带用途标签**（前台「用途」筛选按标签匹配，选「钥匙扣」时该分类 0 条）
- **这是「植物花卉」分类的第一批素材**：该分类页原来因为没有已发布素材是 noindex / 不进 Sitemap，
  现在 `robots=index,follow`、标题「植物花卉拼豆图纸大全｜免费素材在线制作 - 豆玩」，
  5 个素材详情页也都进了 sitemap（`/materials/asset-17655f0ac2` 等）
  - `seo_keywords` 里指向 `/materials/category/plants/` 的两条（35 植物拼豆图纸 / 36 花卉拼豆图纸）
    状态仍是 `planned`（待建设），要改成「已上线」得去后台「SEO 管理 → 关键词管理」改
- 临时管理员 `tmp_plant_uploader`（id 35）已软删除并停用；5 条素材的 `created_by` 改回真实管理员 `douwan`（id 1）
- 验证：真浏览器打开 `https://dw.sharyuke.com/materials/category/plants`（桌面 1440×960 与手机 390×844）
  —— 5 张都在（页面显示「共 5 个素材」）、缩略图全部加载成功、用途筛选选「钥匙扣」0 条、
  详情页正常（标题「紫粉花束小兔拼豆图纸素材免费下载 - 豆玩」、分类「植物花卉 / 花束」、同类素材列出其余 4 张）；
  无 console 报错、无失败请求

**已完成（2026-10-26 下午）——新手简化版上线（`pindoudou` `959565a`，已上线）**

- 需求原文：「根据需求在原本基础上加一个新手简化版，三个端口都需要，打开网站默认显示新手版」
  （`Z:\拼豆\新手简化版\03_详细产品需求_PRD.md` / `04_视觉指引.md` / `05_Grok_直接执行命令.md`）
  交付文档：**`pindoudou/docs/beginner.md`**（文件清单 / 复用清单 / PRD §七 10 条逐条勾选 / 遗留项）
- **入口变了（2026-10-26 晚又改过一次，现为最终状态）**：路由 `/` 现在是**首页**
  （带插画的主视觉那版），**新手简化版挪到 `/create`，页面名叫「操作台」，隶属「创作」命令**
  （侧栏与手机底栏的「创作」都指它）；老链接 `/home` 重定向到 `/`
  - 首页的 canonical / sitemap / 关键词定位**完全不变** —— 同一个 URL，不另开页面
  - `/create` 是应用内页面：`noindex`、不进 Sitemap（已在 `src/data/seo.js` 的 `APP_ROUTES` 里）
  - 首页重新挂上 `HomeContent`（SEO V3.0 的可抓取正文），操作台只做三步、不带长文内容区
- **新手三步**：① 选择图片（上传 / 免费素材 → 统一「图片已选好」确认页）② 调整拼豆效果
  （拼豆效果 / 原图 / 对比三视图、等比例成品尺寸滑块、颜色丰富程度少色/标准/丰富）
  ③ 获取图纸（成果预览 + 材料清单 + 下载真实图纸 + 进入专业模式 + 返回上一步）
- **数据必须真实**：成品厘米 = 格数 × 豆径（口径在 `lib/boardSpec.js`）、豆子数 = 有效非空格统计、
  颜色数 = 图纸实际用色、板数 = 按分板规格铺满要几块板；
  拖动滑块时显示**估算值并标注**，松手后重新取样显示**精确值** —— 两者不混着说
- **两种模式共用同一件作品**（`useStudio` 单例）：模式只决定显示哪一层界面，作品状态原样留着
- **两条保护**：
  - 模式保护：`useStudio` 新增 `manualEdited`（这张图被逐颗改过没有），专业 → 新手时先弹
    `ModeSwitchDialog` 说明「不会自动重画」，确认后停在第 ③ 步，不按新手默认参数重画
  - 参数保护：新手改尺寸 / 颜色数会重算图纸，若图被手改过就弹「**保留当前修改** /
    **另存一个版本并继续**」两条安全路径
- **模式状态不落 localStorage**：打开网站停在普通状态（首页是宣传页，不参与模式同步）；
  操作台 `/create` 刷新仍在操作台，专业工作台 `/editor` 刷新仍在专业版
- 顶栏常驻「新手 / 专业」分段开关；侧栏与手机底栏的「创作」指向 `/create`（操作台）
- ⚠️ **踩到的坑**：
  - ① 第 ① 步生成图纸那一刻若用 `watch(hasPattern)` 跳第 ③ 步，会把中间的「调整效果」整步吃掉 ——
    改成 `onMounted(() => { if (hasPattern.value) step.value = 3 })`（只在挂载时判一次）
  - ② 手机端第 ③ 步的下载按钮被预览图顶到屏幕外 —— 预览限高 + 底部固定 CTA 条
    （`bottom: calc(84px + env(safe-area-inset-bottom))`，在底部标签栏上方）
  - ③ 顶栏上传按钮在**已经站在首页**时也能用，但路由不变、组件不重挂载，
    只在 `onMounted` 取一次 `pendingUpload` 永远取不到 —— 改成 `watch(pendingFile)`
    （`usePendingUpload.js` 因此导出这个 ref）
  - ④ 工作台的新手指引层 z-index 是 400、普通弹窗只有 200：第一次进工作台就点「新手」时，
    指引会盖在弹窗上（弹窗被压暗还点不动）—— 切换弹层提到 500，
    并给 `EditorGuide` 加 `suspend` 属性（弹层打开时收起指引，**保留当前步骤**）
  - ⑤ 页面里有两个 file input（顶栏 `.libFile` 与向导 `.bsel__file`），
    自检脚本用 `input[type=file]` 会选中顶栏那个 —— 改用 `.bsel__file` 精确选择器
- 验证：`node scripts/verify-beginner.cjs --url https://dw.sharyuke.com` **线上 73/73 通过**
  （mobile 25 / tablet 24 / desktop 24，console 报错 0 条）；
  全站自检 80 页 0 错误；`node scripts/verify-seo-v3.cjs --url https://dw.sharyuke.com` **50/50 通过**
- 三端真实截图 27 张已入库：`pindoudou/docs/beginner/`（每端 9 张：选图 / 确认页 / 调整 / 少色 /
  获取图纸 / 专业模式 / 切回新手 / 保护弹层 / 免费素材）
- 回滚：qq `/root/douwan-backups/dw-web-before-beginner-20261026-144102.tar.gz`（前端）

**已完成（2026-10-26 下午）——首页首屏以下的长文内容区，三端全删（`pindoudou` `c8bb9a5`，已上线）**

> ⚠️ **这条在当天晚上被推翻了**：用户随后要求恢复老首页，首页的内容区跟着回来了
> （见下一条「首页恢复 + 操作台」）。下面是当时的做法，留着当过程记录。

- 需求原文：先说「电脑版把这以下的内容都删除」（截图从「图片如何转换拼豆图纸」开始），
  随后改成「**所有端口这以下的内容都删除**」—— 即手机 / 平板 / 电脑三端都不显示这块内容
- 删掉的是 `src/components/home/HomeContent.vue`（SEO V3.0 的首屏以下内容区，5 个块：
  转换步骤 4 步 / 功能清单 6 项 / 免费素材 3 段 / FAQ 5 条 / 分类入口）：
  - `src/views/BeginnerView.vue`（`/`）：不再挂 `<HomeContent />`，首页只剩三步向导 + 页脚
  - `src/views/HomeView.vue`（旧首页 `/home`，noindex）：一并移除
  - 组件文件删除（已无引用）
- ⚠️ **正文没有从网站消失，只是从页面上消失了**：服务端渲染的 SEO 壳（`douwan-api` 的
  `internal/seo`）仍按 `src/data/seo.js` 把同样的文案写进首页**原始 HTML**
  （`seo-lead` / `seo-p` / `seo-grid` / `seo-steps` / `seo-h2` / `seo-faq` / `seo-links`），
  爬虫读到的仍是完整正文 + 内链 + JSON-LD；Vue 挂载后 `#app` 里换成向导，页面上看不到那段
  - 线上原始 HTML 里已核对：正文四段（转换步骤 / 功能卡 / 两个 H2 小节）+ FAQ + 分类内链都在
  - 新增断言守住这一点：`verify-seo-v3.cjs` 里「首页原始 HTML 仍含长文正文（服务端 SEO 壳）」
- 自检跟着改：`verify-seo-v3.cjs` 的首页内容区断言从「三端都要有 5 个块」改成
  「**三端都不渲染**内容区 + 「页脚不压住向导」」，并补上**平板档**视口（桌面 / 平板 / 手机三档）；
  `audit.cjs` 的页面表加入旧首页 `/home`（盯住老链接进来还是不是个能用的页面）
- 验证：本地全站自检 80 页 0 错误；**线上 SEO V3 自检 50/50 通过**
  （`node scripts/verify-seo-v3.cjs --url https://dw.sharyuke.com`）、
  **新手版自检 73/73 通过**（`node scripts/verify-beginner.cjs --url https://dw.sharyuke.com`）；
  线上 `/` 与 `/home` 四档视口 0 报错、无横向溢出；桌面 / 平板 / 手机三张首页截图已核对
- 回滚：qq `/root/douwan-backups/dw-web-before-homecontent-20261026-152442.tar.gz`（前端）
- ⚠️ **随后又修掉一个真 bug（`pindoudou` `e04c543`）**：`.sr-only`（只给读屏器/爬虫看的隐藏样式）
  原来只写在 `HomeView.vue` 的 **scoped** 样式里，scoped 只作用于那个组件的元素 ⇒
  新手首页（`BeginnerView.vue`）的 `<h1 class="sr-only">免费拼豆图纸生成器</h1>` 吃不到这条规则，
  **那行字直接显示在页面左上角**（用户截图指出来的）。
  改法：把 `.sr-only` 提到 `src/styles/global.css`（全局工具类），`HomeView.vue` 里的重复定义删掉；
  H1 仍在 DOM 里（爬虫与读屏器照旧读得到），页面上不再显示。
  自检新增断言「H1 只给读屏器看（页面上不显示）」，三档视口各查一次
  - 验证：线上 SEO V3 自检 **53/53 通过**、新手版自检 **73/73 通过**、
    `/` 与 `/home` 四档视口 0 报错无溢出；桌面首页截图确认那行字已经不在
  - 回滚：qq `/root/douwan-backups/dw-web-before-sronly-20261026-153317.tar.gz`（前端）
  - ⚠️ **教训**：`sr-only` 这类工具类必须放全局样式；写进某个组件的 scoped 样式里，
    别的组件用同一个类名时不会报错、只是**不生效**（页面上直接露出文字）

**已完成（2026-10-26 下午）——后端两条分支合并并重新发布（`douwan-api` `5111531`，已上线）**

- ⚠️ **发现并修掉一个线上回归**：2026-10-25 深夜发布「排除名单」时，后端二进制是从 **master** 构建的，
  而 **SEO V3.0（关键词管理）只在 `feat/seo-platform` 分支上、从来没合进 master** ⇒ 线上那一版
  同时丢了两个东西：
  - `/api/v1/admin/seo/keywords*` 11 个接口全部 **404**（后台「关键词管理」页直接不可用）
  - `/colors/` 服务端渲染**没有对应分支** ⇒ 规范化把 `/colors/` 301 成 `/colors` 再 404
    （色卡页在爬虫眼里是 404，而它在 Sitemap 里）
- 做法：新建隔离 worktree `douwan-api\.tmp\wt-merge`（分支 `feat/seo-v3-merge`），
  把 `feat/seo-platform` **merge** 进 `origin/master`（无冲突，19 个文件），
  在 **home** 上跑 `go vet ./...` + `go test -count=1 ./...` 全绿，再交叉编译 linux/amd64，
  部署到 qq（先 `pg_dump` 备份 + 旧二进制 `.bak-20261026-144945`），迁移后重启
- 验证：`/colors/` → 200（标题「拼豆色号与色卡对照 - 各品牌真实色号表 - 豆玩」）、
  `/api/v1/admin/seo/keywords` → 401（路由在，要登录）、排除名单与访问量接口都还在
- 顺手统一了**素材 SEO 文案**：85 条在架素材的标题统一成「名称拼豆图纸｜免费拼豆素材 - 豆玩」
  （此前 11 条新上传的素材用的是旧格式「…素材免费下载 - 豆玩」）。
  用后台「重新生成自动文案」接口 `POST /api/v1/admin/seo/regenerate` 重算（人工写过的 0 条被覆盖）
- ⚠️ **`origin/master` 现在包含 V3.0 了**，但本机 `douwan-api\` 主工作区**仍然落后**且有并行会话的
  本地 AI 未提交改动 —— **别在主工作区 `git pull`**，继续用 `douwan-api\.tmp\wt-*` 隔离工作区
- 临时管理员 `tmpseo2026`（id 36）用完已软删除并停用（令牌已失效）；顺手把
  `tmp_mon_admin`（id 33）也停用了

**已完成（2026-10-26 晚）——首页恢复 + 新手简化版变成「创作」底下的**操作台**（`pindoudou` `c1e2990`，已上线）**

- 需求原文：「把之前的首页恢复，这个新手版加入的是操作台，隶属于创作命令下的，
  三个端口的首页都恢复，有插画有主题的那个」
- **路由**：首页回到 `/`（`HomeView.vue`：奶油底顶栏 + 主视觉标题图 + 上传卡 + 三条真实能力 +
  左右两幅拼豆插画 + 首屏以下的 `HomeContent` 正文 + 紧凑页脚），**手机 / 平板 / 电脑三端都是这一版**；
  `/create` = **操作台**（`BeginnerView.vue`，新手三步向导，`noindex`、不进 Sitemap）；
  老链接 `/home` 重定向到 `/`
- **导航**：`siteNav.js`（侧栏）与 `MobileTabbar.vue`（手机底栏）的「创作」都指向 `/create`；
  操作台页面顶部有「创作 · 操作台」面包屑，说明它隶属「创作」这条命令；
  顶栏「新手 / 专业」分段开关在 `/create` ↔ `/editor` 之间切（`App.vue` 的模式同步也改成这两个地址）
- **站内 CTA 全部改指操作台**：`ToolView` / `ProjectsView` / `NotFoundView` / `MaterialsView` /
  `BuildView` / `HelpView` / `AssetDetailView` / `ColorsView` / `MaterialPreviewDialog` / `AppFooter`
  里的「开始创作 / 去创作 / 上传照片开始 / 用这个素材生成图纸」；
  顶栏上传（素材库的「上传图片去创作」）改回 `/editor`（待上传文件由工作台取走）
- **首页重新挂上 `HomeContent`**：组件文件用 `git checkout c8bb9a5^ -- src/components/home/HomeContent.vue` 取回；
  首页紧凑页脚加了一条「操作台 · 三步做图纸」（首页桌面端没有左侧栏，否则从首页进不去操作台）
- 顺手修掉一个真 bug：`src/lib/seo.js` 里 `noindex` 页面的标题后缀写死成「· 豆玩后台」，
  前台的应用内页面（工作台、操作台）也被挂上「后台」两个字 —— 改成后台才用「豆玩后台」、
  其余用「豆玩 DOUWAN」
- 自检跟着改：
  - `verify-beginner.cjs` 改验 `/create`（并先验「首页是带插画的主视觉」「首页不再放向导」）；
    「切回新手模式」的断言路径改成 `/create`
  - `audit.cjs` 页面表：`/home` 改成「老链接跳转」，`/create` 从「别名」改成「操作台」
  - `verify-seo-v3.cjs` 首页断言从「三端都不渲染内容区」改成「主视觉 + 插画 + 内容区 5 个块都在、
    H1 仍隐藏、首页不再放向导、页脚在主视觉之后」
- 验证：线上 `verify-beginner.cjs --url` **82/82 通过**（console 报错 0）、
  `verify-seo-v3.cjs --url` **62/62 通过**、`audit.cjs --url` **84 项 0 错误**
  （只有 404 页自身那条 404，按设计）；线上 `/` 原始 HTML 仍是 `index,follow` + canonical `/` +
  服务端 SEO 壳正文，`/create` 是 `noindex`
- 回滚：qq `/root/douwan-backups/dw-web-before-home-restore-20261026-154837.tar.gz`（前端）
- ⚠️ **这次没有动后端**：服务端给应用内页面的标题是兜底值「豆玩 DOUWAN · 豆玩 DOUWAN」，
  客户端接管后会改成「拼豆操作台 · 豆玩 DOUWAN」；要一次到位就在
  `douwan-api` 的 `internal/service/seo.go` 的 `appRouteTitle()` 里加一条 `/create` 分支
  （改后端必须用 `douwan-api\.tmp\wt-*` 隔离工作区，测试放 home 上跑，见 §2.2）

**已完成（2026-10-26 晚，第二次调整）——首页去掉长文内容区、入口默认进新手版、站点页脚挪到首页（`pindoudou` `4f64c9a`，已上线）**

- 需求原文：「这些以下内容都去掉，首页点进去后默认显示新手版的，
  然后新手版底部那条内容放去首页，操作台不要」
  （截图 = 首页首屏以下那五块正文：「图片如何转换拼豆图纸」起）
- **首页首屏以下的正文删掉**：`HomeView.vue` 不再挂 `<HomeContent />`。
  正文（转换步骤 / 功能 / FAQ / 分类入口）**仍在服务端的 SEO 壳里** ——
  `douwan-api` 的 `internal/seo` 按 `src/data/seo.js` 把同样的文案写进首页原始 HTML
  （`seo-steps` / `seo-faq` / `seo-links`），爬虫读到的正文与内链没少，Vue 挂载后页面上看不到。
  组件文件还在仓库里（`git checkout c8bb9a5^ -- src/components/home/HomeContent.vue` 能取回）
- **首页入口默认进新手版**：「选择图片」/「没有图片？从免费素材开始」/ 拖图全部指向
  `/create`（操作台）。向导第 ① 步本来就取 `pendingUpload` 的文件（`BeginnerSelect.vue`
  的 `onMounted` + `watch(pendingFile)`），所以拖进来的图不用再选一次；
  「从免费素材开始」带 `?tab=library`，第 ① 步直接打开「免费素材」那一栏
  （`BeginnerSelect.vue` 新读 `route.query.tab`）
- **站点页脚挪到首页**：操作台底部那条三栏页脚（logo + 三组链接 + 版权行）挪到首页；
  首页原来的 Figma 紧凑页脚（`.homeFoot`）一并去掉（两个页脚叠在一起会重复）。
  实现：`App.vue` 的 `showFooter` 去掉 `route.name !== 'home'` 的排除，改成认
  `meta.noFooter`；`/create` 加 `meta.noFooter: true`（操作台是工具页，不挂页脚，
  和 `/editor` 一样干净）。⚠️ 别用 `meta.studio` —— 它还会顺带收起左侧栏
- **上传卡片仍然落在首屏中线**：hero 高度改成「视口 - 顶栏」，下内边距多留 72px
  （顶栏正好 72px，被这 72px 抵消 ⇒ 卡片中心 = 首屏中线），页脚从首屏以下才开始，
  不会出现「页脚被切一半」的观感。实测（线上）：2554×1206 / 1920×1080 / 1440×900 /
  1280×800 差 **0px**，1366×768 差 9px（矮屏按设计）
- 自检跟着改：
  - `verify-beginner.cjs` 增 6 条断言（首页首屏以下没有内容区、首页有站点页脚、
    「选择图片」href = `/create`、「从免费素材开始」href = `/create?tab=library`、
    操作台底部没有站点页脚、首页无横向溢出）
  - `verify-seo-v3.cjs` 首页断言从「内容区回来了（5 个块）」改成「首屏以下不渲染长文内容区」
    +「站点页脚在主视觉之后」（原来那条「内容区有步骤/功能/FAQ/分类」删掉 ——
    内容区的断言改由 head 段「原始 HTML 仍含长文正文」守着）
- 验证：线上 `verify-beginner.cjs --url` **97/97 通过**（console 报错 0）、
  `verify-seo-v3.cjs --url` **59/59 通过**、`audit.cjs --url` **84 项 0 错误**
  （只有 404 页自身那条 404，按设计）；线上产物哈希与本地构建一致
  （`assets/index-Dq2M9U9d.js`）
- 回滚：qq `/root/douwan-backups/dw-web-before-home-clean-20261026-162538.tar.gz`（前端）
- ⚠️ **这次也没有动后端**：SEO 壳的正文是后端渲染的，删的是页面上的那一块，
  服务端逻辑一行没改 ⇒ 不用在隔离 worktree 里跑后端测试

**已完成（2026-10-26 晚，第三次调整）——操作台第 ② 步预览图放大（电脑 / 平板端）（`pindoudou` `95894a6`，已上线）**

- 需求原文：「电脑和平板端这个预览图在整块的占比大一些，现在太小了」
  （截图 = 操作台 `/create` 第 ② 步「调整拼豆效果」，红框圈出灰色预览区里的拼豆效果图）
- **根因不是预览区太小，是画布按 1 格 = 1 CSS px 渲染**：`lib/render.js` 的 `drawPixels` 按
  `cell = floor(maxSize / max(宽,高))` 画，`prepareCanvas` 把 `el.style.width/height` 写成**行内 px**。
  原来 `max-size=520`，一张 234×312 的图纸就只画成 234×312 px，而预览区本身很宽 ⇒
  图缩在正中间一小块，四周大片空白（用户看到的「太小」）
- 改法（只动 `src/components/beginner/BeginnerAdjust.vue`）：
  - `PatternPreview` 的 `max-size` **520 → 640**（拼豆效果页签 + 对比页签里那张都改）
  - 新增 `@media(min-width:781px)`（**只在电脑 / 平板生效**）：
    - `.badj__stage{--preview-h:clamp(360px,60vh,660px)}`；`.badj__pane--pattern{height:var(--preview-h)}`
    - `.badj__pane :deep(canvas){width:auto !important;height:auto !important;max-width:100%;max-height:100%}`
      —— 用「auto + max 约束」等比放大，宽高比不变形
    - `.badj__canvasBox` / `.badj__pane` / `.badj__split .badj__pane` 的网格行写成 `minmax(0,1fr)`
  - **手机端（≤780px）的样式一行没动**，实测手机画布仍是 310×321 / 预览区 310×321
- ⚠️ **踩到的三个 CSS 坑（以后改这块必看）**：
  - 画布的宽高是**行内样式**（`prepareCanvas` 写的），优先级最高 ⇒ CSS 里必须带 `!important`，
    不带等于没改（写 `height:100%!important` 出现过「桌面画布 624px 溢出容器 512px 共 112px」）
  - **不能靠 `height:100%` 撑满**：画布固有高度比容器高时，网格行的基准尺寸会被它顶住，
    百分比解析不出来 ⇒ 换成「`width/height:auto` + `max-width/max-height:100%`」等比缩放
  - 网格行**必须**写 `minmax(0,1fr)`：行高一旦由内容决定，里面的 `max-height:100%` 就解析不出来。
    只给 `.badj__canvasBox` 加不够，`.badj__pane` 自身的行也要改（两层都要）
- 实测（线上，无头 Chrome）：
  - 桌面 2560×1227：画布 624×624 / 预览区 724×660 ⇒ 高占 95%、宽占 86%、面积占 82%
  - 平板 834×1112：画布 624×624 / 预览区 666×660 ⇒ 95% / 94% / 89%
  - 笔记本 1440×900：画布 540×540 / 预览区 724×540 ⇒ 100% / 75% / 75%
  - 改前对照：312 格的图纸只画成 312×312（约一半面积、宽占 43%）
  - 「原图」页签按原图自然尺寸显示（预览区高度随内容收缩）；「对比」页签两栏各 356×356
- 自检跟着改：`verify-beginner.cjs` 新增「预览图占比」断言（量 `.badj__canvasBox` 内容盒与
  `canvas` 的矩形，算高占 / 宽占 / 面积占比）—— ≥781px 断言**高占 ≥85% 且面积占 ≥40%**，
  手机端断言画布高度不超过预览区 105%
- 验证：线上 `verify-beginner.cjs --url` **102/102 通过**（mobile / tablet / desktop 各 34，console 报错 0）、
  线上 `audit.cjs --url` **84 项 0 错误**（只有 404 页自身那条 404，按设计）、0 横向溢出、0 空白画布；
  本地 `verify-beginner.cjs` 87/87；桌面 2560×1227 与平板 834×1112 两档真浏览器截图已肉眼核对
- 部署：qq 上先备份 `/root/douwan-backups/dw-web-before-preview-big-20261026-*.tar.gz`，
  再用 `C:\Windows\System32\tar.exe` 打包 `dist` → scp → 覆盖 `/var/www/dw.sharyuke.com`；
  线上 `index.html` 指向新产物 `assets/index-BLVkyKjP.js`（与本地构建同哈希）
- 交付文档：`pindoudou/docs/beginner.md` 新增小节「### 第 ② 步预览图为什么以前很小」
  （含根因、三个 CSS 坑、实测数字）

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
9. **SEO 平台等 Token 才能真正推送**（2026-10-25 上线，代码全就绪、通道全空）：
   百度普通收录 token、Bing IndexNow key、Google 服务账号 JSON 私钥，
   填到 qq 的 `/etc/douwan/api.env`（`DOUWAN_SEO_BAIDU_TOKEN` / `DOUWAN_SEO_INDEXNOW_KEY` /
   `DOUWAN_SEO_GOOGLE_CLIENT_EMAIL` / `DOUWAN_SEO_GOOGLE_PRIVATE_KEY` / `DOUWAN_SEO_GOOGLE_SITE`）
   后 `systemctl restart douwan-api`。步骤见 `pindoudou/docs/seo.md` §7 §8
10. **SEO 的 P2 项**：教程文章独立页与后台教程管理、自然搜索流量统计。都要等先有真实收录与排名数据才有对象
11. **WebP / AVIF 图片输出**：Go 标准库不能编码 WebP，要做需要引新依赖或走前端构建期转换
12. **搜索表现数据还没接**：Google 要服务账号 JSON 私钥 + 已验证站点（`DOUWAN_SEO_GOOGLE_CLIENT_EMAIL` /
    `DOUWAN_SEO_GOOGLE_PRIVATE_KEY` / `DOUWAN_SEO_GOOGLE_SITE`，已配就能自动拉曝光/点击/点击率/排名）；
    百度、Bing 走站长后台手动导出 CSV 导入。没接之前后台一律显示「暂无数据」
13. **还有 5 个分类没有已发布素材**（beginner / couples / cute / festivals / lifestyle；
    plants 已于 2026-10-25 深夜补上 5 张花束），
    对应关键词状态是「planned」，分类页标 noindex 不进 Sitemap；补素材后会自动转「已上线」
14. **线上临时管理员已清理干净**：`tmpseo2026`（V3.0 自检用）、`tmpseo20261026`（素材文案重算用，id 36）、
    `tmpasset1022`（并行会话遗留）、
    `tmp_mon_admin`（id 33）、`tmp_veg_uploader`（id 34）、`tmp_plant_uploader`（id 35）
    都已软删除并停用，只有真实管理员 `douwan`（id 1）能登录。
    ⚠️ 软删除的账号在 `admins` 表里还在（`deleted_at` 有值），用 SQL 查会看到，
    别误以为还有别的管理员能用；以后自检要用临时账号的话，用完记得删
15. **首页那批长文内容（FAQ / 功能说明 / 转换步骤）现在只存在于原始 HTML 里**（2026-10-26 晚
    按用户要求从页面上删掉了，首页与操作台都不渲染）。爬虫读得到、人看不到 ——
    要让它重新出现在页面上，就把 `HomeContent` 挂回 `HomeView.vue`，
    不要往操作台（`/create`）里塞，操作台是工具页
16. **服务端给 `/create` 的兜底标题重复**：「豆玩 DOUWAN · 豆玩 DOUWAN」（客户端接管后会改成
    「拼豆操作台 · 豆玩 DOUWAN」）。要一次到位就在 `douwan-api` 的
    `internal/service/seo.go` 的 `appRouteTitle()` 里加一条 `/create` 分支；
    改后端必须用 `douwan-api\.tmp\wt-*` 隔离工作区，测试放 home 上跑（见 §2.2）
