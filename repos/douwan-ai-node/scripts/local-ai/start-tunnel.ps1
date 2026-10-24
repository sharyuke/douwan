<#
  start-tunnel.ps1 —— 建立「本机 AI 节点 → qq」的反向 SSH 隧道（阶段 C）

  为什么是这个方向（而不是反过来）：
    qq 是公网服务器，本机 AI 节点在家庭网络里（没有公网 IP、不做端口映射）。
    要让 qq 上的 douwan-api 能调用本机的 ComfyUI / rembg，最省事、最安全的方向是
    **由本机主动连出去**，用 ssh -R 把本机的回环端口「反向」映射到 qq 的回环上：

        本机 127.0.0.1:8188  <──  ssh -R  ──▶  qq 127.0.0.1:8188
        本机 127.0.0.1:7000  <──  ssh -R  ──▶  qq 127.0.0.1:7000

    这样：
      · 不需要在 Windows 上装 OpenSSH Server（那需要管理员权限）；
      · qq 的 sshd 配置是 GatewayPorts no（默认），所以隧道只绑 127.0.0.1，
        **nginx / 外网都碰不到**，满足「不得公开推理端口」的红线；
      · 本机的 AI 服务依旧只监听 127.0.0.1。

  用法：
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-tunnel.ps1
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-tunnel.ps1 -Target home   # 换目标机
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-tunnel.ps1 -Watch         # 前台守护，断了自动重连
#>
[CmdletBinding()]
param(
  [string]$Target = 'qq',
  [int[]]$Ports = @(8188, 7000),
  # 前台守护模式：连接断了就自动重连（适合放进计划任务 / 前台挂着看）
  [switch]$Watch,
  [int]$RetrySeconds = 10
)

. "$PSScriptRoot\config.ps1"

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $ssh)) { Write-Err2 "找不到 Windows 自带 ssh 客户端：$ssh"; exit 1 }

Ensure-Dir $Cfg.LogDir
Ensure-Dir $Cfg.RunDir

function Get-TunnelArgs {
  # -N 不执行远端命令；-T 不分配终端；ExitOnForwardFailure 保证端口映射失败就退出（避免假在线）
  $a = @('-N', '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=accept-new')
  foreach ($p in $Ports) { $a += @('-R', "$p`:127.0.0.1:$p") }
  $a += $Target
  return $a
}

function Get-TunnelProcess {
  # 只认「命令行里同时含 -R 与目标机」的 ssh 进程，避免误杀你手动开的其它 ssh
  $procs = @()
  try {
    $all = Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction Stop
    foreach ($p in $all) {
      $cl = [string]$p.CommandLine
      if ($cl -match '-R' -and $cl -match [regex]::Escape($Target)) {
        $procs += [pscustomobject]@{ Pid = [int]$p.ProcessId; CommandLine = $cl }
      }
    }
  } catch {
    # 沙箱里读不到进程表：退回 PID 文件（start 时写入）
    $pidFromFile = Get-PidFromFile -Path $Cfg.TunnelPidFile
    if ($pidFromFile) { $procs += [pscustomobject]@{ Pid = $pidFromFile; CommandLine = '(来自 PID 文件)' } }
  }
  return @($procs)
}

function Test-TunnelRemote {
  # 从目标机侧验证隧道是否真的通了（最终判据，不看本机进程表）。
  # 走 config.ps1 的 Invoke-RemoteScript，避开「PowerShell 调 ssh 时引号被吞掉」的坑。
  $lines = @()
  foreach ($p in $Ports) {
    $path = if ($p -eq $Cfg.ComfyPort) { '/system_stats' } else { '/api' }
    # 刻意不带引号、不含空格
    $script = "curl -s -m 6 -o /dev/null -w $p=%{http_code} http://127.0.0.1:$p$path; echo`n"
    $lines += @(Invoke-RemoteScript -Target $Target -Script $script -TimeoutSec 12)
  }
  $codes = @($lines | Where-Object { $_ -match '=\d{3}' })
  if ($codes.Count -eq 0) { return '(未取得响应)' }
  return ($codes -join ' ')
}

# ---------------------------------------------------------------- 已在线则直接返回
$existing = @(Get-TunnelProcess)
if ($existing.Count -gt 0 -and -not $Watch) {
  $probe = Test-TunnelRemote
  if ($probe -notmatch '=000') {
    Write-Ok "隧道已在运行（PID $($existing.Pid -join ',')），目标 $Target 侧探活：$probe"
    exit 0
  }
  Write-Warn2 "发现隧道进程（PID $($existing.Pid -join ',')），但目标侧探活不通过：$probe"
  Write-Host '    如需重建，请先运行 stop-tunnel.ps1。'
  exit 1
}

# ---------------------------------------------------------------- 启动
$args = Get-TunnelArgs

if ($Watch) {
  # 前台守护：断了就重连，直到被 Ctrl+C 或 stop-tunnel.ps1 结束
  Write-Step "守护模式：持续维持到 $Target 的反向隧道（端口 $($Ports -join ',')），断线 ${RetrySeconds}s 后重连"
  Write-Host '    日志一并写入：' $Cfg.TunnelLog
  while ($true) {
    Write-Host "[*] $(Get-Date -Format 'HH:mm:ss') 连接 $Target ..."
    & $ssh @args 2>&1 | Tee-Object -FilePath $Cfg.TunnelLog -Append
    $code = $LASTEXITCODE
    Write-Warn2 "$(Get-Date -Format 'HH:mm:ss') 隧道断开（ssh 退出码 $code），${RetrySeconds}s 后重连"
    Start-Sleep -Seconds $RetrySeconds
  }
}

Write-Step "建立反向隧道 → $Target（本机 $($Ports -join ',') 映射到目标机回环）"
$p = Start-Process -FilePath $ssh -ArgumentList $args -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $Cfg.TunnelLog -RedirectStandardError $Cfg.TunnelErrLog
Set-Content -Path $Cfg.TunnelPidFile -Value $p.Id -Encoding ascii
Write-Ok "ssh 客户端已启动，PID = $($p.Id)"
Write-Host "    日志: $($Cfg.TunnelLog)"
Write-Host "    错误: $($Cfg.TunnelErrLog)"

# ---------------------------------------------------------------- 等待并验证
Write-Step '等待隧道就绪并从目标机侧验证（最多 30s）'
$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 2
  if ($p.HasExited) {
    Write-Err2 "ssh 已退出（退出码 $($p.ExitCode)）——端口映射可能失败"
    if (Test-Path $Cfg.TunnelErrLog) { Get-Content $Cfg.TunnelErrLog -Tail 10 | ForEach-Object { Write-Host "    $_" } }
    exit 1
  }
  $probe = Test-TunnelRemote
  if ($probe -notmatch '=000' -and $probe -match '=200') { $ok = $true; break }
}
if ($ok) {
  Write-Ok "隧道已就绪，目标机侧探活：$probe"
  Write-Host '    安全说明：qq 的 sshd 是 GatewayPorts no，所以隧道只绑 127.0.0.1，外网与 nginx 都访问不到。' -ForegroundColor DarkGray
  exit 0
}
Write-Err2 "隧道未就绪（最后一次探活：$probe）"
exit 1
