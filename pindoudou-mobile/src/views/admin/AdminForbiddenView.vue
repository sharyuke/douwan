<script setup>
/* 权限不足时的说明页：明确告诉管理员「为什么进不来」以及找谁开权限 */
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PixelIcon from '../../components/ui/PixelIcon.vue'
import { admin, roleLabel, permissions } from '../../composables/useAdminAuth.js'

const route = useRoute()

const PERM_LABELS = {
  'overview.view': '数据概览',
  'plan.manage': '套餐管理',
  'card.view': '卡密管理',
  'order.view': '订单管理',
  'asset.view': '素材库',
  'user.view': '用户与兑换记录',
  'setting.view': '系统设置',
  'log.view': '操作日志',
  'admin.manage': '管理员管理'
}

const perm = computed(() => (typeof route.query.perm === 'string' ? route.query.perm : ''))
const permLabel = computed(() => PERM_LABELS[perm.value] || perm.value || '该功能')
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : '/admin'))
</script>

<template>
  <div class="adm-page">
    <div class="adm-card">
      <div class="adm-empty">
        <div class="adm-empty__icon"><PixelIcon name="lock" :size="28" /></div>
        <strong>没有访问「{{ permLabel }}」的权限</strong>
        <p>
          当前登录账号是 <b>{{ admin ? (admin.nickname || admin.username) : '—' }}</b>
          （{{ roleLabel }}）。这个角色没有该模块的权限。
        </p>
        <div class="adm-note adm-note--muted" style="text-align:left;max-width:620px">
          后台权限在服务端按角色校验，前端隐藏按钮不构成权限保护。
          如果你确实需要这个模块，请让超级管理员在「管理员」页面调整你的角色。
          你当前拥有的权限点：{{ permissions.length ? permissions.join('、') : '（无）' }}
        </div>
        <div class="adm-row" style="justify-content:center">
          <RouterLink to="/admin" class="adm-btn adm-btn--primary">回到数据概览</RouterLink>
          <RouterLink :to="from" class="adm-btn">重试刚才的页面</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
