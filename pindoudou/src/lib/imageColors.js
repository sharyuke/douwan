/* =========================================================================
   素材卡片的色卡：从缩略图里取几个主色
   - 后台素材只存了图片，没有存调色板；卡片上又想给出「这张大概用哪几种豆子」，
     就对缩略图做一次粗量化（40×40、每通道 4 bit）取前几名。
   - 按 URL 缓存：切分类、来回改筛选都不重复算。
   - 同源图片才读得到像素；读失败就返回空数组，卡片只是少一排色点。
   ========================================================================= */

const cache = new Map()

export function dominantColors(url, max = 6) {
  if (!url) return Promise.resolve([])
  if (cache.has(url)) return cache.get(url)
  const job = new Promise(resolve => {
    const im = new Image()
    im.onload = () => resolve(extract(im, max))
    im.onerror = () => resolve([])
    im.src = url
  })
  cache.set(url, job)
  return job
}

function extract(img, max) {
  try {
    const size = 40
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(img, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data

    const buckets = new Map()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      /* 白底不是图案颜色（缩略图是铺白底的 JPEG），跳过 */
      if (r > 236 && g > 236 && b > 236) continue
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const hit = buckets.get(key)
      if (hit) {
        hit.n += 1
        hit.r += r
        hit.g += g
        hit.b += b
      } else {
        buckets.set(key, { n: 1, r, g, b })
      }
    }

    const list = [...buckets.values()]
      .map(x => ({
        n: x.n,
        r: Math.round(x.r / x.n),
        g: Math.round(x.g / x.n),
        b: Math.round(x.b / x.n)
      }))
      .sort((a, b) => b.n - a.n)

    const picked = []
    for (const color of list) {
      if (picked.length >= max) break
      /* 同一个色系只留一个，免得一排点里三颗都是不同深浅的橙 */
      const near = picked.some(p =>
        Math.abs(p.r - color.r) + Math.abs(p.g - color.g) + Math.abs(p.b - color.b) < 60
      )
      if (!near) picked.push(color)
    }
    return picked.map(color => hex(color.r, color.g, color.b))
  } catch {
    return []
  }
}

function hex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}
