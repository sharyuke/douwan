<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import BaseDialog from '../components/ui/BaseDialog.vue'
import {
  options, projects, deleteProject, cartoonStyles, maxCells,
  bead, BEADS, BEAD_KEYS, SIZE_TIERS, BOARD_MIN, boardSpecFor
} from '../composables/useStudio.js'
import { BOARD_SPEC_LIST_TEXT, beadLabel } from '../lib/boardSpec.js'
import { inventory, clearInventory } from '../composables/useInventory.js'
import { favorites } from '../composables/useAssets.js'
import { ALL_FREE, plan, credits, usage, clearLocalMembershipCache } from '../composables/useMembership.js'
import { isLoggedIn } from '../composables/useUserAccount.js'
import { syncServerEntitlements } from '../composables/useBackend.js'
import { toastOk, toastWarn } from '../composables/useToast.js'
import { PALETTE_BRANDS, customColors, addCustomColors, removeCustomColor } from '../lib/palettes.js'
import { MAX_TARGET_COLORS } from '../lib/pattern.js'
import { downloadText } from '../lib/exporters.js'
import { num, fileSize } from '../lib/forge.js'
import { AI_PENDING_TEXT } from '../lib/aiPending.js'

const confirmClear = ref('')
const customOpen = ref(false)
const code = ref('')
const name = ref('')
const hex = ref('#F4A15B')
const customList = ref(customColors())

/* 默认画布的可选档位：拼板是 52 / 78 / 104 / 120 钉画线板（一钉 = 一格），6 档（见 lib/boardSpec.js）。
   超过本套餐上限的档位不显示 —— 让按钮点了没反应、或者设进去再被悄悄裁掉，
   都属于「界面允许你做一件它其实做不到的事」。 */
const canvasPresets = computed(() => SIZE_TIERS.filter(t => t.n <= maxCells.value))

/** 默认画布 = 网格与「画布规格」（容量）一起设：工作台里滑块的上限读的是容量 */
function pickDefaultCanvas(n) {
  options.canvasMaxW = n
  options.canvasMaxH = n
  options.canvasW = n
  options.canvasH = n
}

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

/* 分板规格：整张画布只用一种板（52/78/104 混着摆铺不满，见 lib/boardSpec.js 的说明） */
const boardSpecText = computed(() => {
  const s = boardSpecFor(options.canvasW, options.canvasH)
  return s === 29 ? '老规格方板' : `${s} 钉板`
})

async function onClear(key) {
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
      /* 默认画布 = 一块 52 钉画线板（与 useStudio 的 DEFAULT_CANVAS 同一个口径） */
      options.canvasW = BOARD_MIN
      options.canvasH = BOARD_MIN
      options.canvasMaxW = BOARD_MIN
      options.canvasMaxH = BOARD_MIN
      options.targetColors = 16
    },
    membership: () => {
      // 只清本机展示缓存；服务端已兑换的权益会在下次进入页面时重新同步
      clearLocalMembershipCache()
    }
  }
  const fn = map[key]
  if (fn) fn()
  confirmClear.value = ''
  /* 清本机会员缓存后，如果还登录着，立刻从服务端把已兑换的权益同步回来 */
  if (key === 'membership' && isLoggedIn.value) {
    await syncServerEntitlements()
    toastOk('已清除本机缓存，服务端权益已重新同步')
    return
  }
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
      <RouterLink to="/account" class="btn btn-secondary">我的账户 ›</RouterLink>
    </div>

    <!-- 默认生成参数 -->
    <section class="card">
      <div class="card__head"><h3>默认生成参数</h3><span class="muted">新任务会用这些设置</span></div>
      <div class="card__body stack">
        <div class="field">
          <label>默认画布 <span>{{ options.canvasW }} × {{ options.canvasH }} 格 · {{ beadLabel(bead.key, { withDefault: true }) }} · 成品约 {{ (options.canvasW * bead.cm).toFixed(1) }} × {{ (options.canvasH * bead.cm).toFixed(1) }} cm</span></label>
          <div class="row row--wrap">
            <button
              v-for="t in canvasPresets" :key="t.n"
              class="btn btn-secondary" :class="{ yellow: options.canvasW === t.n && options.canvasH === t.n }"
              :title="t.note"
              @click="pickDefaultCanvas(t.n)"
            >{{ t.n }} × {{ t.n }}</button>
          </div>
          <p class="hint">
            拼板是 {{ BOARD_SPEC_LIST_TEXT }} 钉画线板（一条边上的钉位数，一钉 = 一格，实测外框 14 / 21 / 28 / 34 cm），整张画布只用**一种**规格拼整块：
            52（1 块 52 板）、78（1 块 78 板）、104（1 块 104 板）、120（1 块 120 板）、208（2 × 2 块 104 板）、312（3 × 3 块 104 板）。
            这里设的是**正方形**默认值；工作台里上传照片时会按原图比例在**同一规格内**改块数
            （3:4 的竖图在 312 档就是 3 × 4 块 78 板 = 234 × 312 格，比例正好；1:2 的竖图是 3 × 6 块 52 板 = 156 × 312 格）。
            同珠径的板钉距一样（52 / 78 / 104 反推都是 2.692 mm），并排摆着拼图案是连着的，但接缝位置不规律、能不能卡扣要按实物确认 ——
            所以现在只做「同一规格拼整块」，暂不混规格；**不同珠径的板一定不能混**（凸柱间距跟着豆径做，混了格子对不齐）。
            更大的画布在工作台的「② 画布大小 → 自定义尺寸」里按「规格 × 横向几块 × 纵向几块」加，下面会直接算出成品尺寸。
          </p>
        </div>

        <div class="field">
          <label>豆径 <span>{{ options.beadKey ? `手动指定 · ${beadLabel(bead.key, { withDefault: true })}` : `自动 · ${beadLabel(bead.key, { withDefault: true })}` }}</span></label>
          <div class="row row--wrap" style="gap:8px">
            <button
              class="btn btn-secondary" :class="{ yellow: !options.beadKey }"
              :title="`按分板规格自动判断：${BOARD_SPEC_LIST_TEXT} 钉画线板配 2.6mm 小豆（默认），老存档的方板配 5mm 中号豆`"
              @click="options.beadKey = ''"
            >自动</button>
            <button
              v-for="k in BEAD_KEYS" :key="k"
              class="btn btn-secondary" :class="{ yellow: options.beadKey === k }"
              @click="options.beadKey = k"
            >{{ BEADS[k].label }}</button>
          </div>
          <p class="hint">
            豆径决定成品厘米、材料克重和 1:1 打印的格子宽度：<b>2.6mm 小豆（默认）</b> 1 格 = 2.6 mm（52 格 ≈ 13.5 cm、104 格 ≈ 27 cm、120 格 ≈ 31.2 cm），
            <b>5mm 中号豆</b> 1 格 = 5 mm。自动档按**分板规格**判断：我们的拼板（{{ BOARD_SPEC_LIST_TEXT }} 钉）配 2.6mm 小豆，
            所以这些尺寸默认走小豆；只有老存档的方板仍按 5mm 中号豆算 —— 老作品打开后厘米数与以前一致。
            当前画布 {{ options.canvasW }} × {{ options.canvasH }} 格，分板规格 {{ boardSpecText }}，生效豆径 {{ beadLabel(bead.key, { withDefault: true }) }}。
          </p>
        </div>

        <div class="field">
          <label>默认颜色数 <span>{{ options.targetColors }} 色</span></label>
          <div class="rangeRow">
            <input v-model.number="options.targetColors" type="range" min="4" :max="MAX_TARGET_COLORS" data-audit="target-colors">
            <div class="valueBox">{{ options.targetColors }}</div>
          </div>
          <p class="hint">上限 {{ MAX_TARGET_COLORS }} 色（= 最大色板长度，漫德 MARD 291 与 COCO 291 都能整块用上；色板更小的品牌按实际色号数封顶）。实测 48~64 色是"像不像"的拐点，再往上色差只降 0.6%，孤立豆却多 12% —— 所以默认值仍按画布大小建议，这里手动拖到底适合"先把图转准"的场合。</p>
        </div>

        <div class="field">
          <label>默认色板</label>
          <select v-model="options.brandId">
            <option v-for="b in PALETTE_BRANDS" :key="b.id" :value="b.id">{{ b.name }} · {{ b.colorCount }} 色</option>
          </select>
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
            <label class="check"><input v-model="options.cartoon" type="checkbox" disabled> 默认开启卡通化</label>
            <select v-model="options.cartoonStyle" disabled style="max-width:260px">
              <option v-for="s in cartoonStyles" :key="s.key" :value="s.key">{{ s.label }} · {{ s.hint }}</option>
            </select>
          </div>
          <p class="hint" style="margin-top:6px" data-audit="ai-pending-cartoon">
            {{ AI_PENDING_TEXT }}
          </p>
        </div>

        <p class="hint">修改后立即生效，并记录在本机。</p>
      </div>
    </section>

    <!-- 自定义色板 -->
    <section class="card" style="margin-top:18px">
      <div class="card__head">
        <h3>自定义色板</h3>
        <button class="btn btn-secondary sm" @click="customOpen = true">添加颜色</button>
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
        <div v-if="!ALL_FREE" class="dataRow">
          <div>
            <b>会员展示缓存</b>
            <span class="hint">只清本机缓存，不会修改服务端已兑换的权益</span>
          </div>
          <button class="btn sm danger" @click="confirmClear = 'membership'">清除缓存</button>
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
          <b>本地完成的部分</b>
          <p>图片解码、EXIF 方向修正、多级缩放采样、色彩量化、抖动、去孤立豆、图纸渲染、导出文件生成 —— 全部在你的浏览器里用 Canvas 完成，图片不会被上传。</p>
        </div>
        <div class="privacyItem">
          <b>将来需要上云的部分</b>
          <p>AI 文字生成图案、深度方案搜索、批量生成需要服务端模型。接入时会在操作前明确提示哪些内容会上传，并在技术上说明临时文件的删除策略。目前这些功能尚未接入，因此现在没有任何图片离开你的设备。</p>
        </div>
        <div class="privacyItem">
          <b>用作文案声明</b>
          <p>我们不会用你的上传图片训练模型。这条声明的效力取决于实际技术实现与所用服务商的条款，接入 AI 功能时会同步更新这里的说明，不会先写后改。</p>
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
        <button class="btn btn-secondary" @click="close">取消</button>
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
        <button class="btn btn-secondary" @click="close">取消</button>
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
.privacyItem p{font-size:var(--fs-2xs);color:var(--muted);line-height:1.8;margin-top:6px}
</style>
