<script setup>
/* =========================================================================
   图纸交付（需求 V1.1 第二部分）
   把原来分散的「从图纸到完成」与画布「更多导出」收进同一个模块：
     · 整张图纸：PNG / JPG 按 150 / 300 / 600 DPI 真实像素重绘
     · 分板交付：分板 PDF 或 每板一张图片的 ZIP
     · 拼装与完成：原来右侧「从图纸到完成」的进度与完成入口
   旧导出能力（纯图案 / SVG / CSV / JSON / 分享卡 / 对照图 / 复制清单）全部保留。
   ========================================================================= */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import BaseDialog from '../ui/BaseDialog.vue'
import PixelIcon from '../ui/PixelIcon.vue'
import {
  pattern, hasPattern, projectName, stats, materials, layout,
  currentProjectId, saveProject, buildStats, buildBoards, buildBoard,
  isFinished, finishedAt, brand, bead, sourceImg
} from '../../composables/useStudio.js'
import { inventory } from '../../composables/useInventory.js'
import { boardLayout, boardMaterials } from '../../lib/pattern.js'
import { BOARD_SPECS } from '../../lib/boardSpec.js'
import { drawBoard } from '../../lib/render.js'
import { check } from '../../composables/useMembership.js'
import { toastOk, toastWarn, toastResult } from '../../composables/useToast.js'
import { trackEvent } from '../../lib/telemetry.js'
import {
  DPI_OPTIONS, dpiExportPlan, exportPatternPNGAtDpi, exportPatternJPGAtDpi,
  buildPatternImageCanvas, exportCleanPNG, exportSVG, exportMaterialsCSV,
  exportPatternJSON, printPattern, exportShareCard, exportComparePNG,
  copyShoppingList, exportBoardImagesZip
} from '../../lib/exporters.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initialTab: { type: String, default: 'export' }
})
const emit = defineEmits(['update:modelValue', 'need-pro'])
const router = useRouter()

const tab = ref('export')
const settings = ref({
  dpi: 300,
  ruler: true,
  grid: true,
  codes: true,
  legend: true,
  stats: true,
  background: '#ffffff',
  orientation: 'portrait',
  /* 分板导出可临时换板规格：0 = 跟随图纸自己的 boardSize，-1 = 自定义 */
  splitSpec: 0,
  splitCustom: 29
})
const status = ref({ state: 'idle', text: '', retry: null })
/* 右侧命令区按「同类内容」分组，默认全收起：一屏放得下，点标题再展开。 */
const acc = ref({ quality: false, split: false, options: false, formats: false, checks: false })
function toggleAcc(key) {
  acc.value[key] = !acc.value[key]
}
const previewEl = ref(null)
const previewMsg = ref('')
const previewing = ref(false)

/* 分板交付的左栏不再是一张「整图 + 红框」，而是每块板一张独立预览：
   每张都带自己的板号、全图列 / 行范围、本板颗数与色号图例。
   板多时（最多 1225 块）只在滚到眼前时画、滚走就释放画布缓冲。 */
const splitListEl = ref(null)
const boardPreviewEls = new Map()
const boardDrawn = new Set()
let boardIo = null
const BOARD_PREVIEW_CELL = 12
const BOARD_PREVIEW_MAX = 120

function setBoardPreviewRef(el, no) {
  if (!el) {
    boardPreviewEls.delete(no)
    boardDrawn.delete(no)
    return
  }
  boardPreviewEls.set(no, el)
  el.dataset.boardNo = String(no)
  boardIo?.observe(el)
}

function drawBoardPreview(no) {
  const el = boardPreviewEls.get(no)
  const b = boards.value[no - 1]
  if (!el || !b || !pattern.value) return
  drawBoard(el, pattern.value, b, {
    cell: BOARD_PREVIEW_CELL,
    codes: settings.value.codes,
    ruler: settings.value.ruler,
    grid: settings.value.grid
  })
  boardDrawn.add(no)
}

/* 缩成 1×1 只是释放后备缓冲：卡片外层用 aspect-ratio 撑住高度，
   画布是绝对定位铺满，所以滚回来之前也不会把列表撑变形。 */
function releaseBoardPreview(no) {
  const el = boardPreviewEls.get(no)
  if (!el || !boardDrawn.has(no)) return
  el.width = 1
  el.height = 1
  boardDrawn.delete(no)
}

function ensureBoardObserver() {
  if (typeof IntersectionObserver === 'undefined') return null
  if (boardIo) return boardIo
  boardIo = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const no = Number(entry.target.dataset.boardNo)
      if (!no) continue
      if (entry.isIntersecting) drawBoardPreview(no)
      else releaseBoardPreview(no)
    }
  }, { root: splitListEl.value, rootMargin: '260px 0px' })
  return boardIo
}

async function renderSplitPreviews() {
  if (!props.modelValue || tab.value !== 'split' || !hasPattern.value) return
  await nextTick()
  if (!splitListEl.value) return
  if (boardIo) {
    boardIo.disconnect()
    boardIo = null
  }
  const io = ensureBoardObserver()
  if (!io) {
    for (const no of boardPreviewEls.keys()) drawBoardPreview(no)
    return
  }
  for (const el of boardPreviewEls.values()) io.observe(el)
}

/* 每块板的摘要：颗数 / 色号图例都按这块板的真实格子算，空格不计 */
const boardPreviewRows = computed(() => {
  const p = pattern.value
  if (!p) return []
  const ruler = settings.value.ruler ? Math.max(14, Math.round(BOARD_PREVIEW_CELL * 1.7)) : 0
  return boards.value.slice(0, BOARD_PREVIEW_MAX).map(b => {
    const mats = boardMaterials(p, b, inventory.value)
    const beads = mats.reduce((sum, m) => sum + m.count, 0)
    return {
      b,
      mats,
      beads,
      aspect: `${b.w * BOARD_PREVIEW_CELL + ruler * 2} / ${b.h * BOARD_PREVIEW_CELL + ruler * 2}`
    }
  })
})

onBeforeUnmount(() => {
  if (boardIo) {
    boardIo.disconnect()
    boardIo = null
  }
})

function refreshPreview() {
  if (!props.modelValue) return
  if (tab.value === 'split') renderSplitPreviews()
  else nextTick(renderPreview)
}

watch(() => props.modelValue, open => {
  if (open) {
    tab.value = props.initialTab || 'export'
    refreshPreview()
    return
  }
  /* 关掉弹窗时画布会卸载：断开观察器，别让它继续攥着一批脱离文档的 canvas */
  if (boardIo) {
    boardIo.disconnect()
    boardIo = null
  }
})
watch(() => props.initialTab, v => {
  if (props.modelValue && v) tab.value = v
})
watch(settings, () => {
  refreshPreview()
}, { deep: true })
watch(tab, () => {
  /* 换页签就清掉上一种导出的状态：否则「分板交付」里还挂着整张 PNG 的成功文案 */
  status.value = { state: 'idle', text: '', retry: null }
  if (tab.value !== 'split' && boardIo) {
    boardIo.disconnect()
    boardIo = null
  }
  refreshPreview()
})
const fullPlan = computed(() => (hasPattern.value
  ? dpiExportPlan(pattern.value, {
      dpi: settings.value.dpi,
      mode: 'full',
      ruler: settings.value.ruler,
      includeLegend: settings.value.legend,
      includeStats: settings.value.stats
    })
  : null))
const exportBoardSize = computed(() => {
  const spec = settings.value.splitSpec
  if (spec === -1) {
    const n = Math.max(1, Math.min(1000, Math.round(Number(settings.value.splitCustom) || 29)))
    return { x: n, y: n }
  }
  return spec || undefined
})
const splitPlan = computed(() => (hasPattern.value
  ? dpiExportPlan(pattern.value, {
      dpi: settings.value.dpi,
      mode: 'split',
      ruler: settings.value.ruler,
      boardSize: exportBoardSize.value
    })
  : null))
const pdfPlan = computed(() => (hasPattern.value
  ? dpiExportPlan(pattern.value, {
      dpi: settings.value.dpi,
      mode: 'pdf',
      ruler: settings.value.ruler,
      boardSize: exportBoardSize.value
    })
  : null))
const plan = computed(() => (tab.value === 'split' ? splitPlan.value : fullPlan.value))

/* 分板交付允许用户在导出前换规格（52 / 78 / 104 / 120 或自定义）；
   这个 layout 只服务导出预览与统计，不会写回图纸。 */
const exportLayout = computed(() => {
  if (!hasPattern.value) return null
  const p = pattern.value
  return boardLayout(p.width, p.height, exportBoardSize.value || p.boardSize || undefined)
})
const displayLayout = computed(() => (tab.value === 'split' ? exportLayout.value : layout.value))
const boards = computed(() => (exportLayout.value ? exportLayout.value.boards : []))
/* 板规格换了，板数 / 每板尺寸都变：已经画过的板要按新尺寸重画 */
watch(boards, () => {
  if (tab.value === 'split' && props.modelValue) {
    for (const no of [...boardDrawn]) drawBoardPreview(no)
  }
})
const nextBoard = computed(() => {
  const list = buildBoards.value || []
  if (!list.length) return null
  return list[Math.min(buildBoard.value, list.length - 1)]
})
const doneBoards = computed(() => (buildBoards.value || []).filter(b => b.percent >= 100).length)
const buildPercent = computed(() => (hasPattern.value ? (isFinished.value ? 100 : buildStats.value.percent) : 0))

const missingCodes = computed(() => {
  const p = pattern.value
  if (!p || !p.palette) return 0
  return p.palette.filter(c => !c || !c.code).length
})

const checks = computed(() => {
  const list = []
  if (!hasPattern.value) {
    list.push({ level: 'fatal', text: '还没有图纸：先上传图片或选一个素材生成图纸。' })
    return list
  }
  const p = pattern.value
  if (!(p.width > 0) || !(p.height > 0)) list.push({ level: 'fatal', text: '图纸尺寸不合法，请重新生成。' })
  if (missingCodes.value) list.push({ level: 'fatal', text: `${missingCodes.value} 个颜色缺少色号映射；请换一套色板或重新生成后再导出。` })
  if (tab.value === 'split') {
    if (!boards.value.length) list.push({ level: 'fatal', text: '分板配置不合法：当前图纸没有可用的分板。' })
    if (boards.value.length > 256) list.push({ level: 'fatal', text: `分板 PDF 最多 256 页，当前需要 ${boards.value.length} 页。请减少画布尺寸，或改用图片组 ZIP 分批交付。` })
    if (settings.value.codes && splitPlan.value && splitPlan.value.cell < 9) {
      list.push({ level: 'warn', text: '每格像素偏低，色号可能看不清；建议 150 DPI 以上或减少画布尺寸。' })
    }
  }
  if (settings.value.codes && fullPlan.value && fullPlan.value.cell < 11) {
    list.push({ level: 'warn', text: '整张图纸的每格像素不足以画清色号；要看色号请用「分板交付」。' })
  }
  if (fullPlan.value && fullPlan.value.capped) list.push({ level: 'warn', text: fullPlan.value.message })
  if (tab.value === 'split' && splitPlan.value && splitPlan.value.capped) list.push({ level: 'warn', text: splitPlan.value.message })
  if (!list.length) list.push({ level: 'ok', text: '检查通过，可以导出。' })
  return list
})
const hasFatal = computed(() => checks.value.some(c => c.level === 'fatal'))

function imageOptions() {
  const s = settings.value
  return {
    ruler: s.ruler,
    grid: s.grid,
    codes: s.codes,
    includeLegend: s.legend,
    includeStats: s.stats,
    background: s.background
  }
}

function printOptions(cell) {
  return {
    projectName: projectName.value,
    inventoryMap: inventory.value,
    stats: pattern.value ? pattern.value.stats : null,
    brandName: brand.value.name,
    orientation: settings.value.orientation,
    includeBoardLegend: settings.value.legend,
    includeMaterials: settings.value.stats,
    ruler: settings.value.ruler,
    codes: settings.value.codes,
    grid: settings.value.grid,
    boardSize: exportBoardSize.value,
    cell
  }
}

function setStatus(state, text, retry = null) {
  status.value = { state, text, retry }
}

async function runExport(item) {
  if (!hasPattern.value) {
    toastWarn('先生成一张图纸再导出')
    return
  }
  const gate = item.feature ? check(item.feature) : { ok: true }
  if (!gate.ok) {
    emit('need-pro', gate.reason)
    return
  }
  setStatus('preparing', `正在准备「${item.label}」…`)
  await nextTick()
  setStatus('generating', `正在生成「${item.label}」…`)
  try {
    const res = await item.run()
    if (res && res.ok === false) {
      setStatus('failure', res.message || '导出失败', () => runExport(item))
      toastResult(res)
      return
    }
    const msg = res && res.message ? res.message : `「${item.label}」已导出`
    setStatus('success', msg)
    trackEvent('pattern.export')
    if (res) toastResult(res)
    else toastOk(msg)
  } catch (e) {
    setStatus('failure', `导出失败：${e && e.message ? e.message : '浏览器不支持这个操作'}`, () => runExport(item))
  }
}

const fullItems = computed(() => {
  const p = pattern.value
  const opts = imageOptions()
  const cell = fullPlan.value ? fullPlan.value.cell : 24
  return [
    {
      key: 'png', label: '图纸 PNG（高清）', feature: 'export.png',
      desc: `按 ${settings.value.dpi} DPI 重新渲染${fullPlan.value ? `，实际 ${fullPlan.value.dpi} DPI · ${fullPlan.value.width}×${fullPlan.value.height} px` : ''}`,
      run: () => exportPatternPNGAtDpi(p, { dpi: settings.value.dpi, projectName: projectName.value, ...opts })
    },
    {
      key: 'jpg', label: '图纸 JPG（高清）', feature: 'export.png',
      desc: '白底、适合手机查看与普通打印；透明区域铺白，不会出现黑底',
      run: () => exportPatternJPGAtDpi(p, { dpi: settings.value.dpi, projectName: projectName.value, ...opts })
    },
    {
      key: 'pdf', label: '分板 PDF / 打印', feature: 'export.pdf',
      desc: pdfPlan.value ? `每板一页，板图按 ${pdfPlan.value.dpi} DPI 渲染（请求 ${settings.value.dpi} DPI）` : '封面 + 每板一页 + 材料清单',
      run: () => printPattern(p, printOptions(pdfPlan.value ? pdfPlan.value.cell : cell))
    },
    {
      key: 'csv', label: '材料清单 CSV', feature: 'export.csv',
      desc: '品牌/系列 · 色号 · 颜色 · 数量 · 已有 · 缺少',
      run: () => {
        exportMaterialsCSV(p, inventory.value, projectName.value)
        return { ok: true, message: '材料清单 CSV 已导出（含品牌/系列与色号）' }
      }
    },
    {
      key: 'copy', label: '复制采购清单', feature: '',
      desc: '按品牌/系列 · 色号 · 数量排版，可直接粘到聊天窗口',
      run: async () => {
        const res = await copyShoppingList(p, inventory.value, projectName.value)
        return res.ok ? { ok: true, message: '采购清单已复制' } : { ok: false, message: '复制失败，请改用 CSV 导出' }
      }
    },
    {
      key: 'svg', label: 'SVG 矢量图', feature: 'export.svg',
      desc: '可无损放大，适合印刷；超过约 16 MB 会先丢色号',
      run: () => exportSVG(p, { projectName: projectName.value, cell: 12, codes: false })
    },
    {
      key: 'json', label: 'Pattern JSON', feature: 'export.json',
      desc: '结构化网格数据，可再导入编辑',
      run: () => exportPatternJSON(p, projectName.value, { stats: p.stats })
    },
    {
      key: 'clean', label: '纯图案 PNG', feature: 'export.png',
      desc: '不带标尺，适合发社媒或做头像',
      run: () => {
        exportCleanPNG(p, { projectName: projectName.value })
        return { ok: true, message: '纯图案 PNG 已导出' }
      }
    },
    {
      key: 'compare', label: '原图对照 PNG', feature: 'export.png',
      desc: '原图与拼豆图并排',
      run: () => {
        exportComparePNG(p, { projectName: projectName.value, sourceImage: sourceImg.value })
        return { ok: true, message: '原图对照 PNG 已导出' }
      }
    },
    {
      key: 'share', label: '分享卡 PNG', feature: 'export.share',
      desc: '1080×1350 竖版，原图/拼豆图/成品三格',
      run: () => {
        exportShareCard(p, {
          projectName: projectName.value,
          sourceImage: sourceImg.value,
          stats: p.stats,
          brandName: brand.value.name,
          buildPercent: buildStats.value.percent
        })
        return { ok: true, message: '分享卡已导出' }
      }
    }
  ]
})

const splitItems = computed(() => {
  const p = pattern.value
  return [
    {
      key: 'split-pdf', label: '分板 PDF（每板一页）', feature: 'export.pdf',
      desc: pdfPlan.value ? `共 ${pdfPlan.value.pages} 页 · 板图约 ${pdfPlan.value.dpi} DPI · 单板沿用全图列 / 行号、每板统计与材料总表` : '每块板一页',
      run: () => printPattern(p, printOptions(pdfPlan.value ? pdfPlan.value.cell : 24))
    },
    {
      key: 'split-png', label: '分板 PNG（ZIP）', feature: 'export.png',
      desc: splitPlan.value ? `共 ${splitPlan.value.pages} 张 · 约 ${splitPlan.value.dpi} DPI · 文件名固定为「图纸名_第01板」` : '每块板一张 PNG',
      run: () => exportBoardImagesZip(p, {
        dpi: settings.value.dpi, format: 'png', projectName: projectName.value,
        ruler: settings.value.ruler, codes: settings.value.codes, grid: settings.value.grid,
        boardSize: exportBoardSize.value
      })
    },
    {
      key: 'split-jpg', label: '分板 JPG（ZIP）', feature: 'export.png',
      desc: '白底 JPG，透明区域铺白；适合发给别人在手机上看',
      run: () => exportBoardImagesZip(p, {
        dpi: settings.value.dpi, format: 'jpg', projectName: projectName.value,
        ruler: settings.value.ruler, codes: settings.value.codes, grid: settings.value.grid,
        boardSize: exportBoardSize.value
      })
    }
  ]
})

/* 右侧命令区的摘要与当前选中的导出格式：摘要直接写在折叠行上，
   用户不展开也知道现在是什么档位 / 开了哪些选项 / 选了什么格式。 */
const currentItems = computed(() => (tab.value === 'split' ? splitItems.value : fullItems.value))
const selectedKey = ref('png')
watch(tab, () => {
  selectedKey.value = tab.value === 'split' ? 'split-pdf' : 'png'
})
const selectedItem = computed(() => currentItems.value.find(i => i.key === selectedKey.value) || currentItems.value[0] || null)
const qualitySummary = computed(() => {
  const p = plan.value
  return p ? `${settings.value.dpi} DPI · 每格 ${p.cell} px` : `${settings.value.dpi} DPI`
})
const splitSummary = computed(() => {
  const spec = settings.value.splitSpec
  if (spec === -1) return `自定义 ${settings.value.splitCustom || 1} 格`
  if (spec) return `${spec} 钉板`
  const bs = pattern.value && pattern.value.boardSize
  return `跟随图纸${bs ? ` ${bs.x}×${bs.y}` : ''}`
})
const optionsSummary = computed(() => {
  const s = settings.value
  const on = [s.ruler && '坐标', s.grid && '网格', s.codes && '色号', s.legend && '图例', s.stats && '统计'].filter(Boolean)
  return `${on.length ? on.join(' / ') : '全部关闭'} · ${s.background === '#ffffff' ? '白底' : '透明'}`
})
const checkSummary = computed(() => {
  const fatal = checks.value.filter(c => c.level === 'fatal').length
  const warn = checks.value.filter(c => c.level === 'warn').length
  if (fatal) return { level: 'fatal', text: `${fatal} 项需要处理` }
  if (warn) return { level: 'warn', text: `${warn} 条提示` }
  return { level: 'ok', text: '检查通过' }
})
/* 有 fatal 时自动展开检查项：否则导出按钮是灰的，用户不知道卡在哪。 */
watch(hasFatal, v => {
  if (v) acc.value.checks = true
})

async function renderPreview() {
  if (!props.modelValue || tab.value === 'split' || !hasPattern.value) return
  await nextTick()
  const el = previewEl.value
  if (!el) return
  previewing.value = true
  try {
    const p = pattern.value
    const longest = Math.max(p.width || 1, p.height || 1)
    const cell = Math.max(1, Math.min(12, Math.floor(900 / longest)))
    const built = buildPatternImageCanvas(p, {
      format: 'png',
      cell,
      ...imageOptions(),
      codes: settings.value.codes && cell >= 11
    })
    if (!built.ok) {
      previewMsg.value = built.message || '预览生成失败'
      return
    }
    const src = built.canvas
    /* 预览要同时受宽高约束：交付面板是左右结构，左栏高度有限，
       只按宽度缩放时竖图会把右栏挤到屏幕外。 */
    const wide = typeof window !== 'undefined' && window.innerWidth > 820
    const scale = Math.min(1, (wide ? 640 : 360) / src.width, (wide ? 560 : 260) / src.height)
    el.width = Math.max(1, Math.round(src.width * scale))
    el.height = Math.max(1, Math.round(src.height * scale))
    const ctx = el.getContext('2d')
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.drawImage(src, 0, 0, el.width, el.height)

    const planNow = tab.value === 'build' ? null : plan.value
    previewMsg.value = planNow
      ? `预览 ${Math.round(scale * 100)}% · 实际导出 ${planNow.width}×${planNow.height} px（${planNow.dpi} DPI${planNow.capped ? '，已按上限调整' : ''}）`
      : `预览 ${Math.round(scale * 100)}%`
  } catch (e) {
    previewMsg.value = `预览生成失败：${e && e.message ? e.message : '浏览器不支持'}`
  } finally {
    previewing.value = false
  }
}

function goBuild() {
  const target = currentProjectId.value ? `/build/${currentProjectId.value}` : '/build'
  router.push(target).catch(() => {})
}

function goFinish() {
  const target = currentProjectId.value ? `/build/${currentProjectId.value}?finish=1` : '/build?finish=1'
  router.push(target).catch(() => {})
}

function onSave() {
  const id = saveProject()
  if (id) toastOk('作品已保存')
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    title="图纸交付"
    size="lg"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <div class="delivery" data-audit="delivery-panel">
      <div class="deliveryTabs" role="tablist">
        <button :class="{ on: tab === 'export' }" role="tab" :aria-selected="tab === 'export'" @click="tab = 'export'">整张图纸</button>
        <button :class="{ on: tab === 'split' }" role="tab" :aria-selected="tab === 'split'" @click="tab = 'split'">分板交付</button>
        <button :class="{ on: tab === 'build' }" role="tab" :aria-selected="tab === 'build'" @click="tab = 'build'">拼装与完成</button>
      </div>

      <div v-if="hasPattern" class="deliveryMain">
        <!-- 左栏：整张图纸时是一张缩略图；分板交付时拆成每块板一张独立预览 -->
        <div class="deliveryLeft">
          <div v-if="tab === 'split'" ref="splitListEl" class="splitPreviewList" data-audit="split-preview">
            <div class="splitPreviewNote">
              <b>共 {{ boards.length }} 块板</b>
              <span>每块单独预览 · 坐标沿用整张图纸的全局列 / 行号</span>
            </div>
            <article v-for="row in boardPreviewRows" :key="row.b.no" class="boardCard" :data-board-no="row.b.no">
              <header class="boardCard__head">
                <b>第 {{ row.b.no }} / {{ boards.length }} 板</b>
                <span class="boardCard__range">全图 {{ row.b.x0 + 1 }}–{{ row.b.x0 + row.b.w }} 列 · {{ row.b.y0 + 1 }}–{{ row.b.y0 + row.b.h }} 行</span>
                <span class="boardCard__meta">{{ row.beads.toLocaleString() }} 颗 · {{ row.mats.length }} 色</span>
              </header>
              <div class="boardCard__img" :style="{ aspectRatio: row.aspect }">
                <canvas :ref="el => setBoardPreviewRef(el, row.b.no)"></canvas>
              </div>
              <div v-if="settings.legend && row.mats.length" class="boardCard__legend">
                <span v-for="m in row.mats" :key="m.id">
                  <i :style="{ background: m.hex }"></i>{{ m.code }} × {{ m.count }} 颗
                </span>
              </div>
            </article>
            <p v-if="boards.length > BOARD_PREVIEW_MAX" class="hint">
              预览只画前 {{ BOARD_PREVIEW_MAX }} 块（共 {{ boards.length }} 块），导出仍包含全部板。
            </p>
          </div>
          <div v-else class="previewBox">
            <canvas ref="previewEl"></canvas>
            <p class="hint">{{ previewing ? '正在生成预览…' : previewMsg }}</p>
          </div>
          <div class="deliverySummary">
            <b>{{ projectName }}</b>
            <span>{{ pattern.width }}×{{ pattern.height }} 格</span>
            <span v-if="stats">{{ stats.colors }} 色 · {{ stats.total.toLocaleString() }} 颗</span>
            <span v-if="displayLayout">{{ displayLayout.count }} 块 {{ displayLayout.boardSize.x }} 钉板</span>
            <span>{{ bead.label }}</span>
          </div>
        </div>

        <!-- 右栏是命令区：同类内容各收一格，点标题展开 -->
        <div class="deliveryRight">
          <template v-if="tab !== 'build'">
            <section class="acc" :class="{ open: acc.quality }">
              <button class="accHead" type="button" :aria-expanded="acc.quality" @click="toggleAcc('quality')">
                <span class="accTitle">清晰度</span>
                <span class="accValue">{{ qualitySummary }}</span>
                <i class="accArrow" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
              </button>
              <div v-show="acc.quality" class="accBody">
                <div class="dpiBtns">
                  <button
                    v-for="d in DPI_OPTIONS" :key="d"
                    class="dpiBtn" :class="{ on: settings.dpi === d }"
                    :data-audit="'dpi-' + d"
                    @click="settings.dpi = d"
                  >
                    <b>{{ d }} DPI</b>
                    <span>{{ d === 150 ? '预览够用' : d === 300 ? '推荐高清' : '超高精度' }} · 每格 {{ Math.round(bead.mm / 25.4 * d) }} px</span>
                  </button>
                </div>
                <p v-if="plan" class="hint" :class="{ warnText: plan.capped }">{{ plan.message }}</p>
              </div>
            </section>

            <section v-if="tab === 'split'" class="acc" :class="{ open: acc.split }">
              <button class="accHead" type="button" :aria-expanded="acc.split" @click="toggleAcc('split')">
                <span class="accTitle">拼板规格</span>
                <span class="accValue">{{ splitSummary }}</span>
                <i class="accArrow" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
              </button>
              <div v-show="acc.split" class="accBody splitSpecRow">
                <select v-model.number="settings.splitSpec" data-audit="split-spec">
                  <option :value="0">跟随图纸（{{ pattern && pattern.boardSize ? pattern.boardSize.x + '×' + pattern.boardSize.y : '自动' }}）</option>
                  <option :value="29">29 × 29 格（老规格）</option>
                  <option v-for="s in BOARD_SPECS" :key="s" :value="s">{{ s }} × {{ s }} 钉板</option>
                  <option :value="-1">自定义…</option>
                </select>
                <div v-if="settings.splitSpec === -1" class="row" style="gap:8px;align-items:center">
                  <input
                    v-model.number="settings.splitCustom" class="specInput"
                    data-audit="split-custom" type="number" min="1" max="1000" step="1"
                    aria-label="自定义单板格数"
                  >
                  <span class="hint">× {{ settings.splitCustom || 1 }} 格（行列相同）</span>
                </div>
                <p v-if="exportLayout" class="hint">
                  将拆成 {{ exportLayout.cols }} 列 × {{ exportLayout.rows }} 行，共 {{ exportLayout.count }} 块；
                  每块最多 {{ exportLayout.boardSize.x }} × {{ exportLayout.boardSize.y }} 格。
                </p>
              </div>
            </section>

            <section class="acc" :class="{ open: acc.options }">
              <button class="accHead" type="button" :aria-expanded="acc.options" @click="toggleAcc('options')">
                <span class="accTitle">图纸选项</span>
                <span class="accValue">{{ optionsSummary }}</span>
                <i class="accArrow" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
              </button>
              <div v-show="acc.options" class="accBody">
                <div class="settings">
                  <label class="check"><input v-model="settings.ruler" type="checkbox"> 行列坐标</label>
                  <label class="check"><input v-model="settings.grid" type="checkbox"> 网格</label>
                  <label class="check"><input v-model="settings.codes" type="checkbox"> 每格色号</label>
                  <label class="check"><input v-model="settings.legend" type="checkbox"> 颜色图例</label>
                  <label class="check"><input v-model="settings.stats" type="checkbox"> 材料统计</label>
                  <label class="check"><input v-model="settings.background" type="radio" value="#ffffff"> 白色背景</label>
                  <label class="check"><input v-model="settings.background" type="radio" value="transparent"> 透明背景（JPG 铺白）</label>
                  <label class="check">
                    PDF 方向
                    <select v-model="settings.orientation">
                      <option value="portrait">A4 纵向</option>
                      <option value="landscape">A4 横向</option>
                    </select>
                  </label>
                </div>
              </div>
            </section>

            <section class="acc" :class="{ open: acc.formats }">
              <button class="accHead" type="button" :aria-expanded="acc.formats" @click="toggleAcc('formats')">
                <span class="accTitle">导出格式</span>
                <span class="accValue">{{ selectedItem ? selectedItem.label : '—' }}</span>
                <i class="accArrow" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
              </button>
              <div v-show="acc.formats" class="accBody">
                <div class="formatSelect">
                  <select v-model="selectedKey" class="deliveryFormat" data-audit="delivery-format">
                    <option v-for="item in currentItems" :key="item.key" :value="item.key">
                      {{ item.label }}{{ item.feature && !check(item.feature).ok ? '（PRO）' : '' }}
                    </option>
                  </select>
                  <i class="formatSelect__arrow" aria-hidden="true"></i>
                </div>
                <div v-if="selectedItem" class="formatNote">
                  <p class="hint">{{ selectedItem.desc }}</p>
                  <span v-if="selectedItem.feature && !check(selectedItem.feature).ok" class="tag pro">PRO</span>
                </div>
              </div>
            </section>

            <section class="acc acc--checks" :class="['is-' + checkSummary.level, { open: acc.checks }]">
              <button class="accHead" type="button" :aria-expanded="acc.checks" @click="toggleAcc('checks')">
                <i class="checkIcon"><PixelIcon :name="checkSummary.level === 'fatal' ? 'close' : checkSummary.level === 'warn' ? 'alert' : 'check'" :size="12" /></i>
                <span class="accTitle">导出前检查</span>
                <span class="accValue">{{ checkSummary.text }}</span>
                <i class="accArrow" aria-hidden="true"><PixelIcon name="chevronDown" :size="12" /></i>
              </button>
              <div v-show="acc.checks" class="accBody">
                <div class="checks" data-audit="delivery-checks">
                  <div v-for="(c, i) in checks" :key="i" class="checkLine" :class="c.level">
                    <i><PixelIcon :name="c.level === 'fatal' ? 'close' : c.level === 'warn' ? 'alert' : 'check'" :size="11" /></i>
                    <span>{{ c.text }}</span>
                  </div>
                </div>
              </div>
            </section>

            <button
              class="btn primary deliveryRun"
              :disabled="hasFatal || !selectedItem"
              data-audit="delivery-run"
              @click="selectedItem && runExport(selectedItem)"
            >导出 {{ selectedItem ? selectedItem.label : '' }}</button>

            <div v-if="status.state !== 'idle'" class="statusBar" :class="status.state" data-audit="delivery-status">
              <span>{{ status.text }}</span>
              <button v-if="status.retry" class="btn btn-secondary sm" @click="status.retry()">重试</button>
            </div>

            <p class="hint footNote">
              分板 PDF 由浏览器打印生成：文字与表格是矢量，板图按所选 DPI 渲染成高分辨率位图。
              打印时请选择「实际大小 / 100%」，不要勾选「适合页面」。
            </p>
          </template>

          <template v-else>
            <div class="buildBox">
              <div class="row row--between">
                <b>拼装进度</b>
                <b class="buildPct">{{ buildPercent }}%</b>
              </div>
              <div class="bar"><i :style="{ width: buildPercent + '%' }"></i></div>
              <p class="hint">
                <template v-if="isFinished">
                  <span class="iconInline"><PixelIcon name="check" :size="11" />完成于 {{ finishedAt ? new Date(finishedAt).toLocaleDateString() : '—' }} ·
                  共 {{ buildStats.total.toLocaleString() }} 颗豆</span>
                </template>
                <template v-else-if="nextBoard">
                  第 {{ nextBoard.no }} / {{ buildBoards.length }} 块板 · 已完成 {{ doneBoards }} 块 ·
                  本板剩 {{ nextBoard.remaining }} 颗
                </template>
                <template v-else>
                  共 {{ buildBoards.length }} 块板 · {{ buildStats.total.toLocaleString() }} 颗豆待拼
                </template>
              </p>
            </div>
            <div class="buildActions">
              <button class="btn primary" @click="isFinished ? goFinish() : goBuild()">
                <span>{{ isFinished ? '查看完成的这件作品' : (buildStats.done > 0 ? '继续拼这一板' : '开始拼这一板') }}</span>
                <PixelIcon name="arrowRight" :size="14" />
              </button>
              <button v-if="!isFinished" class="btn btn-secondary" @click="goFinish"><PixelIcon name="check" :size="13" />标记作品完成</button>
              <button class="btn soft" @click="onSave">保存作品</button>
            </div>
            <p class="hint">逐颗 / 整板进度与「标记作品完成」都已开放。</p>
          </template>
        </div>
      </div>

      <div v-else class="empty">
        <strong>还没有图纸</strong>
        <p>先上传图片或从素材库选一个，生成图纸后再来交付。</p>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
/* 交付面板：左图纸 / 右命令，整体锁在一屏内；右侧只在内容真的超高时才内部滚动。 */
.delivery{display:flex;flex-direction:column;gap:10px;height:min(76vh,720px);min-height:0}
.deliveryTabs{display:flex;gap:4px;padding:3px;background:var(--surface-3);border-radius:var(--r-sm);overflow:auto;flex:none}
.deliveryTabs button{
  flex:1;padding:9px 12px;border-radius:8px;font-size:var(--fs-2xs);font-weight:800;
  color:var(--muted);white-space:nowrap;transition:var(--t)
}
.deliveryTabs button:hover{color:var(--ink)}
.deliveryTabs button.on{background:var(--primary-soft);color:var(--ink);font-weight:800;box-shadow:none}
.deliveryMain{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:14px}
.deliveryLeft{min-height:0;display:flex;flex-direction:column;gap:8px}
.deliveryRight{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
.previewBox{
  flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px;
  border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2);overflow:hidden
}
.previewBox canvas{max-width:100%;max-height:calc(100% - 26px);width:auto;height:auto;border-radius:var(--r-sm);box-shadow:var(--sh-1);background:#fff}
.previewBox .hint{text-align:center;margin:0;flex:none}
/* 分板预览：每块板一张卡，卡头带板号 / 全局列行 / 颗数，卡底是这块板的色号图例 */
.splitPreviewList{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:0 3px 2px 0}
.splitPreviewNote{
  position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;
  padding:5px 1px;background:var(--surface);font-size:var(--fs-2xs);color:var(--muted)
}
.splitPreviewNote b{color:var(--ink)}
.boardCard{flex:none;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);overflow:hidden}
.boardCard__head{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:3px 10px;
  padding:8px 10px;border-bottom:1px solid var(--line);background:var(--surface-2)
}
.boardCard__head b{font-size:var(--fs-xs);color:var(--ink)}
.boardCard__range{font-size:var(--fs-2xs);color:var(--muted)}
.boardCard__meta{margin-left:auto;font-size:var(--fs-2xs);font-weight:800;color:var(--ink);white-space:nowrap}
/* aspect-ratio 撑住卡片高度；canvas 绝对铺满，滚出屏幕缩成 1×1 时也不会塌 */
.boardCard__img{position:relative;width:100%;background:#fff}
.boardCard__img canvas{position:absolute;inset:0;width:100%!important;height:100%!important;image-rendering:pixelated}
.boardCard__legend{
  display:flex;flex-wrap:wrap;gap:4px 10px;padding:8px 10px;border-top:1px solid var(--line);
  font-size:var(--fs-2xs);color:var(--muted);line-height:1.5
}
.boardCard__legend span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.boardCard__legend i{width:10px;height:10px;flex:none;border-radius:3px;border:1px solid rgba(28,28,32,.14)}
.deliverySummary{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 11px;flex:none;
  border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);
  font-size:var(--fs-2xs);color:var(--muted)
}
.deliverySummary b{color:var(--ink);font-size:var(--fs-xs)}
/* 折叠行：标题 / 当前值 / 品牌色圆箭头（与工作台其余折叠卡同一套） */
.acc{border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);overflow:hidden;flex:none}
.accHead{
  width:100%;min-height:44px;padding:0 10px 0 12px;display:flex;align-items:center;gap:9px;
  border:0;background:transparent;text-align:left;transition:var(--t)
}
.accHead:hover{background:var(--surface-3)}
.accHead:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.accTitle{font-size:var(--fs-2xs);font-weight:850;white-space:nowrap}
.accValue{flex:1;min-width:0;text-align:right;font-size:var(--fs-2xs);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.accArrow{
  width:24px;height:24px;flex:none;display:inline-flex;align-items:center;justify-content:center;
  border-radius:50%;background:var(--primary-soft);color:var(--primary-ink);
  font-style:normal;font-size:17px;font-weight:900;line-height:1;
  transition:transform var(--t),background var(--t),color var(--t)
}
.acc.open .accArrow{transform:rotate(180deg);background:var(--primary);color:var(--primary-ink)}
.accBody{padding:9px 12px 10px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:9px}
.splitSpecRow select{
  width:100%;padding:8px 10px;border:1px solid transparent;border-radius:var(--r-sm);
  background:var(--surface-3);color:var(--ink);font-size:var(--fs-xs)
}
.specInput{
  width:96px;padding:7px 9px;border:1px solid transparent;border-radius:var(--r-sm);
  background:var(--surface-3);color:var(--ink);font-size:var(--fs-xs)
}
.splitSpecRow select:focus,.specInput:focus,.settings select:focus,.deliveryFormat:focus{
  background:var(--surface);border-color:var(--pink);box-shadow:0 0 0 3px rgba(255,142,199,.18);outline:0
}
.dpiBtns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.dpiBtn{
  text-align:left;padding:8px;border:1.5px solid var(--line);border-radius:var(--r-sm);
  background:var(--surface);display:flex;flex-direction:column;gap:3px;transition:var(--t)
}
.dpiBtn b{font-size:var(--fs-2xs)}
.dpiBtn span{font-size:9px;color:var(--muted);line-height:1.45}
.dpiBtn:hover{border-color:#C9C9C3}
.dpiBtn.on{border-color:var(--primary);background:var(--primary-soft)}
.dpiBtn.on b{color:var(--ink)}
.settings{display:flex;flex-wrap:wrap;gap:8px 14px}
.settings .check{font-size:var(--fs-2xs);display:inline-flex;align-items:center;gap:6px}
.settings select{
  padding:5px 8px;border:1px solid transparent;border-radius:var(--r-sm);
  background:var(--surface-3);color:var(--ink);font-size:var(--fs-2xs)
}
.deliveryFormat{
  width:100%;padding:9px 10px;border:1px solid transparent;border-radius:var(--r-sm);
  background:var(--surface-3);color:var(--ink);font-size:var(--fs-xs);font-weight:700
}
/* 下拉提示：全局 select 的箭头是背景渐变，这里被背景色覆盖了，单独画一颗细箭头 */
.formatSelect{position:relative}
.formatSelect .deliveryFormat{padding-right:34px}
.formatSelect__arrow{
  position:absolute;right:13px;top:50%;width:6px;height:6px;
  border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);
  transform:translateY(-50%) rotate(45deg);pointer-events:none
}
.formatNote{display:flex;align-items:flex-start;gap:8px}
.formatNote .hint{margin:0;flex:1;font-size:var(--fs-2xs);line-height:1.55}
.deliveryRun{width:100%;min-height:46px;font-size:var(--fs-sm);font-weight:850;flex:none}
.checks{display:flex;flex-direction:column;gap:5px}
.checkLine{display:flex;gap:7px;font-size:var(--fs-2xs);line-height:1.6;padding:6px 9px;border-radius:var(--r-xs)}
.checkLine i{font-style:normal;font-weight:900;flex:0 0 auto}
.checkLine.ok{background:var(--green-soft);color:var(--green-deep)}
.checkLine.warn{background:var(--yellow-soft);color:var(--yellow-deep,#8A5A00)}
.checkLine.fatal{background:var(--danger-soft);color:var(--danger)}
.checkIcon{font-style:normal;font-weight:900;font-size:12px;flex:none}
.acc--checks.is-fatal .accValue,.acc--checks.is-fatal .checkIcon{color:var(--danger)}
.acc--checks.is-warn .accValue,.acc--checks.is-warn .checkIcon{color:var(--orange-deep,#B45309)}
.acc--checks.is-ok .accValue,.acc--checks.is-ok .checkIcon{color:var(--green-deep)}
.warnText{color:var(--orange-deep,#B45309)}
.statusBar{
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex:none;
  padding:9px 12px;border-radius:var(--r-sm);font-size:var(--fs-2xs);line-height:1.6
}
.statusBar.preparing,.statusBar.generating{background:var(--sky-soft);color:var(--sky-deep,#0B6477)}
.statusBar.success{background:var(--green-soft);color:var(--green-deep)}
.statusBar.failure{background:var(--danger-soft);color:var(--danger)}
.footNote{margin:0;line-height:1.55;font-size:var(--fs-2xs);flex:none}
.buildBox{padding:13px;border-radius:var(--r-md);background:var(--surface-2);border:1px solid var(--line)}
.buildPct{font-size:var(--fs-h3);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.buildActions{display:flex;flex-wrap:wrap;gap:8px}
@media(max-width:820px){
  .delivery{height:auto;min-height:0}
  .deliveryMain{grid-template-columns:1fr}
  .deliveryLeft{min-height:0}
  .previewBox{flex:none;height:34vh;min-height:180px}
  /* 手机上 dialog 没有固定高度：分板列表必须自己限高并滚动，
     否则 12 块板会把弹窗撑到几千像素高 */
  .splitPreviewList{flex:none;max-height:56vh;min-height:200px}
  .deliveryRight{overflow:visible;padding-right:0}
}
@media(max-width:640px){
  .dpiBtns{grid-template-columns:1fr}
  .buildActions .btn{flex:1 1 100%}
}
</style>

