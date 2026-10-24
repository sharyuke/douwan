# 后台前端组件规范（写 AdminXxxView.vue 时请严格照做）

这套规范是给「后台各功能页」共用的。目标：**运营人员点得动、看得清、出错了知道为什么**。
后台需求文档要求：全中文、桌面优先、平板手机可浏览可简单编辑、高风险操作二次确认、
所有列表支持搜索筛选分页、无数据要有明确下一步。

## 1. 文件与命名

- 文件放在 `src/views/admin/AdminXxxView.vue`，`<script setup>` + `<template>` + `<style scoped>`（尽量不写 style，用全局 class）。
- **所有样式 class 一律用 `adm-` 前缀**（已在 `src/styles/admin.css` 里定义，见第 5 节）。
  不要新增自定义 class 名去覆盖前台样式，也不要用 `.wrap` / `.pagehead` / `.btn` 这些前台 class。
- 不要引入任何新的 npm 依赖（项目只有 vue 与 vue-router）。

## 2. 必须用到的现成零件

```js
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
```

- `AdminTable`：`props { columns, rows, loading, rowKey, emptyTitle, emptyHint, minWidth }`。
  每个单元格用插槽 `#cell-<key>="{ row, value }"` 自定义渲染。列定义
  `{ key, label, width, align: 'right'|undefined, nowrap: true|undefined }`。
- `AdminPager`：`props { total, page, pageSize }`，`v-model:page` / `v-model:page-size`。
- `AdminModal`：`v-model` 控制显示，`props { title, size: ''|'sm'|'lg', maskClosable }`，
  插槽 `default` 放表单、`footer="{ close }"` 放按钮。
- `AdminTag`：`props { text, kind }`，kind 取 `ok|warn|danger|info|primary|muted`。

```js
// 接口
import { planApi, cardApi, orderApi, assetApi, userApi, settingApi, logApi, overviewApi, authApi } from '../../lib/adminApi.js'
// 错误与格式化
import { ApiError, money, moneyPlain, datetime, fromNow, fileSize, syncQuery } from '../../lib/api.js'
// 权限与登录态
import { can, denyReason, admin, isSuper, roleLabel } from '../../composables/useAdminAuth.js'
// 二次确认弹窗（返回 Promise）
import { confirmAction } from '../../composables/useAdminConfirm.js'
// 状态映射 + 统一动作包装 + 复制
import {
  run, copyWithToast, planStatus, cardStatus, paymentStatus, fulfillmentStatus,
  assetStatus, entitlementStatus, entitlementSource, benefitKind, validityType,
  roleKind, logResultKind, toInt, clone, dayBefore, withQuery
} from '../../composables/useAdminKit.js'
// 轻提示
import { toastOk, toastWarn, toastErr } from '../../composables/useToast.js'
```

**接口调用一律用 `run()` 包一层**，它统一处理「成功 toast / 失败 toast / 收尾回调」：

```js
const result = await run(() => planApi.update(id, body), { ok: '套餐已保存' })
if (result === null) return   // 失败时 run 已经弹了错误提示
```

失败返回 `null`（注意：接口成功但返回空对象时也是对象，不会是 null）。

## 3. 页面骨架（照抄这个结构）

```vue
<template>
  <div class="adm-page">
    <!-- ① 页头：标题 + 一句话说明 + 主操作按钮 -->
    <div class="adm-pagehead">
      <div>
        <h1>卡密管理</h1>
        <p>说明这段业务规则，特别是「什么情况不能做」。</p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn adm-btn--primary" type="button" @click="openGenerate">生成卡密</button>
      </div>
    </div>

    <!-- ② 业务提示（可选）：支付未接入、密钥未配置这类必须让运营知道的事实 -->
    <div class="adm-note">…</div>

    <!-- ③ 工具条：搜索 + 筛选 + 右侧次要操作 -->
    <div class="adm-toolbar">
      <input v-model="filters.keyword" class="adm-input" placeholder="搜索卡密 / 批次 / 订单号" @keyup.enter="reload(1)">
      <select v-model="filters.status" class="adm-select" @change="reload(1)">
        <option value="">全部状态</option>
        <option value="unused">未使用</option>
      </select>
      <div class="adm-toolbar__right">
        <button class="adm-btn adm-btn--sm" type="button" @click="reload(1)">查询</button>
        <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
      </div>
    </div>

    <!-- ④ 列表 -->
    <AdminTable :columns="columns" :rows="rows" :loading="loading" empty-title="还没有卡密" empty-hint="点右上角「生成卡密」按套餐批量生成">
      <template #cell-code_masked="{ row }">…</template>
      <template #cell-actions="{ row }">…</template>
      <template #empty-action>
        <button class="adm-btn adm-btn--primary" type="button" @click="openGenerate">生成卡密</button>
      </template>
    </AdminTable>

    <AdminPager v-model:page="page" v-model:page-size="pageSize" :total="total" @update:page="reload" @update:page-size="reload(1)" />

    <!-- ⑤ 弹窗（表单 / 详情） -->
    <AdminModal v-model="editOpen" title="新建套餐" size="lg">…</AdminModal>
  </div>
</template>
```

`reload` 统一这样写（不要每个页面各写一套 loading / 错误处理）：

```js
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

async function reload(toPage = page.value) {
  page.value = toPage
  loading.value = true
  try {
    const data = await planApi.list({ ...filters.value, page: page.value, page_size: pageSize.value })
    rows.value = data.list || []
    total.value = data.total || 0
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载失败，请重试')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}
onMounted(() => reload(1))
```

**筛选条件要同步到地址栏**（刷新后不丢），用 `syncQuery(router, route, patch)`，并在 `onMounted` 里从 `route.query` 读回初始值。

## 4. 交互硬要求（来自后台需求文档，会被逐项验收）

1. **高风险操作必须二次确认**：删除、作废、确认收款、发卡、导出、停用分类/素材/账号。
   用 `confirmAction({...})`，危险操作用 `danger: true`，需要留原因时用 `reasonRequired: true`：

```js
const ok = await confirmAction({
  title: '作废卡密',
  message: `确认作废选中的 ${selected.value.length} 张卡密？`,
  detail: '作废后不能兑换。如果这些卡密已经发给客户，请先与客户确认。',
  confirmText: '确认作废',
  danger: true,
  reasonRequired: true,
  reasonLabel: '作废原因'
})
if (!ok) return
await run(() => cardApi.void(selected.value, ok.reason), { ok: '已作废' })
```

2. **不能只隐藏按钮**：没有权限时按钮保留但 `disabled`，并用 `title` 显示 `denyReason('card.export')`。
   例如：`:disabled="!can('card.export')" :title="can('card.export') ? '' : denyReason('card.export')"`。
3. **空状态给出下一步**：`AdminTable` 的 `empty-hint` + `#empty-action` 插槽。
4. **加载中要有骨架**（`AdminTable` 的 `loading` 已经处理），**失败要提示并保留页面可用**。
5. **数量、金额、时间格式统一**：金额用 `money()` / `moneyPlain()`，时间用 `datetime()` / `fromNow()`，
   文件大小用 `fileSize()`。不要自己 `toLocaleString`。
6. **表单要有默认值、输入提示与校验**：必填用 `<em>*</em>` 标出，校验不通过用 `toastWarn` 说明原因，
   不要在提交前静默返回。数字输入用 `type="number"` 并给 `min` / `step`。
7. **危险信息要显眼**：未接入支付、卡密密钥未配置、已发放未兑换的卡密被作废等，
   用 `.adm-note--warn` / `.adm-note--danger` 明确写出来，不要藏在 tooltip 里。
8. **列表默认只展示业务需要的字段**，敏感字段脱敏（卡密用 `code_masked`，
   只有 `can('card.reveal')` 时才显示明文按钮并且每次都要走确认弹窗）。

## 5. 可用样式 class（不需要自己写 CSS）

布局：`adm-page` `adm-pagehead` `adm-pagehead__actions` `adm-split` `adm-stack` `adm-row`
`adm-grid-2` `adm-grid-3` `adm-form` `adm-form--2` `adm-form--3` `adm-field` `adm-field--full` `adm-hint`

卡片与数字：`adm-card` `adm-card--flat` `adm-card__head` `adm-card__head__actions` `adm-kpis` `adm-kpi`
`adm-kpi__label` `adm-kpi__value` `adm-kpi__hint` `adm-kpi--accent`

表单控件：`adm-input` `adm-input--sm` `adm-select` `adm-textarea` `adm-check` `adm-checks` `adm-switch`
`adm-repeat` `adm-repeat__row`

按钮：`adm-btn` + `adm-btn--primary` / `--danger` / `--ghost` / `--sm` / `--block`；文字按钮 `adm-link`

工具条：`adm-toolbar` `adm-toolbar__right` `adm-chips` `adm-chip`（选中加 `.on`）

表格：`adm-tablewrap` `adm-table`（内部由 AdminTable 渲染）、`adm-table__thumb`、`adm-strong`、`adm-mono`
`adm-muted` `adm-2xs` `adm-nowrap`、`adm-tag` + `adm-tag--ok|warn|danger|info|primary`

提示：`adm-note` `adm-note--warn` `adm-note--danger` `adm-note--muted`；空态 `adm-empty`
素材卡片：`adm-assetgrid` `adm-assetcard` `adm-assetcard__img` `adm-assetcard__body` `adm-assetcard__title`
上传：`adm-drop`（拖拽区，拖入时加 `.on`）、`adm-progress` `adm-progress__bar`、`adm-preview`
权限矩阵：`adm-perms` `adm-perms__item`

## 6. 禁止事项

- 不要改 `src/router/index.js`、`src/App.vue`、`src/components/admin/*` 这些已经写好的文件。
- 不要改前台任何页面（`src/views/*.vue` 里非 admin 目录的文件）。
- 不要写 `alert()` / `confirm()`；统一用 toast 与 `confirmAction`。
- 不要把接口错误信息拼成英文；服务端返回的 `message` 已经是中文，直接用。
- 不要伪造数据：拿不到的数据显示「—」或空态，不要编一个看起来合理的数字。
