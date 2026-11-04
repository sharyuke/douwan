<script setup>
/* 素材库 Banner：按 v3 设计规范重做（纸白 + 青柠，与全站同一套 token）。
   文案沿用原 Banner 的标题与副标题，插画换成素材库自己的矢量素材。 */
import { computed } from 'vue'
import { assetById } from '../../data/assets.js'

const IDS = ['a1f8ajij', 'a1d1zrda', 'a42se2', 'a463b5']
const items = computed(() => IDS.map(id => assetById(id)).filter(Boolean))
</script>

<template>
  <section class="libBanner">
    <div class="libBanner__copy">
      <h2>所爱皆可拼，<em>万物皆可造</em></h2>
      <p>海量免费拼豆素材，激发你的创作灵感</p>
    </div>
    <div class="libBanner__art" aria-hidden="true">
      <span v-for="(a, i) in items" :key="a.id" class="libBanner__tile" :class="`t${i}`">
        <span class="libBanner__svg" v-html="a.svg" />
      </span>
    </div>
  </section>
</template>

<style scoped>
.libBanner{
  display:flex;align-items:center;justify-content:space-between;gap:24px;
  min-height:152px;padding:24px 36px;border:1px solid var(--line);border-radius:20px;
  background:
    radial-gradient(120% 160% at 100% 0%, #EFF8C9 0%, rgba(239,248,201,0) 58%),
    linear-gradient(110deg,#FBFDF4,#F6FAE6);
  overflow:hidden;
}
.libBanner__copy h2{
  margin:0;font-size:28px;font-weight:700;letter-spacing:0;
  color:var(--ink);line-height:var(--ty-page-lh);
}
.libBanner__copy em{
  font-style:normal;
  background:linear-gradient(transparent 64%, var(--primary) 64%);
}
.libBanner__copy p{margin:8px 0 0;font-size:var(--fs-sm);color:var(--ink-2);line-height:var(--ty-body-lh)}
.libBanner__art{display:flex;align-items:center;gap:12px;flex:0 0 auto}
.libBanner__tile{
  width:84px;height:84px;padding:8px;border-radius:18px;background:#fff;
  border:1px solid var(--line);box-shadow:0 6px 16px rgba(31,31,29,.06);
  display:grid;place-items:center;transform:rotate(-4deg);
}
.libBanner__tile.t1{transform:rotate(3deg) translateY(10px)}
.libBanner__tile.t2{transform:rotate(-2deg) translateY(-6px)}
.libBanner__tile.t3{transform:rotate(5deg) translateY(6px)}
.libBanner__svg,.libBanner__svg :deep(svg){display:block;width:100%;height:100%}
@media(max-width:900px){
  .libBanner{padding:20px 22px}
  .libBanner__art{display:none}
}
</style>
