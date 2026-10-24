import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index.js'
import './styles/global.css'
import './styles/admin.css'
import * as patternLib from './lib/pattern.js'
import * as renderLib from './lib/render.js'
import * as colorLib from './lib/color.js'
import * as paletteLib from './lib/palettes.js'
import * as cartoonLib from './lib/cartoon.js'
import * as archiveLib from './lib/archive.js'
import * as matteLib from './lib/matte.js'
import * as exporters from './lib/exporters.js'

createApp(App).use(router).mount('#app')

/* -------------------------------------------------------------------------
   开发用调试桥：把核心算法挂到 window.__douzao
   作用：出问题时可以在控制台直接跑生成、渲染、导出，快速定位是数据问题
        还是渲染问题，不用反复改代码加 log。
   注意：只挂纯函数与只读数据，不挂可变状态，避免绕过正常的响应式流程。
   ------------------------------------------------------------------------- */
if (typeof window !== 'undefined') {
  window.__douzao = {
    version: '1.0.0',
    pattern: patternLib,
    render: renderLib,
    color: colorLib,
    palettes: paletteLib,
    /** 照片 → 卡通形象（纯函数，控制台里可以直接对着图片试参数） */
    cartoon: cartoonLib,
    /** 本机存档的紧凑编码（控制台里核对编码容量 / 解一段存档用） */
    archive: archiveLib,
    /** 抠背景（纯函数：可以在控制台里对着任意 RGBA 缓冲试掩膜分辨率 / 三档力度） */
    matte: matteLib,
    exporters,
    /** 图片载入（控制台测试用） */
    svgToImage: async svg => {
      const m = await import('./composables/useStudio.js')
      return m.svgToImage(svg)
    },
    /** 工作台状态中枢（控制台/自检脚本里驱动真实生成链路用） */
    studio: () => import('./composables/useStudio.js'),
    /** 素材库数据 */
    assets: () => import('./data/assets.js'),
    /** 库存状态 */
    inventoryStore: () => import('./composables/useInventory.js'),
    /** 会员 / 权益状态 */
    membership: () => import('./composables/useMembership.js'),
    /** 前台账号 / 本机匿名身份（自检脚本要模拟「刷新后恢复身份」） */
    userAccount: () => import('./composables/useUserAccount.js'),
    /** 服务端同步（套餐、权限、订单） */
    backend: () => import('./composables/useBackend.js'),
    /** 生成一张图案（返回 Promise<Pattern>），用于控制台排查 */
    async make(svg, { gw = 29, gh = 29, targetColors = 14, brandId, removeBg = false, matteLevel = 'normal', cartoonStyle = '' } = {}) {
      const { svgToImage } = await import('./composables/useStudio.js')
      const bid = brandId || paletteLib.DEFAULT_BRAND_ID
      const { img } = await svgToImage(svg)
      return patternLib.generateVariant({
        img, gw, gh, fit: 'contain', targetColors, brandId: bid,
        colors: paletteLib.getColors(bid), variantKey: 'easy', removeBg, matteLevel, cartoonStyle
      })
    },
    /** 从已存在的 <img> 生成图案（控制台里做对比测试用） */
    makeFromImage(img, { gw = 29, gh = 29, targetColors = 14, brandId, removeBg = false, matteLevel = 'normal', cartoonStyle = '' } = {}) {
      const bid = brandId || paletteLib.DEFAULT_BRAND_ID
      return patternLib.generateVariant({
        img, gw, gh, fit: 'contain', targetColors, brandId: bid,
        colors: paletteLib.getColors(bid), variantKey: 'easy', removeBg, matteLevel, cartoonStyle
      })
    },
    /**
     * 分段诊断：分别跑「采样 → 量化 → 映射」，定位颜色是在哪一步丢掉的。
     * 只在排查时用，不参与正常流程。
     */
    async diagnose(svg, { gw = 29, gh = 29, targetColors = 14, brandId } = {}) {
      const { svgToImage } = await import('./composables/useStudio.js')
      const bid = brandId || paletteLib.DEFAULT_BRAND_ID
      const { img } = await svgToImage(svg)
      const colors = paletteLib.getColors(bid)

      const sampled = patternLib.sampleCells(img, gw, gh, 'contain', 3)
      const distinct = new Set()
      const samples = []
      for (let i = 0; i < sampled.length; i += 3) {
        const k = `${sampled[i] | 0},${sampled[i + 1] | 0},${sampled[i + 2] | 0}`
        distinct.add(k)
        if (samples.length < 8) samples.push(k)
      }
      const chosen = patternLib.quantize(sampled, targetColors, colors)
      let pattern = null
      let genError = null
      try {
        pattern = patternLib.generateVariant({
          img, gw, gh, fit: 'contain', targetColors, brandId: bid, colors, variantKey: 'easy'
        })
      } catch (e) {
        genError = e.message
      }
      return {
        img: { w: img.naturalWidth, h: img.naturalHeight, complete: img.complete },
        sampleDistinct: distinct.size,
        sampleFirst8: samples,
        chosenCount: chosen.length,
        chosen: chosen.map(c => ({ code: c.code, hex: c.hex })),
        genError,
        patternColors: pattern ? pattern.palette.length : 0,
        patternCellsDistinct: pattern ? new Set(Array.from(pattern.cells)).size : 0,
        patternEmpty: pattern ? pattern.stats.emptyCount || 0 : 0,
        patternMatte: pattern ? pattern.matte : null,
        patternPalette: pattern ? pattern.palette.map(c => ({ code: c.code, hex: c.hex })) : [],
        stats: pattern ? pattern.stats : null
      }
    }
  }
}
