# 本地工具链

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §0「本地工具链」。

### 本地工具链（已装好，2026-10-18）

| 工具 | 路径 / 版本 | 说明 |
| --- | --- | --- |
| Node | `tools\node\node.exe` v24.21.0 | 官方 Windows zip，含 npm 11.19.0 |
| pnpm | `tools\npm-global\pnpm.cmd` 11.17.0 | 已加入用户 PATH |
| Go | `tools\go\bin\go.exe` 1.26.0 | 官方 Windows zip |
| 前端依赖 | `pindoudou\node_modules` | **必须是 hoisted 布局**（见下） |
| Go 缓存 | `tools\gopath` / `tools\go-cache` | 已设为用户环境变量 |

用户环境变量已持久化：`PNPM_HOME`、`npm_config_cache`、`npm_config_store_dir`、
`npm_config_node_linker=hoisted`、`GOPATH`、`GOMODCACHE`、`GOCACHE`、`GOTMPDIR`，
并把 `tools\node`、`tools\npm-global`、`tools\go\bin` 加进了用户 PATH；
另外 `C:\Users\sharyuke\.npmrc` 里固定了 `node-linker=hoisted`、`store-dir`、`cache-dir`。新开的终端直接可用；
如果当前会话读不到，就在命令前临时补：
`$env:Path = "C:\Users\sharyuke\Documents\work\douwan\tools\node;C:\Users\sharyuke\Documents\work\douwan\tools\npm-global;C:\Users\sharyuke\Documents\work\douwan\tools\go\bin;" + $env:Path`

> ⚠️ **pnpm 在 Windows 上必须用 hoisted 布局**：默认 isolated 布局会创建
> `\??\Global\C:\...` 形式的 junction，Node 24 的 ESM 解析器不认，`vite build` 会报
> `Cannot find package 'picomatch'`。已通过用户环境变量 `npm_config_node_linker=hoisted` 固定；
> 手动装依赖时也可显式加 `--config.node-linker=hoisted`。

```powershell
cd C:\Users\sharyuke\Documents\work\douwan\pindoudou
pnpm install --frozen-lockfile
pnpm build

cd ..\douwan-api
go vet ./...
go test ./...
go build -o bin\server.exe ./cmd/server
```
