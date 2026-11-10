<script setup>
/* =========================================================================
   用户数据
   一页看清三件事：多少人注册、多少人登录、网站被打开多少次。
   人数按账号去重，次数按动作累加。把自己的账号或浏览器标出来之后，
   数字仍然算在总数里，卡片上另写「其中自己」。
   ========================================================================= */

import { computed, onMounted, ref } from 'vue'

import AdminTable from '../../components/admin/AdminTable.vue'
import AdminTag from '../../components/admin/AdminTag.vue'

import { activityApi } from '../../lib/adminApi.js'
import { ApiError, datetime, fromNow } from '../../lib/api.js'
import { visitorId } from '../../lib/telemetry.js'
import { toastErr, toastOk } from '../../composables/useToast.js'

const DAY_OPTIONS = [
  { value: 7, label: '最近 7 天' },
  { value: 30, label: '最近 30 天' },
  { value: 90, label: '最近 90 天' }
]

const PATH_LABELS = {
  '/': '首页',
  '/editor': '创作工作台',
  '/create': '操作台',
  '/library': '素材中心',
  '/projects': '我的作品',
  '/materials': '素材中心',
  '/account': '我的账户'
}

const days = ref(30)
const data = ref(null)
const loading = ref(false)
const error = ref('')
const saving = ref(false)

const people = computed(() => (data.value && data.value.people) || {})
const events = computed(() => (data.value && data.value.events) || {})
const traffic = computed(() => (data.value && data.value.traffic) || {})
const selfPeople = computed(() => (data.value && data.value.self && data.value.self.people) || {})
const selfEvents = computed(() => (data.value && data.value.self && data.value.self.events) || {})
const selfTraffic = computed(() => (data.value && data.value.self && data.value.self.traffic) || {})
const marks = computed(() => (data.value && data.value.marks) || [])
const accounts = computed(() => (data.value && data.value.accounts) || [])
const visitors = computed(() => ((data.value && data.value.visitors) || []).map((row, index) => ({
  ...row,
  _key: `${row.token || 'v'}-${row.user_id || 0}-${index}`
})))
const hasMarks = computed(() => marks.value.length > 0)
const windowLabel = computed(() => {
  const w = data.value && data.value.window
  if (!w) return ''
  return `${w.from} ~ ${w.to}`
})

function num(v) {
  return Number(v || 0).toLocaleString('zh-CN')
}

/** 有标注时在原说明后面加上「其中自己」，没有标注就不写 0。 */
function hint(base, selfCount) {
  if (!hasMarks.value) return base
  return `${base} · 其中自己 ${num(selfCount)}`
}

const peopleCards = computed(() => [
  {
    label: '累计注册人数',
    value: people.value.registered_total,
    hint: hint('到现在为止的账号', selfPeople.value.registered_total),
    accent: true
  },
  {
    label: '今日注册人数',
    value: people.value.registered_today,
    hint: hint('今天新建的账号', selfPeople.value.registered_today)
  },
  {
    label: '这段时间注册人数',
    value: people.value.registered_window,
    hint: hint(windowLabel.value || '所选时间里新建的账号', selfPeople.value.registered_window)
  },
  {
    label: '今日登录人数',
    value: people.value.logged_in_today,
    hint: hint('今天登录过的账号，每人只计一次', selfPeople.value.logged_in_today),
    accent: true
  },
  {
    label: '这段时间登录人数',
    value: people.value.logged_in_window,
    hint: hint('登录过的账号，每人只计一次', selfPeople.value.logged_in_window)
  }
])

const eventCards = computed(() => [
  {
    label: '今日注册次数',
    value: events.value.registers_today,
    hint: hint('记下来的注册动作', selfEvents.value.registers_today)
  },
  {
    label: '这段时间注册次数',
    value: events.value.registers_window,
    hint: hint(windowLabel.value || '所选时间里的注册动作', selfEvents.value.registers_window)
  },
  {
    label: '今日登录次数',
    value: events.value.logins_today,
    hint: hint('同一个人登录多次会累加', selfEvents.value.logins_today),
    accent: true
  },
  {
    label: '这段时间登录次数',
    value: events.value.logins_window,
    hint: hint('同一个人登录多次会累加', selfEvents.value.logins_window)
  }
])

const trafficCards = computed(() => [
  {
    label: '今日访问量',
    value: traffic.value.pv_today,
    hint: hint('今天页面被打开的次数', selfTraffic.value.pv_today),
    accent: true
  },
  {
    label: '今日访客',
    value: traffic.value.uv_today,
    hint: hint('按浏览器计，含未登录', selfTraffic.value.uv_today)
  },
  {
    label: '这段时间访问量',
    value: traffic.value.pv_window,
    hint: hint(windowLabel.value || '所选时间里页面被打开的次数', selfTraffic.value.pv_window)
  },
  {
    label: '这段时间访客',
    value: traffic.value.uv_window,
    hint: hint('按浏览器去重，含未登录', selfTraffic.value.uv_window)
  }
])

const accountColumns = [
  { key: 'username', label: '账号' },
  { key: 'created_at', label: '注册时间', nowrap: true },
  { key: 'logins', label: '登录次数', align: 'right' },
  { key: 'actions', label: '标注' }
]

const visitorColumns = [
  { key: 'visitor', label: '浏览器' },
  { key: 'username', label: '登录账号' },
  { key: 'page_views', label: '访问次数', align: 'right' },
  { key: 'last_seen_at', label: '最近来过', nowrap: true },
  { key: 'actions', label: '标注' }
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await activityApi.pulse({ days: days.value })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '用户数据加载失败，请重试'
    data.value = null
  } finally {
    loading.value = false
  }
}

async function runMark(work, okText) {
  if (saving.value) return
  saving.value = true
  try {
    await work()
    toastOk(okText)
    await load()
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '标注失败，请重试')
  } finally {
    saving.value = false
  }
}

function markBrowser() {
  return runMark(
    () => activityApi.addSelf({ kind: 'visitor', value: visitorId(), label: '自己的浏览器' }),
    '已把当前浏览器标为自己'
  )
}

function markAccount(row) {
  return runMark(
    () => activityApi.addSelf({
      kind: 'user',
      value: String(row.user_id),
      label: `自己的账号（${row.username || row.user_id}）`
    }),
    '已把这个账号标为自己'
  )
}

function markVisitor(row) {
  return runMark(
    () => activityApi.addSelf({
      kind: 'visitor',
      value: row.token,
      label: row.username ? `自己的浏览器（${row.username}）` : '自己的浏览器'
    }),
    '已把这个浏览器标为自己'
  )
}

function unmark(id) {
  if (!window.confirm('取消这条「自己」标注？数字会按新的标注重算。')) return
  return runMark(() => activityApi.deleteSelf(id), '已取消标注')
}

function pathLabel(path) {
  return PATH_LABELS[path] || path || '—'
}

onMounted(load)
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>用户数据</h1>
        <p>
          注册人数、登录人数、登录和注册各发生了多少次，以及网站访问量。
          自己用的账号和浏览器标出来之后，总数不变，卡片上会写明其中有多少是自己。
          访客按浏览器计，清空数据、换设备或无痕窗口会算成新的访客。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <select v-model.number="days" class="adm-select" style="width:auto" @change="load">
          <option v-for="o in DAY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="adm-btn" type="button" :disabled="loading" @click="load">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="adm-note adm-note--danger">{{ error }}</div>

    <div v-if="!hasMarks && data" class="adm-note adm-note--muted">
      还没有把自己标出来。标上之后，数字旁边会写「其中自己」。
    </div>

    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>自己</h2>
        <span class="adm-muted">标过的访问仍算在总数里</span>
      </div>
      <div class="adm-toolbar">
        <button class="adm-btn" type="button" :disabled="saving" @click="markBrowser">
          把我这个浏览器标为自己
        </button>
      </div>
      <div v-if="hasMarks" class="adm-row" style="flex-wrap:wrap;gap:8px;padding:0 16px 14px">
        <span v-for="mark in marks" :key="mark.id" class="adm-row" style="gap:6px">
          <AdminTag :text="mark.kind_label || '自己'" kind="primary" />
          <b>{{ mark.username || mark.value }}</b>
          <span v-if="mark.label" class="adm-muted adm-2xs">{{ mark.label }}</span>
          <button class="adm-btn adm-btn--sm" type="button" :disabled="saving" @click="unmark(mark.id)">取消</button>
        </span>
      </div>
    </section>

    <div class="adm-card__head" style="padding:14px 0 8px;border:0">
      <h2>人数</h2>
      <span class="adm-muted">一个账号只计一次</span>
    </div>
    <div class="adm-kpis">
      <div v-for="kpi in peopleCards" :key="kpi.label" class="adm-kpi" :class="{ 'adm-kpi--accent': kpi.accent }">
        <span class="adm-kpi__label">{{ kpi.label }}</span>
        <span v-if="loading && !data" class="adm-skeleton" style="height:26px;width:70%" />
        <span v-else class="adm-kpi__value">{{ num(kpi.value) }}</span>
        <span class="adm-kpi__hint">{{ kpi.hint }}</span>
      </div>
    </div>

    <div class="adm-card__head" style="padding:14px 0 8px;border:0">
      <h2>登录与注册次数</h2>
      <span class="adm-muted">同一个人可以发生多次</span>
    </div>
    <div class="adm-kpis">
      <div v-for="kpi in eventCards" :key="kpi.label" class="adm-kpi" :class="{ 'adm-kpi--accent': kpi.accent }">
        <span class="adm-kpi__label">{{ kpi.label }}</span>
        <span v-if="loading && !data" class="adm-skeleton" style="height:26px;width:70%" />
        <span v-else class="adm-kpi__value">{{ num(kpi.value) }}</span>
        <span class="adm-kpi__hint">{{ kpi.hint }}</span>
      </div>
    </div>

    <div class="adm-card__head" style="padding:14px 0 8px;border:0">
      <h2>访问量</h2>
      <span class="adm-muted">页面被打开的次数，访客按浏览器计</span>
    </div>
    <div class="adm-kpis">
      <div v-for="kpi in trafficCards" :key="kpi.label" class="adm-kpi" :class="{ 'adm-kpi--accent': kpi.accent }">
        <span class="adm-kpi__label">{{ kpi.label }}</span>
        <span v-if="loading && !data" class="adm-skeleton" style="height:26px;width:70%" />
        <span v-else class="adm-kpi__value">{{ num(kpi.value) }}</span>
        <span class="adm-kpi__hint">{{ kpi.hint }}</span>
      </div>
    </div>

    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>账号</h2>
        <span class="adm-muted">按最近登录排列。登录次数是上面所选时间里的次数。</span>
      </div>
      <AdminTable
        :columns="accountColumns"
        :rows="accounts"
        :loading="loading && !data"
        row-key="user_id"
        min-width="720px"
        empty-title="还没有账号"
        empty-hint="有人注册之后，会出现在这里。"
      >
        <template #cell-username="{ row }">
          <b>{{ row.nickname || row.username }}</b>
          <AdminTag v-if="row.self" text="自己" kind="primary" />
          <div class="adm-2xs adm-muted adm-mono">{{ row.username }} · #{{ row.user_id }}</div>
        </template>
        <template #cell-created_at="{ row }">{{ datetime(row.created_at) }}</template>
        <template #cell-logins="{ row }">{{ num(row.logins) }}</template>
        <template #cell-actions="{ row }">
          <button
            v-if="row.mark_id"
            class="adm-btn adm-btn--sm" type="button" :disabled="saving"
            @click="unmark(row.mark_id)"
          >取消标注</button>
          <button
            v-else
            class="adm-btn adm-btn--sm" type="button" :disabled="saving"
            @click="markAccount(row)"
          >标为自己</button>
        </template>
      </AdminTable>
    </section>

    <section class="adm-card adm-card--flat">
      <div class="adm-card__head">
        <h2>最近访客</h2>
        <span class="adm-muted">这段时间来过的浏览器。访问次数是累计的。</span>
      </div>
      <AdminTable
        :columns="visitorColumns"
        :rows="visitors"
        :loading="loading && !data"
        row-key="_key"
        min-width="760px"
        empty-title="这段时间还没有访客"
        empty-hint="有人打开网站之后，会出现在这里。"
      >
        <template #cell-visitor="{ row }">
          <span class="adm-mono">{{ row.visitor }}</span>
          <AdminTag v-if="row.self" text="自己" kind="primary" />
          <div class="adm-2xs adm-muted">{{ pathLabel(row.last_path) }}</div>
        </template>
        <template #cell-username="{ row }">
          <span v-if="row.username">{{ row.username }}</span>
          <span v-else class="adm-muted">未登录</span>
        </template>
        <template #cell-page_views="{ row }">{{ num(row.page_views) }}</template>
        <template #cell-last_seen_at="{ row }">
          <span :title="datetime(row.last_seen_at)">{{ fromNow(row.last_seen_at) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <button
            v-if="row.mark_id"
            class="adm-btn adm-btn--sm" type="button" :disabled="saving"
            @click="unmark(row.mark_id)"
          >取消标注</button>
          <button
            v-else
            class="adm-btn adm-btn--sm" type="button" :disabled="saving"
            @click="markVisitor(row)"
          >标为自己</button>
        </template>
      </AdminTable>
    </section>
  </div>
</template>
