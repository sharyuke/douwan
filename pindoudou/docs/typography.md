# 豆玩全站排版规范（落地版）

> 唯一事实来源：Figma「豆玩操作台优化」`i2DCUExq8mvsBqgJ7kk3f1`，画板 `1:2`「豆玩 · 文字与字体规范」。
> 落地时间：2026-11-02。改版前只有工作台与个人中心按规范做，其余页面还在用交付包的
> 16/14/12 旧口径；这次把首页、素材库、色卡、教程、作品、库存、设置、404、后台全部对齐。
> 自检：`pnpm verify:typography`（真浏览器，243 项，含后台接口打桩）。

## 1. 字体族

| 用途 | 字体 | 可用字重 |
| --- | --- | --- |
| 中文 | **Noto Sans SC**（回退 思源黑体 → 微软雅黑 → sans-serif） | 400 / 500 / 700 |
| 拉丁与数字 | **Inter**（自托管可变字体，`public/fonts/`） | 400 / 500 / 600 |

两条令牌是唯一出口，页面里不要再写字体栈：

```css
--font-sans:    "Noto Sans SC","Source Han Sans SC","Microsoft YaHei",sans-serif;
--font-numeric: "Inter","Noto Sans SC","Source Han Sans SC","Microsoft YaHei",sans-serif;
```

**中文不用 600 以上。** Noto Sans SC 只有 400/500/700 三个字重，写 600/800 在回退字体上
就是伪粗体（笔画糊在一起）。`b` / `strong` 在 700 的父级里会被 UA 算成 `bolder` ⇒ 900，
所以全局钉死了 `b,strong{font-weight:700}`。

## 2. 语义档位

| 角色 | 字号 / 字重 / 行高 | 字距 | 用在哪 | 令牌 |
| --- | --- | --- | --- | --- |
| Title / Page | 28 / 700 / 40 | 0 | 页面主标题 | `--ty-page(-lh)` |
| Title / Dialog | 24 / 700 / 34 | 0 | 弹窗、抽屉标题 | `--ty-dialog(-lh)` |
| Title / Section | 18 / 700 / 28 | 0 | 区域标题、卡片组标题 | `--ty-section(-lh)` |
| Title / Card·Action | 15 / 700 / 24 | 0 | 卡片标题、主按钮 | `--ty-card(-lh)` |
| Body / Default | 14 / 400 / 22 | 0 | 正文、输入内容 | `--ty-body(-lh)` |
| Label / Control | 13 / 500 / 20 | 0 | 导航、标签、次按钮 | `--ty-label(-lh)` |
| Caption / Default | 12 / 400 / 18 | 0 | 辅助说明、紧凑标签 | `--ty-caption(-lh)` |
| Number / Metric | 30 / 600 / 38 | −1px | 概览指标（Inter） | `--ty-metric(-lh)` |
| Number / Inventory | 13 / 500 / 20 | 0 | 库存数量（Inter） | `--ty-num` |

补充档（同一角色内只改字重，不改字号）：14px 内容小标题 700/22、13px 字段标签强调 700/20、
12px 标签强调 700/18。

**边界**：正文 ≥14px，辅助文字 ≥12px。10–11px 只允许出现在「高密度标尺、日期、次要元信息」，
自检脚本里用 `SMALL_OK` 白名单点名（工作台保存状态、状态栏、标尺刻度等），新加要一起登记。

## 3. 怎么用

优先用语义类，不要在页面里写数字：

```html
<h1 class="ty-page">我的库存</h1>
<h2 class="ty-section">按品牌分布</h2>
<p class="ty-body">勾选你手里真的有的颜色……</p>
<span class="ty-label">导航</span>
<span class="ty-metric">2,661</span>
```

需要在 CSS 里写时也只引用令牌：

```css
.cardTitle{font-size:var(--ty-card);line-height:var(--ty-card-lh);font-weight:700;letter-spacing:0}
```

旧的 `--fs-*` 令牌还在（大量页面仍在用），但值已经对齐语义档位：
`--fs-display/--fs-h1 = 28`、`--fs-h2 = 18`、`--fs-h3/--fs-md = 15`、`--fs-body/--fs-sm = 14`、
`--fs-xs = 13`、`--fs-2xs = 12`。**注意 h2/h3 是按语义而不是按标签取的**：
`h2` = 区域标题 18、`h3` = 卡片标题 15。

全局默认值（`src/styles/global.css`）保证「没写样式的地方」也落在规范里：

```css
body{font-family:var(--font-sans);font-size:var(--ty-body);line-height:var(--ty-body-lh);letter-spacing:0}
h1{font-size:var(--ty-page);line-height:var(--ty-page-lh);font-weight:700}
h2{font-size:var(--ty-section);line-height:var(--ty-section-lh);font-weight:700}
h3{font-size:var(--ty-card);line-height:var(--ty-card-lh);font-weight:700}
h4{font-size:var(--ty-body);line-height:var(--ty-body-lh);font-weight:700}
b,strong{font-weight:700}
```

## 4. 这次改了什么

- **令牌重映射**：`--fs-*` 旧令牌落到语义档位（约 425 处引用一次到位）。
- **全站样式改写**（62 个文件）：字重收进 400/500/700（数字 600）、字号收进 9 个档位、
  行高统一挂 `--ty-*-lh`、字距归零（指标 −1px）、等宽字体改走 `--font-numeric`。
  只改写声明里的值，不动选择器与格式。
- **首页主标题**：去掉 350 字重的子集字体（`noto-sans-sc-350-home-title.woff2`，已不再引用），
  改成规范里的 28/700/40（手机 24/700/34）。
- **全局默认值**：`body` / `h1..h4` / `b,strong` / 表单控件按规范钉死，`textarea` 行高回到 22。
- **后台**：`admin.css` 与 12 个后台页一起收口，文本域行高、日志块行高改令牌。

## 5. 自检怎么跑

```powershell
cd pindoudou
node scripts/verify-typography.cjs --url http://127.0.0.1:4182
```

脚本做两件事：

1. **角色断言**：点名页面上的关键元素（工作台作品名、模式切换、主按钮、个人中心指标…），
   逐个核对计算出来的字号 / 字重 / 行高 / 字距。
2. **全量扫查**：把整页 `#app` 里所有可见文字扫一遍，抓「字号越界 / 字重越界 /
   行高与字号不匹配 / 字距不为 0 / 中文 600 伪粗体」。

覆盖：工作台（桌面 1600 / 平板 900 / 手机 390 + 弹窗与底部抽屉）、个人中心、全站 12 个页面
（桌面 1440 + 手机 390）、**后台 12 个页面**（桌面 + 手机）。
后台要登录才能渲染，脚本用 CDP `Fetch` 把 `/api/v1/admin/*` 打桩（`auth/me` 回一份带全部权限的
管理员，其余接口回空列表），只验证版面字号，不验证后台业务。

产物：`.tmp/verify-typography/`（每页截图 + `report.json` + `sweep-issues.json`）。

## 6. 改代码时的注意事项

- 不要在页面里写 `font-size:16px` 这种不在档位里的值 —— 自检会挂。
- 中文不要写 600/800/900；要更重就用 700，要更轻用 500。
- 行高跟着字号走：写 `font-size` 就同时写 `line-height:var(--ty-*-lh)`，
  只写字号会让行高落到 `normal`，与规范的 1.5 倍左右对不上。
- 字距一律 0，只有 `--ty-metric`（30px 指标数字）允许 −1px。
- `--font-numeric` 只给数字与色号用，中文文本走 `--font-sans`（Inter 没有中文字形，
  混用会让中文落到回退字体上，行高观感不一致）。
- 导出产物（图纸标版、分享卡、打印版）按设计稿自己的字号，不走站点 UI 规范。
