# 豆玩 SEO V3.0：搜索词优化与关键词管理

> 上线日期：2026-10-25　站点：<https://dw.sharyuke.com>
> 代码：`pindoudou` 提交 `5fbbef0` + `fddad8e`；`douwan-api` 提交 `dc9acc5` + `df1b801`（分支 `feat/seo-platform`）
>
> **本文档不声称任何页面已被收录。** V3.0 交付的是「关键词怎么排、文案怎么生成、后台怎么管、
> 数据从哪来」这套机制；收录与排名仍然只能在各家站长平台里看到。
> 豆玩这边没有接入站长平台数据源的字段一律显示「暂无数据」，不填任何推算出来的曝光量或排名。

---

## 1. 做了什么

| 需求 | 落地情况 |
| --- | --- |
| 三层关键词策略 | 关键词库按 `tool`（工具转换词）/ `material`（免费素材词）/ `tutorial`（教程与专业功能词）分组，线上 53 条 |
| 关键词与页面对应 | 16 个目标页，每页一个主要搜索意图 + 一组相关词，无重复意图页面 |
| 素材库自动 SEO | 基于真实字段（名称 / 分类 / 简介 / 格数 / 标签）的模板，标题、H1、描述、alt 自动生成，管理员可覆盖 |
| 首页内容优化 | 首屏保持单屏，H1 与功能说明不变；首屏以下新增 5 个可抓取内容块（转换步骤 / 功能清单 / 免费素材 / 常见问题 / 分类入口） |
| 关键词管理后台 | 「SEO 管理 → 关键词管理」标签页：列表、增删改、CSV 导入、分组筛选、三个诊断面板 |
| 关键词优化闭环 | 收集 → 分组 → 页面匹配 → 内容优化 → 表现分析 → 调整；分析环节已接好代码，数据源待配置 |
| 发布联动 | 素材发布时自动重算 SEO 文案 → 触发 V2.0 推送流程；不因新搜索词创建空白页 |

---

## 2. 初始关键词库（53 条）

来源：`src/data/seo.js` 的 `KEYWORD_GROUPS` / `KEYWORD_INTENTS` / `KEYWORD_TARGETS`，
编译进 `dist/seo/pages.json`，后台「同步关键词库」写进 `seo_keywords` 表。

### 2.1 第一层 · 工具转换词（15 条，全部 active）

> 有明确制作需求的人 → 工具页 / 首页

| 关键词 | 目标页 | 优先级 | 意图 |
| --- | --- | --- | --- |
| 拼豆图纸生成器 | `/` | 高 | 工具使用 |
| 豆玩 | `/` | 中 | 工具使用 |
| 拼豆图纸在线制作 | `/` | 高 | 工具使用 |
| 拼豆图纸制作 | `/` | 高 | 工具使用 |
| 拼豆图纸生成 | `/` | 高 | 工具使用 |
| 拼豆图纸下载 | `/` | 高 | 工具使用 |
| 图片转拼豆 | `/tools/photo-to-bead-pattern/` | 中 | 工具使用 |
| 图片转拼豆图纸 | `/tools/photo-to-bead-pattern/` | 高 | 工具使用 |
| 照片转拼豆 | `/tools/photo-to-bead-pattern/` | 高 | 工具使用 |
| 照片转拼豆图纸 | `/tools/photo-to-bead-pattern/` | 高 | 工具使用 |
| 像素拼豆图纸 | `/tools/pixel-bead-maker/` | 高 | 工具使用 |
| 像素图转拼豆 | `/tools/pixel-bead-maker/` | 高 | 工具使用 |
| 拼豆像素画生成器 | `/tools/pixel-bead-maker/` | 中 | 工具使用 |
| 宠物拼豆图纸 | `/tools/pet-bead-pattern/` | 高 | 工具使用 |
| 宠物拼豆图纸生成器 | `/tools/pet-bead-pattern/` | 中 | 工具使用 |

### 2.2 第二层 · 免费素材词（30 条：16 active + 14 planned）

> 找现成图案的人 → 素材中心 / 分类页

| 关键词 | 目标页 | 优先级 | 意图 | 状态 |
| --- | --- | --- | --- | --- |
| 免费拼豆图纸 | `/materials/` | 高 | 找素材 | 已上线 |
| 拼豆素材 | `/materials/` | 高 | 找素材 | 已上线 |
| 拼豆图案 | `/materials/` | 高 | 找素材 | 已上线 |
| 拼豆图纸素材 | `/materials/` | 高 | 找素材 | 已上线 |
| 拼豆图纸大全 | `/materials/` | 高 | 找素材 | 已上线 |
| 动物拼豆图纸 | `/materials/category/pets/` | 中 | 找素材 | 已上线 |
| 萌宠拼豆图纸 | `/materials/category/pets/` | 高 | 找素材 | 已上线 |
| 猫咪拼豆图纸 | `/materials/category/pets/` | 高 | 找素材 | 已上线 |
| 狗狗拼豆图纸 | `/materials/category/pets/` | 高 | 找素材 | 已上线 |
| 水果拼豆图纸 | `/materials/category/food/` | 中 | 找素材 | 已上线 |
| 甜品拼豆图纸 | `/materials/category/food/` | 高 | 找素材 | 已上线 |
| 美食拼豆图纸 | `/materials/category/food/` | 高 | 找素材 | 已上线 |
| 蛋糕拼豆图纸 | `/materials/category/food/` | 高 | 找素材 | 已上线 |
| 动漫拼豆图纸 | `/materials/category/anime/` | 中 | 找素材 | 已上线 |
| 二次元拼豆图纸 | `/materials/category/anime/` | 高 | 找素材 | 已上线 |
| 动漫角色拼豆图纸 | `/materials/category/anime/` | 高 | 找素材 | 已上线 |
| 新手拼豆图纸 | `/materials/category/beginner/` | 中 | 找素材 | 待上线 |
| 简单拼豆图纸 | `/materials/category/beginner/` | 高 | 找素材 | 待上线 |
| 情侣拼豆图纸 | `/materials/category/couples/` | 中 | 找素材 | 待上线 |
| 爱心拼豆图纸 | `/materials/category/couples/` | 高 | 找素材 | 待上线 |
| 萌趣拼豆图纸 | `/materials/category/cute/` | 中 | 找素材 | 待上线 |
| 表情包拼豆图纸 | `/materials/category/cute/` | 高 | 找素材 | 待上线 |
| 节日拼豆图纸 | `/materials/category/festivals/` | 高 | 找素材 | 待上线 |
| 圣诞拼豆图纸 | `/materials/category/festivals/` | 高 | 找素材 | 待上线 |
| 新年拼豆图纸 | `/materials/category/festivals/` | 高 | 找素材 | 待上线 |
| 秋冬拼豆图纸 | `/materials/category/festivals/` | 中 | 找素材 | 待上线 |
| 生活拼豆图纸 | `/materials/category/lifestyle/` | 中 | 找素材 | 待上线 |
| 杯垫拼豆图纸 | `/materials/category/lifestyle/` | 高 | 找素材 | 待上线 |
| 植物拼豆图纸 | `/materials/category/plants/` | 中 | 找素材 | 待上线 |
| 花卉拼豆图纸 | `/materials/category/plants/` | 高 | 找素材 | 待上线 |

> **「待上线」= 该分类现在还没有已发布素材。** 这些分类页照常能访问，但标 `noindex`、不进 Sitemap、
> 不推送 —— 没有实际内容的页面不进搜索结果。等分类里有素材了，发布流程会自动生成页面并转成「已上线」。

### 2.3 第三层 · 教程与专业功能词（8 条，全部 active）

| 关键词 | 目标页 | 优先级 | 意图 |
| --- | --- | --- | --- |
| 拼豆新手教程 | `/help/` | 中 | 了解 |
| 拼豆教程 | `/help/` | 高 | 了解 |
| 拼豆怎么拼 | `/help/` | 高 | 了解 |
| 拼豆熨烫教程 | `/help/` | 高 | 了解 |
| 拼豆色号 | `/colors/` | 中 | 了解 |
| 拼豆色卡 | `/colors/` | 高 | 了解 |
| 拼豆色卡对照 | `/colors/` | 高 | 了解 |
| 拼豆颜色匹配 | `/colors/` | 高 | 了解 |

### 2.4 关键词与页面对应表（16 个目标页）

| 目标页 | 页面类型 | 主要搜索意图 | 相关词 | 页面 Title |
| --- | --- | --- | --- | --- |
| `/` | 首页 | 拼豆图纸生成器 | 豆玩 / 拼豆图纸在线制作 / 拼豆图纸制作 / 拼豆图纸生成 / 拼豆图纸下载 | 豆玩 - 免费拼豆图纸生成器｜图片转拼豆图纸在线制作 |
| `/tools/photo-to-bead-pattern/` | 工具介绍页 | 图片转拼豆、照片转拼豆图纸 | 图片转拼豆 / 照片转拼豆 | 照片转拼豆图纸 - 免费在线生成拼豆图纸 - 豆玩 |
| `/tools/pixel-bead-maker/` | 工具介绍页 | 像素拼豆图纸 | 像素图转拼豆 / 拼豆像素画生成器 | 像素拼豆图纸生成器 - 免费在线生成拼豆图纸 - 豆玩 |
| `/tools/pet-bead-pattern/` | 工具介绍页 | 宠物拼豆图纸 | 宠物拼豆图纸生成器 | 宠物拼豆图纸生成器 - 免费在线生成拼豆图纸 - 豆玩 |
| `/materials/` | 素材中心 | 免费拼豆图纸、拼豆素材 | 拼豆图案 / 拼豆图纸素材 / 拼豆图纸大全 | 免费拼豆素材库 · 拼豆图纸素材大全 - 豆玩 |
| `/materials/category/pets/` | 动物素材分类 | 动物拼豆图纸 | 萌宠 / 猫咪 / 狗狗拼豆图纸 | 萌宠动物拼豆图纸大全｜免费素材在线制作 - 豆玩 |
| `/materials/category/food/` | 美食水果分类 | 水果拼豆图纸、甜品拼豆图纸 | 美食 / 蛋糕拼豆图纸 | 美食水果拼豆图纸大全｜免费素材在线制作 - 豆玩 |
| `/materials/category/anime/` | 二次元分类 | 二次元拼豆图纸 | 动漫 / 动漫角色拼豆图纸 | 二次元拼豆图纸大全｜免费素材在线制作 - 豆玩 |
| `/materials/category/beginner/` | 新手分类 | 新手拼豆图纸 | 简单拼豆图纸 | （待上线） |
| `/materials/category/couples/` | 情侣分类 | 情侣拼豆图纸 | 爱心拼豆图纸 | （待上线） |
| `/materials/category/cute/` | 萌趣分类 | 萌趣拼豆图纸 | 表情包拼豆图纸 | （待上线） |
| `/materials/category/festivals/` | 秋冬主题分类 | 秋冬拼豆图纸 | 节日 / 圣诞 / 新年拼豆图纸 | （待上线） |
| `/materials/category/lifestyle/` | 生活分类 | 生活拼豆图纸 | 杯垫拼豆图纸 | （待上线） |
| `/materials/category/plants/` | 植物分类 | 植物拼豆图纸 | 花卉拼豆图纸 | （待上线） |
| `/help/` | 教程中心 | 拼豆新手教程 | 拼豆教程 / 拼豆怎么拼 / 拼豆熨烫教程 | 拼豆教程与常见问题 - 豆玩 |
| `/colors/` | 色卡说明页 | 拼豆色号、拼豆色卡对照 | 拼豆色卡 / 拼豆颜色匹配 | 拼豆色号与色卡对照 - 各品牌真实色号表 - 豆玩 |

素材详情页 `/materials/{slug}/` 不在固定表里：它的关键词就是**素材名 + 拼豆图纸**，
由模板自动生成，不在关键词库里重复登记（一个素材一条，不做固定词库之外的膨胀）。

---

## 3. 首页优化后的标题与说明

| 项 | 值 |
| --- | --- |
| Title | 豆玩 - 免费拼豆图纸生成器｜图片转拼豆图纸在线制作 |
| Description | 豆玩是一站式拼豆创作平台。支持上传图片一键生成拼豆图纸、像素画转换、拼豆色号匹配、材料数量统计及图纸导出。提供免费拼豆素材，手机电脑均可使用。 |
| H1 | 免费拼豆图纸生成器 |
| Canonical | `https://dw.sharyuke.com/` |

**首屏没动**：还是原来那套上传工具区，关键词没有往首屏堆。首屏以下新增 5 个内容块：

1. **图片如何转换拼豆图纸** —— 4 步流程：上传图片 → 选方案与尺寸 → 微调颜色 → 导出并开拼
2. **豆玩支持哪些制作功能** —— 6 项真实功能：图片一键转拼豆图纸、真实品牌色号、按真实底板分板、材料清单与用量、浏览器本地处理、免费素材库
3. **如何获取免费拼豆素材** —— 三段正文：素材库入口与分类、选中素材直接进工作台、全部免费无次数限制
4. **常见问题** —— 5 条 FAQ（颜色与实物有色差 / 为什么颜色数比要求的少 / 图片不上传服务器 / 色号可直接采购 / 素材是否免费有次数限制）
5. **免费拼豆素材分类入口** —— 真实分类 + **真实已发布数量**（二次元 28 / 萌宠动物 24 / 美食水果 21），链接指向真实分类页

> 首屏以下还有一段「为什么选择豆玩做拼豆图纸」的正文，讲的是免费开放的范围、色号不跨品牌通用、
> 底板规格 —— 全部是豆玩真实的行为，不写空话。

> 分类数量与前台分类接口、分类页文案里的数字是同一个数（都只数**已发布**素材）。
> 有一条回归测试 `TestCategoryCountOnlyCountsPublished` 盯着这件事。

---

## 4. 素材详情页自动 SEO 示例

模板（`src/data/seo.js` 的 `SEO_TEMPLATES.material`）：

```
Title:       {name}拼豆图纸｜免费拼豆素材 - 豆玩
H1:          {name}拼豆图纸
Alt:         {name}拼豆图纸素材预览
Description: {desc}免费获取{name}拼豆素材，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢{category}主题拼豆的创作者。
             （备选：带格数、带标签、无前缀三种，按「有真实值才用」依次取）
```

线上实际输出（三个素材各不相同，用的都是各自真实字段）：

| 素材 | Title | Description |
| --- | --- | --- |
| 草莓奶油蛋糕 | 草莓奶油蛋糕拼豆图纸｜免费拼豆素材 - 豆玩 | Q版美食水果拼豆图案，简单难度，细节更丰富，适合有基础的玩家。免费获取草莓奶油蛋糕拼豆素材，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢美食水果主题拼豆的创作者。 |
| 捧心的小猫 | 捧心的小猫拼豆图纸｜免费拼豆素材 - 豆玩 | 透明背景 PNG｜52×52 画布约 1575 颗豆、10 色，适合做钥匙扣或冰箱贴。免费获取捧心的小猫拼豆素材，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢二次元主题拼豆的创作者。 |
| 樱桃斗篷小企鹅 | 樱桃斗篷小企鹅拼豆图纸｜免费拼豆素材 - 豆玩 | 透明背景 PNG｜52×52 画布约 1253 颗豆、10 色，适合做钥匙扣或冰箱贴。免费获取樱桃斗篷小企鹅拼豆素材，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢二次元主题拼豆的创作者。 |
| 柠檬帽的奶黄小狗 | 柠檬帽的奶黄小狗拼豆图纸｜免费拼豆素材 - 豆玩 | 透明背景 PNG｜52×52 画布约 1615 颗豆、10 色，适合做钥匙扣或冰箱贴。免费获取柠檬帽的奶黄小狗拼豆素材，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢二次元主题拼豆的创作者。 |

规则：

- **只用真实字段**：简介、格数、标签、分类都是素材表里真有的；没有的字段不写，不编造规格和功能。
- **管理员可覆盖**：后台改过标题或描述 → `seo_auto` 置 false，之后的自动重算不再动它。
- **没有内容就不索引**：素材标 `noindex` 时不进 Sitemap、不推送。
- **不为新搜索词建空白页**：关键词库里状态为「待上线」的分类，页面照常能访问但标 noindex。

---

## 5. 后台关键词管理页面

入口：`#/admin/seo` → 顶部标签「关键词管理」（权限点 `seo.view` / `seo.manage`）。

| 区域 | 内容 |
| --- | --- |
| KPI | 关键词总数、已上线 / 待上线、按分组计数、带数据条数（无数据源时为 0） |
| 筛选 | 关键词搜索、分组、意图、状态、搜索引擎来源；排序支持点击量 / 曝光量 / 点击率 |
| 列表 | 搜索关键词 / 分组 / 优先级 / 意图 / 目标页面（含目标页标题与是否可索引）/ 状态 / 引擎来源 / 最近分析时间 / 曝光 / 点击 / 点击率 / 排名 |
| 操作 | 新增、编辑、删除、CSV 导入、同步初始关键词库、导入 Search Console 数据 |
| 诊断 ① | **核心搜索意图冲突**：同一个主要意图被多个页面认领时列出 |
| 诊断 ② | **页面字段自检**：缺 Title / Description / H1 的页面列出 |
| 诊断 ③ | **低点击率优化候选**：曝光 > 0 且点击率低于阈值的页面列出（没接数据源时为空） |

接口（全部在 `/api/v1/admin/seo/keywords` 下）：

```
GET    /keywords                 列表（含 groups / statuses 聚合计数）
GET    /keywords/meta            分组与意图定义
GET    /keywords/conflicts       意图冲突检测
GET    /keywords/checks          页面字段自检
GET    /keywords/candidates      低点击率候选
POST   /keywords                 新增
PATCH  /keywords/:id             编辑
DELETE /keywords/:id             删除
POST   /keywords/import          CSV 导入
POST   /keywords/sync            同步初始关键词库
POST   /keywords/search-console  导入 Google Search Console 数据
```

CSV 导入支持中文与英文表头（`关键词/keyword`、`分组/group`、`优先级/priority`、
`意图/intent`、`目标页面/target_path`、`状态/status`、`引擎/engine`），带 BOM 的 Excel 导出文件也能直接读。

---

## 6. 搜索表现数据接入情况

| 引擎 | 接入方式 | 当前状态 |
| --- | --- | --- |
| Google | Search Console Search Analytics API（`POST /webmasters/v3/sites/{site}/searchAnalytics/query`，维度 query），需要服务账号 JSON + 站点已在 GSC 验证 | **代码已就绪，未配置凭据** → 所有关键词显示「暂无数据」 |
| 百度 | 暂无官方「关键词表现」查询接口可用；站点管理后台提供手动导出 | **CSV 手动导入**（可按 `engine=baidu` 标记来源） |
| Bing | Bing Webmaster Tools 提供手动导出；Bing 官方亦无公开的关键词查询 API | **CSV 手动导入**（可按 `engine=bing` 标记来源） |

- 曝光量 / 点击量 / 点击率 / 平均排名 / 统计周期只在有真实数据时出现；没有数据时是 `null`，界面显示「暂无数据」。
- 每条统计都带 **搜索引擎 + 统计周期 + 数据来源**（`stat_period` / `stat_source` / `stat_synced_at`）。
- 列表顶部固定提示：「『已提交』只代表通知过搜索引擎，不代表已收录或已有排名。」
- 候选建议只在「曝光 > 0 且点击率低于阈值」时产生 —— 没有数据源时这里是空的（线上实测：0 条）。

要接 Google 的话需要提供（V2.0 §8 的同一项）：

| 用途 | 需要什么 |
| --- | --- |
| Google Search Console | 服务账号 JSON 私钥 + 已验证的站点（`https://dw.sharyuke.com/`） |
| 百度 | 站点 `dw.sharyuke.com` 的推送 token（V2.0 已列，用于推送；表现数据走手动导入） |
| Bing | IndexNow API Key（V2.0 已列，用于推送；表现数据走手动导入） |

---

## 7. 实际修改的文件

### 7.1 前端 `pindoudou`

| 文件 | 说明 |
| --- | --- |
| `src/data/seo.js` | 首页内容块与 FAQ、色卡页文案、关键词库（分组 / 意图 / 目标页）、自动 SEO 模板 |
| `src/data/categorySlugs.js` | 分类标识与名称映射（自动文案用真实分类名） |
| `src/data/libraryCategories.js` | 分类元数据 |
| `src/components/home/HomeContent.vue` | 首屏以下的内容区（5 个块）——⚠️ 2026-10-26 白天按用户要求三端删掉过一天，当晚首页恢复时挂回来，**当天晚些时候又删掉**；现在页面不渲染它，正文只存在于服务端的 SEO 壳里 |
| `src/views/ColorsView.vue` | **新增** 拼豆色号 / 色卡对照页（15 个品牌真实色号） |
| `src/views/HomeView.vue` | 首页主视觉（**不再挂 `<HomeContent />`**）；入口默认进操作台 `/create`；站点页脚在这里 |
| `src/router/index.js` | `/colors` 路由；`/` = 首页、`/create` = 操作台（noindex） |
| `src/lib/seo.js` | canonical 路径加入 `/colors` |
| `src/lib/adminApi.js` | 新增 `seoApi.regenerate` 与 `seoKeywordApi`（11 个方法） |
| `src/views/admin/AdminSeoView.vue` | 新增「关键词管理」标签页与「重新生成文案」按钮 |
| `src/views/admin/AdminSeoKeywords.vue` | **新增** 关键词管理页（列表 / 增删改 / 导入 / 三个诊断面板） |
| `scripts/build-seo-pages.mjs` | 编译 `dist/seo/pages.json`（含关键词库与模板），带目标路径与关键词校验 |
| `scripts/verify-seo-v3.cjs` | **新增** V3.0 验收自检（head 标签 / sitemap / robots / 首页主视觉与内容区 / 色卡页，三档视口；2026-10-26 晚首页内容区又删掉后，断言改为「主视觉 + 插画在，首屏以下不渲染内容区，站点页脚在主视觉之后，H1 仍隐藏，首页不再放向导」） |
| `scripts/admin-audit-seo-keywords.js` | **新增** 关键词管理端到端探针（11 步） |
| `scripts/admin-audit.cjs` | 后台自检页表加入关键词管理页 |

### 7.2 后端 `douwan-api`（分支 `feat/seo-platform`）

| 文件 | 说明 |
| --- | --- |
| `internal/model/seo.go` | **新增** `SeoKeyword` 模型（分组 / 优先级 / 意图 / 目标页 / 状态 / 引擎 / 统计数据） |
| `internal/model/library.go` | `LibraryAsset` / `LibraryCategory` 加 `SeoAuto` |
| `internal/model/migrate.go` | 注册新表 |
| `internal/repository/seo_keyword.go` | **新增** 关键词仓储（列表 / 筛选 / 聚合计数 / 统计写入） |
| `internal/repository/library.go` | `ListAllForSEO`；`CountByCategory` 只数已发布 |
| `internal/repository/repository.go` | 挂载新仓储 |
| `internal/seo/content.go` | 内容文件里的关键词库与模板结构 |
| `internal/seo/render.go` | 渲染 FAQ 与分类入口 |
| `internal/seo/searchconsole.go` | **新增** Search Console 查询客户端（RS256 服务账号签名） |
| `internal/service/seo_template.go` | **新增** 自动文案模板、回填逻辑、旧文案识别 |
| `internal/service/seo_keyword.go` | **新增** 关键词管理服务（列表 / 增删改 / CSV 导入 / 同步 / 冲突 / 自检 / 候选 / Search Console 导入） |
| `internal/service/seo.go` | 页面清单带 H1、`/colors` 路由、分类计数一致性 |
| `internal/service/seo_admin.go` | 管理员改文案时置 `seo_auto=false` |
| `internal/service/library.go` | 素材发布时自动重算文案并触发推送 |
| `internal/dto/seo.go` | **新增** 关键词相关请求结构 |
| `internal/handler/seo_keyword.go` | **新增** 关键词接口 |
| `internal/handler/seo.go` | `POST /admin/seo/regenerate` |
| `internal/router/router.go` | 挂载关键词路由 |
| `internal/service/seo_template_test.go` | **新增** 18 个用例（模板取值、描述有差异、人工文案不被覆盖、CSV 导入、库同步、冲突检测、候选需要真实数据、分类数量一致性） |

---

## 8. 功能测试结果

### 8.1 后端

| 检查 | 结果 |
| --- | --- |
| `go vet ./...` | 通过（本地 + home） |
| `go test ./...` | 全绿：activity / auth / config / handler / model / oauth / seo / service / storage |
| 新增回归测试 | `TestCategoryCountOnlyCountsPublished` —— 把 `CountByCategory` 的过滤去掉后该用例会失败（实测报「4（应为 3）」），修复后通过 |
| 线上迁移 | `migrate` 执行成功，`/readyz` 返回 `{"database":"up","status":"ok"}` |

### 8.2 线上验收自检 `node scripts/verify-seo-v3.cjs --url https://dw.sharyuke.com`

**59 / 59 通过**（2026-10-26 晚首页内容区删掉后的最新数字）：

- head 标签：`/`、`/colors/`、分类页、素材详情页（标题 / 描述 / H1 / 图片 alt）
- **首页原始 HTML 仍含长文正文（服务端 SEO 壳）**：`seo-steps` / 小节 / `seo-faq` 都在
- sitemap.xml：收录 `/colors/` 与有内容的分类，不收录没有素材的分类，全是 HTTPS 绝对地址
- robots.txt：放行 Baiduspider / Googlebot / Bingbot，声明 Sitemap
- 首页（桌面 1440×900 + 平板 834×1112 + 手机 390×844）：主视觉在（标题图 + 上传卡）、宽屏有插画、**首屏以下不渲染长文内容区**、H1 唯一且隐藏、首页不放向导、站点页脚在主视觉之后、无横向溢出
- 色卡页（三档视口）：H1 正确、15 个品牌卡片、240+ 条真实色号、无横向溢出

### 8.3 后台自检（真登录 + 真接口）

- `node scripts/admin-audit.cjs`：**28 / 28 通过**（桌面 + 手机，关键词管理页 行数=36 卡片=9 KPI=4）
- 关键词管理探针：桌面与手机各 **11 / 11 步通过**（切标签 → 列表 → 暂无数据口径 → 三个诊断面板 → 对应表 16 行 → 分组筛选 → 清理残留 → 新增 → 校验 → 删除 → 校验）

### 8.4 全站自检

- `node scripts/audit.cjs --url https://dw.sharyuke.com`：80 页 × 4 视口，**0 页面错误、0 横向溢出、0 画布空白**
- 唯一「报错」是 `notfound` 页本身 —— 未知路径按设计返回 HTTP 404，Chrome 会把这条记成资源加载失败，与本次改动无关

### 8.5 线上实测数据

| 项 | 实测值 |
| --- | --- |
| 关键词库 | 53 条（tool 15 / material 30 / tutorial 8；active 39 / planned 14；带数据 0）。2026-10-25 补上品牌词「豆玩」，挂在首页，不单独建页 |
| 目标页 | 16 个 |
| 意图冲突 | 0 条 |
| 缺字段页面 | 0 条 |
| 低点击率候选 | 0 条（未接数据源，符合预期） |
| sitemap | 86 个 URL |
| 分类数量一致性 | 美食水果：分类页文案「共 21 个」= 首页「21 个素材」= 前台接口 `asset_count=21` |

---

## 9. 回滚材料

| 内容 | 位置 |
| --- | --- |
| 后端二进制 | qq `/opt/douwan-api/bin/server.bak-seov3-20261025-151030`、`migrate.bak-seov3-20261025-151030` |
| 数据库 | qq `/root/douwan-backups/douwan-seov3-20261025-151030.dump` |
| 前端 | qq `/var/backups/douwan/` 下的历史前端包（V2.0 交付时留的） |

---

## 10. 下一步（需要用户提供的东西）

1. **Google Search Console 凭据** —— 服务账号 JSON + 已验证站点，接上之后曝光 / 点击 / 点击率 / 排名会自动填。
2. **百度、Bing 的表现数据** —— 官方没有可用的关键词查询接口，先走两边站长后台手动导出 CSV 导入。
3. **分类补素材** —— 「待上线」的 14 条关键词对应的 6 个分类还没有已发布素材，素材到位后发布流程会自动建页并转「已上线」。
4. **百度普通收录 API token / IndexNow Key** —— V2.0 已列，接上后发布即推送（V3.0 的发布联动依赖这条）。
