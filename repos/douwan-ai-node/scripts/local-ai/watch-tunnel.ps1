<#
  watch-tunnel.ps1 —— 守护脚本：隧道断了自动重连（阶段 C）

  为什么需要它：
    ssh 反向隧道会因网络抖动、服务器重启、休眠唤醒而断开。
    生产上不能让「AI 不可用」变成静默故障，所以两层保障：
      ① ssh 自身心跳：ServerAliveInterval=30 / ServerAliveCountMax=3（start-tunnel.ps1 里已设）
      ② 本脚本：断开后按间隔重连，并把每次断连写进日志，便于事后排查

  用法：
      # 前台运行（适合先手动观察）
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\watch-tunnel.ps1

      # 放进计划任务（登录时自动启动），见 -InstallTask 与 docs/local-ai-deployment.md §10

  说明：本脚本只做「重连隧道」，**不负责启动 AI 服务** ——
        服务没起时隧道连得上但探活会 000，请先跑 start-comfyui.ps1 / start-rembg.ps1。
#>
[CmdletBinding()]
param(
  [string]$Target = '',
  [int]$RetrySeconds = 10,
  [int]$ProbeSeconds = 60,
  # 注册计划任务（登录时自动拉起守护；需要管理员权限）
  [switch]$InstallTask,
  [string]$TaskName = 'DouWan-AI-Tunnel'
)

. "$PSScriptRoot\config.ps1"
if (-not $Target) { $Target = $Cfg.TunnelTarget }

if ($InstallTask) {
  $self = $MyInvocation.MyCommand.Path
  $action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$self`" -Target $Target"
  try {
    # 计划任务以「登录时」触发、以当前用户身份运行，不需要存密码
    $a = New-ScheduledTaskAction -Execute 'powershell.exe' `
      -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$self`" -Target $Target"
    $t = New-ScheduledTaskTrigger -AtLogOn
    $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $a -Trigger $t -Settings $s -Force | Out-Null
    Write-Ok "已注册计划任务：$TaskName（登录时自动运行隧道守护）"
    Write-Host '    查看：Get-ScheduledTask -TaskName DouWan-AI-Tunnel | Format-List'
    Write-Host "    删除：Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
  } catch {
    Write-Err2 "注册计划任务失败：$($_.Exception.Message)"
    Write-Host '    该操作需要管理员权限。可以改为手动把本脚本放进「启动」文件夹：' -ForegroundColor Yellow
    Write-Host "    shell:startup  → 新建快捷方式指向 powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$self`"" -ForegroundColor Yellow
  }
  exit 0
}

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $ssh)) { Write-Err2 "找不到 ssh 客户端：$ssh"; exit 1 }
Ensure-Dir $Cfg.LogDir
Ensure-Dir $Cfg.RunDir

function Write-TunnelLog {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message"
  Write-Host $line
  Add-Content -Path $Cfg.TunnelLog -Value $line -Encoding UTF8
}

$sshArgs = @('-N', '-T',
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'TCPKeepAlive=yes')
foreach ($p in $Cfg.TunnelPorts) { $sshArgs += @('-R', "$p`:127.0.0.1:$p") }
$sshArgs += $Target

Write-TunnelLog "守护启动：目标 $Target，端口 $($Cfg.TunnelPorts -join ','), 重连间隔 ${RetrySeconds}s"

while ($true) {
  # 已有健康隧道就继续观察，避免重复建连
  $rp = $null
  try { $rp = Get-RemoteTunnelPorts -Target $Target -Ports $Cfg.TunnelPorts } catch { $rp = $null }
  if ($rp -and $rp.Bound.Count -eq $Cfg.TunnelPorts.Count) {
    Start-Sleep -Seconds $ProbeSeconds
    continue
  }

  Write-TunnelLog "隧道不可用（已绑定 $($rp.Bound.Count)/$($Cfg.TunnelPorts.Count)），开始建连"
  $p = Start-Process -FilePath $ssh -ArgumentList $sshArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $Cfg.TunnelLog -RedirectStandardError $Cfg.TunnelErrLog
  Set-Content -Path $Cfg.TunnelPidFile -Value $p.Id -Encoding ascii
  Write-TunnelLog "ssh 客户端 PID = $($p.Id)"

  # 等它退出（正常情况会一直挂着；断了就走到这里重连）
  try { $p.WaitForExit() } catch { }
  Write-TunnelLog "ssh 已退出（退出码 $($p.ExitCode)），${RetrySeconds}s 后重连"
  Start-Sleep -Seconds $RetrySeconds
}
