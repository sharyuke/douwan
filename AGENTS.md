# 豆玩 DOUWAN 工作区

本文件每次对话都会整份载入。细节在 `docs/agents/`，按下面的表打开**一个**文件，不要把那个目录通读。

2026-10-18 起在本机 Windows 开发。源码、Node、pnpm、Go 都在本机；构建和测试在本地做，产物 `scp` 到 **qq** 上线。home（192.168.1.135）只留作旧开发机、备份，以及本机 WDAC 拦住 Go 测试时的编译机。

```
本机 C:\Users\sharyuke\Documents\work\douwan\
├── pindoudou/     前端 Vue 3 + Vite 6     https://dw.sharyuke.com
├── douwan-api/    后端 Go + Gin + GORM
└── tools/         Node 24.21.0 / pnpm 11.17.0 / Go 1.26.0
git push → gitee.com/sharyuke/douwan （分支 main）
线上 qq 47.103.213.224
```

标准动作：本机改代码 → `pnpm build` 或 `go test ./...` → `scp` 到 qq → 重启 → 公网验证 → 只提交自己改的路径。

## 始终遵守

- 这一个仓库。不要在 `pindoudou/` 或 `douwan-api/` 里 `git init`，也不要再推 `gitee.com/maryuke/pindoudou` 或 `gitee.com/maryuke/douwan-api`。
- 可能有另一个会话在改同一份工作区。只 `git add` 自己的路径，不要 `git add -A`。隔离用 `git worktree`。
- 不要提交 `node_modules/`、`dist/`、`douwan-api/bin/`、`tools/` 里的 Node / Go / pnpm 缓存、`.tmp/`、`.mirror/`、`tools/preview/www/`、`.env`、密钥。
- pnpm 必须 hoisted（`npm_config_node_linker=hoisted`）。isolated 布局会让 `vite build` 报找不到 `picomatch`。
- 打包用 `C:\Windows\System32\tar.exe`。PATH 上的 `tar` 是 Git 的，会把 `C:\...` 当成远程主机。
- 前端发布三步：`vite build` → `node scripts/build-seo-pages.mjs` → 打包 `dist`。`vite build` 会清空 `dist/`，少中间那步，线上 `/create` 和 `/editor` 会 404。
- 给用户看页面只用 `tools/preview`（端口 **5180**）。服务器已在听就不要再开、不要重启。不要跑 `pnpm dev`、`pnpm preview`，也不要占 4173 / 4319 / 4320。
- 凭据不进仓库、不贴到对话里。线上数据库密码和 JWT 只在 qq 的 `/etc/douwan/api.env`。
- 新的上线记录写进 `docs/agents/log/` 的新文件，并在 `docs/agents/log/INDEX.md` 加一行。不要写回本文件。

## 按需打开

| 要做的事 | 文件 |
| --- | --- |
| 本地预览、5180 | [docs/agents/preview.md](docs/agents/preview.md) |
| 本机 Node / pnpm / Go、PATH | [docs/agents/toolchain.md](docs/agents/toolchain.md) |
| PowerShell 调 ssh | [docs/agents/ssh.md](docs/agents/ssh.md) |
| 主机别名 | [docs/agents/hosts.md](docs/agents/hosts.md) |
| 开发机和上线的关系 | [docs/agents/workflow.md](docs/agents/workflow.md) |
| 改前端 `pindoudou` | [docs/agents/frontend.md](docs/agents/frontend.md) |
| 改后端 `douwan-api` | [docs/agents/backend.md](docs/agents/backend.md) |
| 凭据放哪 | [docs/agents/credentials.md](docs/agents/credentials.md) |
| 发布到 qq | [docs/agents/deploy.md](docs/agents/deploy.md)，步骤以 [DEPLOY.md](DEPLOY.md) 为准 |
| 还没做的事 | [docs/agents/backlog.md](docs/agents/backlog.md) |
| 某次上线怎么做的、回滚包、提交号 | 先看 [docs/agents/log/INDEX.md](docs/agents/log/INDEX.md)（写到 2026-11-01）。更早的长记录看 [docs/agents/history/INDEX.md](docs/agents/history/INDEX.md)（写到 2026-10-29）。只打开标题对得上的一篇 |

旧笔记里的「AGENTS.md §0」= workflow + preview + toolchain + ssh，「§1」= hosts，「§2.1」= frontend，「§2.2」= backend，「§3」= credentials，「§4」= deploy，「§5 待办」= backlog。

提交：

```powershell
cd C:\Users\sharyuke\Documents\work\douwan
git add <只加自己改的路径>
git commit -m "feat: ..."
git push gitee main
```
