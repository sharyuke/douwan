<script setup>
import { RouterLink } from 'vue-router'
import logoDouwan from '../../assets/logo-douwan.webp'
const year = new Date().getFullYear()

const groups = [
  {
    title: '开始创作',
    links: [
      { to: '/editor', label: '上传照片生成' },
      { to: '/library', label: '免费素材库' },
      { to: '/projects', label: '我的作品' },
      { to: '/inventory', label: '我的库存' }
    ]
  },
  {
    title: '拼豆工具',
    links: [
      { to: '/tools/perler-bead-pattern-maker', label: 'Perler 图纸生成器' },
      { to: '/tools/hama-bead-pattern-maker', label: 'Hama 图纸生成器' },
      { to: '/tools/artkal-bead-pattern-maker', label: 'Artkal 图纸生成器' },
      { to: '/tools/photo-to-bead-pattern', label: '照片转拼豆图纸' }
    ]
  },
  {
    title: '帮助与说明',
    links: [
      { to: '/help', label: '教程与常见问题' },
      { to: '/settings', label: '设置与隐私' },
      { to: '/account', label: '我的账户' }
    ]
  }
]
</script>

<template>
  <footer class="footer no-print">
    <div class="wrap">
      <div class="footer__grid">
        <div>
          <div class="brand" style="margin-bottom:12px">
            <img class="brand__logo" :src="logoDouwan" alt="豆玩 DOUWAN" width="157" height="52">
          </div>
          <p class="muted" style="max-width:300px;line-height:1.8">
            把喜欢的东西，拼成自己的作品。<br>
            帮你把照片和创意，变成好看、好拼、省豆的拼豆图。
          </p>
          <p class="hint" style="margin-top:10px">
            图片转换在浏览器本地完成，照片不会上传到服务器。
          </p>
        </div>
        <div v-for="g in groups" :key="g.title">
          <h4>{{ g.title }}</h4>
          <RouterLink v-for="l in g.links" :key="l.to" :to="l.to">{{ l.label }}</RouterLink>
        </div>
      </div>
      <div class="footer__bottom">
        <span>© {{ year }} 豆玩 DOUWAN · 本站色卡数据来自公开整理的第三方色卡，采购前请以实体色卡为准</span>
        <span>拼豆成品与品牌商标归各品牌方所有</span>
        <a class="footer__icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">渝ICP备14009814号</a>
      </div>
    </div>
  </footer>
</template>
