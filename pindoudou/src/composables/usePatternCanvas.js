/* =========================================================================
   把 Pattern 画进 <canvas> 的组合式函数
   为什么单独抽出来：
     画布渲染依赖「元素已挂载」+「数据已就绪」两个条件。之前把判断写在组件的
     onMounted 里，一旦 mounted 早于数据就绪（异步生成），就会静默画出一张空画布。
     这里改成 watch(..., { immediate: true, flush: 'post' })，元素和数据任一变化都重画，
     不再依赖调用顺序。
   ========================================================================= */

import { onMounted, ref, watch } from 'vue'
import { drawChart, drawPixels, drawBoard } from '../lib/render.js'

/**
 * @param {Function} getPattern () => Pattern | null
 * @param {object} opts
 *   mode: 'chart' | 'pixels' | 'board'
 *   config: (pattern) => object   重绘时重新求值的绘制参数
 *   sig:    () => any             额外的重绘信号（缩放、开关等标量）
 */
export function usePatternCanvas(getPattern, { mode = 'pixels', config = () => ({}), sig = () => '' } = {}) {
  const canvasRef = ref(null)

  function paint() {
    const el = canvasRef.value
    const pattern = getPattern()
    if (!el || !pattern || !pattern.cells || !pattern.cells.length) return
    const cfg = config(pattern) || {}
    if (mode === 'chart') drawChart(el, pattern, cfg)
    else if (mode === 'board') drawBoard(el, pattern, cfg.board, cfg)
    else drawPixels(el, pattern, cfg)
  }

  watch(
    [() => getPattern(), () => sig()],
    () => paint(),
    { immediate: true, flush: 'post' }
  )

  // 元素本身可能在 v-if 之后才出现，挂载后再补一次
  onMounted(paint)

  return { canvasRef, paint }
}
