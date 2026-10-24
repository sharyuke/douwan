/* 登录 / 账号页自检用的本地静态服务器 + API 假数据。
   只用于无头浏览器审计，不参与生产构建。
   用法：node scripts/mock-api-server.cjs [port]
   然后：node scripts/audit.cjs --url http://127.0.0.1:4399 --page account ... */
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'dist')
const PORT = Number(process.argv[2] || 4399)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const user = {
  id: 9001,
  username: 'wx_audit01',
  email: 'audit@example.com',
  nickname: '审计拼豆工',
  avatar_url: '',
  status: 1,
  created_at: '2026-10-17T09:00:00+08:00',
  last_login_at: '2026-10-17T12:00:00+08:00'
}
const identity = {
  id: 501,
  provider: 'wechat',
  provider_label: '微信',
  provider_open_id_masked: 'open****view',
  nickname: '审计拼豆工',
  avatar_url: '',
  bound_at: '2026-10-17T09:00:00+08:00',
  last_login_at: '2026-10-17T12:00:00+08:00'
}
const entitlement = {
  id: 701,
  user_id: 9001,
  source_type: 'card_key',
  source_type_text: '卡密兑换',
  plan_id: 3,
  plan_name: '一个月',
  plan_code: 'month',
  starts_at: '2026-10-17T12:00:00+08:00',
  expires_at: '2026-11-16T12:00:00+08:00',
  status: 'active',
  status_text: '生效中',
  effective_status: 'active',
  plan_snapshot: { permissions: { 'export.pdf': true, 'palette.full': true } }
}

function json(res, data, status = 200) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

const tokens = {
  access_token: 'audit-access-token',
  refresh_token: 'audit-refresh-token',
  token_type: 'Bearer',
  expires_in: 3600,
  expires_at: '2026-10-22T23:00:00+08:00'
}

/* ------------------------------------------------------------ 素材库假数据 */
/* 只用于无头浏览器自检：字段与 /api/v1/assets 真实返回一致，标题 / 标签 / 时间
   都是固定的，方便断言排序和筛选结果。 */
const assetCategories = [
  { id: 1, slug: 'anime', name: '二次元', sort_order: 90 },
  { id: 2, slug: 'pets', name: '萌宠动物', sort_order: 80 },
  { id: 3, slug: 'couples', name: '情侣情感', sort_order: 70 },
  { id: 4, slug: 'food', name: '美食水果', sort_order: 60 },
  { id: 5, slug: 'plants', name: '植物花卉', sort_order: 50 },
  { id: 6, slug: 'lifestyle', name: '生活美学', sort_order: 40 },
  { id: 7, slug: 'festivals', name: '节日祝福', sort_order: 30 },
  { id: 8, slug: 'cute', name: '萌趣日常', sort_order: 20 },
  { id: 9, slug: 'beginner', name: '新手专区', sort_order: 10 }
]

function assetImage(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">` +
    `<rect width="400" height="300" fill="${color}"/>` +
    `<circle cx="200" cy="150" r="70" fill="#fff" opacity=".55"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const assetRows = [
  ['草莓小猫', 2, ['猫咪', '简单', '钥匙扣'], true, 100, '2026-10-21T10:00:00+08:00', '猫咪抱着草莓，适合做钥匙扣'],
  ['橘子柯基', 2, ['狗狗', '简单', '冰箱贴'], false, 95, '2026-10-20T10:00:00+08:00', '柯基和橘子'],
  ['西瓜熊猫', 2, ['熊熊', '中等', '摆件'], false, 90, '2026-10-19T10:00:00+08:00', '熊猫抱西瓜'],
  ['胡萝卜兔兔', 2, ['兔兔', '简单', '挂饰'], false, 85, '2026-10-18T10:00:00+08:00', '兔子抱胡萝卜'],
  ['抱星星的小恐龙', 1, ['幻想生物', '困难', '摆件'], true, 80, '2026-10-17T10:00:00+08:00', '小恐龙抱星星'],
  ['樱桃企鹅', 2, ['其他动物', '简单', '钥匙扣'], false, 75, '2026-10-16T10:00:00+08:00', '企鹅抱樱桃'],
  ['蜜桃小熊', 2, ['熊熊', '简单', '杯垫'], false, 70, '2026-10-15T10:00:00+08:00', '小熊抱蜜桃'],
  ['橘子猫咪', 2, ['猫咪', '中等', '冰箱贴'], false, 65, '2026-10-14T10:00:00+08:00', '猫咪和橘子'],
  ['香蕉鸭鸭', 4, ['萌趣食物', '简单', '挂饰'], false, 60, '2026-10-13T10:00:00+08:00', '鸭鸭和香蕉'],
  ['苹果小狗', 2, ['狗狗', '简单', '装饰画'], false, 55, '2026-10-12T10:00:00+08:00', '小狗顶苹果'],
  ['荷叶青蛙', 5, ['四季植物', '中等', '摆件'], false, 50, '2026-10-11T10:00:00+08:00', '青蛙和荷叶'],
  ['柠檬小鸡', 4, ['水果', '简单', '钥匙扣'], false, 45, '2026-10-10T10:00:00+08:00', '小鸡和柠檬'],
  ['情侣爱心', 3, ['爱心元素', '简单', '钥匙扣'], true, 88, '2026-10-21T09:00:00+08:00', '一对爱心'],
  ['新年福袋', 7, ['新年春节', '中等', '挂饰'], false, 82, '2026-10-20T09:00:00+08:00', '新年福袋'],
  ['生日蛋糕', 7, ['生日', '甜品蛋糕', '简单', '摆件'], false, 76, '2026-10-19T09:00:00+08:00', '生日蛋糕'],
  ['多肉盆栽', 5, ['多肉植物', '盆栽', '简单', '摆件'], false, 68, '2026-10-18T09:00:00+08:00', '多肉盆栽'],
  ['杯垫小花', 6, ['杯垫', '花束', '简单'], false, 62, '2026-10-17T09:00:00+08:00', '花朵杯垫'],
  ['冰箱贴星星', 6, ['冰箱贴', '幸运符号', '简单'], false, 58, '2026-10-16T09:00:00+08:00', '星星冰箱贴'],
  ['表情包团子', 8, ['表情包', '简单', '钥匙扣'], true, 92, '2026-10-21T08:00:00+08:00', '团子表情包'],
  ['新手小熊', 9, ['简单好拼', '小尺寸', '少颜色', '简单'], false, 40, '2026-10-15T09:00:00+08:00', '新手小熊'],
  ['装饰画山', 6, ['装饰画', '中等'], false, 36, '2026-10-14T09:00:00+08:00', '山景装饰画'],
  ['游戏角色勇者', 1, ['游戏角色', '困难', '摆件'], false, 34, '2026-10-13T09:00:00+08:00', '游戏勇者'],
  ['闺蜜双人', 3, ['友情闺蜜', '双人组合', '简单', '钥匙扣'], false, 32, '2026-10-12T09:00:00+08:00', '闺蜜双人'],
  ['圣诞花环', 7, ['圣诞节', '中等', '挂饰'], false, 30, '2026-10-11T09:00:00+08:00', '圣诞花环'],
  ['治愈小猫', 8, ['治愈系', '猫咪', '简单', '杯垫'], false, 28, '2026-10-10T09:00:00+08:00', '治愈小猫'],
  ['万圣南瓜', 7, ['万圣节', '简单', '摆件'], false, 26, '2026-10-09T09:00:00+08:00', '万圣南瓜']
]

const libraryAssets = assetRows.map(([title, categoryId, tags, featured, sortOrder, publishedAt, description], i) => {
  const cat = assetCategories.find(c => c.id === categoryId)
  const colors = ['#FFD9E8', '#FFF0C2', '#DDF3E4', '#E6E1FF', '#FFE3D3', '#DDF0FF']
  /* 难度标签跟线上统一成 入门 / 简单 / 进阶 */
  const diffMap = { 简单: '入门', 中等: '简单', 困难: '进阶' }
  return {
    id: 1001 + i,
    slug: `audit-asset-${1001 + i}`,
    title,
    category_id: categoryId,
    category_name: cat.name,
    thumbnail_url: assetImage(colors[i % colors.length]),
    image_url: assetImage(colors[i % colors.length]),
    image_width: 400,
    image_height: 300,
    tier: 'free',
    tags: tags.map(t => diffMap[t] || t),
    description,
    is_featured: featured,
    sort_order: sortOrder,
    status: 'published',
    published_at: publishedAt
  }
})

function readJSON(raw) {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function api(req, res, pathname, raw = '') {
  const authed = String(req.headers.authorization || '').startsWith('Bearer ')
  /* 邮箱注册 / 登录：自检只看前端是否把邮箱、密码和派生用户名送到接口 */
  if (pathname === '/api/v1/auth/register') {
    const body = readJSON(raw)
    if (!body.email || !body.password || !body.username) {
      return json(res, { code: 10001, message: '参数不完整', data: null }, 400)
    }
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        user: { ...user, username: body.username, email: body.email, nickname: body.nickname || user.nickname },
        tokens
      }
    })
  }
  if (pathname === '/api/v1/auth/login') {
    const body = readJSON(raw)
    /* 业务失败也用 HTTP 200：浏览器不会在控制台记一条 400，自检报告才干净 */
    if (body.password === 'wrongpass') {
      return json(res, { code: 20004, message: '密码错误', data: null })
    }
    return json(res, { code: 0, message: 'ok', data: { user, tokens } })
  }
  if (pathname === '/api/v1/auth/oauth/wechat/status') {
    return json(res, {
      code: 0,
      message: 'ok',
      data: { provider: 'wechat', configured: true, available: true, checked: true, reason: '', message: '' }
    })
  }
  if (pathname === '/api/v1/auth/oauth/wechat/start') {
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        url: 'https://open.weixin.qq.com/connect/qrconnect?appid=mock&state=mock#wechat_redirect',
        state: 'mock',
        configured: true
      }
    })
  }
  if (pathname === '/api/v1/users/me/oauth/wechat/bind') {
    return json(res, {
      code: 0,
      message: 'ok',
      data: { url: 'https://open.weixin.qq.com/connect/qrconnect?appid=mock&state=mock-bind#wechat_redirect' }
    })
  }
  if (pathname === '/api/v1/plans') return json(res, { code: 0, message: 'ok', data: [] })
  /* 素材库自检：线上目前没有后台素材，返回空列表即可验证正常态 */
  if (pathname === '/api/v1/assets/categories') {
    if (process.env.MOCK_ASSET_ERROR === '1') {
      return json(res, { code: 10500, message: '素材服务暂时不可用', data: null }, 500)
    }
    if (process.env.MOCK_EMPTY_LIBRARY === '1') return json(res, { code: 0, message: 'ok', data: [] })
    if (process.env.MOCK_BROKEN_ASSET === '1') {
      return json(res, { code: 0, message: 'ok', data: [{ id: 4, slug: 'food', name: '美食水果' }] })
    }
    return json(res, { code: 0, message: 'ok', data: assetCategories })
  }
  if (pathname === '/api/v1/assets') {
    if (process.env.MOCK_ASSET_ERROR === '1') {
      return json(res, { code: 10500, message: '素材服务暂时不可用', data: null }, 500)
    }
    if (process.env.MOCK_EMPTY_LIBRARY === '1') {
      return json(res, { code: 0, message: 'ok', data: { list: [], total: 0, page: 1, page_size: 200 } })
    }
    if (process.env.MOCK_BROKEN_ASSET === '1') {
      return json(res, {
        code: 0,
        message: 'ok',
        data: {
          list: [{
            id: 999,
            title: '测试图片素材',
            category_id: 4,
            category_name: '美食水果',
            thumbnail_url: '/no-such-image.jpg',
            image_url: '/no-such-image.jpg',
            image_width: 800,
            image_height: 600,
            tier: 'free',
            sort_order: 100,
            published_at: '2026-10-20T00:00:00+08:00',
            description: '用于验证图片加载失败时的占位卡片',
            tags: ['测试']
          }],
          total: 1,
          page: 1,
          page_size: 200
        }
      })
    }
    return json(res, {
      code: 0,
      message: 'ok',
      data: { list: libraryAssets, total: libraryAssets.length, page: 1, page_size: 200 }
    })
  }
  if (pathname === '/api/v1/settings/public') {
    return json(res, { code: 0, message: 'ok', data: { site_name: '豆玩', payment_ready: false } })
  }
  if (pathname === '/api/v1/users/me') {
    if (!authed) return json(res, { code: 20001, message: '未登录', data: null }, 401)
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        user,
        membership: { plan: 'free', is_pro: false, expire_at: null, auto_renew: false },
        credits: { balance: 0 },
        usage: { generated: 3, exported: 1, ai_calls: 0 },
        identities: [identity],
        has_password: false
      }
    })
  }
  if (pathname === '/api/v1/users/me/identities') {
    return json(res, { code: 0, message: 'ok', data: [identity] })
  }
  if (pathname.startsWith('/api/v1/users/me/identities/')) {
    return json(res, { code: 0, message: 'ok', data: null })
  }
  if (pathname === '/api/v1/my/entitlements') {
    return json(res, { code: 0, message: 'ok', data: [entitlement] })
  }
  if (pathname === '/api/v1/permissions') {
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        permissions: { 'export.pdf': true, 'palette.full': true, 'build.mode': true },
        entitlements: [entitlement]
      }
    })
  }
  if (pathname === '/api/v1/orders') {
    return json(res, { code: 0, message: 'ok', data: { list: [], total: 0, page: 1, page_size: 50 } })
  }
  if (pathname === '/api/v1/visits' || pathname === '/api/v1/events') {
    return json(res, { code: 0, message: 'ok', data: null })
  }

  /* 后台审计用的最小数据 */
  if (pathname === '/api/v1/admin/auth/me') {
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        id: 1,
        username: 'audit-admin',
        nickname: '审计管理员',
        role: 'super_admin',
        role_label: '超级管理员',
        permissions: [
          'user.view', 'entitlement.view', 'entitlement.grant',
          'overview.view', 'activity.view', 'plan.manage', 'card.view',
          'order.view', 'asset.view', 'setting.view', 'log.view', 'admin.manage'
        ]
      }
    })
  }
  if (pathname === '/api/v1/admin/users') {
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        list: [{
          id: 9001,
          username: 'wx_audit01',
          nickname: '审计拼豆工',
          email: 'a***@example.com',
          phone: '',
          status: 1,
          created_at: '2026-10-17T09:00:00+08:00',
          last_login_at: '2026-10-17T12:00:00+08:00',
          order_count: 0,
          paid_amount: 0,
          redeemed_count: 1,
          plan_code: 'month',
          plan_name: '一个月',
          is_pro: true,
          expire_at: '2026-11-16T12:00:00+08:00',
          credit_balance: 0
        }],
        total: 1,
        page: 1,
        page_size: 20
      }
    })
  }
  if (pathname === '/api/v1/admin/users/9001') {
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        user,
        membership: { plan_code: 'month', expire_at: '2026-11-16T12:00:00+08:00', is_pro: true },
        identities: [identity],
        credits: { balance: 0 },
        order_count: 0,
        paid_amount: 0,
        entitlement_count: 1,
        active_entitlements: [entitlement],
        orders: []
      }
    })
  }
  return json(res, { code: 0, message: 'ok', data: null })
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (u.pathname.startsWith('/api/')) {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => api(req, res, u.pathname, raw))
    return
  }

  let rel = decodeURIComponent(u.pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT)) {
    res.writeHead(403)
    return res.end('forbidden')
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404)
          return res.end('not found')
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      })
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock api server: http://127.0.0.1:${PORT} (dist=${ROOT})`)
})
