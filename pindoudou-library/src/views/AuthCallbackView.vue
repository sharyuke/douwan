<script setup>
/* =========================================================================
   QQ / 微信登录与绑定回调页（需求 §1.3 / §2.4）
   服务端在第三方回调完成后 302 到这里，令牌放在 hash query 里：
     /#/auth/callback?access_token=...&refresh_token=...&provider=qq|wechat
   hash 不会随请求发给服务端，不会进 nginx access log。
   页面读完参数后立刻把令牌从地址栏抹掉，避免留在浏览历史里。
   ========================================================================= */
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PixelIcon from '../components/ui/PixelIcon.vue'
import { userTokens } from '../lib/api.js'
import { bootstrapUser } from '../composables/useUserAccount.js'
import { syncServerEntitlements } from '../composables/useBackend.js'
import { toastOk, toastErr } from '../composables/useToast.js'

const route = useRoute()
const router = useRouter()

const status = ref('working') // working | success | error
const message = ref('正在完成登录…')
const detail = ref('')

function stripTokensFromURL() {
  try {
    const clean = window.location.pathname + window.location.search + '#/auth/callback'
    window.history.replaceState(null, '', clean)
  } catch {
    /* 隐私模式 / 老浏览器忽略：令牌仍会在下面被消费 */
  }
}

onMounted(async () => {
  const q = route.query
  const oauthError = q.oauth_error ? String(q.oauth_error) : ''
  const oauthMessage = q.message ? String(q.message) : ''
  const provider = String(q.provider || 'qq')
  const providerLabel = provider === 'wechat' ? '微信' : 'QQ'

  if (oauthError) {
    stripTokensFromURL()
    status.value = 'error'
    /* 服务端审核期的提示里还带着「请使用账号密码登录」，前台已经去掉这个入口，
       把这一段剔掉再展示，避免把用户引到不存在的登录方式。 */
    const cleanOauthMessage = oauthMessage
      .replace(/[，,；;]?\s*期间请(?:先)?使用账号密码登录[。.]?/g, '')
      .trim()
    message.value = oauthError === '31001'
      ? `${providerLabel} 登录暂未配置，请联系管理员完成服务器配置后再试。`
      : (cleanOauthMessage || `${providerLabel} 授权失败，请返回重试。`)
    toastErr(message.value)
    return
  }

  const accessToken = String(q.access_token || '')
  const refreshToken = String(q.refresh_token || '')
  const bound = q.bound === '1'
  const isNew = q.is_new === '1'

  if (!accessToken || !refreshToken) {
    stripTokensFromURL()
    status.value = 'error'
    message.value = '登录回调缺少必要参数，请重新登录。'
    toastErr(message.value)
    return
  }

  userTokens.write({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: q.expires_at ? String(q.expires_at) : ''
  })
  stripTokensFromURL()

  const user = await bootstrapUser(true)
  if (!user) {
    userTokens.clear()
    status.value = 'error'
    message.value = '登录凭证校验失败，请重新登录。'
    toastErr(message.value)
    return
  }

  await syncServerEntitlements()

  status.value = 'success'
  if (bound) {
    message.value = `${providerLabel} 已绑定到当前豆玩账号`
    detail.value = `以后可以直接用${providerLabel}登录这个账号。`
  } else if (isNew) {
    message.value = `${providerLabel} 登录成功，已创建豆玩账号`
    detail.value = '账号已建好，以后换设备登录也能找回。'
  } else {
    message.value = `${providerLabel} 登录成功`
    detail.value = `欢迎回来，${user.nickname || user.username || '拼豆玩家'}。`
  }
  toastOk(message.value)

  // 让用户看清结果再回账号页；失败时留在本页给出重试入口
  setTimeout(() => router.replace('/account').catch(() => {}), 900)
})
</script>

<template>
  <div class="wrap main--pad">
    <div class="callbackCard" data-audit="auth-callback" :data-status="status">
      <div class="callbackIcon" :class="status">
        <span v-if="status === 'working'">…</span>
        <PixelIcon v-else-if="status === 'success'" name="check" :size="26" />
        <PixelIcon v-else name="alert" :size="26" />
      </div>
      <h1>{{ status === 'working' ? '正在完成登录' : (status === 'success' ? '登录完成' : '登录没有完成') }}</h1>
      <p class="callbackMsg">{{ message }}</p>
      <p v-if="detail" class="hint">{{ detail }}</p>

      <div v-if="status === 'error'" class="callbackActions">
        <RouterLink to="/account" class="btn primary">返回个人中心</RouterLink>
        <RouterLink to="/" class="btn btn-secondary">回首页</RouterLink>
      </div>
      <p v-else-if="status === 'working'" class="hint">请稍候，不要关闭页面。</p>
    </div>
  </div>
</template>

<style scoped>
.callbackCard{
  max-width:560px;margin:60px auto;padding:34px 28px;border-radius:var(--r-xl);
  background:var(--surface);border:1px solid var(--line);box-shadow:var(--sh-1);
  text-align:center;display:flex;flex-direction:column;align-items:center;gap:9px;
}
.callbackIcon{
  width:54px;height:54px;border-radius:50%;display:grid;place-items:center;
  font-size:25px;font-weight:900;background:var(--surface-2);border:1px solid var(--line);
}
.callbackIcon.success{background:var(--green-soft);border-color:#bfe6ec;color:var(--green-deep)}
.callbackIcon.error{background:#FFF1EE;border-color:#FBD5CF;color:var(--primary-deep)}
.callbackCard h1{font-size:var(--fs-h2)}
.callbackMsg{font-size:var(--fs-sm);color:var(--ink-2);line-height:1.8}
.callbackActions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:10px}
@media(max-width:640px){.callbackCard{margin:28px auto;padding:26px 18px}}
</style>
