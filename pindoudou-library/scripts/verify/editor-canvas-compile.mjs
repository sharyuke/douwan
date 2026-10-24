/* =========================================================================
   组件编译检查 + 色号 LOD 规则检查

   为什么单独跑一遍编译：沙箱里起不了 Chrome，编辑器组件没法在浏览器里验证，
   但「模板语法 / script setup 语法 / 样式块能否解析」可以用 Vue 自己的
   compiler-sfc 在 Node 里过一遍 —— 这类错误（少个括号、写错的指令、
   模板里引用了不存在的变量之外的语法问题）到浏览器才发现就太晚了。

   另外确认色号 LOD 的关键分支还在：这条规则一旦被误删，
   20 万格下打开色号就会卡到几秒。

   跑法：node scripts/verify/editor-canvas-compile.mjs
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/* @vue/compiler-sfc 是 @vitejs/plugin-vue 的传递依赖，项目没直接声明它：
   npm 的扁平 node_modules 下从项目根 require 得到，pnpm 的隔离布局下它只躺在
   node_modules/.pnpm/<pkg>/node_modules 里，从 scripts/ 里 require 会 MODULE_NOT_FOUND
   （症状是整个脚本挂在 require 那一行上，一条断言都跑不到）。
   两条路都试，最后再原样抛出 —— 「装了但不在解析路径上」不该让这一节变成未捕获崩溃。
   export-plan-1000.mjs 的 ⑥ 用的是同一段兜底，两处保持一致。 */
function requireCompilerSfc() {
  const require = createRequire(import.meta.url)
  try {
    return require('@vue/compiler-sfc')
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err
    const store = path.resolve('node_modules/.pnpm')
    const dir = fs.existsSync(store)
      ? fs.readdirSync(store).find(d => d.startsWith('@vue+compiler-sfc@'))
      : null
    if (!dir) throw err
    return require(path.join(store, dir, 'node_modules', '@vue', 'compiler-sfc'))
  }
}

const sfc = requireCompilerSfc()

const file = path.resolve('src/components/editor/EditorCanvas.vue')
const source = fs.readFileSync(file, 'utf8')
let allOk = true

/* ---------------------------------------------------------------- ① 语法块解析 */
const { descriptor, errors } = sfc.parse(source, { filename: file })
console.log(`=== ${path.relative(process.cwd(), file)} ===`)
console.log(`parse 错误：${errors.length}`)
errors.forEach(e => console.log('  · ' + (e.message || e)))
allOk = errors.length === 0 && allOk

/* ---------------------------------------------------------------- ② script setup 编译 */
const script = sfc.compileScript(descriptor, { id: 'verify' })
console.log(`script setup 编译：${script.content.length} 字节，绑定 ${Object.keys(script.bindings || {}).length} 个`)
const bindings = Object.keys(script.bindings || {})
const needBindings = ['redrawCells', 'updateChartLayer', 'markChartLayer', 'canvasDpr', 'useLayer', 'hitCell', 'hitOpts', 'codesSuppressed']
const missingBindings = needBindings.filter(b => !bindings.includes(b))
console.log(missingBindings.length ? 'FAIL  缺少绑定：' + missingBindings.join(', ') : 'PASS  增量重绘 / LOD 相关绑定都在')
allOk = missingBindings.length === 0 && allOk

/* ---------------------------------------------------------------- ③ 模板编译 */
const template = sfc.compileTemplate({
  source: descriptor.template.content,
  filename: file,
  id: 'verify'
})
console.log(`模板编译错误：${template.errors.length}`)
template.errors.forEach(e => console.log('  · ' + (e.message || e)))
allOk = template.errors.length === 0 && allOk

/* ---------------------------------------------------------------- ④ 样式块 */
let styleRules = 0
for (const s of descriptor.styles) {
  const res = sfc.compileStyle({ source: s.content, filename: file, id: 'data-v-verify', scoped: s.scoped })
  styleRules += res.errors.length
  res.errors.forEach(e => console.log('  · ' + (e.message || e)))
}
console.log(`样式编译错误：${styleRules}`)
allOk = styleRules === 0 && allOk

/* ---------------------------------------------------------------- ⑤ 色号 LOD 规则 */
const checks = [
  ['单元格上限常量存在', /CODES_CELL_LIMIT\s*=\s*40000/],
  ['LOD 判断是「格子总数 > 上限」', /codesSuppressed[\s\S]{0,80}cellsCount\.value\s*>\s*CODES_CELL_LIMIT/],
  ['触发时把 codes 关掉（不改 drawChart 默认值）', /redrawOpts[\s\S]{0,220}codes:\s*false/],
  ['模板里有可见提示与「分板视图 / 导出」指路', /codesSuppressed[\s\S]{0,400}分板视图[\s\S]{0,120}导出/],
  ['只有豆子变化时走增量重绘', /watch\(pattern,\s*\(\)\s*=>\s*nextTick\(redrawCells\)\)/],
  ['缩放（hitCell）变化时作废图案层缓存', /watch\(hitCell,\s*\(\)\s*=>\s*\{\s*invalidateLayer\(\)/],
  ['图案层只在大画布启用', /MAX_LAYER_CELLS\s*=\s*20000/]
]
for (const [name, re] of checks) {
  const ok = re.test(source)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  allOk = ok && allOk
}

/* render.js 侧的契约：LOD 不能写进 drawChart，useLayer 默认关闭 */
const renderSrc = fs.readFileSync(path.resolve('src/lib/render.js'), 'utf8')
const renderChecks = [
  ['drawChart 默认不启用图案层（导出仍逐格精绘）', /useLayer\s*=\s*!!o\.useLayer/],
  ['drawChart 不自行判断色号 LOD', !/CODES_CELL_LIMIT|cells\.length\s*>\s*40000/.test(renderSrc)],
  ['导出/预览用的 drawPixels 未被改动成图案层', /export function drawPixels\(el, pattern, \{ maxSize = 420/.test(renderSrc)],
  ['drawChart / drawBoard / chartGeometry / hitTest / drawPixels 签名未变', /export function drawChart\(el, pattern, opts = \{\}, geo = null\)/.test(renderSrc) && /export function drawBoard\(el, pattern, board, \{/.test(renderSrc) && /export function chartGeometry\(pattern, opts = \{\}\)/.test(renderSrc) && /export function hitTest\(el, pattern, evt, opts = \{\}\)/.test(renderSrc)]
]
console.log('')
for (const [name, ok] of renderChecks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  allOk = ok && allOk
}

console.log('')
console.log(allOk ? '✅ 编译与规则检查通过' : '❌ 有失败项')
process.exit(allOk ? 0 : 1)
