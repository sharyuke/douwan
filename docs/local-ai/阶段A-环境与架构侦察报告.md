# 阶段 A 环境与架构侦察报告

> 需求文档：《豆玩本地 AI 部署需求文档（OpenCode 执行版）》 §0 / §12 阶段 A
> 执行者：DSH（在 Windows 控制端 `C:\Users\sharyuke\Documents\work\douwan` 执行，代码改动经 home 落地）
> 日期：2026-10-15
> 本文只记录**事实**与**计划**。所有结论都有命令输出或 `文件:行` 证据；未验证项单独标注。

---

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| 本地 AI 机器 | 就是本机 `SY-NB`（RTX 2060 6GB 实机，**已跑通文生图与图生图**，见 §6） |
| ComfyUI | **已安装**（官方 Windows 便携版 v0.16.4，torch 2.10.0+cu130，Torch CUDA 可用），无需重新下载 |
| rembg | **未安装**（无 pip 包、无独立环境、`7000` 端口未监听）→ 阶段 B 需新建虚拟环境安装 |
| 磁盘 | 机器上**没有 D 盘**；C: 1861.8GB / 剩余 1424.8GB（足够） |
| 出网 | HTTPS 正常可达 pypi / github / huggingface（`node fetch` 实测 200） |
| Tailscale | home 与 qq **都未安装**；qq 有 root + `/dev/net/tun` + 可达 `pkgs.tailscale.com`（可装，但**需要你批准**） |
| 后端（douwan-api） | 有统一 `/api/v1` 路由、鉴权、权限点、本地磁盘存储；**没有任何任务/队列基础设施** |
| 前端（pindoudou） | 抠图/卡通已有本地算法与 UI；文生图有占位入口；图片**只有 4 个入口且不接受 URL/base64** |
| 隐私承诺冲突 | 前端多处写明「图片全部在浏览器本地完成」，走服务端 AI **必须同步改文案** |

---

## 1. 执行环境（谁在哪里干活）

```
本机 SY-NB（Windows，控制端 + 本地 AI 机器，RTX 2060 6GB）
  └─ ssh → home 192.168.1.135（开发机：Go 1.26 / node 24.21 / corepack pnpm 11.17，代码在这里）
  └─ ssh → qq 47.103.213.224（线上：nginx 1.24 + douwan-api + PostgreSQL 16，Ubuntu 24.04）
```

- 本机**有** RTX 2060 与 `nvidia-smi`，**没有** node / pnpm / go（用 DSH 自带 node 跑测试脚本）。
- 本机 Python 3.12.12（Anaconda，pip 25.3）；ComfyUI 用自带 `python_embeded` 3.13.11。
- home：Ubuntu 26.04，node v24.21.0 / go1.26.0 / `corepack pnpm` 11.17.0，两仓库工作区**干净**（`git status --porcelain` 为空）。
  - `douwan-api` HEAD `5364499`；`pindoudou` HEAD `c3588b9`。
- qq：Ubuntu 24.04.2，2C/1.6G/40G（用 3.4G），**没有 Go 工具链**（后端只能 home 交叉编译后 scp）。

## 2. 本机（本地 AI 节点）硬件与现状

```
GPU      : NVIDIA GeForce RTX 2060，6144MiB 显存，驱动 610.88 / CUDA UMD 13.3
RAM      : 137,340,612,608 B ≈ 127.9 GB（ComfyUI 自报 total RAM 130978 MB）
磁盘     : C: 1861.8GB，剩余 1424.8GB；D: / E: 不存在
网络盘   : W:/X:/Y:/Z: 映射 \\192.168.1.3（当前访问受限）
```

已装的 ComfyUI（**复用，不重装**）：

```
路径   : C:\Users\sharyuke\Documents\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable
版本   : ComfyUI v0.16.4（git a7a6335, 2026-03-07），frontend 1.39.19，ComfyUI-Manager V3.39.2
Python : python_embeded 3.13.11，torch 2.10.0+cu130，torchvision 0.25.0+cu130，CUDA 可用
自定义节点（部分）：comfyui_controlnet_aux、ComfyUI_IPAdapter_plus、comfyui-inpaint-nodes、comfyui-tooling-nodes、ComfyUI-Manager
已知小毛病（不影响本次）：缺 `simpleeval` → `comfy_extras/nodes_math.py` 导入失败；`ComfyUI-Copilot`、`ComfyUI-Remote-API`、
  `Auto-Photoshop-StableDiffusion-Plugin_DISABLED` 导入失败（与本次无关，不在白名单工作流里）
```

**已在本机的模型文件**（`ComfyUI\models\`，共 ~56GB）：

| 目录 | 文件 | 大小 | 商用许可（待 §7 逐项核实） |
| --- | --- | --- | --- |
| checkpoints | `sdxl_lightning_4step.safetensors` | 6.46 GB | SDXL 系列，需核实 |
| checkpoints | `v1-5-pruned-emaonly.ckpt` | 3.97 GB | CreativeML OpenRAIL-M（**允许商用，有限制**） |
| checkpoints | `realisticVisionV60B1_v51HyperVAE.safetensors` | 3.97 GB | 需核实（Civitai 模型） |
| checkpoints | `Anything-V3.0-pruned-fp16.safetensors` | 1.99 GB | 需核实 |
| checkpoints | `flux1-dev-bnb-nf4-v2.safetensors` | 11.22 GB | **FLUX.1 [dev] 非商用** → 不得用于付费流程 |
| diffusion_models | `z_image_turbo_bf16.safetensors` | 11.46 GB | 需核实 |
| text_encoders | `qwen_3_4b.safetensors` / `clip_g` / `clip_l` | 9.02 GB | 随模型 |
| loras | FLUX.1-Turbo-Alpha / flux-turbo-alpha / anime_lora / realism_lora | 1.36 GB | 需核实 |
| vae / upscale / inpaint | `ae.safetensors`、`4x_NMKD-Superscale`、`MAT_Places512_G_fp16` | 0.5 GB | 需核实 |

> ❗ 结论：**不需要下载任何大模型即可开展阶段 B**（文生图/图生图已实测可用）。
> 需要新下载的只有 rembg 的 U²-Net 权重（~176MB，GitHub release），以及 rembg 的 Python 依赖（数百 MB）。

**VRAM 现状（关键风险）**：刚开机时 `nvidia-smi` 显示已用 3158MiB，稍后（浏览器/微信/剪辑等前台程序占用）升到 **5403MiB / 6144MiB**。ComfyUI 以 `--lowvram` 启动后实测可跑 512×512（见 §6），但可用余量只有 ~3GB，**高分辨率/SDXL 会紧张**。

## 3. 本地 AI 尚未具备的部分

| 组件 | 状态 | 说明 |
| --- | --- | --- |
| ComfyUI 服务 | ✅ 可运行 | 已用 `--port 8188 --lowvram --disable-auto-launch` 起过，`/system_stats` 200 |
| ComfyUI 工作流模板 | ❌ 待建 | 本次已手写 3 个 API 格式工作流用于验证（`docs/local-ai/test/*.json`），正式模板待按 §4.6 落到 `workflows/local-ai/` |
| rembg | ❌ 未安装 | 需独立 venv（不得污染 ComfyUI 的 python_embeded） |
| Windows 运维脚本 | ❌ 待写 | §3.5 要求的 5 个 `.ps1` |
| Tailscale | ❌ 两台服务器都没装 | 见 §5 |

## 4. 从零安装的目录方案（待你确认）

文档 §3.1 建议 `D:\DouWanAI\...`，但**本机没有 D 盘**。按文档「先报告并选择可用的本地 SSD 目录，不要硬编码到不存在的盘符」，建议：

```
C:\Users\sharyuke\DouWanAI\
├── rembg\        # 独立 Python venv（用系统 Python 3.12 创建）
├── models\       # 只放「与 ComfyUI 不共有」的模型（如 u2net.onnx）；ComfyUI 继续用自己 models 目录
├── logs\         # 本地 AI 节点运行日志
└── run\          # pid / 状态文件，供 .ps1 脚本判断是否已启动
```

复用既有 ComfyUI 目录（不复制、不移动、避免重复 56GB）：
`C:\Users\sharyuke\Documents\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable`
ComfyUI 的输出/输入/缓存目录保持默认（`ComfyUI\output` / `ComfyUI\input`），不再另设。

## 5. 私有网络（§2.3 / 阶段 C）可行性

| 检查项 | home（192.168.1.135） | qq（47.103.213.224 线上） |
| --- | --- | --- |
| 发行版 | Ubuntu 26.04.1 LTS | Ubuntu 24.04.2 LTS |
| 权限 | `sharyuke`，**免密 sudo 可用** | `root` |
| `tailscale` 二进制 | 无 | 无 |
| `tailscaled` 服务 | inactive | inactive |
| `pkgs.tailscale.com` 可达 | 200 | 200 |
| `/dev/net/tun` | 未查（非目标机） | **存在** |
| 内存 | 31GB | 1.6GB（Tailscale 常驻约 20–40MB，可接受） |
| 结论 | 可安装（控制台/开发机，非必须） | **可安装，但必须你批准**（新增内核网络设备 + systemd 服务） |

**关键设计问题（需要你定）**：文档 §1.1 说「豆玩网站部署在另一台服务器，不与本地 GPU 机器同机」，§2.3 让**线上服务器**通过 Tailscale 访问本地 AI。但本机的 `nvidia-smi` 显示这是一台**笔记本（sy-nb）**，会关机/休眠。因此：

- 方案 A（文档原意）：qq 加入 Tailnet，Windows 与 qq 同一 tailnet，qq → Windows 私有地址调 AI。要求这条笔记本**长期开机**。
- 方案 B：home（Ubuntu，常开）加入 Tailnet 作为中转/测试端，先在 home 上验证私有联通，qq 保持不变。
- 方案 C：本机 AI 作为「仅本地可用」的测试节点，阶段 D 后端接口先做好、`LOCAL_AI_ENABLED=false`，等确定一台常开机器后再打通。

本阶段**不会**做任何端口转发、Funnel、公网反代（文档明令禁止）。

## 6. 阶段 A 已实测：ComfyUI 真机跑通（本地节点测试提前完成一部分）

命令（本机，ComfyUI 以 `--lowvram` 监听 `127.0.0.1:8188`）：`docs/local-ai/test/comfy-run.cjs`

| 测试 | 模型 | 参数 | 结果 | 耗时 | 输出 |
| --- | --- | --- | --- | --- | --- |
| 文生图 512×512 | `v1-5-pruned-emaonly.ckpt` | dpmpp_2m/karras, steps 20, cfg 7.0 | ✅ success | **7.0 s** | `test/out/douwan_test_00001_.png` 420,386 B 512×512 |
| 图生图（基础款） | `v1-5-pruned-emaonly.ckpt` | denoise 0.55, steps 24 | ✅ success | **6.0 s** | `test/out/douwan_cartoon_00001_.png` 426,401 B 512×512 |

- 生成图已**人工查看**：文生图是一只写实熊猫（确认不是占位图/空白图）。
- VRAM 观测（`/system_stats`，Torch 视角空闲）：生图前 5361 MB 空闲 → 生图后 **3026 MB 空闲**；ComfyUI 常驻占用约 2.3GB 显存。
- **结论：本机在 `--lowvram` 下可完成 512×512 单张文生图/图生图，耗时 6–7 秒。**

> ⚠️ 反例记录（值得写进运维文档）：第一次以普通沙箱权限运行 ComfyUI 时，`SaveImage` 报
> `PermissionError: [Errno 13] Permission denied: ...\ComfyUI\output\douwan_test_00001_.png`，且
> `ComfyUI-Manager` 缓存、`asset_cache_state` SQLite 全部只读 → 生图链路本身跑通但无法落盘。
> 这是**运行权限**问题，不是 ComfyUI 故障。正式部署请确保 ComfyUI 进程对其安装目录有写权限。

## 7. 需要你确认的商用许可（阶段 B 前置）

文档 §3.3 要求「许可不明或明确禁止当前商业用途的模型，不得用于付费生产流程」。上一节的模型**除 FLUX.1 [dev] 明确非商用**外，其余都需要逐项查证并记入 `docs/local-ai-models.md`。**本轮不会把任何模型标记为「可商用」**，会逐个查模型卡/许可证链接后再写结论。

第一轮建议的「付费功能候选」与「只做内部测试」划分（初步，待核实）：

- 候选（预期许可宽松、6GB 可跑）：`v1-5-pruned-emaonly`（CreativeML OpenRAIL-M）、`sdxl_lightning_4step`（待核实）。
- 仅内部测试，不得用于付费流程：`flux1-dev-bnb-nf4-v2`、`z_image_turbo_bf16`。

## 8. 豆玩项目现状（可复用点）

详细事实见 [`recon-backend.md`](recon-backend.md)（641 行）与 [`recon-frontend.md`](recon-frontend.md)（572 行）。与本次接入直接相关的：

### 8.1 后端（`douwan-api`，Go 1.26 + Gin + GORM + PostgreSQL 16）

- **路由**：`internal/router/router.go` 手工 DI 后挂 `/api/v1`；准入四种写法（公开 / `Auth` / `OptionalAuth` / `AdminAuth`+`RequirePermission`）。
- **配置**：viper，`DOUWAN_` 前缀；**每个键都必须在 `setDefaults` 声明，否则环境变量被静默忽略**（`config.go:285-291` 有注释）。
  新增 `local_ai:` 段照 `Activity` 段改 5 处；**地址/密钥不进仓库 yaml**，走 `/etc/douwan/api.env`（systemd `EnvironmentFile`）。
- **权限点**：唯一出处 `internal/model/admin.go:47-68` + 角色矩阵 `:72-99`；加 `ai.use` 需改 4 个 Go 文件 + 2 处文档。
  侦察时发现一个**既有缺陷**：`internal/service/admin.go:143-149` 的 `PermissionList` 漏了 `PermActivityView`
  （鉴权本身正常，但 `admin/permissions`、`admin/auth/me` 不回传 `activity.view`）→ 顺手修。
- **存储**：只有本地磁盘。`<upload_dir>/<subdir>/YYYY/MM/时间戳-hex.ext`，URL = `public_prefix + rel`；
  **子目录白名单只有 `assets` / `thumbnails` / `covers`**，存 AI 产物必须先登记；类型白名单 `jpeg|png|webp|gif`，**显式拒绝 SVG**；
  像素上限 6000 万。线上 `/var/lib/douwan/uploads` 目前**是空的**，nginx 已直读该目录。
- **任务/队列**：**完全不存在**（全仓 grep 无 job/queue/task/worker）。最可借鉴的「状态机 + 幂等」范式是订单发卡。
- **nginx 限制**：`proxy_read_timeout 60s`（同步慢推理会被掐断）、`client_max_body_size 20m`。
- **响应/错误码**：HTTP 管协议、body `code==0` 才成功；新业务码从 **40028** 起。
- **已预埋的 AI 位点**（接入时应一次打通）：
  - 权益键与 `Features()`：`internal/entitlement/entitlement.go:14-33,45-66,90-109`
  - Credits：`internal/model/user.go:72-92` 注释已点名 `ai.text / ai.variants / ai.batch`；`UsageStat.AICalls`
  - 埋点：`internal/model/activity.go:183-185` 白名单已含 `ai.text/ai.variants/ai.batch`，经 `POST /api/v1/events` 落 `user_feature_daily`
  - 设置分组 `SettingGroupAI = "ai"`（`internal/model/library.go:11`）与「AI 成本告警」设置项（`internal/service/setting.go:35,85-90`）**已预留、无数据**

### 8.2 前端（`pindoudou`，Vue 3.5 + Vite 6，hash 路由）

- **抠图/卡通已经有本地实现**：`src/lib/matte.js:334 estimateMatte`（三档 `MATTE_LEVELS:114`）、
  `src/lib/cartoon.js:981 cartoonize`（三档 `CARTOON_STYLES:122`），由 `useStudio.js:907-910` 消费；
  UI 是「原图 / ✂智能抠图 / 🎨卡通风格」互斥三选一（`EditorSidebar.vue:92-117,656-685,688-711`）。
- **文生图是占位**：`src/composables/usePrompt.js:1-7` 自述「待接 `POST /api/ai/generate`」，实际是关键词匹配本地素材。
- **图片入口只有 4 条，且不接受 URL/base64**：文件选择（`useStudio.js:1190`）、拖拽（`EditorSidebar.vue:571-581`）、
  素材 SVG（`useStudio.js:1295`）、存档重建（`:1587`）。原图是 `HTMLImageElement` + `objectURL`（`:1127`）。
  → 服务端 AI 返回的图片 URL 需要经 `loadImageFromUrl`（`:2095`）→ `loadImageSource`（`:1060`）注入。
- **会员硬约定**：「按钮永不隐藏，点不动给原因 + 升级路径」（`useMembership.js:1-6`）；
  `ENTITLEMENTS`（`:108`）里**没有 `ai.*` 键**，所以现在 `check('ai.text')` 恒真；`DENY_REASON`（`:144`）需同步。
- **API 客户端**：`src/lib/api.js` baseURL 硬编码同源 `/api/v1`（全仓零 `import.meta.env`），
  双令牌 `douwan-admin-tokens` / `douwan-user-tokens`，401 自动刷新重放；错误统一 `useToast` + `ToastHost`。
- **后台新增页面**要改 6 个文件（`views/admin/AdminXxxView.vue`、`router/index.js`、`components/admin/adminNav.js`、
  `lib/adminApi.js`、`useAdminAuth.js:39-59`、`scripts/admin-audit.cjs:57-72`）；规范见 `views/admin/_SPEC.md`。
- **隐私承诺冲突（重要）**：`SettingsView.vue:349,353`、`PricingView.vue:171,175`、`AppFooter.vue:47`
  写了「图片全部在浏览器本地完成 / 现在没有任何图片离开你的设备」。**接入服务端 AI 必须同步改这几处文案**，
  并补 §6 埋点调用（目前 `POST /api/v1/events` 前端零调用）。
- **构建与自检**：改任何 `src/` 后必须 `corepack pnpm build` 再 `pnpm verify`（`scripts/audit.cjs:114 assertFresh()` 会拦住旧 dist）。

## 9. 计划改动清单（阶段 D / E，待你确认后开工）

### 9.1 后端（`douwan-api`）

| 类型 | 文件 | 内容 |
| --- | --- | --- |
| 新增 | `internal/model/aijob.go` | `AIJob` 表（任务 ID/用户/功能/状态/进度/输入输出尺寸/模型与工作流版本/时间戳/耗时/错误码与信息/设备），登记进 `model.AllModels()` |
| 新增 | `internal/localai/`（client、comfy、rembg、queue、workflow） | 私有网络 HTTP 客户端、ComfyUI 上传/提交/轮询/取图、rembg `/api/remove`、**GPU 串行队列（并发 1 / 排队上限 3）**、工作流模板加载与参数白名单 |
| 新增 | `internal/service/aijob.go` | 任务创建（幂等键）、状态机（queued/running/succeeded/failed/cancelled）、限流与配额、结果落存储 |
| 新增 | `internal/handler/ai.go` | `GET /api/v1/ai/health`、`POST /api/v1/ai/cartoonize`、`POST /api/v1/ai/generate`、`POST /api/v1/ai/remove-background`、`GET /api/v1/ai/jobs/:id`、`GET /api/v1/ai/jobs` |
| 新增 | `internal/dto/ai.go` | 请求/响应 DTO（尺寸枚举、风格枚举、提示词长度校验） |
| 改 | `internal/config/config.go` + `configs/config.yaml` + `deploy/config/prod.config.yaml` + `.env.example` | 新增 `local_ai:`（`enabled` / `comfyui_base_url` / `rembg_base_url` / 并发与队列上限 / 上传 MB / 超时 / 图像最长边与像素上限 / 工作流目录 / 模型白名单），默认 `enabled=false` |
| 改 | `internal/storage/storage.go` | 子目录白名单加 `ai`（AI 产物目录） |
| 改 | `internal/model/admin.go`、`internal/middleware/admin.go`、`internal/service/admin.go`、`internal/router/router.go` | 新增权限点 `ai.use`、`ai.admin`；顺手修 `PermissionList` 漏 `activity.view` |
| 改 | `internal/entitlement/entitlement.go` | 增加 AI 功能键（是否计入套餐由你定，本期只留位置不写价格） |
| 新增 | `internal/localai/*_test.go`、`internal/handler/ai_test.go` | httptest 假 ComfyUI/rembg 服务；SQLite 内存库；队列串行与排队上限、鉴权、体积/类型校验、幂等键 |
| 新增 | `workflows/local-ai/*.json` | 固定工作流模板（cartoonize / text-to-image，API 格式，模型名白名单化） |

### 9.2 前端（`pindoudou`）

| 类型 | 文件 | 内容 |
| --- | --- | --- |
| 新增 | `src/lib/localAi.js` | 封装 4 个 AI 接口 + 轮询任务状态（复用 `lib/api.js`） |
| 改 | `src/composables/usePrompt.js` | 占位改真实调用 `POST /api/v1/ai/generate` + 轮询 + 失败降级 |
| 改 | `src/composables/useStudio.js` | 新增「AI 抠图 / AI 卡通」动作（同签名接入现有 `processMode` 第 4/5 项），结果经 `loadImageFromUrl` 注入并可继续走拼豆算法 |
| 改 | `src/composables/useMembership.js` | `ENTITLEMENTS` 加 `ai.*` 键、`DENY_REASON` 加中文原因；合并重复的 Credits 单价 |
| 改 | `src/components/editor/EditorSidebar.vue` | 处理方式三选一扩展到含 AI 选项；按钮禁用/处理中/成功/失败状态、防重复点击；手机端下拉同步 |
| 改 | `src/views/PricingView.vue`、`src/views/SettingsView.vue`、`src/components/AppFooter.vue` | **同步修改隐私承诺文案**（图片会离开设备 → 说明用途与保留策略） |
| 改 | `src/lib/api.js`（或新文件） | 新增 `POST /api/v1/events` 埋点调用（`ai.text` 等已在后端白名单） |
| 改 | `src/views/admin/AdminAiView.vue`（新）+ 6 处注册文件 | 后台「AI 任务与成本」只读列表（任务记录、耗时、状态、模型），不做 BI |
| 改 | `scripts/audit.cjs` / `admin-audit.cjs` 页面清单 | 新页面纳入自检 |

### 9.3 交付物（§11）

代码改动、`.env.example`、5 个 `.ps1` 脚本、固定工作流 JSON、`docs/local-ai-deployment.md`、
`docs/local-ai-models.md`、测试与结果、变更文件清单与上线前检查清单、回滚步骤。
**模型大文件 / 缓存 / 用户图片 / `.env` / 密钥一律不进 Git。**

## 10. 阻塞项与风险

| # | 项 | 影响 | 需要什么 |
| --- | --- | --- | --- |
| R1 | **沙箱写权限**：本机默认只能写工作区目录，`C:\Users\sharyuke\DouWanAI`、ComfyUI 安装目录需额外授权 | 无法创建安装目录、无法装 rembg、ComfyUI 无法落盘生图 | 需要一次性授权（或你手动执行几条命令） |
| R2 | **显存紧张**：浏览器/微信等前台程序已占 5.4GB / 6.1GB | SDXL / 高分辨率会 OOM | 实测阶段请关掉部分占用 GPU 的程序；工作流默认 512×512 + SD1.5 |
| R3 | **笔记本可能关机/休眠** | 线上 AI 接口随时不可用 | 决定是否要求常开；后端必须实现 §2.4 降级 |
| R4 | **qq 无 Go 工具链** | 只能在 home 编译后 scp | 沿用现有发布流程，无额外风险 |
| R5 | **nginx `proxy_read_timeout 60s`** | 同步慢推理会被掐断 | 一律异步任务 + 轮询（不做同步长请求） |
| R6 | **模型商用许可未逐项核实** | 不能用于收费功能 | 阶段 B 逐项查证并写 `docs/local-ai-models.md`；结论出来前不标「可商用」 |
| R7 | **qq 内存只有 1.6GB** | Tailscale + 现有服务的余量 | Tailscale 常驻约 20–40MB，可接受；仍建议先观察 |
| R8 | **生产环境改动** | 文档禁止擅自改生产 | 阶段 D 只在 home 开发 + qq 上**不改**（`LOCAL_AI_ENABLED=false`），要上线另行确认 |

## 11. 你的决定（2026-10-15 已确认）

| 事项 | 决定 |
| --- | --- |
| 安装目录 | ✅ `C:\Users\sharyuke\DouWanAI\` |
| 建目录 / 写脚本日志 | ✅ 已授权 |
| rembg 独立 venv | ✅ 已授权（系统 Python 3.12） |
| 下载 `u2net.onnx`（176MB） | ✅ 已授权 |
| ComfyUI 写 output/input/缓存 | ✅ 已授权 |
| **私有网络方案** | ❗**改为 SSH 隧道端口转发**（不用 Tailscale）：「你把服务弄好，我这里通过 ssh 隧道的方式进行端口转发」 |
| 阶段 B 开工 | ⏸ 你要先看本报告 → 报告已提交，等你看完再开工 |

### SSH 隧道方案的落地设计（替代 Tailscale）

用户选定用 SSH 隧道而不是 Tailscale。这种方式同样满足文档的三条硬约束（不开放公网端口、不用 Funnel、服务仍只监听 `127.0.0.1`），但需要明确**隧道方向**，因为 ComfyUI/rembg 都在**本机（Windows 笔记本）**：

- **方向 ①（推荐，无需在 Windows 装 sshd）**：Windows 上主动建立到线上服务器的反向隧道
  `ssh -N -R 8188:127.0.0.1:8188 -R 7000:127.0.0.1:7000 qq`
  → 隧道入口绑定在 qq 的**回环地址**，后端（同在 qq）用 `http://127.0.0.1:8188` 调用。
  可用 `GatewayPorts no`（OpenSSH 默认）保证端口**只在 qq 本机回环**可见，公网无法访问。
  代价：Windows 关机/断网即断，需要 `autossh` 或计划任务守护（文档 §3.5 说第一阶段不要擅自注册高权限后台服务，所以先用脚本手动起）。
- **方向 ②（你描述的「我通过 ssh 隧道转发」）**：从你的机器执行
  `ssh -N -L 8188:127.0.0.1:8188 sharyuke@<Windows>`，这需要在 **Windows 上装并启用 OpenSSH Server**。
  如果这是你的意思，我需要你确认，我再去装/启用 sshd（Windows 可选功能，需管理员）。

**待你回答**：走方向 ①（Windows 反连 qq）还是方向 ②（你连 Windows，需要装 sshd）？

> 与文档 §2.3 的差异会记录在 `docs/local-ai-deployment.md`：本次用 SSH 隧道替代 Tailscale Serve，理由是用户指定，
> 安全边界等价（私有连接 + 本地回环监听 + 无 Funnel/无端口转发）。

## 12. 需要你操作/确认的事项（阶段 B 开工前）

1. **安装目录**：同意用 `C:\Users\sharyuke\DouWanAI\`？还是要换到别的盘/目录？
2. **沙箱授权**：允许我在本机对该目录与 ComfyUI 目录做写操作（安装 rembg venv、下载 ~176MB 的 u2net 模型、写日志）？
3. **rembg 安装方式**：同意用系统 Python 3.12 建独立 venv（`C:\Users\sharyuke\DouWanAI\rembg`）装 `rembg[cpu]`；其 U²-Net 权重来自 GitHub release（`u2net.onnx`，176MB，Apache-2.0 仓库）—— 是否同意下载？
4. **显存**：实测时能否暂时关掉部分占用 GPU 的程序（微信 / 浏览器标签 / ChatGPT 桌面端等）？
5. **Tailscale**：是否允许在 **qq（线上）** 安装 Tailscale 并加入你的 tailnet（需要你用浏览器完成一次授权登录）？还是在 **home** 上先装、qq 暂不动？
6. **接口路径**：文档建议 `/api/ai/*`，但豆玩全站是 `/api/v1/*`。计划按现有规范用 `/api/v1/ai/*` 并记录映射 —— 是否同意？
7. **范围确认**：阶段 B（本地节点安装 + 三类能力实测 + 脚本 + 文档）是否现在开工？我会在阶段 B 结束、给你**实测数据与许可结论**后停下来等你确认，再进入 C/D/E。
