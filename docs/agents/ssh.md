# 从 PowerShell 调 ssh

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §0「ssh 调用的坑」。

### ssh 调用的坑（踩过好几次）

从 PowerShell 调 `ssh` 时，**内层引号会被吞掉**，命令行里的 `(`、`|`、`$` 还会被远端 bash 二次解析
（症状例如 `syntax error near unexpected token '('`）。稳妥写法：

- 外层用**单引号**包住整条远端命令（避免 PowerShell 展开 `$`），里面别用双引号；
- 一旦脚本超过两三行、或要用 `$(...)`、括号、heredoc，就**用 base64 传**：

```powershell
$s = @'
set -euo pipefail
cd ~/Documents/work/dw/douwan-api
go test ./...
'@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))
ssh qq "echo $b | base64 -d | bash"
```

- **不要**把输出接到 `| tail` / `| head`（本机 PATH 里是 Git 自带的 tail，管道会炸：
  `fatal error - couldn't create signal pipe`）。要截取就用 `$out | Select-Object -Last 40`。
