/* 自检探针：功能图标在「空工作台 / 首页 / 素材库」这几个入口上的同名位置。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js \
     --eval-file scripts/audit-function-icons-entries.js --page editor --page home --page library

   手机端空画布的「上传图片 / 免费素材库」、首页主按钮「选择图片」、
   素材库顶栏的「上传图片去创作」——都该是交付包的像素插画，且真的加载成功。 */
(async () => {
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const txt = el => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const steps = []
  const step = (name, pass, detail = '') => steps.push({ name, pass: !!pass, detail })
  const artSrc = el => {
    const img = el && el.querySelector('img.pixelIcon--art')
    return img ? img.getAttribute('src') || '' : ''
  }
  const loaded = el => {
    const img = el && el.querySelector('img.pixelIcon--art')
    return !!img && img.complete && img.naturalWidth > 0
  }
  const fnName = src => {
    const base = String(src).split('/').pop() || ''
    return base.replace(/-[A-Za-z0-9_-]{8}\.png$/, '')
  }
  const isFn = (src, name) => fnName(src) === name
  const check = (label, el, file) => {
    const src = artSrc(el)
    step(`${label} 用 ${file}`, isFn(src, file), src ? fnName(src) : '还是网格图标')
    if (src) step(`${label} 图标加载成功`, loaded(el))
  }

  try {
    const hash = location.hash || '#/'
    if (hash.startsWith('#/editor')) {
      /* 这两个按钮只在手机端出现（桌面 / 平板用空画布引导那套版式） */
      if (innerWidth > 780) return { ok: true, steps, width: innerWidth, hash, skipped: '桌面 / 平板没有空画布按钮' }
      const actions = qa('.emptyActions button')
      step('空画布有 2 个入口', actions.length === 2, actions.map(txt).join('/'))
      check('空画布·上传图片', actions.find(b => txt(b).includes('上传图片')), 'upload')
      check('空画布·免费素材库', actions.find(b => txt(b).includes('免费素材库')), 'free-library')
      /* 没图纸时命令栏的「导出」必须还是禁用的 */
      const delivery = qa('.quickRow .quickItem').find(b => txt(b) === '导出')
      if (delivery) step('没图纸时「导出」禁用', delivery.disabled === true, `disabled=${delivery.disabled}`)
    } else if (q('.uploadCard__btn')) {
      check('首页·选择图片', q('.uploadCard__btn'), 'upload')
    }
    const libUpload = q('.libUpload')
    if (libUpload) check('顶栏·上传图片去创作', libUpload, 'upload')
    return { ok: steps.every(s => s.pass), steps, width: innerWidth, hash }
  } catch (e) {
    return { ok: false, steps, err: e && e.message, width: innerWidth }
  }
})()
