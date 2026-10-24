/* =========================================================================
   本机存档紧凑编码的验证（开发用，Node 直接跑，不需要浏览器）

   为什么要有这个：存档编码一旦错了，表现是「作品存下来、重新打开颜色全乱 / 少了格子」——
   而这件事平时根本不会触发（要存够大、要重新打开）。所以这里把编码、解码、
   与旧格式的互相兼容一次性钉死，顺便把「到底省了多少」量出来，避免以后有人
   凭感觉改编码。

   用法：node scripts/verify-archive.mjs
   ========================================================================= */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateFromPixels, MAX_TARGET_COLORS } from '../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../src/lib/palettes.js'
import { encodeCells, decodeCells, canPack, packPattern, unpackPattern, packProgress, unpackProgress, packedBeadCount, PACK_CAPACITY } from '../src/lib/archive.js'
import { toPatternJSON } from '../src/lib/pattern.js'
import { readPNG } from './fidelity/png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'fidelity', 'fixtures', 'photo_pumpkin.png')

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failed++
}

/* ---------------------------------------------------- 1. 纯编码往返（含空格与多色） */

{
  const cells = new Int32Array(997)
  for (let i = 0; i < cells.length; i++) {
    /* 刻意混上 -1（空格）与 0（第一号色）：这两者最容易在「空 = null / 空 = 0」上串位 */
    cells[i] = i % 13 === 0 ? -1 : (i * 7) % 31
  }
  const str = encodeCells(cells)
  const back = decodeCells(str, Array.from({ length: 31 }, (_, i) => `C${i}`))
  let bad = -1
  for (let i = 0; i < cells.length; i++) {
    const want = cells[i] < 0 ? null : `C${cells[i]}`
    if (back[i] !== want) { bad = i; break }
  }
  check('encodeCells/decodeCells 往返一致（997 格 · 31 色 + 空格）', bad < 0, bad < 0 ? `长度 ${str.length}` : `第 ${bad} 格不符`)

  /* 色号种类超过字符集容量时必须拒绝打包，而不是写出 undefined。
     容量变过两次：90（纯 ASCII）→ 255（ASCII + 165 个 BMP 字符）→ 547（补齐拉丁扩展-A、
     再接上拉丁扩展-B）。现在跟着引擎上限走：MAX_TARGET_COLORS = 291 = 最大色板长度，
     必须落在容量之内，否则「滑块拖到 291」的图案存不下来。 */
  const manyCap = { palette: new Array(MAX_TARGET_COLORS).fill({ code: 'X' }), cells }
  const tooMany = { palette: new Array(PACK_CAPACITY + 1).fill({ code: 'X' }), cells }
  check(`容量 ${PACK_CAPACITY}：${MAX_TARGET_COLORS} 色的色板（引擎上限 = 最大色板）能打包`, canPack(manyCap) === true)
  check(`色号种类超过 ${PACK_CAPACITY} 时 canPack=false（退回旧格式）`, canPack(tooMany) === false)
  check('存档容量 ≥ 引擎色号上限 MAX_TARGET_COLORS', PACK_CAPACITY >= MAX_TARGET_COLORS,
    `${PACK_CAPACITY} ≥ ${MAX_TARGET_COLORS}`)

  /* 高色号必须走通整条路：编码 → JSON.stringify/parse（存档实际就是这一步）→ 解码。
     现在刻意跑到 MAX_TARGET_COLORS（291），一次盯两件事：
       ① ASCII 之外的 BMP 字符不被 JSON 转义 —— 单个码点若落到代理区，会变成 \udXXX，
          长度与位置全乱（只测 ASCII 区间测不出这个）；
       ② 下标 > 255 不能绕回 —— Uint8Array 存下标会把 290 变成 34，
          这是「色号上限提到 291」之后最容易踩的坑（见 pattern.js 的 MEMO_MAX_COLORS）。 */
  const wide = new Int32Array(1024)
  for (let i = 0; i < wide.length; i++) wide[i] = i % 7 === 0 ? -1 : (i * 37) % MAX_TARGET_COLORS
  const wideCodes = Array.from({ length: MAX_TARGET_COLORS }, (_, i) => (i >= 90 ? `高${i}` : `低${i}`))
  const wideStr = encodeCells(wide)
  const wideBack = decodeCells(JSON.parse(JSON.stringify(wideStr)), wideCodes)
  let wideBad = -1
  for (let i = 0; i < wide.length; i++) {
    const want = wide[i] < 0 ? null : wideCodes[wide[i]]
    if (wideBack[i] !== want) { wideBad = i; break }
  }
  check(`${MAX_TARGET_COLORS} 色（含 >255 的高色号）编码→JSON→解码逐格一致`, wideBad < 0,
    wideBad < 0 ? `${wideStr.length} 格，用到 ${new Set(wideStr).size} 个不同字符` : `第 ${wideBad} 格不符`)
  check('高色号确实用到了 ASCII 之外的字符', /[^\x20-\x7e]/.test(wideStr))

  /* 扩容后老字符集必须逐字不变：老存档里的每个字符都要还落在原位置上，
     否则用户升级后打开旧作品会整体串色（而且不报错，最难发现）。
     这里按两个历史版本各构造一条老存档字符串：
       ① 「90 种色号」时代：纯 ASCII 字符集；
       ② 「容量 255」时代：ASCII + 希腊/西里尔/拉丁扩展-A 的前 165 个字符
          —— 这正是「色板 291、引擎上限 221」那一版发布期间用户存下的作品。 */
  const OLD_ASCII = "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~"
  const bmp = (from, to) => {
    let out = ''
    for (let c = from; c <= to; c++) { if (c >= 0xd800 && c <= 0xdfff) continue; out += String.fromCharCode(c) }
    return out
  }
  const OLD_255 = (OLD_ASCII + bmp(0x0391, 0x03c9) + bmp(0x0410, 0x044f) + bmp(0x0100, 0x017f)).slice(0, 256)

  for (const [label, alphabet, maxColor] of [['纯 ASCII（90 色时代）', OLD_ASCII, 90], ['容量 255 那一版', OLD_255, 255]]) {
    const codes = Array.from({ length: maxColor }, (_, i) => `L${i}`)
    const str = [...cells].map((v, i) => (v < 0 ? alphabet[0] : alphabet[((v * 3 + i) % maxColor) + 1])).join('')
    const decoded = decodeCells(str, codes)
    let bad = -1
    for (let i = 0; i < str.length; i++) {
      const k = alphabet.indexOf(str[i])
      const want = k > 0 ? codes[k - 1] : null
      if (decoded[i] !== want) { bad = i; break }
    }
    check(`扩容后老存档（${label}）解码逐格不变`, bad < 0,
      bad < 0 ? `${str.length} 格` : `第 ${bad} 格不符`)
  }
}

/* ---------------------------------------------------- 2. 真实图案：打包/解包一致 */

{
  const img = readPNG(FIXTURE)
  const palette = getColors(DEFAULT_BRAND_ID)
  const pattern = generateFromPixels(img.data, img.width, img.height, {
    gw: 116, gh: 116, fit: 'contain', targetColors: 16, brandId: DEFAULT_BRAND_ID, colors: palette, variantKey: 'easy'
  })

  const legacy = toPatternJSON(pattern)
  const packed = packPattern(pattern)

  const legacyBytes = Buffer.byteLength(JSON.stringify(legacy))
  const packedBytes = Buffer.byteLength(JSON.stringify(packed))
  check('紧凑格式比旧格式小（116×116）', packedBytes < legacyBytes,
    `${(legacyBytes / 1024).toFixed(0)} KB → ${(packedBytes / 1024).toFixed(0)} KB（${(legacyBytes / packedBytes).toFixed(1)}×）`)

  const restored = unpackPattern(JSON.parse(JSON.stringify(packed)), DEFAULT_BRAND_ID)
  const sameCells = restored.cells.length === pattern.cells.length &&
    restored.cells.every((v, i) => v === pattern.cells[i])
  const samePalette = restored.palette.length === pattern.palette.length &&
    restored.palette.every((c, i) => c.code === pattern.palette[i].code)
  check('packPattern → unpackPattern 还原一致', sameCells && samePalette,
    `格 ${restored.width}×${restored.height} · ${restored.palette.length} 色`)

  /* 旧存档（cells 是色号数组）必须还能打开 —— 用户升级后第一件事就是看老作品 */
  const legacyRestored = unpackPattern(legacy, DEFAULT_BRAND_ID)
  check('旧格式存档仍可读（向后兼容）',
    legacyRestored && legacyRestored.cells.every((v, i) => v === pattern.cells[i]))

  /* 作品列表 / 账户页在 stats.beadCount 缺失时要自己数豆子，两种格式都得数对 */
  const wantBeads = Array.from(pattern.cells).filter(v => v >= 0).length
  check('packedBeadCount 两种格式一致',
    packedBeadCount(packed) === wantBeads && packedBeadCount(legacy) === wantBeads,
    `${wantBeads} 颗`)

  /* 色号上限提到 MAX_TARGET_COLORS（291）之后，最高档的真实生成也要能打包 + 原样还原。
     ⚠️ 这里断言的是「能存、能读回来、容量够」，不是「真的用到 291 色」——
     引擎会自己提前收敛（实测这张照片 ~127 色），合成 291 色那条用例在上面的第 1 节。 */
  const hi = generateFromPixels(img.data, img.width, img.height, {
    gw: 116, gh: 116, fit: 'contain', targetColors: MAX_TARGET_COLORS, brandId: DEFAULT_BRAND_ID,
    colors: palette, variantKey: 'high'
  })
  const hiPacked = packPattern(hi)
  const hiBack = unpackPattern(JSON.parse(JSON.stringify(hiPacked)), DEFAULT_BRAND_ID)
  check(`上限档（目标 ${MAX_TARGET_COLORS} 色）生成 → 打包 → 还原一致`,
    canPack(hi) && hiBack.cells.length === hi.cells.length &&
      hiBack.cells.every((v, i) => v === hi.cells[i]) &&
      hiBack.palette.length === hi.palette.length,
    `实际 ${hi.palette.length} 色 · ${(Buffer.byteLength(JSON.stringify(hiPacked)) / 1024).toFixed(0)} KB`)

  /* 三个方案一起存的实际体积：这是「一个作品占多少配额」的真实数字 */
  const perVariant = packedBytes
  console.log(`  · 一个作品（3 个方案）≈ ${(perVariant * 3 / 1024).toFixed(0)} KB，` +
    `localStorage 5 MB 约可存 ${Math.floor(5 * 1024 * 1024 / (perVariant * 3))} 个`)
  console.log(`  · 同样的三方案用旧格式 ≈ ${(legacyBytes * 3 / 1024 / 1024).toFixed(1)} MB，` +
    `约可存 ${Math.floor(5 * 1024 * 1024 / (legacyBytes * 3))} 个`)
}

/* ---------------------------------------------------- 3. 进度位图 */

{
  const list = [0, 5, 5, 63, 64, 65, 1000, 202499]
  const back = unpackProgress(packProgress(list))
  const sorted = Array.from(new Set(list)).sort((a, b) => a - b)
  check('packProgress/unpackProgress 往返一致（含重复值）',
    JSON.stringify(back) === JSON.stringify(sorted), `${back.length} 个下标`)
  check('旧格式（数组）原样可读', JSON.stringify(unpackProgress([3, 9])) === '[3,9]')
  check('空进度存成 null（和旧存档字段口径一致）', packProgress([]) === null && packProgress(new Set()) === null)

  const full = Array.from({ length: 202500 }, (_, i) => i)
  const packedLen = packProgress(full).length
  const jsonLen = JSON.stringify(full).length
  check('全标进度 20 万颗：位图远小于 JSON 数组', packedLen * 3 < jsonLen,
    `${(jsonLen / 1024 / 1024).toFixed(2)} MB → ${(packedLen / 1024).toFixed(0)} KB`)
}

/* ---------------------------------------------------- 4. 规模对照表 */

{
  const img = readPNG(FIXTURE)
  const palette = getColors(DEFAULT_BRAND_ID)
  console.log('\n画布        旧格式/方案   新格式/方案   三方案合计')
  for (const g of [29, 58, 116, 300, 450]) {
    const pattern = generateFromPixels(img.data, img.width, img.height, {
      gw: g, gh: g, fit: 'contain', targetColors: 16, brandId: DEFAULT_BRAND_ID, colors: palette, variantKey: 'easy'
    })
    const oldBytes = Buffer.byteLength(JSON.stringify(toPatternJSON(pattern)))
    const newBytes = Buffer.byteLength(JSON.stringify(packPattern(pattern)))
    console.log(`${(g + '×' + g).padEnd(10)}` +
      `${(oldBytes / 1024).toFixed(0).padStart(9)} KB` +
      `${(newBytes / 1024).toFixed(0).padStart(11)} KB` +
      `${(newBytes * 3 / 1024).toFixed(0).padStart(11)} KB`)
  }
}

console.log(`\n${failed ? failed + ' 项未通过' : '全部通过'}`)
process.exit(failed ? 1 : 0)
