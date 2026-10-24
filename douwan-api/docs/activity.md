# 用户活跃数据监控

> 面向运营的后台模块：回答「多少人在用、用得多频繁、人在哪儿、用了哪些功能、从哪个渠道来的」。
> 接口清单见 [api.md](api.md#用户活跃数据监控)，本文只讲设计与口径。

## 1. 为什么要单独做这个模块

后台原来的「数据概览」只有累计用户数与今日新增，回答不了活跃类问题；
而活跃数据必须在**请求发生时**采集——事后补不出来。这个模块因此分成两半：

```
前台请求 ──► 采集中间件 ──► 内存缓冲 ──► (按周期批量) ──► user_daily_activities
                                        └─────────────► user_feature_daily
                                                              │
后台页面 ──► /api/v1/admin/activity/* ──► 聚合查询 ───────────┘
```

三条硬约束决定了实现方式：

1. **不能拖慢请求**：请求路径上只做几次内存累加（map 加法），写库全在后台协程里批量做。
2. **数据库故障不能拖垮服务**：缓冲有上限（`activity.buffer_limit`），落库失败把增量放回缓冲
   等下个周期重试；实在放不下就丢弃并计数（`freshness.dropped_hits` 会如实报出来）。
3. **不伪造数据**：所有返回都带 `notes` 说明口径；算不出来的维度（IP 未收录、队列还没到第 7 天）
   如实显示为空或 `eligible=false`，不猜、不用 0 冒充。

## 2. 表结构

只建两张**日汇总**表，不存原始事件流水——需求要的是分布与趋势，日粒度足够，
而体积只有流水表的几十分之一（线上机器只有 2C/1.6G、40G 盘）。

### `user_daily_activities`（一个用户一天一行）

| 字段 | 说明 |
| --- | --- |
| `user_id` + `day` | 唯一键。`day` 是**东八区**日期串 `YYYY-MM-DD` |
| `first_active_at` / `last_active_at` | 当天首次 / 最后一次活跃时间 |
| `request_count` | 当天命中的前台接口次数（不含后台接口、健康检查） |
| `feature_count` | 当天功能使用次数（接口统计 + 客户端上报） |
| `ip` | 当天最后一次请求的 IP（对外接口一律脱敏） |
| `country` / `province` / `city` / `isp` / `region_raw` | IP 归属地，见 §4 |

### `user_feature_daily`（用户 × 天 × 功能 × 来源 一行）

| 字段 | 说明 |
| --- | --- |
| `user_id` + `day` + `feature` + `source` | 唯一键 |
| `hits` | 使用次数。列名不叫 `count`，因为累加是原生 SQL 表达式（`hits = hits + EXCLUDED.hits`），避开函数名歧义 |

`source` 区分 `api`（服务端按接口自动统计）与 `client`（前端通过 `/api/v1/events` 上报）。
两者口径不同（接口次数 ≠ 业务次数），所以**分开存、分开展示**，不合并成一个看起来更大的数字。

`users` 表新增三个字段：`last_active_at`（冗余，最多滞后一个 flush 周期）、
`channel` / `channel_detail`（首触来源，见 §5）。

## 3. 采集口径

- **活跃的定义**：登录用户在某个东八区自然日内至少命中一次前台接口，
  或通过 `/api/v1/events` 上报过事件。注册与登录本身也算（处理函数会显式标记用户）。
- **匿名访问不计入**：本模块统计的是「用户活跃」。把未登录浏览混进来会让 DAU 失去意义。
- **不算活跃的请求**：后台管理接口（`/api/v1/admin/**`）、`/healthz`、`/readyz`、
  静态文件 `/uploads/**`、以及没匹配到路由的 404（扫描器流量）。
- **`/api/v1/events` 本身不计入请求次数**：它上报的事件会单独累加，并且同样让该用户当天算活跃。
- **时区固定东八区**：用固定 +8 偏移而不是 `Asia/Shanghai`，避免精简镜像没装 tzdata 时
  退化成 UTC，把跨零点的数据整体算错一天。
- **功能归属**：按「方法 + 路由模板」映射（例如 `GET /api/v1/users/me` → `account.profile`），
  映射表在 `internal/activity/feature.go`。没收录的路由仍计入请求次数，只是不计入功能统计。

## 4. 地区解析（IP 归属地）

- 用本地 **ip2region** xdb 文件离线解析，不调用任何在线接口：
  一是省一次外部依赖与延迟，二是访客 IP 不该发给第三方。
- 只取**当天最后一次请求**的 IP 对应的地区（用户从公司切到 4G 时取最近一次）。
- 内网 / 回环地址记为 `isp=内网`，不猜省份。
- **数据文件是可选依赖**：文件缺失、格式不对、策略名写错都只会让地区维度显示「未知」，
  服务照常启动；接口里的 `geo_enabled=false` + `geo_note` 会说明原因。
- 进程内按 IP 缓存解析结果（`activity.geo_cache_size`），同一个 IP 只查一次库。

### 字段布局（踩过的坑）

ip2region 的**两个版本字段布局不一样**，混用会让整块地区统计错位
（线上表现为「城市」列显示成运营商、「运营商」列显示成 `CN`）：

| 数据文件 | 布局 | 例子 |
| --- | --- | --- |
| v2（旧） | `国家\|区域\|省份\|城市\|ISP`，区域是数字 | `中国\|0\|广东省\|深圳市\|电信` |
| **v4（仓库用的）** | `国家\|省份\|城市\|ISP\|国家代码` | `中国\|重庆市\|重庆市\|电信\|CN`、`United States\|California\|0\|Google LLC\|US` |

`parseRegion` 用「第 2 个字段是不是纯数字」自动识别两种布局，所以换成旧文件也不会错位；
各级未知时数据里写 `0`，统一转成空串。直辖市省市同名时只保留省。
境外 IP 的「省份」是州 / 一级行政区，接口同时返回 `country`，展示成「美国 · California」。

部署数据文件（仓库里不放二进制）：

```bash
# 在开发机 home 上下载（qq 访问 raw.githubusercontent.com 会被重置）
curl -L -o /tmp/ip2region_v4.xdb \
  https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb
ssh qq 'mkdir -p /var/lib/douwan'
scp /tmp/ip2region_v4.xdb qq:/var/lib/douwan/ip2region_v4.xdb
```

验证字段布局（换数据文件或升级 ip2region 之后跑一次）：

```bash
# 1) 单测里有真实返回串的解析用例（含 v4 与 v2 两种布局）
ssh home 'cd ~/Documents/work/dw/douwan-api && go test ./internal/activity/ -run ParseRegion -v'
# 2) 线上跑通后用地区接口抽查：省份 / 城市 / 运营商三列都该是人能看懂的地名
ssh qq 'set -a; . /etc/douwan/api.env; set +a; PGPASSWORD="$DOUWAN_DATABASE_PASSWORD" \
  psql -h 127.0.0.1 -U douwan -d douwan -c "select ip, region_raw, country, province, city, isp from user_daily_activities order by id desc limit 5"'
```

想同时支持 IPv6，把 `data/ip2region_v6.xdb`（约 37MB）也放上去并配置 `activity.geo_v6_xdb`。
不配置时 IPv6 访客的地区为「未知」，其余统计不受影响。

## 5. 来源渠道（首触归因）

优先级：请求体里的 `channel` → `utm_source` → `Referrer` 头（或请求体的 `referrer`）。

- 归一化：转小写、只保留 `a-z0-9-_.`、最多 32 字符；传完整 URL 时只取域名。
- `Referer` 是自己站点 → 记为 `direct`（站内跳转不是外部渠道，否则每个自然用户都会带上自己的域名）。
- 什么都没带 → 空串，后台显示「未知来源」。
- **只写一次**：注册时确定，之后不再改写（末次归因会让渠道报表随活动漂移）。
  活跃监控上线前注册的老用户，会在下次带来源信息登录时**补一次**，仍然只补一次。

前端要做的事（可选，但做了渠道报表才有区分度）：把落地页上的 `?from=` / `?utm_source=`
透传进注册 / 登录请求体即可，服务端也会兜底读 `Referer`。

## 6. 功能点清单

服务端能自己看见的（自动统计，**不接受客户端上报**，否则可以刷数据）：

| 功能点 | 中文名 | 触发接口 |
| --- | --- | --- |
| `app.open` | 打开应用 | 前端启动后的首个接口（预留） |
| `app.settings` | 读取站点设置 | `GET /settings/public` |
| `account.register` | 注册账号 | `POST /auth/register` |
| `account.login` | 登录 | `POST /auth/login` |
| `account.logout` | 退出登录 | `POST /auth/logout` |
| `account.profile` | 查看我的账户 | `GET /users/me` |
| `account.profile.update` | 修改资料 | `PATCH /users/me` |
| `membership.permissions` | 查看会员权益 | `GET /permissions` |
| `plan.browse` | 浏览套餐 | `GET /plans` |
| `card.redeem` | 卡密兑换 | `POST /card-keys/redeem` |
| `order.create` / `order.list` / `order.detail` | 下单 / 我的订单 | `/orders` |
| `entitlement.view` | 查看我的权益 | `GET /my/entitlements` |
| `asset.browse` / `asset.view` | 浏览素材库 | `/assets` |

只能由客户端上报的（发生在浏览器里，服务端看不见，通过 `POST /api/v1/events` 上报）：

`editor.open` 打开编辑器、`pattern.generate` 生成图纸、`pattern.export` 导出图纸、
`pattern.matte` 自动抠图、`pattern.save` 保存作品、`inventory.manage` 库存管理、
`ai.text` AI 文本出图、`ai.variants` AI 配色变体、`ai.batch` AI 批量出图。

> 前端还没接入上报接口，所以后台的「客户端上报」一栏目前会是空的；
> 接口与白名单已经就绪，前端按 api.md 的约定调用即可，不需要再改后端。

## 7. 保留与清理

- 明细保留 `activity.retain_days` 天（默认 400 天，下限 30），超期由后台协程**硬删除**
  （统计汇总不需要留墓碑，软删除只会让表继续长大）。
- 清理周期 `activity.cleanup_interval`（默认 12 小时），启动后第一个周期开始计时。
- 估算体积：1 万用户每天活跃一次 ≈ 1 万行/天（`user_daily_activities`），
  功能表按「人均 5 个功能」算 ≈ 5 万行/天；400 天约 2400 万行，建议按季度看一眼表大小。

## 8. 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `activity.enabled` | `true` | 关掉后完全不采集，后台接口返回空数据 |
| `activity.flush_interval` | `10s` | 内存缓冲落库周期（1s~10m） |
| `activity.buffer_limit` | `20000` | 内存缓冲桶数上限，超限丢弃并计数 |
| `activity.retain_days` | `400` | 明细保留天数（≥30） |
| `activity.cleanup_interval` | `12h` | 清理协程周期 |
| `activity.geo_enabled` | `true` | 是否解析 IP 归属地 |
| `activity.geo_v4_xdb` / `geo_v6_xdb` | — | ip2region 数据文件路径 |
| `activity.geo_cache_policy` | `buffer` | `buffer`（全量内存）/ `vector`（只缓存索引）/ `none`；也接受 ip2region 原生名 `buffercache`/`content`、`vindex`/`vectorindex`、`nocache`/`file` |
| `activity.geo_cache_size` | `8192` | 进程内 IP→地区 缓存条数 |
| `activity.event_report_per_minute` | `120` | 单 IP 每分钟埋点上报次数上限 |
| `server.trusted_proxies` | `127.0.0.1,::1` | 可信反代地址；**决定地区统计是否可信** |

## 9. 接口

| 方法 | 路径 | 权限 | 回答的问题 |
| --- | --- | --- | --- |
| GET | `/admin/activity/overview` | `activity.view` | 日活 / 周活 / 月活 / 粘性 + 趋势 |
| GET | `/admin/activity/retention` | `activity.view` | 新用户次日 / 3 日 / 7 日留存 |
| GET | `/admin/activity/frequency` | `activity.view` | 使用频率分布 + 活跃榜 |
| GET | `/admin/activity/regions` | `activity.view` | 省 / 市 / 运营商分布 |
| GET | `/admin/activity/features` | `activity.view` | 功能使用排行（接口 / 客户端分开） |
| GET | `/admin/activity/channels` | `activity.view` | 渠道新增 / 活跃 / 付费质量 |
| GET | `/admin/activity/users` | `activity.view` | 活跃用户列表（可筛沉默用户） |
| GET | `/admin/activity/users/:id` | `activity.view` | 单用户逐日活跃与功能明细 |
| POST | `/api/v1/events` | 登录即可 | 客户端埋点上报（前台接口） |
| GET | `/admin/activity/traffic` | `activity.view` | 站点访问量 PV / UV + 页面排行 + 落地页 + 来源 |
| GET | `/admin/activity/traffic/visitors` | `activity.view` | 访客明细（可按页面 / 渠道筛选） |
| POST | `/api/v1/visits` | 无需登录 | 页面访问上报（前台接口，见 §12） |

所有统计接口都支持 `?days=N`（1~90，默认 30）。

## 10. 运维排查

| 现象 | 先看什么 |
| --- | --- |
| 日活一直是 0 | `activity.enabled` 是否为 true；接口返回的 `freshness.last_flush_at` 是否在动；`freshness.last_error` 有没有内容 |
| 地区全是「未知」 | `activity.geo_v4_xdb` 指向的文件是否存在且可读；`geo_enabled` 与 `geo_note` |
| 地区全落在同一个省 | `server.trusted_proxies` 是否包含 nginx 的地址；nginx 是否传了 `X-Forwarded-For` / `X-Real-IP` |
| 渠道全是「未知来源」 | 前端有没有把 `channel` / `utm_source` 带进注册请求；浏览器是否发送 `Referer` |
| 功能排行里没有图纸相关功能 | 前端还没调用 `POST /api/v1/events`（见 §6 的说明） |
| `dropped_hits` 不为 0 | 数据库写入异常导致缓冲积压，看 `journalctl -u douwan-api` 与 `freshness.last_error` |
| 数字比预期少一点 | 正常：采集是异步的，最多滞后一个 `flush_interval`（默认 10 秒）；进程被 `kill -9` 时最多丢一个周期的增量 |
| 访问量一直是 0 | 前端有没有部署带埋点的产物（`assets/index-*.js` 里应能搜到 `api/v1/visits`）；`freshness.buffered_visits` / `last_flush_at` 是否在动 |
| `dropped_visits` 不为 0 | 访问缓冲溢出（数据库写入异常），看 `journalctl -u douwan-api` 与 `freshness.last_error` |
| 页面排行里出现 `/other` | 前端上报的路径不在允许的字符集里（含中文/空格/括号等），或不是以 `/` 开头 |
| UV 比预期大很多 | 访客标识没被前端存住（每次访问都新建一个）；检查响应里的 `visitor` 是否被写回 localStorage |

### 部署时踩过的坑（systemd 与上传目录）

服务曾经因为 `/var/lib/douwan/uploads` 被删掉而起不来，报 `226/NAMESPACE`。
原因是 systemd 的 `ReadWritePaths=/var/lib/douwan/uploads` 在**建立挂载命名空间**时
就要求路径存在，而这一步早于 `ExecStartPre`；同时 `ExecStartPre` 默认以服务用户
（douwan）运行，`/var/lib/douwan` 是 root 所有，非 root 建不了子目录。

现在单元里做了三件事，`deploy/systemd/` 下有对应文件：

```ini
ExecStartPre=+/usr/bin/install -d -m 755 -o douwan -g douwan /var/lib/douwan/uploads
ReadWritePaths=-/var/lib/douwan/uploads
```

```bash
# 开机自动建目录（tmpfiles.d），首次安装：
install -m 644 deploy/systemd/douwan-tmpfiles.conf /etc/tmpfiles.d/douwan.conf
systemd-tmpfiles --create /etc/tmpfiles.d/douwan.conf
```

`-` 前缀让缺失路径不再致命，`+` 前缀让 ExecStartPre 以 root 运行，tmpfiles.d 兜住重启。

## 12. 站点访问量（PV / UV，含未登录访客）

> 需求原文：「加一个用户访问量」。它和上面 11 节讲的「用户活跃」是**两套口径**，
> 所以分成两组表、两个缓冲区、两个标签页，数字不合并、也不互相加减。

### 为什么不能复用活跃表

活跃统计的是**登录用户**（匿名访问混进来会让 DAU 失去意义，见 §3），
而「访问量」回答的是「站点被打开了多少次、多少人来过」——**未登录访客必须算**，
否则「今天有多少人打开过首页」这个问题永远答不出来。

另外前台是 hash 路由的 SPA：一个 HTML 入口之后的所有页面切换都不产生 HTTP 请求，
服务端在接口层只知道「有人调了接口」，不知道「他翻到了哪一页」。所以页面访问
必须由前端上报（`POST /api/v1/visits`，允许匿名，见 §13 接口清单）。

### 表结构

只建两张表，仍然是日汇总形态（不存事件流水）。

#### `site_visitors`（一个访客一行）

| 字段 | 说明 |
| --- | --- |
| `visitor` | 唯一键。浏览器本地随机生成并持久化的 32 位十六进制串 |
| `user_id` | 最近一次带登录态访问时的用户 ID；0 = 一直是匿名访客 |
| `first_seen_at` / `last_seen_at` | 首次 / 最近一次访问时间 |
| `first_day` / `last_day` | 东八区日期串，新老访客与「窗口内来过」都按它判断 |
| `page_views` | 全时段累计访问量（落库时累加） |
| `first_path` / `last_path` | 首触落地页（只在插入时写，之后不改）/ 最近访问的页面 |
| `channel` / `channel_detail` | **首触**来源渠道，只在为空时写入（与 `users.channel` 同一套规则） |
| `ip` / `country` / `province` / `city` / `isp` / `region_raw` | 最近一次访问的 IP 与归属地 |

#### `site_visitor_page_daily`（访客 × 天 × 页面 一行）

| 字段 | 说明 |
| --- | --- |
| `visitor` + `day` + `path` | 唯一键。这一行**本身就是一次 UV**（去重交给唯一索引，重启进程也不会把老访客算成新访客） |
| `pv` | 这天这个页面被该访客打开的次数 |
| `user_id` | 这次访问有没有登录态（0 = 匿名）；窗口 UV 由此拆出登录 / 匿名 |
| `first_at` / `last_at` | 该访客这天在这个页面的首末次访问 |

表体积 ≈ 访客数 × 每人每天的页面数（不是事件流水），保留期与活跃明细相同
（`activity.retain_days`，默认 400 天，超期硬删除）。**`site_visitors` 档案不清理**：
它的 `first_day` 是新老访客的依据，删掉会让回归的老访客重新算成新访客（数字会变好看，但是假的）。

### 采集口径

- **PV（访问量）= 页面被打开的次数**，含刷新与重复访问；**UV（访客数）= 去重后的访客标识数**。
- **访客不是人**：标识是浏览器本地生成的随机串，清空浏览器数据 / 换设备 / 无痕窗口都算新访客。
  后台页面上把这句话摆在数字旁边，就是怕 UV 被当成「人数」。
- **去抖**：客户端 2 秒 + 服务端 2 秒（同一访客同一页面），页面重定向、强刷、
  组件重复挂载产生的重复上报只算一次。
- **路径是路由模板**（`/library/:slug`）而不是完整 URL：同一模板下的详情页合并成一行，
  否则页面排行会退化成「素材列表」。字符集与长度都收敛过，非法值统一归到 `/other`。
- **后台页面不计入**（`/#/admin/**`），404 页面也不计（大多是被老链接或爬虫打中的路径）。
- **`/api/v1/visits` 本身不计入用户活跃的请求次数**（与 `/api/v1/events` 同一处理），
  但登录用户的一次页面访问**会**让他当天算活跃（只标记活跃，不加请求次数）。
- 时间同样按东八区自然日分桶；上报时间超前或超过 6 小时一律收敛成当前时间。

### 隐私

- 只存一个随机访客标识 + 路由 + 来源域名 + IP 归属地；
  **不采集**设备信息、UA、输入内容，也不做跨站标识（不是浏览器指纹）。
- IP 只用于地区统计，后台接口一律返回脱敏值（`219.152.43.*`），访客标识只返回前 8 位。
- 访客标识与登录账号的关联只发生在「带了合法令牌的那次访问」，不做跨设备合并。

### 与活跃共用什么

共用 `Activity.Recorder`（同一份内存缓冲上限、同一个 flush 周期与失败重试语义），
但缓冲计数、丢弃计数、清理统计都**分开报**：
`freshness.buffered_visits` / `buffered_visitors` / `dropped_visits` 是访问量那一套，
`buffered_buckets` / `buffered_hits` / `dropped_hits` 是活跃那一套。

## 11. 后续可做（本次范围外）

1. ~~**后台前端页面**：`AdminActivityView.vue`~~ **已完成（2026-10-16）**：
   `pindoudou/src/views/admin/AdminActivityView.vue`，路由 `#/admin/activity`，权限点 `activity.view`。
   注意：新增权限点必须同时加进 `model.permissionOrder`，否则前端拿不到这个权限点、页面会被
   路由守卫拦到 `/admin/forbidden`（接口却是 200）——`internal/model/admin_test.go` 现在会盯着。
2. **前端埋点接入**：在 `pattern.js` / `exporters.js` 的关键路径调用 `/api/v1/events`。
3. **事件明细表**：需要行为漏斗（例如「生成 → 导出 → 下单」的转化）时再加原始事件表，
   并按周分区 / 定期清理，不要把它当日汇总表用。
4. **渠道 × 留存交叉**：现在的渠道表是窗口口径，做「各渠道 7 日留存」需要按队列拆。
