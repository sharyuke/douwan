<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EditorSidebar from '../components/editor/EditorSidebar.vue'
import EditorCanvas from '../components/editor/EditorCanvas.vue'
import EditorInsights from '../components/editor/EditorInsights.vue'
import DeliveryPanel from '../components/editor/DeliveryPanel.vue'
import TutorialDialog from '../components/editor/TutorialDialog.vue'
import BaseDialog from '../components/ui/BaseDialog.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import {
  hasPattern, projectName, stats,
  currentProjectId, openProject, ensureProjectLoaded, saveProject, generating,
  projectLimit, projects, useImageFile
} from '../composables/useStudio.js'
import { toastOk, toastWarn, toastErr } from '../composables/useToast.js'
import { projectCanvas } from '../lib/forge.js'
import { trackEvent } from '../lib/telemetry.js'

const route = useRoute()
const router = useRouter()

const proOpen = ref(false)
const proReason = ref('')
const tutorialOpen = ref(false)
const deliveryOpen = ref(false)
const deliveryTab = ref('export')

function openDelivery(tab = 'export') {
  openPanel.value = 'none'
  deliveryTab.value = tab
  deliveryOpen.value = true
}

function needPro(reason) {
  proReason.value = reason || '该功能需要 Pro 套餐。'
  proOpen.value = true
}

function openTutorial() {
  openPanel.value = 'none'
  tutorialOpen.value = true
}

/* ---------------------------------------------------------------- 手机端命令栏
   手机上不再把 ①~⑤ 和右栏卡片一路堆在画布下面，而是把命令收成底部两排按钮；
   点一个按钮，从底部升起只包含那张卡的弹层。所有命令都在一屏内，
   画布始终占住中间那块空间。 */
const MOBILE_PANEL_TITLES = {
  create: '图片',
  size: '画布大小',
  scheme: '生成方案',
  palette: '色板与参数',
  analysis: '作品分析',
  colors: '颜色用量',
  stock: '我的库存'
}
const mobilePanel = ref('')
const mobilePanelOpen = ref(false)
const mobilePanelTitle = computed(() => MOBILE_PANEL_TITLES[mobilePanel.value] || '')
const mobileSidebarPanel = computed(() => ['create', 'size', 'scheme', 'palette'].includes(mobilePanel.value))
const mobileInsightsPanel = computed(() => ['analysis', 'colors', 'stock'].includes(mobilePanel.value))

function openMobilePanel(key) {
  openPanel.value = 'none'
  mobilePanel.value = key
  mobilePanelOpen.value = true
}
watch(mobilePanelOpen, v => {
  if (!v) mobilePanel.value = ''
})

/* ---------------------------------------------------------------- 手机端单一面板
   openPanel 只允许一个值：右侧工具抽屉（EditorCanvas 管）与底部八功能
   （这里管）互斥，打开一个必然收起另一个。 */
const openPanel = ref('none') // 'none' | 'tools' | 'functions'
const mobileFunctions = [
  { key: 'create', label: '换图', icon: 'photo' },
  { key: 'size', label: '画布', icon: 'layout' },
  { key: 'scheme', label: '方案', icon: 'sparkles' },
  { key: 'palette', label: '色板', icon: 'palette' },
  { key: 'analysis', label: '分析', icon: 'chart' },
  { key: 'colors', label: '用量', icon: 'list' },
  { key: 'delivery', label: '交付', icon: 'download' },
  { key: 'stock', label: '库存', icon: 'box' }
]
function toggleFunctions() {
  openPanel.value = openPanel.value === 'functions' ? 'none' : 'functions'
}
function pickMobileFunction(f) {
  openPanel.value = 'none'
  if (f.key === 'delivery') openDelivery('export')
  else openMobilePanel(f.key)
}

/* 画布空状态里的「上传图片」：手机上不用先滚到左栏那张卡 */
const mobileFileInput = ref(null)
const mobileBusy = ref(false)
function pickMobileImage() {
  mobileFileInput.value?.click()
}
async function onMobileFile(e) {
  const f = e.target.files?.[0]
  if (!f) return
  mobileBusy.value = true
  try {
    /* 成功结果由画布上方的「已生成图纸」卡承担；这里再弹一条会盖住画布。 */
    await useImageFile(f)
  } catch (err) {
    toastWarn(err.message || '图片载入失败')
  } finally {
    mobileBusy.value = false
    if (mobileFileInput.value) mobileFileInput.value.value = ''
  }
}

onMounted(() => {
  /* 手机端命令栏占住底部两排：提示条要抬到它上面，别压住按钮。
     只在工作台挂这个类，其它页面的提示位置不变。 */
  document.body.classList.add('is-editor')
  trackEvent('editor.open')
  // 带 projectId 进来时先打开存档（/editor/:projectId）
  const id = route.params.projectId
  if (id) {
    if (!ensureProjectLoaded(id)) toastErr('该作品打不开，可能已被删除')
  }
  // 不带 id 就是「一件还没存档的新作品」：工作台左栏「① 创建」的三个入口
  // （上传照片 / AI生成素材 / 免费素材库）都在，选完直接出图。
  // currentProjectId 是从本机存储恢复的「上次打开的作品」，这里必须清掉 ——
  // 否则接着点「保存」会把那件根本没装载的作品覆盖掉。
  else currentProjectId.value = ''
})

onBeforeUnmount(() => {
  document.body.classList.remove('is-editor')
})

// 切到别的存档（切作品、从作品页打开）时地址变了但组件不会重建，得自己盯住参数
watch(() => route.params.projectId, id => {
  if (!id) return
  ensureProjectLoaded(id)
})

function onSave() {
  const id = saveProject()
  if (id && route.params.projectId !== id) {
    router.replace(`/editor/${id}`)
  }
}

/* ---------------------------------------------------------------- 手机端保存
   手机顶栏不放作品名，保存时再问名字：预填当前名字，确认后落盘并更新地址。
   桌面仍是一键保存（顶栏一直显示作品名，改名在作品页做）。 */
const saveOpen = ref(false)
const saveName = ref('')
const saveInput = ref(null)

function openSave() {
  if (!hasPattern.value) return
  openPanel.value = 'none'
  saveName.value = projectName.value || ''
  saveOpen.value = true
  nextTick(() => {
    saveInput.value?.focus()
    saveInput.value?.select()
  })
}

function confirmSave() {
  const name = saveName.value.trim()
  if (!name) {
    toastWarn('给作品起个名字再保存')
    return
  }
  const id = saveProject(name)
  if (!id) return
  saveOpen.value = false
  if (route.params.projectId !== id) router.replace(`/editor/${id}`)
}

/* ---------------------------------------------------------------- 项目列表（切换存档） */

const switchOpen = ref(false)
const switchList = computed(() => projects.value)

function doSwitch(id) {
  if (openProject(id)) {
    switchOpen.value = false
    router.replace(`/editor/${id}`)
    toastOk('已切换作品')
  }
}
</script>

<template>
  <div class="studio">
    <!-- 工作台只有这一种形态：左栏「① 创建」里就是上传照片 / AI生成素材 /
         免费素材库三个入口，选完直接在中间画布出图。
         原来那层独立的「开始创作」页面已经删掉，不再有「先过一页再进来」。 -->
    <EditorSidebar
      class="studio__sidebar"
      @need-pro="needPro" @need-create="router.push('/library')" @open-delivery="openDelivery"
    />

    <div class="col studio__canvas">
      <EditorCanvas
        :panel="openPanel"
        @panel="openPanel = $event"
        @upload="pickMobileImage" @browse="router.push('/library')"
        @resize="openMobilePanel('size')" @tutorial="openTutorial"
        @delivery="openDelivery('export')"
      >
        <!-- 作品名这一行放在画布卡片**外面**：参考版的中间画布块只有
             「页签 + 缩放」一条顶栏，作品名属于卡片上方的信息条。
             放在里面会多出一条分隔线，画布就没那么「大」了。
             外置之后三栏顶边仍然对齐 —— 因为这一条和画布卡片一起
             构成了中栏的第一格（.col 是 flex 列，gap 12px）。 -->
        <template #above>
          <div class="canvasTitleBar no-print">
            <b class="studioTitle">{{ projectName }}</b>
            <span v-if="stats" class="tag">{{ stats.size }} · {{ stats.colors }} 色 · {{ stats.total.toLocaleString() }} 颗</span>
            <span v-if="generating" class="row" style="gap:6px"><span class="spinner"></span><span class="muted">生成中</span></span>
            <span v-else-if="mobileBusy" class="muted only-sm">载入中…</span>
            <span class="spacer"></span>
            <button class="btn btn-secondary sm" @click="switchOpen = true"><PixelIcon name="folder" :size="14" />作品 ({{ switchList.length }}/{{ projectLimit() }})</button>
            <button class="btn soft sm" @click="openTutorial"><PixelIcon name="play" :size="12" />新手教程</button>
            <button class="btn primary sm" :disabled="!hasPattern" @click="onSave"><PixelIcon name="save" :size="14" />保存</button>
          </div>
        </template>

        <!-- 手机端：作品名那一行整条不显示，画布顶栏只留「保存」。
             点「保存」先弹名称编辑，确认后再落盘；新手教程收进「更多」抽屉。 -->
        <template #toolbar>
          <div class="canvasActions">
            <button class="btn primary sm" :disabled="!hasPattern" @click="openSave">保存</button>
          </div>
        </template>

        <!-- 画布下方不再放「高清导出」按钮：导出 / 分板 / 拼装进度统一从
             左栏 ⑤「图纸交付」卡片进入，画布底栏只留编辑工具。 -->
      </EditorCanvas>
    </div>

    <EditorInsights class="studio__insights" @need-pro="needPro" />

    <!-- 手机端：上传入口直接放在画布空状态里（EditorCanvas 的 emptyActions 触发） -->
    <input ref="mobileFileInput" type="file" accept="image/*" hidden @change="onMobileFile">

    <!-- 手机端：紧凑「功能」按钮，放在底部标签栏上方 -->
    <button
      type="button" class="fnPill no-print" :class="{ on: openPanel === 'functions' }"
      aria-haspopup="dialog" :aria-expanded="openPanel === 'functions'"
      @click="toggleFunctions"
    >
      <PixelIcon name="sliders" :size="14" />
      <span>功能</span>
      <span class="fnPill__chev" :class="{ open: openPanel === 'functions' }"><PixelIcon name="chevronUp" :size="11" /></span>
    </button>

    <!-- 手机端八功能：4 列 × 2 行 BottomSheet，点一项打开原有卡片面板 -->
    <BaseDialog
      :model-value="openPanel === 'functions'" title="功能" sheet
      @update:model-value="v => openPanel = v ? 'functions' : 'none'"
    >
      <div class="fnGrid">
        <button
          v-for="f in mobileFunctions" :key="f.key"
          type="button" class="fnGrid__item" @click="pickMobileFunction(f)"
        >
          <span class="fnGrid__icon"><PixelIcon :name="f.icon" :size="22" /></span>
          <span>{{ f.label }}</span>
        </button>
      </div>
      <p class="fnHint">换图 / 画布 / 方案 / 色板 / 分析 / 用量 / 交付 / 库存，原功能都在这里。</p>
    </BaseDialog>

    <!-- 手机端弹层：只显示命令对应的那张卡，底部升起 -->
    <BaseDialog v-model="mobilePanelOpen" :title="mobilePanelTitle" sheet>
      <EditorSidebar
        v-if="mobileSidebarPanel"
        :key="mobilePanel"
        :focus="mobilePanel"
        @need-pro="needPro" @need-create="router.push('/library')" @open-delivery="openDelivery"
      />
      <EditorInsights
        v-else-if="mobileInsightsPanel"
        :key="mobilePanel"
        :focus="mobilePanel"
        @need-pro="needPro"
      />
      <p v-if="mobilePanel === 'colors' && !hasPattern" class="processHint">
        生成图纸后这里显示每种颜色的用量与缺口。
      </p>
    </BaseDialog>

    <!-- 会员引导：按钮不隐藏，点击后给出明确原因（PRD §43） -->
    <BaseDialog v-model="proOpen" title="升级 Pro 解锁这个功能" size="sm">
      <p style="font-size:var(--fs-sm);line-height:1.85;color:var(--ink-2)">{{ proReason }}</p>
      <div class="proBullets">
        <div v-for="f in ['三方案自动搜索 + 智能推荐', '可拼性优化（去孤立豆 / 抖动 / 合并零星色）', '库存约束配色：只用我有的豆', '分板 PDF 与 1:1 打印图纸', '逐颗 / 整板拼制进度与分享卡', '完整品牌色板（COCO / 漫漫 / 盼盼 / 咪小窝 / 优肯 / Hama / Perler）']" :key="f">
          <span class="proCheck"><PixelIcon name="check" :size="11" /></span>{{ f }}
        </div>
      </div>
      <div class="tag" style="margin-top:14px">AI 生图尚未接入，当前不收取 AI 费用</div>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">先不用</button>
        <RouterLink to="/pricing" class="btn primary" @click="close">查看 Pro 权益<PixelIcon name="arrowRight" :size="13" /></RouterLink>
      </template>
    </BaseDialog>

    <!-- 图纸交付：高清导出 / 分板 / 拼装进度 -->
    <DeliveryPanel v-model="deliveryOpen" :initial-tab="deliveryTab" @need-pro="needPro" />

    <!-- 切换作品 -->
    <BaseDialog v-model="switchOpen" title="我的作品">
      <div v-if="!switchList.length" class="empty">
        <div class="empty__icon"><PixelIcon name="folder" :size="22" /></div>
        <strong>还没有保存过作品</strong>
        <p>点右上角「保存」会把当前图纸存到本机浏览器，刷新也在。</p>
      </div>
      <div v-else class="switchList">
        <button
          v-for="p in switchList" :key="p.id"
          class="switchItem" :class="{ on: p.id === currentProjectId }"
          @click="doSwitch(p.id)"
        >
          <div class="switchThumb">
            <img v-if="p.thumbnail" :src="p.thumbnail" :alt="p.name">
            <span v-else>—</span>
          </div>
          <div class="switchMeta">
            <b>{{ p.name }}</b>
            <span class="hint">{{ projectCanvas(p).w }}×{{ projectCanvas(p).h }} · {{ (p.variants && p.variants.length) || 0 }} 个方案</span>
          </div>
          <span v-if="p.id === currentProjectId" class="tag new">当前</span>
        </button>
      </div>
      <template #footer="{ close }">
        <RouterLink to="/projects" class="btn btn-secondary" @click="close">管理全部作品</RouterLink>
        <button class="btn primary" @click="onSave(); close()">保存当前</button>
      </template>
    </BaseDialog>

    <!-- 手机端保存：顶栏不显示作品名，先问名字再落盘 -->
    <BaseDialog v-model="saveOpen" title="保存作品" size="sm">
      <div class="field">
        <label for="save-name">作品名称</label>
        <input
          id="save-name" ref="saveInput" v-model="saveName"
          type="text" maxlength="24" placeholder="例如：橘猫钥匙扣"
          @keyup.enter="confirmSave"
        >
      </div>
      <p class="hint" style="margin-top:10px">名字只用于本机作品列表，之后可以在「作品」页改。</p>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button class="btn primary" :disabled="!saveName.trim()" @click="confirmSave">保存</button>
      </template>
    </BaseDialog>

    <!-- 新手教程：4 段视频，覆盖上传 / 方案 / 微调 / 导出开拼 -->
    <TutorialDialog v-model="tutorialOpen" />
  </div>
</template>

<style scoped>
/* 画布上方的作品信息条（作品名 + 保存），与画布卡片同宽、同一栏 */
.canvasTitleBar{
  display:flex;align-items:center;gap:9px;flex-wrap:wrap;
  padding:11px 14px;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-md);box-shadow:var(--sh-1);
}
.canvasTitleBar .spacer{flex:1;min-width:0}
.studioTitle{font-size:var(--fs-sm);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proBullets{margin-top:14px;display:flex;flex-direction:column;gap:8px}
.proBullets div{display:flex;gap:8px;font-size:var(--fs-xs);color:var(--ink-2)}
.proCheck{
  width:17px;height:17px;flex:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
  background:var(--green-soft);color:var(--green-deep);margin-top:1px;
}
.exportPreview{
  display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;
  margin-bottom:12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2);
}
.exportPreview canvas{
  max-width:100%;height:auto;border-radius:var(--r-sm);box-shadow:var(--sh-1);background:#fff;
}
.exportPreview .hint{text-align:center;margin:0}
.exportSettings{
  display:flex;flex-wrap:wrap;gap:10px 18px;padding:12px 14px;margin-bottom:12px;
  border-radius:var(--r-md);background:var(--surface-2);border:1px solid var(--line);
}
.exportSettings .check{font-size:var(--fs-xs);display:inline-flex;align-items:center;gap:6px}
.exportSettings select{
  padding:5px 8px;border:1px solid transparent;border-radius:var(--r-sm);
  background:var(--surface-3);color:var(--ink);font-size:var(--fs-xs);
}
.exportSettings select:focus{background:var(--surface);border-color:var(--pink);box-shadow:0 0 0 3px rgba(255,142,199,.18);outline:0}
.exportGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.exportItem{
  text-align:left;padding:13px;border:1.5px solid var(--line);border-radius:var(--r-md);
  background:var(--surface);transition:var(--t);display:flex;flex-direction:column;gap:6px;
}
.exportItem:hover{border-color:var(--primary);background:#FFFCF7}
.exportItem b{font-size:var(--fs-xs)}
.switchList{display:flex;flex-direction:column;gap:8px}
.switchItem{
  display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:11px;align-items:center;
  padding:9px;border:1.5px solid var(--line);border-radius:var(--r-sm);text-align:left;transition:var(--t);
}
.switchItem:hover{border-color:var(--line-strong)}
.switchItem.on{border-color:var(--primary);background:#FFFCF7}
.switchThumb{width:54px;height:54px;border-radius:var(--r-xs);background:var(--surface-2);display:grid;place-items:center;overflow:hidden}
.switchThumb img{max-width:100%;max-height:100%;image-rendering:pixelated}
.switchMeta{display:flex;flex-direction:column;gap:3px;min-width:0}
.switchMeta b{font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 保存 / 新手教程只在手机画布顶栏出现；桌面仍用上方的作品信息条 */
.canvasActions{display:none}
/* 功能按钮只在手机出现；桌面端整块不占位 */
.fnPill{display:none}
@media(max-width:780px){
  /* 手机上导出条只留「图纸 / 分板 PDF / 更多…」：CSV 与分享卡收进「更多」弹窗。
     导出条在画布卡片最下面，少一排按钮整页就少 44px，也少一层要读的东西。 */
  .exportgroup .exp-csv,.exportgroup .exp-share{display:none}
  /* 作品名整条不显示（桌面保留）：手机优先把高度给画布，作品名在保存弹窗里编辑，
     作品切换走底部标签栏的「作品」。这一条原来占 84px。 */
  .canvasTitleBar{display:none}
  /* 保存放进画布顶栏（EditorCanvas 的 #toolbar 插槽），只在手机出现 */
  .canvasActions{display:flex;align-items:center;gap:4px;flex:0 0 auto}
  .canvasActions .btn{min-height:32px;padding:0 9px;font-size:var(--fs-2xs)}

  /* 功能按钮：底部标签栏上方的胶囊，不占画布高度 */
  .fnPill{
    display:inline-flex;position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));
    transform:translateX(-50%);z-index:111;
    align-items:center;gap:6px;min-height:44px;padding:0 18px;
    border:1px solid var(--line);border-radius:var(--r-pill);
    background:rgba(255,255,255,.97);box-shadow:0 8px 24px rgba(24,24,28,.14);
    color:var(--ink);font-size:var(--fs-xs);font-weight:850;
  }
  .fnPill:active{background:var(--primary-soft)}
  .fnPill.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary-ink)}
  .fnPill__chev{display:inline-flex;transition:transform .18s var(--ease)}
  .fnPill__chev.open{transform:rotate(180deg)}

  /* 八功能面板：4 列 × 2 行，每格 44px 以上触控高度 */
  .fnGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .fnGrid__item{
    min-height:76px;padding:9px 3px;border:1px solid var(--line);border-radius:14px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
    background:var(--surface-2);color:var(--ink-2);font-size:var(--fs-2xs);font-weight:800;
  }
  .fnGrid__item:active{background:var(--primary-soft);color:var(--primary-ink)}
  .fnGrid__icon{
    width:38px;height:38px;border-radius:12px;display:grid;place-items:center;
    background:var(--surface);border:1px solid var(--line);
  }
  .fnHint{margin:12px 0 0;text-align:center;font-size:var(--fs-2xs);color:var(--muted);line-height:1.6}
}
</style>
