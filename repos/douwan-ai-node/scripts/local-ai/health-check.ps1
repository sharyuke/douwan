<#
  health-check.ps1 —— 检查 ComfyUI / rembg 是否在线，输出可读结果

  只读探活：不启动、不停止、不改任何配置。
  退出码：0 = 两个服务都健康；1 = 至少一个不健康（后端据此可判断是否降级）。

  用法：
      pwsh -File .\health-check.ps1
      pwsh -File .\health-check.ps1 -Json      # 输出机器可读 JSON（供后端/CI 使用）
#>
[CmdletBinding()]
param(
  [switch]$Json
)

. "$PSScriptRoot\config.ps1"

$result = [ordered]@{
  checked_at      = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  comfyui         = [ordered]@{ url = "http://127.0.0.1:$($Cfg.ComfyPort)"; healthy = $false; detail = ''; process = ''; pid = $null }
  rembg           = [ordered]@{ url = "http://127.0.0.1:$($Cfg.RembgPort)"; healthy = $false; detail = ''; process = ''; pid = $null }
  gpu             = [ordered]@{ available = $false; detail = '' }
  disk_free_gb    = $null
}

function Get-JsonField {
  # 极简 JSON 取值（避免依赖 PowerShell 版本差异的 ConvertFrom-Json 行为）
  param([string]$Json, [string]$Field)
  if ($Json -match "`"$Field`"\s*:\s*([0-9]+)") { return [int64]$Matches[1] }
  return $null
}

# ---------------------------------------------------------------- ComfyUI
# 进程判定：优先问「谁在监听端口」（不需要特殊权限，最可靠），进程表只作为补充。
$comfyOwner = @(Get-PortOwnerPid -Port $Cfg.ComfyPort)
$comfyProcs = @(Get-ComfyProcess)
$result.comfyui.pid = if ($comfyOwner.Count -gt 0) { $comfyOwner[0] } else { Get-PidFromFile -Path $Cfg.ComfyPidFile }
$result.comfyui.process = if ($comfyOwner.Count -gt 0) { "监听中 PID $($comfyOwner[0])" }
  elseif ($comfyProcs.Count -gt 0) { "进程存在 PID $($comfyProcs[0].Pid)，但端口未监听" }
  else { '未运行' }
try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$($Cfg.ComfyPort)/system_stats" -TimeoutSec 6 -UseBasicParsing -ErrorAction Stop
  $stats = $resp.Content
  $ver = if ($stats -match '"comfyui_version"\s*:\s*"([^"]+)"') { $Matches[1] } else { '?' }
  $vramFree = Get-JsonField -Json $stats -Field 'vram_free'
  $vramTotal = Get-JsonField -Json $stats -Field 'vram_total'
  $result.comfyui.healthy = $true
  if ($vramFree -and $vramTotal) {
    $result.comfyui.detail = "ComfyUI $ver，显存空闲 $([math]::Round($vramFree/1MB))MB / $([math]::Round($vramTotal/1MB))MB"
  } else {
    $result.comfyui.detail = "ComfyUI $ver"
  }
} catch {
  $result.comfyui.detail = "探活失败：$($_.Exception.Message)"
}

# ---------------------------------------------------------------- rembg
$rembgOwner = @(Get-PortOwnerPid -Port $Cfg.RembgPort)
$rembgProcs = @(Get-RembgProcess)
$result.rembg.pid = if ($rembgOwner.Count -gt 0) { $rembgOwner[0] } else { Get-PidFromFile -Path $Cfg.RembgPidFile }
$result.rembg.process = if ($rembgOwner.Count -gt 0) { "监听中 PID $($rembgOwner[0])" }
  elseif ($rembgProcs.Count -gt 0) { "进程存在 PID $($rembgProcs[0].Pid)，但端口未监听" }
  else { '未运行' }
try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$($Cfg.RembgPort)/api" -TimeoutSec 6 -UseBasicParsing -ErrorAction Stop
  $ok = $resp.Content -match 'openapi|paths'
  $result.rembg.healthy = [bool]$ok
  $result.rembg.detail = if ($ok) { 'OpenAPI 文档可访问（路由以它为准）' } else { '接口返回非 OpenAPI 内容' }
} catch {
  try {
    # 有些版本只暴露 /api 的文档页面；再试一次根路径
    $resp2 = Invoke-WebRequest -Uri "http://127.0.0.1:$($Cfg.RembgPort)/" -TimeoutSec 6 -UseBasicParsing -ErrorAction Stop
    $result.rembg.healthy = ($resp2.StatusCode -eq 200)
    $result.rembg.detail = "根路径可访问（HTTP $($resp2.StatusCode)），但 /api 文档读取失败"
  } catch {
    $result.rembg.detail = "探活失败：$($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------- GPU / 磁盘
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($smi) {
  # 注意：不要写成 `& nvidia-smi ... | Select-Object -First 1` ——
  # Select-Object -First 1 会提前终止原生命令管道，$LASTEXITCODE 会变成 -1（假失败）。
  # 正确做法是先收完输出，再取第一行。
  $smiOut = @(& nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader 2>&1)
  $smiCode = $LASTEXITCODE
  $line = if ($smiOut.Count -gt 0) { [string]$smiOut[0] } else { '' }
  if ($smiCode -eq 0 -and $line) {
    $result.gpu.available = $true
    $result.gpu.detail = $line
  } else { $result.gpu.detail = "nvidia-smi 失败（exit $smiCode）：$line" }
} else { $result.gpu.detail = 'nvidia-smi 不在 PATH' }

try {
  $di = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($Cfg.AiRoot))
  $result.disk_free_gb = [math]::Round($di.AvailableFreeSpace / 1GB, 1)
} catch { $result.disk_free_gb = $null }

# ---------------------------------------------------------------- 输出
if ($Json) {
  $json = $result | ConvertTo-Json -Depth 5
  Write-Output $json
} else {
  Write-Host ''
  Write-Host '=== 豆玩本地 AI 服务健康检查 ===' -ForegroundColor White
  Write-Host "检查时间 : $($result.checked_at)"
  Write-Host ''
  if ($result.comfyui.healthy) { Write-Ok "ComfyUI  : $($result.comfyui.detail)  [$($result.comfyui.process)]" }
  else { Write-Err2 "ComfyUI  : $($result.comfyui.detail)  [$($result.comfyui.process)]"; Write-Host "           启动：pwsh -File `"$PSScriptRoot\start-comfyui.ps1`"" }
  if ($result.rembg.healthy) { Write-Ok "rembg    : $($result.rembg.detail)  [$($result.rembg.process)]" }
  else { Write-Err2 "rembg    : $($result.rembg.detail)  [$($result.rembg.process)]"; Write-Host "           启动：pwsh -File `"$PSScriptRoot\start-rembg.ps1`"" }
  Write-Host ''
  if ($result.gpu.available) { Write-Ok "GPU      : $($result.gpu.detail)" } else { Write-Warn2 "GPU      : $($result.gpu.detail)" }
  if ($result.disk_free_gb) { Write-Ok "磁盘剩余 : $($result.disk_free_gb) GB（$($Cfg.AiRoot)）" }
  Write-Host ''
  Write-Host '提示：本地 AI 不可用时，豆玩普通拼豆转换功能不受影响（后端会降级返回可读错误）。' -ForegroundColor DarkGray
}

if ($result.comfyui.healthy -and $result.rembg.healthy) { exit 0 }
exit 1
