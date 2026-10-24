<script setup>
/* =========================================================================
   后台 · 素材库管理（对应后端 /api/v1/admin/assets 与 /admin/asset-categories）
   目标（后台需求 §8）：运营不改代码就能持续上传与维护前台素材库。
   - 素材列表：筛选 / 排序 / 分页 / 批量排序，筛选条件同步到地址栏
   - 上传素材：拖拽 + 点选、多张、本地预览、客户端先校验、进度条、逐条错误
   - 编辑素材、上下架（下架归档必须填原因）、删除（软删除，需先下架）
   - 分类管理单独一个标签页：有素材引用时后端拒绝删除，引导迁移或停用
   - 所有写操作都用 can('asset.manage') 控制 disabled，并给出不能点的原因
   ========================================================================= */

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AdminTable from '../../components/admin/AdminTable.vue'
import AdminPager from '../../components/admin/AdminPager.vue'
import AdminModal from '../../components/admin/AdminModal.vue'
import AdminTag from '../../components/admin/AdminTag.vue'

import { assetApi } from '../../lib/adminApi.js'
import { ApiError, datetime, fileSize, syncQuery } from '../../lib/api.js'
import { can, denyReason } from '../../composables/useAdminAuth.js'
import { confirmAction } from '../../composables/useAdminConfirm.js'
import { run, assetStatus, toInt } from '../../composables/useAdminKit.js'
import { toastOk, toastWarn, toastErr } from '../../composables/useToast.js'
import { DIFFICULTY_OPTIONS, LIBRARY_CATEGORIES, PURPOSE_OPTIONS } from '../../data/libraryCategories.js'

/* ------------------------------------------------------------------ 常量 */

/** 服务端会按文件内容再校验一次真实类型，这里先按扩展名 / MIME 拦一道 */
const ACCEPT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const ACCEPT_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif']
const MAX_SIZE = 10 * 1024 * 1024

const MANAGE = 'asset.manage'

const SORT_OPTIONS = [
  { value: 'sort_order', label: '排序值' },
  { value: 'created_at', label: '上传时间' },
  { value: 'updated_at', label: '更新时间' },
  { value: 'title', label: '素材名称' }
]

const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已下架' }
]

const TIER_OPTIONS = [
  { value: 'free', label: '免费（free）' },
  { value: 'pro', label: '会员（pro）' }
]

/* 上传 / 编辑表单的分类选项必须与前台素材库一致：
   只列启用的前台一级分类，顺序按导航顺序；已停用的旧分类只留在筛选里。
   二级分类、难度、用途都靠标签，下面给出一份与前台同源的标签建议。 */
const FRONTEND_CATEGORIES = LIBRARY_CATEGORIES.filter(c => c.key !== 'all')
const FRONTEND_CATEGORY_ORDER = new Map(FRONTEND_CATEGORIES.map((c, i) => [c.key, i]))
const FRONTEND_CATEGORY_NAME = Object.fromEntries(FRONTEND_CATEGORIES.map(c => [c.key, c.name]))
const FRONTEND_TAG_SUGGESTIONS = [...new Set([
  ...FRONTEND_CATEGORIES.flatMap(c => c.children),
  ...DIFFICULTY_OPTIONS.filter(o => o.value !== 'all').map(o => o.label),
  ...PURPOSE_OPTIONS.filter(o => o.value !== 'all').map(o => o.label)
])]

function normalizeCategoryOptions(cats) {
  return (Array.isArray(cats) ? cats : [])
    .map(c => ({
      ...c,
      name: FRONTEND_CATEGORY_NAME[c.slug] || c.name,
      enabled: Number(c.status) !== 0,
      frontendRank: FRONTEND_CATEGORY_ORDER.has(c.slug) ? FRONTEND_CATEGORY_ORDER.get(c.slug) : 999
    }))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      if (a.frontendRank !== b.frontendRank) return a.frontendRank - b.frontendRank
      return (Number(b.sort_order) || 0) - (Number(a.sort_order) || 0)
    })
}

/** 缩略图加载失败时的占位（内联 SVG，不引外部资源） */
const THUMB_PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
      '<rect width="120" height="120" fill="#eef1f5"/>' +
      '<text x="60" y="66" font-size="14" text-anchor="middle" fill="#9aa6b5">无图</text>' +
      '</svg>'
  )

/** 分类状态后端是 int8：0 停用 / 1 启用（不是 'enabled' / 'disabled' 字符串） */
const CATEGORY_STATUS = {
  1: { text: '已启用', kind: 'ok' },
  0: { text: '已停用', kind: 'muted' }
}
function categoryStatus(status) {
  const key = Number(status)
  return CATEGORY_STATUS[key] || { text: '—', kind: 'muted' }
}

/** 分类状态下拉的选项，value 必须是数字 1 / 0 */
const CATEGORY_STATUS_OPTIONS = [
  { value: '1', label: '已启用' },
  { value: '0', label: '已停用' }
]

/* ------------------------------------------------------------------ 状态 */

const route = useRoute()
const router = useRouter()

const tab = ref(route.query.tab === 'category' ? 'category' : 'asset')

const list = reactive({ rows: [], total: 0, loading: false })
const page = ref(1)
const pageSize = ref(20)

const filters = reactive({
  keyword: '',
  category_id: '',
  tag: '',
  status: '',
  featured: '',
  tier: '',
  created_from: '',
  created_to: ''
})
const sortField = ref('sort_order')
const sortOrder = ref('desc')

const rows = computed(() => list.rows)

const categoryOptions = ref([])
const tagOptions = ref([])
/* 上传 / 编辑只列启用的前台分类；筛选下拉保留已停用分类，方便查历史素材 */
const uploadCategoryOptions = computed(() => categoryOptions.value.filter(c => c.enabled))

const selected = ref([])
const allChecked = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length)
/* 批量修改：空字符串 = 这一项不改（与后端的「只改传了的字段」对应） */
const batch = reactive({
  category_id: '',
  status: '',
  tier: '',
  is_featured: '',
  sort_order: '',
  tags_mode: '',
  tags: '',
  reason: '',
  loading: false
})

const BATCH_TAG_MODES = [
  { value: 'add', label: '追加标签' },
  { value: 'remove', label: '移除标签' },
  { value: 'replace', label: '替换标签' }
]

const batchHasChange = computed(() => ['category_id', 'status', 'tier', 'is_featured', 'sort_order', 'tags_mode']
  .some(k => batch[k] !== ''))

/** 状态改成草稿 / 下架时，原因会写进 archived_reason，给运营一个填写框 */
const batchNeedsReason = computed(() => batch.status === 'draft' || batch.status === 'archived')

/** 一句话预览这次会改什么，避免「点了应用才发现改错了」 */
const batchSummary = computed(() => {
  const parts = []
  if (batch.category_id !== '') {
    const c = categoryOptions.value.find(x => String(x.id) === String(batch.category_id))
    parts.push(`分类→${c ? c.name : batch.category_id}`)
  }
  if (batch.status !== '') parts.push(`状态→${(STATUS_OPTIONS.find(o => o.value === batch.status) || {}).label || batch.status}`)
  if (batch.tier !== '') parts.push(`分层→${batch.tier}`)
  if (batch.is_featured !== '') parts.push(batch.is_featured === 'true' ? '设为推荐' : '取消推荐')
  if (batch.sort_order !== '') parts.push(`排序值→${toInt(batch.sort_order, 0)}`)
  if (batch.tags_mode !== '') {
    const mode = (BATCH_TAG_MODES.find(o => o.value === batch.tags_mode) || {}).label || batch.tags_mode
    const tags = parseBatchTags(batch.tags)
    parts.push(tags.length ? `${mode}「${tags.join('、')}」` : `${mode}（清空）`)
  }
  return parts.join(' · ')
})

function parseBatchTags(text) {
  return String(text || '')
    .split(/[,，、\n]/)
    .map(t => t.trim())
    .filter(Boolean)
}

function resetBatch() {
  batch.category_id = ''
  batch.status = ''
  batch.tier = ''
  batch.is_featured = ''
  batch.sort_order = ''
  batch.tags_mode = ''
  batch.tags = ''
  batch.reason = ''
}

/* ------------------------------------------------------------------ 列定义 */

const columns = [
  { key: 'checked', label: '', width: '38px' },
  { key: 'thumbnail_url', label: '缩略图', width: '72px' },
  { key: 'title', label: '素材名称' },
  { key: 'slug', label: '标识', width: '96px' },
  { key: 'category_id', label: '分类', width: '92px' },
  { key: 'tags', label: '标签', width: '150px' },
  { key: 'is_featured', label: '推荐', width: '66px', align: 'right' },
  { key: 'sort_order', label: '排序值', width: '82px', align: 'right' },
  { key: 'status', label: '状态', width: '86px' },
  { key: 'tier', label: '分层', width: '72px' },
  { key: 'created_at', label: '上传时间', width: '140px', nowrap: true },
  { key: 'updated_at', label: '更新时间', width: '140px', nowrap: true },
  { key: 'actions', label: '操作', width: '230px' }
]

const categoryColumns = [
  { key: 'name', label: '分类名称' },
  { key: 'slug', label: '标识', width: '120px' },
  { key: 'description', label: '描述' },
  { key: 'asset_count', label: '素材数量', width: '88px', align: 'right' },
  { key: 'sort_order', label: '排序值', width: '82px', align: 'right' },
  { key: 'status', label: '状态', width: '86px' },
  { key: 'actions', label: '操作', width: '150px' }
]

/* ------------------------------------------------------------------ 小工具 */

function assetTagList(row) {
  return Array.isArray(row.tags) ? row.tags : []
}

function categoryName(row) {
  return row.category_name || '—'
}

function onThumbError(e) {
  const img = e && e.target
  if (!img || typeof img.src !== 'string') return
  if (img.src !== THUMB_PLACEHOLDER) img.src = THUMB_PLACEHOLDER
}

/** 状态文案优先用后端的 status_text；状态变更时间按状态取 published_at / archived_at */
function statusTime(row) {
  if (row.status === 'published') return datetime(row.published_at)
  if (row.status === 'archived') return datetime(row.archived_at)
  return datetime(row.updated_at)
}

function statusTitle(row) {
  const info = assetStatus(row.status)
  const d = statusTime(row)
  const text = row.status_text || info.text
  return d === '—' ? text : `${text} · 最近变更 ${d}`
}

function canDelete(row) {
  return row.status !== 'published'
}

function isDenied(error) {
  return error instanceof ApiError && (error.code === 20403 || error.forbidden)
}

function errMsg(e) {
  return e instanceof ApiError ? e.message : '操作失败，请重试'
}

/* ------------------------------------------------------------------ 标签页 / 地址栏 */

function switchTab(next) {
  if (tab.value === next) return
  tab.value = next
  syncQuery(router, route, { tab: next === 'category' ? 'category' : '' })
  if (next === 'category') loadCategories()
}

/** 分类表为空时从上传弹窗直接去新建：先关弹窗，再切到「分类」并打开新建表单 */
function goCreateCategory() {
  uploadOpen.value = false
  switchTab('category')
  openCreateCategory()
}

/** 把当前筛选与排序写回地址栏（刷新后不丢） */
function pushQuery() {
  syncQuery(router, route, {
    tab: tab.value === 'category' ? 'category' : '',
    keyword: filters.keyword,
    category_id: filters.category_id,
    tag: filters.tag,
    status: filters.status,
    featured: filters.featured,
    tier: filters.tier,
    created_from: filters.created_from,
    created_to: filters.created_to,
    sort: sortField.value,
    order: sortOrder.value,
    page: page.value > 1 ? String(page.value) : '',
    page_size: pageSize.value !== 20 ? String(pageSize.value) : ''
  })
}

function initFromQuery() {
  const q = route.query
  const s = v => (typeof v === 'string' ? v : '')
  filters.keyword = s(q.keyword)
  filters.category_id = s(q.category_id)
  filters.tag = s(q.tag)
  filters.status = s(q.status)
  // featured 后端只认 true / false，其它值一律当「不筛选」
  filters.featured = s(q.featured) === 'true' ? 'true' : (s(q.featured) === 'false' ? 'false' : '')
  filters.tier = s(q.tier)
  filters.created_from = s(q.created_from)
  filters.created_to = s(q.created_to)
  if (SORT_OPTIONS.some(o => o.value === q.sort)) sortField.value = String(q.sort)
  if (q.order === 'asc' || q.order === 'desc') sortOrder.value = String(q.order)
  const p = toInt(q.page, 1)
  page.value = p > 0 ? p : 1
  const ps = toInt(q.page_size, 20)
  pageSize.value = [10, 20, 50, 100].includes(ps) ? ps : 20
}

// 筛选变化就同步地址栏；翻页 / 排序由 reload 自己写一次
watch(filters, () => pushQuery())

/* ------------------------------------------------------------------ 列表加载 */

async function reload(toPage = page.value) {
  page.value = toPage
  list.loading = true
  try {
    // 参数名与后端 dto.AssetListQuery 的 form tag 一一对应
    const data = await assetApi.list({
      keyword: filters.keyword,
      category_id: filters.category_id,
      tag: filters.tag,
      status: filters.status,
      featured: filters.featured,
      tier: filters.tier,
      created_from: filters.created_from,
      created_to: filters.created_to,
      sort: sortField.value,
      order: sortOrder.value,
      page: page.value,
      page_size: pageSize.value
    })
    list.rows = (data && data.list) || []
    list.total = (data && data.total) || 0
    selected.value = []
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '加载失败，请重试')
    list.rows = []
    list.total = 0
    selected.value = []
  } finally {
    list.loading = false
    pushQuery()
  }
}

/** 分类下拉数据来自 /admin/asset-categories/options（裸数组），标签来自 /admin/assets/tags（字符串数组） */
async function loadOptions() {
  const result = await run(async () => {
    const [cats, tags] = await Promise.all([assetApi.categoryOptions(), assetApi.tags()])
    return { cats, tags }
  })
  if (!result) return
  categoryOptions.value = normalizeCategoryOptions(result.cats)
  tagOptions.value = Array.isArray(result.tags) ? result.tags : []
}

function resetFilters() {
  filters.keyword = ''
  filters.category_id = ''
  filters.tag = ''
  filters.status = ''
  filters.featured = ''
  filters.tier = ''
  filters.created_from = ''
  filters.created_to = ''
  sortField.value = 'sort_order'
  sortOrder.value = 'desc'
  reload(1)
}

/** 当前排序的中文说明，给筛选区与表头提示用 */
const sortText = computed(() => {
  const option = SORT_OPTIONS.find(o => o.value === sortField.value)
  const name = option ? option.label : sortField.value
  return `${name} ${sortOrder.value === 'desc' ? '从大到小' : '从小到大'}`
})

/* ------------------------------------------------------------------ 素材：选择 */

function isSelected(row) {
  return selected.value.some(r => r.id === row.id)
}

function toggleRow(row) {
  if (isSelected(row)) selected.value = selected.value.filter(r => r.id !== row.id)
  else selected.value = [...selected.value, row]
}

function toggleAll() {
  selected.value = allChecked.value ? [] : rows.value.slice()
}

function clearSelection() {
  selected.value = []
}

/* ------------------------------------------------------------------ 素材：上传 */

const uploadOpen = ref(false)
const fileInput = ref(null)
const dragOver = ref(false)
const pending = ref([])
const uploadLocked = ref(false)
const uploadBusy = ref(false)
const progress = ref(0)
const uploadErrors = ref([])
const uploadDone = reactive({ total: 0, success: 0, failed: 0 })
let uploadController = null

const uploadForm = reactive({
  title: '',
  slug: '',
  category_id: '',
  tags: [],
  description: '',
  is_featured: false,
  sort_order: 0,
  status: 'draft',
  tier: 'free',
  source_note: '',
  rights_note: '',
  inner_note: ''
})

function openUpload() {
  uploadOpen.value = true
  uploadErrors.value = []
  uploadDone.total = 0
  uploadDone.success = 0
  uploadDone.failed = 0
}

/** 关闭弹窗：释放本地预览 URL。表单文本故意保留，失败后可以接着改。 */
function closeUpload() {
  releasePending()
  if (uploadController) {
    uploadController.abort()
    uploadController = null
  }
  uploadLocked.value = false
  dragOver.value = false
}

function releasePending() {
  for (const item of pending.value) URL.revokeObjectURL(item.url)
  pending.value = []
}

function onDragOver() {
  if (uploadLocked.value) return
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

function onDrop(e) {
  dragOver.value = false
  if (uploadLocked.value) {
    toastWarn('正在上传中，请等这一批传完再换图片')
    return
  }
  pickFiles(e.dataTransfer && e.dataTransfer.files)
}

function pickFiles(fileList) {
  if (uploadLocked.value) {
    toastWarn('正在上传中，请等这一批传完再换图片')
    return
  }
  const files = Array.from(fileList || [])
  if (!files.length) return

  releasePending()
  const accepted = []
  const rejected = []

  for (const file of files) {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ACCEPT_MIME.includes(file.type) && !ACCEPT_EXT.includes(ext)) {
      rejected.push(`${file.name}：格式不支持（只收 JPG / PNG / WEBP / GIF，SVG 不支持）`)
      continue
    }
    if (file.size > MAX_SIZE) {
      rejected.push(`${file.name}：${fileSize(file.size)} 超过单张 10 MB 上限`)
      continue
    }
    accepted.push(file)
  }

  if (rejected.length) {
    const head = `有 ${rejected.length} 张图片没有通过本地校验，已跳过：`
    const shown = rejected.slice(0, 3)
    const more = rejected.length > shown.length ? `；另有 ${rejected.length - shown.length} 张原因类似` : ''
    toastWarn(head + shown.join('；') + more)
  }

  pending.value = accepted.map(file => ({
    file,
    name: file.name,
    size: file.size,
    url: URL.createObjectURL(file),
    /* 逐张名称默认取文件名（去掉扩展名），批量上传时可以直接在这里改 */
    title: file.name.replace(/\.[^.]+$/, '')
  }))
  uploadErrors.value = []
}

function removePending(index) {
  const item = pending.value[index]
  if (item) URL.revokeObjectURL(item.url)
  pending.value = pending.value.filter((_, i) => i !== index)
}

/** 点选文件后：清空原生 input 的值，保证同一张图再选一次也会触发 change */
function onFileChange(e) {
  pickFiles(e && e.target ? e.target.files : null)
  if (e && e.target) e.target.value = ''
}

function cancelUpload() {
  if (uploadController) uploadController.abort()
}

/** 表单字段名与后端 handler.Upload 读取的 PostForm 名一致 */
function buildUploadFields() {
  const fields = {
    category_id: uploadForm.category_id,
    description: uploadForm.description,
    is_featured: !!uploadForm.is_featured,
    sort_order: toInt(uploadForm.sort_order, 0),
    status: uploadForm.status,
    tier: uploadForm.tier,
    source_note: uploadForm.source_note,
    rights_note: uploadForm.rights_note,
    inner_note: uploadForm.inner_note
  }
  const sharedTitle = uploadForm.title.trim()
  if (sharedTitle) fields.title = sharedTitle
  if (uploadForm.slug) fields.slug = uploadForm.slug
  const tags = cleanTags(uploadForm.tags)
  if (tags.length) fields.tags = tags
  /* 没填统一名称时，逐张名称随文件一起提交（titles 与 files 同序）。
     批量上传 19 张不同名字的素材，不用一张一张传。 */
  if (!sharedTitle && pending.value.length) {
    fields.titles = pending.value.map(item => String(item.title || '').trim())
  }
  return fields
}

function cleanTags(tags) {
  return (tags || []).map(t => String(t).trim()).filter(Boolean)
}

async function submitUpload() {
  if (!can(MANAGE)) {
    toastWarn(denyReason(MANAGE))
    return
  }
  if (!pending.value.length) {
    toastWarn('请先选择要上传的图片（支持拖拽或点击选择，可多选）')
    return
  }
  if (!uploadForm.category_id) {
    toastWarn('请选择素材分类，分类用于前台「素材库」的一级归类')
    return
  }

  uploadBusy.value = true
  uploadLocked.value = true
  uploadErrors.value = []
  progress.value = 0
  uploadDone.total = pending.value.length
  uploadDone.success = 0
  uploadDone.failed = 0
  uploadController = new AbortController()

  const files = pending.value.map(item => item.file)
  try {
    const res = await assetApi.upload(
      files,
      buildUploadFields(),
      p => { progress.value = p },
      uploadController.signal
    )
    const data = res || {}
    const success = Number(data.success || 0)
    const failed = Number(data.failed || 0)
    uploadDone.total = Number(data.total || files.length)
    uploadDone.success = success
    uploadDone.failed = failed
    uploadErrors.value = Array.isArray(data.errors) ? data.errors : []

    if (failed === 0) {
      if (uploadForm.status === 'draft') {
        toastWarn(`上传完成：成功 ${success} 张，已存为草稿（前台不可见）；在列表里点「发布」后才会出现在素材库`)
      } else {
        toastOk(`上传完成：成功 ${success} 张`)
      }
      releasePending()
      uploadLocked.value = false
      progress.value = 0
      uploadOpen.value = false
      await reload(1)
    } else {
      toastWarn(`上传结束：成功 ${success} 张，失败 ${failed} 张，失败原因见弹窗列表`)
      // 保留表单内容（需求：失败时保留已填内容，方便直接重试）
      if (success > 0) await reload(1)
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      toastWarn('上传已取消')
    } else {
      toastErr(errMsg(e))
    }
  } finally {
    uploadBusy.value = false
    uploadController = null
  }
}

/* ------------------------------------------------------------------ 素材：编辑 */

const editOpen = ref(false)
const editLoading = ref(false)
const editSaving = ref(false)
const editForm = reactive({
  id: 0,
  title: '',
  slug: '',
  category_id: '',
  tags: [],
  description: '',
  thumbnail_url: '',
  is_featured: false,
  sort_order: 0,
  bead_cols: 0,
  bead_rows: 0,
  like_count: 0,
  status: 'draft',
  tier: 'free',
  source_note: '',
  rights_note: '',
  inner_note: ''
})
const editOriginal = ref('')

/* 编辑历史素材时，如果它挂在已停用的旧分类上，仍要能看见当前值 */
const editCategoryOptions = computed(() => {
  const list = uploadCategoryOptions.value.slice()
  if (editForm.category_id && !list.some(c => String(c.id) === String(editForm.category_id))) {
    const cur = categoryOptions.value.find(c => String(c.id) === String(editForm.category_id))
    if (cur) list.unshift({ ...cur, name: `${cur.name}（已停用）` })
  }
  return list
})

async function openEdit(row) {
  editOpen.value = true
  editLoading.value = true
  editOriginal.value = ''
  Object.assign(editForm, {
    id: row.id,
    title: row.title || '',
    slug: row.slug || '',
    category_id: row.category_id ?? '',
    tags: assetTagList(row).slice(),
    description: row.description || '',
    thumbnail_url: row.thumbnail_url || '',
    is_featured: !!row.is_featured,
    sort_order: toInt(row.sort_order, 0),
    bead_cols: toInt(row.bead_cols, 0),
    bead_rows: toInt(row.bead_rows, 0),
    like_count: toInt(row.like_count, 0),
    status: row.status || 'draft',
    tier: row.tier || 'free',
    source_note: row.source_note || '',
    rights_note: row.rights_note || '',
    inner_note: row.inner_note || ''
  })
  editOriginal.value = row.image_url || ''

  const detail = await run(() => assetApi.detail(row.id))
  if (detail) {
    const d = detail.asset || detail
    Object.assign(editForm, {
      title: d.title ?? editForm.title,
      slug: d.slug ?? editForm.slug,
      category_id: d.category_id ?? editForm.category_id,
      tags: Array.isArray(d.tags) ? d.tags.slice() : editForm.tags,
      description: d.description ?? editForm.description,
      thumbnail_url: d.thumbnail_url ?? editForm.thumbnail_url,
      is_featured: d.is_featured === undefined ? editForm.is_featured : !!d.is_featured,
      sort_order: d.sort_order === undefined ? editForm.sort_order : toInt(d.sort_order, 0),
      bead_cols: d.bead_cols === undefined ? editForm.bead_cols : toInt(d.bead_cols, 0),
      bead_rows: d.bead_rows === undefined ? editForm.bead_rows : toInt(d.bead_rows, 0),
      like_count: d.like_count === undefined ? editForm.like_count : toInt(d.like_count, 0),
      status: d.status ?? editForm.status,
      tier: d.tier ?? editForm.tier,
      source_note: d.source_note ?? editForm.source_note,
      rights_note: d.rights_note ?? editForm.rights_note,
      inner_note: d.inner_note ?? editForm.inner_note
    })
    editOriginal.value = d.image_url || editOriginal.value
  } else {
    // 详情拿不到时，至少保证标签是可增删的数组
    editForm.tags = assetTagList(editForm).slice()
  }
  editLoading.value = false
}

async function saveEdit() {
  if (!can(MANAGE)) {
    toastWarn(denyReason(MANAGE))
    return
  }
  if (!editForm.title.trim()) {
    toastWarn('素材名称不能为空，名称会显示在前台素材库里')
    return
  }
  if (!editForm.category_id) {
    toastWarn('请选择素材分类')
    return
  }
  if (editForm.thumbnail_url && !/^https?:\/\//i.test(editForm.thumbnail_url.trim()) && !editForm.thumbnail_url.trim().startsWith('/')) {
    toastWarn('封面图地址要填完整 URL（http/https）或以 / 开头的站内路径，留空表示用原图')
    return
  }

  // 字段名与后端 dto.AssetUpdateRequest 的 json tag 一致
  const body = {
    title: editForm.title.trim(),
    slug: editForm.slug.trim(),
    category_id: Number(editForm.category_id),
    tags: cleanTags(editForm.tags),
    description: editForm.description,
    thumbnail_url: editForm.thumbnail_url.trim(),
    is_featured: !!editForm.is_featured,
    sort_order: toInt(editForm.sort_order, 0),
    bead_cols: Math.max(0, Math.min(999, toInt(editForm.bead_cols, 0))),
    bead_rows: Math.max(0, Math.min(999, toInt(editForm.bead_rows, 0))),
    like_count: Math.max(0, toInt(editForm.like_count, 0)),
    status: editForm.status,
    tier: editForm.tier,
    source_note: editForm.source_note,
    rights_note: editForm.rights_note,
    inner_note: editForm.inner_note
  }

  editSaving.value = true
  const ok = await run(() => assetApi.update(editForm.id, body), { ok: '素材已保存' })
  editSaving.value = false
  if (ok === null) return
  editOpen.value = false
  await reload()
}

/* ------------------------------------------------------------------ 素材：上下架 / 删除 */

const STATUS_ACTION = {
  published: {
    title: '发布素材',
    message: '发布后前台素材库立即可见。',
    detail: '发布前请确认图片、名称与分类都没问题；发布中的素材不能直接删除，需要先下架。',
    confirmText: '确认发布',
    danger: false,
    reasonRequired: false
  },
  archived: {
    title: '下架素材',
    message: '下架后前台素材库不再展示这张素材。',
    detail: '已生成的历史作品不受影响；后台仍保留这条记录，可以随时重新发布。',
    confirmText: '确认下架',
    danger: true,
    reasonRequired: true,
    reasonLabel: '下架原因',
    reasonHint: '原因会记录到操作日志，便于事后追溯'
  },
  draft: {
    title: '转回草稿',
    message: '转回草稿后，这张素材既不在前台展示，也不占「已下架」的位置。',
    detail: '适合还没编辑完、需要继续补资料的素材。',
    confirmText: '确认转草稿',
    danger: true,
    reasonRequired: true,
    reasonLabel: '操作原因'
  }
}

async function changeStatus(row, status) {
  if (!can(MANAGE)) {
    toastWarn(denyReason(MANAGE))
    return
  }
  const conf = STATUS_ACTION[status]
  if (!conf) return
  const ok = await confirmAction({
    ...conf,
    message: `${conf.message}\n素材：${row.title}（${row.slug || '—'}）`
  })
  if (!ok) return
  await run(() => assetApi.setStatus(row.id, status, ok.reason || ''), {
    ok: `已${conf.title.replace('素材', '')}`,
    onError: e => {
      if (isDenied(e)) toastWarn(denyReason(MANAGE))
    },
    finally: () => reload()
  })
}

async function deleteAsset(row) {
  if (!can(MANAGE)) {
    toastWarn(denyReason(MANAGE))
    return
  }
  if (!canDelete(row)) {
    toastWarn('已发布的素材不能直接删除，请先「下架」，再删除')
    return
  }
  const ok = await confirmAction({
    title: '删除素材',
    message: `确认删除素材「${row.title}」？`,
    detail:
      '后端是软删除：这条素材记录会被标记删除，磁盘上的原图与缩略图会保留，' +
      '已生成的历史作品不受影响。删除后前台素材库不再出现这张素材，重新上传需要重新走一遍流程。',
    confirmText: '确认删除',
    danger: true,
    reasonRequired: true,
    reasonLabel: '删除原因',
    reasonHint: '请写清为什么删除，会记录到操作日志'
  })
  if (!ok) return
  await run(() => assetApi.remove(row.id, ok.reason), {
    ok: '素材已删除',
    onError: e => {
      if (e instanceof ApiError && e.code === 40019) {
        toastWarn('已发布的素材不能删除：后端要求先下架，再删除')
      } else if (isDenied(e)) {
        toastWarn(denyReason(MANAGE))
      }
    },
    finally: () => reload()
  })
}

/* ------------------------------------------------------------------ 素材：批量修改 */

async function submitBatch() {
  if (!can(MANAGE)) {
    toastWarn(denyReason(MANAGE))
    return
  }
  if (!selected.value.length) {
    toastWarn('请先勾选要修改的素材')
    return
  }
  if (!batchHasChange.value) {
    toastWarn('请至少选择一项要修改的内容（分类 / 状态 / 分层 / 推荐 / 排序 / 标签）')
    return
  }

  const ids = selected.value.map(row => row.id)
  const body = { ids }
  if (batch.category_id !== '') body.category_id = Number(batch.category_id)
  if (batch.status !== '') body.status = batch.status
  if (batch.tier !== '') body.tier = batch.tier
  if (batch.is_featured !== '') body.is_featured = batch.is_featured === 'true'
  if (batch.sort_order !== '') body.sort_order = toInt(batch.sort_order, 0)
  if (batch.tags_mode !== '') {
    const tags = parseBatchTags(batch.tags)
    if (batch.tags_mode !== 'replace' && !tags.length) {
      toastWarn(`请填写要${batch.tags_mode === 'add' ? '追加' : '移除'}的标签`)
      return
    }
    body.tags_mode = batch.tags_mode
    body.tags = tags
  }
  if (batch.status !== '' && batch.status !== 'published' && batch.reason.trim()) {
    body.reason = batch.reason.trim()
  }

  /* 改状态会影响前台能不能看到这些素材，先让运营确认一次；
     只改排序 / 标签这类不影响可见性的项就不打断。 */
  if (batch.status !== '') {
    const label = (STATUS_OPTIONS.find(o => o.value === batch.status) || {}).label || batch.status
    const ok = await confirmAction({
      title: `批量把 ${ids.length} 条素材改为「${label}」？`,
      message: batchSummary.value,
      detail: batch.status === 'published'
        ? '发布后这些素材会立刻出现在前台素材库。'
        : '改成草稿或下架后，前台素材库不再展示这些素材；已生成的作品不受影响。',
      confirmText: `确认${label}`,
      danger: batch.status !== 'published'
    })
    if (!ok) return
  }

  batch.loading = true
  const result = await run(() => assetApi.batchUpdate(body), {
    ok: `已更新 ${ids.length} 条素材`,
    onError: e => {
      if (isDenied(e)) toastWarn(denyReason(MANAGE))
    },
    finally: () => { batch.loading = false }
  })
  if (result === null) return
  resetBatch()
  await reload()
}

/* ------------------------------------------------------------------ 分类管理 */

const cat = reactive({ rows: [], total: 0, loading: false })
const catPage = ref(1)
const catPageSize = ref(20)
const catFilters = reactive({ keyword: '', status: '' })
const catOpen = ref(false)
const catSaving = ref(false)
const catForm = reactive({
  id: 0,
  name: '',
  slug: '',
  description: '',
  cover_url: '',
  sort_order: 0,
  status: 1
})
const catIsNew = computed(() => !catForm.id)

async function loadCategories(toPage = catPage.value) {
  catPage.value = toPage
  cat.loading = true
  try {
    // 参数名与后端 dto.CategoryListQuery 一致；返回是 { list, total, page, page_size }
    const data = await assetApi.categories({
      keyword: catFilters.keyword,
      status: catFilters.status,
      page: catPage.value,
      page_size: catPageSize.value
    })
    cat.rows = (data && data.list) || []
    cat.total = (data && data.total) || 0
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '分类加载失败，请重试')
    cat.rows = []
    cat.total = 0
  } finally {
    cat.loading = false
  }
}

function openCreateCategory() {
  Object.assign(catForm, {
    id: 0,
    name: '',
    slug: '',
    description: '',
    cover_url: '',
    sort_order: 0,
    status: 1
  })
  catOpen.value = true
}

function openEditCategory(row) {
  Object.assign(catForm, {
    id: row.id,
    name: row.name || '',
    slug: row.slug || '',
    description: row.description || '',
    cover_url: row.cover_url || '',
    sort_order: toInt(row.sort_order, 0),
    status: Number(row.status) === 0 ? 0 : 1
  })
  catOpen.value = true
}

async function saveCategory() {
  if (!can(MANAGE)) {
    toastWarn(denyReason(MANAGE))
    return
  }
  if (!catForm.name.trim()) {
    toastWarn('分类名称不能为空')
    return
  }
  // 字段名与后端 dto.CategoryRequest 一致；status 是数字 1 启用 / 0 停用
  const body = {
    name: catForm.name.trim(),
    slug: catForm.slug.trim(),
    description: catForm.description,
    cover_url: catForm.cover_url.trim(),
    sort_order: toInt(catForm.sort_order, 0),
    status: Number(catForm.status) === 0 ? 0 : 1
  }
  catSaving.value = true
  const ok = await run(
    () => (catForm.id ? assetApi.updateCategory(catForm.id, body) : assetApi.createCategory(body)),
    {
      ok: catForm.id ? '分类已保存' : '分类已创建',
      onError: e => {
        if (isDenied(e)) toastWarn(denyReason(MANAGE))
      }
    }
  )
  catSaving.value = false
  if (ok === null) return
  catOpen.value = false
  await Promise.all([loadCategories(), loadOptions(), reload()])
}

async function deleteCategory(row) {
  if (!can(MANAGE)) {
    toastWarn(denyReason(MANAGE))
    return
  }
  const ok = await confirmAction({
    title: '删除分类',
    message: `确认删除分类「${row.name}」？`,
    detail:
      '如果还有素材引用这个分类，后端会拒绝删除。这时请先把这些素材改到别的分类，' +
      '或者直接把分类「停用」——停用后前台不再展示这个入口，但已有素材不受影响。',
    confirmText: '确认删除',
    danger: true
  })
  if (!ok) return
  await run(() => assetApi.removeCategory(row.id), {
    ok: '分类已删除',
    onError: e => {
      if (e instanceof ApiError && e.code === 40021) {
        toastWarn('该分类下还有素材，不能删除：请先迁移素材，或直接把分类改为「停用」')
      } else if (isDenied(e)) {
        toastWarn(denyReason(MANAGE))
      }
    },
    finally: () => { loadCategories(); loadOptions() }
  })
}

/* ------------------------------------------------------------------ 标签编辑（可增删多行） */

function addTag(form) {
  form.tags.push('')
}

function removeTag(form, index) {
  form.tags = form.tags.filter((_, i) => i !== index)
}

/* ------------------------------------------------------------------ 生命周期 */

onMounted(async () => {
  initFromQuery()
  await Promise.all([loadOptions(), reload()])
  if (tab.value === 'category') loadCategories()
})

onBeforeUnmount(() => {
  releasePending()
  if (uploadController) uploadController.abort()
})

const hasFilter = computed(() =>
  Object.values(filters).some(v => v !== '') || sortField.value !== 'sort_order' || sortOrder.value !== 'desc'
)
</script>

<template>
  <div class="adm-page">
    <!-- ① 页头 -->
    <div class="adm-pagehead">
      <div>
        <h1>素材库管理</h1>
        <p>
          运营在这里上传与维护前台「素材库」的图片素材：<strong>列表与前台统一按「排序值大的排前面」</strong>
          （<span class="adm-mono">sort_order DESC</span>，相同排序值时再按上传时间倒序）。
          已发布的素材不能直接删除，需要先下架。
        </p>
      </div>
      <div class="adm-pagehead__actions">
        <template v-if="tab === 'asset'">
          <button
            class="adm-btn adm-btn--primary"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="openUpload"
          >上传素材</button>
        </template>
        <template v-else>
          <button
            class="adm-btn adm-btn--primary"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="openCreateCategory"
          >新建分类</button>
        </template>
      </div>
    </div>

    <!-- ② 标签页：素材 / 分类（不占用主菜单） -->
    <div class="adm-toolbar">
      <div class="adm-chips">
        <button class="adm-chip" :class="{ on: tab === 'asset' }" type="button" @click="switchTab('asset')">素材</button>
        <button class="adm-chip" :class="{ on: tab === 'category' }" type="button" @click="switchTab('category')">分类</button>
      </div>
      <div class="adm-toolbar__right">
        <span v-if="tab === 'asset'" class="adm-muted adm-2xs">共 {{ list.total }} 张素材</span>
      </div>
    </div>

    <!-- ============================================================ 素材 -->
    <template v-if="tab === 'asset'">
      <div class="adm-note">
        <strong>上传与图片限制</strong>
        <div>支持格式：JPG / PNG / WEBP / GIF；单张不超过 <strong>10 MB</strong>，一次可以多选。</div>
        <div>当前<strong>不支持 SVG</strong>（矢量图可能内嵌脚本，前台直接渲染不安全）。</div>
        <div>本地会先按扩展名与大小拦一道，服务端还会<strong>按文件内容校验真实类型</strong>，两边都通过才算上传成功。</div>
        <div>上传成功后服务端会自动生成缩略图，列表里展示的就是缩略图；编辑时看到的「当前原图」是未压缩的原文件。</div>
      </div>

      <!-- ③ 工具条：筛选 + 排序 -->
      <div class="adm-toolbar">
        <input
          v-model="filters.keyword"
          class="adm-input"
          placeholder="搜索素材名称 / 标识 / 描述"
          @keyup.enter="reload(1)"
        >
        <select v-model="filters.category_id" class="adm-select" @change="reload(1)">
          <option value="">全部分类</option>
          <option v-for="c in categoryOptions" :key="c.id" :value="c.id">
            {{ c.name }}{{ c.enabled ? '' : '（已停用）' }}
          </option>
        </select>
        <select v-model="filters.tag" class="adm-select" @change="reload(1)">
          <option value="">全部标签</option>
          <option v-for="t in tagOptions" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="filters.status" class="adm-select" @change="reload(1)">
          <option value="">全部状态</option>
          <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <!-- featured 后端是 *bool，只认 true / false；空字符串表示不筛选 -->
        <select v-model="filters.featured" class="adm-select" @change="reload(1)">
          <option value="">推荐（全部）</option>
          <option value="true">仅推荐</option>
          <option value="false">仅非推荐</option>
        </select>
        <select v-model="filters.tier" class="adm-select" @change="reload(1)">
          <option value="">全部分层</option>
          <option v-for="t in TIER_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <input v-model="filters.created_from" class="adm-input" type="date" title="上传日期（起）" @change="reload(1)">
        <input v-model="filters.created_to" class="adm-input" type="date" title="上传日期（止）" @change="reload(1)">
        <select v-model="sortField" class="adm-select" @change="reload(1)">
          <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">排序：{{ o.label }}</option>
        </select>
        <select v-model="sortOrder" class="adm-select" @change="reload(1)">
          <option value="desc">倒序（大的排前面）</option>
          <option value="asc">正序（小的排前面）</option>
        </select>
        <div class="adm-toolbar__right">
          <span class="adm-muted adm-2xs">当前排序：{{ sortText }}</span>
          <button class="adm-btn adm-btn--sm" type="button" @click="reload(1)">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" :disabled="!hasFilter" @click="resetFilters">重置</button>
        </div>
      </div>

      <!-- 批量操作入口：全选本页 / 清空 -->
      <div class="adm-toolbar">
        <label class="adm-check">
          <input type="checkbox" :checked="allChecked" :disabled="!rows.length" @change="toggleAll">
          <span>全选本页（{{ rows.length }} 条）</span>
        </label>
        <div class="adm-toolbar__right">
          <span v-if="selected.length" class="adm-muted adm-2xs">已选 {{ selected.length }} 条</span>
          <button class="adm-btn adm-btn--sm" type="button" :disabled="!selected.length" @click="clearSelection">清空选择</button>
        </div>
      </div>

      <!-- 批量修改：勾选后出现；空着的那一项保持原值 -->
      <div v-if="selected.length" class="adm-card adm-card--flat" data-asset-batch>
        <div class="adm-card__head">
          <strong>批量修改（已选 {{ selected.length }} 条）</strong>
          <div class="adm-card__head__actions">
            <button class="adm-btn adm-btn--sm" type="button" @click="clearSelection">取消选择</button>
          </div>
        </div>
        <div class="adm-form adm-form--3">
          <div class="adm-field">
            <label>分类</label>
            <select v-model="batch.category_id" class="adm-select" data-batch-category>
              <option value="">不修改</option>
              <option v-for="c in uploadCategoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <div class="adm-hint">只列启用中的前台分类</div>
          </div>
          <div class="adm-field">
            <label>状态</label>
            <select v-model="batch.status" class="adm-select" data-batch-status>
              <option value="">不修改</option>
              <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
            <div class="adm-hint">发布 / 下架会影响前台是否展示</div>
          </div>
          <div class="adm-field">
            <label>会员分层</label>
            <select v-model="batch.tier" class="adm-select">
              <option value="">不修改</option>
              <option v-for="t in TIER_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div class="adm-field">
            <label>推荐状态</label>
            <select v-model="batch.is_featured" class="adm-select">
              <option value="">不修改</option>
              <option value="true">设为推荐</option>
              <option value="false">取消推荐</option>
            </select>
          </div>
          <div class="adm-field">
            <label>排序值</label>
            <input v-model="batch.sort_order" class="adm-input" type="number" step="1" placeholder="留空表示不改">
            <div class="adm-hint">排序值越大的素材在前台越靠前</div>
          </div>
          <div class="adm-field">
            <label>标签</label>
            <div class="adm-inline">
              <select v-model="batch.tags_mode" class="adm-select" data-batch-tags-mode>
                <option value="">不修改</option>
                <option v-for="m in BATCH_TAG_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
              <input
                v-model="batch.tags"
                class="adm-input"
                :disabled="!batch.tags_mode"
                :placeholder="batch.tags_mode === 'replace' ? '留空表示清空标签' : '用逗号分隔'"
                data-batch-tags
              >
            </div>
            <div class="adm-hint">追加不会重复；移除只删指定的标签</div>
          </div>
          <div v-if="batchNeedsReason" class="adm-field adm-field--full">
            <label>原因（选填）</label>
            <input v-model="batch.reason" class="adm-input" maxlength="255" placeholder="会写进每条素材的下架原因，便于事后追溯">
          </div>
          <div class="adm-field adm-field--full">
            <div class="adm-batchsum">
              <strong>将修改：</strong>{{ batchSummary || '还没有选择要改的内容' }}
            </div>
            <button
              class="adm-btn adm-btn--primary"
              type="button"
              :disabled="batch.loading || !can('asset.manage') || !batchHasChange"
              :title="can('asset.manage') ? '' : denyReason('asset.manage')"
              data-batch-apply
              @click="submitBatch"
            >{{ batch.loading ? '提交中…' : `应用到 ${selected.length} 条素材` }}</button>
          </div>
        </div>
      </div>

      <!-- ④ 列表 -->
      <AdminTable
        :columns="columns"
        :rows="rows"
        :loading="list.loading"
        min-width="1420px"
        empty-title="还没有素材"
        empty-hint="点右上角「上传素材」，支持把多张图片直接拖进弹窗里"
      >
        <template #cell-checked="{ row }">
          <input
            class="adm-check"
            type="checkbox"
            :checked="isSelected(row)"
            :aria-label="`选择 ${row.title}`"
            @change="toggleRow(row)"
          >
        </template>

        <template #cell-thumbnail_url="{ row }">
          <img
            class="adm-table__thumb"
            :src="row.thumbnail_url || THUMB_PLACEHOLDER"
            :alt="row.title"
            loading="lazy"
            @error="onThumbError"
          >
        </template>

        <template #cell-title="{ row }">
          <div class="adm-strong">{{ row.title || '—' }}</div>
          <div v-if="row.description" class="adm-muted adm-2xs">{{ row.description }}</div>
        </template>

        <template #cell-slug="{ row }">
          <span class="adm-mono">{{ row.slug || '—' }}</span>
        </template>

        <template #cell-category_id="{ row }">{{ categoryName(row) }}</template>

        <template #cell-tags="{ row }">
          <AdminTag v-for="t in assetTagList(row)" :key="t" :text="t" kind="info" />
          <span v-if="!assetTagList(row).length" class="adm-muted">—</span>
        </template>

        <template #cell-is_featured="{ row }">
          <AdminTag v-if="row.is_featured" text="推荐" kind="primary" />
          <span v-else class="adm-muted">—</span>
        </template>

        <template #cell-sort_order="{ row }">
          <span class="adm-mono">{{ row.sort_order ?? 0 }}</span>
        </template>

        <template #cell-status="{ row }">
          <AdminTag
            :text="row.status_text || assetStatus(row.status).text"
            :kind="assetStatus(row.status).kind"
            :title="statusTitle(row)"
          />
        </template>

        <template #cell-tier="{ row }">
          <AdminTag :text="row.tier === 'pro' ? 'pro' : (row.tier || '—')" :kind="row.tier === 'pro' ? 'warn' : 'muted'" />
        </template>

        <template #cell-created_at="{ row }">
          <span class="adm-nowrap">{{ datetime(row.created_at) }}</span>
        </template>

        <template #cell-updated_at="{ row }">
          <span class="adm-nowrap">{{ datetime(row.updated_at) }}</span>
        </template>

        <template #cell-actions="{ row }">
          <button
            class="adm-link"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="openEdit(row)"
          >编辑</button>
          <button
            v-if="row.status !== 'published'"
            class="adm-link"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="changeStatus(row, 'published')"
          >发布</button>
          <button
            v-if="row.status === 'published'"
            class="adm-link"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="changeStatus(row, 'archived')"
          >下架</button>
          <button
            v-if="row.status !== 'draft'"
            class="adm-link"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="changeStatus(row, 'draft')"
          >转草稿</button>
          <button
            class="adm-link"
            type="button"
            :disabled="!can('asset.manage') || !canDelete(row)"
            :title="!can('asset.manage') ? denyReason('asset.manage') : (canDelete(row) ? '' : '请先下架再删除')"
            @click="deleteAsset(row)"
          >删除</button>
        </template>

        <template #empty-action>
          <button
            class="adm-btn adm-btn--primary"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="openUpload"
          >上传素材</button>
        </template>
      </AdminTable>

      <AdminPager
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="list.total"
        @update:page="reload"
        @update:page-size="reload(1)"
      />
    </template>

    <!-- ============================================================ 分类 -->
    <template v-else>
      <div class="adm-note">
        <strong>分类是前台素材库的一级入口</strong>
        <div>标识留空时后端会按名称自动生成；标识一旦被引用就不要再改，否则前台链接可能失效。</div>
        <div><strong>停用</strong>只影响前台的展示入口，已有素材与历史作品都不受影响，是比删除更稳的做法。</div>
        <div>删除时如果还有素材引用该分类，后端会拒绝并返回「分类下仍有素材」，请先迁移素材或改为停用。</div>
      </div>

      <div class="adm-toolbar">
        <input
          v-model="catFilters.keyword"
          class="adm-input"
          placeholder="搜索分类名称 / 标识"
          @keyup.enter="loadCategories(1)"
        >
        <!-- 分类状态后端是 int8：1 已启用 / 0 已停用 -->
        <select v-model="catFilters.status" class="adm-select" @change="loadCategories(1)">
          <option value="">全部状态</option>
          <option v-for="s in CATEGORY_STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <div class="adm-toolbar__right">
          <span class="adm-muted adm-2xs">共 {{ cat.total }} 个分类</span>
          <button class="adm-btn adm-btn--sm" type="button" @click="loadCategories(1)">查询</button>
          <button class="adm-btn adm-btn--sm" type="button" @click="loadCategories()">刷新</button>
        </div>
      </div>

      <AdminTable
        :columns="categoryColumns"
        :rows="cat.rows"
        :loading="cat.loading"
        min-width="880px"
        empty-title="还没有分类"
        empty-hint="点右上角「新建分类」建一个，素材上传时就能选它"
      >
        <template #cell-name="{ row }">
          <span class="adm-strong">{{ row.name || '—' }}</span>
        </template>

        <template #cell-slug="{ row }">
          <span class="adm-mono">{{ row.slug || '（自动生成）' }}</span>
        </template>

        <template #cell-description="{ row }">
          <span class="adm-muted">{{ row.description || '—' }}</span>
        </template>

        <template #cell-asset_count="{ row }">
          <span class="adm-mono">{{ row.asset_count ?? 0 }}</span>
        </template>

        <template #cell-sort_order="{ row }">
          <span class="adm-mono">{{ row.sort_order ?? 0 }}</span>
        </template>

        <template #cell-status="{ row }">
          <AdminTag
            :text="row.status_text || categoryStatus(row.status).text"
            :kind="categoryStatus(row.status).kind"
          />
        </template>

        <template #cell-actions="{ row }">
          <button
            class="adm-link"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="openEditCategory(row)"
          >编辑</button>
          <button
            class="adm-link"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="deleteCategory(row)"
          >删除</button>
        </template>

        <template #empty-action>
          <button
            class="adm-btn adm-btn--primary"
            type="button"
            :disabled="!can('asset.manage')"
            :title="can('asset.manage') ? '' : denyReason('asset.manage')"
            @click="openCreateCategory"
          >新建分类</button>
        </template>
      </AdminTable>

      <AdminPager
        v-model:page="catPage"
        v-model:page-size="catPageSize"
        :total="cat.total"
        @update:page="loadCategories"
        @update:page-size="loadCategories(1)"
      />
    </template>

    <!-- ⑤ 上传弹窗 -->
    <AdminModal
      v-model="uploadOpen"
      title="上传素材（可批量）"
      size="lg"
      :mask-closable="false"
      :esc-closable="!uploadBusy"
      @close="closeUpload"
    >
      <div class="adm-stack">
        <div
          class="adm-drop"
          :class="{ on: dragOver }"
          @click="fileInput ? fileInput.click() : null"
          @dragover.prevent="onDragOver"
          @dragenter.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <strong>把图片拖到这里，或点击选择（可一次传多张）</strong>
          <p>支持 JPG / PNG / WEBP / GIF，单张不超过 10 MB；不支持 SVG</p>
          <input
            ref="fileInput"
            class="adm-hidden-file"
            type="file"
            accept="image/*"
            multiple
            @change="onFileChange"
          >
        </div>

        <div v-if="pending.length" class="adm-assetgrid">
          <div v-for="(item, i) in pending" :key="item.url" class="adm-assetcard">
            <img class="adm-assetcard__img" :src="item.url" :alt="item.name">
            <div class="adm-assetcard__body">
              <input
                v-model="item.title"
                class="adm-input adm-assetcard__name"
                maxlength="128"
                :aria-label="`第 ${i + 1} 张的素材名称`"
                :placeholder="item.name.replace(/\.[^.]+$/, '')"
                :title="item.name"
              >
              <div class="adm-muted adm-2xs">{{ fileSize(item.size) }}</div>
              <button class="adm-btn adm-btn--sm adm-btn--danger" type="button" @click="removePending(i)">移除</button>
            </div>
          </div>
        </div>
        <p v-if="pending.length > 1" class="adm-muted adm-2xs" style="margin:-4px 0 0">
          已选 {{ pending.length }} 张：每张可以单独改名，上传后按这里的名称入库（下面的「统一名称」留空时生效）。
        </p>

        <div v-if="uploadBusy || progress > 0">
          <div class="adm-progress">
            <div class="adm-progress__bar" :style="{ width: progress + '%' }" />
          </div>
          <div class="adm-muted adm-2xs">{{ progress }}%（传完由服务端处理，处理期间请不要关闭弹窗）</div>
        </div>

        <div v-if="uploadDone.failed > 0 || uploadErrors.length" class="adm-note adm-note--warn">
          <strong>上传结果：共 {{ uploadDone.total }} 张，成功 {{ uploadDone.success }} 张，失败 {{ uploadDone.failed }} 张</strong>
          <ul>
            <li v-for="(err, i) in uploadErrors" :key="`${err.filename}-${i}`">
              <span class="adm-mono">{{ err.filename || '（未知文件）' }}</span>：{{ err.reason || '服务端未说明原因' }}
            </li>
          </ul>
          <div>失败的图片可以按上面的原因改好后直接重传，已填写的文字内容会保留。</div>
        </div>

        <div class="adm-form adm-form--3">
          <div class="adm-field">
            <label>统一名称（可选）</label>
            <input v-model="uploadForm.title" class="adm-input" maxlength="128" placeholder="留空用每张图片自己的名称">
            <div class="adm-hint">填了所有图片都叫这个名字（第 2 张起自动加 -2 / -3）；留空则用上面每张卡片里的名称</div>
          </div>
          <div class="adm-field">
            <label>标识 slug</label>
            <input v-model="uploadForm.slug" class="adm-input adm-mono" maxlength="64" placeholder="留空由后端按名称生成">
            <div class="adm-hint">前台链接与收藏都用它，重复时后端会自动加序号</div>
          </div>
          <div class="adm-field">
            <label>分类 <em>*</em></label>
            <select v-model="uploadForm.category_id" class="adm-select">
              <option value="">请选择分类</option>
              <option v-for="c in uploadCategoryOptions" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select>
            <div v-if="!uploadCategoryOptions.length" class="adm-note adm-note--warn">
              还没有启用的前台分类，上传前需要先建一个。
              <button class="adm-btn adm-btn--sm" type="button" @click="goCreateCategory">去新建分类</button>
            </div>
            <div v-else class="adm-hint">与前台素材库的 9 个一级分类一致；二级分类、难度、用途用标签补充</div>
          </div>
          <div class="adm-field">
            <label>状态</label>
            <select v-model="uploadForm.status" class="adm-select">
              <option value="draft">草稿（默认，前台不可见）</option>
              <option value="published">直接发布</option>
            </select>
            <div class="adm-hint">上传时后端只接受 draft / published，已下架（archived）要上传后再操作</div>
          </div>

          <div class="adm-field">
            <label>会员分层</label>
            <select v-model="uploadForm.tier" class="adm-select">
              <option v-for="t in TIER_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
            <div class="adm-hint">pro 素材只有会员能用</div>
          </div>
          <div class="adm-field">
            <label>排序值</label>
            <input v-model="uploadForm.sort_order" class="adm-input" type="number" step="1">
            <div class="adm-hint">值越大越靠前（sort_order DESC）</div>
          </div>
          <div class="adm-field">
            <label>是否推荐</label>
            <label class="adm-switch">
              <input v-model="uploadForm.is_featured" type="checkbox">
              <span>{{ uploadForm.is_featured ? '推荐' : '普通' }}</span>
            </label>
            <div class="adm-hint">推荐素材会出现在前台推荐位</div>
          </div>

          <div class="adm-field adm-field--full">
            <label>标签</label>
            <div class="adm-repeat">
              <div v-for="(t, i) in uploadForm.tags" :key="`ut-${i}`" class="adm-repeat__row">
                <input
                  v-model="uploadForm.tags[i]" class="adm-input" maxlength="16"
                  list="asset-tag-options" placeholder="例如：猫咪、简单、钥匙扣"
                >
                <button class="adm-btn adm-btn--sm adm-btn--danger" type="button" @click="removeTag(uploadForm, i)">删除</button>
              </div>
              <div>
                <button class="adm-btn adm-btn--sm" type="button" @click="addTag(uploadForm)">+ 添加标签</button>
              </div>
            </div>
            <div class="adm-hint">标签会一起提交为字符串数组；二级分类、难度、用途都从建议里选，前台筛选才能命中</div>
          </div>

          <div class="adm-field adm-field--full">
            <label>简短描述</label>
            <textarea v-model="uploadForm.description" class="adm-textarea" placeholder="一句话说明这张素材适合什么场景"></textarea>
          </div>

          <div class="adm-field">
            <label>素材来源</label>
            <input v-model="uploadForm.source_note" class="adm-input" maxlength="128" placeholder="例如：自绘 / 客户授权 / 站外收集（写清来源）">
          </div>
          <div class="adm-field">
            <label>版权 / 授权说明</label>
            <input v-model="uploadForm.rights_note" class="adm-input" maxlength="128" placeholder="例如：CC0 / 已购商用授权，仅限本站使用">
            <div class="adm-hint">涉及第三方素材时必须写清，前台素材可能被用户下载</div>
          </div>
          <div class="adm-field">
            <label>内部备注</label>
            <input v-model="uploadForm.inner_note" class="adm-input" maxlength="128" placeholder="只给后台看，例如：待重新排版">
          </div>
        </div>
      </div>

      <template #footer>
        <button class="adm-btn" type="button" @click="uploadOpen = false">取消</button>
        <button v-if="uploadBusy" class="adm-btn adm-btn--danger" type="button" @click="cancelUpload">取消上传</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="uploadBusy || !can('asset.manage')"
          :title="can('asset.manage') ? '' : denyReason('asset.manage')"
          @click="submitUpload"
        >{{ uploadBusy ? `上传中 ${progress}%` : `确认上传${pending.length ? `（${pending.length} 张）` : ''}` }}</button>
      </template>
    </AdminModal>

    <!-- ⑤ 编辑弹窗 -->
    <AdminModal v-model="editOpen" title="编辑素材" size="lg">
      <div v-if="editLoading" class="adm-note adm-note--muted">正在加载素材详情…</div>
      <div class="adm-stack">
        <div class="adm-split">
          <div class="adm-stack">
            <div class="adm-form adm-form--2">
              <div class="adm-field">
                <label>素材名称 <em>*</em></label>
                <input v-model="editForm.title" class="adm-input" maxlength="128">
              </div>
              <div class="adm-field">
                <label>标识 slug</label>
                <input v-model="editForm.slug" class="adm-input adm-mono" maxlength="64" placeholder="留空由后端生成">
                <div class="adm-hint">前台链接与收藏都用它，改之前确认没有外链引用</div>
              </div>
              <div class="adm-field">
                <label>分类 <em>*</em></label>
                <select v-model="editForm.category_id" class="adm-select">
                  <option value="">请选择分类</option>
                  <option v-for="c in editCategoryOptions" :key="c.id" :value="c.id">
                    {{ c.name }}
                  </option>
                </select>
                <div class="adm-hint">与前台素材库的 9 个一级分类一致；已停用的旧分类会标出来</div>
              </div>
              <div class="adm-field">
                <label>状态</label>
                <select v-model="editForm.status" class="adm-select">
                  <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>
              </div>
              <div class="adm-field">
                <label>会员分层</label>
                <select v-model="editForm.tier" class="adm-select">
                  <option v-for="t in TIER_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
              </div>
              <div class="adm-field">
                <label>排序值</label>
                <input v-model="editForm.sort_order" class="adm-input" type="number" step="1">
                <div class="adm-hint">值越大越靠前（sort_order DESC）</div>
              </div>
              <div class="adm-field">
                <label>成品尺寸（格）</label>
                <div class="adm-inline adm-size">
                  <input v-model="editForm.bead_cols" class="adm-input" type="number" min="0" max="999" step="1" aria-label="宽（格）">
                  <span>×</span>
                  <input v-model="editForm.bead_rows" class="adm-input" type="number" min="0" max="999" step="1" aria-label="高（格）">
                </div>
                <div class="adm-hint">前台卡片「尺寸」一行，例如 52 × 52；填 0 表示不显示</div>
              </div>
              <div class="adm-field">
                <label>点赞数</label>
                <input v-model="editForm.like_count" class="adm-input" type="number" min="0" step="1">
                <div class="adm-hint">卡片右上角展示；1000 以上前台缩写成 1.2k</div>
              </div>
              <div class="adm-field">
                <label>是否推荐</label>
                <label class="adm-switch">
                  <input v-model="editForm.is_featured" type="checkbox">
                  <span>{{ editForm.is_featured ? '推荐' : '普通' }}</span>
                </label>
              </div>
              <div class="adm-field">
                <label>封面图地址</label>
                <input v-model="editForm.thumbnail_url" class="adm-input" placeholder="留空表示用原图">
              </div>
              <div class="adm-field adm-field--full">
                <label>简短描述</label>
                <textarea
                  v-model="editForm.description"
                  class="adm-textarea"
                  placeholder="一句话说明这张素材适合什么场景"
                ></textarea>
              </div>
              <div class="adm-field adm-field--full">
                <label>标签</label>
                <div class="adm-repeat">
                  <div v-for="(t, i) in editForm.tags" :key="`et-${i}`" class="adm-repeat__row">
                    <input
                      v-model="editForm.tags[i]" class="adm-input" maxlength="16"
                      list="asset-tag-options" placeholder="例如：猫咪、简单、钥匙扣"
                    >
                    <button class="adm-btn adm-btn--sm adm-btn--danger" type="button" @click="removeTag(editForm, i)">删除</button>
                  </div>
                  <div>
                    <button class="adm-btn adm-btn--sm" type="button" @click="addTag(editForm)">+ 添加标签</button>
                  </div>
                </div>
              </div>
              <div class="adm-field">
                <label>素材来源</label>
                <input v-model="editForm.source_note" class="adm-input" maxlength="128">
              </div>
              <div class="adm-field">
                <label>版权 / 授权说明</label>
                <input v-model="editForm.rights_note" class="adm-input" maxlength="128">
              </div>
              <div class="adm-field adm-field--full">
                <label>内部备注</label>
                <input v-model="editForm.inner_note" class="adm-input" maxlength="128" placeholder="只给后台看">
              </div>
            </div>
          </div>

          <div class="adm-stack">
            <div class="adm-card adm-card--flat">
              <div class="adm-card__head"><strong>当前原图</strong></div>
              <img
                v-if="editOriginal"
                class="adm-preview"
                :src="editOriginal"
                :alt="editForm.title"
                @error="onThumbError"
              >
              <div v-else class="adm-note adm-note--muted">这张素材没有返回原图地址，可能是历史数据；不影响编辑其他字段。</div>
            </div>
            <div class="adm-note adm-note--muted">
              <div>封面图留空时前台用原图；填了地址就用你填的图。</div>
              <div>排序值 {{ editForm.sort_order }} → 排序值比它小的素材都在它后面。</div>
            </div>
          </div>
        </div>
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="editSaving || !can('asset.manage')"
          :title="can('asset.manage') ? '' : denyReason('asset.manage')"
          @click="saveEdit"
        >{{ editSaving ? '保存中…' : '保存' }}</button>
      </template>
    </AdminModal>

    <!-- ⑤ 分类编辑弹窗 -->
    <AdminModal v-model="catOpen" :title="catIsNew ? '新建分类' : '编辑分类'">
      <div class="adm-form adm-form--2">
        <div class="adm-field">
          <label>分类名称 <em>*</em></label>
          <input v-model="catForm.name" class="adm-input" maxlength="32" placeholder="例如：动物">
        </div>
        <div class="adm-field">
          <label>标识</label>
          <input v-model="catForm.slug" class="adm-input adm-mono" maxlength="32" placeholder="留空自动生成">
          <div class="adm-hint">只允许小写字母、数字与连字符；被引用后不要改</div>
        </div>
        <div class="adm-field">
          <label>排序值</label>
          <input v-model="catForm.sort_order" class="adm-input" type="number" step="1">
          <div class="adm-hint">值越大越靠前</div>
        </div>
        <div class="adm-field">
          <label>状态</label>
          <select v-model="catForm.status" class="adm-select">
            <option :value="1">已启用（status=1）</option>
            <option :value="0">已停用（status=0）</option>
          </select>
          <div class="adm-hint">停用后前台不再展示这个入口，素材本身不受影响</div>
        </div>
        <div class="adm-field adm-field--full">
          <label>分类封面地址</label>
          <input v-model="catForm.cover_url" class="adm-input" placeholder="https://… 或 /assets/…，可留空">
        </div>
        <div class="adm-field adm-field--full">
          <label>描述</label>
          <textarea v-model="catForm.description" class="adm-textarea" placeholder="前台分类页展示的一句话说明"></textarea>
        </div>
      </div>
      <div v-if="!catIsNew" class="adm-note adm-note--warn">
        删除分类前请确认它下面已经没有素材；有素材引用时后端会拒绝删除，请先迁移素材或改为「停用」。
      </div>

      <template #footer="{ close }">
        <button class="adm-btn" type="button" @click="close">取消</button>
        <button
          class="adm-btn adm-btn--primary"
          type="button"
          :disabled="catSaving || !can('asset.manage')"
          :title="can('asset.manage') ? '' : denyReason('asset.manage')"
          @click="saveCategory"
        >{{ catSaving ? '保存中…' : '保存' }}</button>
      </template>
    </AdminModal>

    <!-- 标签建议与前台同源：二级分类 + 难度 + 用途 -->
    <datalist id="asset-tag-options">
      <option v-for="t in FRONTEND_TAG_SUGGESTIONS" :key="t" :value="t" />
    </datalist>
  </div>
</template>

<style scoped>
/* 仅隐藏原生 file input：保留在 DOM 里，用 .adm-drop 点击触发，
   这样键盘 / 屏幕阅读器仍然拿得到这个控件 */
.adm-hidden-file {
  display: none;
}

/* 尺寸两个数字框：中间的 × 不参与伸缩，两个框等宽 */
.adm-size > .adm-input {
  flex: 1 1 0;
}
.adm-size > span {
  flex: 0 0 auto;
  color: var(--muted-2);
}
</style>
