/* =========================================================================
   后台素材库「批量修改 + 批量上传」探针（真浏览器、真接口）

   用法：
     ADMIN_USER=... ADMIN_PASS=... ADMIN_API_BASE=https://dw.sharyuke.com \
     ADMIN_EVAL_FILE=scripts/admin-audit-assets-batch.js ADMIN_EVAL_PAGE=admin-assets \
     node scripts/admin-audit.cjs

   它会真的写数据：先在后台上传两张 64×64 的测试 PNG（草稿），
   再用列表里的批量面板改标签 / 排序 / 分层，核对接口返回，最后归档 + 删除。
   跑之前确认用的是临时管理员，跑完把管理员删掉。
   ========================================================================= */
(async () => {
  /* 这个探针会真的上传 / 改数据 / 删除，只在桌面视口跑一次；
     手机视口只做只读渲染检查（后台自检本身会截图）。 */
  if (window.innerWidth < 700) {
    return { ok: true, skipped: '写操作探针只在桌面视口执行' }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 15000, step = 120) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try { if (fn()) return true } catch { /* 页面还在刷新 */ }
      await sleep(step)
    }
    return false
  }
  const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim()
  const byText = (label, root = document) =>
    [...root.querySelectorAll('button')].find(b => text(b) === label)
  const rows = () => [...document.querySelectorAll('.adm-table tbody tr')]
  const out = { ok: true, steps: [] }

  const token = (() => {
    try { return JSON.parse(localStorage.getItem('douwan-admin-tokens') || '{}').access_token || '' } catch { return '' }
  })()
  if (!token) return { ok: false, err: '后台登录令牌不存在（自检没有登录成功）' }

  const api = async (path, init = {}) => {
    const res = await fetch('/api/v1' + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) }
    })
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  }

  /* 上一次失败可能留下测试素材，先清掉，保证这次从干净的列表开始 */
  const cleanProbeAssets = async () => {
    const found = await api('/admin/assets?keyword=' + encodeURIComponent('批量自检') + '&page_size=20')
    const list = (found.body && found.body.data && found.body.data.list) || []
    for (const a of list) {
      await api(`/admin/assets/${a.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived', reason: '批量功能自检清理' })
      })
      await api(`/admin/assets/${a.id}?reason=` + encodeURIComponent('批量功能自检清理'), { method: 'DELETE' })
    }
    return list.length
  }

  try {
    /* ---------- ① 批量上传：两张不同名字的图片一次传完 ---------- */
    const stale = await cleanProbeAssets()
    if (stale) out.steps.push({ step: '清理上次残留', ok: true, removed: stale })
    if (!(await waitFor(() => rows().length > 0))) throw new Error('素材列表没有加载出来')
    const uploadBtn = byText('上传素材')
    if (!uploadBtn) throw new Error('找不到「上传素材」按钮')
    uploadBtn.click()
    if (!(await waitFor(() => !!document.querySelector('.adm-drop')))) throw new Error('上传弹窗没有打开')

    const makeFile = async (name, color) => {
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const ctx = c.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 64, 64)
      const blob = await new Promise(r => c.toBlob(r, 'image/png'))
      return new File([blob], name, { type: 'image/png' })
    }
    const files = [await makeFile('probe-a.png', '#f35b4a'), await makeFile('probe-b.png', '#38b26a')]
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(f)
    document.querySelector('.adm-drop').dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: dt
    }))
    if (!(await waitFor(() => document.querySelectorAll('.adm-assetcard').length === 2))) {
      throw new Error('拖拽后没有出现 2 张待上传卡片')
    }

    const names = ['批量自检甲', '批量自检乙']
    const nameInputs = [...document.querySelectorAll('.adm-assetcard__name')]
    nameInputs.forEach((input, i) => {
      input.value = names[i]
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(150)

    const categorySelect = [...document.querySelectorAll('.adm-modal .adm-select')]
      .find(s => [...s.options].some(o => /请选择分类/.test(o.textContent)))
    if (!categorySelect) throw new Error('上传弹窗里找不到分类下拉')
    const categoryOption = [...categorySelect.options].find(o => o.value)
    if (!categoryOption) throw new Error('没有可用的启用分类')
    categorySelect.value = categoryOption.value
    categorySelect.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(120)

    const confirmBtn = [...document.querySelectorAll('.adm-modal__foot button')]
      .find(b => /确认上传/.test(text(b)))
    if (!confirmBtn) throw new Error('找不到「确认上传」按钮')
    confirmBtn.click()
    if (!(await waitFor(() => !document.querySelector('.adm-modal'), 20000))) {
      throw new Error('上传没有结束（弹窗一直没关）：' + text(document.querySelector('.adm-modal')))
    }
    out.steps.push({ step: '批量上传两张', ok: true })

    /* ---------- ② 列表里找到这两条（按名称搜索） ---------- */
    const search = [...document.querySelectorAll('.adm-toolbar .adm-input')]
      .find(i => /搜索素材名称/.test(i.placeholder || ''))
    if (!search) throw new Error('找不到搜索框')
    search.value = '批量自检'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    byText('查询')?.click()
    if (!(await waitFor(() => rows().length === 2))) {
      throw new Error(`搜索「批量自检」应得到 2 条，实际 ${rows().length} 条`)
    }
    const titles = rows().map(tr => text(tr.querySelectorAll('td')[2]))
    out.uploaded = titles
    if (!names.every(n => titles.some(t => t.includes(n)))) {
      throw new Error(`逐张名称没有生效：${JSON.stringify(titles)}`)
    }
    out.steps.push({ step: '逐张名称入库', ok: true, titles })

    /* ---------- ③ 勾选两条 → 批量改标签 / 排序 / 分层 ---------- */
    rows().forEach(tr => tr.querySelector('td input[type="checkbox"]').click())
    if (!(await waitFor(() => !!document.querySelector('[data-asset-batch]')))) {
      throw new Error('勾选后没有出现批量修改面板')
    }

    const tagsMode = document.querySelector('[data-batch-tags-mode]')
    tagsMode.value = 'add'
    tagsMode.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(120)

    const tagsInput = document.querySelector('[data-batch-tags]')
    if (!tagsInput) throw new Error('选完标签模式后找不到标签输入框')
    tagsInput.value = '批量自检,钥匙扣'
    tagsInput.dispatchEvent(new Event('input', { bubbles: true }))

    const sortInput = [...document.querySelectorAll('[data-asset-batch] .adm-input')]
      .find(i => i.type === 'number')
    if (!sortInput) throw new Error('批量面板里找不到排序值输入框')
    sortInput.value = '77'
    sortInput.dispatchEvent(new Event('input', { bubbles: true }))

    const tierSelect = [...document.querySelectorAll('[data-asset-batch] .adm-select')]
      .find(s => [...s.options].some(o => o.textContent.includes('免费（free）')))
    if (!tierSelect) throw new Error('批量面板里找不到会员分层下拉')
    tierSelect.value = 'pro'
    tierSelect.dispatchEvent(new Event('change', { bubbles: true }))

    /* Vue 的状态更新与 DOM 刷新是异步的，读预览前先等一拍 */
    await sleep(200)
    const summary = text(document.querySelector('.adm-batchsum'))
    out.summary = summary
    if (!/追加标签/.test(summary) || !/77/.test(summary) || !/pro/.test(summary)) {
      throw new Error(`批量预览没有跟上填写的内容：${summary}`)
    }

    document.querySelector('[data-batch-apply]').click()
    if (!(await waitFor(() => !document.querySelector('[data-asset-batch]'), 20000))) {
      throw new Error('批量修改没有完成（面板一直没消失）')
    }

    /* ---------- ④ 用接口核对结果 ---------- */
    const listed = await api('/admin/assets?keyword=' + encodeURIComponent('批量自检') + '&page_size=20')
    const list = (listed.body && listed.body.data && listed.body.data.list) || []
    if (list.length !== 2) throw new Error(`接口只返回 ${list.length} 条测试素材`)
    out.after = list.map(a => ({ id: a.id, title: a.title, tier: a.tier, sort_order: a.sort_order, tags: a.tags, status: a.status }))
    for (const a of list) {
      if (a.tier !== 'pro' || a.sort_order !== 77) {
        throw new Error(`批量修改没有落库：${JSON.stringify(a)}`)
      }
      if (!(a.tags || []).includes('批量自检') || !(a.tags || []).includes('钥匙扣')) {
        throw new Error(`标签没有批量追加：${JSON.stringify(a.tags)}`)
      }
      if (a.status !== 'draft') throw new Error(`上传时的草稿状态被改了：${a.status}`)
    }
    out.steps.push({ step: '批量修改落库', ok: true })

    /* ---------- ⑤ 清理：归档后删除 ---------- */
    const ids = list.map(a => a.id)
    for (const id of ids) {
      await api(`/admin/assets/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived', reason: '批量功能自检清理' })
      })
      await api(`/admin/assets/${id}?reason=` + encodeURIComponent('批量功能自检清理'), { method: 'DELETE' })
    }
    const left = await api('/admin/assets?keyword=' + encodeURIComponent('批量自检') + '&page_size=20')
    const remain = ((left.body && left.body.data && left.body.data.list) || []).length
    out.cleaned = remain === 0
    if (remain !== 0) throw new Error(`测试素材没有清理干净，还剩 ${remain} 条（ids=${ids.join(',')}）`)
    out.steps.push({ step: '清理测试素材', ok: true })
  } catch (e) {
    out.ok = false
    out.err = (e && e.message) || String(e)
    out.modalText = text(document.querySelector('.adm-modal'))
  }
  return out
})()
