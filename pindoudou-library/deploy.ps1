<#
  豆玩 DOUWAN · 一键构建并部署到服务器
  用法：  powershell -ExecutionPolicy Bypass -File deploy.ps1
          powershell -ExecutionPolicy Bypass -File deploy.ps1 -Server pro -WebRoot /var/www/douzao

  注意 1：本文件必须存为「带 BOM 的 UTF-8」。Windows PowerShell 5.1 不会自动识别
          无 BOM 的 UTF-8，会把下面的中文按 GBK 解读，导致整个脚本解析失败。
  注意 2：如果本机没有装 Node，脚本会优先使用 DSH 自带运行时里的 node。
  注意 3：脚本会先清空 WebRoot 再解包，上线前请自行备份旧产物。
#>
param(
  [string]$Server  = 'pro',
  [string]$WebRoot = '/var/www/douzao'
)

$ErrorActionPreference = 'Stop'
# 用 scriptblock 方式调用时 $PSScriptRoot 为空，退化为当前目录
$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $root

# 安全护栏：只允许部署到 /var/www/ 下的目录（脚本里会对该目录做清空操作）
if (-not $WebRoot.StartsWith('/var/www/')) {
  throw "拒绝执行：WebRoot 必须是 /var/www/ 下的路径，当前为 '$WebRoot'"
}

function Resolve-Node {
  $candidates = @(
    'C:\Users\sharyuke\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw '找不到 node 可执行文件'
}

$node = Resolve-Node
$env:CI = 'true'

Write-Host '[1/4] 构建前端 …' -ForegroundColor Cyan
& $node 'node_modules\vite\bin\vite.js' build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

Write-Host '[2/4] 打包 dist …' -ForegroundColor Cyan
$tgz = Join-Path $root 'dist.tar.gz'
if (Test-Path $tgz) { Remove-Item $tgz -Force }
tar -czf $tgz -C $root dist
if ($LASTEXITCODE -ne 0) { throw '打包失败' }

Write-Host "[3/4] 上传到 $Server …" -ForegroundColor Cyan
scp -o BatchMode=yes $tgz "${Server}:/tmp/douzao-dist.tar.gz"
if ($LASTEXITCODE -ne 0) { throw '上传失败' }

Write-Host '[4/4] 服务器端解包 + reload nginx …' -ForegroundColor Cyan
$remote = @"
set -e
mkdir -p $WebRoot
find $WebRoot -mindepth 1 -delete
tar -xzf /tmp/douzao-dist.tar.gz -C $WebRoot --strip-components=1
chmod -R 755 $WebRoot
nginx -t
systemctl reload nginx
rm -f /tmp/douzao-dist.tar.gz
echo '--- 部署完成 ---'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/
"@
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
# ssh 会把远端的 stderr 一起回传（nginx -t 的正常提示也走 stderr），
# 在 $ErrorActionPreference='Stop' 下会被当成异常直接中断脚本，所以这里临时放宽再按退出码判断
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& ssh -o BatchMode=yes $Server "echo $b64 | base64 -d | bash" 2>&1 | ForEach-Object { Write-Host $_ }
$sshCode = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($sshCode -ne 0) { throw "远端部署失败（ssh 退出码 $sshCode）" }

Remove-Item $tgz -Force -ErrorAction SilentlyContinue
Write-Host '✅ 部署完成 → http://192.168.1.185/' -ForegroundColor Green
