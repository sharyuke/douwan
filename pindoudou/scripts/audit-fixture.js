/* 自检预置脚本：用「真实生成链路」造一件作品写进本机存档。
   关键点：不手写 localStorage 结构（那样容易和存档 schema 对不上，测出来的问题是假的），
   而是直接调工作台的 useAsset / regenerate / saveProject，和用户点「用这个图案」同一条路径。

   注意：清空存档由 audit.cjs 在页面加载「之前」做（清完还要重新导航一次），
   因为各个 store 是在模块加载时读 localStorage 的，在这里 removeItem
   只会删掉存储、删不掉内存里那一份，会导致作品 id 被复用、套餐配额算错。 */
(async () => {
  /* 自检不看新手引导：它会在首次进入时自动盖一层全屏说明，
     把页面截图和点击落点都改掉。指引本身由 scripts/audit-guide.js 单独验。 */
  try { localStorage.setItem('douwan.guide.v1', '1') } catch { /* 忽略 */ }

  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }

  const [A, S, Inv] = await Promise.all([d.assets(), d.studio(), d.inventoryStore()])

  // AUDIT_PRO=1 时把身份切成 Pro，用于验证解锁后的界面
  let plan = 'free'
  if (window.__AUDIT_PRO) {
    const M = await d.membership()
    M.applyServerMembership({ plan: 'pro', is_pro: true, expire_at: null })
    plan = M.planLabel.value
  }

  // 先把库存关掉再生成，保证图案保留完整颜色
  Inv.useInventory.value = false
  Inv.clearInventory()

  const asset = A.ASSETS.find(a => a.featured) || A.ASSETS[0]
  await S.useAsset(asset)
  /* 画布单位改成「格」之后（见 useMembership 的 'canvas.cells'），
     这里必须走 setCanvasSize —— 直接写 options.boardCols 已经不存在了，
     写了也不生效，自检就会悄悄退化成默认尺寸而没人发现。
     52×52 = 一块 52 钉板（免费版的单边上限，也是最小的整板尺寸）。 */
  S.setCanvasSize(52, 52)
  // 打开自动抠背景：这样编辑器 / 材料 / 建造 / 作品页都会渲染到
  // 「有空格的图案」，把空格相关的分支也纳入自检（否则这些路径根本没被跑过）
  S.options.removeBg = true
  if (!S.regenerate({ keys: ['high', 'easy', 'art'], silent: true })) {
    return { ok: false, err: '生成失败' }
  }

  const pid = S.saveProject('审计用示例作品')
  if (!pid) return { ok: false, err: '存档失败' }

  // 造一点拼制进度，验证建造模式 / 进度条 / 剩余颜色（空格不用拼，跳过）
  const p = S.pattern.value
  if (p) {
    let marked = 0
    for (let i = 0; i < p.cells.length && marked < 300; i++) {
      if (p.cells[i] < 0) continue
      if (i % 3) continue
      S.markBuildCell(i, true)
      marked++
    }
    S.persistBuildProgress()
  }

  // 库存：按图案真实需要的颜色备货，故意留两个色号缺货，
  // 这样「缺色 / 补购」这张表有真实数据可算，同时图案不受影响
  const need = []
  const seen = new Set()
  for (let i = 0; i < p.cells.length; i++) {
    const c = p.palette[p.cells[i]]
    if (c && !seen.has(c.id)) { seen.add(c.id); need.push(c.id) }
  }
  need.forEach((id, i) => Inv.setStock(id, i < 2 ? 40 : 900))
  Inv.inventoryMode.value = 'strict'
  Inv.useInventory.value = true

  /* 第二件作品：完整走一遍「完成作品」链路。
     为什么必须在自检里真做一遍：完成态（顶栏第三步打 ✓、完成庆祝块、
     作品详情页的完成卡片、库存扣减与撤销）只有真完成过才渲染得出来，
     手写 localStorage 造出来的状态和真实数据形状对不上，测了也没意义。

     注意 currentProjectId 必须先清空 —— saveProject() 对「当前作品」
     是覆盖而不是新建。 */
  const progressInProgress = S.buildProgress.value.size
  S.currentProjectId.value = ''
  const doneId = S.saveProject('审计用已完成作品')
  const finished = doneId ? S.finishProject({}) : { ok: false, reason: 'save-failed' }

  return {
    ok: true,
    plan,
    projectId: pid,
    finishedId: doneId,
    finishOk: !!finished.ok,
    finishDeducted: finished.deducted ? Object.keys(finished.deducted).length : 0,
    asset: `${asset.id} ${asset.name}`,
    board: `${S.options.canvasW}x${S.options.canvasH}`,
    variants: S.variants.value.map(v => `${v.key}:${v.stats.colorCount}色/${v.stats.beadCount}颗/还原${v.stats.similarity}`),
    inventoryColors: Inv.inventoryColors.value.length,
    // 第一件（进行中）的进度，和第二件完成后的满进度
    progressInProgress,
    progressFinished: S.buildProgress.value.size
  }
})()
