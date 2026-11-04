/* =========================================================================
   SEO V3.0 验收自检
   -------------------------------------------------------------------------
   只测这次改动真正影响的东西，不跑全站：

     1. 首页：主视觉（标题图 + 上传卡 + 插画）在；2026-10-26 晚起首屏以下的
        长文内容区又删掉了（页面只留主视觉 + 站点页脚），正文改由服务端 SEO 壳
        写进原始 HTML —— 断言「页面里不渲染内容区」且「原始 HTML 里正文还在」；
     2. /colors/：色号与色卡对照页能打开，标题 / 描述 / H1 齐全，有品牌与色号表；
     3. 素材详情页与分类页：标题 / 描述 / H1 / 图片 alt 都按模板生成；
     4. sitemap.xml：收了该收的页面，没收没有内容的分类页；
     5. robots.txt：三家爬虫都放行，并且声明了 Sitemap。

   用法：
     node scripts/verify-seo-v3.cjs                 # 审本机 dist/（默认 http://127.0.0.1:4402）
     node scripts/verify-seo-v3.cjs --url https://dw.sharyuke.com
   ========================================================================= */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.resolve(process.env.AUDIT_DIST || path.join(ROOT, 'dist'))
const TMP_ROOT = process.env.AUDIT_TMP || path.join(ROOT, '.tmp')
fs.mkdirSync(TMP_ROOT, { recursive: true })
const OUT = process.env.AUDIT_OUT || path.join(TMP_ROOT, 'douwan-seo-v3')
const PORT = Number(process.env.SEO_VERIFY_PORT || 4402)

const argv = process.argv.slice(2)
let externalBase = ''
const urlIdx = argv.indexOf('--url')
if (urlIdx >= 0) {
  externalBase = String(argv[urlIdx + 1] || '').replace(/\/+$/, '')
  argv.splice(urlIdx, 2)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean)

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 }
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ------------------------------------------------------------------ 静态服务器 */

function staticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0])
      if (p === '/') p = '/index.html'
      const file = path.join(DIST, p)
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(fs.readFileSync(path.join(DIST, 'index.html')))
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
      res.end(fs.readFileSync(file))
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

/* ------------------------------------------------------------------ CDP */

const CDP_TIMEOUT_MS = 30000

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.events = []
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
      }
    })
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(method + ' 超时'))
        }
      }, CDP_TIMEOUT_MS)
    })
  }

  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function fetchJSON(url) {
  const res = await fetch(url)
  return res.json()
}

/* ------------------------------------------------------------------ 检查项 */

const results = []
function check(group, name, pass, detail) {
  results.push({ group, name, pass: !!pass, detail: detail || '' })
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? '  —— ' + detail : ''}`)
}

function pick(html, re) {
  const m = html.match(re)
  return m ? m[1] : ''
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const origin = externalBase || `http://127.0.0.1:${PORT}`
  const server = externalBase ? null : await staticServer()
  fs.mkdirSync(OUT, { recursive: true })

  console.log('SEO V3.0 验收自检：' + origin + '\n')

  /* ---------- 1. 抓 head / sitemap / robots（用真实 HTTP 请求） ---------- */
  const get = async p => {
    const res = await fetch(origin + p, { redirect: 'follow' })
    return { status: res.status, url: res.url, text: await res.text() }
  }

  const home = await get('/')
  check('head', '首页返回 200', home.status === 200, 'status=' + home.status)
  const homeTitle = pick(home.text, /<title>([^<]*)<\/title>/)
  const homeDesc = pick(home.text, /<meta name="description" content="([^"]*)"/)
  const homeH1 = pick(home.text, /<h1[^>]*>([^<]*)<\/h1>/)
  check('head', '首页有独立标题', !!homeTitle, homeTitle)
  check('head', '首页有描述', !!homeDesc, homeDesc.slice(0, 60) + '…')
  check('head', '首页 H1 是「豆玩拼豆图纸生成器」', homeH1.trim() === '豆玩拼豆图纸生成器', homeH1)
  /* 2026-10-26：三端都删掉了首屏以下的长文内容区，正文改由服务端 SEO 壳
     写进原始 HTML（爬虫读的就是这份）。这条断言守住「正文没跟着消失」。 */
  check('head', '首页原始 HTML 仍含长文正文（服务端 SEO 壳）',
    home.text.includes('seo-steps') && home.text.includes('免费拼豆图纸怎么生成') && home.text.includes('seo-faq'),
    'seo-steps=' + home.text.includes('seo-steps') + ' 小节=' + home.text.includes('免费拼豆图纸怎么生成') + ' FAQ=' + home.text.includes('seo-faq'))

  const colors = await get('/colors/')
  check('head', '/colors/ 返回 200', colors.status === 200, 'status=' + colors.status)
  check('head', '/colors/ 标题含「拼豆色号」', pick(colors.text, /<title>([^<]*)<\/title>/).includes('拼豆色号'), pick(colors.text, /<title>([^<]*)<\/title>/))
  check('head', '/colors/ 有描述与 H1', !!pick(colors.text, /<meta name="description" content="([^"]*)"/) && !!pick(colors.text, /<h1[^>]*>([^<]*)<\/h1>/), pick(colors.text, /<h1[^>]*>([^<]*)<\/h1>/))

  const pets = await get('/materials/category/pets/')
  const petsTitle = pick(pets.text, /<title>([^<]*)<\/title>/)
  const petsDesc = pick(pets.text, /<meta name="description" content="([^"]*)"/)
  check('head', '分类页标题含「拼豆图纸」', petsTitle.includes('拼豆图纸'), petsTitle)
  check('head', '分类页描述里写真实素材数', /\d+ 个/.test(petsDesc), petsDesc.slice(0, 70) + '…')

  /* 素材详情页：先从素材中心找一个真实 slug */
  const matList = await get('/materials/')
  const slug = (matList.text.match(/\/materials\/([a-z0-9-]{6,})\//) || [])[1]
  if (slug) {
    const detail = await get('/materials/' + slug + '/')
    const dTitle = pick(detail.text, /<title>([^<]*)<\/title>/)
    const dDesc = pick(detail.text, /<meta name="description" content="([^"]*)"/)
    const dH1 = pick(detail.text, /<h1[^>]*>([^<]*)<\/h1>/)
    const alt = pick(detail.text, /<img[^>]*alt="([^"]*拼豆图纸[^"]*)"/)
    check('head', '素材详情页标题是「名称拼豆图纸」格式', /拼豆图纸｜免费拼豆素材 - 豆玩/.test(dTitle), dTitle)
    check('head', '素材详情页描述按真实字段生成', dDesc.includes('拼豆素材') && dDesc.length > 40, dDesc.slice(0, 70) + '…')
    check('head', '素材详情页 H1 是「名称拼豆图纸」', dH1.trim().endsWith('拼豆图纸'), dH1)
    check('head', '素材详情页图片 alt 有意义', alt.includes('拼豆图纸'), alt)
  } else {
    check('head', '素材详情页可访问', false, '没找到真实素材 slug')
  }

  /* sitemap / robots */
  const sm = await get('/sitemap.xml')
  check('sitemap', 'sitemap 可访问', sm.status === 200)
  check('sitemap', 'sitemap 收录 /colors/', sm.text.includes('/colors/'))
  check('sitemap', 'sitemap 收录有内容的分类页', sm.text.includes('/materials/category/pets/'))
  check('sitemap', 'sitemap 不收录没有素材的分类页', !sm.text.includes('/materials/category/avatar/') && !sm.text.includes('/materials/category/guofeng/'))
  check('sitemap', 'sitemap 用 HTTPS 绝对地址', sm.text.includes('<loc>https://') && !sm.text.includes('<loc>http://'))

  const robots = await get('/robots.txt')
  check('robots', 'robots.txt 放行 Baiduspider', /User-agent:\s*\*[\s\S]*?Baiduspider/i.test(robots.text) || /Baiduspider/i.test(robots.text))
  check('robots', 'robots.txt 放行 Googlebot', /Googlebot/i.test(robots.text))
  check('robots', 'robots.txt 放行 Bingbot', /Bingbot/i.test(robots.text))
  check('robots', 'robots.txt 声明了 Sitemap', /Sitemap:\s*https?:\/\//i.test(robots.text))

  /* ---------- 2. 浏览器里的首页内容区 ---------- */
  const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!chromePath) {
    console.error('找不到 Chrome / Edge，跳过浏览器检查')
    finish()
    return
  }

  const profile = fs.mkdtempSync(path.join(TMP_ROOT, 'seo-v3-chrome-'))
  const debugPort = 9333 + (process.pid % 400)
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--disable-default-browser-check', '--disable-crashpad', '--disable-breakpad',
    '--hide-scrollbars', '--lang=zh-CN',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let version = null
  for (let i = 0; i < 60; i++) {
    try { version = await fetchJSON(`http://127.0.0.1:${debugPort}/json/version`); break } catch { await sleep(250) }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪')
    chrome.kill(); server && server.close(); process.exit(1)
  }
  console.log('Chrome:', version['Browser'], '\n')

  const browser = new CDP(version.webSocketDebuggerUrl)
  await browser.ready

  for (const vp of WIDTHS) {
    console.log(`— ${vp.name} ${vp.width}×${vp.height}`)
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const send = (m, p) => browser.send(m, p, sessionId)
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.name === 'mobile' })

    const errors = []
    browser.events.length = 0
    await send('Page.navigate', { url: `${origin}/` })
    await sleep(2600)

    const probe = await send('Runtime.evaluate', {
      expression: `(() => {
        const q = s => document.querySelector(s)
        const qa = s => Array.from(document.querySelectorAll(s))
        const t = el => (el && el.textContent ? el.textContent.trim() : '')
        const hero = q('.homeHero')
        /* 页脚：2026-10-26 晚起首页用站点的三栏页脚（操作台底部那条挪过来的）。 */
        const foot = q('footer.footer')
        const content = q('.homeContent')
        const blocks = content ? Array.from(content.querySelectorAll('.hcH2')).map(h => t(h)) : []
        const cats = qa('.hcCat')
        const catItems = cats.slice(0, 6).map(c => ({
          name: t(c.querySelector('.hcCat__name')),
          count: t(c.querySelector('.hcCat__count')),
          href: (c.querySelector('a') || {}).getAttribute ? c.querySelector('a').getAttribute('href') : ''
        }))
        const faq = qa('.hcFaq__item')
        const steps = qa('.hcStep')
        const features = qa('.hcFeature')
        const heroRect = hero ? hero.getBoundingClientRect() : null
        const footRect = foot ? foot.getBoundingClientRect() : null
        /* 新手向导 2026-11-01 已下线，首页更不该出现它。 */
        const wizard = q('.bwiz')
        /* 左右两幅拼豆插画：桌面显示，窄屏（≤1040px）才隐藏。 */
        const collage = qa('.homeCollage')
        const collageVisible = collage.some(c => {
          const r = c.getBoundingClientRect()
          return r.width > 2 && r.height > 2
        })
        const titleArt = q('.homeTitleArt')
        const uploadCard = q('.uploadCard')
        /* H1 是「只给读屏器/爬虫看」的那一行：它在 DOM 里，但页面上不能占位显示。
           .sr-only 以前只写在 HomeView.vue 的 scoped 样式里，新手页吃不到，
           结果这行字直接显示在页面左上角（2026-10-26 用户指出来的）。 */
        const h1El = q('h1')
        const h1Rect = h1El ? h1El.getBoundingClientRect() : null
        return {
          /* document.title 是字符串，不能走 t()（那是取元素 textContent 的） */
          title: String(document.title || ''),
          h1: t(h1El),
          h1Count: qa('h1').length,
          h1Visible: !!(h1Rect && h1Rect.width > 2 && h1Rect.height > 2),
          hasContent: !!content,
          blocks,
          catCount: cats.length,
          catItems,
          faqCount: faq.length,
          stepCount: steps.length,
          featureCount: features.length,
          heroH: heroRect ? Math.round(heroRect.height) : 0,
          heroBottom: heroRect ? Math.round(heroRect.bottom) : 0,
          footTop: footRect ? Math.round(footRect.top) : 0,
          hasHero: !!hero,
          hasTitleArt: !!titleArt,
          hasUploadCard: !!uploadCard,
          hasFoot: !!foot,
          collageVisible,
          hasWizard: !!wizard,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyLen: document.body.innerText.length
        }
      })()`,
      returnByValue: true
    })
    const v = probe.result.value || {}

    /* 2026-10-26 晚：用户要「干净的宣传页」——首屏以下的长文内容区又删掉了。
       正文仍在服务端的 SEO 壳里（原始 HTML 有，页面上不渲染），
       手机 / 平板 / 电脑三端一致。 */
    check('首页', `${vp.name}：主视觉在（标题图 + 上传卡）`, v.hasHero && v.hasTitleArt && v.hasUploadCard,
      `hero=${v.hasHero} 标题图=${v.hasTitleArt} 上传卡=${v.hasUploadCard}`)
    /* 插画（左右两幅拼豆作品）只在宽屏显示：≤1040px 时按设计隐藏，避免挤掉内容区 */
    if (vp.width > 1040) {
      check('首页', `${vp.name}：插画层在`, v.collageVisible, v.collageVisible ? '左右拼豆作品可见' : '没看到插画')
    } else {
      check('首页', `${vp.name}：窄屏不显示插画（按设计隐藏）`, !v.collageVisible, v.collageVisible ? '窄屏还在显示插画' : '已隐藏')
    }
    check('首页', `${vp.name}：首屏以下不渲染长文内容区`, !v.hasContent && v.blocks.length === 0, v.blocks.join(' / ') || '页面里没有内容区')
    check('首页', `${vp.name}：H1 唯一且是主关键词`, v.h1Count === 1 && v.h1.includes('拼豆图纸生成器'), v.h1)
    /* 客户端把 document.title 也写成同一份文案（服务端渲染的 head 与客户端接管后必须一致） */
    check('首页', `${vp.name}：浏览器标题带「豆玩图纸生成器」`, v.title.includes('豆玩图纸生成器'), v.title)
    check('首页', `${vp.name}：H1 只给读屏器看（页面上不显示）`, !v.h1Visible, v.h1Visible ? 'H1 在页面上可见' : '已隐藏')
    check('首页', `${vp.name}：首页不再放新手向导`, !v.hasWizard)
    check('首页', `${vp.name}：站点页脚在主视觉之后`, v.hasFoot && v.footTop >= v.heroBottom - 2,
      '页脚 top=' + v.footTop + ' 主视觉 bottom=' + v.heroBottom)
    check('首页', `${vp.name}：没有横向溢出`, v.overflowX <= 2, 'overflowX=' + v.overflowX)

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    fs.writeFileSync(path.join(OUT, `home-${vp.name}.png`), Buffer.from(shot.data, 'base64'))

    /* 色号页也看一眼 */
    await send('Page.navigate', { url: `${origin}/colors/` })
    await sleep(2400)
    const cprobe = await send('Runtime.evaluate', {
      expression: `(() => {
        const qa = s => Array.from(document.querySelectorAll(s))
        const t = el => (el && el.textContent ? el.textContent.trim() : '')
        return {
          h1: t(document.querySelector('h1')),
          brands: qa('.brandCard').length,
          rows: qa('.colorTable tbody tr').length,
          chips: qa('.chip').length,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }
      })()`,
      returnByValue: true
    })
    const cv = cprobe.result.value || {}
    check('色号页', `${vp.name}：H1 是「拼豆色号与色卡对照」`, cv.h1.includes('拼豆色号'), cv.h1)
    check('色号页', `${vp.name}：品牌卡片有内容`, cv.brands >= 8, cv.brands + ' 个品牌')
    check('色号页', `${vp.name}：色号表有真实色号`, cv.rows > 20, cv.rows + ' 行')
    check('色号页', `${vp.name}：没有横向溢出`, cv.overflowX <= 2, 'overflowX=' + cv.overflowX)

    const cshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    fs.writeFileSync(path.join(OUT, `colors-${vp.name}.png`), Buffer.from(cshot.data, 'base64'))

    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }

  browser.close()
  chrome.kill()
  server && server.close()
  finish()
}

function finish() {
  const failed = results.filter(r => !r.pass)
  console.log('\n===== 自检汇总 =====')
  console.log('检查项:', results.length, '| 通过:', results.length - failed.length, '| 失败:', failed.length)
  for (const f of failed) console.log('  ✗', f.group, f.name, f.detail)
  console.log('截图目录:', OUT)
  process.exit(failed.length ? 2 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
