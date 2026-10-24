<#
  stop-tunnel.ps1 —— 关闭「本机 AI 节点 → 目标机」的反向 SSH 隧道

  安全原则与 stop-local-ai.ps1 一致：只结束**能被证据证明**是本脚本建的隧道进程，
  绝不按名字批量杀 ssh.exe（那会把你手动开的其它 ssh 会话也杀掉）。
  证据：① 命令行同时含 `-R` 与目标机；② 本项目写入的 PID 文件。

  用法：
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stop-tunnel.ps1
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stop-tunnel.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$Target = '',
  [switch]$DryRun
)

. "$PSScriptRoot\config.ps1"
if (-not $Target) { $Target = $Cfg.TunnelTarget }

$candidates = New-Object System.Collections.Generic.List[int]

# ① 命令行证据
try {
  $all = @(Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction Stop)
  foreach ($p in $all) {
    $cl = [string]$p.CommandLine
    if ($cl -match '-R' -and $cl -match [regex]::Escape($Target)) {
      Write-Host "    命令行匹配：PID $($p.ProcessId)"
      $candidates.Add([int]$p.ProcessId) | Out-Null
    }
  }
} catch {
  Write-Host '    （无法枚举进程表，改用 PID 文件判定）' -ForegroundColor DarkGray
}

# ② PID 文件证据
$pidFromFile = Get-PidFromFile -Path $Cfg.TunnelPidFile
if ($pidFromFile) { $candidates.Add([int]$pidFromFile) | Out-Null }

$candidates = @($candidates | Sort-Object -Unique)
if ($candidates.Count -eq 0) {
  Write-Ok '隧道未在运行'
  if ((Test-Path $Cfg.TunnelPidFile) -and -not $DryRun) { Remove-Item $Cfg.TunnelPidFile -Force -ErrorAction SilentlyContinue }
  exit 0
}

$failed = $false
foreach ($procId in $candidates) {
  if ($DryRun) { Write-Host "    [DryRun] 将停止隧道 PID $procId"; continue }

  $killed = $false
  try { Stop-Process -Id $procId -Force -ErrorAction Stop; $killed = $true }
  catch {
    $tk = & taskkill /PID $procId /T /F 2>&1
    if ($LASTEXITCODE -eq 0) { $killed = $true } else { Write-Host "    taskkill 失败：$tk" -ForegroundColor DarkYellow }
  }
  if ($killed) { Write-Ok "隧道已停止（PID $procId）" } else { Write-Err2 "PID $procId 停止失败"; $failed = $true }
}

if (-not $DryRun -and (Test-Path $Cfg.TunnelPidFile)) { Remove-Item $Cfg.TunnelPidFile -Force -ErrorAction SilentlyContinue }

# 复核：目标机侧不应再有隧道端口（走 config.ps1 的远端执行封装，避开 ssh 引号坑）
if (-not $DryRun) {
  $rp = Get-RemoteTunnelPorts -Target $Target -Ports $Cfg.TunnelPorts
  if ($rp.Bound.Count -eq 0) { Write-Ok "$Target 侧已无隧道端口（干净）" }
  else { Write-Warn2 "$Target 侧仍有端口占用：$($rp.Bound -join ', ')"; $failed = $true }
}

if ($DryRun) { Write-Warn2 'DryRun 模式：未实际停止任何进程'; exit 0 }
if ($failed) { Write-Err2 '隧道未完全关闭，请检查上面的输出。'; exit 1 }
Write-Ok '完成。'
exit 0
