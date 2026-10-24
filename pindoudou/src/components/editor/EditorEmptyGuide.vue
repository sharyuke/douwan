/* =========================================================================
   桌面 / 平板：画布空状态引导
   依据 2026-10-22 交付包（豆玩_桌面平板_空画布引导_V1）：
   · 标题 / 副标题、横向三步卡、示例分隔线、六个示例、底部 CTA
   · 三步卡是静态说明，唯一点击入口是底部「使用示例图片体验」
   · 示意图用项目已有素材（矢量 SVG / 真实生成的像素图），不放截图
   · 手机端不渲染这块（EditorCanvas 里另一套空状态保持原样）
   ========================================================================= */
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'
import { assetById } from '../../data/assets.js'
import { remoteAssets, pickAsset } from '../../composables/useAssets.js'

/* 配图用素材库现有的图（后台运营上传、按运营排序最前的 6 个免费素材）：
   第一步展示原图，第二 / 三步拿同一张图真跑一遍像素化。
   素材库是空的或接口失败时退回内置素材，空状态不留空白。 */
const FALLBACK_DEMO_ID = 'a1f8ajij'
const FALLBACK_EXAMPLE_IDS = ['a1d1zrda', 'a42se2', 'a463b5', 'a3lm8mo', 'a1dnmgef', 'a1bebabw']

/* 示例格底色：直接取自交付切片 07（蓝 / 粉 / 黄绿 / 薄荷 / 藕紫 / 浅绿） */
const TILE_BG = ['#E7F2F8', '#FDEEEB', '#F4F5E2', '#EEF5F4', '#F8F0F4', '#F1F6EC']

const examples = computed(() => {
  const remoteFree = remoteAssets.value.filter(a => a.tier === 'free')
  if (remoteFree.length) return remoteFree.slice(0, 6)
  return FALLBACK_EXAMPLE_IDS.map(id => assetById(id)).filter(Boolean)
})

const demoAsset = computed(() => examples.value[0] || assetById(FALLBACK_DEMO_ID))
/* 默认不选中任何一格（切片里示例就是六个平铺的小图）；
   没选时 CTA 用第一个示例，和项目默认示例行为一致。 */
const selectedId = ref('')
const busy = ref(false)

/* 第二 / 第三步的示意图：用真实引擎把素材像素化（29×29，和素材自身网格一致），
   空闲时再算，不挡首屏；失败就退回矢量图，不留空白。 */
const demoPattern = ref(null)
const demoDots = computed(() => {
  const p = demoPattern.value
  return p && Array.isArray(p.palette) ? p.palette.slice(0, 6).map(c => c.hex).filter(Boolean) : []
})

/* 第二 / 三步的示意图画在 canvas 上。
   这里没有复用 PatternPreview：它会把空格铺成浅灰底（图纸语境下是对的），
   而示意图需要空格透明 —— 第二步露出卡片底色、第三步露出网格。 */
const rootEl = ref(null)

function paintDemo(el) {
  const p = demoPattern.value
  if (!el || !p || !p.cells) return
  const { width: gw, height: gh, cells, palette } = p
  const cell = Math.max(1, Math.floor(128 / Math.max(gw, gh)))
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  el.width = gw * cell * dpr
  el.height = gh * cell * dpr
  el.style.width = `${gw * cell}px`
  el.style.height = `${gh * cell}px`
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, gw * cell, gh * cell)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = cells[y * gw + x]
      const hex = k >= 0 ? palette[k] && palette[k].hex : null
      if (!hex) continue
      ctx.fillStyle = hex
      ctx.fillRect(x * cell, y * cell, cell, cell)
    }
  }
}

watch(demoPattern, () => nextTick(() => {
  if (!rootEl.value) return
  rootEl.value.querySelectorAll('canvas.demoCanvas').forEach(paintDemo)
}))

const steps = [
  { key: 'upload', num: 1, title: '上传图片', lines: ['选择你喜欢的图片', '支持 JPG / PNG / WebP / GIF'] },
  { key: 'convert', num: 2, title: '转换图纸', lines: ['自动像素化并匹配色号', '可调整尺寸与颜色'] },
  { key: 'draw', num: 3, title: '生成拼豆图纸', lines: ['获得网格图、色号和用量', '支持分板与高清导出'] }
]

let idleHandle = null
let idleTimer = null
let mounted = false
/* 每次重建都换一个号：素材库数据晚到时，先发出去的那次像素化要能被丢弃 */
let demoToken = 0

/* 内置素材的 SVG 都带一层整幅底色；像素化时它会被当成真实格子，
   第二 / 三步的示意图就会多出一块方块。示意用图去掉这层底色即可。 */
function pixelSvgOf(asset) {
  return asset && asset.svg ? asset.svg.replace(/<rect[^>]*width="200"[^>]*height="160"[^>]*\/>/, '') : ''
}

/** 后台素材的图片地址（缩略图，同源） */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('素材图片加载失败'))
    im.src = url
  })
}

async function buildDemo() {
  const asset = demoAsset.value
  if (!asset) return
  const token = ++demoToken
  try {
    const [{ svgToImage }, { generateVariant }, { getColors, DEFAULT_BRAND_ID }] = await Promise.all([
      import('../../composables/useStudio.js'),
      import('../../lib/pattern.js'),
      import('../../lib/palettes.js')
    ])
    let img
    let removeBg = false
    if (asset.remote) {
      /* 缩略图是铺白底的 JPEG，白底交给「抠图」按颜色模型去掉；
         透明原图有 900KB+，只为了画一张 128px 的示意图不值得。 */
      img = await loadImage(asset.image)
      removeBg = true
    } else {
      img = (await svgToImage(pixelSvgOf(asset) || asset.svg)).img
    }
    if (token !== demoToken) return
    demoPattern.value = generateVariant({
      img,
      gw: 29,
      gh: 29,
      fit: 'contain',
      targetColors: 14,
      removeBg,
      brandId: DEFAULT_BRAND_ID,
      colors: getColors(DEFAULT_BRAND_ID),
      variantKey: 'easy'
    })
  } catch {
    /* 示意图失败不影响空状态本身 */
    if (token === demoToken) demoPattern.value = null
  }
}

function scheduleDemo() {
  if (!mounted) return
  /* 手机端不显示这块，别白算一次像素图 */
  if (!window.matchMedia('(min-width:781px)').matches) return
  if (idleHandle != null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle)
  if (idleTimer != null) clearTimeout(idleTimer)
  if (typeof window.requestIdleCallback === 'function') {
    idleHandle = window.requestIdleCallback(buildDemo, { timeout: 1200 })
  } else {
    idleTimer = setTimeout(buildDemo, 160)
  }
}

/* 素材库是异步拉的：第一帧可能还是内置兜底素材，数据回来后再重算一次。
   旧像素图先清掉，避免第一步已经换成新图、第二 / 三步还挂着上一张。 */
watch(demoAsset, () => {
  demoPattern.value = null
  scheduleDemo()
})

onMounted(() => {
  mounted = true
  scheduleDemo()
})

onBeforeUnmount(() => {
  mounted = false
  demoToken++
  if (idleHandle != null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle)
  if (idleTimer != null) clearTimeout(idleTimer)
})

const selected = computed(() => examples.value.find(a => a.id === selectedId.value) || examples.value[0] || null)

async function useExample() {
  if (busy.value || !selected.value) return
  busy.value = true
  try {
    /* 走素材库同一条载入链路：落图 → 按套餐收敛尺寸 → 正常生成 */
    await pickAsset(selected.value.id)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section ref="rootEl" class="guide" aria-label="开始创作">
    <h2 class="guide__title">开始你的拼豆创作吧！</h2>
    <p class="guide__sub">上传图片，自动转换成拼豆图纸，立即预览效果。</p>

    <ol class="guide__steps">
      <li v-for="(s, i) in steps" :key="s.key" class="stepCard">
        <span class="stepArt" :class="`stepArt--${s.key}`">
          <i class="bracket tl" /><i class="bracket tr" /><i class="bracket bl" /><i class="bracket br" />
          <span v-if="s.key === 'upload'" class="stepArt__frame" />
          <span class="stepArt__media">
            <span v-if="s.key === 'upload' && demoAsset" class="artImg">
              <img v-if="demoAsset.image" :src="demoAsset.image" :alt="demoAsset.name">
              <span v-else class="artSvg" v-html="demoAsset.svg" />
            </span>
            <template v-else-if="demoPattern">
              <canvas class="demoCanvas" aria-hidden="true" />
            </template>
            <span v-else-if="demoAsset" class="artImg">
              <img v-if="demoAsset.image" :src="demoAsset.image" :alt="demoAsset.name">
              <span v-else class="artSvg" v-html="demoAsset.svg" />
            </span>
          </span>
          <span v-if="s.key === 'draw' && demoDots.length" class="stepArt__dots" aria-hidden="true">
            <i v-for="(hex, k) in demoDots" :key="k" :style="{ background: hex }" />
          </span>
        </span>
        <span class="stepCard__head">
          <span class="stepCard__num">{{ s.num }}</span>
          <b class="stepCard__title">{{ s.title }}</b>
        </span>
        <span v-for="line in s.lines" :key="line" class="stepCard__line">{{ line }}</span>
        <i v-if="i < steps.length - 1" class="stepArrow" aria-hidden="true">
          <PixelIcon name="arrowRight" :size="14" mono />
        </i>
      </li>
    </ol>

    <div class="guide__divider"><span class="guide__rule" /><span class="guide__dividerText">或者试试这些示例</span><span class="guide__rule" /></div>

    <div class="guide__examples">
      <button
        v-for="(a, i) in examples" :key="a.id" type="button" class="exTile"
        :class="{ on: a.id === selectedId }" :style="{ background: TILE_BG[i % TILE_BG.length] }"
        :aria-pressed="a.id === selectedId" :title="a.name" :aria-label="a.name"
        @click="selectedId = a.id"
      >
        <span class="exArt">
          <img v-if="a.image" :src="a.image" :alt="a.name">
          <span v-else class="exSvg" v-html="a.svg" />
        </span>
      </button>
    </div>

    <button type="button" class="guide__cta" :disabled="busy" @click="useExample">
      <span v-if="busy" class="spinner" aria-hidden="true" />
      <PixelIcon v-else name="photo" :size="16" />
      <span>{{ busy ? '正在生成图纸…' : '使用示例图片体验' }}</span>
    </button>
  </section>
</template>

<style scoped>
/* 局部 token：只影响这块引导，不动全局按钮 / 卡片尺寸 */
.guide{
  --g-ink:#243341;
  --g-sub:#8B929B;
  --g-line:#FCEDCC;
  --g-accent:#FFD23F;
  --g-card:#FFFDF8;
  --g-cream:#FDFAF2;
  width:100%;
  max-width:700px;
  margin:0 auto;
  padding:clamp(10px,2.6vh,30px) clamp(6px,1.6vw,20px);
  display:flex;
  flex-direction:column;
  align-items:center;
  text-align:center;
  color:var(--g-ink);
}
.guide__title{
  margin:0;
  font-size:clamp(18px,1.85vw,26px);
  font-weight:800;
  line-height:1.35;
  letter-spacing:.2px;
  color:var(--g-ink);
}
.guide__sub{
  margin:9px 0 0;
  font-size:clamp(11.5px,1.02vw,14px);
  line-height:1.6;
  color:var(--g-sub);
}

/* ---------------- 三步卡 ---------------- */
.guide__steps{
  list-style:none;
  margin:clamp(16px,2.4vw,28px) 0 0;
  padding:0;
  width:100%;
  display:flex;
  align-items:stretch;
  justify-content:center;
  --g-gap:clamp(9px,1.5vw,18px);
  gap:var(--g-gap);
}
.stepCard{
  position:relative;
  flex:1 1 0;
  min-width:0;
  max-width:186px;
  padding:clamp(7px,1vw,13px) clamp(6px,.9vw,12px) clamp(9px,1.2vw,14px);
  border:1.5px solid var(--g-line);
  border-radius:16px;
  background:linear-gradient(180deg,var(--g-card),var(--g-cream));
  display:flex;
  flex-direction:column;
  align-items:center;
}
.stepCard__head{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  margin-top:clamp(6px,.9vw,11px);
}
.stepCard__num{
  width:clamp(16px,1.55vw,20px);
  height:clamp(16px,1.55vw,20px);
  border-radius:50%;
  background:var(--g-accent);
  color:var(--g-ink);
  font-size:clamp(9px,.85vw,11px);
  font-weight:800;
  line-height:1;
  display:grid;
  place-items:center;
}
.stepCard__title{
  font-size:clamp(11px,1vw,13px);
  font-weight:800;
  color:var(--g-ink);
  white-space:nowrap;
}
.stepCard__line{
  margin-top:4px;
  font-size:clamp(9.5px,.86vw,11px);
  line-height:1.55;
  color:var(--g-sub);
  text-wrap:balance;
}
.stepArrow{
  position:absolute;
  top:50%;
  left:calc(100% + var(--g-gap) / 2 - 7px);
  transform:translateY(-50%);
  color:#C4C9D1;
  display:block;
  line-height:0;
}
.guide__steps > .stepCard:last-child .stepArrow{display:none}

/* ---------------- 示意图 ---------------- */
.stepArt{
  position:relative;
  display:block;
  width:100%;
  max-width:118px;
  aspect-ratio:1;
  /* 让图片的 multiply 只跟这张卡片的底色混合，不吃到页面背景 */
  isolation:isolate;
}
.bracket{
  position:absolute;
  width:10px;
  height:10px;
  border:2px solid var(--g-accent);
  z-index:1;
}
.bracket.tl{top:0;left:0;border-right:0;border-bottom:0;border-top-left-radius:3px}
.bracket.tr{top:0;right:0;border-left:0;border-bottom:0;border-top-right-radius:3px}
.bracket.bl{bottom:0;left:0;border-right:0;border-top:0;border-bottom-left-radius:3px}
.bracket.br{bottom:0;right:0;border-left:0;border-top:0;border-bottom-right-radius:3px}
.stepArt__frame{
  position:absolute;
  inset:8px;
  border:1px dashed #E5DCC8;
  border-radius:6px;
}
.stepArt__media{
  position:absolute;
  inset:9px;
  display:grid;
  place-items:center;
  overflow:hidden;
}
.stepArt--draw .stepArt__media{
  right:clamp(12px,1.2vw,16px);
  background-image:
    linear-gradient(to right,rgba(120,170,200,.22) 1px,transparent 1px),
    linear-gradient(to bottom,rgba(120,170,200,.22) 1px,transparent 1px);
  background-size:calc(100% / 29) calc(100% / 29);
}
.stepArt__media :deep(canvas){
  max-width:100%;
  max-height:100%;
  width:auto;
  height:auto;
}
.demoCanvas{display:block;image-rendering:pixelated}
.artSvg{display:block;width:100%;height:100%}
.artSvg :deep(svg){display:block;width:100%;height:100%}
/* 素材库的缩略图是白底 JPEG：multiply 让白底融进卡片 / 色块，
   主体直接浮在底色上，和原来矢量素材的观感一致 */
.artImg{display:block;width:100%;height:100%}
.artImg img{display:block;width:100%;height:100%;object-fit:contain;mix-blend-mode:multiply}
.stepArt__dots{
  position:absolute;
  top:50%;
  right:-2px;
  transform:translateY(-50%);
  display:flex;
  flex-direction:column;
  gap:4px;
}
.stepArt__dots i{
  width:clamp(6px,.62vw,8px);
  height:clamp(6px,.62vw,8px);
  border-radius:50%;
  display:block;
}

/* ---------------- 示例 ---------------- */
.guide__divider{
  width:100%;
  margin:clamp(16px,2.4vw,28px) 0 clamp(10px,1.4vw,16px);
  display:flex;
  align-items:center;
  gap:10px;
}
.guide__rule{
  flex:1 1 auto;
  border-top:1px dashed #E7E1D3;
}
.guide__dividerText{
  flex:0 0 auto;
  font-size:clamp(10px,.9vw,11.5px);
  color:#9AA1AA;
  white-space:nowrap;
}
.guide__examples{
  display:flex;
  flex-wrap:wrap;
  justify-content:center;
  gap:clamp(8px,1.6vw,18px);
}
.exTile{
  width:clamp(42px,5.6vw,62px);
  height:clamp(42px,5.6vw,62px);
  padding:clamp(5px,.7vw,8px);
  border:1.5px solid transparent;
  border-radius:14px;
  display:grid;
  place-items:center;
  cursor:pointer;
  transition:var(--t);
  /* 同上：白底缩略图的 multiply 只跟这一格自己的底色混 */
  isolation:isolate;
}
.exTile:hover{transform:translateY(-1px)}
.exTile.on{border-color:var(--g-accent);box-shadow:0 0 0 2px rgba(255,210,63,.25)}
.exTile:focus-visible{outline:2px solid var(--g-accent);outline-offset:2px}
.exArt{display:block;width:100%;height:100%}
.exArt :deep(svg){display:block;width:100%;height:100%}
.exArt img{display:block;width:100%;height:100%;object-fit:contain;mix-blend-mode:multiply}
.exSvg{display:block;width:100%;height:100%}
.exSvg :deep(svg){display:block;width:100%;height:100%}

/* ---------------- CTA ---------------- */
.guide__cta{
  margin-top:clamp(16px,2.4vw,26px);
  height:clamp(36px,3vw,42px);
  padding:0 clamp(18px,2vw,26px);
  border:1.5px solid #F6E3B4;
  border-radius:999px;
  background:#FDF5DE;
  color:var(--g-ink);
  font-size:clamp(12px,1vw,13.5px);
  font-weight:800;
  display:inline-flex;
  align-items:center;
  gap:8px;
  cursor:pointer;
  transition:var(--t);
}
.guide__cta:hover{background:#FCEFD0}
.guide__cta:disabled{opacity:.6;cursor:default}
/* 生成要跑一两秒（大图更久）：转个圈，别让按钮看起来没反应 */
.guide__cta .spinner{width:14px;height:14px;border-width:2px;flex:0 0 auto}
.guide__cta:focus-visible{outline:2px solid var(--g-accent);outline-offset:2px}

/* ---------------- 窄屏 / 矮屏收敛 ----------------
   平板（781~1100）画布列只有 400 多像素，三步卡按比例缩小；
   1320 这一档锁了整页高度，900 高的屏幕舞台只有 ~490px，纵向间距再收一档。 */
@media(max-width:1100px){
  .stepCard{padding-left:4px;padding-right:4px}
  .stepCard__line{font-size:clamp(9px,.82vw,10.5px)}
  .stepArt{max-width:104px}
}
@media(max-height:1000px){
  .guide{padding-top:6px;padding-bottom:6px}
  .guide__steps{margin-top:16px}
  .stepArt{max-width:94px}
  .stepCard__head{margin-top:6px}
  .stepCard__line{margin-top:3px}
  .guide__divider{margin:14px 0 10px}
  .exTile{width:clamp(40px,4.6vw,54px);height:clamp(40px,4.6vw,54px)}
  .guide__cta{margin-top:14px;height:36px}
}
/* 1320 这一档画布列很窄，工具栏加上「实际大小」后会折成两行，
   舞台比 1440 少约 32px；900 高的屏幕上空状态只差几像素就顶出滚动条。
   这里只收纵向间距，标题 / 示意图尺寸保持原样。 */
@media(max-height:920px){
  .guide__steps{margin-top:12px}
  .guide__divider{margin:10px 0 8px}
  .guide__cta{margin-top:10px}
}
@media(max-height:880px){
  .guide__title{font-size:clamp(17px,1.5vw,22px)}
  .guide__sub{margin-top:6px}
  .guide__steps{margin-top:12px}
  .stepArt{max-width:80px}
  .guide__divider{margin:10px 0 8px}
  .exTile{width:clamp(38px,4vw,46px);height:clamp(38px,4vw,46px)}
  .guide__cta{margin-top:10px;height:34px}
}
</style>
