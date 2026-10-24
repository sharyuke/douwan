<#
  fix-bom.ps1 —— 修复本项目所有 .ps1 的 UTF-8 BOM（**维护脚本，不参与日常运行**）

  为什么需要它：
    本仓库的 .ps1 会被多种工具读写。某些编辑器/写入工具会**丢掉开头的 UTF-8 BOM**，
    而没有 BOM 时 Windows PowerShell 5.1 会用系统 ANSI 代码页（简体中文机器上是 GBK）
    解码文件，导致：
      · 中文字符串变乱码；
      · 更严重的是「<#  <# 注释块」被当成普通代码 → 报 "字符串缺少终止符" /
        "Unexpected attribute 'CmdletBinding'" / "Unexpected token 'param'" 之类的怪错。
    本机最初的症状是：明明语法没问题，用 powershell.exe -File 跑就报令牌错误。

  修复顺序（顺序很重要，不能颠倒）：
    ① 先修注释块开头：某些写入工具会把 BOM+`<#` 变成 BOM+`#`，把 `<` 吃掉，
       于是第一个字符成了孤立的 `#`，注释块失效。修复方式是把第 4、5 字节换回 `<` `#`。
    ② 再补 BOM。
    ③ 最后用 check-syntax.ps1 验证。

  用法：
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\fix-bom.ps1
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\fix-bom.ps1 -WhatIf
#>
[CmdletBinding()]
param(
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$bom = [byte[]](0xEF, 0xBB, 0xBF)

$files = Get-ChildItem -Path $PSScriptRoot -Filter '*.ps1' -File | Sort-Object Name
$fixedBom = 0
$fixedHash = 0

foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $changed = $false

  # ① 注释块开头被吃掉 `<` 的情况：BOM 之后应为 `<`(0x3C) `#`(0x23)
  if ($bytes.Length -gt 5 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    if ($bytes[3] -eq 0x23 -and $bytes[4] -ne 0x0A -and $bytes[4] -ne 0x0D) {
      # 形态为 BOM '#' <非换行>，说明原本是 BOM '<' '#'，'<' 被替换掉了
      $bytes[3] = 0x3C
      $bytes[4] = 0x23
      $changed = $true
      $fixedHash++
      Write-Host "[*] $($f.Name) 修复注释块开头（<# 被写成 #）" -ForegroundColor Yellow
    }
  }

  # ② 补 BOM
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  if (-not $hasBom) {
    $bytes = $bom + $bytes
    $changed = $true
    $fixedBom++
    Write-Host "[*] $($f.Name) 补 UTF-8 BOM" -ForegroundColor Yellow
  }

  if ($changed) {
    if ($WhatIf) { Write-Host "    -WhatIf：未写入" -ForegroundColor DarkGray }
    else { [System.IO.File]::WriteAllBytes($f.FullName, $bytes) }
  }
}

Write-Host ''
Write-Host "扫描 $($files.Count) 个脚本：补 BOM $fixedBom 个，修注释块 $fixedHash 个。" -ForegroundColor Cyan
if (-not $WhatIf) {
  Write-Host '接下来请运行 check-syntax.ps1 复核。' -ForegroundColor Cyan
}
