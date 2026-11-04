<script setup>
/* 站点页脚（2026-11-01，按「豆玩 · 像素花园首页」重做）
   设计稿只有一行：左侧色卡说明 + 备案号，右侧版权。 */
const year = new Date().getFullYear()
</script>

<template>
  <footer class="footV3 no-print">
    <div class="footV3__in">
      <p class="footV3__legal">
        <span>本站色卡数据来自公开整理的第三方色卡，采购前请以实体色卡为准</span>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">渝ICP备14009814号</a>
      </p>
      <p class="footV3__copy">© 豆玩 DOUWAN</p>
    </div>
  </footer>
</template>

<style scoped>
.footV3{
  flex:0 0 auto;height:82px;background:var(--cream);
  border-top:1px solid var(--line);
}
.footV3__in{
  width:min(var(--page-max),100%);height:100%;margin:0 auto;padding:0 56px;
  display:flex;align-items:center;justify-content:space-between;gap:24px;
}
.footV3__legal{display:flex;align-items:center;gap:24px;margin:0;font-size:12px;color:var(--muted);line-height:var(--ty-caption-lh)}
.footV3__legal a{color:var(--muted);white-space:nowrap}
.footV3__legal a:hover{color:var(--ink)}
.footV3__copy{margin:0;font-size:12px;color:var(--muted);white-space:nowrap;line-height:var(--ty-caption-lh)}

@media(max-width:780px){
  .footV3{height:auto;padding:22px 0}
  .footV3__in{flex-direction:column;align-items:center;gap:8px;padding:0 18px;text-align:center}
  .footV3__legal{flex-direction:column;gap:4px;font-size:12px;line-height:var(--ty-caption-lh)}
  .footV3__copy{font-size:12px;line-height:var(--ty-caption-lh)}
}
</style>
