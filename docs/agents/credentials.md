# 凭据放在哪

> 从原 AGENTS.md 拆出。不会自动载入。旧笔记里的节号见仓库根目录 AGENTS.md 的对照表。 这是原 §3。这里没有可用的令牌明文。不要把令牌写回仓库或贴到对话里。

## 3. 凭据（**不要提交进任何仓库、不要贴到公开地方**）

| 用途 | 值 / 位置 |
| --- | --- |
| **Gitee maryuke 私人令牌**（建仓 + 推送 douwan-api） | 不写在本文件里（本仓是公开仓，令牌不能进公开仓库）——新令牌放本机 `~/.gitee` 或 Gitee 账号设置页；2026-10-24 之前那枚曾写在本文件里，**已在 Gitee 上作废，请重新生成并吊销旧的** |
| Gitee sharyuke 令牌（另一个账号，建过 notes/ssh 等仓库） | home 的 `~/.gitee`（`{"token":"998b...","username":"sharyuke"}`）；`~/.netrc` 里也是 sharyuke |
| pindoudou 仓库密码 | 内嵌在本机 `pindoudou/.git/config` 的 remote URL 里 |
| 线上数据库密码 / JWT 密钥 | **只在 qq 的 `/etc/douwan/api.env`**（600，root）；部署文档里有读取与更换方法 |
| 服务器登录 | 全部走 ssh 公钥，本机与 home 都已能免密 `ssh qq` / `ssh pro` / `ssh home` |

Gitee API 备忘（v5，认证只能传 `access_token`，**传账号密码会 401**；推送才能用密码当口令）：

```bash
# 当前令牌身份
curl -s "https://gitee.com/api/v5/user?access_token=$T"
# 建仓（name 必须 ≤ 仓库名规则；private=true 私有；auto_init=false 不初始化）
curl -s -X POST "https://gitee.com/api/v5/user/repos" -d "access_token=$T" -d "name=douwan-api" -d "private=true" -d "auto_init=false"
# 删仓
curl -s -X DELETE "https://gitee.com/api/v5/repos/maryuke/douwan-api?access_token=$T"
```

> Gitee **不支持 push 建仓**（推不存在的仓库只会 404），必须先用 API 或网页建好空仓库。
