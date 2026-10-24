/* 登录 / 账号页自检用的本地静态服务器 + API 假数据。
   只用于无头浏览器审计，不参与生产构建。
   用法：node scripts/mock-api-server.cjs [port]
   然后：node scripts/audit.cjs --url http://127.0.0.1:4399 --page account ... */
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'dist')
const PORT = Number(process.argv[2] || 4399)
/* 登录自检可以模拟 QQ 的三种状态：not_configured / blocked(100008) / ready */
const QQ_STATE = process.env.MOCK_QQ_STATE || 'not_configured'

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
  username: 'qq_audit01',
  nickname: '审计拼豆工',
  avatar_url: '',
  status: 1,
  created_at: '2026-10-17T09:00:00+08:00',
  last_login_at: '2026-10-17T12:00:00+08:00'
}
const identity = {
  id: 501,
  provider: 'qq',
  provider_label: 'QQ',
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

function api(req, res, pathname) {
  const authed = String(req.headers.authorization || '').startsWith('Bearer ')
  if (pathname === '/api/v1/auth/oauth/qq/status') {
    if (QQ_STATE === 'blocked') {
      return json(res, {
        code: 0,
        message: 'ok',
        data: {
          provider: 'qq',
          configured: true,
          available: false,
          checked: true,
          reason: 'app_not_enabled',
          message: 'QQ 登录正在等待 QQ 互联开通（错误码 100008）。审核通过后会自动恢复，期间请使用账号密码登录。'
        }
      })
    }
    if (QQ_STATE === 'ready') {
      return json(res, {
        code: 0,
        message: 'ok',
        data: { provider: 'qq', configured: true, available: true, checked: true, reason: '', message: '' }
      })
    }
    return json(res, {
      code: 0,
      message: 'ok',
      data: {
        provider: 'qq',
        configured: false,
        available: false,
        checked: true,
        reason: 'not_configured',
        message: 'QQ 登录暂未配置，请联系管理员完成服务器配置。'
      }
    })
  }
  if (pathname === '/api/v1/auth/oauth/qq/start') {
    if (QQ_STATE === 'blocked') {
      return json(res, {
        code: 31007,
        message: 'QQ 登录正在等待 QQ 互联开通（错误码 100008）。审核通过后会自动恢复，期间请使用账号密码登录。',
        data: null
      }, 503)
    }
    if (QQ_STATE === 'ready') {
      return json(res, {
        code: 0,
        message: 'ok',
        data: {
          url: 'https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=1111269377&state=mock',
          state: 'mock',
          configured: true
        }
      })
    }
    return json(res, { code: 31001, message: 'QQ 登录尚未配置，请联系管理员', data: null })
  }
  if (pathname === '/api/v1/auth/oauth/wechat/start') {
    return json(res, { code: 31001, message: '微信登录暂未接入', data: null })
  }
  if (pathname === '/api/v1/auth/oauth/qq/bind') {
    return json(res, { code: 31001, message: 'QQ 登录尚未配置', data: null })
  }
  if (pathname === '/api/v1/plans') return json(res, { code: 0, message: 'ok', data: [] })
  /* 素材库自检：线上目前没有后台素材，返回空列表即可验证正常态 */
  if (pathname === '/api/v1/assets/categories') {
    if (process.env.MOCK_BROKEN_ASSET === '1') {
      return json(res, { code: 0, message: 'ok', data: [{ id: 1, slug: 'food', name: '食物饮品' }] })
    }
    return json(res, { code: 0, message: 'ok', data: [] })
  }
  if (pathname === '/api/v1/assets') {
    if (process.env.MOCK_BROKEN_ASSET === '1') {
      return json(res, {
        code: 0,
        message: 'ok',
        data: {
          list: [{
            id: 999,
            title: '测试图片素材',
            category_id: 1,
            category_name: '食物饮品',
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
    return json(res, { code: 0, message: 'ok', data: { list: [], total: 0, page: 1, page_size: 200 } })
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
          username: 'qq_audit01',
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
  if (u.pathname.startsWith('/api/')) return api(req, res, u.pathname)

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
