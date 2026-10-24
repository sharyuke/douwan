/* 权益防篡改自检的预置脚本（需求 §3.3）：
   在页面加载前把本机会员缓存伪造成「永久 Pro」。
   预期：前台仍按免费版处理，直到服务端同步回真实权益。 */
localStorage.setItem('douzao-membership', JSON.stringify({ plan: 'pro', expireAt: null }))
localStorage.setItem('douzao-credits', JSON.stringify({ balance: 99999, log: [] }))
