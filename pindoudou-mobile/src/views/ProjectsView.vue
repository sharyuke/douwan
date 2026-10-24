<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import BaseDialog from '../components/ui/BaseDialog.vue'
import PatternPreview from '../components/ui/PatternPreview.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import {
  projects, deleteProject, duplicateProject, openProject, projectLimit,
  buildProgress, buildStats, pattern, currentProjectId, projectName, saveProject,
  unfinishProject, loadImageFromUrl, patternSignature
} from '../composables/useStudio.js'
import { fromPatternJSON, materialList, normalizeBoardSize } from '../lib/pattern.js'
import { unpackPattern, packedBeadCount } from '../lib/archive.js'
import { inventory } from '../composables/useInventory.js'
import { ALL_FREE, check } from '../composables/useMembership.js'
import { toastOk, toastWarn, toastResult } from '../composables/useToast.js'
import { timeAgo, num, formatDuration, projectCanvas } from '../lib/forge.js'
import {
  exportPatternPNG, exportMaterialsCSV, exportPatternJSON, printPattern,
  exportShareCard, copyShoppingList
} from '../lib/exporters.js'

const route = useRoute()
const router = useRouter()
const confirmDelete = ref('')
const filter = ref('all')

const detailId = computed(() => route.params.id || '')
const detail = computed(() => projects.value.find(p => p.id === detailId.value) || null)

/** 把存档里的方案还原成可渲染的 Pattern */
function hydrate(proj) {
  if (!proj) return null
  const v = (proj.variants || []).find(x => x.key === proj.activeKey) || (proj.variants || [])[0]
  if (!v) return null
  /* 走 unpackPattern 而不是 fromPatternJSON：存档现在是紧凑格式（见 lib/archive.js），
     直接喂给 fromPatternJSON 会得到一张没有格子的空图纸。 */
  const p = unpackPattern(v.data, proj.brandId)
  if (!p) return null
  return { ...p, key: v.key, label: v.label, stats: v.stats || p.stats }
}

const detailPattern = computed(() => hydrate(detail.value))

/** 每件作品的进度（PRD §66 我的作品：草稿 / 已完成 / 进度） */
function progressOf(proj) {
  const v = proj.variants && proj.variants[0]
  // 空格不用拼，所以分母是「真正要放的豆数」；
  // 老存档没有 stats.beadCount，退回数一遍 cells 里的非 null
  const total = v && v.stats && v.stats.beadCount != null
    ? v.stats.beadCount
    : packedBeadCount(v && v.data)
  /* 「已完成」以完成记录为准（finishedAt 是用户在 Build Mode 亲自点的），
     逐格推算只作为老存档的兜底 —— 否则「完成作品」这个动作就没意义了。 */
  const finished = !!proj.finishedAt
  const done = finished ? total : Math.min((proj.buildProgress || []).length, total)
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 1000) / 10 : 0,
    finished,
    finishedAt: proj.finishedAt || 0
  }
}

function isDone(proj) {
  const g = progressOf(proj)
  return g.finished || (g.total > 0 && g.done >= g.total)
}

const list = computed(() => {
  const all = projects.value.map(p => ({ ...p, prog: progressOf(p) }))
  if (filter.value === 'done') return all.filter(p => isDone(p))
  if (filter.value === 'draft') return all.filter(p => !p.prog.finished && !p.prog.done)
  if (filter.value === 'progress') return all.filter(p => !p.prog.finished && p.prog.done > 0 && p.prog.done < p.prog.total)
  return all
})

const statsSummary = computed(() => {
  const all = projects.value
  const totalBeads = all.reduce((s, p) => s + ((p.variants && p.variants[0] && p.variants[0].stats && p.variants[0].stats.beadCount) || 0), 0)
  const done = all.filter(isDone).length
  const finished = all.filter(p => !!p.finishedAt).length
  return { count: all.length, totalBeads, done, finished, limit: projectLimit() }
})

function onOpen(id) {
  if (openProject(id)) router.push(`/editor/${id}`)
}

function onDelete(id) {
  deleteProject(id)
  confirmDelete.value = ''
  if (detailId.value === id) router.push('/projects')
}

function onDuplicate(id) {
  duplicateProject(id)
}

function onExportPattern(proj) {
  const p = hydrate(proj)
  if (!p) { toastWarn('这件作品的数据不完整'); return }
  const gate = check('export.png')
  if (!gate.ok) { toastWarn(gate.reason); return }
  /* 大画布会降每格像素（见 exporters.js 的上限），实际给了多少像素要如实说出来 */
  toastResult(exportPatternPNG(p, { projectName: proj.name, cell: 22 }))
}

function onExportCSV(proj) {
  const p = hydrate(proj)
  if (!p) return
  const gate = check('export.csv')
  if (!gate.ok) { toastWarn(gate.reason); return }
  exportMaterialsCSV(p, inventory.value, proj.name)
}

function onPrint(proj) {
  const p = hydrate(proj)
  if (!p) return
  const gate = check('export.pdf')
  if (!gate.ok) { toastWarn(gate.reason); return }
  /* 页数超上限时 printPattern 压根不会开打印窗口，理由必须转达（否则表现为点了没反应） */
  toastResult(printPattern(p, { projectName: proj.name, inventoryMap: inventory.value, stats: p.stats }),
    '已打开打印窗口，选择「保存为 PDF」即可')
}

function onJSON(proj) {
  const p = hydrate(proj)
  if (!p) return
  exportPatternJSON(p, proj.name)
}

async function onShare(proj) {
  const p = hydrate(proj)
  if (!p) return
  const gate = check('export.share')
  if (!gate.ok) { toastWarn(gate.reason); return }
  let finishImage = null
  if (proj.finishPhoto) {
    try { finishImage = await loadImageFromUrl(proj.finishPhoto) } catch { finishImage = null }
  }
  exportShareCard(p, {
    projectName: proj.name,
    stats: p.stats,
    buildPercent: progressOf(proj).percent,
    finishImage
  })
}

/** 取消完成：库存退回、进度退回完成前（详见 useStudio.unfinishProject） */
function onUnfinish(id) {
  unfinishProject(id)
}

async function onCopyList(proj) {
  const p = hydrate(proj)
  if (!p) return
  const res = await copyShoppingList(p, inventory.value, proj.name)
  toastOk(res.ok ? '采购清单已复制' : '复制失败，请改用 CSV')
}

const detailMaterials = computed(() => (detailPattern.value ? materialList(detailPattern.value, inventory.value) : null))
const detailLayout = computed(() => {
  const p = detailPattern.value
  if (!p) return null
  /* 分板规格跟着图纸走（52 / 78 / 104 / 120 钉画线板，整张图纸一种规格）；老图纸没有该字段时按画布推导 */
  const bs = normalizeBoardSize(p.boardSize, p.width, p.height)
  return { cols: Math.ceil(p.width / bs.x), rows: Math.ceil(p.height / bs.y) }
})
/** 详情页的画布尺寸：老存档按块数换算，见 forge.js 的 projectCanvas */
const detailCanvas = computed(() => projectCanvas(detail.value || {}))

/** 完成之后图纸又被改过：完成记录说的已经不是这张图纸了，如实标出来 */
const detailStale = computed(() => {
  const proj = detail.value
  const p = detailPattern.value
  if (!proj || !proj.finishedAt || !p) return false
  const saved = proj.finishSignature || ''
  return !!saved && saved !== patternSignature(p)
})
</script>

<template>
  <div class="wrap main--pad">
    <!-- 作品详情 -->
    <template v-if="detail">
      <div class="crumb">
        <RouterLink to="/projects">我的作品</RouterLink><span>/</span><b>{{ detail.name }}</b>
      </div>

      <div class="pagehead">
        <div>
          <h1>{{ detail.name }}</h1>
          <p>
            更新于 {{ timeAgo(detail.updatedAt) }} ·
            {{ detailCanvas.w }} × {{ detailCanvas.h }} 格 ·
            {{ (detail.variants || []).length }} 个方案 ·
            {{ detailLayout ? detailLayout.cols + '×' + detailLayout.rows + ' 块底板' : '' }}
          </p>
        </div>
        <div class="row row--wrap">
          <button class="btn primary" @click="onOpen(detail.id)">打开工作台</button>
          <RouterLink class="btn green" :to="detail.finishedAt ? `/build/${detail.id}` : `/build/${detail.id}?finish=1`">
            {{ detail.finishedAt ? '完成记录' : '去完成' }}
          </RouterLink>
          <RouterLink class="btn btn-secondary" :to="`/materials/${detail.id}`">材料与分板</RouterLink>
        </div>
      </div>

      <div class="detailGrid">
        <div class="card">
          <div class="card__head"><h3>图案预览</h3><span class="muted">{{ detailPattern ? detailPattern.label : '' }}</span></div>
          <div class="card__body previewBody">
            <PatternPreview :pattern="detailPattern" :max-size="520" />
          </div>
        </div>

        <div class="col">
          <div class="card">
            <div class="card__head"><h3>作品数据</h3><span class="muted">{{ detailPattern ? detailPattern.label : '' }}</span></div>
            <div class="card__body">
              <div v-if="detailPattern" class="stats">
                <div class="stat tone-3"><b>{{ detailPattern.width }}×{{ detailPattern.height }}</b><span>格数</span></div>
                <div class="stat tone-1"><b>{{ num(detailPattern.stats.beadCount) }}</b><span>总豆数</span></div>
                <div class="stat tone-2"><b>{{ detailPattern.stats.colorCount }}</b><span>颜色数</span></div>
                <div class="stat tone-4"><b>{{ Math.round((detailPattern.stats.similarity || 0) * 100) }}%</b><span>还原度</span></div>
              </div>
              <div class="boardInfo" style="margin-top:12px">
                可拼性 {{ Math.round((detailPattern?.stats.buildability || 0) * 100) }} ·
                孤立豆 {{ detailPattern?.stats.isolatedCount || 0 }} 颗 ·
                预计 {{ formatDuration(detailPattern?.stats.estimatedMinutes) }}
              </div>
              <div class="divider"></div>
              <div class="row row--between">
                <b style="font-size:var(--fs-xs)">拼制进度</b>
                <span class="muted">{{ progressOf(detail).done }} / {{ progressOf(detail).total }} 颗（{{ progressOf(detail).percent }}%）</span>
              </div>
              <div class="meter" style="margin-top:8px"><i :style="{ width: progressOf(detail).percent + '%' }"></i></div>
            </div>
          </div>

          <div class="card">
            <div class="card__head"><h3>导出</h3><span class="muted">与当前数据一致</span></div>
            <div class="card__body">
              <div class="grid-2">
                <button class="btn btn-secondary" @click="onExportPattern(detail)">图纸 PNG</button>
                <button class="btn btn-secondary" @click="onPrint(detail)">分板 PDF</button>
                <button class="btn btn-secondary" @click="onExportCSV(detail)">材料 CSV</button>
                <button class="btn btn-secondary" @click="onJSON(detail)">Pattern JSON</button>
                <button class="btn btn-secondary" @click="onShare(detail)">分享卡</button>
                <button class="btn btn-secondary" @click="onCopyList(detail)">复制采购清单</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__head">
              <h3>完成</h3>
              <span class="muted">{{ detail.finishedAt ? '已记录' : '还没完成' }}</span>
            </div>
            <div class="card__body stack stack--sm">
              <template v-if="detail.finishedAt">
                <div class="okBox" style="display:flex;align-items:center;gap:6px">
                  <PixelIcon name="check" :size="16" />
                  <span>
                    完成于 {{ timeAgo(detail.finishedAt) }} ·
                    用豆 {{ num(detail.completedBeads || progressOf(detail).total) }} 颗
                  </span>
                </div>
                <p v-if="detailStale" class="hint staleHint">
                  <PixelIcon name="alert" :size="16" />
                  <span>完成之后图纸又改过，这份完成记录对应的不是当前图纸。想让它们对上：取消完成之后再重新完成一次。</span>
                </p>
                <div v-if="detail.finishPhoto" class="finishPhotoBox">
                  <img :src="detail.finishPhoto" alt="成品照片">
                </div>
                <p v-else class="hint">还没有成品照片，去完成记录里传一张，分享卡第三格就会用它。</p>
                <div class="grid-2">
                  <RouterLink class="btn primary" :to="`/build/${detail.id}`">完成记录 / 换照片</RouterLink>
                  <button class="btn btn-secondary" @click="onUnfinish(detail.id)">取消完成</button>
                </div>
                <p class="hint">
                  取消完成会把扣掉的豆原样加回「我的库存」，并把拼制进度退回完成前的样子。
                </p>
              </template>
              <template v-else>
                <p class="hint">
                  拼完之后在 Build Mode 点「我拼完了 · 完成作品」：记录完成时间、
                  按材料表扣减库存、写进成长记录，作品会出现在「已完成」里。
                </p>
                <RouterLink class="btn primary block" :to="`/build/${detail.id}?finish=1`">
                  <PixelIcon name="check" :size="16" /> 标记为已完成
                </RouterLink>
              </template>
            </div>
          </div>

          <div class="card">
            <div class="card__body row row--between row--wrap">
              <button class="btn btn-secondary" @click="onDuplicate(detail.id)">复制一份</button>
              <button class="btn danger" @click="confirmDelete = detail.id">删除作品</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 作品列表 -->
    <template v-else>
      <div class="pagehead">
        <div>
          <h1>我的作品</h1>
          <p>
            共 {{ statsSummary.count }} 件 · 累计设计 {{ num(statsSummary.totalBeads) }} 颗豆 ·
            已完成 {{ statsSummary.finished }} 件（拼满进度的 {{ statsSummary.done }} 件）。
            作品保存在本机浏览器，刷新和重启都还在。
          </p>
        </div>
        <RouterLink to="/editor" class="btn primary">＋ 新建作品</RouterLink>
      </div>

      <div class="tabs" style="margin-bottom:16px">
        <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部 {{ projects.length }}</button>
        <button :class="{ on: filter === 'progress' }" @click="filter = 'progress'">进行中</button>
        <button :class="{ on: filter === 'draft' }" @click="filter = 'draft'">未开始</button>
        <button :class="{ on: filter === 'done' }" @click="filter = 'done'">已完成 {{ statsSummary.done }}</button>
      </div>

      <div v-if="!projects.length" class="empty">
        <div class="empty__icon"><PixelIcon name="folder" :size="24" /></div>
        <strong>还没有作品</strong>
        <p>生成图纸后在右上角点「保存」，或在工作台右侧点「保存作品」。</p>
        <div class="row" style="gap:9px">
          <RouterLink to="/editor" class="btn primary">上传照片开始</RouterLink>
          <RouterLink to="/library" class="btn btn-secondary">逛素材库</RouterLink>
        </div>
      </div>

      <div v-else-if="!list.length" class="empty">
        <div class="empty__icon"><PixelIcon name="folder" :size="24" /></div>
        <strong>这个筛选下没有作品</strong>
        <button class="btn btn-secondary" @click="filter = 'all'">看全部</button>
      </div>

      <div v-else class="projectGrid">
        <div v-for="p in list" :key="p.id" class="projectCard">
          <RouterLink :to="`/projects/${p.id}`" class="projectCard__thumb">
            <img v-if="p.thumbnail" :src="p.thumbnail" :alt="p.name">
            <span v-else class="muted">无预览</span>
          </RouterLink>
          <div class="projectCard__body">
            <b :title="p.name">{{ p.name }}</b>
            <div class="projectCard__meta">
              <span>{{ projectCanvas(p).w }}×{{ projectCanvas(p).h }}</span>
              <span>{{ (p.variants && p.variants.length) || 0 }} 方案</span>
              <span>{{ timeAgo(p.updatedAt) }}</span>
            </div>
            <div v-if="p.prog.total" class="projectCard__prog" :title="`已完成 ${p.prog.percent}%`">
              <i :style="{ width: p.prog.percent + '%' }"></i>
            </div>
            <div v-if="p.prog.finished" class="cardDone">
              <PixelIcon name="check" :size="14" /> 已完成 · {{ timeAgo(p.prog.finishedAt) }}
            </div>
            <div v-else-if="p.prog.total" class="hint">
              {{ p.prog.done >= p.prog.total ? '进度 100%，还没标记完成' : `进度 ${p.prog.percent}%` }}
            </div>
          </div>
          <div class="projectCard__foot">
            <button class="btn btn-secondary sm" @click="onOpen(p.id)">编辑</button>
            <RouterLink class="btn btn-secondary sm" :to="p.prog.finished ? `/build/${p.id}` : `/build/${p.id}?finish=1`">
              {{ p.prog.finished ? '完成记录' : '开拼' }}
            </RouterLink>
            <button class="btn sm ghost" title="复制" @click="onDuplicate(p.id)">⧉</button>
            <button class="btn sm danger" title="删除" @click="confirmDelete = p.id">删除</button>
          </div>
        </div>
      </div>

      <p class="hint" style="margin-top:22px">
        {{ ALL_FREE ? '最多保存' : '当前套餐最多保存' }} {{ statsSummary.limit }} 件作品。
      </p>
    </template>

    <BaseDialog :model-value="!!confirmDelete" title="确认删除" size="sm" @update:model-value="confirmDelete = ''">
      <p style="font-size:var(--fs-sm);line-height:1.8">删除后无法恢复，作品数据和拼制进度都会一起删掉。</p>
      <template #footer="{ close }">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button class="btn danger" @click="onDelete(confirmDelete)">确认删除</button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.crumb{display:flex;align-items:center;gap:8px;font-size:var(--fs-xs);color:var(--muted);margin-bottom:14px}
.crumb b{color:var(--ink)}
.detailGrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
.previewBody{display:grid;place-items:center;min-height:380px;background:var(--surface-2)}
.projectCard__thumb{display:grid;place-items:center}
.projectCard__thumb img{max-width:100%;max-height:100%;image-rendering:pixelated}
/* 已完成的作品在列表里要有明确的记号：它是成长记录与徽章的唯一依据 */
.cardDone{display:flex;align-items:center;gap:4px;font-size:var(--fs-2xs);font-weight:800;color:var(--green-deep)}
.staleHint{display:flex;align-items:flex-start;gap:6px;color:var(--orange-deep);font-weight:700}
/* 作品详情页里的成品照片 */
.finishPhotoBox{border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;background:var(--surface-2)}
.finishPhotoBox img{display:block;width:100%;max-height:320px;object-fit:cover}
.boardInfo{padding:11px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-2xs);color:var(--muted);line-height:1.7}
@media(max-width:1000px){.detailGrid{grid-template-columns:1fr}}
</style>
