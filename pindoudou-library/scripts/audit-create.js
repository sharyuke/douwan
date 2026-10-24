/* 自检探针：在工作台左栏「① 创建」里把三个来源入口各走一遍。
   用法：node scripts/audit.cjs --eval-file scripts/audit-create.js /editor
   （故意不带 --setup-file：这一项要的就是「刚打开、什么都还没有」的工作台）

   为什么必须有这么一项：这三个入口原来是一个独立页面（/create），合并进工作台后
   最容易悄悄坏掉的地方是「点一下到底有没有出图」—— 页面不报错、按钮也在，
   但点了没反应，纯看「有没有 console 错误」的断言是查不出来的。
   所以这里每个入口都点到真出图为止，并且用真实豆数作为证据。 */
(async () => {
  const d = window.__douzao
  if (!d) return { ok: false, err: '调试桥未就绪' }
  const S = await d.studio()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (fn, ms = 6000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      if (fn()) return true
      await sleep(60)
    }
    return false
  }
  const stepLabel = () => (document.querySelector('.topsteps .step.active .stepLabel') || {}).textContent?.trim() || ''
  const beads = () => (S.pattern.value ? S.pattern.value.stats.beadCount : 0)
  const name = () => S.projectName.value
  const out = { ok: true }

  // ---------- 0) 三个入口确实长在「① 创建」这张卡里，而且旧页面不存在了 ----------
  const tabs = [...document.querySelectorAll('.sourceTabs button')]
  out.entry = {
    tabCount: tabs.length,
    tabLabels: tabs.map(b => b.textContent.trim()),
    inCreateCard: (tabs[0]?.closest('section.card')?.querySelector('h3') || {}).textContent?.trim() || '',
    // 旧的独立「开始创作」页面必须彻底不存在
    oldPageGone: !document.querySelector('.createStep') && !document.querySelector('.createGrid'),
    emptyStateText: (document.querySelector('.stage .empty strong') || {}).textContent?.trim() || '',
    stepWhenEmpty: stepLabel(),
    dropzone: !!document.querySelector('.upload'),
    matteBarStillHere: !!document.querySelector('.matteBar')
  }

  // ---------- 1) 上传照片：把真图塞进 file input，走和用户完全一样的路径 ----------
  const cv = document.createElement('canvas')
  cv.width = cv.height = 240
  const cx = cv.getContext('2d')
  cx.fillStyle = '#F4F6F8'
  cx.fillRect(0, 0, 240, 240)
  cx.fillStyle = '#E4572E'
  cx.beginPath()
  cx.arc(120, 120, 78, 0, Math.PI * 2)
  cx.fill()
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'))
  const file = new File([blob], 'audit-upload.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('.upload ~ input[type=file], input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  out.photo = {
    gotPattern: await waitFor(() => beads() > 0),
    beads: beads(),
    empty: S.pattern.value ? S.pattern.value.stats.emptyCount : 0,
    name: name(),
    stepAfter: stepLabel()
  }

  // ---------- 2) AI 生成素材：入口保留、功能关闭，只显示占位文案 ----------
  tabs[1]?.click()
  await sleep(200)
  const soon = document.querySelector('[data-audit="ai-pending"]')
  out.ai = {
    tabLabel: tabs[1]?.textContent.trim() || '',
    placeholder: !!soon,
    text: (soon || {}).textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) || '',
    // 占位期间不该再出现输入框与生成按钮
    promptInput: !!document.querySelector('.srcPrompt input'),
    generateBtn: !!document.querySelector('.srcPrompt button')
  }

  // ---------- 3) 免费素材库：点一张「和当前不是同一个」的，必须直接换图 ----------
  tabs[2]?.click()
  await sleep(200)
  const A2 = await d.assets()
  const tier = Object.fromEntries(A2.ASSETS.map(a => [a.name, a.tier]))
  const picks = [...document.querySelectorAll('.srcAssets .srcAsset')]
  const pickName = p => p.title.split(' ·')[0]
  out.library = {
    count: picks.length,
    allLinked: !!document.querySelector('a[href*="/library"]'),
    // 这个入口叫「免费素材库」，列出来的必须全是免费可用的，
    // 否则用户点第一个就撞上「会员专属」，等于把人堵在门口
    allFree: picks.every(p => tier[pickName(p)] === 'free')
  }
  // 热门第一位就是橘猫头像，而上面 AI 那步刚生成过它 ——
  // 直接点第一张会因为「名字没变」得出假阴性，所以要挑一个名字不同的
  const target = picks.find(p => pickName(p) !== name()) || null
  out.library.picked = target ? pickName(target) : ''
  if (target) {
    const before = name()
    target.click()
    out.library.changed = await waitFor(() => name() !== before)
    out.library.beads = beads()
    out.library.name = name()
    out.library.stepAfter = stepLabel()
  }

  return out
})()
