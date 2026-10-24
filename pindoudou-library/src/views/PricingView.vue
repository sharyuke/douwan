<script setup>
import { RouterLink } from 'vue-router'
import PixelIcon from '../components/ui/PixelIcon.vue'
import { PALETTE_TOTAL_CODES } from '../lib/palettes.js'

/* 临时免费开放：卡密与会员制在前端停用。
   这一页从「套餐售卖」改成「免费说明」，恢复收费时再换回套餐 / 卡密两栏。 */

const highlights = [
  { icon: 'star', title: '不用兑换', desc: '没有卡密输入框，也没有套餐购买入口' },
  { icon: 'smile', title: '不用注册', desc: '打开就能生成、编辑和导出，登录只用于保存账号身份' },
  { icon: 'sparkles', title: '不限次数', desc: '图纸生成与导出都在本地完成，不扣次数、不扣 Credits' }
]

const features = [
  {
    title: '三方案自动搜索',
    desc: '高还原 / 好拼版 / 艺术版一次给出，并标出推荐方案与理由。'
  },
  {
    title: '可拼性优化',
    desc: '去孤立豆、抖动、合并零星色，让图纸真的能一板一板拼下去。'
  },
  {
    title: '大画布与自定义分板',
    desc: '按 52 / 78 / 104 / 120 钉画线板一块一块加，单边最大 1000 格。'
  },
  {
    title: '全部品牌色板',
    desc: `MARD 24–291 八套装，以及 COCO / 漫漫 / 盼盼 / 咪小窝 / 优肯 / Hama / Perler，共 ${PALETTE_TOTAL_CODES} 个色号。`
  },
  {
    title: '库存约束配色',
    desc: '只用你已有的豆来配色，先消耗库存，再决定买什么。'
  },
  {
    title: '完整交付',
    desc: 'PNG / JPG / SVG、PDF 分板 1:1 打印、材料清单 CSV、分享卡全部可用。'
  },
  {
    title: '拼制进度',
    desc: '逐颗或整板标记进度，随时看到这一板还差多少颗。'
  },
  {
    title: '进阶素材',
    desc: '素材库里原本标着 PRO 的图案，现在直接载入生成，不再锁定。'
  }
]

const faqs = [
  {
    q: '为什么现在全部免费？',
    a: '卡密与会员制暂时停用，所有已上线功能直接开放。这是阶段性安排，恢复收费前会在站内说明；已经生成和保存的作品不受影响。'
  },
  {
    q: '以前兑换的卡密还有效吗？',
    a: '服务端的兑换记录和权益数据都保留着，只是前台暂时不再展示兑换入口，也不需要再兑换。以后恢复会员制时，历史权益会按原记录重新生效。'
  },
  {
    q: '需要注册或登录吗？',
    a: '不需要。图片解码、生成、编辑和导出都在浏览器本地完成。登录只用于绑定账号、换设备时找回身份，不影响任何功能的使用。'
  },
  {
    q: '我的照片会被上传吗？',
    a: '不会。图片处理和图纸生成全部在你的浏览器里完成；只有页面访问量和匿名功能事件会上报，不包含照片内容。'
  },
  {
    q: '色号和真实豆子对得上吗？',
    a: '色板数据来自公开整理的第三方色卡（漫德 MARD、COCO、漫漫、盼盼、咪小窝、优肯 Artkal、Hama、Perler）。漫德体系做了两份来源的逐色交叉验证，但第三方数据无法保证永久准确，采购前请以实体色卡为准。同色号在不同品牌之间不能通用。'
  },
  {
    q: '可以商用吗？',
    a: '平台自制素材可免费使用在个人作品中。批量生成、店铺信息自定义与正式商用授权属于尚未开放的 Creator 能力，当前不售卖。'
  }
]
</script>

<template>
  <div class="wrap main--pad">
    <div class="pagehead freeHead">
      <div>
        <span class="badge">限时开放</span>
        <h1>全部功能免费开放</h1>
        <p>
          卡密与会员制暂时停用：不用兑换、不用开通，所有已上线功能直接可用。
          图纸生成、编辑和导出仍然全部在你的浏览器里完成。
        </p>
      </div>
      <RouterLink to="/editor" class="btn primary">去创作</RouterLink>
    </div>

    <div class="highlightRow">
      <div v-for="h in highlights" :key="h.title" class="highlight">
        <span class="highlight__icon"><PixelIcon :name="h.icon" :size="20" /></span>
        <div>
          <b>{{ h.title }}</b>
          <p>{{ h.desc }}</p>
        </div>
      </div>
    </div>

    <section class="secHead">
      <div>
        <h2>原来要 Pro 的功能，现在都能用</h2>
        <p>不需要升级，也没有隐藏的次数限制</p>
      </div>
    </section>
    <div class="freeGrid">
      <article v-for="f in features" :key="f.title" class="freeCard">
        <b>{{ f.title }}</b>
        <p>{{ f.desc }}</p>
      </article>
    </div>

    <div class="noticeBox">
      <b>已经兑换过卡密？</b>
      <p>
        不用做任何操作。服务端的兑换记录和权益数据都保留着，只是前台暂停了兑换与套餐入口；
        以后恢复会员制时，历史权益会按原记录重新生效。
      </p>
    </div>

    <section class="secHead">
      <div><h2>常见问题</h2><p>关于这次免费开放</p></div>
    </section>
    <div class="faq">
      <details v-for="(f, i) in faqs" :key="f.q" :open="i === 0">
        <summary>{{ f.q }}</summary>
        <p>{{ f.a }}</p>
      </details>
    </div>

    <div class="ctaBox">
      <div>
        <b>直接开始，不用先开通</b>
        <p>上传一张照片，或者从素材库里挑一个现成图案。</p>
      </div>
      <div class="ctaBox__actions">
        <RouterLink to="/editor" class="btn primary">上传照片生成</RouterLink>
        <RouterLink to="/library" class="btn btn-secondary">逛素材库</RouterLink>
      </div>
    </div>

    <p class="hint" style="margin-top:24px;text-align:center">
      免费开放期间不产生任何费用，也不会自动扣款或续费。
    </p>
  </div>
</template>

<style scoped>
.freeHead{align-items:center}
.freeHead h1{margin-top:12px}
.freeHead p{max-width:700px;margin-top:10px}
.highlightRow{
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;
  max-width:1000px;margin:22px auto 8px;
}
.highlight{
  display:flex;align-items:flex-start;gap:12px;padding:16px 17px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);box-shadow:var(--sh-1);
}
.highlight__icon{color:var(--primary-ink);line-height:1.2;margin-top:2px}
.highlight b{font-size:var(--fs-sm)}
.highlight p{font-size:var(--fs-2xs);color:var(--muted);line-height:1.75;margin-top:4px}
.freeGrid{
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;
  max-width:1100px;margin:0 auto;
}
.freeCard{
  padding:16px;border-radius:var(--r-md);background:var(--surface);
  border:1px solid var(--line);box-shadow:var(--sh-1);
}
.freeCard b{font-size:var(--fs-xs)}
.freeCard p{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8;margin-top:6px}
.noticeBox{
  max-width:760px;margin:24px auto 0;padding:18px 20px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);box-shadow:var(--sh-1);
  display:flex;flex-direction:column;gap:8px;
}
.noticeBox b{font-size:var(--fs-h3)}
.noticeBox p{font-size:var(--fs-xs);color:var(--muted);line-height:1.8}
.ctaBox{
  max-width:760px;margin:26px auto 0;padding:20px;border-radius:var(--r-lg);
  background:linear-gradient(140deg,var(--yellow-soft),var(--surface-warm),var(--primary-soft));
  border:1px solid #F0E3B4;display:flex;align-items:center;justify-content:space-between;
  gap:16px;flex-wrap:wrap;
}
.ctaBox b{font-size:var(--fs-h3)}
.ctaBox p{font-size:var(--fs-xs);color:var(--ink-2);margin-top:5px}
.ctaBox__actions{display:flex;gap:9px;flex-wrap:wrap}
@media(max-width:1000px){
  .freeGrid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:820px){
  .highlightRow{grid-template-columns:1fr}
  .freeGrid{grid-template-columns:1fr}
}
</style>
