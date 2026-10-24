# 阶段 C：私有网络联通（SSH 反向隧道）

- 完成日期：**2026-10-16**
- 目标：让服务器上的后端能调用本机（AI 节点）的 ComfyUI / rembg，**且不把任何推理端口暴露到公网**
- 结论：**已完成并实测通过**。`qq` 与 `home` 都能通过隧道把请求打到本机 AI 服务上，隧道只绑回环

---

## 1. 方案选型（为什么是这个方向）

### 1.1 现实约束

| 约束 | 事实 |
| --- | --- |
| 本机在家庭网络 | 没有公网 IP；需求红线**禁止**路由器端口映射 / Tailscale Funnel / 公网反代 |
| 本机没有 OpenSSH Server | `Get-Service sshd` 不存在；装它需要**管理员权限**，且会新增一个可供入站的 SSH 入口 |
| 本机 **有** OpenSSH 客户端 | `C:\WINDOWS\System32\OpenSSH\ssh.exe`（OpenSSH_for_Windows_9.5p2） |
| 本机 → qq / home 免密登录**已可用** | `ssh -o BatchMode=yes qq 'echo …'` 直接成功（本机 `id_ed25519` 已在双方 `authorized_keys` 里） |
| qq sshd 配置 | `AllowTcpForwarding yes`、**`GatewayPorts no`**、`PermitOpen any` |

### 1.2 选定方案：本机主动连出去，用 `-R` 反向映射

```
   本机 SY-NB（AI 节点，家庭网络）                   目标机（qq 或 home）
   ──────────────────────────────                   ─────────────────────
   ComfyUI 127.0.0.1:8188  ──┐
   rembg   127.0.0.1:7000  ──┴── ssh -N -R 8188:127.0.0.1:8188
                                  ssh -N -R 7000:127.0.0.1:7000   ──▶  127.0.0.1:8188
                                                                       127.0.0.1:7000
                                                                       （只绑回环！）
```

**为什么这样最安全**：qq 的 sshd 是 `GatewayPorts no`，所以 `-R` 建立的监听**只能绑 127.0.0.1**，
连 qq 自己的 nginx 都碰不到这两个端口，更不可能被外网访问。这一条已被脚本自动校验（见 §4）。

**为什么不用反过来**：
- 反向（服务器连本机）需要在 Windows 上装 OpenSSH Server 并开放入站端口，既需要管理员权限，
  又在「不新增公网/局域网入站面」这条红线上多加了一个入口；
- 本机→服务器的出站 SSH 复用**现有**的免密登录，零新增攻击面。

---

## 2. 实测证据（2026-10-16）

### 2.1 qq 侧（生产服务器）

```
=== qq 侧隧道端口 ===
LISTEN 0 128 127.0.0.1:7000  (sshd)
LISTEN 0 128 127.0.0.1:8188  (sshd)
LISTEN 0 128 [::1]:8188      (sshd)
LISTEN 0 128 [::1]:7000      (sshd)

=== 从 qq 访问本机 ComfyUI ===
GET http://127.0.0.1:8188/system_stats → HTTP 200，0.070s
  {"system":{"os":"win32","ram_total":137340612608,"comfyui_version":"0.16.4",...}}

=== 从 qq 访问本机 rembg ===
GET http://127.0.0.1:7000/api → HTTP 200，0.172s

=== 红线确认：只有回环地址 ===
ss -lnt 只出现 127.0.0.1:7000 / 127.0.0.1:8188 / [::1]…
```

### 2.2 通过隧道做真实推理（不只是探活）

从 qq 发起、经隧道落到本机 rembg（`model=u2net`）：

| 次数 | HTTP | 产物 | 耗时（含上传 + 推理 + 回传） |
| --- | --- | --- | --- |
| 1 | 200 | PNG 512×512 RGBA，277,107 bytes | **0.46s** |
| 2 | 200 | 同上 | **0.38s** |
| 3 | 200 | 同上 | **0.39s** |

`file` 校验：`PNG image data, 512 x 512, 8-bit/color RGBA, non-interlaced` —— 确实是带透明通道的结果。

> 结论：隧道往返开销很小（探活 70–170ms，整次抠图 0.4s 级），**性能上完全可接受**。

### 2.3 home 侧（开发机，用于阶段 D 联调）

同样方式对 `home` 建隧道，`home` 上出现 `127.0.0.1:8188`、`127.0.0.1:7000`（仅回环）。
→ 阶段 D 在 home 上跑 `douwan-api` 时，可以直接连 `127.0.0.1:8188` / `127.0.0.1:7000`，**无需任何代码分支**。

---

## 3. 脚本用法

```powershell
$S = "C:\Users\sharyuke\Documents\work\douwan\repos\douwan-ai-node\scripts\local-ai"
$P = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File"

# 建隧道（默认目标 qq）
& $P "$S\start-tunnel.ps1"
& $P "$S\start-tunnel.ps1" -Target home      # 换目标机（阶段 D 联调用）

# 四层体检（最常用）
& $P "$S\tunnel-status.ps1"
& $P "$S\tunnel-status.ps1" -Json            # 机器可读

# 关隧道（会复核目标机侧端口已释放）
& $P "$S\stop-tunnel.ps1" -DryRun
& $P "$S\stop-tunnel.ps1"

# 守护（断了自动重连）；加 -InstallTask 注册登录自启（需管理员）
& $P "$S\watch-tunnel.ps1"
& $P "$S\watch-tunnel.ps1" -InstallTask
```

`tunnel-status.ps1` 的退出码约定：**0 = 四层全通**，**1 = 有断点**，可直接用于监控告警。

---

## 4. 已实测的完整生命周期

| 用例 | 结果 |
| --- | --- |
| `start-tunnel.ps1` 首次建立 | ✅ 退出码 0，目标机侧 `8188=200 7000=200` |
| 重复 `start-tunnel.ps1`（幂等） | ✅ 识别已在运行，不再重复建连 |
| `tunnel-status.ps1` 在线 | ✅ 退出码 0，四层全绿 |
| `tunnel-status.ps1` 离线 | ✅ 退出码 1，明确提示「跑 start-tunnel.ps1」 |
| `stop-tunnel.ps1` | ✅ 退出码 0，并复核「qq 侧已无隧道端口（干净）」 |
| 停后重建 | ✅ 退出码 0，恢复 `8188=200 7000=200` |

---

## 5. 安全红线核对

| 红线 | 状态 |
| --- | --- |
| 不把 ComfyUI / rembg 端口暴露公网 | ✅ 隧道端口仅 `127.0.0.1` / `[::1]`，由 `tunnel-status.ps1` 每次自动校验 |
| 不做路由器端口映射 | ✅ 未做 |
| 不用 Tailscale Funnel | ✅ 未用 |
| 不挂公网反向代理 | ✅ 未挂；nginx 配置**未改动** |
| 不在前端 / 日志暴露密钥 | ✅ 隧道复用已有 SSH 公钥，脚本内无凭据 |
| 生产（qq）不做未经批准的变更 | ✅ 只建立了 SSH 隧道（瞬时连接），**未改任何配置文件、未重启任何服务** |

> 隧道是**出站连接**，SSH 断开后 qq 上的监听端口立即消失，不留残余。

---

## 6. 运维注意

1. **隧道不负责启动 AI 服务**：服务没起时隧道能连上但探活是 `000`。
   正确顺序：`start-comfyui.ps1` + `start-rembg.ps1` → `start-tunnel.ps1` → `tunnel-status.ps1`。
2. **断线重连**：`ssh` 已带 `ServerAliveInterval=30` 心跳；长期运行请用 `watch-tunnel.ps1`
   或 `watch-tunnel.ps1 -InstallTask`（登录自启）。安装计划任务需要管理员权限，
   没有权限时可以手动把脚本快捷方式放进 `shell:startup`。
3. **不要用 `-g`**：`ssh -g` 会让 `-R` 尝试绑 `0.0.0.0`，虽然 qq 的 `GatewayPorts no` 会挡住，
   但这是明确的红线姿势，脚本里没有也不应有这个参数。
4. **密码登录被禁**：脚本一律用 `-o BatchMode=yes`，密钥不通就**直接失败**而不是挂住等输入，
   便于在无人值守场景暴露问题。

---

## 7. 踩坑记录：从 PowerShell 调 ssh 传脚本

这一节是本次踩得最久的地方，记录下来避免以后重复浪费。**四种传法只有一种可靠**：

| 传法 | 结果 |
| --- | --- |
| `ssh host "grep -E '(a\|b)' f"` | ❌ 引号被吞 → 远端 `syntax error near unexpected token '('` |
| `ssh host "grep -E :8188\|7000"` | ❌ `\|` 被当管道 → 远端 `7000: command not found` |
| 多行脚本作为单个参数 | ❌ 换行被替换成空格 → `curl: (2) no URL specified` |
| 多行脚本经 stdin 喂 `bash -s` | ❌ Windows PowerShell 把行尾规范化成 CRLF → 远端 `$'\r': command not found` |
| **`echo <base64> > f; base64 -d f > g; bash g`** | ✅ **引号、括号、管道、`if/fi` 全部原样到达** |

落地形式就是 `config.ps1` 里的 `Invoke-RemoteScript`：调用方正常写脚本，函数内部走 base64。
`Get-RemoteTunnelPorts` 基于它实现，并在 PowerShell 侧解析 `ss -lnt` 输出。

---

## 8. 阶段 C 结论

- ✅ 方案确定并落地：**本机 → 目标机的 `-R` 反向 SSH 隧道**，不需要管理员权限、不需要装 sshd
- ✅ qq 与 home 两个方向都实测通过；qq 上真实跑通一次完整抠图（0.38–0.46s）
- ✅ 端口只绑回环，红线由脚本每次自动校验
- ✅ 启停、幂等、断线守护、状态体检脚本齐全，退出码可用于监控
- ⚠️ 生产默认仍是 `LOCAL_AI_ENABLED=false`：隧道通了 ≠ 上线，开关由阶段 D 引入、由用户决定何时打开
- ➡️ 可以进入阶段 D（`douwan-api` 接入：队列 / 任务状态 / 存储 / 配置）
