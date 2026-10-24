<script setup>
/* =========================================================================
   卡密兑换面板（需求 §3.4 / §5.3）
   - 前台不要求注册登录：没有身份时自动创建「本机匿名身份」，再兑换卡密
   - 权益记录在服务端；localStorage 只保存匿名账号凭据与展示缓存
   - 清理浏览器数据 / 换设备可能无法自动恢复，界面上写清恢复边界
   - 老用户仍可手动登录已有账号
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import PixelIcon from './PixelIcon.vue'
import {
  isLoggedIn, isAnonymousDevice, displayName,
  login, logout, bootstrapDevice
} from '../../composables/useUserAccount.js'
import {
  redeemCard, redeemResult, backendReady, ensureBackend, syncServerEntitlements
} from '../../composables/useBackend.js'
import { api } from '../../lib/api.js'
import { toastOk, toastWarn, toastErr } from '../../composables/useToast.js'

const showLogin = ref(false)
const form = ref({ account: '', password: '' })
const busy = ref(false)
const code = ref('')
const lastResult = ref(null)
/* 套餐可能一条权益都没配（典型是还没配置就拿来试的草稿）：
   这种情况兑换接口也会返回成功，但一个功能都解锁不了，必须在结果里说清。 */
const lastResultGranted = computed(() => {
  const p = lastResult.value && lastResult.value.permissions
  return !!p && typeof p === 'object' && Object.keys(p).length > 0
})

onMounted(async () => {
  await bootstrapDevice()
  await ensureBackend()
  if (isLoggedIn.value) {
    await syncServerEntitlements()
    await refreshMyCards()
  }
})

async function submitLogin() {
  if (!form.value.account.trim() || !form.value.password) {
    toastWarn('请填写账号和密码')
    return
  }
  busy.value = true
  try {
    const result = await login({
      account: form.value.account.trim(),
      password: form.value.password
    })
    if (!result.ok) {
      toastErr(result.message || '登录失败')
      return
    }
    toastOk('登录成功')
    form.value = { account: '', password: '' }
    showLogin.value = false
    await Promise.all([syncServerEntitlements(), refreshMyCards()])
  } finally {
    busy.value = false
  }
}

async function doLogout() {
  await logout()
  redeemResult.value = null
  lastResult.value = null
  myCards.value = []
  toastOk('已退出登录')
}

/** 匿名身份想换成已有账号：先退出当前令牌，再展开登录表单。
    本机匿名身份的凭据仍留在浏览器里，下次兑换还能回到同一个身份。 */
async function switchToLogin() {
  await doLogout()
  showLogin.value = true
}

async function submitRedeem() {
  if (!code.value.trim()) {
    toastWarn('请输入卡密')
    return
  }
  if (!backendReady.value) {
    toastErr('当前无法连接服务端，兑换功能暂时不可用')
    return
  }
  busy.value = true
  try {
    // 没有身份时 redeemCard 会自动创建本机匿名身份（不需要用户注册）
    const res = await redeemCard(code.value)
    if (!res.ok) {
      toastErr(res.message)
      return
    }
    lastResult.value = res.result
    code.value = ''
    await Promise.all([syncServerEntitlements(), refreshMyCards()])
    const granted = res.result && res.result.permissions &&
      typeof res.result.permissions === 'object' &&
      Object.keys(res.result.permissions).length > 0
    if (granted) toastOk('兑换成功，权益已到账')
    else toastWarn('兑换成功，但这个套餐没有配置任何权益，请联系客服核验')
  } finally {
    busy.value = false
  }
}

/** 我兑换过的权益（卡密兑换 + 订单发放） */
const myCards = ref([])
async function refreshMyCards() {
  if (!isLoggedIn.value) {
    myCards.value = []
    return
  }
  try {
    const list = await api.get('/my/entitlements')
    myCards.value = Array.isArray(list) ? list : []
  } catch {
    myCards.value = []
  }
}

const identityLabel = computed(() => {
  if (!isLoggedIn.value) return '尚未创建本机身份'
  if (isAnonymousDevice.value) return '本机匿名身份'
  return '已登录账号'
})

function fmt(value) {
  if (!value) return '不限时长'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="redeemPanel">
    <!-- 未登录：默认走本机匿名身份，不需要注册 -->
    <template v-if="!isLoggedIn">
      <div class="deviceBox">
        <b>不需要注册，兑换时自动创建本机身份</b>
        <p class="redeemHint">
          第一次兑换时，系统会在这台浏览器里创建一个匿名身份，并把权益记录到服务端。
          你不需要填用户名、密码或手机号。
        </p>
        <p class="redeemHint warn">
          清理浏览器数据、换浏览器或换设备后，匿名身份可能无法自动恢复。
          请保留卡密；如果权益丢了，可以联系客服核验兑换记录。
        </p>
      </div>

      <template v-if="showLogin">
        <label class="redeemLabel">登录已有账号</label>
        <input v-model="form.account" type="text" placeholder="用户名 / 邮箱 / 手机号" autocomplete="username">
        <input
          v-model="form.password"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
          @keyup.enter="submitLogin"
        >
        <button class="btn primary block" :disabled="busy" @click="submitLogin">
          {{ busy ? '登录中…' : '登录' }}
        </button>
        <button class="linkBtn" @click="showLogin = false">返回匿名兑换</button>
      </template>

      <template v-else>
        <label class="redeemLabel">输入卡密</label>
        <input
          v-model="code"
          class="redeemCode"
          type="text"
          placeholder="例如 ABCD-EFGH-JKLM-NOPQ"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="submitRedeem"
        >
        <p class="redeemHint">大小写、空格、连字符都可以随意输入，系统会自动处理。</p>
        <button class="btn primary block" :disabled="busy" @click="submitRedeem">
          {{ busy ? '兑换中…' : '立即兑换' }}
        </button>
        <button class="linkBtn" @click="showLogin = true">已有账号？登录</button>
      </template>
    </template>

    <!-- 已有身份：兑换 -->
    <template v-else>
      <div class="redeemUser">
        <span>
          <span class="identityTag">{{ identityLabel }}</span>
          当前身份：<b>{{ displayName || '本机访客' }}</b>
        </span>
        <!-- 匿名身份不提供「退出」：它绑着已经兑换的权益，退出后没有账号密码可恢复。
             需要换账号时走「已有账号？登录」，先退出当前令牌再登录。 -->
        <button v-if="isAnonymousDevice" class="linkBtn" @click="switchToLogin">已有账号？登录</button>
        <button v-else class="linkBtn" @click="doLogout">退出登录</button>
      </div>
      <p v-if="isAnonymousDevice" class="redeemHint warn">
        这个身份只保存在当前浏览器。清理浏览器数据或换设备后可能无法自动恢复，请保留卡密或联系客服核验。
      </p>

      <label class="redeemLabel">输入卡密</label>
      <input
        v-model="code"
        class="redeemCode"
        type="text"
        placeholder="例如 ABCD-EFGH-JKLM-NOPQ"
        autocomplete="off"
        spellcheck="false"
        @keyup.enter="submitRedeem"
      >
      <p class="redeemHint">大小写、空格、连字符都可以随意输入，系统会自动处理。</p>

      <button class="btn primary block" :disabled="busy" @click="submitRedeem">
        {{ busy ? '兑换中…' : '立即兑换' }}
      </button>

      <!-- 兑换结果 -->
      <div v-if="lastResult" class="redeemResult">
        <b>{{ lastResult.message }}</b>
        <p v-if="!lastResultGranted" class="redeemHint warn" style="margin-top:6px">
          这张卡密对应的套餐没有配置任何权益，兑换记录已保存但功能不会解锁。
          请保留卡密并联系客服核验，我们会为你补发正确的套餐。
        </p>
        <ul>
          <li>套餐：{{ lastResult.plan_name }}</li>
          <li>生效时间：{{ fmt(lastResult.starts_at) }}</li>
          <li>到期时间：{{ fmt(lastResult.expires_at) }}</li>
          <li v-if="lastResult.usage_limit">可用额度：{{ lastResult.usage_limit }} 次</li>
        </ul>
        <ul v-if="lastResult.feature_text && lastResult.feature_text.length" class="redeemFeatures">
          <li v-for="t in lastResult.feature_text" :key="t"><PixelIcon name="check" :size="14" /> {{ t }}</li>
        </ul>
      </div>

      <!-- 我的权益 -->
      <div v-if="myCards.length" class="redeemMine">
        <b>我的权益</b>
        <div v-for="e in myCards" :key="e.id" class="redeemMine__row">
          <span>{{ e.plan_name }}</span>
          <span class="tag" :class="e.effective_status === 'active' ? 'free' : 'warn'">
            {{ e.effective_status === 'active' ? '生效中' : '已到期' }}
          </span>
          <span class="muted">{{ e.source_type === 'card_key' ? '卡密兑换' : '订单发放' }}</span>
          <span class="muted">{{ e.expires_at ? '至 ' + fmt(e.expires_at) : '不限时长' }}</span>
        </div>
      </div>

      <p v-if="!backendReady" class="redeemHint warn">
        当前无法连接服务端，兑换功能暂时不可用。图纸生成等本地功能不受影响。
      </p>
    </template>
  </div>
</template>

<style scoped>
.redeemPanel{display:flex;flex-direction:column;gap:11px}
.redeemHint{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8}
.redeemHint.warn{color:var(--orange-deep)}
.redeemLabel{font-size:var(--fs-xs);font-weight:750;color:var(--ink-2)}
.deviceBox{
  padding:12px 14px;border-radius:var(--r-md);background:var(--surface-2);
  border:1px solid var(--line);display:flex;flex-direction:column;gap:5px;
}
.deviceBox b{font-size:var(--fs-xs)}
.redeemCode{
  width:100%;padding:13px 15px;border:1px solid var(--line-strong);border-radius:var(--r-md);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;letter-spacing:.08em;
  text-align:center;text-transform:uppercase;background:var(--surface);color:var(--ink);
}
.redeemCode:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.redeemUser{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:var(--fs-xs);color:var(--muted);flex-wrap:wrap}
.identityTag{
  display:inline-block;padding:2px 8px;border-radius:var(--r-pill);margin-right:6px;
  background:var(--yellow-soft);color:var(--ink-2);font-size:var(--fs-2xs);font-weight:750;
}
.linkBtn{background:none;border:0;color:var(--primary-deep);font-weight:750;cursor:pointer;font-size:var(--fs-xs)}
.redeemResult{
  padding:13px 15px;border-radius:var(--r-md);background:var(--green-soft);border:1px solid #bfe6ec;
  font-size:var(--fs-xs);color:var(--green-deep);line-height:1.9;
}
.redeemResult ul{list-style:none;margin-top:6px}
.redeemFeatures{margin-top:6px;color:var(--ink-2)}
.redeemMine{padding:12px 14px;border-radius:var(--r-md);background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-xs)}
.redeemMine__row{display:flex;gap:10px;flex-wrap:wrap;padding:5px 0;border-top:1px solid var(--line);margin-top:5px}
.redeemMine__row span:first-child{font-weight:750}
</style>
