/* 自检探针：在真实浏览器里驱动第三步「完成」的完整闭环。
   用法：node scripts/audit.cjs --setup-file scripts/audit-fixture.js --eval-file scripts/audit-finish.js /p_audit_fixture?finish=1

   这条链路最容易「看起来做完了、其实没落地」，所以断言的都是真实数字：
     · ?finish=1 真的把完成弹窗打开了（工作台「我已经拼完了」就落在这里）；
     · 免费版：逐颗点击被拦住（进度不变 + 弹 Pro 说明），但「完成作品」照样能用；
     · 完成前把「要用多少 / 从库存扣多少 / 缺多少」如实算给用户看；
     · 确认完成后：作品存档里有 finishedAt、进度补满、顶栏第三步打 ✓、库存按预算扣掉、成长记录能读到；
     · 成品照片：上传 → 压缩成 JPEG dataURL 存进存档 → 分享卡第三格用它；
     · 「取消完成」把库存加回去、进度退回完成前的样子（不是清零）。
*/
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const [S, Inv, M] = await Promise.all([d.studio(), d.inventoryStore(), d.membership()])
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const byText = (sel, text) => Array.from(document.querySelectorAll(sel))
    .find(e => e.textContent.replace(/\s+/g, '').includes(text.replace(/\s+/g, '')))
  const dialogEl = () => document.querySelector('.modal.show .dialog')
  const dialogTitle = () => (dialogEl()?.querySelector('.dialog__head h2')?.textContent || '').trim()
  const footBtn = text => byText('.dialog__foot .btn', text)
  const stockSum = () => Object.values(Inv.inventory.value).reduce((s, n) => s + (Number(n) || 0), 0)
  const headerStep3 = () => {
    const e = document.querySelectorAll('.topsteps .step')[2]
    return e ? { text: e.textContent.trim(), done: e.classList.contains('done'), disabled: !!e.disabled } : null
  }
  const stored = () => {
    try { return JSON.parse(localStorage.getItem('douzao-projects-v2') || '[]') } catch { return [] }
  }
  const findProj = () => stored().find(p => p.id === S.currentProjectId.value) || null
  /** 弹窗里那块「要用多少 / 从库存扣多少」的结算预览 */
  const costLines = () => Array.from(document.querySelectorAll('.dialog .costLine'))
    .map(e => e.textContent.replace(/\s+/g, ' ').trim())

  const out = { ok: true, plan: M.planLabel.value, isPro: M.isPro.value }
  const before = {
    finished: S.isFinished.value,
    progress: S.buildProgress.value.size,
    stock: stockSum()
  }
  out.before = { ...before, step3: headerStep3() }

  // ---------- 1) ?finish=1 直接把完成弹窗打开 ----------
  out.openedByQuery = dialogTitle() === '完成这件作品'
  if (dialogEl()) { footBtn('先不完成')?.click(); await sleep(250) }
  out.dialogClosedAgain = !dialogEl()

  // ---------- 2) 免费版：逐颗标记被拦，而完成作品不被拦 ----------
  {
    const stage = document.querySelector('.buildStage')
    const progressBefore = S.buildProgress.value.size
    if (stage) {
      const r = stage.getBoundingClientRect()
      stage.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.5, bubbles: true, cancelable: true
      }))
    }
    await sleep(250)
    out.freeGate = {
      // 免费版点画布 → 弹的是「逐颗标记进度是 Pro」，不是「Build Mode 是 Pro」
      blockTitle: dialogTitle(),
      progressUnchanged: S.buildProgress.value.size === progressBefore,
      // 同一页面上「完成作品」按钮必须仍然可点（这就是第三步对免费开放的意思）
      finishButtonFound: !!byText('.buildBar .btn', '完成作品'),
      boardHint: (document.querySelector('.proNote')?.innerText || '').replace(/\s+/g, ' ').slice(0, 60)
    }
    if (dialogEl()) { footBtn('先看看')?.click(); await sleep(200) }
  }

  // ---------- 3) 按按钮打开完成弹窗：结算预览必须是真的 ----------
  {
    byText('.buildBar .btn', '完成作品')?.click()
    await sleep(300)
    const plan = S.finishPlan.value
    out.dialog = {
      title: dialogTitle(),
      open: !!dialogEl(),
      costLines: costLines(),
      planNeed: plan.need,
      planFromStock: plan.fromStock,
      planLack: plan.lack,
      planColors: plan.colors,
      hasPhotoInput: !!document.querySelector('.dialog input[type=file]'),
      // 弹窗上的数字必须来自材料表（不是写死的）
      needMatchesPlan: (document.querySelector('.dialog')?.innerText || '').replace(/[,\s]/g, '')
        .includes(String(plan.need))
    }
  }

  // ---------- 4) 传一张成品照片（走真实的 file input change） ----------
  {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 480
    const x = c.getContext('2d')
    const g = x.createLinearGradient(0, 0, 640, 480)
    g.addColorStop(0, '#FFC93C')
    g.addColorStop(1, '#F5325B')
    x.fillStyle = g
    x.fillRect(0, 0, 640, 480)
    x.fillStyle = '#fff'
    x.font = '800 64px sans-serif'
    x.fillText('DONE', 190, 270)
    const blob = await new Promise(r => c.toBlob(r, 'image/png'))
    const file = new File([blob], 'finished.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const input = document.querySelector('.dialog input[type=file]')
    if (input) {
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(1200)
    }
    const preview = document.querySelector('.dialog .photoBox img')
    out.photo = {
      previewShown: !!preview,
      previewIsStoredJpeg: (preview?.getAttribute('src') || '').startsWith('data:image/jpeg'),
      previewLen: (preview?.getAttribute('src') || '').length,
      /* 手机原图 3~5MB，直接进 localStorage 会把作品存档写爆 —— 必须压过 */
      compressed: (preview?.getAttribute('src') || '').length < 900 * 1024
    }
  }

  // ---------- 5) 确认完成 ----------
  {
    const stockBefore = stockSum()
    const plan = S.finishPlan.value
    footBtn('确认完成')?.click()
    await sleep(700)
    const proj = findProj()
    out.after = {
      dialogClosed: !dialogEl(),
      finishedAt: proj?.finishedAt || 0,
      persisted: (findProj()?.finishedAt || 0) > 0,
      photoStored: (proj?.finishPhoto || '').startsWith('data:image/jpeg'),
      deductColors: proj?.finishDeduct ? Object.keys(proj.finishDeduct).length : 0,
      stockDeducted: stockBefore - stockSum(),
      planFromStock: plan.fromStock,
      deductedEqualsPlan: stockBefore - stockSum() === plan.fromStock,
      completedBeads: proj?.completedBeads || 0,
      progressSize: S.buildProgress.value.size,
      statsTotal: S.buildStats.value.total,
      progressFilled: S.buildProgress.value.size === S.buildStats.value.total,
      percent: S.buildStats.value.percent,
      step3: headerStep3(),
      celebrate: !!document.querySelector('.celebrate'),
      celebrateText: (document.querySelector('.celebrate')?.innerText || '').replace(/\s+/g, ' ').slice(0, 90)
    }
  }

  // ---------- 6) 分享卡：第三格用刚上传的成品照片 ----------
  {
    byText('.buildBar .btn', '分享卡')?.click()
    await sleep(400)
    const boxImgs = Array.from(document.querySelectorAll('.shareCard__art figure'))[2]
    out.share = {
      title: dialogTitle(),
      thirdBoxHasPhoto: !!boxImgs?.querySelector('img'),
      thirdBoxSrcIsPhoto: (boxImgs?.querySelector('img')?.getAttribute('src') || '').startsWith('data:image/jpeg')
    }
    footBtn('关闭')?.click()
    await sleep(250)
  }

  // ---------- 7) 取消完成：库存与进度都要退回原样 ----------
  {
    byText('.celebrate .btn', '取消完成')?.click()
    await sleep(500)
    const proj = findProj()
    out.undo = {
      finishedAt: proj?.finishedAt || 0,
      photoCleared: !(proj?.finishPhoto || ''),
      stockRestored: stockSum() === before.stock,
      progressBack: S.buildProgress.value.size === before.progress,
      step3: headerStep3(),
      celebrateGone: !document.querySelector('.celebrate'),
      // 账户页 / 作品列表 / 徽章读的就是存档里的 finishedAt，清掉才算真的撤销
      clearedFromRecords: !findProj()?.finishedAt
    }
  }

  // ---------- 8) 再完成一次（不带照片），并验证「已完成后补照片」这条路 ----------
  {
    byText('.buildBar .btn', '完成作品')?.click()
    await sleep(300)
    footBtn('确认完成')?.click()
    await sleep(600)
    const t1 = findProj()?.finishedAt || 0
    byText('.celebrate .btn', '成品照片')?.click()
    await sleep(350)
    out.photoOnly = { title: dialogTitle(), isPhotoOnlyDialog: dialogTitle() === '成品照片' }
    // 补一张照片（换个颜色，便于区分）
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 400
    const x = c.getContext('2d')
    x.fillStyle = '#3ECFE0'
    x.fillRect(0, 0, 400, 400)
    const blob = await new Promise(r => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'p2.png', { type: 'image/png' }))
    const input = document.querySelector('.dialog input[type=file]')
    if (input) {
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(1100)
    }
    footBtn('保存照片')?.click()
    await sleep(500)
    const proj = findProj()
    out.photoOnly = {
      ...out.photoOnly,
      saved: (proj?.finishPhoto || '').startsWith('data:image/jpeg'),
      // 补照片不该改动完成时间，也不该二次扣库存
      finishedAtUnchanged: (proj?.finishedAt || 0) === t1,
      stockUnchanged: stockSum() === before.stock - (S.finishPlan.value.fromStock || 0),
      dialogClosed: !dialogEl()
    }
  }

  out.final = {
    finished: S.isFinished.value,
    progress: S.buildProgress.value.size,
    total: S.buildStats.value.total,
    step3: headerStep3(),
    projects: stored().length,
    finishedProjects: stored().filter(p => p.finishedAt).length,
    // 完成后图纸没再改过就不该报「完成之后图纸又改过」
    staleWarning: S.finishStale.value,
    staleHintInDom: !!byText('.celebrate .hint', '完成之后')
  }

  /* ---------- 9) 存档往返必须逐格同色 ----------
     这是一条独立的回归：fromPatternJSON 曾经「先往 cells 写下标、最后再排序色板」，
     只要格子里首次出现的顺序和色板顺序不同，重新打开的作品就会整张换色
     （材料清单 / 用量跟着一起错）。这里拿真实图案真跑一遍往返。 */
  {
    const p = S.pattern.value
    const json = d.pattern.toPatternJSON(p)
    const back = d.pattern.fromPatternJSON(json, p.brandId)
    const codeAt = (pat, i) => (pat.cells[i] < 0 ? null : (pat.palette[pat.cells[i]] || {}).code || null)
    let diff = 0
    for (let i = 0; i < p.cells.length; i++) if (codeAt(p, i) !== codeAt(back, i)) diff++
    out.roundTrip = {
      cells: p.cells.length,
      colorsBefore: p.palette.length,
      colorsAfter: back.palette.length,
      cellColorDiff: diff,
      sameSignature: S.patternSignature(back) === S.patternSignature(p)
    }
  }

  return out
})()
