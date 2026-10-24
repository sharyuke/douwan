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
      { to: '/pricing', label: '会员与定价' },
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
            <img class="brand__logo" :src="logoDouwan" alt="豆玩 DOUWAN" width="130" height="40">
          </div>
          <p class="muted" style="max-width:300px;line-height:1.8">
            把喜欢的东西，拼成自己的作品。<br>
            AI 帮你把照片和创意，变成好看、好拼、省豆的拼豆图。
          </p>
          <p class="hint" style="margin-top:10px">
            图片转换在浏览器本地完成，常规转换不会上传照片。只有你主动使用 AI 生成时，图片才会送到豆玩自建的推理节点。
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
      </div>
    </div>
  </footer>
</template>
