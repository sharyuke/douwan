/* =========================================================================
   拼板规格、豆径与画布尺寸 —— 全站唯一的「板 / 格 / 豆径」口径

   **两个互相独立的维度**（这是这份文件的核心口径，别再合成一个「尺寸档位」）：

     ① 珠径：豆子多大。2.6mm 小豆（默认）/ 5mm 中号豆（老规格，只服务老存档）。
     ② 板布局：板子一条边几颗钉、拼几块。52 / 78 / 104 / 120 钉画线板，
        实测外框 14 / 21 / 28 / 34 cm（用户实测，见 BOARDS）。

   三条口径（改这里一处，全站跟着变）：

     · 一钉 = 一格，单板见方（52 × 52 / 78 × 78 / 104 × 104 / 120 × 120 格）；
       比一块板更大的画布 = **同规格**再拼几块，所以可选尺寸都是「某一个规格」的整数倍。
     · 成品厘米 = 格数 × 豆径（豆子本身的占地）。板外框（BOARDS.outerCm）比成品略大一点，
       差别就是边框 —— 界面上两个数都给，别混成一个。
     · 钉距 = 外框cm × 10 ÷ 钉数（BOARDS.pitchMm，由实测尺寸反推）：
       52 / 78 / 104 三块算出来都是 **2.692 mm**（14 / 52 = 21 / 78 = 28 / 104），
       说明它们是同一套网格的三种大小 —— 这是「同珠径的板能跨板拼成一张连续图案」的物理依据。

   ⚠️ 暂不混拼（2026-10-16 用户决定：先只做「同规格整板」，混拼等把板型兼容数据搞明白再说）。
      注意这**不是**物理上做不到：同珠径、同钉距的板并排摆，图案跨过接缝是连续的，
      而且 26 的倍数边长全都铺得满（130 = 52 + 78、182 = 78 + 52 + 52、260 = 5 × 52 …，
      因为 26 的倍数 k 只要 ≥ 2，偶数用 k/2 块 52、奇数用 1 块 78 + (k−3)/2 块 52 就行）——
      真正的问题是接缝位置不规律、板与板能不能卡扣要按实物确认，所以产品上先不做。
      本文件因此只允许**单一规格**：`boardSpecFor()` 永远返回一个数。

   ⚠️ 29 不能删：老存档（canvasW/canvasH = 29 / 58 / 116 / 300 / 450 / 1000）与免费素材
      （照 29 格画的 SVG）都还按 29 分板，删掉它们会「打开旧作品就变了样」。
   ========================================================================= */

/** 画线拼板的规格：一条边上的钉位数。一钉 = 一格，单板见方。升序，界面按这个顺序排 */
export const BOARD_SPECS = [52, 78, 104, 120]
/** 单块板的最小规格（界面上「至少一块板」引它） */
export const BOARD_MIN = 52
/** 5mm 中号豆时代的标准大号方板：只服务于老存档与老素材 */
export const LEGACY_BOARD = 29
/** 界面文案用：'52 / 78 / 104 / 120'，别在各处手写这一串 */
export const BOARD_SPEC_LIST_TEXT = BOARD_SPECS.join(' / ')

/**
 * 四种画线板 + 老规格的实物档案。
 *
 * outerCm 是**实测外框边长（含边框）**，用户 2026-10-16 提供；pitchMm 由它反推：
 *   · 52 / 78 / 104 → 14 / 52 = 21 / 78 = 28 / 104 = 2.692 mm，三块完全一致（同一家族）；
 *   · 120 → 34 / 120 = 2.833 mm，比上面那三块大一档。可能是这块板边框更宽、或者量的是外沿；
 *     如果实测其实是 32.3 cm，那它也是 2.692 mm。**跨板混拼之前必须先复测这一块**，
 *     因为钉距不一致的两块板拼在一起，格子对不齐（这一条正是「能不能混拼」的判据）。
 */
function boardDef(pegs, outerCm, { label, short, note, legacy = false }) {
  return {
    pegs,
    outerCm,
    label,
    short,
    note,
    legacy,
    pitchMm: Math.round((outerCm * 10 / pegs) * 1000) / 1000
  }
}

export const BOARDS = {
  52: boardDef(52, 14, { label: '52 钉画线板', short: '52 钉板', note: '单板 14 × 14 cm' }),
  78: boardDef(78, 21, { label: '78 钉画线板', short: '78 钉板', note: '单板 21 × 21 cm' }),
  104: boardDef(104, 28, { label: '104 钉画线板', short: '104 钉板', note: '单板 28 × 28 cm' }),
  120: boardDef(120, 34, { label: '120 钉画线板', short: '120 钉板', note: '单板 34 × 34 cm' }),
  29: boardDef(29, 14.5, {
    label: '老规格方板',
    short: '老规格方板',
    note: '约 14.5 × 14.5 cm',
    legacy: true
  })
}

/** 取某规格的实物档案（认不出来给 null） */
export function boardOf(spec) {
  return BOARDS[Number(spec)] || null
}

/**
 * 画布档位阶梯（从简单到特别精细，共 7 档）。
 *
 * 每档只定「长边多少格」+「适合做什么」，具体用哪个规格、拼几块，由 tierBox 按图片方向挑
 * （见下面的说明）—— 同一个 312 档，正方图是 3 × 3 块 104 板，3:4 的竖图是 3 × 4 块 78 板。
 *
 * 前四档正好一块板一个规格（52 / 78 / 104 / 120），后面三档是同规格拼块：
 *   156 = 2 × 2 块 78（成品 40.6 cm）、208 = 2 × 2 块 104（54.1 cm）、312 = 3 × 3 块 104（81.1 cm）。
 * 为什么留着 156：窄长图（3.2:1 的贴纸、1:2 的竖图）的理想长边常落在 156 附近，
 * 而 120 档只能是一块 120 板（正方，不长个也缩不了），少了 156 就只能给它一个正方画布、
 * 两侧留一大片空格。240 / 360（120 板拼块）不在阶梯里，但都是合法尺寸，
 * 走「自定义尺寸」按规格一块一块加就能拿到 —— 阶梯只负责「大多数照片落在哪一档」。
 *
 * use（适合做什么）是给用户选尺寸用的锚点：格数太抽象，「能不能认出脸」才直观。
 * 为什么把 312 封成上限：再往上（4 × 4 块 104 = 416 格 ≈ 17 万格）已经是「先把图转准」
 * 的量级 —— 成品 1 米见方、几万颗豆，照着拼不现实，而这一档的用法是导出 PNG 存档。
 * 真要更大，走「自定义」按规格一块一块加（Pro 单边到 1000 格）。
 */
export const SIZE_TIERS = [
  { n: 52, name: '入门', use: '图标 / 钥匙扣 / 杯垫', note: '1 块 52 钉画线板（14 × 14 cm）' },
  { n: 78, name: '标准', use: '桌面小摆件、简单头像', note: '1 块 78 钉画线板（21 × 21 cm）' },
  { n: 104, name: '精细', use: '五官、衣纹开始清楚', note: '1 块 104 钉画线板（28 × 28 cm）' },
  { n: 120, name: '高精细', use: '照片能认人、宠物照', note: '1 块 120 钉画线板（34 × 34 cm）' },
  { n: 156, name: '超精细', use: '挂画级', note: '2 × 2 块 78 钉画线板（42 × 42 cm）' },
  { n: 208, name: '超大', use: '大挂画、多人合影', note: '2 × 2 块 104 钉画线板（56 × 56 cm）' },
  { n: 312, name: '极限', use: '先转准，再导 PNG 存档', note: '3 × 3 块 104 钉画线板（84 × 84 cm）' }
]

/**
 * 豆径口径。
 *   · 2.6mm 小豆：52 / 78 / 104 / 120 钉画线板的标配，也是**默认**（DEFAULT_BEAD）；
 *   · 5mm 中号豆：29 格老档位（Perler / Hama midi）。
 * weightG 是单颗克重，只用于「预计重量」这类展示口径，不参与任何金额计算。
 *   5mm 的 0.07 g 有出处（见 pattern.js 旧注释：卖家字段 68 g/千颗、几何估算 0.067 g）；
 *   2.6mm 按同材质同形状等比缩放：(2.6/5)³ × 0.07 = 0.0098 g，取 0.01 g（约 10 g/千颗）。
 */
export const BEADS = {
  '2.6': {
    key: '2.6',
    label: '2.6mm 小豆',
    short: '2.6mm 小豆',
    mm: 2.6,
    cm: 0.26,
    weightG: 0.01,
    boardText: `${BOARD_SPEC_LIST_TEXT} 钉画线板`,
    isDefault: true
  },
  '5': {
    key: '5',
    label: '5mm 中号豆',
    short: '5mm 中号豆',
    mm: 5,
    cm: 0.5,
    weightG: 0.07,
    boardText: '老规格方板（老存档）',
    isDefault: false
  }
}
export const BEAD_KEYS = ['2.6', '5']
/** 默认豆径：52 / 78 / 104 / 120 是我们的主力规格，所以默认就是 2.6mm 小豆 */
export const DEFAULT_BEAD = '2.6'
/** 界面文案用：'2.6mm 小豆（默认）' */
export const DEFAULT_BEAD_TEXT = `${BEADS[DEFAULT_BEAD].label}（默认）`

/** 取豆径口径（非法 key 一律回落到默认） */
export function beadOf(key) {
  return BEADS[key] || BEADS[DEFAULT_BEAD]
}

/** 界面上标「默认豆径」用的文案：是默认那颗就带「默认」两个字 */
export function beadLabel(key, { withDefault = false } = {}) {
  const b = beadOf(key)
  return withDefault && b.isDefault ? `${b.label}（默认）` : b.label
}

/**
 * 一个画布该按哪个规格分板 —— **整张画布只用一种规格**（混规格暂不支持，见文件头）。
 *
 * 顺序：
 *   ① 两个方向都是 29 的整数倍 → 29（老存档 / 老素材的老规格，行为与以前完全一致）；
 *   ② 有规格能整铺（两个方向都是它的整数倍）→ 取其中**最大**的
 *      （104 格 = 1 块 104 板而不是 2 块 52 板；156 格 = 2 块 78 板而不是 3 块 52 板）；
 *   ③ 都铺不满（300 / 450 / 1000 这类老长边档位）→ 取「板数最少」的规格，
 *      最外圈留空 —— 分板线仍然落在整板边界上，只是最后一列 / 行用不满。
 */
export function boardSpecFor(w, h) {
  const W = Math.max(1, Math.round(Number(w) || 0))
  const H = Math.max(1, Math.round(Number(h) || 0))
  if (W % LEGACY_BOARD === 0 && H % LEGACY_BOARD === 0) return LEGACY_BOARD
  const exact = specsForBox(W, H)
  if (exact.length) return exact[exact.length - 1]
  let best = BOARD_MIN
  let bestCount = Infinity
  let bestWaste = Infinity
  for (const s of BOARD_SPECS) {
    const count = Math.ceil(W / s) * Math.ceil(H / s)
    const waste = count * s * s - W * H
    if (count < bestCount || (count === bestCount && waste < bestWaste)) {
      best = s
      bestCount = count
      bestWaste = waste
    }
  }
  return best
}

/** 能把这个画布整铺满的规格（两个方向都是它的整数倍），升序 */
export function specsForBox(w, h) {
  const W = Math.round(Number(w) || 0)
  const H = Math.round(Number(h) || 0)
  return BOARD_SPECS.filter(s => W > 0 && H > 0 && W % s === 0 && H % s === 0)
}

/** 画布 → 分板规格（两个方向同一个规格；{x, y} 是为了兼容 boardLayout 的既有形状） */
export function boardProfile(w, h) {
  const s = boardSpecFor(w, h)
  return { x: s, y: s }
}

/**
 * 分板尺寸归一化：老调用传的是数字（29），新代码传 {x, y}，什么都没传就按画布推导。
 * boardLayout / drawChart / toSVG / 分板 PDF 都过这一道。
 *
 * ⚠️ 如果传进来的 {x, y} 两个方向不一样（早期版本会写「78 宽 + 104 高」这种并不存在的板），
 * 一律收敛成按画布推导的**单一规格**。
 */
export function normalizeBoardSize(boardSize, w, h) {
  if (boardSize && typeof boardSize === 'object') {
    const x = Math.max(1, Math.round(Number(boardSize.x) || 0))
    const y = Math.max(1, Math.round(Number(boardSize.y) || 0))
    if (x > 0 && y > 0 && x === y) return { x, y }
    if (x > 0 && y > 0) return boardProfile(w, h)
  }
  const n = Math.max(0, Math.round(Number(boardSize) || 0))
  if (n > 0) return { x: n, y: n }
  return boardProfile(w, h)
}

/** 单边格数是不是某个规格的整数倍（只看一个方向；两个方向都要才算「能整铺」） */
export function isBoardMultiple(n) {
  return BOARD_SPECS.some(s => Number(n) > 0 && Number(n) % s === 0)
}

/**
 * 这个画布能不能**用整板铺满**。
 *   · 两个方向都是 29 的整数倍 → 老规格（29 格方板）能整铺，老存档不提示留空；
 *   · 否则看有没有 52 / 78 / 104 / 120 里的某个规格同时整除两个方向。
 * 52 × 78 这种不算：两个方向都是规格的倍数，但没有哪个规格同时整除它们，
 * 铺起来最外圈必然留空（混规格暂不支持，见文件头）。
 */
export function isWholeBoard(w, h) {
  const W = Math.round(Number(w) || 0)
  const H = Math.round(Number(h) || 0)
  if (W > 0 && H > 0 && W % LEGACY_BOARD === 0 && H % LEGACY_BOARD === 0) return true
  return specsForBox(w, H).length > 0
}

/** 能用整板拼出来的所有单边格数（≤ max），升序 */
export function specValues(max = 1000) {
  const out = new Set()
  for (const s of BOARD_SPECS) {
    for (let k = 1; s * k <= max; k++) out.add(s * k)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * 吸附到最近的合法整板值（等距时取小的）。
 * 用在两处：老存档 / 自动匹配 / 素材尺寸要落回整板尺寸时。
 */
export function snapSpec(n, { max = 1000, min = BOARD_MIN } = {}) {
  const target = Math.max(0, Number(n) || 0)
  const list = specValues(max).filter(v => v >= min)
  if (!list.length) return Math.min(max, BOARD_MIN)
  let best = list[0]
  let bestD = Math.abs(best - target)
  for (const v of list) {
    const d = Math.abs(v - target)
    /* 等距取小的：宁可少给几格，也不要让用户为多出来的几格多买一块板 */
    if (d < bestD) { best = v; bestD = d }
  }
  return best
}

/**
 * 吸附到**档位阶梯**上最近的一档（52 / 78 / 104 / 120 / 208 / 312）。
 * 为什么和 snapSpec 分开：合法尺寸比档位多得多（156 / 234 / 240 / 260 / 360…），
 * 自动匹配照片的落点必须是列表里点得到的那 6 档之一，否则界面上会出现
 * 「推荐 234 × 156，但列表里没有这一项」这种对不上的状态。
 */
export function snapTier(n, { max = Infinity } = {}) {
  const list = SIZE_TIERS.map(t => t.n).filter(v => v <= max)
  if (!list.length) return SIZE_TIERS[0].n
  const target = Math.max(0, Number(n) || 0)
  let best = list[0]
  let bestD = Math.abs(best - target)
  for (const v of list) {
    const d = Math.abs(v - target)
    if (d < bestD) { best = v; bestD = d }
  }
  return best
}

/**
 * 档位在给定图片方向下的实际画布。
 *
 * 长边取档位值；**规格在能整除长边的规格里挑**，短边则是同规格的整数块 ——
 * 挑法：块数比 c短/c长 最接近图片比例的胜出（并列取大规格：板少、板大更好拼）。
 * 于是同一个 312 档：正方图是 3 × 3 块 104 板（312×312），
 * 3:4 的竖图是 3 × 4 块 78 板（234×312，比例正好），1:2 的竖图是 3 × 6 块 52 板（156×312）。
 * 为什么不用「短边按比例算完吸附到任意规格」：那样会得到 78 宽 × 104 高这种矩形，
 * 而整张画布只能用一种规格（混规格暂不支持）。
 *
 * aspect = 宽 / 高（与 useStudio 的 sourceAspect 同一口径）。
 */
export function tierBox(tier, aspect = 1) {
  const L = Math.max(BOARD_MIN, Math.round(Number(tier && (tier.n || tier.long)) || BOARD_MIN))
  const a = Number(aspect) > 0 ? Number(aspect) : 1
  /* 短边 / 长边：a ≥ 1（横图）是 1/a，a < 1（竖图）是 a，合起来就是 min(a, 1/a) */
  const ratio = Math.min(a, 1 / a)
  let best = null
  for (const s of BOARD_SPECS) {
    if (L % s !== 0) continue
    const cLong = L / s
    const cShort = Math.min(cLong, Math.max(1, Math.round(cLong * ratio)))
    const err = Math.abs(cShort / cLong - ratio)
    if (!best || err < best.err - 1e-9 || (Math.abs(err - best.err) <= 1e-9 && s > best.spec)) {
      best = { spec: s, cLong, cShort, err }
    }
  }
  /* L 不是任何规格的倍数（老档位 300 / 450 / 1000 走到这里）：按比例给短边，
     分板规格由 boardSpecFor 兜底（铺不满 → 最外圈留空，界面上会如实说明） */
  if (!best) {
    const shortSide = Math.max(BOARD_MIN, Math.round(L * ratio))
    return a >= 1
      ? { w: L, h: shortSide, spec: boardSpecFor(L, shortSide), cols: null, rows: null, exact: false }
      : { w: shortSide, h: L, spec: boardSpecFor(shortSide, L), cols: null, rows: null, exact: false }
  }
  const longSide = best.cLong * best.spec
  const shortSide = best.cShort * best.spec
  return a >= 1
    ? { w: longSide, h: shortSide, spec: best.spec, cols: best.cLong, rows: best.cShort, exact: true }
    : { w: shortSide, h: longSide, spec: best.spec, cols: best.cShort, rows: best.cLong, exact: true }
}

/** 自定义尺寸：规格（52/78/104/120）× 横向几块 × 纵向几块 —— 长宽必然是同一规格的整数倍 */
export function customBox({ spec = BOARD_MIN, cols = 1, rows = 1, max = 1000 } = {}) {
  const s = BOARD_SPECS.includes(Number(spec)) ? Number(spec) : BOARD_MIN
  const cap = Math.max(1, Math.floor(max / s))
  const c = Math.min(cap, Math.max(1, Math.round(Number(cols) || 1)))
  const r = Math.min(cap, Math.max(1, Math.round(Number(rows) || 1)))
  return { spec: s, cols: c, rows: r, w: s * c, h: s * r, capped: c !== Math.round(Number(cols) || 1) || r !== Math.round(Number(rows) || 1) }
}

/**
 * 按**成品尺寸**反算「规格 × 几块」—— 自定义里的另一种输入法：
 * 「我想做 30 cm 见方」比「横 2 块 104 板」直观得多。
 *
 * 只按长边算正方形（画布的宽高比另有「按图片方向自动重排」那条路）。
 * 候选 = 每个规格 × 能放下的块数，取成品厘米离目标最近的；并列取块数少、规格大的。
 * 返回里带 cm / diff，界面要如实说出「差多少厘米」，不能悄悄给一个差很多的尺寸。
 */
export function boxForFinishCm(targetCm, { beadKey = DEFAULT_BEAD, max = 1000 } = {}) {
  const b = beadOf(beadKey)
  const target = Math.max(0, Number(targetCm) || 0)
  let best = null
  for (const s of BOARD_SPECS) {
    const kMax = Math.max(1, Math.floor(max / s))
    for (let k = 1; k <= kMax; k++) {
      const side = s * k
      const cm = Math.round(side * b.cm * 100) / 100
      const diff = Math.round((cm - target) * 100) / 100
      const better = !best ||
        Math.abs(diff) < Math.abs(best.diff) - 1e-9 ||
        (Math.abs(Math.abs(diff) - Math.abs(best.diff)) <= 1e-9 &&
          (k * k < best.cols * best.rows || (k * k === best.cols * best.rows && s > best.spec)))
      if (better) best = { spec: s, cols: k, rows: k, w: side, h: side, cm, diff, exact: Math.abs(diff) < 1e-9 }
    }
  }
  return best
}

/** 成品厘米（格数 × 豆径）—— {w, h} 是数字，文案用 finishCmText */
export function finishCm(w, h, beadKey = DEFAULT_BEAD) {
  const b = beadOf(beadKey)
  return { w: w * b.cm, h: h * b.cm }
}

/** 成品文案：'13.5 × 13.5 cm' */
export function finishCmText(w, h, beadKey = DEFAULT_BEAD) {
  const c = finishCm(w, h, beadKey)
  return `${c.w.toFixed(1)} × ${c.h.toFixed(1)} cm`
}

/**
 * 板面外框合计（拼起来占多大桌面）—— 板数与规格同样的 ceil 口径，
 * 「成品 13.5 cm」和「板面 14 × 14 cm」是两个数：后者含边框，也是买板 / 摆桌子的依据。
 */
export function boardOuterCm(w, h, boardSize) {
  const spec = singleSpec(w, h, boardSize)
  const p = boardOf(spec)
  if (!p) return null
  const cols = Math.max(1, Math.ceil(w / spec))
  const rows = Math.max(1, Math.ceil(h / spec))
  return { w: Math.round(cols * p.outerCm * 10) / 10, h: Math.round(rows * p.outerCm * 10) / 10, cols, rows, spec }
}

/** 板面外框文案：'14 × 14 cm' / '56 × 56 cm' */
export function boardOuterText(w, h, boardSize) {
  const o = boardOuterCm(w, h, boardSize)
  return o ? `${o.w} × ${o.h} cm` : ''
}

/**
 * 每块板的分板摘要文案。
 * 「2 × 2 块 104 钉板」（整铺）/「1 块 52 钉板」/ 铺不满时补一句「（最外圈留空）」；
 * 老规格写「29 格大号方板」。界面上的灰底信息条与卡片头都用它。
 */
export function boardsText(w, h, boardSize) {
  const spec = singleSpec(w, h, boardSize)
  return boardTextOf(w, h, spec, BOARD_SPECS[0], true)
}

/** 卡片头那一行用的短文案：「1 块 52 钉板」「2×3 块 52 钉板」 */
export function boardsTextShort(w, h, boardSize) {
  const spec = singleSpec(w, h, boardSize)
  return boardTextOf(w, h, spec, BOARD_SPECS[0], false)
}

/** 画布用的规格：优先图纸自带（现在必然是 x === y），否则按画布推导 */
function singleSpec(w, h, boardSize) {
  const x = boardSize && Number(boardSize.x)
  if (Number.isFinite(x) && x > 0) return x
  return boardSpecFor(w, h)
}

function boardTextOf(w, h, spec, fallbackSpec, withWaste) {
  const cols = Math.ceil(w / spec)
  const rows = Math.ceil(h / spec)
  const p = boardOf(spec) || boardOf(fallbackSpec)
  const name = p ? p.short : `${spec} 钉板`
  const exact = w % spec === 0 && h % spec === 0
  const waste = !exact && withWaste ? '（最外圈留空）' : ''
  if (cols * rows === 1) return `1 块 ${name}${waste}`
  return `${cols} × ${rows} 块 ${name}${waste}`
}

/**
 * 自动豆径：**跟着分板规格走**，而不是跟着「画布是不是整板」走。
 *
 * 为什么：豆径是拼板的物理属性（52 / 78 / 104 / 120 钉画线板配 2.6mm 小豆，
 * 29 格大号方板配 5mm 中号豆）。早期写法是「整板尺寸 → 小豆，否则 5mm」，
 * 于是老长边档位（300 / 450 / 1000 格）会落到「按 104 钉板分板，却按 5mm 算成品」——
 * 一块 104 钉板被算成 52 cm 宽，自相矛盾。现在只看分板规格：
 * 退到 29 格老规格（29 / 58 / 87 / 116 / 232 / 464 这些 29 的倍数是老存档）就按 5mm，
 * 其余按 2.6mm 小豆（默认）。
 */
export function autoBeadKey(w, h) {
  return boardSpecFor(w, h) === LEGACY_BOARD ? '5' : DEFAULT_BEAD
}
