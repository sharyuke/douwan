/* =========================================================================
   本机存档的紧凑编码（画布格子 / 拼制进度）
   -------------------------------------------------------------------------
   为什么需要这个文件：

   作品存在 localStorage 里，而 localStorage 只有约 5 MB，且写满会直接抛错。
   旧存法把每一格写成一个色号字符串（"H12"、null 之类），一格 5~6 个字符：
     116×116 = 13,456 格 ≈ 80 KB  —— 还忍得住
     300×300 = 90,000 格 ≈ 0.65 MB —— 一个作品存 3 个方案 ≈ 2 MB，存两个就爆
     450×450 = 202,500 格 ≈ 1.5 MB —— 连一个作品都存不下
   于是「精细档能转出来、但存不住」——对用户来说等于白转。

   这里改成**一格一个字符**的下标编码：色号已经单独存在 paletteCodes 里，
   cells 只需要存「第几号色」这种小整数，用一个可打印字符表示即可。
   同样的 450×450 图纸从 1.5 MB 降到约 200 KB（色号种类 ≤ 547 时），
   1000×1000（100 万格）也从 15 MB 降到约 1 MB —— 这才是「精细档能转出来、也能存住」。
   即便如此，1000 格 × 3 个方案 = 300 万字符，已经吃掉 localStorage 约 500 万配额的一大半，
   所以 useStudio.saveProject 会按真实体积决定「存几个方案」（见那里的 trimVariantsToFit）。

   为什么不用真正的压缩算法（RLE / LZ）：照片转出来的图案本身是噪声型的，
   相邻格颜色高度不一致，RLE 常常越压越大（实测跑一次就知道）；而 LZ 需要额外依赖或
   自己实现几百行。一格一字符是「零依赖 + 稳定 7 倍」的性价比选择。
   真正的体积大头是格子数，不是重复度。

   字符集为什么要挑：JSON.stringify 会转义 " 和 \（每个字符从 1 字节涨到 2 字节），
   所以可打印 ASCII 里必须先排除它们，剩下 91 个 —— 也就是最多 90 种色号。
   而 90 曾经被当成「引擎色号上限」写进 `MAX_TARGET_COLORS`：**画质反过来被存档格式定了**，
   色板（漫德 MARD 221 色）明明有 221 个色号可用，引擎却只允许选 90 个。

   现在的做法是把字符集一路扩到 548 个（91 个 ASCII + 457 个 BMP 字符），容量 547：
   BMP 字符在 JS 字符串里同样只占 1 个 UTF-16 单元，JSON.stringify 也不转义它
   （只转义 " \ 与控制字符），localStorage 的配额按 UTF-16 单元算 ——
   所以「一格一字符」的体积一分没涨。扩了两次，两次都是被色板推着走的：
     · 90 → 255：91 个 ASCII + 165 个 BMP 字符，让漫德 221 色的色板能整块用上；
     · 255 → 547：色板扩到 291 色（漫德 MARD 291 / COCO 291）之后 255 又不够了，
       于是把之前截掉的拉丁扩展-A 补齐、再接上拉丁扩展-B。
   多出来的余量不是摆设：优肯 418 色（C197 + M221）那种更大的色板也装得下。

   ⚠️ 顺序不能重排：前 91 个字符必须原样保持 ASCII 的先后，否则老存档整体串色。
   BIT_ALPHABET（拼制进度位图）取的是前 64 个，也因此仍然全是 ASCII。
   真出现超过 547 种色号（自定义色板 + 手动换色）就退回旧格式存，解码端两种都能读。
   ========================================================================= */

import { toPatternJSON, fromPatternJSON } from './pattern.js'

/* 前 91 个字符：! 到 ~ 去掉 " 和 \（顺序是老存档的一部分，不许改） */
const ASCII = "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~"

/** 闭区间码点 → 字符串；跳过代理区（孤立代理会被 JSON.stringify 转义成 \udXXX，一格涨到 7 字符） */
function bmpRange(from, to) {
  let out = ''
  for (let c = from; c <= to; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue
    out += String.fromCharCode(c)
  }
  return out
}

/* 追加的 457 个字符：希腊字母 / 西里尔字母 / 拉丁扩展-A / 拉丁扩展-B。
   都是「有字形、不与 JSON 冲突、都落在 BMP」的连续区段 —— 挑连续区段是为了让
   CHAR_INDEX 与人工排查都简单。⚠️ 顺序固定，与 ASCII 一样属于存档格式的一部分：
   前 256 个字符与「容量 255」那一版逐字相同（老存档必须还能原样解开），
   新增的字符一律接在**末尾**。 */
const EXTRA = bmpRange(0x0391, 0x03c9) + bmpRange(0x0410, 0x044f)
  + bmpRange(0x0100, 0x017f) + bmpRange(0x0180, 0x024f)

/* ⚠️ 不要再 slice 到 256：容量必须 ≥ 引擎色号上限（MAX_TARGET_COLORS = 291）。
   截断只发生在「容量 255」那一版，现在整段都用上（容量 547）。 */
const ALPHABET = ASCII + EXTRA

/** 一张图纸最多能存多少种色号（第 0 号字符留给「空格」，见下）。
 *  必须 ≥ pattern.js 的 MAX_TARGET_COLORS，否则引擎允许选的色号存不下来。 */
export const PACK_CAPACITY = ALPHABET.length - 1

/** 第 0 号字符固定表示「空格（不放豆）」，1 号起对应 paletteCodes 的下标 +1 */
const EMPTY_CHAR = ALPHABET[0]

/** 这张图案能不能用紧凑格式存（色号种类不多于字符集容量） */
export function canPack(pattern) {
  return !!pattern && pattern.palette.length <= PACK_CAPACITY
}

const CHAR_INDEX = new Map()
for (let i = 0; i < ALPHABET.length; i++) CHAR_INDEX.set(ALPHABET[i], i)

/** cells（下标数组，-1 = 空格）→ 一格一字符的字符串 */
export function encodeCells(cells) {
  const out = new Array(cells.length)
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]
    out[i] = v < 0 ? EMPTY_CHAR : ALPHABET[v + 1]
  }
  return out.join('')
}

/**
 * 紧凑字符串 → 色号数组（null 表示空格），交给 fromPatternJSON 还原。
 *
 * 为什么解码成「色号」而不是「下标」：fromPatternJSON 建色板时会跳过当前品牌里
 * 查不到的色号，下标顺序因此可能和存档里的 paletteCodes 不完全一致。
 * 走色号复原，等于让 fromPatternJSON 用它自己那套（已经被回归测试盯住的）逻辑建表，
 * 我们这边不需要重复一份、也不会因为品牌色板变动而错位。
 */
export function decodeCells(str, paletteCodes) {
  const codes = paletteCodes || []
  const out = new Array(str.length)
  for (let i = 0; i < str.length; i++) {
    const k = CHAR_INDEX.get(str[i])
    out[i] = k > 0 ? (codes[k - 1] ?? null) : null
  }
  return out
}

/**
 * 作品里的一个方案 → 存档用的对象。
 * 色号种类过多时原样返回旧格式（cells 是色号数组），读取端两种都认。
 */
export function packPattern(pattern, extra = {}) {
  const json = toPatternJSON(pattern, extra)
  if (!canPack(pattern)) return json
  const { cells, ...rest } = json
  return { ...rest, packed: encodeCells(pattern.cells) }
}

/** 存档对象 → pattern（新旧两种格式都接） */
export function unpackPattern(json, brandId) {
  if (json && typeof json.packed === 'string') {
    return fromPatternJSON({ ...json, cells: decodeCells(json.packed, json.paletteCodes) }, brandId)
  }
  return fromPatternJSON(json, brandId)
}

/**
 * 存档里「真正要放的豆数」（空格不算）。
 *
 * 为什么需要：`stats.beadCount` 是后来才加进存档的字段，作品列表 / 账户页对
 * 更早的存档要自己数一遍格子。数法必须两种格式都认 —— 只认 cells 数组的话，
 * 换成紧凑格式之后这些地方会一律数出 0，进度条就直接显示 0%（而且不报错，最难发现）。
 */
export function packedBeadCount(json) {
  if (!json) return 0
  if (typeof json.packed === 'string') {
    let n = 0
    for (let i = 0; i < json.packed.length; i++) if (json.packed[i] !== EMPTY_CHAR) n++
    return n
  }
  if (Array.isArray(json.cells)) return json.cells.filter(c => c != null).length
  return 0
}

/* -------------------------------------------------------------- 拼制进度 */

/* 进度是一组格子下标。450×450 全标完是 202,500 个数字，按 JSON 数组存 ≈ 1.2 MB，
   比图纸本身还大。这里改成位图：每 6 bit 一个字符（64 个字符足够表示 6 bit），
   同样的进度只占 34 KB。 */
const BIT_ALPHABET = ALPHABET.slice(0, 64)

/** 下标数组 / Set → 位图字符串（没有进度时返回 null，和旧的存档格式保持一致） */
export function packProgress(list) {
  const arr = list instanceof Set ? Array.from(list) : (Array.isArray(list) ? list : [])
  if (!arr.length) return null
  let max = 0
  for (const v of arr) if (Number.isFinite(v) && v > max) max = v
  /* 不用 Math.max(...arr)：20 万个参数会把调用栈撑爆 */
  const bits = new Uint8Array(Math.ceil((max + 1) / 6))
  /* 用位图本身去重：同一个下标重复出现时置位是幂等的，
     不需要再建一个 Set —— 1000×1000 完成时进度有 100 万个下标，
     那个去重 Set 就是 30~40 MB 的瞬时内存，而这里只要 167 KB。 */
  for (const v of arr) {
    if (!Number.isFinite(v) || v < 0) continue
    bits[(v / 6) | 0] |= 1 << (v % 6)
  }
  let out = ''
  for (let i = 0; i < bits.length; i++) out += BIT_ALPHABET[bits[i]]
  return out
}

/** 位图字符串 → 下标数组（兼容旧的数组格式；两种都读得回来） */
export function unpackProgress(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw) return []
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const b = BIT_ALPHABET.indexOf(raw[i])
    if (b <= 0) continue
    for (let k = 0; k < 6; k++) if (b & (1 << k)) out.push(i * 6 + k)
  }
  return out
}
