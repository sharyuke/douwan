# 主机与环境

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §1。

## 1. 主机与环境

| 别名 | 地址 | 身份 | 用途 |
| --- | --- | --- | --- |
| `home` | 192.168.1.135（sy-home，Ubuntu） | sharyuke | **旧开发机 / 备份**：日常不用，只在需要找回历史代码时登录 |
| `qq` | 47.103.213.224（qq，Ubuntu 24.04.2，2C/1.6G/40G） | root | **线上**：dw.sharyuke.com（nginx + douwan-api + PostgreSQL） |
| `pro` | 192.168.1.185 | root | 旧的线上机（`/var/www/douzao`，pindoudou 老版本部署在这，仍可访问） |
| `pro1` / `nb` / `dev` | rt.yuke.ink:2222 / 192.168.1.205 / 192.168.1.173 | — | 其他备用机（本机与 home 都能免密登录） |
| `dk` / `dt` / `ts` / `uc` / `lt` | 各家云 | root | 其他云主机（本机 known_hosts 里没有这些主机，直接 ssh 会 host key 报错） |

**本机工具链**：Node v24.21.0、pnpm 11.17.0、Go 1.26.0，全部在 `tools\` 下，详见 §0。
本机与 qq 都能免密 ssh；home 仍可 ssh，但不再用于开发。
