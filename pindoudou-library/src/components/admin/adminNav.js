/* =========================================================================
   后台导航菜单（后台需求 §2：左侧导航控制在 7 个主入口以内）
   次级功能由页面内的标签页 / 筛选条件承载，不往主菜单里塞。
   ========================================================================= */

export const ADMIN_NAV = [
  {
    group: '经营',
    items: [
      { to: '/admin', label: '数据概览', icon: 'home', perm: 'overview.view', exact: true },
      { to: '/admin/activity', label: '用户活跃监控', icon: 'chart', perm: 'activity.view' },
      { to: '/admin/feedback', label: '意见反馈', icon: 'info', perm: 'feedback.view' }
    ]
  },
  {
    group: '商品与交付',
    items: [
      { to: '/admin/plans', label: '套餐管理', icon: 'box', perm: 'plan.manage' },
      { to: '/admin/cards', label: '卡密管理', icon: 'lock', perm: 'card.view' },
      { to: '/admin/orders', label: '订单管理', icon: 'list', perm: 'order.view' }
    ]
  },
  {
    group: '内容与用户',
    items: [
      { to: '/admin/assets', label: '素材库', icon: 'photo', perm: 'asset.view' },
      { to: '/admin/users', label: '用户与兑换记录', icon: 'user', perm: 'user.view' }
    ]
  },
  {
    group: '系统',
    items: [
      { to: '/admin/settings', label: '系统设置', icon: 'sliders', perm: 'setting.view' },
      { to: '/admin/logs', label: '操作日志', icon: 'save', perm: 'log.view' },
      { to: '/admin/admins', label: '管理员', icon: 'star', perm: 'admin.manage' }
    ]
  }
]

/** 每个后台路由对应的页面标题与说明，顶栏与浏览器标题共用 */
export const ADMIN_TITLES = {
  '/admin': { title: '数据概览', sub: '一眼看清系统在发生什么' },
  '/admin/activity': { title: '用户活跃监控', sub: '访问量、使用频率、地区、功能与来源渠道' },
  '/admin/feedback': { title: '意见反馈', sub: '前台用户提交的建议与问题，处理完可以标记已处理' },
  '/admin/plans': { title: '套餐管理', sub: '价格与权益全部可配置，草稿默认不对外展示' },
  '/admin/cards': { title: '卡密管理', sub: '批量生成、查询、导出与作废' },
  '/admin/orders': { title: '订单管理', sub: '未接入支付时由管理员人工确认收款并发卡' },
  '/admin/assets': { title: '素材库', sub: '上传、编辑、分类、排序与上下架' },
  '/admin/users': { title: '用户与兑换记录', sub: '用户权益与卡密兑换流水' },
  '/admin/settings': { title: '系统设置', sub: '网站信息、上传限制、卡密规则与支付配置' },
  '/admin/logs': { title: '操作日志', sub: '关键操作留痕，便于事后追溯' },
  '/admin/admins': { title: '管理员', sub: '账号、角色与权限（仅超级管理员）' }
}
