<#
  check-syntax.ps1 —— 用真实 PowerShell 解析器校验本目录所有脚本（含中文，必须能过）

  为什么需要它：
    Windows PowerShell 5.1 在没有 BOM 时会把 UTF-8 脚本按 ANSI 解码，中文字符串会被拆坏，
    出现「字符串缺少终止符」这类假故障（实测踩过）。本脚本用 .NET ReadAllText 显式按 UTF-8
    读取，再交给 PowerShell 解析器，避免 Get-Content 的解码干扰。

  用法：
      pwsh -File .\check-syntax.ps1          # 校验本目录全部 *.ps1
      pwsh -File .\check-syntax.ps1 -Path X # 只校验一个文件
  退出码：全部通过 0；有任何失败 1
#>
[CmdletBinding()]
param(
  [string]$Path
)

$utf8 = New-Object System.Text.UTF8Encoding($false)
$files = if ($Path) { @(Get-Item -LiteralPath $Path) } else { @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter *.ps1 | Sort-Object Name) }

$failed = 0
foreach ($file in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $text = [System.IO.File]::ReadAllText($file.FullName, $utf8)
  $errs = $null
  $null = [System.Management.Automation.PSParser]::Tokenize($text, [ref]$errs)

  $bomTag = if ($hasBom) { 'BOM' } else { 'no-BOM' }
  if (-not $hasBom) { $failed++ }
  if ($errs.Count -eq 0) {
    Write-Host ("[{0}] {1,-24} {2}" -f $(if ($hasBom) { 'OK' } else { '!!' }), $file.Name, $bomTag) -ForegroundColor $(if ($hasBom) { 'Green' } else { 'Yellow' })
  } else {
    $failed++
    Write-Host ("[x] {0,-24} {1}  解析错误 {2} 处" -f $file.Name, $bomTag, $errs.Count) -ForegroundColor Red
    $errs | Select-Object -First 5 | ForEach-Object {
      Write-Host ("      line {0}: {1}" -f $_.Token.StartLine, $_.Message) -ForegroundColor Red
    }
  }
}

if ($failed -eq 0) { Write-Host '全部脚本语法通过（且都带 UTF-8 BOM）。' -ForegroundColor Green; exit 0 }
Write-Host "有 $failed 项未通过。" -ForegroundColor Red
exit 1
