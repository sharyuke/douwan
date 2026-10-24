# 前端架构侦察报告（只读）

- 侦察对象：`.mirror/pindoudou`（Vue 3.5 + Vite 6 + vue-router 4，hash 路由，纯前端 SPA）
- 下文所有 `src/...` 路径均相对 `C:\Users\sharyuke\Documents\work\douwan\.mirror\pindoudou\`
- 只读侦察，未修改任何文件；未在 home 上跑 build
- 镜像新鲜度核对（`ssh home`，只读）：home 的 HEAD 为 `c3588b9 feat(admin): 后台前端合并到最新 master + 前台接入服务端`，
  `node_modules` 与 `dist` 都在；该提交的改动文件清单与镜像一一对应（37 个文件），镜像未见落后。
  镜像行数与 home 文件略有差异（如 `cartoon.js`、`EditorSidebar.vue`），行号引用以**镜像文件**为准。

---

## 1. 项目结构 / 路由 / 页面清单

### 1.1 目录树（`src/`，共 9 个子目录）

```
src/
  main.js                 入口 + window.__douzao 调试桥（main.js:23-113）
  App.vue                 外壳：顶栏 / RouterView / 页脚 / 移动标签栏 / Toast
  router/index.js         hash 路由表 + 后台守卫 + 懒加载失败兜底
  assets/                 logo-douwan.webp
  lib/                    color.js palettes.js beadPrice.js pattern.js matte.js cartoon.js
                          render.js exporters.js forge.js api.js adminApi.js archive.js
  composables/            useStudio useMembership useInventory useBeadPrice useAssets
                          usePrompt useToast useBackend useUserAccount useAdminAuth
                          useAdminKit useAdminConfirm usePatternCanvas useSectionNav
  components/
    layout/               AppHeader AppFooter MobileTabbar
    ui/                   BaseDialog PatternPreview AssetCard ToastHost Icon CardRedeemPanel
    editor/               EditorCanvas EditorSidebar EditorInsights
    admin/                AdminLayout AdminTable AdminPager AdminModal AdminTag
                          ConfirmHost adminNav.js
  views/                  13 个前台页 + NotFoundView + admin/(11 个后台页 + _SPEC.md)
  data/                   palette.js assets.js tools.js icons.js（palette/assets 脚本生成，勿手改）
  styles/                 global.css（设计令牌 + 全站组件样式）admin.css（后台样式）
```

### 1.2 路由表（hash 模式）

`src/router/index.js:8` 用 `createWebHashHistory()`；路由数组 `src/router/index.js:40-93`。

| 路径 | name | 组件 | meta |
| --- | --- | --- | --- |
| `/` | home | HomeView | title（`router/index.js:41`） |
| `/home` → `/` | — | redirect | `:42` |
| `/create` → `/editor` | — | redirect（保留老链接，带 query） | `:46` |
| `/editor/:projectId?` | editor | EditorView | `studio:true`，`:47` |
| `/library`、`/library/:slug` | library / asset | LibraryView / AssetDetailView | `:48-49` |
| `/projects`、`/projects/:id` | projects / project | ProjectsView | `:50-51` |
| `/materials/:projectId?` | materials | MaterialsView | `:52` |
| `/build/:projectId?` | build | BuildView | `:53-56` |
| `/inventory` | inventory | InventoryView | `:57` |
| `/pricing` | pricing | PricingView | `:58` |
| `/account` | account | AccountView | `:59` |
| `/settings` | settings | SettingsView | `:60` |
| `/help` | help | HelpView | `:61`；`/about`、`/blog` 都 redirect 到它（`:62-63`） |
| `/tools/:slug` | tool | ToolView（SEO 长尾页） | `:64` |
| `/admin/login` | admin-login | AdminLoginView | `admin:true, adminPublic:true`，`:69-74` |
| `/admin`（父） | — | AdminLayout | `admin:true`，`:75-91` |
| `/admin`（子 ''） | admin-overview | AdminOverviewView | `perm:'overview.view'`，`:80` |
| `/admin/plans` | admin-plans | AdminPlansView | `perm:'plan.manage'`，`:81` |
| `/admin/cards` | admin-cards | AdminCardsView | `perm:'card.view'`，`:82` |
| `/admin/orders` | admin-orders | AdminOrdersView | `perm:'order.view'`，`:83` |
| `/admin/assets` | admin-assets | AdminAssetsView | `perm:'asset.view'`，`:84` |
| `/admin/users` | admin-users | AdminUsersView | `perm:'user.view'`，`:85` |
| `/admin/settings` | admin-settings | AdminSettingsView | `perm:'setting.view'`，`:86` |
| `/admin/logs` | admin-logs | AdminLogsView | `perm:'log.view'`，`:87` |
| `/admin/admins` | admin-admins | AdminAdminsView | `perm:'admin.manage'`，`:88` |
| `/admin/forbidden` | admin-forbidden | AdminForbiddenView | 无 perm，`:89` |
| `/:pathMatch(.*)*` | notfound | NotFoundView | `:92` |

其他路由机制：

- 后台守卫 `src/router/index.js:113-130`：`meta.admin && !adminPublic` → 动态 `import useAdminAuth` →
  `bootstrap()` → 未登录跳 `/admin/login?redirect=`；`meta.perm && !can(perm)` 跳 `/admin/forbidden?perm=&from=`。
  注释明确「前端拦一层只为体验，写权限由服务端判定」（`:110-111`）。
- 懒加载 chunk 加载失败兜底 `src/router/index.js:138-146`（`toastErr`，区分 chunk 失败与其它错误）。
- `document.title` 统一在 `afterEach`（`:148-151`）。
- `App.vue:17,20` 用 `meta.studio` / `meta.admin` 决定是否渲染站点页脚与前台顶栏/标签栏。

**页面清单（前台 13 + 404）**：首页、工作台（EditorView = 唯一创作页，创建/设计合一）、素材中心、素材详情、
我的作品、作品详情、材料与分板、拼制与完成、我的库存、会员与定价、我的账户、设置、帮助、SEO 工具页、404。

---

## 2. 工作台状态中枢 `src/composables/useStudio.js`

文件实际行数：grep 探针显示 2169 行（`wc -l` 计 1829，差异来自计数工具对超长行的处理）；共 **110 个 export**。

### 2.1 公开 API 分组（state / actions，均为模块级单例）

| 分组 | 导出（行号） |
| --- | --- |
| 参数 state | `options`（reactive，`:65-91`，深度 watch 落盘 localStorage `:93-99`）；`MAX_CELLS=1000`（`:37`） |
| 核心 state | `sourceImg` shallowRef（`:103`）、`sourceUrl`（`:104`）、`sourceName`（`:105`）、`sourceKind` raster/vector（`:107`）、`sourceAspect`（`:114`）、`variants` shallowRef（`:125`）、`activeKey`（`:126`）、`preferDetail`（`:133`）、`generating`（`:134`）、`genMs`（`:135`）、`projectName`（`:136`）、`saveStatus`（`:137`）、`currentView`（`:138`）、`zoom`（`:139`）、`tool`（`:140`）、`brushColorId`（`:141`）、`selectedBoard`（`:142`）、`canvasEl`（`:143`）、`lastSearch`（`:146`） |
| 派生 | `width`/`height`（`:153-154`）、`maxCells`（`:159`）、`canvasOverSource`（`:179`）、`pattern`（`:193`）、`activeVariant`（`:199`）、`hasPattern`（`:201`）、`brand`（`:203`）、`availableColors`（`:206`）、`paletteLimited`（`:208`）、`materials`（`:395`）、`layout`（`:398`）、`stats`（`:399-433`）、`variantCount`（`:854`） |
| 抠图 | state：`options.removeBg`（`:77`）、`options.matteLevel`（`:79`）；派生：`matteInfo`（`:215-270`）、`matteLevels`（`:273`）、`currentMatteLevel`（`:274`）；动作：`setRemoveBg(on)`（`:280`）、`setMatteLevel(key)`（`:286`） |
| 卡通 | state：`options.cartoon`（`:84`）、`options.cartoonStyle`（`:86`）；派生：`cartoonStyles`（`:295`）、`currentCartoonStyle`（`:296`）、`cartoonInfo`（`:307-332`）、`cartoonPreviewUrl`（`:364`）、`previewMode`（`:365`）；动作：`setCartoon(on)`（`:339`）、`setCartoonStyle(key)`（`:351`）、`refreshCartoonPreview()`（`:368`） |
| 撤销重做 | `canUndo`（`:474`）、`canRedo`（`:475`）、`undoDepth`（`:477`）、`redoDepth`（`:478`）、`beginEdit`（`:524`）、`endEdit`（`:533`）、`cancelEdit`（`:551`）、`undo`（`:633`）、`redo`（`:654`） |
| 编辑 | `paintAt`（`:747`）、`fillAt`（`:780`）、`replaceColorEverywhere`（`:820`）、`pickAt`（`:841`） |
| 生成 | `yieldForBusyPaint`（`:874`）、`regenerate({silent,keys})`（`:881-995`）、`regenerateActive`（`:998`）、`selectVariant`（`:1051`）、`optimizeBuildability`（`:2150`，Pro 门禁在 `:2151-2155`）、`restoreVariant`（`:2165`） |
| 源图载入 | `loadImageSource`（`:1060`）、`ensureDrawable`（`:1091`）、`fileToImage`（`:1117`）、`svgToImage`（`:1157`）、`useImageFile`（`:1190`）、`useAsset`（`:1295`）、`loadImageFromUrl`（`:2095`）、`photoToStoredUrl`（`:2074`） |
| 项目存档 | `projects`（`:1329`）、`projectLimit()`（`:1405`）、`saveProject`（`:1409`）、`currentProjectId`（`:1496`）、`ensureProjectLoaded`（`:1519`）、`openProject`（`:1525`）、`deleteProject`（`:1626`）、`duplicateProject`（`:1633`）、`currentProject`（`:1886`） |
| 拼制/完成 | `buildProgress`（`:1746`）、`buildBoard`（`:1748`）、`buildStats`（`:1750`）、`buildBoards`（`:1794`）、`toggleBuildCell`（`:1816`）、`markBuildCell`（`:1823`）、`markBoard`（`:1831`）、`markColor`（`:1849`）、`clearBuild`（`:1863`）、`persistBuildProgress`（`:1868`）、`finishedAt`/`isFinished`/`finishPhoto`/`finishDeducted`（`:1889-1894`）、`patternSignature`（`:1903`）、`currentSignature`（`:1921`）、`finishStale`（`:1923`）、`finishPlan`（`:1942`）、`finishProject`（`:1970`）、`unfinishProject`（`:2025`）、`attachFinishPhoto`（`:2058`） |
| 工具 | `resetZoom`（`:2107`）、`setZoom`（`:2111`）、`zoomBy`（`:2119`）、`setCanvasSize`（`:2129`） |

消费方（`grep` 全量）：`App.vue:9`、`useAssets.js:15`、`EditorSidebar.vue:4-12,18`、`EditorCanvas.vue:9`、
`EditorInsights.vue:8`、`EditorView.vue:12`、`MaterialsView.vue:8`、`ProjectsView.vue:8`、`SettingsView.vue:5`、
`InventoryView.vue:15`、`AccountView.vue:12`、`BuildView.vue:12`、`AppHeader.vue:6`。

### 2.2 图片是怎么进来的（**四条，没有粘贴、没有 URL 输入**）

1. **本地文件选择**：`EditorSidebar.vue:609` 的 `<input ref="fileInput" type="file" accept="image/*" @change="onFile">`
   → `onFile`（`:395-408`）→ `useImageFile(file)`（`useStudio.js:1190`）
   → `fileToImage`（`:1117`，校验必须是 `image/*` 且 ≤12MB，`:1119-1126`）→ `loadImageSource`（`:1060`）→ `autoFitForSource`（`:1228`）→ `regenerate()`。
2. **拖拽落图**：`EditorSidebar.vue:571-581` 的 `.upload` 区域 `@drop.prevent="onDrop"` → `onDrop`（`:410-423`）→ 同一个 `useImageFile`。
3. **免费素材库（SVG 矢量）**：`EditorSidebar.vue:636-645` 的 `onPickAsset`（`:434-441`）→ `useAssets.js:94` `pickAsset(id)`
   → `check('assets.pro')` 门禁（`useAssets.js:100-104`）→ `useAsset(asset)`（`useStudio.js:1295`）→ `svgToImage`（`:1157`）→ `loadImageSource(..., 'vector')`。
   素材详情页同样走 `pickAsset`。
4. **打开本机存档时重建源图**：`openProject`（`:1525`）把 `sourceImg/sourceUrl` 清空（`:1562-1563`），
   再由 `rebuildThumbSource`（`:1587-1624`）用当前图案画一张 canvas 当源图。

**没有** `paste` / `clipboard` 取图逻辑（全仓 `grep paste|clipboard` 只命中 `navigator.clipboard.writeText` 的复制文本，
见 `exporters.js:337`、`useAdminKit.js:144-145`），**也没有**「图片 URL 生成」入口。
`usePrompt` 的 AI 文字入口走的是素材匹配（见 §3），不是图片。

### 2.3 原图存在哪 / 转换结果在哪

- 原图 = **`HTMLImageElement` + `objectURL` 的组合**，不是 File、不是 base64：
  `fileToImage` 里 `URL.createObjectURL(file)`（`useStudio.js:1127`）+ `new Image()`（`:1128`，`decoding='sync'`），
  由 `loadImageSource` 存进 `sourceImg`(shallowRef) / `sourceUrl`(`:1060-1064`)。
  SVG 素材同理走 `URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}))`（`:1170`）。
- objectURL 只在解码失败时 revoke（`:1136`、`:1141`）；「成品照片」压缩时也会 revoke（`:2090`）。
- 需要 dataURL 的场景只有三处：卡通预览图 `canvas.toDataURL('image/png')`（`:386`）、
  存档重建源图（`:1613`）、成品照片压缩成 JPEG dataURL（`:2088`）。
- **转换结果**：`variants`（`shallowRef`，最多 3 个方案，`useStudio.js:125`）→ 当前图案 `pattern`（`:193`）。
  每个 pattern 含 `cells`(Int32Array 调色板下标) + `palette` + `stats` + `matte` 元数据 + `cartoon` 元数据。
  `stats` 由 `recalcStats`（`:671-714`）逐格重算。
- 大画布走 `Int32Array` + 整份替换（`replaceCells` `:581-594`），刻意用 `shallowRef` 避免 20 万格被 Proxy 化（`:117-124` 有完整理由）。

### 2.4 `src/lib/matte.js` 现在怎么被调用

- **matte.js 只有 4 个公开 API**：`MATTE_MAX_SIDE=384`（`:60`）、`MATTE_MAX_SIDE_LIMIT=1024`（`:70`）、
  `matteMaxSide`（`:76`）、`MATTE_LEVELS`（`:114-130`，soft/normal/strong 三档，label 为「保守/标准/激进」）、
  `matteLevel(key)`（`:132`）、`estimateMatte(src, sw, sh, opts)`（`:334`）。
- **调用点 1（出图主链路）**：`options.removeBg` + `options.matteLevel` 由 `regenerate`（`useStudio.js:907-908`）
  与 `regenerateActive`（`:1025-1026`）传给 `pattern.js` 的 `generateVariant`，抠图在 `pattern.js` 内部真正执行。
- **调用点 2（生成前预估主体包围盒）**：`autoFitForSource`（`useStudio.js:1239`）在源图自带透明通道时调
  `estimateMatte` 取 `bbox` 来定 `sourceAspect`（`:1240-1243`）。
- **调用点 3（调试桥）**：`main.js:35` 把整个 matte 模块挂到 `window.__douzao.matte`。
- **UI 入口（现有「智能抠图」）**：`EditorSidebar.vue` 的「图片处理」三选一（原图 / 智能抠图 / 卡通风格）：
  - 三格按钮组 `.procTabs`（`:656-675`，第三个按钮文案 `✂ 智能抠图` + `突出主体`，`:668`）；
  - 手机端同一状态的原生下拉 `.mDrop--proc`（`:676-685`，option 文案 `✂ 智能抠图 · 突出主体`，`:682`）；
  - 选中后展开的三档力度 `.matteBar__levels`（`:688-698`，按钮 title 用 `l.hint`）；
  - 结果说明 `.matteBar__note`（`:697`）读 `matteInfo.text`（`useStudio.js:215-270`）。
  - 状态机 `processMode` computed（`EditorSidebar.vue:92-117`）：**三选一互斥**，选抠图会清掉卡通；
  - 未上传图时点抠图只记状态并 toast 警告（`:455-463` → `:459`）；
  - 换档 `onMatteLevel`（`:465-468`）→ `setMatteLevel` → 立刻 `regenerate`（`useStudio.js:286-290`）。
  - 样式：`.matteBar__levels .seg.on` 用 `--sky` 天蓝（`EditorSidebar.vue:1085-1091`）。

### 2.5 生成链路的一次调用（新入口要复用的最短路径）

`regenerate()`（`:881`）→ `runVariants`（`pattern.js` 的 `generateVariants`）→ 库存约束 `applyInventory`（`:919`）
→ 推荐打分与 `preferDetail` 覆盖（`:923-946`）→ `variants.value = list`（`:948`）→ 必要时清拼制进度（`:954-961`）
→ `clearHistory()`（`:969`）→ `trackUsage('generated')`（`:972`）→ toast 汇总（`:973-986`）。

---

## 3. 现有 AI / 卡通相关入口（grep `卡通|cartoon|AI|智能|风格`）

**结论：卡通化（本地确定性算法）已经完整落地并接到了出图主链路；「AI」目前全部是文案/占位，没有任何模型调用；
「图生图 / 本地 AI 抠图模型 / 文生图」都不存在。全仓无 `onnx|webgpu|wasm|Worker|OffscreenCanvas` 命中。**

### 3.1 卡通（本地算法，已上线）

- 引擎：`src/lib/cartoon.js`（镜像 1003 行 / 探针 1214 行），`CARTOON_STYLES` 三档在 `:122-181`
  （soft 轻度 / standard 标准 / flat 简约平涂），`cartoonize(rgba, sw, sh, opts)` 在 `:981`，`CARTOON_MAX_SIDE=768`（`:83`）。
- 接线：`main.js:10` 导入、`:31` 挂 `window.__douzao.cartoon`、`:53,59,63,67` 的调试桥 `make/makeFromImage` 都接受 `cartoonStyle`。
- 出图：`useStudio.js:910`（`cartoonStyle: options.cartoon ? options.cartoonStyle : ''`）、`:1027`（同）。
- UI：`EditorSidebar.vue:669-674`（`🎨 卡通风格` 三格按钮）、`:683`（手机下拉）、`:700-711`（三档风格 `.cartoonBar__levels`，选中色 `--purple` `:1092-1093`）、
  `:596-606`（缩略图上的「原图 / 卡通」对照开关）、`HelpView.vue:103-111`（教程）、`SettingsView.vue:249-257`（默认卡通化 + 风格）。
- 跑分脚本：`scripts/fidelity/cartoon-bench.mjs`、`package.json:15`（`fidelity:cartoon`）、`package.json:27`（`verify:cartoon`）。

### 3.2 「AI」现状清单（都是文案或占位）

| 位置 | 性质 |
| --- | --- |
| `EditorSidebar.vue:73`、`:612-632` | 「✨ AI 文字创作」页签（三条来源之一），输入框 + 生成按钮（`:620` 的 `:disabled="promptBusy"`）+ 关键词 chips（`:624-626`） |
| `EditorSidebar.vue:628-631` | **明确的占位说明**：「文字生图的服务端模型还没接入：现在会按关键词匹配平台素材，保证点了有结果；接入后按 Credits 计费。」 |
| `usePrompt.js:1-7` | 文件头写明「现状说明（诚实告知，不假装已经接了大模型）…正式接入后，这里改成调用 `POST /api/ai/generate` 并按 Credits 计费」 |
| `usePrompt.js:21` | `AI_COST_PER_CALL = 8`（与 `useMembership.js:222` 的 `CREDIT_COST['ai.text']=8` 重复定义） |
| `usePrompt.js:60-95` | `runPrompt()` 实际做的是 `matchByKeywords`（`:28-37`）+ `fuzzyMatch`（`:40-53`）匹配本地 `data/assets.js` |
| `usePrompt.js:102-114` | `generateMoreDirections()` 是**显式占位**：门禁 `check('ai.text')` → Credits 校验 → `toastWarn('AI 生图服务尚未接入…')` → `{ok:false, notReady:true}` |
| `EditorSidebar.vue:844-866` | 「✦ AI 优化」按钮 —— 实为 `optimizeBuildability()`（关抖动/去孤立豆/收敛色数），**不是 AI**，Pro 门禁 |
| `HomeView.vue:378-393` | 首页「✨ 或者直接说一句：你想拼什么？」入口 + `:383` 的「AI 生图接入后直接出图」说明 |
| `PricingView.vue:106,133,170-175,322,334` | 「AI 推荐 / AI 文字生成图案 / AI Credits / 高级 AI 模型」等营销与计费文案 |
| `SettingsView.vue:349-353`、`PricingView.vue:175` | 隐私承诺：「基础图片转拼豆完全在浏览器本地完成」「目前这些功能尚未接入，因此现在没有任何图片离开你的设备」 |
| `AdminSettingsView.vue:160,190` | 后台「AI 成本告警」是预留配置项，无数据 |
| `douwan-api` 侧 | `README.md:211` 把「一句话创作接真实模型」列为待办；`docs/api.md:348-360` 已定好可上报功能点 `ai.text` / `ai.variants` / `ai.batch` |

**没有任何「AI 生成」的图片占位 UI**（没有 loading 骨架、没有 quota 面板、没有任务轮询）——
现有 AI 入口的失败路径只有三种：关键词未命中（`usePrompt.js:72-76`）、
会员素材被锁（`:79-86`）、Credits 不足（`:108-111`），全部走 `promptMsg` 文案。

---

## 4. 会员与权益

### 4.1 `src/composables/useMembership.js`（340 行）

- 文件头就是硬约定（`:1-6`）：**「权限通过 entitlement 统一控制，不在前端简单隐藏按钮」→
  「先判定 → 拿到拒绝原因 → 由调用方决定提示文案与升级引导，按钮始终可见可点」**。
- 套餐：`PLANS`（`:19-69`，free / pro 两档，features 数组带 `on:true|false`）。
- 状态（全部 localStorage）：`plan`（`:72`）、`credits`（`:73`，默认余额 30）、`usage`（`:74`）。
- `isPro`（`:95-99`，含到期判定）、`planLabel`（`:101`）、`creditsBalance`（`:103`）。
- **权益矩阵** `ENTITLEMENTS`（`:108-141`）：键 → `{free, pro}`，值可以是 `true/false/数字/Infinity`。
  现有 AI 相关键：`CREDIT_COST = {'ai.text':8,'ai.variants':3,'ai.batch':20}`（`:220-224`），
  但 **`ENTITLEMENTS` 里没有 `ai.*` 键**（`aiGate = check('ai.text')` 在 `usePrompt.js:55` 因此永远 `ok:true`）。
- **判定**：`check(feature, amount=1)`（`:164-176`）→ `{ok, reason?, value?, limit?}`；`can(feature, amount)`（`:178-180`）。
- **升级文案表** `DENY_REASON`（`:144-158`）：每个受限权益一条中文原因，`check` 在拒绝时取用（`:169,173`）。
- Credits：`spendCredits(cost, note)`（`:226-240`，不足时返回 `{ok:false, reason}`，成功写 `usage.aiCalls+1`）、
  `addCredits`（`:242`）、`trackUsage(key)`（`:250`）。
- 升降级：`upgradeTo`（`:257`）、`setYearly`（`:269`）、`cancelPlan`（`:277`）、`refreshEntitlement`（`:283`）。
- 服务端同步：`applyServerMembership`（`:309-319`）、`applyServerPermissions`（`:328-334`，**只覆盖键已存在的项**）、
  `applyServerCredits`（`:337-340`）。

### 4.2 现有「按钮不隐藏、点不动给原因」写法（新 AI 入口必须照这个模式）

1. **工具函数式**（工作台内部）：`EditorSidebar.vue:364-365` 用 `computed(() => check('optimize.buildability'))`，
   点击时（`:425-432`）先 `toastWarn(gate.reason)` 再 `emit('need-pro', gate.reason)`；
   同款用于库存（`:534-535`）与精细档（`:249`）。
2. **统一升级弹窗**：`EditorView.vue:32-35` 的 `needPro(reason)` → `proOpen=true`；模板 `:230-243`：
   `BaseDialog` 标题「升级 Pro 解锁这个功能」、正文 = 原因、
   `:238` 显示「AI Credits 余额」、footer 是「先不用」+ `<RouterLink to="/pricing">查看 Pro 权益 ›`。
   `EditorSidebar` 通过 `emit('need-pro')`（`EditorView.vue:195`）、`EditorInsights` 同样（`:228`）接入。
3. **导出类按钮**（永不隐藏、加锁标、点了再说）：`EditorView.vue:222`
   `{{ check(e.feature).ok ? '' : ' 🔒' }}`；`tryExport` 失败时 `needPro(gate.reason)`（`:152`）。
4. **行内升级链接**：`EditorSidebar.vue:789`（精细档）、`:870`（三方案）、`:935`（全色板）都是
   `<button class="inlineLink" @click="emit('need-pro', '…是 Pro 功能…')">升级解锁…</button>`。
5. **素材锁定**：`useAssets.js:88-113` `isLocked(asset)` + `pickAsset` 返回 `{ok:false, needPro:true}`，
   卡片照常显示（`AssetCard.vue` 只读 `isLocked`）。
6. **后台侧对应约定**：`_SPEC.md:156-157`「不能只隐藏按钮：没有权限时按钮保留但 `disabled`，
   并用 `title` 显示 `denyReason('…')`」；`useAdminAuth.js:38-63` 是 `denyReason` 实现。

### 4.3 新增一个 AI 功能入口要遵守的约定（清单）

- 在 `ENTITLEMENTS`（`useMembership.js:108`）**加一个功能键**（如 `ai.image`），免费版给数字额度而不是 `false`（若想给体验额度）。
- 在 `DENY_REASON`（`:144`）**加对应中文原因**，否则会落到兜底文案「该功能需要升级套餐。」（`:169`）。
- 在 `CREDIT_COST`（`:220`）加计费单价；扣费走 `spendCredits(cost, note)`（`:226`），失败要如实说「差多少」。
- 入口：**按钮始终渲染**；无权限/无额度时 `toastWarn(reason)` + `emit('need-pro', reason)`，不要 `v-if` 隐藏。
- 消耗前先门禁（现有范例 `usePrompt.js:102-113` 的顺序：门禁 → 额度 → 才动手）。
- 若走服务端权益，键必须同时存在于服务端权限矩阵，否则 `applyServerPermissions` 会忽略它（`:328-334`）。

---

## 5. 服务端接入

### 5.1 统一 API 客户端 `src/lib/api.js`（404 行）

- **baseURL：硬编码的同源相对路径 `const BASE = '/api/v1'`**（`:9`）。
  **全仓 `grep import.meta.env|VITE_` 零命中** —— 没有环境变量、没有配置文件、没有 baseURL 注入点。
  开发期靠 `vite.config.js:10-13` 的 proxy（`/api` 与 `/uploads` → `http://127.0.0.1:8080`），
  线上靠 nginx 同源反代 `dw.sharyuke.com/api/v1`（见 AGENTS.md 部署段）。
- 业务码表 `CODE`（`:12-34`）；错误类 `ApiError`（`:40-59`），带 `code/status/requestId/data` 与
  `needLogin`（`:51`）/ `forbidden`（`:56`）两个语义 getter。
- **令牌区分**：`class TokenBox`（`:67-105`）+ 两个实例
  `adminTokens = new TokenBox('douwan-admin')`（`:107`）、`userTokens = new TokenBox('douwan-user')`（`:108`）；
  存 localStorage，键名分别是 `douwan-admin-tokens` / `douwan-user-tokens`（`:69`）。
  `request()` 默认 `tokens = userTokens`（`:133`），全部带 Authorization: Bearer（`:143-144`）。
  刷新路径按令牌归属分流：`isAdmin ? '/admin/auth/refresh' : '/auth/refresh'`（`:263-264`）。
- **核心请求** `request(path, opts)`（`:128-205`）：401 且有 refresh → `refreshTokens` 后重放一次（`:165-171`）；
  并发刷新去重（`refreshInFlight`，`:113,258-286`）；`raw:true` 返回 Response（下载用，`:173-178`）；
  **`envelope.code !== 0` 一律抛 `ApiError`**（`:196-203`），调用方只处理异常。
- 上传 `upload(path, formData, {onProgress, signal})`（`:208-246`，XHR 带进度，**默认 `tokens=adminTokens`**）。
- 下载 `download(path, body)`（`:249-253`，同样默认 admin）。
- 格式化与工具：`money`（`:348`）、`moneyPlain`（`:354`）、`datetime`（`:362`）、`fromNow`（`:373`）、`fileSize`（`:390`）、
  `syncQuery(router, route, patch)`（`:398`，把筛选同步到地址栏）。
- 便捷方法 `api = {get,post,put,patch,del}`（`:337-343`）。

### 5.2 后台接口封装 `src/lib/adminApi.js`（164 行）

- 一律 `const opts = extra => ({ tokens: adminTokens, ...extra })`（`:10`）——**后台接口全部带后台令牌**。
- 命名空间：`authApi`（`:14-30`）、`overviewApi`（`:34-36`）、`planApi`（`:40-51`）、`cardApi`（`:55-67`）、
  `orderApi`（`:71-78`）、`assetApi`（`:82-106`，含 `upload`/分类）、`userApi`（`:110-116`）、
  `settingApi`（`:120-123`）、`logApi`（`:125-127`）。
- **前台也能用的公开接口**：`publicApi`（`:132-138`），一律 `auth:false`：
  `/plans`、`/settings/public`、`/assets`、`/assets/:slug`、`/assets/categories`。
- `saveBlob`（`:143-153`）、`toCSV`（`:156-163`）。

### 5.3 前台与后端衔接

- `src/composables/useBackend.js`（186 行）：`ensureBackend()`（`:31-56`）用 `publicApi.plans()` + `publicApi.settings()`
  一次探测填 `backendReady/backendError/serverPlans/siteSettings`；`recheckBackend`（`:59`）手动重试。
  卡密兑换 `redeemCard`（`:80-96`，未登录返回 `needLogin`）、`createOrder`（`:122`）、
  服务端素材 `loadServerAssets`（`:138`）/`loadServerCategories`（`:155`）/`toFrontAsset`（`:167-184`）。
  **设计原则写在文件头（`:1-6`）：「接口不可用时回落到本地演示数据，保证前台不会被后台拖挂」**。
- `src/composables/useUserAccount.js`（121 行）：前台账号，用 `userTokens`；`bootstrapUser`（`:26-52`）、
  `register`（`:55`）、`login`（`:72`）、`logout`（`:89`）、`requireLogin`（`:105`）、`updateProfile`（`:113`）。
  文件头 `:5` 明确「登录态与后台完全隔离：这里用 userTokens，后台用 adminTokens」。

### 5.4 错误处理与 Toast

- Toast 组件：`src/components/ui/ToastHost.vue`（渲染在 `App.vue:51`），状态在 `src/composables/useToast.js`：
  `toast(text, kind='', ms=2600)`（`:10`）、`toastOk`（`:19`）、`toastWarn`（`:20`）、`toastErr`（`:21`，3800ms）、
  `toastResult(res, fallback)`（`:32-36`，把导出回传的 `{ok,message}` 统一变提示）。
- 页面级错误惯例：`try { await api… } catch (e) { toastErr(e instanceof ApiError ? e.message : '加载失败，请重试') }`
  （规范写在 `views/admin/_SPEC.md:108-131`）。
- 后台统一动作用 `useAdminKit.js` 的 `run(fn, {ok})`（`_SPEC.md:50-57`，失败返回 `null` 且已弹提示）。

---

## 6. 后台前端

### 6.1 布局与导航注册

- 布局：`src/components/admin/AdminLayout.vue`（198 行）：左侧固定导航 + 顶栏（标题/副标题取自 `ADMIN_TITLES`）
  + 移动抽屉（`:146-170`）+ 修改密码弹窗（`:173-194`）+ `ConfirmHost`（`:196`）。
- **导航注册只有一处**：`src/components/admin/adminNav.js` 的 `ADMIN_NAV`（`:6-36`，按「经营 / 商品与交付 /
  内容与用户 / 系统」四组），每项 `{to, label, icon, perm, exact?}`；
  `ADMIN_TITLES`（`:39-49`）按 `to` 给顶栏标题与一句话说明。
- 可见性：`AdminLayout.vue:40-46` 的 `visible(item) = !item.perm || can(item.perm)`，
  再按组过滤空组 —— **无权限时后台导航项是隐藏的**（与前台「按钮不隐藏」是两套约定，见 `_SPEC.md:156`）。
- 复用零件：`AdminTable`（列定义 `{key,label,width,align,nowrap}` + `#cell-<key>` 插槽 + `loading`/`empty-*`）、
  `AdminPager`（`v-model:page` / `v-model:page-size`）、`AdminModal`、`AdminTag`（kind: ok|warn|danger|info|primary|muted）。
- **后台页面写作规范**：`src/views/admin/_SPEC.md`（198 行）——文件命名、`adm-` 前缀、页面骨架、
  `run()` 包装、二次确认 `confirmAction`、空态、格式化、禁用而非隐藏，以及「不要改 router / App.vue / components/admin/*」
  的禁止事项（`:194`，新增页面时这条按实际需要放宽，只加行不改结构）。

### 6.2 新增一个后台页面要改的文件清单（照现有 11 个页面的模式）

1. **新建** `src/views/admin/AdminXxxView.vue`（照 `_SPEC.md:61-106` 的骨架）。
2. `src/router/index.js`：顶部加 `const AdminXxx = () => import('../views/admin/AdminXxxView.vue')`（参照 `:29-38`），
   在 `children` 里加一条 `{ path: 'xxx', name: 'admin-xxx', component: AdminXxx, meta: { title: '…', perm: 'xxx.view' } }`（参照 `:80-89`）。
3. `src/components/admin/adminNav.js`：`ADMIN_NAV` 对应分组加 `{ to:'/admin/xxx', label:'…', icon:'…', perm:'xxx.view' }`（`:6-36`）；
   `ADMIN_TITLES` 加 `/admin/xxx`（`:39-49`）。
4. `src/lib/adminApi.js`：加一个命名空间（如 `export const activityApi = { … : () => api.get('/admin/xxx', opts()) }`，`opts()` 定义在 `:10`）。
5. `src/composables/useAdminAuth.js`：`denyReason` 的 `labels` 表（`:39-59`）加新权限点的中文名
   —— **`activity.view` 目前不在表里**，不加就会退化成显示原始键名。
6. `scripts/admin-audit.cjs`：`PAGES`（`:57-72`）加一行 `{ name, hash, expect:[…关键文案…], optional:true }`，
   并同步 `scripts/admin-audit.cjs:4` 注释里的「后台 9 个页面」计数。
7. （可选）`package.json` 加 `admin-audit` script —— **目前 `admin-audit.cjs` 没有被任何 npm script 引用**
   （`grep admin-audit` 只命中脚本自身），只能手敲 `node scripts/admin-audit.cjs`。
8. 服务端需先有接口与权限点（后端已具备则跳过）。

### 6.3 自检脚本用法

- `scripts/audit.cjs`（前台，568 行）：跑 `dist/`，起本地静态服务 + Chrome CDP。
  - **页面清单 `PAGES` 在 `scripts/audit.cjs:46-75`（21 项）**，视口 `WIDTHS` 在 `:77-84`（desktop 1440 /
    narrow3col 1320 / tablet 834 / mobile 390）——**README `:101` 写的「51 页 × 3 视口」已过期**。
  - 用法：`node scripts/audit.cjs`（默认页集）、`node scripts/audit.cjs /create /library`（按 hash 包含匹配，`:234-251`）、
    `--page <name>`（按 name 精确选）、`--setup-file` / `--eval-file`（探针）。
  - 支持 `AUDIT_OUT`、`AUDIT_PORT`、`AUDIT_WIDTHS`、`AUDIT_VIEWPORT_ONLY`、`AUDIT_CDP_TIMEOUT_MS`（`:19-26,86-91`）。
  - **强约束**：`assertFresh()`（`:114` 起）会校验 `dist/` 比 `src/` 新，忘了 build 会直接失败（`:95-99` 注释里说明了原因）。
- `scripts/admin-audit.cjs`（后台，378 行）：**页面清单 `PAGES` 在 `:57-72`（11 项，每项带 `expect` 关键文案）**，
  视口 `:74-77`（desktop/mobile）；需要环境变量 `ADMIN_USER` / `ADMIN_PASS` / `ADMIN_API_BASE`（`:30-31,9-11`），
  只把 `/api` 与 `/uploads` 反代到真实后端（`:88-100`），**只读、不做写操作**（`:16`）。
  运行时会真登录；`admin-login` 项放最后因为会清令牌（`:66-67`）。

---

## 7. 视觉规范（新入口保持一致）

### 7.1 设计令牌（唯一来源：`src/styles/global.css` 顶部 `:root`，`:9-95`）

- 品牌橙红：`--primary:#F03D2E`/`--primary-soft`/`--primary-deep`（`:11-13`）、`--grad:linear-gradient(135deg,#ff7a3d,#f5325b)`（`:15`）
- 语义色：`--coral`（`:19-21`）、`--orange`（`:23`）、`--yellow`（`:27`）、`--green:#1D8FA3`（`:32`，「成功/免费」用薄荷青）、
  `--sky:#3ECFE0`（`:36`，**抠图当前用它**）、`--pink`（`:40`）、`--purple:#8C7AE6`（`:44`，**卡通当前用它**）
- 中性与语义：`--bg/--surface/--surface-2/--surface-3`（`:55-58`）、`--line/--line-strong`（`:59-60`）、
  `--muted/--muted-2`（`:61-62`）、`--ok/--warn/--danger/--info`（`:63-70`）
- 马卡龙块：`--tint-peach/-yellow/-mint/-pink/-plain`（`:73-77`）
- 圆角 `--r-xs…--r-xl/--r-pill`（`:80`）、阴影 `--sh-1/2/3/--sh-hover/--sh-key`（`:81-85`）、
  缓动 `--ease/--t`（`:86-87`）
- 字号 `--fs-display…--fs-2xs`（`:90-91`，**下限 11px，PRD §44 硬要求**）、`--header-h:68px`、`--page-max:1360px`（`:93-94`）
- 键盘可达性：`:focus-visible{outline:2.5px solid #FFB4A2}`（`:116`）

### 7.2 可直接复用的 class（不要新造）

- 按钮：`.btn`（`:175-182`）+ 语义变体 `.primary`（`:185`）、`.ink`、`.green/.mint`、`.blue`、`.yellow`、`.pink`、
  `.soft`、`.ghost`、`.danger`；尺寸 `.sm`（`:203`）、`.lg`、`.icon`、`.block`、`.tiny`；
  `:disabled{opacity:.45;cursor:not-allowed}`（`:184`）
- 卡片：`.card`（`:213`）、`.card--flat`（`:217`）、`.card__head`（`:218`）、`.card__body`（`:237`）、`.card__body--tight`
- 表单与布局：`.stack` / `.stack--sm`（`:239-240`）、`.field` + `.field > label`（`:295-300`）、`.grid-2/3/4`
- 标签与芯片：`.tag`（`:348`）+ `.free/.pro/.hot/.new/.warn/.danger/.purple`（`:352-358`）、`.chip`（`:323-328`）
- 加载：`.spinner`（`:397`）、`.loading`（`:402`，横向 flex + 26px 内边距 + muted 文案）
- 分段控件（抠图/卡通同款）：`EditorSidebar.vue` scoped 的 `.seg` + `.matteBar__levels` / `.cartoonBar__levels`
  （`:1085-1093`）：选中态 `background:var(--sky|--purple); border-color:同色; color:#fff`
- 结果说明行：`.matteBar__note` + `.warn`（`--coral-deep`）/ `.weak`（`#B7791F`）/ `.fromSave`（`--muted`）（`:1094-1097`）
- 行内升级链接：`.inlineLink`（用法见 `EditorSidebar.vue:789,870,935`）
- 后台专用（`src/styles/admin.css`，**前缀一律 `adm-`**）：`.adm-page`（`:212`）、`.adm-pagehead`（`:219`）、
  `.adm-card`（`:248`）、`.adm-kpis/.adm-kpi/.adm-kpi__label/.adm-kpi__value/.adm-kpi--accent`（`:284-319`）、
  `.adm-btn` + `--primary/--danger/--ghost/--sm/--block`（`:490-548`）、`.adm-toolbar`（`:574`）、
  `.adm-tablewrap/.adm-table`（`:624-673`）、`.adm-empty`（`:770`）、`.adm-note` + `--warn/--danger/--muted`（`:795-817`）、
  `.adm-assetgrid`、`.adm-drop`（`:1016,1053`）、`.adm-progress`（`:1075`）。
  完整可用 class 清单在 `views/admin/_SPEC.md:169-190`。
- 设计系统总述（含排版与关键版式）：`README.md:911-964`。

---

## 8. 构建与自检

### 8.1 `package.json` scripts 全清单（`package.json:6-33`）

| script | 命令 | 作用 |
| --- | --- | --- |
| `dev` | `vite` | 开发服务器（proxy 到 127.0.0.1:8080） |
| `build` | `vite build` | 产出 `dist/` |
| `preview` | `vite preview --host` | 预览构建产物 |
| `palette` | `node scripts/build-palette.cjs` | 抓取+交叉验证生成 `src/data/palette.js`（需外网，勿手改该文件） |
| `assets` | `node scripts/build-assets.cjs` | 生成 `src/data/assets.js`（勿手改） |
| `fidelity` | `bench.mjs --label current` | 还原度跑分（dEcell/dEview/边缘相关，不需浏览器） |
| `fidelity:scale` | `bench-scale.mjs` | 画布尺寸 × 还原度 |
| `fidelity:matte` | `matte-bench.mjs` | 抠图精度跑分（IoU / 每格判定一致率 / 裁切框误差） |
| `fidelity:cartoon` | `cartoon-bench.mjs` | 卡通化跑分（结构一致度/色相偏移/特征保留） |
| `serve:dist` | `serve-dist.mjs` | 本地预览 dist（no-store，排缓存干扰） |
| `verify` | `node scripts/audit.cjs` | **全站自检（跑 dist/，21 页 × 4 视口，查报错/横向溢出/画布空白）** |
| `verify:archive` | `verify-archive.mjs` | 存档紧凑编码往返/兼容/体积 |
| `verify:render` | 5 个 `verify/render-*.mjs` + `editor-canvas-compile` + `estimate-svg` | 渲染层等价性、脏矩形、画布像素预算、SFC 编译、SVG 体积闸门 |
| `verify:export` | `export-plan/export-plan-1000/export-smoke` | 导出规格（PNG 尺寸计划、PDF 页数阶梯、SVG 丢色号决策） |
| `verify:pattern` | `pattern-fingerprint.mjs` | 生成引擎指纹回归（对照 `fingerprint-before.json`） |
| `verify:cost` | `bead-cost.mjs` + `audit.cjs --setup-file --eval-file --page editorProject` | 材料成本单价口径对账 |
| `verify:alpha` | `source-alpha.mjs` | 透明通道：透明处必须是空格、半透明边缘不掺白（合成图 + IoU 真值） |
| `verify:perf` | `perf-1000.mjs` | 100 万格生成耗时与内存 |
| `verify:fixture` | `audit.cjs --setup-file scripts/audit-fixture.js` | 写入自检用示例作品（走真实生成链路） |
| `verify:create` | `audit.cjs --eval-file audit-create.js /editor` | 创建步骤探针 |
| `verify:cartoon` | `audit.cjs --setup-file --eval-file audit-cartoon.js /editor` | 卡通全链路探针 |
| `verify:finish` | `… audit-finish.js "/p_audit_fixture?finish=1"` | 完成流程探针 |
| `verify:undo` | `… audit-undo.js --page editorProject` | 撤销/重做探针 |
| `verify:mobile` | `… audit-mobile.js --page editor,editorProject` | 手机版式探针（重排/折叠/下拉） |
| `verify:scale` | `… audit-scale.js --page editor,editorProject` | 画布档位（58²/300²/450²/1000²）耗时与体积 |
| `verify:photo` | `audit.cjs --eval-file audit-photo.js /editor` | 上传照片这条路（透明贴纸/自动匹配/精细档比例/抠图掩膜） |

> 缺口：`admin-audit.cjs` 无对应 script（见 §6.2 第 7 条）。

### 8.2 `vite.config.js`（20 行）

- `base: './'`（`:7`）——相对路径，方便部署到任意子目录/域名；这也是 hash 路由的前提（`router/index.js:3-4`）。
- dev proxy（`:8-14`）：`'/api'` 与 `'/uploads'` → `http://127.0.0.1:8080`（`changeOrigin:true`），
  **线上由 nginx 承担同样角色**。
- build（`:15-19`）：`outDir:'dist'`、`assetsDir:'assets'`、`chunkSizeWarningLimit:1500`。
- 仅一个插件 `@vitejs/plugin-vue`；依赖只有 `vue` + `vue-router`（`package.json:34-41`），**禁止引新 npm 依赖**（`_SPEC.md:12`）。
- 注意 `pnpm-workspace.yaml` 的历史坑（AGENTS.md §2.1）：必须写 `allowBuilds: { esbuild: true }`，否则 install 退出码 1。

---

## 9. 移动端适配

- **断点（以代码为准）**：`global.css` 里 5 个媒体查询段：`@media(min-width:1320px)`（`:561,588`）、
  `@media(max-width:1319px)`（`:620,951`）、`@media(max-width:1000px)`（`:959`）、
  `@media(max-width:780px)`（`:966`）、`@media(max-width:420px)`（`:1074`），另有 `@media print`（`:1083`）。
  ⚠️ `README.md:947` 写的断点序列「1440 / 1240 / 1000 / 780 / 420」与实际不符（实际是 1440（`:948`）/ 1319 / 1000 / 780 / 420）。
- 后台另有一套：`admin.css:1090`（≤980）、`:1125`（≤620）、`:1143`（print）。
- **≤780px 的四个关键手法**（新入口必须照做）：
  1. 变量覆盖 `:root{--header-h:58px;--fs-h1:22px;…}`（`:967`）、`.wrap{padding:0 14px}`（`:968`）。
  2. **工作台重排**：`.studio` 由 grid 换 flex 列，用 `display:contents` 给两个 `aside`「脱壳」，
     再用 `order` 把画布插到「① 创建」之后（`:995-1006`）；顺序注释在 `:989`。
  3. **卡片折叠**：`.card.is-folded > .card__body{display:none}` + `.cardFoldBtn{display:inline-flex}`（`:1010-1012`），
     只在 ≤780px 生效，桌面端这些类不生效（理由见 `EditorSidebar.vue:35-45`）。
  4. **选项组一律改原生下拉**：`.mDrop` 默认 `display:none`，手机端出现、同时 `.mHide` 让位（`EditorSidebar.vue:47-59` 有完整理由；
     用量表见 `README.md:950-964`）。新增一个「AI 入口」若是「多选一」，就必须同时给按钮网格与下拉两套控件，
     且 `:value` + `@change` 而不是 `v-model`（`EditorSidebar.vue:56-59` 的坑）。
  5. 其他：`.stage{height:52vh;min-height:280px}`（`:1021`）、上传区压缩（`:1029-1031`）、
     手机底部 `.tabbar`（固定定位，`:1061-1071`）、`.toasts{bottom:88px}`（`:1072`）。
- 移动端标签栏组件 `src/components/layout/MobileTabbar.vue:7-12`（创作/材料/素材/作品四项）。
- 窄屏三栏掉两栏在 `:951-958`（`.col--right` 折到下一行并解除内部滚动，理由在 `:953-954`）。
- 视口 meta 与 `-webkit-text-size-adjust:100%`（`global.css:98`）。

---

## 10. 后台「用户活跃数据监控」页面是否已存在

**前端：不存在。** `grep AdminActivityView|activity\.view|admin/activity` 在 `pindoudou` 全仓**零命中**；
`src/views/admin/` 只有 11 个 `Admin*.vue` + `_SPEC.md`；`adminNav.js` 的导航里没有活跃监控项
（`AGENTS.md` §5 待办第 1 条与此一致：「活跃监控只有后端接口，后台页面还没做」）。

**后端：接口与权限点齐全。**

- 权限点常量 `activity.view`：`.mirror/douwan-api/internal/model/admin.go:67`
  （`PermActivityView = "activity.view" // 查看用户活跃数据监控`）。
- 8 个读接口在 `.mirror/douwan-api/docs/api.md:401-408`：
  `/admin/activity/overview`、`/retention`、`/frequency`、`/regions`、`/features`、`/channels`、`/users`、`/users/:id`，
  全部 `activity.view`；接口契约细节（`total_*` 全时段 vs `daily/features/regions` 窗口）见 `docs/api.md:586-599`。
- 权限点已在角色可配清单里：`docs/api.md:825`、`docs/admin.md:71`（「运营与只读角色默认可看」）、
  `docs/activity.md:185-192`。
- 客户端埋点接口 `POST /api/v1/events`：`docs/api.md:306-360`（需登录；1~50 条；feature 白名单
  `editor.open / pattern.generate / pattern.export / pattern.matte / pattern.save / inventory.manage / ai.text / ai.variants / ai.batch`；
  限流 120 次/分/IP；采集关闭时返回 200 且 `enabled:false` **不报错**）；
  **前端目前没有任何调用**（`grep /events|trackEvent|activityApi` 在 pindoudou 零命中）。

**页面注册与权限点校验怎么写（照现有写法）**

- 路由：`src/router/index.js` children 加 `{ path:'activity', name:'admin-activity', component: AdminActivity, meta:{ title:'用户活跃数据监控', perm:'activity.view' } }` ——
  形状照 `:80-89`；守卫在 `:125-128`，`perm` 不存在于 `permissions` 就跳 `/admin/forbidden?perm=activity.view&from=…`。
- 导航：`adminNav.js` 加一项（建议放「经营」组，紧跟数据概览，`exact` 不要给），并加 `ADMIN_TITLES`。
- 权限点中文名：`useAdminAuth.js:39-59` 的 `labels` **必须补 `'activity.view': '查看用户活跃数据监控'`**，
  否则 `denyReason('activity.view')` 会返回原始键名（`:60`）。
- 接口封装：`adminApi.js` 加 `activityApi`（全部走 `opts()`，即 `adminTokens`）。
- 自检：`scripts/admin-audit.cjs:57-72` 加一项，`expect` 里放页面里的稳定关键文案（例如 KPI 标题）。

---

## 11. 对「把本地 AI 抠图 / 卡通化 / 文生图接进现有工作台」最相关的 5 条结论

**结论 1｜「本地 AI 抠图」和「卡通化」其实已经有完全可用的本地实现与 UI，缺的只是「模型级」质量与一个统一的入口位置。**
抠图在 `src/lib/matte.js:334 estimateMatte`（三档 `MATTE_LEVELS` `:114-130`），在出图链路里由
`useStudio.js:907-908` 传给 `pattern.js`；卡通在 `src/lib/cartoon.js:981 cartoonize`（三档 `CARTOON_STYLES` `:122-181`），
由 `useStudio.js:910` 传入。两者 UI 已经做成**互斥三选一**（`EditorSidebar.vue:92-117` 的 `processMode`，
按钮 `:656-675` / 手机下拉 `:676-685` / 细节区 `:688-711`），选中即重跑生成（`useStudio.js:280,286,339,351`）。
👉 接本地 AI 模型的**最小改动面**是把 `matte.js` / `cartoon.js` 换成「同签名的实现」
（`matte.js`：`estimateMatte(src, sw, sh, opts)`；`cartoon.js`：`cartoonize(rgba, sw, sh, opts)`），
`useStudio.js` 与 `EditorSidebar.vue` 一行不用改；要把第 4 个处理方式加进三选一，才需要动
`EditorSidebar.vue:69-120, 656-714`。注意 `pattern.js` 是唯一算法消费方（`README.md:139`），
且新实现必须保持**纯函数 + 可在 Node 里跑**，否则 `fidelity:matte` / `fidelity:cartoon` 跑分脚本会断。

**结论 2｜文生图完全没有实现，但已经有了「占位入口 + 门禁 + 计费 + 追踪」的全套骨架，落地点就是 `usePrompt.js`。**
`src/composables/usePrompt.js:1-7` 自己写明「正式接入后改成调用 `POST /api/ai/generate` 并按 Credits 计费」；
现状是关键词匹配本地素材（`:28-53`），失败提示三种（`:72-86,108-111`），
UI 在 `EditorSidebar.vue:612-632`（深链 `?tab=ai` 见 `:69-70`），首页还有第二个入口 `HomeView.vue:378-393`。
👉 改一个文件（`usePrompt.js`）+ 一处文案（`EditorSidebar.vue:628-631`）即可上线真实调用；
但必须先处理三件事：① baseURL 是硬编码 `'/api/v1'`（`api.js:9`），要新增后端路由就只能挂在这个前缀下；
② `ENTITLEMENTS` 里**没有 `ai.*` 键**，所以 `check('ai.text')`（`usePrompt.js:55,103`）恒为 `ok:true`，
③ `AI_COST_PER_CALL=8`（`usePrompt.js:21`）与 `CREDIT_COST['ai.text']=8`（`useMembership.js:222`）两处重复定义，要合并。
另外文生图的「图片从哪来」是新问题：现有四条图片入口（`useStudio.js:1190/1295/1060`）**没有一条接受 URL 或 base64**，
只有 `loadImageSource(img, url, name, kind)`（`:1060`）这个底层函数可以直接喂 `loadImageFromUrl(src)`（`:2095`）出来的 Image。

**结论 3｜新入口必须遵守的两条硬约定：前台「按钮永不隐藏、点不动给原因 + 升级路径」，后台「无权限则导航隐藏 + 按钮 disabled + title 给原因」。**
前台：文件头写死在 `useMembership.js:1-6`；实现三件套 = `check()` 拿 `{ok,reason}`（`:164-176`）+
`DENY_REASON` 中文表（`:144-158`）+ `toastWarn(reason)` 与 `emit('need-pro', reason)`（范例 `EditorSidebar.vue:425-432`）
→ `EditorView.vue:32-35` 的 `needPro` → 统一升级弹窗 `EditorView.vue:230-243`（含 Credits 余额与 `/pricing` 链接）。
按钮上加锁标记的写法是 `check(feature).ok ? '' : ' 🔒'`（`EditorView.vue:222`）。
后台：`_SPEC.md:156-157`（`:disabled` + `title=denyReason(...)`）、`adminNav.js:6-36` 的 `perm` 字段、
`AdminLayout.vue:40-46` 的 `visible()`。
👉 新增 AI 功能键时必须同时改 `useMembership.js` 的 `ENTITLEMENTS`（`:108`）**和** `DENY_REASON`（`:144`），
漏掉后者只会得到兜底文案「该功能需要升级套餐。」；若权益来自服务端，还要保证服务端权限矩阵里有同名键，
否则 `applyServerPermissions` 会静默忽略（`:328-334` 只覆盖已存在的键）。

**结论 4｜上线任何一个「会离开本机」的 AI 功能，都和前端的隐私承诺文案冲突，必须同步改三处声明。**
`SettingsView.vue:349`「目前这些功能尚未接入，因此现在没有任何图片离开你的设备」、
`:353`「我们不会用你的上传图片训练模型…接入 AI 功能时会同步更新这里的说明」、
`PricingView.vue:171,175`（「基础图片转拼豆完全不用 Credits，因为它在你的浏览器本地完成」/「图片…全部在你的浏览器里完成」）、
`AppFooter.vue:47`、`HelpView` 与 `EditorSidebar.vue:629-631` 的占位说明 —— 这些都是一期就写死的承诺。
👉 「本地 AI」若真的是浏览器内推理（当前全仓无 `onnx|webgpu|wasm|Worker|OffscreenCanvas`），
只要不产生网络请求就**不需要改这些文案**（这是走本地路线的最大合规优势）；
反之若走服务端模型，除了改上述文案，还要按 `docs/activity.md` §6 的白名单补埋点（`ai.text` / `ai.variants` / `ai.batch`
已在白名单 `docs/api.md:358-360`），并新增 `POST /api/v1/events` 的前端调用（当前零调用）。

**结论 5｜需要改 / 需要新增的文件清单（按「本地 AI 处理方式」与「服务端 AI 接口」两条路线分开）。**

*路线 A：本地 AI（抠图 / 卡通化增强，无网络请求）*
| 改动 | 文件 |
| --- | --- |
| 替换/增强实现（保持同签名纯函数） | `src/lib/matte.js`（`estimateMatte` `:334`、`MATTE_LEVELS` `:114`）、`src/lib/cartoon.js`（`cartoonize` `:981`、`CARTOON_STYLES` `:122`） |
| 无需改（只消费上面两个函数） | `src/composables/useStudio.js:907-910,1025-1027`、`src/lib/pattern.js` |
| 只在要加「第 4 种处理方式」时才改 | `src/components/editor/EditorSidebar.vue`（`SOURCE_KEYS`/`processMode` `:69-132`、按钮组 `:656-675`、手机下拉 `:676-685`、细节区 `:688-713`、scoped 样式 `:1085-1098`）、`src/views/SettingsView.vue:249-257`（默认值）、`src/main.js:53,63`（调试桥签名） |
| 必须同步的验收脚本 | `scripts/audit-matte.js`、`scripts/audit-cartoon.js`、`scripts/audit-photo.js`、`scripts/fidelity/matte-bench.mjs`、`scripts/fidelity/cartoon-bench.mjs`、`scripts/verify/source-alpha.mjs`、`scripts/verify/pattern-fingerprint.mjs`（算法一改指纹基线 `fingerprint-before.json` 要重跑） |
| 可选（新功能键/计费） | `src/composables/useMembership.js`（`ENTITLEMENTS` `:108`、`DENY_REASON` `:144`、`CREDIT_COST` `:220`） |

*路线 B：服务端模型（文生图 / 云端抠图）*
| 改动 | 文件 |
| --- | --- |
| 换成真实调用 | `src/composables/usePrompt.js`（`:60-95` 改调接口、`:102-114` 去掉 `notReady` 占位） |
| UI 与文案 | `src/components/editor/EditorSidebar.vue:612-632`（去占位说明、加 loading/进度）、`src/views/HomeView.vue:378-393` |
| 接口与令牌 | `src/lib/api.js:9`（baseURL 仍为 `/api/v1`，新路由必须挂此前缀）、`src/lib/adminApi.js:132-138` 旁加前台接口（`auth` 视是否需要登录） |
| 图片上传通路（现无） | 新增上传调用（范例 `src/lib/api.js:208-246 upload()`，注意其默认 `tokens=adminTokens`，前台用需显式传 `userTokens`） |
| 权益与计费 | `src/composables/useMembership.js`（`ENTITLEMENTS`/`DENY_REASON`/`CREDIT_COST`）、`src/composables/usePrompt.js:21` 去重 |
| 升级引导 | `src/views/EditorView.vue:230-243`（Pro 弹窗）、`src/views/PricingView.vue:106,133,170-175,322,334` |
| 隐私声明（**必改**） | `src/views/SettingsView.vue:349,353`、`src/views/PricingView.vue:171,175`、`src/views/HelpView.vue`、`src/components/layout/AppFooter.vue:47` |
| 埋点（当前零调用） | 新增前端调用 `POST /api/v1/events`（契约 `douwan-api/docs/api.md:306-360`）；接入点建议 `useStudio.js:972 trackUsage('generated')` 附近 |
| 验收 | `package.json:6-33` 加/改 script；`scripts/audit.cjs:46-75` 的 `PAGES` 若要加新入口深链需同步 |

*两条路线共同的前置动作*：改任何 `src/` 后必须 `corepack pnpm build` 再跑 `corepack pnpm verify`
（`scripts/audit.cjs:114 assertFresh()` 会因 dist 过期直接失败）；算法类改动前后各跑一次
`pnpm fidelity` / `fidelity:matte` / `fidelity:cartoon` 比数字（AGENTS.md §2.1）。
