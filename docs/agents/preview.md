# 本地预览

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §0「本地预览」。

### 本地预览（所有 agent 共用这一台）

给用户看页面时，只使用 `tools/preview` 这一台静态服务器。先在自己的目录里构建出 `dist`，再整份复制到 `tools/preview/www`。服务器已经在听就不要再开，也不要重启：它每次请求都读 `www` 里的文件，覆盖后刷新即可。

| 项 | 值 |
| --- | --- |
| 静态目录 | `tools/preview/www` |
| 进程 | `tools/preview/server.mjs`，由 `start.ps1` 通过计划任务 `DouwanPreview` 拉起。端口已在听就不要再开 |
| 端口 | **5180**，监听 `0.0.0.0` |
| 本机 | http://127.0.0.1:5180/ |
| 局域网 | http://192.168.1.205:5180/ （网卡地址变了就换成本机当前 IPv4） |
| 接口 | `/api`、`/healthz`、`/readyz` 反代到 https://dw.sharyuke.com ，不用另起本地后端 |
| 版本 | 复制完成后看 http://127.0.0.1:5180/PREVIEW.txt （入口文件名、dist 路径、git 提交） |

```powershell
# 在要预览的那份前端目录里构建（主目录或隔离 worktree 都行）
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm build

# 复制 dist，并在 5180 没人听的时候把那一台服务器拉起来
powershell -ExecutionPolicy Bypass -File C:\Users\sharyuke\Documents\work\douwan\tools\preview\deploy.ps1 -Dist C:\Users\sharyuke\Documents\work\douwan\pindoudou\dist
```

隔离 worktree 的产物用同一个命令，把 `-Dist` 指到那份 `dist`。`-Build` 只适合主目录：它会在 `-Project` 里跑 `vite build` 和 `scripts/build-seo-pages.mjs`，再复制。

不要做这些事：

- 不要为了给用户看页面去跑 `pnpm dev`、`pnpm preview`、`node scripts/serve-dist.mjs`，也不要再占 4173 / 4319 / 4320。
- 不要把预览只绑在 `127.0.0.1`。这台机器的网卡是公用网络，防火墙默认拦截入站；`start.ps1` 会补一条名为 `douwan preview 5180` 的 TCP 入站允许。没这条规则时，本机能开、别的电脑打不开。
- 不要在 worktree 里对主目录的 `node_modules` 做联接后再跑 `pnpm install`。pnpm 会把主目录的依赖目录当成要清掉的那份。worktree 需要依赖时，在 worktree 里单独 `pnpm install --config.node-linker=hoisted`。
