<script setup>
/* =========================================================================
   后台登录页
   - 管理员账号由命令行初始化（cmd/seed），页面上不提供注册入口（后台需求 §3.1）
   - 密码错误与账号不存在返回同一个错误码，避免被用来枚举后台账号
   ========================================================================= */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../../lib/api.js'
import logoDouwan from '../../assets/logo-douwan.webp'
import { login, isLoggedIn, admin } from '../../composables/useAdminAuth.js'

const route = useRoute()
const router = useRouter()

const account = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const redirect = computed(() => {
  const target = route.query.redirect
  return typeof target === 'string' && target.startsWith('/admin') ? target : '/admin'
})

onMounted(() => {
  // 已登录时直接进后台，不用再输一遍
  if (isLoggedIn.value) router.replace(redirect.value)
})

async function submit() {
  error.value = ''
  if (!account.value.trim() || !password.value) {
    error.value = '请输入管理员账号与密码'
    return
  }
  loading.value = true
  try {
    await login(account.value.trim(), password.value)
    router.replace(redirect.value)
  } catch (e) {
    if (e instanceof ApiError) {
      error.value = e.code === 10429 ? '尝试过于频繁，请稍后再试' : e.message
    } else {
      error.value = '登录失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="adm adm-login">
    <div class="adm-login__card">
      <div class="adm-login__brand">
        <img class="adm-side__logoImg" :src="logoDouwan" alt="豆玩 DOUWAN" style="height:38px">
        <div>
          <b>豆玩后台管理</b>
          <span style="display:block">DOUWAN ADMIN CONSOLE</span>
        </div>
      </div>

      <div class="adm-field">
        <label>管理员账号</label>
        <input
          v-model="account"
          class="adm-input"
          type="text"
          autocomplete="username"
          placeholder="请输入管理员账号"
          @keyup.enter="submit"
        >
      </div>

      <div class="adm-field">
        <label>密码</label>
        <input
          v-model="password"
          class="adm-input"
          type="password"
          autocomplete="current-password"
          placeholder="请输入密码"
          @keyup.enter="submit"
        >
      </div>

      <div v-if="error" class="adm-note adm-note--danger">{{ error }}</div>

      <button class="adm-btn adm-btn--primary adm-btn--block" type="button" :disabled="loading" @click="submit">
        {{ loading ? '登录中…' : '登录后台' }}
      </button>

      <p class="adm-2xs adm-muted" style="line-height:1.7">
        后台不提供注册入口。首个管理员由服务端初始化命令创建：
        <code>DOUWAN_SEED_ADMIN_PASSWORD=… go run ./cmd/seed -admin 你的账号</code>
      </p>

      <RouterLink to="/" class="adm-link" style="text-align:center">返回前台</RouterLink>
    </div>
  </div>
</template>
