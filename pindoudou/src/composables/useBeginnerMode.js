/* =========================================================================
   新手模式 / 专业模式 —— 模式状态与切换保护
   -------------------------------------------------------------------------
   为什么单独一个文件：新手版和专业版共用**同一份作品状态**（useStudio 里的
   sourceImg / variants / options / manualEdited），模式只决定「显示哪一层界面」。
   所以模式状态不能住在任何一个视图里 —— 顶栏、首页、向导、工作台都要读它。

   口径（三条，PRD §模式切换状态机）：
   ① 新手 → 专业：只切显示，图纸内容、尺寸、色号、素材来源、项目 ID 一个都不动；
   ② 专业 → 新手：如果这张图被手工改过（manualEdited），先提醒再切，
      切过去默认落在「获取图纸」这一步，**不自动按新手默认参数重新生成**；
   ③ 模式不写进 localStorage —— 记住上次的专业模式会让「打开就回专业版」。
      专业工作台在 /editor 上，刷新仍在专业版，不受影响；
      操作台（/create）刷新仍在操作台。

   跳转由 App.vue 监听 mode 完成（路由只能在 setup 上下文里用）。
   ========================================================================= */

import { computed, reactive, ref } from 'vue'
import { hasPattern, manualEdited } from './useStudio.js'

/** 当前模式：'beginner' 新手简化版 | 'pro' 专业工作台 */
export const mode = ref('beginner')

export const isBeginner = computed(() => mode.value === 'beginner')
export const isPro = computed(() => mode.value === 'pro')

/** 切模式（视图层负责跳转，这里只改状态） */
export function setMode(next) {
  mode.value = next === 'pro' ? 'pro' : 'beginner'
}

/**
 * 切到专业模式之前要不要拦一下。
 *
 * 专业 → 新手 且图被手工改过 ⇒ 需要确认（弹层由调用方渲染）。
 * 返回 { needConfirm: boolean, reason: string }
 */
export function switchGuard(target) {
  if (target === 'beginner' && hasPattern.value && manualEdited.value) {
    return {
      needConfirm: true,
      reason: '这张图纸被逐颗修改过。切到新手版不会自动重画，当前的手工修改会原样保留。'
    }
  }
  return { needConfirm: false, reason: '' }
}

/**
 * 新手版里改参数（尺寸 / 颜色数）会重新生成图纸 —— 会不会冲掉手工修改？
 * 会。所以这里给出统一的判断，调用方据此弹「保留 / 另存一版」的保护弹层。
 */
export function paramGuard() {
  if (!hasPattern.value || !manualEdited.value) return { needConfirm: false }
  return {
    needConfirm: true,
    reason: '改这个参数会重新计算图纸，专业模式里逐颗改过的格子会被覆盖。'
  }
}

/* ---------------------------------------------------------------- 切换弹层 */

/** 模式切换确认弹层（全局只挂一个，App.vue 渲染） */
export const switchDialog = reactive({
  open: false,
  target: 'beginner',
  reason: '',
  /* 触发来源：'header' 顶栏切换 | 'wizard' 向导里的「进入专业模式」 */
  from: 'header'
})

/**
 * 请求切换模式。
 * 需要确认时只开弹层，不切；确认后由 confirmSwitch() 真正切。
 */
export function requestSwitch(target, from = 'header') {
  const g = switchGuard(target)
  if (g.needConfirm) {
    switchDialog.open = true
    switchDialog.target = target
    switchDialog.reason = g.reason
    switchDialog.from = from
    return false
  }
  setMode(target)
  return true
}

/** 用户在弹层里点「继续切换」 */
export function confirmSwitch() {
  setMode(switchDialog.target)
  switchDialog.open = false
}

/** 用户在弹层里点「取消」 */
export function cancelSwitch() {
  switchDialog.open = false
}
