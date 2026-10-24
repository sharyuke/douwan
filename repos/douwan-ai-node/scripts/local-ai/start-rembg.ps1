<#
  start-rembg.ps1 —— 启动 rembg HTTP 服务（仅监听 127.0.0.1:7000，CPU 推理）

  行为：
    * 已在运行 → 直接退出，不开第二个实例
    * venv 不存在 → 打印安装指引后退出（不会自动装东西、不会动系统环境）
    * 模型目录统一指向 $AiRoot\models（U2NET_HOME），避免散落到用户目录
  不做的事：不开放公网监听、不装 GPU 版 onnxruntime（避免与 ComfyUI 抢 6GB 显存）、不注册服务。

  实测要点（rembg 2.0.85）：
    * 启动入口只能是 venv 里的 rembg.exe；`python -m rembg` 会报 "No module named rembg.__main__"
    * rembg.exe 会再拉起一个 python.exe 子进程跑 uvicorn，真正的服务进程是后者
    * `rembg s` 的 -h/--host 默认是 0.0.0.0，必须显式改成 127.0.0.1
    * /api/remove 的 model 默认是 bria-rmbg（商业授权），豆玩只用 u2net（Apache-2.0）

  用法：
      pwsh -File .\start-rembg.ps1
      pwsh -File .\start-rembg.ps1 -Foreground
      pwsh -File .\start-rembg.ps1 -WaitSeconds 300
#>
[CmdletBinding()]
param(
  [switch]$Foreground,
  [switch]$Force,
  [int]$WaitSeconds = 120
)

. "$PSScriptRoot\config.ps1"

Ensure-Dir $Cfg.LogDir
Ensure-Dir $Cfg.RunDir
Ensure-Dir $Cfg.ModelDir

# ---------------------------------------------------------------- 安装指引
if (-not (Test-Path $Cfg.RembgPython)) {
  Write-Err2 "找不到 rembg 虚拟环境：$($Cfg.RembgVenv)"
  Write-Host ''
  Write-Host '请手动执行以下步骤（脚本不替你安装，避免破坏现有 Python 环境）：' -ForegroundColor Yellow
  Write-Host ('  python -m venv ' + $Cfg.RembgVenv)
  Write-Host ('  ' + $Cfg.RembgPython + ' -m pip install --upgrade pip')
  Write-Host ('  ' + $Cfg.RembgPython + ' -m pip install "rembg[cpu,cli]"')
  Write-Host ('  $env:U2NET_HOME = ' + $Cfg.U2NetHome + '   # 权重会落到 <U2NET_HOME>\models\u2net\u2net.onnx')
  Write-Host ''
  Write-Host '详细说明见仓库 docs/local-ai-deployment.md。' -ForegroundColor Yellow
  exit 1
}

$rembgVersion = & $Cfg.RembgPython -c "import rembg;print(getattr(rembg,'__version__','unknown'))" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Err2 "rembg 模块不可用：$rembgVersion"
  Write-Host ('    重新安装：' + $Cfg.RembgPython + ' -m pip install "rembg[cpu,cli]"') -ForegroundColor Yellow
  exit 1
}

# 以安装版本的真实 CLI 为准（需求 §3.4 明确要求不得猜测参数）
if (-not (Test-Path $Cfg.RembgExe)) {
  Write-Err2 "找不到 rembg 控制台入口：$($Cfg.RembgExe)"
  Write-Host ('    安装：' + $Cfg.RembgPython + ' -m pip install "rembg[cli]"') -ForegroundColor Yellow
  exit 1
}
$helpText = & $Cfg.RembgExe s --help 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Err2 "rembg 服务子命令不可用（可能缺 cli 依赖）："
  Write-Host ($helpText | Select-Object -First 8)
  exit 1
}

# 权重是否已就位（首次使用会自动下载约 176MB，脚本只提示不代下）
if (-not (Test-Path $Cfg.U2NetWeight)) {
  Write-Warn2 "未找到 u2net 权重：$($Cfg.U2NetWeight)"
  Write-Host ('    首次请求会自动下载（约 176MB）。也可先手动下载：' + $Cfg.RembgExe + ' d u2net') -ForegroundColor Yellow
}

# ---------------------------------------------------------------- 运行判断
# 判定依据：端口是否在监听（netstat 不需要特殊权限，沙箱里也能用）。
# 进程表在沙箱里可能读不到，所以只作为补充信息，不能作为「是否在跑」的唯一依据。
$alreadyHealthy = Test-HttpOk -Url "http://127.0.0.1:$($Cfg.RembgPort)/api" -TimeoutSec 3
$listenPids = @(Get-PortOwnerPid -Port $Cfg.RembgPort)
$running = @(Get-RembgProcess)

if ($alreadyHealthy -or ($listenPids.Count -gt 0) -or ($running.Count -gt 0)) {
  if (-not $Force) {
    if ($alreadyHealthy) { Write-Ok "rembg 已在运行且健康：http://127.0.0.1:$($Cfg.RembgPort)/api（rembg $rembgVersion）" }
    elseif ($listenPids.Count -gt 0) { Write-Warn2 "端口 $($Cfg.RembgPort) 已被 PID $($listenPids -join ',') 监听，但 HTTP 探活失败，请用 health-check.ps1 查看。" }
    else { Write-Warn2 "发现 rembg 进程（PID: $($running.Pid -join ', ')），但端口未监听，请用 health-check.ps1 查看。" }
    Write-Host '    如需重启，请先运行 stop-local-ai.ps1。'
    exit 0
  }
  Write-Warn2 '-Force 指定：仍将再启动一个实例'
}

if ((Test-PortListening -Port $Cfg.RembgPort) -and -not $alreadyHealthy) {
  Write-Err2 "端口 $($Cfg.RembgPort) 已被其它程序占用。查看占用：netstat -ano | findstr 7000"
  exit 1
}

# ---------------------------------------------------------------- 启动
$env:U2NET_HOME = $Cfg.U2NetHome
Write-Step "启动 rembg 服务（CPU / 仅 127.0.0.1:$($Cfg.RembgPort) / 权重目录 $($Cfg.ModelDir)）"
Write-Host "    本版本 CLI: rembg $rembgVersion；参数取自 rembg s --help"

if ($Foreground) {
  & $Cfg.RembgExe @($Cfg.RembgArgs) 2>&1 | Tee-Object -FilePath $Cfg.RembgLog
  exit $LASTEXITCODE
}

$p = Start-Process -FilePath $Cfg.RembgExe -ArgumentList $Cfg.RembgArgs `
  -WorkingDirectory $Cfg.AiRoot -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $Cfg.RembgLog -RedirectStandardError $Cfg.RembgErrLog

Set-Content -Path $Cfg.RembgPidFile -Value $p.Id -Encoding ascii
Write-Ok "已启动，PID = $($p.Id)（rembg.exe 入口；真正监听端口的是它 fork 出的 python 子进程，health-check 会显示端口占用 PID）"
Write-Host "    日志: $($Cfg.RembgLog)"
Write-Host "    错误: $($Cfg.RembgErrLog)"

# ---------------------------------------------------------------- 等待就绪
Write-Step "等待服务就绪（最多 ${WaitSeconds}s）"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if ($p.HasExited) {
    Write-Err2 "进程已退出（退出码 $($p.ExitCode)）"
    if (Test-Path $Cfg.RembgErrLog) { Get-Content $Cfg.RembgErrLog -Tail 15 | ForEach-Object { Write-Host "    $_" } }
    exit 1
  }
  if (Test-HttpOk -Url "http://127.0.0.1:$($Cfg.RembgPort)/api" -TimeoutSec 3) { $ready = $true; break }
  Start-Sleep -Seconds 2
}

if ($ready) {
  Write-Ok "rembg 已就绪：http://127.0.0.1:$($Cfg.RembgPort)/api （OpenAPI 文档，路由以它为准）"
  exit 0
}
Write-Err2 ('等待超时：进程还在（PID {0}）但 HTTP 未就绪，请查看 {1}' -f $p.Id, $Cfg.RembgErrLog)
exit 1
