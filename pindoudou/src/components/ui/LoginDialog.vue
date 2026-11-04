<script setup>
/* =========================================================================
   登录对话框
   - 两种方式：微信扫码登录（真实 OAuth）与邮箱 + 密码注册 / 登录。
   - 微信：点击后向服务端要授权地址，浏览器整页跳转。服务端没配 APPID /
     密钥 / 回调地址时明确报错，不会伪造登录成功。
   - 邮箱：走 /auth/register 与 /auth/login。注册时服务端要求用户名，
     前端用邮箱前缀生成（冲突时加随机后缀重试），用户只需要填邮箱和密码。
   - 手机号 / 短信验证码：按设计稿撤下，字段、页签与隐私说明里的相关字样
     全部移除，服务端接口保留在 douwan-api 里，资质通过后再放出入口。
   - reason = 'save'：从工作台点「保存」弹出来的，顶部提示「登录后才能保存」，
     登录成功后由调用方接着走保存流程。
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'
import logoDouwan from '../../assets/logo-douwan.webp'
import { ApiError, api } from '../../lib/api.js'
import { isMobileViewport } from '../../composables/useWechatLogin.js'
import { login, register } from '../../composables/useUserAccount.js'
import { toastOk } from '../../composables/useToast.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /* 打开来源：'save' = 工作台点「保存」弹出来的 */
  reason: { type: String, default: '' }
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

/* 「忘记密码」：服务端还没有自助重置接口，展开后如实说明并给出替代路径 */
const forgotOpen = ref(false)

/* 从工作台点保存进来的：文案与主按钮跟着变 */
const isSaveReason = computed(() => props.reason === 'save')

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
    forgotOpen.value = false
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
        error.value = e.message || '微信登录暂不可用，请稍后重试。'
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
      <img class="loginLogo" :src="logoDouwan" alt="豆玩 DOUWAN" width="136" height="52">

      <p v-if="isSaveReason" class="loginReason" data-audit="login-reason">
        <b>登录后才能保存</b>
        <span>登录成功后会自动继续保存当前作品，现在登录不会丢失进度。</span>
      </p>
      <p v-else class="loginLead">
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
          {{ emailBusy
            ? '请稍候…'
            : (isSaveReason
              ? '登录并保存'
              : (emailMode === 'register' ? '注册并登录' : '登录')) }}
        </button>
        <div class="loginFoot">
          <button type="button" class="linkBtn" data-audit="forgot-password" @click="forgotOpen = !forgotOpen">
            忘记密码？
          </button>
          <span class="loginFoot__sep">·</span>
          <template v-if="emailMode === 'login'">
            <span class="loginFoot__hint">还没有邮箱账号？</span>
            <button type="button" class="linkBtn" data-audit="email-to-register" @click="switchEmailMode('register')">用邮箱注册</button>
          </template>
          <template v-else>
            <span class="loginFoot__hint">已有邮箱账号？</span>
            <button type="button" class="linkBtn" data-audit="email-to-login" @click="switchEmailMode('login')">去登录</button>
          </template>
        </div>
        <p v-if="forgotOpen" class="loginForgot" data-audit="forgot-hint">
          自助重置密码还没上线，请联系豆玩客服协助重置，或改用邮箱注册一个新账号。
        </p>
      </form>

      <div v-if="error" class="loginError" data-audit="login-error" role="alert">
        {{ error }}
      </div>

      <p class="loginPrivacy">
        使用微信登录时，我们仅获取昵称、头像和稳定用户标识（openid）用于创建账号与展示，
        不保存授权 access token；
        使用邮箱登录时，密码只以加密摘要保存在服务端。
        继续登录即表示同意
        <a href="#/help" @click="close">隐私说明</a>。
      </p>
    </div>
  </BaseDialog>
</template>

<style scoped>
.loginBox{display:flex;flex-direction:column;gap:11px}
.loginLogo{width:136px;height:52px;margin:-2px 0 2px}
.loginLead{
  font-family:var(--font-sans);font-size:var(--ty-body);font-weight:400;
  line-height:var(--ty-body-lh);color:var(--ty-secondary);margin-bottom:2px;
}
.loginReason{
  display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:var(--r-sm);
  background:var(--ty-accent-soft);border:1px solid #DCE9A6;
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);color:var(--ty-secondary);
}
.loginReason b{font-size:var(--ty-label);font-weight:700;line-height:var(--ty-label-lh);color:var(--ty-ink)}
.loginProvider{
  display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border-radius:var(--r-md);
  border:1px solid var(--line-strong);background:var(--surface);color:var(--ty-ink);text-align:left;
  cursor:pointer;transition:var(--t);
}
.loginProvider:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--sh-1)}
.loginProvider:disabled{cursor:not-allowed;opacity:.62}
.loginProvider--wechat{border-color:#BFEBD2;background:#F3FCF7}
.loginProvider__icon{
  width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;
  font-size:13px;font-weight:700;color:#fff;background:#07C160;letter-spacing:0;line-height:var(--ty-label-lh)
}
.loginProvider b{
  display:block;font-family:var(--font-sans);font-size:var(--ty-label);font-weight:700;
  line-height:var(--ty-label-lh);color:var(--ty-ink);
}
.loginProvider small{
  display:block;margin-top:3px;font-family:var(--font-sans);font-size:var(--ty-caption);
  font-weight:400;line-height:var(--ty-caption-lh);color:var(--ty-muted);
}
.loginOr{
  display:flex;align-items:center;gap:10px;margin:2px 0;
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);color:var(--ty-muted);
}
.loginOr::before,.loginOr::after{content:'';flex:1;height:1px;background:var(--line)}
.loginForm{display:flex;flex-direction:column;gap:11px}
.loginForm .field label{
  font-family:var(--font-sans);font-size:var(--ty-label);font-weight:500;
  line-height:var(--ty-label-lh);color:var(--ty-body-ink);
}
.loginForm .btn.block{
  min-height:44px;font-family:var(--font-sans);font-size:var(--ty-card);font-weight:700;
  line-height:var(--ty-card-lh);
}
.loginFoot{
  display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);color:var(--ty-muted);
}
.loginFoot__sep{color:var(--ty-muted)}
.linkBtn{
  padding:0;border:0;background:none;color:var(--primary-deep);
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:700;
  line-height:var(--ty-caption-lh);cursor:pointer;text-decoration:underline;text-underline-offset:3px;
}
.linkBtn:hover{color:var(--primary)}
.loginForgot{
  padding:9px 11px;border-radius:var(--r-sm);background:var(--ty-surface-soft);
  border:1px solid var(--ty-line);
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);color:var(--ty-secondary);
}
.loginError{
  padding:10px 12px;border-radius:var(--r-sm);background:#FFF1EE;border:1px solid #FBD5CF;
  color:var(--primary-deep);
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);
}
.loginNotice{
  display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:var(--r-sm);
  background:#FFF8E6;border:1px solid #F3DFA6;color:#7A5B00;
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);
}
.loginNotice b{font-size:var(--ty-label);font-weight:700;line-height:var(--ty-label-lh);color:#7A5B00}
.loginChecking{
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);color:var(--ty-muted);
}
.loginPrivacy{
  font-family:var(--font-sans);font-size:var(--ty-caption);font-weight:400;
  line-height:var(--ty-caption-lh);color:var(--ty-muted);margin-top:4px;
}
.loginPrivacy a{color:var(--primary-deep);font-weight:700}
</style>
