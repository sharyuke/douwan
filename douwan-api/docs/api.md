# 接口文档

- 基础路径：`/api/v1`
- 请求与响应均为 JSON（`Content-Type: application/json`）
- 需要登录的接口带上 `Authorization: Bearer <access_token>`

## 统一响应体

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "request_id": "3f2a...c9"
}
```

`code` 是业务码，`0` 表示成功；HTTP 状态码表达传输层结果。前端判断 `code` 即可，
`request_id` 与响应头 `X-Request-ID` 一致，排查问题时可以拿它串日志。

### 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| 0 | 200 / 201 | 成功 |
| 10001 | 400 | 请求参数有误（`message` 里有具体是哪个字段） |
| 10002 | 400 | 缺少必要参数 |
| 10404 | 404 | 资源 / 接口不存在 |
| 10429 | 429 | 请求过于频繁 |
| 10500 | 500 | 服务器内部错误 |
| 20001 | 401 | 未登录 |
| 20002 | 401 | 访问令牌过期（前端应拿刷新令牌换新的） |
| 20003 | 401 | 访问令牌非法 / 刷新令牌已失效 |
| 20004 | 401 | 账号或密码不正确 |
| 20005 | 403 | 账号已被禁用 |
| 20403 | 403 | 没有操作权限（例如超出套餐配额） |
| 30001 | 404 | 用户不存在 |
| 30002 | 409 | 账号已被注册 |
| 40001 | 404 | 管理员不存在 |
| 40002 | 403 | 管理员账号已停用 |
| 40003 | 409 | 管理员账号已存在 |
| 40004 | 404 | 套餐不存在 |
| 40005 | 400 | 套餐配置不完整（例如次数类套餐没填额度） |
| 40006 | 409 | 套餐已被订单或卡密引用，不能删除 |
| 40007 | 409 | 套餐未上架，不能下单 |
| 40008 | 404 | 卡密不存在 |
| 40009 | 409 | 卡密已被兑换 |
| 40010 | 409 | 卡密已过期 |
| 40011 | 409 | 卡密已作废 |
| 40012 | 409 | 卡密当前状态不允许作废 |
| 40013 | 404 | 订单不存在 |
| 40014 | 409 | 订单当前状态不允许该操作 |
| 40015 | 409 | 订单未支付，不能发卡 |
| 40016 | 409 | 订单已关闭 |
| 40017 | 409 | 该订单已发放过卡密 |
| 40018 | 404 | 素材不存在 |
| 40019 | 409 | 素材仍在使用，需先下架 |
| 40020 | 404 | 素材分类不存在 |
| 40021 | 409 | 分类下仍有素材 |
| 40022 | 400 | 上传文件不符合要求（大小 / 类型 / 不是有效图片） |
| 40023 | 404 | 设置项不存在 |
| 40024 | 404 | 权益记录不存在 |
| 40025 | 409 | 卡密库存不足 |
| 40026 | 409 | 支付渠道尚未配置 |
| 40027 | 400 | 埋点事件里的功能标识不被支持 |

## 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 存活探针，只看进程 |
| GET | `/readyz` | 就绪探针，额外探一次数据库 |

## 账号与鉴权

### POST /api/v1/auth/register

注册并直接返回令牌对。会在同一事务里创建用户、免费套餐订阅、Credits 账户与使用统计。

请求：

```json
{
  "username": "douwaner",
  "password": "secret-pass-1",
  "nickname": "拼豆小工",
  "email": "user@douwan.test"
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `username` | 是 | 3~32 位，仅字母与数字 |
| `password` | 是 | 8~64 位 |
| `nickname` | 否 | ≤32 位，留空时取用户名 |
| `email` | 否 | 合法邮箱，≤128 位 |
| `phone` | 否 | ≤32 位 |

成功返回 `201`，`data` 为令牌对与用户资料（见下方「通用结构」）。

失败：`30002`（用户名 / 邮箱 / 手机号已被占用）、`10001`（参数不合法）。

### POST /api/v1/auth/login

`account` 可以是用户名、邮箱或手机号。

```json
{ "account": "douwaner", "password": "secret-pass-1" }
```

成功返回 `200`。密码错误与账号不存在都返回 `20004`，避免被用来枚举账号；
账号被禁用返回 `20005`。

### POST /api/v1/auth/refresh

用刷新令牌换新的令牌对。**刷新令牌会轮换**：旧的立即失效，重复使用返回 `20003`。

```json
{ "refresh_token": "..." }
```

### POST /api/v1/auth/logout

撤销刷新令牌。接口幂等：令牌不存在、不带 body 都返回成功。

```json
{ "refresh_token": "..." }
```

## 用户

### GET /api/v1/users/me

需要登录。返回账户页需要的聚合信息：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user": {
      "id": 1,
      "username": "douwaner",
      "email": "user@douwan.test",
      "phone": "",
      "nickname": "拼豆小工",
      "avatar_url": "",
      "status": 1,
      "last_login_at": "2026-10-15T09:12:00+08:00",
      "created_at": "2026-10-15T09:10:00+08:00"
    },
    "membership": { "plan": "free", "is_pro": false, "expire_at": null, "auto_renew": false },
    "credits": { "balance": 0 },
    "usage": { "generated": 0, "exported": 0, "ai_calls": 0 }
  }
}
```

### PATCH /api/v1/users/me

需要登录。只传要改的字段，未传的字段保持原值。

```json
{ "nickname": "新昵称", "avatar_url": "https://cdn.douwan.test/a.png" }
```

## 通用结构

### 令牌对（`data.tokens`）

```json
{
  "access_token": "eyJ...",
  "refresh_token": "8Kd...",
  "token_type": "Bearer",
  "expires_in": 7200,
  "expires_at": "2026-10-15T11:10:00+08:00"
}
```

`expires_in` 是访问令牌剩余秒数。前端建议在收到 `20002` 时用 `refresh_token` 换新的，
而不是自己算过期时间。

### 用户资料（`data.user`）

与 `GET /users/me` 里的 `user` 结构一致。密码哈希等敏感字段不出现在任何响应里。

## 前台业务接口

这些接口给 pindoudou 前台用。价格、权益、素材全部来自数据库，前台不写死任何商业规则。

### GET /api/v1/plans

前台可购买套餐。**只返回已上架（status = published）的套餐**，草稿与已下架一律不出现。

```json
{
  "code": 0,
  "data": [
    {
      "id": 3,
      "code": "pro_week",
      "name": "七天畅玩",
      "price": 19.9,
      "original_price": 29.9,
      "validity_type": "day",
      "validity_value": 7,
      "validity_text": "7 天",
      "feature_text": ["三方案自动搜索", "PDF 分板图纸"],
      "feature_permissions": { "export.pdf": true, "generate.variants": 3 },
      "benefit_type": "unlimited",
      "usage_limit": 0,
      "allow_repeat_purchase": false,
      "sort_order": 100
    }
  ]
}
```

### GET /api/v1/settings/public

前台可读的公开设置。密钥类配置永远不会出现在这里。

```json
{
  "site_name": "豆玩",
  "support_url": "",
  "support_text": "遇到问题可以在这里联系我们",
  "card_redeem_notice": "卡密仅能兑换一次，请在有效期内使用…",
  "max_upload_mb": 10,
  "payment_ready": false,
  "payment_notice": "支付渠道尚未配置，当前订单需要管理员人工确认收款后发放卡密。"
}
```

### GET /api/v1/assets

前台素材库。**只返回已发布（status = published）素材**。

查询参数：`keyword`、`category_id`、`category_slug`、`tag`、`featured`、`tier`、`sort`（`new` / `sort_order`）、`page`、`page_size`。

### GET /api/v1/assets/categories

前台素材分类（只返回已启用的分类，带素材数量）。

### GET /api/v1/assets/:slug

素材详情。未发布的素材对外一律返回 `40018`，避免通过猜 slug 看到草稿。

### POST /api/v1/card-keys/redeem

**需要登录**。卡密兑换，是整个系统最关键的写接口。

请求：

```json
{ "code": "ABCD-EFGH-JKLM-NOPQ" }
```

卡密大小写、空格、连字符都会被归一化处理，用户多打一个空格不会失败。

成功：

```json
{
  "plan_id": 3,
  "plan_name": "七天畅玩",
  "plan_code": "pro_week",
  "entitlement_id": 12,
  "starts_at": "2026-10-15T16:20:00+08:00",
  "expires_at": "2026-10-22T16:20:00+08:00",
  "usage_limit": null,
  "permissions": { "export.pdf": true, "generate.variants": 3 },
  "feature_text": ["三方案自动搜索", "PDF 分板图纸"],
  "message": "兑换成功！已开通「七天畅玩」，有效期至 2026-10-22 16:20。"
}
```

要点：

- 并发安全：卡密状态用「条件更新 + 检查影响行数」原子占位，两个请求同时兑换同一张卡密
  只有一个能成功（`internal/handler/concurrency_test.go` 里有对应测试）。
- 卡密状态变更与权益创建在同一个事务里，不会出现「卡密显示已兑换但用户没有权益」。
- 限流：同一 IP 默认每分钟 10 次（`admin.card_redeem_per_minute`），超出返回 `10429`。
- 失败原因用中文说清楚（已兑换 / 已过期 / 已作废），但不会泄露「这张卡密是否存在」
  以外的信息，避免被用来批量试探。

### POST /api/v1/orders（需要登录）

前台下单。套餐必须是已上架状态，否则返回 `40007`。

```json
{ "plan_id": 3, "quantity": 1 }
```

订单会保存套餐名、售价、权益快照，之后管理员改价或下架都不影响这张订单。

### GET /api/v1/orders（需要登录）

我的订单列表，只返回自己的订单。

### GET /api/v1/orders/:id（需要登录）

订单详情，含关联卡密（脱敏）与状态变化记录。只能查自己的订单。

### POST /api/v1/events

**需要登录**。客户端埋点上报：图纸生成 / 导出 / 抠图 / AI 出图这类只发生在浏览器里的行为，
服务端看不见，只能由前端上报。设计与口径见 [activity.md](activity.md)。

```json
{
  "events": [
    { "feature": "pattern.generate", "count": 1 },
    { "feature": "pattern.export", "count": 2, "at": "2026-10-15T14:20:00+08:00" }
  ]
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `events` | 是 | 1~50 条 |
| `events[].feature` | 是 | 必须在**客户端可上报**的功能点白名单里（见下表） |
| `events[].count` | 否 | 1~100，缺省 1 |
| `events[].at` | 否 | 事件发生时间，缺省为服务端当前时间；超前或超过 7 天的会被收敛成当前时间 |

成功返回 `200`：

```json
{
  "enabled": true,
  "accepted": 2,
  "hits": 3,
  "dropped": 0,
  "rejected": [],
  "message": ""
}
```

规则：

- 服务端能自己统计的功能点（例如 `account.login`）**不接受上报**，传了会被放进 `rejected` 并说明原因；
  全部事件都被拒时返回业务码 `40027`（前端联调阶段能立刻发现写错了键），部分被拒时按成功返回。
- 同一 IP 默认每分钟 120 次（`activity.event_report_per_minute`），超出返回 `10429`。
- 采集关闭（`activity.enabled=false`）时返回 `200` 且 `enabled=false`、`accepted=0`，
  并在 `message` 里说明数据被忽略——**不报错**，避免前端因为后台配置而崩掉。

### POST /api/v1/visits

**不需要登录**（未登录访客也算访问量）。页面访问上报：前台路由切换时由浏览器上报一条，
服务端只做校验、去抖与聚合。口径与表结构见 [activity.md](activity.md) 的「站点访问量」一节。

为什么必须由客户端上报：前台是 hash 路由的 SPA，首页之后的所有页面切换
（`#/editor`、`#/library/xxx`）都不会产生 HTTP 请求，服务端在接口层看不见。

```json
{
  "visitor": "0a50c79e09cc20cab2236e6ad4958d72",
  "path": "/library/:slug",
  "referrer": "https://tieba.baidu.com/p/123",
  "channel": ""
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `visitor` | 否 | 浏览器本地生成的 32 位十六进制访客标识；缺失或格式不对时服务端生成一个并在响应里返回，前端应存下来（否则每次访问都算新访客） |
| `path` | 是 | 路由**模板**（`/library/:slug`），不是完整 URL；查询串 / 哈希会被砍掉，非法字符整条归到 `/other` |
| `referrer` | 否 | 来源页地址，留空时服务端退回请求头的 `Referer` |
| `channel` | 否 | 落地页带来的渠道标识（`?from=` / `?utm_source=`），优先级高于 referrer |
| `at` | 否 | 页面打开时间；超前或超过 6 小时的会被收敛成当前时间 |

成功返回 `200`：

```json
{
  "enabled": true,
  "accepted": true,
  "visitor": "0a50c79e09cc20cab2236e6ad4958d72",
  "path": "/library/:slug",
  "message": ""
}
```

规则：

- `accepted=false` 表示这次上报**没有计入**（同一个访客在同一个页面 2 秒内的重复上报会被去抖、
  缓冲已满、或采集关闭），`message` 会说明原因——不静默丢弃。
- 同一 IP 默认每分钟 240 次（`activity.visit_report_per_minute`），超出返回 `10429`。
- 采集关闭（`activity.enabled=false`）时返回 `200` 且 `enabled=false`、`accepted=false`，不报错。
- 带上 `Authorization` 时会把这次访问关联到登录用户（后台据此区分登录 / 匿名访客），
  令牌非法按匿名处理，**不会**因为令牌问题拒绝上报。


客户端可上报的功能点：

| 功能点 | 含义 |
| --- | --- |
| `editor.open` | 打开编辑器 |
| `pattern.generate` | 生成图纸 |
| `pattern.export` | 导出图纸 |
| `pattern.matte` | 自动抠图 |
| `pattern.save` | 保存作品 |
| `inventory.manage` | 库存管理 |
| `ai.text` | AI 文本出图 |
| `ai.variants` | AI 配色变体 |
| `ai.batch` | AI 批量出图 |

## 后台管理接口

统一前缀 `/api/v1/admin`，全部需要管理员令牌。
**每个写接口都在服务端按角色权限校验**，前端隐藏按钮不构成权限。

### 鉴权

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/admin/auth/login` | — | 后台登录，限流 10 次/分钟 |
| POST | `/admin/auth/refresh` | — | 刷新令牌（会轮换） |
| POST | `/admin/auth/logout` | 登录即可 | 退出登录 |
| GET | `/admin/auth/me` | 登录即可 | 当前管理员资料 + 权限点清单 |
| POST | `/admin/auth/password` | 登录即可 | 修改自己的密码 |
| GET | `/admin/permissions` | 登录即可 | 角色、可配置功能权限点、日志动作字典 |

```json
// POST /admin/auth/login
{ "account": "douwan", "password": "..." }
// → data.admin（含 permissions 数组）+ data.tokens
```

### 数据概览

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/overview` | `overview.view` |

返回卡片数字、最近订单 / 兑换 / 素材，以及支付接入状态。
**未接入支付渠道时 `payment.channel_configured` 为 false，并给出明确说明，不会伪造收入**；
`total_paid_amount` 只统计 `payment_status = paid` 的订单，退款金额单独放在
`total_refund_amount`，`net_paid_amount = 已支付 − 已退款`。

### 用户活跃数据监控

四个维度：**使用频率、地区、功能使用、来源渠道**。完整设计与口径见 [activity.md](activity.md)。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/activity/overview` | `activity.view` | 日活 / 周活 / 月活 / 粘性 + 活跃与新增趋势 |
| GET | `/admin/activity/retention` | `activity.view` | 按注册日队列的次日 / 3 日 / 7 日留存 |
| GET | `/admin/activity/frequency` | `activity.view` | 活跃天数分布 + 最活跃用户 |
| GET | `/admin/activity/regions` | `activity.view` | 省 / 市 / 运营商分布 |
| GET | `/admin/activity/features` | `activity.view` | 功能使用排行（接口统计与客户端上报分开） |
| GET | `/admin/activity/channels` | `activity.view` | 渠道新增 / 活跃 / 付费质量 |
| GET | `/admin/activity/users` | `activity.view` | 活跃用户列表 |
| GET | `/admin/activity/users/:id` | `activity.view` | 单个用户的逐日活跃与功能明细 |
| GET | `/admin/activity/traffic` | `activity.view` | 站点访问量 PV / UV + 页面排行 + 落地页 + 来源 |
| GET | `/admin/activity/traffic/visitors` | `activity.view` | 访客明细（可按页面 / 渠道筛选） |

通用查询参数：

| 参数 | 适用 | 说明 |
| --- | --- | --- |
| `days` | 全部 | 统计窗口，最近 N 天（含今天），1~90，默认 30 |
| `limit` | regions / features | 返回条数，默认 20 / 30 |

#### GET /admin/activity/overview

```json
{
  "enabled": true,
  "window": { "days": 30, "from": "2026-09-16", "to": "2026-10-15" },
  "cards": {
    "day": "2026-10-15",
    "dau": 42, "dau_yesterday": 39, "dau_change_percent": 7.69,
    "wau": 118, "mau": 233, "stickiness": 18.03,
    "avg_dau": 35.4, "peak_dau": 61, "peak_dau_day": "2026-10-02",
    "active_users": 233, "new_users": 96, "requests": 5210, "features": 1893,
    "total_users": 480, "active_rate": 48.54,
    "today_active_users": 42, "today_new_users": 6, "today_requests": 180, "today_features": 66
  },
  "trend": [
    { "day": "2026-09-16", "active_users": 31, "new_users": 4, "requests": 150, "features": 52 }
  ],
  "freshness": {
    "flush_interval_seconds": 10, "buffered_buckets": 2, "buffered_hits": 7,
    "dropped_hits": 0, "last_flush_at": "2026-10-15T14:30:10+08:00",
    "last_error": "", "geo_enabled": true, "geo_note": ""
  },
  "notes": ["活跃口径：……"],
  "generated_at": "2026-10-15T14:30:12+08:00"
}
```

要点：

- **所有 `*_percent` / `*_rate` / `stickiness` 都是百分比**（0~100，两位小数）。
  粘性 = `dau / mau`，衡量「月活里有多少天天来」。
- `trend` 是**连续**的：没有数据的天补 0，前端可以直接画折线，不用自己补齐日期。
  `active_users` / `new_users` 是逐日数字，**不能相加当窗口去重活跃数**——
  窗口去重值看 `cards.active_users`。
- `dau_change_percent` 在昨天为 0 时返回 0（避免出现 +∞ 或虚假的 +100%）。
- `freshness` 是采集状态：活跃数据异步落库，最多滞后一个 `flush_interval`。
  `buffered_*` 是还在内存里的增量，`dropped_hits` 是缓冲溢出后丢弃的采样数（正常应为 0）。
- `enabled=false` 表示服务端没开采集（`activity.enabled=false`），此时数字全为 0，
  `notes` 里有说明；**历史数据仍然照常统计**，关掉采集不会把已有数据藏起来。

#### GET /admin/activity/retention

```json
{
  "window": { "days": 30, "from": "2026-09-16", "to": "2026-10-15" },
  "cohorts": [
    { "day": "2026-10-01", "new_users": 12,
      "d1_users": 5, "d1_rate": 41.67, "d3_users": 2, "d3_rate": 16.67, "d7_users": 1, "d7_rate": 8.33,
      "d1_eligible": true, "d3_eligible": true, "d7_eligible": true }
  ],
  "summary": { "cohort_users": 96, "d1_users": 33, "d1_rate": 34.38, "d3_users": 12, "d3_rate": 16.0,
               "d7_users": 4, "d7_rate": 6.9, "cohort_count": 30,
               "eligible_d1": 29, "eligible_d3": 27, "eligible_d7": 23 },
  "notes": ["留存口径：……"]
}
```

- 队列 = 某一天注册的全部新用户；第 0 天是注册当天。
- `*_eligible` 表示这个队列是否已经过完第 N 天。**没到就显示「—」，不要用 0 当结论**。
- `summary` 的比率只统计已过完对应天数的队列（3 日 / 7 日的分母与 1 日不同）。

#### GET /admin/activity/frequency

```json
{
  "window": { "days": 30, "from": "2026-09-16", "to": "2026-10-15" },
  "buckets": [
    { "label": "仅 1 天", "min_days": 1, "max_days": 1, "users": 41, "percent": 42.71 },
    { "label": "2~3 天", "min_days": 2, "max_days": 3, "users": 23, "percent": 23.96 }
  ],
  "active_users": 96, "avg_active_days": 4.21, "median_active_days": 2,
  "top_users": [ { "user_id": 12, "username": "douwaner", "active_days": 30 } ],
  "notes": []
}
```

分桶固定为「仅 1 天 / 2~3 天 / 4~7 天 / 8~14 天 / 15 天以上」，
`median_active_days` 是所在桶的左边界（桶内没有更细的分布，如实报下界）。
「仅 1 天」这一档最需要关注：拉新没留住。

#### GET /admin/activity/regions

```json
{
  "provinces": [ { "province": "广东省", "users": 21, "requests": 900, "percent": 21.88 } ],
  "cities":    [ { "province": "广东省", "city": "深圳市", "users": 12, "requests": 500, "percent": 12.5 } ],
  "isps":      [ { "isp": "电信", "users": 40, "requests": 1800, "percent": 41.67 } ],
  "active_users": 96, "unknown_users": 9, "geo_enabled": true, "notes": []
}
```

- `unknown_users` 是窗口内活跃但解析不出省份的用户数（IP 未收录、IPv6 未配置数据文件、内网地址等）。
  百分比的分母是 `active_users`，所以各省占比之和 + `unknown_users` 占比 = 100%。
- `geo_enabled=false` 时地区全落在「未知」，`notes` 里会写明原因（数据文件缺失等）。
- IP 在接口里一律脱敏（`203.0.113.*`），完整 IP 只存在库里用于地区统计。

#### GET /admin/activity/features

```json
{
  "items": [
    { "feature": "account.profile", "feature_label": "查看我的账户", "source": "api",
      "source_label": "接口统计", "users": 88, "count": 640, "percent": 33.81 },
    { "feature": "pattern.generate", "feature_label": "生成图纸", "source": "client",
      "source_label": "客户端上报", "users": 40, "count": 210, "percent": 11.09 }
  ],
  "notes": []
}
```

同一个功能点会**按来源拆成两行**：`api` 是服务端按接口自动统计的次数，
`client` 是前端通过 `POST /api/v1/events` 上报的次数。两者口径不同，不做合并。

#### GET /admin/activity/traffic

「访问量」标签页：PV / UV 指标卡 + 趋势 + 页面排行 + 新访客落地页 + 访客来源。
**包含未登录访客**，与上面「用户活跃」的口径不同（活跃只统计登录用户），两边数字不能互相加减。

```json
{
  "enabled": true,
  "window": { "days": 7, "from": "2026-10-10", "to": "2026-10-16" },
  "cards": {
    "day": "2026-10-16", "pv": 13, "uv": 3, "pv_per_uv": 4.33,
    "avg_daily_pv": 1.86, "avg_daily_uv": 0.43, "peak_uv": 2, "peak_uv_day": "2026-10-13",
    "new_visitors": 3, "returning_visitors": 0, "logged_visitors": 1, "anonymous_visitors": 2,
    "today_pv": 3, "today_uv": 2, "today_new_visitors": 1, "yesterday_pv": 2,
    "pv_change_percent": 50, "total_visitors": 4, "total_pv": 22
  },
  "trend": [ { "day": "2026-10-13", "pv": 8, "uv": 2, "new_visitors": 2 } ],
  "pages": [ { "path": "/", "pv": 6, "visitors": 3, "pv_per_visitor": 2, "percent": 46.15 } ],
  "landings": [ { "path": "/", "visitors": 2, "percent": 66.67 } ],
  "sources": [ { "channel": "gitee", "channel_label": "gitee", "visitors": 1, "pv": 6, "percent": 33.33 } ],
  "freshness": { "flush_interval_seconds": 10, "buffered_visits": 0, "buffered_visitors": 0, "dropped_visits": 0 },
  "notes": ["访问量（PV）= 页面被打开的次数；访客数（UV）= 去重后的访客标识数。……"],
  "generated_at": "2026-10-16T16:22:00+08:00"
}
```

- **PV 可以相加**（逐日 PV 之和 = 窗口 PV），**UV 不能相加**（同一个人可能来好几天），
  窗口去重值看 `cards.uv`。
- 访客 = 浏览器本地随机生成、localStorage 持久化的标识：清空浏览器数据 / 换设备 /
  无痕窗口都会算成新访客 —— **UV 不等于人数**。
- `logged_visitors` 是「窗口内带过登录态访问过」的访客数，`anonymous_visitors` = UV - 它，
  两者相加正好是 UV（互斥）。
- `pages` 按**路由模板**聚合（`/library/:slug` 下的所有详情页算一行）；
  `percent` 的分母是窗口内全部 PV。`limit`（默认 15）控制 `pages` / `landings` 的条数。
- `sources` 是访客的**首触渠道**（第一次来时的来源），份额按访客数算，不是 PV。
- `freshness` 里 `buffered_visits` / `dropped_visits` 是访问量那一套缓冲的状态，
  与活跃的 `buffered_hits` / `dropped_hits` 分开计。

#### GET /admin/activity/traffic/visitors

访客明细（分页），参数与其它列表接口一致：`days`、`page`、`page_size`。

| 参数 | 说明 |
| --- | --- |
| `channel` | 按首触渠道筛选；`unknown` / 空值表示只看未知来源，不传表示不筛选 |
| `path` | 只看访问过某个页面的访客（例如 `path=/editor`） |
| `sort` | `page_views`（默认，累计访问量）/ `last_seen` / `first_seen` |

```json
{
  "list": [
    { "visitor": "0a50c79e…", "user_id": 0, "username": "", "anonymous": true,
      "first_day": "2026-10-16", "last_day": "2026-10-16", "page_views": 4,
      "last_seen_at": "2026-10-16T16:20:46+08:00",
      "first_path": "/", "last_path": "/other",
      "channel": "tieba.baidu.com", "channel_label": "tieba.baidu.com",
      "province": "重庆市", "city": "", "region": "重庆市", "isp": "电信", "ip": "219.152.43.*" }
  ],
  "total": 3, "page": 1, "page_size": 20
}
```

- `page_views` 是**全时段累计**（不是窗口内），窗口筛选只决定「这个访客有没有出现」。
- `visitor` 与 `ip` 都由服务端脱敏后返回：访客标识只留前 8 位，IP 保留网段。
- `region` 是展示用的地名（省 市），境外访客带国家前缀。

#### GET /admin/activity/channels

```json
{
  "items": [
    { "channel": "gitee", "channel_label": "gitee", "new_users": 40, "total_users": 120,
      "active_users": 66, "active_rate": 55.0, "paid_users": 3, "paid_amount": 59.7 },
    { "channel": "", "channel_label": "未知来源", "new_users": 10, "total_users": 300,
      "active_users": 150, "active_rate": 50.0, "paid_users": 1, "paid_amount": 19.9 }
  ],
  "total_new_users": 96,
  "notes": []
}
```

- 渠道 = 注册时的**首次来源**（首触归因），之后不再改写；历史用户记为「未知来源」。
- `new_users` 是窗口内新增，`total_users` / `active_rate` 是全时段口径——
  用来判断某个渠道带来的量有没有留下来用。
- `paid_users` / `paid_amount` 只统计 `payment_status = paid` 的订单。

#### GET /admin/activity/users

| 参数 | 说明 |
| --- | --- |
| `days` | 窗口，默认 30 |
| `page` / `page_size` | 分页，默认 20，上限 200 |
| `keyword` | 匹配用户名 / 昵称 |
| `min_active_days` | 最少活跃天数。**传 1 就是「只看活跃用户」** |
| `channel` | 渠道筛选；`unknown` 或空值 = 只看未知来源，`direct` = 直访 |
| `province` | 省筛选（窗口内出现过该省） |
| `sort` | `active_days`（默认）/ `requests` / `features` / `last_active` / `newest` |

```json
{
  "list": [
    { "user_id": 12, "username": "douwaner", "nickname": "拼豆小工",
      "channel": "gitee", "channel_label": "gitee",
      "province": "广东省", "city": "深圳市", "region": "广东省 深圳市",
      "created_at": "2026-09-01T10:00:00+08:00", "last_active_at": "2026-10-15T00:00:00+08:00",
      "active_days": 22, "requests": 640, "features": 210, "last_ip": "203.0.113.*" }
  ],
  "total": 96, "page": 1, "page_size": 20
}
```

- 不传 `min_active_days` 时，窗口内**零活跃的沉默用户也会返回**（`active_days = 0`），
  用来排查「注册了但一次都没用过」的账号。
- `last_active_at` 在列表里精确到天（明细表才是权威）；IP 脱敏。

#### GET /admin/activity/users/:id

```json
{
  "window": { "days": 30, "from": "2026-09-16", "to": "2026-10-15" },
  "user": { "user_id": 12, "username": "douwaner", "active_days": 22 },
  "channel_detail": "https://gitee.com/maryuyuke/pindoudou",
  "first_active_day": "2026-09-16", "last_active_day": "2026-10-15",
  "total_active_days": 24, "total_requests": 700, "total_features": 230,
  "daily": [ { "day": "2026-10-15", "requests": 18, "features": 6,
               "first_active_at": "...", "last_active_at": "...",
               "province": "广东省", "city": "深圳市", "isp": "电信", "ip": "203.0.113.*" } ],
  "features": [ { "feature": "pattern.export", "feature_label": "导出图纸", "source": "client",
                  "source_label": "客户端上报", "users": 1, "count": 12, "percent": 5.2 } ],
  "regions": [ { "province": "广东省", "city": "深圳市", "isp": "电信", "users": 20, "percent": 90.9 } ],
  "notes": []
}
```

`total_*` 是全时段累计（不限窗口），`daily` / `features` / `regions` 是窗口内的明细。
用户存在但窗口内没有活跃记录时也能打开（各项为 0），不会 404。

### 套餐

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/plans` | `plan.manage` |
| GET | `/admin/plans/options` | `plan.manage` |
| GET | `/admin/plans/:id` | `plan.manage` |
| GET | `/admin/plans/:id/preview` | `plan.manage` |
| POST | `/admin/plans` | `plan.manage` |
| PUT | `/admin/plans/:id` | `plan.manage` |
| PATCH | `/admin/plans/:id/status` | `plan.manage` |
| POST | `/admin/plans/:id/duplicate` | `plan.manage` |
| DELETE | `/admin/plans/:id?reason=...` | `plan.manage` |
| POST | `/admin/plans/drafts` | `plan.manage` |

- 新建的套餐一律是**草稿**，不会直接上架。
- 上架时服务端会校验名称、价格、权益配置（例如次数类必须填额度）。
- 已有订单或卡密的套餐不能物理删除，只能下架（返回 `40006`）。
- `POST /admin/plans/drafts` 幂等地创建占位草稿套餐（套餐方案 A/B/C/其他）。

```json
// 新建 / 编辑套餐
{
  "code": "pro_week",
  "name": "七天畅玩",
  "short_desc": "7 天不限量",
  "price": 19.9,
  "original_price": 29.9,
  "benefit_config": {
    "kind": "unlimited",
    "usage_limit": 0,
    "validity_type": "day",
    "validity_value": 7,
    "start_on": "redeem",
    "stackable": false
  },
  "feature_permissions": { "export.pdf": true, "generate.variants": 3 },
  "feature_text": ["三方案自动搜索", "PDF 分板图纸"],
  "allow_repeat_purchase": false,
  "card_quantity": 1,
  "batch_size": 50,
  "sort_order": 100
}
```

`benefit_config.kind`：`unlimited`（不限量）/ `quota`（次数额度）/ `count`（图纸张数）。
`validity_type`：`none` / `hour` / `day` / `month`。

### 卡密

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/card-keys` | `card.view` |
| GET | `/admin/card-keys/meta` | `card.view` |
| GET | `/admin/card-keys/batches` | `card.view` |
| POST | `/admin/card-keys/generate` | `card.generate` |
| POST | `/admin/card-keys/reveal` | `card.reveal` |
| POST | `/admin/card-keys/void` | `card.revoke` |
| POST | `/admin/card-keys/export` | `card.export` |

- 列表默认返回**脱敏卡密**（`code_masked`）。只有拥有 `card.reveal` 权限的账号
  才会在列表里拿到 `code` 明文。
- 查看明文与导出（无论脱敏还是明文）都会写操作日志。
- 生成数量受 `admin.max_generate_per_request` 限制（默认 1000）。
- 卡密字符集剔除了 `0/O/1/I/L`，默认 16 位随机字符，格式化成 4 位一组。
- 作废只对「未使用」状态生效，已兑换的卡密不会被作废。

```json
// POST /admin/card-keys/generate
{
  "plan_id": 3,
  "count": 100,
  "batch_name": "首发测试批次",
  "note": "线下渠道",
  "redeem_expires_at": "2026-12-31T23:59:59+08:00"
}
// → data.codes 是明文卡密数组，只在这一次返回，请立刻导出保存
```

```json
// POST /admin/card-keys/export
{ "plan_id": 3, "status": "unused", "reveal": true, "limit": 10000 }
// → text/csv 下载（带 UTF-8 BOM，Excel 打开不乱码）
```

### 订单

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/orders` | `order.view` |
| GET | `/admin/orders/:id` | `order.view` |
| POST | `/admin/orders/:id/settle` | `order.settle` |
| POST | `/admin/orders/:id/issue` | `order.settle` |
| POST | `/admin/orders/:id/close` | `order.settle` |
| POST | `/admin/orders/:id/refund` | `order.refund` |

**人工确认收款**（未接入支付渠道时的唯一收款入口）：

```json
// POST /admin/orders/12/settle  备注必填
{
  "amount_paid": 19.9,
  "payment_method": "manual",
  "transaction_id": "微信转账单号可选",
  "note": "线下微信收款，客服已核对",
  "issue_cards": true
}
```

幂等保证：

- 只有「待支付」订单能确认收款，重复请求第二次返回 `40014`，不会重复记账。
- 发卡用「条件更新认领 + 同一事务内关联卡密 + 发放权益」，重复或并发调用只有一个成功，
  第二次返回 `40017`。卡密不足时整笔回滚并返回 `40025`，状态回到未发放，可安全重试。
- 未支付订单发卡返回 `40015`。
- 订单发卡时权益会**直接发给下单用户**（不必自己去兑换自己买的卡）。同一张卡密
  再由本人兑换会被拒绝并提示可以转赠给他人，避免双倍发放。

### 素材与分类

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/assets` | `asset.view` |
| GET | `/admin/assets/tags` | `asset.view` |
| GET | `/admin/assets/:id` | `asset.view` |
| POST | `/admin/assets/upload` | `asset.manage` |
| PATCH | `/admin/assets/:id` | `asset.manage` |
| PATCH | `/admin/assets/:id/status` | `asset.manage` |
| POST | `/admin/assets/sort` | `asset.manage` |
| DELETE | `/admin/assets/:id?reason=...` | `asset.manage` |
| GET | `/admin/asset-categories` | `asset.view` |
| GET | `/admin/asset-categories/options` | `asset.view` |
| POST | `/admin/asset-categories` | `asset.manage` |
| PUT | `/admin/asset-categories/:id` | `asset.manage` |
| DELETE | `/admin/asset-categories/:id` | `asset.manage` |

上传用 `multipart/form-data`：

| 字段 | 说明 |
| --- | --- |
| `files` | 图片文件，可重复（也接受 `file` / `images`），单次最多 50 张 |
| `title` | 素材名称（必填；留空时取原文件名） |
| `category_id` | 分类 ID（必填） |
| `tags` | 标签，JSON 数组或逗号分隔都行 |
| `description` / `is_featured` / `sort_order` / `status` / `tier` | 其余表单字段 |
| `source_note` / `rights_note` / `inner_note` | 来源与版权备注（可选） |

服务端校验（需求 §8.4）：

- 大小上限默认 10MB（`storage.max_upload_mb`，后台「系统设置」可改运行期值）。
- **按文件前 512 字节嗅探真实类型**，不信扩展名也不信客户端声明的 Content-Type；
  支持 JPG / PNG / WEBP / GIF，SVG 明确拒绝（它是 XML，可以内嵌脚本）。
- 解码图片拿真实宽高，分辨率超过 6000 万像素直接拒绝（防解压炸弹）。
- 文件名由服务端重新生成（时间戳 + 随机串），原文件名一律丢弃，避免路径注入与冲突。
- 上传后自动生成缩略图（长边 ≤ `storage.max_thumb_size`）；缩略图生成失败不阻断上传，
  回落成原图地址。

批量上传时某一张失败不会影响其它张，返回结构里带上每张的失败原因：

```json
{ "total": 3, "success": 2, "failed": 1, "items": [...], "errors": [{ "filename": "b.gif", "reason": "..." }] }
```

### 用户与兑换记录

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/users` | `user.view` |
| GET | `/admin/users/:id` | `user.view` |
| GET | `/admin/entitlements` | `entitlement.view` |
| POST | `/admin/entitlements` | `entitlement.grant` |
| POST | `/admin/entitlements/:id/revoke` | `entitlement.grant` |

- 用户列表里的邮箱与手机号是**脱敏**的（需求 §9：不要求管理员看到不必要的敏感信息），
  也不会返回密码哈希。
- 手动发放权益需要填备注，会记录管理员与时间。
- 撤销权益会把用户会员状态重算成「当前有效权益里最好的那个」，不会误清更长期的权益。

### 系统设置

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/settings` | `setting.view` |
| PUT | `/admin/settings` | `setting.manage`（`secret` 类型额外要求超级管理员） |

`secret` 类型的值只返回脱敏串（保留末 4 位），传空值表示「不修改」，
避免管理员只是打开页面点保存就把密钥清空。

### 操作日志

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/logs` | `log.view` |

日志记录操作人、动作、目标、结果、IP 与简要详情。
**不记录明文密码、API Key、支付密钥、完整卡密**（卡密相关只记脱敏串）。

### 管理员管理

全部接口都要求超级管理员（`RequireSuper`）。

| 方法 | 路径 |
| --- | --- |
| GET | `/admin/admins` |
| POST | `/admin/admins` |
| PATCH | `/admin/admins/:id` |
| POST | `/admin/admins/:id/password` |
| PATCH | `/admin/admins/:id/status` |
| DELETE | `/admin/admins/:id` |

保护规则：不能停用/删除自己，不能把最后一个可用的超级管理员降权、停用或删除。

### 角色与权限点

| 角色 | 说明 |
| --- | --- |
| `super_admin` | 全部权限，含管理员管理与支付密钥 |
| `operator` | 套餐、卡密（看/改，但不能查看明文与导出）、订单（含人工确认收款与发卡）、素材、用户、兑换记录、设置（看）、日志、概览、活跃数据监控 |
| `viewer` | 只读 |

权限点：`plan.manage`、`card.view`、`card.reveal`、`card.generate`、`card.export`、
`card.revoke`、`order.view`、`order.settle`、`order.refund`、`asset.view`、`asset.manage`、
`user.view`、`entitlement.view`、`entitlement.grant`、`setting.view`、`setting.manage`、
`admin.manage`、`log.view`、`overview.view`、`activity.view`。

