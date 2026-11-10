# 前端 pindoudou

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §2 开头和 §2.1。「§5」里的交付细节见 [history/INDEX.md](history/INDEX.md) 与 [log/INDEX.md](log/INDEX.md)。

## 2. 代码与仓库

### 2.1 前端 `pindoudou`（豆玩 DOUWAN 拼豆图纸工作台）

- 路径：本机 `C:\Users\sharyuke\Documents\work\douwan\pindoudou`。前端、后端和文档都在当前目录这一个仓库里，远程是 <https://gitee.com/sharyuke/douwan.git>。旧地址 <https://gitee.com/maryuke/pindoudou.git> 只留作历史，不再往那里提交
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
| `src/lib/matte.js` (~1200 行) | 自动抠背景 + 去投影（经典图像处理，确定性、无模型）。**2026-10-29 深夜重做过**：判定口径从「颜色像不像」换成「主体/背景的几何与边缘关系」—— 核心背景生长加 Lab 梯度闸门（主体轮廓是跳变的、背景渐变是化过去的）、模糊地带按「封闭 + 有厚度 + 边缘是硬的」判成主体（这就是「主体与背景色相近时尽可能多保留主体」）、扩展带 + 双 F/B 来源做边缘精修 |
| `scripts/fidelity/matte-bench.mjs` | **抠图精度评测**：14 张带解析式真值的合成图（IoU / pixAcc / 边界 F1 / αMAE / 各档画布判定一致率）。三档平均 IoU：soft 0.949 / normal 0.999 / strong 1.000（改动前 0.883 / 0.813 / 0.759） |
| `scripts/fidelity/matte-real.mjs` / `matte-sweep.mjs` / `matte-debug.mjs` / `matte-prof.mjs` | 抠图开发工具：**真实照片**跑图（无真值，只看定性）、**背景色敏感性扫描**（主体与背景差多少开始吃亏）、**连通块诊断**（岛 / 簇 / 边缘梯度）、**耗时剖析**（`--cpu-prof` 配套） |
| `src/lib/render.js` / `exporters.js` | 图纸绘制 / PNG·SVG·CSV·JSON·打印导出 |
| `src/composables/useStudio.js` (1150 行) | 工作台状态中枢；作品存档的打包 / 解包与 `onProjectsPersisted()` 也在这里 |
| `src/composables/useProjectSync.js` | **作品按账号同步**（2026-10-27）：登录 / 保存 / 删除时与服务端 `GET/PUT/DELETE /api/v1/projects` 双向同步；合并按存档 `updatedAt`，删除走本机墓碑；设计见 `docs/project-sync.md` |
| `src/composables/useMembership.js` | 会员权益判定，**按钮永不隐藏**，点不动要给原因 + 升级路径 |
| `src/data/palette.js`、`assets.js` | **脚本生成，勿手改**（`pnpm palette` / `assets`） |
| `src/views/admin/AdminActivityView.vue` | 后台「用户数据」页：注册 / 登录的人数与次数、访问量，以及「自己」标注。接口 `GET /admin/activity/pulse` |
| `src/lib/telemetry.js` | 前台访问量埋点：路由 `afterEach` 上报 `POST /api/v1/visits`（访客标识存 localStorage、同页面 2 秒去抖、后台页面不上报、失败静默） |
| `src/data/seo.js` | **SEO 文案单一事实来源**：站点信息、首页/素材中心/教程页文案、工具页生成规则、应用内路由清单；构建时编译成 `dist/seo/pages.json` 供后端渲染。**V3.0 起还包含关键词库（分组 / 意图 / 目标页）与自动 SEO 模板** |
| `src/lib/seo.js` | 运行时注入 canonical / OG / Twitter / JSON-LD |
| `src/views/admin/AdminSeoView.vue` | 后台「SEO 管理」页（权限点 `seo.view`/`seo.manage`）：可索引页面数、Sitemap 状态、各引擎推送结果、推送历史、手动补推（含「强制补推」）、素材 SEO 文案编辑 |
| `src/views/admin/AdminSeoKeywords.vue` | 后台「SEO 管理 → 关键词管理」标签页（V3.0 新增）：列表 / 增删改 / CSV 导入 / 分组筛选 / 三个诊断面板（意图冲突、页面字段自检、低点击率候选） |
| `src/components/home/HomeContent.vue` | 首页首屏以下的内容区（转换步骤 / 功能清单 / 免费素材 / 常见问题 / 分类入口）。⚠️ 2026-10-26 白天删过一次、当晚首页恢复时挂回来，**当天晚些时候又删掉了** —— 现在页面不渲染它，正文只存在于服务端的 SEO 壳里（组件文件还在仓库里，`git checkout c8bb9a5^ --` 能取回） |
| `src/views/ColorsView.vue` | 拼豆色号 / 色卡对照页（V3.0 新增，路由 `/colors/`），15 个品牌的真实色号 |
| `src/components/beginner/BeginnerWizard.vue` | **新手简化版三步向导**（2026-10-26）：步骤条 + 参数保护弹层。**手机端（≤780px）改成 flex 纵列**：步骤条压扁一行、当前步骤自己滚、底部主按钮是容器里的一格（常显，压在四导航之上） |
| `src/components/beginner/BeginnerSelect.vue` | 新手版第 ① 步：上传 / 免费素材 → 统一「图片已选好」确认页。**手机端素材卡片区独立滚动**（`.bsel__libScroll`） |
| `src/components/beginner/BeginnerAdjust.vue` | 新手版第 ② 步：拼豆效果 / 原图 / 对比三视图 + 等比例尺寸滑块 + 颜色丰富程度。**≥781px（电脑 / 平板）预览图按比例撑满整块预览区**（`max-size` 640 + CSS 等比放大，预览区高 `clamp(360px,60vh,660px)`）；**手机端预览区占满剩余高度、参数区压紧**（见 §2.1） |
| `src/components/beginner/BeginnerExport.vue` | 新手版第 ③ 步：成果预览 + 材料清单 + 下载真实图纸。**≥781px 成果预览撑满预览框**（同上的 `max-size` 640 + 等比放大）；**手机端摘要压 2 列、材料明细进底部抽屉**（见 §2.1） |
| `src/components/beginner/ModeSwitchDialog.vue` | 模式切换确认弹层（全站只挂一个，z-index 500 压在工作台指引层 400 之上） |
| `src/composables/useBeginnerMode.js` | 新手 / 专业模式状态 + 两条保护判断（**不落 localStorage**；操作台 `/create` ↔ 专业工作台 `/editor` 之间切） |
| `src/views/BeginnerView.vue` | `/create`（**操作台** = 新手简化版）的容器：sr-only H1 + 「创作 · 操作台」面包屑 + 向导（工具页，不挂站点页脚）。**手机端容器锁高一屏**（`100dvh` − 顶栏 − 标签栏 − 安全区 − 键盘高度），`visualViewport` 量键盘高度写进 `--kb` |
| `scripts/verify-beginner.cjs` | **操作台三端验收**：视口**手机三档（360×640 / 390×844 / 430×932）+ 平板 834 + 电脑 1440** 真浏览器跑完整链路（先验首页是带插画的主视觉 → 上传→调效果→拿图纸→切专业→切回新手→免费素材），带 `--url` 可直接验收线上（线上 228/228）。含**第 ② / ③ 步预览图占比断言**（≥781px 高度占 ≥85%、面积占比 ≥40%；手机端画布不超出预览区 105%）与**手机一屏断言**（整页不滚动、CTA 在标签栏之上、摘要 2 列、材料抽屉、素材列表自己滚） |
| `scripts/verify-seo-v3.cjs` | **SEO V3.0 验收自检**：head 标签 / sitemap / robots / 首页主视觉与内容区 / 色卡页，电脑 + 平板 + 手机三档视口；`node scripts/verify-seo-v3.cjs --url https://dw.sharyuke.com`（线上 59/59） |
| `scripts/verify-board-crop.cjs` | **换钉板不裁画面验收**（`pnpm verify:board-crop`）：真浏览器走真实用户路径（载素材 → 铺满 104 板 → 画布上真拖一笔 → 左栏「底板尺寸（实物）」下拉选 52 钉板），断言图案包围盒**等比缩小**（不是被裁掉一半）+ console 报错 0，前后各留一张截图；带 `--url` 可直接验收线上 |
| `scripts/verify-matte.cjs` | **智能抠图验收**（`pnpm verify:matte`）：真浏览器走真实用户路径（/editor → 真 file input 上传 → 真点「智能抠图」→ 重新生成），三端视口 × 6 张图 = 54 项；断言抠图生效 / 背景被去掉 / 主体还在（豆数对比），并用页面里**同一份** `estimateMatte` 与真值掩膜比 IoU（≥0.99，低对比主体与顶边主体必须过）；带 `--url` 可直接验收线上 |
| `src/lib/exportTemplate.js` | **图纸导出标版 V3 的唯一口径**（2026-10-29 傍晚上线）：页眉 Logo + 粉色网址胶囊 + Slogan 与四色块 / 图纸面板 / 底部「图案信息」与「颜色清单」双卡。尺寸、坐标、颜色全部按 V3 最终设计图量出来的常量；`templateExtraHeight` 与 `composeExportTemplate` 共用同一套排版计算（预检尺寸与实际文件永不失配）；`exportRulerPx` 是导出专用的坐标带宽度（设计稿约 4.6 格宽），`exportChartTheme` 是导出专用的线色 / 坐标配色 |
| `scripts/audit-export-template.cjs` | **导出标版验收**（`pnpm verify:export-template`）：真浏览器跑新手第 ③ 步与专业「图纸交付」两条导出链路，拦截 `URL.createObjectURL` 抓导出的 PNG，按 V3 设计图逐区验收 9 项（页眉 Logo / 网址胶囊 / Slogan / 四色块 / 格线 / 两个胶囊分居左右 / 六个像素图标 / 色块色号 / 底部无页脚 Slogan）；带 `--url` 可直接验收线上 |
| `scripts/verify/export-proportion.mjs` | **底部双卡占比的回归守卫**（`pnpm verify:export-proportion`，已接进 `verify:export`）：45 色以内双卡高度 ≈ 图案信息卡高度、底部占整页 ≤ 24 %（设计稿 21.5 %）、用户那一档（104×104 / 45 色）≤ 21 %；> 55 色卡片会长高，只做记录 |
| `scripts/export-case-preview.cjs` | **按尺寸 / 颜色数 / 钉板型号出标版整页图**（`pnpm export:preview`）：走真实导出链路，产物在 `.tmp/export-template-audit/`。颜色数可精确指定（照片量化会自己收敛，脚本按色值最近的真实 MARD 色号扩容），用于视觉验收与不同档位的样例图 |
| `scripts/admin-audit-seo-keywords.js` | 关键词管理端到端探针（11 步），由 `admin-audit.cjs` 带 `ADMIN_EVAL_FILE` 调用 |
| `scripts/audit.cjs` | 无头浏览器自检：21 页 × 4 视口 = 84 项，查报错 / 横向溢出 / 画布空白 |
| `scripts/verify-art-scale.cjs` | **清晰度滑杆验收**（`pnpm verify:art-scale`）：真浏览器设底板 156 / 成品 156 → 真 PointerEvent 画一笔 → 真拖滑杆到 117（弹层里点「保留手改」），断言「底板仍是 156」「成品变 117×117」「画面四边按 117/156 等比缩放」「画面落在成品区域内」「标题里的颗数与实际一致」；带 `--url` 可直接验收线上 |
| `scripts/verify-size-guard.cjs` | **改尺寸保护弹层验收**（`pnpm verify:size-guard`）：真浏览器拖滑杆 → 弹层出现（画布先不动）→ 分别点「保留手改」（画面 = 旧图按块放大，mismatch=0）/「重新生成」（画面按原图重新取样，mismatch≈5%，manualEdited 归 false，顶栏颗数一致，再拖不再弹）/「取消」（滑杆回位、画面一格没动）；没手改过的图不弹层。带 `--url` 可直接验收线上 |
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
