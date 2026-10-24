<#
  stop-local-ai.ps1 —— 停止「由本项目启动」的 ComfyUI / rembg 进程

  安全原则（需求 §3.5）：只结束能被证据证明属于本项目的进程，
  绝不按名字批量杀 python.exe，也不会碰你的其它 Python 程序（训练脚本、别的 ComfyUI 实例等）。
  证据优先级：① 命令行包含本项目安装路径；② PID 文件（由 start-*.ps1 写入，且进程确为该 PID）。

  用法：
      pwsh -File .\stop-local-ai.ps1                  # 停两个服务
      pwsh -File .\stop-local-ai.ps1 -Only comfyui    # 只停 ComfyUI
      pwsh -File .\stop-local-ai.ps1 -Only rembg      # 只停 rembg
      pwsh -File .\stop-local-ai.ps1 -DryRun          # 只看会停谁，不动手
#>
[CmdletBinding()]
param(
  [ValidateSet('all', 'comfyui', 'rembg')][string]$Only = 'all',
  [switch]$DryRun,
  [int]$TimeoutSeconds = 15
)

. "$PSScriptRoot\config.ps1"

# 提前告知权限约束：沙箱/低权限环境下 Windows 不允许枚举或结束别的进程，
# 与其让用户对着「Cannot find a process」发懵，不如先给一句人话。
if (-not (Get-Process -Id $PID -ErrorAction SilentlyContinue)) {
  Write-Warn2 '当前环境无法枚举进程表（沙箱/低权限），停止服务可能失败；如失败请用管理员身份重跑本脚本。'
}

function Stop-Target {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('comfyui', 'rembg')][string]$Name,
    [Parameter(Mandatory = $true)][string]$PidFile
  )

  Write-Step "处理 $Name"

  $port = if ($Name -eq 'comfyui') { $Cfg.ComfyPort } else { $Cfg.RembgPort }
  $candidates = New-Object System.Collections.Generic.List[int]

  # ① 命令行证据（沙箱里可能查不到进程表，此时为空，不算错误）
  $procs = if ($Name -eq 'comfyui') { Get-ComfyProcess } else { Get-RembgProcess }
  foreach ($proc in $procs) {
    if ($Name -eq 'comfyui' -and $proc.CommandLine -notmatch [regex]::Escape($Cfg.ComfyRoot)) { continue }
    $candidates.Add([int]$proc.Pid) | Out-Null
  }

  # ② PID 文件证据（start-*.ps1 写入的入口进程 PID）
  if (Test-Path $PidFile) {
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($raw -match '^\d+$') { $candidates.Add([int]$raw) | Out-Null }
  }

  # ③ 端口占用者证据（最硬的证据：PID 文件里的 rembg.exe 只是外壳，
  #    真正监听 7000 的是它 fork 出来的 python 子进程，必须一并停掉）
  foreach ($portPid in @(Get-PortOwnerPid -Port $port)) { $candidates.Add([int]$portPid) | Out-Null }

  $candidates = @($candidates | Sort-Object -Unique)
  if ($candidates.Count -eq 0) {
    Write-Ok "$Name 未在运行"
    if ((Test-Path $PidFile) -and -not $DryRun) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
    return
  }

  foreach ($procId in $candidates) {
    if (-not (Test-ProcessAlive -ProcessId $procId -Ports @($port))) {
      Write-Host "    PID $procId 已不存在"
      continue
    }

    $evidence = ''
    try { $evidence = [string](Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction Stop).CommandLine } catch { $evidence = '' }
    $isPortOwner = @(Get-PortOwnerPid -Port $port) -contains $procId

    $belongs = $false
    $why = ''
    if ($evidence) {
      if ($Name -eq 'comfyui' -and $evidence -match 'main\.py' -and $evidence -match [regex]::Escape($Cfg.ComfyRoot)) { $belongs = $true; $why = '命令行匹配本项目 ComfyUI 目录' }
      if ($Name -eq 'rembg' -and $evidence -match 'rembg' -and $evidence -match [regex]::Escape($Cfg.RembgVenv)) { $belongs = $true; $why = '命令行匹配本项目 rembg 虚拟环境' }
    }
    if (-not $belongs -and (Test-Path $PidFile)) {
      $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
      if ($raw -match '^\d+$' -and [int]$raw -eq $procId) { $belongs = $true; $why = '由本项目 start 脚本写入的 PID 文件' }
    }
    # 端口占用者：本项目的服务只绑 127.0.0.1:$port，且启动脚本会写 PID 文件，
    # 因此「占着这个端口」+「PID 文件存在过」足以证明是本项目启动的服务。
    if (-not $belongs -and $isPortOwner -and (Test-Path $PidFile)) {
      $belongs = $true; $why = "监听本项目端口 $port（rembg 的真实工作子进程）"
    }

    if (-not $belongs) {
      Write-Warn2 "PID $procId 无法证明属于本项目的 $Name，跳过（避免误杀其它 Python 进程）"
      continue
    }

    if ($DryRun) { Write-Host "    [DryRun] 将停止 $Name PID $procId （$why）"; continue }

    Write-Host "    停止 PID $procId （$why）"
    $killed = $false
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      $killed = $true
    } catch {
      # Stop-Process 在受限环境下可能因权限失败；退一步用 taskkill。
      # 两者都失败时必须**如实报错**，不能打印「已停止」——
      # 曾经出现过「脚本说已停止、端口其实还在监听」的假成功。
      $tk = & taskkill /PID $procId /T /F 2>&1
      if ($LASTEXITCODE -eq 0) { $killed = $true } else { Write-Host "    taskkill 也失败：$tk" -ForegroundColor DarkYellow }
    }

    # 以「端口是否真的释放」为最终判据（比进程表可靠，沙箱里也能查）
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline -and (@(Get-PortOwnerPid -Port $port) -contains $procId)) { Start-Sleep -Milliseconds 300 }
    $stillListening = @(Get-PortOwnerPid -Port $port) -contains $procId

    if ($stillListening) {
      Write-Err2 "$Name PID $procId 仍在监听端口 $port，停止失败（请用管理员身份运行，或手动结束该进程）"
      $script:StopFailed = $true
    } elseif ($killed -or -not (Test-ProcessAlive -ProcessId $procId -Ports @($port))) {
      Write-Ok "$Name 已停止（PID $procId）"
    } else {
      Write-Err2 "$Name PID $procId 状态未知，请用 health-check.ps1 复核"
      $script:StopFailed = $true
    }
  }

  if (-not $DryRun -and (Test-Path $PidFile)) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host '=== 停止豆玩本地 AI 服务 ===' -ForegroundColor White

$script:StopFailed = $false

if ($Only -in @('all', 'comfyui')) { Stop-Target -Name 'comfyui' -PidFile $Cfg.ComfyPidFile }
if ($Only -in @('all', 'rembg')) { Stop-Target -Name 'rembg' -PidFile $Cfg.RembgPidFile }

Write-Host ''
if ($DryRun) {
  Write-Warn2 'DryRun 模式：未实际停止任何进程'
  exit 0
}
if ($script:StopFailed) {
  Write-Err2 '有服务未能停止，请按上面的提示处理后重试。'
  exit 1
}
Write-Ok '完成。可用 health-check.ps1 复核。'
exit 0
