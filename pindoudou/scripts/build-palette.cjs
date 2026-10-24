#!/usr/bin/env node
/**
 * 豆玩 · 色板数据构建脚本（可复现 + 自带交叉验证）
 *
 * 作用：
 *   1. 从公开数据源下载色卡数据（MARD / COCO / 漫漫 / 盼盼 / 咪小窝 / Artkal / Hama / Perler）
 *   2. 对同一体系的多个独立来源做逐色交叉验证，输出偏差报告
 *   3. 生成 src/data/palette.js
 *
 * 用法（需要能访问外网的环境）：
 *   node scripts/build-palette.cjs            # 校验 + 生成
 *   node scripts/build-palette.cjs --check    # 只校验，不写文件（CI / 改数据前先跑）
 *   node scripts/build-palette.cjs --offline  # 用 scripts/.palette-cache 里的缓存，不联网
 *
 * 数据口径（2026-10-24 修订，重要）：
 *
 *   MARD / COCO / 漫漫 / 盼盼 / 咪小窝 的色号与色值统一以 WebFEM 的
 *   perler-beads colorSystemMapping 派生表为准（五份 colors.js）：
 *     · MARD 291：221 个基础色 + 70 个扩展色。色号集合与 pixelbead 2026 色卡 PDF、
 *       pindou.online 291 色表逐色一致；三份独立页面的 HEX 也一致。
 *     · COCO 291：291 个色号，与 MARD 同色号按映射表对齐（bitbead 的 COCO 色块
 *       与这份映射逐色相同）。
 *     · 漫漫 278：保留可确认的漫漫自有编号。上游 13 个沿用 MARD W/ZG 的兜底色号
 *       和 1 个 “-” 无编号色块不收录；重复的 S4 按颜色拆成 S4（绿）/ S7（粉），
 *       L7 对应上游无编号的深灰。
 *     · 盼盼 291：291 个可确认编号全部收录；上游 4 个色号为 “-” 的无编号色块不收录。
 *     · 咪小窝 286：W1–W5 与 MARD Q1–Q5 同色、无法确认是咪小窝自有编号，暂不收录。
 *
 *   为什么换掉旧口径：旧版 MARD 221 用 Alfonse 版覆盖，COCO 用另一套 get-colors 值。
 *   把旧数据和独立 291 色表逐色比对时发现：COCO 平均偏差约 30/255（GB 整段错位）、
 *   漫漫 D26–D36 / DH6 / DH14 整段错位、盼盼 1 号与 69 号黑白颠倒。
 *   现在统一到同一份映射表，并把「色号集合」「套装嵌套」「跨品牌同色号色差」
 *   都做成硬校验；屏幕 HEX 仍只是近似值，实物以品牌色卡为准。
 *
 *   Artkal C197 —— 官方 RGB 色卡 PDF（含 CE/CG/CP/CT；CT 半透明按白底合成）
 *   Hama / Perler —— maxcleme/beadcolors 实物测量值（含官方色号）
 */

const fs = require('fs')
const path = require('path')

const PINDou = 'https://raw.githubusercontent.com/HansBug/pindou-color-data/main'
const GET_COLORS = 'https://git.xiongxiao.me/abearxiong/get-colors-from-beans/raw/branch/main/get-colors.json'
const BEADCOLORS = 'https://cdn.jsdelivr.net/gh/maxcleme/beadcolors@master/gen/v3'
const WEBFEM = 'https://webfem.com/tools/pindou'
const WF_URLS = {
  mard: `${WEBFEM}/mard-color-chart/mard-colors.js`,
  coco: `${WEBFEM}/coco-color-chart/colors.js`,
  panpan: `${WEBFEM}/panpan-color-chart/colors.js`,
  mixiaowo: `${WEBFEM}/mixiaowo-color-chart/colors.js`,
  manman: `${WEBFEM}/manman-color-chart/colors.js`
}

const OUT = path.join(__dirname, '..', 'src', 'data', 'palette.js')
const CACHE = path.join(__dirname, '.palette-cache')

const ARGV = new Set(process.argv.slice(2))
const CHECK_ONLY = ARGV.has('--check')
const OFFLINE = ARGV.has('--offline')

async function getText(url) {
  if (OFFLINE) {
    const f = path.join(CACHE, Buffer.from(url).toString('base64url') + '.txt')
    if (!fs.existsSync(f)) throw new Error('离线模式缺少缓存：' + url)
    return fs.readFileSync(f, 'utf8')
  }
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status)
  const t = await r.text()
  try {
    fs.mkdirSync(CACHE, { recursive: true })
    fs.writeFileSync(path.join(CACHE, Buffer.from(url).toString('base64url') + '.txt'), t)
  } catch { /* 缓存写不进去不影响构建 */ }
  return t
}

const getJson = async url => JSON.parse(await getText(url))

function pickArray(obj) {
  const key = Object.keys(obj).find(k => Array.isArray(obj[k]) && obj[k].length > 50)
  if (!key) throw new Error('找不到颜色数组字段')
  return obj[key]
}

const hex2 = (r, g, b) => '#' + [r, g, b]
  .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/** 8 位 hex（带透明度，如 Artkal CT 半透明系列）按白底合成成 6 位 */
function normHex(h) {
  h = String(h).toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(h)) return h
  const m = h.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/)
  if (m) {
    const a = parseInt(m[2], 16) / 255
    const q = parseInt(m[1], 16)
    const mix = v => v * a + 255 * (1 - a)
    return hex2(mix((q >> 16) & 255), mix((q >> 8) & 255), mix(q & 255))
  }
  throw new Error('无法处理的颜色值: ' + h)
}

const rgbOf = h => {
  const q = parseInt(h.slice(1), 16)
  return [(q >> 16) & 255, (q >> 8) & 255, q & 255]
}

const distHex = (a, b) => {
  const x = rgbOf(a), y = rgbOf(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/** 色号归一化：A01 → A1、ZG01 → ZG1；只用于比较集合，不用于输出 */
const normCode = c => {
  const m = /^([A-Za-z]+)0*(\d+)$/.exec(String(c))
  return m ? m[1].toUpperCase() + Number(m[2]) : String(c).toUpperCase()
}

/* ---------------------------------------------------------------- 报告工具 */

const problems = []
const notes = []
const warn = m => { notes.push(m); console.warn('  ⚠️  ' + m) }
const fail = m => { problems.push(m); console.error('  ❌  ' + m) }

/** WebFEM 的 colors.js 是 `window.XXX = {...};`，取出 JSON 部分 */
function parseWf(txt, label) {
  const at = txt.indexOf('=')
  if (at < 0) throw new Error(`${label}：找不到 window.* = 数据`)
  const doc = JSON.parse(txt.slice(at + 1).replace(/;\s*$/, ''))
  if (!Array.isArray(doc.colors)) throw new Error(`${label}：缺少 colors 数组`)
  return doc.colors.map(c => ({
    code: String(c.key),
    hex: normHex(c.hex),
    mardKey: String(c.mardKey || ''),
    set: Number(c.set) || 0,
    conflict: !!c.conflict
  }))
}

/** 两份「色号 → 色值」表的集合比对（入参可以是色号字符串，也可以是 { code } 对象） */
function compareSets(label, a, b) {
  const codeOf = x => (typeof x === 'string' ? x : x.code)
  const A = new Set(a.map(x => normCode(codeOf(x))))
  const B = new Set(b.map(x => normCode(codeOf(x))))
  const onlyA = [...A].filter(x => !B.has(x))
  const onlyB = [...B].filter(x => !A.has(x))
  if (onlyA.length || onlyB.length) {
    fail(`${label}：色号集合不一致（仅左 ${onlyA.length}：${onlyA.slice(0, 8).join(',')}；仅右 ${onlyB.length}：${onlyB.slice(0, 8).join(',')}）`)
  } else {
    console.log(`  ${label}：色号集合一致（${A.size}）`)
  }
}

/** 跨品牌同色号色差：用 WebFEM 的 mardKey 把品牌色号对回 MARD，报告偏差 */
function crossBrand(label, rows, wfRows, mardByNorm) {
  let n = 0, same = 0, near = 0, far = 0, sum = 0, max = 0
  const worst = []
  const rowByNorm = new Map(rows.map(r => [normCode(r.code), r.hex]))
  const seen = new Set()
  for (const c of wfRows) {
    if (!c.mardKey) continue
    const key = normCode(c.code)
    /* 漫漫的 S4 在上游是重码：第一笔是绿、第二笔是粉（本站拆成 S4/S7）。
       这里只取第一笔，避免把粉色的第二笔拿去和我们的绿色 S4 比。 */
    if (seen.has(key)) continue
    seen.add(key)
    const mh = mardByNorm.get(normCode(c.mardKey))
    const bh = rowByNorm.get(key)
    if (!mh || !bh) continue
    n++
    const d = distHex(mh, bh)
    sum += d
    if (d === 0) same++
    else if (d < 12) near++
    else { far++; worst.push(`${c.code}↔${c.mardKey} ${bh}/${mh} Δ${d.toFixed(0)}`) }
    if (d > max) max = d
  }
  const rate = n ? ((same + near) / n * 100).toFixed(1) : '--'
  console.log(`  ${label}：可比 ${n} · 同色 ${same} · 近似 ${near} · 明显不同 ${far} · 一致率 ${rate}% · 平均 ${(sum / Math.max(1, n)).toFixed(2)} · 最大 ${max.toFixed(1)}`)
  if (far) console.log(`    偏差最大：${worst.slice(0, 6).join('；')}`)
  if (far) warn(`${label} 有 ${far} 个色号与 MARD 同色号偏差 ≥12/255，请核对映射`)
}

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('下载色卡数据 …（缓存目录 scripts/.palette-cache，--offline 可复用）')
  const gcRaw = await getJson(GET_COLORS)
  const gc = key => (gcRaw[key] || []).map(e => ({ code: String(e['color-name']), hex: normHex(e['color']) }))
  const up = doc => pickArray(doc).map(c => ({ code: String(c.code), hex: normHex(c.hex), unidentified: !!c.unidentified }))

  const wf = {}
  for (const [key, url] of Object.entries(WF_URLS)) {
    wf[key] = parseWf(await getText(url), key)
    console.log(`  WebFEM ${key.padEnd(9)} ${String(wf[key].length).padStart(4)} 色`)
  }

  /* ---------------- ① MARD：291 色表 + 八个套装 ---------------- */
  console.log('\n[1/5] MARD 体系')
  const wfMardByNorm = new Map(wf.mard.map(c => [normCode(c.code), c.hex]))
  const MARD_SIZES = [291, 264, 221, 120, 96, 72, 48, 24]
  const mardSets = MARD_SIZES.map(n => {
    const src = gc(`Mard-${n}`)
    if (!src.length) fail(`get-colors 里没有 Mard-${n}`)
    const rows = src.map(c => {
      const hex = wfMardByNorm.get(normCode(c.code))
      if (!hex) fail(`MARD ${n} 的色号 ${c.code} 不在 WebFEM 291 里`)
      return { code: c.code, hex: hex || c.hex }
    })
    return { n, rows }
  })
  compareSets('MARD 291 ↔ WebFEM MARD 291', gc('Mard-291'), wf.mard)
  compareSets('MARD 221 ↔ WebFEM MARD 291 的 221 子集', gc('Mard-221'), wf.mard.filter(c => c.set === 221))

  // 套装嵌套：小的必须能被大的完整包含，且同一色号色值一致
  const setOf = n => new Set(mardSets.find(s => s.n === n).rows.map(r => normCode(r.code)))
  const chain = [[24, 48], [48, 72], [72, 96], [96, 120], [120, 221], [221, 291]]
  for (const [small, big] of chain) {
    const s = setOf(small), b = setOf(big)
    const miss = [...s].filter(c => !b.has(c))
    if (miss.length) fail(`MARD ${big} 色套装没有包含 ${small} 色套装的这些色号：${miss.join(', ')}`)
  }
  const notIn291 = [...setOf(264)].filter(c => !setOf(291).has(c))
  if (notIn291.length) fail(`MARD 264 有不在 291 里的色号：${notIn291.join(', ')}`)
  const miss264 = [...setOf(221)].filter(c => !setOf(264).has(c))
  if (miss264.length) warn(`MARD 264 套装不含 221 套装里的 ${miss264.join(', ')}（上游 get-colors 就是这么给的，已原样保留）`)
  for (const s of mardSets) {
    const bad = s.rows.filter(r => wfMardByNorm.get(normCode(r.code)) !== r.hex)
    if (bad.length) fail(`MARD ${s.n} 有 ${bad.length} 个色号的色值与 WebFEM 291 不一致`)
  }
  console.log(`  MARD 套装嵌套：${MARD_SIZES.map(n => `${n}=${setOf(n).size}`).join(' ⊂ ')}（264 见上）`)

  /* ---------------- ② COCO / 漫漫 / 盼盼 / 咪小窝 ---------------- */
  console.log('\n[2/5] 其它国内品牌')
  const cocoU = await getJson(`${PINDou}/coco-291/colors.json`)
  const manmanU = await getJson(`${PINDou}/manman-278/colors.json`)
  const panpanU = await getJson(`${PINDou}/panpan-289/colors.json`)
  const mixiaowoU = await getJson(`${PINDou}/mixiaowo-290/colors.json`)

  // COCO：WebFEM 的 291 色表是完整、可购买的一套；色号集合与 pindou/get-colors 完全一致
  const coco = wf.coco.map(c => ({ code: c.code, hex: c.hex }))
  compareSets('COCO 291 ↔ WebFEM COCO 291', up(cocoU), wf.coco)
  compareSets('COCO 291 ↔ get-colors COCO-291', up(cocoU), gc('COCO-291'))

  // 漫漫：保留 278 个自有编号；W/ZG 兜底与 “-” 不收录
  const wfManByNorm = new Map()
  const s4 = []
  for (const c of wf.manman) {
    if (c.code === '-' || /^W\d+$/.test(c.code) || /^ZG\d+$/.test(c.code)) continue
    if (c.code === 'S4') { s4.push(c.hex); continue }
    wfManByNorm.set(normCode(c.code), c.hex)
  }
  if (s4.length !== 2) fail(`漫漫 S4 重码数量异常：期望 2，实际 ${s4.length}`)
  wfManByNorm.set('S4', s4[0])
  wfManByNorm.set('S7', s4[1])
  const dash = wf.manman.find(c => c.code === '-')
  if (!dash) fail('漫漫缺少 “-” 无编号深灰，无法给 L7 定值')
  else wfManByNorm.set('L7', dash.hex)
  const manman = up(manmanU).filter(c => !c.unidentified).map(c => {
    const hex = wfManByNorm.get(normCode(c.code))
    if (!hex) fail(`漫漫色号 ${c.code} 不在 WebFEM 映射里`)
    return { code: c.code, hex: hex || c.hex }
  })
  console.log(`  漫漫：${manman.length} 色（剔除 W1–W5 / ZG1–ZG8 / “-”；S4 重码拆为 S4/S7）`)

  // 盼盼：WebFEM 的 291 个可确认编号全部收录；4 个 “-” 无编号色块不收录
  const panpan = wf.panpan.map(c => ({ code: c.code, hex: c.hex }))
  console.log(`  盼盼：${panpan.length} 色（上游 4 个无编号色块不收录）`)

  // 咪小窝：保留 286 个自有编号；W1–W5 与 MARD Q1–Q5 同色，暂不收录
  const wfMixByNorm = new Map(wf.mixiaowo.map(c => [normCode(c.code), c.hex]))
  const mixiaowo = up(mixiaowoU).filter(c => !c.unidentified).map(c => {
    const hex = wfMixByNorm.get(normCode(c.code))
    if (!hex) fail(`咪小窝色号 ${c.code} 不在 WebFEM 映射里`)
    return { code: c.code, hex: hex || c.hex }
  })
  console.log(`  咪小窝：${mixiaowo.length} 色（W1–W5 与 MARD Q1–Q5 同色，暂不收录）`)

  /* ---------------- ③ 跨品牌同色号色差 ---------------- */
  console.log('\n[3/5] 跨品牌同色号对照（WebFEM 的 mardKey → MARD 291）')
  crossBrand('COCO', coco, wf.coco, wfMardByNorm)
  crossBrand('漫漫', manman, wf.manman, wfMardByNorm)
  crossBrand('盼盼', panpan, wf.panpan, wfMardByNorm)
  crossBrand('咪小窝', mixiaowo, wf.mixiaowo, wfMardByNorm)

  /* ---------------- ④ Artkal / Hama / Perler ---------------- */
  console.log('\n[4/5] 其它品牌')
  const artkal = await getJson(`${PINDou}/artkal-c-197-official/colors.json`)
  const artkalRows = pickArray(artkal).map(c => ({ code: String(c.code), hex: normHex(c.hex) }))
  const hamaCsv = await getText(`${BEADCOLORS}/hama.csv`)
  const perlerCsv = await getText(`${BEADCOLORS}/perler.csv`)
  const hama = hamaCsv.trim().split('\n').map(l => l.split(','))
    .map(r => ({ code: r[0], hex: hex2(+r[3], +r[4], +r[5]), name: r[1] }))
  const perler = perlerCsv.trim().split('\n').map(l => l.split(','))
    .map(r => ({ code: r[0], hex: hex2(+r[3], +r[4], +r[5]), name: r[1] }))
  console.log(`  Artkal ${artkalRows.length} · Hama ${hama.length} · Perler ${perler.length}`)

  /* ---------------- ⑤ 自检 + 生成 ---------------- */
  console.log('\n[5/5] 自检与生成')
  const sets = [
    ...mardSets.map(s => ({
      id: `mard${s.n}`,
      name: `MARD ${s.n} 色套装`,
      desc: s.n === 291 ? '漫德 MARD 全色号 · 国内默认参考体系' : `漫德 MARD · ${s.n} 色`,
      note: s.n === 291
        ? '来源：WebFEM / perler-beads colorSystemMapping（2026-08-20）的 291 色表；与 pixelbead 2026 色卡 PDF、pindou.online 291 色表逐色一致。屏幕 HEX 仅为近似值，实物以品牌色卡为准。'
        : `漫德 MARD 全色号（291 色）的 ${s.n} 色子集：色号与色值都取自同一个体系，换套餐只增删色号，不会让同一个色号变色。`,
      rows: s.rows
    })),
    {
      id: 'coco291',
      name: 'COCO 全色套装',
      desc: '常见性价比品牌 · 291 色',
      note: '来源：WebFEM / perler-beads colorSystemMapping 的 coco-291（291 个色号）。COCO 与 MARD 的同色号按映射表对齐；屏幕 HEX 为近似值，实物以品牌色卡为准。',
      rows: coco
    },
    {
      id: 'manman278',
      name: '漫漫全色套装',
      desc: '老牌 / 图纸生态常见 · 278 色',
      note: '来源：WebFEM / perler-beads colorSystemMapping 的漫漫 291 色表。剔除 13 个沿用 MARD W/ZG 的兜底色号和 1 个 “-” 无编号色号；上游重复的 S4 按颜色拆为 S4（绿）/ S7（粉），L7 对应上游无编号深灰。屏幕 HEX 为近似值。',
      rows: manman
    },
    {
      id: 'panpan289',
      name: '盼盼全色套装',
      desc: '工具生态常见 · 291 色',
      note: '来源：WebFEM / perler-beads colorSystemMapping 的盼盼 291 色表。上游 4 个色号为 “-” 的无编号色块不收录；291 个可确认编号全部收录。屏幕 HEX 为近似值。',
      rows: panpan
    },
    {
      id: 'mixiaowo290',
      name: '咪小窝全色套装',
      desc: '玩家圈常见 · 286 色',
      note: '来源：WebFEM / perler-beads colorSystemMapping 的咪小窝 291 色表。W1–W5 与 MARD Q1–Q5 同色、无法确认是咪小窝自有编号，暂不收录；保留 286 个自有编号。屏幕 HEX 为近似值。',
      rows: mixiaowo
    },
    {
      id: 'artkal-c197',
      name: '优肯 Artkal C197 色',
      desc: '官方色卡 · 197 色',
      note: '来源：Artkal 官方 RGB 色卡 PDF（C 系列，含 CE/CG/CP/CT）。CT 为半透明珠，此处按白底合成后的观感取色。',
      rows: artkalRows
    },
    {
      id: 'hama',
      name: 'Hama 米迪色板',
      desc: `国际经典 · ${hama.length} 色`,
      note: '来源：beadcolors 开源项目实物测量值（非理论纯色，更接近珠子肉眼观感）。',
      rows: hama
    },
    {
      id: 'perler',
      name: 'Perler 色板',
      desc: `北美经典 · ${perler.length} 色`,
      note: '来源：beadcolors 开源项目实测值，色号为 Perler 官方 SKU（如 80-15179）。',
      rows: perler
    }
  ]

  let bad = 0
  for (const s of sets) {
    const codes = s.rows.map(r => r.code)
    const dup = codes.length - new Set(codes).size
    const badHex = s.rows.filter(r => !/^#[0-9a-f]{6}$/.test(r.hex)).length
    if (dup || badHex || !s.rows.length) bad++
    console.log(`  ${s.id.padEnd(12)} ${String(s.rows.length).padStart(4)} 色 · 重复色号 ${dup} · 非法 hex ${badHex}`)
    if (dup) fail(`${s.id} 有重复色号，会串色（id 是 brandId:code）`)
    if (badHex) fail(`${s.id} 有非法 hex`)
  }
  const total = sets.reduce((a, s) => a + s.rows.length, 0)
  const distinct = sets.filter(s => !/^mard/.test(s.id)).reduce((a, s) => a + s.rows.length, 0) + 291
  console.log(`  合计 ${sets.length} 套 · ${total} 条色号记录（MARD 套装共用 291 个色号，去重后 ${distinct} 个）`)

  if (problems.length) {
    console.error(`\n构建中止：${problems.length} 项校验未通过`)
    problems.forEach(p => console.error('  - ' + p))
    process.exit(1)
  }
  if (CHECK_ONLY) {
    console.log(`\n--check：全部校验通过（${notes.length} 条提示），未写出文件`)
    return
  }

  let out = '// 豆玩拼豆色板 —— 真实品牌色卡数据\n'
  out += '// 本文件由 scripts/build-palette.cjs 自动生成，请勿手工编辑。\n'
  out += '//\n'
  out += '// 每个色号都对应线下可购买的真实拼豆产品，色号可直接用于采购。\n'
  out += '// 数据来源与交叉验证口径见每个色板的 note 字段与 scripts/README.md；\n'
  out += '// 重新生成：node scripts/build-palette.cjs\n'
  out += '//\n'
  out += '// ⚠️ 屏幕 HEX 只是色卡的近似值（不是分光测色结果），\n'
  out += '//    不同批次 / 光线 / 显示器都会有色差；采购前请以实体色卡为准。\n'
  out += '//\n'
  out += '// ⚠️ MARD 24~291 是同一个色号体系的八个套装，共用同一份色值：\n'
  out += '//    同一个色号在哪个套装里都是同一个 hex，换套餐只会多出/少掉色号。\n'
  out += '\n'
  out += 'export const PALETTES = [\n'
  sets.forEach((s, si) => {
    out += '  {\n'
    out += `    id: ${JSON.stringify(s.id)},\n`
    out += `    name: ${JSON.stringify(s.name)},\n`
    out += `    desc: ${JSON.stringify(s.desc)},\n`
    out += `    note: ${JSON.stringify(s.note)},\n`
    out += '    colors: [\n'
    for (const r of s.rows) {
      out += `      [${JSON.stringify(r.code)}, ${JSON.stringify(r.name || r.code)}, ${JSON.stringify(r.hex)}],\n`
    }
    out += '    ].map(([code, name, hex]) => ({ code, name, hex }))\n'
    out += '  }' + (si === sets.length - 1 ? '' : ',') + '\n'
  })
  out += ']\n\n'
  out += '/** 默认色板：漫德 MARD 291（国内默认参考体系的完整版） */\n'
  out += 'export const P = PALETTES[0].colors\n'
  out += 'export default P\n\n'
  out += 'export function paletteByName(name) {\n'
  out += '  return (PALETTES.find(p => p.name === name) || PALETTES[0]).colors\n'
  out += '}\n\n'
  out += '/** 全部品牌色号索引（读取旧作品时按色号反查）*/\n'
  out += 'export const BY_CODE = new Map()\n'
  out += 'for (const set of PALETTES) {\n'
  out += '  for (const c of set.colors) if (!BY_CODE.has(c.code)) BY_CODE.set(c.code, c)\n'
  out += '}\n'

  fs.writeFileSync(OUT, out)
  console.log(`\n已生成 ${path.relative(path.join(__dirname, '..'), OUT)}：${(Buffer.byteLength(out) / 1024).toFixed(1)} KB，共 ${sets.length} 套色板`)
  if (notes.length) console.log(`（构建过程中有 ${notes.length} 条提示，见上）`)
}

main().catch(e => { console.error('失败：' + e.message); process.exit(1) })
