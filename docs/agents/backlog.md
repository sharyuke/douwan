# 待办

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §5 的待办。条目会过时，动手前先对一下代码和线上。

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
17. **作品同步的冲突策略是「同一件作品后写覆盖」**（按存档 `updatedAt` 在客户端选较新的一份）。
    两台设备同时改同一件作品时，后同步的一方会覆盖先同步的一方；要做真正的多端合并得拆到
    格子级冲突消解，目前没这需求。另外同步只覆盖作品，**库存与收藏仍是本机数据**
