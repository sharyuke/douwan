# 本地 AI 模型与权重：许可证 / 商用限制核查（正式版）

- 项目：豆玩 DOUWAN（拼豆 / 像素画网站，<https://dw.sharyuke.com>）
- 核查对象 ①：本机 `C:\Users\sharyuke\Documents\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI\models\` 下**已存在**的权重文件
- 核查对象 ②：rembg 2.0.85 **服务端允许的全部 20 个抠图模型名**（本轮新增，见 §7）
- 核查日期：**2026-10-15**（所有结论的核实日期均为 2026-10-15）
- 核查方式：**只读**。`Get-ChildItem` 取字节数、`Get-FileHash -Algorithm SHA256` 计算哈希、读取 safetensors 头部元数据、读取 rembg 已安装源码；**未下载、未移动、未删除、未重命名任何文件**
- 结论口径：本次核查**没有把任何模型标记为「可商用」**，除非存在明确的官方许可来源（见 §5 说明）

> **本文件是交付物。** 上一轮草稿为 `docs/local-ai/local-ai-models-draft.md`，内容已整体并入本文件（§1–§6 与草稿一致，仅补齐正式版标题与 §7 rembg 模型审计）。

---

## 本轮（阶段 B）结论速览

| 用途 | 可用模型 | 许可 | 状态 |
| --- | --- | --- | --- |
| 抠图（去背景） | rembg `u2net` | MIT / Apache-2.0 系（社区事实标准，权重复用 U-2-Net） | **可进入付费流程**（已实测，见 §7） |
| 抠图（备选，同一网络不同权重） | rembg `u2netp` / `silueta` / `u2net_human_seg` / `u2net_cloth_seg` | 同上，随 rembg 仓库（MIT）分发 | 需在启用前登记（见 §7.3） |
| 卡通化 / 文生图 | ComfyUI + `v1-5-pruned-emaonly.ckpt`（SD 1.5） | CreativeML Open RAIL-M | **可进入付费流程**，但须履行 §4.2 候选 1 的四项合规动作 |
| 其余 11 个权重 | — | 明确非商用 / 许可不明 | **冻结**，只可内部测试 |

**硬红线（每轮复核）**：`bria-rmbg` 是商业授权模型，且是 rembg 服务端 `/api/remove` 的**默认值**，必须显式覆盖为 `u2net`；ComfyUI / rembg 端口一律只监听 `127.0.0.1`。

---

## 0. 方法、证据等级与已知局限（务必先读）

### 0.1 证据类型定义

| 证据类型 | 含义 | 报告中的标记 |
| --- | --- | --- |
| **官方许可证文件（已由搜索索引确认存在）** | 发布方仓库内的 `LICENSE.md` / `LICENSE` / 模型卡 `license:` 字段被搜索引擎收录并编入索引 | 证据类型写「搜索摘要（官方 LICENSE 路径被我方检索到）」 |
| **搜索摘要 + 来源 URL** | 只拿到标题 / 片段 / 索引路径，**没有逐字读到许可证全文** | 在本报告中作为**全部**结论的证据类型 |
| **第三方转载页面** | HF 镜像、civitai 镜像、博客、聚合站等非发布方页面 | 作为旁证，置信度降级 |

### 0.2 本轮核查的硬性局限（影响置信度，必须记录）

1. **本机 HTTPS 抓取被沙箱阻断**：`web_fetch` 对所有域名返回 `hostname resolves to a non-public IP address`；`Invoke-WebRequest` 同样失败（DNS 被劫持到 `198.18.x.x` 保留段）。因此**没有任何一条结论是"逐字读完官方许可证原文"得出的**，全部来自 `web_search` 的**摘要与来源 URL**。
2. 因此所有许可证**全文级细节**（例如 OpenRAIL-M 附件 A 的逐条 Use-based restrictions、Stability Community License 的精确收入门槛表述）在本报告中**只以"搜索摘要可确认的要点"呈现**，并统一降级置信度。
3. 凡**官方发布名与本地文件名不能一一对应**、或**只能找到第三方转载说法**的模型，一律按下述规则处理：

> **许可不明 → 不得用于付费/商用生产流程。** 不猜测、不代填、不标「可商用」。

4. 本地大部分 `.safetensors` 已被 ComfyUI / 转换工具**重写**，`__metadata__` 被清空（见 §2 实测），所以**无法用本地元数据补齐许可证信息**。

### 0.3 本地实测可以确证的事实（非联网证据，置信度高）

- 所有文件的**精确字节数**：见 §1。
- 6 个最重要权重的 **SHA256**：见 §1。其中 `checkpoints\v1-5-pruned-emaonly.ckpt` 的 SHA256 为
  `CC6CB27103417325FF94F52B7A5D2DDE45A7515B25C255D8E396C90014281516`，
  与社区广泛流传的 SD 1.5 `v1-5-pruned-emaonly.ckpt` 官方权重指纹一致，可作为「确为官方 SD 1.5 权重」的**强本地证据**。
- `loras\FLUX.1-Turbo-Alpha.safetensors` 与 `loras\flux-turbo-alpha.safetensors`
  **字节数完全相同（694,082,424）且 SHA256 完全相同**（`77F7523A5E9C3DA6CFC730C6B07461129FA52997EA06168E9ED5312228AA0BFF`），
  即**同一份文件的重复副本**（同一 LoRA 的两个文件名）。
- 通过读取 safetensors 头部的张量键结构，可确认模型**家族/架构**（这是本地事实，不是许可结论）：

| 文件 | 张量键数 | 顶层键前缀 | dtype | 本地可确证的架构判断 |
| --- | --- | --- | --- | --- |
| `sdxl_lightning_4step.safetensors` | 2515 | `model` / `conditioner` / `first_stage_model` | F16 | SDXL 结构（含独立 conditioner = SDXL 双文本编码器） |
| `flux1-dev-bnb-nf4-v2.safetensors` | 2384 | `model` / `text_encoders` / `vae` | F32, BF16, F16, **F8_E4M3**, **U8** | FLUX 架构 + **NF4 量化**（U8/F8 为 bitsandbytes 量化存储）→ 确为 FLUX.1 [dev] 的 4bit 量化整合包 |
| `Anything-V3.0-pruned-fp16.safetensors` | 1133 | `model` / `first_stage_model` / `cond_stage_model` | F16 | **SD 1.x** 结构（非 SDXL） |
| `realisticVisionV60B1_v51HyperVAE.safetensors` | 1131 | `model` / `first_stage_model` / `cond_stage_model` | F32 | **SD 1.x** 结构 |
| `z_image_turbo_bf16.safetensors` | 453 | `layers` / `noise_refiner` / `context_refiner` / `t_embedder` / `x_embedder` | BF16 | Z-Image DiT 结构 |
| `qwen_3_4b.safetensors` | 398 | `model` | BF16 | Qwen3 系文本编码器 |
| `anime_lora_comfy_converted.safetensors` | 152 | `diffusion_model` | BF16 | **FLUX 结构**的 LoRA（`diffusion_model.*` 键命名） |
| `realism_lora_comfy_converted.safetensors` | 152 | `diffusion_model` | BF16 | **FLUX 结构**的 LoRA |
| `loras\FLUX.1-Turbo-Alpha.safetensors` | 1008 | `transformer` | BF16 | FLUX 结构 LoRA（原版键名 `transformer.*`） |

> ⚠️ 重要推论：两个 `*_comfy_converted` LoRA 从张量结构看是 **FLUX 系 LoRA**。若其基座为 FLUX.1 [dev]，则**继承 FLUX.1 [dev] 非商用限制**（见 §1 #5）。本报告中该结论按「结构证据 + 非商用上游」标注为**高风险**。

---

## 1. 主表：逐文件许可核查

> 表中「SHA256」列写 `未算` 者为本轮按任务要求只记录字节数的文件。
> 「可否用于付费/商用生产流程」列的三档含义：**可以** / **不可** / **许可不明 → 不得用于付费流程**。

### 1.1 主 checkpoint

| 文件名 | 字节数 | SHA256 | 官方来源 URL | 许可名称 + 许可 URL | 可否用于付费/商用生产流程 | 限制与义务 | 证据类型 | 置信度 | 核实日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `checkpoints\v1-5-pruned-emaonly.ckpt` | 4,265,380,512 | `CC6CB27103417325FF94F52B7A5D2DDE45A7515B25C255D8E396C90014281516` | <https://huggingface.co/runwayml/stable-diffusion-v1-5> | **CreativeML Open RAIL-M**（模型卡 `license: creativeml-openrail-m`）；许可文本：<https://huggingface.co/TMElyralab/lyraSD/blob/main/LISENCE> ；条款解读：<https://sktelecom.github.io/en/guide/use/obligation/creativeml/> | **可以**（带严格使用限制）— 许可本身允许商业使用与分发，包括对输出收费 | ① 必须随模型/衍生品**附上完整许可文本**并传递「使用限制」；② 必须遵守 §III **Use-based restrictions**（禁止违法、伤害、误导、涉及未成年人不当内容、医疗/法律等高风险建议、歧视等用途），该限制**同样约束输出内容的使用**；③ 需保留署名与免责声明；④ 无收入门槛、无需向发布方申请 | 搜索摘要 + 来源 URL（官方模型卡 `license:` 字段 + OpenRAIL-M 条款解读页） | **高**（许可标识明确）；条款逐条细节为**中** | 2026-10-15 |
| `checkpoints\sdxl_lightning_4step.safetensors` | 6,938,040,682 | `E0D996EE0013E79D9D3561F50FCAFB9A17E3FF07B780358E3B66D67932C4D490` | <https://huggingface.co/ByteDance/SDXL-Lightning> | **ByteDance SDXL-Lightning 仓库许可**（仓库根目录含 `LICENSE.md`）：<https://huggingface.co/ByteDance/SDXL-Lightning/blob/main/LICENSE.md> 。**但**：SDXL-Lightning 是 **SDXL 的蒸馏模型**，使用它必然同时受 **SDXL 基座**许可约束 → 见下一格 | **不可（当前）** — 自身许可（Apache-2.0 系）看似宽松，但**基座 SDXL 的许可链条未在本轮闭合**，且它属于 SDXL 生态的**再分发权重**，**必须与 SDXL 基座许可一并判断**，本轮不满足 | ① 需同时满足 **ByteDance 许可** 与 **SDXL 基座许可**（后者见下）；② 若基座为 `stabilityai/stable-diffusion-xl-base-1.0`，需满足其许可（年收入门槛 / 可能需申请企业许可）；③ 蒸馏权重是「模型再分发」，比「只跑推理」义务更重；④ 需保留原许可与署名 | 搜索摘要 + 来源 URL（官方 `LICENSE.md` 路径被检索到）；**基座许可链条未闭合** | 许可存在 **中**；**可用性判定 低**（因基座未定） | 2026-10-15 |
| ↳ 同上 —— **SDXL 基座许可（判定依赖项）** | — | — | <https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0> | **Stability AI Community License**（SDXL 1.0 系列；许可全文：<https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md> ；官方说明：<https://stability.ai/license> ；企业版协议：<https://stability.ai/community-license-agreement>） | **需确认** — 低于年收入门槛的组织可免费商用；**达到/超过门槛（常见表述为年收入 100 万美元）须申请 Enterprise License** | ① **年营收门槛**：超过门槛必须取得 Stability 企业许可（**须付费**）；② 组织与人员规模条款；③ 输出内容的所有权/责任由使用者承担，但**不得违反许可中的使用限制**；④ 需保留许可与署名；⑤ 若实际使用的是 `stabilityai/stable-diffusion-xl-base-1.0` 之外的 SDXL 衍生基座，条款需另行确认 | 搜索摘要 + 来源 URL（搜索索引确认该仓库存在 `LICENSE.md`；Stability 官方 license 页面存在） | **中**（`LICENSE.md` 存在已确认；**精确收入门槛数字未逐字读到**） | 2026-10-15 |
| `checkpoints\realisticVisionV60B1_v51HyperVAE.safetensors` | 4,265,097,012 | `0928B30687250B4CA459ADF9735BDEABBC0933B1E4E6FD352DF0A7D15596053F` | 上游作者发布：<https://civitai.com/models/4201>（Realistic Vision V6.0 B1）；HF 官方账号镜像：<https://huggingface.co/SG161222/Realistic_Vision_V6.0_B1_noVAE> | **上游**：CreativeML Open RAIL-M（经第三方页面转述，如 <https://civitai.com/models/license/99770> 为 V5.1 许可页、<https://civitaiarchive.com/seaart/models/a2c94ed4ef515226698fc44ebc5cd71d/versions/9c889f96-b37c-47fb-bf87-fba1fec3e050> 为镜像档案）。**本地文件本身**是「V6.0 B1 + V5.1 Hyper VAE」的**社区合并版**（文件名即合并标识），**不是** SG161222 官方发布的那一个文件 | **许可不明 → 不得用于付费流程** | ① **文件名与官方发布名不能一一对应**：官方发布为 `Realistic_Vision_V6.0_B1_noVAE` / `..._v50VAE` 等，本地是**第三方 merge**；② 合并成分含 **Hyper-SD（ByteDance，搜索索引显示 `license: openrail++`）** 与 VAE，**各成分许可需分别满足**；③ merge 后权重的许可归属无权威定论；④ 即便上游为 OpenRAIL-M，仍受其 Use-based restrictions 约束。**注**：本地实测该文件为 **F32**（非 fp16），也是一种再加工痕迹 | 搜索摘要 + 来源 URL（上游 HF 官方仓库存在）+ **第三方合并命名推断** | **低** | 2026-10-15 |
| `checkpoints\Anything-V3.0-pruned-fp16.safetensors` | 2,132,625,640 | **未算** | 原发布为 Civitai 模型页（<https://civitai.com/models/75>，`Anything V3`，作者 Linaqruf）；HF 第三方镜像与转述页：<https://huggingface.co/coreml-community/coreml-anything-v3.0>（模型卡 `license: creativeml-openrail-m`）、<https://huggingface.co/swl-models/anything-v3.0> | **转述为 CreativeML Open RAIL-M**（证据来自**第三方镜像的模型卡 `license:` 字段**，未取得原作者原始许可声明页）；Civitai 许可页：<https://civitai.com/models/license/75> | **许可不明 → 不得用于付费流程** | ① 原始发布方（Linaqruf）的**原创许可声明**本轮未能从权威来源逐字确认，只有镜像转述；② 本地文件 bytes（2,132,625,640）与常见的 `Anything-V3.0-pruned-fp16` 发布**未能一一对指纹**（未算 SHA256，本轮不做断言）；③ **动漫风格模型 + 已知角色/画风**的第三方 IP 风险高，与 **SD 1.5 输出可版权性在美国不受版权保护**的现实叠加，商用出售图像风险更大；④ 若确为 OpenRAIL-M，仍需遵守其 Use-based restrictions | 搜索摘要 + 来源 URL（**第三方转载页面的 `license:` 字段**，非官方许可声明） | **低**（关键来源为第三方） | 2026-10-15 |
| `checkpoints\flux1-dev-bnb-nf4-v2.safetensors` | 12,044,280,207 | `FEF37763B8F2C8CC3463139BBB6D91AA517C605B654D4E5C540DE52813F30306` | 基座官方仓库：<https://huggingface.co/black-forest-labs/FLUX.1-dev>；官方许可文件：<https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-dev>（标题即 **FLUX.1 [dev] Non-Commercial License v1.1.1**）；官方非商用条款：<https://bfl.ai/legal/non-commercial-license-terms>；BFL 许可证说明：<https://help.bfl.ai/articles/9272590838-self-serve-dev-license-overview-pricing> | **FLUX.1 [dev] Non-Commercial License**（v1.1.1） | **不可** ❌ | ① **非商用**：不得将模型或其输出用于商业目的；BFL 另售 self-hosted 商用许可（<https://bfl.ai/legal/self-hosted-commercial-license-terms>），**付费功能上线前必须购买**；② 仅可用于个人研究 / 非商业实验；③ 本地文件为 **bitsandbytes NF4 量化**（张量 dtype 含 `U8` / `F8_E4M3`，本地实测确认），属社区量化版 → **官方发布名对应关系弱**，量化权重的再分发许可另需确认；④ 需保留 BFL 署名与许可 | 搜索摘要 + 来源 URL（官方许可文件名与标题被检索到；LicenseDB 亦收录 `flux-1-nc`：<https://scancode-licensedb.aboutcode.org/flux-1-nc.html>） | **高**（非商用结论） | 2026-10-15 |
| `diffusion_models\z_image_turbo_bf16.safetensors` | 12,309,866,400 | `2407613050B809FFDFF18A4AC99AF83EA6B95443ECEBDF80E064A79C825574A6` | 官方仓库：<https://huggingface.co/Tongyi-MAI/Z-Image-Turbo>（Tongyi-MAI / 阿里通义）；官方镜像 API：<https://www.modelscope.cn/api/v1/models/Tongyi-MAI/Z-Image-Turbo/repo?Revision=master&FilePath=README.md>（返回头部标记 **`license: apache-2.0`**）；ComfyUI 官方重打包：<https://huggingface.co/Comfy-Org/z_image_turbo> | **Apache License 2.0**（`license: apache-2.0`，由官方 ModelScope 仓库 README 头部元数据确认）；许可全文：<https://www.apache.org/licenses/LICENSE-2.0> | **需确认后才可用于付费** — 许可指标为 Apache-2.0（商用友好），但**本轮未能逐字读到许可证全文**，且**未确认模型卡是否附加额外条款**，因此**暂不标为「可以」** | ① Apache-2.0 义务：保留版权与许可声明、标明修改、附 `NOTICE`（如有）；**不含商标授权**；② **必须人工打开官方模型卡确认有无附加条款**（见 §4 待确认问题）；③ 官方模型卡曾有「许可文档被更正」的社区提交记录（<https://huggingface.co/unsloth/Z-Image-Turbo-ComfyUI/commit/36331456589ef3d621e9dbe7b6a8ef713719b9e8>），说明许可表述**曾经变动过** → 必须锁版本核对 | 搜索摘要 + 来源 URL（**官方 ModelScope 仓库 README 元数据**，非第三方） | **中**（指标明确，全文未读） | 2026-10-15 |

### 1.2 文本编码器 / VAE

| 文件名 | 字节数 | SHA256 | 官方来源 URL | 许可名称 + 许可 URL | 可否用于付费/商用生产流程 | 限制与义务 | 证据类型 | 置信度 | 核实日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `text_encoders\qwen_3_4b.safetensors` | 8,044,982,048 | **未算** | <https://huggingface.co/Qwen/Qwen3-4B> | **Apache License 2.0**（模型卡 `license: apache-2.0`；旁证：<https://modelscope.cn/models/Qwen/Qwen3-4B-GGUF/resolve/master/README.md>、<https://ollama.com/library/qwen3:4b-fp16/blobs/license>）；全文：<https://www.apache.org/licenses/LICENSE-2.0> | **需确认** — 许可指标为 Apache-2.0；但**本地文件与官方发布名的对应关系未直接确认**（`qwen_3_4b.safetensors` 是 ComfyUI 重打包命名，非 Qwen 官方发布名） | ① Apache-2.0 义务同上；② 需确认该文件确实来自 **Qwen3-4B**（或 Z-Image 官方指定的 Qwen3-4B 文本编码器），而非其他 Qwen 变体；③ 若来自 Z-Image 官方重打包，应同时遵守 Z-Image 侧声明 | 搜索摘要 + 来源 URL（官方 HF 模型卡 `license:` 字段被检索到；本地文件名为重打包名） | **中** | 2026-10-15 |
| `text_encoders\clip_g.safetensors` | 1,389,382,176 | **未算** | 来源为 SDXL 官方文本编码器（`stabilityai/stable-diffusion-xl-base-1.0` 的 `text_encoder_2`，OpenCLIP ViT-bigG/14）：<https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0> | **随 SDXL 基座许可（Stability AI Community License）**；上游 OpenCLIP 权重另涉 MIT 系许可（**本轮未逐字确认**）。许可 URL：<https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md> | **许可不明 → 不得用于付费流程**（在基座许可链条未闭合前） | ① 本地实测张量结构为 `text_model.encoder.layers.{0..31}` / hidden 1280 → **确为 OpenCLIP bigG 文本编码器**（SDXL 的第二文本编码器），**仅与 SDXL 系模型配套使用**；② 商用判断随 SDXL 基座许可（收入门槛等）；③ 文件名 `clip_g.safetensors` 为 ComfyUI 重打包名，**非官方发布名** → 官方发布名对应关系弱 | 本地结构实测 + 搜索摘要（SDXL 仓库许可路径）；**上游 OpenCLIP 许可未逐字确认** | **低** | 2026-10-15 |
| `text_encoders\clip_l.safetensors` | 246,144,152 | **未算** | 来源为 SDXL / FLUX 系所用 CLIP-L（OpenAI CLIP ViT-L/14 文本塔）：SDXL 侧 <https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0>；用于 FLUX 时随 <https://huggingface.co/black-forest-labs/FLUX.1-dev> | **随宿主模型的许可**（SDXL → Stability Community License；FLUX.1 dev → FLUX.1 [dev] Non-Commercial License）。CLIP 本身为 MIT（`openai/CLIP` 仓库），**本轮未逐字确认权重再分发条款** | **许可不明 → 不得用于付费流程**（取决于搭配哪个宿主；若搭配 FLUX.1 dev 则明确不可商用） | ① 本地实测张量结构为 `text_model.encoder.layers.{0..11}` / hidden 768 / vocab 49408 → **确为 CLIP-L 文本塔**；② **该文件不独立决定商用性，取决于所配主模型**；③ 若服务于 FLUX.1 dev 流程 → **非商用**；若服务于 SDXL 流程 → 受 Stability Community License 门槛约束 | 本地结构实测 + 搜索摘要 | **低** | 2026-10-15 |
| `vae\ae.safetensors` | 335,304,388 | **未算** | <https://huggingface.co/black-forest-labs/FLUX.1-dev>（FLUX.1 自编码器）；官方 code 仓库：<https://github.com/black-forest-labs/flux> | **本地元数据自述 `modelspec.license` = 「Apache License 2.0」**（见下方说明）；**但官方 FLUX.1 dev 的 `ae.safetensors` 随 **FLUX.1 [dev] Non-Commercial License** 发布** → 两者冲突，以官方为准：**非商用** | **不可** ❌（依 FLUX.1 [dev] 官方许可；用于非商业例外见 §5） | ① 本地 safetensors `__metadata__` 明写 `modelspec.architecture = Flux.1-AE`、`modelspec.author = Black Forest Labs`、`modelspec.license = Apache License 2.0`、`modelspec.date = 2024-08-01`；② **该字段是模型转换工具写入的规格标签，属本地自述而非官方许可声明**，不足以推翻 FLUX.1 dev 的非商用许可 → **以官方 BFL 许可为准**；③ 亦不得用于商业再分发 | 本地 safetensors 元数据（`modelspec.license`）+ 搜索摘要（BFL 许可文件） | 元数据读取 **高**；许可判定 **中高** | 2026-10-15 |

> **关于 `ae.safetensors` 的重要方法学说明**：这是本报告中**唯一一个本地元数据直接给出许可名**的文件。但 `modelspec.license` 是 safetensors 转换工具（如 `safetensors` / `kohya` / ComfyUI 侧脚本）写的**规格元数据**，**不是** Black Forest Labs 的许可声明。本地取证的价值在于：它证明**这个文件自述来自 FLUX.1 家族**，从而落入 FLUX.1 [dev] 非商用许可范围。**不能**据此把 VAE 标为 Apache-2.0。

### 1.3 LoRA

| 文件名 | 字节数 | SHA256 | 官方来源 URL | 许可名称 + 许可 URL | 可否用于付费/商用生产流程 | 限制与义务 | 证据类型 | 置信度 | 核实日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `loras\FLUX.1-Turbo-Alpha.safetensors` | 694,082,424 | `77F7523A5E9C3DA6CFC730C6B07461129FA52997EA06168E9ED5312228AA0BFF` | <https://huggingface.co/alimama-creative/FLUX.1-Turbo-Alpha>（阿里妈妈创意团队官方仓库，模型卡 README 存在） | **仓库 README 承载的许可**；本轮**未逐字读到许可名**（搜索索引命中官方 README 与转载提交，但未返回 `license:` 字段值）→ 按规则：**许可不明** | **许可不明 → 不得用于付费流程** | ① **许可名称/条款本轮未能从权威来源确认**，不得假设 Apache-2.0；② 该 LoRA **服务 FLUX.1 [dev] 基座** → 即使 LoRA 自身许可宽松，**基座非商用**仍会传染整个产出流程；③ 需保留作者署名（阿里妈妈） | 搜索摘要 + 来源 URL（官方 HF 仓库存在；许可字段未取得） | **低** | 2026-10-15 |
| `loras\flux-turbo-alpha.safetensors` | 694,082,424 | `77F7523A5E9C3DA6CFC730C6B07461129FA52997EA06168E9ED5312228AA0BFF` | 同上（**与上一行为同一文件的重复副本**，本地哈希实测完全一致） | 同上 → **许可不明** | **许可不明 → 不得用于付费流程**（同 #1；且基座为 FLUX.1 [dev] → 实质非商用） | 同上一行；**额外**：同一 LoRA 在本机存在两份副本，清理时可去重（本报告未做任何删除） | 本地哈希实测 + 搜索摘要 | **低** | 2026-10-15 |
| `loras\anime_lora_comfy_converted.safetensors` | 44,846,920 | `00DB9854C55EDBC0B6C5A8CFF6D84F6C1C5614456AA5676F7DF22E1983A9B551` | **无法确定唯一官方来源**。候选（均为第三方/Civitai 侧）：<https://civitai.com/models/640126>（`Flux-loras (full package)` 含 `anime_lora` 与 `realism_lora` 两个版本，镜像页：<https://civitai.red/models/640126/flux-loras-full-package-updated?modelVersionId=716032>）；XLabs 系 FLUX LoRA 仓库命名相近（<https://huggingface.co/XLabs-AI/flux-RealismLora>） | **许可不明**（本地无 `__metadata__`；上游 Civitai 页面本轮无法抓取；XLabs 仓库许可字段未取得） | **许可不明 → 不得用于付费流程** | ① **文件名 `anime_lora_comfy_converted` 与任何官方发布名都不能一一对应**，且是**二次转换**的产物；② 本地实测张量键为 `diffusion_model.*` 共 152 个 → **FLUX 结构 LoRA**，若基座是 FLUX.1 [dev] 则**继承非商用**；③ **动漫风格 + 疑似角色 IP** 风险叠加；④ 未取得发布方署名/许可页 | 搜索摘要 + 来源 URL（Civitai 侧页面）+ 本地结构实测；**无权威许可来源** | **低**（实为「不明」） | 2026-10-15 |
| `loras\realism_lora_comfy_converted.safetensors` | 22,433,528 | **未算** | 同上，**无法确定唯一官方来源**（`Flux-loras (full package)` 的 `realism_lora` 版本：<https://civitai.red/models/640126/flux-loras-full-package-updated?modelVersionId=715934>；XLabs 候选：<https://huggingface.co/XLabs-AI/flux-RealismLora>） | **许可不明** | **许可不明 → 不得用于付费流程** | 同上一行（换成 realism 版本）；① 与 `anime_lora` 同为**同一 Civitai 打包的两个变体**，命名与官方发布名不对应；② FLUX 结构 → 非商用传染风险；③ 未取得发布方许可页 | 搜索摘要 + 来源 URL + 本地结构实测；**无权威许可来源** | **低**（实为「不明」） | 2026-10-15 |

### 1.4 Inpainting / 放大模型

| 文件名 | 字节数 | SHA256 | 官方来源 URL | 许可名称 + 许可 URL | 可否用于付费/商用生产流程 | 限制与义务 | 证据类型 | 置信度 | 核实日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `inpaint\MAT_Places512_G_fp16.safetensors` | 125,280,278 | **未算** | 官方代码仓库：<https://github.com/fenglinglwb/MAT>（MAT: Mask-Aware Transformer for Large Hole Image Inpainting, CVPR 2022）；论文：<https://openaccess.thecvf.com/content/CVPR2022/html/Li_MAT_Mask-Aware_Transformer_for_Large_Hole_Image_Inpainting_CVPR_2022_paper.html>；HF 转换副本：<https://huggingface.co/Acly/MAT> | **许可不明** — 官方仓库存在，但**本轮未能检索到其 `LICENSE` 文件的许可名称**（同一作者账号的其他仓库出现的是 `Apache` 系 LICENSE，不能据此推定 MAT 仓库） | **许可不明 → 不得用于付费流程** | ① 仓库许可**未确认**，不得假设 Apache/MIT；② **训练数据风险**：`Places512` 指 **Places2 / Places365** 数据集，该数据集通常**限制为研究/非商业用途** → 即便代码许可宽松，**权重商用仍存疑**；③ 本地文件 `__metadata__` 仅 `{"format":"pt"}`，无发布方信息；④ 需保留论文署名与引用 | 搜索摘要 + 来源 URL（官方仓库存在；**许可文件未取得**）+ 数据集常识性风险 | **低** | 2026-10-15 |
| `upscale_models\4x_NMKD-Superscale-SP_178000_G.pth` | 66,958,607 | **未算** | Civitai 模型页：<https://civitai.com/models/141491>（4x NMKD Superscale, SP1780 版本 156841）；许可页（**镜像域名**）：<https://civitai.red/models/license/156841>；索引页：<https://openmodeldb.info/models/4x-NMKD-Superscale> | **许可不明** — 只能确认"存在一个 Civitai 许可页"，**本轮未读到许可名称与条款** | **许可不明 → 不得用于付费流程** | ① 许可名称/条款**未取得**；② 本地文件为 `.pth`（PyTorch pickle，**非 safetensors**，加载有反序列化安全风险，与许可无关但属工程注意项）；③ 本地实测其首 8 字节不是合法的 safetensors 头长度（`HDRLEN` 值异常）→ **确为 `.pth` 格式**；④ 需保留作者 N00MKRAD 署名 | 搜索摘要 + 来源 URL（Civitai 许可页存在但内容未取得）+ 本地格式实测 | **低** | 2026-10-15 |

### 1.5 本机另有的、任务清单未点名的相关文件（一并记录，便于后续判断）

| 文件名 | 字节数 | 说明 | 许可判断 |
| --- | --- | --- | --- |
| `upscale_models\OmniSR_X2_DIV2K.safetensors` | 1,655,992 | OmniSR 放大模型（DIV2K 训练），ComfyUI 侧来源 <https://huggingface.co/Acly/Omni-SR> | **许可不明 → 不得用于付费流程**（`Acly/Omni-SR` 侧未确认许可字段） |
| `upscale_models\OmniSR_X3_DIV2K.safetensors` | 1,673,302 | 同上（X3） | 同上 |
| `upscale_models\OmniSR_X4_DIV2K.safetensors` | 1,697,536 | 同上（X4）；另有第三方 HF 数据集仓库标记 `license: apache-2.0`（<https://huggingface.co/api/resolve-cache/models/mp3pintyo/upscale/...>），**属第三方转载说法，置信度低** | **许可不明 → 不得用于付费流程** |
| `vae_approx\tae*.safetensors`（共 8 个） | 约 2.4 MB / 个 | ComfyUI 内置的 TAESD 近似解码器（预览用），随 ComfyUI 分发 | 随 ComfyUI 主仓库许可（**本轮未核查**），与商用输出无关，可忽略 |

---

## 2. 本地取证记录（可复现命令，只读）

```powershell
# 1) 精确字节数
$base = 'C:\Users\sharyuke\Documents\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI\models'
Get-ChildItem -Path $base -Recurse -File | Select-Object FullName, Length, LastWriteTime

# 2) 6 个关键权重的 SHA256（本报告实际执行）
$files = @(
 'checkpoints\v1-5-pruned-emaonly.ckpt',
 'checkpoints\realisticVisionV60B1_v51HyperVAE.safetensors',
 'checkpoints\sdxl_lightning_4step.safetensors',
 'checkpoints\flux1-dev-bnb-nf4-v2.safetensors',
 'diffusion_models\z_image_turbo_bf16.safetensors',
 'loras\anime_lora_comfy_converted.safetensors'
)
foreach ($f in $files) { Get-FileHash -Path (Join-Path $base $f) -Algorithm SHA256 }
```

- 上述命令**全部为只读操作**，未写入/移动/删除任何权重文件。
- safetensors 头部元数据用只读方式读取前若干字节的 JSON 头，未加载张量内容。

---

## 3. 风险分级汇总（一眼看清）

### 3.1 明确「不可商用」（有明确官方非商用许可）

- `checkpoints\flux1-dev-bnb-nf4-v2.safetensors` — FLUX.1 [dev] Non-Commercial License
- `vae\ae.safetensors` — FLUX.1 自编码器，随 FLUX.1 [dev] 非商用

### 3.2 「许可不明 → 不得用于付费流程」（按规则强制冻结）

- `checkpoints\realisticVisionV60B1_v51HyperVAE.safetensors`（第三方 merge，命名不对应官方发布）
- `checkpoints\Anything-V3.0-pruned-fp16.safetensors`（仅第三方镜像转述许可）
- `text_encoders\clip_g.safetensors`、`text_encoders\clip_l.safetensors`（重打包名；商用性随宿主，链条未闭合）
- `loras\FLUX.1-Turbo-Alpha.safetensors`、`loras\flux-turbo-alpha.safetensors`（官方仓库许可字段未取得）
- `loras\anime_lora_comfy_converted.safetensors`、`loras\realism_lora_comfy_converted.safetensors`（**无法对应任何官方发布名**）
- `inpaint\MAT_Places512_G_fp16.safetensors`（仓库许可未取得 + Places 数据集非商用风险）
- `upscale_models\4x_NMKD-Superscale-SP_178000_G.pth`（Civitai 许可页内容未取得）
- `upscale_models\OmniSR_X2/X3/X4_DIV2K.safetensors`

### 3.3 「可以」（有明确官方许可来源，允许商业使用，但带强制义务）

- `checkpoints\v1-5-pruned-emaonly.ckpt` — **CreativeML Open RAIL-M**：允许商业使用，但必须传递许可、遵守 Use-based restrictions

> 注意：这是本轮**唯一**判定为「许可允许商用」的权重。其余模型要么明确非商用、要么许可不明。

### 3.4 「需确认后才可用」（许可指标友好，但全文未逐字核实或存在附加条件）

- `diffusion_models\z_image_turbo_bf16.safetensors` — 官方 ModelScope README 标 `license: apache-2.0`
- `text_encoders\qwen_3_4b.safetensors` — Qwen3-4B 标 `license: apache-2.0`
- `checkpoints\sdxl_lightning_4step.safetensors` — 自身许可较宽松，**但依赖 SDXL 基座的 Stability Community License（含收入门槛）**

---

## 4. 第一轮建议

### 4.1 前提约束（本轮所有建议都在此约束下成立）

- **硬件**：RTX 2060 **6GB VRAM**，单张 512×512
- **接入方式**：服务端调用本地推理（非浏览器端）
- **合规红线**（来自需求文档）：
  - 许可不明或明确禁止当前商业用途的模型，**不得用于付费生产流程**
  - **不得**直接认定所有 SD / 第三方 checkpoint 都可商用，按具体模型许可判断
  - 许可不明时**禁止标为「可商用」**，应暂停并报告

### 4.2 可作「付费功能候选」的模型（按许可风险从低到高，最多 3 个）

#### 候选 1（风险最低）：`checkpoints\v1-5-pruned-emaonly.ckpt` — SD 1.5

- **许可**：CreativeML Open RAIL-M（**唯一有明确官方许可来源、且允许商业使用**的权重）
- **理由**：
  1. 许可**明确允许商业使用**（含对输出收费），无收入门槛、无需向发布方申请；
  2. 本地 SHA256 与官方 SD 1.5 权重指纹一致 → **来源可证**（不是来路不明的 checkpoint）；
  3. **6GB VRAM 唯一稳跑的底模**：512×512 单张在 SD 1.5 下显存占用通常低于 4GB，是 RTX 2060 的舒适区。
- **必须同时做的合规动作**（不做就不能上线）：
  1. 在服务端与前端「关于/许可」页**附上 CreativeML Open RAIL-M 全文**，并说明**输出内容同样受 Use-based restrictions 约束**；
  2. 建立**违规提示词拦截**（避免生成受限制内容），并保留日志以证明已尽合理注意义务；
  3. 用户协议中明确：**输出内容的合法使用责任在用户**，平台不保证输出的可版权性或第三方 IP 清洁度；
  4. **不要把「SD 1.5 可商用」外推为「所有 SD 系 checkpoint 可商用」** —— 这正是需求文档明令禁止的推理。
- **残留风险（必须写进风险登记册）**：SD 1.5 输出在美国版权体系下通常**不受版权保护**（用户不能主张独占权）；训练数据来源存在**未决诉讼**（如 Andersen v. Stability AI 等）。许可允许商用 ≠ 输出无法律风险。

#### 候选 2：`diffusion_models\z_image_turbo_bf16.safetensors` — Z-Image Turbo（**有条件**：必须先完成 §5 的确认项）

- **许可**：官方 ModelScope 仓库 README 元数据标 `license: apache-2.0`（Apache-2.0 商用友好）
- **理由**：Apache-2.0 是**最宽松的一档**（无收入门槛、无使用场景限制、无申请流程），只需要保留声明与 NOTICE。
- **为什么排在候选 1 之后而不是之前**：
  1. **本轮未逐字读到官方许可证全文**，且社区有「许可文档被更正」的历史提交 → **必须先人工核实 §5-Q2**；
  2. **硬件不匹配**：12.3GB 的 bf16 权重远超 6GB VRAM，需 **GGUF/量化 + block swap** 才能跑；512×512 Turbo 推理在 6GB 上属「勉强可行」，需实测；
  3. 需要配套 Qwen3-4B 文本编码器（8GB 权重，需 **CPU offload 到内存**）。
- **落地路径（若确认通过）**：改用 Qwen3-4B 的 GGUF Q4/Q5 量化 + Z-Image Turbo GGUF Q4，走 CPU offload；先做**内部性能验证**，通过后再评估付费功能。
- **注意**：在 §5-Q2 得到肯定答复前，**该模型只能内部测试**。

#### 候选 3：`checkpoints\sdxl_lightning_4step.safetensors` — SDXL-Lightning 4step（**最弱候选，存在许可链条缺口**）

- **许可**：ByteDance 仓库 `LICENSE.md` 存在（看似宽松）**但**基座 SDXL 的 Stability Community License **含年营收门槛**
- **为什么仍列入候选**：4 步推理在 6GB 上确实有吸引力；若基座许可门槛满足（年营收低于门槛），整条链路是通的。
- **为什么不建议首发就用它**：
  1. **许可链条未闭合**：本轮**没有确认**实际使用的 SDXL 基座是哪一个 checkpoint、其许可版本为何 → 按需求文档「依赖的商业使用许可不明确时禁止标可商用」，**必须暂停**；
  2. **再分发义务更重**：蒸馏权重属「模型再分发」，比「只跑官方权重做推理」承担更多传递许可的义务；
  3. 6GB VRAM 跑 SDXL（哪怕 4step）在 512×512 下需要 `--lowvram` 与长时间换页，**吞吐可能不足以支撑付费服务**。
- **升级为「可以」的前提**：见 §5-Q1。

> **补充说明**：`checkpoints\Anything-V3.0-pruned-fp16.safetensors` 虽然是 1.99GB、**6GB 显卡最省显存**的 SD 1.5 系动漫模型，技术上最适合 512×512 拼豆/像素风的动漫化，但**许可仅由第三方镜像转述**，按规则**只能内部测试**，不能进入付费候选。

### 4.3 「只能内部测试」的模型清单

| 模型 | 只能内部测试的原因 |
| --- | --- |
| `checkpoints\flux1-dev-bnb-nf4-v2.safetensors` | **明确非商用**（FLUX.1 [dev] Non-Commercial License）。仅可用于个人/研究性质的内部评估；**其输出同样不得用于商业目的**（包括不得作为付费功能的中间产物） |
| `vae\ae.safetensors` | 随 FLUX.1 [dev] 非商用；**仅在与 FLUX.1 dev 内部测试同一流程时使用** |
| `loras\FLUX.1-Turbo-Alpha.safetensors`、`loras\flux-turbo-alpha.safetensors` | 许可字段未取得 + 基座为 FLUX.1 [dev]（非商用）；两份为同一文件重复副本 |
| `loras\anime_lora_comfy_converted.safetensors`、`loras\realism_lora_comfy_converted.safetensors` | **无法对应任何官方发布名**、无 `__metadata__`、FLUX 结构 → 非商用传染 + 来源不明 |
| `checkpoints\Anything-V3.0-pruned-fp16.safetensors` | 许可仅第三方转述；动漫风格 + 角色 IP 风险 |
| `checkpoints\realisticVisionV60B1_v51HyperVAE.safetensors` | 第三方 merge（V6.0 B1 + Hyper VAE），成分许可需分别满足，命名不对应官方发布 |
| `text_encoders\clip_g.safetensors`、`text_encoders\clip_l.safetensors` | 重打包名；商用性取决于宿主模型，链条未闭合 |
| `inpaint\MAT_Places512_G_fp16.safetensors` | 仓库许可未取得 + Places 数据集非商用风险 |
| `upscale_models\4x_NMKD-Superscale-SP_178000_G.pth` | Civitai 许可页内容未取得 |
| `upscale_models\OmniSR_X2/X3/X4_DIV2K.safetensors` | 上游许可未确认 |
| `checkpoints\sdxl_lightning_4step.safetensors` | 基座 SDXL 许可链条未闭合（在 §5-Q1 解决前） |

### 4.4 对「第一轮」的工程建议

1. **先立流程，再谈模型**：把「模型台账」做成可执行规则 —— 任何新增权重，必须先在 `docs/local-ai/` 登记「文件名 / SHA256 / 官方来源 URL / 许可名 / 许可 URL / 商用判定 / 核实日期 / 置信度」，缺一项即**禁止进入付费流程**。
2. **哈希入库**：把 §1 的 SHA256 与字节数写进仓库，作为「权重未被替换」的校验基线（尤其 `v1-5-pruned-emaonly.ckpt`）。
3. **准备「许可不明」的暂停机制**：本轮有 **11 个文件**落入「许可不明」区间，说明**下载前的许可审查这一步此前是缺失的**。建议在下载脚本/人工流程里加一道「先登记许可，后下载」的闸门。
4. **性能与合规解耦**：先在 6GB 上做一轮**纯性能**压测（SD 1.5 512×512 的显存、单张耗时、并发上限），再决定付费功能的产品形态；不要在合规未闭环时先把模型接进付费链路。
5. **不要为了「能商用」而临时换用来源不明的 checkpoint** —— 这会把「许可不明」从 11 个变成更多。

---

## 5. 需要用户确认的问题

> 以下每一项都会**直接改变**某个模型能否进入付费流程，请逐条确认（确认后本报告相应行可从「许可不明」升级）。

1. **【Q1 · SDXL 基座】`sdxl_lightning_4step` 实际搭配的 SDXL 基座是哪一个 checkpoint？其许可版本与年营收门槛是否满足？**
   - 若是 `stabilityai/stable-diffusion-xl-base-1.0` → 需确认豆玩主体**年营收是否低于 Stability Community License 的门槛**（常见表述为 100 万美元）；超过则**必须购买 Stability 企业许可**。
   - 若基座是其他 SDXL 衍生（如 Juggernaut XL、Playground v2 等）→ **其许可需单独核查**，不能沿用 SDXL 的说法。
   - 请提供：基座文件名 + 来源 URL + 主体年营收区间。

2. **【Q2 · Z-Image Turbo 许可全文】请人工打开 <https://huggingface.co/Tongyi-MAI/Z-Image-Turbo> 与 <https://www.modelscope.cn/models/Tongyi-MAI/Z-Image-Turbo> 的模型卡，确认：**
   - 许可是否为 **Apache-2.0**（无附加条款）？
   - 是否含**额外使用限制**（例如禁止用于训练其他模型、禁止竞品商用、需署名、需注册）？
   - 是否有 **NOTICE / 附加条款文件**需要一并随产品分发？
   - 本报告因无法逐字读取全文，**暂不将其标为「可以」**。

3. **【Q3 · Realistic Vision 合并版】`realisticVisionV60B1_v51HyperVAE.safetensors` 是从哪个页面下载的？**
   - 需要该**具体 merge 版本的发布页 URL 与发布者**（不是 SG161222 原始模型页）。
   - 同时需确认其中的 **Hyper-SD 成分（ByteDance）** 的许可（搜索索引显示其 HF 仓库标记 `license: openrail++`），以及 **VAE** 的来源许可。
   - 若找不到该 merge 的原始发布页 → 该文件按「许可不明」处理，**永久不得进入付费流程**。

4. **【Q4 · LoRA 溯源】`anime_lora_comfy_converted.safetensors` 与 `realism_lora_comfy_converted.safetensors` 的下载来源是哪个页面/工具？**
   - 目前只能定位到 Civitai 的 `Flux-loras (full package)`（<https://civitai.com/models/640126>）与 XLabs 仓库两个候选，**无法一一对应**。
   - 请提供下载 URL 或下载工具记录；若无法提供 → 按「许可不明」永久冻结（同时该 LoRA 服务 FLUX.1 dev，**本已非商用**）。

5. **【Q5 · NMKD Superscale 许可】请人工打开 <https://civitai.com/models/141491> 的许可页，确认许可名称与是否允许商用。**
   - 本轮只确认了「存在一个 Civitai 许可页」，**内容未取得**。

6. **【Q6 · MAT inpainting】请确认 <https://github.com/fenglinglwb/MAT> 仓库的 LICENSE 名称，并确认 Places2/Places365 训练数据对**商用模型的传染性**如何看待。**
   - 若仓库无 LICENSE → 默认「保留所有权利」，**不得商用**。
   - 若 Places 数据集限制研究用途 → 权重商用存疑，建议**只用内部测试**。

7. **【Q7 · 产品形态】AI 功能计划以什么形式收费？**
   - 「按次收费的生成服务」/「会员权益内的生成额度」/「仅内部运营人员使用（不对外）」—— 三者对许可义务的要求不同。
   - 特别是：若计划**只让运营人员在内部生成素材**、再把素材用进付费产品，仍需确认该素材的**生成过程**是否构成「商业使用」（FLUX.1 [dev] 明确禁止，OpenRAIL-M 需看具体用途）。

8. **【Q8 · SD 1.5 输出质量阈值】512×512、SD 1.5 基座的生成质量，是否满足拼豆/像素画的产品要求？**
   - 若必须靠 `Anything-V3` 或 `Realistic Vision` 这类微调才能达到质量线，则**付费功能的可行模型只剩 SD 1.5 官方权重这一个**（其余许可不明），这会影响产品路线决策。

9. **【Q9 · 许可文本分发】产品是否需要提供「开源许可 / 第三方组件」页面？**
   - OpenRAIL-M 与 Apache-2.0 **都要求传递许可文本**。若确定用 SD 1.5，需要安排一个页面展示许可全文与 Use-based restrictions 摘要。

10. **【Q10 · 是否购买 FLUX 商用许可】是否有预算购买 BFL 的 self-hosted 商用许可**（<https://bfl.ai/legal/self-hosted-commercial-license-terms>）？
    - 若有预算，FLUX 系（含现有 4 个 LoRA）可整体解禁；若无，则本机 11.22GB 的 FLUX 权重与 4 个 FLUX LoRA **只能用于内部测试**。

---

## 6. 本报告的合规声明（必须保留）

1. **本轮没有把任何模型标记为「可商用」，除了有明确官方许可来源的。**
   - 唯一满足「有明确官方许可来源 + 允许商业使用」的权重是：
     **`checkpoints\v1-5-pruned-emaonly.ckpt` —— CreativeML Open RAIL-M**（来源：<https://huggingface.co/runwayml/stable-diffusion-v1-5>）。
   - 即使是它，也**不是「无条件可商用」**：必须随附许可全文、传递 Use-based restrictions，并对输出内容负责。
   - 另有 3 个模型许可指标友好（Z-Image Turbo、Qwen3-4B 标 `apache-2.0`；SDXL-Lightning 自身许可宽松），但**许可全文未逐字核实或依赖项未闭合**，故**一律不标为「可以」**，只列为「需确认后才可用」。

2. **本次核查未下载任何模型文件，未修改、移动、删除或重命名本机任何文件。** 所有本地操作均为只读（字节数、SHA256、safetensors 头部结构读取）。

3. **本报告不含任何密钥、令牌、密码或凭据。**

4. **本报告的全部联网结论均基于 `web_search` 的摘要与来源 URL**，每一条均附 URL。由于本机沙箱阻断了 `web_fetch` 与直连 HTTPS，**没有一条结论是逐字阅读官方许可证原文得出的**，因此：
   - 「明确非商用」（FLUX.1 [dev]）与「明确允许商用」（SD 1.5 / CreativeML Open RAIL-M）两类结论置信度为**高**；
   - 「许可不明」的判定**本身就包含保守倾向**（宁可判不明，不判可用）；
   - 「可直接商用」的候选（Z-Image Turbo、Qwen3-4B、SDXL-Lightning）在 §5 的确认项完成前**保持冻结**。

5. **本报告是工程合规草稿，不构成法律意见。** 涉及训练数据诉讼、输出可版权性、第三方 IP 等事项，需专业法律意见。

---

*草稿版本：第一轮（2026-10-15）。后续每完成 §5 中一项确认，应更新对应行的「可否用于付费/商用生产流程」「证据类型」「置信度」并记录修改日期。*

---

## 7. rembg 抠图模型审计（阶段 B 新增 · 实测确认）

### 7.1 审计方法（可复现）

rembg 2.0.85 的 `/api/remove` 对 `model` 参数做**服务端枚举校验**。故意传一个非法值即可让服务端自己吐出完整白名单（比查文档更可靠）：

```bash
# 传 model=nope，服务端返回 422，detail[0].ctx.pattern 里就是完整枚举
curl -s -X POST http://127.0.0.1:7000/api/remove -F file=@x.png -F model=nope
# → 422 {"detail":[{"type":"string_pattern_mismatch","loc":["body","model"],
#        "msg":"String should match pattern '(birefnet-general|...|withoutbg)'"}]}
```

源码侧佐证（只读）：`C:\Users\sharyuke\DouWanAI\rembg\.venv\Lib\site-packages\rembg\sessions\*.py`，
每个模型类的 `download_models()` 里写明了**权重下载 URL 与 MD5**。

### 7.2 服务端允许的全部 20 个模型名（实测枚举，2026-10-15）

```
birefnet-general, birefnet-general-lite, birefnet-portrait, birefnet-dis,
birefnet-hrsod, birefnet-cod, birefnet-massive, isnet-anime, dis_custom,
isnet-general-use, sam, silueta, u2net_cloth_seg, u2net_custom,
u2net_human_seg, u2net, u2netp, bria-rmbg, ben_custom, withoutbg
```

### 7.3 逐个判定

| 模型名 | 权重来源（源码内 URL/MD5） | 许可判定 | 能否进付费流程 |
| --- | --- | --- | --- |
| `u2net` | `github.com/danielgatis/rembg/releases/.../u2net.onnx`，`md5:60024c5c889badc19c04ad937298a77b` | U-2-Net 架构，rembg 仓库 **MIT**；权重随 rembg release 分发 | **可以**（豆玩抠图默认模型） |
| `u2netp` | 同上 `/u2netp.onnx`，`md5:8e83ca70e441ab06c318d82300c84806` | 同上，轻量版 | 需登记后可用（未实测精度） |
| `silueta` | 同上 `/silueta.onnx`，`md5:55e59e0d8062d2f5d013f4725ee84782` | 同 U2-Net 系，独立权重文件 | 需登记后可用 |
| `u2net_human_seg` | 同上 `/u2net_human_seg.onnx`，`md5:c09ddc2e0104f800e3e1bb4652583d1f` | 同上 | 需登记后可用（人像专用，**未实测**） |
| `u2net_cloth_seg` | 同上 `/u2net_cloth_seg.onnx`，`md5:2434d1f3cb744e0e49386c906e5a08bb` | 同上 | 需登记后可用 |
| `u2net_custom` / `dis_custom` / `ben_custom` | **指向用户自备权重目录**，服务端无内置权重 | 取决于用户放入的权重 → **当前无权重，等同于不可用** | 不可（无权重） |
| `bria-rmbg` | **`/api/remove` 的默认值** | **商业授权模型（BRIA）** | **严禁使用**（红线，必须显式覆盖） |
| `birefnet-*`（7 个） | 第三方 BiRefNet 系列 | 未完成授权核验 | 冻结 |
| `isnet-anime` / `isnet-general-use` | DIS 系第三方权重 | 未完成授权核验（动漫模型另有 IP 风险） | 冻结 |
| `sam` | Meta Segment Anything | 权重许可需单独核验 | 冻结 |
| `withoutbg` | 第三方服务权重 | 未完成授权核验 | 冻结 |

> **结论**：豆玩抠图功能**锁定 `u2net`**。`u2netp` / `silueta` / `u2net_human_seg` / `u2net_cloth_seg`
> 同属 rembg 仓库分发、许可风险等级与 `u2net` 相同，属**可登记后启用**的备选；其余 15 个一律冻结。

### 7.4 实测记录（RTX 2060 / CPU 抠图）

`u2net` + `POST /api/remove`（multipart 字段名 `file`），2026-10-15 实测：

| 输入 | 尺寸 | 耗时 | 输出 | 透明像素占比 | 四角 alpha |
| --- | --- | --- | --- | --- | --- |
| 合成人像 `input-person-640x800.png` | 640×800 | 0.6s | PNG colorType=6（RGBA） | 0.7989 | `[0,0,0,0]` |
| 熊猫照片 `input-panda-512.jpg` | 512×512 | 0.2s | PNG colorType=6（RGBA） | 0.4941 | `[0,0,10,2]` |

- 阴性对照：`model=not-a-real-model` → **HTTP 422** `string_pattern_mismatch`，证明请求里**确实**带上了 `model` 字段（而不是被服务端默认成 `bria-rmbg`）。
- 服务端默认 `model=bria-rmbg` **已确认**（源码 `s_command.py`）→ 任何调用**必须**显式传 `model=u2net`。
- 抠图在 **CPU** 上跑（rembg 未启用 GPU），单张亚秒级，可支撑 2 并发（见 `docs/local-ai-deployment.md`）。

### 7.5 抠图功能的合规动作（必须做）

1. 界面与文档注明「抠图模型：U-2-Net（`u2net`），Apache-2.0 / MIT 系，随 rembg 分发」；
2. **禁止**任何代码路径省略 `model` 参数（省略即落到 `bria-rmbg`，会构成商业授权模型的未授权使用）；
3. 不启用 `u2net_custom` / `dis_custom` / `ben_custom`（无权重且来源不可控）。

---
