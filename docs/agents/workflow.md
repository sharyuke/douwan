# 工作方式

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §0 开头。

## 0. 一句话说清工作方式

**2026-10-18 起，开发在本机 Windows 上做，日常不再使用 home。** 源码、Node、pnpm、Go 都在本机；
构建、测试、提交都在本地完成，产物用 `scp` 推到 **qq** 上线。home（192.168.1.135）只作为旧开发机和备份保留。

```
   本机 Windows（开发机 + 控制端）                         qq 47.103.213.224（线上）
   C:\Users\sharyuke\Documents\work\douwan\               nginx + douwan-api + PostgreSQL
   ├── pindoudou/    前端 Vue3+Vite6                       https://dw.sharyuke.com
   ├── douwan-api/   后端 Go+Gin+GORM
   └── tools/        node 24.21.0 / pnpm 11.17.0 / go 1.26.0
          │
          └── git push ──▶ gitee.com/sharyuke/douwan
```

**标准动作**：本机改代码 → 本地 `pnpm build` / `go test ./...` → `scp` 到 qq → 重启服务 → 公网验证 →
本地 `git commit && git push`。
