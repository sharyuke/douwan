/* 套索平移：从一份「按下前」的格子算出挪完的结果。
   拖动中的每一步都用同一份底稿加重置后的总位移，不要在上一步的结果上再挪。
   否则选区扫过的、本来没选中的豆子会被盖住，选区再挪开也回不来。 */

const EMPTY = -1

function outsideKeySet(list) {
  const set = new Set()
  if (!list) return set
  for (let i = 0; i < list.length; i++) set.add(list[i].x + ',' + list[i].y)
  return set
}

/**
 * @param {Int32Array|ArrayLike<number>} cells 按下前的格子，-1 是空格
 * @param {number} width
 * @param {number} height
 * @param {Array<{x:number,y:number,k:number,marked?:boolean}>|null} offscreen
 * @param {number} dx
 * @param {number} dy
 * @param {Uint8Array|null} mask 局部选区。缺省时搬所有有豆的格子
 * @param {Array<{x:number,y:number}>|null} outside 局部选区已经在画布外的格子
 * @param {Set<number>|null} progress 按下前打过勾的格子下标
 * @returns {{
 *   cells: Int32Array,
 *   offscreen: Array,
 *   moved: boolean,
 *   marks: number[],
 *   lifted: number[]
 * }}
 */
export function translateBeads({ cells, width, height, offscreen, dx, dy, mask, outside, progress }) {
  const next = Int32Array.from(cells)
  const picked = []
  const parked = []
  const outsideKey = mask ? outsideKeySet(outside) : null
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      if (mask && !mask[i]) continue
      const k = cells[i]
      if (k < 0) continue
      next[i] = EMPTY
      picked.push({ x, y, k, i })
    }
  }
  const held = offscreen || []
  for (let i = 0; i < held.length; i++) {
    const bead = held[i]
    if (mask && !outsideKey.has(bead.x + ',' + bead.y)) {
      parked.push({ x: bead.x, y: bead.y, k: bead.k, marked: !!bead.marked })
      continue
    }
    picked.push({ x: bead.x, y: bead.y, k: bead.k, i: -1, marked: !!bead.marked })
  }
  const marks = []
  const lifted = []
  if (!picked.length) return { cells: next, offscreen: parked, moved: false, marks, lifted }
  for (const bead of picked) {
    const marked = bead.i >= 0 ? !!(progress && progress.has(bead.i)) : !!bead.marked
    if (bead.i >= 0 && marked) lifted.push(bead.i)
    const nx = bead.x + dx
    const ny = bead.y + dy
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      parked.push({ x: nx, y: ny, k: bead.k, marked })
      continue
    }
    next[ny * width + nx] = bead.k
    if (marked) marks.push(ny * width + nx)
  }
  return { cells: next, offscreen: parked, moved: true, marks, lifted }
}
