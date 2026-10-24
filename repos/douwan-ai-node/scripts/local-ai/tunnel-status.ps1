<#
  tunnel-status.ps1 —— 一条命令看清「阶段 C 隧道 + 两个 AI 服务」的完整链路状态

  检查四层（从下往上）：
    ① 本机 AI 服务是否在监听回环（ComfyUI 8188 / rembg 7000）
    ② 本机 ssh 隧道客户端进程是否存在
    ③ 目标机侧隧道端口是否绑在 127.0.0.1（而不是 0.0.0.0 → 红线）
    ④ 目标机侧能不能真的把请求打到本机 AI 服务上（最终判据）

  用法：
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tunnel-status.ps1
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tunnel-status.ps1 -Json
#>
[CmdletBinding()]
param(
  [string]$Target = '',
  [switch]$Json
)

. "$PSScriptRoot\config.ps1"
if (-not $Target) { $Target = $Cfg.TunnelTarget }

$ports = $Cfg.TunnelPorts
$portAlt = $ports -join '|'
$result = [ordered]@{
  checked_at   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  target       = $Target
  local_comfy  = $false
  local_rembg  = $false
  client_pid   = $null
  remote_bound = ''
  remote_probe = ''
  loopback_only = $false
  ok           = $false
  detail       = ''
}

# ① 本机服务
$result.local_comfy = Test-HttpOk -Url "http://127.0.0.1:$($Cfg.ComfyPort)/system_stats" -TimeoutSec 5
$result.local_rembg = Test-HttpOk -Url "http://127.0.0.1:$($Cfg.RembgPort)/api" -TimeoutSec 5

# ② 隧道客户端
try {
  $all = @(Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction Stop)
  $mine = @($all | Where-Object { [string]$_.CommandLine -match '-R' -and [string]$_.CommandLine -match [regex]::Escape($Target) })
  if ($mine.Count -gt 0) { $result.client_pid = [int]$mine[0].ProcessId }
} catch { }
if (-not $result.client_pid) { $result.client_pid = Get-PidFromFile -Path $Cfg.TunnelPidFile }

# ③④ 目标机侧：绑定地址 + 真实探活
# 走 config.ps1 的 Invoke-RemoteScript / Get-RemoteTunnelPorts（base64 + 无引号管道），
# 并在 PowerShell 侧解析输出，避开「PowerShell 调 ssh 时引号被吞掉」的坑。
$rp = Get-RemoteTunnelPorts -Target $Target -Ports $ports
$result.remote_bound = if ($rp.Bound.Count -gt 0) { $rp.Bound -join ' | ' } else { 'REMOTE_NONE' }
$result.loopback_only = [bool]$rp.LoopbackOnly
if ($rp.Violations.Count -gt 0) {
  $result.detail = "红线告警：隧道端口出现在非回环地址上！$($rp.Violations -join ' | ')"
}

$probeLines = @()
foreach ($p in $ports) {
  $path = if ($p -eq $Cfg.ComfyPort) { '/system_stats' } else { '/api' }
  # 刻意不带引号、不含空格：-w 的值用 key=value token
  $script = "curl -s -m 6 -o /dev/null -w $p=%{http_code} http://127.0.0.1:$p$path; echo`n"
  $probeLines += @(Invoke-RemoteScript -Target $Target -Script $script -TimeoutSec 12)
}
$result.remote_probe = (($probeLines | Where-Object { $_ -match '=\d{3}' }) -join ' ')
if (-not $result.remote_probe) { $result.remote_probe = '(未取得响应)' }

$allOk = $result.local_comfy -and $result.local_rembg -and $result.client_pid -and
        ($result.remote_probe -notmatch '=000') -and ($result.remote_probe -match '=200') -and
        $result.loopback_only
$result.ok = [bool]$allOk

if ($Json) {
  $result | ConvertTo-Json -Depth 5
  if ($allOk) { exit 0 } else { exit 1 }
}

Write-Host ''
Write-Host "=== 本地 AI 隧道状态（目标机 $Target） ===" -ForegroundColor White
Write-Host "检查时间 : $($result.checked_at)"
Write-Host ''
if ($result.local_comfy) { Write-Ok '① 本机 ComfyUI  : 127.0.0.1:8188 健康' } else { Write-Err2 '① 本机 ComfyUI  : 探活失败（先跑 start-comfyui.ps1）' }
if ($result.local_rembg) { Write-Ok '① 本机 rembg    : 127.0.0.1:7000 健康' } else { Write-Err2 '① 本机 rembg    : 探活失败（先跑 start-rembg.ps1）' }
if ($result.client_pid) { Write-Ok "② 隧道客户端    : ssh 进程 PID $($result.client_pid)" } else { Write-Err2 '② 隧道客户端    : 未运行（跑 start-tunnel.ps1）' }
if ($result.remote_bound -match 'REMOTE_NONE' -or -not $result.remote_bound) { Write-Err2 "③ $Target 侧端口 : 未绑定（隧道未建立）" }
elseif ($result.loopback_only) { Write-Ok "③ $Target 侧端口 : 仅绑回环 —— $($result.remote_bound)" }
else { Write-Err2 "③ $Target 侧端口 : $($result.detail)" }
if ($result.remote_probe -match '=200') { Write-Ok "④ 端到端探活    : $($result.remote_probe)" }
else { Write-Err2 "④ 端到端探活    : $($result.remote_probe)" }
Write-Host ''
if ($allOk) { Write-Ok '链路完整：目标机可以调用本机 AI 服务（且只走回环，未对外暴露）。'; exit 0 }
Write-Err2 '链路不完整，见上面逐项状态。'
exit 1
