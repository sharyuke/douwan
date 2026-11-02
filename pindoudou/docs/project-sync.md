# 作品跨设备同步

> 交付时间：2026-10-27。需求：「三个端口登录后保存的作品不能同步，同一账号的保存作品要同步」。

## 以前为什么不同步

「我的作品」只写浏览器 `localStorage`（`douzao-projects-v2`）。手机、平板、电脑各有各的
`localStorage`，登录同一个账号也只是换了令牌，作品列表仍然是本机那一份 ——
新设备打开是空的，删掉的作品换台设备又回来了。

服务端本来就有 `projects` / `project_variants` 两张表，但没有任何接口读写它们。

## 现在的做法

作品以「前端存档 JSON」为单位按账号存到服务端，前端在登录 / 保存 / 删除时双向同步。

| 层 | 位置 | 作用 |
| --- | --- | --- |
| 接口 | `douwan-api`：`GET/PUT/DELETE /api/v1/projects[/:client_id]` | 按 `user_id` 隔离，`(user_id, client_id)` 唯一 |
| 存储 | `projects.payload`（`jsonb`） | 原样存前端紧凑存档，前端改字段不用改表 |
| 前端同步层 | `src/composables/useProjectSync.js` | 合并、上传、墓碑、状态 |
| 状态中枢 | `src/composables/useStudio.js` | `packedProjects()` / `applySyncedProjects()` / `onProjectsPersisted()` |
| 触发点 | `App.vue`（启动 / 登录后）、`useUserAccount.logout()`（退出前 flush）、`ProjectsView`（手动同步） | |

### 什么时候同步

- **打开网站 / 登录 / 换账号**：`App.vue` 在拿到账号后调 `syncProjects()`，拉服务端列表并与本机合并。
  `useProjectSync.js` 里还有一条 `watch(currentUser.id)`，覆盖 `bootstrapDevice()` 恢复登录的情形。
- **保存 / 改参数 / 记进度 / 完成作品**：`useStudio.persist()` 写完 `localStorage` 后回调
  `onProjectsPersisted()` → 900ms 防抖 → 只把有改动的作品 `PUT` 上去（不拉列表）。
- **删除**：本机先删，再记一条 tombstone 并立即补发 `DELETE`；离线删除会在下次同步时重试。
- **退出登录前**：`flushProjectSync()` 把还没推上去的改动发完再清令牌。
- **手动**：「我的作品」页右上角「立即同步」，旁边一行显示同步状态与最近同步时间。

### 合并规则

同一个 `id`（前端生成的 `p_xxx`）在两边都存在时，**取存档里 `updatedAt` 较新的那一份**；
本机较新就上传，服务端较新就下载覆盖本机。

服务端没有、本机有：

- 本机新增（或第一次同步 / 匿名账号转正式账号）→ 上传到账号。
- 本机以前同步过（在 `meta.items` 里）、且本机时间不晚于上次同步时间 → 判定为
  **别的设备已经删掉了**，从本机移除，不再传回去。

服务端有、本机没有：直接下载。

### 账号边界

- **未登录**：作品只在本机，页面写明「登录后会自动同步到账号」。
- **本机访客 → 真实账号登录**：把本机作品带进账号（用户在本机做了半天图，登录后不该看到空白列表）。
- **真实账号 A → 真实账号 B**：本机这份属于 A，不能塞进 B；列表以 B 的服务端作品为准，
  换账号前给 A 的本地副本留一份小备份（`douzao-projects-v2:switched`，超过 1.5 MB 不备份，
  避免备份本身吃掉配额）。

### 本机键位

| 键 | 内容 |
| --- | --- |
| `douzao-projects-v2` | 作品存档（紧凑格式，与以前一致，老数据可直接读） |
| `douzao-projects-sync-v1` | `{ userId, anonymous, lastSyncAt, items }`：账号、上次同步时间、每件作品已同步到的时间 |
| `douzao-projects-tombstones-v1` | 待补发的删除 `[{ id, userId, at }]` |
| `douzao-projects-v2:switched` | 换账号前的本地副本备份 |

### 配额

`applySyncedProjects()` 按 `LS_SAFE_CHARS`（4.6M 字符）裁剪：装不下时先保住能装的作品，
并在界面上写明「N 件作品暂未下载」；写入失败会回滚到写入前的列表，不会把本机作品弄丢。

## 怎么验

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm build
node scripts/build-seo-pages.mjs

# ① 对着 mock 接口（默认，端口 4412；无需数据库）
node scripts/verify-project-sync.cjs

# ② 对着真实后端（本地 Go 服务 + 真 PostgreSQL，端口按实际改）
$env:SYNC_BASE_URL='http://127.0.0.1:4413'
node scripts/verify-project-sync.cjs
```

脚本用真 Chrome（CDP）跑三档视口，覆盖：电脑端登录 → 生成图纸 → 保存 → 服务端出现存档 →
「我的作品」显示「已同步到账号」；平板 / 手机清空 `localStorage` 重新登录 → 作品自动下载；
手机端删除 → 服务端归零；电脑端再登录 → 确认已删。每次跑用一个随机新账号
（`sync<时间戳>`），不会污染既有数据。

## 已知边界

- 服务端只做「按 id 后写覆盖」，冲突消解在前端按 `updatedAt` 做；两台设备同时改同一件作品时，
  后同步的一方会覆盖先同步的一方（同一件作品的多端实时协作不在本次范围）。
- 同步的是作品存档，不含「我的库存」与收藏（仍是本机数据）。
- 未登录状态下的作品只在本机；清浏览器数据会丢（登录后已同步到账号的不受影响，下次登录会下载回来）。
