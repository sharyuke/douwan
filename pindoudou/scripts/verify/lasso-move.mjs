/* 套索局部平移：没选中的豆子要留在原地。
   拖过它们时可以暂时被选中的豆子盖住，选区再挪开必须回来。 */
import { translateBeads } from '../../src/lib/lassoMove.js'

let failed = 0
function check(name, ok) {
  if (ok) console.log('ok', name)
  else { failed++; console.log('FAIL', name) }
}
function same(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const cells = Int32Array.from([1, 2, 3, 4])
const mask = new Uint8Array([1, 0, 0, 0])

const step1 = translateBeads({ cells, width: 4, height: 1, offscreen: [], dx: 1, dy: 0, mask, outside: null, progress: null })
check('挪一格盖住旁边那颗', same(step1.cells, [-1, 1, 3, 4]))

const step2 = translateBeads({ cells, width: 4, height: 1, offscreen: [], dx: 2, dy: 0, mask, outside: null, progress: null })
check('再往前一格，刚才被盖住的豆子回来', same(step2.cells, [-1, 2, 1, 4]))

const step3 = translateBeads({ cells, width: 4, height: 1, offscreen: [], dx: 3, dy: 0, mask, outside: null, progress: null })
check('落到最后一颗上，中间两颗都还在', same(step3.cells, [-1, 2, 3, 1]))

const back = translateBeads({ cells, width: 4, height: 1, offscreen: [], dx: -1, dy: 0, mask, outside: null, progress: null })
check('拖出画布只带走选中的那颗', same(back.cells, [-1, 2, 3, 4]) && back.offscreen.length === 1 && back.offscreen[0].k === 1 && back.offscreen[0].x === -1)

const whole = translateBeads({ cells, width: 4, height: 1, offscreen: [], dx: 1, dy: 0, mask: null, outside: null, progress: null })
check('整张一起挪，豆子都不丢', same(whole.cells, [-1, 1, 2, 3]) && whole.offscreen.length === 1 && whole.offscreen[0].k === 4)

const parked = [{ x: -2, y: 0, k: 9, marked: false }]
const keepParked = translateBeads({ cells, width: 4, height: 1, offscreen: parked, dx: 1, dy: 0, mask, outside: [], progress: null })
check('没选中的画布外豆子留在原地', keepParked.offscreen.some(b => b.k === 9 && b.x === -2) && same(keepParked.cells, [-1, 1, 3, 4]))

const progress = new Set([0, 1])
const marks = translateBeads({ cells, width: 4, height: 1, offscreen: [], dx: 2, dy: 0, mask, outside: null, progress })
check('选中的勾跟着走，没选中的勾留在原地', marks.lifted.length === 1 && marks.lifted[0] === 0 && marks.marks.length === 1 && marks.marks[0] === 2)

if (failed) {
  console.log(failed + ' failed')
  process.exit(1)
}
console.log('lasso-move ok')
