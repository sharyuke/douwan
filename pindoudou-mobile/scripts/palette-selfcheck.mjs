/* 色板注册表自检：数量 / 嵌套 / 唯一性 / 免费·Pro 划分 / 引擎取色一致性。
   跑法：corepack pnpm verify:palette（= node scripts/palette-selfcheck.mjs） */
import {
  PALETTE_BRANDS, PALETTE_COLORS, DEFAULT_BRAND_ID, PALETTE_TOTAL_CODES,
  isFreeFamilyBrand, getColors, getBrand, MARD_BRAND_IDS
} from '../src/lib/palettes.js'
import { paletteLimitFor, clipPalette, ALL_FREE } from '../src/composables/useMembership.js'
import { MAX_TARGET_COLORS } from '../src/lib/pattern.js'
import { PACK_CAPACITY } from '../src/lib/archive.js'

let bad = 0
const ok = (cond, msg, extra = '') => {
  if (!cond) { bad++; console.error(`  ❌ ${msg} ${extra}`) } else console.log(`  ✓ ${msg} ${extra}`)
}

console.log('=== 1. 色板清单 ===')
const real = PALETTE_BRANDS.filter(b => !b.custom)
for (const b of real) console.log(`  ${b.id.padEnd(12)} ${String(b.colorCount).padStart(4)} 色  ${b.name}`)
ok(real.length === 15, '15 套内置色板', `实际 ${real.length}`)
ok(PALETTE_BRANDS.length === 16, '＋自定义色板 = 16 个选项')

console.log('\n=== 2. 默认色板与自由体系 ===')
ok(DEFAULT_BRAND_ID === 'mard291', '默认色板 = mard291', DEFAULT_BRAND_ID)
ok(MARD_BRAND_IDS.length === 8, '漫德体系 8 个套装', MARD_BRAND_IDS.join(','))
ok(isFreeFamilyBrand('mard24') && isFreeFamilyBrand('mard291') && !isFreeFamilyBrand('coco291'),
  '免费体系判定只认漫德')

console.log('\n=== 3. MARD 套装嵌套（同一色号必须同一色值）===')
const mardOf = n => PALETTE_COLORS[`mard${n}`]
const chain = [24, 48, 72, 96, 120, 221, 264, 291]
for (let i = 1; i < chain.length; i++) {
  const small = mardOf(chain[i - 1]); const big = mardOf(chain[i])
  if (chain[i] === 264) continue // 上游：264 不含 C29，见 scripts/README.md
  const map = new Map(big.map(c => [c.code, c.hex]))
  const miss = small.filter(c => map.get(c.code) !== c.hex)
  ok(miss.length === 0, `${chain[i - 1]} ⊂ ${chain[i]} 且色值一致`, miss.length ? `缺 ${miss.length}：${miss.slice(0, 4).map(c => c.code)}` : '')
}
const m291 = new Map(mardOf(291).map(c => [c.code, c.hex]))
const bad264 = mardOf(264).filter(c => m291.get(c.code) !== c.hex)
ok(bad264.length === 0, '264 是 291 的子集且色值一致')
ok(m291.get('C29') && !mardOf(264).some(c => c.code === 'C29'), '264 不含 C29（上游口径，已知差异）')
ok(mardOf(221).every(c => mardOf(291).find(x => x.code === c.code && x.hex === c.hex)),
  '221 ⊂ 291 且色值一致（换套餐不变色）')

console.log('\n=== 4. 唯一性与取色 ===')
const ids = new Set()
for (const b of real) {
  const dup = PALETTE_COLORS[b.id].length - new Set(PALETTE_COLORS[b.id].map(c => c.id)).size
  ok(dup === 0, `${b.id} 内部 id 唯一`)
  for (const c of PALETTE_COLORS[b.id]) ids.add(c.id)
}
ok(ids.size === real.reduce((a, b) => a + b.colorCount, 0), '全局 id 唯一', String(ids.size))
const sample = getColors('mard291')[0]
ok(/^#[0-9a-f]{6}$/.test(sample.hex) && sample.lab.length === 3 && Array.isArray(sample.rgb),
  '颜色对象带 hex / rgb / lab', `${sample.code} ${sample.hex}`)
ok(getColors('nope-not-a-brand').length === getColors(DEFAULT_BRAND_ID).length, '未知品牌回落到默认色板')
ok(getBrand('mixiaowo290').name === '咪小窝全色套装', 'getBrand 认得新品牌', getBrand('mixiaowo290').name)

console.log('\n=== 5. 免费 / Pro 划分 ===')
for (const b of real) {
  const free = clipPalette(getColors(b.id), paletteLimitFor(b.id)).length
  /* 临时免费开放（ALL_FREE）期间所有品牌都给全色；关掉开关后回到
     「漫德全给、其它品牌 48 色」的原口径。 */
  const expect = (ALL_FREE || isFreeFamilyBrand(b.id)) ? b.colorCount : Math.min(48, b.colorCount)
  ok(free === expect, `${b.id.padEnd(12)} 免费版可用 ${String(free).padStart(3)} 色`, `（期望 ${expect}）`)
}
ok(PALETTE_TOTAL_CODES === real.filter(b => !isFreeFamilyBrand(b.id)).reduce((a, b) => a + b.colorCount, 0) + 291,
  `色号总数去重后 = ${PALETTE_TOTAL_CODES}`)
/* 引擎色号上限必须「至少等于最大色板」，否则滑块拖到底也用不满一整块色板；
   同时不能超过存档容量，否则存不下（两条都与 pattern.js / archive.js 的常量对齐）。 */
const maxPalette = Math.max(...real.map(b => b.colorCount))
ok(real.every(b => b.colorCount <= MAX_TARGET_COLORS),
  `每套色板都能整块用上（最大色板 ${maxPalette} ≤ 引擎上限 ${MAX_TARGET_COLORS}）`)
ok(MAX_TARGET_COLORS === 291 && MAX_TARGET_COLORS === maxPalette,
  '引擎色号上限 = 291 = 最大色板长度', String(MAX_TARGET_COLORS))
ok(PACK_CAPACITY >= MAX_TARGET_COLORS,
  `存档容量 ${PACK_CAPACITY} ≥ 引擎上限 ${MAX_TARGET_COLORS}（超出就退回旧格式存）`)

console.log(bad ? `\n❌ ${bad} 项未通过` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
