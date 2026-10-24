<#
  config.ps1 —— 豆玩本地 AI 节点统一配置（所有 local-ai 脚本都从这里读路径与参数）

  用法：其他脚本用
      . "$PSScriptRoot\config.ps1"
  导入。导入后可直接使用 $Cfg 里的字段，以及 Get-DouWanConfig 返回的同一份配置。

  修改路径只改这一个文件。切勿把本文件里的值写进前端或提交密钥。
#>

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-DouWanConfig {
  # 允许用环境变量覆盖（便于迁移到别的机器/盘符），默认值对应当前这台机器
  $aiRoot = if ($env:DOUWAN_AI_ROOT) { $env:DOUWAN_AI_ROOT } else { 'C:\Users\sharyuke\DouWanAI' }
  $comfyRoot = if ($env:DOUWAN_COMFYUI_HOME) { $env:DOUWAN_COMFYUI_HOME } else { 'C:\Users\sharyuke\Documents\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable' }

  [pscustomobject]@{
    # ---- 本地 AI 节点根目录 ----
    AiRoot        = $aiRoot
    LogDir        = Join-Path $aiRoot 'logs'
    RunDir        = Join-Path $aiRoot 'run'
    TmpDir        = Join-Path $aiRoot 'tmp'
    ModelDir      = Join-Path $aiRoot 'models'      # rembg 权重目录（U2NET_HOME 指向 U2NetHome，权重落在 <U2NetHome>\models\<模型名>\<模型>.onnx）
    U2NetHome     = $aiRoot                          # 实测 rembg 2.0.85 / pooch 的实际布局，详见 docs/local-ai-deployment.md
    # 权重真实落盘路径（实测 175,997,641 字节）。注意是 models\u2net\u2net.onnx，
    # 因为 U2NET_HOME 是「上一级」目录，rembg 会自己拼 models\<模型名>\。
    U2NetWeight   = Join-Path $aiRoot 'models\u2net\u2net.onnx'

    # ---- ComfyUI ----
    ComfyRoot     = $comfyRoot
    ComfyPython   = Join-Path $comfyRoot 'python_embeded\python.exe'
    ComfyMain     = Join-Path $comfyRoot 'ComfyUI\main.py'
    ComfyHost     = '127.0.0.1'
    ComfyPort     = 8188
    # 6GB 显存（RTX 2060）必须 lowvram；不要把监听地址改成 0.0.0.0
    ComfyArgs     = @('--port', '8188', '--lowvram', '--disable-auto-launch', '--preview-method', 'none')
    ComfyLog      = Join-Path $aiRoot 'logs\comfyui.log'
    ComfyErrLog   = Join-Path $aiRoot 'logs\comfyui.err.log'
    ComfyPidFile  = Join-Path $aiRoot 'run\comfyui.pid'

    # ---- rembg ----
    RembgVenv     = Join-Path $aiRoot 'rembg\.venv'
    RembgPython   = Join-Path $aiRoot 'rembg\.venv\Scripts\python.exe'
    RembgExe      = Join-Path $aiRoot 'rembg\.venv\Scripts\rembg.exe'
    RembgHost     = '127.0.0.1'
    RembgPort     = 7000
    # 参数取自本机 `rembg s --help`（rembg 2.0.85）：
    #   -h/--host 默认是 0.0.0.0 —— 必须显式绑回环，否则会把模型服务暴露到局域网（需求 §2.2 禁止）
    #   --no-ui 关掉 Gradio 界面，降低空转 CPU
    RembgArgs     = @('s', '-h', '127.0.0.1', '-p', '7000', '--no-ui')
    RembgLog      = Join-Path $aiRoot 'logs\rembg.log'
    RembgErrLog   = Join-Path $aiRoot 'logs\rembg.err.log'
    RembgPidFile  = Join-Path $aiRoot 'run\rembg.pid'

    # ---- 阶段 C：反向 SSH 隧道（本机 AI 节点 → 目标机的回环）----
    # 方向说明见 start-tunnel.ps1 头部注释：由本机主动连出去，用 -R 反向映射，
    # qq 的 sshd 是 GatewayPorts no，所以只会绑 127.0.0.1（外网与 nginx 都访问不到）。
    TunnelTarget  = if ($env:DOUWAN_TUNNEL_TARGET) { $env:DOUWAN_TUNNEL_TARGET } else { 'qq' }
    TunnelPorts   = @(8188, 7000)
    TunnelLog     = Join-Path $aiRoot 'logs\tunnel.log'
    TunnelErrLog  = Join-Path $aiRoot 'logs\tunnel.err.log'
    TunnelPidFile = Join-Path $aiRoot 'run\tunnel.pid'

    # ---- 模型许可白名单（第一轮；未确认许可的模型不得用于付费流程）----
    # 详见 docs/local-ai-models.md
    AllowedCheckpoints = @(
      'v1-5-pruned-emaonly.ckpt'
    )
  }
}

$script:Cfg = Get-DouWanConfig

function Write-Step   { param([string]$Message) Write-Host "[*] $Message" -ForegroundColor Cyan }
function Write-Ok     { param([string]$Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn2  { param([string]$Message) Write-Host "[!] $Message" -ForegroundColor Yellow }
function Write-Err2   { param([string]$Message) Write-Host "[x] $Message" -ForegroundColor Red }

function Test-HttpOk {
  # 探活一个 HTTP 端点：返回 $true/$false，不抛异常
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSec = 5
  )
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  } catch {
    return $false
  }
}

function Test-PortListening {
  # 端口是否已被本机监听（Windows 上用 netstat，避免依赖 Get-NetTCPConnection 的权限）
  param(
    [Parameter(Mandatory = $true)][int]$Port
  )
  $lines = & netstat -ano -p TCP 2>$null | Select-String -Pattern "LISTENING" | Select-String -Pattern ":$Port\s"
  return [bool]$lines
}

function Get-PythonProcessInfo {
  # 列出所有 python 进程的 进程号/内存/命令行。
  # 优先 CIM（有命令行）；被权限拒绝时退化为 Get-Process（无命令行，只能靠 PID 文件判断）。
  # 注意：这里用 Write-Host 而不是 Write-Warn2 —— Write-Warn2 会写进成功流，
  # 被调用方用 @(...) 收集时会**污染返回值**（数组里混进字符串，导致 .Pid 取空）。
  try {
    $all = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction Stop
    return @($all | ForEach-Object {
      [pscustomobject]@{ Pid = [int]$_.ProcessId; CommandLine = [string]$_.CommandLine; WorkingSet = [int64]$_.WorkingSetSize }
    })
  } catch {
    # 只在第一次失败时提示，避免同一轮脚本里刷屏（每次调用都会走这条退化路径）。
    # 用 Test-Path 判断而不是 `-not $global:X`：Set-StrictMode 下读取未定义变量会直接抛错。
    if (-not (Test-Path variable:global:DouWanCimWarned)) {
      Set-Variable -Name DouWanCimWarned -Scope Global -Value $true
      Write-Host '[!] 无法读取进程命令行（CIM 权限不足），改为仅按 PID 文件与端口判断。' -ForegroundColor Yellow
    }
    return @(Get-Process -Name python -ErrorAction SilentlyContinue | ForEach-Object {
      [pscustomobject]@{ Pid = $_.Id; CommandLine = ''; WorkingSet = [int64]$_.WorkingSet64 }
    })
  }
}

function Get-PortOwnerPid {
  # 谁在监听这个端口（netstat，不需要 CIM 权限）。返回 PID 数组，空数组表示没人监听。
  # 这是最可靠的「服务是否真的在跑」信号：能监听端口就说明进程活着。
  param([Parameter(Mandatory = $true)][int]$Port)
  $pids = @()
  $lines = & netstat -ano -p TCP 2>$null | Select-String -Pattern 'LISTENING' | Select-String -Pattern ":$Port\s"
  foreach ($l in $lines) {
    $parts = ($l.ToString().Trim() -split '\s+')
    $last = $parts[$parts.Length - 1]
    if ($last -match '^\d+$') { $pids += [int]$last }
  }
  return @($pids | Sort-Object -Unique)
}

function Get-PidFromFile {
  # 读自己写的 PID 文件（Start-Process 返回的 PID）。文件不存在或内容非法时返回 $null。
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  try { return [int]((Get-Content -Path $Path -Raw -ErrorAction Stop).Trim()) } catch { return $null }
}

function Invoke-RemoteScript {
  <#
    在远端主机上执行一段脚本，并把输出的每一行作为字符串数组返回。

    这个函数存在的唯一理由是：**从 PowerShell 调 ssh 传脚本非常容易出错**。
    实测踩过的坑（都不是网络问题，全是传参问题）：

      A. `ssh host "grep -E '(a|b)' f"` → 引号被吞 → 远端 `syntax error near unexpected token '('`
      B. `ssh host "grep -E :8188|7000"` → `|` 被当管道 → 远端 `7000: command not found`
      C. 多行脚本经参数传递 → 换行被替换成空格 → `curl: (2) no URL specified`
      D. 把多行脚本用 stdin 喂 `bash -s` → PowerShell 把行尾规范化成 CRLF
         → 远端 `$'\r': command not found`；即使逐行发送，实测远端 `cat -A` 仍显示 `^M$`

    唯一验证通过的传输方式（四种都实测过）：
        echo <base64> > /tmp/x.b64; base64 -d /tmp/x.b64 > /tmp/x.sh; bash /tmp/x.sh
     要点：① 用 `echo` 而不是 `echo "..."`（不加引号，避免被吞）；
           ② base64 字符集只有 A–Z a–z 0–9 + / =，不含 `|` `(` `'` `"` 与空格，
              所以整条命令在原样传输时不会触发任何 shell 解析问题；
           ③ 远端命令**不含管道以外的结构**，且管道右边全是简单命令。
     实测确认：引号、括号、分支（if/fi）、管道都能原样到达远端。

    调用方可以放心使用引号和管道，不需要再自己绕。
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Script,
    [int]$TimeoutSec = 15
  )
  $normalized = ($Script -replace "`r`n", "`n") -replace "`r", "`n"
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($normalized))
  # 每台目标机用不同的临时文件名，避免并发互相覆盖
  $safeTarget = ($Target -replace '[^A-Za-z0-9_.-]', '_')
  $remote = "echo $b64 > /tmp/douwan-$safeTarget.b64; base64 -d /tmp/douwan-$safeTarget.b64 > /tmp/douwan-$safeTarget.sh; bash /tmp/douwan-$safeTarget.sh"
  $out = & ssh -o BatchMode=yes -o ConnectTimeout=$TimeoutSec $Target $remote 2>&1
  return @($out)
}

function Get-RemoteTunnelPorts {
  <#
    在目标机上列出隧道端口（$Ports）的监听地址，返回形如
        @{ Bound = @('127.0.0.1:8188', '127.0.0.1:7000'); LoopbackOnly = $true; Raw = <所有 LISTEN 行> }
    刻意不用管道/引号/正则，直接在 PowerShell 里解析 `ss -lnt` 的输出，绕开 ssh 引号坑。
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][int[]]$Ports
  )
  $raw = @(Invoke-RemoteScript -Target $Target -Script "ss -lnt`n" -TimeoutSec 10)
  $bound = @()
  $listenLines = @()
  foreach ($line in $raw) {
    $s = [string]$line
    if ($s -match 'LISTEN') {
      $listenLines += $s.Trim()
      # ss -lnt 列：State Recv-Q Send-Q Local-Address Peer-Address
      $parts = ($s.Trim() -split '\s+')
      if ($parts.Count -ge 4) {
        $local = $parts[3]
        $p = ($local -split ':')[-1]
        if ($Ports -contains [int]$p) { $bound += $local }
      }
    }
  }
  $bad = @($bound | Where-Object { $_ -notmatch '^127\.0\.0\.1:' -and $_ -notmatch '^\[::1\]:' })
  return [pscustomobject]@{
    Bound        = @($bound)
    LoopbackOnly = ($bound.Count -gt 0 -and $bad.Count -eq 0)
    Violations   = @($bad)
    Raw          = @($listenLines)
  }
}

function Test-ProcessAlive {
  # 进程是否还活着。
  # 注意：DSH 沙箱会**拒绝对进程表的访问**（Get-Process 返回空、CIM 拒绝访问），
  # 此时「查不到」不代表「不存在」。所以我们用两个权威信号兜底：
  #   ① 进程表查得到 → 活着；
  #   ② 该 PID 仍占着某个监听端口 → 活着（netstat 不需要特殊权限）。
  # 避免沙箱里把「查不到」误判成「已退出」，从而跳过该杀的目标。
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [int[]]$Ports = @()
  )
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { return $true }
  foreach ($p in $Ports) {
    if (@(Get-PortOwnerPid -Port $p) -contains $ProcessId) { return $true }
  }
  return $false
}

function Get-ComfyProcess {
  # 正在跑的 ComfyUI 进程（按命令行匹配 ComfyUI 与 main.py）
  return @(Get-PythonProcessInfo | Where-Object { $_.CommandLine -match 'ComfyUI' -and $_.CommandLine -match 'main\.py' })
}

function Get-RembgProcess {
  # 正在跑的 rembg 服务进程。
  # 实测 rembg 2.0.85 的启动链：rembg.exe（控制台入口）→ python.exe（uvicorn 真正干活的进程），
  # 两者命令行里都含本 venv 路径，所以统一按「命令行含 venv 路径 + 含 rembg」匹配。
  $escaped = [regex]::Escape($script:Cfg.RembgVenv)
  return @(Get-PythonProcessInfo | Where-Object {
      $_.CommandLine -match $escaped -and $_.CommandLine -match 'rembg'
    })
}

function Ensure-Dir {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
}

function Get-RembgEnv {
  # rembg 权重目录：统一放到 $AiRoot\models 下，避免散落到用户目录（~/.u2net）
  # 注意 U2NET_HOME 要指向 $AiRoot（rembg 会在其下再拼 models/<模型名>/）
  return @{ U2NET_HOME = $script:Cfg.U2NetHome }
}
