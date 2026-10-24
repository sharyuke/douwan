<script setup>
/* =========================================================================
   后台整体布局
   - 左侧固定导航（桌面）/ 抽屉导航（平板与手机）
   - 顶栏显示当前页面标题、管理员信息、退出入口
   - 未登录时除了登录页以外都会被路由守卫拦下，这里只负责渲染外壳
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import ConfirmHost from './ConfirmHost.vue'
import AdminModal from './AdminModal.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import logoDouwan from '../../assets/logo-douwan.webp'
import { ADMIN_NAV, ADMIN_TITLES } from './adminNav.js'
import { admin, isSuper, roleLabel, can, logout } from '../../composables/useAdminAuth.js'
import { copyWithToast, run } from '../../composables/useAdminKit.js'
import { authApi } from '../../lib/adminApi.js'

const route = useRoute()
const router = useRouter()

const drawerOpen = ref(false)
const pwdOpen = ref(false)
const pwdForm = ref({ oldPassword: '', newPassword: '', confirm: '' })
const pwdError = ref('')

watch(() => route.fullPath, () => { drawerOpen.value = false })

const pageMeta = computed(() => {
  for (const [path, meta] of Object.entries(ADMIN_TITLES)) {
    if (route.path === path) return meta
  }
  return { title: '后台管理', sub: '' }
})

/** 当前菜单项高亮：非精确匹配时按前缀判断（详情页也归属父菜单） */
function isActive(item) {
  if (item.exact) return route.path === item.to
  return route.path === item.to || route.path.startsWith(item.to + '/')
}

function visible(item) {
  return !item.perm || can(item.perm)
}

const groups = computed(() =>
  ADMIN_NAV.map(g => ({ ...g, items: g.items.filter(visible) })).filter(g => g.items.length)
)

const initials = computed(() => {
  const name = (admin.value && (admin.value.nickname || admin.value.username)) || 'A'
  return name.slice(0, 1).toUpperCase()
})

async function doLogout() {
  await logout()
  router.replace({ path: '/admin/login', query: { redirect: '/admin' } })
}

function openPassword() {
  pwdForm.value = { oldPassword: '', newPassword: '', confirm: '' }
  pwdError.value = ''
  pwdOpen.value = true
}

async function submitPassword() {
  pwdError.value = ''
  const { oldPassword, newPassword, confirm } = pwdForm.value
  if (!oldPassword) { pwdError.value = '请输入当前密码'; return }
  if (!newPassword || newPassword.length < 10) { pwdError.value = '新密码至少 10 位'; return }
  if (newPassword !== confirm) { pwdError.value = '两次输入的新密码不一致'; return }

  const result = await run(() => authApi.changePassword(oldPassword, newPassword), {
    ok: '密码已修改，请用新密码重新登录'
  })
  if (result === null) return
  pwdOpen.value = false
  await doLogout()
}
</script>

<template>
  <div class="adm">
    <div class="adm-shell">
      <!-- 左侧导航（桌面） -->
      <aside class="adm-side">
        <div class="adm-side__brand">
          <img class="adm-side__logoImg" :src="logoDouwan" alt="豆玩 DOUWAN">
          <div>
            <b>豆玩后台</b>
            <span style="display:block">DOUWAN ADMIN</span>
          </div>
        </div>

        <nav class="adm-nav">
          <template v-for="g in groups" :key="g.group">
            <div class="adm-nav__group">{{ g.group }}</div>
            <RouterLink
              v-for="item in g.items" :key="item.to"
              :to="item.to"
              class="adm-nav__item"
              :class="{ on: isActive(item) }"
            >
              <i><PixelIcon :name="item.icon" :size="16" /></i>{{ item.label }}
            </RouterLink>
          </template>
        </nav>

        <div class="adm-side__foot">
          <div>{{ admin ? (admin.nickname || admin.username) : '—' }} · {{ roleLabel }}</div>
          <div>{{ isSuper ? '拥有全部权限' : '权限由角色决定' }}</div>
          <button class="adm-link" type="button" style="margin-top:6px" @click="doLogout">退出登录</button>
        </div>
      </aside>

      <div class="adm-main">
        <!-- 顶栏 -->
        <header class="adm-top">
          <button class="adm-burger" type="button" aria-label="打开导航" @click="drawerOpen = true">
            <PixelIcon name="list" :size="20" />
          </button>
          <div class="adm-top__heading">
            <div class="adm-top__title">{{ pageMeta.title }}</div>
            <div class="adm-top__sub">{{ pageMeta.sub }}</div>
          </div>

          <div class="adm-top__right">
            <RouterLink to="/" class="adm-btn adm-btn--sm adm-btn--ghost adm-top__action" target="_blank" rel="noopener">查看前台</RouterLink>
            <button class="adm-btn adm-btn--sm adm-top__action" type="button" @click="openPassword">修改密码</button>
            <div class="adm-userchip" @click="copyWithToast(admin && admin.username, '已复制账号')">
              <span class="adm-avatar">{{ initials }}</span>
              <span style="line-height:1.2">
                <span class="adm-strong" style="font-size:var(--fs-xs);display:block">
                  {{ admin ? (admin.nickname || admin.username) : '—' }}
                </span>
                <span class="adm-2xs adm-muted">{{ roleLabel }}</span>
              </span>
            </div>
          </div>
        </header>

        <!-- 内容 -->
        <div class="adm-body">
          <RouterView />
        </div>
      </div>
    </div>

    <!-- 抽屉导航（移动端） -->
    <div v-if="drawerOpen" class="adm-drawer">
      <div class="adm-drawer__mask" @click="drawerOpen = false" />
      <div class="adm-drawer__panel">
        <div class="adm-side__brand">
          <img class="adm-side__logoImg" :src="logoDouwan" alt="豆玩 DOUWAN">
          <div><b>豆玩后台</b><span style="display:block">DOUWAN ADMIN</span></div>
        </div>
        <nav class="adm-nav">
          <template v-for="g in groups" :key="g.group">
            <div class="adm-nav__group">{{ g.group }}</div>
            <RouterLink
              v-for="item in g.items" :key="item.to"
              :to="item.to"
              class="adm-nav__item"
              :class="{ on: isActive(item) }"
            >
              <i><PixelIcon :name="item.icon" :size="16" /></i>{{ item.label }}
            </RouterLink>
          </template>
        </nav>
        <div class="adm-side__foot">
          <div class="adm-side__footLinks">
            <RouterLink to="/" class="adm-link" target="_blank" rel="noopener">查看前台</RouterLink>
            <button class="adm-link" type="button" @click="openPassword">修改密码</button>
            <button class="adm-link" type="button" @click="doLogout">退出登录</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 修改密码 -->
    <AdminModal v-model="pwdOpen" title="修改登录密码" size="sm" :mask-closable="false">
      <div class="adm-stack">
        <div class="adm-field">
          <label>当前密码 <em>*</em></label>
          <input v-model="pwdForm.oldPassword" class="adm-input" type="password" autocomplete="current-password">
        </div>
        <div class="adm-field">
          <label>新密码 <em>*</em></label>
          <input v-model="pwdForm.newPassword" class="adm-input" type="password" autocomplete="new-password">
          <span class="adm-hint">至少 10 位。改完需要用新密码重新登录。</span>
        </div>
        <div class="adm-field">
          <label>确认新密码 <em>*</em></label>
          <input v-model="pwdForm.confirm" class="adm-input" type="password" autocomplete="new-password">
        </div>
        <div v-if="pwdError" class="adm-note adm-note--danger">{{ pwdError }}</div>
      </div>
      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button class="adm-btn adm-btn--primary" type="button" @click="submitPassword">确认修改</button>
      </template>
    </AdminModal>

    <ConfirmHost />
  </div>
</template>
