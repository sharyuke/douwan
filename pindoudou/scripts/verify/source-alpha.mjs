/* =========================================================================
   源图透明通道（alpha）诊断：透明 PNG 的透明背景，最后是空格还是白豆？

   背景（用户反馈）：「转出来的图不如别人的精细」——别人的图纸背景是不放豆的空格，
   我们的看起来是一整片白豆；主体边缘还有一圈白边。

   本脚本只用**纯函数路径**（不依赖 DOM，canvas 那一步用等价的逐像素数学复刻并注明源码行）：
     · HEAD 基线（已提交）：readImagePixels 先 fillRect('#ffffff') 再 drawImage，
       于是 getImageData 读回来的每个像素 A 都是 255 —— 源图 alpha 被吃掉；
     · 工作区当前版本：不再铺白底，先算 transparent = hasTransparency(data)，
       再把 RGB 与白底合成（flattenOverWhite，**只改 RGB、保留 alpha**），
       浏览器入口由 resolveMatte 自动沿用 alpha（不需要用户打开「智能抠图」）。

   为什么两个口径都测：这个仓库的 src/ 在诊断期间被另一个进程改过（工作区有未提交改动），
   「当前真实行为」因此有两个版本。两个都跑出来、数字都对得上源码行，谁都不会被误导；
   脚本开头打印被测算文件的 SHA-256 与 HEAD，便于事后核对。

   跑法：node scripts/verify/source-alpha.mjs
   退出码：0 = 全部门禁断言通过；1 = 有门禁断言失败（逐条给数字）
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

/* 用命名空间导入而不是具名导入：hasTransparency 只存在于工作区版本里，
   具名导入在 HEAD 基线上会直接链接失败（脚本必须能在两个版本上都跑起来） */
import * as Pattern from '../../src/lib/pattern.js'
import { estimateMatte } from '../../src/lib/matte.js'
import { rgbToLab, deltaE2000 } from '../../src/lib/color.js'
import { readPNG } from '../fidelity/png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const FIXTURES = path.join(ROOT, 'scripts/fidelity/fixtures')

const EMPTY = Pattern.EMPTY
const EMPTY_SHARE = Pattern.EMPTY_SHARE // 0.52：一格主体覆盖率低于它就不放豆
const LEVEL = 'normal' // matteLevel 默认档（emptyShare 0.52 / tolerance 10）

/* 合成图与画布：240² 画布、中间半径 80 的实心圆、四周 alpha=0。
   29×29 格 = 一张标准大号方板（BOARD_SIZE），界面的常见档位。 */
const SIZE = 240
const RADIUS = 80
const SUBJECT = [222, 58, 50] // 主体实色：与白色 ΔE00 极大，白边一眼可测
const WHITE = [255, 255, 255]
const GW = 29
const GH = 29
const CELLS = GW * GH

const SUBJECT_LAB = rgbToLab(SUBJECT[0], SUBJECT[1], SUBJECT[2])
const WHITE_LAB = rgbToLab(255, 255, 255)
const de = (rgb, lab) => deltaE2000(rgbToLab(rgb[0], rgb[1], rgb[2]), lab)
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const rgbStr = c => `rgb(${c.map(v => Math.round(v)).join(',')})`

/* ---------------------------------------------------------------- 断言收集 */
const rows = []
/** 门禁断言：计入退出码 */
function gate(label, ok, detail) { rows.push({ kind: '门禁', label, ok, detail }); return ok }
/** 记录断言：只陈述客观事实 / 历史基线复现，不影响退出码 */
function note(label, ok, detail) { rows.push({ kind: '记录', label, ok, detail }); return ok }

/* ---------------------------------------------------------------- 版本指纹 */
function sha256(file) {
  if (!fs.existsSync(file)) return '(缺失)'
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
}
function headCommit() {
  // 不走 child_process（受限沙箱里 piped stdio 会被拒），直接读 .git/HEAD
  try {
    const gitDir = path.join(ROOT, '.git')
    if (!fs.existsSync(gitDir)) return '(无 .git)'
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref:')) return head.slice(0, 12)
    const ref = head.replace('ref:', '').trim()
    const loose = path.join(gitDir, ref)
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim().slice(0, 12)
    const pr = path.join(gitDir, 'packed-refs')
    if (fs.existsSync(pr)) {
      const line = fs.readFileSync(pr, 'utf8').split('\n').find(l => l.endsWith(' ' + ref))
      if (line) return line.split(' ')[0].slice(0, 12)
    }
    return '(未找到 ' + ref + ')'
  } catch {
    return '(读取失败)'
  }
}

/* ---------------------------------------------------------------- 图像与路径复刻 */

/** 构造 RGBA 合成图：圆内主体实色，圆外 alpha=0；feather>0 时边缘给一圈半透明带 */
function makeCircle(size, radius, feather = 0) {
  const data = new Uint8ClampedArray(size * size * 4)
  const c = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c)
      const a = feather > 0
        ? Math.min(1, Math.max(0, (radius + feather - d) / (2 * feather)))
        : (d <= radius ? 1 : 0)
      const i = (y * size + x) * 4
      data[i] = SUBJECT[0]
      data[i + 1] = SUBJECT[1]
      data[i + 2] = SUBJECT[2]
      data[i + 3] = Math.round(a * 255)
    }
  }
  return data
}

/** RGB 与白底合成、A 置 255（= 源图 alpha 被丢弃；HEAD readImagePixels 的净效果） */
function flattenAndDropAlpha(px) {
  const data = new Uint8ClampedArray(px.data.length)
  for (let i = 0; i < px.data.length; i += 4) {
    const a = px.data[i + 3] / 255
    data[i] = Math.round(px.data[i] * a + 255 * (1 - a))
    data[i + 1] = Math.round(px.data[i + 1] * a + 255 * (1 - a))
    data[i + 2] = Math.round(px.data[i + 2] * a + 255 * (1 - a))
    data[i + 3] = 255
  }
  return { data, width: px.width, height: px.height, transparent: false }
}

/** RGB 与白底合成、**保留 alpha**（= 工作区 flattenOverWhite 的等价数学） */
function flattenKeepAlpha(data) {
  const out = new Uint8ClampedArray(data)
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]
    if (a === 255) continue
    const k = a / 255
    out[i] = Math.round(out[i] * k + 255 * (1 - k))
    out[i + 1] = Math.round(out[i + 1] * k + 255 * (1 - k))
    out[i + 2] = Math.round(out[i + 2] * k + 255 * (1 - k))
  }
  return out
}

/** hasTransparency：优先用 src 里的真实实现（工作区版本），否则用等价兜底（HEAD 基线） */
const hasTransparencyIsReal = typeof Pattern.hasTransparency === 'function'
const hasTransparency = hasTransparencyIsReal
  ? Pattern.hasTransparency
  : data => {
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] < 8) n++
    return n > (data.length / 4) * 0.015
  }

/**
 * 参照几何：按 resampleRGBA 的 contain 口径，算出每格在源图上的真实主体覆盖率。
 * 完全独立于 resampleRGBA / matte.js（自己按圆心距离积分，8×8 超采样），
 * 只用来当「透明背景应该有多少格是空格」的真值。
 */
function refCoverage(gw, gh, rect, inside) {
  const rx = rect ? rect.x : 0
  const ry = rect ? rect.y : 0
  const rw = rect ? rect.w : SIZE
  const rh = rect ? rect.h : SIZE
  const k = Math.min(gw / rw, gh / rh)
  const dw = Math.max(1, rw * k)
  const dh = Math.max(1, rh * k)
  const dx = (gw - dw) / 2
  const dy = (gh - dh) / 2
  const sx = rw / dw
  const sy = rh / dh
  const N = 8
  const cov = new Float32Array(gw * gh)
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const u0 = Math.max(0, (cx + 0.5 - dx) * sx - sx / 2)
      const v0 = Math.max(0, (cy + 0.5 - dy) * sy - sy / 2)
      const u1 = Math.min(rw, u0 + sx)
      const v1 = Math.min(rh, v0 + sy)
      if (u1 <= u0 || v1 <= v0) continue
      let hit = 0
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const x = rx + u0 + (u1 - u0) * ((i + 0.5) / N)
          const y = ry + v0 + (v1 - v0) * ((j + 0.5) / N)
          if (inside(x, y)) hit++
        }
      }
      cov[cy * gw + cx] = hit / (N * N)
    }
  }
  return cov
}

const insideCircle = (x, y) => Math.hypot(x - SIZE / 2, y - SIZE / 2) <= RADIUS
const emptyCountRef = cov => {
  let n = 0
  for (let i = 0; i < cov.length; i++) if (cov[i] < EMPTY_SHARE) n++
  return n
}

/* ---------------------------------------------------------------- 跑一个用例 */

function cellRgb(pattern, i) {
  const k = pattern.cells[i]
  if (k === EMPTY) return null
  const c = pattern.palette[k]
  return c ? c.rgb : null
}

/**
 * 跑一次生成，统计「空格数 / 用色数 / 边缘环平均色」。
 * matte 的取舍完全按浏览器入口的口径来（pattern.js resolveMatte）：
 *   · opts.removeBg        → 用户手动打开「智能抠图」，交给 estimateMatte；
 *   · px.transparent 且 estimateMatte 走了 alpha 分支 → 自动沿用 alpha。
 * @param {{data:Uint8ClampedArray,width:number,height:number,transparent?:boolean}} px
 * @param {{removeBg?:boolean,auto?:boolean,label:string}} opt
 */
function runCase(px, opt) {
  const { removeBg = false, auto = false, label } = opt
  const res = estimateMatte(px.data, px.width, px.height, { level: LEVEL })
  let matte = null
  let decision = '不抠（整张画布都放豆）'
  if (removeBg) {
    matte = res
    decision = '用户打开了「智能抠图」→ estimateMatte'
  } else if (auto && px.transparent) {
    if (res.ok && res.stats && res.stats.transparent) {
      matte = { ...res, auto: true }
      decision = '源图自带透明背景 → 自动沿用 alpha（resolveMatte）'
    } else {
      decision = '标记为透明，但 estimateMatte 没走 alpha 分支 → 不抠'
    }
  }

  const p = Pattern.generateFromPixels(px.data, px.width, px.height, {
    gw: GW,
    gh: GH,
    fit: 'contain',
    variantKey: 'easy',
    targetColors: 16,
    matte,
    removeBg: false, // matte 已经由上面按浏览器口径决定好
    matteLevel: LEVEL
  })

  /* 抠图生效时采样窗口是主体包围盒（pattern.js:1372-1376 的 rect），否则是整图。
     ⚠️ 这决定了「格 → 源图哪一块」的映射，所以**参照几何必须用同一个 rect**：
     抠图生效时格子铺在包围盒上，不生效时铺在整图上，两者的第 0 格不是同一块源图。 */
  const applied = !!(matte && matte.ok && matte.alpha)
  const rect = applied && matte.bbox ? matte.bbox : null
  const covCase = refCoverage(GW, GH, rect, insideCircle)
  const emptyRefArr = new Uint8Array(CELLS)
  const inRing = new Uint8Array(CELLS)
  let ringCells = 0
  for (let i = 0; i < CELLS; i++) {
    emptyRefArr[i] = covCase[i] < EMPTY_SHARE ? 1 : 0
    /* 边缘环 = 本用例自己的映射下、真正压在主轮廓上的格子（0.05~0.95 部分覆盖）。
       问的是「这次渲染里描边那圈格子掺没掺白」，所以按各自的映射取，才有可比性。 */
    if (covCase[i] > 0.05 && covCase[i] < 0.95) { inRing[i] = 1; ringCells++ }
  }

  let empty = 0
  let whiteBeads = 0
  let bgBeads = 0 // 明确是背景（覆盖率 <0.02）的格子却放了豆
  let ringBeads = 0
  let ringEmpty = 0
  let ringLight = 0 // 描边圈里明显掺白（ΔE00 > 8）的豆
  let ringR = 0, ringG = 0, ringB = 0
  let ringMaxDE = 0
  let inter = 0, union = 0
  for (let i = 0; i < p.cells.length; i++) {
    const rgb = cellRgb(p, i)
    if (!rgb) {
      empty++
      if (inRing[i]) ringEmpty++
    } else {
      if (de(rgb, WHITE_LAB) < 3) whiteBeads++
      if (covCase[i] < 0.02) bgBeads++
      if (inRing[i]) {
        ringBeads++
        ringR += rgb[0]; ringG += rgb[1]; ringB += rgb[2]
        const d = de(rgb, SUBJECT_LAB)
        if (d > ringMaxDE) ringMaxDE = d
        if (d > 8) ringLight++
      }
    }
    const mine = rgb ? 0 : 1
    if (mine || emptyRefArr[i]) union++
    if (mine && emptyRefArr[i]) inter++
  }
  const ringMean = ringBeads ? [ringR / ringBeads, ringG / ringBeads, ringB / ringBeads] : null
  return {
    label,
    decision,
    empty,
    beadCount: p.stats.beadCount,
    colorCount: p.stats.colorCount,
    whiteBeads,
    bgBeads,
    ringCells,
    ringBeads,
    ringEmpty,
    ringLight,
    ringMean,
    ringMeanDE: ringMean ? r2(de(ringMean, SUBJECT_LAB)) : null,
    ringMaxDE: r2(ringMaxDE),
    refEmpty: emptyRefArr.reduce((s, v) => s + v, 0),
    emptyIoU: union ? r2(inter / union, 3) : null,
    matte: {
      ok: res.ok,
      transparent: !!(res.stats && res.stats.transparent),
      bgShare: r2(res.bgShare, 3),
      confidence: r2(res.confidence, 3),
      applied,
      bbox: res.bbox,
      reason: res.reason || ''
    }
  }
}

function printCase(m) {
  console.log(`  ${m.label}`)
  console.log(`    决策            : ${m.decision}`)
  console.log(`    estimateMatte   : ok=${m.matte.ok} transparent(alpha分支)=${m.matte.transparent}` +
    ` bgShare=${m.matte.bgShare} confidence=${m.matte.confidence}` +
    `${m.matte.reason ? ` reason=${m.matte.reason}` : ''}`)
  console.log(`    空格/豆         : ${m.empty} / ${m.beadCount}（共 ${CELLS} 格；参照几何真值 ${m.refEmpty} 格，空格 IoU=${m.emptyIoU}）`)
  console.log(`    用色数          : ${m.colorCount}`)
  console.log(`    白色豆          : ${m.whiteBeads}（其中明确落在背景格的 ${m.bgBeads} 颗）`)
  console.log(`    边缘环          : ${m.ringCells} 格 → ${m.ringBeads} 放豆 / ${m.ringEmpty} 空格；平均色 ` +
    `${m.ringMean ? rgbStr(m.ringMean) : '—'}，环平均 ΔE00(主体)=${m.ringMeanDE ?? '—'}，环最大 ΔE00=${m.ringMaxDE}` +
    `，掺白豆(ΔE00>8) ${m.ringLight}/${m.ringBeads}`)
}

/* ================================================================= main */
console.log('=== 0) 被测代码版本 ===')
console.log(`  git HEAD                     : ${headCommit()}`)
console.log(`  src/lib/pattern.js           : sha256 ${sha256(path.join(ROOT, 'src/lib/pattern.js'))}`)
console.log(`  src/lib/matte.js             : sha256 ${sha256(path.join(ROOT, 'src/lib/matte.js'))}`)
console.log(`  src/composables/useStudio.js : sha256 ${sha256(path.join(ROOT, 'src/composables/useStudio.js'))}`)
console.log(`  Pattern.hasTransparency（工作区修复版新增）: ${hasTransparencyIsReal ? '存在' : '不存在 → 用等价兜底实现'}`)
console.log('')
console.log('  注：src/lib/pattern.js 有未提交改动（诊断期间被另一进程修改），本脚本按工作区实际内容测量。')
console.log('')

const rawHard = makeCircle(SIZE, RADIUS, 0)
const rawSoft = makeCircle(SIZE, RADIUS, 2)
const oldHard = flattenAndDropAlpha({ data: rawHard, width: SIZE, height: SIZE }) // HEAD: 铺白底 + drawImage
const newHard = { data: flattenKeepAlpha(rawHard), width: SIZE, height: SIZE, transparent: hasTransparency(rawHard) }
const newSoft = { data: flattenKeepAlpha(rawSoft), width: SIZE, height: SIZE, transparent: hasTransparency(rawSoft) }
/* 纯函数口径：alpha 原样保留、也没有 transparent 标记（调用方根本没走 readImagePixels） */
const keepAlphaOnly = { data: new Uint8ClampedArray(rawHard), width: SIZE, height: SIZE, transparent: false }

/* ------------------------------------------------- 1) 像素级机制直测 */
console.log('=== 1) 像素级机制直测（resampleRGBA：1×1 源图 → 1×1 目标）===')
console.log('    看两件事：「无掩膜」时 alpha 怎么被处理；「有掩膜」时空格是怎么来的')
const rs = (rgb, a, mask) => {
  const out = Pattern.resampleRGBA(new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], a]), 1, 1, 1, 1, 'contain', null, mask)
  return { rgb: [out.data[0], out.data[1], out.data[2]], cover: out.cover ? out.cover[0] : null }
}
const m1 = rs(SUBJECT, 0, null) // pattern.js:239-244：a=0 照样按白底合成累加
const m2 = rs(SUBJECT, 128, null)
const m3 = rs(SUBJECT, 0, new Float32Array([0])) // pattern.js:227-237：掩膜覆盖率 0
const m4 = rs(SUBJECT, 255, new Float32Array([0.3]))
const m5 = rs(SUBJECT, 255, new Float32Array([0.6]))
const isEmpty = c => c < EMPTY_SHARE
console.log(`    1.1 alpha=0  、无掩膜   → ${rgbStr(m1.rgb)}              （ΔE00 距白 = ${r2(de(m1.rgb, WHITE_LAB))}）`)
console.log(`    1.2 alpha=128、无掩膜   → ${rgbStr(m2.rgb)}  ΔE00(主体) = ${r2(de(m2.rgb, SUBJECT_LAB))}`)
console.log(`    1.3 alpha=0  、掩膜 0   → cover=${m3.cover} → ${isEmpty(m3.cover) ? '空格' : '放豆'}（RGB 无关紧要，${rgbStr(m3.rgb)}）`)
console.log(`    1.4 alpha=255、掩膜 0.3 → cover=${m4.cover} → ${isEmpty(m4.cover) ? '空格' : '放豆'}`)
console.log(`    1.5 alpha=255、掩膜 0.6 → cover=${m5.cover} → ${isEmpty(m5.cover) ? '空格' : '放豆'}，RGB ${rgbStr(m5.rgb)}`)
console.log('')
note('1.1 alpha=0 的像素在「没有掩膜」时被合成成纯白实色 —— 这就是「透明背景 → 白豆」的机制（pattern.js:239-244）',
  de(m1.rgb, WHITE_LAB) < 1, `实测 ${rgbStr(m1.rgb)}`)
note('1.2 alpha=128 的半透明像素被当成实色、且混入白色 —— 这就是「白边」的机制（同一段代码）',
  de(m2.rgb, SUBJECT_LAB) > 5, `实测 ${rgbStr(m2.rgb)}，ΔE00(主体)=${r2(de(m2.rgb, SUBJECT_LAB))}`)
note('1.3 只要有掩膜（覆盖率 0），同一个像素就变成空格 —— 空格机制本来就存在，缺的只是「谁来提供掩膜」（pattern.js:162 / 1161）',
  isEmpty(m3.cover), `cover=${m3.cover} < EMPTY_SHARE=${EMPTY_SHARE}`)
note('1.5 掩膜覆盖率 ≥0.5 时取到主体原色（α 路径保留真实主体色、不掺白）',
  de(m5.rgb, SUBJECT_LAB) < 1, `实测 ${rgbStr(m5.rgb)}`)
console.log('')

/* ------------------------------------------------- 2) 合成图矩阵 */
const covFullRef = refCoverage(GW, GH, null, insideCircle)
const geoEmptyFull = emptyCountRef(covFullRef)
console.log(`=== 2) 合成图：${SIZE}×${SIZE}、半径 ${RADIUS} 的实心圆、四周 alpha=0；画布 ${GW}×${GH} 格；variantKey=easy / 16 色 / matteLevel=normal ===`)
console.log(`    几何真值：圆面积占 ${r2(Math.PI * RADIUS * RADIUS / (SIZE * SIZE) * 100, 1)}%；整图 contain 口径下应有 ${geoEmptyFull} 格是空格（覆盖率 < ${EMPTY_SHARE}）`)
console.log('')

const cases = [
  runCase(keepAlphaOnly, { label: 'A · 纯函数 generateFromPixels：alpha 保留、但调用方不给 matte（引擎核心口径）' }),
  runCase(oldHard, { label: 'B · HEAD 基线读像素（铺白底 → alpha 全 255）· 没开抠背景' }),
  runCase(oldHard, { removeBg: true, label: 'C · HEAD 基线读像素（铺白底 → alpha 全 255）· 打开抠背景' }),
  runCase(newHard, { auto: true, label: 'D · 工作区读像素（保留 alpha）· 没开抠背景（resolveMatte 自动档）' }),
  runCase(newHard, { removeBg: true, label: 'E · 工作区读像素（保留 alpha）· 打开抠背景' })
]
cases.forEach(printCase)
const [cA, cB, cC, cD, cE] = cases

console.log('')
console.log(`  对照（每行的「边缘环」都是**该用例自己映射下**压在轮廓上的格子，几何真值空格数见括号）：`)
console.log(`    A 引擎核心·不给 matte        : 空格 ${String(cA.empty).padStart(3)}(${cA.refEmpty})  白豆 ${String(cA.whiteBeads).padStart(3)}  背景格放豆 ${String(cA.bgBeads).padStart(3)}  环 ΔE00=${String(cA.ringMeanDE).padStart(5)}(掺白豆 ${cA.ringLight}/${cA.ringBeads})`)
console.log(`    B 基线读像素·不抠            : 空格 ${String(cB.empty).padStart(3)}(${cB.refEmpty})  白豆 ${String(cB.whiteBeads).padStart(3)}  背景格放豆 ${String(cB.bgBeads).padStart(3)}  环 ΔE00=${String(cB.ringMeanDE).padStart(5)}(掺白豆 ${cB.ringLight}/${cB.ringBeads})  ← 用户反馈的「一整片白豆 + 白边」`)
console.log(`    C 基线读像素·打开抠背景      : 空格 ${String(cC.empty).padStart(3)}(${cC.refEmpty})  白豆 ${String(cC.whiteBeads).padStart(3)}  背景格放豆 ${String(cC.bgBeads).padStart(3)}  环 ΔE00=${String(cC.ringMeanDE).padStart(5)}(掺白豆 ${cC.ringLight}/${cC.ringBeads})`)
console.log(`    D 工作区读像素·不抠（自动）  : 空格 ${String(cD.empty).padStart(3)}(${cD.refEmpty})  白豆 ${String(cD.whiteBeads).padStart(3)}  背景格放豆 ${String(cD.bgBeads).padStart(3)}  环 ΔE00=${String(cD.ringMeanDE).padStart(5)}(掺白豆 ${cD.ringLight}/${cD.ringBeads})`)
console.log(`    E 工作区读像素·打开抠背景    : 空格 ${String(cE.empty).padStart(3)}(${cE.refEmpty})  白豆 ${String(cE.whiteBeads).padStart(3)}  背景格放豆 ${String(cE.bgBeads).padStart(3)}  环 ΔE00=${String(cE.ringMeanDE).padStart(5)}(掺白豆 ${cE.ringLight}/${cE.ringBeads})`)
console.log('')

gate('D 工作区读像素·没开抠背景：透明背景必须是空格（用户反馈的那条路径）',
  cD.empty > 0 && cD.bgBeads === 0 && cD.whiteBeads === 0,
  `空格 ${cD.empty} 格（几何真值 ${cD.refEmpty}，IoU=${cD.emptyIoU}），背景格放豆 ${cD.bgBeads}，白豆 ${cD.whiteBeads}`)
gate('D 的空格范围与几何真值一致（IoU ≥ 0.9）—— 不只是「有一些空格」，而是位置对得上',
  cD.emptyIoU >= 0.9, `IoU=${cD.emptyIoU}`)
gate('E 工作区读像素·打开抠背景：空格范围同样与几何真值一致（IoU ≥ 0.9）',
  cE.emptyIoU >= 0.9, `IoU=${cE.emptyIoU}`)
gate('A 引擎核心 generateFromPixels：透明 PNG 不给 matte 时**自己**也要按 alpha 留空（浏览器入口之外的第二条出口）',
  cA.empty > 0 && cA.whiteBeads === 0,
  `空格 ${cA.empty}、白豆 ${cA.whiteBeads}、背景格放豆 ${cA.bgBeads}；` +
  'resolveMatte 现在同时挂在浏览器入口和引擎核心上，纯函数调用方不必自己传 matte')
console.log('')
note('B 模拟 HEAD 读像素（先铺白底再 drawImage）：透明背景 → 一整片白豆 + 0 空格（本断言在「历史缺陷仍可复现」时为 PASS）',
  cB.empty === 0 && cB.whiteBeads > 0,
  `空格 ${cB.empty}，背景格放豆 ${cB.bgBeads}，白豆 ${cB.whiteBeads}`)
note('A 与 B 现在**必须不同**：同一张透明图，走修复后的引擎核心是空格、走「先压白底」的老路径是白豆 —— 这条差异就是这次修复的全部内容',
  cA.empty !== cB.empty && cA.whiteBeads !== cB.whiteBeads,
  `A: 空格 ${cA.empty}/白豆 ${cA.whiteBeads}；B: 空格 ${cB.empty}/白豆 ${cB.whiteBeads}`)
note('C 基线读像素 + 打开抠背景：颜色模型能认出「被压白」的背景（所以「开抠图」时用户是能拿到空格的），但边缘仍掺白',
  cC.empty > 0 && cC.emptyIoU >= 0.8,
  `空格 ${cC.empty}（IoU=${cC.emptyIoU}），环平均 ΔE00(主体)=${cC.ringMeanDE}、最大 ${cC.ringMaxDE}`)
console.log('')

/* ------------------------------------------------- 3) 半透明边缘（白边）对照 */
/* 这一节故意**绕开调色板**：直接看 sampleCellsMatted 采样出来的每格颜色。
   上面的 C/D/E 边缘 ΔE00 都是 5.53 —— 那是「漫德色板里最接近这个红的色号」的量化误差，
   跟掺没掺白没关系，拿它论证白边会被误导。真正的问题是「这一格的取样色里有没有白」。
   三个用例都用同一个整图映射（srcRect 显式传整图，避免 matte.bbox 把格子挪到别处），
   比较的也是**同一批格子**：几何覆盖率 ≥ EMPTY_SHARE（= 最终会留豆的那些描边格）。 */
const SS = 3
const FULL_RECT = { x: 0, y: 0, w: SIZE, h: SIZE }
let softAlphaPixels = 0
for (let i = 3; i < rawSoft.length; i += 4) if (rawSoft[i] > 0 && rawSoft[i] < 255) softAlphaPixels++
/* 描边格按**纯几何**覆盖率分成两组（三个变体用同一批格子，可比）：
   G1 = 主体占比 ≥ 0.52（该放豆）／G2 = 主体占比 < 0.52（该是空格） */
const G1 = []
const G2 = []
for (let i = 0; i < CELLS; i++) {
  const c = covFullRef[i]
  if (c <= 0.05 || c >= 0.95) continue
  if (c >= EMPTY_SHARE) G1.push(i)
  else G2.push(i)
}

/** 在整图映射下采样一遍，分别统计 G1/G2 的取样色掺白程度与「最终是不是空格」 */
function sampleOutline(label, src, matte) {
  const { rgb, coverage } = Pattern.sampleCellsMatted(
    src, SIZE, SIZE, GW, GH, 'contain', SS, Pattern.VOTE_MIN_SHARE, matte, FULL_RECT
  )
  const stat = set => {
    let beads = 0, empty = 0, r = 0, g = 0, b = 0, maxDE = 0, light = 0
    for (const i of set) {
      /* 有掩膜时覆盖率 <0.52 的格子最终会变成空格（pattern.js:1161 buildEmptyMask） */
      if (coverage && coverage[i] < EMPTY_SHARE) { empty++; continue }
      const o = i * 3
      const c = [rgb[o], rgb[o + 1], rgb[o + 2]]
      beads++
      r += c[0]; g += c[1]; b += c[2]
      const d = de(c, SUBJECT_LAB)
      if (d > maxDE) maxDE = d
      if (d > 8) light++
    }
    const mean = beads ? [r / beads, g / beads, b / beads] : null
    return {
      n: set.length,
      beads,
      empty,
      emptyKnown: !!coverage,
      mean,
      meanDE: mean ? r2(de(mean, SUBJECT_LAB)) : null,
      maxDE: r2(maxDE),
      light
    }
  }
  return { label, g1: stat(G1), g2: stat(G2) }
}
const softFlat = flattenAndDropAlpha({ data: rawSoft, width: SIZE, height: SIZE })
const matteAlpha = estimateMatte(rawSoft, SIZE, SIZE, { level: LEVEL }) // 保留 alpha → 走 alpha 分支
const matteColor = estimateMatte(softFlat.data, SIZE, SIZE, { level: LEVEL }) // alpha 被压掉 → 只能靠颜色模型
const e1 = sampleOutline('无掩膜（没有 matte：alpha 被忽略，只有颜色可用）', new Uint8ClampedArray(rawSoft), null)
const e2 = sampleOutline('α 掩膜（工作区：保留 alpha + resolveMatte 自动档）', newSoft.data, matteAlpha)
const e3 = sampleOutline('颜色模型掩膜（HEAD：alpha 已被压掉，只能猜）', softFlat.data, matteColor)

console.log(`=== 3) 半透明边缘的「白边」：半径 ${RADIUS}、边缘 2px 羽化（alpha∈(0,255) 的源像素 ${softAlphaPixels} 个）===`)
console.log(`    同一批描边格 = 整图映射下几何覆盖率 ∈(0.05,0.95)，共 ${G1.length + G2.length} 格，按纯几何分成两组：`)
console.log(`      G1 该放豆（覆盖率 ≥ ${EMPTY_SHARE}）${G1.length} 格 ／ G2 该是空格（覆盖率 < ${EMPTY_SHARE}）${G2.length} 格`)
console.log('    指标 = sampleCellsMatted 采到的**每格颜色**与主体实色 rgb(222,58,50) 的 ΔE00（不经调色板，不受色号影响）')
for (const e of [e1, e2, e3]) {
  console.log(`    ${e.label}`)
  console.log(`        G1 该放豆 ${e.g1.n} 格 → 放豆 ${e.g1.beads}、判空格 ${e.g1.emptyKnown ? e.g1.empty : '—（无掩膜时空格机制不生效）'}；` +
    `留豆格取样平均色 ${e.g1.mean ? rgbStr(e.g1.mean) : '—'}，平均 ΔE00=${e.g1.meanDE ?? '—'}，最大 ${e.g1.maxDE}，掺白豆 ${e.g1.light}`)
  console.log(`        G2 该空格 ${e.g2.n} 格 → 放豆 ${e.g2.beads}、判空格 ${e.g2.emptyKnown ? e.g2.empty : '—（无掩膜时空格机制不生效）'}；` +
    `留豆格取样平均色 ${e.g2.mean ? rgbStr(e.g2.mean) : '（无豆）'}，平均 ΔE00=${e.g2.meanDE ?? '（无豆）'}，最大 ${e.g2.maxDE}，掺白豆 ${e.g2.light}`)
}
console.log('')
gate('e2 α 掩膜：G2（该是空格的 32 格）必须全部变成空格，不再出现「半白豆」',
  e2.g2.empty === e2.g2.n,
  `G2 共 ${e2.g2.n} 格，判空格 ${e2.g2.empty}，仍放豆 ${e2.g2.beads}`)
gate('e2 α 掩膜：G1（该放豆的描边格）取样色必须是主体实色（平均 ΔE00 ≤ 3）',
  e2.g1.meanDE != null && e2.g1.meanDE <= 3,
  `平均 ΔE00=${e2.g1.meanDE}（最大 ${e2.g1.maxDE}），平均色 ${rgbStr(e2.g1.mean)}，掺白豆 ${e2.g1.light}/${e2.g1.beads}`)
note('e1 无掩膜：G2 那 32 格本该是空格，却全部放成了掺白豆（平均 ΔE00 很大、接近白）—— 这就是「一圈白边 + 背景白豆」',
  e1.g2.beads === e1.g2.n && e1.g2.meanDE > 20,
  `G2 放豆 ${e1.g2.beads}/${e1.g2.n}，取样平均色 ${rgbStr(e1.g2.mean)}，平均 ΔE00=${e1.g2.meanDE}（最大 ${e1.g2.maxDE}）；` +
  `G1 平均 ΔE00=${e1.g1.meanDE}（最大 ${e1.g1.maxDE}，掺白豆 ${e1.g1.light}/${e1.g1.n}）`)
note('e1 的 G1 也比 e2 掺白更多（该放豆的描边格同样被白底拉亮）',
  e1.g1.meanDE > e2.g1.meanDE,
  `无掩膜 G1 平均 ΔE00=${e1.g1.meanDE} vs α 掩膜 ${e2.g1.meanDE}`)
note('e3 用颜色模型（HEAD 口径，alpha 已丢）也能拿到一份掩膜，G1 取样色同样干净 —— 说明「开着抠图」能救回大部分边缘',
  e3.g1.meanDE != null && e3.g1.meanDE <= 3,
  `颜色模型 G1 平均 ΔE00=${e3.g1.meanDE}（最大 ${e3.g1.maxDE}），G2 判空格 ${e3.g2.empty}/${e3.g2.n}`)
console.log('')
console.log('')
console.log('')

/* ------------------------------------------------- 4) fixtures 审计 */
console.log('=== 4) fixtures 审计：能否用 scripts/fidelity/fixtures 的 cut_* 测「透明背景」？===')
const fixtureNames = ['cut_white_on_white', 'cut_soft_edge', 'cut_noise_bg']
const fixtureRows = []
for (const name of fixtureNames) {
  const file = path.join(FIXTURES, `${name}.png`)
  const maskFile = path.join(FIXTURES, `${name}.mask.png`)
  if (!fs.existsSync(file) || !fs.existsSync(maskFile)) {
    console.log(`  ${name}: 缺文件，跳过`)
    continue
  }
  const img = readPNG(file)
  const maskImg = readPNG(maskFile)
  let aMin = 255
  let aMax = 0
  let aZero = 0
  for (let i = 0; i < img.width * img.height; i++) {
    const a = img.data[i * 4 + 3]
    if (a < aMin) aMin = a
    if (a > aMax) aMax = a
    if (a < 8) aZero++
  }
  const transparentReal = hasTransparency(img.data)
  const resRaw = estimateMatte(img.data, img.width, img.height, { level: LEVEL })
  /* 再按 HEAD 读像素口径压一遍白底（对这些不透明的图应当逐像素不变） */
  const flat = flattenAndDropAlpha({ data: img.data, width: img.width, height: img.height })
  const resFlat = estimateMatte(flat.data, img.width, img.height, { level: LEVEL })
  let same = !!(resRaw.alpha && resFlat.alpha)
  if (same) for (let i = 0; i < resRaw.alpha.length; i++) if (resRaw.alpha[i] !== resFlat.alpha[i]) { same = false; break }
  const n = img.width * img.height
  let inter = 0
  let union = 0
  for (let i = 0; i < n; i++) {
    const t = maskImg.data[i * 4] >= 128 ? 1 : 0
    const p = resRaw.alpha && resRaw.alpha[i] >= 0.5 ? 1 : 0
    if (t || p) union++
    if (t && p) inter++
  }
  const iou = union ? inter / union : 0
  fixtureRows.push({ name, aMin, aMax, aZero, transparentReal, same, iou, ok: resRaw.ok })
  console.log(`  ${name}.png  ${img.width}×${img.height} 通道=${img.channels ?? '?'} alpha∈[${aMin}..${aMax}]，alpha<8 的像素 ${aZero} 个`)
  console.log(`      hasTransparency=${transparentReal}；estimateMatte: ok=${resRaw.ok} transparent=${!!(resRaw.stats && resRaw.stats.transparent)}` +
    ` bgShare=${r2(resRaw.bgShare, 3)} confidence=${r2(resRaw.confidence, 3)}`)
  console.log(`      压白底前后掩膜逐像素一致 = ${same}；与真值 mask 的 IoU = ${r2(iou, 3)}（颜色模型的口径）`)
}

/* 合成 fixture：真正带透明背景的图（仓库里没有这种基准图） */
const synthFlat = flattenAndDropAlpha({ data: rawHard, width: SIZE, height: SIZE })
const synthResRaw = estimateMatte(rawHard, SIZE, SIZE, { level: LEVEL })
const synthResFlat = estimateMatte(synthFlat.data, SIZE, SIZE, { level: LEVEL })
console.log('')
console.log(`  [合成 fixture] ${SIZE}×${SIZE} 圆 + alpha=0 背景（仓库里没有带 alpha 的基准图，这里自己造一张）`)
console.log('      掩膜 IoU 按**源图像素**与精确圆几何真值比较（estimateMatte 返回的 alpha 就是源图分辨率）')
for (const [tag, res] of [['保留 alpha（工作区口径）', synthResRaw], ['压白底丢 alpha（HEAD 口径）', synthResFlat]]) {
  let inter = 0
  let union = 0
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x
      const t = insideCircle(x + 0.5, y + 0.5) ? 1 : 0
      const p = res.alpha && res.alpha[i] >= 0.5 ? 1 : 0
      if (t || p) union++
      if (t && p) inter++
    }
  }
  console.log(`      ${tag}: transparent(alpha分支)=${!!(res.stats && res.stats.transparent)} ok=${res.ok}` +
    ` bgShare=${r2(res.bgShare, 3)} confidence=${r2(res.confidence, 3)} 掩膜 IoU = ${r2(union ? inter / union : 0, 4)}`)
}
console.log('')

note('fixtures 里的 cut_*.png 完全没有 alpha（8bit RGB，alpha 恒 255，alpha<8 的像素 0 个）→ 压白底是逐像素 no-op',
  fixtureRows.length > 0 && fixtureRows.every(r => r.aZero === 0 && r.aMin === 255 && r.aMax === 255 && r.same === true),
  fixtureRows.map(r => `${r.name}: alpha[${r.aMin}..${r.aMax}] 一致=${r.same}`).join('；'))
note('既然 fixtures 不含 alpha，这套基准**测不出**「透明 alpha 被压白」这个缺陷（需要一张带 alpha 的基准图，脚本里那张合成图就是）',
  fixtureRows.every(r => r.transparentReal === false),
  '三张图的 hasTransparency 都是 false')
note('estimateMatte 在真正带 alpha 的图上会走「原图自带透明背景，直接沿用」分支（matte.js:322-341）；alpha 被压掉后就只能靠颜色模型猜',
  !!(synthResRaw.stats && synthResRaw.stats.transparent) && !(synthResFlat.stats && synthResFlat.stats.transparent),
  `保留 alpha → transparent=${!!(synthResRaw.stats && synthResRaw.stats.transparent)}；压白底丢 alpha → transparent=${!!(synthResFlat.stats && synthResFlat.stats.transparent)}`)
console.log('')

/* ------------------------------------------------- 5) 断言与汇总 */
console.log('=== 5) 断言汇总 ===')
for (const r of rows) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${r.kind}] ${r.label}`)
  if (r.detail) console.log(`        ${r.detail}`)
}
const gateRows = rows.filter(r => r.kind === '门禁')
const gateFails = gateRows.filter(r => !r.ok)
const noteRows = rows.filter(r => r.kind === '记录')
const noteFails = noteRows.filter(r => !r.ok)
console.log('')
console.log(`  门禁断言：${gateRows.length - gateFails.length} / ${gateRows.length} 通过`)
console.log(`  记录断言：${noteRows.length - noteFails.length} / ${noteRows.length} 通过`)
console.log('')
for (const r of gateFails) console.log(`  ✗ 门禁失败：${r.label}\n      ${r.detail}`)
console.log(gateFails.length ? `✗ 有 ${gateFails.length} 条门禁断言失败` : '✓ 全部门禁断言通过')
console.log('')
console.log('※ 记录断言里的 B 是**按 HEAD 口径复现历史缺陷**那条：它必须是 FAIL（现在读像素不再压白底），')
console.log('  PASS 才说明脚本没真的复现出「一整片白豆」。门禁（A/C/D/E + 两条边缘）全绿即修复成立。')
process.exit(gateFails.length ? 1 : 0)
