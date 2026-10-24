/* =========================================================================
   目标色号上限 × 还原度「收益曲线」（开发用，Node 直接跑）

   ---------------------------------------------------------------------------
   为什么要单独写这个脚本
   ---------------------------------------------------------------------------
   src/lib/pattern.js 里的 MAX_TARGET_COLORS **以前**是 90，而 90 不是算法结论，
   是**存档格式倒推**出来的：src/lib/archive.js 的紧凑存档是「一格一个字符」，
   可打印 ASCII 去掉两个必须转义的字符后只剩 91 个，留一个给空格，于是上限正好 90。
   超过 90 就只能退回「一格 5~6 字符」的旧格式，1000×1000 的图会变成 5~6 MB，
   而 localStorage 只有约 5 MB ——「转得出来、存不住」。

   本脚本当初要回答的就是：**把上限放开（并因此改掉存档编码）到底能换回多少还原度？**
   答案是「换不回多少」—— 90 → 221 的 dEcell 只降 ≤0.6%、dEview 一律 0%，
   孤立豆却 +12%、可拼性 -0.04。于是这次的做法是：
     · 存档字符集扩到 256（体积一分没涨，见 archive.js），容量不再是限制；
     · MAX_TARGET_COLORS 按「色板真实有多少色」定成 221，把这层天花板拆掉；
     · 但自动档（COLOR_FLOOR_BY_CELLS）仍然停在实测拐点上（48~64 色），
       多出来的余量留给"先把图转准"的用户自己拖。
   这条曲线的可迁移结论没变：**真正的杠杆是画布格数，不是色号数**（见 bench-scale.mjs）。

   与 bench-scale.mjs 的分工：
     · bench-scale.mjs 的自变量是**画布尺寸**，色号走的是各方案自己的 variantParams；
     · 本脚本的自变量是**cap（目标色号上限本身）**，并且显式把 variantParams 整个覆盖掉
       （见下面的 overrideVariantParams），不受 MAX_TARGET_COLORS 夹取 ——
       这样测的是**引擎真实行为**（quantize 的 k-medoids 本来就支持 cap 到色板长度 221），
       而不是一个假想实现。

   ---------------------------------------------------------------------------
   指标口径：与 bench.mjs / bench-scale.mjs 逐位一致，数字可互相印证
   ---------------------------------------------------------------------------
     dEcell  每格：图案豆色 vs 该格覆盖的源图平均色 —— 最严格，「这颗豆对不对」
     dEview  两侧都缩放到固定 256×256、各做一次同半径模糊后逐像素 CIEDE2000
             —— 「远看像不像」。固定输出尺寸是关键：只在图案自己的格栅上比，
             大画布会因为「像素更多」而天然吃亏，没法横向比较。
     另外直接从 pattern.stats 取两个「可拼性」口径：
       isolatedCount 孤立豆颗数（四邻居没有同色的豆子）
       buildability  可拼性评分 0~1（0.25 孤立 + 0.20 换色 + 0.20 色块 + 0.20 轮廓 + 0.15 色数）

   额外算一列**边际收益**：把用色数当自变量，「真实用色数每多 10 色还能再压掉多少 dEcell」。
   这一列才是决策依据 —— 绝对 dEcell 只说明「哪一档更准」，边际值说明「还值不值得再加色」，
   它能直接暴露收益拐点（例如 90 之后边际值塌到 0.01 量级，就等于说 90 之后的色号只是在
   给存档格式添麻烦）。

   ---------------------------------------------------------------------------
   用法
   ---------------------------------------------------------------------------
     node scripts/fidelity/bench-colors.mjs --grids 116,300 --caps 16,24,32,48,64,90,120,160,221 --label colors-curve
     node scripts/fidelity/bench-colors.mjs --image scripts/fidelity/fixtures/synth_portrait.png --label colors-curve-2
     node scripts/fidelity/bench-colors.mjs --caps 90,221 --grids 300 --label colors-90vs221   # 只要结论时用
   参数（全部可选，默认值就是「116,300 × 16..221 的完整曲线」）：
     --image <路径>   默认 scripts/fidelity/out/photo-src/ref_girl.png
     --grids 116,300  画布边长，逗号分隔
     --caps 16,24,... 目标色号上限，逗号分隔（可以超过 90，最多到色板长度 221）
     --label <名字>   JSON 与渲染图的输出名，默认 colors-curve
     --maxside 2048   源图读入时允许的最大边长（跟随 pattern.js 的 MAX_SOURCE_SIDE）
   ========================================================================= */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateFromPixels, resampleRGBA, MAX_SOURCE_SIDE, MAX_TARGET_COLORS } from '../../src/lib/pattern.js'
import { getColors, DEFAULT_BRAND_ID } from '../../src/lib/palettes.js'
import { deltaE2000, rgbToLab } from '../../src/lib/color.js'
import { readPNG, writePNG } from './png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')

/* 结论行的基准档：**旧上限 90**（存档格式决定的那条线）。
   它不是"当前 MAX_TARGET_COLORS"，而是"这次取消的那条线"——
   固定成 90 才能让"放开到 221 值多少"这句话一直可复现；
   库里的现值由下面的 LIB_CAP 单独打印出来，两者漂了会立刻看见。 */
const BASE_CAP = 90
/** 库里的真实上限：改 MAX_TARGET_COLORS 时这个值自动跟着走（只用于打印，不参与口径） */
const LIB_CAP = MAX_TARGET_COLORS

/* ------------------------------------------------------------ 参数 */

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0
    ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true)
    : fallback
}

const label = String(arg('label', 'colors-curve'))
const imagePath = path.resolve(String(arg('image', path.join(OUT, 'photo-src', 'ref_girl.png'))))
const grids = String(arg('grids', '116,300')).split(',').map(Number).filter(n => n > 0)
const caps = String(arg('caps', '16,24,32,48,64,90,120,160,221')).split(',').map(Number).filter(n => n > 0)
/**
 * 源图读入时允许的最大边长：默认跟随 src/lib/pattern.js 的 MAX_SOURCE_SIDE（现在是 2048）。
 * 与 bench-scale.mjs 同样刻意**不写死**：这个常量以前从 1024 提到过 2048，
 * 脚本里写死会让评测默认跑在「1024 源图」上，测出来的数字与用户在浏览器里跑的（2048）
 * 不是同一件事，比较就失去意义。要复现旧档位就显式 `--maxside 1024`。
 */
const maxSide = Number(arg('maxside', MAX_SOURCE_SIDE))
const renderDir = path.join(OUT, label)

/* ------------------------------------------------------------ 变体参数覆盖 */

/**
 * 本次评测的「实验档」：高还原档 + 显式指定的色号上限。
 *
 * 为什么要自己拼一份而不是 variantParams('high', cap)：
 *   variantParams('high', target) 里 cap = Math.min(MAX_TARGET_COLORS, target+4)，
 *   也就是 target 会被夹到库里那条上限（现在是 221，跑这条曲线的时候还是 90）——
 *   直接用它就测不出上限之上的曲线，而曲线恰恰是本脚本唯一的产出。
 *   这里把 cap 原样传下去，其余参数逐字照抄 'high' 档：
 *     dither:'off' / cleanup:0 / posterize:0 / mergeRatio:0 / saturate:1 / contrast:1
 *     assign:'de'（最近色号用 CIEDE2000）
 *   这样一来「同一个 cap 下的各行」之间只差画布尺寸，而「同一行的不同 cap」之间
 *   只差色号数 —— 干净的单变量对比，也是这条曲线可信的前提。
 *
 * 口径提醒（不然容易误读这张表）：
 *   · 这份覆盖**只影响本脚本**，src/ 一行都不改，浏览器里的三档方案行为不变；
 *   · quantize 内部还有一层 K = min(cap, 色板长度)，漫德 MARD 全色板 221 色，
 *     所以 cap=221 就是「整块色板全放开」，再往上没有意义；
 *   · cleanup:0 意味着不去孤立豆 —— 这是有意的：本脚本要观测「色号变多会不会让孤立豆
 *     变多」这个代价本身，若顺手把孤立豆清掉，就再也看不见这个代价了。
 */
function overrideVariantParams(cap) {
  return {
    cap,
    dither: 'off', cleanup: 0, posterize: 0, mergeRatio: 0,
    saturate: 1, contrast: 1, assign: 'de'
  }
}

/* ------------------------------------------------------------ 图像工具 */
/* 下面几个函数（limitSide / labOf / cellDeltaE / patternRaster / blurRaster /
   viewDeltaE / renderPNG）与 bench-scale.mjs 是同一套实现，逐字复用：
   两个脚本的数字必须能互相印证，任何一处口径分叉都会让「同一条结论」出现两个版本。 */

/** 源图先按最大边长做面积平均降采样（Node 里没有 canvas，等价于 readImagePixels 的逐级减半） */
function limitSide(src, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh))
  if (k >= 1) return { data: src, width: sw, height: sh, scaled: false }
  const tw = Math.max(1, Math.round(sw * k))
  const th = Math.max(1, Math.round(sh * k))
  const { data } = resampleRGBA(src, sw, sh, tw, th, 'cover')
  return { data, width: tw, height: th, scaled: true }
}

function labOf(r, g, b) {
  return rgbToLab(r | 0, g | 0, b | 0)
}

/** 每格：图案豆色 vs 该格覆盖的源图平均色 */
function cellDeltaE(pattern, src, sw, sh) {
  const cell = resampleRGBA(src, sw, sh, pattern.width, pattern.height, 'contain')
  let sum = 0
  let n = 0
  for (let i = 0; i < pattern.width * pattern.height; i++) {
    const c = pattern.palette[pattern.cells[i]]
    if (!c) continue
    const o = i * 4
    sum += deltaE2000(c.lab, labOf(cell.data[o], cell.data[o + 1], cell.data[o + 2]))
    n++
  }
  return n ? sum / n : 99
}

/** 图案 → N×N 栅格（每个输出像素取 2×2 子样本的平均色，等效于「缩小看」） */
function patternRaster(pattern, N) {
  const out = new Float32Array(N * N * 3)
  const gw = pattern.width
  const gh = pattern.height
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const cx = Math.min(gw - 1, Math.floor(((px + (sx + 0.5) / 2) / N) * gw))
          const cy = Math.min(gh - 1, Math.floor(((py + (sy + 0.5) / 2) / N) * gh))
          const c = pattern.palette[pattern.cells[cy * gw + cx]]
          if (!c) continue
          r += c.rgb[0]; g += c.rgb[1]; b += c.rgb[2]; n++
        }
      }
      const o = (py * N + px) * 3
      out[o] = n ? r / n : 255
      out[o + 1] = n ? g / n : 255
      out[o + 2] = n ? b / n : 255
    }
  }
  return out
}

/** 可分离盒式模糊，跑 passes 遍 */
function blurRaster(src, N, radius, passes = 2) {
  let a = Float32Array.from(src)
  const tmp = new Float32Array(a.length)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k
          if (xx < 0 || xx >= N) continue
          const o = (y * N + xx) * 3
          r += a[o]; g += a[o + 1]; b += a[o + 2]; n++
        }
        const o = (y * N + x) * 3
        tmp[o] = r / n; tmp[o + 1] = g / n; tmp[o + 2] = b / n
      }
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k
          if (yy < 0 || yy >= N) continue
          const o = (yy * N + x) * 3
          r += tmp[o]; g += tmp[o + 1]; b += tmp[o + 2]; n++
        }
        const o = (y * N + x) * 3
        a[o] = r / n; a[o + 1] = g / n; a[o + 2] = b / n
      }
    }
  }
  return a
}

const VIEW_N = 256

function viewDeltaE(pattern, src, sw, sh) {
  const pat = blurRaster(patternRaster(pattern, VIEW_N), VIEW_N, 2)
  const srcRaster = resampleRGBA(src, sw, sh, VIEW_N, VIEW_N, 'contain')
  const ref = new Float32Array(VIEW_N * VIEW_N * 3)
  for (let i = 0; i < VIEW_N * VIEW_N; i++) {
    ref[i * 3] = srcRaster.data[i * 4]
    ref[i * 3 + 1] = srcRaster.data[i * 4 + 1]
    ref[i * 3 + 2] = srcRaster.data[i * 4 + 2]
  }
  const refBlur = blurRaster(ref, VIEW_N, 2)
  let sum = 0
  for (let i = 0; i < VIEW_N * VIEW_N; i++) {
    sum += deltaE2000(labOf(pat[i * 3], pat[i * 3 + 1], pat[i * 3 + 2]),
      labOf(refBlur[i * 3], refBlur[i * 3 + 1], refBlur[i * 3 + 2]))
  }
  return sum / (VIEW_N * VIEW_N)
}

/** 渲染图案成 PNG：所有尺寸都输出约 320px 宽，方便并排肉眼比 */
function renderPNG(pattern, file) {
  const cell = Math.max(1, Math.min(12, Math.round(320 / pattern.width)))
  const w = pattern.width * cell
  const h = pattern.height * cell
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const c = pattern.palette[pattern.cells[y * pattern.width + x]]
      for (let sy = 0; sy < cell; sy++) {
        for (let sx = 0; sx < cell; sx++) {
          const o = ((y * cell + sy) * w + (x * cell + sx)) * 3
          rgb[o] = c ? c.rgb[0] : 255
          rgb[o + 1] = c ? c.rgb[1] : 255
          rgb[o + 2] = c ? c.rgb[2] : 255
        }
      }
    }
  }
  writePNG(file, rgb, w, h)
}

/* ------------------------------------------------------------ 主流程 */

const img = readPNG(imagePath)
const src = limitSide(img.data, img.width, img.height, maxSide)
const palette = getColors(DEFAULT_BRAND_ID)

fs.mkdirSync(renderDir, { recursive: true })

console.log(`===== 目标色号上限 × 还原度收益曲线（${label}）=====`)
console.log(`源图 ${path.basename(imagePath)} ${img.width}×${img.height} ⇒ 读入后 ${src.width}×${src.height}` +
  `${src.scaled ? `（受 maxside=${maxSide} 限制）` : '（未受限）'}，色板 ${palette.length} 色`)
console.log(`档位：高还原档 + 显式 cap（dither=off, cleanup=0, mergeRatio=0, saturate=1, contrast=1, assign=de）` +
  `，cap 上限即色板长度 ${palette.length}`)
console.log(`库里 MAX_TARGET_COLORS = ${LIB_CAP}（结论基准仍是旧上限 ${BASE_CAP}：量的是"取消那条线"值多少）`)
console.log('')
/* 列名口径：
     cap      = 交给引擎的目标色号上限（= 本脚本的自变量）
     实用色   = 引擎最终真正用到的色号数（可能少于 cap，见边际收益的说明）
     边际     = 真实用色数每多 10 色，dEcell 还能再降多少（正数 = 有收益，见下方计算） */
console.log('画布      cap  实用色  空格    simApp  dEcell  dEview  孤立豆  可拼性   边际dEcell/10色  耗时ms')

const rows = []
for (const g of grids) {
  /* 同一画布下按 cap 升序比较：边际收益是「相邻两档」的差商，顺序错了符号就反了 */
  for (const cap of caps.slice().sort((a, b) => a - b)) {
    const t0 = Date.now()
    const pattern = generateFromPixels(src.data, src.width, src.height, {
      gw: g,
      gh: g,
      fit: 'contain',
      targetColors: cap,
      brandId: DEFAULT_BRAND_ID,
      colors: palette,
      variantKey: 'high',
      /* 关键一行：显式覆盖，绕过 MAX_TARGET_COLORS 的夹取（详见 overrideVariantParams） */
      variantParams: overrideVariantParams(cap)
    })
    const ms = Date.now() - t0
    const dEcell = cellDeltaE(pattern, src.data, src.width, src.height)
    const dEview = viewDeltaE(pattern, src.data, src.width, src.height)
    const st = pattern.stats || {}
    const row = {
      grid: g,
      cells: g * g,
      cap,
      targetColors: cap,
      /** 真实用色数 = 最终渲染实际用到的色号数（quantize 选出的色号可能少于 cap） */
      usedColors: pattern.palette.length,
      empty: st.emptyCount || 0,
      beadCount: st.beadCount || 0,
      simApp: st.similarity != null ? Math.round(st.similarity * 1000) / 1000 : null,
      dEcell: Math.round(dEcell * 100) / 100,
      dEview: Math.round(dEview * 100) / 100,
      isolatedCount: st.isolatedCount != null ? st.isolatedCount : null,
      buildability: st.buildability != null ? st.buildability : null,
      /** 相邻档之间「真实用色数每多 10 色」换来的 dEcell 下降量；正数 = 变好。首档/无增量记 null */
      dEcellPer10Colors: null,
      ms
    }
    rows.push(row)
    renderPNG(pattern, path.join(renderDir, `g${g}_c${cap}.png`))

    /* 边际收益：dEcell 下降量 ÷ 用色数增量 × 10。
       用**真实用色数**而不是 cap 当分母，是因为 cap 只是"允许用多少"，
       真正影响画质的是"实际用了多少"；两者在高 cap 段会明显分叉
       （色板里没有更多"有用"的色号时，quantize 会提前停止增长）。 */
    const prev = rows[rows.length - 2]
    let marginal = null
    if (prev && prev.grid === g) {
      const dUsed = row.usedColors - prev.usedColors
      if (dUsed > 0) {
        marginal = Math.round(((prev.dEcell - row.dEcell) / dUsed) * 10 * 1000) / 1000
        row.dEcellPer10Colors = marginal
      }
    }

    console.log(
      `${g}×${g}`.padEnd(9) +
      String(cap).padStart(4) +
      String(row.usedColors).padStart(7) +
      String(row.empty).padStart(7) +
      (row.simApp == null ? '   -' : row.simApp.toFixed(3)).padStart(9) +
      row.dEcell.toFixed(2).padStart(8) +
      row.dEview.toFixed(2).padStart(8) +
      String(row.isolatedCount == null ? '-' : row.isolatedCount).padStart(8) +
      (row.buildability == null ? '  -' : row.buildability.toFixed(3)).padStart(8) +
      (marginal == null ? '        —' : (marginal >= 0 ? '+' : '') + marginal.toFixed(3)).padStart(17) +
      String(ms).padStart(9)
    )
  }
}

/* ------------------------------------------------------------ 结论 */

/* 结论口径：以 BASE_CAP(=90，也就是**被取消的那条旧上限**) 那一行为基准，
   看更高的 cap 还能把 dEcell / dEview 压低多少百分比 —— 量的是「取消这条线值多少」。
   为什么用百分比而不是绝对值：绝对值跟图有关（这张图 dEcell=2.4，另一张可能是 6），
   百分比才是「放开上限这件事本身值多少」的可迁移说法。 */
const conclusions = []
console.log('')
console.log(`—— 结论：相对旧上限 cap=${BASE_CAP} 的额外收益 ——`)
for (const g of grids) {
  const group = rows.filter(r => r.grid === g)
  const base = group.find(r => r.cap === BASE_CAP)
  if (!base) {
    console.log(`${g}×${g}：本批 --caps 里没有 ${BASE_CAP}，无法给出「从 ${BASE_CAP} 再提」的结论`)
    continue
  }
  for (const r of group) {
    if (r.cap <= BASE_CAP) continue
    const dropCell = (base.dEcell - r.dEcell) / base.dEcell * 100
    const dropView = (base.dEview - r.dEview) / base.dEview * 100
    const line = `cap 从 ${BASE_CAP} 提到 ${r.cap} 时：${g}×${g} 上 dEcell 再降 ${dropCell.toFixed(2)}%` +
      `（${base.dEcell.toFixed(2)} → ${r.dEcell.toFixed(2)}），dEview 再降 ${dropView.toFixed(2)}%` +
      `（${base.dEview.toFixed(2)} → ${r.dEview.toFixed(2)}），` +
      `实用色 ${base.usedColors} → ${r.usedColors}，孤立豆 ${base.isolatedCount} → ${r.isolatedCount}，` +
      `可拼性 ${base.buildability.toFixed(3)} → ${r.buildability.toFixed(3)}`
    console.log(line)
    conclusions.push({
      grid: g,
      fromCap: BASE_CAP,
      toCap: r.cap,
      dEcellDropPct: Math.round(dropCell * 100) / 100,
      dEviewDropPct: Math.round(dropView * 100) / 100,
      usedColorsFrom: base.usedColors,
      usedColorsTo: r.usedColors,
      isolatedFrom: base.isolatedCount,
      isolatedTo: r.isolatedCount,
      buildabilityFrom: base.buildability,
      buildabilityTo: r.buildability
    })
  }
}

const payload = {
  label,
  at: new Date().toISOString(),
  image: path.relative(HERE, imagePath).replace(/\\/g, '/'),
  sourceSize: { width: img.width, height: img.height },
  readSize: { width: src.width, height: src.height, maxSide },
  brandId: DEFAULT_BRAND_ID,
  paletteSize: palette.length,
  baseCap: BASE_CAP,
  grids,
  caps,
  variantOverride: overrideVariantParams(Math.max(...caps)),
  /** 每个 grid 内按 cap 升序，dEcellPer10Colors 是相对上一档的差商 */
  rows,
  conclusions
}
fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(payload, null, 2))
console.log('')
console.log('明细:', path.join(OUT, `${label}.json`))
console.log('渲染图:', renderDir)
