#!/usr/bin/env node
/**
 * 豆玩 · 色板数据构建脚本（可复现 + 自带交叉验证）
 *
 * 作用：
 *   1. 从公开数据源下载色卡数据（MARD 全家桶 / COCO / 漫漫 / 盼盼 / 咪小窝 / Artkal / Hama / Perler）
 *   2. 对同一体系的多个独立来源做逐色交叉验证，输出偏差报告
 *   3. 生成 src/data/palette.js
 *
 * 用法（需要能访问外网的环境）：
 *   node scripts/build-palette.cjs            # 校验 + 生成
 *   node scripts/build-palette.cjs --check    # 只校验，不写文件（CI / 改数据前先跑）
 *   node scripts/build-palette.cjs --offline  # 用 scripts/.palette-cache 里的缓存，不联网
 *
 * 数据来源与口径（「色号准确度」的定义就在这一段）：
 *
 *   MARD 291 / 264 / 221 / 120 / 96 / 72 / 48 / 24
 *     来源 A：get-colors-from-beans 的 get-colors.json（公开源码库口径，也是国内工具站常用的一套）
 *     来源 B：pindou-color-data 的 mard-291-github / mard-221-github（由上一步的 A 规范化而来）
 *     来源 C：pindou-color-data 的 mard-221-alfonse-doudou（MARD 官方色卡 Alfonse 版，独立来源）
 *     —— A 与 B 必须逐色完全一致，否则构建失败（说明上游改了数据，需要人看一眼）。
 *     —— C 只覆盖 221 个色号：色号集合与 A 完全相同；色值 144 色一致、77 色有差
 *        （单通道偏差平均 5.01、最大 38）。本脚本**以 C（官方色卡版）为准**覆盖这 221 个色号：
 *        这样 24~291 八个套装共用同一份色值，「换套餐」只会多出/少掉色号，不会让同一个色号变色；
 *        而 291 相对 221 多出来的那 70 个色号只能来自 A/B，note 里写明了这一点。
 *
 *   COCO 291 / 漫漫 278 / 盼盼 289 / 咪小窝 290
 *     来源：pindou-color-data 的规范化 JSON（coco-291 / manman-278 / panpan-289 / mixiaowo-290）
 *     —— 该仓库在 get-colors.json 之上做过两件事，两件都保留：
 *        ① 漫漫 5 组重复色号，用 xiaoana + Zippland/perler-beads + PinDou 前端映射三份独立来源校正；
 *        ② 盼盼 / 咪小窝 各有 4 个色号在上游页面里写作 “-”（无法确认真实品牌编号），
 *           规范化为 UNKNOWN-01..04 并标 unidentified: true。
 *     —— 本脚本**剔除**这 8 个 UNKNOWN：拼豆图纸上的色号是要拿去下单的，
 *        印一个「不知道是几号」的色号比少 4 个色号更糟。剔掉后盼盼 285 色、咪小窝 286 色。
 *
 *   Artkal C197 —— 官方 RGB 色卡 PDF（含 CE/CG/CP/CT；CT 半透明按白底合成）
 *   Hama / Perler —— maxcleme/beadcolors 实物测量值（含官方色号）
 *
 * 独立交叉校验（不参与构建，失败只警告）：
 *   Zippland/perler-beads 的「色号对应表」（另一个作者维护的 MARD↔COCO↔漫漫↔盼盼↔咪小窝 换算表）
 *   用来验证「同一个物理颜色在各体系里的色号」是否对得上，报告见运行输出。
 */

const fs = require('fs')
const path = require('path')

const PINDou = 'https://raw.githubusercontent.com/HansBug/pindou-color-data/main'
const GET_COLORS = 'https://git.xiongxiao.me/abearxiong/get-colors-from-beans/raw/branch/main/get-colors.json'
const BEADCOLORS = 'https://cdn.jsdelivr.net/gh/maxcleme/beadcolors@master/gen/v3'
const ZIPPLAND = 'https://raw.githubusercontent.com/Zippland/perler-beads/master'

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

/* ---------------------------------------------------------------- 报告工具 */

const problems = []
const notes = []
const warn = m => { notes.push(m); console.warn('  ⚠️  ' + m) }
const fail = m => { problems.push(m); console.error('  ❌ ' + m) }

/** 逐色比对两份「色号 → 色值」表 */
function compare(label, a, b) {
  const mapB = new Map(b.map(c => [c.code, c.hex]))
  let same = 0, diff = 0, onlyA = 0, onlyB = 0, maxCh = 0, sumCh = 0, big = 0
  for (const c of a) {
    const hb = mapB.get(c.code)
    if (hb === undefined) { onlyA++; mapB.delete(c.code); continue }
    mapB.delete(c.code)
    if (c.hex === hb) { same++; continue }
    diff++
    const [r1, g1, b1] = rgbOf(c.hex)
    const [r2, g2, b2] = rgbOf(hb)
    const m = Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2))
    maxCh = Math.max(maxCh, m); sumCh += m
    if (m > 12) big++
  }
  onlyB = mapB.size
  console.log(`  ${label}：${a.length} / ${b.length} 色 · 完全一致 ${same} · 有差异 ${diff} · 仅左 ${onlyA} · 仅右 ${onlyB}`
    + (diff ? ` · 差异单通道 平均 ${(sumCh / diff).toFixed(2)} 最大 ${maxCh}（>12 的 ${big} 色）` : ''))
  return { same, diff, onlyA, onlyB, maxCh, avg: diff ? sumCh / diff : 0, big }
}

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('下载色卡数据 …（缓存目录 scripts/.palette-cache，--offline 可复用）')
  const gcRaw = await getJson(GET_COLORS)
  const mard291U = await getJson(`${PINDou}/mard-291-github/colors.json`)
  const mard221G = await getJson(`${PINDou}/mard-221-github/colors.json`)
  const alfonse = await getJson(`${PINDou}/mard-221-alfonse-doudou/colors.json`)
  const artkal = await getJson(`${PINDou}/artkal-c-197-official/colors.json`)
  const cocoU = await getJson(`${PINDou}/coco-291/colors.json`)
  const manmanU = await getJson(`${PINDou}/manman-278/colors.json`)
  const panpanU = await getJson(`${PINDou}/panpan-289/colors.json`)
  const mixiaowoU = await getJson(`${PINDou}/mixiaowo-290/colors.json`)
  const hamaCsv = await getText(`${BEADCOLORS}/hama.csv`)
  const perlerCsv = await getText(`${BEADCOLORS}/perler.csv`)

  const gc = key => (gcRaw[key] || []).map(e => ({ code: String(e['color-name']), hex: normHex(e['color']) }))
  const up = doc => pickArray(doc).map(c => ({ code: String(c.code), hex: normHex(c.hex), unidentified: !!c.unidentified }))

  /* ---------------- ① MARD：来源一致性 + 官方色卡版覆盖 ---------------- */
  console.log('\n[1/4] MARD 体系交叉验证')
  compare('get-colors Mard-291 ↔ pindou mard-291-github', gc('Mard-291'), up(mard291U))
  compare('get-colors Mard-221 ↔ pindou mard-221-github', gc('Mard-221'), up(mard221G))

  const g291 = gc('Mard-291')
  const gByCode = new Map(g291.map(c => [c.code, c.hex]))
  const b291 = up(mard291U)
  if (b291.length !== g291.length || b291.some(c => gByCode.get(c.code) !== c.hex)) {
    fail('MARD 291 的两份来源不一致，必须人工确认后再构建')
  }

  // 官方色卡版（alfonse）覆盖同名色号
  const a221 = up(alfonse)
  const g221 = gc('Mard-221')
  const stat = compare('get-colors Mard-221 ↔ 官方色卡版（本脚本以此为准）', g221, a221)
  const aByCode = new Map(a221.map(c => [c.code, c.hex]))
  const hexOf = new Map()
  for (const c of g291) hexOf.set(c.code, aByCode.has(c.code) ? aByCode.get(c.code) : c.hex)

  const MARD_SIZES = [291, 264, 221, 120, 96, 72, 48, 24]
  const mardSets = MARD_SIZES.map(n => {
    const src = gc(`Mard-${n}`)
    if (!src.length) fail(`get-colors 里没有 Mard-${n}`)
    return { n, rows: src.map(c => ({ code: c.code, hex: hexOf.get(c.code) || c.hex })) }
  })

  // 套装嵌套：小的必须能被大的完整包含，且同一色号色值一致（换套餐只增删色号、不变色）
  const valueOf = code => (aByCode.has(code) ? aByCode.get(code) : gByCode.get(code))
  const setOf = n => new Set(mardSets.find(s => s.n === n).rows.map(r => r.code))
  const chain = [[24, 48], [48, 72], [72, 96], [96, 120], [120, 221], [221, 291]]
  for (const [small, big] of chain) {
    const s = setOf(small), b = setOf(big)
    const miss = [...s].filter(c => !b.has(c))
    if (miss.length) fail(`MARD ${big} 色套装没有包含 ${small} 色套装的这些色号：${miss.join(', ')}`)
  }
  const s291 = setOf(291)
  const notIn291 = [...setOf(264)].filter(c => !s291.has(c))
  if (notIn291.length) fail(`MARD 264 有不在 291 里的色号：${notIn291.join(', ')}`)
  const miss264 = [...setOf(221)].filter(c => !setOf(264).has(c))
  if (miss264.length) warn(`MARD 264 套装不含 221 套装里的 ${miss264.join(', ')}（上游 get-colors 就是这么给的，已原样保留）`)
  for (const s of mardSets) {
    const bad = s.rows.filter(r => valueOf(r.code) !== r.hex)
    if (bad.length) fail(`MARD ${s.n} 有 ${bad.length} 个色号的色值与「官方色卡版优先 + 291 兜底」的口径不一致`)
  }
  console.log(`  MARD 套装嵌套检查：${MARD_SIZES.map(n => `${n}=${setOf(n).size}`).join(' ⊂ ')}（264 见上）`)

  /* ---------------- ② 其它品牌（盼盼 / 咪小窝剔除不可辨认色号） ---------------- */
  console.log('\n[2/4] 其它品牌')
  const clean = (doc, label) => {
    const all = up(doc)
    const unknown = all.filter(c => c.unidentified || /^UNKNOWN/i.test(c.code))
    if (unknown.length) warn(`${label}：剔除 ${unknown.length} 个上游无法确认真实品牌编号的色号（${unknown.map(c => c.code).join(', ')}）`)
    return all.filter(c => !unknown.includes(c))
  }
  const coco = up(cocoU)
  const manman = up(manmanU)
  const panpan = clean(panpanU, '盼盼')
  const mixiaowo = clean(mixiaowoU, '咪小窝')
  compare('COCO 291 ↔ get-colors COCO-291', coco, gc('COCO-291'))
  compare('漫漫 278 ↔ get-colors 漫漫-278', manman, gc('漫漫-278'))
  console.log(`  COCO ${coco.length} · 漫漫 ${manman.length} · 盼盼 ${panpan.length} · 咪小窝 ${mixiaowo.length}`)

  const hama = hamaCsv.trim().split('\n').map(l => l.split(','))
    .map(r => ({ code: r[0], hex: hex2(+r[3], +r[4], +r[5]), name: r[1] }))
  const perler = perlerCsv.trim().split('\n').map(l => l.split(','))
    .map(r => ({ code: r[0], hex: hex2(+r[3], +r[4], +r[5]), name: r[1] }))
  const artkalRows = pickArray(artkal).map(c => ({ code: String(c.code), hex: normHex(c.hex) }))

  /* ---------------- ③ 独立来源交叉校验（不参与构建） ---------------- */
  console.log('\n[3/4] 独立来源交叉校验（Zippland/perler-beads 色号对应表）')
  try {
    const csv = await getText(`${ZIPPLAND}/%E8%89%B2%E5%8F%B7%E5%AF%B9%E5%BA%94%E8%A1%A8.csv`)
    const rows = csv.trim().split('\n').slice(1).map(l => l.split(',').map(s => s.trim()))
    const norm = c => {
      const m = /^([A-Za-z]+)0*(\d+)$/.exec(c)
      return m ? m[1].toUpperCase() + Number(m[2]) : c.toUpperCase()
    }
    const table = {
      MARD: new Map(g291.map(c => [norm(c.code), c.hex])),
      COCO: new Map(coco.map(c => [norm(c.code), c.hex])),
      漫漫: new Map(manman.map(c => [norm(c.code), c.hex])),
      盼盼: new Map(panpan.map(c => [norm(c.code), c.hex])),
      咪小窝: new Map(mixiaowo.map(c => [norm(c.code), c.hex]))
    }
    const dist = (h1, h2) => { const a = rgbOf(h1), b = rgbOf(h2); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }
    for (const brand of ['COCO', '漫漫', '盼盼', '咪小窝']) {
      let n = 0, same = 0, near = 0, far = 0, miss = 0
      for (const r of rows) {
        const mh = table.MARD.get(norm(r[0]))
        const bh = table[brand].get(norm(r[brand === 'COCO' ? 1 : brand === '漫漫' ? 2 : brand === '盼盼' ? 3 : 4]))
        if (!mh || !bh) { miss++; continue }
        n++
        const d = dist(mh, bh)
        if (d === 0) same++; else if (d < 12) near++; else far++
      }
      const rate = n ? ((same + near) / n * 100).toFixed(1) : '--'
      console.log(`  ${brand}：可比 ${n} 行 · 同色 ${same} · 近似 ${near} · 明显不同 ${far} · 对不上号 ${miss} · 一致率 ${rate}%`)
      if (far / Math.max(1, n) > 0.1) warn(`${brand} 与独立对应表的一致率偏低（${rate}%），该表与本站色号体系可能不是同一套编号`)
    }
  } catch (e) {
    warn('独立来源交叉校验跳过：' + e.message)
  }

  /* ---------------- ④ 自检 + 生成 ---------------- */
  console.log('\n[4/4] 自检与生成')
  const sets = [
    ...mardSets.map(s => ({
      id: `mard${s.n}`,
      name: `MARD ${s.n} 色套装`,
      desc: s.n === 291 ? '漫德 MARD 全色号 · 国内默认参考体系' : `漫德 MARD · ${s.n} 色`,
      note: s.n === 291
        ? `来源：公开色卡库（get-colors-from-beans / pindou-color-data，两份来源逐色一致）。其中 221 个色号另有官方色卡版（Alfonse 版）可对照：${stat.same} 色完全一致、${stat.diff} 色单通道偏差平均 ${stat.avg.toFixed(2)}（最大 ${stat.maxCh}），本站以官方色卡版为准；余下 ${291 - 221} 个色号只有公开色卡库口径。`
        : `漫德 MARD 全色号（291 色）的 ${s.n} 色子集：色号与色值都取自同一个体系，换套餐只增删色号，不会让同一个色号变色。`,
      rows: s.rows
    })),
    {
      id: 'coco291',
      name: 'COCO 全色套装',
      desc: '常见性价比品牌 · 291 色',
      note: '来源：pindou-color-data 的 coco-291（公开色卡库整理）。291 个色号中有 2 组色号官方共用同一色值，属于品牌自身的重色号，未做合并。',
      rows: coco
    },
    {
      id: 'manman278',
      name: '漫漫全色套装',
      desc: '老牌 / 图纸生态常见 · 278 色',
      note: '来源：pindou-color-data 的 manman-278。上游 5 组重复色号已用 xiaoana、Zippland/perler-beads、PinDou 前端映射三份独立来源校正。',
      rows: manman
    },
    {
      id: 'panpan289',
      name: '盼盼全色套装',
      desc: '工具生态常见 · 285 色',
      note: '来源：pindou-color-data 的 panpan-289。上游有 4 个色号在原始页面里写作 “-”（无法确认真实品牌编号），本站直接剔除 —— 图纸上的色号是要拿去下单的，印一个「不知道是几号」的色号比少 4 个色号更糟。',
      rows: panpan
    },
    {
      id: 'mixiaowo290',
      name: '咪小窝全色套装',
      desc: '玩家圈常见 · 286 色',
      note: '来源：pindou-color-data 的 mixiaowo-290。与盼盼同样剔除了上游 4 个无法确认真实品牌编号的色号。',
      rows: mixiaowo
    },
    {
      id: 'artkal-c197',
      name: '优肯 Artkal C197 色',
      desc: '官方色卡 · 197 色',
      note: '来源：Artkal 官方 RGB 色卡 PDF（C 系列，含 CE/CG/CP/CT）。CT 为半透明珠，此处按白底合成后的观感取色',
      rows: artkalRows
    },
    {
      id: 'hama',
      name: 'Hama 米迪色板',
      desc: `国际经典 · ${hama.length} 色`,
      note: '来源：beadcolors 开源项目实物测量值（非理论纯色，更接近珠子肉眼观感）',
      rows: hama
    },
    {
      id: 'perler',
      name: 'Perler 色板',
      desc: `北美经典 · ${perler.length} 色`,
      note: '来源：beadcolors 开源项目实测值，色号为 Perler 官方 SKU（如 80-15179）',
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
