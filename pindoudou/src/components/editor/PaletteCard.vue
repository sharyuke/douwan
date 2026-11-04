<script setup>
/* =========================================================================
   全屏工作台右侧「色板」卡（设计稿 1:2445「自由创作 · 工具栏展开」右下的换色面板）

   设计稿的选色流程是三步：
     ① 先选色卡系列（品牌）→ ② 再按色系筛选 → ③ 搜索色号 / 颜色名 → 多行网格挑色
   所以这张卡不是「一排色块」，而是右栏里的一张折叠卡：
     · 收起时只有一行「色板」+ 箭头（与「我的库存」同一套卡头样式）；
     · 展开后依次是系列下拉、色系胶囊、搜索框、多行色块网格；
     · 网格选中项有明显标记（青柠描边 + 对勾），底部写当前颜色。

   旧的底部横向色板条不再是自由画布的主选色方式（那条只列这张图用到的颜色），
   自由画布要挑新颜色时从这里进。
   ========================================================================= */
import { computed, ref, watch } from 'vue'
import { options, brushColorId, availableColors } from '../../composables/useStudio.js'
import { PALETTE_BRANDS, getColorById } from '../../lib/palettes.js'
import Icon from '../ui/Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  /* 飞出模式：面板从左侧工具轨的「当前颜色」色块向右滑出来。
     这种形态没有卡头（入口就是那颗色块），展开即整块面板 —— 内容与样式与卡里完全一致。 */
  flyout: { type: Boolean, default: false }
})
const emit = defineEmits(['update:open'])

/* 色系（按 Lab 色相算的粗分类）。色卡数据里没有族字段，
   自己按色相 / 饱和度 / 明度归类，够用而且稳定。 */
const FAMILY_LABEL = {
  red: '红色系', orange: '橙色系', yellow: '黄色系', green: '绿色系',
  cyan: '青色系', blue: '蓝色系', purple: '紫色系', pink: '粉色系',
  brown: '棕色系', white: '白色系', gray: '灰色系', black: '黑色系'
}

function familyOf(color) {
  const lab = color && color.lab
  if (!lab || lab.length < 3) return 'gray'
  const L = Number(lab[0]) || 0
  const a = Number(lab[1]) || 0
  const b = Number(lab[2]) || 0
  const c = Math.sqrt(a * a + b * b)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  if (c < 12) return L > 92 ? 'white' : (L < 26 ? 'black' : 'gray')
  if (h >= 18 && h < 48 && L < 56) return 'brown'
  if (h < 15 || h >= 345) return 'red'
  if (h < 45) return 'orange'
  if (h < 70) return 'yellow'
  if (h < 165) return 'green'
  if (h < 200) return 'cyan'
  if (h < 255) return 'blue'
  if (h < 292) return 'purple'
  return 'pink'
}

const family = ref('all')
const query = ref('')

/* 切色卡系列时清掉筛选与搜索：上一套色板的色系在新系列里可能根本不存在 */
watch(() => options.brandId, () => {
  family.value = 'all'
  query.value = ''
})

const families = computed(() => {
  const set = new Set()
  for (const c of availableColors.value) set.add(familyOf(c))
  return [...set]
    .map(f => ({ key: f, label: FAMILY_LABEL[f] || f }))
    .sort((x, y) => x.label.localeCompare(y.label, 'zh-Hans-CN'))
})

const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  return availableColors.value.filter(c => {
    if (family.value !== 'all' && familyOf(c) !== family.value) return false
    if (!q) return true
    return `${c.code} ${c.name || ''}`.toLowerCase().includes(q)
  })
})

/** 当前颜色：优先取画笔选中的色号（可能来自别的色板），取不到再退回图纸色板 */
const current = computed(() => {
  const byBrush = brushColorId.value ? getColorById(brushColorId.value) : null
  if (byBrush) return byBrush
  return list.value.find(c => c.id === brushColorId.value) || list.value[0] || null
})

function pick(color) {
  brushColorId.value = color.id
}

function toggle() {
  emit('update:open', !props.open)
}

function onBrand(e) {
  options.brandId = e.target.value
}

const brandLabel = computed(() => {
  const b = PALETTE_BRANDS.find(x => x.id === options.brandId)
  return b ? b.name.replace(/\s*套装$/, '') : ''
})
</script>

<template>
  <div class="pc" :class="{ 'is-open': open || flyout, 'pc--flyout': flyout }" data-palette-card>
    <button
      v-if="!flyout"
      type="button" class="pc__head" :aria-expanded="open" aria-controls="palette-card-panel"
      data-palette-toggle
      @click="toggle"
    >
      <span class="pc__ico"><Icon name="palette" :size="16" /></span>
      <span class="pc__name">色板</span>
      <span class="pc__chev"><Icon name="chevron-down" :size="16" /></span>
    </button>

    <div v-show="open || flyout" id="palette-card-panel" class="pc__panel">
      <!-- ① 色卡系列 -->
      <label class="pc__field">
        <span class="pc__label">色卡系列</span>
        <select class="pc__select" :value="options.brandId" data-palette-brand @change="onBrand">
          <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">
            {{ b.name.replace(/\s*套装$/, '') }}
          </option>
        </select>
      </label>

      <!-- ② 色系筛选 -->
      <div class="pc__field">
        <span class="pc__label">色系</span>
        <div class="pc__chips" role="group" aria-label="按色系筛选">
          <button
            type="button" class="pc__chip" :class="{ on: family === 'all' }"
            :aria-pressed="family === 'all'" data-palette-family="all"
            @click="family = 'all'"
          >全部</button>
          <button
            v-for="f in families" :key="f.key" type="button" class="pc__chip"
            :class="{ on: family === f.key }" :aria-pressed="family === f.key"
            :data-palette-family="f.key"
            @click="family = f.key"
          >{{ f.label }}</button>
        </div>
      </div>

      <!-- ③ 搜索 -->
      <label class="pc__field">
        <span class="pc__label">搜索</span>
        <span class="pc__search">
          <Icon name="search" :size="14" />
          <input
            v-model="query" type="search" class="pc__input"
            placeholder="按色号或颜色名称搜索" aria-label="按色号或颜色名称搜索" data-palette-search
          >
        </span>
      </label>

      <!-- 颜色网格 -->
      <div class="pc__grid" data-palette-grid>
        <button
          v-for="c in list" :key="c.id" type="button" class="pc__cell"
          :class="{ on: c.id === brushColorId }" :aria-pressed="c.id === brushColorId"
          :title="`${c.code}${c.name ? ' · ' + c.name : ''}`" :data-palette-code="c.code"
          @click="pick(c)"
        >
          <i class="pc__chipColor" :style="{ background: c.hex }">
            <Icon v-if="c.id === brushColorId" name="check" :size="14" />
          </i>
          <span class="pc__code">{{ c.code }}</span>
        </button>
        <p v-if="!list.length" class="pc__empty">这个筛选下没有颜色</p>
      </div>

      <!-- 当前颜色 -->
      <p class="pc__current" data-palette-current>
        <span class="pc__label">当前颜色</span>
        <i class="pc__chipColor pc__chipColor--now" :style="{ background: current ? current.hex : '#fff' }"></i>
        <b class="ty-num">{{ current ? current.code : '—' }}</b>
        <span class="ty-caption">{{ current && current.name ? current.name : '还没有选色' }}</span>
      </p>
      <p class="pc__hint ty-caption">{{ brandLabel }} · 共 {{ list.length }} 色</p>
    </div>
  </div>
</template>

<style scoped>
/* 颜色与字号按 Figma「豆玩 · 文字与字体规范」1:2：
   卡头 13/700/20 · 字段标签 12/700/18 · 说明 12/400/18 · 色号 12/500 Inter */
.pc{display:flex;flex-direction:column;gap:4px}
.pc__head{
  display:flex;align-items:center;gap:10px;height:42px;padding:0 8px;
  border-radius:9px;font-size:13px;font-weight:700;line-height:var(--ty-label-lh);letter-spacing:0;
  color:var(--cs-ink);text-align:left;width:100%;
}
.pc__head:hover{background:var(--cs-fill)}
.pc__name{flex:1;text-align:left}
.pc__ico{
  width:28px;height:28px;flex:0 0 auto;border-radius:8px;display:grid;place-items:center;
  background:#FBE7F0;color:#B8557F;
}
/* 箭头与「我的库存」「作品分析」那颗右对齐（同宽 13×13） */
.pc__chev{
  flex:0 0 auto;width:13px;height:13px;color:#B4BCB6;
  display:inline-flex;transform:rotate(-90deg);transition:transform .16s ease;
}
.pc.is-open .pc__chev{transform:none}

.pc__panel{
  display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;
  background:#F7F9F5;color:#2A3C30;
}
.pc__field{display:flex;flex-direction:column;gap:5px}
.pc__label{
  font-family:var(--font-sans);font-size:12px;font-weight:700;line-height:var(--ty-caption-lh);letter-spacing:0;color:#959D97;
}
.pc__select{
  width:100%;height:32px;padding:0 8px;border-radius:9px;border:1px solid var(--cs-line);
  background:#fff;color:#2A3C30;font-family:var(--font-sans);font-size:13px;line-height:var(--ty-label-lh);
}
.pc__chips{display:flex;flex-wrap:wrap;gap:4px}
.pc__chip{
  padding:3px 8px;border-radius:999px;border:1px solid var(--cs-line);background:#fff;
  font-family:var(--font-sans);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;color:#52685A;
  cursor:pointer;
}
.pc__chip.on{background:var(--cs-accent);border-color:var(--cs-accent);color:#1A2D22;font-weight:700}
.pc__search{
  display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:9px;
  border:1px solid var(--cs-line);background:#fff;color:#959D97;
}
.pc__input{
  flex:1;min-width:0;border:0;background:transparent;outline:none;color:#2A3C30;
  font-family:var(--font-sans);font-size:13px;line-height:var(--ty-label-lh);
}

/* 多行网格：4 列，色块 + 色号，选中项青柠描边 + 对勾 */
.pc__grid{
  display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:220px;overflow-y:auto;
  scrollbar-width:thin;padding-right:2px;
}
.pc__cell{
  display:flex;flex-direction:column;align-items:center;gap:3px;padding:3px 1px;
  border:1px solid transparent;border-radius:8px;background:none;cursor:pointer;
}
.pc__cell:hover{background:#EFF3EA}
.pc__cell.on{border-color:var(--cs-accent);background:var(--cs-accent-soft)}
.pc__chipColor{
  width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:#fff;
  box-shadow:inset 0 0 0 1px rgba(26,45,34,.12);
}
.pc__chipColor--now{width:16px;height:16px;border-radius:5px;flex:0 0 auto}
.pc__code{
  font-family:var(--font-numeric);font-size:12px;font-weight:500;line-height:var(--ty-caption-lh);letter-spacing:0;
  color:#6C7A70;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.pc__empty{
  grid-column:1/-1;margin:6px 0 0;font-family:var(--font-sans);font-size:12px;line-height:var(--ty-caption-lh);color:#959D97;
}
.pc__current{
  display:flex;align-items:center;gap:6px;margin:0;padding:6px 8px;border-radius:9px;background:#fff;
}
.pc__current b{
  font-family:var(--font-numeric);font-size:13px;font-weight:600;line-height:var(--ty-label-lh);letter-spacing:0;color:#2A3C30;
}
.pc__current .ty-caption{color:#959D97}
.pc__hint{margin:0;font-family:var(--font-sans);font-size:12px;line-height:var(--ty-caption-lh);color:#959D97}
</style>
