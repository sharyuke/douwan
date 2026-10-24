<script setup>
/* =========================================================================
   登录对话框
   - 两种方式：微信扫码登录（真实 OAuth）与邮箱 + 密码注册 / 登录。
   - 微信：点击后向服务端要授权地址，浏览器整页跳转。服务端没配 APPID /
     密钥 / 回调地址时明确报错，不会伪造登录成功。
   - 邮箱：走 /auth/register 与 /auth/login。注册时服务端要求用户名，
     前端用邮箱前缀生成（冲突时加随机后缀重试），用户只需要填邮箱和密码。
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'
import logoDouwan from '../../assets/logo-douwan.webp'
import { ApiError, api } from '../../lib/api.js'
import { isMobileViewport } from '../../composables/useWechatLogin.js'
import { login, register } from '../../composables/useUserAccount.js'
import { toastOk } from '../../composables/useToast.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'success'])

const busy = ref(false)
const error = ref('')
const wechatStatus = ref(null)
const wechatStatusLoading = ref(false)
/* 弹窗打开时定档：手机与桌面共用同一套入口，data-mode 只用于自检区分视口 */
const phone = ref(false)

/* 邮箱表单：同一个表单在「登录」与「注册」之间切换 */
const emailMode = ref('login')
const email = ref('')
const password = ref('')
const emailBusy = ref(false)
const emailError = ref('')

const wechatNotConfigured = computed(() => !!(wechatStatus.value && !wechatStatus.value.configured))
const wechatBlocked = computed(() => !!(
  wechatStatus.value &&
  wechatStatus.value.configured &&
  wechatStatus.value.checked &&
  !wechatStatus.value.available
))

const wechatNotice = computed(() => {
  if (wechatNotConfigured.value) return '微信登录暂未配置，请联系管理员完成服务器配置。'
  if (wechatBlocked.value) return (wechatStatus.value && wechatStatus.value.message) || '微信登录暂不可用，请稍后再试。'
  return ''
})
const wechatButtonHint = computed(() => {
  if (wechatBlocked.value) return '微信登录暂不可用'
  if (wechatNotConfigured.value) return '服务端尚未配置微信登录'
  return '使用微信扫码授权，首次登录自动创建豆玩账号'
})

watch(() => props.modelValue, open => {
  if (open) {
    error.value = ''
    emailError.value = ''
    password.value = ''
    phone.value = isMobileViewport()
    checkWeChatStatus()
  }
})

/** 打开对话框先问一次状态：未配置 / 应用未开通时直接禁用按钮。 */
async function checkWeChatStatus(force = false) {
  wechatStatusLoading.value = true
  try {
    const path = force
      ? '/auth/oauth/wechat/status?refresh=1'
      : '/auth/oauth/wechat/status'
    wechatStatus.value = await api.get(path, { auth: false })
  } catch {
    /* 状态查不到不影响用户点击：真正的错误由 startWeChat 兜住。 */
    wechatStatus.value = null
  } finally {
    wechatStatusLoading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

/** 发起授权：拿到服务端签发的地址后整页跳转（密钥不会到浏览器）。 */
async function startWeChat() {
  if (busy.value) return
  if (wechatBlocked.value || wechatNotConfigured.value) {
    error.value = wechatNotice.value || '微信登录暂不可用，请稍后再试。'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await api.get('/auth/oauth/wechat/start', { auth: false })
    if (!result || !result.url) {
      error.value = '微信登录暂时不可用，请稍后重试。'
      return
    }
    window.location.assign(result.url)
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 31001) {
        error.value = '微信登录暂未配置，请联系管理员完成服务器配置。'
      } else if (e.code === 31007) {
        error.value = e.message || '微信登录暂不可用，请稍后再试。'
        wechatStatus.value = {
          provider: 'wechat',
          configured: true,
          available: false,
          checked: true,
          reason: 'app_not_enabled',
          message: error.value
        }
      } else {
        error.value = e.message || '微信登录发起失败，请稍后重试。'
      }
    } else {
      error.value = '无法连接服务端，微信登录暂时不可用。'
    }
  } finally {
    busy.value = false
  }
}

/* ---------------------------------------------------------------- 邮箱 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function switchEmailMode(next) {
  if (emailMode.value === next) return
  emailMode.value = next
  emailError.value = ''
}

async function submitEmail() {
  if (emailBusy.value) return
  emailError.value = ''
  const value = email.value.trim()
  if (!EMAIL_RE.test(value)) {
    emailError.value = '请输入正确的邮箱地址'
    return
  }
  if (!password.value) {
    emailError.value = '请输入密码'
    return
  }
  if (emailMode.value === 'register' && password.value.length < 8) {
    emailError.value = '密码至少 8 位'
    return
  }
  emailBusy.value = true
  try {
    const result = emailMode.value === 'register'
      ? await register({ email: value, password: password.value })
      : await login({ account: value, password: password.value })
    if (!result.ok) {
      emailError.value = result.message || '操作失败，请稍后重试'
      return
    }
    toastOk(emailMode.value === 'register' ? '注册成功，已登录' : '登录成功')
    emit('success')
    close()
  } finally {
    emailBusy.value = false
  }
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    title="登录豆玩"
    size="sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="loginBox" data-audit="login-dialog" :data-mode="phone ? 'phone' : 'screen'">
      <img class="loginLogo" :src="logoDouwan" alt="豆玩 DOUWAN" width="157" height="52">
      <p class="loginLead">
        登录后账号身份保存在服务端，换设备重新登录即可恢复。
      </p>

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
        :disabled="busy || wechatBlocked || wechatNotConfigured"
        data-audit="wechat-login"
        @click="startWeChat"
      >
        <span class="loginProvider__icon" aria-hidden="true">微</span>
        <span>
          <b>{{ busy ? '正在前往微信…' : '微信登录' }}</b>
          <small>{{ wechatButtonHint }}</small>
        </span>
      </button>

      <div class="loginOr" data-audit="email-divider"><span>或使用邮箱</span></div>

      <form class="loginForm" novalidate @submit.prevent="submitEmail">
        <div class="field">
          <label for="login-email">邮箱</label>
          <input
            id="login-email"
            v-model.trim="email"
            type="email"
            name="email"
            autocomplete="email"
            inputmode="email"
            placeholder="you@example.com"
            data-audit="login-email"
          >
        </div>
        <div class="field">
          <label for="login-password">
            密码
            <span v-if="emailMode === 'register'">至少 8 位</span>
          </label>
          <input
            id="login-password"
            v-model="password"
            type="password"
            name="password"
            :autocomplete="emailMode === 'register' ? 'new-password' : 'current-password'"
            :placeholder="emailMode === 'register' ? '设置登录密码' : '请输入密码'"
            data-audit="login-password"
          >
        </div>
        <div v-if="emailError" class="loginError" data-audit="email-error" role="alert">
          {{ emailError }}
        </div>
        <button type="submit" class="btn primary block" :disabled="emailBusy" data-audit="email-submit">
          {{ emailBusy ? '请稍候…' : (emailMode === 'register' ? '注册并登录' : '登录') }}
        </button>
        <p class="loginSwitch">
          <template v-if="emailMode === 'login'">
            还没有邮箱账号？
            <button type="button" class="linkBtn" data-audit="email-to-register" @click="switchEmailMode('register')">用邮箱注册</button>
          </template>
          <template v-else>
            已有邮箱账号？
            <button type="button" class="linkBtn" data-audit="email-to-login" @click="switchEmailMode('login')">去登录</button>
          </template>
        </p>
      </form>

      <div v-if="error" class="loginError" data-audit="login-error" role="alert">
        {{ error }}
      </div>

      <p class="loginPrivacy">
        使用微信登录时，我们仅获取昵称、头像和稳定用户标识（openid）用于创建账号与展示，
        不保存授权 access token；使用邮箱登录时，密码只以加密摘要保存在服务端。
        继续登录即表示同意
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
.loginProvider--wechat{border-color:#BFEBD2;background:#F3FCF7}
.loginProvider__icon{
  width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;
  font-size:13px;font-weight:900;color:#fff;background:#07C160;letter-spacing:-.03em;
}
.loginProvider b{display:block;font-size:var(--fs-sm)}
.loginProvider small{display:block;margin-top:3px;font-size:var(--fs-2xs);color:var(--muted)}
.loginOr{
  display:flex;align-items:center;gap:10px;margin:2px 0;
  font-size:var(--fs-2xs);color:var(--muted-2);
}
.loginOr::before,.loginOr::after{content:'';flex:1;height:1px;background:var(--line)}
.loginForm{display:flex;flex-direction:column;gap:11px}
.loginForm .btn.block{min-height:44px;font-size:var(--fs-sm)}
.loginSwitch{font-size:var(--fs-2xs);color:var(--muted);text-align:center;line-height:1.8}
.linkBtn{
  padding:0;border:0;background:none;color:var(--primary-deep);font:inherit;font-weight:800;
  cursor:pointer;text-decoration:underline;text-underline-offset:3px;
}
.linkBtn:hover{color:var(--primary)}
.loginError{
  padding:10px 12px;border-radius:var(--r-sm);background:#FFF1EE;border:1px solid #FBD5CF;
  color:var(--primary-deep);font-size:var(--fs-xs);line-height:1.75;
}
.loginNotice{
  display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:var(--r-sm);
  background:#FFF8E6;border:1px solid #F3DFA6;color:#7A5B00;font-size:var(--fs-xs);line-height:1.7;
}
.loginNotice b{font-size:var(--fs-xs)}
.loginChecking{font-size:var(--fs-2xs);color:var(--muted)}
.loginPrivacy{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8;margin-top:4px}
.loginPrivacy a{color:var(--primary-deep);font-weight:700}
</style>
