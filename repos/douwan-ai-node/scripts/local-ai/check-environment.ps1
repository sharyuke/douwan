<#
  check-environment.ps1 —— 检查本机是否满足「豆玩本地 AI 节点」的运行条件

  只检查、不修改：不会安装/删除/改配置、不动网络、不动防火墙、不注册服务。
  退出码：0 = 全部通过；1 = 有阻塞项（详见输出）；（仅在 -Strict 时）2 = 有警告

  用法：
      pwsh -File .\check-environment.ps1
      pwsh -File .\check-environment.ps1 -Strict
#>
[CmdletBinding()]
param(
  # 有警告也视为失败（用于自动化）
  [switch]$Strict
)

. "$PSScriptRoot\config.ps1"

$blockers = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Blocker { param([string]$m) $blockers.Add($m) | Out-Null; Write-Err2 $m }
function Add-Warning { param([string]$m) $warnings.Add($m) | Out-Null; Write-Warn2 $m }

Write-Host ''
Write-Host '=== 豆玩本地 AI 节点 · 环境检查 ===' -ForegroundColor White
Write-Host "配置根目录 : $($Cfg.AiRoot)"
Write-Host "ComfyUI    : $($Cfg.ComfyRoot)"
Write-Host ''

# ---------------------------------------------------------------- 1. 操作系统
Write-Step '1/8 操作系统'
if ($env:OS -eq 'Windows_NT') {
  Write-Ok "Windows（PowerShell $($PSVersionTable.PSVersion)）"
} else {
  Add-Blocker "当前不是 Windows（脚本按 Windows 便携版 ComfyUI 设计）"
}

# ---------------------------------------------------------------- 2. NVIDIA 驱动
Write-Step '2/8 NVIDIA 驱动与显卡'
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $smi) {
  Add-Blocker 'nvidia-smi 不在 PATH：请安装/更新 NVIDIA 驱动（驱动安装需要你手动确认，脚本不会自动装）'
} else {
  $smiOut = & nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used --format=csv,noheader 2>&1
  if ($LASTEXITCODE -ne 0) {
    Add-Blocker "nvidia-smi 执行失败：$smiOut"
  } else {
    foreach ($line in @($smiOut)) {
      Write-Ok "GPU: $line"
      $parts = $line -split ','
      if ($parts.Count -ge 3) {
        $totalMiB = [int]($parts[2] -replace '[^\d]', '')
        $usedMiB = [int]($parts[3] -replace '[^\d]', '')
        if ($totalMiB -lt 6000) { Add-Warning "显存只有 ${totalMiB}MiB，6GB 以下请只用 512×512 与轻量模型" }
        if (($totalMiB - $usedMiB) -lt 2500) {
          Add-Warning "当前空闲显存仅 $($totalMiB - $usedMiB)MiB：请关闭部分占用 GPU 的程序（浏览器/微信/桌面客户端），否则可能 OOM"
        }
      }
    }
  }
}

# ---------------------------------------------------------------- 3. 磁盘空间
Write-Step '3/8 磁盘空间'
foreach ($path in @($Cfg.AiRoot, $Cfg.ComfyRoot)) {
  $driveRoot = [System.IO.Path]::GetPathRoot($path)
  if (-not (Test-Path $driveRoot)) { Add-Blocker "路径所在盘符不存在：$driveRoot"; continue }
  try {
    $di = New-Object System.IO.DriveInfo($driveRoot)
    $freeGB = [math]::Round($di.AvailableFreeSpace / 1GB, 1)
    if ($freeGB -lt 20) { Add-Blocker "$path 所在盘剩余仅 ${freeGB}GB（建议 ≥20GB）" }
    elseif ($freeGB -lt 50) { Add-Warning "$path 所在盘剩余 ${freeGB}GB，装模型后注意余量" }
    else { Write-Ok "$path 所在盘剩余 ${freeGB}GB" }
  } catch {
    Add-Warning "无法读取 $path 所在盘剩余空间：$($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------- 4. 目录结构
Write-Step '4/8 目录与安装路径'
foreach ($d in @($Cfg.AiRoot, $Cfg.LogDir, $Cfg.RunDir, $Cfg.ModelDir)) {
  if (Test-Path $d) { Write-Ok "存在：$d" } else { Add-Warning "缺少目录（start-* 脚本会自动创建）：$d" }
}
if (Test-Path (Join-Path $Cfg.ComfyRoot 'ComfyUI\main.py')) { Write-Ok "ComfyUI 主程序：$($Cfg.ComfyMain)" }
else { Add-Blocker "找不到 ComfyUI 主程序：$($Cfg.ComfyMain)（请核对 config.ps1 的 ComfyRoot）" }

# ---------------------------------------------------------------- 5. ComfyUI 环境
# 注意：这里**不**调用 ComfyUI 的 python 去 import torch。
# 原因：在受限/沙箱环境里，启动 python 子进程会**挂起**（实测 >300s 无任何输出）。
# 版本信息改为「读 site-packages 的 dist-info 目录名」+「问运行中的服务」，
# 既不启动子进程，也不需要服务在线，两条路互相印证。
Write-Step '5/8 ComfyUI 运行环境'
if (Test-Path $Cfg.ComfyPython) {
  $embPy = Join-Path $Cfg.ComfyRoot 'python_embeded'
  # dist-info 目录名形如 torch-2.10.0+cu130.dist-info
  $torchDist = @(Get-ChildItem -Path (Join-Path $embPy 'Lib\site-packages') -Filter 'torch-*.dist-info' -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch 'torchvision|torchaudio' } | Select-Object -First 1)
  if ($torchDist) {
    $torchVer = $torchDist.Name -replace '^torch-', '' -replace '\.dist-info$', ''
    if ($torchVer -match '\+cu') { Write-Ok "torch $torchVer（CUDA 版；实际可用性由下面 ComfyUI 探活确认）" }
    elseif ($torchVer -match '\+cpu') { Add-Blocker "torch $torchVer 是 CPU 版，无法用 GPU 推理" }
    else { Write-Ok "torch $torchVer" }
  } else {
    Add-Warning "找不到 torch 的 dist-info（python_embeded\Lib\site-packages 里没有 torch-*.dist-info）"
  }
  $verTxt = Join-Path $embPy '.venv-version'
  if (Test-Path $verTxt) { Write-Ok "python_embeded 版本标记：$((Get-Content $verTxt -Raw).Trim())" }

  # 运行中的 ComfyUI 会直接报出 torch 与 CUDA 的真实状态，这是最硬的证据
  $stats = $null
  try { $stats = (Invoke-WebRequest -Uri "http://127.0.0.1:$($Cfg.ComfyPort)/system_stats" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop).Content } catch { $stats = $null }
  if ($stats) {
    $cudaDev = if ($stats -match '"name"\s*:\s*"(cuda:[^"]+)"') { $Matches[1] } else { '?' }
    $torchDev = if ($stats -match '"torch_vram_total"\s*:\s*(\d+)') { $Matches[1] } else { '?' }
    Write-Ok "ComfyUI 在线，CUDA 设备：$cudaDev（torch 显存字段可读：$torchDev）"
  } else {
    Add-Warning "ComfyUI 未在线，无法复核 torch/CUDA 实际可用性（可用 start-comfyui.ps1 启动后再跑本检查）"
  }
} else {
  Add-Blocker "找不到 ComfyUI 的 python_embeded：$($Cfg.ComfyPython)"
}

# ---------------------------------------------------------------- 6. rembg 环境
Write-Step '6/8 rembg 运行环境'
if (Test-Path $Cfg.RembgPython) {
  $sp = Join-Path $Cfg.RembgVenv 'Lib\site-packages'
  $rembgDist = @(Get-ChildItem -Path $sp -Filter 'rembg-*.dist-info' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($rembgDist) {
    Write-Ok ("rembg " + ($rembgDist.Name -replace '^rembg-', '' -replace '\.dist-info$', ''))
  } else {
    Add-Blocker "找不到 rembg 的 dist-info：$sp（rembg 未安装在虚拟环境里）"
  }
  $ortDist = @(Get-ChildItem -Path $sp -Filter 'onnxruntime-*.dist-info' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($ortDist) {
    Write-Ok ("onnxruntime " + ($ortDist.Name -replace '^onnxruntime-', '' -replace '\.dist-info$', '') + '（CPU 推理，刻意不抢 ComfyUI 的 6GB 显存）')
  } else {
    Add-Blocker "找不到 onnxruntime 的 dist-info：onnxruntime 不可用"
  }
  # 运行中的 rembg 能直接证明依赖链是通的
  if (Test-HttpOk -Url "http://127.0.0.1:$($Cfg.RembgPort)/api" -TimeoutSec 5) {
    Write-Ok "rembg 服务在线（OpenAPI 可读，说明 rembg + onnxruntime 依赖链正常）"
  } else {
    Add-Warning "rembg 未在线，无法复核依赖链可用性（可用 start-rembg.ps1 启动后再跑本检查）"
  }

  $modelFile = $Cfg.U2NetWeight
  $legacyModelFile = Join-Path $Cfg.ModelDir 'u2net.onnx'
  if (Test-Path $modelFile) {
    $mb = [math]::Round((Get-Item $modelFile).Length / 1MB, 1)
    Write-Ok "U²-Net 权重已就位：$modelFile (${mb}MB)"
  } elseif (Test-Path $legacyModelFile) {
    Add-Warning "权重位置不对：发现 $legacyModelFile，但 rembg 实际读取 $modelFile。请移动到 ...\models\u2net\ 下（U2NET_HOME 是上一级目录）"
  } else {
    Add-Warning "尚无 U²-Net 权重：首次调用抠图时 rembg 会自动下载到 $modelFile（约 176MB）"
  }
} else {
  Add-Blocker "找不到 rembg 虚拟环境：$($Cfg.RembgVenv)（用 start-rembg.ps1 的安装指引创建）"
}

# ---------------------------------------------------------------- 7. 端口占用
Write-Step '7/8 端口占用（127.0.0.1）'
foreach ($p in @(@{n = 'ComfyUI'; port = $Cfg.ComfyPort }, @{n = 'rembg'; port = $Cfg.RembgPort })) {
  if (Test-PortListening -Port $p.port) {
    $ok = if ($p.n -eq 'ComfyUI') { Test-HttpOk -Url "http://127.0.0.1:$($p.port)/system_stats" } else { Test-HttpOk -Url "http://127.0.0.1:$($p.port)/api" }
    if ($ok) { Write-Ok "$($p.n) 已在 127.0.0.1:$($p.port) 运行且健康" }
    else { Add-Warning "$($p.n) 端口 $($p.port) 被占用，但 HTTP 探活失败（可能是别的程序占用，或服务正在启动）" }
  } else {
    Write-Ok "$($p.n) 端口 $($p.port) 空闲（未启动）"
  }
}

# ---------------------------------------------------------------- 8. 安全红线
Write-Step '8/8 安全红线检查'
$bad = @()
foreach ($p in @(@{n = 'ComfyUI'; port = $Cfg.ComfyPort }, @{n = 'rembg'; port = $Cfg.RembgPort })) {
  $lines = & netstat -ano -p TCP 2>$null | Select-String -Pattern 'LISTENING' | Select-String -Pattern ":$($p.port)\s"
  foreach ($l in @($lines)) {
    $addr = ($l.ToString().Trim() -split '\s+')[1]
    if ($addr -notmatch '^(127\.0\.0\.1|\[::1\])') { $bad += "$($p.n) 正监听 $addr（不是本机回环！）" }
  }
}
if ($bad.Count -eq 0) {
  Write-Ok 'ComfyUI / rembg 都没有对外监听（只允许 127.0.0.1）'
} else {
  foreach ($b in $bad) { Add-Blocker $b }
  Write-Err2 '请立刻用 stop-local-ai.ps1 停止，并去掉 --listen 0.0.0.0 之类的参数'
}

# ---------------------------------------------------------------- 汇总
Write-Host ''
Write-Host '=== 结果 ===' -ForegroundColor White
if ($blockers.Count -eq 0) { Write-Ok "无阻塞项" } else { Write-Err2 "阻塞项 $($blockers.Count) 个："; $i = 1; foreach ($b in $blockers) { Write-Host ("  {0}. {1}" -f $i, $b) -ForegroundColor Red; $i++ } }
if ($warnings.Count -gt 0) { Write-Warn2 "警告 $($warnings.Count) 个："; $i = 1; foreach ($w in $warnings) { Write-Host ("  {0}. {1}" -f $i, $w) -ForegroundColor Yellow; $i++ } }

if ($blockers.Count -gt 0) { exit 1 }
if ($Strict -and $warnings.Count -gt 0) { exit 2 }
exit 0
