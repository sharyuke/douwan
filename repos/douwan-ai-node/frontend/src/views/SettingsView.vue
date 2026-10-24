<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import BaseDialog from '../components/ui/BaseDialog.vue'
import {
  options, projects, deleteProject, cartoonStyles, maxCells,
  beadKey, bead, BEADS, BEAD_KEYS, SIZE_TIERS, boardSpecOf
} from '../composables/useStudio.js'
import { inventory, clearInventory } from '../composables/useInventory.js'
import {
  isCustomPrice, per1000For, setCustomPer1000, resetPer1000
} from '../composables/useBeadPrice.js'
import { priceProfile, SOURCES, FX, CHECKED_AT } from '../lib/beadPrice.js'
import { favorites } from '../composables/useAssets.js'
import { plan, credits, usage, cancelPlan } from '../composables/useMembership.js'
import { toastOk, toastWarn } from '../composables/useToast.js'
import { PALETTE_BRANDS, customColors, addCustomColors, removeCustomColor } from '../lib/palettes.js'
import { MAX_TARGET_COLORS } from '../lib/pattern.js'
import { downloadText } from '../lib/exporters.js'
import { num, fileSize } from '../lib/forge.js'

const confirmClear = ref('')
const customOpen = ref(false)
const code = ref('')
const name = ref('')
const hex = ref('#F4A15B')
const customList = ref(customColors())

/* 默认画布的可选档位：拼板规格 52 / 78 / 104 钉的整数倍，6 档（见 lib/boardSpec.js）。
   超过本套餐上限的档位不显示 —— 让按钮点了没反应、或者设进去再被悄悄裁掉，
   都属于「界面允许你做一件它其实做不到的事」。 */
const canvasPresets = computed(() => SIZE_TIERS.filter(t => t.n <= maxCells.value))

/** 本机数据体积，让「清理」这个动作有依据 */
const storageUsage = computed(() => {
  let bytes = 0
  try {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k)
      if (v) bytes += k.length + v.length
    }
  } catch {
    /* ignore */
  }
  return bytes
})

const breakpoints = [
  { name: '手机', width: 390 },
  { name: '平板', width: 834 },
  { name: '笔记本', width: 1280 },
  { name: '台式', width: 1600 }
]

/* ---------------------------------------------------------------- 材料单价

   单价和**豆径**绑定：2.6mm 小豆与 5mm 中号豆的塑料用量差约 7 倍，是两个价格体系。
   界面上的「当前豆径」取自工作台的 beadKey（自动时按画布尺寸判断），
   用户也可以在上面那块「豆径」里手动指定。 */

/** 当前豆径对应的定价口径（默认价 / 出处 / 品牌价表） */
const priceProf = computed(() => priceProfile(beadKey.value))
/** 当前画布两个方向各自的分板规格（52 / 78 / 104 钉板，或 29 = 老规格） */
const boardSpecX = computed(() => boardSpecOf(options.canvasW))
const boardSpecY = computed(() => boardSpecOf(options.canvasH))
const boardSpecText = computed(() => {
  const one = s => (s === 29 ? '29 格老规格' : `${s} 钉板`)
  return boardSpecX.value === boardSpecY.value ? one(boardSpecX.value) : `${one(boardSpecX.value)} + ${one(boardSpecY.value)}`
})
/** 当前生效的单价（元/千颗）：没手填过就跟着「默认色板 + 当前豆径」的品牌价走 */
const pricePer1000 = computed(() => per1000For(options.brandId, beadKey.value))
const priceIsCustom = computed(() => isCustomPrice(beadKey.value))

/**
 * 手填单价。这里用 :value + @change 而不是 v-model：
 * 非法输入被拒时状态**没有变化**，Vue 就不会重渲染，输入框里会留着那个错值，
 * 必须自己把值写回去（和 EditorSidebar 里那批下拉同一个坑）。
 */
function onPriceInput(e) {
  if (!setCustomPer1000(e.target.value, beadKey.value)) {
    toastWarn('单价请填 0.1–500 之间的数字（元 / 千颗）')
    e.target.value = String(pricePer1000.value)
    return
  }
  toastOk(`材料单价已改为 ¥${per1000For(options.brandId, beadKey.value).toFixed(2)}/千颗（${bead.value.label}）`)
}

function onPriceReset() {
  resetPer1000(beadKey.value)
  toastOk(`已回到 ${bead.value.label} 的默认参考价 ¥${per1000For(options.brandId, beadKey.value).toFixed(2)}/千颗`)
}

/** 当前豆径下，调研表里真正参与默认值推导的报价 */
const priceSources = computed(() => SOURCES.filter(s => s.size === priceProf.value.size))

/** 调研表里一条报价的价钱文案：有区间就写区间（不然 v-for 会渲染成 ¥undefined） */
function priceLabel(s) {
  if (Array.isArray(s.per1000Range)) return `¥${s.per1000Range[0]}–${s.per1000Range[1]}/千颗`
  return `¥${s.per1000}/千颗`
}

function onClear(key) {
  const map = {
    projects: () => {
      projects.value = []
      localStorage.removeItem('douzao-projects-v2')
    },
    inventory: () => {
      clearInventory()
    },
    favorites: () => {
      favorites.value = []
    },
    settings: () => {
      localStorage.removeItem('douzao-settings-v2')
      options.dither = 'off'
      options.cleanup = true
      options.enhance = false
      options.removeBg = false
      options.matteLevel = 'normal'
      options.numbering = true
      options.showGrid = true
      options.boardLines = true
      options.canvasW = 29
      options.canvasH = 29
      options.targetColors = 16
    },
    membership: () => {
      cancelPlan()
    }
  }
  const fn = map[key]
  if (fn) fn()
  confirmClear.value = ''
  toastOk('已清除')
}

function onExportAll() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: '豆玩 DOUWAN',
    projects: projects.value,
    inventory: inventory.value,
    favorites: favorites.value,
    membership: plan.value,
    credits: { balance: credits.value.balance },
    usage: usage.value,
    customColors: customColors()
  }
  downloadText(JSON.stringify(payload, null, 2), 'douzao-backup.json', 'application/json;charset=utf-8')
  toastOk('备份包已导出')
}

function addCustom() {
  const c = code.value.trim()
  const h = hex.value.trim()
  if (!c || !/^#[0-9a-fA-F]{6}$/.test(h)) {
    toastWarn('请填写色号与合法的 HEX 色值（如 #F4A15B）')
    return
  }
  const n = addCustomColors([{ code: c, name: name.value.trim() || c, hex: h }])
  customList.value = customColors()
  code.value = ''
  name.value = ''
  toastOk(`已添加自定义颜色（共 ${n} 色）`)
}

function removeCustom(c) {
  removeCustomColor(c)
  customList.value = customColors()
  toastOk('已删除')
}
</script>

<template>
  <div class="wrap main--pad">
    <div class="pagehead">
      <div>
        <h1>设置</h1>
        <p>默认参数、本机数据与隐私说明。这里的所有内容都只存在于你的浏览器里。</p>
      </div>
      <RouterLink to="/account" class="btn">我的账户 ›</RouterLink>
    </div>

    <!-- 默认生成参数 -->
    <section class="card">
      <div class="card__head"><h3>默认生成参数</h3><span class="muted">新任务会用这些设置</span></div>
      <div class="card__body stack">
        <div class="field">
          <label>默认画布 <span>{{ options.canvasW }} × {{ options.canvasH }} 格 · {{ bead.label }} · 成品约 {{ (options.canvasW * bead.cm).toFixed(1) }} × {{ (options.canvasH * bead.cm).toFixed(1) }} cm</span></label>
          <div class="row row--wrap">
            <button
              v-for="t in canvasPresets" :key="t.n"
              class="btn" :class="{ yellow: options.canvasW === t.n && options.canvasH === t.n }"
              :title="t.note"
              @click="options.canvasW = t.n; options.canvasH = t.n"
            >{{ t.n }} × {{ t.n }}</button>
          </div>
          <p class="hint">
            拼板只有 52 / 78 / 104 钉三个规格（一条边上的钉位数，一钉 = 一格），所以可选尺寸都是它们的整数倍：
            52（1 块 52 板）、78（1 块 78 板）、104（1 块 104 板）、156（2×2 块 78 板）、208（2×2 块 104 板）、312（3×3 块 104 板）。
            这里设的是**正方形**默认值；工作台里上传照片时会按原图比例自动改（竖图就是 78 × 104 这种，两个方向都是整板，不留白边）。
            更大的画布在工作台的「② 画布大小 → 自定义尺寸」里按「规格 × 横向几块 × 纵向几块」加。
          </p>
        </div>

        <div class="field">
          <label>豆径 <span>{{ options.beadKey ? `手动指定 · ${bead.label}` : `自动 · ${bead.label}` }}</span></label>
          <div class="row row--wrap" style="gap:8px">
            <button
              class="btn" :class="{ yellow: !options.beadKey }"
              title="按分板规格自动判断：29 格老规格（29 / 58 / 116…）配 5mm 中号豆，52 / 78 / 104 钉板配 2.6mm 小豆"
              @click="options.beadKey = ''"
            >自动</button>
            <button
              v-for="k in BEAD_KEYS" :key="k"
              class="btn" :class="{ yellow: options.beadKey === k }"
              @click="options.beadKey = k"
            >{{ BEADS[k].label }}</button>
          </div>
          <p class="hint">
            豆径决定成品厘米、材料克重和 1:1 打印的格子宽度：<b>2.6mm 小豆</b> 1 格 = 2.6 mm（52 格 ≈ 13.5 cm、104 格 ≈ 27 cm），
            <b>5mm 中号豆</b> 1 格 = 5 mm（29 格 ≈ 14.5 cm）。自动档按**分板规格**判断：我们的拼板（52 / 78 / 104 钉）配 2.6mm 小豆，
            所以这些尺寸默认走小豆；29 / 58 / 116 / 464 这些 29 的整数倍是老存档的老规格，默认仍按 5mm 中号豆算 —— 老作品打开后厘米数与以前一致。
            当前画布 {{ options.canvasW }} × {{ options.canvasH }} 格，分板规格 {{ boardSpecText }}，生效豆径 {{ bead.label }}。
          </p>
        </div>

        <div class="field">
          <label>默认颜色数 <span>{{ options.targetColors }} 色</span></label>
          <div class="rangeRow">
            <input v-model.number="options.targetColors" type="range" min="4" :max="MAX_TARGET_COLORS">
            <div class="valueBox">{{ options.targetColors }}</div>
          </div>
          <p class="hint">上限 {{ MAX_TARGET_COLORS }} 色（= 漫德全色板长度）。实测 48~64 色是"像不像"的拐点，再往上色差只降 0.6%，孤立豆却多 12% —— 所以默认值仍按画布大小建议，这里手动拖到底适合"先把图转准"的场合。</p>
        </div>

        <div class="field">
          <label>默认色板</label>
          <select v-model="options.brandId">
            <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">{{ b.name }} · {{ b.colorCount }} 色</option>
          </select>
        </div>

        <!-- 材料单价：钱是按什么价算的必须能看见、能改。
             默认值是实际抓到的公开报价（见 lib/beadPrice.js 的 SOURCES），
             不是先写个「参考价」再让用户自己发现不对。 -->
        <div class="field">
          <label>材料单价 <span>{{ priceIsCustom ? '你填的进货价' : '默认参考价' }} · {{ bead.label }}</span></label>
          <div class="row row--wrap" style="gap:10px;align-items:center">
            <input
              class="priceInput" type="number" inputmode="decimal" step="0.01" min="0.1" max="500"
              aria-label="材料单价（元每千颗）"
              :value="pricePer1000" @change="onPriceInput"
            >
            <span class="muted">元 / 千颗</span>
            <button class="btn sm" :disabled="!priceIsCustom" @click="onPriceReset">用默认参考价</button>
          </div>
          <p class="hint">
            材料成本 =「需补购的颗数 × 单价」，工作台、材料页、导出的 CSV 与分板 PDF 都用这一个数。
            <b>单价按豆径分开存</b>：两套豆都买时，小豆与中号豆各用自己的进货价，不会互相顶。
            当前豆径「{{ bead.label }}」的默认 {{ priceProf.default }} 元/千颗是「{{ priceProf.from }}」（{{ CHECKED_AT }} 核对）；
            进口 Perler 24.7 / Hama 26.8 是 5mm 1000 颗装，只作用于 5mm 那套价。
            ⚠️ 别拿 5mm 的 10 元/千颗去算小豆，塑料用量差约 7 倍 —— 填自己的进货价最准。
          </p>
          <details class="priceSrc">
            <summary>这 {{ SOURCES.length }} 条报价的豆径、原文与出处（当前豆径 {{ priceProf.size }} 参与默认值推导）</summary>
            <ul>
              <li v-for="s in SOURCES" :key="s.brand + s.url" :class="{ dim: s.size !== priceProf.size }">
                <b>{{ priceLabel(s) }}</b> · {{ s.size }} · {{ s.brand }} · {{ s.spec }}
                <span class="hint">「{{ s.quote }}」</span>
                <span class="hint">{{ s.note }}</span>
                <a :href="s.url" target="_blank" rel="noopener noreferrer">看原文</a>
              </li>
            </ul>
            <p class="hint">
              汇率 USD→CNY {{ FX.USD_CNY }}、DKK→CNY {{ FX.DKK_CNY }}（{{ FX.date }}，{{ FX.source }}）。
              价格随行情变，这里是查询当时的价；用你自己的进货价最准。
            </p>
          </details>
        </div>

        <div class="field">
          <label>默认显示</label>
          <div class="checkrow">
            <label class="check"><input v-model="options.numbering" type="checkbox"> 格内印色号</label>
            <label class="check"><input v-model="options.showGrid" type="checkbox"> 显示网格线</label>
            <label class="check"><input v-model="options.boardLines" type="checkbox"> 显示底板边界</label>
            <label class="check"><input v-model="options.cleanup" type="checkbox"> 默认去孤立豆</label>
            <label class="check"><input v-model="options.enhance" type="checkbox"> 默认色彩增强</label>
            <label class="check"><input v-model="options.removeBg" type="checkbox"> 默认抠图去背景（背景与投影一起去掉，只留主体）</label>
          </div>
        </div>

        <div class="field">
          <label>默认卡通化 <span>照片先转成卡通形象再出图</span></label>
          <div class="row row--wrap" style="gap:12px;align-items:center">
            <label class="check"><input v-model="options.cartoon" type="checkbox"> 默认开启卡通化</label>
            <select v-model="options.cartoonStyle" :disabled="!options.cartoon" style="max-width:260px">
              <option v-for="s in cartoonStyles" :key="s.key" :value="s.key">{{ s.label }} · {{ s.hint }}</option>
            </select>
          </div>
          <p class="hint" style="margin-top:6px">
            卡通化只做「平涂色块 + 轮廓线 + 关键特征回贴」，颜色全部来自原图自身（不会凭空生成原图没有的东西）。
          </p>
        </div>

        <p class="hint">修改后立即生效，并记录在本机。</p>
      </div>
    </section>

    <!-- 自定义色板 -->
    <section class="card" style="margin-top:18px">
      <div class="card__head">
        <h3>自定义色板</h3>
        <button class="btn sm" @click="customOpen = true">添加颜色</button>
      </div>
      <div class="card__body">
        <p class="hint" style="margin-bottom:12px">
          手里有散装豆或混色豆，色卡上找不到？自己录入色号与颜色，就能参与配色与材料统计。
        </p>
        <div v-if="customList.length" class="customGrid">
          <div v-for="c in customList" :key="c.code" class="customItem">
            <i :style="{ background: c.hex }"></i>
            <div>
              <b>{{ c.code }}</b>
              <span class="hint">{{ c.name }} · {{ c.hex }}</span>
            </div>
            <button class="btn sm ghost" @click="removeCustom(c.code)">删除</button>
          </div>
        </div>
        <p v-else class="muted">还没有自定义颜色。</p>
      </div>
    </section>

    <!-- 本机数据 -->
    <section class="card" style="margin-top:18px">
      <div class="card__head"><h3>本机数据</h3><span class="muted">约 {{ fileSize(storageUsage) }}</span></div>
      <div class="card__body">
        <div class="dataRow">
          <div>
            <b>作品存档</b>
            <span class="hint">{{ projects.length }} 件 · 含拼制进度</span>
          </div>
          <button class="btn sm danger" @click="confirmClear = 'projects'">清除</button>
        </div>
        <div class="dataRow">
          <div>
            <b>库存记录</b>
            <span class="hint">已记录 {{ Object.keys(inventory).length }} 个色号</span>
          </div>
          <button class="btn sm danger" @click="confirmClear = 'inventory'">清除</button>
        </div>
        <div class="dataRow">
          <div>
            <b>素材收藏</b>
            <span class="hint">{{ favorites.length }} 个</span>
          </div>
          <button class="btn sm danger" @click="confirmClear = 'favorites'">清除</button>
        </div>
        <div class="dataRow">
          <div>
            <b>生成参数</b>
            <span class="hint">画布、颜色数、色板、显示选项</span>
          </div>
          <button class="btn sm danger" @click="confirmClear = 'settings'">恢复默认</button>
        </div>
        <div class="dataRow">
          <div>
            <b>会员与 Credits</b>
            <span class="hint">当前状态会退回免费版</span>
          </div>
          <button class="btn sm danger" @click="confirmClear = 'membership'">重置</button>
        </div>
        <div class="divider"></div>
        <div class="row row--between row--wrap">
          <div>
            <b style="font-size:var(--fs-xs)">导出备份</b>
            <p class="hint">把所有作品、库存、收藏与设置打包成一个 JSON 文件</p>
          </div>
          <button class="btn green" @click="onExportAll">导出备份包</button>
        </div>
      </div>
    </section>

    <!-- 隐私 -->
    <section class="card" style="margin-top:18px">
      <div class="card__head"><h3>图片隐私</h3><span class="muted">技术说明</span></div>
      <div class="card__body stack stack--sm">
        <div class="privacyItem">
          <b>✓ 本地完成的部分（默认路径）</b>
          <p>图片解码、EXIF 方向修正、多级缩放采样、色彩量化、抖动、去孤立豆、图纸渲染、导出文件生成 —— 全部在你的浏览器里用 Canvas 完成，图片不会被上传。自动抠图与卡通化滤镜也属于这一类：它们是浏览器内的确定性算法，不联网。</p>
        </div>
        <div class="privacyItem">
          <b>⬆ 会离开设备的部分（AI 增强，需你主动点击）</b>
          <p>只有你主动点击「AI 生成」类按钮时，图片才会被上传：AI 抠图（模型级边缘细化）、AI 卡通化（模型重绘）、文字生图。上传后由豆玩自建的推理节点处理，不经过任何第三方模型服务；结果会存回豆玩的文件存储，用于你在「我的 AI 任务」里查看与重新下载。除此之外的拼豆功能一律不产生上传。</p>
        </div>
        <div class="privacyItem">
          <b>用作文案声明</b>
          <p>我们不会用你的上传图片训练模型。AI 推理完全在自建节点上完成，你的图片不会被送去做训练，也不会提供给第三方。输入图在 24 小时后会被自动清理（推理结果按你的作品管理，可自行删除）。这条说明与实际技术实现一致，我们会持续保持同步。</p>
        </div>
        <div class="privacyItem">
          <b>版权</b>
          <p>上传图片时你需要确认自己拥有或已获得使用该图片的权利。素材中心第一阶段的图案全部由平台自制，不使用未经授权的动漫 / 游戏 / IP 形象。发现侵权内容可通过举报入口提交，我们会在核实后下架并保留处理日志。</p>
        </div>
      </div>
    </section>

    <!-- 响应式自检 -->
    <section class="card" style="margin-top:18px">
      <div class="card__head"><h3>适配自检</h3><span class="muted">目标设备：PC / iPad / 手机</span></div>
      <div class="card__body">
        <p class="hint" style="margin-bottom:10px">
          当前窗口宽度 <b>{{ typeof window !== 'undefined' ? window.innerWidth : '—' }} px</b>。
          想验证布局，可以把浏览器窗口拖到下面这些宽度附近看看是否错位：
        </p>
        <div class="row row--wrap">
          <span v-for="b in breakpoints" :key="b.name" class="tag">{{ b.name }} · {{ b.width }}px</span>
        </div>
      </div>
    </section>

    <BaseDialog :model-value="!!confirmClear" title="确认清除" size="sm" @update:model-value="confirmClear = ''">
      <p style="font-size:var(--fs-sm);line-height:1.8">这个操作不可撤销。清除后对应数据会从本机浏览器删除。</p>
      <template #footer="{ close }">
        <button class="btn" @click="close">取消</button>
        <button class="btn danger" @click="onClear(confirmClear)">确认清除</button>
      </template>
    </BaseDialog>

    <BaseDialog v-model="customOpen" title="添加自定义颜色" size="sm">
      <div class="stack stack--sm">
        <div class="field">
          <label>色号 <span>你包装上写的编号</span></label>
          <input v-model="code" type="text" placeholder="例如 X12">
        </div>
        <div class="field">
          <label>颜色名 <span>可留空</span></label>
          <input v-model="name" type="text" placeholder="例如 奶油橘">
        </div>
        <div class="field">
          <label>颜色 <span>直接选色或填 HEX</span></label>
          <div class="row">
            <input v-model="hex" type="text" placeholder="#F4A15B">
            <input v-model="hex" type="color" style="width:56px;min-height:44px;padding:3px">
          </div>
        </div>
      </div>
      <template #footer="{ close }">
        <button class="btn" @click="close">取消</button>
        <button class="btn primary" @click="addCustom">添加</button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.customGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.customItem{
  display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:10px;align-items:center;
  padding:10px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);
}
.customItem i{width:30px;height:30px;border-radius:var(--r-xs);border:1px solid rgba(35,49,34,.12);display:block}
.customItem b{font-size:var(--fs-xs);display:block}
.dataRow{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 0;border-bottom:1px solid var(--line);
}
.dataRow:last-of-type{border-bottom:0}
.dataRow b{font-size:var(--fs-xs);display:block;margin-bottom:3px}
.privacyItem{padding:13px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line)}
.privacyItem b{font-size:var(--fs-xs)}
/* 单价输入：手机上也要点得到（一行三个控件会挤，所以给固定宽度而不是 flex:1） */
.priceInput{
  width:110px;padding:9px 11px;border:1px solid var(--line-strong);border-radius:var(--r-sm);
  background:var(--surface);font:inherit;font-size:var(--fs-sm);font-weight:800;color:var(--ink);
  font-variant-numeric:tabular-nums;
}
.priceSrc{margin-top:8px;font-size:var(--fs-2xs);color:var(--muted)}
.priceSrc summary{cursor:pointer;font-weight:800;color:var(--ink-2)}
.priceSrc ul{margin:8px 0 0;padding-left:16px;display:grid;gap:7px}
.priceSrc li{line-height:1.7}
/* 不是当前豆径的报价压暗：默认值只从当前豆径那几条推导，别的只是对照 */
.priceSrc li.dim{opacity:.55}
.priceSrc li b{color:var(--ink)}
.priceSrc li .hint{display:block}
.priceSrc a{color:var(--coral-deep);font-weight:800}
.privacyItem p{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8;margin-top:6px}
</style>
