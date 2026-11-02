<script setup>
/* =========================================================================
   新手版 · 第 ① 步：选择图片
   -------------------------------------------------------------------------
   两条入口（上传本地图片 / 免费素材）→ 统一进「图片已选好」确认页 → 下一步。
   确认页是刻意加的一步：新手最常见的失败是「传错图了还一路做到底」，
   在真正开始算图纸前给一次「就是这张吗 / 换一张」的确认最省事。

   全部走现有能力：
   · 上传 → useStudio.useImageFile（真实解码 → 自动匹配画布 → 生成图纸）
   · 素材 → useAssets.pickAsset（后台已发布素材，下载原图后走同一条生成链路）
   没有伪造的素材、没有假上传、没有假进度。
   ========================================================================= */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PixelIcon from '../ui/PixelIcon.vue'
import { allAssets, loadRemoteAssets, pickAsset, remoteCategories, remoteError, remoteLoading } from '../../composables/useAssets.js'
import { useImageFile } from '../../composables/useStudio.js'
import { pendingFile, takePendingUpload } from '../../composables/usePendingUpload.js'
import { toastErr, toastWarn } from '../../composables/useToast.js'

const emit = defineEmits(['next'])

const route = useRoute()

/* ---------------------------------------------------------------- 状态 */
const tab = ref('upload')          // 'upload' | 'library'
const fileInput = ref(null)
const dragOver = ref(false)
const busy = ref(false)
const err = ref('')

/* 待确认的东西：{ type:'file', file, url } | { type:'asset', asset } */
const pending = ref(null)

/* 素材筛选 */
const kw = ref('')
const catKey = ref('all')
const shown = ref(24)

const MAX_BYTES = 12 * 1024 * 1024

onMounted(() => {
  loadRemoteAssets()
  /* 深链：首页「没有图片？从免费素材开始」直接带 ?tab=library 过来，
     落到这一页时就把「免费素材」那一栏打开，不用再点一次。 */
  if (route.query.tab === 'library') tab.value = 'library'
  /* 顶栏、素材页等处上传的图片会先寄存在 pendingUpload 里（路由跳转丢不了 File 对象），
     到这里取出来直接进「图片已选好」确认页 —— 用户不必再选一次。 */
  if (pendingFile.value) {
    const carried = takePendingUpload()
    if (carried) acceptFile(carried)
  }
})

/* 顶栏的上传按钮在**已经站在首页**时也能用：这时路由不变、组件不重新挂载，
   只在 onMounted 取一次是取不到的 —— 所以盯着这个值变化。 */
watch(pendingFile, f => {
  if (!f) return
  const carried = takePendingUpload()
  if (carried) acceptFile(carried)
})

/* 分类：只用后台真实分类，并带上真实素材数 */
const cats = computed(() => {
  const list = remoteCategories.value || []
  const map = new Map()
  for (const c of list) {
    const n = allAssets.value.filter(a => a.cols.includes(c.slug)).length
    if (n > 0) map.set(c.slug, { slug: c.slug, name: c.name, count: n })
  }
  return [{ slug: 'all', name: '全部', count: allAssets.value.length }, ...map.values()]
})

/** 只展示免费素材（新手版不做会员分层，也不显示任何付费角标） */
const freeAssets = computed(() => allAssets.value.filter(a => a.tier !== 'pro'))

const filtered = computed(() => {
  const key = kw.value.trim().toLowerCase()
  let list = freeAssets.value
  if (catKey.value !== 'all') list = list.filter(a => a.cols.includes(catKey.value))
  if (key) {
    list = list.filter(a =>
      a.name.toLowerCase().includes(key) ||
      (a.description || '').toLowerCase().includes(key) ||
      a.tags.some(t => String(t).toLowerCase().includes(key))
    )
  }
  /* 入门素材排前面：新手先看简单好拼的 */
  return list.slice().sort((a, b) => {
    const ea = a.difficulty === '入门' ? 0 : 1
    const eb = b.difficulty === '入门' ? 0 : 1
    if (ea !== eb) return ea - eb
    if (!!a.feat !== !!b.feat) return a.feat ? -1 : 1
    return (b.hot || 0) - (a.hot || 0)
  })
})

const visible = computed(() => filtered.value.slice(0, shown.value))

/* ---------------------------------------------------------------- 上传 */
function pickFile() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (f) acceptFile(f)
}

function acceptFile(file) {
  err.value = ''
  if (!/^image\//.test(file.type || '')) {
    err.value = '请选择图片文件（JPG / PNG / WEBP）'
    toastErr(err.value)
    return
  }
  if (file.size > MAX_BYTES) {
    err.value = '图片不能超过 12MB，换一张小一点的试试'
    toastWarn(err.value)
    return
  }
  const url = URL.createObjectURL(file)
  pending.value = { type: 'file', file, url }
}

function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) acceptFile(f)
}

/* ---------------------------------------------------------------- 素材 */
function chooseAsset(asset) {
  err.value = ''
  pending.value = { type: 'asset', asset }
}

/* ---------------------------------------------------------------- 确认 */
function backToPick() {
  if (pending.value && pending.value.type === 'file') {
    URL.revokeObjectURL(pending.value.url)
  }
  pending.value = null
}

/** 确认这张图 → 真正生成图纸 */
async function confirm() {
  if (!pending.value || busy.value) return
  busy.value = true
  err.value = ''
  try {
    const ok = pending.value.type === 'file'
      ? await useImageFile(pending.value.file)
      : (await pickAsset(pending.value.asset)).ok
    if (!ok) {
      err.value = pending.value.type === 'file'
        ? '这张图片没能生成图纸，换一张试试'
        : '素材加载失败，请重试'
      return
    }
    emit('next')
  } catch (e) {
    err.value = e instanceof Error ? e.message : '处理失败，请重试'
  } finally {
    busy.value = false
  }
}

/** 确认页要显示的预览图 */
const previewUrl = computed(() => {
  if (!pending.value) return ''
  return pending.value.type === 'file' ? pending.value.url : (pending.value.asset.imageFull || pending.value.asset.image)
})
</script>

<template>
  <div class="bsel">
    <!-- ---------------------------------------------------------------- 确认页 -->
    <div v-if="pending" class="bsel__confirm">
      <div class="bsel__confirmArt">
        <img :src="previewUrl" alt="已选择的图片预览" class="bsel__preview">
      </div>
      <div class="bsel__confirmBody">
        <h3 class="bsel__confirmTitle">图片已选好</h3>
        <p class="bsel__confirmText">
          {{ pending.type === 'file' ? '这是你刚选的文件' : `这是你选的素材「${pending.asset.name}」` }}。
          下一步会自动算出拼豆图纸，尺寸和颜色还能随时改。
        </p>
        <p v-if="err" class="bsel__err">{{ err }}</p>
        <div class="bsel__confirmBtns">
          <button type="button" class="btn btn-secondary" :disabled="busy" @click="backToPick">重新选择</button>
          <button type="button" class="btn primary" :disabled="busy" @click="confirm">
            <PixelIcon v-if="!busy" name="arrowRight" :size="14" />
            {{ busy ? '正在生成图纸…' : '下一步：调整效果' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ---------------------------------------------------------------- 两个入口 -->
    <template v-else>
      <div class="tabs bsel__tabs" role="tablist">
        <button type="button" :class="{ on: tab === 'upload' }" role="tab" @click="tab = 'upload'">
          上传图片
        </button>
        <button type="button" :class="{ on: tab === 'library' }" role="tab" @click="tab = 'library'">
          免费素材
        </button>
      </div>

      <!-- 上传 -->
      <div v-show="tab === 'upload'" class="bsel__upload" :class="{ 'is-drag': dragOver }"
           @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop="onDrop">
        <input ref="fileInput" class="bsel__file" type="file" accept="image/*" @change="onFileChange">
        <div class="bsel__uploadIcon"><PixelIcon name="fn-upload" :size="26" /></div>
        <h3 class="bsel__uploadTitle">选一张图片开始</h3>
        <p class="bsel__uploadSub">照片、插画、表情包都行</p>
        <button type="button" class="btn primary" @click="pickFile">
          <PixelIcon name="fn-upload" :size="16" />
          选择图片
        </button>
        <p class="bsel__hint">也可以把图片拖到这里 · JPG、PNG、WEBP，最大 12MB</p>
        <p v-if="err" class="bsel__err">{{ err }}</p>
      </div>

      <!-- 免费素材 -->
      <div v-show="tab === 'library'" class="bsel__lib">
        <div class="bsel__libTop">
          <label class="bsel__search">
            <PixelIcon name="search" :size="15" />
            <input v-model="kw" type="search" placeholder="搜索素材…" aria-label="搜索素材">
          </label>
          <div class="bsel__cats">
            <button
              v-for="c in cats"
              :key="c.slug"
              type="button"
              class="bsel__cat"
              :class="{ on: catKey === c.slug }"
              @click="catKey = c.slug; shown = 24"
            >
              {{ c.name }}<em>{{ c.count }}</em>
            </button>
          </div>
        </div>

        <p v-if="remoteLoading" class="bsel__hint">素材加载中…</p>
        <p v-else-if="remoteError" class="bsel__err">素材加载失败：{{ remoteError }}（可稍后重试）</p>
        <p v-else-if="!filtered.length" class="bsel__hint">没有找到匹配的素材，换个关键词试试</p>

        <!-- 卡片区自己滚：素材再多也只是这一块在滚，整页不会越滚越长 -->
        <div class="bsel__libScroll">
          <div class="bsel__grid">
            <button
              v-for="a in visible"
              :key="a.id"
              type="button"
              class="bsel__card"
              @click="chooseAsset(a)"
            >
              <span class="bsel__cardThumb">
                <img :src="a.image" :alt="a.name" loading="lazy">
              </span>
              <span class="bsel__cardName">{{ a.name }}</span>
              <span class="bsel__cardMeta">{{ a.difficulty }} · {{ a.cat }}</span>
            </button>
          </div>

          <button
            v-if="visible.length < filtered.length"
            type="button"
            class="btn btn-secondary bsel__more"
            @click="shown += 24"
          >
            加载更多（还有 {{ filtered.length - visible.length }} 个）
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bsel__tabs{margin-bottom:14px}

/* ---- 上传区 ---- */
.bsel__upload{
  background:var(--surface);border:1.5px dashed var(--line-strong);border-radius:var(--r-lg);
  padding:26px 18px;text-align:center;transition:var(--t);
}
.bsel__upload.is-drag{border-color:var(--primary);background:var(--primary-soft)}
.bsel__file{display:none}
.bsel__uploadIcon{
  width:56px;height:56px;margin:0 auto 10px;border-radius:var(--r-md);
  display:grid;place-items:center;background:var(--primary-soft);
}
.bsel__uploadTitle{font-size:var(--fs-h3);margin-bottom:4px}
.bsel__uploadSub{font-size:var(--fs-xs);color:var(--muted);margin-bottom:14px}
.bsel__hint{font-size:var(--fs-2xs);color:var(--muted-2);margin-top:10px}
.bsel__err{
  font-size:var(--fs-xs);color:var(--danger);background:var(--danger-soft);
  border-radius:var(--r-sm);padding:8px 10px;margin-top:10px;
}

/* ---- 素材区 ---- */
.bsel__libTop{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}
.bsel__search{
  display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);
}
.bsel__search input{flex:1;min-width:0;border:0;background:transparent;outline:none;font-size:var(--fs-sm)}
.bsel__cats{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.bsel__cat{
  flex:0 0 auto;padding:6px 12px;border-radius:var(--r-pill);font-size:var(--fs-2xs);
  background:var(--surface);border:1px solid var(--line);color:var(--ink-2);font-weight:700;
}
.bsel__cat em{font-style:normal;color:var(--muted-2);margin-left:4px;font-weight:600}
.bsel__cat.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary-ink)}
.bsel__cat.on em{color:var(--primary-ink)}
.bsel__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
.bsel__card{
  display:flex;flex-direction:column;gap:5px;text-align:left;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  padding:8px;transition:var(--t);
}
.bsel__card:hover{border-color:var(--primary);box-shadow:var(--sh-hover);transform:translateY(-1px)}
.bsel__cardThumb{
  display:block;aspect-ratio:1;border-radius:var(--r-sm);overflow:hidden;background:var(--surface-3);
}
.bsel__cardThumb img{width:100%;height:100%;object-fit:cover;display:block}
.bsel__cardName{font-size:var(--fs-xs);font-weight:700;line-height:1.35}
.bsel__cardMeta{font-size:var(--fs-2xs);color:var(--muted-2)}
.bsel__more{margin-top:14px;width:100%}

/* ---- 确认页 ---- */
.bsel__confirm{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:18px;align-items:center}
.bsel__confirmArt{
  background:var(--surface-3);border-radius:var(--r-md);padding:10px;
  display:grid;place-items:center;min-height:170px;
}
.bsel__preview{max-width:100%;max-height:210px;object-fit:contain;display:block}
.bsel__confirmTitle{font-size:var(--fs-h3);margin-bottom:6px}
.bsel__confirmText{font-size:var(--fs-sm);color:var(--ink-2);line-height:1.7}
.bsel__confirmBtns{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}

/* ============================ 手机端：一屏 ============================ */
@media(max-width:780px){
  /* 这一步占满中间那块：入口区固定，卡片区自己滚 */
  .bsel{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}

  /* 两个入口平分一行，一直露在屏幕上 */
  .bsel__tabs{display:flex;width:100%;margin-bottom:8px}
  .bsel__tabs button{flex:1 1 0}

  /* 上传区压扁一点，把高度让给下面的内容 */
  .bsel__upload{
    flex:1 1 auto;min-height:0;padding:16px 12px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
  }
  .bsel__uploadIcon{width:46px;height:46px;margin-bottom:8px}
  .bsel__uploadTitle{font-size:var(--fs-sm)}
  .bsel__uploadSub{margin-bottom:12px}

  /* 素材区：搜索与分类固定在顶上，卡片区自己滚 */
  .bsel__lib{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
  .bsel__libTop{flex:0 0 auto;gap:8px;margin-bottom:8px}
  .bsel__libScroll{
    flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;
  }
  .bsel__grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
  .bsel__more{margin-top:10px;width:100%}

  /* 确认页：图小一点、字短一点，整页不出框 */
  .bsel__confirm{grid-template-columns:1fr;gap:10px;min-height:0;overflow-y:auto}
  .bsel__confirmArt{min-height:0;padding:8px}
  .bsel__preview{max-height:132px}
  .bsel__confirmTitle{font-size:var(--fs-sm);margin-bottom:4px}
  .bsel__confirmText{font-size:var(--fs-2xs);line-height:1.6}
  .bsel__confirmBtns{flex-direction:column-reverse;margin-top:10px}
  .bsel__confirmBtns .btn{width:100%}
}
</style>
