# 启动本地共用预览服务器。端口上已有进程就退出，不另开第二台。
# 用法：powershell -ExecutionPolicy Bypass -File tools\preview\start.ps1 [-Port 5180]
param([int]$Port = 5180)

$ErrorActionPreference = 'Stop'
$rule = "douwan preview $Port"

$listening = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
$onAll = @($listening | Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' })
if ($onAll.Count -gt 0) {
  Write-Host "preview already running on http://127.0.0.1:$Port/ (pid $($onAll[0].OwningProcess))"
} else {
  foreach ($row in $listening) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.OwningProcess)" -ErrorAction SilentlyContinue
    # start.ps1 的工作目录就是 preview，命令行里经常只剩 server.mjs，没有目录名。
    if ($proc -and $proc.CommandLine -match 'server\.mjs') {
      Stop-Process -Id $row.OwningProcess -Force
      Write-Host "stopped preview pid $($row.OwningProcess) (it was not listening on 0.0.0.0)"
    } else {
      throw "port $Port is taken by pid $($row.OwningProcess), not the shared preview server"
    }
  }
  $free = $false
  foreach ($i in 1..20) {
    $busy = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($busy.Count -eq 0) { $free = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $free) { throw "port $Port is still in use after stopping the old preview" }
  # 从 agent 会话里直接 Start-Process 隐藏窗口会得到 0xC0000142，进程马上退出。
  # 计划任务在用户会话里拉起，关掉当前会话后服务器还在。日期放在 2030，避免到点再拉起第二份。
  $task = 'DouwanPreview'
  $cmd = Join-Path $PSScriptRoot 'run-server.cmd'
  schtasks /Create /F /TN $task /SC ONCE /ST 00:00 /SD 2030/01/01 /RL LIMITED /TR "`"$cmd`" $Port" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "could not register preview task $task" }
  schtasks /Run /TN $task | Out-Null
  if ($LASTEXITCODE -ne 0) {
    schtasks /End /TN $task | Out-Null
    schtasks /Run /TN $task | Out-Null
  }
  $ready = $false
  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 250
    $listening = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listening.Count -gt 0) { $ready = $true; break }
  }
  if (-not $ready) { throw "preview failed to start on port $Port" }
  Write-Host "preview started on http://127.0.0.1:$Port/ (pid $($listening[0].OwningProcess))"
}

# 公用网络默认拦截入站。规则已在就跳过；没权限时只提示，不因此让预览失败。
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
netsh advfirewall firewall show rule name="$rule" | Out-Null
if ($LASTEXITCODE -ne 0) {
  netsh advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=$Port profile=any | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "firewall: inbound TCP $Port allowed"
  } else {
    Write-Host "firewall: could not add inbound TCP $Port (other computers may be blocked)"
  }
}
$ErrorActionPreference = $prev
