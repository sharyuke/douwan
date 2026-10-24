<script setup>
/* =========================================================================
   管理员管理（后台需求 §3.2）
   - 只有超级管理员能进这个页面（服务端 /admin/admins 整组要求 RequireSuper）
   - 保护规则里「是不是最后一个超级管理员」前端判断不准，所以不自己猜：
     请求照发，把后端返回的中文原因原样 toast 出来，页面上提前说明
   - 前端隐藏 / 禁用按钮不是权限保护，服务端会再校验一次
   ========================================================================= */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, datetime, fromNow, syncQuery } from '../../lib/api.js'
import { authApi } from '../../lib/adminApi.js'
import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'
import PixelIcon from '../../components/ui/PixelIcon.vue'
import { admin, can, denyReason } from '../../composables/useAdminAuth.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import { run, roleKind, toInt } from '../../composables/useAdminKit.js'
import { toastErr, toastWarn } from '../../composables/useToast.js'

const route = useRoute()
const router = useRouter()

/** 权限点 → 中文名。与 useAdminAuth 的 denyReason 保持同一套说法 */
const PERM_LABELS = {
  'plan.manage': '套餐管理',
  'card.view': '查看卡密',
  'card.reveal': '查看卡密明文',
  'card.generate': '生成卡密',
  'card.export': '导出卡密',
  'card.revoke': '作废卡密',
  'order.view': '查看订单',
  'order.settle': '确认收款与发卡',
  'order.refund': '退款处理',
  'asset.view': '查看素材',
  'asset.manage': '素材管理',
  'user.view': '查看用户',
  'entitlement.view': '查看兑换记录',
  'entitlement.grant': '发放权益',
  'setting.view': '查看系统设置',
  'setting.manage': '修改系统设置',
  'admin.manage': '管理员管理',
  'log.view': '查看操作日志',
  'overview.view': '查看数据概览'
}

const columns = [
  { key: 'username', label: '账号', width: '150px' },
  { key: 'nickname', label: '昵称', width: '120px' },
  { key: 'role', label: '角色', width: '110px' },
  { key: 'status', label: '状态', width: '84px' },
  { key: 'permissions', label: '权限', width: '190px' },
  { key: 'last_login', label: '最近登录', width: '170px' },
  { key: 'remark', label: '备注', width: '150px' },
  { key: 'created_at', label: '创建时间', width: '132px', nowrap: true },
  { key: 'actions', label: '操作', width: '132px', align: 'right' }
]

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

const filters = reactive({
  keyword: '',
  role: '',
  status: ''
})

/** 角色选项来自 authApi.permissions().roles：[{ value, label, hint }] */
const roleOptions = ref([])

/** 当前打开的管理面板（某一个管理员） */
const panelOpen = ref(false)
const panelRow = ref(null)

const editOpen = ref(false)
const editForm = reactive({ nickname: '', remark: '', role: '' })

const pwdOpen = ref(false)
const pwdForm = reactive({ password: '', confirm: '' })

const createOpen = ref(false)
const createForm = reactive({ username: '', password: '', nickname: '', role: '', remark: '' })

const permOpen = ref(false)
const permRow = ref(null)

const canManage = computed(() => can('admin.manage'))

/** 权限点名称，未知的权限点原样显示（不要假装认识） */
function permLabel(perm) {
  return PERM_LABELS[perm] || perm
}

function roleText(row) {
  if (!row) return '—'
  if (row.role_label) return row.role_label
  const opt = roleOptions.value.find(r => r.value === row.role)
  return opt ? opt.label : (row.role || '—')
}

/** 只按角色值取中文名（新建 / 改角色时用） */
function roleLabelOf(role) {
  const opt = roleOptions.value.find(r => r.value === role)
  return opt ? opt.label : (role || '—')
}

function roleHint(role) {
  const opt = roleOptions.value.find(r => r.value === role)
  return opt ? opt.hint : ''
}

function permList(row) {
  return Array.isArray(row && row.permissions) ? row.permissions : []
}

function permSummary(row) {
  const list = permList(row)
  if (!list.length) return '—'
  const head = list.slice(0, 2).map(permLabel).join('、')
  return list.length > 2 ? `${head} 等 ${list.length} 项` : `${head}（${list.length} 项）`
}

function isSelf(row) {
  return !!(row && admin.value && row.id === admin.value.id)
}

/** 自己不能停用 / 删除自己：按钮提前禁用，并把原因写在 title 上 */
function selfGuard(row) {
  return isSelf(row) ? '不能停用或删除自己的账号，请用另一个超级管理员账号操作' : ''
}

function actionDenyTitle(row) {
  const reason = selfGuard(row)
  if (reason) return reason
  if (!canManage.value) return denyReason('admin.manage')
  return ''
}

function statusText(row) {
  return toInt(row.status, 0) === 1 ? '正常' : '已停用'
}

function statusKind(row) {
  return toInt(row.status, 0) === 1 ? 'ok' : 'danger'
}

function targetTitle(row) {
  if (!row) return ''
  return `${row.nickname || row.username || ''}（${row.username || ''}）`
}

/* ------------------------------------------------------------- 列表加载 */

function pickText(value) {
  return typeof value === 'string' ? value : ''
}

function readQuery() {
  filters.keyword = pickText(route.query.keyword)
  filters.role = pickText(route.query.role)
  filters.status = pickText(route.query.status)
  const p = Number(route.query.page)
  page.value = Number.isInteger(p) && p > 0 ? p : 1
  const size = Number(route.query.page_size)
  pageSize.value = [10, 20, 50, 100].includes(size) ? size : 20
}

async function reload(toPage = page.value) {
  page.value = toPage
  loading.value = true
  try {
    const data = await authApi.listAdmins({
      keyword: filters.keyword,
      role: filters.role,
      status: filters.status,
      page: page.value,
      page_size: pageSize.value
    })
    rows.value = (data && data.list) || []
    total.value = (data && data.total) || 0
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '管理员列表加载失败，请重试')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  syncQuery(router, route, {
    keyword: filters.keyword,
    role: filters.role,
    status: filters.status,
    page: 1,
    page_size: pageSize.value
  })
  reload(1)
}

function resetFilters() {
  filters.keyword = ''
  filters.role = ''
  filters.status = ''
  syncQuery(router, route, { keyword: '', role: '', status: '', page: 1, page_size: pageSize.value })
  reload(1)
}

function changePage(p) {
  syncQuery(router, route, { page: p, page_size: pageSize.value })
  reload(p)
}

function changePageSize(size) {
  pageSize.value = size
  syncQuery(router, route, { page: 1, page_size: size })
  reload(1)
}

async function loadRoleOptions() {
  try {
    const data = await authApi.permissions()
    const list = (data && data.roles) || []
    roleOptions.value = Array.isArray(list) ? list : []
  } catch (e) {
    roleOptions.value = []
  }
}

/* --------------------------------------------------------------- 新建 */

function openCreate() {
  const preferred = roleOptions.value.find(r => r.value === 'viewer') || roleOptions.value[0]
  createForm.username = ''
  createForm.password = ''
  createForm.nickname = ''
  createForm.role = preferred ? preferred.value : ''
  createForm.remark = ''
  createOpen.value = true
}

async function submitCreate() {
  const username = createForm.username.trim()
  if (!/^[A-Za-z0-9]{3,32}$/.test(username)) {
    toastWarn('用户名必须是 3~32 位字母或数字，不能包含空格与特殊符号')
    return
  }
  if (createForm.password.length < 10) {
    toastWarn('密码至少 10 位，建议包含大小写字母、数字与符号')
    return
  }
  if (!createForm.role) {
    toastWarn('请选择角色，不同角色的权限差别很大')
    return
  }

  const ok = await confirmAction({
    title: '新建管理员',
    message: `确认创建管理员「${username}」，角色：${roleLabelOf(createForm.role)}？`,
    detail: roleHint(createForm.role) || '创建后请把初始密码单独发给本人，并提醒他尽快修改。'
  })
  if (!ok) return

  const result = await run(
    () => authApi.createAdmin({
      username,
      password: createForm.password,
      nickname: createForm.nickname.trim(),
      role: createForm.role,
      remark: createForm.remark.trim()
    }),
    { ok: '管理员已创建' }
  )
  if (result === null) return
  createOpen.value = false
  reload(1)
}

/* --------------------------------------------------------------- 修改 */

function openEdit(row) {
  panelRow.value = row
  editForm.nickname = row.nickname || ''
  editForm.remark = row.remark || ''
  editForm.role = row.role || ''
  editOpen.value = true
}

async function submitEdit() {
  const row = panelRow.value
  if (!row) return
  const nickname = editForm.nickname.trim()
  if (!nickname) {
    toastWarn('昵称不能为空')
    return
  }
  const roleChanged = editForm.role !== row.role

  if (roleChanged) {
    const ok = await confirmAction({
      title: '修改管理员角色',
      message: `确认把「${row.username}」的角色从「${roleText(row)}」改成「${roleLabelOf(editForm.role)}」？`,
      detail: `角色决定这个人能做什么：${roleHint(editForm.role) || '请确认新角色的权限范围符合预期'}。${
        isSelf(row) ? '你正在修改自己的账号，如果因此失去超级管理员权限，可能会把自己锁在后台管理之外。' : ''
      }`,
      confirmText: '确认改角色',
      danger: true,
      reasonRequired: true,
      reasonLabel: '改角色原因',
      reasonHint: '原因会记录到操作日志，方便事后追溯'
    })
    if (!ok) return
  }

  const result = await run(
    () => authApi.updateAdmin(row.id, { nickname, remark: editForm.remark.trim(), role: editForm.role }),
    { ok: '管理员已更新' }
  )
  if (result === null) return
  editOpen.value = false
  reload(page.value)
}

/* ----------------------------------------------------------- 重置密码 */

function openResetPassword(row) {
  panelRow.value = row
  pwdForm.password = ''
  pwdForm.confirm = ''
  pwdOpen.value = true
}

async function submitResetPassword() {
  const row = panelRow.value
  if (!row) return
  if (pwdForm.password.length < 10) {
    toastWarn('新密码至少 10 位')
    return
  }
  if (pwdForm.password !== pwdForm.confirm) {
    toastWarn('两次输入的密码不一致')
    return
  }

  const ok = await confirmAction({
    title: '重置管理员密码',
    message: `确认重置「${row.username}」的密码？`,
    detail: '重置后对方当前的登录状态不会立刻失效，但下次登录必须用新密码。请通过安全渠道把新密码交给本人。',
    confirmText: '确认重置',
    danger: true,
    reasonRequired: true,
    reasonLabel: '重置原因',
    reasonHint: '例如：本人忘记密码，已核验身份'
  })
  if (!ok) return

  const result = await run(() => authApi.resetAdminPassword(row.id, pwdForm.password), { ok: '密码已重置' })
  if (result === null) return
  pwdOpen.value = false
  panelOpen.value = false
}

/* ----------------------------------------------------------- 启用停用 */

async function toggleStatus(row) {
  const current = toInt(row.status, 0) === 1
  if (current && isSelf(row)) {
    toastWarn('不能停用自己的账号')
    return
  }

  if (current) {
    const ok = await confirmAction({
      title: '停用管理员',
      message: `确认停用「${row.username}」？`,
      detail: '停用后该账号不能再登录后台，已登录的会话在令牌过期后失效。这是「保留账号但暂停使用」的做法，比删除更容易恢复。',
      confirmText: '确认停用',
      danger: true,
      reasonRequired: true,
      reasonLabel: '停用原因',
      reasonHint: '例如：人员离职 / 岗位调整，原因会记入操作日志'
    })
    if (!ok) return
    const result = await run(() => authApi.setAdminStatus(row.id, 0, ok.reason), { ok: '账号已停用' })
    if (result === null) return
  } else {
    const ok = await confirmAction({
      title: '启用管理员',
      message: `确认恢复「${row.username}」的后台登录权限？`,
      detail: `恢复后该账号将重新拥有「${roleText(row)}」的全部权限。`,
      confirmText: '确认启用'
    })
    if (!ok) return
    const result = await run(() => authApi.setAdminStatus(row.id, 1, ok.reason || ''), { ok: '账号已启用' })
    if (result === null) return
  }
  panelOpen.value = false
  reload(page.value)
}

/* --------------------------------------------------------------- 删除 */

async function removeAdmin(row) {
  if (isSelf(row)) {
    toastWarn('不能删除自己的账号')
    return
  }
  const ok = await confirmAction({
    title: '删除管理员',
    message: `确认删除「${row.username}」？`,
    detail: '删除后该账号立即失效且不能恢复，历史操作日志会保留。如果只是暂时不用这个账号，建议改成「停用」。',
    confirmText: '确认删除',
    danger: true,
    reasonRequired: true,
    reasonLabel: '删除原因',
    reasonHint: '至少 2 个字。注意：删除接口目前不接收原因参数，后端日志只记录「删除管理员账号」，这里填的原因仅用于当场核对，不会随请求发出去。'
  })
  if (!ok) return

  const result = await run(() => authApi.deleteAdmin(row.id), { ok: '管理员已删除' })
  if (result === null) return
  panelOpen.value = false
  reload(page.value)
}

/* ----------------------------------------------------------- 权限查看 */

function openPerms(row) {
  permRow.value = row
  permOpen.value = true
}

function openPanel(row) {
  panelRow.value = row
  panelOpen.value = true
}

onMounted(() => {
  readQuery()
  loadRoleOptions()
  reload(page.value)
})
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>管理员</h1>
        <p>
          这里管理的是「后台管理员账号」，与前台用户完全分开。管理员不能自助注册，
          只能由超级管理员创建；每个操作都会写进操作日志。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="reload(page)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="!canManage"
          :title="canManage ? '' : denyReason('admin.manage')"
          @click="openCreate"
        >新建管理员</button>
      </div>
    </div>

    <div class="adm-note">
      <b>权限模型（服务端按角色判定）</b><br>
      超级管理员：全部权限，含管理员管理与支付密钥；<br>
      运营管理员：素材、订单、卡密（不能查看明文与导出）、用户与兑换记录，不能改支付密钥与系统安全设置；<br>
      只读账号：只能查看。
    </div>
    <div class="adm-note adm-note--warn">
      「最后一个可用的超级管理员不能降权、停用或删除」——这条规则由服务端统计，前端算不准。
      所以这里不提前猜，点了之后如果把后端返回的 403 中文原因提示出来，那就是真的被拦住了：
      需要先新建或启用另一个超级管理员，再操作这一个。
    </div>
    <div class="adm-note adm-note--muted">
      服务端会再校验一次权限，前端隐藏按钮不构成权限保护；即使这里看起来能点，服务端该拒绝的还是会拒绝。
    </div>

    <div class="adm-toolbar">
      <input
        v-model="filters.keyword"
        class="adm-input"
        type="search"
        placeholder="搜索账号 / 昵称 / 备注"
        @keyup.enter="search"
      >
      <select v-model="filters.role" class="adm-select" @change="search">
        <option value="">全部角色</option>
        <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <select v-model="filters.status" class="adm-select" @change="search">
        <option value="">全部状态</option>
        <option value="1">正常</option>
        <option value="0">已停用</option>
      </select>
      <div class="adm-toolbar__right">
        <button class="adm-btn adm-btn--sm" type="button" @click="search">查询</button>
        <button class="adm-btn adm-btn--sm" type="button" @click="resetFilters">重置</button>
      </div>
    </div>

    <AdminTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      min-width="1280px"
      empty-title="没有符合条件的管理员"
      empty-hint="换个关键字或清空筛选条件；也可以点右上角「新建管理员」添加一个运营管理员"
    >
      <template #cell-username="{ row }">
        <div class="adm-strong adm-mono">{{ row.username || '—' }}</div>
        <div v-if="isSelf(row)" class="adm-2xs adm-muted">当前登录账号</div>
      </template>

      <template #cell-nickname="{ row }">{{ row.nickname || '—' }}</template>

      <template #cell-role="{ row }">
        <AdminTag :text="roleText(row)" :kind="roleKind(row.role)" :title="roleHint(row.role)" />
      </template>

      <template #cell-status="{ row }">
        <AdminTag :text="statusText(row)" :kind="statusKind(row)" />
      </template>

      <template #cell-permissions="{ row }">
        <button class="adm-link" type="button" @click="openPerms(row)">{{ permSummary(row) }}</button>
      </template>

      <template #cell-last_login="{ row }">
        <template v-if="row.last_login_at">
          <div>{{ datetime(row.last_login_at) }}</div>
          <div class="adm-2xs adm-muted">{{ row.last_login_ip || '—' }}</div>
        </template>
        <span v-else class="adm-muted">从未登录</span>
      </template>

      <template #cell-remark="{ row }">
        <span :title="row.remark || ''">{{ row.remark || '—' }}</span>
      </template>

      <template #cell-created_at="{ row }">
        <span class="adm-nowrap" :title="datetime(row.created_at)">{{ datetime(row.created_at, { withTime: false }) }}</span>
      </template>

      <template #cell-actions="{ row }">
        <button
          class="adm-btn adm-btn--sm"
          type="button"
          :disabled="!canManage"
          :title="canManage ? '' : denyReason('admin.manage')"
          @click="openEdit(row)"
        >修改</button>
        <button
          class="adm-link"
          type="button"
          :disabled="!canManage"
          :title="canManage ? '' : denyReason('admin.manage')"
          @click="openPanel(row)"
        >更多</button>
      </template>

      <template #empty-action>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="!canManage" @click="openCreate">新建管理员</button>
      </template>
    </AdminTable>

    <AdminPager
      :total="total"
      :page="page"
      :page-size="pageSize"
      @update:page="changePage"
      @update:page-size="changePageSize"
    />

    <!-- 单个管理员的全部操作 -->
    <AdminModal v-model="panelOpen" :title="panelRow ? `管理：${targetTitle(panelRow)}` : '管理管理员'">
      <div v-if="panelRow" class="adm-stack">
        <div class="adm-note">
          账号 <span class="adm-mono">{{ panelRow.username }}</span> · 角色 {{ roleText(panelRow) }} ·
          状态 {{ statusText(panelRow) }}
          <template v-if="roleHint(panelRow.role)"><br>{{ roleHint(panelRow.role) }}</template>
        </div>

        <div class="adm-note" v-if="selfGuard(panelRow)">
          {{ selfGuard(panelRow) }}
        </div>

        <div class="adm-card adm-card--flat">
          <div class="adm-card__head">
            <h2>账号操作</h2>
            <span class="adm-muted">高风险操作会二次确认，并记入操作日志</span>
          </div>
          <div class="adm-form" style="padding:14px">
            <div class="adm-row">
              <button
                class="adm-btn"
                type="button"
                :disabled="!canManage"
                @click="openEdit(panelRow)"
              >修改昵称 / 角色 / 备注</button>
              <button
                class="adm-btn"
                type="button"
                :disabled="!canManage"
                @click="openResetPassword(panelRow)"
              >重置密码</button>
              <button
                class="adm-btn"
                type="button"
                :disabled="!canManage || (toInt(panelRow.status, 0) === 1 && isSelf(panelRow))"
                :title="toInt(panelRow.status, 0) === 1 && isSelf(panelRow) ? selfGuard(panelRow) : ''"
                @click="toggleStatus(panelRow)"
              >{{ toInt(panelRow.status, 0) === 1 ? '停用账号' : '启用账号' }}</button>
              <button
                class="adm-btn adm-btn--danger"
                type="button"
                :disabled="!canManage || isSelf(panelRow)"
                :title="isSelf(panelRow) ? selfGuard(panelRow) : ''"
                @click="removeAdmin(panelRow)"
              >删除账号</button>
            </div>
            <p class="adm-hint">
              停用只是暂停登录，随时可以恢复；删除不可恢复。人员离职建议先「停用」，确认没有遗留问题后再删除。
              <template v-if="panelRow.last_login_at">
                最近登录：{{ datetime(panelRow.last_login_at) }}（{{ fromNow(panelRow.last_login_at) }}），IP {{ panelRow.last_login_ip || '—' }}。
              </template>
            </p>
            <p class="adm-hint" v-if="panelRow.remark">备注：{{ panelRow.remark }}</p>
          </div>
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">关闭</button>
      </template>
    </AdminModal>

    <!-- 新建 -->
    <AdminModal v-model="createOpen" title="新建管理员" size="lg" :mask-closable="false">
      <div class="adm-form adm-form--2">
        <div class="adm-field">
          <label for="adm-new-username">用户名 <em>*</em></label>
          <input
            id="adm-new-username"
            v-model="createForm.username"
            class="adm-input"
            type="text"
            autocomplete="off"
            placeholder="3~32 位字母或数字，例如 ops01"
          >
          <p class="adm-hint">只能字母和数字，创建后不能修改。这是登录后台用的账号。</p>
        </div>

        <div class="adm-field">
          <label for="adm-new-nickname">昵称</label>
          <input
            id="adm-new-nickname"
            v-model="createForm.nickname"
            class="adm-input"
            type="text"
            placeholder="留空则与用户名相同"
          >
          <p class="adm-hint">列表与日志里显示的名字，建议写真实姓名或岗位。</p>
        </div>

        <div class="adm-field">
          <label for="adm-new-password">初始密码 <em>*</em></label>
          <input
            id="adm-new-password"
            v-model="createForm.password"
            class="adm-input"
            type="password"
            autocomplete="new-password"
            placeholder="至少 10 位"
          >
          <p class="adm-hint">至少 10 位。请通过安全渠道单独发给本人，不要发在群里。</p>
        </div>

        <div class="adm-field">
          <label for="adm-new-role">角色 <em>*</em></label>
          <select id="adm-new-role" v-model="createForm.role" class="adm-select">
            <option value="" disabled>请选择角色</option>
            <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <p class="adm-hint">
            {{ roleHint(createForm.role) || '角色的权限说明来自服务端，加载失败时会显示为空，请刷新页面重试' }}
          </p>
        </div>

        <div class="adm-field adm-field--full">
          <label for="adm-new-remark">备注</label>
          <input
            id="adm-new-remark"
            v-model="createForm.remark"
            class="adm-input"
            type="text"
            placeholder="例如：拼豆运营 - 小张，2026-10 入职"
          >
        </div>
      </div>

      <div class="adm-note adm-note--muted">
        创建出来的账号立刻可以登录后台。请提醒本人：收到初始密码后第一时间在「修改密码」里改掉。
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="!canManage" @click="submitCreate">创建管理员</button>
      </template>
    </AdminModal>

    <!-- 修改 -->
    <AdminModal v-model="editOpen" :title="panelRow ? `修改：${panelRow.username}` : '修改管理员'" size="lg">
      <div class="adm-form adm-form--2">
        <div class="adm-field">
          <label for="adm-edit-nickname">昵称 <em>*</em></label>
          <input id="adm-edit-nickname" v-model="editForm.nickname" class="adm-input" type="text" placeholder="请输入昵称">
        </div>

        <div class="adm-field">
          <label for="adm-edit-role">角色</label>
          <select id="adm-edit-role" v-model="editForm.role" class="adm-select">
            <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <p class="adm-hint">{{ roleHint(editForm.role) || '改角色会影响这个人能看到与能操作的范围，保存前会再确认一次。' }}</p>
        </div>

        <div class="adm-field adm-field--full">
          <label for="adm-edit-remark">备注</label>
          <input id="adm-edit-remark" v-model="editForm.remark" class="adm-input" type="text" placeholder="例如：岗位调整、负责范围">
        </div>
      </div>

      <div v-if="panelRow && editForm.role !== panelRow.role" class="adm-note adm-note--warn">
        角色将从「{{ roleText(panelRow) }}」变成「{{ roleLabelOf(editForm.role) }}」。
        {{ roleHint(editForm.role) || '' }}
        <template v-if="isSelf(panelRow)">你正在改自己的角色，如果降权会立刻失去后台管理入口。</template>
      </div>
      <div v-if="panelRow && isSelf(panelRow)" class="adm-note adm-note--muted">
        这是你自己的账号。用户名不能修改；如果要把自己的角色降权，请先确认还有另一个可用的超级管理员。
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" :disabled="!canManage" @click="submitEdit">保存修改</button>
      </template>
    </AdminModal>

    <!-- 重置密码 -->
    <AdminModal v-model="pwdOpen" :title="panelRow ? `重置密码：${panelRow.username}` : '重置密码'" size="sm" :mask-closable="false">
      <div class="adm-form">
        <div class="adm-field">
          <label for="adm-pwd-new">新密码 <em>*</em></label>
          <input
            id="adm-pwd-new"
            v-model="pwdForm.password"
            class="adm-input"
            type="password"
            autocomplete="new-password"
            placeholder="至少 10 位"
          >
        </div>
        <div class="adm-field">
          <label for="adm-pwd-confirm">再输一次 <em>*</em></label>
          <input
            id="adm-pwd-confirm"
            v-model="pwdForm.confirm"
            class="adm-input"
            type="password"
            autocomplete="new-password"
            placeholder="两次输入要一致"
          >
        </div>
      </div>
      <div class="adm-note adm-note--warn">
        重置密码会让对方下次登录必须使用新密码。请通过安全渠道告知本人，不要用聊天群里发密码。
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--danger" type="button" :disabled="!canManage" @click="submitResetPassword">确认重置</button>
      </template>
    </AdminModal>

    <!-- 权限清单 -->
    <AdminModal v-model="permOpen" :title="permRow ? `${permRow.username} 的权限点` : '权限点'" size="lg">
      <template v-if="permRow">
        <div class="adm-note">
          角色：{{ roleText(permRow) }}<template v-if="roleHint(permRow.role)"> —— {{ roleHint(permRow.role) }}</template>
          。下面是服务端返回的权限点清单，共 {{ permList(permRow).length }} 项。
        </div>
        <div v-if="permList(permRow).length" class="adm-perms">
          <div v-for="perm in permList(permRow)" :key="perm" class="adm-perms__item">
            <AdminTag text="允许" kind="ok" />
            <span>{{ permLabel(perm) }}</span>
          </div>
        </div>
        <div v-else class="adm-empty">
          <div class="adm-empty__icon"><PixelIcon name="lock" :size="28" /></div>
          <strong>这个账号没有任何权限点</strong>
          <p>账号可能已被停用，或者角色配置不完整，请联系超级管理员确认。</p>
        </div>

        <div class="adm-note adm-note--muted">
          上方只读展示服务端下发的权限点，后台不能在这里逐项勾选：权限是跟角色绑定的，改权限请改角色。
        </div>
      </template>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">关闭</button>
      </template>
    </AdminModal>
  </div>
</template>
