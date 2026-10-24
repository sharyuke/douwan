<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  pattern, hasPattern, stats, materials, variants,
  projectName,
  regenerate, sourceUrl, bead
} from '../../composables/useStudio.js'
import { inventory, shortageOf, inventorySummary, useInventory, inventoryMode } from '../../composables/useInventory.js'
import { buildStars, buildabilityLabel, similarityLabel, signedPct, formatDuration } from '../../lib/forge.js'
import { check } from '../../composables/useMembership.js'
import { toastOk, toastWarn } from '../../composables/useToast.js'
import { copyShoppingList } from '../../lib/exporters.js'
import PixelIcon from '../ui/PixelIcon.vue'

const props = defineProps({
  /* 手机端弹层：只显示 focus 指定的那张卡（'' = 桌面完整右栏）。
     analysis / colors / stock 三个值，对应命令栏里的三个按钮。 */
  focus: { type: String, default: '' }
})

const emit = defineEmits(['need-pro'])
const showAllMaterials = ref(false)

/* 除 ① 创建外，卡片都默认收起；卡头右侧的箭头共用全局 .cardArrow */
const openAnalysis = ref(props.focus === 'analysis')
const openStock = ref(props.focus === 'stock')
/* 星级用 SVG 画（实心星 + 低透明度空星），不再依赖 ★☆ 字符 */
const starCount = computed(() => (stats.value ? buildStars(stats.value.buildability).filled : 0))

/** 当前图纸用的是哪种分板规格（52 / 78 / 104 / 120 钉画线板，整张图纸一种规格） */
const boardSpecsText = computed(() => {
  const p = pattern.value
  if (!p) return ''
  const bs = p.boardSize || null
  const x = bs ? bs.x : null
  const y = bs ? bs.y : null
  if (x && y && x !== y) return `${x} / ${y} 钉板（老数据）`
  const s = x || y
  return s === 29 ? '老规格方板（约 14.5 cm）' : `${s} 钉板`
})

/* 「🎨 颜色用量」默认收起：它的材料清单是这一页里最长的一段
   （最多 22 行 + 汇总 + 两个按钮），一展开整页就被顶得很长。
   卡头已经把「几色 / 缺几色」摆出来了，需要明细再展开。 */
const openColors = ref(props.focus === 'colors')

const short = computed(() => (hasPattern.value ? shortageOf(pattern.value) : null))

/* 默认列 22 行（.materialList 约 560px 高），超出的再点「展开全部」——
   右栏原来只显示 14 行、下面是空的，和左栏一长串对不上 */
const MATERIAL_PREVIEW = 22

const visibleMaterials = computed(() => {
  const rows = materials.value ? materials.value.rows : []
  return showAllMaterials.value ? rows : rows.slice(0, MATERIAL_PREVIEW)
})

const variantCards = computed(() =>
  variants.value.map(v => {
    const s = v.stats || {}
    const buildScore = Math.round((s.buildability || 0) * 100)
    return {
      key: v.key,
      label: v.label,
      tagline: v.tagline,
      desc: v.desc,
      stats: s,
      recommended: v.recommended,
      compare: v.compare,
      stars: buildStars(buildScore),
      buildLabel: buildabilityLabel(buildScore),
      simLabel: similarityLabel(s.similarity)
    }
  })
)

const best = computed(() => variantCards.value.find(v => v.key === 'high') || null)
const recommended = computed(() => variantCards.value.find(v => v.recommended) || variantCards.value[0] || null)

/** 「为什么推荐」解释（PRD §52） */
const whyText = computed(() => {
  const r = recommended.value
  if (!r) return ''
  const b = best.value
  if (!b || b.key === r.key) {
    return '这是当前唯一候选。基础图片转换一直免费，不做收费墙。'
  }
  const c = r.compare || {}
  const parts = []
  if (c.colorDelta) parts.push(`颜色 ${signedPct(c.colorDelta)}`)
  if (c.isolatedDelta) parts.push(`孤立豆 ${signedPct(c.isolatedDelta)}`)
  if (c.beadDelta) parts.push(`豆子数量 ${signedPct(c.beadDelta)}`)
  const sim = Number(c.similarityDelta || 0)
  // 百分比取整后常常是 0，「变化 0%」读起来像废话，改成直白的说法
  const simText = Math.abs(sim) < 0.5
    ? '还原度与它基本持平'
    : `还原度比它${sim > 0 ? '高' : '低'} ${Math.abs(sim)} 个百分点`
  const head = parts.length ? `相比高还原版：${parts.join('、')}；` : '相比高还原版，'
  return `${head}${simText}。${r.buildLabel}，所以更推荐「${r.label}」。`
})

const inventoryGate = computed(() => check('inventory.use'))

/* 库存约束：勾选「只用我的豆」会改变配色结果，所以每次改动都要重新生成。 */
function onInventoryToggle() {
  if (!inventoryGate.value.ok) {
    toastWarn(inventoryGate.value.reason)
    emit('need-pro', inventoryGate.value.reason)
    return
  }
  useInventory.value = !useInventory.value
  if (sourceUrl.value) regenerate()
}

function onInventoryMode(mode) {
  inventoryMode.value = mode
  if (sourceUrl.value && useInventory.value) regenerate()
}

async function onCopy() {
  if (!hasPattern.value) return
  const res = await copyShoppingList(pattern.value, inventory.value, projectName.value)
  if (res.ok) toastOk('采购清单已复制')
  else toastWarn('复制失败，请改用 CSV 导出')
}

</script>

<template>
  <aside class="col col--right" :class="{ 'is-focus-mode': !!focus }">
    <!-- 作品分析：四个统计格 + 可拼性评分 + 方案说明。手机上紧跟在图纸与设置之后 -->
    <section class="card card--analysis" :class="{ 'is-folded': !openAnalysis, 'is-focus': focus === 'analysis' }">
      <div class="card__head">
        <h3><span class="cardIcon"><PixelIcon name="fn-analytics" :size="18" /></span>作品分析</h3>
        <span class="muted card__headValue">{{ stats ? stats.modeLabel : '未生成' }}</span>
        <button
          class="cardArrowBtn" type="button"
          :aria-expanded="openAnalysis" aria-label="展开或收起作品分析"
          @click="openAnalysis = !openAnalysis"
        ><i class="cardArrow" :class="{ 'cardArrow--open': openAnalysis }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i></button>
      </div>
      <div class="card__body stack stack--sm">
        <div v-if="!stats" class="processHint" style="margin-top:0">
          上传图片或选择素材后开始分析。所有数值都来自当前图案的实际统计。
        </div>

        <template v-else>
          <div class="stats">
            <div class="stat tone-1"><b>{{ stats.width }}×{{ stats.height }}</b><span>画布</span></div>
            <div class="stat tone-2"><b>{{ stats.total.toLocaleString() }}</b><span>总豆数</span></div>
            <div class="stat tone-3"><b>{{ stats.colors }}</b><span>颜色</span></div>
            <div class="stat tone-4"><b>{{ stats.similarityPct }}%</b><span>还原度</span></div>
          </div>

          <div v-if="stats.emptyCount" class="boardInfo">
            已去背景：<b>{{ stats.emptyCount.toLocaleString() }}</b> 格不放豆（占成品区域 {{ stats.emptyPct }}%），
            这些位置不需要豆子，材料用量已扣除。
          </div>

          <div class="scoreBox">
            <div class="row row--between">
              <b>可拼性评分</b>
              <div class="row" style="gap:8px">
                <span class="stars" :title="`${stats.buildability} 分`">
                  <PixelIcon
                    v-for="i in 5" :key="i" name="star" :size="12"
                    :class="{ 'is-empty': i > starCount }"
                  />
                </span>
                <b class="buildScore">{{ stats.buildability }}</b>
              </div>
            </div>
            <div class="meter" style="margin:9px 0 7px"><i :style="{ width: stats.buildability + '%' }"></i></div>
            <p class="hint">{{ buildabilityLabel(stats.buildability) }} · 孤立豆 {{ stats.isolatedCount }} 颗 · 预计 {{ formatDuration(stats.minutes) }}</p>
          </div>

          <div class="boardInfo">
            {{ stats.boardText }} · 成品 {{ stats.cm }}<br>
            单块拼板 {{ boardSpecsText }} · {{ stats.beadLabel }}（1 格 = {{ bead.mm }} mm）· 预计重量 {{ stats.weight }}
          </div>

          <p v-if="whyText" class="whyBox">
            <b>为什么推荐这个方案？</b><br>{{ whyText }}
          </p>

          <div v-if="stats.notes && stats.notes.length" class="processHint">
            本次生成：{{ stats.notes.join('；') }}
          </div>
        </template>
      </div>
    </section>

    <!-- 方案切换已经收进左栏「③ 生成方案」的 2×2 方案格里，
         这里原来那份「一次看懂 N 种方案」是同一批方案的第二个副本，已删除。 -->

    <!-- 🎨 颜色用量（参考版信息层级：标题 + 右「生成后显示」）。手机上默认收起 -->
    <section v-if="hasPattern" class="card card--colors" :class="{ 'is-folded': !openColors, 'is-focus': focus === 'colors' }">
      <div class="card__head">
        <h3><span class="cardIcon"><PixelIcon name="palette" :size="14" /></span>颜色用量</h3>
        <span v-if="short" class="muted only-lg card__headValue">{{ short.colorCount }} 色</span>
        <span v-if="short" class="muted only-sm card__headValue">
          <template v-if="short.needRestock">{{ short.colorCount }} 色 · 缺 {{ short.missingCount + short.shortCount }} 色</template>
          <template v-else>{{ short.colorCount }} 色 · 库存够</template>
        </span>
        <button
          class="cardArrowBtn" type="button"
          :aria-expanded="openColors" aria-label="展开或收起颜色用量"
          @click="openColors = !openColors"
        ><i class="cardArrow" :class="{ 'cardArrow--open': openColors }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i></button>
      </div>
      <div class="card__body stack stack--sm">
        <div v-if="short && short.needRestock" class="alertBox">
          <PixelIcon name="alert" :size="13" />
          <span>
            缺 {{ short.missingCount }} 色完全没货，{{ short.shortCount }} 色数量不足 ·
            共需补 {{ short.totalLack.toLocaleString() }} 颗
          </span>
        </div>
        <div v-else-if="short" class="okBox">
          <PixelIcon name="check" :size="13" /><span>当前库存足够完成这件作品</span>
        </div>

        <div class="materialList">
          <div v-for="m in visibleMaterials" :key="m.id" class="mat">
            <i :style="{ background: m.hex }"></i>
            <span class="name" :title="m.label">{{ m.label }}</span>
            <b>{{ m.count }} 颗</b>
            <span v-if="m.lack > 0" class="lack">缺 {{ m.lack }} 颗</span>
            <span v-else class="okqty">够</span>
          </div>
          <div v-if="!visibleMaterials.length" class="muted" style="padding:14px">生成后显示颜色与数量。</div>
        </div>

        <button
          v-if="materials && materials.rows.length > MATERIAL_PREVIEW"
          class="btn soft sm block"
          @click="showAllMaterials = !showAllMaterials"
        >{{ showAllMaterials ? '收起' : `展开全部 ${materials.rows.length} 色` }}</button>

        <div class="costBox">
          <div class="costLine"><span>总豆数</span><b>{{ materials ? materials.totalBeads.toLocaleString() : 0 }} 颗</b></div>
          <div class="costLine"><span>需补购</span><b>{{ materials ? materials.totalLack.toLocaleString() : 0 }} 颗</b></div>
        </div>

        <div class="grid-2">
          <button class="btn btn-secondary sm" @click="onCopy">复制采购清单</button>
          <RouterLink to="/materials" class="btn btn-secondary sm">完整材料表</RouterLink>
        </div>
      </div>
    </section>

    <!-- 📦 我的库存：从左侧栏移到这里（与「⑤ 图纸交付」交换位置）。
         手机上默认收起，卡头已经把当前库存摘要摆出来了。 -->
    <section class="card card--stock" :class="{ 'is-folded': !openStock, 'is-focus': focus === 'stock' }">
      <div class="card__head">
        <h3><span class="cardIcon"><PixelIcon name="fn-inventory" :size="18" /></span>我的库存</h3>
        <span class="muted only-lg card__headValue" :class="{ 'tag pro': !inventoryGate.ok }">{{ inventoryGate.ok ? '参与生成' : 'PRO' }}</span>
        <span class="muted only-sm card__headValue">{{ inventorySummary.label }}</span>
        <button
          class="cardArrowBtn" type="button"
          :aria-expanded="openStock" aria-label="展开或收起我的库存"
          @click="openStock = !openStock"
        ><i class="cardArrow" :class="{ 'cardArrow--open': openStock }" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i></button>
      </div>
      <div class="card__body stack stack--sm">
        <div class="row row--between">
          <div>
            <b style="font-size:var(--fs-xs)">{{ inventorySummary.label }}</b>
          </div>
          <RouterLink to="/inventory" class="btn btn-secondary sm">设置</RouterLink>
        </div>

        <label class="check">
          <input type="checkbox" :checked="useInventory" @change="onInventoryToggle">
          只用我的豆
        </label>

        <div v-if="useInventory" class="grid-3 keep">
          <button class="pick" :class="{ on: inventoryMode === 'strict' }" @click="onInventoryMode('strict')">
            <strong>不补购</strong><span>只用现有</span>
          </button>
          <button class="pick" :class="{ on: inventoryMode === 'mincost' }" @click="onInventoryMode('mincost')">
            <strong>补购最少</strong><span>缺得最少</span>
          </button>
          <button class="pick" :class="{ on: inventoryMode === 'best' }" @click="onInventoryMode('best')">
            <strong>最高还原</strong><span>忽略库存</span>
          </button>
        </div>
        <p v-if="!inventorySummary.colors" class="processHint" style="margin-top:0">
          设置后，生成时会优先使用你手里的颜色。
        </p>
      </div>
    </section>
  </aside>
</template>

<style scoped>
/* 手机端弹层（focus 模式）：只留一张卡，卡头由弹层标题代替 */
.is-focus-mode > .card{display:none}
.is-focus-mode > .card.is-focus{display:block}
.is-focus-mode > .card.is-focus > .card__head{display:none}

.boardInfo{padding:10px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-2xs);color:var(--muted);line-height:1.7}
.scoreBox{padding:13px;border-radius:var(--r-md);background:linear-gradient(150deg,#FFF9F1,#FFFCF7);border:1px solid var(--line)}
.scoreBox b{font-size:var(--fs-xs)}
.stars{display:inline-flex;align-items:center;gap:2px;color:var(--primary-deep)}
.stars .pixelIcon.is-empty{opacity:.22}
.buildScore{font-size:17px !important;letter-spacing:-.02em}
.whyBox{padding:11px;border-radius:var(--r-sm);background:var(--surface-warm);border:1px solid var(--line);font-size:var(--fs-2xs);line-height:1.7;color:var(--ink-2)}
.alertBox{
  display:flex;align-items:flex-start;gap:6px;padding:10px;border-radius:var(--r-sm);
  background:var(--danger-soft);color:var(--danger);font-size:var(--fs-2xs);line-height:1.6;font-weight:650;
}
.okBox{
  display:flex;align-items:center;gap:6px;padding:10px;border-radius:var(--r-sm);
  background:var(--green-soft);color:var(--green-deep);font-size:var(--fs-2xs);font-weight:700;
}
.costBox{padding:10px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line)}
.costLine{display:flex;justify-content:space-between;font-size:var(--fs-2xs);color:var(--muted);padding:3px 0}
.costLine b{color:var(--ink);font-variant-numeric:tabular-nums}
</style>
