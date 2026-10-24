# 账号登录与卡密权益（需求 V1.1 第一部分）

## 1. 已实现

- 登录入口：PC 与手机顶栏都有「登录」；登录后显示昵称/头像入口。
- QQ 登录：服务端 OAuth 授权跳转、`state` 签名校验、回调换取 openid、自动创建豆玩账号、重复登录命中同一账号。
- 微信登录：入口显示「微信登录（暂未接入）」并禁用；后端保留适配层，接口返回 `31001`，不会伪造成功。
- 第三方身份：`user_identities` 表，`provider + provider_open_id` 唯一；不按昵称或头像自动合并。
- 绑定 / 解绑：已登录账号可绑定 QQ；解绑前必须保留至少一种可用登录方式；QQ 创建的账号没有密码，不能解绑最后一个身份。
- 用户中心：昵称/头像、登录方式与绑定状态、当前套餐、权益状态（未激活 / 生效中 / 已到期 / 已停用）、激活与到期时间、兑换卡密、账号与安全、退出登录。
- 权益：服务端是唯一判定来源；`/my/entitlements` 返回生效中与已到期记录；前端只展示 `effective_status`。
- 卡密：服务端事务兑换、单次使用、频率限制、审计日志；后台可查用户、身份、兑换记录与权益状态。
- 安全：APP KEY 只从服务端环境变量读取；不在前端、仓库或日志中输出；回调只带短时令牌；openid 在界面脱敏。
- 可用性预检：`GET /auth/oauth/qq/status` 会读取 QQ 授权页，识别「应用未开通（100008）」这类只在 QQ 页面上出现的错误。登录对话框与账号页据此提前禁用 QQ 按钮并说明原因，不再把用户送到 QQ 的错误页。

## 2. 配置

| 环境变量 | 说明 |
| --- | --- |
| `QQ_APP_ID` | QQ 互联 APP ID，当前为 `1111269377` |
| `QQ_APP_KEY` | QQ 互联 APP KEY，**由产品方通过部署环境注入，不在仓库中** |
| `QQ_REDIRECT_URI` | QQ 回调地址，需与 QQ 互联后台一致 |

也支持带 `DOUWAN_OAUTH_QQ_` 前缀的同名变量。缺少任意一项时，`/api/v1/auth/oauth/qq/start` 返回 `503 / 31001`，日志只记录三个布尔值，不记录密钥。

QQ 互联后台回调地址应为：

```
https://dw.sharyuke.com/api/v1/auth/oauth/qq/callback
```

后端详细设计见 `douwan-api/docs/oauth.md`。

## 3. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/auth/oauth/qq/status` | QQ 登录状态：是否配置、是否可用、预检原因与可读文案 |
| GET | `/api/v1/auth/oauth/qq/start` | 返回 QQ 授权地址；应用未开通时返回 `503 / 31007` |
| GET | `/api/v1/auth/oauth/qq/callback` | QQ 回调，成功后跳前端 `/#/auth/callback` |
| GET | `/api/v1/auth/oauth/wechat/start` | 返回 `31001`「微信登录暂未接入」 |
| GET | `/api/v1/users/me/identities` | 当前账号的第三方身份 |
| DELETE | `/api/v1/users/me/identities/:id` | 解绑身份 |
| GET | `/api/v1/users/me/oauth/qq/bind` | 已登录账号绑定 QQ |
| GET | `/api/v1/my/entitlements` | 当前账号权益（生效中 + 已到期） |

## 4. 当前阻塞项

生产环境 `/etc/douwan/api.env` 已注入 `QQ_APP_ID=1111269377`、`QQ_APP_KEY`、`QQ_REDIRECT_URI=https://dw.sharyuke.com/api/v1/auth/oauth/qq/callback`。APP KEY 只保存在服务器环境变量（600 权限），不进入仓库、前端或日志。

实际访问 QQ 授权页时，QQ 返回：

```
对不起，该网站尚未开通QQ帐号登录（错误码：100008）
```

这说明 APP ID / APP KEY 已被识别，但 QQ 互联侧还没有为这个应用开通网站 QQ 登录。需要在 QQ 互联控制台确认：

- 应用类型是「网站应用」，并已开通 QQ 登录；
- 应用审核 / 上线状态已通过；
- 回调地址与 `https://dw.sharyuke.com/api/v1/auth/oauth/qq/callback` 完全一致；
- 网站域名与备案信息已通过校验。

在 QQ 互联侧开通前，真实授权回调、首次建号、重复登录的线上验收无法完成。代码侧已就绪，开通后无需改代码。

代码侧现在会在用户点登录前做一次授权页预检（结果缓存 10 分钟）：

- 识别到 `100008` 时，`/auth/oauth/qq/status` 返回 `configured=true, available=false, reason=app_not_enabled`；
- 登录对话框提供「重新检查 QQ 状态」，调用 `/auth/oauth/qq/status?refresh=1` 跳过 10 分钟缓存，QQ 刚开通时可立即验证（15 秒内重复刷新仍读缓存，避免公开接口被刷）；
- 登录对话框把 QQ 按钮置灰，显示「QQ 登录正在等待 QQ 互联开通（错误码 100008）」；
- 直接调用 `/auth/oauth/qq/start` 也会返回 `503 / 31007`，不会返回一个必然失败的授权地址；
- 预检本身失败（网络超时等）不挡登录，仍允许用户尝试，避免把偶发故障放大成登录不可用。

微信本期不申请开放平台、不配置真实 OAuth，只保留入口与接口骨架。

## 5. 待办

- 账号删除与数据导出流程尚未实现。
- 刷新令牌仍在进程内存，服务重启后需要重新登录；后续可接 Redis。
- QQ 互联侧尚未开通网站 QQ 登录（100008），真实 OAuth 验收未完成。
