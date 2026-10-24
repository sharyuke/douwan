<#
  start-comfyui.ps1 —— 启动 ComfyUI（仅监听 127.0.0.1:8188）

  行为：
    * 已在运行（端口有响应或找到进程）→ 直接退出，不会开第二个实例
    * 端口被别的程序占用 → 报错退出，不抢端口
    * 日志写到 $AiRoot\logs\comfyui.log，PID 写到 $AiRoot\run\comfyui.pid
  不做的事：不开公网监听（`--listen` 永不使用）、不注册系统服务/计划任务、不改防火墙。

  用法：
      pwsh -File .\start-comfyui.ps1            # 后台启动并等待健康检查通过
      pwsh -File .\start-comfyui.ps1 -Foreground  # 前台运行（调试用，Ctrl+C 结束）
      pwsh -File .\start-comfyui.ps1 -Force       # 忽略「已在运行」判断，但端口占用时仍会拒绝
#>
[CmdletBinding()]
param(
  [switch]$Foreground,
  [switch]$Force,
  [int]$WaitSeconds = 180
)

. "$PSScriptRoot\config.ps1"

Ensure-Dir $Cfg.LogDir
Ensure-Dir $Cfg.RunDir

# ---------------------------------------------------------------- 前置检查
if (-not (Test-Path $Cfg.ComfyPython)) { Write-Err2 "找不到 python_embeded：$($Cfg.ComfyPython)"; exit 1 }
if (-not (Test-Path $Cfg.ComfyMain)) { Write-Err2 "找不到 ComfyUI main.py：$($Cfg.ComfyMain)"; exit 1 }

$alreadyHealthy = Test-HttpOk -Url "http://127.0.0.1:$($Cfg.ComfyPort)/system_stats" -TimeoutSec 3
# 端口占用是最可靠的「已在运行」信号（沙箱里读不到进程表，netstat 仍然可用）
$listenPids = @(Get-PortOwnerPid -Port $Cfg.ComfyPort)
$running = @(Get-ComfyProcess)

if ($alreadyHealthy -or ($listenPids.Count -gt 0) -or ($running.Count -gt 0)) {
  if (-not $Force) {
    if ($alreadyHealthy) { Write-Ok "ComfyUI 已在运行且健康：http://127.0.0.1:$($Cfg.ComfyPort)" }
    elseif ($listenPids.Count -gt 0) { Write-Warn2 "端口 $($Cfg.ComfyPort) 已被 PID $($listenPids -join ',') 监听，但 HTTP 探活失败，请用 health-check.ps1 查看详情。" }
    else { Write-Warn2 "已发现 ComfyUI 进程（PID: $($running.Pid -join ', ')），但端口未监听，请用 health-check.ps1 查看详情。" }
    Write-Host '    如需重启，请先运行 stop-local-ai.ps1。'
    exit 0
  }
  Write-Warn2 '-Force 指定：仍将再启动一个实例（可能与已有实例争抢显存，不建议）'
}

if ((Test-PortListening -Port $Cfg.ComfyPort) -and -not $alreadyHealthy) {
  Write-Err2 "端口 $($Cfg.ComfyPort) 已被其它程序占用（不是健康的 ComfyUI）。请先释放端口。"
  Write-Host '    查看占用：netstat -ano | findstr ":8188"'
  exit 1
}

# ---------------------------------------------------------------- 启动
Write-Step "启动 ComfyUI（低显存模式，仅 127.0.0.1:$($Cfg.ComfyPort)）"

if ($Foreground) {
  Write-Host "    前台运行，日志同时写入 $($Cfg.ComfyLog)"
  & $Cfg.ComfyPython -s $Cfg.ComfyMain @($Cfg.ComfyArgs) 2>&1 | Tee-Object -FilePath $Cfg.ComfyLog
  exit $LASTEXITCODE
}

$argList = @('-s', $Cfg.ComfyMain) + $Cfg.ComfyArgs
$p = Start-Process -FilePath $Cfg.ComfyPython -ArgumentList $argList `
  -WorkingDirectory $Cfg.ComfyRoot -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $Cfg.ComfyLog -RedirectStandardError $Cfg.ComfyErrLog

Set-Content -Path $Cfg.ComfyPidFile -Value $p.Id -Encoding ascii
Write-Ok "已启动，PID = $($p.Id)"
Write-Host "    日志: $($Cfg.ComfyLog)"
Write-Host "    错误: $($Cfg.ComfyErrLog)"

# ---------------------------------------------------------------- 等待就绪
Write-Step "等待健康检查通过（最多 ${WaitSeconds}s，首次加载模型可能较慢）"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if ($p.HasExited) { Write-Err2 "进程已退出（退出码 $($p.ExitCode)），请查看 $($Cfg.ComfyErrLog)"; exit 1 }
  if (Test-HttpOk -Url "http://127.0.0.1:$($Cfg.ComfyPort)/system_stats" -TimeoutSec 3) { $ready = $true; break }
  Start-Sleep -Seconds 2
}

if ($ready) {
  Write-Ok "ComfyUI 已就绪：http://127.0.0.1:$($Cfg.ComfyPort)"
  exit 0
}
Write-Err2 "等待超时：进程还在（PID $($p.Id)）但 HTTP 未就绪。请查看 $($Cfg.ComfyErrLog)"
exit 1
