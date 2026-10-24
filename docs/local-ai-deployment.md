# 豆玩本地 AI 节点部署文档（阶段 B 交付物）

- 适用主机：`SY-NB`（Windows，本机控制端 = RTX 2060 6GB 的 AI 节点）
- 撰写日期：**2026-10-15**
- 对应阶段：需求文档阶段 B（本地 AI 节点安装与实测）
- 状态：**ComfyUI 与 rembg 均已装好、已实测通过、均只监听 `127.0.0.1`**；线上（qq）**未做任何改动**

> 本机既是控制端也是 AI 节点，因此本文所有命令都直接在 Windows 上执行。
> 开发/构建在 `home`，线上在 `qq`，**本地 AI 节点不在公网暴露**。

---

## 1. 一句话架构

```
浏览器 ──HTTPS──▶ qq: nginx ──▶ douwan-api (Go)
                                   │  LOCAL_AI_ENABLED=false（默认，线上现状）
                                   │
                                   └─[SSH 隧道，阶段 C]─▶ SY-NB 127.0.0.1
                                                             ├─ ComfyUI  127.0.0.1:8188  （文生图 / 卡通化）
                                                             └─ rembg    127.0.0.1:7000  （抠图，CPU）
```

- **两个服务都绑定回环地址**，物理上无法从公网直连；跨机访问只走 SSH 隧道。
- 需求文档红线：**不做路由器端口映射、不用 Tailscale Funnel、不挂公网反代**。

---

## 2. 目录与端口（实测值）

| 项目 | 路径 / 值 | 依据 |
| --- | --- | --- |
| AI 运行根目录 | `C:\Users\sharyuke\DouWanAI` | 用户阶段 A 决策 |
| rembg 虚拟环境 | `C:\Users\sharyuke\DouWanAI\rembg\.venv` | 实测 |
| rembg 入口 | `...\.venv\Scripts\rembg.exe` | **必须用这个**，见 §5.2 |
| u2net 权重 | `C:\Users\sharyuke\DouWanAI\models\u2net\u2net.onnx`（175,997,641 字节） | 实测 |
| 日志 | `C:\Users\sharyuke\DouWanAI\logs\{comfyui,rembg}.{log,err.log}` | 实测 |
| PID 文件 | `C:\Users\sharyuke\DouWanAI\run\{comfyui,rembg}.pid` | 实测 |
| ComfyUI 安装 | `C:\Users\sharyuke\Documents\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable`（v0.16.4） | 实测 |
| ComfyUI 端口 | `127.0.0.1:8188` | 实测 |
| rembg 端口 | `127.0.0.1:7000` | 实测 |
| 脚本仓库 | `repos\douwan-ai-node\scripts\local-ai\` | 本次交付 |
| 工作流模板 | `repos\douwan-ai-node\workflows\local-ai\` | 本次交付 |

### 2.1 GPU 与软件版本（实测）

| 项目 | 值 |
| --- | --- |
| GPU | NVIDIA GeForce RTX 2060，**6144MB** 显存（`vram_total` 实测 6442123264 字节） |
| 驱动 / CUDA | `nvidia-smi` 正常，torch `2.10.0+cu130`，CUDA 可用 |
| ComfyUI portable | v0.16.4，`python_embeded` 3.13.11 |
| rembg | 2.0.85（onnxruntime CPU） |
| 磁盘 | 只有 C:（1861.8GB，余 1424.8GB） |

---

## 3. 脚本清单与用法

全部位于 `repos\douwan-ai-node\scripts\local-ai\`。**PowerShell 脚本一律用 `-File` 方式调用**
（本机 `danger-full-access` 下 shell 是 Restricted 执行策略，`& script.ps1` 会失败）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <脚本路径> [参数]
```

| 脚本 | 作用 | 退出码 |
| --- | --- | --- |
| `config.ps1` | 被其他脚本 dot-source 的中央配置（路径、端口、白名单、彩色输出函数） | — |
| `check-environment.ps1` | 8 项环境体检：系统 / GPU / 磁盘 / 目录 / ComfyUI 依赖 / rembg 依赖 / 端口占用 / **公网监听红线扫描** | 0 通过 / 1 有失败项 / 2 参数错误 |
| `start-comfyui.ps1` | 幂等启动 ComfyUI（端口被占则拒绝启动，不抢占） | 0 成功 |
| `start-rembg.ps1` | 幂等启动 rembg（缺权重会警告并给出安装指引） | 0 成功 |
| `stop-local-ai.ps1` | **凭证据**停止（命令行匹配 + 自己的 PID 文件），支持 `-Only all|comfyui|rembg`、`-DryRun` | 0 成功 |
| `health-check.ps1` | 两个服务 + GPU + 磁盘一次探活，`-Json` 输出机器可读结果 | 0 两个服务都健康 / 1 否则 |
| `check-syntax.ps1` | 校验本目录所有 `.ps1` 语法与 BOM（见 §7 坑） | 0 全部通过 / 1 有失败 |
| `fix-bom.ps1` | **维护脚本**：修复被写入工具破坏的 UTF-8 BOM 与注释块开头（幂等） | 0 |
| `start-tunnel.ps1` | 建立反向 SSH 隧道（本机 AI 端口 → 目标机回环），幂等 | 0 成功 |
| `stop-tunnel.ps1` | 关闭隧道（凭命令行 + PID 文件证据），并复核目标机侧端口已释放 | 0 成功 / 1 未完全关闭 |
| `tunnel-status.ps1` | 四层链路体检：本机服务 / 隧道进程 / 目标机绑定地址（**回环红线**）/ 端到端探活 | 0 全通 / 1 有断点 |
| `watch-tunnel.ps1` | 隧道守护：断了自动重连；`-InstallTask` 可注册登录自启 | — |
| `comfy-run-workflow.cjs` | **通用工作流驱动**：按工作流自带的 `__douwan.params` 参数表打补丁、上传图片、提交、轮询、落盘、写 run json | 0 成功 / 1 运行失败 / 2 参数错误 |
| `rembg-remove.cjs` | 抠图调用（**强制** `model=u2net` + 白名单校验，越权模型直接拒绝） | 0 成功 / 1 失败 / 2 参数错误 |

### 3.1 常用命令

```powershell
$S = "C:\Users\sharyuke\Documents\work\douwan\repos\douwan-ai-node\scripts\local-ai"
$N = "C:\Users\sharyuke\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

# 体检
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\check-environment.ps1"

# 启动（幂等）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\start-comfyui.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\start-rembg.ps1"

# 健康检查（-Json 给后端/监控用）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\health-check.ps1" -Json

# 文生图
& $N "$S\comfy-run-workflow.cjs" "C:\Users\sharyuke\Documents\work\douwan\repos\douwan-ai-node\workflows\local-ai\txt2img-api.json" out `
    --positive "a cute panda, flat illustration" --width 512 --height 512

# 卡通化（--input 会自动上传到 ComfyUI 的 douwan/ 子目录）
& $N "$S\comfy-run-workflow.cjs" "...\workflows\local-ai\cartoonize-api.json" out `
    --input "photo.jpg" --denoise 0.6

# 停止
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\stop-local-ai.ps1" -DryRun   # 先看要杀谁
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\stop-local-ai.ps1"
```

---

## 4. 首次安装步骤（从零复现）

### 4.1 rembg（抠图）

```powershell
# 1) 建目录与虚拟环境
$ai = "C:\Users\sharyuke\DouWanAI"
New-Item -ItemType Directory -Force "$ai\rembg","$ai\models","$ai\logs","$ai\run","$ai\tmp" | Out-Null
python -m venv "$ai\rembg\.venv"

# 2) 装 rembg（CPU 版 onnxruntime 即可，抠图很快）
& "$ai\rembg\.venv\Scripts\python.exe" -m pip install -U pip
& "$ai\rembg\.venv\Scripts\python.exe" -m pip install "rembg[cpu]==2.0.85"

# 3) 预下 u2net 权重（约 176MB，Apache-2.0 / MIT 系）
$env:U2NET_HOME = $ai          # rembg 会在其下自动拼 models\u2net\
& "$ai\rembg\.venv\Scripts\python.exe" -c "from rembg import new_session; new_session('u2net')"
# 期望落盘：C:\Users\sharyuke\DouWanAI\models\u2net\u2net.onnx
```

> ⚠️ `U2NET_HOME` 的语义是「**上**一级目录」，rembg 会自己再拼 `models\<模型名>\`。
> 如果设成 `...\DouWanAI\models`，权重会落到 `...\models\models\u2net\`（本机踩过，已修正）。

### 4.2 ComfyUI（文生图 / 卡通化）

本机使用的是已有的 ComfyUI portable（v0.16.4）+ 已有的 SD 1.5 权重，**没有新增大体积下载**。
若要在一台干净机器上复现：

```powershell
# 1) 下载 ComfyUI portable（NVIDIA 版）解压到任意目录
# 2) 权重放进 ComfyUI\models\checkpoints\ ，只允许白名单内的文件（见 config.ps1 $Cfg.AllowedCheckpoints）
# 3) 启动（脚本已固定参数，见下）
```

启动参数（写死在 `config.ps1` 的 `$Cfg.ComfyArgs`，不要手改成 `--listen`）：

```
--port 8188 --lowvram --disable-auto-launch --preview-method none
```

- `--lowvram`：6GB 显存必须，实测常驻约 2.3GB；
- `--disable-auto-launch`：禁止自动开浏览器（服务器上无意义且拖慢启动）；
- `--preview-method none`：省显存与带宽；
- **绝不加 `--listen 0.0.0.0`**（加了就公网可达，违反红线）。

---

## 5. 接口契约（与后端对接的唯一依据）

### 5.1 ComfyUI 官方 HTTP API（实测确认）

| 用途 | 请求 | 说明 |
| --- | --- | --- |
| 探活 | `GET /system_stats` | 返回 `devices[0].vram_total/vram_free` |
| 传图 | `POST /upload/image` | multipart：`image`（文件）、`type=input`、`subfolder`（可选，本驱动用 `douwan`）、`overwrite=true`；返回 `{name, subfolder, type}` |
| 提交 | `POST /prompt` | JSON `{prompt: <API格式工作流>, client_id}`；返回 `{prompt_id}` |
| 轮询 | `GET /history/{prompt_id}` | 有结果即出现；`status.status_str == "success"` 为成功 |
| 取图 | `GET /view?filename=&subfolder=&type=output` | 返回图片二进制 |
| 释放 | `POST /free` | 可选，释放显存 |

> **`LoadImage.image` 需要 `subfolder/name` 形式**（例如 `douwan/photo.jpg`），只传文件名会找不到图。

### 5.2 rembg HTTP API（rembg 2.0.85，读源码 + 实测）

| 项目 | 值 |
| --- | --- |
| 抠图路由 | `POST /api/remove`（**只有这一个**，见 `/openapi.json`） |
| 文件字段名 | **`file`**（服务端类型是 `File`，不是 `UploadFile`） |
| 另一路由 | `GET /api/remove?url=<图片URL>` |
| 关键查询参数 | `model`（**默认 `bria-rmbg`，商业授权 → 必须显式覆盖**）、`a`/`af`/`ab`/`ae`（alpha matting）、`om`（只出 mask）、`ppm`（后处理）、`bgc`（背景色）、`extras`（附加输出） |
| 响应 | `image/png`（RGBA，colorType=6；若 `om=true` 则为单通道） |
| 文档 | `http://127.0.0.1:7000/api`（`docs_url="/api"`） |

**启动参数（写死在 `config.ps1` 的 `$Cfg.RembgArgs`）**：

```
s -h 127.0.0.1 -p 7000 --no-ui
```

- **`-h 127.0.0.1` 不能省**：rembg 的 `-h/--host` 默认是 `0.0.0.0`（源码 `s_command.py`），省了就公网可达；
- `--no-ui` 必加：否则启动时会调 `webbrowser.open` 尝试开浏览器；
- **`python -m rembg` 不可用**（2.0.85 没有 `__main__`），必须走 `rembg.exe` 入口；
- `rembg.exe` 会再 fork 一个 `python.exe` 子进程干活，**真正监听端口的是子进程** → 停止脚本按命令行匹配 venv 路径，不能只按进程名。

---

## 6. 实测结果（2026-10-15，RTX 2060 6GB）

### 6.1 抠图（CPU，`u2net`）

| 输入 | 尺寸 | 耗时 | 结果 |
| --- | --- | --- | --- |
| 合成人像 | 640×800 | **0.6s** | RGBA，透明占比 79.89%，四角 alpha=0 |
| 熊猫照片 | 512×512 | **0.2s** | RGBA，透明占比 49.41%，四角 alpha≈0 |
| 阴性对照 | 非法 model | — | **HTTP 422** `string_pattern_mismatch`（证明 `model` 确实传上去了） |

### 6.2 文生图（SD 1.5，`--lowvram`）

| 尺寸 | 耗时 | 备注 |
| --- | --- | --- |
| 512×512 | **6.0s** | 稳态 |
| 640×640 | **8.1s** | 传 644 会被驱动自动取整为 640（8 的倍数） |

### 6.3 卡通化（img2img，SD 1.5）— **重要负面结论**

对同一张熊猫照片做 denoise 扫描（steps 26 / cfg 8.0 / seed 固定）：

| denoise | 耗时 | 观感 |
| --- | --- | --- |
| 0.55 | 6.0s | 几乎没变化，**看不太出卡通化** |
| 0.65 | 6.0s | 轻微风格化，仍接近照片 |
| 0.75 | 7.1s | **主体被改掉**（熊猫变成动漫白发角色），身份丢失 |
| 0.85 | 6.0s | 主体继续被改写 |
| 0.95 | 6.0s | 与原图无关，完全重绘 |

**结论（必须写进产品决策）**：在**只有 SD 1.5 官方权重**的前提下，
「保持主体可辨识」与「明显卡通化」**不可兼得**：

- denoise ≤ 0.65 → 保形但风格化不足（对拼豆/像素画场景**仍可能够用**，因为下游还要量化成色块）；
- denoise ≥ 0.75 → 风格像动漫了，但**主体已经不是原来那张图**，不适合「把用户照片变卡通」这种承诺。

可选出路（都需另行评估，**本轮未做**）：
1. 走 SD 1.5 + 卡通化 **LoRA**（现有 LoRA 全部许可不明，**须先解决许可**）；
2. 前端「先抠图 → 用透明 PNG 做 img2img」，减少背景干扰；
3. 前端 `lib/cartoon.js` 的**确定性滤镜卡通化**（无需模型、无需许可、零 GPU）作为**默认**，
   模型卡通化作为「可选更艺术化」的第二次生成（并用「可能改变主体」明确告知用户）；
4. 提高 denoise 但配 `ControlNet` 保边（本机**无可用 ControlNet 权重**，且 6GB 显存更紧张）。

### 6.4 显存

| 场景 | 数值 |
| --- | --- |
| ComfyUI 完全退出（只剩桌面程序） | 已用 **2194MiB**，空闲 3950MiB |
| ComfyUI `--lowvram` 刚启动、未加载模型 | 空闲 **5113MiB** |
| 跑完一张后的常驻状态 | 空闲约 **2822–2886MiB**（`--lowvram` 常驻约 2.2–2.3GB） |
| 桌面程序占用高时 | 曾出现已用 5403MB / 6144MB → **高分辨率会 OOM** |

→ 结论：**上限锁 512×512（文生图可到 640）**，且需要关掉吃显存的程序
（`check-environment.ps1` 在空闲显存 < 2500MiB 时会主动警告）。

### 6.5 端到端回归（停 → 起 → 复测）

完整跑过一遍服务停止与重启循环并复测：

```
health-check 在线(exit 0, PID 9524/15532)
  → stop-local-ai.ps1（exit 0）
  → netstat 确认 8188/7000 无监听
  → health-check 离线(exit 1，并提示启动命令)
  → start-rembg.ps1 / start-comfyui.ps1（exit 0）
  → health-check 在线(exit 0, PID 34588/32604)
  → 抠图 0.6s + 文生图 7.2s 全部成功
```

过程中修掉一个**假成功** bug：`Stop-Process` 在受限环境下会失败，旧脚本却仍打印「已停止」
并返回 0。现在改为 `Stop-Process -Force` → 失败退回 `taskkill /PID /T /F`
→ **以「端口是否真的释放」为最终判据** → 失败时明确报错并退出码 1。

---

## 7. 踩坑记录（后续维护必读）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Access is denied` / `禁止运行脚本`（`& script.ps1`） | `danger-full-access` 沙箱下 shell 是 Restricted 执行策略 | 一律 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <路径>` |
| PS 5.1 打开 `.ps1` 报「字符串缺少终止符」 | 文件没有 UTF-8 BOM，PS 5.1 按 GBK 解码 | 所有 `.ps1` 必须带 `EF BB BF`；用 `check-syntax.ps1` 校验 |
| `Unexpected attribute 'CmdletBinding'` | 编辑工具写入时把 BOM+`<#` 弄坏成 BOM+`#` | 修复：交换第 4、5 字节为 `<` `#`，再跑 `check-syntax.ps1` |
| `python -m rembg` → `No module named rembg.__main__` | 2.0.85 没有 `__main__` | 用 `...\.venv\Scripts\rembg.exe` |
| 停止脚本杀不掉 rembg | `rembg.exe` 只是壳，真正的进程是 `python.exe` 子进程 | `Get-RembgProcess` 按命令行匹配 venv 路径，不匹配进程名 |
| 权重跑到 `models\models\u2net\` | `U2NET_HOME` 语义是上一级目录 | 设 `U2NET_HOME=C:\Users\sharyuke\DouWanAI` |
| `ComfyUI` 保存图片 `PermissionError` | 沙箱只允许写工作区 | 启动服务时需要 `danger-full-access`（一次性授权） |
| `Invoke-WebRequest`/`curl.exe` HTTPS 全失败 | 本机 schannel/DNS 环境问题，**不是断网** | 用 node 的 `fetch`（实测 pypi/github/HF 均 200） |
| `Get-Content -Raw \| ConvertFrom-Json` 报「传入的对象无效」 | PS 5.1 按 ANSI 读无 BOM 的 UTF-8 JSON | 用 `comfy-run-workflow.cjs` 直接读文件，别用 PS 解析工作流 |
| `& <python.exe> -c "..."` 长时间无输出/挂起 | 受限环境下启动 python 子进程会被卡住（实测 >300s 无输出） | 脚本里**不要**用 python 子进程做探测；改成读 `site-packages` 的 `*.dist-info` 目录名 + 问运行中的服务 |
| `Stop-Process` 报 `Cannot find a process with the process identifier`，但端口还在监听 | 受限环境不允许枚举/结束别的进程 | 用管理员身份运行；脚本已加入 `taskkill` 兜底与「端口是否释放」校验，失败会退出码 1 |
| `nvidia-smi ... \| Select-Object -First 1` 后 `$LASTEXITCODE` 变成 -1 | `Select-Object -First 1` 提前终止原生命令管道 | 先 `@(...)` 收完输出再取第一行 |
| `-Json` 传给 `powershell.exe -File` 报「无法将 String 转为 SwitchParameter」 | `-File` 传参只支持字符串位置参数 | 用 `pwsh` 调用，或在 PS 7 里 dot-source 后直接调用函数 |

---

## 8. 回滚步骤

本地 AI 节点是**完全可回滚**的：线上默认 `LOCAL_AI_ENABLED=false`，关掉即回到「什么都没有」的状态。

### 8.1 只关服务（保留安装，最常用）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\stop-local-ai.ps1" -DryRun   # 先确认目标
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\stop-local-ai.ps1"
```

### 8.2 回滚后端开关（阶段 D 之后才有意义）

```bash
# qq 上把开关关掉并重启（LOCAL_AI_ENABLED 默认就是 false）
ssh qq 'sed -i "s/^LOCAL_AI_ENABLED=.*/LOCAL_AI_ENABLED=false/" /etc/douwan/api.env 2>/dev/null; systemctl restart douwan-api; systemctl is-active douwan-api'
```

### 8.3 彻底卸载（释放磁盘）

```powershell
# 1) 先停服务
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$S\stop-local-ai.ps1"
# 2) 删 AI 运行目录（rembg venv + u2net 权重 + 日志，约 1.2GB）
#    执行前务必确认路径就是下面这个绝对路径
Remove-Item -Recurse -Force "C:\Users\sharyuke\DouWanAI"
```

- **ComfyUI 目录本身是从前的既有安装，本阶段没有改动它的文件布局**，如需还原请单独确认后再动；
- 本阶段**没有**在 qq 上做任何改动，**无需回滚线上**。

---

## 9. 待办（交给阶段 C/D/E）

1. **阶段 C**：SSH 隧道打通（方向待用户确认，见阶段 A 报告 §12）；
2. **阶段 D**：`douwan-api` 接入（队列 / 任务状态 / 存储 / 配置开关）；
3. **阶段 E**：前端接入与回归；
4. 卡通化质量决策（§6.3）需要产品侧拍板；
5. `u2netp` / `silueta` 若要启用，先按 `docs/local-ai-models.md` §7.3 登记。

---

*本文件随阶段 B 交付。所有数值均为 2026-10-15 在本机实测所得，可复现命令见对应脚本。*
