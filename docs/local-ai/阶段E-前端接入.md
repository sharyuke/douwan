# 阶段 E 交付：前端接入（本地 AI）

- 完成日期：**2026-10-16**
- 验证方式：`home` 上 **私有 git worktree**（`/tmp/douwan-fe-wt`）+ `vite build --outDir dist-ai2`，
  **未碰主工作树、未碰主 `dist/`**
- 验证结果：**构建通过**，且产物层面的断言全部成立（见 §4）
- 状态：**代码完成并验证可构建**，**未提交、未部署、线上未动**

> ⚠️ **前置依赖**：并行会话正在改 `src/composables/useStudio.js`（未提交）与
> `src/lib/boardSpec.js`（新文件未提交），且 **HEAD 里的 `SettingsView.vue` 引用了
> HEAD 里 `useStudio.js` 尚未导出的 `SIZE_TIERS`** —— 也就是说**当前 HEAD 自己构建不过**。
> 我的验证是在「主工作树 src 的真实状态」之上叠加我的改动后跑通的（见 §4 的做法）。
> `SettingsView.vue` 的 `SIZE_TIERS` 引用来自并行会话，不是我引入的。

---

## 1. 改动文件（6 个：1 新增 + 5 修改）

| 文件 | 改动 |
| --- | --- |
| `src/composables/useAI.js` | **新增**（9.5KB）：本地 AI 调用层 |
| `src/composables/usePrompt.js` | 文字生图从「占位 + 关键词匹配」换成**真调自建推理节点**，节点离线时降级 |
| `src/composables/useMembership.js` | 新增 5 个 AI 权益键 + 3 条拒绝文案 |
| `src/views/SettingsView.vue` | 隐私说明改为「本地部分 / 会上传的部分」两段（**必改**） |
| `src/views/PricingView.vue` | FAQ 两条：「Credits 怎么算」「照片会被上传吗」 |
| `src/components/layout/AppFooter.vue` | 页脚隐私提示 |

### 1.1 `useAI.js` 提供什么

| 导出 | 作用 |
| --- | --- |
| `refreshAiStatus()` / `aiStatus` / `aiReady` / `aiUnavailableReason` | 探测节点可用性；不可用时给出**可读原因**（不是布尔值） |
| `uploadAiInput(file, onProgress)` | 上传输入图（**显式传 `userTokens`** —— `upload()` 默认用后台令牌，这是个坑） |
| `submitAiJob(params)` / `getAiJob(id)` / `listAiJobs()` / `cancelAiJob(id)` | 接口封装 |
| `runAiJob(params, opts)` | **提交 + 轮询到结束**，带 `onTick` 进度回调、`AbortSignal`、总超时 |
| `applyAiResultToStudio(job, name)` | 把产物载入工作台（动态 import `useStudio` 避免循环依赖） |
| `gateAi(feature)` | 权益门禁（不符合时 toast 给原因） |
| `AI_CODE` | 与后端对齐的业务码常量（40028–40033） |

**刻意不做的事**：不定义价格。扣费口径仍由 `useMembership.CREDIT_COST` 决定
（需求红线：不把价格写死在 AI 功能里）。

### 1.2 为什么是异步 + 降级

一次卡通化/出图在节点侧 6–25s，排队更久。后端是「提交 → job_id → 轮询」，
所以前端也必须是轮询；`onTick` 把 `queue_position` 翻成
「排队中（前面还有 2 个任务）」——6GB 显存一次只跑一条，用户最想知道的就是这个数。

节点离线时 `runPrompt` **自动降级**为关键词匹配素材，且**明确告诉用户**
「AI 节点当前不可用（原因），已按关键词匹配到 X，本次不消耗 Credits」。
但**提交之后**失败时**不自动降级** —— 否则用户以为「AI 生成了」，
实际拿到的是素材库里的旧图。

## 2. 权益键（5 个新增）

| 键 | free | pro | 说明 |
| --- | --- | --- | --- |
| `ai.text` | ✅ | ✅ | 文字生图。免费版也开：单次成本由 Credits 覆盖，把「能不能用」也卡住会让新用户第一眼就用不上 |
| `ai.image` | ✅ | ✅ | 图片类 AI（预留） |
| `ai.matte` | ❌ | ✅ | AI 抠图：浏览器内已有 `lib/matte.js`，AI 版是模型级边缘细化，属增值项 |
| `ai.cartoon` | ❌ | ✅ | AI 卡通化：会重绘主体，因此不默认替用户做主（拒绝文案里写明了这点） |
| `ai.variants` | ❌ | ✅ | 一次生成多个方向 |

⚠️ 这三个键名**必须与后端 `internal/entitlement/entitlement.go` 的常量同名**，
否则 `applyServerPermissions` 会静默忽略服务端下发的值（它只覆盖已存在的键）。
后端目前**还没有** `ai.*` 权益键，接线时两边要一起加。

## 3. 隐私文案（本次最要紧的合规改动）

后端是**服务端推理**（图片会上传到自建节点），所以一期写死的
「现在没有任何图片离开你的设备」**已经不成立**，必须改。改后口径：

- **本地完成的部分（默认路径）**：解码、缩放、量化、抖点、渲染、导出，
  以及**自动抠图与卡通化滤镜**（浏览器内确定性算法，不联网）
- **会离开设备的部分（需你主动点击）**：AI 抠图、AI 卡通化、文字生图。
  由**豆玩自建的推理节点**处理，不经第三方模型服务；结果存回豆玩文件存储；
  **输入图 24 小时后自动清理**
- **训练声明**：不会用于训练，不提供给第三方

改动落在 `SettingsView.vue` / `PricingView.vue` / `AppFooter.vue` 三处
（与阶段 A 侦察报告 §结论 4 列的清单一致）。

## 4. 验证证据

做法：私有 worktree → 铺主工作树的 `src/`（拿到并行会话未提交的
`boardSpec.js` / `useStudio.js`）→ **再用我的文件覆盖** → `vite build --outDir dist-ai2`。

```
✓ built in 2.52s

=== 产物校验 ===
ai/jobs 命中: 2                      ← useAI.js 真的进了 bundle
新隐私文案命中: 3                     ← 三处声明都在
旧承诺残留(应0): 0                    ← 「现在没有任何图片离开你的设备」已彻底消失
```

> 中间踩过一次：先 `rsync` 主工作树再拷我的文件，顺序写反会把我的改动覆盖掉；
> 第二次改成「先 rsync 主工作树、后覆盖我的文件」才通过。
> 产物断言（而不是「构建成功」）才是有效证据 —— 第一次构建是成功的，但内容是旧的。

## 5. 未做 / 待办

| # | 项目 | 说明 |
| --- | --- | --- |
| 1 | **工作台 UI 入口未接** | `useAI.js` 与 `usePrompt.js` 已就绪，但 `EditorSidebar.vue` 里的 AI 面板还没加「AI 抠图 / AI 卡通化」按钮与进度显示。需要改 `EditorSidebar.vue`（该文件正被并行会话改，**冲突风险高**，建议等它稳定后单独一轮） |
| 2 | **`useStudio.js` 未接** | 没有在工作台加载时调 `refreshAiStatus()`，也没有在 AI 入口处触发。`useStudio.js` 同样正被并行会话改 |
| 3 | **后台 AI 页未做** | 后端已有 `GET /admin/localai/status` 与 `/admin/localai/jobs`，前端还没有 `AdminLocalAIView.vue`（照 `AdminActivityView.vue` 的模子） |
| 4 | **埋点未接** | `ai.text` / `ai.variants` / `ai.batch` 已在后端白名单，但前端还没调 `POST /api/v1/events`；`pattern.generate` 等浏览器内行为同样未接（AGENTS.md 待办 1） |
| 5 | **端到端未测** | 没做「真浏览器 → 真后端 → 真推理节点」的联调；`pnpm verify` / `admin-audit` 未跑（需要后端先接线并起服务） |
| 6 | **未提交** | 改动只存在于 `repos/douwan-ai-node/frontend/` 与验证时的 worktree（已清理） |

## 6. 建议的并入方式

前端共享文件（`useStudio.js` / `EditorSidebar.vue` / `router.js`）正被并行会话改，
**不要直接 `cp` 覆盖**。建议：

```bash
cd ~/Documents/work/dw/pindoudou
git worktree add ../pindoudou-ai -b feat/local-ai-frontend origin/master
cp -r <workspace>/repos/douwan-ai-node/frontend/src/. ../pindoudou-ai/src/
cd ../pindoudou-ai
export CI=true && corepack pnpm build
# 只 add 自己的路径，共享文件用 git update-index --cacheinfo 写索引而不覆盖工作区
git add src/composables/useAI.js src/composables/usePrompt.js \
        src/composables/useMembership.js src/views/SettingsView.vue \
        src/views/PricingView.vue src/components/layout/AppFooter.vue
git commit -m "feat(ai): 本地 AI 前台调用层 + 权益键 + 隐私声明同步"
git push -u origin feat/local-ai-frontend
```

## 7. 回滚

前端改动是**纯增量**（新增 `useAI.js`，其余是文案与权益键）：

```bash
cd ~/Documents/work/dw/pindoudou
git revert <commit>          # 或直接不合并该分支
export CI=true && corepack pnpm build
# 按 DEPLOY.md 重新发布前端（前端是直接覆盖 dist/，无需迁移）
```

回滚后 `usePrompt.js` 会退回「关键词匹配素材」，不产生任何上传 ——
隐私文案若已随提交上线，需要**一起回滚**（否则声明与实际行为不符）。
