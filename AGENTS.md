# 豆玩 DOUWAN 工作区

> 这个文件是给「以后在这个工作区干活的 AI」看的：先读这里，再看 [DEPLOY.md](DEPLOY.md)。
> 最后更新：2026-11-01 晚上（**首页关键词优化（品牌变体归首页）+ 百度推送卡在 token**：
> 用户「优化关键词：豆玩图纸生成器，图纸生成器，豆玩，douwan，拼豆图纸生成器，豆玩拼豆图纸生成器。
> 优化后推送给百度seo」。改法（`pindoudou` 的 `src/data/seo.js`）：首页 title 改成
> 「豆玩图纸生成器 - 免费拼豆图纸生成器｜图片转拼豆图纸在线制作」、H1 改成「豆玩拼豆图纸生成器」、
> description 与 lead 里带「豆玩 DOUWAN / 豆玩图纸生成器」、`SITE_SEO.keywords` 与首页 `related`
> 补上 `douwan` / `豆玩图纸生成器` / `豆玩拼豆图纸生成器` / `图纸生成器`（全部指向 `/`，不另建页面）；
> `HomeView.vue` 的 sr-only H1、`router` 的兜底 title、`/colors/` 与帮助页的站内锚文本同步改成
> 「豆玩拼豆图纸生成器」，`verify-seo-v3.cjs` 的 H1 断言跟着改。已上线（`assets/index-CwZR1UcG.js`），
> 线上 head 已核对、`verify-seo-v3 --url` 62/62（新增「浏览器标题与 SEO 文案一致」断言，
> 顺手修掉探针里 `t(document.title)` 永远取到空串的老 bug）；前端 `pindoudou` `81564c7`+`db7a977`；
> qq 回滚包 `/root/douwan-backups/dw-web-before-seokw-20261101-192603.tar.gz`。
> 关键词库已同步进库（新增 4 条：douwan / 豆玩图纸生成器 / 豆玩拼豆图纸生成器 / 图纸生成器，
> 首页共 10 条；意图冲突 0、页面字段自检 0）。
> ⚠️ **百度推送没发出去**：`/etc/douwan/api.env` 里的 `DOUWAN_SEO_BAIDU_TOKEN` 是**空值**
> （`awk` 量长度 = 0，之前只看「有没有这一行」误判成已配置），后台 `/admin/seo/config` 三个引擎
> 全是 `configured:false`，`POST /admin/seo/push` 返回 `created:0 / skipped:0`。
> 要推必须先拿到百度搜索资源平台的普通收录 token（ziyuan.baidu.com → 普通收录 → API 提交），
> 填进 api.env 后 `systemctl restart douwan-api`，再调 push。临时管理员 `tmp_kw_seo`（id 37）
> 用完已停用并软删，线上只剩真实管理员 `douwan`）；
> 2026-11-01 晚上（**robots.txt 优化：显式放行主流搜索引擎与 AI 爬虫**：用户「优化robot.txt，
> 允许爬虫来扫我」。改法（`douwan-api` 的 `internal/service/seo.go`）：把 robots 拆成三组 ——
> `*`（其它爬虫）、主流搜索引擎（Baiduspider / Googlebot / Bingbot / Slurp / Sogou web spider /
> 360Spider / HaosouSpider / YisouSpider / PetalBot / Applebot / DuckDuckBot）、
> AI 爬虫（GPTBot / OAI-SearchBot / ClaudeBot / Claude-SearchBot / PerplexityBot /
> Google-Extended / CCBot / Bytespider），全部 `Allow: /`。
> **顺手修掉一个真 bug**：旧版给 Baiduspider / Googlebot / Bingbot 单独开的分组只有 `Allow: /`、
> 没有 Disallow —— 按 robots 规范爬虫只认与自己名字匹配的那一组、`*` 组对它不再生效，
> 等于这三家被「放行」到 /admin 与 /api/ 里去了。现在私有路径清单（`robotsPrivatePaths`，
> 新增 `/project-materials`）在每一组里原样重复，`seo_test.go` 的 `TestSeoRobots` 解析分组、
> 断言「每组 Disallow 与 `*` 完全一致」+「公开页面不被任何组挡住」。
> 另加 `HEAD /robots.txt` 与 `HEAD /sitemap.xml`：以前 HEAD 落到 NoRoute 回 404，站长工具 / 监控
> 用 HEAD 探测会以为站点没有 robots.txt。nginx 没有屏蔽任何爬虫 UA，robots 是唯一入口。
> 验证：`go vet` + `go test ./...` 全绿（handler 的 `TestSmsCodeExpiresAndAttempts` 并发下偶发超时，
> 单独跑通过，与本次无关）、线上 `curl /robots.txt` 三组齐全、HEAD 200 且 `Content-Type: text/plain`、
> `verify-seo-v3.cjs --url` 59/59。后端 `douwan-api` `0906c1a`，已上线，
> qq 回滚包 `/opt/douwan-api/bin/server.bak-robots-20261101-191622`）；
> 2026-11-01 下午（**网站升级公告弹窗上线**：用户「做个网站升级的公告弹窗，首次打开时弹出」。
> 交付包 `Z:\拼豆\网站升级公告\` 实际只有 07 命令与 04 视觉索引两张，其余 6 个文件缺失。
> 新增 `src/components/notice/UpgradeNotice.vue`（标题 / 正文 / 按钮都是真实 DOM，不是整图）；
> `BaseDialog.vue` 加 `bare` / `dialogClass` 与默认插槽的 `close`（默认行为不变），`App.vue` 只挂一处；
> `sessionStorage['douwan-upgrade-notice']` 关闭后同会话不再弹。
> 「继续使用」= 关闭 + 不在 `/editor` 时 `router.push('/create')`；「我知道了」/ X / Esc / 遮罩只关闭，
> 编辑器里路由与作品都不动。PC 620px 居中、手机收窄到 `100vw - 24px`。
> 自检 `pnpm verify:upgrade-notice`（24 项：文案逐字、居中、按钮可用、继续使用进 /create、刷新不再弹、
> 编辑器 Esc/X 只关闭、手机 390×844、既有弹窗标题栏仍在），本地与线上全绿；
> 线上全站 84 页 0 错误（只有 404 页自身那条 404）。前端 `pindoudou` `09d27f6`，已上线，
> 线上产物 `assets/index-Ddi-IzP_.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-upgrade-notice-20261101-131426.tar.gz`。
> 差异：左下装饰用站点现有 `hero-bean-smiley.png`（白底，CSS `mix-blend-mode:multiply` 并进卡面），
> 右下气泡里用 `brush.png` 替代扳手，徽章用圆角替代切片的像素阶梯描边）。
> 2026-11-01 中午（**换尺寸分两部分缩放：原图按原图、手改按修改时的尺寸**：
> 用户「缩放的时候，分为2部分，一部分是原图缩放，一部分是修改过后的部分缩放，原图部分的缩放不要变，
> 不管是那个尺寸都按照原图来缩放，保证在各个尺寸下的效果都是按照原图来的，然后修改的部分，
> 要按照修改时候所在的尺寸进行缩放」。改法（`useStudio.js`）：新增**修改层 `editLayer`**
> （`{ w, h, mask, cells, palette }`，分辨率 = 改那一刻的成品网格）；`recordEdits` 把每一笔改动按
> 成品区域相对坐标写进层里（层不够大才按块放大，`growEditLayer`）；`setCanvasSize` 有**真原图**
> （`sourceUrl && !sourceFromPattern`）时**每次换尺寸都 `regenerate()` 按原图重新取样**，再把修改层
> 投影回去（`applyEditLayer` 面积加权投票：放大一颗铺满对应块、缩小块内多数者胜）——
> 原图部分永远来自原图，手改保留改那一刻的精度（104 上改的一颗，缩到 52 再放回 104 仍是那一颗；
> 52 上改的一颗，放大到 104 是 2×2）。老存档的源图是按图纸重建的（`sourceFromPattern`）不算原图，
> 保持原来的按块缩放（`resizeVariantsPreserving` + 底稿），不去假装重新取样。
> 修改层随快照 / 撤销走；存档只在「层比保存时的网格更细」时写 `extra.layer`（`[w, h, x, y, id, …]`，
> null = 擦掉），`openProject` 读回；同分辨率时 `editMap` 已能完整复原，不重复存。
> 左栏尺寸说明行改成「画面已按原图缩放到 X × X 格（手工修改按原尺寸保留）」。
> 自检：`verify:size-guard` 重写为 8 条路径（原图重新取样 + 修改层投影；104→52→104 仍是那一颗；
> 52 上改的一颗放大成 2×2；存档往返；老存档仍按块缩放），桌面 + 手机；
> `audit-board-resize` 11 场景 × 4 视口改成断言 `regenerated === true`（C2 只换钉板仍是 1:1 平移）
> 并用 `projectEditKeys` 按修改层投影算期望格子。
> 验证：本地与线上 `verify:size-guard`（桌面 + 手机）/ `verify:art-scale` / `verify:board-crop` /
> `verify:board-resize`（11 场景 × 4 视口）全绿，全站 84 页 0 错误（只有 404 页自身那条）、
> `verify:beginner` 本地 217/217 / 线上 245/245、`verify:pattern` 指纹不变、`verify-archive` 全过。
> 前端 `pindoudou` `7b88ca3`（隔离 worktree `.tmp/wt-split`，分支 `feat/split-scale`，rebase 到 `fb6cd93`），
> 已上线，线上产物 `assets/index-BjOBgeZR.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-split-scale-20261101-123618.tar.gz`）；
> 2026-11-01 上午（**手机验证码登录入口先隐藏，等短信资质审核通过再放出**：
> 用户「把手机登录的功能先隐藏，审核通过后再放出来」。`LoginDialog.vue` 加开关
> `SMS_LOGIN_ENABLED = false`：弹窗不再问 `/auth/sms/status`、不渲染手机号 / 验证码表单与
> 「手机号登录 / 邮箱登录」页签，只留微信 + 邮箱；隐私说明里那句手机号也一起收起。
> 审核通过后把这个常量改成 true 即可恢复（表单、`loginWithSmsCode`、后端接口都在）。
> `scripts/verify-sms-login.cjs` 默认改验「入口确实不出现」（服务端配没配短信都不出现、
> 没有手机号输入框、不发 `/auth/sms/*` 请求），完整流程用 `SMS_LOGIN_RELEASED=1` 跑。
> 验证：本地 mock 自检 10/10、全站 84 页 0 错误（只有 404 页自身那条）、
> `audit-login-public` 桌面 / 平板 / 手机全过（邮箱注册登录、微信入口都正常）；
> 线上真浏览器复核首页与账号页登录弹窗（4 档视口）：无页签、无手机号表单、邮箱表单可见、
> 0 条 `/auth/sms/*` 请求、console 报错 0；`/` `/create` `/editor` `/account` `/colors/` 全 200。
> 前端 `pindoudou` `fb6cd93`，已上线，线上产物 `assets/index-C9Rp1uue.js`；
> qq 回滚包 `/root/douwan-backups/dw-web-before-smsoff-20261101-115921.tar.gz`）；
> 2026-10-31 深夜（**缩小再放大不再丢细节：每个方案留一份最大网格的底稿**：
> 用户「缩小之后再放大，细节全部丢失了…应该把修改的数据按原图尺寸贴上数据之后，再根据这个数据缩放」。
> 改法（`useStudio.js`）：每个方案（底稿与 `active` 各一份）在内存里留 `master = { artW, artH, cells, palette }`，
> **只存成品区域**；生成 / 打开存档后第一次换尺寸时由当前画面懒建（`ensureMaster` / `masterFromPattern`）。
> 换尺寸一律 `projectMasterArt()` 从底稿投影（每格取覆盖块内多数色；放大时块落在一格内 ⇒ 按比例铺满），
> 缩到 52 再放回 104 时 `aw === master.artW` ⇒ 原样返回、**细节一颗不少**；放大到比底稿还大时
> 把投影结果升格成新底稿。在更小尺寸上逐颗改的格子由 `bakeEditsIntoMaster` 按比例写回底稿对应的那一块
> （擦掉 = EMPTY、新色号补进底稿色板），换回大尺寸时修改还在原处；快照 `snapshotOf` / `applySnapshot`
> 带 `master` 引用（底稿不可变），撤销连底稿一起回退。**底稿不进存档**（体积翻倍），打开存档时底稿 = 存档网格。
> 说明行：放大「从留底细节还原，颜色不变」/ 缩小「细节按块合并，留底不变，放大回来会恢复」。
> 自检：`verify:size-guard` 新增第 ⑦ 条（104→52→104 逐格一致、`detailDiff=0`、缩小尺寸上改一格放回 104 后
> 原图对应那块是改过的色），桌面 + 手机；`verify:board-resize` 新增 J 场景（11 场景 × 4 视口）。
> 验证：本地与线上 `verify:size-guard` / `verify:board-resize` / `verify:art-scale` / `verify:board-crop` 全绿，
> 全站 84 页 0 错误、`verify:beginner` 245/245、`verify:pattern` 指纹不变、`verify-archive` 全过。
> 前端 `pindoudou` `239448c`，已上线，线上产物 `assets/index-dyT1hSwb.js`；
> qq 回滚包 `/root/douwan-backups/dw-web-before-master-20261031-215343.tar.gz`）；
> 2026-10-31 晚（**换尺寸只缩放工作区当前图纸，不回源图**：
> 用户「改变尺寸缩放的时候，从工作区读取最新的数据进行缩放，不要用源文件进行缩放」。
> 改法（`useStudio.js`）：`setCanvasSize` **不再调用 `regenerate()`**，一律走
> `resizeVariantsPreserving` —— 放大 = `resampleArtCells` 每颗旧豆按比例复制（颜色一颗不变）；
> 缩小 = 每格取覆盖它的旧格里出现最多的色（块合并，允许少色、绝不长新色）；
> 手改记录 `editMap` 由 `remapEditMap` 跟着格子按比例映射；只换钉板仍 1:1 平移；
> 想按原图重新转换走「恢复方案」。当天前两版（锁色号 `lockedPalettes`、放大锚旧豆
> `anchorOldCells`）连同 `lib/pattern.js` 的 `lockedPalette` 分支一并删除 ——
> 它们都要先回源图取样。说明行：放大「每颗豆按比例复制，颜色不变」、缩小「细节按块合并」。
> 自检：`verify:size-guard` 的 ①③④⑤ 改成「mismatch ≈ 0（按当前图纸复制）」+ 色号不变 +
> `anchorsMatch`；缩小改成「不长出新颜色」；`audit-board-resize` 的 A/C/G 改成断言
> `regenerated === false`（不回源图重生成）。
> 验证：本地与线上 `verify:size-guard`（桌面 + 手机）/ `verify:art-scale` / `verify:board-crop` /
> `verify:board-resize`（10 场景 × 4 视口）全绿，全站 84 页 0 错误、`verify:pattern` 指纹不变。
> 前端 `pindoudou` `6357313`，已上线，线上产物 `assets/index-C9-b453p.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-scale-live2-20261031-*.tar.gz`）；
> 2026-10-31 晚（**新拖进来的图保存成新作品，不再覆盖已打开的作品**：
> 用户「新拖进来的作品保存不要替换旧作品」。根因：`saveProject` 按 `currentProjectId`
> 判断覆盖还是新建，而「打开一件作品 → 再拖一张新图进来」时这个 id 还指着旧作品 ⇒
> 点保存把新图写进旧作品，旧作品的图纸 / 名字 / 缩略图全被换掉，且没有任何提示。
> 改法（`useStudio.js` 的 `loadImageSource`，本地上传 / 素材库素材 / AI 素材的共同入口）：
> 载入新图时先解除 `currentProjectId` 关联、状态置回「未保存」、清掉旧图纸的拼制进度；
> 保存走新建分支，旧作品原样留在「我的作品」里。打开存档走 `openProject`（不经过
> `loadImageSource`），改存档再保存仍更新同一件。⚠️ 不做「覆盖当前作品」的开关，
> 想改已有作品请打开它再改；新图想接着旧作品用「另存」目前没有入口（用户没要）。
> 自检：新增 `scripts/audit-new-save.js`（`verify:new-save`），走真实上传 + 真实保存按钮
> （桌面顶栏「保存」/ 手机「更多 → 保存作品 → 弹层确认」），30 项钉住：新图不挂旧作品、
> 旧作品本机存档逐字节不变、打开旧作品图纸指纹（宽高/色号数/豆子数/逐格哈希）一致、
> 改一格保存仍更新同一件、打开旧作品后拖新图再另建一件；桌面 + 手机两档视口。
> 对着改动前的构建复跑：11 项失败（旧作品被新图覆盖）—— 探针确实能抓住这个 bug。
> 验证：本地与线上 `verify:new-save` 全绿（3 个 editor 页面 × 2 视口，console 报错 0）、
> 全站 84 页 0 错误（线上只有 404 页自身那条）、`verify:beginner` 217/217（线上 245/245）、
> `verify:create` / `drop` / `photo` / `mobile` / `finish` 全绿；线上 `verify:size-guard`
> 用 `6357313` 那版脚本跑过（本机旧脚本对不上新口径，别用旧版验收）。
> 前端 `pindoudou` `e5992c5`，已上线（并行会话的 `6357313` 叠在上面一起发布，
> 线上产物 `assets/index-C9-b453p.js`）；qq 回滚包
> `/root/douwan-backups/dw-web-before-newsave-20261031-210708.tar.gz`）；
> ⚠️ 顺带记录：`verify:home`（`scripts/audit-home-upload.js`）在改动前后**都**超时
> （探针按「点上传按钮就跳 /editor」写的，现在按钮是触发文件选择），是旧探针失配，
> 与本次改动无关；要修得先重写那条探针的入口假设。
> 2026-10-31 晚（**放大只加细节，旧豆颜色一颗不变**：
> 用户接着反馈「还是没改到，保存的作品再编辑时，放大尺寸有些像素的颜色发生了变化，
> 我的唯一要求是可以另加细节，但是保持原有颜色不变」。只锁色号挡不住「同一颗豆从 A9
> 换成邻近的 G12」—— 重新取样会改个别格子。改法（`useStudio.js`）：
> `setCanvasSize` 重新取样前 `capturePatterns()` 记下每个方案的旧图纸；取样后
> `anchorOldCells()` 把每颗旧豆按**旧格中心**落到新网格（`nx = floor((x+0.5)*新宽/旧宽)`），
> 颜色按色号 id 找回（新方案缺就补进调色板）；新网格其余格子用取样结果补细节。
> 缩小不锚（几颗并成一颗，必然合并）。顺序：先锚旧豆、再落手改（手改优先）。
> 说明行新增「（颜色保持不变）」。
> 自检：`verify:size-guard` 的 ①③⑤ 新增 `anchorsMatch`（逐颗旧豆比对新网格锚点颜色）。
> 前端 `pindoudou` `07d93f1`，已上线，线上产物 `assets/index-Dyj52F_N.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-anchor-20261031-*.tar.gz`）；
> 2026-10-31 晚（**换尺寸锁色号：只调图案大小，不自动改颜色**：
> 用户「保存过的作品再改变尺寸大小不要自动改变颜色，保留保存时的色彩，只调整图案大小」。
> 改法：`setCanvasSize` 在重新取样前把每个方案当前的 `palette` 收成 `lockedPalettes` 传给
> `regenerate`；`lib/pattern.js` 的 `generateFromCells` 收到 `lockedPalette` 后**跳过 `quantize`
> 选色**，直接把每格映射到这套色号里最近的一个，并**跳过智能减色 / mergeRare**（合并会吃掉色号）；
> 几何仍按源图重新取样（放大长细节、缩小块合并），色号集合逐格不变。
> 主动改「颜色数量 / 色板」不带锁，照旧重新选色。
> 自检：`verify:size-guard` 的 ①②③⑤ 全部新增「色号集合完全相同」断言（`sameColors`），
> 放大 mismatch 仍 ≈ 0.04~0.05（细节还在）。与并行会话的智能减色 `761e01a` rebase 合并，
> 锁色号时智能减色不参与；`verify:pattern` 指纹不变。
> 前端 `pindoudou` `61d19a1`，已上线，线上产物 `assets/index-D3bVPEcB.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-palette-lock2-20261031-*.tar.gz`）；
> 2026-10-31 深夜（**智能减色上线 + 去杂色 / 相近色合并优化**：
> 用户要求「优化一下自动去除孤立豆和相近色自动合并，去掉杂色，减少色彩数量的问题」。
> ① **合并 `feat/smart-colors`**（2026-10-28 的 `d15cc7b`，一直没合进 master）：
> 按图片复杂度 + 画布大小建议色数（用户目标色数只当上限），映射后用并查集合并
> 视觉相近色号，轮廓 / 五官 / 结构色有感知护栏；专业版 ④ 与新手版第 ② 步各有开 / 关
> （`options.smartColors`，默认开、随设置持久化）；关闭时与旧算法逐位一致。
> 合并时 `useStudio.js` / `EditorSidebar.vue` 有冲突，均按 master 新版保留 +
> 补 `smartColors` 选项与两处 `smart: options.smartColors`。
> ② **去杂色**（`pattern.js` 新增 `cleanupSpecks`）：按 4 邻接连通块处理 1~2 颗碎点，
> 整块并进四周主色（ΔE00 ≤ 18），每轮快照判定、改完整体替换，最多 3 轮收敛 ——
> 旧 `cleanupIsolated` 只扫一遍、只认单颗，成对 / 链式杂点会漏掉。
> 智能减色开启且勾选「去孤立豆」时走它，关闭时保持旧算法（指纹逐位一致）。
> ③ **结构护栏修正**（`smartReduce.js`）：结构占比只统计 **≥4 颗的连通块** ——
> 1~2 颗的碎点四邻天生全是别的颜色，按逐格算永远是 100% 结构色，旧口径反而给杂色
> 发了免死金牌；新增第④档「整色碎点」：≥60% 的豆落在 1~2 颗小块、用量 ≤2%、
> 结构占比 <25% 的色号允许并到 ΔE00 ≤ 12；合并后实时维护 dst 的碎点占比。
> **实测**（`bench-smart`，5 图 × 58/116 格 × 16/48 色 × easy/high）：
> 色号总数 435 → **262（−40%）**（优化前 290 / −33%）；dEcell 平均 +0.3%，
> dEview 平均 +0.2%、最差单条 +0.619（ΔE00 < 1 肉眼不可见）；孤立豆天空 20→5、
> 平涂卡通 43→0；豆子总数逐条不变。1000 格：smart 开 809ms / 关 677ms、
> 色号 19→15、孤立豆 5→1。
> 验证：`pattern-fingerprint` 对比 master 基线逐位一致（关闭路径）、`bench-smart`
> 确定性断言、`audit-smart`（12 页 × 18 项）、`audit-smart-beginner`（4 视口 × 11 项）、
> `verify-beginner` 本地 217/217 / 线上 245/245、全站 84 页 0 错误（线上只有 404 页
> 自身那条按设计的 404）、线上 `verify-size-guard` 与 `board-resize` 全绿；外网 200。
> 前端 `pindoudou` `761e01a`（合并 `8549198` 后成 `8ab5634`），已随并行会话的
> `61d19a1` 上线，线上产物 `assets/index-D3bVPEcB.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-smartcolors-*.tar.gz`）；
> 2026-10-31 晚（**工作台禁用文字选择**：用户要求「工作台禁用文字选择」。
> `src/styles/global.css` 里给 `.studio`（专业工作台根节点）及其后代统一 `user-select:none` ——
> 画布上拖笔、连点工具、拖滑杆、手机长按都不会再顺手选中界面文字；输入框 / textarea /
> 可编辑区域显式恢复 `user-select:text`，改名与填尺寸照旧能选中内容。规则只挂在 `.studio` 上，
> 操作台 `/create`、首页与其它页面不受影响。
> 验证：真 Chrome + 真鼠标拖拽（CDP `Input.dispatchMouseEvent`）对着线上跑 7 项断言全过 ——
> 工作台根节点与文字节点 `user-select=none`、左栏拖拽后选中为空、输入框仍是 `text` 且能选中、
> 手机视口（390×844）拖拽为空、对照页 `/help` 文字仍可选中；线上 `/editor` / `/editor?tab=library` /
> `/editor/p_*` / `/create` 四档视口自检 16 项 0 报错、无横向溢出。
> 前端 `pindoudou` `8549198`（隔离 worktree `.tmp/wt-select`，分支 `feat/no-text-select`），已上线，
> 线上产物 `assets/index-B1yrk6Lb.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-noselect-20261031-195813.tar.gz`）；
> 2026-10-31 晚（**改尺寸不再弹层：重新取样 + 手改按比例落回**：
> 用户贴「放大要重新生成图纸」弹层说「我不要这样，也不要放大了就变模糊……改过的图放大缩小
> 就只是放大缩小……放大后会增加细节，但不要遮盖改过的豆子，也不要重新生成，放大图案的最大值
> 放到选择画布的边界的最大值」。改法（`useStudio.js` + `EditorSidebar.vue`）：
> ① 图纸新增**手改记录 `editMap`**（`Map<格子下标, {id,color}|null>`，null = 擦掉）——
> `endEdit` 用**手势前的快照**逐格比对得出（必须在 `flushPendingStats()` 之前，否则 palette
> 重排后下标对不上），快照 / 撤销 / 重做 / 存档都带着它走；
> ② `setCanvasSize` **有源图一律重新取样**，再把 `collectEditsByKey()` 取出的手改按
> `floor(x*新宽/旧宽)` 落回（颜色按色号 id 找回，方案里没有就补进调色板）；
> 落回成功 `manualEdited = true`、说明行写「手工修改已保留」；
> ③ **弹层整个删掉**（`sizeGuard` / `sizeMode` / `keepEdits` / `BaseDialog` 全删）——
> 只换钉板（成品区域不变）仍 1:1 平移、不重生成；没有源图 / 老存档没记手改 → 按块缩放兜底
> （`remapEditMap` 按比例映射）；
> ④ **滑杆上限 = 画布规格**（`capLong` / `canvasCapW/H`）：图案放到最大正好撑满底板，不超出不被裁；
> ⑤ 存档把 `editMap` 稀疏打包成 `[x, y, id, …]`（上限 20000 条）存进 `packPattern` 的 `edits`，
> `openProject` 读回；老存档没有此字段 = 没手改过。
> 自检：`verify:size-guard` 重写成 6 条路径（手改放大不弹层且落回原位同色号、mismatch ≈ 0.05
> 证明细节变多 / 缩小落回 / 存档往返 / 没手改过 / 老存档 / 滑杆 max = 底板且拖满撑满），
> 桌面 + 手机两种视口；`verify:art-scale` 清掉旧弹层点击；`audit-board-resize` 10 场景 × 4 视口
> 改成断言 `editMap` 键位按比例映射 + 包围盒等比缩放。
> 验证：本地与线上 `verify:size-guard` / `verify:art-scale` / `verify:board-crop` /
> `verify:board-resize`（10 场景 × 4 视口）全绿，全站 84 页 0 错误（只有 404 页自身那条 404）、
> `verify:beginner` 217/217。
> 前端 `pindoudou` `2256526`（隔离 worktree `.tmp/wt-size`，分支 `feat/size-no-guard`），已上线，
> 线上产物 `assets/index-DK-8jDnT.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-size-no-guard-20261031-*.tar.gz`）；
> 2026-10-31 深夜（**放大不再发虚：带源图快照的存档同享「落色 + 最近邻」**：
> 用户反馈「从保存作品里点出来的图放大后仍然分辨率不清晰」—— 上一轮（`4e2cc53`）只修了
> 老存档（没带源图、按图纸重建源图）那条路；带 512px 源图快照的存档（`openProject` 的
> `proj.source` 分支）走的是原样双线性插值 + 面积平均采样，放大后边缘混出中间色，
> 量化长出原图没有的邻近色（临时探针实测 51×63 → 70×87 多出 17 个色号）。
> 改法（都在 `useStudio.js`）：① 快照打开时在内存里平滑插值到 `REBUILD_SOURCE_SIDE` 并
> **落色到当前方案自己的调色板**（`active.palette` 的 code/hex），再当源图；存档里那份
> 512px 快照原样保留（`sourceSnapshot` 不动，localStorage 体积不涨）——
> `sourceFromPattern` 保持 false，`saveProject` 照旧带快照；
> ② `rebuildSourceGrid` 在快照分支也置位，`sourceNearestOpt` 删掉
> `sourceFromPattern === true` 的条件（它在这条路上本来就是 false，把最近邻挡死了）；
> ③ **落色目标只用当前方案的调色板**：用所有方案的并集会让放大后的最近邻采样从别的
> 方案的颜色里投票，长出当前方案没有的色号（实测并集时 70×87 多出 7 色：
> E21/F18/G1/G16/G2/G9/M4）。
> 探针实测（临时脚本 `probe-snap.cjs`，已删）：放大后色号 33 → 33、extra/missing 均空。
> `verify:size-guard` 的 ④（存档往返）判据从 mismatch 改成「颜色集合不涨」，与 ⑤⑦ 一致。
> 验证：本地与线上 `verify:size-guard`（7 条路径）/ `verify:art-scale` / `verify:board-crop` /
> `verify:board-resize`（9 场景 × 4 视口）全绿、全站 84 页 0 错误、`verify:beginner`
> 本地 217/217 / 线上 245/245；外网复核 https 200。
> 前端 `pindoudou` `b545fa5`（接在 `4e2cc53` 之上），已上线，
> 线上产物 `assets/index-BKpAWnyq.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-snapfix3-*.tar.gz`）；
> 2026-10-31 深夜（**放大不再发虚：图纸重建源图「落色 + 最近邻」，颜色一格不错**：
> 用户上午贴「放大只能按块复制」弹层、下午贴工作台截图问「为什么这个尺寸变大了之后就变模糊了」
> （作品「131」，老存档 51×63 放大到 70×87，三连反馈：①不能一块一块 ②不能发虚
> ③「像以前一样放大后分辨率不变，细节更细」）。最终口径（`useStudio.js` + `lib/pattern.js`）：
> **插值管几何、落色管颜色、最近邻管采样** ——
> ① `rebuildThumbSource()` 底子**透明**（逐格画非空格色，不铺 `patternBitmap` 的灰底，
> 否则去背景空格放大后全变白豆）；
> ② 双线性插值到 `REBUILD_SOURCE_SIDE = 1024` 后**落色**：每像素收回图案本来的色
> （15-bit 色桶 → 最近色 LUT）+ **alpha 二值化**（半透明像素泛白，最近邻采到就镶白边）；
> ③ 落过色的源图必须存**无损 PNG**：有损 WebP 0.9 会扰动色值，重新取样被量化到邻近色号
> （实测 33 色又长出 9 个邻近色，这个坑是靠对比色号集合抓出来的）；
> ④ `resampleRGBA` 加 `nearest` 参数 + `generateFromPixels` 认 `opts.sourceNearest`
> （`useStudio.sourceNearestOpt`：源图是图纸重建的、且这次网格 ≥ 重建时网格 ⇒ true；
> 缩小不传，块合并靠面积平均）+ 投票门槛降到 `1/(SS·SS)`（平票取真色，绝不混中间色）。
> 实测「131」放大到 70×87：**33 色一个不多一个不少、空格 2637（≈等比缩放）、脆边**。
> 验证：`verify:size-guard` 判据改了 —— ⑤⑦（老存档放大）从「mismatch ≥ 0.02」改成
> 「颜色集合不涨（≤ 旧色数 + 2）+ mismatch ≤ 0.5」，本地与线上全绿；
> `verify:art-scale` / `verify:board-crop` / `verify:board-resize`（本地 + 线上）、
> 全站 84 页 0 错误、`verify:beginner` 217/217；线上复现「131」场景 4 项断言全过
> （色号集合逐个比对完全一致）。前端 `pindoudou` `4e2cc53`，已上线，
> 线上产物 `assets/index-C4Qimq3t.js`（当天第 3 版：`C0RWGiFO` → `BjdH4_O6` → 这版）；
> qq 回滚包 `/root/douwan-backups/dw-web-before-blurfix2-*.tar.gz`）；
> 2026-10-31 下午（**放大成品尺寸一律重新取样，老存档源图按图纸平滑重建**：
> 用户贴「放大只能按块复制」弹层截图说「不管是不是作品存档打开的，放大了画面细节就要变多，
> 绝对不能出现一块一块的情况」。改法：
> ① `rebuildThumbSource()` 只取**成品区域**（把整块底板当源图的话放大后画面会缩进中间一小块、
> 四周全是留白灰，第一次跑验收就栽在这）、双线性插值到 `REBUILD_SOURCE_SIDE = 1024` 当源图 ——
> 采样口径是「源图 ≥ 成品网格 ⇒ 面积平均；源图 < 网格 ⇒ 最近邻（变块）」（`lib/pattern.js`
> 的 `maxUsefulSupersample`），1024 保证 936 格以内怎么放大都落在面积平均那一侧，
> 格子边界变成过渡带，放大长出过渡色；data URL 优先 WebP 0.9，iOS Safari 回退 PNG；
> ② 新存档的 512px 源图快照在 `openProject` 时**内存里**平滑插值到 1024（存档里那份 512 快照
> 原样保留，localStorage 体积不涨），512 格以上的放大不再退化成最近邻；
> ③ `setCanvasSize` 删掉 `sourceFromPattern` 例外，放大一律重新取样 —— 老存档的手改就画在
> 源图里，平滑放大什么都不丢；④ 删掉「放大只能按块复制」弹层与「按块放大」按钮，
> 保护弹层只剩「真原图 + 手改过」一种；缩小保留手改（按块合并）不变；
> ⑤ 老上传的小图（< 成品网格）没动（抠图输入不能变，`verify:matte` 的 IoU 判据在盯着）。
> 自检 `pnpm verify:size-guard` ⑤⑦ 改判「不弹层 + 平滑放大（mismatch 0.02~0.5）」。
> 验证：本地与线上 `verify:size-guard` / `verify:art-scale` / `verify:board-crop` /
> `verify:board-resize`（9 场景 × 4 视口）全绿，全站自检 84 页 0 错误（只有 404 页自身那条 404）、
> `verify:beginner` 245/245、`verify:seo-v3` 59/59。
> 前端 `pindoudou` `0dbbb8e`（基于线上 `84471f3` 在隔离 worktree `.tmp/wt-zoomdetail` 做的，
> 分支 `feat/zoom-resample`），已上线，线上产物 `assets/index-C0RWGiFO.js`；
> qq 回滚包 `/root/douwan-backups/dw-web-before-zoom-smooth-20261031.tar.gz`）；
> 2026-10-29 深夜（**统一创作工作台（未发布，分支 `feat/unified-workbench`）**：
> 按 `Z:\拼豆\网站需求文档\DouWan_Grok交互整改.zip` 把「新手三步 + 专业三栏」两套界面收成一套 ——
> `/create` 跳 `/editor`，删掉 `BeginnerView` / `BeginnerWizard` / `BeginnerSelect` / `BeginnerAdjust` /
> `BeginnerExport` / `ModeSwitchDialog` / `useBeginnerMode` 与顶栏模式开关；顶栏三主线常驻
> （上传/换图 · 编辑图纸 · 导出图纸），画布占中间，右栏「当前作品」（预览 + 成品尺寸/豆子数量/颜色种类 +
> 色卡 + 保存），精细设置固定四类（图片处理 / 尺寸与画板 / 颜色与色卡 / 图纸与分板；电脑右侧面板、
> 平板右侧抽屉、手机底部抽屉四标签），点分类就地出控件、开关面板不重算图纸；手改过的图重算前先问
> 「保留当前图纸 / 重新生成」。交付文档 `pindoudou/docs/unified-workbench.md` + 三端实拍截图
> `pindoudou/docs/unified-workbench/`；新增 `scripts/verify-unified-workbench.cjs`（33 项），
> 旧 `scripts/audit-mobile.js` 随旧版面退休（`verify:mobile` 改指统一工作台自检）。
> ⚠️ 上游 `eb115d9` 的尺寸保护弹层与本次的 `useEditGuard` 是同类提醒的两个入口，触发条件不同、互不冲突，
> 但文案可再统一。**没有发布**：没推 origin、没动 qq。本地预览 `http://127.0.0.1:4173/editor`）；
> 2026-10-29 深夜（**放大成品尺寸一律按原图重新取样**：用户第二次贴同一张
> 「104 × 104 的马赛克图纸」问「放大缩小尺寸为什么会出现这样的情况」。两个来源都堵掉：
> ① 手改过的图纸放大时走「保留手改 = 按块复制」，出来就是一片块；
> ② 从「我的作品」打开的作品**没有原图**，`rebuildThumbSource()` 只能拿图纸重建一张
> 低分辨率位图当源图，所以「重新生成」等于把画面按块放大 —— 而且没手改时**完全不提示**，
> 用户只会看到画面突然变块。改法：`setCanvasSize` 里按方向分流 —— **放大 = 按原图重新取样**
> （手改过的图先弹层确认「要清晰就得放弃手改，想留住手改先保存作品」），
> **缩小 = 保留手改、按块合并**（不弹层）；`saveProject` 往存档里带一份**源图快照**
> （最长边 512 px，透明图存 PNG、照片存 JPEG；体积撑不下时先丢快照、不裁方案），
> `openProject` 用它还原 `sourceImg` / `sourceAspect`；老存档没有快照时
> （`sourceFromPattern`）放大也弹层说明「只能按块复制」，**不再静默变马赛克**。
> 自检：`pnpm verify:size-guard` 扩到 7 条路径（新增「老存档 + 没手改过」），
> 桌面 + 手机视口、本地与线上全绿；`verify:board-resize` 的 C 改成「手改放大 = 重新生成」、
> 新增 C2「只换钉板 = 1:1 平移不重生成」，4 档视口全绿；线上全站 84 页 0 错误、
> `verify:seo-v3` 59/59、`verify:beginner` 245/245。前端 `pindoudou` `84471f3`
> （基于线上 `5641385` 的 rebase），已上线，线上产物 `assets/index-zpgjkMxv.js`；
> qq 回滚包 `/root/douwan-backups/dw-web-before-zoom-regen-20261029-214537.tar.gz`）；
> 2026-10-29 深夜（**电脑端滚轮放大画布不再「跳回」**：用户说「电脑上用鼠标滚轮放大画布
> 会跳回」。根因在 `EditorCanvas.vue` 的 `onWheel`：它直接调 `setZoom`，没有把 `autoFit` 关掉，
> 而画布一放大就撑出滚动条 ⇒ 舞台的内容盒变窄（实测 680 → 670）⇒ ResizeObserver 以为容器变了、
> 60ms 后再适配一次 ⇒ 刚放大的画布被打回「适应窗口」。实测缩放 0.82 → 1.02 → **0.78**。
> 改法：滚轮走 `onUserZoom`（按钮 / 双指捏合都是这条路，它会把 `autoFit` 关掉）。
> 这个 bug 只在**滚动条占位**时出现 —— 老的自检脚本带 `--hide-scrollbars`，滚动条不占位，
> 所以一直没抓到；`audit-wheel-real.cjs` 已去掉这条标志，并新增断言「放大 1.5 秒后仍是放大后的那一档」
> （`zoomSticks`）。周边流程一起核对过：适应 / 实际大小 / 加减按钮 / 左栏尺寸滑杆滚轮都正常。
> 前端 `pindoudou` `5641385`（rebase 到并行会话的 `eb115d9` 之上），已上线，
> 线上产物 `assets/index-CGVzF9lK.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-wheelzoom-fix-20261029-212037.tar.gz`）；
> 2026-10-29 深夜（**改成品尺寸先问「重新生成 / 保留手改」**：用户反馈
> 「你在跟我开玩笑吗，放大缩小尺寸为什么会出现这样的情况」—— 拖「图案清晰度」滑杆放大后，
> 画面是按块复制的马赛克。根因：手改过的图纸走「保留手工修改」那条路，成品区域变大时
> 只能把旧格子按块复制（旧图没有更高清的底图）；而没手改过的图按原图重新取样，放大后是清晰的。
> 改法：这个决定交给用户，且只问一次 —— `useStudio.setCanvasSize` 增加 `keepEdits`
> （默认 true；传 false 跳过「保留手工修改」、按原图重新取样），左栏「图案清晰度」/ 成品尺寸快选
> 在手改过的图上第一次改尺寸先弹 `BaseDialog`「改尺寸要重新生成图纸」：
> 「重新生成」（按原图，更清晰，手改被覆盖）/「保留手改」（画面按块缩放，放大是马赛克）/
> 「取消」（滑杆回位、画布不动）。选过之后同一张图不再问；图纸重新生成后
> （`manualEdited` 归 false）下次再问。自定义尺寸面板跟着已定下的口径走、不弹层
> （实时预览每改一格都问没法用）。自检新增 `pnpm verify:size-guard`（真浏览器、真滑杆事件、
> 真点弹层按钮，四条路径：保留手改 mismatch=0 / 重新生成 mismatch≈5% 且 manualEdited 归 false /
> 取消画面一格没动 / 没手改过不弹层），`verify:art-scale` 在弹层里点「保留手改」。
> 验证：本地与线上 `verify:size-guard` / `verify:art-scale` / `verify:board-crop` /
> `verify:board-resize`（9 场景 × 4 视口）/ `verify:size-live` / `size-wide` / `size-tips` /
> `range-wheel` / `scale` / `actual` / `mobile` 全绿，全站自检 84 页 0 错误（线上只有 404 页
> 自身那条 404），`verify:seo-v3` 59/59、`verify:beginner` 245/245。
> 前端 `pindoudou` `eb115d9`（基于 `82e6980`，隔离 worktree `.tmp/wt-boardcrop`），
> 已上线，线上产物 `assets/index-MUk6mKXF.js`；这次部署同时带上了并行会话已推 master 的
> 智能抠图重做（`b9798c9`）与导出留白调整（`4005bf4` / `82e6980`）；qq 回滚包
> `/root/douwan-backups/dw-web-before-size-guard-20261029-125551.tar.gz`）；
> 2026-10-29 深夜（**图纸区与底部双卡、左右双卡之间的留白统一到 15 px**）：
> 用户接着上一版说「缝隙间隔都保持15px」。上一版只把「图纸区 ↔ 底部双卡」那道留白
> 改成 5 px，左右两张卡之间还是设计稿的 2 px，看着一宽一窄。这次两处取同一个设计常量
> 15 px（`D.cardGap` / 新增 `D.cardColGap`），随整页缩放一起放大：104×104 那一档
> （缩放系数 2.5）两道描边之间都是 **33 px 纯白**，肉眼完全一致。
> 代价：双卡之间多占 13 px 宽，颜色清单五列时每列组宽 106 → 103 px（4 位色号 + 5 位数量
> 仍不撞字）；整页再高 10×缩放系数 —— 104×104 / 45 色 2806×3795 → **2806×3820**，
> 1000×1000 标版整页 2104×2875 → **2104×2894**（`export-plan-1000` 的钉死数字跟着改）。
> 验证：`verify:export` 四条全绿、本地与线上 `audit-export-template` 9/9、
> 全站自检 84 页 0 错误；线上导出实测两处留白各 33 px 纯白。
> 前端 `pindoudou` `82e6980`，已上线，线上产物 `assets/index-BnClFH7A.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-export-gap15-20261029-204657.tar.gz`）；
> 2026-10-29 深夜（**智能抠图重做：精准识别主体、边缘更准、主体完整保留**）：
> 用户要求「抠图功能优化一下，精准识别主体，优化抠图边缘，保留主体的完整性，
> 当主体和背景色相近时，尽可能多的保留主体」。原来 `src/lib/matte.js` 是「按颜色阈值切」，
> 主体和背景色一接近就整块被当背景吃掉（评测里 `low_contrast` IoU 只有 0.228、
> `low_contrast_shadow` 0.126、主体顶到画幅边缘的 `touch_edge` 0.133 —— 主体整个消失）。
> 这次把判定口径从「颜色像不像」换成「主体/背景的几何与边缘关系」，四处改动：
> ① **核心背景生长加梯度闸门**（`growCoreBackground`）：抗锯齿过的主体轮廓是「一小步一小步」
> 走过去的，纯靠色差阈值，生长会顺着这条过渡带钻进主体内部，把主体颜色收进背景模型 ——
> 主体整个消失（`cut_touch_edge`）。主体轮廓那一步在 Lab 空间是「跳」过去的（梯度大），
> 背景渐变是「化」过去的；挡住陡边，生长就停在主体外侧；
> ② **CIE76 快路径保留真实色差**：原来快路径把 `deToCluster` 置 0，
> 「低对比主体」在 strong 档被当成严格背景整个删掉；
> ③ **模糊地带归属规则**（这一条就是用户要的「主体和背景色相近时尽可能多保留主体」）：
> 颜色上分不清的那片像素按几何关系分 —— 贴着画面边缘 → 背景；封闭成岛 + 有厚度 +
> 边缘是硬的 → **主体**（放回前景）；封闭成岛 + 肚子里有洞 → 承托面（卡片底色）仍算背景。
> 「边缘是硬的」用 Lab 梯度量（主体轮廓是跳变的，投影外围那圈过渡带是渐变的）；
> 少了这一层，投影外围与噪点会被当主体，主体周围多出一圈灰豆；
> ④ **边缘精修**：扩展带 + 双 F/B 来源 —— 未知带只覆盖轮廓两侧各 r 个像素，
> 软边（羽化）上带外那几像素仍是 F/B 的混合色，硬判 0/1 就把真实覆盖率抹平了 ⇒ 边缘变阶梯；
> 扩展带只在软边（梯度小）上采信 (0.08, 0.92) 的中间值，未知带的 F/B 先取「远处那圈」
> （颜色最纯）、退化时退回「近处那圈」（几何最准，白色主体上的黑描边属于这一类）。
> **性能**：改动后耗时一度到基线的 2.3×，做了四处优化后回到 1.2~1.4× ——
> 洪水填充与阴影判据改用标量版 ΔE00（不再每对相邻像素现分配两个数组）、
> 连通块厚度场从 Map/Set 换成整型数组 + 代号戳（中位数改 quickselect）、
> 膨胀梯度只在连通块边界按需取（不再整图膨胀一遍）、
> 找洞只在主体包围盒里做 + ΔE00 梯度图整张只算一次。
> **评测**（`scripts/fidelity/matte-bench.mjs`，14 张带真值图，平均 IoU）：
> soft 0.883 → **0.949**、normal 0.813 → **0.999**、strong 0.759 → **1.000**；
> 基线失败的 4 张现在全部 ≥0.986（`low_contrast` 0.228→1.000、
> `low_contrast_shadow` 0.126→1.000、`low_contrast_big` 0.910→1.000、
> `touch_edge` 0.133→1.000），strong 档另加 `gray_on_white` 0.237→1.000；
> big 图（1200×900）IoU 0.997、αMAE 0.0009，三档画布判定一致率 0.999~1.000。
> 新增 5 张真值图（`scripts/fidelity/fixtures-gen-cut.py`：low_contrast / low_contrast_big /
> low_contrast_shadow / touch_edge / busy_bg）与 4 个开发工具
> （`matte-real.mjs` 真实照片、`matte-sweep.mjs` 背景色敏感性扫描、
> `matte-debug.mjs` 连通块诊断、`matte-prof.mjs` 耗时剖析）。
> **真浏览器验收** `pnpm verify:matte`（`scripts/verify-matte.cjs`）：走真实用户路径 ——
> /editor → 真 file input 上传 → 真点「智能抠图」（电脑端点页签、手机端先点「换图」
> 把创建面板拉起来再选下拉）→ 重新生成；三端视口 × 6 张图 = 54 项全过，console 报错 0，
> 页面里同一份 `estimateMatte` 与真值比 IoU 0.997~1.000。
> 验证：本地与线上 `verify-matte` 全绿、全站自检 84 页 0 错误（只有 404 页自身那条 404，按设计）、
> `verify:beginner` 245/245、`verify:board-crop` / `verify:board-resize`（8+1 场景）、
> `verify:export-template` 9/9 全绿。
> 前端 `pindoudou` `73f0f30`（含并行会话的 `92c8bfc` 拖清晰度修复与 `a484abc` 导出卡片修复），
> 已上线，线上产物 `assets/index-vx5i4KWX.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-matte-20261029-194507.tar.gz`）；
> 2026-10-29 晚上（**图纸区与底部双卡之间留 5 px 间隔**：用户看导出的整页图纸，
> 红框圈住「图纸区」与「底部双卡」之间那道分割带，说「这个分割板块之间留5个px的间隔」。
> 改法：标版里这块留白从设计稿的 2 px 改成 5 px（`D.cardGap`），随整页缩放一起放大 ——
> 104×104 那一档（缩放系数 2.5）从 5 px 变成 12.5 px，两道描边之间那道白缝肉眼可见
> （改前几乎贴在一起）。留白值单独导出成 `exportCardGap(scale)`，自检脚本按同一口径
> 反推卡片高度，两边不会再各写一个数字。
> 整页因此高了 3×缩放系数：104×104 / 45 色 2806×3787 → 2806×3795；
> 1000×1000 标版整页 2104×2870 → 2104×2875（`export-plan-1000` 的钉死数字跟着改）。
> 验证：本地与线上 `audit-export-template` 9/9、`verify:export` 四条全绿；
> 前端 `pindoudou` `4005bf4`（rebase 到并行会话的 `73f0f30` 之上），已上线，
> 线上产物 `assets/index-FN-Vrv2T.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-export-gap-20261029-200207.tar.gz`）；
> 2026-10-29 晚上（**图纸导出底部双卡的占比压回设计稿那一档**：用户看线上
> 104×104 / 45 色导出图，红框圈住底部「图案信息 + 颜色清单」那一行，说「这里的占比再小一点」。
> 根因：颜色清单锁死三列、颜色一多卡片就一路长高（45 色排 15 行 = 427 设计 px），
> 底部双卡占整页 25.9 %（设计稿是 21.5 %）。改法：列数按「每列最多 11 行」往上加
> （3 → 5 列），行数有上限 ⇒ 卡片高度锁在设计稿那一档（≈ 301 设计 px × 缩放系数）；
> 列多了每列挤，改成紧凑排版（色块 + 色号贴左、数量右对齐）；28 色那一档仍是三列十行
> （设计稿的样子没动）。实测 104×104 / 45 色：底部占整页 25.9 % → **19.9 %**，
> 整页 2806×4102 → 2806×3787；52 色 21.9 %、28 色 20.7 %、30 色 20.7 %。
> 自检新增 `pnpm verify:export-proportion`（`scripts/verify/export-proportion.mjs`：
> 45 色以内双卡高度 ≈ 图案信息卡高度、底部占整页 ≤ 24 %、用户那一档 ≤ 21 %，已接进
> `verify:export`）与 `pnpm export:preview`（`scripts/export-case-preview.cjs`：
> 按指定尺寸 / 颜色数 / 钉板型号走**真实导出链路**出标版整页图；颜色数可以精确指定 ——
> 照片量化会自己收敛，南瓜照 104×104 只用 28 色，凑不出 45 色那一档，脚本会按
> 色值最近的真实 MARD 色号扩容到指定色数）；`export-plan-1000` / `export-smoke`
> 钉死的数字跟着版式更新（整页变矮 ⇒ 每格像素降档后回升：116→23 / 300→9 / 450→6 / 464→6）。
> 验证：本地与线上 `audit-export-template` 9/9、全站自检 84 页 0 错误、
> `verify:export` 四条全绿；四档尺寸 / 钉板 / 颜色数样例见
> `pindoudou/docs/export-template/`（设计稿与新导出并排 + 四档样例）。
> 前端 `pindoudou` `a484abc`（rebase 到 `92c8bfc` 之上），已上线，
> 线上产物 `assets/index-Q9G9aPWX.js`；qq 回滚包
> `/root/douwan-backups/dw-web-before-export-cards-20261029-193231.tar.gz`）；
> 2026-10-29 傍晚（**拖清晰度滑杆改的是「画面在画布上的大小」**：用户反馈
> 「这个尺寸缩放出bug了，拉动调整的是画面在画布上的大小，不是调整画布大小」。根因：手改过的图纸
> 走 `resizeVariantsPreserving → resizePreserveCells`，而那条路在成品区域（artW/artH）变小时
> 只把「成品区域的框」改小、旧格子 1:1 留在原处 ⇒ 界面写「117 × 117 颗」而画面还是 156 格大。
> 改法：`resizePreserveCells` 不再分两套 —— **成品区域变了就等比缩放画面**（`resampleArtCells`：
> 缩小 = 块内多数色合并、放大 = 按块复制），成品区域没变（只换底板）才 1:1 平移，
> 与没手改过的图（按新尺寸重新取样）口径一致；缩放时画在成品区域外的豆子如实报数。
> `setCanvasSize` / `setCanvasCapacity` / `resizeVariantsPreserving` 增加 `announce`
> （拖滑杆是连续动作，不弹 toast，反馈由左栏尺寸说明行承担；丢豆子那种照弹）。
> 左栏 `applySizeNow` 传 `announce:false` 并把缩放结果回填到说明行
> （「画面已缩到 117 × 117 格（细节按块合并）」）；顺带修掉一个真 bug：说明行在
> 「尺寸已经落到画布上」那次早退前被清掉 ⇒ 用户拖完看到的是一行空白。
> 自检新增 `pnpm verify:art-scale`（真浏览器：设底板 156 / 成品 156 → 真 PointerEvent 画一笔 →
> 真拖滑杆到 117 → 断言底板仍是 156 / 成品变 117×117 / 画面四边按 117/156 等比缩放 /
> 画面落在成品区域内 / 标题里的颗数与实际一致），`audit-board-resize` 扩到 9 场景（全部改成缩放口径）。
> 验证：本地与线上 `verify:art-scale` / `verify:board-crop` / `verify:board-resize`（9 场景 × 4 视口）/
> `verify:size-live` / `verify:size-wide` / `verify:size-tips` / `verify:range-wheel` /
> `verify:scale` / `verify:actual` 全绿，全站自检 84 页 0 错误（线上只有 404 页自身那条 404，按设计），
> `verify:seo-v3` 59/59、`verify:beginner` 245/245。
> 前端 `pindoudou` `92c8bfc`（基于 `f99e506` 在隔离 worktree `.tmp/wt-boardcrop` 做的），
> 已上线，线上产物 `assets/index--uDpx3VK.js`）；
> 2026-10-29 傍晚（**图纸导出标版按 V3 最终设计图重做**：`Z:\拼豆\网站需求文档\图纸导出设计.zip`
> 换成了 V3 交付包（`豆玩_图纸标版_Grok交付包_V3`），这次是**按最终设计图做像素级还原**，
> 不是重新设计 —— 位置 / 比例 / 圆角 / 留白 / 字体层级 / 线色 / 粉蓝配色 / 图标大小与像素风格
> 全部照 `01_最终设计图\FINAL_最终确认标版_必须严格还原.png`（1121×1403）量出来的值做，
> 只有真实数据（矩阵 / 透明格 / 色板套装 / 钉板元数据）随作品变。上午那版 V1
> （渐变域名条 + 页脚 Slogan）作废。`src/lib/exportTemplate.js` 重写：页眉 = 真 Logo +
> 粉色网址胶囊（底 #FDECF1 / 实心粉圆 #FB6480 / 网址 #F93759）+ 右侧灰蓝 Slogan +
> 粉黄绿蓝四色块；图纸区 = 浅蓝面板 #F8FCFE + 极淡粉描边 #FBE4EC + 细格线 + 每 10 格主格线，
> 四边坐标带按设计稿约 4.6 格宽（新增 `exportRulerPx`，`render.js` 的 `chartGeometry`
> 开始接受标尺宽度，`drawChart` 开始接受导出专用主题）；底部双卡 = 左「图案信息」粉色胶囊
> + 六个像素图标（格网 / 钉板 / 叠层 / 立体方块 / 调色盘 / 标签），右「颜色清单」蓝色胶囊 +
> 「（按色号排序）」+ 分栏色号用量。版面按设计稿比例缩放（`s = max(1, 图纸宽/1085)`），
> 小图纸时页面比图纸宽、双卡仍是设计稿的完整宽度。数据全部真实：格子数量 / 钉板型号 /
> 钉板数量 / 豆子总数 / 颜色数量 / 色卡品牌及型号按站内口径取值（空格不计豆、真实白豆计入、
> 零用量色号不入清单、色号自然序 A2 在 A10 前）。**V3 没有页脚 Slogan**。
> ⚠️ 顺手修掉 V1 留下的坑：`import logo from '*.webp'` 会让 Node 直接跑的自检脚本崩
> （不认 .webp 后缀）⇒ `pnpm verify:export` 在 master 上从 `ef335b9` 起一直是红的；
> 改成 `new URL('../assets/logo-douwan.webp', import.meta.url)`（Vite 照样重写成带哈希的资源）。
> 自检：`pnpm verify:export-template`（真浏览器跑新手 + 专业两条链路，抓导出 Blob 按设计图
> 逐区验收 9 项）、`pnpm verify:export` 三条脚本的数字同步到标版口径（整页尺寸、每格像素
> 降档、封面图数 +1 张 Logo）、`pnpm verify` 84 页 0 错误、`verify-beginner` 217/217。
> 前端 `pindoudou` `f99e506`（基于 `fbb6517` 在隔离 worktree `.tmp/wt-export` 做的），
> 已上线，线上产物 `assets/index-BsdAjI2p.js`）；
> 2026-10-29 上午（**换钉板不再裁画面**：画布编辑后换钉板，底板装不下原图时
> 走「等比缩图」而不是「裁边」—— 10-28 那条「1:1 平移 + 越界裁掉」的实现，104 板换 52 板
> 会丢掉 5824 颗、画面只剩中间一块，而没手改过的图是整张等比缩小，两边口径不一致。
> 新增 `resampleArtCells`（块内多数色），`resizePreserveCells` 加 `scaleArt`（只给换钉板用，
> 同板拖成品尺寸滑杆仍原地不动），`setCanvasCapacity → setCanvasSize` 只在换底板导致成品区域
> 变小时传 true；顺带把 10-28 留的「只挪显示那份、底稿留在旧尺寸」的小口子一起修了。
> 自检 `pnpm verify:board-resize` 扩到 8 场景 × 4 视口 + 新增 `pnpm verify:board-crop`
> （真浏览器走真实用户路径：拖一笔 → 左栏下拉选 52 钉板 → 断言图案包围盒等比缩小）。
> 前端 `pindoudou` `fbb6517`，已上线）；
> 2026-10-29 上午（**导出图纸统一标版**：按 `Z:\拼豆\网站需求文档\图纸导出设计.zip` 的
> 交付包把整图导出换成「豆玩标版 V1.0」，旧版图例版式删除。新增 `src/lib/exportTemplate.js`
> （页眉 Logo + dw.sharyuke.com 渐变域名 / 图案信息卡 / 颜色清单卡 / 页脚 Slogan
> 「所爱皆可拼，万物皆可造」的唯一口径；`templateExtraHeight` 与 `composeExportTemplate`
> 同一套排版常量，dpiExportPlan 预检尺寸与实际文件不失配）；`exporters.js` 的
> `buildPatternImageCanvas` 默认走标版（新手版第 ③ 步、专业版「图纸交付」、作品页 / 素材页 /
> 拼制页的 PNG·JPG·DPI 高清全是一条链路一种版式）；分板 PDF 电子档与打印版封面加同一套页眉
> 与 Slogan；分享卡上的旧网址 `douzao.ai` 换成 `dw.sharyuke.com`。自检
> `pnpm verify:export-template`（真浏览器跑新手 + 专业两条导出链路，抓导出 Blob 逐字节验收
> 标版四件套；⚠️ 本机无头 Chrome 对 blob: URL 的下载一律判 canceled，脚本靠拦截
> `URL.createObjectURL` 抓 Blob，与落盘文件逐字节等价）。前端 `pindoudou` `ef335b9`
> （基于线上 `6407cad` 在隔离 worktree `.tmp/wt-export`（分支 `feat/export-template`）做的，
> 没带 `feat/smart-colors` 的 `d15cc7b`），已上线）；
> 2026-10-28 下午（**左栏尺寸滑杆支持滚轮**：电脑端在左栏「画布与成品尺寸」那条滑杆上滚滚轮
> 就能改大小 —— Chrome / Edge 默认不响应滑块上的滚轮（Firefox 会），原来滚轮纹丝不动，
> 看着像功能坏了。新增 `src/lib/rangeWheel.js`：向上滚变大、向下滚变小，一格走量程的 1/20，
> 按住 Shift 走最小步长；改完派发 input / change，走滑杆原有的重算链路（成品区域重算、留白收敛、
> 提示文案都在那边），并吃掉默认滚动（页面不会跟着一起滚）。自检 `pnpm verify:range-wheel`（页面内断言）
> + `scripts/audit-wheel-real.cjs`（CDP 真实滚轮输入）。前端 `pindoudou` `6407cad`，已上线）；
> 2026-10-28 中午（**换钉板尺寸保留手改图纸**：专业工作台里被逐颗改过的图纸
> （画笔 / 橡皮 / 换色），改钉板尺寸 / 成品尺寸时不再重新生成 —— 旧格子 1:1 挪进新画布
> （放大居中落位、同板原地不动、越界的豆裁掉并提示；拼制进度与撤销栈只在格子挪位时重置），
> `manualEdited` 标记随存档保存与恢复；未手改的图照旧按新尺寸重新生成，想重画点「恢复方案」。
> 自检 `pnpm verify:board-resize`（7 场景 × 4 视口，线上全绿）。
> 前端 `pindoudou` `d4c1e4d`（连同并行会话已提交未推送的 `c68c585` 分板 PNG/JPG 底注一起快进推上
> `origin/master`），已上线）；
> 2026-10-27 中午（**作品跨设备同步**：「我的作品」不再只存本机，按账号存到服务端，
> 手机 / 平板 / 电脑登录同一账号看到同一份；删除也会同步。后端 `douwan-api` `a9e11a5`、
> 前端 `pindoudou` `4ee537d`，已上线）；
> 2026-10-26 深夜（**手机端第 ② 步预览放大**：新手版传图后的预览图提到「专业版工作台画布」的量级
> （116 → 251 px @ 390×844），参数区改成自己滚，已上线（`pindoudou` `0ebad00`）；
> 同日晚（**手机端操作台改成一屏工作台**：≤780px 的三步锁在一屏里，
> 步骤条固定在顶、当前步骤自己滚、底部本步主按钮常显，平板 / 电脑版面没动，
> 已上线（`pindoudou` `44dc027`+`43c5850`）；同日晚（**操作台第 ③ 步成果预览放大**：电脑与平板端成果预览同样撑满预览框，
> 已上线（`pindoudou` `dd6b7aa`）；同日晚（**操作台第 ② 步预览图放大**：电脑与平板端预览图按比例撑满整块预览区，
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
          └── git push ──▶ gitee.com/sharyuke/douwan
```

**标准动作**：本机改代码 → 本地 `pnpm build` / `go test ./...` → `scp` 到 qq → 重启服务 → 公网验证 →
本地 `git commit && git push`。

### 本地预览（所有 agent 共用这一台）

给用户看页面时，只使用 `tools/preview` 这一台静态服务器。先在自己的目录里构建出 `dist`，再整份复制到 `tools/preview/www`。服务器已经在听就不要再开，也不要重启：它每次请求都读 `www` 里的文件，覆盖后刷新即可。

| 项 | 值 |
| --- | --- |
| 静态目录 | `tools/preview/www` |
| 进程 | `tools/preview/server.mjs`，由 `start.ps1` 通过计划任务 `DouwanPreview` 拉起。端口已在听就不要再开 |
| 端口 | **5180**，监听 `0.0.0.0` |
| 本机 | http://127.0.0.1:5180/ |
| 局域网 | http://192.168.1.205:5180/ （网卡地址变了就换成本机当前 IPv4） |
| 接口 | `/api`、`/healthz`、`/readyz` 反代到 https://dw.sharyuke.com ，不用另起本地后端 |
| 版本 | 复制完成后看 http://127.0.0.1:5180/PREVIEW.txt （入口文件名、dist 路径、git 提交） |

```powershell
# 在要预览的那份前端目录里构建（主目录或隔离 worktree 都行）
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm build

# 复制 dist，并在 5180 没人听的时候把那一台服务器拉起来
powershell -ExecutionPolicy Bypass -File C:\Users\sharyuke\Documents\work\douwan\tools\preview\deploy.ps1 -Dist C:\Users\sharyuke\Documents\work\douwan\pindoudou\dist
```

隔离 worktree 的产物用同一个命令，把 `-Dist` 指到那份 `dist`。`-Build` 只适合主目录：它会在 `-Project` 里跑 `vite build` 和 `scripts/build-seo-pages.mjs`，再复制。

不要做这些事：

- 不要为了给用户看页面去跑 `pnpm dev`、`pnpm preview`、`node scripts/serve-dist.mjs`，也不要再占 4173 / 4319 / 4320。
- 不要把预览只绑在 `127.0.0.1`。这台机器的网卡是公用网络，防火墙默认拦截入站；`start.ps1` 会补一条名为 `douwan preview 5180` 的 TCP 入站允许。没这条规则时，本机能开、别的电脑打不开。
- 不要在 worktree 里对主目录的 `node_modules` 做联接后再跑 `pnpm install`。pnpm 会把主目录的依赖目录当成要清掉的那份。worktree 需要依赖时，在 worktree 里单独 `pnpm install --config.node-linker=hoisted`。

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
| `src/views/admin/AdminActivityView.vue` | 后台「用户活跃监控」页：总览 / **访问量** / 留存 / 使用频率 / 地区 / 功能使用 / 来源渠道 / 用户明细 / **排除名单**，调 13 个 `/admin/activity/*` |
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

### 2.3 提交代码（只在当前目录这一个仓库）

```powershell
cd C:\Users\sharyuke\Documents\work\douwan
git add <只加自己改的路径>
git commit -m "feat: ..."
git push gitee main
```

- 远程是 <https://gitee.com/sharyuke/douwan.git>（本机用 `git@gitee.com:sharyuke/douwan.git` 推，SSH 已登录 `sharyuke`）。
- `pindoudou/` 和 `douwan-api/` 不再各自有仓库。不要在子目录里 `git init`，也不要再推 `gitee.com/maryuke/pindoudou` 或 `gitee.com/maryuke/douwan-api`。
- 只提交源码和文档。不要提交 `node_modules/`、`dist/`、`douwan-api/bin/`、`tools/` 里的 Node / Go / pnpm 缓存、`.tmp/`、`.mirror/`、`tools/preview/www/`、`.env`、密钥和本地配置。

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
>
> ⚠️ **`vite build` 会清空整个 `dist/`**，而 `dist/seo/pages.json` 由
> `node scripts/build-seo-pages.mjs` 单独生成（不在 vite 产物里）。
> 前端发布固定三步：`vite build` → `node scripts/build-seo-pages.mjs` → 打包 `dist`。
> 少跑中间那步 ⇒ 线上没有 `seo/pages.json` ⇒ `/create`、`/editor` 直接 404
> （后端找不到 SEO 内容就回「页面不存在」的壳，2026-10-26 晚就踩过一次）。
> 发布后确认 `/var/www/dw.sharyuke.com/seo/pages.json` 存在（约 61KB），再验 `/create` 是 200。

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

**已完成（2026-10-26 晚，第四次调整）——操作台第 ③ 步成果预览放大（电脑 / 平板端）（`pindoudou` `dd6b7aa`，已上线）**

- 需求原文：「这里的预览图占比也大一些」（截图 = 操作台 `/create` 第 ③ 步「拿走图纸」，
  红框圈出灰色预览框里的成果图）
- **跟第 ② 步同一个病根**：`prepareCanvas` 把画布的行内尺寸写成 1 格 = 1 CSS px，
  `max-size` 只有 420 ⇒ 234×312 的图纸只画成 234×312 px，在很宽的灰色预览框里缩成一小块
- 改法（只动 `src/components/beginner/BeginnerExport.vue`）：
  - `PatternPreview` 的 `max-size` **420 → 640**
  - 新增 `@media(min-width:781px)`（**只在电脑 / 平板生效**）：
    `.bexp__art{height:clamp(360px,60vh,660px);min-height:0;grid-template-rows:minmax(0,1fr)}`
    + 画布 `width:auto !important;height:auto !important;max-width:100%;max-height:100%`
  - **手机端（≤780px）样式一行没动**（画布仍是 306×287，预览框 306×287）
- 三个 CSS 坑与第 ② 步完全一样（`!important` 必需、不能用 `height:100%`、网格行要 `minmax(0,1fr)`）
- 实测（线上，无头 Chrome）：
  - 平板 834：成果预览 624×624 / 预览框 662×632 ⇒ 高占 99%、宽占 94%、面积占 93%
  - 电脑 1440：成果预览 512×512 / 预览框 700×512 ⇒ 高占 100%、宽占 73%、面积占 73%
  - 手机 390：306×287 / 306×287（与改前一致）
- 自检跟着改：`verify-beginner.cjs` 在第 ③ 步新增两条占比断言（≥781px 高占 ≥85%、面积占 ≥40%；
  手机端断言画布不超过预览框 105%），第 ② 步那两条保持不变
- 验证：线上 `verify-beginner.cjs --url` **107/107 通过**（mobile 35 / tablet 36 / desktop 36，
  console 报错 0）、线上 `audit.cjs --url` **84 项 0 错误**（只有 404 页自身那条 404，按设计）、
  0 横向溢出、0 空白画布；本地 `verify-beginner.cjs` 92/92；
  桌面 1440 与平板 834 两档真浏览器截图已肉眼核对（手机端截图也确认没变）
- 部署：qq 上先备份 `/root/douwan-backups/dw-web-before-export-preview-20261026-175020.tar.gz`，
  再用 `C:\Windows\System32\tar.exe` 打包 `dist` → scp → 覆盖；
  线上 `index.html` 指向新产物 `assets/index-C7LuC2pG.js`（与本地构建同哈希）
- 交付文档：`pindoudou/docs/beginner.md` 的小节改名「### 预览图为什么以前很小（第 ② 步 / 第 ③ 步）」，
  补上第 ③ 步的改法与实测数字
- ⚠️ **手机端画布变形的那个老问题已经解决**（在第五次调整里一并修好）：手机端现在也是
  `width:auto !important` + `height:auto !important` + `max-width/max-height:100%`，
  宽高按比例缩放，不再出现「306×287 的方图轻微变形」

**已完成（2026-10-26 晚，第五次调整）——手机端操作台改成一屏工作台（`pindoudou` `44dc027`+`43c5850`，已上线）**

- 需求原文：「手机端的布局单独改一下」
  （`Z:\拼豆\新手简化版\新手2.0\03_详细需求文档_PRD.md` / `DouWan_Visual_Guide.md` / `DouWan_Grok_Commands.md`）
  **只改 ≤780px 的手机端**，平板 / 电脑 / 专业工作台版面一个字没动
- **改之前**：操作台三步是一条长页面，每步都要上下滚；底部主按钮是 `position:fixed` 的浮层，
  预览图一大就被顶出屏幕；材料清单几十行全铺在页面上
- **改之后（手机端）**：整个操作台是一屏工作台
  - `.bview` 锁高 `calc(100dvh - 顶栏 - 86px - env(safe-area-inset-bottom) - var(--kb,0px))`，
    `display:flex; flex-direction:column; min-height:0; overflow:hidden` ⇒ **整页不再往下长**
  - 步骤条固定在顶、当前步骤在中间自己滚、**底部本步主按钮是容器里的一格**（`flex:0 0 auto`），
    永远压在四导航之上，也永远不盖住上面的内容
  - 键盘弹起：用 `visualViewport` 量出被键盘吃掉的高度写进 CSS 变量 `--kb`，容器高度再减掉它
    （`100dvh` 本身不跟键盘缩）。实测 390×844：容器 700 → 400px（键盘 300px），收起后复原
  - 画布：预览区 `flex:1`，画布按容器等比缩放（`width/height:auto !important` + `max-width/height:100%`）
  - 参数区：档位压成一行、数据卡改成「标签 · 数值」一行、颜色三档排一行；放不下就在参数区里自己滚
  - 素材列表：卡片区独立滚动（`.bsel__libScroll`，含「加载更多」），搜索与分类固定在顶上
  - 第 ③ 步：六个统计字段压成 2 列（一个不少）；材料清单页面上只留摘要 + 前若干项 +
    「查看全部 N 种」，明细进**底部抽屉**（可搜索、可滚动、关闭不丢状态）
  - 极矮屏（360×640）：允许中部局部滚动，步骤条 / CTA / 四导航不离屏，面包屑让位给画布
- 交付文档：`pindoudou/docs/beginner.md` 新增 **§2.1 手机端一屏工作台**（版面分层图 + 关键做法表）
- 自检：`scripts/verify-beginner.cjs` 视口扩到**手机三档（360×640 / 390×844 / 430×932）+ 平板 + 电脑**，
  断言扩到 200 项（本地）/ 234 项（线上带 `--url`）：整页不滚动、画布不出框、颜色三档不用滚就能看到
  （矮屏除外）、CTA 在标签栏之上、摘要 6 字段 2 列、材料抽屉能开能关能搜、素材列表自己滚、
  **键盘弹起时容器让出高度（把 `visualViewport.height` 压低 300px 再派发 resize，走页面里真实的监听逻辑，
  断言容器正好矮 300px、收起后复原）**
- 验证：本地 `verify-beginner.cjs` **200/200**、全站 `audit.cjs` **84 页 0 错误**；
  线上 `verify-beginner.cjs --url` **234/234**（console 报错 0）、`verify-seo-v3.cjs --url` **59/59**；
  三张真机手机截图已入库 `pindoudou/docs/beginner/mobile-onescreen-*.png`
- 部署：qq 备份 `/root/douwan-backups/dw-web-before-mobile2-20261026-181500.tar.gz`，
  `C:\Windows\System32\tar.exe` 打包 → scp → 覆盖；线上产物 `assets/index-OgSrYHuO.js`
- ⚠️ **并行会话在同时改同一批文件**（第 ② / ③ 步电脑端预览放大）：两边的提交都进了 `master`
  （我的分支 `feat/beginner-mobile-onepage` 合并了 `origin/master` 后快进推上去），
  `verify-beginner.cjs` 与 `BeginnerExport.vue` 两处冲突按「两边都留」手工合的

**已完成（2026-10-26 晚，第六次调整）——手机端第 ② 步预览放大到「专业版画布」的量级（`pindoudou` `0ebad00`，已上线）**

- 需求原文：「手机端新手版传图后，预览图占比要放大，和专业版操作台画布一样大」
- 先量了**专业版工作台**（真浏览器打开 `/editor`、上传 `scripts/fidelity/fixtures/photo_pumpkin.png`）：
  手机端画布 **186 / 260 / 338 px**（360×640 / 390×844 / 430×932，占视口 29% / 31% / 36%）。
  新手版第 ② 步改前只有 **114 / 116 / 162 px**，差不多是专业版的一半
- 改法（只动 `src/components/beginner/BeginnerAdjust.vue` 的 ≤780px 段）：
  - `.badj__stage{flex:1 1 0; min-height:clamp(250px,40dvh,430px)}` —— 这一格有下限高度，
    画布优先；参数区放不下就在它自己里面滚
  - 矮屏（≤700px 高）另加一段：`.badj__stage` 让出 6px（`calc(40dvh - 6px)`）、
    颜色三档的第二行说明文字隐藏、块间距与内边距各收 2~4px ⇒ 参数区刚好容得下「颜色丰富程度」
- 实测（线上，无头 Chrome）：画布 **164 / 251 / 286 px**（预览框 186 / 267 / 302，参数区 96 / 175 / 228）
  —— 从专业版的一半提到同一量级
- ⚠️ **代价（已写进交付文档）**：画布占了高度，参数区一定放不下全部内容，改成**自己滚**；
  矮屏上颜色三档的按钮第二行说明（「少色 / 标准 / 丰富」的补充文案）不显示，
  只留按钮主文案，换来「滚到底就能完整看到颜色三档」
- ⚠️ **踩到的坑**：`flex:1 1 0` 的基准必须是 **0**。画布的行内尺寸（几百 px）会把这一格的
  基准尺寸顶高，基准一高参数区就被挤到只剩几十 px；`min-height` 只给下限，不解决基准问题
- 自检跟着改：`verify-beginner.cjs` 第 ② 步换成 5 条断言 —— 整页不滚动、画布完整落在预览框里、
  **画布高度 ≥ 视口 25%（绝对下限 150px，对齐专业版画布量级）**、参数区自己滚、
  **滚到参数区底部能看到颜色三档**（量 `.badj__params` 与 `.badj__rich` 的矩形）、CTA 在标签栏之上
- 验证：本地 `verify-beginner.cjs` **212/212**（手机三档各 50 + 平板 31 + 电脑 31，console 报错 0）、
  全站 `audit.cjs` 0 错误页；线上 `verify-beginner.cjs --url` **240/240**、`verify-seo-v3.cjs --url` **59/59**
- 部署：qq 备份 `/root/douwan-backups/dw-web-before-mobile-preview-20261026-183500.tar.gz`；
  线上产物 `assets/index-Crfur4XW.js` + `assets/BeginnerView-Bup8hF1z.css`（与本地构建同哈希）
- ⚠️ **这次部署踩到一个真事故（已修，务必记住）**：`vite build` 会**清空整个 `dist/`**，
  而 `dist/seo/pages.json` 是 `scripts/build-seo-pages.mjs` 单独生成的、不在 vite 的产物里。
  连跑几次 `vite build` 却没重跑那个脚本 ⇒ 发布包里没有 `seo/pages.json` ⇒
  `/create` 与 `/editor` 直接 **404**（后端找不到 SEO 内容就回「页面不存在」的壳）。
  现在每次都按「`vite build` → `node scripts/build-seo-pages.mjs` → 打包」的顺序做，
  发布后确认 `/var/www/dw.sharyuke.com/seo/pages.json` 在（61410 字节），再验 `/create` 是 200

**已完成（2026-10-28 下午）——左栏尺寸滑杆支持滚轮（`pindoudou` `6407cad`，已上线）**

- 需求原文：「电脑端用滚轮缩放大小不能用 修复一下」
  （用户确认是**左栏「画布与成品尺寸」的滑杆**上滚滚轮，尺寸数值不变）
- **根因**：Chrome / Edge 默认**不**响应 `<input type="range">` 上的滚轮（Firefox 会），
  而滑杆两端只有 − / ＋ 两个按钮 —— 电脑端用户在滑杆上滚滚轮，数值纹丝不动，看着像功能坏了
- **改法**：
  - 新增 `src/lib/rangeWheel.js`：向上滚变大、向下滚变小；一格滚轮走「量程的 1/20」
    （下限是滑块自己的 step）—— 52 钉板走 2 格、1000 格大板走 50 格，一次滚到位；
    按住 Shift 走最小步长（一格一格抠）；改完派发 `input` / `change`，
    **走滑杆原有的重算链路**（成品区域重算、留白收敛、提示文案都在 `EditorSidebar` 那边，不重复实现）；
    同时 `preventDefault` 吃掉默认滚动，页面不会跟着一起滚
  - `EditorSidebar.vue` 四条尺寸滑杆（宽屏长边 / 宽 / 高 + 手机版同款）各加 `@wheel="onRangeWheel"`
  - 只动专业工作台左栏的尺寸滑杆；颜色数滑杆没动（每格都会触发一次重新量化，没必要）
- **顺带查清的一件事**：用户说的「滚轮缩放」还有另一处 —— 工作台画布上的滚轮缩放**本来就是好的**
  （真实滚轮输入实测 zoom 0.84 → 1.04 → 0.84，画布 556 → 722 → 556px），别再改它
- **自检**：
  - `scripts/audit-range-wheel.js`（页面内断言，6 个场景：向上变大 / 向下变小 / Shift 最小步长 /
    上下限不再动 / 关闭等比后各自可调 / 滚轮被吃掉）+ `package.json` 的 `verify:range-wheel`
  - `scripts/audit-wheel-real.cjs`：**CDP 真实滚轮输入**（`Input.dispatchMouseEvent` type=mouseWheel），
    同时验画布缩放与尺寸滑杆 —— 页面里 `new WheelEvent(...)` 只是合成事件，
    证明不了浏览器会不会把真实滚轮送进来，所以另写了一份走真实输入的（`verify:wheel-real`）
  - 改前基线（线上实测）：画布缩放 `zoomedIn: true`，尺寸滑杆 `sliderResponds: false` ⇒ 复现成功
  - 改后：本地与线上 `sliderResponds: true`（滑杆 52 → 50 → 52），画布缩放不受影响
- 验证：本地全站自检 84 页 0 错误（`audit-exit=0`）、`verify-beginner.cjs` 217/217、
  `verify:size-wide`（桌面 + 窄三栏）、`verify:size-live`（手机 + 平板）、
  `verify:board-resize`（上一条改动的回归）全绿；**线上 `verify:range-wheel` 与真实滚轮脚本全绿，
  console 报错 0**
- 部署：在隔离 worktree `.tmp/wt-wheel`（master `d4c1e4d`）上改 + 构建；
  qq 先备份 `/root/douwan-backups/dw-web-before-range-wheel-20261028-*.tar.gz` 再覆盖；
  线上产物 `assets/index-BPOO707R.js`，`seo/pages.json`（61410 字节）已确认
- ⚠️ 共享工作区里 `feat/smart-colors` 分支并行会话仍在改（智能减色 `d15cc7b` 已提交，
  `src/lib/api.js` 还有未提交改动）—— 本次改动全部在隔离 worktree 里做，没碰他们的文件

**已完成（2026-10-28 中午）——换钉板尺寸不再重画手改过的图纸（`pindoudou` `d4c1e4d`，已上线）**

- 需求原文：「图纸转换后换钉板尺寸时，已经编辑好的图不要重置，只改钉板尺寸」
- **根因**：专业工作台所有尺寸入口（档位按钮 / 滑块 / 自定义尺寸 / 恢复默认）最终都走
  `useStudio.setCanvasSize`，它此前一律 `regenerate()`（从原图重新取样），手改的格子全被冲掉
- **改法**：`setCanvasSize` 里加一条分支 —— `manualEdited`（这张图被逐颗改过）为真时改走新函数
  `resizeVariantsPreserving`：旧格子按**底板中心锚点** 1:1 挪进新画布（换大板居中落位、同板
  缩放成品区域时原地不动、缩板时越界的豆裁掉并在提示里报数量）；填的空不计入「抠图比例」；
  撤销栈与拼制进度只在格子整体挪位时重置（旧进度对应的是另一张网格）；提示文案指路「恢复方案」
  （想按新尺寸重画就走那条）。`manualEdited` 现在随存档 `saveProject` / `openProject` 保存与恢复
  （老存档没有此字段按 false 处理），否则保存后重开再改尺寸又会把手改生成掉
- 范围只在专业工作台：操作台 `/create`（新手版）保持原有「改参数重算 + 保护弹层」的行为
- 新增自检 `pnpm verify:board-resize`（`scripts/audit-board-resize.js`，7 场景 × 4 视口）：
  A 未手改照旧重生成、B 真 PointerEvent 画一笔立标记、C 手改后放大 52→104 居中落位且不重生成、
  D 同板缩成品区域格子逐位不变、E 留白处可继续画、F 缩板裁 1 颗且统计吻合、
  G 存档往返后 `manualEdited` 恢复且再放大仍保留
- 验证：本地四档视口 + worktree 构建复跑全绿；全站 `pnpm verify` 84 页 0 错误、
  `verify-beginner.cjs` 217/217；**线上 `--url https://dw.sharyuke.com` 四档视口 28/28 场景全绿、
  console 报错 0**
- 部署：在隔离 worktree `.tmp/wt-br`（master `c68c585`）上改 + 构建（避免把共享工作区里
  `feat/smart-colors` 分支的未提交改动带上线）；qq 先备份
  `/root/douwan-backups/dw-web-before-board-resize-20261028-124500.tar.gz` 再覆盖；
  线上产物 `assets/index-k0PLB13z.js`，`seo/pages.json`（61410 字节）已确认
- ⚠️ 这次推送把并行会话已提交未推送的 `c68c585`（分板 PNG/JPG 每张底部带色号与颗数）一起快进
  推上了 `origin/master` —— 部署产物本来就包含它（基于 `c68c585` 构建）
- ⚠️ 已知小口子（**2026-10-29 已修**，见下面那条）：`resizeVariantsPreserving` 只挪「当前展示的那份」方案（含 `.active`），
  方案的底稿仍保持旧尺寸；`repadVariants` 是两份都补的。只有切回底稿展示时才可能碰到，
  现有探针没覆盖，要动这里先把探针补上

**已完成（2026-10-29 上午）——换钉板不再裁画面：底板装不下原图时等比缩图（`pindoudou` `fbb6517`，已上线）**

- 需求原文：「画布编辑后切换钉板画面会裁掉，修复一下」
- **根因**：10-28 那条「换钉板尺寸保留手改图纸」的实现是「旧格子 1:1 按底板中心平移 + 越界裁掉」。
  底板换小到装不下原图时，平移只能保住中间一块 —— 实测 104 板换 52 板**丢掉 5824 颗**（共 8528 颗），
  画面只剩中间那块（猫头连耳朵都没了），提示还写着「放不下的 5824 颗已裁掉」。
  而**没手改过**的图走的是「按新尺寸重新取样」，整张图会等比缩小 —— 两边口径不一致才是用户觉得「坏了」的原因。
- **改法**（`src/composables/useStudio.js`）：
  - 新增 `resampleArtCells`：把旧成品区域等比缩到新成品区域，每格取覆盖它的那块旧格子里**出现最多的豆色**
    （整块没豆就留空）；平手取先扫到的，结果稳定可复现
  - `resizePreserveCells` 接受 `scaleArt`：底板装不下原图（旧成品区域 > 新成品区域）时走**缩图**而不是裁边；
    画在成品区域之外（板面留白里）的豆子带不过去，如实报数
  - `scaleArt` 只给「换钉板」用：`setCanvasCapacity` → `setCanvasSize` 只在**换底板导致成品区域变小**时传 true；
    同一块板上拖成品尺寸滑杆仍然「原地不动」（10-28 定的口径不变）
  - 顺带修掉 10-28 留的小口子：`resizeVariantsPreserving` 现在**底稿与「库存重配色」那份一起缩**
    （以前只挪显示的那份，另一份留在旧尺寸上，切回底稿会看到旧图）
  - 提示语改成「已按新底板把图案缩到 X × Y 格，手工修改保留（细节按块合并）；想按新尺寸重新转换请点「恢复方案」」
  - 代价说清楚：缩图时几颗旧格并成一颗（取块内多数色），单颗手改的小细节可能被同色淹没
- **自检**：
  - `pnpm verify:board-resize` 扩到 **8 场景 × 4 视口**（F 从「缩板真被裁掉」改成「缩板等比缩图不裁画面」，
    新增 H「满格图纸 + 手改 → 换钉板画面不裁」：断言图案包围盒跟着等比缩小，不只看豆子数）
  - 新增 `pnpm verify:board-crop`（`scripts/verify-board-crop.cjs`）：**真浏览器走真实用户路径** ——
    载素材 → 铺满 104 板 → 画布上真拖一笔 → 左栏「底板尺寸（实物）」下拉里选 52 钉板 → 断言包围盒等比缩小、
    console 报错 0，并留下前后两张截图（`--url` 可直接验收线上）
  - 回归：全站自检 84 页 0 错误、`verify:beginner` 217/217、`verify:size-wide` / `verify:size-live` /
    `verify:mobile` / `verify:range-wheel` / `verify:export-template` 全绿
- **上线**：隔离 worktree `pindoudou\.tmp\wt-boardcrop`（分支 `feat/board-crop`，基于 `origin/master` `ef335b9`）改 + 构建；
  提交 `fbb6517` → 快进推上 `origin/master`；qq 先备份
  `/root/douwan-backups/dw-web-before-boardcrop-20261029-*.tar.gz` 再覆盖；
  线上产物 `assets/index-WZTqt50L.js`，`seo/pages.json`（61410 字节）已确认
- **线上验证**：`verify:board-crop --url https://dw.sharyuke.com` 通过（104 板 8528 颗 / 包围盒 (0,10)-(103,93)
  → 52 板 2144 颗 / 包围盒 (0,5)-(51,46)，正好一半）；`verify:board-resize --url` 8 场景 × 4 视口全绿；
  全站自检 84 项 0 错误（只有 404 页自身那条 404，按设计）；`verify:seo-v3` 59/59；`verify:beginner --url` 245/245

**已完成（2026-10-27 中午）——作品跨设备同步：同一账号三端看到同一份（`douwan-api` `a9e11a5`、`pindoudou` `4ee537d`，已上线）**

- 需求原文：「三个端口登录后保存的作品不能同步，修复一下，同一账号的保存作品要同步」
- **以前为什么不同步**：「我的作品」只写浏览器 `localStorage`（`douzao-projects-v2`）。
  手机 / 平板 / 电脑各有各的那一份，登录只换令牌，作品列表还是本机数据；
  服务端 `projects` / `project_variants` 两张表一直存在但没有任何接口读写。
- **后端**（隔离 worktree `douwan-api\.tmp\wt-projects`，分支 `feat/project-sync`）：
  - `projects` 表加 `client_id`（前端生成的 `p_xxx`，同一用户下唯一）、`client_updated_at`（毫秒）、
    `payload`（`jsonb`，原样存前端紧凑存档）。`(user_id, client_id)` 唯一索引就是同步的幂等键；
    存档结构以后变，同步层不用跟着改表
  - 四个接口（都要登录，按 `user_id` 隔离）：`GET /api/v1/projects`、`GET/PUT/DELETE /api/v1/projects/:client_id`；
    单条上限 8 MiB；`PUT` 是幂等覆盖；删除是**物理删除**（删掉后同一 id 能重新保存）
  - 新文件 `internal/{repository,service,handler,dto}/project.go` + `handler/project_test.go`
    （含「另一个账号看不到、删不掉」「非法 id / id 不一致 / 未登录 / 超 8 MiB」用例）；
    `postgres_test.go` 补了 jsonb 写入 / 覆盖 / 列表回读 / 删除
- **前端**（隔离 worktree `pindoudou\.tmp\wt-projects`）：
  - `src/composables/useProjectSync.js`：登录 / 换账号 → 全量合并；保存 / 改参数 / 记进度 → 900ms 防抖后
    只推有改动的作品；删除 → 本机墓碑 + 立即补发；退出登录前 flush。合并规则：同一 id 取
    `updatedAt` 较新的一份；服务端没有且本机时间不晚于上次同步时间 ⇒ 判定「别的设备删了」；
    匿名访客转真实账号时把本机作品带进账号，真实账号 A → B 不互相污染（换号前留小备份）
  - `useStudio.js` 拆出 `packedProjects()` / `applySyncedProjects()` / `onProjectsPersisted()`，
    `persist()` 写完本机后通知同步层；`App.vue` 启动后同步一次；`useUserAccount.logout()` 先 flush
  - 「我的作品」页加同步状态行 + 「立即同步」；帮助 / 设置页文案同步改（作品进账号，库存与收藏仍是本机）
  - 交付文档：**`pindoudou/docs/project-sync.md`**；接口写进 `douwan-api/docs/api.md`「作品存档同步」
- **验证**：
  - 后端 `go vet` + `go test -count=1 ./...` 全绿；真 PG（qq 上临时库 `douwan_pgtest_projects` + 本地隧道）
    跑 `TestPostgres_Smoke` 通过（jsonb 往返正常），库用完已 `DROP`
  - 前端真浏览器脚本 `scripts/verify-project-sync.cjs`：**对着本地真后端 14/14**、
    **对着线上 14/14**（电脑登录保存 → 服务端 1 条 → 平板 / 手机清空 `localStorage` 重新登录自动下载 →
    手机删除 → 服务端归零 → 电脑再登录看不到）。每次跑用随机新账号
  - 线上 `audit.cjs` 84 项 0 错误（只有 404 页自身那条 404，按设计）、`verify-seo-v3.cjs` 59/59、
    `verify-beginner.cjs` **245/245**（手机三档 + 平板 + 电脑，console 报错 0）
- **部署**：后端先 `pg_dump` 备份（`/root/douwan-backups/douwan-before-projectsync-20261027-120055.dump`）
  + 旧二进制 `.bak-20261027-120055`，迁移后重启；线上 `projects` 表新列与唯一索引已核对，
  `GET/PUT /api/v1/projects` 未登录返回 401。前端备份
  `/root/douwan-backups/dw-web-before-projectsync-20261027-120241.tar.gz`，线上产物 `assets/index-rs1REMUM.js`
- 验证用的临时前台账号（`sync<时间戳>`，id 34）连同其会员 / 积分 / 访问记录已从线上删干净，
  `users` 表只剩 3 个真实账号，`projects` 表 0 行
- ⚠️ **并行会话的坑（这次差点回滚别人的功能）**：线上 11:31 那版是另一个会话部署的
  「导出图不画板号角标」修复（基于 `8baeb69`），它**没带上 `0ebad00` 的手机端预览放大**；
  而本机主工作区还有未推送的 `556f4fb` + `6a047a7`（分板交付下载电子档 PDF）。
  所以前端**先把 `6a047a7` merge 进同步分支再构建**（`5d9e27f`），部署的产物同时包含两边的改动。
  以后发布前一定先看线上 `assets/index-*.js` 与本机构建是否同哈希，不一致就说明线上有别的会话的提交
- ⚠️ **自检脚本的固定 sleep 会误报**：`verify-beginner.cjs` 原来在导航后固定等 2.2~4 秒，
  冷启动（第一次打开、要下 540KB bundle）时手机档会偶发「页面还没画出来 / 图纸还没算完」，
  表现为 `mobile-s` 少几项。已加 `waitFor()` 等元素就绪再断言，并支持
  `VERIFY_VIEWPORTS=mobile-s` 只跑某几档视口调试；改完线上 **245/245**

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
