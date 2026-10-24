<script setup>
import { RouterLink } from 'vue-router'
import PixelIcon from '../components/ui/PixelIcon.vue'
</script>

<template>
  <div class="wrap main--pad">
    <div class="empty notFound">
      <div class="empty__icon"><PixelIcon name="sparkles" :size="24" /></div>
      <strong>这一格是空的</strong>
      <p>
        你要找的页面不存在，或者链接已经变了。
        不过没关系 —— 从下面任一条路都能开始做一张拼豆图纸。
      </p>
      <div class="row row--wrap" style="justify-content:center">
        <RouterLink to="/editor" class="btn primary">上传照片开始</RouterLink>
        <RouterLink to="/library" class="btn btn-secondary">逛素材中心</RouterLink>
        <RouterLink to="/projects" class="btn btn-secondary">我的作品</RouterLink>
        <RouterLink to="/help" class="btn soft">帮助与教程</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notFound{min-height:52vh}
</style>
