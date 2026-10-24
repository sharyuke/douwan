<script setup>
/* =========================================================================
   系统设置（后台需求 §10）
   - 设置项按分组展示，每组一张卡片，避免所有项堆成一列
   - 每种 type 用对应控件；secret 只返回脱敏值，提交空值表示「不修改」
   - 只提交被改动过的项；没有改动时明确告诉运营「没有需要保存的修改」
   ========================================================================= */
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiError, datetime } from '../../lib/api.js'
import { settingApi } from '../../lib/adminApi.js'
import PixelIcon from '../../components/ui/PixelIcon.vue'
import { can, denyReason, isSuper } from '../../composables/useAdminAuth.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import { run } from '../../composables/useAdminKit.js'
import { toastErr, toastWarn } from '../../composables/useToast.js'

const loading = ref(false)
const saving = ref(false)
/** 页面上的表单副本：{ [key]: 字符串值 } */
const draft = reactive({})
/** 服务端当前值：用来判断「改了哪几项」，secret 存的是脱敏串 */
const baseline = reactive({})
/** 设置项原始定义：{ [key]: item } */
const meta = reactive({})
/** 分组顺序：[{ group, label, keys: [] }] */
const groups = ref([])

const canManage = computed(() => can('setting.manage'))
const saveTitle = computed(() => {
  if (!canManage.value) return denyReason('setting.manage')
  if (!changedItems.value.length) return '还没有任何改动'
  return ''
})

/** 是否为空串（服务端把空值统一返回 ""） */
function isBlank(v) {
  return v === undefined || v === null || String(v) === ''
}

/** secret 项的「已配置（末 4 位：xxxx）」提示 */
function secretHint(item) {
  const raw = String(draft[item.key] ?? '')
  if (!raw) return '尚未配置任何密钥，前台不会走在线支付'
  return `已配置（末 4 位：${raw.slice(-4)}）`
}

/** 改动清单：只包含真正的改动，secret 留空表示不修改 */
const changedItems = computed(() => {
  const out = []
  for (const item of Object.values(meta)) {
    const now = String(draft[item.key] ?? '')
    if (item.secret && now.trim() === '') continue
    if (now !== String(baseline[item.key] ?? '')) {
      out.push({ key: item.key, label: item.label, value: now })
    }
  }
  return out
})

function resetDraft(items) {
  for (const k of Object.keys(draft)) delete draft[k]
  for (const k of Object.keys(baseline)) delete baseline[k]
  for (const k of Object.keys(meta)) delete meta[k]

  const order = []
  for (const item of items) {
    meta[item.key] = item
    const value = item.value === undefined || item.value === null ? '' : String(item.value)
    draft[item.key] = value
    baseline[item.key] = value
    const group = item.group || 'other'
    if (!order.some(g => g.group === group)) {
      order.push({ group, label: item.group_label || group, keys: [], hint: '' })
    }
    order.find(g => g.group === group).keys.push(item.key)
  }
  groups.value = order
}

async function reload() {
  loading.value = true
  try {
    const items = await settingApi.list()
    resetDraft(Array.isArray(items) ? items : [])
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '设置加载失败，请重试')
    resetDraft([])
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canManage.value) {
    toastWarn(denyReason('setting.manage'))
    return
  }
  const changed = changedItems.value
  if (!changed.length) {
    toastWarn('没有需要保存的修改')
    return
  }

  // 密钥类配置只有超级管理员能改，提前拦下来，不让整批保存因为一项失败而全部回滚
  const withSecret = changed.filter(c => meta[c.key] && meta[c.key].secret)
  let items = changed
  if (withSecret.length && !isSuper.value) {
    toastWarn(`「${withSecret.map(c => c.label).join('、')}」属于密钥类配置，只有超级管理员可以修改，本次不会提交这些项`)
    items = changed.filter(c => !(meta[c.key] && meta[c.key].secret))
    if (!items.length) return
  }

  const ok = await confirmAction({
    title: '保存系统设置',
    message: `确认保存这 ${items.length} 项修改？`,
    detail: items.map(c => `· ${c.label} → ${meta[c.key].secret ? '（写入新密钥）' : c.value === '' ? '（清空）' : c.value}`).join('\n'),
    confirmText: '保存修改',
    danger: false
  })
  if (!ok) return

  saving.value = true
  // 保存成功后重新拉取：服务端只会返回最新的脱敏值
  const result = await run(
    () => settingApi.update(items.map(c => ({ key: c.key, value: c.value }))),
    { ok: '设置已保存' }
  )
  if (result === null) {
    saving.value = false
    return
  }
  if (Array.isArray(result) && result.length) resetDraft(result)
  else await reload()
  saving.value = false
}

onMounted(() => reload())
</script>

<template>
  <div class="adm-page">
    <div class="adm-pagehead">
      <div>
        <h1>系统设置</h1>
        <p>
          这里的配置会直接影响前台展示与下单流程。带「密钥」的配置只会返回脱敏值，
          输入框留空表示保持原值不变；改完必须点底部「保存修改」才会生效。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <button class="adm-btn adm-btn--sm" type="button" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '重新加载' }}
        </button>
      </div>
    </div>

    <div class="adm-note adm-note--warn">
      当前系统没有接入在线支付渠道，订单只能由管理员在「订单管理」里人工确认收款后发放卡密。
    </div>
    <div class="adm-note adm-note--muted">
      AI 成本告警目前只是预留配置项：系统还没有 AI 调用成本数据，开启后也不会真正发出告警。
    </div>

    <div v-if="loading" class="adm-stack">
      <div v-for="n in 3" :key="`sk-${n}`" class="adm-card">
        <div class="adm-skeleton" style="width:34%;margin-bottom:12px" />
        <div class="adm-skeleton" style="width:70%" />
      </div>
    </div>

    <div v-else-if="!groups.length" class="adm-card">
      <div class="adm-empty">
        <div class="adm-empty__icon"><PixelIcon name="folder" :size="26" /></div>
        <strong>没有读到任何设置项</strong>
        <p>可能是服务端还没初始化默认设置，点右上角「重新加载」再试一次。</p>
      </div>
    </div>

    <div v-else class="adm-stack">
      <section v-for="g in groups" :key="g.group" class="adm-card">
        <div class="adm-card__head">
          <h2>{{ g.label }}</h2>
          <span class="adm-muted">共 {{ g.keys.length }} 项</span>
        </div>

        <div v-if="g.group === 'payment'" class="adm-note adm-note--warn">
          「启用在线支付」在接入真实支付渠道之前不要打开。没有渠道时即使打开，订单也收不到钱，
          前台会显示成「可在线支付」而实际无法付款，只能由管理员在「订单管理」人工确认收款。
        </div>
        <div v-else-if="g.group === 'ai'" class="adm-note adm-note--muted">
          这一组只是预留配置项：系统当前没有 AI 调用成本数据，开启告警也不会有真实数据触发。
        </div>

        <div class="adm-form adm-form--2">
          <div v-for="key in g.keys" :key="key" class="adm-field" :class="{ 'adm-field--full': meta[key].type === 'textarea' }">
            <label :for="`set-${key}`">
              {{ meta[key].label }}
              <span v-if="meta[key].public" class="adm-tag">前台可见</span>
              <span v-else class="adm-tag">仅后台</span>
              <span v-if="meta[key].secret" class="adm-tag adm-tag--warn">密钥</span>
            </label>

            <!-- 开关：值在接口里是字符串 "true" / "false" -->
            <label v-if="meta[key].type === 'switch'" class="adm-switch">
              <input :id="`set-${key}`" v-model="draft[key]" true-value="true" false-value="false" type="checkbox">
              <span>{{ draft[key] === 'true' ? '已启用' : '已关闭' }}</span>
            </label>

            <textarea
              v-else-if="meta[key].type === 'textarea'"
              :id="`set-${key}`"
              v-model="draft[key]"
              class="adm-textarea"
              rows="4"
              :placeholder="`请输入${meta[key].label}`"
            />

            <input
              v-else-if="meta[key].type === 'number'"
              :id="`set-${key}`"
              v-model="draft[key]"
              class="adm-input"
              type="number"
              :min="key === 'upload_max_mb' ? 1 : 0"
              :max="key === 'upload_max_mb' ? 100 : undefined"
              step="1"
            >

            <input
              v-else-if="meta[key].secret"
              :id="`set-${key}`"
              v-model="draft[key]"
              class="adm-input"
              type="password"
              autocomplete="new-password"
              placeholder="留空表示不修改"
              :disabled="!isSuper"
            >

            <input
              v-else
              :id="`set-${key}`"
              v-model="draft[key]"
              class="adm-input"
              type="text"
              :placeholder="`请输入${meta[key].label}`"
            >

            <p v-if="meta[key].secret" class="adm-hint">
              {{ secretHint(meta[key]) }} · 留空表示不修改。接口永远不回传明文，保存后会重新读取脱敏值。
              <span v-if="!isSuper">密钥类配置只有超级管理员可以修改。</span>
            </p>
            <p v-if="meta[key].description" class="adm-hint">{{ meta[key].description }}</p>
            <p v-if="meta[key].updated_at" class="adm-hint">最近更新：{{ datetime(meta[key].updated_at) }}</p>
          </div>
        </div>
      </section>
    </div>

    <div class="adm-toolbar">
      <span class="adm-muted">
        {{ changedItems.length ? `已改动 ${changedItems.length} 项，未保存前不会生效。` : '当前没有未保存的改动。' }}
      </span>
      <div class="adm-toolbar__right">
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="!canManage || !changedItems.length || saving"
          :title="saveTitle"
          @click="save"
        >{{ saving ? '保存中…' : '保存修改' }}</button>
      </div>
    </div>
  </div>
</template>
