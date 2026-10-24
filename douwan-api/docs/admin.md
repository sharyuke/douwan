# 后台管理系统交付说明

> 对应需求文档：《豆玩后台管理系统需求文档（DeepSeek 执行版）》V1.0
> 交付日期：2026-10-15
> 线上地址：<https://dw.sharyuke.com/#/admin>

本文件说明**新增了什么、怎么用、还没做什么**。接口细节见 [`docs/api.md`](api.md)，
部署步骤见仓库上级目录的 `DEPLOY.md`。

---

## 1. 项目现状勘察（需求 §17 第 1 步）

| 项目 | 现状 | 本次是否改动 |
| --- | --- | --- |
| 前端框架 | Vue 3.5 + Vite 6 + vue-router 4（hash 路由），纯 SPA | 复用，新增后台页面 |
| 后端框架 | Go 1.26 + Gin + GORM | 复用，新增业务模块 |
| 数据库 | PostgreSQL 16（线上）/ SQLite 内存库（测试） | 新增 10 张表 |
| 登录鉴权 | 已有前台用户 JWT（access + refresh 轮换）；**没有后台鉴权** | 新增独立的 `admins` 表与后台令牌 |
| 文件存储 | **没有**（前端图片全在浏览器本地） | 新增本地磁盘存储 + 缩略图生成 |
| 用户体系 | `users` / `memberships` / `credit_accounts` 等 12 张表已建但为空 | 复用，权益发放同步写 `memberships` |
| 素材库 | 前端内置 `src/data/assets.js`（矢量 SVG，脚本生成） | **不改动**，另建上传型素材表（见 §6 的说明） |

差距清单与实施顺序完全按需求 §17 的建议推进：先数据结构与接口 → 后台框架 →
卡密闭环 → 素材闭环 → 订单与发卡 → 逐项验收。

---

## 2. 新增的数据表（10 张，自动迁移）

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `admins` | 后台管理员，与前台 `users` 分表 | `username` 唯一；角色 `super_admin` / `operator` / `viewer` |
| `plans` | 套餐（价格与权益全部可配置） | `code` 唯一；软删除 |
| `card_keys` | 卡密 | `code_hash` 唯一（HMAC-SHA256）；`code_prefix` 索引（搜索用） |
| `orders` | 订单 | `order_no` 唯一；`fulfillment_key` **部分**唯一索引（排除 NULL/空串） |
| `order_events` | 订单状态变化记录 | — |
| `entitlements` | 用户权益流水 | — |
| `library_assets` | 后台上传的素材 | `slug` 唯一 |
| `library_categories` | 素材分类 | `slug` 唯一 |
| `operation_logs` | 关键操作日志 | — |
| `settings` | 系统设置（键值表） | `key` 唯一 |

迁移命令：`bin/migrate -config /etc/douwan/config.yaml`（幂等，可重复执行）。
线上已从 12 张表迁移到 22 张。

> 之后新增「用户活跃数据监控」时又加了 2 张日汇总表
> （`user_daily_activities`、`user_feature_daily`），并给 `users` 加了
> `last_active_at` / `channel` / `channel_detail` 三个字段，详见 [activity.md](activity.md)。

---

## 3. 后台功能一览

左侧 7 个主入口（需求 §2），次级功能用页内标签页承载：

| 菜单 | 能做什么 |
| --- | --- |
| **数据概览** | 8 张数字卡片、最近订单/兑换/素材、支付接入状态说明 |
| **套餐管理** | 新建/编辑/复制/上下架/删除、前台预览、初始化占位草稿 |
| **卡密管理** | 批量生成、按 8 个维度筛选、批次汇总、查看明文、导出 CSV、批量作废 |
| **订单管理** | 筛选、详情（含快照 + 状态变化 + 关联卡密）、人工确认收款、发卡、关闭、标记退款 |
| **素材库** | 拖拽批量上传（进度 + 预览）、编辑、上下架、删除归档、分类管理、批量排序 |
| **用户与兑换记录** | 用户列表与详情、兑换记录、手动发放权益、撤销权益 |
| **系统设置** | 分组的设置项（网站信息、上传限制、卡密规则、支付配置、AI 告警预留） |
| **操作日志** | 关键动作留痕（另有「管理员」页，仅超级管理员可见） |

> 后续新增（后端接口已就绪，后台页面待前端排期）：**用户活跃数据监控**——
> 日活/周活/月活、留存、使用频率、地区、功能热度、来源渠道，
> 见 [activity.md](activity.md) 与 api.md 的「用户活跃数据监控」一节，
> 权限点 `activity.view`（运营与只读角色默认可看）。

登录入口：`/#/admin`（独立路由，未登录会跳到 `/#/admin/login`）。

---

## 4. 首个管理员怎么创建（需求 §3.1）

后台**不提供注册入口**，首个管理员由命令行初始化，密码只走环境变量：

```bash
# 只补齐草稿套餐与系统设置（幂等）
./bin/seed -config /etc/douwan/config.yaml

# 建一个超级管理员（密码不要写在命令行参数里，会进 shell 历史）
DOUWAN_SEED_ADMIN_PASSWORD='一个至少10位的强密码' \
DOUWAN_SEED_ADMIN_NICKNAME='豆玩管理员' \
  ./bin/seed -config /etc/douwan/config.yaml -admin douwan
```

`cmd/seed` 是**幂等**的：

- 管理员已存在时只报告、**不会改密码**（刻意不提供「重置已有管理员密码」，
  否则拿到服务器的人就能通过它改后台密码）；
- 草稿套餐与系统设置只补缺失的，不会覆盖管理员改过的值。

忘记密码时用后台「管理员 → 重置密码」，或删掉账号后重新 seed。

---

## 5. 必须配置的环境变量（需求 §9：密钥不进仓库）

| 变量 | 是否必填 | 说明 |
| --- | --- | --- |
| `DOUWAN_ADMIN_CARD_CIPHER_KEY` | **生产必填** | 卡密明文的 AES-256-GCM 密钥，同时用作哈希 pepper。没有它服务拒绝启动（生产）；缺失时列表只能看脱敏卡密。**更换它会让已发出的卡密无法解密、也无法再兑换**。 |
| `DOUWAN_DATABASE_PASSWORD` | 必填 | 数据库密码（已有） |
| `DOUWAN_JWT_SECRET` | 必填 | JWT 密钥（已有） |
| `DOUWAN_STORAGE_UPLOAD_DIR` | 建议 | 上传目录，默认 `./data/uploads`；**必须持久化** |
| `DOUWAN_ADMIN_MAX_GENERATE_PER_REQUEST` | 可选 | 单次生成卡密上限，默认 1000 |
| `DOUWAN_ADMIN_CARD_REDEEM_PER_MINUTE` | 可选 | 同一 IP 每分钟兑换尝试次数，默认 10 |

生成密钥：`openssl rand -base64 48`。

---

## 6. 关于素材库的一个重要设计决定

需求 §8 要的是「管理员自己上传图片素材」。项目里**已经有一张 `assets` 表**，
但它存的是前端 `src/data/assets.js` 那批内置矢量素材（字段是 `svg` / `cols` / `tier`，
由脚本导入）。两者形态不同：

- 内置素材：矢量 SVG、由 `scripts/build-assets.cjs` 生成、没有「原图/缩略图/分类/上传人」概念；
- 后台素材：真实位图文件、有原图与缩略图、要按分类与标签管理、要有发布状态。

因此**新建 `library_assets` / `library_categories` 两张表**，没有改造旧表：
旧表的 `svg` 字段是 `not null`，塞位图要么改列约束影响历史数据，要么写假的 SVG 占位，
两条路都更容易出问题。旧的 `assets` 表保持原样，留给将来的导入脚本。

---

## 7. 关键业务保证（需求 §13，每条都有测试）

| 规则 | 实现方式 | 测试 |
| --- | --- | --- |
| 卡密只能兑换一次 | 条件更新原子占位（`status = unused AND 未过期`）+ 检查影响行数；状态变更与权益创建在同一事务 | `TestConcurrentRedeem_OnlyOneWins`（6 并发只 1 成功）、`TestCardKey_RedeemOnce` |
| 同一订单只发一次卡 | 条件更新认领（`pending → issued`）+ 同事务关联卡密与发放权益；库存不足整笔回滚可重试 | `TestConcurrentIssue_OnlyOneOrderIssues`（4 并发只 1 成功） |
| 未支付订单不能发卡 | 服务层校验 + 条件更新 | `TestOrder_ManualSettleAndIssueOnce`、PG 冒烟 |
| 历史订单不被改价影响 | 下单时保存 `plan_snapshot`（名称/价格/权益） | `TestOrder_ManualSettleAndIssueOnce`、PG 冒烟 |
| 已产生订单/卡密的套餐不能删 | `PlanRepository.Usage` 统计后拒绝，提示改为下架 | 线上 E2E |
| 已发布素材必须先下架才能删 | 服务层校验（40019） | `TestAssetUploadAndPublish` |
| 有素材引用的分类不能删 | 统计后拒绝（40021），引导迁移或停用 | `TestCategoryInUseCannotDelete` |
| 上架套餐必须经服务端校验 | `validatePublishable`（名称/价格/额度/有效期/发卡数量） | `TestPlanLifecycle_PublishRequiresValidation` |
| 后台权限服务端判定 | 每个写接口挂 `RequirePermission` / `RequireSuper` | `TestAdminEndpoints_RequireAdminToken`、`TestOperatorPermissions` |
| 同一秒内可连续下单 | 订单号 8 位随机十六进制 + 冲突重试；`fulfillment_key` 用部分唯一索引 | `TestOrderNo_UniqueWithinSameSecond`、`TestSequentialOrders_SecondOrderSucceeds` |
| 卡密明文受控访问 | 默认脱敏；查看/导出需要 `card.reveal` / `card.export`，每次都写日志 | `TestCardKey_RevealAndExport` |
| 上传按内容校验 | 前 512 字节嗅探真实类型、拒绝 SVG、限制大小与像素总量、服务端重命名 | `internal/storage` 全部用例 |
| 关键操作有日志 | 33 种动作统一走 `AuditLog`，含操作人/IP/request_id | 线上 E2E 逐项断言 |
| 日志不含敏感值 | 卡密只记脱敏串，密码/密钥从不进日志 | `TestAdminLoginWritesLog`、线上 E2E |

---

## 8. 交付过程中发现并修掉的真实缺陷

这些不是「顺手重构」，都是**在真实数据库 / 真实浏览器 / 线上环境上验证时暴露出来的**
问题，全都有对应的回归测试：

| 问题 | 现象 | 根因 | 回归测试 |
| --- | --- | --- | --- |
| `server.New` 忘了传 `Storage` | 后台点「上传素材」返回 **404 接口不存在**，很像功能没做 | 路由装配漏了一个依赖字段 | `TestStorageNotConfigured` |
| `settings` 按 `group` 排序 | PostgreSQL 报 `syntax error at or near "group"`，接口静默返回空列表 | `group` 是保留字，反引号只在 MySQL/SQLite 有效 | PG 冒烟测试 |
| jsonb 字段走 `Updates(map)` | 编辑套餐报 `unsupported type model.BenefitConfig, a struct` | GORM 序列化器只在 Create / Updates(结构体) 生效 | PG 冒烟测试 |
| jsonb 字段直接用 `LIKE` | 按标签筛选素材报 `operator does not exist: jsonb ~~ unknown` | jsonb 不能直接做文本匹配，要 `CAST(... AS TEXT)` | PG 冒烟测试 |
| `orders.fulfillment_key` 全表唯一索引 | **第二笔订单必然失败**，错误却说「订单号重复」 | 新建订单该字段是空串，空串之间互相撞唯一索引 | `TestSequentialOrders_SecondOrderSucceeds` |
| 订单号随机部分只有 4 个十六进制字符 | 同一秒内下单有 1/65536 概率撞车 | 随机字节数不足 | `TestOrderNo_UniqueWithinSameSecond` |
| `storage.go` 漏 import `image/png` | **所有 PNG 上传都失败**，JPEG 正常 | 解码器要靠空白 import 注册到 `image.DecodeConfig` | `TestImageSize_AllSupportedFormats` |
| 素材 slug 由中文标题生成 | 同名标题第二次上传报 500 | 「E2E 素材」只保留 ASCII 后变成 `e2e`，必然重复 | `TestUploadSameTitleTwice` |
| `/permissions` 没挂 `OptionalAuth` | 登录用户拿到的永远是免费版矩阵，前台按钮一直不解锁 | 路由少了中间件 | `TestPermissionsMatrix_ReflectsEntitlements` |
| 卡密搜索匹配不上 | 复制卡密前几位（不带连字符）搜不到 | 脱敏串里插了连字符 | 线上 E2E |

---

## 9. 怎么跑测试

```bash
# 后端单元测试（SQLite 内存库，不需要起数据库）
go test ./...

# 后端 PostgreSQL 冒烟测试（需要真实 PG，覆盖 jsonb / 部分唯一索引 / 聚合查询）
docker run -d --name dw-pgtest -e POSTGRES_USER=douwan -e POSTGRES_PASSWORD=douwan \
  -e POSTGRES_DB=douwan -p 55432:5432 postgres:16-alpine
DOUWAN_TEST_POSTGRES_DSN='host=127.0.0.1 port=55432 user=douwan password=douwan dbname=douwan sslmode=disable' \
  go test ./internal/handler/ -run TestPostgres_Smoke -v

# 前端构建
corepack pnpm build
```

线上端到端自测（87 项验收断言，覆盖需求 §16 的清单）与界面自检脚本在控制端工作区：

- `tools/e2e-admin.sh` —— 真实 HTTPS 接口逐项打，含并发/幂等/越权/脱敏断言；
  跑完请用 `tools/cleanup-e2e.sh` 清掉测试数据。
- `pindoudou/scripts/admin-audit.cjs` —— 无头 Chrome 把后台 9 个页面在桌面与手机
  两个视口各渲染一遍，检查白屏 / console 报错 / 横向溢出，并输出截图。

---

## 10. 本次未做（需求 §18 明确留待业务决策）

这些都是**故意没做**的，不是遗漏：

1. **真实支付渠道接入**：订单表只有通用字段，`payment_method` 留了 `wechat` / `alipay`
   的位置；当前只能「人工确认收款 → 发卡」。系统不会假装退款成功。
2. **邮件 / 短信自动发卡**：没有可用的发送服务，卡密改为在「我的订单」与兑换结果里展示。
3. **具体价格与权益数值**：代码里没有任何定价常量，4 个草稿套餐（套餐方案 A/B/C/其他）
   只是占位，名称与价格都等运营填写。
4. **AI 调用额度与成本统计**：设置页只预留了开关与阈值，因为系统还没有成本数据，
   不编造数字。
5. **Redis**：刷新令牌仍在进程内存，重启服务需要重新登录（与交付前一致）。
6. **多角色细分、复杂报表、优惠券/分销/会员等级**：需求 §1.3 明确不在本期范围。

## 11. 待确认项（需要业务方给结论）

1. 各套餐的**最终名称与售价**（后台已可配置，不需要改代码）。
2. 每种套餐包含的**权益组合**（后台「功能权限」里的 18 个权限点已可勾选/填数值）。
3. **支付渠道**选定后，需要提供：服务商、签名密钥、回调地址；
   服务端已把「标记已支付 + 发卡」抽象成可复用方法，接渠道时只需要写回调适配层。
4. 卡密是**站内展示**还是**邮件/短信发送**（后者需要先有发送服务）。
5. 时长类权益的起算时点：当前默认「兑换时起算」，后台可配置为付款/发放时起算，
   但后两者需要在接入真实支付后才有实际区别。
6. AI 功能失败时是否退还额度（当前没有额度消耗逻辑，因为还没接 AI 服务）。

---

## 12. 日常运维备忘

```bash
# 看后台相关日志
journalctl -u douwan-api -n 100 --no-pager | grep -e 请求处理失败 -e 卡密

# 上传目录（素材原图与缩略图）必须在备份范围内
du -sh /var/lib/douwan/uploads
# 备份时把它和数据库一起备：
sudo -u postgres pg_dump -Fc douwan > /root/douwan-$(date +%F).dump
tar -czf /root/douwan-uploads-$(date +%F).tar.gz /var/lib/douwan/uploads
```

**注意**：`/etc/douwan/api.env` 里的 `DOUWAN_ADMIN_CARD_CIPHER_KEY` 丢失后，
已发出的卡密将无法解密展示（哈希校验也会失效，即用户无法再兑换）。
请把它和数据库备份一起妥善保存。
