<script setup>
/* =========================================================================
   登录对话框（需求 §2.1 / §3.1）
   - QQ / 微信：真实 OAuth。点击后向服务端要授权地址，浏览器整页跳转。
     服务端没配对应 APPID / 密钥 / 回调地址时明确报错，不会伪造登录成功。
   - 账号密码登录已移除：前台只保留微信 / QQ 两种方式。
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'
import logoDouwan from '../../assets/logo-douwan.webp'
import { ApiError, api } from '../../lib/api.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'success'])

const busy = ref('') // '' | 'qq' | 'wechat'
const error = ref('')
const qqStatus = ref(null)
const wechatStatus = ref(null)
const qqStatusLoading = ref(false)
const wechatStatusLoading = ref(false)

function notConfiguredOf(status) {
  return !!(status && !status.configured)
}
function blockedOf(status) {
  return !!(status && status.configured && status.checked && !status.available)
}

const qqNotConfigured = computed(() => notConfiguredOf(qqStatus.value))
const qqBlocked = computed(() => blockedOf(qqStatus.value))
const wechatNotConfigured = computed(() => notConfiguredOf(wechatStatus.value))
const wechatBlocked = computed(() => blockedOf(wechatStatus.value))

const qqNotice = computed(() => {
  if (qqNotConfigured.value) return 'QQ 登录暂未配置，请联系管理员完成服务器配置。'
  /* 服务端在审核期会返回「期间请使用账号密码登录」，但前台已经去掉账号登录，
     这里用固定文案，避免把用户引到一个不存在的入口。 */
  if (qqBlocked.value) return 'QQ 登录正在等待 QQ 互联开通（错误码 100008），审核通过后会自动恢复；期间可以先使用微信登录。'
  return ''
})
const wechatNotice = computed(() => {
  if (wechatNotConfigured.value) return '微信登录暂未配置，请联系管理员完成服务器配置。'
  if (wechatBlocked.value) return (wechatStatus.value && wechatStatus.value.message) || '微信登录暂不可用，请稍后再试。'
  return ''
})
const qqButtonHint = computed(() => {
  if (qqBlocked.value) return 'QQ 互联审核中，暂时无法登录'
  if (qqNotConfigured.value) return '服务端尚未配置 QQ 登录'
  return '使用 QQ 授权，首次登录自动创建豆玩账号'
})
const wechatButtonHint = computed(() => {
  if (wechatBlocked.value) return '微信登录暂不可用'
  if (wechatNotConfigured.value) return '服务端尚未配置微信登录'
  return '使用微信扫码授权，首次登录自动创建豆玩账号'
})

watch(() => props.modelValue, open => {
  if (open) {
    error.value = ''
    checkQQStatus()
    checkWeChatStatus()
  }
})

/** 打开对话框先问一次状态：未配置 / 应用未开通时直接禁用对应按钮。 */
async function loadStatus(provider, target, loading, force = false) {
  loading.value = true
  try {
    const path = force
      ? `/auth/oauth/${provider}/status?refresh=1`
      : `/auth/oauth/${provider}/status`
    const status = await api.get(path, { auth: false })
    target.value = status || null
  } catch {
    /* 状态查不到不影响用户点击：真正的错误由 startOAuth 兜住。 */
    target.value = null
  } finally {
    loading.value = false
  }
}

function checkQQStatus(force = false) {
  return loadStatus('qq', qqStatus, qqStatusLoading, force)
}
function checkWeChatStatus(force = false) {
  return loadStatus('wechat', wechatStatus, wechatStatusLoading, force)
}

function close() {
  emit('update:modelValue', false)
}

/** 发起授权：拿到服务端签发的地址后整页跳转（密钥不会到浏览器）。 */
async function startOAuth(provider, label, statusRef, blockedRef, notConfiguredRef, noticeRef) {
  if (busy.value) return
  if (blockedRef.value || notConfiguredRef.value) {
    error.value = noticeRef.value || `${label} 登录暂不可用，请稍后再试。`
    return
  }
  busy.value = provider
  error.value = ''
  try {
    const result = await api.get(`/auth/oauth/${provider}/start`, { auth: false })
    if (!result || !result.url) {
      error.value = `${label} 登录暂时不可用，请稍后重试。`
      return
    }
    window.location.assign(result.url)
  } catch (e) {
    if (e instanceof ApiError) {
      /* 31001 = 服务端未配置该登录方式。文案只说明缺配置，不暴露任何密钥。 */
      if (e.code === 31001) {
        error.value = `${label} 登录暂未配置，请联系管理员完成服务器配置。`
      } else if (e.code === 31007) {
        error.value = e.message || `${label} 登录暂不可用，请稍后再试。`
        statusRef.value = {
          provider,
          configured: true,
          available: false,
          checked: true,
          reason: 'app_not_enabled',
          message: error.value
        }
      } else {
        error.value = e.message || `${label} 登录发起失败，请稍后重试。`
      }
    } else {
      error.value = `无法连接服务端，${label} 登录暂时不可用。`
    }
  } finally {
    busy.value = ''
  }
}

function startQQ() {
  return startOAuth('qq', 'QQ', qqStatus, qqBlocked, qqNotConfigured, qqNotice)
}
function startWeChat() {
  return startOAuth('wechat', '微信', wechatStatus, wechatBlocked, wechatNotConfigured, wechatNotice)
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    title="登录豆玩"
    size="sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="loginBox" data-audit="login-dialog">
      <img class="loginLogo" :src="logoDouwan" alt="豆玩 DOUWAN" width="157" height="52">
      <p class="loginLead">
        使用 QQ 或微信登录。账号身份保存在服务端，换设备重新登录即可恢复。
      </p>

      <div
        v-if="qqNotice"
        class="loginNotice"
        data-audit="qq-status"
        :data-state="qqNotConfigured ? 'not-configured' : 'blocked'"
        role="status"
      >
        <b>QQ 登录暂不可用</b>
        <span>{{ qqNotice }}</span>
        <span v-if="qqBlocked" class="loginNotice__hint">开通后刷新页面即可恢复；免费功能不受影响。</span>
        <button
          v-if="qqBlocked"
          type="button"
          class="loginRecheck"
          data-audit="qq-recheck"
          :disabled="qqStatusLoading"
          @click="checkQQStatus(true)"
        >{{ qqStatusLoading ? '正在重新检查…' : '重新检查 QQ 状态' }}</button>
      </div>
      <p v-else-if="qqStatusLoading" class="loginChecking" data-audit="qq-checking">
        正在检查 QQ 登录状态…
      </p>

      <button
        type="button"
        class="loginProvider loginProvider--qq"
        :disabled="!!busy || qqBlocked || qqNotConfigured"
        data-audit="qq-login"
        @click="startQQ"
      >
        <span class="loginProvider__icon" aria-hidden="true">QQ</span>
        <span>
          <b>{{ busy === 'qq' ? '正在前往 QQ…' : 'QQ 登录' }}</b>
          <small>{{ qqButtonHint }}</small>
        </span>
      </button>

      <div
        v-if="wechatNotice"
        class="loginNotice"
        data-audit="wechat-status"
        :data-state="wechatNotConfigured ? 'not-configured' : 'blocked'"
        role="status"
      >
        <b>微信登录暂不可用</b>
        <span>{{ wechatNotice }}</span>
      </div>
      <p v-else-if="wechatStatusLoading" class="loginChecking" data-audit="wechat-checking">
        正在检查微信登录状态…
      </p>

      <button
        type="button"
        class="loginProvider loginProvider--wechat"
        :disabled="!!busy || wechatBlocked || wechatNotConfigured"
        data-audit="wechat-login"
        @click="startWeChat"
      >
        <span class="loginProvider__icon" aria-hidden="true">微</span>
        <span>
          <b>{{ busy === 'wechat' ? '正在前往微信…' : '微信登录' }}</b>
          <small>{{ wechatButtonHint }}</small>
        </span>
      </button>

      <div v-if="error" class="loginError" data-audit="login-error" role="alert">
        {{ error }}
      </div>

      <p class="loginPrivacy">
        使用 QQ 或微信登录时，我们仅获取昵称、头像和稳定用户标识（openid）用于创建账号与展示，
        不保存授权 access token。继续登录即表示同意
        <a href="#/help" @click="close">隐私说明</a>。
      </p>
    </div>
  </BaseDialog>
</template>

<style scoped>
.loginBox{display:flex;flex-direction:column;gap:11px}
.loginLogo{width:157px;height:auto;margin:-2px 0 2px}
.loginLead{font-size:var(--fs-xs);color:var(--muted);line-height:1.8;margin-bottom:2px}
.loginProvider{
  display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border-radius:var(--r-md);
  border:1px solid var(--line-strong);background:var(--surface);color:var(--ink);text-align:left;
  cursor:pointer;transition:var(--t);
}
.loginProvider:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--sh-1)}
.loginProvider:disabled{cursor:not-allowed;opacity:.62}
.loginProvider--qq{border-color:#BFD9F5;background:#F4F9FF}
.loginProvider--wechat{border-color:#BFEBD2;background:#F3FCF7}
.loginProvider__icon{
  width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;
  font-size:13px;font-weight:900;color:#fff;background:#12B7F5;letter-spacing:-.03em;
}
.loginProvider--wechat .loginProvider__icon{background:#07C160}
.loginProvider b{display:block;font-size:var(--fs-sm)}
.loginProvider small{display:block;margin-top:3px;font-size:var(--fs-2xs);color:var(--muted)}
.loginError{
  padding:10px 12px;border-radius:var(--r-sm);background:#FFF1EE;border:1px solid #FBD5CF;
  color:var(--primary-deep);font-size:var(--fs-xs);line-height:1.75;
}
.loginNotice{
  display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:var(--r-sm);
  background:#FFF8E6;border:1px solid #F3DFA6;color:#7A5B00;font-size:var(--fs-xs);line-height:1.7;
}
.loginNotice b{font-size:var(--fs-xs)}
.loginNotice__hint{color:#8A6A1A;font-size:var(--fs-2xs)}
.loginRecheck{
  align-self:flex-start;background:none;border:0;padding:0;margin-top:1px;
  color:#8A5A00;font-size:var(--fs-2xs);font-weight:750;text-decoration:underline;cursor:pointer;
}
.loginRecheck:disabled{cursor:wait;opacity:.6}
.loginChecking{font-size:var(--fs-2xs);color:var(--muted)}
.loginPrivacy{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8;margin-top:4px}
.loginPrivacy a{color:var(--primary-deep);font-weight:700}
</style>
