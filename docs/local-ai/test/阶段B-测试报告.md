# 阶段 B 测试报告：本地 AI 节点（ComfyUI + rembg）

- 测试日期：**2026-10-15 ~ 2026-10-16**
- 测试对象：`SY-NB`（Windows，RTX 2060 6GB）—— 本机既是控制端也是 AI 节点
- 交付物：`repos/douwan-ai-node/`（脚本 8 个 + 工作流模板 3 个）、`docs/local-ai-deployment.md`、`docs/local-ai-models.md`
- 结论：**阶段 B 通过**。抠图与文生图可进入后端接入；卡通化质量存在一项需要产品决策的限制（见 §4）

---

## 1. 测试环境

| 项目 | 值 |
| --- | --- |
| 主机 | `SY-NB` Windows，PowerShell 5.1.26100.9711 / pwsh 7.5 |
| GPU | NVIDIA GeForce RTX 2060，6144MiB，驱动 610.88 |
| ComfyUI | v0.16.4（portable），`python_embeded` 3.13.11，torch 2.10.0+cu130 |
| rembg | 2.0.85，onnxruntime 1.31.0（**CPU** 推理） |
| 抠图权重 | `C:\Users\sharyuke\DouWanAI\models\u2net\u2net.onnx`（167.8MB） |
| 底模 | `v1-5-pruned-emaonly.ckpt`（SD 1.5，CreativeML Open RAIL-M） |
| 监听 | ComfyUI `127.0.0.1:8188`、rembg `127.0.0.1:7000`（**均只回环**） |

---

## 2. 逐项测试结果

### 2.1 脚本可用性（8 个脚本）

| 脚本 | 测试内容 | 结果 |
| --- | --- | --- |
| `check-syntax.ps1` | 全部 `.ps1` 语法 + BOM | ✅ 8/8 通过 |
| `fix-bom.ps1` | BOM 修复（含被吃掉的 `<#`） | ✅ 幂等，重复运行无副作用 |
| `check-environment.ps1` | 8 项环境体检 | ✅ 无阻塞项，退出码 0 |
| `start-comfyui.ps1` | 启动 + 幂等（重复调用不重复起实例） | ✅ 退出码 0 |
| `start-rembg.ps1` | 启动 + 幂等 | ✅ 退出码 0 |
| `health-check.ps1` | 服务在线（exit 0）/ 离线（exit 1）/ `-Json` | ✅ 三种模式都正确 |
| `stop-local-ai.ps1` | 停止 + `-DryRun` + 失败如实报错 | ✅ 见 §2.4 |
| `comfy-run-workflow.cjs` | 参数校验 + 端到端生成 | ✅ 见 §2.2、§2.5 |
| `rembg-remove.cjs` | 抠图 + 模型白名单拦截 | ✅ 见 §2.3 |

### 2.2 抠图（rembg / `u2net` / CPU）

| 输入 | 尺寸 | 耗时 | 输出 | 透明像素占比 | 四角 alpha |
| --- | --- | --- | --- | --- | --- |
| 合成人像 | 640×800 | **0.6s** | PNG RGBA（colorType=6） | 0.7989 | `[0,0,0,0]` |
| 熊猫照片 | 512×512 | **0.2s** | PNG RGBA（colorType=6） | 0.4941 | `[0,0,10,2]` |
| 人像 + alpha matting（`--a`） | 640×800 | **0.5s** | PNG RGBA | 0.8072（边缘更干净） | — |

- **阴性对照**：`model` 传非法值 → **HTTP 422** `string_pattern_mismatch`
  → 证明请求里确实带了 `model` 字段（不会被服务端默认成 `bria-rmbg`）。
- **契约验证**：读取 `/openapi.json` 得到真实路由，只有 `GET|POST /api/remove`，multipart 字段名固定 `file`。
- 人工看图确认：人像背景全透明、边缘干净；熊猫绒毛边缘有自然过渡（不是硬切）。

### 2.3 模型白名单拦截（合规红线）

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `REMBG_MODEL=bria-rmbg`（商业授权模型） | 拒绝执行 | ✅ 退出码 2，打印拒绝理由与文档链接 |
| `REMBG_MODEL=not-a-real-model` | 服务端 422 | ✅ HTTP 422 |

### 2.4 服务的停止 / 重启循环

```
health-check（在线，exit 0，PID 9524 / 15532）
  → stop-local-ai.ps1（凭命令行证据停止，exit 0）
  → netstat 确认 8188/7000 均无监听
  → health-check（离线，exit 1，提示启动命令）
  → start-rembg.ps1（exit 0）/ start-comfyui.ps1（exit 0）
  → health-check（在线，exit 0，PID 34588 / 32604）
  → 抠图 + 文生图复测（全部成功）
```

**过程中发现并修掉 1 个真 bug**：`Stop-Process` 在受限环境下会失败，
但旧脚本仍打印「已停止」并返回 0 —— 属于**假成功**。已改为：
① `Stop-Process -Force`，失败则退回 `taskkill /PID /T /F`；
② **以「端口是否真的释放」为最终判据**；
③ 失败时打印明确错误并返回退出码 1。

### 2.5 文生图 / 卡通化（SD 1.5）

| 用例 | 尺寸 | 耗时 | 备注 |
| --- | --- | --- | --- |
| 文生图 | 512×512 | **6.0s** | 稳态 |
| 文生图 | 640×640 | **8.1s** | 传 644 被自动取整为 640（8 的倍数） |
| 文生图（重启后复测） | 512×512 | **7.2s** | 模型冷加载后首张 |
| 卡通化 img2img | 640×800 | **23.3s** | 大尺寸 + 首次加载 |
| 卡通化 img2img | 512×512 | 6.0–7.1s | 稳态 |

**参数校验（`comfy-run-workflow.cjs`）全部按预期拒绝**：

| 用例 | 实际输出 |
| --- | --- |
| `--sampler_name totally-fake` | `参数 sampler_name=totally-fake 非法: 不在枚举 ... 内` |
| 缺必填 `--input` | `缺少必填参数 --image（...）` |
| `--denoise 2.5` | `参数 denoise=2.5 非法: > 1` |
| `--steps abc` | `参数 steps 需要整数，收到 abc` |

### 2.6 显存实测（RTX 2060 6GB）

| 状态 | 显存 |
| --- | --- |
| ComfyUI 完全退出 | 已用 **2194MiB**（桌面程序占用），空闲 3950MiB |
| ComfyUI `--lowvram` 刚启动、未加载模型 | 空闲 **5113MiB** |
| ComfyUI 加载 SD 1.5 并跑完一张（常驻） | 空闲 **2822–2886MiB** |
| 桌面程序较多时（曾出现） | 已用 5403MiB / 6144MiB → 接近 OOM |

→ **ComfyUI 常驻约 2.2–2.3GB**；可用额度取决于桌面程序占用，
所以 `check-environment.ps1` 会在空闲显存 < 2500MiB 时给出警告。

---

## 3. 安全红线验证

| 红线 | 验证方式 | 结果 |
| --- | --- | --- |
| 不得公网暴露推理端口 | `netstat` 检查监听地址 | ✅ 只有 `127.0.0.1:8188`、`127.0.0.1:7000` |
| 启动参数不得 `--listen 0.0.0.0` | `config.ps1` 固定参数 + 脚本内注释警告 | ✅ |
| rembg 默认监听 `0.0.0.0` | 显式 `-h 127.0.0.1` | ✅ 已强制 |
| rembg 默认模型 `bria-rmbg`（商业授权） | 驱动脚本强制 `model=u2net` + 白名单校验 | ✅ 见 §2.3 |
| 不得提交密钥 | 脚本内无任何凭据 | ✅ |
| 不做端口映射 / Funnel / 公网反代 | 本阶段未做任何网络暴露配置 | ✅ |
| 未改动生产（qq） | 本阶段未登录 qq 做任何变更 | ✅ |
| 大文件下载前告知 | 本阶段**没有新增大体积下载**（复用既有 ComfyUI 与 SD 1.5 权重；u2net 176MB 已在阶段 A 获授权） | ✅ |

---

## 4. 遗留问题（需要产品/用户决策）

### 4.1 卡通化的保形 vs 风格化不可兼得（重要）

对同一张照片做 denoise 扫描（steps 26 / cfg 8.0 / seed 固定）：

| denoise | 耗时 | 观感 |
| --- | --- | --- |
| 0.55 | 6.0s | 几乎看不出变化 |
| 0.65 | 6.0s | 轻微风格化，仍像照片 |
| **0.75** | 7.1s | **主体被替换**（熊猫 → 动漫白发角色），身份丢失 |
| 0.85 | 6.0s | 主体继续被改写 |
| 0.95 | 6.0s | 完全重绘，与原图无关 |

**原因**：可用底模只有 SD 1.5 官方权重（唯一许可明确的权重），它本身不是动漫模型；
要把照片推到「明显卡通」必须让模型大幅重绘，必然丢主体。
`Anything-V3` / `Realistic Vision` 这类更适合的微调模型**许可不明**（见 `docs/local-ai-models.md` §3.2），
按需求文档红线**不得进入付费流程**。

**建议**（待用户拍板）：
1. 默认走**前端确定性滤镜卡通化**（`pindoudou/src/lib/cartoon.js`，无模型、无许可风险、零 GPU）；
2. 模型卡通化作为**可选的「更艺术化」第二次生成**，并在界面明确提示「可能改变主体」；
3. 若必须做「保形卡通化」，需先解决卡通 LoRA 或 ControlNet 权重的**许可**问题（本机现有 LoRA 全部不可用）。

### 4.2 分辨率上限

6GB 显存下建议锁 512×512（文生图可到 640），模板里 `width/height` 上限已设为 768 作为保守值。
更高分辨率需要更大显存的节点或更深度的显存优化（本轮未做）。

### 4.3 `u2netp` / `silueta` 等备选抠图模型

同属 rembg 仓库分发、许可风险等级与 `u2net` 相同，但**精度未实测**。
若要启用，先按 `docs/local-ai-models.md` §7.3 登记，并补一轮精度对比。

---

## 5. 可复现命令

```powershell
$S = "C:\Users\sharyuke\Documents\work\douwan\repos\douwan-ai-node\scripts\local-ai"
$W = "C:\Users\sharyuke\Documents\work\douwan\repos\douwan-ai-node\workflows\local-ai"
$N = "C:\Users\sharyuke\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$T = "C:\Users\sharyuke\Documents\work\douwan\docs\local-ai\test"

# 语法 / 环境 / 健康
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\check-syntax.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\check-environment.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\health-check.ps1"

# 抠图（含模型白名单拦截）
& $N "$S\rembg-remove.cjs" "$T\input-panda-512.jpg" "$T\out-nobg\panda.png"
$env:REMBG_MODEL='bria-rmbg'; & $N "$S\rembg-remove.cjs" "$T\input-panda-512.jpg" "$T\x.png"   # 应退出码 2
Remove-Item Env:\REMBG_MODEL

# 文生图 / 卡通化
& $N "$S\comfy-run-workflow.cjs" "$W\txt2img-api.json" "$T\txt2img" --positive "a red lantern" --seed 42
& $N "$S\comfy-run-workflow.cjs" "$W\cartoonize-api.json" "$T\sweep" --input "$T\input-panda-512.jpg" --denoise 0.6

# 停 / 起
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\stop-local-ai.ps1" -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\stop-local-ai.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\start-rembg.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\start-comfyui.ps1"
```

---

## 6. 阶段 B 结论

- ✅ ComfyUI 与 rembg 安装完成、可启动、可停止、可探活，**均只监听回环**
- ✅ 抠图 / 文生图 / 卡通化三条链路**都在真实硬件上跑通**，有落盘产物与耗时数据
- ✅ 模型许可边界明确：抠图锁 `u2net`，生成锁 SD 1.5；其余权重一律冻结
- ✅ 失败路径（参数非法、模型越权、服务离线、停止失败）都**如实报错**，没有假成功
- ⚠️ 一项待决策：卡通化的保形/风格化取舍（§4.1）
- ➡️ 可以进入阶段 C（私有网络联通）与阶段 D（后端接入）
