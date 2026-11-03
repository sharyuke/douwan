# 把一份前端 dist 复制进共用预览目录，并确保那一台静态服务器在跑。
# 服务器已在听就不要重启：它每次请求都读 www/ 里的文件。
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\preview\deploy.ps1 -Dist D:\some\dist
#   powershell -ExecutionPolicy Bypass -File tools\preview\deploy.ps1 -Build
param(
  [string]$Project = 'C:\Users\sharyuke\Documents\work\douwan\pindoudou',
  [string]$Dist = 'C:\Users\sharyuke\Documents\work\douwan\pindoudou\dist',
  [switch]$Build
)

$ErrorActionPreference = 'Stop'
$www = Join-Path $PSScriptRoot 'www'

if ($Build) {
  $env:Path = "C:\Users\sharyuke\Documents\work\douwan\tools\node;C:\Users\sharyuke\Documents\work\douwan\tools\npm-global;" + $env:Path
  Push-Location $Project
  try {
    Write-Host '==> vite build'
    & pnpm exec vite build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed ($LASTEXITCODE)" }
    Write-Host '==> build-seo-pages'
    & node scripts/build-seo-pages.mjs
    if ($LASTEXITCODE -ne 0) { throw "build-seo-pages failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

$index = Join-Path $Dist 'index.html'
if (-not (Test-Path $index)) { throw "no index.html in $Dist" }

if (Test-Path $www) { Get-ChildItem -Force $www | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force -Path $www | Out-Null
Copy-Item -Path (Join-Path $Dist '*') -Destination $www -Recurse -Force

$assets = (Get-ChildItem (Join-Path $www 'assets') -Filter 'index-*.js' -ErrorAction SilentlyContinue | Select-Object -First 1).Name
$seo = Test-Path (Join-Path $www 'seo\pages.json')
$lines = @(
  "asset: $assets",
  "dist: $Dist",
  "time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
)
$top = Split-Path $Dist -Parent
function Read-Git([string]$ArgsLine) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = "-C `"$top`" $ArgsLine"
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $proc = [Diagnostics.Process]::Start($psi)
  $text = $proc.StandardOutput.ReadToEnd()
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) { return '' }
  return $text.Trim()
}
$git = Read-Git 'rev-parse --short HEAD'
$subject = Read-Git 'log -1 --format=%s'
if ($git) { $lines += "commit: $git $subject" }
Set-Content -Encoding utf8 -Path (Join-Path $www 'PREVIEW.txt') -Value ($lines -join "`r`n")

Write-Host ("deployed {0} -> {1}" -f $assets, $www)
Write-Host ("seo/pages.json: {0}" -f $(if ($seo) { 'ok' } else { 'MISSING (run build-seo-pages.mjs)' }))
& (Join-Path $PSScriptRoot 'start.ps1')
Write-Host 'http://127.0.0.1:5180/'
Write-Host 'http://192.168.1.205:5180/   (局域网；网卡地址变了就换成本机当前 IPv4)'
