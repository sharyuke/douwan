<script setup>
/* =========================================================================
   色卡说明页（/colors/）
   -------------------------------------------------------------------------
   这一页对应「拼豆色号」「拼豆色卡对照」这类搜索意图：
   拼豆玩家最常卡住的就是「图纸上印的色号到底是哪个牌子的哪个号」。

   页面里的每一个数字都来自真实色板数据（src/data/palette.js →
   src/lib/palettes.js），不写死任何色号数量，也不编造品牌规格。
   ========================================================================= */

import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { PALETTE_BRANDS, PALETTE_COLORS, DEFAULT_BRAND_ID } from '../lib/palettes.js'

/* 自定义色板是每个用户自己维护的，对外没有意义，不进这个页面 */
const brands = computed(() => PALETTE_BRANDS.filter(b => !b.custom))

const activeId = ref(DEFAULT_BRAND_ID)
const keyword = ref('')

const activeBrand = computed(() => brands.value.find(b => b.id === activeId.value) || brands.value[0])

const colors = computed(() => {
  const list = PALETTE_COLORS[activeBrand.value.id] || []
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter(c => String(c.code).toLowerCase().includes(kw) || String(c.name).toLowerCase().includes(kw))
})

/* 一次性铺几百个格子会拖慢手机端，截断并说明 */
const SHOWN_LIMIT = 240
const shown = computed(() => colors.value.slice(0, SHOWN_LIMIT))
const truncated = computed(() => colors.value.length > SHOWN_LIMIT)

/* MARD 八个套装是同一套色号体系的不同包装，页面里要说清楚，免得被当成 8 套不同颜色 */
const mardSets = computed(() => brands.value.filter(b => b.id.startsWith('mard')))
</script>

<template>
  <div class="wrap main--pad colors">
    <header class="colorsHero">
      <span class="badge">色卡对照</span>
      <h1>拼豆色号与色卡对照</h1>
      <p class="lead">
        不同品牌的拼豆色号互不通用 —— A1 在漫德是浅黄，在别的品牌可能根本不存在。
        这里按品牌分别列出真实色号，并说明在豆玩里怎么把图纸上的颜色匹配成能买到的豆子。
      </p>
      <div class="row row--wrap" style="margin-top:18px">
        <RouterLink to="/create" class="btn primary lg">用这些色号生成图纸</RouterLink>
        <RouterLink to="/materials/" class="btn btn-secondary lg">免费拼豆素材库</RouterLink>
      </div>
    </header>

    <section class="secHead">
      <div>
        <h2>豆玩收录的品牌</h2>
        <p>共 {{ brands.length }} 个品牌色板，下面的色号数都是真实收录数量</p>
      </div>
    </section>

    <div class="brandGrid">
      <button
        v-for="b in brands"
        :key="b.id"
        type="button"
        class="brandCard"
        :class="{ 'is-on': b.id === activeBrand.id }"
        @click="activeId = b.id"
      >
        <b>{{ b.name }}</b>
        <span class="brandCard__count">{{ b.colorCount }} 色</span>
        <span class="brandCard__swatches">
          <i
            v-for="(c, i) in (PALETTE_COLORS[b.id] || []).slice(0, 14)"
            :key="`${b.id}-${i}`"
            :style="{ background: c.hex }"
            :title="`${c.code} ${c.name}`"
          />
        </span>
        <span class="brandCard__note">{{ b.desc }}</span>
      </button>
    </div>

    <section class="secHead">
      <div>
        <h2>{{ activeBrand.name }} 色号表</h2>
        <p>共 {{ activeBrand.colorCount }} 个色号，可按色号或颜色名搜索</p>
      </div>
      <input v-model="keyword" class="search" type="search" placeholder="搜索色号或颜色名" />
    </section>

    <div v-if="activeBrand.note" class="card">
      <div class="card__body">
        <p class="hint">{{ activeBrand.note }}</p>
      </div>
    </div>

    <div class="tableWrap card">
      <div class="card__body">
        <table class="colorTable">
          <thead>
            <tr>
              <th>色号</th>
              <th>颜色名</th>
              <th>色值</th>
              <th>预览</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in shown" :key="c.id">
              <td class="mono">{{ c.code }}</td>
              <td>{{ c.name }}</td>
              <td class="mono">{{ c.hex }}</td>
              <td><span class="chip" :style="{ background: c.hex }" /></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!shown.length" class="hint" style="padding:14px 0">没有匹配「{{ keyword }}」的色号，换个关键字试试。</p>
        <p v-if="truncated" class="hint" style="padding:12px 0 0">
          共 {{ colors.length }} 个匹配色号，这里只列出前 {{ SHOWN_LIMIT }} 个；用上面的搜索框缩小范围可以看到全部。
        </p>
      </div>
    </div>

    <section class="secHead">
      <div>
        <h2>色号怎么用</h2>
        <p>四步把照片变成能直接下单的图纸</p>
      </div>
    </section>

    <div class="stepRow">
      <div v-for="(s, i) in [
        { t: '选品牌', b: '按你手里的豆子选对应品牌；不知道就选漫德 MARD，国内最常见。' },
        { t: '选套装', b: '套装只影响可用色号的数量，不影响颜色本身。' },
        { t: '生成图纸', b: '上传图片或选素材，豆玩自动量化并把每格匹配到色板里的真实色号。' },
        { t: '按色号采购', b: '导出 CSV 色号清单，拿去搜同品牌的豆子即可。' }
      ]" :key="s.t" class="stepCard">
        <div class="stepNo">{{ i + 1 }}</div>
        <b>{{ s.t }}</b>
        <p>{{ s.b }}</p>
      </div>
    </div>

    <section class="secHead">
      <div><h2>常见疑问</h2></div>
    </section>

    <div class="qa card">
      <div class="card__body">
        <div class="qaItem">
          <h3>色号是什么，为什么不能混用？</h3>
          <p>
            色号是品牌给每一种颜色起的编号。漫德用 A1、A2、B1 这样的字母加数字编号，COCO 用数字编号，Hama 和 Perler 各有自己的 01、02……
            编号本身没有含义，颜色含义在牌子里，跨品牌套用编号会拿错颜色。所以豆玩不提供「通用色号」，每张图纸只标一个品牌的编号。
          </p>
        </div>
        <div class="qaItem">
          <h3>色差是怎么算的？</h3>
          <p>
            豆玩用 CIEDE2000 色差公式在色板里找最接近的颜色。它比常见的 RGB 距离更接近人眼判断，所以「看起来是同一种颜色」在量化时会被合成同一色号。
            这也是为什么图纸里的颜色数通常比你预期的少：引擎会把视觉上接近的色号合并，避免出现一堆只差几颗豆的近似色。
          </p>
        </div>
        <div class="qaItem">
          <h3>买不到某个色号怎么办？</h3>
          <p>
            先用相近色号替代，或者在设置里把目标颜色数调低，让引擎在更少的色号里凑近似。
            也可以在「我的库存」里勾掉没有的颜色，生成时会自动绕开它们。
          </p>
        </div>
        <div class="qaItem">
          <h3>漫德那八个套装是八套不同的颜色吗？</h3>
          <p>
            不是。{{ mardSets.map(s => s.name).join('、') }} 共用同一份色号数据 ——
            同一个色号在哪个套装里都是同一个色值，换套装只是增删可用的色号。
          </p>
        </div>
      </div>
    </div>

    <section class="secHead">
      <div><h2>继续</h2></div>
    </section>
    <div class="toolLinks">
      <RouterLink to="/" class="toolLink">
        <b>免费拼豆图纸生成器</b>
        <span class="hint">上传图片，一键生成带色号的拼豆图纸</span>
      </RouterLink>
      <RouterLink to="/materials/" class="toolLink">
        <b>免费拼豆素材库</b>
        <span class="hint">全部素材免费，选中就能生成图纸</span>
      </RouterLink>
      <RouterLink to="/help/" class="toolLink">
        <b>拼豆教程与常见问题</b>
        <span class="hint">选尺寸、熨烫、分板一次讲清</span>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.colorsHero{max-width:760px}
.colorsHero h1{font-size:var(--fs-h1);margin:14px 0 10px;letter-spacing:-.02em}
.lead{font-size:15px;color:var(--ink-2);line-height:1.9}
.brandGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.brandCard{
  display:flex;flex-direction:column;gap:8px;text-align:left;cursor:pointer;
  padding:16px;border-radius:var(--r-md);background:var(--surface);
  border:1px solid var(--line);transition:var(--t);font:inherit;color:inherit;
}
.brandCard:hover{border-color:var(--primary);transform:translateY(-2px);box-shadow:var(--sh-1)}
.brandCard.is-on{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)}
.brandCard b{font-size:var(--fs-sm);font-weight:800}
.brandCard__count{font-size:var(--fs-xs);color:var(--primary-deep);font-weight:800}
.brandCard__swatches{display:flex;flex-wrap:wrap;gap:3px}
.brandCard__swatches i{
  width:18px;height:18px;border-radius:4px;display:block;
  border:1px solid rgba(0,0,0,.12);
}
.brandCard__note{font-size:var(--fs-2xs);color:var(--muted);line-height:1.6}
.search{
  width:min(260px,100%);padding:9px 12px;border-radius:var(--r-sm);
  border:1px solid var(--line);background:var(--surface);font:inherit;font-size:var(--fs-xs);
}
.tableWrap{overflow-x:auto}
.colorTable{width:100%;border-collapse:collapse;font-size:var(--fs-xs)}
.colorTable th,.colorTable td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line)}
.colorTable th{font-weight:800;color:var(--ink-2);white-space:nowrap}
.colorTable .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.chip{display:inline-block;width:22px;height:22px;border-radius:6px;border:1px solid rgba(0,0,0,.12)}
.stepRow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.stepCard{position:relative;padding:20px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--line);box-shadow:var(--sh-1)}
.stepNo{
  width:30px;height:30px;border-radius:9px;background:var(--primary-soft);color:var(--primary-deep);
  display:grid;place-items:center;font-weight:900;font-size:var(--fs-sm);margin-bottom:11px;
}
.stepCard b{font-size:var(--fs-h3);display:block;margin-bottom:6px}
.stepCard p{font-size:var(--fs-xs);color:var(--muted);line-height:1.75}
.qaItem{margin-bottom:20px}
.qaItem:last-child{margin-bottom:0}
.qaItem h3{font-size:var(--fs-h3);margin-bottom:8px}
.qaItem p{font-size:var(--fs-sm);color:var(--ink-2);line-height:1.95}
.toolLinks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.toolLink{display:flex;flex-direction:column;gap:5px;padding:16px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line);transition:var(--t)}
.toolLink:hover{border-color:var(--primary);transform:translateY(-2px);box-shadow:var(--sh-1)}
.toolLink b{font-size:var(--fs-xs);line-height:1.5}
@media(max-width:900px){
  .stepRow,.toolLinks{grid-template-columns:1fr}
}
</style>
