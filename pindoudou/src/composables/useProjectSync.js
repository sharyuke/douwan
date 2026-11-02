/* =========================================================================
   作品存档的跨设备同步
   -------------------------------------------------------------------------
   以前「我的作品」只写 localStorage：同一个账号在手机 / 平板 / 电脑登录，
   看到的都是各自浏览器里的那一份。这里把作品按账号存到服务端：

   - 保存 / 删除 / 完成 / 记进度 → useStudio.persist() 通知本模块 → 推到服务端
   - 打开应用 / 登录 / 换账号 → 拉服务端列表，与本机合并
   - 合并规则：同一个 id 取 updatedAt 较新的那份；服务端没有、本机也没改过的，
     视为「另一台设备删掉了」，从本机移除（避免删了又被带回来）
   - 删除用 tombstone 记录：离线删除也能在下次联网时补上

   服务端只存前端那份紧凑 JSON（见 douwan-api 的 project 模块），
   本模块负责打包 / 解包（useStudio 的 packedProjects / applySyncedProjects）。
   ========================================================================= */

import { computed, ref, watch } from 'vue'
import { ApiError, CODE, api } from '../lib/api.js'
import { currentUser, isAnonymousDevice } from './useUserAccount.js'
import {
  applySyncedProjects, onProjectsPersisted, packedProjects, projects
} from './useStudio.js'

const META_KEY = 'douzao-projects-sync-v1'
const TOMB_KEY = 'douzao-projects-tombstones-v1'
const SWITCH_BACKUP_KEY = 'douzao-projects-v2:switched'
/* 保存后等一小会儿再推：连续点保存 / 改参数时只发最后一次。 */
const PUSH_DELAY_MS = 900

/** 同步状态：idle | syncing | error */
export const projectSyncState = ref('idle')
export const projectSyncError = ref('')
export const lastProjectSyncAt = ref(readMeta()?.lastSyncAt || 0)

/** 当前账号是否真的能把作品同步到别处（未登录时为 false） */
export const canSyncProjects = computed(() => !!currentUser.value)

let syncPromise = null
let pushPromise = null
let pushAgain = false
let pushTimer = null
/* 应用同步结果时会触发 persist()，不能再反过来安排一次同步 */
let applying = false

function readMeta() {
  try {
    const raw = JSON.parse(localStorage.getItem(META_KEY) || 'null')
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    return null
  }
}

function writeMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* 隐私模式 / 配额满：同步状态记不下来，但作品本身不受影响 */
  }
}

function readTombstones() {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMB_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(t => t && t.id) : []
  } catch {
    return []
  }
}

function writeTombstones(list) {
  try {
    localStorage.setItem(TOMB_KEY, JSON.stringify(list))
  } catch {
    /* 同上 */
  }
}

function projectTime(p) {
  return Number(p && p.updatedAt) || 0
}

function byId(list) {
  const map = new Map()
  for (const item of list) {
    if (item && item.id) map.set(String(item.id), item)
  }
  return map
}

/* 换到另一个真实账号时，本机这份属于上一个账号。留一份小备份做兜底；
   超过 1.5 MB 就不备份了 —— 备份本身会把 localStorage 配额吃掉，反而害得新作品存不下。 */
function backupBeforeAccountSwitch(list, previousUserId) {
  if (!list.length) return
  try {
    const text = JSON.stringify(list)
    if (text.length > 1500000) return
    localStorage.setItem(SWITCH_BACKUP_KEY, JSON.stringify({
      fromUserId: previousUserId || 0,
      at: Date.now(),
      projects: list
    }))
  } catch {
    /* 备份失败不能阻断登录 */
  }
}

/** 把当前账号待补的删除请求发出去。返回仍失败、留待下次重试的条目。 */
async function flushTombstones(userId) {
  const all = readTombstones()
  if (!all.length) return
  const remain = []
  for (const t of all) {
    if (Number(t.userId) !== userId) {
      remain.push(t)
      continue
    }
    try {
      await api.del('/projects/' + encodeURIComponent(t.id))
    } catch (e) {
      if (e instanceof ApiError && e.code === CODE.NOT_FOUND) continue
      remain.push(t)
    }
  }
  writeTombstones(remain)
}

/**
 * 拉服务端列表并与本机合并。
 *
 * @param {{force?: boolean}} opts force 暂时没有特殊分支，保留给以后「手动重新同步」
 */
export async function syncProjects(opts = {}) {
  const user = currentUser.value
  if (!user || !user.id) return { ok: false, reason: 'guest' }
  if (syncPromise) return syncPromise
  syncPromise = doSync(user, opts).finally(() => { syncPromise = null })
  return syncPromise
}

async function doSync(user, opts = {}) {
  const userId = Number(user.id)
  projectSyncState.value = 'syncing'
  projectSyncError.value = ''
  try {
    await flushTombstones(userId)

    const serverRaw = await api.get('/projects')
    const serverList = Array.isArray(serverRaw) ? serverRaw : []
    const meta = readMeta()
    const sameAccount = !!meta && Number(meta.userId) === userId
    const anonymous = !!isAnonymousDevice.value
    /* 第一次同步，或者从「本机访客」登录到真实账号：把本机作品带进这个账号。
       用户在本机做了半天图，登录后不该看到空白作品列表。 */
    const adoptLocal = !meta || (!!meta.anonymous && !anonymous)
    const foreignAccount = !!meta && Number(meta.userId) > 0 && Number(meta.userId) !== userId && !adoptLocal

    const serverMap = byId(serverList)
    const localMap = byId(packedProjects())
    const finalMap = new Map(serverMap)
    const items = {}
    const uploads = []

    for (const [id, p] of serverMap) items[id] = projectTime(p)

    if (foreignAccount) {
      /* 换了一个真实账号：本机这份是上一个账号的，不能塞进新账号。
         服务端列表就是新账号的全部作品。 */
      backupBeforeAccountSwitch([...localMap.values()], meta.userId)
    } else {
      const lastSyncAt = sameAccount ? Number(meta.lastSyncAt) || 0 : 0
      const known = sameAccount && meta.items && typeof meta.items === 'object' ? meta.items : {}
      for (const [id, local] of localMap) {
        const localTime = projectTime(local)
        const server = serverMap.get(id)
        if (server) {
          /* 两边都有：取较新的一份。服务端较新就留在 finalMap 里（上面已经放好）。 */
          if (localTime > projectTime(server)) {
            finalMap.set(id, local)
            uploads.push(local)
          }
          continue
        }
        /* 服务端没有：可能是本机新增，也可能是别的设备已经删掉。 */
        const wasSynced = Object.prototype.hasOwnProperty.call(known, id)
        const deletedRemotely = sameAccount && wasSynced && localTime <= lastSyncAt
        if (deletedRemotely) continue
        finalMap.set(id, local)
        uploads.push(local)
      }
    }

    /* 逐件上传：某一件失败（网络抖动 / 体积超限）不能拖累其它作品。 */
    for (const item of uploads) {
      try {
        await api.put('/projects/' + encodeURIComponent(item.id), item)
        items[item.id] = projectTime(item)
      } catch (e) {
        projectSyncError.value = e instanceof ApiError ? e.message : '部分作品同步失败'
      }
    }

    const finalList = [...finalMap.values()].sort((a, b) => projectTime(b) - projectTime(a))
    applying = true
    try {
      const applied = applySyncedProjects(finalList)
      if (!applied) {
        projectSyncError.value = '本机存储空间不足，作品没能写入本机'
      } else if (projects.value.length < finalList.length) {
        projectSyncError.value = `本机存储空间不足，${finalList.length - projects.value.length} 件作品暂未下载`
      }
    } finally {
      applying = false
    }

    const now = Date.now()
    writeMeta({ userId, anonymous, lastSyncAt: now, items })
    lastProjectSyncAt.value = now
    projectSyncState.value = projectSyncError.value ? 'error' : 'idle'
    return { ok: !projectSyncError.value, count: finalList.length }
  } catch (e) {
    projectSyncState.value = 'error'
    projectSyncError.value = e instanceof ApiError ? e.message : '同步失败，本机作品仍保留'
    return { ok: false, reason: 'error', message: projectSyncError.value }
  }
}

/**
 * 把本机有改动、还没上传的作品推到服务端（不拉列表）。
 *
 * 保存 / 完成 / 记进度都会走这里；比每次全量 sync 轻得多。
 * 第一次同步（meta 还不属于当前账号）时退回全量 sync。
 */
async function pushLocalChanges() {
  const user = currentUser.value
  if (!user || !user.id) return { ok: false, reason: 'guest' }
  if (syncPromise) return syncPromise
  if (pushPromise) {
    pushAgain = true
    return pushPromise
  }
  pushPromise = doPush(user).finally(() => {
    pushPromise = null
    if (pushAgain) {
      pushAgain = false
      pushLocalChanges().catch(() => {})
    }
  })
  return pushPromise
}

async function doPush(user) {
  const userId = Number(user.id)
  const meta = readMeta()
  if (!meta || Number(meta.userId) !== userId) {
    /* 还没和这个账号对齐过：先走一次完整合并，免得把上一个账号的作品传上去 */
    return syncProjects()
  }

  projectSyncState.value = 'syncing'
  projectSyncError.value = ''
  const items = { ...(meta.items || {}) }
  let failed = false

  for (const item of packedProjects()) {
    const id = item && item.id
    if (!id) continue
    const updated = projectTime(item)
    if (items[id] && updated <= Number(items[id])) continue
    try {
      await api.put('/projects/' + encodeURIComponent(id), item)
      items[id] = updated
    } catch (e) {
      failed = true
      projectSyncError.value = e instanceof ApiError ? e.message : '同步失败，本机作品仍保留'
    }
  }

  writeMeta({ ...meta, items })
  projectSyncState.value = failed ? 'error' : 'idle'
  return { ok: !failed }
}

function schedulePush(delay = PUSH_DELAY_MS) {
  if (applying || !currentUser.value) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    pushLocalChanges().catch(() => {})
  }, delay)
}

/** 立即把待上传的改动推上去（退出登录前用，避免刚保存的作品没赶上 900ms 防抖）。 */
export async function flushProjectSync() {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  if (!currentUser.value) return { ok: false, reason: 'guest' }
  return pushLocalChanges()
}

/**
 * 记录一次删除。删除后本机已经没有这件作品，光靠「上传现有列表」推不出删除，
 * 所以单独记 tombstone；离线删除会在下次同步时补发。
 */
export function queueProjectDelete(id) {
  const user = currentUser.value
  if (!user || !user.id || !id) return
  const userId = Number(user.id)
  const list = readTombstones().filter(t => !(String(t.id) === String(id) && Number(t.userId) === userId))
  list.push({ id: String(id), userId, at: Date.now() })
  writeTombstones(list)
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  flushTombstones(userId).catch(() => {})
}

/* 应用启动时注册：保存 / 删除 / 完成作品等动作都会走 persist()。 */
onProjectsPersisted(() => schedulePush())

/* 登录、退出、换账号时自动同步一次。
   bootstrapDevice() 也会写 currentUser，所以这里能覆盖「打开就是已登录」。 */
watch(
  () => (currentUser.value ? Number(currentUser.value.id) : 0),
  (id, prev) => {
    if (!id || id === prev) return
    /* 让登录流程先把令牌 / 权益写完，再开始同步 */
    setTimeout(() => { syncProjects().catch(() => {}) }, 0)
  },
  { flush: 'post' }
)

/** 作品总数（给界面显示用；与 projects.length 同源） */
export const syncedProjectCount = computed(() => projects.value.length)
